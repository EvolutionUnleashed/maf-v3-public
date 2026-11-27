import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const INTEGRATION_ENVIRONMENT_VARIABLES = [
  "MAF_CONFIG_ENCRYPTION_KEY",
  "MAF_INTEGRATION_TIMEOUT_MS",
  "MAF_INTEGRATION_TEST_TIMEOUT_MS",
  "MAF_LLM_TIMEOUT_MS",
  "MAF_IMAGE_TIMEOUT_MS",
  "MAF_INTELLIGENCE_PROVIDER",
  "MAF_INTELLIGENCE_API_KEY",
  "MAF_INTELLIGENCE_MODEL",
  "MAF_INTELLIGENCE_BASE_URL",
  "MAF_INTELLIGENCE_ENABLED",
  "MAF_SEARCH_PROVIDER",
  "MAF_SEARCH_API_KEY",
  "MAF_SEARCH_MODEL",
  "MAF_SEARCH_BASE_URL",
  "MAF_SEARCH_ENABLED",
  "MAF_IMAGE_PROVIDER",
  "MAF_IMAGE_API_KEY",
  "MAF_IMAGE_MODEL",
  "MAF_IMAGE_BASE_URL",
  "MAF_IMAGE_ENABLED",
  "MAF_DESKTOP",
  "OPENAI_API_KEY",
  "OPENAI_MODEL",
  "OPENAI_BASE_URL",
  "OPENAI_INTELLIGENCE_API_KEY",
  "OPENAI_INTELLIGENCE_MODEL",
  "OPENAI_INTELLIGENCE_BASE_URL",
  "OPENAI_IMAGE_API_KEY",
  "OPENAI_IMAGE_MODEL",
  "OPENAI_IMAGE_BASE_URL",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_MODEL",
  "ANTHROPIC_BASE_URL",
  "GEMINI_API_KEY",
  "GEMINI_MODEL",
  "GEMINI_BASE_URL",
  "GEMINI_INTELLIGENCE_API_KEY",
  "GEMINI_INTELLIGENCE_MODEL",
  "GEMINI_INTELLIGENCE_BASE_URL",
  "GEMINI_IMAGE_API_KEY",
  "GEMINI_IMAGE_MODEL",
  "GEMINI_IMAGE_BASE_URL",
  "GOOGLE_API_KEY",
  "TAVILY_API_KEY",
  "TAVILY_BASE_URL",
] as const;

let testDataDirectory: string;
const TINY_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=";

beforeEach(async () => {
  vi.resetModules();
  for (const name of INTEGRATION_ENVIRONMENT_VARIABLES) vi.stubEnv(name, "");
  testDataDirectory = await mkdtemp(path.join(tmpdir(), "maf-integrations-test-"));
  vi.stubEnv("MAF_DATA_DIR", testDataDirectory);
});

afterEach(async () => {
  vi.useRealTimers();
  vi.doUnmock("node:dns/promises");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await rm(testDataDirectory, { recursive: true, force: true });
});

