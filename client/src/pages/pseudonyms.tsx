import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { User, Plus, Trash2, FileText, Edit2, Check, X, Upload, Loader2, Download } from "lucide-react";
import type { Pseudonym, StyleGuide } from "@shared/schema";

export default function PseudonymsPage() {
  const { toast } = useToast();
  const [selectedPseudonym, setSelectedPseudonym] = useState<number | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isCreatingGuide, setIsCreatingGuide] = useState(false);
  const [newName, setNewName] = useState("");
  const [newBio, setNewBio] = useState("");
  const [newGuideTitle, setNewGuideTitle] = useState("");
  const [newGuideContent, setNewGuideContent] = useState("");
  const [isUploadingFile, setIsUploadingFile] = useState(false);
  const [deletePseudonymId, setDeletePseudonymId] = useState<number | null>(null);
  const [deleteGuideId, setDeleteGuideId] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: pseudonyms = [], isLoading } = useQuery<Pseudonym[]>({
    queryKey: ["/api/pseudonyms"],
  });

  const { data: styleGuides = [] } = useQuery<StyleGuide[]>({
    queryKey: ["/api/pseudonyms", selectedPseudonym, "style-guides"],
    enabled: selectedPseudonym !== null,
  });

  const createPseudonymMutation = useMutation({
    mutationFn: async (data: { name: string; bio?: string }) => {
      const response = await apiRequest("POST", "/api/pseudonyms", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pseudonyms"] });
      setIsCreating(false);
      setNewName("");
      setNewBio("");
      toast({ title: "Pseudónimo creado", description: "El nuevo pseudónimo ha sido añadido" });
    },
    onError: () => {
      toast({ title: "Error", description: "No se pudo crear el pseudónimo", variant: "destructive" });
    },
  });

  const deletePseudonymMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/pseudonyms/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pseudonyms"] });
      if (selectedPseudonym) setSelectedPseudonym(null);
      toast({ title: "Pseudónimo eliminado" });
    },
    onError: () => {
      toast({ title: "Error", description: "No se pudo eliminar el pseudónimo", variant: "destructive" });
    },
  });

  const createStyleGuideMutation = useMutation({
    mutationFn: async (data: { title: string; content: string }) => {
      const response = await apiRequest("POST", `/api/pseudonyms/${selectedPseudonym}/style-guides`, data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pseudonyms", selectedPseudonym, "style-guides"] });
      setIsCreatingGuide(false);
      setNewGuideTitle("");
      setNewGuideContent("");
      toast({ title: "Guía de estilo creada" });
    },
    onError: () => {
      toast({ title: "Error", description: "No se pudo crear la guía de estilo", variant: "destructive" });
    },
  });

  const deleteStyleGuideMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/style-guides/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pseudonyms", selectedPseudonym, "style-guides"] });
      toast({ title: "Guía eliminada" });
    },
    onError: () => {
      toast({ title: "Error", description: "No se pudo eliminar la guía", variant: "destructive" });
    },
  });

  const handleCreatePseudonym = () => {
    if (!newName.trim()) return;
    createPseudonymMutation.mutate({ name: newName, bio: newBio || undefined });
  };

  const handleCreateStyleGuide = () => {
    if (!newGuideTitle.trim() || !newGuideContent.trim()) return;
    createStyleGuideMutation.mutate({ title: newGuideTitle, content: newGuideContent });
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploadingFile(true);
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
      setNewGuideContent(result.content);
      
      if (!newGuideTitle.trim()) {
        const filenameWithoutExt = file.name.replace(/\.(docx?|doc)$/i, "");
        setNewGuideTitle(filenameWithoutExt);
      }
      
      toast({ title: "Archivo procesado", description: `Contenido extraído de "${file.name}"` });
    } catch (error: any) {
      toast({ 
        title: "Error", 
        description: error.message || "No se pudo procesar el archivo Word", 
        variant: "destructive" 
      });
    } finally {
      setIsUploadingFile(false);
      e.target.value = "";
    }
  };

  const selectedPseudonymData = pseudonyms.find(p => p.id === selectedPseudonym);

  const downloadStyleGuideTemplate = () => {
    const template = `# PLANTILLA DE GUÍA DE ESTILO
# Completa las secciones según tu preferencia de escritura

## 1. VOZ NARRATIVA
- Persona: [Primera persona / Tercera persona limitada / Tercera persona omnisciente]
- Tono predominante: [Íntimo / Distante / Irónico / Dramático / etc.]
- Nivel de formalidad: [Coloquial / Neutro / Formal / Literario]

## 2. ESTILO DE PROSA
- Longitud de oraciones: [Cortas y directas / Variadas / Largas y elaboradas]
- Uso de metáforas: [Mínimo / Moderado / Abundante]
- Descripciones: [Esenciales / Detalladas / Sensoriales]
- Diálogos: [Realistas / Estilizados / Dialectales]

## 3. RITMO Y ESTRUCTURA
- Velocidad de escenas de acción: [Frenética / Moderada / Pausada]
- Capítulos: [Cortos 2000-3000 palabras / Medios 4000-5000 / Largos 6000+]
- Cliffhangers: [Al final de cada capítulo / Ocasionales / Mínimos]

## 4. CONTENIDO SENSIBLE
- Violencia: [Explícita / Sugerida / Mínima]
- Romance/Escenas íntimas: [Explícitas / Fade to black / Sin escenas]
- Lenguaje fuerte: [Permitido / Moderado / Evitar]

## 5. VOCABULARIO
- Palabras a EVITAR: [Lista de palabras que no quieres usar]
- Palabras PREFERIDAS: [Términos o expresiones características de tu estilo]
- Muletillas a evitar: [Frases repetitivas que no deseas]

## 6. REFERENCIAS DE ESTILO
- Autores de referencia: [Nombres de autores cuyo estilo admiras]
- Libros de referencia: [Títulos específicos que ejemplifican el tono deseado]

## 7. NOTAS ADICIONALES
[Cualquier otra instrucción específica para los agentes de escritura]
`;

    const blob = new Blob([template], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "plantilla-guia-estilo.txt";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    toast({ 
      title: "Plantilla descargada", 
      description: "Edita el archivo y súbelo para crear tu guía de estilo" 
    });
  };

  return (
    <div className="p-6 space-y-6" data-testid="pseudonyms-page">
      <div>
        <h1 className="text-3xl font-bold">Pseudónimos</h1>
        <p className="text-muted-foreground mt-1">
          Gestiona tus identidades de autor y guías de estilo asociadas
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-1">
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2">
                <User className="h-5 w-5" />
                Autores
              </CardTitle>
              <CardDescription>
                {pseudonyms.length} pseudónimo{pseudonyms.length !== 1 ? "s" : ""}
              </CardDescription>
            </div>
            <Button 
              size="icon" 
              variant="ghost" 
              onClick={() => setIsCreating(true)}
              data-testid="button-add-pseudonym"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {isCreating && (
              <div className="space-y-2 p-3 rounded-md bg-muted/50 mb-3">
                <Input
                  placeholder="Nombre del pseudónimo"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  data-testid="input-pseudonym-name"
                />
                <Textarea
                  placeholder="Biografía (opcional)"
                  value={newBio}
                  onChange={(e) => setNewBio(e.target.value)}
                  className="min-h-[60px]"
                  data-testid="input-pseudonym-bio"
                />
                <div className="flex gap-2">
                  <Button 
                    size="sm" 
                    onClick={handleCreatePseudonym}
                    disabled={createPseudonymMutation.isPending}
                    data-testid="button-save-pseudonym"
                  >
                    <Check className="h-3 w-3 mr-1" />
                    Guardar
                  </Button>
                  <Button 
                    size="sm" 
                    variant="ghost" 
                    onClick={() => { setIsCreating(false); setNewName(""); setNewBio(""); }}
                    data-testid="button-cancel-pseudonym"
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            )}

            {isLoading ? (
              <div className="py-8 text-center text-muted-foreground">Cargando...</div>
            ) : pseudonyms.length === 0 ? (
              <div className="py-8 text-center">
                <User className="h-12 w-12 text-muted-foreground/30 mx-auto mb-2" />
                <p className="text-muted-foreground text-sm">No hay pseudónimos</p>
              </div>
            ) : (
              pseudonyms.map((pseudonym) => (
                <div
                  key={pseudonym.id}
                  className={`flex items-center justify-between gap-2 p-3 rounded-md cursor-pointer transition-colors ${
                    selectedPseudonym === pseudonym.id 
                      ? "bg-primary/10 border border-primary/20" 
                      : "bg-muted/50 hover-elevate"
                  }`}
                  onClick={() => setSelectedPseudonym(pseudonym.id)}
                  data-testid={`pseudonym-item-${pseudonym.id}`}
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{pseudonym.name}</p>
                    {pseudonym.bio && (
                      <p className="text-xs text-muted-foreground truncate">{pseudonym.bio}</p>
                    )}
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeletePseudonymId(pseudonym.id);
                    }}
                    data-testid={`button-delete-pseudonym-${pseudonym.id}`}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Guías de Estilo
              </CardTitle>
              <CardDescription>
                {selectedPseudonymData 
                  ? `Guías para "${selectedPseudonymData.name}"` 
                  : "Selecciona un pseudónimo para ver sus guías"}
              </CardDescription>
            </div>
            {selectedPseudonym && (
              <Button 
                size="sm" 
                onClick={() => setIsCreatingGuide(true)}
                data-testid="button-add-style-guide"
              >
                <Plus className="h-4 w-4 mr-1" />
                Nueva Guía
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {!selectedPseudonym ? (
              <div className="py-12 text-center">
                <FileText className="h-16 w-16 text-muted-foreground/20 mx-auto mb-4" />
                <p className="text-muted-foreground">
                  Selecciona un pseudónimo de la lista para gestionar sus guías de estilo
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {isCreatingGuide && (
                  <div className="space-y-3 p-4 rounded-md bg-muted/50">
                    <div className="space-y-2">
                      <Label>Título de la guía</Label>
                      <Input
                        placeholder="Ej: Voz narrativa thriller"
                        value={newGuideTitle}
                        onChange={(e) => setNewGuideTitle(e.target.value)}
                        data-testid="input-guide-title"
                      />
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <Label>Contenido de la guía</Label>
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept=".docx,.doc"
                          onChange={handleFileUpload}
                          className="hidden"
                          disabled={isUploadingFile}
                          data-testid="input-upload-word"
                        />
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={downloadStyleGuideTemplate}
                            data-testid="button-download-template"
                          >
                            <Download className="h-3 w-3 mr-1" />
                            Descargar Plantilla
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={isUploadingFile}
                            onClick={() => fileInputRef.current?.click()}
                            data-testid="button-upload-word"
                          >
                            {isUploadingFile ? (
                              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                            ) : (
                              <Upload className="h-3 w-3 mr-1" />
                            )}
                            Subir Word
                          </Button>
                        </div>
                      </div>
                      <Textarea
                        placeholder="Describe el estilo de escritura, vocabulario preferido, estructura de oraciones, nivel de descripción, manejo de diálogos, ritmo narrativo, etc."
                        value={newGuideContent}
                        onChange={(e) => setNewGuideContent(e.target.value)}
                        className="min-h-[200px] font-mono text-sm"
                        data-testid="input-guide-content"
                      />
                      <p className="text-xs text-muted-foreground">
                        Puedes escribir directamente o subir un archivo Word (.docx, .doc)
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button 
                        onClick={handleCreateStyleGuide}
                        disabled={createStyleGuideMutation.isPending}
                        data-testid="button-save-guide"
                      >
                        <Check className="h-4 w-4 mr-1" />
                        Guardar Guía
                      </Button>
                      <Button 
                        variant="ghost" 
                        onClick={() => { setIsCreatingGuide(false); setNewGuideTitle(""); setNewGuideContent(""); }}
                        data-testid="button-cancel-guide"
                      >
                        Cancelar
                      </Button>
                    </div>
                  </div>
                )}

                {styleGuides.length === 0 && !isCreatingGuide ? (
                  <div className="py-8 text-center">
                    <FileText className="h-12 w-12 text-muted-foreground/30 mx-auto mb-2" />
                    <p className="text-muted-foreground text-sm">
                      Este pseudónimo no tiene guías de estilo
                    </p>
                    <p className="text-muted-foreground/60 text-xs mt-1">
                      Crea una guía para definir la voz de este autor
                    </p>
                    <div className="flex justify-center gap-2 mt-4">
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={downloadStyleGuideTemplate}
                        data-testid="button-download-template-empty"
                      >
                        <Download className="h-4 w-4 mr-1" />
                        Descargar Plantilla
                      </Button>
                      <Button 
                        size="sm"
                        onClick={() => setIsCreatingGuide(true)}
                        data-testid="button-create-guide-empty"
                      >
                        <Plus className="h-4 w-4 mr-1" />
                        Crear Guía
                      </Button>
                    </div>
                  </div>
                ) : (
                  styleGuides.map((guide) => (
                    <div
                      key={guide.id}
                      className="p-4 rounded-md bg-muted/50 space-y-3"
                      data-testid={`style-guide-item-${guide.id}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <h3 className="font-medium">{guide.title}</h3>
                          {guide.isActive && (
                            <Badge variant="outline" className="text-xs">Activa</Badge>
                          )}
                        </div>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => setDeleteGuideId(guide.id)}
                          data-testid={`button-delete-guide-${guide.id}`}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                      <p className="text-sm text-muted-foreground whitespace-pre-wrap font-mono">
                        {guide.content.length > 500 
                          ? guide.content.substring(0, 500) + "..." 
                          : guide.content}
                      </p>
                    </div>
                  ))
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <ConfirmDialog
        open={deletePseudonymId !== null}
        onOpenChange={(open) => !open && setDeletePseudonymId(null)}
        title="Eliminar pseudónimo"
        description="¿Eliminar este pseudónimo y todas sus guías de estilo? Esta acción no se puede deshacer."
        confirmText="Eliminar"
        variant="destructive"
        onConfirm={() => {
          if (deletePseudonymId) {
            deletePseudonymMutation.mutate(deletePseudonymId);
            if (selectedPseudonym === deletePseudonymId) {
              setSelectedPseudonym(null);
            }
          }
          setDeletePseudonymId(null);
        }}
      />

      <ConfirmDialog
        open={deleteGuideId !== null}
        onOpenChange={(open) => !open && setDeleteGuideId(null)}
        title="Eliminar guía de estilo"
        description="¿Eliminar esta guía de estilo? Esta acción no se puede deshacer."
        confirmText="Eliminar"
        variant="destructive"
        onConfirm={() => {
          if (deleteGuideId) {
            deleteStyleGuideMutation.mutate(deleteGuideId);
          }
          setDeleteGuideId(null);
        }}
      />
    </div>
  );
}
