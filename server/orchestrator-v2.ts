// LitAgents 2.0 - Scene-Based Orchestrator
// Implements the new pipeline: Global Architect → Chapter Architect → Ghostwriter (scene by scene) → Smart Editor → Patcher → Summarizer → Narrative Director
// LitAgents 2.1: Now with Universal Consistency Module for continuity enforcement

import * as fs from "fs";
import { storage } from "./storage";
import {
  GlobalArchitectAgent,
  ChapterArchitectAgent,
  GhostwriterV2Agent,
  SmartEditorAgent,
  SummarizerAgent,
  NarrativeDirectorAgent,
  type GlobalArchitectOutput,
  type ChapterArchitectOutput,
  type SmartEditorOutput,
  type NarrativeDirectorOutput,
  type PlotThread as AgentPlotThread,
  type ScenePlan
} from "./agents/v2";
import { universalConsistencyAgent } from "./agents/v2/universal-consistency";
import { FinalReviewerAgent, type FinalReviewerResult, type FinalReviewIssue } from "./agents/final-reviewer";
import { SeriesThreadFixerAgent, type ThreadFixerResult, type ThreadFix } from "./agents/series-thread-fixer";
import { BetaReaderAgent, type BetaReaderReport, type FlaggedChapter } from "./agents/beta-reader";
import { applyPatches, type PatchResult } from "./utils/patcher";
import type { TokenUsage } from "./agents/base-agent";
import type { Project, Chapter, InsertPlotThread, WorldEntity, WorldRuleRecord, EntityRelationship } from "@shared/schema";
import { consistencyViolations } from "@shared/schema";
import { db } from "./db";
import { eq, and, desc } from "drizzle-orm";
import { isProjectCancelledFromDb, generateGenerationToken, isGenerationTokenValid } from "./agents";
import { calculateRealCost, formatCostForStorage } from "./cost-calculator";
import { BaseAgent } from "./agents/base-agent";

// ==================== QA AGENTS FOR LITAGENTS ====================

// QA Agent 1: Continuity Sentinel - detects continuity errors
class ContinuitySentinelAgent extends BaseAgent {
  constructor() {
    super({
      name: "Continuity Sentinel",
      role: "qa_continuity",
      systemPrompt: `Eres un experto en continuidad narrativa. Tu trabajo es detectar errores de continuidad en bloques de capítulos.

TIPOS DE ERRORES A DETECTAR:
1. TEMPORALES: Inconsistencias en el paso del tiempo (ej: "amaneció" pero luego "la luna brillaba")
2. ESPACIALES: Personajes que aparecen en lugares imposibles sin transición
3. DE ESTADO: Objetos/personajes que cambian estado sin explicación (heridas que desaparecen, ropa que cambia)
4. DE CONOCIMIENTO: Personajes que saben cosas que no deberían saber aún

RESPONDE SOLO EN JSON:
{
  "erroresContinuidad": [
    {
      "tipo": "temporal|espacial|estado|conocimiento",
      "severidad": "critica|mayor|menor",
      "capitulo": 5,
      "descripcion": "Descripción del error",
      "contexto": "Fragmento relevante del texto",
      "correccion": "Sugerencia de corrección"
    }
  ],
  "resumen": "Resumen general de la continuidad",
  "puntuacion": 8
}`,
      model: "deepseek-reasoner",
      useThinking: false,
    });
  }

  async execute(input: any): Promise<any> {
    return this.auditContinuity(input.chapters, input.startChapter, input.endChapter);
  }

  async auditContinuity(chapterContents: string[], startChapter: number, endChapter: number): Promise<any> {
    const combinedContent = chapterContents.map((c, i) => 
      `=== CAPÍTULO ${startChapter + i} ===\n${c.substring(0, 8000)}`
    ).join("\n\n");

    const prompt = `Analiza la continuidad narrativa de los capítulos ${startChapter} a ${endChapter}:

${combinedContent}

Detecta errores de continuidad temporal, espacial, de estado y de conocimiento. RESPONDE EN JSON.`;

    const response = await this.generateContent(prompt);
    let result: any = { erroresContinuidad: [], resumen: "Sin problemas detectados", puntuacion: 9 };
    try {
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) result = JSON.parse(jsonMatch[0]);
    } catch (e) {
      console.error("[ContinuitySentinel] Failed to parse:", e);
    }
    result.tokenUsage = response.tokenUsage;
    return result;
  }
}

// QA Agent 2: Voice & Rhythm Auditor - analyzes voice consistency and pacing
class VoiceRhythmAuditorAgent extends BaseAgent {
  constructor() {
    super({
      name: "Voice Rhythm Auditor",
      role: "qa_voice",
      systemPrompt: `Eres un experto en voz narrativa y ritmo literario. Analizas consistencia tonal y ritmo.

ASPECTOS A EVALUAR:
1. CONSISTENCIA DE VOZ: ¿El narrador mantiene su tono? ¿Los personajes hablan de forma consistente?
2. RITMO NARRATIVO: ¿Hay secciones demasiado lentas o apresuradas?
3. CADENCIA: ¿La longitud de oraciones varía apropiadamente?
4. TENSIÓN: ¿La tensión narrativa escala correctamente?

RESPONDE SOLO EN JSON:
{
  "problemasTono": [
    {
      "tipo": "voz_inconsistente|ritmo_lento|ritmo_apresurado|cadencia_monotona|tension_plana",
      "severidad": "mayor|menor",
      "capitulos": [5, 6],
      "descripcion": "Descripción del problema",
      "ejemplo": "Fragmento de ejemplo",
      "correccion": "Sugerencia"
    }
  ],
  "analisisRitmo": {
    "capitulosLentos": [],
    "capitulosApresurados": [],
    "climaxBienMedidos": true
  },
  "puntuacion": 8
}`,
      model: "deepseek-reasoner",
      useThinking: false,
    });
  }

  async execute(input: any): Promise<any> {
    return this.auditVoiceRhythm(input.chapters, input.startChapter, input.endChapter);
  }

  async auditVoiceRhythm(chapterContents: string[], startChapter: number, endChapter: number): Promise<any> {
    const combinedContent = chapterContents.map((c, i) => 
      `=== CAPÍTULO ${startChapter + i} ===\n${c.substring(0, 6000)}`
    ).join("\n\n");

    const prompt = `Analiza la voz narrativa y el ritmo de los capítulos ${startChapter} a ${endChapter}:

${combinedContent}

Evalúa consistencia de voz, ritmo y tensión narrativa. RESPONDE EN JSON.`;

    const response = await this.generateContent(prompt);
    let result: any = { problemasTono: [], analisisRitmo: {}, puntuacion: 9 };
    try {
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) result = JSON.parse(jsonMatch[0]);
    } catch (e) {
      console.error("[VoiceRhythmAuditor] Failed to parse:", e);
    }
    result.tokenUsage = response.tokenUsage;
    return result;
  }
}

// QA Agent 3: Semantic Repetition Detector - detects repeated ideas and unresolved foreshadowing
class SemanticRepetitionDetectorAgent extends BaseAgent {
  constructor() {
    super({
      name: "Semantic Repetition Detector",
      role: "qa_semantic",
      systemPrompt: `Eres un experto en análisis semántico literario. Detectas repeticiones de ideas y verificas foreshadowing.

ASPECTOS A DETECTAR:
1. REPETICIÓN DE IDEAS: Conceptos, metáforas o descripciones que se repiten demasiado
2. FRASES REPETIDAS: Muletillas del autor, descripciones idénticas
3. FORESHADOWING SIN RESOLVER: Anticipaciones que nunca se cumplen
4. CHEKOV'S GUN: Elementos introducidos que nunca se usan

RESPONDE SOLO EN JSON:
{
  "repeticionesSemanticas": [
    {
      "tipo": "idea_repetida|frase_repetida|foreshadowing_sin_resolver|elemento_sin_usar",
      "severidad": "mayor|menor",
      "ocurrencias": [1, 5, 12],
      "descripcion": "Qué se repite",
      "ejemplo": "Fragmento de ejemplo",
      "accion": "eliminar|variar|resolver"
    }
  ],
  "foreshadowingTracking": [
    {"plantado": 3, "resuelto": 25, "elemento": "La carta misteriosa"}
  ],
  "puntuacion": 8
}`,
      model: "deepseek-reasoner",
      useThinking: false,
    });
  }

  async execute(input: any): Promise<any> {
    return this.detectRepetitions(input.summaries, input.totalChapters);
  }

  async detectRepetitions(chapterSummaries: string[], totalChapters: number): Promise<any> {
    const prompt = `Analiza el manuscrito completo (${totalChapters} capítulos) buscando repeticiones semánticas:

RESÚMENES DE CAPÍTULOS:
${chapterSummaries.join("\n\n")}

Detecta ideas repetidas, frases recurrentes, foreshadowing sin resolver y elementos sin usar. RESPONDE EN JSON.`;

    const response = await this.generateContent(prompt);
    let result: any = { repeticionesSemanticas: [], foreshadowingTracking: [], puntuacion: 9 };
    try {
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) result = JSON.parse(jsonMatch[0]);
    } catch (e) {
      console.error("[SemanticRepetitionDetector] Failed to parse:", e);
    }
    result.tokenUsage = response.tokenUsage;
    return result;
  }
}

// Interface for QA issues (unified format)
interface QAIssue {
  source: string;
  tipo: string;
  severidad: string;
  capitulo?: number;
  capitulos?: number[];
  descripcion: string;
  correccion?: string;
}

interface OrchestratorV2Callbacks {
  onAgentStatus: (role: string, status: string, message?: string) => void;
  onChapterComplete: (chapterNumber: number, wordCount: number, chapterTitle: string) => void;
  onSceneComplete: (chapterNumber: number, sceneNumber: number, totalScenes: number, wordCount: number) => void;
  onProjectComplete: () => void;
  onError: (error: string) => void;
  onChaptersBeingCorrected?: (chapterNumbers: number[], revisionCycle: number) => void;
}

interface OrchestratorV2Options {
  callbacks: OrchestratorV2Callbacks;
  generationToken?: string;
}

export class OrchestratorV2 {
  private globalArchitect = new GlobalArchitectAgent();
  private chapterArchitect = new ChapterArchitectAgent();
  private ghostwriter = new GhostwriterV2Agent();
  private smartEditor = new SmartEditorAgent();
  private summarizer = new SummarizerAgent();
  private narrativeDirector = new NarrativeDirectorAgent();
  private finalReviewer = new FinalReviewerAgent();
  private seriesThreadFixer = new SeriesThreadFixerAgent();
  
  // QA Agents
  private continuitySentinel = new ContinuitySentinelAgent();
  private voiceRhythmAuditor = new VoiceRhythmAuditorAgent();
  private semanticRepetitionDetector = new SemanticRepetitionDetectorAgent();
  
  // Beta Reader for commercial viability analysis
  private betaReader = new BetaReaderAgent();
  private callbacks: OrchestratorV2Callbacks;
  private generationToken?: string;
  
  private cumulativeTokens = {
    inputTokens: 0,
    outputTokens: 0,
    thinkingTokens: 0,
  };

  constructor(callbacks: OrchestratorV2Callbacks);
  constructor(options: OrchestratorV2Options);
  constructor(callbacksOrOptions: OrchestratorV2Callbacks | OrchestratorV2Options) {
    if ('callbacks' in callbacksOrOptions) {
      this.callbacks = callbacksOrOptions.callbacks;
      this.generationToken = callbacksOrOptions.generationToken;
    } else {
      this.callbacks = callbacksOrOptions;
    }
  }
  
  // Check if this orchestrator instance is still valid (not superseded by a new generation)
  private async isTokenStillValid(projectId: number): Promise<boolean> {
    try {
      const project = await storage.getProject(projectId);
      if (!project) return false;
      
      // If WE don't have a token but the DB has one, a newer process took over
      if (!this.generationToken && project.generationToken) {
        console.log(`[OrchestratorV2] Legacy process (no token) superseded by new process with token ${project.generationToken} for project ${projectId}. Stopping.`);
        return false;
      }
      
      // If we have a token, check it matches the DB
      if (this.generationToken && project.generationToken && project.generationToken !== this.generationToken) {
        console.log(`[OrchestratorV2] Token mismatch for project ${projectId}: ours=${this.generationToken}, DB=${project.generationToken}. Stopping obsolete process.`);
        return false;
      }
      
      return true;
    } catch (error) {
      console.error(`[OrchestratorV2] Error checking token validity:`, error);
      return true; // On error, continue to avoid stopping valid processes
    }
  }
  
  // Combined check: cancelled OR token invalid = should stop
  private async shouldStopProcessing(projectId: number): Promise<boolean> {
    // First check if project was cancelled via normal mechanisms
    if (await isProjectCancelledFromDb(projectId)) {
      return true;
    }
    
    // Then check if our token is still valid (prevents parallel executions)
    if (!(await this.isTokenStillValid(projectId))) {
      console.log(`[OrchestratorV2] Stopping obsolete process for project ${projectId} - new generation started`);
      return true;
    }
    
    return false;
  }

  private getInsertionDescription(insertionPoint: string): string {
    switch (insertionPoint) {
      case "beginning": return "Integrar al INICIO del capitulo";
      case "end": return "Integrar al FINAL del capitulo";
      case "middle": return "Integrar en una transicion natural del capitulo";
      case "replace": return "Reemplazar pasaje existente con";
      default: return "Integrar organicamente";
    }
  }

  private addTokenUsage(usage?: TokenUsage) {
    if (usage) {
      this.cumulativeTokens.inputTokens += usage.inputTokens || 0;
      this.cumulativeTokens.outputTokens += usage.outputTokens || 0;
      this.cumulativeTokens.thinkingTokens += usage.thinkingTokens || 0;
    }
  }

  private async updateProjectTokens(projectId: number) {
    await storage.updateProject(projectId, {
      totalInputTokens: this.cumulativeTokens.inputTokens,
      totalOutputTokens: this.cumulativeTokens.outputTokens,
      totalThinkingTokens: this.cumulativeTokens.thinkingTokens,
    });
  }

  private async logAiUsage(
    projectId: number,
    agentName: string,
    model: string,
    usage?: TokenUsage,
    chapterNumber?: number
  ) {
    if (!usage) return;
    
    try {
      const costs = calculateRealCost(
        model,
        usage.inputTokens || 0,
        usage.outputTokens || 0,
        usage.thinkingTokens || 0
      );
      
      await storage.createAiUsageEvent({
        projectId,
        agentName,
        model,
        inputTokens: usage.inputTokens || 0,
        outputTokens: usage.outputTokens || 0,
        thinkingTokens: usage.thinkingTokens || 0,
        inputCostUsd: formatCostForStorage(costs.inputCost),
        outputCostUsd: formatCostForStorage(costs.outputCost + costs.thinkingCost),
        totalCostUsd: formatCostForStorage(costs.totalCost),
        chapterNumber,
        operation: "generate",
      });
    } catch (err) {
      console.error(`[OrchestratorV2] Failed to log AI usage for ${agentName}:`, err);
    }
  }

  // ============================================
  // THOUGHT LOG SYSTEM FOR V2 AGENTS
  // ============================================

  /**
   * Save agent's reasoning/thinking to thought logs for context sharing
   */
  private async saveThoughtLog(
    projectId: number,
    agentName: string,
    agentRole: string,
    thoughtContent: string,
    chapterId?: number
  ): Promise<void> {
    if (!thoughtContent || thoughtContent.length < 50) return; // Skip trivial thoughts
    
    try {
      // Truncate very long thoughts to prevent DB bloat
      const truncatedThought = thoughtContent.length > 8000 
        ? thoughtContent.substring(0, 8000) + "\n\n[...truncado por longitud...]"
        : thoughtContent;
      
      await storage.createThoughtLog({
        projectId,
        chapterId: chapterId || null,
        agentName,
        agentRole,
        thoughtContent: truncatedThought,
      });
      
      console.log(`[OrchestratorV2] Saved thought log from ${agentName} (${truncatedThought.length} chars)`);
    } catch (err) {
      console.error(`[OrchestratorV2] Failed to save thought log for ${agentName}:`, err);
    }
  }

  /**
   * Get recent thought logs as context for agents
   * Returns a summary of recent agent reasoning to inform subsequent agents
   */
  private async getThoughtContext(projectId: number, limit: number = 10): Promise<string> {
    try {
      const logs = await storage.getThoughtLogsByProject(projectId);
      if (logs.length === 0) return "";
      
      // Get the most recent logs
      const recentLogs = logs.slice(0, limit);
      
      const contextLines = recentLogs.map(log => {
        const preview = log.thoughtContent.substring(0, 500);
        return `[${log.agentName}] ${preview}${log.thoughtContent.length > 500 ? '...' : ''}`;
      });
      
      return `
═══════════════════════════════════════════════════════════════════
📝 CONTEXTO DE RAZONAMIENTO DE AGENTES ANTERIORES:
═══════════════════════════════════════════════════════════════════
${contextLines.join('\n\n')}
═══════════════════════════════════════════════════════════════════
Usa este contexto para mantener coherencia con las decisiones previas.
`;
    } catch (err) {
      console.error(`[OrchestratorV2] Failed to get thought context:`, err);
      return "";
    }
  }

  /**
   * Extract key decisions from thought logs for specific chapter
   * Provides focused context about decisions made for a chapter
   */
  private async getChapterDecisionContext(projectId: number, chapterNumber: number): Promise<string> {
    try {
      const logs = await storage.getThoughtLogsByProject(projectId);
      
      // Filter logs related to this chapter or recent planning
      const relevantLogs = logs.filter(log => {
        const content = log.thoughtContent.toLowerCase();
        return content.includes(`capítulo ${chapterNumber}`) ||
               content.includes(`chapter ${chapterNumber}`) ||
               log.agentRole === 'global-architect' ||
               log.agentRole === 'chapter-architect';
      }).slice(0, 5);
      
      if (relevantLogs.length === 0) return "";
      
      const decisions = relevantLogs.map(log => {
        const preview = log.thoughtContent.substring(0, 400);
        return `• [${log.agentName}]: ${preview}${log.thoughtContent.length > 400 ? '...' : ''}`;
      });
      
      return `
🧠 DECISIONES DE PLANIFICACIÓN RELEVANTES:
${decisions.join('\n')}
`;
    } catch (err) {
      console.error(`[OrchestratorV2] Failed to get chapter decision context:`, err);
      return "";
    }
  }

  // ============================================
  // ISSUE HASH TRACKING SYSTEM (synced with reedit-orchestrator)
  // ============================================

