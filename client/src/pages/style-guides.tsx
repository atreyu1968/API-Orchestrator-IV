import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import ReactMarkdown from "react-markdown";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Palette, Plus, FileText, User, Check, Trash2, Download, Copy, Edit2, Eye, Sparkles, Loader2 } from "lucide-react";
import type { Pseudonym, StyleGuide } from "@shared/schema";

const STYLE_GUIDE_TEMPLATE = `# GUÍA DE ESTILO: [NOMBRE DEL SEUDÓNIMO]

---

## 1. IDENTIDAD DEL AUTOR

### Datos del Seudónimo
- **Nombre completo:** [Nombre del seudónimo]
- **Género literario principal:** [Thriller / Romance / Fantasía / etc.]
- **Subgéneros:** [Ej: Thriller psicológico, Suspense doméstico]
- **Público objetivo:** [Edad, género, intereses del lector ideal]

### Biografía Ficticia
[2-3 párrafos con la historia del "autor" para contraportadas y marketing]

---

## 2. VOZ NARRATIVA

### Punto de Vista Preferido
- [ ] Primera persona
- [ ] Tercera persona limitada
- [ ] Tercera persona omnisciente
- [ ] Múltiples POV

### Tiempo Verbal
- [ ] Pasado
- [ ] Presente

### Registro Lingüístico
- **Formalidad:** [1-5, donde 1=muy coloquial, 5=muy formal]
- **Complejidad:** [1-5, donde 1=frases simples, 5=frases complejas]
- **Vocabulario:** [Accesible / Técnico / Literario / Regional]

### Ritmo de Prosa
- **Longitud de frases:** [Cortas y punzantes / Variadas / Largas y fluidas]
- **Longitud de párrafos:** [Breves / Moderados / Extensos]
- **Uso de diálogo vs. narración:** [70/30, 50/50, 30/70]

---

## 3. ESTRUCTURA NARRATIVA

### Capítulos
- **Longitud típica:** [1500-2500 palabras / 2500-4000 / otro]
- **Inicio de capítulo:** [In medias res / Contextual / Gancho de diálogo]
- **Final de capítulo:** [Cliffhanger obligatorio / Cierre parcial / Varía]

### Escenas
- **Escenas por capítulo:** [2-3 / 3-5 / Variable]
- **Transiciones:** [Corte seco / Marcador visual / Transición narrativa]

---

## 4. TEMAS RECURRENTES

### Temas Centrales
1. [Tema 1]: [Cómo se explora típicamente]
2. [Tema 2]: [Cómo se explora típicamente]
3. [Tema 3]: [Cómo se explora típicamente]

### Motivos Literarios
- [Motivo 1]: [Ej: Espejos como símbolo de dualidad]
- [Motivo 2]: [Ej: Agua como purificación o peligro]

---

## 5. PERSONAJES

### Arquetipos de Protagonista
- **Género típico:** [Femenino / Masculino / Variable]
- **Rango de edad:** [25-40 / 30-50 / Variable]
- **Defecto característico:** [Ej: Tendencia a la desconfianza]
- **Fortaleza típica:** [Ej: Resiliencia ante la adversidad]

### Relaciones
- **Romance:** [Central / Subtrama / Ausente]
- **Nivel de contenido adulto:** [Cerrado / Insinuado / Explícito]

---

## 6. AMBIENTACIÓN

### Localizaciones Típicas
- **Tipo de escenario:** [Urbano / Rural / Mixto]
- **Región geográfica:** [España / Latinoamérica / Ficticio / Variable]
- **Época:** [Contemporáneo / Histórico / Futuro]
- **Atmósfera:** [Claustrofóbica / Abierta / Opresiva / Acogedora]

---

## 7. DIÁLOGOS

### Estilo de Diálogo
- **Naturalidad:** [Muy natural / Estilizado / Formal]
- **Acotaciones:** [Mínimas / Moderadas / Descriptivas]

### Verbos de Habla
- **Preferencia:** ["Dijo" mayoritario / Variedad / Eliminar cuando posible]

---

## 8. RECURSOS ESTILÍSTICOS

### Figuras Retóricas Preferidas
- [ ] Metáforas
- [ ] Símiles
- [ ] Ironía
- [ ] Repetición enfática

### Técnicas Narrativas
- [ ] Flashbacks
- [ ] Narrativa no lineal
- [ ] Múltiples líneas temporales
- [ ] Narrador no fiable

---

## 9. PROHIBICIONES Y RESTRICCIONES

### Vocabulario Prohibido
- [Palabra/frase 1]: [Por qué evitarla]
- [Palabra/frase 2]: [Por qué evitarla]

### Tropos a Evitar
- [Tropo 1]: [Ej: El villano que explica su plan]
- [Tropo 2]: [Ej: Deus ex machina]

### Contenido Restringido
- Violencia gráfica: [Permitida / Moderada / Evitar]
- Contenido sexual: [Explícito / Insinuado / Evitar]
- Lenguaje soez: [Libre / Moderado / Evitar]

---

## 10. REFERENCIAS E INFLUENCIAS

### Autores de Referencia
1. [Autor 1]: [Qué tomar de su estilo]
2. [Autor 2]: [Qué tomar de su estilo]

---

## 11. FORMATO Y PRESENTACIÓN

### Formato de Manuscrito
- **Longitud objetivo:** [60.000-80.000 palabras / otro]
- **Capítulos típicos:** [20-25 / 30-40 / otro]
- **Prólogo:** [Siempre / A veces / Nunca]
- **Epílogo:** [Siempre / A veces / Nunca]

---

*Última actualización: [Fecha]*
`;

