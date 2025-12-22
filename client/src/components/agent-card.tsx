import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Pencil, Brain, Eye, FileText, Loader2, ClipboardCheck, Shield, AudioWaveform, Search, AlertTriangle } from "lucide-react";

type AgentRole = "architect" | "ghostwriter" | "editor" | "copyeditor" | "final-reviewer" | "continuity-sentinel" | "voice-auditor" | "semantic-detector";
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
      className={`transition-all duration-300 ${isActive ? "ring-1 ring-primary/30" : ""}`}
      data-testid={`card-agent-${role}`}
    >
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-md ${roleColors[role]}`}>
            {roleIcons[role]}
          </div>
          <div>
            <CardTitle className="text-base font-medium">{name}</CardTitle>
            <p className="text-xs text-muted-foreground capitalize">{role}</p>
          </div>
        </div>
        <Badge 
          className={`${statusColors[status]} text-xs font-medium uppercase tracking-wide`}
          data-testid={`badge-agent-status-${role}`}
        >
          {isActive && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
          {statusLabels[status]}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        {currentTask && (
          <p className="text-sm text-muted-foreground line-clamp-2 min-h-[2.5rem]" data-testid={`text-task-${role}`}>
            {currentTask}
          </p>
        )}
        {!currentTask && (
          <p className="text-sm text-muted-foreground/50 min-h-[2.5rem] italic">
            Sin tarea asignada
          </p>
        )}
        {isActive && progress > 0 && (
          <div className="space-y-1">
            <Progress value={progress} className="h-1.5" />
            <p className="text-xs text-muted-foreground text-right">{progress}%</p>
          </div>
        )}
        {lastActivity && (
          <p className="text-xs text-muted-foreground">
            Última actividad: {new Date(lastActivity).toLocaleTimeString("es-ES")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