  /**
   * Generate a hash for an issue to track if it has been resolved.
   * Uses category + simplified description + affected chapters to create stable ID.
   */
  private generateIssueHash(issue: Pick<FinalReviewIssue, 'categoria' | 'descripcion' | 'capitulos_afectados'>): string {
    // Normalize description: lowercase, remove extra spaces, keep first 100 chars
    const normalizedDesc = (issue.descripcion || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim()
      .substring(0, 100);
    
    // Sort chapters for consistent hashing
    const chapters = (issue.capitulos_afectados || []).sort((a, b) => a - b).join(",");
    
    // Create hash from category + description + chapters
    const hashInput = `${issue.categoria || "unknown"}|${normalizedDesc}|${chapters}`;
    
    // Simple string hash (djb2 algorithm)
    let hash = 5381;
    for (let i = 0; i < hashInput.length; i++) {
      hash = ((hash << 5) + hash) + hashInput.charCodeAt(i);
    }
    return `issue_${Math.abs(hash).toString(16)}`;
  }
  
  /**
   * Filter out issues that have already been resolved in previous cycles.
   */
  private filterNewIssues(
    issues: FinalReviewIssue[],
    resolvedHashes: string[]
  ): { newIssues: FinalReviewIssue[]; filteredCount: number } {
    const resolvedSet = new Set(resolvedHashes);
    const newIssues: FinalReviewIssue[] = [];
    let filteredCount = 0;
    
    for (const issue of issues) {
      const hash = this.generateIssueHash(issue);
      if (resolvedSet.has(hash)) {
        console.log(`[OrchestratorV2] Filtering resolved issue: ${issue.categoria} - ${issue.descripcion?.substring(0, 50)}...`);
        filteredCount++;
      } else {
        newIssues.push(issue);
      }
    }
    
    if (filteredCount > 0) {
      console.log(`[OrchestratorV2] Filtered ${filteredCount} previously resolved issues, ${newIssues.length} new issues remain`);
    }
    
    return { newIssues, filteredCount };
  }
  
  /**
   * Mark issues as resolved by adding their hashes to the project's resolved list.
   */
  private async markIssuesResolved(projectId: number, issues: FinalReviewIssue[]): Promise<void> {
    if (issues.length === 0) return;
    
    const project = await storage.getProject(projectId);
    const existingHashes = (project?.resolvedIssueHashes as string[]) || [];
    
    const newHashes = issues.map(issue => this.generateIssueHash(issue));
    const combinedHashes = [...existingHashes, ...newHashes];
    const allHashes = combinedHashes.filter((hash, index) => combinedHashes.indexOf(hash) === index);
    
    await storage.updateProject(projectId, {
      resolvedIssueHashes: allHashes as any,
    });
    
    console.log(`[OrchestratorV2] Marked ${newHashes.length} issues as resolved (total hashes: ${allHashes.length})`);
  }

  // ============================================
  // UNIVERSAL CONSISTENCY MODULE INTEGRATION
  // ============================================

  private async initializeConsistencyDatabase(projectId: number, worldBible: any, genre: string): Promise<void> {
    console.log(`[OrchestratorV2] Initializing consistency database for project ${projectId}`);
    
    try {
      console.log(`[OrchestratorV2] Checking existing entities...`);
      const existingEntities = await storage.getWorldEntitiesByProject(projectId);
      if (existingEntities.length > 0) {
        console.log(`[OrchestratorV2] Consistency DB already initialized (${existingEntities.length} entities)`);
        this.callbacks.onAgentStatus("universal-consistency", "completed", `Using ${existingEntities.length} existing entities`);
        return;
      }

      const characters = worldBible.characters || [];
      const rules = worldBible.worldRules || [];
      console.log(`[OrchestratorV2] Extracting entities from ${characters.length} characters and ${rules.length} rules...`);

      const { entities, rules: extractedRules } = await universalConsistencyAgent.extractInitialEntities(
        characters,
        rules,
        genre,
        projectId
      );

      console.log(`[OrchestratorV2] Creating ${entities.length} entities in database...`);
      for (let i = 0; i < entities.length; i++) {
        await storage.createWorldEntity(entities[i]);
        if ((i + 1) % 10 === 0) {
          console.log(`[OrchestratorV2] Created ${i + 1}/${entities.length} entities...`);
        }
      }

      console.log(`[OrchestratorV2] Creating ${extractedRules.length} rules in database...`);
      for (const rule of extractedRules) {
        await storage.createWorldRule(rule);
      }

      console.log(`[OrchestratorV2] Initialized: ${entities.length} entities, ${extractedRules.length} rules`);
      this.callbacks.onAgentStatus("universal-consistency", "completed", `Initialized ${entities.length} entities, ${extractedRules.length} rules`);
    } catch (error) {
      console.error(`[OrchestratorV2] Error initializing consistency database:`, error);
      // Don't fail the entire pipeline for consistency errors - continue without
      this.callbacks.onAgentStatus("universal-consistency", "error", `Error: ${error instanceof Error ? error.message : 'Unknown'}`);
    }
  }

  private async getConsistencyContext(projectId: number): Promise<{
    entities: Array<{ name: string; type: string; attributes: any; status: string; lastSeenChapter?: number }>;
    rules: Array<{ ruleDescription: string; category: string }>;
    relationships: Array<{ subject: string; target: string; relationType: string; meta?: any }>;
  }> {
    const [dbEntities, dbRules, dbRelationships] = await Promise.all([
      storage.getWorldEntitiesByProject(projectId),
      storage.getWorldRulesByProject(projectId),
      storage.getEntityRelationshipsByProject(projectId),
    ]);

    const entityMap = new Map(dbEntities.map(e => [e.id, e.name]));

    return {
      entities: dbEntities.map(e => ({
        name: e.name,
        type: e.type,
        attributes: e.attributes || {},
        status: e.status,
        lastSeenChapter: e.lastSeenChapter || undefined,
      })),
      rules: dbRules.map(r => ({
        ruleDescription: r.ruleDescription,
        category: r.category || 'GENERAL',
      })),
      relationships: dbRelationships.map(r => ({
        subject: entityMap.get(r.subjectId) || `Entity#${r.subjectId}`,
        target: entityMap.get(r.targetId) || `Entity#${r.targetId}`,
        relationType: r.relationType,
        meta: r.meta || {},
      })),
    };
  }

  /**
   * Extract timeline info from worldBible for consistency constraints
   * Includes current chapter timing, previous chapter timing, and travel times
   */
  private extractTimelineInfo(
    worldBible: any,
    currentChapter: number,
    previousChapter?: number
  ): {
    chapter_timeline?: Array<{ chapter: number; day: string; time_of_day: string; duration?: string; location?: string }>;
    previous_chapter?: { day: string; time_of_day: string; location?: string };
    current_chapter?: { day: string; time_of_day: string; location?: string };
    travel_times?: Array<{ from: string; to: string; by_car?: string; by_plane?: string; by_train?: string }>;
  } | undefined {
    const result: any = {};
    
    // LitAgents 2.1: Check both direct worldBible and plotOutline for backward compatibility
    const plotOutline = worldBible?.plotOutline as any;
    const timelineMaster = worldBible?.timeline_master || plotOutline?.timeline_master;
    const locationMap = worldBible?.location_map || plotOutline?.location_map;
    
    // Extract timeline_master if available
    if (timelineMaster?.chapter_timeline) {
      const timeline = timelineMaster.chapter_timeline;
      result.chapter_timeline = timeline;
      
      // Find current and previous chapter info
      const currentInfo = timeline.find((t: any) => t.chapter === currentChapter);
      if (currentInfo) {
        result.current_chapter = {
          day: currentInfo.day,
          time_of_day: currentInfo.time_of_day,
          location: currentInfo.location
        };
      }
      
      if (previousChapter !== undefined) {
        const prevInfo = timeline.find((t: any) => t.chapter === previousChapter);
        if (prevInfo) {
          result.previous_chapter = {
            day: prevInfo.day,
            time_of_day: prevInfo.time_of_day,
            location: prevInfo.location
          };
        }
      }
    }
    
    // Extract travel times from location_map
    if (locationMap?.travel_times) {
      result.travel_times = locationMap.travel_times;
    }
    
    return Object.keys(result).length > 0 ? result : undefined;
  }

  /**
   * Extract character states for the current chapter from worldBible
   * Includes location, physical state, injuries, and possessions
   */
  private extractCharacterStates(
    worldBible: any,
    chapterNumber: number
  ): Array<{
    character: string;
    current_location?: string;
    physical_state?: string;
    active_injuries?: string[];
    key_possessions?: string[];
  }> | undefined {
    const states: any[] = [];
    
    // LitAgents 2.1: Check both direct worldBible and plotOutline for backward compatibility
    const plotOutline = worldBible?.plotOutline as any;
    const characterTracking = worldBible?.character_tracking || plotOutline?.character_tracking;
    
    // Extract from character_tracking if available
    if (characterTracking && Array.isArray(characterTracking)) {
      for (const tracking of characterTracking) {
        if (!tracking.chapter_states) continue;
        
        // Find the most recent state before or at current chapter
        const relevantStates = tracking.chapter_states
          .filter((s: any) => s.chapter <= chapterNumber)
          .sort((a: any, b: any) => b.chapter - a.chapter);
        
        if (relevantStates.length > 0) {
          const latestState = relevantStates[0];
          states.push({
            character: tracking.character,
            current_location: latestState.location,
            physical_state: latestState.physical_state,
            active_injuries: latestState.physical_state?.toLowerCase().includes('herida') || latestState.physical_state?.toLowerCase().includes('lesion')
              ? [latestState.physical_state]
              : undefined,
            key_possessions: latestState.key_possessions
          });
        }
      }
    }
    
    // Also extract initial_state from characters if no tracking available
    if (states.length === 0 && worldBible?.characters) {
      for (const char of worldBible.characters) {
        if (char.initial_state) {
          states.push({
            character: char.name,
            current_location: char.initial_state.location,
            physical_state: char.initial_state.physical_condition,
            key_possessions: char.initial_state.resources
          });
        }
      }
    }
    
    return states.length > 0 ? states : undefined;
  }

  /**
   * Merge new plot decisions with existing ones (avoid duplicates by decision text)
   */
  private mergeDecisions(existing: any[], newDecisions: any[]): any[] {
    const seen = new Set(existing.map(d => `${d.decision}-${d.capitulo_establecido}`));
    const merged = [...existing];
    
    for (const decision of newDecisions) {
      const key = `${decision.decision}-${decision.capitulo_establecido}`;
      if (!seen.has(key)) {
        merged.push(decision);
        seen.add(key);
      }
    }
    
    return merged;
  }

  /**
   * Merge new injuries with existing ones (avoid duplicates by character + injury type + chapter)
   */
  private mergeInjuries(existing: any[], newInjuries: any[]): any[] {
    const seen = new Set(existing.map(i => `${i.personaje}-${i.tipo_lesion}-${i.capitulo_ocurre}`));
    const merged = [...existing];
    
    for (const injury of newInjuries) {
      const key = `${injury.personaje}-${injury.tipo_lesion}-${injury.capitulo_ocurre}`;
      if (!seen.has(key)) {
        merged.push(injury);
        seen.add(key);
      }
    }
    
    return merged;
  }
  
  /**
   * Update World Bible after a chapter is rewritten
   * Extracts plot decisions, injuries, and character changes from the corrected issues
   */
  private async updateWorldBibleFromChapter(
    projectId: number, 
    chapterNumber: number, 
    newContent: string,
    correctedIssues: Array<{ source?: string; descripcion?: string; correccion?: string; tipo?: string; capitulo?: number }>
  ): Promise<void> {
    const worldBible = await storage.getWorldBibleByProject(projectId);
    if (!worldBible) return;
    
    const updates: any = {};
    let hasUpdates = false;
    
    // Extract new plot decisions from corrections (continuity fixes often establish new canon)
    const newDecisions: any[] = [];
    const newInjuries: any[] = [];
    
    for (const issue of correctedIssues) {
      // If correction was about continuity, create a plot decision to track it
      if (issue.source === 'continuity_sentinel' || issue.tipo?.includes('continuidad')) {
        if (issue.correccion || issue.descripcion) {
          newDecisions.push({
            decision: issue.correccion || `Corregido: ${issue.descripcion}`,
            capitulo_establecido: chapterNumber,
            categoria: 'correccion_continuidad',
            consistencia_actual: 'consistente',
            fecha_registro: new Date().toISOString(),
          });
        }
      }
      
      // If correction mentions injuries/conditions, track them
      if (issue.descripcion?.toLowerCase().includes('lesion') || 
          issue.descripcion?.toLowerCase().includes('herida') ||
          issue.descripcion?.toLowerCase().includes('injury')) {
        // Try to extract character name from description
        const charMatch = issue.descripcion.match(/(?:personaje|character|protagonist[a]?)\s+(\w+)/i);
        if (charMatch) {
          newInjuries.push({
            personaje: charMatch[1],
            tipo_lesion: 'corregida',
            descripcion: issue.correccion || issue.descripcion,
            capitulo_ocurre: chapterNumber,
            estado_actual: 'activa',
          });
        }
      }
    }
    
    // Merge new decisions
    if (newDecisions.length > 0) {
      const existingDecisions = Array.isArray(worldBible.plotDecisions) ? worldBible.plotDecisions : [];
      updates.plotDecisions = this.mergeDecisions(existingDecisions as any[], newDecisions);
      hasUpdates = true;
    }
    
    // Merge new injuries
    if (newInjuries.length > 0) {
      const existingInjuries = Array.isArray(worldBible.persistentInjuries) ? worldBible.persistentInjuries : [];
      updates.persistentInjuries = this.mergeInjuries(existingInjuries as any[], newInjuries);
      hasUpdates = true;
    }
    
    // Update chapter summary in timeline if available
    const existingTimeline = (worldBible.timeline || []) as any[];
    const chapterEvent = existingTimeline.find((e: any) => e.chapter === chapterNumber);
    if (!chapterEvent && newContent.length > 500) {
      // Add a new timeline event for this chapter with summary from first 200 chars
      const summary = newContent.substring(0, 200).replace(/\n/g, ' ').trim() + '...';
      updates.timeline = [
        ...existingTimeline,
        {
          chapter: chapterNumber,
          event: `Capítulo ${chapterNumber} reescrito`,
          summary: summary,
          timestamp: new Date().toISOString(),
        }
      ];
      hasUpdates = true;
    }
    
    if (hasUpdates) {
      await storage.updateWorldBible(worldBible.id, updates);
      console.log(`[OrchestratorV2] World Bible updated after Chapter ${chapterNumber} rewrite: ${newDecisions.length} decisions, ${newInjuries.length} injuries`);
    }
  }

  /**
   * Extract injuries from chapter content using AI
   * LitAgents 2.1: Automatic injury detection to prevent continuity issues
   */
  private async extractInjuriesFromChapter(
    projectId: number,
    chapterNumber: number,
    chapterContent: string,
    characters: any[]
  ): Promise<void> {
    if (!chapterContent || chapterContent.length < 500) return;
    
    const characterNames = characters
      .filter(c => c.nombre || c.name)
      .map(c => c.nombre || c.name)
      .slice(0, 20);
    
    if (characterNames.length === 0) return;
    
    const prompt = `Analiza este capítulo y extrae SOLO las lesiones, heridas o condiciones físicas SIGNIFICATIVAS que sufren los personajes.

PERSONAJES CONOCIDOS: ${characterNames.join(', ')}

CAPÍTULO ${chapterNumber}:
${chapterContent.substring(0, 8000)}

INSTRUCCIONES:
- Solo reporta lesiones SIGNIFICATIVAS que afectarían acciones futuras
- Ignora moretones menores, cansancio normal, etc.
- Incluye: disparos, cortes profundos, huesos rotos, quemaduras, envenenamientos, cirugías, amputaciones

Responde en JSON:
{
  "injuries": [
    {
      "personaje": "Nombre del personaje",
      "tipo_lesion": "Descripción breve de la lesión",
      "parte_afectada": "brazo/pierna/torso/cabeza/etc",
      "severidad": "leve|moderada|grave|critica",
      "efecto_esperado": "Qué limitaciones debería tener en capítulos siguientes",
      "es_temporal": false
    }
  ]
}

Si NO hay lesiones significativas, responde: {"injuries": []}`;

    try {
      const response = await this.callAI(prompt, "deepseek-chat", 0.3, 1500);
      this.addTokenUsage(response.tokenUsage);
      
      // Robust JSON parsing with multiple recovery strategies
      let parsed: { injuries: any[] } | null = null;
      const content = response.content;
      
      // Strategy 1: Match JSON object containing "injuries"
      const jsonMatch = content.match(/\{[\s\S]*"injuries"[\s\S]*\}/);
      if (jsonMatch) {
        try {
          parsed = JSON.parse(jsonMatch[0]);
        } catch (e) {
          // Strategy 2: Find first { and last } for malformed JSON
          const firstBrace = content.indexOf('{');
          const lastBrace = content.lastIndexOf('}');
          if (firstBrace !== -1 && lastBrace > firstBrace) {
            try {
              parsed = JSON.parse(content.substring(firstBrace, lastBrace + 1));
            } catch (e2) {
              // Strategy 3: Try to extract just the injuries array
              const arrayMatch = content.match(/\[[\s\S]*?\]/);
              if (arrayMatch) {
                try {
                  const injuries = JSON.parse(arrayMatch[0]);
                  if (Array.isArray(injuries)) {
                    parsed = { injuries };
                  }
                } catch (e3) {
                  console.warn(`[OrchestratorV2] All JSON parsing strategies failed for Chapter ${chapterNumber}`);
                }
              }
            }
          }
        }
      }
      
      if (!parsed || !Array.isArray(parsed.injuries) || parsed.injuries.length === 0) {
        return;
      }
      
      // Validate required fields and filter invalid entries
      const validInjuries = parsed.injuries.filter((injury: any) => {
        if (!injury || typeof injury !== 'object') return false;
        if (!injury.personaje || typeof injury.personaje !== 'string') return false;
        if (!injury.tipo_lesion || typeof injury.tipo_lesion !== 'string') return false;
        // Check personaje is in known characters (case-insensitive)
        const normalizedName = injury.personaje.toLowerCase().trim();
        return characterNames.some(name => name.toLowerCase().trim() === normalizedName || 
          name.toLowerCase().includes(normalizedName) || 
          normalizedName.includes(name.toLowerCase()));
      });
      
      if (validInjuries.length === 0) return;
      
      // Get existing world bible
      const worldBible = await storage.getWorldBibleByProject(projectId);
      if (!worldBible) return;
      
      const existingInjuries = Array.isArray(worldBible.persistentInjuries) ? worldBible.persistentInjuries : [];
      
      // Validate and normalize severidad
      const validSeveridades = ["leve", "moderada", "grave", "critica"];
      
      // Prepare new injuries with proper format
      const newInjuries = validInjuries.map((injury: any) => ({
        personaje: injury.personaje.trim(),
        tipo_lesion: injury.tipo_lesion.trim(),
        parte_afectada: (injury.parte_afectada || "no especificada").trim(),
        capitulo_ocurre: chapterNumber,
        severidad: validSeveridades.includes(injury.severidad?.toLowerCase()) 
          ? injury.severidad.toLowerCase() 
          : "moderada",
        efecto_esperado: (injury.efecto_esperado || "Movimiento limitado").trim(),
        estado_actual: "activa",
        es_temporal: injury.es_temporal === true,
        fecha_registro: new Date().toISOString(),
      }));
      
      // Merge avoiding duplicates
      const mergedInjuries = this.mergeInjuries(existingInjuries as any[], newInjuries);
      
      await storage.updateWorldBible(worldBible.id, {
        persistentInjuries: mergedInjuries,
      });
      
      console.log(`[OrchestratorV2] Extracted ${newInjuries.length} injuries from Chapter ${chapterNumber}:`, 
        newInjuries.map((i: any) => `${i.personaje}: ${i.tipo_lesion}`).join(', '));
      
    } catch (error) {
      console.warn(`[OrchestratorV2] Error extracting injuries from Chapter ${chapterNumber}:`, error);
    }
  }

  /**
   * Format plot decisions and injuries as constraints for agents
   */
  private formatDecisionsAndInjuriesAsConstraints(
    plotDecisions: any[] | undefined,
    persistentInjuries: any[] | undefined,
    currentChapter: number
  ): string {
    const parts: string[] = [];
    
    // Format plot decisions that affect current or previous chapters
    if (plotDecisions && plotDecisions.length > 0) {
      const relevantDecisions = plotDecisions.filter(d => 
        d.capitulo_establecido <= currentChapter || 
        (d.capitulos_afectados || []).some((c: number) => c <= currentChapter)
      );
      
      if (relevantDecisions.length > 0) {
        parts.push("\n=== DECISIONES DE TRAMA ESTABLECIDAS ===");
        parts.push("ESTAS DECISIONES SON CANÓNICAS Y NO PUEDEN CONTRADECIRSE:");
        
        for (const decision of relevantDecisions) {
          const status = decision.consistencia_actual === "consistente" ? "✓" : "⚠️ INCONSISTENTE";
          parts.push(`\n${status} "${decision.decision}" (Cap ${decision.capitulo_establecido})`);
          if (decision.capitulos_afectados?.length > 0) {
            parts.push(`   Afecta capítulos: ${decision.capitulos_afectados.join(", ")}`);
          }
          if (decision.consistencia_actual === "inconsistente" && decision.detalle_inconsistencia) {
            parts.push(`   PROBLEMA: ${decision.detalle_inconsistencia}`);
            parts.push(`   → CORREGIR en este capítulo si aplica`);
          }
        }
      }
    }
    
    // Format persistent injuries
    if (persistentInjuries && persistentInjuries.length > 0) {
      const activeInjuries = persistentInjuries.filter(i => 
        i.capitulo_ocurre <= currentChapter &&
        i.estado_actual !== "resuelta"
      );
      
      if (activeInjuries.length > 0) {
        parts.push("\n\n=== LESIONES PERSISTENTES ACTIVAS ===");
        parts.push("ESTAS LESIONES DEBEN REFLEJARSE EN EL COMPORTAMIENTO DEL PERSONAJE:");
        
        for (const injury of activeInjuries) {
          const isIgnored = injury.seguimiento === "ignorada" || injury.seguimiento === "olvidada";
          const icon = isIgnored ? "🚨" : "🩹";
          
          parts.push(`\n${icon} ${injury.personaje}: ${injury.tipo_lesion} (desde Cap ${injury.capitulo_ocurre})`);
          parts.push(`   Efecto esperado: ${injury.efecto_esperado}`);
          
          if (isIgnored) {
            parts.push(`   ⚠️ ADVERTENCIA: Esta lesión fue IGNORADA en capítulos anteriores`);
            parts.push(`   → OBLIGATORIO: Mostrar efectos de esta lesión en este capítulo`);
            if (injury.opcion_correccion) {
              parts.push(`   Sugerencia: ${injury.opcion_correccion}`);
            }
          }
        }
      }
    }
    
    return parts.join("\n");
  }

  /**
   * Build options for enriched writing context including KU optimization and series info.
   * Centralized helper to ensure consistent handling across all writing flows.
   */
  private async buildEnrichedContextOptions(project: Project): Promise<{
    kindleUnlimitedOptimized?: boolean;
    seriesInfo?: {
      seriesTitle: string;
      bookNumber: number;
      totalBooks?: number;
      previousBooksSummary?: string;
    };
  }> {
    const options: {
      kindleUnlimitedOptimized?: boolean;
      seriesInfo?: {
        seriesTitle: string;
        bookNumber: number;
        totalBooks?: number;
        previousBooksSummary?: string;
      };
    } = {};
    
    // Add KU optimization if enabled
    if (project.kindleUnlimitedOptimized) {
      options.kindleUnlimitedOptimized = true;
    }
    
    // Add series context if part of a series
    if (project.seriesId && project.seriesOrder) {
      try {
        const series = await storage.getSeries(project.seriesId);
        if (series) {
          options.seriesInfo = {
            seriesTitle: series.title,
            bookNumber: project.seriesOrder,
            totalBooks: series.totalPlannedBooks || undefined,
          };
          
          // For books >1, fetch context from previous books
          if (project.seriesOrder > 1) {
            const seriesProjects = await storage.getProjectsBySeries(project.seriesId);
            const previousBooks = seriesProjects
              .filter(p => p.seriesOrder && p.seriesOrder < project.seriesOrder! && p.status === 'completed')
              .sort((a, b) => (a.seriesOrder || 0) - (b.seriesOrder || 0));
            
            if (previousBooks.length > 0) {
              const contexts: string[] = [];
              for (const prevBook of previousBooks) {
                const prevWorldBible = await storage.getWorldBibleByProject(prevBook.id);
                if (prevWorldBible) {
                  const chars = Array.isArray(prevWorldBible.characters) ? prevWorldBible.characters : [];
                  const mainChars = chars.slice(0, 3).map((c: any) => c.name || c.nombre).join(", ");
                  contexts.push(`Libro ${prevBook.seriesOrder}: "${prevBook.title}" - Personajes: ${mainChars}`);
                }
              }
              if (contexts.length > 0) {
                options.seriesInfo.previousBooksSummary = contexts.join('\n');
              }
            }
          }
        }
      } catch (err) {
        console.error(`[OrchestratorV2] Failed to get series context:`, err);
      }
    }
    
    return options;
  }

  /**
   * Build enriched writing context with detailed character info, world rules, and error patterns to avoid.
   * This helps prevent consistency errors from the initial writing stage.
   */
  private async buildEnrichedWritingContext(
    projectId: number,
    chapterNumber: number,
    worldBible: any,
    options?: {
      kindleUnlimitedOptimized?: boolean;
      seriesInfo?: {
        seriesTitle: string;
        bookNumber: number;
        totalBooks?: number;
        previousBooksSummary?: string;
      };
    }
  ): Promise<string> {
    const parts: string[] = [];
    
    // 0. Kindle Unlimited optimization guidelines (if enabled)
    if (options?.kindleUnlimitedOptimized) {
      parts.push("=== ⚡ OPTIMIZACIÓN KINDLE UNLIMITED (KU) ===");
      parts.push("Este libro está optimizado para KU. REQUISITOS OBLIGATORIOS:");
      parts.push("• Ganchos fuertes al inicio de cada capítulo para retener lectores");
      parts.push("• Cliffhangers al final de cada capítulo para incentivar lectura continua");
      parts.push("• Ritmo ágil: evitar descripciones excesivas o párrafos muy largos");
      parts.push("• Diálogos dinámicos y frecuentes para aumentar velocidad de lectura");
      parts.push("• Capítulos de longitud consistente (2000-3500 palabras ideal)");
      parts.push("• Tensión constante: cada escena debe avanzar la trama");
      parts.push("• Evitar flashbacks extensos que interrumpan el momentum");
      parts.push("");
    }
    
    // 0.1. Series context (if part of a series)
    if (options?.seriesInfo) {
      const { seriesTitle, bookNumber, totalBooks, previousBooksSummary } = options.seriesInfo;
      parts.push(`=== 📚 CONTEXTO DE SERIE: "${seriesTitle}" ===`);
      parts.push(`Este es el LIBRO ${bookNumber}${totalBooks ? ` de ${totalBooks}` : ""} de la serie.`);
      
      if (bookNumber > 1) {
        parts.push("\nCONSIDERACIONES PARA LIBROS POSTERIORES:");
        parts.push("• Los personajes recurrentes deben mantener consistencia con libros anteriores");
        parts.push("• Proporcionar contexto sutil para nuevos lectores sin aburrir a fans");
        parts.push("• Respetar eventos y decisiones de libros anteriores");
        parts.push("• Mantener el tono y estilo establecido en la serie");
        
        if (previousBooksSummary) {
          parts.push("\nRESUMEN DE LIBROS ANTERIORES:");
          parts.push(previousBooksSummary.substring(0, 1000));
        }
      } else {
        parts.push("\nCONSIDERACIONES PARA PRIMER LIBRO DE SERIE:");
        parts.push("• Establecer claramente el mundo y los personajes principales");
        parts.push("• Plantar semillas para arcos futuros sin resolver todo");
        parts.push("• Crear ganchos que inviten a continuar la serie");
        parts.push("• Dejar hilos argumentales abiertos de forma intencional");
      }
      parts.push("");
    }
    
    // 1. Detailed character profiles with relationships and arcs
    const characters = worldBible?.characters || [];
    if (characters.length > 0) {
      parts.push("\n=== PERFILES DE PERSONAJES (OBLIGATORIO RESPETAR) ===");
      
      const mainCharacters = characters.slice(0, 8); // Top 8 characters
      for (const char of mainCharacters) {
        parts.push(`\n📌 ${char.name || char.nombre}:`);
        if (char.description || char.descripcion) {
          parts.push(`   Descripción: ${(char.description || char.descripcion).substring(0, 200)}`);
        }
        if (char.personality || char.personalidad) {
          parts.push(`   Personalidad: ${char.personality || char.personalidad}`);
        }
        if (char.traits || char.rasgos) {
          const traits = Array.isArray(char.traits || char.rasgos) 
            ? (char.traits || char.rasgos).join(", ")
            : char.traits || char.rasgos;
          parts.push(`   Rasgos distintivos: ${traits}`);
        }
        if (char.relationships || char.relaciones) {
          const rels = Array.isArray(char.relationships || char.relaciones)
            ? (char.relationships || char.relaciones).map((r: any) => 
                typeof r === 'string' ? r : `${r.character || r.personaje}: ${r.type || r.tipo}`
              ).join("; ")
            : char.relationships || char.relaciones;
          parts.push(`   Relaciones: ${rels}`);
        }
        if (char.arc || char.arco) {
          parts.push(`   Arco narrativo: ${char.arc || char.arco}`);
        }
        if (char.voice || char.voz) {
          parts.push(`   Estilo de voz: ${char.voice || char.voz}`);
        }
      }
    }
    
    // 2. Key world rules and settings
    const rules = worldBible?.worldRules || worldBible?.rules || [];
    if (rules.length > 0) {
      parts.push("\n\n=== REGLAS DEL MUNDO (INVIOLABLES) ===");
      const topRules = rules.slice(0, 10);
      for (const rule of topRules) {
        if (typeof rule === 'string') {
          parts.push(`• ${rule}`);
        } else if (rule.rule || rule.regla) {
          parts.push(`• ${rule.rule || rule.regla}`);
          if (rule.exception || rule.excepcion) {
            parts.push(`  (Excepción: ${rule.exception || rule.excepcion})`);
          }
        }
      }
    }
    
    // 3. Key locations with details (LitAgents 2.1: also check settings in plotOutline)
    const plotOutlineData = worldBible?.plotOutline as any;
    const locations = worldBible?.locations || worldBible?.ubicaciones || worldBible?.settings || plotOutlineData?.settings || [];
    if (locations.length > 0) {
      parts.push("\n\n=== UBICACIONES CLAVE ===");
      const topLocations = locations.slice(0, 6);
      for (const loc of topLocations) {
        const name = loc.name || loc.nombre || loc;
        const desc = loc.description || loc.descripcion || "";
        parts.push(`• ${name}${desc ? `: ${desc.substring(0, 100)}` : ""}`);
      }
    }
    
    // 4. Common error patterns to AVOID (from consistency violations if any)
    try {
      const violations = await storage.getConsistencyViolationsByProject(projectId);
      if (violations && violations.length > 0) {
        // Get unique violation types
        const recentViolations = violations.slice(0, 10);
        const violationPatterns = new Set<string>();
        
        for (const v of recentViolations) {
          if (v.description) {
            // Extract the pattern from the violation
            violationPatterns.add(`NO REPETIR: ${v.description.substring(0, 150)}`);
          }
        }
        
        if (violationPatterns.size > 0) {
          parts.push("\n\n=== ⚠️ ERRORES ANTERIORES A EVITAR ===");
          parts.push("Estos errores se detectaron anteriormente. NO los repitas:");
          for (const pattern of Array.from(violationPatterns).slice(0, 5)) {
            parts.push(`• ${pattern}`);
          }
        }
      }
    } catch (err) {
      // Silently ignore if consistency violations table doesn't exist
    }
    
    // 5. Timeline context (what has happened up to this chapter)
    const timeline = worldBible?.timeline || [];
    if (timeline.length > 0 && chapterNumber > 1) {
      parts.push("\n\n=== EVENTOS PREVIOS RELEVANTES ===");
      const priorEvents = timeline
        .filter((e: any) => (e.chapter || e.capitulo || 0) < chapterNumber)
        .slice(-5); // Last 5 events before this chapter
      
      for (const event of priorEvents) {
        const chapter = event.chapter || event.capitulo || "?";
        const desc = event.event || event.evento || event.summary || event.resumen || "";
        if (desc) {
          parts.push(`• [Cap ${chapter}] ${desc.substring(0, 150)}`);
        }
      }
    }
    
    // 6. Writing anti-patterns specific to genre
    const genre = worldBible?.genre || "";
    if (genre) {
      parts.push(`\n\n=== ANTIPATRONES A EVITAR (${genre.toUpperCase()}) ===`);
      parts.push("• NO usar deus ex machina o coincidencias forzadas");
      parts.push("• NO contradecir información establecida en capítulos anteriores");
      parts.push("• NO ignorar lesiones, heridas o condiciones físicas de personajes");
      parts.push("• NO cambiar la personalidad de un personaje sin justificación");
      parts.push("• NO saltar el tiempo sin transición clara");
      parts.push("• NO introducir personajes sin presentación adecuada");
    }
    
    // 7. Style guide from World Bible (if analyzed and saved)
    const styleGuide = (worldBible as any)?.styleGuide;
    if (styleGuide && styleGuide.length > 50) {
      parts.push("\n\n=== GUÍA DE ESTILO (OBLIGATORIO SEGUIR) ===");
      parts.push(styleGuide);
    }
    
    return parts.length > 0 ? parts.join("\n") : "";
  }

  /**
   * Analyze and summarize a style guide, extracting key writing instructions.
   * Saves the condensed style guide to the World Bible for consistent use.
   */
  private async analyzeAndSaveStyleGuide(
    projectId: number,
    styleGuideContent: string
  ): Promise<string> {
    if (!styleGuideContent || styleGuideContent.length < 50) {
      return "";
    }

    // Extract key style elements using pattern matching
    const styleElements: string[] = [];
    const lines = styleGuideContent.split(/\n+/).filter(l => l.trim().length > 10);

    // Categories to extract
    const categories = {
      voz: [] as string[],         // Narrative voice
      dialogos: [] as string[],    // Dialogue style
      vocabulario: [] as string[], // Vocabulary rules
      prohibido: [] as string[],   // Forbidden words/phrases
      tono: [] as string[],        // Tone
      estructura: [] as string[],  // Sentence structure
      puntuacion: [] as string[],  // Punctuation rules
      otros: [] as string[],       // Other rules
    };

    // Keywords for classification
    const voiceKeywords = ['narrador', 'voz', 'perspectiva', 'punto de vista', 'primera persona', 'tercera persona', 'omnisciente'];
    const dialogueKeywords = ['diálogo', 'dialogo', 'hablar', 'conversar', 'guion', 'comillas', 'dijo', 'respondió'];
    const vocabKeywords = ['vocabulario', 'palabras', 'usar', 'preferir', 'términos', 'lenguaje'];
    const forbiddenKeywords = ['evitar', 'no usar', 'prohibido', 'nunca', 'jamás', 'no escribir', 'eliminar'];
    const toneKeywords = ['tono', 'atmósfera', 'ambiente', 'sensación', 'emoción', 'sentimiento'];
    const structureKeywords = ['oraciones', 'párrafos', 'longitud', 'estructura', 'ritmo', 'cadencia'];
    const punctKeywords = ['puntuación', 'comas', 'puntos', 'signos', 'mayúsculas', 'minúsculas'];

    for (const line of lines) {
      const lowerLine = line.toLowerCase();
      
      // Classify the line
      if (voiceKeywords.some(k => lowerLine.includes(k))) {
        categories.voz.push(line.trim());
      } else if (dialogueKeywords.some(k => lowerLine.includes(k))) {
        categories.dialogos.push(line.trim());
      } else if (forbiddenKeywords.some(k => lowerLine.includes(k))) {
        categories.prohibido.push(line.trim());
      } else if (vocabKeywords.some(k => lowerLine.includes(k))) {
        categories.vocabulario.push(line.trim());
      } else if (toneKeywords.some(k => lowerLine.includes(k))) {
        categories.tono.push(line.trim());
      } else if (structureKeywords.some(k => lowerLine.includes(k))) {
        categories.estructura.push(line.trim());
      } else if (punctKeywords.some(k => lowerLine.includes(k))) {
        categories.puntuacion.push(line.trim());
      } else if (line.trim().length > 20 && line.trim().length < 300) {
        // Keep short, meaningful lines as other rules
        categories.otros.push(line.trim());
      }
    }

    // Build condensed style guide
    const parts: string[] = [];

    if (categories.voz.length > 0) {
      parts.push("VOZ NARRATIVA:");
      parts.push(...categories.voz.slice(0, 5).map(v => `  • ${v.substring(0, 200)}`));
    }

    if (categories.dialogos.length > 0) {
      parts.push("\nDIÁLOGOS:");
      parts.push(...categories.dialogos.slice(0, 5).map(d => `  • ${d.substring(0, 200)}`));
    }

    if (categories.tono.length > 0) {
      parts.push("\nTONO:");
      parts.push(...categories.tono.slice(0, 3).map(t => `  • ${t.substring(0, 200)}`));
    }

    if (categories.prohibido.length > 0) {
      parts.push("\n⚠️ EVITAR:");
      parts.push(...categories.prohibido.slice(0, 8).map(p => `  • ${p.substring(0, 200)}`));
    }

    if (categories.vocabulario.length > 0) {
      parts.push("\nVOCABULARIO:");
      parts.push(...categories.vocabulario.slice(0, 5).map(v => `  • ${v.substring(0, 200)}`));
    }

    if (categories.estructura.length > 0) {
      parts.push("\nESTRUCTURA:");
      parts.push(...categories.estructura.slice(0, 3).map(e => `  • ${e.substring(0, 200)}`));
    }

    if (categories.puntuacion.length > 0) {
      parts.push("\nPUNTUACIÓN:");
      parts.push(...categories.puntuacion.slice(0, 3).map(p => `  • ${p.substring(0, 200)}`));
    }

    // Add some "other" rules if we have space
    if (categories.otros.length > 0 && parts.length < 30) {
      parts.push("\nOTRAS REGLAS:");
      parts.push(...categories.otros.slice(0, 5).map(o => `  • ${o.substring(0, 200)}`));
    }

    const condensedGuide = parts.join("\n");

    // Save to World Bible
    if (condensedGuide.length > 50) {
      try {
        const worldBible = await storage.getWorldBibleByProject(projectId);
        if (worldBible) {
          await storage.updateWorldBible(worldBible.id, {
            styleGuide: condensedGuide,
          } as any);
          console.log(`[OrchestratorV2] Saved condensed style guide to World Bible (${condensedGuide.length} chars from ${styleGuideContent.length} original)`);
        }
      } catch (err) {
        console.error(`[OrchestratorV2] Failed to save style guide to World Bible:`, err);
      }
    }

    return condensedGuide;
  }

  /**
   * Extract a brief summary from a written scene
   * Uses heuristics to generate a quick summary without AI call
   */
  private extractSceneSummary(sceneContent: string, scenePlan: any): string {
    // Strategy: Extract first sentence + key action verbs + character names mentioned
    const sentences = sceneContent.split(/[.!?]+/).filter(s => s.trim().length > 10);
    
    // Get first meaningful sentence (often sets the scene)
    const firstSentence = sentences[0]?.trim().substring(0, 150) || "";
    
    // Get characters from plan
    const characters = scenePlan.characters?.join(", ") || "";
    
    // Create a brief summary combining plan info with actual content hint
    const summary = `${scenePlan.plot_beat} [${characters}]. ${firstSentence}...`;
    
    return summary.substring(0, 300); // Limit to 300 chars
  }

  /**
   * Save scene summaries to World Bible for future agent reference
   */
  private async saveSceneSummaries(projectId: number, chapterNumber: number, scenes: any[]): Promise<void> {
    try {
      const worldBible = await storage.getWorldBibleByProject(projectId);
      if (!worldBible) return;

      // Get existing scene registry or create new one
      const sceneRegistry = (worldBible.plotOutline as any)?.scene_registry || {};
      
      // Add/update scenes for this chapter
      sceneRegistry[`chapter_${chapterNumber}`] = {
        updated_at: new Date().toISOString(),
        scenes: scenes.map(s => ({
          scene_num: s.scene_num,
          characters: s.characters,
          setting: s.setting,
          plot_beat: s.plot_beat,
          actual_summary: s.actual_summary || null,
          word_count: s.word_count || 0,
        }))
      };

      // Update World Bible with scene registry
      await storage.updateWorldBible(worldBible.id, {
        plotOutline: {
          ...(worldBible.plotOutline as any || {}),
          scene_registry: sceneRegistry,
        }
      });

      console.log(`[OrchestratorV2] Saved ${scenes.length} scene summaries for Chapter ${chapterNumber}`);
    } catch (err) {
      console.error(`[OrchestratorV2] Failed to save scene summaries:`, err);
    }
  }

  /**
   * Get scene summaries for previous chapters to provide context
   */
  private async getSceneSummariesContext(projectId: number, currentChapter: number): Promise<string> {
    try {
      const worldBible = await storage.getWorldBibleByProject(projectId);
      if (!worldBible) return "";

      const plotOutline = worldBible.plotOutline as any;
      const sceneRegistry = plotOutline?.scene_registry;
      if (!sceneRegistry) return "";

      const parts: string[] = [];
      parts.push("\n=== ESCENAS ANTERIORES (lo que realmente ocurrió) ===");
      parts.push("Mantén coherencia con estos eventos:\n");

      // Get last 3 chapters of scene summaries
      const relevantChapters = Object.keys(sceneRegistry)
        .filter(key => {
          const chNum = parseInt(key.replace("chapter_", ""));
          return chNum < currentChapter && chNum >= currentChapter - 3;
        })
        .sort((a, b) => parseInt(a.replace("chapter_", "")) - parseInt(b.replace("chapter_", "")));

      for (const chapterKey of relevantChapters) {
        const chapterData = sceneRegistry[chapterKey];
        const chNum = chapterKey.replace("chapter_", "");
        
        parts.push(`Cap ${chNum}:`);
        for (const scene of chapterData.scenes || []) {
          if (scene.actual_summary) {
            parts.push(`  E${scene.scene_num}: ${scene.actual_summary}`);
          }
        }
      }

      return parts.length > 3 ? parts.join("\n") : "";
    } catch (err) {
      console.error(`[OrchestratorV2] Failed to get scene summaries:`, err);
      return "";
    }
  }

  private async validateAndUpdateConsistency(
    projectId: number,
    chapterNumber: number,
    chapterText: string,
    genre: string
  ): Promise<{ isValid: boolean; error?: string }> {
    const context = await this.getConsistencyContext(projectId);
    
    if (context.entities.length === 0 && context.rules.length === 0) {
      console.log(`[OrchestratorV2] Skipping consistency validation - no context available`);
      return { isValid: true };
    }

    this.callbacks.onAgentStatus("universal-consistency", "active", "Validating continuity...");
    
    const result = await universalConsistencyAgent.validateChapter(
      chapterText,
      genre,
      context.entities,
      context.rules,
      context.relationships,
      chapterNumber
    );

    if (!result.isValid && result.criticalError) {
      await storage.createConsistencyViolation({
        projectId,
        chapterNumber,
        violationType: 'CONTRADICTION',
        severity: 'critical',
        description: result.criticalError,
        affectedEntities: [],
        wasAutoFixed: false,
      });

      this.callbacks.onAgentStatus("universal-consistency", "warning", `Violation: ${result.criticalError}`);
      return { isValid: false, error: result.criticalError };
    }

    if (result.newFacts && result.newFacts.length > 0) {
      for (const fact of result.newFacts) {
        const existing = await storage.getWorldEntityByName(projectId, fact.entityName);
        if (existing) {
          const newAttrs = { ...((existing.attributes as any) || {}), ...fact.update };
          await storage.updateWorldEntity(existing.id, {
            attributes: newAttrs,
            lastSeenChapter: chapterNumber,
          });
        } else {
          await storage.createWorldEntity({
            projectId,
            name: fact.entityName,
            type: fact.entityType || 'CHARACTER',
            attributes: fact.update,
            status: 'active',
            lastSeenChapter: chapterNumber,
          });
        }
      }
      console.log(`[OrchestratorV2] Updated ${result.newFacts.length} facts in consistency DB`);
    }

    if (result.newRules && result.newRules.length > 0) {
      for (const rule of result.newRules) {
        await storage.createWorldRule({
          projectId,
          ruleDescription: rule.ruleDescription,
          category: rule.category,
          isActive: true,
          sourceChapter: chapterNumber,
        });
      }
      console.log(`[OrchestratorV2] Added ${result.newRules.length} new rules`);
    }

    if (result.newRelationships && result.newRelationships.length > 0) {
      const entities = await storage.getWorldEntitiesByProject(projectId);
      const entityNameToId = new Map(entities.map(e => [e.name.toLowerCase(), e.id]));
      
      for (const rel of result.newRelationships) {
        const subjectId = entityNameToId.get(rel.subject.toLowerCase());
        const targetId = entityNameToId.get(rel.target.toLowerCase());
        
        if (subjectId && targetId) {
          await storage.createEntityRelationship({
            projectId,
            subjectId,
            targetId,
            relationType: rel.relationType,
            meta: rel.meta || {},
            sourceChapter: chapterNumber,
          });
        }
      }
      console.log(`[OrchestratorV2] Added ${result.newRelationships.length} new relationships`);
    }

    // Any warning is also a violation that must be corrected
    if (result.warnings && result.warnings.length > 0) {
      const warningText = result.warnings.join("; ");
      
      // Log each warning as a violation
      for (const warning of result.warnings) {
        await storage.createConsistencyViolation({
          projectId,
          chapterNumber,
          violationType: 'WARNING',
          severity: 'major',
          description: warning,
          affectedEntities: [],
          wasAutoFixed: false,
        });
      }
      
      this.callbacks.onAgentStatus("universal-consistency", "warning", `${result.warnings.length} issues detected - forcing rewrite`);
      return { isValid: false, error: warningText };
    }
    
    this.callbacks.onAgentStatus("universal-consistency", "completed", "Continuity validated");
    return { isValid: true };
  }

  private generateTitleFromHook(hookOrBeat: string): string {
    if (!hookOrBeat || hookOrBeat.length < 3) return "";
    
    // Clean and truncate the hook to create a title
    let title = hookOrBeat.trim();
    
    // Remove common prefixes
    title = title.replace(/^(el |la |los |las |un |una |unos |unas )/i, "");
    
    // Capitalize first letter
    title = title.charAt(0).toUpperCase() + title.slice(1);
    
    // Truncate to reasonable length (max 50 chars for a title)
    if (title.length > 50) {
      const lastSpace = title.lastIndexOf(" ", 50);
      title = title.slice(0, lastSpace > 20 ? lastSpace : 50) + "...";
    }
    
    // Remove trailing punctuation except ellipsis
    title = title.replace(/[.,;:!?]+$/, "");
    
    return title || "Sin título";
  }

  private generateTitleFromSummary(summary: string): string {
    if (!summary || summary.length < 5) return "";
    
    // Try to extract a meaningful phrase from the summary
    // Look for key patterns that often contain good titles
    
    // Pattern 1: Look for quoted content (ship names, place names, etc.)
    const quotedMatch = summary.match(/'([^']{3,30})'/);
    if (quotedMatch) return quotedMatch[1];
    
    // Pattern 2: Get the first sentence only
    const firstSentence = summary.split(/[.!?]/)[0]?.trim() || "";
    if (!firstSentence || firstSentence.length < 5) return "";
    
    // Pattern 3: Look for key nouns/phrases that make good titles
    // Common chapter title patterns: "El/La [noun]", "Los/Las [noun]", action phrases
    const keyPhrases = [
      /el (hallazgo|descubrimiento|misterio|secreto|cadáver|cuerpo|testigo|sospechoso|rastro|encuentro|interrogatorio|enfrentamiento|conflicto|amanecer|anochecer|regreso|viaje)/i,
      /la (huida|búsqueda|revelación|traición|verdad|mentira|pista|sombra|luz|noche|tormenta|calma|confesión|escena|evidencia)/i,
      /las? (sombras?|huellas?|señales?|marcas?|aguas?)/i,
      /los? (secretos?|indicios?|restos?)/i,
    ];
    
    for (const pattern of keyPhrases) {
      const match = firstSentence.match(pattern);
      if (match) {
        let title = match[0].charAt(0).toUpperCase() + match[0].slice(1);
        return title;
      }
    }
    
    // Pattern 4: Extract first 3-5 significant words from first sentence
    const words = firstSentence.split(/\s+/).slice(0, 5);
    let title = words.join(" ");
    
    // Truncate at word boundary to max 35 chars
    if (title.length > 35) {
      const lastSpace = title.lastIndexOf(" ", 35);
      title = title.slice(0, lastSpace > 10 ? lastSpace : 35);
    }
    
    // Remove trailing articles or prepositions
    title = title.replace(/\s+(el|la|los|las|un|una|de|del|en|a|y|con|por|para)$/i, "");
    
    // Remove trailing punctuation
    title = title.replace(/[.,;:!?]+$/, "");
    
    // Capitalize first letter
    if (title.length > 0) {
      title = title.charAt(0).toUpperCase() + title.slice(1);
    }
    
    return title.length > 5 ? title : "";
  }

