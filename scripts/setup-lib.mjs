import { chmodSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsFolder = path.join(root, "drizzle");

export const REQUIRED_TABLES = [
  "build_artifacts",
  "build_sections",
  "build_sub_steps",
  "content_engine_config",
  "create_outputs",
  "file_uploads",
  "visual_identity",
  "workspaces",
];

export function assertSupportedNode() {
  const [major, minor] = process.versions.node.split(".").map(Number);
  const supported =
    (major === 20 && minor >= 19) ||
    (major === 22 && minor >= 12) ||
    major >= 23;
  if (!supported) {
    throw new Error(
      `Node.js 20.19+ within the 20.x line, or Node.js 22.12+, is required. Found ${process.versions.node}.`,
    );
  }
}

export function dataDirectory() {
  return path.resolve(
    process.env.MAF_DATA_DIR?.trim() || path.join(root, "data"),
  );
}

export function databaseFile() {
  return path.join(dataDirectory(), "maf-v3.sqlite");
}

export function friendlyDatabaseError(error) {
  const code = error?.code || "";
  const message = String(error?.message || "").toLowerCase();
  if (
    code === "SQLITE_CANTOPEN" ||
    code === "EACCES" ||
    code === "EPERM" ||
    message.includes("unable to open database file")
  ) {
    return "The private local data folder could not be opened. Check its permissions and available disk space.";
  }
  if (
    code === "SQLITE_CORRUPT" ||
    code === "SQLITE_NOTADB" ||
    message.includes("database disk image is malformed") ||
    message.includes("file is not a database")
  ) {
    return "The local MAF V3 database is damaged or is not a SQLite database. Preserve it before restoring a backup.";
  }
  if (code === "SQLITE_FULL") {
    return "The drive containing the MAF V3 data folder is full.";
  }
  if (code === "SQLITE_READONLY") {
    return "The MAF V3 data folder is read-only.";
  }
  if (code === "SQLITE_BUSY" || code === "SQLITE_LOCKED") {
    return "The local database is busy. Close every other running MAF V3 process and try again.";
  }
  return error?.message || "The private local database could not be prepared.";
}

function configureWritableConnection(client) {
  client.pragma("foreign_keys = ON");
  client.pragma("busy_timeout = 5000");
  const journalMode = client.pragma("journal_mode = WAL", { simple: true });
  if (String(journalMode).toLowerCase() !== "wal") {
    throw new Error("SQLite WAL journaling could not be enabled.");
  }
  client.pragma("synchronous = NORMAL");
}

export function openLocalDatabase({ migrateSchema = true } = {}) {
  const directory = dataDirectory();
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const client = new Database(databaseFile(), { timeout: 5_000 });

  try {
    configureWritableConnection(client);
    if (migrateSchema) {
      if (!existsSync(path.join(migrationsFolder, "meta", "_journal.json"))) {
        throw new Error("Bundled SQLite migrations are missing.");
      }
      migrate(drizzle(client), { migrationsFolder });
    }
    try {
      chmodSync(databaseFile(), 0o600);
    } catch {
      // Windows and some managed filesystems do not expose POSIX mode bits.
    }
    return client;
  } catch (error) {
    client.close();
    const friendly = new Error(friendlyDatabaseError(error));
    friendly.cause = error;
    throw friendly;
  }
}

export function openExistingDatabase() {
  try {
    const client = new Database(databaseFile(), {
      readonly: true,
      fileMustExist: true,
      timeout: 5_000,
    });
    client.pragma("foreign_keys = ON");
    client.pragma("busy_timeout = 5000");
    return client;
  } catch (error) {
    const friendly = new Error(friendlyDatabaseError(error));
    friendly.cause = error;
    throw friendly;
  }
}

export function existingTables(client) {
  const rows = client
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    )
    .all();
  return new Set(rows.map(row => String(row.name)));
}

export function verifyLocalDatabase(client) {
  const integrity = client.pragma("quick_check");
  if (
    integrity.length !== 1 ||
    String(integrity[0]?.quick_check || "").toLowerCase() !== "ok"
  ) {
    throw new Error("SQLite quick_check reported a problem with the local database.");
  }

  const tables = existingTables(client);
  const missing = REQUIRED_TABLES.filter(table => !tables.has(table));
  if (missing.length) {
    throw new Error(
      `Database migrations are incomplete. Missing: ${missing.join(", ")}.`,
    );
  }

  const foreignKeys = Number(client.pragma("foreign_keys", { simple: true }));
  if (foreignKeys !== 1) {
    throw new Error("SQLite foreign-key enforcement is not enabled.");
  }
}
