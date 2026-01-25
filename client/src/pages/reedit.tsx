import { useState, useCallback, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { ChatPanel } from "@/components/chat-panel";
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
  AlertTriangle,
  Play,
  StopCircle,
  Star,
  Download,
  ChevronRight,
  Cpu,
  TrendingUp,
  Zap,
  RotateCcw,
  Pause,
  Unlock,
  MessageSquare,
  Check,
  X,
  XCircle
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

function getChapterLabel(chapterNumber: number, title?: string | null): string {
  if (chapterNumber === 0) return title || "Prólogo";
  if (chapterNumber === -1) return title || "Epílogo";
  if (chapterNumber === -2) return title || "Nota del Autor";
  return title || `Capítulo ${chapterNumber}`;
}

function getChapterBadgeLabel(chapterNumber: number): string {
  if (chapterNumber === 0) return "Prólogo";
  if (chapterNumber === -1) return "Epílogo";
  if (chapterNumber === -2) return "N.A.";
  return `Cap. ${chapterNumber}`;
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
    awaiting_instructions: "Esperando Instrucciones",
    awaiting_issue_approval: "Revisión de Problemas",
  };
  const variants: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; icon: typeof CheckCircle }> = {
    pending: { variant: "outline", icon: Clock },
    processing: { variant: "secondary", icon: Loader2 },
    completed: { variant: "default", icon: CheckCircle },
    error: { variant: "destructive", icon: AlertCircle },
    awaiting_instructions: { variant: "outline", icon: Pause },
    awaiting_issue_approval: { variant: "outline", icon: AlertCircle },
  };
  const config = variants[status] || variants.pending;
  const IconComponent = config.icon;
  return (
    <Badge variant={config.variant} className={`flex items-center gap-1 ${status === 'awaiting_instructions' ? 'border-amber-500 text-amber-600 dark:text-amber-400' : ''} ${status === 'awaiting_issue_approval' ? 'border-orange-500 text-orange-600 dark:text-orange-400' : ''}`}>
      <IconComponent className={`h-3 w-3 ${status === 'processing' ? 'animate-spin' : ''}`} />
      {statusLabels[status] || status}
    </Badge>
  );
}

