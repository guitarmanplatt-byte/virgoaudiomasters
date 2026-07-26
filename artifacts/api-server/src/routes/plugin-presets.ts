import { Router, type IRouter } from "express";
import { db, pluginPresetsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { CreatePluginPresetBody, UpdatePluginPresetBody } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/plugin-presets", async (req, res): Promise<void> => {
  const pluginId = typeof req.query.pluginId === "string" ? req.query.pluginId : undefined;
  const rows = pluginId
    ? await db
        .select()
        .from(pluginPresetsTable)
        .where(eq(pluginPresetsTable.pluginId, pluginId))
        .orderBy(desc(pluginPresetsTable.updatedAt))
    : await db.select().from(pluginPresetsTable).orderBy(desc(pluginPresetsTable.updatedAt));
  res.json(rows);
});

router.post("/plugin-presets", async (req, res): Promise<void> => {
  const parsed = CreatePluginPresetBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db.insert(pluginPresetsTable).values(parsed.data).returning();
  res.status(201).json(row);
});

router.patch("/plugin-presets/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const parsed = UpdatePluginPresetBody.safeParse(req.body);
  if (!parsed.success || Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const [row] = await db
    .update(pluginPresetsTable)
    .set(parsed.data)
    .where(eq(pluginPresetsTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Preset not found" });
    return;
  }
  res.json(row);
});

router.delete("/plugin-presets/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [row] = await db
    .delete(pluginPresetsTable)
    .where(eq(pluginPresetsTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Preset not found" });
    return;
  }
  res.status(204).end();
});

export default router;
