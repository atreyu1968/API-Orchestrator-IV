import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { Play, RotateCcw, BookOpen, FileText, ScrollText, User, Library, BookMarked } from "lucide-react";
import type { Pseudonym, StyleGuide, Series, ExtendedGuide } from "@shared/schema";

const genres = [
  { value: "fantasy", label: "Fantasía", description: "Mundos mágicos y criaturas sobrenaturales" },
  { value: "scifi", label: "Ciencia Ficción", description: "Futuros tecnológicos y exploración espacial" },
  { value: "thriller", label: "Thriller", description: "Suspense y tensión narrativa" },
  { value: "historical_thriller", label: "Thriller Histórico", description: "Suspense en contextos históricos" },
  { value: "romance", label: "Romance", description: "Relaciones y conexiones emocionales" },
  { value: "horror", label: "Horror", description: "Terror y elementos sobrenaturales" },
  { value: "mystery", label: "Misterio", description: "Investigación y resolución de enigmas" },
  { value: "literary", label: "Literaria", description: "Exploración de la condición humana" },
  { value: "historical", label: "Histórica", description: "Narrativas en contextos del pasado" },
  { value: "adventure", label: "Aventura", description: "Viajes y descubrimientos épicos" },
];

const tones = [
  { value: "dramatic", label: "Dramático", description: "Emociones intensas y conflictos profundos" },
  { value: "dark", label: "Oscuro", description: "Atmósfera sombría y temas maduros" },
  { value: "satirical", label: "Satírico", description: "Crítica social con humor mordaz" },
  { value: "lyrical", label: "Lírico", description: "Prosa poética y descriptiva" },
  { value: "minimalist", label: "Minimalista", description: "Estilo conciso y directo" },
  { value: "epic", label: "Épico", description: "Grandeza y eventos monumentales" },
  { value: "intimate", label: "Íntimo", description: "Cercanía emocional con los personajes" },
  { value: "suspenseful", label: "Tenso", description: "Mantiene al lector en vilo" },
];

const workTypes = [
  { value: "standalone", label: "Obra Independiente", description: "Una novela autónoma sin continuación" },
  { value: "series", label: "Serie", description: "Parte de una serie de libros" },
  { value: "trilogy", label: "Trilogía", description: "Parte de una trilogía de 3 libros" },
];

const configSchema = z.object({
  title: z.string().min(1, "El título es requerido").max(100),
  premise: z.string().min(10, "Describe la idea de tu novela (mínimo 10 caracteres)").max(2000).or(z.string().length(0)),
  genre: z.string().min(1, "Selecciona un género"),
  tone: z.string().min(1, "Selecciona un tono"),
  chapterCount: z.number().min(1).max(100),
  hasPrologue: z.boolean().default(false),
  hasEpilogue: z.boolean().default(false),
  hasAuthorNote: z.boolean().default(false),
  pseudonymId: z.number().nullable().optional(),
  styleGuideId: z.number().nullable().optional(),
  extendedGuideId: z.number().nullable().optional(),
  workType: z.string().default("standalone"),
  seriesId: z.number().nullable().optional(),
  seriesOrder: z.number().nullable().optional(),
  minWordCount: z.number().min(0).nullable().optional(),
});

type ConfigFormData = z.infer<typeof configSchema>;

interface ConfigPanelProps {
  onSubmit: (data: ConfigFormData) => void;
  onReset?: () => void;
  isLoading?: boolean;
  defaultValues?: Partial<ConfigFormData>;
  isEditing?: boolean;
}

