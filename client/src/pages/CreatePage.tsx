import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import { useLocation, useSearchParams } from "wouter";
import { toast } from "sonner";
import { SafeMarkdown } from "@/components/SafeMarkdown";
import {
  ArrowLeft, ArrowRight, Loader2, PenTool, ImageIcon,
  ThumbsUp, RefreshCw, Copy, Share2, Info, Lock, Layers,
  BarChart3, Target, Palette, CheckCircle2, Settings2, GitBranch
} from "lucide-react";
import { useState, useEffect, useRef } from "react";
import {
  PLATFORMS, CONTENT_TYPES, ANGLES, ANGLE_LABELS,
  BUILD_SECTIONS, SECTION_LABELS, getPlatformImageFormat,
  type Platform, type RequestedImageFormat,
} from "@shared/maf-constants";

type IntegrationSummary = {
  capability: "intelligence" | "search" | "image";
  configured: boolean;
  enabled: boolean;
  verified: boolean;
};

const CREATE_STATUS_MESSAGES = [
  "Reading your marketing foundation...",
  "Applying brand voice and positioning...",
  "Crafting your content angle...",
  "Generating platform-native copy...",
  "Checking quality and compliance...",
  "Polishing the final output...",
];

const SECTION_ICONS: Record<string, any> = {
  research: BarChart3, offer: Target, brand: Palette, strategy: Layers,
};

