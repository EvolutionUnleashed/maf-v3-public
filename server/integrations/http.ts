import { ENV } from "../_core/env";
import { lookup } from "node:dns/promises";
import https from "node:https";
import net from "node:net";
import { Readable } from "node:stream";

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "localhost" || host === "::1" || host === "[::1]" || host.startsWith("127.");
}

function isNonPublicAddress(address: string): boolean {
  if (net.isIPv4(address)) {
    const [a, b, c] = address.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 192 && b === 0 && c === 2) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113) ||
      a >= 224
    );
  }
  if (net.isIPv6(address)) {
    const normalized = address.toLowerCase();
    if (normalized.startsWith("::ffff:")) {
      return isNonPublicAddress(normalized.slice("::ffff:".length));
    }
    return (
      normalized === "::" ||
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      /^fe[89ab]/.test(normalized) ||
      normalized.startsWith("ff") ||
      normalized.startsWith("2001:db8:")
    );
  }
  return true;
}

/**
 * Validate an untrusted provider-returned download URL. Unlike a service base
 * URL, a signed CDN URL may legitimately contain a query string. Fragments are
 * removed, credentials/private networks are rejected, and every resolved
 * address must be public before the request is made.
 */
type ValidatedDownload = { url: URL; addresses: string[] };

async function validateDownloadUrl(value: string): Promise<ValidatedDownload> {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("The generated image URL is invalid.");
  }
  if (parsed.protocol !== "https:" || (parsed.port && parsed.port !== "443")) {
    throw new Error("Generated image URLs must use HTTPS on the standard port.");
  }
  if (parsed.username || parsed.password) {
    throw new Error("Generated image URLs cannot contain credentials.");
  }
  const host = parsed.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    throw new Error("Generated image URLs cannot use a private network host.");
  }
  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new Error("The generated image host could not be resolved.");
  }
  if (!addresses.length || addresses.some(({ address }) => isNonPublicAddress(address))) {
    throw new Error("Generated image URLs cannot use a private network address.");
  }
  parsed.hash = "";
  parsed.port = "";
  return { url: parsed, addresses: addresses.map(({ address }) => address) };
}

export function imageMimeType(data: Buffer): string | null {
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return "image/jpeg";
  }
  if (data.length >= 12 && data.subarray(0, 4).toString("ascii") === "RIFF" && data.subarray(8, 12).toString("ascii") === "WEBP") {
    return "image/webp";
  }
  const signature = data.subarray(0, 6).toString("ascii");
  if (signature === "GIF87a" || signature === "GIF89a") return "image/gif";
  return null;
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<Buffer> {
  if (!response.body) throw new Error("The generated image was empty.");
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error("The generated image is too large.");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  if (!total) throw new Error("The generated image was empty.");
  return Buffer.concat(chunks, total);
}

function fetchPinnedDownload(
  validated: ValidatedDownload,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const approved = new Set(validated.addresses);
    const request = https.request(
      validated.url,
      {
        method: "GET",
        signal,
        headers: { accept: "image/png,image/jpeg,image/webp,image/gif" },
        servername: validated.url.hostname,
        lookup: (_hostname, options, callback) => {
          const all = typeof options === "object" && options.all === true;
          const records = validated.addresses.map(address => ({
            address,
            family: net.isIP(address) as 4 | 6,
          }));
          if (all) callback(null, records);
          else callback(null, records[0].address, records[0].family);
        },
      },
      incoming => {
        const connectedAddress = incoming.socket.remoteAddress?.replace(/^::ffff:/, "");
        if (!connectedAddress || !approved.has(connectedAddress)) {
          incoming.destroy();
          reject(new Error("The generated image connection did not use its validated address."));
          return;
        }
        const headers = new Headers();
        for (const [name, value] of Object.entries(incoming.headers)) {
          if (Array.isArray(value)) value.forEach(item => headers.append(name, item));
          else if (value !== undefined) headers.set(name, String(value));
        }
        resolve(new Response(Readable.toWeb(incoming) as ReadableStream, {
          status: incoming.statusCode || 500,
          statusText: incoming.statusMessage,
          headers,
        }));
      },
    );
    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error("The provider request timed out."));
    });
    request.once("error", error => {
      reject(error.message === "The provider request timed out."
        ? error
        : new Error("The provider could not be reached."));
    });
    request.end();
  });
}

export function validateServiceBaseUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("The service base URL is invalid.");
  }

  const isLoopbackHttp =
    parsed.protocol === "http:" && isLoopbackHost(parsed.hostname);
  if (parsed.protocol !== "https:" && !isLoopbackHttp) {
    throw new Error("Service URLs must use HTTPS, except for loopback development URLs.");
  }
  if (parsed.username || parsed.password) {
    throw new Error("Service URLs cannot contain credentials.");
  }
  if (parsed.search) {
    throw new Error("Service base URLs cannot contain query parameters.");
  }
  if ((parsed.protocol === "https:" && parsed.port === "443") || (parsed.protocol === "http:" && parsed.port === "80")) {
    parsed.port = "";
  }
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

