import { storagePut } from "../storage";
import { requireReadyIntegration, resolveIntegration } from "../integrations/config";
import {
  downloadBinary,
  fetchWithTimeout,
  imageMimeType,
  joinServiceUrl,
  readJsonResponse,
} from "../integrations/http";
import type { ResolvedIntegration } from "../integrations/types";
import type { ImageAspectRatio } from "../../shared/maf-constants";
import { ENV } from "./env";

export type GenerateImageOptions = {
  prompt: string;
  aspectRatio?: ImageAspectRatio;
  originalImages?: Array<{
    url?: string;
    b64Json?: string;
    mimeType?: string;
  }>;
};

export type GenerateImageResponse = { url?: string };

const DEFAULT_GEMINI_BASE_URL = "https://generativelanguage.googleapis.com";
const MAX_INLINE_IMAGE_BYTES = 25 * 1024 * 1024;

function openAiSizeForAspectRatio(
  model: string | undefined,
  aspectRatio: ImageAspectRatio,
): string {
  const normalizedModel = (model || "").toLowerCase();
  const orientation = aspectRatio === "1:1"
    ? "square"
    : aspectRatio === "2:3" || aspectRatio === "9:16"
      ? "portrait"
      : "landscape";

  if (normalizedModel.includes("dall-e-2")) return "1024x1024";
  if (normalizedModel.includes("dall-e-3")) {
    if (orientation === "portrait") return "1024x1792";
    if (orientation === "landscape") return "1792x1024";
    return "1024x1024";
  }
  if (orientation === "portrait") return "1024x1536";
  if (orientation === "landscape") return "1536x1024";
  return "1024x1024";
}

function normalizedMimeType(value: string | undefined): string {
  const mime = value?.split(";")[0].trim().toLowerCase();
  return mime && /^image\/(png|jpe?g|webp|gif)$/.test(mime) ? mime : "image/png";
}

function extensionForMime(mime: string): string {
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("gif")) return "gif";
  return "png";
}

function decodeBase64(value: string): Buffer {
  const cleaned = value.replace(/^data:[^;]+;base64,/, "").replace(/\s/g, "");
  if (!cleaned || cleaned.length > Math.ceil(MAX_INLINE_IMAGE_BYTES * 4 / 3) + 8) {
    throw new Error("The generated image data is invalid or too large.");
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(cleaned) || cleaned.length % 4 === 1) {
    throw new Error("The generated image data is not valid base64.");
  }
  const data = Buffer.from(cleaned, "base64");
  if (!data.length || data.length > MAX_INLINE_IMAGE_BYTES) {
    throw new Error("The generated image data is invalid or too large.");
  }
  return data;
}

async function persistImage(data: Buffer, _mimeType: string): Promise<GenerateImageResponse> {
  // Inline provider data needs the same byte validation as downloaded images.
  // Content-type declarations alone must not create broken gallery entries.
  const mime = imageMimeType(data);
  if (!mime) throw new Error("The provider returned data that is not a supported image.");
  const { url } = await storagePut(
    `generated/${Date.now()}.${extensionForMime(mime)}`,
    data,
    mime,
  );
  return { url };
}

async function persistProviderImage(candidate: unknown): Promise<GenerateImageResponse> {
  if (!candidate || typeof candidate !== "object") {
    throw new Error("The image provider returned an invalid response.");
  }
  const item = candidate as Record<string, any>;
  const base64 = item.b64_json || item.b64Json || item.data;
  const mimeType = item.mime_type || item.mimeType || "image/png";
  if (typeof base64 === "string") return persistImage(decodeBase64(base64), mimeType);
  const url = item.url || item.image_url || item.imageUrl;
  if (typeof url === "string" && url) {
    if (url.startsWith("data:image/")) {
      const mime = url.slice(5, url.indexOf(";"));
      return persistImage(decodeBase64(url), mime);
    }
    const downloaded = await downloadBinary(url);
    return persistImage(downloaded.data, downloaded.contentType);
  }
  throw new Error("The image provider returned no image data.");
}

async function generateOpenAiCompatible(
  config: ResolvedIntegration,
  options: GenerateImageOptions,
): Promise<GenerateImageResponse> {
  const response = await fetchWithTimeout(joinServiceUrl(config.baseUrl!, "images/generations"), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      prompt: options.prompt,
      n: 1,
      ...(options.aspectRatio
        ? { size: openAiSizeForAspectRatio(config.model, options.aspectRatio) }
        : {}),
    }),
  }, ENV.imageTimeoutMs);
  const result = (await readJsonResponse(response)) as Record<string, any>;
  const candidate = result.data?.[0] || result.image || result;
  return persistProviderImage(candidate);
}

async function originalImageParts(options: GenerateImageOptions): Promise<Array<Record<string, unknown>>> {
  const output: Array<Record<string, unknown>> = [];
  for (const image of options.originalImages || []) {
    if (image.b64Json) {
      const data = decodeBase64(image.b64Json);
      const mimeType = imageMimeType(data);
      if (!mimeType) throw new Error("A reference image is not a supported image file.");
      output.push({ inlineData: { mimeType, data: data.toString("base64") } });
    } else if (image.url) {
      const downloaded = await downloadBinary(image.url);
      output.push({ inlineData: { mimeType: normalizedMimeType(image.mimeType || downloaded.contentType), data: downloaded.data.toString("base64") } });
    }
  }
  return output;
}

async function generateGemini(
  config: ResolvedIntegration,
  options: GenerateImageOptions,
): Promise<GenerateImageResponse> {
  const endpoint = joinServiceUrl(
    config.baseUrl || DEFAULT_GEMINI_BASE_URL,
    `v1beta/models/${encodeURIComponent(config.model!)}:generateContent`,
  );
  const url = new URL(endpoint);
  url.searchParams.set("key", config.apiKey!);
  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{
        role: "user",
        parts: [{ text: options.prompt }, ...(await originalImageParts(options))],
      }],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
        ...(options.aspectRatio
          ? { imageConfig: { aspectRatio: options.aspectRatio } }
          : {}),
      },
    }),
  }, ENV.imageTimeoutMs);
  const result = (await readJsonResponse(response)) as Record<string, any>;
  const responseParts = result.candidates?.[0]?.content?.parts;
  if (!Array.isArray(responseParts)) throw new Error("The image provider returned an invalid response.");
  const imagePart = responseParts.find((part: any) => part?.inlineData || part?.inline_data || part?.fileData);
  if (!imagePart) throw new Error("The image provider returned no image data.");
  if (imagePart.fileData?.fileUri) return persistProviderImage({ url: imagePart.fileData.fileUri });
  return persistProviderImage(imagePart.inlineData || imagePart.inline_data);
}

export async function generateImage(
  options: GenerateImageOptions,
): Promise<GenerateImageResponse> {
  const prompt = options.prompt?.trim();
  if (!prompt) throw new Error("An image prompt is required.");
  if (prompt.length > 20_000) throw new Error("The image prompt is too long.");

  const config = await resolveIntegration("image");
  requireReadyIntegration(config);
  if (config.provider === "openai-compatible") {
    if (options.originalImages?.length) {
      throw new Error("Reference-image editing is not supported by this connection. Use Gemini for reference images or remove them.");
    }
    return generateOpenAiCompatible(config, { ...options, prompt });
  }
  if (config.provider === "gemini") {
    return generateGemini(config, { ...options, prompt });
  }
  throw new Error("The configured image provider is unsupported.");
}
