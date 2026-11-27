import { chmodSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { and, desc, eq } from "drizzle-orm";
import {
  drizzle,
  type BetterSQLite3Database,
} from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "../drizzle/schema";
import {
  buildArtifacts,
  buildSections,
  buildSubSteps,
  contentEngineConfig,
  createOutputs,
  fileUploads,
  visualIdentity,
  workspaces,
} from "../drizzle/schema";
import { BUILD_SECTIONS, BUILD_STEPS } from "../shared/maf-constants";
import { ENV } from "./_core/env";

type BuildSectionInsert = typeof buildSections.$inferInsert;
type BuildSubStepInsert = typeof buildSubSteps.$inferInsert;
type CreateOutputInsert = typeof createOutputs.$inferInsert;
type VisualIdentityInsert = typeof visualIdentity.$inferInsert;
type EngineConfigInsert = typeof contentEngineConfig.$inferInsert;

type VisualIdentityUpdate = Partial<
  Omit<VisualIdentityInsert, "id" | "workspaceId" | "createdAt" | "updatedAt">
>;
type EngineConfigUpdate = Partial<
  Omit<EngineConfigInsert, "id" | "workspaceId" | "createdAt" | "updatedAt">
>;

type MafDatabase = BetterSQLite3Database<typeof schema>;

let _db: MafDatabase | null = null;
let _client: Database.Database | null = null;
let _initialization: Promise<MafDatabase> | null = null;

const DATABASE_FILE = "maf-v3.sqlite";
const MIGRATION_JOURNAL = path.join("meta", "_journal.json");

export type DatabaseSetupStatus = {
  configured: boolean;
  ready: boolean;
  message: string;
};

export function getDatabasePath(): string {
  return path.join(ENV.dataDir, DATABASE_FILE);
}

function resolveMigrationsFolder(): string {
  const configured = process.env.MAF_MIGRATIONS_DIR?.trim();
  const candidates = [
    configured ? path.resolve(configured) : null,
    path.resolve(process.cwd(), "drizzle"),
    path.resolve(import.meta.dirname, "../drizzle"),
    path.resolve(import.meta.dirname, "drizzle"),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of Array.from(new Set(candidates))) {
    if (existsSync(path.join(candidate, MIGRATION_JOURNAL))) return candidate;
  }

  throw new Error(
    "Bundled database migrations are missing. Reinstall MAF V3 or set MAF_MIGRATIONS_DIR to the packaged drizzle folder.",
  );
}

function openLocalDatabase(): MafDatabase {
  mkdirSync(ENV.dataDir, { recursive: true, mode: 0o700 });
  const databasePath = getDatabasePath();
  const client = new Database(databasePath, { timeout: 5_000 });

  try {
    client.pragma("foreign_keys = ON");
    client.pragma("busy_timeout = 5000");
    const journalMode = client.pragma("journal_mode = WAL", { simple: true });
    if (String(journalMode).toLowerCase() !== "wal") {
      throw new Error("SQLite WAL journaling could not be enabled.");
    }
    client.pragma("synchronous = NORMAL");

    const db = drizzle(client, { schema });
    migrate(db, { migrationsFolder: resolveMigrationsFolder() });

    if (client.pragma("foreign_keys", { simple: true }) !== 1) {
      throw new Error("SQLite foreign-key enforcement could not be enabled.");
    }

    try {
      chmodSync(databasePath, 0o600);
    } catch {
      // Windows and some managed filesystems do not expose POSIX mode bits.
    }
    _client = client;
    return db;
  } catch (error) {
    client.close();
    throw error;
  }
}

/**
 * Creates, migrates, and seeds the installation-scoped database.
 *
 * This is safe to call from both the server bootstrap and request middleware;
 * every caller shares the same initialization promise.
 */
export async function initializeDatabase(): Promise<MafDatabase> {
  if (_db) return _db;
  if (!_initialization) {
    _initialization = (async () => {
      const db = openLocalDatabase();
      _db = db;
      try {
        const workspaceId = await resolveWorkspaceId();
        await ensureBuildState(workspaceId);
        // A stopped app cannot still have a live generation request. Preserve
        // the previous draft and make interrupted work retryable on restart.
        const interrupted = db.select().from(buildSubSteps)
          .where(eq(buildSubSteps.status, "generating")).all();
        for (const step of interrupted) {
          db.update(buildSubSteps).set({
            status: step.artifactContent ? "review" : step.intakeData ? "intake_complete" : "in_progress",
          }).where(eq(buildSubSteps.id, step.id)).run();
        }
        return db;
      } catch (error) {
        _db = null;
        _client?.close();
        _client = null;
        throw error;
      }
    })();
  }

  try {
    return await _initialization;
  } catch (error) {
    _initialization = null;
    throw error;
  }
}

export async function getDb(): Promise<MafDatabase> {
  return initializeDatabase();
}

/** Closes the local database cleanly for app shutdown and isolated tests. */
export function closeDatabase(): void {
  _client?.close();
  _client = null;
  _db = null;
  _initialization = null;
}

/** Converts driver details into a safe, useful first-run message. */
export function describeDatabaseError(error: unknown): string {
  const candidate = error as { code?: string; message?: string } | null;
  const code = candidate?.code || "";
  const message = candidate?.message?.toLowerCase() || "";
  if (
    code === "SQLITE_CANTOPEN" ||
    code === "EACCES" ||
    code === "EPERM" ||
    message.includes("unable to open database file")
  ) {
    return "MAF V3 could not open its private local data folder. Check folder permissions and available disk space, then restart the app.";
  }
  if (
    code === "SQLITE_CORRUPT" ||
    code === "SQLITE_NOTADB" ||
    message.includes("database disk image is malformed") ||
    message.includes("file is not a database")
  ) {
    return "The local MAF V3 database is damaged or unreadable. Preserve the data folder, then restore a known-good backup.";
  }
  if (code === "SQLITE_FULL" || message.includes("database or disk is full")) {
    return "The drive containing the MAF V3 data folder is full. Free some space, then restart the app.";
  }
  if (
    code === "SQLITE_READONLY" ||
    message.includes("readonly database") ||
    message.includes("read-only database")
  ) {
    return "The MAF V3 data folder is read-only. Restore write access to the folder, then restart the app.";
  }
  if (code === "SQLITE_BUSY" || code === "SQLITE_LOCKED") {
    return "The local MAF V3 database is busy. Close any other running copy of MAF V3, then try again.";
  }
  if (message.includes("bundled database migrations are missing")) {
    return candidate?.message || "Bundled database migrations are missing.";
  }
  if (message.includes("no such table")) {
    return "The local database schema is incomplete. Restart MAF V3 so its bundled migrations can finish.";
  }
  if (message.includes("app_workspace_id")) {
    return candidate?.message || "APP_WORKSPACE_ID does not select a valid workspace.";
  }
  return "Local workspace storage could not be prepared. Restart MAF V3 and check the application log for details.";
}

export async function getDatabaseSetupStatus(): Promise<DatabaseSetupStatus> {
  try {
    await initializeDatabase();
    return {
      configured: true,
      ready: true,
      message: "Private local workspace storage is ready.",
    };
  } catch (error) {
    console.warn("[Database] Local storage initialization failed:", error);
    return {
      configured: true,
      ready: false,
      message: describeDatabaseError(error),
    };
  }
}

function parseWorkspaceId(value: string): number {
  const workspaceId = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(workspaceId) || workspaceId < 1) {
    throw new Error("APP_WORKSPACE_ID must be a positive integer");
  }
  return workspaceId;
}