describe("encrypted integration settings", () => {
  it("can clear a custom endpoint and keeps the changed settings after restart", async () => {
    let config = await import("./config");
    await config.saveIntegrationSettings({
      capability: "intelligence", provider: "anthropic", model: "saved-model",
      baseUrl: "https://proxy.example.test", apiKey: "proxy-secret",
    });
    await config.setIntegrationVerification("intelligence", true);
    await config.saveIntegrationSettings({
      capability: "intelligence", provider: "anthropic", model: "saved-model",
      baseUrl: "", apiKey: "direct-provider-secret",
    });
    vi.resetModules();
    config = await import("./config");
    expect(await config.resolveIntegration("intelligence")).toMatchObject({
      provider: "anthropic", model: "saved-model", baseUrl: undefined,
      apiKey: "direct-provider-secret", verified: false,
    });
  });

  it("encrypts secrets at rest and returns masked summaries only", async () => {
    const secret = "private-integration-key-7890";
    const { listIntegrationSummaries, saveIntegrationSettings } = await import("./config");

    const saved = await saveIntegrationSettings({
      capability: "intelligence",
      provider: "openai-compatible",
      model: "local-model-name",
      baseUrl: "http://127.0.0.1:11434/v1",
      apiKey: secret,
    });

    expect(saved).toEqual({
      capability: "intelligence",
      provider: "openai-compatible",
      model: "local-model-name",
      baseUrl: "http://127.0.0.1:11434/v1",
      configured: true,
      enabled: true,
      verified: false,
      source: "settings",
      keyHint: "****7890",
    });
    expect(saved).not.toHaveProperty("apiKey");

    const summaries = await listIntegrationSummaries();
    expect(summaries).toHaveLength(3);
    expect(summaries.find(item => item.capability === "intelligence")).toEqual(saved);
    expect(summaries.every(item => !("apiKey" in item))).toBe(true);

    const encryptedPath = path.join(testDataDirectory, "integrations.enc.json");
    const encryptedText = await readFile(encryptedPath, "utf8");
    expect(encryptedText).not.toContain(secret);
    expect(encryptedText).not.toContain("local-model-name");
    expect(JSON.parse(encryptedText)).toMatchObject({
      version: 1,
      algorithm: "aes-256-gcm",
    });

    const persistedKeyPath = path.join(testDataDirectory, ".config-encryption-key");
    const persistedKey = (await readFile(persistedKeyPath, "utf8")).trim();
    expect(Buffer.from(persistedKey, "base64url")).toHaveLength(32);
    if (process.platform !== "win32") {
      expect((await stat(persistedKeyPath)).mode & 0o777).toBe(0o600);
      expect((await stat(encryptedPath)).mode & 0o777).toBe(0o600);
    }
  });

  it("requires a new secret when a saved provider or base URL changes", async () => {
    const { resolveIntegration, saveIntegrationSettings } = await import("./config");

    await saveIntegrationSettings({
      capability: "intelligence",
      provider: "openai-compatible",
      model: "first-model",
      baseUrl: "https://first.example.test/v1",
      apiKey: "first-provider-secret",
    });

    await expect(saveIntegrationSettings({
      capability: "intelligence",
      provider: "anthropic",
    })).rejects.toThrow("Enter a new API key");

    await expect(saveIntegrationSettings({
      capability: "intelligence",
      provider: "openai-compatible",
      model: "first-model",
      baseUrl: "https://second.example.test/v1",
    })).rejects.toThrow("Enter a new API key");

    const unchanged = await resolveIntegration("intelligence");
    expect(unchanged).toMatchObject({
      provider: "openai-compatible",
      model: "first-model",
      baseUrl: "https://first.example.test/v1",
      apiKey: "first-provider-secret",
    });

    const changed = await saveIntegrationSettings({
      capability: "intelligence",
      provider: "anthropic",
      apiKey: "replacement-secret",
    });
    expect(changed).toMatchObject({
      provider: "anthropic",
      model: "claude-sonnet-5",
      configured: true,
      source: "settings",
    });
    expect((await resolveIntegration("intelligence")).apiKey).toBe("replacement-secret");
  });

  it("never combines a saved secret with a partial environment identity override", async () => {
    const { hasIntegration, resolveIntegration, saveIntegrationSettings } = await import("./config");

    await saveIntegrationSettings({
      capability: "intelligence",
      provider: "openai-compatible",
      model: "saved-model",
      baseUrl: "https://saved.example.test/v1",
      apiKey: "saved-provider-secret",
    });

    vi.stubEnv("MAF_INTELLIGENCE_BASE_URL", "https://environment.example.test/v1");
    const hostOverride = await resolveIntegration("intelligence");
    expect(hostOverride).toMatchObject({
      provider: "",
      baseUrl: "https://environment.example.test/v1",
      source: "environment",
    });
    expect(hostOverride.apiKey).toBeUndefined();
    expect(hostOverride.model).toBeUndefined();
    expect(await hasIntegration("intelligence")).toBe(false);

    vi.stubEnv("MAF_INTELLIGENCE_BASE_URL", "");
    vi.stubEnv("MAF_INTELLIGENCE_PROVIDER", "anthropic");
    const providerOverride = await resolveIntegration("intelligence");
    expect(providerOverride).toMatchObject({
      provider: "anthropic",
      model: "claude-sonnet-5",
      source: "environment",
    });
    expect(providerOverride.apiKey).toBeUndefined();
    expect(providerOverride.baseUrl).toBeUndefined();
    expect(await hasIntegration("intelligence")).toBe(false);

    vi.stubEnv("MAF_INTELLIGENCE_API_KEY", "environment-provider-secret");
    const completeOverride = await resolveIntegration("intelligence");
    expect(completeOverride.apiKey).toBe("environment-provider-secret");
    expect(await hasIntegration("intelligence")).toBe(false);
  });

  it("persists verification for the exact connection and clears it when identity changes", async () => {
    const {
      hasIntegration,
      listIntegrationSummaries,
      saveIntegrationSettings,
      setIntegrationVerification,
    } = await import("./config");

    await saveIntegrationSettings({
      capability: "intelligence",
      provider: "openai-compatible",
      model: "first-model",
      baseUrl: "https://provider.example.test/v1/",
      apiKey: "first-secret-value",
    });
    expect(await hasIntegration("intelligence")).toBe(false);

    const verified = await setIntegrationVerification("intelligence", true);
    expect(verified).toMatchObject({ verified: true });
    expect(verified.verifiedAt).toEqual(expect.any(String));
    expect(verified).not.toHaveProperty("fingerprint");
    expect(await hasIntegration("intelligence")).toBe(true);

    const sameIdentity = await saveIntegrationSettings({
      capability: "intelligence",
      provider: "openai-compatible",
      model: "first-model",
      baseUrl: "https://provider.example.test/v1",
      enabled: false,
    });
    expect(sameIdentity.verified).toBe(true);
    expect(await hasIntegration("intelligence")).toBe(false);

    const changedModel = await saveIntegrationSettings({
      capability: "intelligence",
      provider: "openai-compatible",
      model: "second-model",
      baseUrl: "https://provider.example.test/v1",
      enabled: true,
    });
    expect(changedModel.verified).toBe(false);
    expect(changedModel.verifiedAt).toBeUndefined();
    expect(await hasIntegration("intelligence")).toBe(false);

    const summaries = await listIntegrationSummaries();
    expect(summaries.every(summary => !("fingerprint" in summary))).toBe(true);
  });

  it("can verify an environment-managed connection without copying its secret into settings", async () => {
    vi.stubEnv("MAF_DESKTOP", "1");
    vi.stubEnv("MAF_SEARCH_PROVIDER", "tavily");
    vi.stubEnv("MAF_SEARCH_API_KEY", "environment-only-secret");
    const { resolveIntegration, setIntegrationVerification } = await import("./config");

    const verified = await setIntegrationVerification("search", true);
    expect(verified).toMatchObject({ source: "environment", configured: true, verified: true });

    const encryptedText = await readFile(
      path.join(testDataDirectory, "integrations.enc.json"),
      "utf8",
    );
    expect(encryptedText).not.toContain("environment-only-secret");
    expect((await resolveIntegration("search")).verified).toBe(true);

    vi.stubEnv("MAF_SEARCH_API_KEY", "changed-environment-secret");
    expect((await resolveIntegration("search")).verified).toBe(false);
  });

  it("does not mark a replacement key verified when settings change during a test", async () => {
    const {
      resolveIntegration,
      saveIntegrationSettings,
      setIntegrationVerification,
    } = await import("./config");
    await saveIntegrationSettings({
      capability: "intelligence",
      provider: "openai-compatible",
      model: "stable-model",
      baseUrl: "https://provider.example.test/v1",
      apiKey: "key-used-for-test",
    });
    const testedConfig = await resolveIntegration("intelligence");
    await saveIntegrationSettings({
      capability: "intelligence",
      provider: "openai-compatible",
      model: "stable-model",
      baseUrl: "https://provider.example.test/v1",
      apiKey: "replacement-key",
    });

    await expect(
      setIntegrationVerification("intelligence", true, testedConfig),
    ).rejects.toThrow("changed during the connection test");
    expect((await resolveIntegration("intelligence")).verified).toBe(false);

    await setIntegrationVerification("intelligence", true);
    await setIntegrationVerification("intelligence", false, testedConfig);
    expect((await resolveIntegration("intelligence")).verified).toBe(true);
  });

  it("turns a standard OpenAI key into complete intelligence and image presets", async () => {
    vi.stubEnv("OPENAI_API_KEY", "shared-openai-secret");
    const { listIntegrationSummaries } = await import("./config");

    const summaries = await listIntegrationSummaries();
    expect(summaries.find(item => item.capability === "intelligence")).toMatchObject({
      provider: "openai-compatible",
      model: "gpt-5.6-luna",
      baseUrl: "https://api.openai.com/v1",
      configured: true,
      enabled: true,
      verified: false,
      source: "environment",
    });
    expect(summaries.find(item => item.capability === "image")).toMatchObject({
      provider: "openai-compatible",
      model: "gpt-image-2",
      baseUrl: "https://api.openai.com/v1",
      configured: true,
      enabled: true,
      verified: false,
      source: "environment",
    });
  });

  it("ignores unrelated generic provider variables in desktop mode", async () => {
    vi.stubEnv("MAF_DESKTOP", "1");
    vi.stubEnv("OPENAI_API_KEY", "unrelated-shell-secret");
    vi.stubEnv("ANTHROPIC_API_KEY", "another-unrelated-secret");
    const { listIntegrationSummaries } = await import("./config");

    const summaries = await listIntegrationSummaries();
    expect(summaries).toEqual([
      expect.objectContaining({ capability: "intelligence", configured: false, source: "none" }),
      expect.objectContaining({ capability: "search", configured: false, source: "none" }),
      expect.objectContaining({ capability: "image", configured: false, source: "none" }),
    ]);
  });

  it("still accepts an explicit capability-scoped desktop connection", async () => {
    vi.stubEnv("MAF_DESKTOP", "1");
    vi.stubEnv("OPENAI_API_KEY", "unrelated-shell-secret");
    vi.stubEnv("MAF_INTELLIGENCE_PROVIDER", "openai-compatible");
    vi.stubEnv("MAF_INTELLIGENCE_API_KEY", "deliberate-maf-secret");
    const { resolveIntegration } = await import("./config");

    await expect(resolveIntegration("intelligence")).resolves.toMatchObject({
      provider: "openai-compatible",
      apiKey: "deliberate-maf-secret",
      model: "gpt-5.6-luna",
      baseUrl: "https://api.openai.com/v1",
      source: "environment",
    });
  });
});

