#!/usr/bin/env node

/**
 * Verify that repository policy cannot silently weaken the dependency gate.
 * Runs with Node.js only and deliberately fails closed.
 */

import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import process from "node:process";

const ROOT = resolve(process.cwd());
const REQUIRED_PACKAGE_MANAGER = "pnpm@11.16.0";
const REQUIRED_NODE_ENGINE = ">=22.13.0";
const REQUIRED_TAURI_CLI = "2.11.4";
const REQUIRED_BUILD_NODE = "24.18.0";
const EXPECTED_PNPM_BOOTSTRAP_INTEGRITY =
  "sha512-t2fpqY/IeuwPQtrvzQ6ElBws20XXPE4eaIYPsr39vgMqtZIQVHnl4Fwjf3QMil/9u7UjhXl93CKWdFobu4g+jQ==";
const REQUIRED_TAURI_TOOLS = {
  nsisArchive: {
    url: "https://github.com/tauri-apps/binary-releases/releases/download/nsis-3.11/nsis-3.11.zip",
    sha256: "c7d27f780ddb6cffb4730138cd1591e841f4b7edb155856901cdf5f214394fa1",
    size: 2_361_546,
  },
  nsisTauriUtils: {
    url: "https://github.com/tauri-apps/nsis-tauri-utils/releases/download/nsis_tauri_utils-v0.5.3/nsis_tauri_utils.dll",
    sha256: "5ba143b5db4a87d32d6e7802e033330aae56cbceabe0d1e3ba41948385ad4709",
    size: 34_304,
  },
  webview2Bootstrapper: {
    url: "https://msedge.sf.dl.delivery.mp.microsoft.com/filestreamingservice/files/c507f2c4-84bc-4088-b85f-a08d995bc970/MicrosoftEdgeWebview2Setup.exe",
    sha256: "8c4a80540b6bbcbef30a4e8c7d1ac504b6fc09db922b4acdfd85c9d5f6f1050e",
    size: 1_695_960,
    authenticodeSubject: "CN=Microsoft Corporation",
  },
};
const EXACT_SEMVER =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const REQUIRED_SCRIPTS = {
  "security:verify-config": "node scripts/security-verify-config.mjs",
  "security:verify-lock": "node scripts/security-verify-lock.mjs",
  "security:verify-cargo": "node scripts/security-verify-cargo-lock.mjs",
  "security:verify":
    "node scripts/security-verify-config.mjs && node scripts/security-verify-lock.mjs && node scripts/security-verify-cargo-lock.mjs",
  "security:checksums": "node scripts/security-checksums.mjs",
};
const REQUIRED_NOTICE_GENERATOR = "scripts/security-generate-notices.mjs";
const REQUIRED_BOOTSTRAP_VERIFIER = "scripts/security-verify-bootstrap.mjs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function requireYamlScalar(source, key, expected) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`^${escaped}:\\s*(.+?)\\s*$`, "m"));
  assert(match, `pnpm-workspace.yaml is missing ${key}`);
  assert(match[1] === String(expected), `${key} must be ${expected}`);
}

function parseAllowBuilds(source) {
  const lines = source.replaceAll("\r\n", "\n").split("\n");
  const start = lines.findIndex(line => line === "allowBuilds:");
  assert(start >= 0, "pnpm-workspace.yaml is missing allowBuilds");
  const entries = new Map();
  for (const line of lines.slice(start + 1)) {
    if (line && !line.startsWith(" ") && !line.startsWith("#")) break;
    const match = line.match(
      /^ {2}(?:"([^"]+)"|'([^']+)'|([^:#]+)):\s*(true|false)\s*$/
    );
    if (match)
      entries.set(
        (match[1] ?? match[2] ?? match[3]).trim(),
        match[4] === "true"
      );
  }
  return entries;
}

function parseYamlList(source, key) {
  const lines = source.replaceAll("\r\n", "\n").split("\n");
  const start = lines.findIndex(line => line === `${key}:`);
  assert(start >= 0, `pnpm-workspace.yaml is missing ${key}`);
  const values = [];
  for (const line of lines.slice(start + 1)) {
    if (line && !line.startsWith(" ") && !line.startsWith("#")) break;
    const match = line.match(/^ {2}-\s*(?:"([^"]+)"|'([^']+)'|([^#\s]+))\s*$/);
    if (match) values.push(match[1] ?? match[2] ?? match[3]);
  }
  return values;
}

