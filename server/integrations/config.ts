import crypto from "node:crypto";
import { mkdir, chmod, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { ENV } from "../_core/env";
import { validateServiceBaseUrl } from "./http";
import type {
  IntegrationCapability,
  IntegrationProvider,
  IntegrationSettingsInput,
  IntegrationSummary,
  ResolvedIntegration,
} from "./types";

type StoredIntegration = {
  provider: IntegrationProvider;
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  enabled: boolean;
};

type StoredVerification = {
  fingerprint: string;
  verifiedAt: string;
};

type SettingsDocument = {
  version: 1;
  integrations: Partial<Record<IntegrationCapability, StoredIntegration>>;
  verifications?: Partial<Record<IntegrationCapability, StoredVerification>>;
};

type EncryptedDocument = {
  version: 1;
  algorithm: "aes-256-gcm";
  iv: string;
  tag: string;
  ciphertext: string;
};

const CAPABILITIES: IntegrationCapability[] = ["intelligence", "search", "image"];
const ALLOWED_PROVIDERS: Record<IntegrationCapability, IntegrationProvider[]> = {
  intelligence: ["openai-compatible", "anthropic", "gemini"],
  search: ["tavily"],
  image: ["openai-compatible", "gemini"],
};
const PROVIDER_DEFAULTS: Partial<Record<IntegrationProvider, Partial<Record<IntegrationCapability, Pick<StoredIntegration, "model" | "baseUrl">>>>> = {
  "openai-compatible": {
    intelligence: { model: "gpt-5.6-luna", baseUrl: "https://api.openai.com/v1" },
    image: { model: "gpt-image-2", baseUrl: "https://api.openai.com/v1" },
  },
  anthropic: {
    intelligence: { model: "claude-sonnet-5" },
  },
  gemini: {
    intelligence: { model: "gemini-3.6-flash" },
    image: { model: "gemini-3.1-flash-image" },
  },
};
const CONFIG_FILE = path.join(ENV.dataDir, "integrations.enc.json");
const KEY_FILE = path.join(ENV.dataDir, ".config-encryption-key");
const VERIFICATION_CONTEXT = "maf-v3-provider-verification:v1";
let writeQueue: Promise<unknown> = Promise.resolve();

function cleanOptional(value: string | null | undefined): string | undefined {
  const cleaned = value?.trim();
  return cleaned || undefined;
}

function parseBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  if (/^(1|true|yes|on)$/i.test(value)) return true;
  if (/^(0|false|no|off)$/i.test(value)) return false;
  return undefined;
}

function decodeConfiguredKey(value: string): Buffer {
  if (/^[a-f\d]{64}$/i.test(value)) return Buffer.from(value, "hex");
  try {
    const decoded = Buffer.from(value, "base64url");
    if (decoded.length === 32) return decoded;
  } catch {
    // Fall through to deterministic derivation for passphrase-style values.
  }
  return crypto.createHash("sha256").update(value, "utf8").digest();
}

async function getEncryptionKey(): Promise<Buffer> {
  if (ENV.configEncryptionKey) return decodeConfiguredKey(ENV.configEncryptionKey);
  await mkdir(ENV.dataDir, { recursive: true, mode: 0o700 });
  try {
    const saved = (await readFile(KEY_FILE, "utf8")).trim();
    const key = Buffer.from(saved, "base64url");
    if (key.length !== 32) throw new Error("Invalid persisted configuration key.");
    return key;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") throw error;
    const key = crypto.randomBytes(32);
    await writeFile(KEY_FILE, key.toString("base64url"), { mode: 0o600, flag: "wx" }).catch(async writeError => {
      if ((writeError as NodeJS.ErrnoException).code !== "EEXIST") throw writeError;
    });
    await chmod(KEY_FILE, 0o600).catch(() => undefined);
    if ((await readFile(KEY_FILE, "utf8")).trim() !== key.toString("base64url")) {
      return Buffer.from((await readFile(KEY_FILE, "utf8")).trim(), "base64url");
    }
    return key;
  }
}