describe("provider timeout configuration", () => {
  it("keeps the deadline active after headers arrive, while reading the body", async () => {
    const { fetchWithTimeout } = await import("./http");
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(new Response(new ReadableStream({ start() {} })));
    vi.stubGlobal("fetch", fetchMock);
    const pending = expect(fetchWithTimeout("https://provider.example.test", {}, 50)).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(51);
    await pending;
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true);
  });

  it("rejects an oversized response before buffering it", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("small body", {
      headers: { "content-length": String(41 * 1024 * 1024) },
    })));
    const { fetchWithTimeout } = await import("./http");
    await expect(fetchWithTimeout("https://provider.example.test")).rejects.toThrow("response is too large");
  });

  it("uses separate bounded defaults for tests, LLM calls, and image generation", async () => {
    const { ENV } = await import("../_core/env");

    expect(ENV.integrationTestTimeoutMs).toBe(30_000);
    expect(ENV.llmTimeoutMs).toBe(120_000);
    expect(ENV.imageTimeoutMs).toBe(180_000);
  });

  it("accepts independent timeout overrides", async () => {
    vi.stubEnv("MAF_INTEGRATION_TEST_TIMEOUT_MS", "31000");
    vi.stubEnv("MAF_LLM_TIMEOUT_MS", "121000");
    vi.stubEnv("MAF_IMAGE_TIMEOUT_MS", "181000");
    const { ENV } = await import("../_core/env");

    expect(ENV.integrationTestTimeoutMs).toBe(31_000);
    expect(ENV.llmTimeoutMs).toBe(121_000);
    expect(ENV.imageTimeoutMs).toBe(181_000);
  });
});

