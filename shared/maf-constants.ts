// ─── BUILD Section & Step Definitions ────────────────────────────────
export const BUILD_SECTIONS = ["research", "offer", "brand", "strategy"] as const;
export type BuildSectionKey = (typeof BUILD_SECTIONS)[number];

export const BUILD_STEPS: Record<BuildSectionKey, { key: string; label: string; hasIntake: boolean; hasAI: boolean }[]> = {
  research: [
    { key: "1a", label: "Market Intelligence", hasIntake: true, hasAI: true },
    { key: "1b", label: "Target Audience", hasIntake: true, hasAI: true },
  ],
  offer: [
    { key: "2a", label: "Offer Capture", hasIntake: true, hasAI: false },
    { key: "2b", label: "Aligned Offer & Differentiators", hasIntake: false, hasAI: true },
    { key: "2c", label: "UVP with Focus Group", hasIntake: false, hasAI: true },
  ],
  brand: [
    { key: "3a", label: "Mission & Values", hasIntake: true, hasAI: true },
    { key: "3b", label: "Brand Voice", hasIntake: false, hasAI: true },
    { key: "3c", label: "Visual Identity", hasIntake: false, hasAI: true },
  ],
  strategy: [
    { key: "4a", label: "Customer Journey Map", hasIntake: false, hasAI: true },
    { key: "4b", label: "Content Strategy", hasIntake: false, hasAI: true },
  ],
};

export const SECTION_LABELS: Record<BuildSectionKey, string> = {
  research: "Research",
  offer: "Offer",
  brand: "Brand",
  strategy: "Strategy",
};

export type StepStatus = "locked" | "in_progress" | "intake_complete" | "generating" | "review" | "approved" | "amber";
export type SectionStatus = "locked" | "in_progress" | "approved" | "amber";

// ─── CREATE Constants ────────────────────────────────────────────────
export const PLATFORMS = ["facebook", "linkedin", "instagram", "twitter", "email", "blog"] as const;
export type Platform = (typeof PLATFORMS)[number];

export const CONTENT_TYPES = [
  { key: "entertainment", label: "Entertainment", tooltip: "Story-driven, identity-resonant content that delights" },
  { key: "nurture", label: "Nurture", tooltip: "Relationship-building, behind-the-scenes, narrative arc content" },
  { key: "educate", label: "Educate", tooltip: "Teaching, frameworks, structured insight" },
  { key: "sell", label: "Sell", tooltip: "Offer-focused content with contrast and urgency" },
  { key: "provoke", label: "Provoke", tooltip: "Challenger framing, pattern interruption, debate-driving" },
  { key: "story", label: "Story", tooltip: "Personal narrative, scene-driven, trust-building" },
] as const;
export type ContentType = (typeof CONTENT_TYPES)[number]["key"];

export const ANGLES = [
  "auto", "personal_story", "counterintuitive_take", "behind_the_curtain",
  "case_study", "industry_critique", "reframe_common_belief",
  "tactical_walkthrough", "prediction", "confession",
] as const;
export type Angle = (typeof ANGLES)[number];

export const ANGLE_LABELS: Record<string, string> = {
  auto: "Auto",
  personal_story: "Personal Story",
  counterintuitive_take: "Counterintuitive Take",
  behind_the_curtain: "Behind the Curtain",
  case_study: "Case Study",
  industry_critique: "Industry Critique",
  reframe_common_belief: "Reframe of Common Belief",
  tactical_walkthrough: "Tactical Walkthrough",
  prediction: "Prediction",
  confession: "Confession",
};

// ─── Platform Image Dimensions ───────────────────────────────────────
// Providers choose their final pixel dimensions. MAF records the requested
// composition and aspect ratio without claiming the returned file was resized.
export const IMAGE_ASPECT_RATIOS = ["1:1", "3:2", "2:3", "16:9", "9:16"] as const;
export type ImageAspectRatio = (typeof IMAGE_ASPECT_RATIOS)[number];
export type RequestedImageFormat = {
  label: string;
  aspectRatio: ImageAspectRatio;
};

export const PLATFORM_IMAGE_FORMATS: Record<Platform, RequestedImageFormat> = {
  facebook: { label: "Facebook landscape", aspectRatio: "16:9" },
  linkedin: { label: "LinkedIn landscape", aspectRatio: "16:9" },
  instagram: { label: "Instagram square", aspectRatio: "1:1" },
  twitter: { label: "X landscape", aspectRatio: "16:9" },
  email: { label: "Email header", aspectRatio: "3:2" },
  blog: { label: "Blog hero", aspectRatio: "16:9" },
};

export const DEFAULT_IMAGE_FORMAT: RequestedImageFormat = {
  label: "Landscape image",
  aspectRatio: "16:9",
};

export function getPlatformImageFormat(platform: string): RequestedImageFormat {
  return PLATFORM_IMAGE_FORMATS[platform as Platform] ?? DEFAULT_IMAGE_FORMAT;
}

// ─── Status Messages for AI Generation ───────────────────────────────
export const GENERATION_MESSAGES: Record<string, string[]> = {
  "1a": [
    "Reading your market context...",
    "Mapping market positioning...",
    "Identifying growth trends...",
    "Mapping strategic opportunities...",
    "Building your Market Intelligence document...",
  ],
  "1b": [
    "Processing audience data...",
    "Building demographic profiles...",
    "Mapping psychographic patterns...",
    "Synthesizing persona models...",
    "Finalizing your Target Market Summary...",
  ],
  "2b": [
    "Cross-referencing offers with market data...",
    "Identifying alignment opportunities...",
    "Extracting differentiators...",
    "Building your Aligned Offer document...",
  ],
  "2c": [
    "Drafting initial UVP...",
    "Assembling virtual focus group...",
    "Running focus group simulation...",
    "Refining UVP based on feedback...",
    "Finalizing your Aligned UVP...",
  ],
  "3a": [
    "Analyzing your brand foundations...",
    "Crafting mission statement...",
    "Defining value statements...",
    "Aligning with market positioning...",
  ],
  "3b": [
    "Analyzing upstream brand context...",
    "Defining personality traits...",
    "Mapping tone variations...",
    "Building lexicon guidelines...",
    "Finalizing Brand Voice document...",
  ],
  "3c": [
    "Generating visual concepts...",
    "Creating style variations...",
    "Rendering candidate images...",
  ],
  "4a": [
    "Mapping awareness stage...",
    "Defining interest touchpoints...",
    "Building desire triggers...",
    "Plotting action pathways...",
    "Finalizing Customer Journey Map...",
  ],
  "4b": [
    "Identifying content pillars...",
    "Analyzing platform fit...",
    "Calculating content type mix...",
    "Building your Content Strategy...",
  ],
};
