import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectSeparator, SelectGroup, SelectLabel } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import type { Project } from "@shared/schema";

interface ProjectSelectorProps {
  projects: Project[];
  selectedProjectId: number | null;
  onSelectProject: (projectId: number) => void;
}

const statusLabels: Record<string, string> = {
  idle: "Pendiente",
  generating: "Generando",
  completed: "Completado",
  archived: "Archivado",
  paused: "Pausado",
  cancelled: "Cancelado",
  error: "Error",
  failed_final_review: "Revisión Fallida",
  final_review_in_progress: "Revisando",
  awaiting_approval: "Aprobación",
  awaiting_final_review: "Pendiente Revisión",
};

const statusColors: Record<string, string> = {
  idle: "bg-yellow-500/20 text-yellow-600 dark:text-yellow-400",
  generating: "bg-blue-500/20 text-blue-600 dark:text-blue-400",
  completed: "bg-green-500/20 text-green-600 dark:text-green-400",
  archived: "bg-gray-500/20 text-gray-600 dark:text-gray-400",
  paused: "bg-orange-500/20 text-orange-600 dark:text-orange-400",
  cancelled: "bg-gray-500/20 text-gray-600 dark:text-gray-400",
  error: "bg-red-500/20 text-red-600 dark:text-red-400",
  failed_final_review: "bg-red-500/20 text-red-600 dark:text-red-400",
  final_review_in_progress: "bg-purple-500/20 text-purple-600 dark:text-purple-400",
  awaiting_approval: "bg-amber-500/20 text-amber-600 dark:text-amber-400",
  awaiting_final_review: "bg-indigo-500/20 text-indigo-600 dark:text-indigo-400",
};

export function ProjectSelector({ 
  projects, 
  selectedProjectId, 
  onSelectProject 
}: ProjectSelectorProps) {
  const activeProjects = projects.filter(p => p.status !== "archived");
  const archivedProjects = projects.filter(p => p.status === "archived");

  if (projects.length === 0) {
    return null;
  }

  return (
    <Select
      value={selectedProjectId?.toString() || ""}
      onValueChange={(value) => onSelectProject(parseInt(value))}
    >
      <SelectTrigger className="w-[280px]" data-testid="select-project">
        <SelectValue placeholder="Seleccionar proyecto" />
      </SelectTrigger>
      <SelectContent>
        {activeProjects.length > 0 && (
          <SelectGroup>
            <SelectLabel>Proyectos Activos</SelectLabel>
            {activeProjects.map((project) => (
              <SelectItem 
                key={project.id} 
                value={project.id.toString()}
                data-testid={`select-project-${project.id}`}
              >
                <div className="flex items-center gap-2">
                  <span className="truncate max-w-[180px]">{project.title}</span>
                  <Badge 
                    variant="secondary" 
                    className={`text-xs ${statusColors[project.status] || ""}`}
                  >
                    {statusLabels[project.status] || project.status}
                  </Badge>
                </div>
              </SelectItem>
            ))}
          </SelectGroup>
        )}
        {archivedProjects.length > 0 && (
          <>
            {activeProjects.length > 0 && <SelectSeparator />}
            <SelectGroup>
              <SelectLabel>Archivados</SelectLabel>
              {archivedProjects.map((project) => (
                <SelectItem 
                  key={project.id} 
                  value={project.id.toString()}
                  data-testid={`select-project-archived-${project.id}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="truncate max-w-[180px] opacity-70">{project.title}</span>
                    <Badge 
                      variant="secondary" 
                      className={`text-xs ${statusColors[project.status] || ""}`}
                    >
                      {statusLabels[project.status] || project.status}
                    </Badge>
                  </div>
                </SelectItem>
              ))}
            </SelectGroup>
          </>
        )}
      </SelectContent>
    </Select>
  );
}
