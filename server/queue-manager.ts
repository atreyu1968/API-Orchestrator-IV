import { storage } from "./storage";
import { OrchestratorV2 } from "./orchestrator-v2";
import { cancelProject } from "./agents";
import type { Project, ProjectQueueItem, QueueState } from "@shared/schema";

type QueueEventCallback = (event: QueueEvent) => void;

interface QueueEvent {
  type: "queue_started" | "queue_stopped" | "queue_paused" | "project_started" | "project_completed" | "project_failed" | "project_skipped" | "queue_empty";
  projectId?: number;
  projectTitle?: string;
  message?: string;
  error?: string;
}

const HEARTBEAT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes without activity = frozen (reduced for faster recovery)
const HEARTBEAT_CHECK_INTERVAL_MS = 30 * 1000; // Check every 30 seconds

export class QueueManager {
  private isRunning = false;
  private isPaused = false;
  private currentOrchestrator: OrchestratorV2 | null = null;
  private eventCallbacks: Set<QueueEventCallback> = new Set();
  private checkInterval: NodeJS.Timeout | null = null;
  private lastHeartbeat: Date | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private currentProjectId: number | null = null;
  private autoRecoveryCount = 0;
  private processingLock = false; // Prevent parallel processing
  private autoStartDisabled = true; // Disable auto-start by default
  private pendingRetryProjectId: number | null = null; // Force retry THIS project on next processQueue

  constructor() {}
  
  private updateHeartbeat() {
    this.lastHeartbeat = new Date();
  }
  
