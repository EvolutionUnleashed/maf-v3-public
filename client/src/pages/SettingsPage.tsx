import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useTheme } from "@/contexts/ThemeContext";
import { trpc } from "@/lib/trpc";
import { draftFromSummary, integrationSaveInput, refreshIntegrationDrafts, type Capability, type IntegrationDraft, type IntegrationSummary } from "@/lib/integration-drafts";
import {
  ArrowLeft,
  ArrowRight,
  Brain,
  CheckCircle2,
  CircleAlert,
  Database,
  EyeOff,
  ExternalLink,
  ImageIcon,
  KeyRound,
  Lightbulb,
  Loader2,
  LockKeyhole,
  Moon,
  RefreshCw,
  Save,
  Search,
  ServerCog,
  ShieldCheck,
  Sun,
  Trash2,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useLocation, useSearchParams } from "wouter";

const CAPABILITIES: Array<{
  capability: Capability;
  title: string;
  description: string;
  icon: typeof Brain;
}> = [
  {
    capability: "intelligence",
    title: "Intelligence",
    description: "Powers BUILD analysis, idea development, writing, review, and refinement.",
    icon: Brain,
  },
  {
    capability: "search",
    title: "Web search",
    description: "Adds current web sources to market and topic research through Tavily.",
    icon: Search,
  },
  {
    capability: "image",
    title: "Image generation",
    description: "Creates visual assets for content when an image is requested.",
    icon: ImageIcon,
  },
];

const PROVIDERS: Record<Capability, Array<{ value: string; label: string }>> = {
  intelligence: [
    { value: "openai-compatible", label: "OpenAI or compatible" },
    { value: "anthropic", label: "Anthropic" },
    { value: "gemini", label: "Gemini" },
  ],
  search: [{ value: "tavily", label: "Tavily" }],
  image: [
    { value: "openai-compatible", label: "OpenAI or compatible" },
    { value: "gemini", label: "Gemini" },
  ],
};