  private async syncChapterHeaders(projectId: number, outline: Array<{ chapter_num: number; title: string }>): Promise<void> {
    const existingChapters = await storage.getChaptersByProject(projectId);
    if (existingChapters.length === 0) return;

    console.log(`[OrchestratorV2] Syncing chapter headers for ${existingChapters.length} existing chapters...`);

    const headerPatterns = [
      /^#\s*(Capítulo|Capitulo|CAPÍTULO|CAPITULO)\s+(\d+)\s*[:|-]?\s*([^\n]*)/im,
      /^(Capítulo|Capitulo|CAPÍTULO|CAPITULO)\s+(\d+)\s*[:|-]?\s*([^\n]*)/im,
      /^#\s*(Prólogo|Prologo|PRÓLOGO|PROLOGO)\s*[:|-]?\s*([^\n]*)/im,
      /^#\s*(Epílogo|Epilogo|EPÍLOGO|EPILOGO)\s*[:|-]?\s*([^\n]*)/im,
    ];

    for (const chapter of existingChapters) {
      if (!chapter.content) continue;

      // Find the corresponding outline entry for this chapter
      const outlineEntry = outline.find(o => o.chapter_num === chapter.chapterNumber);
      
      // Extract any existing title from the content header
      let existingTitleFromContent = "";
      let hasHeader = false;
      for (const pattern of headerPatterns) {
        const match = chapter.content.match(pattern);
        if (match) {
          hasHeader = true;
          // Get the title part (after the colon/dash)
          const titlePart = match[match.length - 1]?.trim() || "";
          if (titlePart && !titlePart.match(/^(Prólogo|Epílogo|Capítulo \d+)$/i)) {
            existingTitleFromContent = titlePart;
          }
          break;
        }
      }
      
      // Priority: chapter.title from DB (if not generic) > existingTitleFromContent > outlineEntry?.title (if not generic)
      // Also try to extract a title from the chapter summary if no descriptive title exists
      let titleToUse = "";
      
      // Helper to check if a title is valid (not too long, not generic)
      const isValidTitle = (title: string) => {
        if (!title || title.length > 60) return false;  // Too long = probably content, not title
        if (title.match(/^Capítulo \d+$/i)) return false;  // Generic
        return true;
      };
      
      if (chapter.title && isValidTitle(chapter.title)) {
        titleToUse = chapter.title;
      } else if (existingTitleFromContent && isValidTitle(existingTitleFromContent)) {
        titleToUse = existingTitleFromContent;
      } else if (outlineEntry?.title && isValidTitle(outlineEntry.title)) {
        titleToUse = outlineEntry.title;
      } else if (chapter.summary) {
        // Try to generate a title from the chapter summary
        titleToUse = this.generateTitleFromSummary(chapter.summary);
      }
      
      // Remove "Prólogo:", "Epílogo:", or "Capítulo X:" prefix from title if it exists
      titleToUse = titleToUse.replace(/^(Prólogo|Prologo|Epílogo|Epilogo|Nota del Autor)\s*[:|-]?\s*/i, "").trim();
      titleToUse = titleToUse.replace(/^Capítulo\s+\d+\s*[:|-]?\s*/i, "").trim();
      
      // Determine the correct header and DB title based on chapter number
      let correctHeader = "";
      let correctDbTitle = "";
      if (chapter.chapterNumber === 0) {
        correctHeader = "# Prólogo";
        correctDbTitle = "Prólogo";
        if (titleToUse && titleToUse.toLowerCase() !== "prólogo") {
          correctHeader += `: ${titleToUse}`;
          correctDbTitle += `: ${titleToUse}`;
        }
      } else if (chapter.chapterNumber === 998) {
        correctHeader = "# Epílogo";
        correctDbTitle = "Epílogo";
        if (titleToUse && titleToUse.toLowerCase() !== "epílogo") {
          correctHeader += `: ${titleToUse}`;
          correctDbTitle += `: ${titleToUse}`;
        }
      } else if (chapter.chapterNumber === 999) {
        correctHeader = "# Nota del Autor";
        correctDbTitle = "Nota del Autor";
      } else {
        correctHeader = `# Capítulo ${chapter.chapterNumber}`;
        correctDbTitle = titleToUse || `Capítulo ${chapter.chapterNumber}`;
        if (titleToUse && !titleToUse.match(/^Capítulo \d+$/i)) {
          correctHeader += `: ${titleToUse}`;
        }
      }

      let updatedContent = chapter.content;
      let contentWasUpdated = false;
      let titleWasUpdated = false;

      // Check if we need to update an existing header
      for (const pattern of headerPatterns) {
        const match = updatedContent.match(pattern);
        if (match) {
          const oldHeader = match[0];
          if (oldHeader !== correctHeader) {
            updatedContent = updatedContent.replace(pattern, correctHeader);
            contentWasUpdated = true;
            console.log(`[OrchestratorV2] Chapter ${chapter.chapterNumber}: "${oldHeader.substring(0, 40)}..." -> "${correctHeader}"`);
          }
          break;
        }
      }

      // If no header exists, add one at the beginning
      if (!hasHeader) {
        updatedContent = correctHeader + "\n\n" + updatedContent.trimStart();
        contentWasUpdated = true;
        console.log(`[OrchestratorV2] Chapter ${chapter.chapterNumber}: Added header "${correctHeader}"`);
      }

      // Check if DB title needs updating
      if (chapter.title !== correctDbTitle) {
        titleWasUpdated = true;
        console.log(`[OrchestratorV2] Chapter ${chapter.chapterNumber}: DB title "${chapter.title}" -> "${correctDbTitle}"`);
      }

      // Update in database
      if (contentWasUpdated || titleWasUpdated) {
        const updates: any = {};
        if (contentWasUpdated) updates.content = updatedContent;
        if (titleWasUpdated) updates.title = correctDbTitle;
        await storage.updateChapter(chapter.id, updates);
      }
    }
  }

