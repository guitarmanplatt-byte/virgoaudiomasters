import { pgTable, text, serial, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const pluginPresetsTable = pgTable("plugin_presets", {
  id: serial("id").primaryKey(),
  pluginId: text("plugin_id").notNull(),
  name: text("name").notNull(),
  params: jsonb("params").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertPluginPresetSchema = createInsertSchema(pluginPresetsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertPluginPreset = z.infer<typeof insertPluginPresetSchema>;
export type PluginPreset = typeof pluginPresetsTable.$inferSelect;
