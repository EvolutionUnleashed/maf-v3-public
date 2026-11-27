import crypto from "node:crypto";
import {
  requireConfiguredIntegration,
  requireReadyIntegration,
  resolveIntegration,
} from "../integrations/config";
import {
  fetchWithTimeout,
  joinServiceUrl,
  providerHttpError,
  readJsonResponse,
} from "../integrations/http";
import type { ResolvedIntegration } from "../integrations/types";
import { matchesOutputSchema } from "../integrations/structured-output";
import { ENV } from "./env";

export type Role = "system" | "user" | "assistant" | "tool" | "function";
export type TextContent = { type: "text"; text: string };
export type ImageContent = {
  type: "image_url";
  image_url: { url: string; detail?: "auto" | "low" | "high" };
};
export type FileContent = {
  type: "file_url";
  file_url: {
    url: string;
    mime_type?: "audio/mpeg" | "audio/wav" | "application/pdf" | "audio/mp4" | "video/mp4";
  };
};
export type MessageContent = string | TextContent | ImageContent | FileContent;
export type Message = {
  role: Role;
  content: MessageContent | MessageContent[];
  name?: string;
  tool_call_id?: string;
};
export type Tool = {
  type: "function";
  function: { name: string; description?: string; parameters?: Record<string, unknown> };
};
export type ToolChoicePrimitive = "none" | "auto" | "required";
export type ToolChoiceByName = { name: string };
export type ToolChoiceExplicit = { type: "function"; function: { name: string } };
export type ToolChoice = ToolChoicePrimitive | ToolChoiceByName | ToolChoiceExplicit;
export type JsonSchema = { name: string; schema: Record<string, unknown>; strict?: boolean };
export type OutputSchema = JsonSchema;
export type ResponseFormat =
  | { type: "text" }
  | { type: "json_object" }
  | { type: "json_schema"; json_schema: JsonSchema };
export type InvokeParams = {
  messages: Message[];
  tools?: Tool[];
  toolChoice?: ToolChoice;
  tool_choice?: ToolChoice;
  maxTokens?: number;
  max_tokens?: number;
  outputSchema?: OutputSchema;
  output_schema?: OutputSchema;
  responseFormat?: ResponseFormat;
  response_format?: ResponseFormat;
  /** Internal request deadline override, used by the bounded connection test. */
  requestTimeoutMs?: number;
};
export type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};
export type InvokeResult = {
  id: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: Role;
      content: string | Array<TextContent | ImageContent | FileContent>;
      tool_calls?: ToolCall[];
    };
    finish_reason: string | null;
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
};

const DEFAULT_ANTHROPIC_BASE_URL = "https://api.anthropic.com";
const DEFAULT_GEMINI_BASE_URL = "https://generativelanguage.googleapis.com";

function requestedFormat(params: InvokeParams): ResponseFormat | undefined {
  const explicit = params.responseFormat || params.response_format;
  if (explicit) {
    if (
      explicit.type === "json_schema" &&
      (!explicit.json_schema?.name || !explicit.json_schema.schema)
    ) {
      throw new Error("A structured response requires a named JSON schema.");
    }
    return explicit;
  }
  const schema = params.outputSchema || params.output_schema;
  if (!schema) return undefined;
  if (!schema.name || !schema.schema) {
    throw new Error("A structured response requires a named JSON schema.");
  }
  return { type: "json_schema", json_schema: schema };
}

function requestedSchema(format: ResponseFormat | undefined): Record<string, unknown> | undefined {
  return format?.type === "json_schema" ? format.json_schema.schema : undefined;
}

function maxTokens(params: InvokeParams): number {
  const requested = params.maxTokens ?? params.max_tokens;
  const value = Number.isFinite(requested) ? requested! : 16_384;
  return Math.max(1, Math.min(100_000, Math.trunc(value)));
}

function requestTimeoutMs(params: InvokeParams): number {
  const requested = params.requestTimeoutMs;
  if (requested === undefined || !Number.isFinite(requested) || requested <= 0) {
    return ENV.llmTimeoutMs;
  }
  return Math.max(1, Math.trunc(requested));
}

function parts(content: Message["content"]): MessageContent[] {
  return Array.isArray(content) ? content : [content];
}

function partAsText(part: MessageContent): string {
  if (typeof part === "string") return part;
  if (part.type === "text") return part.text;
  if (part.type === "image_url") return `[Image: ${part.image_url.url}]`;
  return `[File: ${part.file_url.url}]`;
}

function messageText(message: Message): string {
  return parts(message.content).map(partAsText).join("\n");
}

