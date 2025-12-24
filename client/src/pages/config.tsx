import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ConfigPanel, type ConfigFormData } from "@/components/config-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Settings, Trash2, BookOpen, Clock, Pencil, FileText, Upload, Library } from "lucide-react";
import { Link } from "wouter";
import type { Project, ExtendedGuide, Series } from "@shared/schema";

export default function ConfigPage() {
  const { toast } = useToast();
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [deleteProjectId, setDeleteProjectId] = useState<number | null>(null);
  const [deleteGuideId, setDeleteGuideId] = useState<number | null>(null);
  const [uploadingSeriesId, setUploadingSeriesId] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const seriesGuideInputRef = useRef<HTMLInputElement>(null);

  const { data: projects = [], isLoading } = useQuery<Project[]>({
    queryKey: ["/api/projects"],
  });

  const { data: extendedGuides = [], isLoading: isLoadingGuides } = useQuery<ExtendedGuide[]>({
    queryKey: ["/api/extended-guides"],
  });

  const { data: allSeries = [], isLoading: isLoadingSeries } = useQuery<Series[]>({
    queryKey: ["/api/series"],
  });

  const createProjectMutation = useMutation({
    mutationFn: async (data: ConfigFormData) => {
      const response = await apiRequest("POST", "/api/projects", data);
      return response.json();
    },
    onSuccess: (project) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      toast({
        title: "Proyecto creado",
        description: `"${project.title}" ha sido configurado. Puedes iniciar la generación desde el panel principal.`,
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "No se pudo crear el proyecto",
        variant: "destructive",
      });
    },
  });

  const deleteProjectMutation = useMutation({
    mutationFn: async (projectId: number) => {
      await apiRequest("DELETE", `/api/projects/${projectId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      toast({
        title: "Proyecto eliminado",
        description: "El proyecto ha sido eliminado correctamente",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "No se pudo eliminar el proyecto",
        variant: "destructive",
      });
    },
  });

  const updateProjectMutation = useMutation({
    mutationFn: async ({ id, title }: { id: number; title: string }) => {
      const response = await apiRequest("PATCH", `/api/projects/${id}`, { title });
      return response.json();
    },
    onSuccess: (project) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      setEditingProject(null);
      toast({
        title: "Proyecto actualizado",
        description: `El nombre se ha cambiado a "${project.title}"`,
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "No se pudo actualizar el proyecto",
        variant: "destructive",
      });
    },
  });

  const deleteGuideMutation = useMutation({
    mutationFn: async (guideId: number) => {
      await apiRequest("DELETE", `/api/extended-guides/${guideId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/extended-guides"] });
      toast({
        title: "Guía eliminada",
        description: "La guía de escritura ha sido eliminada correctamente",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "No se pudo eliminar la guía",
        variant: "destructive",
      });
    },
  });

  const uploadGuideMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/extended-guides/upload", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error("Upload failed");
      }
      return response.json();
    },
    onSuccess: (guide: ExtendedGuide) => {
      queryClient.invalidateQueries({ queryKey: ["/api/extended-guides"] });
      toast({
        title: "Guía subida",
        description: `"${guide.title}" se ha añadido correctamente (${(guide.wordCount || 0).toLocaleString()} palabras)`,
      });
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    },
    onError: () => {
      toast({
        title: "Error",
        description: "No se pudo subir el archivo",
        variant: "destructive",
      });
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    },
  });

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.docx')) {
      toast({
        title: "Formato no soportado",
        description: "Por favor sube un archivo .docx (Word)",
        variant: "destructive",
      });
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      return;
    }

    uploadGuideMutation.mutate(file);
  };

  const uploadSeriesGuideMutation = useMutation({
    mutationFn: async ({ seriesId, file }: { seriesId: number; file: File }) => {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch(`/api/series/${seriesId}/guide`, {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error("Upload failed");
      }
      return response.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/series"] });
      toast({
        title: "Guía de serie cargada",
        description: `Se han cargado ${result.wordCount?.toLocaleString() || 0} palabras de la guía`,
      });
      setUploadingSeriesId(null);
      if (seriesGuideInputRef.current) {
        seriesGuideInputRef.current.value = "";
      }
    },
    onError: () => {
      toast({
        title: "Error",
        description: "No se pudo subir la guía de serie",
        variant: "destructive",
      });
      if (seriesGuideInputRef.current) {
        seriesGuideInputRef.current.value = "";
      }
    },
  });

  const deleteSeriesGuideMutation = useMutation({
    mutationFn: async (seriesId: number) => {
      await apiRequest("DELETE", `/api/series/${seriesId}/guide`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/series"] });
      toast({
        title: "Guía eliminada",
        description: "La guía de serie ha sido eliminada",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "No se pudo eliminar la guía",
        variant: "destructive",
      });
    },
  });

  const handleSeriesGuideUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !uploadingSeriesId) return;

    if (!file.name.endsWith('.docx')) {
      toast({
        title: "Formato no soportado",
        description: "Por favor sube un archivo .docx (Word)",
        variant: "destructive",
      });
      if (seriesGuideInputRef.current) {
        seriesGuideInputRef.current.value = "";
      }
      return;
    }

    uploadSeriesGuideMutation.mutate({ seriesId: uploadingSeriesId, file });
  };

  const handleSubmit = (data: ConfigFormData) => {
    createProjectMutation.mutate(data);
  };

  const handleDelete = (projectId: number) => {
    setDeleteProjectId(projectId);
  };

  const statusLabels: Record<string, string> = {
    idle: "En espera",
    generating: "Generando",
    completed: "Completado",
  };

  const statusColors: Record<string, string> = {
    idle: "bg-muted text-muted-foreground",
    generating: "bg-chart-2/20 text-chart-2",
    completed: "bg-green-500/20 text-green-600 dark:text-green-400",
  };

  return (
    <div className="p-6 space-y-6" data-testid="config-page">
      <div>
        <h1 className="text-3xl font-bold">Configuración</h1>
        <p className="text-muted-foreground mt-1">
          Gestiona tus proyectos y configuraciones de generación
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              Nuevo Proyecto
            </CardTitle>
            <CardDescription>
              Configura los parámetros para un nuevo manuscrito
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ConfigPanel 
              onSubmit={handleSubmit}
              isLoading={createProjectMutation.isPending}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BookOpen className="h-5 w-5" />
              Proyectos Existentes
            </CardTitle>
            <CardDescription>
              {projects.length} proyecto{projects.length !== 1 ? "s" : ""} creado{projects.length !== 1 ? "s" : ""}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Clock className="h-8 w-8 text-muted-foreground/30 animate-pulse" />
              </div>
            ) : projects.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <BookOpen className="h-12 w-12 text-muted-foreground/30 mb-4" />
                <p className="text-muted-foreground text-sm">
                  No hay proyectos todavía
                </p>
                <p className="text-muted-foreground/60 text-xs mt-1">
                  Crea tu primer proyecto usando el formulario
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {projects.map((project) => (
                  <div 
                    key={project.id}
                    className="flex items-center justify-between gap-4 p-3 rounded-md bg-muted/50"
                    data-testid={`project-item-${project.id}`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-medium text-sm truncate">{project.title}</h3>
                        <Badge className={`text-xs ${statusColors[project.status] || statusColors.idle}`}>
                          {statusLabels[project.status] || project.status}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">{project.genre}</Badge>
                        <Badge variant="outline" className="text-xs">{project.tone}</Badge>
                        <span className="text-xs text-muted-foreground">
                          {project.chapterCount} capítulos
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Button 
                        variant="ghost" 
                        size="icon"
                        onClick={() => {
                          setEditingProject(project);
                          setEditTitle(project.title);
                        }}
                        data-testid={`button-edit-${project.id}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Link href="/manuscript">
                        <Button variant="ghost" size="sm" data-testid={`button-view-${project.id}`}>
                          Ver
                        </Button>
                      </Link>
                      <Button 
                        variant="ghost" 
                        size="icon"
                        onClick={() => handleDelete(project.id)}
                        disabled={deleteProjectMutation.isPending}
                        data-testid={`button-delete-${project.id}`}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Guías de Escritura Extendidas
            </CardTitle>
            <CardDescription>
              Sube documentos Word con instrucciones detalladas para la generación de novelas
            </CardDescription>
          </div>
          <div>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileUpload}
              accept=".docx"
              className="hidden"
              data-testid="input-guide-upload"
            />
            <Button
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadGuideMutation.isPending}
              data-testid="button-upload-guide"
            >
              <Upload className="h-4 w-4 mr-2" />
              {uploadGuideMutation.isPending ? "Subiendo..." : "Subir Guía"}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoadingGuides ? (
            <div className="flex items-center justify-center py-8">
              <Clock className="h-8 w-8 text-muted-foreground/30 animate-pulse" />
            </div>
          ) : extendedGuides.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <FileText className="h-12 w-12 text-muted-foreground/30 mb-4" />
              <p className="text-muted-foreground text-sm">
                No hay guías de escritura todavía
              </p>
              <p className="text-muted-foreground/60 text-xs mt-1">
                Sube un documento Word (.docx) con instrucciones detalladas
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {extendedGuides.map((guide) => (
                <div 
                  key={guide.id}
                  className="flex items-center justify-between gap-4 p-3 rounded-md bg-muted/50"
                  data-testid={`guide-item-${guide.id}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-medium text-sm truncate">{guide.title}</h3>
                      <Badge variant="outline" className="text-xs">
                        {(guide.wordCount || 0).toLocaleString()} palabras
                      </Badge>
                    </div>
                    {guide.description && (
                      <p className="text-xs text-muted-foreground truncate">{guide.description}</p>
                    )}
                    <p className="text-xs text-muted-foreground/60 mt-1">
                      {guide.originalFileName}
                    </p>
                  </div>
                  <Button 
                    variant="ghost" 
                    size="icon"
                    onClick={() => setDeleteGuideId(guide.id)}
                    disabled={deleteGuideMutation.isPending}
                    data-testid={`button-delete-guide-${guide.id}`}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Library className="h-5 w-5" />
            Guías de Series
          </CardTitle>
          <CardDescription>
            Sube documentos Word con la trama general de cada serie. Los nuevos volúmenes usarán esta guía + los volúmenes anteriores como referencia.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <input
            type="file"
            ref={seriesGuideInputRef}
            onChange={handleSeriesGuideUpload}
            accept=".docx"
            className="hidden"
            data-testid="input-series-guide-upload"
          />
          {isLoadingSeries ? (
            <div className="flex items-center justify-center py-8">
              <Clock className="h-8 w-8 text-muted-foreground/30 animate-pulse" />
            </div>
          ) : allSeries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Library className="h-12 w-12 text-muted-foreground/30 mb-4" />
              <p className="text-muted-foreground text-sm">
                No hay series creadas todavía
              </p>
              <p className="text-muted-foreground/60 text-xs mt-1">
                Crea una serie al configurar un proyecto como "Serie" o "Trilogía"
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {allSeries.map((s) => (
                <div 
                  key={s.id}
                  className="flex items-center justify-between gap-4 p-3 rounded-md bg-muted/50"
                  data-testid={`series-item-${s.id}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <h3 className="font-medium text-sm truncate">{s.title}</h3>
                      <Badge variant="outline" className="text-xs">
                        {s.workType === "trilogy" ? "Trilogía" : "Serie"}
                      </Badge>
                      {s.seriesGuide ? (
                        <Badge variant="secondary" className="text-xs">
                          Guía cargada
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs text-muted-foreground">
                          Sin guía
                        </Badge>
                      )}
                    </div>
                    {s.seriesGuideFileName && (
                      <p className="text-xs text-muted-foreground/60 mt-1">
                        {s.seriesGuideFileName}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setUploadingSeriesId(s.id);
                        seriesGuideInputRef.current?.click();
                      }}
                      disabled={uploadSeriesGuideMutation.isPending}
                      data-testid={`button-upload-series-guide-${s.id}`}
                    >
                      <Upload className="h-4 w-4 mr-1" />
                      {s.seriesGuide ? "Reemplazar" : "Subir"} Guía
                    </Button>
                    {s.seriesGuide && (
                      <Button 
                        variant="ghost" 
                        size="icon"
                        onClick={() => deleteSeriesGuideMutation.mutate(s.id)}
                        disabled={deleteSeriesGuideMutation.isPending}
                        data-testid={`button-delete-series-guide-${s.id}`}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Acerca del Sistema</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-4 rounded-md bg-muted/50">
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">
                Modelo de IA
              </p>
              <p className="font-medium">Gemini 3 Pro Preview</p>
            </div>
            <div className="p-4 rounded-md bg-muted/50">
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">
                Nivel de Razonamiento
              </p>
              <p className="font-medium">High (Deep Thinking)</p>
            </div>
            <div className="p-4 rounded-md bg-muted/50">
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">
                Temperatura
              </p>
              <p className="font-medium">1.0</p>
            </div>
            <div className="p-4 rounded-md bg-muted/50">
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">
                Top P
              </p>
              <p className="font-medium">0.95</p>
            </div>
          </div>
          <Separator />
          <p className="text-sm text-muted-foreground">
            Este sistema utiliza cuatro agentes literarios autónomos (Arquitecto, Narrador, Editor, Estilista) 
            que colaboran para crear manuscritos completos. Cada agente utiliza el motor de razonamiento 
            avanzado de Gemini 3 Pro para planificar y ejecutar sus tareas con máxima coherencia narrativa.
          </p>
        </CardContent>
      </Card>

      <Dialog open={!!editingProject} onOpenChange={(open) => !open && setEditingProject(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar nombre del proyecto</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Input
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              placeholder="Nombre del proyecto"
              data-testid="input-edit-title"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingProject(null)}>
              Cancelar
            </Button>
            <Button 
              onClick={() => {
                if (editingProject && editTitle.trim()) {
                  updateProjectMutation.mutate({ id: editingProject.id, title: editTitle.trim() });
                }
              }}
              disabled={updateProjectMutation.isPending || !editTitle.trim()}
              data-testid="button-save-title"
            >
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteProjectId !== null}
        onOpenChange={(open) => !open && setDeleteProjectId(null)}
        title="Eliminar proyecto"
        description="¿Estás seguro de que quieres eliminar este proyecto? Esta acción no se puede deshacer."
        confirmText="Eliminar"
        variant="destructive"
        onConfirm={() => {
          if (deleteProjectId) {
            deleteProjectMutation.mutate(deleteProjectId);
          }
          setDeleteProjectId(null);
        }}
      />

      <ConfirmDialog
        open={deleteGuideId !== null}
        onOpenChange={(open) => !open && setDeleteGuideId(null)}
        title="Eliminar guía"
        description="¿Estás seguro de que quieres eliminar esta guía de escritura? Los proyectos que la usen perderán la referencia."
        confirmText="Eliminar"
        variant="destructive"
        onConfirm={() => {
          if (deleteGuideId) {
            deleteGuideMutation.mutate(deleteGuideId);
          }
          setDeleteGuideId(null);
        }}
      />
    </div>
  );
}
