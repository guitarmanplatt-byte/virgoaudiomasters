import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import rateLimit from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import Redis from "ioredis";
import { v4 as uuidv4 } from "uuid";
import path from "path";
import fs from "fs";
import { db, audioProjectsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Upload timeout guard
// Default: 5 minutes. Override with UPLOAD_TIMEOUT_MS environment variable.
//
// Uses a true wall-clock setTimeout (not req.setTimeout / socket idle timeout).
// req.setTimeout only fires when the socket is *idle*; a trickle client that
// sends tiny bytes periodically can reset an idle timer indefinitely. A
// wall-clock timer fires unconditionally after the configured duration,
// regardless of how much data has arrived.
// ---------------------------------------------------------------------------
function withUploadTimeout(req: Request, res: Response, next: NextFunction): void {
  // Read the env var at request time so tests can override it without
  // reloading the module.
  const ms = parseInt(process.env["UPLOAD_TIMEOUT_MS"] ?? "300000", 10);

  const timer = setTimeout(() => {
    if (!res.headersSent) {
      res.status(408).json({ error: "Upload timeout: the request took too long. Please try again." });
    }
    // Forcibly close the socket so the trickle client is evicted.
    req.socket?.destroy();
  }, ms);

  // Clear the deadline if the response finishes before the timer fires.
  res.on("finish", () => clearTimeout(timer));
  res.on("close", () => clearTimeout(timer));

  next();
}

// ---------------------------------------------------------------------------
// Upload rate limiter
// Default: 10 requests per minute per IP. Override with UPLOAD_RATE_LIMIT_PER_MINUTE.
//
// When REDIS_URL is set the limiter uses a RedisStore so that counters are
// shared across all server replicas (accurate horizontal scaling).
// When REDIS_URL is absent (local dev / single-instance) the default
// MemoryStore is used automatically — no extra config needed.
//
// Returns { middleware, disconnect } so the caller can close the Redis
// connection cleanly on graceful shutdown (SIGTERM / SIGINT).  When no Redis
// client was created, disconnect() is a no-op.
// ---------------------------------------------------------------------------
export interface RateLimiterHandle {
  middleware: ReturnType<typeof rateLimit>;
  disconnect: () => Promise<void>;
}

export function buildUploadRateLimiter(storeOverride?: InstanceType<typeof RedisStore>): RateLimiterHandle {
  const max = parseInt(process.env["UPLOAD_RATE_LIMIT_PER_MINUTE"] ?? "10", 10);
  // UPLOAD_RATE_LIMIT_WINDOW_MS lets tests (and operators) override the default
  // 1-minute window without redeploying. Defaults to 60 000 ms in production.
  const windowMs = parseInt(process.env["UPLOAD_RATE_LIMIT_WINDOW_MS"] ?? "60000", 10);

  let redisClient: InstanceType<typeof Redis> | undefined;

  const store: InstanceType<typeof RedisStore> | undefined = storeOverride ?? (() => {
    const redisUrl = process.env["REDIS_URL"];
    if (!redisUrl) return undefined;
    redisClient = new Redis(redisUrl);

    // Attach an error listener so that a dropped connection (network blip,
    // Redis restart) doesn't emit an unhandled 'error' event and crash the
    // process.  The per-command error paths in sendCommand below handle the
    // individual request failures independently.
    redisClient.on("error", (err: Error) => {
      console.error("[rate-limiter] Redis connection error:", err.message);
    });

    return new RedisStore({
      sendCommand: async (...args: string[]): Promise<number> => {
        try {
          return await (redisClient!.call(...(args as [string, ...string[]])) as Promise<number>);
        } catch (err) {
          // Log and rethrow so express-rate-limit propagates the error to
          // Express's error-handling middleware, which returns a defined 500
          // response instead of leaving the request hanging or crashing the
          // process.
          console.error("[rate-limiter] Redis command failed mid-request:", (err as Error).message);
          throw err;
        }
      },
    });
  })();

  const middleware = rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many upload requests from this IP, please try again later." },
    ...(store ? { store } : {}),
  });

  const disconnect = async (): Promise<void> => {
    if (redisClient) {
      await redisClient.quit();
    }
  };

  return { middleware, disconnect };
}

const { middleware: uploadRateLimiter, disconnect: disconnectRateLimiter } = buildUploadRateLimiter();

// Register graceful-shutdown handlers so the Redis connection is closed cleanly
// when the process receives SIGTERM or SIGINT.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    disconnectRateLimiter().catch((err) => {
      console.error("[rate-limiter] error during Redis disconnect on", signal, err);
    });
  });
}

const router: IRouter = Router();

// Ensure uploads directory exists
const UPLOADS_DIR = path.join(process.cwd(), "uploads");
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  },
});