function structuredInstruction(format: ResponseFormat | undefined): string | undefined {
  if (!format || format.type === "text") return undefined;
  if (format.type === "json_object") {
    return "Return only one valid JSON object. Do not use Markdown fences or add commentary outside the JSON.";
  }
  return [
    "Return only valid JSON matching the following JSON Schema.",
    "Do not use Markdown fences or add commentary outside the JSON.",
    JSON.stringify(format.json_schema.schema),
  ].join("\n");
}

function withStructuredInstruction(messages: Message[], format: ResponseFormat | undefined): Message[] {
  const instruction = structuredInstruction(format);
  if (!instruction) return messages;
  return [{ role: "system", content: instruction }, ...messages];
}

function normalizeToolChoice(choice: ToolChoice | undefined, tools?: Tool[]): unknown {
  if (!choice) return undefined;
  if (choice === "required") {
    if (!tools?.length) throw new Error("A required tool choice needs at least one tool.");
    return tools.length === 1
      ? { type: "function", function: { name: tools[0].function.name } }
      : "required";
  }
  if (typeof choice === "object" && "name" in choice) {
    return { type: "function", function: { name: choice.name } };
  }
  return choice;
}

function cleanStructuredContent(result: InvokeResult, format: ResponseFormat | undefined): InvokeResult {
  const choice = result.choices[0];
  if (!choice) throw new Error("The provider returned no response. Try again.");
  if (["content_filter", "safety", "refusal", "recitation", "blocklist", "prohibited_content"].includes(choice.finish_reason || "")) {
    throw new Error("The provider declined this request. Revise the prompt and try again.");
  }
  if (choice.message.tool_calls?.length && (!format || format.type === "text")) return result;
  if (typeof choice.message.content !== "string" || !choice.message.content.trim()) {
    throw new Error("The provider returned an empty response. Try again or choose another model in API settings.");
  }
  if (!format || format.type === "text") return result;
  if (choice.finish_reason === "length" || choice.finish_reason === "max_tokens") {
    throw new Error("The provider stopped before completing the structured response. Try a shorter request or choose another model in API settings.");
  }
  let value = choice.message.content.trim();
  value = value.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    const first = value.indexOf("{");
    const last = value.lastIndexOf("}");
    if (first >= 0 && last > first) {
      try {
        parsed = JSON.parse(value.slice(first, last + 1));
      } catch {
        // The clear error below is safer than returning malformed structured data.
      }
    }
    if (parsed === undefined) throw new Error("The provider did not return valid structured JSON. Try again or choose another model in API settings.");
  }
  if (format.type === "json_object" && (!parsed || typeof parsed !== "object" || Array.isArray(parsed))) {
    throw new Error("The provider did not return the required JSON object.");
  }
  if (format.type === "json_schema" && !matchesOutputSchema(parsed, format.json_schema.schema)) {
    throw new Error("The provider returned JSON that does not match the required format. Try again or choose another model in API settings.");
  }
  choice.message.content = JSON.stringify(parsed);
  return result;
}

function openAiMessages(messages: Message[]) {
  return messages.map(message => {
    const content = parts(message.content).map(part => {
      if (typeof part === "string") return { type: "text", text: part };
      if (part.type === "text" || part.type === "image_url") return part;
      return { type: "text", text: `[File: ${part.file_url.url}]` };
    });
    return {
      role: message.role,
      ...(message.name ? { name: message.name } : {}),
      ...(message.tool_call_id ? { tool_call_id: message.tool_call_id } : {}),
      content: content.length === 1 && content[0].type === "text" ? content[0].text : content,
    };
  });
}

