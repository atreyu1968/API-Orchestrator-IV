import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChapterList } from "@/components/chapter-list";
import { ChapterViewer } from "@/components/chapter-viewer";
import { ChatPanel } from "@/components/chat-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Download, BookOpen, MessageSquare, PenTool, ChevronDown, Wand2, Loader2, Type } from "lucide-react";
import { useProject } from "@/lib/project-context";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Project, Chapter } from "@shared/schema";

function sortChaptersForDisplay<T extends { chapterNumber: number }>(chapters: T[]): T[] {
  return [...chapters].sort((a, b) => {
    const orderA = a.chapterNumber === 0 ? -1000 : a.chapterNumber === -1 ? 1000 : a.chapterNumber === -2 ? 1001 : a.chapterNumber;
    const orderB = b.chapterNumber === 0 ? -1000 : b.chapterNumber === -1 ? 1000 : b.chapterNumber === -2 ? 1001 : b.chapterNumber;
    return orderA - orderB;
  });
}

export default function ManuscriptPage() {
  const [selectedChapter, setSelectedChapter] = useState<Chapter | null>(null);
  const [showChat, setShowChat] = useState(false);
  const [agentType, setAgentType] = useState<"architect" | "reeditor">("architect");
  const [showAutoEditDialog, setShowAutoEditDialog] = useState(false);
  const [autoEditInstructions, setAutoEditInstructions] = useState("");
  const [resettingChapterId, setResettingChapterId] = useState<number | undefined>();
  const { currentProject, isLoading: projectsLoading } = useProject();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const agentLabels = {
    architect: "Arquitecto",
    reeditor: "Re-editor",
  };

  const resetChapterMutation = useMutation({
    mutationFn: async (params: { projectId: number; chapterNumber: number; chapterId: number }) => {
      setResettingChapterId(params.chapterId);
      const res = await apiRequest("POST", `/api/projects/${params.projectId}/chapters/${params.chapterNumber}/reset-to-pending`);
      return res.json();
    },
    onSuccess: () => {
      setResettingChapterId(undefined);
      toast({
        title: "Capítulo marcado como pendiente",
        description: "El pipeline lo detectará y continuará con la generación.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", currentProject?.id, "chapters"] });
    },
    onError: (error: any) => {
      setResettingChapterId(undefined);
      toast({
        title: "Error",
        description: error.message || "No se pudo marcar el capítulo como pendiente",
        variant: "destructive",
      });
    },
  });

  const handleResetChapter = (chapter: Chapter) => {
    if (!currentProject) return;
    resetChapterMutation.mutate({
      projectId: currentProject.id,
      chapterNumber: chapter.chapterNumber,
      chapterId: chapter.id,
    });
  };

  const normalizeTitlesMutation = useMutation({
    mutationFn: async (projectId: number) => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/normalize-titles`);
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Títulos normalizados",
        description: `Se actualizaron ${data.chaptersUpdated} de ${data.totalChapters} capítulos.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", currentProject?.id, "chapters"] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "No se pudieron normalizar los títulos",
        variant: "destructive",
      });
    },
  });

  const cloneToReeditMutation = useMutation({
    mutationFn: async (params: { projectId: number; instructions: string }) => {
      const res = await apiRequest("POST", `/api/projects/${params.projectId}/clone-to-reedit`, {
        instructions: params.instructions,
      });
      return res.json();
    },
    onSuccess: async (data) => {
      toast({
        title: "Proyecto clonado",
        description: `Se creó una copia para re-edición con ${data.chaptersCloned} capítulos.`,
      });
      setShowAutoEditDialog(false);
      setAutoEditInstructions("");
      // Start the reedit process
      await apiRequest("POST", `/api/reedit-projects/${data.reeditProjectId}/start`);
      // Navigate to the reedit page
      navigate(`/reedit?project=${data.reeditProjectId}`);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "No se pudo clonar el proyecto",
        variant: "destructive",
      });
    },
  });

  const { data: chapters = [], isLoading: chaptersLoading } = useQuery<Chapter[]>({
    queryKey: ["/api/projects", currentProject?.id, "chapters"],
    enabled: !!currentProject?.id,
  });

  const handleDownload = () => {
    if (!currentProject || chapters.length === 0) return;

    const removeStyleGuideContamination = (content: string): string => {
      let cleaned = content;
      
      const styleGuidePatterns = [
        /^#+ *Literary Style Guide[^\n]*\n[\s\S]*?(?=^#+ *(?:CHAPTER|Chapter|Prologue|Epilogue|Author['']?s? Note)\b|\n---\n|$)/gm,
        /^#+ *Writing Guide[^\n]*\n[\s\S]*?(?=^#+ *(?:CHAPTER|Chapter|Prologue|Epilogue|Author['']?s? Note)\b|\n---\n|$)/gm,
        /^#+ *The Master of[^\n]*\n[\s\S]*?(?=^#+ *(?:CHAPTER|Chapter|Prologue|Epilogue|Author['']?s? Note)\b|\n---\n|$)/gm,
        /^#+ *Guía de Estilo[^\n]*\n[\s\S]*?(?=^#+ *(?:CAPÍTULO|Capítulo|Prólogo|Epílogo|Nota del Autor)\b|\n---\n|$)/gmi,
        /^#+ *Guía de Escritura[^\n]*\n[\s\S]*?(?=^#+ *(?:CAPÍTULO|Capítulo|Prólogo|Epílogo|Nota del Autor)\b|\n---\n|$)/gmi,
        /^###+ *Checklist[^\n]*\n[\s\S]*?(?=^#{1,2} *(?:CHAPTER|Chapter|CAPÍTULO|Capítulo|Prologue|Prólogo|Epilogue|Epílogo)\b|\n---\n|$)/gmi,
        /\n---\n[\s\S]*?(?:Style Guide|Guía de Estilo|Writing Guide|Guía de Escritura)[\s\S]*?\n---\n/gi,
      ];
      
      for (const pattern of styleGuidePatterns) {
        cleaned = cleaned.replace(pattern, '');
      }
      
      const metaSectionPatterns = [
        /^#+ *\d+\. *(?:Narrative Architecture|Character Construction|Central Themes|Language and Stylistic|Tone and Atmosphere)[^\n]*\n[\s\S]*?(?=^#+ *(?:CHAPTER|Chapter|CAPÍTULO|Capítulo|Prologue|Prólogo)\b|$)/gmi,
      ];
      
      for (const pattern of metaSectionPatterns) {
        cleaned = cleaned.replace(pattern, '');
      }
      
      return cleaned.trim();
    };

    const cleanContent = (rawContent: string): string => {
      let content = rawContent.trim();
      const continuityMarker = "---CONTINUITY_STATE---";
      const markerIndex = content.indexOf(continuityMarker);
      if (markerIndex !== -1) {
        content = content.substring(0, markerIndex).trim();
      }
      content = removeStyleGuideContamination(content);
      return content;
    };

    const content = sortChaptersForDisplay(chapters.filter(c => c.content))
      .map(c => {
        let chapterContent = cleanContent(c.content || "");
        
        const headingMatch = chapterContent.match(/^(#{1,2})\s*.+\n+/);
        if (headingMatch) {
          chapterContent = chapterContent.substring(headingMatch[0].length).trim();
        }
        
        let header: string;
        if (c.chapterNumber === 0) {
          header = `# Prólogo${c.title ? `: ${c.title}` : ''}`;
        } else if (c.chapterNumber === -1) {
          header = `# Epílogo${c.title ? `: ${c.title}` : ''}`;
        } else if (c.chapterNumber === -2) {
          header = `# Nota del Autor`;
        } else {
          header = `# Capítulo ${c.chapterNumber}${c.title ? `: ${c.title}` : ''}`;
        }
        return `${header}\n\n${chapterContent}`;
      })
      .join('\n\n\n');

    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentProject.title.replace(/\s+/g, '_')}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const completedChapters = chapters.filter(c => c.status === "completed" || c.status === "approved");
  const totalWordCount = chapters.reduce((sum, c) => sum + (c.wordCount || 0), 0);

  if (projectsLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <BookOpen className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4 animate-pulse" />
          <p className="text-muted-foreground">Cargando manuscrito...</p>
        </div>
      </div>
    );
  }

  if (!currentProject) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-6">
        <BookOpen className="h-16 w-16 text-muted-foreground/20 mb-4" />
        <h2 className="text-xl font-semibold mb-2">Sin manuscrito</h2>
        <p className="text-muted-foreground max-w-md">
          Crea un nuevo proyecto desde el panel de control para comenzar a generar tu novela
        </p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col p-6" data-testid="manuscript-page">
      <div className="flex items-center justify-between gap-4 mb-6 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold">{currentProject.title}</h1>
          <div className="flex items-center gap-3 mt-2 flex-wrap">
            <Badge variant="secondary">{currentProject.genre}</Badge>
            <Badge variant="outline">{currentProject.tone}</Badge>
            <span className="text-sm text-muted-foreground">
              {completedChapters.length}/{currentProject.chapterCount} capítulos
            </span>
            <span className="text-sm text-muted-foreground">
              {totalWordCount.toLocaleString()} palabras
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant={showChat ? "secondary" : "outline"}
                  data-testid="button-toggle-chat"
                >
                  {agentType === "architect" ? (
                    <MessageSquare className="h-4 w-4 mr-2" />
                  ) : (
                    <PenTool className="h-4 w-4 mr-2" />
                  )}
                  {showChat ? `Cerrar ${agentLabels[agentType]}` : "Agentes IA"}
                  <ChevronDown className="h-4 w-4 ml-2" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem 
                  onClick={() => { setAgentType("architect"); setShowChat(true); }}
                  data-testid="menu-agent-architect"
                >
                  <MessageSquare className="h-4 w-4 mr-2" />
                  Arquitecto (trama y estructura)
                </DropdownMenuItem>
                <DropdownMenuItem 
                  onClick={() => { setAgentType("reeditor"); setShowChat(true); }}
                  data-testid="menu-agent-reeditor"
                >
                  <PenTool className="h-4 w-4 mr-2" />
                  Re-editor (correcciones y mejoras)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {showChat && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowChat(false)}
                data-testid="button-close-chat"
              >
                Cerrar
              </Button>
            )}
          </div>
          <Button 
            variant="outline"
            onClick={() => currentProject && normalizeTitlesMutation.mutate(currentProject.id)}
            disabled={normalizeTitlesMutation.isPending || chapters.length === 0}
            data-testid="button-normalize-titles"
          >
            {normalizeTitlesMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Type className="h-4 w-4 mr-2" />
            )}
            Normalizar Títulos
          </Button>
          <Button 
            variant="outline"
            onClick={handleDownload}
            disabled={completedChapters.length === 0}
            data-testid="button-download-manuscript"
          >
            <Download className="h-4 w-4 mr-2" />
            Descargar MD
          </Button>
          {currentProject.status === "completed" && (
            <Button
              variant="outline"
              onClick={() => {
                window.open(`/api/projects/${currentProject.id}/export-docx`, "_blank");
              }}
              data-testid="button-export-docx-manuscript"
            >
              <Download className="h-4 w-4 mr-2" />
              Exportar Word
            </Button>
          )}
          {completedChapters.length > 0 && (
            <Button
              variant="default"
              onClick={() => setShowAutoEditDialog(true)}
              data-testid="button-auto-reedit"
            >
              <Wand2 className="h-4 w-4 mr-2" />
              Re-edición Automática
            </Button>
          )}
        </div>
      </div>

      {/* Auto Re-edit Dialog */}
      <Dialog open={showAutoEditDialog} onOpenChange={setShowAutoEditDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Re-edición Automática</DialogTitle>
            <DialogDescription>
              El sistema creará una copia del manuscrito y aplicará las instrucciones de edición automáticamente a todos los capítulos. El manuscrito original no se modificará.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="instructions">Instrucciones de edición</Label>
              <Textarea
                id="instructions"
                placeholder="Escribe las instrucciones de edición. Ejemplos:&#10;&#10;- Recortar 20% de introspección en todos los capítulos&#10;- Añadir más tensión y ganchos al final de cada capítulo&#10;- Eliminar repeticiones y mejorar el ritmo&#10;- Mantener las escenas de clímax sin modificar"
                value={autoEditInstructions}
                onChange={(e) => setAutoEditInstructions(e.target.value)}
                className="min-h-[200px]"
                data-testid="input-auto-edit-instructions"
              />
            </div>
            <div className="text-sm text-muted-foreground">
              <p><strong>Consejo:</strong> Sé específico. Indica qué capítulos afectar, porcentajes de recorte, elementos a preservar, y qué tipo de mejoras aplicar.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAutoEditDialog(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => {
                if (currentProject && autoEditInstructions.trim()) {
                  cloneToReeditMutation.mutate({
                    projectId: currentProject.id,
                    instructions: autoEditInstructions,
                  });
                }
              }}
              disabled={!autoEditInstructions.trim() || cloneToReeditMutation.isPending}
              data-testid="button-start-auto-reedit"
            >
              {cloneToReeditMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Clonando...
                </>
              ) : (
                <>
                  <Wand2 className="h-4 w-4 mr-2" />
                  Iniciar Re-edición
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className={`flex-1 grid grid-cols-1 gap-6 min-h-0 ${showChat ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}>
        <Card className="lg:col-span-1">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Capítulos</CardTitle>
          </CardHeader>
          <CardContent>
            <ChapterList 
              chapters={sortChaptersForDisplay(chapters)}
              selectedChapterId={selectedChapter?.id}
              onSelectChapter={setSelectedChapter}
              onResetChapter={handleResetChapter}
              resettingChapterId={resettingChapterId}
            />
          </CardContent>
        </Card>

        <Card className={`flex flex-col ${showChat ? "lg:col-span-2" : "lg:col-span-2"}`}>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Vista Previa</CardTitle>
          </CardHeader>
          <CardContent className="flex-1 min-h-0">
            <ChapterViewer chapter={selectedChapter} projectId={currentProject?.id} />
          </CardContent>
        </Card>

        {showChat && currentProject && (
          <ChatPanel
            agentType={agentType}
            projectId={currentProject.id}
            chapterNumber={selectedChapter?.chapterNumber}
            className="lg:col-span-1 h-[calc(100vh-220px)]"
            onClose={() => setShowChat(false)}
          />
        )}
      </div>
    </div>
  );
}
