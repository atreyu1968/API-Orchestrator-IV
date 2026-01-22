import { useState, useCallback, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { 
  Download, 
  Languages,
  Loader2, 
  FileText,
  CheckCircle,
  BookOpen,
  DollarSign,
  Trash2,
  Library,
  X,
  Search,
  Play,
  AlertTriangle,
  RefreshCw,
} from "lucide-react";

interface TranslationProgress {
  isTranslating: boolean;
  currentChapter: number;
  totalChapters: number;
  chapterTitle: string;
  inputTokens: number;
  outputTokens: number;
}

const SUPPORTED_LANGUAGES = [
  { code: "es", name: "Español" },
  { code: "en-US", name: "English (US)" },
  { code: "en-GB", name: "English (UK)" },
  { code: "fr", name: "Français" },
  { code: "de", name: "Deutsch" },
  { code: "it", name: "Italiano" },
  { code: "pt", name: "Português" },
  { code: "ca", name: "Català" },
];

interface CompletedProject {
  id: number;
  title: string;
  genre: string | null;
  chapterCount: number;
  totalWords: number;
  finalScore: number | null;
  createdAt: string;
  source: "original" | "reedit";
}

interface SavedTranslation {
  id: number;
  projectId: number;
  projectTitle: string;
  sourceLanguage: string;
  targetLanguage: string;
  chaptersTranslated: number;
  totalWords: number;
  inputTokens: number;
  outputTokens: number;
  status: "pending" | "translating" | "completed" | "error";
  createdAt: string;
}

interface ExportResult {
  projectId: number;
  title: string;
  chapterCount: number;
  totalWords: number;
  markdown: string;
}

const INPUT_PRICE_PER_MILLION = 0.80;
const OUTPUT_PRICE_PER_MILLION = 6.50;

function calculateCost(inputTokens: number, outputTokens: number) {
  const inputCost = (inputTokens / 1_000_000) * INPUT_PRICE_PER_MILLION;
  const outputCost = (outputTokens / 1_000_000) * OUTPUT_PRICE_PER_MILLION;
  return inputCost + outputCost;
}

function downloadMarkdown(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function formatNumber(num: number): string {
  return num.toLocaleString("es-ES");
}

function getLangName(code: string): string {
  return SUPPORTED_LANGUAGES.find(l => l.code === code)?.name || code.toUpperCase();
}

const TRANSLATION_STATE_KEY = "litagents_active_translation";

interface ActiveTranslationState {
  projectId: number;
  projectTitle: string;
  sourceLanguage: string;
  targetLanguage: string;
  startedAt: string;
  currentChapter: number;
  totalChapters: number;
  chapterTitle: string;
  inputTokens: number;
  outputTokens: number;
}

function saveTranslationState(state: ActiveTranslationState | null) {
  if (state) {
    localStorage.setItem(TRANSLATION_STATE_KEY, JSON.stringify(state));
  } else {
    localStorage.removeItem(TRANSLATION_STATE_KEY);
  }
}

function loadTranslationState(): ActiveTranslationState | null {
  try {
    const saved = localStorage.getItem(TRANSLATION_STATE_KEY);
    if (saved) {
      const state = JSON.parse(saved) as ActiveTranslationState;
      const startedAt = new Date(state.startedAt);
      const minutesAgo = (Date.now() - startedAt.getTime()) / 1000 / 60;
      if (minutesAgo < 30) {
        return state;
      }
      localStorage.removeItem(TRANSLATION_STATE_KEY);
    }
  } catch {}
  return null;
}

function clearTranslationState(): void {
  try {
    localStorage.removeItem(TRANSLATION_STATE_KEY);
  } catch {}
}

function isTranslationFrozen(translation: SavedTranslation): boolean {
  if (translation.status !== "translating") return false;
  const savedState = loadTranslationState();
  if (!savedState) return true;
  if (savedState.projectId !== translation.projectId) return true;
  return false;
}

export default function ExportPage() {
  const { toast } = useToast();
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [sourceLanguage, setSourceLanguage] = useState("es");
  const [targetLanguage, setTargetLanguage] = useState("en-US");
  const [eventSourceRef, setEventSourceRef] = useState<EventSource | null>(null);
  const [projectSearch, setProjectSearch] = useState("");
  const [translationSearch, setTranslationSearch] = useState("");
  
  const savedState = loadTranslationState();
  const [translationProgress, setTranslationProgress] = useState<TranslationProgress>({
    isTranslating: savedState !== null,
    currentChapter: savedState?.currentChapter || 0,
    totalChapters: savedState?.totalChapters || 0,
    chapterTitle: savedState ? `Reconectando a "${savedState.projectTitle}"...` : "",
    inputTokens: savedState?.inputTokens || 0,
    outputTokens: savedState?.outputTokens || 0,
  });

  const { data: completedProjects = [], isLoading } = useQuery<CompletedProject[]>({
    queryKey: ["/api/projects/completed"],
  });

  const { data: savedTranslations = [], isLoading: isLoadingTranslations } = useQuery<SavedTranslation[]>({
    queryKey: ["/api/translations"],
    refetchInterval: (query) => {
      // Poll more aggressively if any translation is currently in progress
      const hasInProgress = query.state.data?.some(t => t.status === "translating");
      return hasInProgress ? 2000 : 10000; // Poll every 2s if translating, else 10s
    }
  });

  const startTranslation = useCallback((projectId: number, srcLang: string, tgtLang: string, projectTitle?: string, source: "original" | "reedit" = "original") => {
    // Close any existing EventSource to prevent duplicate translations
    if (eventSourceRef) {
      eventSourceRef.close();
      setEventSourceRef(null);
    }
    
    const title = projectTitle || completedProjects.find(p => p.id === projectId)?.title || "Proyecto";
    
    setTranslationProgress({
      isTranslating: true,
      currentChapter: 0,
      totalChapters: 0,
      chapterTitle: "Iniciando...",
      inputTokens: 0,
      outputTokens: 0,
    });
    
    saveTranslationState({
      projectId,
      projectTitle: title,
      sourceLanguage: srcLang,
      targetLanguage: tgtLang,
      startedAt: new Date().toISOString(),
      currentChapter: 0,
      totalChapters: 0,
      chapterTitle: "Iniciando...",
      inputTokens: 0,
      outputTokens: 0,
    });

    const baseUrl = source === "reedit" 
      ? `/api/reedit-projects/${projectId}/translate-stream`
      : `/api/projects/${projectId}/translate-stream`;
    const eventSource = new EventSource(
      `${baseUrl}?sourceLanguage=${srcLang}&targetLanguage=${tgtLang}`
    );
    setEventSourceRef(eventSource);

    eventSource.addEventListener("start", (event) => {
      const data = JSON.parse(event.data);
      
      // Force refresh to show the new "translating" record in the list
      queryClient.invalidateQueries({ queryKey: ["/api/translations"] });

      setTranslationProgress(prev => {
        const newState = {
          ...prev,
          totalChapters: data.totalChapters,
          chapterTitle: `Preparando ${data.totalChapters} capítulos...`,
        };
        saveTranslationState({
          projectId, projectTitle: title, sourceLanguage: srcLang, targetLanguage: tgtLang,
          startedAt: new Date().toISOString(),
          currentChapter: newState.currentChapter, totalChapters: newState.totalChapters,
          chapterTitle: newState.chapterTitle, inputTokens: newState.inputTokens, outputTokens: newState.outputTokens,
        });
        return newState;
      });
    });

    eventSource.addEventListener("progress", (event) => {
      const data = JSON.parse(event.data);
      
      // Force refresh on every progress event to update the repository line
      queryClient.invalidateQueries({ queryKey: ["/api/translations"] });

      setTranslationProgress(prev => {
        const newState = {
          ...prev,
          currentChapter: data.current,
          totalChapters: data.total,
          chapterTitle: data.chapterTitle,
          inputTokens: data.inputTokens || prev.inputTokens,
          outputTokens: data.outputTokens || prev.outputTokens,
        };
        saveTranslationState({
          projectId, projectTitle: title, sourceLanguage: srcLang, targetLanguage: tgtLang,
          startedAt: new Date().toISOString(),
          currentChapter: newState.currentChapter, totalChapters: newState.totalChapters,
          chapterTitle: newState.chapterTitle, inputTokens: newState.inputTokens, outputTokens: newState.outputTokens,
        });
        return newState;
      });
    });

    eventSource.addEventListener("saving", () => {
      setTranslationProgress(prev => ({
        ...prev,
        chapterTitle: "Guardando traducción...",
      }));
    });

    eventSource.addEventListener("complete", (event) => {
      const data = JSON.parse(event.data);
      eventSource.close();
      setEventSourceRef(null);
      saveTranslationState(null);
      
      // Update local state to show it's done
      setTranslationProgress({
        isTranslating: false,
        currentChapter: 0,
        totalChapters: 0,
        chapterTitle: "",
        inputTokens: 0,
        outputTokens: 0,
      });

      // Clear cache and refetch immediately
      queryClient.resetQueries({ queryKey: ["/api/translations"] });
      queryClient.refetchQueries({ queryKey: ["/api/translations"], exact: true });

      const projectTitle = data.title || data.projectTitle || "traduccion";
      const safeFilename = projectTitle.replace(/[^a-zA-Z0-9\u00C0-\u024F\s]/g, "").replace(/\s+/g, "_");
      downloadMarkdown(`${safeFilename}_${tgtLang.toUpperCase()}.md`, data.markdown);

      toast({
        title: data.warning ? "Traducción completada con advertencia" : "Traducción completada",
        description: data.warning || `${data.chaptersTranslated} capítulos traducidos y guardados`,
      });
    });

    eventSource.addEventListener("error", (event) => {
      let errorMessage = "Error en la traducción";
      try {
        const data = JSON.parse((event as MessageEvent).data);
        errorMessage = data.error || errorMessage;
      } catch {}
      
      eventSource.close();
      setEventSourceRef(null);
      saveTranslationState(null);
      
      setTranslationProgress({
        isTranslating: false,
        currentChapter: 0,
        totalChapters: 0,
        chapterTitle: "",
        inputTokens: 0,
        outputTokens: 0,
      });

      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    });

    eventSource.onerror = () => {
      eventSource.close();
      setEventSourceRef(null);
      saveTranslationState(null);
      
      setTranslationProgress({
        isTranslating: false,
        currentChapter: 0,
        totalChapters: 0,
        chapterTitle: "",
        inputTokens: 0,
        outputTokens: 0,
      });

      toast({
        title: "Conexión perdida",
        description: "Se perdió la conexión con el servidor. Intenta de nuevo.",
        variant: "destructive",
      });
    };
  }, [toast, completedProjects, eventSourceRef]);

  useEffect(() => {
    // Only restart if we don't already have an active event source
    if (eventSourceRef) return;

    // Check if there's a reason to believe a translation is active
    const saved = loadTranslationState();
    if (!saved) return;

    const startedAt = new Date(saved.startedAt);
    const secondsAgo = (Date.now() - startedAt.getTime()) / 1000;
    
    // Safety check: Don't auto-restart if the session is too old
    if (secondsAgo < 120) {
      // NEVER restart if a translation already exists for this project WITH THE SAME TARGET LANGUAGE
      const translationExists = savedTranslations.some(
        t => t.projectId === saved.projectId && t.targetLanguage === saved.targetLanguage
      );
      
      if (translationExists) {
        // Clear the saved state - we should NOT auto-restart
        saveTranslationState(null);
        setTranslationProgress({
          isTranslating: false,
          currentChapter: 0,
          totalChapters: 0,
          chapterTitle: "",
          inputTokens: 0,
          outputTokens: 0,
        });
      }
      // Do NOT auto-restart translations - user must click manually
    } else {
      saveTranslationState(null);
    }
  }, [savedTranslations]);

  const cancelTranslation = useCallback(() => {
    if (eventSourceRef) {
      eventSourceRef.close();
      setEventSourceRef(null);
    }
    saveTranslationState(null);
    setTranslationProgress({
      isTranslating: false,
      currentChapter: 0,
      totalChapters: 0,
      chapterTitle: "",
      inputTokens: 0,
      outputTokens: 0,
    });
    toast({
      title: "Traducción cancelada",
      description: "Puedes reiniciarla cuando quieras",
    });
  }, [eventSourceRef, toast]);

  const exportMutation = useMutation({
    mutationFn: async ({ projectId, source }: { projectId: number; source: "original" | "reedit" }) => {
      const endpoint = source === "reedit" 
        ? `/api/reedit-projects/${projectId}/export-markdown`
        : `/api/projects/${projectId}/export-markdown`;
      const response = await fetch(endpoint);
      if (!response.ok) throw new Error("Failed to export project");
      return response.json() as Promise<ExportResult>;
    },
    onSuccess: (data) => {
      const safeFilename = data.title.replace(/[^a-zA-Z0-9\u00C0-\u024F\s]/g, "").replace(/\s+/g, "_");
      downloadMarkdown(`${safeFilename}.md`, data.markdown);
      toast({
        title: "Exportado",
        description: `${data.chapterCount} capítulos exportados (${formatNumber(data.totalWords)} palabras)`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const downloadTranslationMutation = useMutation({
    mutationFn: async (translationId: number) => {
      const response = await fetch(`/api/translations/${translationId}/download`);
      if (!response.ok) throw new Error("Failed to download translation");
      return response.json();
    },
    onSuccess: (data) => {
      const safeFilename = data.projectTitle.replace(/[^a-zA-Z0-9\u00C0-\u024F\s]/g, "").replace(/\s+/g, "_");
      downloadMarkdown(`${safeFilename}_${data.targetLanguage.toUpperCase()}.md`, data.markdown);
      toast({
        title: "Descargado",
        description: `${data.projectTitle} en ${getLangName(data.targetLanguage)}`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteTranslationMutation = useMutation({
    mutationFn: async (translationId: number) => {
      await apiRequest("DELETE", `/api/translations/${translationId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/translations"] });
      toast({
        title: "Eliminado",
        description: "Traducción eliminada del repositorio",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const resumeTranslation = useCallback((translationId: number, projectTitle: string) => {
    // Close any existing EventSource to prevent duplicate translations
    if (eventSourceRef) {
      eventSourceRef.close();
      setEventSourceRef(null);
    }
    
    setTranslationProgress({
      isTranslating: true,
      currentChapter: 0,
      totalChapters: 0,
      chapterTitle: "Reanudando traducción...",
      inputTokens: 0,
      outputTokens: 0,
    });

    const eventSource = new EventSource(`/api/translations/${translationId}/resume`);
    setEventSourceRef(eventSource);

    eventSource.addEventListener("start", (event) => {
      const data = JSON.parse(event.data);
      queryClient.invalidateQueries({ queryKey: ["/api/translations"] });
      setTranslationProgress(prev => ({
        ...prev,
        totalChapters: data.totalChapters,
        chapterTitle: data.resumed 
          ? `Reanudando: ${data.alreadyTranslated}/${data.totalChapters} ya traducidos, quedan ${data.remaining}...`
          : `Preparando ${data.totalChapters} capítulos...`,
      }));
      toast({
        title: "Reanudando traducción",
        description: `${data.alreadyTranslated} capítulos ya traducidos, continuando con ${data.remaining} restantes`,
      });
    });

    eventSource.addEventListener("progress", (event) => {
      const data = JSON.parse(event.data);
      queryClient.invalidateQueries({ queryKey: ["/api/translations"] });
      setTranslationProgress(prev => ({
        ...prev,
        currentChapter: data.current,
        totalChapters: data.total,
        chapterTitle: data.status === "translating" 
          ? `Traduciendo: ${data.chapterTitle}...`
          : `Completado: ${data.chapterTitle}`,
        inputTokens: data.inputTokens || prev.inputTokens,
        outputTokens: data.outputTokens || prev.outputTokens,
      }));
    });

    eventSource.addEventListener("complete", (event) => {
      const data = JSON.parse(event.data);
      eventSource.close();
      setEventSourceRef(null);
      clearTranslationState();
      setTranslationProgress({
        isTranslating: false,
        currentChapter: 0,
        totalChapters: 0,
        chapterTitle: "",
        inputTokens: 0,
        outputTokens: 0,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/translations"] });
      toast({
        title: "Traducción completada",
        description: data.resumed 
          ? `${projectTitle}: ${data.newChaptersTranslated} nuevos capítulos traducidos (total: ${data.chaptersTranslated})`
          : `${projectTitle}: ${data.chaptersTranslated} capítulos traducidos`,
      });
    });

    eventSource.addEventListener("error", (event) => {
      let errorMessage = "Error desconocido";
      try {
        const data = JSON.parse((event as MessageEvent).data);
        errorMessage = data.error || errorMessage;
      } catch {}
      eventSource.close();
      setEventSourceRef(null);
      clearTranslationState();
      setTranslationProgress({
        isTranslating: false,
        currentChapter: 0,
        totalChapters: 0,
        chapterTitle: "",
        inputTokens: 0,
        outputTokens: 0,
      });
      toast({
        title: "Error al reanudar",
        description: errorMessage,
        variant: "destructive",
      });
    });

    eventSource.onerror = () => {
      eventSource.close();
      setEventSourceRef(null);
      clearTranslationState();
      setTranslationProgress({
        isTranslating: false,
        currentChapter: 0,
        totalChapters: 0,
        chapterTitle: "",
        inputTokens: 0,
        outputTokens: 0,
      });
    };
  }, [toast, eventSourceRef]);

  const selectedProject = completedProjects.find(p => p.id === selectedProjectId);

  // Check if selected project already has a translation TO THE SAME TARGET LANGUAGE
  const existingTranslation = selectedProjectId 
    ? savedTranslations.find(t => t.projectId === selectedProjectId && t.targetLanguage === targetLanguage)
    : null;
  const hasExistingTranslation = !!existingTranslation;
  const isTranslationInProgress = existingTranslation?.status === "translating";

  const filteredProjects = completedProjects.filter(p => 
    p.title.toLowerCase().includes(projectSearch.toLowerCase()) ||
    (p.genre?.toLowerCase().includes(projectSearch.toLowerCase()) ?? false)
  );

  const filteredTranslations = savedTranslations.filter(t =>
    t.projectTitle.toLowerCase().includes(translationSearch.toLowerCase()) ||
    getLangName(t.targetLanguage).toLowerCase().includes(translationSearch.toLowerCase())
  );

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Exportar y Traducir</h1>
        <p className="text-muted-foreground">
          Exporta proyectos completados en Markdown o tradúcelos a otros idiomas
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BookOpen className="h-5 w-5" />
              Proyectos Completados
            </CardTitle>
            <CardDescription>
              {completedProjects.length} proyecto(s) disponible(s) para exportar
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar proyectos..."
                value={projectSearch}
                onChange={(e) => setProjectSearch(e.target.value)}
                className="pl-9"
                data-testid="input-search-projects"
              />
            </div>
            {isLoading ? (
              <div className="flex items-center justify-center h-32">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : filteredProjects.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <BookOpen className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>No hay proyectos completados</p>
                <p className="text-sm">Los proyectos aparecerán aquí cuando finalicen con éxito</p>
              </div>
            ) : (
              <ScrollArea className="h-[300px]">
                <div className="space-y-3 pr-4">
                  {filteredProjects.map((project) => (
                    <Card
                      key={`${project.source}-${project.id}`}
                      className={`hover-elevate cursor-pointer transition-all ${
                        selectedProjectId === project.id ? "ring-2 ring-primary" : ""
                      }`}
                      onClick={() => setSelectedProjectId(project.id)}
                      data-testid={`card-project-${project.source}-${project.id}`}
                    >
                      <CardHeader className="pb-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <CardTitle className="text-base truncate">{project.title}</CardTitle>
                            <CardDescription className="text-xs">
                              {project.genre || (project.source === "reedit" ? "Manuscrito re-editado" : "Sin género")}
                            </CardDescription>
                          </div>
                          <div className="flex flex-col items-end gap-1">
                            {project.source === "reedit" && (
                              <Badge variant="outline" className="text-xs">
                                Re-editado
                              </Badge>
                            )}
                            <Badge variant="secondary" className="bg-green-500/10 text-green-600 dark:text-green-400">
                              <CheckCircle className="h-3 w-3 mr-1" />
                              Completado
                            </Badge>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground flex-wrap">
                          <div className="flex items-center gap-1">
                            <FileText className="h-3 w-3" />
                            <span>{project.chapterCount} cap.</span>
                          </div>
                          <span>{formatNumber(project.totalWords)} palabras</span>
                          {project.finalScore && (
                            <Badge variant="outline">
                              {project.finalScore}/10
                            </Badge>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Download className="h-5 w-5" />
                Exportar Markdown
              </CardTitle>
              <CardDescription>
                Descarga el manuscrito original en formato Markdown
              </CardDescription>
            </CardHeader>
            <CardContent>
              {selectedProject ? (
                <div className="space-y-4">
                  <div className="p-3 bg-muted rounded-md">
                    <p className="font-medium">{selectedProject.title}</p>
                    <p className="text-sm text-muted-foreground">
                      {selectedProject.chapterCount} capítulos - {formatNumber(selectedProject.totalWords)} palabras
                    </p>
                  </div>
                  <Button
                    onClick={() => exportMutation.mutate({ projectId: selectedProject.id, source: selectedProject.source })}
                    disabled={exportMutation.isPending}
                    className="w-full"
                    data-testid="button-export-markdown"
                  >
                    {exportMutation.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Download className="h-4 w-4 mr-2" />
                    )}
                    Descargar Markdown
                  </Button>
                </div>
              ) : (
                <div className="text-center py-6 text-muted-foreground">
                  <FileText className="h-10 w-10 mx-auto mb-2 opacity-50" />
                  <p>Selecciona un proyecto para exportar</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Languages className="h-5 w-5" />
                Nueva Traducción
              </CardTitle>
              <CardDescription>
                Traduce y guarda en el repositorio
              </CardDescription>
            </CardHeader>
            <CardContent>
              {selectedProject ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Idioma origen</Label>
                      <Select value={sourceLanguage} onValueChange={setSourceLanguage}>
                        <SelectTrigger data-testid="select-source-language">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {SUPPORTED_LANGUAGES.map((lang) => (
                            <SelectItem key={lang.code} value={lang.code}>
                              {lang.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Idioma destino</Label>
                      <Select value={targetLanguage} onValueChange={setTargetLanguage}>
                        <SelectTrigger data-testid="select-target-language">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {SUPPORTED_LANGUAGES.filter(l => l.code !== sourceLanguage).map((lang) => (
                            <SelectItem key={lang.code} value={lang.code}>
                              {lang.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {!translationProgress.isTranslating && (
                    <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-md text-sm">
                      <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
                        <DollarSign className="h-4 w-4" />
                        <span className="font-medium">Coste estimado</span>
                      </div>
                      <p className="text-muted-foreground mt-1">
                        ~${((selectedProject.totalWords * 1.5 / 1_000_000) * (INPUT_PRICE_PER_MILLION + OUTPUT_PRICE_PER_MILLION * 1.2)).toFixed(2)} - ${((selectedProject.totalWords * 2 / 1_000_000) * (INPUT_PRICE_PER_MILLION + OUTPUT_PRICE_PER_MILLION * 1.5)).toFixed(2)}
                      </p>
                    </div>
                  )}

                  {translationProgress.isTranslating && (
                    <div className="space-y-3 p-3 bg-muted rounded-md">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium">Traduciendo...</span>
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground">
                            {translationProgress.currentChapter}/{translationProgress.totalChapters}
                          </span>
                          <Button 
                            size="icon" 
                            variant="ghost" 
                            onClick={cancelTranslation}
                            data-testid="button-cancel-translation"
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                      <Progress 
                        value={translationProgress.totalChapters > 0 
                          ? (translationProgress.currentChapter / translationProgress.totalChapters) * 100 
                          : 0
                        } 
                        className="h-2"
                      />
                      <p className="text-xs text-muted-foreground truncate">
                        {translationProgress.chapterTitle}
                      </p>
                      {translationProgress.inputTokens > 0 && (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <DollarSign className="h-3 w-3" />
                          <span>
                            Coste actual: ${calculateCost(translationProgress.inputTokens, translationProgress.outputTokens).toFixed(3)}
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  {hasExistingTranslation ? (
                    <div className="p-3 bg-muted rounded-md text-sm text-center">
                      {isTranslationInProgress ? (
                        <p className="text-muted-foreground">
                          <Loader2 className="h-4 w-4 inline mr-2 animate-spin" />
                          Traducción a {getLangName(targetLanguage)} en progreso...
                        </p>
                      ) : (
                        <p className="text-muted-foreground">
                          Ya existe una traducción a {getLangName(targetLanguage)}. Elimínala del repositorio si deseas volver a traducir, o selecciona otro idioma.
                        </p>
                      )}
                    </div>
                  ) : (
                    <Button
                      onClick={() => startTranslation(selectedProject.id, sourceLanguage, targetLanguage, selectedProject.title, selectedProject.source)}
                      disabled={translationProgress.isTranslating || sourceLanguage === targetLanguage}
                      className="w-full"
                      data-testid="button-translate-project"
                    >
                      {translationProgress.isTranslating ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Traduciendo {translationProgress.currentChapter}/{translationProgress.totalChapters}...
                        </>
                      ) : (
                        <>
                          <Languages className="h-4 w-4 mr-2" />
                          Traducir a {getLangName(targetLanguage)}
                        </>
                      )}
                    </Button>
                  )}
                </div>
              ) : (
                <div className="text-center py-6 text-muted-foreground">
                  <Languages className="h-10 w-10 mx-auto mb-2 opacity-50" />
                  <p>Selecciona un proyecto para traducir</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Library className="h-5 w-5" />
            Repositorio de Traducciones
          </CardTitle>
          <CardDescription>
            Traducciones guardadas listas para descargar
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar traducciones..."
              value={translationSearch}
              onChange={(e) => setTranslationSearch(e.target.value)}
              className="pl-9"
              data-testid="input-search-translations"
            />
          </div>
          {isLoadingTranslations ? (
            <div className="flex items-center justify-center h-24">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filteredTranslations.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Library className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>No hay traducciones guardadas</p>
              <p className="text-sm">Las traducciones aparecerán aquí cuando las generes</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredTranslations.map((translation) => (
                <div
                  key={translation.id}
                  className="flex items-center justify-between gap-4 p-4 bg-muted/50 rounded-md border border-border"
                  data-testid={`translation-${translation.id}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-medium truncate">{translation.projectTitle}</p>
                      {translation.status === "translating" && isTranslationFrozen(translation) ? (
                        <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-200">
                          <AlertTriangle className="h-3 w-3 mr-1" />
                          Congelado
                        </Badge>
                      ) : translation.status === "translating" ? (
                        <Badge variant="outline" className="animate-pulse bg-blue-500/10 text-blue-600 border-blue-200">
                          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                          Procesando...
                        </Badge>
                      ) : translation.status === "completed" ? (
                        <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-200">
                          <CheckCircle className="h-3 w-3 mr-1" />
                          Listo
                        </Badge>
                      ) : translation.status === "error" ? (
                        <Badge variant="destructive">Error</Badge>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-3 text-sm text-muted-foreground flex-wrap">
                      <Badge variant="outline">
                        {getLangName(translation.sourceLanguage)} → {getLangName(translation.targetLanguage)}
                      </Badge>
                      <span>{translation.chaptersTranslated} cap.</span>
                      {translation.totalWords > 0 && <span>{formatNumber(translation.totalWords)} palabras</span>}
                      {translation.inputTokens > 0 && (
                        <span className="text-xs">
                          ${calculateCost(translation.inputTokens, translation.outputTokens).toFixed(4)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {translation.status === "completed" ? (
                      <Button
                        size="sm"
                        onClick={() => downloadTranslationMutation.mutate(translation.id)}
                        disabled={downloadTranslationMutation.isPending}
                        data-testid={`button-download-translation-${translation.id}`}
                      >
                        {downloadTranslationMutation.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Download className="h-4 w-4 mr-2" />
                        )}
                        Descargar
                      </Button>
                    ) : translation.status === "translating" && isTranslationFrozen(translation) ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => resumeTranslation(translation.id, translation.projectTitle)}
                        disabled={translationProgress.isTranslating}
                        className="border-amber-500/50 text-amber-600 hover:bg-amber-500/10"
                        data-testid={`button-retry-frozen-${translation.id}`}
                      >
                        {translationProgress.isTranslating ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <RefreshCw className="h-4 w-4 mr-2" />
                        )}
                        Reintentar
                      </Button>
                    ) : translation.status === "translating" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => resumeTranslation(translation.id, translation.projectTitle)}
                        disabled={translationProgress.isTranslating}
                        className="border-blue-500/50 text-blue-600 hover:bg-blue-500/10"
                        data-testid={`button-resume-translation-${translation.id}`}
                      >
                        {translationProgress.isTranslating ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <Play className="h-4 w-4 mr-2" />
                        )}
                        Reanudar
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => downloadTranslationMutation.mutate(translation.id)}
                        disabled={downloadTranslationMutation.isPending}
                        className="border-destructive/50 text-destructive hover:bg-destructive/10"
                      >
                        {downloadTranslationMutation.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Download className="h-4 w-4 mr-2" />
                        )}
                        Intentar Descarga
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => deleteTranslationMutation.mutate(translation.id)}
                      disabled={deleteTranslationMutation.isPending}
                      className="text-destructive hover:text-destructive hover:bg-destructive/10"
                      data-testid={`button-delete-translation-${translation.id}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