describe("Tavily search adapter", () => {
  beforeEach(() => {
    vi.stubEnv("MAF_SEARCH_PROVIDER", "tavily");
    vi.stubEnv("MAF_SEARCH_API_KEY", "tvly-private-key");
    vi.stubEnv("MAF_SEARCH_ENABLED", "true");
  });

  it("sends the expected authenticated request and normalizes bounded results", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        results: [
          {
            title: "  First result  ",
            url: "https://example.test/one",
            content: "  First summary  ",
            published_date: "2026-08-11",
          },
          {
            title: "Second result",
            url: "https://example.test/two",
            content: "Second summary",
          },
          {
            title: "Must be bounded out",
            url: "https://example.test/three",
            content: "Third summary",
          },
        ],
      }), { status: 200, headers: { "content-type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { setIntegrationVerification } = await import("./config");
    await setIntegrationVerification("search", true);
    const { searchWeb } = await import("./search");

    const results = await searchWeb("  useful research query  ", { maxResults: 2 });

    expect(results).toEqual([
      {
        title: "First result",
        url: "https://example.test/one",
        content: "First summary",
        publishedDate: "2026-08-11",
      },
      {
        title: "Second result",
        url: "https://example.test/two",
        content: "Second summary",
      },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [requestUrl, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(requestUrl).toBe("https://api.tavily.com/search");
    expect(requestInit.method).toBe("POST");
    expect(requestInit.headers).toMatchObject({
      "content-type": "application/json",
      authorization: "Bearer tvly-private-key",
    });
    expect(JSON.parse(String(requestInit.body))).toEqual({
      query: "useful research query",
      max_results: 2,
      search_depth: "basic",
      include_answer: false,
      include_raw_content: false,
    });
  });

  it("does not expose response bodies or API keys in provider errors", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("upstream leaked tvly-private-key", { status: 401 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { setIntegrationVerification } = await import("./config");
    await setIntegrationVerification("search", true);
    const { searchWeb } = await import("./search");

    let message = "";
    try {
      await searchWeb("test query");
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toBe("The provider rejected the API key.");
    expect(message).not.toContain("tvly-private-key");
    expect(message).not.toContain("upstream leaked");
  });
});

describe("OpenAI-compatible intelligence adapter", () => {
  beforeEach(() => {
    vi.stubEnv("MAF_INTELLIGENCE_PROVIDER", "openai-compatible");
    vi.stubEnv("MAF_INTELLIGENCE_API_KEY", "llm-private-key");
    vi.stubEnv("MAF_INTELLIGENCE_MODEL", "test-model");
    vi.stubEnv("MAF_INTELLIGENCE_BASE_URL", "https://llm.example.test/v1");
    vi.stubEnv("MAF_INTELLIGENCE_ENABLED", "true");
  });

  it.each([
    { content: "", finish_reason: "stop", error: "empty response" },
    { content: '{"status":"OK"}', finish_reason: "length", error: "stopped before completing" },
    { content: '{"status":false}', finish_reason: "stop", error: "required format" },
    { content: '{"unexpected":"OK"}', finish_reason: "stop", error: "required format" },
    { content: "OK", finish_reason: "stop", error: "valid structured JSON" },
    { content: null, refusal: "Provider-specific text", finish_reason: "stop", error: "declined" },
  ])("does not verify unusable model output: $error", async ({ error, finish_reason, ...message }) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { role: "assistant", ...message }, finish_reason }],
    }))));
    const { testIntegration } = await import("./index");
    const { hasIntegration } = await import("./config");
    expect(await testIntegration("intelligence")).toMatchObject({ success: false, message: expect.stringContaining(error) });
    expect(await hasIntegration("intelligence")).toBe(false);
  });

  it("retains schema validation when a compatible endpoint needs legacy token parameters", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("unsupported", { status: 400 }))
      .mockResolvedValueOnce(new Response("unsupported", { status: 422 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: '{"status":"OK"}' }, finish_reason: "stop" }],
      })));
    vi.stubGlobal("fetch", fetchMock);
    const { testIntegration } = await import("./index");
    expect((await testIntegration("intelligence")).success).toBe(true);
    const lastRequest = JSON.parse(String(fetchMock.mock.calls[2][1]?.body));
    expect(lastRequest).toMatchObject({ model: "test-model", max_tokens: 1024 });
    expect(lastRequest).not.toHaveProperty("max_completion_tokens");
    expect(lastRequest.messages[0].content).toContain('"status"');
  });

  it("normalizes responses and retries structured output without native schema support", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("response_format unsupported", { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: "chat-response-id",
        created: 1234,
        model: "provider-model-name",
        choices: [{
          index: 0,
          message: { role: "assistant", content: "```json\n{\"answer\":\"ready\"}\n```" },
          finish_reason: "stop",
        }],
        usage: { prompt_tokens: 11, completion_tokens: 4, total_tokens: 15 },
      }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const { setIntegrationVerification } = await import("./config");
    await setIntegrationVerification("intelligence", true);
    const { invokeLLM } = await import("../_core/llm");

    const result = await invokeLLM({
      messages: [{ role: "user", content: "Return an answer." }],
      maxTokens: 32,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "answer",
          strict: true,
          schema: {
            type: "object",
            properties: { answer: { type: "string" } },
            required: ["answer"],
            additionalProperties: false,
          },
        },
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [url, init] of fetchMock.mock.calls as Array<[string, RequestInit]>) {
      expect(url).toBe("https://llm.example.test/v1/chat/completions");
      expect(init.headers).toMatchObject({ authorization: "Bearer llm-private-key" });
    }
    const firstRequest = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    const fallbackRequest = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(firstRequest.response_format.type).toBe("json_schema");
    expect(firstRequest.messages[0].content).toContain("Return only valid JSON");
    expect(fallbackRequest).not.toHaveProperty("response_format");
    expect(fallbackRequest.messages[0].content).toContain("Return only valid JSON");

    expect(result).toEqual({
      id: "chat-response-id",
      created: 1234,
      model: "provider-model-name",
      choices: [{
        index: 0,
        message: { role: "assistant", content: "{\"answer\":\"ready\"}" },
        finish_reason: "stop",
      }],
      usage: { prompt_tokens: 11, completion_tokens: 4, total_tokens: 15 },
    });
  });

  it("uses a broadly compatible production output limit and LLM timeout", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: "chat-response-id",
      choices: [{ message: { role: "assistant", content: "OK" }, finish_reason: "stop" }],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const timeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const { setIntegrationVerification } = await import("./config");
    await setIntegrationVerification("intelligence", true);
    const { invokeLLM } = await import("../_core/llm");

    await invokeLLM({ messages: [{ role: "user", content: "Test the default." }] });

    const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(request.max_completion_tokens).toBe(16_384);
    expect(timeoutSpy.mock.calls.some(([, timeout]) => Number(timeout) > 119_000 && Number(timeout) <= 120_000)).toBe(true);
  });

  it("keeps connection tests on the shorter test timeout", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: "connection-test-id",
      choices: [{ message: { role: "assistant", content: '{"status":"OK"}' }, finish_reason: "stop" }],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const timeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const { testIntegration } = await import("./index");

    await expect(testIntegration("intelligence")).resolves.toEqual({
      success: true,
      message: "Connection successful.",
    });
    expect(timeoutSpy.mock.calls.some(([, timeout]) => Number(timeout) > 29_000 && Number(timeout) <= 30_000)).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://llm.example.test/v1/chat/completions");
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: "test-model",
      max_completion_tokens: 1024,
      response_format: { type: "json_schema", json_schema: { name: "connection_check" } },
    });
  });

  it("records a successful test and clears verification after a failed retest", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: "connection-test-id",
        choices: [{ message: { role: "assistant", content: '{"status":"OK"}' }, finish_reason: "stop" }],
      }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response("unauthorized", { status: 401 })));
    const { listIntegrationSummaries } = await import("./config");
    const { testIntegration } = await import("./index");

    expect((await testIntegration("intelligence")).success).toBe(true);
    expect((await listIntegrationSummaries()).find(item => item.capability === "intelligence"))
      .toMatchObject({ source: "environment", verified: true });

    expect((await testIntegration("intelligence")).success).toBe(false);
    expect((await listIntegrationSummaries()).find(item => item.capability === "intelligence"))
      .toMatchObject({ source: "environment", verified: false });
  });
});

