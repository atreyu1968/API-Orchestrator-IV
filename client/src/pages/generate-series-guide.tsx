import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Library, FileText, CheckCircle, BookMarked } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface Pseudonym {
  id: number;
  name: string;
  defaultGenre?: string;
  defaultTone?: string;
}

const formSchema = z.object({
  seriesTitle: z.string().min(1, "El título de la serie es requerido"),
  concept: z.string().min(50, "El concepto debe tener al menos 50 caracteres"),
  genre: z.string().default("thriller"),
  tone: z.string().default("tenso"),
  bookCount: z.number().min(2, "Mínimo 2 libros").max(20, "Máximo 20 libros"),
  workType: z.enum(["series", "trilogy"]).default("trilogy"),
  pseudonymId: z.string().optional(),
  createSeries: z.boolean().default(true),
});

type FormData = z.infer<typeof formSchema>;

export default function GenerateSeriesGuidePage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  
  const [generatedGuide, setGeneratedGuide] = useState<string | null>(null);
  const [createdSeriesId, setCreatedSeriesId] = useState<number | null>(null);

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      seriesTitle: "",
      concept: "",
      genre: "thriller",
      tone: "tenso",
      bookCount: 3,
      workType: "trilogy",
      pseudonymId: "",
      createSeries: true,
    },
  });

  const { data: pseudonyms = [] } = useQuery<Pseudonym[]>({
    queryKey: ["/api/pseudonyms"],
  });

  const generateMutation = useMutation({
    mutationFn: async (data: FormData) => {
      const response = await apiRequest("POST", "/api/generate-series-guide", {
        ...data,
        pseudonymId: data.pseudonymId && data.pseudonymId !== "none" ? parseInt(data.pseudonymId) : undefined,
      });
      return response.json();
    },
    onSuccess: (data) => {
      setGeneratedGuide(data.guideContent);
      setCreatedSeriesId(data.seriesId);
      queryClient.invalidateQueries({ queryKey: ["/api/series"] });
      toast({
        title: "Guía de serie generada",
        description: data.message,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: FormData) => {
    generateMutation.mutate(data);
  };

  const handlePseudonymChange = (value: string) => {
    form.setValue("pseudonymId", value);
    const pseudonym = pseudonyms.find(p => p.id.toString() === value);
    if (pseudonym) {
      if (pseudonym.defaultGenre) {
        form.setValue("genre", pseudonym.defaultGenre);
      }
      if (pseudonym.defaultTone) {
        form.setValue("tone", pseudonym.defaultTone);
      }
    }
  };

  const resetForm = () => {
    setGeneratedGuide(null);
    setCreatedSeriesId(null);
    form.reset();
  };

  const conceptLength = form.watch("concept")?.length || 0;
  const workType = form.watch("workType");

  return (
    <div className="container mx-auto px-6 py-6 max-w-4xl">
      <div className="mb-6" data-testid="page-header">
        <h1 className="text-3xl font-bold flex items-center gap-2" data-testid="text-page-title">
          <Library className="h-8 w-8 text-primary" />
          Generador de Guías de Serie
        </h1>
        <p className="text-muted-foreground mt-2" data-testid="text-page-description">
          Genera automáticamente una guía editorial completa para una serie de novelas
        </p>
      </div>

      {!generatedGuide ? (
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BookMarked className="h-5 w-5" />
                  Datos de la Serie
                </CardTitle>
                <CardDescription>
                  Define el concepto y la estructura de tu serie
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name="seriesTitle"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Título de la serie</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          data-testid="input-series-title"
                          placeholder="Ej: Los Crímenes de Lakeland"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="concept"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Concepto de la serie</FormLabel>
                      <FormControl>
                        <Textarea
                          {...field}
                          data-testid="input-concept"
                          placeholder="Describe el concepto general de la serie: el protagonista recurrente, el escenario, el tipo de casos/conflictos, el hilo conductor que unirá todos los libros..."
                          className="min-h-[200px]"
                        />
                      </FormControl>
                      <FormDescription>
                        {conceptLength} caracteres (mínimo 50)
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="genre"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Género</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger data-testid="select-genre">
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="thriller" data-testid="option-genre-thriller">Thriller</SelectItem>
                            <SelectItem value="police-procedural" data-testid="option-genre-procedural">Procedimental Policial</SelectItem>
                            <SelectItem value="cozy-mystery" data-testid="option-genre-cozy">Cozy Mystery</SelectItem>
                            <SelectItem value="romance" data-testid="option-genre-romance">Romance</SelectItem>
                            <SelectItem value="fantasy" data-testid="option-genre-fantasy">Fantasía</SelectItem>
                            <SelectItem value="sci-fi" data-testid="option-genre-scifi">Ciencia Ficción</SelectItem>
                            <SelectItem value="horror" data-testid="option-genre-horror">Terror</SelectItem>
                            <SelectItem value="historical" data-testid="option-genre-historical">Histórico</SelectItem>
                            <SelectItem value="urban-fantasy" data-testid="option-genre-urban">Fantasía Urbana</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="tone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Tono</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger data-testid="select-tone">
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="tenso" data-testid="option-tone-tenso">Tenso</SelectItem>
                            <SelectItem value="oscuro" data-testid="option-tone-oscuro">Oscuro</SelectItem>
                            <SelectItem value="atmosférico" data-testid="option-tone-atmosferico">Atmosférico</SelectItem>
                            <SelectItem value="ligero" data-testid="option-tone-ligero">Ligero</SelectItem>
                            <SelectItem value="dramático" data-testid="option-tone-dramatico">Dramático</SelectItem>
                            <SelectItem value="épico" data-testid="option-tone-epico">Épico</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="workType"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Tipo de serie</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger data-testid="select-work-type">
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="trilogy" data-testid="option-type-trilogy">Trilogía (3 libros)</SelectItem>
                            <SelectItem value="series" data-testid="option-type-series">Serie extendida</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="bookCount"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Número de libros</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            data-testid="input-book-count"
                            type="number"
                            min={2}
                            max={20}
                            onChange={(e) => field.onChange(parseInt(e.target.value) || 3)}
                          />
                        </FormControl>
                        <FormDescription>
                          {workType === "trilogy" ? "Típicamente 3" : "Típicamente 6-12"}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Autor</CardTitle>
                <CardDescription>
                  Asocia la serie a un seudónimo existente
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name="pseudonymId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Seudónimo</FormLabel>
                      <Select onValueChange={handlePseudonymChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-pseudonym">
                            <SelectValue placeholder="Selecciona un seudónimo (opcional)" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="none" data-testid="option-pseudonym-none">Sin seudónimo</SelectItem>
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
                        Si seleccionas un seudónimo con guía de estilo, se usará para personalizar la serie
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="createSeries"
                  render={({ field }) => (
                    <FormItem className="flex items-center space-x-2 pt-2">
                      <FormControl>
                        <Switch
                          data-testid="switch-create-series"
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                      <FormLabel className="!mt-0">Crear serie automáticamente</FormLabel>
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            <Button
              type="submit"
              size="lg"
              className="w-full"
              data-testid="button-generate"
              disabled={generateMutation.isPending}
            >
              {generateMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Generando guía de serie... (puede tardar 1-2 minutos)
                </>
              ) : (
                <>
                  <Library className="mr-2 h-5 w-5" />
                  Generar Guía de Serie
                </>
              )}
            </Button>
          </form>
        </Form>
      ) : (
        <div className="space-y-6">
          <Card className="border-green-500/50 bg-green-500/5">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-green-600 dark:text-green-400" data-testid="text-success-title">
                <CheckCircle className="h-6 w-6" />
                Guía de Serie Generada Exitosamente
              </CardTitle>
              {createdSeriesId && (
                <CardDescription data-testid="text-series-id">
                  Serie creada con ID: {createdSeriesId}
                </CardDescription>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                {createdSeriesId && (
                  <Button
                    data-testid="button-go-to-series"
                    onClick={() => setLocation("/series")}
                  >
                    <Library className="mr-2 h-4 w-4" />
                    Ir a Series
                  </Button>
                )}
                <Button
                  variant="outline"
                  data-testid="button-download-guide"
                  onClick={() => {
                    const blob = new Blob([generatedGuide], { type: "text/markdown" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `guia_serie_${form.getValues("seriesTitle").toLowerCase().replace(/\s+/g, "_")}.md`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  <FileText className="mr-2 h-4 w-4" />
                  Descargar Guía
                </Button>
                <Button
                  variant="ghost"
                  data-testid="button-new-guide"
                  onClick={resetForm}
                >
                  Generar otra guía
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2" data-testid="text-preview-title">
                <FileText className="h-5 w-5" />
                Vista previa de la guía
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="prose prose-sm dark:prose-invert max-w-none max-h-[600px] overflow-y-auto">
                <pre className="whitespace-pre-wrap text-sm font-mono bg-muted p-4 rounded-lg" data-testid="text-guide-content">
                  {generatedGuide}
                </pre>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