/**
 * Resolves the local workspace deterministically.
 *
 * APP_WORKSPACE_ID is required only when a database intentionally contains
 * more than one workspace. A fresh install gets a single Local Workspace.
 */
export async function resolveWorkspaceId(): Promise<number> {
  const db = await getDb();

  const configuredId = process.env.APP_WORKSPACE_ID?.trim();
  if (configuredId) {
    const workspaceId = parseWorkspaceId(configuredId);
    const [workspace] = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1);

    if (!workspace) {
      throw new Error(`APP_WORKSPACE_ID=${workspaceId} does not match an existing workspace`);
    }

    return workspace.id;
  }

  const existing = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .orderBy(workspaces.id)
    .limit(2);

  if (existing.length === 1) {
    return existing[0].id;
  }

  if (existing.length > 1) {
    throw new Error(
      "Multiple workspaces exist. Set APP_WORKSPACE_ID to select the workspace for this installation",
    );
  }

  await db
    .insert(workspaces)
    .values({ name: "Local Workspace" })
    .onConflictDoNothing({ target: workspaces.name });

  const [created] = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.name, "Local Workspace"))
    .limit(1);

  if (!created || !Number.isSafeInteger(created.id) || created.id < 1) {
    throw new Error("Failed to create the Local Workspace");
  }

  return created.id;
}

