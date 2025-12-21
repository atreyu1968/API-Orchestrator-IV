import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
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
import { Play, RotateCcw, BookOpen, FileText, ScrollText } from "lucide-react";

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

const configSchema = z.object({
  title: z.string().min(1, "El título es requerido").max(100),
  genre: z.string().min(1, "Selecciona un género"),
  tone: z.string().min(1, "Selecciona un tono"),
  chapterCount: z.number().min(1).max(50),
  hasPrologue: z.boolean().default(false),
  hasEpilogue: z.boolean().default(false),
  hasAuthorNote: z.boolean().default(false),
});

type ConfigFormData = z.infer<typeof configSchema>;

interface ConfigPanelProps {
  onSubmit: (data: ConfigFormData) => void;
  onReset?: () => void;
  isLoading?: boolean;
  defaultValues?: Partial<ConfigFormData>;
}

export function ConfigPanel({ onSubmit, onReset, isLoading, defaultValues }: ConfigPanelProps) {
  const form = useForm<ConfigFormData>({
    resolver: zodResolver(configSchema),
    defaultValues: {
      title: defaultValues?.title || "",
      genre: defaultValues?.genre || "fantasy",
      tone: defaultValues?.tone || "dramatic",
      chapterCount: defaultValues?.chapterCount || 10,
      hasPrologue: defaultValues?.hasPrologue || false,
      hasEpilogue: defaultValues?.hasEpilogue || false,
      hasAuthorNote: defaultValues?.hasAuthorNote || false,
    },
  });

  const chapterCount = form.watch("chapterCount");
  const hasPrologue = form.watch("hasPrologue");
  const hasEpilogue = form.watch("hasEpilogue");
  const hasAuthorNote = form.watch("hasAuthorNote");

  const totalSections = chapterCount + (hasPrologue ? 1 : 0) + (hasEpilogue ? 1 : 0) + (hasAuthorNote ? 1 : 0);

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

        <FormField
          control={form.control}
          name="chapterCount"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Número de Capítulos: {chapterCount}</FormLabel>
              <FormControl>
                <Slider
                  min={1}
                  max={50}
                  step={1}
                  value={[field.value]}
                  onValueChange={(value) => field.onChange(value[0])}
                  className="py-4"
                  data-testid="slider-chapter-count"
                />
              </FormControl>
              <FormDescription>
                Entre 1 y 50 capítulos (aproximadamente {(chapterCount * 2500).toLocaleString()} - {(chapterCount * 3500).toLocaleString()} palabras)
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
            {isLoading ? "Creando..." : "Crear Proyecto"}
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
