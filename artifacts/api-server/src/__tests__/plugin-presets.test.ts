/**
 * Integration tests for GET/POST/PATCH/DELETE /api/plugin-presets.
 * The DB is mocked so no live Postgres connection is required.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import request from "supertest";

// ---------------------------------------------------------------------------
// Mock the DB workspace package before importing the app.
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
    audioProjectsTable: {},
  };
});

let app: import("express").Express;

beforeAll(async () => {
  const mod = await import("../app.js");
  app = mod.default;
});

// Convenience – a complete preset row as the DB would return it.
const mockPreset = {
  id: 1,
  pluginId: "vintage-tape",
  name: "My Preset",
  params: { speed: 7.5, hiss: 0.3 },
  createdAt: new Date("2025-01-01T00:00:00Z"),
  updatedAt: new Date("2025-01-02T00:00:00Z"),
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/** Reset all mock call counts and return values between tests. */
async function resetMocks() {
  const { db } = await import("@workspace/db");
  vi.mocked(db.select).mockReset().mockReturnThis();
  vi.mocked(db.from).mockReset().mockReturnThis();
  vi.mocked(db.where).mockReset().mockReturnThis();
  vi.mocked(db.orderBy).mockReset().mockResolvedValue([]);
  vi.mocked(db.insert).mockReset().mockReturnThis();
  vi.mocked(db.values).mockReset().mockReturnThis();
  vi.mocked(db.returning).mockReset().mockResolvedValue([]);
  vi.mocked(db.update).mockReset().mockReturnThis();
  vi.mocked(db.set).mockReset().mockReturnThis();
  vi.mocked(db.delete).mockReset().mockReturnThis();
}

