import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createReadStream, existsSync } from "node:fs";
import {
  cp,
  copyFile,
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { smokePreparedRuntime } from "./desktop-runtime-smoke.mjs";

const NODE_VERSION = "24.18.0";
const NODE_ARCHIVE = `node-v${NODE_VERSION}-win-x64.zip`;
const NODE_URL = `https://nodejs.org/dist/v${NODE_VERSION}/${NODE_ARCHIVE}`;
const NODE_ARCHIVE_SHA256 =
  "0ae68406b42d7725661da979b1403ec9926da205c6770827f33aac9d8f26e821";
const MAX_RUNTIME_FILES = 5_000;
const MAX_RUNTIME_BYTES = 100 * 1024 * 1024;
const MAX_RUNTIME_RELATIVE_PATH = 160;
const TREE_DIGEST_GOLDEN =
  "35643da7c6b3a20b4715d3908f25d6fa02398556d354b4c2d6f8661dc16e7851";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimeRoot = path.join(root, "desktop", "runtime");
const appRuntime = path.join(runtimeRoot, "app");
const nodeRuntime = path.join(runtimeRoot, "node");
const cacheRoot = path.join(root, "desktop", ".cache");
const extractRoot = path.join(cacheRoot, `node-v${NODE_VERSION}-extract`);
const cachedArchive = path.join(cacheRoot, NODE_ARCHIVE);
const generatedNotices = path.join(
  root,
  "desktop",
  "generated",
  "THIRD-PARTY-NOTICES.txt"
);

function fail(message) {
  throw new Error(message);
}

function assertInside(child, parent, label) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    fail(`${label} is outside its expected desktop build directory: ${child}`);
  }
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    const input = createReadStream(filePath);
    input.on("data", chunk => hash.update(chunk));
    input.on("error", reject);
    input.on("end", resolve);
  });
  return hash.digest("hex");
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
    windowsHide: true,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = options.capture
      ? `\n${result.stderr || result.stdout || ""}`
      : "";
    fail(`${command} exited with code ${result.status}.${detail}`);
  }
  return options.capture ? String(result.stdout || "").trim() : "";
}

