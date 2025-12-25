import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { useToast } from "@/hooks/use-toast";
import { 
  Plus, 
  Trash2, 
  Check, 
  X, 
  Target, 
  GitBranch, 
  Shield, 
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Circle,
  Play,
  Wrench
} from "lucide-react";
import type { SeriesArcMilestone, SeriesPlotThread, SeriesArcVerification, Project } from "@shared/schema";

interface ArcVerificationPanelProps {
  seriesId: number;
  seriesTitle: string;
  totalVolumes: number;
}

export function ArcVerificationPanel({ seriesId, seriesTitle, totalVolumes }: ArcVerificationPanelProps) {
  const { toast } = useToast();
  const [showAddMilestone, setShowAddMilestone] = useState(false);
  const [showAddThread, setShowAddThread] = useState(false);
  
  const [newMilestone, setNewMilestone] = useState({
    description: "",
    volumeNumber: 1,
    milestoneType: "plot_point" as const,
    isRequired: true,
  });
  
  const [newThread, setNewThread] = useState({
    threadName: "",
    description: "",
    introducedVolume: 1,
    importance: "major" as const,
  });

  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [lastVerificationResult, setLastVerificationResult] = useState<any>(null);

  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: [`/api/series/${seriesId}/projects`],
  });

  const { data: milestones = [], isLoading: milestonesLoading } = useQuery<SeriesArcMilestone[]>({
    queryKey: [`/api/series/${seriesId}/milestones`],
  });

  const { data: threads = [], isLoading: threadsLoading } = useQuery<SeriesPlotThread[]>({
    queryKey: [`/api/series/${seriesId}/threads`],
  });

  const { data: verifications = [] } = useQuery<SeriesArcVerification[]>({
    queryKey: [`/api/series/${seriesId}/verifications`],
  });

  const addMilestoneMutation = useMutation({
    mutationFn: async (data: typeof newMilestone) => 
      apiRequest("POST", `/api/series/${seriesId}/milestones`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/series/${seriesId}/milestones`] });
      setShowAddMilestone(false);
      setNewMilestone({ description: "", volumeNumber: 1, milestoneType: "plot_point", isRequired: true });
      toast({ title: "Hito añadido" });
    },
  });

  const updateMilestoneMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<SeriesArcMilestone> }) =>
      apiRequest("PATCH", `/api/milestones/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/series/${seriesId}/milestones`] });
    },
  });

  const deleteMilestoneMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/milestones/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/series/${seriesId}/milestones`] });
      toast({ title: "Hito eliminado" });
    },
  });

  const addThreadMutation = useMutation({
    mutationFn: async (data: typeof newThread) => 
      apiRequest("POST", `/api/series/${seriesId}/threads`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/series/${seriesId}/threads`] });
      setShowAddThread(false);
      setNewThread({ threadName: "", description: "", introducedVolume: 1, importance: "major" });
      toast({ title: "Hilo argumental añadido" });
    },
  });

  const updateThreadMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<SeriesPlotThread> }) =>
      apiRequest("PATCH", `/api/threads/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/series/${seriesId}/threads`] });
    },
  });

  const deleteThreadMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/threads/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/series/${seriesId}/threads`] });
      toast({ title: "Hilo eliminado" });
    },
  });

  const verifyProjectMutation = useMutation({
    mutationFn: async (projectId: number) => {
      const response = await apiRequest("POST", `/api/series/${seriesId}/verify-project`, { projectId });
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: [`/api/series/${seriesId}/verifications`] });
      queryClient.invalidateQueries({ queryKey: [`/api/series/${seriesId}/milestones`] });
      queryClient.invalidateQueries({ queryKey: [`/api/series/${seriesId}/threads`] });
      setLastVerificationResult(data.result);
      toast({ 
        title: data.result?.passed ? "Verificacion exitosa" : "Verificacion con observaciones",
        description: `Puntuacion: ${data.result?.overallScore || 0}/100`
      });
    },
    onError: () => {
      toast({ title: "Error", description: "No se pudo ejecutar la verificacion", variant: "destructive" });
    },
  });

  const applyCorrectionssMutation = useMutation({
    mutationFn: async (corrections: any[]) => {
      const response = await apiRequest("POST", `/api/series/${seriesId}/apply-corrections`, { 
        projectId: parseInt(selectedProjectId), 
        corrections 
      });
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: [`/api/series/${seriesId}/verifications`] });
      queryClient.invalidateQueries({ queryKey: [`/api/series/${seriesId}/milestones`] });
      setLastVerificationResult(null);
      toast({ 
        title: "Correcciones aplicadas",
        description: `${data.totalCorrected} capitulos corregidos`
      });
    },
    onError: () => {
      toast({ title: "Error", description: "No se pudieron aplicar las correcciones", variant: "destructive" });
    },
  });

  const handleRunVerification = () => {
    if (!selectedProjectId) {
      toast({ title: "Error", description: "Selecciona un proyecto primero", variant: "destructive" });
      return;
    }
    verifyProjectMutation.mutate(parseInt(selectedProjectId));
  };

  const handleApplyCorrections = () => {
    if (!lastVerificationResult?.milestoneVerifications) return;
    
    const unfulfilled = lastVerificationResult.milestoneVerifications
      .filter((m: any) => !m.isFulfilled)
      .map((m: any, index: number) => ({
        chapterNumber: m.suggestedChapter || m.fulfilledInChapter || index + 1,
        instruction: `HITO NO CUMPLIDO: ${m.description}. ${m.verificationNotes || "Incorporar este elemento del arco argumental en el capitulo."}`,
        milestoneId: m.milestoneId
      }));

    if (unfulfilled.length === 0) {
      toast({ title: "Info", description: "Todos los hitos estan cumplidos, no hay correcciones necesarias" });
      return;
    }

    applyCorrectionssMutation.mutate(unfulfilled);
  };

  const getMilestoneTypeLabel = (type: string) => {
    switch (type) {
      case "plot_point": return "Punto de Trama";
      case "character_development": return "Desarrollo de Personaje";
      case "revelation": return "Revelación";
      case "conflict": return "Conflicto";
      case "resolution": return "Resolución";
      default: return type;
    }
  };

  const getStatusIcon = (isFulfilled: boolean) => {
    if (isFulfilled) return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    return <Circle className="h-4 w-4 text-muted-foreground" />;
  };

  const getThreadStatusLabel = (status: string) => {
    switch (status) {
      case "active": return { label: "Activo", variant: "default" as const };
      case "developing": return { label: "En Desarrollo", variant: "secondary" as const };
      case "resolved": return { label: "Resuelto", variant: "outline" as const };
      case "abandoned": return { label: "Abandonado", variant: "destructive" as const };
      default: return { label: status, variant: "outline" as const };
    }
  };

  if (milestonesLoading || threadsLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const completedMilestones = milestones.filter(m => m.isFulfilled).length;
  const resolvedThreads = threads.filter(t => t.status === "resolved").length;
  const latestVerification = verifications[0];

  const unfulfilledMilestones = lastVerificationResult?.milestoneVerifications?.filter((m: any) => !m.isFulfilled) || [];

  return (
    <div className="space-y-4 pt-4">
      <div className="p-4 rounded-lg border bg-muted/30 space-y-3">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex-1 min-w-48">
            <Label className="text-sm text-muted-foreground mb-1 block">Proyecto a verificar</Label>
            <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
              <SelectTrigger data-testid="select-project-verify">
                <SelectValue placeholder="Seleccionar volumen..." />
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id.toString()}>
                    Vol. {p.seriesOrder}: {p.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2 pt-5">
            <Button 
              onClick={handleRunVerification}
              disabled={!selectedProjectId || verifyProjectMutation.isPending}
              data-testid="button-run-verification"
            >
              {verifyProjectMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Play className="h-4 w-4 mr-2" />
              )}
              Ejecutar Verificacion
            </Button>
            {unfulfilledMilestones.length > 0 && (
              <Button 
                variant="secondary"
                onClick={handleApplyCorrections}
                disabled={applyCorrectionssMutation.isPending}
                data-testid="button-apply-corrections"
              >
                {applyCorrectionssMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Wrench className="h-4 w-4 mr-2" />
                )}
                Aplicar Correcciones ({unfulfilledMilestones.length})
              </Button>
            )}
          </div>
        </div>

        {lastVerificationResult && (
          <div className="p-3 rounded-lg border bg-card">
            <div className="flex items-center gap-2 mb-2">
              {lastVerificationResult.passed ? (
                <CheckCircle2 className="h-5 w-5 text-green-500" />
              ) : (
                <AlertTriangle className="h-5 w-5 text-yellow-500" />
              )}
              <span className="font-medium">
                Resultado: {lastVerificationResult.passed ? "Aprobado" : "Requiere atencion"}
              </span>
              <Badge variant="outline">{lastVerificationResult.overallScore}/100</Badge>
            </div>
            <div className="text-sm text-muted-foreground">
              Hitos: {lastVerificationResult.milestonesFulfilled}/{lastVerificationResult.milestonesChecked} | 
              Hilos resueltos: {lastVerificationResult.threadsResolved}
            </div>
            {lastVerificationResult.recommendations && (
              <p className="text-sm mt-2 text-muted-foreground">{lastVerificationResult.recommendations}</p>
            )}
            {lastVerificationResult.findings?.length > 0 && (
              <div className="mt-2">
                <span className="text-xs font-medium text-muted-foreground">Hallazgos:</span>
                <ul className="text-xs text-muted-foreground list-disc pl-4">
                  {lastVerificationResult.findings.slice(0, 5).map((f: string, i: number) => (
                    <li key={i}>{f}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="text-center p-4 rounded-lg bg-muted/50">
          <Target className="h-5 w-5 mx-auto mb-2 text-primary" />
          <div className="text-xl font-bold">{completedMilestones}/{milestones.length}</div>
          <div className="text-sm text-muted-foreground">Hitos Completados</div>
        </div>
        <div className="text-center p-4 rounded-lg bg-muted/50">
          <GitBranch className="h-5 w-5 mx-auto mb-2 text-primary" />
          <div className="text-xl font-bold">{resolvedThreads}/{threads.length}</div>
          <div className="text-sm text-muted-foreground">Hilos Resueltos</div>
        </div>
        <div className="text-center p-4 rounded-lg bg-muted/50">
          <Shield className="h-5 w-5 mx-auto mb-2 text-primary" />
          <div className="text-xl font-bold">
            {latestVerification ? (
              latestVerification.status === "passed" ? (
                <span className="text-green-600">Verificado</span>
              ) : (
                <span className="text-yellow-600">Pendiente</span>
              )
            ) : (
              <span className="text-muted-foreground">-</span>
            )}
          </div>
          <div className="text-sm text-muted-foreground">Estado del Arco</div>
        </div>
      </div>

      <Accordion type="multiple" defaultValue={["milestones"]} className="w-full">
        <AccordionItem value="milestones">
          <AccordionTrigger className="hover:no-underline">
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4" />
              <span>Hitos del Arco ({milestones.length})</span>
            </div>
          </AccordionTrigger>
          <AccordionContent>
            <div className="space-y-3 pt-2">
              {milestones.map((milestone) => (
                <div 
                  key={milestone.id} 
                  className="flex items-start gap-3 p-3 rounded-lg border bg-card"
                >
                  <Button
                    size="icon"
                    variant="ghost"
                    className="shrink-0 mt-1"
                    onClick={() => updateMilestoneMutation.mutate({
                      id: milestone.id,
                      data: { isFulfilled: !milestone.isFulfilled }
                    })}
                    data-testid={`toggle-milestone-${milestone.id}`}
                  >
                    {getStatusIcon(milestone.isFulfilled)}
                  </Button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{milestone.description}</span>
                      <Badge variant="outline">Vol. {milestone.volumeNumber}</Badge>
                      <Badge variant="secondary">{getMilestoneTypeLabel(milestone.milestoneType)}</Badge>
                      {milestone.isRequired && (
                        <Badge variant="destructive">Requerido</Badge>
                      )}
                    </div>
                    {milestone.verificationNotes && (
                      <p className="text-sm text-muted-foreground mt-1">{milestone.verificationNotes}</p>
                    )}
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => deleteMilestoneMutation.mutate(milestone.id)}
                    data-testid={`delete-milestone-${milestone.id}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}

              {showAddMilestone ? (
                <div className="p-4 rounded-lg border space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label>Descripcion</Label>
                      <Input
                        value={newMilestone.description}
                        onChange={(e) => setNewMilestone(prev => ({ ...prev, description: e.target.value }))}
                        placeholder="Descripcion del hito..."
                        data-testid="input-milestone-description"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>Volumen</Label>
                      <Select 
                        value={newMilestone.volumeNumber.toString()} 
                        onValueChange={(v) => setNewMilestone(prev => ({ ...prev, volumeNumber: parseInt(v) }))}
                      >
                        <SelectTrigger data-testid="select-milestone-volume">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Array.from({ length: totalVolumes }, (_, i) => i + 1).map(n => (
                            <SelectItem key={n} value={n.toString()}>Volumen {n}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label>Tipo</Label>
                      <Select 
                        value={newMilestone.milestoneType} 
                        onValueChange={(v) => setNewMilestone(prev => ({ ...prev, milestoneType: v as any }))}
                      >
                        <SelectTrigger data-testid="select-milestone-type">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="plot_point">Punto de Trama</SelectItem>
                          <SelectItem value="character_development">Desarrollo de Personaje</SelectItem>
                          <SelectItem value="revelation">Revelación</SelectItem>
                          <SelectItem value="conflict">Conflicto</SelectItem>
                          <SelectItem value="resolution">Resolución</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1 flex items-end">
                      <label className="flex items-center gap-2 pb-2">
                        <input 
                          type="checkbox" 
                          checked={newMilestone.isRequired}
                          onChange={(e) => setNewMilestone(prev => ({ ...prev, isRequired: e.target.checked }))}
                          className="rounded"
                        />
                        <span className="text-sm">Requerido</span>
                      </label>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button 
                      size="sm" 
                      onClick={() => addMilestoneMutation.mutate(newMilestone)}
                      disabled={!newMilestone.description || addMilestoneMutation.isPending}
                      data-testid="button-save-milestone"
                    >
                      <Check className="h-4 w-4 mr-1" />
                      Guardar
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setShowAddMilestone(false)}>
                      <X className="h-4 w-4 mr-1" />
                      Cancelar
                    </Button>
                  </div>
                </div>
              ) : (
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="w-full"
                  onClick={() => setShowAddMilestone(true)}
                  data-testid="button-add-milestone"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Añadir Hito
                </Button>
              )}
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="threads">
          <AccordionTrigger className="hover:no-underline">
            <div className="flex items-center gap-2">
              <GitBranch className="h-4 w-4" />
              <span>Hilos Argumentales ({threads.length})</span>
            </div>
          </AccordionTrigger>
          <AccordionContent>
            <div className="space-y-3 pt-2">
              {threads.map((thread) => {
                const statusInfo = getThreadStatusLabel(thread.status || "active");
                return (
                  <div 
                    key={thread.id} 
                    className="flex items-start gap-3 p-3 rounded-lg border bg-card"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium">{thread.threadName}</span>
                        <Badge variant="outline">Intro: Vol. {thread.introducedVolume}</Badge>
                        {thread.resolvedVolume && (
                          <Badge variant="secondary">Res: Vol. {thread.resolvedVolume}</Badge>
                        )}
                        <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
                        {thread.importance === "major" && (
                          <Badge>Principal</Badge>
                        )}
                      </div>
                      {thread.description && (
                        <p className="text-sm text-muted-foreground mt-1">{thread.description}</p>
                      )}
                    </div>
                    <Select
                      value={thread.status || "active"}
                      onValueChange={(v) => updateThreadMutation.mutate({ id: thread.id, data: { status: v } })}
                    >
                      <SelectTrigger className="w-32" data-testid={`select-thread-status-${thread.id}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">Activo</SelectItem>
                        <SelectItem value="developing">Desarrollando</SelectItem>
                        <SelectItem value="resolved">Resuelto</SelectItem>
                        <SelectItem value="abandoned">Abandonado</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => deleteThreadMutation.mutate(thread.id)}
                      data-testid={`delete-thread-${thread.id}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                );
              })}

              {showAddThread ? (
                <div className="p-4 rounded-lg border space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label>Nombre del Hilo</Label>
                      <Input
                        value={newThread.threadName}
                        onChange={(e) => setNewThread(prev => ({ ...prev, threadName: e.target.value }))}
                        placeholder="Nombre del hilo..."
                        data-testid="input-thread-name"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>Volumen de Introduccion</Label>
                      <Select 
                        value={newThread.introducedVolume.toString()} 
                        onValueChange={(v) => setNewThread(prev => ({ ...prev, introducedVolume: parseInt(v) }))}
                      >
                        <SelectTrigger data-testid="select-thread-volume">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Array.from({ length: totalVolumes }, (_, i) => i + 1).map(n => (
                            <SelectItem key={n} value={n.toString()}>Volumen {n}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label>Importancia</Label>
                      <Select 
                        value={newThread.importance} 
                        onValueChange={(v) => setNewThread(prev => ({ ...prev, importance: v as any }))}
                      >
                        <SelectTrigger data-testid="select-thread-importance">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="major">Principal</SelectItem>
                          <SelectItem value="minor">Secundario</SelectItem>
                          <SelectItem value="subplot">Subtrama</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label>Descripción</Label>
                      <Input
                        value={newThread.description}
                        onChange={(e) => setNewThread(prev => ({ ...prev, description: e.target.value }))}
                        placeholder="Breve descripción..."
                        data-testid="input-thread-description"
                      />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button 
                      size="sm" 
                      onClick={() => addThreadMutation.mutate(newThread)}
                      disabled={!newThread.threadName || addThreadMutation.isPending}
                      data-testid="button-save-thread"
                    >
                      <Check className="h-4 w-4 mr-1" />
                      Guardar
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setShowAddThread(false)}>
                      <X className="h-4 w-4 mr-1" />
                      Cancelar
                    </Button>
                  </div>
                </div>
              ) : (
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="w-full"
                  onClick={() => setShowAddThread(true)}
                  data-testid="button-add-thread"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Añadir Hilo Argumental
                </Button>
              )}
            </div>
          </AccordionContent>
        </AccordionItem>

        {verifications.length > 0 && (
          <AccordionItem value="verifications">
            <AccordionTrigger className="hover:no-underline">
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4" />
                <span>Historial de Verificaciones ({verifications.length})</span>
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3 pt-2">
                {verifications.map((v) => (
                  <div 
                    key={v.id} 
                    className="p-3 rounded-lg border bg-card"
                  >
                    <div className="flex items-center gap-2 mb-2">
                      {v.status === "passed" ? (
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                      ) : (
                        <AlertTriangle className="h-4 w-4 text-yellow-500" />
                      )}
                      <span className="font-medium">
                        {v.status === "passed" ? "Verificación Exitosa" : "Verificación con Observaciones"}
                      </span>
                      <Badge variant="outline">Vol. {v.volumeNumber}</Badge>
                      <span className="text-sm text-muted-foreground ml-auto">
                        {new Date(v.verificationDate).toLocaleDateString()}
                      </span>
                    </div>
                    {v.overallScore !== null && (
                      <div className="text-sm text-muted-foreground mb-1">
                        Puntuación: {v.overallScore}% | Hitos: {v.milestonesFulfilled}/{v.milestonesChecked} | Hilos resueltos: {v.threadsResolved}
                      </div>
                    )}
                    {v.recommendations && (
                      <p className="text-sm text-muted-foreground">{v.recommendations}</p>
                    )}
                  </div>
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>
        )}
      </Accordion>
    </div>
  );
}
