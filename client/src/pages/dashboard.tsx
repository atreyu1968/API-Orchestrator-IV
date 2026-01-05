import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AgentCard } from "@/components/agent-card";
import { ProcessFlow } from "@/components/process-flow";
import { ConsoleOutput, type LogEntry } from "@/components/console-output";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DuplicateManager } from "@/components/duplicate-manager";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Play, FileText, Clock, CheckCircle, Download, Archive, Copy, Trash2, ClipboardCheck, RefreshCw, Ban, CheckCheck, Plus, Upload, Database, Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useProject } from "@/lib/project-context";
import { Link } from "wouter";
import type { Project, AgentStatus, Chapter } from "@shared/schema";

import type { AgentRole } from "@/components/process-flow";

const agentNames: Record<AgentRole, string> = {
  architect: "El Arquitecto",
  ghostwriter: "El Narrador",
  editor: "El Editor",
  copyeditor: "El Estilista",
  "final-reviewer": "El Revisor Final",
  "continuity-sentinel": "El Centinela",
  "voice-auditor": "El Auditor de Voz",
  "semantic-detector": "El Detector Semántico",
};

function sortChaptersForDisplay(chapters: Chapter[]): Chapter[] {
  return [...chapters].sort((a, b) => {
    const orderA = a.chapterNumber === 0 ? -1000 : a.chapterNumber === -1 ? 1000 : a.chapterNumber === -2 ? 1001 : a.chapterNumber;
    const orderB = b.chapterNumber === 0 ? -1000 : b.chapterNumber === -1 ? 1000 : b.chapterNumber === -2 ? 1001 : b.chapterNumber;
    return orderA - orderB;
  });
}

function calculateCost(inputTokens: number, outputTokens: number, thinkingTokens: number): number {
  const INPUT_PRICE_PER_MILLION = 0.80;
  const OUTPUT_PRICE_PER_MILLION = 6.50;
  const THINKING_PRICE_PER_MILLION = 3.0;
  
  const inputCost = (inputTokens / 1_000_000) * INPUT_PRICE_PER_MILLION;
  const outputCost = (outputTokens / 1_000_000) * OUTPUT_PRICE_PER_MILLION;
  const thinkingCost = (thinkingTokens / 1_000_000) * THINKING_PRICE_PER_MILLION;
  
  return inputCost + outputCost + thinkingCost;
}

const MODEL_PRICING_INFO = `Modelos usados:
• gemini-3-pro-preview (Arquitecto, Narrador, Revisor): $1.25/$10.0/M + thinking $3.0/M
• gemini-3-flash (Editor): $0.50/$3.0/M
• gemini-2.5-flash (QA: Centinela, Auditor, Detector, Estilista): $0.30/$2.5/M

Precios promedio ponderados: Input $0.80/M, Output $6.50/M, Thinking $3.0/M`;

type ConfirmType = "cancel" | "forceComplete" | "resume" | "delete" | null;

