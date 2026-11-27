import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useTheme } from "@/contexts/ThemeContext";
import {
  ArrowRight,
  Brain,
  CheckCircle2,
  Database,
  FileText,
  Globe2,
  ImageIcon,
  Layers3,
  Lightbulb,
  Menu,
  Moon,
  Palette,
  PenTool,
  Search,
  Sparkles,
  Sun,
  Target,
  Zap,
} from "lucide-react";
import { useEffect, useRef } from "react";
import { useLocation } from "wouter";

function Reveal({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        element.classList.add("revealed");
        observer.unobserve(element);
      },
      { threshold: 0.08 },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className={`section-reveal ${className}`}>
      {children}
    </div>
  );
}

const workflow = [
  {
    number: "01",
    title: "Install and open MAF V3",
    description: "The desktop app creates its private local workspace automatically. No database or command line is required.",
  },
  {
    number: "02",
    title: "Connect intelligence",
    description: "Add your own OpenAI, Anthropic, Gemini, OpenRouter, or compatible provider key.",
  },
  {
    number: "03",
    title: "Complete BUILD",
    description: "Capture your market, offer, brand voice, and content strategy once.",
  },
  {
    number: "04",
    title: "Create with context",
    description: "Generate, save, and repurpose content from the strategy in your workspace.",
  },
];

const integrationGroups = [
  {
    icon: Brain,
    title: "Intelligence",
    description: "Use an OpenAI-compatible provider, Anthropic, or Gemini for strategy and writing.",
  },
  {
    icon: Search,
    title: "Web search",
    description: "Connect Tavily when research benefits from current sources and market context.",
  },
  {
    icon: ImageIcon,
    title: "Image generation",
    description: "Use an OpenAI-compatible image provider or Gemini for visual assets.",
  },
];