async function invokeOpenAiCompatible(
  config: ResolvedIntegration,
  params: InvokeParams,
  format: ResponseFormat | undefined,
): Promise<InvokeResult> {
  const deadline = Date.now() + requestTimeoutMs(params);
  const remainingTime = () => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("The provider request timed out.");
    return remaining;
  };
  const basePayload: Record<string, unknown> = {
    model: config.model,
    messages: openAiMessages(withStructuredInstruction(params.messages, format)),
    max_completion_tokens: maxTokens(params),
  };
  if (params.tools?.length) basePayload.tools = params.tools;
  const toolChoice = normalizeToolChoice(params.toolChoice || params.tool_choice, params.tools);
  if (toolChoice !== undefined) basePayload.tool_choice = toolChoice;

  const nativeFormat = format?.type === "json_schema"
    ? { type: "json_schema", json_schema: format.json_schema }
    : format?.type === "json_object" ? format : undefined;
  const request = async (includeNative: boolean, legacyTokens = false) => fetchWithTimeout(
    joinServiceUrl(config.baseUrl!, "chat/completions"),
    {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({
        ...basePayload,
        ...(legacyTokens
          ? { max_completion_tokens: undefined, max_tokens: maxTokens(params) }
          : {}),
        ...(includeNative && nativeFormat ? { response_format: nativeFormat } : {}),
      }),
    },
    remainingTime(),
  );

  let response = await request(Boolean(nativeFormat));
  if (nativeFormat && (response.status === 400 || response.status === 422)) {
    response = await request(false);
  }
  if (response.status === 400 || response.status === 422) {
    response = await request(false, true);
  }
  const payload = (await readJsonResponse(response)) as Record<string, any>;
  if (!Array.isArray(payload.choices) || !payload.choices[0]?.message) {
    throw new Error("The provider returned an invalid response.");
  }
  if (payload.choices[0].message.refusal) {
    throw new Error("The provider declined this request. Revise the prompt and try again.");
  }
  const promptTokens = Number(payload.usage?.prompt_tokens || 0);
  const completionTokens = Number(payload.usage?.completion_tokens || 0);
  return {
    id: String(payload.id || crypto.randomUUID()),
    created: Number(payload.created || Math.floor(Date.now() / 1000)),
    model: String(payload.model || config.model),
    choices: payload.choices.map((choice: any, index: number) => ({
      index: Number.isFinite(choice.index) ? choice.index : index,
      message: {
        role: "assistant" as const,
        content: choice.message.content ?? "",
        ...(Array.isArray(choice.message.tool_calls) ? { tool_calls: choice.message.tool_calls } : {}),
      },
      finish_reason: choice.finish_reason ?? null,
    })),
    ...(payload.usage ? {
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: Number(payload.usage.total_tokens || promptTokens + completionTokens),
      },
    } : {}),
  };
}

function anthropicToolChoice(choice: ToolChoice | undefined, tools?: Tool[]): unknown {
  const normalized = normalizeToolChoice(choice, tools);
  if (normalized === "none") return { type: "none" };
  if (normalized === "required") return { type: "any" };
  if (normalized && typeof normalized === "object" && "function" in normalized) {
    return { type: "tool", name: (normalized as ToolChoiceExplicit).function.name };
  }
  return normalized === "auto" ? { type: "auto" } : undefined;
}

async function invokeAnthropic(
  config: ResolvedIntegration,
  params: InvokeParams,
  format: ResponseFormat | undefined,
): Promise<InvokeResult> {
  const instructed = withStructuredInstruction(params.messages, format);
  const system = instructed.filter(message => message.role === "system").map(messageText).join("\n\n");
  const messages = instructed.filter(message => message.role !== "system").map(message => ({
    role: message.role === "assistant" ? "assistant" : "user",
    content: messageText(message),
  }));
  const payload: Record<string, unknown> = {
    model: config.model,
    max_tokens: maxTokens(params),
    ...(system ? { system } : {}),
    messages,
  };
  if (params.tools?.length) {
    payload.tools = params.tools.map(tool => ({
      name: tool.function.name,
      description: tool.function.description,
      input_schema: tool.function.parameters || { type: "object", properties: {} },
    }));
    const choice = anthropicToolChoice(params.toolChoice || params.tool_choice, params.tools);
    if (choice) payload.tool_choice = choice;
  }
  const response = await fetchWithTimeout(
    joinServiceUrl(config.baseUrl || DEFAULT_ANTHROPIC_BASE_URL, "v1/messages"),
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": config.apiKey!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(payload),
    },
    requestTimeoutMs(params),
  );
  const result = (await readJsonResponse(response)) as Record<string, any>;
  if (!Array.isArray(result.content)) throw new Error("The provider returned an invalid response.");
  const text = result.content.filter((part: any) => part?.type === "text").map((part: any) => part.text).join("\n");
  const toolCalls = result.content.filter((part: any) => part?.type === "tool_use").map((part: any) => ({
    id: String(part.id || crypto.randomUUID()),
    type: "function" as const,
    function: { name: String(part.name || ""), arguments: JSON.stringify(part.input || {}) },
  }));
  const inputTokens = Number(result.usage?.input_tokens || 0);
  const outputTokens = Number(result.usage?.output_tokens || 0);
  return {
    id: String(result.id || crypto.randomUUID()),
    created: Math.floor(Date.now() / 1000),
    model: String(result.model || config.model),
    choices: [{
      index: 0,
      message: { role: "assistant", content: text, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) },
      finish_reason:
        result.stop_reason === "max_tokens"
          ? "length"
          : result.stop_reason === "tool_use"
            ? "tool_calls"
            : "stop",
    }],
    usage: { prompt_tokens: inputTokens, completion_tokens: outputTokens, total_tokens: inputTokens + outputTokens },
  };
}

function geminiContents(messages: Message[]) {
  return messages.filter(message => message.role !== "system").map(message => ({
    role: message.role === "assistant" ? "model" : "user",
    parts: [{ text: messageText(message) }],
  }));
}

