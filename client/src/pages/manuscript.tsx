import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChapterList } from "@/components/chapter-list";
import { ChapterViewer } from "@/components/chapter-viewer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Download, BookOpen } from "lucide-react";
import { useProject } from "@/lib/project-context";
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
  const { currentProject, isLoading: projectsLoading } = useProject();

  const { data: chapters = [], isLoading: chaptersLoading } = useQuery<Chapter[]>({
    queryKey: ["/api/projects", currentProject?.id, "chapters"],
    enabled: !!currentProject?.id,
  });

  const handleDownload = () => {
    if (!currentProject || chapters.length === 0) return;

    const cleanContent = (rawContent: string): string => {
      let content = rawContent.trim();
      const continuityMarker = "---CONTINUITY_STATE---";
      const markerIndex = content.indexOf(continuityMarker);
      if (markerIndex !== -1) {
        content = content.substring(0, markerIndex).trim();
      }
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

  const completedChapters = chapters.filter(c => c.status === "completed");
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
        </div>
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-6 min-h-0">
        <Card className="lg:col-span-1">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Capítulos</CardTitle>
          </CardHeader>
          <CardContent>
            <ChapterList 
              chapters={sortChaptersForDisplay(chapters)}
              selectedChapterId={selectedChapter?.id}
              onSelectChapter={setSelectedChapter}
            />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2 flex flex-col">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Vista Previa</CardTitle>
          </CardHeader>
          <CardContent className="flex-1 min-h-0">
            <ChapterViewer chapter={selectedChapter} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
