import { storage } from "./storage";
import { Orchestrator } from "./orchestrator";
import type { Project, ProjectQueueItem, QueueState } from "@shared/schema";

type QueueEventCallback = (event: QueueEvent) => void;

interface QueueEvent {
  type: "queue_started" | "queue_stopped" | "queue_paused" | "project_started" | "project_completed" | "project_failed" | "project_skipped" | "queue_empty";
  projectId?: number;
  projectTitle?: string;
  message?: string;
  error?: string;
}

export class QueueManager {
  private isRunning = false;
  private isPaused = false;
  private currentOrchestrator: Orchestrator | null = null;
  private eventCallbacks: Set<QueueEventCallback> = new Set();
  private checkInterval: NodeJS.Timeout | null = null;

  constructor() {}

  addListener(callback: QueueEventCallback) {
    this.eventCallbacks.add(callback);
    return () => this.eventCallbacks.delete(callback);
  }

  private emit(event: QueueEvent) {
    this.eventCallbacks.forEach(cb => {
      try {
        cb(event);
      } catch (e) {
        console.error("Queue event callback error:", e);
      }
    });
  }

  async getState(): Promise<QueueState> {
    let state = await storage.getQueueState();
    if (!state) {
      state = await storage.updateQueueState({ status: "stopped" });
    }
    return state;
  }

  async start(): Promise<void> {
    if (this.isRunning) return;

    this.isRunning = true;
    this.isPaused = false;
    await storage.updateQueueState({ status: "running" });
    this.emit({ type: "queue_started", message: "Queue processing started" });

    this.processQueue();
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    this.isPaused = false;
    await storage.updateQueueState({ status: "stopped", currentProjectId: null });
    this.emit({ type: "queue_stopped", message: "Queue processing stopped" });
    
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  async pause(): Promise<void> {
    this.isPaused = true;
    await storage.updateQueueState({ status: "paused" });
    this.emit({ type: "queue_paused", message: "Queue processing paused" });
  }

  async resume(): Promise<void> {
    if (!this.isRunning) {
      await this.start();
      return;
    }
    
    this.isPaused = false;
    await storage.updateQueueState({ status: "running" });
    this.emit({ type: "queue_started", message: "Queue processing resumed" });
    
    this.processQueue();
  }

  async skipCurrent(): Promise<void> {
    const state = await storage.getQueueState();
    if (state?.currentProjectId) {
      const queueItem = await storage.getQueueItemByProject(state.currentProjectId);
      if (queueItem) {
        await storage.updateQueueItem(queueItem.id, {
          status: "skipped",
          completedAt: new Date(),
        });
        this.emit({
          type: "project_skipped",
          projectId: state.currentProjectId,
          message: "Current project skipped",
        });
      }
      await storage.updateQueueState({ currentProjectId: null });
      
      if (this.isRunning && !this.isPaused) {
        this.processQueue();
      }
    }
  }

  private async processQueue(): Promise<void> {
    if (!this.isRunning || this.isPaused) return;

    const state = await this.getState();

    if (state.currentProjectId) {
      return;
    }

    const nextItem = await storage.getNextInQueue();
    
    if (!nextItem) {
      this.emit({ type: "queue_empty", message: "No projects in queue" });
      
      if (state.autoAdvance) {
        this.checkInterval = setInterval(async () => {
          if (!this.isRunning || this.isPaused) {
            if (this.checkInterval) clearInterval(this.checkInterval);
            return;
          }
          
          const next = await storage.getNextInQueue();
          if (next) {
            if (this.checkInterval) clearInterval(this.checkInterval);
            this.processQueue();
          }
        }, 10000);
      }
      return;
    }

    await this.processProject(nextItem);
  }

  private async processProject(queueItem: ProjectQueueItem): Promise<void> {
    const project = await storage.getProject(queueItem.projectId);
    if (!project) {
      await storage.updateQueueItem(queueItem.id, {
        status: "failed",
        completedAt: new Date(),
        errorMessage: "Project not found",
      });
      this.processQueue();
      return;
    }

    await storage.updateQueueItem(queueItem.id, {
      status: "processing",
      startedAt: new Date(),
    });

    await storage.updateQueueState({ currentProjectId: project.id });

    this.emit({
      type: "project_started",
      projectId: project.id,
      projectTitle: project.title,
      message: `Starting generation of: ${project.title}`,
    });

    const orchestrator = new Orchestrator({
      onAgentStatus: async (role, status, message) => {
        console.log(`[Queue] ${project.title} - ${role}: ${status}`, message || "");
      },
      onChapterComplete: async (chapterNumber, wordCount, chapterTitle) => {
        console.log(`[Queue] ${project.title} - Chapter ${chapterNumber} complete: ${wordCount} words`);
      },
      onChapterRewrite: async () => {},
      onChapterStatusChange: async () => {},
      onProjectComplete: async () => {
        await this.handleProjectComplete(queueItem, project);
      },
      onError: async (error) => {
        await this.handleProjectError(queueItem, project, error);
      },
    });

    this.currentOrchestrator = orchestrator;

    try {
      if (project.status === "paused") {
        await orchestrator.resumeNovel(project);
      } else {
        await orchestrator.generateNovel(project);
      }
    } catch (error) {
      await this.handleProjectError(queueItem, project, String(error));
    }
  }

  private async handleProjectComplete(queueItem: ProjectQueueItem, project: Project): Promise<void> {
    await storage.updateQueueItem(queueItem.id, {
      status: "completed",
      completedAt: new Date(),
    });

    await storage.updateQueueState({ currentProjectId: null });
    this.currentOrchestrator = null;

    this.emit({
      type: "project_completed",
      projectId: project.id,
      projectTitle: project.title,
      message: `Completed: ${project.title}`,
    });

    const state = await this.getState();
    
    if (state.pauseAfterEach) {
      await this.pause();
      return;
    }

    if (state.autoAdvance) {
      setTimeout(() => this.processQueue(), 5000);
    }
  }

  private async handleProjectError(queueItem: ProjectQueueItem, project: Project, error: string): Promise<void> {
    const state = await this.getState();

    await storage.updateQueueItem(queueItem.id, {
      status: "failed",
      completedAt: new Date(),
      errorMessage: error,
    });

    await storage.updateQueueState({ currentProjectId: null });
    this.currentOrchestrator = null;

    this.emit({
      type: "project_failed",
      projectId: project.id,
      projectTitle: project.title,
      error,
      message: `Failed: ${project.title} - ${error}`,
    });

    if (state.skipOnError && state.autoAdvance) {
      setTimeout(() => this.processQueue(), 5000);
    } else if (!state.skipOnError) {
      await this.pause();
    }
  }

  isProcessing(): boolean {
    return this.isRunning && !this.isPaused;
  }

  getCurrentStatus(): { isRunning: boolean; isPaused: boolean } {
    return { isRunning: this.isRunning, isPaused: this.isPaused };
  }
}

export const queueManager = new QueueManager();
