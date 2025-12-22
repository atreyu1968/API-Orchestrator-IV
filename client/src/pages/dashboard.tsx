import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { AgentCard } from "@/components/agent-card";
import { ProcessFlow } from "@/components/process-flow";
import { ConsoleOutput, type LogEntry } from "@/components/console-output";
import { ConfigPanel, type ConfigFormData } from "@/components/config-panel";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Play, StopCircle, FileText, Clock, CheckCircle, Pencil, X, Download, Archive, Copy, Trash2, ClipboardCheck, RefreshCw, Ban, CheckCheck } from "lucide-react";
import { ProjectSelector } from "@/components/project-selector";
import type { Project, AgentStatus, Chapter } from "@shared/schema";

import type { AgentRole } from "@/components/process-flow";

const agentNames: Record<AgentRole, string> = {
  architect: "El Arquitecto",
  ghostwriter: "El Narrador",
  editor: "El Editor",
  copyeditor: "El Estilista",
  "final-reviewer": "El Revisor Final",
};

function calculateCost(inputTokens: number, outputTokens: number, thinkingTokens: number): number {
  const INPUT_PRICE_PER_MILLION = 1.25;
  const OUTPUT_PRICE_PER_MILLION = 10.0;
  const THINKING_PRICE_PER_MILLION = 3.0;
  
  const inputCost = (inputTokens / 1_000_000) * INPUT_PRICE_PER_MILLION;
  const outputCost = (outputTokens / 1_000_000) * OUTPUT_PRICE_PER_MILLION;
  const thinkingCost = (thinkingTokens / 1_000_000) * THINKING_PRICE_PER_MILLION;
  
  return inputCost + outputCost + thinkingCost;
}

