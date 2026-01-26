import { db } from "./db";
import { 
  projects, chapters, worldBibles, thoughtLogs, agentStatuses, pseudonyms, styleGuides,
  series, continuitySnapshots, importedManuscripts, importedChapters, extendedGuides, activityLogs,
  projectQueue, queueState, seriesArcMilestones, seriesPlotThreads, seriesArcVerifications,
  aiUsageEvents, reeditProjects, reeditChapters, reeditAuditReports, reeditWorldBibles, reeditIssues,
  chatSessions, chatMessages, chatProposals, plotThreads,
  type Project, type InsertProject, type Chapter, type InsertChapter,
  type WorldBible, type InsertWorldBible, type ThoughtLog, type InsertThoughtLog,
  type AgentStatus, type InsertAgentStatus, type Pseudonym, type InsertPseudonym,
  type StyleGuide, type InsertStyleGuide, type Series, type InsertSeries,
  type ContinuitySnapshot, type InsertContinuitySnapshot,
  type ImportedManuscript, type InsertImportedManuscript,
  type ImportedChapter, type InsertImportedChapter,
  type ExtendedGuide, type InsertExtendedGuide,
  type ActivityLog, type InsertActivityLog,
  type ProjectQueueItem, type InsertProjectQueueItem,
  type QueueState, type InsertQueueState,
  type SeriesArcMilestone, type InsertSeriesArcMilestone,
  type SeriesPlotThread, type InsertSeriesPlotThread,
  type SeriesArcVerification, type InsertSeriesArcVerification,
  type Translation, type InsertTranslation, translations,
  type AiUsageEvent, type InsertAiUsageEvent,
  type ReeditProject, type InsertReeditProject,
  type ReeditChapter, type InsertReeditChapter,
  type ReeditAuditReport, type InsertReeditAuditReport,
  type ReeditIssue, type InsertReeditIssue,
  type ReeditWorldBible, type InsertReeditWorldBible,
  type ChatSession, type InsertChatSession,
  type ChatMessage, type InsertChatMessage,
  type ChatProposal, type InsertChatProposal,
  type PlotThread, type InsertPlotThread
} from "@shared/schema";
import { eq, desc, asc, and, lt, isNull, or, sql } from "drizzle-orm";

export interface IStorage {
  createPseudonym(data: InsertPseudonym): Promise<Pseudonym>;
  getPseudonym(id: number): Promise<Pseudonym | undefined>;
  getAllPseudonyms(): Promise<Pseudonym[]>;
  updatePseudonym(id: number, data: Partial<Pseudonym>): Promise<Pseudonym | undefined>;
  deletePseudonym(id: number): Promise<void>;

  createStyleGuide(data: InsertStyleGuide): Promise<StyleGuide>;
  getStyleGuide(id: number): Promise<StyleGuide | undefined>;
  getStyleGuidesByPseudonym(pseudonymId: number): Promise<StyleGuide[]>;
  getAllStyleGuides(): Promise<StyleGuide[]>;
  updateStyleGuide(id: number, data: Partial<StyleGuide>): Promise<StyleGuide | undefined>;
  deleteStyleGuide(id: number): Promise<void>;

  createProject(data: InsertProject): Promise<Project>;
  getProject(id: number): Promise<Project | undefined>;
  getAllProjects(): Promise<Project[]>;
  updateProject(id: number, data: Partial<Project>): Promise<Project | undefined>;
  deleteProject(id: number): Promise<void>;

  createChapter(data: InsertChapter): Promise<Chapter>;
  getChaptersByProject(projectId: number): Promise<Chapter[]>;
  getAllChapters(): Promise<Chapter[]>;
  updateChapter(id: number, data: Partial<Chapter>): Promise<Chapter | undefined>;
  deleteChapter(id: number): Promise<void>;

  createWorldBible(data: InsertWorldBible): Promise<WorldBible>;
  getWorldBibleByProject(projectId: number): Promise<WorldBible | undefined>;
  getAllWorldBibles(): Promise<WorldBible[]>;
  updateWorldBible(id: number, data: Partial<WorldBible>): Promise<WorldBible | undefined>;

  createThoughtLog(data: InsertThoughtLog): Promise<ThoughtLog>;
  getThoughtLogsByProject(projectId: number): Promise<ThoughtLog[]>;
  getAllThoughtLogs(): Promise<ThoughtLog[]>;

  createAgentStatus(data: InsertAgentStatus): Promise<AgentStatus>;
  getAgentStatusesByProject(projectId: number): Promise<AgentStatus[]>;
  updateAgentStatus(projectId: number, agentName: string, data: Partial<AgentStatus>): Promise<AgentStatus | undefined>;

  createSeries(data: InsertSeries): Promise<Series>;
  getSeries(id: number): Promise<Series | undefined>;
  getAllSeries(): Promise<Series[]>;
  updateSeries(id: number, data: Partial<Series>): Promise<Series | undefined>;
  deleteSeries(id: number): Promise<void>;
  getProjectsBySeries(seriesId: number): Promise<Project[]>;

  createContinuitySnapshot(data: InsertContinuitySnapshot): Promise<ContinuitySnapshot>;
  getContinuitySnapshotByProject(projectId: number): Promise<ContinuitySnapshot | undefined>;
  updateContinuitySnapshot(id: number, data: Partial<ContinuitySnapshot>): Promise<ContinuitySnapshot | undefined>;
  getSeriesContinuitySnapshots(seriesId: number): Promise<ContinuitySnapshot[]>;
  getSeriesFullContinuity(seriesId: number): Promise<{
    projectSnapshots: ContinuitySnapshot[];
    manuscriptSnapshots: Array<{ manuscriptId: number; title: string; seriesOrder: number | null; snapshot: any }>;
  }>;
  getAllContinuitySnapshots(): Promise<ContinuitySnapshot[]>;

  createImportedManuscript(data: InsertImportedManuscript): Promise<ImportedManuscript>;
  getImportedManuscript(id: number): Promise<ImportedManuscript | undefined>;
  getAllImportedManuscripts(): Promise<ImportedManuscript[]>;
  getImportedManuscriptsBySeries(seriesId: number): Promise<ImportedManuscript[]>;
  updateImportedManuscript(id: number, data: Partial<ImportedManuscript>): Promise<ImportedManuscript | undefined>;
  deleteImportedManuscript(id: number): Promise<void>;

  createImportedChapter(data: InsertImportedChapter): Promise<ImportedChapter>;
  getImportedChaptersByManuscript(manuscriptId: number): Promise<ImportedChapter[]>;
  getImportedChapter(id: number): Promise<ImportedChapter | undefined>;
  updateImportedChapter(id: number, data: Partial<ImportedChapter>): Promise<ImportedChapter | undefined>;

  createExtendedGuide(data: InsertExtendedGuide): Promise<ExtendedGuide>;
  getExtendedGuide(id: number): Promise<ExtendedGuide | undefined>;
  getAllExtendedGuides(): Promise<ExtendedGuide[]>;
  updateExtendedGuide(id: number, data: Partial<ExtendedGuide>): Promise<ExtendedGuide | undefined>;
  deleteExtendedGuide(id: number): Promise<void>;

