import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { 
  Play, 
  Pause, 
  Square, 
  SkipForward, 
  ArrowUp, 
  ArrowDown, 
  Trash2, 
  Plus, 
  Zap,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertTriangle,
  ListOrdered
} from "lucide-react";
import type { Project, ProjectQueueItem, QueueState } from "@shared/schema";

interface EnrichedQueueItem extends ProjectQueueItem {
  project?: Project;
}

export default function QueuePage() {
  const { toast } = useToast();
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");

  const { data: queueState, isLoading: stateLoading } = useQuery<QueueState>({
    queryKey: ["/api/queue/state"],
    refetchInterval: 3000,
  });

  const { data: queueItems = [], isLoading: queueLoading } = useQuery<EnrichedQueueItem[]>({
    queryKey: ["/api/queue"],
    refetchInterval: 3000,
  });

  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ["/api/projects"],
  });

  const availableProjects = projects.filter(p => 
    p.status !== "completed" && 
    !queueItems.some(q => q.projectId === p.id)
  );

  const startQueueMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/queue/start"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/queue/state"] });
      toast({ title: "Cola iniciada", description: "El procesamiento autónomo ha comenzado" });
    },
    onError: () => toast({ variant: "destructive", title: "Error", description: "No se pudo iniciar la cola" }),
  });

  const stopQueueMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/queue/stop"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/queue/state"] });
      toast({ title: "Cola detenida" });
    },
  });

  const pauseQueueMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/queue/pause"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/queue/state"] });
      toast({ title: "Cola pausada" });
    },
  });

  const resumeQueueMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/queue/resume"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/queue/state"] });
      toast({ title: "Cola reanudada" });
    },
  });

  const skipCurrentMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/queue/skip-current"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/queue"] });
      queryClient.invalidateQueries({ queryKey: ["/api/queue/state"] });
      toast({ title: "Proyecto saltado" });
    },
  });

  const addToQueueMutation = useMutation({
    mutationFn: (data: { projectId: number; priority: string }) => 
      apiRequest("POST", "/api/queue", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/queue"] });
      setSelectedProjectId("");
      toast({ title: "Proyecto añadido a la cola" });
    },
    onError: () => toast({ variant: "destructive", title: "Error", description: "No se pudo añadir a la cola" }),
  });

  const removeFromQueueMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/queue/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/queue"] });
      toast({ title: "Proyecto eliminado de la cola" });
    },
  });

  const reorderMutation = useMutation({
    mutationFn: ({ id, newPosition }: { id: number; newPosition: number }) =>
      apiRequest("PATCH", `/api/queue/${id}/reorder`, { newPosition }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/queue"] });
    },
  });

  const makeUrgentMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/queue/${id}/urgent`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/queue"] });
      toast({ title: "Proyecto marcado como urgente" });
    },
  });

  const updateQueueStateMutation = useMutation({
    mutationFn: (data: Partial<QueueState>) => apiRequest("PATCH", "/api/queue/state", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/queue/state"] });
    },
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "waiting":
        return <Badge variant="outline"><Clock className="h-3 w-3 mr-1" />En espera</Badge>;
      case "processing":
        return <Badge variant="default"><Loader2 className="h-3 w-3 mr-1 animate-spin" />Procesando</Badge>;
      case "completed":
        return <Badge variant="secondary"><CheckCircle2 className="h-3 w-3 mr-1" />Completado</Badge>;
      case "failed":
        return <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" />Fallido</Badge>;
      case "skipped":
        return <Badge variant="outline"><SkipForward className="h-3 w-3 mr-1" />Saltado</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getPriorityBadge = (priority: string) => {
    switch (priority) {
      case "urgent":
        return <Badge variant="destructive"><Zap className="h-3 w-3 mr-1" />Urgente</Badge>;
      case "high":
        return <Badge><AlertTriangle className="h-3 w-3 mr-1" />Alta</Badge>;
      default:
        return null;
    }
  };

  const handleAddToQueue = () => {
    if (!selectedProjectId) return;
    addToQueueMutation.mutate({ projectId: parseInt(selectedProjectId), priority: "normal" });
  };

  const handleMoveUp = (item: EnrichedQueueItem) => {
    if (item.position > 1) {
      reorderMutation.mutate({ id: item.id, newPosition: item.position - 1 });
    }
  };

  const handleMoveDown = (item: EnrichedQueueItem) => {
    const maxPos = Math.max(...queueItems.map(q => q.position));
    if (item.position < maxPos) {
      reorderMutation.mutate({ id: item.id, newPosition: item.position + 1 });
    }
  };

  if (stateLoading || queueLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const waitingItems = queueItems.filter(q => q.status === "waiting" || q.status === "processing");
  const completedItems = queueItems.filter(q => q.status === "completed" || q.status === "failed" || q.status === "skipped");

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ListOrdered className="h-6 w-6" />
            Cola de Proyectos
          </h1>
          <p className="text-muted-foreground">Gestión autónoma de generación de novelas</p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {queueState?.status === "stopped" ? (
            <Button 
              onClick={() => startQueueMutation.mutate()}
              disabled={startQueueMutation.isPending || waitingItems.length === 0}
              data-testid="button-start-queue"
            >
              <Play className="h-4 w-4 mr-2" />
              Iniciar Cola
            </Button>
          ) : queueState?.status === "paused" ? (
            <>
              <Button 
                onClick={() => resumeQueueMutation.mutate()}
                disabled={resumeQueueMutation.isPending}
                data-testid="button-resume-queue"
              >
                <Play className="h-4 w-4 mr-2" />
                Reanudar
              </Button>
              <Button 
                variant="outline"
                onClick={() => stopQueueMutation.mutate()}
                disabled={stopQueueMutation.isPending}
                data-testid="button-stop-queue"
              >
                <Square className="h-4 w-4 mr-2" />
                Detener
              </Button>
            </>
          ) : (
            <>
              <Button 
                variant="outline"
                onClick={() => pauseQueueMutation.mutate()}
                disabled={pauseQueueMutation.isPending}
                data-testid="button-pause-queue"
              >
                <Pause className="h-4 w-4 mr-2" />
                Pausar
              </Button>
              <Button 
                variant="outline"
                onClick={() => stopQueueMutation.mutate()}
                disabled={stopQueueMutation.isPending}
                data-testid="button-stop-queue"
              >
                <Square className="h-4 w-4 mr-2" />
                Detener
              </Button>
              {queueState?.currentProjectId && (
                <Button 
                  variant="outline"
                  onClick={() => skipCurrentMutation.mutate()}
                  disabled={skipCurrentMutation.isPending}
                  data-testid="button-skip-current"
                >
                  <SkipForward className="h-4 w-4 mr-2" />
                  Saltar Actual
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Estado de la Cola</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center p-4 rounded-lg bg-muted/50">
              <div className="text-2xl font-bold">{waitingItems.length}</div>
              <div className="text-sm text-muted-foreground">En espera</div>
            </div>
            <div className="text-center p-4 rounded-lg bg-muted/50">
              <div className="text-2xl font-bold">{queueItems.filter(q => q.status === "processing").length}</div>
              <div className="text-sm text-muted-foreground">Procesando</div>
            </div>
            <div className="text-center p-4 rounded-lg bg-muted/50">
              <div className="text-2xl font-bold">{queueItems.filter(q => q.status === "completed").length}</div>
              <div className="text-sm text-muted-foreground">Completados</div>
            </div>
            <div className="text-center p-4 rounded-lg bg-muted/50">
              <div className="text-2xl font-bold capitalize">
                {queueState?.status === "running" ? (
                  <span className="text-green-600 dark:text-green-400">Activa</span>
                ) : queueState?.status === "paused" ? (
                  <span className="text-yellow-600 dark:text-yellow-400">Pausada</span>
                ) : (
                  <span className="text-muted-foreground">Detenida</span>
                )}
              </div>
              <div className="text-sm text-muted-foreground">Estado</div>
            </div>
          </div>

          <div className="mt-4 flex items-center gap-4 flex-wrap">
            <label className="flex items-center gap-2">
              <input 
                type="checkbox" 
                checked={queueState?.autoAdvance ?? true}
                onChange={(e) => updateQueueStateMutation.mutate({ autoAdvance: e.target.checked })}
                className="rounded"
              />
              <span className="text-sm">Avanzar automáticamente</span>
            </label>
            <label className="flex items-center gap-2">
              <input 
                type="checkbox" 
                checked={queueState?.skipOnError ?? true}
                onChange={(e) => updateQueueStateMutation.mutate({ skipOnError: e.target.checked })}
                className="rounded"
              />
              <span className="text-sm">Saltar en caso de error</span>
            </label>
            <label className="flex items-center gap-2">
              <input 
                type="checkbox" 
                checked={queueState?.pauseAfterEach ?? false}
                onChange={(e) => updateQueueStateMutation.mutate({ pauseAfterEach: e.target.checked })}
                className="rounded"
              />
              <span className="text-sm">Pausar después de cada proyecto</span>
            </label>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Añadir Proyecto</CardTitle>
          <CardDescription>Selecciona un proyecto para añadir a la cola de generación</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
              <SelectTrigger className="w-[300px]" data-testid="select-project">
                <SelectValue placeholder="Seleccionar proyecto..." />
              </SelectTrigger>
              <SelectContent>
                {availableProjects.map(p => (
                  <SelectItem key={p.id} value={p.id.toString()}>
                    {p.title}
                  </SelectItem>
                ))}
                {availableProjects.length === 0 && (
                  <SelectItem value="none" disabled>No hay proyectos disponibles</SelectItem>
                )}
              </SelectContent>
            </Select>
            <Button 
              onClick={handleAddToQueue}
              disabled={!selectedProjectId || addToQueueMutation.isPending}
              data-testid="button-add-to-queue"
            >
              <Plus className="h-4 w-4 mr-2" />
              Añadir a Cola
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Proyectos en Cola</CardTitle>
          <CardDescription>{waitingItems.length} proyectos pendientes</CardDescription>
        </CardHeader>
        <CardContent>
          {waitingItems.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">No hay proyectos en cola</p>
          ) : (
            <div className="space-y-2">
              {waitingItems.sort((a, b) => a.position - b.position).map((item, index) => (
                <div 
                  key={item.id} 
                  className="flex items-center gap-4 p-4 rounded-lg border bg-card hover-elevate"
                  data-testid={`queue-item-${item.id}`}
                >
                  <div className="text-lg font-bold text-muted-foreground w-8">{item.position}</div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{item.project?.title || `Proyecto #${item.projectId}`}</div>
                    <div className="text-sm text-muted-foreground">
                      {item.project?.genre} - {item.project?.chapterCount} capítulos
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {getPriorityBadge(item.priority)}
                    {getStatusBadge(item.status)}
                  </div>
                  <div className="flex items-center gap-1">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button 
                          size="icon" 
                          variant="ghost"
                          onClick={() => handleMoveUp(item)}
                          disabled={index === 0 || item.status === "processing"}
                          data-testid={`button-move-up-${item.id}`}
                        >
                          <ArrowUp className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Subir</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button 
                          size="icon" 
                          variant="ghost"
                          onClick={() => handleMoveDown(item)}
                          disabled={index === waitingItems.length - 1 || item.status === "processing"}
                          data-testid={`button-move-down-${item.id}`}
                        >
                          <ArrowDown className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Bajar</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button 
                          size="icon" 
                          variant="ghost"
                          onClick={() => makeUrgentMutation.mutate(item.id)}
                          disabled={item.priority === "urgent" || item.status === "processing"}
                          data-testid={`button-urgent-${item.id}`}
                        >
                          <Zap className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Marcar urgente</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button 
                          size="icon" 
                          variant="ghost"
                          onClick={() => removeFromQueueMutation.mutate(item.id)}
                          disabled={item.status === "processing"}
                          data-testid={`button-remove-${item.id}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Eliminar de cola</TooltipContent>
                    </Tooltip>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {completedItems.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Historial</CardTitle>
            <CardDescription>Proyectos procesados recientemente</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {completedItems.slice(0, 10).map((item) => (
                <div 
                  key={item.id} 
                  className="flex items-center gap-4 p-3 rounded-lg border bg-muted/30"
                  data-testid={`history-item-${item.id}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{item.project?.title || `Proyecto #${item.projectId}`}</div>
                    {item.errorMessage && (
                      <div className="text-sm text-destructive truncate">{item.errorMessage}</div>
                    )}
                  </div>
                  {getStatusBadge(item.status)}
                  {item.completedAt && (
                    <div className="text-sm text-muted-foreground">
                      {new Date(item.completedAt).toLocaleString()}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