describe("native intelligence provider verification", () => {
  it("tests Anthropic's configured model through Messages and validates JSON output", async () => {
    vi.stubEnv("MAF_INTELLIGENCE_PROVIDER", "anthropic");
    vi.stubEnv("MAF_INTELLIGENCE_API_KEY", "anthropic-test-secret");
    vi.stubEnv("MAF_INTELLIGENCE_MODEL", "configured-claude-model");
    vi.stubEnv("MAF_INTELLIGENCE_BASE_URL", "https://claude.example.test");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      content: [{ type: "text", text: '{"status":"OK"}' }], stop_reason: "end_turn",
    })));
    vi.stubGlobal("fetch", fetchMock);
    const { testIntegration } = await import("./index");
    expect((await testIntegration("intelligence")).success).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://claude.example.test/v1/messages");
    expect(init.headers).toMatchObject({ "x-api-key": "anthropic-test-secret" });
    expect(JSON.parse(String(init.body))).toMatchObject({ model: "configured-claude-model", max_tokens: 1024 });
  });

  it("tests the configured Gemini model with the native generation schema", async () => {
    vi.stubEnv("MAF_INTELLIGENCE_PROVIDER", "gemini");
    vi.stubEnv("MAF_INTELLIGENCE_API_KEY", "gemini-test-secret");
    vi.stubEnv("MAF_INTELLIGENCE_MODEL", "configured-gemini-model");
    vi.stubEnv("MAF_INTELLIGENCE_BASE_URL", "https://gemini.example.test");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: '{"status":"OK"}' }] }, finishReason: "STOP" }],
    })));
    vi.stubGlobal("fetch", fetchMock);
    const { testIntegration } = await import("./index");
    expect((await testIntegration("intelligence")).success).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.pathname).toBe("/v1beta/models/configured-gemini-model:generateContent");
    expect(url.hostname).toBe("gemini.example.test");
    expect(JSON.parse(String(init.body)).generationConfig).toMatchObject({
      maxOutputTokens: 1024, responseMimeType: "application/json",
      responseJsonSchema: { properties: { status: { enum: ["OK"] } } },
    });
  });

  it("rejects incomplete native model output", async () => {
    vi.stubEnv("MAF_INTELLIGENCE_PROVIDER", "gemini");
    vi.stubEnv("MAF_INTELLIGENCE_API_KEY", "gemini-test-secret");
    vi.stubEnv("MAF_INTELLIGENCE_MODEL", "configured-gemini-model");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: '{"status":"OK"}' }] }, finishReason: "MAX_TOKENS" }],
    }))));
    const { testIntegration } = await import("./index");
    expect(await testIntegration("intelligence")).toMatchObject({ success: false, message: expect.stringContaining("stopped before completing") });
  });
});

