export type Capability = "intelligence" | "search" | "image";
export type IntegrationSummary = {
  capability: Capability;
  provider: string;
  model: string | null;
  baseUrl: string | null;
  configured: boolean;
  enabled: boolean;
  verified: boolean;
  verifiedAt?: string;
  source: "environment" | "settings" | "none";
  keyHint?: string;
};
export type IntegrationDraft = {
  provider: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  enabled: boolean;
};

export function draftFromSummary(summary: IntegrationSummary | undefined, fallback: IntegrationDraft): IntegrationDraft {
  if (!summary || summary.source === "none") return { ...fallback };
  return {
    provider: summary.provider || fallback.provider,
    model: summary.model ?? "",
    baseUrl: summary.baseUrl ?? "",
    apiKey: "",
    enabled: summary.enabled,
  };
}

export function refreshIntegrationDrafts(
  current: Record<Capability, IntegrationDraft>,
  summaries: IntegrationSummary[],
  edited: ReadonlySet<Capability>,
  defaults: Record<Capability, IntegrationDraft>,
): Record<Capability, IntegrationDraft> {
  const next = { ...current };
  for (const summary of summaries) {
    if (edited.has(summary.capability) && summary.source !== "environment") continue;
    next[summary.capability] = draftFromSummary(summary, defaults[summary.capability]);
  }
  return next;
}

export function integrationSaveInput(capability: Capability, draft: IntegrationDraft) {
  return {
    capability,
    provider: draft.provider,
    // Explicit blanks clear optional values; undefined means keep the saved value.
    model: draft.model.trim(),
    baseUrl: draft.baseUrl.trim(),
    apiKey: draft.apiKey.trim() || undefined,
    enabled: draft.enabled,
  };
}