  createActivityLog(data: InsertActivityLog): Promise<ActivityLog>;
  getActivityLogsByProject(projectId: number | null, limit?: number): Promise<ActivityLog[]>;
  getLastActivityLogTime(projectId: number): Promise<Date | null>;
  cleanupOldActivityLogs(projectId: number | null, keepCount: number): Promise<void>;

  // Project Queue operations
  addToQueue(data: InsertProjectQueueItem): Promise<ProjectQueueItem>;
  getQueueItems(): Promise<ProjectQueueItem[]>;
  getQueueItem(id: number): Promise<ProjectQueueItem | undefined>;
  getQueueItemByProject(projectId: number): Promise<ProjectQueueItem | undefined>;
  updateQueueItem(id: number, data: Partial<ProjectQueueItem>): Promise<ProjectQueueItem | undefined>;
  removeFromQueue(id: number): Promise<void>;
  reorderQueue(itemId: number, newPosition: number): Promise<void>;
  getNextInQueue(): Promise<ProjectQueueItem | undefined>;
  
  // Queue State operations
  getQueueState(): Promise<QueueState | undefined>;
  updateQueueState(data: Partial<QueueState>): Promise<QueueState>;
  
  // Series Arc Milestones
  createMilestone(data: InsertSeriesArcMilestone): Promise<SeriesArcMilestone>;
  getMilestonesBySeries(seriesId: number): Promise<SeriesArcMilestone[]>;
  updateMilestone(id: number, data: Partial<SeriesArcMilestone>): Promise<SeriesArcMilestone | undefined>;
  deleteMilestone(id: number): Promise<void>;
  
  // Series Plot Threads
  createPlotThread(data: InsertSeriesPlotThread): Promise<SeriesPlotThread>;
  getPlotThreadsBySeries(seriesId: number): Promise<SeriesPlotThread[]>;
  updatePlotThread(id: number, data: Partial<SeriesPlotThread>): Promise<SeriesPlotThread | undefined>;
  deletePlotThread(id: number): Promise<void>;
  
  // Series Arc Verifications
  createArcVerification(data: InsertSeriesArcVerification): Promise<SeriesArcVerification>;
  getArcVerificationsBySeries(seriesId: number): Promise<SeriesArcVerification[]>;
  getArcVerificationByProject(projectId: number): Promise<SeriesArcVerification | undefined>;
  updateArcVerification(id: number, data: Partial<SeriesArcVerification>): Promise<SeriesArcVerification | undefined>;

  // Translations
  createTranslation(data: InsertTranslation): Promise<Translation>;
  getTranslation(id: number): Promise<Translation | undefined>;
  getAllTranslations(): Promise<Translation[]>;
  getTranslationsByProject(projectId: number): Promise<Translation[]>;
  deleteTranslation(id: number): Promise<void>;

  // Reedit Projects - Full manuscript re-editing pipeline
  createReeditProject(data: InsertReeditProject): Promise<ReeditProject>;
  getReeditProject(id: number): Promise<ReeditProject | undefined>;
  getAllReeditProjects(): Promise<ReeditProject[]>;
  updateReeditProject(id: number, data: Partial<ReeditProject>): Promise<ReeditProject | undefined>;
  deleteReeditProject(id: number): Promise<void>;

  // Reedit Chapters
  createReeditChapter(data: InsertReeditChapter): Promise<ReeditChapter>;
  createReeditChapterIfNotExists(data: InsertReeditChapter): Promise<ReeditChapter>;
  getAllReeditChapters(): Promise<ReeditChapter[]>;
  getReeditChaptersByProject(projectId: number): Promise<ReeditChapter[]>;
  getReeditChapter(id: number): Promise<ReeditChapter | undefined>;
  getReeditChapterByOriginalNumber(projectId: number, originalChapterNumber: number): Promise<ReeditChapter | undefined>;
  updateReeditChapter(id: number, data: Partial<ReeditChapter>): Promise<ReeditChapter | undefined>;
  deleteReeditChaptersByProject(projectId: number): Promise<void>;

  // Reedit Audit Reports
  createReeditAuditReport(data: InsertReeditAuditReport): Promise<ReeditAuditReport>;
  getReeditAuditReportsByProject(projectId: number): Promise<ReeditAuditReport[]>;
  getReeditAuditReportByType(projectId: number, auditType: string): Promise<ReeditAuditReport | undefined>;
  getReeditAuditReportByTypeAndRange(projectId: number, auditType: string, chapterRange: string): Promise<ReeditAuditReport | undefined>;
  deleteReeditAuditReportsByType(projectId: number, auditType: string): Promise<void>;

  // Reedit World Bibles
  createReeditWorldBible(data: InsertReeditWorldBible): Promise<ReeditWorldBible>;
  getReeditWorldBibleByProject(projectId: number): Promise<ReeditWorldBible | undefined>;
  updateReeditWorldBible(id: number, data: Partial<ReeditWorldBible>): Promise<ReeditWorldBible | undefined>;
  deleteReeditWorldBible(projectId: number): Promise<void>;

  // Reedit Issues (problem tracking with status)
  createReeditIssue(data: InsertReeditIssue): Promise<ReeditIssue>;
  getReeditIssuesByProject(projectId: number): Promise<ReeditIssue[]>;
  getReeditIssuesByChapter(projectId: number, chapterNumber: number): Promise<ReeditIssue[]>;
  getReeditIssuesByStatus(projectId: number, status: string): Promise<ReeditIssue[]>;
  updateReeditIssue(id: number, data: Partial<ReeditIssue>): Promise<ReeditIssue | undefined>;
  approveReeditIssue(id: number): Promise<ReeditIssue | undefined>;
  rejectReeditIssue(id: number, reason?: string): Promise<ReeditIssue | undefined>;
  resolveReeditIssue(id: number): Promise<ReeditIssue | undefined>;
  deleteReeditIssuesByProject(projectId: number): Promise<void>;
  getApprovedPendingIssues(projectId: number): Promise<ReeditIssue[]>;

  // Chat Sessions
  createChatSession(data: InsertChatSession): Promise<ChatSession>;
  getChatSession(id: number): Promise<ChatSession | undefined>;
  getChatSessionsByProject(projectId: number, agentType: string): Promise<ChatSession[]>;
  getChatSessionsByReeditProject(reeditProjectId: number, agentType: string): Promise<ChatSession[]>;
  updateChatSession(id: number, data: Partial<ChatSession>): Promise<ChatSession | undefined>;
  deleteChatSession(id: number): Promise<void>;

  // Chat Messages
  createChatMessage(data: InsertChatMessage): Promise<ChatMessage>;
  getChatMessagesBySession(sessionId: number): Promise<ChatMessage[]>;
  updateChatMessage(id: number, data: Partial<ChatMessage>): Promise<ChatMessage | undefined>;
  deleteChatMessage(id: number): Promise<void>;

