import { useState, useCallback, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
  XCircle,
  Wand2,
  RefreshCw
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

// Gemini 2.5 Flash pricing (USD per million tokens)
const INPUT_PRICE_PER_MILLION = 0.15;
const OUTPUT_PRICE_PER_MILLION = 0.60;
const THINKING_PRICE_PER_MILLION = 3.50;

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
    paused: "Pausado",
    completed: "Completado",
    error: "Error",
    awaiting_instructions: "Esperando Instrucciones",
    awaiting_issue_approval: "Revisión de Problemas",
  };
  const variants: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; icon: typeof CheckCircle }> = {
    pending: { variant: "outline", icon: Clock },
    processing: { variant: "secondary", icon: Loader2 },
    paused: { variant: "outline", icon: Pause },
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

// LitEditors 3.0: Structural Report Display Component
function StructuralReportDisplay({ report }: { report: any }) {
  if (!report) return null;

  const getSeverityBadge = (severity: string) => {
    switch (severity?.toLowerCase()) {
      case 'critical':
      case 'critico':
        return <Badge variant="destructive">Crítico</Badge>;
      case 'major':
      case 'mayor':
        return <Badge className="bg-orange-500">Mayor</Badge>;
      case 'minor':
      case 'menor':
        return <Badge variant="secondary">Menor</Badge>;
      default:
        return <Badge variant="outline">{severity}</Badge>;
    }
  };

  return (
    <div className="space-y-4">
      {report.critique && (
        <div className="p-4 bg-muted/50 rounded-lg">
          <h4 className="font-semibold mb-2">Crítica General</h4>
          <p className="text-sm text-muted-foreground">{report.critique}</p>
        </div>
      )}

      {report.plot_holes && report.plot_holes.length > 0 && (
        <div>
          <h4 className="font-semibold mb-2 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-red-500" />
            Huecos en la Trama ({report.plot_holes.length})
          </h4>
          <div className="space-y-2">
            {report.plot_holes.map((hole: any, idx: number) => (
              <Card key={idx} className="border-red-500/30">
                <CardContent className="py-3">
                  <div className="flex items-start gap-2">
                    <Badge variant="outline" className="shrink-0">Cap. {hole.chapter || hole.between_chapters}</Badge>
                    <div>
                      <p className="text-sm font-medium">{hole.issue || hole.description}</p>
                      {hole.suggestion && (
                        <p className="text-xs text-muted-foreground mt-1">Sugerencia: {hole.suggestion}</p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {report.redundancies && report.redundancies.length > 0 && (
        <div>
          <h4 className="font-semibold mb-2 flex items-center gap-2">
            <XCircle className="h-4 w-4 text-orange-500" />
            Redundancias ({report.redundancies.length})
          </h4>
          <div className="space-y-2">
            {report.redundancies.map((red: any, idx: number) => (
              <Card key={idx} className="border-orange-500/30">
                <CardContent className="py-3">
                  <div className="flex items-start gap-2">
                    <Badge variant="outline" className="shrink-0">Caps. {red.chapters?.join(', ') || red.chapter}</Badge>
                    <p className="text-sm">{red.issue || red.description}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {report.pacing_issues && report.pacing_issues.length > 0 && (
        <div>
          <h4 className="font-semibold mb-2 flex items-center gap-2">
            <Clock className="h-4 w-4 text-yellow-500" />
            Problemas de Ritmo ({report.pacing_issues.length})
          </h4>
          <div className="space-y-2">
            {report.pacing_issues.map((pace: any, idx: number) => (
              <Card key={idx} className="border-yellow-500/30">
                <CardContent className="py-3">
                  <div className="flex items-start gap-2">
                    <Badge variant="outline" className="shrink-0">{pace.section || `Cap. ${pace.chapter}`}</Badge>
                    <p className="text-sm">{pace.issue || pace.description}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {report.anachronisms_warning && report.anachronisms_warning.length > 0 && (
        <div>
          <h4 className="font-semibold mb-2 flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-purple-500" />
            Anacronismos Detectados ({report.anachronisms_warning.length})
          </h4>
          <div className="space-y-2">
            {report.anachronisms_warning.map((ana: any, idx: number) => (
              <Card key={idx} className="border-purple-500/30">
                <CardContent className="py-3">
                  <div className="flex items-start gap-2">
                    <Badge variant="outline" className="shrink-0">Cap. {ana.chapter}</Badge>
                    <div>
                      <p className="text-sm font-medium">{ana.element || ana.issue}</p>
                      {ana.reason && (
                        <p className="text-xs text-muted-foreground mt-1">{ana.reason}</p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {(!report.plot_holes || report.plot_holes.length === 0) &&
       (!report.redundancies || report.redundancies.length === 0) &&
       (!report.pacing_issues || report.pacing_issues.length === 0) &&
       (!report.anachronisms_warning || report.anachronisms_warning.length === 0) && (
        <div className="text-center py-8 text-muted-foreground">
          <CheckCircle className="h-12 w-12 mx-auto mb-4 text-green-500" />
          <p className="font-medium">No se detectaron problemas estructurales</p>
          <p className="text-sm">El manuscrito tiene una estructura sólida.</p>
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

interface QualityReportIssue {
  id: string;
  capitulosAfectados: number[];
  titulosCapitulos: string[];
  extractoTexto?: string;
  categoria: string;
  descripcion: string;
  severidad: "critica" | "mayor" | "menor";
  instruccionCorreccion: string;
  elementosAPreservar?: string;
  estado: "pendiente" | "corregido" | "ignorado";
}

interface QualityReport {
  projectId: number;
  projectTitle: string;
  fechaGeneracion: string;
  ciclosCompletados: number;
  puntuacionGlobal: number;
  puntuacionesDesglosadas: {
    enganche: number;
    personajes: number;
    trama: number;
    atmosfera: number;
    ritmo: number;
  };
  issuesCriticos: QualityReportIssue[];
  issuesMayores: QualityReportIssue[];
  issuesMenores: QualityReportIssue[];
  totalIssues: number;
  esPublicable: boolean;
  razonPublicabilidad: string;
  recomendacionesFinales: string[];
  totalCapitulos: number;
  totalPalabras: number;
  capitulosConProblemas: number[];
}

function QualityReportDisplay({ projectId }: { projectId: number }) {
  const { data: report, isLoading, error } = useQuery<QualityReport>({
    queryKey: ["/api/reedit-projects", projectId, "quality-report"],
    queryFn: async () => {
      const res = await fetch(`/api/reedit-projects/${projectId}/quality-report`);
      if (!res.ok) throw new Error("Failed to fetch quality report");
      return res.json();
    },
    enabled: !!projectId,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <span className="ml-2 text-muted-foreground">Generando informe de calidad...</span>
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="text-center text-muted-foreground py-12">
        <AlertCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
        <p>No hay informe de calidad disponible.</p>
        <p className="text-sm">Complete al menos un ciclo de revisión para generar el informe.</p>
      </div>
    );
  }

  const getCategoriaLabel = (cat: string) => {
    const labels: Record<string, string> = {
      enganche: "Enganche",
      personajes: "Personajes",
      trama: "Trama",
      atmosfera: "Atmósfera",
      ritmo: "Ritmo",
      continuidad_fisica: "Continuidad Física",
      timeline: "Línea Temporal",
      ubicacion: "Ubicación",
      repeticion_lexica: "Repetición Léxica",
      arco_incompleto: "Arco Incompleto",
      tension_insuficiente: "Tensión Insuficiente",
      giro_predecible: "Giro Predecible",
      hook_debil: "Hook Débil",
      credibilidad_narrativa: "Credibilidad Narrativa",
      otro: "Otro",
    };
    return labels[cat] || cat;
  };

  const getSeveridadBadge = (sev: string) => {
    if (sev === "critica") return <Badge variant="destructive">Crítico</Badge>;
    if (sev === "mayor") return <Badge className="bg-orange-500 hover:bg-orange-600">Mayor</Badge>;
    return <Badge variant="secondary">Menor</Badge>;
  };

  const renderIssueList = (issues: QualityReportIssue[], title: string, icon: JSX.Element) => {
    if (issues.length === 0) return null;
    
    const getBorderColor = (sev: string) => {
      if (sev === "critica") return "border-l-red-500";
      if (sev === "mayor") return "border-l-orange-500";
      return "border-l-yellow-500";
    };
    
    return (
      <div className="mb-6">
        <h4 className="font-medium flex items-center gap-2 mb-3">
          {icon}
          {title} ({issues.length})
        </h4>
        <div className="space-y-3">
          {issues.map((issue) => (
            <Card key={issue.id} className={`border-l-4 ${getBorderColor(issue.severidad)}`}>
              <CardContent className="py-3 px-4">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    {issue.titulosCapitulos.map((titulo, idx) => (
                      <Badge key={idx} variant="outline">{titulo}</Badge>
                    ))}
                    <Badge variant="outline" className="text-xs">{getCategoriaLabel(issue.categoria)}</Badge>
                    {getSeveridadBadge(issue.severidad)}
                  </div>
                </div>
                
                {/* Location info */}
                {issue.capitulosAfectados.length > 0 && (
                  <div className="text-xs text-muted-foreground mb-2">
                    <strong>Ubicación:</strong> {issue.capitulosAfectados.length === 1 
                      ? `Capítulo ${issue.capitulosAfectados[0]}` 
                      : `Capítulos ${issue.capitulosAfectados.join(", ")}`}
                  </div>
                )}
                
                {/* Text excerpt if available */}
                {issue.extractoTexto && (
                  <div className="text-xs bg-muted/50 border-l-2 border-primary/30 pl-2 py-1 mb-2 italic">
                    "{issue.extractoTexto}"
                  </div>
                )}
                
                <p className="text-sm mb-2">{issue.descripcion}</p>
                
                {issue.instruccionCorreccion && (
                  <div className="text-xs text-muted-foreground bg-muted p-2 rounded mb-2">
                    <strong>Corrección sugerida:</strong> {issue.instruccionCorreccion.substring(0, 300)}
                    {issue.instruccionCorreccion.length > 300 && "..."}
                  </div>
                )}
                
                {issue.elementosAPreservar && (
                  <div className="text-xs text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 p-2 rounded">
                    <strong>No modificar:</strong> {issue.elementosAPreservar.substring(0, 150)}
                    {issue.elementosAPreservar.length > 150 && "..."}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  };

  return (
    <ScrollArea className="h-[600px] mt-4 pr-4">
      <div className="space-y-6">
        {/* Header with score and publishability */}
        <Card className={report.esPublicable ? "border-green-500" : "border-orange-500"}>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Star className="h-5 w-5 text-yellow-500" />
                Informe de Calidad
              </span>
              <div className="flex items-center gap-2">
                <span className="text-3xl font-bold">{report.puntuacionGlobal}/10</span>
                {report.esPublicable ? (
                  <Badge className="bg-green-500 hover:bg-green-600">Publicable</Badge>
                ) : (
                  <Badge variant="destructive">No Publicable</Badge>
                )}
              </div>
            </CardTitle>
            <CardDescription>{report.razonPublicabilidad}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-4">
              <div className="text-center p-2 bg-muted rounded">
                <div className="text-2xl font-bold">{report.puntuacionesDesglosadas.enganche}</div>
                <div className="text-xs text-muted-foreground">Enganche</div>
              </div>
              <div className="text-center p-2 bg-muted rounded">
                <div className="text-2xl font-bold">{report.puntuacionesDesglosadas.personajes}</div>
                <div className="text-xs text-muted-foreground">Personajes</div>
              </div>
              <div className="text-center p-2 bg-muted rounded">
                <div className="text-2xl font-bold">{report.puntuacionesDesglosadas.trama}</div>
                <div className="text-xs text-muted-foreground">Trama</div>
              </div>
              <div className="text-center p-2 bg-muted rounded">
                <div className="text-2xl font-bold">{report.puntuacionesDesglosadas.atmosfera}</div>
                <div className="text-xs text-muted-foreground">Atmósfera</div>
              </div>
              <div className="text-center p-2 bg-muted rounded">
                <div className="text-2xl font-bold">{report.puntuacionesDesglosadas.ritmo}</div>
                <div className="text-xs text-muted-foreground">Ritmo</div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4 text-center text-sm">
              <div>
                <div className="font-medium">{report.totalCapitulos}</div>
                <div className="text-muted-foreground">Capítulos</div>
              </div>
              <div>
                <div className="font-medium">{report.totalPalabras.toLocaleString()}</div>
                <div className="text-muted-foreground">Palabras</div>
              </div>
              <div>
                <div className="font-medium">{report.ciclosCompletados}</div>
                <div className="text-muted-foreground">Ciclos</div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Issues Summary */}
        {report.totalIssues > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-orange-500" />
                Problemas Detectados ({report.totalIssues})
              </CardTitle>
              <CardDescription>
                Capítulos afectados: {report.capitulosConProblemas.length > 0 
                  ? report.capitulosConProblemas.join(", ") 
                  : "Ninguno"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {renderIssueList(report.issuesCriticos, "Errores Críticos", <XCircle className="h-4 w-4 text-red-500" />)}
              {renderIssueList(report.issuesMayores, "Errores Mayores", <AlertTriangle className="h-4 w-4 text-orange-500" />)}
              {renderIssueList(report.issuesMenores, "Errores Menores", <AlertCircle className="h-4 w-4 text-yellow-500" />)}
            </CardContent>
          </Card>
        ) : (
          <Card className="border-green-500">
            <CardContent className="py-8 text-center">
              <CheckCircle className="h-12 w-12 mx-auto mb-4 text-green-500" />
              <h3 className="text-lg font-medium text-green-700">Sin Problemas Detectados</h3>
              <p className="text-muted-foreground">El manuscrito está listo para publicación.</p>
            </CardContent>
          </Card>
        )}

        {/* Recommendations */}
        {report.recomendacionesFinales.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-blue-500" />
                Recomendaciones
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {report.recomendacionesFinales.map((rec, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    <ChevronRight className="h-4 w-4 mt-0.5 text-muted-foreground" />
                    <span className="text-sm">{rec}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        <p className="text-xs text-muted-foreground text-center">
          Informe generado: {new Date(report.fechaGeneracion).toLocaleString()}
        </p>
      </div>
    </ScrollArea>
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
  
  // LitEditors 3.0 state
  const [showStructuralDialog, setShowStructuralDialog] = useState(false);
  const [settingContext, setSettingContext] = useState("");
  const [structuralAnalysisProgress, setStructuralAnalysisProgress] = useState<{stage: string; message: string} | null>(null);
  const [showPlanApprovalDialog, setShowPlanApprovalDialog] = useState(false);
  
  // Chapter viewer state
  const [viewingChapterId, setViewingChapterId] = useState<number | null>(null);
  
  // Custom polishing dialog state
  const [showPolishingDialog, setShowPolishingDialog] = useState(false);
  const [polishingChapterRange, setPolishingChapterRange] = useState("");
  const [polishingDiagnosis, setPolishingDiagnosis] = useState("");
  const [polishingProcedure, setPolishingProcedure] = useState("");
  const [polishingObjective, setPolishingObjective] = useState("");

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

  // LitEditors 3.0: Structural analysis mutation
  const analyzeStructureMutation = useMutation({
    mutationFn: async ({ projectId, settingContext }: { projectId: number; settingContext: string }) => {
      // First update the setting context via a simple POST
      await apiRequest("PATCH", `/api/reedit-projects/${projectId}`, { settingContext });
      
      // Then start the analysis which returns the result when complete
      const result = await apiRequest("POST", `/api/reedit-projects/${projectId}/analyze-structure`, {});
      return result;
    },
    onMutate: () => {
      setStructuralAnalysisProgress({ stage: "analyzing", message: "Iniciando análisis estructural..." });
    },
    onSuccess: () => {
      setStructuralAnalysisProgress(null);
      toast({ title: "Análisis Completado", description: "El análisis estructural ha sido completado. Revisa el plan de reconstrucción." });
      queryClient.invalidateQueries({ queryKey: ["/api/reedit-projects"] });
      setShowStructuralDialog(false);
      setShowPlanApprovalDialog(true);
    },
    onError: (error: Error) => {
      setStructuralAnalysisProgress(null);
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  // LitEditors 3.0: Approve plan mutation
  const approvePlanMutation = useMutation({
    mutationFn: async ({ projectId, modifiedPlan }: { projectId: number; modifiedPlan?: any }) => {
      return apiRequest("POST", `/api/reedit-projects/${projectId}/approve-plan`, { modifiedPlan });
    },
    onSuccess: () => {
      toast({ title: "Plan Aprobado", description: "El plan de reconstrucción ha sido aprobado." });
      queryClient.invalidateQueries({ queryKey: ["/api/reedit-projects"] });
      setShowPlanApprovalDialog(false);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  // LitEditors 3.0: Execute plan mutation
  const executePlanMutation = useMutation({
    mutationFn: async (projectId: number) => {
      return apiRequest("POST", `/api/reedit-projects/${projectId}/execute-plan`);
    },
    onSuccess: () => {
      toast({ title: "Ejecución Iniciada", description: "El plan está siendo ejecutado." });
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

  const normalizeTitlesMutation = useMutation({
    mutationFn: async (projectId: number) => {
      const res = await apiRequest("POST", `/api/reedit-projects/${projectId}/normalize-titles`);
      return res.json();
    },
    onSuccess: (data) => {
      toast({ 
        title: "Títulos Normalizados", 
        description: `Se actualizaron ${data.chaptersUpdated} de ${data.totalChapters} capítulos.` 
      });
      queryClient.invalidateQueries({ queryKey: ["/api/reedit-projects", selectedProject, "chapters"] });
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

  const polishingMutation = useMutation({
    mutationFn: async (params: { projectId: number; chapterRange: string; diagnosis: string; procedure: string; objective: string }) => {
      return apiRequest("POST", `/api/reedit-projects/${params.projectId}/custom-polishing`, {
        chapterRange: params.chapterRange,
        diagnosis: params.diagnosis,
        procedure: params.procedure,
        objective: params.objective,
      });
    },
    onSuccess: () => {
      toast({ title: "Pulido Iniciado", description: "El proceso de pulido personalizado ha comenzado." });
      queryClient.invalidateQueries({ queryKey: ["/api/reedit-projects"] });
      setShowPolishingDialog(false);
      setPolishingChapterRange("");
      setPolishingDiagnosis("");
      setPolishingProcedure("");
      setPolishingObjective("");
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const openPolishingDialog = useCallback(() => {
    setPolishingChapterRange("");
    setPolishingDiagnosis("");
    setPolishingProcedure("");
    setPolishingObjective("");
    setShowPolishingDialog(true);
  }, []);

  const handlePolishingSubmit = useCallback(() => {
    if (!selectedProjectData) return;
    if (!polishingChapterRange.trim()) {
      toast({ title: "Campo Requerido", description: "Por favor indica el rango de capítulos", variant: "destructive" });
      return;
    }
    polishingMutation.mutate({
      projectId: selectedProjectData.id,
      chapterRange: polishingChapterRange.trim(),
      diagnosis: polishingDiagnosis.trim(),
      procedure: polishingProcedure.trim(),
      objective: polishingObjective.trim(),
    });
  }, [selectedProjectData, polishingChapterRange, polishingDiagnosis, polishingProcedure, polishingObjective, polishingMutation]);

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
                    {(selectedProjectData.status === "error" || selectedProjectData.status === "paused") && (
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
                      <>
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
                        <Button
                          variant="destructive"
                          onClick={() => cancelMutation.mutate(selectedProjectData.id)}
                          disabled={cancelMutation.isPending}
                          data-testid="button-cancel-awaiting"
                        >
                          {cancelMutation.isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          ) : (
                            <StopCircle className="h-4 w-4 mr-2" />
                          )}
                          Cancelar
                        </Button>
                      </>
                    )}
                    {selectedProjectData.status === "awaiting_issue_approval" && (
                      <Button
                        variant="destructive"
                        onClick={() => cancelMutation.mutate(selectedProjectData.id)}
                        disabled={cancelMutation.isPending}
                        data-testid="button-cancel-issues"
                      >
                        {cancelMutation.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        ) : (
                          <StopCircle className="h-4 w-4 mr-2" />
                        )}
                        Cancelar Proceso
                      </Button>
                    )}
                    {selectedProjectData.status === "completed" && (
                      <>
                        <Button
                          variant="outline"
                          onClick={openRestartDialog}
                          data-testid="button-restart-reedit"
                        >
                          <RotateCcw className="h-4 w-4 mr-2" />
                          Reeditar de Nuevo
                        </Button>
                        <Button
                          variant="outline"
                          onClick={openPolishingDialog}
                          data-testid="button-custom-polishing"
                        >
                          <Wand2 className="h-4 w-4 mr-2" />
                          Pulido Manual
                        </Button>
                      </>
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
                    <TabsTrigger value="structural" data-testid="tab-trigger-structural">Análisis Estructural</TabsTrigger>
                    <TabsTrigger value="audits" data-testid="tab-trigger-audits">Auditorías QA</TabsTrigger>
                    <TabsTrigger value="report" data-testid="tab-trigger-report">Informe Final</TabsTrigger>
                    <TabsTrigger value="quality-report" data-testid="tab-trigger-quality-report">Informe Calidad</TabsTrigger>
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
                        <Card className="border-blue-500/50 bg-blue-50/50 dark:bg-blue-950/20" data-testid="card-current-activity">
                          <CardContent className="py-4">
                            <div className="flex items-start gap-3">
                              <div className="flex-shrink-0 p-2 bg-blue-100 dark:bg-blue-900/50 rounded-full">
                                <Loader2 className="h-5 w-5 animate-spin text-blue-600 dark:text-blue-400" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex flex-wrap items-center gap-2 mb-2">
                                  <Badge variant="outline" className="bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" data-testid="badge-revision-cycle">
                                    <RefreshCw className="h-3 w-3 mr-1" />
                                    Ciclo {(selectedProjectData.revisionCycle || 0) + 1}
                                  </Badge>
                                  {selectedProjectData.currentChapter && selectedProjectData.currentChapter > 0 ? (
                                    <Badge variant="secondary" className="bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300">
                                      <Wand2 className="h-3 w-3 mr-1" />
                                      Reescribiendo Capitulo {selectedProjectData.currentChapter}
                                    </Badge>
                                  ) : selectedProjectData.currentStage === "reviewing" ? (
                                    <Badge variant="secondary" className="bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300">
                                      <Star className="h-3 w-3 mr-1" />
                                      Revision Final
                                    </Badge>
                                  ) : null}
                                </div>
                                <p className="text-sm font-medium text-blue-800 dark:text-blue-200">
                                  {selectedProjectData.currentActivity || "Procesando..."}
                                </p>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
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

                    {/* Historial de correcciones resueltas - visible siempre */}
                    {issuesList.filter((i: any) => i.status === "resolved").length > 0 && (
                      <Card>
                        <CardHeader className="pb-2">
                          <CardTitle className="text-base flex items-center gap-2">
                            <CheckCircle className="h-4 w-4 text-green-600" />
                            Correcciones Aplicadas ({issuesList.filter((i: any) => i.status === "resolved").length})
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <ScrollArea className="h-[200px]">
                            <div className="space-y-1">
                              {issuesList.filter((i: any) => i.status === "resolved").map((issue: any) => (
                                <div 
                                  key={issue.id} 
                                  className="p-2 border rounded-md border-green-200 bg-green-50/50 dark:bg-green-950/20"
                                  data-testid={`resolved-issue-${issue.id}`}
                                >
                                  <div className="flex items-center gap-2">
                                    <CheckCircle className="h-4 w-4 text-green-600 flex-shrink-0" />
                                    <div className="flex-1">
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <Badge variant="outline" className="text-xs">{issue.category}</Badge>
                                        <span className="text-xs text-muted-foreground">Cap. {issue.chapterNumber}</span>
                                      </div>
                                      <p className="text-sm line-through text-muted-foreground">{issue.description}</p>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </ScrollArea>
                        </CardContent>
                      </Card>
                    )}

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
                    <div className="mt-4">
                      {/* Toolbar with normalize button */}
                      <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
                        <span className="text-sm text-muted-foreground">
                          {chapters.length} capítulos • {chapters.filter(c => c.editedContent).length} reeditados
                        </span>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => selectedProjectData && normalizeTitlesMutation.mutate(selectedProjectData.id)}
                          disabled={normalizeTitlesMutation.isPending || chapters.length === 0}
                          data-testid="button-normalize-reedit-titles"
                        >
                          {normalizeTitlesMutation.isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          ) : (
                            <Wand2 className="h-4 w-4 mr-2" />
                          )}
                          Normalizar Títulos
                        </Button>
                      </div>

                      {chapters.length === 0 ? (
                        <p className="text-center text-muted-foreground py-8">
                          Aún no se han parseado capítulos
                        </p>
                      ) : viewingChapterId ? (
                        /* Chapter content viewer */
                        (() => {
                          const viewingChapter = chapters.find(c => c.id === viewingChapterId);
                          if (!viewingChapter) return null;
                          const content = viewingChapter.editedContent || viewingChapter.originalContent || "";
                          return (
                            <div className="flex flex-col h-[400px]">
                              <div className="flex items-center justify-between gap-2 pb-3 border-b mb-3">
                                <div className="flex items-center gap-2">
                                  <Button variant="ghost" size="sm" onClick={() => setViewingChapterId(null)} data-testid="button-back-to-list">
                                    <ChevronRight className="h-4 w-4 rotate-180" />
                                    Volver
                                  </Button>
                                  <Badge variant="outline">{getChapterBadgeLabel(viewingChapter.chapterNumber)}</Badge>
                                  <span className="font-medium font-serif">{getChapterLabel(viewingChapter.chapterNumber, viewingChapter.title)}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <Badge variant="secondary">
                                    {content.split(/\s+/).filter(w => w.length > 0).length.toLocaleString()} palabras
                                  </Badge>
                                  {viewingChapter.editedContent && (
                                    <Badge className="bg-green-500/20 text-green-600">Reeditado</Badge>
                                  )}
                                </div>
                              </div>
                              <ScrollArea className="flex-1">
                                <article className="prose prose-lg dark:prose-invert max-w-prose mx-auto leading-7 font-serif text-sm">
                                  <div 
                                    dangerouslySetInnerHTML={{ 
                                      __html: content
                                        .replace(/\n\n/g, '</p><p>')
                                        .replace(/\n/g, '<br />')
                                        .replace(/^/, '<p>')
                                        .replace(/$/, '</p>')
                                    }} 
                                  />
                                </article>
                              </ScrollArea>
                            </div>
                          );
                        })()
                      ) : (
                        /* Chapter list */
                        <ScrollArea className="h-[400px]">
                          <div className="space-y-2">
                            {chapters.map((chapter) => {
                              const chaptersBeingRewritten = (selectedProjectData as any).chaptersBeingRewritten || [];
                              const isBeingRewritten = chaptersBeingRewritten.includes(chapter.chapterNumber);
                              const isCurrentChapter = selectedProjectData.currentChapter === chapter.chapterNumber;
                              
                              return (
                              <div
                                key={chapter.id}
                                data-testid={`card-reedit-chapter-${chapter.id}`}
                                className={`p-3 border rounded-md hover-elevate cursor-pointer ${isBeingRewritten ? 'border-amber-500/50 bg-amber-50/30 dark:bg-amber-950/20' : ''} ${isCurrentChapter ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-950/30' : ''}`}
                                onClick={() => (chapter.editedContent || chapter.originalContent) && setViewingChapterId(chapter.id)}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-2">
                                    <Badge variant="outline">{getChapterBadgeLabel(chapter.chapterNumber)}</Badge>
                                    <span className="font-medium">{getChapterLabel(chapter.chapterNumber, chapter.title)}</span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    {isCurrentChapter && selectedProjectData.status === "processing" && (
                                      <Badge className="bg-blue-500/20 text-blue-600 dark:text-blue-400 animate-pulse">
                                        <Wand2 className="h-3 w-3 mr-1 animate-spin" />
                                        Reescribiendo
                                      </Badge>
                                    )}
                                    {isBeingRewritten && !isCurrentChapter && selectedProjectData.status === "processing" && (
                                      <Badge variant="outline" className="border-amber-500 text-amber-600 dark:text-amber-400">
                                        <Clock className="h-3 w-3 mr-1" />
                                        Pendiente
                                      </Badge>
                                    )}
                                    {chapter.editorScore && (
                                      <Badge variant="secondary">
                                        Editor: {chapter.editorScore}/10
                                      </Badge>
                                    )}
                                    {chapter.editedContent && !isBeingRewritten && !isCurrentChapter && (
                                      <Badge className="bg-green-500/20 text-green-600">
                                        <CheckCircle className="h-3 w-3 mr-1" />
                                        Reeditado
                                      </Badge>
                                    )}
                                    {getStatusBadge(chapter.status)}
                                    {(chapter.editedContent || chapter.originalContent) && (
                                      <Eye className="h-4 w-4 text-muted-foreground" />
                                    )}
                                  </div>
                                </div>
                                {(chapter.editedContent || chapter.originalContent) && (
                                  <p className="text-sm text-muted-foreground mt-2">
                                    {(chapter.editedContent || chapter.originalContent || "").split(/\s+/).filter(w => w.length > 0).length.toLocaleString()} palabras
                                    {chapter.copyeditorChanges && (
                                      <span className="ml-2">• {chapter.copyeditorChanges.substring(0, 80)}...</span>
                                    )}
                                  </p>
                                )}
                              </div>
                              );
                            })}
                          </div>
                        </ScrollArea>
                      )}
                    </div>
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

                  <TabsContent value="structural">
                    <ScrollArea className="h-[500px] mt-4">
                      <div className="space-y-4">
                        {selectedProjectData.currentStage === "plan_ready" && !selectedProjectData.planApproved && (
                          <Card className="border-2 border-amber-500/50 bg-amber-500/5">
                            <CardContent className="pt-4">
                              <div className="flex items-center gap-2 mb-2">
                                <AlertTriangle className="h-5 w-5 text-amber-500" />
                                <span className="font-semibold">Plan de Reconstrucción Listo</span>
                              </div>
                              <p className="text-sm text-muted-foreground mb-4">
                                El análisis estructural ha generado un plan de reconstrucción. Revísalo y apruébalo para continuar.
                              </p>
                              <Button onClick={() => setShowPlanApprovalDialog(true)} data-testid="button-review-plan">
                                <Eye className="h-4 w-4 mr-2" />
                                Revisar Plan
                              </Button>
                            </CardContent>
                          </Card>
                        )}

                        {selectedProjectData.planApproved && (
                          <Card className="border-2 border-green-500/50 bg-green-500/5">
                            <CardContent className="pt-4">
                              <div className="flex items-center gap-2 mb-2">
                                <CheckCircle className="h-5 w-5 text-green-500" />
                                <span className="font-semibold">Plan Aprobado</span>
                              </div>
                              <p className="text-sm text-muted-foreground">
                                El plan de reconstrucción ha sido aprobado y está listo para ejecutarse.
                              </p>
                              {selectedProjectData.status === "pending" && (
                                <Button 
                                  onClick={() => executePlanMutation.mutate(selectedProjectData.id)}
                                  disabled={executePlanMutation.isPending}
                                  className="mt-4"
                                  data-testid="button-execute-plan"
                                >
                                  {executePlanMutation.isPending ? (
                                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                  ) : (
                                    <Play className="h-4 w-4 mr-2" />
                                  )}
                                  Ejecutar Plan
                                </Button>
                              )}
                            </CardContent>
                          </Card>
                        )}

                        {(selectedProjectData.structuralReport as any) && (
                          <Card>
                            <CardHeader>
                              <CardTitle className="flex items-center gap-2">
                                <FileText className="h-5 w-5 text-primary" />
                                Informe Estructural (LitEditors 3.0)
                              </CardTitle>
                            </CardHeader>
                            <CardContent>
                              <StructuralReportDisplay report={selectedProjectData.structuralReport as any} />
                            </CardContent>
                          </Card>
                        )}

                        {!selectedProjectData.structuralReport && selectedProjectData.status === "pending" && (
                          <Card>
                            <CardContent className="pt-6">
                              <div className="text-center space-y-4">
                                <FileText className="h-12 w-12 mx-auto opacity-50" />
                                <div>
                                  <p className="font-medium">Análisis Estructural Avanzado</p>
                                  <p className="text-sm text-muted-foreground mt-1">
                                    Ejecuta un análisis profundo para detectar huecos en la trama, redundancias, problemas de ritmo y anacronismos.
                                  </p>
                                </div>
                                <Button onClick={() => setShowStructuralDialog(true)} data-testid="button-start-structural-analysis">
                                  <Zap className="h-4 w-4 mr-2" />
                                  Iniciar Análisis Estructural
                                </Button>
                              </div>
                            </CardContent>
                          </Card>
                        )}

                        {structuralAnalysisProgress && (
                          <Card className="border-2 border-primary/50">
                            <CardContent className="pt-4">
                              <div className="flex items-center gap-2">
                                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                                <span className="font-medium">{structuralAnalysisProgress.message}</span>
                              </div>
                            </CardContent>
                          </Card>
                        )}
                      </div>
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
                            <Button 
                              variant="outline" 
                              data-testid="button-download-reedit-logs"
                              onClick={() => {
                                window.open(`/api/reedit-projects/${selectedProjectData.id}/export-logs-pdf`, '_blank');
                              }}
                            >
                              <FileText className="h-4 w-4 mr-2" />
                              Descargar Logs (.pdf)
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

                  <TabsContent value="quality-report">
                    <QualityReportDisplay projectId={selectedProjectData.id} />
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

      {/* LitEditors 3.0: Structural Analysis Configuration Dialog */}
      <Dialog open={showStructuralDialog} onOpenChange={setShowStructuralDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Análisis Estructural (LitEditors 3.0)</DialogTitle>
            <DialogDescription>
              Configura el contexto histórico para detectar anacronismos y problemas de continuidad.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="setting-context">Contexto Histórico</Label>
              <p className="text-xs text-muted-foreground mb-2">
                Ej: "París, 1920" o "España medieval, siglo XIV". Esto ayuda a detectar anacronismos.
              </p>
              <Input
                id="setting-context"
                value={settingContext}
                onChange={(e) => setSettingContext(e.target.value)}
                placeholder="Lugar y época de la historia..."
                data-testid="input-setting-context"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowStructuralDialog(false)}>
              Cancelar
            </Button>
            <Button 
              onClick={() => {
                if (selectedProjectData) {
                  analyzeStructureMutation.mutate({
                    projectId: selectedProjectData.id,
                    settingContext,
                  });
                }
              }}
              disabled={analyzeStructureMutation.isPending}
              data-testid="button-confirm-structural-analysis"
            >
              {analyzeStructureMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Zap className="h-4 w-4 mr-2" />
              )}
              Iniciar Análisis
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* LitEditors 3.0: Plan Approval Dialog */}
      <Dialog open={showPlanApprovalDialog} onOpenChange={setShowPlanApprovalDialog}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Plan de Reconstrucción</DialogTitle>
            <DialogDescription>
              Revisa el plan generado por el análisis estructural. Puedes aprobar el plan o modificarlo antes de la ejecución.
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="flex-1 py-4">
            {selectedProjectData?.reconstructionPlan && Array.isArray(selectedProjectData.reconstructionPlan) ? (
              <div className="space-y-3">
                {(selectedProjectData.reconstructionPlan as any[]).map((step: any, idx: number) => (
                  <Card key={idx} className={`border-l-4 ${
                    step.action === 'KEEP' ? 'border-l-green-500' :
                    step.action === 'INSERT' ? 'border-l-blue-500' :
                    step.action === 'DELETE' ? 'border-l-red-500' :
                    step.action === 'MERGE' ? 'border-l-purple-500' : 'border-l-gray-500'
                  }`}>
                    <CardContent className="py-3">
                      <div className="flex items-start gap-3">
                        <Badge className={`shrink-0 ${
                          step.action === 'KEEP' ? 'bg-green-500' :
                          step.action === 'INSERT' ? 'bg-blue-500' :
                          step.action === 'DELETE' ? 'bg-red-500' :
                          step.action === 'MERGE' ? 'bg-purple-500' : ''
                        }`}>
                          {step.action}
                        </Badge>
                        <div className="flex-1">
                          {step.original_id && (
                            <p className="text-sm">
                              <span className="text-muted-foreground">Capítulo original:</span> {step.original_id}
                              {step.new_order && <span className="text-muted-foreground"> → Nuevo orden: {step.new_order}</span>}
                            </p>
                          )}
                          {step.merge_with && (
                            <p className="text-sm text-muted-foreground">
                              Fusionar con capítulo: {step.merge_with}
                            </p>
                          )}
                          {step.reason && (
                            <p className="text-sm mt-1">{step.reason}</p>
                          )}
                          {step.prompt_for_writer && (
                            <p className="text-xs text-muted-foreground mt-1 italic">
                              Instrucciones: {step.prompt_for_writer}
                            </p>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No hay plan de reconstrucción disponible</p>
              </div>
            )}
          </ScrollArea>
          <DialogFooter className="border-t pt-4">
            <Button variant="outline" onClick={() => setShowPlanApprovalDialog(false)}>
              Cancelar
            </Button>
            <Button 
              onClick={() => {
                if (selectedProjectData) {
                  approvePlanMutation.mutate({ projectId: selectedProjectData.id });
                }
              }}
              disabled={approvePlanMutation.isPending}
              data-testid="button-approve-plan"
            >
              {approvePlanMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Check className="h-4 w-4 mr-2" />
              )}
              Aprobar Plan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Custom Polishing Dialog */}
      <Dialog open={showPolishingDialog} onOpenChange={setShowPolishingDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Pulido Manual Personalizado</DialogTitle>
            <DialogDescription>
              Define instrucciones específicas para pulir y reescribir capítulos seleccionados. 
              Útil para corregir problemas de coherencia narrativa o desarrollo de personajes.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="polishing-chapters">Rango de Capítulos *</Label>
              <p className="text-xs text-muted-foreground mb-2">
                Ej: "18-19" o "5, 7, 12-15" o "Capítulo 18-19 (El cambio de bando de Salgado)"
              </p>
              <Input
                id="polishing-chapters"
                value={polishingChapterRange}
                onChange={(e) => setPolishingChapterRange(e.target.value)}
                placeholder="Capítulos a reescribir..."
                data-testid="input-polishing-chapters"
              />
            </div>
            <div>
              <Label htmlFor="polishing-diagnosis">Diagnóstico</Label>
              <p className="text-xs text-muted-foreground mb-2">
                ¿Cuál es el problema que has detectado?
              </p>
              <Textarea
                id="polishing-diagnosis"
                value={polishingDiagnosis}
                onChange={(e) => setPolishingDiagnosis(e.target.value)}
                placeholder="Ej: El giro del personaje es abrupto y se percibe como una conveniencia del guion..."
                rows={3}
                data-testid="textarea-polishing-diagnosis"
              />
            </div>
            <div>
              <Label htmlFor="polishing-procedure">Procedimiento</Label>
              <p className="text-xs text-muted-foreground mb-2">
                ¿Qué cambios específicos deben hacerse?
              </p>
              <Textarea
                id="polishing-procedure"
                value={polishingProcedure}
                onChange={(e) => setPolishingProcedure(e.target.value)}
                placeholder="Ej: Insertar una escena o monólogo interno donde el personaje vea una prueba de que..."
                rows={4}
                data-testid="textarea-polishing-procedure"
              />
            </div>
            <div>
              <Label htmlFor="polishing-objective">Objetivo</Label>
              <p className="text-xs text-muted-foreground mb-2">
                ¿Qué resultado esperas lograr con estos cambios?
              </p>
              <Textarea
                id="polishing-objective"
                value={polishingObjective}
                onChange={(e) => setPolishingObjective(e.target.value)}
                placeholder="Ej: Dar coherencia causal al arco del personaje..."
                rows={2}
                data-testid="textarea-polishing-objective"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPolishingDialog(false)} data-testid="button-cancel-polishing">
              Cancelar
            </Button>
            <Button 
              onClick={handlePolishingSubmit}
              disabled={polishingMutation.isPending || !polishingChapterRange.trim()}
              data-testid="button-submit-polishing"
            >
              {polishingMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Wand2 className="h-4 w-4 mr-2" />
              )}
              Iniciar Pulido
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
