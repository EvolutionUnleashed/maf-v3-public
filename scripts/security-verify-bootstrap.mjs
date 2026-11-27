#!/usr/bin/env node

/**
 * Verify the package-manager bootstrap before pnpm/setup downloads or executes it.
 * This script has no third-party dependencies and runs on the GitHub runner's trusted
 * system Node.js. It fails closed on pinned identity, exact-version age, or digest drift.
 */

import process from "node:process";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const PNPM_VERSION = "11.16.0";
const MINIMUM_QUIET_MINUTES = 10_080;
const MINIMUM_QUIET_MS = MINIMUM_QUIET_MINUTES * 60_000;
const REGISTRY_URL = "https://registry.npmjs.org/pnpm";
const EXPECTED_NPM_PUBLISHED_AT = "2026-07-22T20:17:59.889Z";
const EXPECTED_NPM_INTEGRITY =
  "sha512-t2fpqY/IeuwPQtrvzQ6ElBws20XXPE4eaIYPsr39vgMqtZIQVHnl4Fwjf3QMil/9u7UjhXl93CKWdFobu4g+jQ==";
const EXPECTED_NPM_TARBALL =
  "https://registry.npmjs.org/pnpm/-/pnpm-11.16.0.tgz";
const RELEASE_API =
  "https://api.github.com/repos/pnpm/pnpm/releases/tags/v11.16.0";
const EXPECTED_RELEASE_ID = 358_292_589;
const EXPECTED_RELEASE_PUBLISHED_AT = "2026-07-22T20:36:06Z";
const ASSETS = {
  "linux-x64": {
    name: "pnpm-linux-x64.tar.gz",
    size: 50_976_943,
    digest:
      "sha256:2abc4593a4a502a221d3bd5bbaf18c9d269e4dd7bf53d143ba6c6ee1faf9149d",
  },
  "win32-x64": {
    name: "pnpm-win32-x64.zip",
    size: 40_807_242,
    digest:
      "sha256:85999cd5c2d66393cc2b5a2d60110d5b4331abf71243da4a9932834195fde9fe",
  },
};
const FETCH_TIMEOUT_MS = 30_000;
const FETCH_ATTEMPTS = 3;
const MAX_METADATA_BYTES = 64 * 1024 * 1024;

function fail(message) {
  throw new Error(message);
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
  return 1_000 * 2 ** (attempt - 1);
}

async function fetchJson(url, headers) {
  let lastFailure = "unknown metadata error";
  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let backoff = 0;
    try {
      const response = await fetch(url, {
        method: "GET",
        redirect: "error",
        signal: controller.signal,
        headers,
      });
      if (response.status === 429 || response.status >= 500) {
        lastFailure = `metadata endpoint returned HTTP ${response.status}`;
        backoff = retryDelay(response, attempt);
      } else if (!response.ok) {
        fail(`metadata lookup failed: HTTP ${response.status}`);
      } else {
        if (response.url !== url)
          fail("metadata endpoint redirected unexpectedly");
        const declared = Number(response.headers.get("content-length"));
        if (Number.isFinite(declared) && declared > MAX_METADATA_BYTES) {
          fail("bootstrap metadata is unexpectedly large");
        }
        const body = await response.text();
        if (Buffer.byteLength(body, "utf8") > MAX_METADATA_BYTES) {
          fail("bootstrap metadata is unexpectedly large");
        }
        try {
          return JSON.parse(body);
        } catch {
          fail("bootstrap metadata is invalid JSON");
        }
      }
    } catch (error) {
      if (
        error instanceof Error &&
        /^(?:metadata|bootstrap)/.test(error.message)
      )
        throw error;
      lastFailure =
        error instanceof Error && error.name === "AbortError"
          ? "metadata request timed out"
          : "metadata request failed";
    } finally {
      clearTimeout(timeout);
    }
    if (attempt < FETCH_ATTEMPTS)
      await delay(backoff || 1_000 * 2 ** (attempt - 1));
  }
  fail(`${lastFailure} after ${FETCH_ATTEMPTS} attempts`);
}