/**
 * Creates any missing BUILD sections and steps without changing existing state.
 * Unique indexes make repeated and concurrent calls safe.
 */
export async function ensureBuildState(workspaceId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const existingSections = new Set(
    (
      await db
        .select({ sectionKey: buildSections.sectionKey })
        .from(buildSections)
        .where(eq(buildSections.workspaceId, workspaceId))
    ).map(section => section.sectionKey),
  );
  const existingSteps = new Set(
    (
      await db
        .select({ stepKey: buildSubSteps.stepKey })
        .from(buildSubSteps)
        .where(eq(buildSubSteps.workspaceId, workspaceId))
    ).map(step => step.stepKey),
  );

  for (const sectionKey of BUILD_SECTIONS) {
    if (!existingSections.has(sectionKey)) {
      await db
        .insert(buildSections)
        .values({
          workspaceId,
          sectionKey,
          status: sectionKey === "research" ? "in_progress" : "locked",
        })
        .onConflictDoNothing({
          target: [buildSections.workspaceId, buildSections.sectionKey],
        });
    }

    for (const step of BUILD_STEPS[sectionKey]) {
      if (!existingSteps.has(step.key)) {
        await db
          .insert(buildSubSteps)
          .values({
            workspaceId,
            sectionKey,
            stepKey: step.key,
            status: sectionKey === "research" ? "in_progress" : "locked",
          })
          .onConflictDoNothing({
            target: [buildSubSteps.workspaceId, buildSubSteps.stepKey],
          });
      }
    }
  }
}

// Kept as a compatibility alias while callers move to the clearer name.
export const initBuildState = ensureBuildState;

export async function getBuildState(workspaceId: number) {
  const db = await getDb();
  if (!db) return { sections: [], subSteps: [] };

  await ensureBuildState(workspaceId);

  const sections = await db
    .select()
    .from(buildSections)
    .where(eq(buildSections.workspaceId, workspaceId));
  const subSteps = await db
    .select()
    .from(buildSubSteps)
    .where(eq(buildSubSteps.workspaceId, workspaceId));

  // Reconcile both fresh and previously saved workspaces. Section summaries
  // must never say approved while a constituent step still needs review.
  db.transaction(tx => {
    for (let index = 0; index < BUILD_SECTIONS.length; index++) {
      const sectionKey = BUILD_SECTIONS[index];
      const section = sections.find(item => item.sectionKey === sectionKey);
      if (!section) continue;
      const steps = BUILD_STEPS[sectionKey].map(config =>
        subSteps.find(item => item.stepKey === config.key)!,
      );
      const available = index === 0 || section.status !== "locked"
        || sections.find(item => item.sectionKey === BUILD_SECTIONS[index - 1])?.status === "approved";
      if (available) {
        for (let stepIndex = 0; stepIndex < steps.length; stepIndex++) {
          const step = steps[stepIndex];
          const unlocked = sectionKey === "research" || step.stepKey === "3c"
            || stepIndex === 0 || steps[stepIndex - 1].status === "approved";
          if (step.status === "locked" && unlocked) {
            step.status = "in_progress";
            tx.update(buildSubSteps).set({ status: step.status })
              .where(eq(buildSubSteps.id, step.id)).run();
          }
        }
      }
      const status = steps.every(step => step.status === "approved") ? "approved"
        : steps.some(step => step.status === "amber") ? "amber"
        : available ? "in_progress" : "locked";
      if (section.status !== status) {
        section.status = status;
        tx.update(buildSections).set({ status }).where(eq(buildSections.id, section.id)).run();
      }
    }
  });
  return { sections, subSteps };
}