  private startHeartbeatMonitor() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    
    this.lastHeartbeat = new Date();
    this.heartbeatInterval = setInterval(async () => {
      await this.checkHeartbeat();
    }, HEARTBEAT_CHECK_INTERVAL_MS);
  }
  
  private stopHeartbeatMonitor() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    this.lastHeartbeat = null;
  }
  
  private async checkHeartbeat(): Promise<void> {
    if (!this.isRunning || this.isPaused || !this.currentProjectId) {
      return;
    }
    
    if (!this.lastHeartbeat) {
      return;
    }
    
    const timeSinceLastHeartbeat = Date.now() - this.lastHeartbeat.getTime();
    
    if (timeSinceLastHeartbeat > HEARTBEAT_TIMEOUT_MS) {
      console.log(`[QueueManager] FROZEN DETECTED: No activity for ${Math.round(timeSinceLastHeartbeat / 60000)} minutes. Auto-recovering...`);
      await this.autoRecover();
    }
  }
  
  private async autoRecover(): Promise<void> {
    if (!this.currentProjectId) return;
    
    this.autoRecoveryCount++;
    const projectId = this.currentProjectId;
    
    console.log(`[QueueManager] Auto-recovery attempt #${this.autoRecoveryCount} for project ${projectId}`);
    
    // CRITICAL: Cancel any pending API connections for this project
    try {
      console.log(`[QueueManager] Aborting pending API connections for project ${projectId}...`);
      cancelProject(projectId);
    } catch (e) {
      console.error("[QueueManager] Failed to cancel project connections:", e);
    }
    
    // Log the recovery event
    try {
      await storage.createActivityLog({
        projectId,
        level: "warn",
        message: `Auto-recovery triggered after ${HEARTBEAT_TIMEOUT_MS / 60000} minutes of inactivity (attempt #${this.autoRecoveryCount})`,
        agentRole: "system",
        metadata: { autoRecoveryCount: this.autoRecoveryCount },
      });
    } catch (e) {
      console.error("[QueueManager] Failed to log auto-recovery event:", e);
    }
    
    // Get the queue item and reset it
    const queueItem = await storage.getQueueItemByProject(projectId);
    if (queueItem) {
      await storage.updateQueueItem(queueItem.id, {
        status: "waiting",
        startedAt: null,
        errorMessage: `Auto-recovery after freeze (attempt #${this.autoRecoveryCount})`,
      });
    }
    
    // Clear current state BUT remember which project to retry
    this.pendingRetryProjectId = projectId; // CRITICAL: Force retry THIS project
    await storage.updateQueueState({ currentProjectId: null });
    this.currentOrchestrator = null;
    this.currentProjectId = null;
    this.stopHeartbeatMonitor();
    
    // AUTO-RESTART the queue after recovery - will retry the SAME project
    console.log(`[QueueManager] Project ${projectId} reset. Will RETRY this project in 3 seconds...`);
    
    setTimeout(async () => {
      try {
        console.log(`[QueueManager] Auto-restarting to RETRY frozen project ${projectId}`);
        this.isRunning = false; // Reset to allow start()
        await this.start();
      } catch (e) {
        console.error("[QueueManager] Failed to auto-restart after heartbeat recovery:", e);
        this.pendingRetryProjectId = null; // Clear on failure
      }
    }, 3000);
  }

  async initialize(): Promise<void> {
    // Start global frozen project monitor (survives deploys)
    this.startGlobalFrozenMonitor();
    
    const state = await storage.getQueueState();
    if (!state) return;

    // Check for frozen projects first (based on activity logs, not memory)
    await this.checkForFrozenProjects();

    // If the server crashed while running, clean up and AUTO-RESTART
    if (state.status === "running" && state.currentProjectId) {
      console.log("[QueueManager] Detected incomplete queue state from previous session - will auto-restart");
      
      // Check if the project was actually completed
      const project = await storage.getProject(state.currentProjectId);
      if (project?.status === "completed") {
        // Project finished but queue didn't advance - clean up
        const queueItem = await storage.getQueueItemByProject(state.currentProjectId);
        if (queueItem && queueItem.status === "processing") {
          await storage.updateQueueItem(queueItem.id, {
            status: "completed",
            completedAt: new Date(),
          });
        }
        await storage.updateQueueState({ currentProjectId: null, status: "running" });
        console.log("[QueueManager] Cleaned up completed project. AUTO-RESTARTING queue...");
      } else {
        // Project was in progress - reset it to allow re-processing
        const queueItem = await storage.getQueueItemByProject(state.currentProjectId);
        if (queueItem && queueItem.status === "processing") {
          await storage.updateQueueItem(queueItem.id, {
            status: "waiting",
            startedAt: null,
          });
        }
        
        // Mark project as "paused" so processProject uses resumeNovel instead of generateNovel
        // This prevents re-generating the World Bible from scratch on each server restart
        if (project && project.status === "generating") {
          await storage.updateProject(project.id, { status: "paused" });
          console.log(`[QueueManager] Project ${project.id} marked as paused for resume`);
        }
        
        await storage.updateQueueState({ currentProjectId: null, status: "running" });
        console.log("[QueueManager] Reset incomplete project. AUTO-RESTARTING queue...");
        
        // Log the auto-recovery
        if (project) {
          await storage.createActivityLog({
            projectId: state.currentProjectId,
            level: "info",
            message: `Sistema reiniciado - continuando generación automáticamente`,
            agentRole: "system",
          });
        }
      }
      
      // AUTO-START IMMEDIATELY (not after delay to avoid server restart killing the timer)
      this.isRunning = false;
      this.isPaused = false;
      // Use setImmediate to let the server finish initialization first
      setImmediate(async () => {
        try {
          console.log("[QueueManager] Auto-starting queue after server restart (immediate)");
          await this.start();
        } catch (e) {
          console.error("[QueueManager] Failed to auto-start after server restart:", e);
        }
      });
    } else if (state.status === "running") {
      // Queue was marked running but no current project - continue processing
      console.log("[QueueManager] Queue was running with no project. AUTO-RESTARTING to process queue...");
      this.isRunning = false;
      this.isPaused = false;
      // Use setImmediate to let the server finish initialization first
      setImmediate(async () => {
        try {
          console.log("[QueueManager] Auto-starting queue (was running with no project) (immediate)");
          await this.start();
        } catch (e) {
          console.error("[QueueManager] Failed to auto-start:", e);
        }
      });
    } else if (state.status === "paused") {
      this.isPaused = true;
      console.log("[QueueManager] Queue is paused, waiting for manual resume");
    } else {
      // Stopped state
      this.isRunning = false;
      this.isPaused = false;
      console.log("[QueueManager] Queue is stopped, waiting for manual start");
    }
  }
  
  private globalFrozenInterval: NodeJS.Timeout | null = null;
  
  private startGlobalFrozenMonitor() {
    if (this.globalFrozenInterval) {
      clearInterval(this.globalFrozenInterval);
    }
    
    // Check every 1 minute for frozen projects (uses DB, survives deploys)
    this.globalFrozenInterval = setInterval(async () => {
      await this.checkForFrozenProjects();
    }, 60 * 1000);
    
    console.log("[QueueManager] Global frozen project monitor started");
  }
  
  private async checkForFrozenProjects(): Promise<void> {
    try {
      // FIRST: Check if queue is paused but there are projects waiting - auto-resume
      const queueState = await storage.getQueueState();
      if (queueState?.status === "paused" && !this.currentProjectId) {
        const allQueueItems = await storage.getQueueItems();
        const waitingItems = allQueueItems.filter(item => item.status === "waiting");
        if (waitingItems.length > 0) {
          console.log(`[QueueManager] AUTO-RECOVERY: Queue is paused but has waiting projects. Auto-resuming...`);
          this.isPaused = false;
          this.isRunning = false;
          await storage.updateQueueState({ status: "running", currentProjectId: null });
          this.emit({ type: "queue_started", message: "Auto-recovery: Queue auto-resumed" });
          
          setImmediate(async () => {
            try {
              await this.start();
              console.log(`[QueueManager] AUTO-RECOVERY: Queue resumed. currentProjectId=${this.currentProjectId}`);
            } catch (e) {
              console.error("[QueueManager] AUTO-RECOVERY: Failed to auto-resume queue:", e);
            }
          });
          return; // Don't check for frozen projects if we just resumed
        }
      }
      
      // Get all projects in active processing states that might freeze
      const projects = await storage.getAllProjects();
      // Extended list: include all states where generation could be happening
      const monitoredStatuses = ["generating", "failed_final_review", "paused", "awaiting_instructions", "final_review_in_progress"];
      const generatingProjects = projects.filter((p: Project) => monitoredStatuses.includes(p.status));
      
      // Debug log every 5 minutes (every 5th check)
      if (Date.now() % (5 * 60 * 1000) < 60 * 1000) {
        console.log(`[QueueManager] Frozen monitor: ${generatingProjects.length} projects in monitored states (${monitoredStatuses.join(", ")}). Queue status: ${queueState?.status}, isPaused: ${this.isPaused}`);
      }
      
      for (const project of generatingProjects) {
        const lastActivity = await storage.getLastActivityLogTime(project.id);
        
        // Handle projects with no activity logs - use project creation date or current time
        const activityTime = lastActivity || project.createdAt;
        if (!activityTime) {
          console.warn(`[QueueManager] Project ${project.id} "${project.title}" has no activity or creation time`);
          continue;
        }
        
        const timeSinceActivity = Date.now() - new Date(activityTime).getTime();
        
        if (timeSinceActivity > HEARTBEAT_TIMEOUT_MS) {
            console.log(`[QueueManager] FROZEN PROJECT DETECTED: "${project.title}" (ID: ${project.id}) - no activity for ${Math.round(timeSinceActivity / 60000)} minutes`);
            
            // CRITICAL: Cancel any pending API connections FIRST
            try {
              console.log(`[QueueManager] Aborting pending API connections for frozen project ${project.id}...`);
              cancelProject(project.id);
            } catch (e) {
              console.error("[QueueManager] Failed to cancel project connections:", e);
            }
            
            // Log the recovery event
            await storage.createActivityLog({
              projectId: project.id,
              level: "warn",
              message: `Auto-recovery: proyecto congelado detectado (${Math.round(timeSinceActivity / 60000)} min sin actividad). Reiniciando...`,
              agentRole: "system",
            });
            
            // Reset project status to allow resume
            await storage.updateProject(project.id, { status: "paused" });
            
            // Clear queue state if this was the current project
            const state = await storage.getQueueState();
            if (state?.currentProjectId === project.id) {
              await storage.updateQueueState({ currentProjectId: null });
              this.currentOrchestrator = null;
              this.currentProjectId = null;
            }
            
            // Reset queue item to waiting OR CREATE IT if it doesn't exist
            const queueItem = await storage.getQueueItemByProject(project.id);
            if (queueItem) {
              if (queueItem.status !== "waiting") {
                await storage.updateQueueItem(queueItem.id, {
                  status: "waiting",
                  startedAt: null,
                  completedAt: null,
                  errorMessage: `Auto-recovery after ${Math.round(timeSinceActivity / 60000)} min (status was: ${project.status})`,
                });
              }
            } else {
              // CRITICAL: Create queue item if it doesn't exist - this can happen if generation was started without queue
              console.log(`[QueueManager] Creating missing queue item for frozen project ${project.id}`);
              const allQueueItems = await storage.getQueueItems();
              const maxPosition = allQueueItems.length > 0 
                ? Math.max(...allQueueItems.map(q => q.position)) 
                : 0;
              await storage.addToQueue({
                projectId: project.id,
                position: maxPosition + 1,
                priority: "normal",
                status: "waiting",
              });
            }
            
            // CRITICAL: Set pending retry to THIS project so it gets retried, not skipped
            this.pendingRetryProjectId = project.id;
            
            // AUTO-RESTART the queue after recovery - will retry the SAME frozen project
            console.log(`[QueueManager] Frozen project "${project.title}" (ID: ${project.id}) reset. Will RETRY this project...`);
            
            await storage.createActivityLog({
              projectId: project.id,
              level: "info",
              message: `Auto-recovery completado. Reintentando este proyecto automáticamente...`,
              agentRole: "system",
            });
            
            // Force reset ALL internal states to allow restart
            this.isRunning = false;
            this.isPaused = false;
            this.processingLock = false;
            this.currentProjectId = null;
            this.currentOrchestrator = null;
            
            // Also ensure DB state is fully cleared
            await storage.updateQueueState({ 
              currentProjectId: null, 
              status: "running" 
            });
            
            // CRITICAL: Emit event so frontend updates immediately
            this.emit({ type: "queue_started", message: "Auto-recovery: Queue restarted automatically" });
            console.log(`[QueueManager] AUTO-RECOVERY: Emitted queue_started event for UI update`);
            
            // Small delay then restart - use setImmediate pattern to avoid blocking
            setTimeout(() => {
              (async () => {
                try {
                  console.log(`[QueueManager] AUTO-RECOVERY: Starting queue to RETRY frozen project ${project.id}`);
                  
                  // CRITICAL: Force reset ALL flags to ensure clean state
                  this.isRunning = false;
                  this.isPaused = false;
                  this.processingLock = false;
                  this.currentProjectId = null;
                  this.currentOrchestrator = null;
                  
                  // Ensure DB state is also clean
                  await storage.updateQueueState({ 
                    currentProjectId: null, 
                    status: "running" 
                  });
                  
                  // Set pending retry BEFORE start to ensure priority pickup
                  this.pendingRetryProjectId = project.id;
                  
                  // Ensure the project is still in paused state before starting
                  const checkProject = await storage.getProject(project.id);
                  if (!checkProject || checkProject.status !== "paused") {
                    console.log(`[QueueManager] AUTO-RECOVERY: Project ${project.id} status changed to ${checkProject?.status}, skipping`);
                    this.pendingRetryProjectId = null;
                    return;
                  }
                  
                  console.log(`[QueueManager] AUTO-RECOVERY: Calling start() for project ${project.id}`);
                  await this.start();
                  
                  // Log result
                  console.log(`[QueueManager] AUTO-RECOVERY: start() completed. isRunning=${this.isRunning}, currentProjectId=${this.currentProjectId}, pendingRetryProjectId=${this.pendingRetryProjectId}`);
                  
                  // CRITICAL: If start() didn't pick up the project, force processQueue directly
                  if (this.currentProjectId === null) {
                    console.log(`[QueueManager] AUTO-RECOVERY: Project ${project.id} not picked up by start(), forcing processQueue directly`);
                    this.pendingRetryProjectId = project.id;
                    this.isRunning = true;
                    this.isPaused = false;
                    await this.processQueue();
                    console.log(`[QueueManager] AUTO-RECOVERY: processQueue() completed. currentProjectId=${this.currentProjectId}`);
                  }
                } catch (e) {
                  console.error("[QueueManager] AUTO-RECOVERY FAILED:", e);
                  this.pendingRetryProjectId = null;
                }
              })();
            }, 3000);
            
            break; // Handle one frozen project at a time
        }
      }
    } catch (error) {
      console.error("[QueueManager] Error checking for frozen projects:", error);
    }
  }

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
    console.log("[QueueManager] STOP requested - cancelling all processing");
    
    this.isRunning = false;
    this.isPaused = false;
    this.processingLock = false;
    this.stopHeartbeatMonitor();
    
    // Cancel current project generation if one is active
    const state = await storage.getQueueState();
    if (state?.currentProjectId) {
      console.log(`[QueueManager] Cancelling active project ${state.currentProjectId}`);
      
      // Cancel the AI generation using static import
      try {
        cancelProject(state.currentProjectId);
        console.log(`[QueueManager] Cancelled project ${state.currentProjectId}`);
      } catch (e) {
        console.error("[QueueManager] Failed to cancel project:", e);
      }
      
      const queueItem = await storage.getQueueItemByProject(state.currentProjectId);
      if (queueItem && queueItem.status === "processing") {
        await storage.updateQueueItem(queueItem.id, {
          status: "waiting",
          startedAt: null,
          errorMessage: "Detenido manualmente por el usuario",
        });
      }
      
      // Reset project status to paused so it can be resumed
      const project = await storage.getProject(state.currentProjectId);
      if (project && project.status === "generating") {
        await storage.updateProject(state.currentProjectId, { status: "paused" });
      }
    }
    
    this.currentProjectId = null;
    this.currentOrchestrator = null;
    
    await storage.updateQueueState({ status: "stopped", currentProjectId: null });
    this.emit({ type: "queue_stopped", message: "Queue processing stopped" });
    
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    
    console.log("[QueueManager] STOP complete - queue is now stopped");
  }

  async pause(): Promise<void> {
    this.isPaused = true;
    this.stopHeartbeatMonitor();
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
      this.stopHeartbeatMonitor();
      this.currentProjectId = null;
      
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
    console.log(`[QueueManager] processQueue() called - isRunning=${this.isRunning}, isPaused=${this.isPaused}, currentProjectId=${this.currentProjectId}, lock=${this.processingLock}`);
    
    // Guard: Check if queue should process
    if (!this.isRunning || this.isPaused) {
      console.log("[QueueManager] processQueue skipped - queue not running or paused");
      return;
    }

    // Guard: Prevent parallel processing - check if we're already processing a project
    if (this.currentProjectId !== null) {
      console.log("[QueueManager] processQueue skipped - project already in progress");
      return;
    }

    // Guard: Lock to prevent race conditions
    if (this.processingLock) {
      console.log("[QueueManager] processQueue skipped - processing lock active");
      return;
    }

    // Acquire lock BEFORE any async operations
    this.processingLock = true;

    try {
      const state = await this.getState();

      // Double-check currentProjectId after async call
      if (state.currentProjectId) {
        console.log("[QueueManager] processQueue skipped - DB shows project in progress");
        return;
      }

      // PRIORITY: If there's a pending retry project, process THAT one first
      let nextItem = null;
      if (this.pendingRetryProjectId) {
        const retryProjectId = this.pendingRetryProjectId;
        console.log(`[QueueManager] PRIORITY: Retrying frozen project ${retryProjectId}`);
        
        const retryQueueItem = await storage.getQueueItemByProject(retryProjectId);
        if (retryQueueItem && retryQueueItem.status === "waiting") {
          nextItem = retryQueueItem;
          console.log(`[QueueManager] Found queue item for retry project ${retryProjectId}`);
        } else {
          console.log(`[QueueManager] Retry project ${retryProjectId} not found or not in waiting status. Clearing pending retry.`);
        }
        
        // Clear the pending retry flag regardless (we tried)
        this.pendingRetryProjectId = null;
      }
      
      // If no pending retry or retry failed, get next in queue normally
      if (!nextItem) {
        nextItem = await storage.getNextInQueue();
        console.log(`[QueueManager] getNextInQueue returned: ${nextItem ? `item ${nextItem.id} for project ${nextItem.projectId}` : 'null'}`);
      }
      
      if (!nextItem) {
        console.log("[QueueManager] No items in queue - emitting queue_empty");
        this.emit({ type: "queue_empty", message: "No projects in queue" });
        
        if (state.autoAdvance) {
          this.checkInterval = setInterval(async () => {
            // Guard in interval callback
            if (!this.isRunning || this.isPaused || this.currentProjectId !== null) {
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

      // Process project - lock stays until project completes
      await this.processProject(nextItem);
    } finally {
      // Only release lock when we're not processing a project
      if (this.currentProjectId === null) {
        this.processingLock = false;
      }
    }
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
    this.currentProjectId = project.id;
    this.autoRecoveryCount = 0;
    this.startHeartbeatMonitor();

    this.emit({
      type: "project_started",
      projectId: project.id,
      projectTitle: project.title,
      message: `Starting generation of: ${project.title}`,
    });

    const self = this;
    
    // All projects now use v2 pipeline - upgrade if needed
    if (project.pipelineVersion !== "v2") {
      await storage.updateProject(project.id, { pipelineVersion: "v2" });
      console.log(`[QueueManager] Upgraded project ${project.id} to v2 pipeline`);
    }
    console.log(`[QueueManager] Project ${project.id} using pipeline: v2 (scene-based)`);

    const orchestrator = new OrchestratorV2({
      onAgentStatus: async (role, status, message) => {
        self.updateHeartbeat();
        console.log(`[Queue V2] ${project.title} - ${role}: ${status}`, message || "");
        
        // Update agent status in database for UI display
        try {
          await storage.updateAgentStatus(project.id, role, { 
            status, 
            currentTask: message || undefined 
          });
        } catch (err) {
          console.error(`[Queue V2] Failed to update agent status:`, err);
        }
        
        if (message) {
          try {
            await storage.createActivityLog({
              projectId: project.id,
              level: status === "error" ? "error" : "info",
              agentRole: role,
              message: message,
            });
          } catch (err) {
            console.error(`[Queue V2] Failed to save activity log:`, err);
          }
        }
      },
      onChapterComplete: async (chapterNumber, wordCount, chapterTitle) => {
        self.updateHeartbeat();
        console.log(`[Queue V2] ${project.title} - Chapter ${chapterNumber} complete: ${wordCount} words`);
        const sectionName = chapterNumber === 0 ? "el Prólogo" : 
                           chapterNumber === -1 ? "el Epílogo" : 
                           chapterNumber === -2 ? "la Nota del Autor" :
                           `el Capítulo ${chapterNumber}`;
        try {
          await storage.createActivityLog({
            projectId: project.id,
            level: "success",
            agentRole: "ghostwriter-v2",
            message: `${sectionName} completado (${wordCount} palabras)`,
          });
        } catch (err) {
          console.error(`[Queue V2] Failed to save chapter complete log:`, err);
        }
      },
      onSceneComplete: (chapterNumber, sceneNumber, totalScenes, wordCount) => {
        self.updateHeartbeat();
        console.log(`[Queue V2] ${project.title} - Scene ${sceneNumber}/${totalScenes} of Chapter ${chapterNumber} complete`);
      },
      onProjectComplete: async () => {
        self.stopHeartbeatMonitor();
        self.currentProjectId = null;
        await self.handleProjectComplete(queueItem, project);
      },
      onError: async (error) => {
        self.stopHeartbeatMonitor();
        self.currentProjectId = null;
        await self.handleProjectError(queueItem, project, error);
      },
    });

    this.currentOrchestrator = orchestrator;

    try {
      // V2 always uses generateNovel - it handles continuation from existing chapters
      await orchestrator.generateNovel(project);
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
    const isRateLimit = error.includes("RATELIMIT") || error.includes("Rate limit") || error.includes("429");

    this.emit({
      type: "project_failed",
      projectId: project.id,
      projectTitle: project.title,
      error,
      message: `Error: ${project.title} - ${error}`,
    });

    if (!state.skipOnError) {
      if (isRateLimit) {
        console.log(`[QueueManager] Rate limit for ${project.title}. Waiting 120s before retry...`);
        await storage.updateQueueItem(queueItem.id, {
          status: "waiting",
          startedAt: null,
          errorMessage: error,
        });
        await storage.updateQueueState({ currentProjectId: null });
        this.currentOrchestrator = null;
        
        setTimeout(() => {
          if (this.isRunning && !this.isPaused) {
            this.processQueue();
          }
        }, 120000);
      } else {
        await storage.updateQueueItem(queueItem.id, {
          status: "failed",
          completedAt: new Date(),
          errorMessage: error,
        });
        await storage.updateQueueState({ currentProjectId: null });
        this.currentOrchestrator = null;
        await this.pause();
      }
    } else {
      await storage.updateQueueItem(queueItem.id, {
        status: "failed",
        completedAt: new Date(),
        errorMessage: error,
      });
      await storage.updateQueueState({ currentProjectId: null });
      this.currentOrchestrator = null;
      
      if (state.autoAdvance) {
        setTimeout(() => this.processQueue(), 5000);
      }
    }
  }

  isProcessing(): boolean {
    return this.isRunning && !this.isPaused;
  }

  getCurrentStatus(): { isRunning: boolean; isPaused: boolean } {
    return { isRunning: this.isRunning, isPaused: this.isPaused };
  }

  async forceUnlock(projectId?: number): Promise<{ success: boolean; message: string }> {
    console.log(`[QueueManager] Force unlock requested for project ${projectId ?? 'any'}`);
    
    if (projectId && this.currentProjectId !== null && this.currentProjectId !== projectId) {
      return { 
        success: false, 
        message: `Cannot unlock project ${projectId}: different project ${this.currentProjectId} is currently locked` 
      };
    }

    const lockedProjectId = this.currentProjectId;
    
    this.processingLock = false;
    this.currentProjectId = null;
    this.pendingRetryProjectId = null;
    this.currentOrchestrator = null;
    this.stopHeartbeatMonitor();
    
    await storage.updateQueueState({ currentProjectId: null });
    
    if (lockedProjectId) {
      const queueItem = await storage.getQueueItemByProject(lockedProjectId);
      if (queueItem && queueItem.status === "processing") {
        await storage.updateQueueItem(queueItem.id, {
          status: "waiting",
          startedAt: null,
          errorMessage: "Force unlocked by admin",
        });
      }
    }

    console.log(`[QueueManager] Force unlock completed. Project ${lockedProjectId ?? 'none'} was unlocked`);
    
    return { 
      success: true, 
      message: lockedProjectId 
        ? `Project ${lockedProjectId} unlocked successfully` 
        : "Processing lock cleared (no project was locked)"
    };
  }
}

export const queueManager = new QueueManager();
