import { useEffect, useRef } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Brain, Pencil, Eye, FileText, AlertCircle, CheckCircle, Download } from "lucide-react";

type LogType = "thinking" | "writing" | "editing" | "polishing" | "error" | "success" | "info";

interface LogEntry {
  id: string;
  type: LogType;
  message: string;
  timestamp: Date;
  agent?: string;
}

interface ConsoleOutputProps {
  logs: LogEntry[];
  projectId?: number;
}

const logIcons: Record<LogType, React.ReactNode> = {
  thinking: <Brain className="h-3.5 w-3.5" />,
  writing: <Pencil className="h-3.5 w-3.5" />,
  editing: <Eye className="h-3.5 w-3.5" />,
  polishing: <FileText className="h-3.5 w-3.5" />,
  error: <AlertCircle className="h-3.5 w-3.5" />,
  success: <CheckCircle className="h-3.5 w-3.5" />,
  info: <span className="h-3.5 w-3.5 inline-block text-center">i</span>,
};

const logPrefixes: Record<LogType, string> = {
  thinking: "[PENSANDO]",
  writing: "[ESCRIBIENDO]",
  editing: "[EDITANDO]",
  polishing: "[PULIENDO]",
  error: "[ERROR]",
  success: "[COMPLETADO]",
  info: "[INFO]",
};

const logColors: Record<LogType, string> = {
  thinking: "text-chart-1",
  writing: "text-chart-2",
  editing: "text-chart-3",
  polishing: "text-chart-4",
  error: "text-destructive",
  success: "text-green-500",
  info: "text-muted-foreground",
};

function extractChapterNumber(message: string): number | null {
  const patterns = [
    /Capítulo\s+(-?\d+)/i,
    /Cap\.\s*(-?\d+)/i,
    /el\s+Capítulo\s+(-?\d+)/i,
    /Checkpoint\s+#(\d+)/i,
  ];
  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match) {
      return parseInt(match[1], 10);
    }
  }
  return null;
}

const chapterColors: Record<number, string> = {};
const baseColors = [
  "bg-blue-500/20 text-blue-400",
  "bg-purple-500/20 text-purple-400",
  "bg-amber-500/20 text-amber-400",
  "bg-emerald-500/20 text-emerald-400",
  "bg-rose-500/20 text-rose-400",
  "bg-cyan-500/20 text-cyan-400",
  "bg-orange-500/20 text-orange-400",
  "bg-indigo-500/20 text-indigo-400",
];

function getChapterColor(chapterNum: number): string {
  if (!chapterColors[chapterNum]) {
    const colorIndex = Math.abs(chapterNum) % baseColors.length;
    chapterColors[chapterNum] = baseColors[colorIndex];
  }
  return chapterColors[chapterNum];
}

export function ConsoleOutput({ logs, projectId }: ConsoleOutputProps) {
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollAreaRef.current) {
      const viewport = scrollAreaRef.current.querySelector("[data-radix-scroll-area-viewport]");
      if (viewport) {
        viewport.scrollTop = viewport.scrollHeight;
      }
    }
  }, [logs]);

  const handleExportLogs = () => {
    if (projectId) {
      window.open(`/api/projects/${projectId}/export-logs-pdf`, "_blank");
    }
  };

  return (
    <div 
      className="bg-card border border-card-border rounded-md font-mono text-sm"
      data-testid="console-output"
    >
      <div className="flex items-center justify-between px-4 py-2 border-b border-card-border">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Consola de Agentes
        </span>
        <div className="flex items-center gap-3">
          {projectId && logs.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleExportLogs}
              className="h-6 px-2 text-xs"
              data-testid="button-export-logs"
            >
              <Download className="h-3 w-3 mr-1" />
              PDF
            </Button>
          )}
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-red-500/80" />
            <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/80" />
            <div className="w-2.5 h-2.5 rounded-full bg-green-500/80" />
          </div>
        </div>
      </div>
      <ScrollArea className="h-64" ref={scrollAreaRef}>
        <div className="p-4 space-y-1.5">
          {logs.length === 0 ? (
            <p className="text-muted-foreground/50 text-xs">
              Los registros de actividad aparecerán aquí cuando inicies un proyecto...
            </p>
          ) : (
            logs.map((log) => {
              const chapterNum = extractChapterNumber(log.message);
              return (
                <div 
                  key={log.id} 
                  className="flex items-start gap-2 leading-relaxed"
                  data-testid={`log-entry-${log.id}`}
                >
                  <span className="text-xs text-muted-foreground shrink-0 w-16">
                    {new Date(log.timestamp).toLocaleTimeString("es-ES", { 
                      hour: "2-digit", 
                      minute: "2-digit",
                      second: "2-digit"
                    })}
                  </span>
                  {chapterNum !== null && (
                    <span className={`text-xs px-1.5 py-0.5 rounded font-medium shrink-0 ${getChapterColor(chapterNum)}`}>
                      {chapterNum === -1 ? "Ep" : chapterNum === 0 ? "Pr" : `C${chapterNum}`}
                    </span>
                  )}
                  <span className={`flex items-center gap-1 shrink-0 ${logColors[log.type]}`}>
                    {logIcons[log.type]}
                    <span className="font-semibold">{logPrefixes[log.type]}</span>
                  </span>
                  <span className="text-foreground">{log.message}</span>
                </div>
              );
            })
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

export type { LogEntry, LogType };
