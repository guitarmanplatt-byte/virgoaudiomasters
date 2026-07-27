/**
 * Unit tests: buildUploadRateLimiter store-selection logic and disconnect handle
 *
 * Verifies that the factory function:
 *   - picks the correct backing store based on REDIS_URL
 *   - returns a { middleware, disconnect } handle
 *   - disconnect() calls quit() on the underlying ioredis client
 *   - disconnect() is a no-op when no Redis client was created
 *
 * Store-selection cases:
 *   - REDIS_URL set to a non-empty string  → RedisStore + ioredis client
 *   - REDIS_URL absent (undefined)         → built-in MemoryStore (no Redis)
 *   - REDIS_URL set to empty string ""     → built-in MemoryStore (no Redis)
 *
 * Strategy
 * --------
 * We mock both `ioredis` and `rate-limit-redis` so no real network connection
 * is attempted.  After each call to buildUploadRateLimiter() we inspect the
 * mock constructor call counts to assert which code path was taken.
 *
 * The module-level `const uploadRateLimiter = buildUploadRateLimiter()` in
 * audio.ts runs once when the module is first imported.  To keep that side-
 * effect from polluting our per-test mock state we:
 *   1. Ensure REDIS_URL is unset before importing, so the module-level call
 *      takes the MemoryStore path and never touches the mocks.
 *   2. Clear mock call counts with vi.clearAllMocks() in beforeEach so each
 *      test starts with a clean slate.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — declared BEFORE any import so Vitest hoists them correctly.
// ---------------------------------------------------------------------------

vi.mock("ioredis", () => {
  /** Minimal stand-in for an ioredis client — must use a real function so `new` works. */
  function RedisMock(this: Record<string, unknown>) {
    this.call = vi.fn().mockResolvedValue(null);
    this.disconnect = vi.fn();
    this.quit = vi.fn().mockResolvedValue("OK");
    this.on = vi.fn();
  }
  const RedisSpy = vi.fn(RedisMock as unknown as new (...args: unknown[]) => unknown);
  return { default: RedisSpy };
});

vi.mock("rate-limit-redis", () => {
  /** Stand-in for RedisStore — must use a real function so `new` works. */
  function RedisStoreMock(this: Record<string, unknown>, opts?: { sendCommand?: unknown }) {
    this._opts = opts;
    this.localKeys = false;
    this.init = vi.fn();
    this.increment = vi.fn().mockResolvedValue({ totalHits: 1, resetTime: new Date() });
    this.decrement = vi.fn();
    this.resetKey = vi.fn();
    this.resetAll = vi.fn();
  }
  const RedisStoreSpy = vi.fn(RedisStoreMock as unknown as new (...args: unknown[]) => unknown);
  return { RedisStore: RedisStoreSpy };
});

// Prevent the DB import from attempting a real Postgres connection.
vi.mock("@workspace/db", () => ({
  db: {},
  audioProjectsTable: {},
  pluginPresetsTable: {},
}));

// ---------------------------------------------------------------------------
// Import the function under test AFTER mocks are established and after we
// ensure REDIS_URL is absent so the module-level limiter uses MemoryStore.
// ---------------------------------------------------------------------------
delete process.env["REDIS_URL"];

