import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  DollarSign, 
  BookOpen,
  Info
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
import { useProject } from "@/lib/project-context";
import type { AiUsageEvent } from "@shared/schema";

function formatNumber(num: number): string {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toString();
}

function formatCurrency(amount: number): string {
  return `$${amount.toFixed(4)}`;
}

const PRICING_INFO = `Tarifas DeepSeek (por millón de tokens):

R1 (deepseek-reasoner): $0.55 input / $2.19 output
V3 (deepseek-chat): $0.27 input / $1.10 output`;

interface ModelStats {
  model: string;
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  cost: number;
}

function groupByModel(events: AiUsageEvent[]): ModelStats[] {
  const grouped = new Map<string, ModelStats>();
  
  for (const event of events) {
    const model = event.model || "unknown";
    const existing = grouped.get(model);
    
    if (existing) {
      existing.inputTokens += event.inputTokens || 0;
      existing.outputTokens += event.outputTokens || 0;
      existing.thinkingTokens += event.thinkingTokens || 0;
      existing.cost += parseFloat(event.totalCostUsd || "0");
    } else {
      grouped.set(model, {
        model,
        inputTokens: event.inputTokens || 0,
        outputTokens: event.outputTokens || 0,
        thinkingTokens: event.thinkingTokens || 0,
        cost: parseFloat(event.totalCostUsd || "0"),
      });
    }
  }
  
  return Array.from(grouped.values()).sort((a, b) => b.cost - a.cost);
}

export default function CostsHistoryPage() {
  const { currentProject, isLoading: loadingProject } = useProject();

  const { data: aiUsageEvents, isLoading: loadingUsage } = useQuery<AiUsageEvent[]>({
    queryKey: [`/api/projects/${currentProject?.id}/ai-usage`],
    enabled: !!currentProject?.id,
    refetchInterval: 5000,
  });

  const modelStats = groupByModel(aiUsageEvents || []);
  const totalCost = modelStats.reduce((sum, m) => sum + m.cost, 0);
  const totalInput = modelStats.reduce((sum, m) => sum + m.inputTokens, 0);
  const totalOutput = modelStats.reduce((sum, m) => sum + m.outputTokens, 0);
  const totalThinking = modelStats.reduce((sum, m) => sum + m.thinkingTokens, 0);

  if (!currentProject) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-6">
        <BookOpen className="h-16 w-16 text-muted-foreground/20 mb-4" />
        <h2 className="text-xl font-semibold mb-2">Sin proyecto seleccionado</h2>
        <p className="text-muted-foreground max-w-md">
          Selecciona un proyecto para ver su historial de costos
        </p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6" data-testid="costs-history-page">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Costos: {currentProject.title}</h1>
          <p className="text-muted-foreground">
            Tokens y costos por modelo
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

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
          <CardTitle className="text-sm font-medium">Costo Total del Proyecto</CardTitle>
          <DollarSign className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          {loadingProject || loadingUsage ? (
            <Skeleton className="h-8 w-24" />
          ) : (
            <div className="text-3xl font-bold text-primary">{formatCurrency(totalCost)}</div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Desglose por Modelo</CardTitle>
        </CardHeader>
        <CardContent>
          {loadingUsage ? (
            <Skeleton className="h-24 w-full" />
          ) : modelStats.length === 0 ? (
            <p className="text-muted-foreground text-center py-4">
              No hay datos de uso registrados
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Modelo</TableHead>
                  <TableHead className="text-right">Input</TableHead>
                  <TableHead className="text-right">Output</TableHead>
                  <TableHead className="text-right">Thinking</TableHead>
                  <TableHead className="text-right">Costo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {modelStats.map((stat) => (
                  <TableRow key={stat.model}>
                    <TableCell className="font-medium font-mono text-sm">
                      {stat.model}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {formatNumber(stat.inputTokens)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {formatNumber(stat.outputTokens)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm text-muted-foreground">
                      {formatNumber(stat.thinkingTokens)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm font-semibold">
                      {formatCurrency(stat.cost)}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-muted/50 font-bold">
                  <TableCell>TOTAL</TableCell>
                  <TableCell className="text-right font-mono">{formatNumber(totalInput)}</TableCell>
                  <TableCell className="text-right font-mono">{formatNumber(totalOutput)}</TableCell>
                  <TableCell className="text-right font-mono text-muted-foreground">{formatNumber(totalThinking)}</TableCell>
                  <TableCell className="text-right font-mono text-lg">{formatCurrency(totalCost)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
