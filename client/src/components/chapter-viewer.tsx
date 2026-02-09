import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FileText, Clock, Loader2, Edit, Save, X, AlertTriangle, CheckCircle, MessageSquare, Trash2, Search, ChevronUp, ChevronDown, Replace } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Chapter, ChapterAnnotation } from "@shared/schema";

interface ChapterViewerProps {
  chapter: Chapter | null;
  projectId?: number;
}

export function ChapterViewer({ chapter, projectId }: ChapterViewerProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedContent, setEditedContent] = useState("");
  const [isMarkingError, setIsMarkingError] = useState(false);
  const [selectionRange, setSelectionRange] = useState<{ start: number; end: number; text: string } | null>(null);
  const [annotationNote, setAnnotationNote] = useState("");
  const [showAnnotationDialog, setShowAnnotationDialog] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [showReplace, setShowReplace] = useState(false);
  const [searchMatches, setSearchMatches] = useState<number[]>([]);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(-1);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  // Fetch annotations for this chapter
  const { data: annotations = [] } = useQuery<ChapterAnnotation[]>({
    queryKey: ["/api/chapters", chapter?.id, "annotations"],
    enabled: !!chapter?.id,
  });

  // Save chapter content mutation
  const saveContentMutation = useMutation({
    mutationFn: async ({ chapterId, content }: { chapterId: number; content: string }) => {
      const res = await apiRequest("PUT", `/api/chapters/${chapterId}`, { content });
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Cambios guardados",
        description: `${data.wordCount.toLocaleString()} palabras guardadas.`,
      });
      setIsEditing(false);
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "chapters"] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "No se pudieron guardar los cambios",
        variant: "destructive",
      });
    },
  });

  // Create annotation mutation
  const createAnnotationMutation = useMutation({
    mutationFn: async ({ chapterId, startOffset, endOffset, content, note }: {
      chapterId: number;
      startOffset: number;
      endOffset: number;
      content: string;
      note?: string;
    }) => {
      const res = await apiRequest("POST", `/api/chapters/${chapterId}/annotations`, {
        startOffset,
        endOffset,
        annotationType: "error",
        content,
        note,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Error marcado",
        description: "El texto ha sido marcado para corrección.",
      });
      setShowAnnotationDialog(false);
      setSelectionRange(null);
      setAnnotationNote("");
      queryClient.invalidateQueries({ queryKey: ["/api/chapters", chapter?.id, "annotations"] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "No se pudo marcar el error",
        variant: "destructive",
      });
    },
  });

  // Resolve annotation mutation
  const resolveAnnotationMutation = useMutation({
    mutationFn: async (annotationId: number) => {
      const res = await apiRequest("PATCH", `/api/annotations/${annotationId}/resolve`);
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Corregido",
        description: "El error ha sido marcado como resuelto.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/chapters", chapter?.id, "annotations"] });
    },
  });

  // Delete annotation mutation
  const deleteAnnotationMutation = useMutation({
    mutationFn: async (annotationId: number) => {
      const res = await apiRequest("DELETE", `/api/annotations/${annotationId}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/chapters", chapter?.id, "annotations"] });
    },
  });

  useEffect(() => {
    if (chapter?.content) {
      setEditedContent(chapter.content);
    }
  }, [chapter?.content]);

  // Handle text selection for marking errors
  const handleTextSelection = () => {
    if (!isMarkingError || !contentRef.current) return;

    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;

    const selectedText = selection.toString().trim();
    if (selectedText.length < 3) return;

    // Calculate offset within the content
    const content = chapter?.content || "";
    const start = content.indexOf(selectedText);
    if (start === -1) return;

    setSelectionRange({
      start,
      end: start + selectedText.length,
      text: selectedText,
    });
    setShowAnnotationDialog(true);
  };

  const handleSave = () => {
    if (!chapter) return;
    saveContentMutation.mutate({
      chapterId: chapter.id,
      content: editedContent,
    });
  };

  const handleCancelEdit = () => {
    setEditedContent(chapter?.content || "");
    setIsEditing(false);
    setShowSearch(false);
    setShowReplace(false);
    setSearchText("");
    setReplaceText("");
    setSearchMatches([]);
    setCurrentMatchIndex(-1);
  };

  const performSearch = (query: string, content: string) => {
    if (!query || query.length < 1) {
      setSearchMatches([]);
      setCurrentMatchIndex(-1);
      return;
    }
    const lowerContent = content.toLowerCase();
    const lowerQuery = query.toLowerCase();
    const matches: number[] = [];
    let pos = 0;
    while (pos < lowerContent.length) {
      const idx = lowerContent.indexOf(lowerQuery, pos);
      if (idx === -1) break;
      matches.push(idx);
      pos = idx + 1;
    }
    setSearchMatches(matches);
    if (matches.length > 0) {
      setCurrentMatchIndex(0);
      highlightMatch(matches[0], query.length);
    } else {
      setCurrentMatchIndex(-1);
    }
  };

  const highlightMatch = (position: number, length: number) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.focus();
    textarea.setSelectionRange(position, position + length);
    const lineHeight = 32;
    const charsPerLine = 80;
    const approxLine = Math.floor(position / charsPerLine);
    textarea.scrollTop = Math.max(0, approxLine * lineHeight - textarea.clientHeight / 3);
  };

  const goToNextMatch = () => {
    if (searchMatches.length === 0) return;
    const nextIndex = (currentMatchIndex + 1) % searchMatches.length;
    setCurrentMatchIndex(nextIndex);
    highlightMatch(searchMatches[nextIndex], searchText.length);
  };

  const goToPrevMatch = () => {
    if (searchMatches.length === 0) return;
    const prevIndex = currentMatchIndex <= 0 ? searchMatches.length - 1 : currentMatchIndex - 1;
    setCurrentMatchIndex(prevIndex);
    highlightMatch(searchMatches[prevIndex], searchText.length);
  };

  const handleReplaceCurrent = () => {
    if (searchMatches.length === 0 || currentMatchIndex < 0) return;
    const matchPos = searchMatches[currentMatchIndex];
    const before = editedContent.substring(0, matchPos);
    const after = editedContent.substring(matchPos + searchText.length);
    const newContent = before + replaceText + after;
    setEditedContent(newContent);
    performSearch(searchText, newContent);
  };

  const handleReplaceAll = () => {
    if (!searchText || searchMatches.length === 0) return;
    let newContent = "";
    let lastPos = 0;
    for (const matchPos of searchMatches) {
      newContent += editedContent.substring(lastPos, matchPos) + replaceText;
      lastPos = matchPos + searchText.length;
    }
    newContent += editedContent.substring(lastPos);
    const count = searchMatches.length;
    setEditedContent(newContent);
    setSearchMatches([]);
    setCurrentMatchIndex(-1);
    toast({
      title: "Reemplazos completados",
      description: `${count} coincidencias reemplazadas.`,
    });
  };

  useEffect(() => {
    if (showSearch && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [showSearch]);

  const handleCreateAnnotation = () => {
    if (!chapter || !selectionRange) return;
    createAnnotationMutation.mutate({
      chapterId: chapter.id,
      startOffset: selectionRange.start,
      endOffset: selectionRange.end,
      content: selectionRange.text,
      note: annotationNote || undefined,
    });
  };

  // Render content with highlighted annotations
  const renderContentWithAnnotations = (content: string) => {
    if (!annotations || annotations.length === 0 || isEditing) {
      return (
        <div 
          dangerouslySetInnerHTML={{ 
            __html: content
              .replace(/\n\n/g, '</p><p>')
              .replace(/\n/g, '<br />')
              .replace(/^/, '<p>')
              .replace(/$/, '</p>')
          }} 
        />
      );
    }

    // Sort annotations by offset
    const sortedAnnotations = [...annotations]
      .filter(a => !a.resolved)
      .sort((a, b) => a.startOffset - b.startOffset);

    if (sortedAnnotations.length === 0) {
      return (
        <div 
          dangerouslySetInnerHTML={{ 
            __html: content
              .replace(/\n\n/g, '</p><p>')
              .replace(/\n/g, '<br />')
              .replace(/^/, '<p>')
              .replace(/$/, '</p>')
          }} 
        />
      );
    }

    // Build segments with highlights
    const segments: { text: string; annotation?: ChapterAnnotation }[] = [];
    let lastEnd = 0;

    for (const annotation of sortedAnnotations) {
      if (annotation.startOffset > lastEnd) {
        segments.push({ text: content.slice(lastEnd, annotation.startOffset) });
      }
      segments.push({
        text: content.slice(annotation.startOffset, annotation.endOffset),
        annotation,
      });
      lastEnd = annotation.endOffset;
    }

    if (lastEnd < content.length) {
      segments.push({ text: content.slice(lastEnd) });
    }

    return (
      <div>
        {segments.map((segment, i) => {
          if (segment.annotation) {
            return (
              <span
                key={i}
                className="bg-destructive/30 border-b-2 border-destructive cursor-pointer relative group"
                title={segment.annotation.note || "Error marcado para corrección"}
              >
                {segment.text}
                <span className="hidden group-hover:flex absolute -top-8 left-0 bg-destructive text-destructive-foreground text-xs px-2 py-1 rounded whitespace-nowrap z-10">
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  {segment.annotation.note || "Error marcado"}
                </span>
              </span>
            );
          }
          return <span key={i}>{segment.text}</span>;
        })}
      </div>
    );
  };

  const unresolvedAnnotations = annotations.filter(a => !a.resolved);

  if (!chapter) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center py-16">
        <FileText className="h-16 w-16 text-muted-foreground/20 mb-4" />
        <p className="text-muted-foreground">
          Selecciona un capítulo para ver su contenido
        </p>
      </div>
    );
  }

  const isLoading = chapter.status === "writing" || chapter.status === "editing";

  return (
    <div className="h-full flex flex-col" data-testid={`viewer-chapter-${chapter.id}`}>
      <div className="flex items-center justify-between gap-4 pb-4 border-b mb-4 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold font-serif">
            {chapter.chapterNumber === 0 ? "Prólogo" 
              : chapter.chapterNumber === -1 ? "Epílogo"
              : chapter.chapterNumber === -2 ? "Nota del Autor"
              : `Capítulo ${chapter.chapterNumber}`}
          </h2>
          {chapter.title && (
            <p className="text-lg text-muted-foreground font-serif mt-1">
              {chapter.title}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {chapter.wordCount && chapter.wordCount > 0 && (
            <Badge variant="secondary" className="text-xs">
              {chapter.wordCount.toLocaleString()} palabras
            </Badge>
          )}
          {unresolvedAnnotations.length > 0 && (
            <Badge className="bg-destructive/20 text-destructive text-xs">
              <AlertTriangle className="h-3 w-3 mr-1" />
              {unresolvedAnnotations.length} errores
            </Badge>
          )}
          {isLoading && (
            <Badge className="bg-chart-2/20 text-chart-2">
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              En progreso
            </Badge>
          )}
          
          {/* Editing controls */}
          {chapter.content && !isLoading && (
            <div className="flex items-center gap-1">
              {isEditing ? (
                <>
                  <Button
                    size="sm"
                    variant={showSearch ? "secondary" : "outline"}
                    onClick={() => {
                      setShowSearch(!showSearch);
                      if (showSearch) {
                        setShowReplace(false);
                        setSearchText("");
                        setReplaceText("");
                        setSearchMatches([]);
                        setCurrentMatchIndex(-1);
                      }
                    }}
                    data-testid="button-toggle-search"
                  >
                    <Search className="h-4 w-4 mr-1" />
                    Buscar
                  </Button>
                  <Button
                    size="sm"
                    variant="default"
                    onClick={handleSave}
                    disabled={saveContentMutation.isPending}
                    data-testid="button-save-chapter"
                  >
                    {saveContentMutation.isPending ? (
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4 mr-1" />
                    )}
                    Guardar
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleCancelEdit}
                    data-testid="button-cancel-edit"
                  >
                    <X className="h-4 w-4 mr-1" />
                    Cancelar
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setIsEditing(true)}
                    data-testid="button-edit-chapter"
                  >
                    <Edit className="h-4 w-4 mr-1" />
                    Editar
                  </Button>
                  <Button
                    size="sm"
                    variant={isMarkingError ? "destructive" : "outline"}
                    onClick={() => setIsMarkingError(!isMarkingError)}
                    data-testid="button-mark-errors"
                  >
                    <AlertTriangle className="h-4 w-4 mr-1" />
                    {isMarkingError ? "Terminar marcado" : "Marcar errores"}
                  </Button>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Annotation list */}
      {unresolvedAnnotations.length > 0 && !isEditing && (
        <div className="mb-4 p-3 bg-destructive/10 rounded-md border border-destructive/20">
          <h3 className="text-sm font-medium text-destructive mb-2 flex items-center gap-1">
            <AlertTriangle className="h-4 w-4" />
            Errores marcados ({unresolvedAnnotations.length})
          </h3>
          <div className="space-y-2 max-h-32 overflow-y-auto">
            {unresolvedAnnotations.map((annotation) => (
              <div
                key={annotation.id}
                className="flex items-start justify-between gap-2 p-2 bg-background rounded text-sm"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-muted-foreground line-clamp-1 italic">
                    "{annotation.content}"
                  </p>
                  {annotation.note && (
                    <p className="text-xs text-muted-foreground/70 mt-1">
                      <MessageSquare className="h-3 w-3 inline mr-1" />
                      {annotation.note}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6"
                    onClick={() => resolveAnnotationMutation.mutate(annotation.id)}
                    title="Marcar como corregido"
                    data-testid={`button-resolve-annotation-${annotation.id}`}
                  >
                    <CheckCircle className="h-4 w-4 text-green-600" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6"
                    onClick={() => deleteAnnotationMutation.mutate(annotation.id)}
                    title="Eliminar"
                    data-testid={`button-delete-annotation-${annotation.id}`}
                  >
                    <Trash2 className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      
      {isEditing && showSearch && (
        <div className="mb-3 p-3 bg-muted/50 rounded-md border space-y-2" data-testid="search-panel">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1 flex-1 min-w-[200px]">
              <Search className="h-4 w-4 text-muted-foreground shrink-0" />
              <Input
                ref={searchInputRef}
                value={searchText}
                onChange={(e) => {
                  setSearchText(e.target.value);
                  performSearch(e.target.value, editedContent);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (e.shiftKey) goToPrevMatch();
                    else goToNextMatch();
                  }
                  if (e.key === "Escape") {
                    setShowSearch(false);
                    setShowReplace(false);
                    setSearchText("");
                    setReplaceText("");
                    setSearchMatches([]);
                    setCurrentMatchIndex(-1);
                  }
                }}
                placeholder="Buscar texto..."
                className="h-8 text-sm"
                data-testid="input-search-text"
              />
            </div>
            <div className="flex items-center gap-1">
              {searchText && (
                <span className="text-xs text-muted-foreground whitespace-nowrap" data-testid="text-search-count">
                  {searchMatches.length > 0
                    ? `${currentMatchIndex + 1} de ${searchMatches.length}`
                    : "Sin resultados"}
                </span>
              )}
              <Button size="icon" variant="ghost" onClick={goToPrevMatch} disabled={searchMatches.length === 0} data-testid="button-search-prev">
                <ChevronUp className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="ghost" onClick={goToNextMatch} disabled={searchMatches.length === 0} data-testid="button-search-next">
                <ChevronDown className="h-4 w-4" />
              </Button>
              <Button
                size="sm"
                variant={showReplace ? "secondary" : "ghost"}
                onClick={() => setShowReplace(!showReplace)}
                data-testid="button-toggle-replace"
              >
                <Replace className="h-4 w-4 mr-1" />
                Reemplazar
              </Button>
              <Button size="icon" variant="ghost" onClick={() => {
                setShowSearch(false);
                setShowReplace(false);
                setSearchText("");
                setReplaceText("");
                setSearchMatches([]);
                setCurrentMatchIndex(-1);
              }} data-testid="button-close-search">
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
          {showReplace && (
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1 flex-1 min-w-[200px]">
                <Replace className="h-4 w-4 text-muted-foreground shrink-0" />
                <Input
                  value={replaceText}
                  onChange={(e) => setReplaceText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleReplaceCurrent();
                    }
                  }}
                  placeholder="Reemplazar con..."
                  className="h-8 text-sm"
                  data-testid="input-replace-text"
                />
              </div>
              <div className="flex items-center gap-1">
                <Button size="sm" variant="outline" onClick={handleReplaceCurrent} disabled={searchMatches.length === 0} data-testid="button-replace-one">
                  Reemplazar
                </Button>
                <Button size="sm" variant="outline" onClick={handleReplaceAll} disabled={searchMatches.length === 0} data-testid="button-replace-all">
                  Reemplazar todo
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      <ScrollArea className="flex-1">
        {chapter.content ? (
          isEditing ? (
            <Textarea
              ref={textareaRef}
              value={editedContent}
              onChange={(e) => setEditedContent(e.target.value)}
              className="min-h-[500px] font-serif text-base leading-8 resize-none whitespace-pre-wrap"
              style={{ 
                lineHeight: '2rem',
                paddingTop: '1rem',
                paddingBottom: '1rem',
              }}
              placeholder="Escribe el contenido del capítulo aquí. Usa doble salto de línea para separar párrafos."
              data-testid="textarea-edit-chapter"
            />
          ) : (
            <article 
              ref={contentRef}
              className={`prose prose-lg dark:prose-invert max-w-prose mx-auto leading-7 font-serif ${
                isMarkingError ? "cursor-text select-text" : ""
              }`}
              onMouseUp={handleTextSelection}
            >
              {renderContentWithAnnotations(chapter.content)}
            </article>
          )
        ) : (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Clock className="h-12 w-12 text-muted-foreground/30 mb-4" />
            <p className="text-muted-foreground">
              El contenido se está generando...
            </p>
            <p className="text-xs text-muted-foreground/60 mt-2">
              El capítulo aparecerá aquí cuando esté listo
            </p>
          </div>
        )}
      </ScrollArea>

      {/* Annotation dialog */}
      <Dialog open={showAnnotationDialog} onOpenChange={setShowAnnotationDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Marcar error</DialogTitle>
            <DialogDescription>
              Añade una nota sobre el error seleccionado para referencia futura.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label className="text-sm text-muted-foreground">Texto seleccionado:</Label>
              <p className="mt-1 p-2 bg-destructive/10 rounded text-sm italic border border-destructive/20">
                "{selectionRange?.text}"
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="annotation-note">Nota (opcional)</Label>
              <Input
                id="annotation-note"
                placeholder="Describe el error o la corrección necesaria..."
                value={annotationNote}
                onChange={(e) => setAnnotationNote(e.target.value)}
                data-testid="input-annotation-note"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAnnotationDialog(false)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={handleCreateAnnotation}
              disabled={createAnnotationMutation.isPending}
              data-testid="button-confirm-annotation"
            >
              {createAnnotationMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <AlertTriangle className="h-4 w-4 mr-2" />
              )}
              Marcar error
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Marking mode indicator */}
      {isMarkingError && (
        <div className="mt-2 p-2 bg-destructive/10 rounded text-sm text-center text-destructive border border-destructive/20">
          <AlertTriangle className="h-4 w-4 inline mr-2" />
          Modo marcado activo: selecciona texto para marcar errores
        </div>
      )}
    </div>
  );
}
