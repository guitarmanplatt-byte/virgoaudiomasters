/**
 * Integration test: Redis-backed rate limiter — cross-instance counter sharing
 *
 * Verifies that two independent Express app instances wired to the *same*
 * backing store share a single per-IP counter correctly. This mirrors a
 * horizontally-scaled deployment where every replica uses the same Redis
 * backend: a client that splits its requests across replicas must still be
 * blocked at the configured threshold.
 *
 * Why a custom SharedCounterStore instead of ioredis-mock
 * -------------------------------------------------------
 * `rate-limit-redis` loads a Lua script via `SCRIPT LOAD` / `EVALSHA` during
 * store initialisation. `ioredis-mock` does not implement Lua scripting, so
 * the call throws immediately. Rather than shim an entire Lua runtime we
 * implement the `express-rate-limit` Store interface directly with a plain
 * Map that is shared between two store instances — exactly what Redis provides
 * across replicas. The critical invariant (shared counter, atomic increment)
 * is preserved.
 *
 * With max=3 we can verify:
 *   app1: req 1 → 201   (counter = 1)
 *   app2: req 2 → 201   (counter = 2)
 *   app1: req 3 → 201   (counter = 3  — at limit, next is blocked)
 *   app2: req 4 → 429   (cross-instance threshold enforced)
 *   app1: req 5 → 429   (same)
 */

import { describe, it, expect } from "vitest";
import request from "supertest";
import express, { type Express, type Request, type Response } from "express";
import rateLimit, { type Store, type ClientRateLimitInfo, type Options } from "express-rate-limit";

// ---------------------------------------------------------------------------
// SharedCounterStore
//
// Implements the express-rate-limit Store interface backed by a plain Map.
// Multiple store instances that receive the *same* Map object share the
// counter — exactly what two Redis-connected replicas do.
// ---------------------------------------------------------------------------
interface HitRecord {
  count: number;
  expiresAt: number; // Unix ms
}

class SharedCounterStore implements Store {
  /**
   * localKeys: false tells express-rate-limit that this store can be used
   * across multiple middleware instances (i.e. its keys are not local to a
   * single instance). Setting this prevents the "unshared store" warning.
   */
  localKeys = false as const;

  private readonly data: Map<string, HitRecord>;
  private windowMs = 60_000;

  /**
   * @param sharedData - The Map that is shared between two store instances.
   *   Pass the *same* Map to both stores to simulate a shared Redis backend.
   */
  constructor(sharedData: Map<string, HitRecord>) {
    this.data = sharedData;
  }

  init(options: Options): void {
    this.windowMs = options.windowMs;
  }

  increment(key: string): ClientRateLimitInfo {
    const now = Date.now();
    const existing = this.data.get(key);

    if (!existing || existing.expiresAt <= now) {
      // New window
      const expiresAt = now + this.windowMs;
      this.data.set(key, { count: 1, expiresAt });
      return { totalHits: 1, resetTime: new Date(expiresAt) };
    }

    existing.count += 1;
    return { totalHits: existing.count, resetTime: new Date(existing.expiresAt) };
  }

  decrement(key: string): void {
    const existing = this.data.get(key);
    if (existing && existing.count > 0) {
      existing.count -= 1;
    }
  }

  resetKey(key: string): void {
    this.data.delete(key);
  }

