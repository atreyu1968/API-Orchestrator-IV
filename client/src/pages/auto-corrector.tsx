import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useProject } from "@/lib/project-context";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Zap,
  Play,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Square,
  Trash2,
  RotateCcw,
  Clock,
  Target,
  Activity,
  TrendingUp,
} from "lucide-react";

interface AutoCorrectionCycle {
  cycle: number;
  auditId: number;
  manuscriptId?: number;
  overallScore: number;
  criticalIssues: number;
  totalIssues: number;
  issuesFixed: number;
  structuralChanges: number;
  startedAt: string;
  completedAt?: string;
  result: string;
}

interface AutoCorrectionLogEntry {
  timestamp: string;
  phase: string;
  message: string;
}

interface AutoCorrectionRun {
  id: number;
  projectId: number;
  status: string;
  currentCycle: number;
  maxCycles: number;
  targetScore: number;
  maxCriticalIssues: number;
  currentAuditId: number | null;
  currentManuscriptId: number | null;
  cycleHistory: AutoCorrectionCycle[];
  progressLog: AutoCorrectionLogEntry[];
  finalScore: number | null;
  finalCriticalIssues: number | null;
  totalIssuesFixed: number | null;
  totalStructuralChanges: number | null;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
}

function getStatusBadge(status: string) {
  switch (status) {
    case 'pending': return <Badge variant="secondary" data-testid="badge-status-pending">Pendiente</Badge>;
    case 'auditing': return <Badge variant="default" data-testid="badge-status-auditing"><Loader2 className="h-3 w-3 mr-1 animate-spin" />Auditando</Badge>;
    case 'correcting': return <Badge variant="default" data-testid="badge-status-correcting"><Loader2 className="h-3 w-3 mr-1 animate-spin" />Corrigiendo</Badge>;
    case 'approving': return <Badge variant="default" data-testid="badge-status-approving"><Loader2 className="h-3 w-3 mr-1 animate-spin" />Aprobando</Badge>;
    case 'finalizing': return <Badge variant="default" data-testid="badge-status-finalizing"><Loader2 className="h-3 w-3 mr-1 animate-spin" />Finalizando</Badge>;
    case 're_auditing': return <Badge variant="default" data-testid="badge-status-reauditing"><Loader2 className="h-3 w-3 mr-1 animate-spin" />Re-auditando</Badge>;
    case 'completed': return <Badge variant="default" data-testid="badge-status-completed"><CheckCircle2 className="h-3 w-3 mr-1" />Completado</Badge>;
    case 'failed': return <Badge variant="destructive" data-testid="badge-status-failed"><XCircle className="h-3 w-3 mr-1" />Error</Badge>;
    case 'cancelled': return <Badge variant="secondary" data-testid="badge-status-cancelled"><Square className="h-3 w-3 mr-1" />Cancelado</Badge>;
    default: return <Badge variant="outline">{status}</Badge>;
  }
}

function getCycleResultLabel(result: string) {
  switch (result) {
    case 'threshold_met': return 'Umbral alcanzado';
    case 'corrected': return 'Corregido';
    case 'no_issues': return 'Sin issues';
    case 'max_cycles': return 'Max ciclos';
    case 'error': return 'Error';
    case 'cancelled': return 'Cancelado';
    default: return result;
  }
}

function isActiveStatus(status: string): boolean {
  return ['pending', 'auditing', 'correcting', 'approving', 'finalizing', 're_auditing'].includes(status);
}

