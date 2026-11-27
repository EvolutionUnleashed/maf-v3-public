import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

// Resolve through Mammoth's own dependency tree so this exercises the patched
// XML parser and existing ZIP implementation that the upload handler uses.
const localRequire = createRequire(import.meta.url);
const mammothRequire = createRequire(localRequire.resolve("mammoth"));
const JSZip = mammothRequire("jszip");

let directory: string;
let database: typeof import("./db");
let caller: ReturnType<typeof import("./routers").appRouter.createCaller>;
let workspaceId: number;

async function docxFixture(body: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);
  zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${body}<w:sectPr/></w:body>
</w:document>`);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

function upload(buffer: Buffer) {
  return caller.files.upload({
    stepKey: "1a",
    fileName: "synthetic-brand-context.docx",
    fileType: "docx",
    fileContent: buffer.toString("base64"),
  });
}

beforeEach(async () => {
  directory = mkdtempSync(path.join(os.tmpdir(), "maf-docx-extraction-"));
  vi.stubEnv("MAF_DATA_DIR", directory);
  vi.stubEnv("MAF_MIGRATIONS_DIR", path.resolve("drizzle"));
  vi.stubEnv("APP_WORKSPACE_ID", "");
  vi.resetModules();
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Document extraction must stay offline."));
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  database = await import("./db");
  workspaceId = await database.resolveWorkspaceId();
  const { appRouter } = await import("./routers");
  caller = appRouter.createCaller({
    workspaceId,
    req: {} as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  });
});

afterEach(() => {
  database?.closeDatabase();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(directory, { recursive: true, force: true });
});

describe("real DOCX uploads with the patched Mammoth XML parser", () => {
  it("uses xmldom 0.8.15 and preserves Unicode, entities, paragraphs, and table text", async () => {
    expect(mammothRequire("@xmldom/xmldom/package.json").version).toBe("0.8.15");
    const buffer = await docxFixture(`
      <w:p><w:r><w:t>Brand &amp; audience: café</w:t></w:r></w:p>
      <w:p><w:r><w:t>Practical guidance for small business owners.</w:t><w:br/><w:t>A second useful line.</w:t></w:r></w:p>
      <w:tbl><w:tr><w:tc><w:p><w:r><w:t>Offer: personal coaching</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
    `);
    const result = await upload(buffer);
    const records = await database.getFileUploadsForWorkspace(workspaceId, "1a");
    expect(records).toHaveLength(1);
    const extracted = records[0].extractedText!;
    expect(extracted).toContain("Brand & audience: café\n\n");
    // Mammoth's raw-text API omits inline w:br separators; both text runs and
    // paragraph separators must still survive the parser dependency update.
    expect(extracted).toContain("Practical guidance for small business owners.");
    expect(extracted).toContain("A second useful line.\n\n");
    expect(extracted).toContain("Offer: personal coaching");
    expect(extracted).not.toContain("<w:");
    expect(extracted).not.toContain("[object Object]");
    expect(result.tokenCount).toBe(Math.round(extracted.length / 4));
    expect(result.storageUrl).toMatch(/^\/media\//);
    const { storageRead } = await import("./storage");
    expect(await storageRead(records[0].storageKey!)).toEqual(buffer);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("rejects malformed ZIP data without storing binary text or upload records", async () => {
    await expect(upload(Buffer.from("This is not a DOCX ZIP archive."))).rejects.toThrow("could not be read");
    expect(await database.getFileUploadsForWorkspace(workspaceId, "1a")).toEqual([]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("rejects a structurally valid DOCX with no readable text", async () => {
    await expect(upload(await docxFixture("<w:p/>"))).rejects.toThrow("no readable text");
    expect(await database.getFileUploadsForWorkspace(workspaceId, "1a")).toEqual([]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
