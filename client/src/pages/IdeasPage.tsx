import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useTheme } from "@/contexts/ThemeContext";
import { trpc } from "@/lib/trpc";
import { BUILD_SECTIONS, PLATFORMS } from "@shared/maf-constants";
import {
  ArrowLeft,
  ArrowRight,
  Brain,
  Check,
  CheckCircle2,
  CircleAlert,
  Layers3,
  Lightbulb,
  Loader2,
  Moon,
  PenTool,
  RefreshCw,
  Settings2,
  Sparkles,
  Sun,
  Target,
  Zap,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useLocation } from "wouter";

type Idea = {
  title: string;
  angle: string;
  hook: string;
  whyItFits: string;
  pillar: string;
  platforms: string[];
};

type SetupIssue = {
  message: string;
  needsBuild: boolean;
  needsIntelligence: boolean;
};

const PLATFORM_LABELS: Record<string, string> = {
  facebook: "Facebook",
  linkedin: "LinkedIn",
  instagram: "Instagram",
  twitter: "X / Twitter",
  email: "Email",
  blog: "Blog",
};

function readableLabel(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function IdeasNav() {
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
            {theme === "dark" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
    </nav>
  );
}

export default function IdeasPage() {
  const [, setLocation] = useLocation();
  const buildQuery = trpc.build.getState.useQuery();
  const integrationsQuery = trpc.integrations.list.useQuery();
  const generateMutation = trpc.ideas.generate.useMutation();
  const [count, setCount] = useState(6);
  const [platform, setPlatform] = useState("any");
  const [objective, setObjective] = useState("");
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [issue, setIssue] = useState<SetupIssue | null>(null);

  const buildReady = useMemo(() => {
    const sections = buildQuery.data?.sections ?? [];
    return (
      sections.length >= BUILD_SECTIONS.length &&
      BUILD_SECTIONS.every((sectionKey) =>
        sections.some(
          (section) => section.sectionKey === sectionKey && section.status === "approved",
        ),
      )
    );
  }, [buildQuery.data]);

  const intelligenceReady = useMemo(
    () =>
      integrationsQuery.data?.some(
        (integration) =>
          integration.capability === "intelligence" &&
          integration.configured &&
          integration.enabled &&
          integration.verified,
      ) ?? false,
    [integrationsQuery.data],
  );

  const readinessLoading = buildQuery.isLoading || integrationsQuery.isLoading;

  const classifyError = (error: unknown): SetupIssue => {
    const rawMessage = error instanceof Error ? error.message : "";
    const normalized = rawMessage.toLowerCase();
    const needsBuild = normalized.includes("build") || normalized.includes("foundation") || normalized.includes("artifact");
    const needsIntelligence =
      normalized.includes("integration") ||
      normalized.includes("api key") ||
      (normalized.includes("intelligence") &&
        (normalized.includes("configure") ||
          normalized.includes("enable") ||
          normalized.includes("connect")));
    const message =
      needsBuild || needsIntelligence || normalized.includes("no usable ideas")
        ? rawMessage
        : "Ideas could not be generated. Check the connection and try again.";

    return { message, needsBuild, needsIntelligence };
  };

  const generateIdeas = async () => {
    const buildKnownMissing = Boolean(buildQuery.data && !buildReady);
    const intelligenceKnownMissing = Boolean(integrationsQuery.data && !intelligenceReady);

    if (buildKnownMissing || intelligenceKnownMissing) {
      const message =
        buildKnownMissing && intelligenceKnownMissing
          ? "Approve every BUILD area and connect intelligence before generating ideas."
          : buildKnownMissing
            ? "Approve every BUILD area before generating ideas."
            : "Save and test intelligence before generating ideas.";
      setIssue({
        message,
        needsBuild: buildKnownMissing,
        needsIntelligence: intelligenceKnownMissing,
      });
      return;
    }

    setIssue(null);
    try {
      const result = await generateMutation.mutateAsync({
        count,
        ...(platform !== "any" ? { platform } : {}),
        ...(objective.trim() ? { objective: objective.trim() } : {}),
      });
      setIdeas(result.ideas as Idea[]);
    } catch (error) {
      setIssue(classifyError(error));
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <IdeasNav />

      <main className="container max-w-6xl space-y-7 py-8 sm:py-10">
        <header>
          <button
            type="button"
            onClick={() => setLocation("/dashboard")}
            className="mb-5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to dashboard
          </button>

          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Badge variant="secondary" className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest">
                  BUILD-powered ideas
                </Badge>
                {!readinessLoading && buildReady && intelligenceReady && (
                  <span className="flex items-center gap-1 text-xs font-medium text-success">
                    <Check className="h-3 w-3" /> Ready to generate
                  </span>
                )}
              </div>
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Idea generator</h1>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
                Find strong topics, angles, and hooks based on your approved market, offer, brand, and content strategy.
              </p>
            </div>

            <div className="flex flex-wrap gap-2 text-xs">
              <span className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 ${buildReady ? "border-success/20 bg-success/5 text-success" : "border-border/50 text-muted-foreground"}`}>
                {buildQuery.isLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : buildReady ? <CheckCircle2 className="h-3 w-3" /> : <Layers3 className="h-3 w-3" />}
                BUILD {buildReady ? "ready" : "needed"}
              </span>
              <span className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 ${intelligenceReady ? "border-success/20 bg-success/5 text-success" : "border-border/50 text-muted-foreground"}`}>
                {integrationsQuery.isLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : intelligenceReady ? <CheckCircle2 className="h-3 w-3" /> : <Brain className="h-3 w-3" />}
                Intelligence {intelligenceReady ? "ready" : "needed"}
              </span>
            </div>
          </div>
        </header>

        <Alert className="border-primary/20 bg-primary/[0.04]">
          <Target className="text-primary" />
          <AlertTitle>Ideas start with your approved strategy</AlertTitle>
          <AlertDescription>
            <p>The generator reads your approved BUILD artifacts, then finds topics that fit your audience, offer, voice, pillars, and platform choices.</p>
          </AlertDescription>
        </Alert>

        <section className="rounded-2xl border border-border/40 bg-card/40 p-5 sm:p-6">
          <div className="mb-6 flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
              <Lightbulb className="h-4.5 w-4.5 text-primary" />
            </span>
            <div>
              <h2 className="text-base font-semibold tracking-tight">Shape this batch</h2>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Both fields are optional. Leave them open for a broad mix drawn from your strategy.</p>
            </div>
          </div>

          <div className="grid gap-5 md:grid-cols-[0.7fr_0.7fr_2fr] md:items-start">
            <div className="space-y-2">
              <Label htmlFor="ideas-count">Number of ideas</Label>
              <Select value={String(count)} onValueChange={(value) => setCount(Number(value))}>
                <SelectTrigger id="ideas-count" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[4, 6, 8, 10, 12].map((value) => (
                    <SelectItem key={value} value={String(value)}>{value} ideas</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ideas-platform">Platform</Label>
              <Select value={platform} onValueChange={setPlatform}>
                <SelectTrigger id="ideas-platform" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Best fit</SelectItem>
                  {PLATFORMS.map((value) => (
                    <SelectItem key={value} value={value}>{PLATFORM_LABELS[value] ?? readableLabel(value)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ideas-objective">Objective or theme <span className="font-normal text-muted-foreground">(optional)</span></Label>
              <Textarea
                id="ideas-objective"
                value={objective}
                onChange={(event) => setObjective(event.target.value)}
                maxLength={500}
                placeholder="For example: teach a key belief, support a launch, or start a useful conversation"
                className="min-h-20 resize-y"
              />
            </div>
          </div>

          <div className="mt-5 flex flex-col gap-3 border-t border-border/30 pt-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs leading-relaxed text-muted-foreground">You can generate a fresh batch at any time. This batch is not saved automatically, so turn a choice into content when you want to keep working with it.</p>
            <Button onClick={generateIdeas} disabled={generateMutation.isPending || readinessLoading} className="shrink-0">
              {generateMutation.isPending ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Finding ideas...</>
              ) : ideas.length > 0 ? (
                <><RefreshCw className="mr-2 h-4 w-4" /> Generate a new batch</>
              ) : (
                <><Sparkles className="mr-2 h-4 w-4" /> Generate ideas</>
              )}
            </Button>
          </div>
        </section>

        {issue && (
          <Alert variant="destructive" className="bg-destructive/[0.04]">
            <CircleAlert />
            <AlertTitle>Ideas are not ready yet</AlertTitle>
            <AlertDescription>
              <p>{issue.message}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {issue.needsBuild && (
                  <Button variant="outline" size="sm" onClick={() => setLocation("/build/research")}>
                    Open BUILD <ArrowRight className="ml-2 h-3.5 w-3.5" />
                  </Button>
                )}
                {issue.needsIntelligence && (
                  <Button variant="outline" size="sm" onClick={() => setLocation("/settings/integrations")}>
                    Configure intelligence <ArrowRight className="ml-2 h-3.5 w-3.5" />
                  </Button>
                )}
                {!issue.needsBuild && !issue.needsIntelligence && (
                  <Button variant="outline" size="sm" onClick={generateIdeas}>Try again</Button>
                )}
              </div>
            </AlertDescription>
          </Alert>
        )}

        {ideas.length > 0 ? (
          <section className="space-y-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold tracking-tight">Your idea batch</h2>
                <p className="mt-1 text-xs text-muted-foreground">{ideas.length} strategy-grounded {ideas.length === 1 ? "idea" : "ideas"}</p>
              </div>
              <p className="text-xs text-muted-foreground">Choose an idea to carry its title into Create.</p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {ideas.map((idea, index) => (
                <article key={`${idea.title}-${index}`} className="premium-card flex flex-col rounded-2xl border border-border/40 bg-card/45 p-5 sm:p-6">
                  <div className="mb-4 flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[10px] font-bold text-primary">{String(index + 1).padStart(2, "0")}</span>
                    {idea.pillar && <Badge variant="secondary" className="border-0 text-[10px]">{idea.pillar}</Badge>}
                    {idea.angle && <Badge className="border-0 bg-primary/10 text-[10px] text-primary">{readableLabel(idea.angle)}</Badge>}
                  </div>

                  <h3 className="text-lg font-semibold leading-snug tracking-tight">{idea.title}</h3>
                  <div className="my-4 rounded-xl border border-primary/15 bg-primary/[0.04] p-4">
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-primary">Hook</p>
                    <p className="text-sm font-medium leading-relaxed">{idea.hook}</p>
                  </div>

                  <div className="flex-1">
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Why it fits</p>
                    <p className="text-sm leading-relaxed text-muted-foreground">{idea.whyItFits}</p>
                  </div>

                  <div className="mt-5 flex flex-col gap-3 border-t border-border/30 pt-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex flex-wrap gap-1.5">
                      {idea.platforms.map((ideaPlatform) => (
                        <span key={ideaPlatform} className="rounded-md bg-muted/60 px-2 py-1 text-[10px] text-muted-foreground">
                          {PLATFORM_LABELS[ideaPlatform] ?? readableLabel(ideaPlatform)}
                        </span>
                      ))}
                    </div>
                    <Button
                      size="sm"
                      onClick={() => setLocation(`/create?idea=${encodeURIComponent(idea.title)}`)}
                      className="shrink-0"
                    >
                      <PenTool className="mr-2 h-3.5 w-3.5" /> Create this
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : (
          !generateMutation.isPending && (
            <section className="rounded-2xl border border-dashed border-border/50 px-6 py-14 text-center">
              <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10">
                <Lightbulb className="h-5 w-5 text-primary" />
              </span>
              <h2 className="mt-5 text-base font-semibold">Your next strong topic starts here</h2>
              <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">Choose a platform or objective above, then generate a batch from your approved strategy.</p>
            </section>
          )
        )}
      </main>
    </div>
  );
}
