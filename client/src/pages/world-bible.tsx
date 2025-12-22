import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WorldBibleDisplay } from "@/components/world-bible-display";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Globe, BookOpen } from "lucide-react";
import type { Project, WorldBible } from "@shared/schema";

export default function WorldBiblePage() {
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);

  const { data: projects = [], isLoading: projectsLoading } = useQuery<Project[]>({
    queryKey: ["/api/projects"],
  });

  useEffect(() => {
    if (projects.length > 0 && selectedProjectId === null) {
      setSelectedProjectId(projects[projects.length - 1].id);
    }
  }, [projects, selectedProjectId]);

  const selectedProject = projects.find(p => p.id === selectedProjectId);

  const { data: worldBible, isLoading: worldBibleLoading } = useQuery<WorldBible>({
    queryKey: ["/api/projects", selectedProjectId, "world-bible"],
    enabled: !!selectedProjectId,
  });

  if (projectsLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <Globe className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4 animate-pulse" />
          <p className="text-muted-foreground">Cargando proyectos...</p>
        </div>
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-6">
        <Globe className="h-16 w-16 text-muted-foreground/20 mb-4" />
        <h2 className="text-xl font-semibold mb-2">Sin biblia del mundo</h2>
        <p className="text-muted-foreground max-w-md">
          Crea un nuevo proyecto desde el panel de control para generar la biblia del mundo
        </p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6" data-testid="world-bible-page">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Biblia del Mundo</h1>
          <p className="text-muted-foreground mt-1">
            Documento de referencia narrativa
          </p>
        </div>
        
        <div className="flex items-center gap-3">
          <BookOpen className="h-5 w-5 text-muted-foreground" />
          <Select
            value={selectedProjectId?.toString() || ""}
            onValueChange={(value) => setSelectedProjectId(parseInt(value))}
          >
            <SelectTrigger className="w-[280px]" data-testid="select-project-world-bible">
              <SelectValue placeholder="Seleccionar libro" />
            </SelectTrigger>
            <SelectContent>
              {projects.map((project) => (
                <SelectItem 
                  key={project.id} 
                  value={project.id.toString()}
                  data-testid={`select-project-${project.id}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{project.title}</span>
                    <Badge variant="outline" className="text-xs">{project.genre}</Badge>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {selectedProject && (
        <div className="flex items-center gap-3">
          <Badge variant="secondary">{selectedProject.genre}</Badge>
          <Badge variant="outline">{selectedProject.tone}</Badge>
          <Badge variant="outline">{selectedProject.chapterCount} capítulos</Badge>
        </div>
      )}

      {worldBibleLoading ? (
        <div className="flex items-center justify-center py-12">
          <Globe className="h-8 w-8 text-muted-foreground/30 animate-pulse" />
        </div>
      ) : (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <Globe className="h-5 w-5" />
              Universo Narrativo
            </CardTitle>
          </CardHeader>
          <CardContent>
            <WorldBibleDisplay worldBible={worldBible || null} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
