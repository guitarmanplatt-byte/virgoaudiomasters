/**
 * Smoke tests for the API server.
 * These run against the Express app in-process (no live database needed for
 * static-data routes; the DB is mocked for plugin-presets and audio routes).
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import http from "http";
import request from "supertest";
import fs from "fs";

// ---------------------------------------------------------------------------
// Mock the DB workspace package before importing the app so routes don't
// attempt a real Postgres connection during tests.
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
// Audio upload (DB and filesystem mocked)
// ---------------------------------------------------------------------------
describe("POST /api/audio/upload", () => {
  // A minimal valid WAV header — enough for multer's extension/mime check.
  // The route only inspects the file object (originalname, mimetype) and then
  // inserts to the DB; it never parses audio content itself.
  const wavBuffer = Buffer.from("RIFF....WAVEfmt ", "ascii");

  // Shared mock project returned by db.insert().values().returning()
  const mockProject = {
    id: "upload-test-id",
    name: "test-audio",
    originalFilename: "test-audio.wav",
    fileUrl: "/api/audio/file/some-uuid.wav",
    status: "ready",
    enhancementSettings: {},
    masteringSettings: {},
    createdAt: new Date("2024-01-01T00:00:00Z"),
  };

  beforeEach(async () => {
    // Reset all mock call counts between tests
    const { db } = await import("@workspace/db");
    vi.mocked(db.returning).mockReset().mockResolvedValue([]);
  });

  it("returns 201 with the created project on a valid audio file", async () => {
    const { db } = await import("@workspace/db");
    // Make the DB insert return a project for this test only
    vi.mocked(db.returning).mockResolvedValueOnce([mockProject]);

    const res = await request(app)
      .post("/api/audio/upload")
      .attach("audio", wavBuffer, { filename: "test-audio.wav", contentType: "audio/wav" });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty("id", mockProject.id);
    expect(res.body).toHaveProperty("name", mockProject.name);
    expect(res.body).toHaveProperty("fileUrl");
    expect(res.body).toHaveProperty("status", "ready");
    // createdAt should be serialised as an ISO string
    expect(typeof res.body.createdAt).toBe("string");
  });

  it("returns 400 when no file is attached", async () => {
    const res = await request(app).post("/api/audio/upload");
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 for a non-audio file type", async () => {
    const textBuffer = Buffer.from("hello world");
    const res = await request(app)
      .post("/api/audio/upload")
      .attach("audio", textBuffer, { filename: "notes.txt", contentType: "text/plain" });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });
});

// ---------------------------------------------------------------------------
// Audio delete (DB and filesystem mocked)
// ---------------------------------------------------------------------------
describe("DELETE /api/audio/:id", () => {
  const mockProject = {
    id: "delete-test-id",
    name: "to-be-deleted",
    originalFilename: "to-be-deleted.wav",
    fileUrl: "/api/audio/file/some-uuid.wav",
    status: "ready",
    enhancementSettings: {},
    masteringSettings: {},
    createdAt: new Date("2024-01-01T00:00:00Z"),
  };

  let existsSpy: ReturnType<typeof vi.spyOn>;
  let unlinkSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    // Prevent actual filesystem access during delete tests
    existsSpy = vi.spyOn(fs, "existsSync").mockReturnValue(false);
    unlinkSpy = vi.spyOn(fs, "unlinkSync").mockImplementation(() => undefined);

    // Reset the where mock so each test controls the DB response independently
    const { db } = await import("@workspace/db");
    vi.mocked(db.where).mockReset().mockReturnThis();
  });

  afterEach(() => {
    existsSpy.mockRestore();
    unlinkSpy.mockRestore();
  });

  it("returns 204 when the project exists", async () => {
    const { db } = await import("@workspace/db");
    // First where() call (SELECT to find the project) resolves to [mockProject]
    vi.mocked(db.where).mockReturnValueOnce(
      Promise.resolve([mockProject]) as unknown as ReturnType<typeof db.where>,
    );
    // Subsequent where() calls (DELETE statement) fall back to default (mockReturnThis)

    const res = await request(app).delete(`/api/audio/${mockProject.id}`);
    expect(res.status).toBe(204);
  });

  it("returns 404 when the project does not exist", async () => {
    const { db } = await import("@workspace/db");
    // where() resolves to an empty array — project not found
    vi.mocked(db.where).mockReturnValueOnce(
      Promise.resolve([]) as unknown as ReturnType<typeof db.where>,
    );

    const res = await request(app).delete("/api/audio/nonexistent-id");
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error");
  });
});

// ---------------------------------------------------------------------------
// Upload wall-clock timeout (real TCP server — supertest cannot control chunk timing)
// ---------------------------------------------------------------------------
describe("POST /api/audio/upload — wall-clock timeout", () => {
  it("returns 408 when a trickle upload exceeds the deadline", async () => {
    // Use a tiny timeout so this test completes quickly.
    process.env["UPLOAD_TIMEOUT_MS"] = "300";

    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as { port: number };

    try {
      const statusCode = await new Promise<number>((resolve, reject) => {
        const boundary = "----ViTestBoundary";
        // Multipart preamble — tells the server a file upload is starting.
        const preamble = `--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="slow.wav"\r\nContent-Type: audio/wav\r\n\r\n`;

        const req = http.request(
          {
            hostname: "127.0.0.1",
            port,
            method: "POST",
            path: "/api/audio/upload",
            headers: {
              "Content-Type": `multipart/form-data; boundary=${boundary}`,
              "Transfer-Encoding": "chunked",
            },
          },
          (res) => {
            resolve(res.statusCode ?? 0);
            res.resume(); // drain so the socket can close
          },
        );

        req.on("error", (err) => {
          // Socket destroyed by the server — treat as a completed timeout.
          if ((err as NodeJS.ErrnoException).code === "ECONNRESET") {
            resolve(408);
          } else {
            reject(err);
          }
        });

        // Send the preamble immediately, then stall for 500 ms (> 300 ms deadline).
        // A real trickle client would periodically drip tiny bytes; this simulates
        // the worst case where no additional bytes arrive before the deadline.
        req.write(preamble);
        setTimeout(() => {
          // This fires after the server should have already timed out.
          // The write/end may fail if the socket is already destroyed — that's fine.
          try {
            req.write(Buffer.alloc(4, 0));
            req.end(`\r\n--${boundary}--\r\n`);
          } catch {
            /* socket already gone */
          }
        }, 500);
      });

      expect(statusCode).toBe(408);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      delete process.env["UPLOAD_TIMEOUT_MS"];
    }
  }, 10_000); // generous real-time budget
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
