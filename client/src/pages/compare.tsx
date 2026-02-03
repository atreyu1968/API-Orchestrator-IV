import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  GitCompare, 
  FileText,
  ChevronLeft,
  ChevronRight,
  Loader2,
  AlertCircle,
  CheckCircle,
  MinusCircle,
  PlusCircle,
  ArrowRight,
  BarChart3,
  Download,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import * as Diff from "diff";

interface Project {
  id: number;
  title: string;
  status: string;
  chapterCount?: number;
}

interface Chapter {
  id: number;
  chapterNumber: number;
  title: string | null;
  content: string | null;
  originalContent: string | null;
  wordCount: number | null;
}

interface DiffStats {
  additions: number;
  deletions: number;
  unchanged: number;
  totalChanges: number;
  changePercentage: number;
}

function calculateDiffStats(original: string, corrected: string): DiffStats {
  const diff = Diff.diffWords(original, corrected);
  let additions = 0;
  let deletions = 0;
  let unchanged = 0;
  
  diff.forEach(part => {
    const wordCount = part.value.split(/\s+/).filter(w => w.length > 0).length;
    if (part.added) {
      additions += wordCount;
    } else if (part.removed) {
      deletions += wordCount;
    } else {
      unchanged += wordCount;
    }
  });
  
  const totalChanges = additions + deletions;
  const totalWords = unchanged + additions;
  const changePercentage = totalWords > 0 ? (totalChanges / totalWords) * 100 : 0;
  
  return { additions, deletions, unchanged, totalChanges, changePercentage };
}

function DiffView({ original, corrected }: { original: string; corrected: string }) {
  const diff = useMemo(() => Diff.diffWords(original, corrected), [original, corrected]);
  
  return (
    <div className="font-mono text-sm leading-relaxed whitespace-pre-wrap">
      {diff.map((part, index) => {
        if (part.added) {
          return (
            <span 
              key={index} 
              className="bg-green-500/20 text-green-700 dark:text-green-300 px-0.5 rounded"
            >
              {part.value}
            </span>
          );
        }
        if (part.removed) {
          return (
            <span 
              key={index} 
              className="bg-red-500/20 text-red-700 dark:text-red-300 line-through px-0.5 rounded"
            >
              {part.value}
            </span>
          );
        }
        return <span key={index}>{part.value}</span>;
      })}
    </div>
  );
}

function SideBySideView({ original, corrected }: { original: string; corrected: string }) {
  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <MinusCircle className="h-4 w-4 text-red-500" />
          Original (Pre-Corrección)
        </div>
        <ScrollArea className="h-[500px] border rounded-md p-4 bg-red-500/5">
          <div className="font-mono text-sm leading-relaxed whitespace-pre-wrap">
            {original}
          </div>
        </ScrollArea>
      </div>
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <PlusCircle className="h-4 w-4 text-green-500" />
          Corregido (Post-Corrección)
        </div>
        <ScrollArea className="h-[500px] border rounded-md p-4 bg-green-500/5">
          <div className="font-mono text-sm leading-relaxed whitespace-pre-wrap">
            {corrected}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}

