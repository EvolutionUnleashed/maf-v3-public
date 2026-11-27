export {
  clearIntegrationSecret,
  hasIntegration,
  listIntegrationSummaries,
  saveIntegrationSettings,
  setIntegrationVerification,
} from "./config";
export { searchWeb } from "./search";
export type {
  IntegrationCapability,
  IntegrationProvider,
  IntegrationSettingsInput,
  IntegrationSummary,
  SearchResult,
} from "./types";

import {
  requireConfiguredIntegration,
  resolveIntegration,
  setIntegrationVerification,
} from "./config";
import {
  fetchWithTimeout,
  joinServiceUrl,
  readJsonResponse,
  safeErrorMessage,
} from "./http";
import { searchWeb } from "./search";
import type { IntegrationCapability, ResolvedIntegration } from "./types";
import { ENV } from "../_core/env";

const DEFAULT_GEMINI_BASE_URL = "https://generativelanguage.googleapis.com";

function modelLooksImageCapable(provider: string, model: string | undefined): boolean {
  const value = (model || "").toLowerCase();
  if (provider === "gemini") return value.includes("image");
  return value.includes("image") || value.includes("dall-e");
}

export async function testIntegration(
  capability: IntegrationCapability,
): Promise<{ success: boolean; message: string }> {
  let testedConfig: ResolvedIntegration | undefined;
  try {
    const config = await resolveIntegration(capability);
    testedConfig = config;
    requireConfiguredIntegration(config);

    if (capability === "search") {
      await searchWeb("latest artificial intelligence news", { maxResults: 1, allowUnverified: true, configuration: config });
    } else if (capability === "intelligence") {
      const { invokeLLM } = await import("../_core/llm");
      await invokeLLM({
        messages: [{ role: "user", content: 'Return a JSON object with status equal to "OK".' }],
        // Reasoning models count internal reasoning against this same budget.
        // Eight tokens could return no visible answer while appearing connected.
        maxTokens: 1024,
        responseFormat: {
          type: "json_schema",
          json_schema: {
            name: "connection_check",
            strict: true,
            schema: {
              type: "object",
              properties: { status: { type: "string", enum: ["OK"] } },
              required: ["status"],
              additionalProperties: false,
            },
          },
        },
        requestTimeoutMs: ENV.integrationTestTimeoutMs,
      }, { allowUnverified: true, configuration: config });
    } else if (config.provider === "openai-compatible") {
      const response = await fetchWithTimeout(joinServiceUrl(config.baseUrl!, "models"), {
        headers: { authorization: `Bearer ${config.apiKey}` },
      }, ENV.integrationTestTimeoutMs);
      if (response.status === 404 || response.status === 405) {
        throw new Error("This image endpoint does not expose a model list, so MAF could not verify it without creating a billable image.");
      } else {
        const result = (await readJsonResponse(response)) as { data?: Array<{ id?: string }> };
        if (!Array.isArray(result.data)) {
          throw new Error("The image endpoint returned an unexpected model list, so MAF could not verify this connection safely.");
        }
        if (!result.data.some(model => model.id === config.model)) {
          throw new Error("The configured image model was not found for this API key.");
        }
      }
    } else if (config.provider === "gemini") {
      if (capability === "image" && !modelLooksImageCapable(config.provider, config.model)) {
        throw new Error("Choose a Gemini image-generation model for the image capability.");
      }
      const modelPath = `v1beta/models/${encodeURIComponent(config.model!)}`;
      const url = new URL(joinServiceUrl(config.baseUrl || DEFAULT_GEMINI_BASE_URL, modelPath));
      url.searchParams.set("key", config.apiKey!);
      await readJsonResponse(await fetchWithTimeout(url, {}, ENV.integrationTestTimeoutMs));
    }

    await setIntegrationVerification(capability, true, config);
    return {
      success: true,
      message: capability === "image"
        ? "Credentials and model lookup succeeded. No billable image was created, so generation output was not tested."
        : "Connection successful.",
    };
  } catch (error) {
    await setIntegrationVerification(capability, false, testedConfig).catch(() => undefined);
    return { success: false, message: safeErrorMessage(error) };
  }
}