// ---------------------------------------------------------------------------
// GET /api/plugin-presets
// ---------------------------------------------------------------------------
describe("GET /api/plugin-presets", () => {
  beforeEach(resetMocks);

  it("returns 200 with an empty array when no presets exist", async () => {
    const res = await request(app).get("/api/plugin-presets");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns 200 with all presets when db returns rows", async () => {
    const { db } = await import("@workspace/db");
    vi.mocked(db.orderBy).mockResolvedValueOnce([mockPreset]);

    const res = await request(app).get("/api/plugin-presets");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ id: 1, pluginId: "vintage-tape", name: "My Preset" });
  });

  it("accepts the pluginId query param and still returns 200", async () => {
    const { db } = await import("@workspace/db");
    vi.mocked(db.orderBy).mockResolvedValueOnce([mockPreset]);

    const res = await request(app).get("/api/plugin-presets?pluginId=vintage-tape");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("returns 200 with empty array when pluginId matches nothing", async () => {
    const res = await request(app).get("/api/plugin-presets?pluginId=nonexistent-plugin");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("ignores non-string pluginId values (array) and returns all presets", async () => {
    const { db } = await import("@workspace/db");
    vi.mocked(db.orderBy).mockResolvedValueOnce([mockPreset]);

    // Supertest sends pluginId[]=x&pluginId[]=y as an array at the query layer.
    const res = await request(app).get("/api/plugin-presets?pluginId[]=a&pluginId[]=b");
    expect(res.status).toBe(200);
    // Route treats non-string pluginId as absent → returns all presets
    expect(Array.isArray(res.body)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// POST /api/plugin-presets
// ---------------------------------------------------------------------------
describe("POST /api/plugin-presets", () => {
  beforeEach(resetMocks);

  const validBody = {
    pluginId: "vintage-tape",
    name: "My Preset",
    params: { speed: 7.5, hiss: 0.3 },
  };

  it("returns 201 with the created preset on a valid body", async () => {
    const { db } = await import("@workspace/db");
    vi.mocked(db.returning).mockResolvedValueOnce([mockPreset]);

    const res = await request(app).post("/api/plugin-presets").send(validBody);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: 1, pluginId: "vintage-tape", name: "My Preset" });
    expect(res.body.params).toEqual({ speed: 7.5, hiss: 0.3 });
  });

  it("returns 400 when pluginId is missing", async () => {
    const { pluginId: _omit, ...withoutPluginId } = validBody;
    const res = await request(app).post("/api/plugin-presets").send(withoutPluginId);
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when name is missing", async () => {
    const { name: _omit, ...withoutName } = validBody;
    const res = await request(app).post("/api/plugin-presets").send(withoutName);
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when params is missing", async () => {
    const { params: _omit, ...withoutParams } = validBody;
    const res = await request(app).post("/api/plugin-presets").send(withoutParams);
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when pluginId is an empty string", async () => {
    const res = await request(app)
      .post("/api/plugin-presets")
      .send({ ...validBody, pluginId: "" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when name is an empty string", async () => {
    const res = await request(app)
      .post("/api/plugin-presets")
      .send({ ...validBody, name: "" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when params contains non-numeric values", async () => {
    const res = await request(app)
      .post("/api/plugin-presets")
      .send({ ...validBody, params: { speed: "fast" } });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when the body is empty", async () => {
    const res = await request(app).post("/api/plugin-presets").send({});
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/plugin-presets/:id
// ---------------------------------------------------------------------------
describe("PATCH /api/plugin-presets/:id", () => {
  beforeEach(resetMocks);

  it("returns 200 with updated preset when renaming", async () => {
    const { db } = await import("@workspace/db");
    const updated = { ...mockPreset, name: "Renamed Preset" };
    vi.mocked(db.returning).mockResolvedValueOnce([updated]);

    const res = await request(app)
      .patch("/api/plugin-presets/1")
      .send({ name: "Renamed Preset" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 1, name: "Renamed Preset" });
  });

  it("returns 200 with updated preset when updating params", async () => {
    const { db } = await import("@workspace/db");
    const updated = { ...mockPreset, params: { speed: 15, hiss: 0.9 } };
    vi.mocked(db.returning).mockResolvedValueOnce([updated]);

    const res = await request(app)
      .patch("/api/plugin-presets/1")
      .send({ params: { speed: 15, hiss: 0.9 } });
    expect(res.status).toBe(200);
    expect(res.body.params).toEqual({ speed: 15, hiss: 0.9 });
  });

  it("returns 200 when both name and params are provided", async () => {
    const { db } = await import("@workspace/db");
    const updated = { ...mockPreset, name: "Full Update", params: { speed: 10 } };
    vi.mocked(db.returning).mockResolvedValueOnce([updated]);

    const res = await request(app)
      .patch("/api/plugin-presets/1")
      .send({ name: "Full Update", params: { speed: 10 } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: "Full Update", params: { speed: 10 } });
  });

  it("returns 404 when the preset does not exist", async () => {
    // db.returning returns [] → no row found
    const res = await request(app)
      .patch("/api/plugin-presets/9999")
      .send({ name: "Ghost Preset" });
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when the id is not a number", async () => {
    const res = await request(app)
      .patch("/api/plugin-presets/not-a-number")
      .send({ name: "Whatever" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when name is an empty string", async () => {
    const res = await request(app)
      .patch("/api/plugin-presets/1")
      .send({ name: "" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when params contains non-numeric values", async () => {
    const res = await request(app)
      .patch("/api/plugin-presets/1")
      .send({ params: { speed: "turbo" } });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/plugin-presets/:id
// ---------------------------------------------------------------------------
describe("DELETE /api/plugin-presets/:id", () => {
  beforeEach(resetMocks);

  it("returns 204 with no body on successful deletion", async () => {
    const { db } = await import("@workspace/db");
    vi.mocked(db.returning).mockResolvedValueOnce([mockPreset]);

    const res = await request(app).delete("/api/plugin-presets/1");
    expect(res.status).toBe(204);
    expect(res.text).toBe("");
  });

  it("returns 404 when the preset does not exist", async () => {
    // db.returning returns [] → no row deleted
    const res = await request(app).delete("/api/plugin-presets/9999");
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error");
  });
});
