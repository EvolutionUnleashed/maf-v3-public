import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import Dashboard from "./pages/Dashboard";
import BuildPage from "./pages/BuildPage";
import CreatePage from "./pages/CreatePage";
import LibraryPage from "./pages/LibraryPage";
import IdeasPage from "./pages/IdeasPage";
import SettingsPage from "./pages/SettingsPage";
import SetupPage from "./pages/SetupPage";
import { useEffect } from "react";
import { useLocation } from "wouter";

function ScrollToTop() {
  const [location] = useLocation();
  useEffect(() => {
    if (!window.location.hash) {
      window.scrollTo(0, 0);
    }
  }, [location]);
  return null;
}

function DesktopModeMarker() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("desktop") === "1") {
      window.localStorage.setItem("maf-desktop", "1");
    }
  }, []);
  return null;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/dashboard" component={Dashboard} />
      <Route path="/setup" component={SetupPage} />
      <Route path="/build/:section?/:step?" component={BuildPage} />
      <Route path="/create" component={CreatePage} />
      <Route path="/library" component={LibraryPage} />
      <Route path="/ideas" component={IdeasPage} />
      <Route path="/settings/integrations" component={SettingsPage} />
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark" switchable>
        <TooltipProvider>
          <Toaster />
          <DesktopModeMarker />
          <ScrollToTop />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
