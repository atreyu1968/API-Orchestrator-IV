import { Check, Brain, Pencil, Eye, FileText, ArrowRight, ClipboardCheck, Shield, AudioWaveform, Search } from "lucide-react";

export type AgentRole = "architect" | "ghostwriter" | "editor" | "copyeditor" | "final-reviewer" | "continuity-sentinel" | "voice-auditor" | "semantic-detector";
type StageStatus = "pending" | "active" | "completed";

interface ProcessFlowProps {
  currentStage: AgentRole | null;
  completedStages: AgentRole[];
}

const stages: { role: AgentRole; name: string; icon: React.ReactNode }[] = [
  { role: "architect", name: "Arquitecto", icon: <Brain className="h-4 w-4" /> },
  { role: "ghostwriter", name: "Narrador", icon: <Pencil className="h-4 w-4" /> },
  { role: "editor", name: "Editor", icon: <Eye className="h-4 w-4" /> },
  { role: "copyeditor", name: "Estilista", icon: <FileText className="h-4 w-4" /> },
  { role: "continuity-sentinel", name: "Centinela", icon: <Shield className="h-4 w-4" /> },
  { role: "voice-auditor", name: "Auditor Voz", icon: <AudioWaveform className="h-4 w-4" /> },
  { role: "semantic-detector", name: "Detector", icon: <Search className="h-4 w-4" /> },
  { role: "final-reviewer", name: "Revisor Final", icon: <ClipboardCheck className="h-4 w-4" /> },
];

function getStageStatus(role: AgentRole, currentStage: AgentRole | null, completedStages: AgentRole[]): StageStatus {
  if (completedStages.includes(role)) return "completed";
  if (currentStage === role) return "active";
  return "pending";
}

export function ProcessFlow({ currentStage, completedStages }: ProcessFlowProps) {
  return (
    <div className="flex items-center justify-center gap-2 p-4" data-testid="process-flow">
      {stages.map((stage, index) => {
        const status = getStageStatus(stage.role, currentStage, completedStages);
        
        return (
          <div key={stage.role} className="flex items-center gap-2">
            <div 
              className={`
                flex items-center gap-2 px-4 py-2 rounded-md transition-all duration-300
                ${status === "active" 
                  ? "bg-primary text-primary-foreground animate-pulse" 
                  : status === "completed"
                    ? "bg-green-500/20 text-green-600 dark:text-green-400"
                    : "bg-muted text-muted-foreground"
                }
              `}
              data-testid={`stage-${stage.role}`}
            >
              {status === "completed" ? (
                <Check className="h-4 w-4" />
              ) : (
                stage.icon
              )}
              <span className="text-sm font-medium">{stage.name}</span>
            </div>
            {index < stages.length - 1 && (
              <ArrowRight 
                className={`h-4 w-4 ${
                  completedStages.includes(stage.role) 
                    ? "text-green-500" 
                    : "text-muted-foreground/50"
                }`} 
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
