/**
 * Integration tests: upload rate limiter
 *
 * Verifies that POST /api/audio/upload:
 *  - Blocks an IP that exceeds the configured limit with a 429 whose body is
 *    JSON containing an "error" field.
 *  - Still returns 201 for requests that stay under the limit.
 *
 * Strategy
 * --------
 * express-rate-limit creates its in-memory store when the middleware is
 * constructed.  The middleware is built once at module load (see audio.ts).
 * By setting UPLOAD_RATE_LIMIT_PER_MINUTE=2 *before* the dynamic import we
 * get a limiter with max=2 so the tests only need three requests to trigger
 * the 429 — no need for the default 10.
 *
 * Each vitest worker runs in its own module-registry context, so this file's
 * import of the app is independent from the one in smoke.test.ts.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import request from "supertest";
import type { Express } from "express";

// ---------------------------------------------------------------------------
// Set the low rate-limit cap BEFORE importing the app so the middleware is
// constructed with max=2 instead of the production default of 10.
// ---------------------------------------------------------------------------
process.env["UPLOAD_RATE_LIMIT_PER_MINUTE"] = "2";

// ---------------------------------------------------------------------------
// Mock the DB (no Postgres connection needed for these tests).
// ---------------------------------------------------------------------------
vi.mock("@workspace/db", () => {
  const mockProject = {
    id: "rate-limit-test-id",
    name: "test-audio",
    originalFilename: "test-audio.wav",
    fileUrl: "/api/audio/file/some-uuid.wav",
    status: "ready",
    enhancementSettings: {},
    masteringSettings: {},
    createdAt: new Date("2024-01-01T00:00:00Z"),
  };

  const mockDb = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockResolvedValue([]),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    // Always return a valid project so 201 responses work.
    returning: vi.fn().mockResolvedValue([mockProject]),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
  };

  return {
    db: mockDb,
    pluginPresetsTable: {},
    audioProjectsTable: {},
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/** Minimal WAV buffer — enough to pass multer's extension/mime check. */
const wavBuffer = Buffer.from("RIFF....WAVEfmt ", "ascii");

/** POST a single audio upload and return the supertest response. */
async function postUpload(app: Express) {
  return request(app)
    .post("/api/audio/upload")
    .attach("audio", wavBuffer, { filename: "clip.wav", contentType: "audio/wav" });
}

/**
 * POST a single audio upload spoofing a specific client IP via X-Forwarded-For.
 * Works because app.ts sets `trust proxy = 1`, so Express promotes the first
 * X-Forwarded-For value to req.ip — the key used by express-rate-limit.
 */
async function postUploadFromIp(app: Express, ip: string) {
  return request(app)
    .post("/api/audio/upload")
    .set("X-Forwarded-For", ip)
    .attach("audio", wavBuffer, { filename: "clip.wav", contentType: "audio/wav" });
}

// ---------------------------------------------------------------------------
// Import app AFTER env var and mocks are in place.
// ---------------------------------------------------------------------------
let app: Express;

beforeAll(async () => {
  const mod = await import("../app.js");
  app = mod.default;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("Upload rate limiter", () => {
  /**
   * Note: express-rate-limit's MemoryStore accumulates counts across tests
   * within the same worker process / import cycle.  We therefore run the
   * "under limit" assertion first and consume the remaining quota deliberately.
   */

  it("returns 201 for requests that stay within the limit", async () => {
    // UPLOAD_RATE_LIMIT_PER_MINUTE=2 → first two requests should succeed.
    const res1 = await postUpload(app);
    expect(res1.status).toBe(201);

    const res2 = await postUpload(app);
    expect(res2.status).toBe(201);
  });

  it("returns 429 once the limit is exceeded", async () => {
    // The two requests above already consumed the quota.
    // This third request must be rate-limited.
    const res = await postUpload(app);
    expect(res.status).toBe(429);
  });

  it("429 response body is JSON with an 'error' field", async () => {
    // Any further requests in this window are still 429.
    const res = await postUpload(app);
    expect(res.status).toBe(429);
    // Content-Type should be JSON
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    // Body must carry an error message
    expect(res.body).toHaveProperty("error");
    expect(typeof res.body.error).toBe("string");
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  it("429 response includes standard rate-limit headers", async () => {
    const res = await postUpload(app);
    expect(res.status).toBe(429);
    // express-rate-limit emits RateLimit-* headers when standardHeaders:true
    expect(res.headers).toHaveProperty("ratelimit-limit");
    expect(res.headers).toHaveProperty("ratelimit-remaining");
  });
});

// ---------------------------------------------------------------------------
// Per-IP isolation: exhausting one IP's quota must not affect another IP
// ---------------------------------------------------------------------------
describe("Upload rate limiter — per-IP isolation", () => {
  /**
   * app.ts sets `trust proxy = 1`, so Express reads the real client IP from
   * the first X-Forwarded-For value and express-rate-limit keys on that IP.
   * This suite verifies that a blocked IP-A does not affect IP-B.
   *
   * We use distinct, non-loopback addresses (10.0.0.1 / 10.0.0.2) so they
   * don't collide with the unforwarded supertest IP (127.0.0.1 / ::1) used
   * by the "Upload rate limiter" suite above.
   */

  it("trust proxy: X-Forwarded-For is reflected in rate-limit key", async () => {
    // First request from IP-A must succeed (fresh counter for this IP).
    const res = await postUploadFromIp(app, "10.0.0.1");
    expect(res.status).toBe(201);
  });

  it("IP-A becomes rate-limited after exhausting its quota", async () => {
    // Consume the remaining quota for 10.0.0.1 (one request was used above).
    const res = await postUploadFromIp(app, "10.0.0.1");
    expect(res.status).toBe(201);

    // Next request from IP-A must be rate-limited.
    const blocked = await postUploadFromIp(app, "10.0.0.1");
    expect(blocked.status).toBe(429);
  });

  it("IP-B is unaffected while IP-A is rate-limited", async () => {
    // IP-A is already exhausted from the previous test.
    // Confirm IP-A is still blocked.
    const ipARes = await postUploadFromIp(app, "10.0.0.1");
    expect(ipARes.status).toBe(429);

    // IP-B (10.0.0.2) has its own fresh counter — must still return 201.
    const ipBRes = await postUploadFromIp(app, "10.0.0.2");
    expect(ipBRes.status).toBe(201);
  });
});
