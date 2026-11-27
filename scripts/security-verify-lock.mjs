#!/usr/bin/env node

/**
 * Fail-closed pnpm lockfile verifier.
 *
 * This intentionally runs with only Node.js, before dependency installation.
 * It validates every npm package version in pnpm-lock.yaml against the public
 * npm registry's publication time and immutable distribution metadata.
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const REGISTRY_ORIGIN = "https://registry.npmjs.org";
const MINIMUM_RELEASE_AGE_MINUTES = 10_080;
const MINIMUM_RELEASE_AGE_MS = MINIMUM_RELEASE_AGE_MINUTES * 60_000;
const FETCH_TIMEOUT_MS = 30_000;
const FETCH_ATTEMPTS = 3;
const FETCH_CONCURRENCY = 8;
const MAX_PACKUMENT_BYTES = 64 * 1024 * 1024;
const SEMVER =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/i;
const SHA512_INTEGRITY = /^sha512-[A-Za-z0-9+/]+={0,2}$/;
const REPORT_ARGUMENT = "--report";

function fail(message) {
  throw new Error(message);
}

function decodeYamlScalar(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replaceAll("''", "'");
  }
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      fail("lockfile contains an invalid quoted package key");
    }
  }
  return trimmed;
}

function splitPackageKey(packageKey) {
  if (
    /^(?:file|link|workspace|git|github|gitlab|bitbucket|https?|ssh):/i.test(
      packageKey
    ) ||
    packageKey.includes("://")
  ) {
    fail(`non-registry package source is forbidden: ${packageKey}`);
  }

  const separator = packageKey.lastIndexOf("@");
  if (separator <= 0 || separator === packageKey.length - 1) {
    fail(`cannot identify an exact package version: ${packageKey}`);
  }

  const name = packageKey.slice(0, separator);
  const version = packageKey.slice(separator + 1);
  if (!PACKAGE_NAME.test(name) || name.length > 214) {
    fail(`invalid npm package name in lockfile: ${packageKey}`);
  }
  if (!SEMVER.test(version)) {
    fail(`package is not locked to an exact semver version: ${packageKey}`);
  }
  return { name, version };
}

function parseResolution(block, packageKey) {
  const resolutionLine = block
    .split(/\r?\n/)
    .find(line => /^ {4}resolution:/.test(line));
  if (!resolutionLine) {
    fail(`missing resolution for ${packageKey}`);
  }

  const integrityMatch = resolutionLine.match(
    /(?:^|[,{\s])integrity:\s*['"]?([^'",}\s]+)['"]?/
  );
  if (!integrityMatch || !SHA512_INTEGRITY.test(integrityMatch[1])) {
    fail(`missing or non-SHA512 integrity for ${packageKey}`);
  }

  const tarballMatch = resolutionLine.match(
    /(?:^|[,{\s])tarball:\s*['"]?([^'",}\s]+)['"]?/
  );
  let tarball;
  if (tarballMatch) {
    try {
      tarball = new URL(tarballMatch[1]);
    } catch {
      fail(`invalid tarball URL for ${packageKey}`);
    }
    if (
      tarball.origin !== REGISTRY_ORIGIN ||
      tarball.protocol !== "https:" ||
      tarball.username ||
      tarball.password ||
      tarball.search ||
      tarball.hash
    ) {
      fail(`tarball for ${packageKey} is outside the npm registry allowlist`);
    }
  }

  return { integrity: integrityMatch[1], tarball: tarball?.href };
}

export function parseLockfile(lockfileText) {
  const normalized = lockfileText.replaceAll("\r\n", "\n");
  const packagesStart = normalized.indexOf("\npackages:\n");
  const snapshotsStart = normalized.indexOf("\nsnapshots:\n");
  if (
    packagesStart < 0 ||
    snapshotsStart < 0 ||
    snapshotsStart <= packagesStart
  ) {
    fail("unsupported pnpm lockfile: expected packages and snapshots sections");
  }

  const section = normalized.slice(
    packagesStart + "\npackages:\n".length,
    snapshotsStart
  );
  const lines = section.split("\n");
  const entryStarts = [];
  for (let index = 0; index < lines.length; index += 1) {
    // Package entries are exactly two spaces deep. Nested mapping keys use
    // additional indentation and must never be mistaken for package names.
    const match = lines[index].match(/^ {2}(\S.*):$/);
    if (match) entryStarts.push({ index, rawKey: match[1] });
  }
  if (entryStarts.length === 0) fail("lockfile packages section is empty");

  const packages = [];
  const seen = new Set();
  for (let index = 0; index < entryStarts.length; index += 1) {
    const start = entryStarts[index];
    const end = entryStarts[index + 1]?.index ?? lines.length;
    const packageKey = decodeYamlScalar(start.rawKey);
    const { name, version } = splitPackageKey(packageKey);
    const { integrity, tarball } = parseResolution(
      lines.slice(start.index + 1, end).join("\n"),
      packageKey
    );
    const identity = `${name}@${version}`;
    if (seen.has(identity))
      fail(`duplicate package version in lockfile: ${identity}`);
    seen.add(identity);
    packages.push({ name, version, integrity, tarball });
  }
  return packages;
}

function registryUrlFor(name) {
  return `${REGISTRY_ORIGIN}/${encodeURIComponent(name)}`;
}

function delay(milliseconds) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, milliseconds));
}

function retryDelay(response, attempt) {
  const value = response.headers.get("retry-after");
  if (value) {
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0)
      return Math.min(120_000, seconds * 1_000);
    const date = Date.parse(value);
    if (Number.isFinite(date))
      return Math.max(0, Math.min(120_000, date - Date.now()));
  }
  return 500 * 2 ** (attempt - 1);
}

async function fetchPackument(name) {
  const url = registryUrlFor(name);
  let lastFailure = "unknown registry error";

  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let backoff = 0;
    try {
      const response = await fetch(url, {
        method: "GET",
        redirect: "error",
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          "User-Agent": "maf-v3-lock-verifier/1",
        },
      });

      if (response.status === 429 || response.status >= 500) {
        lastFailure = `registry returned HTTP ${response.status}`;
        backoff = retryDelay(response, attempt);
      } else if (!response.ok) {
        fail(`registry lookup failed for ${name}: HTTP ${response.status}`);
      } else {
        if (response.url !== url) {
          fail(`registry redirected metadata for ${name}`);
        }
        const declaredLength = Number(response.headers.get("content-length"));
        if (
          Number.isFinite(declaredLength) &&
          declaredLength > MAX_PACKUMENT_BYTES
        ) {
          fail(`registry metadata is unexpectedly large for ${name}`);
        }
        const body = await response.text();
        if (Buffer.byteLength(body, "utf8") > MAX_PACKUMENT_BYTES) {
          fail(`registry metadata is unexpectedly large for ${name}`);
        }
        try {
          return JSON.parse(body);
        } catch {
          fail(`registry returned invalid JSON for ${name}`);
        }
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("registry "))
        throw error;
      lastFailure =
        error instanceof Error && error.name === "AbortError"
          ? "registry request timed out"
          : "registry request failed";
    } finally {
      clearTimeout(timeout);
    }

    if (attempt < FETCH_ATTEMPTS)
      await delay(backoff || 500 * 2 ** (attempt - 1));
  }

  fail(`${lastFailure} for ${name} after ${FETCH_ATTEMPTS} attempts`);
}

export function validateRegistryVersion(pkg, packument, now) {
  if (
    !packument ||
    typeof packument !== "object" ||
    packument.name !== pkg.name
  ) {
    fail(`registry metadata is missing for ${pkg.name}`);
  }
  const versionMetadata = packument.versions?.[pkg.version];
  if (!versionMetadata || typeof versionMetadata !== "object") {
    fail(`registry does not contain locked version ${pkg.name}@${pkg.version}`);
  }
  if (
    versionMetadata.name !== pkg.name ||
    versionMetadata.version !== pkg.version
  ) {
    fail(`registry returned the wrong identity for ${pkg.name}@${pkg.version}`);
  }

  const publishedText = packument.time?.[pkg.version];
  if (typeof publishedText !== "string") {
    fail(`registry publish time is missing for ${pkg.name}@${pkg.version}`);
  }
  const publishedAt = Date.parse(publishedText);
  if (!Number.isFinite(publishedAt)) {
    fail(`registry publish time is invalid for ${pkg.name}@${pkg.version}`);
  }
  if (publishedAt > now) {
    fail(
      `registry publish time is in the future for ${pkg.name}@${pkg.version}`
    );
  }
  const age = now - publishedAt;
  if (age < MINIMUM_RELEASE_AGE_MS) {
    const ageMinutes = Math.floor(age / 60_000);
    fail(
      `${pkg.name}@${pkg.version} is ${ageMinutes} minutes old; ` +
        `${MINIMUM_RELEASE_AGE_MINUTES} minutes are required`
    );
  }

  const registryIntegrity = versionMetadata.dist?.integrity;
  if (
    typeof registryIntegrity !== "string" ||
    registryIntegrity !== pkg.integrity
  ) {
    fail(`integrity mismatch for ${pkg.name}@${pkg.version}`);
  }

  const registryTarball = versionMetadata.dist?.tarball;
  if (typeof registryTarball !== "string") {
    fail(`registry tarball URL is missing for ${pkg.name}@${pkg.version}`);
  }
  let tarball;
  try {
    tarball = new URL(registryTarball);
  } catch {
    fail(`registry tarball URL is invalid for ${pkg.name}@${pkg.version}`);
  }
  if (
    tarball.origin !== REGISTRY_ORIGIN ||
    tarball.protocol !== "https:" ||
    tarball.username ||
    tarball.password ||
    tarball.search ||
    tarball.hash
  ) {
    fail(
      `registry tarball for ${pkg.name}@${pkg.version} is outside the allowlist`
    );
  }
  if (pkg.tarball && pkg.tarball !== tarball.href) {
    fail(`lockfile tarball URL mismatch for ${pkg.name}@${pkg.version}`);
  }
}

async function runPool(items, worker) {
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(FETCH_CONCURRENCY, items.length) },
    async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        await worker(items[index]);
      }
    }
  );
  await Promise.all(workers);
}

async function main() {
  const args = process.argv.slice(2);
  let report = false;
  const reportIndex = args.indexOf(REPORT_ARGUMENT);
  if (reportIndex >= 0) {
    report = true;
    args.splice(reportIndex, 1);
  }
  if (args.length > 1) {
    fail(
      "usage: node scripts/security-verify-lock.mjs [pnpm-lock.yaml] [--report]"
    );
  }
  const lockfilePath = resolve(args[0] ?? "pnpm-lock.yaml");
  const lockfile = await readFile(lockfilePath, "utf8");
  const packages = parseLockfile(lockfile);
  const byName = new Map();
  for (const pkg of packages) {
    const versions = byName.get(pkg.name) ?? [];
    versions.push(pkg);
    byName.set(pkg.name, versions);
  }

  const now = Date.now();
  if (!Number.isFinite(now) || now <= 0) fail("system clock is invalid");
  const failures = [];

  await runPool([...byName.entries()], async ([name, versions]) => {
    try {
      const packument = await fetchPackument(name);
      for (const pkg of versions) {
        validateRegistryVersion(pkg, packument, now);
      }
    } catch (error) {
      failures.push(
        error instanceof Error
          ? error.message
          : `verification failed for ${name}`
      );
    }
  });

  if (failures.length > 0) {
    failures.sort();
    const shown = failures.slice(0, 50);
    for (const message of shown) console.error(`ERROR: ${message}`);
    if (failures.length > shown.length) {
      console.error(
        `ERROR: ${failures.length - shown.length} additional failures omitted`
      );
    }
    fail(
      `lockfile verification failed for ${failures.length} package group(s)`
    );
  }

  if (report) {
    process.stdout.write(
      `${JSON.stringify(
        {
          schemaVersion: 2,
          generatedAt: new Date(now).toISOString(),
          policy: {
            registry: REGISTRY_ORIGIN,
            minimumVersionAgeMinutes: MINIMUM_RELEASE_AGE_MINUTES,
            lockfile: lockfilePath,
          },
          verifiedVersionCount: packages.length,
          verifiedPackageCount: byName.size,
        },
        null,
        2
      )}\n`
    );
  }
  if (!report)
    console.log(
      `Verified ${packages.length} locked versions across ${byName.size} npm packages: ` +
        `publish age >= ${MINIMUM_RELEASE_AGE_MINUTES} minutes, SHA-512 integrity matched, ` +
        `registry origin allowed.`
    );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main().catch(error => {
    const message =
      error instanceof Error ? error.message : "unknown verifier failure";
    console.error(`SECURITY VERIFICATION FAILED: ${message}`);
    process.exitCode = 1;
  });