  // Chat Proposals
  createChatProposal(data: InsertChatProposal): Promise<ChatProposal>;
  getChatProposal(id: number): Promise<ChatProposal | undefined>;
  getChatProposalsBySession(sessionId: number): Promise<ChatProposal[]>;
  getChatProposalsByMessage(messageId: number): Promise<ChatProposal[]>;
  updateChatProposal(id: number, data: Partial<ChatProposal>): Promise<ChatProposal | undefined>;
  deleteChatProposal(id: number): Promise<void>;

  // LitAgents 2.0: Plot Threads for Narrative Director
  createPlotThread(data: InsertPlotThread): Promise<PlotThread>;
  getPlotThreadsByProject(projectId: number): Promise<PlotThread[]>;
  updatePlotThread(id: number, data: Partial<PlotThread>): Promise<PlotThread | undefined>;
  deletePlotThreadsByProject(projectId: number): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  async createPseudonym(data: InsertPseudonym): Promise<Pseudonym> {
    const [pseudonym] = await db.insert(pseudonyms).values(data).returning();
    return pseudonym;
  }

  async getPseudonym(id: number): Promise<Pseudonym | undefined> {
    const [pseudonym] = await db.select().from(pseudonyms).where(eq(pseudonyms.id, id));
    return pseudonym;
  }

  async getAllPseudonyms(): Promise<Pseudonym[]> {
    return db.select().from(pseudonyms).orderBy(desc(pseudonyms.createdAt));
  }

  async updatePseudonym(id: number, data: Partial<Pseudonym>): Promise<Pseudonym | undefined> {
    const [updated] = await db.update(pseudonyms).set(data).where(eq(pseudonyms.id, id)).returning();
    return updated;
  }

  async deletePseudonym(id: number): Promise<void> {
    await db.delete(pseudonyms).where(eq(pseudonyms.id, id));
  }

  async createStyleGuide(data: InsertStyleGuide): Promise<StyleGuide> {
    const [guide] = await db.insert(styleGuides).values(data).returning();
    return guide;
  }

  async getStyleGuide(id: number): Promise<StyleGuide | undefined> {
    const [guide] = await db.select().from(styleGuides).where(eq(styleGuides.id, id));
    return guide;
  }

  async getStyleGuidesByPseudonym(pseudonymId: number): Promise<StyleGuide[]> {
    return db.select().from(styleGuides).where(eq(styleGuides.pseudonymId, pseudonymId)).orderBy(desc(styleGuides.createdAt));
  }

  async getAllStyleGuides(): Promise<StyleGuide[]> {
    return db.select().from(styleGuides).orderBy(desc(styleGuides.createdAt));
  }

  async updateStyleGuide(id: number, data: Partial<StyleGuide>): Promise<StyleGuide | undefined> {
    const [updated] = await db.update(styleGuides).set(data).where(eq(styleGuides.id, id)).returning();
    return updated;
  }

  async deleteStyleGuide(id: number): Promise<void> {
    await db.delete(styleGuides).where(eq(styleGuides.id, id));
  }

  async createProject(data: InsertProject): Promise<Project> {
    const [project] = await db.insert(projects).values(data).returning();
    return project;
  }

  async getProject(id: number): Promise<Project | undefined> {
    const [project] = await db.select().from(projects).where(eq(projects.id, id));
    return project;
  }

  async getAllProjects(): Promise<Project[]> {
    return db.select().from(projects).orderBy(desc(projects.createdAt));
  }

  async updateProject(id: number, data: Partial<Project>): Promise<Project | undefined> {
    const [updated] = await db.update(projects).set(data).where(eq(projects.id, id)).returning();
    return updated;
  }

  async deleteProject(id: number): Promise<void> {
    await db.delete(projects).where(eq(projects.id, id));
  }

  async createChapter(data: InsertChapter): Promise<Chapter> {
    const [chapter] = await db.insert(chapters).values(data).returning();
    return chapter;
  }

  async getChaptersByProject(projectId: number): Promise<Chapter[]> {
    return db.select().from(chapters).where(eq(chapters.projectId, projectId)).orderBy(chapters.chapterNumber);
  }

  async getAllChapters(): Promise<Chapter[]> {
    return db.select().from(chapters).orderBy(chapters.projectId, chapters.chapterNumber);
  }

  async updateChapter(id: number, data: Partial<Chapter>): Promise<Chapter | undefined> {
    const [updated] = await db.update(chapters).set(data).where(eq(chapters.id, id)).returning();
    return updated;
  }

  async deleteChapter(id: number): Promise<void> {
    await db.delete(chapters).where(eq(chapters.id, id));
  }

  async createWorldBible(data: InsertWorldBible): Promise<WorldBible> {
    const [worldBible] = await db.insert(worldBibles).values(data).returning();
    return worldBible;
  }

  async getWorldBibleByProject(projectId: number): Promise<WorldBible | undefined> {
    const [worldBible] = await db.select().from(worldBibles).where(eq(worldBibles.projectId, projectId));
    return worldBible;
  }

  async getAllWorldBibles(): Promise<WorldBible[]> {
    return db.select().from(worldBibles);
  }

  async updateWorldBible(id: number, data: Partial<WorldBible>): Promise<WorldBible | undefined> {
    const [updated] = await db.update(worldBibles).set({
      ...data,
      updatedAt: new Date(),
    }).where(eq(worldBibles.id, id)).returning();
    return updated;
  }

  async createThoughtLog(data: InsertThoughtLog): Promise<ThoughtLog> {
    const [log] = await db.insert(thoughtLogs).values(data).returning();
    return log;
  }

  async getThoughtLogsByProject(projectId: number): Promise<ThoughtLog[]> {
    return db.select().from(thoughtLogs).where(eq(thoughtLogs.projectId, projectId)).orderBy(desc(thoughtLogs.createdAt));
  }

  async getAllThoughtLogs(): Promise<ThoughtLog[]> {
    return db.select().from(thoughtLogs).orderBy(desc(thoughtLogs.createdAt));
  }

  async createAgentStatus(data: InsertAgentStatus): Promise<AgentStatus> {
    const [status] = await db.insert(agentStatuses).values(data).returning();
    return status;
  }

  async getAgentStatusesByProject(projectId: number): Promise<AgentStatus[]> {
    return db.select().from(agentStatuses).where(eq(agentStatuses.projectId, projectId));
  }

  async updateAgentStatus(projectId: number, agentName: string, data: Partial<AgentStatus>): Promise<AgentStatus | undefined> {
    const [existing] = await db.select().from(agentStatuses)
      .where(and(eq(agentStatuses.projectId, projectId), eq(agentStatuses.agentName, agentName)));
    
    if (!existing) {
      const [created] = await db.insert(agentStatuses).values({
        projectId,
        agentName,
        ...data,
      } as InsertAgentStatus).returning();
      return created;
    }

    const [updated] = await db.update(agentStatuses).set({
      ...data,
      lastActivity: new Date(),
    }).where(eq(agentStatuses.id, existing.id)).returning();
    return updated;
  }

