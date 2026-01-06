import { useState, useCallback, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { 
  Upload, 
  FileText, 
  DollarSign, 
  Loader2, 
  Trash2, 
  Eye,
  CheckCircle,
  Clock,
  AlertCircle,
  Play,
  StopCircle,
  Star,
  Download,
  ChevronRight
} from "lucide-react";
import type { ReeditProject, ReeditChapter, ReeditAuditReport } from "@shared/schema";

const SUPPORTED_LANGUAGES = [
  { code: "es", name: "Español" },
  { code: "en", name: "English" },
  { code: "fr", name: "Français" },
  { code: "de", name: "Deutsch" },
  { code: "it", name: "Italiano" },
  { code: "pt", name: "Português" },
  { code: "ca", name: "Català" },
];

function getLanguageName(code: string | null | undefined): string {
  if (!code) return "No detectado";
  const lang = SUPPORTED_LANGUAGES.find(l => l.code === code.toLowerCase());
  return lang ? lang.name : code.toUpperCase();
}

const INPUT_PRICE_PER_MILLION = 0.80;
const OUTPUT_PRICE_PER_MILLION = 6.50;
const THINKING_PRICE_PER_MILLION = 3.0;

function calculateCost(inputTokens: number, outputTokens: number, thinkingTokens: number) {
  const inputCost = (inputTokens / 1_000_000) * INPUT_PRICE_PER_MILLION;
  const outputCost = (outputTokens / 1_000_000) * OUTPUT_PRICE_PER_MILLION;
  const thinkingCost = (thinkingTokens / 1_000_000) * THINKING_PRICE_PER_MILLION;
  return inputCost + outputCost + thinkingCost;
}

function getStatusBadge(status: string) {
  const statusLabels: Record<string, string> = {
    pending: "Pendiente",
    processing: "Procesando",
    completed: "Completado",
    error: "Error",
  };
  const variants: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; icon: typeof CheckCircle }> = {
    pending: { variant: "outline", icon: Clock },
    processing: { variant: "secondary", icon: Loader2 },
    completed: { variant: "default", icon: CheckCircle },
    error: { variant: "destructive", icon: AlertCircle },
  };
  const config = variants[status] || variants.pending;
  const IconComponent = config.icon;
  return (
    <Badge variant={config.variant} className="flex items-center gap-1">
      <IconComponent className={`h-3 w-3 ${status === 'processing' ? 'animate-spin' : ''}`} />
      {statusLabels[status] || status}
    </Badge>
  );
}

function getStageBadge(stage: string) {
  const stageLabels: Record<string, string> = {
    uploaded: "Subido",
    analyzing: "Analizando Estructura",
    editing: "Editando con IA",
    auditing: "Auditoría QA",
    reviewing: "Revisión Final",
    completed: "Completado",
  };
  return stageLabels[stage] || stage;
}

function ScoreDisplay({ score }: { score: number | null }) {
  if (score === null || score === undefined) return null;
  const color = score >= 8 ? "text-green-600 dark:text-green-400" : score >= 6 ? "text-yellow-600 dark:text-yellow-400" : "text-red-600 dark:text-red-400";
  return (
    <div className="flex items-center gap-2">
      <Star className={`h-5 w-5 ${color}`} />
      <span className={`text-2xl font-bold ${color}`}>{score}/10</span>
    </div>
  );
}