export async function updateSubStepStatus(
  workspaceId: number,
  stepKey: string,
  status: string,
  data?: {
    intakeData?: unknown;
    artifactContent?: unknown;
    lastFeedback?: string;
  },
) {
  const db = await getDb();
  if (!db) return;

  const updateData: Partial<BuildSubStepInsert> = {
    status: status as NonNullable<BuildSubStepInsert["status"]>,
  };
  if (data?.intakeData !== undefined) updateData.intakeData = data.intakeData;
  if (data?.artifactContent !== undefined) updateData.artifactContent = data.artifactContent;
  if (data?.lastFeedback !== undefined) updateData.lastFeedback = data.lastFeedback;

  await db
    .update(buildSubSteps)
    .set(updateData)
    .where(
      and(
        eq(buildSubSteps.workspaceId, workspaceId),
        eq(buildSubSteps.stepKey, stepKey),
      ),
    );
}

export async function updateSectionStatus(
  workspaceId: number,
  sectionKey: string,
  status: string,
) {
  const db = await getDb();
  if (!db) return;

  await db
    .update(buildSections)
    .set({ status: status as NonNullable<BuildSectionInsert["status"]> })
    .where(
      and(
        eq(buildSections.workspaceId, workspaceId),
        eq(buildSections.sectionKey, sectionKey),
      ),
    );
}

export async function getSubStep(workspaceId: number, stepKey: string) {
  const db = await getDb();
  if (!db) return null;

  const [step] = await db
    .select()
    .from(buildSubSteps)
    .where(
      and(
        eq(buildSubSteps.workspaceId, workspaceId),
        eq(buildSubSteps.stepKey, stepKey),
      ),
    )
    .limit(1);
  return step ?? null;
}

export async function saveArtifact(
  workspaceId: number,
  stepKey: string,
  artifactType: string,
  content: unknown,
) {
  const db = await getDb();
  if (!db) return;

  const [existing] = await db
    .select()
    .from(buildArtifacts)
    .where(
      and(
        eq(buildArtifacts.workspaceId, workspaceId),
        eq(buildArtifacts.stepKey, stepKey),
      ),
    )
    .limit(1);

  if (existing) {
    await db
      .update(buildArtifacts)
      .set({ artifactType, content, version: (existing.version || 1) + 1 })
      .where(
        and(
          eq(buildArtifacts.workspaceId, workspaceId),
          eq(buildArtifacts.id, existing.id),
        ),
      );
    return;
  }

  await db
    .insert(buildArtifacts)
    .values({ workspaceId, stepKey, artifactType, content });
}

export async function getAllArtifacts(workspaceId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(buildArtifacts)
    .where(eq(buildArtifacts.workspaceId, workspaceId));
}

export async function getVisualIdentity(workspaceId: number) {
  const db = await getDb();
  if (!db) return null;

  const [identity] = await db
    .select()
    .from(visualIdentity)
    .where(eq(visualIdentity.workspaceId, workspaceId))
    .limit(1);
  return identity ?? null;
}

export async function upsertVisualIdentity(workspaceId: number, data: unknown) {
  const db = await getDb();
  if (!db) return;

  const values = data as VisualIdentityUpdate;
  const existing = await getVisualIdentity(workspaceId);
  if (existing) {
    await db
      .update(visualIdentity)
      .set(values)
      .where(
        and(
          eq(visualIdentity.workspaceId, workspaceId),
          eq(visualIdentity.id, existing.id),
        ),
      );
    return;
  }

  await db.insert(visualIdentity).values({ ...values, workspaceId });
}

export async function createOutput(data: {
  workspaceId: number;
  platform: string;
  contentType: string;
  pillar?: string;
  angle?: string;
  direction?: unknown;
  content: unknown;
  imageUrl?: string;
  imageFormat?: unknown;
  parentId?: number;
}): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;

  const [created] = await db
    .insert(createOutputs)
    .values({ ...data, status: "draft" })
    .returning({ id: createOutputs.id });
  return created?.id ?? null;
}