export default function Home() {
  const [, setLocation] = useLocation();
  const { theme, toggleTheme } = useTheme();

  const openWorkspace = () => setLocation("/setup");
  const navLinks = [
    { href: "#how-it-works", label: "How it works" },
    { href: "#features", label: "Features" },
    { href: "/setup", label: "Setup" },
    { href: "#integrations", label: "Integrations" },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <nav className="fixed inset-x-0 top-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur-xl">
        <div className="container flex h-14 items-center justify-between">
          <a href="/" className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary">
              <Zap className="h-3.5 w-3.5 text-primary-foreground" />
            </span>
            <span className="text-sm font-bold tracking-tight">MAF V3</span>
          </a>

          <div className="hidden items-center gap-7 md:flex">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="text-[13px] font-medium text-foreground/65 transition-colors hover:text-foreground"
              >
                {link.label}
              </a>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleTheme}
              aria-label="Toggle colour theme"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-foreground/65 transition-colors hover:bg-accent hover:text-foreground"
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <Button
              size="sm"
              onClick={openWorkspace}
              className="hidden h-8 rounded-lg px-4 text-xs font-semibold md:flex"
            >
              Set up workspace <ArrowRight className="ml-1.5 h-3 w-3" />
            </Button>

            <Sheet>
              <SheetTrigger asChild>
                <button
                  type="button"
                  aria-label="Open navigation"
                  className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-accent md:hidden"
                >
                  <Menu className="h-4 w-4" />
                </button>
              </SheetTrigger>
              <SheetContent side="right" className="w-72">
                <div className="mt-8 flex flex-col gap-1">
                  {navLinks.map((link) => (
                    <SheetClose asChild key={link.href}>
                      <a
                        href={link.href}
                        className="rounded-lg px-4 py-3 text-sm font-medium transition-colors hover:bg-accent"
                      >
                        {link.label}
                      </a>
                    </SheetClose>
                  ))}
                  <div className="my-4 border-t border-border" />
                  <SheetClose asChild>
                    <Button onClick={openWorkspace} className="w-full font-semibold">
                      Set up workspace <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                  </SheetClose>
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </nav>

      <main>
        <section className="relative overflow-hidden pb-24 pt-32 sm:pt-36 md:pb-32 md:pt-44">
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute inset-0 bg-gradient-to-b from-primary/[0.055] via-transparent to-transparent" />
            <div className="absolute left-1/2 top-20 h-80 w-80 -translate-x-1/2 rounded-full bg-primary/[0.07] blur-3xl" />
          </div>

          <div className="container relative">
            <div className="mx-auto max-w-[54rem] text-center">
              <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/60 px-4 py-1.5 backdrop-blur-sm">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                <span className="text-xs font-bold uppercase tracking-[0.1em] text-foreground/75">
                  Bring your own AI
                </span>
              </div>

              <h1 className="mb-6 text-[2.6rem] font-extrabold leading-[1.06] tracking-[-0.045em] sm:text-[3.35rem] md:text-[4.35rem] lg:text-[5rem]">
                Turn your strategy into a{" "}
                <span className="gradient-text">working content engine</span>
              </h1>
              <p className="mx-auto mb-10 max-w-2xl text-lg font-medium leading-relaxed text-foreground/75 md:text-xl">
                MAF V3 learns your market, offer, voice, and content strategy. Connect the AI services you prefer, then create grounded content without rebuilding the context each time.
              </p>

              <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
                <Button
                  size="lg"
                  onClick={openWorkspace}
                  className="h-13 w-full rounded-xl px-8 text-[15px] font-bold shadow-lg shadow-primary/15 sm:w-auto"
                >
                  Set up MAF V3 <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  onClick={() => document.getElementById("how-it-works")?.scrollIntoView({ behavior: "smooth" })}
                  className="h-13 w-full rounded-xl border-border/60 bg-transparent px-8 text-[15px] font-semibold sm:w-auto"
                >
                  See the workflow
                </Button>
              </div>
            </div>

            <div className="mx-auto mt-20 grid max-w-4xl grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border/40 md:grid-cols-4">
              {[
                { value: "4", label: "Foundation areas" },
                { value: "6", label: "Content channels" },
                { value: "3", label: "Provider capabilities" },
                { value: "1", label: "Connected workspace" },
              ].map((stat) => (
                <div key={stat.label} className="bg-card/60 px-3 py-6 text-center backdrop-blur-sm md:py-8">
                  <p className="text-3xl font-extrabold tracking-tight md:text-4xl">{stat.value}</p>
                  <p className="mt-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-foreground/50 md:text-[11px]">
                    {stat.label}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <Reveal>
          <section id="features" className="border-t border-border/30 py-24 md:py-32">
            <div className="container">
              <div className="mx-auto mb-14 max-w-2xl text-center">
                <p className="mb-4 text-xs font-bold uppercase tracking-[0.14em] text-primary">Strategy first</p>
                <h2 className="mb-5 text-3xl font-extrabold leading-tight tracking-[-0.03em] md:text-[2.75rem]">
                  One foundation for every piece you create
                </h2>
                <p className="text-lg leading-relaxed text-foreground/70">
                  Your approved BUILD work becomes the shared context for ideas, drafts, images, and repurposed content.
                </p>
              </div>

              <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
                {[
                  {
                    icon: Target,
                    title: "Grounded in your business",
                    description: "Market research and offer positioning guide every output, so the work stays specific.",
                  },
                  {
                    icon: Palette,
                    title: "Consistent with your voice",
                    description: "Approved brand guidance shapes tone, vocabulary, structure, and visual direction.",
                  },
                  {
                    icon: Layers3,
                    title: "Ready for each channel",
                    description: "Create for LinkedIn, Facebook, Instagram, X, email, and blogs from the same core strategy.",
                  },
                  {
                    icon: Lightbulb,
                    title: "Ideas when you need them",
                    description: "Generate topics, angles, and hooks from your approved BUILD foundation before you start a draft.",
                  },
                ].map((feature) => (
                  <div
                    key={feature.title}
                    className="premium-card rounded-2xl border border-border/40 bg-card/45 p-7"
                  >
                    <span className="mb-6 flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10">
                      <feature.icon className="h-5 w-5 text-primary" />
                    </span>
                    <h3 className="mb-3 text-lg font-bold">{feature.title}</h3>
                    <p className="text-[15px] leading-relaxed text-foreground/65">{feature.description}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </Reveal>

        <Reveal>
          <section id="how-it-works" className="border-t border-border/30 bg-card/20 py-24 md:py-32">
            <div className="container">
              <div className="grid gap-14 lg:grid-cols-[0.8fr_1.2fr] lg:items-start">
                <div className="lg:sticky lg:top-28">
                  <p className="mb-4 text-xs font-bold uppercase tracking-[0.14em] text-primary">The workflow</p>
                  <h2 className="mb-5 text-3xl font-extrabold leading-tight tracking-[-0.03em] md:text-[2.75rem]">
                    Build once. Create from a clear point of view.
                  </h2>
                  <p className="max-w-lg text-lg leading-relaxed text-foreground/70">
                    MAF keeps strategy upstream. Each new output starts with decisions you have already reviewed and approved.
                  </p>
                </div>

                <div className="space-y-3">
                  {workflow.map((step) => (
                    <div
                      key={step.number}
                      className="flex gap-5 rounded-2xl border border-border/40 bg-card/55 p-6 sm:p-7"
                    >
                      <span className="font-mono text-sm font-bold text-primary">{step.number}</span>
                      <div>
                        <h3 className="mb-2 text-lg font-bold">{step.title}</h3>
                        <p className="text-[15px] leading-relaxed text-foreground/65">{step.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>
        </Reveal>

        <Reveal>
          <section id="integrations" className="border-t border-border/30 py-24 md:py-32">
            <div className="container">
              <div className="mx-auto mb-14 max-w-2xl text-center">
                <p className="mb-4 text-xs font-bold uppercase tracking-[0.14em] text-primary">Your providers</p>
                <h2 className="mb-5 text-3xl font-extrabold leading-tight tracking-[-0.03em] md:text-[2.75rem]">
                  Connect the services that fit your stack
                </h2>
                <p className="text-lg leading-relaxed text-foreground/70">
                  Configure provider details in one place. MAF uses each connection only for the capability you enable.
                </p>
              </div>

              <div className="grid gap-5 md:grid-cols-3">
                {integrationGroups.map((group) => (
                  <div key={group.title} className="rounded-2xl border border-border/40 bg-card/45 p-7">
                    <div className="mb-6 flex items-center justify-between">
                      <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10">
                        <group.icon className="h-5 w-5 text-primary" />
                      </span>
                      <CheckCircle2 className="h-4 w-4 text-success" />
                    </div>
                    <h3 className="mb-3 text-lg font-bold">{group.title}</h3>
                    <p className="text-[15px] leading-relaxed text-foreground/65">{group.description}</p>
                  </div>
                ))}
              </div>

              <div className="mx-auto mt-8 grid max-w-3xl gap-3 sm:grid-cols-3">
                {[
                  { icon: Database, label: "Saved configuration" },
                  { icon: Globe2, label: "Custom base URLs" },
                  { icon: FileText, label: "Environment support" },
                ].map((item) => (
                  <div key={item.label} className="flex items-center justify-center gap-2 rounded-xl border border-border/30 px-4 py-3 text-sm text-foreground/65">
                    <item.icon className="h-4 w-4 text-primary" />
                    {item.label}
                  </div>
                ))}
              </div>
            </div>
          </section>
        </Reveal>

        <section className="border-t border-border/30 py-24 md:py-32">
          <div className="container">
            <div className="relative mx-auto max-w-4xl overflow-hidden rounded-3xl border border-primary/20 bg-gradient-to-br from-primary/[0.1] via-primary/[0.04] to-transparent px-6 py-14 text-center sm:px-12 md:py-20">
              <div className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-primary/10 blur-3xl" />
              <PenTool className="relative mx-auto mb-6 h-7 w-7 text-primary" />
              <h2 className="relative mb-5 text-3xl font-extrabold tracking-[-0.03em] md:text-4xl">
                Your strategy is ready to do more work
              </h2>
              <p className="relative mx-auto mb-8 max-w-xl text-lg leading-relaxed text-foreground/70">
                Follow the guided setup, connect your intelligence provider, and begin your BUILD foundation.
              </p>
              <Button size="lg" onClick={openWorkspace} className="relative h-12 rounded-xl px-8 font-bold">
                Start setup <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border/40 py-8">
        <div className="container flex flex-col items-center justify-between gap-3 sm:flex-row">
          <div className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary">
              <Zap className="h-3.5 w-3.5 text-primary-foreground" />
            </span>
            <span className="text-sm font-bold">MAF V3</span>
          </div>
          <p className="text-xs text-foreground/45">Marketing Accelerator Framework</p>
        </div>
      </footer>
    </div>
  );
}
