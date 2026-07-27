/**
 * Integration test: rate-limit window reset
 *
 * Verifies that after the rate-limit window expires, a previously-blocked IP
 * can upload again (returns 201 instead of 429).
 *
 * Strategy
 * --------
 * We set UPLOAD_RATE_LIMIT_WINDOW_MS=500 and UPLOAD_RATE_LIMIT_PER_MINUTE=2
 * *before* importing the app so the limiter is constructed with a 500 ms
 * window and max=2.  After exhausting the quota we wait 600 ms for the window
 * to roll over, then confirm the next request succeeds.
 *
 * Each vitest worker runs in its own module-registry context, so this file's
 * import is fully isolated from the one in upload-rate-limit.test.ts.
 */
import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import type { Express } from "express";

// ---------------------------------------------------------------------------
// Set env vars BEFORE importing the app so buildUploadRateLimiter() picks
// them up at construction time.
// ---------------------------------------------------------------------------
process.env["UPLOAD_RATE_LIMIT_PER_MINUTE"] = "2";
process.env["UPLOAD_RATE_LIMIT_WINDOW_MS"] = "500"; // 500 ms window

// ---------------------------------------------------------------------------
// Mock the DB so no real Postgres connection is required.
// ---------------------------------------------------------------------------
import { vi } from "vitest";

vi.mock("@workspace/db", () => {
  const mockProject = {
    id: "reset-test-id",
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
const wavBuffer = Buffer.from("RIFF....WAVEfmt ", "ascii");

async function postUpload(app: Express) {
  return request(app)
    .post("/api/audio/upload")
    .attach("audio", wavBuffer, { filename: "clip.wav", contentType: "audio/wav" });
}

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Import app AFTER env vars and mocks are in place.
// ---------------------------------------------------------------------------
let app: Express;

beforeAll(async () => {
  const mod = await import("../app.js");
  app = mod.default;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("Upload rate limiter — window reset", () => {
  it("allows requests again after the rate-limit window expires", async () => {
    // 1. Exhaust the quota (max=2): first two requests should be 201.
    const r1 = await postUpload(app);
    expect(r1.status).toBe(201);

    const r2 = await postUpload(app);
    expect(r2.status).toBe(201);

    // 2. Third request in the same 500 ms window must be blocked.
    const r3 = await postUpload(app);
    expect(r3.status).toBe(429);

    // 3. Wait for the 500 ms window to roll over (600 ms gives a safe margin).
    await wait(600);

    // 4. After the reset the IP should be allowed again.
    const r4 = await postUpload(app);
    expect(r4.status).toBe(201);
  }, 5000 /* generous test timeout */);
});
