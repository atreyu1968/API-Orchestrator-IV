import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { Orchestrator } from "./orchestrator";
import { queueManager } from "./queue-manager";
import { insertProjectSchema, insertPseudonymSchema, insertStyleGuideSchema, insertSeriesSchema } from "@shared/schema";
import multer from "multer";
import mammoth from "mammoth";
import { generateManuscriptDocx } from "./services/docx-exporter";
import { z } from "zod";
import { CopyEditorAgent, cancelProject } from "./agents";

const workTypeEnum = z.enum(["standalone", "series", "trilogy"]);

const projectSeriesUpdateSchema = z.object({
  workType: workTypeEnum.optional(),
  seriesId: z.number().nullable().optional(),
  seriesOrder: z.number().min(1).nullable().optional(),
}).refine((data) => {
  if (data.workType === "standalone") {
    return data.seriesId === null || data.seriesId === undefined;
  }
  return true;
}, { message: "Standalone works cannot have a seriesId" });

const createSeriesSchema = z.object({
  title: z.string().min(1, "Title is required").max(200),
  description: z.string().max(2000).nullable().optional(),
  workType: z.enum(["series", "trilogy"]).default("trilogy"),
  totalPlannedBooks: z.number().min(2).max(20).default(3),
});

const updateSeriesSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  workType: z.enum(["series", "trilogy"]).optional(),
  totalPlannedBooks: z.number().min(2).max(20).optional(),
  pseudonymId: z.number().nullable().optional(),
});

const activeStreams = new Map<number, Set<Response>>();

