import { fetchWithTimeout, joinServiceUrl, readJsonResponse } from "./http";
import {
  requireConfiguredIntegration,
  requireReadyIntegration,
  resolveIntegration,
} from "./config";
import type { ResolvedIntegration, SearchResult } from "./types";

const DEFAULT_TAVILY_BASE_URL = "https://api.tavily.com";

function boundedInteger(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(10, Math.trunc(value as number)));
}

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export async function searchWeb(
  query: string,
  options: { maxResults?: number; allowUnverified?: boolean; configuration?: ResolvedIntegration } = {},
): Promise<SearchResult[]> {
  const cleanQuery = query.trim();
  if (!cleanQuery) throw new Error("A search query is required.");
  if (cleanQuery.length > 1_000) throw new Error("The search query is too long.");

  const config = options.configuration ?? await resolveIntegration("search");
  if (config.capability !== "search") throw new Error("The search connection does not match this request.");
  if (options.allowUnverified) requireConfiguredIntegration(config);
  else requireReadyIntegration(config);
  if (config.provider !== "tavily") throw new Error("The configured search provider is unsupported.");

  const maxResults = boundedInteger(options.maxResults, 5);
  const response = await fetchWithTimeout(
    joinServiceUrl(config.baseUrl || DEFAULT_TAVILY_BASE_URL, "search"),
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        query: cleanQuery,
        max_results: maxResults,
        search_depth: "basic",
        include_answer: false,
        include_raw_content: false,
      }),
    },
  );
  const payload = (await readJsonResponse(response)) as { results?: unknown[] };
  if (!Array.isArray(payload.results)) throw new Error("The search provider returned an invalid response.");

  return payload.results.slice(0, maxResults).flatMap(item => {
    if (!item || typeof item !== "object") return [];
    const result = item as Record<string, unknown>;
    const title = cleanText(result.title, 500);
    const url = cleanText(result.url, 4_000);
    const content = cleanText(result.content, 8_000);
    if (!title || !url) return [];
    const publishedDate = cleanText(result.published_date ?? result.publishedDate, 100);
    return [{ title, url, content, ...(publishedDate ? { publishedDate } : {}) }];
  });
}