export async function getOutputs(
  workspaceId: number,
  filters?: {
    platform?: string;
    contentType?: string;
    status?: string;
    limit?: number;
    offset?: number;
  },
) {
  const db = await getDb();
  if (!db) return [];

  const conditions = [eq(createOutputs.workspaceId, workspaceId)];
  if (filters?.platform) {
    conditions.push(eq(createOutputs.platform, filters.platform));
  }
  if (filters?.contentType) {
    conditions.push(eq(createOutputs.contentType, filters.contentType));
  }
  if (filters?.status) {
    conditions.push(
      eq(
        createOutputs.status,
        filters.status as NonNullable<CreateOutputInsert["status"]>,
      ),
    );
  }

  return db
    .select()
    .from(createOutputs)
    .where(and(...conditions))
    .orderBy(desc(createOutputs.createdAt), desc(createOutputs.id))
    .limit(filters?.limit ?? 50)
    .offset(filters?.offset ?? 0);
}

export async function getOutputById(workspaceId: number, id: number) {
  const db = await getDb();
  if (!db) return null;

  const [output] = await db
    .select()
    .from(createOutputs)
    .where(
      and(eq(createOutputs.workspaceId, workspaceId), eq(createOutputs.id, id)),
    )
    .limit(1);
  return output ?? null;
}

export async function updateOutput(
  workspaceId: number,
  id: number,
  data: Partial<CreateOutputInsert>,
) {
  const db = await getDb();
  if (!db) return;

  const { id: _ignoredId, workspaceId: _ignoredWorkspaceId, ...safeData } = data;
  await db
    .update(createOutputs)
    .set(safeData)
    .where(
      and(eq(createOutputs.workspaceId, workspaceId), eq(createOutputs.id, id)),
    );
}

export async function getEngineConfig(workspaceId: number) {
  const db = await getDb();
  if (!db) return null;

  const [config] = await db
    .select()
    .from(contentEngineConfig)
    .where(eq(contentEngineConfig.workspaceId, workspaceId))
    .limit(1);
  return config ?? null;
}

export async function upsertEngineConfig(workspaceId: number, data: unknown) {
  const db = await getDb();
  if (!db) return;

  const values = data as EngineConfigUpdate;
  const existing = await getEngineConfig(workspaceId);
  if (existing) {
    await db
      .update(contentEngineConfig)
      .set(values)
      .where(
        and(
          eq(contentEngineConfig.workspaceId, workspaceId),
          eq(contentEngineConfig.id, existing.id),
        ),
      );
    return;
  }

  await db.insert(contentEngineConfig).values({
    ...values,
    workspaceId,
    configData: values.configData ?? {},
  });
}

export async function saveFileUpload(data: {
  workspaceId: number;
  stepKey?: string;
  fileName: string;
  fileType: string;
  tokenCount?: number;
  extractedText?: string;
  storageKey?: string;
}) {
  const db = await getDb();
  if (!db) return null;
  return db.insert(fileUploads).values(data);
}

export async function getFileUploadsForWorkspace(
  workspaceId: number,
  stepKey?: string,
) {
  const db = await getDb();
  if (!db) return [];

  if (stepKey) {
    return db
      .select()
      .from(fileUploads)
      .where(
        and(
          eq(fileUploads.workspaceId, workspaceId),
          eq(fileUploads.stepKey, stepKey),
        ),
      );
  }

  return db
    .select()
    .from(fileUploads)
    .where(eq(fileUploads.workspaceId, workspaceId));
}

export async function saveIntakeDraft(
  workspaceId: number,
  stepKey: string,
  intakeData: unknown,
) {
  const db = await getDb();
  if (!db) return;

  await db
    .update(buildSubSteps)
    .set({ intakeData })
    .where(
      and(
        eq(buildSubSteps.workspaceId, workspaceId),
        eq(buildSubSteps.stepKey, stepKey),
      ),
    );
}
