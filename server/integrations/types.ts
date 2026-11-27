export type IntegrationCapability = "intelligence" | "search" | "image";

export type IntegrationProvider =
  | "openai-compatible"
  | "anthropic"
  | "gemini"
  | "tavily";

export type IntegrationSettingsInput = {
  capability: IntegrationCapability;
  provider: string;
  model?: string | null;
  baseUrl?: string | null;
  apiKey?: string | null;
  enabled?: boolean;
};

export type IntegrationSummary = {
  capability: IntegrationCapability;
  provider: IntegrationProvider | "";
  model: string | null;
  baseUrl: string | null;
  configured: boolean;
  enabled: boolean;
  verified: boolean;
  verifiedAt?: string;
  source: "environment" | "settings" | "none";
  keyHint?: string;
};

export type ResolvedIntegration = {
  capability: IntegrationCapability;
  provider: IntegrationProvider | "";
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  enabled: boolean;
  verified: boolean;
  verifiedAt?: string;
  source: IntegrationSummary["source"];
};

export type SearchResult = {
  title: string;
  url: string;
  content: string;
  publishedDate?: string;
};