describe("OpenAI-compatible image adapter", () => {
  beforeEach(() => {
    vi.stubEnv("MAF_IMAGE_PROVIDER", "openai-compatible");
    vi.stubEnv("MAF_IMAGE_API_KEY", "image-private-key");
    vi.stubEnv("MAF_IMAGE_MODEL", "gpt-image-2");
    vi.stubEnv("MAF_IMAGE_BASE_URL", "https://images.example.test/v1");
    vi.stubEnv("MAF_IMAGE_ENABLED", "true");
  });

  it.each(["not-base64!", Buffer.from("not an image").toString("base64")])("rejects corrupt inline images instead of saving broken media", async b64 => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ b64_json: b64 }] }))));
    const { setIntegrationVerification } = await import("./config");
    await setIntegrationVerification("image", true);
    const { generateImage } = await import("../_core/imageGeneration");
    await expect(generateImage({ prompt: "An editorial illustration" })).rejects.toThrow(/base64|supported image/);
    await expect(stat(path.join(testDataDirectory, "media"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not send the unsupported response_format field and persists returned image data", async () => {
    const tinyPng = TINY_PNG;
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [{ b64_json: tinyPng }],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const timeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const { setIntegrationVerification } = await import("./config");
    await setIntegrationVerification("image", true);
    const { generateImage } = await import("../_core/imageGeneration");

    const generated = await generateImage({ prompt: "A restrained editorial illustration" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://images.example.test/v1/images/generations");
    expect(init.headers).toMatchObject({ authorization: "Bearer image-private-key" });
    const request = JSON.parse(String(init.body));
    expect(request).toEqual({
      model: "gpt-image-2",
      prompt: "A restrained editorial illustration",
      n: 1,
    });
    expect(request).not.toHaveProperty("response_format");
    expect(timeoutSpy.mock.calls.some(([, timeout]) => timeout === 180_000)).toBe(true);
    expect(generated.url).toMatch(/^\/media\/generated\//);
  });

  it("maps a requested landscape composition to a supported GPT Image size", async () => {
    const tinyPng = TINY_PNG;
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [{ b64_json: tinyPng }],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const { setIntegrationVerification } = await import("./config");
    await setIntegrationVerification("image", true);
    const { generateImage } = await import("../_core/imageGeneration");

    await generateImage({ prompt: "Landscape campaign art", aspectRatio: "16:9" });

    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      model: "gpt-image-2",
      size: "1536x1024",
    });
  });

  it("passes a requested aspect ratio through Gemini's image format", async () => {
    vi.stubEnv("MAF_IMAGE_PROVIDER", "gemini");
    vi.stubEnv("MAF_IMAGE_API_KEY", "gemini-private-key");
    vi.stubEnv("MAF_IMAGE_MODEL", "gemini-3.1-flash-image");
    vi.stubEnv("MAF_IMAGE_BASE_URL", "https://generativelanguage.googleapis.com");
    const tinyPng = TINY_PNG;
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: tinyPng } }] } }],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const { setIntegrationVerification } = await import("./config");
    await setIntegrationVerification("image", true);
    const { generateImage } = await import("../_core/imageGeneration");

    const generated = await generateImage({
      prompt: "A square editorial illustration",
      aspectRatio: "1:1",
    });

    const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(request.generationConfig).toEqual({
      responseModalities: ["TEXT", "IMAGE"],
      imageConfig: { aspectRatio: "1:1" },
    });
    expect(generated.url).toMatch(/^\/media\/generated\//);
  });
});

