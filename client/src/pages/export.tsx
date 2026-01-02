import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
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
} from "lucide-react";

const SUPPORTED_LANGUAGES = [
  { code: "es", name: "Español" },
  { code: "en", name: "English" },
  { code: "fr", name: "Français" },
  { code: "de", name: "Deutsch" },
  { code: "it", name: "Italiano" },
  { code: "pt", name: "Português" },
  { code: "ca", name: "Català" },
];

interface CompletedProject {
  id: number;
  title: string;
  genre: string;
  chapterCount: number;
  totalWords: number;
  finalScore: number | null;
  createdAt: string;
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

export default function ExportPage() {
  const { toast } = useToast();
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [sourceLanguage, setSourceLanguage] = useState("es");
  const [targetLanguage, setTargetLanguage] = useState("en");

  const { data: completedProjects = [], isLoading } = useQuery<CompletedProject[]>({
    queryKey: ["/api/projects/completed"],
  });

  const { data: savedTranslations = [], isLoading: isLoadingTranslations } = useQuery<SavedTranslation[]>({
    queryKey: ["/api/translations"],
  });

  const exportMutation = useMutation({
    mutationFn: async (projectId: number) => {
      const response = await fetch(`/api/projects/${projectId}/export-markdown`);
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

  const translateMutation = useMutation({
    mutationFn: async ({ projectId, sourceLanguage, targetLanguage }: { projectId: number; sourceLanguage: string; targetLanguage: string }) => {
      const response = await apiRequest("POST", `/api/projects/${projectId}/translate`, { sourceLanguage, targetLanguage });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/translations"] });
      toast({
        title: "Traducción guardada",
        description: "La traducción se ha guardado en el repositorio. Puedes descargarla cuando quieras.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error de traducción",
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

  const selectedProject = completedProjects.find(p => p.id === selectedProjectId);

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
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center h-32">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : completedProjects.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <BookOpen className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>No hay proyectos completados</p>
                <p className="text-sm">Los proyectos aparecerán aquí cuando finalicen con éxito</p>
              </div>
            ) : (
              <ScrollArea className="h-[300px]">
                <div className="space-y-3 pr-4">
                  {completedProjects.map((project) => (
                    <Card
                      key={project.id}
                      className={`hover-elevate cursor-pointer transition-all ${
                        selectedProjectId === project.id ? "ring-2 ring-primary" : ""
                      }`}
                      onClick={() => setSelectedProjectId(project.id)}
                      data-testid={`card-project-${project.id}`}
                    >
                      <CardHeader className="pb-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <CardTitle className="text-base truncate">{project.title}</CardTitle>
                            <CardDescription className="text-xs">{project.genre}</CardDescription>
                          </div>
                          <Badge variant="secondary" className="bg-green-500/10 text-green-600 dark:text-green-400">
                            <CheckCircle className="h-3 w-3 mr-1" />
                            Completado
                          </Badge>
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
                    onClick={() => exportMutation.mutate(selectedProject.id)}
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

                  <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-md text-sm">
                    <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
                      <DollarSign className="h-4 w-4" />
                      <span className="font-medium">Coste estimado</span>
                    </div>
                    <p className="text-muted-foreground mt-1">
                      ~${((selectedProject.totalWords * 1.5 / 1_000_000) * (INPUT_PRICE_PER_MILLION + OUTPUT_PRICE_PER_MILLION * 1.2)).toFixed(2)} - ${((selectedProject.totalWords * 2 / 1_000_000) * (INPUT_PRICE_PER_MILLION + OUTPUT_PRICE_PER_MILLION * 1.5)).toFixed(2)}
                    </p>
                  </div>

                  <Button
                    onClick={() => translateMutation.mutate({ 
                      projectId: selectedProject.id, 
                      sourceLanguage, 
                      targetLanguage 
                    })}
                    disabled={translateMutation.isPending || sourceLanguage === targetLanguage}
                    className="w-full"
                    data-testid="button-translate-project"
                  >
                    {translateMutation.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Traduciendo...
                      </>
                    ) : (
                      <>
                        <Languages className="h-4 w-4 mr-2" />
                        Traducir a {getLangName(targetLanguage)}
                      </>
                    )}
                  </Button>
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
        <CardContent>
          {isLoadingTranslations ? (
            <div className="flex items-center justify-center h-24">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : savedTranslations.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Library className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>No hay traducciones guardadas</p>
              <p className="text-sm">Las traducciones aparecerán aquí cuando las generes</p>
            </div>
          ) : (
            <div className="space-y-3">
              {savedTranslations.map((translation) => (
                <div
                  key={translation.id}
                  className="flex items-center justify-between gap-4 p-4 bg-muted/50 rounded-md"
                  data-testid={`translation-${translation.id}`}
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{translation.projectTitle}</p>
                    <div className="flex items-center gap-3 text-sm text-muted-foreground flex-wrap">
                      <Badge variant="outline">
                        {getLangName(translation.sourceLanguage)} → {getLangName(translation.targetLanguage)}
                      </Badge>
                      <span>{translation.chaptersTranslated} cap.</span>
                      <span>{formatNumber(translation.totalWords || 0)} palabras</span>
                      <span className="text-xs">
                        ${calculateCost(translation.inputTokens || 0, translation.outputTokens || 0).toFixed(4)}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      onClick={() => downloadTranslationMutation.mutate(translation.id)}
                      disabled={downloadTranslationMutation.isPending}
                      data-testid={`button-download-translation-${translation.id}`}
                    >
                      {downloadTranslationMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Download className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => deleteTranslationMutation.mutate(translation.id)}
                      disabled={deleteTranslationMutation.isPending}
                      data-testid={`button-delete-translation-${translation.id}`}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
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