  async generateNovel(project: Project): Promise<void> {
    console.log(`[OrchestratorV2] Starting novel generation for "${project.title}" (ID: ${project.id})`);
    
    try {
      // Update project status
      await storage.updateProject(project.id, { status: "generating" });

      // Fetch extended guide if exists
      let extendedGuideContent: string | undefined;
      if (project.extendedGuideId) {
        const extendedGuide = await storage.getExtendedGuide(project.extendedGuideId);
        if (extendedGuide) {
          extendedGuideContent = extendedGuide.content;
          console.log(`[OrchestratorV2] Loaded extended guide: ${extendedGuide.title} (${extendedGuide.wordCount} words)`);
        }
      }

      // Fetch style guide - first check project, then pseudonym's active guide
      let styleGuideContent: string | undefined;
      if (project.styleGuideId) {
        const styleGuide = await storage.getStyleGuide(project.styleGuideId);
        if (styleGuide) {
          styleGuideContent = styleGuide.content;
          console.log(`[OrchestratorV2] Loaded project style guide`);
        }
      } else if (project.pseudonymId) {
        // Get the active style guide from the pseudonym
        const pseudonymGuides = await storage.getStyleGuidesByPseudonym(project.pseudonymId);
        const activeGuide = pseudonymGuides.find(g => g.isActive);
        if (activeGuide) {
          styleGuideContent = activeGuide.content;
          console.log(`[OrchestratorV2] Loaded pseudonym's active style guide: ${activeGuide.title}`);
        }
      }

      // Fetch series info if this is part of a series
      let seriesName: string | undefined;
      let previousBooksContext: string | undefined;
      if (project.seriesId) {
        const series = await storage.getSeries(project.seriesId);
        if (series) {
          seriesName = series.title;
          console.log(`[OrchestratorV2] Part of series: ${series.title}, Book #${project.seriesOrder}`);
          
          // Get context from previous books in the series
          if (project.seriesOrder && project.seriesOrder > 1) {
            const seriesProjects = await storage.getProjectsBySeries(project.seriesId);
            const previousBooks = seriesProjects
              .filter(p => p.seriesOrder && p.seriesOrder < project.seriesOrder! && p.status === 'completed')
              .sort((a, b) => (a.seriesOrder || 0) - (b.seriesOrder || 0));
            
            if (previousBooks.length > 0) {
              const contexts: string[] = [];
              for (const prevBook of previousBooks) {
                const prevWorldBible = await storage.getWorldBibleByProject(prevBook.id);
                if (prevWorldBible && prevWorldBible.characters) {
                  const chars = Array.isArray(prevWorldBible.characters) ? prevWorldBible.characters : [];
                  contexts.push(`Libro ${prevBook.seriesOrder}: "${prevBook.title}" - Personajes: ${JSON.stringify(chars.slice(0, 5))}`);
                }
              }
              previousBooksContext = contexts.join('\n');
              console.log(`[OrchestratorV2] Loaded context from ${previousBooks.length} previous books`);
            }
          }
        }
      }

      // Check if World Bible already exists (resuming)
      const existingWorldBible = await storage.getWorldBibleByProject(project.id);
      let outline: Array<{ chapter_num: number; title: string; summary: string; key_event: string; act?: number; emotional_arc?: string }>;
      let worldBible: { characters: any; rules: any };
      
      if (existingWorldBible && existingWorldBible.plotOutline) {
        // Resuming - use existing outline and world bible
        console.log(`[OrchestratorV2] World Bible exists. Resuming chapter generation.`);
        this.callbacks.onAgentStatus("global-architect", "completed", "Using existing structure");
        
        // Load world bible data for agents
        worldBible = {
          characters: existingWorldBible.characters || [],
          rules: existingWorldBible.worldRules || [],
        };
        
        const plotOutline = existingWorldBible.plotOutline as any;
        const timeline = (existingWorldBible.timeline || []) as any[];
        
        // Build a map of chapter numbers to titles from timeline (which has the correct titles)
        const timelineTitles: Record<number, string> = {};
        for (const entry of timeline) {
          if (entry.chapter !== undefined && entry.title) {
            timelineTitles[entry.chapter] = entry.title;
          }
        }
        
        const rawOutline = (plotOutline.chapterOutlines || []).map((ch: any) => ({
          chapter_num: ch.number,
          // Priority: plotOutline title > timeline title > fallback
          title: ch.title || timelineTitles[ch.number] || `Capítulo ${ch.number}`,
          summary: ch.summary || "",
          key_event: ch.keyEvents?.[0] || "",
        }));
        
        // Apply chapter number remapping if needed (for prologue/epilogue/author note)
        const totalChapters = rawOutline.length;
        outline = rawOutline.map((ch: any, idx: number) => {
          let actualNumber = ch.chapter_num;
          let actualTitle = ch.title;
          
          if (project.hasPrologue && idx === 0) {
            actualNumber = 0;
            actualTitle = "Prólogo";
          } else if (project.hasAuthorNote && idx === totalChapters - 1) {
            actualNumber = 999;
            actualTitle = "Nota del Autor";
          } else if (project.hasEpilogue && (
            (project.hasAuthorNote && idx === totalChapters - 2) ||
            (!project.hasAuthorNote && idx === totalChapters - 1)
          )) {
            actualNumber = 998;
            actualTitle = "Epílogo";
          } else if (project.hasPrologue) {
            actualNumber = idx;
            // Update title to match the new chapter number if it was a generic title
            if (ch.title && ch.title.match(/^Capítulo \d+$/i)) {
              actualTitle = `Capítulo ${actualNumber}`;
            }
          }
          
          return { ...ch, chapter_num: actualNumber, title: actualTitle };
        });
        
        console.log(`[OrchestratorV2] Loaded ${outline.length} chapter outlines. Numbers: ${outline.map(c => c.chapter_num).join(', ')}`);
        
        // LitAgents 2.1: Ensure consistency database is initialized even when resuming
        // (in case project was reset but World Bible preserved)
        this.callbacks.onAgentStatus("universal-consistency", "active", "Checking consistency database...");
        await this.initializeConsistencyDatabase(project.id, worldBible, project.genre);
      } else {
        // Phase 1: Global Architecture - create new World Bible
        this.callbacks.onAgentStatus("global-architect", "active", "Designing master structure...");
        
        const globalResult = await this.globalArchitect.execute({
          title: project.title,
          premise: project.premise || "",
          genre: project.genre,
          tone: project.tone,
          chapterCount: project.chapterCount,
          architectInstructions: project.architectInstructions || undefined,
          extendedGuide: extendedGuideContent,
          styleGuide: styleGuideContent,
          hasPrologue: project.hasPrologue,
          hasEpilogue: project.hasEpilogue,
          hasAuthorNote: project.hasAuthorNote,
          workType: project.workType || undefined,
          seriesName,
          seriesOrder: project.seriesOrder || undefined,
          previousBooksContext,
          minWordsPerChapter: project.minWordsPerChapter || undefined,
          maxWordsPerChapter: project.maxWordsPerChapter || undefined,
          isKindleUnlimited: project.isKindleUnlimited || false,
        });

        if (globalResult.error || !globalResult.parsed) {
          throw new Error(`Global Architect failed: ${globalResult.error || "No parsed output"}`);
        }

        this.addTokenUsage(globalResult.tokenUsage);
        await this.logAiUsage(project.id, "global-architect", "deepseek-reasoner", globalResult.tokenUsage);
        
        // Save Global Architect's reasoning to thought logs for context sharing
        if (globalResult.thoughtSignature) {
          await this.saveThoughtLog(
            project.id,
            "Global Architect",
            "global-architect",
            globalResult.thoughtSignature
          );
        }
        
        this.callbacks.onAgentStatus("global-architect", "completed", "Master structure complete");

        worldBible = globalResult.parsed.world_bible;
        const rawOutline = globalResult.parsed.outline;
        const plotThreads = globalResult.parsed.plot_threads;

        // Remap chapter numbers to match system convention:
        // Prologue: 0, Normal chapters: 1-N, Epilogue: 998, Author Note: 999
        outline = rawOutline.map((ch, idx) => {
          let actualNumber = ch.chapter_num;
          const totalChapters = rawOutline.length;
          let actualTitle = ch.title;
          
          if (project.hasPrologue && idx === 0) {
            actualNumber = 0;
            actualTitle = "Prólogo";
          } else if (project.hasAuthorNote && idx === totalChapters - 1) {
            actualNumber = 999;
            actualTitle = "Nota del Autor";
          } else if (project.hasEpilogue && (
            (project.hasAuthorNote && idx === totalChapters - 2) ||
            (!project.hasAuthorNote && idx === totalChapters - 1)
          )) {
            actualNumber = 998;
            actualTitle = "Epílogo";
          } else if (project.hasPrologue) {
            actualNumber = idx;
            // Update title to match the new chapter number if it was a generic title
            if (ch.title.match(/^Capítulo \d+$/i)) {
              actualTitle = `Capítulo ${actualNumber}`;
            }
          }
          
          return { ...ch, chapter_num: actualNumber, title: actualTitle };
        });

        // Store World Bible with timeline derived from outline
        const timeline = outline.map(ch => ({
          chapter: ch.chapter_num,
          title: ch.title,
          events: [ch.key_event],
          summary: ch.summary,
          act: ch.act || (ch.chapter_num <= Math.ceil(outline.length * 0.25) ? 1 : 
                          ch.chapter_num <= Math.ceil(outline.length * 0.75) ? 2 : 3),
        }));

        await storage.createWorldBible({
          projectId: project.id,
          characters: worldBible.characters as any,
          worldRules: worldBible.rules as any,
          timeline: timeline as any,
          plotOutline: {
            chapterOutlines: outline.map(ch => ({
              number: ch.chapter_num,
              title: ch.title,
              summary: ch.summary,
              keyEvents: [ch.key_event],
              emotional_arc: ch.emotional_arc,
              temporal_notes: ch.temporal_notes,
              location: ch.location,
              character_states_entering: ch.character_states_entering,
            })),
            threeActStructure: globalResult.parsed.three_act_structure || null,
            plotThreads: plotThreads.map(t => ({
              name: t.name,
              description: t.description,
              goal: t.goal,
            })),
            // LitAgents 2.1: Store additional Global Architect outputs inside plotOutline for consistency
            settings: worldBible.settings || [],
            themes: worldBible.themes || [],
            location_map: worldBible.location_map || null,
            timeline_master: globalResult.parsed.timeline_master || null,
            character_tracking: globalResult.parsed.character_tracking || [],
          } as any,
        });

        // Store Plot Threads for Narrative Director
        for (const thread of plotThreads) {
          await storage.createProjectPlotThread({
            projectId: project.id,
            name: thread.name,
            description: thread.description || null,
            goal: thread.goal,
            status: "active",
            intensityScore: 5,
            lastUpdatedChapter: 0,
          });
        }

        // LitAgents 2.1: Initialize Universal Consistency Database
        this.callbacks.onAgentStatus("universal-consistency", "active", "Initializing consistency database...");
        await this.initializeConsistencyDatabase(project.id, worldBible, project.genre);
      }

      // Get style guide and analyze it for key writing instructions
      let guiaEstilo = "";
      if (project.styleGuideId) {
        const styleGuide = await storage.getStyleGuide(project.styleGuideId);
        if (styleGuide && styleGuide.content) {
          // Analyze and save condensed style guide to World Bible
          guiaEstilo = await this.analyzeAndSaveStyleGuide(project.id, styleGuide.content);
          
          // If analysis produced insufficient content, use original (truncated for safety)
          if (guiaEstilo.length < 100 && styleGuide.content.length > 100) {
            guiaEstilo = styleGuide.content.substring(0, 3000); // Increase from 1000 to 3000
          }
          
          console.log(`[OrchestratorV2] Style guide loaded: ${guiaEstilo.length} chars (analyzed from ${styleGuide.content.length} original)`);
        }
      }

      // Phase 2: Generate each chapter
      let rollingSummary = "Inicio de la novela.";
      const chapterSummaries: string[] = [];

      // Check for existing chapters to resume from
      const existingChapters = await storage.getChaptersByProject(project.id);
      const completedChapterNumbers = new Set(
        existingChapters
          .filter(c => c.status === "completed" || c.status === "approved")
          .map(c => c.chapterNumber)
      );
      
      if (completedChapterNumbers.size > 0) {
        console.log(`[OrchestratorV2] Found ${completedChapterNumbers.size} completed chapters. Resuming from where we left off.`);
        
        // Sync chapter headers in case they have incorrect numbers from before remapping
        if (project.hasPrologue || project.hasEpilogue || project.hasAuthorNote) {
          await this.syncChapterHeaders(project.id, outline);
        }
        
        // Load existing summaries for context
        for (const chapter of existingChapters.sort((a, b) => a.chapterNumber - b.chapterNumber)) {
          if (chapter.summary) {
            chapterSummaries.push(chapter.summary);
            rollingSummary = chapter.summary;
          }
        }
      }

      for (let i = 0; i < outline.length; i++) {
        if (await this.shouldStopProcessing(project.id)) {
          console.log(`[OrchestratorV2] Project ${project.id} stopped (cancelled or superseded)`);
          return;
        }

        const chapterOutline = outline[i];
        const chapterNumber = chapterOutline.chapter_num;

        // Skip already completed chapters
        if (completedChapterNumbers.has(chapterNumber)) {
          console.log(`[OrchestratorV2] Skipping Chapter ${chapterNumber} (already completed)`);
          continue;
        }

        console.log(`[OrchestratorV2] Generating Chapter ${chapterNumber}: "${chapterOutline.title}"`);

        // 2a.0: LitAgents 2.1 - Generate consistency constraints BEFORE planning
        // This prevents the Chapter Architect from planning scenes that violate consistency
        let consistencyConstraints = "";
        try {
          const context = await this.getConsistencyContext(project.id);
          if (context.entities.length > 0) {
            // Extract timeline and character state info from worldBible
            const timelineInfo = this.extractTimelineInfo(worldBible, chapterNumber, i > 0 ? orderedOutlines[i - 1]?.chapter_num : undefined);
            const characterStates = this.extractCharacterStates(worldBible, chapterNumber);
            
            consistencyConstraints = universalConsistencyAgent.generateConstraints(
              project.genre,
              context.entities,
              context.rules,
              context.relationships,
              chapterNumber,
              timelineInfo,
              characterStates
            );
            console.log(`[OrchestratorV2] Generated consistency constraints (${consistencyConstraints.length} chars) with timeline and character states`);
          }
          
          // Add plot decisions and persistent injuries from World Bible
          const currentWorldBible = await storage.getWorldBibleByProject(project.id);
          if (currentWorldBible) {
            const decisionsConstraints = this.formatDecisionsAndInjuriesAsConstraints(
              currentWorldBible.plotDecisions as any[],
              currentWorldBible.persistentInjuries as any[],
              chapterNumber
            );
            if (decisionsConstraints) {
              consistencyConstraints += decisionsConstraints;
              console.log(`[OrchestratorV2] Added plot decisions and injuries to constraints`);
            }
          }
          
          // Add scene summaries from previous chapters
          const sceneSummaries = await this.getSceneSummariesContext(project.id, chapterNumber);
          if (sceneSummaries) {
            consistencyConstraints += sceneSummaries;
            console.log(`[OrchestratorV2] Added scene summaries from previous chapters`);
          }
          
          // Add enriched writing context (characters, rules, locations, error patterns)
          // Use centralized helper for KU and series context
          const enrichedOptions = await this.buildEnrichedContextOptions(project);
          const enrichedContext = await this.buildEnrichedWritingContext(project.id, chapterNumber, worldBible, enrichedOptions);
          if (enrichedContext) {
            consistencyConstraints += enrichedContext;
            console.log(`[OrchestratorV2] Added enriched writing context (${enrichedContext.length} chars)`);
          }
        } catch (err) {
          console.error(`[OrchestratorV2] Failed to generate constraints:`, err);
        }

        // 2a: Chapter Architect - Plan scenes (now WITH constraints)
        this.callbacks.onAgentStatus("chapter-architect", "active", `Planning scenes for Chapter ${chapterNumber}...`);
        
        const previousSummary = i > 0 ? chapterSummaries[i - 1] : "";
        const storyState = rollingSummary;

        // Get thought context from previous agents for this chapter
        const thoughtContext = await this.getChapterDecisionContext(project.id, chapterNumber);
        const enrichedConstraints = consistencyConstraints + thoughtContext;

        const chapterPlan = await this.chapterArchitect.execute({
          chapterOutline,
          worldBible,
          previousChapterSummary: previousSummary,
          storyState,
          consistencyConstraints: enrichedConstraints, // LitAgents 2.1: Inject constraints + thought context
          fullPlotOutline: outline, // LitAgents 2.1: Full plot context for coherent scene planning
        });

        if (chapterPlan.error || !chapterPlan.parsed) {
          throw new Error(`Chapter Architect failed for Chapter ${chapterNumber}: ${chapterPlan.error || "No parsed output"}`);
        }

        this.addTokenUsage(chapterPlan.tokenUsage);
        await this.logAiUsage(project.id, "chapter-architect", "deepseek-reasoner", chapterPlan.tokenUsage, chapterNumber);
        
        // Save Chapter Architect's reasoning to thought logs
        if (chapterPlan.thoughtSignature) {
          await this.saveThoughtLog(
            project.id,
            "Chapter Architect",
            "chapter-architect",
            `[Capítulo ${chapterNumber}] ${chapterPlan.thoughtSignature}`
          );
        }
        
        this.callbacks.onAgentStatus("chapter-architect", "completed", `${chapterPlan.parsed.scenes.length} scenes planned`);

        const sceneBreakdown = chapterPlan.parsed;

        // 2b: Ghostwriter - Write scene by scene
        let fullChapterText = "";
        let lastContext = "";

        for (const scene of sceneBreakdown.scenes) {
          if (await this.shouldStopProcessing(project.id)) {
            console.log(`[OrchestratorV2] Project ${project.id} was cancelled during scene writing`);
            return;
          }

          this.callbacks.onAgentStatus("ghostwriter-v2", "active", `Writing Scene ${scene.scene_num}...`);

          const sceneResult = await this.ghostwriter.execute({
            scenePlan: scene,
            prevSceneContext: lastContext,
            rollingSummary,
            worldBible,
            guiaEstilo,
            consistencyConstraints: enrichedConstraints, // Include thought context
          });

          if (sceneResult.error) {
            console.error(`[OrchestratorV2] Scene ${scene.scene_num} failed:`, sceneResult.error);
            continue; // Try to continue with next scene
          }

          this.addTokenUsage(sceneResult.tokenUsage);
          await this.logAiUsage(project.id, "ghostwriter-v2", "deepseek-chat", sceneResult.tokenUsage, chapterNumber);
          
          // Save significant Ghostwriter thoughts (only for first and last scene to reduce noise)
          if ((scene.scene_num === 1 || scene.scene_num === sceneBreakdown.scenes.length) && sceneResult.thoughtSignature) {
            await this.saveThoughtLog(
              project.id,
              "Ghostwriter V2",
              "ghostwriter-v2",
              `[Cap ${chapterNumber}, Escena ${scene.scene_num}] ${sceneResult.thoughtSignature}`
            );
          }
          
          fullChapterText += "\n\n" + sceneResult.content;
          lastContext = sceneResult.content.slice(-1500); // Keep last 1500 chars for context

          const sceneWordCount = sceneResult.content.split(/\s+/).length;
          
          // LitAgents 2.1: Generate brief scene summary for future context
          const sceneSummary = this.extractSceneSummary(sceneResult.content, scene);
          scene.actual_summary = sceneSummary;
          scene.word_count = sceneWordCount;
          
          this.callbacks.onSceneComplete(chapterNumber, scene.scene_num, sceneBreakdown.scenes.length, sceneWordCount);
        }

        // LitAgents 2.1: Save scene summaries to World Bible for future reference
        await this.saveSceneSummaries(project.id, chapterNumber, sceneBreakdown.scenes);

        this.callbacks.onAgentStatus("ghostwriter-v2", "completed", "All scenes written");

        // 2c: Smart Editor - Evaluate and patch
        this.callbacks.onAgentStatus("smart-editor", "active", "Evaluating chapter...");

        const editResult = await this.smartEditor.execute({
          chapterContent: fullChapterText,
          sceneBreakdown,
          worldBible,
        });

        this.addTokenUsage(editResult.tokenUsage);
        await this.logAiUsage(project.id, "smart-editor", "deepseek-chat", editResult.tokenUsage, chapterNumber);

        let finalText = fullChapterText;
        let editorFeedback: SmartEditorOutput | null = null;

        if (editResult.parsed) {
          editorFeedback = editResult.parsed;

          if (editResult.parsed.is_approved) {
            this.callbacks.onAgentStatus("smart-editor", "completed", `Approved: ${editResult.parsed.logic_score}/10 Logic, ${editResult.parsed.style_score}/10 Style`);
          } else if (editResult.parsed.patches && editResult.parsed.patches.length > 0) {
            // Apply patches
            this.callbacks.onAgentStatus("smart-editor", "active", `Applying ${editResult.parsed.patches.length} patches...`);
            
            const patchResult = applyPatches(fullChapterText, editResult.parsed.patches);
            finalText = patchResult.patchedText;

            console.log(`[OrchestratorV2] Patch results: ${patchResult.appliedPatches}/${editResult.parsed.patches.length} applied`);
            patchResult.log.forEach(log => console.log(`  ${log}`));

            this.callbacks.onAgentStatus("smart-editor", "completed", `${patchResult.appliedPatches} patches applied`);
          } else if (editResult.parsed.needs_rewrite) {
            console.log(`[OrchestratorV2] Chapter ${chapterNumber} needs rewrite, but continuing with current version`);
            this.callbacks.onAgentStatus("smart-editor", "completed", "Needs improvement (continuing)");
          }
        }

        // 2c.5: LitAgents 2.1 - Universal Consistency Validation with RE-VALIDATION LOOP
        const MAX_CONSISTENCY_ATTEMPTS = 3;
        let consistencyAttempt = 0;
        let consistencyResult = await this.validateAndUpdateConsistency(
          project.id,
          chapterNumber,
          finalText,
          project.genre
        );

        while (!consistencyResult.isValid && consistencyResult.error && consistencyAttempt < MAX_CONSISTENCY_ATTEMPTS) {
          consistencyAttempt++;
          console.warn(`[OrchestratorV2] Consistency violation in Chapter ${chapterNumber} (attempt ${consistencyAttempt}/${MAX_CONSISTENCY_ATTEMPTS}): ${consistencyResult.error}`);
          this.callbacks.onAgentStatus("universal-consistency", "warning", `Fixing consistency error (attempt ${consistencyAttempt})...`);
          
          // First attempt: surgical fix. Subsequent attempts: full rewrite
          const useSurgical = consistencyAttempt === 1;
          
          if (useSurgical) {
            this.callbacks.onAgentStatus("smart-editor", "active", "Fixing continuity error surgically...");
            
            const surgicalFixResult = await this.smartEditor.surgicalFix({
              chapterContent: finalText,
              errorDescription: consistencyResult.error,
              consistencyConstraints,
            });
            
            this.addTokenUsage(surgicalFixResult.tokenUsage);
            await this.logAiUsage(project.id, "smart-editor", "deepseek-chat", surgicalFixResult.tokenUsage, chapterNumber);
            
            if (surgicalFixResult.patches && surgicalFixResult.patches.length > 0) {
              const patchResult: PatchResult = applyPatches(finalText, surgicalFixResult.patches);
              if (patchResult.success && patchResult.patchedText) {
                finalText = patchResult.patchedText;
                console.log(`[OrchestratorV2] Chapter ${chapterNumber}: Applied ${patchResult.appliedPatches} surgical patches`);
              } else if (surgicalFixResult.fullContent) {
                finalText = surgicalFixResult.fullContent;
              }
            } else if (surgicalFixResult.fullContent) {
              finalText = surgicalFixResult.fullContent;
            }
          } else {
            // Full rewrite for persistent issues
            this.callbacks.onAgentStatus("smart-editor", "active", `Full rewrite for persistent consistency error (attempt ${consistencyAttempt})...`);
            
            const rewriteResult = await this.smartEditor.fullRewrite({
              chapterContent: finalText,
              errorDescription: `CORRECCIÓN OBLIGATORIA - VIOLACIÓN DE CONTINUIDAD:\n${consistencyResult.error}\n\nEste error ha persistido después de correcciones quirúrgicas. Debes reescribir las secciones afectadas para eliminar COMPLETAMENTE esta contradicción.`,
              consistencyConstraints,
            });
            
            this.addTokenUsage(rewriteResult.tokenUsage);
            await this.logAiUsage(project.id, "smart-editor", "deepseek-chat", rewriteResult.tokenUsage, chapterNumber);
            
            if (rewriteResult.rewrittenContent) {
              finalText = rewriteResult.rewrittenContent;
              console.log(`[OrchestratorV2] Chapter ${chapterNumber}: Full rewrite applied for consistency fix`);
            }
          }
          
          // RE-VALIDATE after correction to confirm the fix worked
          this.callbacks.onAgentStatus("universal-consistency", "active", "Re-validating after correction...");
          consistencyResult = await this.validateAndUpdateConsistency(
            project.id,
            chapterNumber,
            finalText,
            project.genre
          );
          
          if (consistencyResult.isValid) {
            console.log(`[OrchestratorV2] Chapter ${chapterNumber}: Consistency VERIFIED after attempt ${consistencyAttempt}`);
            this.callbacks.onAgentStatus("universal-consistency", "completed", `Consistency verified (attempt ${consistencyAttempt})`);
          } else {
            console.warn(`[OrchestratorV2] Chapter ${chapterNumber}: Consistency still invalid after attempt ${consistencyAttempt}`);
          }
        }
        
        // Mark violations as resolved only if truly fixed, or as attempted if max attempts reached
        const violations = await db.select().from(consistencyViolations)
          .where(and(
            eq(consistencyViolations.projectId, project.id),
            eq(consistencyViolations.chapterNumber, chapterNumber),
            eq(consistencyViolations.status, "pending")
          ));
        
        if (violations.length > 0) {
          const wasFixed = consistencyResult.isValid;
          for (const violation of violations) {
            await db.update(consistencyViolations)
              .set({ 
                wasAutoFixed: wasFixed, 
                status: wasFixed ? "resolved" : "attempted",
                resolvedAt: wasFixed ? new Date() : null,
                fixDescription: wasFixed 
                  ? `Corregido después de ${consistencyAttempt} intento(s)` 
                  : `No resuelto después de ${MAX_CONSISTENCY_ATTEMPTS} intentos - requiere revisión manual`
              })
              .where(eq(consistencyViolations.id, violation.id));
          }
          console.log(`[OrchestratorV2] Marked ${violations.length} violation(s) as ${wasFixed ? 'RESOLVED' : 'ATTEMPTED'} for Chapter ${chapterNumber}`);
        }
        
        if (consistencyAttempt > 0) {
          this.callbacks.onAgentStatus("smart-editor", "completed", 
            consistencyResult.isValid ? "Continuity error fixed" : `Continuity issues persist after ${consistencyAttempt} attempts`);
          
          // Log persistent violations for user visibility
          if (!consistencyResult.isValid) {
            await storage.createActivityLog({
              projectId: project.id,
              level: "warning",
              agentRole: "universal-consistency",
              message: `Capítulo ${chapterNumber}: Violación de consistencia NO RESUELTA después de ${MAX_CONSISTENCY_ATTEMPTS} intentos. Error: ${consistencyResult.error?.substring(0, 200)}...`,
            });
          }
        }

        // 2d: Summarizer - Compress for memory
        this.callbacks.onAgentStatus("summarizer", "active", "Compressing for memory...");

        const summaryResult = await this.summarizer.execute({
          chapterContent: finalText,
          chapterNumber,
        });

        this.addTokenUsage(summaryResult.tokenUsage);
        await this.logAiUsage(project.id, "summarizer", "deepseek-chat", summaryResult.tokenUsage, chapterNumber);

        const chapterSummary = summaryResult.content || `Chapter ${chapterNumber} completed.`;
        chapterSummaries.push(chapterSummary);

        // Update rolling summary (keep last 3 chapters for context)
        const recentSummaries = chapterSummaries.slice(-3);
        rollingSummary = recentSummaries.map((s, idx) => `Cap ${chapterNumber - (recentSummaries.length - 1 - idx)}: ${s}`).join("\n");

        this.callbacks.onAgentStatus("summarizer", "completed", "Chapter compressed");

        // Save chapter to database (update if exists, create if not)
        const wordCount = finalText.split(/\s+/).length;
        
        // ALWAYS check database directly to prevent duplicates (don't rely on cached list)
        const freshChapters = await storage.getChaptersByProject(project.id);
        const existingChapter = freshChapters.find(c => c.chapterNumber === chapterNumber);
        
        if (existingChapter) {
          // Update existing chapter instead of creating a duplicate
          await storage.updateChapter(existingChapter.id, {
            title: chapterOutline.title,
            content: finalText,
            wordCount,
            status: "approved",
            sceneBreakdown: sceneBreakdown as any,
            summary: chapterSummary,
            editorFeedback: editorFeedback as any,
            qualityScore: editorFeedback ? Math.round((editorFeedback.logic_score + editorFeedback.style_score) / 2) : null,
          });
          console.log(`[OrchestratorV2] Updated existing chapter ${chapterNumber} (ID: ${existingChapter.id})`);
        } else {
          // Create new chapter
          await storage.createChapter({
            projectId: project.id,
            chapterNumber,
            title: chapterOutline.title,
            content: finalText,
            wordCount,
            status: "approved",
            sceneBreakdown: sceneBreakdown as any,
            summary: chapterSummary,
            editorFeedback: editorFeedback as any,
            qualityScore: editorFeedback ? Math.round((editorFeedback.logic_score + editorFeedback.style_score) / 2) : null,
          });
          console.log(`[OrchestratorV2] Created new chapter ${chapterNumber}`);
        }

        await storage.updateProject(project.id, { currentChapter: chapterNumber });
        this.callbacks.onChapterComplete(chapterNumber, wordCount, chapterOutline.title);

        // LitAgents 2.1: Extract injuries from chapter content and save to World Bible
        try {
          const worldBibleData = await storage.getWorldBibleByProject(project.id);
          const characters = (worldBibleData?.characters || worldBibleData?.personajes || []) as any[];
          await this.extractInjuriesFromChapter(project.id, chapterNumber, finalText, characters);
        } catch (injuryError) {
          console.error(`[OrchestratorV2] Error extracting injuries from Chapter ${chapterNumber}:`, injuryError);
        }

        // 2e: Narrative Director - Check every 5 chapters, before epilogue, AND always with epilogue (998)
        const isMultipleOfFive = chapterNumber > 0 && chapterNumber < 998 && chapterNumber % 5 === 0;
        const currentIdx = outline.findIndex((ch: any) => ch.chapter_num === chapterNumber);
        const nextChapter = outline[currentIdx + 1];
        const isLastBeforeEpilogue = nextChapter && (nextChapter.chapter_num === 998 || nextChapter.chapter_num === 999);
        const isEpilogue = chapterNumber === 998; // Always run Director with epilogue for final coherence check
        
        if (isMultipleOfFive || isLastBeforeEpilogue || isEpilogue) {
          let label: string;
          if (isEpilogue) {
            label = "Final coherence review with epilogue";
          } else if (isLastBeforeEpilogue) {
            label = "Pre-epilogue review";
          } else {
            label = `Chapter ${chapterNumber} checkpoint`;
          }
          console.log(`[OrchestratorV2] Running Narrative Director: ${label}`);
          const directorResult = await this.runNarrativeDirector(project.id, chapterNumber, project.chapterCount, chapterSummaries);
          
          // If epilogue needs rewrite due to unresolved threads or issues
          if (isEpilogue && directorResult.needsRewrite) {
            console.log(`[OrchestratorV2] Rewriting epilogue to resolve: ${directorResult.unresolvedThreads.join(", ")}`);
            this.callbacks.onAgentStatus("ghostwriter-v2", "active", "Rewriting epilogue to close narrative threads...");
            
            // Get current epilogue chapter
            const allChapters = await storage.getChaptersByProject(project.id);
            const epilogueChapter = allChapters.find(c => c.chapterNumber === 998);
            
            if (epilogueChapter) {
              // Generate enhanced scene plan with closure instructions
              const closureInstructions = directorResult.unresolvedThreads.length > 0 
                ? `Debes añadir cierres para: ${directorResult.unresolvedThreads.join(", ")}`
                : directorResult.directive;
              
              // Get previous chapter summary for context
              const prevChapterSummary = chapterSummaries[chapterSummaries.length - 2] || "";
              
              // Rewrite epilogue using Ghostwriter with closure instructions
              const rewriteResult = await this.ghostwriter.execute({
                scenePlan: {
                  scene_num: 1,
                  characters: [],
                  setting: "Final",
                  plot_beat: closureInstructions,
                  emotional_beat: "Cierre y resolución de todos los hilos narrativos",
                  ending_hook: "Conclusión satisfactoria",
                },
                prevSceneContext: prevChapterSummary,
                rollingSummary: rollingSummary,
                worldBible,
                guiaEstilo: "",
              });
              
              this.addTokenUsage(rewriteResult.tokenUsage);
              
              if (rewriteResult.content) {
                await storage.updateChapter(epilogueChapter.id, {
                  originalContent: epilogueChapter.originalContent, // Keep original
                  content: rewriteResult.content,
                });
                
                console.log(`[OrchestratorV2] Epilogue rewritten to close ${directorResult.unresolvedThreads.length} narrative threads`);
                this.callbacks.onAgentStatus("ghostwriter-v2", "completed", `Epilogue rewritten (${directorResult.unresolvedThreads.length} threads closed)`);
              } else {
                console.log(`[OrchestratorV2] Epilogue rewrite failed - no content generated`);
                this.callbacks.onAgentStatus("ghostwriter-v2", "completed", "Rewrite skipped");
              }
            }
          }
        }

        // Update token counts
        await this.updateProjectTokens(project.id);
      }

      // After all chapters are written, run SeriesThreadFixer if this is a series project
      if (project.seriesId) {
        await this.runSeriesThreadFixer(project);
      }

      // After all chapters are written, check if we need to run FinalReviewer
      // Get fresh project data to check current score
      const freshProject = await storage.getProject(project.id);
      const currentScore = freshProject?.finalScore || 0;
      
      if (currentScore >= 9) {
        // Already has a passing score, mark as completed
        console.log(`[OrchestratorV2] Project already has score ${currentScore}/10, marking as completed`);
        await storage.updateProject(project.id, { status: "completed" });
        this.callbacks.onProjectComplete();
      } else {
        // Need to run FinalReviewer to get/improve score
        // CRITICAL: Set status to final_review_in_progress to prevent auto-recovery from interrupting
        console.log(`[OrchestratorV2] Project has score ${currentScore}/10 (< 9), running FinalReviewer...`);
        await storage.updateProject(project.id, { status: "final_review_in_progress" });
        await this.runFinalReviewOnly(project, 5);
      }

    } catch (error) {
      console.error(`[OrchestratorV2] Error:`, error);
      this.callbacks.onError(error instanceof Error ? error.message : String(error));
      await storage.updateProject(project.id, { status: "error" });
    }
  }

  /**
   * Run SeriesThreadFixer to detect and correct unfulfilled milestones and stagnant threads
   */
  private async runSeriesThreadFixer(project: Project): Promise<void> {
    if (!project.seriesId) return;

    this.callbacks.onAgentStatus("series-thread-fixer", "active", "Analizando hilos y hitos de la serie...");
    console.log(`[OrchestratorV2] Running SeriesThreadFixer for project ${project.id} in series ${project.seriesId}`);

    try {
      // Get series info
      const series = await storage.getSeries(project.seriesId);
      if (!series) {
        console.log(`[OrchestratorV2] Series ${project.seriesId} not found, skipping thread fixer`);
        return;
      }

      // Get milestones and plot threads for this series
      const milestones = await storage.getMilestonesBySeries(project.seriesId);
      const plotThreads = await storage.getPlotThreadsBySeries(project.seriesId);

      if (milestones.length === 0 && plotThreads.length === 0) {
        console.log(`[OrchestratorV2] No milestones or plot threads defined for series, skipping thread fixer`);
        this.callbacks.onAgentStatus("series-thread-fixer", "completed", "Sin hilos/hitos definidos");
        return;
      }

      // Get all chapters for this project
      const chapters = await storage.getChaptersByProject(project.id);
      const chaptersWithContent = chapters
        .filter(ch => ch.content && ch.content.length > 100)
        .map(ch => ({
          id: ch.id,
          chapterNumber: ch.chapterNumber,
          title: ch.title || `Capitulo ${ch.chapterNumber}`,
          content: ch.content || "",
        }));

      if (chaptersWithContent.length === 0) {
        console.log(`[OrchestratorV2] No chapters with content found, skipping thread fixer`);
        return;
      }

      // Get world bible for context
      const worldBible = await storage.getWorldBibleByProject(project.id);

      // Get context from previous books in the series
      let previousVolumesContext: string | undefined;
      if (project.seriesOrder && project.seriesOrder > 1) {
        const seriesProjects = await storage.getProjectsBySeries(project.seriesId);
        const previousBooks = seriesProjects
          .filter(p => p.seriesOrder && p.seriesOrder < project.seriesOrder! && p.status === 'completed')
          .sort((a, b) => (a.seriesOrder || 0) - (b.seriesOrder || 0));
        
        if (previousBooks.length > 0) {
          const contexts: string[] = [];
          for (const prevBook of previousBooks) {
            const prevWorldBible = await storage.getWorldBibleByProject(prevBook.id);
            if (prevWorldBible && prevWorldBible.characters) {
              const chars = Array.isArray(prevWorldBible.characters) ? prevWorldBible.characters : [];
              contexts.push(`Libro ${prevBook.seriesOrder}: ${prevBook.title} - Personajes: ${chars.slice(0, 5).map((c: any) => c.name || c).join(', ')}`);
            }
          }
          previousVolumesContext = contexts.join('\n');
        }
      }

      // Execute SeriesThreadFixer
      const result = await this.seriesThreadFixer.execute({
        projectTitle: project.title,
        seriesTitle: series.title,
        volumeNumber: project.seriesOrder || 1,
        totalVolumes: series.totalPlannedBooks || 1,
        chapters: chaptersWithContent,
        milestones: milestones,
        plotThreads: plotThreads,
        worldBible: worldBible || {},
        previousVolumesContext,
      });

      this.addTokenUsage(result.tokenUsage);
      await this.logAiUsage(project.id, "series-thread-fixer", "deepseek-chat", result.tokenUsage, 0);

      if (result.error) {
        console.error(`[OrchestratorV2] SeriesThreadFixer error: ${result.error}`);
        this.callbacks.onAgentStatus("series-thread-fixer", "error", result.error);
        return;
      }

      const fixerResult = result.result;
      if (!fixerResult) {
        console.log(`[OrchestratorV2] SeriesThreadFixer returned no result`);
        this.callbacks.onAgentStatus("series-thread-fixer", "completed", "Analisis completado sin resultados");
        return;
      }

      console.log(`[OrchestratorV2] SeriesThreadFixer found ${fixerResult.totalIssuesFound} issues, ${fixerResult.fixes?.length || 0} fixes`);
      this.callbacks.onAgentStatus("series-thread-fixer", "active", 
        `Encontrados ${fixerResult.totalIssuesFound} problemas, ${fixerResult.fixes?.length || 0} correcciones`);

      // Apply fixes using SmartEditor for organic integration
      if (fixerResult.fixes && fixerResult.fixes.length > 0 && 
          (fixerResult.autoFixRecommendation === "safe_to_autofix" || fixerResult.autoFixRecommendation === "review_recommended")) {
        
        // Group fixes by chapter
        const fixesByChapter = new Map<number, typeof fixerResult.fixes>();
        for (const fix of fixerResult.fixes) {
          if (fix.priority === "optional") continue;
          const existing = fixesByChapter.get(fix.chapterId) || [];
          existing.push(fix);
          fixesByChapter.set(fix.chapterId, existing);
        }

        let appliedFixes = 0;
        const chapterIds = Array.from(fixesByChapter.keys());
        
        for (const chapterId of chapterIds) {
          const chapterFixes = fixesByChapter.get(chapterId)!;
          const chapter = chaptersWithContent.find(ch => ch.id === chapterId);
          if (!chapter) continue;

          this.callbacks.onAgentStatus("series-thread-fixer", "active", 
            `Integrando ${chapterFixes.length} correcciones en Capitulo ${chapter.chapterNumber}...`);

          // Build comprehensive error description with all fixes for this chapter
          const errorDescription = chapterFixes.map(fix => {
            const insertionDesc = this.getInsertionDescription(fix.insertionPoint);
            return `[${fix.fixType.toUpperCase()}] ${fix.threadOrMilestoneName}:
  - Problema: ${fix.rationale}
  - Accion: ${insertionDesc}
  - Texto sugerido: "${fix.suggestedRevision.substring(0, 800)}${fix.suggestedRevision.length > 800 ? '...' : ''}"
  ${fix.originalPassage ? `- Pasaje original (ancla): "${fix.originalPassage.substring(0, 200)}"` : ''}`;
          }).join('\n\n');

          try {
            // Use SmartEditor.surgicalFix to integrate corrections organically
            const fixResult = await this.smartEditor.surgicalFix({
              chapterContent: chapter.content,
              errorDescription: `CORRECCIONES DE HILOS/HITOS DE SERIE:\n\n${errorDescription}`,
              consistencyConstraints: `Integrar los elementos de serie de forma ORGANICA. No insertes texto abrupto. Mantener voz y estilo del autor.`,
            });

            this.addTokenUsage(fixResult.tokenUsage);

            if (fixResult.patches && fixResult.patches.length > 0) {
              // Apply patches using patcher for fuzzy matching
              const patchResult = applyPatches(chapter.content, fixResult.patches);
              let newContent = patchResult.patchedText;

              if (newContent !== chapter.content) {
                const wordCount = newContent.split(/\s+/).length;
                await storage.updateChapter(chapterId, {
                  content: newContent,
                  wordCount,
                });
                appliedFixes += chapterFixes.length;
                console.log(`[OrchestratorV2] SmartEditor integrated ${chapterFixes.length} fixes in Chapter ${chapter.chapterNumber}`);
              }
            }
          } catch (fixError) {
            console.error(`[OrchestratorV2] Error integrating fixes in Chapter ${chapter.chapterNumber}:`, fixError);
          }
        }

        this.callbacks.onAgentStatus("series-thread-fixer", "completed", 
          `${appliedFixes} correcciones integradas organicamente`);
        console.log(`[OrchestratorV2] SeriesThreadFixer integrated ${appliedFixes} fixes via SmartEditor`);
      } else {
        this.callbacks.onAgentStatus("series-thread-fixer", "completed", 
          fixerResult.autoFixRecommendation === "manual_intervention_required" 
            ? "Requiere intervencion manual" 
            : "Analisis completado");
      }

      // Log unfulfilled milestones for user awareness
      if (fixerResult.unfulfilledMilestones && fixerResult.unfulfilledMilestones.length > 0) {
        console.log(`[OrchestratorV2] Unfulfilled milestones: ${fixerResult.unfulfilledMilestones.map(m => m.description).join(', ')}`);
      }

    } catch (error) {
      console.error(`[OrchestratorV2] SeriesThreadFixer error:`, error);
      this.callbacks.onAgentStatus("series-thread-fixer", "error", 
        error instanceof Error ? error.message : "Error desconocido");
    }
  }