function StructureAnalysisDisplay({ analysis }: { analysis: any }) {
  if (!analysis) return null;

  const hasIssues = analysis.hasIssues;
  const duplicates = analysis.duplicateChapters || [];
  const outOfOrder = analysis.outOfOrderChapters || [];
  const recommendations = analysis.recommendations || [];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        {hasIssues ? (
          <Badge variant="destructive">Con Problemas</Badge>
        ) : (
          <Badge className="bg-green-600">Sin Problemas</Badge>
        )}
      </div>

      {analysis.hasPrologue !== undefined && (
        <div className="flex flex-wrap gap-2">
          {analysis.hasPrologue && <Badge variant="outline">Tiene Prólogo</Badge>}
          {analysis.hasEpilogue && <Badge variant="outline">Tiene Epílogo</Badge>}
          {analysis.hasAuthorNote && <Badge variant="outline">Tiene Nota del Autor</Badge>}
        </div>
      )}

      {duplicates.length > 0 && (
        <div>
          <p className="text-sm font-medium text-orange-600 dark:text-orange-400 mb-1">
            Capítulos Duplicados
          </p>
          <div className="flex flex-wrap gap-2">
            {duplicates.map((dup: any, i: number) => (
              <Badge key={i} variant="secondary">
                Cap. {dup.chapter || dup}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {outOfOrder.length > 0 && (
        <div>
          <p className="text-sm font-medium text-yellow-600 dark:text-yellow-400 mb-1">
            Capítulos Fuera de Orden
          </p>
          <div className="flex flex-wrap gap-2">
            {outOfOrder.map((ch: any, i: number) => (
              <Badge key={i} variant="secondary">
                Cap. {ch.chapter || ch}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {recommendations.length > 0 && (
        <div>
          <p className="text-sm font-medium mb-2">Recomendaciones</p>
          <ul className="text-sm space-y-1 list-disc list-inside">
            {recommendations.slice(0, 5).map((rec: string, i: number) => (
              <li key={i} className="text-muted-foreground">{rec}</li>
            ))}
            {recommendations.length > 5 && (
              <li className="text-muted-foreground italic">
                ...y {recommendations.length - 5} más
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

function FinalReviewDisplay({ result }: { result: any }) {
  if (!result) return null;

  const getSeverityColor = (severity: string) => {
    switch (severity?.toLowerCase()) {
      case 'critica': case 'critical': return 'text-red-600 dark:text-red-400';
      case 'mayor': case 'major': return 'text-orange-600 dark:text-orange-400';
      case 'menor': case 'minor': return 'text-yellow-600 dark:text-yellow-400';
      default: return 'text-muted-foreground';
    }
  };

  const getVerdictBadge = (verdict: string) => {
    const v = verdict?.toUpperCase() || '';
    if (v.includes('APROBADO') && !v.includes('RESERVA')) {
      return <Badge className="bg-green-600">Aprobado</Badge>;
    } else if (v.includes('RESERVA')) {
      return <Badge className="bg-yellow-600">Aprobado con Reservas</Badge>;
    } else if (v.includes('REVISION') || v.includes('REQUIERE')) {
      return <Badge variant="destructive">Requiere Revisión</Badge>;
    }
    return <Badge variant="outline">{verdict}</Badge>;
  };

  return (
    <div className="space-y-6">
      {result.veredicto && (
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground mb-1">Veredicto</p>
            {getVerdictBadge(result.veredicto)}
          </div>
          {result.puntuacion_global && (
            <div>
              <p className="text-sm text-muted-foreground mb-1">Puntuación Global</p>
              <ScoreDisplay score={result.puntuacion_global} />
            </div>
          )}
        </div>
      )}

      {result.resumen_general && (
        <div>
          <h4 className="font-semibold mb-2">Resumen General</h4>
          <p className="text-sm leading-relaxed bg-muted p-3 rounded-md">{result.resumen_general}</p>
        </div>
      )}

      {result.issues && result.issues.length > 0 && (
        <div>
          <h4 className="font-semibold mb-2">Problemas Detectados ({result.issues.length})</h4>
          <div className="space-y-3">
            {result.issues.map((issue: any, idx: number) => (
              <div key={idx} className="border rounded-md p-3">
                <div className="flex items-center gap-2 mb-2">
                  <Badge variant="outline">{issue.categoria || 'General'}</Badge>
                  <span className={`text-sm font-medium ${getSeverityColor(issue.severidad)}`}>
                    {issue.severidad || 'Sin severidad'}
                  </span>
                </div>
                <p className="text-sm">{issue.descripcion}</p>
                {issue.capitulos_afectados && issue.capitulos_afectados.length > 0 && (
                  <p className="text-xs text-muted-foreground mt-2">
                    Capítulos afectados: {issue.capitulos_afectados.join(', ')}
                  </p>
                )}
                {issue.instrucciones_correccion && (
                  <p className="text-sm mt-2 italic text-muted-foreground">
                    Corrección: {issue.instrucciones_correccion}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {result.analisis_bestseller && (
        <div>
          <h4 className="font-semibold mb-2">Análisis de Potencial Bestseller</h4>
          <div className="grid grid-cols-2 gap-3">
            {Object.entries(result.analisis_bestseller).map(([key, value]) => (
              <div key={key} className="bg-muted p-2 rounded-md">
                <p className="text-xs text-muted-foreground capitalize">{key.replace(/_/g, ' ')}</p>
                <p className="text-sm">{String(value)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {result.justificacion_puntuacion && (
        <div>
          <h4 className="font-semibold mb-2">Justificación de la Puntuación</h4>
          
          {result.justificacion_puntuacion.puntuacion_desglosada && (
            <div className="mb-3">
              <p className="text-xs text-muted-foreground mb-1">Puntuación Desglosada</p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(result.justificacion_puntuacion.puntuacion_desglosada).map(([key, value]) => (
                  <Badge key={key} variant="secondary">
                    {key}: {String(value)}/10
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {result.justificacion_puntuacion.fortalezas_principales && (
            <div className="mb-3">
              <p className="text-xs text-muted-foreground mb-1">Fortalezas Principales</p>
              <ul className="text-sm list-disc list-inside space-y-1">
                {result.justificacion_puntuacion.fortalezas_principales.map((f: string, i: number) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            </div>
          )}

          {result.justificacion_puntuacion.debilidades_principales && (
            <div className="mb-3">
              <p className="text-xs text-muted-foreground mb-1">Debilidades Principales</p>
              <ul className="text-sm list-disc list-inside space-y-1">
                {result.justificacion_puntuacion.debilidades_principales.map((d: string, i: number) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            </div>
          )}

          {result.justificacion_puntuacion.comparacion_mercado && (
            <div>
              <p className="text-xs text-muted-foreground mb-1">Comparación con el Mercado</p>
              <p className="text-sm">{result.justificacion_puntuacion.comparacion_mercado}</p>
            </div>
          )}
        </div>
      )}

      {result.capitulos_para_reescribir && result.capitulos_para_reescribir.length > 0 && (
        <div>
          <h4 className="font-semibold mb-2 text-orange-600 dark:text-orange-400">
            Capítulos que Requieren Reescritura
          </h4>
          <div className="flex flex-wrap gap-2">
            {result.capitulos_para_reescribir.map((cap: number) => (
              <Badge key={cap} variant="destructive">Capítulo {cap}</Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ReeditPage() {
  const { toast } = useToast();
  const [selectedProject, setSelectedProject] = useState<number | null>(null);
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadLanguage, setUploadLanguage] = useState("es");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const { data: projects = [], isLoading: projectsLoading } = useQuery<ReeditProject[]>({
    queryKey: ["/api/reedit-projects"],
    refetchInterval: 5000,
  });

  const { data: chapters = [] } = useQuery<ReeditChapter[]>({
    queryKey: ["/api/reedit-projects", selectedProject, "chapters"],
    enabled: !!selectedProject,
    refetchInterval: 3000,
  });

  const { data: auditReport } = useQuery<ReeditAuditReport>({
    queryKey: ["/api/reedit-projects", selectedProject, "audit-report"],
    enabled: !!selectedProject,
  });

  const selectedProjectData = projects.find(p => p.id === selectedProject);

  const uploadMutation = useMutation({
    mutationFn: async (formData: FormData) => {
      const response = await fetch("/api/reedit-projects", {
        method: "POST",
        body: formData,
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Error al subir");
      }
      return response.json();
    },
    onSuccess: (data) => {
      toast({ title: "Manuscrito Subido", description: `Proyecto "${data.title}" creado exitosamente. ${data.chaptersDetected || 1} capítulo(s) detectado(s).` });
      queryClient.invalidateQueries({ queryKey: ["/api/reedit-projects"] });
      setUploadTitle("");
      setUploadFile(null);
      setSelectedProject(data.projectId);
    },
    onError: (error: Error) => {
      toast({ title: "Error de Subida", description: error.message, variant: "destructive" });
    },
  });

  const startMutation = useMutation({
    mutationFn: async (projectId: number) => {
      return apiRequest("POST", `/api/reedit-projects/${projectId}/start`);
    },
    onSuccess: () => {
      toast({ title: "Procesamiento Iniciado", description: "El manuscrito está siendo reeditado" });
      queryClient.invalidateQueries({ queryKey: ["/api/reedit-projects"] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async (projectId: number) => {
      return apiRequest("POST", `/api/reedit-projects/${projectId}/cancel`);
    },
    onSuccess: () => {
      toast({ title: "Cancelado", description: "El procesamiento ha sido cancelado" });
      queryClient.invalidateQueries({ queryKey: ["/api/reedit-projects"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (projectId: number) => {
      return apiRequest("DELETE", `/api/reedit-projects/${projectId}`);
    },
    onSuccess: () => {
      toast({ title: "Eliminado", description: "El proyecto ha sido eliminado" });
      queryClient.invalidateQueries({ queryKey: ["/api/reedit-projects"] });
      if (selectedProject) setSelectedProject(null);
    },
  });

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setUploadFile(file);
      if (!uploadTitle) {
        setUploadTitle(file.name.replace(/\.(docx|doc)$/i, ""));
      }
    }
  }, [uploadTitle]);

  const handleUpload = useCallback(async () => {
    if (!uploadFile || !uploadTitle.trim()) {
      toast({ title: "Información Faltante", description: "Por favor proporciona un título y un archivo", variant: "destructive" });
      return;
    }
    setIsUploading(true);
    const formData = new FormData();
    formData.append("manuscript", uploadFile);
    formData.append("title", uploadTitle.trim());
    formData.append("language", uploadLanguage);
    try {
      await uploadMutation.mutateAsync(formData);
    } finally {
      setIsUploading(false);
    }
  }, [uploadFile, uploadTitle, uploadLanguage, uploadMutation, toast]);

  useEffect(() => {
    if (!selectedProject && projects.length > 0) {
      setSelectedProject(projects[0].id);
    }
  }, [projects, selectedProject]);

  const progress = selectedProjectData
    ? ((selectedProjectData.processedChapters || 0) / Math.max(selectedProjectData.totalChapters || 1, 1)) * 100
    : 0;

  return (
    <div className="container mx-auto p-4 max-w-7xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-2">Reedición de Manuscritos</h1>
        <p className="text-muted-foreground">
          Sube manuscritos existentes para una edición completa con IA a través de Editor, Corrector de Estilo, Auditores QA y Revisor Final.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Upload className="h-5 w-5" />
                Subir Manuscrito
              </CardTitle>
              <CardDescription>
                Sube un documento Word (.docx) para reedición
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="reedit-title">Título</Label>
                <Input
                  id="reedit-title"
                  data-testid="input-reedit-title"
                  value={uploadTitle}
                  onChange={(e) => setUploadTitle(e.target.value)}
                  placeholder="Título del manuscrito"
                />
              </div>
              <div>
                <Label htmlFor="reedit-language">Idioma</Label>
                <Select value={uploadLanguage} onValueChange={setUploadLanguage}>
                  <SelectTrigger data-testid="select-reedit-language">
                    <SelectValue placeholder="Seleccionar idioma" />
                  </SelectTrigger>
                  <SelectContent>
                    {SUPPORTED_LANGUAGES.map((lang) => (
                      <SelectItem key={lang.code} value={lang.code}>
                        {lang.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="reedit-file">Archivo</Label>
                <Input
                  id="reedit-file"
                  type="file"
                  data-testid="input-reedit-file"
                  accept=".docx,.doc"
                  onChange={handleFileChange}
                />
                {uploadFile && (
                  <p className="text-sm text-muted-foreground mt-1">
                    {uploadFile.name} ({(uploadFile.size / 1024).toFixed(1)} KB)
                  </p>
                )}
              </div>
              <Button
                onClick={handleUpload}
                disabled={!uploadFile || !uploadTitle.trim() || isUploading}
                className="w-full"
                data-testid="button-upload-reedit"
              >
                {isUploading ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Upload className="h-4 w-4 mr-2" />
                )}
                Subir y Crear Proyecto
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Proyectos
              </CardTitle>
            </CardHeader>
            <CardContent>
              {projectsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : projects.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">
                  Sin proyectos aún. Sube un manuscrito para comenzar.
                </p>
              ) : (
                <ScrollArea className="h-[300px]">
                  <div className="space-y-2">
                    {projects.map((project) => (
                      <div
                        key={project.id}
                        data-testid={`card-reedit-project-${project.id}`}
                        className={`p-3 rounded-md cursor-pointer transition-colors ${
                          selectedProject === project.id
                            ? "bg-accent"
                            : "hover-elevate"
                        }`}
                        onClick={() => setSelectedProject(project.id)}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="font-medium truncate">{project.title}</p>
                            <p className="text-sm text-muted-foreground">
                              {getLanguageName(project.detectedLanguage)} • {project.totalWordCount?.toLocaleString() || 0} palabras
                            </p>
                          </div>
                          {getStatusBadge(project.status)}
                        </div>
                        {project.status === "processing" && (
                          <div className="mt-2">
                            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                              <span>{getStageBadge(project.currentStage)}</span>
                              <span>{project.processedChapters}/{project.totalChapters}</span>
                            </div>
                            <Progress
                              value={(project.processedChapters || 0) / Math.max(project.totalChapters || 1, 1) * 100}
                              className="h-1"
                            />
                          </div>
                        )}
                        {project.bestsellerScore && (
                          <div className="mt-2">
                            <ScoreDisplay score={project.bestsellerScore} />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-2">
          {selectedProjectData ? (
            <Card>
              <CardHeader>
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <CardTitle>{selectedProjectData.title}</CardTitle>
                    <CardDescription>
                      {getLanguageName(selectedProjectData.detectedLanguage)} • {selectedProjectData.totalWordCount?.toLocaleString() || 0} palabras • {selectedProjectData.totalChapters || 0} capítulos
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {getStatusBadge(selectedProjectData.status)}
                    {selectedProjectData.status === "pending" && (
                      <Button
                        onClick={() => startMutation.mutate(selectedProjectData.id)}
                        disabled={startMutation.isPending}
                        data-testid="button-start-reedit"
                      >
                        {startMutation.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        ) : (
                          <Play className="h-4 w-4 mr-2" />
                        )}
                        Iniciar Reedición
                      </Button>
                    )}
                    {selectedProjectData.status === "processing" && (
                      <Button
                        variant="destructive"
                        onClick={() => cancelMutation.mutate(selectedProjectData.id)}
                        disabled={cancelMutation.isPending}
                        data-testid="button-cancel-reedit"
                      >
                        {cancelMutation.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        ) : (
                          <StopCircle className="h-4 w-4 mr-2" />
                        )}
                        Cancelar
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => deleteMutation.mutate(selectedProjectData.id)}
                      disabled={deleteMutation.isPending || selectedProjectData.status === "processing"}
                      data-testid="button-delete-reedit"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue="progress">
                  <TabsList>
                    <TabsTrigger value="progress" data-testid="tab-reedit-progress">Progreso</TabsTrigger>
                    <TabsTrigger value="chapters" data-testid="tab-reedit-chapters">Capítulos</TabsTrigger>
                    <TabsTrigger value="report" data-testid="tab-reedit-report">Informe Final</TabsTrigger>
                  </TabsList>

                  <TabsContent value="progress" className="space-y-4">
                    <div className="grid grid-cols-2 gap-4 mt-4">
                      <Card>
                        <CardContent className="pt-6">
                          <div className="text-center">
                            <p className="text-sm text-muted-foreground mb-1">Etapa Actual</p>
                            <Badge variant="outline" className="text-lg px-4 py-1">
                              {getStageBadge(selectedProjectData.currentStage)}
                            </Badge>
                          </div>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="pt-6">
                          <div className="text-center">
                            <p className="text-sm text-muted-foreground mb-1">Progreso</p>
                            <p className="text-2xl font-bold">
                              {selectedProjectData.processedChapters || 0}/{selectedProjectData.totalChapters || 0}
                            </p>
                          </div>
                        </CardContent>
                      </Card>
                    </div>

                    {selectedProjectData.status === "processing" && (
                      <div>
                        <div className="flex items-center justify-between text-sm mb-2">
                          <span>Procesando capítulos...</span>
                          <span>{Math.round(progress)}%</span>
                        </div>
                        <Progress value={progress} />
                      </div>
                    )}

                    {selectedProjectData.bestsellerScore && (
                      <Card className="bg-muted/50">
                        <CardContent className="pt-6">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-sm text-muted-foreground">Puntuación Bestseller</p>
                              <ScoreDisplay score={selectedProjectData.bestsellerScore} />
                            </div>
                            <div className="text-right">
                              <p className="text-sm text-muted-foreground">Coste Estimado</p>
                              <p className="text-lg font-semibold flex items-center gap-1">
                                <DollarSign className="h-4 w-4" />
                                {calculateCost(
                                  selectedProjectData.totalInputTokens || 0,
                                  selectedProjectData.totalOutputTokens || 0,
                                  selectedProjectData.totalThinkingTokens || 0
                                ).toFixed(2)}
                              </p>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    )}

                    {selectedProjectData.structureAnalysis != null && (
                      <Card>
                        <CardHeader>
                          <CardTitle className="text-base">Análisis de Estructura</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <StructureAnalysisDisplay analysis={selectedProjectData.structureAnalysis} />
                        </CardContent>
                      </Card>
                    )}
                  </TabsContent>

                  <TabsContent value="chapters">
                    <ScrollArea className="h-[400px] mt-4">
                      {chapters.length === 0 ? (
                        <p className="text-center text-muted-foreground py-8">
                          Aún no se han parseado capítulos
                        </p>
                      ) : (
                        <div className="space-y-2">
                          {chapters.map((chapter) => (
                            <div
                              key={chapter.id}
                              data-testid={`card-reedit-chapter-${chapter.id}`}
                              className="p-3 border rounded-md"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                  <Badge variant="outline">Cap. {chapter.chapterNumber}</Badge>
                                  <span className="font-medium">{chapter.title || `Capítulo ${chapter.chapterNumber}`}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  {chapter.editorScore && (
                                    <Badge variant="secondary">
                                      Editor: {chapter.editorScore}/10
                                    </Badge>
                                  )}
                                  {getStatusBadge(chapter.status)}
                                </div>
                              </div>
                              {chapter.editedContent && chapter.originalContent && (
                                <p className="text-sm text-muted-foreground mt-2">
                                  {chapter.editedContent.split(/\s+/).length.toLocaleString()} palabras
                                  {chapter.copyeditorChanges && (
                                    <span className="ml-2">• Cambios: {chapter.copyeditorChanges.substring(0, 100)}...</span>
                                  )}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </ScrollArea>
                  </TabsContent>

                  <TabsContent value="report">
                    {selectedProjectData.status === "completed" && selectedProjectData.finalReviewResult ? (
                      <Card className="mt-4">
                        <CardHeader>
                          <CardTitle className="flex items-center gap-2">
                            <Star className="h-5 w-5 text-yellow-500" />
                            Resultados de la Revisión Final
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <FinalReviewDisplay result={selectedProjectData.finalReviewResult} />
                          <div className="mt-4 flex justify-end">
                            <Button 
                              variant="outline" 
                              data-testid="button-download-reedit"
                              onClick={() => {
                                window.open(`/api/reedit-projects/${selectedProjectData.id}/export`, '_blank');
                              }}
                            >
                              <Download className="h-4 w-4 mr-2" />
                              Exportar Manuscrito Editado
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    ) : (
                      <div className="text-center text-muted-foreground py-12">
                        <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
                        <p>El informe final estará disponible cuando se complete el procesamiento</p>
                      </div>
                    )}
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="py-12 text-center">
                <FileText className="h-16 w-16 mx-auto mb-4 text-muted-foreground opacity-50" />
                <h3 className="text-lg font-medium mb-2">Selecciona un Proyecto</h3>
                <p className="text-muted-foreground">
                  Elige un proyecto de la lista o sube un nuevo manuscrito para comenzar
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
