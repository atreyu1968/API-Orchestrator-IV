import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useProject } from "@/lib/project-context";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { 
  Microscope, 
  Play, 
  Loader2, 
  CheckCircle2, 
  XCircle, 
  AlertTriangle,
  Users,
  Palette,
  Clock,
  FileText,
  Trash2,
} from "lucide-react";

interface AuditIssue {
  location: string;
  description: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  suggestion: string;
}

interface AgentReport {
  agentType: 'CONTINUITY' | 'CHARACTER' | 'STYLE';
  overallScore: number;
  analysis: string;
  issues: AuditIssue[];
}

interface ManuscriptAudit {
  id: number;
  projectId: number;
  status: string;
  overallScore: number | null;
  criticalFlags: number | null;
  continuityReport: AgentReport | null;
  characterReport: AgentReport | null;
  styleReport: AgentReport | null;
  createdAt: string;
  completedAt: string | null;
  errorMessage: string | null;
}

function getSeverityColor(severity: string) {
  switch (severity) {
    case 'CRITICAL': return 'destructive';
    case 'HIGH': return 'destructive';
    case 'MEDIUM': return 'secondary';
    case 'LOW': return 'outline';
    default: return 'outline';
  }
}

function getAgentIcon(type: string) {
  switch (type) {
    case 'CONTINUITY': return <Clock className="h-4 w-4" />;
    case 'CHARACTER': return <Users className="h-4 w-4" />;
    case 'STYLE': return <Palette className="h-4 w-4" />;
    default: return <FileText className="h-4 w-4" />;
  }
}

function getAgentName(type: string) {
  switch (type) {
    case 'CONTINUITY': return 'Continuidad';
    case 'CHARACTER': return 'Personajes';
    case 'STYLE': return 'Estilo';
    default: return type;
  }
}

