import { useState, useEffect, useCallback } from "react";
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
import { Loader2, Library, FileText, CheckCircle, BookMarked, Save } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";

const FORM_STORAGE_KEY = "series-guide-form-draft";
const RESULT_STORAGE_KEY = "series-guide-result";
const GENERATION_STATUS_KEY = "series-guide-generation-status";

interface GenerationStatus {
  isGenerating: boolean;
  startedAt: number;
  seriesTitle: string;
  bookCount: number;
  autoGenerateBookGuides: boolean;
  currentStep: "guide" | "books" | "complete";
}

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
  autoGenerateBookGuides: z.boolean().default(false),
  chapterCountPerBook: z.number().min(10).max(50).default(30),
  hasPrologue: z.boolean().default(true),
  hasEpilogue: z.boolean().default(true),
  styleGuideId: z.string().optional(),
});

type FormData = z.infer<typeof formSchema>;

export default function GenerateSeriesGuidePage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  
  const [savedIndicator, setSavedIndicator] = useState(false);

  // Load saved form data and result from localStorage
  const loadSavedFormData = useCallback(() => {
    try {
      const saved = localStorage.getItem(FORM_STORAGE_KEY);
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (e) {
      console.error("Error loading saved form data:", e);
    }
    return null;
  }, []);

  const loadSavedResult = useCallback(() => {
    try {
      const saved = localStorage.getItem(RESULT_STORAGE_KEY);
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (e) {
      console.error("Error loading saved result:", e);
    }
    return null;
  }, []);

  const loadGenerationStatus = useCallback((): GenerationStatus | null => {
    try {
      const saved = localStorage.getItem(GENERATION_STATUS_KEY);
      if (saved) {
        const status = JSON.parse(saved) as GenerationStatus;
        // Check if generation is stale (more than 10 minutes old without completion)
        if (status.isGenerating && Date.now() - status.startedAt > 10 * 60 * 1000) {
          localStorage.removeItem(GENERATION_STATUS_KEY);
          return null;
        }
        return status;
      }
    } catch (e) {
      console.error("Error loading generation status:", e);
    }
    return null;
  }, []);

  const savedData = loadSavedFormData();
  const savedResult = loadSavedResult();
  const initialGenerationStatus = loadGenerationStatus();

  const [generatedGuide, setGeneratedGuide] = useState<string | null>(savedResult?.guide || null);
  const [createdSeriesId, setCreatedSeriesId] = useState<number | null>(savedResult?.seriesId || null);
  const [generationStatus, setGenerationStatus] = useState<GenerationStatus | null>(initialGenerationStatus);
  const [elapsedTime, setElapsedTime] = useState(0);

  // Update elapsed time during generation
  useEffect(() => {
    if (generationStatus?.isGenerating) {
      const interval = setInterval(() => {
        setElapsedTime(Math.floor((Date.now() - generationStatus.startedAt) / 1000));
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [generationStatus?.isGenerating, generationStatus?.startedAt]);

  const formatElapsedTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: savedData || {
      seriesTitle: "",
      concept: "",
      genre: "thriller",
      tone: "tenso",
      bookCount: 3,
      workType: "trilogy",
      pseudonymId: "",
      createSeries: true,
      autoGenerateBookGuides: false,
      chapterCountPerBook: 30,
      hasPrologue: true,
      hasEpilogue: true,
      styleGuideId: "",
    },
  });

  // Save form data to localStorage on changes
  const watchedValues = form.watch();
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      try {
        localStorage.setItem(FORM_STORAGE_KEY, JSON.stringify(watchedValues));
        setSavedIndicator(true);
        setTimeout(() => setSavedIndicator(false), 1500);
      } catch (e) {
        console.error("Error saving form data:", e);
      }
    }, 500);
    return () => clearTimeout(timeoutId);
  }, [watchedValues]);

  const { data: pseudonyms = [] } = useQuery<Pseudonym[]>({
    queryKey: ["/api/pseudonyms"],
  });

  const generateMutation = useMutation({
    mutationFn: async (data: FormData) => {
      // Set generation status before starting
      const status: GenerationStatus = {
        isGenerating: true,
        startedAt: Date.now(),
        seriesTitle: data.seriesTitle,
        bookCount: Number(data.bookCount),
        autoGenerateBookGuides: data.autoGenerateBookGuides,
        currentStep: "guide",
      };
      localStorage.setItem(GENERATION_STATUS_KEY, JSON.stringify(status));
      setGenerationStatus(status);
      setElapsedTime(0);

      const response = await apiRequest("POST", "/api/generate-series-guide", {
        ...data,
        bookCount: Number(data.bookCount),
        chapterCountPerBook: Number(data.chapterCountPerBook),
        pseudonymId: data.pseudonymId && data.pseudonymId !== "none" ? parseInt(data.pseudonymId) : undefined,
        styleGuideId: data.styleGuideId && data.styleGuideId !== "none" ? parseInt(data.styleGuideId) : undefined,
      });
      return response.json();
    },
    onSuccess: (data) => {
      setGeneratedGuide(data.guideContent);
      setCreatedSeriesId(data.seriesId);
      queryClient.invalidateQueries({ queryKey: ["/api/series"] });
      if (data.generatedBooks?.length > 0) {
        queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
        queryClient.invalidateQueries({ queryKey: ["/api/extended-guides"] });
      }
      // Clear generation status and form data, save result
      localStorage.removeItem(FORM_STORAGE_KEY);
      localStorage.removeItem(GENERATION_STATUS_KEY);
      setGenerationStatus(null);
      localStorage.setItem(RESULT_STORAGE_KEY, JSON.stringify({
        guide: data.guideContent,
        seriesId: data.seriesId,
        generatedBooks: data.generatedBooks,
      }));
      
      const booksCount = data.generatedBooks?.length || 0;
      toast({
        title: "Guía de serie generada exitosamente",
        description: booksCount > 0 
          ? `${data.message}. Se crearon ${booksCount} guías de libros.`
          : data.message,
        duration: 10000,
      });
    },
    onError: (error: Error) => {
      // Clear generation status on error
      localStorage.removeItem(GENERATION_STATUS_KEY);
      setGenerationStatus(null);
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
    localStorage.removeItem(FORM_STORAGE_KEY);
    localStorage.removeItem(RESULT_STORAGE_KEY);
    form.reset({
      seriesTitle: "",
      concept: "",
      genre: "thriller",
      tone: "tenso",
      bookCount: 3,
      workType: "trilogy",
      pseudonymId: "",
      createSeries: true,
      autoGenerateBookGuides: false,
      chapterCountPerBook: 30,
      hasPrologue: true,
      hasEpilogue: true,
      styleGuideId: "",
    });
  };

  const conceptLength = form.watch("concept")?.length || 0;
  const workType = form.watch("workType");

  return (
    <div className="container mx-auto px-6 py-6 max-w-4xl">
      <div className="mb-6" data-testid="page-header">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold flex items-center gap-2" data-testid="text-page-title">
            <Library className="h-8 w-8 text-primary" />
            Generador de Guías de Serie
          </h1>
          {savedIndicator && (
            <span className="text-sm text-muted-foreground flex items-center gap-1" data-testid="text-saved-indicator">
              <Save className="h-3 w-3" />
              Borrador guardado
            </span>
          )}
        </div>
        <p className="text-muted-foreground mt-2" data-testid="text-page-description">
          Genera automáticamente una guía editorial completa para una serie de novelas
          {savedData && !generatedGuide && (
            <span className="ml-2 text-sm text-primary">(Tienes un borrador guardado)</span>
          )}
        </p>
      </div>

      {generationStatus?.isGenerating ? (
        <Card className="border-primary">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              Generando Serie: {generationStatus.seriesTitle}
            </CardTitle>
            <CardDescription>
              Por favor espera mientras se genera la guía de serie y los libros
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Tiempo transcurrido:</span>
              <span className="font-mono font-bold text-lg">{formatElapsedTime(elapsedTime)}</span>
            </div>
            
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                  generationStatus.currentStep === "guide" 
                    ? "bg-primary text-primary-foreground animate-pulse" 
                    : "bg-green-500 text-white"
                }`}>
                  {generationStatus.currentStep === "guide" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle className="h-4 w-4" />
                  )}
                </div>
                <div className="flex-1">
                  <p className="font-medium">1. Generando guía de la serie</p>
                  <p className="text-sm text-muted-foreground">
                    Planificación editorial, personajes, tramas y estructura
                  </p>
                </div>
              </div>
              
              {generationStatus.autoGenerateBookGuides && (
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                    generationStatus.currentStep === "books" 
                      ? "bg-primary text-primary-foreground animate-pulse" 
                      : generationStatus.currentStep === "complete"
                        ? "bg-green-500 text-white"
                        : "bg-muted text-muted-foreground"
                  }`}>
                    {generationStatus.currentStep === "books" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : generationStatus.currentStep === "complete" ? (
                      <CheckCircle className="h-4 w-4" />
                    ) : (
                      <span className="text-sm">2</span>
                    )}
                  </div>
                  <div className="flex-1">
                    <p className="font-medium">2. Generando guías de {generationStatus.bookCount} libros</p>
                    <p className="text-sm text-muted-foreground">
                      Guías individuales y proyectos para cada volumen
                    </p>
                  </div>
                </div>
              )}
            </div>
            
            <div className="bg-muted/50 p-4 rounded-lg">
              <p className="text-sm text-muted-foreground text-center">
                Puedes cambiar de pantalla, el progreso se mantendrá.
                {generationStatus.autoGenerateBookGuides && (
                  <span className="block mt-1">
                    La generación de {generationStatus.bookCount} guías puede tomar varios minutos.
                  </span>
                )}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : !generatedGuide ? (
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
                            <SelectItem value="thriller" data-testid="option-genre-thriller">Thriller / Suspense</SelectItem>
                            <SelectItem value="psychological-thriller" data-testid="option-genre-psych-thriller">Thriller Psicológico</SelectItem>
                            <SelectItem value="police-procedural" data-testid="option-genre-procedural">Thriller Policial</SelectItem>
                            <SelectItem value="domestic-thriller" data-testid="option-genre-domestic">Thriller Doméstico</SelectItem>
                            <SelectItem value="romance" data-testid="option-genre-romance">Romance Contemporáneo</SelectItem>
                            <SelectItem value="historical-romance" data-testid="option-genre-hist-romance">Romance Histórico</SelectItem>
                            <SelectItem value="dark-romance" data-testid="option-genre-dark-romance">Dark Romance</SelectItem>
                            <SelectItem value="paranormal-romance" data-testid="option-genre-para-romance">Romance Paranormal</SelectItem>
                            <SelectItem value="romantasy" data-testid="option-genre-romantasy">Romantasy</SelectItem>
                            <SelectItem value="mafia-romance" data-testid="option-genre-mafia">Mafia Romance</SelectItem>
                            <SelectItem value="fantasy" data-testid="option-genre-fantasy">Fantasía Épica</SelectItem>
                            <SelectItem value="urban-fantasy" data-testid="option-genre-urban">Fantasía Urbana</SelectItem>
                            <SelectItem value="grimdark" data-testid="option-genre-grimdark">Fantasía Oscura (Grimdark)</SelectItem>
                            <SelectItem value="sci-fi" data-testid="option-genre-scifi">Ciencia Ficción</SelectItem>
                            <SelectItem value="space-opera" data-testid="option-genre-space">Space Opera</SelectItem>
                            <SelectItem value="dystopia" data-testid="option-genre-dystopia">Distopía / Post-apocalíptico</SelectItem>
                            <SelectItem value="horror" data-testid="option-genre-horror">Terror / Horror</SelectItem>
                            <SelectItem value="psychological-horror" data-testid="option-genre-psych-horror">Terror Psicológico</SelectItem>
                            <SelectItem value="mystery" data-testid="option-genre-mystery">Misterio</SelectItem>
                            <SelectItem value="cozy-mystery" data-testid="option-genre-cozy">Cozy Mystery</SelectItem>
                            <SelectItem value="crime-noir" data-testid="option-genre-noir">Crime Fiction / Noir</SelectItem>
                            <SelectItem value="historical" data-testid="option-genre-historical">Ficción Histórica</SelectItem>
                            <SelectItem value="literary" data-testid="option-genre-literary">Literaria</SelectItem>
                            <SelectItem value="young-adult" data-testid="option-genre-ya">Young Adult (YA)</SelectItem>
                            <SelectItem value="new-adult" data-testid="option-genre-na">New Adult (NA)</SelectItem>
                            <SelectItem value="erotic" data-testid="option-genre-erotic">Erótico</SelectItem>
                            <SelectItem value="litrpg" data-testid="option-genre-litrpg">LitRPG / GameLit</SelectItem>
                            <SelectItem value="women-fiction" data-testid="option-genre-women">Women's Fiction</SelectItem>
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

                <FormField
                  control={form.control}
                  name="autoGenerateBookGuides"
                  render={({ field }) => (
                    <FormItem className="flex items-center space-x-2 pt-2">
                      <FormControl>
                        <Switch
                          data-testid="switch-auto-generate-books"
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          disabled={!form.watch("createSeries")}
                        />
                      </FormControl>
                      <FormLabel className="!mt-0">
                        Generar guías de todos los libros automáticamente
                      </FormLabel>
                      <FormDescription className="text-xs">
                        Crea automáticamente las guías y proyectos para cada volumen de la serie
                      </FormDescription>
                    </FormItem>
                  )}
                />

                {form.watch("autoGenerateBookGuides") && (
                  <div className="space-y-4 pt-4 border-t mt-4">
                    <p className="text-sm font-medium text-muted-foreground">Configuración de libros</p>
                    
                    <FormField
                      control={form.control}
                      name="chapterCountPerBook"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Capítulos por libro</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              min={10}
                              max={50}
                              data-testid="input-chapters-per-book"
                              {...field}
                              onChange={(e) => field.onChange(parseInt(e.target.value) || 30)}
                            />
                          </FormControl>
                        </FormItem>
                      )}
                    />

                    <div className="flex gap-6">
                      <FormField
                        control={form.control}
                        name="hasPrologue"
                        render={({ field }) => (
                          <FormItem className="flex items-center space-x-2">
                            <FormControl>
                              <Switch
                                data-testid="switch-prologue"
                                checked={field.value}
                                onCheckedChange={field.onChange}
                              />
                            </FormControl>
                            <FormLabel className="!mt-0">Prólogo</FormLabel>
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="hasEpilogue"
                        render={({ field }) => (
                          <FormItem className="flex items-center space-x-2">
                            <FormControl>
                              <Switch
                                data-testid="switch-epilogue"
                                checked={field.value}
                                onCheckedChange={field.onChange}
                              />
                            </FormControl>
                            <FormLabel className="!mt-0">Epílogo</FormLabel>
                          </FormItem>
                        )}
                      />
                    </div>
                  </div>
                )}
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
