import { Router, type IRouter } from "express";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import path from "path";
import fs from "fs";
import { db, audioProjectsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

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

const upload = multer({
  storage,
  limits: { fileSize: 200 * 1024 * 1024 }, // 200MB
  fileFilter: (_req, file, cb) => {
    const allowed = [
      "audio/mpeg",
      "audio/mp3",
      "audio/wav",
      "audio/wave",
      "audio/x-wav",
      "audio/ogg",
      "audio/flac",
      "audio/x-flac",
      "audio/aac",
      "audio/mp4",
      "audio/m4a",
      "audio/x-m4a",
      "video/mp4",
    ];
    if (allowed.includes(file.mimetype) || file.originalname.match(/\.(mp3|wav|ogg|flac|aac|m4a|mp4)$/i)) {
      cb(null, true);
    } else {
      cb(new Error("Only audio files are allowed"));
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
router.post("/audio/upload", upload.single("audio"), async (req, res): Promise<void> => {
  if (!req.file) {
    res.status(400).json({ error: "No audio file provided" });
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

  res.status(201).json(project);
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
