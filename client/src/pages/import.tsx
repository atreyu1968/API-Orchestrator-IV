import { useState, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { 
  Upload, 
  FileText, 
  DollarSign, 
  Loader2, 
  Trash2, 
  Eye,
  CheckCircle,
  Clock,
  AlertCircle,
  Languages,
  Pencil,
  Download
} from "lucide-react";
import type { ImportedManuscript, ImportedChapter } from "@shared/schema";

const SUPPORTED_LANGUAGES = [
  { code: "en", name: "English" },
  { code: "fr", name: "Français" },
  { code: "de", name: "Deutsch" },
  { code: "it", name: "Italiano" },
  { code: "pt", name: "Português" },
  { code: "ca", name: "Català" },
  { code: "es", name: "Español" },
];

function getLanguageName(code: string | null | undefined): string {
  if (!code) return "Sin detectar";
  const lang = SUPPORTED_LANGUAGES.find(l => l.code === code.toLowerCase());
  return lang ? lang.name : code.toUpperCase();
}

const INPUT_PRICE_PER_MILLION = 0.80;
const OUTPUT_PRICE_PER_MILLION = 6.50;
const THINKING_PRICE_PER_MILLION = 3.0;

function calculateCost(inputTokens: number, outputTokens: number, thinkingTokens: number) {
  const inputCost = (inputTokens / 1_000_000) * INPUT_PRICE_PER_MILLION;
  const outputCost = (outputTokens / 1_000_000) * OUTPUT_PRICE_PER_MILLION;
  const thinkingCost = (thinkingTokens / 1_000_000) * THINKING_PRICE_PER_MILLION;
  return inputCost + outputCost + thinkingCost;
}

function getChapterDisplayName(chapterNumber: number, title: string | null | undefined): string {
  if (chapterNumber === 0) return title || "Prólogo";
  if (chapterNumber === -1) return title || "Epílogo";
  if (chapterNumber === -2) return title || "Nota del Autor";
  return title || `Capítulo ${chapterNumber}`;
}

function getChapterBadge(chapterNumber: number): string {
  if (chapterNumber === 0) return "P";
  if (chapterNumber === -1) return "E";
  if (chapterNumber === -2) return "N";
  return String(chapterNumber);
}

function sortChaptersForDisplay<T extends { chapterNumber: number }>(chapters: T[]): T[] {
  return [...chapters].sort((a, b) => {
    const orderA = a.chapterNumber === 0 ? -1000 : a.chapterNumber === -1 ? 1000 : a.chapterNumber === -2 ? 1001 : a.chapterNumber;
    const orderB = b.chapterNumber === 0 ? -1000 : b.chapterNumber === -1 ? 1000 : b.chapterNumber === -2 ? 1001 : b.chapterNumber;
    return orderA - orderB;
  });
}

function removeStyleGuideContamination(content: string): string {
  let cleaned = content;
  
  const styleGuidePatterns = [
    // English patterns
    /^#+ *Literary Style Guide[^\n]*\n[\s\S]*?(?=^#+ *(?:CHAPTER|Chapter|Prologue|Epilogue|Author['']?s? Note)\b|\n---\n|$)/gm,
    /^#+ *Writing Guide[^\n]*\n[\s\S]*?(?=^#+ *(?:CHAPTER|Chapter|Prologue|Epilogue|Author['']?s? Note)\b|\n---\n|$)/gm,
    /^#+ *The Master of[^\n]*\n[\s\S]*?(?=^#+ *(?:CHAPTER|Chapter|Prologue|Epilogue|Author['']?s? Note)\b|\n---\n|$)/gm,
    // Spanish patterns
    /^#+ *Guía de Estilo[^\n]*\n[\s\S]*?(?=^#+ *(?:CAPÍTULO|Capítulo|Prólogo|Epílogo|Nota del Autor)\b|\n---\n|$)/gmi,
    /^#+ *Guía de Escritura[^\n]*\n[\s\S]*?(?=^#+ *(?:CAPÍTULO|Capítulo|Prólogo|Epílogo|Nota del Autor)\b|\n---\n|$)/gmi,
    // Checklist patterns
    /^###+ *Checklist[^\n]*\n[\s\S]*?(?=^#{1,2} *(?:CHAPTER|Chapter|CAPÍTULO|Capítulo|Prologue|Prólogo|Epilogue|Epílogo)\b|\n---\n|$)/gmi,
    // Generic style guide block between --- separators
    /\n---\n[\s\S]*?(?:Style Guide|Guía de Estilo|Writing Guide|Guía de Escritura)[\s\S]*?\n---\n/gi,
  ];
  
  for (const pattern of styleGuidePatterns) {
    cleaned = cleaned.replace(pattern, '');
  }
  
  // Remove meta-sections that shouldn't be in narrative
  const metaSectionPatterns = [
    /^#+ *\d+\. *(?:Narrative Architecture|Character Construction|Central Themes|Language and Stylistic|Tone and Atmosphere)[^\n]*\n[\s\S]*?(?=^#+ *(?:CHAPTER|Chapter|CAPÍTULO|Capítulo|Prologue|Prólogo)\b|$)/gmi,
  ];
  
  for (const pattern of metaSectionPatterns) {
    cleaned = cleaned.replace(pattern, '');
  }
  
  return cleaned.trim();
}

function stripChapterHeaders(content: string): string {
  let cleaned = content.trim();
  // First remove any style guide contamination
  cleaned = removeStyleGuideContamination(cleaned);
  // Remove markdown headers at the start that contain chapter/prólogo/epílogo info
  cleaned = cleaned.replace(/^#+ *(CHAPTER|CAPÍTULO|CAP\.?|Capítulo|Chapter|Prólogo|Prologue|Epílogo|Epilogue|Nota del Autor|Author'?s? Note)[^\n]*\n+/i, '');
  return cleaned.trim();
}

function generateMarkdownExport(
  manuscript: ImportedManuscript,
  chapters: ImportedChapter[]
): string {
  const sortedChapters = sortChaptersForDisplay(chapters);
  const lines: string[] = [];
  
  lines.push(`# ${manuscript.title}`);
  lines.push("");
  
  for (const chapter of sortedChapters) {
    const content = chapter.editedContent || chapter.originalContent;
    if (!content) continue;
    
    let heading: string;
    if (chapter.chapterNumber === 0) {
      heading = chapter.title || "Prólogo";
    } else if (chapter.chapterNumber === -1) {
      heading = chapter.title || "Epílogo";
    } else if (chapter.chapterNumber === -2) {
      heading = chapter.title || "Nota del Autor";
    } else {
      heading = chapter.title || `Capítulo ${chapter.chapterNumber}`;
    }
    
    lines.push(`## ${heading}`);
    lines.push("");
    lines.push(stripChapterHeaders(content));
    lines.push("");
  }
  
  return lines.join("\n");
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

function parseChaptersFromText(text: string): { chapterNumber: number; title: string | null; content: string }[] {
  const chapterPatterns = [
    /(?:^|\n)(Capítulo|Chapter|Chapitre|Kapitel|Capitolo|Capítol)\s+(\d+)[:\.\s]*([^\n]*)/gi,
    /(?:^|\n)(Cap\.?)\s+(\d+)[:\.\s]*([^\n]*)/gi,
  ];

  const prologuePatterns = [
    /(?:^|\n)(Prólogo|Prologue|Prolog|Prologo|Pròleg|Prefacio|Preface|Préface|Vorwort|Prefazione|Prefaci|Avant-propos)[:\.\s]*([^\n]*)/gi,
  ];

  const epiloguePatterns = [
    /(?:^|\n)(Epílogo|Epilogue|Épilogue|Epilog|Epilogo|Epíleg)[:\.\s]*([^\n]*)/gi,
  ];

  const authorNotePatterns = [
    /(?:^|\n)(Nota del Autor|Nota de l'Autor|Author'?s? Note|Note de l'auteur|Nachwort|Nota dell'autore|Nota final|Notas? finales?|Posfacio|Postfacio|Afterword|Postface|Palabras del Autor|Agradecimientos|Acknowledgments?|Remerciements|Ringraziamenti|Danksagung)[:\.\s]*([^\n]*)/gi,
  ];
  
  const chapters: { chapterNumber: number; title: string | null; content: string; startIndex: number }[] = [];

  for (const pattern of prologuePatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const title = match[2]?.trim() || match[1];
      chapters.push({
        chapterNumber: 0,
        title: title || "Prólogo",
        content: "",
        startIndex: match.index,
      });
    }
  }
  
  for (const pattern of chapterPatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const chapterNumber = parseInt(match[2], 10);
      const title = match[3]?.trim() || null;
      chapters.push({
        chapterNumber,
        title,
        content: "",
        startIndex: match.index,
      });
    }
  }

  for (const pattern of epiloguePatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const title = match[2]?.trim() || match[1];
      chapters.push({
        chapterNumber: -1,
        title: title || "Epílogo",
        content: "",
        startIndex: match.index,
      });
    }
  }

  for (const pattern of authorNotePatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const title = match[2]?.trim() || match[1];
      chapters.push({
        chapterNumber: -2,
        title: title || "Nota del Autor",
        content: "",
        startIndex: match.index,
      });
    }
  }
  
  if (chapters.length === 0) {
    return [{
      chapterNumber: 1,
      title: null,
      content: text.trim(),
    }];
  }
  
  chapters.sort((a, b) => a.startIndex - b.startIndex);
  
  for (let i = 0; i < chapters.length; i++) {
    const start = chapters[i].startIndex;
    const end = i < chapters.length - 1 ? chapters[i + 1].startIndex : text.length;
    const fullContent = text.slice(start, end).trim();
    const firstLineEnd = fullContent.indexOf('\n');
    chapters[i].content = firstLineEnd > 0 ? fullContent.slice(firstLineEnd + 1).trim() : fullContent;
  }
  
  return chapters.map(({ chapterNumber, title, content }) => ({ chapterNumber, title, content }));
}