const AUDIO_EXTENSIONS = /\.(mp3|wav|ogg|flac|aac|m4a|mp4|aif|aiff|wma|opus|webm)$/i;
const AUDIO_MIMETYPES = new Set([
  "audio/mpeg", "audio/mp3", "audio/wav", "audio/wave", "audio/x-wav",
  "audio/ogg", "audio/flac", "audio/x-flac", "audio/aac", "audio/mp4",
  "audio/m4a", "audio/x-m4a", "audio/aiff", "audio/x-aiff",
  "audio/opus", "audio/webm", "video/mp4", "video/webm",
  // Browsers sometimes report these generic types for local audio files
  "application/octet-stream", "application/x-audio",
]);

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // 2 GB
  fileFilter: (_req, file, cb) => {
    const byMime = AUDIO_MIMETYPES.has(file.mimetype);
    const byExt = AUDIO_EXTENSIONS.test(file.originalname);
    if (byMime || byExt) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype} (${file.originalname})`));
    }
  },
});

const defaultEnhancementSettings = {
  eqPresetId: null,
  stereoWidth: 1.0,
  clarityAmount: 0.0,
  humReduction: false,
  humFrequency: null,
  noiseReduction: 0.0,
  sibilanceReduction: 0.0,
  clipRepair: false,
  preRingFix: false,
  enabled: false,
};

const defaultMasteringSettings = {
  genreId: null,
  compressionAmount: 0.5,
  dynamicEqAmount: 0.5,
  exciterAmount: 0.3,
  targetLufs: -14,
  enabled: false,
};

// POST /audio/upload
// Uses multer as a standard Express middleware — Express 5 catches any async throws automatically.
// A dedicated error-handler below converts multer errors (bad MIME type, size limit, etc.) to JSON.
// withUploadTimeout must come first so the socket deadline is set before multer
// begins reading the request body.
router.post(
  "/audio/upload",
  uploadRateLimiter,
  withUploadTimeout,
  upload.single("audio"),
  async (req: Request, res: Response): Promise<void> => {
    if (!req.file) {
      res.status(400).json({ error: "No audio file provided — make sure the FormData field is named 'audio'" });
      return;
    }

    const id = uuidv4();
    const fileUrl = `/api/audio/file/${req.file.filename}`;
    const name = path.basename(req.file.originalname, path.extname(req.file.originalname));

    const [project] = await db
      .insert(audioProjectsTable)
      .values({
        id,
        name,
        originalFilename: req.file.originalname,
        fileUrl,
        status: "ready",
        enhancementSettings: defaultEnhancementSettings,
        masteringSettings: defaultMasteringSettings,
      })
      .returning();

    res.status(201).json({ ...project, createdAt: project.createdAt.toISOString() });
  }
);

// Multer error handler — must have 4 parameters for Express to treat it as an error middleware.
// Catches file-type rejections, size-limit errors, and any other multer throws.
router.use("/audio/upload", (err: Error, _req: Request, res: Response, _next: NextFunction): void => {
  console.error("[upload] multer error:", err.message);
  res.status(400).json({ error: err.message });
});

// Serve uploaded files
router.get("/audio/file/:filename", (req, res): void => {
  const raw = Array.isArray(req.params.filename) ? req.params.filename[0] : req.params.filename;
  // Sanitize: only allow safe filenames (uuid + extension)
  if (!raw || !/^[a-f0-9\-]+\.[a-z0-9]+$/i.test(raw)) {
    res.status(400).json({ error: "Invalid filename" });
    return;
  }
  const filePath = path.join(UPLOADS_DIR, raw);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: "File not found" });
    return;
  }
  res.sendFile(filePath);
});

// GET /audio
router.get("/audio", async (_req, res): Promise<void> => {
  const projects = await db
    .select()
    .from(audioProjectsTable)
    .orderBy(audioProjectsTable.createdAt);

  res.json(
    projects.map((p) => ({
      ...p,
      createdAt: p.createdAt.toISOString(),
    }))
  );
});

// GET /audio/:id
router.get("/audio/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  const [project] = await db
    .select()
    .from(audioProjectsTable)
    .where(eq(audioProjectsTable.id, raw));

  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  res.json({ ...project, createdAt: project.createdAt.toISOString() });
});

// PATCH /audio/:id/name
router.patch("/audio/:id/name", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const { name } = req.body as { name?: string };

  if (!name || typeof name !== "string") {
    res.status(400).json({ error: "name is required" });
    return;
  }

  const [project] = await db
    .update(audioProjectsTable)
    .set({ name })
    .where(eq(audioProjectsTable.id, raw))
    .returning();

  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  res.json({ ...project, createdAt: project.createdAt.toISOString() });
});

// PATCH /audio/:id/enhancement
router.patch("/audio/:id/enhancement", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  const [existing] = await db
    .select()
    .from(audioProjectsTable)
    .where(eq(audioProjectsTable.id, raw));

  if (!existing) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const merged = { ...(existing.enhancementSettings as object), ...req.body };

  const [project] = await db
    .update(audioProjectsTable)
    .set({ enhancementSettings: merged })
    .where(eq(audioProjectsTable.id, raw))
    .returning();

  res.json({ ...project!, createdAt: project!.createdAt.toISOString() });
});

// PATCH /audio/:id/mastering
router.patch("/audio/:id/mastering", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  const [existing] = await db
    .select()
    .from(audioProjectsTable)
    .where(eq(audioProjectsTable.id, raw));

  if (!existing) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const merged = { ...(existing.masteringSettings as object), ...req.body };

  const [project] = await db
    .update(audioProjectsTable)
    .set({ masteringSettings: merged })
    .where(eq(audioProjectsTable.id, raw))
    .returning();

  res.json({ ...project!, createdAt: project!.createdAt.toISOString() });
});

// DELETE /audio/:id
router.delete("/audio/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  const [project] = await db
    .select()
    .from(audioProjectsTable)
    .where(eq(audioProjectsTable.id, raw));

  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  // Delete the physical file
  try {
    const filename = project.fileUrl.split("/").pop();
    if (filename) {
      const filePath = path.join(UPLOADS_DIR, filename);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
  } catch {
    // Non-fatal — file may already be gone
  }

  await db.delete(audioProjectsTable).where(eq(audioProjectsTable.id, raw));

  res.sendStatus(204);
});

export default router;
