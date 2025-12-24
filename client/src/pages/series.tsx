import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Library, Plus, Trash2, User, BookOpen, Check, FileText, Loader2 } from "lucide-react";
import type { Pseudonym, Project, Series } from "@shared/schema";

interface SeriesWithDetails extends Series {
  pseudonym: Pseudonym | null;
  projects: Project[];
  completedVolumes: number;
}

export default function SeriesPage() {
  const { toast } = useToast();
  const [isCreating, setIsCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newWorkType, setNewWorkType] = useState<"trilogy" | "series">("trilogy");
  const [newTotalBooks, setNewTotalBooks] = useState(3);
  const [deleteSeriesId, setDeleteSeriesId] = useState<number | null>(null);
  const [editingPseudonymId, setEditingPseudonymId] = useState<number | null>(null);

  const { data: registry = [], isLoading } = useQuery<SeriesWithDetails[]>({
    queryKey: ["/api/series/registry"],
  });

  const { data: pseudonyms = [] } = useQuery<Pseudonym[]>({
    queryKey: ["/api/pseudonyms"],
  });

  const createSeriesMutation = useMutation({
    mutationFn: async (data: { title: string; workType: string; totalPlannedBooks: number }) => {
      const response = await apiRequest("POST", "/api/series", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/series/registry"] });
      queryClient.invalidateQueries({ queryKey: ["/api/series"] });
      setIsCreating(false);
      setNewTitle("");
      setNewWorkType("trilogy");
      setNewTotalBooks(3);
      toast({ title: "Serie creada", description: "La nueva serie ha sido añadida" });
    },
    onError: () => {
      toast({ title: "Error", description: "No se pudo crear la serie", variant: "destructive" });
    },
  });

  const updateSeriesMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<Series> }) => {
      const response = await apiRequest("PATCH", `/api/series/${id}`, data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/series/registry"] });
      queryClient.invalidateQueries({ queryKey: ["/api/series"] });
      setEditingPseudonymId(null);
      toast({ title: "Serie actualizada" });
    },
    onError: () => {
      toast({ title: "Error", description: "No se pudo actualizar la serie", variant: "destructive" });
    },
  });

  const deleteSeriesMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/series/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/series/registry"] });
      queryClient.invalidateQueries({ queryKey: ["/api/series"] });
      toast({ title: "Serie eliminada" });
    },
    onError: () => {
      toast({ title: "Error", description: "No se pudo eliminar la serie", variant: "destructive" });
    },
  });

  const handleCreateSeries = () => {
    if (!newTitle.trim()) return;
    createSeriesMutation.mutate({
      title: newTitle,
      workType: newWorkType,
      totalPlannedBooks: newTotalBooks,
    });
  };

  const handlePseudonymChange = (seriesId: number, pseudonymId: string) => {
    updateSeriesMutation.mutate({
      id: seriesId,
      data: { pseudonymId: pseudonymId === "none" ? null : parseInt(pseudonymId) },
    });
  };

  const statusLabels: Record<string, string> = {
    idle: "Pendiente",
    generating: "En curso",
    completed: "Completado",
  };

  const statusColors: Record<string, string> = {
    idle: "bg-muted text-muted-foreground",
    generating: "bg-chart-2/20 text-chart-2",
    completed: "bg-green-500/20 text-green-600 dark:text-green-400",
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6" data-testid="series-page">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold">Registro de Series</h1>
          <p className="text-muted-foreground mt-1">
            Gestiona tus series y trilogías con sus volúmenes asignados
          </p>
        </div>
        <Button onClick={() => setIsCreating(true)} data-testid="button-create-series">
          <Plus className="h-4 w-4 mr-2" />
          Nueva Serie
        </Button>
      </div>

      {isCreating && (
        <Card>
          <CardHeader>
            <CardTitle>Crear Nueva Serie</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Título de la Serie</Label>
                <Input
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="Nombre de la saga..."
                  data-testid="input-series-title"
                />
              </div>
              <div className="space-y-2">
                <Label>Tipo</Label>
                <Select value={newWorkType} onValueChange={(v) => setNewWorkType(v as "trilogy" | "series")}>
                  <SelectTrigger data-testid="select-work-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="trilogy">Trilogía</SelectItem>
                    <SelectItem value="series">Serie</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Libros Planificados</Label>
                <Input
                  type="number"
                  min={2}
                  max={20}
                  value={newTotalBooks}
                  onChange={(e) => setNewTotalBooks(parseInt(e.target.value) || 3)}
                  data-testid="input-total-books"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button onClick={handleCreateSeries} disabled={createSeriesMutation.isPending}>
                {createSeriesMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Check className="h-4 w-4 mr-2" />}
                Crear
              </Button>
              <Button variant="outline" onClick={() => setIsCreating(false)}>
                Cancelar
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {registry.length === 0 && !isCreating ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Library className="h-16 w-16 text-muted-foreground/30 mb-4" />
            <p className="text-muted-foreground text-lg mb-2">No hay series registradas</p>
            <p className="text-muted-foreground/60 text-sm">
              Crea una serie o trilogía para organizar tus volúmenes
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {registry.map((s) => (
            <Card key={s.id} data-testid={`card-series-${s.id}`}>
              <CardHeader>
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <CardTitle className="text-xl">{s.title}</CardTitle>
                      <Badge variant="outline">
                        {s.workType === "trilogy" ? "Trilogía" : "Serie"}
                      </Badge>
                      <Badge variant="secondary">
                        {s.completedVolumes}/{s.totalPlannedBooks} volúmenes
                      </Badge>
                      {s.seriesGuide && (
                        <Badge variant="outline" className="text-green-600 dark:text-green-400">
                          <FileText className="h-3 w-3 mr-1" />
                          Guía cargada
                        </Badge>
                      )}
                    </div>
                    <CardDescription>
                      {s.description || "Sin descripción"}
                    </CardDescription>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setDeleteSeriesId(s.id)}
                    data-testid={`button-delete-series-${s.id}`}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-4 flex-wrap">
                  <div className="flex items-center gap-2">
                    <User className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">Seudónimo:</span>
                  </div>
                  <Select
                    value={s.pseudonymId?.toString() || "none"}
                    onValueChange={(v) => handlePseudonymChange(s.id, v)}
                  >
                    <SelectTrigger className="w-48" data-testid={`select-pseudonym-${s.id}`}>
                      <SelectValue placeholder="Sin asignar" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Sin asignar</SelectItem>
                      {pseudonyms.map((p) => (
                        <SelectItem key={p.id} value={p.id.toString()}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {s.pseudonym && (
                    <Badge variant="secondary">
                      <User className="h-3 w-3 mr-1" />
                      {s.pseudonym.name}
                    </Badge>
                  )}
                </div>

                <Separator />

                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <BookOpen className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">Volúmenes</span>
                  </div>
                  
                  {s.projects.length === 0 ? (
                    <div className="text-sm text-muted-foreground/60 py-4 text-center bg-muted/30 rounded-md">
                      No hay proyectos asignados a esta serie todavía.
                      <br />
                      Crea un proyecto y selecciona esta serie en la configuración.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {s.projects.map((project) => (
                        <div
                          key={project.id}
                          className="flex items-center justify-between gap-4 p-3 rounded-md bg-muted/50"
                          data-testid={`project-item-${project.id}`}
                        >
                          <div className="flex items-center gap-3 flex-1 min-w-0">
                            <Badge variant="outline" className="shrink-0">
                              Vol. {project.seriesOrder || "?"}
                            </Badge>
                            <span className="font-medium truncate">{project.title}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge className={statusColors[project.status] || ""}>
                              {statusLabels[project.status] || project.status}
                            </Badge>
                            {project.finalScore && (
                              <Badge variant="secondary">
                                {project.finalScore}/10
                              </Badge>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={deleteSeriesId !== null}
        onOpenChange={(open) => !open && setDeleteSeriesId(null)}
        title="Eliminar Serie"
        description="Esta acción eliminará la serie pero mantendrá los proyectos asociados como obras independientes."
        confirmText="Eliminar"
        onConfirm={() => {
          if (deleteSeriesId) {
            deleteSeriesMutation.mutate(deleteSeriesId);
            setDeleteSeriesId(null);
          }
        }}
      />
    </div>
  );
}