  private async runNarrativeDirector(
    projectId: number,
    currentChapter: number,
    totalChapters: number,
    chapterSummaries: string[]
  ): Promise<{ needsRewrite: boolean; directive: string; unresolvedThreads: string[] }> {
    this.callbacks.onAgentStatus("narrative-director", "active", "Analyzing story progress...");

    // Get plot threads from database
    const dbThreads = await storage.getPlotThreadsByProject(projectId);
    const plotThreads: AgentPlotThread[] = dbThreads.map(t => ({
      name: t.name,
      status: t.status,
      goal: t.goal || "",
      lastUpdatedChapter: t.lastUpdatedChapter || 0,
    }));

    // Get recent summaries
    const recentSummaries = chapterSummaries.slice(-5).map((s, idx) => {
      const chapNum = currentChapter - (chapterSummaries.slice(-5).length - 1 - idx);
      return `Capítulo ${chapNum}: ${s}`;
    }).join("\n\n");

    const result = await this.narrativeDirector.execute({
      recentSummaries,
      plotThreads,
      currentChapter,
      totalChapters,
    });

    this.addTokenUsage(result.tokenUsage);

    let needsRewrite = false;
    let directive = "";
    let unresolvedThreads: string[] = [];

    if (result.parsed) {
      console.log(`[OrchestratorV2] Narrative Director directive: ${result.parsed.directive}`);
      directive = result.parsed.directive || "";
      
      // Update thread statuses if needed
      if (result.parsed.thread_updates) {
        for (const update of result.parsed.thread_updates) {
          const thread = dbThreads.find(t => t.name === update.name);
          if (thread) {
            await storage.updateProjectPlotThread(thread.id, {
              status: update.new_status,
              lastUpdatedChapter: currentChapter,
            });
          }
        }
      }

      // Check for unresolved threads at epilogue
      if (currentChapter === 998) {
        unresolvedThreads = plotThreads
          .filter(t => t.status === "active" || t.status === "developing")
          .map(t => t.name);
        
        // Needs rewrite if there are unresolved threads or critical issues in directive
        const criticalKeywords = ["inconsistencia", "sin resolver", "unresolved", "contradiction", "error", "problema"];
        const hasCriticalIssue = criticalKeywords.some(kw => directive.toLowerCase().includes(kw));
        
        needsRewrite = unresolvedThreads.length > 0 || hasCriticalIssue;
        
        if (needsRewrite) {
          console.log(`[OrchestratorV2] Epilogue needs rewrite: ${unresolvedThreads.length} unresolved threads, critical issues: ${hasCriticalIssue}`);
        }
      }

      this.callbacks.onAgentStatus("narrative-director", "completed", `Tension: ${result.parsed.tension_level}/10`);
    } else {
      this.callbacks.onAgentStatus("narrative-director", "completed", "Analysis complete");
    }

    return { needsRewrite, directive, unresolvedThreads };
  }

  /**
   * Generate a single chapter using the V2 pipeline
   */
  async generateSingleChapter(
    project: Project,
    chapterOutline: {
      chapter_num: number;
      title: string;
      summary: string;
      key_event: string;
      emotional_arc?: string;
    },
    worldBible: any,
    previousChapterSummary: string,
    rollingSummary: string,
    guiaEstilo: string
  ): Promise<{ content: string; summary: string; wordCount: number; sceneBreakdown: ChapterArchitectOutput }> {
    
    // Plan scenes (note: this helper doesn't have full consistency constraints context)
    // Extract outline from worldBible if available for plot context
    // Note: World Bible stores as chapterOutlines, not chapters
    const plotOutlineData = worldBible?.plotOutline as any;
    const fullOutline = plotOutlineData?.chapterOutlines || plotOutlineData?.chapters || [];
    
    const chapterPlan = await this.chapterArchitect.execute({
      chapterOutline,
      worldBible,
      previousChapterSummary,
      storyState: rollingSummary,
      fullPlotOutline: fullOutline, // LitAgents 2.1: Full plot context
    });

    if (!chapterPlan.parsed) {
      throw new Error("Chapter planning failed");
    }

    const sceneBreakdown = chapterPlan.parsed;

    // Write scenes
    let fullChapterText = "";
    let lastContext = "";

    for (const scene of sceneBreakdown.scenes) {
      const sceneResult = await this.ghostwriter.execute({
        scenePlan: scene,
        prevSceneContext: lastContext,
        rollingSummary,
        worldBible,
        guiaEstilo,
        // Note: consistencyConstraints not available in this simplified helper
      });

      if (!sceneResult.error) {
        fullChapterText += "\n\n" + sceneResult.content;
        lastContext = sceneResult.content.slice(-1500);
      }
    }

    // Edit
    const editResult = await this.smartEditor.execute({
      chapterContent: fullChapterText,
      sceneBreakdown,
      worldBible,
    });

    let finalText = fullChapterText;
    if (editResult.parsed?.patches && editResult.parsed.patches.length > 0) {
      const patchResult = applyPatches(fullChapterText, editResult.parsed.patches);
      finalText = patchResult.patchedText;
    }

    // Summarize
    const summaryResult = await this.summarizer.execute({
      chapterContent: finalText,
      chapterNumber: chapterOutline.chapter_num,
    });

    return {
      content: finalText,
      summary: summaryResult.content || "",
      wordCount: finalText.split(/\s+/).length,
      sceneBreakdown,
    };
  }

