import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChatPanel } from "@/components/chat-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { 
  Download, BookOpen, MessageSquare, PenTool, ChevronDown, Wand2, Loader2, Type, 
  Languages, FileText, CheckCircle, Clock, AlertCircle, ChevronLeft,
  Edit, Save, X, Search, ChevronUp, Replace, ArrowRight
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { ImportedManuscript, ImportedChapter } from "@shared/schema";

const SUPPORTED_LANGUAGES = [
  { code: "en", name: "English" },
  { code: "fr", name: "Fran\u00e7ais" },
  { code: "de", name: "Deutsch" },
  { code: "it", name: "Italiano" },
  { code: "pt", name: "Portugu\u00eas" },
  { code: "ca", name: "Catal\u00e0" },
  { code: "es", name: "Espa\u00f1ol" },
];

function getLanguageName(code: string | null | undefined): string {
  if (!code) return "Sin detectar";
  const lang = SUPPORTED_LANGUAGES.find(l => l.code === code.toLowerCase());
  return lang ? lang.name : code.toUpperCase();
}

function sortChaptersForDisplay<T extends { chapterNumber: number }>(chapters: T[]): T[] {
  return [...chapters].sort((a, b) => {
    const orderA = a.chapterNumber === 0 ? -1000 : a.chapterNumber === -1 ? 1000 : a.chapterNumber === -2 ? 1001 : a.chapterNumber;
    const orderB = b.chapterNumber === 0 ? -1000 : b.chapterNumber === -1 ? 1000 : b.chapterNumber === -2 ? 1001 : b.chapterNumber;
    return orderA - orderB;
  });
}

function getChapterDisplayName(chapterNumber: number, title: string | null | undefined): string {
  if (chapterNumber === 0) return title || "Pr\u00f3logo";
  if (chapterNumber === -1) return title || "Ep\u00edlogo";
  if (chapterNumber === -2) return title || "Nota del Autor";
  return title || `Cap\u00edtulo ${chapterNumber}`;
}

function getChapterBadge(chapterNumber: number): string {
  if (chapterNumber === 0) return "P";
  if (chapterNumber === -1) return "E";
  if (chapterNumber === -2) return "N";
  return String(chapterNumber);
}

function getChapterContent(chapter: ImportedChapter): string {
  return chapter.editedContent || chapter.originalContent || "";
}

function removeStyleGuideContamination(content: string): string {
  let cleaned = content;
  const styleGuidePatterns = [
    /^#+ *Literary Style Guide[^\n]*\n[\s\S]*?(?=^#+ *(?:CHAPTER|Chapter|Prologue|Epilogue|Author['']?s? Note)\b|\n---\n|$)/gm,
    /^#+ *Writing Guide[^\n]*\n[\s\S]*?(?=^#+ *(?:CHAPTER|Chapter|Prologue|Epilogue|Author['']?s? Note)\b|\n---\n|$)/gm,
    /^#+ *Gu\u00eda de Estilo[^\n]*\n[\s\S]*?(?=^#+ *(?:CAP\u00cdTULO|Cap\u00edtulo|Pr\u00f3logo|Ep\u00edlogo|Nota del Autor)\b|\n---\n|$)/gmi,
    /^#+ *Gu\u00eda de Escritura[^\n]*\n[\s\S]*?(?=^#+ *(?:CAP\u00cdTULO|Cap\u00edtulo|Pr\u00f3logo|Ep\u00edlogo|Nota del Autor)\b|\n---\n|$)/gmi,
  ];
  for (const pattern of styleGuidePatterns) {
    cleaned = cleaned.replace(pattern, '');
  }
  return cleaned.trim();
}

