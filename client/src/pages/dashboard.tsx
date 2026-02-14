import React, { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AgentCard } from "@/components/agent-card";
import { ProcessFlow } from "@/components/process-flow";
import { ConsoleOutput, type LogEntry } from "@/components/console-output";
import { ConfirmDialog, ResumeDialog } from "@/components/confirm-dialog";
import { DuplicateManager } from "@/components/duplicate-manager";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Play, FileText, Clock, CheckCircle, Download, Archive, Copy, Trash2, ClipboardCheck, RefreshCw, Ban, CheckCheck, Plus, Upload, Database, Info, ExternalLink, Loader2, BookOpen, Crosshair, Merge, Pencil } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useProject } from "@/lib/project-context";
import { Link } from "wouter";
import type { Project, AgentStatus, Chapter, Series } from "@shared/schema";

import type { AgentRole } from "@/components/process-flow";

const agentNames: Record<string, string> = {
  architect: "El Arquitecto",
  ghostwriter: "El Narrador",
  editor: "El Editor",
  copyeditor: "El Estilista",
  "final-reviewer": "El Revisor Final",
  "continuity-sentinel": "El Centinela",
  "voice-auditor": "El Auditor de Voz",
  "semantic-detector": "El Detector Semántico",
  "global-architect": "Arquitecto Global",
  "chapter-architect": "Diseñador de Escenas",
  "ghostwriter-v2": "Escritor de Escenas",
  "smart-editor": "Editor Inteligente",
  "summarizer": "Compresor",
  "narrative-director": "Director Narrativo",
  "universal-consistency": "Guardián de Continuidad",
  "beta-reader": "El Crítico",
};

function sortChaptersForDisplay(chapters: Chapter[]): Chapter[] {
  return [...chapters].sort((a, b) => {
    const getOrder = (num: number) => {
      if (num === 0) return -1000; // Prologue first
      if (num === 998) return 9998; // Epilogue near end
      if (num === 999) return 9999; // Author note last
      return num;
    };
    return getOrder(a.chapterNumber) - getOrder(b.chapterNumber);
  });
}

function generateExpectedChapters(project: Project, existingChapters: Chapter[]): Chapter[] {
  const existingNumbers = new Set(existingChapters.map(c => c.chapterNumber));
  const expectedChapters: Chapter[] = [...existingChapters];
  
  const createPlaceholder = (id: number, chapterNumber: number, title: string): Chapter => ({
    id,
    projectId: project.id,
    chapterNumber,
    title,
    content: null,
    originalContent: null,
    summary: null,
    wordCount: 0,
    status: "pending",
    editorFeedback: null,
    needsRevision: false,
    revisionReason: null,
    continuityState: null,
    sceneBreakdown: null,
    qualityScore: null,
    createdAt: new Date(),
  });
  
  // Generate prologue placeholder if needed
  if (project.hasPrologue && !existingNumbers.has(0)) {
    expectedChapters.push(createPlaceholder(-1, 0, "Prólogo"));
  }
  
  // Generate normal chapter placeholders
  for (let i = 1; i <= project.chapterCount; i++) {
    if (!existingNumbers.has(i)) {
      expectedChapters.push(createPlaceholder(-i - 1, i, `Capítulo ${i}`));
    }
  }
  
  // Generate epilogue placeholder if needed
  if (project.hasEpilogue && !existingNumbers.has(998)) {
    expectedChapters.push(createPlaceholder(-998, 998, "Epílogo"));
  }
  
  // Generate author note placeholder if needed
  if (project.hasAuthorNote && !existingNumbers.has(999)) {
    expectedChapters.push(createPlaceholder(-999, 999, "Nota del Autor"));
  }
  
  return sortChaptersForDisplay(expectedChapters);
}

function calculateCost(inputTokens: number, outputTokens: number, thinkingTokens: number): number {
  // DeepSeek weighted average pricing (R1 for planning, V3 for writing)
  // R1: $0.55 input, $2.19 output | V3: $0.28 input, $0.42 output
  // Approx 30% R1 (planning), 70% V3 (writing/editing)
  const INPUT_PRICE_PER_MILLION = 0.36;  // 0.30*0.55 + 0.70*0.28
  const OUTPUT_PRICE_PER_MILLION = 0.95; // 0.30*2.19 + 0.70*0.42
  const THINKING_PRICE_PER_MILLION = 0.55; // R1 thinking rate
  
  const inputCost = (inputTokens / 1_000_000) * INPUT_PRICE_PER_MILLION;
  const outputCost = (outputTokens / 1_000_000) * OUTPUT_PRICE_PER_MILLION;
  const thinkingCost = (thinkingTokens / 1_000_000) * THINKING_PRICE_PER_MILLION;
  
  return inputCost + outputCost + thinkingCost;
}

const MODEL_PRICING_INFO = `Modelos DeepSeek usados:
• R1 (Arquitecto Global, Arquitecto Capítulos, Director Narrativo): $0.55/$2.19/M
• V3 (Escritor, Editor, Compresor): $0.28/$0.42/M

Precios promedio ponderados: Input $0.36/M, Output $0.95/M, Thinking $0.55/M`;

type ConfirmType = "cancel" | "forceComplete" | "resume" | "delete" | null;

interface DetectAndFixProgress {
  phase: 'detection' | 'correction';
  subPhase?: string;
  current: number;
  total: number;
  details?: {
    reviewNumber?: number;
    issuesFoundThisReview?: number;
    totalUniqueIssues?: number;
    issueIndex?: number;
    issueType?: string;
    issueChapter?: number;
    issueSeverity?: string;
    resolved?: number;
    escalated?: number;
  };
}