async function loadSettings(): Promise<SettingsDocument> {
  let raw: string;
  try {
    raw = await readFile(CONFIG_FILE, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { version: 1, integrations: {} };
    }
    throw error;
  }
  try {
    const envelope = JSON.parse(raw) as EncryptedDocument;
    if (envelope.version !== 1 || envelope.algorithm !== "aes-256-gcm") throw new Error();
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      await getEncryptionKey(),
      Buffer.from(envelope.iv, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
    const parsed = JSON.parse(plaintext) as SettingsDocument;
    if (parsed.version !== 1 || typeof parsed.integrations !== "object") throw new Error();
    return parsed;
  } catch {
    throw new Error("The local integration settings could not be decrypted.");
  }
}

async function persistSettings(settings: SettingsDocument): Promise<void> {
  await mkdir(ENV.dataDir, { recursive: true, mode: 0o700 });
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", await getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(settings), "utf8"),
    cipher.final(),
  ]);
  const envelope: EncryptedDocument = {
    version: 1,
    algorithm: "aes-256-gcm",
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
  };
  const temporary = `${CONFIG_FILE}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(envelope, null, 2), { mode: 0o600 });
  await chmod(temporary, 0o600).catch(() => undefined);
  await rename(temporary, CONFIG_FILE);
  await chmod(CONFIG_FILE, 0o600).catch(() => undefined);
}

function queued<T>(operation: () => Promise<T>): Promise<T> {
  const result = writeQueue.then(operation, operation);
  writeQueue = result.then(() => undefined, () => undefined);
  return result;
}

function isStoredVerification(value: unknown): value is StoredVerification {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<StoredVerification>;
  return Boolean(
    typeof candidate.fingerprint === "string" &&
    /^[a-f\d]{64}$/.test(candidate.fingerprint) &&
    typeof candidate.verifiedAt === "string" &&
    Number.isFinite(Date.parse(candidate.verifiedAt)),
  );
}

function fingerprintsMatch(left: string | undefined, right: string | undefined): boolean {
  if (!left || !right || !/^[a-f\d]{64}$/.test(left) || !/^[a-f\d]{64}$/.test(right)) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function verificationMatches(
  verification: StoredVerification | undefined,
  fingerprint: string | undefined,
): boolean {
  return isStoredVerification(verification) && fingerprintsMatch(
    verification.fingerprint,
    fingerprint,
  );
}

async function integrationFingerprint(config: ResolvedIntegration): Promise<string | undefined> {
  if (!config.apiKey) return undefined;
  const normalizedBaseUrl = config.baseUrl ? validateServiceBaseUrl(config.baseUrl) : "";
  const identity = JSON.stringify([
    config.capability,
    config.provider,
    normalizedBaseUrl,
    cleanOptional(config.model) || "",
    config.apiKey,
  ]);
  return crypto
    .createHmac("sha256", await getEncryptionKey())
    .update(VERIFICATION_CONTEXT, "utf8")
    .update("\0", "utf8")
    .update(identity, "utf8")
    .digest("hex");
}

function providerFromEnvironment(capability: IntegrationCapability): IntegrationProvider | undefined {
  const explicit = cleanOptional(process.env[`MAF_${capability.toUpperCase()}_PROVIDER`])?.toLowerCase() as IntegrationProvider | undefined;
  if (explicit) return explicit;
  // A desktop process inherits the user's ambient Windows environment. Generic
  // provider variables may belong to unrelated developer tools and must never
  // silently override UI-managed MAF settings. Deliberate MAF_* capability
  // variables above remain supported for managed installations.
  if (process.env.MAF_DESKTOP === "1") return undefined;
  if (capability === "search" && process.env.TAVILY_API_KEY) return "tavily";

  const candidates: IntegrationProvider[] = [];
  if (capability !== "search") {
    if (process.env.OPENAI_API_KEY || process.env[`OPENAI_${capability.toUpperCase()}_API_KEY`]) candidates.push("openai-compatible");
    if (capability === "intelligence" && process.env.ANTHROPIC_API_KEY) candidates.push("anthropic");
    if (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env[`GEMINI_${capability.toUpperCase()}_API_KEY`]) candidates.push("gemini");
  }
  return candidates.length === 1 ? candidates[0] : undefined;
}

function environmentOverrides(capability: IntegrationCapability): Partial<StoredIntegration> & { present: boolean } {
  const prefix = `MAF_${capability.toUpperCase()}_`;
  const provider = providerFromEnvironment(capability);
  let apiKey = cleanOptional(process.env[`${prefix}API_KEY`]);
  let model = cleanOptional(process.env[`${prefix}MODEL`]);
  let baseUrl = cleanOptional(process.env[`${prefix}BASE_URL`]);
  const enabled = parseBoolean(process.env[`${prefix}ENABLED`]);
  const allowGenericAliases = process.env.MAF_DESKTOP !== "1";

  if (provider === "tavily") {
    if (allowGenericAliases) {
      apiKey ||= cleanOptional(process.env.TAVILY_API_KEY);
      baseUrl ||= cleanOptional(process.env.TAVILY_BASE_URL);
    }
  } else if (provider === "anthropic") {
    if (allowGenericAliases) {
      apiKey ||= cleanOptional(process.env.ANTHROPIC_API_KEY);
      model ||= cleanOptional(process.env.ANTHROPIC_MODEL);
      baseUrl ||= cleanOptional(process.env.ANTHROPIC_BASE_URL);
    }
  } else if (provider === "gemini") {
    if (allowGenericAliases) {
      apiKey ||= cleanOptional(process.env[`GEMINI_${capability.toUpperCase()}_API_KEY`]) || cleanOptional(process.env.GEMINI_API_KEY) || cleanOptional(process.env.GOOGLE_API_KEY);
      model ||= cleanOptional(process.env[`GEMINI_${capability.toUpperCase()}_MODEL`]) || cleanOptional(process.env.GEMINI_MODEL);
      baseUrl ||= cleanOptional(process.env[`GEMINI_${capability.toUpperCase()}_BASE_URL`]) || cleanOptional(process.env.GEMINI_BASE_URL);
    }
  } else if (provider === "openai-compatible") {
    if (allowGenericAliases) {
      apiKey ||= cleanOptional(process.env[`OPENAI_${capability.toUpperCase()}_API_KEY`]) || cleanOptional(process.env.OPENAI_API_KEY);
      model ||= cleanOptional(process.env[`OPENAI_${capability.toUpperCase()}_MODEL`]) || cleanOptional(process.env.OPENAI_MODEL);
      baseUrl ||= cleanOptional(process.env[`OPENAI_${capability.toUpperCase()}_BASE_URL`]) || cleanOptional(process.env.OPENAI_BASE_URL);
    }
  }

  const defaults = provider ? PROVIDER_DEFAULTS[provider]?.[capability] : undefined;
  model ||= defaults?.model;
  baseUrl ||= defaults?.baseUrl;

  const present = Object.entries(process.env).some(
    ([key, value]) => key.startsWith(prefix) && Boolean(cleanOptional(value)),
  ) || Boolean(provider && (apiKey || model || baseUrl));
  return {
    ...(provider ? { provider } : {}),
    ...(apiKey ? { apiKey } : {}),
    ...(model ? { model } : {}),
    ...(baseUrl ? { baseUrl: validateServiceBaseUrl(baseUrl) } : {}),
    ...(enabled !== undefined ? { enabled } : {}),
    present,
  };
}

async function resolveIntegrationFromDocument(
  capability: IntegrationCapability,
  document: SettingsDocument,
): Promise<ResolvedIntegration> {
  if (!CAPABILITIES.includes(capability)) throw new Error("Unknown integration capability.");
  const settings = document.integrations[capability];
  const env = environmentOverrides(capability);
  // Environment-managed connections are intentionally atomic. Mixing a saved
  // secret with an environment-supplied provider or base URL could send that
  // secret to a different service. Once any capability-specific environment
  // override is present, use only environment values (plus provider defaults).
  const merged = env.present ? { ...env } : { ...settings };
  delete (merged as { present?: boolean }).present;
  if (merged.provider && !ALLOWED_PROVIDERS[capability].includes(merged.provider)) {
    throw new Error(`The selected provider does not support ${capability}.`);
  }
  const resolved: ResolvedIntegration = {
    capability,
    provider: merged.provider || "",
    model: merged.model,
    baseUrl: merged.baseUrl,
    apiKey: merged.apiKey,
    enabled: merged.enabled ?? Boolean(
      merged.provider || merged.apiKey || merged.model || merged.baseUrl,
    ),
    verified: false,
    source: env.present ? "environment" : settings ? "settings" : "none",
  };
  const storedVerification = document.verifications?.[capability];
  if (isConfigured(resolved) && isStoredVerification(storedVerification)) {
    const fingerprint = await integrationFingerprint(resolved);
    if (fingerprintsMatch(storedVerification.fingerprint, fingerprint)) {
      resolved.verified = true;
      resolved.verifiedAt = storedVerification.verifiedAt;
    }
  }
  return resolved;
}

export async function resolveIntegration(capability: IntegrationCapability): Promise<ResolvedIntegration> {
  return resolveIntegrationFromDocument(capability, await loadSettings());
}

function isConfigured(config: ResolvedIntegration): boolean {
  if (!config.provider || !config.apiKey) return false;
  if ((config.capability === "intelligence" || config.capability === "image") && !config.model) return false;
  if (config.provider === "openai-compatible" && !config.baseUrl) return false;
  return true;
}

function isReady(config: ResolvedIntegration): boolean {
  return config.enabled && isConfigured(config) && config.verified;
}

function summarize(config: ResolvedIntegration): IntegrationSummary {
  return {
    capability: config.capability,
    provider: config.provider,
    model: config.model || null,
    baseUrl: config.baseUrl || null,
    configured: isConfigured(config),
    enabled: config.enabled,
    verified: config.verified,
    ...(config.verifiedAt ? { verifiedAt: config.verifiedAt } : {}),
    source: config.source,
    ...(config.apiKey
      ? { keyHint: config.apiKey.length >= 8 ? `****${config.apiKey.slice(-4)}` : "****" }
      : {}),
  };
}

export async function listIntegrationSummaries(): Promise<IntegrationSummary[]> {
  return Promise.all(CAPABILITIES.map(async capability => summarize(await resolveIntegration(capability))));
}

export async function saveIntegrationSettings(input: IntegrationSettingsInput): Promise<IntegrationSummary> {
  if (!CAPABILITIES.includes(input.capability)) throw new Error("Unknown integration capability.");
  if (!ALLOWED_PROVIDERS[input.capability].includes(input.provider as IntegrationProvider)) {
    throw new Error(`The selected provider does not support ${input.capability}.`);
  }
  const baseUrl = cleanOptional(input.baseUrl);
  const model = cleanOptional(input.model);
  const apiKey = cleanOptional(input.apiKey);
  if (baseUrl) validateServiceBaseUrl(baseUrl);

  await queued(async () => {
    const document = await loadSettings();
    const existing = document.integrations[input.capability];
    const providerChanged = Boolean(existing && existing.provider !== input.provider);
    const defaults = PROVIDER_DEFAULTS[input.provider as IntegrationProvider]?.[input.capability];
    const nextModel = input.model === undefined
      ? providerChanged ? defaults?.model : existing?.model
      : model;
    const nextBaseUrl = input.baseUrl === undefined
      ? providerChanged ? defaults?.baseUrl : existing?.baseUrl
      : baseUrl;
    const normalizedNextBaseUrl = nextBaseUrl ? validateServiceBaseUrl(nextBaseUrl) : undefined;
    const normalizedExistingBaseUrl = existing?.baseUrl
      ? validateServiceBaseUrl(existing.baseUrl)
      : undefined;
    const identityChanged = Boolean(
      existing?.apiKey &&
      (existing.provider !== input.provider || normalizedExistingBaseUrl !== normalizedNextBaseUrl),
    );
    if (identityChanged && !apiKey) {
      throw new Error("Enter a new API key when changing the provider or service base URL.");
    }
    document.integrations[input.capability] = {
      provider: input.provider as IntegrationProvider,
      enabled: input.enabled ?? existing?.enabled ?? true,
      ...(nextModel ? { model: nextModel } : {}),
      ...(normalizedNextBaseUrl ? { baseUrl: normalizedNextBaseUrl } : {}),
      ...(apiKey ? { apiKey } : existing?.apiKey ? { apiKey: existing.apiKey } : {}),
    };
    const after = await resolveIntegrationFromDocument(input.capability, document);
    const afterFingerprint = await integrationFingerprint(after);
    if (!verificationMatches(document.verifications?.[input.capability], afterFingerprint)) {
      delete document.verifications?.[input.capability];
    }
    await persistSettings(document);
  });
  return summarize(await resolveIntegration(input.capability));
}

export async function clearIntegrationSecret(capability: IntegrationCapability): Promise<IntegrationSummary> {
  if (!CAPABILITIES.includes(capability)) throw new Error("Unknown integration capability.");
  await queued(async () => {
    const document = await loadSettings();
    const existing = document.integrations[capability];
    if (existing) delete existing.apiKey;
    delete document.verifications?.[capability];
    await persistSettings(document);
  });
  return summarize(await resolveIntegration(capability));
}

export async function setIntegrationVerification(
  capability: IntegrationCapability,
  verified: boolean,
  testedConfig?: ResolvedIntegration,
): Promise<IntegrationSummary> {
  if (!CAPABILITIES.includes(capability)) throw new Error("Unknown integration capability.");
  if (testedConfig && testedConfig.capability !== capability) {
    throw new Error("The tested integration capability does not match.");
  }
  const testedFingerprint = testedConfig
    ? await integrationFingerprint(testedConfig)
    : undefined;
  await queued(async () => {
    const document = await loadSettings();
    document.verifications ||= {};
    if (!verified) {
      if (
        !testedConfig ||
        verificationMatches(document.verifications[capability], testedFingerprint)
      ) {
        delete document.verifications[capability];
      }
    } else {
      const config = await resolveIntegrationFromDocument(capability, document);
      if (!isConfigured(config)) {
        throw new Error(`Configure the ${capability} integration first.`);
      }
      const currentFingerprint = await integrationFingerprint(config);
      if (testedConfig && !fingerprintsMatch(testedFingerprint, currentFingerprint)) {
        throw new Error("The integration settings changed during the connection test. Test the connection again.");
      }
      const fingerprint = testedFingerprint || currentFingerprint;
      if (!fingerprint) throw new Error(`Configure the ${capability} API key first.`);
      document.verifications[capability] = {
        fingerprint,
        verifiedAt: new Date().toISOString(),
      };
    }
    await persistSettings(document);
  });
  return summarize(await resolveIntegration(capability));
}

export async function hasIntegration(capability: IntegrationCapability): Promise<boolean> {
  return isReady(await resolveIntegration(capability));
}

export function requireReadyIntegration(config: ResolvedIntegration): void {
  requireConfiguredIntegration(config);
  if (!config.verified) {
    throw new Error(`Save and test the ${config.capability} integration before using it.`);
  }
}

export function requireConfiguredIntegration(config: ResolvedIntegration): void {
  if (!config.enabled) throw new Error(`The ${config.capability} integration is disabled.`);
  if (!config.provider || !config.apiKey) throw new Error(`Configure the ${config.capability} integration first.`);
  if ((config.capability === "intelligence" || config.capability === "image") && !config.model) {
    throw new Error(`Configure a model for the ${config.capability} integration.`);
  }
  if (config.provider === "openai-compatible" && !config.baseUrl) {
    throw new Error("Configure the OpenAI-compatible service base URL.");
  }
}