function stripChapterHeaders(content: string): string {
  let cleaned = content.trim();
  cleaned = removeStyleGuideContamination(cleaned);
  cleaned = cleaned.replace(/^#+ *(CHAPTER|CAP\u00cdTULO|CAP\.?|Cap\u00edtulo|Chapter|Chapitre|Kapitel|Capitolo|Cap\u00edtol|Pr\u00f3logo|Prologue|Prolog|Prologo|Pr\u00f2leg|Ep\u00edlogo|Epilogue|\u00c9pilogue|Epilog|Epilogo|Ep\u00edleg|Nota del Autor|Nota de l'Autor|Author'?s? Note|Note de l'auteur|Nachwort|Nota dell'autore)[^\n]*\n+/gi, '');
  return cleaned.trim();
}

const CHAPTER_LABELS: Record<string, { chapter: string; prologue: string; epilogue: string; authorNote: string }> = {
  en: { chapter: "Chapter", prologue: "Prologue", epilogue: "Epilogue", authorNote: "Author's Note" },
  es: { chapter: "Cap\u00edtulo", prologue: "Pr\u00f3logo", epilogue: "Ep\u00edlogo", authorNote: "Nota del Autor" },
  fr: { chapter: "Chapitre", prologue: "Prologue", epilogue: "\u00c9pilogue", authorNote: "Note de l'auteur" },
  de: { chapter: "Kapitel", prologue: "Prolog", epilogue: "Epilog", authorNote: "Nachwort" },
  it: { chapter: "Capitolo", prologue: "Prologo", epilogue: "Epilogo", authorNote: "Nota dell'autore" },
  pt: { chapter: "Cap\u00edtulo", prologue: "Pr\u00f3logo", epilogue: "Ep\u00edlogo", authorNote: "Nota do Autor" },
  ca: { chapter: "Cap\u00edtol", prologue: "Pr\u00f2leg", epilogue: "Ep\u00edleg", authorNote: "Nota de l'Autor" },
};

function ImportedChapterViewer({ chapter, manuscriptId, onChapterUpdated }: { 
  chapter: ImportedChapter | null; 
  manuscriptId: number;
  onChapterUpdated?: () => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedContent, setEditedContent] = useState("");
  const [searchText, setSearchText] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [showReplace, setShowReplace] = useState(false);
  const [searchMatches, setSearchMatches] = useState<number[]>([]);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(-1);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (chapter) {
      setEditedContent(getChapterContent(chapter));
    }
    setIsEditing(false);
    setShowSearch(false);
    setShowReplace(false);
    setSearchText("");
    setReplaceText("");
    setSearchMatches([]);
    setCurrentMatchIndex(-1);
  }, [chapter?.id]);

  const saveContentMutation = useMutation({
    mutationFn: async ({ chapterId, content }: { chapterId: number; content: string }) => {
      const res = await apiRequest("PATCH", `/api/imported-chapters/${chapterId}`, { 
        editedContent: content,
        status: "completed",
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Cambios guardados", description: "El contenido se ha actualizado." });
      setIsEditing(false);
      queryClient.invalidateQueries({ queryKey: ['/api/imported-manuscripts', manuscriptId, 'chapters'] });
      onChapterUpdated?.();
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "No se pudieron guardar los cambios", variant: "destructive" });
    },
  });

  const performSearch = useCallback((query: string, content: string) => {
    if (!query) {
      setSearchMatches([]);
      setCurrentMatchIndex(-1);
      return;
    }
    const lowerContent = content.toLowerCase();
    const lowerQuery = query.toLowerCase();
    const matches: number[] = [];
    let pos = 0;
    while ((pos = lowerContent.indexOf(lowerQuery, pos)) !== -1) {
      matches.push(pos);
      pos += 1;
    }
    setSearchMatches(matches);
    setCurrentMatchIndex(matches.length > 0 ? 0 : -1);
    if (matches.length > 0 && textareaRef.current) {
      textareaRef.current.setSelectionRange(matches[0], matches[0] + query.length);
      textareaRef.current.focus();
    }
  }, []);

  const goToNextMatch = () => {
    if (searchMatches.length === 0) return;
    const next = (currentMatchIndex + 1) % searchMatches.length;
    setCurrentMatchIndex(next);
    if (textareaRef.current) {
      textareaRef.current.setSelectionRange(searchMatches[next], searchMatches[next] + searchText.length);
      textareaRef.current.focus();
    }
  };

  const goToPrevMatch = () => {
    if (searchMatches.length === 0) return;
    const prev = (currentMatchIndex - 1 + searchMatches.length) % searchMatches.length;
    setCurrentMatchIndex(prev);
    if (textareaRef.current) {
      textareaRef.current.setSelectionRange(searchMatches[prev], searchMatches[prev] + searchText.length);
      textareaRef.current.focus();
    }
  };

  const handleReplaceCurrent = () => {
    if (!searchText || searchMatches.length === 0 || currentMatchIndex < 0) return;
    const matchPos = searchMatches[currentMatchIndex];
    const newContent = editedContent.substring(0, matchPos) + replaceText + editedContent.substring(matchPos + searchText.length);
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
    setEditedContent(newContent);
    performSearch(searchText, newContent);
  };

  useEffect(() => {
    if (!isEditing) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        e.preventDefault();
        setShowSearch(true);
        setTimeout(() => searchInputRef.current?.focus(), 100);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isEditing]);

  if (!chapter) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-12 text-center">
        <FileText className="h-12 w-12 text-muted-foreground/30 mb-4" />
        <p className="text-muted-foreground text-sm">Selecciona un cap\u00edtulo para ver su contenido</p>
      </div>
    );
  }

  const content = getChapterContent(chapter);
  const wordCount = content.split(/\s+/).filter(Boolean).length;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">{getChapterDisplayName(chapter.chapterNumber, chapter.title)}</h3>
          <Badge variant="outline" className="text-xs no-default-hover-elevate no-default-active-elevate">
            {wordCount.toLocaleString()} palabras
          </Badge>
          {chapter.editedContent && (
            <Badge variant="secondary" className="text-xs no-default-hover-elevate no-default-active-elevate">
              Editado
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          {isEditing ? (
            <>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setShowSearch(true);
                  setTimeout(() => searchInputRef.current?.focus(), 100);
                }}
                data-testid="button-imported-search"
              >
                <Search className="h-4 w-4 mr-1" />
                Buscar
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setIsEditing(false);
                  setEditedContent(getChapterContent(chapter));
                  setShowSearch(false);
                  setShowReplace(false);
                }}
                data-testid="button-imported-cancel-edit"
              >
                <X className="h-4 w-4 mr-1" />
                Cancelar
              </Button>
              <Button
                size="sm"
                onClick={() => saveContentMutation.mutate({ chapterId: chapter.id, content: editedContent })}
                disabled={saveContentMutation.isPending}
                data-testid="button-imported-save"
              >
                {saveContentMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
                Guardar
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setEditedContent(getChapterContent(chapter));
                setIsEditing(true);
              }}
              data-testid="button-imported-edit"
            >
              <Edit className="h-4 w-4 mr-1" />
              Editar
            </Button>
          )}
        </div>
      </div>

      {isEditing && showSearch && (
        <div className="mb-3 p-3 bg-muted/50 rounded-md border space-y-2" data-testid="imported-search-panel">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1 flex-1 min-w-[200px]">
              <Search className="h-4 w-4 text-muted-foreground shrink-0" />
              <Input
                ref={searchInputRef}
                value={searchText}
                onChange={(e) => { setSearchText(e.target.value); performSearch(e.target.value, editedContent); }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); if (e.shiftKey) goToPrevMatch(); else goToNextMatch(); }
                  if (e.key === "Escape") { setShowSearch(false); setShowReplace(false); setSearchText(""); setReplaceText(""); setSearchMatches([]); setCurrentMatchIndex(-1); }
                }}
                placeholder="Buscar texto..."
                className="h-8 text-sm"
                data-testid="input-imported-search-text"
              />
            </div>
            <div className="flex items-center gap-1">
              {searchText && (
                <span className="text-xs text-muted-foreground whitespace-nowrap" data-testid="text-imported-search-count">
                  {searchMatches.length > 0 ? `${currentMatchIndex + 1} de ${searchMatches.length}` : "Sin resultados"}
                </span>
              )}
              <Button size="icon" variant="ghost" onClick={goToPrevMatch} disabled={searchMatches.length === 0} data-testid="button-imported-search-prev">
                <ChevronUp className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="ghost" onClick={goToNextMatch} disabled={searchMatches.length === 0} data-testid="button-imported-search-next">
                <ChevronDown className="h-4 w-4" />
              </Button>
              <Button size="sm" variant={showReplace ? "secondary" : "ghost"} onClick={() => setShowReplace(!showReplace)} data-testid="button-imported-toggle-replace">
                <Replace className="h-4 w-4 mr-1" />
                Reemplazar
              </Button>
              <Button size="icon" variant="ghost" onClick={() => { setShowSearch(false); setShowReplace(false); setSearchText(""); setReplaceText(""); setSearchMatches([]); setCurrentMatchIndex(-1); }} data-testid="button-imported-close-search">
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
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleReplaceCurrent(); } }}
                  placeholder="Reemplazar con..."
                  className="h-8 text-sm"
                  data-testid="input-imported-replace-text"
                />
              </div>
              <div className="flex items-center gap-1">
                <Button size="sm" variant="outline" onClick={handleReplaceCurrent} disabled={searchMatches.length === 0} data-testid="button-imported-replace-one">Reemplazar</Button>
                <Button size="sm" variant="outline" onClick={handleReplaceAll} disabled={searchMatches.length === 0} data-testid="button-imported-replace-all">Reemplazar todo</Button>
              </div>
            </div>
          )}
        </div>
      )}

      <ScrollArea className="flex-1">
        {isEditing ? (
          <Textarea
            ref={textareaRef}
            value={editedContent}
            onChange={(e) => setEditedContent(e.target.value)}
            className="min-h-[500px] font-serif text-base leading-8 resize-none whitespace-pre-wrap"
            style={{ lineHeight: '2rem', paddingTop: '1rem', paddingBottom: '1rem' }}
            placeholder="Escribe el contenido del cap\u00edtulo aqu\u00ed."
            data-testid="textarea-imported-edit-chapter"
          />
        ) : (
          <div className="prose prose-sm dark:prose-invert max-w-none font-serif text-base leading-8">
            {content.split('\n\n').map((paragraph, i) => (
              <p key={i} className="mb-4">{paragraph}</p>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

function ManuscriptSelector({ manuscripts, selectedId, onSelect }: {
  manuscripts: ImportedManuscript[];
  selectedId: number | null;
  onSelect: (id: number) => void;
}) {
  if (manuscripts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-6">
        <BookOpen className="h-16 w-16 text-muted-foreground/20 mb-4" />
        <h2 className="text-xl font-semibold mb-2">Sin libros importados</h2>
        <p className="text-muted-foreground max-w-md">
          Importa un manuscrito desde la secci\u00f3n "Importar Libros" para verlo aqu\u00ed
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {manuscripts.map(m => {
        const isSelected = m.id === selectedId;
        return (
          <Button
            key={m.id}
            variant={isSelected ? "secondary" : "ghost"}
            className="w-full justify-start gap-3 h-auto py-3"
            onClick={() => onSelect(m.id)}
            data-testid={`button-select-manuscript-${m.id}`}
          >
            <BookOpen className="h-4 w-4 shrink-0" />
            <div className="flex-1 text-left min-w-0">
              <div className="font-medium truncate text-sm">{m.title}</div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>{m.totalChapters || 0} caps.</span>
                <span>{getLanguageName(m.detectedLanguage)}</span>
              </div>
            </div>
            {m.status === "completed" && <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />}
            {m.status === "processing" && <Loader2 className="h-4 w-4 animate-spin text-blue-500 shrink-0" />}
          </Button>
        );
      })}
    </div>
  );
}

export default function ImportedManuscriptsPage() {
  const [selectedManuscriptId, setSelectedManuscriptId] = useState<number | null>(null);
  const [selectedChapter, setSelectedChapter] = useState<ImportedChapter | null>(null);
  const [showChat, setShowChat] = useState(false);
  const [agentType, setAgentType] = useState<"architect" | "reeditor">("architect");
  const [showTranslateDialog, setShowTranslateDialog] = useState(false);
  const [targetLanguage, setTargetLanguage] = useState("es");
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const agentLabels = {
    architect: "Arquitecto",
    reeditor: "Re-editor",
  };

  const { data: manuscripts = [], isLoading: manuscriptsLoading } = useQuery<ImportedManuscript[]>({
    queryKey: ['/api/imported-manuscripts'],
  });

  const selectedManuscript = manuscripts.find(m => m.id === selectedManuscriptId) || null;

  const { data: chapters = [], isLoading: chaptersLoading } = useQuery<ImportedChapter[]>({
    queryKey: ['/api/imported-manuscripts', selectedManuscriptId, 'chapters'],
    enabled: !!selectedManuscriptId,
  });

  const normalizeTitlesMutation = useMutation({
    mutationFn: async (manuscriptId: number) => {
      const res = await apiRequest("POST", `/api/imported-manuscripts/${manuscriptId}/normalize-titles`);
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "T\u00edtulos normalizados", description: `Se actualizaron ${data.chaptersUpdated} de ${data.totalChapters} cap\u00edtulos.` });
      queryClient.invalidateQueries({ queryKey: ['/api/imported-manuscripts', selectedManuscriptId, 'chapters'] });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "No se pudieron normalizar los t\u00edtulos", variant: "destructive" });
    },
  });

  const handleDownload = () => {
    if (!selectedManuscript || chapters.length === 0) return;
    const labels = CHAPTER_LABELS[selectedManuscript.detectedLanguage?.toLowerCase() || "es"] || CHAPTER_LABELS.es;
    const content = sortChaptersForDisplay(chapters)
      .filter(c => getChapterContent(c))
      .map(c => {
        let chapterContent = stripChapterHeaders(getChapterContent(c));
        let header: string;
        if (c.chapterNumber === 0) {
          header = `# ${c.title || labels.prologue}`;
        } else if (c.chapterNumber === -1) {
          header = `# ${c.title || labels.epilogue}`;
        } else if (c.chapterNumber === -2) {
          header = `# ${c.title || labels.authorNote}`;
        } else {
          header = `# ${labels.chapter} ${c.chapterNumber}${c.title ? `: ${c.title}` : ''}`;
        }
        return `${header}\n\n${chapterContent}`;
      })
      .join('\n\n\n');

    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedManuscript.title.replace(/\s+/g, '_')}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const sendToTranslationMutation = useMutation({
    mutationFn: async ({ manuscriptId, tgtLang }: { manuscriptId: number; tgtLang: string }) => {
      const res = await apiRequest("POST", `/api/imported-manuscripts/${manuscriptId}/send-to-translation`, {
        targetLanguage: tgtLang,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Enviado a traducciones", description: "El manuscrito se ha enviado a la secci\u00f3n de traducciones." });
      setShowTranslateDialog(false);
      navigate("/export");
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "No se pudo enviar a traducciones", variant: "destructive" });
    },
  });

  const sortedChapters = sortChaptersForDisplay(chapters);
  const completedChapters = chapters.filter(c => c.status === "completed");
  const totalWordCount = chapters.reduce((sum, c) => sum + (c.wordCount || 0), 0);

  if (manuscriptsLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <BookOpen className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4 animate-pulse" />
          <p className="text-muted-foreground">Cargando libros importados...</p>
        </div>
      </div>
    );
  }

  if (manuscripts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-6">
        <BookOpen className="h-16 w-16 text-muted-foreground/20 mb-4" />
        <h2 className="text-xl font-semibold mb-2">Sin libros importados</h2>
        <p className="text-muted-foreground max-w-md">
          Importa un manuscrito desde la secci\u00f3n "Importar Libros" para comenzar
        </p>
      </div>
    );
  }

  if (!selectedManuscriptId) {
    return (
      <div className="h-full flex flex-col p-6" data-testid="imported-manuscripts-page">
        <div className="mb-6">
          <h1 className="text-3xl font-bold">Libros Importados</h1>
          <p className="text-muted-foreground mt-1">Selecciona un libro importado para ver y editar su contenido</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {manuscripts.map(m => (
            <Card key={m.id} className="hover-elevate cursor-pointer" onClick={() => setSelectedManuscriptId(m.id)} data-testid={`card-imported-manuscript-${m.id}`}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base truncate">{m.title}</CardTitle>
                  <Badge variant={m.status === "completed" ? "default" : "secondary"} className="shrink-0 no-default-hover-elevate no-default-active-elevate">
                    {m.status === "completed" && <CheckCircle className="h-3 w-3 mr-1" />}
                    {m.status === "processing" && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                    {m.status === "pending" && <Clock className="h-3 w-3 mr-1" />}
                    {m.status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <FileText className="h-3 w-3" />
                    <span>{m.totalChapters || 0} caps.</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Languages className="h-3 w-3" />
                    <span>{getLanguageName(m.detectedLanguage)}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col p-6" data-testid="imported-manuscripts-detail-page">
      <div className="flex items-center justify-between gap-4 mb-6 flex-wrap">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => { setSelectedManuscriptId(null); setSelectedChapter(null); }} data-testid="button-back-to-list">
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold">{selectedManuscript?.title}</h1>
            <div className="flex items-center gap-3 mt-2 flex-wrap">
              <Badge variant="secondary">{getLanguageName(selectedManuscript?.detectedLanguage)}</Badge>
              <span className="text-sm text-muted-foreground">
                {completedChapters.length}/{chapters.length} cap\u00edtulos editados
              </span>
              <span className="text-sm text-muted-foreground">
                {totalWordCount.toLocaleString()} palabras
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant={showChat ? "secondary" : "outline"} data-testid="button-imported-toggle-chat">
                  {agentType === "architect" ? <MessageSquare className="h-4 w-4 mr-2" /> : <PenTool className="h-4 w-4 mr-2" />}
                  {showChat ? `Cerrar ${agentLabels[agentType]}` : "Agentes IA"}
                  <ChevronDown className="h-4 w-4 ml-2" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onClick={() => { setAgentType("architect"); setShowChat(true); }} data-testid="menu-imported-agent-architect">
                  <MessageSquare className="h-4 w-4 mr-2" />
                  Arquitecto (trama y estructura)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => { setAgentType("reeditor"); setShowChat(true); }} data-testid="menu-imported-agent-reeditor">
                  <PenTool className="h-4 w-4 mr-2" />
                  Re-editor (correcciones y mejoras)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {showChat && (
              <Button variant="ghost" size="sm" onClick={() => setShowChat(false)} data-testid="button-imported-close-chat">
                Cerrar
              </Button>
            )}
          </div>
          <Button
            variant="outline"
            onClick={() => selectedManuscriptId && normalizeTitlesMutation.mutate(selectedManuscriptId)}
            disabled={normalizeTitlesMutation.isPending || chapters.length === 0}
            data-testid="button-imported-normalize-titles"
          >
            {normalizeTitlesMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Type className="h-4 w-4 mr-2" />}
            Normalizar T\u00edtulos
          </Button>
          <Button variant="outline" onClick={handleDownload} disabled={chapters.length === 0} data-testid="button-imported-download">
            <Download className="h-4 w-4 mr-2" />
            Descargar MD
          </Button>
          <Button variant="default" onClick={() => setShowTranslateDialog(true)} disabled={chapters.length === 0} data-testid="button-imported-send-translation">
            <ArrowRight className="h-4 w-4 mr-2" />
            Enviar a Traducciones
          </Button>
        </div>
      </div>

      <Dialog open={showTranslateDialog} onOpenChange={setShowTranslateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enviar a Traducciones</DialogTitle>
            <DialogDescription>
              Se enviar\u00e1 el manuscrito importado a la secci\u00f3n de traducciones para su transcreaci\u00f3n.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Idioma destino</Label>
              <Select value={targetLanguage} onValueChange={setTargetLanguage}>
                <SelectTrigger data-testid="select-imported-target-language">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SUPPORTED_LANGUAGES.map(lang => (
                    <SelectItem key={lang.code} value={lang.code}>{lang.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowTranslateDialog(false)}>Cancelar</Button>
            <Button
              onClick={() => selectedManuscriptId && sendToTranslationMutation.mutate({ manuscriptId: selectedManuscriptId, tgtLang: targetLanguage })}
              disabled={sendToTranslationMutation.isPending}
              data-testid="button-confirm-send-translation"
            >
              {sendToTranslationMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ArrowRight className="h-4 w-4 mr-2" />}
              Enviar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className={`flex-1 grid grid-cols-1 gap-6 min-h-0 ${showChat ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}>
        <Card className="lg:col-span-1">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Cap\u00edtulos</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[calc(100vh-320px)]">
              <div className="p-4 space-y-2">
                {chaptersLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : sortedChapters.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground text-sm">Sin cap\u00edtulos</div>
                ) : (
                  sortedChapters.map((chapter) => (
                    <Button
                      key={chapter.id}
                      variant={selectedChapter?.id === chapter.id ? "secondary" : "ghost"}
                      className="w-full justify-start gap-2"
                      onClick={() => setSelectedChapter(chapter)}
                      data-testid={`button-imported-chapter-${chapter.id}`}
                    >
                      <Badge
                        variant="outline"
                        className={`font-mono text-xs shrink-0 no-default-hover-elevate no-default-active-elevate ${
                          chapter.status === "completed" ? "bg-green-500/10 text-green-600 border-green-500/30" :
                          chapter.status === "processing" ? "bg-blue-500/10 text-blue-600 border-blue-500/30" :
                          "bg-muted text-muted-foreground"
                        }`}
                      >
                        {getChapterBadge(chapter.chapterNumber)}
                      </Badge>
                      <span className="truncate flex-1 text-left text-sm">
                        {getChapterDisplayName(chapter.chapterNumber, chapter.title)}
                      </span>
                      {chapter.status === "completed" && <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />}
                      {chapter.status === "processing" && <Loader2 className="h-4 w-4 animate-spin text-blue-500 shrink-0" />}
                      {chapter.status === "pending" && <Clock className="h-4 w-4 text-muted-foreground shrink-0" />}
                      {chapter.status === "error" && <AlertCircle className="h-4 w-4 text-destructive shrink-0" />}
                    </Button>
                  ))
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        <Card className={`flex flex-col ${showChat ? "lg:col-span-2" : "lg:col-span-2"}`}>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Vista Previa</CardTitle>
          </CardHeader>
          <CardContent className="flex-1 min-h-0">
            <ImportedChapterViewer
              chapter={selectedChapter}
              manuscriptId={selectedManuscriptId}
              onChapterUpdated={() => {
                queryClient.invalidateQueries({ queryKey: ['/api/imported-manuscripts', selectedManuscriptId, 'chapters'] });
              }}
            />
          </CardContent>
        </Card>

        {showChat && selectedManuscript && (
          <ChatPanel
            agentType={agentType}
            projectId={undefined}
            chapterNumber={selectedChapter?.chapterNumber}
            className="lg:col-span-1 h-[calc(100vh-220px)]"
            onClose={() => setShowChat(false)}
          />
        )}
      </div>
    </div>
  );
}
