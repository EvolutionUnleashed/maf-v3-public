#!/usr/bin/env node

/**
 * Fail-closed Cargo.lock verifier.
 *
 * Every registry crate is checked against crates.io before Cargo fetch/build.
 * The selected crate version must have been published for seven full days and
 * its Cargo.lock checksum must match the registry API.
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";

const CRATES_ORIGIN = "https://crates.io";
const CRATES_SOURCE = "registry+https://github.com/rust-lang/crates.io-index";
const MINIMUM_RELEASE_AGE_MINUTES = 10_080;
const MINIMUM_RELEASE_AGE_MS = MINIMUM_RELEASE_AGE_MINUTES * 60_000;
const FETCH_TIMEOUT_MS = 30_000;
const FETCH_ATTEMPTS = 5;
// crates.io asks API clients to make no more than one request per second.
// One crate endpoint returns every version, so multiple locked versions of
// the same crate share a single rate-limited lookup.
const MINIMUM_REQUEST_INTERVAL_MS = 1_100;
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
const SEMVER =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const CRATE_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9_-]*[A-Za-z0-9])?$/;
const SHA256 = /^[0-9a-f]{64}$/;

function fail(message) {
  throw new Error(message);
}

function decodeTomlString(raw, label) {
  const value = raw.trim();
  if (!value.startsWith('"') || !value.endsWith('"'))
    fail(`invalid ${label} in Cargo.lock`);
  try {
    return JSON.parse(value);
  } catch {
    fail(`invalid ${label} string in Cargo.lock`);
  }
}

function parsePackageBlock(block, index) {
  const fields = new Map();
  for (const line of block.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z][A-Za-z0-9_-]*)\s*=\s*(.+)$/);
    if (match && !fields.has(match[1])) fields.set(match[1], match[2]);
  }
  const nameRaw = fields.get("name");
  const versionRaw = fields.get("version");
  if (!nameRaw || !versionRaw)
    fail(`Cargo.lock package ${index + 1} is missing name or version`);
  const name = decodeTomlString(nameRaw, "package name");
  const version = decodeTomlString(versionRaw, "package version");
  if (!CRATE_NAME.test(name) || name.length > 64)
    fail(`invalid crate name in Cargo.lock: ${name}`);
  if (!SEMVER.test(version))
    fail(`crate is not locked to exact semver: ${name}@${version}`);

  const sourceRaw = fields.get("source");
  const checksumRaw = fields.get("checksum");
  if (!sourceRaw && !checksumRaw) return { name, version, local: true };
  if (!sourceRaw || !checksumRaw)
    fail(`crate has incomplete source metadata: ${name}@${version}`);
  const source = decodeTomlString(sourceRaw, "package source");
  const checksum = decodeTomlString(checksumRaw, "package checksum");
  if (source !== CRATES_SOURCE)
    fail(`non-crates.io Cargo source is forbidden: ${name}@${version}`);
  if (!SHA256.test(checksum))
    fail(`invalid crates.io checksum for ${name}@${version}`);
  return { name, version, source, checksum, local: false };
}

export function parseCargoLock(lockText) {
  const header = lockText.match(/^version\s*=\s*(\d+)\s*$/m);
  if (!header || Number(header[1]) < 3 || Number(header[1]) > 4) {
    fail("Cargo.lock must use supported lockfile format 3 or 4");
  }
  const blocks = lockText.split(/^\[\[package\]\]\s*$/m).slice(1);
  if (blocks.length === 0) fail("Cargo.lock contains no packages");
  const packages = blocks.map(parsePackageBlock);
  const seen = new Set();
  for (const pkg of packages) {
    const identity = `${pkg.name}@${pkg.version}`;
    if (seen.has(identity))
      fail(`duplicate Cargo package identity: ${identity}`);
    seen.add(identity);
  }
  return packages;
}

function cargoManifestIdentity(manifest) {
  const packageStart = manifest.search(/^\[package\]\s*$/m);
  if (packageStart < 0) fail("src-tauri/Cargo.toml is missing [package]");
  const afterHeader = manifest
    .slice(packageStart)
    .replace(/^\[package\]\s*\r?\n/, "");
  const nextSection = afterHeader.search(/^\[/m);
  const packageSection =
    nextSection < 0 ? afterHeader : afterHeader.slice(0, nextSection);
  if (!packageSection) fail("src-tauri/Cargo.toml is missing [package]");
  const nameRaw = packageSection.match(/^name\s*=\s*(.+)$/m)?.[1];
  const versionRaw = packageSection.match(/^version\s*=\s*(.+)$/m)?.[1];
  if (!nameRaw || !versionRaw)
    fail("src-tauri/Cargo.toml is missing package name or version");
  return `${decodeTomlString(nameRaw, "Cargo.toml package name")}@${decodeTomlString(versionRaw, "Cargo.toml package version")}`;
}

function registryUrlFor(crateName) {
  return `${CRATES_ORIGIN}/api/v1/crates/${encodeURIComponent(crateName)}`;
}

function delay(milliseconds) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, milliseconds));
}

let nextRequestAt = 0;

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
  return Math.min(60_000, 5_000 * 2 ** (attempt - 1));
}

async function fetchCrate(crateName) {
  const url = registryUrlFor(crateName);
  let lastFailure = "unknown registry error";
  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt += 1) {
    const wait = Math.max(0, nextRequestAt - Date.now());
    if (wait > 0) await delay(wait);
    nextRequestAt = Date.now() + MINIMUM_REQUEST_INTERVAL_MS;
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
          "User-Agent":
            "maf-v3-release-verifier/1 (https://github.com/EvolutionUnleashed/maf-v3)",
        },
      });
      if (response.status === 429 || response.status >= 500) {
        lastFailure = `crates.io returned HTTP ${response.status}`;
        backoff = retryDelay(response, attempt);
      } else if (!response.ok) {
        fail(
          `crates.io lookup failed for ${crateName}: HTTP ${response.status}`
        );
      } else {
        if (response.url !== url)
          fail(`crates.io redirected metadata for ${crateName}`);
        const declaredLength = Number(response.headers.get("content-length"));
        if (
          Number.isFinite(declaredLength) &&
          declaredLength > MAX_RESPONSE_BYTES
        ) {
          fail(`crates.io metadata is unexpectedly large for ${crateName}`);
        }
        const body = await response.text();
        if (Buffer.byteLength(body, "utf8") > MAX_RESPONSE_BYTES) {
          fail(`crates.io metadata is unexpectedly large for ${crateName}`);
        }
        try {
          return JSON.parse(body);
        } catch {
          fail(`crates.io returned invalid JSON for ${crateName}`);
        }
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("crates.io "))
        throw error;
      lastFailure =
        error instanceof Error && error.name === "AbortError"
          ? "crates.io request timed out"
          : "crates.io request failed";
    } finally {
      clearTimeout(timeout);
    }
    if (attempt < FETCH_ATTEMPTS)
      await delay(backoff || 5_000 * 2 ** (attempt - 1));
  }
  fail(`${lastFailure} for ${crateName} after ${FETCH_ATTEMPTS} attempts`);
}

function validateVersion(pkg, document, now) {
  if (document?.crate?.id !== pkg.name || !Array.isArray(document?.versions)) {
    fail(
      `crates.io returned the wrong or incomplete crate metadata for ${pkg.name}`
    );
  }
  const version = document.versions.find(
    candidate => candidate?.num === pkg.version
  );
  if (!version || typeof version !== "object")
    fail(`crates.io metadata is missing for ${pkg.name}@${pkg.version}`);
  if (version.crate !== pkg.name || version.num !== pkg.version) {
    fail(
      `crates.io returned the wrong identity for ${pkg.name}@${pkg.version}`
    );
  }
  if (version.yanked === true)
    fail(`crate version is yanked: ${pkg.name}@${pkg.version}`);
  if (
    typeof version.checksum !== "string" ||
    version.checksum !== pkg.checksum
  ) {
    fail(`crate checksum mismatch for ${pkg.name}@${pkg.version}`);
  }
  if (typeof version.created_at !== "string")
    fail(`crate publish time is missing for ${pkg.name}@${pkg.version}`);
  const publishedAt = Date.parse(version.created_at);
  if (!Number.isFinite(publishedAt))
    fail(`crate publish time is invalid for ${pkg.name}@${pkg.version}`);
  if (publishedAt > now)
    fail(`crate publish time is in the future for ${pkg.name}@${pkg.version}`);
  const age = now - publishedAt;
  if (age < MINIMUM_RELEASE_AGE_MS) {
    fail(
      `${pkg.name}@${pkg.version} is ${Math.floor(age / 60_000)} minutes old; ` +
        `${MINIMUM_RELEASE_AGE_MINUTES} minutes are required`
    );
  }
  const updatedAt = Date.parse(version.updated_at);
  return Number.isFinite(updatedAt) && now - updatedAt < MINIMUM_RELEASE_AGE_MS;
}

async function main() {
  if (process.argv.length > 4) {
    fail(
      "usage: node scripts/security-verify-cargo-lock.mjs [Cargo.lock] [Cargo.toml]"
    );
  }
  const lockPath = resolve(process.argv[2] ?? "src-tauri/Cargo.lock");
  const manifestPath = resolve(process.argv[3] ?? "src-tauri/Cargo.toml");
  const [lock, manifest] = await Promise.all([
    readFile(lockPath, "utf8"),
    readFile(manifestPath, "utf8"),
  ]);
  const packages = parseCargoLock(lock);
  const expectedLocal = cargoManifestIdentity(manifest);
  const locals = packages
    .filter(pkg => pkg.local)
    .map(pkg => `${pkg.name}@${pkg.version}`);
  if (locals.length !== 1 || locals[0] !== expectedLocal) {
    fail(`Cargo.lock local packages must contain only ${expectedLocal}`);
  }
  const registryPackages = packages.filter(pkg => !pkg.local);
  const now = Date.now();
  let recentlyUpdated = 0;
  const failures = [];
  const packagesByName = new Map();
  for (const pkg of registryPackages) {
    const group = packagesByName.get(pkg.name) ?? [];
    group.push(pkg);
    packagesByName.set(pkg.name, group);
  }

  for (const [crateName, lockedVersions] of packagesByName) {
    try {
      const document = await fetchCrate(crateName);
      for (const pkg of lockedVersions) {
        if (validateVersion(pkg, document, now)) recentlyUpdated += 1;
      }
    } catch (error) {
      failures.push(
        error instanceof Error
          ? error.message
          : `verification failed for ${crateName}`
      );
    }
  }
  if (failures.length > 0) {
    failures.sort();
    for (const message of failures.slice(0, 50))
      console.error(`ERROR: ${message}`);
    if (failures.length > 50)
      console.error(
        `ERROR: ${failures.length - 50} additional failures omitted`
      );
    fail(`Cargo.lock verification failed for ${failures.length} crate(s)`);
  }
  console.log(
    `Verified ${registryPackages.length} versions across ${packagesByName.size} crates: ` +
      `publish age >= ${MINIMUM_RELEASE_AGE_MINUTES} minutes, ` +
      "checksum matched, crates.io origin allowed, no yanked versions."
  );
  if (recentlyUpdated > 0) {
    console.warn(
      `Advisory: ${recentlyUpdated} locked crate version(s) have metadata updates within seven days; ` +
        "their publish ages and checksums still passed."
    );
  }
}

main().catch(error => {
  const message =
    error instanceof Error ? error.message : "unknown Cargo verifier failure";
  console.error(`CARGO SECURITY VERIFICATION FAILED: ${message}`);
  process.exitCode = 1;
});
