import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BUILD_SECTIONS, BUILD_STEPS } from "../shared/maf-constants";
import type { TrpcContext } from "./_core/context";

const mocks = vi.hoisted(() => ({
  llm: vi.fn(), image: vi.fn(), storage: vi.fn(), pdfText: vi.fn(), pdfDestroy: vi.fn(),
}));
vi.mock("./_core/llm", () => ({ invokeLLM: mocks.llm }));
vi.mock("./_core/imageGeneration", () => ({ generateImage: mocks.image }));
vi.mock("./storage", () => ({ storagePut: mocks.storage }));
vi.mock("./integrations", () => ({
  hasIntegration: vi.fn(async () => true), searchWeb: vi.fn(async () => []),
  clearIntegrationSecret: vi.fn(), listIntegrationSummaries: vi.fn(),
  saveIntegrationSettings: vi.fn(), testIntegration: vi.fn(),
}));
vi.mock("pdf-parse", () => ({
  PDFParse: class {
    getText = mocks.pdfText;
    destroy = mocks.pdfDestroy;
  },
}));

let directory: string;
let database: typeof import("./db");
let caller: ReturnType<typeof import("./routers").appRouter.createCaller>;
let workspaceId: number;
const artifact = {
  title: "A useful strategy",
  content: "Specific advice grounded in the owner's supplied business and audience context. ".repeat(3),
  summary: "A concise strategic summary.",
};
const content = { title: "One useful idea", body: "A clear and helpful post.", hook: "Start here.", hashtags: [], notes: "Useful context." };
const response = (value: unknown) => ({ choices: [{ message: { content: JSON.stringify(value) }, finish_reason: "stop" }] });

beforeEach(async () => {
  directory = mkdtempSync(path.join(os.tmpdir(), "maf-workflow-"));
  vi.stubEnv("MAF_DATA_DIR", directory);
  vi.stubEnv("MAF_MIGRATIONS_DIR", path.resolve("drizzle"));
  vi.stubEnv("APP_WORKSPACE_ID", "");
  vi.resetModules();
  vi.clearAllMocks();
  mocks.llm.mockImplementation(async (request: any) => {
    const name = request.response_format?.json_schema?.name;
    if (name === "artifact") return response(artifact);
    if (name === "critic_review") return response({ feedback: "Keep it clear.", score: 8 });
    if (name === "content_ideas") return response({ ideas: Array.from({ length: 3 }, () => ({
      title: "A useful idea", angle: "educate", hook: "Start here", whyItFits: "Audience need", pillar: "Help", platforms: ["linkedin"],
    })) });
    return response(content);
  });
  mocks.pdfText.mockResolvedValue({ text: "Actual extracted PDF text." });
  mocks.pdfDestroy.mockResolvedValue(undefined);
  mocks.storage.mockResolvedValue({ key: "private/document.pdf", url: "/api/media/document.pdf" });
  database = await import("./db");
  workspaceId = await database.resolveWorkspaceId();
  const { appRouter } = await import("./routers");
  caller = appRouter.createCaller({ workspaceId, req: {} as TrpcContext["req"], res: {} as TrpcContext["res"] });
});

afterEach(() => {
  database?.closeDatabase();
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});

async function completeBuild() {
  for (const section of BUILD_SECTIONS) {
    for (const step of BUILD_STEPS[section]) {
      const state = await caller.build.getState();
      expect(state.subSteps.find(item => item.stepKey === step.key)?.status).not.toBe("locked");
      if (step.key === "3c") {
        await caller.visualIdentity.skip();
        continue;
      }
      const before = mocks.llm.mock.calls.length;
      if (step.hasIntake) await caller.build.saveIntake({ stepKey: step.key, intakeData: step.key === "2a"
        ? { offers: [{ name: "Coaching", price: "$100", description: "One focused session." }], uniqueStrengths: "Personal support" }
        : { industry: "Training", audience: "Small business owners" } });
      if (step.hasAI) await caller.build.generate({ stepKey: step.key });
      else expect(mocks.llm.mock.calls.length).toBe(before);
      await caller.build.approve({ stepKey: step.key });
    }
  }
}