  async createSeries(data: InsertSeries): Promise<Series> {
    const [newSeries] = await db.insert(series).values(data).returning();
    return newSeries;
  }

  async getSeries(id: number): Promise<Series | undefined> {
    const [foundSeries] = await db.select().from(series).where(eq(series.id, id));
    return foundSeries;
  }

  async getAllSeries(): Promise<Series[]> {
    return db.select().from(series).orderBy(desc(series.createdAt));
  }

  async updateSeries(id: number, data: Partial<Series>): Promise<Series | undefined> {
    const [updated] = await db.update(series).set(data).where(eq(series.id, id)).returning();
    return updated;
  }

  async deleteSeries(id: number): Promise<void> {
    await db.delete(series).where(eq(series.id, id));
  }

  async getProjectsBySeries(seriesId: number): Promise<Project[]> {
    return db.select().from(projects)
      .where(eq(projects.seriesId, seriesId))
      .orderBy(projects.seriesOrder);
  }

  async createContinuitySnapshot(data: InsertContinuitySnapshot): Promise<ContinuitySnapshot> {
    const [snapshot] = await db.insert(continuitySnapshots).values(data).returning();
    return snapshot;
  }

  async getContinuitySnapshotByProject(projectId: number): Promise<ContinuitySnapshot | undefined> {
    const [snapshot] = await db.select().from(continuitySnapshots).where(eq(continuitySnapshots.projectId, projectId));
    return snapshot;
  }

  async updateContinuitySnapshot(id: number, data: Partial<ContinuitySnapshot>): Promise<ContinuitySnapshot | undefined> {
    const [updated] = await db.update(continuitySnapshots).set({
      ...data,
      updatedAt: new Date(),
    }).where(eq(continuitySnapshots.id, id)).returning();
    return updated;
  }

  async getSeriesContinuitySnapshots(seriesId: number): Promise<ContinuitySnapshot[]> {
    const seriesProjects = await this.getProjectsBySeries(seriesId);
    const projectIds = seriesProjects.map(p => p.id);
    
    const snapshots: ContinuitySnapshot[] = [];
    for (const projectId of projectIds) {
      const snapshot = await this.getContinuitySnapshotByProject(projectId);
      if (snapshot) snapshots.push(snapshot);
    }
    return snapshots;
  }

  async getSeriesFullContinuity(seriesId: number): Promise<{
    projectSnapshots: ContinuitySnapshot[];
    manuscriptSnapshots: Array<{ manuscriptId: number; title: string; seriesOrder: number | null; snapshot: any }>;
  }> {
    const projectSnapshots = await this.getSeriesContinuitySnapshots(seriesId);
    const manuscripts = await this.getImportedManuscriptsBySeries(seriesId);
    
    const manuscriptSnapshots = manuscripts
      .filter(m => m.continuitySnapshot)
      .map(m => ({
        manuscriptId: m.id,
        title: m.title,
        seriesOrder: m.seriesOrder,
        snapshot: m.continuitySnapshot,
      }));
    
    return { projectSnapshots, manuscriptSnapshots };
  }

  async getAllContinuitySnapshots(): Promise<ContinuitySnapshot[]> {
    return db.select().from(continuitySnapshots);
  }

  async createImportedManuscript(data: InsertImportedManuscript): Promise<ImportedManuscript> {
    const [manuscript] = await db.insert(importedManuscripts).values(data).returning();
    return manuscript;
  }

  async getImportedManuscript(id: number): Promise<ImportedManuscript | undefined> {
    const [manuscript] = await db.select().from(importedManuscripts).where(eq(importedManuscripts.id, id));
    return manuscript;
  }

  async getAllImportedManuscripts(): Promise<ImportedManuscript[]> {
    return db.select().from(importedManuscripts).orderBy(desc(importedManuscripts.createdAt));
  }

  async getImportedManuscriptsBySeries(seriesId: number): Promise<ImportedManuscript[]> {
    return db.select().from(importedManuscripts)
      .where(eq(importedManuscripts.seriesId, seriesId))
      .orderBy(importedManuscripts.seriesOrder);
  }

  async updateImportedManuscript(id: number, data: Partial<ImportedManuscript>): Promise<ImportedManuscript | undefined> {
    const [updated] = await db.update(importedManuscripts).set(data).where(eq(importedManuscripts.id, id)).returning();
    return updated;
  }

  async deleteImportedManuscript(id: number): Promise<void> {
    await db.delete(importedManuscripts).where(eq(importedManuscripts.id, id));
  }

  async createImportedChapter(data: InsertImportedChapter): Promise<ImportedChapter> {
    const [chapter] = await db.insert(importedChapters).values(data).returning();
    return chapter;
  }

  async getImportedChaptersByManuscript(manuscriptId: number): Promise<ImportedChapter[]> {
    return db.select().from(importedChapters)
      .where(eq(importedChapters.manuscriptId, manuscriptId))
      .orderBy(importedChapters.chapterNumber);
  }

  async getImportedChapter(id: number): Promise<ImportedChapter | undefined> {
    const [chapter] = await db.select().from(importedChapters).where(eq(importedChapters.id, id));
    return chapter;
  }

  async updateImportedChapter(id: number, data: Partial<ImportedChapter>): Promise<ImportedChapter | undefined> {
    const [updated] = await db.update(importedChapters).set(data).where(eq(importedChapters.id, id)).returning();
    return updated;
  }

  async createExtendedGuide(data: InsertExtendedGuide): Promise<ExtendedGuide> {
    const [guide] = await db.insert(extendedGuides).values(data).returning();
    return guide;
  }

  async getExtendedGuide(id: number): Promise<ExtendedGuide | undefined> {
    const [guide] = await db.select().from(extendedGuides).where(eq(extendedGuides.id, id));
    return guide;
  }

  async getAllExtendedGuides(): Promise<ExtendedGuide[]> {
    return db.select().from(extendedGuides).orderBy(desc(extendedGuides.createdAt));
  }

  async updateExtendedGuide(id: number, data: Partial<ExtendedGuide>): Promise<ExtendedGuide | undefined> {
    const [updated] = await db.update(extendedGuides).set(data).where(eq(extendedGuides.id, id)).returning();
    return updated;
  }

  async deleteExtendedGuide(id: number): Promise<void> {
    await db.delete(extendedGuides).where(eq(extendedGuides.id, id));
  }

  async createActivityLog(data: InsertActivityLog): Promise<ActivityLog> {
    const [log] = await db.insert(activityLogs).values(data).returning();
    return log;
  }

  async getActivityLogsByProject(projectId: number | null, limit: number = 500): Promise<ActivityLog[]> {
    if (projectId === null) {
      return db.select().from(activityLogs)
        .where(isNull(activityLogs.projectId))
        .orderBy(desc(activityLogs.createdAt))
        .limit(limit);
    }
    return db.select().from(activityLogs)
      .where(or(eq(activityLogs.projectId, projectId), isNull(activityLogs.projectId)))
      .orderBy(desc(activityLogs.createdAt))
      .limit(limit);
  }

