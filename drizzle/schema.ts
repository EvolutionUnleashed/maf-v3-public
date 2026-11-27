import { sql } from "drizzle-orm";
import {
  check,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const now = sql`(cast((julianday('now') - 2440587.5) * 86400000 as integer))`;
const createdAt = () =>
  integer("createdAt", { mode: "timestamp_ms" }).default(now).notNull();
const updatedAt = () =>
  integer("updatedAt", { mode: "timestamp_ms" })
    .default(now)
    .$onUpdate(() => new Date())
    .notNull();
const json = (name: string) => text(name, { mode: "json" });

// Workspaces
export const workspaces = sqliteTable("workspaces", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name", { length: 128 }).notNull().unique(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export type Workspace = typeof workspaces.$inferSelect;
export type InsertWorkspace = typeof workspaces.$inferInsert;

// BUILD state
export const buildSections = sqliteTable(
  "build_sections",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    workspaceId: integer("workspaceId")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    sectionKey: text("sectionKey", { length: 32 }).notNull(),
    status: text("status", {
      enum: ["locked", "in_progress", "approved", "amber"],
    })
      .default("locked")
      .notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  table => [
    uniqueIndex("build_sections_workspace_section_unique").on(
      table.workspaceId,
      table.sectionKey,
    ),
    check(
      "build_sections_status_check",
      sql`${table.status} in ('locked', 'in_progress', 'approved', 'amber')`,
    ),
  ],
);

export const buildSubSteps = sqliteTable(
  "build_sub_steps",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    workspaceId: integer("workspaceId")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    sectionKey: text("sectionKey", { length: 32 }).notNull(),
    stepKey: text("stepKey", { length: 32 }).notNull(),
    status: text("status", {
      enum: [
        "locked",
        "in_progress",
        "intake_complete",
        "generating",
        "review",
        "approved",
        "amber",
      ],
    })
      .default("locked")
      .notNull(),
    intakeData: json("intakeData"),
    artifactContent: json("artifactContent"),
    lastFeedback: text("lastFeedback"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  table => [
    uniqueIndex("build_sub_steps_workspace_step_unique").on(
      table.workspaceId,
      table.stepKey,
    ),
    check(
      "build_sub_steps_status_check",
      sql`${table.status} in ('locked', 'in_progress', 'intake_complete', 'generating', 'review', 'approved', 'amber')`,
    ),
  ],
);

// Approved canonical BUILD artifacts
export const buildArtifacts = sqliteTable(
  "build_artifacts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    workspaceId: integer("workspaceId")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    stepKey: text("stepKey", { length: 32 }).notNull(),
    artifactType: text("artifactType", { length: 64 }).notNull(),
    content: json("content").notNull(),
    version: integer("version").default(1).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  table => [
    uniqueIndex("build_artifacts_workspace_step_unique").on(
      table.workspaceId,
      table.stepKey,
    ),
  ],
);

// Visual identity
export const visualIdentity = sqliteTable(
  "visual_identity",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    workspaceId: integer("workspaceId")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    tournamentRound: integer("tournamentRound").default(1).notNull(),
    candidateSets: json("candidateSets"),
    selectedSetIndex: integer("selectedSetIndex"),
    styleDocument: json("styleDocument"),
    status: text("status", {
      enum: [
        "pending",
        "round1",
        "round2",
        "escape",
        "selected",
        "approved",
        "skipped",
      ],
    })
      .default("pending")
      .notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  table => [
    uniqueIndex("visual_identity_workspace_unique").on(table.workspaceId),
    check(
      "visual_identity_status_check",
      sql`${table.status} in ('pending', 'round1', 'round2', 'escape', 'selected', 'approved', 'skipped')`,
    ),
  ],
);

// CREATE outputs
export const createOutputs = sqliteTable(
  "create_outputs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    workspaceId: integer("workspaceId")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    parentId: integer("parentId"),
    platform: text("platform", { length: 32 }).notNull(),
    contentType: text("contentType", { length: 32 }).notNull(),
    pillar: text("pillar", { length: 128 }),
    angle: text("angle", { length: 64 }),
    direction: json("direction"),
    content: json("content").notNull(),
    imageUrl: text("imageUrl"),
    imageFormat: json("imageFormat"),
    status: text("status", {
      enum: ["draft", "approved", "published", "archived"],
    })
      .default("draft")
      .notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  table => [
    check(
      "create_outputs_status_check",
      sql`${table.status} in ('draft', 'approved', 'published', 'archived')`,
    ),
  ],
);

// File uploads (metadata only)
export const fileUploads = sqliteTable("file_uploads", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  workspaceId: integer("workspaceId")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  stepKey: text("stepKey", { length: 32 }),
  fileName: text("fileName", { length: 256 }).notNull(),
  fileType: text("fileType", { length: 32 }).notNull(),
  tokenCount: integer("tokenCount").default(0),
  extractedText: text("extractedText"),
  storageKey: text("storageKey", { length: 256 }),
  createdAt: createdAt(),
});

// Content engine config, auto-compiled from BUILD
export const contentEngineConfig = sqliteTable(
  "content_engine_config",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    workspaceId: integer("workspaceId")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    configData: json("configData").notNull(),
    platformFit: json("platformFit"),
    contentPillars: json("contentPillars"),
    contentTypeMix: json("contentTypeMix"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  table => [
    uniqueIndex("content_engine_config_workspace_unique").on(table.workspaceId),
  ],
);