describe("fresh-user workflows with private SQLite and stubbed providers", () => {
  it("finishes every BUILD step, ideas, CREATE, repurpose, archive, and restore", async () => {
    await expect(caller.build.approve({ stepKey: "1a" })).rejects.toThrow("review");
    await expect(caller.build.generate({ stepKey: "2b" })).rejects.toThrow("unlock");
    await completeBuild();
    expect((await caller.build.getState()).sections.every(section => section.status === "approved")).toBe(true);
    expect(await database.getEngineConfig(workspaceId)).toBeTruthy();
    expect((await caller.ideas.generate({ count: 3 })).ideas).toHaveLength(3);
    const created = await caller.create.generate({ platform: "linkedin", contentType: "educate", direction: { substance: "Useful lesson", takeaway: "Try it" } });
    expect(created.outputId).toBeTypeOf("number");
    await caller.create.approve({ outputId: created.outputId! });
    const repurposed = await caller.create.repurpose({ parentId: created.outputId!, platforms: ["email", "blog"] });
    expect(repurposed.results).toHaveLength(2);
    await caller.create.updateStatus({ outputId: created.outputId!, status: "archived" });
    expect(await caller.library.list({ status: "archived" })).toHaveLength(1);
    await caller.create.updateStatus({ outputId: created.outputId!, status: "draft" });
    expect(await caller.library.list({ status: "archived" })).toHaveLength(0);
    expect(await caller.library.list()).toHaveLength(3);
  });

  it("invalidates downstream approvals after a changed foundation and closes CREATE", async () => {
    await completeBuild();
    await caller.build.reopen({ stepKey: "1a" });
    await expect(caller.create.generate({ platform: "linkedin", contentType: "educate", direction: { substance: "A topic", takeaway: "Try it" } })).rejects.toThrow("BUILD");
    await caller.build.approve({ stepKey: "1a", editedContent: { ...artifact, content: "Changed facts" } });
    const state = await caller.build.getState();
    expect(state.subSteps.filter(step => step.stepKey !== "1a").every(step => step.status === "amber")).toBe(true);
    expect(state.sections.every(section => section.status !== "approved")).toBe(true);
    await expect(caller.ideas.generate({ count: 3 })).rejects.toThrow("BUILD");
  });

  it("keeps a reviewable draft after provider failure and makes interrupted work retryable on restart", async () => {
    await database.updateSubStepStatus(workspaceId, "1a", "review", { artifactContent: artifact });
    mocks.llm.mockRejectedValueOnce(new Error("Provider timeout"));
    await expect(caller.build.generate({ stepKey: "1a" })).rejects.toThrow("Provider timeout");
    expect(await database.getSubStep(workspaceId, "1a")).toMatchObject({ status: "review", artifactContent: artifact });
    await database.updateSubStepStatus(workspaceId, "1a", "generating");
    await database.updateSubStepStatus(workspaceId, "1b", "generating", { intakeData: { audience: "Owners" } });
    database.closeDatabase();
    await database.initializeDatabase();
    expect(await database.getSubStep(workspaceId, "1a")).toMatchObject({ status: "review", artifactContent: artifact });
    expect(await database.getSubStep(workspaceId, "1b")).toMatchObject({ status: "intake_complete" });
  });

  it("extracts PDF text rather than object labels and rejects unreadable documents", async () => {
    const input = { stepKey: "1a", fileName: "context.pdf", fileType: "pdf", fileContent: Buffer.from("pdf test").toString("base64") };
    await caller.files.upload(input);
    expect((await database.getFileUploadsForWorkspace(workspaceId, "1a"))[0].extractedText).toBe("Actual extracted PDF text.");
    expect(mocks.pdfDestroy).toHaveBeenCalledOnce();
    mocks.pdfText.mockRejectedValueOnce(new Error("Encrypted document"));
    await expect(caller.files.upload(input)).rejects.toThrow("could not be read");
    expect(mocks.pdfDestroy).toHaveBeenCalledTimes(2);
    expect(mocks.storage).toHaveBeenCalledOnce();
  });

  it("preserves paid text when an optional image fails and retries only failed repurpose platforms", async () => {
    await completeBuild();
    mocks.image.mockRejectedValueOnce(new Error("Image provider unavailable"));
    const created = await caller.create.generate({ platform: "linkedin", contentType: "educate", direction: { substance: "A useful lesson", takeaway: "Try it" }, includeImage: true });
    expect(created.imageWarning).toContain("text was saved");
    expect(await caller.library.getById({ id: created.outputId! })).toMatchObject({ content, imageUrl: null });
    mocks.llm.mockResolvedValueOnce(response(content)).mockRejectedValueOnce(new Error("Temporary outage"));
    const partial = await caller.create.repurpose({ parentId: created.outputId!, platforms: ["email", "blog"] });
    expect(partial.results).toHaveLength(1);
    expect(partial.failures).toEqual([{ platform: "blog", message: "Temporary outage" }]);
    const retry = await caller.create.repurpose({ parentId: created.outputId!, platforms: partial.failures.map(failure => failure.platform) });
    expect(retry.failures).toEqual([]);
    expect(await caller.library.list()).toHaveLength(3);
  });

  it("preserves saved intake drafts across restart, including explicitly cleared fields", async () => {
    await caller.autosave.saveDraft({ stepKey: "1a", intakeData: { industry: "Training", marketContext: "Old details" } });
    await caller.autosave.saveDraft({ stepKey: "1a", intakeData: { industry: "Training", marketContext: "" } });
    database.closeDatabase();
    expect(await caller.build.getStep({ stepKey: "1a" })).toMatchObject({ intakeData: { industry: "Training", marketContext: "" } });
  });

  it("paginates older content deterministically and rejects invalid pagination/status updates", async () => {
    for (let index = 0; index < 55; index++) await database.createOutput({ workspaceId, platform: "email", contentType: "educate", content });
    const first = await caller.library.list({ limit: 50 });
    const second = await caller.library.list({ limit: 50, cursor: 50 });
    expect(first).toHaveLength(50);
    expect(second).toHaveLength(5);
    expect(new Set([...first, ...second].map(item => item.id)).size).toBe(55);
    await expect(caller.library.list({ limit: -1 })).rejects.toThrow();
    await expect(caller.create.updateStatus({ outputId: 9999, status: "archived" })).rejects.toThrow("not found");
  });
});
