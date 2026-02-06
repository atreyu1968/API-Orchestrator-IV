import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { RefreshCw, Trash2, BookOpen, Loader2 } from "lucide-react";

interface WritingLesson {
  id: number;
  category: string;
  lesson: string;
  rationale: string;
  badExample: string;
  goodExample: string;
  severityWeight: number;
  isActive: boolean;
}

const CATEGORY_LABELS: Record<string, string> = {
  repeticion_lexica: "Repetición Léxica",
  continuidad: "Continuidad",
  estructura: "Estructura",
  personajes: "Personajes",
  ritmo: "Ritmo",
  dialogo: "Diálogo",
  temporal: "Temporal",
  atmosfera: "Atmósfera",
  trama: "Trama",
  transiciones: "Transiciones",
};

const CATEGORY_COLORS: Record<string, string> = {
  repeticion_lexica: "bg-orange-500/20 text-orange-700 dark:text-orange-400",
  continuidad: "bg-blue-500/20 text-blue-700 dark:text-blue-400",
  estructura: "bg-purple-500/20 text-purple-700 dark:text-purple-400",
  personajes: "bg-pink-500/20 text-pink-700 dark:text-pink-400",
  ritmo: "bg-cyan-500/20 text-cyan-700 dark:text-cyan-400",
  dialogo: "bg-green-500/20 text-green-700 dark:text-green-400",
  temporal: "bg-amber-500/20 text-amber-700 dark:text-amber-400",
  atmosfera: "bg-indigo-500/20 text-indigo-700 dark:text-indigo-400",
  trama: "bg-red-500/20 text-red-700 dark:text-red-400",
  transiciones: "bg-teal-500/20 text-teal-700 dark:text-teal-400",
};

function getSeverityLabel(weight: number): string {
  if (weight >= 8) return "Crítico";
  if (weight >= 5) return "Alto";
  if (weight >= 3) return "Medio";
  return "Bajo";
}

function getSeverityColor(weight: number): string {
  if (weight >= 8) return "bg-red-500/20 text-red-700 dark:text-red-400";
  if (weight >= 5) return "bg-orange-500/20 text-orange-700 dark:text-orange-400";
  if (weight >= 3) return "bg-yellow-500/20 text-yellow-700 dark:text-yellow-400";
  return "bg-green-500/20 text-green-700 dark:text-green-400";
}