export default function Dashboard() {
  const { toast } = useToast();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [currentStage, setCurrentStage] = useState<AgentRole | null>(null);
  const [completedStages, setCompletedStages] = useState<AgentRole[]>([]);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmType>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const { projects, currentProject, setSelectedProjectId } = useProject();

  const handleExportData = async () => {
    setIsExporting(true);
    try {
      const response = await fetch("/api/data-export");
      if (!response.ok) throw new Error("Export failed");
      const data = await response.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `litagents-backup-${new Date().toISOString().split("T")[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast({ title: "Exportación completada", description: "Los datos se han descargado correctamente" });
    } catch (error) {
      toast({ title: "Error", description: "No se pudieron exportar los datos", variant: "destructive" });
    } finally {
      setIsExporting(false);
    }
  };

  const handleImportData = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    setIsImporting(true);
    try {
      const text = await file.text();
      const jsonData = JSON.parse(text);
      
      const response = await fetch("/api/data-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(jsonData),
      });
      
      if (!response.ok) throw new Error("Import failed");
      const result = await response.json();
      
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/pseudonyms"] });
      queryClient.invalidateQueries({ queryKey: ["/api/style-guides"] });
      queryClient.invalidateQueries({ queryKey: ["/api/series"] });
      
      toast({ 
        title: "Importación completada", 
        description: `Importados: ${Object.entries(result.results?.imported || {}).map(([k, v]) => `${v} ${k}`).join(", ")}` 
      });
    } catch (error) {
      toast({ title: "Error", description: "No se pudieron importar los datos. Verifica el formato del archivo.", variant: "destructive" });
    } finally {
      setIsImporting(false);
      event.target.value = "";
    }
  };

  const { data: agentStatuses = [] } = useQuery<AgentStatus[]>({
    queryKey: ["/api/agent-statuses"],
    refetchInterval: 2000,
  });

  const activeProject = projects.find(p => p.status === "generating");

  const { data: chapters = [] } = useQuery<Chapter[]>({
    queryKey: ["/api/projects", currentProject?.id, "chapters"],
    enabled: !!currentProject?.id,
    refetchInterval: currentProject?.status === "generating" ? 3000 : false,
  });

  const fetchLogs = () => {
    if (!currentProject?.id) return;
    
    fetch(`/api/projects/${currentProject.id}/activity-logs?limit=200`)
      .then(res => res.json())
      .then((historicalLogs: Array<{ id: number; level: string; message: string; agentRole?: string; createdAt: string }>) => {
        const levelToType: Record<string, LogEntry["type"]> = {
          info: "info",
          success: "success",
          warning: "editing",
          error: "error",
        };
        const mapped: LogEntry[] = historicalLogs.map(log => ({
          id: String(log.id),
          type: levelToType[log.level] || "info",
          message: log.message,
          timestamp: new Date(log.createdAt),
          agent: log.agentRole,
        }));
        setLogs(mapped);
      })
      .catch(console.error);
  };

  useEffect(() => {
    fetchLogs();
  }, [currentProject?.id]);

  useEffect(() => {
    if (currentProject?.status === "generating") {
      const interval = setInterval(fetchLogs, 3000);
      return () => clearInterval(interval);
    }
  }, [currentProject?.id, currentProject?.status]);

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
      console.log("[Resume] Sending resume request for project:", id);
      const response = await apiRequest("POST", `/api/projects/${id}/resume`);
      console.log("[Resume] Response status:", response.status);
      const data = await response.json();
      console.log("[Resume] Response data:", data);
      return data;
    },
    onSuccess: (data) => {
      console.log("[Resume] Success:", data);
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/agent-statuses"] });
      toast({ title: "Generación reanudada", description: "Continuando desde donde se detuvo" });
      addLog("success", "Reanudando generación del manuscrito...");
      setCompletedStages([]);
    },
    onError: (error) => {
      console.error("[Resume] Error:", error);
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
          } else if (data.type === "chapter_status_change") {
            queryClient.invalidateQueries({ queryKey: ["/api/projects", activeProject.id, "chapters"] });
          } else if (data.type === "chapter_complete") {
            const sectionName = data.chapterTitle === "Prólogo" ? "Prólogo" :
                               data.chapterTitle === "Epílogo" ? "Epílogo" :
                               data.chapterTitle === "Nota del Autor" ? "Nota del Autor" :
                               `Capítulo ${data.chapterNumber}`;
            addLog("success", `${sectionName} completado (${data.wordCount} palabras)`);
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
      status: (status?.status as "idle" | "thinking" | "writing" | "editing" | "reviewing" | "polishing" | "completed" | "error" | "analyzing" | "warning") || "idle",
      currentTask: status?.currentTask,
      lastActivity: status?.lastActivity ? new Date(status.lastActivity) : undefined,
    };
  };

  const completedChapters = chapters.filter(c => c.status === "completed").length;
  const totalWordCount = chapters.reduce((sum, c) => sum + (c.wordCount || 0), 0);

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
        {activeProject && (
          <Badge className="bg-green-500/20 text-green-600 dark:text-green-400 text-sm px-3 py-1">
            <div className="w-2 h-2 rounded-full bg-green-500 mr-2 animate-pulse" />
            Generando: {activeProject.title}
          </Badge>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
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
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <AgentCard 
          name={agentNames["continuity-sentinel"]}
          role="continuity-sentinel"
          {...getAgentStatus("continuity-sentinel")}
        />
        <AgentCard 
          name={agentNames["voice-auditor"]}
          role="voice-auditor"
          {...getAgentStatus("voice-auditor")}
        />
        <AgentCard 
          name={agentNames["semantic-detector"]}
          role="semantic-detector"
          {...getAgentStatus("semantic-detector")}
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
              <ConsoleOutput logs={logs} projectId={currentProject?.id} />
            </CardContent>
          </Card>

          {currentProject && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-4 pb-2">
                <CardTitle className="text-lg">Progreso del Manuscrito</CardTitle>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2 text-sm">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <span>{completedChapters}/{currentProject.chapterCount + (currentProject.hasPrologue ? 1 : 0) + (currentProject.hasEpilogue ? 1 : 0) + (currentProject.hasAuthorNote ? 1 : 0)} secciones</span>
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
                  {sortChaptersForDisplay(chapters).map((chapter) => (
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
                          {chapter.title === "Prólogo" ? "Prólogo" :
                           chapter.title === "Epílogo" ? "Epílogo" :
                           chapter.title === "Nota del Autor" ? "Nota del Autor" :
                           `Capítulo ${chapter.chapterNumber}`}
                        </span>
                        {chapter.title && chapter.title !== "Prólogo" && chapter.title !== "Epílogo" && chapter.title !== "Nota del Autor" && (
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
                
                {currentProject.status === "completed" && currentProject.finalScore && (
                  <div className="mt-4 p-4 rounded-md border border-border" 
                    style={{ 
                      backgroundColor: currentProject.finalScore >= 9 
                        ? 'hsl(var(--chart-2) / 0.1)' 
                        : currentProject.finalScore >= 7 
                          ? 'hsl(var(--chart-4) / 0.1)' 
                          : 'hsl(var(--destructive) / 0.1)'
                    }}
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div className="space-y-1">
                        <p className="text-sm font-medium">Puntuación Final del Revisor</p>
                        <p className="text-xs text-muted-foreground">
                          {currentProject.finalScore >= 9 
                            ? "Publicable - Calidad profesional" 
                            : currentProject.finalScore >= 7 
                              ? "Aceptable con reservas"
                              : "No publicable - Requiere revisión"}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className={`text-3xl font-bold ${
                          currentProject.finalScore >= 9 
                            ? 'text-green-600 dark:text-green-400' 
                            : currentProject.finalScore >= 7 
                              ? 'text-yellow-600 dark:text-yellow-400' 
                              : 'text-red-600 dark:text-red-400'
                        }`} data-testid="text-final-score">
                          {currentProject.finalScore}/10
                        </p>
                      </div>
                    </div>
                    
                    {/* Show Final Review Issues if available */}
                    {currentProject.finalReviewResult && (currentProject.finalReviewResult as any).issues?.length > 0 && (
                      <div className="mt-4 pt-4 border-t border-border/50">
                        <p className="text-sm font-medium mb-2">Issues Documentados ({(currentProject.finalReviewResult as any).issues.length})</p>
                        <div className="space-y-2 max-h-48 overflow-y-auto">
                          {((currentProject.finalReviewResult as any).issues as Array<{capitulo: number; problema: string; severidad: string; instrucciones_correccion: string}>).map((issue, idx) => (
                            <div 
                              key={idx} 
                              className="text-xs p-2 rounded bg-background/50 border border-border/30"
                              data-testid={`issue-${idx}`}
                            >
                              <div className="flex items-center gap-2 mb-1">
                                <Badge 
                                  variant={issue.severidad === "critica" ? "destructive" : issue.severidad === "mayor" ? "secondary" : "outline"}
                                  className="text-[10px] px-1.5 py-0"
                                >
                                  {issue.severidad}
                                </Badge>
                                <span className="text-muted-foreground">
                                  {issue.capitulo === 0 ? "Prólogo" : issue.capitulo === -1 ? "Epílogo" : `Cap. ${issue.capitulo}`}
                                </span>
                              </div>
                              <p className="text-foreground">{issue.problema}</p>
                              {issue.instrucciones_correccion && (
                                <p className="text-muted-foreground mt-1 italic">{issue.instrucciones_correccion}</p>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    
                    {/* Show Score Justification if available */}
                    {currentProject.finalReviewResult && (currentProject.finalReviewResult as any).justificacion_puntuacion && (
                      <div className="mt-4 pt-4 border-t border-border/50">
                        <p className="text-sm font-medium mb-2">Desglose de Puntuación</p>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          {Object.entries((currentProject.finalReviewResult as any).justificacion_puntuacion.puntuacion_desglosada || {}).map(([key, value]) => (
                            <div key={key} className="flex justify-between">
                              <span className="text-muted-foreground capitalize">{key.replace(/_/g, ' ')}:</span>
                              <span className="font-medium">{value as number}/10</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

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
                        <div className="flex items-center justify-end gap-1">
                          <p className="text-xs text-muted-foreground">USD estimado</p>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Info className="h-3 w-3 text-muted-foreground cursor-help" />
                            </TooltipTrigger>
                            <TooltipContent side="left" className="max-w-xs whitespace-pre-line text-xs">
                              {MODEL_PRICING_INFO}
                            </TooltipContent>
                          </Tooltip>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          {projects.length === 0 && (
            <Card>
              <CardContent className="pt-6 text-center space-y-4">
                <p className="text-muted-foreground">No hay proyectos creados</p>
                <Link href="/config">
                  <Button data-testid="button-new-project">
                    <Plus className="h-4 w-4 mr-2" />
                    Crear Proyecto
                  </Button>
                </Link>
              </CardContent>
            </Card>
          )}

          {currentProject && currentProject.status === "idle" && (
            <Card>
              <CardContent className="pt-6 space-y-3">
                <Button 
                  className="w-full" 
                  size="lg"
                  onClick={handleStartGeneration}
                  disabled={startGenerationMutation.isPending}
                  data-testid="button-continue-generation"
                >
                  <Play className="h-4 w-4 mr-2" />
                  Iniciar Generación
                </Button>
                <p className="text-xs text-muted-foreground text-center">
                  Proyecto: {currentProject.title}
                </p>
              </CardContent>
            </Card>
          )}

          {currentProject && (
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
                        onClick={() => setConfirmDialog("cancel")}
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
                        onClick={() => setConfirmDialog("forceComplete")}
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
                      onClick={() => setConfirmDialog("resume")}
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
                    onClick={() => setConfirmDialog("delete")}
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

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <Database className="h-5 w-5" />
                Gestión de Datos
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Exporta o importa todos los datos de la aplicación (proyectos, capítulos, configuraciones).
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleExportData}
                  disabled={isExporting}
                  data-testid="button-export-data"
                >
                  <Download className="h-4 w-4 mr-2" />
                  {isExporting ? "Exportando..." : "Exportar Datos"}
                </Button>
                
                <label>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={isImporting}
                    asChild
                    data-testid="button-import-data"
                  >
                    <span>
                      <Upload className="h-4 w-4 mr-2" />
                      {isImporting ? "Importando..." : "Importar Datos"}
                    </span>
                  </Button>
                  <input
                    type="file"
                    accept=".json"
                    onChange={handleImportData}
                    className="hidden"
                    data-testid="input-import-file"
                  />
                </label>
              </div>
            </CardContent>
          </Card>

          <DuplicateManager />
        </div>
      </div>

      <ConfirmDialog
        open={confirmDialog === "cancel"}
        onOpenChange={(open) => !open && setConfirmDialog(null)}
        title="Cancelar generación"
        description="¿Cancelar la generación? El progreso actual se mantendrá."
        confirmText="Cancelar generación"
        variant="destructive"
        onConfirm={() => {
          if (currentProject) cancelProjectMutation.mutate(currentProject.id);
          setConfirmDialog(null);
        }}
      />

      <ConfirmDialog
        open={confirmDialog === "forceComplete"}
        onOpenChange={(open) => !open && setConfirmDialog(null)}
        title="Forzar completado"
        description="¿Marcar como completado? Los capítulos con contenido se guardarán."
        confirmText="Completar"
        onConfirm={() => {
          if (currentProject) forceCompleteMutation.mutate(currentProject.id);
          setConfirmDialog(null);
        }}
      />

      <ConfirmDialog
        open={confirmDialog === "resume"}
        onOpenChange={(open) => !open && setConfirmDialog(null)}
        title="Continuar generación"
        description="¿Continuar la generación desde donde se detuvo?"
        confirmText="Continuar"
        onConfirm={() => {
          if (currentProject) resumeProjectMutation.mutate(currentProject.id);
          setConfirmDialog(null);
        }}
      />

      <ConfirmDialog
        open={confirmDialog === "delete"}
        onOpenChange={(open) => !open && setConfirmDialog(null)}
        title="Eliminar proyecto"
        description={`¿Estás seguro de eliminar "${currentProject?.title}"? Esta acción no se puede deshacer.`}
        confirmText="Eliminar"
        variant="destructive"
        onConfirm={() => {
          if (currentProject) deleteProjectMutation.mutate(currentProject.id);
          setConfirmDialog(null);
        }}
      />
    </div>
  );
}
