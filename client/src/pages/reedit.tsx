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
  ChevronRight,
  Cpu,
  TrendingUp,
  Zap,
  RotateCcw
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
            {duplicates.map((dup: any, i: number) => (
              <Badge key={i} variant="secondary">
                Cap. {dup.chapterNumber || dup.chapter || dup}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {outOfOrder.length > 0 && (
        <div>
          <p className="text-sm font-medium text-yellow-600 dark:text-yellow-400 mb-1">
            Capítulos Fuera de Orden ({outOfOrder.length})
          </p>
          <div className="flex flex-wrap gap-2">
            {outOfOrder.map((ch: any, i: number) => (
              <Badge key={i} variant="secondary">
                Cap. {ch.chapterNumber || ch.chapter || ch}
              </Badge>
            ))}
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
    };
    return colors[type] || "bg-gray-600";
  };

  return (
    <div className="space-y-4" data-testid="display-audit-reports">
      {reports.map((report, idx) => (
        <Card key={idx} data-testid={`card-audit-report-${report.id || idx}`}>
          <CardHeader className="py-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <Badge className={getAuditTypeBadgeColor(report.auditType)}>
                  {getAuditTypeLabel(report.auditType)}
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
            {report.findings?.resumenEjecutivo && (
              <p className="text-sm mb-2">{report.findings.resumenEjecutivo}</p>
            )}
            {report.findings?.resumen && (
              <p className="text-sm mb-2">{report.findings.resumen}</p>
            )}
            {report.recommendations && Array.isArray(report.recommendations) && report.recommendations.length > 0 && (
              <div className="mt-2">
                <p className="text-xs text-muted-foreground mb-1">Recomendaciones:</p>
                <ul className="text-sm list-disc list-inside space-y-1">
                  {report.recommendations.slice(0, 3).map((rec: any, i: number) => (
                    <li key={i} className="text-muted-foreground">
                      {typeof rec === 'string' ? rec : (rec.descripcion || rec.description || JSON.stringify(rec))}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      ))}
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
  
  // Restart dialog state
  const [showRestartDialog, setShowRestartDialog] = useState(false);
  const [restartExpandChapters, setRestartExpandChapters] = useState(false);
  const [restartInsertNewChapters, setRestartInsertNewChapters] = useState(false);
  const [restartTargetMinWords, setRestartTargetMinWords] = useState(2000);

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

  const resumeMutation = useMutation({
    mutationFn: async (projectId: number) => {
      return apiRequest("POST", `/api/reedit-projects/${projectId}/resume`);
    },
    onSuccess: () => {
      toast({ title: "Procesamiento Reanudado", description: "El manuscrito continúa siendo reeditado" });
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
    try {
      await uploadMutation.mutateAsync(formData);
    } finally {
      setIsUploading(false);
    }
  }, [uploadFile, uploadTitle, uploadLanguage, expandChapters, insertNewChapters, targetMinWords, uploadMutation, toast]);

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
                    {selectedProjectData.status === "error" && (
                      <Button
                        onClick={() => resumeMutation.mutate(selectedProjectData.id)}
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
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue="progress">
                  <TabsList className="flex-wrap h-auto">
                    <TabsTrigger value="progress" data-testid="tab-trigger-progress">Progreso</TabsTrigger>
                    <TabsTrigger value="chapters" data-testid="tab-trigger-chapters">Capítulos</TabsTrigger>
                    <TabsTrigger value="worldbible" data-testid="tab-trigger-worldbible">Biblia del Mundo</TabsTrigger>
                    <TabsTrigger value="audits" data-testid="tab-trigger-audits">Auditorías QA</TabsTrigger>
                    <TabsTrigger value="report" data-testid="tab-trigger-report">Informe Final</TabsTrigger>
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
