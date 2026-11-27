#!/usr/bin/env node

/**
 * Generate the desktop third-party notice without network access.
 *
 * npm coverage is deliberately conservative: every physical package materialized by
 * the frozen pnpm install is included, even when it is used only to build the shipped
 * browser/server output. Cargo coverage is every registry crate in Cargo.lock and
 * therefore includes all target-specific Tauri/Rust code. This superset avoids trying
 * to infer legal obligations from a minified/bundled dependency graph.
 */

import { createHash } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  writeFile,
} from "node:fs/promises";

const ROOT = path.resolve(process.cwd());
const PNPM_STORE = path.join(ROOT, "node_modules", ".pnpm");
const CARGO_LOCK = path.join(ROOT, "src-tauri", "Cargo.lock");
const OUTPUT = path.join(
  ROOT,
  "desktop",
  "generated",
  "THIRD-PARTY-NOTICES.txt"
);
const MAX_LICENSE_BYTES = 2 * 1024 * 1024;
const MAX_LICENSE_FILES_PER_PACKAGE = 64;
const MAX_NOTICE_BYTES = 32 * 1024 * 1024;
const REGISTRY_SOURCE = "registry+https://github.com/rust-lang/crates.io-index";
const LICENSE_FILE =
  /^(?:unlicen[cs]e|licen[cs]e|copying|notice|copyrights?|patents?|third[-_ ]party)(?:$|[._-])/i;
const LICENSE_DIRECTORY = /^(?:licen[cs]es|legal)$/i;

function fail(message) {
  throw new Error(message);
}

function compareText(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function normalizeLicenseText(bytes, label) {
  if (bytes.includes(0)) fail(`${label} is not a text license file.`);
  let decoded;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fail(`${label} is not valid UTF-8 legal text.`);
  }
  const normalized = decoded
    .replace(/^\uFEFF/, "")
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n");
  return normalized.endsWith("\n") ? normalized : `${normalized}\n`;
}

function renderLicenseValue(value) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const candidate = value.type ?? value.name;
    if (typeof candidate === "string" && candidate.trim())
      return candidate.trim();
  }
  if (Array.isArray(value)) {
    const values = value
      .map(renderLicenseValue)
      .filter(value => value !== "Not declared");
    if (values.length)
      return [...new Set(values)].sort(compareText).join(" OR ");
  }
  return "Not declared";
}

async function collectLicenseFiles(packageRoot, declaredPaths = []) {
  const files = [];
  const entries = await readdir(packageRoot, { withFileTypes: true });
  entries.sort((left, right) => compareText(left.name, right.name));

  for (const entry of entries) {
    const absolute = path.join(packageRoot, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isFile() && LICENSE_FILE.test(entry.name)) {
      files.push({ absolute, relative: entry.name });
      continue;
    }
    if (entry.isDirectory() && LICENSE_DIRECTORY.test(entry.name)) {
      const children = await readdir(absolute, { withFileTypes: true });
      children.sort((left, right) => compareText(left.name, right.name));
      for (const child of children) {
        if (!child.isFile() || child.isSymbolicLink()) continue;
        files.push({
          absolute: path.join(absolute, child.name),
          relative: `${entry.name}/${child.name}`,
        });
      }
    }
  }

  for (const declaredPath of declaredPaths) {
    if (typeof declaredPath !== "string" || !declaredPath.trim()) continue;
    const absolute = path.resolve(packageRoot, declaredPath);
    const relative = path.relative(packageRoot, absolute);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      fail(`${packageRoot} declares an unsafe legal-file path.`);
    }
    const [realPackageRoot, realDeclaredPath] = await Promise.all([
      realpath(packageRoot),
      realpath(absolute).catch(() =>
        fail(`${packageRoot} declares a missing legal file.`)
      ),
    ]);
    const realRelative = path.relative(realPackageRoot, realDeclaredPath);
    if (
      !realRelative ||
      realRelative.startsWith("..") ||
      path.isAbsolute(realRelative)
    ) {
      fail(
        `${packageRoot} declares a legal file outside its published package.`
      );
    }
    const metadata = await lstat(absolute).catch(() =>
      fail(`${packageRoot} declares a missing legal file.`)
    );
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      fail(`${packageRoot} declares a non-regular legal file.`);
    }
    if (!files.some(file => path.resolve(file.absolute) === absolute)) {
      files.push({ absolute, relative: relative.split(path.sep).join("/") });
    }
  }
  files.sort((left, right) => compareText(left.relative, right.relative));

  if (files.length > MAX_LICENSE_FILES_PER_PACKAGE) {
    fail(`${packageRoot} contains an unexpected number of legal files.`);
  }

  const result = [];
  for (const file of files) {
    const metadata = await lstat(file.absolute);
    if (!metadata.isFile() || metadata.size > MAX_LICENSE_BYTES) {
      fail(`${file.absolute} is not a bounded regular legal text file.`);
    }
    const bytes = await readFile(file.absolute);
    result.push({
      name: file.relative.split(path.sep).join("/"),
      sha256: sha256(bytes),
      text: normalizeLicenseText(bytes, file.absolute),
    });
  }
  return result;
}