async function invokeGemini(
  config: ResolvedIntegration,
  params: InvokeParams,
  format: ResponseFormat | undefined,
): Promise<InvokeResult> {
  const deadline = Date.now() + requestTimeoutMs(params);
  const instructed = withStructuredInstruction(params.messages, format);
  const system = instructed.filter(message => message.role === "system").map(messageText).join("\n\n");
  const generationConfig: Record<string, unknown> = { maxOutputTokens: maxTokens(params) };
  if (format && format.type !== "text") {
    generationConfig.responseMimeType = "application/json";
    const schema = requestedSchema(format);
    if (schema) generationConfig.responseJsonSchema = schema;
  }
  const payload: Record<string, unknown> = {
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    contents: geminiContents(instructed),
    generationConfig,
  };
  if (params.tools?.length) {
    payload.tools = [{ functionDeclarations: params.tools.map(tool => ({
      name: tool.function.name,
      description: tool.function.description,
      parameters: tool.function.parameters,
    })) }];
    const selected = normalizeToolChoice(params.toolChoice || params.tool_choice, params.tools);
    if (selected === "none") {
      payload.toolConfig = { functionCallingConfig: { mode: "NONE" } };
    } else if (selected === "required") {
      payload.toolConfig = { functionCallingConfig: { mode: "ANY" } };
    } else if (selected && typeof selected === "object" && "function" in selected) {
      payload.toolConfig = {
        functionCallingConfig: {
          mode: "ANY",
          allowedFunctionNames: [(selected as ToolChoiceExplicit).function.name],
        },
      };
    }
  }
  const endpoint = joinServiceUrl(
    config.baseUrl || DEFAULT_GEMINI_BASE_URL,
    `v1beta/models/${encodeURIComponent(config.model!)}:generateContent`,
  );
  const request = async (nativeStructure: boolean) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("The provider request timed out.");
    const url = new URL(endpoint);
    url.searchParams.set("key", config.apiKey!);
    const body = nativeStructure ? payload : {
      ...payload,
      generationConfig: { maxOutputTokens: maxTokens(params) },
    };
    return fetchWithTimeout(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }, remaining);
  };
  let response = await request(Boolean(format && format.type !== "text"));
  if (format && response.status === 400) response = await request(false);
  if (!response.ok) throw providerHttpError(response.status);
  const result = (await readJsonResponse(response)) as Record<string, any>;
  const candidate = result.candidates?.[0];
  if (!candidate?.content?.parts) {
    if (result.promptFeedback?.blockReason || candidate?.finishReason === "SAFETY") {
      throw new Error("The provider declined this request. Revise the prompt and try again.");
    }
    throw new Error("The provider returned an invalid response.");
  }
  const text = candidate.content.parts.filter((part: any) => typeof part.text === "string").map((part: any) => part.text).join("\n");
  const toolCalls = candidate.content.parts.filter((part: any) => part.functionCall).map((part: any) => ({
    id: crypto.randomUUID(),
    type: "function" as const,
    function: { name: String(part.functionCall.name || ""), arguments: JSON.stringify(part.functionCall.args || {}) },
  }));
  const promptTokens = Number(result.usageMetadata?.promptTokenCount || 0);
  const completionTokens = Number(result.usageMetadata?.candidatesTokenCount || 0);
  const finish = String(candidate.finishReason || "STOP");
  return {
    id: crypto.randomUUID(),
    created: Math.floor(Date.now() / 1000),
    model: config.model!,
    choices: [{
      index: 0,
      message: { role: "assistant", content: text, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) },
      finish_reason: finish === "MAX_TOKENS" ? "length" : finish.toLowerCase(),
    }],
    usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens },
  };
}

export async function invokeLLM(
  params: InvokeParams,
  options: { allowUnverified?: boolean; configuration?: ResolvedIntegration } = {},
): Promise<InvokeResult> {
  if (!Array.isArray(params.messages) || params.messages.length === 0) {
    throw new Error("At least one message is required.");
  }
  const config = options.configuration ?? await resolveIntegration("intelligence");
  if (config.capability !== "intelligence") throw new Error("The intelligence connection does not match this request.");
  if (options.allowUnverified) requireConfiguredIntegration(config);
  else requireReadyIntegration(config);
  const format = requestedFormat(params);
  let result: InvokeResult;
  if (config.provider === "openai-compatible") {
    result = await invokeOpenAiCompatible(config, params, format);
  } else if (config.provider === "anthropic") {
    result = await invokeAnthropic(config, params, format);
  } else if (config.provider === "gemini") {
    result = await invokeGemini(config, params, format);
  } else {
    throw new Error("The configured intelligence provider is unsupported.");
  }
  return cleanStructuredContent(result, format);
}