export default function AutoCorrectorPage() {
  const { currentProject } = useProject();
  const { toast } = useToast();
  const [maxCycles, setMaxCycles] = useState(3);
  const [targetScore, setTargetScore] = useState(85);
  const [activeRunId, setActiveRunId] = useState<number | null>(null);
  const [streamData, setStreamData] = useState<any>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  const { data: runs, isLoading } = useQuery<AutoCorrectionRun[]>({
    queryKey: ['/api/projects', currentProject?.id, 'auto-correct/runs'],
    queryFn: async () => {
      if (!currentProject?.id) return [];
      const res = await fetch(`/api/projects/${currentProject.id}/auto-correct/runs`);
      if (!res.ok) {
        throw new Error(`Failed to fetch runs: ${res.status}`);
      }
      const contentType = res.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        throw new Error('Invalid response from server');
      }
      return res.json();
    },
    enabled: !!currentProject?.id,
    refetchInterval: activeRunId ? 5000 : false,
  });

  useEffect(() => {
    if (runs && runs.length > 0) {
      const active = runs.find(r => isActiveStatus(r.status));
      if (active) {
        setActiveRunId(active.id);
      }
    }
  }, [runs]);

  useEffect(() => {
    if (!activeRunId) return;

    const es = new EventSource(`/api/auto-correct/runs/${activeRunId}/stream`);
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        setStreamData(data);

        if (['completed', 'failed', 'cancelled'].includes(data.status)) {
          es.close();
          queryClient.invalidateQueries({ queryKey: ['/api/projects', currentProject?.id, 'auto-correct/runs'] });
          setActiveRunId(null);
          setStreamData(null);
        }
      } catch (e) {}
    };

    es.onerror = () => {
      es.close();
    };

    return () => {
      es.close();
    };
  }, [activeRunId, currentProject?.id]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [streamData?.progressLog]);

  const startMutation = useMutation({
    mutationFn: async () => {
      if (!currentProject?.id) throw new Error('No project selected');
      return apiRequest(`/api/projects/${currentProject.id}/auto-correct`, 'POST', {
        maxCycles,
        targetScore,
        maxCriticalIssues: 0,
      });
    },
    onSuccess: async (data: any) => {
      toast({ title: "Auto-corrector iniciado", description: `Run #${data.runId} en progreso` });
      setActiveRunId(data.runId);
      queryClient.invalidateQueries({ queryKey: ['/api/projects', currentProject?.id, 'auto-correct/runs'] });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async (runId: number) => {
      return apiRequest(`/api/auto-correct/runs/${runId}/cancel`, 'POST');
    },
    onSuccess: () => {
      toast({ title: "Cancelando...", description: "Se solicitó la cancelación" });
      queryClient.invalidateQueries({ queryKey: ['/api/projects', currentProject?.id, 'auto-correct/runs'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (runId: number) => {
      return apiRequest(`/api/auto-correct/runs/${runId}`, 'DELETE');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/projects', currentProject?.id, 'auto-correct/runs'] });
      toast({ title: "Eliminado" });
    },
  });

  if (!currentProject) {
    return (
      <div className="flex items-center justify-center h-full" data-testid="container-no-project">
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground">Selecciona un proyecto para usar el Auto-Corrector.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const hasActiveRun = runs?.some(r => isActiveStatus(r.status));
  const activeRun = runs?.find(r => r.id === activeRunId) || null;
  const displayData = streamData || (activeRun ? {
    status: activeRun.status,
    currentCycle: activeRun.currentCycle,
    maxCycles: activeRun.maxCycles,
    cycleHistory: activeRun.cycleHistory,
    progressLog: activeRun.progressLog,
    finalScore: activeRun.finalScore,
    totalIssuesFixed: activeRun.totalIssuesFixed,
    totalStructuralChanges: activeRun.totalStructuralChanges,
    errorMessage: activeRun.errorMessage,
  } : null);

  return (
    <div className="container mx-auto p-4 space-y-6 max-w-5xl" data-testid="container-auto-corrector">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Zap className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-page-title">Auto-Corrector</h1>
            <p className="text-sm text-muted-foreground">Auditoría y corrección autónoma para "{currentProject.title}"</p>
          </div>
        </div>
      </div>

      {!hasActiveRun && (
        <Card data-testid="card-start-run">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Target className="h-5 w-5" />
              Iniciar Auto-Corrección
            </CardTitle>
            <CardDescription>
              El sistema auditará el manuscrito con 3 agentes Gemini (continuidad, personajes, estilo), 
              corregirá todos los problemas detectados con DeepSeek, y repetirá el ciclo hasta alcanzar 
              el umbral de calidad o el máximo de ciclos.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="maxCycles" data-testid="label-max-cycles">Máx. Ciclos</Label>
                <Input
                  id="maxCycles"
                  type="number"
                  min={1}
                  max={5}
                  value={maxCycles}
                  onChange={(e) => setMaxCycles(parseInt(e.target.value) || 3)}
                  data-testid="input-max-cycles"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="targetScore" data-testid="label-target-score">Score Objetivo</Label>
                <Input
                  id="targetScore"
                  type="number"
                  min={50}
                  max={100}
                  value={targetScore}
                  onChange={(e) => setTargetScore(parseInt(e.target.value) || 85)}
                  data-testid="input-target-score"
                />
              </div>
              <div className="flex items-end sm:col-span-1 col-span-2">
                <Button
                  onClick={() => startMutation.mutate()}
                  disabled={startMutation.isPending}
                  className="w-full"
                  data-testid="button-start-auto-correct"
                >
                  {startMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4 mr-2" />
                  )}
                  Iniciar
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {displayData && activeRunId && (
        <Card data-testid="card-active-run">
          <CardHeader>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <CardTitle className="flex items-center gap-2">
                <Activity className="h-5 w-5" />
                Run #{activeRunId} - Ciclo {displayData.currentCycle}/{displayData.maxCycles}
              </CardTitle>
              <div className="flex items-center gap-2">
                {getStatusBadge(displayData.status)}
                {isActiveStatus(displayData.status) && (
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => cancelMutation.mutate(activeRunId)}
                    disabled={cancelMutation.isPending}
                    data-testid="button-cancel-run"
                  >
                    <Square className="h-3 w-3 mr-1" />
                    Cancelar
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {isActiveStatus(displayData.status) && (
              <Progress
                value={(displayData.currentCycle / displayData.maxCycles) * 100}
                className="h-2"
                data-testid="progress-cycles"
              />
            )}

            {displayData.finalScore != null && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Card>
                  <CardContent className="pt-4 pb-3 text-center">
                    <div className="text-2xl font-bold" data-testid="text-final-score">{displayData.finalScore}</div>
                    <div className="text-xs text-muted-foreground">Score Final</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4 pb-3 text-center">
                    <div className="text-2xl font-bold" data-testid="text-issues-fixed">{displayData.totalIssuesFixed || 0}</div>
                    <div className="text-xs text-muted-foreground">Issues Corregidos</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4 pb-3 text-center">
                    <div className="text-2xl font-bold" data-testid="text-structural-changes">{displayData.totalStructuralChanges || 0}</div>
                    <div className="text-xs text-muted-foreground">Cambios Estructurales</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4 pb-3 text-center">
                    <div className="text-2xl font-bold" data-testid="text-critical-issues">{displayData.finalCriticalIssues ?? '-'}</div>
                    <div className="text-xs text-muted-foreground">Issues Críticos</div>
                  </CardContent>
                </Card>
              </div>
            )}

            {displayData.cycleHistory && displayData.cycleHistory.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <TrendingUp className="h-4 w-4" />
                  Historial de Ciclos
                </h3>
                <div className="space-y-1">
                  {displayData.cycleHistory.map((cycle: AutoCorrectionCycle, idx: number) => (
                    <div key={idx} className="flex items-center justify-between gap-2 p-2 rounded-md border text-sm flex-wrap">
                      <span className="font-medium" data-testid={`text-cycle-number-${idx}`}>Ciclo {cycle.cycle}</span>
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" data-testid={`badge-cycle-score-${idx}`}>Score: {cycle.overallScore}</Badge>
                        <Badge variant={cycle.criticalIssues > 0 ? "destructive" : "secondary"}>
                          {cycle.criticalIssues} Críticos
                        </Badge>
                        <Badge variant="secondary">{cycle.issuesFixed} Corregidos</Badge>
                        {cycle.structuralChanges > 0 && (
                          <Badge variant="secondary">{cycle.structuralChanges} Estructurales</Badge>
                        )}
                        <Badge variant="outline">{getCycleResultLabel(cycle.result)}</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {displayData.progressLog && displayData.progressLog.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  Log de Actividad
                </h3>
                <ScrollArea className="h-48 border rounded-md p-3">
                  <div className="space-y-1">
                    {displayData.progressLog.map((entry: AutoCorrectionLogEntry, idx: number) => (
                      <div key={idx} className="text-xs flex gap-2" data-testid={`text-log-entry-${idx}`}>
                        <span className="text-muted-foreground shrink-0">
                          {new Date(entry.timestamp).toLocaleTimeString()}
                        </span>
                        <span className="text-muted-foreground shrink-0">[{entry.phase}]</span>
                        <span>{entry.message}</span>
                      </div>
                    ))}
                    <div ref={logEndRef} />
                  </div>
                </ScrollArea>
              </div>
            )}

            {displayData.errorMessage && (
              <div className="p-3 rounded-md border border-destructive text-sm text-destructive">
                <AlertTriangle className="h-4 w-4 inline mr-2" />
                {displayData.errorMessage}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {runs && runs.length > 0 && (
        <Card data-testid="card-run-history">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <RotateCcw className="h-5 w-5" />
              Historial de Ejecuciones
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {runs.filter(r => r.id !== activeRunId || !isActiveStatus(r.status)).map((run) => (
                <div
                  key={run.id}
                  className="flex items-center justify-between gap-2 p-3 rounded-md border text-sm flex-wrap"
                  data-testid={`card-run-history-${run.id}`}
                >
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="font-medium">Run #{run.id}</span>
                    {getStatusBadge(run.status)}
                    {run.finalScore != null && (
                      <Badge variant="outline">Score: {run.finalScore}</Badge>
                    )}
                    {run.totalIssuesFixed != null && run.totalIssuesFixed > 0 && (
                      <Badge variant="secondary">{run.totalIssuesFixed} corregidos</Badge>
                    )}
                    <span className="text-muted-foreground text-xs">
                      {new Date(run.createdAt).toLocaleDateString()} {new Date(run.createdAt).toLocaleTimeString()}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    {!isActiveStatus(run.status) && (
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => deleteMutation.mutate(run.id)}
                        disabled={deleteMutation.isPending}
                        data-testid={`button-delete-run-${run.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading && (
        <div className="flex items-center justify-center py-12" data-testid="container-loading">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      )}
    </div>
  );
}
