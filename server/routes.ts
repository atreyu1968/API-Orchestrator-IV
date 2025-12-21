import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { Orchestrator } from "./orchestrator";
import { insertProjectSchema } from "@shared/schema";

const activeStreams = new Map<number, Set<Response>>();

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

  return httpServer;
}
