import { describe, expect, it } from "vitest";
import {
  draftFromSummary, integrationSaveInput, refreshIntegrationDrafts,
  type Capability, type IntegrationDraft, type IntegrationSummary,
} from "../../client/src/lib/integration-drafts";

const defaults: Record<Capability, IntegrationDraft> = {
  intelligence: { provider: "anthropic", model: "default-model", baseUrl: "", apiKey: "", enabled: true },
  search: { provider: "tavily", model: "", baseUrl: "", apiKey: "", enabled: true },
  image: { provider: "gemini", model: "image-model", baseUrl: "", apiKey: "", enabled: true },
};
const summary: IntegrationSummary = {
  capability: "intelligence", provider: "anthropic", model: "saved-model", baseUrl: null,
  enabled: true, configured: true, verified: false, source: "settings", keyHint: "****test",
};

describe("integration form drafts", () => {
  it("preserves unsaved fields and keys across background refreshes and saves of other capabilities", () => {
    const current = { ...defaults, intelligence: { ...defaults.intelligence, model: "editing-model", apiKey: "unsaved-secret" } };
    const refreshed = refreshIntegrationDrafts(current, [summary], new Set(["intelligence"]), defaults);
    expect(refreshed.intelligence).toEqual(current.intelligence);
  });
  it("updates untouched fields without putting masked keys into password inputs", () => {
    const refreshed = refreshIntegrationDrafts(defaults, [summary], new Set(), defaults);
    expect(refreshed.intelligence).toMatchObject({ model: "saved-model", apiKey: "" });
  });
  it("clears old endpoint values explicitly while retaining a saved secret", () => {
    expect(integrationSaveInput("intelligence", defaults.intelligence)).toMatchObject({ baseUrl: "", apiKey: undefined });
  });
  it("discards a secret draft when the connection becomes environment-managed", () => {
    const current = { ...defaults, intelligence: { ...defaults.intelligence, apiKey: "unsaved-secret" } };
    const refreshed = refreshIntegrationDrafts(current, [{ ...summary, source: "environment" }], new Set(["intelligence"]), defaults);
    expect(refreshed.intelligence).toMatchObject({ model: "saved-model", apiKey: "" });
  });
  it("resets unsaved edits to the latest saved summary", () => {
    expect(draftFromSummary(summary, defaults.intelligence)).toEqual({
      provider: "anthropic", model: "saved-model", baseUrl: "", apiKey: "", enabled: true,
    });
  });
});