const DEFAULT_DRAFTS: Record<Capability, IntegrationDraft> = {
  intelligence: {
    provider: "openai-compatible",
    model: "gpt-5.6-luna",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "",
    enabled: true,
  },
  search: {
    provider: "tavily",
    model: "",
    baseUrl: "",
    apiKey: "",
    enabled: true,
  },
  image: {
    provider: "openai-compatible",
    model: "gpt-image-2",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "",
    enabled: true,
  },
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

function modelPlaceholder(capability: Capability, provider: string): string {
  if (capability === "search") return "Optional for this provider";
  if (provider === "anthropic") return "claude-sonnet-5";
  if (provider === "gemini") {
    return capability === "image" ? "gemini-3.1-flash-image" : "gemini-3.6-flash";
  }
  return capability === "image" ? "gpt-image-2" : "gpt-5.6-luna";
}

function defaultsFor(capability: Capability, provider: string): Partial<IntegrationDraft> {
  if (provider === "anthropic") {
    return { model: "claude-sonnet-5", baseUrl: "" };
  }
  if (provider === "gemini") {
    return {
      model: capability === "image" ? "gemini-3.1-flash-image" : "gemini-3.6-flash",
      baseUrl: "",
    };
  }
  if (provider === "tavily") return { model: "", baseUrl: "" };
  return {
    model: capability === "image" ? "gpt-image-2" : "gpt-5.6-luna",
    baseUrl: "https://api.openai.com/v1",
  };
}

function keyHelp(capability: Capability, draft: IntegrationDraft) {
  if (capability === "search") {
    return { label: "Get a Tavily key", href: "https://app.tavily.com/home" };
  }
  if (draft.provider === "anthropic") {
    return { label: "Get an Anthropic key", href: "https://console.anthropic.com/settings/keys" };
  }
  if (draft.provider === "gemini") {
    return { label: "Get a Gemini key", href: "https://aistudio.google.com/apikey" };
  }
  if (draft.baseUrl.includes("openrouter.ai")) {
    return { label: "Get an OpenRouter key", href: "https://openrouter.ai/settings/keys" };
  }
  return { label: "Get an OpenAI key", href: "https://platform.openai.com/api-keys" };
}

function normalizedUrl(value: string | null | undefined) {
  return (value || "").trim().replace(/\/+$/, "");
}

function isDraftDirty(draft: IntegrationDraft, summary?: IntegrationSummary) {
  if (!summary) return Boolean(draft.apiKey.trim());
  return Boolean(
    draft.apiKey.trim() ||
    draft.provider !== summary.provider ||
    draft.model.trim() !== (summary.model || "") ||
    normalizedUrl(draft.baseUrl) !== normalizedUrl(summary.baseUrl) ||
    draft.enabled !== summary.enabled
  );
}

function SettingsNav() {
  const [, setLocation] = useLocation();
  const { theme, toggleTheme } = useTheme();

  return (
    <nav className="sticky top-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur-xl">
      <div className="container flex h-14 items-center justify-between">
        <button
          type="button"
          onClick={() => setLocation("/")}
          className="flex items-center gap-2.5 transition-opacity hover:opacity-80"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary">
            <Zap className="h-3.5 w-3.5 text-primary-foreground" />
          </span>
          <span className="text-sm font-semibold tracking-tight">MAF V3</span>
        </button>
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setLocation("/ideas")}
            className="h-8 gap-2 px-3 text-xs"
          >
            <Lightbulb className="h-3.5 w-3.5" /> Ideas
          </Button>
          <button
            type="button"
            onClick={toggleTheme}
            aria-label="Toggle colour theme"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
          >
            {theme === "dark" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
    </nav>
  );
}

export default function SettingsPage() {
  const [, setLocation] = useLocation();
  const [searchParams] = useSearchParams();
  const firstRun = searchParams.get("firstRun") === "1";
  const utils = trpc.useUtils();
  const integrationsQuery = trpc.integrations.list.useQuery();
  const setupQuery = trpc.system.setupStatus.useQuery();
  const saveMutation = trpc.integrations.save.useMutation();
  const clearMutation = trpc.integrations.clearSecret.useMutation();
  const testMutation = trpc.integrations.test.useMutation();
  const [drafts, setDrafts] = useState<Record<Capability, IntegrationDraft>>(DEFAULT_DRAFTS);
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Partial<Record<Capability, { success: boolean; message: string }>>>({});
  const editedDrafts = useRef(new Set<Capability>());

  const summaries = (integrationsQuery.data ?? []) as IntegrationSummary[];
  const summaryByCapability = useMemo(
    () =>
      Object.fromEntries(
        summaries.map((summary) => [summary.capability, summary]),
      ) as Partial<Record<Capability, IntegrationSummary>>,
    [summaries],
  );

  useEffect(() => {
    if (!integrationsQuery.data) return;

    setDrafts((current) => refreshIntegrationDrafts(current, integrationsQuery.data as IntegrationSummary[], editedDrafts.current, DEFAULT_DRAFTS));
  }, [integrationsQuery.data]);

  const updateDraft = (capability: Capability, patch: Partial<IntegrationDraft>) => {
    editedDrafts.current.add(capability);
    setTestResults(current => ({ ...current, [capability]: undefined }));
    setDrafts((current) => ({
      ...current,
      [capability]: { ...current[capability], ...patch },
    }));
  };

  const resetDraft = (capability: Capability, summary = summaryByCapability[capability]) => {
    editedDrafts.current.delete(capability);
    setDrafts(current => ({ ...current, [capability]: draftFromSummary(summary, DEFAULT_DRAFTS[capability]) }));
  };

  const updateConnectionIdentity = (
    capability: Capability,
    patch: Partial<Pick<IntegrationDraft, "provider" | "baseUrl" | "model">>,
  ) => {
    const current = drafts[capability];
    const nextProvider = patch.provider ?? current.provider;
    const nextBaseUrl = patch.baseUrl ?? current.baseUrl;
    const identityChanged =
      nextProvider !== current.provider ||
      normalizedUrl(nextBaseUrl) !== normalizedUrl(current.baseUrl);
    if (identityChanged && current.apiKey.trim()) {
      toast.info("The unsaved API key was cleared because the provider or endpoint changed.");
    }
    updateDraft(capability, {
      ...patch,
      ...(identityChanged ? { apiKey: "" } : {}),
    });
  };

  const saveIntegration = async (capability: Capability) => {
    const draft = drafts[capability];
    const summary = summaryByCapability[capability];

    if (summary?.source === "environment") return;
    if ((capability === "intelligence" || capability === "image") && !draft.model.trim()) {
      toast.error("Add a model before saving this connection.");
      return;
    }
    if (draft.provider === "openai-compatible" && !draft.baseUrl.trim()) {
      toast.error("Add a base URL for the OpenAI-compatible provider.");
      return;
    }
    if (!summary?.keyHint && !draft.apiKey.trim()) {
      toast.error("Add an API key before saving this connection.");
      return;
    }
    const connectionChanged = Boolean(
      summary?.keyHint &&
      (draft.provider !== summary.provider || normalizedUrl(draft.baseUrl) !== normalizedUrl(summary.baseUrl)),
    );
    if (connectionChanged && !draft.apiKey.trim()) {
      toast.error("Paste a new API key when changing the provider or base URL. This prevents a key from being sent to the wrong service.");
      return;
    }

    setActiveAction(`save:${capability}`);
    setTestResults(current => ({ ...current, [capability]: undefined }));
    try {
      const saved = await saveMutation.mutateAsync(integrationSaveInput(capability, draft));
      resetDraft(capability, saved);
      await utils.integrations.list.invalidate();
      await utils.system.setupStatus.invalidate();
      if (saved.enabled && saved.configured) {
        const result = await testMutation.mutateAsync({ capability });
        setTestResults(current => ({ ...current, [capability]: result }));
        await Promise.all([
          utils.integrations.list.invalidate(),
          utils.system.setupStatus.invalidate(),
        ]);
        if (result.success) {
          toast.success(`${CAPABILITIES.find((item) => item.capability === capability)?.title} saved. ${result.message}`);
        } else {
          toast.error(`Settings saved, but the test failed: ${result.message}`);
        }
      } else {
        toast.success(`${CAPABILITIES.find((item) => item.capability === capability)?.title} settings saved.`);
      }
    } catch (error) {
      setTestResults(current => ({ ...current, [capability]: { success: false, message: errorMessage(error) } }));
      toast.error(errorMessage(error));
    } finally {
      setActiveAction(null);
    }
  };

  const clearSecret = async (capability: Capability) => {
    const summary = summaryByCapability[capability];
    if (summary?.source !== "settings") return;

    const confirmed = window.confirm(
      `Remove the saved API key for ${CAPABILITIES.find((item) => item.capability === capability)?.title.toLowerCase()}?`,
    );
    if (!confirmed) return;

    setActiveAction(`clear:${capability}`);
    try {
      const cleared = await clearMutation.mutateAsync({ capability });
      resetDraft(capability, cleared);
      setTestResults(current => ({ ...current, [capability]: undefined }));
      await utils.integrations.list.invalidate();
      await utils.system.setupStatus.invalidate();
      toast.success("Saved API key removed.");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setActiveAction(null);
    }
  };

  const testConnection = async (capability: Capability) => {
    setActiveAction(`test:${capability}`);
    setTestResults(current => ({ ...current, [capability]: undefined }));
    try {
      const result = await testMutation.mutateAsync({ capability });
      setTestResults(current => ({ ...current, [capability]: result }));
      await Promise.all([
        utils.integrations.list.invalidate(),
        utils.system.setupStatus.invalidate(),
      ]);
      if (result.success) toast.success(result.message);
      else toast.error(`Connection test failed: ${result.message}`);
    } catch (error) {
      setTestResults(current => ({ ...current, [capability]: { success: false, message: errorMessage(error) } }));
      toast.error(errorMessage(error));
    } finally {
      setActiveAction(null);
    }
  };

  const configuredCount = summaries.filter((summary) => summary.configured && summary.enabled && summary.verified).length;
  const intelligenceConfigured = summaries.some(
    (summary) => summary.capability === "intelligence" && summary.configured && summary.enabled && summary.verified,
  );

  return (
    <div className="min-h-screen bg-background">
      <SettingsNav />

      <main className="container max-w-5xl space-y-7 py-8 sm:py-10">
        <header>
          <button
            type="button"
            onClick={() => setLocation("/dashboard")}
            className="mb-5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to dashboard
          </button>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="mb-2 flex items-center gap-2">
                <Badge variant="secondary" className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest">
                  Bring your own API
                </Badge>
                <span className="text-xs text-muted-foreground">{configuredCount} of 3 verified</span>
              </div>
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">API integrations</h1>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
                Choose the services MAF V3 can use for intelligence, live web research, and image generation.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => integrationsQuery.refetch()} disabled={integrationsQuery.isFetching}>
                <RefreshCw className={`mr-2 h-3.5 w-3.5 ${integrationsQuery.isFetching ? "animate-spin" : ""}`} />
                Refresh status
              </Button>
              {intelligenceConfigured && (
                <Button size="sm" onClick={() => setLocation("/setup")}>
                  Continue setup <ArrowRight className="ml-2 h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </div>
        </header>

        {firstRun && !intelligenceConfigured && (
          <Alert className="border-primary/25 bg-primary/[0.05]">
            <Brain className="text-primary" />
            <AlertTitle>Start with Intelligence</AlertTitle>
            <AlertDescription>
              <p>Choose your provider below, paste its API key, then select <strong>Save &amp; test</strong>. Tavily search and Images can be added now or later.</p>
            </AlertDescription>
          </Alert>
        )}

        <Alert className="border-primary/20 bg-primary/[0.04]">
          <ShieldCheck className="text-primary" />
          <AlertTitle>Stored locally, used only with your chosen providers</AlertTitle>
          <AlertDescription>
            <p>
              Saved keys are encrypted in this app's local data folder and are never displayed again. To perform a task, MAF sends the relevant prompt or content and that capability's key to the provider endpoint you configure. Tavily receives search queries, and image providers receive image prompts. Each provider's privacy, retention, usage, and billing terms apply.
            </p>
          </AlertDescription>
        </Alert>

        {setupQuery.data && !setupQuery.data.database.ready && (
          <Alert className="border-warning/30 bg-warning/[0.05]">
            <Database className="text-warning" />
            <AlertTitle>Database setup still needs attention</AlertTitle>
            <AlertDescription>
              <p>{setupQuery.data.database.message} You can add API keys now, then finish the database from the setup page.</p>
              <Button variant="link" className="mt-1 h-auto p-0 text-xs" onClick={() => setLocation("/setup")}>
                Open setup checklist
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {integrationsQuery.isLoading ? (
          <div className="flex min-h-64 items-center justify-center rounded-2xl border border-border/40">
            <div className="text-center">
              <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" />
              <p className="mt-3 text-sm text-muted-foreground">Loading integration settings...</p>
            </div>
          </div>
        ) : integrationsQuery.isError ? (
          <div className="rounded-2xl border border-destructive/25 bg-destructive/[0.04] p-8 text-center">
            <CircleAlert className="mx-auto h-6 w-6 text-destructive" />
            <h2 className="mt-4 text-base font-semibold">Integration settings could not be loaded</h2>
            <p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">
              Close and reopen MAF V3, then try again. Your saved work has not been deleted. If the problem continues, use File &gt; Export diagnostics and share the report with support. If you moved the app's data, restore the complete original data folder, including its encryption key.
            </p>
            <Button variant="outline" size="sm" className="mt-5" onClick={() => integrationsQuery.refetch()}>
              Try again
            </Button>
          </div>
        ) : (
          <div className="space-y-5">
            {CAPABILITIES.map((item) => {
              const draft = drafts[item.capability];
              const summary = summaryByCapability[item.capability];
              const environmentManaged = summary?.source === "environment";
              const savedInSettings = summary?.source === "settings";
              const ready = Boolean(summary?.configured && summary.enabled && summary.verified);
              const needsTest = Boolean(summary?.configured && summary.enabled && !summary.verified);
              const disabled = Boolean(summary && summary.source !== "none" && !summary.enabled);
              const Icon = item.icon;
              const saving = activeAction === `save:${item.capability}`;
              const clearing = activeAction === `clear:${item.capability}`;
              const testing = activeAction === `test:${item.capability}`;
              const dirty = isDraftDirty(draft, summary);
              const help = keyHelp(item.capability, draft);

              return (
                <section key={item.capability} className="overflow-hidden rounded-2xl border border-border/40 bg-card/40">
                  <div className="flex flex-col gap-4 border-b border-border/30 p-5 sm:flex-row sm:items-start sm:justify-between sm:p-6">
                    <div className="flex gap-4">
                      <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${ready ? "bg-success/10" : "bg-primary/10"}`}>
                        <Icon className={`h-5 w-5 ${ready ? "text-success" : "text-primary"}`} />
                      </span>
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="text-lg font-semibold tracking-tight">{item.title}</h2>
                          {environmentManaged && (
                            <Badge className="border-0 bg-primary/10 text-[10px] text-primary">Environment managed</Badge>
                          )}
                          {savedInSettings && (
                            <Badge variant="secondary" className="border-0 text-[10px]">Saved settings</Badge>
                          )}
                        </div>
                        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">{item.description}</p>
                      </div>
                    </div>
                    <Badge
                      variant="secondary"
                      className={`w-fit shrink-0 border-0 ${
                        ready
                          ? "bg-success/10 text-success"
                          : disabled
                            ? "bg-warning/10 text-warning"
                            : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {ready ? "Verified" : disabled ? "Disabled" : needsTest ? "Configured, test needed" : "Needs setup"}
                    </Badge>
                  </div>

                  <div className="space-y-6 p-5 sm:p-6">
                    {environmentManaged && (
                      <Alert className="border-primary/20 bg-primary/[0.035]">
                        <ServerCog className="text-primary" />
                        <AlertTitle>Managed by environment variables</AlertTitle>
                        <AlertDescription>
                          <p>This connection is read-only here. Update the matching values in the server environment, then restart MAF V3 and refresh this page.</p>
                        </AlertDescription>
                      </Alert>
                    )}

                    <div className="grid gap-5 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor={`${item.capability}-provider`}>Provider</Label>
                        <Select
                          value={draft.provider}
                          onValueChange={(provider) => updateConnectionIdentity(item.capability, { provider, ...defaultsFor(item.capability, provider) })}
                          disabled={environmentManaged || Boolean(activeAction)}
                        >
                          <SelectTrigger id={`${item.capability}-provider`} className="w-full">
                            <SelectValue placeholder="Choose a provider" />
                          </SelectTrigger>
                          <SelectContent>
                            {PROVIDERS[item.capability].map((provider) => (
                              <SelectItem key={provider.value} value={provider.value}>
                                {provider.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor={`${item.capability}-model`}>
                          Model {item.capability === "search" && <span className="font-normal text-muted-foreground">(optional)</span>}
                        </Label>
                        <Input
                          id={`${item.capability}-model`}
                          value={draft.model}
                          onChange={(event) => updateDraft(item.capability, { model: event.target.value })}
                          placeholder={modelPlaceholder(item.capability, draft.provider)}
                          disabled={environmentManaged || Boolean(activeAction)}
                        />
                      </div>

                      <div className="space-y-2 sm:col-span-2">
                        <Label htmlFor={`${item.capability}-base-url`}>
                          Base URL <span className="font-normal text-muted-foreground">{draft.provider === "openai-compatible" ? "(required)" : "(optional)"}</span>
                        </Label>
                        <Input
                          id={`${item.capability}-base-url`}
                          type="url"
                          value={draft.baseUrl}
                          onChange={(event) => updateConnectionIdentity(item.capability, { baseUrl: event.target.value })}
                          placeholder={draft.provider === "openai-compatible" ? "https://api.example.com/v1" : "Custom endpoint or proxy URL"}
                          disabled={environmentManaged || Boolean(activeAction)}
                        />
                        <p className="text-[11px] leading-relaxed text-muted-foreground">Use a custom endpoint for a compatible service or proxy. Leave this blank when the provider uses its standard endpoint.</p>
                        {draft.provider === "openai-compatible" && (
                          <div className="flex flex-wrap gap-2 pt-1">
                            <Button type="button" variant="outline" size="sm" className="h-7 text-[11px]" onClick={() => updateConnectionIdentity(item.capability, defaultsFor(item.capability, "openai-compatible"))} disabled={environmentManaged || Boolean(activeAction)}>
                              OpenAI preset
                            </Button>
                            {item.capability === "intelligence" && (
                              <Button type="button" variant="outline" size="sm" className="h-7 text-[11px]" onClick={() => updateConnectionIdentity(item.capability, { baseUrl: "https://openrouter.ai/api/v1", model: "~openai/gpt-latest" })} disabled={environmentManaged || Boolean(activeAction)}>
                                OpenRouter preset
                              </Button>
                            )}
                            <Button type="button" variant="ghost" size="sm" className="h-7 text-[11px]" onClick={() => updateConnectionIdentity(item.capability, { baseUrl: "", model: "" })} disabled={environmentManaged || Boolean(activeAction)}>
                              Custom endpoint
                            </Button>
                          </div>
                        )}
                      </div>

                      <div className="space-y-2 sm:col-span-2">
                        <Label htmlFor={`${item.capability}-api-key`}>API key</Label>
                        <div className="relative">
                          <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                          <Input
                            id={`${item.capability}-api-key`}
                            type="password"
                            autoComplete="new-password"
                            value={draft.apiKey}
                            onChange={(event) => updateDraft(item.capability, { apiKey: event.target.value })}
                            placeholder={summary?.keyHint ? "Enter a new key to replace the saved key" : "Paste your API key"}
                            className="pl-9"
                            disabled={environmentManaged || Boolean(activeAction)}
                          />
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
                          <span className="flex items-center gap-1.5">
                            <EyeOff className="h-3 w-3" /> The full key is never displayed after saving.
                          </span>
                          {summary?.keyHint && (
                            <span className="flex items-center gap-1.5 font-mono">
                              <LockKeyhole className="h-3 w-3" /> {summary.keyHint}
                            </span>
                          )}
                        </div>
                        <a href={help.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                          {help.label} <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>
                    </div>

                    <div className="flex flex-col gap-4 border-t border-border/30 pt-5 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-center gap-3">
                        <Switch
                          id={`${item.capability}-enabled`}
                          checked={draft.enabled}
                          onCheckedChange={(enabled) => updateDraft(item.capability, { enabled })}
                          disabled={environmentManaged || Boolean(activeAction)}
                        />
                        <div>
                          <Label htmlFor={`${item.capability}-enabled`}>Enable this capability</Label>
                          <p className="mt-1 text-[11px] text-muted-foreground">MAF uses the connection only while this is enabled.</p>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {!environmentManaged && dirty && (
                          <Button variant="ghost" size="sm" onClick={() => resetDraft(item.capability)} disabled={Boolean(activeAction)}>
                            Discard edits
                          </Button>
                        )}
                        {savedInSettings && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => clearSecret(item.capability)}
                            disabled={Boolean(activeAction) || environmentManaged || !summary?.keyHint}
                            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                          >
                            {clearing ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Trash2 className="mr-2 h-3.5 w-3.5" />}
                            Clear key
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => testConnection(item.capability)}
                          disabled={Boolean(activeAction) || !summary?.configured || !summary.enabled || dirty}
                        >
                          {testing ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="mr-2 h-3.5 w-3.5" />}
                          {dirty ? "Save changes first" : summary?.verified ? "Test again" : "Test connection"}
                        </Button>
                        {!environmentManaged && (
                          <Button
                            size="sm"
                            onClick={() => saveIntegration(item.capability)}
                            disabled={Boolean(activeAction)}
                          >
                            {saving ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-2 h-3.5 w-3.5" />}
                            {saving ? "Saving & testing..." : draft.enabled ? "Save & test" : "Save disabled"}
                          </Button>
                        )}
                      </div>
                    </div>
                    {testResults[item.capability] && (
                      <div role="status" className={`rounded-lg border p-3 text-xs leading-relaxed ${testResults[item.capability]?.success ? "border-success/25 bg-success/5" : "border-destructive/25 bg-destructive/5"}`}>
                        {testResults[item.capability]?.message}
                      </div>
                    )}
                    {!environmentManaged && (
                      <p className="text-[11px] leading-relaxed text-muted-foreground">
                        Save &amp; test sends a small request to this provider and may count toward its usage. Image testing checks credentials and model access without generating a billable image.
                      </p>
                    )}
                    {environmentManaged && (
                      <p className="border-t border-border/30 pt-4 text-[11px] leading-relaxed text-muted-foreground">
                        Environment prefix: <code className="font-mono text-foreground">MAF_{item.capability.toUpperCase()}_*</code>. Test the connection here after each environment change. The verification record contains a keyed fingerprint, never a copy of the environment secret.
                      </p>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        )}

        <p className="pb-4 text-center text-xs leading-relaxed text-muted-foreground">
          API limits and usage terms come from each connected service.
        </p>
      </main>
    </div>
  );
}