  async getLastActivityLogTime(projectId: number): Promise<Date | null> {
    const [log] = await db.select({ createdAt: activityLogs.createdAt })
      .from(activityLogs)
      .where(eq(activityLogs.projectId, projectId))
      .orderBy(desc(activityLogs.createdAt))
      .limit(1);
    return log?.createdAt ?? null;
  }

  async cleanupOldActivityLogs(projectId: number | null, keepCount: number = 1000): Promise<void> {
    const condition = projectId === null 
      ? isNull(activityLogs.projectId)
      : eq(activityLogs.projectId, projectId);
    
    const logs = await db.select({ id: activityLogs.id }).from(activityLogs)
      .where(condition)
      .orderBy(desc(activityLogs.createdAt))
      .offset(keepCount);
    
    if (logs.length > 0) {
      const idsToDelete = logs.map(l => l.id);
      for (const id of idsToDelete) {
        await db.delete(activityLogs).where(eq(activityLogs.id, id));
      }
    }
  }

  // Project Queue operations
  async addToQueue(data: InsertProjectQueueItem): Promise<ProjectQueueItem> {
    // Get max position to add at end
    const items = await db.select({ position: projectQueue.position })
      .from(projectQueue)
      .orderBy(desc(projectQueue.position))
      .limit(1);
    const maxPosition = items.length > 0 ? items[0].position : 0;
    // Use maxPosition + 1 if position is 0, null, or undefined
    const newPosition = (data.position && data.position > 0) ? data.position : maxPosition + 1;
    const [item] = await db.insert(projectQueue).values({
      ...data,
      position: newPosition
    }).returning();
    return item;
  }

  async getQueueItems(): Promise<ProjectQueueItem[]> {
    return db.select().from(projectQueue).orderBy(asc(projectQueue.position));
  }

  async getQueueItem(id: number): Promise<ProjectQueueItem | undefined> {
    const [item] = await db.select().from(projectQueue).where(eq(projectQueue.id, id));
    return item;
  }

  async getQueueItemByProject(projectId: number): Promise<ProjectQueueItem | undefined> {
    const [item] = await db.select().from(projectQueue).where(eq(projectQueue.projectId, projectId));
    return item;
  }

  async updateQueueItem(id: number, data: Partial<ProjectQueueItem>): Promise<ProjectQueueItem | undefined> {
    const [updated] = await db.update(projectQueue).set(data).where(eq(projectQueue.id, id)).returning();
    return updated;
  }

  async removeFromQueue(id: number): Promise<void> {
    const item = await this.getQueueItem(id);
    if (!item) return;
    
    await db.delete(projectQueue).where(eq(projectQueue.id, id));
    
    // Reorder remaining items
    await db.update(projectQueue)
      .set({ position: sql`${projectQueue.position} - 1` })
      .where(sql`${projectQueue.position} > ${item.position}`);
  }

  async reorderQueue(itemId: number, newPosition: number): Promise<void> {
    const item = await this.getQueueItem(itemId);
    if (!item) return;
    
    const oldPosition = item.position;
    if (oldPosition === newPosition) return;
    
    if (newPosition > oldPosition) {
      // Moving down: shift items between old and new up
      await db.update(projectQueue)
        .set({ position: sql`${projectQueue.position} - 1` })
        .where(and(
          sql`${projectQueue.position} > ${oldPosition}`,
          sql`${projectQueue.position} <= ${newPosition}`
        ));
    } else {
      // Moving up: shift items between new and old down
      await db.update(projectQueue)
        .set({ position: sql`${projectQueue.position} + 1` })
        .where(and(
          sql`${projectQueue.position} >= ${newPosition}`,
          sql`${projectQueue.position} < ${oldPosition}`
        ));
    }
    
    await db.update(projectQueue)
      .set({ position: newPosition })
      .where(eq(projectQueue.id, itemId));
  }

  async getNextInQueue(): Promise<ProjectQueueItem | undefined> {
    const [item] = await db.select().from(projectQueue)
      .where(eq(projectQueue.status, "waiting"))
      .orderBy(asc(projectQueue.position))
      .limit(1);
    return item;
  }

  // Queue State operations
  async getQueueState(): Promise<QueueState | undefined> {
    const [state] = await db.select().from(queueState).limit(1);
    return state;
  }

  async updateQueueState(data: Partial<QueueState>): Promise<QueueState> {
    const existing = await this.getQueueState();
    if (existing) {
      const [updated] = await db.update(queueState)
        .set({ ...data, updatedAt: sql`CURRENT_TIMESTAMP` })
        .where(eq(queueState.id, existing.id))
        .returning();
      return updated;
    } else {
      const [created] = await db.insert(queueState).values({
        status: data.status || "stopped",
        autoAdvance: data.autoAdvance ?? true,
        skipOnError: data.skipOnError ?? true,
        pauseAfterEach: data.pauseAfterEach ?? false,
        currentProjectId: data.currentProjectId || null,
      }).returning();
      return created;
    }
  }

  // Series Arc Milestones
  async createMilestone(data: InsertSeriesArcMilestone): Promise<SeriesArcMilestone> {
    const [milestone] = await db.insert(seriesArcMilestones).values(data).returning();
    return milestone;
  }

  async getMilestonesBySeries(seriesId: number): Promise<SeriesArcMilestone[]> {
    return db.select().from(seriesArcMilestones)
      .where(eq(seriesArcMilestones.seriesId, seriesId))
      .orderBy(asc(seriesArcMilestones.volumeNumber), asc(seriesArcMilestones.id));
  }

  async updateMilestone(id: number, data: Partial<SeriesArcMilestone>): Promise<SeriesArcMilestone | undefined> {
    const [updated] = await db.update(seriesArcMilestones).set(data).where(eq(seriesArcMilestones.id, id)).returning();
    return updated;
  }

  async deleteMilestone(id: number): Promise<void> {
    await db.delete(seriesArcMilestones).where(eq(seriesArcMilestones.id, id));
  }

  // Series Plot Threads
  async createPlotThread(data: InsertSeriesPlotThread): Promise<SeriesPlotThread> {
    const [thread] = await db.insert(seriesPlotThreads).values(data).returning();
    return thread;
  }

  async getPlotThreadsBySeries(seriesId: number): Promise<SeriesPlotThread[]> {
    return db.select().from(seriesPlotThreads)
      .where(eq(seriesPlotThreads.seriesId, seriesId))
      .orderBy(asc(seriesPlotThreads.introducedVolume), asc(seriesPlotThreads.id));
  }

  async updatePlotThread(id: number, data: Partial<SeriesPlotThread>): Promise<SeriesPlotThread | undefined> {
    const [updated] = await db.update(seriesPlotThreads).set(data).where(eq(seriesPlotThreads.id, id)).returning();
    return updated;
  }

