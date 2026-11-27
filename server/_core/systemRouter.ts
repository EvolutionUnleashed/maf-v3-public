import { z } from "zod";
import { publicProcedure, router } from "./trpc";
import { getDatabaseSetupStatus } from "../db";
import { listIntegrationSummaries } from "../integrations";

export const systemRouter = router({
  health: publicProcedure
    .input(z.object({ timestamp: z.number().min(0).optional() }).optional())
    .query(() => ({
      ok: true,
    })),
  setupStatus: publicProcedure.query(async () => {
    const database = await getDatabaseSetupStatus();
    try {
      const integrations = (await listIntegrationSummaries()).map((item) => ({
        capability: item.capability,
        provider: item.provider,
        configured: item.configured,
        enabled: item.enabled,
        verified: item.verified,
        verifiedAt: item.verifiedAt,
        source: item.source,
      }));
      const intelligenceReady = integrations.some(
        item => item.capability === "intelligence" && item.configured && item.enabled && item.verified,
      );
      return {
        database,
        integrations,
        integrationsReadable: true,
        integrationsMessage: "API settings are available.",
        ready: database.ready && intelligenceReady,
      };
    } catch {
      return {
        database,
        integrations: [],
        integrationsReadable: false,
        integrationsMessage:
          "Saved API settings could not be read. Check MAF_CONFIG_ENCRYPTION_KEY and MAF_DATA_DIR, then restart MAF V3.",
        ready: false,
      };
    }
  }),
});
