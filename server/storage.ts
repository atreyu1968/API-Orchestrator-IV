import { db } from "./db";
import { 
  projects, chapters, worldBibles, thoughtLogs, agentStatuses, pseudonyms, styleGuides,
  series, continuitySnapshots, importedManuscripts, importedChapters, extendedGuides,
  type Project, type InsertProject, type Chapter, type InsertChapter,
  type WorldBible, type InsertWorldBible, type ThoughtLog, type InsertThoughtLog,
  type AgentStatus, type InsertAgentStatus, type Pseudonym, type InsertPseudonym,
  type StyleGuide, type InsertStyleGuide, type Series, type InsertSeries,
  type ContinuitySnapshot, type InsertContinuitySnapshot,
  type ImportedManuscript, type InsertImportedManuscript,
  type ImportedChapter, type InsertImportedChapter,
  type ExtendedGuide, type InsertExtendedGuide
} from "@shared/schema";
import { eq, desc, and } from "drizzle-orm";

export interface IStorage {
  createPseudonym(data: InsertPseudonym): Promise<Pseudonym>;
  getPseudonym(id: number): Promise<Pseudonym | undefined>;
  getAllPseudonyms(): Promise<Pseudonym[]>;
  updatePseudonym(id: number, data: Partial<Pseudonym>): Promise<Pseudonym | undefined>;
  deletePseudonym(id: number): Promise<void>;

  createStyleGuide(data: InsertStyleGuide): Promise<StyleGuide>;
  getStyleGuide(id: number): Promise<StyleGuide | undefined>;
  getStyleGuidesByPseudonym(pseudonymId: number): Promise<StyleGuide[]>;
  updateStyleGuide(id: number, data: Partial<StyleGuide>): Promise<StyleGuide | undefined>;
  deleteStyleGuide(id: number): Promise<void>;

  createProject(data: InsertProject): Promise<Project>;
  getProject(id: number): Promise<Project | undefined>;
  getAllProjects(): Promise<Project[]>;
  updateProject(id: number, data: Partial<Project>): Promise<Project | undefined>;
  deleteProject(id: number): Promise<void>;

  createChapter(data: InsertChapter): Promise<Chapter>;
  getChaptersByProject(projectId: number): Promise<Chapter[]>;
  updateChapter(id: number, data: Partial<Chapter>): Promise<Chapter | undefined>;

  createWorldBible(data: InsertWorldBible): Promise<WorldBible>;
  getWorldBibleByProject(projectId: number): Promise<WorldBible | undefined>;
  updateWorldBible(id: number, data: Partial<WorldBible>): Promise<WorldBible | undefined>;

  createThoughtLog(data: InsertThoughtLog): Promise<ThoughtLog>;
  getThoughtLogsByProject(projectId: number): Promise<ThoughtLog[]>;

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

  createImportedManuscript(data: InsertImportedManuscript): Promise<ImportedManuscript>;
  getImportedManuscript(id: number): Promise<ImportedManuscript | undefined>;
  getAllImportedManuscripts(): Promise<ImportedManuscript[]>;
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

  async updateChapter(id: number, data: Partial<Chapter>): Promise<Chapter | undefined> {
    const [updated] = await db.update(chapters).set(data).where(eq(chapters.id, id)).returning();
    return updated;
  }

  async createWorldBible(data: InsertWorldBible): Promise<WorldBible> {
    const [worldBible] = await db.insert(worldBibles).values(data).returning();
    return worldBible;
  }

  async getWorldBibleByProject(projectId: number): Promise<WorldBible | undefined> {
    const [worldBible] = await db.select().from(worldBibles).where(eq(worldBibles.projectId, projectId));
    return worldBible;
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
    if (projectIds.length === 0) return [];
    
    const snapshots: ContinuitySnapshot[] = [];
    for (const projectId of projectIds) {
      const snapshot = await this.getContinuitySnapshotByProject(projectId);
      if (snapshot) snapshots.push(snapshot);
    }
    return snapshots;
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
}

export const storage = new DatabaseStorage();
