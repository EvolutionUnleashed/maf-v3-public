import path from "node:path";

const dataDir = process.env.MAF_DATA_DIR?.trim();
const legacyIntegrationTimeout = process.env.MAF_INTEGRATION_TIMEOUT_MS;

/** Runtime settings which are safe to expose to server modules. */
export const ENV = {
  isProduction: process.env.NODE_ENV === "production",
  dataDir: path.resolve(dataDir || path.join(process.cwd(), "data")),
  configEncryptionKey: process.env.MAF_CONFIG_ENCRYPTION_KEY?.trim() || "",
  integrationTestTimeoutMs: parsePositiveInteger(
    process.env.MAF_INTEGRATION_TEST_TIMEOUT_MS || legacyIntegrationTimeout,
    30_000,
  ),
  llmTimeoutMs: parsePositiveInteger(
    process.env.MAF_LLM_TIMEOUT_MS || legacyIntegrationTimeout,
    120_000,
  ),
  imageTimeoutMs: parsePositiveInteger(
    process.env.MAF_IMAGE_TIMEOUT_MS || legacyIntegrationTimeout,
    180_000,
  ),
  imageDownloadLimitBytes: parsePositiveInteger(
    process.env.MAF_IMAGE_DOWNLOAD_LIMIT_BYTES,
    25 * 1024 * 1024,
  ),
};

function parsePositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
