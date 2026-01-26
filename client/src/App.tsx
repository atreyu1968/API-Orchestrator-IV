import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/lib/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ProjectProvider, useProject } from "@/lib/project-context";
import { ProjectSelector } from "@/components/project-selector";
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
import asdLogo from "@assets/ASD_1766442257801.png";

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
      <Route path="/costs-history" component={CostsHistoryPage} />
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

function App() {
  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <ProjectProvider>
            <SidebarProvider style={style as React.CSSProperties}>
              <div className="flex h-screen w-full">
                <AppSidebar />
                <div className="flex flex-col flex-1 min-w-0">
                  <header className="flex items-center justify-between gap-4 p-3 border-b shrink-0 sticky top-0 z-50 bg-background">
                    <SidebarTrigger data-testid="button-sidebar-toggle" />
                    <div className="flex items-center gap-3">
                      <GlobalProjectSelector />
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
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
