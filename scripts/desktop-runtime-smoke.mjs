import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Serialized into a bundled-Node child with an isolated working directory.
// All imports must resolve within that copied runtime, never node_modules in
// the checkout. No fixture download, network access, or recipient data is used.
async function runtimeProbe() {
  const { default: assert } = await import("node:assert/strict");
  const { createRequire } = await import("node:module");
  const { default: path } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const require = createRequire(path.join(process.cwd(), "package.json"));
  const root = path.resolve(process.cwd()) + path.sep;
  for (const specifier of [
    "pdf-parse",
    "pdfjs-dist/legacy/build/pdf.mjs",
    "pdfjs-dist/legacy/build/pdf.worker.mjs",
    "@napi-rs/canvas",
    "@napi-rs/canvas-win32-x64-msvc",
    "better-sqlite3",
  ]) {
    const resolved = fileURLToPath(import.meta.resolve(specifier));
    assert.ok(
      resolved.toLowerCase().startsWith(root.toLowerCase()),
      `${specifier} escaped the isolated runtime: ${resolved}`
    );
  }
  globalThis.fetch = async () => {
    throw new Error("The desktop runtime smoke must not access the network.");
  };

  const Database = require("better-sqlite3");
  const db = new Database(":memory:");
  try {
    assert.equal(db.prepare("select 1 as ok").get().ok, 1);
  } finally {
    db.close();
  }

  const text = "MAF packaged PDF extraction works";
  // Keep the complete text inside a Letter-sized page. PDF.js correctly
  // excludes glyphs outside MediaBox, which would test clipping, not loading.
  const content = `BT /F1 18 Tf 50 700 Td (${text}) Tj ET\n`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  const { PDFParse } = await import("pdf-parse");
  assert.equal(typeof globalThis.DOMMatrix, "function");
  const parser = new PDFParse({ data: Buffer.from(pdf) });
  try {
    // Do not override workerSrc: this tests the same default local worker
    // resolution used by the application's PDF upload handler.
    const result = await parser.getText();
    assert.equal(result.total, 1);
    assert.ok(
      result.text.includes(text),
      `PDF text did not survive extraction: ${JSON.stringify(result.text)}`
    );
  } finally {
    await parser.destroy();
  }
  console.log(
    "Isolated bundled runtime: SQLite, native canvas, local PDF worker, and PDF extraction passed."
  );
}

export async function smokePreparedRuntime({ appRuntime, nodeExe }) {
  const fixture = await mkdtemp(path.join(tmpdir(), "maf-v3-runtime-smoke-"));
  const isolatedApp = path.join(fixture, "app");
  const source = path.resolve(appRuntime);
  try {
    const repository = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      ".."
    );
    for (const directory of [source, repository]) {
      const relative = path.relative(directory, fixture);
      assert.ok(
        relative === ".." ||
          relative.startsWith(`..${path.sep}`) ||
          path.isAbsolute(relative),
        "Smoke directory must be outside the repository and prepared runtime"
      );
    }
    await cp(source, isolatedApp, { recursive: true, dereference: false });
    const env = { ...process.env };
    for (const key of Object.keys(env)) {
      if (
        [
          "NODE_OPTIONS",
          "NODE_PATH",
          "ELECTRON_RUN_AS_NODE",
          "NAPI_RS_NATIVE_LIBRARY_PATH",
        ].includes(key.toUpperCase())
      ) {
        delete env[key];
      }
    }
    const result = spawnSync(
      path.resolve(nodeExe),
      [
        "--input-type=module",
        "-e",
        `(${runtimeProbe.toString()})().catch(error => { console.error(error); process.exitCode = 1; });`,
      ],
      {
        cwd: isolatedApp,
        env,
        encoding: "utf8",
        windowsHide: true,
        timeout: 60_000,
      }
    );
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.error) throw result.error;
    assert.equal(result.status, 0, "Isolated desktop runtime smoke failed");
  } finally {
    // mkdtemp supplies this exact, private target; never remove appRuntime.
    await rm(fixture, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  smokePreparedRuntime({
    appRuntime: path.join(root, "desktop", "runtime", "app"),
    nodeExe: path.join(root, "desktop", "runtime", "node", "node.exe"),
  }).catch(error => {
    console.error(
      `[desktop-runtime-smoke] ${error instanceof Error ? error.message : String(error)}`
    );
    process.exitCode = 1;
  });
}