import { buildUploadRateLimiter } from "../routes/audio.js";
import Redis from "ioredis";
import { RedisStore } from "rate-limit-redis";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Cast to a vi.Mock so we can inspect call counts. */
const RedisMock = Redis as unknown as ReturnType<typeof vi.fn>;
const RedisStoreMock = RedisStore as unknown as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildUploadRateLimiter — store selection", () => {
  // Save and restore the original env value around each test.
  const originalRedisUrl = process.env["REDIS_URL"];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (originalRedisUrl === undefined) {
      delete process.env["REDIS_URL"];
    } else {
      process.env["REDIS_URL"] = originalRedisUrl;
    }
  });

  // -------------------------------------------------------------------------
  // 1. Redis path
  // -------------------------------------------------------------------------
  it("uses RedisStore when REDIS_URL is set to a non-empty string", () => {
    process.env["REDIS_URL"] = "redis://localhost:6379";

    buildUploadRateLimiter();

    // The ioredis client should have been constructed with the provided URL.
    expect(RedisMock).toHaveBeenCalledTimes(1);
    expect(RedisMock).toHaveBeenCalledWith("redis://localhost:6379");

    // RedisStore should have been constructed (once for this call).
    expect(RedisStoreMock).toHaveBeenCalledTimes(1);
  });

  it("passes a sendCommand function to RedisStore that delegates to the Redis client", () => {
    process.env["REDIS_URL"] = "redis://localhost:6379";

    buildUploadRateLimiter();

    // Retrieve the options object passed to the RedisStore constructor.
    const storeOptions = RedisStoreMock.mock.calls[0]?.[0] as { sendCommand: (...args: string[]) => unknown };
    expect(storeOptions).toBeDefined();
    expect(typeof storeOptions.sendCommand).toBe("function");

    // Calling sendCommand should forward to client.call.
    const mockClientInstance = RedisMock.mock.results[0]?.value as { call: ReturnType<typeof vi.fn> };
    storeOptions.sendCommand("INCRBY", "key", "1");
    expect(mockClientInstance.call).toHaveBeenCalledWith("INCRBY", "key", "1");
  });

  // -------------------------------------------------------------------------
  // 2. MemoryStore path — REDIS_URL absent
  // -------------------------------------------------------------------------
  it("does not create a Redis client or RedisStore when REDIS_URL is absent", () => {
    delete process.env["REDIS_URL"];

    buildUploadRateLimiter();

    expect(RedisMock).not.toHaveBeenCalled();
    expect(RedisStoreMock).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 3. MemoryStore path — REDIS_URL is empty string
  // -------------------------------------------------------------------------
  it("does not create a Redis client or RedisStore when REDIS_URL is an empty string", () => {
    process.env["REDIS_URL"] = "";

    buildUploadRateLimiter();

    // An empty string is falsy; the factory must treat it the same as absent.
    expect(RedisMock).not.toHaveBeenCalled();
    expect(RedisStoreMock).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 4. Malformed REDIS_URL — not a URL at all
  // -------------------------------------------------------------------------
  it("throws when REDIS_URL is set to a string that is not a valid URL", () => {
    process.env["REDIS_URL"] = "not-a-url";

    // The factory must throw loudly so the server crashes at startup rather
    // than silently running without Redis (inaccurate rate-limit counters).
    expect(() => buildUploadRateLimiter()).toThrow(/not a valid URL/i);

    // No Redis client or store should have been constructed.
    expect(RedisMock).not.toHaveBeenCalled();
    expect(RedisStoreMock).not.toHaveBeenCalled();
  });

  it("throws when REDIS_URL has an unsupported protocol (e.g. http://)", () => {
    process.env["REDIS_URL"] = "http://localhost:6379";

    expect(() => buildUploadRateLimiter()).toThrow(/unsupported protocol/i);

    expect(RedisMock).not.toHaveBeenCalled();
    expect(RedisStoreMock).not.toHaveBeenCalled();
  });

  it("throws when REDIS_URL uses a ftp:// scheme", () => {
    process.env["REDIS_URL"] = "ftp://cache.example.com/0";

    expect(() => buildUploadRateLimiter()).toThrow(/unsupported protocol/i);

    expect(RedisMock).not.toHaveBeenCalled();
    expect(RedisStoreMock).not.toHaveBeenCalled();
  });

  it("accepts redis+sentinel:// as a valid scheme", () => {
    process.env["REDIS_URL"] = "redis+sentinel://sentinel-host:26379/mymaster/0";

    // Should not throw — sentinel URLs are a supported ioredis scheme.
    expect(() => buildUploadRateLimiter()).not.toThrow();

    expect(RedisMock).toHaveBeenCalledTimes(1);
    expect(RedisStoreMock).toHaveBeenCalledTimes(1);
  });

  it("accepts rediss:// (TLS) as a valid scheme", () => {
    process.env["REDIS_URL"] = "rediss://secure-host:6380";

    expect(() => buildUploadRateLimiter()).not.toThrow();

    expect(RedisMock).toHaveBeenCalledTimes(1);
    expect(RedisStoreMock).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // 5. storeOverride bypasses auto-selection
  // -------------------------------------------------------------------------
  it("uses the provided storeOverride and skips Redis construction entirely", () => {
    process.env["REDIS_URL"] = "redis://localhost:6379";

    const customStore = new RedisStore({ sendCommand: vi.fn() });
    // Clear counts from the RedisStore constructor call above.
    vi.clearAllMocks();

    buildUploadRateLimiter(customStore);

    // Even though REDIS_URL is set, no new Redis client should be created.
    expect(RedisMock).not.toHaveBeenCalled();
    // And no additional RedisStore instances should be constructed inside the factory.
    expect(RedisStoreMock).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 5. Returned middleware is a function (sanity check)
  // -------------------------------------------------------------------------
  it("returns a callable Express middleware in all configurations", () => {
    delete process.env["REDIS_URL"];
    const { middleware: withMemory } = buildUploadRateLimiter();
    expect(typeof withMemory).toBe("function");

    process.env["REDIS_URL"] = "redis://localhost:6379";
    const { middleware: withRedis } = buildUploadRateLimiter();
    expect(typeof withRedis).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// Disconnect handle tests
// ---------------------------------------------------------------------------

describe("buildUploadRateLimiter — disconnect handle", () => {
  const originalRedisUrl = process.env["REDIS_URL"];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (originalRedisUrl === undefined) {
      delete process.env["REDIS_URL"];
    } else {
      process.env["REDIS_URL"] = originalRedisUrl;
    }
  });

  it("disconnect() calls quit() on the ioredis client when Redis was created", async () => {
    process.env["REDIS_URL"] = "redis://localhost:6379";

    const { disconnect } = buildUploadRateLimiter();

    // Retrieve the mock client instance created during factory execution.
    const mockClientInstance = RedisMock.mock.results[0]?.value as { quit: ReturnType<typeof vi.fn> };
    expect(mockClientInstance).toBeDefined();

    await disconnect();

    expect(mockClientInstance.quit).toHaveBeenCalledTimes(1);
  });

  it("disconnect() resolves without error when no Redis client was created (MemoryStore path)", async () => {
    delete process.env["REDIS_URL"];

    const { disconnect } = buildUploadRateLimiter();

    // Should resolve cleanly — no Redis client exists.
    await expect(disconnect()).resolves.toBeUndefined();

    // quit() must not have been called on any Redis instance.
    expect(RedisMock).not.toHaveBeenCalled();
  });

  it("disconnect() resolves without error when storeOverride was supplied", async () => {
    const customStore = new RedisStore({ sendCommand: vi.fn() });
    vi.clearAllMocks();

    const { disconnect } = buildUploadRateLimiter(customStore);

    // No internal Redis client should have been created.
    expect(RedisMock).not.toHaveBeenCalled();

    // disconnect() should still be safe to call.
    await expect(disconnect()).resolves.toBeUndefined();
  });

  it("disconnect() can be called multiple times without throwing", async () => {
    process.env["REDIS_URL"] = "redis://localhost:6379";

    const { disconnect } = buildUploadRateLimiter();

    await expect(disconnect()).resolves.toBeUndefined();
    await expect(disconnect()).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Mid-request Redis failure tests
// ---------------------------------------------------------------------------

describe("buildUploadRateLimiter — mid-request Redis failure", () => {
  const originalRedisUrl = process.env["REDIS_URL"];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (originalRedisUrl === undefined) {
      delete process.env["REDIS_URL"];
    } else {
      process.env["REDIS_URL"] = originalRedisUrl;
    }
  });

  it("attaches an error listener to the Redis client so dropped connections don't crash the process", () => {
    process.env["REDIS_URL"] = "redis://localhost:6379";

    buildUploadRateLimiter();

    // The ioredis client mock instance should have had .on("error", ...) called.
    const mockClientInstance = RedisMock.mock.results[0]?.value as {
      on: ReturnType<typeof vi.fn>;
    };
    expect(mockClientInstance.on).toHaveBeenCalledWith("error", expect.any(Function));
  });

  it("sendCommand rejects when client.call rejects (mid-request failure propagates)", async () => {
    process.env["REDIS_URL"] = "redis://localhost:6379";

    buildUploadRateLimiter();

    // Retrieve the sendCommand passed to RedisStore.
    const storeOptions = RedisStoreMock.mock.calls[0]?.[0] as {
      sendCommand: (...args: string[]) => Promise<number>;
    };
    expect(storeOptions).toBeDefined();

    // Make the underlying Redis client reject on the next call.
    const mockClientInstance = RedisMock.mock.results[0]?.value as {
      call: ReturnType<typeof vi.fn>;
    };
    const simulatedError = new Error("Connection lost");
    mockClientInstance.call.mockRejectedValueOnce(simulatedError);

    // sendCommand must propagate the rejection so express-rate-limit can call
    // next(err), producing a defined 500 response rather than a silent hang.
    await expect(storeOptions.sendCommand("INCRBY", "key", "1")).rejects.toThrow("Connection lost");
  });

  it("sendCommand succeeds normally when client.call resolves (no false positives)", async () => {
    process.env["REDIS_URL"] = "redis://localhost:6379";

    buildUploadRateLimiter();

    const storeOptions = RedisStoreMock.mock.calls[0]?.[0] as {
      sendCommand: (...args: string[]) => Promise<number>;
    };

    const mockClientInstance = RedisMock.mock.results[0]?.value as {
      call: ReturnType<typeof vi.fn>;
    };
    mockClientInstance.call.mockResolvedValueOnce(3);

    await expect(storeOptions.sendCommand("INCRBY", "key", "1")).resolves.toBe(3);
  });

  it("a transient client.call rejection does not affect subsequent requests", async () => {
    process.env["REDIS_URL"] = "redis://localhost:6379";

    buildUploadRateLimiter();

    const storeOptions = RedisStoreMock.mock.calls[0]?.[0] as {
      sendCommand: (...args: string[]) => Promise<number>;
    };
    const mockClientInstance = RedisMock.mock.results[0]?.value as {
      call: ReturnType<typeof vi.fn>;
    };

    // First call fails (transient network blip).
    mockClientInstance.call.mockRejectedValueOnce(new Error("ECONNRESET"));
    await expect(storeOptions.sendCommand("INCRBY", "key", "1")).rejects.toThrow("ECONNRESET");

    // Second call recovers.
    mockClientInstance.call.mockResolvedValueOnce(1);
    await expect(storeOptions.sendCommand("INCRBY", "key", "1")).resolves.toBe(1);
  });
});