export default function WritingLessonsPage() {
  const { toast } = useToast();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const { data: lessons = [], isLoading } = useQuery<WritingLesson[]>({
    queryKey: ["/api/writing-lessons"],
  });

  const refreshMutation = useMutation({
    mutationFn: async () => {
      setIsRefreshing(true);
      const response = await apiRequest("POST", "/api/writing-lessons/refresh-sync");
      return response.json();
    },
    onSuccess: (data: any) => {
      setIsRefreshing(false);
      queryClient.invalidateQueries({ queryKey: ["/api/writing-lessons"] });
      toast({
        title: "Lecciones generadas",
        description: `Se extrajeron ${data.created || 0} lecciones de ${data.projectsAnalyzed || 0} proyectos analizados.`,
      });
    },
    onError: (error: any) => {
      setIsRefreshing(false);
      toast({
        title: "Error al generar lecciones",
        description: error?.message || "No se pudieron regenerar las lecciones. Verifica que DEEPSEEK_API_KEY esté configurada.",
        variant: "destructive",
      });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: number; isActive: boolean }) => {
      await apiRequest("PATCH", `/api/writing-lessons/${id}`, { isActive });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/writing-lessons"] });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "No se pudo actualizar la lección",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/writing-lessons/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/writing-lessons"] });
      toast({
        title: "Lección eliminada",
        description: "La lección ha sido eliminada correctamente",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "No se pudo eliminar la lección",
        variant: "destructive",
      });
    },
  });

  const groupedLessons = lessons.reduce<Record<string, WritingLesson[]>>((acc, lesson) => {
    const category = lesson.category || "other";
    if (!acc[category]) acc[category] = [];
    acc[category].push(lesson);
    return acc;
  }, {});

  const sortedCategories = Object.keys(groupedLessons).sort((a, b) => {
    const labelA = CATEGORY_LABELS[a] || a;
    const labelB = CATEGORY_LABELS[b] || b;
    return labelA.localeCompare(labelB);
  });

  return (
    <div className="p-6 space-y-6" data-testid="writing-lessons-page">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold" data-testid="text-page-title">
            Lecciones de Escritura
          </h1>
          <p className="text-muted-foreground mt-1" data-testid="text-page-subtitle">
            Aprendizaje automático de errores detectados en auditorías anteriores
          </p>
        </div>
        <Button
          onClick={() => refreshMutation.mutate()}
          disabled={refreshMutation.isPending || isRefreshing}
          data-testid="button-refresh-lessons"
        >
          {refreshMutation.isPending || isRefreshing ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4 mr-2" />
          )}
          Regenerar Lecciones
        </Button>
      </div>

      {isRefreshing && (
        <Card data-testid="status-refreshing">
          <CardContent className="flex items-center gap-3 py-4">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Analizando auditorías y extrayendo lecciones con DeepSeek... Esto tarda entre 1-3 minutos.
            </p>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 text-muted-foreground/30 animate-spin" />
        </div>
      ) : lessons.length === 0 && !isRefreshing ? (
        <Card data-testid="status-empty">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <BookOpen className="h-12 w-12 text-muted-foreground/30 mb-4" />
            <p className="text-muted-foreground text-sm">
              No hay lecciones de escritura todavía
            </p>
            <p className="text-muted-foreground/60 text-xs mt-1">
              Haz clic en "Regenerar Lecciones" para analizar las auditorías anteriores y extraer patrones de mejora
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-8">
          {sortedCategories.map((category) => (
            <div key={category} data-testid={`category-group-${category}`}>
              <div className="flex items-center gap-2 mb-4 flex-wrap">
                <h2 className="text-xl font-semibold">
                  {CATEGORY_LABELS[category] || category}
                </h2>
                <Badge variant="outline" className="text-xs">
                  {groupedLessons[category].length}
                </Badge>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {groupedLessons[category].map((lesson) => (
                  <Card
                    key={lesson.id}
                    className={`${!lesson.isActive ? "opacity-60" : ""}`}
                    data-testid={`card-lesson-${lesson.id}`}
                  >
                    <CardHeader className="flex flex-row items-start justify-between gap-2 pb-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge className={`text-xs ${CATEGORY_COLORS[lesson.category] || ""}`}>
                          {CATEGORY_LABELS[lesson.category] || lesson.category}
                        </Badge>
                        <Badge className={`text-xs ${getSeverityColor(lesson.severityWeight)}`}>
                          {getSeverityLabel(lesson.severityWeight)} ({lesson.severityWeight})
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Switch
                          checked={lesson.isActive}
                          onCheckedChange={(checked) =>
                            toggleMutation.mutate({ id: lesson.id, isActive: checked })
                          }
                          data-testid={`switch-toggle-${lesson.id}`}
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => deleteMutation.mutate(lesson.id)}
                          disabled={deleteMutation.isPending}
                          data-testid={`button-delete-${lesson.id}`}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <p className="text-sm font-medium" data-testid={`text-lesson-${lesson.id}`}>
                        {lesson.lesson}
                      </p>
                      <p className="text-xs text-muted-foreground" data-testid={`text-rationale-${lesson.id}`}>
                        {lesson.rationale}
                      </p>
                      {(lesson.badExample || lesson.goodExample) && (
                        <div className="space-y-2">
                          {lesson.badExample && (
                            <div
                              className="text-xs p-2 rounded-md bg-red-500/10 border border-red-500/20 text-red-700 dark:text-red-400"
                              data-testid={`text-bad-example-${lesson.id}`}
                            >
                              <span className="font-semibold">Mal:</span> {lesson.badExample}
                            </div>
                          )}
                          {lesson.goodExample && (
                            <div
                              className="text-xs p-2 rounded-md bg-green-500/10 border border-green-500/20 text-green-700 dark:text-green-400"
                              data-testid={`text-good-example-${lesson.id}`}
                            >
                              <span className="font-semibold">Bien:</span> {lesson.goodExample}
                            </div>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