  async deletePlotThread(id: number): Promise<void> {
    await db.delete(seriesPlotThreads).where(eq(seriesPlotThreads.id, id));
  }

  // Series Arc Verifications
  async createArcVerification(data: InsertSeriesArcVerification): Promise<SeriesArcVerification> {
    const [verification] = await db.insert(seriesArcVerifications).values(data).returning();
    return verification;
  }

  async getArcVerificationsBySeries(seriesId: number): Promise<SeriesArcVerification[]> {
    return db.select().from(seriesArcVerifications)
      .where(eq(seriesArcVerifications.seriesId, seriesId))
      .orderBy(desc(seriesArcVerifications.verificationDate));
  }

  async getArcVerificationByProject(projectId: number): Promise<SeriesArcVerification | undefined> {
    const [verification] = await db.select().from(seriesArcVerifications)
      .where(eq(seriesArcVerifications.projectId, projectId));
    return verification;
  }

  async updateArcVerification(id: number, data: Partial<SeriesArcVerification>): Promise<SeriesArcVerification | undefined> {
    const [updated] = await db.update(seriesArcVerifications).set(data).where(eq(seriesArcVerifications.id, id)).returning();
    return updated;
  }

  // Translations
  async createTranslation(data: InsertTranslation): Promise<Translation> {
    const [translation] = await db.insert(translations).values(data).returning();
    return translation;
  }

  async getTranslation(id: number): Promise<Translation | undefined> {
    const [translation] = await db.select().from(translations).where(eq(translations.id, id));
    return translation;
  }

  async getAllTranslations(): Promise<Translation[]> {
    return db.select().from(translations).orderBy(desc(translations.createdAt));
  }

  async getTranslationsByProject(projectId: number): Promise<Translation[]> {
    return db.select().from(translations)
      .where(eq(translations.projectId, projectId))
      .orderBy(desc(translations.createdAt));
  }

  async deleteTranslation(id: number): Promise<void> {
    await db.delete(translations).where(eq(translations.id, id));
  }

  async findExistingTranslation(projectId: number, targetLanguage: string): Promise<Translation | undefined> {
    const [translation] = await db.select().from(translations)
      .where(and(
        eq(translations.projectId, projectId),
        eq(translations.targetLanguage, targetLanguage)
      ));
    return translation;
  }

  async updateTranslation(id: number, data: Partial<Translation>): Promise<Translation | undefined> {
    const [updated] = await db.update(translations).set(data).where(eq(translations.id, id)).returning();
    return updated;
  }

  // AI Usage Events for cost tracking
  async createAiUsageEvent(data: InsertAiUsageEvent): Promise<AiUsageEvent> {
    const [event] = await db.insert(aiUsageEvents).values(data).returning();
    return event;
  }

  async getAllAiUsageEvents(): Promise<AiUsageEvent[]> {
    return db.select().from(aiUsageEvents).orderBy(desc(aiUsageEvents.createdAt));
  }

  async getAiUsageEventsByProject(projectId: number): Promise<AiUsageEvent[]> {
    return db.select().from(aiUsageEvents)
      .where(eq(aiUsageEvents.projectId, projectId))
      .orderBy(desc(aiUsageEvents.createdAt));
  }

  async getAiUsageEventsByDateRange(startDate: Date, endDate: Date): Promise<AiUsageEvent[]> {
    return db.select().from(aiUsageEvents)
      .where(and(
        sql`${aiUsageEvents.createdAt} >= ${startDate}`,
        sql`${aiUsageEvents.createdAt} <= ${endDate}`
      ))
      .orderBy(desc(aiUsageEvents.createdAt));
  }

  async getAiUsageSummary(): Promise<{
    totalInputTokens: number;
    totalOutputTokens: number;
    totalThinkingTokens: number;
    totalCostUsd: number;
    eventCount: number;
  }> {
    const result = await db.select({
      totalInputTokens: sql<number>`COALESCE(SUM(${aiUsageEvents.inputTokens}), 0)`,
      totalOutputTokens: sql<number>`COALESCE(SUM(${aiUsageEvents.outputTokens}), 0)`,
      totalThinkingTokens: sql<number>`COALESCE(SUM(${aiUsageEvents.thinkingTokens}), 0)`,
      totalCostUsd: sql<number>`COALESCE(SUM(CAST(${aiUsageEvents.totalCostUsd} AS numeric)), 0)`,
      eventCount: sql<number>`COUNT(*)`,
    }).from(aiUsageEvents);
    
    return result[0] || {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalThinkingTokens: 0,
      totalCostUsd: 0,
      eventCount: 0,
    };
  }

  async getAiUsageByAgent(): Promise<Array<{
    agentName: string;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCostUsd: number;
    eventCount: number;
  }>> {
    return db.select({
      agentName: aiUsageEvents.agentName,
      totalInputTokens: sql<number>`COALESCE(SUM(${aiUsageEvents.inputTokens}), 0)`,
      totalOutputTokens: sql<number>`COALESCE(SUM(${aiUsageEvents.outputTokens}), 0)`,
      totalCostUsd: sql<number>`COALESCE(SUM(CAST(${aiUsageEvents.totalCostUsd} AS numeric)), 0)`,
      eventCount: sql<number>`COUNT(*)`,
    }).from(aiUsageEvents)
      .groupBy(aiUsageEvents.agentName)
      .orderBy(sql`SUM(CAST(${aiUsageEvents.totalCostUsd} AS numeric)) DESC`);
  }

  async getAiUsageByDay(): Promise<Array<{
    date: string;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCostUsd: number;
    eventCount: number;
  }>> {
    return db.select({
      date: sql<string>`DATE(${aiUsageEvents.createdAt})`,
      totalInputTokens: sql<number>`COALESCE(SUM(${aiUsageEvents.inputTokens}), 0)`,
      totalOutputTokens: sql<number>`COALESCE(SUM(${aiUsageEvents.outputTokens}), 0)`,
      totalCostUsd: sql<number>`COALESCE(SUM(CAST(${aiUsageEvents.totalCostUsd} AS numeric)), 0)`,
      eventCount: sql<number>`COUNT(*)`,
    }).from(aiUsageEvents)
      .groupBy(sql`DATE(${aiUsageEvents.createdAt})`)
      .orderBy(sql`DATE(${aiUsageEvents.createdAt}) DESC`)
      .limit(30);
  }

  async getAiUsageByModel(): Promise<Array<{
    model: string;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalThinkingTokens: number;
    totalCostUsd: number;
    eventCount: number;
  }>> {
    return db.select({
      model: aiUsageEvents.model,
      totalInputTokens: sql<number>`COALESCE(SUM(${aiUsageEvents.inputTokens}), 0)`,
      totalOutputTokens: sql<number>`COALESCE(SUM(${aiUsageEvents.outputTokens}), 0)`,
      totalThinkingTokens: sql<number>`COALESCE(SUM(${aiUsageEvents.thinkingTokens}), 0)`,
      totalCostUsd: sql<number>`COALESCE(SUM(CAST(${aiUsageEvents.totalCostUsd} AS numeric)), 0)`,
      eventCount: sql<number>`COUNT(*)`,
    }).from(aiUsageEvents)
      .groupBy(aiUsageEvents.model)
      .orderBy(sql`SUM(CAST(${aiUsageEvents.totalCostUsd} AS numeric)) DESC`);
  }