function ChapterStats({ stats }: { stats: DiffStats }) {
  return (
    <div className="flex items-center gap-4 text-sm">
      <div className="flex items-center gap-1">
        <PlusCircle className="h-4 w-4 text-green-500" />
        <span className="text-green-600 dark:text-green-400">+{stats.additions}</span>
      </div>
      <div className="flex items-center gap-1">
        <MinusCircle className="h-4 w-4 text-red-500" />
        <span className="text-red-600 dark:text-red-400">-{stats.deletions}</span>
      </div>
      <Badge variant={stats.changePercentage > 5 ? "destructive" : stats.changePercentage > 1 ? "secondary" : "outline"}>
        {stats.changePercentage.toFixed(1)}% cambios
      </Badge>
    </div>
  );
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

export default function ComparePage() {
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [selectedChapterIndex, setSelectedChapterIndex] = useState(0);
  const [viewMode, setViewMode] = useState<"unified" | "side-by-side">("unified");
  const [isDownloading, setIsDownloading] = useState<"original" | "corrected" | null>(null);
  const { toast } = useToast();
  
  const { data: projects, isLoading: loadingProjects } = useQuery<Project[]>({
    queryKey: ["/api/projects"],
  });
  
  const { data: chapters, isLoading: loadingChapters } = useQuery<Chapter[]>({
    queryKey: [`/api/projects/${selectedProjectId}/chapters`],
    enabled: !!selectedProjectId,
  });
  
  const completedProjects = projects?.filter(p => 
    p.status === "completed" || p.status === "paused"
  ) || [];
  
  const selectedProject = completedProjects.find(p => p.id === selectedProjectId);
  
  const handleDownload = async (version: "original" | "corrected") => {
    if (!selectedProjectId) return;
    setIsDownloading(version);
    try {
      const response = await fetch(`/api/projects/${selectedProjectId}/export-markdown?version=${version}`);
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Error al descargar");
      }
      const data = await response.json();
      const safeFilename = data.title.replace(/[^a-zA-Z0-9\u00C0-\u024F\s]/g, "").replace(/\s+/g, "_");
      const versionSuffix = version === "original" ? "_ORIGINAL" : "_CORREGIDO";
      downloadMarkdown(`${safeFilename}${versionSuffix}.md`, data.markdown);
      toast({
        title: "Descargado",
        description: `${data.versionLabel}: ${data.chapterCount} capítulos`,
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsDownloading(null);
    }
  };
  
  const chaptersWithDiff = useMemo(() => {
    if (!chapters) return [];
    return chapters
      .filter(c => c.content && c.originalContent && c.content !== c.originalContent)
      .sort((a, b) => a.chapterNumber - b.chapterNumber);
  }, [chapters]);
  
  const currentChapter = chaptersWithDiff[selectedChapterIndex];
  
  const globalStats = useMemo(() => {
    if (!chaptersWithDiff.length) return null;
    
    let totalAdditions = 0;
    let totalDeletions = 0;
    let totalUnchanged = 0;
    
    chaptersWithDiff.forEach(chapter => {
      if (chapter.originalContent && chapter.content) {
        const stats = calculateDiffStats(chapter.originalContent, chapter.content);
        totalAdditions += stats.additions;
        totalDeletions += stats.deletions;
        totalUnchanged += stats.unchanged;
      }
    });
    
    const totalChanges = totalAdditions + totalDeletions;
    const totalWords = totalUnchanged + totalAdditions;
    const changePercentage = totalWords > 0 ? (totalChanges / totalWords) * 100 : 0;
    
    return {
      additions: totalAdditions,
      deletions: totalDeletions,
      unchanged: totalUnchanged,
      totalChanges,
      changePercentage,
      chaptersModified: chaptersWithDiff.length,
      totalChapters: chapters?.length || 0,
    };
  }, [chaptersWithDiff, chapters]);
  
  const currentStats = useMemo(() => {
    if (!currentChapter?.originalContent || !currentChapter?.content) return null;
    return calculateDiffStats(currentChapter.originalContent, currentChapter.content);
  }, [currentChapter]);
  
  const getChapterLabel = (chapter: Chapter) => {
    if (chapter.chapterNumber === 0) return "Prólogo";
    if (chapter.chapterNumber === -1) return "Epílogo";
    if (chapter.chapterNumber === -2) return "Nota del Autor";
    return `Capítulo ${chapter.chapterNumber}`;
  };
  
  return (
    <div className="container py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <GitCompare className="h-6 w-6" />
            Comparar Manuscritos
          </h1>
          <p className="text-muted-foreground">
            Analiza las diferencias entre el manuscrito original y el corregido
          </p>
        </div>
      </div>
      
      <Card>
        <CardHeader>
          <CardTitle>Seleccionar Proyecto</CardTitle>
          <CardDescription>
            Elige un proyecto completado que haya pasado por Detect & Fix
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <Select 
                value={selectedProjectId?.toString() || ""} 
                onValueChange={(v) => {
                  setSelectedProjectId(parseInt(v));
                  setSelectedChapterIndex(0);
                }}
              >
                <SelectTrigger data-testid="select-project-compare">
                  <SelectValue placeholder="Selecciona un proyecto..." />
                </SelectTrigger>
                <SelectContent>
                  {loadingProjects ? (
                    <div className="p-2 text-center text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin mx-auto" />
                    </div>
                  ) : completedProjects.length === 0 ? (
                    <div className="p-2 text-center text-muted-foreground">
                      No hay proyectos completados
                    </div>
                  ) : (
                    completedProjects.map((project) => (
                      <SelectItem key={project.id} value={project.id.toString()}>
                        {project.title}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>
      
      {selectedProjectId && loadingChapters && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      )}
      
      {selectedProjectId && !loadingChapters && chaptersWithDiff.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <AlertCircle className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <h3 className="text-lg font-medium mb-2">Sin diferencias encontradas</h3>
            <p className="text-muted-foreground max-w-md mx-auto">
              Este proyecto no tiene manuscrito original guardado o no hubo cambios durante la corrección.
              El snapshot se guarda al ejecutar "Detect & Fix".
            </p>
          </CardContent>
        </Card>
      )}
      
      {globalStats && chaptersWithDiff.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5" />
                Resumen Global de Correcciones
              </CardTitle>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleDownload("original")}
                  disabled={isDownloading !== null}
                  data-testid="button-download-original"
                >
                  {isDownloading === "original" ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4 mr-2" />
                  )}
                  Original
                </Button>
                <Button
                  size="sm"
                  onClick={() => handleDownload("corrected")}
                  disabled={isDownloading !== null}
                  data-testid="button-download-corrected"
                >
                  {isDownloading === "corrected" ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4 mr-2" />
                  )}
                  Corregido
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div className="text-center p-4 bg-muted rounded-lg">
                <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                  +{globalStats.additions.toLocaleString()}
                </div>
                <div className="text-sm text-muted-foreground">Palabras añadidas</div>
              </div>
              <div className="text-center p-4 bg-muted rounded-lg">
                <div className="text-2xl font-bold text-red-600 dark:text-red-400">
                  -{globalStats.deletions.toLocaleString()}
                </div>
                <div className="text-sm text-muted-foreground">Palabras eliminadas</div>
              </div>
              <div className="text-center p-4 bg-muted rounded-lg">
                <div className="text-2xl font-bold">
                  {globalStats.changePercentage.toFixed(1)}%
                </div>
                <div className="text-sm text-muted-foreground">Cambio total</div>
              </div>
              <div className="text-center p-4 bg-muted rounded-lg">
                <div className="text-2xl font-bold">
                  {globalStats.chaptersModified}/{globalStats.totalChapters}
                </div>
                <div className="text-sm text-muted-foreground">Capítulos modificados</div>
              </div>
              <div className="text-center p-4 bg-muted rounded-lg">
                <div className="text-2xl font-bold flex items-center justify-center gap-1">
                  {globalStats.changePercentage < 2 ? (
                    <CheckCircle className="h-6 w-6 text-green-500" />
                  ) : globalStats.changePercentage < 5 ? (
                    <AlertCircle className="h-6 w-6 text-yellow-500" />
                  ) : (
                    <AlertCircle className="h-6 w-6 text-red-500" />
                  )}
                </div>
                <div className="text-sm text-muted-foreground">
                  {globalStats.changePercentage < 2 
                    ? "Correcciones mínimas" 
                    : globalStats.changePercentage < 5 
                    ? "Correcciones moderadas"
                    : "Correcciones significativas"}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
      
      {currentChapter && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  {getChapterLabel(currentChapter)}
                  {currentChapter.title && `: ${currentChapter.title}`}
                </CardTitle>
                {currentStats && (
                  <div className="mt-2">
                    <ChapterStats stats={currentStats} />
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setSelectedChapterIndex(i => Math.max(0, i - 1))}
                  disabled={selectedChapterIndex === 0}
                  data-testid="button-prev-chapter"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-sm text-muted-foreground min-w-[60px] text-center">
                  {selectedChapterIndex + 1} / {chaptersWithDiff.length}
                </span>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setSelectedChapterIndex(i => Math.min(chaptersWithDiff.length - 1, i + 1))}
                  disabled={selectedChapterIndex === chaptersWithDiff.length - 1}
                  data-testid="button-next-chapter"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as "unified" | "side-by-side")}>
              <TabsList className="mb-4">
                <TabsTrigger value="unified" data-testid="tab-unified">
                  Vista Unificada
                </TabsTrigger>
                <TabsTrigger value="side-by-side" data-testid="tab-side-by-side">
                  Lado a Lado
                </TabsTrigger>
              </TabsList>
              
              <TabsContent value="unified">
                <ScrollArea className="h-[500px] border rounded-md p-4">
                  <DiffView 
                    original={currentChapter.originalContent || ""} 
                    corrected={currentChapter.content || ""} 
                  />
                </ScrollArea>
                <div className="mt-4 flex items-center gap-4 text-sm text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <span className="inline-block w-4 h-4 bg-green-500/20 rounded"></span>
                    Texto añadido
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="inline-block w-4 h-4 bg-red-500/20 rounded"></span>
                    Texto eliminado
                  </div>
                </div>
              </TabsContent>
              
              <TabsContent value="side-by-side">
                <SideBySideView 
                  original={currentChapter.originalContent || ""} 
                  corrected={currentChapter.content || ""} 
                />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      )}
      
      {chaptersWithDiff.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Navegación por Capítulos</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {chaptersWithDiff.map((chapter, index) => {
                const stats = chapter.originalContent && chapter.content 
                  ? calculateDiffStats(chapter.originalContent, chapter.content) 
                  : null;
                return (
                  <Button
                    key={chapter.id}
                    variant={index === selectedChapterIndex ? "default" : "outline"}
                    size="sm"
                    onClick={() => setSelectedChapterIndex(index)}
                    className="relative"
                    data-testid={`button-chapter-${chapter.chapterNumber}`}
                  >
                    {getChapterLabel(chapter)}
                    {stats && stats.changePercentage > 2 && (
                      <span className="absolute -top-1 -right-1 w-2 h-2 bg-yellow-500 rounded-full" />
                    )}
                  </Button>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
