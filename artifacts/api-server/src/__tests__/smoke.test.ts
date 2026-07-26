/**
 * Smoke tests for the API server.
 * These run against the Express app in-process (no live database needed for
 * static-data routes; the DB is mocked for plugin-presets).
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import request from "supertest";

// ---------------------------------------------------------------------------
// Mock the DB workspace package before importing the app so plugin-presets
// routes don't attempt a real Postgres connection during tests.
// ---------------------------------------------------------------------------
vi.mock("@workspace/db", () => {
  const mockDb = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockResolvedValue([]),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
  };

  return {
    db: mockDb,
    pluginPresetsTable: {},
  };
});

// Import app AFTER mocking so the mock is in place when routes initialise.
let app: import("express").Express;

beforeAll(async () => {
  const mod = await import("../app.js");
  app = mod.default;
});

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------
describe("GET /api/healthz", () => {
  it("returns 200 with status ok", async () => {
    const res = await request(app).get("/api/healthz");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ok" });
  });
});

// ---------------------------------------------------------------------------
// Static data — EQ presets
// ---------------------------------------------------------------------------
describe("GET /api/eq-presets", () => {
  it("returns 200 with a non-empty array of presets", async () => {
    const res = await request(app).get("/api/eq-presets");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it("each preset has id, name, and bands array", async () => {
    const res = await request(app).get("/api/eq-presets");
    for (const preset of res.body) {
      expect(preset).toHaveProperty("id");
      expect(preset).toHaveProperty("name");
      expect(Array.isArray(preset.bands)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Static data — genres
// ---------------------------------------------------------------------------
describe("GET /api/genres", () => {
  it("returns 200 with a non-empty array of genres", async () => {
    const res = await request(app).get("/api/genres");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it("each genre has id, name, and targetLufs", async () => {
    const res = await request(app).get("/api/genres");
    for (const genre of res.body) {
      expect(genre).toHaveProperty("id");
      expect(genre).toHaveProperty("name");
      expect(genre).toHaveProperty("targetLufs");
    }
  });
});

// ---------------------------------------------------------------------------
// Plugin presets (DB mocked → returns empty list)
// ---------------------------------------------------------------------------
describe("GET /api/plugin-presets", () => {
  it("returns 200 with an array", async () => {
    const res = await request(app).get("/api/plugin-presets");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("accepts optional pluginId query param without error", async () => {
    const res = await request(app).get("/api/plugin-presets?pluginId=test-plugin");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 404 for unknown routes
// ---------------------------------------------------------------------------
describe("Unknown routes", () => {
  it("returns 404 for unregistered paths", async () => {
    const res = await request(app).get("/api/does-not-exist");
    expect(res.status).toBe(404);
  });
});