  // Reedit Projects - Full manuscript re-editing pipeline
  async createReeditProject(data: InsertReeditProject): Promise<ReeditProject> {
    const [project] = await db.insert(reeditProjects).values(data).returning();
    return project;
  }

  async getReeditProject(id: number): Promise<ReeditProject | undefined> {
    const [project] = await db.select().from(reeditProjects).where(eq(reeditProjects.id, id));
    return project;
  }

  async getAllReeditProjects(): Promise<ReeditProject[]> {
    return db.select().from(reeditProjects).orderBy(desc(reeditProjects.createdAt));
  }

  async updateReeditProject(id: number, data: Partial<ReeditProject>): Promise<ReeditProject | undefined> {
    const [updated] = await db.update(reeditProjects).set(data).where(eq(reeditProjects.id, id)).returning();
    return updated;
  }

  async deleteReeditProject(id: number): Promise<void> {
    await db.delete(reeditProjects).where(eq(reeditProjects.id, id));
  }

  // Reedit Chapters
  async createReeditChapter(data: InsertReeditChapter): Promise<ReeditChapter> {
    const [chapter] = await db.insert(reeditChapters).values(data).returning();
    return chapter;
  }

  async createReeditChapterIfNotExists(data: InsertReeditChapter): Promise<ReeditChapter> {
    // Check if chapter with same projectId + originalChapterNumber already exists
    if (data.originalChapterNumber !== undefined && data.originalChapterNumber !== null) {
      const existing = await this.getReeditChapterByOriginalNumber(data.projectId, data.originalChapterNumber);
      if (existing) {
        console.log(`[Storage] Chapter with originalChapterNumber ${data.originalChapterNumber} already exists for project ${data.projectId}, skipping creation`);
        return existing;
      }
    }
    // If no originalChapterNumber, check by chapterNumber as fallback
    const existingByNumber = await db.select().from(reeditChapters)
      .where(and(
        eq(reeditChapters.projectId, data.projectId),
        eq(reeditChapters.chapterNumber, data.chapterNumber)
      ));
    if (existingByNumber.length > 0) {
      console.log(`[Storage] Chapter with chapterNumber ${data.chapterNumber} already exists for project ${data.projectId}, skipping creation`);
      return existingByNumber[0];
    }
    return this.createReeditChapter(data);
  }

  async getAllReeditChapters(): Promise<ReeditChapter[]> {
    return db.select().from(reeditChapters).orderBy(asc(reeditChapters.id));
  }

  async getReeditChaptersByProject(projectId: number): Promise<ReeditChapter[]> {
    return db.select().from(reeditChapters)
      .where(eq(reeditChapters.projectId, projectId))
      .orderBy(asc(reeditChapters.chapterNumber));
  }

  async getReeditChapter(id: number): Promise<ReeditChapter | undefined> {
    const [chapter] = await db.select().from(reeditChapters).where(eq(reeditChapters.id, id));
    return chapter;
  }

  async getReeditChapterByOriginalNumber(projectId: number, originalChapterNumber: number): Promise<ReeditChapter | undefined> {
    const [chapter] = await db.select().from(reeditChapters)
      .where(and(
        eq(reeditChapters.projectId, projectId),
        eq(reeditChapters.originalChapterNumber, originalChapterNumber)
      ));
    return chapter;
  }

  async updateReeditChapter(id: number, data: Partial<ReeditChapter>): Promise<ReeditChapter | undefined> {
    const [updated] = await db.update(reeditChapters).set(data).where(eq(reeditChapters.id, id)).returning();
    return updated;
  }

  async deleteReeditChaptersByProject(projectId: number): Promise<void> {
    await db.delete(reeditChapters).where(eq(reeditChapters.projectId, projectId));
  }

  // Reedit Audit Reports
  async createReeditAuditReport(data: InsertReeditAuditReport): Promise<ReeditAuditReport> {
    const [report] = await db.insert(reeditAuditReports).values(data).returning();
    return report;
  }

  async getReeditAuditReportsByProject(projectId: number): Promise<ReeditAuditReport[]> {
    return db.select().from(reeditAuditReports)
      .where(eq(reeditAuditReports.projectId, projectId))
      .orderBy(desc(reeditAuditReports.createdAt));
  }

  async getReeditAuditReportByType(projectId: number, auditType: string): Promise<ReeditAuditReport | undefined> {
    const [report] = await db.select().from(reeditAuditReports)
      .where(and(
        eq(reeditAuditReports.projectId, projectId),
        eq(reeditAuditReports.auditType, auditType)
      ))
      .orderBy(desc(reeditAuditReports.createdAt))
      .limit(1);
    return report;
  }

  async getReeditAuditReportByTypeAndRange(projectId: number, auditType: string, chapterRange: string): Promise<ReeditAuditReport | undefined> {
    const [report] = await db.select().from(reeditAuditReports)
      .where(and(
        eq(reeditAuditReports.projectId, projectId),
        eq(reeditAuditReports.auditType, auditType),
        eq(reeditAuditReports.chapterRange, chapterRange)
      ))
      .orderBy(desc(reeditAuditReports.createdAt))
      .limit(1);
    return report;
  }

  async deleteReeditAuditReportsByType(projectId: number, auditType: string): Promise<void> {
    await db.delete(reeditAuditReports)
      .where(and(
        eq(reeditAuditReports.projectId, projectId),
        eq(reeditAuditReports.auditType, auditType)
      ));
  }

  // Reedit World Bibles
  async createReeditWorldBible(data: InsertReeditWorldBible): Promise<ReeditWorldBible> {
    const [bible] = await db.insert(reeditWorldBibles).values(data).returning();
    return bible;
  }

  async getReeditWorldBibleByProject(projectId: number): Promise<ReeditWorldBible | undefined> {
    const [bible] = await db.select().from(reeditWorldBibles)
      .where(eq(reeditWorldBibles.projectId, projectId))
      .orderBy(desc(reeditWorldBibles.id))
      .limit(1);
    return bible;
  }

  async updateReeditWorldBible(id: number, data: Partial<ReeditWorldBible>): Promise<ReeditWorldBible | undefined> {
    const [updated] = await db.update(reeditWorldBibles).set(data)
      .where(eq(reeditWorldBibles.id, id)).returning();
    return updated;
  }

  async deleteReeditWorldBible(projectId: number): Promise<void> {
    await db.delete(reeditWorldBibles)
      .where(eq(reeditWorldBibles.projectId, projectId));
  }

  // Reedit Issues
  async createReeditIssue(data: InsertReeditIssue): Promise<ReeditIssue> {
    const [issue] = await db.insert(reeditIssues).values(data).returning();
    return issue;
  }

