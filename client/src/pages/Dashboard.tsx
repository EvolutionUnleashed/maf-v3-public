import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useTheme } from "@/contexts/ThemeContext";
import { trpc } from "@/lib/trpc";
import { BUILD_SECTIONS, SECTION_LABELS } from "@shared/maf-constants";
import {
  ArrowRight,
  BarChart3,
  Brain,
  Check,
  CheckCircle2,
  CircleOff,
  Database,
  FileText,
  ImageIcon,
  Layers3,
  Library,
  Lightbulb,
  Loader2,
  Lock,
  Moon,
  Palette,
  PenTool,
  RefreshCw,
  Search,
  Settings2,
  Sparkles,
  Sun,
  Target,
  Wrench,
  Zap,
} from "lucide-react";
import { useMemo } from "react";
import { useLocation } from "wouter";

type Capability = "intelligence" | "search" | "image";
type IntegrationSummary = {
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

const SECTION_ICONS = {
  research: BarChart3,
  offer: Target,
  brand: Palette,
  strategy: Layers3,
};

const SECTION_DESCRIPTIONS = {
  research: "Market intelligence and audience research",
  offer: "Offer positioning and clear differentiation",
  brand: "Voice, values, and visual direction",
  strategy: "Customer journey and content strategy",
};

const CAPABILITIES: Array<{
  capability: Capability;
  label: string;
  description: string;
  icon: typeof Brain;
}> = [
  {
    capability: "intelligence",
    label: "Intelligence",
    description: "Required for BUILD analysis and content generation",
    icon: Brain,
  },
  {
    capability: "search",
    label: "Web search",
    description: "Optional Tavily connection for current research",
    icon: Search,
  },
  {
    capability: "image",
    label: "Image generation",
    description: "Optional connection for generated visual assets",
    icon: ImageIcon,
  },
];

function DashboardNav() {
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
          <Badge variant="outline" className="text-[10px]">
            Research preview
          </Badge>
        </button>

        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setLocation("/ideas")}
            className="hidden h-8 gap-2 px-3 text-xs sm:flex"
          >
            <Lightbulb className="h-3.5 w-3.5" /> Ideas
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setLocation("/settings/integrations")}
            className="hidden h-8 gap-2 px-3 text-xs sm:flex"
          >
            <Settings2 className="h-3.5 w-3.5" /> Integrations
          </Button>
          <button
            type="button"
            onClick={toggleTheme}
            aria-label="Toggle colour theme"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
          >
            {theme === "dark" ? (
              <Sun className="h-3.5 w-3.5" />
            ) : (
              <Moon className="h-3.5 w-3.5" />
            )}
          </button>
          <button
            type="button"
            onClick={() => setLocation("/settings/integrations")}
            aria-label="Open integrations"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground sm:hidden"
          >
            <Settings2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </nav>
  );
}

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const setupQuery = trpc.system.setupStatus.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });
  const databaseReady = Boolean(setupQuery.data?.database.ready);
  const buildQuery = trpc.build.getState.useQuery(undefined, {
    enabled: databaseReady,
    retry: false,
  });
  const libraryQuery = trpc.library.list.useQuery(
    { limit: 50 },
    { enabled: databaseReady, retry: false }
  );
  const integrationsQuery = trpc.integrations.list.useQuery(undefined, {
    retry: false,
  });

  const sections = buildQuery.data?.sections ?? [];
  const integrations = (integrationsQuery.data ?? []) as IntegrationSummary[];
  const outputs = libraryQuery.data ?? [];

  const buildStats = useMemo(() => {
    const approvedCount = sections.filter(
      section => section.status === "approved"
    ).length;
    const next = sections.find(
      section => section.status !== "approved" && section.status !== "locked"
    );
    const totalCount = BUILD_SECTIONS.length;

    return {
      approvedCount,
      totalCount,
      complete: approvedCount === totalCount,
      progress: Math.round((approvedCount / totalCount) * 100),
      nextSection: next?.sectionKey ?? BUILD_SECTIONS[0],
    };
  }, [sections]);

  const setupIntegrations = setupQuery.data?.integrations ?? [];
  const readinessIntegrations =
    setupIntegrations.length > 0 ? setupIntegrations : integrations;
  const readyConnections = readinessIntegrations.filter(
    integration =>
      integration.configured && integration.enabled && integration.verified
  ).length;
  const intelligenceReady = readinessIntegrations.some(
    integration =>
      integration.capability === "intelligence" &&
      integration.configured &&
      integration.enabled &&
      integration.verified
  );
  const initialLoading =
    setupQuery.isLoading ||
    integrationsQuery.isLoading ||
    (databaseReady && (buildQuery.isLoading || libraryQuery.isLoading));
  const hasWorkspaceError =
    databaseReady &&
    (buildQuery.isError || libraryQuery.isError || integrationsQuery.isError);

  const refreshWorkspace = () => {
    const requests: Promise<unknown>[] = [
      setupQuery.refetch(),
      integrationsQuery.refetch(),
    ];
    if (databaseReady) {
      requests.push(buildQuery.refetch(), libraryQuery.refetch());
    }
    void Promise.all(requests);
  };

  if (initialLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" />
          <p className="mt-3 text-sm text-muted-foreground">
            Opening your workspace...
          </p>
        </div>
      </div>
    );
  }

  const actionCards = [
    {
      title: buildStats.complete ? "Review BUILD" : "Continue BUILD",
      description: !databaseReady
        ? "Set up the database before opening BUILD"
        : !intelligenceReady
          ? "Connect intelligence before beginning BUILD"
          : buildStats.complete
            ? "Review and refine your approved foundation"
            : `${buildStats.approvedCount} of ${buildStats.totalCount} foundation areas approved`,
      icon: Layers3,
      path: `/build/${buildStats.nextSection}`,
      accent: "bg-primary/10 text-primary",
      disabled: !databaseReady || !intelligenceReady,
    },
    {
      title: "Generate ideas",
      description: !databaseReady
        ? "Set up the database before generating ideas"
        : !intelligenceReady
          ? "Connect intelligence before generating ideas"
          : "Find topics, angles, and hooks grounded in BUILD",
      icon: Lightbulb,
      path: "/ideas",
      accent: "bg-chart-4/10 text-chart-4",
      disabled: !databaseReady || !intelligenceReady,
    },
    {
      title: "Create content",
      description: !databaseReady
        ? "Set up the database before creating content"
        : !intelligenceReady
          ? "Connect intelligence before creating content"
          : buildStats.complete
            ? "Generate content from your approved strategy"
            : "Available when the BUILD foundation is approved",
      icon: PenTool,
      path: "/create",
      accent: "bg-chart-2/10 text-chart-2",
      disabled: !databaseReady || !intelligenceReady || !buildStats.complete,
    },
    {
      title: "Content library",
      description: databaseReady
        ? "Review, edit, and repurpose saved work"
        : "Set up the database before opening your library",
      icon: Library,
      path: "/library",
      accent: "bg-success/10 text-success",
      disabled: !databaseReady,
    },
    {
      title: "API integrations",
      description: intelligenceReady
        ? `${readyConnections} provider ${readyConnections === 1 ? "connection" : "connections"} ready`
        : "Connect an intelligence provider to begin",
      icon: Wrench,
      path: "/settings/integrations",
      accent: "bg-warning/10 text-warning",
      disabled: false,
    },
  ];

  const primaryAction = !databaseReady
    ? { label: "Finish setup", path: "/setup", icon: Database }
    : !intelligenceReady
      ? {
          label: "Connect intelligence",
          path: "/settings/integrations",
          icon: Settings2,
        }
      : buildStats.complete
        ? { label: "Create content", path: "/create", icon: Sparkles }
        : {
            label: "Continue BUILD",
            path: `/build/${buildStats.nextSection}`,
            icon: Layers3,
          };
  const PrimaryActionIcon = primaryAction.icon;

  return (
    <div className="min-h-screen bg-background">
      <DashboardNav />

      <main className="container max-w-6xl space-y-8 py-8 sm:py-10">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2">
              <Badge
                variant="secondary"
                className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest"
              >
                Workspace
              </Badge>
              {intelligenceReady && (
                <span className="flex items-center gap-1 text-xs font-medium text-success">
                  <Check className="h-3 w-3" /> Intelligence ready
                </span>
              )}
            </div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              Marketing command centre
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
              Build the strategic foundation, connect your preferred providers,
              and create from one consistent source of context.
            </p>
          </div>
          <Button onClick={() => setLocation(primaryAction.path)}>
            <PrimaryActionIcon className="mr-2 h-4 w-4" />
            {primaryAction.label} <ArrowRight className="ml-1 h-4 w-4" />
          </Button>
        </header>

        {setupQuery.isError ? (
          <div className="flex flex-col gap-3 rounded-xl border border-destructive/25 bg-destructive/5 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium">
                MAF could not verify this installation.
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Close and reopen MAF V3, then open setup for guided checks. If
                it still fails, use File &gt; Export diagnostics.
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={refreshWorkspace}
                className="gap-2"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Retry
              </Button>
              <Button size="sm" onClick={() => setLocation("/setup")}>
                Open setup
              </Button>
            </div>
          </div>
        ) : !databaseReady ? (
          <div className="flex flex-col gap-3 rounded-xl border border-primary/25 bg-primary/[0.045] p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex gap-3">
              <Database className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <div>
                <p className="text-sm font-medium">
                  Database setup is needed before the workspace can open.
                </p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                  {setupQuery.data?.database.message ??
                    "Open setup for a readiness check and recovery guidance."}
                </p>
              </div>
            </div>
            <Button
              size="sm"
              onClick={() => setLocation("/setup")}
              className="shrink-0 gap-2"
            >
              Finish setup <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : !intelligenceReady ? (
          <div className="flex flex-col gap-3 rounded-xl border border-warning/25 bg-warning/5 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex gap-3">
              <Brain className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <div>
                <p className="text-sm font-medium">
                  Connect intelligence before beginning BUILD.
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Add your preferred provider and API key. Tavily search and
                  image generation are optional.
                </p>
              </div>
            </div>
            <Button
              size="sm"
              onClick={() => setLocation("/settings/integrations")}
              className="shrink-0 gap-2"
            >
              Add API key <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : null}

        {hasWorkspaceError && (
          <div className="flex flex-col gap-3 rounded-xl border border-warning/25 bg-warning/5 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium">
                The database is connected, but some workspace details could not
                be loaded.
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Try Refresh, or close and reopen MAF V3. If this continues, use
                File &gt; Export diagnostics to create a support report. Your
                saved work has not been deleted.
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={refreshWorkspace}
                className="gap-2"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Refresh
              </Button>
              <Button size="sm" onClick={() => setLocation("/setup")}>
                Open setup
              </Button>
            </div>
          </div>
        )}

        <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="glass-card rounded-xl p-5">
            <div className="mb-3 flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
                <Layers3 className="h-4 w-4 text-primary" />
              </span>
              <span className="text-xs font-medium text-muted-foreground">
                BUILD foundation
              </span>
            </div>
            <p className="text-2xl font-semibold tracking-tight">
              {databaseReady ? `${buildStats.progress}%` : "-"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {!databaseReady
                ? "Database setup required"
                : buildStats.complete
                  ? "All areas approved"
                  : `${buildStats.approvedCount} of ${buildStats.totalCount} areas approved`}
            </p>
          </div>

          <div className="glass-card rounded-xl p-5">
            <div className="mb-3 flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-chart-2/10">
                <FileText className="h-4 w-4 text-chart-2" />
              </span>
              <span className="text-xs font-medium text-muted-foreground">
                Content library
              </span>
            </div>
            <p className="text-2xl font-semibold tracking-tight">
              {databaseReady ? outputs.length : "-"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {!databaseReady
                ? "Database setup required"
                : outputs.length === 1
                  ? "Saved content piece"
                  : "Saved content pieces loaded"}
            </p>
          </div>

          <div className="glass-card rounded-xl p-5">
            <div className="mb-3 flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-success/10">
                <Wrench className="h-4 w-4 text-success" />
              </span>
              <span className="text-xs font-medium text-muted-foreground">
                Provider readiness
              </span>
            </div>
            <p className="text-2xl font-semibold tracking-tight">
              {readyConnections}/3
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {intelligenceReady
                ? "Core intelligence connected"
                : "Intelligence connection needed"}
            </p>
          </div>
        </section>

        <section>
          <div className="mb-4 flex items-end justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold tracking-tight">
                Workspace tools
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Move between the four parts of your content workflow.
              </p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {actionCards.map(action => (
              <button
                key={action.title}
                type="button"
                disabled={action.disabled}
                onClick={() => setLocation(action.path)}
                className={`premium-card group rounded-xl border border-border/40 bg-card/45 p-5 text-left ${action.disabled ? "cursor-not-allowed opacity-50" : ""}`}
              >
                <span
                  className={`mb-5 flex h-10 w-10 items-center justify-center rounded-xl ${action.accent}`}
                >
                  <action.icon className="h-4.5 w-4.5" />
                </span>
                <span className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold">{action.title}</span>
                  {action.disabled ? (
                    <Lock className="h-3.5 w-3.5 text-muted-foreground" />
                  ) : (
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
                  )}
                </span>
                <span className="mt-2 block text-xs leading-relaxed text-muted-foreground">
                  {action.description}
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-5">
          <div className="space-y-4 lg:col-span-3">
            <div className="flex items-end justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold tracking-tight">
                  BUILD progress
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  The approved context used by your content engine.
                </p>
              </div>
              <span className="text-xs font-semibold text-primary">
                {databaseReady ? `${buildStats.progress}%` : "Not available"}
              </span>
            </div>
            <Progress
              value={databaseReady ? buildStats.progress : 0}
              className="h-1.5"
            />

            <div className="space-y-2">
              {BUILD_SECTIONS.map(sectionKey => {
                const record = sections.find(
                  section => section.sectionKey === sectionKey
                );
                const status =
                  record?.status ??
                  (sectionKey === "research" ? "in_progress" : "locked");
                const approved = databaseReady && status === "approved";
                const locked =
                  status === "locked" || !databaseReady || !intelligenceReady;
                const needsReview = status === "amber";
                const Icon = SECTION_ICONS[sectionKey];

                return (
                  <button
                    key={sectionKey}
                    type="button"
                    disabled={locked}
                    onClick={() => setLocation(`/build/${sectionKey}`)}
                    className={`group flex w-full items-center gap-4 rounded-xl border p-4 text-left transition-colors ${
                      locked
                        ? "cursor-not-allowed border-border/25 bg-muted/[0.04] opacity-55"
                        : approved
                          ? "border-success/20 bg-success/[0.04] hover:bg-success/[0.07]"
                          : needsReview
                            ? "border-warning/20 bg-warning/[0.04] hover:bg-warning/[0.07]"
                            : "border-primary/20 bg-primary/[0.04] hover:bg-primary/[0.07]"
                    }`}
                  >
                    <span
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                        locked
                          ? "bg-muted/30"
                          : approved
                            ? "bg-success/10"
                            : needsReview
                              ? "bg-warning/10"
                              : "bg-primary/10"
                      }`}
                    >
                      {locked ? (
                        <Lock className="h-4 w-4 text-muted-foreground" />
                      ) : approved ? (
                        <CheckCircle2 className="h-4 w-4 text-success" />
                      ) : (
                        <Icon
                          className={`h-4 w-4 ${needsReview ? "text-warning" : "text-primary"}`}
                        />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="text-sm font-medium">
                          {SECTION_LABELS[sectionKey]}
                        </span>
                        {approved && (
                          <Badge className="border-0 bg-success/10 px-1.5 py-0 text-[10px] text-success">
                            Approved
                          </Badge>
                        )}
                        {needsReview && (
                          <Badge className="border-0 bg-warning/10 px-1.5 py-0 text-[10px] text-warning">
                            Review
                          </Badge>
                        )}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        {SECTION_DESCRIPTIONS[sectionKey]}
                      </span>
                    </span>
                    {!locked && (
                      <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground/50 group-hover:text-foreground" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-4 lg:col-span-2">
            <div>
              <h2 className="text-base font-semibold tracking-tight">
                Bring-your-own-API status
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Only enabled connections that pass a test are used.
              </p>
            </div>

            <div className="overflow-hidden rounded-xl border border-border/40 bg-card/35">
              {CAPABILITIES.map((item, index) => {
                const integration = readinessIntegrations.find(
                  candidate => candidate.capability === item.capability
                );
                const ready = Boolean(
                  integration?.configured &&
                    integration.enabled &&
                    integration.verified
                );
                const needsTest = Boolean(
                  integration?.configured &&
                    integration.enabled &&
                    !integration.verified
                );
                const disabled = Boolean(
                  integration?.source !== "none" && !integration?.enabled
                );
                const Icon = item.icon;

                return (
                  <button
                    key={item.capability}
                    type="button"
                    onClick={() => setLocation("/settings/integrations")}
                    className={`flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-accent/40 ${index > 0 ? "border-t border-border/30" : ""}`}
                  >
                    <span
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${ready ? "bg-success/10" : "bg-muted/40"}`}
                    >
                      <Icon
                        className={`h-4 w-4 ${ready ? "text-success" : "text-muted-foreground"}`}
                      />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="text-sm font-medium">
                          {item.label}
                        </span>
                        {integration?.source === "environment" && (
                          <span className="text-[9px] font-semibold uppercase tracking-wider text-primary">
                            Environment
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                        {item.description}
                      </span>
                    </span>
                    <Badge
                      variant="secondary"
                      className={`shrink-0 border-0 px-2 py-0.5 text-[10px] ${
                        ready
                          ? "bg-success/10 text-success"
                          : disabled
                            ? "bg-warning/10 text-warning"
                            : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {ready
                        ? "Verified"
                        : disabled
                          ? "Off"
                          : needsTest
                            ? "Test needed"
                            : "Set up"}
                    </Badge>
                  </button>
                );
              })}
            </div>

            {!databaseReady ? (
              <div className="rounded-xl border border-primary/20 bg-primary/[0.04] p-4">
                <div className="flex gap-3">
                  <Database className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <div>
                    <p className="text-sm font-medium">
                      Prepare the database first
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      MAF prepares your local workspace automatically. Open the
                      setup checklist for recovery guidance.
                    </p>
                    <button
                      type="button"
                      onClick={() => setLocation("/setup")}
                      className="mt-3 flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                    >
                      Open setup <ArrowRight className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              </div>
            ) : !intelligenceReady ? (
              <div className="rounded-xl border border-primary/20 bg-primary/[0.04] p-4">
                <div className="flex gap-3">
                  <CircleOff className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <div>
                    <p className="text-sm font-medium">
                      Connect intelligence to get started
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      Add an API key for an OpenAI-compatible provider,
                      Anthropic, or Gemini.
                    </p>
                    <button
                      type="button"
                      onClick={() => setLocation("/settings/integrations")}
                      className="mt-3 flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                    >
                      Configure integrations <ArrowRight className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </section>
      </main>
    </div>
  );
}
