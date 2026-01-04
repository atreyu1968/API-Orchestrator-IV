import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Copy, Trash2, Check, AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

interface DuplicateGeneration {
  generationKey: string;
  chapterIds: number[];
  titles: string[];
  statuses: string[];
  wordCounts: number[];
  createdAt: string;
  totalChapters: number;
  hasContent: boolean;
}

interface DuplicateGroup {
  chapterNumber: number;
  generations: DuplicateGeneration[];
}

interface ProjectDuplicates {
  projectId: number;
  projectTitle: string;
  projectStatus: string;
  duplicateGroups: DuplicateGroup[];
}

export function DuplicateManager() {
  const { toast } = useToast();
  const [expandedProjects, setExpandedProjects] = useState<Set<number>>(new Set());
  const [confirmPurge, setConfirmPurge] = useState<{
    projectId: number;
    chapterNumber: number;
    generationKey: string;
    keepGeneration: boolean;
  } | null>(null);

  const { data: duplicates, isLoading, refetch } = useQuery<ProjectDuplicates[]>({
    queryKey: ["/api/projects/duplicate-chapters"],
  });

  const purgeMutation = useMutation({
    mutationFn: async (params: {
      projectId: number;
      chapterNumber: number;
      generationKey: string;
      keepGeneration: boolean;
    }) => {
      return apiRequest("POST", `/api/projects/${params.projectId}/duplicate-chapters/purge`, {
        chapterNumber: params.chapterNumber,
        generationKey: params.generationKey,
        keepGeneration: params.keepGeneration,
      });
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects/duplicate-chapters"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", variables.projectId, "chapters"] });
      queryClient.invalidateQueries({ queryKey: ["/api/chapters"] });
      toast({
        title: "Duplicados eliminados",
        description: "Los capítulos duplicados se han eliminado correctamente",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "No se pudieron eliminar los duplicados",
        variant: "destructive",
      });
    },
  });

  const toggleProject = (projectId: number) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString("es-ES", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Copy className="h-5 w-5" />
            Capítulos Duplicados
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Buscando duplicados...</p>
        </CardContent>
      </Card>
    );
  }

  const hasDuplicates = duplicates && duplicates.length > 0;

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Copy className="h-5 w-5" />
            Capítulos Duplicados
            {hasDuplicates && (
              <Badge variant="destructive" className="ml-2">
                {duplicates.reduce((sum, p) => sum + p.duplicateGroups.length, 0)} grupos
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!hasDuplicates ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Check className="h-4 w-4 text-green-500" />
              No hay capítulos duplicados
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-yellow-500" />
                Se detectaron capítulos duplicados en {duplicates.length} proyecto(s)
              </p>

              {duplicates.map((project) => (
                <Collapsible
                  key={project.projectId}
                  open={expandedProjects.has(project.projectId)}
                  onOpenChange={() => toggleProject(project.projectId)}
                >
                  <CollapsibleTrigger asChild>
                    <Button
                      variant="ghost"
                      className="w-full justify-between h-auto py-2"
                      data-testid={`button-expand-duplicates-${project.projectId}`}
                    >
                      <span className="text-sm font-medium truncate">
                        {project.projectTitle}
                      </span>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="text-xs">
                          {project.duplicateGroups.length} cap. afectados
                        </Badge>
                        {expandedProjects.has(project.projectId) ? (
                          <ChevronUp className="h-4 w-4" />
                        ) : (
                          <ChevronDown className="h-4 w-4" />
                        )}
                      </div>
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="mt-2 space-y-2 pl-2 border-l-2 border-muted ml-2">
                    {project.duplicateGroups.map((group) => (
                      <div key={group.chapterNumber} className="space-y-1 pb-2 border-b border-muted last:border-b-0">
                        <p className="text-sm font-medium">
                          Capítulo {group.chapterNumber}
                          <span className="text-muted-foreground font-normal ml-2">
                            ({group.generations.reduce((sum, g) => sum + g.totalChapters, 0)} versiones)
                          </span>
                        </p>
                        
                        <div className="space-y-1">
                          {group.generations.map((gen, idx) => (
                            <div
                              key={gen.generationKey}
                              className="flex items-center justify-between gap-2 text-xs bg-muted/50 rounded px-2 py-1"
                            >
                              <div className="flex-1 min-w-0">
                                <span className="text-muted-foreground">
                                  Gen {idx + 1}:
                                </span>{" "}
                                {formatDate(gen.createdAt)},{" "}
                                {gen.totalChapters} cap.,{" "}
                                {gen.wordCounts.reduce((a, b) => a + b, 0).toLocaleString()} palabras
                                {gen.hasContent && (
                                  <Badge variant="outline" className="ml-1 text-xs py-0">
                                    con contenido
                                  </Badge>
                                )}
                              </div>
                              <div className="flex gap-1 flex-shrink-0">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 px-2 text-xs"
                                  onClick={() =>
                                    setConfirmPurge({
                                      projectId: project.projectId,
                                      chapterNumber: group.chapterNumber,
                                      generationKey: gen.generationKey,
                                      keepGeneration: true,
                                    })
                                  }
                                  disabled={purgeMutation.isPending || project.projectStatus === "generating"}
                                  data-testid={`button-keep-generation-${project.projectId}-${group.chapterNumber}-${idx}`}
                                >
                                  <Check className="h-3 w-3 mr-1" />
                                  Conservar
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 px-2 text-xs text-destructive hover:text-destructive"
                                  onClick={() =>
                                    setConfirmPurge({
                                      projectId: project.projectId,
                                      chapterNumber: group.chapterNumber,
                                      generationKey: gen.generationKey,
                                      keepGeneration: false,
                                    })
                                  }
                                  disabled={purgeMutation.isPending || project.projectStatus === "generating" || group.generations.length === 1}
                                  data-testid={`button-delete-generation-${project.projectId}-${group.chapterNumber}-${idx}`}
                                >
                                  <Trash2 className="h-3 w-3 mr-1" />
                                  Eliminar
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </CollapsibleContent>
                </Collapsible>
              ))}

              <Button
                variant="outline"
                size="sm"
                onClick={() => refetch()}
                data-testid="button-refresh-duplicates"
              >
                Actualizar lista
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={!!confirmPurge}
        onOpenChange={(open) => !open && setConfirmPurge(null)}
        title={confirmPurge?.keepGeneration ? "Conservar esta generación" : "Eliminar generación"}
        description={
          confirmPurge?.keepGeneration
            ? "Se eliminarán todas las demás generaciones del capítulo, conservando solo esta."
            : "Se eliminará esta generación del capítulo. Las otras se conservarán."
        }
        confirmText={confirmPurge?.keepGeneration ? "Conservar y eliminar otras" : "Eliminar esta"}
        variant={confirmPurge?.keepGeneration ? "default" : "destructive"}
        onConfirm={() => {
          if (confirmPurge) {
            purgeMutation.mutate(confirmPurge);
          }
          setConfirmPurge(null);
        }}
      />
    </>
  );
}