async function listWorkflowFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listWorkflowFiles(fullPath)));
    else if (/\.ya?ml$/i.test(entry.name)) files.push(fullPath);
  }
  return files;
}

async function verifyWorkspace() {
  const source = await readFile(join(ROOT, "pnpm-workspace.yaml"), "utf8");
  requireYamlScalar(source, "minimumReleaseAge", 10_080);
  requireYamlScalar(source, "minimumReleaseAgeStrict", "true");
  requireYamlScalar(source, "minimumReleaseAgeIgnoreMissingTime", "false");
  requireYamlScalar(source, "trustLockfile", "false");
  requireYamlScalar(source, "trustPolicy", "no-downgrade");
  requireYamlScalar(source, "blockExoticSubdeps", "true");
  requireYamlScalar(source, "saveExact", "true");
  requireYamlScalar(source, "strictDepBuilds", "true");
  requireYamlScalar(source, "dangerouslyAllowAllBuilds", "false");
  requireYamlScalar(source, "verifyStoreIntegrity", "true");
  requireYamlScalar(source, "strictStorePkgContentCheck", "true");
  requireYamlScalar(source, "verifyDepsBeforeRun", "error");
  assert(
    !/^minimumReleaseAgeExclude:/m.test(source),
    "minimumReleaseAgeExclude is forbidden; the seven-day gate has no exceptions"
  );
  const trustExceptions = parseYamlList(source, "trustPolicyExclude").sort();
  const expectedTrustExceptions = ["semver@6.3.1"];
  assert(
    JSON.stringify(trustExceptions) === JSON.stringify(expectedTrustExceptions),
    "trustPolicyExclude may contain only the reviewed, exact semver@6.3.1 exception"
  );

  const builds = parseAllowBuilds(source);
  const expectedBuilds = new Map([
    ["@tailwindcss/oxide", true],
    ["better-sqlite3", true],
    ["esbuild", true],
  ]);
  assert(
    builds.size === expectedBuilds.size,
    "allowBuilds contains an unreviewed entry"
  );
  for (const [name, allowed] of expectedBuilds) {
    assert(
      builds.get(name) === allowed,
      `allowBuilds must explicitly approve ${name}`
    );
  }
}

async function verifyNpmrc() {
  const source = await readFile(join(ROOT, ".npmrc"), "utf8");
  assert(
    !/(?:_auth(?:token)?|password|username|certfile|keyfile)\s*=/i.test(source),
    ".npmrc must never contain credentials or private-key paths"
  );
  const settings = new Map();
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    const separator = line.indexOf("=");
    assert(separator > 0, `.npmrc contains an invalid setting: ${line}`);
    settings.set(
      line.slice(0, separator).trim(),
      line.slice(separator + 1).trim()
    );
  }
  assert(
    settings.size === 2,
    ".npmrc may contain only the registry and strict-ssl settings"
  );
  assert(
    settings.get("registry") === "https://registry.npmjs.org/",
    "npm registry is not allowlisted"
  );
  assert(settings.get("strict-ssl") === "true", "strict-ssl must be true");
}

async function verifyManifest() {
  const manifest = JSON.parse(
    await readFile(join(ROOT, "package.json"), "utf8")
  );
  assert(
    manifest.packageManager === REQUIRED_PACKAGE_MANAGER,
    `packageManager must be ${REQUIRED_PACKAGE_MANAGER}`
  );
  assert(
    manifest.engines?.node === REQUIRED_NODE_ENGINE,
    `engines.node must be ${REQUIRED_NODE_ENGINE}`
  );
  assert(
    !manifest.devDependencies?.pnpm,
    "pnpm must not be installed as a project devDependency"
  );
  assert(
    manifest.devDependencies?.["@tauri-apps/cli"] === REQUIRED_TAURI_CLI,
    `@tauri-apps/cli must be exactly ${REQUIRED_TAURI_CLI}`
  );

  for (const section of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
  ]) {
    for (const [name, version] of Object.entries(manifest[section] ?? {})) {
      assert(
        EXACT_SEMVER.test(version),
        `${section}.${name} must use an exact semver version`
      );
    }
  }
  for (const [name, command] of Object.entries(REQUIRED_SCRIPTS)) {
    assert(
      manifest.scripts?.[name] === command,
      `scripts.${name} must be exactly: ${command}`
    );
  }
}

