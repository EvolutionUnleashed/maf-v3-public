import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/contexts/ThemeContext";
import { trpc } from "@/lib/trpc";
import {
  ArrowLeft,
  ArrowRight,
  Brain,
  Check,
  CheckCircle2,
  CircleAlert,
  Database,
  ImageIcon,
  Loader2,
  Moon,
  RefreshCw,
  Search,
  Settings2,
  Sun,
  Zap,
} from "lucide-react";
import { useLocation } from "wouter";

type Capability = "intelligence" | "search" | "image";

function StatusBadge({ ready, pendingLabel }: { ready: boolean; pendingLabel: string }) {
  return ready ? (
    <Badge className="border-0 bg-success/10 text-success">
      <Check className="h-3 w-3" /> Ready
    </Badge>
  ) : (
    <Badge variant="secondary" className="border-0 bg-warning/10 text-warning">
      {pendingLabel}
    </Badge>
  );
}

function SetupNav() {
  const [, setLocation] = useLocation();
  const { theme, toggleTheme } = useTheme();

  return (
    <nav className="sticky top-0 z-50 border-b border-border/40 bg-background/85 backdrop-blur-xl">
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
            onClick={() => setLocation("/")}
            className="hidden h-8 gap-2 px-3 text-xs sm:flex"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Home
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

export default function SetupPage() {
  const [, setLocation] = useLocation();
  const setupQuery = trpc.system.setupStatus.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });

  const status = setupQuery.data;
  const databaseReady = Boolean(status?.database.ready);
  const integrations = status?.integrations ?? [];
  const capabilityReady = (capability: Capability) =>
    integrations.some(
      (integration) =>
        integration.capability === capability && integration.configured && integration.enabled && integration.verified,
    );
  const intelligenceReady = capabilityReady("intelligence");
  const searchReady = capabilityReady("search");
  const imageReady = capabilityReady("image");
  const ready = databaseReady && intelligenceReady;

  return (
    <div className="min-h-screen bg-background">
      <SetupNav />

      <main className="container max-w-5xl py-8 sm:py-12">
        <header className="mx-auto mb-8 max-w-3xl text-center sm:mb-10">
          <Badge variant="secondary" className="mb-4 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em]">
            First-run setup
          </Badge>
          <h1 className="text-3xl font-extrabold tracking-[-0.035em] sm:text-4xl">
            Get your workspace ready
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            Your private local workspace is created automatically. Connect one intelligence provider, then begin BUILD. Search and image services are optional and can be added whenever you need them.
          </p>
        </header>

        {setupQuery.isLoading ? (
          <div className="flex min-h-64 items-center justify-center rounded-2xl border border-border/40 bg-card/35">
            <div className="text-center">
              <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" />
              <p className="mt-3 text-sm text-muted-foreground">Checking this installation...</p>
            </div>
          </div>
        ) : (
          <>
            <section
              className={`mb-5 rounded-2xl border p-5 sm:flex sm:items-center sm:justify-between sm:gap-6 sm:p-6 ${
                ready
                  ? "border-success/25 bg-success/[0.045]"
                  : "border-primary/20 bg-primary/[0.04]"
              }`}
            >
              <div className="flex gap-3.5">
                <span
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                    ready ? "bg-success/10" : "bg-primary/10"
                  }`}
                >
                  {ready ? (
                    <CheckCircle2 className="h-5 w-5 text-success" />
                  ) : (
                    <CircleAlert className="h-5 w-5 text-primary" />
                  )}
                </span>
                <div>
                  <h2 className="text-base font-semibold">
                    {ready ? "MAF V3 is ready" : "Complete the steps below"}
                  </h2>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                    {ready
                      ? "Your local workspace and intelligence provider are available. You can begin building your strategic foundation."
                      : "MAF checks readiness without exposing or sending your saved API keys."}
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void setupQuery.refetch()}
                disabled={setupQuery.isFetching}
                className="mt-4 w-full gap-2 sm:mt-0 sm:w-auto"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${setupQuery.isFetching ? "animate-spin" : ""}`} />
                Check again
              </Button>
            </section>

            {setupQuery.isError && (
              <div className="mb-5 rounded-xl border border-destructive/25 bg-destructive/5 p-4">
                <p className="text-sm font-medium">The setup check could not reach the MAF server.</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Close and reopen MAF V3, then try again. If the problem continues, choose <span className="font-medium text-foreground">File &gt; Export diagnostics</span> and share the saved report with support.
                </p>
              </div>
            )}

            <div className="grid gap-5 lg:grid-cols-[1.08fr_0.92fr]">
              <section className="rounded-2xl border border-border/40 bg-card/40 p-5 sm:p-7">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex gap-3.5">
                    <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${databaseReady ? "bg-success/10" : "bg-primary/10"}`}>
                      <Database className={`h-5 w-5 ${databaseReady ? "text-success" : "text-primary"}`} />
                    </span>
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">Step 1</p>
                      <h2 className="mt-1 text-lg font-semibold">Private local workspace</h2>
                    </div>
                  </div>
                  <StatusBadge ready={databaseReady} pendingLabel="Action needed" />
                </div>

                <p className="mt-5 text-sm leading-relaxed text-muted-foreground">
                  {status?.database.message ?? "Database readiness has not been confirmed."}
                </p>

                <div className="mt-5 rounded-xl border border-border/40 bg-background/50 p-4 text-xs leading-relaxed text-muted-foreground">
                  {databaseReady
                    ? "Ready. MAF V3 stores your work in its own local data folder and opens it automatically each time."
                    : "No database installation is needed. Restart MAF V3 so it can prepare the local workspace. If it still cannot start, export diagnostics from the File menu for support."}
                </div>
              </section>

              <section className="rounded-2xl border border-border/40 bg-card/40 p-5 sm:p-7">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex gap-3.5">
                    <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${intelligenceReady ? "bg-success/10" : "bg-primary/10"}`}>
                      <Brain className={`h-5 w-5 ${intelligenceReady ? "text-success" : "text-primary"}`} />
                    </span>
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">Step 2</p>
                      <h2 className="mt-1 text-lg font-semibold">Connect intelligence</h2>
                    </div>
                  </div>
                  <StatusBadge ready={intelligenceReady} pendingLabel="Required" />
                </div>

                <p className="mt-5 text-sm leading-relaxed text-muted-foreground">
                  Add your own key for OpenAI, Anthropic, Gemini, OpenRouter, or another OpenAI-compatible service. The settings page shows exactly which fields are needed.
                </p>

                {!status?.integrationsReadable && status?.integrationsMessage && (
                  <div className="mt-4 rounded-lg border border-warning/25 bg-warning/5 p-3 text-xs leading-relaxed text-muted-foreground">
                    {status.integrationsMessage}
                  </div>
                )}

                <Button
                  onClick={() => setLocation("/settings/integrations")}
                  className="mt-5 w-full gap-2"
                  variant={intelligenceReady ? "outline" : "default"}
                >
                  <Settings2 className="h-4 w-4" />
                  {intelligenceReady ? "Review API settings" : "Add intelligence key"}
                </Button>

                <div className="mt-5 border-t border-border/40 pt-5">
                  <p className="mb-3 text-xs font-bold uppercase tracking-[0.11em] text-muted-foreground">Optional connections</p>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-3 rounded-lg bg-muted/20 px-3 py-2.5">
                      <span className="flex items-center gap-2 text-sm"><Search className="h-4 w-4 text-primary" /> Tavily web search</span>
                      <span className={`text-xs font-semibold ${searchReady ? "text-success" : "text-muted-foreground"}`}>{searchReady ? "Ready" : "Optional"}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3 rounded-lg bg-muted/20 px-3 py-2.5">
                      <span className="flex items-center gap-2 text-sm"><ImageIcon className="h-4 w-4 text-primary" /> Image generation</span>
                      <span className={`text-xs font-semibold ${imageReady ? "text-success" : "text-muted-foreground"}`}>{imageReady ? "Ready" : "Optional"}</span>
                    </div>
                  </div>
                </div>
              </section>
            </div>

            <section className="mt-5 rounded-2xl border border-border/40 bg-card/30 p-5 sm:flex sm:items-center sm:justify-between sm:gap-6 sm:p-6">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.12em] text-primary">Step 3</p>
                <h2 className="mt-1 text-lg font-semibold">Begin BUILD</h2>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  BUILD captures your market, offer, brand voice, and content strategy for everything you create later.
                </p>
              </div>
              <div className="mt-4 flex flex-col gap-2 sm:mt-0 sm:min-w-44">
                <Button
                  onClick={() => setLocation("/build/research")}
                  disabled={!ready}
                  className="w-full gap-2"
                >
                  Begin BUILD <ArrowRight className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => setLocation("/dashboard")}
                  disabled={!databaseReady}
                  className="w-full text-xs"
                >
                  Open dashboard
                </Button>
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
