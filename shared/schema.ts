import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, serial, timestamp, jsonb, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export const pseudonyms = pgTable("pseudonyms", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  bio: text("bio"),
  defaultGenre: text("default_genre"),
  defaultTone: text("default_tone"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const styleGuides = pgTable("style_guides", {
  id: serial("id").primaryKey(),
  pseudonymId: integer("pseudonym_id").notNull().references(() => pseudonyms.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  content: text("content").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const extendedGuides = pgTable("extended_guides", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  originalFileName: text("original_file_name").notNull(),
  content: text("content").notNull(),
  wordCount: integer("word_count").default(0),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const series = pgTable("series", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  workType: text("work_type").notNull().default("trilogy"),
  totalPlannedBooks: integer("total_planned_books").default(3),
  pseudonymId: integer("pseudonym_id").references(() => pseudonyms.id, { onDelete: "set null" }),
  seriesGuide: text("series_guide"),
  seriesGuideFileName: text("series_guide_file_name"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const projects = pgTable("projects", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  premise: text("premise"),
  genre: text("genre").notNull().default("fantasy"),
  tone: text("tone").notNull().default("dramatic"),
  chapterCount: integer("chapter_count").notNull().default(5),
  hasPrologue: boolean("has_prologue").notNull().default(false),
  hasEpilogue: boolean("has_epilogue").notNull().default(false),
  hasAuthorNote: boolean("has_author_note").notNull().default(false),
  pseudonymId: integer("pseudonym_id").references(() => pseudonyms.id, { onDelete: "set null" }),
  styleGuideId: integer("style_guide_id").references(() => styleGuides.id, { onDelete: "set null" }),
  extendedGuideId: integer("extended_guide_id").references(() => extendedGuides.id, { onDelete: "set null" }),
  workType: text("work_type").notNull().default("standalone"),
  seriesId: integer("series_id").references(() => series.id, { onDelete: "set null" }),
  seriesOrder: integer("series_order"),
  status: text("status").notNull().default("idle"),
  currentChapter: integer("current_chapter").default(0),
  revisionCycle: integer("revision_cycle").default(0),
  maxRevisionCycles: integer("max_revision_cycles").default(3),
  finalReviewResult: jsonb("final_review_result"),
  finalScore: integer("final_score"),
  totalInputTokens: integer("total_input_tokens").default(0),
  totalOutputTokens: integer("total_output_tokens").default(0),
  totalThinkingTokens: integer("total_thinking_tokens").default(0),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const continuitySnapshots = pgTable("continuity_snapshots", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  synopsis: text("synopsis"),
  characterStates: jsonb("character_states").default([]),
  unresolvedThreads: jsonb("unresolved_threads").default([]),
  worldStateChanges: jsonb("world_state_changes").default([]),
  keyEvents: jsonb("key_events").default([]),
  tokenCount: integer("token_count").default(0),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const chapters = pgTable("chapters", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  chapterNumber: integer("chapter_number").notNull(),
  title: text("title"),
  content: text("content"),
  originalContent: text("original_content"),
  wordCount: integer("word_count").default(0),
  status: text("status").notNull().default("pending"),
  needsRevision: boolean("needs_revision").default(false),
  revisionReason: text("revision_reason"),
  continuityState: jsonb("continuity_state"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const importedManuscripts = pgTable("imported_manuscripts", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  originalFileName: text("original_file_name").notNull(),
  detectedLanguage: text("detected_language"),
  targetLanguage: text("target_language").default("es"),
  totalChapters: integer("total_chapters").default(0),
  processedChapters: integer("processed_chapters").default(0),
  status: text("status").notNull().default("pending"),
  parsingErrors: text("parsing_errors"),
  totalInputTokens: integer("total_input_tokens").default(0),
  totalOutputTokens: integer("total_output_tokens").default(0),
  totalThinkingTokens: integer("total_thinking_tokens").default(0),
  seriesId: integer("series_id").references(() => series.id, { onDelete: "set null" }),
  seriesOrder: integer("series_order"),
  pseudonymId: integer("pseudonym_id").references(() => pseudonyms.id, { onDelete: "set null" }),
  totalWordCount: integer("total_word_count").default(0),
  continuitySnapshot: jsonb("continuity_snapshot"),
  continuityAnalysisStatus: text("continuity_analysis_status").default("pending"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const importedChapters = pgTable("imported_chapters", {
  id: serial("id").primaryKey(),
  manuscriptId: integer("manuscript_id").notNull().references(() => importedManuscripts.id, { onDelete: "cascade" }),
  chapterNumber: integer("chapter_number").notNull(),
  title: text("title"),
  originalContent: text("original_content").notNull(),
  editedContent: text("edited_content"),
  changesLog: text("changes_log"),
  wordCount: integer("word_count").default(0),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const worldBibles = pgTable("world_bibles", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  timeline: jsonb("timeline").default([]),
  characters: jsonb("characters").default([]),
  worldRules: jsonb("world_rules").default([]),
  plotOutline: jsonb("plot_outline").default({}),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const thoughtLogs = pgTable("thought_logs", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  chapterId: integer("chapter_id").references(() => chapters.id, { onDelete: "cascade" }),
  agentName: text("agent_name").notNull(),
  agentRole: text("agent_role").notNull(),
  thoughtContent: text("thought_content").notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const agentStatuses = pgTable("agent_statuses", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  agentName: text("agent_name").notNull(),
  status: text("status").notNull().default("idle"),
  currentTask: text("current_task"),
  lastActivity: timestamp("last_activity").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertPseudonymSchema = createInsertSchema(pseudonyms).omit({
  id: true,
  createdAt: true,
});

export const insertStyleGuideSchema = createInsertSchema(styleGuides).omit({
  id: true,
  createdAt: true,
});

export const insertExtendedGuideSchema = createInsertSchema(extendedGuides).omit({
  id: true,
  createdAt: true,
});

export const insertSeriesSchema = createInsertSchema(series).omit({
  id: true,
  createdAt: true,
});

export const insertProjectSchema = createInsertSchema(projects).omit({
  id: true,
  createdAt: true,
  status: true,
  currentChapter: true,
});

export const insertContinuitySnapshotSchema = createInsertSchema(continuitySnapshots).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertChapterSchema = createInsertSchema(chapters).omit({
  id: true,
  createdAt: true,
});

export const insertWorldBibleSchema = createInsertSchema(worldBibles).omit({
  id: true,
  updatedAt: true,
});

export const insertThoughtLogSchema = createInsertSchema(thoughtLogs).omit({
  id: true,
  createdAt: true,
});

export const insertAgentStatusSchema = createInsertSchema(agentStatuses).omit({
  id: true,
  lastActivity: true,
});

export const insertImportedManuscriptSchema = createInsertSchema(importedManuscripts).omit({
  id: true,
  createdAt: true,
  status: true,
  processedChapters: true,
  totalInputTokens: true,
  totalOutputTokens: true,
  totalThinkingTokens: true,
});

export const insertImportedChapterSchema = createInsertSchema(importedChapters).omit({
  id: true,
  createdAt: true,
});

export type Pseudonym = typeof pseudonyms.$inferSelect;
export type InsertPseudonym = z.infer<typeof insertPseudonymSchema>;

export type StyleGuide = typeof styleGuides.$inferSelect;
export type InsertStyleGuide = z.infer<typeof insertStyleGuideSchema>;

export type ExtendedGuide = typeof extendedGuides.$inferSelect;
export type InsertExtendedGuide = z.infer<typeof insertExtendedGuideSchema>;

export type Series = typeof series.$inferSelect;
export type InsertSeries = z.infer<typeof insertSeriesSchema>;

export type Project = typeof projects.$inferSelect;
export type InsertProject = z.infer<typeof insertProjectSchema>;

export type ContinuitySnapshot = typeof continuitySnapshots.$inferSelect;
export type InsertContinuitySnapshot = z.infer<typeof insertContinuitySnapshotSchema>;

export type Chapter = typeof chapters.$inferSelect;
export type InsertChapter = z.infer<typeof insertChapterSchema>;

export type WorldBible = typeof worldBibles.$inferSelect;
export type InsertWorldBible = z.infer<typeof insertWorldBibleSchema>;

export type ThoughtLog = typeof thoughtLogs.$inferSelect;
export type InsertThoughtLog = z.infer<typeof insertThoughtLogSchema>;

export type AgentStatus = typeof agentStatuses.$inferSelect;
export type InsertAgentStatus = z.infer<typeof insertAgentStatusSchema>;

export type ImportedManuscript = typeof importedManuscripts.$inferSelect;
export type InsertImportedManuscript = z.infer<typeof insertImportedManuscriptSchema>;

export type ImportedChapter = typeof importedChapters.$inferSelect;
export type InsertImportedChapter = z.infer<typeof insertImportedChapterSchema>;

export const characterSchema = z.object({
  name: z.string(),
  role: z.string(),
  psychologicalProfile: z.string(),
  relationships: z.array(z.string()).optional(),
  arc: z.string().optional(),
  isAlive: z.boolean().default(true),
  // Apariencia física inmutable - crítico para continuidad
  aparienciaInmutable: z.object({
    ojos: z.string().optional(),
    cabello: z.string().optional(),
    rasgosDistintivos: z.array(z.string()).optional(),
    altura: z.string().optional(),
    edad: z.string().optional(),
  }).optional(),
});

export const timelineEventSchema = z.object({
  chapter: z.number(),
  event: z.string(),
  characters: z.array(z.string()),
  significance: z.string().optional(),
});

export const worldRuleSchema = z.object({
  category: z.string(),
  rule: z.string(),
  constraints: z.array(z.string()).optional(),
});

export const plotOutlineSchema = z.object({
  premise: z.string().optional(),
  threeActStructure: z.object({
    act1: z.object({
      setup: z.string().optional(),
      incitingIncident: z.string().optional(),
    }).optional(),
    act2: z.object({
      risingAction: z.string().optional(),
      midpoint: z.string().optional(),
      complications: z.string().optional(),
    }).optional(),
    act3: z.object({
      climax: z.string().optional(),
      resolution: z.string().optional(),
    }).optional(),
  }).optional(),
  chapterOutlines: z.array(z.object({
    number: z.number(),
    summary: z.string(),
    keyEvents: z.array(z.string()),
  })).optional(),
});

export type Character = z.infer<typeof characterSchema>;
export type TimelineEvent = z.infer<typeof timelineEventSchema>;
export type WorldRule = z.infer<typeof worldRuleSchema>;
export type PlotOutline = z.infer<typeof plotOutlineSchema>;

export const continuityStateSchema = z.object({
  characterStates: z.record(z.string(), z.object({
    location: z.string(),
    status: z.enum(["alive", "dead", "injured", "unconscious", "missing", "imprisoned"]),
    hasItems: z.array(z.string()).optional(),
    emotionalState: z.string().optional(),
    knowledgeGained: z.array(z.string()).optional(),
  })).optional(),
  narrativeTime: z.string().optional(),
  keyReveals: z.array(z.string()).optional(),
  pendingThreads: z.array(z.string()).optional(),
  resolvedThreads: z.array(z.string()).optional(),
  locationState: z.record(z.string(), z.string()).optional(),
});

export type ContinuityState = z.infer<typeof continuityStateSchema>;

export const activityLogs = pgTable("activity_logs", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").references(() => projects.id, { onDelete: "cascade" }),
  level: text("level").notNull().default("info"),
  agentRole: text("agent_role"),
  message: text("message").notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertActivityLogSchema = createInsertSchema(activityLogs).omit({ id: true, createdAt: true });
export type InsertActivityLog = z.infer<typeof insertActivityLogSchema>;
export type ActivityLog = typeof activityLogs.$inferSelect;

// Project Queue System - Autonomous project processing queue
export const projectQueue = pgTable("project_queue", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  status: text("status").notNull().default("waiting"), // waiting, active, paused, completed, skipped, error
  priority: text("priority").notNull().default("normal"), // low, normal, high, urgent
  addedAt: timestamp("added_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  errorMessage: text("error_message"),
});

export const queueState = pgTable("queue_state", {
  id: serial("id").primaryKey(),
  status: text("status").notNull().default("stopped"), // running, paused, stopped
  currentProjectId: integer("current_project_id").references(() => projects.id, { onDelete: "set null" }),
  autoAdvance: boolean("auto_advance").notNull().default(true),
  skipOnError: boolean("skip_on_error").notNull().default(true),
  pauseAfterEach: boolean("pause_after_each").notNull().default(false),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertProjectQueueSchema = createInsertSchema(projectQueue).omit({
  id: true,
  addedAt: true,
  startedAt: true,
  completedAt: true,
});

export const insertQueueStateSchema = createInsertSchema(queueState).omit({
  id: true,
  updatedAt: true,
});

export type ProjectQueueItem = typeof projectQueue.$inferSelect;
export type InsertProjectQueueItem = z.infer<typeof insertProjectQueueSchema>;
export type QueueState = typeof queueState.$inferSelect;
export type InsertQueueState = z.infer<typeof insertQueueStateSchema>;

// Series Arc Tracking - For verifying story arc progression across volumes
export const seriesArcMilestones = pgTable("series_arc_milestones", {
  id: serial("id").primaryKey(),
  seriesId: integer("series_id").notNull().references(() => series.id, { onDelete: "cascade" }),
  volumeNumber: integer("volume_number").notNull(),
  milestoneType: text("milestone_type").notNull(), // plot_point, character_development, revelation, conflict, resolution
  description: text("description").notNull(),
  isRequired: boolean("is_required").notNull().default(true),
  isFulfilled: boolean("is_fulfilled").notNull().default(false),
  fulfilledInProjectId: integer("fulfilled_in_project_id").references(() => projects.id, { onDelete: "set null" }),
  fulfilledInChapter: integer("fulfilled_in_chapter"),
  verificationNotes: text("verification_notes"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const seriesPlotThreads = pgTable("series_plot_threads", {
  id: serial("id").primaryKey(),
  seriesId: integer("series_id").notNull().references(() => series.id, { onDelete: "cascade" }),
  threadName: text("thread_name").notNull(),
  description: text("description"),
  introducedVolume: integer("introduced_volume").notNull(),
  introducedChapter: integer("introduced_chapter"),
  resolvedVolume: integer("resolved_volume"),
  resolvedChapter: integer("resolved_chapter"),
  status: text("status").notNull().default("active"), // active, developing, resolved, abandoned
  importance: text("importance").notNull().default("major"), // major, minor, subplot
  relatedCharacters: text("related_characters").array(),
  progressNotes: jsonb("progress_notes").default([]), // [{volume, chapter, note}]
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const seriesArcVerifications = pgTable("series_arc_verifications", {
  id: serial("id").primaryKey(),
  seriesId: integer("series_id").notNull().references(() => series.id, { onDelete: "cascade" }),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  volumeNumber: integer("volume_number").notNull(),
  verificationDate: timestamp("verification_date").default(sql`CURRENT_TIMESTAMP`).notNull(),
  overallScore: integer("overall_score"), // 0-100 percentage
  milestonesChecked: integer("milestones_checked").default(0),
  milestonesFulfilled: integer("milestones_fulfilled").default(0),
  threadsProgressed: integer("threads_progressed").default(0),
  threadsResolved: integer("threads_resolved").default(0),
  findings: jsonb("findings").default([]),
  recommendations: text("recommendations"),
  status: text("status").notNull().default("pending"), // pending, passed, needs_attention, failed
});

export const translations = pgTable("translations", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  projectTitle: text("project_title").notNull(),
  sourceLanguage: text("source_language").notNull(),
  targetLanguage: text("target_language").notNull(),
  chaptersTranslated: integer("chapters_translated").default(0),
  totalWords: integer("total_words").default(0),
  markdown: text("markdown").notNull(),
  inputTokens: integer("input_tokens").default(0),
  outputTokens: integer("output_tokens").default(0),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertTranslationSchema = createInsertSchema(translations).omit({
  id: true,
  createdAt: true,
});

export type Translation = typeof translations.$inferSelect;
export type InsertTranslation = z.infer<typeof insertTranslationSchema>;

export const insertSeriesArcMilestoneSchema = createInsertSchema(seriesArcMilestones).omit({
  id: true,
  createdAt: true,
});

export const insertSeriesPlotThreadSchema = createInsertSchema(seriesPlotThreads).omit({
  id: true,
  createdAt: true,
});

export const insertSeriesArcVerificationSchema = createInsertSchema(seriesArcVerifications).omit({
  id: true,
  verificationDate: true,
});

export type SeriesArcMilestone = typeof seriesArcMilestones.$inferSelect;
export type InsertSeriesArcMilestone = z.infer<typeof insertSeriesArcMilestoneSchema>;
export type SeriesPlotThread = typeof seriesPlotThreads.$inferSelect;
export type InsertSeriesPlotThread = z.infer<typeof insertSeriesPlotThreadSchema>;
export type SeriesArcVerification = typeof seriesArcVerifications.$inferSelect;
export type InsertSeriesArcVerification = z.infer<typeof insertSeriesArcVerificationSchema>;

export * from "./models/chat";