async function verifyCargoPolicy() {
  const [manifest, toolchain, lockfile] = await Promise.all([
    readFile(join(ROOT, "src-tauri", "Cargo.toml"), "utf8"),
    readFile(join(ROOT, "src-tauri", "rust-toolchain.toml"), "utf8"),
    readFile(join(ROOT, "src-tauri", "Cargo.lock"), "utf8"),
  ]);
  assert(
    /^channel\s*=\s*"1\.97\.1"\s*$/m.test(toolchain),
    "Rust toolchain must be pinned to 1.97.1"
  );
  assert(
    /^profile\s*=\s*"minimal"\s*$/m.test(toolchain),
    "Rust toolchain profile must be minimal"
  );
  assert(
    /^targets\s*=\s*\[\s*"x86_64-pc-windows-msvc"\s*\]\s*$/m.test(toolchain),
    "Rust toolchain must pin the Windows x64 MSVC target"
  );
  assert(
    /^version\s*=\s*[34]\s*$/m.test(lockfile),
    "src-tauri/Cargo.lock is missing or unsupported"
  );

  const manifestLines = manifest.split(/\r?\n/);
  let section = "";
  for (let index = 0; index < manifestLines.length; index += 1) {
    const line = manifestLines[index].trim();
    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      section = sectionMatch[1];
      continue;
    }
    if (
      !/(?:^|\.)(?:build-|dev-)?dependencies$/.test(section) ||
      !line ||
      line.startsWith("#")
    )
      continue;
    const assignment = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
    assert(assignment, `unsupported Cargo dependency declaration: ${line}`);
    let value = assignment[2];
    const structuralDepth = input => {
      let depth = 0;
      let quoted = false;
      let escaped = false;
      for (const character of input) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (quoted && character === "\\") {
          escaped = true;
          continue;
        }
        if (character === '"') {
          quoted = !quoted;
          continue;
        }
        if (quoted) continue;
        if (character === "{" || character === "[") depth += 1;
        if (character === "}" || character === "]") depth -= 1;
      }
      return depth;
    };
    let depth = structuralDepth(value);
    while (depth > 0) {
      index += 1;
      assert(
        index < manifestLines.length,
        `unterminated Cargo dependency declaration: ${line}`
      );
      const continuation = manifestLines[index].trim();
      value += ` ${continuation}`;
      depth += structuralDepth(continuation);
    }
    assert(depth === 0, `malformed Cargo dependency declaration: ${line}`);
    assert(
      !/\b(?:git|path|registry|branch|tag|rev)\s*=/.test(value),
      `Cargo dependency ${assignment[1]} uses a forbidden source`
    );
    const stringVersion = value.match(/^"(=[^"]+)"$/)?.[1];
    const tableVersion = value.match(/\bversion\s*=\s*"(=[^"]+)"/)?.[1];
    const version = stringVersion ?? tableVersion;
    assert(
      version && EXACT_SEMVER.test(version.slice(1)),
      `Cargo dependency ${assignment[1]} must use an exact =version`
    );
  }
}

async function verifyTauriToolPolicy() {
  const [policySource, tauriSource, verifierSource] = await Promise.all([
    readFile(join(ROOT, "security", "tauri-tools.json"), "utf8"),
    readFile(join(ROOT, "src-tauri", "tauri.conf.json"), "utf8"),
    readFile(join(ROOT, "scripts", "security-prepare-tauri-tools.ps1"), "utf8"),
  ]);
  const policy = JSON.parse(policySource);
  const tauri = JSON.parse(tauriSource);
  assert(policy.schemaVersion === 1, "Tauri tool policy schema must be 1");
  assert(
    JSON.stringify(policy.artifacts) === JSON.stringify(REQUIRED_TAURI_TOOLS),
    "Tauri tool URLs, sizes, hashes, or signer policy changed without review"
  );
  assert(
    tauri.bundle?.useLocalToolsDir === true,
    "Tauri must use its repository-local reviewed tool cache"
  );
  assert(
    tauri.bundle?.resources?.[
      "../desktop/generated/THIRD-PARTY-NOTICES.txt"
    ] === "THIRD-PARTY-NOTICES.txt",
    "the installer must include the generated third-party notice as a top-level resource"
  );
  assert(
    tauri.bundle?.resources?.["../LICENSE"] === "LICENSE.txt",
    "the installer must include MAF V3's MIT license as a top-level resource"
  );
  assert(
    JSON.stringify(tauri.bundle?.targets) === JSON.stringify(["nsis"]),
    "the reviewed Windows bundle target is NSIS only"
  );
  assert(
    tauri.bundle?.windows?.webviewInstallMode?.type === "embedBootstrapper",
    "the installer must embed the pinned WebView2 bootstrapper"
  );
  assert(
    /Get-FileHash[\s\S]*SHA256/.test(verifierSource),
    "Tauri tool verifier must enforce SHA-256"
  );
  assert(
    /Get-AuthenticodeSignature/.test(verifierSource),
    "WebView2 Authenticode verification is required"
  );
  assert(
    /\[switch\]\$VerifyOnly/.test(verifierSource),
    "Tauri tool verifier needs a post-build verify-only mode"
  );
}