export default function CreatePage() {
  const [, setLocation] = useLocation();
  const [searchParams] = useSearchParams();
  const { data: buildState, isLoading: buildLoading } = trpc.build.getState.useQuery();
  const integrationsQuery = trpc.integrations.list.useQuery();
  const generateMut = trpc.create.generate.useMutation();
  const approveMut = trpc.create.approve.useMutation();

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
  const imageReady = isCapabilityReady("image");

  const initialIdea = searchParams.get("idea")?.trim() ?? "";
  const [platform, setPlatform] = useState<Platform | "">("");
  const [contentType, setContentType] = useState("");
  const [substance, setSubstance] = useState(initialIdea);
  const [takeaway, setTakeaway] = useState("");
  const [constraints, setConstraints] = useState("");
  const [angle, setAngle] = useState("auto");
  const [includeImage, setIncludeImage] = useState(false);
  const [contextText, setContextText] = useState("");
  const [result, setResult] = useState<any>(null);
  const [resultImageUrl, setResultImageUrl] = useState<string | null>(null);
  const [resultImageFormat, setResultImageFormat] = useState<RequestedImageFormat | null>(null);
  const [resultOutputId, setResultOutputId] = useState<number | null>(null);
  const [statusMsg, setStatusMsg] = useState("");
  const lastIdeaParam = useRef(initialIdea);

  useEffect(() => {
    const idea = searchParams.get("idea")?.trim() ?? "";
    if (!idea || idea === lastIdeaParam.current) return;
    lastIdeaParam.current = idea;
    setSubstance(idea);
  }, [searchParams]);

  useEffect(() => {
    if (!imageReady && includeImage) setIncludeImage(false);
  }, [imageReady, includeImage]);

  // Progressive status messages during generation
  useEffect(() => {
    if (!generateMut.isPending) {
      setStatusMsg("");
      return;
    }
    let idx = 0;
    setStatusMsg(CREATE_STATUS_MESSAGES[0]);
    const interval = setInterval(() => {
      idx = Math.min(idx + 1, CREATE_STATUS_MESSAGES.length - 1);
      setStatusMsg(CREATE_STATUS_MESSAGES[idx]);
    }, 3500);
    return () => clearInterval(interval);
  }, [generateMut.isPending]);

  if (buildLoading || integrationsQuery.isLoading) {
    return <div className="min-h-screen bg-background flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  // ── BUILD-complete check ──────────────────────────────────────────
  const allBuildComplete = BUILD_SECTIONS.every(sectionKey =>
    buildState?.sections?.some(
      section => section.sectionKey === sectionKey && section.status === "approved",
    ) ?? false,
  );

  // ── BUILD LOCKED STATE ────────────────────────────────────────────
  if (!allBuildComplete) {
    const completedCount = buildState?.sections?.filter(s => s.status === "approved").length ?? 0;
    const totalCount = BUILD_SECTIONS.length;

    return (
      <div className="min-h-screen bg-background">
        <nav className="border-b border-border/50 bg-background/80 backdrop-blur-xl sticky top-0 z-50">
          <div className="container flex h-14 items-center justify-between">
            <div className="flex items-center gap-2 sm:gap-3">
              <Button variant="ghost" size="sm" onClick={() => setLocation("/dashboard")}>
                <ArrowLeft className="h-4 w-4 mr-1" /> <span className="hidden sm:inline">Dashboard</span>
              </Button>
              <Separator orientation="vertical" className="h-5" />
              <div className="flex items-center gap-2">
                <Lock className="h-4 w-4 text-muted-foreground" />
                <span className="font-display font-semibold text-sm">Create Content</span>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setLocation("/settings/integrations")} className="text-muted-foreground h-8 px-2">
              <Settings2 className="mr-1.5 h-3.5 w-3.5" /> APIs
            </Button>
          </div>
        </nav>

        <div className="container py-12 md:py-20">
          <div className="max-w-lg mx-auto text-center space-y-8">
            <div className="mx-auto h-20 w-20 rounded-2xl bg-muted/50 border border-border/50 flex items-center justify-center">
              <Lock className="h-10 w-10 text-muted-foreground/50" />
            </div>

            <div className="space-y-3">
              <h1 className="font-display text-2xl md:text-3xl font-bold tracking-tight">
                Complete your BUILD phase first
              </h1>
              <p className="text-muted-foreground leading-relaxed">
                The CREATE engine generates content grounded in your marketing foundation. Every piece carries your voice, positioning, and strategy forward.
              </p>
            </div>

            {/* Section progress */}
            <div className="space-y-3 text-left">
              <p className="text-xs font-display font-semibold text-muted-foreground tracking-wider uppercase">
                Progress: {completedCount} of {totalCount} sections
              </p>
              {BUILD_SECTIONS.map((sectionKey) => {
                const section = buildState?.sections?.find(s => s.sectionKey === sectionKey);
                const status = section?.status || "locked";
                const Icon = SECTION_ICONS[sectionKey] || Layers;
                const isApproved = status === "approved";
                const isLocked = status === "locked";
                const isActive = !isApproved && !isLocked;

                return (
                  <div
                    key={sectionKey}
                    className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${
                      isApproved
                        ? "border-success/30 bg-success/5"
                        : isActive
                        ? "border-primary/30 bg-primary/5 cursor-pointer hover:border-primary/50"
                        : "border-border/30 bg-muted/20 opacity-60"
                    }`}
                    onClick={() => isActive && setLocation(`/build/${sectionKey}`)}
                  >
                    <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${
                      isApproved ? "bg-success/10" : isActive ? "bg-primary/10" : "bg-muted/30"
                    }`}>
                      {isApproved ? (
                        <CheckCircle2 className="h-4 w-4 text-success" />
                      ) : (
                        <Icon className={`h-4 w-4 ${isActive ? "text-primary" : "text-muted-foreground/50"}`} />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`font-display font-semibold text-sm ${isApproved ? "text-success" : ""}`}>
                        {SECTION_LABELS[sectionKey]}
                      </p>
                      <p className="text-xs text-muted-foreground capitalize">
                        {isApproved ? "Approved" : isActive ? "In progress. Click to continue" : "Locked"}
                      </p>
                    </div>
                    {isActive && <ArrowRight className="h-4 w-4 text-primary shrink-0" />}
                  </div>
                );
              })}
            </div>

            <Button
              size="lg"
              onClick={() => {
                // Navigate to the first non-approved, non-locked section
                const nextSection = BUILD_SECTIONS.find(sk => {
                  const s = buildState?.sections?.find(s => s.sectionKey === sk);
                  return s && s.status !== "approved" && s.status !== "locked";
                });
                setLocation(nextSection ? `/build/${nextSection}` : "/build/research");
              }}
              className="font-display font-bold w-full sm:w-auto px-8"
            >
              Continue Building <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ── MAIN CREATE UI (BUILD is complete) ────────────────────────────
  const handleGenerate = async () => {
    if (!platform || !contentType || !substance || !takeaway) {
      toast.error("Please fill in platform, content type, substance, and takeaway.");
      return;
    }
    if (!intelligenceReady) {
      toast.error("Save and test an enabled intelligence provider in Settings first.");
      return;
    }
    if (includeImage && !imageReady) {
      toast.error("Save and test an enabled image provider in Settings before requesting an image.");
      return;
    }

    try {
      const res = await generateMut.mutateAsync({
        platform,
        contentType,
        direction: { substance, takeaway, constraints: constraints || undefined },
        angle,
        includeImage,
        contextText: contextText || undefined,
      });
      setResult(res.content);
      setResultImageUrl(res.imageUrl || null);
      setResultImageFormat(res.imageFormat || null);
      setResultOutputId(res.outputId || null);
      if (res.imageWarning) toast.warning(res.imageWarning);
      else toast.success("Content generated successfully.");
    } catch (e: any) {
      toast.error(e.message || "Generation failed");
    }
  };

  const handleApprove = async () => {
    if (!resultOutputId) return;
    try {
      await approveMut.mutateAsync({ outputId: resultOutputId });
      toast.success("Content approved and saved to library.");
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleCopy = async () => {
    if (result?.body) {
      try {
        await navigator.clipboard.writeText(result.body);
        toast.success("Content copied to clipboard.");
      } catch {
        toast.error("Clipboard access failed. Select and copy the content manually.");
      }
    }
  };

  const resetForm = () => {
    setResult(null);
    setResultImageUrl(null);
    setResultImageFormat(null);
    setResultOutputId(null);
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Top Nav */}
      <nav className="border-b border-border/50 bg-background/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="container flex h-14 items-center justify-between">
          <div className="flex items-center gap-2 sm:gap-3">
            <Button variant="ghost" size="sm" onClick={() => setLocation("/dashboard")}>
              <ArrowLeft className="h-4 w-4 mr-1" /> <span className="hidden sm:inline">Dashboard</span>
            </Button>
            <Separator orientation="vertical" className="h-5" />
            <div className="flex items-center gap-2">
              <PenTool className="h-4 w-4 text-chart-2" />
              <span className="font-display font-semibold text-sm">Create Content</span>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setLocation("/settings/integrations")} className="text-muted-foreground h-8 px-2">
            <Settings2 className="mr-1.5 h-3.5 w-3.5" /> API integrations
          </Button>
        </div>
      </nav>

      <div className="container py-6 md:py-8">
        <div className="grid lg:grid-cols-2 gap-6 max-w-6xl mx-auto">
          {/* ─── Left: Input Form ─────────────────────────────────── */}
          <div className="space-y-5">
            <div>
              <h1 className="font-display text-xl sm:text-2xl font-bold">Create Content</h1>
              <p className="text-sm text-muted-foreground mt-1">Your BUILD foundation powers every piece. Just set the direction.</p>
            </div>

            {!intelligenceReady && (
              <div className="flex flex-col gap-3 rounded-lg border border-warning/30 bg-warning/5 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium">Intelligence provider required</p>
                  <p className="mt-1 text-xs text-muted-foreground">Save and test your preferred model before generating content.</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => setLocation("/settings/integrations")} className="shrink-0">
                  <Settings2 className="mr-2 h-3.5 w-3.5" /> Configure
                </Button>
              </div>
            )}

            {/* Platform */}
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Platform</Label>
              <Select value={platform} onValueChange={value => setPlatform(value as Platform)}>
                <SelectTrigger><SelectValue placeholder="Select platform..." /></SelectTrigger>
                <SelectContent>
                  {PLATFORMS.map(p => (
                    <SelectItem key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Content Type */}
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Content Type</Label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {CONTENT_TYPES.map(ct => (
                  <Tooltip key={ct.key}>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => setContentType(ct.key)}
                        className={`px-3 py-2 rounded-lg border text-xs font-medium transition-all min-h-[44px] ${
                          contentType === ct.key
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border/50 hover:border-primary/30 text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {ct.label}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent><p className="text-xs max-w-[200px]">{ct.tooltip}</p></TooltipContent>
                  </Tooltip>
                ))}
              </div>
            </div>

            {/* Direction */}
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">Substance</Label>
                <Textarea value={substance} onChange={e => setSubstance(e.target.value)} placeholder="What is this content about? The core idea or topic..." className="min-h-[70px]" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">Desired Takeaway</Label>
                <Textarea value={takeaway} onChange={e => setTakeaway(e.target.value)} placeholder="What should the reader think, feel, or do after reading?" className="min-h-[70px]" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">Constraints <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Input value={constraints} onChange={e => setConstraints(e.target.value)} placeholder="e.g., avoid jargon, keep under 200 words..." />
              </div>
            </div>

            {/* Angle */}
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Angle</Label>
              <Select value={angle} onValueChange={setAngle}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ANGLES.map(a => (
                    <SelectItem key={a} value={a}>{ANGLE_LABELS[a] || a}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Context */}
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Additional Context <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Textarea value={contextText} onChange={e => setContextText(e.target.value)} placeholder="Paste any additional context, notes, or reference material..." className="min-h-[60px]" />
            </div>

            {/* Image Toggle */}
            <div className="flex items-center justify-between p-4 rounded-lg border border-border/50 bg-card min-h-[56px]">
              <div className="flex items-center gap-2">
                <ImageIcon className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">Include Image</p>
                  <p className="text-xs text-muted-foreground">
                    {imageReady
                      ? platform
                        ? `Requests ${getPlatformImageFormat(platform).label} at ${getPlatformImageFormat(platform).aspectRatio}; final pixels depend on your provider.`
                        : "Select a platform to see the requested image format. Final pixels depend on your provider."
                      : "Save and test an image provider in Settings to enable this option."}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {!imageReady && (
                  <Button variant="link" size="sm" onClick={() => setLocation("/settings/integrations")} className="h-auto px-1 text-xs">
                    Settings
                  </Button>
                )}
                <Switch checked={includeImage} onCheckedChange={setIncludeImage} disabled={!imageReady} />
              </div>
            </div>

            {/* Generate Button */}
            <Button
              size="lg"
              onClick={handleGenerate}
              disabled={generateMut.isPending || !intelligenceReady || !platform || !contentType || !substance || !takeaway}
              className="w-full font-display font-semibold"
            >
              {generateMut.isPending ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Generating...</>
              ) : (
                <>Generate Content</>
              )}
            </Button>
            <p className="text-center text-xs leading-relaxed text-muted-foreground">
              CREATE uses separate drafting, private review, and refinement requests. Your intelligence provider may bill each request, plus one image request when enabled.
            </p>
          </div>

          {/* ─── Right: Output Preview ────────────────────────────── */}
          <div className="space-y-4">
            {!result && !generateMut.isPending && (
              <Card className="bg-card border-border/50 min-h-[300px] lg:min-h-[400px] flex items-center justify-center">
                <CardContent className="text-center space-y-3">
                  <PenTool className="h-12 w-12 text-muted-foreground/30 mx-auto" />
                  <p className="text-muted-foreground text-sm">Your generated content will appear here</p>
                  <p className="text-xs text-muted-foreground/60">Powered by your BUILD foundation</p>
                </CardContent>
              </Card>
            )}

            {generateMut.isPending && (
              <Card className="bg-card border-primary/30 min-h-[300px] lg:min-h-[400px] flex items-center justify-center">
                <CardContent className="text-center space-y-3">
                  <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto" />
                  <p className="text-sm text-primary font-medium animate-pulse">{statusMsg}</p>
                  <p className="text-xs text-muted-foreground">Using your BUILD context to generate platform-native content</p>
                </CardContent>
              </Card>
            )}

            {result && (
              <div className="space-y-4">
                <Card className="bg-card border-border/50">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div>
                        <Badge variant="secondary" className="text-xs mb-2">{platform} / {contentType}</Badge>
                        <CardTitle className="font-display text-lg">{result.title}</CardTitle>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Hook */}
                    {result.hook && (
                      <div className="p-3 rounded-lg bg-primary/5 border border-primary/20">
                        <p className="text-xs font-medium text-primary mb-1">Hook</p>
                        <p className="text-sm font-medium">{result.hook}</p>
                      </div>
                    )}

                    {/* Body */}
                    <div className="prose prose-invert prose-sm max-w-none">
                      <SafeMarkdown>{result.body}</SafeMarkdown>
                    </div>

                    {/* Hashtags */}
                    {result.hashtags?.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {result.hashtags.map((tag: string, i: number) => (
                          <Badge key={i} variant="secondary" className="text-xs">{tag.startsWith("#") ? tag : `#${tag}`}</Badge>
                        ))}
                      </div>
                    )}

                    {/* Image */}
                    {resultImageUrl && (
                      <div className="rounded-lg overflow-hidden border border-border/50">
                        <img src={resultImageUrl} alt="Generated" className="w-full" />
                        {resultImageFormat && (
                          <div className="bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                            <div className="flex items-center justify-between gap-3">
                              <span>{resultImageFormat.label}</span>
                              <span>Requested {resultImageFormat.aspectRatio}</span>
                            </div>
                            <p className="mt-1 text-[11px]">Final pixel dimensions are chosen by your image provider.</p>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Notes */}
                    {result.notes && (
                      <div className="p-3 rounded-lg bg-muted/50 border border-border/30">
                        <p className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1"><Info className="h-3 w-3" /> Creator Notes</p>
                        <p className="text-xs text-muted-foreground">{result.notes}</p>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Action Buttons */}
                <div className="flex flex-wrap gap-2">
                  <Button onClick={handleApprove} disabled={approveMut.isPending} className="font-display font-semibold">
                    <ThumbsUp className="mr-2 h-4 w-4" /> Approve
                  </Button>
                  <Button
                    onClick={() => resultOutputId && setLocation(`/library?repurpose=${resultOutputId}`)}
                    disabled={!resultOutputId}
                    className="font-display font-semibold bg-chart-2 hover:bg-chart-2/90 text-white"
                  >
                    <GitBranch className="mr-2 h-4 w-4" /> Repurpose this content
                  </Button>
                  <Button variant="outline" onClick={handleCopy}>
                    <Copy className="mr-2 h-4 w-4" /> Copy
                  </Button>
                  <Button variant="outline" onClick={resetForm}>
                    <RefreshCw className="mr-2 h-4 w-4" /> New
                  </Button>
                  <Button variant="outline" onClick={() => resultOutputId && setLocation(`/library`)}>
                    <Share2 className="mr-2 h-4 w-4" /> Library
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