async function acquireNodeArchive() {
  await mkdir(cacheRoot, { recursive: true });
  const supplied = process.env.MAF_NODE_ARCHIVE?.trim();
  if (supplied) {
    const source = path.resolve(supplied);
    if (!existsSync(source)) fail(`MAF_NODE_ARCHIVE does not exist: ${source}`);
    if (path.resolve(source) !== path.resolve(cachedArchive))
      await copyFile(source, cachedArchive);
  } else if (!existsSync(cachedArchive)) {
    console.log(`Downloading the pinned official Node.js runtime: ${NODE_URL}`);
    const response = await fetch(NODE_URL, { redirect: "error" });
    if (!response.ok || !response.body) {
      fail(`Node.js download failed with HTTP ${response.status}.`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    await writeFile(cachedArchive, bytes, { flag: "wx" });
  }

  const actual = await sha256File(cachedArchive);
  if (actual !== NODE_ARCHIVE_SHA256) {
    await rm(cachedArchive, { force: true });
    fail(
      `Node.js archive checksum mismatch. Expected ${NODE_ARCHIVE_SHA256}, received ${actual}.`
    );
  }
}

async function prepareNodeRuntime() {
  assertInside(nodeRuntime, runtimeRoot, "Node runtime");
  assertInside(extractRoot, cacheRoot, "Node extraction folder");
  await acquireNodeArchive();
  await rm(extractRoot, { recursive: true, force: true });
  await mkdir(extractRoot, { recursive: true });
  run("tar.exe", ["-xf", cachedArchive, "-C", extractRoot]);

  const extracted = path.join(extractRoot, `node-v${NODE_VERSION}-win-x64`);
  const nodeExe = path.join(extracted, "node.exe");
  const license = path.join(extracted, "LICENSE");
  if (!existsSync(nodeExe) || !existsSync(license))
    fail("The verified Node.js archive has an unexpected layout.");

  await rm(nodeRuntime, { recursive: true, force: true });
  await mkdir(nodeRuntime, { recursive: true });
  await copyFile(nodeExe, path.join(nodeRuntime, "node.exe"));
  await copyFile(license, path.join(nodeRuntime, "LICENSE.node.txt"));
  await rm(extractRoot, { recursive: true, force: true });
}

async function copyRuntimePackage(packageName, sourceDirectory, selections) {
  const destination = path.join(appRuntime, "node_modules", packageName);
  await mkdir(destination, { recursive: true });
  for (const selection of selections) {
    const source = path.join(sourceDirectory, selection);
    if (!existsSync(source))
      fail(`${packageName} runtime file is missing: ${selection}`);
    const target = path.join(destination, selection);
    const metadata = await lstat(source);
    await mkdir(path.dirname(target), { recursive: true });
    if (metadata.isDirectory()) {
      await cp(source, target, { recursive: true, dereference: true });
    } else if (metadata.isFile()) {
      await copyFile(source, target);
    } else {
      fail(
        `${packageName} runtime source is not a regular file or directory: ${selection}`
      );
    }
  }
}

async function prepareApplicationRuntime() {
  assertInside(appRuntime, runtimeRoot, "Application runtime");
  if (!existsSync(path.join(root, "node_modules"))) {
    fail(
      "node_modules is missing. Restore the reviewed, frozen dependency install on the release workstation first."
    );
  }
  if (!existsSync(path.join(root, "dist", "index.js"))) {
    fail(
      "dist/index.js is missing. Run `pnpm build` before desktop preparation."
    );
  }
  if (!existsSync(generatedNotices)) {
    fail(
      "THIRD-PARTY-NOTICES.txt is missing. Fetch the reviewed Cargo lockfile and run `node scripts/security-generate-notices.mjs` first."
    );
  }
  run("node", ["scripts/security-generate-notices.mjs", "--check"]);

  await rm(appRuntime, { recursive: true, force: true });
  await mkdir(path.join(appRuntime, "dist"), { recursive: true });
  await mkdir(path.join(appRuntime, "node_modules"), { recursive: true });
  await copyFile(
    generatedNotices,
    path.join(appRuntime, "THIRD-PARTY-NOTICES.txt")
  );

  // Bundle the server except packages with runtime-relative worker/native
  // loading. Preserve PDF.js's module boundary so its local worker resolves
  // beside pdf.mjs, and copy its native canvas support from the frozen install.
  await build({
    entryPoints: [path.join(root, "dist", "index.js")],
    outfile: path.join(appRuntime, "dist", "index.js"),
    bundle: true,
    platform: "node",
    target: "node24",
    format: "esm",
    external: ["better-sqlite3", "pdf-parse"],
    banner: {
      js: "import { createRequire as __mafCreateRequire } from 'node:module'; const require = __mafCreateRequire(import.meta.url);",
    },
    // Preserve esbuild-recognized legal comments in the server bundle. The
    // deterministic full-graph notice is also shipped because browser/Rust
    // transforms do not provide a complete legal-comment preservation model.
    legalComments: "eof",
    minify: false,
    sourcemap: false,
    logLevel: "info",
  });

  await Promise.all([
    cp(
      path.join(root, "dist", "public"),
      path.join(appRuntime, "dist", "public"),
      { recursive: true }
    ),
    cp(path.join(root, "drizzle"), path.join(appRuntime, "drizzle"), {
      recursive: true,
    }),
  ]);

  const requireFromRoot = createRequire(path.join(root, "package.json"));
  const sqlitePackage = requireFromRoot.resolve("better-sqlite3/package.json");
  const sqliteDirectory = path.dirname(sqlitePackage);
  const bindingsPackage = createRequire(sqlitePackage).resolve(
    "bindings/package.json"
  );
  const bindingsDirectory = path.dirname(bindingsPackage);
  const fileUriPackage = createRequire(bindingsPackage).resolve(
    "file-uri-to-path/package.json"
  );
  const fileUriDirectory = path.dirname(fileUriPackage);

  await copyRuntimePackage("better-sqlite3", sqliteDirectory, [
    "package.json",
    "LICENSE",
    "lib",
    "build/Release/better_sqlite3.node",
  ]);
  await copyRuntimePackage("bindings", bindingsDirectory, [
    "package.json",
    "LICENSE.md",
    "bindings.js",
  ]);
  await copyRuntimePackage("file-uri-to-path", fileUriDirectory, [
    "package.json",
    "LICENSE",
    "index.js",
  ]);

  const pdfPackage = requireFromRoot.resolve("pdf-parse");
  const pdfDirectory = path.resolve(path.dirname(pdfPackage), "../../..");
  const requireFromPdf = createRequire(pdfPackage);
  const pdfjsPackage = requireFromPdf.resolve("pdfjs-dist/package.json");
  const pdfjsDirectory = path.dirname(pdfjsPackage);
  const canvasPackage = createRequire(pdfjsPackage).resolve(
    "@napi-rs/canvas/package.json"
  );
  const canvasDirectory = path.dirname(canvasPackage);
  const canvasNativePackage = createRequire(canvasPackage).resolve(
    "@napi-rs/canvas-win32-x64-msvc/package.json"
  );
  const canvasNativeDirectory = path.dirname(canvasNativePackage);

  await copyRuntimePackage("pdf-parse", pdfDirectory, [
    "package.json",
    "LICENSE",
    "dist/pdf-parse/esm",
  ]);
  await copyRuntimePackage("pdfjs-dist", pdfjsDirectory, [
    "package.json",
    "LICENSE",
    "legacy/build/pdf.mjs",
    "legacy/build/pdf.worker.mjs",
    "cmaps",
    "standard_fonts",
    "wasm",
  ]);
  await copyRuntimePackage("@napi-rs/canvas", canvasDirectory, [
    "package.json",
    "LICENSE",
    "index.js",
    "geometry.js",
    "js-binding.js",
    "load-image.js",
  ]);
  await copyRuntimePackage(
    "@napi-rs/canvas-win32-x64-msvc",
    canvasNativeDirectory,
    ["package.json", "skia.win32-x64-msvc.node", "icudtl.dat"]
  );

  const pdfRuntimeDependencies = {};
  for (const directory of [
    pdfDirectory,
    pdfjsDirectory,
    canvasDirectory,
    canvasNativeDirectory,
  ]) {
    const metadata = JSON.parse(
      await readFile(path.join(directory, "package.json"), "utf8")
    );
    pdfRuntimeDependencies[metadata.name] = metadata.version;
  }

  const sourcePackage = JSON.parse(
    await readFile(path.join(root, "package.json"), "utf8")
  );
  const runtimePackage = {
    name: sourcePackage.name,
    version: sourcePackage.version,
    private: true,
    type: "module",
    dependencies: {
      "better-sqlite3": "12.4.1",
      bindings: "1.5.0",
      "file-uri-to-path": "1.0.0",
      ...pdfRuntimeDependencies,
    },
  };
  await writeFile(
    path.join(appRuntime, "package.json"),
    `${JSON.stringify(runtimePackage, null, 2)}\n`,
    "utf8"
  );

  const bundledNode = path.join(nodeRuntime, "node.exe");
  run(
    bundledNode,
    [
      "-e",
      "const Database=require('better-sqlite3');const db=new Database(':memory:');if(db.prepare('select 1 as ok').get().ok!==1)process.exit(2);db.close()",
    ],
    { cwd: appRuntime }
  );
}

async function collectTreeDigest(directory) {
  const aggregate = createHash("sha256");
  let fileCount = 0;
  let totalBytes = 0;
  let maxRelativePathLength = 0;

  async function visit(current, relative) {
    const entries = await readdir(current, { withFileTypes: true });
    entries.sort((left, right) =>
      Buffer.compare(
        Buffer.from(left.name, "utf8"),
        Buffer.from(right.name, "utf8")
      )
    );
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      const childRelative = path.posix.join(relative, entry.name);
      if (childRelative === "desktop-runtime-manifest.json") continue;
      maxRelativePathLength = Math.max(
        maxRelativePathLength,
        childRelative.length
      );
      const details = await lstat(absolute);
      if (details.isDirectory()) {
        await visit(absolute, childRelative);
      } else if (details.isSymbolicLink()) {
        fail(
          `Desktop application runtime must not contain symbolic links: ${childRelative}`
        );
      } else if (details.isFile()) {
        const digest = await sha256File(absolute);
        fileCount += 1;
        totalBytes += details.size;
        aggregate.update(
          `${childRelative}\0file\0${details.size}\0${digest}\n`
        );
      }
    }
  }

  await visit(directory, "");
  const tree = {
    sha256: aggregate.digest("hex"),
    fileCount,
    totalBytes,
    maxRelativePathLength,
  };
  if (fileCount > MAX_RUNTIME_FILES)
    fail(
      `Desktop runtime exceeds the ${MAX_RUNTIME_FILES}-file release budget: ${fileCount}.`
    );
  if (totalBytes > MAX_RUNTIME_BYTES)
    fail(
      `Desktop runtime exceeds the ${MAX_RUNTIME_BYTES}-byte release budget: ${totalBytes}.`
    );
  if (maxRelativePathLength > MAX_RUNTIME_RELATIVE_PATH) {
    fail(
      `Desktop runtime path exceeds the ${MAX_RUNTIME_RELATIVE_PATH}-character release budget: ${maxRelativePathLength}.`
    );
  }
  return tree;
}

async function verifyTreeDigestContract() {
  const fixture = await mkdtemp(path.join(tmpdir(), "maf-v3-tree-digest-"));
  try {
    const files = [
      [".bin/tool", "one"],
      ["@scope/pkg", "two"],
      ["Zed", "three"],
      ["_foo", "four"],
      ["alpha", "five"],
    ];
    for (const [relative, contents] of files) {
      const destination = path.join(fixture, relative);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, contents, "utf8");
    }
    const tree = await collectTreeDigest(fixture);
    if (
      tree.sha256 !== TREE_DIGEST_GOLDEN ||
      tree.fileCount !== 5 ||
      tree.totalBytes !== 19 ||
      tree.maxRelativePathLength !== 10
    ) {
      fail(
        `Desktop tree digest contract changed unexpectedly: ${JSON.stringify(tree)}.`
      );
    }
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
}

async function locateNativeAddon(directory) {
  const matches = [];
  async function visit(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile() && entry.name === "better_sqlite3.node")
        matches.push(absolute);
    }
  }
  await visit(directory);
  if (matches.length !== 1)
    fail(
      `Expected exactly one better_sqlite3.node binary, found ${matches.length}.`
    );
  return matches[0];
}