async function verifyWorkflows() {
  const workflowDirectory = join(ROOT, ".github", "workflows");
  const files = await listWorkflowFiles(workflowDirectory);
  assert(files.length > 0, "no GitHub Actions workflows found");

  for (const file of files) {
    const source = await readFile(file, "utf8");
    assert(
      !/^\s*pull_request_target\s*:/m.test(source),
      `${file} must not use pull_request_target`
    );
    for (const match of source.matchAll(
      /^\s*-?\s*uses:\s*([^\s#]+)(?:\s*#.*)?$/gm
    )) {
      const reference = match[1];
      if (reference.startsWith("./") || reference.startsWith("docker://"))
        continue;
      const at = reference.lastIndexOf("@");
      assert(at > 0, `${file} has an unpinned action: ${reference}`);
      const sha = reference.slice(at + 1);
      assert(
        /^[0-9a-f]{40}$/.test(sha),
        `${file} action must be pinned to a full commit SHA: ${reference}`
      );
    }
    if (source.includes("pnpm/setup@")) {
      const bootstrap = source.indexOf(
        "node scripts/security-verify-bootstrap.mjs"
      );
      const setup = source.indexOf("uses: pnpm/setup@");
      assert(
        bootstrap >= 0 && bootstrap < setup,
        `${file} must verify the pnpm bootstrap before pnpm/setup downloads it`
      );
    }
  }
  const unsignedWorkflow = await readFile(
    join(workflowDirectory, "release-unsigned.yml"),
    "utf8"
  );
  assert(
    !/^\s*push\s*:/m.test(unsignedWorkflow) &&
      /^\s*workflow_dispatch\s*:/m.test(unsignedWorkflow),
    "unsigned installer candidates must be started manually and never published from a version tag"
  );
  assert(
    /runs-on:\s*windows-2025/.test(unsignedWorkflow),
    "unsigned desktop candidate must build on Windows 2025"
  );
  assert(
    unsignedWorkflow.includes("node scripts/security-generate-notices.mjs") &&
      unsignedWorkflow.includes(
        "node scripts/security-generate-notices.mjs --check"
      ) &&
      unsignedWorkflow.includes("THIRD-PARTY-NOTICES.txt"),
    "unsigned desktop candidate must generate, verify, stage, and smoke-test third-party notices"
  );
  assert(
    unsignedWorkflow.includes("QUICK-START.md, LICENSE") &&
      unsignedWorkflow.includes("MAF-V3-Windows-tested-"),
    "handover must include user instructions, product license, and a smoke-tested artifact"
  );
  assert(
    unsignedWorkflow.includes(`runtime: node@${REQUIRED_BUILD_NODE}`) &&
      unsignedWorkflow.includes(`v${REQUIRED_BUILD_NODE}`),
    `unsigned desktop candidate must use Node ${REQUIRED_BUILD_NODE}`
  );
  assert(
    /security-prepare-tauri-tools\.ps1\s+-VerifyOnly/.test(unsignedWorkflow),
    "unsigned desktop bundling must verify the complete Tauri tool cache after use"
  );
  assert(
    /clean-install-smoke:[\s\S]*actions\/download-artifact@[0-9a-f]{40}[\s\S]*_x64-setup/.test(
      unsignedWorkflow
    ),
    "unsigned desktop candidate needs a no-checkout fresh-machine installer smoke test"
  );
  const smokeSection =
    unsignedWorkflow.match(/^  clean-install-smoke:\s*$([\s\S]*)/m)?.[0] ?? "";
  assert(smokeSection, "fresh-machine installer smoke job is missing");
  assert(
    !/(?:actions\/checkout|pnpm\/setup|pnpm install|npm install)/.test(
      smokeSection
    ),
    "fresh-machine installer smoke must have no checkout or dependency installation"
  );
  assert(
    unsignedWorkflow.includes("__maf_release_smoke") &&
      unsignedWorkflow.includes('"/UPDATE"'),
    "installer smoke test must prove restart and in-place reinstall persistence"
  );
  assert(
    /Verify all candidate checksums before execution[\s\S]*Get-FileHash[\s\S]*Install, launch first-run/.test(
      unsignedWorkflow
    ),
    "fresh-machine QA must verify checksums before executing the installer"
  );
  assert(
    /Uninstall unexpectedly deleted[\s\S]*Compare-Object[\s\S]*Retained workspace state|Uninstall unexpectedly deleted[\s\S]*Compare-Object/.test(
      unsignedWorkflow
    ),
    "installer smoke test must prove uninstall retains byte-identical user data"
  );
  assert(
    !/(?:AZURE_|artifact-signing|certificate-profile|client-secret)/i.test(
      unsignedWorkflow
    ),
    "unsigned candidate workflow must not receive a signing identity"
  );
}

async function main() {
  await verifyWorkspace();
  await verifyNpmrc();
  await verifyManifest();
  await verifyCargoPolicy();
  await verifyTauriToolPolicy();
  const [noticeGenerator, bootstrapVerifier, desktopPrepare, nativeRuntime] =
    await Promise.all([
      readFile(join(ROOT, REQUIRED_NOTICE_GENERATOR), "utf8"),
      readFile(join(ROOT, REQUIRED_BOOTSTRAP_VERIFIER), "utf8"),
      readFile(join(ROOT, "scripts", "desktop-prepare.mjs"), "utf8"),
      readFile(join(ROOT, "src-tauri", "src", "main.rs"), "utf8"),
    ]);
  assert(
    /node_modules[\\"', ]+\.pnpm/.test(noticeGenerator) &&
      /Cargo\.lock/.test(noticeGenerator) &&
      /--check/.test(noticeGenerator),
    "third-party notice generator must cover the frozen pnpm graph and Cargo.lock with a check mode"
  );
  assert(
    bootstrapVerifier.includes('const PNPM_VERSION = "11.16.0"') &&
      bootstrapVerifier.includes(EXPECTED_PNPM_BOOTSTRAP_INTEGRITY) &&
      /requireAge\(publishedAt, now/.test(bootstrapVerifier) &&
      /pnpm-linux-x64\.tar\.gz/.test(bootstrapVerifier) &&
      /pnpm-win32-x64\.zip/.test(bootstrapVerifier) &&
      /sha256:[0-9a-f]{64}/.test(bootstrapVerifier),
    "pnpm bootstrap verifier must pin npm metadata, exact-version age, and native Linux/Windows SHA-256 assets"
  );
  assert(
    /legalComments:\s*"eof"/.test(desktopPrepare) &&
      /schemaVersion:\s*2/.test(desktopPrepare) &&
      /thirdPartyNoticesSha256/.test(desktopPrepare) &&
      /manifest\.schema_version\s*!=\s*2/.test(nativeRuntime) &&
      /THIRD-PARTY-NOTICES\.txt/.test(nativeRuntime),
    "desktop runtime must preserve legal comments and integrity-bind third-party notices"
  );
  const npmVerifier = await readFile(
    join(ROOT, "scripts", "security-verify-lock.mjs"),
    "utf8"
  );
  assert(
    /age < MINIMUM_RELEASE_AGE_MS/.test(npmVerifier) &&
      /time\?\.\[pkg\.version\]/.test(npmVerifier) &&
      /registryIntegrity !== pkg\.integrity/.test(npmVerifier) &&
      !/packageQuietPeriod/.test(npmVerifier),
    "npm verifier must fail on young exact versions and integrity drift, not unrelated releases"
  );
  await verifyWorkflows();
  console.log(
    "Verified dependency policy, exact manifest pins, registry allowlist, and immutable Actions pins."
  );
}

main().catch(error => {
  const message =
    error instanceof Error
      ? error.message
      : "unknown configuration verifier failure";
  console.error(`SECURITY CONFIGURATION FAILED: ${message}`);
  process.exitCode = 1;
});