  resetAll(): void {
    this.data.clear();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/**
 * Build a minimal Express app with a rate-limited POST /upload endpoint.
 * `app.set("trust proxy", true)` lets tests pin the client IP via
 * X-Forwarded-For so both apps see an identical rate-limit key.
 */
function buildTestApp(limiter: ReturnType<typeof rateLimit>): Express {
  const app = express();
  app.set("trust proxy", true);

  app.post("/upload", limiter, (_req: Request, res: Response) => {
    res.status(201).json({ ok: true });
  });

  return app;
}

/**
 * Build two Express app instances whose rate limiters share the same
 * backing Map (simulating two server replicas sharing a Redis instance).
 *
 * @param max - Maximum requests per window.
 * @param windowMs - Window duration in milliseconds.
 */
function buildSharedStoreApps(max: number, windowMs: number) {
  // The shared Map is the Redis analogue — a single source of truth for
  // all counters, regardless of which "replica" increments them.
  const sharedData = new Map<string, HitRecord>();

  const makeLimiter = () =>
    rateLimit({
      windowMs,
      max,
      standardHeaders: true,
      legacyHeaders: false,
      // Disable the trust-proxy validation so tests can freely set the IP
      // via X-Forwarded-For without triggering the warning.
      validate: { trustProxy: false, xForwardedForHeader: false },
      store: new SharedCounterStore(sharedData),
      message: { error: "Too many upload requests from this IP, please try again later." },
    });

  return {
    app1: buildTestApp(makeLimiter()),
    app2: buildTestApp(makeLimiter()),
  };
}

/** POST /upload through `app`, pinning the client IP to `ip`. */
function postUpload(app: Express, ip = "10.0.0.1") {
  return request(app)
    .post("/upload")
    .set("X-Forwarded-For", ip)
    .send();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Redis-backed rate limiter — cross-instance counter sharing", () => {
  it("requests distributed across two instances share a single counter", async () => {
    const { app1, app2 } = buildSharedStoreApps(3, 30_000);
    const IP = "10.1.2.3";

    // Requests 1-3 should succeed (combined quota = 3).
    const r1 = await postUpload(app1, IP);
    expect(r1.status, "app1 req 1").toBe(201);

    const r2 = await postUpload(app2, IP);
    expect(r2.status, "app2 req 2").toBe(201);

    const r3 = await postUpload(app1, IP);
    expect(r3.status, "app1 req 3").toBe(201);

    // Request 4: quota exhausted — blocked regardless of which instance handles it.
    const r4 = await postUpload(app2, IP);
    expect(r4.status, "app2 req 4 — should be 429").toBe(429);

    // Request 5: still blocked on app1.
    const r5 = await postUpload(app1, IP);
    expect(r5.status, "app1 req 5 — should be 429").toBe(429);
  });

  it("429 response body contains an 'error' field and standard rate-limit headers", async () => {
    const { app1, app2 } = buildSharedStoreApps(2, 30_000);
    const IP = "10.2.3.4";

    // Exhaust quota on app1.
    await postUpload(app1, IP); // hit 1
    await postUpload(app1, IP); // hit 2

    // Block triggers on app2.
    const blocked = await postUpload(app2, IP);
    expect(blocked.status).toBe(429);
    expect(blocked.headers["content-type"]).toMatch(/application\/json/);
    expect(blocked.body).toHaveProperty("error");
    expect(typeof blocked.body.error).toBe("string");
    expect(blocked.body.error.length).toBeGreaterThan(0);
    expect(blocked.headers).toHaveProperty("ratelimit-limit");
    expect(blocked.headers).toHaveProperty("ratelimit-remaining");
  });

  it("a different IP is not affected by another IP's exhausted quota", async () => {
    const { app1, app2 } = buildSharedStoreApps(2, 30_000);
    const IP_A = "10.3.4.5";
    const IP_B = "10.3.4.6";

    // Exhaust quota for IP_A across both instances.
    await postUpload(app1, IP_A);
    await postUpload(app2, IP_A);
    const blockedA = await postUpload(app1, IP_A);
    expect(blockedA.status, "IP_A should be blocked").toBe(429);

    // IP_B has its own independent counter — must still succeed.
    const okB = await postUpload(app2, IP_B);
    expect(okB.status, "IP_B should not be blocked").toBe(201);
  });

  it("counter resets after the window expires — both instances see fresh quota", async () => {
    // Very short window (300 ms) so the test finishes quickly.
    const { app1, app2 } = buildSharedStoreApps(2, 300);
    const IP = "10.4.5.6";

    // Exhaust.
    await postUpload(app1, IP);
    await postUpload(app2, IP);
    const blocked = await postUpload(app1, IP);
    expect(blocked.status, "should be blocked before reset").toBe(429);

    // Wait for the window to roll over.
    await wait(400);

    // After reset, both instances accept requests again.
    const afterReset1 = await postUpload(app1, IP);
    expect(afterReset1.status, "app1 after reset").toBe(201);

    const afterReset2 = await postUpload(app2, IP);
    expect(afterReset2.status, "app2 after reset").toBe(201);
  }, 5_000);

  it("flood of concurrent requests from the same IP is capped at the configured limit", async () => {
    const MAX = 5;
    const { app1, app2 } = buildSharedStoreApps(MAX, 30_000);
    const IP = "10.5.6.7";

    // Fire 10 concurrent requests, alternating between app1 and app2.
    const TOTAL = 10;
    const results = await Promise.all(
      Array.from({ length: TOTAL }, (_, i) =>
        postUpload(i % 2 === 0 ? app1 : app2, IP),
      ),
    );

    const statuses = results.map((r) => r.status);
    const allowed = statuses.filter((s) => s === 201).length;
    const blocked = statuses.filter((s) => s === 429).length;

    // The combined counter must not allow more than MAX requests.
    expect(allowed, `allowed (${allowed}) must not exceed MAX (${MAX})`).toBeLessThanOrEqual(MAX);
    // At least TOTAL - MAX requests must be blocked.
    expect(blocked, `blocked (${blocked}) must be ≥ ${TOTAL - MAX}`).toBeGreaterThanOrEqual(TOTAL - MAX);
  });
});