function AgentReportCard({ report, agentType }: { report: AgentReport; agentType: string }) {
  return (
    <Card data-testid={`card-report-${agentType.toLowerCase()}`}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {getAgentIcon(report.agentType)}
            <CardTitle className="text-lg" data-testid={`text-agent-title-${agentType.toLowerCase()}`}>
              {getAgentName(report.agentType)}
            </CardTitle>
          </div>
          <Badge 
            variant={report.overallScore >= 70 ? "default" : "destructive"}
            data-testid={`badge-score-${agentType.toLowerCase()}`}
          >
            {report.overallScore}/100
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground" data-testid={`text-analysis-${agentType.toLowerCase()}`}>
          {report.analysis}
        </p>
        
        {report.issues.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium" data-testid={`text-issues-count-${agentType.toLowerCase()}`}>
              Problemas detectados ({report.issues.length})
            </h4>
            <ScrollArea className="h-[300px]">
              <div className="space-y-2 pr-4">
                {report.issues.map((issue, idx) => (
                  <Card key={idx} className="p-3" data-testid={`card-issue-${agentType.toLowerCase()}-${idx}`}>
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <Badge 
                        variant={getSeverityColor(issue.severity) as any}
                        data-testid={`badge-severity-${agentType.toLowerCase()}-${idx}`}
                      >
                        {issue.severity}
                      </Badge>
                      <span className="text-xs text-muted-foreground" data-testid={`text-location-${agentType.toLowerCase()}-${idx}`}>
                        {issue.location}
                      </span>
                    </div>
                    <p className="text-sm mb-2" data-testid={`text-description-${agentType.toLowerCase()}-${idx}`}>
                      {issue.description}
                    </p>
                    <div className="text-xs text-muted-foreground bg-muted p-2 rounded" data-testid={`text-suggestion-${agentType.toLowerCase()}-${idx}`}>
                      <strong>Sugerencia:</strong> {issue.suggestion}
                    </div>
                  </Card>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}
        
        {report.issues.length === 0 && (
          <Alert data-testid={`alert-no-issues-${agentType.toLowerCase()}`}>
            <CheckCircle2 className="h-4 w-4" />
            <AlertTitle>Sin problemas</AlertTitle>
            <AlertDescription>
              No se detectaron problemas en esta área.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

export default function AuditorPage() {
  const { currentProject } = useProject();
  const { toast } = useToast();
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState<{ phase: string; message: string } | null>(null);
  const [currentAuditId, setCurrentAuditId] = useState<number | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  const { data: audits, refetch: refetchAudits } = useQuery<ManuscriptAudit[]>({
    queryKey: [`/api/projects/${currentProject?.id}/audits`],
    enabled: !!currentProject?.id,
  });

  const { data: currentAudit, refetch: refetchCurrentAudit } = useQuery<ManuscriptAudit>({
    queryKey: [`/api/audits/${currentAuditId}`],
    enabled: !!currentAuditId,
    refetchInterval: isRunning ? 3000 : false,
  });

  const startAuditMutation = useMutation({
    mutationFn: async () => {
      if (!currentProject?.id) throw new Error("No project selected");
      const res = await apiRequest("POST", `/api/projects/${currentProject.id}/start-audit`);
      return res.json();
    },
    onSuccess: (data: any) => {
      setCurrentAuditId(data.auditId);
      toast({
        title: "Auditoría iniciada",
        description: `Analizando ${data.stats.chapters} capítulos (${data.stats.words.toLocaleString()} palabras)`,
      });
      runAudit(data.auditId);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "No se pudo iniciar la auditoría",
        variant: "destructive",
      });
    },
  });

  const deleteAuditMutation = useMutation({
    mutationFn: async (auditId: number) => {
      const res = await apiRequest("DELETE", `/api/audits/${auditId}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", currentProject?.id, "audits"] });
      toast({
        title: "Auditoría eliminada",
        description: "La auditoría ha sido eliminada correctamente",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "No se pudo eliminar la auditoría",
        variant: "destructive",
      });
    },
  });

  const runAudit = (auditId: number) => {
    setIsRunning(true);
    setProgress({ phase: "starting", message: "Iniciando análisis..." });

    const eventSource = new EventSource(`/api/audits/${auditId}/run`);
    eventSourceRef.current = eventSource;

    eventSource.addEventListener("progress", (event) => {
      const data = JSON.parse(event.data);
      setProgress({ phase: data.phase, message: data.message });
    });

    eventSource.addEventListener("complete", (event) => {
      const data = JSON.parse(event.data);
      setIsRunning(false);
      setProgress(null);
      refetchAudits();
      refetchCurrentAudit();
      toast({
        title: "Auditoría completada",
        description: `Puntuación: ${data.overallScore}/100, ${data.criticalFlags} problemas críticos`,
      });
      eventSource.close();
      eventSourceRef.current = null;
    });

    eventSource.addEventListener("error", (event: any) => {
      try {
        const data = JSON.parse(event.data);
        toast({
          title: "Error en auditoría",
          description: data.message,
          variant: "destructive",
        });
      } catch {
        toast({
          title: "Error en auditoría",
          description: "Conexión perdida",
          variant: "destructive",
        });
      }
      setIsRunning(false);
      setProgress(null);
      eventSource.close();
      eventSourceRef.current = null;
    });

    eventSource.onerror = () => {
      setIsRunning(false);
      setProgress(null);
      eventSource.close();
      eventSourceRef.current = null;
    };
  };

  const latestAudit = audits?.[0];
  const displayAudit = currentAudit || latestAudit;

  if (!currentProject) {
    return (
      <div className="container mx-auto p-6" data-testid="container-no-project">
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Selecciona un proyecto</AlertTitle>
          <AlertDescription>
            Selecciona un proyecto desde el selector en la barra superior para usar el Auditor Literario.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6" data-testid="container-auditor">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-page-title">
            <Microscope className="h-6 w-6" />
            Auditor Literario
          </h1>
          <p className="text-muted-foreground" data-testid="text-page-description">
            Análisis profundo con Gemini Context Caching - 3 agentes especializados en paralelo
          </p>
        </div>
        
        <Button
          size="lg"
          onClick={() => startAuditMutation.mutate()}
          disabled={isRunning || startAuditMutation.isPending}
          data-testid="button-start-audit"
        >
          {isRunning ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Analizando...
            </>
          ) : (
            <>
              <Play className="mr-2 h-4 w-4" />
              Iniciar Auditoría
            </>
          )}
        </Button>
      </div>

      {isRunning && progress && (
        <Card data-testid="card-progress">
          <CardContent className="pt-6">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="font-medium" data-testid="text-progress-message">{progress.message}</span>
              </div>
              <Progress 
                value={
                  progress.phase === "caching" ? 30 :
                  progress.phase === "caching_complete" ? 40 :
                  progress.phase === "analyzing" ? 70 :
                  100
                } 
                data-testid="progress-bar"
              />
            </div>
          </CardContent>
        </Card>
      )}

      {displayAudit && displayAudit.status === "completed" && (
        <div className="space-y-6" data-testid="container-results">
          <Card data-testid="card-summary">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle data-testid="text-summary-title">Resumen de Auditoría</CardTitle>
                  <CardDescription data-testid="text-completed-date">
                    Análisis completado el {new Date(displayAudit.completedAt!).toLocaleString()}
                  </CardDescription>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-center">
                    <div className="text-3xl font-bold" data-testid="text-overall-score">{displayAudit.overallScore}</div>
                    <div className="text-sm text-muted-foreground">/100</div>
                  </div>
                  {displayAudit.criticalFlags! > 0 && (
                    <Badge variant="destructive" className="text-lg px-3 py-1" data-testid="badge-critical-flags">
                      {displayAudit.criticalFlags} críticos
                    </Badge>
                  )}
                </div>
              </div>
            </CardHeader>
          </Card>

          <Tabs defaultValue="continuity" data-testid="tabs-reports">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="continuity" className="flex items-center gap-2" data-testid="tab-continuity">
                <Clock className="h-4 w-4" />
                Continuidad
              </TabsTrigger>
              <TabsTrigger value="character" className="flex items-center gap-2" data-testid="tab-character">
                <Users className="h-4 w-4" />
                Personajes
              </TabsTrigger>
              <TabsTrigger value="style" className="flex items-center gap-2" data-testid="tab-style">
                <Palette className="h-4 w-4" />
                Estilo
              </TabsTrigger>
            </TabsList>
            
            <TabsContent value="continuity">
              {displayAudit.continuityReport && (
                <AgentReportCard report={displayAudit.continuityReport} agentType="continuity" />
              )}
            </TabsContent>
            
            <TabsContent value="character">
              {displayAudit.characterReport && (
                <AgentReportCard report={displayAudit.characterReport} agentType="character" />
              )}
            </TabsContent>
            
            <TabsContent value="style">
              {displayAudit.styleReport && (
                <AgentReportCard report={displayAudit.styleReport} agentType="style" />
              )}
            </TabsContent>
          </Tabs>
        </div>
      )}

      {displayAudit && displayAudit.status === "error" && (
        <Alert variant="destructive" data-testid="alert-error">
          <XCircle className="h-4 w-4" />
          <AlertTitle>Error en auditoría</AlertTitle>
          <AlertDescription data-testid="text-error-message">{displayAudit.errorMessage}</AlertDescription>
        </Alert>
      )}

      {!isRunning && !displayAudit && (
        <Card className="border-dashed" data-testid="card-empty-state">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Microscope className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2" data-testid="text-empty-title">Sin auditorías previas</h3>
            <p className="text-muted-foreground text-center max-w-md mb-4" data-testid="text-empty-description">
              El Auditor Literario analiza tu manuscrito completo usando 3 agentes especializados:
              Continuidad, Personajes y Estilo. Cada agente evalúa diferentes aspectos de tu obra.
            </p>
            <Button 
              onClick={() => startAuditMutation.mutate()} 
              disabled={startAuditMutation.isPending}
              data-testid="button-start-first-audit"
            >
              <Play className="mr-2 h-4 w-4" />
              Iniciar Primera Auditoría
            </Button>
          </CardContent>
        </Card>
      )}

      {audits && audits.length > 1 && (
        <Card data-testid="card-previous-audits">
          <CardHeader>
            <CardTitle data-testid="text-previous-audits-title">Auditorías Anteriores</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {audits.slice(1).map((audit) => (
                <div 
                  key={audit.id} 
                  className="flex items-center justify-between p-3 rounded-lg border cursor-pointer hover-elevate"
                  data-testid={`row-audit-${audit.id}`}
                >
                  <div 
                    className="flex items-center gap-3 flex-1"
                    onClick={() => setCurrentAuditId(audit.id)}
                  >
                    {audit.status === "completed" ? (
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                    ) : (
                      <XCircle className="h-4 w-4 text-red-500" />
                    )}
                    <span data-testid={`text-audit-date-${audit.id}`}>
                      {new Date(audit.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {audit.overallScore !== null && (
                      <Badge 
                        variant={audit.overallScore >= 70 ? "default" : "secondary"}
                        data-testid={`badge-audit-score-${audit.id}`}
                      >
                        {audit.overallScore}/100
                      </Badge>
                    )}
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteAuditMutation.mutate(audit.id);
                      }}
                      disabled={deleteAuditMutation.isPending}
                      data-testid={`button-delete-audit-${audit.id}`}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
