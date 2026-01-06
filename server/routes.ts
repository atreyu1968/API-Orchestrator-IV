import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { Orchestrator } from "./orchestrator";
import { queueManager } from "./queue-manager";
import { insertProjectSchema, insertPseudonymSchema, insertStyleGuideSchema, insertSeriesSchema, insertReeditProjectSchema } from "@shared/schema";
import multer from "multer";
import mammoth from "mammoth";
import { generateManuscriptDocx } from "./services/docx-exporter";
import { z } from "zod";
import { CopyEditorAgent, cancelProject, ItalianReviewerAgent } from "./agents";
import { ReeditOrchestrator } from "./orchestrators/reedit-orchestrator";

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
  totalPlannedBooks: z.number().min(1).max(100).default(3),
});

const updateSeriesSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  workType: z.enum(["series", "trilogy"]).optional(),
  totalPlannedBooks: z.number().min(1).max(100).optional(),
  pseudonymId: z.number().nullable().optional(),
});

const activeStreams = new Map<number, Set<Response>>();
const activeManuscriptAnalysis = new Map<number, AbortController>();

function getSectionLabel(chapterNumber: number, title?: string | null): string {
  if (chapterNumber === 0) return title || "el Prólogo";
  if (chapterNumber === -1) return title || "el Epílogo";
  if (chapterNumber === -2) return title || "la Nota del Autor";
  return `el Capítulo ${chapterNumber}`;
}

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

  app.get("/api/projects/completed", async (_req: Request, res: Response) => {
    try {
      const allProjects = await storage.getAllProjects();
      const completedProjects = allProjects.filter(p => p.status === "completed");
      
      const projectsWithStats = await Promise.all(
        completedProjects.map(async (project) => {
          const chapters = await storage.getChaptersByProject(project.id);
          const totalWords = chapters.reduce((acc, c) => acc + (c.wordCount || 0), 0);
          return {
            id: project.id,
            title: project.title,
            genre: project.genre,
            chapterCount: chapters.length,
            totalWords,
            finalScore: project.finalScore,
            createdAt: project.createdAt,
          };
        })
      );
      
      res.json(projectsWithStats);
    } catch (error) {
      console.error("Error fetching completed projects:", error);
      res.status(500).json({ error: "Failed to fetch completed projects" });
    }
  });

  // DUPLICATE CHAPTERS - Must be before /api/projects/:id to avoid route conflict
  app.get("/api/projects/duplicate-chapters", async (_req: Request, res: Response) => {
    try {
      const allProjects = await storage.getAllProjects();
      const projectsWithDuplicates: Array<{
        projectId: number;
        projectTitle: string;
        projectStatus: string;
        duplicateGroups: Array<{
          chapterNumber: number;
          generations: Array<{
            generationKey: string;
            chapterIds: number[];
            titles: string[];
            statuses: string[];
            wordCounts: number[];
            createdAt: Date;
            totalChapters: number;
            hasContent: boolean;
          }>;
        }>;
      }> = [];

      for (const project of allProjects) {
        const chapters = await storage.getChaptersByProject(project.id);
        
        const byNumber = new Map<number, typeof chapters>();
        for (const ch of chapters) {
          if (!byNumber.has(ch.chapterNumber)) {
            byNumber.set(ch.chapterNumber, []);
          }
          byNumber.get(ch.chapterNumber)!.push(ch);
        }

        const duplicateGroups: typeof projectsWithDuplicates[0]["duplicateGroups"] = [];
        
        const chapterNumbers = Array.from(byNumber.keys());
        for (const chapterNum of chapterNumbers) {
          const chapterList = byNumber.get(chapterNum)!;
          if (chapterList.length > 1) {
            const byGeneration: Record<string, typeof chapterList> = {};
            
            for (const ch of chapterList) {
              const createdTime = new Date(ch.createdAt).getTime();
              const genKey = new Date(Math.floor(createdTime / 5000) * 5000).toISOString();
              
              if (!byGeneration[genKey]) {
                byGeneration[genKey] = [];
              }
              byGeneration[genKey].push(ch);
            }

            const generations = Object.entries(byGeneration)
              .map(([genKey, chs]) => ({
                generationKey: genKey,
                chapterIds: chs.map((c: typeof chapters[0]) => c.id),
                titles: chs.map((c: typeof chapters[0]) => c.title || `Sin título`),
                statuses: chs.map((c: typeof chapters[0]) => c.status),
                wordCounts: chs.map((c: typeof chapters[0]) => c.wordCount || 0),
                createdAt: new Date(genKey),
                totalChapters: chs.length,
                hasContent: chs.some((c: typeof chapters[0]) => c.content && c.content.length > 0),
              }))
              .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

            duplicateGroups.push({
              chapterNumber: chapterNum,
              generations,
            });
          }
        }

        if (duplicateGroups.length > 0) {
          projectsWithDuplicates.push({
            projectId: project.id,
            projectTitle: project.title,
            projectStatus: project.status,
            duplicateGroups: duplicateGroups.sort((a, b) => a.chapterNumber - b.chapterNumber),
          });
        }
      }

      res.json(projectsWithDuplicates);
    } catch (error) {
      console.error("Error detecting duplicate chapters:", error);
      res.status(500).json({ error: "Failed to detect duplicate chapters" });
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

  app.get("/api/projects/:id/export-logs-pdf", async (req: Request, res: Response) => {
    try {
      const PDFDocument = (await import("pdfkit")).default;
      const id = parseInt(req.params.id);
      const project = await storage.getProject(id);
      
      if (!project) {
        return res.status(404).json({ error: "Proyecto no encontrado" });
      }

      const logs = await storage.getActivityLogsByProject(id, 5000);
      
      const doc = new PDFDocument({ 
        size: "A4", 
        margin: 50,
        bufferPages: true 
      });
      
      const chunks: Buffer[] = [];
      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      
      const pdfPromise = new Promise<Buffer>((resolve, reject) => {
        doc.on("end", () => resolve(Buffer.concat(chunks)));
        doc.on("error", reject);
      });

      doc.fontSize(18).font("Helvetica-Bold").text(`Registro de Actividad`, { align: "center" });
      doc.fontSize(14).font("Helvetica").text(`Proyecto: ${project.title}`, { align: "center" });
      doc.fontSize(10).text(`Exportado: ${new Date().toLocaleString("es-ES")}`, { align: "center" });
      doc.moveDown(2);

      const agentNames: Record<string, string> = {
        architect: "Arquitecto",
        ghostwriter: "Escritor",
        editor: "Editor",
        copyeditor: "Corrector de Estilo",
        "continuity-sentinel": "Centinela de Continuidad",
        "voice-rhythm-auditor": "Auditor de Voz y Ritmo",
        "semantic-repetition-detector": "Detector de Repeticiones",
        "final-reviewer": "Revisor Final",
        orchestrator: "Orquestador",
        system: "Sistema",
      };

      const levelLabels: Record<string, string> = {
        info: "INFO",
        success: "EXITO",
        warn: "AVISO",
        warning: "AVISO",
        error: "ERROR",
      };

      doc.fontSize(9);
      
      for (const log of logs.reverse()) {
        const timestamp = new Date(log.createdAt).toLocaleString("es-ES", {
          day: "2-digit",
          month: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit"
        });
        
        const agentLabel = agentNames[log.agentRole || "system"] || log.agentRole || "Sistema";
        const levelLabel = levelLabels[log.level] || log.level.toUpperCase();
        
        const line = `[${timestamp}] [${levelLabel}] [${agentLabel}] ${log.message}`;
        
        if (doc.y > 750) {
          doc.addPage();
        }
        
        if (log.level === "error") {
          doc.fillColor("red");
        } else if (log.level === "success") {
          doc.fillColor("green");
        } else if (log.level === "warn" || log.level === "warning") {
          doc.fillColor("orange");
        } else {
          doc.fillColor("black");
        }
        
        doc.text(line, { width: 495, lineGap: 2 });
        doc.fillColor("black");
      }

      doc.end();
      const buffer = await pdfPromise;

      const safeTitle = project.title.replace(/[^a-zA-Z0-9áéíóúñÁÉÍÓÚÑ\s]/g, "").replace(/\s+/g, "_");
      const filename = `${safeTitle}_logs.pdf`;

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Content-Length", buffer.length);
      res.send(buffer);

    } catch (error) {
      console.error("Error exporting logs to PDF:", error);
      res.status(500).json({ error: "Error al exportar logs" });
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
          const label = getSectionLabel(chapterNumber, chapterTitle);
          await persistActivityLog(id, "success", `${label} completado (${wordCount} palabras)`, "ghostwriter");
        },
        onChapterRewrite: async (chapterNumber, chapterTitle, currentIndex, totalToRewrite, reason) => {
          sendToStreams({ type: "chapter_rewrite", chapterNumber, chapterTitle, currentIndex, totalToRewrite, reason });
          const label = getSectionLabel(chapterNumber, chapterTitle);
          await persistActivityLog(id, "warning", `Reescritura ${currentIndex}/${totalToRewrite}: ${label} - ${reason}`, "editor");
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
          const label = getSectionLabel(chapterNumber, chapterTitle);
          await persistActivityLog(id, "success", `${label} completado (${wordCount} palabras)`, "ghostwriter");
        },
        onChapterRewrite: async (chapterNumber, chapterTitle, currentIndex, totalToRewrite, reason) => {
          sendToStreams({ type: "chapter_rewrite", chapterNumber, chapterTitle, currentIndex, totalToRewrite, reason });
          const label = getSectionLabel(chapterNumber, chapterTitle);
          await persistActivityLog(id, "warning", `Reescritura ${currentIndex}/${totalToRewrite}: ${label} - ${reason}`, "editor");
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
          const label = getSectionLabel(chapterNumber, chapterTitle);
          await persistActivityLog(id, "success", `${label} completado (${wordCount} palabras)`, "ghostwriter");
        },
        onChapterRewrite: async (chapterNumber, chapterTitle, currentIndex, totalToRewrite, reason) => {
          sendToStreams({ type: "chapter_rewrite", chapterNumber, chapterTitle, currentIndex, totalToRewrite, reason });
          const label = getSectionLabel(chapterNumber, chapterTitle);
          await persistActivityLog(id, "warning", `Reescritura ${currentIndex}/${totalToRewrite}: ${label} - ${reason}`, "editor");
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
          const label = getSectionLabel(chapterNumber, chapterTitle);
          await persistActivityLog(id, "success", `${label} corregido (${wordCount} palabras)`, "ghostwriter");
        },
        onChapterRewrite: async (chapterNumber, chapterTitle, currentIndex, totalToRewrite, reason) => {
          sendToStreams({ type: "chapter_rewrite", chapterNumber, chapterTitle, currentIndex, totalToRewrite, reason });
          const label = getSectionLabel(chapterNumber, chapterTitle);
          await persistActivityLog(id, "warning", `Reescritura ${currentIndex}/${totalToRewrite}: ${label} - ${reason}`, "continuity-sentinel");
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
          const label = getSectionLabel(chapterNumber, chapterTitle);
          await persistActivityLog(id, "success", `${label} regenerado (${wordCount} palabras)`, "ghostwriter");
        },
        onChapterRewrite: async (chapterNumber, chapterTitle, currentIndex, totalToRewrite, reason) => {
          sendToStreams({ type: "chapter_rewrite", chapterNumber, chapterTitle, currentIndex, totalToRewrite, reason });
          const label = getSectionLabel(chapterNumber, chapterTitle);
          await persistActivityLog(id, "warning", `Regenerando ${currentIndex}/${totalToRewrite}: ${label} - ${reason}`, "ghostwriter");
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

      const sectionLabel = getSectionLabel(chapterNumber, chapter.title);
      
      if (wordCount < 500) {
        await storage.updateAgentStatus(projectId, "ghostwriter", { 
          status: "error", 
          currentTask: `${sectionLabel} truncado (${wordCount} palabras)` 
        });
        return res.status(400).json({ 
          error: "Chapter still truncated", 
          wordCount,
          message: `${sectionLabel} solo tiene ${wordCount} palabras. Intenta de nuevo más tarde.`
        });
      }

      await storage.updateChapter(chapter.id, {
        content: cleanContent,
        status: "completed"
      });

      await storage.updateAgentStatus(projectId, "ghostwriter", { 
        status: "idle", 
        currentTask: `${sectionLabel} regenerado (${wordCount} palabras)` 
      });

      res.json({ 
        success: true, 
        chapterNumber, 
        wordCount,
        message: `${sectionLabel} regenerado exitosamente con ${wordCount} palabras`
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
      const allManuscripts = await storage.getAllImportedManuscripts();
      
      const registry = allSeries.map(s => {
        const pseudonym = s.pseudonymId ? allPseudonyms.find(p => p.id === s.pseudonymId) : null;
        const seriesProjects = allProjects
          .filter(p => p.seriesId === s.id)
          .sort((a, b) => (a.seriesOrder || 0) - (b.seriesOrder || 0));
        const seriesManuscripts = allManuscripts
          .filter(m => m.seriesId === s.id)
          .sort((a, b) => (a.seriesOrder || 0) - (b.seriesOrder || 0));
        
        const volumes = [
          ...seriesProjects.map(p => ({
            type: "project" as const,
            id: p.id,
            title: p.title,
            seriesOrder: p.seriesOrder,
            status: p.status,
            wordCount: 0,
            continuityAnalysisStatus: null,
            hasContinuitySnapshot: false,
          })),
          ...seriesManuscripts.map(m => ({
            type: "imported" as const,
            id: m.id,
            title: m.title,
            seriesOrder: m.seriesOrder,
            status: m.status === "completed" ? "completed" : "imported",
            wordCount: m.totalWordCount || 0,
            continuityAnalysisStatus: m.continuityAnalysisStatus || "pending",
            hasContinuitySnapshot: !!m.continuitySnapshot,
          })),
        ].sort((a, b) => (a.seriesOrder || 0) - (b.seriesOrder || 0));
        
        return {
          ...s,
          pseudonym: pseudonym || null,
          projects: seriesProjects,
          importedManuscripts: seriesManuscripts,
          volumes,
          completedVolumes: volumes.filter(v => v.status === "completed" || v.status === "imported").length,
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

  app.get("/api/series/:id/volumes", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const series = await storage.getSeries(id);
      if (!series) {
        return res.status(404).json({ error: "Series not found" });
      }
      
      const projects = await storage.getProjectsBySeries(id);
      const manuscripts = await storage.getImportedManuscriptsBySeries(id);
      
      const volumes = [
        ...projects.map(p => ({
          type: "project" as const,
          id: p.id,
          title: p.title,
          seriesOrder: p.seriesOrder,
          status: p.status,
          wordCount: 0,
          createdAt: p.createdAt,
        })),
        ...manuscripts.map(m => ({
          type: "imported" as const,
          id: m.id,
          title: m.title,
          seriesOrder: m.seriesOrder,
          status: "imported" as const,
          wordCount: m.totalWordCount || 0,
          createdAt: m.createdAt,
        })),
      ].sort((a, b) => (a.seriesOrder || 0) - (b.seriesOrder || 0));
      
      const nextOrder = Math.max(0, ...volumes.map(v => v.seriesOrder || 0)) + 1;
      
      res.json({ volumes, nextOrder });
    } catch (error) {
      console.error("Error fetching series volumes:", error);
      res.status(500).json({ error: "Failed to fetch series volumes" });
    }
  });

  app.post("/api/series/:id/link-manuscript", async (req: Request, res: Response) => {
    try {
      const seriesId = parseInt(req.params.id);
      const { manuscriptId, seriesOrder } = req.body;
      
      if (!manuscriptId || !seriesOrder) {
        return res.status(400).json({ error: "manuscriptId and seriesOrder are required" });
      }
      
      const series = await storage.getSeries(seriesId);
      if (!series) {
        return res.status(404).json({ error: "Series not found" });
      }
      
      const manuscript = await storage.getImportedManuscript(manuscriptId);
      if (!manuscript) {
        return res.status(404).json({ error: "Manuscript not found" });
      }
      
      const existingProjects = await storage.getProjectsBySeries(seriesId);
      const existingManuscripts = await storage.getImportedManuscriptsBySeries(seriesId);
      
      const orderConflict = [
        ...existingProjects.map(p => p.seriesOrder),
        ...existingManuscripts.filter(m => m.id !== manuscriptId).map(m => m.seriesOrder)
      ].includes(seriesOrder);
      
      if (orderConflict) {
        return res.status(400).json({ error: `Volume number ${seriesOrder} is already used in this series` });
      }
      
      const updated = await storage.updateImportedManuscript(manuscriptId, {
        seriesId,
        seriesOrder,
        pseudonymId: series.pseudonymId,
        continuityAnalysisStatus: "pending",
      });
      
      res.json(updated);
    } catch (error) {
      console.error("Error linking manuscript to series:", error);
      res.status(500).json({ error: "Failed to link manuscript to series" });
    }
  });

  app.post("/api/series/:id/upload-volume", upload.single('file'), async (req: Request, res: Response) => {
    try {
      const seriesId = parseInt(req.params.id);
      const file = req.file;
      
      if (!file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const series = await storage.getSeries(seriesId);
      if (!series) {
        return res.status(404).json({ error: "Series not found" });
      }

      const result = await mammoth.extractRawText({ buffer: file.buffer });
      const fullContent = result.value.trim();

      if (!fullContent || fullContent.length < 1000) {
        return res.status(400).json({ error: "El documento está vacío o tiene muy poco contenido" });
      }

      const existingProjects = await storage.getProjectsBySeries(seriesId);
      const existingManuscripts = await storage.getImportedManuscriptsBySeries(seriesId);
      const nextOrder = Math.max(0, 
        ...existingProjects.map(p => p.seriesOrder || 0),
        ...existingManuscripts.map(m => m.seriesOrder || 0)
      ) + 1;

      const chapterPattern = /(?:^|\n)(?:(?:CAPÍTULO|CAPITULO|CAP[ÍI]TULO|Capítulo|Capitulo|Capìtulo|Chapter|CHAPTER|CHAPITRE|Chapitre|CAPITOLO|Capitolo|KAPITEL|Kapitel|CAPÍTOL|Capítol)[ \t.:]*(\d+|[IVXLCDM]+)(?:[ \t.:—–-]+)?([^\n]*))/gi;
      
      let lastIndex = 0;
      const chapters: { number: number; title: string; content: string }[] = [];
      let match;
      const matches: { index: number; number: number; title: string }[] = [];
      
      while ((match = chapterPattern.exec(fullContent)) !== null) {
        const num = parseInt(match[1]) || matches.length + 1;
        const title = (match[2] || "").trim();
        matches.push({ index: match.index, number: num, title });
      }

      for (let i = 0; i < matches.length; i++) {
        const start = matches[i].index;
        const end = i + 1 < matches.length ? matches[i + 1].index : fullContent.length;
        const content = fullContent.substring(start, end).trim();
        chapters.push({
          number: matches[i].number,
          title: matches[i].title,
          content,
        });
      }

      if (chapters.length === 0) {
        const lines = fullContent.split('\n');
        const chunkSize = Math.ceil(lines.length / 10);
        for (let i = 0; i < 10 && i * chunkSize < lines.length; i++) {
          chapters.push({
            number: i + 1,
            title: "",
            content: lines.slice(i * chunkSize, (i + 1) * chunkSize).join('\n'),
          });
        }
      }

      const titleFromFile = file.originalname.replace(/\.[^/.]+$/, "").replace(/_/g, " ");
      
      let manuscript = await storage.createImportedManuscript({
        title: titleFromFile,
        originalFileName: file.originalname,
        detectedLanguage: "es",
        totalChapters: chapters.length,
        totalWordCount: fullContent.split(/\s+/).length,
        pseudonymId: series.pseudonymId,
        seriesId: seriesId,
        seriesOrder: nextOrder,
        continuityAnalysisStatus: "pending",
      });
      
      const updatedManuscript = await storage.updateImportedManuscript(manuscript.id, {
        status: "completed",
        processedChapters: chapters.length,
      });
      if (updatedManuscript) {
        manuscript = updatedManuscript;
      }

      for (const chapter of chapters) {
        await storage.createImportedChapter({
          manuscriptId: manuscript.id,
          chapterNumber: chapter.number,
          title: chapter.title || `Capítulo ${chapter.number}`,
          originalContent: chapter.content,
          editedContent: chapter.content,
          status: "completed",
          wordCount: chapter.content.split(/\s+/).length,
        });
      }

      res.json({
        message: "Volumen subido correctamente",
        manuscript: {
          id: manuscript.id,
          title: manuscript.title,
          seriesOrder: manuscript.seriesOrder,
          totalChapters: chapters.length,
          wordCount: fullContent.split(/\s+/).length,
        },
      });
    } catch (error) {
      console.error("Error uploading volume:", error);
      res.status(500).json({ error: "Failed to upload volume" });
    }
  });

  app.post("/api/imported-manuscripts/:id/analyze-continuity", async (req: Request, res: Response) => {
    const manuscriptId = parseInt(req.params.id);
    
    try {
      const manuscript = await storage.getImportedManuscript(manuscriptId);
      
      if (!manuscript) {
        return res.status(404).json({ error: "Manuscript not found" });
      }
      
      if (!manuscript.seriesId) {
        return res.status(400).json({ error: "Manuscript must be linked to a series before analysis" });
      }
      
      if (activeManuscriptAnalysis.has(manuscriptId)) {
        return res.status(409).json({ error: "Analysis already in progress" });
      }
      
      const series = await storage.getSeries(manuscript.seriesId);
      if (!series) {
        return res.status(404).json({ error: "Series not found" });
      }
      
      const abortController = new AbortController();
      activeManuscriptAnalysis.set(manuscriptId, abortController);
      
      await storage.updateImportedManuscript(manuscriptId, {
        continuityAnalysisStatus: "analyzing",
      });
      
      const chapters = await storage.getImportedChaptersByManuscript(manuscriptId);
      
      if (chapters.length === 0) {
        activeManuscriptAnalysis.delete(manuscriptId);
        await storage.updateImportedManuscript(manuscriptId, {
          continuityAnalysisStatus: "error",
        });
        return res.status(400).json({ error: "Manuscript has no chapters to analyze" });
      }
      
      const { ManuscriptAnalyzerAgent } = await import("./agents/manuscript-analyzer");
      const analyzer = new ManuscriptAnalyzerAgent();
      
      const previousManuscripts = await storage.getImportedManuscriptsBySeries(manuscript.seriesId);
      const earlierVolumes = previousManuscripts
        .filter(m => m.id !== manuscriptId && m.seriesOrder && manuscript.seriesOrder && m.seriesOrder < manuscript.seriesOrder && m.continuitySnapshot)
        .sort((a, b) => (a.seriesOrder || 0) - (b.seriesOrder || 0));
      
      let previousContext = "";
      if (earlierVolumes.length > 0) {
        previousContext = earlierVolumes.map(v => {
          const snapshot = v.continuitySnapshot as any;
          return `**Volumen ${v.seriesOrder}: ${v.title}**\n${snapshot?.synopsis || "Sin sinopsis"}`;
        }).join("\n\n");
      }
      
      if (abortController.signal.aborted) {
        activeManuscriptAnalysis.delete(manuscriptId);
        await storage.updateImportedManuscript(manuscriptId, {
          continuityAnalysisStatus: "pending",
        });
        return res.status(499).json({ error: "Analysis cancelled" });
      }
      
      console.log(`[ContinuityAnalysis] Starting analysis for manuscript ${manuscriptId} (${manuscript.title}) with ${chapters.length} chapters`);
      
      let analyzerResult;
      try {
        analyzerResult = await analyzer.analyze({
          manuscriptTitle: manuscript.title,
          seriesTitle: series.title,
          volumeNumber: manuscript.seriesOrder || 1,
          chapters: chapters.map(ch => ({
            chapterNumber: ch.chapterNumber,
            title: ch.title || undefined,
            content: ch.editedContent || ch.originalContent,
          })),
          previousVolumesContext: previousContext || undefined,
        });
      } catch (analyzeError: any) {
        activeManuscriptAnalysis.delete(manuscriptId);
        const errMsg = String(analyzeError?.message || analyzeError || "Unknown error");
        console.error(`[ContinuityAnalysis] Analysis failed for manuscript ${manuscriptId}:`, errMsg);
        await storage.updateImportedManuscript(manuscriptId, {
          continuityAnalysisStatus: "error",
        });
        return res.status(500).json({ error: `Error de análisis: ${errMsg.substring(0, 200)}` });
      }
      
      activeManuscriptAnalysis.delete(manuscriptId);
      
      if (abortController.signal.aborted) {
        await storage.updateImportedManuscript(manuscriptId, {
          continuityAnalysisStatus: "pending",
        });
        return res.status(499).json({ error: "Analysis cancelled" });
      }
      
      const tokenUpdate: any = {
        totalInputTokens: (manuscript.totalInputTokens || 0) + (analyzerResult.tokenUsage.inputTokens || 0),
        totalOutputTokens: (manuscript.totalOutputTokens || 0) + (analyzerResult.tokenUsage.outputTokens || 0),
        totalThinkingTokens: (manuscript.totalThinkingTokens || 0) + (analyzerResult.tokenUsage.thinkingTokens || 0),
      };
      
      if (analyzerResult.result) {
        await storage.updateImportedManuscript(manuscriptId, {
          continuitySnapshot: analyzerResult.result,
          continuityAnalysisStatus: "completed",
          ...tokenUpdate,
        });
        res.json({ 
          success: true, 
          snapshot: analyzerResult.result,
          tokenUsage: analyzerResult.tokenUsage,
        });
      } else {
        await storage.updateImportedManuscript(manuscriptId, {
          continuityAnalysisStatus: "error",
          ...tokenUpdate,
        });
        console.error("[ManuscriptAnalysis] Analysis returned null result - possible rate limit or parsing error");
        res.status(500).json({ error: "El análisis no pudo completarse. Posible límite de velocidad de la API. Espere unos minutos e intente de nuevo." });
      }
    } catch (error: any) {
      activeManuscriptAnalysis.delete(manuscriptId);
      const errorMessage = String(error?.message || error || "");
      console.error("Error analyzing manuscript continuity:", errorMessage);
      
      if (errorMessage.includes("RATELIMIT") || errorMessage.includes("429") || errorMessage.includes("rate limit")) {
        res.status(429).json({ error: "Límite de velocidad alcanzado. Por favor, espere unos minutos e intente de nuevo." });
      } else if (errorMessage.includes("TIMEOUT")) {
        res.status(504).json({ error: "El análisis tardó demasiado tiempo. El manuscrito puede ser muy largo." });
      } else {
        res.status(500).json({ error: `Error al analizar: ${errorMessage.substring(0, 100)}` });
      }
    }
  });
  
  app.post("/api/imported-manuscripts/:id/cancel-analysis", async (req: Request, res: Response) => {
    try {
      const manuscriptId = parseInt(req.params.id);
      const controller = activeManuscriptAnalysis.get(manuscriptId);
      
      if (controller) {
        controller.abort();
        activeManuscriptAnalysis.delete(manuscriptId);
      }
      
      await storage.updateImportedManuscript(manuscriptId, {
        continuityAnalysisStatus: "pending",
      });
      
      res.json({ success: true, message: "Analysis cancelled" });
    } catch (error) {
      console.error("Error cancelling manuscript analysis:", error);
      res.status(500).json({ error: "Failed to cancel analysis" });
    }
  });

  app.get("/api/series/:id/full-continuity", async (req: Request, res: Response) => {
    try {
      const seriesId = parseInt(req.params.id);
      const series = await storage.getSeries(seriesId);
      
      if (!series) {
        return res.status(404).json({ error: "Series not found" });
      }
      
      const fullContinuity = await storage.getSeriesFullContinuity(seriesId);
      res.json(fullContinuity);
    } catch (error) {
      console.error("Error fetching series full continuity:", error);
      res.status(500).json({ error: "Failed to fetch series full continuity" });
    }
  });

  app.post("/api/series", async (req: Request, res: Response) => {
    console.log("[Series] POST /api/series - body:", JSON.stringify(req.body));
    try {
      const parsed = createSeriesSchema.safeParse(req.body);
      if (!parsed.success) {
        console.error("[Series] Validation failed:", JSON.stringify(parsed.error.flatten()));
        return res.status(400).json({ error: "Invalid series data", details: parsed.error.flatten() });
      }
      console.log("[Series] Creating series with data:", JSON.stringify(parsed.data));
      const newSeries = await storage.createSeries({
        title: parsed.data.title,
        description: parsed.data.description || null,
        workType: parsed.data.workType,
        totalPlannedBooks: parsed.data.totalPlannedBooks,
      });
      console.log("[Series] Series created successfully:", newSeries.id);
      res.status(201).json(newSeries);
    } catch (error: any) {
      console.error("[Series] Error creating series:", error?.message || error);
      console.error("[Series] Stack:", error?.stack);
      res.status(500).json({ error: "Failed to create series", details: error?.message });
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
        httpOptions: { 
          apiVersion: "",
          baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL! 
        },
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
            model: "gemini-3-pro-preview",
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
    } catch (error: any) {
      console.error("Error extracting from series guide:", error);
      const errorMessage = error?.message || String(error);
      const isRateLimit = errorMessage.includes("RATELIMIT") || errorMessage.includes("429");
      res.status(isRateLimit ? 429 : 500).json({ 
        error: isRateLimit 
          ? "Límite de tasa excedido. Espera unos minutos e inténtalo de nuevo." 
          : "No se pudo extraer de la guía",
        details: errorMessage.substring(0, 500)
      });
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

      const allowedFields = [
        "status", "processedChapters", "totalInputTokens", "totalOutputTokens", 
        "totalThinkingTokens", "seriesId", "seriesOrder", "pseudonymId", "totalWordCount"
      ];
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

      const INPUT_PRICE_PER_MILLION = 0.80;
      const OUTPUT_PRICE_PER_MILLION = 6.50;
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

  app.post("/api/imported-chapters/:id/review-italian", async (req: Request, res: Response) => {
    try {
      const chapterId = parseInt(req.params.id);
      const chapter = await storage.getImportedChapter(chapterId);
      if (!chapter) {
        return res.status(404).json({ error: "Chapter not found" });
      }

      const contentToReview = chapter.editedContent || chapter.originalContent;
      
      const reviewer = new ItalianReviewerAgent();
      const result = await reviewer.execute({
        chapterContent: contentToReview,
        chapterNumber: chapter.chapterNumber,
      });

      if (!result.result) {
        return res.status(500).json({ error: "Failed to analyze text" });
      }

      res.json({
        success: true,
        chapterId,
        review: result.result,
        tokensUsed: result.tokenUsage,
      });
    } catch (error) {
      console.error("Error reviewing Italian chapter:", error);
      res.status(500).json({ error: "Failed to review chapter" });
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

      const sortedChapters = chapters.sort((a: any, b: any) => a.chapterNumber - b.chapterNumber);
      const totalChapters = sortedChapters.length;
      const chaptersWithContent = sortedChapters.filter((c: any) => c.content && c.content.length > 50);
      
      const chaptersSummary = sortedChapters.map((c: any) => {
        const chapterLabel = c.chapterNumber === 0 ? "Prólogo" : 
                            c.chapterNumber === -1 ? "Epílogo" : 
                            `Capítulo ${c.chapterNumber}`;
        const title = c.title ? `: ${c.title}` : "";
        const wordCount = c.wordCount || (c.content?.split(/\s+/).length || 0);
        
        if (!c.content || c.content.length < 50) {
          return `${chapterLabel}${title}\n[Sin contenido - ${c.status || "pending"}]`;
        }
        
        const contentPreview = c.content.substring(0, 8000);
        const isTruncated = c.content.length > 8000;
        
        return `${chapterLabel}${title} (${wordCount} palabras)\n${contentPreview}${isTruncated ? "\n[...contenido truncado para verificación...]" : ""}`;
      }).join("\n\n---\n\n");
      
      console.log(`[Arc Verification] Building summary: ${totalChapters} chapters, ${chaptersWithContent.length} with content`);

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

      const milestones = await storage.getMilestonesBySeries(seriesId);
      
      const { CopyEditorAgent } = await import("./agents/copyeditor");
      const copyEditor = new CopyEditorAgent();
      
      const results: any[] = [];
      const MAX_RETRIES = 2;
      
      for (const correction of corrections) {
        const { chapterNumber, instruction, milestoneId } = correction;
        
        const chapters = await storage.getChaptersByProject(projectId);
        const chapter = chapters.find((c: any) => c.chapterNumber === chapterNumber);
        
        if (!chapter) {
          results.push({ chapterNumber, success: false, error: "Chapter not found" });
          continue;
        }

        const milestone = milestones.find((m: any) => m.id === milestoneId);
        let currentContent = chapter.content || "";
        let verificationPassed = false;
        let attempts = 0;
        let lastResult: any = null;
        
        while (!verificationPassed && attempts < MAX_RETRIES) {
          attempts++;
          
          const correctionPrompt = milestone ? `
═══════════════════════════════════════════════════════════════════════════════
CORRECCIÓN OBLIGATORIA DE ARCO ARGUMENTAL - INTENTO ${attempts}/${MAX_RETRIES}
═══════════════════════════════════════════════════════════════════════════════

HITO QUE DEBE CUMPLIRSE EN ESTE CAPÍTULO:
• Tipo: ${milestone.milestoneType}
• Descripción exacta: "${milestone.description}"

INSTRUCCIONES IMPERATIVAS:
1. AÑADE una escena o pasaje NUEVO de 3-5 párrafos que CUMPLA EXPLÍCITAMENTE el hito
2. La escena debe ser NARRATIVA (mostrar, no decir) - diálogos, acciones, descripciones
3. El hito "${milestone.description}" debe ser EVIDENTE para cualquier lector
4. MANTÉN TODO el contenido original del capítulo intacto
5. INTEGRA la nueva escena de forma natural en el flujo narrativo
6. NO cambies el tono, estilo ni la voz narrativa existente

EJEMPLO DE INTEGRACIÓN:
- Si el hito es "El protagonista descubre la traición de su aliado"
- Añade una escena donde el protagonista LITERALMENTE descubre pruebas o presencia la traición
- No basta con insinuaciones o sospechas - debe ser un MOMENTO CLARO

${attempts > 1 ? `
⚠️ ATENCIÓN: El intento anterior NO cumplió el hito. Esta vez:
- Sé MÁS EXPLÍCITO en mostrar el hito
- Usa DIÁLOGOS DIRECTOS que evidencien el cumplimiento
- Asegúrate de que el momento sea INEQUÍVOCO
` : ""}

CRITERIO DE VERIFICACIÓN: El texto resultante debe contener un momento narrativo claro donde "${milestone.description}" OCURRA de manera explícita.
═══════════════════════════════════════════════════════════════════════════════
` : `
CORRECCIÓN DE ARCO ARGUMENTAL:
${instruction}

Añade contenido narrativo explícito que cumpla este requisito, manteniendo todo el contenido original.
`;

          const result = await copyEditor.execute({
            chapterContent: currentContent,
            chapterNumber,
            chapterTitle: chapter.title || `Capítulo ${chapterNumber}`,
            guiaEstilo: correctionPrompt,
          });

          lastResult = result;

          if ((result as any).result?.texto_final) {
            const newContent = (result as any).result.texto_final;
            
            // Verify the correction with semantic analysis
            if (milestone) {
              const contentLower = newContent.toLowerCase();
              const descLower = milestone.description.toLowerCase();
              
              // Check for key concept words (words > 4 chars)
              const keyWords = descLower.split(/\s+/).filter((w: string) => w.length > 4);
              const foundWords = keyWords.filter((word: string) => contentLower.includes(word));
              const wordCoverage = keyWords.length > 0 ? foundWords.length / keyWords.length : 0;
              
              // Check if content grew (new scene added)
              const contentGrew = newContent.length > currentContent.length * 1.02;
              
              // Pass if: good word coverage AND content grew
              verificationPassed = wordCoverage >= 0.4 && contentGrew;
              
              console.log(`[ArcCorrection] Attempt ${attempts}: wordCoverage=${wordCoverage.toFixed(2)}, contentGrew=${contentGrew}, passed=${verificationPassed}`);
            } else {
              verificationPassed = true;
            }
            
            currentContent = newContent;
          } else {
            break; // Editor failed, stop retrying
          }
        }
        
        // Save the final result
        if (lastResult?.result?.texto_final) {
          await storage.updateChapter(chapter.id, {
            content: currentContent,
            status: "completed", // Always mark completed - the correction was applied
          });
          
          if (milestoneId && milestone) {
            await storage.updateMilestone(milestoneId, {
              isFulfilled: verificationPassed,
              fulfilledInProjectId: projectId,
              fulfilledInChapter: chapterNumber,
              verificationNotes: verificationPassed 
                ? `Corregido y verificado (${attempts} intentos)` 
                : `Corregido pero requiere verificación manual (${attempts} intentos)`,
            });
          }

          results.push({ 
            chapterNumber, 
            success: true,
            verified: verificationPassed,
            attempts,
            tokensUsed: { 
              input: (lastResult as any).inputTokens || 0, 
              output: (lastResult as any).outputTokens || 0 
            }
          });
        } else {
          results.push({ chapterNumber, success: false, error: "Editor failed" });
        }
      }

      const verified = results.filter(r => r.success && r.verified).length;
      const applied = results.filter(r => r.success).length;
      
      res.json({ 
        results, 
        totalCorrected: applied,
        verified,
        needsReview: applied - verified,
        message: `${applied} correcciones aplicadas, ${verified} verificadas automáticamente`
      });
    } catch (error) {
      console.error("Error applying arc corrections:", error);
      res.status(500).json({ error: "Failed to apply arc corrections" });
    }
  });

  // Structural rewrite endpoint - uses Ghostwriter to regenerate chapters with structural instructions
  app.post("/api/series/:id/structural-rewrite", async (req: Request, res: Response) => {
    try {
      const seriesId = parseInt(req.params.id);
      const { projectId, chapterNumbers, structuralInstructions } = req.body;

      if (!projectId || !chapterNumbers?.length || !structuralInstructions) {
        return res.status(400).json({ error: "projectId, chapterNumbers array, and structuralInstructions required" });
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
      const styleGuide = project.styleGuideId ? await storage.getStyleGuide(project.styleGuideId) : null;
      
      const { GhostwriterAgent } = await import("./agents/ghostwriter");
      const ghostwriter = new GhostwriterAgent();
      
      const results: any[] = [];
      
      for (const chapterNumber of chapterNumbers) {
        const chapters = await storage.getChaptersByProject(projectId);
        const chapter = chapters.find((c: any) => c.chapterNumber === chapterNumber);
        
        if (!chapter) {
          results.push({ chapterNumber, success: false, error: "Chapter not found" });
          continue;
        }

        const chapterLabel = chapterNumber === 0 ? "Prólogo" : 
                            chapterNumber === -1 ? "Epílogo" : 
                            `Capítulo ${chapterNumber}`;

        const rewriteData = {
          numero: chapterNumber,
          titulo: chapter.title || chapterLabel,
          cronologia: "Mantener la cronología existente",
          ubicacion: "Mantener las ubicaciones existentes",
          elenco_presente: [],
          objetivo_narrativo: structuralInstructions,
          beats: [
            `REESCRITURA ESTRUCTURAL: ${structuralInstructions}`,
            "Mantener los personajes y sus arcos existentes",
            "Expandir las escenas para MOSTRAR los eventos en lugar de CONTAR",
            "Desarrollar el clímax narrativo con tensión dramática",
            "Asegurar que todos los hitos del arco se cumplan explícitamente"
          ],
          funcion_estructural: "Reescritura para cumplir requisitos estructurales del arco de la serie",
        };

        const guiaEstilo = styleGuide?.content || `
Estilo: Prosa profesional de bestseller internacional
Tono: ${project.tone || "Dramático y envolvente"}
Género: ${project.genre || "Ficción literaria"}

INSTRUCCIONES ESPECIALES DE REESCRITURA:
${structuralInstructions}

CONTENIDO ORIGINAL DEL CAPÍTULO (para referencia y expansión):
${chapter.content?.substring(0, 15000) || "Sin contenido previo"}
`;

        console.log(`[StructuralRewrite] Rewriting ${chapterLabel} with instructions: ${structuralInstructions.substring(0, 100)}...`);

        const result = await ghostwriter.execute({
          chapterNumber,
          chapterData: rewriteData,
          worldBible: worldBible || {},
          guiaEstilo,
          isRewrite: true,
        });

        if ((result as any).result?.prose) {
          const newContent = (result as any).result.prose;
          
          await storage.updateChapter(chapter.id, {
            content: newContent,
            status: "completed",
            wordCount: newContent.split(/\s+/).length,
          });

          results.push({ 
            chapterNumber, 
            success: true,
            wordCount: newContent.split(/\s+/).length,
            tokensUsed: { 
              input: (result as any).inputTokens || 0, 
              output: (result as any).outputTokens || 0 
            }
          });
          
          console.log(`[StructuralRewrite] ${chapterLabel} rewritten successfully`);
        } else {
          results.push({ chapterNumber, success: false, error: "Ghostwriter failed to produce content" });
        }
      }

      const successful = results.filter(r => r.success).length;
      
      res.json({ 
        results, 
        totalRewritten: successful,
        message: `${successful} capítulos reescritos estructuralmente`
      });
    } catch (error) {
      console.error("Error in structural rewrite:", error);
      res.status(500).json({ error: "Failed to perform structural rewrite" });
    }
  });

  // Series Thread Fixer - Analyze and auto-fix thread/milestone issues
  app.post("/api/series/:id/analyze-threads", async (req: Request, res: Response) => {
    try {
      const seriesId = parseInt(req.params.id);
      const { projectId, autoApply } = req.body;

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

      const chaptersWithContent = chapters.filter((c: any) => c.content && c.content.length > 100);
      
      if (chaptersWithContent.length === 0) {
        return res.status(400).json({ error: "No chapters with content to analyze" });
      }

      const { SeriesThreadFixerAgent } = await import("./agents/series-thread-fixer");
      const threadFixer = new SeriesThreadFixerAgent();

      console.log(`[ThreadFixer] Analyzing ${chaptersWithContent.length} chapters for project ${projectId}`);

      const result = await threadFixer.execute({
        projectTitle: project.title,
        seriesTitle: series.title,
        volumeNumber: project.seriesOrder || 1,
        totalVolumes: series.totalPlannedBooks || 10,
        chapters: chaptersWithContent.map((c: any) => ({
          id: c.id,
          chapterNumber: c.chapterNumber,
          title: c.title || "",
          content: c.content || "",
        })),
        milestones,
        plotThreads: threads,
        worldBible: worldBible || {},
      });

      if (!result.result) {
        return res.status(500).json({ error: "Thread analysis failed" });
      }

      // If autoApply is true and recommendation is safe_to_autofix, apply fixes
      let appliedFixes: any[] = [];
      if (autoApply && result.result.autoFixRecommendation === "safe_to_autofix" && result.result.fixes.length > 0) {
        const { CopyEditorAgent } = await import("./agents/copyeditor");
        const copyEditor = new CopyEditorAgent();

        for (const fix of result.result.fixes.filter(f => f.priority === "critical" || f.priority === "important")) {
          const chapter = chaptersWithContent.find((c: any) => c.id === fix.chapterId);
          if (!chapter) continue;

          const correctionPrompt = `
═══════════════════════════════════════════════════════════════════
CORRECCIÓN AUTOMÁTICA DE HILO/HITO NARRATIVO
═══════════════════════════════════════════════════════════════════

TIPO DE CORRECCIÓN: ${fix.fixType}
ELEMENTO: ${fix.threadOrMilestoneName}
PRIORIDAD: ${fix.priority}
PUNTO DE INSERCIÓN: ${fix.insertionPoint}

RAZÓN: ${fix.rationale}

${fix.insertionPoint === "replace" && fix.originalPassage ? `
PASAJE ORIGINAL A REEMPLAZAR:
"${fix.originalPassage}"
` : ""}

TEXTO SUGERIDO A INTEGRAR:
${fix.suggestedRevision}

INSTRUCCIONES:
- Integra el texto sugerido de forma orgánica en el flujo narrativo
- Mantén la voz y estilo del autor
- Si es "replace", sustituye el pasaje original
- Si es "beginning/middle/end", inserta en el punto apropiado
- El resultado debe leerse como prosa fluida, no como un parche

NOTA IMPORTANTE: No extiendas ni modifiques otras partes del capítulo. Solo aplica la corrección indicada.
`;

          try {
            const editResult = await copyEditor.execute({
              chapterNumber: chapter.chapterNumber,
              chapterTitle: chapter.title || `Capítulo ${chapter.chapterNumber}`,
              chapterContent: chapter.content + "\n\n" + correctionPrompt,
              guiaEstilo: `Género: ${project.genre}, Tono: ${project.tone}`,
            });

            if ((editResult as any).result?.texto_final) {
              await storage.updateChapter(chapter.id, {
                content: (editResult as any).result.texto_final,
                status: "completed",
              });

              appliedFixes.push({
                chapterId: fix.chapterId,
                chapterNumber: fix.chapterNumber,
                fixType: fix.fixType,
                threadOrMilestoneName: fix.threadOrMilestoneName,
                success: true,
              });

              console.log(`[ThreadFixer] Applied ${fix.fixType} for "${fix.threadOrMilestoneName}" in chapter ${fix.chapterNumber}`);
            }
          } catch (e) {
            console.error(`[ThreadFixer] Failed to apply fix:`, e);
            appliedFixes.push({
              chapterId: fix.chapterId,
              chapterNumber: fix.chapterNumber,
              fixType: fix.fixType,
              success: false,
              error: String(e),
            });
          }
        }
      }

      res.json({
        analysis: result.result,
        appliedFixes,
        totalFixesApplied: appliedFixes.filter(f => f.success).length,
        tokensUsed: {
          input: (result as any).inputTokens || 0,
          output: (result as any).outputTokens || 0,
        },
      });
    } catch (error) {
      console.error("Error analyzing threads:", error);
      res.status(500).json({ error: "Failed to analyze threads" });
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

  // Export completed project chapters as Markdown
  app.get("/api/projects/:id/export-markdown", async (req: Request, res: Response) => {
    try {
      const projectId = parseInt(req.params.id);
      const project = await storage.getProject(projectId);
      
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }
      
      const chapters = await storage.getChaptersByProject(projectId);
      
      if (chapters.length === 0) {
        return res.status(400).json({ error: "No chapters found in project" });
      }
      
      const sortedChapters = [...chapters].sort((a, b) => {
        const orderA = a.chapterNumber === 0 ? -1000 : a.chapterNumber === -1 ? 1000 : a.chapterNumber === -2 ? 1001 : a.chapterNumber;
        const orderB = b.chapterNumber === 0 ? -1000 : b.chapterNumber === -1 ? 1000 : b.chapterNumber === -2 ? 1001 : b.chapterNumber;
        return orderA - orderB;
      });
      
      // Robust function to clean chapter content for export
      const cleanChapterContent = (content: string): string => {
        let cleaned = content.trim();
        
        // 1. Remove CONTINUITY_STATE blocks and everything after
        const continuityMarker = "---CONTINUITY_STATE---";
        if (cleaned.includes(continuityMarker)) {
          cleaned = cleaned.split(continuityMarker)[0].trim();
        }
        
        // 2. Remove any JSON blocks that might be in the content
        cleaned = cleaned.replace(/\n*```json[\s\S]*?```\n*/g, '\n');
        cleaned = cleaned.replace(/\n*\{[\s\S]*?"characterStates"[\s\S]*?\}\s*$/g, '');
        
        // 3. Remove markdown chapter/section headers at the start
        cleaned = cleaned.replace(/^#+ *(CHAPTER|CAPÍTULO|CAP\.?|Capítulo|Chapter|Prólogo|Prologue|Epílogo|Epilogue|Nota del Autor|Author'?s? Note)[^\n]*\n+/i, '');
        
        // 4. Remove AI context/prompt artifacts that might leak into content
        const promptPatterns = [
          /CONTEXTO DEL MUNDO \(World Bible\):[\s\S]*?(?=\n\n[A-ZÁÉÍÓÚÑ]|\n\n[A-Z])/gi,
          /GUÍA DE ESTILO:[\s\S]*?(?=\n\n[A-ZÁÉÍÓÚÑ]|\n\n[A-Z])/gi,
          /═{10,}[\s\S]*?═{10,}/g,
          /⛔[^\n]*\n/g,
          /⚠️[^\n]*\n/g,
          /ESTADO DE CONTINUIDAD[^\n]*:?[\s\S]*?(?=\n\n[A-ZÁÉÍÓÚÑ]|\n\n[A-Z]|$)/gi,
          /TAREA ACTUAL:[\s\S]*?(?=\n\n[A-ZÁÉÍÓÚÑ]|\n\n[A-Z])/gi,
          /DATOS BÁSICOS:[\s\S]*?(?=\n\n[A-ZÁÉÍÓÚÑ]|\n\n[A-Z])/gi,
          /BEATS NARRATIVOS[\s\S]*?(?=\n\n[A-ZÁÉÍÓÚÑ]|\n\n[A-Z])/gi,
          /INSTRUCCIONES DE REESCRITURA[\s\S]*?(?=\n\n[A-ZÁÉÍÓÚÑ]|\n\n[A-Z])/gi,
        ];
        
        for (const pattern of promptPatterns) {
          cleaned = cleaned.replace(pattern, '');
        }
        
        // 5. Remove lines that look like instruction artifacts
        const lines = cleaned.split('\n');
        const filteredLines = lines.filter(line => {
          const trimmed = line.trim();
          // Skip empty lines check, we keep those
          if (!trimmed) return true;
          // Skip lines that are clearly AI instructions/metadata
          if (trimmed.startsWith('- Cronología:')) return false;
          if (trimmed.startsWith('- Ubicación:')) return false;
          if (trimmed.startsWith('- Elenco:')) return false;
          if (trimmed.match(/^Capítulo \d+ -/i) && lines.indexOf(line) < 5) return false;
          if (trimmed.match(/^CAPÍTULO \d+ -/i) && lines.indexOf(line) < 5) return false;
          return true;
        });
        cleaned = filteredLines.join('\n');
        
        // 6. Clean up excessive whitespace
        cleaned = cleaned.replace(/\n{4,}/g, '\n\n\n');
        
        return cleaned.trim();
      };
      
      const lines: string[] = [];
      lines.push(`# ${project.title}`);
      lines.push("");
      
      for (const chapter of sortedChapters) {
        if (!chapter.content) continue;
        
        let heading: string;
        if (chapter.chapterNumber === 0) {
          heading = `Prólogo${chapter.title ? `: ${chapter.title}` : ''}`;
        } else if (chapter.chapterNumber === -1) {
          heading = `Epílogo${chapter.title ? `: ${chapter.title}` : ''}`;
        } else if (chapter.chapterNumber === -2) {
          heading = `Nota del Autor`;
        } else {
          heading = `Capítulo ${chapter.chapterNumber}${chapter.title ? `: ${chapter.title}` : ''}`;
        }
        
        lines.push(`## ${heading}`);
        lines.push("");
        lines.push(cleanChapterContent(chapter.content));
        lines.push("");
      }
      
      const markdown = lines.join("\n");
      
      res.json({
        projectId,
        title: project.title,
        chapterCount: sortedChapters.filter(c => c.content).length,
        totalWords: sortedChapters.reduce((acc, c) => acc + (c.wordCount || 0), 0),
        markdown,
      });
    } catch (error) {
      console.error("Error exporting project markdown:", error);
      res.status(500).json({ error: "Failed to export project" });
    }
  });

  // Translate a project to another language with SSE progress
  app.get("/api/projects/:id/translate-stream", async (req: Request, res: Response) => {
    const projectId = parseInt(req.params.id);
    const targetLanguage = req.query.targetLanguage as string;
    const sourceLanguage = (req.query.sourceLanguage as string) || "es";
    
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    
    const sendEvent = (event: string, data: any) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    // Keepalive heartbeat every 15 seconds to prevent connection timeout
    const heartbeatInterval = setInterval(() => {
      try {
        res.write(`:heartbeat\n\n`);
      } catch (e) {
        clearInterval(heartbeatInterval);
      }
    }, 15000);

    // Clean up function
    const cleanup = () => {
      clearInterval(heartbeatInterval);
    };

    // Clean up on connection close
    req.on("close", cleanup);

    const project = await storage.getProject(projectId);
    if (!project) {
      sendEvent("error", { error: "Project not found" });
      cleanup();
      res.end();
      return;
    }

    // Create initial translation record in repository
    let translationRecordId: number | null = null;
    try {
      const translation = await storage.createTranslation({
        projectId,
        projectTitle: project.title,
        sourceLanguage,
        targetLanguage,
        status: "translating",
        chaptersTranslated: 0,
        totalWords: 0,
        markdown: "",
        inputTokens: 0,
        outputTokens: 0,
      });
      translationRecordId = translation.id;
      console.log(`[Translation] Initialized repository record ID ${translationRecordId}`);
    } catch (dbError) {
      console.error("Error creating initial translation record:", dbError);
    }
    
    try {
      if (!targetLanguage) {
        sendEvent("error", { error: "targetLanguage is required" });
        cleanup();
        res.end();
        return;
      }
      
      const chapters = await storage.getChaptersByProject(projectId);
      if (chapters.length === 0) {
        sendEvent("error", { error: "No chapters found in project" });
        cleanup();
        res.end();
        return;
      }
      
      const sortedChapters = [...chapters].sort((a, b) => {
        const orderA = a.chapterNumber === 0 ? -1000 : a.chapterNumber === -1 ? 1000 : a.chapterNumber === -2 ? 1001 : a.chapterNumber;
        const orderB = b.chapterNumber === 0 ? -1000 : b.chapterNumber === -1 ? 1000 : b.chapterNumber === -2 ? 1001 : b.chapterNumber;
        return orderA - orderB;
      });
      
      const chaptersWithContent = sortedChapters.filter(c => c.content && c.content.trim().length > 0);
      const totalChapters = chaptersWithContent.length;
      
      sendEvent("start", { 
        projectTitle: project.title,
        totalChapters,
        sourceLanguage,
        targetLanguage
      });
      
      const { TranslatorAgent } = await import("./agents/translator");
      const translator = new TranslatorAgent();
      
      const translatedChapters: Array<{
        chapterNumber: number;
        title: string;
        translatedContent: string;
        notes: string;
      }> = [];
      
      let totalInputTokens = 0;
      let totalOutputTokens = 0;
      let completedCount = 0;
      
      for (const chapter of chaptersWithContent) {
        const chapterLabel = chapter.chapterNumber === 0 ? "Prólogo" :
                            chapter.chapterNumber === -1 ? "Epílogo" :
                            chapter.chapterNumber === -2 ? "Nota del Autor" :
                            `Capítulo ${chapter.chapterNumber}`;
        
        sendEvent("progress", {
          current: completedCount + 1,
          total: totalChapters,
          chapterNumber: chapter.chapterNumber,
          chapterTitle: chapter.title || chapterLabel,
          status: "translating"
        });

        // Update the database record with partial progress so the UI sees it
        if (translationRecordId) {
          try {
            const currentCount = completedCount + 1;
            await storage.updateTranslation(translationRecordId, {
              chaptersTranslated: currentCount,
              status: "translating"
            });
            console.log(`[Translation] Progress updated for record ID ${translationRecordId}: ${currentCount}/${totalChapters}`);
          } catch (err) {
            console.error("[Translation] Progress DB update failed:", err);
          }
        }
        
        console.log(`[Translate] Translating ${chapterLabel}: ${chapter.title}`);
        
        const result = await translator.execute({
          content: chapter.content || "",
          sourceLanguage,
          targetLanguage,
          chapterTitle: chapter.title || undefined,
          chapterNumber: chapter.chapterNumber,
          projectId,
        });
        
        if (result.result) {
          translatedChapters.push({
            chapterNumber: chapter.chapterNumber,
            title: chapter.title || chapterLabel,
            translatedContent: result.result.translated_text,
            notes: result.result.notes,
          });
          completedCount++; // Increment AFTER successful translation
        }
        
        totalInputTokens += (result as any).inputTokens || 0;
        totalOutputTokens += (result as any).outputTokens || 0;
        
        sendEvent("progress", {
          current: completedCount,
          total: totalChapters,
          chapterNumber: chapter.chapterNumber,
          chapterTitle: chapter.title || chapterLabel,
          status: "completed",
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens
        });

        // Update the database record with partial progress so the UI sees it
        if (translationRecordId) {
          try {
            await storage.updateTranslation(translationRecordId, {
              chaptersTranslated: completedCount,
              status: "translating"
            });
            console.log(`[Translation] Progress updated for record ID ${translationRecordId}: ${completedCount}/${totalChapters}`);
          } catch (err) {
            console.error("[Translation] Progress DB update failed:", err);
          }
        }
      }
      
      // Helper function to remove style guide contamination from AI output
      const removeStyleGuideContamination = (content: string): string => {
        let cleaned = content;
        
        // Pattern to match style guide sections (in multiple languages)
        const styleGuidePatterns = [
          // English patterns
          /^#+ *Literary Style Guide[^\n]*\n[\s\S]*?(?=^#+ *(?:CHAPTER|Chapter|Prologue|Epilogue|Author['']?s? Note)\b|\n---\n|$)/gm,
          /^#+ *Writing Guide[^\n]*\n[\s\S]*?(?=^#+ *(?:CHAPTER|Chapter|Prologue|Epilogue|Author['']?s? Note)\b|\n---\n|$)/gm,
          /^#+ *The Master of[^\n]*\n[\s\S]*?(?=^#+ *(?:CHAPTER|Chapter|Prologue|Epilogue|Author['']?s? Note)\b|\n---\n|$)/gm,
          // Spanish patterns
          /^#+ *Guía de Estilo[^\n]*\n[\s\S]*?(?=^#+ *(?:CAPÍTULO|Capítulo|Prólogo|Epílogo|Nota del Autor)\b|\n---\n|$)/gmi,
          /^#+ *Guía de Escritura[^\n]*\n[\s\S]*?(?=^#+ *(?:CAPÍTULO|Capítulo|Prólogo|Epílogo|Nota del Autor)\b|\n---\n|$)/gmi,
          // Checklist patterns (any language)
          /^###+ *Checklist[^\n]*\n[\s\S]*?(?=^#{1,2} *(?:CHAPTER|Chapter|CAPÍTULO|Capítulo|Prologue|Prólogo|Epilogue|Epílogo)\b|\n---\n|$)/gmi,
          // Generic style guide block between --- separators
          /\n---\n[\s\S]*?(?:Style Guide|Guía de Estilo|Writing Guide|Guía de Escritura)[\s\S]*?\n---\n/gi,
        ];
        
        for (const pattern of styleGuidePatterns) {
          cleaned = cleaned.replace(pattern, '');
        }
        
        // Also remove any remaining meta-sections that shouldn't be in narrative
        const metaSectionPatterns = [
          /^#+ *\d+\. *(?:Narrative Architecture|Character Construction|Central Themes|Language and Stylistic|Tone and Atmosphere)[^\n]*\n[\s\S]*?(?=^#+ *(?:CHAPTER|Chapter|CAPÍTULO|Capítulo|Prologue|Prólogo)\b|$)/gmi,
        ];
        
        for (const pattern of metaSectionPatterns) {
          cleaned = cleaned.replace(pattern, '');
        }
        
        return cleaned.trim();
      };

      // Helper function to clean JSON artifacts and extract heading + body from content
      const parseTranslatedContent = (content: string): { heading: string | null; body: string } => {
        let cleaned = content.trim();
        
        // First, check if content is wrapped in markdown code block (```json ... ```)
        const codeBlockMatch = cleaned.match(/^```(?:json)?\s*([\s\S]*?)```\s*$/);
        if (codeBlockMatch) {
          cleaned = codeBlockMatch[1].trim();
        }
        
        // Check if content is a JSON object with translated_text field
        if (cleaned.startsWith('{') && cleaned.includes('"translated_text"')) {
          try {
            const parsed = JSON.parse(cleaned);
            if (parsed.translated_text) {
              cleaned = parsed.translated_text;
            }
          } catch {
            // Not valid JSON, continue with original content
          }
        }
        
        // Remove any style guide contamination from AI output
        cleaned = removeStyleGuideContamination(cleaned);
        
        // Extract the first markdown heading if present (## or # at start)
        const headingMatch = cleaned.match(/^(#{1,2})\s*(.+?)\n+/);
        if (headingMatch) {
          const heading = headingMatch[2].trim();
          const body = cleaned.slice(headingMatch[0].length).trim();
          return { heading, body };
        }
        
        return { heading: null, body: cleaned.trim() };
      };
      
      const lines: string[] = [];
      lines.push(`# ${project.title}`);
      lines.push("");
      
      // Chapter labels by target language (fallback only)
      const chapterLabels: Record<string, { prologue: string; epilogue: string; authorNote: string; chapter: string }> = {
        es: { prologue: "Prólogo", epilogue: "Epílogo", authorNote: "Nota del Autor", chapter: "Capítulo" },
        en: { prologue: "Prologue", epilogue: "Epilogue", authorNote: "Author's Note", chapter: "Chapter" },
        fr: { prologue: "Prologue", epilogue: "Épilogue", authorNote: "Note de l'Auteur", chapter: "Chapitre" },
        de: { prologue: "Prolog", epilogue: "Epilog", authorNote: "Anmerkung des Autors", chapter: "Kapitel" },
        it: { prologue: "Prologo", epilogue: "Epilogo", authorNote: "Nota dell'Autore", chapter: "Capitolo" },
        pt: { prologue: "Prólogo", epilogue: "Epílogo", authorNote: "Nota do Autor", chapter: "Capítulo" },
        ca: { prologue: "Pròleg", epilogue: "Epíleg", authorNote: "Nota de l'Autor", chapter: "Capítol" },
      };
      const labels = chapterLabels[targetLanguage] || chapterLabels.en;
      
      for (const chapter of translatedChapters) {
        const parsed = parseTranslatedContent(chapter.translatedContent);
        
        // Use the translated heading from the AI if available, otherwise generate a fallback
        let heading: string;
        if (parsed.heading) {
          // AI provided a translated heading - use it directly
          heading = parsed.heading;
        } else {
          // Fallback: generate heading from chapter metadata (may be in original language)
          if (chapter.chapterNumber === 0) {
            heading = `${labels.prologue}${chapter.title ? `: ${chapter.title}` : ''}`;
          } else if (chapter.chapterNumber === -1) {
            heading = `${labels.epilogue}${chapter.title ? `: ${chapter.title}` : ''}`;
          } else if (chapter.chapterNumber === -2) {
            heading = labels.authorNote;
          } else {
            heading = `${labels.chapter} ${chapter.chapterNumber}${chapter.title ? `: ${chapter.title}` : ''}`;
          }
        }
        
        lines.push(`## ${heading}`);
        lines.push("");
        lines.push(parsed.body);
        lines.push("");
      }
      
      const markdown = lines.join("\n");
      
      const totalWords = markdown.split(/\s+/).filter(w => w.length > 0).length;
      
      sendEvent("saving", { message: "Guardando traducción..." });
      
      try {
        let savedTranslation;
        if (translationRecordId) {
          // Update the record we created at the start
          savedTranslation = await storage.updateTranslation(translationRecordId, {
            status: "completed",
            chaptersTranslated: translatedChapters.length,
            totalWords,
            markdown,
            inputTokens: totalInputTokens,
            outputTokens: totalOutputTokens,
          });
          console.log(`[Translation] Finalized repository record ID ${translationRecordId}`);
        } else {
          // Fallback: check if one already exists or create new
          const existingTranslation = await storage.findExistingTranslation(projectId, targetLanguage);
          if (existingTranslation) {
            savedTranslation = await storage.updateTranslation(existingTranslation.id, {
              status: "completed",
              chaptersTranslated: translatedChapters.length,
              totalWords,
              markdown,
              inputTokens: (existingTranslation.inputTokens || 0) + totalInputTokens,
              outputTokens: (existingTranslation.outputTokens || 0) + totalOutputTokens,
            });
          } else {
            savedTranslation = await storage.createTranslation({
              projectId,
              projectTitle: project.title,
              sourceLanguage,
              targetLanguage,
              status: "completed",
              chaptersTranslated: translatedChapters.length,
              totalWords,
              markdown,
              inputTokens: totalInputTokens,
              outputTokens: totalOutputTokens,
            });
          }
        }
        
        sendEvent("complete", {
          id: savedTranslation?.id,
          projectId,
          title: project.title,
          sourceLanguage,
          targetLanguage,
          chaptersTranslated: translatedChapters.length,
          totalWords,
          markdown,
          tokensUsed: {
            input: totalInputTokens,
            output: totalOutputTokens,
          },
          updated: !!translationRecordId,
        });
      } catch (saveError) {
        console.error("Error saving translation to DB:", saveError);
        if (translationRecordId) {
          await storage.updateTranslation(translationRecordId, { status: "error" }).catch(() => {});
        }
        sendEvent("complete", {
          id: null,
          projectId,
          title: project.title,
          sourceLanguage,
          targetLanguage,
          chaptersTranslated: translatedChapters.length,
          totalWords,
          markdown,
          tokensUsed: {
            input: totalInputTokens,
            output: totalOutputTokens,
          },
          warning: "Translation completed but could not save to database. Download available.",
        });
      }
      
      cleanup();
      res.end();
    } catch (error) {
      console.error("Error translating project:", error);
      sendEvent("error", { error: "Failed to translate project" });
      cleanup();
      res.end();
    }
  });

  app.get("/api/translations", async (_req: Request, res: Response) => {
    try {
      const allTranslations = await storage.getAllTranslations();
      
      // No automatic cleanup - just return the translations as-is
      // Status should only be set by the actual translation process
      const translationsWithoutMarkdown = allTranslations.map(t => ({
        id: t.id,
        projectId: t.projectId,
        projectTitle: t.projectTitle,
        sourceLanguage: t.sourceLanguage,
        targetLanguage: t.targetLanguage,
        chaptersTranslated: t.chaptersTranslated || 0,
        totalWords: t.totalWords,
        inputTokens: t.inputTokens,
        outputTokens: t.outputTokens,
        status: t.status || "completed",
        createdAt: t.createdAt,
      }));
      res.json(translationsWithoutMarkdown);
    } catch (error) {
      console.error("Error fetching translations:", error);
      res.status(500).json({ error: "Failed to fetch translations" });
    }
  });

  app.get("/api/translations/:id/download", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const translation = await storage.getTranslation(id);
      
      if (!translation) {
        return res.status(404).json({ error: "Translation not found" });
      }
      
      res.json({
        id: translation.id,
        projectTitle: translation.projectTitle,
        targetLanguage: translation.targetLanguage,
        markdown: translation.markdown,
      });
    } catch (error) {
      console.error("Error downloading translation:", error);
      res.status(500).json({ error: "Failed to download translation" });
    }
  });

  app.delete("/api/translations/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteTranslation(id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting translation:", error);
      res.status(500).json({ error: "Failed to delete translation" });
    }
  });

  // AI Usage / Cost Tracking endpoints
  app.get("/api/ai-usage/summary", async (_req: Request, res: Response) => {
    try {
      const summary = await storage.getAiUsageSummary();
      res.json(summary);
    } catch (error) {
      console.error("Error fetching AI usage summary:", error);
      res.status(500).json({ error: "Failed to fetch AI usage summary" });
    }
  });

  app.get("/api/ai-usage/by-agent", async (_req: Request, res: Response) => {
    try {
      const byAgent = await storage.getAiUsageByAgent();
      res.json(byAgent);
    } catch (error) {
      console.error("Error fetching AI usage by agent:", error);
      res.status(500).json({ error: "Failed to fetch AI usage by agent" });
    }
  });

  app.get("/api/ai-usage/by-day", async (_req: Request, res: Response) => {
    try {
      const byDay = await storage.getAiUsageByDay();
      res.json(byDay);
    } catch (error) {
      console.error("Error fetching AI usage by day:", error);
      res.status(500).json({ error: "Failed to fetch AI usage by day" });
    }
  });

  app.get("/api/ai-usage/by-model", async (_req: Request, res: Response) => {
    try {
      const byModel = await storage.getAiUsageByModel();
      res.json(byModel);
    } catch (error) {
      console.error("Error fetching AI usage by model:", error);
      res.status(500).json({ error: "Failed to fetch AI usage by model" });
    }
  });

  app.get("/api/ai-usage/events", async (_req: Request, res: Response) => {
    try {
      const events = await storage.getAllAiUsageEvents();
      res.json(events);
    } catch (error) {
      console.error("Error fetching AI usage events:", error);
      res.status(500).json({ error: "Failed to fetch AI usage events" });
    }
  });

  app.get("/api/ai-usage/projects-summary", async (_req: Request, res: Response) => {
    try {
      const allProjects = await storage.getAllProjects();
      const projectsSummary = allProjects.map(p => ({
        id: p.id,
        title: p.title,
        status: p.status,
        totalInputTokens: p.totalInputTokens || 0,
        totalOutputTokens: p.totalOutputTokens || 0,
        totalThinkingTokens: p.totalThinkingTokens || 0,
        estimatedCostUsd: calculateProjectCost(
          p.totalInputTokens || 0,
          p.totalOutputTokens || 0,
          p.totalThinkingTokens || 0
        ),
        createdAt: p.createdAt,
      }));
      res.json(projectsSummary);
    } catch (error) {
      console.error("Error fetching projects summary:", error);
      res.status(500).json({ error: "Failed to fetch projects summary" });
    }
  });

  app.post("/api/projects/:id/duplicate-chapters/purge", async (req: Request, res: Response) => {
    try {
      const projectId = parseInt(req.params.id);
      const { chapterNumber, generationKey, keepGeneration } = req.body as {
        chapterNumber: number;
        generationKey: string;
        keepGeneration: boolean;
      };

      if (isNaN(projectId) || chapterNumber === undefined || !generationKey) {
        return res.status(400).json({ error: "Missing required parameters: projectId, chapterNumber, generationKey" });
      }

      const project = await storage.getProject(projectId);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      // Prevent purge during active generation
      if (project.status === "generating") {
        return res.status(409).json({ error: "Cannot purge chapters while project is generating" });
      }

      const chapters = await storage.getChaptersByProject(projectId);
      const chaptersWithNumber = chapters.filter(c => c.chapterNumber === chapterNumber);

      if (chaptersWithNumber.length < 2) {
        return res.status(400).json({ error: "No duplicates found for this chapter number" });
      }

      // Group by generation key
      const byGeneration: Record<string, typeof chapters> = {};
      for (const ch of chaptersWithNumber) {
        const createdTime = new Date(ch.createdAt).getTime();
        const genKey = new Date(Math.floor(createdTime / 5000) * 5000).toISOString();
        
        if (!byGeneration[genKey]) {
          byGeneration[genKey] = [];
        }
        byGeneration[genKey].push(ch);
      }

      let chaptersToDelete: number[] = [];
      
      if (keepGeneration) {
        // Delete all EXCEPT this generation
        for (const [genKey, chs] of Object.entries(byGeneration)) {
          if (genKey !== generationKey) {
            chaptersToDelete.push(...chs.map((c: typeof chapters[0]) => c.id));
          }
        }
      } else {
        // Delete only this generation
        const toDelete = byGeneration[generationKey];
        if (toDelete) {
          chaptersToDelete = toDelete.map((c: typeof chapters[0]) => c.id);
        }
      }

      // Safety check: don't delete all chapters for this number
      const remainingCount = chaptersWithNumber.length - chaptersToDelete.length;
      if (remainingCount < 1) {
        return res.status(400).json({ error: "Cannot delete all chapters. At least one must remain." });
      }

      // Delete the chapters
      let deletedCount = 0;
      for (const chapterId of chaptersToDelete) {
        await storage.deleteChapter(chapterId);
        deletedCount++;
      }

      await storage.createActivityLog({
        projectId,
        level: "info",
        message: `Eliminados ${deletedCount} capítulos duplicados del capítulo ${chapterNumber} (generación: ${generationKey})`,
        agentRole: "user",
      });

      console.log(`[DuplicatePurge] Deleted ${deletedCount} duplicate chapters for project ${projectId}, chapter ${chapterNumber}`);

      res.json({
        success: true,
        deletedCount,
        remainingCount,
        message: `Eliminados ${deletedCount} capítulos duplicados`,
      });
    } catch (error) {
      console.error("Error purging duplicate chapters:", error);
      res.status(500).json({ error: "Failed to purge duplicate chapters" });
    }
  });

  // ===============================
  // REEDIT PROJECT ENDPOINTS
  // ===============================
  const activeReeditStreams = new Map<number, Set<Response>>();
  const activeReeditOrchestrators = new Map<number, ReeditOrchestrator>();

  app.get("/api/reedit-projects", async (req: Request, res: Response) => {
    try {
      const projects = await storage.getAllReeditProjects();
      res.json(projects);
    } catch (error) {
      console.error("Error fetching reedit projects:", error);
      res.status(500).json({ error: "Failed to fetch reedit projects" });
    }
  });

  app.get("/api/reedit-projects/:id", async (req: Request, res: Response) => {
    try {
      const projectId = parseInt(req.params.id);
      const project = await storage.getReeditProject(projectId);
      if (!project) {
        return res.status(404).json({ error: "Reedit project not found" });
      }
      res.json(project);
    } catch (error) {
      console.error("Error fetching reedit project:", error);
      res.status(500).json({ error: "Failed to fetch reedit project" });
    }
  });

  app.get("/api/reedit-projects/:id/chapters", async (req: Request, res: Response) => {
    try {
      const projectId = parseInt(req.params.id);
      const chapters = await storage.getReeditChaptersByProject(projectId);
      res.json(chapters);
    } catch (error) {
      console.error("Error fetching reedit chapters:", error);
      res.status(500).json({ error: "Failed to fetch reedit chapters" });
    }
  });

  app.get("/api/reedit-projects/:id/audit-report", async (req: Request, res: Response) => {
    try {
      const projectId = parseInt(req.params.id);
      const reports = await storage.getReeditAuditReportsByProject(projectId);
      if (!reports || reports.length === 0) {
        return res.status(404).json({ error: "Audit report not found" });
      }
      res.json(reports[0]);
    } catch (error) {
      console.error("Error fetching audit report:", error);
      res.status(500).json({ error: "Failed to fetch audit report" });
    }
  });

  app.get("/api/reedit-projects/:id/audit-reports", async (req: Request, res: Response) => {
    try {
      const projectId = parseInt(req.params.id);
      const reports = await storage.getReeditAuditReportsByProject(projectId);
      res.json(reports || []);
    } catch (error) {
      console.error("Error fetching audit reports:", error);
      res.status(500).json({ error: "Failed to fetch audit reports" });
    }
  });

  app.get("/api/reedit-projects/:id/world-bible", async (req: Request, res: Response) => {
    try {
      const projectId = parseInt(req.params.id);
      const worldBible = await storage.getReeditWorldBibleByProject(projectId);
      res.json(worldBible || null);
    } catch (error) {
      console.error("Error fetching world bible:", error);
      res.status(500).json({ error: "Failed to fetch world bible" });
    }
  });

  app.post("/api/reedit-projects", upload.single("manuscript"), async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const { title, language = "es" } = req.body;
      if (!title) {
        return res.status(400).json({ error: "Title is required" });
      }

      const result = await mammoth.extractRawText({ buffer: req.file.buffer });
      const fullText = result.value;

      if (!fullText || fullText.trim().length < 100) {
        return res.status(400).json({ error: "Document is too short or empty" });
      }

      const wordCount = fullText.trim().split(/\s+/).length;
      const project = await storage.createReeditProject({
        title,
        originalFileName: req.file.originalname || "manuscript.docx",
        detectedLanguage: language,
        totalWordCount: wordCount,
      });

      const chapterPattern = /^(Prólogo|Prologue|Prolog|Prologo|Epílogo|Epilogue|Epilog|Epilogo|Nota\s+de(?:l)?\s+Autor(?:a)?|Author'?s?\s+Note|Note\s+de\s+l'Auteur|Nachwort|Nota\s+dell'Autore|Nota\s+de\s+l'Autor|Capítulo\s+\d+|Chapter\s+\d+|Chapitre\s+\d+|Kapitel\s+\d+|Capitolo\s+\d+|Capítol\s+\d+)(?:\s*[:\-–—.]?\s*(.*))?$/gim;
      
      const chapters: { number: number; title: string; content: string }[] = [];
      const lines = fullText.split('\n');
      let currentChapter: { number: number; title: string; lines: string[] } | null = null;
      let chapterIndex = 0;
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        const match = line.match(/^(Prólogo|Prologue|Prolog|Prologo|Epílogo|Epilogue|Epilog|Epilogo|Nota\s+de(?:l)?\s+Autor(?:a)?|Author'?s?\s+Note|Note\s+de\s+l'Auteur|Nachwort|Nota\s+dell'Autore|Nota\s+de\s+l'Autor|Capítulo\s+\d+|Chapter\s+\d+|Chapitre\s+\d+|Kapitel\s+\d+|Capitolo\s+\d+|Capítol\s+\d+)(?:\s*[:\-–—.]?\s*(.*))?$/i);
        
        if (match) {
          if (currentChapter) {
            chapters.push({
              number: currentChapter.number,
              title: currentChapter.title,
              content: currentChapter.lines.join('\n').trim()
            });
          }
          
          const chapterType = match[1].toLowerCase();
          let chapterNum: number;
          
          if (chapterType.includes('prólogo') || chapterType.includes('prologue') || chapterType.includes('prolog') || chapterType.includes('prologo')) {
            chapterNum = 0;
          } else if (chapterType.includes('epílogo') || chapterType.includes('epilogue') || chapterType.includes('epilog') || chapterType.includes('epilogo')) {
            chapterNum = 998;
          } else if (chapterType.includes('nota') || chapterType.includes('note') || chapterType.includes('nachwort')) {
            chapterNum = 999;
          } else {
            const numMatch = match[1].match(/\d+/);
            chapterNum = numMatch ? parseInt(numMatch[0]) : ++chapterIndex;
          }
          
          const subtitle = match[2]?.trim() || '';
          const chapterTitle = subtitle ? `${match[1]}${subtitle ? ': ' + subtitle : ''}` : match[1];
          
          currentChapter = {
            number: chapterNum,
            title: chapterTitle,
            lines: []
          };
        } else if (currentChapter) {
          currentChapter.lines.push(lines[i]);
        }
      }
      
      if (currentChapter && currentChapter.lines.length > 0) {
        chapters.push({
          number: currentChapter.number,
          title: currentChapter.title,
          content: currentChapter.lines.join('\n').trim()
        });
      }
      
      if (chapters.length === 0) {
        await storage.createReeditChapter({
          projectId: project.id,
          chapterNumber: 0,
          title: "Full Manuscript",
          originalContent: fullText,
          status: "pending",
        });
        console.log(`[Reedit] No chapters detected, treating as single manuscript`);
      } else {
        for (const chapter of chapters) {
          await storage.createReeditChapter({
            projectId: project.id,
            chapterNumber: chapter.number,
            title: chapter.title,
            originalContent: chapter.content,
            status: "pending",
          });
        }
        console.log(`[Reedit] Detected ${chapters.length} chapters in manuscript`);
      }

      await storage.updateReeditProject(project.id, { totalChapters: chapters.length || 1 });

      res.json({
        success: true,
        projectId: project.id,
        title: project.title,
        wordCount,
        chaptersDetected: chapters.length || 1,
        message: `Manuscript uploaded successfully. ${chapters.length || 1} chapter(s) detected.`,
      });
    } catch (error) {
      console.error("Error creating reedit project:", error);
      res.status(500).json({ error: "Failed to create reedit project" });
    }
  });

  app.post("/api/reedit-projects/:id/start", async (req: Request, res: Response) => {
    try {
      const projectId = parseInt(req.params.id);
      const project = await storage.getReeditProject(projectId);
      
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      if (project.status === "processing") {
        return res.status(400).json({ error: "Project is already being processed" });
      }

      const orchestrator = new ReeditOrchestrator();
      activeReeditOrchestrators.set(projectId, orchestrator);

      res.json({
        success: true,
        message: "Reedit processing started",
        projectId,
      });

      orchestrator.processProject(projectId).finally(() => {
        activeReeditOrchestrators.delete(projectId);
      });
    } catch (error) {
      console.error("Error starting reedit:", error);
      res.status(500).json({ error: "Failed to start reedit processing" });
    }
  });

  app.get("/api/reedit-projects/:id/stream", (req: Request, res: Response) => {
    const projectId = parseInt(req.params.id);

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    if (!activeReeditStreams.has(projectId)) {
      activeReeditStreams.set(projectId, new Set());
    }
    activeReeditStreams.get(projectId)!.add(res);

    res.write(`data: ${JSON.stringify({ type: "connected", projectId })}\n\n`);

    req.on("close", () => {
      activeReeditStreams.get(projectId)?.delete(res);
      if (activeReeditStreams.get(projectId)?.size === 0) {
        activeReeditStreams.delete(projectId);
      }
    });
  });

  app.post("/api/reedit-projects/:id/resume", async (req: Request, res: Response) => {
    try {
      const projectId = parseInt(req.params.id);
      const project = await storage.getReeditProject(projectId);
      
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      if (activeReeditOrchestrators.has(projectId)) {
        return res.status(400).json({ error: "Project is already being processed" });
      }

      await storage.updateReeditProject(projectId, { 
        status: "processing", 
        errorMessage: null 
      });
      console.log(`[ReeditResume] Cleared error state for project ${projectId}, starting orchestrator...`);

      const orchestrator = new ReeditOrchestrator();
      activeReeditOrchestrators.set(projectId, orchestrator);

      res.json({
        success: true,
        message: "Reedit processing resumed",
        projectId,
      });

      console.log(`[ReeditResume] Calling processProject for project ${projectId}`);
      orchestrator.processProject(projectId).then(() => {
        console.log(`[ReeditResume] processProject completed for project ${projectId}`);
      }).catch((err: any) => {
        console.error(`[ReeditResume] processProject error:`, err);
      }).finally(() => {
        activeReeditOrchestrators.delete(projectId);
      });
    } catch (error) {
      console.error("Error resuming reedit:", error);
      res.status(500).json({ error: "Failed to resume reedit processing" });
    }
  });

  app.post("/api/reedit-projects/:id/rerun-final-review", async (req: Request, res: Response) => {
    try {
      const projectId = parseInt(req.params.id);
      const project = await storage.getReeditProject(projectId);
      
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      if (activeReeditOrchestrators.has(projectId)) {
        return res.status(400).json({ error: "Project is already being processed" });
      }

      const orchestrator = new ReeditOrchestrator();
      activeReeditOrchestrators.set(projectId, orchestrator);

      res.json({
        success: true,
        message: "Re-executing final review with 9+ twice consecutive logic",
        projectId,
      });

      console.log(`[RerunFinalReview] Starting final review only for project ${projectId}`);
      orchestrator.runFinalReviewOnly(projectId).then(() => {
        console.log(`[RerunFinalReview] Completed for project ${projectId}`);
      }).catch((err: any) => {
        console.error(`[RerunFinalReview] Error:`, err);
        storage.updateReeditProject(projectId, {
          status: "error",
          errorMessage: err instanceof Error ? err.message : "Unknown error",
        });
      }).finally(() => {
        activeReeditOrchestrators.delete(projectId);
      });
    } catch (error) {
      console.error("Error rerunning final review:", error);
      res.status(500).json({ error: "Failed to rerun final review" });
    }
  });

  app.post("/api/reedit-projects/:id/cancel", async (req: Request, res: Response) => {
    try {
      const projectId = parseInt(req.params.id);
      
      // Set cancelRequested flag - the orchestrator will check this and gracefully exit
      await storage.updateReeditProject(projectId, { 
        cancelRequested: true,
        errorMessage: "Cancelación solicitada por el usuario" 
      });

      // If there's an active orchestrator, it will pick up the cancellation flag
      // We also remove it from the active map to allow a new resume
      if (activeReeditOrchestrators.has(projectId)) {
        console.log(`[ReeditCancel] Setting cancellation flag for project ${projectId}`);
        activeReeditOrchestrators.delete(projectId);
      }

      res.json({ success: true, message: "Cancelación solicitada. El proceso se detendrá pronto." });
    } catch (error) {
      console.error("Error cancelling reedit:", error);
      res.status(500).json({ error: "Failed to cancel reedit" });
    }
  });

  app.delete("/api/reedit-projects/:id", async (req: Request, res: Response) => {
    try {
      const projectId = parseInt(req.params.id);
      await storage.deleteReeditProject(projectId);
      res.json({ success: true, message: "Reedit project deleted" });
    } catch (error) {
      console.error("Error deleting reedit project:", error);
      res.status(500).json({ error: "Failed to delete reedit project" });
    }
  });

  app.get("/api/reedit-projects/:id/export-md", async (req: Request, res: Response) => {
    try {
      const projectId = parseInt(req.params.id);
      const project = await storage.getReeditProject(projectId);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      const chapters = await storage.getReeditChaptersByProject(projectId);
      if (chapters.length === 0) {
        return res.status(400).json({ error: "No chapters to export" });
      }

      const sortedChapters = [...chapters].sort((a, b) => a.chapterNumber - b.chapterNumber);
      
      let markdown = `# ${project.title}\n\n`;
      
      for (const chapter of sortedChapters) {
        const content = chapter.editedContent || chapter.originalContent;
        if (!content) continue;

        let chapterTitle = chapter.title || `Capítulo ${chapter.chapterNumber}`;
        if (chapter.chapterNumber === 0) {
          chapterTitle = chapter.title || "Prólogo";
        } else if (chapter.chapterNumber === 998) {
          chapterTitle = chapter.title || "Epílogo";
        } else if (chapter.chapterNumber === 999) {
          chapterTitle = chapter.title || "Nota del Autor";
        }

        markdown += `## ${chapterTitle}\n\n`;
        markdown += content.trim() + "\n\n---\n\n";
      }
      
      const safeTitle = project.title.replace(/[^a-zA-Z0-9áéíóúñüÁÉÍÓÚÑÜ\s-]/g, "").trim();
      const filename = `${safeTitle}_editado.md`;

      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(filename)}"`);
      res.setHeader("Content-Type", "text/markdown; charset=utf-8");
      res.send(markdown);
    } catch (error) {
      console.error("Error exporting reedit manuscript as MD:", error);
      res.status(500).json({ error: "Failed to export manuscript" });
    }
  });

  app.get("/api/reedit-projects/:id/export", async (req: Request, res: Response) => {
    try {
      const projectId = parseInt(req.params.id);
      const project = await storage.getReeditProject(projectId);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      const chapters = await storage.getReeditChaptersByProject(projectId);
      if (chapters.length === 0) {
        return res.status(400).json({ error: "No chapters to export" });
      }

      const { Document, Packer, Paragraph, TextRun, HeadingLevel } = await import("docx");

      const docSections: any[] = [];
      
      const sortedChapters = [...chapters].sort((a, b) => a.chapterNumber - b.chapterNumber);
      
      for (const chapter of sortedChapters) {
        const content = chapter.editedContent || chapter.originalContent;
        if (!content) continue;

        let chapterTitle = chapter.title || `Capítulo ${chapter.chapterNumber}`;
        if (chapter.chapterNumber === 0) {
          chapterTitle = chapter.title || "Prólogo";
        } else if (chapter.chapterNumber === 998) {
          chapterTitle = chapter.title || "Epílogo";
        } else if (chapter.chapterNumber === 999) {
          chapterTitle = chapter.title || "Nota del Autor";
        }

        docSections.push(
          new Paragraph({
            text: chapterTitle,
            heading: HeadingLevel.HEADING_1,
            spacing: { before: 400, after: 200 },
          })
        );

        const paragraphs = content.split(/\n\n+/);
        for (const para of paragraphs) {
          if (para.trim()) {
            docSections.push(
              new Paragraph({
                children: [new TextRun({ text: para.trim() })],
                spacing: { after: 200 },
              })
            );
          }
        }
      }

      const doc = new Document({
        sections: [{
          properties: {},
          children: docSections,
        }],
      });

      const buffer = await Packer.toBuffer(doc);
      
      const safeTitle = project.title.replace(/[^a-zA-Z0-9áéíóúñüÁÉÍÓÚÑÜ\s-]/g, "").trim();
      const filename = `${safeTitle}_editado.docx`;

      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(filename)}"`);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.send(buffer);
    } catch (error) {
      console.error("Error exporting reedit manuscript:", error);
      res.status(500).json({ error: "Failed to export manuscript" });
    }
  });

  return httpServer;
}

// Gemini 2.5 Pro pricing (per million tokens)
// Input: $1.25/1M tokens (standard context <=200K)
// Output: $10.00/1M tokens (standard context <=200K)
// Thinking: counted as output tokens
function calculateProjectCost(inputTokens: number, outputTokens: number, thinkingTokens: number): number {
  const INPUT_COST_PER_MILLION = 1.25;
  const OUTPUT_COST_PER_MILLION = 10.00;
  
  const inputCost = (inputTokens / 1_000_000) * INPUT_COST_PER_MILLION;
  const outputCost = ((outputTokens + thinkingTokens) / 1_000_000) * OUTPUT_COST_PER_MILLION;
  
  return Math.round((inputCost + outputCost) * 100) / 100;
}