async function npmPackageRoots() {
  const storeRoot = await realpath(PNPM_STORE).catch(() =>
    fail("The frozen pnpm installation is missing.")
  );
  const roots = [];
  const storeEntries = await readdir(storeRoot, { withFileTypes: true });
  storeEntries.sort((left, right) => compareText(left.name, right.name));
  for (const storeEntry of storeEntries) {
    if (
      !storeEntry.isDirectory() ||
      storeEntry.isSymbolicLink() ||
      storeEntry.name === "node_modules"
    )
      continue;
    const modules = path.join(storeRoot, storeEntry.name, "node_modules");
    let entries;
    try {
      entries = await readdir(modules, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((left, right) => compareText(left.name, right.name));
    for (const entry of entries) {
      if (entry.isSymbolicLink() || !entry.isDirectory()) continue;
      const firstLevel = path.join(modules, entry.name);
      if (entry.name.startsWith("@")) {
        const scopedEntries = await readdir(firstLevel, {
          withFileTypes: true,
        });
        scopedEntries.sort((left, right) => compareText(left.name, right.name));
        for (const scopedEntry of scopedEntries) {
          if (scopedEntry.isDirectory() && !scopedEntry.isSymbolicLink()) {
            roots.push(path.join(firstLevel, scopedEntry.name));
          }
        }
      } else {
        roots.push(firstLevel);
      }
    }
  }
  return roots;
}

async function collectNpmPackages() {
  const packages = new Map();
  for (const packageRoot of await npmPackageRoots()) {
    const manifestPath = path.join(packageRoot, "package.json");
    let manifest;
    try {
      manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    } catch {
      fail(`Installed npm package has no valid manifest: ${manifestPath}`);
    }
    if (
      typeof manifest.name !== "string" ||
      typeof manifest.version !== "string"
    ) {
      fail(
        `Installed npm package has invalid identity metadata: ${manifestPath}`
      );
    }
    const seeLicense =
      typeof manifest.license === "string"
        ? manifest.license.match(/^SEE LICENSE IN\s+(.+)$/i)?.[1]?.trim()
        : undefined;
    const licenseFiles = await collectLicenseFiles(
      packageRoot,
      seeLicense ? [seeLicense] : []
    );
    const license = renderLicenseValue(manifest.license ?? manifest.licenses);
    if (license === "Not declared" && licenseFiles.length === 0) {
      fail(
        `npm package ${manifest.name}@${manifest.version} has no license declaration or legal file.`
      );
    }
    const item = {
      ecosystem: "npm",
      name: manifest.name,
      version: manifest.version,
      source: `https://www.npmjs.com/package/${encodeURIComponent(manifest.name)}/v/${encodeURIComponent(manifest.version)}`,
      license,
      licenseFiles,
    };
    const key = `${item.ecosystem}\0${item.name}\0${item.version}`;
    const rendered = JSON.stringify(item);
    if (packages.has(key) && JSON.stringify(packages.get(key)) !== rendered) {
      fail(
        `Installed npm package ${manifest.name}@${manifest.version} has inconsistent legal metadata.`
      );
    }
    packages.set(key, item);
  }
  if (packages.size === 0)
    fail("No installed npm packages were found for legal-notice generation.");
  return packages;
}

function parseCargoPackages(source) {
  const packages = [];
  for (const block of source
    .replaceAll("\r\n", "\n")
    .split(/^\[\[package\]\]\s*$/m)
    .slice(1)) {
    const readString = key => {
      const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const match = block.match(
        new RegExp(`^${escaped}\\s*=\\s*("(?:\\\\.|[^"\\\\])*")\\s*$`, "m")
      );
      return match ? JSON.parse(match[1]) : undefined;
    };
    const name = readString("name");
    const version = readString("version");
    const sourceValue = readString("source");
    if (!name || !version)
      fail("Cargo.lock contains a package without an exact name and version.");
    if (!sourceValue) continue;
    if (sourceValue !== REGISTRY_SOURCE)
      fail(
        `Cargo.lock contains a forbidden notice source for ${name}@${version}.`
      );
    packages.push({ name, version });
  }
  if (packages.length === 0)
    fail("Cargo.lock contains no registry crates for legal-notice generation.");
  return packages;
}

function parseCargoManifestValue(source, key) {
  const packageHeader = source.match(/^\[package\]\s*$/m);
  if (!packageHeader || packageHeader.index === undefined) return undefined;
  const afterHeader = source.slice(
    packageHeader.index + packageHeader[0].length
  );
  const nextSection = afterHeader.search(/^\[/m);
  const packageSection =
    nextSection >= 0 ? afterHeader.slice(0, nextSection) : afterHeader;
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = packageSection.match(
    new RegExp(`^${escaped}\\s*=\\s*("(?:\\\\.|[^"\\\\])*")\\s*$`, "m")
  );
  return match ? JSON.parse(match[1]) : undefined;
}

async function cargoRegistryRoots() {
  const cargoHome = process.env.CARGO_HOME?.trim()
    ? path.resolve(process.env.CARGO_HOME)
    : path.join(homedir(), ".cargo");
  const sourceRoot = path.join(cargoHome, "registry", "src");
  const indexes = await readdir(sourceRoot, { withFileTypes: true }).catch(() =>
    fail(
      "The Cargo registry source is missing. Run the reviewed `cargo fetch --locked` first."
    )
  );
  const roots = indexes
    .filter(entry => entry.isDirectory() && !entry.isSymbolicLink())
    .map(entry => path.join(sourceRoot, entry.name));
  if (roots.length === 0)
    fail("The Cargo registry source contains no reviewed index checkout.");
  return roots;
}

async function collectCargoPackages() {
  const lockSource = await readFile(CARGO_LOCK, "utf8");
  const locked = parseCargoPackages(lockSource);
  const registryRoots = await cargoRegistryRoots();
  const packages = new Map();
  for (const lockedPackage of locked) {
    const directoryName = `${lockedPackage.name}-${lockedPackage.version}`;
    const candidates = [];
    for (const registryRoot of registryRoots) {
      const candidate = path.join(registryRoot, directoryName);
      try {
        if ((await lstat(candidate)).isDirectory()) candidates.push(candidate);
      } catch {
        // Try the next local crates.io registry directory.
      }
    }
    if (candidates.length !== 1) {
      fail(
        `Expected one fetched source tree for crate ${lockedPackage.name}@${lockedPackage.version}, found ${candidates.length}.`
      );
    }
    const packageRoot = candidates[0];
    const manifestSource = await readFile(
      path.join(packageRoot, "Cargo.toml"),
      "utf8"
    ).catch(() => fail(`Fetched crate has no Cargo.toml: ${directoryName}`));
    const manifestName = parseCargoManifestValue(manifestSource, "name");
    const manifestVersion = parseCargoManifestValue(manifestSource, "version");
    if (
      manifestName !== lockedPackage.name ||
      manifestVersion !== lockedPackage.version
    ) {
      fail(`Fetched crate identity differs from Cargo.lock: ${directoryName}`);
    }
    const declaredLicenseFile = parseCargoManifestValue(
      manifestSource,
      "license-file"
    );
    const licenseFiles = await collectLicenseFiles(
      packageRoot,
      declaredLicenseFile ? [declaredLicenseFile] : []
    );
    const license =
      parseCargoManifestValue(manifestSource, "license")?.trim() ||
      "Not declared";
    if (license === "Not declared" && licenseFiles.length === 0) {
      fail(`crate ${directoryName} has no license declaration or legal file.`);
    }
    const item = {
      ecosystem: "Cargo",
      name: lockedPackage.name,
      version: lockedPackage.version,
      source: `https://crates.io/crates/${encodeURIComponent(lockedPackage.name)}/${encodeURIComponent(lockedPackage.version)}`,
      license,
      licenseFiles,
    };
    const key = `${item.ecosystem}\0${item.name}\0${item.version}`;
    if (packages.has(key)) fail(`Cargo.lock repeats crate ${directoryName}.`);
    packages.set(key, item);
  }
  return packages;
}

function renderNotice(items, npmCount, cargoCount) {
  const lines = [
    "MAF V3 THIRD-PARTY NOTICES",
    "==========================",
    "",
    "This file is generated without network access from the frozen pnpm installation",
    "and every crates.io package in src-tauri/Cargo.lock after `cargo fetch --locked`.",
    "The npm list is a conservative superset of browser/server runtime dependencies and",
    "build tools whose output is distributed. The Cargo list covers the complete locked",
    "Tauri/Rust graph, including target-specific crates. Inclusion does not imply that a",
    "package owner endorses MAF V3.",
    "",
    "The bundled Node.js runtime has its complete separate notice and license at",
    "runtime/node/LICENSE.node.txt.",
    "",
    `Coverage: ${npmCount} npm package versions; ${cargoCount} Cargo crate versions.`,
    "",
  ];
  for (const item of items) {
    lines.push(
      "------------------------------------------------------------------------",
      ""
    );
    lines.push(`${item.ecosystem}: ${item.name}@${item.version}`);
    lines.push(`Source: ${item.source}`);
    lines.push(`Declared license: ${item.license}`);
    if (item.licenseFiles.length === 0) {
      lines.push(
        "Legal files: none present in the published package (declaration shown above).",
        ""
      );
      continue;
    }
    for (const file of item.licenseFiles) {
      lines.push(
        "",
        `--- ${file.name} (published bytes SHA-256 ${file.sha256}) ---`,
        "",
        file.text.endsWith("\n") ? file.text.slice(0, -1) : file.text
      );
    }
    lines.push("");
  }
  return `${lines.join("\n").replace(/\n+$/, "")}\n`;
}

async function main() {
  const [npmPackages, cargoPackages] = await Promise.all([
    collectNpmPackages(),
    collectCargoPackages(),
  ]);
  const items = [...npmPackages.values(), ...cargoPackages.values()].sort(
    (left, right) =>
      compareText(
        `${left.ecosystem}\0${left.name}\0${left.version}`,
        `${right.ecosystem}\0${right.name}\0${right.version}`
      )
  );
  const notice = renderNotice(items, npmPackages.size, cargoPackages.size);
  if (Buffer.byteLength(notice, "utf8") > MAX_NOTICE_BYTES) {
    fail(
      `The generated notice exceeds the ${MAX_NOTICE_BYTES}-byte release budget.`
    );
  }
  if (process.argv.includes("--check")) {
    const existing = await readFile(OUTPUT, "utf8").catch(() => "");
    if (existing !== notice)
      fail("The generated third-party notice is missing or stale.");
    console.log(
      `Verified deterministic third-party notices for ${npmPackages.size} npm packages and ${cargoPackages.size} Cargo crates.`
    );
    return;
  }
  await mkdir(path.dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, notice, { encoding: "utf8", flag: "w" });
  console.log(
    `Generated third-party notices for ${npmPackages.size} npm packages and ${cargoPackages.size} Cargo crates.`
  );
}

main().catch(error => {
  console.error(
    `[security-notices] ${error instanceof Error ? error.message : "unknown failure"}`
  );
  process.exitCode = 1;
});