async function writeRuntimeManifest() {
  const packageDocument = JSON.parse(
    await readFile(path.join(root, "package.json"), "utf8")
  );
  const nodeExe = path.join(nodeRuntime, "node.exe");
  const addon = await locateNativeAddon(path.join(appRuntime, "node_modules"));
  const tree = await collectTreeDigest(appRuntime);
  const manifest = {
    schemaVersion: 2,
    application: {
      name: packageDocument.name,
      version: packageDocument.version,
      tree,
      entrySha256: await sha256File(path.join(appRuntime, "dist", "index.js")),
      lockfileSha256: await sha256File(path.join(root, "pnpm-lock.yaml")),
      thirdPartyNoticesSha256: await sha256File(
        path.join(appRuntime, "THIRD-PARTY-NOTICES.txt")
      ),
      nativeAddon: {
        path: path.relative(appRuntime, addon).split(path.sep).join("/"),
        sha256: await sha256File(addon),
      },
    },
    node: {
      version: NODE_VERSION,
      platform: "win-x64",
      source: NODE_URL,
      archiveSha256: NODE_ARCHIVE_SHA256,
      executableSha256: await sha256File(nodeExe),
      licenseSha256: await sha256File(
        path.join(nodeRuntime, "LICENSE.node.txt")
      ),
      npmBundled: false,
    },
  };
  await writeFile(
    path.join(appRuntime, "desktop-runtime-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
  );
}

async function main() {
  if (process.platform !== "win32" || process.arch !== "x64") {
    fail(
      "The current desktop bundle targets Windows x64 and must be prepared on Windows x64."
    );
  }
  assertInside(appRuntime, root, "Application runtime");
  assertInside(nodeRuntime, root, "Node runtime");
  await mkdir(runtimeRoot, { recursive: true });
  await verifyTreeDigestContract();
  if (process.argv.slice(2).includes("--manifest-only")) {
    if (
      !existsSync(path.join(appRuntime, "node_modules")) ||
      !existsSync(path.join(nodeRuntime, "node.exe"))
    ) {
      fail(
        "The prepared application and Node runtime are required before refreshing the manifest."
      );
    }
    await writeRuntimeManifest();
    console.log(
      "Desktop runtime manifest refreshed without downloading or deploying dependencies."
    );
    return;
  }
  await prepareNodeRuntime();
  await prepareApplicationRuntime();
  await writeRuntimeManifest();
  await smokePreparedRuntime({
    appRuntime,
    nodeExe: path.join(nodeRuntime, "node.exe"),
  });

  const size = (await stat(path.join(nodeRuntime, "node.exe"))).size;
  console.log(`Desktop runtime is ready at ${runtimeRoot}`);
  console.log(
    `Bundled Node.js: v${NODE_VERSION}, node.exe ${size} bytes, npm omitted`
  );
  console.log(`Verified archive SHA-256: ${NODE_ARCHIVE_SHA256}`);
}

main().catch(error => {
  console.error(
    `[desktop-prepare] ${error instanceof Error ? error.message : String(error)}`
  );
  process.exitCode = 1;
});