  /**
   * Run final review only - V2 version with auto-correction
   * Uses FinalReviewer for comprehensive analysis and auto-corrects problematic chapters
   */
  async runFinalReviewOnly(project: Project, maxCycles: number = 15): Promise<void> {
    console.log(`[OrchestratorV2] Running final review for project ${project.id}`);
    
    try {
      this.callbacks.onAgentStatus("final-reviewer", "active", "Ejecutando revisión final completa...");
      
      const chapters = await storage.getChaptersByProject(project.id);
      let completedChapters = chapters
        .filter(c => c.status === "completed" || c.status === "approved")
        .sort((a, b) => a.chapterNumber - b.chapterNumber);
      
      if (completedChapters.length === 0) {
        this.callbacks.onError("No hay capítulos completados para revisar");
        return;
      }

      const worldBible = await storage.getWorldBibleByProject(project.id);
      if (!worldBible) {
        this.callbacks.onError("No se encontró la World Bible para este proyecto");
        return;
      }

      // Get style guide - use condensed version from World Bible if available
      let guiaEstilo = "";
      if ((worldBible as any).styleGuide) {
        guiaEstilo = (worldBible as any).styleGuide;
        console.log(`[OrchestratorV2] Using condensed style guide from World Bible (${guiaEstilo.length} chars)`);
      } else if (project.styleGuideId) {
        const styleGuide = await storage.getStyleGuide(project.styleGuideId);
        if (styleGuide && styleGuide.content) {
          guiaEstilo = await this.analyzeAndSaveStyleGuide(project.id, styleGuide.content);
          if (guiaEstilo.length < 100) guiaEstilo = styleGuide.content.substring(0, 3000);
        }
      }

      const worldBibleData = {
        characters: worldBible.characters || [],
        rules: worldBible.worldRules || [],
      };

      // CRITICAL: Restore cycle state from database to survive restarts
      let currentCycle = project.revisionCycle || 0;
      let finalResult: FinalReviewerResult | null = null;
      // Track corrected issues between cycles to inform FinalReviewer
      let correctedIssuesSummaries: string[] = [];
      // Track previous cycle score for consistency enforcement
      let previousCycleScore: number | undefined = undefined;
      
      // HASH-BASED ISSUE TRACKING (synced with reedit-orchestrator system)
      // Load resolved issue hashes from database to survive restarts
      let localResolvedHashes: string[] = (project.resolvedIssueHashes as string[]) || [];
      console.log(`[OrchestratorV2] Loaded ${localResolvedHashes.length} resolved issue hashes from database`);
      
      // Chapter correction limits to prevent infinite loops (same as reedit-orchestrator)
      const MAX_CORRECTIONS_PER_CHAPTER = 4;
      const loadedCounts = (project?.chapterCorrectionCounts as Record<string, number>) || {};
      const chapterCorrectionCounts: Map<number, number> = new Map(
        Object.entries(loadedCounts).map(([k, v]) => [parseInt(k), v])
      );
      
      // ITERATIVE REVIEW CYCLE: Track consecutive high scores (≥9) for approval
      const REQUIRED_CONSECUTIVE_HIGH_SCORES = 2;
      const MIN_ACCEPTABLE_SCORE = 9;
      // CRITICAL: Restore consecutiveHighScores from database to survive auto-recovery/restarts
      let consecutiveHighScores = (project.consecutiveHighScores as number) || 0;
      console.log(`[OrchestratorV2] Starting final review at cycle ${currentCycle} with ${consecutiveHighScores} consecutive high score(s) from previous session`);
      const previousScores: number[] = [];
      
      // QA Issues collected from QA agents (run once before first review cycle)
      let qaIssues: QAIssue[] = [];
      // CRITICAL: Restore qaAuditCompleted from database to skip QA audit on restart
      let qaAuditCompleted = project.qaAuditCompleted || false;
      if (qaAuditCompleted) {
        console.log(`[OrchestratorV2] QA audit already completed in previous session, skipping...`);
      }
      
      // Track filtered FinalReviewer issues at wider scope for use in post-correction
      let previousCycleIssuesFiltered: FinalReviewIssue[] = [];

      while (currentCycle < maxCycles) {
        // === RUN QA AUDIT ONCE BEFORE FIRST REVIEW CYCLE ===
        if (!qaAuditCompleted) {
          qaAuditCompleted = true;
          this.callbacks.onAgentStatus("beta-reader", "active", "Ejecutando auditoría QA del manuscrito...");
          
          console.log(`[OrchestratorV2] Running QA audit before final review...`);
          
          // Get chapters for QA
          const chaptersForQA = completedChapters.map(c => c.content || "");
          const chapterSummaries = completedChapters.map((c, i) => 
            `Capítulo ${c.chapterNumber}: ${c.title || "Sin título"} - ${(c.content || "").substring(0, 500)}...`
          );
          
          // Run QA Agents in parallel batches (every 5 chapters for continuity, every 10 for voice)
          const qaPromises: Promise<any>[] = [];
          
          // Continuity Sentinel - analyze in blocks of 5 chapters
          for (let i = 0; i < chaptersForQA.length; i += 5) {
            const block = chaptersForQA.slice(i, i + 5);
            const startChapter = completedChapters[i]?.chapterNumber || i + 1;
            const endChapter = completedChapters[Math.min(i + 4, completedChapters.length - 1)]?.chapterNumber || i + 5;
            qaPromises.push(
              this.continuitySentinel.auditContinuity(block, startChapter, endChapter)
                .then(result => ({ type: 'continuity', result, startChapter, endChapter }))
                .catch(e => ({ type: 'continuity', error: e.message }))
            );
          }
          
          // Voice Rhythm Auditor - analyze in blocks of 10 chapters
          for (let i = 0; i < chaptersForQA.length; i += 10) {
            const block = chaptersForQA.slice(i, i + 10);
            const startChapter = completedChapters[i]?.chapterNumber || i + 1;
            const endChapter = completedChapters[Math.min(i + 9, completedChapters.length - 1)]?.chapterNumber || i + 10;
            qaPromises.push(
              this.voiceRhythmAuditor.auditVoiceRhythm(block, startChapter, endChapter)
                .then(result => ({ type: 'voice', result, startChapter, endChapter }))
                .catch(e => ({ type: 'voice', error: e.message }))
            );
          }
          
          // Semantic Repetition Detector - analyze full manuscript summaries
          qaPromises.push(
            this.semanticRepetitionDetector.detectRepetitions(chapterSummaries, completedChapters.length)
              .then(result => ({ type: 'semantic', result }))
              .catch(e => ({ type: 'semantic', error: e.message }))
          );
          
          this.callbacks.onAgentStatus("beta-reader", "active", `Ejecutando ${qaPromises.length} auditorías QA en paralelo...`);
          
          const qaResults = await Promise.all(qaPromises);
          
          // Process QA results and convert to unified issue format
          for (const qaResult of qaResults) {
            if (qaResult.error) {
              console.error(`[OrchestratorV2] QA ${qaResult.type} failed:`, qaResult.error);
              continue;
            }
            
            if (qaResult.type === 'continuity' && qaResult.result?.erroresContinuidad) {
              for (const error of qaResult.result.erroresContinuidad) {
                if (error.severidad === 'critica' || error.severidad === 'mayor') {
                  qaIssues.push({
                    source: 'continuity_sentinel',
                    tipo: error.tipo,
                    severidad: error.severidad,
                    capitulo: error.capitulo,
                    descripcion: error.descripcion,
                    correccion: error.correccion,
                  });
                }
              }
              if (qaResult.result.tokenUsage) this.addTokenUsage(qaResult.result.tokenUsage);
            }
            
            if (qaResult.type === 'voice' && qaResult.result?.problemasTono) {
              for (const problema of qaResult.result.problemasTono) {
                if (problema.severidad === 'mayor') {
                  qaIssues.push({
                    source: 'voice_rhythm_auditor',
                    tipo: problema.tipo,
                    severidad: problema.severidad,
                    capitulos: problema.capitulos,
                    descripcion: problema.descripcion,
                    correccion: problema.correccion,
                  });
                }
              }
              if (qaResult.result.tokenUsage) this.addTokenUsage(qaResult.result.tokenUsage);
            }
            
            if (qaResult.type === 'semantic' && qaResult.result?.repeticionesSemanticas) {
              for (const rep of qaResult.result.repeticionesSemanticas) {
                if (rep.severidad === 'mayor') {
                  qaIssues.push({
                    source: 'semantic_repetition_detector',
                    tipo: rep.tipo,
                    severidad: rep.severidad,
                    capitulos: rep.ocurrencias,
                    descripcion: rep.descripcion,
                    correccion: rep.accion,
                  });
                }
              }
              if (qaResult.result.tokenUsage) this.addTokenUsage(qaResult.result.tokenUsage);
            }
          }
          
          console.log(`[OrchestratorV2] QA audit complete: ${qaIssues.length} issues found from ${qaResults.length} audits`);
          
          // === BETA READER EVALUATION FOR COMMERCIAL VIABILITY ===
          this.callbacks.onAgentStatus("beta-reader", "active", "Ejecutando análisis de viabilidad comercial...");
          
          try {
            // Get chapter summaries for beta reader
            const chapterSummaries = completedChapters.map(c => 
              c.summary || `${c.title || `Capítulo ${c.chapterNumber}`}: ${(c.content || "").substring(0, 300)}...`
            );
            
            const firstChapter = completedChapters[0]?.content || "";
            const lastChapter = completedChapters[completedChapters.length - 1]?.content || "";
            
            console.log(`[OrchestratorV2] Running Beta Reader evaluation for commercial viability...`);
            
            const betaResult = await this.betaReader.evaluateNovel(
              project.id,
              project.genre || "general",
              chapterSummaries,
              firstChapter.substring(0, 15000), // Limit to ~15k chars
              lastChapter.substring(0, 15000)
            );
            
            this.addTokenUsage(betaResult.tokenUsage);
            
            const betaReport = betaResult.report;
            console.log(`[OrchestratorV2] Beta Reader: Score ${betaReport.score}/10, Viability: ${betaReport.viability}, Flagged chapters: ${betaReport.flagged_chapters?.length || 0}`);
            
            // Convert flagged chapters to QA issues for correction
            if (betaReport.flagged_chapters && betaReport.flagged_chapters.length > 0) {
              for (const flagged of betaReport.flagged_chapters) {
                // Only add HIGH severity issues for automatic correction
                if (flagged.severity === 'HIGH' || flagged.severity === 'MEDIUM') {
                  qaIssues.push({
                    source: 'beta_reader',
                    tipo: flagged.issue_type,
                    severidad: flagged.severity === 'HIGH' ? 'critica' : 'mayor',
                    capitulo: flagged.chapter_number,
                    descripcion: `[Viabilidad Comercial] ${flagged.issue_type.replace(/_/g, ' ')}: ${flagged.specific_fix}`,
                    correccion: flagged.specific_fix,
                  });
                }
              }
              console.log(`[OrchestratorV2] Beta Reader added ${betaReport.flagged_chapters.filter(f => f.severity === 'HIGH' || f.severity === 'MEDIUM').length} issues for correction`);
            }
            
            // Store beta reader report for later reference
            await storage.updateProject(project.id, {
              betaReaderReport: betaReport as any,
              betaReaderScore: betaReport.score,
            });
            
            this.callbacks.onAgentStatus("beta-reader", "active", 
              `Beta Reader: ${betaReport.score}/10 (${betaReport.viability}). ${betaReport.flagged_chapters?.length || 0} capítulos marcados.`
            );
            
          } catch (betaError) {
            console.error(`[OrchestratorV2] Beta Reader evaluation failed:`, betaError);
            // Continue without beta reader results
          }
          // === END BETA READER ===
          
          // === BUILD QA AUDIT REPORT (structured for frontend) ===
          const qaAuditData: {
            findings: Array<{ source: string; chapter: number | null; chapters: number[] | null; severity: string; description: string; correction: string }>;
            corrections: Array<{ chapter: number; issueCount: number; sources: string[]; success: boolean }>;
            totalFindings: number;
            successCount: number;
            failCount: number;
            auditedAt: string;
          } = {
            findings: qaIssues.map(issue => ({
              source: issue.source,
              chapter: issue.capitulo || null,
              chapters: issue.capitulos || null,
              severity: issue.severidad || 'mayor',
              description: issue.descripcion || '',
              correction: issue.correccion || '',
            })),
            corrections: [],
            totalFindings: qaIssues.length,
            successCount: 0,
            failCount: 0,
            auditedAt: new Date().toISOString(),
          };
          
          // === LOG QA AUDIT FINDINGS BEFORE CORRECTIONS ===
          if (qaIssues.length > 0) {
            let qaAuditReportText = `[INFORME AUDITORÍA QA - PRE-CORRECCIÓN]\n`;
            qaAuditReportText += `Total problemas detectados: ${qaIssues.length}\n\n`;
            
            // Group by source
            const issuesBySource = new Map<string, typeof qaIssues>();
            for (const issue of qaIssues) {
              if (!issuesBySource.has(issue.source)) {
                issuesBySource.set(issue.source, []);
              }
              issuesBySource.get(issue.source)!.push(issue);
            }
            
            for (const [source, issues] of issuesBySource) {
              qaAuditReportText += `[${source.toUpperCase()}] - ${issues.length} problema(s):\n`;
              for (const issue of issues) {
                const chapInfo = issue.capitulo ? `Cap ${issue.capitulo}` : (issue.capitulos?.length ? `Caps ${issue.capitulos.join(',')}` : 'General');
                qaAuditReportText += `  • [${issue.severidad?.toUpperCase() || 'MAYOR'}] ${chapInfo}: ${issue.descripcion?.substring(0, 100)}...\n`;
              }
              qaAuditReportText += '\n';
            }
            
            await storage.createActivityLog({
              projectId: project.id,
              level: "info",
              agentRole: "qa-audit",
              message: qaAuditReportText,
            });
            
            console.log(`[OrchestratorV2] QA audit findings logged:\n${qaAuditReportText}`);
            this.callbacks.onAgentStatus("beta-reader", "active", `Auditoría completa: ${qaIssues.length} problemas detectados. Corrigiendo antes de revisión...`);
          } else {
            // Save empty audit report to show "no issues found"
            await storage.updateProject(project.id, { qaAuditReport: qaAuditData as any });
            
            await storage.createActivityLog({
              projectId: project.id,
              level: "success",
              agentRole: "qa-audit",
              message: `[INFORME AUDITORÍA QA]\nNo se detectaron problemas críticos ni mayores. El manuscrito está listo para revisión final.`,
            });
            this.callbacks.onAgentStatus("beta-reader", "active", "Auditoría completa. Sin problemas críticos. Iniciando revisión final...");
          }
          
          // === PRE-REVIEW CORRECTION: Fix QA + previous FinalReviewer issues BEFORE new FinalReviewer ===
          // CRITICAL: Reload resolved hashes from DB to include newly resolved issues (survives restarts)
          const refreshedProject = await storage.getProject(project.id);
          localResolvedHashes = (refreshedProject?.resolvedIssueHashes as string[]) || [];
          
          // Combine QA issues with issues from previous FinalReviewer cycle (loaded from DB)
          const combinedPreReviewIssues: QAIssue[] = [...qaIssues];
          
          // Get previous FinalReviewer issues from database and filter with resolved hashes
          const previousFinalResult = refreshedProject?.finalReviewResult as FinalReviewerResult | null;
          const rawPreviousIssues: FinalReviewIssue[] = previousFinalResult?.issues || [];
          const filteredResult = this.filterNewIssues(rawPreviousIssues, localResolvedHashes);
          previousCycleIssuesFiltered = filteredResult.newIssues; // Update wider-scope variable
          const prevFilteredCount = filteredResult.filteredCount;
          
          if (prevFilteredCount > 0) {
            console.log(`[OrchestratorV2] Filtered ${prevFilteredCount} already-resolved issues from previous cycle`);
          }
          
          // Convert filtered FinalReviewer issues to QAIssue format and add them
          if (previousCycleIssuesFiltered.length > 0) {
            console.log(`[OrchestratorV2] Adding ${previousCycleIssuesFiltered.length} unresolved issues from previous FinalReviewer cycle`);
            for (const issue of previousCycleIssuesFiltered) {
              for (const chapNum of (issue.capitulos_afectados || [])) {
                // Check chapter correction limits to prevent infinite loops
                const correctionCount = chapterCorrectionCounts.get(chapNum) || 0;
                if (correctionCount >= MAX_CORRECTIONS_PER_CHAPTER) {
                  console.log(`[OrchestratorV2] Skipping chapter ${chapNum}: already corrected ${correctionCount} times (max: ${MAX_CORRECTIONS_PER_CHAPTER})`);
                  continue;
                }
                combinedPreReviewIssues.push({
                  source: 'final-reviewer',
                  capitulo: chapNum,
                  severidad: issue.severidad || 'mayor',
                  descripcion: issue.descripcion || '',
                  instrucciones: issue.instrucciones_correccion || issue.instruccion_correccion || '',
                  categoria: issue.categoria || 'general',
                });
              }
            }
          }
          
          if (combinedPreReviewIssues.length > 0) {
            console.log(`[OrchestratorV2] PRE-REVIEW CORRECTION: Fixing ${combinedPreReviewIssues.length} combined issues (${qaIssues.length} QA + ${previousCycleIssuesFiltered.length} FinalReviewer) before new review`);
            
            // Aggregate combined issues by chapter
            const qaIssuesByChapter = new Map<number, typeof combinedPreReviewIssues>();
            for (const issue of combinedPreReviewIssues) {
              const chapNum = issue.capitulo || (issue.capitulos ? issue.capitulos[0] : null);
              if (chapNum) {
                if (!qaIssuesByChapter.has(chapNum)) {
                  qaIssuesByChapter.set(chapNum, []);
                }
                qaIssuesByChapter.get(chapNum)!.push(issue);
              }
            }
            
            // Filter out chapters that have exceeded correction limit (applies to ALL issues including QA)
            const allChaptersWithIssues = Array.from(qaIssuesByChapter.keys()).sort((a, b) => a - b);
            const chaptersToFix = allChaptersWithIssues.filter(chapNum => {
              const correctionCount = chapterCorrectionCounts.get(chapNum) || 0;
              if (correctionCount >= MAX_CORRECTIONS_PER_CHAPTER) {
                console.log(`[OrchestratorV2] Skipping chapter ${chapNum} in pre-review: already corrected ${correctionCount} times (max: ${MAX_CORRECTIONS_PER_CHAPTER})`);
                return false;
              }
              return true;
            });
            
            if (chaptersToFix.length < allChaptersWithIssues.length) {
              console.log(`[OrchestratorV2] ${allChaptersWithIssues.length - chaptersToFix.length} chapters skipped due to correction limits`);
            }
            console.log(`[OrchestratorV2] Pre-review: ${chaptersToFix.length} chapters to correct: ${chaptersToFix.join(', ')}`);
            
            // Notify frontend about chapters being corrected
            if (this.callbacks.onChaptersBeingCorrected) {
              this.callbacks.onChaptersBeingCorrected(chaptersToFix, 0); // 0 = pre-review phase
            }
            
            let preReviewCorrected = 0;
            const preReviewFixes: Array<{ chapter: number; issueCount: number; sources: string[]; success: boolean }> = [];
            
            for (const chapNum of chaptersToFix) {
              if (await this.shouldStopProcessing(project.id)) {
                await this.updateProjectTokens(project.id);
                await storage.updateProject(project.id, { status: "paused" });
                return;
              }
              
              const chapter = completedChapters.find(c => c.chapterNumber === chapNum);
              if (!chapter || !chapter.content) continue;
              
              const chapterQaIssues = qaIssuesByChapter.get(chapNum) || [];
              if (chapterQaIssues.length === 0) continue;
              
              // Check severity levels (case-insensitive)
              const hasCriticalOrMajor = chapterQaIssues.some(i => {
                const sev = (i.severidad || '').toLowerCase();
                return sev === 'critica' || sev === 'crítica' || sev === 'mayor' || sev === 'critical' || sev === 'major';
              });
              console.log(`[OrchestratorV2] Pre-review Chapter ${chapNum}: ${chapterQaIssues.length} issues, hasCriticalOrMajor=${hasCriticalOrMajor}, severities=[${chapterQaIssues.map(i => i.severidad).join(', ')}]`);
              
              // Build unified correction prompt with FULL CONTEXT
              const issuesDescription = chapterQaIssues.map(i => 
                `- [${i.severidad?.toUpperCase() || 'MAYOR'}] ${i.source}: ${i.descripcion}\n  Corrección: ${i.correccion || 'Corregir según descripción'}`
              ).join("\n");
              
              // Build comprehensive context for rewrites FROM WORLD BIBLE
              const chapterContext = {
                projectTitle: project.title,
                genre: project.genre,
                chapterNumber: chapNum,
                chapterTitle: chapter.title,
                previousChapterSummary: completedChapters.find(c => c.chapterNumber === chapNum - 1)?.summary || '',
                nextChapterSummary: completedChapters.find(c => c.chapterNumber === chapNum + 1)?.summary || '',
                // Characters with relationships
                mainCharacters: (worldBibleData.characters || []).slice(0, 10).map((c: any) => ({
                  name: c.name,
                  description: c.description || c.role || '',
                  relationships: c.relationships || [],
                  physicalTraits: c.physicalTraits || c.physical_traits || '',
                  personality: c.personality || '',
                })),
                // World rules and lore
                worldRules: (worldBibleData.worldRules || worldBibleData.rules || []).slice(0, 10),
                // Locations (check settings in plotOutline for LitAgents 2.1 compatibility)
                locations: (worldBibleData.locations || worldBibleData.settings || (worldBibleData.plotOutline as any)?.settings || []).slice(0, 8).map((l: any) => ({
                  name: l.name,
                  description: l.description || l.atmosphere || '',
                })),
                // Timeline events relevant to this chapter
                timelineEvents: ((worldBibleData.timeline || []) as any[])
                  .filter((e: any) => e.chapter === chapNum || e.chapter === chapNum - 1 || e.chapter === chapNum + 1)
                  .slice(0, 5),
                // Plot decisions made so far
                plotDecisions: (worldBibleData.plotDecisions || []).slice(-10),
                // Persistent injuries/conditions
                persistentInjuries: (worldBibleData.persistentInjuries || []).slice(0, 8),
                styleGuide: project.architectInstructions?.substring(0, 1000) || '',
              };
              
              console.log(`[OrchestratorV2] Pre-review fixing Chapter ${chapNum}: ${chapterQaIssues.length} issues (critical/major: ${hasCriticalOrMajor})`);
              this.callbacks.onAgentStatus("smart-editor", "active", `Corrigiendo capítulo ${chapNum} (reescritura, ${chapterQaIssues.length} problemas)...`);
              
              try {
                let correctedContent: string | null = null;
                
                if (hasCriticalOrMajor) {
                  // DIRECT FULL REWRITE for critical/major issues - no time wasting with patches
                  console.log(`[OrchestratorV2] FULL REWRITE for Chapter ${chapNum} (critical/major issues detected)`);
                  
                  // Build rich context from World Bible
                  let charactersSection = 'PERSONAJES PRINCIPALES:\n';
                  for (const c of chapterContext.mainCharacters) {
                    charactersSection += `- ${c.name}: ${c.description}`;
                    if (c.physicalTraits) charactersSection += ` | Físico: ${c.physicalTraits}`;
                    if (c.relationships?.length) charactersSection += ` | Relaciones: ${c.relationships.join(', ')}`;
                    charactersSection += '\n';
                  }
                  
                  let locationsSection = '';
                  if (chapterContext.locations.length > 0) {
                    locationsSection = '\nUBICACIONES:\n' + chapterContext.locations.map((l: any) => `- ${l.name}: ${l.description}`).join('\n');
                  }
                  
                  let rulesSection = '';
                  if (chapterContext.worldRules.length > 0) {
                    rulesSection = '\nREGLAS DEL MUNDO:\n' + chapterContext.worldRules.map((r: any) => `- ${typeof r === 'string' ? r : r.rule || r.description || JSON.stringify(r)}`).join('\n');
                  }
                  
                  let injuriesSection = '';
                  if (chapterContext.persistentInjuries.length > 0) {
                    injuriesSection = '\n⚠️ LESIONES PERSISTENTES ACTIVAS (OBLIGATORIO RESPETAR):\n' + chapterContext.persistentInjuries.map((i: any) => {
                      const personaje = i.character || i.personaje;
                      const lesion = i.tipo_lesion || i.injury || i.lesion || i.description;
                      const parte = i.parte_afectada ? ` (${i.parte_afectada})` : '';
                      const efecto = i.efecto_esperado ? ` → ${i.efecto_esperado}` : '';
                      const capOcurre = i.capitulo_ocurre ? ` [desde Cap ${i.capitulo_ocurre}]` : '';
                      return `- ${personaje}: ${lesion}${parte}${capOcurre}${efecto}`;
                    }).join('\n');
                  }
                  
                  let decisionsSection = '';
                  if (chapterContext.plotDecisions.length > 0) {
                    decisionsSection = '\nDECISIONES DE TRAMA ANTERIORES:\n' + chapterContext.plotDecisions.map((d: any) => `- Cap ${d.chapter || d.capitulo_establecido || d.capitulo}: ${d.decision || d.descripcion}`).join('\n');
                  }
                  
                  let timelineSection = '';
                  if (chapterContext.timelineEvents.length > 0) {
                    timelineSection = '\nEVENTOS CRONOLÓGICOS RELEVANTES:\n' + chapterContext.timelineEvents.map((e: any) => `- ${e.event || e.evento}: ${e.timeMarker || e.when || ''}`).join('\n');
                  }
                  
                  const fullContextPrompt = `CONTEXTO COMPLETO PARA REESCRITURA (WORLD BIBLE):
- Proyecto: "${chapterContext.projectTitle}" (${chapterContext.genre})
- Capítulo ${chapterContext.chapterNumber}: "${chapterContext.chapterTitle}"
${chapterContext.previousChapterSummary ? `- Capítulo anterior: ${chapterContext.previousChapterSummary}` : ''}
${chapterContext.nextChapterSummary ? `- Capítulo siguiente: ${chapterContext.nextChapterSummary}` : ''}

${charactersSection}
${locationsSection}
${rulesSection}
${injuriesSection}
${decisionsSection}
${timelineSection}

${chapterContext.styleGuide ? `GUÍA DE ESTILO:\n${chapterContext.styleGuide}\n` : ''}

PROBLEMAS A CORREGIR (OBLIGATORIO):
${issuesDescription}`;

                  // LitAgents 2.1: Use fullRewrite for critical/major issues (surgicalFix returns patches, not corrected_text)
                  const fixResult = await this.smartEditor.fullRewrite({
                    chapterContent: chapter.content,
                    errorDescription: fullContextPrompt,
                    consistencyConstraints: JSON.stringify(chapterContext.mainCharacters),
                  });
                  
                  this.addTokenUsage(fixResult.tokenUsage);
                  await this.logAiUsage(project.id, "smart-editor", "deepseek-chat", fixResult.tokenUsage, chapNum);
                  
                  // fullRewrite returns rewrittenContent, not parsed.corrected_text
                  console.log(`[OrchestratorV2] fullRewrite result for Chapter ${chapNum}: error=${fixResult.error || 'none'}, rewrittenContent=${fixResult.rewrittenContent?.length || 0} chars, content=${fixResult.content?.length || 0} chars`);
                  
                  if (fixResult.rewrittenContent && fixResult.rewrittenContent.length > 100) {
                    correctedContent = fixResult.rewrittenContent;
                    console.log(`[OrchestratorV2] Full rewrite successful for Chapter ${chapNum}: ${correctedContent.length} chars`);
                  } else if (fixResult.content && fixResult.content.length > 100) {
                    // Fallback to raw content if rewrittenContent not parsed
                    correctedContent = fixResult.content;
                    console.log(`[OrchestratorV2] Full rewrite fallback for Chapter ${chapNum}: ${correctedContent.length} chars`);
                  } else {
                    console.warn(`[OrchestratorV2] Full rewrite FAILED for Chapter ${chapNum} - no valid content returned`);
                  }
                } else {
                  // MINOR ISSUES: Use fullRewrite for reliability (patches were failing too often)
                  console.log(`[OrchestratorV2] Minor issues for Chapter ${chapNum}, using fullRewrite for reliability`);
                  
                  const fixResult = await this.smartEditor.fullRewrite({
                    chapterContent: chapter.content,
                    errorDescription: `PROBLEMAS A CORREGIR:\n${issuesDescription}`,
                    consistencyConstraints: JSON.stringify(chapterContext.mainCharacters),
                  });
                  
                  this.addTokenUsage(fixResult.tokenUsage);
                  await this.logAiUsage(project.id, "smart-editor", "deepseek-chat", fixResult.tokenUsage, chapNum);
                  
                  console.log(`[OrchestratorV2] fullRewrite result for minor issues Chapter ${chapNum}: error=${fixResult.error || 'none'}, rewrittenContent=${fixResult.rewrittenContent?.length || 0} chars, content=${fixResult.content?.length || 0} chars`);
                  
                  if (fixResult.rewrittenContent && fixResult.rewrittenContent.length > 100) {
                    correctedContent = fixResult.rewrittenContent;
                    console.log(`[OrchestratorV2] Full rewrite successful for Chapter ${chapNum}: ${correctedContent.length} chars`);
                  } else if (fixResult.content && fixResult.content.length > 100) {
                    correctedContent = fixResult.content;
                    console.log(`[OrchestratorV2] Full rewrite fallback for Chapter ${chapNum}: ${correctedContent.length} chars`);
                  } else {
                    console.warn(`[OrchestratorV2] Full rewrite FAILED for minor issues Chapter ${chapNum} - no valid content returned`);
                  }
                }
                
                const chapterSources = Array.from(new Set(chapterQaIssues.map(i => i.source)));
                
                if (correctedContent) {
                  await storage.updateChapter(chapter.id, {
                    content: correctedContent,
                    status: "completed",
                  });
                  preReviewCorrected++;
                  preReviewFixes.push({ chapter: chapNum, issueCount: chapterQaIssues.length, sources: chapterSources, success: true });
                  console.log(`[OrchestratorV2] Pre-review: Chapter ${chapNum} corrected successfully`);
                  
                  // === UPDATE WORLD BIBLE AFTER REWRITE ===
                  // Extract any new plot decisions or character changes from rewritten chapter
                  try {
                    await this.updateWorldBibleFromChapter(project.id, chapNum, correctedContent, chapterQaIssues);
                  } catch (wbError) {
                    console.error(`[OrchestratorV2] Failed to update World Bible after Chapter ${chapNum} rewrite:`, wbError);
                  }
                } else {
                  preReviewFixes.push({ chapter: chapNum, issueCount: chapterQaIssues.length, sources: chapterSources, success: false });
                }
              } catch (fixError) {
                const chapterSources = Array.from(new Set(chapterQaIssues.map(i => i.source)));
                preReviewFixes.push({ chapter: chapNum, issueCount: chapterQaIssues.length, sources: chapterSources, success: false });
                console.error(`[OrchestratorV2] Pre-review fix failed for Chapter ${chapNum}:`, fixError);
              }
            }
            
            console.log(`[OrchestratorV2] PRE-REVIEW CORRECTION complete: ${preReviewCorrected}/${chaptersToFix.length} chapters corrected`);
            this.callbacks.onAgentStatus("beta-reader", "active", `Pre-corrección: ${preReviewCorrected} capítulos arreglados. Iniciando revisión final...`);
            
            // HASH-BASED RESOLUTION: Mark successfully corrected issues as resolved
            const successfullyFixedChapters = preReviewFixes.filter(f => f.success).map(f => f.chapter);
            if (successfullyFixedChapters.length > 0) {
              // Update chapter correction counts to track how many times each chapter has been corrected
              for (const chapNum of successfullyFixedChapters) {
                const currentCount = chapterCorrectionCounts.get(chapNum) || 0;
                chapterCorrectionCounts.set(chapNum, currentCount + 1);
              }
              // Persist correction counts to database
              await storage.updateProject(project.id, {
                chapterCorrectionCounts: Object.fromEntries(chapterCorrectionCounts) as any,
              });
              console.log(`[OrchestratorV2] Updated chapter correction counts for chapters: ${successfullyFixedChapters.join(', ')}`);
              
              // Mark the issues for these chapters as resolved using hash system
              const issuesToResolve = previousCycleIssuesFiltered.filter(issue => {
                const affectedChapters = issue.capitulos_afectados || [];
                return affectedChapters.some(ch => successfullyFixedChapters.includes(ch));
              });
              if (issuesToResolve.length > 0) {
                await this.markIssuesResolved(project.id, issuesToResolve);
              }
              
              // Also remove fixed chapters from qaIssues to avoid re-attempting in this session
              const originalQaCount = qaIssues.length;
              qaIssues = qaIssues.filter(issue => {
                const chapNum = issue.capitulo || (issue.capitulos ? issue.capitulos[0] : null);
                return chapNum ? !successfullyFixedChapters.includes(chapNum) : true;
              });
              console.log(`[OrchestratorV2] Removed ${originalQaCount - qaIssues.length} fixed issues from qaIssues (${qaIssues.length} remaining)`);
            }
            
            // === LOG PRE-REVIEW FIXES REPORT ===
            const successfulFixes = preReviewFixes.filter(f => f.success);
            const failedFixes = preReviewFixes.filter(f => !f.success);
            
            let preReviewReport = `[INFORME PRE-CORRECCIÓN QA]\n`;
            preReviewReport += `Total issues detectados: ${qaIssues.length + preReviewFixes.reduce((sum, f) => sum + f.issueCount, 0)}\n`;
            preReviewReport += `Capítulos procesados: ${chaptersToFix.length}\n`;
            preReviewReport += `Correcciones exitosas: ${successfulFixes.length}\n`;
            preReviewReport += `Correcciones fallidas: ${failedFixes.length}\n\n`;
            
            if (successfulFixes.length > 0) {
              preReviewReport += `ARREGLOS REALIZADOS:\n`;
              for (const fix of successfulFixes) {
                preReviewReport += `  ✓ Capítulo ${fix.chapter}: ${fix.issueCount} problema(s) corregido(s) [${fix.sources.join(', ')}]\n`;
              }
            }
            
            if (failedFixes.length > 0) {
              preReviewReport += `\nARREGLOS FALLIDOS:\n`;
              for (const fix of failedFixes) {
                preReviewReport += `  ✗ Capítulo ${fix.chapter}: ${fix.issueCount} problema(s) NO corregido(s) [${fix.sources.join(', ')}]\n`;
              }
            }
            
            // Save to activity logs
            await storage.createActivityLog({
              projectId: project.id,
              level: failedFixes.length > 0 ? "warn" : "success",
              agentRole: "qa-audit",
              message: preReviewReport,
            });
            
            console.log(`[OrchestratorV2] Pre-review report logged:\n${preReviewReport}`);
            
            // === SAVE STRUCTURED QA AUDIT REPORT TO DATABASE ===
            qaAuditData.corrections = preReviewFixes;
            qaAuditData.successCount = successfulFixes.length;
            qaAuditData.failCount = failedFixes.length;
            
            await storage.updateProject(project.id, { qaAuditReport: qaAuditData as any });
            console.log(`[OrchestratorV2] QA audit report saved to project: ${qaAuditData.totalFindings} findings, ${qaAuditData.successCount} fixed, ${qaAuditData.failCount} failed`);
            
            // Clear QA issues after correction (they've been fixed)
            qaIssues.length = 0;
            
            // Refresh chapters from storage after corrections
            const refreshedChapters = await storage.getChaptersByProject(project.id);
            completedChapters = refreshedChapters
              .filter(c => c.status === "completed" || c.status === "approved")
              .sort((a, b) => a.chapterNumber - b.chapterNumber);
          }
          // === END PRE-REVIEW CORRECTION ===
        }
        // === END QA AUDIT ===
        currentCycle++;
        // PERSIST cycle state to database for restart recovery
        await storage.updateProject(project.id, { 
          revisionCycle: currentCycle,
          qaAuditCompleted: true 
        });
        console.log(`[OrchestratorV2] Final review cycle ${currentCycle}/${maxCycles} (persisted to DB)`);
        if (correctedIssuesSummaries.length > 0) {
          console.log(`[OrchestratorV2] Passing ${correctedIssuesSummaries.length} previously corrected issues to FinalReviewer`);
        }

        if (await this.shouldStopProcessing(project.id)) {
          console.log(`[OrchestratorV2] Final review cancelled for project ${project.id}`);
          await this.updateProjectTokens(project.id);
          await storage.updateProject(project.id, { status: "paused" });
          return;
        }

        // Refresh chapters from storage to get any updates from previous cycle
        const freshChapters = await storage.getChaptersByProject(project.id);
        const currentChapters = freshChapters
          .filter(c => c.status === "completed" || c.status === "approved")
          .sort((a, b) => a.chapterNumber - b.chapterNumber);

        // Prepare chapters for FinalReviewer
        const chaptersForReview = currentChapters.map(c => ({
          numero: c.chapterNumber,
          titulo: c.title || `Capítulo ${c.chapterNumber}`,
          contenido: c.content || "",
        }));

        this.callbacks.onAgentStatus("final-reviewer", "active", `Analizando manuscrito completo (ciclo ${currentCycle})...`);

        // Run FinalReviewer with progress callback for tranche visibility
        // Pass previously corrected issues and score so FinalReviewer maintains consistency
        // Extract 3-act structure from World Bible for narrative-coherent review
        // Handle both camelCase (threeActStructure) and snake_case (three_act_structure) field names
        const rawActStructure = worldBibleData?.threeActStructure || worldBibleData?.three_act_structure;
        const threeActStructure = rawActStructure as { 
          act1: { chapters: number[]; goal: string }; 
          act2: { chapters: number[]; goal: string }; 
          act3: { chapters: number[]; goal: string }; 
        } | undefined;
        
        if (threeActStructure) {
          console.log(`[OrchestratorV2] Using 3-act structure for review: Act1=${threeActStructure.act1?.chapters?.length || 0} caps, Act2=${threeActStructure.act2?.chapters?.length || 0} caps, Act3=${threeActStructure.act3?.chapters?.length || 0} caps`);
        } else {
          console.log(`[OrchestratorV2] No 3-act structure found in World Bible, using fixed-size tranches`);
        }
        
        const reviewResult = await this.finalReviewer.execute({
          projectTitle: project.title,
          chapters: chaptersForReview,
          worldBible: worldBibleData,
          guiaEstilo,
          pasadaNumero: currentCycle,
          issuesPreviosCorregidos: correctedIssuesSummaries.length > 0 ? correctedIssuesSummaries : undefined,
          puntuacionPasadaAnterior: previousCycleScore,
          threeActStructure,
          onTrancheProgress: (currentTranche, totalTranches, chaptersInTranche) => {
            this.callbacks.onAgentStatus(
              "final-reviewer", 
              "active", 
              `Revisando ${chaptersInTranche}...`
            );
            console.log(`[OrchestratorV2] FinalReviewer progress: ${currentTranche}/${totalTranches} - ${chaptersInTranche}`);
          },
        });

        this.addTokenUsage(reviewResult.tokenUsage);
        await this.logAiUsage(project.id, "final-reviewer", "deepseek-reasoner", reviewResult.tokenUsage);

        // FinalReviewer returns 'result' not 'parsed'
        if (!reviewResult.result) {
          console.error("[OrchestratorV2] FinalReviewer failed to parse result");
          this.callbacks.onError("Error al analizar el manuscrito");
          await storage.updateProject(project.id, { status: "error" });
          return;
        }

        finalResult = reviewResult.result;
        let { veredicto, puntuacion_global, issues, capitulos_para_reescribir } = finalResult;

        // NOTE: Issues are now tracked via hash system. The finalReviewResult is saved to DB
        // and issues are filtered using resolvedIssueHashes on next cycle (see pre-review correction section)
        console.log(`[OrchestratorV2] Review result: ${veredicto}, score: ${puntuacion_global}, chapters to rewrite: ${capitulos_para_reescribir?.length || 0}, issues: ${issues?.length || 0}`);
        
        // Detect score regression - this should not happen normally
        if (previousCycleScore !== undefined && puntuacion_global < previousCycleScore) {
          console.warn(`[OrchestratorV2] ⚠️ SCORE REGRESSION: Score dropped from ${previousCycleScore} to ${puntuacion_global} in cycle ${currentCycle}`);
          await storage.createActivityLog({
            projectId: project.id,
            level: "warn",
            message: `Puntuación bajó de ${previousCycleScore} a ${puntuacion_global} en ciclo ${currentCycle}. Esto puede indicar inconsistencia del revisor o regresiones introducidas por las correcciones.`,
            agentRole: "final-reviewer",
          });
        }
        
        // Save current score for next cycle
        previousCycleScore = puntuacion_global;
        
        // === PERSIST REVIEW RESULT AFTER EACH CYCLE (like reeditor) ===
        // Add cycle number to the result for tracking
        const reviewResultWithCycle = {
          ...finalResult,
          revisionCycle: currentCycle,
          evaluatedAt: new Date().toISOString(),
        };
        
        await storage.updateProject(project.id, {
          finalReviewResult: reviewResultWithCycle as any,
          finalScore: puntuacion_global,
          revisionCycle: currentCycle,
        });
        
        // Log the report to activity logs for export
        await storage.createActivityLog({
          projectId: project.id,
          level: puntuacion_global >= MIN_ACCEPTABLE_SCORE ? "success" : "info",
          agentRole: "final-reviewer",
          message: `[Ciclo ${currentCycle}] Puntuación: ${puntuacion_global}/10 | Veredicto: ${veredicto} | Issues: ${issues?.length || 0} | Capítulos a corregir: ${capitulos_para_reescribir?.length || 0}`,
        });
        
        console.log(`[OrchestratorV2] Cycle ${currentCycle} report persisted: ${puntuacion_global}/10, ${issues?.length || 0} issues`);

        // ORCHESTRATOR SAFETY NET: If capitulos_para_reescribir is empty but there are ANY issues,
        // extract chapters from ALL issues to trigger auto-correction (not just critical/major)
        if ((!capitulos_para_reescribir || capitulos_para_reescribir.length === 0) && issues && issues.length > 0) {
          const extractedChapters: number[] = [];
          for (const issue of issues) {
            // Extract from ALL issues that have chapter info and correction instructions
            if (issue.capitulos_afectados?.length > 0 && issue.instrucciones_correccion) {
              extractedChapters.push(...issue.capitulos_afectados);
            }
          }
          if (extractedChapters.length > 0) {
            capitulos_para_reescribir = Array.from(new Set(extractedChapters));
            finalResult.capitulos_para_reescribir = capitulos_para_reescribir;
            console.log(`[OrchestratorV2] SAFETY NET: Extracted ${capitulos_para_reescribir.length} chapters from ${issues.length} issues with correction instructions: ${capitulos_para_reescribir.join(", ")}`);
          } else {
            // Last resort: extract from ALL issues even without explicit instructions
            for (const issue of issues) {
              if (issue.capitulos_afectados?.length > 0) {
                extractedChapters.push(...issue.capitulos_afectados);
              }
            }
            if (extractedChapters.length > 0) {
              capitulos_para_reescribir = Array.from(new Set(extractedChapters));
              finalResult.capitulos_para_reescribir = capitulos_para_reescribir;
              console.log(`[OrchestratorV2] LAST RESORT: Extracted ${capitulos_para_reescribir.length} chapters from ALL issues: ${capitulos_para_reescribir.join(", ")}`);
            }
          }
        }

        // Track score history for consecutive check
        previousScores.push(puntuacion_global);
        
        // === CONSOLIDATE QA ISSUES WITH FINALREVIEWER ISSUES ===
        // On first cycle, merge QA issues into the issues list and capitulos_para_reescribir
        if (currentCycle === 1 && qaIssues.length > 0) {
          console.log(`[OrchestratorV2] Consolidating ${qaIssues.length} QA issues with FinalReviewer results`);
          
          // Ensure arrays are initialized (FinalReviewer may return undefined)
          issues = issues ?? [];
          capitulos_para_reescribir = capitulos_para_reescribir ?? [];
          
          // Convert QA issues to FinalReviewIssue format and add to issues array
          for (const qaIssue of qaIssues) {
            const targetChapters = qaIssue.capitulo ? [qaIssue.capitulo] : (qaIssue.capitulos || []);
            if (targetChapters.length > 0) {
              // Add to capitulos_para_reescribir if not already there
              for (const chap of targetChapters) {
                if (!capitulos_para_reescribir.includes(chap)) {
                  capitulos_para_reescribir.push(chap);
                }
              }
              
              // Add as issue for correction instructions
              issues.push({
                categoria: `QA:${qaIssue.source}`,
                severidad: qaIssue.severidad === 'critica' ? 'critica' : 'mayor',
                descripcion: qaIssue.descripcion,
                capitulos_afectados: targetChapters,
                instruccion_correccion: qaIssue.correccion || `Corregir: ${qaIssue.descripcion}`,
              } as FinalReviewIssue);
            }
          }
          
          console.log(`[OrchestratorV2] After QA merge: ${issues.length} total issues, ${capitulos_para_reescribir.length} chapters to rewrite`);
          
          // Clear QA issues after merging (they've been incorporated)
          qaIssues = [];
        }
        
        // Check for issues that need correction
        const hasAnyNewIssues = (issues?.length || 0) > 0 || (capitulos_para_reescribir?.length || 0) > 0;
        
        // ITERATIVE QUALITY GATE: Require 2 consecutive scores ≥9 with NO pending issues
        if (puntuacion_global >= MIN_ACCEPTABLE_SCORE && !hasAnyNewIssues) {
          consecutiveHighScores++;
          // CRITICAL: Persist to database to survive auto-recovery/restarts
          await storage.updateProject(project.id, { consecutiveHighScores });
          console.log(`[OrchestratorV2] Score ${puntuacion_global}/10 with NO issues. Consecutive high scores: ${consecutiveHighScores}/${REQUIRED_CONSECUTIVE_HIGH_SCORES} (persisted)`);
          
          if (consecutiveHighScores >= REQUIRED_CONSECUTIVE_HIGH_SCORES) {
            const recentScores = previousScores.slice(-REQUIRED_CONSECUTIVE_HIGH_SCORES).join(", ");
            console.log(`[OrchestratorV2] APPROVED: ${REQUIRED_CONSECUTIVE_HIGH_SCORES} consecutive scores ≥${MIN_ACCEPTABLE_SCORE}: [${recentScores}]`);
            this.callbacks.onAgentStatus("final-reviewer", "completed", `Manuscrito APROBADO. Puntuaciones consecutivas: ${recentScores}/10.`);
            break;
          }
          
          // Not enough consecutive high scores yet - continue to next cycle without corrections
          this.callbacks.onAgentStatus("final-reviewer", "active", `Puntuación ${puntuacion_global}/10. Necesita ${REQUIRED_CONSECUTIVE_HIGH_SCORES - consecutiveHighScores} evaluación(es) más para confirmar.`);
          continue;
        } else if (puntuacion_global >= MIN_ACCEPTABLE_SCORE && hasAnyNewIssues) {
          // Good score but issues remain - must correct before counting as high score
          console.log(`[OrchestratorV2] Score ${puntuacion_global}/10 is good but ${issues?.length || 0} issue(s) remain. Correcting before counting...`);
          // Don't increment consecutiveHighScores - we need to fix issues first
        } else {
          // Score below threshold - reset consecutive counter
          consecutiveHighScores = 0;
          // CRITICAL: Persist reset to database to survive auto-recovery/restarts
          await storage.updateProject(project.id, { consecutiveHighScores: 0 });
          console.log(`[OrchestratorV2] Score ${puntuacion_global}/10 < ${MIN_ACCEPTABLE_SCORE}. Consecutive high scores reset to 0 (persisted).`);
        }
        
        // Score < 9: If we STILL have no chapters to fix despite having issues, 
        // the FinalReviewer didn't provide actionable feedback - log and continue to next cycle
        if ((capitulos_para_reescribir?.length || 0) === 0) {
          if (issues && issues.length > 0) {
            // Log that we have issues but can't determine which chapters to fix
            console.log(`[OrchestratorV2] Score ${puntuacion_global}/10 with ${issues.length} issues but no actionable chapter references. Issues: ${issues.map(i => i.categoria).join(", ")}`);
            await storage.createActivityLog({
              projectId: project.id,
              level: "warn",
              message: `FinalReviewer detectó ${issues.length} problemas pero sin referencias de capítulos accionables. Requiere revisión del prompt.`,
              agentRole: "final-reviewer",
            });
          }
          console.log(`[OrchestratorV2] Score ${puntuacion_global} < 9 but no chapters to rewrite. Continuing to next cycle...`);
          continue; // Try next cycle instead of breaking
        }

        // Auto-correct problematic chapters - ALWAYS try to correct, even in last cycle
        if (capitulos_para_reescribir && capitulos_para_reescribir.length > 0) {
          console.log(`[OrchestratorV2] Starting auto-correction for ${capitulos_para_reescribir.length} chapters`);
          this.callbacks.onAgentStatus("smart-editor", "active", `Auto-corrigiendo ${capitulos_para_reescribir.length} capítulo(s)...`);
          
          // === PROBLEM AGGREGATOR: Consolidate ALL issues per chapter BEFORE rewriting ===
          // This ensures each chapter is rewritten ONCE with ALL its issues, not problem-by-problem
          const aggregatedIssuesByChapter = new Map<number, {
            issues: FinalReviewIssue[];
            hasCritical: boolean;
            totalCount: number;
            sources: Set<string>;
          }>();
          
          // Ensure issues array is initialized
          const allIssues = issues ?? [];
          
          // Aggregate all issues by chapter
          for (const issue of allIssues) {
            const affectedChapters = issue.capitulos_afectados || [];
            for (const chapNum of affectedChapters) {
              if (!aggregatedIssuesByChapter.has(chapNum)) {
                aggregatedIssuesByChapter.set(chapNum, {
                  issues: [],
                  hasCritical: false,
                  totalCount: 0,
                  sources: new Set(),
                });
              }
              const chapterData = aggregatedIssuesByChapter.get(chapNum)!;
              chapterData.issues.push(issue);
              chapterData.totalCount++;
              if (issue.severidad === "critica") chapterData.hasCritical = true;
              chapterData.sources.add(issue.categoria?.split(':')[0] || 'general');
            }
          }
          
          console.log(`[OrchestratorV2] PROBLEM AGGREGATOR: ${aggregatedIssuesByChapter.size} chapters with issues, ${allIssues.length} total issues`);
          for (const [chapNum, data] of aggregatedIssuesByChapter) {
            console.log(`  - Cap ${chapNum}: ${data.totalCount} issues from [${Array.from(data.sources).join(', ')}]${data.hasCritical ? ' (CRITICAL)' : ''}`);
          }
          
          // Notify frontend about chapters being corrected (like reedit-orchestrator does)
          if (this.callbacks.onChaptersBeingCorrected) {
            this.callbacks.onChaptersBeingCorrected(capitulos_para_reescribir, currentCycle);
          }

          let correctedCount = 0;
          let failedCount = 0;
          const failedChaptersDetails: Array<{ chapterNumber: number; title: string; error: string; issues: string[] }> = [];

          for (const chapNum of capitulos_para_reescribir) {
            if (await this.shouldStopProcessing(project.id)) {
              await this.updateProjectTokens(project.id);
              await storage.updateProject(project.id, { status: "paused" });
              return;
            }

            const chapter = currentChapters.find(c => c.chapterNumber === chapNum);
            if (!chapter) {
              console.log(`[OrchestratorV2] Chapter ${chapNum} not found, skipping`);
              continue;
            }

            // Get ALL aggregated issues for this chapter (already consolidated)
            const aggregatedData = aggregatedIssuesByChapter.get(chapNum);
            if (!aggregatedData || aggregatedData.issues.length === 0) {
              console.log(`[OrchestratorV2] No aggregated issues found for Chapter ${chapNum}, skipping`);
              continue;
            }
            
            const chapterIssues = aggregatedData.issues;
            const hasCriticalIssue = aggregatedData.hasCritical;
            const hasMajorIssue = chapterIssues.some(i => i.severidad === 'mayor');
            const hasCriticalOrMajor = hasCriticalIssue || hasMajorIssue;

            console.log(`[OrchestratorV2] Correcting Chapter ${chapNum}: ${chapterIssues.length} issues (critical/major: ${hasCriticalOrMajor})`);
            this.callbacks.onAgentStatus("smart-editor", "active", `Corrigiendo capítulo ${chapNum} (${hasCriticalOrMajor ? 'reescritura' : 'parches'}, ${chapterIssues.length} problemas)...`);

            // Build UNIFIED correction prompt from ALL aggregated issues
            const issuesDescription = chapterIssues.map(i => 
              `- [${i.severidad?.toUpperCase() || 'MAYOR'}] ${i.categoria}: ${i.descripcion}\n  Corrección: ${i.instruccion_correccion || i.instrucciones_correccion || 'Corregir según descripción'}`
            ).join("\n");
            
            // Build comprehensive context for rewrites FROM WORLD BIBLE
            const chapterContext = {
              projectTitle: project.title,
              genre: project.genre,
              chapterNumber: chapNum,
              chapterTitle: chapter.title,
              previousChapterSummary: currentChapters.find(c => c.chapterNumber === chapNum - 1)?.summary || '',
              nextChapterSummary: currentChapters.find(c => c.chapterNumber === chapNum + 1)?.summary || '',
              // Characters with relationships
              mainCharacters: (worldBibleData.characters || []).slice(0, 10).map((c: any) => ({
                name: c.name,
                description: c.description || c.role || '',
                relationships: c.relationships || [],
                physicalTraits: c.physicalTraits || c.physical_traits || '',
                personality: c.personality || '',
              })),
              // World rules and lore
              worldRules: (worldBibleData.worldRules || worldBibleData.rules || []).slice(0, 10),
              // Locations (check settings in plotOutline for LitAgents 2.1 compatibility)
              locations: (worldBibleData.locations || worldBibleData.settings || (worldBibleData.plotOutline as any)?.settings || []).slice(0, 8).map((l: any) => ({
                name: l.name,
                description: l.description || l.atmosphere || '',
              })),
              // Timeline events relevant to this chapter
              timelineEvents: ((worldBibleData.timeline || []) as any[])
                .filter((e: any) => e.chapter === chapNum || e.chapter === chapNum - 1 || e.chapter === chapNum + 1)
                .slice(0, 5),
              // Plot decisions made so far
              plotDecisions: (worldBibleData.plotDecisions || []).slice(-10),
              // Persistent injuries/conditions
              persistentInjuries: (worldBibleData.persistentInjuries || []).slice(0, 8),
              styleGuide: project.architectInstructions?.substring(0, 1000) || '',
            };

            let correctedContent: string | null = null;

            try {
              if (hasCriticalOrMajor) {
                // DIRECT FULL REWRITE for critical/major issues
                console.log(`[OrchestratorV2] FULL REWRITE for Chapter ${chapNum} (critical/major issues)`);
                
                // Build rich context from World Bible
                let charactersSection = 'PERSONAJES PRINCIPALES:\n';
                for (const c of chapterContext.mainCharacters) {
                  charactersSection += `- ${c.name}: ${c.description}`;
                  if (c.physicalTraits) charactersSection += ` | Físico: ${c.physicalTraits}`;
                  if (c.relationships?.length) charactersSection += ` | Relaciones: ${c.relationships.join(', ')}`;
                  charactersSection += '\n';
                }
                
                let locationsSection = '';
                if (chapterContext.locations.length > 0) {
                  locationsSection = '\nUBICACIONES:\n' + chapterContext.locations.map((l: any) => `- ${l.name}: ${l.description}`).join('\n');
                }
                
                let rulesSection = '';
                if (chapterContext.worldRules.length > 0) {
                  rulesSection = '\nREGLAS DEL MUNDO:\n' + chapterContext.worldRules.map((r: any) => `- ${typeof r === 'string' ? r : r.rule || r.description || JSON.stringify(r)}`).join('\n');
                }
                
                let injuriesSection = '';
                if (chapterContext.persistentInjuries.length > 0) {
                  injuriesSection = '\n⚠️ LESIONES PERSISTENTES ACTIVAS (OBLIGATORIO RESPETAR):\n' + chapterContext.persistentInjuries.map((i: any) => {
                    const personaje = i.character || i.personaje;
                    const lesion = i.tipo_lesion || i.injury || i.lesion || i.description;
                    const parte = i.parte_afectada ? ` (${i.parte_afectada})` : '';
                    const efecto = i.efecto_esperado ? ` → ${i.efecto_esperado}` : '';
                    const capOcurre = i.capitulo_ocurre ? ` [desde Cap ${i.capitulo_ocurre}]` : '';
                    return `- ${personaje}: ${lesion}${parte}${capOcurre}${efecto}`;
                  }).join('\n');
                }
                
                let decisionsSection = '';
                if (chapterContext.plotDecisions.length > 0) {
                  decisionsSection = '\nDECISIONES DE TRAMA ANTERIORES:\n' + chapterContext.plotDecisions.map((d: any) => `- Cap ${d.chapter || d.capitulo_establecido || d.capitulo}: ${d.decision || d.descripcion}`).join('\n');
                }
                
                let timelineSection = '';
                if (chapterContext.timelineEvents.length > 0) {
                  timelineSection = '\nEVENTOS CRONOLÓGICOS RELEVANTES:\n' + chapterContext.timelineEvents.map((e: any) => `- ${e.event || e.evento}: ${e.timeMarker || e.when || ''}`).join('\n');
                }
                
                const fullContextPrompt = `CONTEXTO COMPLETO PARA REESCRITURA (WORLD BIBLE):
- Proyecto: "${chapterContext.projectTitle}" (${chapterContext.genre})
- Capítulo ${chapterContext.chapterNumber}: "${chapterContext.chapterTitle}"
${chapterContext.previousChapterSummary ? `- Capítulo anterior: ${chapterContext.previousChapterSummary}` : ''}
${chapterContext.nextChapterSummary ? `- Capítulo siguiente: ${chapterContext.nextChapterSummary}` : ''}

${charactersSection}
${locationsSection}
${rulesSection}
${injuriesSection}
${decisionsSection}
${timelineSection}

${chapterContext.styleGuide ? `GUÍA DE ESTILO:\n${chapterContext.styleGuide}\n` : ''}

PROBLEMAS A CORREGIR (OBLIGATORIO):
${issuesDescription}`;

                // LitAgents 2.1: Use fullRewrite for critical/major issues
                const fixResult = await this.smartEditor.fullRewrite({
                  chapterContent: chapter.content || "",
                  errorDescription: fullContextPrompt,
                  consistencyConstraints: JSON.stringify(chapterContext.mainCharacters),
                });

                this.addTokenUsage(fixResult.tokenUsage);
                await this.logAiUsage(project.id, "smart-editor", "deepseek-chat", fixResult.tokenUsage, chapNum);

                // fullRewrite returns rewrittenContent
                if (fixResult.rewrittenContent && fixResult.rewrittenContent.length > 100) {
                  correctedContent = fixResult.rewrittenContent;
                  console.log(`[OrchestratorV2] Full rewrite successful: ${correctedContent.length} chars`);
                } else if (fixResult.content && fixResult.content.length > 100) {
                  correctedContent = fixResult.content;
                  console.log(`[OrchestratorV2] Full rewrite fallback: ${correctedContent.length} chars`);
                }
              } else {
                // MINOR ISSUES ONLY: Try patches first
                console.log(`[OrchestratorV2] Minor issues only, trying patches for Chapter ${chapNum}`);
                const editResult = await this.smartEditor.execute({
                  chapterContent: chapter.content || "",
                  sceneBreakdown: chapter.sceneBreakdown as any || { scenes: [] },
                  worldBible: worldBibleData,
                  additionalContext: `PROBLEMAS DETECTADOS POR EL CRÍTICO (CORREGIR OBLIGATORIAMENTE):\n${issuesDescription}`,
                });

                this.addTokenUsage(editResult.tokenUsage);
                await this.logAiUsage(project.id, "smart-editor", "deepseek-chat", editResult.tokenUsage, chapNum);

                if (editResult.parsed) {
                  // Apply patches if available
                  if (editResult.parsed.patches && editResult.parsed.patches.length > 0) {
                    console.log(`[OrchestratorV2] Applying ${editResult.parsed.patches.length} patches to Chapter ${chapNum}`);
                    const patchResult = applyPatches(chapter.content || "", editResult.parsed.patches);
                    if (patchResult.appliedPatches > 0) {
                      correctedContent = patchResult.patchedText;
                      console.log(`[OrchestratorV2] Applied ${patchResult.appliedPatches} patches to Chapter ${chapNum}`);
                    } else {
                      console.log(`[OrchestratorV2] No patches applied to Chapter ${chapNum}`);
                    }
                  }
                  
                  // If no patches applied but needs_rewrite is true, use surgicalFix as fallback
                  if (!correctedContent && editResult.parsed.needs_rewrite) {
                    console.log(`[OrchestratorV2] Using surgicalFix as fallback for Chapter ${chapNum}`);
                    const fixResult = await this.smartEditor.surgicalFix({
                      chapterContent: chapter.content || "",
                      errorDescription: issuesDescription,
                    });
                    this.addTokenUsage(fixResult.tokenUsage);
                    // surgicalFix returns patches, apply them
                    if (fixResult.patches && fixResult.patches.length > 0) {
                      const patchResult = applyPatches(chapter.content || "", fixResult.patches);
                      if (patchResult.modifiedContent && patchResult.modifiedContent.length > 100) {
                        correctedContent = patchResult.modifiedContent;
                        console.log(`[OrchestratorV2] Fallback surgicalFix applied ${fixResult.patches.length} patches`);
                      }
                    } else if (fixResult.fullContent && fixResult.fullContent.length > 100) {
                      correctedContent = fixResult.fullContent;
                      console.log(`[OrchestratorV2] Fallback surgicalFix returned ${correctedContent.length} chars`);
                    }
                  }

                  // FALLBACK: If still no content, use fullRewrite as last resort
                  if (!correctedContent) {
                    console.log(`[OrchestratorV2] Forcing fullRewrite as last resort for Chapter ${chapNum}`);
                    const fixResult = await this.smartEditor.fullRewrite({
                      chapterContent: chapter.content || "",
                      errorDescription: issuesDescription,
                    });
                    this.addTokenUsage(fixResult.tokenUsage);
                    if (fixResult.rewrittenContent && fixResult.rewrittenContent.length > 100) {
                      correctedContent = fixResult.rewrittenContent;
                      console.log(`[OrchestratorV2] Last resort fullRewrite successful`);
                    } else if (fixResult.content && fixResult.content.length > 100) {
                      correctedContent = fixResult.content;
                    }
                  }
                }
              }
            } catch (error) {
              const errorMsg = error instanceof Error ? error.message : 'Error desconocido';
              console.error(`[OrchestratorV2] Error correcting Chapter ${chapNum}:`, error);
              this.callbacks.onAgentStatus("smart-editor", "error", `Error en capítulo ${chapNum}: ${errorMsg}`);
              failedChaptersDetails.push({
                chapterNumber: chapNum,
                title: chapter.title || `Capítulo ${chapNum}`,
                error: errorMsg,
                issues: chapterIssues.map(i => `[${i.severidad}] ${i.descripcion}`)
              });
              failedCount++;
              continue;
            }

            // Update chapter if we have corrected content
            if (correctedContent && correctedContent !== chapter.content) {
              const wordCount = correctedContent.split(/\s+/).length;
              await storage.updateChapter(chapter.id, {
                content: correctedContent,
                wordCount,
                qualityScore: 8, // Assume improvement
              });
              
              console.log(`[OrchestratorV2] Successfully updated Chapter ${chapNum} (${wordCount} words)`);
              this.callbacks.onAgentStatus("smart-editor", "active", `Capitulo ${chapNum} corregido (${wordCount} palabras)`);
              this.callbacks.onChapterComplete(
                chapter.chapterNumber,
                wordCount,
                chapter.title || `Capítulo ${chapter.chapterNumber}`
              );
              correctedCount++;
              
              // === UPDATE WORLD BIBLE AFTER REWRITE ===
              try {
                await this.updateWorldBibleFromChapter(project.id, chapNum, correctedContent, chapterIssues as any);
              } catch (wbError) {
                console.error(`[OrchestratorV2] Failed to update World Bible after Chapter ${chapNum} rewrite:`, wbError);
              }
              
              // Track corrected issues for next cycle
              for (const issue of chapterIssues) {
                correctedIssuesSummaries.push(`Cap ${chapNum}: ${issue.categoria} - ${issue.descripcion.substring(0, 100)}`);
              }
            } else {
              // If no changes, force multiple retry attempts with increasingly aggressive instructions
              console.log(`[OrchestratorV2] Chapter ${chapNum} unchanged - forcing aggressive rewrite`);
              let retrySuccess = false;
              const maxRetries = 3;
              
              for (let attempt = 1; attempt <= maxRetries && !retrySuccess; attempt++) {
                this.callbacks.onAgentStatus("smart-editor", "active", `Capitulo ${chapNum}: reintento ${attempt}/${maxRetries}...`);
                
                try {
                  const aggressiveIssues = `REINTENTO ${attempt}/${maxRetries} - ES OBLIGATORIO MODIFICAR ESTE CAPITULO.\n\nProblemas que DEBEN corregirse:\n${issuesDescription}\n\nINSTRUCCIONES ESTRICTAS:\n- NO devuelvas el texto sin cambios bajo ninguna circunstancia\n- Realiza TODAS las correcciones indicadas\n- Si no ves problemas obvios, mejora la prosa y el ritmo narrativo\n- El texto devuelto DEBE ser diferente al original`;
                  const retryResult = await this.smartEditor.surgicalFix({
                    chapterContent: chapter.content || "",
                    errorDescription: aggressiveIssues,
                  });
                  this.addTokenUsage(retryResult.tokenUsage);
                  
                  let correctedText: string | null = null;
                  
                  // surgicalFix returns patches, not parsed.corrected_text
                  if (retryResult.patches && retryResult.patches.length > 0) {
                    const patchResult: PatchResult = applyPatches(chapter.content || "", retryResult.patches);
                    if (patchResult.success && patchResult.patchedText && patchResult.patchedText !== chapter.content) {
                      correctedText = patchResult.patchedText;
                      console.log(`[OrchestratorV2] Retry ${attempt}: Applied ${patchResult.appliedPatches} patches to Chapter ${chapNum}`);
                    }
                  } else if (retryResult.fullContent && retryResult.fullContent !== chapter.content) {
                    // Fallback: if parsing failed, use full content
                    correctedText = retryResult.fullContent;
                    console.log(`[OrchestratorV2] Retry ${attempt}: Using fullContent fallback for Chapter ${chapNum}`);
                  }
                  
                  if (correctedText && correctedText.length > 100) {
                    const wordCount = correctedText.split(/\s+/).length;
                    await storage.updateChapter(chapter.id, {
                      content: correctedText,
                      wordCount,
                      qualityScore: 8,
                    });
                    console.log(`[OrchestratorV2] Retry ${attempt} successful for Chapter ${chapNum} (${wordCount} words)`);
                    this.callbacks.onAgentStatus("smart-editor", "active", `Capitulo ${chapNum} corregido en reintento ${attempt} (${wordCount} palabras)`);
                    correctedCount++;
                    retrySuccess = true;
                    
                    // Track corrected issues for next cycle
                    for (const issue of chapterIssues) {
                      correctedIssuesSummaries.push(`Cap ${chapNum}: ${issue.categoria} - ${issue.descripcion.substring(0, 100)}`);
                    }
                  } else {
                    console.log(`[OrchestratorV2] Chapter ${chapNum} still unchanged after retry ${attempt} (no patches or same content)`);
                  }
                } catch (retryError) {
                  console.error(`[OrchestratorV2] Retry ${attempt} failed for Chapter ${chapNum}:`, retryError);
                }
              }
              
              // LAST RESORT: Full chapter rewrite with simplified instructions
              if (!retrySuccess) {
                console.log(`[OrchestratorV2] Attempting FULL REWRITE as last resort for Chapter ${chapNum}...`);
                this.callbacks.onAgentStatus("smart-editor", "active", `Capitulo ${chapNum}: reescritura completa (último recurso)...`);
                
                // Simplify the issues to just the essential corrections needed
                const simplifiedIssues = chapterIssues.slice(0, 3).map((issue, idx) => 
                  `${idx + 1}. [${issue.severidad?.toUpperCase() || 'MAYOR'}] ${issue.descripcion?.substring(0, 200) || issue.problema?.substring(0, 200) || 'Error de continuidad'}`
                ).join('\n');
                
                const directInstructions = `REESCRITURA OBLIGATORIA - INSTRUCCIONES DIRECTAS:

${simplifiedIssues}

REGLAS:
- Reescribe el capítulo completo corrigiendo SOLO los problemas indicados
- Mantén exactamente el mismo tono, estilo y longitud
- NO añadas contenido nuevo ni escenas nuevas
- El resultado DEBE ser diferente al original`;

                try {
                  const fullRewriteResult = await this.smartEditor.fullRewrite({
                    chapterContent: chapter.content || "",
                    errorDescription: directInstructions,
                  });
                  this.addTokenUsage(fullRewriteResult.tokenUsage);
                  
                  // Accept result if it has content and is different (even if slightly)
                  const resultContent = fullRewriteResult.rewrittenContent || fullRewriteResult.content;
                  if (resultContent && resultContent.length > 100) {
                    // Check if there's any meaningful difference
                    const originalNormalized = (chapter.content || "").replace(/\s+/g, ' ').trim();
                    const resultNormalized = resultContent.replace(/\s+/g, ' ').trim();
                    
                    if (resultNormalized !== originalNormalized) {
                      const wordCount = resultContent.split(/\s+/).length;
                      await storage.updateChapter(chapter.id, {
                        content: resultContent,
                        wordCount,
                        qualityScore: 8,
                      });
                      console.log(`[OrchestratorV2] Full rewrite successful for Chapter ${chapNum} (${wordCount} words)`);
                      this.callbacks.onAgentStatus("smart-editor", "active", `Capitulo ${chapNum} reescrito completamente (${wordCount} palabras)`);
                      correctedCount++;
                      retrySuccess = true;
                      
                      // Track corrected issues for next cycle
                      for (const issue of chapterIssues) {
                        correctedIssuesSummaries.push(`Cap ${chapNum}: ${issue.categoria} - ${issue.descripcion?.substring(0, 100) || 'corregido'}`);
                      }
                    } else {
                      console.warn(`[OrchestratorV2] Full rewrite produced identical content for Chapter ${chapNum}`);
                    }
                  } else {
                    console.error(`[OrchestratorV2] Full rewrite produced no content for Chapter ${chapNum}`);
                  }
                } catch (rewriteError) {
                  console.error(`[OrchestratorV2] Full rewrite failed for Chapter ${chapNum}:`, rewriteError);
                }
              }
              
              // If still not successful after full rewrite attempt
              if (!retrySuccess) {
                console.error(`[OrchestratorV2] FALLO TOTAL: Capitulo ${chapNum} no pudo ser corregido tras parches y reescritura`);
                this.callbacks.onAgentStatus("smart-editor", "error", `ERROR: Capitulo ${chapNum} no corregido tras todos los intentos`);
                failedChaptersDetails.push({
                  chapterNumber: chapNum,
                  title: chapter.title || `Capítulo ${chapNum}`,
                  error: `No se pudo corregir tras ${maxRetries} parches + reescritura completa`,
                  issues: chapterIssues.map(i => `[${i.severidad}] ${i.descripcion}`)
                });
                failedCount++;
              }
            }
          }

          // Clear summary of what happened
          const totalAttempted = capitulos_para_reescribir.length;
          let summaryMessage = `Correcciones: ${correctedCount} de ${totalAttempted} capitulos modificados`;
          if (failedCount > 0) {
            summaryMessage += ` (${failedCount} fallidos)`;
          }
          console.log(`[OrchestratorV2] Auto-correction complete: ${correctedCount} corrected, ${failedCount} failed of ${totalAttempted} total`);
          this.callbacks.onAgentStatus("smart-editor", "completed", summaryMessage);
          
          // Clear the chapters being corrected indicator
          if (this.callbacks.onChaptersBeingCorrected) {
            this.callbacks.onChaptersBeingCorrected([], currentCycle);
          }
          
          // CRITICAL: After corrections, continue to next cycle for re-review
          // This ensures the iterative loop: review → fix → review → fix → until 2x consecutive 9+
          if (failedCount === 0) {
            // All corrections succeeded (or nothing to correct)
            if (correctedCount > 0) {
              console.log(`[OrchestratorV2] Corrections applied successfully (${correctedCount} chapters). Continuing to next review cycle (${currentCycle + 1}/${maxCycles})...`);
              this.callbacks.onAgentStatus("beta-reader", "active", `${correctedCount} correcciones aplicadas. Iniciando ciclo ${currentCycle + 1}...`);
            } else {
              console.log(`[OrchestratorV2] No chapters were corrected. Continuing to next review cycle (${currentCycle + 1}/${maxCycles})...`);
              this.callbacks.onAgentStatus("beta-reader", "active", `Sin correcciones necesarias. Iniciando ciclo ${currentCycle + 1}...`);
            }
            continue; // Go back to start of while loop for new review
          }
          
          // If any chapters failed to correct, LOG the issue but CONTINUE to next cycle (unattended mode)
          if (failedCount > 0) {
            console.warn(`[OrchestratorV2] ${failedCount} chapters could not be corrected. Continuing to next cycle anyway (unattended mode)...`);
            
            // Build log message with chapter list
            const failedChaptersList = failedChaptersDetails.map(f => 
              `Cap ${f.chapterNumber}: ${f.error.substring(0, 100)}`
            ).join('; ');
            
            // Log warning to activity console
            await storage.createActivityLog({
              projectId: project.id,
              level: "warning",
              agentRole: "smart-editor",
              message: `${failedCount} capítulo(s) no pudieron corregirse automáticamente: ${failedChaptersList.substring(0, 500)}. Continuando al siguiente ciclo...`,
            });
            
            // Store failed chapters info for reference but DON'T pause
            const existingResult = project.finalReviewResult as any || {};
            await storage.updateProject(project.id, { 
              finalReviewResult: {
                ...existingResult,
                failedChapters: failedChaptersDetails,
                correctionAttemptedAt: new Date().toISOString()
              }
            });
            
            this.callbacks.onAgentStatus("smart-editor", "completed", `${correctedCount} corregidos, ${failedCount} fallidos. Continuando...`);
            // Continue to next cycle instead of pausing
            continue;
          }
        }
      }

      await this.updateProjectTokens(project.id);

      // Determine final status based on review result
      if (!finalResult) {
        await storage.updateProject(project.id, { status: "error" });
        this.callbacks.onError("No se pudo completar la revisión final");
        return;
      }

      const { veredicto, puntuacion_global, resumen_general, justificacion_puntuacion, analisis_bestseller, issues, capitulos_para_reescribir, plot_decisions, persistent_injuries } = finalResult;
      // Only consider approved if score >= 9 AND veredicto is positive
      const approved = puntuacion_global >= 9 && (veredicto === "APROBADO" || veredicto === "APROBADO_CON_RESERVAS");

      // Save plot decisions and persistent injuries to World Bible for agent access
      if (plot_decisions?.length || persistent_injuries?.length) {
        const worldBible = await storage.getWorldBibleByProject(project.id);
        if (worldBible) {
          // Merge with existing decisions/injuries (avoid duplicates)
          const existingDecisions = Array.isArray(worldBible.plotDecisions) ? worldBible.plotDecisions : [];
          const existingInjuries = Array.isArray(worldBible.persistentInjuries) ? worldBible.persistentInjuries : [];
          
          const mergedDecisions = this.mergeDecisions(existingDecisions as any[], plot_decisions || []);
          const mergedInjuries = this.mergeInjuries(existingInjuries as any[], persistent_injuries || []);
          
          await storage.updateWorldBible(worldBible.id, {
            plotDecisions: mergedDecisions,
            persistentInjuries: mergedInjuries,
          });
          
          console.log(`[OrchestratorV2] Saved ${mergedDecisions.length} plot decisions and ${mergedInjuries.length} persistent injuries to World Bible`);
        }
      }

      await storage.updateProject(project.id, { 
        status: approved ? "completed" : "failed_final_review",
        finalScore: puntuacion_global,
        finalReviewResult: finalResult as any,
      });

      if (approved) {
        this.callbacks.onAgentStatus("final-reviewer", "completed", `${veredicto} (${puntuacion_global}/10)`);
        this.callbacks.onProjectComplete();
      } else {
        // Build detailed error message with specific issues
        const issuesSummary = issues && issues.length > 0
          ? issues.map((i: any) => `[${i.severidad?.toUpperCase() || 'ISSUE'}] Cap ${(i.capitulos_afectados || []).join(', ')}: ${i.descripcion?.substring(0, 150) || i.categoria}`).join(' | ')
          : 'Sin detalles de problemas específicos';
        
        const chaptersToFix = capitulos_para_reescribir?.length || 0;
        const criticalIssues = issues?.filter((i: any) => i.severidad === 'critica')?.length || 0;
        const majorIssues = issues?.filter((i: any) => i.severidad === 'mayor')?.length || 0;
        
        console.log(`[OrchestratorV2] Final review failed: ${puntuacion_global}/10. Issues: ${issuesSummary}`);
        
        // Log detailed issues to activity log for visibility
        await storage.createActivityLog({
          projectId: project.id,
          level: "error",
          message: `Problemas detectados: ${criticalIssues} críticos, ${majorIssues} mayores. ${issuesSummary.substring(0, 500)}`,
          agentRole: "final-reviewer",
        });
        
        this.callbacks.onAgentStatus("final-reviewer", "error", `${veredicto} (${puntuacion_global}/10) - ${criticalIssues} críticos, ${majorIssues} mayores, ${chaptersToFix} caps a reescribir`);
        this.callbacks.onError(`Manuscrito ${puntuacion_global}/10: ${resumen_general?.substring(0, 200) || issuesSummary.substring(0, 200)}`);
      }
    } catch (error) {
      console.error("[OrchestratorV2] Final review error:", error);
      this.callbacks.onError(error instanceof Error ? error.message : String(error));
      await storage.updateProject(project.id, { status: "error" });
    }
  }

