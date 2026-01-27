import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WorldBibleDisplay } from "@/components/world-bible-display";
import { Badge } from "@/components/ui/badge";
import { Globe } from "lucide-react";
import { useProject } from "@/lib/project-context";
import type { WorldBible } from "@shared/schema";

export default function WorldBiblePage() {
  const { currentProject, isLoading: projectsLoading } = useProject();

  const isGenerating = currentProject?.status === "generating" || currentProject?.status === "pending" || currentProject?.status === "planning";
  
  const { data: worldBible, isLoading: worldBibleLoading, error } = useQuery<WorldBible>({
    queryKey: ["/api/projects", currentProject?.id, "world-bible"],
    enabled: !!currentProject?.id,
    staleTime: isGenerating ? 0 : 60000,
    refetchInterval: isGenerating ? 5000 : false,
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

  if (!currentProject) {
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

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-6">
        <Globe className="h-16 w-16 text-muted-foreground/20 mb-4" />
        <h2 className="text-xl font-semibold mb-2">Error al cargar</h2>
        <p className="text-muted-foreground max-w-md">
          No se pudo cargar la biblia del mundo. Intenta recargar la página.
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
      </div>

      <div className="flex items-center gap-3">
        <Badge variant="secondary">{currentProject.genre}</Badge>
        <Badge variant="outline">{currentProject.tone}</Badge>
        <Badge variant="outline">{currentProject.chapterCount} capítulos</Badge>
      </div>

      {worldBibleLoading ? (
        <div className="flex items-center justify-center py-12">
          <Globe className="h-8 w-8 text-muted-foreground/30 animate-pulse" />
        </div>
      ) : (() => {
        const hasData = worldBible && (
          (worldBible.timeline && (worldBible.timeline as any[]).length > 0) ||
          (worldBible.characters && (worldBible.characters as any[]).length > 0) ||
          (worldBible.plotOutline && Object.keys(worldBible.plotOutline as object).length > 0)
        );
        
        if (isGenerating && !hasData) {
          return (
            <Card>
              <CardContent className="py-12">
                <div className="flex flex-col items-center justify-center text-center">
                  <Globe className="h-12 w-12 text-muted-foreground/30 mb-4 animate-pulse" />
                  <h3 className="text-lg font-medium mb-2">Generando biblia del mundo...</h3>
                  <p className="text-muted-foreground text-sm max-w-md">
                    El agente arquitecto está creando el universo narrativo. 
                    Esto puede tardar unos minutos.
                  </p>
                </div>
              </CardContent>
            </Card>
          );
        }
        
        return (
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
        );
      })()}
    </div>
  );
}