export function ConfigPanel({ onSubmit, onReset, isLoading, defaultValues, isEditing }: ConfigPanelProps) {
  const form = useForm<ConfigFormData>({
    resolver: zodResolver(configSchema),
    defaultValues: {
      title: defaultValues?.title || "",
      premise: (defaultValues as any)?.premise || "",
      genre: defaultValues?.genre || "fantasy",
      tone: defaultValues?.tone || "dramatic",
      chapterCount: defaultValues?.chapterCount || 10,
      hasPrologue: defaultValues?.hasPrologue || false,
      hasEpilogue: defaultValues?.hasEpilogue || false,
      hasAuthorNote: defaultValues?.hasAuthorNote || false,
      pseudonymId: defaultValues?.pseudonymId || null,
      styleGuideId: defaultValues?.styleGuideId || null,
      extendedGuideId: (defaultValues as any)?.extendedGuideId || null,
      workType: (defaultValues as any)?.workType || "standalone",
      seriesId: (defaultValues as any)?.seriesId || null,
      seriesOrder: (defaultValues as any)?.seriesOrder || null,
      minWordCount: (defaultValues as any)?.minWordCount || null,
    },
  });

  const chapterCount = form.watch("chapterCount");
  const minWordCount = form.watch("minWordCount");
  const hasPrologue = form.watch("hasPrologue");
  const hasEpilogue = form.watch("hasEpilogue");
  const hasAuthorNote = form.watch("hasAuthorNote");
  const selectedPseudonymId = form.watch("pseudonymId");
  const selectedWorkType = form.watch("workType");
  const selectedSeriesId = form.watch("seriesId");

  const totalSections = chapterCount + (hasPrologue ? 1 : 0) + (hasEpilogue ? 1 : 0) + (hasAuthorNote ? 1 : 0);

  const { data: pseudonyms = [] } = useQuery<Pseudonym[]>({
    queryKey: ["/api/pseudonyms"],
  });

  const { data: styleGuides = [] } = useQuery<StyleGuide[]>({
    queryKey: ["/api/pseudonyms", selectedPseudonymId, "style-guides"],
    enabled: !!selectedPseudonymId && selectedPseudonymId > 0,
  });

  const { data: allSeries = [] } = useQuery<Series[]>({
    queryKey: ["/api/series"],
  });

  const { data: extendedGuides = [] } = useQuery<ExtendedGuide[]>({
    queryKey: ["/api/extended-guides"],
  });

  const selectedExtendedGuideId = form.watch("extendedGuideId");
  const isSerialized = selectedWorkType === "series" || selectedWorkType === "trilogy";

  return (
    <Form {...form}>
      <form 
        onSubmit={form.handleSubmit(onSubmit)} 
        className="space-y-6"
        data-testid="config-form"
      >
        <FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Título del Proyecto</FormLabel>
              <FormControl>
                <Input 
                  placeholder="La última esperanza..." 
                  {...field}
                  data-testid="input-project-title"
                />
              </FormControl>
              <FormDescription>
                El título de tu novela o manuscrito
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="premise"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Idea / Premisa de la Novela</FormLabel>
              <FormControl>
                <Textarea 
                  placeholder="Describe la idea central de tu novela: ¿De qué trata? ¿Quién es el protagonista? ¿Cuál es el conflicto principal? ¿En qué época y lugar transcurre?"
                  className="min-h-[120px]"
                  {...field}
                  data-testid="input-project-premise"
                />
              </FormControl>
              <FormDescription>
                {selectedExtendedGuideId 
                  ? "La guía extendida seleccionada proporcionará la premisa completa. Puedes dejar este campo vacío."
                  : "Esta premisa guiará a los agentes para diseñar la trama, personajes y mundo de tu novela"}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="extendedGuideId"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="flex items-center gap-2">
                <FileText className="h-4 w-4" />
                Guía Extendida (Opcional)
              </FormLabel>
              <Select
                onValueChange={(val) => field.onChange(val === "none" ? null : parseInt(val))}
                value={field.value?.toString() || "none"}
              >
                <FormControl>
                  <SelectTrigger data-testid="select-extended-guide">
                    <SelectValue placeholder="Sin guía extendida" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="none">Sin guía extendida</SelectItem>
                  {extendedGuides.map((guide) => (
                    <SelectItem key={guide.id} value={guide.id.toString()}>
                      <div className="flex flex-col">
                        <span>{guide.title}</span>
                        <span className="text-xs text-muted-foreground">
                          {guide.wordCount?.toLocaleString()} palabras
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormDescription>
                Sube una guía de escritura extendida en Word que sustituya o complemente la premisa
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="genre"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Género</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <FormControl>
                  <SelectTrigger data-testid="select-genre">
                    <SelectValue placeholder="Selecciona un género" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {genres.map((genre) => (
                    <SelectItem key={genre.value} value={genre.value}>
                      <div className="flex flex-col">
                        <span>{genre.label}</span>
                        <span className="text-xs text-muted-foreground">{genre.description}</span>
                      </div>
                    </SelectItem>
                  ))}
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
              <FormLabel>Tono Narrativo</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <FormControl>
                  <SelectTrigger data-testid="select-tone">
                    <SelectValue placeholder="Selecciona un tono" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {tones.map((tone) => (
                    <SelectItem key={tone.value} value={tone.value}>
                      <div className="flex flex-col">
                        <span>{tone.label}</span>
                        <span className="text-xs text-muted-foreground">{tone.description}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="space-y-4 pt-2 border-t">
          <div className="flex items-center gap-2 pt-4">
            <Library className="h-4 w-4 text-muted-foreground" />
            <FormLabel className="text-base mb-0">Tipo de Obra</FormLabel>
          </div>
          
          <FormField
            control={form.control}
            name="workType"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Clasificación</FormLabel>
                <Select 
                  onValueChange={(value) => {
                    field.onChange(value);
                    if (value === "standalone") {
                      form.setValue("seriesId", null);
                      form.setValue("seriesOrder", null);
                    }
                  }} 
                  value={field.value || "standalone"}
                >
                  <FormControl>
                    <SelectTrigger data-testid="select-work-type">
                      <SelectValue placeholder="Selecciona tipo de obra" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {workTypes.map((wt) => (
                      <SelectItem key={wt.value} value={wt.value}>
                        <div className="flex flex-col">
                          <span>{wt.label}</span>
                          <span className="text-xs text-muted-foreground">{wt.description}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormDescription>
                  Define si esta novela es parte de una serie o trilogía
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          {isSerialized && (
            <>
              <FormField
                control={form.control}
                name="seriesId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Serie / Saga</FormLabel>
                    <Select 
                      onValueChange={(value) => field.onChange(value === "none" ? null : parseInt(value))} 
                      value={field.value?.toString() || "none"}
                    >
                      <FormControl>
                        <SelectTrigger data-testid="select-series">
                          <SelectValue placeholder="Selecciona o crea una serie" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">Ninguna (crear nueva después)</SelectItem>
                        {allSeries.map((s) => (
                          <SelectItem key={s.id} value={s.id.toString()}>
                            <div className="flex items-center gap-2">
                              <BookMarked className="h-3 w-3" />
                              <span>{s.title}</span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      Agrupa novelas en una serie para mantener continuidad narrativa
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="seriesOrder"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Orden en la Serie</FormLabel>
                    <FormControl>
                      <Input 
                        type="number"
                        min={1}
                        placeholder="1, 2, 3..."
                        value={field.value || ""}
                        onChange={(e) => field.onChange(e.target.value ? parseInt(e.target.value) : null)}
                        data-testid="input-series-order"
                      />
                    </FormControl>
                    <FormDescription>
                      Posición de esta novela dentro de la serie (1 = primera, 2 = segunda, etc.)
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </>
          )}
        </div>

        <div className="space-y-4 pt-2 border-t">
          <div className="flex items-center gap-2 pt-4">
            <User className="h-4 w-4 text-muted-foreground" />
            <FormLabel className="text-base mb-0">Identidad del Autor</FormLabel>
          </div>
          
          <FormField
            control={form.control}
            name="pseudonymId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Pseudónimo (Opcional)</FormLabel>
                <Select 
                  onValueChange={(value) => {
                    field.onChange(value === "none" ? null : parseInt(value));
                    form.setValue("styleGuideId", null);
                  }} 
                  value={field.value?.toString() || "none"}
                >
                  <FormControl>
                    <SelectTrigger data-testid="select-pseudonym">
                      <SelectValue placeholder="Selecciona un pseudónimo" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="none">Sin pseudónimo</SelectItem>
                    {pseudonyms.map((p) => (
                      <SelectItem key={p.id} value={p.id.toString()}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormDescription>
                  Asocia una identidad de autor al proyecto
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          {selectedPseudonymId && styleGuides.length > 0 && (
            <FormField
              control={form.control}
              name="styleGuideId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Guía de Estilo</FormLabel>
                  <Select 
                    onValueChange={(value) => field.onChange(value === "none" ? null : parseInt(value))} 
                    value={field.value?.toString() || "none"}
                  >
                    <FormControl>
                      <SelectTrigger data-testid="select-style-guide">
                        <SelectValue placeholder="Selecciona una guía de estilo" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="none">Sin guía específica</SelectItem>
                      {styleGuides.map((sg) => (
                        <SelectItem key={sg.id} value={sg.id.toString()}>
                          {sg.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    La guía de estilo define la voz y estilo narrativo
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}
        </div>

        <FormField
          control={form.control}
          name="chapterCount"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Número de Capítulos: {chapterCount}</FormLabel>
              <FormControl>
                <Slider
                  min={1}
                  max={100}
                  step={1}
                  value={[field.value]}
                  onValueChange={(value) => field.onChange(value[0])}
                  className="py-4"
                  data-testid="slider-chapter-count"
                />
              </FormControl>
              <FormDescription>
                Entre 1 y 100 capítulos (aproximadamente {(chapterCount * 2500).toLocaleString()} - {(chapterCount * 3500).toLocaleString()} palabras)
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="minWordCount"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Palabras Mínimas (objetivo)</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  placeholder="Ej: 80000"
                  value={field.value ?? ""}
                  onChange={(e) => {
                    const val = e.target.value;
                    field.onChange(val ? parseInt(val) : null);
                  }}
                  data-testid="input-min-word-count"
                />
              </FormControl>
              <FormDescription>
                {minWordCount && chapterCount > 0 
                  ? `Aproximadamente ${Math.round(minWordCount / chapterCount).toLocaleString()} palabras por capítulo`
                  : "Opcional: Define el mínimo de palabras para la novela completa"}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="space-y-4 pt-2">
          <FormLabel className="text-base">Secciones Adicionales</FormLabel>
          
          <FormField
            control={form.control}
            name="hasPrologue"
            render={({ field }) => (
              <FormItem className="flex items-center gap-3 space-y-0 rounded-md border p-3">
                <FormControl>
                  <Checkbox
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    data-testid="checkbox-prologue"
                  />
                </FormControl>
                <div className="flex items-center gap-2 flex-1">
                  <BookOpen className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <FormLabel className="font-medium cursor-pointer">Prólogo</FormLabel>
                    <FormDescription className="text-xs">
                      Introducción previa al primer capítulo
                    </FormDescription>
                  </div>
                </div>
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="hasEpilogue"
            render={({ field }) => (
              <FormItem className="flex items-center gap-3 space-y-0 rounded-md border p-3">
                <FormControl>
                  <Checkbox
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    data-testid="checkbox-epilogue"
                  />
                </FormControl>
                <div className="flex items-center gap-2 flex-1">
                  <ScrollText className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <FormLabel className="font-medium cursor-pointer">Epílogo</FormLabel>
                    <FormDescription className="text-xs">
                      Cierre posterior al último capítulo
                    </FormDescription>
                  </div>
                </div>
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="hasAuthorNote"
            render={({ field }) => (
              <FormItem className="flex items-center gap-3 space-y-0 rounded-md border p-3">
                <FormControl>
                  <Checkbox
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    data-testid="checkbox-author-note"
                  />
                </FormControl>
                <div className="flex items-center gap-2 flex-1">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <FormLabel className="font-medium cursor-pointer">Nota del Autor</FormLabel>
                    <FormDescription className="text-xs">
                      Reflexiones del autor sobre la obra
                    </FormDescription>
                  </div>
                </div>
              </FormItem>
            )}
          />
        </div>

        <div className="bg-muted/50 rounded-md p-3 text-sm">
          <span className="font-medium">Total de secciones:</span>{" "}
          <span className="text-muted-foreground">
            {totalSections} ({hasPrologue ? "Prólogo + " : ""}{chapterCount} capítulos{hasEpilogue ? " + Epílogo" : ""}{hasAuthorNote ? " + Nota del Autor" : ""})
          </span>
        </div>

        <div className="flex gap-3 pt-4">
          <Button 
            type="submit" 
            className="flex-1"
            disabled={isLoading}
            data-testid="button-start-project"
          >
            <Play className="h-4 w-4 mr-2" />
            {isLoading ? (isEditing ? "Guardando..." : "Creando...") : (isEditing ? "Guardar Cambios" : "Crear Proyecto")}
          </Button>
          {onReset && (
            <Button 
              type="button" 
              variant="outline"
              onClick={onReset}
              disabled={isLoading}
              data-testid="button-reset-config"
            >
              <RotateCcw className="h-4 w-4" />
            </Button>
          )}
        </div>
      </form>
    </Form>
  );
}

export { configSchema };
export type { ConfigFormData };