function exactTime(value, expected, label) {
  if (value !== expected || !Number.isFinite(Date.parse(value))) {
    fail(`${label} differs from the reviewed value`);
  }
  return Date.parse(value);
}

function requireAge(timestamp, now, label) {
  if (timestamp > now) fail(`${label} is in the future`);
  const age = now - timestamp;
  if (age < MINIMUM_QUIET_MS) {
    fail(
      `${label} is ${Math.floor(age / 60_000)} minutes old; ${MINIMUM_QUIET_MINUTES} minutes are required`
    );
  }
}

export function verifyRegistry(document, now) {
  if (document?.name !== "pnpm" || typeof document?.time !== "object") {
    fail("npm returned the wrong pnpm metadata");
  }
  const version = document.versions?.[PNPM_VERSION];
  if (
    version?.name !== "pnpm" ||
    version?.version !== PNPM_VERSION ||
    version?.dist?.integrity !== EXPECTED_NPM_INTEGRITY ||
    version?.dist?.tarball !== EXPECTED_NPM_TARBALL
  ) {
    fail(
      `pnpm@${PNPM_VERSION} identity, integrity, or tarball metadata changed`
    );
  }
  const publishedAt = exactTime(
    document.time[PNPM_VERSION],
    EXPECTED_NPM_PUBLISHED_AT,
    "pnpm publish time"
  );
  requireAge(publishedAt, now, `pnpm@${PNPM_VERSION}`);
}

function verifyRelease(document, now, expectedAsset) {
  if (
    document?.id !== EXPECTED_RELEASE_ID ||
    document?.tag_name !== `v${PNPM_VERSION}` ||
    document?.draft !== false ||
    document?.prerelease !== false ||
    !Array.isArray(document?.assets)
  ) {
    fail("GitHub returned the wrong pnpm release metadata");
  }
  const publishedAt = exactTime(
    document.published_at,
    EXPECTED_RELEASE_PUBLISHED_AT,
    "pnpm GitHub release publish time"
  );
  requireAge(publishedAt, now, `pnpm v${PNPM_VERSION} native release`);

  const candidates = document.assets.filter(
    asset => asset?.name === expectedAsset.name
  );
  if (candidates.length !== 1)
    fail("pnpm release has an unexpected native asset set");
  const actual = candidates[0];
  const expectedUrl = `https://github.com/pnpm/pnpm/releases/download/v${PNPM_VERSION}/${expectedAsset.name}`;
  if (
    actual.size !== expectedAsset.size ||
    actual.digest !== expectedAsset.digest ||
    actual.browser_download_url !== expectedUrl ||
    actual.state !== "uploaded"
  ) {
    fail("pnpm native bootstrap asset size, SHA-256, URL, or state changed");
  }
}

async function main() {
  if (process.argv.length !== 2) {
    fail("usage: node scripts/security-verify-bootstrap.mjs");
  }
  const platform = `${process.platform}-${process.arch}`;
  const expectedAsset = ASSETS[platform];
  if (!expectedAsset) fail(`unsupported pnpm bootstrap platform: ${platform}`);
  const now = Date.now();
  if (!Number.isFinite(now) || now <= 0) fail("system clock is invalid");

  const [registry, release] = await Promise.all([
    fetchJson(REGISTRY_URL, {
      Accept: "application/json",
      "User-Agent": "maf-v3-bootstrap-verifier/1",
    }),
    fetchJson(RELEASE_API, {
      Accept: "application/vnd.github+json",
      "User-Agent": "maf-v3-bootstrap-verifier/1",
      "X-GitHub-Api-Version": "2022-11-28",
    }),
  ]);
  verifyRegistry(registry, now);
  verifyRelease(release, now, expectedAsset);
  console.log(
    `Verified pnpm@${PNPM_VERSION} bootstrap: npm integrity/exact-version publish age and ` +
      `${expectedAsset.name} pinned SHA-256/size passed.`
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main().catch(error => {
    console.error(
      `BOOTSTRAP SECURITY VERIFICATION FAILED: ${error instanceof Error ? error.message : "unknown failure"}`
    );
    process.exitCode = 1;
  });
