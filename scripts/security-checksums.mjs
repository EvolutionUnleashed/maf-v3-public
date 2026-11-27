#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readdir, rename, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import process from "node:process";

const OUTPUT_NAME = "SHA256SUMS";

function fail(message) {
  throw new Error(message);
}

async function collectFiles(root, directory = root) {
  const files = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const absolute = join(directory, entry.name);
    const metadata = await lstat(absolute);
    if (metadata.isSymbolicLink())
      fail(`release tree contains a symbolic link: ${absolute}`);
    if (metadata.isDirectory())
      files.push(...(await collectFiles(root, absolute)));
    else if (
      metadata.isFile() &&
      !(directory === root && entry.name === OUTPUT_NAME)
    )
      files.push(absolute);
    else if (!metadata.isFile())
      fail(`release tree contains a special file: ${absolute}`);
  }
  return files;
}

async function sha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

async function main() {
  if (process.argv.length > 3)
    fail("usage: node scripts/security-checksums.mjs [release-directory]");
  const releaseDirectory = resolve(process.argv[2] ?? "release");
  const files = await collectFiles(releaseDirectory);
  if (files.length === 0)
    fail("release directory contains no files to checksum");

  const paths = files
    .map(absolute => ({
      absolute,
      relative: relative(releaseDirectory, absolute).split(sep).join("/"),
    }))
    .sort((left, right) =>
      left.relative < right.relative
        ? -1
        : left.relative > right.relative
          ? 1
          : 0
    );

  const lines = [];
  for (const file of paths) {
    if (
      !file.relative ||
      file.relative.startsWith("../") ||
      /[\r\n]/.test(file.relative)
    ) {
      fail(`unsafe release path: ${file.relative}`);
    }
    lines.push(`${await sha256(file.absolute)}  ${file.relative}`);
  }

  const output = join(releaseDirectory, OUTPUT_NAME);
  const temporary = `${output}.tmp`;
  await writeFile(temporary, `${lines.join("\n")}\n`, {
    encoding: "utf8",
    mode: 0o644,
  });
  await rename(temporary, output);
  console.log(
    `Wrote SHA-256 checksums for ${lines.length} release artifact(s) to ${output}.`
  );
}

main().catch(error => {
  const message =
    error instanceof Error ? error.message : "unknown checksum failure";
  console.error(`CHECKSUM GENERATION FAILED: ${message}`);
  process.exitCode = 1;
});
