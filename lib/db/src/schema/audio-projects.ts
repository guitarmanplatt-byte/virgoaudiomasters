import { pgTable, text, real, integer, timestamp, jsonb } from "drizzle-orm/pg-core";

export const audioProjectsTable = pgTable("audio_projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  originalFilename: text("original_filename").notNull(),
  fileUrl: text("file_url").notNull(),
  status: text("status").notNull().default("ready"),
  duration: real("duration"),
  sampleRate: integer("sample_rate"),
  enhancementSettings: jsonb("enhancement_settings").notNull(),
  masteringSettings: jsonb("mastering_settings").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type AudioProject = typeof audioProjectsTable.$inferSelect;
export type InsertAudioProject = typeof audioProjectsTable.$inferInsert;
