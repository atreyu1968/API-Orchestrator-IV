import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { OrchestratorV2 } from "./orchestrator-v2";
import { queueManager } from "./queue-manager";
import { insertProjectSchema, insertPseudonymSchema, insertStyleGuideSchema, insertSeriesSchema, insertReeditProjectSchema } from "@shared/schema";
import multer from "multer";
import mammoth from "mammoth";
import { generateManuscriptDocx } from "./services/docx-exporter";
import { z } from "zod";
import { CopyEditorAgent, cancelProject, ItalianReviewerAgent } from "./agents";
import { getAIProvider, type AIProvider } from "./agents/base-agent";
import { ReeditOrchestrator } from "./orchestrators/reedit-orchestrator";
import { developmentalEditor } from "./orchestrators/developmental-editor";
import { chatService } from "./services/chatService";
import { TranslationOrchestrator } from "./translation-orchestrator";

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
      // Get completed original projects
      const allProjects = await storage.getAllProjects();
      const completedProjects = allProjects.filter(p => p.status === "completed");
      
      const originalProjectsWithStats = await Promise.all(
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
            source: "original" as const,
          };
        })
      );
      
      // Get completed reedit projects
      const allReeditProjects = await storage.getAllReeditProjects();
      const completedReeditProjects = allReeditProjects.filter(p => p.status === "completed");
      
      const reeditProjectsWithStats = await Promise.all(
        completedReeditProjects.map(async (project) => {
          const chapters = await storage.getReeditChaptersByProject(project.id);
          const totalWords = chapters.reduce((acc, c) => acc + (c.wordCount || 0), 0);
          return {
            id: project.id,
            title: project.title,
            genre: null, // Reedit projects don't have genre
            chapterCount: chapters.length,
            totalWords: totalWords || project.totalWordCount || 0,
            finalScore: project.bestsellerScore,
            createdAt: project.createdAt,
            source: "reedit" as const,
          };
        })
      );
      
      // Combine and sort by createdAt descending
      const allCompletedProjects = [...originalProjectsWithStats, ...reeditProjectsWithStats]
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      
      res.json(allCompletedProjects);
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

      const allowedFields = ["title", "premise", "genre", "tone", "chapterCount", "hasPrologue", "hasEpilogue", "hasAuthorNote", "pseudonymId", "styleGuideId", "extendedGuideId", "workType", "seriesId", "seriesOrder", "minWordCount", "minWordsPerChapter", "maxWordsPerChapter", "kindleUnlimitedOptimized", "architectInstructions"];
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

      // All projects now use v2 pipeline
      await storage.updateProject(id, { pipelineVersion: "v2" });
      res.json({ message: "Generation started (v2)", projectId: id });

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

      const orchestrator = new OrchestratorV2({
        onAgentStatus: async (role, status, message) => {
          await storage.updateAgentStatus(id, role, { status, currentTask: message });
          sendToStreams({ type: "agent_status", role, status, message });
          if (message) await persistActivityLog(id, "info", message, role);
        },
        onChapterComplete: async (chapterNumber, wordCount, chapterTitle) => {
          sendToStreams({ type: "chapter_complete", chapterNumber, wordCount, chapterTitle });
          const label = getSectionLabel(chapterNumber, chapterTitle);
          await persistActivityLog(id, "success", `${label} completado (${wordCount} palabras)`, "ghostwriter-v2");
        },
        onSceneComplete: async (chapterNumber, sceneNumber, totalScenes, wordCount) => {
          sendToStreams({ type: "scene_complete", chapterNumber, sceneNumber, totalScenes, wordCount });
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

  // LitAgents 2.0 - Scene-based generation pipeline
  app.post("/api/projects/:id/generate-v2", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const project = await storage.getProject(id);
      
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      if (project.status === "generating") {
        return res.status(400).json({ error: "Project is already generating" });
      }

      // Mark project as using v2 pipeline for auto-recovery
      await storage.updateProject(id, { pipelineVersion: "v2" });

      res.json({ message: "Generation started (LitAgents 2.0)", projectId: id, version: "2.0" });

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

      const orchestrator = new OrchestratorV2({
        onAgentStatus: async (role, status, message) => {
          await storage.updateAgentStatus(id, role, { status, currentTask: message });
          sendToStreams({ type: "agent_status", role, status, message });
          if (message) await persistActivityLog(id, "info", message, role);
        },
        onChapterComplete: async (chapterNumber, wordCount, chapterTitle) => {
          sendToStreams({ type: "chapter_complete", chapterNumber, wordCount, chapterTitle });
          const label = getSectionLabel(chapterNumber, chapterTitle);
          await persistActivityLog(id, "success", `${label} completado (${wordCount} palabras)`, "ghostwriter-v2");
        },
        onSceneComplete: (chapterNumber, sceneNumber, totalScenes, wordCount) => {
          sendToStreams({ type: "scene_complete", chapterNumber, sceneNumber, totalScenes, wordCount });
        },
        onProjectComplete: async () => {
          sendToStreams({ type: "project_complete" });
          await persistActivityLog(id, "success", "Novela completada exitosamente (LitAgents 2.0)", "orchestrator-v2");
        },
        onError: async (error) => {
          sendToStreams({ type: "error", message: error });
          await persistActivityLog(id, "error", error, "orchestrator-v2");
        },
      });

      orchestrator.generateNovel(project).catch(console.error);

    } catch (error) {
      console.error("Error starting V2 generation:", error);
      res.status(500).json({ error: "Failed to start V2 generation" });
    }
  });

  // LitAgents 2.0 - Plot Threads API
  app.get("/api/projects/:id/plot-threads", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const threads = await storage.getPlotThreadsByProject(id);
      res.json(threads);
    } catch (error) {
      console.error("Error fetching plot threads:", error);
      res.status(500).json({ error: "Failed to fetch plot threads" });
    }
  });

  // LitAgents 2.0 - Generate Missing Chapters
  app.post("/api/projects/:id/generate-missing", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const project = await storage.getProject(id);
      
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      if (project.status === "generating") {
        return res.status(400).json({ error: "Project is already generating" });
      }

      // Allow generating missing chapters even for completed projects
      // The orchestrator will detect which chapters are missing
      console.log(`[generate-missing] Starting for project ${id}, current status: ${project.status}`);
      
      res.json({ message: "Generating missing chapters", projectId: id });

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

      const orchestrator = new OrchestratorV2({
        onAgentStatus: async (role, status, message) => {
          await storage.updateAgentStatus(id, role, { status, currentTask: message });
          sendToStreams({ type: "agent_status", role, status, message });
          if (message) await persistActivityLog(id, "info", message, role);
        },
        onChapterComplete: async (chapterNumber, wordCount, chapterTitle) => {
          sendToStreams({ type: "chapter_complete", chapterNumber, wordCount, chapterTitle });
          const label = getSectionLabel(chapterNumber, chapterTitle);
          await persistActivityLog(id, "success", `${label} completado (${wordCount} palabras)`, "ghostwriter-v2");
        },
        onSceneComplete: (chapterNumber, sceneNumber, totalScenes, wordCount) => {
          sendToStreams({ type: "scene_complete", chapterNumber, sceneNumber, totalScenes, wordCount });
        },
        onProjectComplete: async () => {
          sendToStreams({ type: "project_complete" });
          await persistActivityLog(id, "success", "Capítulos faltantes generados exitosamente", "orchestrator-v2");
        },
        onError: async (error) => {
          sendToStreams({ type: "error", message: error });
          await persistActivityLog(id, "error", error, "orchestrator-v2");
        },
      });

      console.log(`[generate-missing] About to call orchestrator.generateMissingChapters for project ${id}`);
      const promise = orchestrator.generateMissingChapters(project);
      console.log(`[generate-missing] Promise created, adding catch handler`);
      promise.catch((err) => {
        console.error("[generate-missing] ERROR in generateMissingChapters:", err);
        persistActivityLog(id, "error", `Error generando capítulos faltantes: ${err.message}`, "orchestrator-v2");
      });
      console.log(`[generate-missing] Catch handler added, returning response`);

    } catch (error) {
      console.error("Error starting missing chapters generation:", error);
      res.status(500).json({ error: "Failed to start missing chapters generation" });
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

      const validStatuses = ["paused", "cancelled", "error", "failed_final_review", "idle", "planning", "awaiting_instructions"];
      if (!validStatuses.includes(project.status)) {
        console.log(`[Resume] Project ${id} has invalid status: ${project.status}`);
        return res.status(400).json({ 
          error: `No se puede reanudar un proyecto con estado "${project.status}". Estados válidos: pausado, cancelado, error, idle, planning, awaiting_instructions.` 
        });
      }

      // Check if World Bible exists - if not, we need to start from scratch
      const worldBible = await storage.getWorldBibleByProject(id);
      const hasWorldBible = !!worldBible;
      console.log(`[Resume] Project ${id} has World Bible: ${hasWorldBible}`);

      console.log(`[Resume] Updating project ${id} status to generating`);
      await storage.updateProject(id, { status: "generating" });

      for (const agentName of ["architect", "ghostwriter", "editor", "copyeditor", "final-reviewer"]) {
        await storage.updateAgentStatus(id, agentName, { status: "idle", currentTask: hasWorldBible ? "Preparando reanudación..." : "Preparando generación desde cero..." });
      }
      console.log(`[Resume] Agent statuses updated for project ${id}`);

      res.json({ message: hasWorldBible ? "Resume started" : "Generation started from scratch", projectId: id, fromScratch: !hasWorldBible });
      console.log(`[Resume] Response sent, starting orchestrator for project ${id} (fromScratch: ${!hasWorldBible})`);

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

      // All projects now use v2 pipeline - upgrade if needed
      if (project.pipelineVersion !== "v2") {
        await storage.updateProject(id, { pipelineVersion: "v2" });
        console.log(`[Resume] Upgraded project ${id} to v2 pipeline`);
      }

      console.log(`[Resume] Resuming project ${id} with OrchestratorV2.generateNovel`);
      const orchestrator = new OrchestratorV2({
        onAgentStatus: async (role, status, message) => {
          await storage.updateAgentStatus(id, role, { status, currentTask: message });
          sendToStreams({ type: "agent_status", role, status, message });
          if (message) await persistActivityLog(id, "info", message, role);
        },
        onChapterComplete: async (chapterNumber, wordCount, chapterTitle) => {
          sendToStreams({ type: "chapter_complete", chapterNumber, wordCount, chapterTitle });
          const label = getSectionLabel(chapterNumber, chapterTitle);
          await persistActivityLog(id, "success", `${label} completado (${wordCount} palabras)`, "ghostwriter-v2");
        },
        onSceneComplete: async (chapterNumber, sceneNumber, totalScenes, wordCount) => {
          sendToStreams({ type: "scene_complete", chapterNumber, sceneNumber, totalScenes, wordCount });
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

      // Allow re-running final review on completed, failed, or 8-score projects
      const allowedStatuses = ["completed", "failed_final_review"];
      if (!allowedStatuses.includes(project.status)) {
        return res.status(400).json({ error: "Solo se puede ejecutar la revisión final en proyectos completados o con revisión fallida" });
      }

      // Reset audit flags to allow full re-analysis
      await storage.updateProject(id, { 
        status: "generating",
        revisionCycle: 0,
        finalReviewResult: null,
        voiceAuditCompleted: false,
        semanticCheckCompleted: false
      } as any);

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

      // Run final review using OrchestratorV2
      const orchestratorV2 = new OrchestratorV2({
        onAgentStatus: (agentName, status, currentTask) => {
          storage.updateAgentStatus(id, agentName, { status, currentTask });
          sendToStreams({ type: "agent_status", agentName, status, currentTask });
        },
        onChapterComplete: (chapterNumber, wordCount, title) => {
          sendToStreams({ type: "chapter_complete", chapterNumber, wordCount, title });
        },
        onSceneComplete: () => {},
        onProjectComplete: () => {
          sendToStreams({ type: "project_complete" });
          persistActivityLog(id, "success", "Revisión final completada", "smart-editor");
        },
        onError: (error) => {
          sendToStreams({ type: "error", error });
          persistActivityLog(id, "error", error, "smart-editor");
        },
      });

      orchestratorV2.runFinalReviewOnly(project);
      
      console.log(`[FinalReview] Started final review for project ${id} (v2 pipeline)`);

    } catch (error) {
      console.error("Error starting final review:", error);
      res.status(500).json({ error: "Failed to start final review" });
    }
  });

  // Extend project - continue generating additional chapters for incomplete projects
  app.post("/api/projects/:id/extend", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const { targetChapters } = req.body;
      
      console.log(`[Extend] Starting extension for project ${id} to ${targetChapters} chapters`);
      
      const project = await storage.getProject(id);
      
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      if (project.status === "generating") {
        return res.status(400).json({ error: "Project is already generating" });
      }

      const existingChapters = await storage.getChaptersByProject(id);
      const regularChapters = existingChapters.filter(c => c.chapterNumber > 0);
      const maxExistingChapter = regularChapters.length > 0 
        ? Math.max(...regularChapters.map(c => c.chapterNumber))
        : 0;

      if (!targetChapters || targetChapters <= maxExistingChapter) {
        return res.status(400).json({ 
          error: `Target chapters (${targetChapters}) must be greater than existing chapters (${maxExistingChapter})` 
        });
      }

      // Update project with new chapter count
      await storage.updateProject(id, { 
        status: "generating",
        chapterCount: targetChapters
      });

      for (const agentName of ["architect", "ghostwriter", "editor", "copyeditor", "final-reviewer"]) {
        await storage.updateAgentStatus(id, agentName, { status: "idle", currentTask: "Preparando extensión..." });
      }

      res.json({ 
        message: "Extension started", 
        projectId: id,
        fromChapter: maxExistingChapter + 1,
        toChapter: targetChapters
      });

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

      // Run extension using OrchestratorV2
      const orchestratorV2 = new OrchestratorV2({
        onAgentStatus: (agentName, status, currentTask) => {
          storage.updateAgentStatus(id, agentName, { status, currentTask });
          sendToStreams({ type: "agent_status", agentName, status, currentTask });
        },
        onChapterComplete: (chapterNumber, wordCount, title) => {
          sendToStreams({ type: "chapter_complete", chapterNumber, wordCount, title });
          persistActivityLog(id, "success", `Capítulo ${chapterNumber} extendido: "${title}" (${wordCount} palabras)`, "ghostwriter-v2");
        },
        onSceneComplete: (chapterNumber, sceneNumber, totalScenes, wordCount) => {
          sendToStreams({ type: "scene_complete", chapterNumber, sceneNumber, totalScenes, wordCount });
        },
        onProjectComplete: () => {
          sendToStreams({ type: "project_complete" });
          persistActivityLog(id, "success", "Extensión completada", "orchestrator-v2");
        },
        onError: (error) => {
          sendToStreams({ type: "error", error });
          persistActivityLog(id, "error", error, "orchestrator-v2");
        },
      });

      orchestratorV2.extendNovel(project, maxExistingChapter, targetChapters);

    } catch (error) {
      console.error("Error extending project:", error);
      res.status(500).json({ error: "Failed to extend project" });
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

      // Run sentinel using OrchestratorV2
      const orchestratorV2 = new OrchestratorV2({
        onAgentStatus: (agentName, status, currentTask) => {
          storage.updateAgentStatus(id, agentName, { status, currentTask });
          sendToStreams({ type: "agent_status", agentName, status, currentTask });
        },
        onChapterComplete: (chapterNumber, wordCount, title) => {
          sendToStreams({ type: "chapter_complete", chapterNumber, wordCount, title });
          persistActivityLog(id, "success", `Capítulo ${chapterNumber} corregido`, "smart-editor");
        },
        onSceneComplete: () => {},
        onProjectComplete: () => {
          sendToStreams({ type: "project_complete" });
          persistActivityLog(id, "success", "Análisis de continuidad completado", "orchestrator-v2");
        },
        onError: (error) => {
          sendToStreams({ type: "error", error });
          persistActivityLog(id, "error", error, "orchestrator-v2");
        },
      });

      orchestratorV2.runContinuitySentinelForce(project);

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

      // Run regeneration using OrchestratorV2
      const orchestratorV2 = new OrchestratorV2({
        onAgentStatus: (agentName, status, currentTask) => {
          storage.updateAgentStatus(id, agentName, { status, currentTask });
          sendToStreams({ type: "agent_status", agentName, status, currentTask });
        },
        onChapterComplete: (chapterNumber, wordCount, title) => {
          sendToStreams({ type: "chapter_complete", chapterNumber, wordCount, title });
          persistActivityLog(id, "success", `Capítulo ${chapterNumber} regenerado (${wordCount} palabras)`, "ghostwriter-v2");
        },
        onSceneComplete: (chapterNumber, sceneNumber, totalScenes, wordCount) => {
          sendToStreams({ type: "scene_complete", chapterNumber, sceneNumber, totalScenes, wordCount });
        },
        onProjectComplete: () => {
          sendToStreams({ type: "project_complete" });
          persistActivityLog(id, "success", "Regeneración de capítulos truncados completada", "orchestrator-v2");
        },
        onError: (error) => {
          sendToStreams({ type: "error", error });
          persistActivityLog(id, "error", error, "orchestrator-v2");
        },
      });

      orchestratorV2.regenerateTruncatedChapters(project, minWordCount);

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

  app.get("/api/projects/:id/ai-usage", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const events = await storage.getAiUsageEventsByProject(id);
      res.json(events);
    } catch (error) {
      console.error("Error fetching AI usage events:", error);
      res.status(500).json({ error: "Failed to fetch AI usage events" });
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

      const updateData: Record<string, any> = {};
      const body = req.body as Record<string, unknown>;
      
      if (body.status !== undefined) updateData.status = body.status;
      if (body.processedChapters !== undefined) updateData.processedChapters = body.processedChapters;
      if (body.totalInputTokens !== undefined) updateData.totalInputTokens = body.totalInputTokens;
      if (body.totalOutputTokens !== undefined) updateData.totalOutputTokens = body.totalOutputTokens;
      if (body.totalThinkingTokens !== undefined) updateData.totalThinkingTokens = body.totalThinkingTokens;
      if (body.seriesId !== undefined) updateData.seriesId = body.seriesId;
      if (body.seriesOrder !== undefined) updateData.seriesOrder = body.seriesOrder;
      if (body.pseudonymId !== undefined) updateData.pseudonymId = body.pseudonymId;
      if (body.totalWordCount !== undefined) updateData.totalWordCount = body.totalWordCount;

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

      const updateData: Record<string, any> = {};
      const body = req.body as Record<string, unknown>;
      
      if (body.editedContent !== undefined) updateData.editedContent = body.editedContent;
      if (body.changesLog !== undefined) updateData.changesLog = body.changesLog;
      if (body.status !== undefined) updateData.status = body.status;

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

  // Endpoint to reset a chapter to pending status for pipeline re-processing
  app.post("/api/projects/:projectId/chapters/:chapterNumber/reset-to-pending", async (req: Request, res: Response) => {
    try {
      const projectId = parseInt(req.params.projectId);
      const chapterNumber = parseInt(req.params.chapterNumber);
      
      const project = await storage.getProject(projectId);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }
      
      const chapters = await storage.getChaptersByProject(projectId);
      const chapter = chapters.find(c => c.chapterNumber === chapterNumber);
      if (!chapter) {
        return res.status(404).json({ error: "Chapter not found" });
      }
      
      // Reset chapter to pending with empty content
      await storage.updateChapter(chapter.id, {
        status: "pending",
        content: "",
        wordCount: 0,
      });
      
      console.log(`[ResetChapter] Chapter ${chapterNumber} of project ${projectId} reset to pending`);
      
      res.json({ 
        success: true,
        message: `Chapter ${chapterNumber} reset to pending`,
        chapterId: chapter.id,
      });
    } catch (error: any) {
      console.error("Error resetting chapter:", error);
      res.status(500).json({ error: error.message || "Failed to reset chapter" });
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

  // Normalize chapter titles and headers for a project
  app.post("/api/projects/:id/normalize-titles", async (req: Request, res: Response) => {
    try {
      const projectId = parseInt(req.params.id);
      const project = await storage.getProject(projectId);
      
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }
      
      const chapters = await storage.getChaptersByProject(projectId);
      const results: { chapterId: number; chapterNumber: number; oldTitle: string; newTitle: string; headerFixed: boolean }[] = [];
      
      // Helper function to normalize title case (first letter uppercase, rest lowercase for each word)
      const toTitleCase = (str: string): string => {
        return str.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
      };
      
      // Helper function to remove duplicate headers and normalize content
      const normalizeContent = (content: string, chapterNumber: number, title: string, language: string = "es"): { normalized: string; headerFixed: boolean } => {
        if (!content || content.trim() === '') return { normalized: content, headerFixed: false };
        
        let normalized = content.trim();
        let headerFixed = false;
        
        // Pattern to match chapter/section headers (supports multiple languages and formats)
        const headerPatterns = [
          /^#+ *(CHAPTER|CAPÍTULO|CAP\.?|Capítulo|Chapter|PRÓLOGO|Prólogo|PROLOGUE|Prologue|EPÍLOGO|Epílogo|EPILOGUE|Epilogue|NOTA DEL AUTOR|Nota del Autor|AUTHOR'?S?\s*NOTE|Author'?s?\s*Note)[^\n]*\n+/gi,
        ];
        
        // Remove ALL duplicate headers at the start (loop until no more found)
        let prevLength = 0;
        while (normalized.length !== prevLength) {
          prevLength = normalized.length;
          for (const pattern of headerPatterns) {
            pattern.lastIndex = 0; // Reset regex state
            const match = normalized.match(pattern);
            if (match) {
              normalized = normalized.replace(pattern, '');
              headerFixed = true;
            }
          }
          normalized = normalized.trim();
        }
        
        // Determine the correct header based on chapter number
        let header = '';
        if (chapterNumber === 0) {
          header = title && title !== 'Prólogo' ? `# Prólogo: ${title}` : '# Prólogo';
        } else if (chapterNumber === -1) {
          header = title && title !== 'Epílogo' ? `# Epílogo: ${title}` : '# Epílogo';
        } else if (chapterNumber === -2) {
          header = title && title !== 'Nota del Autor' ? `# Nota del Autor: ${title}` : '# Nota del Autor';
        } else {
          // Regular chapter - use title from database, ensure title case
          const normalizedTitle = title ? toTitleCase(title.replace(/^Capítulo\s*\d+\s*:?\s*/i, '').trim()) : '';
          if (normalizedTitle && normalizedTitle.toLowerCase() !== `capítulo ${chapterNumber}`.toLowerCase()) {
            header = `# Capítulo ${chapterNumber}: ${normalizedTitle}`;
          } else {
            header = `# Capítulo ${chapterNumber}`;
          }
        }
        
        // Add the normalized header
        normalized = `${header}\n\n${normalized}`;
        
        return { normalized, headerFixed };
      };
      
      // Helper to extract a clean title from content if title is generic
      const extractTitleFromContent = (content: string, chapterNumber: number): string | null => {
        if (!content) return null;
        
        // Look for a header pattern in the content
        const match = content.match(/^#+ *(?:CHAPTER|CAPÍTULO|CAP\.?|Capítulo|Chapter)\s*\d+\s*[:–—-]\s*([^\n]+)/mi);
        if (match && match[1]) {
          const extracted = match[1].trim();
          // Make sure it's not just "Capítulo X" repeated
          if (!extracted.match(/^Capítulo\s*\d+$/i) && extracted.length > 0) {
            return extracted;
          }
        }
        return null;
      };
      
      for (const chapter of chapters) {
        const oldTitle = chapter.title || '';
        let newTitle = oldTitle;
        
        // Check if title is generic (just "Capítulo X" or empty)
        const isGenericTitle = !oldTitle || 
          oldTitle.match(/^Capítulo\s*\d+$/i) || 
          oldTitle === 'Prólogo' || 
          oldTitle === 'Epílogo' ||
          oldTitle === 'Nota del Autor';
        
        // Try to extract a better title from the content if the current title is generic
        if (isGenericTitle && chapter.content) {
          const extractedTitle = extractTitleFromContent(chapter.content, chapter.chapterNumber);
          if (extractedTitle) {
            newTitle = extractedTitle;
          }
        }
        
        // Normalize the title case for non-special chapters
        if (chapter.chapterNumber > 0 && newTitle && !newTitle.match(/^Capítulo\s*\d+$/i)) {
          newTitle = toTitleCase(newTitle);
        }
        
        // Normalize the content headers
        const { normalized, headerFixed } = normalizeContent(
          chapter.content || '', 
          chapter.chapterNumber, 
          newTitle
        );
        
        // Update the chapter if there are changes
        if (oldTitle !== newTitle || headerFixed) {
          await storage.updateChapter(chapter.id, {
            title: newTitle,
            content: normalized,
          });
          
          results.push({
            chapterId: chapter.id,
            chapterNumber: chapter.chapterNumber,
            oldTitle,
            newTitle,
            headerFixed,
          });
        }
      }
      
      res.json({
        success: true,
        projectId,
        projectTitle: project.title,
        chaptersUpdated: results.length,
        totalChapters: chapters.length,
        updates: results,
      });
      
    } catch (error) {
      console.error("Error normalizing chapter titles:", error);
      res.status(500).json({ error: "Failed to normalize chapter titles" });
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

      const updateData: Record<string, any> = {};
      
      if (req.body.title !== undefined) {
        updateData.title = req.body.title;
      }
      if (req.body.description !== undefined) {
        updateData.description = req.body.description;
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
        translations,
        reeditProjects,
        reeditChapters,
        aiUsageEvents,
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
        storage.getAllTranslations(),
        storage.getAllReeditProjects(),
        storage.getAllReeditChapters(),
        storage.getAllAiUsageEvents(),
      ]);

      res.json({
        exportedAt: new Date().toISOString(),
        version: "2.0",
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
          translations,
          reeditProjects,
          reeditChapters,
          aiUsageEvents,
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

      // Helper to remove auto-generated fields before insert
      const prepareForInsert = (item: any, omitFields: string[] = ['id', 'createdAt']) => {
        const result = { ...item };
        for (const field of omitFields) {
          delete result[field];
        }
        return result;
      };
      
      // Fields to omit for different entity types (matches their insertSchema.omit)
      const projectOmitFields = ['id', 'createdAt', 'status', 'currentChapter'];
      const reeditProjectOmitFields = [
        'id', 'createdAt', 'status', 'currentStage', 'processedChapters',
        'currentChapter', 'totalInputTokens', 'totalOutputTokens', 'totalThinkingTokens'
      ];
      const continuitySnapshotOmitFields = ['id', 'createdAt', 'updatedAt'];
      const worldBibleOmitFields = ['id', 'updatedAt'];

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
            const data = prepareForInsert(item, projectOmitFields);
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
            const data = prepareForInsert(item, worldBibleOmitFields);
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

      // Import translations (depends on projects)
      if (importData.translations?.length) {
        for (const item of importData.translations) {
          try {
            const data = prepareForInsert(item);
            if (data.projectId && projectIdMap.has(data.projectId)) {
              data.projectId = projectIdMap.get(data.projectId);
            }
            await storage.createTranslation(data);
            results.imported.translations = (results.imported.translations || 0) + 1;
          } catch (e: any) {
            if (!e.message?.includes('duplicate')) {
              results.errors.push({ table: 'translations', error: e.message });
            }
          }
        }
      }

      // Import reedit projects
      const reeditProjectIdMap = new Map<number, number>();
      if (importData.reeditProjects?.length) {
        for (const item of importData.reeditProjects) {
          try {
            const oldId = item.id;
            const data = prepareForInsert(item, reeditProjectOmitFields);
            const created = await storage.createReeditProject(data);
            reeditProjectIdMap.set(oldId, created.id);
            results.imported.reeditProjects = (results.imported.reeditProjects || 0) + 1;
          } catch (e: any) {
            if (!e.message?.includes('duplicate')) {
              results.errors.push({ table: 'reeditProjects', error: e.message });
            }
          }
        }
      }

      // Import reedit chapters (depends on reedit projects)
      if (importData.reeditChapters?.length) {
        for (const item of importData.reeditChapters) {
          try {
            const data = prepareForInsert(item);
            if (data.projectId && reeditProjectIdMap.has(data.projectId)) {
              data.projectId = reeditProjectIdMap.get(data.projectId);
            }
            await storage.createReeditChapter(data);
            results.imported.reeditChapters = (results.imported.reeditChapters || 0) + 1;
          } catch (e: any) {
            if (!e.message?.includes('duplicate')) {
              results.errors.push({ table: 'reeditChapters', error: e.message });
            }
          }
        }
      }

      // Import AI usage events (depends on projects)
      if (importData.aiUsageEvents?.length) {
        for (const item of importData.aiUsageEvents) {
          try {
            const data = prepareForInsert(item);
            if (data.projectId && projectIdMap.has(data.projectId)) {
              data.projectId = projectIdMap.get(data.projectId);
            }
            await storage.createAiUsageEvent(data);
            results.imported.aiUsageEvents = (results.imported.aiUsageEvents || 0) + 1;
          } catch (e: any) {
            if (!e.message?.includes('duplicate')) {
              results.errors.push({ table: 'aiUsageEvents', error: e.message });
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

      // Check if this is a bookbox project
      const isBookbox = (project as any).workType === "bookbox" && (project as any).bookboxStructure?.books?.length > 0;
      const bookboxStructure = (project as any).bookboxStructure as {
        books: Array<{
          bookNumber: number;
          title: string;
          startChapter: number;
          endChapter: number;
          hasPrologue: boolean;
          hasEpilogue: boolean;
        }>;
      } | null;

      const sortedChapters = [...chapters].sort((a, b) => {
        // Enhanced sorting for bookbox: book prologues/epilogues use special negative numbers
        // Use asymmetric offsets to ensure epilogues always come before next book's prologue
        const getOrder = (num: number) => {
          if (num === 0) return -1000; // Main prologue
          if (num === -1) return 100000; // Main epilogue
          if (num === -2) return 100001; // Author note
          if (isBookbox && num <= -1000 && num > -2000) {
            // Book prologue: -1010, -1020, etc -> place just before their book's chapters
            const bookNum = Math.floor((-num - 1000) / 10);
            const bookStartChapter = bookboxStructure?.books?.find(b => b.bookNumber === bookNum)?.startChapter || 0;
            return bookStartChapter - 0.9; // Use 0.9 offset so prologue comes before chapter 1 of the book
          }
          if (isBookbox && num <= -2000) {
            // Book epilogue: -2010, -2020, etc -> place just after their book's chapters
            const bookNum = Math.floor((-num - 2000) / 10);
            const bookEndChapter = bookboxStructure?.books?.find(b => b.bookNumber === bookNum)?.endChapter || 0;
            return bookEndChapter + 0.1; // Use 0.1 offset so epilogue comes right after last chapter but before next book's prologue
          }
          return num;
        };
        return getOrder(a.chapterNumber) - getOrder(b.chapterNumber);
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

      // Helper to find which book a chapter belongs to
      const findBookForChapter = (chapterNum: number) => {
        if (!isBookbox || !bookboxStructure?.books) return null;
        return bookboxStructure.books.find(b => 
          chapterNum >= b.startChapter && chapterNum <= b.endChapter
        );
      };

      let currentBook: number | null = null;
      
      for (const chapter of sortedChapters) {
        if (!chapter.content) continue;
        
        // For bookbox: add book separator when transitioning to a new book
        if (isBookbox && bookboxStructure?.books) {
          let bookForThisChapter: { bookNumber: number; title: string } | null = null;
          
          // Determine which book this chapter belongs to
          if (chapter.chapterNumber > 0) {
            bookForThisChapter = findBookForChapter(chapter.chapterNumber) || null;
          } else if (chapter.chapterNumber <= -1000 && chapter.chapterNumber > -2000) {
            // Book prologue
            const bookNum = Math.floor((-chapter.chapterNumber - 1000) / 10);
            bookForThisChapter = bookboxStructure.books.find(b => b.bookNumber === bookNum) || null;
          } else if (chapter.chapterNumber <= -2000) {
            // Book epilogue
            const bookNum = Math.floor((-chapter.chapterNumber - 2000) / 10);
            bookForThisChapter = bookboxStructure.books.find(b => b.bookNumber === bookNum) || null;
          }

          if (bookForThisChapter && bookForThisChapter.bookNumber !== currentBook) {
            currentBook = bookForThisChapter.bookNumber;
            lines.push("");
            lines.push("---");
            lines.push("");
            lines.push(`# ${bookForThisChapter.title}`);
            lines.push("");
          }
        }
        
        let heading: string;
        if (chapter.chapterNumber === 0) {
          heading = `Prólogo${chapter.title ? `: ${chapter.title}` : ''}`;
        } else if (chapter.chapterNumber === -1) {
          heading = `Epílogo${chapter.title ? `: ${chapter.title}` : ''}`;
        } else if (chapter.chapterNumber === -2) {
          heading = `Nota del Autor`;
        } else if (chapter.chapterNumber <= -1000 && chapter.chapterNumber > -2000) {
          // Book prologue
          heading = `Prólogo${chapter.title ? `: ${chapter.title}` : ''}`;
        } else if (chapter.chapterNumber <= -2000) {
          // Book epilogue
          heading = `Epílogo${chapter.title ? `: ${chapter.title}` : ''}`;
        } else {
          // For bookbox, use relative chapter number within the book
          if (isBookbox) {
            const book = findBookForChapter(chapter.chapterNumber);
            if (book) {
              const relativeChapter = chapter.chapterNumber - book.startChapter + 1;
              heading = `Capítulo ${relativeChapter}${chapter.title ? `: ${chapter.title}` : ''}`;
            } else {
              heading = `Capítulo ${chapter.chapterNumber}${chapter.title ? `: ${chapter.title}` : ''}`;
            }
          } else {
            heading = `Capítulo ${chapter.chapterNumber}${chapter.title ? `: ${chapter.title}` : ''}`;
          }
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

    // Keepalive heartbeat every 8 seconds to prevent proxy/load balancer timeouts in production
    const heartbeatInterval = setInterval(() => {
      try {
        res.write(`:heartbeat\n\n`);
      } catch (e) {
        console.log(`[Translation] Heartbeat failed, connection likely closed`);
        clearInterval(heartbeatInterval);
      }
    }, 8000);

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
        source: "original",
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
      console.log(`[Translation] Starting translation for project ${projectId}: ${sourceLanguage} -> ${targetLanguage}`);
      
      if (!targetLanguage) {
        sendEvent("error", { error: "targetLanguage is required" });
        cleanup();
        res.end();
        return;
      }
      
      console.log(`[Translation] Fetching chapters for project ${projectId}...`);
      const chapters = await storage.getChaptersByProject(projectId);
      if (chapters.length === 0) {
        sendEvent("error", { error: "No chapters found in project" });
        cleanup();
        res.end();
        return;
      }
      console.log(`[Translation] Found ${chapters.length} chapters`);
      
      const sortedChapters = [...chapters].sort((a, b) => {
        const orderA = a.chapterNumber === 0 ? -1000 : a.chapterNumber === -1 ? 1000 : a.chapterNumber === -2 ? 1001 : a.chapterNumber;
        const orderB = b.chapterNumber === 0 ? -1000 : b.chapterNumber === -1 ? 1000 : b.chapterNumber === -2 ? 1001 : b.chapterNumber;
        return orderA - orderB;
      });
      
      const chaptersWithContent = sortedChapters.filter(c => c.content && c.content.trim().length > 0);
      const totalChapters = chaptersWithContent.length;
      console.log(`[Translation] ${totalChapters} chapters with content ready for translation`);
      
      sendEvent("start", { 
        projectTitle: project.title,
        totalChapters,
        sourceLanguage,
        targetLanguage
      });
      
      // Update heartbeat immediately to mark translation as active
      if (translationRecordId) {
        await storage.updateTranslation(translationRecordId, {
          heartbeatAt: new Date(),
        } as any);
        console.log(`[Translation] Initial heartbeat set for record ${translationRecordId}`);
      }
      
      console.log(`[Translation] Initializing TranslatorAgent...`);
      const { TranslatorAgent } = await import("./agents/translator");
      const translator = new TranslatorAgent();
      console.log(`[Translation] TranslatorAgent initialized, starting translation loop...`);
      
      // Retry helper with exponential backoff for resilient translations
      const translateWithRetry = async (input: any, maxRetries = 3): Promise<any> => {
        let lastError: Error | null = null;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            const result = await translator.execute(input);
            if (result.result && result.result.translated_text && result.result.translated_text.length > 50) {
              return result;
            }
            console.warn(`[Translation] Attempt ${attempt}: Empty or short result, retrying...`);
          } catch (error) {
            lastError = error as Error;
            console.error(`[Translation] Attempt ${attempt} failed:`, error);
          }
          if (attempt < maxRetries) {
            const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
            console.log(`[Translation] Waiting ${delay}ms before retry...`);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
        console.error(`[Translation] All ${maxRetries} attempts failed`);
        return { result: null, error: lastError?.message || "Translation failed after retries" };
      };
      
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
        
        const result = await translateWithRetry({
          content: chapter.content || "",
          sourceLanguage,
          targetLanguage,
          chapterTitle: chapter.title || undefined,
          chapterNumber: chapter.chapterNumber,
          projectId,
        });
        
        if (result.result && result.result.translated_text) {
          translatedChapters.push({
            chapterNumber: chapter.chapterNumber,
            title: chapter.title || chapterLabel,
            translatedContent: result.result.translated_text,
            notes: result.result.notes || "",
          });
          completedCount++;
        } else {
          // Chapter failed after retries - send error event but continue with remaining chapters
          console.error(`[Translate] Chapter ${chapter.chapterNumber} failed permanently, skipping`);
          sendEvent("chapterError", {
            chapterNumber: chapter.chapterNumber,
            chapterTitle: chapter.title || chapterLabel,
            error: result.error || "Translation failed after multiple retries",
          });
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

        // Update the database record with partial progress AND markdown so resume can continue
        if (translationRecordId) {
          try {
            // Save markdown progressively so resume can pick up from where we left off
            const partialMarkdown = translatedChapters.map(tc => tc.translatedContent).join("\n\n---\n\n");
            await storage.updateTranslation(translationRecordId, {
              chaptersTranslated: completedCount,
              markdown: partialMarkdown,
              status: "translating"
            });
            console.log(`[Translation] Progress updated for record ID ${translationRecordId}: ${completedCount}/${totalChapters} chapters, ${partialMarkdown.length} chars of markdown saved`);
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

      // Helper function to normalize chapter headers from AI output
      const normalizeChapterHeader = (header: string, chapterNumber: number, targetLang: string): string => {
        const langLabels: Record<string, { prologue: string; epilogue: string; authorNote: string; chapter: string }> = {
          es: { prologue: "Prólogo", epilogue: "Epílogo", authorNote: "Nota del Autor", chapter: "Capítulo" },
          en: { prologue: "Prologue", epilogue: "Epilogue", authorNote: "Author's Note", chapter: "Chapter" },
          "en-US": { prologue: "Prologue", epilogue: "Epilogue", authorNote: "Author's Note", chapter: "Chapter" },
          "en-GB": { prologue: "Prologue", epilogue: "Epilogue", authorNote: "Author's Note", chapter: "Chapter" },
          fr: { prologue: "Prologue", epilogue: "Épilogue", authorNote: "Note de l'Auteur", chapter: "Chapitre" },
          de: { prologue: "Prolog", epilogue: "Epilog", authorNote: "Anmerkung des Autors", chapter: "Kapitel" },
          it: { prologue: "Prologo", epilogue: "Epilogo", authorNote: "Nota dell'Autore", chapter: "Capitolo" },
          pt: { prologue: "Prólogo", epilogue: "Epílogo", authorNote: "Nota do Autor", chapter: "Capítulo" },
          ca: { prologue: "Pròleg", epilogue: "Epíleg", authorNote: "Nota de l'Autor", chapter: "Capítol" },
        };
        const lbl = langLabels[targetLang] || langLabels.en;
        
        // Patterns to detect and normalize chapter headers (case insensitive)
        // Match: "CHAPTER X:", "Chapter X:", "Capítulo X:", "Chapitre X:", etc.
        const chapterPatterns = [
          /^(CHAPTER|Chapter|CAPÍTULO|Capítulo|CHAPITRE|Chapitre|KAPITEL|Kapitel|CAPITOLO|Capitolo|CAPÍTOL|Capítol)\s*(\d+)\s*[:\-–—]?\s*/i,
        ];
        
        for (const pattern of chapterPatterns) {
          const match = header.match(pattern);
          if (match) {
            const num = parseInt(match[2], 10);
            const rest = header.slice(match[0].length).trim();
            return `${lbl.chapter} ${num}${rest ? `: ${rest}` : ''}`;
          }
        }
        
        // Prologue patterns
        if (/^(PROLOGUE|Prologue|PRÓLOGO|Prólogo|PROLOG|Prolog|PROLOGO|Prologo|PRÒLEG|Pròleg)\s*[:\-–—]?\s*/i.test(header)) {
          const rest = header.replace(/^(PROLOGUE|Prologue|PRÓLOGO|Prólogo|PROLOG|Prolog|PROLOGO|Prologo|PRÒLEG|Pròleg)\s*[:\-–—]?\s*/i, '').trim();
          return rest ? `${lbl.prologue}: ${rest}` : lbl.prologue;
        }
        
        // Epilogue patterns
        if (/^(EPILOGUE|Epilogue|EPÍLOGO|Epílogo|EPILOG|Epilog|EPILOGO|Epilogo|EPÍLEG|Epíleg)\s*[:\-–—]?\s*/i.test(header)) {
          const rest = header.replace(/^(EPILOGUE|Epilogue|EPÍLOGO|Epílogo|EPILOG|Epilog|EPILOGO|Epilogo|EPÍLEG|Epíleg)\s*[:\-–—]?\s*/i, '').trim();
          return rest ? `${lbl.epilogue}: ${rest}` : lbl.epilogue;
        }
        
        // Author's Note patterns
        if (/^(AUTHOR'?S?\s*NOTE|Author'?s?\s*Note|NOTA\s*DEL?\s*AUTOR|Nota\s*del?\s*Autor|NOTE\s*DE\s*L'AUTEUR|Note\s*de\s*l'Auteur|ANMERKUNG\s*DES\s*AUTORS|Anmerkung\s*des\s*Autors|NOTA\s*DELL'?AUTORE|Nota\s*dell'?Autore|NOTA\s*DE\s*L'AUTOR|Nota\s*de\s*l'Autor)\s*[:\-–—]?\s*/i.test(header)) {
          return lbl.authorNote;
        }
        
        // If no pattern matched, return as-is but ensure proper case for leading word
        return header;
      };
      
      // Helper function to clean JSON artifacts and extract heading + body from content
      const parseTranslatedContent = (content: string, chapterNumber: number, targetLang: string): { heading: string | null; body: string } => {
        let cleaned = content.trim();
        
        // First, check if content is wrapped in markdown code block (```json ... ``` or ```markdown ... ```)
        const codeBlockMatch = cleaned.match(/^```(?:json|markdown|md)?\s*([\s\S]*?)```\s*$/);
        if (codeBlockMatch) {
          cleaned = codeBlockMatch[1].trim();
        }
        
        // Also strip any remaining code fences that might be embedded
        cleaned = cleaned.replace(/```(?:json|markdown|md|text)?\n?/g, '').replace(/```\s*$/g, '');
        
        // Check if content is a JSON object with translated_text field
        if (cleaned.startsWith('{') && cleaned.includes('"translated_text"')) {
          try {
            const parsed = JSON.parse(cleaned);
            if (parsed.translated_text) {
              cleaned = parsed.translated_text;
            }
          } catch {
            // Not valid JSON, try regex extraction
            const jsonMatch = cleaned.match(/"translated_text"\s*:\s*"([\s\S]*?)(?:"\s*,\s*"(?:source_|target_|notes)|\s*"\s*})/);
            if (jsonMatch) {
              cleaned = jsonMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
            }
          }
        }
        
        // Remove any style guide contamination from AI output
        cleaned = removeStyleGuideContamination(cleaned);
        
        // Extract the first markdown heading if present (# to #### at start)
        // CRITICAL: Require an actual newline after the heading to avoid consuming all content
        const headingMatch = cleaned.match(/^(#{1,4})\s*(.+?)\n+/);
        let bodyText = cleaned;
        let extractedHeading: string | null = null;
        
        if (headingMatch) {
          const rawHeading = headingMatch[2].trim();
          extractedHeading = normalizeChapterHeader(rawHeading, chapterNumber, targetLang);
          const potentialBody = cleaned.slice(headingMatch[0].length).trim();
          // Only strip the heading if it leaves meaningful content
          if (potentialBody.length > 50) {
            bodyText = potentialBody;
          } else {
            // Heading consumed too much - don't strip it, content is the whole thing
            extractedHeading = null;
          }
        }
        
        // Remove chapter-like headers from the start of body (AI sometimes includes them multiple times)
        // CRITICAL: Require newline at end and verify content remains
        const chapterHeaderPattern = /^#{1,4}\s*(CHAPTER|Chapter|CAPÍTULO|Capítulo|CHAPITRE|Chapitre|KAPITEL|Kapitel|CAPITOLO|Capitolo|CAPÍTOL|Capítol|Prologue|PROLOGUE|Prólogo|PRÓLOGO|Prolog|PROLOG|Prologo|PROLOGO|Pròleg|PRÒLEG|Epilogue|EPILOGUE|Epílogo|EPÍLOGO|Epilog|EPILOG|Epilogo|EPILOGO|Epíleg|EPÍLEG|Author'?s?\s*Note|AUTHOR'?S?\s*NOTE|Nota\s*del?\s*Autor|NOTA\s*DEL?\s*AUTOR|Note\s*de\s*l'Auteur|NOTE\s*DE\s*L'AUTEUR|Anmerkung\s*des\s*Autors|ANMERKUNG\s*DES\s*AUTORS|Nota\s*dell'?Autore|NOTA\s*DELL'?AUTORE|Nota\s*de\s*l'Autor|NOTA\s*DE\s*L'AUTOR)[^\n]*\n+/i;
        
        // Remove up to 3 duplicate headers, but always verify content remains
        for (let i = 0; i < 3; i++) {
          const before = bodyText;
          const afterRemoval = bodyText.replace(chapterHeaderPattern, '');
          // Only remove if it leaves substantial content
          if (afterRemoval.trim().length > 50 && afterRemoval !== before) {
            bodyText = afterRemoval;
          } else {
            break;
          }
        }
        
        // Also remove headers that are just the chapter number (e.g., "## 1: Title\n")
        // Only if it leaves substantial content
        const numericHeaderPattern = /^#{1,4}\s*\d+\s*[:\-–—]?\s*[^\n]*\n+/i;
        const afterNumericRemoval = bodyText.replace(numericHeaderPattern, '');
        if (afterNumericRemoval.trim().length > 50) {
          bodyText = afterNumericRemoval.trim();
        }
        
        // Remove ALL dividers (---, ***, ===) from the content - both at end and in the middle
        // First remove trailing dividers
        bodyText = bodyText.replace(/\n*[-*=]{3,}\s*$/, '').trim();
        // Then remove any dividers in the middle of content (standalone lines of --- or *** or ===)
        bodyText = bodyText.replace(/\n[-*=]{3,}\n/g, '\n\n').trim();
        // Remove dividers at the start too
        bodyText = bodyText.replace(/^[-*=]{3,}\n+/, '').trim();
        
        // Remove any remaining Spanish chapter headers that weren't translated
        // Pattern matches: Capítulo X, Prólogo, Epílogo, Nota del Autor at start of lines
        const spanishHeaderPattern = /^#{1,4}\s*(Capítulo\s*\d+|CAPÍTULO\s*\d+|Prólogo|PRÓLOGO|Epílogo|EPÍLOGO|Nota\s*del\s*Autor|NOTA\s*DEL\s*AUTOR)[^\n]*\n+/gim;
        const afterSpanishRemoval = bodyText.replace(spanishHeaderPattern, '');
        if (afterSpanishRemoval.trim().length > 50) {
          bodyText = afterSpanishRemoval.trim();
        }
        
        return { heading: extractedHeading, body: bodyText };
      };
      
      const lines: string[] = [];
      lines.push(`# ${project.title}`);
      lines.push("");
      
      // Chapter labels by target language (fallback only)
      const chapterLabels: Record<string, { prologue: string; epilogue: string; authorNote: string; chapter: string }> = {
        es: { prologue: "Prólogo", epilogue: "Epílogo", authorNote: "Nota del Autor", chapter: "Capítulo" },
        en: { prologue: "Prologue", epilogue: "Epilogue", authorNote: "Author's Note", chapter: "Chapter" },
        "en-US": { prologue: "Prologue", epilogue: "Epilogue", authorNote: "Author's Note", chapter: "Chapter" },
        "en-GB": { prologue: "Prologue", epilogue: "Epilogue", authorNote: "Author's Note", chapter: "Chapter" },
        fr: { prologue: "Prologue", epilogue: "Épilogue", authorNote: "Note de l'Auteur", chapter: "Chapitre" },
        de: { prologue: "Prolog", epilogue: "Epilog", authorNote: "Anmerkung des Autors", chapter: "Kapitel" },
        it: { prologue: "Prologo", epilogue: "Epilogo", authorNote: "Nota dell'Autore", chapter: "Capitolo" },
        pt: { prologue: "Prólogo", epilogue: "Epílogo", authorNote: "Nota do Autor", chapter: "Capítulo" },
        ca: { prologue: "Pròleg", epilogue: "Epíleg", authorNote: "Nota de l'Autor", chapter: "Capítol" },
      };
      const labels = chapterLabels[targetLanguage] || chapterLabels.en;
      
      for (const chapter of translatedChapters) {
        const parsed = parseTranslatedContent(chapter.translatedContent, chapter.chapterNumber, targetLanguage);
        
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
              source: "original",
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
        heartbeatAt: t.heartbeatAt,
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

  // Resume a stuck translation from where it left off
  app.get("/api/translations/:id/resume", async (req: Request, res: Response) => {
    const translationId = parseInt(req.params.id);
    
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    
    const sendEvent = (event: string, data: any) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const heartbeatInterval = setInterval(() => {
      try {
        res.write(`:heartbeat\n\n`);
      } catch (e) {
        clearInterval(heartbeatInterval);
      }
    }, 15000);

    const cleanup = () => {
      clearInterval(heartbeatInterval);
    };

    req.on("close", cleanup);

    try {
      const existingTranslation = await storage.getTranslation(translationId);
      if (!existingTranslation) {
        sendEvent("error", { error: "Translation not found" });
        cleanup();
        res.end();
        return;
      }

      if (existingTranslation.status === "completed") {
        sendEvent("error", { error: "Translation is already completed" });
        cleanup();
        res.end();
        return;
      }

      // Support both regular projects and reedit projects
      const projectId = existingTranslation.projectId;
      const reeditProjectId = (existingTranslation as any).reeditProjectId;
      
      if (!projectId && !reeditProjectId) {
        sendEvent("error", { error: "No project associated with this translation" });
        cleanup();
        res.end();
        return;
      }

      let project: any = null;
      let chaptersWithContent: any[] = [];
      const isReeditProject = !!reeditProjectId && !projectId;

      if (isReeditProject) {
        // Handle reedit project
        project = await storage.getReeditProject(reeditProjectId);
        if (!project) {
          sendEvent("error", { error: "Original reedit project not found" });
          cleanup();
          res.end();
          return;
        }
        
        const chapters = await storage.getReeditChaptersByProject(reeditProjectId);
        const getReeditChapterSortOrder = (n: number) => n === 0 ? -1000 : n === -1 || n === 998 ? 1000 : n === -2 || n === 999 ? 1001 : n;
        const sortedChapters = [...chapters].sort((a, b) => getReeditChapterSortOrder(a.chapterNumber) - getReeditChapterSortOrder(b.chapterNumber));
        chaptersWithContent = sortedChapters.filter(c => 
          (c.editedContent || c.originalContent)?.trim().length > 0
        );
      } else {
        // Handle regular project
        project = await storage.getProject(projectId!);
        if (!project) {
          sendEvent("error", { error: "Original project not found" });
          cleanup();
          res.end();
          return;
        }

        const chapters = await storage.getChaptersByProject(projectId!);
        const sortedChapters = [...chapters].sort((a, b) => {
          const orderA = a.chapterNumber === 0 ? -1000 : a.chapterNumber === -1 ? 1000 : a.chapterNumber === -2 ? 1001 : a.chapterNumber;
          const orderB = b.chapterNumber === 0 ? -1000 : b.chapterNumber === -1 ? 1000 : b.chapterNumber === -2 ? 1001 : b.chapterNumber;
          return orderA - orderB;
        });
        chaptersWithContent = sortedChapters.filter(c => c.content && c.content.trim().length > 0);
      }

      const sourceLanguage = existingTranslation.sourceLanguage;
      const targetLanguage = existingTranslation.targetLanguage;
      const existingMarkdown = existingTranslation.markdown || "";
      const totalChapters = chaptersWithContent.length;
      
      // Count chapters in persisted markdown by counting "---" delimiters
      // Each chapter is separated by "\n\n---\n\n", so delimiters + 1 = chapters
      // But only if there's actual content
      let markdownChapterCount = 0;
      if (existingMarkdown.trim().length > 0) {
        const delimiterMatches = existingMarkdown.match(/\n\n---\n\n/g);
        markdownChapterCount = delimiterMatches ? delimiterMatches.length + 1 : 1;
      }
      
      // Use the minimum of: database counter vs actual markdown chapters
      // This ensures we don't skip a chapter that failed to persist
      const dbCount = existingTranslation.chaptersTranslated || 0;
      const alreadyTranslated = Math.min(dbCount, markdownChapterCount);
      
      // Skip the first N chapters that were already translated
      const remainingChapters = chaptersWithContent.slice(alreadyTranslated);

      console.log(`[Resume] DB counter: ${dbCount}, Markdown chapters: ${markdownChapterCount}, Using: ${alreadyTranslated}/${totalChapters}, ${remainingChapters.length} remaining`);

      if (remainingChapters.length === 0) {
        await storage.updateTranslation(translationId, { status: "completed" });
        sendEvent("complete", {
          id: translationId,
          projectId: projectId || reeditProjectId,
          title: project.title,
          sourceLanguage,
          targetLanguage,
          chaptersTranslated: alreadyTranslated,
          totalWords: existingTranslation.totalWords,
          markdown: existingMarkdown,
          tokensUsed: {
            input: existingTranslation.inputTokens,
            output: existingTranslation.outputTokens,
          },
          resumed: true,
          message: "All chapters were already translated",
        });
        cleanup();
        res.end();
        return;
      }

      sendEvent("start", {
        projectTitle: project.title,
        totalChapters,
        alreadyTranslated,
        remaining: remainingChapters.length,
        sourceLanguage,
        targetLanguage,
        resumed: true,
      });

      const { TranslatorAgent } = await import("./agents/translator");
      const translator = new TranslatorAgent();

      // Retry helper with exponential backoff for resilient translations
      const translateWithRetry = async (input: any, maxRetries = 3): Promise<any> => {
        let lastError: Error | null = null;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            const result = await translator.execute(input);
            if (result.result && result.result.translated_text && result.result.translated_text.length > 50) {
              return result;
            }
            console.warn(`[Resume] Attempt ${attempt}: Empty or short result, retrying...`);
          } catch (error) {
            lastError = error as Error;
            console.error(`[Resume] Attempt ${attempt} failed:`, error);
          }
          if (attempt < maxRetries) {
            const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
            console.log(`[Resume] Waiting ${delay}ms before retry...`);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
        console.error(`[Resume] All ${maxRetries} attempts failed`);
        return { result: null, error: lastError?.message || "Translation failed after retries" };
      };

      const translatedChapters: Array<{
        chapterNumber: number;
        title: string;
        translatedContent: string;
        notes: string;
      }> = [];

      let totalInputTokens = existingTranslation.inputTokens || 0;
      let totalOutputTokens = existingTranslation.outputTokens || 0;
      let completedCount = alreadyTranslated;

      for (const chapter of remainingChapters) {
        const chapterLabel = chapter.chapterNumber === 0 ? "Prólogo" :
                            chapter.chapterNumber === -1 ? "Epílogo" :
                            chapter.chapterNumber === -2 ? "Nota del Autor" :
                            `Capítulo ${chapter.chapterNumber}`;

        sendEvent("progress", {
          current: completedCount + 1,
          total: totalChapters,
          chapterNumber: chapter.chapterNumber,
          chapterTitle: chapter.title || chapterLabel,
          status: "translating",
          resumed: true,
        });

        await storage.updateTranslation(translationId, {
          chaptersTranslated: completedCount + 1,
          status: "translating",
        });

        console.log(`[Resume] Translating ${chapterLabel}: ${chapter.title}`);

        // Get content based on project type
        const chapterContent = isReeditProject 
          ? ((chapter as any).editedContent || (chapter as any).originalContent || "")
          : (chapter.content || "");

        const result = await translateWithRetry({
          content: chapterContent,
          sourceLanguage,
          targetLanguage,
          chapterTitle: chapter.title || undefined,
          chapterNumber: chapter.chapterNumber,
          projectId: projectId || reeditProjectId,
        });

        if (result.result && result.result.translated_text) {
          translatedChapters.push({
            chapterNumber: chapter.chapterNumber,
            title: chapter.title || chapterLabel,
            translatedContent: result.result.translated_text,
            notes: result.result.notes || "",
          });
          completedCount++;
        } else {
          // Chapter failed after retries - send error event but continue
          console.error(`[Resume] Chapter ${chapter.chapterNumber} failed permanently, skipping`);
          sendEvent("chapterError", {
            chapterNumber: chapter.chapterNumber,
            chapterTitle: chapter.title || chapterLabel,
            error: result.error || "Translation failed after multiple retries",
            resumed: true,
          });
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
          outputTokens: totalOutputTokens,
          resumed: true,
        });

        // Save progress after each chapter
        const newChapterMarkdown = translatedChapters.map(tc => tc.translatedContent).join("\n\n---\n\n");
        const combinedMarkdown = existingMarkdown 
          ? existingMarkdown + "\n\n---\n\n" + newChapterMarkdown 
          : newChapterMarkdown;
        
        await storage.updateTranslation(translationId, {
          chaptersTranslated: completedCount,
          markdown: combinedMarkdown,
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          status: "translating",
        });
      }

      // Final update - mark as completed
      const newChapterMarkdown = translatedChapters.map(tc => tc.translatedContent).join("\n\n---\n\n");
      const finalMarkdown = existingMarkdown 
        ? existingMarkdown + "\n\n---\n\n" + newChapterMarkdown 
        : newChapterMarkdown;
      
      const totalWords = finalMarkdown.split(/\s+/).filter(w => w.length > 0).length;

      await storage.updateTranslation(translationId, {
        status: "completed",
        chaptersTranslated: completedCount,
        totalWords,
        markdown: finalMarkdown,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
      });

      sendEvent("complete", {
        id: translationId,
        projectId: projectId || reeditProjectId,
        title: project.title,
        sourceLanguage,
        targetLanguage,
        chaptersTranslated: completedCount,
        totalWords,
        markdown: finalMarkdown,
        tokensUsed: {
          input: totalInputTokens,
          output: totalOutputTokens,
        },
        resumed: true,
        newChaptersTranslated: translatedChapters.length,
      });

      cleanup();
      res.end();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error("Error resuming translation:", error);
      sendEvent("error", { error: `Error al reanudar traducción: ${errorMessage}` });
      cleanup();
      res.end();
    }
  });

  // LitTranslators 2.0 - Start translation with new orchestrator
  app.post("/api/translations/v2/start", async (req: Request, res: Response) => {
    const { projectId, reeditProjectId, targetLanguage } = req.body;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    const sendEvent = (event: string, data: any) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const heartbeatInterval = setInterval(() => {
      try { res.write(`:heartbeat\n\n`); } catch { clearInterval(heartbeatInterval); }
    }, 15000);

    const cleanup = () => clearInterval(heartbeatInterval);
    req.on("close", cleanup);

    try {
      let project: any = null;
      let chapters: any[] = [];
      let sourceLanguage = "en";
      const isReedit = !!reeditProjectId;

      if (isReedit) {
        project = await storage.getReeditProject(reeditProjectId);
        if (!project) throw new Error("Reedit project not found");
        const reeditChapters = await storage.getReeditChaptersByProject(reeditProjectId);
        chapters = reeditChapters.map(c => ({
          chapterNumber: c.chapterNumber,
          title: c.title,
          content: c.editedContent || c.originalContent || "",
        }));
        sourceLanguage = project.language || "es";
      } else if (projectId) {
        project = await storage.getProject(projectId);
        if (!project) throw new Error("Project not found");
        const projectChapters = await storage.getChaptersByProject(projectId);
        chapters = projectChapters.map(c => ({
          chapterNumber: c.chapterNumber,
          title: c.title,
          content: c.content || "",
        }));
        sourceLanguage = "es";
      } else {
        throw new Error("Either projectId or reeditProjectId is required");
      }

      // Build full text from chapters
      const getSortOrder = (n: number) => n === 0 ? -1000 : n === -1 ? 1000 : n === -2 ? 1001 : n;
      const sortedChapters = [...chapters].sort((a, b) => getSortOrder(a.chapterNumber) - getSortOrder(b.chapterNumber));
      const fullText = sortedChapters.map(c => {
        const label = c.chapterNumber === 0 ? "Prólogo" :
                      c.chapterNumber === -1 ? "Epílogo" :
                      c.chapterNumber === -2 ? "Nota del Autor" :
                      `Capítulo ${c.chapterNumber}`;
        return `# ${c.title || label}\n\n${c.content}`;
      }).join("\n\n---\n\n");

      const totalWords = fullText.split(/\s+/).length;

      // Create translation record
      const translation = await storage.createTranslation({
        projectId: isReedit ? null : projectId,
        reeditProjectId: isReedit ? reeditProjectId : null,
        source: isReedit ? "reedit" : "original",
        projectTitle: project.title,
        sourceLanguage,
        targetLanguage,
        chaptersTranslated: 0,
        totalWords,
        markdown: "",
        status: "analyzing",
      });

      sendEvent("started", { translationId: translation.id, totalWords, totalChunks: 0 });

      const orchestrator = new TranslationOrchestrator({
        onStatusChange: (status, message) => {
          sendEvent("status", { status, message });
        },
        onChunkComplete: (current, total) => {
          sendEvent("progress", { current, total, status: "translating" });
        },
        onStrategyReady: (strategy) => {
          sendEvent("strategy", strategy);
        },
      });

      const result = await orchestrator.startTranslation(
        translation.id,
        fullText,
        sourceLanguage,
        targetLanguage
      );

      sendEvent("complete", {
        translationId: translation.id,
        projectTitle: project.title,
        targetLanguage,
        totalWords,
        layoutScore: await storage.getTranslation(translation.id).then(t => t?.layoutScore || 0),
        naturalnessScore: await storage.getTranslation(translation.id).then(t => t?.naturalnessScore || 0),
        tokens: result.tokens,
      });

      cleanup();
      res.end();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error("Error in LitTranslators 2.0:", error);
      sendEvent("error", { error: msg });
      cleanup();
      res.end();
    }
  });

  // AI Provider configuration endpoints
  app.get("/api/ai-provider", async (_req: Request, res: Response) => {
    try {
      const provider = getAIProvider();
      const hasDeepSeekKey = !!process.env.DEEPSEEK_API_KEY;
      const hasGeminiKey = !!process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
      
      res.json({
        current: provider,
        available: {
          gemini: hasGeminiKey,
          deepseek: hasDeepSeekKey,
        },
        models: {
          gemini: {
            creative: "gemini-3-pro-preview",
            analysis: "gemini-2.5-flash",
            fast: "gemini-2.0-flash",
          },
          deepseek: {
            creative: "deepseek-chat (V3)",
            analysis: "deepseek-reasoner (R1)",
            fast: "deepseek-chat (V3)",
          },
        },
        pricing: {
          gemini: {
            description: "Gemini (Google AI)",
            creative: "$1.25/$10.0/M tokens",
            analysis: "$0.15/$0.60/M tokens",
          },
          deepseek: {
            description: "DeepSeek (más económico)",
            creative: "$0.55/$2.19/M tokens (R1)",
            analysis: "$0.27/$1.10/M tokens (V3)",
          },
        },
      });
    } catch (error) {
      console.error("Error fetching AI provider info:", error);
      res.status(500).json({ error: "Failed to fetch AI provider info" });
    }
  });

  app.post("/api/ai-provider", async (req: Request, res: Response) => {
    try {
      const { provider } = req.body as { provider: AIProvider };
      
      if (provider !== "gemini" && provider !== "deepseek") {
        return res.status(400).json({ error: "Invalid provider. Use 'gemini' or 'deepseek'" });
      }
      
      if (provider === "deepseek" && !process.env.DEEPSEEK_API_KEY) {
        return res.status(400).json({ error: "DeepSeek API key not configured" });
      }
      
      if (provider === "gemini" && !process.env.AI_INTEGRATIONS_GEMINI_API_KEY) {
        return res.status(400).json({ error: "Gemini API key not configured" });
      }
      
      // Set the environment variable (this will persist for this process)
      process.env.AI_PROVIDER = provider;
      
      console.log(`[AI Provider] Switched to ${provider}`);
      
      res.json({
        success: true,
        provider,
        message: `Switched to ${provider}. All new AI requests will use ${provider}.`,
      });
    } catch (error) {
      console.error("Error setting AI provider:", error);
      res.status(500).json({ error: "Failed to set AI provider" });
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

      const { title, language = "es", expandChapters, insertNewChapters, targetMinWordsPerChapter, instructions } = req.body;
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
        expandChapters: expandChapters === "true",
        insertNewChapters: insertNewChapters === "true",
        targetMinWordsPerChapter: parseInt(targetMinWordsPerChapter) || 2000,
        architectInstructions: instructions?.trim() || null,
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

  // Clone a created project to reedit system for automated re-editing
  app.post("/api/projects/:id/clone-to-reedit", async (req: Request, res: Response) => {
    try {
      const projectId = parseInt(req.params.id);
      const { instructions, styleGuideId, pseudonymId } = req.body;
      
      const project = await storage.getProject(projectId);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      const chapters = await storage.getChaptersByProject(projectId);
      if (chapters.length === 0) {
        return res.status(400).json({ error: "Project has no chapters to edit" });
      }

      // Create the reedit project linked to the source project
      const reeditProject = await storage.createReeditProject({
        title: `${project.title} - Re-edición`,
        originalFileName: `Clonado de proyecto #${projectId}`,
        sourceProjectId: projectId,
        detectedLanguage: "es", // Default to Spanish, can be detected later
        totalChapters: chapters.length,
        styleGuideId: styleGuideId || project.styleGuideId,
        pseudonymId: pseudonymId || project.pseudonymId,
      });

      // Clone all chapters to reedit chapters
      for (const chapter of chapters) {
        await storage.createReeditChapter({
          projectId: reeditProject.id,
          chapterNumber: chapter.chapterNumber,
          originalChapterNumber: chapter.chapterNumber,
          title: chapter.title,
          originalContent: chapter.content || "",
          status: "pending",
          wordCount: chapter.wordCount || 0,
        });
      }

      // Store the instructions if provided (for restructuring)
      if (instructions) {
        await storage.updateReeditProject(reeditProject.id, {
          pendingUserInstructions: instructions,
        });
      }

      console.log(`[Reedit] Cloned project ${projectId} -> reedit project ${reeditProject.id} with ${chapters.length} chapters`);

      res.json({
        success: true,
        reeditProjectId: reeditProject.id,
        title: reeditProject.title,
        chaptersCloned: chapters.length,
        message: `Proyecto clonado exitosamente. ${chapters.length} capítulos listos para re-edición.`,
      });
    } catch (error: any) {
      console.error("Error cloning project to reedit:", error);
      res.status(500).json({ error: error.message || "Failed to clone project" });
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

  // LitEditors 3.0: Update reedit project (for setting context, etc.)
  app.patch("/api/reedit-projects/:id", async (req: Request, res: Response) => {
    try {
      const projectId = parseInt(req.params.id);
      const updates = req.body;
      
      const project = await storage.getReeditProject(projectId);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      await storage.updateReeditProject(projectId, updates);
      const updatedProject = await storage.getReeditProject(projectId);
      
      res.json(updatedProject);
    } catch (error: any) {
      console.error("Error updating reedit project:", error);
      res.status(500).json({ error: error.message || "Failed to update project" });
    }
  });

  // LitEditors 3.0: Analyze structure endpoint
  app.post("/api/reedit-projects/:id/analyze-structure", async (req: Request, res: Response) => {
    try {
      const projectId = parseInt(req.params.id);
      
      const project = await storage.getReeditProject(projectId);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      if (project.status === "processing") {
        return res.status(400).json({ error: "Project is already being processed" });
      }

      // Run the analysis pipeline (this may take a while)
      await developmentalEditor.runFullPipeline(projectId);

      const updatedProject = await storage.getReeditProject(projectId);
      
      res.json({
        success: true,
        projectId,
        structuralReport: updatedProject?.structuralReport,
        reconstructionPlan: updatedProject?.reconstructionPlan,
      });
    } catch (error: any) {
      console.error("Error analyzing structure:", error);
      res.status(500).json({ error: error.message || "Failed to analyze structure" });
    }
  });

  // LitEditors 3.0: Approve reconstruction plan
  app.post("/api/reedit-projects/:id/approve-plan", async (req: Request, res: Response) => {
    try {
      const projectId = parseInt(req.params.id);
      const { modifiedPlan } = req.body;

      const project = await storage.getReeditProject(projectId);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      if (project.currentStage !== "plan_ready") {
        return res.status(400).json({ error: "No plan ready for approval" });
      }

      // Allow user to modify the plan before approval
      const updateData: any = { planApproved: true };
      if (modifiedPlan) {
        updateData.reconstructionPlan = modifiedPlan;
      }

      await storage.updateReeditProject(projectId, updateData);

      res.json({
        success: true,
        message: "Plan approved. Ready to execute.",
        projectId,
      });
    } catch (error: any) {
      console.error("Error approving plan:", error);
      res.status(500).json({ error: error.message || "Failed to approve plan" });
    }
  });

  // LitEditors 3.0: Execute approved plan
  app.post("/api/reedit-projects/:id/execute-plan", async (req: Request, res: Response) => {
    try {
      const projectId = parseInt(req.params.id);

      const project = await storage.getReeditProject(projectId);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      if (!project.planApproved) {
        return res.status(400).json({ error: "Plan must be approved before execution" });
      }

      if (project.status === "processing") {
        return res.status(400).json({ error: "Project is already being processed" });
      }

      // Respond immediately with success
      res.json({
        success: true,
        message: "Plan execution started",
        projectId,
      });

      // Execute plan and then continue with regular reedit pipeline in background
      (async () => {
        try {
          await developmentalEditor.executeApprovedPlan(projectId);
          
          // After plan execution, continue with the regular reedit pipeline
          const orchestrator = new ReeditOrchestrator();
          activeReeditOrchestrators.set(projectId, orchestrator);

          orchestrator.processProject(projectId).finally(() => {
            activeReeditOrchestrators.delete(projectId);
          });
        } catch (err: any) {
          console.error("Background plan execution error:", err);
          await storage.updateReeditProject(projectId, {
            status: "error",
            errorMessage: err.message || "Plan execution failed",
          });
        }
      })();

    } catch (error: any) {
      console.error("Error executing plan:", error);
      res.status(500).json({ error: error.message || "Failed to execute plan" });
    }
  });

  // LitEditors 3.0: Get structural report
  app.get("/api/reedit-projects/:id/structural-report", async (req: Request, res: Response) => {
    try {
      const projectId = parseInt(req.params.id);
      const project = await storage.getReeditProject(projectId);
      
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      res.json({
        structuralReport: project.structuralReport,
        reconstructionPlan: project.reconstructionPlan,
        planApproved: project.planApproved,
        settingContext: project.settingContext,
        currentStage: project.currentStage,
      });
    } catch (error: any) {
      console.error("Error getting structural report:", error);
      res.status(500).json({ error: error.message || "Failed to get structural report" });
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
      const { instructions } = req.body || {};
      const project = await storage.getReeditProject(projectId);
      
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      if (activeReeditOrchestrators.has(projectId)) {
        return res.status(400).json({ error: "Project is already being processed" });
      }

      // Save user instructions if provided (for awaiting_instructions status)
      const updateData: any = { 
        status: "processing", 
        errorMessage: null 
      };
      
      if (instructions && typeof instructions === 'string' && instructions.trim()) {
        updateData.pendingUserInstructions = instructions.trim();
        console.log(`[ReeditResume] User provided instructions: "${instructions.substring(0, 100)}..."`);
      }
      
      // If resuming from awaiting_instructions, reset the non-perfect counter
      if (project.status === "awaiting_instructions") {
        updateData.nonPerfectFinalReviews = 0;
        console.log(`[ReeditResume] Resetting non-perfect counter after user instructions`);
      }

      await storage.updateReeditProject(projectId, updateData);
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

  app.post("/api/reedit-projects/:id/apply-corrections", async (req: Request, res: Response) => {
    try {
      const projectId = parseInt(req.params.id);
      const project = await storage.getReeditProject(projectId);
      
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      if (!project.finalReviewResult) {
        return res.status(400).json({ error: "No final review result to apply corrections from" });
      }

      if (activeReeditOrchestrators.has(projectId)) {
        return res.status(400).json({ error: "Project is already being processed" });
      }

      const orchestrator = new ReeditOrchestrator();
      activeReeditOrchestrators.set(projectId, orchestrator);

      res.json({
        success: true,
        message: "Applying corrections based on final reviewer feedback",
        projectId,
      });

      console.log(`[ApplyCorrections] Starting corrections for project ${projectId}`);
      orchestrator.applyReviewerCorrections(projectId).then(() => {
        console.log(`[ApplyCorrections] Completed for project ${projectId}`);
      }).catch((err: any) => {
        console.error(`[ApplyCorrections] Error:`, err);
        storage.updateReeditProject(projectId, {
          status: "error",
          errorMessage: err instanceof Error ? err.message : "Unknown error",
        });
      }).finally(() => {
        activeReeditOrchestrators.delete(projectId);
      });
    } catch (error) {
      console.error("Error applying corrections:", error);
      res.status(500).json({ error: "Failed to apply corrections" });
    }
  });

  // Sync internal chapter headers with their metadata titles
  app.post("/api/reedit-projects/:id/sync-chapter-headers", async (req: Request, res: Response) => {
    try {
      const projectId = parseInt(req.params.id);
      const project = await storage.getReeditProject(projectId);
      
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      const chapters = await storage.getReeditChaptersByProject(projectId);
      let updatedCount = 0;
      
      // Pattern to match chapter headers at the start of content
      const headerPatterns = [
        /^(Capítulo|Capitulo|CAPÍTULO|CAPITULO)\s+(\d+|[IVXLCDM]+)\s*[:|-]?\s*([^\n]*)/im,
        /^(Chapter|CHAPTER)\s+(\d+|[IVXLCDM]+)\s*[:|-]?\s*([^\n]*)/im,
        /^(Chapitre|CHAPITRE)\s+(\d+|[IVXLCDM]+)\s*[:|-]?\s*([^\n]*)/im,
        /^(Capitolo|CAPITOLO)\s+(\d+|[IVXLCDM]+)\s*[:|-]?\s*([^\n]*)/im,
        /^(Kapitel|KAPITEL)\s+(\d+|[IVXLCDM]+)\s*[:|-]?\s*([^\n]*)/im,
        /^(Capítol|Capitol|CAPÍTOL|CAPITOL)\s+(\d+|[IVXLCDM]+)\s*[:|-]?\s*([^\n]*)/im,
      ];
      
      const specialTitles = /^(prólogo|epílogo|preludio|interludio|epilogue|prologue|prelude|interlude)/i;
      
      for (const chapter of chapters) {
        // Skip special sections
        if (chapter.title && specialTitles.test(chapter.title.trim())) {
          continue;
        }
        
        const updates: any = {};
        const targetTitle = chapter.title || `Capítulo ${chapter.chapterNumber}`;
        
        // Update originalContent
        if (chapter.originalContent) {
          for (const pattern of headerPatterns) {
            const match = chapter.originalContent.match(pattern);
            if (match) {
              const updatedContent = chapter.originalContent.replace(pattern, targetTitle);
              if (updatedContent !== chapter.originalContent) {
                updates.originalContent = updatedContent;
                console.log(`[SyncHeaders] Chapter ${chapter.chapterNumber} originalContent: "${match[0].substring(0, 40)}..." -> "${targetTitle}"`);
              }
              break;
            }
          }
        }
        
        // Update editedContent
        if (chapter.editedContent) {
          for (const pattern of headerPatterns) {
            const match = chapter.editedContent.match(pattern);
            if (match) {
              const updatedContent = chapter.editedContent.replace(pattern, targetTitle);
              if (updatedContent !== chapter.editedContent) {
                updates.editedContent = updatedContent;
                console.log(`[SyncHeaders] Chapter ${chapter.chapterNumber} editedContent: "${match[0].substring(0, 40)}..." -> "${targetTitle}"`);
              }
              break;
            }
          }
        }
        
        if (Object.keys(updates).length > 0) {
          await storage.updateReeditChapter(chapter.id, updates);
          updatedCount++;
        }
      }
      
      console.log(`[SyncHeaders] Project ${projectId}: Updated ${updatedCount} chapters`);
      res.json({ 
        success: true, 
        message: `Sincronizados ${updatedCount} capítulos`,
        updatedCount,
        totalChapters: chapters.length
      });
    } catch (error) {
      console.error("Error syncing chapter headers:", error);
      res.status(500).json({ error: "Failed to sync chapter headers" });
    }
  });

  app.post("/api/reedit-projects/:id/cancel", async (req: Request, res: Response) => {
    try {
      const projectId = parseInt(req.params.id);
      const project = await storage.getReeditProject(projectId);
      
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }
      
      console.log(`[ReeditCancel] Cancel requested for project ${projectId}, current status: ${project.status}`);
      
      // Remove from active orchestrators immediately
      const wasActive = activeReeditOrchestrators.has(projectId);
      if (wasActive) {
        activeReeditOrchestrators.delete(projectId);
        console.log(`[ReeditCancel] Removed project ${projectId} from active orchestrators`);
      }
      
      // Set cancelRequested flag AND change status to paused immediately
      // This ensures the UI shows the project is no longer processing
      await storage.updateReeditProject(projectId, { 
        cancelRequested: true,
        status: "awaiting_instructions",
        pauseReason: "Cancelado por el usuario. Puedes reanudar cuando quieras.",
      });

      console.log(`[ReeditCancel] Project ${projectId} cancelled and paused`);
      res.json({ success: true, message: "Proceso cancelado. Puedes reanudar cuando quieras." });
    } catch (error) {
      console.error("Error cancelling reedit:", error);
      res.status(500).json({ error: "Failed to cancel reedit" });
    }
  });

  app.post("/api/reedit-projects/:id/force-unlock", async (req: Request, res: Response) => {
    try {
      const projectId = parseInt(req.params.id);
      const project = await storage.getReeditProject(projectId);
      
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      console.log(`[ForceUnlock] Admin requested force unlock for reedit project ${projectId}`);

      const wasInOrchestrators = activeReeditOrchestrators.has(projectId);
      if (wasInOrchestrators) {
        activeReeditOrchestrators.delete(projectId);
        console.log(`[ForceUnlock] Removed project ${projectId} from active orchestrators`);
      } else {
        console.log(`[ForceUnlock] Project ${projectId} was not in active orchestrators`);
      }

      if (project.status === "processing") {
        await storage.updateReeditProject(projectId, {
          status: "awaiting_instructions",
          pauseReason: "Desbloqueado forzosamente por el administrador",
          cancelRequested: false,
        });
        console.log(`[ForceUnlock] Project ${projectId} status changed to awaiting_instructions`);
      }

      const message = wasInOrchestrators 
        ? `Proyecto ${projectId} desbloqueado. Orquestador activo eliminado.`
        : `Proyecto ${projectId} desbloqueado. Estado actualizado a awaiting_instructions.`;

      res.json({ success: true, message });
    } catch (error) {
      console.error("Error force unlocking reedit project:", error);
      res.status(500).json({ error: "Failed to force unlock project" });
    }
  });

  app.post("/api/reedit-projects/:id/restart", async (req: Request, res: Response) => {
    try {
      const projectId = parseInt(req.params.id);
      const project = await storage.getReeditProject(projectId);
      
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      if (project.status === "processing") {
        return res.status(400).json({ error: "Project is currently being processed" });
      }

      // Get expansion options from request body
      const { expandChapters, insertNewChapters, targetMinWordsPerChapter } = req.body;

      // Reset project state with new expansion options if provided
      await storage.updateReeditProject(projectId, {
        status: "pending",
        currentStage: "uploaded",
        processedChapters: 0,
        currentChapter: 0,
        finalReviewResult: null,
        bestsellerScore: null,
        structureAnalysis: null,
        expansionPlan: null,
        errorMessage: null,
        cancelRequested: false,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalThinkingTokens: 0,
        ...(expandChapters !== undefined && { expandChapters }),
        ...(insertNewChapters !== undefined && { insertNewChapters }),
        ...(targetMinWordsPerChapter !== undefined && { targetMinWordsPerChapter }),
      });
      
      // Delete world bible for this project
      await storage.deleteReeditWorldBible(projectId);

      // Reset chapters: use editedContent as new originalContent (if available)
      const chapters = await storage.getReeditChaptersByProject(projectId);
      for (const chapter of chapters) {
        const newOriginalContent = chapter.editedContent || chapter.originalContent;
        await storage.updateReeditChapter(chapter.id, {
          status: "pending",
          originalContent: newOriginalContent,
          editedContent: null,
        });
      }

      // Delete all audit reports for this project
      const auditTypes = ["editor_review", "architect_analysis", "continuity_sentinel", "voice_rhythm", "semantic_repetition", "anachronism_detector", "final_review"];
      for (const reportType of auditTypes) {
        await storage.deleteReeditAuditReportsByType(projectId, reportType);
      }

      console.log(`[ReeditRestart] Project ${projectId} reset to pending state, using edited content as new base`);
      res.json({ 
        success: true, 
        message: "Proyecto reiniciado con la versión editada como base. Puede iniciar la reedición nuevamente.",
        projectId 
      });
    } catch (error) {
      console.error("Error restarting reedit project:", error);
      res.status(500).json({ error: "Failed to restart reedit project" });
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

  // ===== REEDIT ISSUES API =====
  // Get all issues for a reedit project
  app.get("/api/reedit-projects/:id/issues", async (req: Request, res: Response) => {
    try {
      const projectId = parseInt(req.params.id);
      const { status, chapter } = req.query;
      
      let issues;
      if (status && typeof status === "string") {
        issues = await storage.getReeditIssuesByStatus(projectId, status);
      } else if (chapter && typeof chapter === "string") {
        issues = await storage.getReeditIssuesByChapter(projectId, parseInt(chapter));
      } else {
        issues = await storage.getReeditIssuesByProject(projectId);
      }
      
      res.json(issues);
    } catch (error) {
      console.error("Error fetching reedit issues:", error);
      res.status(500).json({ error: "Failed to fetch issues" });
    }
  });

  // Approve a single issue for correction
  app.post("/api/reedit-issues/:id/approve", async (req: Request, res: Response) => {
    try {
      const issueId = parseInt(req.params.id);
      const updated = await storage.approveReeditIssue(issueId);
      if (!updated) {
        return res.status(404).json({ error: "Issue not found" });
      }
      res.json(updated);
    } catch (error) {
      console.error("Error approving reedit issue:", error);
      res.status(500).json({ error: "Failed to approve issue" });
    }
  });

  // Reject a single issue (skip correction)
  app.post("/api/reedit-issues/:id/reject", async (req: Request, res: Response) => {
    try {
      const issueId = parseInt(req.params.id);
      const { reason } = req.body;
      const updated = await storage.rejectReeditIssue(issueId, reason);
      if (!updated) {
        return res.status(404).json({ error: "Issue not found" });
      }
      res.json(updated);
    } catch (error) {
      console.error("Error rejecting reedit issue:", error);
      res.status(500).json({ error: "Failed to reject issue" });
    }
  });

  // Bulk approve all pending issues for a project
  app.post("/api/reedit-projects/:id/issues/approve-all", async (req: Request, res: Response) => {
    try {
      const projectId = parseInt(req.params.id);
      const pendingIssues = await storage.getReeditIssuesByStatus(projectId, "pending");
      
      for (const issue of pendingIssues) {
        await storage.approveReeditIssue(issue.id);
      }
      
      res.json({ success: true, approved: pendingIssues.length });
    } catch (error) {
      console.error("Error bulk approving issues:", error);
      res.status(500).json({ error: "Failed to bulk approve issues" });
    }
  });

  // Bulk reject all pending issues for a project
  app.post("/api/reedit-projects/:id/issues/reject-all", async (req: Request, res: Response) => {
    try {
      const projectId = parseInt(req.params.id);
      const { reason } = req.body;
      const pendingIssues = await storage.getReeditIssuesByStatus(projectId, "pending");
      
      for (const issue of pendingIssues) {
        await storage.rejectReeditIssue(issue.id, reason || "Bulk rejected by user");
      }
      
      res.json({ success: true, rejected: pendingIssues.length });
    } catch (error) {
      console.error("Error bulk rejecting issues:", error);
      res.status(500).json({ error: "Failed to bulk reject issues" });
    }
  });

  // Get summary of issue counts by status
  app.get("/api/reedit-projects/:id/issues/summary", async (req: Request, res: Response) => {
    try {
      const projectId = parseInt(req.params.id);
      const allIssues = await storage.getReeditIssuesByProject(projectId);
      
      const summary = {
        total: allIssues.length,
        pending: allIssues.filter(i => i.status === "pending").length,
        approved: allIssues.filter(i => i.status === "approved").length,
        rejected: allIssues.filter(i => i.status === "rejected").length,
        resolved: allIssues.filter(i => i.status === "resolved").length,
        bySeverity: {
          critical: allIssues.filter(i => i.severity === "critical").length,
          major: allIssues.filter(i => i.severity === "major").length,
          minor: allIssues.filter(i => i.severity === "minor").length,
          suggestion: allIssues.filter(i => i.severity === "suggestion").length,
        },
        byCategory: {} as Record<string, number>
      };
      
      // Count by category
      for (const issue of allIssues) {
        const cat = issue.category || "unknown";
        summary.byCategory[cat] = (summary.byCategory[cat] || 0) + 1;
      }
      
      res.json(summary);
    } catch (error) {
      console.error("Error fetching issue summary:", error);
      res.status(500).json({ error: "Failed to fetch issue summary" });
    }
  });

  // Proceed with corrections after user has approved issues
  app.post("/api/reedit-projects/:id/proceed-corrections", async (req: Request, res: Response) => {
    try {
      const projectId = parseInt(req.params.id);
      const project = await storage.getReeditProject(projectId);
      
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }
      
      if (project.status !== "awaiting_issue_approval") {
        return res.status(400).json({ 
          error: "Project is not awaiting issue approval",
          currentStatus: project.status 
        });
      }
      
      // Check that user has made decisions on all pending issues
      const pendingIssues = await storage.getReeditIssuesByStatus(projectId, "pending");
      if (pendingIssues.length > 0) {
        return res.status(400).json({
          error: "There are still pending issues that need approval or rejection",
          pendingCount: pendingIssues.length
        });
      }
      
      // Check how many issues were approved for correction
      const approvedIssues = await storage.getReeditIssuesByStatus(projectId, "approved");
      
      // Check if already being processed
      if (activeReeditOrchestrators.has(projectId)) {
        return res.status(400).json({ error: "Project is already being processed" });
      }
      
      // Handle case where all issues were rejected (0 approved)
      // In this case, mark project as completed since user chose to skip all corrections
      if (approvedIssues.length === 0) {
        await storage.updateReeditProject(projectId, {
          status: "completed",
          pauseReason: null,
          errorMessage: null,
        });
        
        return res.json({ 
          success: true, 
          message: "No corrections approved. Project marked as completed.",
          approvedCount: 0
        });
      }
      
      // Update project status to resume processing
      await storage.updateReeditProject(projectId, {
        status: "processing",
        pauseReason: null,
      });
      
      // Create orchestrator and resume processing
      const orchestrator = new ReeditOrchestrator();
      activeReeditOrchestrators.set(projectId, orchestrator);
      
      res.json({ 
        success: true, 
        message: `Proceeding with ${approvedIssues.length} approved corrections`,
        approvedCount: approvedIssues.length
      });
      
      console.log(`[ProceedCorrections] Resuming final review for project ${projectId} with ${approvedIssues.length} approved issues`);
      orchestrator.runFinalReviewOnly(projectId).then(() => {
        console.log(`[ProceedCorrections] Completed for project ${projectId}`);
      }).catch((err: any) => {
        console.error(`[ProceedCorrections] Error:`, err);
        storage.updateReeditProject(projectId, {
          status: "error",
          errorMessage: err instanceof Error ? err.message : "Unknown error",
        });
      }).finally(() => {
        activeReeditOrchestrators.delete(projectId);
      });
    } catch (error) {
      console.error("Error proceeding with corrections:", error);
      res.status(500).json({ error: "Failed to proceed with corrections" });
    }
  });

  // Export reedit project as JSON (for frontend compatibility with original projects)
  app.get("/api/reedit-projects/:id/export-markdown", async (req: Request, res: Response) => {
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

      const getReeditChapterSortOrder = (n: number) => n === 0 ? -1000 : n === -1 || n === 998 ? 1000 : n === -2 || n === 999 ? 1001 : n;
      const sortedChapters = [...chapters].sort((a, b) => getReeditChapterSortOrder(a.chapterNumber) - getReeditChapterSortOrder(b.chapterNumber));
      
      // Localized chapter labels based on detected language
      const exportLabels: Record<string, { prologue: string; epilogue: string; authorNote: string; chapter: string }> = {
        es: { prologue: "Prólogo", epilogue: "Epílogo", authorNote: "Nota del Autor", chapter: "Capítulo" },
        en: { prologue: "Prologue", epilogue: "Epilogue", authorNote: "Author's Note", chapter: "Chapter" },
        fr: { prologue: "Prologue", epilogue: "Épilogue", authorNote: "Note de l'Auteur", chapter: "Chapitre" },
        de: { prologue: "Prolog", epilogue: "Epilog", authorNote: "Anmerkung des Autors", chapter: "Kapitel" },
        it: { prologue: "Prologo", epilogue: "Epilogo", authorNote: "Nota dell'Autore", chapter: "Capitolo" },
        pt: { prologue: "Prólogo", epilogue: "Epílogo", authorNote: "Nota do Autor", chapter: "Capítulo" },
        ca: { prologue: "Pròleg", epilogue: "Epíleg", authorNote: "Nota de l'Autor", chapter: "Capítol" },
      };
      const labels = exportLabels[project.detectedLanguage || 'es'] || exportLabels.es;
      
      let markdown = `# ${project.title}\n\n`;
      let totalWords = 0;
      
      // Filter chapters with content first to know which is last
      const chaptersWithContent = sortedChapters.filter(c => c.editedContent || c.originalContent);
      
      for (let i = 0; i < chaptersWithContent.length; i++) {
        const chapter = chaptersWithContent[i];
        const content = chapter.editedContent || chapter.originalContent;
        if (!content) continue;
        
        const isLastChapter = i === chaptersWithContent.length - 1;

        let chapterTitle = chapter.title || `${labels.chapter} ${chapter.chapterNumber}`;
        if (chapter.chapterNumber === 0) {
          chapterTitle = chapter.title || labels.prologue;
        } else if (chapter.chapterNumber === -1 || chapter.chapterNumber === 998) {
          chapterTitle = chapter.title || labels.epilogue;
        } else if (chapter.chapterNumber === -2 || chapter.chapterNumber === 999) {
          chapterTitle = chapter.title || labels.authorNote;
        }

        markdown += `## ${chapterTitle}\n\n`;
        markdown += content.trim() + "\n\n";
        // Only add divider between chapters, not after the last one
        if (!isLastChapter) {
          markdown += "---\n\n";
        }
        totalWords += content.split(/\s+/).filter((w: string) => w.length > 0).length;
      }
      
      res.json({
        projectId,
        title: project.title,
        chapterCount: chaptersWithContent.length,
        totalWords,
        markdown,
      });
    } catch (error) {
      console.error("Error exporting reedit manuscript as markdown JSON:", error);
      res.status(500).json({ error: "Failed to export manuscript" });
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

      const getReeditChapterSortOrder2 = (n: number) => n === 0 ? -1000 : n === -1 || n === 998 ? 1000 : n === -2 || n === 999 ? 1001 : n;
      const sortedChapters = [...chapters].sort((a, b) => getReeditChapterSortOrder2(a.chapterNumber) - getReeditChapterSortOrder2(b.chapterNumber));
      
      // Localized chapter labels based on detected language
      const exportLabels: Record<string, { prologue: string; epilogue: string; authorNote: string; chapter: string }> = {
        es: { prologue: "Prólogo", epilogue: "Epílogo", authorNote: "Nota del Autor", chapter: "Capítulo" },
        en: { prologue: "Prologue", epilogue: "Epilogue", authorNote: "Author's Note", chapter: "Chapter" },
        fr: { prologue: "Prologue", epilogue: "Épilogue", authorNote: "Note de l'Auteur", chapter: "Chapitre" },
        de: { prologue: "Prolog", epilogue: "Epilog", authorNote: "Anmerkung des Autors", chapter: "Kapitel" },
        it: { prologue: "Prologo", epilogue: "Epilogo", authorNote: "Nota dell'Autore", chapter: "Capitolo" },
        pt: { prologue: "Prólogo", epilogue: "Epílogo", authorNote: "Nota do Autor", chapter: "Capítulo" },
        ca: { prologue: "Pròleg", epilogue: "Epíleg", authorNote: "Nota de l'Autor", chapter: "Capítol" },
      };
      const labels = exportLabels[project.detectedLanguage || 'es'] || exportLabels.es;
      
      // Filter chapters with content first to know which is last
      const chaptersWithContent = sortedChapters.filter(c => c.editedContent || c.originalContent);
      
      let markdown = `# ${project.title}\n\n`;
      
      for (let i = 0; i < chaptersWithContent.length; i++) {
        const chapter = chaptersWithContent[i];
        const content = chapter.editedContent || chapter.originalContent;
        if (!content) continue;
        
        const isLastChapter = i === chaptersWithContent.length - 1;

        let chapterTitle = chapter.title || `${labels.chapter} ${chapter.chapterNumber}`;
        if (chapter.chapterNumber === 0) {
          chapterTitle = chapter.title || labels.prologue;
        } else if (chapter.chapterNumber === -1 || chapter.chapterNumber === 998) {
          chapterTitle = chapter.title || labels.epilogue;
        } else if (chapter.chapterNumber === -2 || chapter.chapterNumber === 999) {
          chapterTitle = chapter.title || labels.authorNote;
        }

        markdown += `## ${chapterTitle}\n\n`;
        markdown += content.trim() + "\n\n";
        // Only add divider between chapters, not after the last one
        if (!isLastChapter) {
          markdown += "---\n\n";
        }
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

      // Localized chapter labels based on detected language
      const exportLabels: Record<string, { prologue: string; epilogue: string; authorNote: string; chapter: string }> = {
        es: { prologue: "Prólogo", epilogue: "Epílogo", authorNote: "Nota del Autor", chapter: "Capítulo" },
        en: { prologue: "Prologue", epilogue: "Epilogue", authorNote: "Author's Note", chapter: "Chapter" },
        fr: { prologue: "Prologue", epilogue: "Épilogue", authorNote: "Note de l'Auteur", chapter: "Chapitre" },
        de: { prologue: "Prolog", epilogue: "Epilog", authorNote: "Anmerkung des Autors", chapter: "Kapitel" },
        it: { prologue: "Prologo", epilogue: "Epilogo", authorNote: "Nota dell'Autore", chapter: "Capitolo" },
        pt: { prologue: "Prólogo", epilogue: "Epílogo", authorNote: "Nota do Autor", chapter: "Capítulo" },
        ca: { prologue: "Pròleg", epilogue: "Epíleg", authorNote: "Nota de l'Autor", chapter: "Capítol" },
      };
      const labels = exportLabels[project.detectedLanguage || 'es'] || exportLabels.es;

      const docSections: any[] = [];
      
      const getReeditChapterSortOrder3 = (n: number) => n === 0 ? -1000 : n === -1 || n === 998 ? 1000 : n === -2 || n === 999 ? 1001 : n;
      const sortedChapters = [...chapters].sort((a, b) => getReeditChapterSortOrder3(a.chapterNumber) - getReeditChapterSortOrder3(b.chapterNumber));
      
      for (const chapter of sortedChapters) {
        const content = chapter.editedContent || chapter.originalContent;
        if (!content) continue;

        let chapterTitle = chapter.title || `${labels.chapter} ${chapter.chapterNumber}`;
        if (chapter.chapterNumber === 0) {
          chapterTitle = chapter.title || labels.prologue;
        } else if (chapter.chapterNumber === -1 || chapter.chapterNumber === 998) {
          chapterTitle = chapter.title || labels.epilogue;
        } else if (chapter.chapterNumber === -2 || chapter.chapterNumber === 999) {
          chapterTitle = chapter.title || labels.authorNote;
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

  // Translation stream for reedit projects
  app.get("/api/reedit-projects/:id/translate-stream", async (req: Request, res: Response) => {
    const projectId = parseInt(req.params.id);
    const { sourceLanguage, targetLanguage } = req.query;

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const sendEvent = (event: string, data: any) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    // Keep-alive heartbeat every 8 seconds to prevent proxy/load balancer timeouts in production
    const heartbeatInterval = setInterval(() => {
      try {
        res.write(": heartbeat\n\n");
      } catch {
        console.log(`[Translation-Reedit] Heartbeat failed, connection likely closed`);
        clearInterval(heartbeatInterval);
      }
    }, 8000);

    const cleanup = () => {
      clearInterval(heartbeatInterval);
    };

    req.on("close", cleanup);

    const project = await storage.getReeditProject(projectId);
    if (!project) {
      sendEvent("error", { error: "Reedit project not found" });
      cleanup();
      res.end();
      return;
    }

    // Create initial translation record for reedit project
    let translationRecordId: number | null = null;
    try {
      const translation = await storage.createTranslation({
        reeditProjectId: projectId,
        source: "reedit",
        projectTitle: project.title + " (Re-editado)",
        sourceLanguage: sourceLanguage as string,
        targetLanguage: targetLanguage as string,
        status: "translating",
        chaptersTranslated: 0,
        totalWords: 0,
        markdown: "",
        inputTokens: 0,
        outputTokens: 0,
      });
      translationRecordId = translation.id;
      console.log(`[Translation-Reedit] Initialized repository record ID ${translationRecordId}`);
    } catch (dbError) {
      console.error("Error creating initial reedit translation record:", dbError);
    }
    
    try {
      console.log(`[Translation-Reedit] Starting translation for reedit project ${projectId}: ${sourceLanguage} -> ${targetLanguage}`);
      
      if (!targetLanguage) {
        sendEvent("error", { error: "targetLanguage is required" });
        cleanup();
        res.end();
        return;
      }
      
      console.log(`[Translation-Reedit] Fetching chapters for reedit project ${projectId}...`);
      const chapters = await storage.getReeditChaptersByProject(projectId);
      if (chapters.length === 0) {
        sendEvent("error", { error: "No chapters found in project" });
        cleanup();
        res.end();
        return;
      }
      console.log(`[Translation-Reedit] Found ${chapters.length} chapters`);
      
      const getReeditChapterSortOrder4 = (n: number) => n === 0 ? -1000 : n === -1 || n === 998 ? 1000 : n === -2 || n === 999 ? 1001 : n;
      const sortedChapters = [...chapters].sort((a, b) => getReeditChapterSortOrder4(a.chapterNumber) - getReeditChapterSortOrder4(b.chapterNumber));
      const chaptersWithContent = sortedChapters.filter(c => 
        (c.editedContent || c.originalContent)?.trim().length > 0
      );
      const totalChapters = chaptersWithContent.length;
      console.log(`[Translation-Reedit] ${totalChapters} chapters with content ready for translation`);
      
      sendEvent("start", { 
        projectTitle: project.title,
        totalChapters,
        sourceLanguage,
        targetLanguage
      });
      
      // Update heartbeat immediately to mark translation as active
      if (translationRecordId) {
        await storage.updateTranslation(translationRecordId, {
          heartbeatAt: new Date(),
        } as any);
        console.log(`[Translation-Reedit] Initial heartbeat set for record ${translationRecordId}`);
      }
      
      console.log(`[Translation-Reedit] Initializing TranslatorAgent...`);
      const { TranslatorAgent } = await import("./agents/translator");
      const translator = new TranslatorAgent();
      console.log(`[Translation-Reedit] TranslatorAgent initialized, starting translation loop...`);
      
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
                            chapter.chapterNumber === -1 || chapter.chapterNumber === 998 ? "Epílogo" :
                            chapter.chapterNumber === -2 || chapter.chapterNumber === 999 ? "Nota del Autor" :
                            `Capítulo ${chapter.chapterNumber}`;
        
        sendEvent("progress", {
          current: completedCount + 1,
          total: totalChapters,
          chapterNumber: chapter.chapterNumber,
          chapterTitle: chapter.title || chapterLabel,
          status: "translating"
        });

        const contentToTranslate = chapter.editedContent || chapter.originalContent || "";
        console.log(`[Translate-Reedit] Translating ${chapterLabel}: ${chapter.title}`);
        
        const result = await translator.execute({
          content: contentToTranslate,
          sourceLanguage: sourceLanguage as string,
          targetLanguage: targetLanguage as string,
          chapterTitle: chapter.title || undefined,
          chapterNumber: chapter.chapterNumber,
          projectId: -projectId, // Negative for reedit projects
        });
        
        if (result.result) {
          translatedChapters.push({
            chapterNumber: chapter.chapterNumber,
            title: chapter.title || chapterLabel,
            translatedContent: result.result.translated_text,
            notes: result.result.notes,
          });
          completedCount++;
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

        if (translationRecordId) {
          try {
            await storage.updateTranslation(translationRecordId, {
              chaptersTranslated: completedCount,
              status: "translating"
            });
          } catch (err) {
            console.error("[Translation] Progress DB update failed:", err);
          }
        }
      }
      
      // Generate final markdown
      let finalMarkdown = `# ${project.title}\n\n`;
      let totalWords = 0;
      
      // Localized chapter labels by target language
      const reeditLabels: Record<string, { prologue: string; epilogue: string; authorNote: string; chapter: string }> = {
        es: { prologue: "Prólogo", epilogue: "Epílogo", authorNote: "Nota del Autor", chapter: "Capítulo" },
        en: { prologue: "Prologue", epilogue: "Epilogue", authorNote: "Author's Note", chapter: "Chapter" },
        fr: { prologue: "Prologue", epilogue: "Épilogue", authorNote: "Note de l'Auteur", chapter: "Chapitre" },
        de: { prologue: "Prolog", epilogue: "Epilog", authorNote: "Anmerkung des Autors", chapter: "Kapitel" },
        it: { prologue: "Prologo", epilogue: "Epilogo", authorNote: "Nota dell'Autore", chapter: "Capitolo" },
        pt: { prologue: "Prólogo", epilogue: "Epílogo", authorNote: "Nota do Autor", chapter: "Capítulo" },
        ca: { prologue: "Pròleg", epilogue: "Epíleg", authorNote: "Nota de l'Autor", chapter: "Capítol" },
      };
      const lang = reeditLabels[targetLanguage as string] || reeditLabels.en;
      
      // Helper to clean code fences, JSON artifacts, and duplicate headers from translated content
      const cleanTranslatedContent = (content: string, chapterNum: number): string => {
        let cleaned = content.trim();
        
        // Strip markdown code block wrapper if present
        const codeBlockMatch = cleaned.match(/^```(?:json|markdown|md|text)?\s*([\s\S]*?)```\s*$/);
        if (codeBlockMatch) {
          cleaned = codeBlockMatch[1].trim();
        }
        
        // Also strip any remaining code fences
        cleaned = cleaned.replace(/```(?:json|markdown|md|text)?\n?/g, '').replace(/```\s*$/g, '');
        
        // If it's still JSON with translated_text field, extract it
        if (cleaned.startsWith('{') && cleaned.includes('"translated_text"')) {
          try {
            const parsed = JSON.parse(cleaned);
            if (parsed.translated_text) {
              cleaned = parsed.translated_text;
            }
          } catch {
            // Try regex extraction for malformed JSON
            const jsonMatch = cleaned.match(/"translated_text"\s*:\s*"([\s\S]*?)(?:"\s*,\s*"(?:source_|target_|notes)|\s*"\s*})/);
            if (jsonMatch) {
              cleaned = jsonMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
            }
          }
        }
        
        // Remove chapter-like headers from the start (AI includes them but we add our own)
        // CRITICAL: Require newline at the end to avoid consuming prose
        const chapterHeaderPattern = /^#{1,4}\s*(CHAPTER|Chapter|CAPÍTULO|Capítulo|CHAPITRE|Chapitre|KAPITEL|Kapitel|CAPITOLO|Capitolo|CAPÍTOL|Capítol|Prologue|PROLOGUE|Prólogo|PRÓLOGO|Prolog|PROLOG|Prologo|PROLOGO|Pròleg|PRÒLEG|Epilogue|EPILOGUE|Epílogo|EPÍLOGO|Epilog|EPILOG|Epilogo|EPILOGO|Epíleg|EPÍLEG|Author'?s?\s*Note|AUTHOR'?S?\s*NOTE|Nota\s*del?\s*Autor|NOTA\s*DEL?\s*AUTOR|Note\s*de\s*l'Auteur|NOTE\s*DE\s*L'AUTEUR|Anmerkung\s*des\s*Autors|ANMERKUNG\s*DES\s*AUTORS|Nota\s*dell'?Autore|NOTA\s*DELL'?AUTORE|Nota\s*de\s*l'Autor|NOTA\s*DE\s*L'AUTOR)[^\n]*\n+/i;
        
        // Remove up to 3 duplicate headers, but verify content remains
        for (let i = 0; i < 3; i++) {
          const before = cleaned;
          const afterRemoval = cleaned.replace(chapterHeaderPattern, '');
          // Only remove if it leaves substantial content
          if (afterRemoval.trim().length > 50 && afterRemoval !== before) {
            cleaned = afterRemoval;
          } else {
            break;
          }
        }
        
        // Also remove headers that are just the chapter number (e.g., "## 1: Title\n")
        // Only if it leaves content
        const numericHeaderPattern = /^#{1,4}\s*\d+\s*[:\-–—]?\s*[^\n]*\n+/i;
        const afterNumeric = cleaned.replace(numericHeaderPattern, '');
        if (afterNumeric.trim().length > 50) {
          cleaned = afterNumeric.trim();
        }
        
        // Remove trailing dividers
        cleaned = cleaned.replace(/\n*[-*]{3,}\s*$/, '').trim();
        
        return cleaned;
      };
      
      for (let i = 0; i < translatedChapters.length; i++) {
        const ch = translatedChapters[i];
        const isLastChapter = i === translatedChapters.length - 1;
        
        // Generate localized fallback label
        const titleLabel = ch.chapterNumber === 0 ? lang.prologue :
                          ch.chapterNumber === 998 ? lang.epilogue :
                          ch.chapterNumber === 999 ? lang.authorNote :
                          `${lang.chapter} ${ch.chapterNumber}`;
        
        // Clean the translated content (remove code fences, JSON artifacts, duplicate headers)
        const cleanedContent = cleanTranslatedContent(ch.translatedContent, ch.chapterNumber);
        
        finalMarkdown += `## ${ch.title || titleLabel}\n\n`;
        finalMarkdown += cleanedContent + "\n\n";
        // Only add divider between chapters, not after the last one
        if (!isLastChapter) {
          finalMarkdown += "---\n\n";
        }
        totalWords += cleanedContent.split(/\s+/).filter((w: string) => w.length > 0).length;
      }
      
      // Save to repository
      if (translationRecordId) {
        try {
          await storage.updateTranslation(translationRecordId, {
            chaptersTranslated: completedCount,
            totalWords,
            markdown: finalMarkdown,
            inputTokens: totalInputTokens,
            outputTokens: totalOutputTokens,
            status: "completed"
          });
        } catch (err) {
          console.error("[Translation] Final DB update failed:", err);
        }
      }
      
      sendEvent("complete", {
        chaptersTranslated: completedCount,
        totalWords,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        projectTitle: project.title,
        targetLanguage,
        markdown: finalMarkdown
      });
      
    } catch (error: any) {
      console.error("[Translation-Reedit] Error:", error);
      sendEvent("error", { error: error.message || "Translation failed" });
      
      if (translationRecordId) {
        try {
          await storage.updateTranslation(translationRecordId, { status: "error" });
        } catch (err) {
          console.error("[Translation] Status update to error failed:", err);
        }
      }
    } finally {
      cleanup();
      res.end();
    }
  });

  // ============================================
  // CHAT ROUTES - Interactive agent conversations
  // ============================================

  // Create a new chat session
  app.post("/api/chat/sessions", async (req: Request, res: Response) => {
    try {
      const { projectId, reeditProjectId, agentType, chapterNumber, title } = req.body;
      
      if (!agentType || !["architect", "reeditor"].includes(agentType)) {
        return res.status(400).json({ error: "agentType must be 'architect' or 'reeditor'" });
      }
      
      if (agentType === "architect" && !projectId) {
        return res.status(400).json({ error: "projectId is required for architect chats" });
      }
      
      if (agentType === "reeditor" && !reeditProjectId) {
        return res.status(400).json({ error: "reeditProjectId is required for reeditor chats" });
      }
      
      const session = await chatService.createSession({
        projectId: projectId ? parseInt(projectId) : undefined,
        reeditProjectId: reeditProjectId ? parseInt(reeditProjectId) : undefined,
        agentType,
        chapterNumber: chapterNumber ? parseInt(chapterNumber) : undefined,
        title,
      });
      
      res.json(session);
    } catch (error: any) {
      console.error("Error creating chat session:", error);
      res.status(500).json({ error: error.message || "Failed to create chat session" });
    }
  });

  // Get chat sessions for a project
  app.get("/api/chat/sessions", async (req: Request, res: Response) => {
    try {
      const { projectId, reeditProjectId, agentType } = req.query;
      
      if (!agentType) {
        return res.status(400).json({ error: "agentType is required" });
      }
      
      let sessions;
      if (projectId) {
        sessions = await storage.getChatSessionsByProject(parseInt(projectId as string), agentType as string);
      } else if (reeditProjectId) {
        sessions = await storage.getChatSessionsByReeditProject(parseInt(reeditProjectId as string), agentType as string);
      } else {
        return res.status(400).json({ error: "projectId or reeditProjectId is required" });
      }
      
      res.json(sessions);
    } catch (error: any) {
      console.error("Error fetching chat sessions:", error);
      res.status(500).json({ error: error.message || "Failed to fetch chat sessions" });
    }
  });

  // Get a single chat session
  app.get("/api/chat/sessions/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const session = await storage.getChatSession(id);
      
      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }
      
      res.json(session);
    } catch (error: any) {
      console.error("Error fetching chat session:", error);
      res.status(500).json({ error: error.message || "Failed to fetch chat session" });
    }
  });

  // Update chat session (e.g., change chapter context)
  app.patch("/api/chat/sessions/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const { chapterNumber, title, status } = req.body;
      
      const session = await storage.updateChatSession(id, {
        ...(chapterNumber !== undefined && { chapterNumber }),
        ...(title && { title }),
        ...(status && { status }),
      });
      
      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }
      
      res.json(session);
    } catch (error: any) {
      console.error("Error updating chat session:", error);
      res.status(500).json({ error: error.message || "Failed to update chat session" });
    }
  });

  // Delete a chat session
  app.delete("/api/chat/sessions/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteChatSession(id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting chat session:", error);
      res.status(500).json({ error: error.message || "Failed to delete chat session" });
    }
  });

  // Get messages for a chat session
  app.get("/api/chat/sessions/:id/messages", async (req: Request, res: Response) => {
    try {
      const sessionId = parseInt(req.params.id);
      const messages = await storage.getChatMessagesBySession(sessionId);
      res.json(messages);
    } catch (error: any) {
      console.error("Error fetching chat messages:", error);
      res.status(500).json({ error: error.message || "Failed to fetch chat messages" });
    }
  });

  // Send a message and get streaming response
  app.get("/api/chat/sessions/:id/stream", async (req: Request, res: Response) => {
    const sessionId = parseInt(req.params.id);
    const message = req.query.message as string;
    
    if (!message) {
      return res.status(400).json({ error: "message query parameter is required" });
    }
    
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    
    const sendEvent = (event: string, data: any) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    
    try {
      sendEvent("start", { sessionId });
      
      const result = await chatService.sendMessage(sessionId, message, (chunk) => {
        sendEvent("chunk", { text: chunk });
      });
      
      sendEvent("complete", {
        message: result.message,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
      });
    } catch (error: any) {
      console.error("Error in chat stream:", error);
      sendEvent("error", { error: error.message || "Failed to process message" });
    } finally {
      res.end();
    }
  });

  // Non-streaming message endpoint (for simple use cases)
  app.post("/api/chat/sessions/:id/messages", async (req: Request, res: Response) => {
    try {
      const sessionId = parseInt(req.params.id);
      const { content } = req.body;
      
      if (!content) {
        return res.status(400).json({ error: "content is required" });
      }
      
      const result = await chatService.sendMessage(sessionId, content);
      res.json({
        message: result.message,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
      });
    } catch (error: any) {
      console.error("Error sending chat message:", error);
      res.status(500).json({ error: error.message || "Failed to send message" });
    }
  });

  // Apply a proposal from chat
  app.post("/api/chat/proposals/apply", async (req: Request, res: Response) => {
    try {
      const { sessionId, messageId, proposal, projectId, reeditProjectId } = req.body;
      
      if (!proposal || !proposal.descripcion) {
        return res.status(400).json({ error: "proposal with descripcion is required" });
      }
      
      if (!messageId) {
        return res.status(400).json({ error: "messageId is required" });
      }
      
      // Determine target based on proposal type
      const tipo = proposal.tipo?.toLowerCase() || "";
      const capitulo = proposal.capitulo ? parseInt(proposal.capitulo) : null;
      const textoNuevo = proposal.texto_propuesto || proposal.contenido_propuesto || "";
      
      if (!textoNuevo) {
        return res.status(400).json({ error: "No proposed text found in proposal" });
      }
      
      let result: any = { applied: false, message: "" };
      
      // Handle reedit project changes
      if (reeditProjectId && capitulo) {
        const chapters = await storage.getReeditChaptersByProject(reeditProjectId);
        const targetChapter = chapters.find(ch => ch.chapterNumber === capitulo);
        
        if (targetChapter) {
          const currentContent = targetChapter.editedContent || targetChapter.originalContent || "";
          
          // Handle restructure type - replaces entire chapter content
          if (tipo === "restructure") {
            await storage.updateReeditChapter(targetChapter.id, { editedContent: textoNuevo });
            result = { applied: true, message: `Capítulo ${capitulo} reestructurado completamente` };
          } else {
            // Helper function for flexible text matching
            const findAndReplace = (content: string, original: string, replacement: string): string | null => {
            // Try exact match first
            if (content.includes(original)) {
              return content.replace(original, replacement);
            }
            
            // Try normalized whitespace match
            const normalizeWs = (s: string) => s.replace(/\s+/g, ' ').trim();
            const normalizedOriginal = normalizeWs(original);
            const normalizedContent = normalizeWs(content);
            
            if (normalizedContent.includes(normalizedOriginal)) {
              // Find approximate position and replace
              const startIdx = normalizedContent.indexOf(normalizedOriginal);
              const beforeNormalized = normalizedContent.substring(0, startIdx);
              // Count actual characters by matching word boundaries
              const words = beforeNormalized.split(' ').filter(w => w.length > 0);
              const searchStart = content.split(/\s+/).slice(0, words.length).join(' ').length;
              
              // Find the actual text span in original content
              const originalWords = original.split(/\s+/).filter(w => w.length > 0);
              let pos = 0;
              let matchStart = -1;
              let matchEnd = -1;
              
              for (let i = 0; i < originalWords.length; i++) {
                const wordIdx = content.indexOf(originalWords[i], pos);
                if (wordIdx === -1) break;
                if (i === 0) matchStart = wordIdx;
                matchEnd = wordIdx + originalWords[i].length;
                pos = matchEnd;
              }
              
              if (matchStart >= 0 && matchEnd > matchStart) {
                // Extend to include surrounding whitespace
                while (matchStart > 0 && /\s/.test(content[matchStart - 1])) matchStart--;
                while (matchEnd < content.length && /\s/.test(content[matchEnd])) matchEnd++;
                
                return content.substring(0, matchStart) + replacement + content.substring(matchEnd);
              }
            }
            
            // Try first 50 chars as anchor
            const anchor = original.substring(0, 50).trim();
            if (anchor.length > 20 && content.includes(anchor)) {
              const anchorIdx = content.indexOf(anchor);
              // Find the end of the paragraph/section
              const endMarkers = ['\n\n', '\n---', '.\n'];
              let endIdx = content.length;
              for (const marker of endMarkers) {
                const markerIdx = content.indexOf(marker, anchorIdx + anchor.length);
                if (markerIdx !== -1 && markerIdx < endIdx) {
                  endIdx = markerIdx + (marker === '.\n' ? 1 : 0);
                }
              }
              return content.substring(0, anchorIdx) + replacement + content.substring(endIdx);
            }
            
            return null;
          };
          
            // If there's original text to find and replace
            if (proposal.texto_original && proposal.texto_original.trim().length > 10) {
              const newContent = findAndReplace(currentContent, proposal.texto_original, textoNuevo);
              if (newContent && newContent !== currentContent) {
                await storage.updateReeditChapter(targetChapter.id, { editedContent: newContent });
                result = { applied: true, message: `Cambio aplicado al capítulo ${capitulo}` };
              } else {
                result = { applied: false, message: "No se pudo encontrar el texto original en el capítulo. El texto puede haber sido modificado." };
              }
            } else {
              // No specific original text - append the proposed text as a replacement note or apply directly
              result = { 
                applied: false, 
                message: "La propuesta no incluye texto original para reemplazar. Usa copiar/pegar para aplicar manualmente.",
                proposedContent: textoNuevo
              };
            }
          }
        } else {
          result = { applied: false, message: `Capítulo ${capitulo} no encontrado` };
        }
      }
      // Handle original project changes
      else if (projectId && capitulo) {
        const chapters = await storage.getChaptersByProject(projectId);
        const targetChapter = chapters.find(ch => ch.chapterNumber === capitulo);
        
        if (targetChapter) {
          const currentContent = targetChapter.content || "";
          
          // Helper function for flexible text matching (same as reedit)
          const findAndReplace = (content: string, original: string, replacement: string): string | null => {
            if (content.includes(original)) {
              return content.replace(original, replacement);
            }
            const normalizeWs = (s: string) => s.replace(/\s+/g, ' ').trim();
            const normalizedOriginal = normalizeWs(original);
            const normalizedContent = normalizeWs(content);
            
            if (normalizedContent.includes(normalizedOriginal)) {
              const originalWords = original.split(/\s+/).filter(w => w.length > 0);
              let pos = 0;
              let matchStart = -1;
              let matchEnd = -1;
              
              for (let i = 0; i < originalWords.length; i++) {
                const wordIdx = content.indexOf(originalWords[i], pos);
                if (wordIdx === -1) break;
                if (i === 0) matchStart = wordIdx;
                matchEnd = wordIdx + originalWords[i].length;
                pos = matchEnd;
              }
              
              if (matchStart >= 0 && matchEnd > matchStart) {
                return content.substring(0, matchStart) + replacement + content.substring(matchEnd);
              }
            }
            
            const anchor = original.substring(0, 50).trim();
            if (anchor.length > 20 && content.includes(anchor)) {
              const anchorIdx = content.indexOf(anchor);
              const endMarkers = ['\n\n', '\n---', '.\n'];
              let endIdx = content.length;
              for (const marker of endMarkers) {
                const markerIdx = content.indexOf(marker, anchorIdx + anchor.length);
                if (markerIdx !== -1 && markerIdx < endIdx) {
                  endIdx = markerIdx + (marker === '.\n' ? 1 : 0);
                }
              }
              return content.substring(0, anchorIdx) + replacement + content.substring(endIdx);
            }
            
            return null;
          };
          
          if (proposal.texto_original && proposal.texto_original.trim().length > 10) {
            const newContent = findAndReplace(currentContent, proposal.texto_original, textoNuevo);
            if (newContent && newContent !== currentContent) {
              await storage.updateChapter(targetChapter.id, { content: newContent });
              result = { applied: true, message: `Cambio aplicado al capítulo ${capitulo}` };
            } else {
              result = { applied: false, message: "No se pudo encontrar el texto original en el capítulo. El texto puede haber sido modificado." };
            }
          } else {
            result = { 
              applied: false, 
              message: "La propuesta no incluye texto original para reemplazar. Usa copiar/pegar para aplicar manualmente.",
              proposedContent: textoNuevo
            };
          }
        } else {
          result = { applied: false, message: `Capítulo ${capitulo} no encontrado` };
        }
      } else {
        result = { applied: false, message: "Información insuficiente para aplicar el cambio" };
      }
      
      // Store proposal in database with the correct messageId from frontend
      if (sessionId && messageId) {
        await storage.createChatProposal({
          messageId,
          sessionId,
          proposalType: tipo,
          targetType: capitulo ? "chapter" : "unknown",
          targetId: capitulo || undefined,
          targetName: proposal.objetivo,
          description: proposal.descripcion,
          originalContent: proposal.texto_original,
          proposedContent: textoNuevo,
          status: result.applied ? "applied" : "pending",
        });
      }
      
      res.json(result);
    } catch (error: any) {
      console.error("Error applying proposal:", error);
      res.status(500).json({ error: error.message || "Failed to apply proposal" });
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