async function persistActivityLog(projectId: number | null, level: string, message: string, agentRole?: string | null, metadata?: any) {
  try {
    await storage.createActivityLog({
      projectId,
      level,
      message,
      agentRole: agentRole ?? null,
      metadata: metadata ?? null,
    });
  } catch (e) {
    console.error("[ActivityLog] Failed to persist log:", e);
  }
}

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword'
    ];
    if (allowedTypes.includes(file.mimetype) || file.originalname.endsWith('.docx') || file.originalname.endsWith('.doc')) {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten archivos Word (.docx, .doc)'));
    }
  }
});

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  app.get("/api/projects", async (req: Request, res: Response) => {
    try {
      const projects = await storage.getAllProjects();
      res.json(projects);
    } catch (error) {
      console.error("Error fetching projects:", error);
      res.status(500).json({ error: "Failed to fetch projects" });
    }
  });

  app.get("/api/projects/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const project = await storage.getProject(id);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }
      res.json(project);
    } catch (error) {
      console.error("Error fetching project:", error);
      res.status(500).json({ error: "Failed to fetch project" });
    }
  });

  app.post("/api/projects", async (req: Request, res: Response) => {
    try {
      const parsed = insertProjectSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid project data", details: parsed.error });
      }
      const project = await storage.createProject(parsed.data);
      
      for (const agentName of ["architect", "ghostwriter", "editor", "copyeditor"]) {
        await storage.updateAgentStatus(project.id, agentName, { status: "idle" });
      }

      res.status(201).json(project);
    } catch (error) {
      console.error("Error creating project:", error);
      res.status(500).json({ error: "Failed to create project" });
    }
  });

  app.patch("/api/projects/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const project = await storage.getProject(id);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }
      
      if (project.status === "generating") {
        return res.status(400).json({ error: "Cannot edit a project while it's generating" });
      }

      const allowedFields = ["title", "premise", "genre", "tone", "chapterCount", "hasPrologue", "hasEpilogue", "hasAuthorNote", "pseudonymId", "styleGuideId", "workType", "seriesId", "seriesOrder"];
      const updateData: Record<string, any> = {};
      
      for (const field of allowedFields) {
        if (req.body[field] !== undefined) {
          updateData[field] = req.body[field];
        }
      }

      if (updateData.workType || updateData.seriesId !== undefined || updateData.seriesOrder !== undefined) {
        const seriesParsed = projectSeriesUpdateSchema.safeParse({
          workType: updateData.workType || project.workType,
          seriesId: updateData.seriesId !== undefined ? updateData.seriesId : project.seriesId,
          seriesOrder: updateData.seriesOrder !== undefined ? updateData.seriesOrder : project.seriesOrder,
        });
        if (!seriesParsed.success) {
          return res.status(400).json({ error: "Invalid series configuration", details: seriesParsed.error.flatten() });
        }
        
        if (seriesParsed.data.workType === "standalone") {
          updateData.seriesId = null;
          updateData.seriesOrder = null;
        }
      }

      const updated = await storage.updateProject(id, updateData);
      res.json(updated);
    } catch (error) {
      console.error("Error updating project:", error);
      res.status(500).json({ error: "Failed to update project" });
    }
  });

  app.delete("/api/projects/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteProject(id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting project:", error);
      res.status(500).json({ error: "Failed to delete project" });
    }
  });

  app.post("/api/projects/:id/archive", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const project = await storage.getProject(id);
      
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      if (project.status === "generating") {
        return res.status(400).json({ error: "No se puede archivar un proyecto mientras se genera" });
      }

      const updated = await storage.updateProject(id, { status: "archived" });
      res.json(updated);
    } catch (error) {
      console.error("Error archiving project:", error);
      res.status(500).json({ error: "Failed to archive project" });
    }
  });

  app.post("/api/projects/:id/unarchive", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const project = await storage.getProject(id);
      
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      if (project.status !== "archived") {
        return res.status(400).json({ error: "El proyecto no está archivado" });
      }

      const chapters = await storage.getChaptersByProject(id);
      const hasCompleted = chapters.some(c => c.status === "completed");
      const newStatus = hasCompleted ? "completed" : "idle";

      const updated = await storage.updateProject(id, { status: newStatus });
      res.json(updated);
    } catch (error) {
      console.error("Error unarchiving project:", error);
      res.status(500).json({ error: "Failed to unarchive project" });
    }
  });

  app.post("/api/projects/:id/duplicate", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const project = await storage.getProject(id);
      
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      const duplicated = await storage.createProject({
        title: `${project.title} (Copia)`,
        premise: project.premise,
        genre: project.genre,
        tone: project.tone,
        chapterCount: project.chapterCount,
        hasPrologue: project.hasPrologue,
        hasEpilogue: project.hasEpilogue,
        hasAuthorNote: project.hasAuthorNote,
        pseudonymId: project.pseudonymId,
        styleGuideId: project.styleGuideId,
      });

      for (const agentName of ["architect", "ghostwriter", "editor", "copyeditor"]) {
        await storage.updateAgentStatus(duplicated.id, agentName, { status: "idle" });
      }

      res.status(201).json(duplicated);
    } catch (error) {
      console.error("Error duplicating project:", error);
      res.status(500).json({ error: "Failed to duplicate project" });
    }
  });

  app.post("/api/projects/:id/cancel", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const project = await storage.getProject(id);
      
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      cancelProject(id);

      await storage.updateProject(id, { status: "cancelled" });

      for (const agentName of ["architect", "ghostwriter", "editor", "copyeditor", "final-reviewer"]) {
        await storage.updateAgentStatus(id, agentName, { 
          status: "idle", 
          currentTask: "Generación cancelada por el usuario" 
        });
      }

      res.json({ success: true, message: "Generación cancelada" });
    } catch (error) {
      console.error("Error cancelling project:", error);
      res.status(500).json({ error: "Failed to cancel project" });
    }
  });

  app.post("/api/projects/:id/force-complete", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const project = await storage.getProject(id);
      
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      cancelProject(id);

      await storage.updateProject(id, { status: "completed" });

      for (const agentName of ["architect", "ghostwriter", "editor", "copyeditor", "final-reviewer"]) {
        await storage.updateAgentStatus(id, agentName, { 
          status: "completed", 
          currentTask: "Proceso completado (forzado)" 
        });
      }

      const chapters = await storage.getChaptersByProject(id);
      for (const chapter of chapters) {
        if (chapter.status !== "completed" && chapter.content) {
          await storage.updateChapter(chapter.id, { status: "completed" });
        }
      }

      res.json({ success: true, message: "Proyecto marcado como completado" });
    } catch (error) {
      console.error("Error forcing project completion:", error);
      res.status(500).json({ error: "Failed to force complete project" });
    }
  });

  app.get("/api/projects/:id/export-docx", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const project = await storage.getProject(id);
      
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      if (project.status !== "completed") {
        return res.status(400).json({ error: "El proyecto debe estar completado para exportar" });
      }

      const allChapters = await storage.getChaptersByProject(id);
      
      const prologue = project.hasPrologue 
        ? allChapters.find(c => c.chapterNumber === 0) 
        : null;
      const epilogue = project.hasEpilogue 
        ? allChapters.find(c => c.chapterNumber === -1) 
        : null;
      const authorNote = project.hasAuthorNote 
        ? allChapters.find(c => c.chapterNumber === -2) 
        : null;
      
      const regularChapters = allChapters.filter(c => c.chapterNumber > 0);

      let pseudonym = null;
      if (project.pseudonymId) {
        pseudonym = await storage.getPseudonym(project.pseudonymId);
      }

      const buffer = await generateManuscriptDocx({
        project,
        chapters: regularChapters,
        pseudonym,
        prologue,
        epilogue,
        authorNote,
      });

      const safeTitle = project.title.replace(/[^a-zA-Z0-9áéíóúñÁÉÍÓÚÑ\s]/g, "").replace(/\s+/g, "_");
      const filename = `${safeTitle}_manuscrito.docx`;

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Content-Length", buffer.length);
      res.send(buffer);

    } catch (error) {
      console.error("Error exporting manuscript:", error);
      res.status(500).json({ error: "Failed to export manuscript" });
    }
  });

  app.post("/api/projects/:id/generate", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const project = await storage.getProject(id);
      
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      if (project.status === "generating") {
        return res.status(400).json({ error: "Project is already generating" });
      }

      res.json({ message: "Generation started", projectId: id });

      const sendToStreams = (data: any) => {
        const streams = activeStreams.get(id);
        if (streams) {
          const message = `data: ${JSON.stringify(data)}\n\n`;
          streams.forEach(stream => {
            try {
              stream.write(message);
            } catch (e) {
              console.error("Error writing to stream:", e);
            }
          });
        }
      };

      const orchestrator = new Orchestrator({
        onAgentStatus: async (role, status, message) => {
          await storage.updateAgentStatus(id, role, { status, currentTask: message });
          sendToStreams({ type: "agent_status", role, status, message });
          if (message) await persistActivityLog(id, "info", message, role);
        },
        onChapterComplete: async (chapterNumber, wordCount, chapterTitle) => {
          sendToStreams({ type: "chapter_complete", chapterNumber, wordCount, chapterTitle });
          await persistActivityLog(id, "success", `Capítulo ${chapterNumber} completado: "${chapterTitle}" (${wordCount} palabras)`, "ghostwriter");
        },
        onChapterRewrite: async (chapterNumber, chapterTitle, currentIndex, totalToRewrite, reason) => {
          sendToStreams({ type: "chapter_rewrite", chapterNumber, chapterTitle, currentIndex, totalToRewrite, reason });
          await persistActivityLog(id, "warning", `Reescritura ${currentIndex}/${totalToRewrite}: Cap. ${chapterNumber} - ${reason}`, "editor");
        },
        onChapterStatusChange: (chapterNumber, status) => {
          sendToStreams({ type: "chapter_status_change", chapterNumber, status });
        },
        onProjectComplete: async () => {
          sendToStreams({ type: "project_complete" });
          await persistActivityLog(id, "success", "Novela completada exitosamente", "orchestrator");
        },
        onError: async (error) => {
          sendToStreams({ type: "error", message: error });
          await persistActivityLog(id, "error", error, "orchestrator");
        },
      });

      orchestrator.generateNovel(project).catch(console.error);

    } catch (error) {
      console.error("Error starting generation:", error);
      res.status(500).json({ error: "Failed to start generation" });
    }
  });

  app.post("/api/projects/:id/resume", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      console.log(`[Resume] Starting resume for project ${id}`);
      
      const project = await storage.getProject(id);
      
      if (!project) {
        console.log(`[Resume] Project ${id} not found`);
        return res.status(404).json({ error: "Project not found" });
      }

      console.log(`[Resume] Project ${id} current status: ${project.status}`);

      if (project.status === "generating") {
        console.log(`[Resume] Project ${id} is already generating`);
        return res.status(400).json({ error: "Project is already generating" });
      }

      const validStatuses = ["paused", "cancelled", "error", "failed_final_review"];
      if (!validStatuses.includes(project.status)) {
        console.log(`[Resume] Project ${id} has invalid status: ${project.status}`);
        return res.status(400).json({ 
          error: `Cannot resume project with status "${project.status}". Only paused, cancelled, or error projects can be resumed.` 
        });
      }

      console.log(`[Resume] Updating project ${id} status to generating`);
      await storage.updateProject(id, { status: "generating" });

      for (const agentName of ["architect", "ghostwriter", "editor", "copyeditor", "final-reviewer"]) {
        await storage.updateAgentStatus(id, agentName, { status: "idle", currentTask: "Preparando reanudación..." });
      }
      console.log(`[Resume] Agent statuses updated for project ${id}`);

      res.json({ message: "Resume started", projectId: id });
      console.log(`[Resume] Response sent, starting orchestrator for project ${id}`);

      const sendToStreams = (data: any) => {
        const streams = activeStreams.get(id);
        if (streams) {
          const message = `data: ${JSON.stringify(data)}\n\n`;
          streams.forEach(stream => {
            try {
              stream.write(message);
            } catch (e) {
              console.error("Error writing to stream:", e);
            }
          });
        }
      };

      const orchestrator = new Orchestrator({
        onAgentStatus: async (role, status, message) => {
          await storage.updateAgentStatus(id, role, { status, currentTask: message });
          sendToStreams({ type: "agent_status", role, status, message });
          if (message) await persistActivityLog(id, "info", message, role);
        },
        onChapterComplete: async (chapterNumber, wordCount, chapterTitle) => {
          sendToStreams({ type: "chapter_complete", chapterNumber, wordCount, chapterTitle });
          await persistActivityLog(id, "success", `Capítulo ${chapterNumber} completado: "${chapterTitle}" (${wordCount} palabras)`, "ghostwriter");
        },
        onChapterRewrite: async (chapterNumber, chapterTitle, currentIndex, totalToRewrite, reason) => {
          sendToStreams({ type: "chapter_rewrite", chapterNumber, chapterTitle, currentIndex, totalToRewrite, reason });
          await persistActivityLog(id, "warning", `Reescritura ${currentIndex}/${totalToRewrite}: Cap. ${chapterNumber} - ${reason}`, "editor");
        },
        onChapterStatusChange: (chapterNumber, status) => {
          sendToStreams({ type: "chapter_status_change", chapterNumber, status });
        },
        onProjectComplete: async () => {
          sendToStreams({ type: "project_complete" });
          await persistActivityLog(id, "success", "Novela completada exitosamente", "orchestrator");
        },
        onError: async (error) => {
          sendToStreams({ type: "error", message: error });
          await persistActivityLog(id, "error", error, "orchestrator");
        },
      });

      orchestrator.resumeNovel(project).catch(console.error);

    } catch (error) {
      console.error("Error resuming generation:", error);
      res.status(500).json({ error: "Failed to resume generation" });
    }
  });

  app.post("/api/projects/:id/final-review", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const project = await storage.getProject(id);
      
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      if (project.status !== "completed") {
        return res.status(400).json({ error: "Solo se puede ejecutar la revisión final en proyectos completados" });
      }

      await storage.updateProject(id, { 
        status: "generating",
        revisionCycle: 0,
        finalReviewResult: null
      });

      res.json({ message: "Final review started", projectId: id });

      const sendToStreams = (data: any) => {
        const streams = activeStreams.get(id);
        if (streams) {
          const message = `data: ${JSON.stringify(data)}\n\n`;
          streams.forEach(stream => {
            try {
              stream.write(message);
            } catch (e) {
              console.error("Error writing to stream:", e);
            }
          });
        }
      };

      const orchestrator = new Orchestrator({
        onAgentStatus: async (role, status, message) => {
          await storage.updateAgentStatus(id, role, { status, currentTask: message });
          sendToStreams({ type: "agent_status", role, status, message });
          if (message) await persistActivityLog(id, "info", message, role);
        },
        onChapterComplete: async (chapterNumber, wordCount, chapterTitle) => {
          sendToStreams({ type: "chapter_complete", chapterNumber, wordCount, chapterTitle });
          await persistActivityLog(id, "success", `Capítulo ${chapterNumber} completado: "${chapterTitle}" (${wordCount} palabras)`, "ghostwriter");
        },
        onChapterRewrite: async (chapterNumber, chapterTitle, currentIndex, totalToRewrite, reason) => {
          sendToStreams({ type: "chapter_rewrite", chapterNumber, chapterTitle, currentIndex, totalToRewrite, reason });
          await persistActivityLog(id, "warning", `Reescritura ${currentIndex}/${totalToRewrite}: Cap. ${chapterNumber} - ${reason}`, "editor");
        },
        onChapterStatusChange: (chapterNumber, status) => {
          sendToStreams({ type: "chapter_status_change", chapterNumber, status });
        },
        onProjectComplete: async () => {
          sendToStreams({ type: "project_complete" });
          await persistActivityLog(id, "success", "Revisión final completada", "final-reviewer");
        },
        onError: async (error) => {
          sendToStreams({ type: "error", message: error });
          await persistActivityLog(id, "error", error, "orchestrator");
        },
      });

      orchestrator.runFinalReviewOnly(project).catch(console.error);

    } catch (error) {
      console.error("Error starting final review:", error);
      res.status(500).json({ error: "Failed to start final review" });
    }
  });

  app.post("/api/projects/:id/force-sentinel", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const project = await storage.getProject(id);
      
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      if (project.status === "generating") {
        return res.status(400).json({ error: "El proyecto ya está siendo procesado" });
      }

      await storage.updateProject(id, { status: "generating" });

      res.json({ message: "Centinela forzado iniciado", projectId: id });

      const sendToStreams = (data: any) => {
        const streams = activeStreams.get(id);
        if (streams) {
          const message = `data: ${JSON.stringify(data)}\n\n`;
          streams.forEach(stream => {
            try {
              stream.write(message);
            } catch (e) {
              console.error("Error writing to stream:", e);
            }
          });
        }
      };

      const orchestrator = new Orchestrator({
        onAgentStatus: async (role, status, message) => {
          await storage.updateAgentStatus(id, role, { status, currentTask: message });
          sendToStreams({ type: "agent_status", role, status, message });
          if (message) await persistActivityLog(id, "info", message, role);
        },
        onChapterComplete: async (chapterNumber, wordCount, chapterTitle) => {
          sendToStreams({ type: "chapter_complete", chapterNumber, wordCount, chapterTitle });
          await persistActivityLog(id, "success", `Capítulo ${chapterNumber} corregido (${wordCount} palabras)`, "ghostwriter");
        },
        onChapterRewrite: async (chapterNumber, chapterTitle, currentIndex, totalToRewrite, reason) => {
          sendToStreams({ type: "chapter_rewrite", chapterNumber, chapterTitle, currentIndex, totalToRewrite, reason });
          await persistActivityLog(id, "warning", `Reescritura ${currentIndex}/${totalToRewrite}: Cap. ${chapterNumber} - ${reason}`, "continuity-sentinel");
        },
        onChapterStatusChange: (chapterNumber, status) => {
          sendToStreams({ type: "chapter_status_change", chapterNumber, status });
        },
        onProjectComplete: async () => {
          sendToStreams({ type: "project_complete" });
          await persistActivityLog(id, "success", "Corrección del Centinela completada", "continuity-sentinel");
        },
        onError: async (error) => {
          sendToStreams({ type: "error", message: error });
          await persistActivityLog(id, "error", error, "continuity-sentinel");
        },
      });

      orchestrator.runContinuitySentinelForce(project).catch(console.error);

    } catch (error) {
      console.error("Error starting forced sentinel:", error);
      res.status(500).json({ error: "Failed to start forced sentinel" });
    }
  });

  app.post("/api/projects/:id/regenerate-truncated", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const minWordCount = parseInt(req.body.minWordCount) || 100;
      const project = await storage.getProject(id);
      
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      if (project.status === "generating") {
        return res.status(400).json({ error: "El proyecto ya está siendo procesado" });
      }

      await storage.updateProject(id, { status: "generating" });

      res.json({ message: "Regeneración de capítulos truncados iniciada", projectId: id, minWordCount });

      const sendToStreams = (data: any) => {
        const streams = activeStreams.get(id);
        if (streams) {
          const message = `data: ${JSON.stringify(data)}\n\n`;
          streams.forEach(stream => {
            try {
              stream.write(message);
            } catch (e) {
              console.error("Error writing to stream:", e);
            }
          });
        }
      };

      const orchestrator = new Orchestrator({
        onAgentStatus: async (role, status, message) => {
          await storage.updateAgentStatus(id, role, { status, currentTask: message });
          sendToStreams({ type: "agent_status", role, status, message });
          if (message) await persistActivityLog(id, "info", message, role);
        },
        onChapterComplete: async (chapterNumber, wordCount, chapterTitle) => {
          sendToStreams({ type: "chapter_complete", chapterNumber, wordCount, chapterTitle });
          await persistActivityLog(id, "success", `Capítulo ${chapterNumber} regenerado: "${chapterTitle}" (${wordCount} palabras)`, "ghostwriter");
        },
        onChapterRewrite: async (chapterNumber, chapterTitle, currentIndex, totalToRewrite, reason) => {
          sendToStreams({ type: "chapter_rewrite", chapterNumber, chapterTitle, currentIndex, totalToRewrite, reason });
          await persistActivityLog(id, "warning", `Regenerando ${currentIndex}/${totalToRewrite}: Cap. ${chapterNumber} - ${reason}`, "ghostwriter");
        },
        onChapterStatusChange: (chapterNumber, status) => {
          sendToStreams({ type: "chapter_status_change", chapterNumber, status });
        },
        onProjectComplete: async () => {
          sendToStreams({ type: "project_complete" });
          await persistActivityLog(id, "success", "Regeneración de capítulos truncados completada", "ghostwriter");
        },
        onError: async (error) => {
          sendToStreams({ type: "error", message: error });
          await persistActivityLog(id, "error", error, "ghostwriter");
        },
      });

      orchestrator.regenerateTruncatedChapters(project, minWordCount).catch(console.error);

    } catch (error) {
      console.error("Error starting truncated chapters regeneration:", error);
      res.status(500).json({ error: "Failed to start truncated chapters regeneration" });
    }
  });

  // Simple endpoint to regenerate a single chapter with timeout
  app.post("/api/projects/:id/regenerate-chapter/:chapterNumber", async (req: Request, res: Response) => {
    const REGENERATION_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes max
    const projectId = parseInt(req.params.id);
    const chapterNumber = parseInt(req.params.chapterNumber);
    
    try {
      const project = await storage.getProject(projectId);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      const chapters = await storage.getChaptersByProject(projectId);
      const chapter = chapters.find(c => c.chapterNumber === chapterNumber);
      if (!chapter) {
        return res.status(404).json({ error: "Chapter not found" });
      }

      const worldBible = await storage.getWorldBibleByProject(projectId);
      if (!worldBible) {
        return res.status(400).json({ error: "No world bible found for project" });
      }

      // Build world bible data from the database fields
      const worldBibleData: any = {
        world_bible: {
          characters: worldBible.characters,
          timeline: worldBible.timeline,
          worldRules: worldBible.worldRules,
          plotOutline: worldBible.plotOutline,
          seccion_por_capitulo: (worldBible.plotOutline as any)?.seccion_por_capitulo || []
        }
      };

      await storage.updateAgentStatus(projectId, "ghostwriter", { 
        status: "writing", 
        currentTask: `Regenerando Capítulo ${chapterNumber}...` 
      });

      const GhostwriterAgent = (await import("./agents/ghostwriter")).GhostwriterAgent;
      const ghostwriter = new GhostwriterAgent();

      const sectionData: any = {
        numero: chapterNumber,
        titulo: chapter.title || `Capítulo ${chapterNumber}`,
        cronologia: "",
        ubicacion: "",
        elenco_presente: [],
        objetivo_narrativo: "",
        beats: [],
        resumen: "",
        escenas: [],
        giro_dramatico: "",
        pov_character: "",
        emotional_arc: "",
        conflicts: [],
        revelations: [],
        cliffhanger: "",
      };

      // Build section data from world bible if available
      if (worldBibleData.world_bible?.seccion_por_capitulo) {
        const sections = worldBibleData.world_bible.seccion_por_capitulo;
        const foundSection = sections.find((s: any) => s.numero === chapterNumber);
        if (foundSection) {
          Object.assign(sectionData, foundSection);
        }
      }

      // Get previous chapters for continuity
      const prevChapters = chapters
        .filter(c => c.chapterNumber < chapterNumber && c.content && c.content.length > 100)
        .sort((a, b) => b.chapterNumber - a.chapterNumber)
        .slice(0, 3);
      
      const previousContinuity = prevChapters.length > 0
        ? `Resumen de capítulos anteriores:\n${prevChapters.map(c => `Cap ${c.chapterNumber}: ${c.content?.slice(0, 500)}...`).join("\n\n")}`
        : "";

      // Guía de estilo
      let guiaEstilo = "";
      if (project.styleGuideId) {
        const styleGuide = await storage.getStyleGuide(project.styleGuideId);
        if (styleGuide?.content) {
          guiaEstilo = typeof styleGuide.content === 'string' 
            ? styleGuide.content 
            : JSON.stringify(styleGuide.content);
        }
      }

      // Create timeout promise
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("Timeout: La regeneración tardó demasiado tiempo")), REGENERATION_TIMEOUT_MS);
      });

      // Execute with timeout
      const writerPromise = ghostwriter.execute({
        chapterNumber,
        chapterData: sectionData,
        worldBible: worldBibleData.world_bible || worldBibleData,
        guiaEstilo,
        previousContinuity,
        refinementInstructions: "CRÍTICO: Escribe un capítulo COMPLETO de 2500-3500 palabras. NO truncar.",
        authorName: "",
        isRewrite: true,
      });

      const result = await Promise.race([writerPromise, timeoutPromise]);
      
      const { cleanContent } = ghostwriter.extractContinuityState(result.content);
      const wordCount = cleanContent.split(/\s+/).filter((w: string) => w.length > 0).length;

      if (wordCount < 500) {
        await storage.updateAgentStatus(projectId, "ghostwriter", { 
          status: "error", 
          currentTask: `Capítulo ${chapterNumber} truncado (${wordCount} palabras)` 
        });
        return res.status(400).json({ 
          error: "Chapter still truncated", 
          wordCount,
          message: `El capítulo solo tiene ${wordCount} palabras. Intenta de nuevo más tarde.`
        });
      }

      await storage.updateChapter(chapter.id, {
        content: cleanContent,
        status: "completed"
      });

      await storage.updateAgentStatus(projectId, "ghostwriter", { 
        status: "idle", 
        currentTask: `Capítulo ${chapterNumber} regenerado (${wordCount} palabras)` 
      });

      res.json({ 
        success: true, 
        chapterNumber, 
        wordCount,
        message: `Capítulo ${chapterNumber} regenerado exitosamente con ${wordCount} palabras`
      });

    } catch (error) {
      console.error("Error regenerating single chapter:", error);
      await storage.updateAgentStatus(projectId, "ghostwriter", { 
        status: "idle", 
        currentTask: "Error en regeneración" 
      });
      res.status(500).json({ 
        error: "Failed to regenerate chapter",
        message: error instanceof Error ? error.message : "Error desconocido"
      });
    }
  });

  app.get("/api/projects/:id/stream", (req: Request, res: Response) => {
    const id = parseInt(req.params.id);

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    if (!activeStreams.has(id)) {
      activeStreams.set(id, new Set());
    }
    activeStreams.get(id)!.add(res);

    res.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);

    req.on("close", () => {
      const streams = activeStreams.get(id);
      if (streams) {
        streams.delete(res);
        if (streams.size === 0) {
          activeStreams.delete(id);
        }
      }
    });
  });

  app.get("/api/projects/:id/chapters", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const chapters = await storage.getChaptersByProject(id);
      res.json(chapters);
    } catch (error) {
      console.error("Error fetching chapters:", error);
      res.status(500).json({ error: "Failed to fetch chapters" });
    }
  });

  app.get("/api/projects/:id/world-bible", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const worldBible = await storage.getWorldBibleByProject(id);
      res.json(worldBible || null);
    } catch (error) {
      console.error("Error fetching world bible:", error);
      res.status(500).json({ error: "Failed to fetch world bible" });
    }
  });

  app.get("/api/projects/:id/thought-logs", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const logs = await storage.getThoughtLogsByProject(id);
      res.json(logs);
    } catch (error) {
      console.error("Error fetching thought logs:", error);
      res.status(500).json({ error: "Failed to fetch thought logs" });
    }
  });

  app.get("/api/projects/:id/activity-logs", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const limit = parseInt(req.query.limit as string) || 500;
      const logs = await storage.getActivityLogsByProject(id, limit);
      res.json(logs.reverse());
    } catch (error) {
      console.error("Error fetching activity logs:", error);
      res.status(500).json({ error: "Failed to fetch activity logs" });
    }
  });

  app.get("/api/agent-statuses", async (req: Request, res: Response) => {
    try {
      const projects = await storage.getAllProjects();
      const activeProject = projects.find(p => p.status === "generating");
      
      if (!activeProject) {
        return res.json([]);
      }

      const statuses = await storage.getAgentStatusesByProject(activeProject.id);
      res.json(statuses);
    } catch (error) {
      console.error("Error fetching agent statuses:", error);
      res.status(500).json({ error: "Failed to fetch agent statuses" });
    }
  });

  app.get("/api/series", async (req: Request, res: Response) => {
    try {
      const allSeries = await storage.getAllSeries();
      res.json(allSeries);
    } catch (error) {
      console.error("Error fetching series:", error);
      res.status(500).json({ error: "Failed to fetch series" });
    }
  });

  app.get("/api/series/registry", async (req: Request, res: Response) => {
    try {
      const allSeries = await storage.getAllSeries();
      const allPseudonyms = await storage.getAllPseudonyms();
      const allProjects = await storage.getAllProjects();
      
      const registry = allSeries.map(s => {
        const pseudonym = s.pseudonymId ? allPseudonyms.find(p => p.id === s.pseudonymId) : null;
        const seriesProjects = allProjects
          .filter(p => p.seriesId === s.id)
          .sort((a, b) => (a.seriesOrder || 0) - (b.seriesOrder || 0));
        
        return {
          ...s,
          pseudonym: pseudonym || null,
          projects: seriesProjects,
          completedVolumes: seriesProjects.filter(p => p.status === "completed").length,
        };
      });
      
      res.json(registry);
    } catch (error) {
      console.error("Error fetching series registry:", error);
      res.status(500).json({ error: "Failed to fetch series registry" });
    }
  });

  app.get("/api/series/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const foundSeries = await storage.getSeries(id);
      if (!foundSeries) {
        return res.status(404).json({ error: "Series not found" });
      }
      res.json(foundSeries);
    } catch (error) {
      console.error("Error fetching series:", error);
      res.status(500).json({ error: "Failed to fetch series" });
    }
  });

  app.get("/api/series/:id/projects", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const projects = await storage.getProjectsBySeries(id);
      res.json(projects);
    } catch (error) {
      console.error("Error fetching series projects:", error);
      res.status(500).json({ error: "Failed to fetch series projects" });
    }
  });

  app.post("/api/series", async (req: Request, res: Response) => {
    try {
      const parsed = createSeriesSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid series data", details: parsed.error.flatten() });
      }
      const newSeries = await storage.createSeries({
        title: parsed.data.title,
        description: parsed.data.description || null,
        workType: parsed.data.workType,
        totalPlannedBooks: parsed.data.totalPlannedBooks,
      });
      res.status(201).json(newSeries);
    } catch (error) {
      console.error("Error creating series:", error);
      res.status(500).json({ error: "Failed to create series" });
    }
  });

  app.patch("/api/series/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const parsed = updateSeriesSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid series data", details: parsed.error.flatten() });
      }
      
      const updated = await storage.updateSeries(id, parsed.data);
      if (!updated) {
        return res.status(404).json({ error: "Series not found" });
      }
      res.json(updated);
    } catch (error) {
      console.error("Error updating series:", error);
      res.status(500).json({ error: "Failed to update series" });
    }
  });

  app.delete("/api/series/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteSeries(id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting series:", error);
      res.status(500).json({ error: "Failed to delete series" });
    }
  });

  app.post("/api/series/:id/guide", upload.single('file'), async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const file = req.file;
      
      if (!file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const series = await storage.getSeries(id);
      if (!series) {
        return res.status(404).json({ error: "Series not found" });
      }

      const result = await mammoth.extractRawText({ buffer: file.buffer });
      const guideContent = result.value.trim();

      if (!guideContent || guideContent.length < 100) {
        return res.status(400).json({ error: "El documento está vacío o tiene muy poco contenido" });
      }

      const updated = await storage.updateSeries(id, {
        seriesGuide: guideContent,
        seriesGuideFileName: file.originalname,
      });

      res.json({
        message: "Guía de serie cargada correctamente",
        series: updated,
        wordCount: guideContent.split(/\s+/).length,
      });
    } catch (error) {
      console.error("Error uploading series guide:", error);
      res.status(500).json({ error: "Failed to upload series guide" });
    }
  });

  app.delete("/api/series/:id/guide", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const series = await storage.getSeries(id);
      if (!series) {
        return res.status(404).json({ error: "Series not found" });
      }

      await storage.updateSeries(id, {
        seriesGuide: null,
        seriesGuideFileName: null,
      });

      res.json({ message: "Guía de serie eliminada" });
    } catch (error) {
      console.error("Error deleting series guide:", error);
      res.status(500).json({ error: "Failed to delete series guide" });
    }
  });

  // Extract milestones and plot threads from series guide using AI
  app.post("/api/series/:id/guide/extract", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const series = await storage.getSeries(id);
      if (!series) {
        return res.status(404).json({ error: "Series not found" });
      }

      if (!series.seriesGuide) {
        return res.status(400).json({ error: "No series guide uploaded. Upload a guide first." });
      }

      const { GoogleGenAI } = await import("@google/genai");
      const ai = new GoogleGenAI({
        apiKey: process.env.AI_INTEGRATIONS_GEMINI_API_KEY!,
        httpOptions: { baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL! },
      });

      const extractionPrompt = `Analiza esta guía de serie literaria y extrae:

1. HITOS NARRATIVOS (plot milestones): Eventos clave que DEBEN ocurrir en volúmenes específicos
2. HILOS ARGUMENTALES (plot threads): Tramas secundarias que atraviesan múltiples volúmenes

Responde ÚNICAMENTE en JSON válido con esta estructura exacta:
{
  "milestones": [
    {
      "description": "Descripción del hito",
      "volumeNumber": 1,
      "milestoneType": "plot_point|character_development|revelation|conflict_resolution|setup",
      "isRequired": true
    }
  ],
  "threads": [
    {
      "threadName": "Nombre del hilo",
      "description": "Descripción del hilo argumental",
      "introducedVolume": 1,
      "importance": "major|minor|subplot"
    }
  ]
}

GUÍA DE SERIE:
${series.seriesGuide.substring(0, 50000)}`;

      console.log(`[ExtractMilestones] Starting extraction for series ${id}`);
      console.log(`[ExtractMilestones] Series guide length: ${series.seriesGuide?.length || 0} chars`);

      // Retry logic for rate limiting
      let response;
      let attempts = 0;
      const maxAttempts = 5;
      
      while (attempts < maxAttempts) {
        try {
          attempts++;
          console.log(`[ExtractMilestones] Attempt ${attempts}/${maxAttempts}`);
          response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: [{ role: "user", parts: [{ text: extractionPrompt }] }],
            config: { temperature: 0.3 },
          });
          break; // Success, exit loop
        } catch (err: any) {
          const isRateLimit = err?.message?.includes("RATELIMIT") || 
                             err?.message?.includes("429") ||
                             err?.message?.includes("Rate limit");
          if (isRateLimit && attempts < maxAttempts) {
            const waitTime = Math.pow(2, attempts) * 10; // 20s, 40s, 80s, 160s
            console.log(`[ExtractMilestones] Rate limit hit (attempt ${attempts}/${maxAttempts}). Waiting ${waitTime}s...`);
            await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
          } else {
            throw err;
          }
        }
      }

      if (!response) {
        return res.status(503).json({ error: "Servicio temporalmente no disponible. Inténtalo en unos minutos." });
      }

      // Try multiple ways to extract the text from the response
      let text = "";
      if (typeof response.text === "string") {
        text = response.text;
      } else if (typeof response.text === "function") {
        text = (response as any).text();
      } else if ((response as any).response?.candidates?.[0]?.content?.parts?.[0]?.text) {
        text = (response as any).response.candidates[0].content.parts[0].text;
      }
      
      console.log(`[ExtractMilestones] Raw response length: ${text.length} chars`);
      console.log(`[ExtractMilestones] Response preview: ${text.substring(0, 500)}...`);

      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.error(`[ExtractMilestones] No JSON found in response. Full text: ${text}`);
        return res.status(500).json({ error: "No se pudo parsear la respuesta de la IA. Inténtalo de nuevo." });
      }

      let extracted;
      try {
        extracted = JSON.parse(jsonMatch[0]);
      } catch (parseError) {
        console.error(`[ExtractMilestones] JSON parse error:`, parseError);
        console.error(`[ExtractMilestones] JSON string that failed: ${jsonMatch[0].substring(0, 500)}...`);
        return res.status(500).json({ error: "Error parseando JSON de la respuesta de IA" });
      }

      console.log(`[ExtractMilestones] Extracted milestones: ${extracted.milestones?.length || 0}, threads: ${extracted.threads?.length || 0}`);

      const results = { milestonesCreated: 0, threadsCreated: 0 };

      for (const m of extracted.milestones || []) {
        await storage.createMilestone({
          seriesId: id,
          description: m.description,
          volumeNumber: m.volumeNumber || 1,
          milestoneType: m.milestoneType || "plot_point",
          isRequired: m.isRequired !== false,
        });
        results.milestonesCreated++;
      }

      for (const t of extracted.threads || []) {
        await storage.createPlotThread({
          seriesId: id,
          threadName: t.threadName,
          description: t.description,
          introducedVolume: t.introducedVolume || 1,
          importance: t.importance || "major",
          status: "active",
        });
        results.threadsCreated++;
      }

      res.json({
        message: `Extraídos ${results.milestonesCreated} hitos y ${results.threadsCreated} hilos argumentales`,
        ...results,
        extracted
      });
    } catch (error) {
      console.error("Error extracting from series guide:", error);
      res.status(500).json({ error: "Failed to extract milestones and threads" });
    }
  });

  app.get("/api/pseudonyms", async (req: Request, res: Response) => {
    try {
      const pseudonyms = await storage.getAllPseudonyms();
      res.json(pseudonyms);
    } catch (error) {
      console.error("Error fetching pseudonyms:", error);
      res.status(500).json({ error: "Failed to fetch pseudonyms" });
    }
  });

  app.get("/api/pseudonyms/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const pseudonym = await storage.getPseudonym(id);
      if (!pseudonym) {
        return res.status(404).json({ error: "Pseudonym not found" });
      }
      res.json(pseudonym);
    } catch (error) {
      console.error("Error fetching pseudonym:", error);
      res.status(500).json({ error: "Failed to fetch pseudonym" });
    }
  });

  app.post("/api/pseudonyms", async (req: Request, res: Response) => {
    try {
      const parsed = insertPseudonymSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid pseudonym data", details: parsed.error });
      }
      const pseudonym = await storage.createPseudonym(parsed.data);
      res.status(201).json(pseudonym);
    } catch (error) {
      console.error("Error creating pseudonym:", error);
      res.status(500).json({ error: "Failed to create pseudonym" });
    }
  });

  app.patch("/api/pseudonyms/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const { name, bio } = req.body;
      const updateData: { name?: string; bio?: string } = {};
      if (name !== undefined) updateData.name = name;
      if (bio !== undefined) updateData.bio = bio;
      
      const updated = await storage.updatePseudonym(id, updateData);
      if (!updated) {
        return res.status(404).json({ error: "Pseudonym not found" });
      }
      res.json(updated);
    } catch (error) {
      console.error("Error updating pseudonym:", error);
      res.status(500).json({ error: "Failed to update pseudonym" });
    }
  });

  app.delete("/api/pseudonyms/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deletePseudonym(id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting pseudonym:", error);
      res.status(500).json({ error: "Failed to delete pseudonym" });
    }
  });

  app.get("/api/pseudonyms/:id/style-guides", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id) || id <= 0) {
        return res.json([]);
      }
      const pseudonym = await storage.getPseudonym(id);
      if (!pseudonym) {
        return res.json([]);
      }
      const guides = await storage.getStyleGuidesByPseudonym(id);
      res.json(guides);
    } catch (error) {
      console.error("Error fetching style guides:", error);
      res.status(500).json({ error: "Failed to fetch style guides" });
    }
  });

  app.post("/api/pseudonyms/:id/style-guides", async (req: Request, res: Response) => {
    try {
      const pseudonymId = parseInt(req.params.id);
      const parsed = insertStyleGuideSchema.safeParse({ ...req.body, pseudonymId });
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid style guide data", details: parsed.error });
      }
      const guide = await storage.createStyleGuide(parsed.data);
      res.status(201).json(guide);
    } catch (error) {
      console.error("Error creating style guide:", error);
      res.status(500).json({ error: "Failed to create style guide" });
    }
  });

  app.get("/api/style-guides/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const guide = await storage.getStyleGuide(id);
      if (!guide) {
        return res.status(404).json({ error: "Style guide not found" });
      }
      res.json(guide);
    } catch (error) {
      console.error("Error fetching style guide:", error);
      res.status(500).json({ error: "Failed to fetch style guide" });
    }
  });

  app.patch("/api/style-guides/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const { title, content, isActive } = req.body;
      const updateData: { title?: string; content?: string; isActive?: boolean } = {};
      if (title !== undefined) updateData.title = title;
      if (content !== undefined) updateData.content = content;
      if (isActive !== undefined) updateData.isActive = isActive;
      
      const updated = await storage.updateStyleGuide(id, updateData);
      if (!updated) {
        return res.status(404).json({ error: "Style guide not found" });
      }
      res.json(updated);
    } catch (error) {
      console.error("Error updating style guide:", error);
      res.status(500).json({ error: "Failed to update style guide" });
    }
  });

  app.delete("/api/style-guides/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteStyleGuide(id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting style guide:", error);
      res.status(500).json({ error: "Failed to delete style guide" });
    }
  });

  app.post("/api/upload/word", upload.single("file"), async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No se proporcionó ningún archivo" });
      }

      const result = await mammoth.extractRawText({ buffer: req.file.buffer });
      const extractedText = result.value.trim();

      if (!extractedText) {
        return res.status(400).json({ error: "El archivo está vacío o no se pudo extraer el texto" });
      }

      res.json({ 
        content: extractedText,
        filename: req.file.originalname,
        messages: result.messages
      });
    } catch (error) {
      console.error("Error processing Word file:", error);
      res.status(500).json({ error: "Error al procesar el archivo Word" });
    }
  });

  const importManuscriptSchema = z.object({
    title: z.string().min(1, "Title is required"),
    originalFileName: z.string().min(1),
    detectedLanguage: z.string().nullable().optional(),
    targetLanguage: z.string().default("es"),
    chapters: z.array(z.object({
      chapterNumber: z.number(),
      title: z.string().nullable().optional(),
      content: z.string(),
    })),
  });

  app.get("/api/imported-manuscripts", async (req: Request, res: Response) => {
    try {
      const manuscripts = await storage.getAllImportedManuscripts();
      res.json(manuscripts);
    } catch (error) {
      console.error("Error fetching imported manuscripts:", error);
      res.status(500).json({ error: "Failed to fetch imported manuscripts" });
    }
  });

  app.get("/api/imported-manuscripts/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const manuscript = await storage.getImportedManuscript(id);
      if (!manuscript) {
        return res.status(404).json({ error: "Manuscript not found" });
      }
      res.json(manuscript);
    } catch (error) {
      console.error("Error fetching manuscript:", error);
      res.status(500).json({ error: "Failed to fetch manuscript" });
    }
  });

  app.post("/api/imported-manuscripts", async (req: Request, res: Response) => {
    try {
      const parsed = importManuscriptSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid manuscript data", details: parsed.error });
      }

      const { chapters, ...manuscriptData } = parsed.data;
      
      const manuscript = await storage.createImportedManuscript({
        ...manuscriptData,
        totalChapters: chapters.length,
      });

      for (const chapter of chapters) {
        await storage.createImportedChapter({
          manuscriptId: manuscript.id,
          chapterNumber: chapter.chapterNumber,
          title: chapter.title,
          originalContent: chapter.content,
          wordCount: chapter.content.split(/\s+/).length,
          status: "pending",
        });
      }

      res.status(201).json(manuscript);
    } catch (error) {
      console.error("Error creating imported manuscript:", error);
      res.status(500).json({ error: "Failed to create imported manuscript" });
    }
  });

  app.get("/api/imported-manuscripts/:id/chapters", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const chapters = await storage.getImportedChaptersByManuscript(id);
      res.json(chapters);
    } catch (error) {
      console.error("Error fetching imported chapters:", error);
      res.status(500).json({ error: "Failed to fetch imported chapters" });
    }
  });

  app.patch("/api/imported-manuscripts/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const manuscript = await storage.getImportedManuscript(id);
      if (!manuscript) {
        return res.status(404).json({ error: "Manuscript not found" });
      }

      const allowedFields = ["status", "processedChapters", "totalInputTokens", "totalOutputTokens", "totalThinkingTokens"];
      const updateData: Record<string, any> = {};
      
      for (const field of allowedFields) {
        if (req.body[field] !== undefined) {
          updateData[field] = req.body[field];
        }
      }

      const updated = await storage.updateImportedManuscript(id, updateData);
      res.json(updated);
    } catch (error) {
      console.error("Error updating manuscript:", error);
      res.status(500).json({ error: "Failed to update manuscript" });
    }
  });

  app.patch("/api/imported-chapters/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const chapter = await storage.getImportedChapter(id);
      if (!chapter) {
        return res.status(404).json({ error: "Chapter not found" });
      }

      const allowedFields = ["editedContent", "changesLog", "status"];
      const updateData: Record<string, any> = {};
      
      for (const field of allowedFields) {
        if (req.body[field] !== undefined) {
          updateData[field] = req.body[field];
        }
      }

      const updated = await storage.updateImportedChapter(id, updateData);
      res.json(updated);
    } catch (error) {
      console.error("Error updating chapter:", error);
      res.status(500).json({ error: "Failed to update chapter" });
    }
  });

  app.delete("/api/imported-manuscripts/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteImportedManuscript(id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting manuscript:", error);
      res.status(500).json({ error: "Failed to delete manuscript" });
    }
  });

  app.get("/api/imported-manuscripts/:id/cost", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const manuscript = await storage.getImportedManuscript(id);
      if (!manuscript) {
        return res.status(404).json({ error: "Manuscript not found" });
      }

      const INPUT_PRICE_PER_MILLION = 1.25;
      const OUTPUT_PRICE_PER_MILLION = 10.0;
      const THINKING_PRICE_PER_MILLION = 3.0;

      const inputCost = ((manuscript.totalInputTokens || 0) / 1_000_000) * INPUT_PRICE_PER_MILLION;
      const outputCost = ((manuscript.totalOutputTokens || 0) / 1_000_000) * OUTPUT_PRICE_PER_MILLION;
      const thinkingCost = ((manuscript.totalThinkingTokens || 0) / 1_000_000) * THINKING_PRICE_PER_MILLION;
      const totalCost = inputCost + outputCost + thinkingCost;

      res.json({
        manuscriptId: manuscript.id,
        inputTokens: manuscript.totalInputTokens || 0,
        outputTokens: manuscript.totalOutputTokens || 0,
        thinkingTokens: manuscript.totalThinkingTokens || 0,
        inputCostUSD: inputCost,
        outputCostUSD: outputCost,
        thinkingCostUSD: thinkingCost,
        totalCostUSD: totalCost,
        pricing: {
          inputPricePerMillion: INPUT_PRICE_PER_MILLION,
          outputPricePerMillion: OUTPUT_PRICE_PER_MILLION,
          thinkingPricePerMillion: THINKING_PRICE_PER_MILLION,
        }
      });
    } catch (error) {
      console.error("Error calculating cost:", error);
      res.status(500).json({ error: "Failed to calculate cost" });
    }
  });

  app.post("/api/imported-chapters/:id/edit", async (req: Request, res: Response) => {
    try {
      const chapterId = parseInt(req.params.id);
      const chapter = await storage.getImportedChapter(chapterId);
      if (!chapter) {
        return res.status(404).json({ error: "Chapter not found" });
      }

      const manuscript = await storage.getImportedManuscript(chapter.manuscriptId);
      if (!manuscript) {
        return res.status(404).json({ error: "Manuscript not found" });
      }

      await storage.updateImportedChapter(chapterId, { status: "processing" });
      await storage.updateImportedManuscript(manuscript.id, { status: "processing" });

      const copyEditor = new CopyEditorAgent();
      const result = await copyEditor.execute({
        chapterContent: chapter.originalContent,
        chapterNumber: chapter.chapterNumber,
        chapterTitle: chapter.title || `Capítulo ${chapter.chapterNumber}`,
        targetLanguage: manuscript.detectedLanguage || manuscript.targetLanguage || "es",
      });

      const inputTokens = result.tokenUsage?.inputTokens || 0;
      const outputTokens = result.tokenUsage?.outputTokens || 0;
      const thinkingTokens = result.tokenUsage?.thinkingTokens || 0;

      await storage.updateImportedChapter(chapterId, {
        editedContent: result.result?.texto_final || chapter.originalContent,
        changesLog: result.result?.cambios_realizados || "Sin cambios",
        status: "completed",
      });

      const chapters = await storage.getImportedChaptersByManuscript(manuscript.id);
      const completedChapters = chapters.filter(c => c.status === "completed").length;
      const allCompleted = completedChapters === manuscript.totalChapters;

      await storage.updateImportedManuscript(manuscript.id, {
        processedChapters: completedChapters,
        totalInputTokens: (manuscript.totalInputTokens || 0) + inputTokens,
        totalOutputTokens: (manuscript.totalOutputTokens || 0) + outputTokens,
        totalThinkingTokens: (manuscript.totalThinkingTokens || 0) + thinkingTokens,
        status: allCompleted ? "completed" : "processing",
      });

      res.json({
        success: true,
        chapterId,
        editedContent: result.result?.texto_final,
        changesLog: result.result?.cambios_realizados,
        tokensUsed: { input: inputTokens, output: outputTokens, thinking: thinkingTokens },
      });
    } catch (error) {
      console.error("Error editing chapter:", error);
      res.status(500).json({ error: "Failed to edit chapter" });
    }
  });

  app.post("/api/imported-manuscripts/:id/edit-all", async (req: Request, res: Response) => {
    try {
      const manuscriptId = parseInt(req.params.id);
      const manuscript = await storage.getImportedManuscript(manuscriptId);
      if (!manuscript) {
        return res.status(404).json({ error: "Manuscript not found" });
      }

      const chapters = await storage.getImportedChaptersByManuscript(manuscriptId);
      const pendingChapters = chapters.filter(c => c.status === "pending");

      if (pendingChapters.length === 0) {
        return res.status(400).json({ error: "No pending chapters to edit" });
      }

      await storage.updateImportedManuscript(manuscriptId, { status: "processing" });

      res.json({ 
        message: "Editing started", 
        manuscriptId, 
        chaptersToEdit: pendingChapters.length 
      });

      const copyEditor = new CopyEditorAgent();
      const manuscriptLanguage = manuscript.detectedLanguage || manuscript.targetLanguage || "es";
      
      for (const chapter of pendingChapters) {
        try {
          await storage.updateImportedChapter(chapter.id, { status: "processing" });

          const result = await copyEditor.execute({
            chapterContent: chapter.originalContent,
            chapterNumber: chapter.chapterNumber,
            chapterTitle: chapter.title || `Capítulo ${chapter.chapterNumber}`,
            targetLanguage: manuscriptLanguage,
          });

          const inputTokens = result.tokenUsage?.inputTokens || 0;
          const outputTokens = result.tokenUsage?.outputTokens || 0;
          const thinkingTokens = result.tokenUsage?.thinkingTokens || 0;

          await storage.updateImportedChapter(chapter.id, {
            editedContent: result.result?.texto_final || chapter.originalContent,
            changesLog: result.result?.cambios_realizados || "Sin cambios",
            status: "completed",
          });

          const updatedManuscript = await storage.getImportedManuscript(manuscriptId);
          if (updatedManuscript) {
            const updatedChapters = await storage.getImportedChaptersByManuscript(manuscriptId);
            const completedCount = updatedChapters.filter(c => c.status === "completed").length;

            await storage.updateImportedManuscript(manuscriptId, {
              processedChapters: completedCount,
              totalInputTokens: (updatedManuscript.totalInputTokens || 0) + inputTokens,
              totalOutputTokens: (updatedManuscript.totalOutputTokens || 0) + outputTokens,
              totalThinkingTokens: (updatedManuscript.totalThinkingTokens || 0) + thinkingTokens,
              status: completedCount === updatedManuscript.totalChapters ? "completed" : "processing",
            });
          }
        } catch (chapterError) {
          console.error(`Error editing chapter ${chapter.id}:`, chapterError);
          await storage.updateImportedChapter(chapter.id, { status: "error" });
        }
      }
    } catch (error) {
      console.error("Error starting batch edit:", error);
      res.status(500).json({ error: "Failed to start batch editing" });
    }
  });

  // Endpoint to rewrite a specific chapter with improvement instructions
  const rewriteChapterSchema = z.object({
    instructions: z.string().min(10, "Instructions must be at least 10 characters"),
    newTitle: z.string().optional(),
  });

  app.post("/api/projects/:projectId/chapters/:chapterNumber/rewrite", async (req: Request, res: Response) => {
    try {
      const projectId = parseInt(req.params.projectId);
      const chapterNumber = parseInt(req.params.chapterNumber);
      
      const validation = rewriteChapterSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ error: validation.error.errors });
      }
      
      const { instructions, newTitle } = validation.data;
      
      const project = await storage.getProject(projectId);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }
      
      if (project.status === "generating") {
        return res.status(400).json({ error: "Cannot rewrite while project is generating" });
      }
      
      const chapters = await storage.getChaptersByProject(projectId);
      const chapter = chapters.find(c => c.chapterNumber === chapterNumber);
      if (!chapter) {
        return res.status(404).json({ error: "Chapter not found" });
      }
      
      const worldBible = await storage.getWorldBibleByProject(projectId);
      
      // Get adjacent chapters for context
      const prevChapter = chapters.find(c => c.chapterNumber === chapterNumber - 1);
      const nextChapter = chapters.find(c => c.chapterNumber === chapterNumber + 1);
      
      res.json({ 
        message: "Rewrite started", 
        projectId, 
        chapterNumber,
        originalWordCount: chapter.wordCount 
      });
      
      // Import Ghostwriter dynamically to avoid circular deps
      const { GhostwriterAgent } = await import("./agents/ghostwriter");
      const ghostwriter = new GhostwriterAgent();
      
      // Build minimal chapter data for rewrite
      const chapterData = {
        numero: chapterNumber,
        titulo: newTitle || chapter.title || `Capítulo ${chapterNumber}`,
        cronologia: "Mantener cronología del capítulo original",
        ubicacion: "Mantener ubicación del capítulo original",
        elenco_presente: [],
        objetivo_narrativo: "Mejorar según instrucciones",
        beats: ["Reescribir capítulo completo según instrucciones de mejora"],
      };
      
      const styleGuide = project.styleGuideId 
        ? await storage.getStyleGuide(project.styleGuideId)
        : null;
      
      // Build world bible object from separate fields
      const worldBibleContent = worldBible ? {
        characters: worldBible.characters,
        timeline: worldBible.timeline,
        worldRules: worldBible.worldRules,
        plotOutline: worldBible.plotOutline,
      } : {};
      
      const result = await ghostwriter.execute({
        chapterNumber,
        chapterData,
        worldBible: worldBibleContent,
        guiaEstilo: styleGuide?.content || "Estilo literario de calidad bestseller",
        previousContinuity: prevChapter?.continuityState ? JSON.stringify(prevChapter.continuityState) : undefined,
        refinementInstructions: `
INSTRUCCIONES DE REESCRITURA:
${instructions}

CONTENIDO ORIGINAL A MEJORAR:
${chapter.content}

IMPORTANTE:
- Mantén la esencia de la trama y los personajes
- Aplica las mejoras indicadas
- Expande el texto si es necesario (mínimo 2000 palabras)
- Mantén coherencia con capítulos anteriores y posteriores
- El nuevo título debe ser: "${newTitle || chapter.title}"
`,
        isRewrite: true,
      });
      
      if (result.content) {
        const { cleanContent, continuityState } = ghostwriter.extractContinuityState(result.content);
        const wordCount = cleanContent.split(/\s+/).filter(Boolean).length;
        
        await storage.updateChapter(chapter.id, {
          content: cleanContent,
          title: newTitle || chapter.title,
          wordCount,
          continuityState: continuityState || chapter.continuityState,
        });
        
        // Log rewrite
        await storage.createThoughtLog({
          projectId,
          chapterId: chapter.id,
          agentName: "Ghostwriter Rewrite",
          agentRole: "ghostwriter-rewrite",
          thoughtContent: `Rewrite instructions: ${instructions.substring(0, 200)}... | Tokens: ${JSON.stringify(result.tokenUsage || {})}`,
        });
        
        // Update project token totals
        const updatedProject = await storage.getProject(projectId);
        if (updatedProject) {
          await storage.updateProject(projectId, {
            totalInputTokens: (updatedProject.totalInputTokens || 0) + (result.tokenUsage?.inputTokens || 0),
            totalOutputTokens: (updatedProject.totalOutputTokens || 0) + (result.tokenUsage?.outputTokens || 0),
            totalThinkingTokens: (updatedProject.totalThinkingTokens || 0) + (result.tokenUsage?.thinkingTokens || 0),
          });
        }
        
        console.log(`[Rewrite] Chapter ${chapterNumber} rewritten: ${chapter.wordCount} -> ${wordCount} words`);
      }
    } catch (error) {
      console.error("Error rewriting chapter:", error);
    }
  });

  // Extended Writing Guides endpoints
  app.get("/api/extended-guides", async (req: Request, res: Response) => {
    try {
      const guides = await storage.getAllExtendedGuides();
      res.json(guides);
    } catch (error) {
      console.error("Error fetching extended guides:", error);
      res.status(500).json({ error: "Failed to fetch extended guides" });
    }
  });

  app.get("/api/extended-guides/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const guide = await storage.getExtendedGuide(id);
      if (!guide) {
        return res.status(404).json({ error: "Extended guide not found" });
      }
      res.json(guide);
    } catch (error) {
      console.error("Error fetching extended guide:", error);
      res.status(500).json({ error: "Failed to fetch extended guide" });
    }
  });

  app.post("/api/extended-guides/upload", upload.single("file"), async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const result = await mammoth.extractRawText({ buffer: req.file.buffer });
      const content = result.value.trim();

      if (!content) {
        return res.status(400).json({ error: "El archivo está vacío o no se pudo extraer el texto" });
      }

      const title = req.body.title || req.file.originalname.replace(/\.docx?$/i, "");
      const description = req.body.description || null;

      const guide = await storage.createExtendedGuide({
        title,
        description,
        originalFileName: req.file.originalname,
        content,
        wordCount: content.split(/\s+/).length,
      });

      res.status(201).json(guide);
    } catch (error) {
      console.error("Error uploading extended guide:", error);
      res.status(500).json({ error: "Failed to upload extended guide" });
    }
  });

  app.patch("/api/extended-guides/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const guide = await storage.getExtendedGuide(id);
      if (!guide) {
        return res.status(404).json({ error: "Extended guide not found" });
      }

      const allowedFields = ["title", "description"];
      const updateData: Record<string, any> = {};
      
      for (const field of allowedFields) {
        if (req.body[field] !== undefined) {
          updateData[field] = req.body[field];
        }
      }

      const updated = await storage.updateExtendedGuide(id, updateData);
      res.json(updated);
    } catch (error) {
      console.error("Error updating extended guide:", error);
      res.status(500).json({ error: "Failed to update extended guide" });
    }
  });

  app.delete("/api/extended-guides/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const guide = await storage.getExtendedGuide(id);
      if (!guide) {
        return res.status(404).json({ error: "Extended guide not found" });
      }

      await storage.deleteExtendedGuide(id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting extended guide:", error);
      res.status(500).json({ error: "Failed to delete extended guide" });
    }
  });

  // =============================================
  // PROJECT QUEUE MANAGEMENT
  // =============================================
  
  // Get queue state
  app.get("/api/queue/state", async (req: Request, res: Response) => {
    try {
      let state = await storage.getQueueState();
      if (!state) {
        state = await storage.updateQueueState({ status: "stopped" });
      }
      res.json(state);
    } catch (error) {
      console.error("Error fetching queue state:", error);
      res.status(500).json({ error: "Failed to fetch queue state" });
    }
  });

  // Update queue state (start, stop, pause)
  app.patch("/api/queue/state", async (req: Request, res: Response) => {
    try {
      const state = await storage.updateQueueState(req.body);
      res.json(state);
    } catch (error) {
      console.error("Error updating queue state:", error);
      res.status(500).json({ error: "Failed to update queue state" });
    }
  });

  // Get all queue items
  app.get("/api/queue", async (req: Request, res: Response) => {
    try {
      const items = await storage.getQueueItems();
      // Enrich with project data
      const enrichedItems = await Promise.all(items.map(async (item) => {
        const project = await storage.getProject(item.projectId);
        return { ...item, project };
      }));
      res.json(enrichedItems);
    } catch (error) {
      console.error("Error fetching queue:", error);
      res.status(500).json({ error: "Failed to fetch queue" });
    }
  });

  // Add project to queue
  app.post("/api/queue", async (req: Request, res: Response) => {
    try {
      const { projectId, priority } = req.body;
      
      // Check if project exists
      const project = await storage.getProject(projectId);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }
      
      // Check if already in queue
      const existing = await storage.getQueueItemByProject(projectId);
      if (existing) {
        return res.status(400).json({ error: "Project already in queue" });
      }
      
      const item = await storage.addToQueue({
        projectId,
        priority: priority || "normal",
        status: "waiting",
        position: 0, // Will be set by storage
      });
      
      res.status(201).json({ ...item, project });
    } catch (error) {
      console.error("Error adding to queue:", error);
      res.status(500).json({ error: "Failed to add to queue" });
    }
  });

  // Remove from queue
  app.delete("/api/queue/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      await storage.removeFromQueue(id);
      res.status(204).send();
    } catch (error) {
      console.error("Error removing from queue:", error);
      res.status(500).json({ error: "Failed to remove from queue" });
    }
  });

  // Reorder queue item
  app.patch("/api/queue/:id/reorder", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const { newPosition } = req.body;
      
      if (typeof newPosition !== "number" || newPosition < 1) {
        return res.status(400).json({ error: "Invalid position" });
      }
      
      await storage.reorderQueue(id, newPosition);
      const items = await storage.getQueueItems();
      res.json(items);
    } catch (error) {
      console.error("Error reordering queue:", error);
      res.status(500).json({ error: "Failed to reorder queue" });
    }
  });

  // Update queue item (priority, status)
  app.patch("/api/queue/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const { priority, status } = req.body;
      
      const updateData: Record<string, any> = {};
      if (priority) updateData.priority = priority;
      if (status) updateData.status = status;
      
      const updated = await storage.updateQueueItem(id, updateData);
      res.json(updated);
    } catch (error) {
      console.error("Error updating queue item:", error);
      res.status(500).json({ error: "Failed to update queue item" });
    }
  });

  // Move item to front of queue (urgent)
  app.post("/api/queue/:id/urgent", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      await storage.reorderQueue(id, 1);
      await storage.updateQueueItem(id, { priority: "urgent" });
      const items = await storage.getQueueItems();
      res.json(items);
    } catch (error) {
      console.error("Error making urgent:", error);
      res.status(500).json({ error: "Failed to make urgent" });
    }
  });

  // Skip current project
  app.post("/api/queue/skip-current", async (req: Request, res: Response) => {
    try {
      await queueManager.skipCurrent();
      res.json({ success: true });
    } catch (error) {
      console.error("Error skipping current:", error);
      res.status(500).json({ error: "Failed to skip current" });
    }
  });

  // Start queue processing
  app.post("/api/queue/start", async (req: Request, res: Response) => {
    try {
      await queueManager.start();
      const state = await queueManager.getState();
      res.json(state);
    } catch (error) {
      console.error("Error starting queue:", error);
      res.status(500).json({ error: "Failed to start queue" });
    }
  });

  // Stop queue processing
  app.post("/api/queue/stop", async (req: Request, res: Response) => {
    try {
      await queueManager.stop();
      const state = await queueManager.getState();
      res.json(state);
    } catch (error) {
      console.error("Error stopping queue:", error);
      res.status(500).json({ error: "Failed to stop queue" });
    }
  });

  // Pause queue processing
  app.post("/api/queue/pause", async (req: Request, res: Response) => {
    try {
      await queueManager.pause();
      const state = await queueManager.getState();
      res.json(state);
    } catch (error) {
      console.error("Error pausing queue:", error);
      res.status(500).json({ error: "Failed to pause queue" });
    }
  });

  // Resume queue processing
  app.post("/api/queue/resume", async (req: Request, res: Response) => {
    try {
      await queueManager.resume();
      const state = await queueManager.getState();
      res.json(state);
    } catch (error) {
      console.error("Error resuming queue:", error);
      res.status(500).json({ error: "Failed to resume queue" });
    }
  });

  // =============================================
  // SERIES ARC TRACKING
  // =============================================

  // Get all milestones for a series
  app.get("/api/series/:id/milestones", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const milestones = await storage.getMilestonesBySeries(id);
      res.json(milestones);
    } catch (error) {
      console.error("Error fetching milestones:", error);
      res.status(500).json({ error: "Failed to fetch milestones" });
    }
  });

  // Create milestone
  app.post("/api/series/:id/milestones", async (req: Request, res: Response) => {
    try {
      const seriesId = parseInt(req.params.id);
      const milestone = await storage.createMilestone({
        ...req.body,
        seriesId,
      });
      res.status(201).json(milestone);
    } catch (error) {
      console.error("Error creating milestone:", error);
      res.status(500).json({ error: "Failed to create milestone" });
    }
  });

  // Update milestone
  app.patch("/api/milestones/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const updated = await storage.updateMilestone(id, req.body);
      res.json(updated);
    } catch (error) {
      console.error("Error updating milestone:", error);
      res.status(500).json({ error: "Failed to update milestone" });
    }
  });

  // Delete milestone
  app.delete("/api/milestones/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteMilestone(id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting milestone:", error);
      res.status(500).json({ error: "Failed to delete milestone" });
    }
  });

  // Get all plot threads for a series
  app.get("/api/series/:id/threads", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const threads = await storage.getPlotThreadsBySeries(id);
      res.json(threads);
    } catch (error) {
      console.error("Error fetching plot threads:", error);
      res.status(500).json({ error: "Failed to fetch plot threads" });
    }
  });

  // Create plot thread
  app.post("/api/series/:id/threads", async (req: Request, res: Response) => {
    try {
      const seriesId = parseInt(req.params.id);
      const thread = await storage.createPlotThread({
        ...req.body,
        seriesId,
      });
      res.status(201).json(thread);
    } catch (error) {
      console.error("Error creating plot thread:", error);
      res.status(500).json({ error: "Failed to create plot thread" });
    }
  });

  // Update plot thread
  app.patch("/api/threads/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const updated = await storage.updatePlotThread(id, req.body);
      res.json(updated);
    } catch (error) {
      console.error("Error updating plot thread:", error);
      res.status(500).json({ error: "Failed to update plot thread" });
    }
  });

  // Delete plot thread
  app.delete("/api/threads/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deletePlotThread(id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting plot thread:", error);
      res.status(500).json({ error: "Failed to delete plot thread" });
    }
  });

  // Get arc verifications for a series
  app.get("/api/series/:id/verifications", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const verifications = await storage.getArcVerificationsBySeries(id);
      res.json(verifications);
    } catch (error) {
      console.error("Error fetching verifications:", error);
      res.status(500).json({ error: "Failed to fetch verifications" });
    }
  });

  // Create arc verification
  app.post("/api/series/:id/verifications", async (req: Request, res: Response) => {
    try {
      const seriesId = parseInt(req.params.id);
      const verification = await storage.createArcVerification({
        ...req.body,
        seriesId,
      });
      res.status(201).json(verification);
    } catch (error) {
      console.error("Error creating verification:", error);
      res.status(500).json({ error: "Failed to create verification" });
    }
  });

  // Update arc verification
  app.patch("/api/verifications/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const updated = await storage.updateArcVerification(id, req.body);
      res.json(updated);
    } catch (error) {
      console.error("Error updating verification:", error);
      res.status(500).json({ error: "Failed to update verification" });
    }
  });

  // Execute AI-powered arc verification for a project
  app.post("/api/series/:id/verify-project", async (req: Request, res: Response) => {
    try {
      const seriesId = parseInt(req.params.id);
      const { projectId } = req.body;
      
      if (!projectId) {
        return res.status(400).json({ error: "projectId is required" });
      }

      const project = await storage.getProject(projectId);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      const series = await storage.getSeries(seriesId);
      if (!series) {
        return res.status(404).json({ error: "Series not found" });
      }

      const chapters = await storage.getChaptersByProject(projectId);
      const worldBible = await storage.getWorldBibleByProject(projectId);
      const milestones = await storage.getMilestonesBySeries(seriesId);
      const threads = await storage.getPlotThreadsBySeries(seriesId);

      const chaptersSummary = chapters
        .filter((c: any) => c.content && c.content.length > 100)
        .sort((a: any, b: any) => a.chapterNumber - b.chapterNumber)
        .map((c: any) => `Capítulo ${c.chapterNumber}: ${c.title || ""}\n${c.content?.substring(0, 2000) || "Sin contenido"}...`)
        .join("\n\n");

      const { ArcValidatorAgent } = await import("./agents/arc-validator");
      const arcValidator = new ArcValidatorAgent();
      
      const result = await arcValidator.execute({
        projectTitle: project.title,
        seriesTitle: series.title,
        volumeNumber: project.seriesOrder || 1,
        totalVolumes: series.totalPlannedBooks || 10,
        chaptersSummary,
        milestones,
        plotThreads: threads,
        worldBible: worldBible || {},
      });

      if (result.result) {
        const verification = await storage.createArcVerification({
          seriesId,
          projectId,
          volumeNumber: project.seriesOrder || 1,
          status: result.result.passed ? "passed" : "needs_attention",
          overallScore: result.result.overallScore,
          milestonesChecked: result.result.milestonesChecked,
          milestonesFulfilled: result.result.milestonesFulfilled,
          threadsProgressed: result.result.threadsProgressed,
          threadsResolved: result.result.threadsResolved,
          findings: JSON.stringify(result.result.findings),
          recommendations: result.result.recommendations,
        });

        for (const mv of result.result.milestoneVerifications) {
          if (mv.isFulfilled) {
            await storage.updateMilestone(mv.milestoneId, {
              isFulfilled: true,
              fulfilledInProjectId: projectId,
              fulfilledInChapter: mv.fulfilledInChapter,
              verificationNotes: mv.verificationNotes,
            });
          }
        }

        for (const tp of result.result.threadProgressions) {
          if (tp.currentStatus !== "active") {
            await storage.updatePlotThread(tp.threadId, {
              status: tp.currentStatus,
              resolvedVolume: tp.resolvedInVolume ? project.seriesOrder : undefined,
              resolvedChapter: tp.resolvedInChapter,
            });
          }
        }

        res.json({ 
          verification, 
          result: result.result,
          tokensUsed: {
            input: (result as any).inputTokens || 0,
            output: (result as any).outputTokens || 0,
          }
        });
      } else {
        res.status(500).json({ error: "Verification failed to produce results" });
      }
    } catch (error) {
      console.error("Error executing arc verification:", error);
      res.status(500).json({ error: "Failed to execute arc verification" });
    }
  });

  // Apply arc corrections to chapters
  app.post("/api/series/:id/apply-corrections", async (req: Request, res: Response) => {
    try {
      const seriesId = parseInt(req.params.id);
      const { projectId, corrections } = req.body;

      if (!projectId || !corrections || !corrections.length) {
        return res.status(400).json({ error: "projectId and corrections array required" });
      }

      const project = await storage.getProject(projectId);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      const series = await storage.getSeries(seriesId);
      if (!series) {
        return res.status(404).json({ error: "Series not found" });
      }

      const worldBible = await storage.getWorldBibleByProject(projectId);
      const milestones = await storage.getMilestonesBySeries(seriesId);
      
      const { CopyEditorAgent } = await import("./agents/copyeditor");
      const copyEditor = new CopyEditorAgent();
      
      const results: any[] = [];
      
      for (const correction of corrections) {
        const { chapterNumber, instruction, milestoneId } = correction;
        
        const chapters = await storage.getChaptersByProject(projectId);
        const chapter = chapters.find((c: any) => c.chapterNumber === chapterNumber);
        
        if (!chapter) {
          results.push({ chapterNumber, success: false, error: "Chapter not found" });
          continue;
        }

        const milestone = milestones.find((m: any) => m.id === milestoneId);
        const milestoneContext = milestone 
          ? `\n\nHITO A CUMPLIR:\n- Descripción: ${milestone.description}\n- Tipo: ${milestone.milestoneType}\n`
          : "";

        const correctionPrompt = `INSTRUCCIÓN DE CORRECCIÓN DE ARCO ARGUMENTAL:
${instruction}
${milestoneContext}

El capítulo debe incorporar el elemento indicado mientras mantiene la coherencia narrativa y el estilo existente.`;

        const result = await copyEditor.execute({
          chapterContent: chapter.content || "",
          chapterNumber,
          chapterTitle: chapter.title || `Capítulo ${chapterNumber}`,
          guiaEstilo: correctionPrompt,
        });

        if ((result as any).result?.texto_final) {
          await storage.updateChapter(chapter.id, {
            content: (result as any).result.texto_final,
            status: "pending_review",
          });
          
          if (milestoneId && milestone) {
            await storage.updateMilestone(milestoneId, {
              isFulfilled: true,
              fulfilledInProjectId: projectId,
              fulfilledInChapter: chapterNumber,
              verificationNotes: `Corregido automáticamente: ${instruction}`,
            });
          }

          results.push({ 
            chapterNumber, 
            success: true, 
            tokensUsed: { input: (result as any).inputTokens || 0, output: (result as any).outputTokens || 0 }
          });
        } else {
          results.push({ chapterNumber, success: false, error: "Editor failed" });
        }
      }

      res.json({ results, totalCorrected: results.filter(r => r.success).length });
    } catch (error) {
      console.error("Error applying arc corrections:", error);
      res.status(500).json({ error: "Failed to apply arc corrections" });
    }
  });

  // Data Migration Endpoints
  app.get("/api/data-export", async (req: Request, res: Response) => {
    try {
      const [
        projects,
        chapters,
        worldBibles,
        pseudonyms,
        styleGuides,
        extendedGuides,
        series,
        continuitySnapshots,
        thoughtLogs,
      ] = await Promise.all([
        storage.getAllProjects(),
        storage.getAllChapters(),
        storage.getAllWorldBibles(),
        storage.getAllPseudonyms(),
        storage.getAllStyleGuides(),
        storage.getAllExtendedGuides(),
        storage.getAllSeries(),
        storage.getAllContinuitySnapshots(),
        storage.getAllThoughtLogs(),
      ]);

      res.json({
        exportedAt: new Date().toISOString(),
        data: {
          pseudonyms,
          styleGuides,
          extendedGuides,
          series,
          projects,
          chapters,
          worldBibles,
          continuitySnapshots,
          thoughtLogs,
        }
      });
    } catch (error) {
      console.error("Error exporting data:", error);
      res.status(500).json({ error: "Failed to export data" });
    }
  });

  app.post("/api/data-import", async (req: Request, res: Response) => {
    try {
      const { data, sourceUrl } = req.body;
      
      let importData = data;
      
      // If sourceUrl provided, fetch from that URL
      if (sourceUrl && !data) {
        const response = await fetch(sourceUrl);
        if (!response.ok) {
          return res.status(400).json({ error: "Failed to fetch from source URL" });
        }
        const fetched = await response.json();
        importData = fetched.data;
      }

      if (!importData) {
        return res.status(400).json({ error: "No data provided. Send { data: {...} } or { sourceUrl: '...' }" });
      }

      // Helper to remove id/createdAt before insert
      const prepareForInsert = (item: any) => {
        const { id, createdAt, ...rest } = item;
        return rest;
      };

      const results: any = { imported: {}, errors: [] };
      
      // ID mappings: oldId -> newId
      const pseudonymIdMap = new Map<number, number>();
      const seriesIdMap = new Map<number, number>();

      // Import in order of dependencies
      if (importData.pseudonyms?.length) {
        for (const item of importData.pseudonyms) {
          try {
            const oldId = item.id;
            const created = await storage.createPseudonym(prepareForInsert(item));
            pseudonymIdMap.set(oldId, created.id);
            results.imported.pseudonyms = (results.imported.pseudonyms || 0) + 1;
          } catch (e: any) {
            if (!e.message?.includes('duplicate')) {
              results.errors.push({ table: 'pseudonyms', error: e.message });
            }
          }
        }
      }

      if (importData.styleGuides?.length) {
        for (const item of importData.styleGuides) {
          try {
            await storage.createStyleGuide(prepareForInsert(item));
            results.imported.styleGuides = (results.imported.styleGuides || 0) + 1;
          } catch (e: any) {
            if (!e.message?.includes('duplicate')) {
              results.errors.push({ table: 'styleGuides', error: e.message });
            }
          }
        }
      }

      if (importData.extendedGuides?.length) {
        for (const item of importData.extendedGuides) {
          try {
            const rest = prepareForInsert(item);
            await storage.createExtendedGuide(rest);
            results.imported.extendedGuides = (results.imported.extendedGuides || 0) + 1;
          } catch (e: any) {
            if (!e.message?.includes('duplicate')) {
              results.errors.push({ table: 'extendedGuides', error: e.message });
            }
          }
        }
      }

      if (importData.series?.length) {
        for (const item of importData.series) {
          try {
            const oldId = item.id;
            // Map pseudonymId to new ID
            const data = prepareForInsert(item);
            if (data.pseudonymId && pseudonymIdMap.has(data.pseudonymId)) {
              data.pseudonymId = pseudonymIdMap.get(data.pseudonymId);
            }
            const created = await storage.createSeries(data);
            seriesIdMap.set(oldId, created.id);
            results.imported.series = (results.imported.series || 0) + 1;
          } catch (e: any) {
            if (!e.message?.includes('duplicate')) {
              results.errors.push({ table: 'series', error: e.message });
            }
          }
        }
      }

      const projectIdMap = new Map<number, number>();
      
      if (importData.projects?.length) {
        for (const item of importData.projects) {
          try {
            const oldId = item.id;
            const data = prepareForInsert(item);
            // Map seriesId and pseudonymId to new IDs
            if (data.seriesId && seriesIdMap.has(data.seriesId)) {
              data.seriesId = seriesIdMap.get(data.seriesId);
            }
            if (data.pseudonymId && pseudonymIdMap.has(data.pseudonymId)) {
              data.pseudonymId = pseudonymIdMap.get(data.pseudonymId);
            }
            const created = await storage.createProject(data);
            projectIdMap.set(oldId, created.id);
            results.imported.projects = (results.imported.projects || 0) + 1;
          } catch (e: any) {
            if (!e.message?.includes('duplicate')) {
              results.errors.push({ table: 'projects', error: e.message });
            }
          }
        }
      }

      if (importData.chapters?.length) {
        for (const item of importData.chapters) {
          try {
            const data = prepareForInsert(item);
            // Map projectId to new ID
            if (data.projectId && projectIdMap.has(data.projectId)) {
              data.projectId = projectIdMap.get(data.projectId);
            }
            await storage.createChapter(data);
            results.imported.chapters = (results.imported.chapters || 0) + 1;
          } catch (e: any) {
            if (!e.message?.includes('duplicate')) {
              results.errors.push({ table: 'chapters', error: e.message });
            }
          }
        }
      }

      if (importData.worldBibles?.length) {
        for (const item of importData.worldBibles) {
          try {
            const data = prepareForInsert(item);
            // Map projectId to new ID
            if (data.projectId && projectIdMap.has(data.projectId)) {
              data.projectId = projectIdMap.get(data.projectId);
            }
            await storage.createWorldBible(data);
            results.imported.worldBibles = (results.imported.worldBibles || 0) + 1;
          } catch (e: any) {
            if (!e.message?.includes('duplicate')) {
              results.errors.push({ table: 'worldBibles', error: e.message });
            }
          }
        }
      }

      res.json({ 
        success: true, 
        message: "Import completed",
        results 
      });
    } catch (error) {
      console.error("Error importing data:", error);
      res.status(500).json({ error: "Failed to import data" });
    }
  });

  return httpServer;
}