  async getReeditIssuesByProject(projectId: number): Promise<ReeditIssue[]> {
    return db.select().from(reeditIssues)
      .where(eq(reeditIssues.projectId, projectId))
      .orderBy(asc(reeditIssues.chapterNumber), desc(reeditIssues.severity));
  }

  async getReeditIssuesByChapter(projectId: number, chapterNumber: number): Promise<ReeditIssue[]> {
    return db.select().from(reeditIssues)
      .where(and(
        eq(reeditIssues.projectId, projectId),
        eq(reeditIssues.chapterNumber, chapterNumber)
      ))
      .orderBy(desc(reeditIssues.severity));
  }

  async getReeditIssuesByStatus(projectId: number, status: string): Promise<ReeditIssue[]> {
    return db.select().from(reeditIssues)
      .where(and(
        eq(reeditIssues.projectId, projectId),
        eq(reeditIssues.status, status)
      ))
      .orderBy(asc(reeditIssues.chapterNumber));
  }

  async updateReeditIssue(id: number, data: Partial<ReeditIssue>): Promise<ReeditIssue | undefined> {
    const [updated] = await db.update(reeditIssues)
      .set(data)
      .where(eq(reeditIssues.id, id))
      .returning();
    return updated;
  }

  async approveReeditIssue(id: number): Promise<ReeditIssue | undefined> {
    const [updated] = await db.update(reeditIssues)
      .set({ status: "approved" })
      .where(eq(reeditIssues.id, id))
      .returning();
    return updated;
  }

  async rejectReeditIssue(id: number, reason?: string): Promise<ReeditIssue | undefined> {
    const [updated] = await db.update(reeditIssues)
      .set({ status: "rejected", rejectionReason: reason || null })
      .where(eq(reeditIssues.id, id))
      .returning();
    return updated;
  }

  async resolveReeditIssue(id: number): Promise<ReeditIssue | undefined> {
    const [updated] = await db.update(reeditIssues)
      .set({ status: "resolved", resolvedAt: new Date() })
      .where(eq(reeditIssues.id, id))
      .returning();
    return updated;
  }

  async deleteReeditIssuesByProject(projectId: number): Promise<void> {
    await db.delete(reeditIssues)
      .where(eq(reeditIssues.projectId, projectId));
  }

  async getApprovedPendingIssues(projectId: number): Promise<ReeditIssue[]> {
    return db.select().from(reeditIssues)
      .where(and(
        eq(reeditIssues.projectId, projectId),
        eq(reeditIssues.status, "approved")
      ))
      .orderBy(asc(reeditIssues.chapterNumber));
  }

  // Chat Sessions
  async createChatSession(data: InsertChatSession): Promise<ChatSession> {
    const [session] = await db.insert(chatSessions).values(data).returning();
    return session;
  }

  async getChatSession(id: number): Promise<ChatSession | undefined> {
    const [session] = await db.select().from(chatSessions)
      .where(eq(chatSessions.id, id));
    return session;
  }

  async getChatSessionsByProject(projectId: number, agentType: string): Promise<ChatSession[]> {
    return db.select().from(chatSessions)
      .where(and(
        eq(chatSessions.projectId, projectId),
        eq(chatSessions.agentType, agentType)
      ))
      .orderBy(desc(chatSessions.updatedAt));
  }

  async getChatSessionsByReeditProject(reeditProjectId: number, agentType: string): Promise<ChatSession[]> {
    return db.select().from(chatSessions)
      .where(and(
        eq(chatSessions.reeditProjectId, reeditProjectId),
        eq(chatSessions.agentType, agentType)
      ))
      .orderBy(desc(chatSessions.updatedAt));
  }

  async updateChatSession(id: number, data: Partial<ChatSession>): Promise<ChatSession | undefined> {
    const [updated] = await db.update(chatSessions)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(chatSessions.id, id))
      .returning();
    return updated;
  }

  async deleteChatSession(id: number): Promise<void> {
    await db.delete(chatSessions).where(eq(chatSessions.id, id));
  }

  // Chat Messages
  async createChatMessage(data: InsertChatMessage): Promise<ChatMessage> {
    const [message] = await db.insert(chatMessages).values(data).returning();
    return message;
  }

  async getChatMessagesBySession(sessionId: number): Promise<ChatMessage[]> {
    return db.select().from(chatMessages)
      .where(eq(chatMessages.sessionId, sessionId))
      .orderBy(asc(chatMessages.createdAt));
  }

  async updateChatMessage(id: number, data: Partial<ChatMessage>): Promise<ChatMessage | undefined> {
    const [updated] = await db.update(chatMessages)
      .set(data)
      .where(eq(chatMessages.id, id))
      .returning();
    return updated;
  }

  async deleteChatMessage(id: number): Promise<void> {
    await db.delete(chatMessages).where(eq(chatMessages.id, id));
  }

  // Chat Proposals
  async createChatProposal(data: InsertChatProposal): Promise<ChatProposal> {
    const [proposal] = await db.insert(chatProposals).values(data).returning();
    return proposal;
  }

  async getChatProposal(id: number): Promise<ChatProposal | undefined> {
    const [proposal] = await db.select().from(chatProposals).where(eq(chatProposals.id, id));
    return proposal;
  }

  async getChatProposalsBySession(sessionId: number): Promise<ChatProposal[]> {
    return db.select().from(chatProposals)
      .where(eq(chatProposals.sessionId, sessionId))
      .orderBy(desc(chatProposals.createdAt));
  }

  async getChatProposalsByMessage(messageId: number): Promise<ChatProposal[]> {
    return db.select().from(chatProposals)
      .where(eq(chatProposals.messageId, messageId))
      .orderBy(asc(chatProposals.createdAt));
  }

  async updateChatProposal(id: number, data: Partial<ChatProposal>): Promise<ChatProposal | undefined> {
    const [updated] = await db.update(chatProposals)
      .set(data)
      .where(eq(chatProposals.id, id))
      .returning();
    return updated;
  }

  async deleteChatProposal(id: number): Promise<void> {
    await db.delete(chatProposals).where(eq(chatProposals.id, id));
  }

  // LitAgents 2.0: Plot Threads for Narrative Director
  async createPlotThread(data: InsertPlotThread): Promise<PlotThread> {
    const [thread] = await db.insert(plotThreads).values(data).returning();
    return thread;
  }

  async getPlotThreadsByProject(projectId: number): Promise<PlotThread[]> {
    return db.select().from(plotThreads)
      .where(eq(plotThreads.projectId, projectId))
      .orderBy(asc(plotThreads.createdAt));
  }

  async updatePlotThread(id: number, data: Partial<PlotThread>): Promise<PlotThread | undefined> {
    const [updated] = await db.update(plotThreads)
      .set(data)
      .where(eq(plotThreads.id, id))
      .returning();
    return updated;
  }

  async deletePlotThreadsByProject(projectId: number): Promise<void> {
    await db.delete(plotThreads).where(eq(plotThreads.projectId, projectId));
  }
}

export const storage = new DatabaseStorage();