export default function Dashboard() {
  const { toast } = useToast();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [currentStage, setCurrentStage] = useState<AgentRole | null>(null);
  const [completedStages, setCompletedStages] = useState<AgentRole[]>([]);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);

  const { data: projects = [], isLoading: projectsLoading } = useQuery<Project[]>({
    queryKey: ["/api/projects"],
  });

  const { data: agentStatuses = [] } = useQuery<AgentStatus[]>({
    queryKey: ["/api/agent-statuses"],
    refetchInterval: 2000,
  });

  const activeProject = projects.find(p => p.status === "generating");
  const selectedProject = selectedProjectId 
    ? projects.find(p => p.id === selectedProjectId) 
    : projects.filter(p => p.status !== "archived")[0];
  const currentProject = selectedProject || projects[0];

  const { data: chapters = [] } = useQuery<Chapter[]>({
    queryKey: ["/api/projects", currentProject?.id, "chapters"],
    enabled: !!currentProject?.id,
  });

  const createProjectMutation = useMutation({
    mutationFn: async (data: ConfigFormData) => {
      const response = await apiRequest("POST", "/api/projects", data);
      return response.json();
    },
    onSuccess: (project) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      toast({
        title: "Proyecto creado",
        description: `"${project.title}" está siendo generado...`,
      });
      addLog("info", `Proyecto "${project.title}" iniciado`);
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: "No se pudo crear el proyecto",
        variant: "destructive",
      });
      addLog("error", `Error al crear proyecto: ${error.message}`);
    },
  });

  const startGenerationMutation = useMutation({
    mutationFn: async (projectId: number) => {
      const response = await apiRequest("POST", `/api/projects/${projectId}/generate`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      addLog("info", "Generación iniciada");
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: "No se pudo iniciar la generación",
        variant: "destructive",
      });
      addLog("error", `Error: ${error.message}`);
    },
  });

  const updateProjectMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: ConfigFormData }) => {
      const response = await apiRequest("PATCH", `/api/projects/${id}`, data);
      return response.json();
    },
    onSuccess: (project) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      setEditingProject(null);
      toast({
        title: "Proyecto actualizado",
        description: `"${project.title}" ha sido actualizado`,
      });
      addLog("info", `Proyecto "${project.title}" actualizado`);
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: "No se pudo actualizar el proyecto",
        variant: "destructive",
      });
      addLog("error", `Error al actualizar: ${error.message}`);
    },
  });

  const archiveProjectMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await apiRequest("POST", `/api/projects/${id}/archive`);
      return response.json();
    },
    onSuccess: (project) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      setSelectedProjectId(null);
      toast({ title: "Proyecto archivado", description: `"${project.title}" ha sido archivado` });
    },
    onError: () => {
      toast({ title: "Error", description: "No se pudo archivar el proyecto", variant: "destructive" });
    },
  });

  const unarchiveProjectMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await apiRequest("POST", `/api/projects/${id}/unarchive`);
      return response.json();
    },
    onSuccess: (project) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      toast({ title: "Proyecto restaurado", description: `"${project.title}" ha sido restaurado` });
    },
    onError: () => {
      toast({ title: "Error", description: "No se pudo restaurar el proyecto", variant: "destructive" });
    },
  });

  const duplicateProjectMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await apiRequest("POST", `/api/projects/${id}/duplicate`);
      return response.json();
    },
    onSuccess: (project) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      setSelectedProjectId(project.id);
      toast({ title: "Proyecto duplicado", description: `"${project.title}" ha sido creado` });
    },
    onError: () => {
      toast({ title: "Error", description: "No se pudo duplicar el proyecto", variant: "destructive" });
    },
  });

  const deleteProjectMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/projects/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      setSelectedProjectId(null);
      toast({ title: "Proyecto eliminado" });
    },
    onError: () => {
      toast({ title: "Error", description: "No se pudo eliminar el proyecto", variant: "destructive" });
    },
  });

  const finalReviewMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await apiRequest("POST", `/api/projects/${id}/final-review`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      toast({ title: "Revisión final iniciada", description: "El Revisor Final está analizando el manuscrito" });
      addLog("thinking", "Iniciando revisión final del manuscrito...", "final-reviewer");
    },
    onError: () => {
      toast({ title: "Error", description: "No se pudo iniciar la revisión final", variant: "destructive" });
    },
  });

  const cancelProjectMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await apiRequest("POST", `/api/projects/${id}/cancel`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/agent-statuses"] });
      toast({ title: "Generación cancelada", description: "El proceso ha sido detenido" });
      addLog("error", "Generación cancelada por el usuario");
      setCurrentStage(null);
    },
    onError: () => {
      toast({ title: "Error", description: "No se pudo cancelar la generación", variant: "destructive" });
    },
  });

  const forceCompleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await apiRequest("POST", `/api/projects/${id}/force-complete`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/agent-statuses"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", currentProject?.id, "chapters"] });
      toast({ title: "Proyecto completado", description: "El manuscrito ha sido marcado como finalizado" });
      addLog("success", "Proyecto marcado como completado (forzado)");
      setCurrentStage(null);
      setCompletedStages(["architect", "ghostwriter", "editor", "copyeditor", "final-reviewer"]);
    },
    onError: () => {
      toast({ title: "Error", description: "No se pudo completar el proyecto", variant: "destructive" });
    },
  });

  const resumeProjectMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await apiRequest("POST", `/api/projects/${id}/resume`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/agent-statuses"] });
      toast({ title: "Generación reanudada", description: "Continuando desde donde se detuvo" });
      addLog("success", "Reanudando generación del manuscrito...");
      setCompletedStages([]);
    },
    onError: () => {
      toast({ title: "Error", description: "No se pudo reanudar la generación", variant: "destructive" });
    },
  });

  const addLog = (type: LogEntry["type"], message: string, agent?: string) => {
    const newLog: LogEntry = {
      id: crypto.randomUUID(),
      type,
      message,
      timestamp: new Date(),
      agent,
    };
    setLogs(prev => [...prev, newLog]);
  };

  useEffect(() => {
    if (activeProject) {
      const eventSource = new EventSource(`/api/projects/${activeProject.id}/stream`);
      
      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          if (data.type === "agent_status") {
            const role = data.role as AgentRole;
            if (data.status === "thinking") {
              setCurrentStage(role);
              addLog("thinking", data.message || `${agentNames[role]} está procesando...`, role);
            } else if (data.status === "writing") {
              addLog("writing", data.message || `${agentNames[role]} está escribiendo...`, role);
            } else if (data.status === "editing") {
              addLog("editing", data.message || `${agentNames[role]} está revisando...`, role);
            } else if (data.status === "completed") {
              setCompletedStages(prev => prev.includes(role) ? prev : [...prev, role]);
              addLog("success", data.message || `${agentNames[role]} completó su tarea`, role);
            }
          } else if (data.type === "chapter_rewrite") {
            addLog("editing", 
              `Reescribiendo capítulo ${data.chapterNumber}: "${data.chapterTitle}" (${data.currentIndex}/${data.totalToRewrite}) - ${data.reason}`,
              "final-reviewer"
            );
            queryClient.invalidateQueries({ queryKey: ["/api/projects", activeProject.id, "chapters"] });
          } else if (data.type === "chapter_complete") {
            addLog("success", `Capítulo ${data.chapterNumber} completado (${data.wordCount} palabras)`);
            queryClient.invalidateQueries({ queryKey: ["/api/projects", activeProject.id, "chapters"] });
          } else if (data.type === "project_complete") {
            addLog("success", "¡Manuscrito completado!");
            toast({
              title: "¡Manuscrito completado!",
              description: "Tu novela ha sido generada exitosamente",
            });
            queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
            setCurrentStage(null);
          } else if (data.type === "error") {
            addLog("error", data.message || "Error durante la generación");
          }
        } catch (e) {
          console.error("Error parsing SSE:", e);
        }
      };

      eventSource.onerror = () => {
        eventSource.close();
      };

      return () => {
        eventSource.close();
      };
    }
  }, [activeProject?.id]);

  const getAgentStatus = (role: AgentRole) => {
    const status = agentStatuses.find(s => s.agentName.toLowerCase() === role);
    return {
      status: (status?.status as "idle" | "thinking" | "writing" | "editing" | "completed" | "error") || "idle",
      currentTask: status?.currentTask,
      lastActivity: status?.lastActivity ? new Date(status.lastActivity) : undefined,
    };
  };

  const completedChapters = chapters.filter(c => c.status === "completed").length;
  const totalWordCount = chapters.reduce((sum, c) => sum + (c.wordCount || 0), 0);

  const handleSubmit = (data: ConfigFormData) => {
    if (editingProject) {
      updateProjectMutation.mutate({ id: editingProject.id, data });
    } else {
      createProjectMutation.mutate(data);
    }
  };

  const handleEditProject = (project: Project) => {
    setEditingProject(project);
  };

  const handleCancelEdit = () => {
    setEditingProject(null);
  };

  const handleStartGeneration = () => {
    if (currentProject && currentProject.status === "idle") {
      startGenerationMutation.mutate(currentProject.id);
    }
  };

  return (
    <div className="space-y-6 p-6" data-testid="dashboard-page">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold">Panel de Control</h1>
          <p className="text-muted-foreground mt-1">
            Orquestación de agentes literarios autónomos
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {projects.length > 0 && (
            <ProjectSelector
              projects={projects}
              selectedProjectId={currentProject?.id || null}
              onSelectProject={setSelectedProjectId}
            />
          )}
          {activeProject && (
            <Badge className="bg-green-500/20 text-green-600 dark:text-green-400 text-sm px-3 py-1">
              <div className="w-2 h-2 rounded-full bg-green-500 mr-2 animate-pulse" />
              Generando: {activeProject.title}
            </Badge>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <AgentCard 
          name={agentNames.architect}
          role="architect"
          {...getAgentStatus("architect")}
        />
        <AgentCard 
          name={agentNames.ghostwriter}
          role="ghostwriter"
          {...getAgentStatus("ghostwriter")}
        />
        <AgentCard 
          name={agentNames.editor}
          role="editor"
          {...getAgentStatus("editor")}
        />
        <AgentCard 
          name={agentNames.copyeditor}
          role="copyeditor"
          {...getAgentStatus("copyeditor")}
        />
        <AgentCard 
          name={agentNames["final-reviewer"]}
          role="final-reviewer"
          {...getAgentStatus("final-reviewer")}
        />
      </div>

      {activeProject && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Flujo de Proceso</CardTitle>
          </CardHeader>
          <CardContent>
            <ProcessFlow 
              currentStage={currentStage} 
              completedStages={completedStages} 
            />
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Consola de Actividad</CardTitle>
            </CardHeader>
            <CardContent>
              <ConsoleOutput logs={logs} />
            </CardContent>
          </Card>

          {currentProject && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-4 pb-2">
                <CardTitle className="text-lg">Progreso del Manuscrito</CardTitle>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2 text-sm">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <span>{completedChapters}/{currentProject.chapterCount} capítulos</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    <span>{totalWordCount.toLocaleString()} palabras</span>
                  </div>
                  {currentProject.status === "completed" && (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => finalReviewMutation.mutate(currentProject.id)}
                        disabled={finalReviewMutation.isPending}
                        data-testid="button-final-review"
                      >
                        <ClipboardCheck className="h-4 w-4 mr-2" />
                        Revisión Final
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          window.open(`/api/projects/${currentProject.id}/export-docx`, "_blank");
                        }}
                        data-testid="button-export-docx"
                      >
                        <Download className="h-4 w-4 mr-2" />
                        Exportar Word
                      </Button>
                    </>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {chapters.map((chapter) => (
                    <div 
                      key={chapter.id}
                      className="flex items-center justify-between gap-4 p-2 rounded-md bg-muted/50"
                      data-testid={`progress-chapter-${chapter.chapterNumber}`}
                    >
                      <div className="flex items-center gap-2">
                        {chapter.status === "completed" ? (
                          <CheckCircle className="h-4 w-4 text-green-500" />
                        ) : chapter.status === "revision" ? (
                          <RefreshCw className="h-4 w-4 text-orange-500 animate-spin" />
                        ) : (
                          <Clock className="h-4 w-4 text-muted-foreground" />
                        )}
                        <span className="text-sm font-medium">
                          Capítulo {chapter.chapterNumber}
                        </span>
                        {chapter.title && (
                          <span className="text-sm text-muted-foreground">
                            - {chapter.title}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {chapter.wordCount && chapter.wordCount > 0 && (
                          <span className="text-xs text-muted-foreground">
                            {chapter.wordCount.toLocaleString()} palabras
                          </span>
                        )}
                        <Badge 
                          variant={chapter.status === "completed" ? "default" : chapter.status === "revision" ? "destructive" : "secondary"}
                          className="text-xs"
                        >
                          {chapter.status === "completed" ? "Completado" : 
                           chapter.status === "writing" ? "Escribiendo" :
                           chapter.status === "editing" ? "Editando" : 
                           chapter.status === "revision" ? "Reescribiendo" : "Pendiente"}
                        </Badge>
                      </div>
                    </div>
                  ))}
                  {chapters.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      Los capítulos aparecerán aquí conforme se generen
                    </p>
                  )}
                </div>
                
                {currentProject.status === "completed" && (currentProject.totalInputTokens || currentProject.totalOutputTokens) && (
                  <div className="mt-4 p-4 rounded-md bg-muted/30 border border-border">
                    <div className="flex items-center justify-between gap-4">
                      <div className="space-y-1">
                        <p className="text-sm font-medium">Coste de Generación</p>
                        <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                          <span>Tokens entrada: {(currentProject.totalInputTokens || 0).toLocaleString()}</span>
                          <span>Tokens salida: {(currentProject.totalOutputTokens || 0).toLocaleString()}</span>
                          <span>Tokens razonamiento: {(currentProject.totalThinkingTokens || 0).toLocaleString()}</span>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-2xl font-bold text-primary" data-testid="text-total-cost">
                          ${calculateCost(
                            currentProject.totalInputTokens || 0,
                            currentProject.totalOutputTokens || 0,
                            currentProject.totalThinkingTokens || 0
                          ).toFixed(2)}
                        </p>
                        <p className="text-xs text-muted-foreground">USD estimado</p>
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4 pb-2">
              <CardTitle className="text-lg">
                {editingProject ? "Editar Proyecto" : "Nuevo Proyecto"}
              </CardTitle>
              {editingProject && (
                <Button 
                  variant="ghost" 
                  size="icon" 
                  onClick={handleCancelEdit}
                  data-testid="button-cancel-edit"
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </CardHeader>
            <CardContent>
              <ConfigPanel 
                key={editingProject?.id || "new"}
                onSubmit={handleSubmit}
                isLoading={createProjectMutation.isPending || updateProjectMutation.isPending || startGenerationMutation.isPending}
                defaultValues={editingProject ? {
                  title: editingProject.title,
                  premise: editingProject.premise || "",
                  genre: editingProject.genre,
                  tone: editingProject.tone,
                  chapterCount: editingProject.chapterCount,
                  hasPrologue: editingProject.hasPrologue,
                  hasEpilogue: editingProject.hasEpilogue,
                  hasAuthorNote: editingProject.hasAuthorNote,
                  pseudonymId: editingProject.pseudonymId,
                  styleGuideId: editingProject.styleGuideId,
                } : undefined}
                isEditing={!!editingProject}
              />
            </CardContent>
          </Card>

          {currentProject && currentProject.status === "idle" && !editingProject && (
            <Card>
              <CardContent className="pt-6 space-y-3">
                <div className="flex gap-2">
                  <Button 
                    className="flex-1" 
                    size="lg"
                    onClick={handleStartGeneration}
                    disabled={startGenerationMutation.isPending}
                    data-testid="button-continue-generation"
                  >
                    <Play className="h-4 w-4 mr-2" />
                    Iniciar Generación
                  </Button>
                  <Button 
                    variant="outline"
                    size="lg"
                    onClick={() => handleEditProject(currentProject)}
                    data-testid="button-edit-project"
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground text-center">
                  Proyecto: {currentProject.title}
                </p>
              </CardContent>
            </Card>
          )}

          {currentProject && !editingProject && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-lg">Acciones del Proyecto</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex gap-2 flex-wrap">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => duplicateProjectMutation.mutate(currentProject.id)}
                    disabled={duplicateProjectMutation.isPending}
                    data-testid="button-duplicate-project"
                  >
                    <Copy className="h-4 w-4 mr-2" />
                    Duplicar
                  </Button>
                  
                  {currentProject.status === "generating" && (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          if (confirm("¿Cancelar la generación? El progreso actual se mantendrá.")) {
                            cancelProjectMutation.mutate(currentProject.id);
                          }
                        }}
                        disabled={cancelProjectMutation.isPending}
                        className="text-destructive hover:text-destructive"
                        data-testid="button-cancel-generation"
                      >
                        <Ban className="h-4 w-4 mr-2" />
                        Cancelar
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          if (confirm("¿Marcar como completado? Los capítulos con contenido se guardarán.")) {
                            forceCompleteMutation.mutate(currentProject.id);
                          }
                        }}
                        disabled={forceCompleteMutation.isPending}
                        data-testid="button-force-complete"
                      >
                        <CheckCheck className="h-4 w-4 mr-2" />
                        Forzar Completado
                      </Button>
                    </>
                  )}

                  {["paused", "cancelled", "error", "failed_final_review"].includes(currentProject.status) && (
                    <Button
                      variant="default"
                      size="sm"
                      onClick={() => {
                        if (confirm("¿Continuar la generación desde donde se detuvo?")) {
                          resumeProjectMutation.mutate(currentProject.id);
                        }
                      }}
                      disabled={resumeProjectMutation.isPending}
                      data-testid="button-resume-generation"
                    >
                      <Play className="h-4 w-4 mr-2" />
                      Continuar
                    </Button>
                  )}

                  {currentProject.status === "archived" ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => unarchiveProjectMutation.mutate(currentProject.id)}
                      disabled={unarchiveProjectMutation.isPending}
                      data-testid="button-unarchive-project"
                    >
                      <Archive className="h-4 w-4 mr-2" />
                      Restaurar
                    </Button>
                  ) : currentProject.status !== "generating" && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => archiveProjectMutation.mutate(currentProject.id)}
                      disabled={archiveProjectMutation.isPending}
                      data-testid="button-archive-project"
                    >
                      <Archive className="h-4 w-4 mr-2" />
                      Archivar
                    </Button>
                  )}

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (confirm(`¿Estás seguro de eliminar "${currentProject.title}"?`)) {
                        deleteProjectMutation.mutate(currentProject.id);
                      }
                    }}
                    disabled={deleteProjectMutation.isPending || currentProject.status === "generating"}
                    className="text-destructive hover:text-destructive"
                    data-testid="button-delete-project"
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Eliminar
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {currentProject.title} - {currentProject.status === "completed" ? "Completado" : 
                   currentProject.status === "archived" ? "Archivado" :
                   currentProject.status === "generating" ? "Generando" : "Pendiente"}
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
