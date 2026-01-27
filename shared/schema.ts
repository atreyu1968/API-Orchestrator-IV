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
  workType: text("work_type").notNull().default("standalone"), // standalone | series | bookbox
  // Bookbox structure: defines internal books within a single continuous manuscript
  // Format: { books: [{ bookNumber, title, startChapter, endChapter, hasPrologue, hasEpilogue }] }
  bookboxStructure: jsonb("bookbox_structure"),
  seriesId: integer("series_id").references(() => series.id, { onDelete: "set null" }),
  seriesOrder: integer("series_order"),
  status: text("status").notNull().default("idle"),
  currentChapter: integer("current_chapter").default(0),
  revisionCycle: integer("revision_cycle").default(0),
  maxRevisionCycles: integer("max_revision_cycles").default(3),
  voiceAuditCompleted: boolean("voice_audit_completed").default(false),
  semanticCheckCompleted: boolean("semantic_check_completed").default(false),
  finalReviewResult: jsonb("final_review_result"),
  finalScore: integer("final_score"),
  totalInputTokens: integer("total_input_tokens").default(0),
  totalOutputTokens: integer("total_output_tokens").default(0),
  totalThinkingTokens: integer("total_thinking_tokens").default(0),
  minWordCount: integer("min_word_count"),
  minWordsPerChapter: integer("min_words_per_chapter").default(1500),
  maxWordsPerChapter: integer("max_words_per_chapter").default(3500),
  kindleUnlimitedOptimized: boolean("kindle_unlimited_optimized").notNull().default(false),
  architectInstructions: text("architect_instructions"),
  pipelineVersion: text("pipeline_version").default("v1"), // v1 = full-chapter, v2 = scene-based
  betaReaderReport: jsonb("beta_reader_report"),
  betaReaderScore: integer("beta_reader_score"),
  commercialViability: text("commercial_viability"),
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
  // LitAgents 2.0 fields
  sceneBreakdown: jsonb("scene_breakdown"), // Chapter Architect's scene plan
  summary: text("summary"), // Compressed summary for future context (Summarizer)
  editorFeedback: jsonb("editor_feedback"), // Smart Editor's last feedback
  qualityScore: integer("quality_score"), // 0-10 score from Smart Editor
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// LitAgents 2.1: Chapter Version History for Beta Reader rollbacks
export const chapterVersions = pgTable("chapter_versions", {
  id: serial("id").primaryKey(),
  chapterId: integer("chapter_id").notNull().references(() => chapters.id, { onDelete: "cascade" }),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  versionNumber: integer("version_number").notNull(),
  content: text("content").notNull(),
  changeReason: text("change_reason"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertChapterVersionSchema = createInsertSchema(chapterVersions).omit({ id: true, createdAt: true });
export type InsertChapterVersion = z.infer<typeof insertChapterVersionSchema>;
export type ChapterVersion = typeof chapterVersions.$inferSelect;

// LitAgents 2.1: Editing Queue for Beta Reader fixes
export const editingQueue = pgTable("editing_queue", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  chapterId: integer("chapter_id").notNull().references(() => chapters.id, { onDelete: "cascade" }),
  chapterNumber: integer("chapter_number").notNull(),
  issueType: text("issue_type").notNull(),
  severity: text("severity").notNull().default("medium"),
  instruction: text("instruction").notNull(),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertEditingQueueSchema = createInsertSchema(editingQueue).omit({ id: true, createdAt: true });
export type InsertEditingQueue = z.infer<typeof insertEditingQueueSchema>;
export type EditingQueueItem = typeof editingQueue.$inferSelect;

// LitAgents 2.0: Plot Threads for Narrative Director
export const plotThreads = pgTable("plot_threads", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  goal: text("goal"), // Expected resolution
  status: text("status").notNull().default("active"), // active, resolved, ignored
  intensityScore: integer("intensity_score").default(5), // 1-10
  lastUpdatedChapter: integer("last_updated_chapter").default(0),
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
  plotDecisions: jsonb("plot_decisions").default([]),
  persistentInjuries: jsonb("persistent_injuries").default([]),
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

export const insertPlotThreadSchema = createInsertSchema(plotThreads).omit({
  id: true,
  createdAt: true,
});

export type PlotThread = typeof plotThreads.$inferSelect;
export type InsertPlotThread = z.infer<typeof insertPlotThreadSchema>;

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

// ============================================
// UNIVERSAL CONSISTENCY MODULE (LitAgents 2.1)
// ============================================

// World Entities - Characters, Locations, Objects, Evidence with dynamic attributes
export const worldEntities = pgTable("world_entities", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  type: text("type").notNull(), // CHARACTER, LOCATION, OBJECT, EVIDENCE
  attributes: jsonb("attributes").default({}), // Dynamic per genre
  lastSeenChapter: integer("last_seen_chapter"),
  status: text("status").notNull().default("active"), // active, dead, missing, destroyed
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// World Rules - Immutable facts that cannot be contradicted
export const worldRulesTable = pgTable("world_rules", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  ruleDescription: text("rule_description").notNull(),
  category: text("category"), // PHYSICS, MAGIC, LAW, TIMELINE, ALIBI, CAUSE_OF_DEATH
  isActive: boolean("is_active").notNull().default(true),
  sourceChapter: integer("source_chapter"), // Where this rule was established
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// Entity Relationships - The Narrative Graph
export const entityRelationships = pgTable("entity_relationships", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  subjectId: integer("subject_id").notNull().references(() => worldEntities.id, { onDelete: "cascade" }),
  targetId: integer("target_id").notNull().references(() => worldEntities.id, { onDelete: "cascade" }),
  relationType: text("relation_type").notNull(), // KNOWS, LOVES, KILLED, LOCATED_AT, SUSPECTS, ALIBI_FOR
  meta: jsonb("meta").default({}), // { intensity: 10, sinceChapter: 2, isSecret: true }
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// Consistency Violations Log - Track all detected violations
export const consistencyViolations = pgTable("consistency_violations", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  chapterNumber: integer("chapter_number").notNull(),
  violationType: text("violation_type").notNull(), // CONTRADICTION, ANACHRONISM, IMPOSSIBLE_LOCATION, DEAD_CHARACTER_ACTS
  severity: text("severity").notNull().default("major"), // minor, major, critical
  description: text("description").notNull(),
  affectedEntities: jsonb("affected_entities").default([]), // [{entityId, name}]
  brokenRuleId: integer("broken_rule_id").references(() => worldRulesTable.id, { onDelete: "set null" }),
  status: text("status").notNull().default("pending"), // pending, resolved, ignored
  wasAutoFixed: boolean("was_auto_fixed").notNull().default(false),
  fixDescription: text("fix_description"),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertWorldEntitySchema = createInsertSchema(worldEntities).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertWorldRuleSchema = createInsertSchema(worldRulesTable).omit({
  id: true,
  createdAt: true,
});

export const insertEntityRelationshipSchema = createInsertSchema(entityRelationships).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertConsistencyViolationSchema = createInsertSchema(consistencyViolations).omit({
  id: true,
  createdAt: true,
});

export type WorldEntity = typeof worldEntities.$inferSelect;
export type InsertWorldEntity = z.infer<typeof insertWorldEntitySchema>;

export type WorldRuleRecord = typeof worldRulesTable.$inferSelect;
export type InsertWorldRuleRecord = z.infer<typeof insertWorldRuleSchema>;

export type EntityRelationship = typeof entityRelationships.$inferSelect;
export type InsertEntityRelationship = z.infer<typeof insertEntityRelationshipSchema>;

export type ConsistencyViolation = typeof consistencyViolations.$inferSelect;
export type InsertConsistencyViolation = z.infer<typeof insertConsistencyViolationSchema>;

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
  projectId: integer("project_id").references(() => projects.id, { onDelete: "cascade" }),
  reeditProjectId: integer("reedit_project_id").references(() => reeditProjects.id, { onDelete: "cascade" }),
  source: text("source").notNull().default("original"),
  projectTitle: text("project_title").notNull(),
  sourceLanguage: text("source_language").notNull(),
  targetLanguage: text("target_language").notNull(),
  chaptersTranslated: integer("chapters_translated").default(0),
  totalWords: integer("total_words").default(0),
  markdown: text("markdown").notNull(),
  inputTokens: integer("input_tokens").default(0),
  outputTokens: integer("output_tokens").default(0),
  thinkingTokens: integer("thinking_tokens").default(0),
  glossary: jsonb("glossary").default({}),
  typographicalRules: text("typographical_rules"),
  toneInstructions: text("tone_instructions"),
  layoutScore: integer("layout_score").default(0),
  naturalnessScore: integer("naturalness_score").default(0),
  currentChunk: integer("current_chunk").default(0),
  totalChunks: integer("total_chunks").default(0),
  status: text("status").notNull().default("pending"),
  heartbeatAt: timestamp("heartbeat_at"),
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

// AI Usage Events for cost tracking
export const aiUsageEvents = pgTable("ai_usage_events", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").references(() => projects.id, { onDelete: "cascade" }),
  translationId: integer("translation_id").references(() => translations.id, { onDelete: "cascade" }),
  agentName: text("agent_name").notNull(),
  model: text("model").notNull().default("gemini-2.5-pro"),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  thinkingTokens: integer("thinking_tokens").notNull().default(0),
  inputCostUsd: text("input_cost_usd").notNull().default("0"),
  outputCostUsd: text("output_cost_usd").notNull().default("0"),
  totalCostUsd: text("total_cost_usd").notNull().default("0"),
  chapterNumber: integer("chapter_number"),
  operation: text("operation"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertAiUsageEventSchema = createInsertSchema(aiUsageEvents).omit({
  id: true,
  createdAt: true,
});

export type AiUsageEvent = typeof aiUsageEvents.$inferSelect;
export type InsertAiUsageEvent = z.infer<typeof insertAiUsageEventSchema>;

// Reedit Projects - Full agent pipeline for manuscript re-editing (LitEditors 3.0)
export const reeditProjects = pgTable("reedit_projects", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  originalFileName: text("original_file_name").notNull(),
  sourceProjectId: integer("source_project_id").references(() => projects.id, { onDelete: "set null" }), // Link to original created project if cloned
  detectedLanguage: text("detected_language"),
  // LitEditors 3.0: Setting context for anachronism detection
  settingContext: text("setting_context"), // e.g., "Paris, 1920" - crucial for anachronism detection
  totalChapters: integer("total_chapters").default(0),
  processedChapters: integer("processed_chapters").default(0),
  currentStage: text("current_stage").notNull().default("uploaded"), // uploaded, analyzing_structure, plan_ready, executing, editing, auditing, reviewing, completed
  currentChapter: integer("current_chapter").default(0),
  currentActivity: text("current_activity"), // Real-time progress message shown in UI
  bestsellerScore: integer("bestseller_score"), // 1-10 final score
  finalReviewResult: jsonb("final_review_result"),
  structureAnalysis: jsonb("structure_analysis"), // Chapter order issues, duplicates detected
  // LitEditors 3.0: Forensic Consistency Audit results
  forensicAuditResult: jsonb("forensic_audit_result"), // { violations: [], entitiesExtracted: {}, consistencyScore: number, summary: string }
  // LitEditors 3.0: Beta Reader commercial viability analysis
  betaReaderReport: jsonb("beta_reader_report"), // { score, viability, strengths, weaknesses, flagged_chapters, etc. }
  betaReaderScore: integer("beta_reader_score"), // 1-10 commercial viability score
  commercialViability: text("commercial_viability"), // High, Medium, Low
  // LitEditors 3.0: Structural analysis from Story Mapper (R1)
  structuralReport: jsonb("structural_report"), // { critique, anachronisms_warning, plot_holes, redundancies }
  reconstructionPlan: jsonb("reconstruction_plan"), // Array of actions: KEEP, DELETE, INSERT, MERGE
  planApproved: boolean("plan_approved").default(false), // User must approve before execution
  styleGuideId: integer("style_guide_id").references(() => styleGuides.id, { onDelete: "set null" }),
  pseudonymId: integer("pseudonym_id").references(() => pseudonyms.id, { onDelete: "set null" }),
  totalInputTokens: integer("total_input_tokens").default(0),
  totalOutputTokens: integer("total_output_tokens").default(0),
  totalThinkingTokens: integer("total_thinking_tokens").default(0),
  totalWordCount: integer("total_word_count").default(0),
  status: text("status").notNull().default("pending"), // pending, processing, paused, completed, error
  errorMessage: text("error_message"),
  heartbeatAt: timestamp("heartbeat_at"),
  cancelRequested: boolean("cancel_requested").default(false),
  lastCompletedChapter: integer("last_completed_chapter").default(0),
  expandChapters: boolean("expand_chapters").default(false),
  insertNewChapters: boolean("insert_new_chapters").default(false),
  targetMinWordsPerChapter: integer("target_min_words_per_chapter").default(2000),
  expansionPlan: jsonb("expansion_plan"),
  // Final review cycle state (for resume support)
  revisionCycle: integer("revision_cycle").default(0),
  totalReviewCycles: integer("total_review_cycles").default(0), // Lifetime count, never resets - used to prevent infinite loops
  consecutiveHighScores: integer("consecutive_high_scores").default(0),
  previousScores: jsonb("previous_scores"), // Array of scores from previous review cycles
  // Pause after N non-perfect scores
  nonPerfectFinalReviews: integer("non_perfect_final_reviews").default(0),
  pauseReason: text("pause_reason"), // Why the process was paused
  pendingUserInstructions: text("pending_user_instructions"), // User guidance for next cycle
  architectInstructions: text("architect_instructions"), // Initial user instructions from import
  // Tracking de issues resueltos - evita que el revisor re-reporte problemas ya corregidos
  resolvedIssueHashes: jsonb("resolved_issue_hashes").default([]), // Array of hashes for resolved issues
  // Per-chapter correction counts to prevent infinite loops - persisted across restarts
  chapterCorrectionCounts: jsonb("chapter_correction_counts").default({}), // {chapterNumber: correctionCount}
  // Per-chapter change history for intelligent resolution detection
  // Format: { "chapterNum": [{ issue: "desc", fix: "what changed", timestamp: "date" }] }
  chapterChangeHistory: jsonb("chapter_change_history").default({}),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const reeditChapters = pgTable("reedit_chapters", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => reeditProjects.id, { onDelete: "cascade" }),
  chapterNumber: integer("chapter_number").notNull(),
  originalChapterNumber: integer("original_chapter_number"), // For tracking reordering
  // LitEditors 3.0: Flexible chapter structure
  originalIndex: integer("original_index"), // Original position (null if new chapter)
  finalIndex: integer("final_index"), // New order after restructuring
  title: text("title"),
  originalContent: text("original_content").notNull(),
  editedContent: text("edited_content"),
  // LitEditors 3.0: Quick summary for R1 analysis
  summary: text("summary"), // 3-sentence summary for structural analysis
  // LitEditors 3.0: Action type from reconstruction plan
  actionType: text("action_type").default("KEEP_AND_POLISH"), // KEEP_AND_POLISH, DELETE, INSERT_NEW, MERGE
  insertPrompt: text("insert_prompt"), // Instruction for Ghostwriter if INSERT_NEW
  mergeWithNext: boolean("merge_with_next").default(false), // If MERGE action
  // LitEditors 3.0: Anachronism detection
  anachronismsFound: jsonb("anachronisms_found").default([]), // Array of detected anachronisms
  // Editor agent feedback
  editorScore: integer("editor_score"), // 1-10
  editorFeedback: jsonb("editor_feedback"), // {issues: [], suggestions: [], strengths: []}
  narrativeIssues: jsonb("narrative_issues"), // {plotHoles: [], continuityErrors: [], pacing: []}
  // CopyEditor changes
  copyeditorChanges: text("copyeditor_changes"),
  fluencyImprovements: jsonb("fluency_improvements"), // [{before, after, reason}]
  // Flags for issues
  isDuplicate: boolean("is_duplicate").default(false),
  duplicateOfChapter: integer("duplicate_of_chapter"),
  isOutOfOrder: boolean("is_out_of_order").default(false),
  suggestedOrder: integer("suggested_order"),
  // Status tracking
  wordCount: integer("word_count").default(0),
  status: text("status").notNull().default("pending"), // pending, summarizing, analyzing, editing, reviewed, completed, skipped, deleted
  processingStage: text("processing_stage").default("none"), // none, summarizer, editor, copyeditor, auditor, completed
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const reeditAuditReports = pgTable("reedit_audit_reports", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => reeditProjects.id, { onDelete: "cascade" }),
  auditType: text("audit_type").notNull(), // continuity, voice_rhythm, semantic_repetition, final_review
  chapterRange: text("chapter_range"), // e.g., "1-5", "6-10", "all"
  score: integer("score"), // 1-10
  findings: jsonb("findings"), // Agent-specific findings
  recommendations: jsonb("recommendations"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const reeditWorldBibles = pgTable("reedit_world_bibles", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => reeditProjects.id, { onDelete: "cascade" }),
  // Characters extracted from manuscript
  characters: jsonb("characters"), // [{name, description, firstAppearance, aliases, relationships}]
  // Locations
  locations: jsonb("locations"), // [{name, description, firstMention, characteristics}]
  // Timeline of events
  timeline: jsonb("timeline"), // [{event, chapter, timeMarker, importance}]
  // World rules and lore
  loreRules: jsonb("lore_rules"), // [{rule, source, category}]
  // Historical period (for anachronism detection)
  historicalPeriod: text("historical_period"),
  historicalDetails: jsonb("historical_details"), // {era, location, socialContext, technology}
  // Extraction metadata
  extractedFromChapters: integer("extracted_from_chapters"),
  confidence: integer("confidence"), // 1-10
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertReeditWorldBibleSchema = createInsertSchema(reeditWorldBibles).omit({
  id: true,
  createdAt: true,
});

export type ReeditWorldBible = typeof reeditWorldBibles.$inferSelect;
export type InsertReeditWorldBible = z.infer<typeof insertReeditWorldBibleSchema>;

export const insertReeditProjectSchema = createInsertSchema(reeditProjects).omit({
  id: true,
  createdAt: true,
  status: true,
  currentStage: true,
  processedChapters: true,
  currentChapter: true,
  totalInputTokens: true,
  totalOutputTokens: true,
  totalThinkingTokens: true,
});

export const insertReeditChapterSchema = createInsertSchema(reeditChapters).omit({
  id: true,
  createdAt: true,
});

export const insertReeditAuditReportSchema = createInsertSchema(reeditAuditReports).omit({
  id: true,
  createdAt: true,
});

export const reeditIssues = pgTable("reedit_issues", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => reeditProjects.id, { onDelete: "cascade" }),
  chapterNumber: integer("chapter_number").notNull(),
  category: text("category").notNull(), // continuidad, voz_ritmo, estructura, anacronismo, narrativa, etc.
  severity: text("severity").notNull().default("mayor"), // critica, mayor, menor
  description: text("description").notNull(),
  textCitation: text("text_citation"), // Fragmento exacto del texto con el problema
  correctionInstruction: text("correction_instruction"), // Instrucción FIND/REPLACE para corregir
  source: text("source").notNull().default("qa"), // qa, architect, final_reviewer
  reviewCycle: integer("review_cycle").default(0), // En qué ciclo se detectó
  status: text("status").notNull().default("pending"), // pending, approved, rejected, resolved
  resolvedAt: timestamp("resolved_at"),
  rejectionReason: text("rejection_reason"), // Si el usuario rechaza, por qué
  issueHash: text("issue_hash"), // Hash único para evitar duplicados
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertReeditIssueSchema = createInsertSchema(reeditIssues).omit({
  id: true,
  createdAt: true,
  resolvedAt: true,
});

export type ReeditIssue = typeof reeditIssues.$inferSelect;
export type InsertReeditIssue = z.infer<typeof insertReeditIssueSchema>;

export type ReeditProject = typeof reeditProjects.$inferSelect;
export type InsertReeditProject = z.infer<typeof insertReeditProjectSchema>;
export type ReeditChapter = typeof reeditChapters.$inferSelect;
export type InsertReeditChapter = z.infer<typeof insertReeditChapterSchema>;
export type ReeditAuditReport = typeof reeditAuditReports.$inferSelect;
export type InsertReeditAuditReport = z.infer<typeof insertReeditAuditReportSchema>;

export * from "./models/chat";