function ManuscriptCard({ manuscript, onSelect, onDelete }: { 
  manuscript: ImportedManuscript; 
  onSelect: () => void;
  onDelete: () => void;
}) {
  const progress = manuscript.totalChapters ? (manuscript.processedChapters || 0) / manuscript.totalChapters * 100 : 0;
  const totalCost = calculateCost(
    manuscript.totalInputTokens || 0,
    manuscript.totalOutputTokens || 0,
    manuscript.totalThinkingTokens || 0
  );

  const statusColors: Record<string, string> = {
    pending: "bg-muted text-muted-foreground",
    processing: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
    completed: "bg-green-500/10 text-green-600 dark:text-green-400",
    error: "bg-destructive/10 text-destructive",
  };

  const statusIcons: Record<string, typeof Clock> = {
    pending: Clock,
    processing: Loader2,
    completed: CheckCircle,
    error: AlertCircle,
  };

  const StatusIcon = statusIcons[manuscript.status] || Clock;

  return (
    <Card className="hover-elevate cursor-pointer" onClick={onSelect} data-testid={`card-manuscript-${manuscript.id}`}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <CardTitle className="text-base truncate">{manuscript.title}</CardTitle>
            <CardDescription className="text-xs truncate">{manuscript.originalFileName}</CardDescription>
          </div>
          <Badge className={statusColors[manuscript.status]}>
            <StatusIcon className={`h-3 w-3 mr-1 ${manuscript.status === 'processing' ? 'animate-spin' : ''}`} />
            {manuscript.status}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <div className="flex items-center gap-1">
            <Languages className="h-3 w-3" />
            <span>{getLanguageName(manuscript.detectedLanguage)}</span>
          </div>
          <div className="flex items-center gap-1">
            <FileText className="h-3 w-3" />
            <span>{manuscript.processedChapters || 0}/{manuscript.totalChapters || 0} caps.</span>
          </div>
        </div>
        
        {manuscript.status !== 'pending' && (
          <Progress value={progress} className="h-1" />
        )}
        
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1 text-sm">
            <DollarSign className="h-3 w-3 text-muted-foreground" />
            <span className="font-mono">${totalCost.toFixed(4)}</span>
          </div>
          <Button 
            size="icon" 
            variant="ghost" 
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            data-testid={`button-delete-manuscript-${manuscript.id}`}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ManuscriptDetail({ manuscriptId, onBack }: { manuscriptId: number; onBack: () => void }) {
  const { toast } = useToast();
  const [selectedChapter, setSelectedChapter] = useState<ImportedChapter | null>(null);

  const { data: manuscript, isLoading: isLoadingManuscript, refetch: refetchManuscript } = useQuery<ImportedManuscript>({
    queryKey: ['/api/imported-manuscripts', manuscriptId],
    refetchInterval: (query) => {
      const data = query.state.data as ImportedManuscript | undefined;
      return data?.status === "processing" ? 3000 : false;
    },
  });

  const { data: chapters = [], isLoading: isLoadingChapters, refetch: refetchChapters } = useQuery<ImportedChapter[]>({
    queryKey: ['/api/imported-manuscripts', manuscriptId, 'chapters'],
    refetchInterval: (query) => {
      return manuscript?.status === "processing" ? 3000 : false;
    },
  });

  const editChapterMutation = useMutation({
    mutationFn: async (chapterId: number) => {
      const res = await apiRequest("POST", `/api/imported-chapters/${chapterId}/edit`);
      return res.json();
    },
    onSuccess: async () => {
      await refetchManuscript();
      const { data: updatedChapters } = await refetchChapters();
      if (selectedChapter && updatedChapters) {
        const updated = updatedChapters.find(c => c.id === selectedChapter.id);
        if (updated) setSelectedChapter(updated);
      }
      toast({ title: "Capítulo editado", description: "El capítulo se ha editado correctamente" });
    },
    onError: (error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const editAllMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/imported-manuscripts/${manuscriptId}/edit-all`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Edición iniciada", description: "Los capítulos se están editando. La página se actualizará automáticamente." });
      refetchManuscript();
      refetchChapters();
    },
    onError: (error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const totalCost = manuscript ? calculateCost(
    manuscript.totalInputTokens || 0,
    manuscript.totalOutputTokens || 0,
    manuscript.totalThinkingTokens || 0
  ) : 0;

  if (isLoadingManuscript || isLoadingChapters) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!manuscript) {
    return (
      <div className="text-center py-8">
        <p className="text-muted-foreground">Manuscrito no encontrado</p>
        <Button onClick={onBack} className="mt-4">Volver</Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-semibold">{manuscript.title}</h2>
          <p className="text-muted-foreground">{manuscript.originalFileName}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button 
            onClick={() => editAllMutation.mutate()}
            disabled={editAllMutation.isPending || manuscript.status === "processing" || chapters.every(c => c.status === "completed")}
            data-testid="button-edit-all-chapters"
          >
            {editAllMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Editar Todos
          </Button>
          <Button 
            variant="secondary"
            onClick={() => {
              const md = generateMarkdownExport(manuscript, chapters);
              const filename = `${manuscript.title.replace(/[^a-zA-Z0-9áéíóúüñÁÉÍÓÚÜÑ\s]/g, "").replace(/\s+/g, "_")}.md`;
              downloadMarkdown(filename, md);
            }}
            disabled={chapters.length === 0}
            data-testid="button-export-manuscript"
          >
            <Download className="h-4 w-4 mr-2" />
            Exportar MD
          </Button>
          <Button variant="outline" onClick={onBack}>Volver</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold">{manuscript.totalChapters || 0}</div>
            <p className="text-sm text-muted-foreground">Capítulos Totales</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold">{manuscript.processedChapters || 0}</div>
            <p className="text-sm text-muted-foreground">Capítulos Editados</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold">{getLanguageName(manuscript.detectedLanguage)}</div>
            <p className="text-sm text-muted-foreground">Idioma Detectado</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold font-mono">${totalCost.toFixed(4)}</div>
            <p className="text-sm text-muted-foreground">Coste Total USD</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-base">Capítulos</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[400px]">
              <div className="p-4 space-y-2">
                {sortChaptersForDisplay(chapters).map((chapter) => (
                  <Button
                    key={chapter.id}
                    variant={selectedChapter?.id === chapter.id ? "secondary" : "ghost"}
                    className="w-full justify-start gap-2"
                    onClick={() => setSelectedChapter(chapter)}
                    data-testid={`button-chapter-${chapter.id}`}
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
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle className="text-base">
              {selectedChapter 
                ? getChapterDisplayName(selectedChapter.chapterNumber, selectedChapter.title)
                : "Selecciona un capítulo"
              }
            </CardTitle>
            {selectedChapter && selectedChapter.status !== "completed" && (
              <Button
                size="sm"
                onClick={() => editChapterMutation.mutate(selectedChapter.id)}
                disabled={editChapterMutation.isPending || selectedChapter.status === "processing"}
                data-testid={`button-edit-chapter-${selectedChapter.id}`}
              >
                {editChapterMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Pencil className="h-4 w-4 mr-2" />
                )}
                Editar
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {selectedChapter ? (
              <Tabs defaultValue="original">
                <TabsList className="mb-4">
                  <TabsTrigger value="original">Original</TabsTrigger>
                  <TabsTrigger value="edited" disabled={!selectedChapter.editedContent}>Editado</TabsTrigger>
                  <TabsTrigger value="changes" disabled={!selectedChapter.changesLog}>Cambios</TabsTrigger>
                </TabsList>
                <TabsContent value="original">
                  <ScrollArea className="h-[300px] border rounded-md p-4">
                    <pre className="whitespace-pre-wrap font-serif text-sm">
                      {selectedChapter.originalContent}
                    </pre>
                  </ScrollArea>
                </TabsContent>
                <TabsContent value="edited">
                  <ScrollArea className="h-[300px] border rounded-md p-4">
                    <pre className="whitespace-pre-wrap font-serif text-sm">
                      {selectedChapter.editedContent || "No hay contenido editado aún"}
                    </pre>
                  </ScrollArea>
                </TabsContent>
                <TabsContent value="changes">
                  <ScrollArea className="h-[300px] border rounded-md p-4">
                    <pre className="whitespace-pre-wrap font-mono text-xs">
                      {selectedChapter.changesLog || "Sin registro de cambios"}
                    </pre>
                  </ScrollArea>
                </TabsContent>
              </Tabs>
            ) : (
              <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                <p>Selecciona un capítulo para ver su contenido</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function ImportPage() {
  const { toast } = useToast();
  const [selectedManuscriptId, setSelectedManuscriptId] = useState<number | null>(null);
  const [uploadState, setUploadState] = useState<{
    file: File | null;
    title: string;
    targetLanguage: string;
    parsedChapters: { chapterNumber: number; title: string | null; content: string }[];
    isUploading: boolean;
    isParsing: boolean;
  }>({
    file: null,
    title: "",
    targetLanguage: "es",
    parsedChapters: [],
    isUploading: false,
    isParsing: false,
  });

  const { data: manuscripts = [], isLoading } = useQuery<ImportedManuscript[]>({
    queryKey: ['/api/imported-manuscripts'],
    refetchInterval: (query) => {
      const data = query.state.data as ImportedManuscript[] | undefined;
      return data?.some(m => m.status === "processing") ? 3000 : false;
    },
  });

  const createManuscriptMutation = useMutation({
    mutationFn: async (data: {
      title: string;
      originalFileName: string;
      targetLanguage: string;
      detectedLanguage: string;
      chapters: { chapterNumber: number; title: string | null; content: string }[];
    }) => {
      const res = await apiRequest("POST", "/api/imported-manuscripts", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/imported-manuscripts'] });
      setUploadState({
        file: null,
        title: "",
        targetLanguage: "es",
        parsedChapters: [],
        isUploading: false,
        isParsing: false,
      });
      toast({
        title: "Manuscrito importado",
        description: "El manuscrito se ha importado correctamente",
      });
    },
    onError: (error) => {
      toast({
        title: "Error al importar",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteManuscriptMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/imported-manuscripts/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/imported-manuscripts'] });
      toast({
        title: "Manuscrito eliminado",
        description: "El manuscrito se ha eliminado correctamente",
      });
    },
    onError: (error) => {
      toast({
        title: "Error al eliminar",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadState(prev => ({ ...prev, file, isParsing: true, title: file.name.replace(/\.[^/.]+$/, "") }));

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/upload/word", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Error al procesar el archivo");
      }

      const result = await response.json();
      const chapters = parseChaptersFromText(result.content);

      setUploadState(prev => ({
        ...prev,
        parsedChapters: chapters,
        isParsing: false,
      }));

      toast({
        title: "Archivo procesado",
        description: `Se detectaron ${chapters.length} capítulo(s)`,
      });
    } catch (error) {
      setUploadState(prev => ({ ...prev, isParsing: false, file: null }));
      toast({
        title: "Error al procesar",
        description: error instanceof Error ? error.message : "Error desconocido",
        variant: "destructive",
      });
    }
  }, [toast]);

  const handleImport = useCallback(() => {
    if (!uploadState.file || uploadState.parsedChapters.length === 0) return;

    createManuscriptMutation.mutate({
      title: uploadState.title || uploadState.file.name,
      originalFileName: uploadState.file.name,
      targetLanguage: uploadState.targetLanguage,
      detectedLanguage: uploadState.targetLanguage,
      chapters: uploadState.parsedChapters,
    });
  }, [uploadState, createManuscriptMutation]);

  if (selectedManuscriptId) {
    return (
      <div className="container mx-auto p-6">
        <ManuscriptDetail 
          manuscriptId={selectedManuscriptId} 
          onBack={() => setSelectedManuscriptId(null)} 
        />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Importar Manuscrito</h1>
        <p className="text-muted-foreground">
          Sube un manuscrito en Word para edición profesional por capítulos
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5" />
              Subir Manuscrito
            </CardTitle>
            <CardDescription>
              Soporta archivos .docx en inglés, francés, alemán, italiano, portugués y catalán
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="file">Archivo Word</Label>
              <Input
                id="file"
                type="file"
                accept=".docx,.doc"
                onChange={handleFileChange}
                disabled={uploadState.isParsing}
                data-testid="input-file-upload"
              />
            </div>

            {uploadState.file && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="title">Título</Label>
                  <Input
                    id="title"
                    value={uploadState.title}
                    onChange={(e) => setUploadState(prev => ({ ...prev, title: e.target.value }))}
                    placeholder="Título del manuscrito"
                    data-testid="input-manuscript-title"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="language">Idioma de edición</Label>
                  <Select
                    value={uploadState.targetLanguage}
                    onValueChange={(value) => setUploadState(prev => ({ ...prev, targetLanguage: value }))}
                  >
                    <SelectTrigger data-testid="select-target-language">
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

                {uploadState.isParsing && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Analizando documento...</span>
                  </div>
                )}

                {uploadState.parsedChapters.length > 0 && (
                  <div className="space-y-2">
                    <Label>Capítulos detectados: {uploadState.parsedChapters.length}</Label>
                    <ScrollArea className="h-32 border rounded-md p-2">
                      <ul className="space-y-1 text-sm">
                        {uploadState.parsedChapters.map((ch, i) => (
                          <li key={i} className="flex items-center gap-2">
                            <Badge variant="outline">{getChapterBadge(ch.chapterNumber)}</Badge>
                            <span className="truncate">{getChapterDisplayName(ch.chapterNumber, ch.title)}</span>
                            <span className="text-muted-foreground ml-auto text-xs">
                              {ch.content.split(/\s+/).length} palabras
                            </span>
                          </li>
                        ))}
                      </ul>
                    </ScrollArea>
                  </div>
                )}

                <Button 
                  onClick={handleImport}
                  disabled={uploadState.parsedChapters.length === 0 || createManuscriptMutation.isPending}
                  className="w-full"
                  data-testid="button-import-manuscript"
                >
                  {createManuscriptMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Importar Manuscrito
                </Button>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Manuscritos Importados
            </CardTitle>
            <CardDescription>
              {manuscripts.length} manuscrito(s) en el sistema
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center h-32">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : manuscripts.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <FileText className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>No hay manuscritos importados</p>
              </div>
            ) : (
              <ScrollArea className="h-[400px]">
                <div className="space-y-3 pr-4">
                  {manuscripts.map((m) => (
                    <ManuscriptCard
                      key={m.id}
                      manuscript={m}
                      onSelect={() => setSelectedManuscriptId(m.id)}
                      onDelete={() => deleteManuscriptMutation.mutate(m.id)}
                    />
                  ))}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