describe("image connection test", () => {
  it("states that model lookup does not test billable generation", async () => {
    vi.stubEnv("MAF_IMAGE_PROVIDER", "openai-compatible");
    vi.stubEnv("MAF_IMAGE_API_KEY", "image-private-key");
    vi.stubEnv("MAF_IMAGE_MODEL", "custom-render-model");
    vi.stubEnv("MAF_IMAGE_BASE_URL", "https://images.example.test/v1");
    vi.stubEnv("MAF_IMAGE_ENABLED", "true");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [{ id: "custom-render-model" }],
    }), { status: 200, headers: { "content-type": "application/json" } })));
    const { testIntegration } = await import("./index");

    await expect(testIntegration("image")).resolves.toEqual({
      success: true,
      message: "Credentials and model lookup succeeded. No billable image was created, so generation output was not tested.",
    });
  });
});

describe("provider image downloads", () => {
  it("bounds image downloads even when DNS resolution stalls", async () => {
    vi.doMock("node:dns/promises", () => ({ lookup: vi.fn(() => new Promise(() => {})) }));
    const { downloadBinary } = await import("./http");
    vi.useFakeTimers();
    const pending = expect(downloadBinary("https://cdn.example.test/image.png", 1024, 50)).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(51);
    await pending;
  });

  it("rejects loopback/private image hosts before fetching", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { downloadBinary } = await import("./http");

    await expect(downloadBinary("https://127.0.0.1/private.png?token=secret")).rejects.toThrow(
      "private network address",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

});

describe("local media storage", () => {
  it("writes beneath the media directory and rejects traversal keys", async () => {
    const { resolveStoragePath, storagePut, storageRead } = await import("../storage");

    for (const unsafeKey of ["../outside.txt", "nested/../../outside.txt", "nested\\..\\outside.txt", ""]) {
      expect(() => resolveStoragePath(unsafeKey)).toThrow();
    }

    const stored = await storagePut("generated/example.txt", "local media", "text/plain");
    expect(stored.key).toMatch(/^generated\/example_[a-f0-9]{10}\.txt$/);
    expect(stored.url).toBe(`/media/${stored.key}`);
    expect((await storageRead(stored.key)).toString("utf8")).toBe("local media");

    const resolved = resolveStoragePath(stored.key).absolutePath;
    const mediaRoot = path.resolve(testDataDirectory, "media");
    const relative = path.relative(mediaRoot, resolved);
    expect(relative.startsWith("..")).toBe(false);
    expect(path.isAbsolute(relative)).toBe(false);
  });
});
