import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLocation, useSearchParams } from "wouter";
import { toast } from "sonner";
import { SafeMarkdown } from "@/components/SafeMarkdown";
import {
  ArrowLeft, Library, Loader2, Search, Filter,
  Copy, Trash2, PenTool, Share2, GitBranch, ImageIcon, ArrowRight, RefreshCw,
  BarChart3, AlertCircle, Settings2
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BUILD_SECTIONS,
  PLATFORMS,
  CONTENT_TYPES,
  getPlatformImageFormat,
  type Platform,
} from "@shared/maf-constants";

type IntegrationSummary = {
  capability: "intelligence" | "search" | "image";
  configured: boolean;
  enabled: boolean;
  verified: boolean;
};

export default function LibraryPage() {
  const [, setLocation] = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    data: outputs,
    error: outputsError,
    isError: outputsIsError,
    isLoading: outputsLoading,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
    refetch,
  } = trpc.library.list.useInfiniteQuery({ limit: 50 }, {
    getNextPageParam: (lastPage, pages) => lastPage.length === 50 ? pages.length * 50 : undefined,
  });
  const { data: buildState } = trpc.build.getState.useQuery();
  const integrationsQuery = trpc.integrations.list.useQuery();
  const archiveMut = trpc.create.updateStatus.useMutation();
  const repurposeMut = trpc.create.repurpose.useMutation();

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

  const buildComplete = BUILD_SECTIONS.every(sectionKey =>
    buildState?.sections?.some(
      section => section.sectionKey === sectionKey && section.status === "approved",
    ) ?? false,
  );

  const handleCreateNav = () => {
    if (!buildComplete) {
      toast.error("Complete your BUILD phase first", { description: "All 4 sections must be approved before you can create content." });
      setLocation("/build/research");
      return;
    }
    setLocation("/create");
  };

  const [search, setSearch] = useState("");
  const [filterPlatform, setFilterPlatform] = useState("all");
  const [filterStatus, setFilterStatus] = useState("active");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState("library");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkMode, setBulkMode] = useState(false);
  const bulkExportMut = trpc.library.bulkExport.useMutation();

  // Repurpose dialog state
  const [repurposeTarget, setRepurposeTarget] = useState<any>(null);
  const [repurposePlatforms, setRepurposePlatforms] = useState<Platform[]>([]);
  const [repurposeImages, setRepurposeImages] = useState(false);
  const openedRepurposeId = useRef<number | null>(null);

  // Individual review dialog for repurposed pieces
  const [reviewTarget, setReviewTarget] = useState<any>(null);

  const allOutputs = useMemo(() => outputs?.pages.flat() ?? [], [outputs]);
  const rawRepurposeId = searchParams.get("repurpose");
  const parsedRepurposeId = rawRepurposeId ? Number(rawRepurposeId) : Number.NaN;
  const repurposeQueryId =
    rawRepurposeId &&
    /^\d+$/.test(rawRepurposeId) &&
    Number.isSafeInteger(parsedRepurposeId) &&
    parsedRepurposeId > 0
      ? parsedRepurposeId
      : null;
  const repurposeOutputQuery = trpc.library.getById.useQuery(
    { id: repurposeQueryId ?? 0 },
    { enabled: repurposeQueryId !== null },
  );

  const clearRepurposeQuery = useCallback(() => {
    if (!searchParams.has("repurpose")) return;
    setSearchParams(current => {
      const next = new URLSearchParams(current);
      next.delete("repurpose");
      return next;
    }, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (!imageReady && repurposeImages) setRepurposeImages(false);
  }, [imageReady, repurposeImages]);

  useEffect(() => {
    if (!rawRepurposeId) return;
    if (repurposeQueryId === null) {
      toast.error("The repurpose link is invalid.");
      clearRepurposeQuery();
      return;
    }
    if (repurposeOutputQuery.isLoading || repurposeOutputQuery.isFetching) return;
    if (repurposeOutputQuery.isError) {
      toast.error("The content could not be loaded for repurposing.");
      clearRepurposeQuery();
      return;
    }
    const match = repurposeOutputQuery.data;
    if (!match) {
      toast.error("That content is no longer available.");
      clearRepurposeQuery();
      return;
    }
    if (openedRepurposeId.current === repurposeQueryId) return;

    openedRepurposeId.current = repurposeQueryId;
    setRepurposeTarget(match);
    setRepurposePlatforms([]);
    setRepurposeImages(false);
  }, [
    clearRepurposeQuery,
    rawRepurposeId,
    repurposeOutputQuery.data,
    repurposeOutputQuery.isError,
    repurposeOutputQuery.isFetching,
    repurposeOutputQuery.isLoading,
    repurposeQueryId,
  ]);

  const filtered = useMemo(() => {
    return allOutputs.filter((o: any) => {
      if (filterPlatform !== "all" && o.platform !== filterPlatform) return false;
      if (filterStatus === "active" && o.status === "archived") return false;
      if (filterStatus !== "active" && filterStatus !== "all" && o.status !== filterStatus) return false;
      if (search) {
        const s = search.toLowerCase();
        const content = o.content as any;
        const title = content?.title || "";
        const body = content?.body || "";
        if (!title.toLowerCase().includes(s) && !body.toLowerCase().includes(s) && !o.platform.includes(s)) return false;
      }
      return true;
    });
  }, [allOutputs, search, filterPlatform, filterStatus]);

  // ─── Content Balance View ─────────────────────────────────────────
  const contentMix = useMemo(() => {
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const recent = allOutputs.filter((o: any) => new Date(o.createdAt).getTime() > thirtyDaysAgo && o.status !== "archived");
    const byType: Record<string, number> = {};
    const byPlatform: Record<string, number> = {};
    for (const o of recent) {
      byType[o.contentType] = (byType[o.contentType] || 0) + 1;
      byPlatform[o.platform] = (byPlatform[o.platform] || 0) + 1;
    }
    const total = recent.length;
    const typeBreakdown = CONTENT_TYPES.map(ct => ({
      key: ct.key,
      label: ct.label,
      count: byType[ct.key] || 0,
      pct: total > 0 ? Math.round(((byType[ct.key] || 0) / total) * 100) : 0,
    }));
    const platformBreakdown = PLATFORMS.map(p => ({
      key: p,
      label: p.charAt(0).toUpperCase() + p.slice(1),
      count: byPlatform[p] || 0,
      pct: total > 0 ? Math.round(((byPlatform[p] || 0) / total) * 100) : 0,
    }));
    // Nudge: check if any content type is over 50% or any is 0%
    const nudges: string[] = [];
    for (const t of typeBreakdown) {
      if (t.pct > 50) nudges.push(`${t.label} content is ${t.pct}% of your mix. Consider diversifying.`);
    }
    const usedTypes = typeBreakdown.filter(t => t.count > 0).length;
    if (usedTypes < 3 && total > 5) nudges.push("You're using fewer than 3 content types. Variety keeps your audience engaged.");
    const usedPlatforms = platformBreakdown.filter(p => p.count > 0).length;
    if (usedPlatforms === 1 && total > 3) nudges.push("All content is on one platform. Consider repurposing to reach a wider audience.");
    return { total, typeBreakdown, platformBreakdown, nudges };
  }, [allOutputs]);

  const toggleSelect = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleSelectAll = () => {
    if (filtered.every(output => selectedIds.has(output.id))) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map((o: any) => o.id)));
    }
  };
  const handleBulkExport = async () => {
    if (selectedIds.size === 0) { toast.error("Select items first"); return; }
    try {
      const items = await bulkExportMut.mutateAsync({ ids: Array.from(selectedIds) });
      // Build a text file with all content
      const lines = items.map((item: any) =>
        `=== ${item.platform.toUpperCase()} | ${item.contentType} | ${new Date(item.createdAt).toLocaleDateString()} ===\n\n${typeof item.content === "string" ? item.content : JSON.stringify(item.content, null, 2)}\n\n`
      );
      const blob = new Blob([lines.join("---\n\n")], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `maf-export-${Date.now()}.txt`;
      a.click(); URL.revokeObjectURL(url);
      toast.success(`Exported ${items.length} items`);
      setSelectedIds(new Set());
      setBulkMode(false);
    } catch (e: any) {
      toast.error(e.message || "Export failed");
    }
  };

  const handleCopy = async (content: any) => {
    const text = content?.body || JSON.stringify(content);
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Clipboard access failed. Select and copy the content manually.");
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Archive this content?")) return;
    try {
      await archiveMut.mutateAsync({ outputId: id, status: "archived" });
      refetch();
      toast.success("Content archived");
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleRestore = async (id: number) => {
    try {
      await archiveMut.mutateAsync({ outputId: id, status: "draft" });
      await refetch();
      toast.success("Content restored as a draft");
    } catch (e: any) {
      toast.error(e.message || "Restore failed");
    }
  };

  const openRepurpose = (output: any) => {
    setRepurposeTarget(output);
    setRepurposePlatforms([]);
    setRepurposeImages(false);
  };

  const handleRepurpose = async () => {
    if (!repurposeTarget || repurposePlatforms.length === 0) return;
    if (!intelligenceReady) {
      toast.error("Save and test an enabled intelligence provider in Settings first.");
      return;
    }
    if (repurposeImages && !imageReady) {
      toast.error("Save and test an enabled image provider in Settings before requesting images.");
      return;
    }
    try {
      const outcome = await repurposeMut.mutateAsync({
        parentId: repurposeTarget.id,
        platforms: repurposePlatforms,
        includeImages: imageReady && repurposeImages,
      });
      await refetch();
      if (outcome.failures.length > 0) {
        setRepurposePlatforms(outcome.failures.map(failure => failure.platform));
        toast.warning(`${outcome.results.length} draft(s) saved. Retry the remaining ${outcome.failures.length} platform(s).`, {
          description: outcome.failures.map(failure => `${failure.platform}: ${failure.message}`).join(" "),
        });
        return;
      }
      if (outcome.results.some(result => result.imageWarning)) {
        toast.warning("Repurposed text was saved. Some images failed; check your image provider in Settings.");
      } else toast.success(`Content repurposed to ${outcome.results.length} platform(s).`);
      setRepurposeTarget(null);
      clearRepurposeQuery();
    } catch (e: any) {
      toast.error(e.message || "Repurpose failed");
      // Earlier platforms may already have been saved before a later failure.
      await refetch();
    }
  };

  const toggleRepurposePlatform = (p: Platform) => {
    setRepurposePlatforms(prev =>
      prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]
    );
  };

  const isChild = (o: any) => !!o.parentId;
  const getParentTitle = (parentId: number) => {
    const parent = allOutputs.find((o: any) => o.id === parentId);
    return (parent?.content as any)?.title || `#${parentId}`;
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Top Nav */}
      <nav className="border-b border-border/50 bg-background/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="container flex h-14 items-center justify-between">
          <div className="flex items-center gap-2 sm:gap-3">
            <Button variant="ghost" size="sm" onClick={() => setLocation("/dashboard")} className="min-h-[44px] min-w-[44px]">
              <ArrowLeft className="h-4 w-4 mr-1" /> <span className="hidden sm:inline">Dashboard</span>
            </Button>
            <Separator orientation="vertical" className="h-5" />
            <div className="flex items-center gap-2">
              <Library className="h-4 w-4 text-chart-3" />
              <span className="font-display font-semibold text-sm">Content Library</span>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <Button variant="outline" size="sm" onClick={handleCreateNav} className="font-display text-xs min-h-[44px]">
              <PenTool className="h-3.5 w-3.5 mr-1" /> <span className="hidden sm:inline">Create New</span>
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setLocation("/settings/integrations")} className="text-muted-foreground min-h-[44px] px-2">
              <Settings2 className="mr-1.5 h-3.5 w-3.5" /> <span className="hidden sm:inline">API integrations</span>
            </Button>
          </div>
        </div>
      </nav>

      <div className="container py-6 md:py-8 max-w-5xl">
        {/* Tabs: Library / Content Balance */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h1 className="font-display text-xl sm:text-2xl font-bold">Content Library</h1>
              <p className="text-sm text-muted-foreground mt-1">
                {allOutputs.length} pieces of content generated
              </p>
            </div>
            <TabsList className="grid w-full sm:w-auto grid-cols-2 h-10">
              <TabsTrigger value="library" className="text-xs font-display min-h-[44px]">
                <Library className="h-3.5 w-3.5 mr-1.5" /> Library
              </TabsTrigger>
              <TabsTrigger value="balance" className="text-xs font-display min-h-[44px]">
                <BarChart3 className="h-3.5 w-3.5 mr-1.5" /> Content Mix
              </TabsTrigger>
            </TabsList>
          </div>

          {/* ─── Library Tab ──────────────────────────────────────── */}
          <TabsContent value="library" className="space-y-4">
            {/* Filters */}
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search content..." className="pl-9 min-h-[44px]" />
              </div>
              <Select value={filterPlatform} onValueChange={setFilterPlatform}>
                <SelectTrigger className="w-full sm:w-[140px] min-h-[44px]">
                  <Filter className="h-3.5 w-3.5 mr-1" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Platforms</SelectItem>
                  {PLATFORMS.map(p => (
                    <SelectItem key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="w-full sm:w-[130px] min-h-[44px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="archived">Archived</SelectItem>
                  <SelectItem value="all">All Statuses</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Bulk Select Controls */}
            <div className="flex items-center gap-3">
              <Button variant="outline" size="sm" onClick={() => { setBulkMode(!bulkMode); setSelectedIds(new Set()); }} className="min-h-[36px]">
                {bulkMode ? "Cancel Select" : "Select"}
              </Button>
              {bulkMode && (
                <>
                  <Button variant="ghost" size="sm" onClick={toggleSelectAll} className="min-h-[36px] text-xs">
                    {selectedIds.size === filtered.length ? "Deselect All" : "Select All"}
                  </Button>
                  <span className="text-xs text-muted-foreground">{selectedIds.size} selected</span>
                  <Button size="sm" onClick={handleBulkExport} disabled={selectedIds.size === 0 || bulkExportMut.isPending} className="min-h-[36px] ml-auto">
                    {bulkExportMut.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                    Export Selected
                  </Button>
                </>
              )}
            </div>

            {/* Content List */}
            {outputsLoading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : outputsIsError ? (
              <Card className="border-destructive/25 bg-destructive/[0.04]">
                <CardContent className="space-y-4 py-14 text-center">
                  <AlertCircle className="mx-auto h-10 w-10 text-destructive" />
                  <div>
                    <p className="font-display font-semibold">Content library could not be loaded</p>
                    <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
                      {outputsError?.message || "Check the server connection, then try again."}
                    </p>
                  </div>
                  <Button variant="outline" onClick={() => refetch()}>
                    Try again
                  </Button>
                </CardContent>
              </Card>
            ) : filtered.length === 0 ? (
              <Card className="bg-card border-border/50">
                <CardContent className="py-16 text-center space-y-3">
                  <Library className="h-12 w-12 text-muted-foreground/30 mx-auto" />
                  <p className="text-muted-foreground">
                    {allOutputs.length === 0 ? "No content yet. Start creating!" : "No content matches your filters."}
                  </p>
                  {allOutputs.length === 0 && (
                    <Button onClick={handleCreateNav} className="font-display font-semibold min-h-[44px]">
                      Create Your First Content <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                  )}
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {filtered.map((output: any) => {
                  const content = output.content as any;
                  const isExpanded = expandedId === output.id;

                  return (
                    <Card key={output.id} className="bg-card border-border/50 hover:border-border transition-colors">
                      <CardContent className="py-4">
                        <div className="flex items-start justify-between gap-3">
                          {bulkMode && (
                            <Checkbox
                              checked={selectedIds.has(output.id)}
                              onCheckedChange={() => toggleSelect(output.id)}
                              className="mt-1 shrink-0"
                            />
                          )}
                          <div className="flex-1 min-w-0 cursor-pointer" onClick={() => bulkMode ? toggleSelect(output.id) : setExpandedId(isExpanded ? null : output.id)}>
                            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                              <Badge variant="secondary" className="text-xs shrink-0">{output.platform}</Badge>
                              <Badge variant="outline" className="text-xs shrink-0">{output.contentType}</Badge>
                              {output.status === "approved" && <Badge className="bg-success/10 text-success text-xs">Approved</Badge>}
                              {output.angle && output.angle !== "auto" && <Badge variant="outline" className="text-xs">{output.angle}</Badge>}
                              {isChild(output) && (
                                <Badge variant="outline" className="text-xs border-chart-2/30 text-chart-2">
                                  <GitBranch className="h-3 w-3 mr-1" /> from {getParentTitle(output.parentId)}
                                </Badge>
                              )}
                            </div>
                            <h3 className="font-display font-semibold text-sm truncate">{content?.title || "Untitled"}</h3>
                            {!isExpanded && (
                              <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{content?.hook || content?.body?.slice(0, 120)}</p>
                            )}
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <Button variant="ghost" size="sm" className="min-h-[44px] min-w-[44px] p-0" onClick={() => handleCopy(content)} title="Copy">
                              <Copy className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="sm" className="min-h-[44px] min-w-[44px] p-0" onClick={() => openRepurpose(output)} title="Repurpose">
                              <Share2 className="h-3.5 w-3.5" />
                            </Button>
                            {output.status === "draft" && (
                              <Button variant="ghost" size="sm" className="min-h-[44px] min-w-[44px] p-0 text-chart-2" onClick={() => setReviewTarget(output)} title="Review">
                                <PenTool className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            {output.status === "archived" ? (
                              <Button variant="ghost" size="sm" className="min-h-[44px] min-w-[44px] p-0" onClick={() => handleRestore(output.id)} title="Restore as draft">
                                <RefreshCw className="h-3.5 w-3.5" />
                              </Button>
                            ) : (
                              <Button variant="ghost" size="sm" className="min-h-[44px] min-w-[44px] p-0 text-destructive" onClick={() => handleDelete(output.id)} title="Archive">
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        </div>

                        {isExpanded && (
                          <div className="mt-4 space-y-3">
                            <Separator />
                            {content?.hook && (
                              <div className="p-3 rounded-lg bg-primary/5 border border-primary/20">
                                <p className="text-xs font-medium text-primary mb-1">Hook</p>
                                <p className="text-sm">{content.hook}</p>
                              </div>
                            )}
                            <div className="prose prose-invert prose-sm max-w-none">
                              <SafeMarkdown>{content?.body || ""}</SafeMarkdown>
                            </div>
                            {content?.hashtags?.length > 0 && (
                              <div className="flex flex-wrap gap-1.5">
                                {content.hashtags.map((tag: string, i: number) => (
                                  <Badge key={i} variant="secondary" className="text-xs">{tag.startsWith("#") ? tag : `#${tag}`}</Badge>
                                ))}
                              </div>
                            )}
                            {output.imageUrl && (
                              <div className="rounded-lg overflow-hidden border border-border/50 max-w-sm">
                                <img src={output.imageUrl} alt="Generated" className="w-full" />
                                {output.imageFormat && (
                                  <div className="bg-muted/50 px-3 py-2 text-[11px] text-muted-foreground">
                                    <span>{output.imageFormat.label} · requested {output.imageFormat.aspectRatio}</span>
                                    <span className="mt-0.5 block">Final pixels are set by the image provider.</span>
                                  </div>
                                )}
                              </div>
                            )}
                            <div className="flex items-center justify-between flex-wrap gap-2">
                              <p className="text-xs text-muted-foreground">
                                Created {new Date(output.createdAt).toLocaleString()}
                              </p>
                              <Button variant="outline" size="sm" className="text-xs min-h-[44px]" onClick={() => openRepurpose(output)}>
                                <Share2 className="h-3 w-3 mr-1" /> Repurpose
                              </Button>
                            </div>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
            {hasNextPage && (
              <div className="space-y-2 py-4 text-center">
                <p className="text-xs text-muted-foreground">Filters and content balance currently cover {allOutputs.length} loaded items.</p>
                <Button variant="outline" disabled={isFetchingNextPage} onClick={() => fetchNextPage()}>
                  {isFetchingNextPage ? "Loading..." : "Load older content"}
                </Button>
              </div>
            )}
          </TabsContent>

          {/* ─── Content Balance Tab ──────────────────────────────── */}
          <TabsContent value="balance" className="space-y-6">
            <Card className="bg-card border-border/50">
              <CardHeader>
                <CardTitle className="font-display text-lg flex items-center gap-2">
                  <BarChart3 className="h-5 w-5 text-primary" /> 30-Day Content Mix
                </CardTitle>
                <p className="text-sm text-muted-foreground">{contentMix.total} pieces created in the last 30 days</p>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* By Content Type */}
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-3 uppercase tracking-wider">By Content Type</p>
                  <div className="space-y-2">
                    {contentMix.typeBreakdown.map(t => (
                      <div key={t.key} className="flex items-center gap-3">
                        <span className="text-xs w-20 shrink-0 text-muted-foreground">{t.label}</span>
                        <div className="flex-1 h-6 bg-muted/30 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary/60 rounded-full transition-all duration-500"
                            style={{ width: `${Math.max(t.pct, 2)}%` }}
                          />
                        </div>
                        <span className="text-xs font-mono w-12 text-right text-muted-foreground">{t.count} ({t.pct}%)</span>
                      </div>
                    ))}
                  </div>
                </div>

                <Separator />

                {/* By Platform */}
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-3 uppercase tracking-wider">By Platform</p>
                  <div className="space-y-2">
                    {contentMix.platformBreakdown.map(p => (
                      <div key={p.key} className="flex items-center gap-3">
                        <span className="text-xs w-20 shrink-0 text-muted-foreground capitalize">{p.label}</span>
                        <div className="flex-1 h-6 bg-muted/30 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-chart-2/60 rounded-full transition-all duration-500"
                            style={{ width: `${Math.max(p.pct, 2)}%` }}
                          />
                        </div>
                        <span className="text-xs font-mono w-12 text-right text-muted-foreground">{p.count} ({p.pct}%)</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Nudges */}
                {contentMix.nudges.length > 0 && (
                  <>
                    <Separator />
                    <div className="space-y-2">
                      {contentMix.nudges.map((nudge, i) => (
                        <div key={i} className="flex items-start gap-2 p-3 rounded-lg bg-chart-4/5 border border-chart-4/20">
                          <AlertCircle className="h-4 w-4 text-chart-4 shrink-0 mt-0.5" />
                          <p className="text-xs text-muted-foreground">{nudge}</p>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {contentMix.total === 0 && (
                  <div className="text-center py-8">
                    <BarChart3 className="h-10 w-10 text-muted-foreground/20 mx-auto mb-3" />
                    <p className="text-sm text-muted-foreground">No content in the last 30 days. Start creating to see your mix.</p>
                    <Button onClick={handleCreateNav} className="mt-3 font-display font-semibold min-h-[44px]">
                      Create Content <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Repurpose Dialog */}
      <Dialog open={!!repurposeTarget} onOpenChange={(open) => {
        if (!open) {
          setRepurposeTarget(null);
          openedRepurposeId.current = null;
          clearRepurposeQuery();
        }
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display">Repurpose Content</DialogTitle>
            <DialogDescription>
              Adapt "{(repurposeTarget?.content as any)?.title || "this content"}" for other platforms
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {!intelligenceReady && (
              <div className="flex flex-col gap-3 rounded-lg border border-warning/30 bg-warning/5 p-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-muted-foreground">Repurposing requires an enabled intelligence provider that has passed its connection test.</p>
                <Button variant="outline" size="sm" onClick={() => setLocation("/settings/integrations")} className="shrink-0">
                  <Settings2 className="mr-2 h-3.5 w-3.5" /> Configure
                </Button>
              </div>
            )}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Select target platforms</Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {PLATFORMS.filter(p => p !== repurposeTarget?.platform).map(p => (
                  <label
                    key={p}
                    className={`flex items-center gap-2 p-3 rounded-lg border cursor-pointer transition-all min-h-[44px] ${
                      repurposePlatforms.includes(p) ? "border-primary bg-primary/10" : "border-border/50 hover:border-primary/30"
                    }`}
                  >
                    <Checkbox
                      checked={repurposePlatforms.includes(p)}
                      onCheckedChange={() => toggleRepurposePlatform(p)}
                    />
                    <span className="text-sm capitalize">{p}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between p-3 rounded-lg border border-border/50 min-h-[56px]">
              <div className="flex items-center gap-2">
                <ImageIcon className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">Include Images</p>
                  <p className="text-xs text-muted-foreground">
                    {imageReady
                      ? repurposePlatforms.length > 0
                        ? `Requests ${repurposePlatforms.map(target => `${getPlatformImageFormat(target).label} (${getPlatformImageFormat(target).aspectRatio})`).join(", ")}. Final pixels depend on your provider.`
                        : "Select target platforms to see their requested formats. Final pixels depend on your provider."
                      : "Save and test an image provider in Settings to enable this option."}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                {!imageReady && (
                  <Button variant="link" size="sm" onClick={() => setLocation("/settings/integrations")} className="h-auto px-1 text-xs">
                    Settings
                  </Button>
                )}
                <Switch checked={repurposeImages} onCheckedChange={setRepurposeImages} disabled={!imageReady} />
              </div>
            </div>

            <Button
              className="w-full font-display font-semibold min-h-[44px]"
              disabled={repurposePlatforms.length === 0 || repurposeMut.isPending || !intelligenceReady}
              onClick={handleRepurpose}
            >
              {repurposeMut.isPending ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Repurposing...</>
              ) : (
                <>Repurpose to {repurposePlatforms.length} Platform{repurposePlatforms.length !== 1 ? "s" : ""}</>
              )}
            </Button>
            <p className="text-center text-xs leading-relaxed text-muted-foreground">
              Repurposing sends one intelligence request per selected platform{repurposeImages ? ", plus one image request per platform" : ""}. Your providers bill these requests directly.
            </p>
          </div>
        </DialogContent>
      </Dialog>

      {/* Individual Review Dialog for Repurposed Pieces */}
      <Dialog open={!!reviewTarget} onOpenChange={(open) => { if (!open) setReviewTarget(null); }}>
        <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display">Review Repurposed Content</DialogTitle>
            <DialogDescription>
              Review and approve this repurposed piece for {reviewTarget?.platform}
            </DialogDescription>
          </DialogHeader>
          {reviewTarget && (() => {
            const rc = reviewTarget.content as any;
            return (
              <div className="space-y-4 py-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="secondary" className="text-xs capitalize">{reviewTarget.platform}</Badge>
                  <Badge variant="outline" className="text-xs">{reviewTarget.contentType}</Badge>
                  <Badge variant="outline" className="text-xs border-chart-2/30 text-chart-2">
                    <GitBranch className="h-3 w-3 mr-1" /> Repurposed
                  </Badge>
                </div>

                {rc?.hook && (
                  <div className="p-3 rounded-lg bg-primary/5 border border-primary/20">
                    <p className="text-xs font-medium text-primary mb-1">Hook</p>
                    <p className="text-sm">{rc.hook}</p>
                  </div>
                )}

                <div className="prose prose-invert prose-sm max-w-none">
                  <SafeMarkdown>{rc?.body || ""}</SafeMarkdown>
                </div>

                {rc?.hashtags?.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {rc.hashtags.map((tag: string, i: number) => (
                      <Badge key={i} variant="secondary" className="text-xs">{tag.startsWith("#") ? tag : `#${tag}`}</Badge>
                    ))}
                  </div>
                )}

                {reviewTarget.imageUrl && (
                  <div className="rounded-lg overflow-hidden border border-border/50">
                    <img src={reviewTarget.imageUrl} alt="Generated" className="w-full" />
                    {reviewTarget.imageFormat && (
                      <div className="bg-muted/50 px-3 py-2 text-[11px] text-muted-foreground">
                        <span>{reviewTarget.imageFormat.label} · requested {reviewTarget.imageFormat.aspectRatio}</span>
                        <span className="mt-0.5 block">Final pixels are set by the image provider.</span>
                      </div>
                    )}
                  </div>
                )}

                <div className="flex gap-2 pt-2">
                  <Button
                    className="flex-1 font-display font-semibold min-h-[44px]"
                    onClick={async () => {
                      try {
                        await archiveMut.mutateAsync({ outputId: reviewTarget.id, status: "approved" });
                        toast.success("Content approved");
                        setReviewTarget(null);
                        refetch();
                      } catch (e: any) { toast.error(e.message); }
                    }}
                    disabled={archiveMut.isPending}
                  >
                    Approve
                  </Button>
                  <Button
                    variant="outline"
                    className="min-h-[44px]"
                    onClick={() => {
                      handleCopy(rc);
                      setReviewTarget(null);
                    }}
                  >
                    <Copy className="h-4 w-4 mr-1" /> Copy
                  </Button>
                  <Button
                    variant="outline"
                    className="min-h-[44px] text-destructive"
                    onClick={async () => {
                      try {
                        await archiveMut.mutateAsync({ outputId: reviewTarget.id, status: "archived" });
                        toast.success("Content archived");
                        setReviewTarget(null);
                        refetch();
                      } catch (e: any) { toast.error(e.message); }
                    }}
                    disabled={archiveMut.isPending}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
