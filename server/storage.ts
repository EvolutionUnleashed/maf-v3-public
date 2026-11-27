import crypto from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ENV } from "./_core/env";

const MEDIA_DIRECTORY = path.resolve(ENV.dataDir, "media");

function normalizeKey(relKey: string): string {
  if (typeof relKey !== "string" || !relKey.trim()) throw new Error("A media key is required.");
  const normalized = relKey.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  const segments = normalized.split("/");
  if (
    segments.some(segment =>
      !segment || segment === "." || segment === ".." || segment.includes("\0"),
    )
  ) {
    throw new Error("The media key is invalid.");
  }
  return segments.join("/");
}

function appendUniqueSuffix(relKey: string): string {
  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 10);
  const extension = path.posix.extname(relKey);
  return extension
    ? `${relKey.slice(0, -extension.length)}_${suffix}${extension}`
    : `${relKey}_${suffix}`;
}

export function resolveStoragePath(relKey: string): { key: string; absolutePath: string } {
  const key = normalizeKey(relKey);
  const absolutePath = path.resolve(MEDIA_DIRECTORY, ...key.split("/"));
  const relative = path.relative(MEDIA_DIRECTORY, absolutePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("The media key is outside the local media directory.");
  }
  return { key, absolutePath };
}

function publicMediaUrl(key: string): string {
  return `/media/${key.split("/").map(encodeURIComponent).join("/")}`;
}

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  _contentType = "application/octet-stream",
): Promise<{ key: string; url: string }> {
  const uniqueKey = appendUniqueSuffix(normalizeKey(relKey));
  const { key, absolutePath } = resolveStoragePath(uniqueKey);
  await mkdir(path.dirname(absolutePath), { recursive: true, mode: 0o700 });
  await writeFile(absolutePath, data, { mode: 0o600, flag: "wx" });
  return { key, url: publicMediaUrl(key) };
}

export async function storageGet(relKey: string): Promise<{ key: string; url: string }> {
  const { key } = resolveStoragePath(relKey);
  return { key, url: publicMediaUrl(key) };
}

export async function storageGetSignedUrl(relKey: string): Promise<string> {
  return (await storageGet(relKey)).url;
}

export async function storageRead(relKey: string): Promise<Buffer> {
  return readFile(resolveStoragePath(relKey).absolutePath);
}