function getStageBadge(stage: string) {
  const stageLabels: Record<string, string> = {
    uploaded: "Subido",
    analyzing: "Analizando Estructura",
    editing: "Revisión Editorial",
    world_bible: "Extrayendo Biblia del Mundo",
    architect: "Análisis Arquitectónico",
    copyediting: "Corrección de Estilo",
    qa: "Auditoría QA",
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

function formatTokenCount(num: number): string {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toString();
}

function RealTimeCostWidget({ projectId, isProcessing }: { projectId: number; isProcessing: boolean }) {
  const { data: project } = useQuery<ReeditProject>({
    queryKey: ['/api/reedit-projects', projectId],
    refetchInterval: isProcessing ? 5000 : false,
  });

  if (!project) return null;

  const inputTokens = project.totalInputTokens || 0;
  const outputTokens = project.totalOutputTokens || 0;
  const thinkingTokens = project.totalThinkingTokens || 0;
  const totalCost = calculateCost(inputTokens, outputTokens, thinkingTokens);

  const hasData = inputTokens > 0 || outputTokens > 0;

  if (!hasData && !isProcessing) return null;

  return (
    <Card className="border-2 border-primary/20 bg-gradient-to-r from-primary/5 to-transparent" data-testid="widget-realtime-cost">
      <CardContent className="pt-4 pb-4">
        <div className="flex items-center gap-2 mb-3">
          <DollarSign className="h-5 w-5 text-primary" />
          <span className="font-semibold">Costos en Tiempo Real</span>
          {isProcessing && (
            <Badge variant="secondary" className="ml-auto animate-pulse">
              <Zap className="h-3 w-3 mr-1" />
              Actualizando
            </Badge>
          )}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="text-center p-2 bg-muted/50 rounded-md">
            <div className="flex items-center justify-center gap-1 text-muted-foreground mb-1">
              <TrendingUp className="h-3 w-3" />
              <span className="text-xs">Entrada</span>
            </div>
            <p className="font-mono font-semibold">{formatTokenCount(inputTokens)}</p>
          </div>
          <div className="text-center p-2 bg-muted/50 rounded-md">
            <div className="flex items-center justify-center gap-1 text-muted-foreground mb-1">
              <Cpu className="h-3 w-3" />
              <span className="text-xs">Salida</span>
            </div>
            <p className="font-mono font-semibold">{formatTokenCount(outputTokens)}</p>
          </div>
          <div className="text-center p-2 bg-muted/50 rounded-md">
            <div className="flex items-center justify-center gap-1 text-muted-foreground mb-1">
              <Zap className="h-3 w-3" />
              <span className="text-xs">Thinking</span>
            </div>
            <p className="font-mono font-semibold">{formatTokenCount(thinkingTokens)}</p>
          </div>
          <div className="text-center p-2 bg-primary/10 rounded-md">
            <div className="flex items-center justify-center gap-1 text-primary mb-1">
              <DollarSign className="h-3 w-3" />
              <span className="text-xs font-medium">Costo Total</span>
            </div>
            <p className="font-mono font-bold text-lg text-primary">${totalCost.toFixed(2)}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function StructureAnalysisDisplay({ analysis }: { analysis: any }) {
  if (!analysis) return null;

  const hasIssues = analysis.hasIssues;
  const duplicates = analysis.duplicateChapters || [];
  const outOfOrder = analysis.outOfOrderChapters || [];
  const missingChapters = analysis.missingChapters || [];
  const recommendations = analysis.recommendations || [];
  const totalChapters = analysis.totalChapters;
  const regularChapters = analysis.regularChapters;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        {hasIssues ? (
          <Badge variant="destructive">Con Problemas</Badge>
        ) : (
          <Badge className="bg-green-600">Sin Problemas</Badge>
        )}
        {totalChapters !== undefined && (
          <Badge variant="secondary">{totalChapters} capítulos totales</Badge>
        )}
        {regularChapters !== undefined && (
          <Badge variant="outline">{regularChapters} capítulos regulares</Badge>
        )}
      </div>

      {(analysis.hasPrologue !== undefined || analysis.hasEpilogue !== undefined) && (
        <div className="flex flex-wrap gap-2">
          {analysis.hasPrologue && <Badge variant="outline">Tiene Prólogo</Badge>}
          {analysis.hasEpilogue && <Badge variant="outline">Tiene Epílogo</Badge>}
          {analysis.hasAuthorNote && <Badge variant="outline">Tiene Nota del Autor</Badge>}
        </div>
      )}

      {missingChapters.length > 0 && (
        <div>
          <p className="text-sm font-medium text-red-600 dark:text-red-400 mb-1">
            Capítulos Faltantes ({missingChapters.length})
          </p>
          <div className="flex flex-wrap gap-1">
            {missingChapters.slice(0, 20).map((num: number, i: number) => (
              <Badge key={i} variant="destructive" className="text-xs">
                {num}
              </Badge>
            ))}
            {missingChapters.length > 20 && (
              <Badge variant="secondary" className="text-xs">
                ...y {missingChapters.length - 20} más
              </Badge>
            )}
          </div>
        </div>
      )}

      {duplicates.length > 0 && (
        <div>
          <p className="text-sm font-medium text-orange-600 dark:text-orange-400 mb-1">
            Capítulos Duplicados ({duplicates.length})
          </p>
          <div className="flex flex-wrap gap-2">
            {duplicates.map((dup: any, i: number) => {
              const num = dup.chapterNumber ?? dup.chapter ?? dup;
              return (
                <Badge key={i} variant="secondary">
                  {getChapterBadgeLabel(typeof num === 'number' ? num : parseInt(num) || 0)}
                </Badge>
              );
            })}
          </div>
        </div>
      )}

      {outOfOrder.length > 0 && (
        <div>
          <p className="text-sm font-medium text-yellow-600 dark:text-yellow-400 mb-1">
            Capítulos Fuera de Orden ({outOfOrder.length})
          </p>
          <div className="flex flex-wrap gap-2">
            {outOfOrder.map((ch: any, i: number) => {
              const num = ch.chapterNumber ?? ch.chapter ?? ch;
              return (
                <Badge key={i} variant="secondary">
                  {getChapterBadgeLabel(typeof num === 'number' ? num : parseInt(num) || 0)}
                </Badge>
              );
            })}
          </div>
        </div>
      )}

      {!hasIssues && missingChapters.length === 0 && duplicates.length === 0 && outOfOrder.length === 0 && (
        <p className="text-sm text-muted-foreground">
          La estructura del manuscrito es correcta. No se detectaron problemas.
        </p>
      )}

      {recommendations.length > 0 && (
        <div className="mt-4 pt-4 border-t">
          <p className="text-sm font-medium mb-2">Recomendaciones</p>
          <ul className="text-sm space-y-1 list-disc list-inside">
            {recommendations.map((rec: string, i: number) => (
              <li key={i} className="text-muted-foreground">{rec}</li>
            ))}
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

  const getMarketPotentialBadge = (potential: string) => {
    const p = potential?.toLowerCase() || '';
    if (p === 'high' || p === 'alto') {
      return <Badge className="bg-green-600">Potencial Alto</Badge>;
    } else if (p === 'medium' || p === 'medio') {
      return <Badge className="bg-yellow-600">Potencial Medio</Badge>;
    }
    return <Badge variant="outline">{potential}</Badge>;
  };

  const hasAlternativeFormat = result.strengths || result.weaknesses || result.bestsellerScore;

  return (
    <div className="space-y-6">
      {result.veredicto && (
        <div className="flex items-center justify-between gap-4 flex-wrap">
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

      {hasAlternativeFormat && !result.veredicto && (
        <div className="flex items-center justify-between gap-4 flex-wrap">
          {result.bestsellerScore && (
            <div>
              <p className="text-sm text-muted-foreground mb-1">Puntuación Bestseller</p>
              <ScoreDisplay score={result.bestsellerScore} />
            </div>
          )}
          {result.marketPotential && (
            <div>
              <p className="text-sm text-muted-foreground mb-1">Potencial de Mercado</p>
              {getMarketPotentialBadge(result.marketPotential)}
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

      {result.strengths && result.strengths.length > 0 && (
        <div>
          <h4 className="font-semibold mb-2 text-green-600 dark:text-green-400">Fortalezas</h4>
          <ul className="text-sm list-disc list-inside space-y-1">
            {result.strengths.map((s: string, i: number) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      )}

      {result.weaknesses && result.weaknesses.length > 0 && (
        <div>
          <h4 className="font-semibold mb-2 text-orange-600 dark:text-orange-400">Áreas de Mejora</h4>
          <ul className="text-sm list-disc list-inside space-y-1">
            {result.weaknesses.map((w: string, i: number) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {result.recommendations && Array.isArray(result.recommendations) && result.recommendations.length > 0 && !result.justificacion_puntuacion && (
        <div>
          <h4 className="font-semibold mb-2">Recomendaciones</h4>
          <ul className="text-sm list-disc list-inside space-y-1">
            {result.recommendations.map((r: string, i: number) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
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

function WorldBibleDisplay({ worldBible }: { worldBible: any }) {
  if (!worldBible) return null;

  const characters = worldBible.characters || [];
  const locations = worldBible.locations || [];
  const timeline = worldBible.timeline || [];
  const loreRules = worldBible.loreRules || [];

  return (
    <div className="space-y-6" data-testid="display-world-bible">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        {worldBible.confidence !== undefined && worldBible.confidence !== null && (
          <Badge variant="secondary">Confianza: {worldBible.confidence}/10</Badge>
        )}
        {worldBible.historicalPeriod && (
          <Badge className="bg-amber-600">Época: {worldBible.historicalPeriod}</Badge>
        )}
      </div>

      {characters.length > 0 && (
        <div>
          <h4 className="font-semibold mb-2">Personajes ({characters.length})</h4>
          <div className="space-y-2">
            {characters.slice(0, 10).map((char: any, i: number) => (
              <div key={i} className="p-3 border rounded-md">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium">{char.nombre || char.name}</span>
                  <Badge variant="outline" className="text-xs">Cap. {char.primeraAparicion || char.firstAppearance || "?"}</Badge>
                  {(char.alias || char.aliases)?.length > 0 && (
                    <Badge variant="secondary" className="text-xs">{(char.alias || char.aliases)[0]}</Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground mt-1">{char.descripcion || char.description}</p>
                {(char.relaciones || char.relationships)?.length > 0 && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Relaciones: {(char.relaciones || char.relationships).slice(0, 3).join(", ")}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {locations.length > 0 && (
        <div>
          <h4 className="font-semibold mb-2">Ubicaciones ({locations.length})</h4>
          <div className="flex flex-wrap gap-2">
            {locations.map((loc: any, i: number) => (
              <Badge key={i} variant="outline" className="text-sm py-1">
                {loc.nombre || loc.name} (Cap. {loc.primeraMencion || loc.firstMention || "?"})
              </Badge>
            ))}
          </div>
        </div>
      )}

      {timeline.length > 0 && (
        <div>
          <h4 className="font-semibold mb-2">Línea Temporal ({timeline.length} eventos)</h4>
          <div className="space-y-1">
            {timeline.slice(0, 8).map((event: any, i: number) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <Badge variant="outline" className="text-xs">Cap. {event.capitulo || event.chapter}</Badge>
                <span>{event.evento || event.event}</span>
                {event.marcadorTemporal && (
                  <span className="text-muted-foreground text-xs">({event.marcadorTemporal})</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {loreRules.length > 0 && (
        <div>
          <h4 className="font-semibold mb-2">Reglas del Mundo ({loreRules.length})</h4>
          <ul className="text-sm space-y-1 list-disc list-inside">
            {loreRules.slice(0, 6).map((rule: any, i: number) => (
              <li key={i}>{rule.regla || rule.rule} <span className="text-muted-foreground text-xs">({rule.categoria || rule.category || "general"})</span></li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// Real-time progress report component - shows statistics, issues found, and before/after comparison
function ProgressReportDisplay({ 
  project, 
  chapters 
}: { 
  project: ReeditProject; 
  chapters: ReeditChapter[];
}) {
  // Calculate statistics
  const completedChapters = chapters.filter(c => c.status === "completed" || c.editedContent);
  const pendingChapters = chapters.filter(c => c.status === "pending");
  const processingChapters = chapters.filter(c => c.status === "analyzing" || c.status === "editing");
  
  const originalWordCount = chapters.reduce((sum, c) => {
    const content = c.originalContent || "";
    return sum + content.split(/\s+/).filter(w => w.length > 0).length;
  }, 0);
  
  const editedWordCount = chapters.reduce((sum, c) => {
    const content = c.editedContent || c.originalContent || "";
    return sum + content.split(/\s+/).filter(w => w.length > 0).length;
  }, 0);
  
  const wordCountDiff = editedWordCount - originalWordCount;
  const wordCountPercent = originalWordCount > 0 ? ((wordCountDiff / originalWordCount) * 100).toFixed(1) : "0";
  
  // Safe JSON parsing helper
  const safeParseJson = (data: any): any => {
    if (!data) return null;
    if (typeof data === 'object') return data;
    try {
      return JSON.parse(data);
    } catch {
      return null;
    }
  };
  
  // Collect all issues found across chapters
  const allIssues: Array<{chapter: number, title: string | null, issues: any[]}> = [];
  chapters.forEach(ch => {
    const issues: any[] = [];
    const narr = safeParseJson(ch.narrativeIssues);
    if (narr) {
      if (Array.isArray(narr.plotHoles)) issues.push(...narr.plotHoles.map((i: string) => ({ type: "trama", text: String(i) })));
      if (Array.isArray(narr.continuityErrors)) issues.push(...narr.continuityErrors.map((i: string) => ({ type: "continuidad", text: String(i) })));
      if (Array.isArray(narr.pacing)) issues.push(...narr.pacing.map((i: string) => ({ type: "ritmo", text: String(i) })));
    }
    const fb = safeParseJson(ch.editorFeedback);
    if (fb && Array.isArray(fb.issues)) {
      issues.push(...fb.issues.map((i: string) => ({ type: "editor", text: String(i) })));
    }
    if (issues.length > 0) {
      allIssues.push({ chapter: ch.chapterNumber, title: ch.title, issues });
    }
  });
  
  // Collect changes (before/after comparisons)
  const chaptersWithChanges = chapters.filter(c => c.editedContent && c.editedContent !== c.originalContent);
  
  const getIssueTypeBadge = (type: string) => {
    const colors: Record<string, string> = {
      trama: "bg-red-600",
      continuidad: "bg-orange-600",
      ritmo: "bg-blue-600",
      editor: "bg-purple-600",
    };
    const labels: Record<string, string> = {
      trama: "Trama",
      continuidad: "Continuidad",
      ritmo: "Ritmo",
      editor: "Editorial",
    };
    return <Badge className={colors[type] || "bg-gray-600"}>{labels[type] || type}</Badge>;
  };

  return (
    <div className="space-y-6" data-testid="display-progress-report">
      {/* Statistics Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <TrendingUp className="h-5 w-5 mx-auto mb-1 text-blue-500" />
            <p className="text-2xl font-bold">{completedChapters.length}/{chapters.length}</p>
            <p className="text-xs text-muted-foreground">Capítulos Procesados</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <FileText className="h-5 w-5 mx-auto mb-1 text-green-500" />
            <p className="text-2xl font-bold">{originalWordCount.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground">Palabras Originales</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <Zap className="h-5 w-5 mx-auto mb-1 text-yellow-500" />
            <p className="text-2xl font-bold">{editedWordCount.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground">Palabras Editadas</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <TrendingUp className={`h-5 w-5 mx-auto mb-1 ${wordCountDiff >= 0 ? 'text-green-500' : 'text-red-500'}`} />
            <p className="text-2xl font-bold">{wordCountDiff >= 0 ? '+' : ''}{wordCountPercent}%</p>
            <p className="text-xs text-muted-foreground">Cambio de Longitud</p>
          </CardContent>
        </Card>
      </div>

      {/* Processing Status */}
      {processingChapters.length > 0 && (
        <Card className="border-blue-500/50">
          <CardHeader className="py-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              En Proceso ({processingChapters.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="py-2">
            <div className="flex flex-wrap gap-2">
              {processingChapters.map(ch => (
                <Badge key={ch.id} variant="outline" className="animate-pulse">
                  {getChapterBadgeLabel(ch.chapterNumber)}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Issues Found */}
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-orange-500" />
            Problemas Detectados ({allIssues.reduce((sum, i) => sum + i.issues.length, 0)})
          </CardTitle>
        </CardHeader>
        <CardContent className="py-2">
          {allIssues.length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-2">
              {completedChapters.length === 0 
                ? "Los problemas aparecerán aquí durante el análisis" 
                : "No se han detectado problemas significativos"}
            </p>
          ) : (
            <ScrollArea className="h-[200px]">
              <div className="space-y-3">
                {allIssues.slice(0, 10).map((item, idx) => (
                  <div key={idx} className="border-l-2 border-muted pl-3">
                    <p className="text-xs font-medium mb-1">
                      {getChapterLabel(item.chapter, item.title)}
                    </p>
                    <div className="space-y-1">
                      {item.issues.slice(0, 3).map((issue, i) => (
                        <div key={i} className="flex items-start gap-2 text-xs">
                          {getIssueTypeBadge(issue.type)}
                          <span className="text-muted-foreground">{issue.text}</span>
                        </div>
                      ))}
                      {item.issues.length > 3 && (
                        <p className="text-xs text-muted-foreground">+{item.issues.length - 3} más...</p>
                      )}
                    </div>
                  </div>
                ))}
                {allIssues.length > 10 && (
                  <p className="text-xs text-muted-foreground text-center">
                    +{allIssues.length - 10} capítulos más con problemas
                  </p>
                )}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* Chapters with Changes */}
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <CheckCircle className="h-4 w-4 text-green-500" />
            Capítulos Editados ({chaptersWithChanges.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="py-2">
          {chaptersWithChanges.length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-2">
              Los cambios aparecerán aquí cuando se procesen los capítulos
            </p>
          ) : (
            <ScrollArea className="h-[200px]">
              <div className="space-y-2">
                {chaptersWithChanges.slice(0, 15).map(ch => {
                  const origWords = (ch.originalContent || "").split(/\s+/).filter(w => w.length > 0).length;
                  const editWords = (ch.editedContent || "").split(/\s+/).filter(w => w.length > 0).length;
                  const diff = editWords - origWords;
                  return (
                    <div key={ch.id} className="flex items-center justify-between text-sm py-1 border-b last:border-0">
                      <span className="font-medium">{getChapterLabel(ch.chapterNumber, ch.title)}</span>
                      <div className="flex items-center gap-3 text-xs">
                        <span className="text-muted-foreground">{origWords} → {editWords}</span>
                        <Badge variant={diff >= 0 ? "default" : "secondary"} className="text-xs">
                          {diff >= 0 ? '+' : ''}{diff}
                        </Badge>
                        {ch.editorScore && (
                          <Badge variant="outline" className="text-xs">
                            ★ {ch.editorScore}
                          </Badge>
                        )}
                      </div>
                    </div>
                  );
                })}
                {chaptersWithChanges.length > 15 && (
                  <p className="text-xs text-muted-foreground text-center py-2">
                    +{chaptersWithChanges.length - 15} capítulos más editados
                  </p>
                )}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* Pending Chapters */}
      {pendingChapters.length > 0 && (
        <Card className="border-muted">
          <CardHeader className="py-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              Pendientes ({pendingChapters.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="py-2">
            <div className="flex flex-wrap gap-1">
              {pendingChapters.slice(0, 20).map(ch => (
                <Badge key={ch.id} variant="outline" className="text-xs opacity-60">
                  {getChapterBadgeLabel(ch.chapterNumber)}
                </Badge>
              ))}
              {pendingChapters.length > 20 && (
                <Badge variant="outline" className="text-xs opacity-60">+{pendingChapters.length - 20}</Badge>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function AuditReportsDisplay({ reports }: { reports: any[] }) {
  if (!reports || reports.length === 0) {
    return <p className="text-muted-foreground text-center py-4">No hay informes de auditoría disponibles</p>;
  }

  const getAuditTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      architect: "Análisis Arquitectónico",
      continuity: "Centinela de Continuidad",
      voice_rhythm: "Auditor de Voz y Ritmo",
      semantic_repetition: "Detector de Repetición Semántica",
      anachronism: "Detector de Anacronismos",
      final_review: "Revisión Final",
      structural_fix: "Corrección Estructural",
    };
    return labels[type] || type;
  };

  const getAuditTypeBadgeColor = (type: string) => {
    const colors: Record<string, string> = {
      architect: "bg-purple-600",
      continuity: "bg-blue-600",
      voice_rhythm: "bg-teal-600",
      semantic_repetition: "bg-orange-600",
      anachronism: "bg-amber-600",
      final_review: "bg-green-600",
      structural_fix: "bg-indigo-600",
    };
    return colors[type] || "bg-gray-600";
  };

  // Filter out any invalid reports to prevent rendering errors
  const validReports = reports.filter(report => report && typeof report === 'object');

  if (validReports.length === 0) {
    return <p className="text-muted-foreground text-center py-4">No hay informes de auditoría válidos</p>;
  }

  return (
    <div className="space-y-4" data-testid="display-audit-reports">
      {validReports.map((report, idx) => {
        // Safely extract findings summary
        const findingsSummary = (() => {
          try {
            if (!report.findings) return null;
            const findings = typeof report.findings === 'string' 
              ? JSON.parse(report.findings) 
              : report.findings;
            return findings?.resumenEjecutivo || findings?.resumen || null;
          } catch {
            return null;
          }
        })();

        // Safely extract recommendations
        const recs = (() => {
          try {
            if (!report.recommendations) return [];
            const parsed = typeof report.recommendations === 'string' 
              ? JSON.parse(report.recommendations) 
              : report.recommendations;
            return Array.isArray(parsed) ? parsed.slice(0, 3) : [];
          } catch {
            return [];
          }
        })();

        return (
          <Card key={report.id || idx} data-testid={`card-audit-report-${report.id || idx}`}>
            <CardHeader className="py-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <Badge className={getAuditTypeBadgeColor(report.auditType || 'unknown')}>
                    {getAuditTypeLabel(report.auditType || 'unknown')}
                  </Badge>
                  {report.chapterRange && report.chapterRange !== "all" && (
                    <Badge variant="outline">Caps. {report.chapterRange}</Badge>
                  )}
                </div>
                {report.score !== undefined && report.score !== null && (
                  <ScoreDisplay score={report.score} />
                )}
              </div>
            </CardHeader>
            <CardContent className="py-2">
              {findingsSummary && (
                <p className="text-sm mb-2">{findingsSummary}</p>
              )}
              {recs.length > 0 && (
                <div className="mt-2">
                  <p className="text-xs text-muted-foreground mb-1">Recomendaciones:</p>
                  <ul className="text-sm list-disc list-inside space-y-1">
                    {recs.map((rec: any, i: number) => (
                      <li key={i} className="text-muted-foreground">
                        {typeof rec === 'string' ? rec : (rec?.descripcion || rec?.description || JSON.stringify(rec))}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
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
  const [expandChapters, setExpandChapters] = useState(false);
  const [insertNewChapters, setInsertNewChapters] = useState(false);
  const [targetMinWords, setTargetMinWords] = useState(2000);
  const [uploadInstructions, setUploadInstructions] = useState("");
  
  // Restart dialog state
  const [showRestartDialog, setShowRestartDialog] = useState(false);
  const [restartExpandChapters, setRestartExpandChapters] = useState(false);
  const [restartInsertNewChapters, setRestartInsertNewChapters] = useState(false);
  const [restartTargetMinWords, setRestartTargetMinWords] = useState(2000);
  
  // User instructions for awaiting_instructions state
  const [userInstructions, setUserInstructions] = useState("");
  
  // Chat panel state
  const [showChat, setShowChat] = useState(false);

  const { data: projects = [], isLoading: projectsLoading } = useQuery<ReeditProject[]>({
    queryKey: ["/api/reedit-projects"],
    refetchInterval: 5000,
  });

  const { data: chapters = [] } = useQuery<ReeditChapter[]>({
    queryKey: ["/api/reedit-projects", selectedProject, "chapters"],
    enabled: !!selectedProject,
    refetchInterval: 3000,
  });

  const { data: worldBible } = useQuery<any>({
    queryKey: ["/api/reedit-projects", selectedProject, "world-bible"],
    enabled: !!selectedProject,
    refetchInterval: 10000,
  });

  const { data: auditReports = [] } = useQuery<any[]>({
    queryKey: ["/api/reedit-projects", selectedProject, "audit-reports"],
    enabled: !!selectedProject,
    refetchInterval: 5000,
  });

  // Fetch issues for awaiting_issue_approval state
  const { data: issuesList = [] } = useQuery<any[]>({
    queryKey: ["/api/reedit-projects", selectedProject, "issues"],
    enabled: !!selectedProject,
    refetchInterval: 3000,
  });

  const { data: issuesSummary } = useQuery<any>({
    queryKey: ["/api/reedit-projects", selectedProject, "issues", "summary"],
    enabled: !!selectedProject,
    refetchInterval: 5000,
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

  const forceUnlockMutation = useMutation({
    mutationFn: async (projectId: number) => {
      return apiRequest("POST", `/api/reedit-projects/${projectId}/force-unlock`);
    },
    onSuccess: () => {
      toast({ title: "Desbloqueado", description: "El proyecto ha sido desbloqueado. Ahora puedes continuar o reiniciar." });
      queryClient.invalidateQueries({ queryKey: ["/api/reedit-projects"] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const resumeMutation = useMutation({
    mutationFn: async ({ projectId, instructions }: { projectId: number; instructions?: string }) => {
      return apiRequest("POST", `/api/reedit-projects/${projectId}/resume`, { instructions });
    },
    onSuccess: () => {
      toast({ title: "Procesamiento Reanudado", description: "El manuscrito continúa siendo reeditado" });
      queryClient.invalidateQueries({ queryKey: ["/api/reedit-projects"] });
      setUserInstructions("");
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  // Issue management mutations
  const approveIssueMutation = useMutation({
    mutationFn: async (issueId: number) => {
      return apiRequest("POST", `/api/reedit-issues/${issueId}/approve`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/reedit-projects", selectedProject, "issues"] });
      queryClient.invalidateQueries({ queryKey: ["/api/reedit-projects", selectedProject, "issues", "summary"] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const rejectIssueMutation = useMutation({
    mutationFn: async ({ issueId, reason }: { issueId: number; reason?: string }) => {
      return apiRequest("POST", `/api/reedit-issues/${issueId}/reject`, { reason });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/reedit-projects", selectedProject, "issues"] });
      queryClient.invalidateQueries({ queryKey: ["/api/reedit-projects", selectedProject, "issues", "summary"] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const approveAllIssuesMutation = useMutation({
    mutationFn: async (projectId: number) => {
      return apiRequest("POST", `/api/reedit-projects/${projectId}/issues/approve-all`);
    },
    onSuccess: () => {
      toast({ title: "Todos Aprobados", description: "Todos los problemas han sido aprobados para corrección" });
      queryClient.invalidateQueries({ queryKey: ["/api/reedit-projects", selectedProject, "issues"] });
      queryClient.invalidateQueries({ queryKey: ["/api/reedit-projects", selectedProject, "issues", "summary"] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const rejectAllIssuesMutation = useMutation({
    mutationFn: async (projectId: number) => {
      return apiRequest("POST", `/api/reedit-projects/${projectId}/issues/reject-all`, { reason: "Bulk rejected by user" });
    },
    onSuccess: () => {
      toast({ title: "Todos Rechazados", description: "Todos los problemas han sido ignorados" });
      queryClient.invalidateQueries({ queryKey: ["/api/reedit-projects", selectedProject, "issues"] });
      queryClient.invalidateQueries({ queryKey: ["/api/reedit-projects", selectedProject, "issues", "summary"] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const proceedCorrectionsMutation = useMutation({
    mutationFn: async (projectId: number) => {
      return apiRequest("POST", `/api/reedit-projects/${projectId}/proceed-corrections`);
    },
    onSuccess: (data: any) => {
      toast({ title: "Correcciones Iniciadas", description: `Procediendo con ${data.approvedCount || 0} correcciones aprobadas` });
      queryClient.invalidateQueries({ queryKey: ["/api/reedit-projects"] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
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

  const restartMutation = useMutation({
    mutationFn: async (params: { projectId: number; expandChapters: boolean; insertNewChapters: boolean; targetMinWordsPerChapter: number }) => {
      return apiRequest("POST", `/api/reedit-projects/${params.projectId}/restart`, {
        expandChapters: params.expandChapters,
        insertNewChapters: params.insertNewChapters,
        targetMinWordsPerChapter: params.targetMinWordsPerChapter,
      });
    },
    onSuccess: () => {
      toast({ title: "Proyecto Reiniciado", description: "El proyecto usará la versión editada como base para la nueva reedición." });
      queryClient.invalidateQueries({ queryKey: ["/api/reedit-projects"] });
      setShowRestartDialog(false);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleRestartProject = useCallback(() => {
    if (!selectedProjectData) return;
    restartMutation.mutate({
      projectId: selectedProjectData.id,
      expandChapters: restartExpandChapters,
      insertNewChapters: restartInsertNewChapters,
      targetMinWordsPerChapter: restartTargetMinWords,
    });
  }, [selectedProjectData, restartExpandChapters, restartInsertNewChapters, restartTargetMinWords, restartMutation]);

  const openRestartDialog = useCallback(() => {
    if (selectedProjectData) {
      // Initialize with current project settings
      setRestartExpandChapters(selectedProjectData.expandChapters || false);
      setRestartInsertNewChapters(selectedProjectData.insertNewChapters || false);
      setRestartTargetMinWords(selectedProjectData.targetMinWordsPerChapter || 2000);
      setShowRestartDialog(true);
    }
  }, [selectedProjectData]);

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
    formData.append("expandChapters", expandChapters.toString());
    formData.append("insertNewChapters", insertNewChapters.toString());
    formData.append("targetMinWordsPerChapter", targetMinWords.toString());
    if (uploadInstructions.trim()) {
      formData.append("instructions", uploadInstructions.trim());
    }
    try {
      await uploadMutation.mutateAsync(formData);
      setUploadInstructions("");
    } finally {
      setIsUploading(false);
    }
  }, [uploadFile, uploadTitle, uploadLanguage, expandChapters, insertNewChapters, targetMinWords, uploadInstructions, uploadMutation, toast]);

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

      <div className={`grid grid-cols-1 gap-6 ${showChat ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}>
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
              <div className="space-y-3 pt-2 border-t">
                <p className="text-sm font-medium">Opciones de Expansión</p>
                <div className="flex items-center justify-between">
                  <Label htmlFor="expand-chapters" className="text-sm cursor-pointer">
                    Expandir capítulos cortos
                  </Label>
                  <Switch
                    id="expand-chapters"
                    data-testid="switch-expand-chapters"
                    checked={expandChapters}
                    onCheckedChange={setExpandChapters}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="insert-chapters" className="text-sm cursor-pointer">
                    Insertar nuevos capítulos
                  </Label>
                  <Switch
                    id="insert-chapters"
                    data-testid="switch-insert-chapters"
                    checked={insertNewChapters}
                    onCheckedChange={setInsertNewChapters}
                  />
                </div>
                {(expandChapters || insertNewChapters) && (
                  <div>
                    <Label htmlFor="target-words" className="text-sm">
                      Palabras mínimas por capítulo
                    </Label>
                    <Input
                      id="target-words"
                      type="number"
                      data-testid="input-target-words"
                      value={targetMinWords}
                      onChange={(e) => setTargetMinWords(parseInt(e.target.value) || 2000)}
                      min={500}
                      max={5000}
                      step={100}
                      className="mt-1"
                    />
                  </div>
                )}
              </div>
              <div className="space-y-2 pt-2 border-t">
                <Label htmlFor="upload-instructions" className="text-sm font-medium">
                  Instrucciones para la reedición (opcional)
                </Label>
                <textarea
                  id="upload-instructions"
                  data-testid="textarea-upload-instructions"
                  value={uploadInstructions}
                  onChange={(e) => setUploadInstructions(e.target.value)}
                  placeholder="Instrucciones específicas para guiar la reedición: cambios de tono, aspectos a mejorar, elementos a preservar..."
                  className="w-full min-h-[80px] p-2 text-sm border rounded-md bg-background resize-y"
                  rows={3}
                />
                <p className="text-xs text-muted-foreground">
                  Estas instrucciones guiarán a los agentes de IA durante todo el proceso de reedición.
                </p>
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
                <div className="space-y-2 max-h-[400px] overflow-y-auto">
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
                      <>
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
                        <Button
                          variant="outline"
                          onClick={() => forceUnlockMutation.mutate(selectedProjectData.id)}
                          disabled={forceUnlockMutation.isPending}
                          data-testid="button-force-unlock"
                        >
                          {forceUnlockMutation.isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          ) : (
                            <Unlock className="h-4 w-4 mr-2" />
                          )}
                          Desbloquear
                        </Button>
                      </>
                    )}
                    {selectedProjectData.status === "error" && (
                      <Button
                        onClick={() => resumeMutation.mutate({ projectId: selectedProjectData.id })}
                        disabled={resumeMutation.isPending}
                        data-testid="button-resume-reedit"
                      >
                        {resumeMutation.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        ) : (
                          <Play className="h-4 w-4 mr-2" />
                        )}
                        Continuar
                      </Button>
                    )}
                    {selectedProjectData.status === "awaiting_instructions" && (
                      <Button
                        onClick={() => resumeMutation.mutate({ projectId: selectedProjectData.id, instructions: userInstructions })}
                        disabled={resumeMutation.isPending}
                        data-testid="button-resume-with-instructions"
                      >
                        {resumeMutation.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        ) : (
                          <Play className="h-4 w-4 mr-2" />
                        )}
                        Continuar con Instrucciones
                      </Button>
                    )}
                    {selectedProjectData.status === "completed" && (
                      <Button
                        variant="outline"
                        onClick={openRestartDialog}
                        data-testid="button-restart-reedit"
                      >
                        <RotateCcw className="h-4 w-4 mr-2" />
                        Reeditar de Nuevo
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
                    <Button
                      variant={showChat ? "secondary" : "outline"}
                      onClick={() => setShowChat(!showChat)}
                      data-testid="button-toggle-chat-reedit"
                    >
                      <MessageSquare className="h-4 w-4 mr-2" />
                      {showChat ? "Cerrar Chat" : "Reeditor IA"}
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue="live-report">
                  <TabsList className="flex-wrap h-auto">
                    <TabsTrigger value="live-report" data-testid="tab-trigger-live-report">Informe Progreso</TabsTrigger>
                    <TabsTrigger value="progress" data-testid="tab-trigger-progress">Estado</TabsTrigger>
                    <TabsTrigger value="chapters" data-testid="tab-trigger-chapters">Capítulos</TabsTrigger>
                    <TabsTrigger value="worldbible" data-testid="tab-trigger-worldbible">Biblia del Mundo</TabsTrigger>
                    <TabsTrigger value="audits" data-testid="tab-trigger-audits">Auditorías QA</TabsTrigger>
                    <TabsTrigger value="report" data-testid="tab-trigger-report">Informe Final</TabsTrigger>
                  </TabsList>

                  <TabsContent value="live-report">
                    <ScrollArea className="h-[500px] mt-4 pr-4">
                      {chapters.length > 0 ? (
                        <ProgressReportDisplay 
                          project={selectedProjectData} 
                          chapters={chapters} 
                        />
                      ) : (
                        <div className="text-center text-muted-foreground py-12">
                          <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
                          <p>El informe de progreso aparecerá cuando se carguen los capítulos</p>
                        </div>
                      )}
                    </ScrollArea>
                  </TabsContent>

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
                      <div className="space-y-3">
                        <div className="flex items-center justify-between text-sm mb-2">
                          <span>Procesando manuscrito...</span>
                          <span>{Math.round(progress)}%</span>
                        </div>
                        <Progress value={progress} />
                        {selectedProjectData.currentActivity && (
                          <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 p-3 rounded-md" data-testid="text-current-activity">
                            <Loader2 className="h-4 w-4 animate-spin flex-shrink-0" />
                            <span className="line-clamp-2">{selectedProjectData.currentActivity}</span>
                          </div>
                        )}
                      </div>
                    )}

                    {selectedProjectData.status === "awaiting_instructions" && (
                      <Card className="border-amber-500/50 bg-amber-50/50 dark:bg-amber-950/20">
                        <CardContent className="pt-6 space-y-4">
                          <div className="flex items-start gap-3">
                            <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
                            <div>
                              <p className="font-medium text-amber-800 dark:text-amber-200">Pausa Automática - Instrucciones Requeridas</p>
                              <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                                {(selectedProjectData as any).pauseReason || "El sistema ha pausado después de 15 evaluaciones sin alcanzar la puntuación perfecta (10/10)."}
                              </p>
                            </div>
                          </div>
                          <div className="space-y-2">
                            <label className="text-sm font-medium">Instrucciones para el agente (opcional):</label>
                            <textarea
                              className="w-full min-h-[100px] p-3 border rounded-md bg-background resize-y"
                              placeholder="Ej: Enfócate en mejorar el ritmo narrativo de los capítulos 5-8. El tono debería ser más oscuro..."
                              value={userInstructions}
                              onChange={(e) => setUserInstructions(e.target.value)}
                              data-testid="input-user-instructions"
                            />
                            <p className="text-xs text-muted-foreground">
                              Estas instrucciones se pasarán al agente en el próximo ciclo de corrección.
                            </p>
                          </div>
                        </CardContent>
                      </Card>
                    )}

                    {selectedProjectData.status === "awaiting_issue_approval" && (
                      <Card className="border-orange-500/50 bg-orange-50/50 dark:bg-orange-950/20">
                        <CardContent className="pt-6 space-y-4">
                          <div className="flex items-start gap-3">
                            <AlertCircle className="h-5 w-5 text-orange-600 flex-shrink-0 mt-0.5" />
                            <div>
                              <p className="font-medium text-orange-800 dark:text-orange-200">Revisión de Problemas Detectados</p>
                              <p className="text-sm text-orange-700 dark:text-orange-300 mt-1">
                                {selectedProjectData.pauseReason || "Se han detectado problemas que requieren tu aprobación antes de corregirlos automáticamente."}
                              </p>
                            </div>
                          </div>
                          
                          {issuesSummary && (
                            <div className="grid grid-cols-4 gap-2 text-center">
                              <div className="p-2 bg-orange-100 dark:bg-orange-900/30 rounded-md">
                                <p className="text-lg font-bold text-orange-700 dark:text-orange-300">{issuesSummary.pending || 0}</p>
                                <p className="text-xs text-orange-600 dark:text-orange-400">Pendientes</p>
                              </div>
                              <div className="p-2 bg-green-100 dark:bg-green-900/30 rounded-md">
                                <p className="text-lg font-bold text-green-700 dark:text-green-300">{issuesSummary.approved || 0}</p>
                                <p className="text-xs text-green-600 dark:text-green-400">Aprobados</p>
                              </div>
                              <div className="p-2 bg-gray-100 dark:bg-gray-800 rounded-md">
                                <p className="text-lg font-bold text-gray-700 dark:text-gray-300">{issuesSummary.rejected || 0}</p>
                                <p className="text-xs text-gray-600 dark:text-gray-400">Rechazados</p>
                              </div>
                              <div className="p-2 bg-red-100 dark:bg-red-900/30 rounded-md">
                                <p className="text-lg font-bold text-red-700 dark:text-red-300">{issuesSummary.bySeverity?.critical || 0}</p>
                                <p className="text-xs text-red-600 dark:text-red-400">Críticos</p>
                              </div>
                            </div>
                          )}

                          <div className="flex items-center gap-2 flex-wrap">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => selectedProjectData && approveAllIssuesMutation.mutate(selectedProjectData.id)}
                              disabled={approveAllIssuesMutation.isPending || (issuesSummary?.pending || 0) === 0}
                              data-testid="button-approve-all-issues"
                            >
                              <CheckCircle className="h-4 w-4 mr-1" />
                              Aprobar Todos
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => selectedProjectData && rejectAllIssuesMutation.mutate(selectedProjectData.id)}
                              disabled={rejectAllIssuesMutation.isPending || (issuesSummary?.pending || 0) === 0}
                              data-testid="button-reject-all-issues"
                            >
                              <XCircle className="h-4 w-4 mr-1" />
                              Ignorar Todos
                            </Button>
                          </div>

                          <ScrollArea className="h-[300px] border rounded-md p-2">
                            <div className="space-y-2">
                              {/* Pending issues (actionable) */}
                              {issuesList.filter((i: any) => i.status === "pending").map((issue: any) => (
                                <div 
                                  key={issue.id} 
                                  className={`p-3 border rounded-md ${
                                    issue.severity === "critical" ? "border-red-400 bg-red-50 dark:bg-red-950/30" :
                                    issue.severity === "major" ? "border-orange-400 bg-orange-50 dark:bg-orange-950/30" :
                                    "border-gray-300 bg-gray-50 dark:bg-gray-900/30"
                                  }`}
                                  data-testid={`issue-card-${issue.id}`}
                                >
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="flex-1">
                                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                                        <Badge variant={
                                          issue.severity === "critical" ? "destructive" :
                                          issue.severity === "major" ? "default" : "secondary"
                                        }>
                                          {issue.severity === "critical" ? "Crítico" :
                                           issue.severity === "major" ? "Mayor" : "Menor"}
                                        </Badge>
                                        <Badge variant="outline">{issue.category}</Badge>
                                        <span className="text-xs text-muted-foreground">Cap. {issue.chapterNumber}</span>
                                      </div>
                                      <p className="text-sm">{issue.description}</p>
                                      {issue.correctionInstruction && (
                                        <p className="text-xs text-muted-foreground mt-1 italic">
                                          Corrección: {issue.correctionInstruction.substring(0, 150)}...
                                        </p>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-1">
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        className="h-7 w-7 text-green-600 hover:bg-green-100"
                                        onClick={() => approveIssueMutation.mutate(issue.id)}
                                        disabled={approveIssueMutation.isPending}
                                        data-testid={`button-approve-issue-${issue.id}`}
                                      >
                                        <Check className="h-4 w-4" />
                                      </Button>
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        className="h-7 w-7 text-red-600 hover:bg-red-100"
                                        onClick={() => rejectIssueMutation.mutate({ issueId: issue.id })}
                                        disabled={rejectIssueMutation.isPending}
                                        data-testid={`button-reject-issue-${issue.id}`}
                                      >
                                        <X className="h-4 w-4" />
                                      </Button>
                                    </div>
                                  </div>
                                </div>
                              ))}
                              
                              {/* Resolved issues (tachados / crossed off) */}
                              {issuesList.filter((i: any) => i.status === "resolved").length > 0 && (
                                <div className="mt-4 pt-4 border-t border-dashed">
                                  <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
                                    <CheckCircle className="h-3 w-3 text-green-600" />
                                    Problemas corregidos ({issuesList.filter((i: any) => i.status === "resolved").length})
                                  </p>
                                  {issuesList.filter((i: any) => i.status === "resolved").map((issue: any) => (
                                    <div 
                                      key={issue.id} 
                                      className="p-2 border rounded-md border-green-200 bg-green-50/50 dark:bg-green-950/20 mb-1 opacity-60"
                                      data-testid={`issue-card-resolved-${issue.id}`}
                                    >
                                      <div className="flex items-center gap-2">
                                        <CheckCircle className="h-4 w-4 text-green-600 flex-shrink-0" />
                                        <div className="flex-1">
                                          <div className="flex items-center gap-2 flex-wrap">
                                            <Badge variant="outline" className="text-xs opacity-70">{issue.category}</Badge>
                                            <span className="text-xs text-muted-foreground">Cap. {issue.chapterNumber}</span>
                                          </div>
                                          <p className="text-sm line-through text-muted-foreground">{issue.description}</p>
                                        </div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                              
                              {issuesList.filter((i: any) => i.status === "pending").length === 0 && 
                               issuesList.filter((i: any) => i.status === "resolved").length === 0 && (
                                <div className="text-center py-8 text-muted-foreground">
                                  <CheckCircle className="h-8 w-8 mx-auto mb-2 text-green-600" />
                                  <p>Todos los problemas han sido revisados</p>
                                </div>
                              )}
                            </div>
                          </ScrollArea>

                          {(issuesSummary?.pending || 0) === 0 && (
                            <Button
                              className="w-full"
                              onClick={() => selectedProjectData && proceedCorrectionsMutation.mutate(selectedProjectData.id)}
                              disabled={proceedCorrectionsMutation.isPending}
                              data-testid="button-proceed-corrections"
                            >
                              {proceedCorrectionsMutation.isPending ? (
                                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                              ) : (
                                <Play className="h-4 w-4 mr-2" />
                              )}
                              {(issuesSummary?.approved || 0) > 0 
                                ? `Proceder con ${issuesSummary?.approved || 0} Correcciones`
                                : "Finalizar sin Correcciones"}
                            </Button>
                          )}
                        </CardContent>
                      </Card>
                    )}

                    <RealTimeCostWidget 
                      projectId={selectedProjectData.id} 
                      isProcessing={selectedProjectData.status === "processing"} 
                    />

                    {selectedProjectData.bestsellerScore && (
                      <Card className="bg-muted/50">
                        <CardContent className="pt-6">
                          <div className="flex items-center justify-between gap-4 flex-wrap">
                            <div>
                              <p className="text-sm text-muted-foreground">Puntuación Bestseller</p>
                              <ScoreDisplay score={selectedProjectData.bestsellerScore} />
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
                                  <Badge variant="outline">{getChapterBadgeLabel(chapter.chapterNumber)}</Badge>
                                  <span className="font-medium">{getChapterLabel(chapter.chapterNumber, chapter.title)}</span>
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

                  <TabsContent value="worldbible">
                    <ScrollArea className="h-[400px] mt-4">
                      {worldBible ? (
                        <Card>
                          <CardHeader>
                            <CardTitle className="text-base">Biblia del Mundo Narrativo</CardTitle>
                            <CardDescription>
                              Personajes, ubicaciones, línea temporal y reglas extraídas del manuscrito
                            </CardDescription>
                          </CardHeader>
                          <CardContent>
                            <WorldBibleDisplay worldBible={worldBible} />
                          </CardContent>
                        </Card>
                      ) : (
                        <div className="text-center text-muted-foreground py-12">
                          <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
                          <p>La Biblia del Mundo se generará durante el procesamiento</p>
                        </div>
                      )}
                    </ScrollArea>
                  </TabsContent>

                  <TabsContent value="audits">
                    <ScrollArea className="h-[400px] mt-4">
                      {auditReports.length > 0 ? (
                        <AuditReportsDisplay reports={auditReports} />
                      ) : (
                        <div className="text-center text-muted-foreground py-12">
                          <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
                          <p>Los informes de auditoría se generarán durante el procesamiento</p>
                        </div>
                      )}
                    </ScrollArea>
                  </TabsContent>

                  <TabsContent value="report">
                    {selectedProjectData.finalReviewResult ? (
                      <Card className="mt-4">
                        <CardHeader>
                          <CardTitle className="flex items-center gap-2">
                            <Star className="h-5 w-5 text-yellow-500" />
                            Resultados de la Revisión Final
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <FinalReviewDisplay result={selectedProjectData.finalReviewResult} />
                          <div className="mt-4 flex justify-end gap-2 flex-wrap">
                            <Button 
                              variant="outline" 
                              data-testid="button-download-reedit-docx"
                              onClick={() => {
                                window.open(`/api/reedit-projects/${selectedProjectData.id}/export`, '_blank');
                              }}
                            >
                              <Download className="h-4 w-4 mr-2" />
                              Exportar Word (.docx)
                            </Button>
                            <Button 
                              variant="outline" 
                              data-testid="button-download-reedit-md"
                              onClick={() => {
                                window.open(`/api/reedit-projects/${selectedProjectData.id}/export-md`, '_blank');
                              }}
                            >
                              <Download className="h-4 w-4 mr-2" />
                              Exportar Markdown (.md)
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

        {showChat && selectedProject && (
          <ChatPanel
            agentType="reeditor"
            reeditProjectId={selectedProject}
            className="lg:col-span-1 h-[calc(100vh-200px)]"
            onClose={() => setShowChat(false)}
          />
        )}
      </div>

      {/* Restart Dialog */}
      <Dialog open={showRestartDialog} onOpenChange={setShowRestartDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reeditar de Nuevo</DialogTitle>
            <DialogDescription>
              El proyecto se reiniciará usando la versión editada como base para la nueva reedición.
              Configura las opciones de expansión si lo deseas.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="flex items-center justify-between">
              <div>
                <Label>Expandir Capítulos Cortos</Label>
                <p className="text-xs text-muted-foreground">Añade escenas y diálogos a capítulos por debajo del mínimo</p>
              </div>
              <Switch
                checked={restartExpandChapters}
                onCheckedChange={setRestartExpandChapters}
                data-testid="switch-restart-expand-chapters"
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label>Insertar Nuevos Capítulos</Label>
                <p className="text-xs text-muted-foreground">Detecta huecos narrativos e inserta capítulos intermedios</p>
              </div>
              <Switch
                checked={restartInsertNewChapters}
                onCheckedChange={setRestartInsertNewChapters}
                data-testid="switch-restart-insert-chapters"
              />
            </div>
            {(restartExpandChapters || restartInsertNewChapters) && (
              <div>
                <Label>Palabras Mínimas por Capítulo</Label>
                <Input
                  type="number"
                  value={restartTargetMinWords}
                  onChange={(e) => setRestartTargetMinWords(parseInt(e.target.value) || 2000)}
                  min={500}
                  max={10000}
                  className="mt-1"
                  data-testid="input-restart-min-words"
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRestartDialog(false)}>
              Cancelar
            </Button>
            <Button 
              onClick={handleRestartProject}
              disabled={restartMutation.isPending}
              data-testid="button-confirm-restart"
            >
              {restartMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <RotateCcw className="h-4 w-4 mr-2" />
              )}
              Reiniciar Proyecto
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
