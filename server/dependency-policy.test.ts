import { describe, expect, it } from "vitest";
// These dependency-free verifiers also run before any package installation.
// @ts-expect-error Standalone build script does not ship TypeScript declarations.
import { validateRegistryVersion } from "../scripts/security-verify-lock.mjs";
// @ts-expect-error Standalone build script does not ship TypeScript declarations.
import { verifyRegistry } from "../scripts/security-verify-bootstrap.mjs";

const now = Date.parse("2026-09-15T00:00:00Z");
const week = 7 * 24 * 60 * 60 * 1000;
const pkg = { name: "example", version: "1.0.0", integrity: "sha512-reviewed" };
function metadata(age = week) {
  return {
    name: pkg.name,
    time: {
      [pkg.version]: new Date(now - age).toISOString(),
      modified: new Date(now).toISOString(),
    },
    versions: {
      [pkg.version]: {
        ...pkg,
        dist: {
          integrity: pkg.integrity,
          tarball: "https://registry.npmjs.org/example/-/example-1.0.0.tgz",
        },
      },
    },
  };
}

describe("exact-version seven-day npm policy", () => {
  it("accepts exactly seven days even if other versions or metadata changed today", () => {
    expect(() => validateRegistryVersion(pkg, metadata(), now)).not.toThrow();
  });
  it("rejects a version even one millisecond younger than seven days", () => {
    expect(() => validateRegistryVersion(pkg, metadata(week - 1), now)).toThrow(
      "minutes are required"
    );
  });
  it("rejects missing and future version timestamps", () => {
    const doc = metadata();
    delete (doc.time as Record<string, string>)[pkg.version];
    expect(() => validateRegistryVersion(pkg, doc, now)).toThrow(
      "publish time is missing"
    );
    expect(() => validateRegistryVersion(pkg, metadata(-1), now)).toThrow(
      "in the future"
    );
  });
  it("still rejects changed bytes or an untrusted tarball origin", () => {
    const doc = metadata();
    doc.versions[pkg.version].dist.integrity = "sha512-tampered";
    expect(() => validateRegistryVersion(pkg, doc, now)).toThrow(
      "integrity mismatch"
    );
    doc.versions[pkg.version].dist.integrity = pkg.integrity;
    doc.versions[pkg.version].dist.tarball = "https://example.com/package.tgz";
    expect(() => validateRegistryVersion(pkg, doc, now)).toThrow(
      "outside the allowlist"
    );
  });
  it("applies the same version-only rule to the pinned pnpm bootstrap", () => {
    const pnpm = {
      name: "pnpm",
      time: {
        "11.16.0": "2026-07-22T20:17:59.889Z",
        modified: new Date(now).toISOString(),
      },
      versions: {
        "11.16.0": {
          name: "pnpm",
          version: "11.16.0",
          dist: {
            integrity:
              "sha512-t2fpqY/IeuwPQtrvzQ6ElBws20XXPE4eaIYPsr39vgMqtZIQVHnl4Fwjf3QMil/9u7UjhXl93CKWdFobu4g+jQ==",
            tarball: "https://registry.npmjs.org/pnpm/-/pnpm-11.16.0.tgz",
          },
        },
      },
    };
    expect(() => verifyRegistry(pnpm, now)).not.toThrow();
    pnpm.versions["11.16.0"].dist.integrity = "sha512-changed";
    expect(() => verifyRegistry(pnpm, now)).toThrow("changed");
  });
});
