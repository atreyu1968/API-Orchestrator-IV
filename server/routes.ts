import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { Orchestrator } from "./orchestrator";
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
});

const activeStreams = new Map<number, Set<Response>>();

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
        },
        onChapterComplete: (chapterNumber, wordCount) => {
          sendToStreams({ type: "chapter_complete", chapterNumber, wordCount });
        },
        onChapterRewrite: (chapterNumber, chapterTitle, currentIndex, totalToRewrite, reason) => {
          sendToStreams({ type: "chapter_rewrite", chapterNumber, chapterTitle, currentIndex, totalToRewrite, reason });
        },
        onProjectComplete: () => {
          sendToStreams({ type: "project_complete" });
        },
        onError: (error) => {
          sendToStreams({ type: "error", message: error });
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
      const project = await storage.getProject(id);
      
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      if (project.status === "generating") {
        return res.status(400).json({ error: "Project is already generating" });
      }

      const validStatuses = ["paused", "cancelled", "error", "failed_final_review"];
      if (!validStatuses.includes(project.status)) {
        return res.status(400).json({ 
          error: `Cannot resume project with status "${project.status}". Only paused, cancelled, or error projects can be resumed.` 
        });
      }

      res.json({ message: "Resume started", projectId: id });

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
        },
        onChapterComplete: (chapterNumber, wordCount) => {
          sendToStreams({ type: "chapter_complete", chapterNumber, wordCount });
        },
        onChapterRewrite: (chapterNumber, chapterTitle, currentIndex, totalToRewrite, reason) => {
          sendToStreams({ type: "chapter_rewrite", chapterNumber, chapterTitle, currentIndex, totalToRewrite, reason });
        },
        onProjectComplete: () => {
          sendToStreams({ type: "project_complete" });
        },
        onError: (error) => {
          sendToStreams({ type: "error", message: error });
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
        },
        onChapterComplete: (chapterNumber, wordCount) => {
          sendToStreams({ type: "chapter_complete", chapterNumber, wordCount });
        },
        onChapterRewrite: (chapterNumber, chapterTitle, currentIndex, totalToRewrite, reason) => {
          sendToStreams({ type: "chapter_rewrite", chapterNumber, chapterTitle, currentIndex, totalToRewrite, reason });
        },
        onProjectComplete: () => {
          sendToStreams({ type: "project_complete" });
        },
        onError: (error) => {
          sendToStreams({ type: "error", message: error });
        },
      });

      orchestrator.runFinalReviewOnly(project).catch(console.error);

    } catch (error) {
      console.error("Error starting final review:", error);
      res.status(500).json({ error: "Failed to start final review" });
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

  return httpServer;
}
