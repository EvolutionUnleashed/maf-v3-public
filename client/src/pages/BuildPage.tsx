import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useLocation, useParams } from "wouter";
import { toast } from "sonner";
import { SafeMarkdown } from "@/components/SafeMarkdown";
import {
  ArrowRight, ArrowLeft, Zap, BarChart3, Target, Palette, Layers,
  CheckCircle2, Loader2, AlertTriangle, RefreshCw, Edit3,
  ThumbsUp, ChevronRight, Plus, Trash2, Menu,
  Upload, FileText, Image as ImageIcon, Trophy, Sparkles, Rocket,
  Settings2, Search
} from "lucide-react";
import { useState, useEffect, useRef } from "react";
import {
  BUILD_SECTIONS, BUILD_STEPS, SECTION_LABELS,
  GENERATION_MESSAGES, type BuildSectionKey
} from "@shared/maf-constants";

type IntegrationSummary = {
  capability: "intelligence" | "search" | "image";
  configured: boolean;
  enabled: boolean;
  verified: boolean;
};

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

const SECTION_ICONS: Record<string, any> = {
  research: BarChart3, offer: Target, brand: Palette, strategy: Layers,
};

export default function BuildPage() {
  const [, setLocation] = useLocation();
  const params = useParams<{ section?: string; step?: string }>();
  const activeSection = (params.section || "research") as BuildSectionKey;
  const activeStepKey = params.step || null;
  const validSection = BUILD_SECTIONS.includes(activeSection);
  const validStep = !activeStepKey || (
    validSection && BUILD_STEPS[activeSection].some(step => step.key === activeStepKey)
  );
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const { data: buildState, isLoading: buildLoading, refetch: refetchBuild } = trpc.build.getState.useQuery();
  const integrationsQuery = trpc.integrations.list.useQuery();
  const integrations = (integrationsQuery.data ?? []) as IntegrationSummary[];
  const isCapabilityReady = (capability: IntegrationSummary["capability"]) =>
    integrations.some(
      integration =>
        integration.capability === capability &&
        integration.configured &&
        integration.enabled &&
        integration.verified,
    );
  const intelligenceReady = isCapabilityReady("intelligence");
  const searchReady = isCapabilityReady("search");
  const imageReady = isCapabilityReady("image");

  useEffect(() => {
    if (!validSection || !validStep) setLocation("/build/research", { replace: true });
  }, [validSection, validStep, setLocation]);

  if (!validSection || !validStep || buildLoading || integrationsQuery.isLoading) {
    return <div className="min-h-screen bg-background flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  const sidebarContent = (
    <div className="space-y-1">
      {BUILD_SECTIONS.map((sectionKey) => {
        const section = buildState?.sections?.find(s => s.sectionKey === sectionKey);
        const status = section?.status || "locked";
        const Icon = SECTION_ICONS[sectionKey] || Layers;
        const isActive = activeSection === sectionKey;
        const steps = BUILD_STEPS[sectionKey];
        const sectionSteps = buildState?.subSteps?.filter(s => s.sectionKey === sectionKey) || [];

        return (
          <div key={sectionKey}>
            <button
              onClick={() => {
                if (status !== "locked") {
                  setLocation(`/build/${sectionKey}`);
                  setMobileNavOpen(false);
                }
              }}
              disabled={status === "locked"}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left text-sm transition-all ${
                isActive ? "bg-primary/10 text-primary" : status === "locked" ? "text-muted-foreground/50 cursor-not-allowed" : "text-foreground hover:bg-accent/50"
              }`}
            >
              <StatusDot status={status} />
              <Icon className="h-4 w-4 shrink-0" />
              <span className="font-display font-medium">{SECTION_LABELS[sectionKey]}</span>
            </button>

            {isActive && status !== "locked" && (
              <div className="ml-8 mt-1 space-y-0.5">
                {steps.map((step) => {
                  const subStep = sectionSteps.find(s => s.stepKey === step.key);
                  const stepStatus = subStep?.status || "locked";
                  const isStepActive = activeStepKey === step.key;

                  return (
                    <button
                      key={step.key}
                      onClick={() => {
                        if (stepStatus !== "locked") {
                          setLocation(`/build/${sectionKey}/${step.key}`);
                          setMobileNavOpen(false);
                        }
                      }}
                      disabled={stepStatus === "locked"}
                      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-xs transition-all ${
                        isStepActive ? "bg-primary/10 text-primary font-medium" : stepStatus === "locked" ? "text-muted-foreground/40 cursor-not-allowed" : "text-muted-foreground hover:text-foreground hover:bg-accent/30"
                      }`}
                    >
                      <StatusDot status={stepStatus} size="sm" />
                      <span className="truncate">{step.label}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="min-h-screen bg-background flex">
      {/* ─── Desktop Sidebar ─────────────────────────────────────── */}
      <aside className="w-64 lg:w-72 border-r border-border/50 bg-card/50 hidden md:flex flex-col shrink-0 sticky top-0 h-screen">
        <div className="p-4 border-b border-border/50">
          <div className="flex items-center gap-2 cursor-pointer" onClick={() => setLocation("/dashboard")}>
            <div className="h-7 w-7 rounded-lg bg-primary flex items-center justify-center">
              <Zap className="h-3.5 w-3.5 text-primary-foreground" />
            </div>
            <span className="font-display text-sm font-bold">MAF V3</span>
          </div>
        </div>

        <ScrollArea className="flex-1 p-3">
          {sidebarContent}
        </ScrollArea>

        {/* BUILD Complete → CREATE CTA in sidebar */}
        {buildState?.sections?.every((s: any) => s.status === "approved") && (
          <div className="p-3 border-t border-border/50">
            <Button
              onClick={() => setLocation("/create")}
              className="w-full font-display font-bold bg-chart-2 hover:bg-chart-2/90 text-white"
              size="sm"
            >
              <Rocket className="mr-2 h-4 w-4" /> Go Create Content
            </Button>
          </div>
        )}

        <div className="p-3 border-t border-border/50">
          <Button variant="ghost" size="sm" onClick={() => setLocation("/settings/integrations")} className="w-full justify-start text-xs text-muted-foreground">
            <Settings2 className="mr-2 h-3.5 w-3.5" /> API integrations
          </Button>
        </div>
      </aside>

      {/* ─── Mobile Nav Dialog ───────────────────────────────────── */}
      <Dialog open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <DialogContent className="sm:max-w-xs p-0">
          <DialogHeader className="p-4 border-b border-border/50">
            <DialogTitle className="font-display text-sm">BUILD Navigation</DialogTitle>
          </DialogHeader>
          <div className="p-3 max-h-[60vh] overflow-y-auto">
            {sidebarContent}
          </div>
        </DialogContent>
      </Dialog>

      {/* ─── Main Content ─────────────────────────────────────────── */}
      <main className="flex-1 min-w-0">
        {/* Mobile header */}
        <div className="md:hidden border-b border-border/50 p-3 flex items-center justify-between sticky top-0 bg-background/95 backdrop-blur z-40">
          <div className="flex items-center gap-2">
            <Button aria-label="Back to dashboard" variant="ghost" size="sm" onClick={() => setLocation("/dashboard")} className="h-8 px-2">
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <Button aria-label="Open BUILD navigation" variant="ghost" size="sm" onClick={() => setMobileNavOpen(true)} className="h-8 px-2">
              <Menu className="h-4 w-4" />
            </Button>
            <span className="font-display text-sm font-semibold">{SECTION_LABELS[activeSection]}</span>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setLocation("/settings/integrations")} className="h-8 px-2 text-xs">
            <Settings2 className="mr-1.5 h-3.5 w-3.5" /> APIs
          </Button>
        </div>

        <div className="p-4 md:p-8 max-w-4xl">
          {activeStepKey ? (
            <StepView
              sectionKey={activeSection}
              stepKey={activeStepKey}
              buildState={buildState}
              onRefresh={refetchBuild}
              intelligenceReady={intelligenceReady}
              searchReady={searchReady}
              imageReady={imageReady}
            />
          ) : (
            <SectionOverview
              sectionKey={activeSection}
              buildState={buildState}
              onNavigateStep={(stepKey) => setLocation(`/build/${activeSection}/${stepKey}`)}
            />
          )}
        </div>
      </main>
    </div>
  );
}

// ─── Status Dot ──────────────────────────────────────────────────────
function StatusDot({ status, size = "md" }: { status: string; size?: "sm" | "md" }) {
  const s = size === "sm" ? "h-2 w-2" : "h-2.5 w-2.5";
  const colors: Record<string, string> = {
    locked: "bg-muted-foreground/30",
    in_progress: "bg-primary animate-pulse",
    intake_complete: "bg-primary",
    generating: "bg-chart-2 animate-pulse",
    review: "bg-chart-4",
    approved: "bg-success",
    amber: "bg-warning",
  };
  return <div className={`${s} rounded-full shrink-0 ${colors[status] || colors.locked}`} />;
}

// ─── Section Overview ────────────────────────────────────────────────
function SectionOverview({ sectionKey, buildState, onNavigateStep }: {
  sectionKey: BuildSectionKey; buildState: any; onNavigateStep: (key: string) => void;
})
{
  const [, setLocation] = useLocation();
  const steps = BUILD_STEPS[sectionKey];
  const sectionSteps = buildState?.subSteps?.filter((s: any) => s.sectionKey === sectionKey) || [];
  const section = buildState?.sections?.find((s: any) => s.sectionKey === sectionKey);
  const Icon = SECTION_ICONS[sectionKey] || Layers;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
          <Icon className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="font-display text-xl sm:text-2xl font-bold">{SECTION_LABELS[sectionKey]}</h1>
          <p className="text-sm text-muted-foreground capitalize">{section?.status?.replace("_", " ") || "Locked"}</p>
        </div>
      </div>

      <div className="space-y-3">
        {steps.map((step) => {
          const subStep = sectionSteps.find((s: any) => s.stepKey === step.key);
          const status = subStep?.status || "locked";
          const isLocked = status === "locked";

          return (
            <Card
              key={step.key}
              role="button"
              tabIndex={isLocked ? -1 : 0}
              aria-disabled={isLocked}
              className={`cursor-pointer transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${isLocked ? "opacity-50 cursor-not-allowed" : "hover:border-primary/30"} ${status === "amber" ? "border-warning/30" : ""}`}
              onClick={() => !isLocked && onNavigateStep(step.key)}
              onKeyDown={(event) => {
                if (!isLocked && (event.key === "Enter" || event.key === " ")) {
                  event.preventDefault();
                  onNavigateStep(step.key);
                }
              }}
            >
              <CardContent className="py-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <StatusDot status={status} />
                  <div>
                    <p className="font-display font-semibold text-sm">{step.label}</p>
                    <div className="flex items-center gap-2">
                      <p className="text-xs text-muted-foreground capitalize">{status.replace("_", " ")}</p>
                      {status === "amber" && (
                        <Badge variant="outline" className="text-warning border-warning/30 text-[10px] px-1.5 py-0">
                          <AlertTriangle className="h-2.5 w-2.5 mr-0.5" /> Upstream changed
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
                {!isLocked && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Section complete: show the next section or CREATE CTA. */}
      {section?.status === "approved" && (() => {
        const allSectionsApproved = buildState?.sections?.every((s: any) => s.status === "approved");
        if (allSectionsApproved) {
          return (
            <Card className="bg-gradient-to-br from-chart-2/10 via-primary/5 to-chart-4/10 border-chart-2/30">
              <CardContent className="py-6 text-center space-y-4">
                <div className="mx-auto h-14 w-14 rounded-2xl bg-chart-2/10 flex items-center justify-center">
                  <Trophy className="h-7 w-7 text-chart-2" />
                </div>
                <div>
                  <h3 className="font-display text-lg font-bold">BUILD Complete!</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    Your marketing foundation is locked in. Time to create content that actually sounds like you.
                  </p>
                </div>
                <Button
                  onClick={() => setLocation("/create")}
                  className="font-display font-bold bg-chart-2 hover:bg-chart-2/90 text-white px-8"
                  size="lg"
                >
                  <Rocket className="mr-2 h-5 w-5" /> Start Creating
                </Button>
              </CardContent>
            </Card>
          );
        }
        return null;
      })()}
    </div>
  );
}

// ─── Step View (Intake + Generation + Approval) ──────────────────────
function StepView({ sectionKey, stepKey, buildState, onRefresh, intelligenceReady, searchReady, imageReady }: {
  sectionKey: BuildSectionKey;
  stepKey: string;
  buildState: any;
  onRefresh: () => void;
  intelligenceReady: boolean;
  searchReady: boolean;
  imageReady: boolean;
}) {
  const [, setLocation] = useLocation();
  const stepConfig = BUILD_STEPS[sectionKey]?.find(s => s.key === stepKey);
  const subStep = buildState?.subSteps?.find((s: any) => s.stepKey === stepKey);
  const { data: stepData, refetch: refetchStep } = trpc.build.getStep.useQuery({ stepKey });
  const status = stepData?.status || subStep?.status || "locked";
  const generateMut = trpc.build.generate.useMutation();
  const approveMut = trpc.build.approve.useMutation();
  const saveIntakeMut = trpc.build.saveIntake.useMutation();
  const editDirectMut = trpc.build.editDirect.useMutation();
  const reopenMut = trpc.build.reopen.useMutation();
  const autosaveMut = trpc.autosave.saveDraft.useMutation();

  const [intakeForm, setIntakeForm] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState("");
  const [editMode, setEditMode] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [generatingMsg, setGeneratingMsg] = useState("");

  // Multi-offer state for step 2a
  const [offers, setOffers] = useState<{ name: string; price: string; description: string }[]>([
    { name: "", price: "", description: "" },
  ]);
  const [hydratedStep, setHydratedStep] = useState<string | null>(null);
  useEffect(() => {
    if (!stepData || hydratedStep === stepKey) return;
    const saved = (stepData.intakeData ?? {}) as Record<string, unknown>;
    setIntakeForm(Object.fromEntries(Object.entries(saved).filter((entry): entry is [string, string] => typeof entry[1] === "string")));
    setOffers(Array.isArray(saved.offers) && saved.offers.length > 0
      ? saved.offers.map(offer => ({ name: String(offer.name ?? ""), price: String(offer.price ?? ""), description: String(offer.description ?? "") }))
      : [{ name: "", price: "", description: "" }]);
    setEditMode(false);
    setFeedback("");
    setHydratedStep(stepKey);
  }, [stepData, stepKey, hydratedStep]);
  useEffect(() => {
    if (stepKey !== "2a" || hydratedStep !== stepKey || status === "approved" || status === "locked") return;
    const timeout = setTimeout(() => autosaveMut.mutate({
      stepKey,
      intakeData: { offers, uniqueStrengths: intakeForm.uniqueStrengths || "" },
    }), 3000);
    return () => clearTimeout(timeout);
  }, [offers, intakeForm, stepKey, hydratedStep, status]);

  // Progressive status messages
  useEffect(() => {
    if (status !== "generating" && !generateMut.isPending) {
      setGeneratingMsg("");
      return;
    }
    const messages = GENERATION_MESSAGES[stepKey] || ["Processing..."];
    let idx = 0;
    setGeneratingMsg(messages[0]);
    const interval = setInterval(() => {
      idx = Math.min(idx + 1, messages.length - 1);
      setGeneratingMsg(messages[idx]);
    }, 3000);
    return () => clearInterval(interval);
  }, [status, generateMut.isPending, stepKey]);

  const handleSaveIntake = async () => {
    try {
      let intakeData: any;
      if (stepKey === "2a") {
        // Multi-offer structured data
        intakeData = {
          offers: offers.filter(o => o.name.trim()),
          uniqueStrengths: intakeForm.uniqueStrengths || "",
        };
      } else {
        intakeData = intakeForm;
      }
      await saveIntakeMut.mutateAsync({ stepKey, intakeData });
      refetchStep();
      onRefresh();
      toast.success(stepKey === "2a" ? "Offers saved. Review and approve them to continue." : "Intake saved. Ready to generate.");
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleGenerate = async (withFeedback?: string) => {
    if (!intelligenceReady) {
      toast.error("Save and test an enabled intelligence provider in Settings first.");
      return;
    }
    try {
      if (stepConfig?.hasIntake && hydratedStep === stepKey) {
        // Include the latest keystrokes even when the draft debounce has not run.
        await autosaveMut.mutateAsync({ stepKey, intakeData: intakeForm });
      }
      const result = await generateMut.mutateAsync({ stepKey, feedback: withFeedback });
      refetchStep();
      onRefresh();
      if (result.researchWarning) {
        toast.warning(result.researchWarning);
      } else {
        toast.success("Generation complete. Review your output.");
      }
    } catch (e: any) {
      toast.error(e.message);
      refetchStep();
      onRefresh();
    }
  };

  const handleApprove = async () => {
    try {
      await approveMut.mutateAsync({ stepKey });
      refetchStep();
      onRefresh();
      setEditMode(false);
      toast.success("Approved and saved.");
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleEditDirect = async () => {
    try {
      if (!editContent.trim()) { toast.error("Enter content before saving."); return; }
      await editDirectMut.mutateAsync({ stepKey, content: { ...(stepData?.artifactContent as object), content: editContent } });
      refetchStep();
      onRefresh();
      setEditMode(false);
      toast.success("Content saved directly.");
    } catch (e: any) {
      toast.error(e.message || "Content could not be saved");
    }
  };

  if (!stepConfig) return <p className="text-muted-foreground">Step not found.</p>;

  const artifact = stepData?.artifactContent as any;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => setLocation(`/build/${sectionKey}`)}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="font-display text-lg sm:text-xl font-bold truncate">{stepConfig.label}</h1>
          <div className="flex items-center gap-2 mt-0.5">
            <StatusDot status={status} />
            <span className="text-xs text-muted-foreground capitalize">{status.replace("_", " ")}</span>
            {status === "amber" && (
              <Badge variant="outline" className="text-warning border-warning/30 text-xs">
                <AlertTriangle className="h-3 w-3 mr-1" /> Upstream changed
              </Badge>
            )}
          </div>
        </div>
      </div>

      {stepKey === "1a" && (
        <Card className={searchReady ? "border-success/30 bg-success/5" : "border-border/50 bg-muted/20"}>
          <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <Search className={`mt-0.5 h-4 w-4 shrink-0 ${searchReady ? "text-success" : "text-muted-foreground"}`} />
              <div>
                <p className="text-sm font-medium">
                  {searchReady ? "Tavily web research is available" : "Tavily web research is not connected"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {searchReady
                    ? "This step can add current web sources to the market context you provide."
                    : "This step will use only your input, uploaded files, and existing BUILD context. It will not perform live web research."}
                </p>
              </div>
            </div>
            {!searchReady && (
              <Button variant="outline" size="sm" onClick={() => setLocation("/settings/integrations")} className="shrink-0">
                <Settings2 className="mr-2 h-3.5 w-3.5" /> Connect Tavily
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Intake Form */}
      {stepConfig.hasIntake && hydratedStep === stepKey && (status === "in_progress" || status === "intake_complete" || status === "amber" || (stepKey === "2a" && status === "review")) && (
        stepKey === "2a" ? (
          <MultiOfferIntake
            offers={offers}
            setOffers={setOffers}
            strengths={intakeForm.uniqueStrengths || ""}
            setStrengths={(v) => setIntakeForm({ ...intakeForm, uniqueStrengths: v })}
            onSave={handleSaveIntake}
            saving={saveIntakeMut.isPending}
          />
        ) : (
          <IntakeForm stepKey={stepKey} form={intakeForm} setForm={setIntakeForm} onSave={handleSaveIntake} saving={saveIntakeMut.isPending} />
        )
      )}

      {/* Generate Button */}
      {stepKey !== "3c" && stepConfig.hasAI && (status === "intake_complete" || (status === "in_progress" && !stepConfig.hasIntake) || status === "amber") && (
        <Card className="bg-card border-border/50">
          <CardContent className="pt-6 text-center space-y-3">
            <p className="text-sm text-muted-foreground">
              {!intelligenceReady
                ? "Save and test an intelligence provider before generating this BUILD artifact."
                : status === "amber"
                  ? "Upstream data has changed. Regenerate to update this step."
                  : "Ready to generate. This will use your BUILD context."}
            </p>
            <Button onClick={() => handleGenerate()} disabled={generateMut.isPending || !intelligenceReady} className="font-display font-semibold">
              {generateMut.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Generating...</> : <>Generate <Zap className="ml-2 h-4 w-4" /></>}
            </Button>
            {!intelligenceReady && (
              <Button variant="link" size="sm" onClick={() => setLocation("/settings/integrations")} className="h-auto px-2 text-xs">
                Open integration settings
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Generating State */}
      {(status === "generating" || generateMut.isPending) && (
        <Card className="bg-card border-primary/30">
          <CardContent className="pt-6 text-center space-y-3">
            <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
            <p className="text-sm text-primary font-medium animate-pulse">{generatingMsg}</p>
          </CardContent>
        </Card>
      )}

      {/* ─── Visual Identity Tournament (Step 3C) ─── */}
      {stepKey === "3c" && (status === "in_progress" || status === "intake_complete" || status === "review" || status === "amber" || status === "approved") && (
        <VisualIdentityTournament
          intelligenceReady={intelligenceReady}
          imageReady={imageReady}
          onApprove={() => { refetchStep(); onRefresh(); }}
        />
      )}

      {/* Review State - Show artifact with three-button pattern */}
      {stepKey !== "3c" && (status === "review" || status === "approved" || status === "amber") && artifact && (
        <div className="space-y-4">
          <Card className="bg-card border-border/50">
            <CardHeader>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <CardTitle className="font-display text-lg">{artifact.title || "Generated Output"}</CardTitle>
                {status === "approved" && <Badge className="bg-success text-success-foreground">Approved</Badge>}
              </div>
              {artifact.summary && <p className="text-sm text-muted-foreground mt-1">{artifact.summary}</p>}
            </CardHeader>
            <CardContent>
              {editMode ? (
                <div className="space-y-3">
                  <Textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    className="min-h-[300px] font-mono text-xs"
                    placeholder="Edit your content. Use Markdown headings and lists if you like."
                  />
                  <div className="flex gap-2">
                    <Button onClick={handleEditDirect} disabled={editDirectMut.isPending} size="sm" className="font-display">
                      {editDirectMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save Edit"}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setEditMode(false)}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <div className="prose prose-invert prose-sm max-w-none">
                  <SafeMarkdown>{artifact.content || JSON.stringify(artifact, null, 2)}</SafeMarkdown>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Three-Button Approval Pattern */}
          {(status === "review" || status === "amber") && !editMode && (
            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row gap-2">
                <Button onClick={handleApprove} disabled={approveMut.isPending} className="font-display font-semibold flex-1 sm:flex-none">
                  <ThumbsUp className="mr-2 h-4 w-4" /> Approve
                </Button>
                <Button
                  variant="outline"
                  onClick={() => { setEditMode(true); setEditContent(artifact.content || ""); }}
                  className="font-display flex-1 sm:flex-none"
                >
                  <Edit3 className="mr-2 h-4 w-4" /> Edit
                </Button>
              </div>

              {stepConfig.hasAI && <div className="flex flex-col sm:flex-row gap-2">
                <Input
                  placeholder="Feedback for regeneration..."
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  className="text-sm flex-1"
                />
                <Button
                  variant="outline"
                  onClick={() => { handleGenerate(feedback); setFeedback(""); }}
                  disabled={generateMut.isPending || !intelligenceReady}
                  className="font-display text-sm shrink-0"
                >
                  <RefreshCw className="mr-2 h-3.5 w-3.5" />
                  Regenerate
                </Button>
              </div>}
            </div>
          )}

          {/* Re-open button for approved steps */}
          {status === "approved" && !editMode && (
            <div className="flex flex-col sm:flex-row gap-2 items-start">
              <Button
                variant="outline"
                onClick={async () => {
                  try {
                    await reopenMut.mutateAsync({ stepKey });
                    refetchStep();
                    onRefresh();
                    toast.success("Step re-opened for editing.");
                  } catch (e: any) {
                    toast.error(e.message || "Failed to re-open step");
                  }
                }}
                disabled={reopenMut.isPending}
                className="font-display text-sm"
              >
                <Edit3 className="mr-2 h-4 w-4" /> Re-open & Edit
              </Button>
              <p className="text-xs text-muted-foreground mt-1 sm:mt-2">Re-opening will let you edit or regenerate. Downstream steps will be flagged for review.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Multi-Offer Intake (Step 2A) ───────────────────────────────────
function MultiOfferIntake({ offers, setOffers, strengths, setStrengths, onSave, saving }: {
  offers: { name: string; price: string; description: string }[];
  setOffers: (o: typeof offers) => void;
  strengths: string;
  setStrengths: (v: string) => void;
  onSave: () => void;
  saving: boolean;
}) {
  const uploadMut = trpc.files.upload.useMutation();
  const [uploadResult, setUploadResult] = useState<{ fileName: string; tokenCount: number } | null>(null);

  const addOffer = () => {
    setOffers([...offers, { name: "", price: "", description: "" }]);
  };

  const removeOffer = (idx: number) => {
    if (offers.length <= 1) return;
    setOffers(offers.filter((_, i) => i !== idx));
  };

  const updateOffer = (idx: number, field: string, value: string) => {
    const updated = [...offers];
    (updated[idx] as any)[field] = value;
    setOffers(updated);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const allowedExts = ["md", "pdf", "docx", "csv", "txt"];
    const ext = file.name.split(".").pop()?.toLowerCase() || "";
    if (!allowedExts.includes(ext)) {
      toast.error(`Unsupported file type. Allowed: ${allowedExts.join(", ")}`);
      return;
    }
    if (file.size === 0 || file.size > MAX_UPLOAD_BYTES) {
      toast.error("Choose a document between 1 byte and 15 MB.");
      e.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => toast.error("MAF could not read that document.");
    reader.onload = () => {
      void (async () => {
        try {
        const base64 = (reader.result as string).split(",")[1];
        const result = await uploadMut.mutateAsync({
          stepKey: "2a",
          fileName: file.name,
          fileType: ext,
          fileContent: base64,
        });
        setUploadResult({ fileName: result.fileName, tokenCount: result.tokenCount });
        toast.success(`File uploaded: ${result.fileName} (~${result.tokenCount.toLocaleString()} tokens)`);
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Upload failed");
        }
      })();
    };
    reader.readAsDataURL(file);
  };

  return (
    <Card className="bg-card border-border/50">
      <CardHeader>
        <CardTitle className="font-display text-lg">Capture Your Offers</CardTitle>
        <p className="text-sm text-muted-foreground">Add each product or service. Target audience context is already captured from Step 1B.</p>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* File upload for complex offer ecosystems. */}
        <div className="p-4 rounded-lg border border-dashed border-primary/30 bg-primary/5">
          <div className="flex items-center gap-2 mb-2">
            <Upload className="h-4 w-4 text-primary" />
            <Label className="text-sm font-medium">Upload Offer Document</Label>
          </div>
          <p className="text-xs text-muted-foreground mb-3">Have a document with your offers already written out? Upload it here instead of filling the forms below.</p>
          <input
            type="file"
            accept=".md,.pdf,.docx,.csv,.txt"
            onChange={handleFileUpload}
            className="text-xs file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-medium file:bg-primary/10 file:text-primary hover:file:bg-primary/20 cursor-pointer"
          />
          {uploadMut.isPending && (
            <div className="flex items-center gap-2 mt-2 text-xs text-primary">
              <Loader2 className="h-3 w-3 animate-spin" /> Uploading...
            </div>
          )}
          {uploadResult && (
            <div className="flex items-center gap-2 mt-2 text-xs text-success">
              <FileText className="h-3 w-3" />
              {uploadResult.fileName}: ~{uploadResult.tokenCount.toLocaleString()} tokens ingested
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          <Separator className="flex-1" />
          <span className="text-xs text-muted-foreground">or fill in manually</span>
          <Separator className="flex-1" />
        </div>

        {offers.map((offer, idx) => (
          <div key={idx} className="p-4 rounded-lg border border-border/50 bg-background/50 space-y-3">
            <div className="flex items-center justify-between">
              <p className="font-display font-semibold text-sm">Offer {idx + 1}</p>
              {offers.length > 1 && (
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" onClick={() => removeOffer(idx)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Offer Name</Label>
                <Input value={offer.name} onChange={e => updateOffer(idx, "name", e.target.value)} placeholder="e.g., Strategy Intensive" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Price</Label>
                <Input value={offer.price} onChange={e => updateOffer(idx, "price", e.target.value)} placeholder="e.g., $2,500 or $197/mo" />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Description</Label>
              <Textarea value={offer.description} onChange={e => updateOffer(idx, "description", e.target.value)} placeholder="What does this offer include? What transformation does it deliver?" className="min-h-[60px]" />
            </div>
          </div>
        ))}

        <Button variant="outline" onClick={addOffer} className="w-full font-display text-sm">
          <Plus className="mr-2 h-4 w-4" /> Add Another Offer
        </Button>

        <Separator />

        <div className="space-y-1.5">
          <Label className="text-sm font-medium">Unique Strengths</Label>
          <p className="text-xs text-muted-foreground">What makes your offers stand out in the market?</p>
          <Textarea value={strengths} onChange={e => setStrengths(e.target.value)} placeholder="What unique strengths set your offers apart?" className="min-h-[80px]" />
        </div>

        <Button onClick={onSave} disabled={saving} className="font-display font-semibold">
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Save & Continue <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </CardContent>
    </Card>
  );
}

// ─── Generic Intake Form ────────────────────────────────────────────
function IntakeForm({ stepKey, form, setForm, onSave, saving }: {
  stepKey: string; form: Record<string, string>; setForm: (f: Record<string, string>) => void;
  onSave: () => void; saving: boolean;
}) {
  const fields = INTAKE_FIELDS[stepKey] || [];
  const uploadMut = trpc.files.upload.useMutation();
  const [uploadResult, setUploadResult] = useState<{ fileName: string; tokenCount: number } | null>(null);
  const [autoSaved, setAutoSaved] = useState(false);
  const autosaveMut = trpc.autosave.saveDraft.useMutation();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-save draft every 3 seconds after user stops typing
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      autosaveMut.mutate({ stepKey, intakeData: form }, {
        onSuccess: () => { setAutoSaved(true); setTimeout(() => setAutoSaved(false), 2000); },
        onError: () => toast.error("Draft could not be saved. Keep this page open and use Save & Continue to retry."),
      });
    }, 3000);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [form, stepKey]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const allowedExts = ["md", "pdf", "docx", "csv", "txt"];
    const ext = file.name.split(".").pop()?.toLowerCase() || "";
    if (!allowedExts.includes(ext)) {
      toast.error(`Unsupported file type. Allowed: ${allowedExts.join(", ")}`);
      return;
    }
    if (file.size === 0 || file.size > MAX_UPLOAD_BYTES) {
      toast.error("Choose a document between 1 byte and 15 MB.");
      e.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => toast.error("MAF could not read that document.");
    reader.onload = () => {
      void (async () => {
        try {
        const base64 = (reader.result as string).split(",")[1];
        const result = await uploadMut.mutateAsync({
          stepKey,
          fileName: file.name,
          fileType: ext,
          fileContent: base64,
        });
        setUploadResult({ fileName: result.fileName, tokenCount: result.tokenCount });
        toast.success(`File uploaded: ${result.fileName} (~${result.tokenCount.toLocaleString()} tokens)`);
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Upload failed");
        }
      })();
    };
    reader.readAsDataURL(file);
  };

  return (
    <Card className="bg-card border-border/50">
      <CardHeader>
        <CardTitle className="font-display text-lg">Your Input</CardTitle>
        <p className="text-sm text-muted-foreground">Provide the information below to feed the AI agent.</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {fields.map((field) => (
          <div key={field.key} className="space-y-1.5">
            <Label className="text-sm font-medium">{field.label}</Label>
            {field.hint && <p className="text-xs text-muted-foreground">{field.hint}</p>}
            <Textarea
              value={form[field.key] || ""}
              onChange={(e) => setForm({ ...form, [field.key]: e.target.value })}
              placeholder={field.placeholder}
              className="min-h-[80px]"
            />
          </div>
        ))}

        {/* File Upload */}
        <div className="p-3 rounded-lg border border-dashed border-border/50 bg-background/50">
          <div className="flex items-center gap-2 mb-2">
            <Upload className="h-4 w-4 text-muted-foreground" />
            <Label className="text-sm font-medium">Upload Supporting Document</Label>
          </div>
          <p className="text-xs text-muted-foreground mb-2">Accepted: .md, .pdf, .docx, .csv, .txt</p>
          <input
            type="file"
            accept=".md,.pdf,.docx,.csv,.txt"
            onChange={handleFileUpload}
            className="text-xs file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-medium file:bg-primary/10 file:text-primary hover:file:bg-primary/20 cursor-pointer"
          />
          {uploadMut.isPending && (
            <div className="flex items-center gap-2 mt-2 text-xs text-primary">
              <Loader2 className="h-3 w-3 animate-spin" /> Uploading...
            </div>
          )}
          {uploadResult && (
            <div className="flex items-center gap-2 mt-2 text-xs text-success">
              <FileText className="h-3 w-3" />
              {uploadResult.fileName}: ~{uploadResult.tokenCount.toLocaleString()} tokens ingested
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          <Button onClick={onSave} disabled={saving} className="font-display font-semibold min-h-[44px]">
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save & Continue <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
          {autoSaved && <span className="text-xs text-emerald-400 animate-pulse">Draft saved</span>}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Intake Field Definitions ────────────────────────────────────────
const INTAKE_FIELDS: Record<string, { key: string; label: string; placeholder: string; hint?: string }[]> = {
  "1a": [
    { key: "industry", label: "Industry / Niche", placeholder: "e.g., SaaS for small business accounting", hint: "What industry or market segment do you operate in?" },
    { key: "marketContext", label: "Market Context", placeholder: "Describe the current state of your market, competitors, trends...", hint: "Share what you already know. Current web sources are added only after Tavily passes its connection test." },
  ],
  "1b": [
    { key: "currentCustomers", label: "Current Customer Profile", placeholder: "Describe your ideal or current customers...", hint: "Who buys from you today? Demographics, roles, company size." },
    { key: "painPoints", label: "Customer Pain Points", placeholder: "What problems do they face?", hint: "What keeps them up at night? What are they trying to solve?" },
    { key: "aspirations", label: "Customer Aspirations", placeholder: "What do they want to achieve?", hint: "What does success look like for them?" },
  ],
  "3a": [
    { key: "purpose", label: "Why does your business exist?", placeholder: "Beyond making money, what drives you?", hint: "The deeper purpose behind your work." },
    { key: "values", label: "Core Values", placeholder: "What principles guide your decisions?", hint: "3-5 values that are non-negotiable for your brand." },
    { key: "impact", label: "Desired Impact", placeholder: "What change do you want to create?", hint: "How should the world be different because of your business?" },
  ],
};

// ─── Visual Identity Tournament (Step 3C) ───────────────────────────
function VisualIdentityTournament({ onApprove, intelligenceReady, imageReady }: {
  onApprove: () => void;
  intelligenceReady: boolean;
  imageReady: boolean;
}) {
  const [, setLocation] = useLocation();
  const { data: vi, refetch } = trpc.visualIdentity.get.useQuery();
  const generateSetsMut = trpc.visualIdentity.generateSets.useMutation();
  const selectSetMut = trpc.visualIdentity.selectSet.useMutation();
  const skipMut = trpc.visualIdentity.skip.useMutation();

  const [round, setRound] = useState(1);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [escapePrompt, setEscapePrompt] = useState("");
  const [showEscape, setShowEscape] = useState(false);
  const [generatingMsg, setGeneratingMsg] = useState("");

  const viStatus = (vi as any)?.status || "pending";
  const candidateSets = ((vi as any)?.candidateSets || []) as { images: string[]; description: string }[];
  const styleDocument = (vi as any)?.styleDocument as any;
  const missingImages = candidateSets.reduce(
    (count, set) => count + Math.max(0, 3 - set.images.filter(Boolean).length),
    0,
  );
  const selectedSetComplete = selectedIdx !== null
    && candidateSets[selectedIdx]?.images.filter(Boolean).length === 3;

  // Progressive messages during generation
  useEffect(() => {
    if (!generateSetsMut.isPending) { setGeneratingMsg(""); return; }
    const msgs = [
      "Analyzing your brand context...",
      "Generating visual style concepts...",
      "Creating hero banner compositions...",
      "Designing social media visuals...",
      "Crafting brand textures and patterns...",
      "Finalizing style sets...",
    ];
    let idx = 0;
    setGeneratingMsg(msgs[0]);
    const interval = setInterval(() => {
      idx = Math.min(idx + 1, msgs.length - 1);
      setGeneratingMsg(msgs[idx]);
    }, 4000);
    return () => clearInterval(interval);
  }, [generateSetsMut.isPending]);

  const handleGenerate = async (escape?: string, requestedRound = round) => {
    if (!imageReady) {
      toast.error("Save and test an enabled image provider in Settings first.");
      return;
    }
    try {
      await generateSetsMut.mutateAsync({ round: requestedRound, escapePrompt: escape });
      setRound(requestedRound);
      await refetch();
    } catch (e: any) {
      toast.error(e.message || "Generation failed");
      await refetch();
    }
  };

  const handleSelect = async () => {
    if (selectedIdx === null) return;
    if (!intelligenceReady) {
      toast.error("Save and test an enabled intelligence provider in Settings first.");
      return;
    }
    try {
      await selectSetMut.mutateAsync({ setIndex: selectedIdx });
      refetch();
      onApprove();
      toast.success("Visual identity selected and style document generated.");
    } catch (e: any) {
      toast.error(e.message || "Selection failed");
    }
  };

  const handleSkip = async () => {
    try {
      await skipMut.mutateAsync();
      await refetch();
      onApprove();
      toast.success("Visual identity skipped. You can return and add it later.");
    } catch (e: any) {
      toast.error(e.message || "Could not skip visual identity");
    }
  };

  // Already selected: show the style document.
  if (viStatus === "selected" && styleDocument) {
    return (
      <div className="space-y-4">
        <Card className="bg-card border-success/30">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Trophy className="h-5 w-5 text-success" />
              <CardTitle className="font-display text-lg">Visual Identity: Approved</CardTitle>
            </div>
            <p className="text-sm text-muted-foreground">This style document guides all image generation in the CREATE phase.</p>
          </CardHeader>
          <CardContent className="space-y-4">
            {styleDocument.colorPalette && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">Color Palette</p>
                <div className="flex gap-2 flex-wrap">
                  {(styleDocument.colorPalette as string[]).map((hex: string, i: number) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <div className="h-6 w-6 rounded border border-border" style={{ backgroundColor: hex }} />
                      <span className="text-xs font-mono text-muted-foreground">{hex}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {styleDocument.mood && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Mood</p>
                <p className="text-sm">{styleDocument.mood}</p>
              </div>
            )}
            {styleDocument.imageGuidelines && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Image Guidelines</p>
                <p className="text-sm">{styleDocument.imageGuidelines}</p>
              </div>
            )}
            {styleDocument.compositionRules && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Composition</p>
                <p className="text-sm">{styleDocument.compositionRules}</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // Generating state
  if (generateSetsMut.isPending) {
    return (
      <Card className="bg-card border-primary/30">
        <CardContent className="pt-8 pb-8 text-center space-y-4">
          <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto" />
          <div>
            <p className="text-sm text-primary font-medium animate-pulse">{generatingMsg}</p>
            <p className="text-xs text-muted-foreground mt-2">This may take a minute. MAF will generate {showEscape ? "1 custom set" : "4 style sets"} with 3 images each.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // No sets yet: generate them.
  if (candidateSets.length === 0) {
    return (
      <Card className="bg-card border-border/50">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Palette className="h-5 w-5 text-primary" />
            <CardTitle className="font-display text-lg">Visual Identity Tournament</CardTitle>
          </div>
          <p className="text-sm text-muted-foreground">
            Optional: generate 4 distinct visual style sets and pick your favorite. A full tournament creates 12 provider-billed images. You can skip this step and return later.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {!imageReady && (
            <div className="flex flex-col gap-3 rounded-lg border border-warning/30 bg-warning/5 p-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-muted-foreground">Image generation is unavailable until an enabled image provider passes its connection test.</p>
              <Button variant="outline" size="sm" onClick={() => setLocation("/settings/integrations")} className="shrink-0">
                <Settings2 className="mr-2 h-3.5 w-3.5" /> Configure images
              </Button>
            </div>
          )}
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button onClick={() => handleGenerate()} disabled={!imageReady} className="font-display font-semibold w-full sm:w-auto">
              <Sparkles className="mr-2 h-4 w-4" /> Generate 4 Style Sets (12 images)
            </Button>
            {viStatus !== "skipped" && (
              <Button variant="outline" onClick={handleSkip} disabled={skipMut.isPending} className="w-full sm:w-auto">
                {skipMut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Skip for now
              </Button>
            )}
          </div>
          {viStatus === "skipped" && (
            <p className="text-xs text-success">Skipped and approved. You can continue BUILD or add a visual identity here later.</p>
          )}
          <div className="pt-2 border-t border-border/30">
            <button onClick={() => setShowEscape(!showEscape)} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              {showEscape ? "Hide" : "Or describe your own style →"}
            </button>
            {showEscape && (
              <div className="mt-3 space-y-2">
                <Textarea
                  value={escapePrompt}
                  onChange={(e) => setEscapePrompt(e.target.value)}
                  placeholder="Describe the visual style you want (e.g., 'clean minimalist with navy and gold accents, editorial photography feel')..."
                  className="min-h-[80px] text-sm"
                />
                <Button variant="outline" onClick={() => handleGenerate(escapePrompt)} disabled={!imageReady || !escapePrompt.trim()} className="font-display text-sm">
                  Generate Custom Set
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  // Show sets for selection
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="font-display text-lg font-bold flex items-center gap-2">
            <Trophy className="h-5 w-5 text-primary" />
            {viStatus === "round2" ? "Refreshed Styles: Pick Your Favorite" : "Pick Your Favorite Style"}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">Click a set to select it, then confirm your choice below.</p>
        </div>
        {missingImages > 0 ? (
          <Badge variant="outline" className="text-warning border-warning/30 text-xs">
            {missingImages} image{missingImages === 1 ? "" : "s"} remaining
          </Badge>
        ) : (
          <Badge variant="outline" className="text-primary border-primary/30 text-xs">Ready to select</Badge>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {candidateSets.map((set, idx) => (
          <Card
            key={idx}
            role="radio"
            aria-checked={selectedIdx === idx}
            aria-disabled={set.images.filter(Boolean).length !== 3}
            tabIndex={set.images.filter(Boolean).length === 3 ? 0 : -1}
            className={`transition-all ${set.images.filter(Boolean).length === 3 ? "cursor-pointer hover:border-primary/40" : "cursor-not-allowed opacity-70"} ${selectedIdx === idx ? "border-primary ring-2 ring-primary/20" : "border-border/50"}`}
            onClick={() => set.images.filter(Boolean).length === 3 && setSelectedIdx(idx)}
            onKeyDown={(event) => {
              if (set.images.filter(Boolean).length === 3 && (event.key === "Enter" || event.key === " ")) {
                event.preventDefault();
                setSelectedIdx(idx);
              }
            }}
          >
            <CardContent className="pt-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="font-display font-semibold text-sm">{set.description}</p>
                {selectedIdx === idx && <CheckCircle2 className="h-4 w-4 text-primary" />}
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {set.images.filter(Boolean).map((img, imgIdx) => (
                  <div key={imgIdx} className="aspect-square rounded-md overflow-hidden bg-muted">
                    <img src={img} alt={`Style ${idx + 1} - ${imgIdx + 1}`} className="w-full h-full object-cover" loading="lazy" />
                  </div>
                ))}
                {set.images.filter(Boolean).length === 0 && (
                  <div className="col-span-3 aspect-video rounded-md bg-muted flex items-center justify-center">
                    <ImageIcon className="h-8 w-8 text-muted-foreground/30" />
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <Button
          onClick={handleSelect}
          disabled={!selectedSetComplete || selectSetMut.isPending || !intelligenceReady}
          className="font-display font-semibold"
        >
          {selectSetMut.isPending ? (
            <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Generating Style Doc...</>
          ) : (
            <><ThumbsUp className="mr-2 h-4 w-4" /> Confirm Selection</>
          )}
        </Button>
        {missingImages > 0 ? (
          <Button
            variant="outline"
            onClick={() => handleGenerate(undefined, Number((vi as any)?.tournamentRound || round))}
            disabled={!imageReady}
            className="font-display text-sm"
          >
            <RefreshCw className="mr-2 h-3.5 w-3.5" /> Continue Missing Images
          </Button>
        ) : (
          <Button
            variant="outline"
            onClick={() => {
              const nextRound = Number((vi as any)?.tournamentRound || round) + 1;
              handleGenerate(undefined, nextRound);
              setSelectedIdx(null);
            }}
            disabled={!imageReady}
            className="font-display text-sm"
          >
            <RefreshCw className="mr-2 h-3.5 w-3.5" /> Regenerate All Sets (12 images)
          </Button>
        )}
        {!imageReady && (
          <Button variant="link" size="sm" onClick={() => setLocation("/settings/integrations")} className="text-xs">
            <Settings2 className="mr-1.5 h-3.5 w-3.5" /> Configure image provider
          </Button>
        )}
        {!intelligenceReady && (
          <Button variant="link" size="sm" onClick={() => setLocation("/settings/integrations")} className="text-xs">
            <Settings2 className="mr-1.5 h-3.5 w-3.5" /> Configure intelligence provider
          </Button>
        )}
      </div>

      {/* Escape valve */}
      <div className="pt-2 border-t border-border/30">
        <button onClick={() => setShowEscape(!showEscape)} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
          {showEscape ? "Hide custom option" : "None of these? Describe your own style →"}
        </button>
        {showEscape && (
          <div className="mt-3 space-y-2">
            <Textarea
              value={escapePrompt}
              onChange={(e) => setEscapePrompt(e.target.value)}
              placeholder="Describe the visual style you want..."
              className="min-h-[60px] text-sm"
            />
            <Button variant="outline" onClick={() => { handleGenerate(escapePrompt); setSelectedIdx(null); }} disabled={!imageReady || !escapePrompt.trim()} className="font-display text-sm">
              Generate Custom Set
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