export function joinServiceUrl(baseUrl: string, suffix: string): string {
  const base = `${validateServiceBaseUrl(baseUrl).replace(/\/+$/, "")}/`;
  return new URL(suffix.replace(/^\/+/, ""), base).toString();
}

export async function fetchWithTimeout(
  input: string | URL,
  init: RequestInit = {},
  timeoutMs = ENV.integrationTestTimeoutMs,
): Promise<Response> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new Error("The provider request timed out."));
    }, timeoutMs);
  });
  try {
    return await Promise.race([deadline, (async () => {
      const response = await fetch(input, { ...init, signal: controller.signal });
      // Fetch resolves at the headers. Keep the deadline alive until the body
      // completes, otherwise a stalled provider can leave the app busy forever.
      if (!response.ok) {
        void response.body?.cancel().catch(() => undefined);
        return new Response(null, { status: response.status, statusText: response.statusText, headers: response.headers });
      }
      if (!response.body) return response;
      const maxBytes = 40 * 1024 * 1024; // Includes base64 for a 25 MiB image.
      if (Number(response.headers.get("content-length") || 0) > maxBytes) {
        void response.body.cancel().catch(() => undefined);
        throw new Error("The provider response is too large.");
      }
      let body: Buffer;
      try {
        body = await readBoundedBody(response, maxBytes);
      } catch (error) {
        if (error instanceof Error && error.message === "The generated image is too large.") {
          throw new Error("The provider response is too large.");
        }
        if (error instanceof Error && error.message === "The generated image was empty.") {
          throw new Error("The provider returned an empty response.");
        }
        throw error;
      }
      return new Response(new Uint8Array(body), { status: response.status, statusText: response.statusText, headers: response.headers });
    })()]);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("The provider request timed out.");
    }
    if (error instanceof Error && ["The provider response is too large.", "The provider returned an empty response."].includes(error.message)) throw error;
    throw new Error("The provider could not be reached.");
  } finally {
    clearTimeout(timeout);
  }
}

export async function readJsonResponse(response: Response): Promise<unknown> {
  if (!response.ok) {
    throw providerHttpError(response.status);
  }
  try {
    const result = await response.json();
    if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error();
    return result;
  } catch {
    throw new Error("The provider returned an invalid response.");
  }
}

export function providerHttpError(status: number): Error {
  if (status === 401) {
    return new Error("The provider rejected the API key.");
  }
  if (status === 403) return new Error("The provider denied access. Check this API key's permissions and access to the selected model.");
  if (status === 402) return new Error("The provider requires billing or credits. Check your account with this provider.");
  if (status === 429) {
    return new Error("The provider's rate or usage limit was reached. Check your provider's billing or quota, or try again later.");
  }
  if (status === 404) return new Error("The provider endpoint or model was not found. Check the model name and base URL in API settings.");
  if (status >= 500) return new Error("The provider is temporarily unavailable. Try again later.");
  return new Error(`The provider request failed (HTTP ${status}).`);
}

export function safeErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return "The integration test failed.";
  const message = error.message
    .replace(/(bearer\s+)[^\s]+/gi, "$1[redacted]")
    .replace(/([?&](?:key|api_key)=)[^&\s]+/gi, "$1[redacted]")
    .replace(/\b(?:sk|key)-[A-Za-z0-9_-]{8,}\b/g, "[redacted]")
    .slice(0, 240);
  return message || "The integration test failed.";
}

export async function downloadBinary(
  initialUrl: string,
  maxBytes = ENV.imageDownloadLimitBytes,
  timeoutMs = ENV.imageTimeoutMs,
): Promise<{ data: Buffer; contentType: string }> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new Error("The provider request timed out."));
    }, timeoutMs);
  });
  const download = async () => {
    let validated = await validateDownloadUrl(initialUrl);
    for (let redirects = 0; redirects <= 4; redirects += 1) {
      const response = await fetchPinnedDownload(validated, timeoutMs, controller.signal);
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        void response.body?.cancel().catch(() => undefined);
        if (!location || redirects === 4) {
          throw new Error("The generated image URL could not be downloaded.");
        }
        validated = await validateDownloadUrl(new URL(location, validated.url).toString());
        continue;
      }
      if (!response.ok) {
        void response.body?.cancel().catch(() => undefined);
        throw providerHttpError(response.status);
      }

      const declaredLength = Number(response.headers.get("content-length") || 0);
      if (declaredLength > maxBytes) {
        void response.body?.cancel().catch(() => undefined);
        throw new Error("The generated image is too large.");
      }
      const data = await readBoundedBody(response, maxBytes);
      const detectedType = imageMimeType(data);
      if (!detectedType) throw new Error("The provider returned data that is not a supported image.");
      return { data, contentType: detectedType };
    }
    throw new Error("The generated image URL could not be downloaded.");
  };
  try {
    return await Promise.race([download(), deadline]);
  } catch (error) {
    if (controller.signal.aborted) throw new Error("The provider request timed out.");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
