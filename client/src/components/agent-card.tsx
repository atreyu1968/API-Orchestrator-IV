import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Pencil, Brain, Eye, FileText, Loader2, ClipboardCheck, Shield, AudioWaveform, Search, AlertTriangle, Scale, Sparkles, Activity, Layers } from "lucide-react";

type AgentRole = "architect" | "ghostwriter" | "editor" | "copyeditor" | "final-reviewer" | "continuity-sentinel" | "voice-auditor" | "semantic-detector" | "global-architect" | "chapter-architect" | "ghostwriter-v2" | "smart-editor" | "summarizer" | "narrative-director" | "universal-consistency" | "beta-reader" | "inquisidor" | "estilista" | "ritmo" | "ensamblador";
type AgentStatusType = "idle" | "thinking" | "writing" | "editing" | "reviewing" | "polishing" | "completed" | "error" | "analyzing" | "warning";

interface AgentCardProps {
  name: string;
  role: AgentRole;
  status: AgentStatusType;
  currentTask?: string | null;
  progress?: number;
  lastActivity?: Date;
}

const roleIcons: Record<AgentRole, React.ReactNode> = {
  architect: <Brain className="h-5 w-5" />,
  ghostwriter: <Pencil className="h-5 w-5" />,
  editor: <Eye className="h-5 w-5" />,
  copyeditor: <FileText className="h-5 w-5" />,
  "final-reviewer": <ClipboardCheck className="h-5 w-5" />,
  "continuity-sentinel": <Shield className="h-5 w-5" />,
  "voice-auditor": <AudioWaveform className="h-5 w-5" />,
  "semantic-detector": <Search className="h-5 w-5" />,
  "global-architect": <Brain className="h-5 w-5" />,
  "chapter-architect": <Brain className="h-5 w-5" />,
  "ghostwriter-v2": <Pencil className="h-5 w-5" />,
  "smart-editor": <Eye className="h-5 w-5" />,
  "summarizer": <FileText className="h-5 w-5" />,
  "narrative-director": <ClipboardCheck className="h-5 w-5" />,
  "universal-consistency": <Shield className="h-5 w-5" />,
  "beta-reader": <Eye className="h-5 w-5" />,
  "inquisidor": <Scale className="h-5 w-5" />,
  "estilista": <Sparkles className="h-5 w-5" />,
  "ritmo": <Activity className="h-5 w-5" />,
  "ensamblador": <Layers className="h-5 w-5" />,
};

const roleColors: Record<AgentRole, string> = {
  architect: "bg-chart-1/10 text-chart-1",
  ghostwriter: "bg-chart-2/10 text-chart-2",
  editor: "bg-chart-3/10 text-chart-3",
  copyeditor: "bg-chart-4/10 text-chart-4",
  "final-reviewer": "bg-chart-5/10 text-chart-5",
  "continuity-sentinel": "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  "voice-auditor": "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  "semantic-detector": "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400",
  "global-architect": "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
  "chapter-architect": "bg-purple-500/10 text-purple-600 dark:text-purple-400",
  "ghostwriter-v2": "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  "smart-editor": "bg-rose-500/10 text-rose-600 dark:text-rose-400",
  "summarizer": "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  "narrative-director": "bg-orange-500/10 text-orange-600 dark:text-orange-400",
  "universal-consistency": "bg-teal-500/10 text-teal-600 dark:text-teal-400",
  "beta-reader": "bg-pink-500/10 text-pink-600 dark:text-pink-400",
  "inquisidor": "bg-red-500/10 text-red-600 dark:text-red-400",
  "estilista": "bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-400",
  "ritmo": "bg-lime-500/10 text-lime-600 dark:text-lime-400",
  "ensamblador": "bg-blue-500/10 text-blue-600 dark:text-blue-400",
};

const statusColors: Record<AgentStatusType, string> = {
  idle: "bg-muted text-muted-foreground",
  thinking: "bg-chart-1/20 text-chart-1",
  writing: "bg-chart-2/20 text-chart-2",
  editing: "bg-chart-3/20 text-chart-3",
  reviewing: "bg-chart-5/20 text-chart-5",
  polishing: "bg-chart-4/20 text-chart-4",
  completed: "bg-green-500/20 text-green-600 dark:text-green-400",
  error: "bg-destructive/20 text-destructive",
  analyzing: "bg-amber-500/20 text-amber-600 dark:text-amber-400",
  warning: "bg-orange-500/20 text-orange-600 dark:text-orange-400",
};

const statusLabels: Record<AgentStatusType, string> = {
  idle: "En espera",
  thinking: "Pensando",
  writing: "Escribiendo",
  editing: "Editando",
  reviewing: "Revisando",
  polishing: "Puliendo",
  completed: "Completado",
  error: "Error",
  analyzing: "Analizando",
  warning: "Advertencia",
};

export function AgentCard({ name, role, status, currentTask, progress = 0, lastActivity }: AgentCardProps) {
  const isActive = status !== "idle" && status !== "completed" && status !== "error";

  return (
    <Card 
      className={`transition-all duration-300 flex flex-col ${isActive ? "ring-1 ring-primary/30" : ""}`}
      data-testid={`card-agent-${role}`}
    >
      <CardHeader className="pb-2">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-md ${roleColors[role]}`}>
            {roleIcons[role]}
          </div>
          <div className="min-w-0 flex-1">
            <CardTitle className="text-sm font-medium truncate">{name}</CardTitle>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col justify-between space-y-3 pt-0">
        <div className="min-h-[2rem]">
          {currentTask && (
            <p className="text-xs text-muted-foreground line-clamp-2" data-testid={`text-task-${role}`}>
              {currentTask}
            </p>
          )}
          {!currentTask && (
            <p className="text-xs text-muted-foreground/50 italic">
              Sin tarea asignada
            </p>
          )}
        </div>
        {isActive && progress > 0 && (
          <div className="space-y-1">
            <Progress value={progress} className="h-1" />
          </div>
        )}
        <div className="flex items-center justify-between gap-2 pt-2 border-t border-border/50">
          <Badge 
            className={`${statusColors[status]} text-xs font-medium uppercase tracking-wide`}
            data-testid={`badge-agent-status-${role}`}
          >
            {isActive && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
            {statusLabels[status]}
          </Badge>
          {lastActivity && (
            <p className="text-[10px] text-muted-foreground">
              {new Date(lastActivity).toLocaleTimeString("es-ES", { hour: '2-digit', minute: '2-digit' })}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