const formSchema = z.object({
  title: z.string().min(1, "El título es requerido"),
  content: z.string().min(100, "El contenido debe tener al menos 100 caracteres"),
  pseudonymId: z.string().optional(),
  newPseudonymName: z.string().optional(),
  createNewPseudonym: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

type FormData = z.infer<typeof formSchema>;

const generateFormSchema = z.object({
  referenceAuthor: z.string().min(1, "El autor de referencia es requerido"),
  pseudonymName: z.string().min(1, "El nombre del seudónimo es requerido"),
  genre: z.string().optional(),
  additionalNotes: z.string().optional(),
  pseudonymId: z.string().optional(),
  createPseudonym: z.boolean().default(true),
  saveGuide: z.boolean().default(true),
});

type GenerateFormData = z.infer<typeof generateFormSchema>;

export default function StyleGuidesPage() {
  const { toast } = useToast();
  const [selectedGuide, setSelectedGuide] = useState<StyleGuide | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [generatedGuide, setGeneratedGuide] = useState<string | null>(null);

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: "",
      content: "",
      pseudonymId: "",
      newPseudonymName: "",
      createNewPseudonym: false,
      isActive: true,
    },
  });

  const generateForm = useForm<GenerateFormData>({
    resolver: zodResolver(generateFormSchema),
    defaultValues: {
      referenceAuthor: "",
      pseudonymName: "",
      genre: "",
      additionalNotes: "",
      pseudonymId: "",
      createPseudonym: true,
      saveGuide: true,
    },
  });

  const createNewPseudonym = form.watch("createNewPseudonym");
  const generateCreatePseudonym = generateForm.watch("createPseudonym");

  const { data: pseudonyms = [] } = useQuery<Pseudonym[]>({
    queryKey: ["/api/pseudonyms"],
  });

  const { data: allStyleGuides = [], isLoading } = useQuery<StyleGuide[]>({
    queryKey: ["/api/all-style-guides"],
  });

  const createPseudonymMutation = useMutation({
    mutationFn: async (name: string) => {
      const response = await apiRequest("POST", "/api/pseudonyms", { name });
      return response.json();
    },
  });

  const createStyleGuideMutation = useMutation({
    mutationFn: async (data: { pseudonymId: number; title: string; content: string; isActive: boolean }) => {
      const response = await apiRequest("POST", `/api/pseudonyms/${data.pseudonymId}/style-guides`, {
        title: data.title,
        content: data.content,
        isActive: data.isActive,
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/all-style-guides"] });
      queryClient.invalidateQueries({ queryKey: ["/api/pseudonyms"] });
      form.reset();
      toast({ title: "Guía de estilo creada", description: "La guía ha sido guardada exitosamente" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const updateStyleGuideMutation = useMutation({
    mutationFn: async (data: { id: number; title: string; content: string; isActive: boolean }) => {
      const response = await apiRequest("PATCH", `/api/style-guides/${data.id}`, {
        title: data.title,
        content: data.content,
        isActive: data.isActive,
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/all-style-guides"] });
      setIsEditing(false);
      setSelectedGuide(null);
      form.reset();
      toast({ title: "Guía actualizada" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteStyleGuideMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/style-guides/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/all-style-guides"] });
      toast({ title: "Guía eliminada" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const generateStyleGuideMutation = useMutation({
    mutationFn: async (data: GenerateFormData) => {
      const response = await apiRequest("POST", "/api/generate-style-guide", {
        ...data,
        pseudonymId: data.pseudonymId && data.pseudonymId !== "none" ? parseInt(data.pseudonymId) : undefined,
      });
      return response.json();
    },
    onSuccess: (data) => {
      setGeneratedGuide(data.guideContent);
      queryClient.invalidateQueries({ queryKey: ["/api/all-style-guides"] });
      queryClient.invalidateQueries({ queryKey: ["/api/pseudonyms"] });
      toast({ title: "Guía generada", description: data.message });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const onFormError = (errors: Record<string, any>) => {
    console.error("[StyleGuides] Form validation errors:", errors);
    const errorMessages = Object.entries(errors)
      .map(([field, error]: [string, any]) => `${field}: ${error?.message || 'inválido'}`)
      .join(', ');
    toast({
      title: "Campos incompletos",
      description: errorMessages,
      variant: "destructive",
    });
  };

  const onSubmit = async (data: FormData) => {
    let pseudonymId: number;

    if (data.createNewPseudonym && data.newPseudonymName) {
      try {
        const newPseudonym = await createPseudonymMutation.mutateAsync(data.newPseudonymName);
        pseudonymId = newPseudonym.id;
      } catch (error) {
        toast({ title: "Error", description: "No se pudo crear el seudónimo", variant: "destructive" });
        return;
      }
    } else if (data.pseudonymId && data.pseudonymId !== "none") {
      pseudonymId = parseInt(data.pseudonymId);
    } else {
      toast({ title: "Error", description: "Debes seleccionar o crear un seudónimo", variant: "destructive" });
      return;
    }

    if (isEditing && selectedGuide) {
      updateStyleGuideMutation.mutate({
        id: selectedGuide.id,
        title: data.title,
        content: data.content,
        isActive: data.isActive,
      });
    } else {
      createStyleGuideMutation.mutate({
        pseudonymId,
        title: data.title,
        content: data.content,
        isActive: data.isActive,
      });
    }
  };

  const handleUseTemplate = () => {
    form.setValue("content", STYLE_GUIDE_TEMPLATE);
    toast({ title: "Plantilla cargada", description: "Rellena los campos marcados con [corchetes]" });
  };

  const onGenerateSubmit = (data: GenerateFormData) => {
    console.log("[StyleGuides] Generate form submitted successfully", data.referenceAuthor);
    generateStyleGuideMutation.mutate(data);
  };

  const onGenerateFormError = (errors: Record<string, any>) => {
    console.error("[StyleGuides] Generate form validation errors:", errors);
    const errorMessages = Object.entries(errors)
      .map(([field, error]: [string, any]) => `${field}: ${error?.message || 'inválido'}`)
      .join(', ');
    toast({
      title: "Campos incompletos",
      description: errorMessages,
      variant: "destructive",
    });
  };

  const resetGenerateForm = () => {
    setGeneratedGuide(null);
    generateForm.reset();
  };

  const handleEditGuide = (guide: StyleGuide) => {
    setSelectedGuide(guide);
    setIsEditing(true);
    form.setValue("title", guide.title);
    form.setValue("content", guide.content);
    form.setValue("isActive", guide.isActive);
    form.setValue("pseudonymId", guide.pseudonymId?.toString() || "");
    form.setValue("createNewPseudonym", false);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setSelectedGuide(null);
    form.reset();
  };

  const handleDownloadGuide = (guide: StyleGuide) => {
    const blob = new Blob([guide.content], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${guide.title.toLowerCase().replace(/\s+/g, "_")}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const getPseudonymName = (pseudonymId: number | null) => {
    if (!pseudonymId) return "Sin asignar";
    const pseudonym = pseudonyms.find(p => p.id === pseudonymId);
    return pseudonym?.name || "Desconocido";
  };

  return (
    <div className="container mx-auto px-6 py-6 max-w-6xl">
      <div className="mb-6" data-testid="page-header">
        <h1 className="text-3xl font-bold flex items-center gap-2" data-testid="text-page-title">
          <Palette className="h-8 w-8 text-primary" />
          Guías de Estilo
        </h1>
        <p className="text-muted-foreground mt-2" data-testid="text-page-description">
          Crea y gestiona las guías de estilo para tus seudónimos
        </p>
      </div>

      <Tabs defaultValue="generate" className="space-y-6">
        <TabsList data-testid="tabs-list">
          <TabsTrigger value="generate" data-testid="tab-generate">
            <Sparkles className="h-4 w-4 mr-2" />
            Generar con IA
          </TabsTrigger>
          <TabsTrigger value="create" data-testid="tab-create">
            <Plus className="h-4 w-4 mr-2" />
            {isEditing ? "Editar Guía" : "Crear Manual"}
          </TabsTrigger>
          <TabsTrigger value="list" data-testid="tab-list">
            <FileText className="h-4 w-4 mr-2" />
            Guías ({allStyleGuides.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="generate">
          {!generatedGuide ? (
            <Form {...generateForm}>
              <form onSubmit={generateForm.handleSubmit(onGenerateSubmit, onGenerateFormError)} className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Sparkles className="h-5 w-5" />
                      Generar Guía de Estilo con IA
                    </CardTitle>
                    <CardDescription>
                      Genera automáticamente una guía de estilo basada en el estilo de un autor conocido
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <FormField
                      control={generateForm.control}
                      name="referenceAuthor"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Autor de referencia</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              data-testid="input-reference-author"
                              placeholder="Ej: Stephen King, Gillian Flynn, Paula Hawkins..."
                            />
                          </FormControl>
                          <FormDescription>
                            El estilo de este autor servirá como base para la guía
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={generateForm.control}
                      name="pseudonymName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Nombre del seudónimo</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              data-testid="input-pseudonym-name"
                              placeholder="Ej: Elena Blackwood"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={generateForm.control}
                      name="genre"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Género objetivo (opcional)</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger data-testid="select-genre">
                                <SelectValue placeholder="Selecciona un género" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="none">Sin especificar</SelectItem>
                              <SelectItem value="thriller">Thriller / Suspense</SelectItem>
                              <SelectItem value="psychological-thriller">Thriller Psicológico</SelectItem>
                              <SelectItem value="domestic-thriller">Thriller Doméstico</SelectItem>
                              <SelectItem value="romance">Romance Contemporáneo</SelectItem>
                              <SelectItem value="historical-romance">Romance Histórico</SelectItem>
                              <SelectItem value="dark-romance">Dark Romance</SelectItem>
                              <SelectItem value="paranormal-romance">Romance Paranormal</SelectItem>
                              <SelectItem value="romantasy">Romantasy</SelectItem>
                              <SelectItem value="mafia-romance">Mafia Romance</SelectItem>
                              <SelectItem value="fantasy">Fantasía Épica</SelectItem>
                              <SelectItem value="urban-fantasy">Fantasía Urbana</SelectItem>
                              <SelectItem value="grimdark">Fantasía Oscura (Grimdark)</SelectItem>
                              <SelectItem value="sci-fi">Ciencia Ficción</SelectItem>
                              <SelectItem value="space-opera">Space Opera</SelectItem>
                              <SelectItem value="dystopia">Distopía / Post-apocalíptico</SelectItem>
                              <SelectItem value="horror">Terror / Horror</SelectItem>
                              <SelectItem value="psychological-horror">Terror Psicológico</SelectItem>
                              <SelectItem value="mystery">Misterio</SelectItem>
                              <SelectItem value="cozy-mystery">Cozy Mystery</SelectItem>
                              <SelectItem value="crime-noir">Crime Fiction / Noir</SelectItem>
                              <SelectItem value="historical">Ficción Histórica</SelectItem>
                              <SelectItem value="literary">Literaria</SelectItem>
                              <SelectItem value="young-adult">Young Adult (YA)</SelectItem>
                              <SelectItem value="new-adult">New Adult (NA)</SelectItem>
                              <SelectItem value="erotic">Erótico</SelectItem>
                              <SelectItem value="litrpg">LitRPG / GameLit</SelectItem>
                              <SelectItem value="women-fiction">Women's Fiction</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={generateForm.control}
                      name="additionalNotes"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Notas adicionales (opcional)</FormLabel>
                          <FormControl>
                            <Textarea
                              {...field}
                              data-testid="input-additional-notes"
                              placeholder="Instrucciones específicas: qué aspectos enfatizar, qué evitar, preferencias particulares..."
                              className="min-h-[100px]"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={generateForm.control}
                      name="createPseudonym"
                      render={({ field }) => (
                        <FormItem className="flex items-center space-x-2">
                          <FormControl>
                            <Switch
                              data-testid="switch-create-pseudonym-gen"
                              checked={field.value}
                              onCheckedChange={field.onChange}
                            />
                          </FormControl>
                          <FormLabel className="!mt-0">Crear nuevo seudónimo automáticamente</FormLabel>
                        </FormItem>
                      )}
                    />

                    {!generateCreatePseudonym && (
                      <FormField
                        control={generateForm.control}
                        name="pseudonymId"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Asignar a seudónimo existente</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value}>
                              <FormControl>
                                <SelectTrigger data-testid="select-pseudonym-gen">
                                  <SelectValue placeholder="Selecciona un seudónimo" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="none">Selecciona un seudónimo</SelectItem>
                                {pseudonyms.map((p) => (
                                  <SelectItem key={p.id} value={p.id.toString()}>
                                    {p.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    )}

                    <FormField
                      control={generateForm.control}
                      name="saveGuide"
                      render={({ field }) => (
                        <FormItem className="flex items-center space-x-2">
                          <FormControl>
                            <Switch
                              data-testid="switch-save-guide"
                              checked={field.value}
                              onCheckedChange={field.onChange}
                            />
                          </FormControl>
                          <FormLabel className="!mt-0">Guardar guía automáticamente</FormLabel>
                        </FormItem>
                      )}
                    />
                  </CardContent>
                </Card>

                <Button
                  type="submit"
                  size="lg"
                  className="w-full"
                  data-testid="button-generate-style"
                  disabled={generateStyleGuideMutation.isPending}
                >
                  {generateStyleGuideMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                      Analizando estilo y generando guía...
                    </>
                  ) : (
                    <>
                      <Sparkles className="mr-2 h-5 w-5" />
                      Generar Guía de Estilo
                    </>
                  )}
                </Button>
              </form>
            </Form>
          ) : (
            <div className="space-y-6">
              <Card className="border-green-500/50 bg-green-500/5">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-green-600 dark:text-green-400">
                    <Check className="h-6 w-6" />
                    Guía de Estilo Generada
                  </CardTitle>
                  <CardDescription>
                    Basada en el estilo de {generateForm.getValues("referenceAuthor")}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      data-testid="button-download-generated"
                      onClick={() => {
                        const blob = new Blob([generatedGuide], { type: "text/markdown" });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = `guia_estilo_${generateForm.getValues("pseudonymName").toLowerCase().replace(/\s+/g, "_")}.md`;
                        a.click();
                        URL.revokeObjectURL(url);
                      }}
                    >
                      <Download className="mr-2 h-4 w-4" />
                      Descargar
                    </Button>
                    <Button
                      variant="ghost"
                      data-testid="button-new-generation"
                      onClick={resetGenerateForm}
                    >
                      Generar otra guía
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Contenido de la Guía</CardTitle>
                </CardHeader>
                <CardContent>
                  <Tabs defaultValue="preview" className="w-full">
                    <TabsList className="mb-4">
                      <TabsTrigger value="preview">Vista Previa</TabsTrigger>
                      <TabsTrigger value="code">Código Markdown</TabsTrigger>
                    </TabsList>
                    <TabsContent value="preview">
                      <div className="prose prose-sm dark:prose-invert max-w-none max-h-[500px] overflow-y-auto bg-muted/30 p-4 rounded-lg">
                        <ReactMarkdown>{generatedGuide || ""}</ReactMarkdown>
                      </div>
                    </TabsContent>
                    <TabsContent value="code">
                      <div className="max-h-[500px] overflow-y-auto">
                        <pre className="whitespace-pre-wrap text-sm font-mono bg-muted p-4 rounded-lg">
                          {generatedGuide}
                        </pre>
                      </div>
                    </TabsContent>
                  </Tabs>
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>

        <TabsContent value="create">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit, onFormError)} className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>
                    {isEditing ? "Editar Guía de Estilo" : "Nueva Guía de Estilo"}
                  </CardTitle>
                  <CardDescription>
                    Define el estilo literario, voz narrativa y preferencias de escritura
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <FormField
                    control={form.control}
                    name="title"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Título de la guía</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            data-testid="input-title"
                            placeholder="Ej: Estilo Thriller Psicológico"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {!isEditing && (
                    <>
                      <FormField
                        control={form.control}
                        name="createNewPseudonym"
                        render={({ field }) => (
                          <FormItem className="flex items-center space-x-2">
                            <FormControl>
                              <Switch
                                data-testid="switch-create-pseudonym"
                                checked={field.value}
                                onCheckedChange={field.onChange}
                              />
                            </FormControl>
                            <FormLabel className="!mt-0">Crear nuevo seudónimo</FormLabel>
                          </FormItem>
                        )}
                      />

                      {createNewPseudonym ? (
                        <FormField
                          control={form.control}
                          name="newPseudonymName"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Nombre del nuevo seudónimo</FormLabel>
                              <FormControl>
                                <Input
                                  {...field}
                                  data-testid="input-new-pseudonym"
                                  placeholder="Ej: Elena Blackwood"
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      ) : (
                        <FormField
                          control={form.control}
                          name="pseudonymId"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Asignar a seudónimo</FormLabel>
                              <Select onValueChange={field.onChange} value={field.value}>
                                <FormControl>
                                  <SelectTrigger data-testid="select-pseudonym">
                                    <SelectValue placeholder="Selecciona un seudónimo" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  <SelectItem value="none" data-testid="option-pseudonym-none">
                                    Selecciona un seudónimo
                                  </SelectItem>
                                  {pseudonyms.map((p) => (
                                    <SelectItem
                                      key={p.id}
                                      value={p.id.toString()}
                                      data-testid={`option-pseudonym-${p.id}`}
                                    >
                                      {p.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <FormDescription>
                                La guía se asociará a este seudónimo
                              </FormDescription>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      )}
                    </>
                  )}

                  <FormField
                    control={form.control}
                    name="isActive"
                    render={({ field }) => (
                      <FormItem className="flex items-center space-x-2">
                        <FormControl>
                          <Switch
                            data-testid="switch-active"
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                        <FormLabel className="!mt-0">Guía activa (se usará en generación)</FormLabel>
                      </FormItem>
                    )}
                  />

                  <div className="flex justify-end">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleUseTemplate}
                      data-testid="button-use-template"
                    >
                      <Copy className="h-4 w-4 mr-2" />
                      Usar Plantilla
                    </Button>
                  </div>

                  <FormField
                    control={form.control}
                    name="content"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Contenido de la guía</FormLabel>
                        <FormControl>
                          <Textarea
                            {...field}
                            data-testid="input-content"
                            placeholder="Escribe o pega aquí el contenido de la guía de estilo..."
                            className="min-h-[400px] font-mono text-sm"
                          />
                        </FormControl>
                        <FormDescription>
                          {field.value?.length || 0} caracteres
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </CardContent>
              </Card>

              <div className="flex gap-2">
                {isEditing && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleCancelEdit}
                    data-testid="button-cancel-edit"
                  >
                    Cancelar
                  </Button>
                )}
                <Button
                  type="submit"
                  className="flex-1"
                  data-testid="button-save"
                  disabled={createStyleGuideMutation.isPending || updateStyleGuideMutation.isPending}
                >
                  {createStyleGuideMutation.isPending || updateStyleGuideMutation.isPending ? (
                    "Guardando..."
                  ) : isEditing ? (
                    <>
                      <Check className="h-4 w-4 mr-2" />
                      Guardar Cambios
                    </>
                  ) : (
                    <>
                      <Plus className="h-4 w-4 mr-2" />
                      Crear Guía de Estilo
                    </>
                  )}
                </Button>
              </div>
            </form>
          </Form>
        </TabsContent>

        <TabsContent value="list">
          <Card>
            <CardHeader>
              <CardTitle>Guías de Estilo Existentes</CardTitle>
              <CardDescription>
                Todas las guías de estilo organizadas por seudónimo
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="text-center py-8 text-muted-foreground">
                  Cargando guías...
                </div>
              ) : allStyleGuides.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground" data-testid="text-no-guides">
                  No hay guías de estilo. Crea la primera usando la pestaña "Crear Guía".
                </div>
              ) : (
                <div className="space-y-4">
                  {allStyleGuides.map((guide) => (
                    <div
                      key={guide.id}
                      className="flex items-center justify-between p-4 border rounded-lg"
                      data-testid={`guide-item-${guide.id}`}
                    >
                      <div className="flex items-center gap-4">
                        <FileText className="h-5 w-5 text-muted-foreground" />
                        <div>
                          <div className="font-medium flex items-center gap-2">
                            {guide.title}
                            {guide.isActive && (
                              <Badge variant="default" className="text-xs">
                                Activa
                              </Badge>
                            )}
                          </div>
                          <div className="text-sm text-muted-foreground flex items-center gap-2">
                            <User className="h-3 w-3" />
                            {getPseudonymName(guide.pseudonymId)}
                            <span className="text-xs">
                              ({guide.content.length.toLocaleString()} caracteres)
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Dialog open={viewDialogOpen && selectedGuide?.id === guide.id} onOpenChange={(open) => {
                          setViewDialogOpen(open);
                          if (!open) setSelectedGuide(null);
                        }}>
                          <DialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              data-testid={`button-view-${guide.id}`}
                              onClick={() => {
                                setSelectedGuide(guide);
                                setViewDialogOpen(true);
                              }}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
                            <DialogHeader>
                              <DialogTitle>{guide.title}</DialogTitle>
                              <DialogDescription>
                                Seudónimo: {getPseudonymName(guide.pseudonymId)}
                              </DialogDescription>
                            </DialogHeader>
                            <pre className="whitespace-pre-wrap text-sm font-mono bg-muted p-4 rounded-lg">
                              {guide.content}
                            </pre>
                          </DialogContent>
                        </Dialog>
                        <Button
                          variant="ghost"
                          size="icon"
                          data-testid={`button-edit-${guide.id}`}
                          onClick={() => handleEditGuide(guide)}
                        >
                          <Edit2 className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          data-testid={`button-download-${guide.id}`}
                          onClick={() => handleDownloadGuide(guide)}
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          data-testid={`button-delete-${guide.id}`}
                          onClick={() => deleteStyleGuideMutation.mutate(guide.id)}
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
        </TabsContent>
      </Tabs>
    </div>
  );
}
