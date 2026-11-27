import { cn } from "@/lib/utils";
import { AlertTriangle, RotateCcw, Settings2 } from "lucide-react";
import { Component, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center min-h-screen p-8 bg-background">
          <div className="flex flex-col items-center w-full max-w-2xl p-8">
            <AlertTriangle
              size={48}
              className="text-destructive mb-6 flex-shrink-0"
            />

            <h2 className="text-xl mb-3">MAF V3 hit an unexpected problem</h2>
            <p className="mb-6 max-w-lg text-center text-sm leading-relaxed text-muted-foreground">
              Reload the app first. If it happens again, open the setup page or choose
              <span className="font-medium text-foreground"> File &gt; Export diagnostics</span> and share that report with support.
            </p>

            <div className="flex flex-wrap justify-center gap-3">
              <button
                onClick={() => window.location.reload()}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-lg",
                  "bg-primary text-primary-foreground",
                  "hover:opacity-90 cursor-pointer"
                )}
              >
                <RotateCcw size={16} />
                Reload MAF V3
              </button>
              <button
                onClick={() => window.location.assign("/setup")}
                className="flex cursor-pointer items-center gap-2 rounded-lg border border-border px-4 py-2 hover:bg-muted"
              >
                <Settings2 size={16} />
                Open setup
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
