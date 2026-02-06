import { useState, useEffect } from "react";
import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/lib/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ProjectProvider, useProject } from "@/lib/project-context";
import { ProjectSelector } from "@/components/project-selector";
import { LoginScreen } from "@/components/login-screen";
import { HelpModal } from "@/components/help-modal";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/dashboard";
import ManuscriptPage from "@/pages/manuscript";
import WorldBiblePage from "@/pages/world-bible";
import ThoughtLogsPage from "@/pages/thought-logs";
import ConfigPage from "@/pages/config";
import PseudonymsPage from "@/pages/pseudonyms";
import ImportPage from "@/pages/import";
import ExportPage from "@/pages/export";
import SeriesPage from "@/pages/series";
import QueuePage from "@/pages/queue";
import ReeditPage from "@/pages/reedit";
import CostsHistoryPage from "@/pages/costs-history";
import ComparePage from "@/pages/compare";
import GenerateGuidePage from "@/pages/generate-guide";
import GenerateSeriesGuidePage from "@/pages/generate-series-guide";
import CorrectedManuscriptsPage from "@/pages/corrected-manuscripts";
import StyleGuidesPage from "@/pages/style-guides";
import AuditorPage from "@/pages/auditor";
import WritingLessonsPage from "@/pages/writing-lessons";
import AutoCorrectorPage from "@/pages/auto-corrector";
import asdLogo from "@assets/ASD_1766442257801.png";

interface AuthStatus {
  authEnabled: boolean;
  isAuthenticated: boolean;
  isReplit: boolean;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/manuscript" component={ManuscriptPage} />
      <Route path="/translations" component={ImportPage} />
      <Route path="/export" component={ExportPage} />
      <Route path="/world-bible" component={WorldBiblePage} />
      <Route path="/thought-logs" component={ThoughtLogsPage} />
      <Route path="/pseudonyms" component={PseudonymsPage} />
      <Route path="/series" component={SeriesPage} />
      <Route path="/queue" component={QueuePage} />
      <Route path="/reedit" component={ReeditPage} />
      <Route path="/compare" component={ComparePage} />
      <Route path="/costs-history" component={CostsHistoryPage} />
      <Route path="/generate-guide" component={GenerateGuidePage} />
      <Route path="/generate-series-guide" component={GenerateSeriesGuidePage} />
      <Route path="/style-guides" component={StyleGuidesPage} />
      <Route path="/auditor" component={AuditorPage} />
      <Route path="/corrected-manuscripts" component={CorrectedManuscriptsPage} />
      <Route path="/writing-lessons" component={WritingLessonsPage} />
      <Route path="/auto-corrector" component={AutoCorrectorPage} />
      <Route path="/config" component={ConfigPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function GlobalProjectSelector() {
  const { projects, currentProject, setSelectedProjectId } = useProject();
  
  if (projects.length === 0) return null;
  
  return (
    <ProjectSelector
      projects={projects}
      selectedProjectId={currentProject?.id || null}
      onSelectProject={setSelectedProjectId}
    />
  );
}

function AuthenticatedApp() {
  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <ProjectProvider>
      <SidebarProvider style={style as React.CSSProperties}>
        <div className="flex h-screen w-full">
          <AppSidebar />
          <div className="flex flex-col flex-1 min-w-0">
            <header className="flex items-center justify-between gap-4 p-3 border-b shrink-0 sticky top-0 z-50 bg-background">
              <SidebarTrigger data-testid="button-sidebar-toggle" />
              <div className="flex items-center gap-3">
                <GlobalProjectSelector />
                <HelpModal />
                <ThemeToggle />
              </div>
            </header>
            <main className="flex-1 overflow-auto">
              <Router />
            </main>
            <footer className="flex items-center justify-center gap-2 px-3 py-1.5 border-t text-xs text-muted-foreground shrink-0">
              <img src={asdLogo} alt="ASD" className="h-4 w-auto" />
              <span>&copy; {new Date().getFullYear()} Atreyu Servicios Digitales</span>
            </footer>
          </div>
        </div>
      </SidebarProvider>
      <Toaster />
    </ProjectProvider>
  );
}

function AuthWrapper() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  
  const { data: authStatus, isLoading } = useQuery<AuthStatus>({
    queryKey: ["/api/auth/status"],
    retry: false,
  });

  useEffect(() => {
    if (authStatus) {
      if (!authStatus.authEnabled) {
        setIsAuthenticated(true);
      } else {
        setIsAuthenticated(authStatus.isAuthenticated);
      }
    }
  }, [authStatus]);

  const handleLoginSuccess = () => {
    setIsAuthenticated(true);
  };

  if (isLoading || isAuthenticated === null) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Cargando...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginScreen onLoginSuccess={handleLoginSuccess} />;
  }

  return <AuthenticatedApp />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <AuthWrapper />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
