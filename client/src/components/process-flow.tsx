import { Check, Brain, Pencil, Eye, ArrowRight, Layers, Scissors, Compass, Shield, BookOpen, Scale, Sparkles, Activity } from "lucide-react";

export type AgentRole = 
  | "global-architect" 
  | "chapter-architect" 
  | "ghostwriter-v2" 
  | "inquisidor"
  | "estilista"
  | "ritmo"
  | "smart-editor" 
  | "summarizer" 
  | "ensamblador"
  | "narrative-director"
  | "universal-consistency"
  | "beta-reader"
  | "orchestrator"
  | "system";

type StageStatus = "pending" | "active" | "completed" | "warning";

interface ProcessFlowProps {
  currentStage: AgentRole | null;
  completedStages: AgentRole[];
  warningStages?: AgentRole[];
}

const stages: { role: AgentRole; name: string; icon: React.ReactNode; group?: string }[] = [
  { role: "global-architect", name: "Arquitecto Global", icon: <Brain className="h-4 w-4" />, group: "planificación" },
  { role: "chapter-architect", name: "Diseñador Escenas", icon: <Layers className="h-4 w-4" />, group: "planificación" },
  { role: "ghostwriter-v2", name: "Escritor", icon: <Pencil className="h-4 w-4" />, group: "escritura" },
  { role: "inquisidor", name: "Inquisidor", icon: <Scale className="h-4 w-4" />, group: "auditoría" },
  { role: "estilista", name: "Estilista", icon: <Sparkles className="h-4 w-4" />, group: "auditoría" },
  { role: "ritmo", name: "Ritmo", icon: <Activity className="h-4 w-4" />, group: "auditoría" },
  { role: "smart-editor", name: "Corrector", icon: <Eye className="h-4 w-4" />, group: "corrección" },
  { role: "summarizer", name: "Compresor", icon: <Scissors className="h-4 w-4" />, group: "memoria" },
  { role: "ensamblador", name: "Ensamblador", icon: <Layers className="h-4 w-4" />, group: "final" },
];

function getStageStatus(role: AgentRole, currentStage: AgentRole | null, completedStages: AgentRole[], warningStages: AgentRole[] = []): StageStatus {
  if (completedStages.includes(role)) return "completed";
  if (warningStages.includes(role)) return "warning";
  if (currentStage === role) return "active";
  return "pending";
}

export function ProcessFlow({ currentStage, completedStages, warningStages = [] }: ProcessFlowProps) {
  const auditStages = stages.filter(s => s.group === "auditoría");
  const otherStages = stages.filter(s => s.group !== "auditoría");

  return (
    <div className="flex items-center justify-center gap-2 p-4 flex-wrap" data-testid="process-flow">
      {otherStages.map((stage, index) => {
        const status = getStageStatus(stage.role, currentStage, completedStages, warningStages);
        
        const isBeforeAudit = stage.role === "ghostwriter-v2";
        const isAfterAudit = stage.role === "smart-editor";

        return (
          <div key={stage.role} className="flex items-center gap-2">
            <div 
              className={`
                flex items-center gap-2 px-3 py-2 rounded-md transition-all duration-300
                ${status === "active" 
                  ? "bg-primary text-primary-foreground animate-pulse" 
                  : status === "completed"
                    ? "bg-green-500/20 text-green-600 dark:text-green-400"
                    : status === "warning"
                      ? "bg-orange-500/20 text-orange-600 dark:text-orange-400"
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
            
            {isBeforeAudit && (
              <>
                <ArrowRight className={`h-4 w-4 ${completedStages.includes(stage.role) ? "text-green-500" : "text-muted-foreground/50"}`} />
                <div className="flex items-center gap-1 border border-dashed border-muted-foreground/30 rounded-md px-2 py-1" data-testid="audit-group">
                  {auditStages.map((auditStage, auditIdx) => {
                    const auditStatus = getStageStatus(auditStage.role, currentStage, completedStages, warningStages);
                    return (
                      <div key={auditStage.role} className="flex items-center gap-1">
                        <div
                          className={`
                            flex items-center gap-1 px-2 py-1.5 rounded-md transition-all duration-300 text-xs
                            ${auditStatus === "active"
                              ? "bg-primary text-primary-foreground animate-pulse"
                              : auditStatus === "completed"
                                ? "bg-green-500/20 text-green-600 dark:text-green-400"
                                : auditStatus === "warning"
                                  ? "bg-orange-500/20 text-orange-600 dark:text-orange-400"
                                  : "bg-muted text-muted-foreground"
                            }
                          `}
                          data-testid={`stage-${auditStage.role}`}
                        >
                          {auditStatus === "completed" ? <Check className="h-3 w-3" /> : auditStage.icon}
                          <span className="font-medium">{auditStage.name}</span>
                        </div>
                        {auditIdx < auditStages.length - 1 && (
                          <span className="text-muted-foreground/40 text-xs">|</span>
                        )}
                      </div>
                    );
                  })}
                </div>
                <ArrowRight className={`h-4 w-4 ${auditStages.every(s => completedStages.includes(s.role)) ? "text-green-500" : "text-muted-foreground/50"}`} />
              </>
            )}

            {!isBeforeAudit && !isAfterAudit && index < otherStages.length - 1 && (
              <ArrowRight 
                className={`h-4 w-4 ${
                  completedStages.includes(stage.role) 
                    ? "text-green-500" 
                    : "text-muted-foreground/50"
                }`} 
              />
            )}

            {isAfterAudit && index < otherStages.length - 1 && (
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
