import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FileText, CheckCircle, Loader2, Clock, RotateCcw, AlertTriangle } from "lucide-react";
import type { Chapter } from "@shared/schema";

interface ChapterListProps {
  chapters: Chapter[];
  selectedChapterId?: number;
  onSelectChapter: (chapter: Chapter) => void;
  onResetChapter?: (chapter: Chapter) => void;
  resettingChapterId?: number;
}

const statusConfig = {
  pending: { icon: Clock, color: "bg-muted text-muted-foreground", label: "Pendiente" },
  writing: { icon: Loader2, color: "bg-chart-2/20 text-chart-2", label: "Escribiendo" },
  editing: { icon: Loader2, color: "bg-chart-3/20 text-chart-3", label: "Editando" },
  completed: { icon: CheckCircle, color: "bg-green-500/20 text-green-600 dark:text-green-400", label: "Completado" },
};

export function ChapterList({ chapters, selectedChapterId, onSelectChapter, onResetChapter, resettingChapterId }: ChapterListProps) {
  if (chapters.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <FileText className="h-12 w-12 text-muted-foreground/30 mb-4" />
        <p className="text-muted-foreground text-sm">
          No hay capítulos todavía
        </p>
        <p className="text-muted-foreground/60 text-xs mt-1">
          Inicia un proyecto para generar capítulos
        </p>
      </div>
    );
  }

  const isChapterEmpty = (chapter: Chapter) => {
    const content = chapter.content || "";
    return content.trim().length < 100;
  };

  return (
    <ScrollArea className="h-[400px]">
      <div className="space-y-2 pr-4">
        {chapters.map((chapter) => {
          const config = statusConfig[chapter.status as keyof typeof statusConfig] || statusConfig.pending;
          const StatusIcon = config.icon;
          const isSelected = selectedChapterId === chapter.id;
          const isLoading = chapter.status === "writing" || chapter.status === "editing";
          const isEmpty = isChapterEmpty(chapter);
          const isResetting = resettingChapterId === chapter.id;

          return (
            <div
              key={chapter.id}
              className={`
                w-full text-left p-3 rounded-md transition-all duration-200
                ${isSelected 
                  ? "bg-sidebar-accent" 
                  : "bg-card"
                }
                ${isEmpty ? "border-2 border-destructive/50" : ""}
              `}
            >
              <button
                onClick={() => onSelectChapter(chapter)}
                className="w-full text-left hover-elevate active-elevate-2 rounded"
                data-testid={`button-chapter-${chapter.id}`}
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="font-medium text-sm">
                    {chapter.chapterNumber === 0 ? "Prólogo" 
                      : chapter.chapterNumber === -1 ? "Epílogo" 
                      : chapter.chapterNumber === -2 ? "Nota del Autor"
                      : `Capítulo ${chapter.chapterNumber}`}
                  </span>
                  <div className="flex items-center gap-1">
                    {isEmpty && (
                      <Badge className="bg-destructive/20 text-destructive text-xs">
                        <AlertTriangle className="h-3 w-3 mr-1" />
                        Vacío
                      </Badge>
                    )}
                    <Badge className={`${config.color} text-xs`}>
                      <StatusIcon className={`h-3 w-3 mr-1 ${isLoading ? "animate-spin" : ""}`} />
                      {config.label}
                    </Badge>
                  </div>
                </div>
                {chapter.title && (
                  <p className="text-sm text-muted-foreground line-clamp-1">
                    {chapter.title}
                  </p>
                )}
                {chapter.wordCount && chapter.wordCount > 0 && (
                  <p className="text-xs text-muted-foreground/70 mt-1">
                    {chapter.wordCount.toLocaleString()} palabras
                  </p>
                )}
              </button>
              
              {isEmpty && onResetChapter && (
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full mt-2"
                  onClick={(e) => {
                    e.stopPropagation();
                    onResetChapter(chapter);
                  }}
                  disabled={isResetting}
                  data-testid={`button-reset-chapter-${chapter.id}`}
                >
                  {isResetting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Marcando pendiente...
                    </>
                  ) : (
                    <>
                      <RotateCcw className="h-4 w-4 mr-2" />
                      Marcar como pendiente
                    </>
                  )}
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
}
