import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type DatabaseModule = typeof import("./db");

let dataDir: string;
let databaseModule: DatabaseModule | null = null;
let originalDataDir: string | undefined;
let originalMigrationsDir: string | undefined;

beforeEach(() => {
  originalDataDir = process.env.MAF_DATA_DIR;
  originalMigrationsDir = process.env.MAF_MIGRATIONS_DIR;
  dataDir = mkdtempSync(path.join(os.tmpdir(), "maf-v3-sqlite-"));
  process.env.MAF_DATA_DIR = dataDir;
  process.env.MAF_MIGRATIONS_DIR = path.resolve(process.cwd(), "drizzle");
  vi.resetModules();
});

afterEach(() => {
  databaseModule?.closeDatabase();
  databaseModule = null;
  if (originalDataDir === undefined) delete process.env.MAF_DATA_DIR;
  else process.env.MAF_DATA_DIR = originalDataDir;
  if (originalMigrationsDir === undefined) delete process.env.MAF_MIGRATIONS_DIR;
  else process.env.MAF_MIGRATIONS_DIR = originalMigrationsDir;
  rmSync(dataDir, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.resetModules();
});

async function loadDatabase() {
  databaseModule = await import("./db");
  return databaseModule;
}

describe("embedded SQLite workspace", () => {
  it("creates, migrates, seeds, and reopens one local workspace", async () => {
    const database = await loadDatabase();
    const db = await database.initializeDatabase();
    const databasePath = database.getDatabasePath();

    expect(databasePath).toBe(path.join(dataDir, "maf-v3.sqlite"));
    expect(existsSync(databasePath)).toBe(true);
    expect(db.$client.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(db.$client.pragma("journal_mode", { simple: true })).toBe("wal");
    expect(db.$client.pragma("busy_timeout", { simple: true })).toBe(5_000);

    expect(
      db.$client.prepare("SELECT COUNT(*) AS count FROM workspaces").get(),
    ).toEqual({ count: 1 });
    expect(
      db.$client.prepare("SELECT COUNT(*) AS count FROM build_sections").get(),
    ).toEqual({ count: 4 });
    expect(
      db.$client.prepare("SELECT COUNT(*) AS count FROM build_sub_steps").get(),
    ).toEqual({ count: 10 });
    expect(
      db.$client
        .prepare("SELECT COUNT(*) AS count FROM __drizzle_migrations")
        .get(),
    ).toEqual({ count: 1 });

    database.closeDatabase();
    const reopened = await database.initializeDatabase();
    expect(
      reopened.$client.prepare("SELECT COUNT(*) AS count FROM workspaces").get(),
    ).toEqual({ count: 1 });
    expect(
      reopened.$client
        .prepare("SELECT COUNT(*) AS count FROM build_sub_steps")
        .get(),
    ).toEqual({ count: 10 });
  });

  it("round-trips structured content and returns generated output IDs", async () => {
    const database = await loadDatabase();
    await database.initializeDatabase();
    const workspaceId = await database.resolveWorkspaceId();
    const content = {
      hook: "A useful opening",
      body: ["First point", "Second point"],
      metadata: { reviewed: true },
    };

    const id = await database.createOutput({
      workspaceId,
      platform: "linkedin",
      contentType: "post",
      content,
      direction: { angle: "operator lesson" },
    });

    expect(id).toBeTypeOf("number");
    await expect(database.getOutputById(workspaceId, id!)).resolves.toMatchObject({
      id,
      workspaceId,
      content,
      direction: { angle: "operator lesson" },
      status: "draft",
    });
  });

  it("enforces foreign keys and timestamp updates", async () => {
    const database = await loadDatabase();
    const db = await database.initializeDatabase();
    const inserted = db.$client
      .prepare("INSERT INTO workspaces (name) VALUES (?)")
      .run("Cascade Test");
    const workspaceId = Number(inserted.lastInsertRowid);
    db.$client
      .prepare(
        "INSERT INTO build_sections (workspaceId, sectionKey, status) VALUES (?, ?, ?)",
      )
      .run(workspaceId, "research", "in_progress");

    const before = db.$client
      .prepare("SELECT updatedAt FROM workspaces WHERE id = ?")
      .get(workspaceId) as { updatedAt: number };
    await new Promise(resolve => setTimeout(resolve, 5));
    db.$client
      .prepare("UPDATE workspaces SET name = ? WHERE id = ?")
      .run("Cascade Test Updated", workspaceId);
    const after = db.$client
      .prepare("SELECT updatedAt FROM workspaces WHERE id = ?")
      .get(workspaceId) as { updatedAt: number };
    expect(after.updatedAt).toBeGreaterThan(before.updatedAt);

    db.$client.prepare("DELETE FROM workspaces WHERE id = ?").run(workspaceId);
    expect(
      db.$client
        .prepare(
          "SELECT COUNT(*) AS count FROM build_sections WHERE workspaceId = ?",
        )
        .get(workspaceId),
    ).toEqual({ count: 0 });
  });

  it("reports an unreadable local database without exposing internals", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const database = await loadDatabase();
    await database.initializeDatabase();
    const databasePath = database.getDatabasePath();
    database.closeDatabase();
    writeFileSync(databasePath, "not a sqlite database", { flag: "w" });

    await expect(database.initializeDatabase()).rejects.toBeTruthy();
    const status = await database.getDatabaseSetupStatus();
    expect(status).toMatchObject({ configured: true, ready: false });
    expect(status.message).toContain("damaged or unreadable");
    expect(status.message).not.toContain(databasePath);
    expect(warning).toHaveBeenCalledOnce();
  });
});