export default function Dashboard() {
  const { toast } = useToast();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [currentStage, setCurrentStage] = useState<AgentRole | null>(null);
  const [completedStages, setCompletedStages] = useState<AgentRole[]>([]);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmType>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [showArchitectDialog, setShowArchitectDialog] = useState(false);
  const [architectInstructions, setArchitectInstructions] = useState("");
  const [showExtendDialog, setShowExtendDialog] = useState(false);
  const [showResetReviewerDialog, setShowResetReviewerDialog] = useState(false);
  const [showMergeChaptersDialog, setShowMergeChaptersDialog] = useState(false);
  const [showEditMetadataDialog, setShowEditMetadataDialog] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editSeriesId, setEditSeriesId] = useState<number | null>(null);
  const [editSeriesOrder, setEditSeriesOrder] = useState<number | null>(null);
  const [editWorkType, setEditWorkType] = useState("standalone");
  const [rewriteChapterNumber, setRewriteChapterNumber] = useState<number | null>(null);
  const [rewriteInstructions, setRewriteInstructions] = useState("");
  const [showRewriteDialog, setShowRewriteDialog] = useState(false);
  const [mergeSource, setMergeSource] = useState<number | null>(null);
  const [mergeTarget, setMergeTarget] = useState<number | null>(null);
  const [targetChapters, setTargetChapters] = useState("");
  const [useV2Pipeline, setUseV2Pipeline] = useState(true);
  const [useGeminiArchitect, setUseGeminiArchitect] = useState(false);
  const [useGeminiQA, setUseGeminiQA] = useState<{ finalReviewer: boolean; continuitySentinel: boolean; narrativeDirector: boolean }>({ finalReviewer: false, continuitySentinel: false, narrativeDirector: false });
  const [sceneProgress, setSceneProgress] = useState<{chapterNumber: number; sceneNumber: number; totalScenes: number; wordCount: number} | null>(null);
  const [chaptersBeingCorrected, setChaptersBeingCorrected] = useState<{chapterNumbers: number[]; revisionCycle: number} | null>(null);
  const [detectAndFixProgress, setDetectAndFixProgress] = useState<DetectAndFixProgress | null>(null);
  const [correctionSystem, setCorrectionSystem] = useState<'detect-fix' | 'legacy'>('detect-fix');
  const { projects, currentProject, setSelectedProjectId } = useProject();
  
  // Load correction system preference from server on mount
  useEffect(() => {
    fetch('/api/config/correction-system')
      .then(res => res.json())
      .then(data => {
        if (data.correctionSystem === 'detect-fix' || data.correctionSystem === 'legacy') {
          setCorrectionSystem(data.correctionSystem);
        }
      })
      .catch(() => {/* ignore, use default */});
  }, []);
  
  // Sync correction system preference to server and localStorage
  const updateCorrectionSystem = (value: 'detect-fix' | 'legacy') => {
    setCorrectionSystem(value);
    localStorage.setItem('litagents-correction-system', value);
    fetch('/api/config/correction-system', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ correctionSystem: value })
    }).catch(() => {/* ignore errors */});
  };

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

  const { data: worldBible } = useQuery<{ plotOutline?: { chapterOutlines?: Array<{ number: number; summary: string; keyEvents: string[] }> } }>({
    queryKey: ["/api/projects", currentProject?.id, "world-bible"],
    enabled: !!currentProject?.id,
  });

  // Extract chapter titles from outline
  const outlineTitles = worldBible?.plotOutline?.chapterOutlines?.reduce((acc, ch) => {
    acc[ch.number] = ch.summary?.substring(0, 60) + (ch.summary && ch.summary.length > 60 ? "..." : "");
    return acc;
  }, {} as Record<number, string>) || {};

  // Use projectId parameter to avoid stale closures
  const fetchLogsForProject = (projectId: number) => {
    fetch(`/api/projects/${projectId}/activity-logs?limit=200`)
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

  // Store currentProject.id in a ref to use in intervals without stale closures
  const currentProjectIdRef = useRef<number | null>(null);
  
  useEffect(() => {
    // CRITICAL: Clear ALL project-specific UI state when switching projects
    setLogs([]);
    setCurrentStage(null);
    setCompletedStages([]);
    setSceneProgress(null);
    setChaptersBeingCorrected(null);
    setDetectAndFixProgress(null);
    
    // Update ref with current project ID
    currentProjectIdRef.current = currentProject?.id ?? null;
    
    // Only fetch logs if there's a selected project
    if (currentProject?.id) {
      fetchLogsForProject(currentProject.id);
    }
  }, [currentProject?.id]);

  useEffect(() => {
    if (currentProject?.id) {
      const projectId = currentProject.id;
      // Always auto-refresh logs every 3 seconds when a project is selected
      const interval = setInterval(() => {
        // Double-check the ref matches to prevent stale fetches
        if (currentProjectIdRef.current === projectId) {
          fetchLogsForProject(projectId);
        }
      }, 3000);
      return () => clearInterval(interval);
    }
  }, [currentProject?.id]);

  const saveArchitectInstructionsMutation = useMutation({
    mutationFn: async (params: { projectId: number; instructions: string }) => {
      const response = await apiRequest("PATCH", `/api/projects/${params.projectId}`, {
        architectInstructions: params.instructions,
      });
      return response.json();
    },
  });

  const startGenerationMutation = useMutation({
    mutationFn: async (params: { projectId: number; instructions?: string; useV2?: boolean; useGeminiArchitect?: boolean; useGeminiQA?: { finalReviewer?: boolean; continuitySentinel?: boolean; narrativeDirector?: boolean } }) => {
      if (params.instructions) {
        await saveArchitectInstructionsMutation.mutateAsync({
          projectId: params.projectId,
          instructions: params.instructions,
        });
      }
      const endpoint = params.useV2 
        ? `/api/projects/${params.projectId}/generate-v2`
        : `/api/projects/${params.projectId}/generate`;
      const response = await apiRequest("POST", endpoint, { useGeminiArchitect: params.useGeminiArchitect || false, useGeminiQA: params.useGeminiQA || {} });
      return response.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      addLog("info", variables.useV2 ? "Generación iniciada (LitAgents 2.0 - Escenas)" : "Generación iniciada");
      setShowArchitectDialog(false);
      setArchitectInstructions("");
      setUseV2Pipeline(false);
      setUseGeminiArchitect(false);
      setUseGeminiQA({ finalReviewer: false, continuitySentinel: false, narrativeDirector: false });
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
      // Clear all UI state before switching to the new duplicated project
      setLogs([]);
      setCurrentStage(null);
      setCompletedStages([]);
      setSceneProgress(null);
      setChaptersBeingCorrected(null);
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      setSelectedProjectId(project.id);
      toast({ title: "Proyecto duplicado", description: `"${project.title}" ha sido creado` });
    },
    onError: () => {
      toast({ title: "Error", description: "No se pudo duplicar el proyecto", variant: "destructive" });
    },
  });

  const { data: allSeries = [] } = useQuery<Series[]>({
    queryKey: ["/api/series"],
  });

  const updateProjectMetadataMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Record<string, any> }) => {
      const response = await apiRequest("PATCH", `/api/projects/${id}`, data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      setShowEditMetadataDialog(false);
      toast({ title: "Datos actualizados", description: "Los datos del proyecto se han actualizado correctamente" });
    },
    onError: () => {
      toast({ title: "Error", description: "No se pudieron actualizar los datos", variant: "destructive" });
    },
  });

  const openEditMetadataDialog = () => {
    if (!currentProject) return;
    setEditTitle(currentProject.title);
    setEditWorkType(currentProject.workType || "standalone");
    setEditSeriesId(currentProject.seriesId ?? null);
    setEditSeriesOrder(currentProject.seriesOrder ?? null);
    setShowEditMetadataDialog(true);
  };

  const handleSaveMetadata = () => {
    if (!currentProject) return;
    const data: Record<string, any> = { title: editTitle };
    if (editWorkType === "standalone") {
      data.workType = "standalone";
      data.seriesId = null;
      data.seriesOrder = null;
    } else {
      data.workType = editWorkType;
      data.seriesId = editSeriesId;
      data.seriesOrder = editSeriesOrder;
    }
    updateProjectMetadataMutation.mutate({ id: currentProject.id, data });
  };

  const deleteProjectMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/projects/${id}`);
    },
    onSuccess: () => {
      // Clear all UI state related to the deleted project
      setLogs([]);
      setCurrentStage(null);
      setCompletedStages([]);
      setSceneProgress(null);
      setChaptersBeingCorrected(null);
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      setSelectedProjectId(null);
      toast({ title: "Proyecto eliminado" });
    },
    onError: () => {
      toast({ title: "Error", description: "No se pudo eliminar el proyecto", variant: "destructive" });
    },
  });

  const finalReviewMutation = useMutation({
    mutationFn: async (params: { id: number; useGeminiQA?: { finalReviewer?: boolean; continuitySentinel?: boolean; narrativeDirector?: boolean } }) => {
      const response = await apiRequest("POST", `/api/projects/${params.id}/final-review`, { useGeminiQA: params.useGeminiQA || {} });
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

  const restartCorrectionsMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await apiRequest("POST", `/api/projects/${id}/restart-corrections`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      toast({ title: "Correcciones reiniciadas", description: "Reiniciando desde ciclo 0/15" });
      addLog("thinking", "Reiniciando correcciones desde cero...", "smart-editor");
    },
    onError: () => {
      toast({ title: "Error", description: "No se pudo reiniciar las correcciones", variant: "destructive" });
    },
  });

  const detectAndFixMutation = useMutation({
    mutationFn: async (params: { id: number; useGeminiQA?: { finalReviewer?: boolean; continuitySentinel?: boolean; narrativeDirector?: boolean } }) => {
      const response = await apiRequest("POST", `/api/projects/${params.id}/detect-and-fix`, { useGeminiQA: params.useGeminiQA || {} });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      toast({ title: "Detectar y Corregir iniciado", description: "Fase 1: 3 revisiones exhaustivas → Fase 2: Corrección verificada" });
      addLog("thinking", "Iniciando estrategia 'Detect All, Then Fix'...", "final-reviewer");
    },
    onError: () => {
      toast({ title: "Error", description: "No se pudo iniciar la detección y corrección", variant: "destructive" });
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

  const cancelCorrectionMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await apiRequest("POST", `/api/projects/${id}/cancel-correction`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/agent-statuses"] });
      toast({ title: "Corrección cancelada", description: "El proceso de corrección ha sido detenido" });
      addLog("info", "Corrección cancelada por el usuario");
    },
    onError: () => {
      toast({ title: "Error", description: "No se pudo cancelar la corrección", variant: "destructive" });
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
      setCompletedStages(["global-architect", "chapter-architect", "ghostwriter-v2", "universal-consistency", "smart-editor", "summarizer", "narrative-director", "beta-reader"]);
    },
    onError: () => {
      toast({ title: "Error", description: "No se pudo completar el proyecto", variant: "destructive" });
    },
  });

  const resetReviewerMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await apiRequest("POST", `/api/projects/${id}/reset-reviewer`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/agent-statuses"] });
      setShowResetReviewerDialog(false);
      toast({ title: "Crítico reiniciado", description: "La próxima evaluación comenzará desde cero" });
      addLog("info", "Estado del crítico reiniciado - sin historial previo", "final-reviewer");
    },
    onError: () => {
      toast({ title: "Error", description: "No se pudo reiniciar el crítico", variant: "destructive" });
    },
  });

  const critiqueMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await apiRequest("POST", `/api/projects/${id}/critique`);
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Análisis iniciado", description: "El Crítico está evaluando la novela..." });
      addLog("info", "Beta Reader iniciado - analizando viabilidad comercial", "beta-reader");
      setCurrentStage("beta-reader");
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  // ==================== TARGETED REPAIR SYSTEM ====================
  const [showRepairPlanDialog, setShowRepairPlanDialog] = useState(false);
  const [repairPlanData, setRepairPlanData] = useState<any>(null);

  const diagnoseMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await apiRequest("POST", `/api/projects/${id}/targeted-repair/diagnose`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      toast({ title: "Diagnóstico iniciado", description: "Analizando la novela para detectar desviaciones..." });
      addLog("thinking", "Diagnosticando novela completa para reparación dirigida...", "targeted-repair");
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "No se pudo iniciar el diagnóstico", variant: "destructive" });
    },
  });

  const fetchRepairPlan = async (projectId: number) => {
    try {
      const response = await fetch(`/api/projects/${projectId}/targeted-repair/plan`);
      const data = await response.json();
      setRepairPlanData(data);
      setShowRepairPlanDialog(true);
    } catch {
      toast({ title: "Error", description: "No se pudo obtener el plan de reparación", variant: "destructive" });
    }
  };

  const executeRepairMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await apiRequest("POST", `/api/projects/${id}/targeted-repair/execute`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      setShowRepairPlanDialog(false);
      toast({ title: "Reparación iniciada", description: "Ejecutando correcciones dirigidas con verificación..." });
      addLog("thinking", "Ejecutando plan de reparación dirigida...", "targeted-repair");
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "No se pudo ejecutar la reparación", variant: "destructive" });
    },
  });

  const cancelRepairMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await apiRequest("POST", `/api/projects/${id}/targeted-repair/cancel`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      setRepairPlanData(null);
      toast({ title: "Reparación cancelada" });
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

  const restartFromScratchMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await apiRequest("POST", `/api/projects/${id}/restart-from-scratch`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/agent-statuses"] });
      toast({ title: "Reinicio completo", description: "Generando novela desde cero" });
      addLog("success", "Reiniciando generación desde cero...");
      setCompletedStages([]);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "No se pudo reiniciar el proyecto", variant: "destructive" });
    },
  });

  const extendProjectMutation = useMutation({
    mutationFn: async ({ id, targetChapters }: { id: number; targetChapters: number }) => {
      const response = await apiRequest("POST", `/api/projects/${id}/extend`, { targetChapters });
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/agent-statuses"] });
      toast({ 
        title: "Extensión iniciada", 
        description: `Generando capítulos ${data.fromChapter} a ${data.toChapter}` 
      });
      addLog("success", `Extendiendo novela: generando capítulos ${data.fromChapter} a ${data.toChapter}...`);
      setCompletedStages([]);
      setShowExtendDialog(false);
      setTargetChapters("");
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "No se pudo extender el proyecto", variant: "destructive" });
    },
  });

  const mergeChaptersMutation = useMutation({
    mutationFn: async ({ projectId, sourceChapterNumber, targetChapterNumber }: { projectId: number; sourceChapterNumber: number; targetChapterNumber: number }) => {
      const response = await apiRequest("POST", `/api/projects/${projectId}/merge-chapters`, { sourceChapterNumber, targetChapterNumber });
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", currentProject?.id, "chapters"] });
      toast({ 
        title: "Capitulos fusionados", 
        description: data.message || "Fusion completada exitosamente"
      });
      setShowMergeChaptersDialog(false);
      setMergeSource(null);
      setMergeTarget(null);
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "No se pudo fusionar los capítulos", variant: "destructive" });
    },
  });

  const rewriteChapterMutation = useMutation({
    mutationFn: async ({ projectId, chapterNumber, instructions }: { projectId: number; chapterNumber: number; instructions?: string }) => {
      if (instructions && instructions.trim().length > 0) {
        const response = await apiRequest("POST", `/api/projects/${projectId}/chapters/${chapterNumber}/rewrite`, { instructions });
        return response.json();
      } else {
        const response = await apiRequest("POST", `/api/projects/${projectId}/regenerate-chapter/${chapterNumber}`);
        return response.json();
      }
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", currentProject?.id, "chapters"] });
      toast({
        title: "Reescritura iniciada",
        description: data.message || "El capítulo se está reescribiendo",
      });
      setShowRewriteDialog(false);
      setRewriteChapterNumber(null);
      setRewriteInstructions("");
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "No se pudo reescribir el capítulo", variant: "destructive" });
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
            queryClient.invalidateQueries({ queryKey: ["/api/agent-statuses"] });
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
          } else if (data.type === "scene_complete") {
            setSceneProgress({
              chapterNumber: data.chapterNumber,
              sceneNumber: data.sceneNumber,
              totalScenes: data.totalScenes || 4,
              wordCount: data.wordCount
            });
            addLog("writing", `Escena ${data.sceneNumber}/${data.totalScenes || '?'} del capítulo ${data.chapterNumber} completada (${data.wordCount} palabras)`, "ghostwriter-v2" as AgentRole);
          } else if (data.type === "chapter_complete") {
            setSceneProgress(null);
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
            setChaptersBeingCorrected(null);
            setSceneProgress(null);
          } else if (data.type === "error") {
            addLog("error", data.message || "Error durante la generación");
          } else if (data.type === "chapters_being_corrected") {
            if (data.chapterNumbers && data.chapterNumbers.length > 0) {
              setChaptersBeingCorrected({
                chapterNumbers: data.chapterNumbers,
                revisionCycle: data.revisionCycle || 1
              });
            } else {
              setChaptersBeingCorrected(null);
            }
          } else if (data.type === "detect_and_fix_progress") {
            setDetectAndFixProgress({
              phase: data.phase,
              subPhase: data.subPhase,
              current: data.current,
              total: data.total,
              details: data.details
            });
          } else if (data.type === "detect_and_fix_complete") {
            setDetectAndFixProgress(null);
            queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
            toast({
              title: "Detección y Corrección completada",
              description: `Resueltos: ${data.totalResolved}/${data.totalDetected}, Escalados: ${data.totalEscalated}`,
            });
          } else if (data.type === "targeted_repair_diagnosis_complete") {
            queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
            toast({
              title: "Diagnóstico completado",
              description: `Se encontraron ${data.planLength} capítulos con problemas`,
            });
            addLog("success", `Diagnóstico completado: ${data.planLength} capítulos necesitan reparación`, "targeted-repair");
          } else if (data.type === "targeted_repair_complete") {
            queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
            queryClient.invalidateQueries({ queryKey: ["/api/projects", activeProject?.id, "chapters"] });
            toast({
              title: "Reparación dirigida completada",
              description: `${data.totalFixed}/${data.totalIssues} problemas resueltos`,
            });
            addLog("success", `Reparación completada: ${data.totalFixed}/${data.totalIssues} problemas resueltos`, "targeted-repair");
          } else if (data.type === "targeted_repair_chapter_progress") {
            addLog("info", `Reparando capítulo ${data.chapterNumber}: ${data.message}`, "targeted-repair");
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

  const completedChapters = chapters.filter(c => c.status === "completed" || c.status === "approved").length;
  const totalWordCount = chapters.reduce((sum, c) => sum + (c.wordCount || 0), 0);

  const handleStartGeneration = () => {
    if (currentProject && currentProject.status === "idle") {
      // Load existing instructions if any
      setArchitectInstructions(currentProject.architectInstructions || "");
      setShowArchitectDialog(true);
    }
  };

  const handleConfirmGeneration = () => {
    if (currentProject) {
      startGenerationMutation.mutate({
        projectId: currentProject.id,
        instructions: architectInstructions.trim() || undefined,
        useV2: useV2Pipeline,
        useGeminiArchitect: useGeminiArchitect,
        useGeminiQA: useGeminiQA,
      });
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
        <div className="flex items-center gap-4">
          {activeProject && (
            <Badge className="bg-green-500/20 text-green-600 dark:text-green-400 text-sm px-3 py-1">
              <div className="w-2 h-2 rounded-full bg-green-500 mr-2 animate-pulse" />
              Generando: {activeProject.title}
            </Badge>
          )}
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg border bg-card">
            <span className="text-sm text-muted-foreground whitespace-nowrap">Sistema de Corrección:</span>
            <Select value={correctionSystem} onValueChange={(v) => updateCorrectionSystem(v as 'detect-fix' | 'legacy')}>
              <SelectTrigger className="w-[200px] h-8" data-testid="select-correction-system-global">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="detect-fix">Detect & Fix (v2.9.4)</SelectItem>
                <SelectItem value="legacy">Revisión Clásica</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {currentProject && (
        <div className="flex items-center gap-3 p-3 rounded-lg border bg-card">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold truncate">{currentProject.title}</span>
              {currentProject.seriesOrder && (
                <Badge variant="secondary" className="text-xs">
                  Vol. {currentProject.seriesOrder}
                </Badge>
              )}
              <Badge variant="secondary" className="text-xs">
                {currentProject.workType === "standalone" ? "Independiente" :
                 currentProject.workType === "series" ? "Serie" :
                 currentProject.workType === "trilogy" ? "Trilogía" :
                 currentProject.workType === "bookbox" ? "Bookbox" : currentProject.workType}
              </Badge>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={openEditMetadataDialog}
            disabled={currentProject.status === "generating"}
            data-testid="button-edit-metadata-header"
          >
            <Pencil className="h-4 w-4 mr-2" />
            Editar Datos
          </Button>
        </div>
      )}

      {/* Agentes v2 - Pipeline por escenas */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-muted-foreground">
          Pipeline por Escenas
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <AgentCard 
            name={agentNames["global-architect"]}
            role="global-architect"
            {...getAgentStatus("global-architect")}
          />
          <AgentCard 
            name={agentNames["chapter-architect"]}
            role="chapter-architect"
            {...getAgentStatus("chapter-architect")}
          />
          <AgentCard 
            name={agentNames["ghostwriter-v2"]}
            role="ghostwriter-v2"
            {...getAgentStatus("ghostwriter-v2")}
          />
          <AgentCard 
            name={agentNames["smart-editor"]}
            role="smart-editor"
            {...getAgentStatus("smart-editor")}
          />
          <AgentCard 
            name={agentNames["summarizer"]}
            role="summarizer"
            {...getAgentStatus("summarizer")}
          />
          <AgentCard 
            name={agentNames["narrative-director"]}
            role="narrative-director"
            {...getAgentStatus("narrative-director")}
          />
          <AgentCard 
            name={agentNames["universal-consistency"]}
            role="universal-consistency"
            {...getAgentStatus("universal-consistency")}
          />
          <AgentCard 
            name={agentNames["beta-reader"]}
            role="beta-reader"
            {...getAgentStatus("beta-reader")}
          />
        </div>
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
                <div className="flex items-center gap-4 flex-wrap">
                  <div className="flex items-center gap-2 text-sm">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <span>{completedChapters}/{currentProject.chapterCount + (currentProject.hasPrologue ? 1 : 0) + (currentProject.hasEpilogue ? 1 : 0) + (currentProject.hasAuthorNote ? 1 : 0)} secciones</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    <span>{totalWordCount.toLocaleString()} palabras</span>
                  </div>
                  {sceneProgress && currentProject.status === "generating" && (
                    <Badge variant="secondary" className="animate-pulse" data-testid="badge-scene-progress">
                      Escena {sceneProgress.sceneNumber}/{sceneProgress.totalScenes} - Cap. {sceneProgress.chapterNumber}
                    </Badge>
                  )}
                  {chapters && chapters.filter(c => c.chapterNumber >= 0 && c.chapterNumber < 998).length >= 2 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowMergeChaptersDialog(true)}
                      data-testid="button-merge-chapters-global"
                    >
                      <Merge className="h-4 w-4 mr-2" />
                      Fusionar Capítulos
                    </Button>
                  )}
                  {chaptersBeingCorrected && chaptersBeingCorrected.chapterNumbers.length > 0 && (
                    <Badge variant="outline" className="animate-pulse border-orange-500 text-orange-600 dark:text-orange-400" data-testid="badge-chapters-correcting">
                      Corrigiendo Cap. {chaptersBeingCorrected.chapterNumbers.join(', ')} (Ciclo {chaptersBeingCorrected.revisionCycle})
                    </Badge>
                  )}
                  {detectAndFixProgress && (
                    <div className="flex flex-col gap-2 mt-2 p-3 rounded-lg bg-muted/50 border" data-testid="detect-and-fix-progress">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Crosshair className={`h-4 w-4 ${detectAndFixProgress.phase === 'detection' ? 'text-blue-500' : 'text-green-500'}`} />
                          <span className="font-medium text-sm">
                            {detectAndFixProgress.phase === 'detection' ? 'Fase 1: Detección' : 'Fase 2: Corrección'}
                          </span>
                        </div>
                        <Badge variant={detectAndFixProgress.phase === 'detection' ? 'default' : 'secondary'}>
                          {detectAndFixProgress.current}/{detectAndFixProgress.total}
                        </Badge>
                      </div>
                      <div className="w-full bg-muted rounded-full h-2">
                        <div 
                          className={`h-2 rounded-full transition-all duration-300 ${detectAndFixProgress.phase === 'detection' ? 'bg-blue-500' : 'bg-green-500'}`}
                          style={{ width: `${(detectAndFixProgress.current / detectAndFixProgress.total) * 100}%` }}
                        />
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {detectAndFixProgress.phase === 'detection' ? (
                          <>
                            {detectAndFixProgress.subPhase === 'reviewing' && `Revisión ${detectAndFixProgress.details?.reviewNumber}/3 en progreso...`}
                            {detectAndFixProgress.subPhase === 'review_complete' && `Revisión ${detectAndFixProgress.details?.reviewNumber} completada: ${detectAndFixProgress.details?.issuesFoundThisReview} nuevos issues (${detectAndFixProgress.details?.totalUniqueIssues} únicos)`}
                            {detectAndFixProgress.subPhase === 'complete' && `Detección completa: ${detectAndFixProgress.details?.totalUniqueIssues} issues únicos encontrados`}
                            {detectAndFixProgress.subPhase === 'starting' && 'Iniciando 3 revisiones exhaustivas...'}
                          </>
                        ) : (
                          <>
                            {detectAndFixProgress.subPhase === 'fixing' && (
                              <span className="flex items-center gap-1">
                                <Loader2 className="h-3 w-3 animate-spin" />
                                Cap {detectAndFixProgress.details?.issueChapter}: {detectAndFixProgress.details?.issueType}
                                <Badge variant="outline" className="text-xs ml-1">
                                  {detectAndFixProgress.details?.issueSeverity}
                                </Badge>
                              </span>
                            )}
                            {detectAndFixProgress.subPhase === 'issue_resolved' && `Issue resuelto - Cap ${detectAndFixProgress.details?.issueChapter}`}
                            {detectAndFixProgress.subPhase === 'issue_escalated' && `Issue escalado - Cap ${detectAndFixProgress.details?.issueChapter}`}
                            {detectAndFixProgress.subPhase === 'complete' && `Completado: ${detectAndFixProgress.details?.resolved} resueltos, ${detectAndFixProgress.details?.escalated} escalados`}
                            {detectAndFixProgress.subPhase === 'starting' && `Iniciando corrección de ${detectAndFixProgress.total} issues...`}
                          </>
                        )}
                      </div>
                      {detectAndFixProgress.phase === 'correction' && detectAndFixProgress.details && (
                        <div className="flex gap-2 text-xs">
                          <span className="text-green-600 dark:text-green-400">Resueltos: {detectAndFixProgress.details.resolved || 0}</span>
                          <span className="text-yellow-600 dark:text-yellow-400">Escalados: {detectAndFixProgress.details.escalated || 0}</span>
                        </div>
                      )}
                    </div>
                  )}
                  {(currentProject.status === "completed" || currentProject.status === "awaiting_final_review") && (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => critiqueMutation.mutate(currentProject.id)}
                        disabled={critiqueMutation.isPending}
                        data-testid="button-critique"
                      >
                        <BookOpen className="h-4 w-4 mr-2" />
                        {critiqueMutation.isPending ? "Analizando..." : "Criticar"}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          if (correctionSystem === 'detect-fix') {
                            detectAndFixMutation.mutate({ id: currentProject.id, useGeminiQA });
                          } else {
                            finalReviewMutation.mutate({ id: currentProject.id, useGeminiQA });
                          }
                        }}
                        disabled={finalReviewMutation.isPending || detectAndFixMutation.isPending}
                        data-testid="button-run-correction"
                      >
                        {correctionSystem === 'detect-fix' ? (
                          <Crosshair className="h-4 w-4 mr-2" />
                        ) : (
                          <ClipboardCheck className="h-4 w-4 mr-2" />
                        )}
                        {(finalReviewMutation.isPending || detectAndFixMutation.isPending) 
                          ? "Procesando..." 
                          : correctionSystem === 'detect-fix' ? "Detect & Fix" : "Revisión Final"}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => diagnoseMutation.mutate(currentProject.id)}
                        disabled={diagnoseMutation.isPending}
                        data-testid="button-diagnose-repair"
                      >
                        <Crosshair className="h-4 w-4 mr-2" />
                        {diagnoseMutation.isPending ? "Diagnosticando..." : "Diagnosticar"}
                      </Button>
                      {Array.isArray(currentProject.targetedRepairPlan) && currentProject.targetedRepairPlan.length > 0 && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => fetchRepairPlan(currentProject.id)}
                          data-testid="button-view-repair-plan"
                        >
                          <FileText className="h-4 w-4 mr-2" />
                          Ver Plan ({currentProject.targetedRepairPlan.length})
                        </Button>
                      )}
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
                  {generateExpectedChapters(currentProject, chapters).map((chapter) => (
                    <div 
                      key={chapter.id}
                      className="flex items-center justify-between gap-4 p-2 rounded-md bg-muted/50"
                      data-testid={`progress-chapter-${chapter.chapterNumber}`}
                    >
                      <div className="flex items-center gap-2">
                        {(chapter.status === "completed" || chapter.status === "approved") ? (
                          <CheckCircle className="h-4 w-4 text-green-500" />
                        ) : chapter.status === "revision" ? (
                          <RefreshCw className="h-4 w-4 text-orange-500 animate-spin" />
                        ) : sceneProgress && sceneProgress.chapterNumber === chapter.chapterNumber ? (
                          <Loader2 className="h-4 w-4 text-primary animate-spin" />
                        ) : (
                          <Clock className="h-4 w-4 text-muted-foreground" />
                        )}
                        <span className="text-sm font-medium">
                          {chapter.chapterNumber === 0 ? "Prólogo" :
                           chapter.chapterNumber === 998 ? "Epílogo" :
                           chapter.chapterNumber === 999 ? "Nota del Autor" :
                           `Cap. ${chapter.chapterNumber}`}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="text-sm text-muted-foreground truncate block">
                          {chapter.title || outlineTitles[chapter.chapterNumber] || ""}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {sceneProgress && sceneProgress.chapterNumber === chapter.chapterNumber && currentProject.status === "generating" && (
                          <Badge variant="outline" className="text-xs animate-pulse bg-primary/10">
                            Escena {sceneProgress.sceneNumber}/{sceneProgress.totalScenes}
                          </Badge>
                        )}
                        {chaptersBeingCorrected && chaptersBeingCorrected.chapterNumbers.includes(chapter.chapterNumber) && (
                          <Badge variant="outline" className="text-xs animate-pulse border-orange-500 text-orange-600 dark:text-orange-400">
                            Corrigiendo
                          </Badge>
                        )}
                        {chapter.wordCount && chapter.wordCount > 0 && (
                          <span className="text-xs text-muted-foreground">
                            {chapter.wordCount.toLocaleString()} pal.
                          </span>
                        )}
                        <Badge 
                          variant={(chapter.status === "completed" || chapter.status === "approved") ? "default" : chapter.status === "revision" ? "destructive" : "secondary"}
                          className="text-xs"
                        >
                          {(chapter.status === "completed" || chapter.status === "approved") ? "Listo" : 
                           chapter.status === "writing" ? "Escribiendo" :
                           chapter.status === "editing" ? "Editando" : 
                           chapter.status === "revision" ? "Reescribiendo" : "Pendiente"}
                        </Badge>
                        {(chapter.status === "completed" || chapter.status === "approved" || (chapter.content && chapter.content.length > 0)) && currentProject.status !== "generating" && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                size="icon"
                                variant="ghost"
                                data-testid={`button-rewrite-chapter-${chapter.chapterNumber}`}
                                onClick={() => {
                                  setRewriteChapterNumber(chapter.chapterNumber);
                                  setRewriteInstructions("");
                                  setShowRewriteDialog(true);
                                }}
                                disabled={rewriteChapterMutation.isPending}
                              >
                                <RefreshCw className="h-3.5 w-3.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Reescribir capítulo</TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                    </div>
                  ))}
                  {chapters.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      Los capítulos aparecerán aquí conforme se generen
                    </p>
                  )}
                </div>
                
                {currentProject.finalScore && (
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
                          {currentProject.revisionCycle && currentProject.revisionCycle > 0 && (
                            <span className="ml-2">(Ciclo {currentProject.revisionCycle})</span>
                          )}
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
                    
                    {/* Show QA Audit Report if available */}
                    {currentProject.qaAuditReport && (currentProject.qaAuditReport as any).totalFindings !== undefined && (
                      <div className="mt-4 pt-4 border-t border-border/50">
                        <p className="text-sm font-medium mb-2 flex items-center gap-2">
                          <span>Informe Auditoría QA</span>
                          {(currentProject.qaAuditReport as any).successCount > 0 && (
                            <Badge variant="default" className="text-[10px] px-1.5 py-0 bg-green-600">
                              {(currentProject.qaAuditReport as any).successCount} corregidos
                            </Badge>
                          )}
                          {(currentProject.qaAuditReport as any).failCount > 0 && (
                            <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                              {(currentProject.qaAuditReport as any).failCount} fallidos
                            </Badge>
                          )}
                        </p>
                        
                        {(currentProject.qaAuditReport as any).totalFindings === 0 ? (
                          <p className="text-xs text-green-600 dark:text-green-400">
                            No se detectaron problemas. El manuscrito está limpio.
                          </p>
                        ) : (
                          <div className="space-y-2">
                            <p className="text-xs text-muted-foreground">
                              {(currentProject.qaAuditReport as any).totalFindings} problema(s) detectado(s) pre-revisión
                            </p>
                            
                            {/* Findings grouped by source */}
                            {(() => {
                              const findings = (currentProject.qaAuditReport as any).findings || [];
                              const bySource = findings.reduce((acc: Record<string, any[]>, f: any) => {
                                if (!acc[f.source]) acc[f.source] = [];
                                acc[f.source].push(f);
                                return acc;
                              }, {} as Record<string, any[]>);
                              
                              return Object.entries(bySource).map(([source, issues]) => (
                                <div key={source} className="text-xs p-2 rounded bg-background/50 border border-border/30">
                                  <div className="font-medium text-foreground mb-1 flex items-center gap-2">
                                    <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                                      {source.replace(/_/g, ' ')}
                                    </Badge>
                                    <span className="text-muted-foreground">{(issues as any[]).length} problema(s)</span>
                                  </div>
                                  <div className="space-y-1 max-h-24 overflow-y-auto">
                                    {(issues as any[]).slice(0, 3).map((issue: any, idx: number) => (
                                      <div key={idx} className="flex items-start gap-2">
                                        <Badge 
                                          variant={issue.severity === "critica" ? "destructive" : "secondary"}
                                          className="text-[9px] px-1 py-0 shrink-0"
                                        >
                                          {issue.severity}
                                        </Badge>
                                        <span className="text-muted-foreground">
                                          {issue.chapter ? `Cap ${issue.chapter}: ` : ''}
                                          {issue.description?.substring(0, 80)}...
                                        </span>
                                      </div>
                                    ))}
                                    {(issues as any[]).length > 3 && (
                                      <p className="text-muted-foreground italic">
                                        + {(issues as any[]).length - 3} más...
                                      </p>
                                    )}
                                  </div>
                                </div>
                              ));
                            })()}
                            
                            {/* Corrections summary */}
                            {(currentProject.qaAuditReport as any).corrections?.length > 0 && (
                              <div className="mt-2 p-2 rounded bg-green-500/10 border border-green-500/30">
                                <p className="text-xs font-medium text-green-600 dark:text-green-400 mb-1">
                                  Correcciones Aplicadas
                                </p>
                                <div className="flex flex-wrap gap-1">
                                  {((currentProject.qaAuditReport as any).corrections as any[])
                                    .filter((c: any) => c.success)
                                    .map((c: any, idx: number) => (
                                      <Badge key={idx} variant="outline" className="text-[10px] px-1.5 py-0 bg-green-500/20">
                                        Cap {c.chapter}: {c.issueCount} arreglado(s)
                                      </Badge>
                                    ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                    
                    {/* Show Final Review Issues if available */}
                    {currentProject.finalReviewResult && (currentProject.finalReviewResult as any).issues?.length > 0 && (
                      <div className="mt-4 pt-4 border-t border-border/50">
                        <p className="text-sm font-medium mb-2">Issues Documentados ({(currentProject.finalReviewResult as any).issues.length})</p>
                        <div className="space-y-2 max-h-48 overflow-y-auto">
                          {((currentProject.finalReviewResult as any).issues as Array<{categoria: string; descripcion: string; severidad: string; capitulos_afectados: number[]; instrucciones_correccion: string}>).map((issue, idx) => (
                            <div 
                              key={idx} 
                              className="text-xs p-2 rounded bg-background/50 border border-border/30"
                              data-testid={`issue-${idx}`}
                            >
                              <div className="flex items-center gap-2 mb-1 flex-wrap">
                                <Badge 
                                  variant={issue.severidad === "critica" ? "destructive" : issue.severidad === "mayor" ? "secondary" : "outline"}
                                  className="text-[10px] px-1.5 py-0"
                                >
                                  {issue.severidad}
                                </Badge>
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                                  {issue.categoria?.replace(/_/g, ' ')}
                                </Badge>
                                {issue.capitulos_afectados?.length > 0 && (
                                  <span className="text-muted-foreground">
                                    Cap. {issue.capitulos_afectados.map(c => c === 0 ? 'Prólogo' : c === -1 ? 'Epílogo' : c).join(', ')}
                                  </span>
                                )}
                              </div>
                              <p className="text-foreground">{issue.descripcion}</p>
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
                    
                    {/* Reset Reviewer Button */}
                    <div className="mt-4 pt-4 border-t border-border/50">
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => setShowResetReviewerDialog(true)}
                        className="w-full"
                        data-testid="button-reset-reviewer"
                      >
                        <RefreshCw className="w-4 h-4 mr-2" />
                        Reiniciar Crítico desde cero
                      </Button>
                      <p className="text-xs text-muted-foreground mt-2 text-center">
                        Borra el historial de evaluaciones para empezar una revisión completamente nueva
                      </p>
                    </div>
                  </div>
                )}

                {(currentProject.totalInputTokens || currentProject.totalOutputTokens) ? (
                  <div className="mt-4 p-4 rounded-md bg-muted/30 border border-border">
                    <div className="flex items-center justify-between gap-4 flex-wrap">
                      <div className="space-y-1">
                        <p className="text-sm font-medium flex items-center gap-2">
                          Coste de Generación
                          {currentProject.status === "generating" && (
                            <Badge variant="secondary" className="text-xs">En progreso</Badge>
                          )}
                        </p>
                        <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                          <span>Entrada: {(currentProject.totalInputTokens || 0).toLocaleString()} tokens</span>
                          <span>Salida: {(currentProject.totalOutputTokens || 0).toLocaleString()} tokens</span>
                          {(currentProject.totalThinkingTokens || 0) > 0 && (
                            <span>Razonamiento: {(currentProject.totalThinkingTokens || 0).toLocaleString()} tokens</span>
                          )}
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
                ) : null}
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
                    onClick={openEditMetadataDialog}
                    disabled={currentProject.status === "generating"}
                    data-testid="button-edit-metadata"
                  >
                    <Pencil className="h-4 w-4 mr-2" />
                    Editar Datos
                  </Button>
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
                    <>
                      {(currentProject as any).pauseReason && (
                        <div className="w-full mb-3 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-md text-sm whitespace-pre-wrap" data-testid="pause-reason">
                          {(currentProject as any).pauseReason}
                        </div>
                      )}
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
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => restartCorrectionsMutation.mutate(currentProject.id)}
                        disabled={restartCorrectionsMutation.isPending}
                        data-testid="button-restart-corrections"
                      >
                        <RefreshCw className="h-4 w-4 mr-2" />
                        Reiniciar Correcciones
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          if (correctionSystem === 'detect-fix') {
                            detectAndFixMutation.mutate({ id: currentProject.id, useGeminiQA });
                          } else {
                            finalReviewMutation.mutate({ id: currentProject.id, useGeminiQA });
                          }
                        }}
                        disabled={finalReviewMutation.isPending || detectAndFixMutation.isPending}
                        data-testid="button-run-correction-paused"
                      >
                        {correctionSystem === 'detect-fix' ? (
                          <Crosshair className="h-4 w-4 mr-2" />
                        ) : (
                          <ClipboardCheck className="h-4 w-4 mr-2" />
                        )}
                        {(finalReviewMutation.isPending || detectAndFixMutation.isPending) 
                          ? "Procesando..." 
                          : correctionSystem === 'detect-fix' ? "Detect & Fix" : "Revisión Final"}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => diagnoseMutation.mutate(currentProject.id)}
                        disabled={diagnoseMutation.isPending}
                        data-testid="button-diagnose-repair-paused"
                      >
                        <Crosshair className="h-4 w-4 mr-2" />
                        {diagnoseMutation.isPending ? "Diagnosticando..." : "Diagnosticar"}
                      </Button>
                      {Array.isArray(currentProject.targetedRepairPlan) && currentProject.targetedRepairPlan.length > 0 && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => fetchRepairPlan(currentProject.id)}
                          data-testid="button-view-repair-plan-paused"
                        >
                          <FileText className="h-4 w-4 mr-2" />
                          Ver Plan ({currentProject.targetedRepairPlan.length})
                        </Button>
                      )}
                    </>
                  )}

                  {(currentProject.status === "final_review_in_progress" || currentProject.status === "processing") && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => cancelCorrectionMutation.mutate(currentProject.id)}
                      disabled={cancelCorrectionMutation.isPending}
                      className="text-destructive hover:text-destructive"
                      data-testid="button-cancel-correction"
                    >
                      <Ban className="h-4 w-4 mr-2" />
                      {cancelCorrectionMutation.isPending ? "Cancelando..." : "Cancelar Corrección"}
                    </Button>
                  )}

                  {["completed", "paused", "cancelled", "error"].includes(currentProject.status) && (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setShowExtendDialog(true)}
                        disabled={extendProjectMutation.isPending}
                        data-testid="button-extend-project"
                      >
                        <Plus className="h-4 w-4 mr-2" />
                        Extender
                      </Button>
                    </>
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

          <DuplicateManager projectId={currentProject?.id} />
        </div>
      </div>

      <Dialog open={showEditMetadataDialog} onOpenChange={setShowEditMetadataDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar Datos del Proyecto</DialogTitle>
            <DialogDescription>
              Modifica el título, tipo de obra y posición en la serie.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="edit-title">Título</Label>
              <Input
                id="edit-title"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                data-testid="input-edit-title"
              />
            </div>
            <div className="space-y-2">
              <Label>Tipo de obra</Label>
              <Select value={editWorkType} onValueChange={(val) => {
                setEditWorkType(val);
                if (val === "standalone") {
                  setEditSeriesId(null);
                  setEditSeriesOrder(null);
                }
              }}>
                <SelectTrigger data-testid="select-edit-work-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="standalone">Independiente</SelectItem>
                  <SelectItem value="series">Serie</SelectItem>
                  <SelectItem value="trilogy">Trilogía</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {(editWorkType === "series" || editWorkType === "trilogy") && (
              <>
                <div className="space-y-2">
                  <Label>Serie</Label>
                  <Select
                    value={editSeriesId?.toString() ?? "none"}
                    onValueChange={(val) => setEditSeriesId(val === "none" ? null : parseInt(val))}
                  >
                    <SelectTrigger data-testid="select-edit-series">
                      <SelectValue placeholder="Seleccionar serie" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Sin serie</SelectItem>
                      {allSeries.map((s) => (
                        <SelectItem key={s.id} value={s.id.toString()}>
                          {s.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-series-order">Orden en la serie</Label>
                  <Input
                    id="edit-series-order"
                    type="number"
                    min={1}
                    value={editSeriesOrder ?? ""}
                    onChange={(e) => setEditSeriesOrder(e.target.value ? parseInt(e.target.value) : null)}
                    data-testid="input-edit-series-order"
                  />
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditMetadataDialog(false)} data-testid="button-cancel-edit">
              Cancelar
            </Button>
            <Button
              onClick={handleSaveMetadata}
              disabled={!editTitle.trim() || updateProjectMetadataMutation.isPending || ((editWorkType === "series" || editWorkType === "trilogy") && (!editSeriesId || !editSeriesOrder))}
              data-testid="button-save-metadata"
            >
              {updateProjectMetadataMutation.isPending ? "Guardando..." : "Guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

      <ResumeDialog
        open={confirmDialog === "resume"}
        onOpenChange={(open) => !open && setConfirmDialog(null)}
        title="Reanudar o reiniciar"
        description="¿Quieres continuar desde donde se detuvo o reiniciar desde cero? Reiniciar eliminará todos los capítulos y la World Bible actual."
        continueText="Continuar"
        restartText="Reiniciar desde cero"
        onContinue={() => {
          if (currentProject) resumeProjectMutation.mutate(currentProject.id);
          setConfirmDialog(null);
        }}
        onRestart={() => {
          if (currentProject) restartFromScratchMutation.mutate(currentProject.id);
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

      {/* Architect Instructions Dialog */}
      <Dialog open={showArchitectDialog} onOpenChange={setShowArchitectDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Instrucciones para el Arquitecto</DialogTitle>
            <DialogDescription>
              Proporciona instrucciones específicas que guiarán la planificación de la trama y estructura de tu novela. Estas instrucciones serán utilizadas por el Arquitecto antes de generar los capítulos.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="architect-instructions">Instrucciones (opcional)</Label>
              <Textarea
                id="architect-instructions"
                placeholder="Escribe las instrucciones para el Arquitecto. Ejemplos:&#10;&#10;- Quiero que cada capítulo termine con un gancho fuerte&#10;- El villano debe aparecer sutilmente en los primeros capítulos&#10;- Incluir escenas de tensión romántica entre X e Y&#10;- El giro principal debe ocurrir en el capítulo 8&#10;- Mantener un ritmo acelerado en la segunda mitad"
                value={architectInstructions}
                onChange={(e) => setArchitectInstructions(e.target.value)}
                className="min-h-[200px]"
                data-testid="input-architect-instructions"
              />
            </div>
            
            <div className="rounded-lg border p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label className="text-base">LitAgents 2.0</Label>
                  <p className="text-sm text-muted-foreground">
                    Nuevo pipeline por escenas con edición quirúrgica
                  </p>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="use-v2"
                    checked={useV2Pipeline}
                    onCheckedChange={(checked) => setUseV2Pipeline(checked === true)}
                    data-testid="checkbox-use-v2"
                  />
                  <label htmlFor="use-v2" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                    Activar
                  </label>
                </div>
              </div>
              {useV2Pipeline && (
                <div className="text-xs text-muted-foreground bg-muted/50 p-2 rounded">
                  <strong>Características v2:</strong>
                  <ul className="list-disc list-inside mt-1 space-y-0.5">
                    <li>Escritura por escenas (3-4 por capítulo)</li>
                    <li>Parches quirúrgicos en lugar de reescrituras</li>
                    <li>Director Narrativo cada 5 capítulos</li>
                    <li>Menor consumo de tokens</li>
                  </ul>
                </div>
              )}
            </div>
            
            <div className="border rounded-md p-3 space-y-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div>
                  <p className="text-sm font-medium">Arquitecto con Gemini</p>
                  <p className="text-xs text-muted-foreground">
                    Usa Gemini en lugar de DeepSeek para planificar la novela (mayor calidad, mayor costo)
                  </p>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="use-gemini-architect"
                    checked={useGeminiArchitect}
                    onCheckedChange={(checked) => setUseGeminiArchitect(checked === true)}
                    data-testid="checkbox-use-gemini-architect"
                  />
                  <label htmlFor="use-gemini-architect" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                    Activar
                  </label>
                </div>
              </div>
              {useGeminiArchitect && (
                <div className="text-xs text-muted-foreground bg-muted/50 p-2 rounded">
                  <strong>Gemini Architect:</strong> Genera planes de novela de mayor calidad y coherencia. 
                  Recomendado para novelas complejas o con muchos personajes. Requiere GEMINI_API_KEY configurada.
                </div>
              )}
            </div>

            <div className="border rounded-md p-3 space-y-2">
              <div>
                <p className="text-sm font-medium">Agentes QA con Gemini</p>
                <p className="text-xs text-muted-foreground">
                  Usa Gemini para agentes de calidad (mayor detección de errores, mayor costo)
                </p>
              </div>
              <div className="space-y-2 pl-2">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="gemini-qa-final-reviewer"
                    checked={useGeminiQA.finalReviewer}
                    onCheckedChange={(checked) => setUseGeminiQA(prev => ({ ...prev, finalReviewer: checked === true }))}
                    data-testid="checkbox-gemini-qa-final-reviewer"
                  />
                  <label htmlFor="gemini-qa-final-reviewer" className="text-sm leading-none">
                    Final Reviewer <span className="text-xs text-muted-foreground">(1 ejecución - detecta agujeros de trama globales)</span>
                  </label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="gemini-qa-continuity-sentinel"
                    checked={useGeminiQA.continuitySentinel}
                    onCheckedChange={(checked) => setUseGeminiQA(prev => ({ ...prev, continuitySentinel: checked === true }))}
                    data-testid="checkbox-gemini-qa-continuity-sentinel"
                  />
                  <label htmlFor="gemini-qa-continuity-sentinel" className="text-sm leading-none">
                    Continuity Sentinel <span className="text-xs text-muted-foreground">(por bloque - verifica continuidad)</span>
                  </label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="gemini-qa-narrative-director"
                    checked={useGeminiQA.narrativeDirector}
                    onCheckedChange={(checked) => setUseGeminiQA(prev => ({ ...prev, narrativeDirector: checked === true }))}
                    data-testid="checkbox-gemini-qa-narrative-director"
                  />
                  <label htmlFor="gemini-qa-narrative-director" className="text-sm leading-none">
                    Narrative Director <span className="text-xs text-muted-foreground">(por capítulo - mayor frecuencia/costo)</span>
                  </label>
                </div>
              </div>
              {(useGeminiQA.finalReviewer || useGeminiQA.continuitySentinel || useGeminiQA.narrativeDirector) && (
                <div className="text-xs text-muted-foreground bg-muted/50 p-2 rounded">
                  <strong>Gemini QA:</strong> Los agentes seleccionados usarán Gemini para diagnóstico/detección. 
                  Las correcciones siempre usan DeepSeek. Requiere GEMINI_API_KEY configurada.
                </div>
              )}
            </div>

            <div className="text-sm text-muted-foreground">
              <p><strong>Nota:</strong> Estas instrucciones son opcionales. Puedes iniciar la generación sin ellas.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowArchitectDialog(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handleConfirmGeneration}
              disabled={startGenerationMutation.isPending}
              data-testid="button-confirm-generation"
            >
              {startGenerationMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Iniciando...
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 mr-2" />
                  Iniciar Generación
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Extend Project Dialog */}
      <Dialog open={showExtendDialog} onOpenChange={setShowExtendDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Extender Proyecto</DialogTitle>
            <DialogDescription>
              Añade más capítulos a tu proyecto. El sistema generará la escaleta y contenido de los capítulos adicionales manteniendo la continuidad con los existentes.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="target-chapters">Número total de capítulos</Label>
              <input
                id="target-chapters"
                type="number"
                min={(chapters?.filter(c => c.chapterNumber > 0).length || 0) + 1}
                value={targetChapters}
                onChange={(e) => setTargetChapters(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                placeholder={`Actualmente: ${chapters?.filter(c => c.chapterNumber > 0).length || 0} capítulos`}
                data-testid="input-target-chapters"
              />
            </div>
            <div className="text-sm text-muted-foreground">
              <p>Capítulos actuales: <strong>{chapters?.filter(c => c.chapterNumber > 0).length || 0}</strong></p>
              <p>Nuevos capítulos a generar: <strong>{targetChapters ? Math.max(0, parseInt(targetChapters) - (chapters?.filter(c => c.chapterNumber > 0).length || 0)) : 0}</strong></p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowExtendDialog(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => {
                if (currentProject && targetChapters) {
                  extendProjectMutation.mutate({ 
                    id: currentProject.id, 
                    targetChapters: parseInt(targetChapters) 
                  });
                }
              }}
              disabled={extendProjectMutation.isPending || !targetChapters || parseInt(targetChapters) <= (chapters?.filter(c => c.chapterNumber > 0).length || 0)}
              data-testid="button-confirm-extend"
            >
              {extendProjectMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Extendiendo...
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4 mr-2" />
                  Extender Proyecto
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Merge Chapters Dialog */}
      <Dialog open={showMergeChaptersDialog} onOpenChange={setShowMergeChaptersDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Fusionar Capítulos</DialogTitle>
            <DialogDescription>
              Fusiona dos capítulos en uno. El contenido del capítulo origen se añadirá al final del capítulo destino, y los capítulos posteriores se renumerarán automáticamente.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="merge-target">Capítulo destino (se mantiene)</Label>
              <select
                id="merge-target"
                value={mergeTarget ?? ""}
                onChange={(e) => setMergeTarget(e.target.value ? parseInt(e.target.value) : null)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                data-testid="select-merge-target"
              >
                <option value="">Seleccionar capítulo destino...</option>
                {chapters?.filter(c => c.chapterNumber > 0 && c.chapterNumber !== mergeSource).map(c => (
                  <option key={c.id} value={c.chapterNumber}>
                    Capítulo {c.chapterNumber}: {c.title?.replace(/^Capítulo \d+\s*[-:]?\s*/i, '') || 'Sin título'}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="merge-source">Capítulo origen (se eliminará)</Label>
              <select
                id="merge-source"
                value={mergeSource ?? ""}
                onChange={(e) => setMergeSource(e.target.value ? parseInt(e.target.value) : null)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                data-testid="select-merge-source"
              >
                <option value="">Seleccionar capítulo origen...</option>
                {chapters?.filter(c => c.chapterNumber > 0 && c.chapterNumber !== mergeTarget).map(c => (
                  <option key={c.id} value={c.chapterNumber}>
                    Capítulo {c.chapterNumber}: {c.title?.replace(/^Capítulo \d+\s*[-:]?\s*/i, '') || 'Sin título'}
                  </option>
                ))}
              </select>
            </div>
            {mergeSource && mergeTarget && (
              <div className="text-sm text-muted-foreground bg-muted p-3 rounded-md">
                <p><strong>Vista previa:</strong></p>
                <p>El contenido del <strong>Capítulo {mergeSource}</strong> se añadirá al final del <strong>Capítulo {mergeTarget}</strong>.</p>
                <p className="text-amber-600 dark:text-amber-400 mt-2">Advertencia: Esta acción no se puede deshacer fácilmente.</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setShowMergeChaptersDialog(false);
              setMergeSource(null);
              setMergeTarget(null);
            }}>
              Cancelar
            </Button>
            <Button
              onClick={() => {
                if (currentProject && mergeSource && mergeTarget) {
                  mergeChaptersMutation.mutate({ 
                    projectId: currentProject.id, 
                    sourceChapterNumber: mergeSource,
                    targetChapterNumber: mergeTarget
                  });
                }
              }}
              disabled={mergeChaptersMutation.isPending || !mergeSource || !mergeTarget}
              data-testid="button-confirm-merge"
            >
              {mergeChaptersMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Fusionando...
                </>
              ) : (
                "Fusionar Capítulos"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rewrite Chapter Dialog */}
      <Dialog open={showRewriteDialog} onOpenChange={(open) => {
        setShowRewriteDialog(open);
        if (!open) {
          setRewriteChapterNumber(null);
          setRewriteInstructions("");
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Reescribir {rewriteChapterNumber === 0 ? "Prólogo" : 
                rewriteChapterNumber === 998 ? "Epílogo" : 
                rewriteChapterNumber === 999 ? "Nota del Autor" :
                `Capítulo ${rewriteChapterNumber}`}
            </DialogTitle>
            <DialogDescription>
              Se regenerará el capítulo completo manteniendo la coherencia con la World Bible y los capítulos anteriores. Puedes dar instrucciones específicas o dejarlo en blanco para una regeneración automática.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="rewrite-instructions">Instrucciones (opcional)</Label>
              <Textarea
                id="rewrite-instructions"
                placeholder="Ej: Hacer el capítulo más tenso, añadir más diálogo, corregir la escena del encuentro..."
                value={rewriteInstructions}
                onChange={(e) => setRewriteInstructions(e.target.value)}
                className="min-h-[100px]"
                data-testid="input-rewrite-instructions"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => {
              setShowRewriteDialog(false);
              setRewriteChapterNumber(null);
              setRewriteInstructions("");
            }}
            data-testid="button-cancel-rewrite"
            >
              Cancelar
            </Button>
            <Button
              onClick={() => {
                if (currentProject && rewriteChapterNumber !== null) {
                  rewriteChapterMutation.mutate({
                    projectId: currentProject.id,
                    chapterNumber: rewriteChapterNumber,
                    instructions: rewriteInstructions.trim() || undefined,
                  });
                }
              }}
              disabled={rewriteChapterMutation.isPending}
              data-testid="button-confirm-rewrite"
            >
              {rewriteChapterMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Reescribiendo...
                </>
              ) : (
                "Reescribir Capítulo"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset Reviewer Confirmation Dialog */}
      <Dialog open={showRepairPlanDialog} onOpenChange={setShowRepairPlanDialog}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Plan de Reparación Dirigida</DialogTitle>
            <DialogDescription>
              {repairPlanData?.diagnosis
                ? (typeof repairPlanData.diagnosis === 'string'
                    ? repairPlanData.diagnosis
                    : JSON.stringify(repairPlanData.diagnosis, null, 2).slice(0, 500))
                : "Análisis de desviaciones del manuscrito"}
            </DialogDescription>
          </DialogHeader>
          <div className="overflow-y-auto flex-1 pr-1">
            {!repairPlanData ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                <span className="ml-2 text-sm text-muted-foreground">Cargando plan...</span>
              </div>
            ) : Array.isArray(repairPlanData.plan) && repairPlanData.plan.length > 0 ? (
              <div className="space-y-3">
                {repairPlanData.plan.map((item: any, idx: number) => (
                  <Card key={idx}>
                    <CardContent className="p-3">
                      <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
                        <span className="font-medium text-sm">
                          Capítulo {item.chapterNumber ?? item.chapter ?? idx + 1}
                        </span>
                        <div className="flex items-center gap-2">
                          {item.priority && (
                            <Badge variant={item.priority === 'critical' ? 'destructive' : item.priority === 'high' ? 'default' : 'secondary'}>
                              {item.priority}
                            </Badge>
                          )}
                          {item.approach && (
                            <Badge variant="outline">
                              {item.approach === 'surgical' ? 'Corrección quirúrgica' : 'Reescritura'}
                            </Badge>
                          )}
                        </div>
                      </div>
                      {Array.isArray(item.issues) && item.issues.length > 0 && (
                        <ul className="text-xs text-muted-foreground space-y-1">
                          {item.issues.map((issue: any, iidx: number) => (
                            <li key={iidx} className="flex items-start gap-1">
                              <span className="text-destructive mt-0.5 shrink-0">-</span>
                              <span>{typeof issue === 'string' ? issue : (issue?.description || issue?.issue || issue?.mensaje || JSON.stringify(issue))}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                      {item.instructions && (
                        <p className="text-xs text-muted-foreground mt-1 italic">
                          {typeof item.instructions === 'string' ? item.instructions : JSON.stringify(item.instructions)}
                        </p>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground py-4">No se encontraron problemas que reparar.</p>
            )}
          </div>
          <DialogFooter className="flex gap-2">
            <Button variant="outline" onClick={() => setShowRepairPlanDialog(false)} data-testid="button-close-repair-plan">
              Cerrar
            </Button>
            {Array.isArray(repairPlanData?.plan) && repairPlanData.plan.length > 0 && currentProject && (
              <Button
                onClick={() => executeRepairMutation.mutate(currentProject.id)}
                disabled={executeRepairMutation.isPending}
                data-testid="button-execute-repair"
              >
                {executeRepairMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Ejecutando...
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4 mr-2" />
                    Ejecutar Reparación
                  </>
                )}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={showResetReviewerDialog}
        onOpenChange={setShowResetReviewerDialog}
        title="Reiniciar Crítico"
        description="Esto borrará todo el historial de evaluaciones del crítico (puntuación, issues resueltos, ciclos de corrección). La próxima evaluación comenzará completamente desde cero, sin sesgos de revisiones anteriores."
        confirmText="Reiniciar Crítico"
        cancelText="Cancelar"
        onConfirm={() => {
          if (currentProject) {
            resetReviewerMutation.mutate(currentProject.id);
          }
        }}
      />
    </div>
  );
}