  /**
   * Extend novel by generating additional chapters
   */
  async extendNovel(project: Project, fromChapter: number, toChapter: number): Promise<void> {
    console.log(`[OrchestratorV2] Extending project ${project.id} from chapter ${fromChapter + 1} to ${toChapter}`);
    
    try {
      const worldBible = await storage.getWorldBibleByProject(project.id);
      if (!worldBible || !worldBible.plotOutline) {
        this.callbacks.onError("No se encontró la World Bible con escaleta para este proyecto");
        await storage.updateProject(project.id, { status: "error" });
        return;
      }

      const worldBibleData = {
        characters: worldBible.characters || [],
        rules: worldBible.worldRules || [],
      };

      let guiaEstilo = "";
      if (project.styleGuideId) {
        const styleGuide = await storage.getStyleGuide(project.styleGuideId);
        if (styleGuide) guiaEstilo = styleGuide.content;
      }

      // Get existing chapters for context
      const existingChapters = await storage.getChaptersByProject(project.id);
      const sortedChapters = existingChapters
        .filter(c => c.status === "completed" || c.status === "approved")
        .sort((a, b) => a.chapterNumber - b.chapterNumber);

      let rollingSummary = sortedChapters.length > 0 
        ? sortedChapters.slice(-3).map(c => c.summary || `Cap ${c.chapterNumber} completado`).join("\n")
        : "Inicio de la novela.";

      // Generate new chapters from fromChapter+1 to toChapter
      this.callbacks.onAgentStatus("global-architect", "active", `Planificando capítulos ${fromChapter + 1} a ${toChapter}...`);

      // Create outlines for new chapters using Chapter Architect
      for (let chapterNum = fromChapter + 1; chapterNum <= toChapter; chapterNum++) {
        if (await this.shouldStopProcessing(project.id)) {
          console.log(`[OrchestratorV2] Extension cancelled for project ${project.id}`);
          await this.updateProjectTokens(project.id);
          await storage.updateProject(project.id, { status: "paused" });
          return;
        }

        // Plan scenes first with a generic outline
        const tempOutline = {
          chapter_num: chapterNum,
          title: `Capítulo ${chapterNum}`,
          summary: `Continuación de la historia - Capítulo ${chapterNum}`,
          key_event: "Desarrollo de la trama",
        };

        const previousSummary = rollingSummary;

        // LitAgents 2.1: Generate constraints BEFORE planning
        let consistencyConstraints = "";
        try {
          const context = await this.getConsistencyContext(project.id);
          if (context.entities.length > 0) {
            consistencyConstraints = universalConsistencyAgent.generateConstraints(
              project.genre,
              context.entities,
              context.rules,
              context.relationships,
              chapterNum
            );
          }
          
          // Add enriched writing context for extend with KU and series info
          const enrichedOptions = await this.buildEnrichedContextOptions(project);
          const enrichedContext = await this.buildEnrichedWritingContext(project.id, chapterNum, worldBibleData, enrichedOptions);
          if (enrichedContext) {
            consistencyConstraints += enrichedContext;
            console.log(`[OrchestratorV2] Added enriched writing context for extend (${enrichedContext.length} chars)`);
          }
        } catch (err) {
          console.error(`[OrchestratorV2] Failed to generate constraints for extend:`, err);
        }

        // Plan scenes for this chapter (WITH constraints)
        this.callbacks.onAgentStatus("chapter-architect", "active", `Planificando escenas para Capítulo ${chapterNum}...`);
        
        // Get full outline for plot context (World Bible stores as chapterOutlines, not chapters)
        const plotData = worldBibleData?.plotOutline as any;
        const fullOutline = plotData?.chapterOutlines || plotData?.chapters || [];
        
        const chapterPlan = await this.chapterArchitect.execute({
          chapterOutline: tempOutline,
          worldBible: worldBibleData,
          previousChapterSummary: previousSummary,
          storyState: rollingSummary,
          consistencyConstraints,
          fullPlotOutline: fullOutline, // LitAgents 2.1: Full plot context
        });

        if (!chapterPlan.parsed) {
          console.error(`[OrchestratorV2] Failed to plan chapter ${chapterNum}`);
          continue;
        }

        this.addTokenUsage(chapterPlan.tokenUsage);
        
        // Generate a better title from the chapter hook or first scene
        const generatedTitle = chapterPlan.parsed.chapter_hook 
          ? this.generateTitleFromHook(chapterPlan.parsed.chapter_hook)
          : chapterPlan.parsed.scenes[0]?.plot_beat 
            ? this.generateTitleFromHook(chapterPlan.parsed.scenes[0].plot_beat)
            : `Capítulo ${chapterNum}`;
        
        const chapterOutline = {
          ...tempOutline,
          title: generatedTitle,
        };

        // Write scenes
        let fullChapterText = "";
        let lastContext = "";
        let scenesCancelled = false;

        for (const scene of chapterPlan.parsed.scenes) {
          // Check cancellation before each scene
          if (await this.shouldStopProcessing(project.id)) {
            console.log(`[OrchestratorV2] Extension cancelled during scene writing for project ${project.id}`);
            scenesCancelled = true;
            break;
          }
          
          this.callbacks.onAgentStatus("ghostwriter-v2", "active", `Escribiendo escena ${scene.scene_num}...`);

          const sceneResult = await this.ghostwriter.execute({
            scenePlan: scene,
            prevSceneContext: lastContext,
            rollingSummary,
            worldBible: worldBibleData,
            guiaEstilo,
            consistencyConstraints, // LitAgents 2.1: Inject to writing stage
          });

          if (!sceneResult.error) {
            fullChapterText += "\n\n" + sceneResult.content;
            lastContext = sceneResult.content.slice(-1500);
            this.callbacks.onSceneComplete(chapterNum, scene.scene_num, chapterPlan.parsed.scenes.length, sceneResult.content?.split(/\s+/).length || 0);
          }

          this.addTokenUsage(sceneResult.tokenUsage);
        }
        
        if (scenesCancelled) {
          await this.updateProjectTokens(project.id);
          await storage.updateProject(project.id, { status: "paused" });
          return;
        }

        // Edit
        const editResult = await this.smartEditor.execute({
          chapterContent: fullChapterText,
          sceneBreakdown: chapterPlan.parsed,
          worldBible: worldBibleData,
        });

        let finalText = fullChapterText;
        if (editResult.parsed?.patches && editResult.parsed.patches.length > 0) {
          const patchResult = applyPatches(fullChapterText, editResult.parsed.patches);
          finalText = patchResult.patchedText;
        }

        this.addTokenUsage(editResult.tokenUsage);

        // Summarize
        const summaryResult = await this.summarizer.execute({
          chapterContent: finalText,
          chapterNumber: chapterNum,
        });

        this.addTokenUsage(summaryResult.tokenUsage);

        const chapterSummary = summaryResult.content || `Capítulo ${chapterNum} completado.`;
        rollingSummary = chapterSummary;

        // Save chapter (update if exists, create if not)
        const wordCount = finalText.split(/\s+/).length;
        
        // ALWAYS check database directly to prevent duplicates (don't rely on cached list)
        const freshChapters = await storage.getChaptersByProject(project.id);
        const existingChapter = freshChapters.find(c => c.chapterNumber === chapterNum);
        
        if (existingChapter) {
          await storage.updateChapter(existingChapter.id, {
            title: chapterOutline.title,
            content: finalText,
            wordCount,
            status: "approved",
            sceneBreakdown: chapterPlan.parsed as any,
            summary: chapterSummary,
          });
          console.log(`[OrchestratorV2] Updated existing chapter ${chapterNum} (ID: ${existingChapter.id})`);
        } else {
          await storage.createChapter({
            projectId: project.id,
            chapterNumber: chapterNum,
            title: chapterOutline.title,
            content: finalText,
            wordCount,
            status: "approved",
            sceneBreakdown: chapterPlan.parsed as any,
            summary: chapterSummary,
          });
          console.log(`[OrchestratorV2] Created new chapter ${chapterNum}`);
        }

        await storage.updateProject(project.id, { currentChapter: chapterNum });
        this.callbacks.onChapterComplete(chapterNum, wordCount, chapterOutline.title);
        await this.updateProjectTokens(project.id);
      }

      await storage.updateProject(project.id, { status: "completed" });
      this.callbacks.onProjectComplete();

    } catch (error) {
      console.error("[OrchestratorV2] Extension error:", error);
      this.callbacks.onError(error instanceof Error ? error.message : String(error));
      await storage.updateProject(project.id, { status: "error" });
    }
  }

