import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  DollarSign, 
  BookOpen,
  Globe,
  Info,
  TrendingUp
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Project, Translation } from "@shared/schema";

function calculateCost(inputTokens: number, outputTokens: number, thinkingTokens: number = 0): number {
  const INPUT_PRICE_PER_MILLION = 0.36;
  const OUTPUT_PRICE_PER_MILLION = 0.95;
  const THINKING_PRICE_PER_MILLION = 0.55;
  
  const inputCost = (inputTokens / 1_000_000) * INPUT_PRICE_PER_MILLION;
  const outputCost = (outputTokens / 1_000_000) * OUTPUT_PRICE_PER_MILLION;
  const thinkingCost = (thinkingTokens / 1_000_000) * THINKING_PRICE_PER_MILLION;
  
  return inputCost + outputCost + thinkingCost;
}

function formatNumber(num: number): string {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toString();
}

function formatCurrency(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

const PRICING_INFO = `Tarifas DeepSeek (por millón de tokens):

R1 (Arquitecto, Director): $0.55 input / $2.19 output
V3 (Escritor, Editor): $0.28 input / $0.42 output

Promedio ponderado: $0.36 input / $0.95 output`;

export default function CostsHistoryPage() {
  const { data: projects, isLoading: loadingProjects } = useQuery<Project[]>({
    queryKey: ["/api/projects"],
  });

  const { data: translations, isLoading: loadingTranslations } = useQuery<Translation[]>({
    queryKey: ["/api/translations"],
  });

  const projectsWithCosts = (projects || [])
    .filter(p => (p.totalInputTokens || 0) > 0 || (p.totalOutputTokens || 0) > 0)
    .map(p => ({
      ...p,
      cost: calculateCost(
        p.totalInputTokens || 0,
        p.totalOutputTokens || 0,
        p.totalThinkingTokens || 0
      )
    }))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const translationsWithCosts = (translations || [])
    .filter(t => (t.inputTokens || 0) > 0 || (t.outputTokens || 0) > 0)
    .map(t => ({
      ...t,
      cost: calculateCost(t.inputTokens || 0, t.outputTokens || 0, 0)
    }))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const totalProjectsCost = projectsWithCosts.reduce((sum, p) => sum + p.cost, 0);
  const totalTranslationsCost = translationsWithCosts.reduce((sum, t) => sum + t.cost, 0);
  const grandTotal = totalProjectsCost + totalTranslationsCost;

  return (
    <div className="p-6 space-y-6" data-testid="costs-history-page">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Historial de Costos</h1>
          <p className="text-muted-foreground">
            Registro de costos de generación y traducciones
          </p>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-2 text-sm text-muted-foreground cursor-help">
              <Info className="h-4 w-4" />
              <span>Info de precios</span>
            </div>
          </TooltipTrigger>
          <TooltipContent side="left" className="max-w-sm whitespace-pre-line">
            {PRICING_INFO}
          </TooltipContent>
        </Tooltip>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium">Costo Proyectos</CardTitle>
            <BookOpen className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {loadingProjects ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <>
                <div className="text-2xl font-bold">{formatCurrency(totalProjectsCost)}</div>
                <p className="text-xs text-muted-foreground">
                  {projectsWithCosts.length} proyectos
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium">Costo Traducciones</CardTitle>
            <Globe className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {loadingTranslations ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <>
                <div className="text-2xl font-bold">{formatCurrency(totalTranslationsCost)}</div>
                <p className="text-xs text-muted-foreground">
                  {translationsWithCosts.length} traducciones
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium">Costo Total</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {loadingProjects || loadingTranslations ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <>
                <div className="text-2xl font-bold text-primary">{formatCurrency(grandTotal)}</div>
                <p className="text-xs text-muted-foreground">
                  Proyectos + Traducciones
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5" />
            Proyectos
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loadingProjects ? (
            <div className="space-y-2">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : projectsWithCosts.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">
              No hay proyectos con costos registrados
            </p>
          ) : (
            <div className="max-h-[400px] overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Proyecto</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead className="text-right">Entrada</TableHead>
                    <TableHead className="text-right">Salida</TableHead>
                    <TableHead className="text-right">Costo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {projectsWithCosts.map((project) => (
                    <TableRow key={project.id} data-testid={`row-project-${project.id}`}>
                      <TableCell className="font-medium max-w-[200px] truncate" title={project.title}>
                        {project.title}
                      </TableCell>
                      <TableCell>
                        <Badge 
                          variant={project.status === "completed" ? "default" : "secondary"}
                          className="text-xs"
                        >
                          {project.status === "completed" ? "Completado" : 
                           project.status === "generating" ? "Generando" :
                           project.status === "paused" ? "Pausado" : project.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {formatNumber(project.totalInputTokens || 0)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {formatNumber(project.totalOutputTokens || 0)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm font-semibold">
                        {formatCurrency(project.cost)}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="bg-muted/50 font-bold">
                    <TableCell colSpan={4}>TOTAL PROYECTOS</TableCell>
                    <TableCell className="text-right font-mono text-lg">
                      {formatCurrency(totalProjectsCost)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5" />
            Traducciones
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loadingTranslations ? (
            <div className="space-y-2">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : translationsWithCosts.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">
              No hay traducciones con costos registrados
            </p>
          ) : (
            <div className="max-h-[400px] overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Proyecto</TableHead>
                    <TableHead>Idioma</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead className="text-right">Entrada</TableHead>
                    <TableHead className="text-right">Salida</TableHead>
                    <TableHead className="text-right">Costo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {translationsWithCosts.map((translation) => (
                    <TableRow key={translation.id} data-testid={`row-translation-${translation.id}`}>
                      <TableCell className="font-medium max-w-[180px] truncate" title={translation.projectTitle}>
                        {translation.projectTitle}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {translation.sourceLanguage} → {translation.targetLanguage}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge 
                          variant={translation.status === "completed" ? "default" : "secondary"}
                          className="text-xs"
                        >
                          {translation.status === "completed" ? "Completada" : 
                           translation.status === "translating" ? "Traduciendo" :
                           translation.status === "error" ? "Error" : "Pendiente"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {formatNumber(translation.inputTokens || 0)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {formatNumber(translation.outputTokens || 0)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm font-semibold">
                        {formatCurrency(translation.cost)}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="bg-muted/50 font-bold">
                    <TableCell colSpan={5}>TOTAL TRADUCCIONES</TableCell>
                    <TableCell className="text-right font-mono text-lg">
                      {formatCurrency(totalTranslationsCost)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="bg-muted/50">
        <CardContent className="pt-6">
          <div className="flex items-start gap-3">
            <TrendingUp className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
            <div className="text-sm text-muted-foreground">
              <p>
                Los costos se calculan usando las tarifas de DeepSeek (R1 y V3) basándose en el conteo de tokens de cada operación.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
