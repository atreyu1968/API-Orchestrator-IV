import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Library, Plus, Trash2, User, BookOpen, Check, FileText, Loader2, Pencil, X, Upload, Target, Sparkles, ChevronDown, Link2 } from "lucide-react";
import { ArcVerificationPanel } from "@/components/arc-verification-panel";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Pseudonym, Project, Series, ImportedManuscript } from "@shared/schema";

interface SeriesVolume {
  type: "project" | "imported";
  id: number;
  title: string;
  seriesOrder: number | null;
  status: string;
  wordCount: number;
}

interface SeriesWithDetails extends Series {
  pseudonym: Pseudonym | null;
  projects: Project[];
  importedManuscripts?: ImportedManuscript[];
  volumes?: SeriesVolume[];
  completedVolumes: number;
}

export default function SeriesPage() {
  const { toast } = useToast();
  const [isCreating, setIsCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newWorkType, setNewWorkType] = useState<"trilogy" | "series">("trilogy");
  const [newTotalBooks, setNewTotalBooks] = useState(3);
  const [deleteSeriesId, setDeleteSeriesId] = useState<number | null>(null);
  
  const [editingSeriesId, setEditingSeriesId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editWorkType, setEditWorkType] = useState<"trilogy" | "series">("trilogy");
  const [editTotalBooks, setEditTotalBooks] = useState(3);
  
  const [uploadingSeriesId, setUploadingSeriesId] = useState<number | null>(null);
  const seriesGuideInputRef = useRef<HTMLInputElement>(null);
  
  const [linkingSeriesId, setLinkingSeriesId] = useState<number | null>(null);
  const [linkManuscriptId, setLinkManuscriptId] = useState<string>("");
  const [linkSeriesOrder, setLinkSeriesOrder] = useState<number>(1);

  const { data: registry = [], isLoading } = useQuery<SeriesWithDetails[]>({
    queryKey: ["/api/series/registry"],
  });

  const { data: pseudonyms = [] } = useQuery<Pseudonym[]>({
    queryKey: ["/api/pseudonyms"],
  });
  
  const { data: allManuscripts = [] } = useQuery<ImportedManuscript[]>({
    queryKey: ["/api/imported-manuscripts"],
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
      setEditingSeriesId(null);
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

  const uploadSeriesGuideMutation = useMutation({
    mutationFn: async ({ seriesId, file }: { seriesId: number; file: File }) => {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch(`/api/series/${seriesId}/guide`, {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!response.ok) throw new Error("Upload failed");
      return response.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/series/registry"] });
      queryClient.invalidateQueries({ queryKey: ["/api/series"] });
      toast({
        title: "Guia de serie cargada",
        description: `Se han cargado ${result.wordCount?.toLocaleString() || 0} palabras de la guia`,
      });
      setUploadingSeriesId(null);
      if (seriesGuideInputRef.current) {
        seriesGuideInputRef.current.value = "";
      }
    },
    onError: () => {
      toast({
        title: "Error",
        description: "No se pudo subir la guia de serie",
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
      queryClient.invalidateQueries({ queryKey: ["/api/series/registry"] });
      queryClient.invalidateQueries({ queryKey: ["/api/series"] });
      toast({ title: "Guia eliminada" });
    },
    onError: () => {
      toast({ title: "Error", description: "No se pudo eliminar la guia", variant: "destructive" });
    },
  });

  const [extractingSeriesId, setExtractingSeriesId] = useState<number | null>(null);
  const extractMilestonesMutation = useMutation({
    mutationFn: async (seriesId: number) => {
      setExtractingSeriesId(seriesId);
      const response = await apiRequest("POST", `/api/series/${seriesId}/guide/extract`);
      return response.json();
    },
    onSuccess: (data) => {
      setExtractingSeriesId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/series/registry"] });
      toast({ 
        title: "Extraccion completada", 
        description: `${data.milestonesCreated} hitos y ${data.threadsCreated} hilos extraidos` 
      });
    },
    onError: async (error: any) => {
      setExtractingSeriesId(null);
      let details = "Error desconocido";
      try {
        if (error?.response) {
          const data = await error.response.json();
          details = data.details || data.error || "Error desconocido";
        } else if (error?.message) {
          details = error.message;
        }
      } catch { /* ignore */ }
      toast({ title: "Error", description: details, variant: "destructive" });
    },
  });

  const linkManuscriptMutation = useMutation({
    mutationFn: async ({ seriesId, manuscriptId, seriesOrder }: { seriesId: number; manuscriptId: number; seriesOrder: number }) => {
      const response = await apiRequest("POST", `/api/series/${seriesId}/link-manuscript`, { manuscriptId, seriesOrder });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/series/registry"] });
      queryClient.invalidateQueries({ queryKey: ["/api/imported-manuscripts"] });
      setLinkingSeriesId(null);
      setLinkManuscriptId("");
      setLinkSeriesOrder(1);
      toast({ title: "Volumen vinculado", description: "El manuscrito ha sido añadido a la serie" });
    },
    onError: async (error: any) => {
      let details = "No se pudo vincular el manuscrito";
      try {
        if (error?.response) {
          const data = await error.response.json();
          details = data.error || details;
        }
      } catch { /* ignore */ }
      toast({ title: "Error", description: details, variant: "destructive" });
    },
  });

  const handleLinkManuscript = () => {
    if (!linkingSeriesId || !linkManuscriptId) return;
    linkManuscriptMutation.mutate({
      seriesId: linkingSeriesId,
      manuscriptId: parseInt(linkManuscriptId),
      seriesOrder: linkSeriesOrder,
    });
  };

  const openLinkModal = async (seriesId: number) => {
    setLinkingSeriesId(seriesId);
    setLinkManuscriptId("");
    
    try {
      const response = await fetch(`/api/series/${seriesId}/volumes`, { credentials: "include" });
      if (response.ok) {
        const data = await response.json();
        setLinkSeriesOrder(data.nextOrder || 1);
      } else {
        setLinkSeriesOrder(1);
      }
    } catch {
      setLinkSeriesOrder(1);
    }
  };

  const availableManuscriptsForLinking = allManuscripts.filter(m => !m.seriesId);

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

  const startEditing = (s: SeriesWithDetails) => {
    setEditingSeriesId(s.id);
    setEditTitle(s.title);
    setEditDescription(s.description || "");
    setEditWorkType(s.workType as "trilogy" | "series");
    setEditTotalBooks(s.totalPlannedBooks || 3);
  };

  const cancelEditing = () => {
    setEditingSeriesId(null);
    setEditTitle("");
    setEditDescription("");
    setEditWorkType("trilogy");
    setEditTotalBooks(3);
  };

  const saveEditing = () => {
    if (!editingSeriesId || !editTitle.trim()) return;
    updateSeriesMutation.mutate({
      id: editingSeriesId,
      data: {
        title: editTitle,
        description: editDescription || null,
        workType: editWorkType,
        totalPlannedBooks: editTotalBooks,
      },
    });
  };

  const handleSeriesGuideUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !uploadingSeriesId) return;

    if (!file.name.endsWith(".docx")) {
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
      <input
        type="file"
        ref={seriesGuideInputRef}
        onChange={handleSeriesGuideUpload}
        accept=".docx"
        className="hidden"
        data-testid="input-series-guide-upload"
      />

      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold">Registro de Series</h1>
          <p className="text-muted-foreground mt-1">
            Gestiona tus series y trilogias con sus volumenes asignados
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
                <Label>Titulo de la Serie</Label>
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
                    <SelectItem value="trilogy">Trilogia</SelectItem>
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
              Crea una serie o trilogia para organizar tus volumenes
            </p>
          </CardContent>
        </Card>
      ) : (
        <Accordion type="multiple" className="space-y-2">
          {registry.map((s) => (
            <AccordionItem key={s.id} value={s.id.toString()} className="border rounded-lg bg-card" data-testid={`accordion-series-${s.id}`}>
              <AccordionTrigger className="px-4 py-3 hover:no-underline">
                <div className="flex items-center gap-3 flex-wrap flex-1 text-left">
                  <span className="font-semibold text-lg">{s.title}</span>
                  <Badge variant="outline">
                    {s.workType === "trilogy" ? "Trilogia" : "Serie"}
                  </Badge>
                  <Badge variant="secondary">
                    {s.completedVolumes}/{s.totalPlannedBooks} vol.
                  </Badge>
                  {s.seriesGuide && (
                    <Badge variant="outline" className="text-green-600 dark:text-green-400">
                      <FileText className="h-3 w-3 mr-1" />
                      Guia
                    </Badge>
                  )}
                  {s.pseudonym && (
                    <Badge variant="outline">
                      <User className="h-3 w-3 mr-1" />
                      {s.pseudonym.name}
                    </Badge>
                  )}
                </div>
              </AccordionTrigger>
              <AccordionContent className="px-4 pb-4">
                <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
                  <div className="flex-1 min-w-0">
                    {editingSeriesId === s.id ? (
                      <div className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label>Titulo</Label>
                            <Input
                              value={editTitle}
                              onChange={(e) => setEditTitle(e.target.value)}
                              data-testid={`input-edit-title-${s.id}`}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>Tipo</Label>
                            <Select value={editWorkType} onValueChange={(v) => setEditWorkType(v as "trilogy" | "series")}>
                              <SelectTrigger data-testid={`select-edit-type-${s.id}`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="trilogy">Trilogia</SelectItem>
                                <SelectItem value="series">Serie</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label>Descripcion</Label>
                            <Textarea
                              value={editDescription}
                              onChange={(e) => setEditDescription(e.target.value)}
                              placeholder="Descripcion de la serie..."
                              rows={3}
                              data-testid={`input-edit-description-${s.id}`}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>Libros Planificados</Label>
                            <Input
                              type="number"
                              min={2}
                              max={20}
                              value={editTotalBooks}
                              onChange={(e) => setEditTotalBooks(parseInt(e.target.value) || 3)}
                              data-testid={`input-edit-books-${s.id}`}
                            />
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button onClick={saveEditing} disabled={updateSeriesMutation.isPending} size="sm">
                            {updateSeriesMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Check className="h-4 w-4 mr-2" />}
                            Guardar
                          </Button>
                          <Button variant="outline" size="sm" onClick={cancelEditing}>
                            <X className="h-4 w-4 mr-2" />
                            Cancelar
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        {s.description || "Sin descripcion"}
                      </p>
                    )}
                  </div>
                  {editingSeriesId !== s.id && (
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => startEditing(s)}
                        data-testid={`button-edit-series-${s.id}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setDeleteSeriesId(s.id)}
                        data-testid={`button-delete-series-${s.id}`}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  )}
                </div>
                
                <div className="space-y-4 mt-4">
                <div className="flex items-center gap-4 flex-wrap">
                  <div className="flex items-center gap-2">
                    <User className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">Seudonimo:</span>
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

                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">
                      Guia de Serie:
                    </span>
                    {s.seriesGuideFileName && (
                      <span className="text-xs text-muted-foreground/60">
                        {s.seriesGuideFileName}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setUploadingSeriesId(s.id);
                        seriesGuideInputRef.current?.click();
                      }}
                      disabled={uploadSeriesGuideMutation.isPending}
                      data-testid={`button-upload-guide-${s.id}`}
                    >
                      {uploadSeriesGuideMutation.isPending && uploadingSeriesId === s.id ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : (
                        <Upload className="h-4 w-4 mr-2" />
                      )}
                      {s.seriesGuide ? "Reemplazar" : "Subir"} Guia
                    </Button>
                    {s.seriesGuide && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => extractMilestonesMutation.mutate(s.id)}
                          disabled={extractMilestonesMutation.isPending && extractingSeriesId === s.id}
                          data-testid={`button-extract-milestones-${s.id}`}
                        >
                          {extractMilestonesMutation.isPending && extractingSeriesId === s.id ? (
                            <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          ) : (
                            <Sparkles className="h-4 w-4 mr-2" />
                          )}
                          Extraer Hitos
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => deleteSeriesGuideMutation.mutate(s.id)}
                          disabled={deleteSeriesGuideMutation.isPending}
                          data-testid={`button-delete-guide-${s.id}`}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>

                <Separator />

                <div>
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <div className="flex items-center gap-2">
                      <BookOpen className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">Volumenes</span>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openLinkModal(s.id)}
                      disabled={availableManuscriptsForLinking.length === 0}
                      data-testid={`button-link-manuscript-${s.id}`}
                    >
                      <Link2 className="h-4 w-4 mr-2" />
                      Vincular Volumen Existente
                    </Button>
                  </div>
                  
                  {(!s.volumes || s.volumes.length === 0) ? (
                    <div className="text-sm text-muted-foreground/60 py-4 text-center bg-muted/30 rounded-md">
                      No hay volumenes en esta serie todavia.
                      <br />
                      Vincula un manuscrito importado o crea un nuevo proyecto.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {s.volumes.map((vol) => (
                        <div
                          key={`${vol.type}-${vol.id}`}
                          className="flex items-center justify-between gap-4 p-3 rounded-md bg-muted/50"
                          data-testid={`volume-item-${vol.type}-${vol.id}`}
                        >
                          <div className="flex items-center gap-3 flex-1 min-w-0">
                            <Badge variant="outline" className="shrink-0">
                              Vol. {vol.seriesOrder || "?"}
                            </Badge>
                            <span className="font-medium truncate">{vol.title}</span>
                            {vol.type === "imported" && (
                              <Badge variant="secondary" className="shrink-0">
                                <FileText className="h-3 w-3 mr-1" />
                                Importado
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            {vol.type === "project" ? (
                              <Badge className={statusColors[vol.status] || ""}>
                                {statusLabels[vol.status] || vol.status}
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-green-600 dark:text-green-400">
                                Completado
                              </Badge>
                            )}
                            {vol.wordCount > 0 && (
                              <Badge variant="secondary">
                                {vol.wordCount.toLocaleString()} palabras
                              </Badge>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <Separator />

                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <Target className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">Verificación de Arco Argumental</span>
                  </div>
                  <ArcVerificationPanel 
                    seriesId={s.id} 
                    seriesTitle={s.title}
                    totalVolumes={s.totalPlannedBooks || 0}
                  />
                </div>
                </div>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      )}

      <ConfirmDialog
        open={deleteSeriesId !== null}
        onOpenChange={(open) => !open && setDeleteSeriesId(null)}
        title="Eliminar Serie"
        description="Esta accion eliminara la serie pero mantendra los proyectos asociados como obras independientes."
        confirmText="Eliminar"
        onConfirm={() => {
          if (deleteSeriesId) {
            deleteSeriesMutation.mutate(deleteSeriesId);
            setDeleteSeriesId(null);
          }
        }}
      />

      <Dialog open={linkingSeriesId !== null} onOpenChange={(open) => !open && setLinkingSeriesId(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Vincular Volumen Existente</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Manuscrito Importado</Label>
              <Select value={linkManuscriptId} onValueChange={setLinkManuscriptId}>
                <SelectTrigger data-testid="select-link-manuscript">
                  <SelectValue placeholder="Seleccionar manuscrito..." />
                </SelectTrigger>
                <SelectContent>
                  {availableManuscriptsForLinking.map((m) => (
                    <SelectItem key={m.id} value={m.id.toString()}>
                      {m.title} ({m.totalChapters} caps.)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {availableManuscriptsForLinking.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No hay manuscritos disponibles. Importa un manuscrito primero desde la seccion "Edicion".
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label>Numero de Volumen</Label>
              <Input
                type="number"
                min={1}
                max={20}
                value={linkSeriesOrder}
                onChange={(e) => setLinkSeriesOrder(parseInt(e.target.value) || 1)}
                data-testid="input-link-series-order"
              />
              <p className="text-xs text-muted-foreground">
                Este numero indica la posicion del libro en la serie.
              </p>
            </div>
            <div className="flex gap-2 pt-2">
              <Button
                onClick={handleLinkManuscript}
                disabled={!linkManuscriptId || linkManuscriptMutation.isPending}
                data-testid="button-confirm-link"
              >
                {linkManuscriptMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Link2 className="h-4 w-4 mr-2" />
                )}
                Vincular
              </Button>
              <Button variant="outline" onClick={() => setLinkingSeriesId(null)}>
                Cancelar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