  /**
   * Regenerate truncated chapters
   */
  async regenerateTruncatedChapters(project: Project, minWordCount: number = 100): Promise<void> {
    console.log(`[OrchestratorV2] Regenerating truncated chapters for project ${project.id} (min: ${minWordCount} words)`);
    
    try {
      const chapters = await storage.getChaptersByProject(project.id);
      const truncatedChapters = chapters.filter(ch => {
        const wordCount = ch.content ? ch.content.split(/\s+/).length : 0;
        return wordCount < minWordCount;
      });

      if (truncatedChapters.length === 0) {
        this.callbacks.onAgentStatus("ghostwriter-v2", "completed", "No se encontraron capítulos truncados");
        await storage.updateProject(project.id, { status: "completed" });
        this.callbacks.onProjectComplete();
        return;
      }

      const worldBible = await storage.getWorldBibleByProject(project.id);
      if (!worldBible) {
        this.callbacks.onError("No se encontró la World Bible para este proyecto");
        await storage.updateProject(project.id, { status: "error" });
        return;
      }

      const worldBibleData = {
        characters: worldBible.characters || [],
        rules: worldBible.worldRules || [],
      };

      let guiaEstilo = "";
      if (project.styleGuideId) {
        const styleGuide = await storage.getStyleGuide(project.styleGuideId);
        if (styleGuide) guiaEstilo = styleGuide.content;
      }

      this.callbacks.onAgentStatus("ghostwriter-v2", "active", 
        `Regenerando ${truncatedChapters.length} capítulos truncados`);

      for (let i = 0; i < truncatedChapters.length; i++) {
        if (await this.shouldStopProcessing(project.id)) {
          console.log(`[OrchestratorV2] Truncated regeneration cancelled for project ${project.id}`);
          await this.updateProjectTokens(project.id);
          await storage.updateProject(project.id, { status: "paused" });
          return;
        }

        const chapter = truncatedChapters[i];

        this.callbacks.onAgentStatus("ghostwriter-v2", "active", 
          `Regenerando capítulo ${chapter.chapterNumber} (${i + 1}/${truncatedChapters.length})`);

        // Get context from previous chapters
        const previousChapters = chapters
          .filter(c => c.chapterNumber < chapter.chapterNumber && c.content)
          .sort((a, b) => a.chapterNumber - b.chapterNumber);
        
        const rollingSummary = previousChapters.slice(-3)
          .map(c => c.summary || `Cap ${c.chapterNumber}: ${c.content?.slice(0, 200)}...`)
          .join("\n");

        const chapterOutline = {
          chapter_num: chapter.chapterNumber,
          title: chapter.title || `Capítulo ${chapter.chapterNumber}`,
          summary: chapter.summary || "Regeneración del capítulo",
          key_event: "Continuación de la historia",
        };

        // LitAgents 2.1: Generate constraints BEFORE planning
        let consistencyConstraints = "";
        try {
          const context = await this.getConsistencyContext(project.id);
          if (context.entities.length > 0) {
            consistencyConstraints = universalConsistencyAgent.generateConstraints(
              project.genre,
              context.entities,
              context.rules,
              context.relationships,
              chapter.chapterNumber
            );
          }
          
          // Add enriched writing context for truncated regen with KU and series info
          const enrichedOptions = await this.buildEnrichedContextOptions(project);
          const enrichedContext = await this.buildEnrichedWritingContext(project.id, chapter.chapterNumber, worldBibleData, enrichedOptions);
          if (enrichedContext) {
            consistencyConstraints += enrichedContext;
            console.log(`[OrchestratorV2] Added enriched writing context for truncated regen (${enrichedContext.length} chars)`);
          }
        } catch (err) {
          console.error(`[OrchestratorV2] Failed to generate constraints for truncated regen:`, err);
        }

        // Plan new scenes (WITH constraints)
        // Get full outline for plot context (World Bible stores as chapterOutlines, not chapters)
        const plotData2 = worldBibleData?.plotOutline as any;
        const fullOutline = plotData2?.chapterOutlines || plotData2?.chapters || [];
        
        const chapterPlan = await this.chapterArchitect.execute({
          chapterOutline,
          worldBible: worldBibleData,
          previousChapterSummary: rollingSummary,
          storyState: rollingSummary,
          consistencyConstraints,
          fullPlotOutline: fullOutline, // LitAgents 2.1: Full plot context
        });

        if (!chapterPlan.parsed) {
          console.error(`[OrchestratorV2] Failed to plan chapter ${chapter.chapterNumber}`);
          continue;
        }

        this.addTokenUsage(chapterPlan.tokenUsage);

        // Write new scenes
        let fullChapterText = "";
        let lastContext = "";
        let scenesCancelled = false;

        for (const scene of chapterPlan.parsed.scenes) {
          // Check cancellation before each scene
          if (await this.shouldStopProcessing(project.id)) {
            console.log(`[OrchestratorV2] Truncated regeneration cancelled during scene writing for project ${project.id}`);
            scenesCancelled = true;
            break;
          }
          
          this.callbacks.onAgentStatus("ghostwriter-v2", "active", `Escribiendo escena ${scene.scene_num}...`);
          
          const sceneResult = await this.ghostwriter.execute({
            scenePlan: scene,
            prevSceneContext: lastContext,
            rollingSummary,
            worldBible: worldBibleData,
            guiaEstilo,
            consistencyConstraints, // LitAgents 2.1: Inject to writing stage
          });

          if (!sceneResult.error) {
            fullChapterText += "\n\n" + sceneResult.content;
            lastContext = sceneResult.content.slice(-1500);
          }

          this.addTokenUsage(sceneResult.tokenUsage);
          this.callbacks.onSceneComplete(chapter.chapterNumber, scene.scene_num, chapterPlan.parsed.scenes.length, sceneResult.content?.split(/\s+/).length || 0);
        }
        
        if (scenesCancelled) {
          await this.updateProjectTokens(project.id);
          await storage.updateProject(project.id, { status: "paused" });
          return;
        }

        // Edit
        const editResult = await this.smartEditor.execute({
          chapterContent: fullChapterText,
          sceneBreakdown: chapterPlan.parsed,
          worldBible: worldBibleData,
        });

        let finalText = fullChapterText;
        if (editResult.parsed?.patches && editResult.parsed.patches.length > 0) {
          const patchResult = applyPatches(fullChapterText, editResult.parsed.patches);
          finalText = patchResult.patchedText;
        }

        this.addTokenUsage(editResult.tokenUsage);

        // Update chapter
        const wordCount = finalText.split(/\s+/).length;
        await storage.updateChapter(chapter.id, {
          content: finalText,
          wordCount,
          status: "approved",
          sceneBreakdown: chapterPlan.parsed as any,
        });

        this.callbacks.onChapterComplete(chapter.chapterNumber, wordCount, chapter.title || `Capítulo ${chapter.chapterNumber}`);
        await this.updateProjectTokens(project.id);
      }

      await storage.updateProject(project.id, { status: "completed" });
      this.callbacks.onProjectComplete();

    } catch (error) {
      console.error("[OrchestratorV2] Truncated regeneration error:", error);
      this.callbacks.onError(error instanceof Error ? error.message : String(error));
      await storage.updateProject(project.id, { status: "error" });
    }
  }

  /**
   * Run continuity sentinel check (simplified v2 version)
   */
  async runContinuitySentinelForce(project: Project): Promise<void> {
    console.log(`[OrchestratorV2] Running continuity sentinel for project ${project.id}`);
    
    try {
      this.callbacks.onAgentStatus("smart-editor", "active", "Ejecutando análisis de continuidad...");

      const chapters = await storage.getChaptersByProject(project.id);
      const worldBible = await storage.getWorldBibleByProject(project.id);
      
      if (!worldBible) {
        this.callbacks.onError("No se encontró la World Bible para este proyecto");
        await storage.updateProject(project.id, { status: "error" });
        return;
      }

      const worldBibleData = {
        characters: worldBible.characters || [],
        rules: worldBible.worldRules || [],
      };

      let guiaEstilo = "";
      if (project.styleGuideId) {
        const styleGuide = await storage.getStyleGuide(project.styleGuideId);
        if (styleGuide) guiaEstilo = styleGuide.content;
      }

      let issuesFound = 0;
      let chaptersFixed = 0;

      const chaptersWithContent = chapters.filter(c => c.content);
      for (let i = 0; i < chaptersWithContent.length; i++) {
        const chapter = chaptersWithContent[i];
        
        if (await this.shouldStopProcessing(project.id)) {
          console.log(`[OrchestratorV2] Sentinel check cancelled for project ${project.id}`);
          await this.updateProjectTokens(project.id);
          await storage.updateProject(project.id, { status: "paused" });
          return;
        }

        this.callbacks.onAgentStatus("smart-editor", "active", `Analizando capítulo ${chapter.chapterNumber} (${i + 1}/${chaptersWithContent.length})...`);

        const editResult = await this.smartEditor.execute({
          chapterContent: chapter.content || "",
          sceneBreakdown: chapter.sceneBreakdown as any || { scenes: [] },
          worldBible: worldBibleData,
        });

        this.addTokenUsage(editResult.tokenUsage);

        if (editResult.parsed && !editResult.parsed.is_approved) {
          issuesFound++;
          
          if (editResult.parsed.patches && editResult.parsed.patches.length > 0) {
            const patchResult = applyPatches(chapter.content || "", editResult.parsed.patches);
            
            if (patchResult.appliedPatches > 0) {
              await storage.updateChapter(chapter.id, { 
                content: patchResult.patchedText,
                wordCount: patchResult.patchedText.split(/\s+/).length,
              });
              chaptersFixed++;
              this.callbacks.onChapterComplete(
                chapter.chapterNumber, 
                patchResult.patchedText.split(/\s+/).length,
                chapter.title || `Capítulo ${chapter.chapterNumber}`
              );
            }
          }
        }
      }

      await this.updateProjectTokens(project.id);

      if (chaptersFixed > 0) {
        this.callbacks.onAgentStatus("smart-editor", "completed", 
          `Correcciones aplicadas: ${chaptersFixed} capítulos mejorados`);
      } else if (issuesFound > 0) {
        this.callbacks.onAgentStatus("smart-editor", "completed", 
          `Análisis completado: ${issuesFound} capítulos con observaciones menores`);
      } else {
        this.callbacks.onAgentStatus("smart-editor", "completed", 
          "No se encontraron issues de continuidad");
      }

      await storage.updateProject(project.id, { status: "completed" });
      this.callbacks.onProjectComplete();

    } catch (error) {
      console.error("[OrchestratorV2] Sentinel error:", error);
      this.callbacks.onError(error instanceof Error ? error.message : String(error));
      await storage.updateProject(project.id, { status: "error" });
    }
  }

  /**
   * Generate missing chapters that weren't written during initial generation
   * This handles cases where the pipeline jumped over chapters
   */
  async generateMissingChapters(project: Project): Promise<void> {
    fs.writeFileSync("/tmp/debug_generate_missing.txt", `[${new Date().toISOString()}] generateMissingChapters START for project ${project.id}\n`, { flag: "a" });
    console.log(`[OrchestratorV2] generateMissingChapters STARTED for project ${project.id}`);
    try {
      fs.writeFileSync("/tmp/debug_generate_missing.txt", `[${new Date().toISOString()}] About to update project status\n`, { flag: "a" });
      console.log(`[OrchestratorV2] Updating project status to generating...`);
      
      try {
        const updateResult = await storage.updateProject(project.id, { status: "generating" });
        fs.writeFileSync("/tmp/debug_generate_missing.txt", `[${new Date().toISOString()}] updateProject returned: ${JSON.stringify(updateResult)}\n`, { flag: "a" });
      } catch (updateError: any) {
        fs.writeFileSync("/tmp/debug_generate_missing.txt", `[${new Date().toISOString()}] updateProject ERROR: ${updateError.message}\n${updateError.stack}\n`, { flag: "a" });
        throw updateError;
      }
      
      fs.writeFileSync("/tmp/debug_generate_missing.txt", `[${new Date().toISOString()}] Project status updated successfully\n`, { flag: "a" });
      console.log(`[OrchestratorV2] Project status updated successfully`);
      this.callbacks.onAgentStatus("orchestrator-v2", "active", "Analizando capítulos faltantes...");

      fs.writeFileSync("/tmp/debug_generate_missing.txt", `[${new Date().toISOString()}] About to get World Bible\n`, { flag: "a" });
      
      // Get World Bible and outline
      const worldBible = await storage.getWorldBibleByProject(project.id);
      fs.writeFileSync("/tmp/debug_generate_missing.txt", `[${new Date().toISOString()}] World Bible result: ${worldBible ? 'FOUND' : 'NULL'}\n`, { flag: "a" });
      if (!worldBible || !worldBible.plotOutline) {
        throw new Error("No se encontró el World Bible con el outline de capítulos");
      }

      const plotOutline = worldBible.plotOutline as any;
      const rawOutline = (plotOutline.chapterOutlines || []).map((ch: any) => ({
        chapter_num: ch.chapter_num ?? ch.number ?? 0,
        title: ch.title || `Capítulo ${ch.chapter_num ?? ch.number ?? 0}`,
        summary: ch.summary || ch.description || "",
        key_event: ch.key_event || ch.keyEvent || "",
        emotional_arc: ch.emotional_arc || ch.emotionalArc || "",
      }));

      // Remap chapter numbers for prologue/epilogue
      const outline = rawOutline.map((ch: any, idx: number) => {
        let actualNum = ch.chapter_num;
        let actualTitle = ch.title;

        if (project.hasPrologue && idx === 0) {
          actualNum = 0;
          actualTitle = "Prólogo";
        } else if (project.hasEpilogue && idx === rawOutline.length - 1) {
          actualNum = 998;
          actualTitle = "Epílogo";
        } else if (project.hasAuthorNote && idx === rawOutline.length - 1) {
          actualNum = 999;
          actualTitle = "Nota del Autor";
        } else if (project.hasPrologue) {
          actualNum = idx; // Adjust for prologue offset
        }

        return { ...ch, chapter_num: actualNum, title: actualTitle };
      });

      // Get existing chapters
      const existingChapters = await storage.getChaptersByProject(project.id);
      const existingNumbers = new Set(existingChapters.map(c => c.chapterNumber));

      // Calculate expected chapter numbers based on project config
      const expectedChapterNumbers: number[] = [];
      if (project.hasPrologue) expectedChapterNumbers.push(0);
      for (let i = 1; i <= project.chapterCount; i++) {
        expectedChapterNumbers.push(i);
      }
      // Note: We don't add 998 (epilogue) or 999 (author's note) here - those are handled separately
      
      // Find missing chapters from outline (excluding epilogue 998 and author note 999)
      const missingFromOutline = outline.filter((ch: any) => 
        !existingNumbers.has(ch.chapter_num) && ch.chapter_num < 998
      );
      
      // Also find chapters expected by chapterCount but not in existing chapters
      const missingFromExpected = expectedChapterNumbers.filter(num => 
        !existingNumbers.has(num)
      );
      
      // Combine both sources, deduplicate
      const allMissingNumbers = new Set([
        ...missingFromOutline.map((c: any) => c.chapter_num),
        ...missingFromExpected
      ]);
      
      // For chapters not in outline, we need to create synthetic outline entries
      interface ChapterOutlineEntry {
        chapter_num: number;
        title: string;
        summary: string;
        key_event: string;
        emotional_arc?: string;
      }
      const outlineMap = new Map<number, ChapterOutlineEntry>(outline.map((ch: any) => [ch.chapter_num, ch]));
      const missingChapters: ChapterOutlineEntry[] = Array.from(allMissingNumbers).sort((a, b) => a - b).map(num => {
        if (outlineMap.has(num)) {
          return outlineMap.get(num)!;
        }
        // Create synthetic outline entry for chapters not in World Bible
        return {
          chapter_num: num,
          title: `Capítulo ${num}`,
          summary: `Continúa la narrativa del capítulo ${num - 1}`,
          key_event: "",
          emotional_arc: "",
        };
      });

      fs.writeFileSync("/tmp/debug_generate_missing.txt", `[${new Date().toISOString()}] Outline chapters: ${outline.map((c: any) => c.chapter_num).join(', ')}\n`, { flag: "a" });
      fs.writeFileSync("/tmp/debug_generate_missing.txt", `[${new Date().toISOString()}] Expected chapters (from chapterCount=${project.chapterCount}): ${expectedChapterNumbers.join(', ')}\n`, { flag: "a" });
      fs.writeFileSync("/tmp/debug_generate_missing.txt", `[${new Date().toISOString()}] Existing chapters: ${Array.from(existingNumbers).sort((a: any, b: any) => a - b).join(', ')}\n`, { flag: "a" });
      fs.writeFileSync("/tmp/debug_generate_missing.txt", `[${new Date().toISOString()}] Missing chapters (< 998): ${missingChapters.map((c: any) => c.chapter_num).join(', ') || 'NONE'}\n`, { flag: "a" });

      if (missingChapters.length === 0) {
        fs.writeFileSync("/tmp/debug_generate_missing.txt", `[${new Date().toISOString()}] No missing chapters found, setting status to completed\n`, { flag: "a" });
        this.callbacks.onAgentStatus("orchestrator-v2", "completed", "No hay capítulos faltantes");
        await storage.updateProject(project.id, { status: "completed" });
        this.callbacks.onProjectComplete();
        return;
      }

      console.log(`[OrchestratorV2] Found ${missingChapters.length} missing chapters: ${missingChapters.map((c: any) => c.chapter_num).join(', ')}`);
      this.callbacks.onAgentStatus("orchestrator-v2", "active", 
        `Generando ${missingChapters.length} capítulos faltantes: ${missingChapters.map((c: any) => c.chapter_num).join(', ')}`);

      // Get style guide
      let guiaEstilo = "";
      if (project.styleGuideId) {
        const styleGuide = await storage.getStyleGuide(project.styleGuideId);
        if (styleGuide) guiaEstilo = styleGuide.content;
      }

      // Build context from existing chapters
      const sortedExisting = existingChapters
        .filter(c => c.chapterNumber < 998)
        .sort((a, b) => a.chapterNumber - b.chapterNumber);
      
      const chapterSummaries: string[] = sortedExisting.map(c => c.summary || "");
      let rollingSummary = sortedExisting.length > 0 
        ? (sortedExisting[sortedExisting.length - 1].summary || "")
        : "Inicio de la novela.";

      // Generate each missing chapter
      for (const chapterOutline of missingChapters) {
        if (await this.shouldStopProcessing(project.id)) {
          console.log(`[OrchestratorV2] Project ${project.id} was cancelled`);
          return;
        }

        const chapterNumber = chapterOutline.chapter_num;
        console.log(`[OrchestratorV2] Generating missing Chapter ${chapterNumber}: "${chapterOutline.title}"`);

        // Get previous chapter summary for context
        const prevChapter = sortedExisting.find(c => c.chapterNumber === chapterNumber - 1);
        const previousSummary = prevChapter?.summary || rollingSummary;

        // LitAgents 2.1: Generate constraints BEFORE planning
        let consistencyConstraints = "";
        try {
          const context = await this.getConsistencyContext(project.id);
          if (context.entities.length > 0) {
            consistencyConstraints = universalConsistencyAgent.generateConstraints(
              project.genre,
              context.entities,
              context.rules,
              context.relationships,
              chapterNumber
            );
          }
          
          // Add enriched writing context for fill missing with KU and series info
          const enrichedOptions = await this.buildEnrichedContextOptions(project);
          const enrichedContext = await this.buildEnrichedWritingContext(project.id, chapterNumber, worldBible, enrichedOptions);
          if (enrichedContext) {
            consistencyConstraints += enrichedContext;
            console.log(`[OrchestratorV2] Added enriched writing context for fill missing (${enrichedContext.length} chars)`);
          }
        } catch (err) {
          console.error(`[OrchestratorV2] Failed to generate constraints for fill missing:`, err);
        }

        // Chapter Architect (WITH constraints)
        this.callbacks.onAgentStatus("chapter-architect", "active", `Planning scenes for Chapter ${chapterNumber}...`);
        
        // Get full outline for plot context (World Bible stores as chapterOutlines, not chapters)
        const plotData3 = (worldBible as any)?.plotOutline;
        const fullOutline = plotData3?.chapterOutlines || plotData3?.chapters || outline;
        
        const chapterPlan = await this.chapterArchitect.execute({
          chapterOutline,
          worldBible: worldBible as any,
          previousChapterSummary: previousSummary,
          storyState: rollingSummary,
          consistencyConstraints,
          fullPlotOutline: fullOutline, // LitAgents 2.1: Full plot context
        });

        if (chapterPlan.error || !chapterPlan.parsed) {
          throw new Error(`Chapter Architect failed for Chapter ${chapterNumber}: ${chapterPlan.error || "No parsed output"}`);
        }

        this.addTokenUsage(chapterPlan.tokenUsage);
        await this.logAiUsage(project.id, "chapter-architect", "deepseek-reasoner", chapterPlan.tokenUsage, chapterNumber);
        this.callbacks.onAgentStatus("chapter-architect", "completed", `${chapterPlan.parsed.scenes.length} scenes planned`);

        const sceneBreakdown = chapterPlan.parsed;

        // Ghostwriter - Write scenes
        let fullChapterText = "";
        let lastContext = "";

        for (const scene of sceneBreakdown.scenes) {
          this.callbacks.onAgentStatus("ghostwriter-v2", "active", 
            `Writing scene ${scene.scene_num}/${sceneBreakdown.scenes.length}...`);

          const sceneResult = await this.ghostwriter.execute({
            scenePlan: scene,
            prevSceneContext: lastContext,
            rollingSummary,
            worldBible: worldBible as any,
            guiaEstilo,
            consistencyConstraints, // LitAgents 2.1: Inject to writing stage
          });

          this.addTokenUsage(sceneResult.tokenUsage);
          await this.logAiUsage(project.id, "ghostwriter-v2", "deepseek-chat", sceneResult.tokenUsage, chapterNumber);

          const sceneText = sceneResult.content || "";
          fullChapterText += (fullChapterText ? "\n\n" : "") + sceneText;
          lastContext = sceneText.slice(-1500);

          this.callbacks.onSceneComplete(
            chapterNumber, 
            scene.scene_num, 
            sceneBreakdown.scenes.length,
            sceneText.split(/\s+/).length
          );
        }

        this.callbacks.onAgentStatus("ghostwriter-v2", "completed", "All scenes written");

        // Smart Editor
        this.callbacks.onAgentStatus("smart-editor", "active", "Reviewing chapter...");
        
        const editResult = await this.smartEditor.execute({
          chapterContent: fullChapterText,
          sceneBreakdown,
          worldBible: worldBible as any,
        });

        this.addTokenUsage(editResult.tokenUsage);
        await this.logAiUsage(project.id, "smart-editor", "deepseek-chat", editResult.tokenUsage, chapterNumber);

        let finalText = fullChapterText;
        let editorFeedback = editResult.parsed;

        if (editResult.parsed?.patches && editResult.parsed.patches.length > 0) {
          const patchResult = applyPatches(fullChapterText, editResult.parsed.patches);
          if (patchResult.appliedPatches > 0) {
            finalText = patchResult.patchedText;
            this.callbacks.onAgentStatus("smart-editor", "completed", `${patchResult.appliedPatches} patches applied`);
          }
        }

        // Summarizer
        this.callbacks.onAgentStatus("summarizer", "active", "Compressing for memory...");

        const summaryResult = await this.summarizer.execute({
          chapterContent: finalText,
          chapterNumber,
        });

        this.addTokenUsage(summaryResult.tokenUsage);
        await this.logAiUsage(project.id, "summarizer", "deepseek-chat", summaryResult.tokenUsage, chapterNumber);

        const chapterSummary = summaryResult.content || `Chapter ${chapterNumber} completed.`;
        chapterSummaries.push(chapterSummary);
        rollingSummary = chapterSummary;

        this.callbacks.onAgentStatus("summarizer", "completed", "Chapter compressed");

        // Save chapter (update if exists, create if not - prevents duplicates)
        const wordCount = finalText.split(/\s+/).length;
        
        // ALWAYS check database directly to prevent duplicates (don't rely on cached list)
        const freshChapters = await storage.getChaptersByProject(project.id);
        const existingChapterNow = freshChapters.find(c => c.chapterNumber === chapterNumber);
        
        if (existingChapterNow) {
          await storage.updateChapter(existingChapterNow.id, {
            title: chapterOutline.title,
            content: finalText,
            wordCount,
            status: "approved",
            sceneBreakdown: sceneBreakdown as any,
            summary: chapterSummary,
            editorFeedback: editorFeedback as any,
            qualityScore: editorFeedback ? Math.round((editorFeedback.logic_score + editorFeedback.style_score) / 2) : null,
          });
          console.log(`[OrchestratorV2] Updated existing chapter ${chapterNumber} (ID: ${existingChapterNow.id})`);
        } else {
          await storage.createChapter({
            projectId: project.id,
            chapterNumber,
            title: chapterOutline.title,
            content: finalText,
            wordCount,
            status: "approved",
            sceneBreakdown: sceneBreakdown as any,
            summary: chapterSummary,
            editorFeedback: editorFeedback as any,
            qualityScore: editorFeedback ? Math.round((editorFeedback.logic_score + editorFeedback.style_score) / 2) : null,
          });
          console.log(`[OrchestratorV2] Created missing chapter ${chapterNumber}`);
        }
        this.callbacks.onChapterComplete(chapterNumber, wordCount, chapterOutline.title);

        // Update token counts
        await this.updateProjectTokens(project.id);
      }

      // Run final Narrative Director review
      const allChapters = await storage.getChaptersByProject(project.id);
      const allSummaries = allChapters
        .filter(c => c.chapterNumber < 998)
        .sort((a, b) => a.chapterNumber - b.chapterNumber)
        .map(c => c.summary || "");

      const lastRegularChapter = Math.max(...allChapters.filter(c => c.chapterNumber < 998).map(c => c.chapterNumber));
      
      console.log(`[OrchestratorV2] Running final Narrative Director review after missing chapters`);
      await this.runNarrativeDirector(project.id, lastRegularChapter, project.chapterCount, allSummaries);

      // Complete
      await storage.updateProject(project.id, { status: "completed" });
      this.callbacks.onProjectComplete();

    } catch (error) {
      console.error("[OrchestratorV2] Generate missing chapters error:", error);
      this.callbacks.onError(error instanceof Error ? error.message : String(error));
      await storage.updateProject(project.id, { status: "error" });
    }
  }
}
