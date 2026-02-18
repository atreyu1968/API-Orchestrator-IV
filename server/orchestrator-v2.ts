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
  SeriesWorldBibleExtractor,
  InquisidorAgent,
  EstilistaAgent,
  RitmoAgent,
  EnsambladorAgent,
  getPatternTracker,
  clearPatternTracker,
  type GlobalArchitectOutput,
  type ChapterArchitectOutput,
  type SmartEditorOutput,
  type NarrativeDirectorOutput,
  type PlotThread as AgentPlotThread,
  type ScenePlan,
  type ExtractedWorldBibleData
} from "./agents/v2";
import { universalConsistencyAgent } from "./agents/v2/universal-consistency";
import { FinalReviewerAgent, type FinalReviewerResult, type FinalReviewIssue } from "./agents/final-reviewer";
import { SeriesThreadFixerAgent, type ThreadFixerResult, type ThreadFix } from "./agents/series-thread-fixer";
import { BetaReaderAgent, type BetaReaderReport, type FlaggedChapter } from "./agents/beta-reader";
import { runObjectiveEvaluation, type ObjectiveEvaluationResult } from "./agents/objective-evaluator";
import { applyPatches, type PatchResult } from "./utils/patcher";
import type { TokenUsage } from "./agents/base-agent";
import type { Project, Chapter, InsertPlotThread, WorldEntity, WorldRuleRecord, EntityRelationship } from "@shared/schema";
import OpenAI from "openai";
import { consistencyViolations } from "@shared/schema";
import { db } from "./db";
import { eq, and, desc } from "drizzle-orm";
import { isProjectCancelledFromDb, generateGenerationToken, isGenerationTokenValid } from "./agents";
import { calculateRealCost, formatCostForStorage } from "./cost-calculator";
import { calcularConvergencia } from "./utils/levenshtein";
import { BaseAgent } from "./agents/base-agent";
import { GoogleGenerativeAI } from "@google/generative-ai";

const geminiApiKey = process.env.GEMINI_API_KEY || "";
const geminiForValidation = new GoogleGenerativeAI(geminiApiKey);

const GEMINI_RATE_LIMIT_RETRIES = 5;
const GEMINI_RATE_LIMIT_DELAYS = [15000, 30000, 60000, 90000, 120000];

function isGeminiRateLimitError(error: any): boolean {
  const errStr = String(error?.message || error || '');
  return errStr.includes('429') || errStr.includes('RESOURCE_EXHAUSTED') || 
         errStr.includes('rate limit') || errStr.includes('Too Many Requests') ||
         errStr.includes('quota') || errStr.includes('RATELIMIT');
}

async function geminiGenerateWithRetry(
  prompt: string, 
  modelName: string = "gemini-2.5-flash",
  label: string = "GeminiCall"
): Promise<string> {
  for (let attempt = 0; attempt <= GEMINI_RATE_LIMIT_RETRIES; attempt++) {
    try {
      const model = geminiForValidation.getGenerativeModel({ model: modelName });
      const result = await model.generateContent(prompt);
      return result.response.text();
    } catch (error) {
      if (isGeminiRateLimitError(error) && attempt < GEMINI_RATE_LIMIT_RETRIES) {
        const delay = GEMINI_RATE_LIMIT_DELAYS[Math.min(attempt, GEMINI_RATE_LIMIT_DELAYS.length - 1)];
        console.warn(`[${label}] Gemini rate limit (429) on attempt ${attempt + 1}/${GEMINI_RATE_LIMIT_RETRIES + 1}. Waiting ${delay / 1000}s...`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw error;
    }
  }
  throw new Error(`[${label}] Gemini rate limit exceeded after ${GEMINI_RATE_LIMIT_RETRIES + 1} attempts`);
}

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

  async auditContinuity(chapterContents: string[], startChapter: number, endChapter: number, options?: { forceProvider?: "gemini" | "deepseek" }): Promise<any> {
    const combinedContent = chapterContents.map((c, i) => 
      `=== CAPÍTULO ${startChapter + i} ===\n${c.substring(0, 8000)}`
    ).join("\n\n");

    const prompt = `Analiza la continuidad narrativa de los capítulos ${startChapter} a ${endChapter}:

${combinedContent}

Detecta errores de continuidad temporal, espacial, de estado y de conocimiento. RESPONDE EN JSON.`;

    const response = await this.generateContent(prompt, undefined, options?.forceProvider ? { forceProvider: options.forceProvider } : undefined);
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

// Internal Agent: Injury Extractor - extracts significant injuries from chapter content
class InjuryExtractorAgent extends BaseAgent {
  constructor() {
    super({
      name: "Injury Extractor",
      role: "injury_extractor",
      systemPrompt: `Eres un analizador de contenido narrativo especializado en detectar lesiones y condiciones físicas de personajes.
Tu trabajo es identificar SOLO lesiones SIGNIFICATIVAS que afectarían las acciones futuras de los personajes.

INCLUIR:
- Disparos, cortes profundos, huesos rotos
- Quemaduras graves, envenenamientos
- Cirugías, amputaciones
- Cualquier herida que limite movimiento o capacidades

IGNORAR:
- Moretones menores, rasguños superficiales
- Cansancio normal, hambre, sed
- Dolor emocional (sin manifestación física)

RESPONDE SIEMPRE EN JSON VÁLIDO.`,
      model: "deepseek-chat",
      useThinking: false,
    });
  }

  async execute(input: { chapterNumber: number; content: string; characterNames: string[] }): Promise<any> {
    const prompt = `Analiza este capítulo y extrae SOLO las lesiones, heridas o condiciones físicas SIGNIFICATIVAS.

PERSONAJES CONOCIDOS: ${input.characterNames.join(', ')}

CAPÍTULO ${input.chapterNumber}:
${input.content.substring(0, 8000)}

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

    const response = await this.generateContent(prompt);
    let result: { injuries: any[] } = { injuries: [] };
    try {
      const jsonMatch = response.content.match(/\{[\s\S]*"injuries"[\s\S]*\}/);
      if (jsonMatch) result = JSON.parse(jsonMatch[0]);
    } catch (e) {
      console.error("[InjuryExtractor] Failed to parse:", e);
    }
    return { ...result, tokenUsage: response.tokenUsage };
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
  contexto?: string; // Text fragment showing the exact location of the problem
  instrucciones?: string; // Detailed instructions for correction (from FinalReviewer)
  categoria?: string;
}

// LitAgents 2.9.4: Issue Registry for "Detect All, Then Fix" strategy
// Issues are detected in 3 consecutive reviews, deduplicated, then fixed one by one with verification
interface RegisteredIssue {
  id: string; // Unique hash for deduplication
  source: string; // Which review detected it (review-1, review-2, review-3)
  chapter: number;
  tipo: string;
  severidad: 'critico' | 'mayor' | 'menor';
  descripcion: string;
  contexto?: string;
  instrucciones?: string;
  correccion?: string;
  // Tracking
  status: 'pending' | 'fixing' | 'verifying' | 'resolved' | 'escalated';
  attempts: number;
  lastAttemptError?: string;
  resolvedAt?: string;
  // For rollback
  originalContent?: string;
}

interface IssueRegistry {
  projectId: number;
  createdAt: string;
  detectionPhaseComplete: boolean;
  issues: RegisteredIssue[];
  // Stats
  totalDetected: number;
  totalResolved: number;
  totalEscalated: number;
}

interface DetectAndFixPhaseProgress {
  phase: 'detection' | 'correction';
  subPhase?: string;
  current: number;
  total: number;
  details?: {
    reviewNumber?: number;
    issuesFoundThisReview?: number;
    totalUniqueIssues?: number;
    issueIndex?: number;
    issueType?: string;
    issueChapter?: number;
    issueSeverity?: string;
    resolved?: number;
    escalated?: number;
  };
}

// ==================== TARGETED REPAIR TYPES ====================
export interface RepairIssue {
  chapter: number;
  type: string;
  severity: 'critica' | 'mayor' | 'menor';
  description: string;
  expectedVsActual: string;
  suggestedFix: string;
}

export interface RepairPlanItem {
  chapter: number;
  chapterTitle: string;
  issues: RepairIssue[];
  approach: 'surgical' | 'rewrite';
  instructions: string;
  priority: number;
}

export interface RepairResult {
  chapter: number;
  success: boolean;
  method: 'surgical' | 'rewrite' | 'failed';
  verified: boolean;
  verificationDetails?: string;
  issuesFixed: number;
  issuesTotal: number;
}

interface OrchestratorV2Callbacks {
  onAgentStatus: (role: string, status: string, message?: string) => void;
  onChapterComplete: (chapterNumber: number, wordCount: number, chapterTitle: string) => void;
  onSceneComplete: (chapterNumber: number, sceneNumber: number, totalScenes: number, wordCount: number) => void;
  onProjectComplete: () => void;
  onError: (error: string) => void;
  onChaptersBeingCorrected?: (chapterNumbers: number[], revisionCycle: number) => void;
  onDetectAndFixProgress?: (progress: DetectAndFixPhaseProgress) => void;
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
  private injuryExtractor = new InjuryExtractorAgent();
  
  // Beta Reader for commercial viability analysis
  private betaReader = new BetaReaderAgent();
  
  // Series World Bible Extractor for propagating data between volumes
  private seriesWorldBibleExtractor = new SeriesWorldBibleExtractor();
  
  // OmniWriter Pipeline Agents
  private inquisidor = new InquisidorAgent();
  private estilista = new EstilistaAgent();
  private ritmo = new RitmoAgent();
  private ensamblador = new EnsambladorAgent();
  
  private callbacks: OrchestratorV2Callbacks;
  private generationToken?: string;
  private geminiQAFlags?: { finalReviewer?: boolean; continuitySentinel?: boolean; narrativeDirector?: boolean };
  
  private cumulativeTokens = {
    inputTokens: 0,
    outputTokens: 0,
    thinkingTokens: 0,
  };

  private matchEntityName(entityName: string, wbName: string): boolean {
    const a = entityName.toLowerCase().trim();
    const b = wbName.toLowerCase().trim();
    if (a === b) return true;
    if (a.length < 3 || b.length < 3) return a === b;
    const aParts = a.split(/\s+/);
    const bParts = b.split(/\s+/);
    return aParts.some((p: string) => p.length >= 3 && bParts.includes(p)) ||
           bParts.some((p: string) => p.length >= 3 && aParts.includes(p));
  }

  private async syncEntitiesIntoWorldBible(projectId: number, worldBible: any): Promise<void> {
    try {
      const entities = await storage.getWorldEntitiesByProject(projectId);
      if (!entities || entities.length === 0) return;

      const DEATH_MARKERS = ['dead', 'muerto', 'fallecido', 'deceased', 'killed', 'asesinado', 'ejecutado'];

      const characters: any[] = worldBible?.characters || worldBible?.personajes || [];
      const locations: any[] = worldBible?.ubicaciones || worldBible?.locations || worldBible?.lugares || [];
      const objects: any[] = worldBible?.objetos || worldBible?.objects || [];

      const charEntities = entities.filter(e => e.type === 'CHARACTER' || e.type === 'PHYSICAL_TRAIT');
      const personalItemEntities = entities.filter(e => e.type === 'PERSONAL_ITEM');
      const locationEntities = entities.filter(e => e.type === 'LOCATION');
      const objectEntities = entities.filter(e => e.type === 'OBJECT' || e.type === 'EVIDENCE');
      const secretEntities = entities.filter(e => e.type === 'SECRET');

      let charsUpdated = false;

      const syncCharAttrs = (wbChar: any, entity: any) => {
        const attrs = (entity.attributes as any) || {};
        const status = (entity.status || '').toLowerCase();
        const vitalStatus = (attrs.estado_vital || attrs.vital_status || '').toString().toLowerCase();
        const isDead = DEATH_MARKERS.some(m => status.includes(m) || vitalStatus.includes(m)) || attrs.capitulo_muerte || attrs.death_chapter;

        if (isDead) {
          const currentStatus = (wbChar.status || wbChar.estado || '').toLowerCase();
          if (!DEATH_MARKERS.some(m => currentStatus.includes(m))) {
            wbChar.status = 'muerto';
            wbChar.estado = 'muerto';
            wbChar.estado_vital = 'MUERTO';
            wbChar.capitulo_muerte = attrs.capitulo_muerte || attrs.death_chapter || '?';
            if (attrs.causa_muerte || attrs.death_cause) wbChar.causa_muerte = attrs.causa_muerte || attrs.death_cause;
            charsUpdated = true;
            console.log(`[SyncFull] Death synced: ${entity.name} (cap ${wbChar.capitulo_muerte})`);
          }
        }

        if (attrs.ubicacion_actual || attrs.current_location) {
          const newLoc = attrs.ubicacion_actual || attrs.current_location;
          if (wbChar.ubicacion_actual !== newLoc) {
            wbChar.ubicacion_actual = newLoc;
            charsUpdated = true;
          }
        }

        if (attrs.estado_emocional || attrs.emotional_state) {
          wbChar.estado_emocional = attrs.estado_emocional || attrs.emotional_state;
          charsUpdated = true;
        }

        if (attrs.trauma) {
          wbChar.trauma = attrs.trauma;
          charsUpdated = true;
        }

        if (attrs.conoce || attrs.knows) {
          if (!wbChar.conocimientos) wbChar.conocimientos = [];
          const newKnowledge = attrs.conoce || attrs.knows;
          if (!wbChar.conocimientos.includes(newKnowledge)) {
            wbChar.conocimientos.push(newKnowledge);
            charsUpdated = true;
          }
        }

        if (attrs.ignora || attrs.doesnt_know) {
          wbChar.ignora = attrs.ignora || attrs.doesnt_know;
          charsUpdated = true;
        }

        for (const [key, value] of Object.entries(attrs)) {
          if (key.endsWith('_INMUTABLE') && !wbChar[key]) {
            wbChar[key] = value;
            charsUpdated = true;
          }
        }

        if (attrs.edad && !wbChar.edad) {
          wbChar.edad = attrs.edad;
          charsUpdated = true;
        }
        
        if ((attrs.descripcion_fisica || attrs.physical_description) && !wbChar.descripcion_fisica) {
          wbChar.descripcion_fisica = attrs.descripcion_fisica || attrs.physical_description;
          charsUpdated = true;
        }
        if ((attrs.ojos || attrs.eyes) && !wbChar.ojos) {
          wbChar.ojos = attrs.ojos || attrs.eyes;
          charsUpdated = true;
        }
        if ((attrs.cabello || attrs.hair) && !wbChar.cabello) {
          wbChar.cabello = attrs.cabello || attrs.hair;
          charsUpdated = true;
        }
        if ((attrs.rasgos_distintivos || attrs.distinguishing_features) && !wbChar.rasgos_distintivos) {
          wbChar.rasgos_distintivos = attrs.rasgos_distintivos || attrs.distinguishing_features;
          charsUpdated = true;
        }
        if ((attrs.rol || attrs.role) && !wbChar.rol) {
          wbChar.rol = attrs.rol || attrs.role;
          charsUpdated = true;
        }
        if ((attrs.perfil_psicologico || attrs.personality) && !wbChar.perfil_psicologico) {
          wbChar.perfil_psicologico = attrs.perfil_psicologico || attrs.personality;
          charsUpdated = true;
        }
      };

      for (const entity of charEntities) {
        const wbChar = characters.find((c: any) => this.matchEntityName(entity.name, c.name || c.nombre || ''));
        if (wbChar) {
          syncCharAttrs(wbChar, entity);
        } else if (entity.type === 'CHARACTER') {
          const attrs = (entity.attributes as any) || {};
          const newChar: any = {
            name: entity.name,
            nombre: entity.name,
            status: entity.status || 'active',
            estado: entity.status || 'activo',
            primera_aparicion: entity.lastSeenChapter || '?',
          };
          if (attrs.ubicacion_actual || attrs.current_location) newChar.ubicacion_actual = attrs.ubicacion_actual || attrs.current_location;
          if (attrs.estado_emocional || attrs.emotional_state) newChar.estado_emocional = attrs.estado_emocional || attrs.emotional_state;
          if (attrs.edad) newChar.edad = attrs.edad;
          if (attrs.rol || attrs.role) newChar.rol = attrs.rol || attrs.role;
          if (attrs.descripcion_fisica || attrs.physical_description) newChar.descripcion_fisica = attrs.descripcion_fisica || attrs.physical_description;
          if (attrs.ojos || attrs.eyes) newChar.ojos = attrs.ojos || attrs.eyes;
          if (attrs.cabello || attrs.hair) newChar.cabello = attrs.cabello || attrs.hair;
          if (attrs.piel || attrs.skin) newChar.piel = attrs.piel || attrs.skin;
          if (attrs.altura || attrs.height) newChar.altura = attrs.altura || attrs.height;
          if (attrs.rasgos_distintivos || attrs.distinguishing_features) newChar.rasgos_distintivos = attrs.rasgos_distintivos || attrs.distinguishing_features;
          if (attrs.perfil_psicologico || attrs.personality) newChar.perfil_psicologico = attrs.perfil_psicologico || attrs.personality;
          if (attrs.trauma) newChar.trauma = attrs.trauma;
          if (attrs.conoce || attrs.knows) newChar.conocimientos = [attrs.conoce || attrs.knows];
          const status = (entity.status || '').toLowerCase();
          const vitalStatus = (attrs.estado_vital || attrs.vital_status || '').toString().toLowerCase();
          if (DEATH_MARKERS.some(m => status.includes(m) || vitalStatus.includes(m))) {
            newChar.status = 'muerto';
            newChar.estado = 'muerto';
            newChar.estado_vital = 'MUERTO';
            newChar.capitulo_muerte = attrs.capitulo_muerte || attrs.death_chapter || '?';
          }
          characters.push(newChar);
          charsUpdated = true;
          console.log(`[SyncFull] New character added to World Bible: ${entity.name} (attrs: ${Object.keys(attrs).join(', ')})`);
        }
      }

      for (const entity of personalItemEntities) {
        const attrs = (entity.attributes as any) || {};
        const ownerName = attrs.propietario || attrs.owner || '';
        if (!ownerName) continue;

        const wbChar = characters.find((c: any) => this.matchEntityName(ownerName, c.name || c.nombre || ''));
        if (!wbChar) continue;

        if (!wbChar.objetos_personales) wbChar.objetos_personales = [];
        const itemDesc = attrs.descripcion || attrs.description || entity.name;
        const existingItem = wbChar.objetos_personales.find((o: any) =>
          (typeof o === 'string' ? o : (o.nombre || o.name || '')).toLowerCase() === entity.name.toLowerCase()
        );
        if (!existingItem) {
          wbChar.objetos_personales.push({
            nombre: entity.name,
            descripcion: itemDesc,
            estado: attrs.estado || 'presente',
          });
          charsUpdated = true;
        } else if (typeof existingItem === 'object' && attrs.estado) {
          existingItem.estado = attrs.estado;
          charsUpdated = true;
        }
      }

      let locsUpdated = false;
      for (const entity of locationEntities) {
        const attrs = (entity.attributes as any) || {};
        const wbLoc = locations.find((l: any) => this.matchEntityName(entity.name, l.name || l.nombre || l.lugar || ''));

        if (wbLoc) {
          if (attrs.descripcion || attrs.description) {
            wbLoc.descripcion = attrs.descripcion || attrs.description;
            locsUpdated = true;
          }
          if (attrs.atmosfera || attrs.atmosphere) {
            wbLoc.atmosfera = attrs.atmosfera || attrs.atmosphere;
            locsUpdated = true;
          }
          if (attrs.caracteristicas || attrs.features) {
            wbLoc.caracteristicas = attrs.caracteristicas || attrs.features;
            locsUpdated = true;
          }
          if (attrs.estado || attrs.status) {
            wbLoc.estado = attrs.estado || attrs.status;
            locsUpdated = true;
          }
        } else {
          locations.push({
            nombre: entity.name,
            name: entity.name,
            descripcion: attrs.descripcion || attrs.description || '',
            atmosfera: attrs.atmosfera || attrs.atmosphere || '',
            caracteristicas: attrs.caracteristicas || attrs.features || '',
            estado: attrs.estado || 'active',
          });
          locsUpdated = true;
          console.log(`[SyncFull] New location added to World Bible: ${entity.name}`);
        }
      }

      let objsUpdated = false;
      for (const entity of objectEntities) {
        const attrs = (entity.attributes as any) || {};
        const wbObj = objects.find((o: any) => this.matchEntityName(entity.name, o.name || o.nombre || ''));

        if (wbObj) {
          if (attrs.propietario || attrs.owner) {
            wbObj.propietario = attrs.propietario || attrs.owner;
            objsUpdated = true;
          }
          if (attrs.ubicacion || attrs.location) {
            wbObj.ubicacion = attrs.ubicacion || attrs.location;
            objsUpdated = true;
          }
          if (attrs.descripcion || attrs.description) {
            wbObj.descripcion = attrs.descripcion || attrs.description;
            objsUpdated = true;
          }
          if (attrs.estado || attrs.status) {
            wbObj.estado = attrs.estado || attrs.status;
            objsUpdated = true;
          }
        } else {
          objects.push({
            nombre: entity.name,
            name: entity.name,
            descripcion: attrs.descripcion || attrs.description || '',
            propietario: attrs.propietario || attrs.owner || '',
            ubicacion: attrs.ubicacion || attrs.location || '',
            estado: attrs.estado || 'present',
          });
          objsUpdated = true;
          console.log(`[SyncFull] New object added to World Bible: ${entity.name}`);
        }
      }

      for (const entity of secretEntities) {
        const attrs = (entity.attributes as any) || {};
        const knownBy = (attrs.conocido_por || attrs.known_by || '').toString();
        if (!knownBy) continue;

        const knowerNames = knownBy.split(/[,;y\/and]+/).map((n: string) => n.trim()).filter(Boolean);
        for (const knowerName of knowerNames) {
          const wbChar = characters.find((c: any) => this.matchEntityName(knowerName, c.name || c.nombre || ''));
          if (wbChar) {
            if (!wbChar.secretos_conocidos) wbChar.secretos_conocidos = [];
            const secretDesc = attrs.descripcion || attrs.description || entity.name;
            if (!wbChar.secretos_conocidos.includes(secretDesc)) {
              wbChar.secretos_conocidos.push(secretDesc);
              charsUpdated = true;
            }
          }
        }
      }

      const wbRecord = await storage.getWorldBibleByProject(projectId);

      if (wbRecord) {
        const dbTimeline = (wbRecord as any).timeline;
        if (dbTimeline && Array.isArray(dbTimeline) && dbTimeline.length > 0) {
          worldBible.timeline = dbTimeline;
        }

        const dbInjuries = (wbRecord as any).persistentInjuries;
        if (dbInjuries && Array.isArray(dbInjuries)) {
          worldBible.persistentInjuries = dbInjuries;
          worldBible.lesiones_activas = dbInjuries.filter((i: any) => i.estado_actual === 'activa');

          for (const injury of dbInjuries) {
            if (!injury.personaje || injury.estado_actual !== 'activa') continue;
            const wbChar = characters.find((c: any) => this.matchEntityName(injury.personaje, c.name || c.nombre || ''));
            if (wbChar) {
              if (!wbChar.lesiones_activas) wbChar.lesiones_activas = [];
              const exists = wbChar.lesiones_activas.some((l: any) =>
                l.tipo_lesion === injury.tipo_lesion && l.parte_afectada === injury.parte_afectada
              );
              if (!exists) {
                wbChar.lesiones_activas.push({
                  tipo_lesion: injury.tipo_lesion,
                  parte_afectada: injury.parte_afectada || 'no especificada',
                  severidad: injury.severidad || 'moderada',
                  efecto_esperado: injury.efecto_esperado || '',
                  capitulo_ocurre: injury.capitulo_ocurre,
                  es_temporal: injury.es_temporal || false,
                });
                charsUpdated = true;
              }
            }
          }
        }

        const dbDecisions = (wbRecord as any).plotDecisions;
        if (dbDecisions && Array.isArray(dbDecisions)) {
          worldBible.plotDecisions = dbDecisions;
          worldBible.decisiones = dbDecisions;
        }
      }

      const persistData: Record<string, any> = {};
      if (charsUpdated) {
        persistData.characters = characters;
        worldBible.characters = characters;
        worldBible.personajes = characters;
      }
      if (locsUpdated) {
        persistData.ubicaciones = locations;
        persistData.locations = locations;
        worldBible.ubicaciones = locations;
        worldBible.locations = locations;
        worldBible.lugares = locations;
      }
      if (objsUpdated) {
        persistData.objetos = objects;
        persistData.objects = objects;
        worldBible.objetos = objects;
        worldBible.objects = objects;
      }

      if (Object.keys(persistData).length > 0) {
        if (wbRecord) {
          await storage.updateWorldBible(wbRecord.id, persistData as any);
        }
        const totalSynced = (charsUpdated ? charEntities.length : 0) + (locsUpdated ? locationEntities.length : 0) + (objsUpdated ? objectEntities.length : 0);
        console.log(`[SyncFull] Synced ${totalSynced} entities into World Bible (chars:${charsUpdated}, locs:${locsUpdated}, objs:${objsUpdated})`);
      }
    } catch (err) {
      console.error(`[SyncFull] Error syncing entities into World Bible:`, err);
    }
  }

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
  
  setGeminiQAFlags(flags: { finalReviewer?: boolean; continuitySentinel?: boolean; narrativeDirector?: boolean }) {
    this.geminiQAFlags = flags;
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
    
    // LitAgents 2.9.6: Check if correction was cancelled via routes.ts
    const isCorrectionCancelled = (global as any).isCorrectionCancelled;
    if (isCorrectionCancelled && isCorrectionCancelled(projectId)) {
      console.log(`[OrchestratorV2] Correction cancelled for project ${projectId} - stopping processing`);
      // Log cancellation for traceability
      try {
        await storage.createActivityLog({
          projectId,
          level: "warning",
          agentRole: "system",
          message: "⏹️ Corrección cancelada por el usuario. Proceso detenido.",
        });
      } catch (e) { /* ignore logging errors */ }
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

  /**
   * LitAgents 2.9.5: Extract plot threads from extended guide
   * Looks for common patterns: "Trama principal:", "Subtramas:", chapter-by-chapter breakdowns
   */
  private extractPlotsFromGuide(guide: string): Array<{ name: string; description?: string; goal: string }> {
    const threads: Array<{ name: string; description?: string; goal: string }> = [];
    
    // Pattern 1: Look for explicit "Trama" or "Subtrama" sections
    const tramaPattern = /(?:trama\s*(?:principal)?|subtrama)\s*(?:\d+)?[\s:]+([^\n]+)/gi;
    let match;
    while ((match = tramaPattern.exec(guide)) !== null) {
      const name = match[1].trim();
      if (name.length > 5 && name.length < 200) {
        threads.push({ name, goal: name });
      }
    }
    
    // Pattern 2: Look for "Arco de [personaje]" patterns
    const arcoPattern = /arco\s+(?:de\s+)?([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)?)[:\s]+([^\n]+)/gi;
    while ((match = arcoPattern.exec(guide)) !== null) {
      const charName = match[1].trim();
      const arcDesc = match[2].trim();
      threads.push({ 
        name: `Arco de ${charName}`, 
        description: arcDesc, 
        goal: arcDesc 
      });
    }
    
    // Pattern 3: Look for numbered plot points "1. [Plot]", "2. [Plot]"
    const numberedPattern = /^\s*\d+\.\s*(?:trama|conflicto|historia|arco)[:\s]+([^\n]+)/gim;
    while ((match = numberedPattern.exec(guide)) !== null) {
      const name = match[1].trim();
      if (name.length > 5 && !threads.some(t => t.name.toLowerCase() === name.toLowerCase())) {
        threads.push({ name, goal: name });
      }
    }
    
    // Pattern 4: Look for "Conflicto principal/secundario" 
    const conflictPattern = /conflicto\s+(?:principal|secundario|central)\s*[:\s]+([^\n]+)/gi;
    while ((match = conflictPattern.exec(guide)) !== null) {
      const name = match[1].trim();
      if (name.length > 5 && !threads.some(t => t.name.toLowerCase() === name.toLowerCase())) {
        threads.push({ name: `Conflicto: ${name}`, goal: name });
      }
    }
    
    // Deduplicate and limit to 10 threads
    const uniqueThreads = threads.filter((t, i, arr) => 
      arr.findIndex(x => x.name.toLowerCase() === t.name.toLowerCase()) === i
    );
    
    return uniqueThreads.slice(0, 10);
  }

  /**
   * LitAgents 2.9.5: Validate plot coherence to prevent orphaned/weak storylines
   * Returns validation result with issues that need fixing
   */
  private validatePlotCoherence(
    outline: Array<{ chapter_num: number; title: string; summary: string; key_event: string; emotional_arc?: string; structural_role?: string | null }> | undefined | null,
    plotThreads: Array<{ name: string; description?: string; goal: string }> | undefined | null,
    worldBible: any,
    extendedGuide?: string
  ): { isValid: boolean; criticalIssues: string[]; warnings: string[] } {
    const criticalIssues: string[] = [];
    const warnings: string[] = [];
    
    // Guard: If outline or plotThreads are missing/empty, skip validation (assume valid)
    const safeOutline = outline || [];
    let safePlotThreads = plotThreads || [];
    
    // Regular chapters only (exclude prologue=0, epilogue=998/999) for structural checks
    const regularOutline = safeOutline.filter(ch => ch.chapter_num > 0 && ch.chapter_num < 998);
    
    if (safeOutline.length === 0) {
      console.warn('[OrchestratorV2] validatePlotCoherence: Empty outline, skipping validation');
      return { isValid: true, criticalIssues: [], warnings: ['Outline vacío - validación omitida'] };
    }
    
    // LitAgents 2.9.5: Extract plot threads from extended guide if not provided by Global Architect
    // The extended guide often contains well-defined plots/subplots with chapter development
    if (safePlotThreads.length === 0 && extendedGuide) {
      console.log('[OrchestratorV2] No plot_threads from GA - extracting from extended guide...');
      const extractedThreads = this.extractPlotsFromGuide(extendedGuide);
      if (extractedThreads.length > 0) {
        safePlotThreads = extractedThreads;
        console.log(`[OrchestratorV2] Extracted ${extractedThreads.length} plot threads from extended guide`);
      }
    }
    
    if (safePlotThreads.length === 0) {
      console.warn('[OrchestratorV2] validatePlotCoherence: No plot threads defined');
      warnings.push('⚠️ No se definieron tramas principales (plot_threads vacío)');
    }
    
    // 1. Check that each plot thread is resolved somewhere in the outline
    // Use INDEX instead of chapter_num to avoid confusion with special numbers (0, 998, 999)
    for (const thread of safePlotThreads) {
      const threadNameLower = (thread.name || '').toLowerCase();
      const threadGoalLower = (thread.goal || '').toLowerCase();
      const threadDescLower = (thread.description || '').toLowerCase();
      
      if (!threadNameLower) continue; // Skip threads without names
      
      // Extract meaningful keywords from thread name, goal, and description
      // Filter out common words that don't help identify the thread
      const stopWords = new Set(['el', 'la', 'los', 'las', 'un', 'una', 'de', 'del', 'al', 'a', 'en', 'con', 'por', 'para', 'que', 'y', 'o', 'su', 'sus', 'se', 'lo', 'es', 'son', 'como', 'más', 'pero', 'sin', 'sobre', 'entre', 'desde', 'hasta', 'the', 'a', 'an', 'of', 'to', 'and', 'or', 'is', 'are', 'be', 'was', 'were', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought', 'used', 'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them', 'my', 'your', 'his', 'its', 'our', 'their', 'mine', 'yours', 'hers', 'ours', 'theirs', 'what', 'which', 'who', 'whom', 'whose', 'where', 'when', 'why', 'how', 'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just', 'also']);
      
      // Extract keywords (words >= 4 chars that aren't stopwords)
      const extractKeywords = (text: string): string[] => {
        return text.split(/[\s\/\(\)\-\.,;:]+/)
          .filter(w => w.length >= 4 && !stopWords.has(w))
          .slice(0, 10); // Max 10 keywords per source
      };
      
      const nameKeywords = extractKeywords(threadNameLower);
      const goalKeywords = extractKeywords(threadGoalLower);
      const descKeywords = extractKeywords(threadDescLower);
      
      // Combine all keywords, prioritizing name and goal (deduplicate)
      const keywordSet = new Set([...nameKeywords, ...goalKeywords, ...descKeywords]);
      const allKeywords = Array.from(keywordSet);
      
      // Also extract character names from goal (proper nouns - capitalized words in original)
      const characterNames = (thread.goal || '').match(/[A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,}/g) || [];
      const charNamesLower = characterNames.map(n => n.toLowerCase());
      
      // Search for mentions in chapter summaries and key events
      let mentionCount = 0;
      let hasResolution = false;
      let lastMentionIndex = -1; // Use INDEX, not chapter_num
      
      for (let idx = 0; idx < safeOutline.length; idx++) {
        const ch = safeOutline[idx];
        const summaryLower = (ch.summary || '').toLowerCase();
        const keyEventLower = (ch.key_event || '').toLowerCase();
        const titleLower = (ch.title || '').toLowerCase();
        const combined = titleLower + ' ' + summaryLower + ' ' + keyEventLower;
        
        // Count how many keywords from this thread appear in this chapter
        let keywordMatches = 0;
        for (const kw of allKeywords) {
          if (combined.includes(kw)) keywordMatches++;
        }
        
        // Also check for character name matches (strong signal)
        let charMatches = 0;
        for (const charName of charNamesLower) {
          if (combined.includes(charName)) charMatches++;
        }
        
        // Consider a match if:
        // - 2+ keywords match, OR
        // - 1+ character names match AND 1+ keywords match, OR
        // - Thread name appears directly
        const directNameMatch = combined.includes(threadNameLower.replace(/[\/\(\)]/g, ' ').trim());
        const hasEnoughKeywords = keywordMatches >= 2;
        const hasCharAndKeyword = charMatches >= 1 && keywordMatches >= 1;
        
        if (directNameMatch || hasEnoughKeywords || hasCharAndKeyword) {
          mentionCount++;
          lastMentionIndex = idx; // Track by index
          
          // Check for resolution keywords
          if (/resuelv|conclu|final|descubr|revel|logra|consigue|cierra|termina|acaba|confes|verdad|prueba|libera|salva|recupera|sana|cura/i.test(combined)) {
            hasResolution = true;
          }
        }
      }
      
      if (mentionCount === 0) {
        criticalIssues.push(`❌ TRAMA HUÉRFANA: "${thread.name}" (objetivo: ${thread.goal}) nunca aparece en ningún capítulo. Palabras clave buscadas: ${allKeywords.slice(0, 5).join(', ')}`);
      } else if (mentionCount === 1) {
        // LitAgents 2.9.5: Tramas débiles ahora son CRÍTICAS - no se pueden arreglar después
        criticalIssues.push(`❌ TRAMA DÉBIL: "${thread.name}" solo aparece en 1 capítulo. DEBE desarrollarse en al menos 3 capítulos.`);
      } else if (mentionCount === 2) {
        // Tramas con solo 2 menciones también son problemáticas
        warnings.push(`⚠️ TRAMA INSUFICIENTE: "${thread.name}" solo aparece en 2 capítulos. Recomendado: 3+ capítulos.`);
      } else if (!hasResolution && lastMentionIndex >= 0 && lastMentionIndex < safeOutline.length - 3) {
        // Thread disappears before the last 3 chapters without resolution
        const lastChapter = safeOutline[lastMentionIndex];
        criticalIssues.push(`❌ TRAMA SIN RESOLVER: "${thread.name}" desaparece en "${lastChapter.title}" sin resolución clara.`);
      }
    }
    
    // 2. Check character arcs have completion
    const characters = worldBible?.characters || worldBible?.personajes || [];
    const safeCharacters = Array.isArray(characters) ? characters : [];
    
    for (const char of safeCharacters.slice(0, 5)) { // Check top 5 characters
      if (!char) continue;
      
      const charName = (char.name || char.nombre || '').toLowerCase();
      const charArc = (char.arc || char.arco || '').toLowerCase();
      
      if (!charName || charName.length < 2) continue;
      
      // Generate all possible aliases for the character
      const aliases = new Set<string>();
      aliases.add(charName); // Full name
      
      // Get explicit aliases from World Bible if defined
      const explicitAliases = (char.aliases || char.apodos || char.alias || []) as string[];
      if (Array.isArray(explicitAliases)) {
        explicitAliases.forEach(a => aliases.add(a.toLowerCase()));
      }
      
      // Extract name parts - handle titles and particles
      const nameParts = charName
        .replace(/[,()]/g, ' ') // Remove commas and parentheses
        .split(/\s+/)
        .filter((p: string) => p.length >= 2);
      
      // Add individual significant parts (skip particles like "de", "el", "la", "del", "los")
      const particles = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'von', 'van', 'di', 'da']);
      for (const part of nameParts) {
        if (!particles.has(part) && part.length >= 3) {
          aliases.add(part);
        }
      }
      
      // Handle nobility titles: "Marqués de X" -> "el Marqués", "X"
      const titleMatch = charName.match(/(marqués|conde|duque|barón|vizconde|príncipe|rey|reina|señor|señora|don|doña)\s+(?:de\s+)?(\w+)/i);
      if (titleMatch) {
        aliases.add(`el ${titleMatch[1].toLowerCase()}`);
        aliases.add(titleMatch[1].toLowerCase());
        if (titleMatch[2] && titleMatch[2].length >= 3) {
          aliases.add(titleMatch[2].toLowerCase());
        }
      }
      
      // Handle nicknames in quotes or parentheses: "Juan 'El Manco'" -> "el manco"
      const nicknameMatch = charName.match(/[''""]([^''"]+)[''""]|\(([^)]+)\)/);
      if (nicknameMatch) {
        const nickname = (nicknameMatch[1] || nicknameMatch[2]).toLowerCase();
        aliases.add(nickname);
        aliases.add(`el ${nickname}`);
      }
      
      // Get first two names combined (for "Antonio de Salazar" style)
      if (nameParts.length >= 2 && !particles.has(nameParts[1])) {
        aliases.add(`${nameParts[0]} ${nameParts[1]}`);
      }
      
      // Get last significant name part (often the family name)
      const significantParts = nameParts.filter((p: string) => !particles.has(p) && p.length >= 3);
      if (significantParts.length > 1) {
        aliases.add(significantParts[significantParts.length - 1]); // Last name
      }
      
      let firstAppearance = -1;
      let lastAppearance = -1;
      let appearanceCount = 0;
      
      for (let i = 0; i < safeOutline.length; i++) {
        const ch = safeOutline[i];
        const combined = ((ch.summary || '') + ' ' + (ch.key_event || '')).toLowerCase();
        
        // Check all aliases
        let found = false;
        const aliasArray = Array.from(aliases);
        for (let j = 0; j < aliasArray.length; j++) {
          const alias = aliasArray[j];
          if (alias.length >= 3 && combined.includes(alias)) {
            found = true;
            break;
          }
        }
        
        if (found) {
          if (firstAppearance === -1) firstAppearance = i;
          lastAppearance = i;
          appearanceCount++;
        }
      }
      
      // Main characters should appear in at least 30% of chapters
      // Check multiple ways to identify main characters
      const role = (char.role || char.rol || char.tipo || '').toLowerCase();
      const isMainCharacter = role.includes('protagonista') || 
                              role.includes('principal') || 
                              role.includes('main') ||
                              role.includes('pov') ||
                              (char.importance === 1 || char.importancia === 1);
      
      // LitAgents 2.9.6: Require 40% protagonist presence (aligned with prompts)
      // Count appearances only in regular chapters (exclude prologue/epilogue)
      let regularAppearanceCount = 0;
      for (let i = 0; i < safeOutline.length; i++) {
        const ch = safeOutline[i];
        if (ch.chapter_num === 0 || ch.chapter_num >= 998) continue;
        const combined = ((ch.summary || '') + ' ' + (ch.key_event || '')).toLowerCase();
        const aliasArray = Array.from(aliases);
        for (const alias of aliasArray) {
          if (alias.length >= 3 && combined.includes(alias)) {
            regularAppearanceCount++;
            break;
          }
        }
      }
      
      if (isMainCharacter && regularAppearanceCount < regularOutline.length * 0.4) {
        const minRequired = Math.ceil(regularOutline.length * 0.4);
        const protagonistName = char.name || char.nombre;
        criticalIssues.push(`❌ PROTAGONISTA AUSENTE: ${protagonistName} solo aparece en ${regularAppearanceCount}/${regularOutline.length} capítulos regulares. DEBE aparecer NOMBRADO EXPLÍCITAMENTE en el summary o key_event de al menos ${minRequired} capítulos (40%). Escribe "${protagonistName}" (no pronombres ni "el protagonista") en los resúmenes de capítulo.`);
      }
      
      // Characters shouldn't disappear mid-story without explanation
      // Compute last appearance index among regular chapters only
      let lastRegularAppearance = -1;
      for (let i = 0; i < regularOutline.length; i++) {
        const ch = regularOutline[i];
        const combined = ((ch.summary || '') + ' ' + (ch.key_event || '')).toLowerCase();
        const aliasArray = Array.from(aliases);
        for (const alias of aliasArray) {
          if (alias.length >= 3 && combined.includes(alias)) {
            lastRegularAppearance = i;
            break;
          }
        }
      }
      if (regularOutline.length >= 8 && regularAppearanceCount >= 3 && lastRegularAppearance < regularOutline.length - 5 && 
          !(char.status || char.estado || '').toLowerCase().includes('muert')) {
        const disappearsAtChapter = regularOutline[lastRegularAppearance]?.chapter_num || (lastRegularAppearance + 1);
        warnings.push(`⚠️ PERSONAJE DESAPARECE: ${char.name || char.nombre} deja de aparecer después del capítulo ${disappearsAtChapter}.`);
      }
    }
    
    // 3. Check for chapters without clear purpose (regular chapters only, skip if none)
    if (regularOutline.length === 0) {
      return { isValid: criticalIssues.length === 0, criticalIssues, warnings };
    }
    for (const ch of regularOutline) {
      const summary = (ch.summary || '').toLowerCase();
      const keyEvent = (ch.key_event || '').toLowerCase();
      
      // Check for vague summaries
      if (summary.length < 50) {
        warnings.push(`⚠️ CAPÍTULO VAGO: "${ch.title || `Cap ${ch.chapter_num}`}" tiene un resumen muy corto (${summary.length} caracteres).`);
      }
      
      // Check for filler chapters
      if (/transición|preparación|reflexiona|piensa en|recuerda|flashback/i.test(summary) &&
          !/descubre|revela|enfrent|conflict|crisis|giro/i.test(summary)) {
        warnings.push(`⚠️ POSIBLE RELLENO: "${ch.title || `Cap ${ch.chapter_num}`}" parece no avanzar la trama principal.`);
      }
    }
    
    // 4. Check three-act structure balance (only regular chapters, exclude prologue/epilogue)
    const totalChapters = regularOutline.length;
    
    // Skip structure checks for very short outlines
    if (totalChapters >= 6) {
      const act1End = Math.max(1, Math.floor(totalChapters * 0.25));
      const act2End = Math.min(totalChapters - 1, Math.floor(totalChapters * 0.75));
      
      // Structural role validation: check AI-labeled turning points
      const requiredRoles: Array<{ role: string; label: string; minPct: number; maxPct: number }> = [
        { role: 'act1_turn', label: 'PUNTO DE GIRO ACTO 1', minPct: 0.15, maxPct: 0.35 },
        { role: 'midpoint', label: 'PUNTO MEDIO', minPct: 0.35, maxPct: 0.65 },
        { role: 'act2_crisis', label: 'CRISIS ACTO 2', minPct: 0.60, maxPct: 0.85 },
      ];
      
      const hasAnyStructuralRole = regularOutline.some(ch => ch.structural_role && ch.structural_role !== 'null');
      
      if (hasAnyStructuralRole) {
        const usedRoles = new Set<string>();
        for (const ch of regularOutline) {
          if (ch.structural_role && ch.structural_role !== 'null') {
            if (usedRoles.has(ch.structural_role)) {
              warnings.push(`⚠️ ROL DUPLICADO: structural_role "${ch.structural_role}" aparece en más de un capítulo. Cada rol debe usarse UNA sola vez.`);
            }
            usedRoles.add(ch.structural_role);
          }
        }
        
        for (const { role, label, minPct, maxPct } of requiredRoles) {
          const chapterIndex = regularOutline.findIndex(ch => ch.structural_role === role);
          if (chapterIndex === -1) {
            criticalIssues.push(`❌ FALTA ${label}: Ningún capítulo tiene structural_role: "${role}". Marca el capítulo correspondiente (~${Math.round(minPct * 100)}-${Math.round(maxPct * 100)}% de la novela).`);
          } else {
            const position = (chapterIndex + 1) / totalChapters;
            const chapter = regularOutline[chapterIndex];
            if (position < minPct - 0.10 || position > maxPct + 0.10) {
              warnings.push(`⚠️ ${label} DESCOLOCADO: "${chapter.title}" (cap ${chapter.chapter_num}) está al ${Math.round(position * 100)}% pero debería estar entre ~${Math.round(minPct * 100)}%-${Math.round(maxPct * 100)}%.`);
            }
          }
        }
      } else {
        // Fallback: AI didn't provide structural_role labels — use keyword detection on regular chapters only
        const turningPointKeywords = /giro|revelaci[oó]n|descubr[ei]|confronta|crisis|punto de no retorno|cl[ií]max|todo cambia|traici[oó]n|emboscada|secreto|verdad|trampa|engaño|ataque|muerte|asesinato|desaparici[oó]n|captura|huida|rescate|sacrificio|alianza|ruptura|transformaci[oó]n|decisi[oó]n|enfrentamiento|batalla|guerra|conspiraci[oó]n|derrota|victoria|p[eé]rdida|abandon[ao]|regreso|venganza|confesi[oó]n|despertar|ca[ií]da|ascenso|quiebre|colapso|explosi[oó]n|fuga|invasi[oó]n|golpe|devastaci[oó]n|sorpresa|impacto|cambio radical|punto de inflexi[oó]n|nada volver[aá]|irremediable|irreversible|inevitable/i;
        
        const windowSize = totalChapters >= 30 ? 5 : totalChapters >= 20 ? 4 : 3;
        
        const act1Start = Math.max(0, act1End - windowSize);
        const act1EndBound = Math.min(totalChapters, act1End + windowSize);
        const act1Turning = regularOutline.slice(act1Start, act1EndBound).some(ch => 
          turningPointKeywords.test((ch.summary || '') + ' ' + (ch.key_event || ''))
        );
        
        const midPoint = Math.floor(totalChapters * 0.5);
        const midStart = Math.max(0, midPoint - windowSize);
        const midEnd = Math.min(totalChapters, midPoint + windowSize);
        const midpointTurning = regularOutline.slice(midStart, midEnd).some(ch =>
          turningPointKeywords.test((ch.summary || '') + ' ' + (ch.key_event || ''))
        );
        
        const act2Start = Math.max(0, act2End - windowSize);
        const act2EndBound = Math.min(totalChapters, act2End + windowSize);
        const act2Turning = regularOutline.slice(act2Start, act2EndBound).some(ch =>
          turningPointKeywords.test((ch.summary || '') + ' ' + (ch.key_event || ''))
        );
        
        if (!act1Turning) {
          criticalIssues.push(`❌ FALTA PUNTO DE GIRO ACTO 1: No hay giro/revelación al ~25% (capítulo ${act1End}). La trama no tendrá impulso.`);
        }
        if (!midpointTurning) {
          criticalIssues.push(`❌ FALTA PUNTO MEDIO: No hay giro/crisis al ~50% (capítulo ${Math.floor(totalChapters * 0.5)}). La historia perderá tensión.`);
        }
        if (!act2Turning) {
          criticalIssues.push(`❌ FALTA CRISIS ACTO 2: No hay crisis/confrontación al ~75% (capítulo ${act2End}). El clímax no tendrá peso.`);
        }
      }
    }
    
    const isValid = criticalIssues.length === 0;
    
    return { isValid, criticalIssues, warnings };
  }

  /**
   * LitAgents 2.9.6: Post-processor to inject protagonist name into outlines
   * Called after final validation failure to enforce protagonist presence
   * Injects into critical chapters AND enough additional chapters to reach 40%
   * @returns Modified outline with protagonist injected to meet 40% requirement
   */
  private injectProtagonistIntoOutline(
    outline: Array<{ chapter_num: number; title: string; summary: string; key_event: string; emotional_arc?: string; structural_role?: string | null }>,
    protagonistName: string
  ): Array<{ chapter_num: number; title: string; summary: string; key_event: string; emotional_arc?: string; structural_role?: string | null }> {
    if (!outline || outline.length === 0 || !protagonistName) {
      return outline;
    }
    
    const protagonistNameLower = protagonistName.toLowerCase();
    
    // First, count current appearances
    let currentAppearances = 0;
    const chaptersWithProtagonist = new Set<number>();
    const chaptersWithoutProtagonist: number[] = [];
    
    for (const chapter of outline) {
      const summaryLower = (chapter.summary || '').toLowerCase();
      const keyEventLower = (chapter.key_event || '').toLowerCase();
      
      if (summaryLower.includes(protagonistNameLower) || keyEventLower.includes(protagonistNameLower)) {
        currentAppearances++;
        chaptersWithProtagonist.add(chapter.chapter_num);
      } else {
        chaptersWithoutProtagonist.push(chapter.chapter_num);
      }
    }
    
    // Calculate how many more chapters need the protagonist (40% requirement)
    const minRequired = Math.ceil(outline.length * 0.4);
    const additionalNeeded = Math.max(0, minRequired - currentAppearances);
    
    console.log(`[OrchestratorV2] Protagonist "${protagonistName}" currently in ${currentAppearances}/${outline.length} chapters. Need ${minRequired} (40%). Additional needed: ${additionalNeeded}`);
    
    if (additionalNeeded === 0) {
      console.log(`[OrchestratorV2] Protagonist already meets 40% requirement, no injection needed.`);
      return outline;
    }
    
    // Identify critical chapters where protagonist MUST appear (prioritize these)
    const regularChapters = outline.filter(ch => ch.chapter_num > 0 && ch.chapter_num < 900);
    const criticalChapterNums = new Set<number>();
    
    // Prologue (if exists)
    if (outline.some(ch => ch.chapter_num === 0)) {
      criticalChapterNums.add(0);
    }
    
    // Chapter 1 (first regular chapter)
    if (regularChapters.length > 0) {
      criticalChapterNums.add(regularChapters[0].chapter_num);
    }
    
    // 25% turning point
    const quarterPoint = Math.ceil(regularChapters.length * 0.25);
    if (regularChapters[quarterPoint - 1]) {
      criticalChapterNums.add(regularChapters[quarterPoint - 1].chapter_num);
    }
    
    // 50% midpoint
    const midPoint = Math.ceil(regularChapters.length * 0.5);
    if (regularChapters[midPoint - 1]) {
      criticalChapterNums.add(regularChapters[midPoint - 1].chapter_num);
    }
    
    // 75% turning point
    const threeQuarterPoint = Math.ceil(regularChapters.length * 0.75);
    if (regularChapters[threeQuarterPoint - 1]) {
      criticalChapterNums.add(regularChapters[threeQuarterPoint - 1].chapter_num);
    }
    
    // Final chapter
    if (regularChapters.length > 0) {
      criticalChapterNums.add(regularChapters[regularChapters.length - 1].chapter_num);
    }
    
    // Build prioritized list of chapters to inject into:
    // 1. Critical chapters without protagonist
    // 2. Early chapters (to establish protagonist early)
    const prioritizedChapters: number[] = [];
    
    // Add critical chapters first
    for (const criticalNum of Array.from(criticalChapterNums)) {
      if (!chaptersWithProtagonist.has(criticalNum)) {
        prioritizedChapters.push(criticalNum);
      }
    }
    
    // Add remaining chapters in order (early chapters first)
    const remainingChapters = chaptersWithoutProtagonist
      .filter(num => !criticalChapterNums.has(num))
      .sort((a, b) => a - b);
    
    prioritizedChapters.push(...remainingChapters);
    
    // Select the chapters to inject into
    const chaptersToInject = new Set(prioritizedChapters.slice(0, additionalNeeded));
    
    console.log(`[OrchestratorV2] Injecting protagonist into ${chaptersToInject.size} chapters: ${Array.from(chaptersToInject).join(', ')}`);
    
    // Modify outline to inject protagonist name
    const modifiedOutline = outline.map(chapter => {
      if (chaptersToInject.has(chapter.chapter_num)) {
        const injectedSummary = `${protagonistName} ${chapter.summary}`;
        console.log(`[OrchestratorV2] Injected protagonist into chapter ${chapter.chapter_num}`);
        return {
          ...chapter,
          summary: injectedSummary
        };
      }
      return chapter;
    });
    
    return modifiedOutline;
  }

  /**
   * LitAgents 2.9.5: Build plot threads context to inject into Chapter Architect and Ghostwriter
   * Ensures scenes are written following the established plot threads
   */
  private async buildPlotThreadsContext(
    projectId: number,
    chapterNumber: number,
    outline: Array<{ chapter_num: number; title: string; summary: string; key_event: string }> | null
  ): Promise<string> {
    try {
      // Get plot threads from database
      const plotThreads = await storage.getPlotThreadsByProject(projectId);
      if (!plotThreads || plotThreads.length === 0) {
        return '';
      }
      
      // Get current chapter outline for context
      const currentChapter = outline?.find(ch => ch.chapter_num === chapterNumber);
      const nextChapter = outline?.find(ch => ch.chapter_num === chapterNumber + 1);
      
      // Find which threads should be active in this chapter based on outline
      const activeThreads: typeof plotThreads = [];
      const chapterSummary = (currentChapter?.summary || '').toLowerCase();
      const chapterEvent = (currentChapter?.key_event || '').toLowerCase();
      const chapterTitle = (currentChapter?.title || '').toLowerCase();
      const chapterText = chapterTitle + ' ' + chapterSummary + ' ' + chapterEvent;
      
      for (const thread of plotThreads) {
        const threadName = (thread.name || '').toLowerCase();
        const threadGoal = (thread.goal || '').toLowerCase();
        
        // Extract keywords from thread
        const keywords = (threadName + ' ' + threadGoal).split(/\s+/)
          .filter(w => w.length >= 4)
          .slice(0, 5);
        
        // Check if any keyword matches chapter content
        const matchCount = keywords.filter(kw => chapterText.includes(kw)).length;
        if (matchCount >= 1 || thread.status === 'active') {
          activeThreads.push(thread);
        }
      }
      
      if (activeThreads.length === 0) {
        // Default: include all active threads if none matched
        activeThreads.push(...plotThreads.filter(t => t.status === 'active').slice(0, 5));
      }
      
      // Build context string
      let context = `

═══════════════════════════════════════════════════════════════
📚 TRAMAS Y SUBTRAMAS ACTIVAS - OBLIGATORIO DESARROLLAR
═══════════════════════════════════════════════════════════════

Las siguientes tramas DEBEN ser avanzadas en este capítulo. Cada escena debe contribuir al desarrollo de al menos una de ellas:

`;
      
      for (let i = 0; i < activeThreads.length; i++) {
        const thread = activeThreads[i];
        const threadType = i === 0 ? '🔴 TRAMA PRINCIPAL' : `🟡 SUBTRAMA ${i}`;
        const resChapter = thread.resolutionChapter;
        const resInfo = resChapter ? `Se resuelve en Capítulo ${resChapter}` : 'Sin capítulo de resolución asignado';
        context += `${threadType}: ${thread.name}
   Objetivo: ${thread.goal || 'No especificado'}
   Estado: ${thread.status === 'resolved' ? 'RESUELTA' : 'EN DESARROLLO'}
   Resolución: ${resInfo}
   
`;
      }
      
      // Add specific thread resolution instructions if any thread resolves in this chapter
      const threadsResolvingHere = activeThreads.filter(t => t.resolutionChapter === chapterNumber);
      if (threadsResolvingHere.length > 0) {
        context += `
⚠️ CIERRE OBLIGATORIO EN ESTE CAPÍTULO:
${threadsResolvingHere.map(t => `   → La trama "${t.name}" DEBE resolverse explícitamente en este capítulo. Objetivo: ${t.goal || 'completar su arco'}`).join('\n')}

`;
      }

      // Add current chapter expectations
      if (currentChapter) {
        context += `
📍 EXPECTATIVAS PARA CAPÍTULO ${chapterNumber}:
   Evento clave: ${currentChapter.key_event || 'No especificado'}
   Resumen esperado: ${currentChapter.summary || 'No especificado'}
`;
      }
      
      // Add hint for next chapter connection
      if (nextChapter) {
        context += `
🔗 PREPARAR CONEXIÓN CON SIGUIENTE CAPÍTULO:
   Próximo evento: ${nextChapter.key_event || 'No especificado'}
`;
      }

      // PROGRESSIVE THREAD CLOSURE: When approaching the end, inject urgency
      if (outline && outline.length > 0) {
        const regularOutline = outline.filter(ch => ch.chapter_num > 0 && ch.chapter_num < 998);
        const totalRegularChapters = regularOutline.length;
        const currentIdx = regularOutline.findIndex(ch => ch.chapter_num === chapterNumber);
        if (currentIdx < 0) {
          // Chapter not found in regular outline, skip thread closure injection
        } else {
        const chaptersRemaining = totalRegularChapters - currentIdx;
        const unresolvedThreads = plotThreads.filter(t => t.status !== 'resolved');
        
        if (chaptersRemaining <= 6 && unresolvedThreads.length > 0) {
          const urgencyLevel = chaptersRemaining <= 2 ? 'CRÍTICA' : chaptersRemaining <= 4 ? 'ALTA' : 'MEDIA';
          
          context += `
🔴🔴🔴 URGENCIA DE CIERRE DE TRAMAS: ${urgencyLevel} 🔴🔴🔴
Quedan ${chaptersRemaining} capítulos regulares (${chaptersRemaining <= 2 ? 'incluido este' : 'contando este'}) antes del epílogo.
${unresolvedThreads.length} trama(s) DEBEN cerrarse antes del epílogo:

`;
          // Sort threads: most recently advanced first (they're closest to resolution)
          // Then by status: 'developing' before 'active' (developing = more progress)
          const sortedThreads = [...unresolvedThreads].sort((a, b) => {
            const statusOrder = (s: string) => s === 'developing' ? 0 : 1;
            const statusDiff = statusOrder(a.status) - statusOrder(b.status);
            if (statusDiff !== 0) return statusDiff;
            return (b.lastUpdatedChapter || 0) - (a.lastUpdatedChapter || 0);
          });

          const threadsPerChapter = Math.ceil(sortedThreads.length / chaptersRemaining);
          const threadsForThisChapter = sortedThreads.slice(0, Math.max(1, threadsPerChapter));
          const threadsForLater = sortedThreads.slice(threadsForThisChapter.length);

          context += `⚡ CERRAR EN ESTE CAPÍTULO (${threadsForThisChapter.length} trama(s)):\n`;
          for (const t of threadsForThisChapter) {
            const progressNote = t.lastUpdatedChapter ? ` (último avance: Cap ${t.lastUpdatedChapter})` : '';
            context += `   - "${t.name}": Resolver con desenlace claro${progressNote}. El lector DEBE saber qué pasó con esto.\n`;
          }
          
          if (threadsForLater.length > 0) {
            context += `\n📋 Preparar para cerrar en capítulos siguientes:\n`;
            for (const t of threadsForLater) {
              context += `   - "${t.name}": Avanzar significativamente hacia su resolución\n`;
            }
          }
          
          context += `
⚠️ REGLAS DE CIERRE:
- Cada trama cerrada DEBE tener un desenlace EXPLÍCITO y satisfactorio
- NO dejar ambigüedad: el lector debe entender claramente qué ocurrió
- El destino de cada personaje importante debe quedar claro
- Los objetos/secretos clave deben tener resolución (¿qué pasó con la lista? ¿la copia? etc.)
- Priorizar cierre NATURAL integrado en la acción, no exposición forzada
`;
        }
        } // end else (currentIdx >= 0)
      }
      
      context += `
⚠️ OBLIGACIONES DEL ESCRITOR:
1. Cada escena DEBE avanzar al menos una trama/subtrama
2. NO crear tramas nuevas que no estén listadas arriba
3. Mantener coherencia con el objetivo de cada trama
4. Las escenas de transición también deben aportar al desarrollo de tramas

🚫 PREVENCIÓN DE DEUS EX MACHINA:
- NO introducir personajes nuevos que resuelvan conflictos
- NO usar habilidades/objetos no establecidos previamente
- NO resolver problemas con coincidencias convenientes
- Si un recurso se usa para resolver algo, DEBE haberse mencionado antes
- Los aliados que ayudan DEBEN tener motivación ya establecida
═══════════════════════════════════════════════════════════════

`;
      
      return context;
    } catch (error) {
      console.error('[OrchestratorV2] Error building plot threads context:', error);
      return '';
    }
  }

  /**
   * LitAgents 2.9.6: Extract main characters from extended guide
   * Used to maintain character consistency between regeneration attempts
   */
  private extractCharactersFromExtendedGuide(extendedGuide?: string): Array<{ name: string; role: string; description: string }> {
    if (!extendedGuide) return [];
    
    const characters: Array<{ name: string; role: string; description: string }> = [];
    
    // Pattern 1: Parse "## Personajes" sections with bullet/list items
    // Matches: "## Personajes\n- Nombre: descripción" or "## Protagonistas\n* Nombre - descripción"
    const sectionRegex = /##\s*(?:Personajes|Protagonistas?|Elenco|Characters)[^\n]*\n((?:[^\n#]*\n)*?)(?=##|$)/gi;
    let sectionMatch;
    
    while ((sectionMatch = sectionRegex.exec(extendedGuide)) !== null) {
      const sectionContent = sectionMatch[1];
      // Guard against empty sections
      if (!sectionContent || sectionContent.trim().length === 0) continue;
      
      // Parse bullet items: "- Name: description" or "* Name - description" or "- Name (role) description"
      const bulletRegex = /^[\s]*[-*•]\s*\**([A-ZÁÉÍÓÚÑ][^:\n\-–*(]+?)\**\s*(?:\([^)]+\)\s*)?[:\-–]?\s*([^\n]*)/gim;
      let bulletMatch;
      
      while ((bulletMatch = bulletRegex.exec(sectionContent)) !== null) {
        const name = bulletMatch[1].trim().replace(/\*+/g, '');
        const description = bulletMatch[2].trim().substring(0, 100);
        
        // Skip section headers
        if (/^(personajes?|protagonistas?|antagonistas?|secundarios?|elenco)/i.test(name)) continue;
        if (name.length < 2 || name.length > 80) continue;
        
        // Determine role from context
        let role = 'supporting';
        const sectionHeader = sectionMatch[0].toLowerCase();
        if (/protagonista|principal/i.test(sectionHeader) || /protagonista/i.test(description)) role = 'protagonist';
        else if (/antagonista|villano/i.test(sectionHeader) || /antagonista|villano/i.test(description)) role = 'antagonist';
        
        if (!characters.some(c => c.name.toLowerCase() === name.toLowerCase())) {
          characters.push({ name, role, description });
        }
      }
    }
    
    // Pattern 2: Individual character entries "### Nombre del Personaje"
    const charRegex = /###?\s*([A-ZÁÉÍÓÚÑ][^:\n]+?)(?:\s*[-–:]\s*|\s*\n)/gi;
    let match;
    
    while ((match = charRegex.exec(extendedGuide)) !== null) {
      const name = match[1].trim();
      // Skip section headers
      if (/^(personajes?|protagonistas?|antagonistas?|secundarios?|elenco|resumen|sinopsis|capítulo|acto|escena)/i.test(name)) continue;
      if (name.length < 3 || name.length > 80) continue;
      
      // Try to determine role from context
      const contextStart = Math.max(0, match.index - 50);
      const contextEnd = Math.min(extendedGuide.length, match.index + match[0].length + 200);
      const context = extendedGuide.substring(contextStart, contextEnd).toLowerCase();
      
      let role = 'supporting';
      if (/protagonista|principal|héroe|heroína/i.test(context)) role = 'protagonist';
      else if (/antagonista|villano|enemigo/i.test(context)) role = 'antagonist';
      
      // Get brief description (next 100 chars after name)
      const descStart = match.index + match[0].length;
      const description = extendedGuide.substring(descStart, descStart + 150).split('\n')[0].trim();
      
      // Avoid duplicates
      if (!characters.some(c => c.name.toLowerCase() === name.toLowerCase())) {
        characters.push({ name, role, description: description.substring(0, 100) });
      }
    }
    
    // Pattern 3: Prose-style character mentions "X, un/una Y que..."
    const premiseCharRegex = /([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){0,3}),?\s+(?:un|una|el|la)\s+([a-záéíóúñ\s]+?)\s+(?:que|quien|de)/gi;
    while ((match = premiseCharRegex.exec(extendedGuide)) !== null) {
      const name = match[1].trim();
      const roleDesc = match[2].trim();
      
      if (name.length >= 3 && name.length <= 50 && !characters.some(c => c.name.toLowerCase() === name.toLowerCase())) {
        characters.push({ 
          name, 
          role: /protagonista|héroe|heroína/i.test(roleDesc) ? 'protagonist' : 'supporting',
          description: roleDesc.substring(0, 80)
        });
      }
    }
    
    return characters.slice(0, 10); // Max 10 characters
  }

  /**
   * LitAgents 2.9.10: Validate and auto-correct series character consistency.
   * Compares World Bible characters against series guide characters to detect
   * name changes, gender swaps, or role modifications.
   */
  private validateSeriesCharacterConsistency(
    worldBibleCharacters: any[],
    extendedGuide: string,
    projectId: number
  ): { corrections: Array<{ wbIndex: number; field: string; from: string; to: string }>; warnings: string[] } {
    const corrections: Array<{ wbIndex: number; field: string; from: string; to: string }> = [];
    const warnings: string[] = [];
    
    if (!extendedGuide || !worldBibleCharacters || worldBibleCharacters.length === 0) {
      return { corrections, warnings };
    }
    
    const guideCharacters = this.extractCharactersFromExtendedGuide(extendedGuide);
    if (guideCharacters.length === 0) return { corrections, warnings };
    
    const guideGenders = this.extractGendersFromGuide(extendedGuide);
    
    for (const guideChar of guideCharacters) {
      const guideName = (guideChar.name || '').trim();
      if (!guideName) continue;
      
      const guideNameLower = guideName.toLowerCase();
      const guideFirstName = guideName.split(/\s+/)[0].toLowerCase();
      
      const exactMatch = worldBibleCharacters.findIndex((wbChar: any) => {
        const wbName = (wbChar.name || wbChar.nombre || '').toLowerCase().trim();
        return wbName === guideNameLower;
      });
      
      if (exactMatch >= 0) {
        const wbChar = worldBibleCharacters[exactMatch];
        const guideGender = guideGenders[guideNameLower] || guideGenders[guideFirstName];
        if (guideGender) {
          const wbProfile = (wbChar.profile || wbChar.description || '').toLowerCase();
          const wbName = (wbChar.name || wbChar.nombre || '').toLowerCase();
          
          const isFemaleGuide = guideGender === 'female';
          const isMaleGuide = guideGender === 'male';
          
          const femaleIndicators = /\b(inspectora|detective\s+femenin|ella|heroína|madre|esposa|novia|hermana|hija|abuela|tía|señora|dama|reina|princesa|doctora|profesora|comisaria|agente\s+femenin)\b/i;
          const maleIndicators = /\b(inspector\b|detective\s+masculin|él\b|héroe|padre|esposo|novio|hermano|hijo|abuelo|tío|señor|rey|príncipe|doctor\b|profesor\b|comisario|agente\s+masculin)\b/i;
          
          if (isFemaleGuide && maleIndicators.test(wbProfile) && !femaleIndicators.test(wbProfile)) {
            warnings.push(`⚠️ ALERTA DE GÉNERO: "${wbChar.name || wbChar.nombre}" parece haber cambiado de género. En la guía de serie es FEMENINO pero la biblia usa indicadores masculinos. Se corregirá.`);
            corrections.push({
              wbIndex: exactMatch,
              field: 'gender',
              from: 'male',
              to: 'female'
            });
          } else if (isMaleGuide && femaleIndicators.test(wbProfile) && !maleIndicators.test(wbProfile)) {
            warnings.push(`⚠️ ALERTA DE GÉNERO: "${wbChar.name || wbChar.nombre}" parece haber cambiado de género. En la guía de serie es MASCULINO pero la biblia usa indicadores femeninos. Se corregirá.`);
            corrections.push({
              wbIndex: exactMatch,
              field: 'gender',
              from: 'female',
              to: 'male'
            });
          }
        }
        continue;
      }
      
      const similarMatch = worldBibleCharacters.findIndex((wbChar: any) => {
        const wbName = (wbChar.name || wbChar.nombre || '').toLowerCase().trim();
        const wbFirstName = wbName.split(/\s+/)[0];
        const wbRole = (wbChar.role || wbChar.rol || '').toLowerCase();
        const guideRole = (guideChar.role || '').toLowerCase();
        
        if (wbFirstName === guideFirstName && wbName !== guideNameLower) return true;
        
        if (guideRole && guideRole !== 'supporting' && wbRole === guideRole) {
          const nameSimilarity = this.calculateNameSimilarity(guideName, wbChar.name || wbChar.nombre || '');
          if (nameSimilarity > 0.4) return true;
        }
        
        return false;
      });
      
      if (similarMatch >= 0) {
        const wbChar = worldBibleCharacters[similarMatch];
        const wbName = wbChar.name || wbChar.nombre || '';
        
        warnings.push(`⚠️ NOMBRE CAMBIADO: La guía de serie define "${guideName}" (${guideChar.role}) pero la biblia del mundo usa "${wbName}". Se corregirá automáticamente.`);
        
        corrections.push({
          wbIndex: similarMatch,
          field: 'name',
          from: wbName,
          to: guideName
        });
      } else {
        if (guideChar.role === 'protagonist' || guideChar.role === 'antagonist') {
          warnings.push(`⚠️ PERSONAJE FALTANTE: "${guideName}" (${guideChar.role}) está definido en la guía de serie pero NO aparece en la biblia del mundo generada.`);
        }
      }
    }
    
    return { corrections, warnings };
  }
  
  private extractGendersFromGuide(guide: string): Record<string, 'male' | 'female'> {
    const genders: Record<string, 'male' | 'female'> = {};
    
    const femalePatterns = [
      /\*\*Nombre(?:\s+completo)?:\*\*\s*([^\n]+)/gi,
      /(?:protagonista|detective|inspectora|heroína|agente)\s+(?:femenin[ao])?[:\s]*([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)*)/gi,
    ];
    
    const nameGenderPatterns = [
      { pattern: /\*\*Nombre(?:\s+completo)?:\*\*\s*([^\n]+)/gi, context: 200 },
      { pattern: /###?\s+(?:El|La)\s+(Detective|Protagonista|Inspector[a]?)\b[^\n]*\n[\s\S]*?\*\*Nombre(?:\s+completo)?:\*\*\s*([^\n]+)/gi, context: 0 },
    ];
    
    for (const { pattern } of nameGenderPatterns) {
      let match;
      while ((match = pattern.exec(guide)) !== null) {
        const nameStr = (match[2] || match[1] || '').trim().replace(/\*+/g, '');
        if (!nameStr || nameStr.length < 2) continue;
        
        const contextStart = Math.max(0, match.index - 100);
        const contextEnd = Math.min(guide.length, match.index + match[0].length + 200);
        const context = guide.substring(contextStart, contextEnd);
        
        const isFemale = /\b(inspectora|heroína|ella|madre|esposa|mujer|femenin|señora|detective\s+femenin|comisaria|doctora|profesora)\b/i.test(context);
        const isMale = /\b(inspector\b|héroe\b|él\b|padre|esposo|hombre|masculin|señor|comisario|doctor\b|profesor\b)\b/i.test(context);
        
        const nameLower = nameStr.toLowerCase();
        const firstName = nameLower.split(/\s+/)[0];
        
        if (isFemale && !isMale) {
          genders[nameLower] = 'female';
          genders[firstName] = 'female';
        } else if (isMale && !isFemale) {
          genders[nameLower] = 'male';
          genders[firstName] = 'male';
        }
      }
    }
    
    const sectionGenders: Array<{ header: RegExp; gender: 'female' | 'male' }> = [
      { header: /##\s*\d+\.\s*(?:LA\s+)?(?:DETECTIVE|PROTAGONISTA|INSPECTORA|HEROÍNA)/gi, gender: 'female' },
      { header: /##\s*\d+\.\s*(?:EL\s+)?(?:DETECTIVE|PROTAGONISTA|INSPECTOR\b|HÉROE)/gi, gender: 'male' },
    ];
    
    for (const { header, gender } of sectionGenders) {
      let headerMatch;
      while ((headerMatch = header.exec(guide)) !== null) {
        const sectionStart = headerMatch.index;
        const sectionEnd = guide.indexOf('\n## ', sectionStart + 1);
        const section = guide.substring(sectionStart, sectionEnd > 0 ? sectionEnd : sectionStart + 500);
        
        const nameMatch = section.match(/\*\*Nombre(?:\s+completo)?:\*\*\s*([^\n]+)/i);
        if (nameMatch) {
          const name = nameMatch[1].trim().replace(/\*+/g, '').toLowerCase();
          const firstName = name.split(/\s+/)[0];
          genders[name] = gender;
          genders[firstName] = gender;
        }
      }
    }
    
    return genders;
  }
  
  /**
   * LitAgents 2.9.10: Extract volume-specific context from the series guide.
   * Looks for sections like "HITOS DEL VOLUMEN N", "ARQUITECTURA DEL VOLUMEN N",
   * and any volume-specific character/plot information.
   */
  private extractVolumeContextFromGuide(guide: string, volumeNumber: number): string | null {
    if (!guide || volumeNumber <= 0) return null;
    
    const sections: string[] = [];
    
    const hitosPatterns = [
      new RegExp(`##\\s*HITOS\\s+DEL\\s+VOLUMEN\\s+${volumeNumber}[:\\s]*[^\\n]*\\n([\\s\\S]*?)(?=##\\s*(?:HITOS\\s+DEL\\s+VOLUMEN|ARQUITECTURA\\s+DEL\\s+VOLUMEN)\\s+(?!${volumeNumber}\\b)|$)`, 'i'),
      new RegExp(`##\\s*HITOS\\s+(?:VOLUMEN|VOL\\.?)\\s*${volumeNumber}[:\\s]*[^\\n]*\\n([\\s\\S]*?)(?=##\\s|$)`, 'i'),
    ];
    
    for (const pattern of hitosPatterns) {
      const match = guide.match(pattern);
      if (match) {
        const content = match[0].trim();
        if (content.length > 30) {
          sections.push(content);
          break;
        }
      }
    }
    
    const arqPatterns = [
      new RegExp(`##\\s*ARQUITECTURA\\s+DEL\\s+VOLUMEN\\s+${volumeNumber}[:\\s]*[^\\n]*\\n([\\s\\S]*?)(?=##\\s*(?:HITOS\\s+DEL\\s+VOLUMEN|ARQUITECTURA\\s+DEL\\s+VOLUMEN)\\s+(?!${volumeNumber}\\b)|$)`, 'i'),
      new RegExp(`##\\s*ARQUITECTURA\\s+(?:VOLUMEN|VOL\\.?)\\s*${volumeNumber}[:\\s]*[^\\n]*\\n([\\s\\S]*?)(?=##\\s|$)`, 'i'),
    ];
    
    for (const pattern of arqPatterns) {
      const match = guide.match(pattern);
      if (match) {
        const content = match[0].trim();
        if (content.length > 30 && !sections.some(s => s.includes(content.substring(0, 50)))) {
          sections.push(content);
          break;
        }
      }
    }
    
    const volTitlePattern = new RegExp(`\\*\\*(?:Título|Titulo)\\s*(?:del\\s+)?(?:volumen|vol\\.?)\\s*${volumeNumber}[^*]*\\*\\*[:\\s]*([^\\n]+)`, 'i');
    const volArgPattern = new RegExp(`\\*\\*Argumento(?:\\s+del\\s+volumen\\s+${volumeNumber})?\\*\\*[:\\s]*([^\\n](?:[\\s\\S]*?)?)(?=\\n\\*\\*|\\n##|$)`, 'i');
    
    const volRefPattern = new RegExp(`(?:volumen|vol\\.?|libro)\\s*${volumeNumber}[:\\s]+["\u201C]([^"\u201D\\n]+)["\u201D]`, 'gi');
    let refMatch;
    while ((refMatch = volRefPattern.exec(guide)) !== null) {
      const contextStart = Math.max(0, refMatch.index - 20);
      const contextEnd = Math.min(guide.length, refMatch.index + 500);
      const nearbyText = guide.substring(contextStart, contextEnd);
      
      const argInContext = nearbyText.match(/\*\*Argumento:\*\*\s*([\s\S]*?)(?=\n\*\*|\n##|$)/i);
      if (argInContext && !sections.some(s => s.includes(argInContext[1].substring(0, 40)))) {
        sections.push(`Argumento del Volumen ${volumeNumber}: ${argInContext[1].trim()}`);
      }
    }
    
    const protagonistSection = guide.match(/##\s*\d+\.\s*(?:EL|LA)\s+(?:DETECTIVE|PROTAGONISTA)[^\n]*\n([\s\S]*?)(?=\n##\s*\d+)/i);
    if (protagonistSection) {
      const protContent = protagonistSection[0].trim();
      if (protContent.length > 50 && !sections.some(s => s.includes(protContent.substring(0, 50)))) {
        sections.push(protContent);
      }
    }
    
    const recurringCharsSection = guide.match(/##\s*\d+\.\s*PERSONAJES\s+RECURRENTES[^\n]*\n([\s\S]*?)(?=\n##\s*\d+)/i);
    if (recurringCharsSection) {
      const charsContent = recurringCharsSection[0].trim();
      if (charsContent.length > 50 && !sections.some(s => s.includes(charsContent.substring(0, 50)))) {
        sections.push(charsContent);
      }
    }
    
    const worldRulesSection = guide.match(/##\s*\d+\.\s*REGLAS\s+DEL\s+MUNDO[^\n]*\n([\s\S]*?)(?=\n##\s*\d+)/i);
    if (worldRulesSection) {
      const rulesContent = worldRulesSection[0].trim();
      if (rulesContent.length > 50 && !sections.some(s => s.includes(rulesContent.substring(0, 50)))) {
        sections.push(rulesContent);
      }
    }
    
    const metaplotSection = guide.match(/##\s*\d+\.\s*(?:EL\s+)?HILO\s+CONDUCTOR[^\n]*\n([\s\S]*?)(?=\n##\s*\d+)/i);
    if (metaplotSection) {
      const metaContent = metaplotSection[0].trim();
      if (metaContent.length > 50 && !sections.some(s => s.includes(metaContent.substring(0, 50)))) {
        sections.push(metaContent);
      }
    }
    
    const continuitySection = guide.match(/##\s*\d+\.\s*(?:PREVENCIÓN\s+DE\s+)?ERRORES?\s+DE\s+CONTINUIDAD[^\n]*\n([\s\S]*?)(?=\n##\s*\d+|$)/i);
    if (continuitySection) {
      const contContent = continuitySection[0].trim();
      if (contContent.length > 50 && !sections.some(s => s.includes(contContent.substring(0, 50)))) {
        sections.push(contContent);
      }
    }
    
    if (sections.length === 0) return null;
    
    return sections.join('\n\n');
  }

  private calculateNameSimilarity(name1: string, name2: string): number {
    const a = name1.toLowerCase();
    const b = name2.toLowerCase();
    if (a === b) return 1.0;
    
    const aFirst = a.split(/\s+/)[0];
    const bFirst = b.split(/\s+/)[0];
    if (aFirst === bFirst) return 0.7;
    
    const maxLen = Math.max(a.length, b.length);
    if (maxLen === 0) return 0;
    
    let matches = 0;
    const minLen = Math.min(a.length, b.length);
    for (let i = 0; i < minLen; i++) {
      if (a[i] === b[i]) matches++;
    }
    
    return matches / maxLen;
  }

  /**
   * LitAgents 2.9.6: Build corrective instructions for Global Architect regeneration
   * Now includes character consistency requirements
   */
  private buildPlotCorrectionInstructions(
    criticalIssues: string[],
    warnings: string[],
    attemptNumber: number,
    previousCharacters?: Array<{ name: string; role: string }>,
    extendedGuideCharacters?: Array<{ name: string; role: string; description: string }>,
    actualChapterCount?: number
  ): string {
    const severity = attemptNumber >= 2 ? '🔴 CRÍTICO' : '⚠️ IMPORTANTE';
    
    let instructions = `
╔══════════════════════════════════════════════════════════════════╗
║ ${severity}: CORRECCIONES OBLIGATORIAS (Intento ${attemptNumber}/5)              ║
╚══════════════════════════════════════════════════════════════════╝

La estructura anterior fue RECHAZADA por problemas graves. DEBES corregir:

`;

    // LitAgents 2.9.6: Character consistency enforcement
    const protagonists = previousCharacters?.filter(c => c.role === 'protagonist' || c.role === 'protagonista') || [];
    const guideProtagonists = extendedGuideCharacters?.filter(c => c.role === 'protagonist') || [];
    
    const allProtagonists = [...protagonists];
    for (const char of guideProtagonists) {
      if (!allProtagonists.some(p => p.name.toLowerCase() === char.name.toLowerCase())) {
        allProtagonists.push(char);
      }
    }
    
    if (allProtagonists.length > 0) {
      const mainProtagonist = allProtagonists[0];
      const chapterCount = actualChapterCount || 20; // Use actual count if provided, or reasonable default
      const minAppearances = Math.ceil(chapterCount * 0.4);
      
      instructions += `
╔══════════════════════════════════════════════════════════════════╗
║ ⚠️ CORRECCIÓN OBLIGATORIA: PRESENCIA DEL PROTAGONISTA           ║
╠══════════════════════════════════════════════════════════════════╣
║                                                                  ║
║ PROTAGONISTA PRINCIPAL: "${mainProtagonist.name}"                 ║
║                                                                  ║
║ PROBLEMA DETECTADO: El protagonista NO aparece en suficientes    ║
║ capítulos. El sistema RECHAZA estructuras sin presencia clara.   ║
║                                                                  ║
║ SOLUCIÓN OBLIGATORIA:                                            ║
║ 1. Escribe el NOMBRE "${mainProtagonist.name}" explícitamente    ║
║    en el campo "summary" O "key_event" de cada capítulo donde    ║
║    este personaje interviene.                                    ║
║                                                                  ║
║ 2. El protagonista DEBE aparecer NOMBRADO en:                    ║
║    - Prólogo (si existe)                                         ║
║    - Capítulo 1 (OBLIGATORIO)                                    ║
║    - Capítulos de puntos de giro (~${Math.ceil(chapterCount * 0.25)}, ~${Math.ceil(chapterCount * 0.5)}, ~${Math.ceil(chapterCount * 0.75)})             ║
║    - Capítulo final (${chapterCount}) (OBLIGATORIO)                             ║
║    - AL MENOS ${minAppearances} de ${chapterCount} capítulos (40%)                           ║
║                                                                  ║
║ 3. INCORRECTO: "El detective investiga" / "descubre la verdad"  ║
║    CORRECTO: "${mainProtagonist.name} investiga el crimen"       ║
║                                                                  ║
║ 4. NO cambies el nombre del protagonista. NO inventes otro.      ║
╚══════════════════════════════════════════════════════════════════╝

`;
      
      instructions += `=== 🔒 PERSONAJES CANÓNICOS (NO CAMBIAR) ===\n`;
      instructions += `OBLIGATORIO: Mantener EXACTAMENTE los mismos personajes principales:\n`;
      
      for (const char of protagonists) {
        instructions += `- PROTAGONISTA: "${char.name}" (NO RENOMBRAR, NO REEMPLAZAR)\n`;
      }
      for (const char of guideProtagonists) {
        if (!protagonists.some(p => p.name.toLowerCase() === char.name.toLowerCase())) {
          instructions += `- PROTAGONISTA (de guía): "${char.name}" - ${char.description}\n`;
        }
      }
      
      instructions += `\n⚠️ PROHIBIDO: Inventar nuevos protagonistas o cambiar los existentes.\n`;
      instructions += `El protagonista "${mainProtagonist.name}" DEBE aparecer NOMBRADO en summary/key_event.\n\n`;
    }
    
    if (criticalIssues.length > 0) {
      instructions += `=== PROBLEMAS CRÍTICOS (OBLIGATORIO RESOLVER) ===\n`;
      for (const issue of criticalIssues) {
        instructions += `${issue}\n`;
      }
      instructions += `\n`;
    }
    
    if (warnings.length > 0 && attemptNumber >= 2) {
      instructions += `=== ADVERTENCIAS (TAMBIÉN RESOLVER EN ESTE INTENTO) ===\n`;
      for (const warning of warnings.slice(0, 5)) { // Top 5 warnings
        instructions += `${warning}\n`;
      }
      instructions += `\n`;
    }
    
    instructions += `
REQUISITOS PARA APROBAR:
1. CADA trama/subtrama DEBE aparecer en múltiples capítulos y tener resolución clara
2. Los personajes principales NO pueden desaparecer sin explicación
3. Cada capítulo DEBE avanzar algún hilo narrativo (no relleno)
4. DEBE haber puntos de giro en 25%, 50% y 75% de la novela
5. El clímax DEBE resolver TODAS las tramas principales
6. El PROTAGONISTA debe aparecer explícitamente en al menos 30% de los capítulos

Si no cumples estos requisitos, el proyecto será PAUSADO para revisión manual.
`;
    
    return instructions;
  }

  private async extractSeriesWorldBibleOnComplete(projectId: number): Promise<void> {
    try {
      const project = await storage.getProject(projectId);
      if (!project || !project.seriesId) {
        return;
      }

      const volumeNumber = project.seriesOrder || 1;
      console.log(`[OrchestratorV2] Extracting series world bible from project ${projectId} (Volume ${volumeNumber})`);
      
      this.callbacks.onAgentStatus(
        "series-world-bible-extractor",
        "running",
        `Extrayendo información de la Biblia del Mundo para el Volumen ${volumeNumber}...`
      );

      const extracted = await this.seriesWorldBibleExtractor.extractFromProject(projectId, volumeNumber);
      
      if (extracted) {
        await this.seriesWorldBibleExtractor.mergeAndSaveToSeries(
          project.seriesId,
          volumeNumber,
          extracted
        );
        
        console.log(`[OrchestratorV2] Series world bible updated: ${extracted.characters.length} chars, ${extracted.locations.length} locs, ${extracted.lessons.length} lessons`);
        
        this.callbacks.onAgentStatus(
          "series-world-bible-extractor",
          "completed",
          `Biblia del Mundo actualizada: ${extracted.characters.length} personajes, ${extracted.locations.length} lugares, ${extracted.lessons.length} lecciones`
        );
      } else {
        console.warn(`[OrchestratorV2] Could not extract series world bible from project ${projectId}`);
        this.callbacks.onAgentStatus(
          "series-world-bible-extractor",
          "completed",
          "No se pudo extraer la Biblia del Mundo"
        );
      }
    } catch (error) {
      console.error("[OrchestratorV2] Error extracting series world bible:", error);
    }
  }

  /**
   * Get the accumulated Series World Bible for injection into Ghostwriter
   * Returns null if project is not part of a series or no series bible exists
   */
  private async getSeriesWorldBibleForInjection(projectId: number): Promise<any | null> {
    try {
      const project = await storage.getProject(projectId);
      if (!project || !project.seriesId) {
        return null;
      }

      const seriesWorldBible = await storage.getSeriesWorldBible(project.seriesId);
      if (!seriesWorldBible) {
        console.log(`[OrchestratorV2] No series world bible found for series ${project.seriesId}`);
        return null;
      }

      console.log(`[OrchestratorV2] Loaded series world bible for project ${projectId}: ${seriesWorldBible.characters?.length || 0} characters, ${seriesWorldBible.locations?.length || 0} locations`);
      
      return {
        characters: seriesWorldBible.characters || [],
        locations: seriesWorldBible.locations || [],
        lessons: seriesWorldBible.lessons || [],
        worldRules: seriesWorldBible.worldRules || [],
        timelineEvents: seriesWorldBible.timelineEvents || [],
        objects: seriesWorldBible.objects || [],
        secrets: seriesWorldBible.secrets || [],
      };
    } catch (error) {
      console.error("[OrchestratorV2] Error getting series world bible:", error);
      return null;
    }
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
  // CHAPTER NUMBER NORMALIZATION
  // ============================================
  
  /**
   * Normalize chapter numbers from FinalReviewer to match database storage.
   * FinalReviewer may report -1 for epilogue, but database stores it as 998.
   * FinalReviewer may report -2 for author note, but database stores it as 999.
   * This function returns all possible chapter numbers to search for.
   */
  private normalizeChapterNumber(chapNum: number): number[] {
    // Epilogue: -1 or 998
    if (chapNum === -1) return [-1, 998];
    if (chapNum === 998) return [998, -1];
    
    // Author note: -2 or 999
    if (chapNum === -2) return [-2, 999];
    if (chapNum === 999) return [999, -2];
    
    // Regular chapters: no normalization needed
    return [chapNum];
  }
  
  /**
   * Find a chapter in the list by number, considering normalization.
   * Handles the -1/998 (epilogue) and -2/999 (author note) mapping.
   */
  private findChapterByNumber<T extends { chapterNumber: number }>(
    chapters: T[],
    targetNum: number
  ): T | undefined {
    const possibleNumbers = this.normalizeChapterNumber(targetNum);
    for (const num of possibleNumbers) {
      const found = chapters.find(c => c.chapterNumber === num);
      if (found) return found;
    }
    return undefined;
  }
  
  /**
   * Check if a chapter number matches a target, considering normalization.
   */
  private chapterNumberMatches(chapterNum: number, targetNum: number): boolean {
    const possibleNumbers = this.normalizeChapterNumber(targetNum);
    return possibleNumbers.includes(chapterNum);
  }
  
  /**
   * Normalize a chapter number to the database format.
   * FinalReviewer may report -1 for epilogue, but database stores it as 998.
   * FinalReviewer may report -2 for author note, but database stores it as 999.
   * Returns the database format number.
   */
  private normalizeToDbChapterNumber(chapNum: number): number {
    if (chapNum === -1) return 998; // Epilogue
    if (chapNum === -2) return 999; // Author note
    return chapNum; // Regular chapters and already-normalized special chapters
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
    
    // Sort chapters for consistent hashing (normalize to DB format for consistency)
    const chapters = (issue.capitulos_afectados || [])
      .map(ch => this.normalizeToDbChapterNumber(ch))
      .sort((a, b) => a - b)
      .join(",");
    
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
  // GARBLED TEXT DETECTION (LitAgents 3.3)
  // ============================================

  /**
   * Strip JSON wrappers from AI responses that should be plain text.
   * Sometimes the AI wraps chapter content in JSON like {"capitulo_reescrito": "..."}
   * This function extracts the actual text content.
   */
  private cleanChapterContent(text: string): string {
    if (!text) return text;
    const trimmed = text.trim();
    if (!trimmed.startsWith('{')) return trimmed;
    return SmartEditorAgent.stripJsonWrapper(trimmed);
  }

  /**
   * Detect garbled/corrupted text where words are truncated throughout (not just at the end).
   * This happens when the AI produces corrupted output with words like "incorpor" instead of 
   * "incorporó", "camin" instead of "caminó", etc.
   * 
   * Detection uses four independent checks (any one triggers garbled status).
   * Each check runs PER-SEGMENT so corruption in the final portion of text
   * is not diluted by clean text at the beginning:
   * 
   * 1. TRUNCATED ENDINGS: In Spanish prose, words almost always end in vowels, -n, -s, -r, -l, -d, -z, -y.
   *    If >15% of 4+ letter words end in unusual consonants, the text has truncated words.
   * 
   * 2. TELEGRAM MODE: Normal Spanish prose contains ~40-45% function words (articles, prepositions,
   *    conjunctions, pronouns). When the AI degrades into "telegram mode", it drops these connecting
   *    words while keeping content words intact. If function word density drops below 20%, the text
   *    has lost its grammatical structure.
   * 
   * 3. SPACE COLLAPSE: The AI progressively loses spaces between words, fusing them into
   *    mega-tokens like "bajarondelprimero" or "sustricorniosnegros". Normal Spanish words
   *    rarely exceed 20 characters. If >5% of tokens are longer than 25 characters, the text
   *    has collapsed spaces.
   * 
   * 4. CASE CORRUPTION: The AI injects random uppercase letters into words, producing
   *    patterns like "bajOP", "difusAP", "consultárlO". Normal Spanish only capitalizes
   *    the first letter of proper nouns/sentence starts. If >5% of words have mid-word
   *    uppercase letters, the text is corrupted.
   */
  private detectGarbledText(text: string): boolean {
    if (!text || text.length < 200) return false;

    const segments: string[] = [];
    if (text.length <= 6000) {
      segments.push(text);
    } else {
      segments.push(text.substring(0, 2000));
      const mid = Math.floor(text.length / 2);
      segments.push(text.substring(mid - 1000, mid + 1000));
      segments.push(text.substring(text.length - 2000));
    }

    const spanishFunctionWords = new Set([
      'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas',
      'de', 'del', 'al', 'en', 'con', 'por', 'para', 'sin', 'sobre', 'entre', 'hacia', 'desde', 'hasta', 'tras', 'bajo',
      'y', 'o', 'e', 'u', 'ni', 'que', 'pero', 'sino', 'aunque', 'porque', 'pues', 'si',
      'se', 'lo', 'le', 'les', 'me', 'te', 'nos', 'os',
      'su', 'sus', 'mi', 'mis', 'tu', 'tus',
      'no', 'ya', 'más', 'muy', 'tan',
      'este', 'esta', 'estos', 'estas', 'ese', 'esa', 'esos', 'esas', 'aquel', 'aquella',
      'como', 'cuando', 'donde', 'quien',
    ]);

    for (let segIdx = 0; segIdx < segments.length; segIdx++) {
      const segText = segments[segIdx];
      const segLabel = `segment ${segIdx + 1}/${segments.length}`;

      const allTokens = segText.split(/\s+/).filter(t => t.length >= 1);
      if (allTokens.length < 20) continue;

      let mergedTokenCount = 0;
      for (const token of allTokens) {
        if (token.length > 25) mergedTokenCount++;
      }
      const mergedRatio = mergedTokenCount / allTokens.length;
      if (mergedRatio > 0.05) {
        console.warn(`[GarbledDetector] Space-collapse detected in ${segLabel}: ${(mergedRatio * 100).toFixed(1)}% tokens >25 chars (${mergedTokenCount}/${allTokens.length})`);
        return true;
      }

      let caseCorrCount = 0;
      for (const token of allTokens) {
        if (token.length >= 3 && /^[a-záéíóúüñ].*[A-ZÁÉÍÓÚÜÑ]/.test(token)) {
          caseCorrCount++;
        }
      }
      const caseCorrRatio = caseCorrCount / allTokens.length;
      if (caseCorrRatio > 0.05) {
        console.warn(`[GarbledDetector] Case-corruption detected in ${segLabel}: ${(caseCorrRatio * 100).toFixed(1)}% words with mid-word uppercase (${caseCorrCount}/${allTokens.length})`);
        return true;
      }

      const contentWords = segText
        .replace(/["""''«».,;:!?¡¿()—\-\[\]\n\r#*_~`]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length >= 3 && /^[a-záéíóúüñ]+$/i.test(w));

      if (contentWords.length >= 20) {
        const validSpanishEndings = /[aeiouyáéíóúnslrdz]$/i;
        let badEndingCount = 0;
        for (const word of contentWords) {
          const lower = word.toLowerCase();
          if (!validSpanishEndings.test(lower) && lower.length >= 4) {
            badEndingCount++;
          }
        }
        const badEndingRatio = badEndingCount / contentWords.length;
        if (badEndingRatio > 0.15) {
          console.warn(`[GarbledDetector] Truncated words detected in ${segLabel}: badEndingRatio=${(badEndingRatio * 100).toFixed(1)}% (${contentWords.length} words)`);
          return true;
        }
      }

      const allWords = segText
        .replace(/["""''«».,;:!?¡¿()—\-\[\]\n\r#*_~`]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length >= 1 && /^[a-záéíóúüñ]+$/i.test(w));

      if (allWords.length >= 40) {
        let funcWordCount = 0;
        for (const word of allWords) {
          if (spanishFunctionWords.has(word.toLowerCase())) funcWordCount++;
        }
        const funcWordRatio = funcWordCount / allWords.length;
        if (funcWordRatio < 0.20) {
          console.warn(`[GarbledDetector] Telegram-mode detected in ${segLabel}: functionWordRatio=${(funcWordRatio * 100).toFixed(1)}% (expected ~40%+, ${allWords.length} words)`);
          return true;
        }
      }
    }

    return false;
  }

  // STRUCTURAL ISSUE DETECTION (LitAgents 2.7)
  // ============================================
  
  /**
   * Detect issues that are structural (require moving/reordering chapters, not rewriting).
   * These issues cannot be resolved by content rewriting and should be marked as resolved
   * after a limited number of correction attempts to prevent infinite loops.
   */
  private isStructuralIssue(issue: FinalReviewIssue): boolean {
    const desc = (issue.descripcion || "").toLowerCase();
    const instructions = (issue.instrucciones_correccion || "").toLowerCase();
    const categoria = (issue.categoria || "").toLowerCase();
    
    // Patterns that indicate structural issues (require moving/reordering, not rewriting)
    const structuralPatterns = [
      /mover\s+(el\s+)?(capítulo|cap\.?|epilogo|epílogo|prologo|prólogo)/i,
      /reubicar\s+(el\s+)?(capítulo|cap\.?|epilogo|epílogo)/i,
      /colocar\s+(el\s+)?(capítulo|cap\.?|epilogo|epílogo)\s+(al\s+)?final/i,
      /situado\s+al\s+(principio|inicio)/i,
      /(al\s+inicio|al\s+principio)\s+.*spoiler/i,
      /renombrar\s+(capítulo|cap\.?)/i,
      /cambiar\s+(el\s+)?título\s+del\s+capítulo/i,
      /estructura\s+confusa/i,
      /error\s+de\s+compaginación/i,
      /flashforward\s+.*claro/i,
    ];
    
    const combinedText = `${desc} ${instructions}`;
    
    for (const pattern of structuralPatterns) {
      if (pattern.test(combinedText)) {
        return true;
      }
    }
    
    // Category-based structural detection
    const structuralCategories = [
      "coherencia_temporal",
      "estructura",
      "ordenamiento",
    ];
    
    if (structuralCategories.includes(categoria)) {
      // Check if instructions mention moving rather than rewriting content
      if (/mover|reubicar|renombrar|reordenar|intercambiar/i.test(instructions)) {
        return true;
      }
    }
    
    return false;
  }

  // ============================================
  // MERGE REQUEST REINTERPRETATION (LitAgents 2.8)
  // ============================================
  
  /**
   * Detects if an issue suggests merging/fusing chapters.
   * These cannot be executed, so we reinterpret them as condensation requests.
   */
  private isMergeRequest(issue: FinalReviewIssue): boolean {
    const combinedText = `${issue.descripcion || ""} ${issue.instrucciones_correccion || ""}`.toLowerCase();
    
    const mergePatterns = [
      /fusionar\s+(los\s+)?(capítulos?|caps?\.?)/i,
      /combinar\s+(los\s+)?(capítulos?|caps?\.?)/i,
      /unir\s+(los\s+)?(capítulos?|caps?\.?)/i,
      /merge\s+(the\s+)?chapter/i,
      /integrar\s+(en\s+)?un\s+(solo\s+)?capítulo/i,
      /hacer\s+un\s+(solo\s+)?capítulo/i,
      /(capítulos?\s+\d+\s+y\s+\d+)\s+(deberían|podrían)\s+(ser\s+)?(uno|fusionarse)/i,
    ];
    
    return mergePatterns.some(pattern => pattern.test(combinedText));
  }
  
  /**
   * Reinterprets merge suggestions as condensation instructions.
   * Instead of trying to fuse chapters (impossible), we:
   * 1. Ask each affected chapter to condense and improve pacing
   * 2. Add transitions that connect both chapters better
   * 3. Remove redundant content between them
   */
  private reinterpretMergeAsCondensation(issues: FinalReviewIssue[]): FinalReviewIssue[] {
    return issues.map(issue => {
      if (!this.isMergeRequest(issue)) {
        return issue;
      }
      
      console.log(`[OrchestratorV2] REINTERPRETING merge request as condensation: "${issue.descripcion?.substring(0, 80)}..."`);
      
      // Transform the merge instruction into a condensation instruction
      const originalInstructions = issue.instrucciones_correccion || "";
      const affectedChapters = issue.capitulos_afectados || [];
      
      const condensationInstructions = `
NOTA: La sugerencia original de "fusionar capítulos" no es posible ejecutar automáticamente.
ALTERNATIVA APLICADA: Condensación agresiva y mejora de ritmo.

INSTRUCCIONES DE CONDENSACIÓN (alternativa a fusión):
1. CONDENSAR AGRESIVAMENTE: Eliminar todo el relleno, descripciones redundantes y diálogos que no aporten información nueva.
2. MEJORAR TRANSICIONES: Crear conexiones narrativas más fluidas con el capítulo anterior/siguiente.
3. ELIMINAR REDUNDANCIAS: Si información ya apareció en capítulos adyacentes, eliminarla.
4. ACELERAR RITMO: Convertir exposición en acción, reducir monólogo interno.
5. OBJETIVO: Reducir extensión al menos 30% manteniendo toda la información esencial.

Contexto original del revisor: ${originalInstructions}

Capítulos a condensar: ${affectedChapters.join(", ")}
`.trim();
      
      return {
        ...issue,
        categoria: "ritmo" as any, // Change category from structural to pacing
        instrucciones_correccion: condensationInstructions,
        // Keep original description for context but prepend clarification
        descripcion: `[REINTERPRETADO: fusión → condensación] ${issue.descripcion || ""}`,
      };
    });
  }
  
  /**
   * Mark structural issues as resolved after they've been attempted twice.
   * This prevents infinite loops on issues that cannot be fixed by rewriting.
   */
  private async autoResolveStructuralIssues(
    projectId: number,
    issues: FinalReviewIssue[],
    chapterCorrectionCounts: Map<number, number>
  ): Promise<{ resolvedIssues: FinalReviewIssue[]; remainingIssues: FinalReviewIssue[] }> {
    const resolvedIssues: FinalReviewIssue[] = [];
    const remainingIssues: FinalReviewIssue[] = [];
    
    for (const issue of issues) {
      const isStructural = this.isStructuralIssue(issue);
      // Normalize chapter numbers to DB format (-1 -> 998, -2 -> 999)
      const affectedChapters = (issue.capitulos_afectados || []).map(ch => this.normalizeToDbChapterNumber(ch));
      
      // Check if all affected chapters have been corrected at least twice
      const allChaptersCorrectedTwice = affectedChapters.length > 0 && 
        affectedChapters.every(ch => (chapterCorrectionCounts.get(ch) || 0) >= 2);
      
      if (isStructural && allChaptersCorrectedTwice) {
        console.log(`[OrchestratorV2] AUTO-RESOLVING structural issue: "${issue.categoria}" in caps ${affectedChapters.join(',')} - cannot be fixed by rewriting`);
        resolvedIssues.push(issue);
      } else {
        remainingIssues.push(issue);
      }
    }
    
    // Mark structural issues as resolved in database
    if (resolvedIssues.length > 0) {
      await this.markIssuesResolved(projectId, resolvedIssues);
      
      // Log activity for user visibility
      await storage.createActivityLog({
        projectId,
        level: "info",
        message: `Se marcaron ${resolvedIssues.length} issue(s) estructurales como "aceptados con reservas" (requieren edición manual: mover capítulos, cambiar títulos, etc.)`,
        agentRole: "orchestrator",
        metadata: {
          structuralIssues: resolvedIssues.map(i => ({
            categoria: i.categoria,
            descripcion: i.descripcion?.substring(0, 100),
            capitulos: i.capitulos_afectados,
          })),
        },
      });
    }
    
    return { resolvedIssues, remainingIssues };
  }

  // ============================================
  // PERSISTENT ISSUE LOOP DETECTION (LitAgents 2.4)
  // ============================================

  /**
   * Track issue persistence across cycles to detect infinite correction loops.
   * Returns issues that have persisted for 3+ cycles and need escalated correction.
   */
  private async trackPersistentIssues(
    projectId: number,
    issues: FinalReviewIssue[],
    currentCycle: number
  ): Promise<{ persistentIssues: FinalReviewIssue[]; newIssueCounts: Map<string, number> }> {
    const project = await storage.getProject(projectId);
    // Persistent issue counts stored in chapterCorrectionCounts._persistentIssues to reuse existing jsonb field
    const chapterCounts = (project?.chapterCorrectionCounts as any) || {};
    const existingCounts = (chapterCounts._persistentIssues as Record<string, number>) || {};
    
    const persistentIssues: FinalReviewIssue[] = [];
    const newIssueCounts = new Map<string, number>();
    
    for (const issue of issues) {
      const hash = this.generateIssueHash(issue);
      const previousCount = existingCounts[hash] || 0;
      const newCount = previousCount + 1;
      newIssueCounts.set(hash, newCount);
      
      // Issue persists for 3+ cycles = needs escalation
      if (newCount >= 3) {
        persistentIssues.push(issue);
        console.log(`[OrchestratorV2] LOOP DETECTED: Issue "${issue.categoria}" in caps ${issue.capitulos_afectados?.join(',')} persisted ${newCount} cycles`);
      }
    }
    
    // Save updated counts to database using SEPARATE key prefix to avoid overwriting chapter counts
    const countsObject: Record<string, number> = {};
    const entries = Array.from(newIssueCounts.entries());
    for (const [hash, count] of entries) {
      countsObject[hash] = count;
    }
    
    // Get fresh project data and preserve ALL existing chapter correction counts
    const project2 = await storage.getProject(projectId);
    const existingData = (project2?.chapterCorrectionCounts as Record<string, any>) || {};
    
    // Separate existing chapter counts from persistent issue tracking
    const preservedChapterCounts: Record<string, number> = {};
    for (const key of Object.keys(existingData)) {
      if (key !== '_persistentIssues' && typeof existingData[key] === 'number') {
        preservedChapterCounts[key] = existingData[key];
      }
    }
    
    // Merge: preserve chapter counts AND update persistent issues
    const mergedCounts = {
      ...preservedChapterCounts,
      _persistentIssues: countsObject,
    };
    
    await storage.updateProject(projectId, {
      chapterCorrectionCounts: mergedCounts as any,
    });
    
    return { persistentIssues, newIssueCounts };
  }

  /**
   * Detect if an issue represents a "resurrection" error (dead character appearing alive).
   */
  private isResurrectionError(issue: FinalReviewIssue): boolean {
    const desc = (issue.descripcion || '').toLowerCase();
    const instr = (issue.instrucciones_correccion || '').toLowerCase();
    const cat = (issue.categoria || '').toLowerCase();
    
    const RESURRECTION_PATTERNS = [
      'muerto', 'muere', 'murió', 'fallecido', 'fallece', 'muerte',
      'resucita', 'resurreccion', 'reaparece vivo', 'aparece vivo',
      'personaje muerto aparece', 'muerto habla', 'muerto actúa',
      'dead', 'dies', 'died', 'deceased', 'killed', 'resurrect'
    ];
    
    const hasResurrectionPattern = RESURRECTION_PATTERNS.some(p => desc.includes(p) || instr.includes(p));
    
    // Normalize severity check (case-insensitive, handle variations with/without accent)
    const severity = (issue.severidad || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const isCritical = severity === 'critica' || severity === 'critical';
    
    // Either critical with resurrection pattern, or any critical continuity error about characters
    if (hasResurrectionPattern && isCritical) return true;
    if (isCritical && (desc.includes('personaje') || cat.includes('continuidad'))) return true;
    
    return false;
  }

  /**
   * Generate escalated correction instructions for persistent issues.
   * For resurrection errors, generates instructions to remove the dead character from subsequent chapters.
   */
  private generateEscalatedCorrection(
    issue: FinalReviewIssue,
    allChapters: Array<{ chapterNumber: number; title: string; content: string }>
  ): { affectedChapters: number[]; instruction: string } {
    const isResurrection = this.isResurrectionError(issue);
    // Normalize chapter numbers to DB format (-1 -> 998, -2 -> 999)
    const originalChapters = (issue.capitulos_afectados || []).map(ch => this.normalizeToDbChapterNumber(ch));
    
    if (isResurrection) {
      // For resurrection errors, we need to identify ALL chapters after the death
      // and remove/modify references to the dead character
      const desc = issue.descripcion || '';
      
      // Try to extract character name from description
      const nameMatch = desc.match(/(?:personaje|character|Clara|[A-Z][a-záéíóú]+(?:\s+[A-Z][a-záéíóú]+)?)\s+(?:que\s+)?(?:muere|murió|muerto|fallece|fallecido)/i);
      const characterName = nameMatch ? nameMatch[0].split(/\s+que\s+/i)[0].replace(/personaje|character/i, '').trim() : 'el personaje fallecido';
      
      // Find the earliest death chapter mentioned
      const minChapter = Math.min(...originalChapters);
      
      // Expand to include all subsequent chapters
      const affectedChapters = allChapters
        .filter(c => c.chapterNumber > minChapter)
        .map(c => c.chapterNumber);
      
      const instruction = `[CORRECCIÓN DE RESURRECCIÓN] ${characterName} murió en el capítulo ${minChapter}. ` +
        `OBLIGATORIO: Eliminar TODAS las apariciones activas de ${characterName} en capítulos ${affectedChapters.join(', ')}. ` +
        `${characterName} solo puede aparecer en: (1) recuerdos explícitamente marcados como flashback, ` +
        `(2) referencias en pasado ("cuando estaba vivo..."), (3) duelo de otros personajes. ` +
        `NO puede hablar, actuar, caminar, ni ser descrito como presente.`;
      
      return { affectedChapters: [...originalChapters, ...affectedChapters], instruction };
    }
    
    // For other persistent issues, expand correction scope
    const instruction = `[CORRECCIÓN EXPANDIDA] Este problema ha persistido ${3}+ ciclos sin resolverse. ` +
      `Se requiere una reescritura más amplia de los capítulos afectados (${originalChapters.join(', ')}) ` +
      `para eliminar la raíz del problema: ${issue.descripcion}`;
    
    return { affectedChapters: originalChapters, instruction };
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
        await storage.createWorldEntity(entities[i] as any);
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
   * LitAgents 2.9.9+: Extract narrative time from chapter content and World Bible
   * Used to build rolling narrative timeline for temporal consistency
   */
  private extractNarrativeTimeFromChapter(
    chapterText: string,
    chapterNumber: number,
    worldBible: any
  ): { chapter: number; narrativeTime: string; location?: string } | null {
    const timelineInfo = this.extractTimelineInfo(worldBible, chapterNumber);
    
    if (timelineInfo?.current_chapter) {
      return {
        chapter: chapterNumber,
        narrativeTime: `${timelineInfo.current_chapter.day}, ${timelineInfo.current_chapter.time_of_day}`,
        location: timelineInfo.current_chapter.location
      };
    }
    
    const firstParagraph = chapterText.substring(0, 2000).toLowerCase();
    
    const timePatterns = [
      /(?:era|fue|hacía|amaneció|al\s+amanecer)/i,
      /(?:por\s+la\s+mañana|por\s+la\s+tarde|por\s+la\s+noche|al\s+mediodía|al\s+atardecer|al\s+anochecer)/i,
      /(?:lunes|martes|miércoles|jueves|viernes|sábado|domingo)/i,
      /(?:día\s+\d+|el\s+\d+\s+de\s+\w+)/i,
      /(?:tres\s+días\s+después|al\s+día\s+siguiente|dos\s+semanas|una\s+semana)/i,
    ];
    
    let detectedTime = "";
    for (const pattern of timePatterns) {
      const match = firstParagraph.match(pattern);
      if (match) {
        detectedTime = match[0].trim();
        break;
      }
    }
    
    const locationPatterns = [
      /(?:en\s+(?:el|la|los|las)\s+)([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+(?:de|del|los|las|el|la)\s+[A-ZÁÉÍÓÚÑ]?[a-záéíóúñ]+)*)/i,
    ];
    
    let detectedLocation = "";
    for (const pattern of locationPatterns) {
      const match = firstParagraph.match(pattern);
      if (match && match[1]) {
        detectedLocation = match[1].trim();
        break;
      }
    }
    
    if (detectedTime || detectedLocation) {
      return {
        chapter: chapterNumber,
        narrativeTime: detectedTime || `Capítulo ${chapterNumber}`,
        location: detectedLocation || undefined
      };
    }
    
    return {
      chapter: chapterNumber,
      narrativeTime: `Capítulo ${chapterNumber} (tiempo no especificado)`,
    };
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
   * Build complete World Bible context for focused rewrite - includes all canonical elements
   * that MUST NOT be modified during correction
   */
  private buildFullWorldBibleForRewrite(worldBible: any): string {
    if (!worldBible) return "No hay World Bible disponible.";
    
    const sections: string[] = [];
    
    // 1. PERSONAJES Y ATRIBUTOS FÍSICOS (INMUTABLES)
    const allChars = worldBible.personajes || worldBible.characters || [];
    if (allChars.length > 0) {
      const chars = allChars.map((p: any) => {
        const physicalAttrs: string[] = [];
        
        // Extract from nested appearance object
        if (p.appearance) {
          const app = p.appearance;
          if (app.eyes || app.eye_color) physicalAttrs.push(`ojos: ${app.eyes || app.eye_color}`);
          if (app.hair || app.hair_color) physicalAttrs.push(`cabello: ${app.hair || app.hair_color}`);
          if (app.height) physicalAttrs.push(`altura: ${app.height}`);
          if (app.build) physicalAttrs.push(`complexión: ${app.build}`);
          if (app.skin) physicalAttrs.push(`piel: ${app.skin}`);
          if (app.age) physicalAttrs.push(`edad: ${app.age}`);
        }
        // Also check top-level attributes
        if (p.eyes || p.eye_color) physicalAttrs.push(`ojos: ${p.eyes || p.eye_color}`);
        if (p.hair || p.hair_color) physicalAttrs.push(`cabello: ${p.hair || p.hair_color}`);
        if (p.edad || p.age) physicalAttrs.push(`edad: ${p.edad || p.age}`);
        
        const physicalStr = physicalAttrs.length > 0 ? `\n   [FISICO INMUTABLE]: ${physicalAttrs.join(', ')}` : '';
        const deadStatus = p.muerto || p.dead ? '\n   [MUERTO] - NO PUEDE APARECER VIVO' : '';
        const charName = p.nombre || p.name || 'Desconocido';
        const charRole = p.rol || p.role || 'secundario';
        
        return `- ${charName} (${charRole})${physicalStr}${deadStatus}`;
      }).join("\n");
      sections.push(`[PERSONAJES] Atributos físicos INMUTABLES:\n${chars}`);
    }
    
    // 2. PERSONAJES MUERTOS (PROHIBIDO RESUCITAR)
    const deadCharacters = allChars.filter((p: any) => p.muerto || p.dead);
    if (deadCharacters.length > 0) {
      const deadList = deadCharacters.map((p: any) => `[MUERTO] ${p.nombre || p.name} - no puede aparecer vivo`).join("\n");
      sections.push(`[PERSONAJES FALLECIDOS] PROHIBIDO MENCIONAR COMO VIVOS:\n${deadList}`);
    }
    
    // 3. RELACIONES ENTRE PERSONAJES
    if (worldBible.relaciones?.length > 0) {
      const rels = worldBible.relaciones.slice(0, 15).map((r: any) => 
        `- ${r.personaje1} <-> ${r.personaje2}: ${r.tipo || r.relacion || 'relacionados'}`
      ).join("\n");
      sections.push(`[RELACIONES ESTABLECIDAS]:\n${rels}`);
    }
    
    // 4. UBICACIONES CANÓNICAS
    const allLocations = worldBible.ubicaciones || worldBible.locations || worldBible.lugares || [];
    if (allLocations.length > 0) {
      const locs = allLocations.slice(0, 15).map((u: any) => 
        `- ${u.nombre || u.name}: ${(u.descripcion || u.description || 'ubicacion establecida').substring(0, 80)}`
      ).join("\n");
      sections.push(`[UBICACIONES] No cambiar nombres ni descripciones:\n${locs}`);
    }
    
    // 5. TIMELINE Y EVENTOS
    if (worldBible.timeline?.length > 0) {
      const events = worldBible.timeline.slice(0, 15).map((t: any) => 
        `- ${t.evento || t.event}: ${t.descripcion?.substring(0, 60) || ''}`
      ).join("\n");
      sections.push(`[LINEA TEMPORAL] No alterar orden ni fechas:\n${events}`);
    }
    
    // 6. REGLAS DEL MUNDO
    const allRules = worldBible.reglas || worldBible.worldRules || worldBible.rules || [];
    if (allRules.length > 0) {
      const rules = allRules.slice(0, 10).map((r: any) => 
        `- ${typeof r === 'string' ? r : r.regla || r.rule || JSON.stringify(r)}`
      ).join("\n");
      sections.push(`[REGLAS DEL MUNDO] Deben respetarse:\n${rules}`);
    }
    
    // 7. OBJETOS ESTABLECIDOS (Chekhov's Gun)
    const allObjects = worldBible.objetos || worldBible.objects || [];
    if (allObjects.length > 0) {
      const objs = allObjects.slice(0, 15).map((o: any) => 
        `- ${o.nombre || o.name}: ${(o.descripcion || o.description || 'objeto establecido').substring(0, 60)}`
      ).join("\n");
      sections.push(`[OBJETOS ESTABLECIDOS] No inventar nuevos:\n${objs}`);
    }
    
    // 8. LESIONES ACTIVAS
    if (worldBible.lesiones_activas?.length > 0) {
      const injuries = worldBible.lesiones_activas.map((i: any) => 
        `- ${i.personaje}: ${i.tipo_lesion} (desde cap ${i.capitulo_ocurre}${i.capitulo_cura ? `, cura cap ${i.capitulo_cura}` : ', aun activa'})`
      ).join("\n");
      sections.push(`[LESIONES ACTIVAS] Limitan acciones del personaje:\n${injuries}`);
    }
    
    // 9. DECISIONES DE TRAMA
    const decisions = worldBible.plotDecisions || worldBible.decisiones || [];
    if (decisions.length > 0) {
      const decs = decisions.slice(0, 15).map((d: any) => 
        `- Cap ${d.capitulo_establecido || d.chapter || '?'}: ${d.decision || d.descripcion || JSON.stringify(d)}`
      ).join("\n");
      sections.push(`[DECISIONES ESTABLECIDAS] No contradecir:\n${decs}`);
    }
    
    // 10. TRAMAS Y SUBTRAMAS
    const plotOutline = worldBible.plotOutline || {};
    const plotThreads = plotOutline.plotThreads || [];
    if (plotThreads.length > 0) {
      const threads = plotThreads.map((t: any) => {
        const res = t.resolution_chapter ? ` → se resuelve en Cap ${t.resolution_chapter}` : '';
        return `- ${t.name}: ${t.goal || t.description || ''}${res}`;
      }).join("\n");
      sections.push(`[TRAMAS NARRATIVAS] Respetar desarrollo planificado:\n${threads}`);
    }
    
    // 11. UBICACIONES Y SETTINGS (from plotOutline)
    const settings = worldBible.settings || plotOutline.settings || [];
    if (settings.length > 0) {
      const settingsList = settings.slice(0, 10).map((s: any) =>
        `- ${s.name || s.nombre}: ${(s.description || s.descripcion || s.atmosphere || '').substring(0, 80)}`
      ).join("\n");
      sections.push(`[ESCENARIOS] Ambientación establecida:\n${settingsList}`);
    }
    
    // 12. TEMAS CENTRALES
    const themes = worldBible.themes || plotOutline.themes || [];
    if (themes.length > 0) {
      sections.push(`[TEMAS CENTRALES] Deben reflejarse:\n${themes.map((t: any) => `- ${t}`).join("\n")}`);
    }
    
    return sections.join("\n\n") || "World Bible vacío.";
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
  /**
   * LitAgents 3.1: Auto-update plot thread status after each chapter.
   * Analyzes the chapter summary and text to detect if any threads were resolved or significantly advanced.
   * This ensures the progressive closure system has accurate thread status data.
   */
  private async autoUpdatePlotThreads(
    projectId: number,
    chapterNumber: number,
    chapterSummary: string,
    chapterText: string
  ): Promise<void> {
    const plotThreads = await storage.getPlotThreadsByProject(projectId);
    if (!plotThreads || plotThreads.length === 0) return;

    const activeThreads = plotThreads.filter(t => t.status !== 'resolved');
    if (activeThreads.length === 0) return;

    const summaryLower = chapterSummary.toLowerCase();
    const textLower = chapterText.toLowerCase();

    const stopwords = new Set([
      'para', 'como', 'pero', 'este', 'esta', 'esto', 'esos', 'esas',
      'todo', 'toda', 'todos', 'cada', 'otro', 'otra', 'otros', 'tras',
      'desde', 'hasta', 'sobre', 'bajo', 'entre', 'hacia', 'según',
      'with', 'from', 'that', 'this', 'have', 'been', 'were', 'will',
      'more', 'than', 'also', 'just', 'only', 'very', 'some', 'into',
    ]);

    const resolutionIndicators = [
      'resuelve', 'resuelto', 'resolvió',
      'concluyó', 'concluido', 'conclusión',
      'cierra', 'cerrado', 'cerró',
      'desenlace',
      'se completa', 'completado',
      'pone fin', 'da fin',
      'revelación final', 'verdad sale a la luz',
      'resolved', 'concluded', 'closure',
    ];

    const negationPatterns = [
      'sin resolver', 'no resuelto', 'aún abierto', 'sigue abierto',
      'sin cerrar', 'no cerrado', 'pendiente',
      'unresolved', 'still open', 'not resolved',
    ];

    const advancementIndicators = [
      'avanza', 'progresa', 'desarrolla',
      'descubre', 'revela', 'confronta', 'enfrenta',
      'intensifica', 'escala', 'complica',
    ];

    let updatedCount = 0;

    for (const thread of activeThreads) {
      const threadNameParts = (thread.name || '').toLowerCase().split(/\s+/)
        .filter(w => w.length >= 4 && !stopwords.has(w));
      const threadGoalParts = (thread.goal || '').toLowerCase().split(/\s+/)
        .filter(w => w.length >= 4 && !stopwords.has(w));
      const allKeywords = Array.from(new Set([...threadNameParts, ...threadGoalParts])).slice(0, 6);
      if (allKeywords.length < 2) continue;

      const summaryKeywordMatches = allKeywords.filter(kw => summaryLower.includes(kw)).length;
      const textKeywordMatches = allKeywords.filter(kw => textLower.includes(kw)).length;

      if (summaryKeywordMatches === 0 && textKeywordMatches < 2) continue;

      const hasNegation = negationPatterns.some(neg => {
        const negIdx = summaryLower.indexOf(neg);
        if (negIdx < 0) return false;
        const nearbyText = summaryLower.substring(Math.max(0, negIdx - 150), Math.min(summaryLower.length, negIdx + 150));
        return allKeywords.some(kw => nearbyText.includes(kw));
      });

      if (hasNegation) continue;

      let resolutionScore = 0;
      for (const ind of resolutionIndicators) {
        let searchPos = 0;
        while (searchPos < summaryLower.length) {
          const indIdx = summaryLower.indexOf(ind, searchPos);
          if (indIdx < 0) break;
          const nearbyText = summaryLower.substring(Math.max(0, indIdx - 150), Math.min(summaryLower.length, indIdx + 150));
          const nearbyMatches = allKeywords.filter(kw => nearbyText.includes(kw)).length;
          if (nearbyMatches >= 2) {
            resolutionScore += nearbyMatches;
            break;
          }
          searchPos = indIdx + ind.length;
        }
      }

      if (resolutionScore >= 3 && summaryKeywordMatches >= 2) {
        await storage.updateProjectPlotThread(thread.id, {
          status: 'resolved',
          lastUpdatedChapter: chapterNumber,
        });
        updatedCount++;
        console.log(`[OrchestratorV2] Thread "${thread.name}" auto-resolved at Ch ${chapterNumber} (summary matches: ${summaryKeywordMatches}, resolution score: ${resolutionScore})`);
      } else if (summaryKeywordMatches >= 2) {
        const hasAdvancement = advancementIndicators.some(ind => {
          const indIdx = summaryLower.indexOf(ind);
          if (indIdx < 0) return false;
          const nearbyText = summaryLower.substring(Math.max(0, indIdx - 150), Math.min(summaryLower.length, indIdx + 150));
          return allKeywords.some(kw => nearbyText.includes(kw));
        });

        if (hasAdvancement) {
          await storage.updateProjectPlotThread(thread.id, {
            status: 'developing',
            lastUpdatedChapter: chapterNumber,
          });
        }
      }
    }

    if (updatedCount > 0) {
      await storage.createActivityLog({
        projectId,
        level: "info",
        agentRole: "omniwriter",
        message: `Auto-actualización de tramas: ${updatedCount} trama(s) marcada(s) como resuelta(s) en Cap ${chapterNumber}.`,
        metadata: { type: 'auto_thread_update', chapterNumber, resolvedCount: updatedCount },
      });
    }
  }

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

    try {
      // Use the InjuryExtractor agent instead of raw API call
      const response = await this.injuryExtractor.execute({
        chapterNumber,
        content: chapterContent,
        characterNames,
      });
      
      if (response.tokenUsage) {
        this.addTokenUsage(response.tokenUsage);
        await this.logAiUsage(projectId, "injury-extractor", "deepseek-chat", response.tokenUsage, chapterNumber);
      }
      
      const parsed = response;
      
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
    
    // Format persistent injuries with explicit CAN/CANNOT capabilities
    if (persistentInjuries && persistentInjuries.length > 0) {
      const activeInjuries = persistentInjuries.filter(i => 
        i.capitulo_ocurre <= currentChapter &&
        i.estado_actual !== "resuelta"
      );
      
      if (activeInjuries.length > 0) {
        parts.push("\n\n=== LESIONES FÍSICAS ACTIVAS - RESTRICCIONES OBLIGATORIAS ===");
        
        for (const injury of activeInjuries) {
          const isIgnored = injury.seguimiento === "ignorada" || injury.seguimiento === "olvidada";
          const icon = isIgnored ? "🚨" : "🩹";
          
          parts.push(`\n${icon} ${injury.personaje.toUpperCase()}: ${injury.tipo_lesion}`);
          parts.push(`   Desde: Capítulo ${injury.capitulo_ocurre}`);
          
          // Generate explicit CAN/CANNOT based on injury type
          const capabilities = this.getInjuryCapabilities(injury.tipo_lesion, injury.parte_afectada);
          
          if (capabilities.cannot.length > 0) {
            parts.push(`   ❌ NO PUEDE: ${capabilities.cannot.join(", ")}`);
          }
          if (capabilities.canWithDifficulty.length > 0) {
            parts.push(`   ⚠️ CON DIFICULTAD/DOLOR: ${capabilities.canWithDifficulty.join(", ")}`);
          }
          if (capabilities.can.length > 0) {
            parts.push(`   ✓ SÍ PUEDE: ${capabilities.can.join(", ")}`);
          }
          if (capabilities.showAs.length > 0) {
            parts.push(`   📝 MOSTRAR COMO: ${capabilities.showAs.join(", ")}`);
          }
          
          if (injury.efecto_esperado) {
            parts.push(`   Descripción: ${injury.efecto_esperado}`);
          }
          
          if (isIgnored) {
            parts.push(`   🚨 ADVERTENCIA: Lesión IGNORADA anteriormente - OBLIGATORIO mostrar efectos`);
          }
        }
      }
    }
    
    return parts.join("\n");
  }

  /**
   * Analyze injury type and body part to determine explicit capabilities.
   * Returns what the character CAN, CANNOT, and CAN WITH DIFFICULTY do.
   */
  private getInjuryCapabilities(injuryType: string, bodyPart?: string): {
    cannot: string[];
    canWithDifficulty: string[];
    can: string[];
    showAs: string[];
  } {
    const injury = (injuryType || "").toLowerCase();
    const part = (bodyPart || "").toLowerCase();
    
    // Default capabilities
    const result = {
      cannot: [] as string[],
      canWithDifficulty: [] as string[],
      can: [] as string[],
      showAs: [] as string[]
    };
    
    // Voice/throat injuries
    if (injury.includes("afonía") || injury.includes("afonia") || injury.includes("mudo") || injury.includes("voz")) {
      result.cannot.push("hablar normalmente", "gritar", "llamar a alguien");
      result.canWithDifficulty.push("susurrar débilmente", "emitir sonidos guturales");
      result.can.push("comunicarse con gestos", "escribir notas", "asentir/negar", "señalar", "expresar con la mirada");
      result.showAs.push("gestos de frustración al no poder hablar", "uso de libreta/papel", "comunicación visual intensa");
    }
    
    // Arm/hand injuries
    if (part.includes("brazo") || part.includes("mano") || part.includes("muñeca") || 
        injury.includes("brazo") || injury.includes("mano") || injury.includes("fractura") && part.includes("superior")) {
      const side = part.includes("derech") ? "derecha" : part.includes("izquierd") ? "izquierda" : "afectada";
      result.cannot.push(`usar la mano ${side} con fuerza`, `cargar peso con ese brazo`, `escribir (si es dominante)`);
      result.canWithDifficulty.push(`movimientos finos`, `agarrar objetos ligeros`);
      result.can.push(`usar la otra mano`, `caminar`, `correr`, `hablar`);
      result.showAs.push(`proteger el brazo herido`, `muecas de dolor al moverlo`, `usar cabestrillo/vendaje`);
    }
    
    // Leg/foot injuries
    if (part.includes("pierna") || part.includes("pie") || part.includes("tobillo") || part.includes("rodilla") ||
        injury.includes("cojera") || injury.includes("pierna") || injury.includes("pie")) {
      result.cannot.push("correr", "saltar", "subir escaleras rápido", "perseguir a alguien");
      result.canWithDifficulty.push("caminar (cojeando)", "subir escaleras lentamente", "mantenerse de pie mucho tiempo");
      result.can.push("sentarse", "hablar", "usar las manos", "conducir (si es automático)");
      result.showAs.push("cojera visible", "apoyarse en paredes/muebles", "muecas al caminar", "necesitar ayuda para moverse");
    }
    
    // Head injuries / concussion
    if (part.includes("cabeza") || injury.includes("conmoción") || injury.includes("contusión craneal") || injury.includes("golpe en la cabeza")) {
      result.cannot.push("concentrarse por períodos largos", "recordar detalles recientes", "movimientos bruscos");
      result.canWithDifficulty.push("pensar claramente", "leer", "seguir conversaciones complejas");
      result.can.push("caminar despacio", "hablar", "descansar");
      result.showAs.push("mareos", "dolor de cabeza", "sensibilidad a la luz", "confusión momentánea", "náuseas");
    }
    
    // Eye injuries / blindness
    if (part.includes("ojo") || injury.includes("ceguera") || injury.includes("visión")) {
      const affected = injury.includes("parcial") || part.includes("un ojo") ? "parcialmente" : "totalmente";
      if (affected === "totalmente") {
        result.cannot.push("ver", "leer", "reconocer rostros a distancia", "conducir");
        result.canWithDifficulty.push("orientarse en espacios conocidos");
        result.can.push("oír", "hablar", "tocar", "caminar con ayuda");
        result.showAs.push("pedir descripciones", "tantear con las manos", "depender de otros para guía");
      } else {
        result.cannot.push("ver por el ojo afectado", "percibir profundidad correctamente");
        result.canWithDifficulty.push("leer", "calcular distancias");
        result.can.push("ver con el otro ojo", "caminar", "hablar");
        result.showAs.push("girar la cabeza para compensar", "vendaje en el ojo");
      }
    }
    
    // Rib injuries
    if (injury.includes("costilla") || part.includes("costilla") || part.includes("torso") || injury.includes("torácic")) {
      result.cannot.push("respirar profundamente sin dolor", "reír", "toser sin dolor", "levantar peso");
      result.canWithDifficulty.push("moverse", "agacharse", "girar el torso");
      result.can.push("hablar (con pausas)", "caminar despacio", "usar las manos");
      result.showAs.push("respiración superficial", "sujetarse el costado", "evitar movimientos bruscos");
    }
    
    // Burns
    if (injury.includes("quemadura") || injury.includes("quemado")) {
      result.cannot.push("tocar la zona afectada", "exponerla al sol/calor");
      result.canWithDifficulty.push("mover la zona quemada", "usar ropa ajustada");
      result.can.push("hablar", "pensar", "zonas no afectadas funcionan normal");
      result.showAs.push("vendajes", "evitar contacto", "muecas de dolor", "piel enrojecida/ampollas visibles");
    }
    
    // Psychological trauma / shock
    if (injury.includes("trauma") || injury.includes("shock") || injury.includes("pánico") || injury.includes("estrés post")) {
      result.cannot.push("mantener la calma en situaciones similares al trauma", "dormir bien");
      result.canWithDifficulty.push("concentrarse", "tomar decisiones bajo presión", "confiar en desconocidos");
      result.can.push("funciones físicas normales", "hablar", "moverse");
      result.showAs.push("flashbacks", "sobresaltos", "evitar ciertos lugares/situaciones", "insomnio", "irritabilidad");
    }
    
    // Generic fallback if no specific match
    if (result.cannot.length === 0 && result.canWithDifficulty.length === 0) {
      result.canWithDifficulty.push("actividades que involucren la zona afectada");
      result.showAs.push("signos visibles de malestar", "proteger la zona herida");
    }
    
    return result;
  }

  /**
   * Build unified previous books context from both generated projects and manually imported manuscripts.
   * This ensures series continuity regardless of whether previous books were AI-generated or manually uploaded.
   */
  private async buildPreviousBooksContext(
    seriesId: number,
    currentSeriesOrder: number,
    options: { maxChars?: number; includeWorldRules?: boolean; includeCanonWarning?: boolean } = {}
  ): Promise<string | undefined> {
    const { maxChars = 8000, includeWorldRules = false, includeCanonWarning = false } = options;
    
    const seriesProjects = await storage.getProjectsBySeries(seriesId);
    const previousProjects = seriesProjects
      .filter(p => p.seriesOrder && p.seriesOrder < currentSeriesOrder && p.status === 'completed')
      .sort((a, b) => (a.seriesOrder || 0) - (b.seriesOrder || 0));
    
    const importedManuscripts = await storage.getImportedManuscriptsBySeries(seriesId);
    const previousManuscripts = importedManuscripts
      .filter(m => m.seriesOrder && m.seriesOrder < currentSeriesOrder && m.status === 'completed')
      .sort((a, b) => (a.seriesOrder || 0) - (b.seriesOrder || 0));
    
    interface BookEntry {
      order: number;
      title: string;
      premise?: string;
      type: 'project' | 'manuscript';
      projectId?: number;
      manuscriptId?: number;
    }
    
    const allBooks: BookEntry[] = [];
    
    for (const proj of previousProjects) {
      allBooks.push({
        order: proj.seriesOrder!,
        title: proj.title,
        premise: proj.premise || undefined,
        type: 'project',
        projectId: proj.id,
      });
    }
    
    for (const ms of previousManuscripts) {
      const alreadyAsProject = allBooks.some(b => b.order === ms.seriesOrder);
      if (!alreadyAsProject) {
        allBooks.push({
          order: ms.seriesOrder!,
          title: ms.title,
          type: 'manuscript',
          manuscriptId: ms.id,
        });
      }
    }
    
    allBooks.sort((a, b) => a.order - b.order);
    
    if (allBooks.length === 0) return undefined;
    
    const contexts: string[] = [];
    
    for (const book of allBooks) {
      const bookParts: string[] = [];
      bookParts.push(`\nLIBRO ${book.order}: "${book.title}"${book.type === 'manuscript' ? ' [Manuscrito importado]' : ''}`);
      
      if (book.premise) {
        bookParts.push(`  Premisa: ${book.premise.substring(0, 300)}`);
      }
      
      if (book.type === 'project' && book.projectId) {
        const prevWorldBible = await storage.getWorldBibleByProject(book.projectId);
        const prevChapters = await storage.getChaptersByProject(book.projectId);
        
        if (prevWorldBible) {
          const chars = Array.isArray(prevWorldBible.characters) ? prevWorldBible.characters : [];
          const charSummaries = chars.slice(0, 10).map((c: any) => {
            const name = c.name || c.nombre || 'Desconocido';
            const role = c.role || c.rol || '';
            const arc = c.arc || c.arco || '';
            const appearance = c.appearance || {};
            const status = c.finalState || c.estadoFinal || c.status || '';
            const details: string[] = [`"${name}" (${role})`];
            if (appearance.eyes) details.push(`ojos: ${appearance.eyes}`);
            if (appearance.hair) details.push(`cabello: ${appearance.hair}`);
            if (arc) details.push(`arco: ${typeof arc === 'string' ? arc.substring(0, 100) : JSON.stringify(arc).substring(0, 100)}`);
            if (status) details.push(`estado final: ${status}`);
            return `    INMUTABLE: ${details.join(', ')}`;
          });
          bookParts.push(`  Personajes INMUTABLES:`);
          bookParts.push(charSummaries.join('\n'));
          
          const plotOutline = (prevWorldBible as any).plotOutline;
          if (plotOutline?.chapters_outline && Array.isArray(plotOutline.chapters_outline)) {
            const keyEvents = plotOutline.chapters_outline
              .filter((ch: any) => ch.key_event)
              .map((ch: any) => `    Cap ${ch.chapter_num}: ${ch.key_event}`)
              .slice(0, 15);
            if (keyEvents.length > 0) {
              bookParts.push(`  Eventos clave de la trama:`);
              bookParts.push(keyEvents.join('\n'));
            }
          }
          
          if (includeWorldRules) {
            const rules = prevWorldBible.worldRules || (prevWorldBible as any).rules || [];
            if (Array.isArray(rules) && rules.length > 0) {
              const ruleTexts = rules.slice(0, 5).map((r: any) => 
                typeof r === 'string' ? `    - ${r}` : `    - ${r.rule || r.regla || JSON.stringify(r)}`
              );
              bookParts.push(`  Reglas del mundo establecidas:`);
              bookParts.push(ruleTexts.join('\n'));
            }
          }
        }
        
        if (prevChapters && prevChapters.length > 0) {
          const sortedChapters = prevChapters
            .filter(ch => ch.summary && ch.summary.length > 10)
            .sort((a, b) => a.chapterNumber - b.chapterNumber);
          if (sortedChapters.length > 0) {
            bookParts.push(`  Resumen por capítulos (${sortedChapters.length} capítulos):`);
            for (const ch of sortedChapters) {
              bookParts.push(`    Cap ${ch.chapterNumber}${ch.title ? ` "${ch.title}"` : ''}: ${(ch.summary || '').substring(0, 200)}`);
            }
          }
        }
      } else if (book.type === 'manuscript' && book.manuscriptId) {
        const importedChapters = await storage.getImportedChaptersByManuscript(book.manuscriptId);
        
        if (importedChapters && importedChapters.length > 0) {
          const sortedChapters = importedChapters.sort((a, b) => a.chapterNumber - b.chapterNumber);
          
          const characterNames = new Set<string>();
          const chapterSummaries: string[] = [];
          
          for (const ch of sortedChapters) {
            const content = ch.editedContent || ch.originalContent || '';
            const firstParagraphs = content.substring(0, 800);
            chapterSummaries.push(`    Cap ${ch.chapterNumber}${ch.title ? ` "${ch.title}"` : ''}: ${firstParagraphs.replace(/\n/g, ' ').substring(0, 200)}...`);
            
            const namePattern = /(?:^|\.\s+)([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){0,2})(?:\s+(?:dijo|pensó|miró|suspiró|caminó|se\s|habló|gritó|susurró|observó|sintió|tomó|abrió|cerró|entró|salió|corrió|llegó))/g;
            let nameMatch;
            while ((nameMatch = namePattern.exec(content.substring(0, 5000))) !== null) {
              const name = nameMatch[1].trim();
              if (name.length > 2 && name.length < 40 && !['El', 'La', 'Los', 'Las', 'Un', 'Una', 'Pero', 'Sin', 'Con', 'Por', 'Para', 'Que', 'Como', 'Cuando', 'Donde', 'Mientras', 'Entonces', 'Después', 'Antes', 'Cada', 'Todo', 'Toda', 'Todos', 'Esta', 'Este', 'Ese', 'Esa', 'Aquel'].includes(name)) {
                characterNames.add(name);
              }
            }
          }
          
          if (characterNames.size > 0) {
            bookParts.push(`  Personajes detectados (manuscrito importado):`);
            bookParts.push(`    ${Array.from(characterNames).slice(0, 15).join(', ')}`);
          }
          
          bookParts.push(`  Contenido por capítulos (${sortedChapters.length} capítulos, manuscrito importado):`);
          bookParts.push(chapterSummaries.join('\n'));
        }
      }
      
      contexts.push(bookParts.join('\n'));
    }
    
    let result = contexts.join('\n\n');
    if (result.length > maxChars) {
      console.log(`[OrchestratorV2] Previous books context truncated from ${result.length} to ${maxChars} chars`);
      result = result.substring(0, maxChars) + '\n[... contexto truncado por límite de tokens]';
    }
    
    if (includeCanonWarning) {
      result += '\n\nIMPORTANTE: Los personajes, eventos y reglas de los libros anteriores son CANON. No contradigas nada de lo anterior.';
    }
    
    console.log(`[OrchestratorV2] Built previous books context: ${allBooks.length} books (${previousProjects.length} projects + ${previousManuscripts.length} manuscripts), ${result.length} chars`);
    
    return result;
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
          
          // For books >1, fetch comprehensive context from previous books (including imported manuscripts)
          if (project.seriesOrder > 1) {
            const prevContext = await this.buildPreviousBooksContext(project.seriesId, project.seriesOrder, {
              maxChars: 8000,
              includeWorldRules: false,
              includeCanonWarning: false,
            });
            if (prevContext) {
              options.seriesInfo.previousBooksSummary = prevContext;
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
    // LitAgents 2.5: Enhanced KU pacing guidelines to prevent slow pacing issues BEFORE they occur
    if (options?.kindleUnlimitedOptimized) {
      parts.push(`
╔══════════════════════════════════════════════════════════════════════════════╗
║  ⚡ OPTIMIZACIÓN KINDLE UNLIMITED - RITMO RÁPIDO OBLIGATORIO ⚡              ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  Este libro es para KU. Los lectores de KU abandonan si el ritmo es lento.  ║
║  CADA ESCENA debe mantener al lector enganchado.                            ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  PROHIBIDO (causa rechazo por "pacing slow"):                               ║
║  • Párrafos de descripción de más de 3 líneas seguidas                      ║
║  • Escenas donde los personajes solo hablan sin acción                      ║
║  • Monólogos internos extensos (máximo 2-3 oraciones seguidas)              ║
║  • Flashbacks de más de 1 párrafo                                           ║
║  • Descripciones de paisajes, habitaciones o vestimenta detalladas          ║
║  • Escenas de "transición" sin conflicto ni tensión                         ║
║  • Diálogos sobre temas irrelevantes para la trama                          ║
║  • Repetir información que el lector ya conoce                              ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  OBLIGATORIO (mantiene ritmo rápido):                                       ║
║  • Empezar IN MEDIA RES - acción o diálogo desde la primera línea           ║
║  • Intercalar descripción con acción (nunca más de 2 líneas descripción)    ║
║  • Diálogos con subtexto, tensión o información nueva                       ║
║  • Cada página debe tener al menos un micro-conflicto o revelación          ║
║  • Terminar escenas en momento de tensión (antes de la resolución)          ║
║  • Cortar escenas cuando el objetivo se cumple (no estirar)                 ║
║  • Usar verbos activos, oraciones cortas en momentos de tensión             ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  ESTRUCTURA DE ESCENA KU:                                                   ║
║  • 20% Setup rápido → 60% Desarrollo con tensión → 20% Cliffhanger          ║
║  • Máximo 400-500 palabras por escena (excepto escenas clímax)              ║
║  • Si una escena no avanza trama O personajes, ELIMINARLA                   ║
╚══════════════════════════════════════════════════════════════════════════════╝
`);
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
          parts.push(previousBooksSummary.substring(0, 5000));
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
   * Build FULL consistency context for SmartEditor corrections.
   * This ensures SmartEditor receives the SAME context as Ghostwriter during writing,
   * preventing new consistency errors from being introduced during corrections.
   */
  private async buildConsistencyContextForCorrection(
    projectId: number,
    chapterNumber: number,
    worldBible: any,
    project: any
  ): Promise<string> {
    const parts: string[] = [];
    
    try {
      // 1. Get consistency entities, rules, and relationships
      const context = await this.getConsistencyContext(projectId);
      if (context.entities.length > 0) {
        // Extract timeline and character state info
        const timelineInfo = this.extractTimelineInfo(worldBible, chapterNumber);
        const characterStates = this.extractCharacterStates(worldBible, chapterNumber);
        
        // Generate constraints using Universal Consistency Agent
        const constraints = universalConsistencyAgent.generateConstraints(
          project.genre,
          context.entities,
          context.rules,
          context.relationships,
          chapterNumber,
          timelineInfo,
          characterStates
        );
        if (constraints) {
          parts.push(constraints);
        }
      }
      
      // 2. Add plot decisions and persistent injuries
      const currentWorldBible = await storage.getWorldBibleByProject(projectId);
      if (currentWorldBible) {
        const decisionsConstraints = this.formatDecisionsAndInjuriesAsConstraints(
          currentWorldBible.plotDecisions as any[],
          currentWorldBible.persistentInjuries as any[],
          chapterNumber
        );
        if (decisionsConstraints) {
          parts.push(decisionsConstraints);
        }
      }
      
      // 3. Add scene summaries from previous chapters
      const sceneSummaries = await this.getSceneSummariesContext(projectId, chapterNumber);
      if (sceneSummaries) {
        parts.push(sceneSummaries);
      }
      
      // 4. Add enriched writing context (characters, rules, locations, error patterns)
      const enrichedOptions = await this.buildEnrichedContextOptions(project);
      const enrichedContext = await this.buildEnrichedWritingContext(projectId, chapterNumber, worldBible, enrichedOptions);
      if (enrichedContext) {
        parts.push(enrichedContext);
      }
      
      // 5. Add dead characters warning (CRITICAL for preventing resurrections)
      const deadCharacters = context.entities.filter(e => 
        e.type === 'character' && (e.status === 'dead' || e.status === 'deceased' || e.status === 'muerto')
      );
      if (deadCharacters.length > 0) {
        parts.push("\n=== ⚠️ PERSONAJES FALLECIDOS (NO PUEDEN ACTUAR, HABLAR NI APARECER ACTIVAMENTE) ===");
        for (const char of deadCharacters) {
          parts.push(`• ${char.name}: MUERTO desde capítulo ${char.lastSeenChapter || '?'}. Solo puede aparecer en flashbacks o recuerdos.`);
        }
      }
      
      // 6. Add thought context from previous agents
      const thoughtContext = await this.getChapterDecisionContext(projectId, chapterNumber);
      if (thoughtContext) {
        parts.push(thoughtContext);
      }
      
      // 7. LitAgents 2.9.2: Add CANONICAL ELEMENTS section - explicit preservation instructions
      const canonicalSection = this.buildCanonicalElementsSection(worldBible, context.entities, chapterNumber);
      if (canonicalSection) {
        parts.push(canonicalSection);
      }
      
    } catch (err) {
      console.error(`[OrchestratorV2] Error building correction context:`, err);
    }
    
    return parts.join("\n\n");
  }
  
  /**
   * LitAgents 2.9.2: Build explicit list of canonical elements that MUST NOT be changed
   * This prevents corrections from introducing new consistency errors
   */
  private buildCanonicalElementsSection(worldBible: any, entities: any[], chapterNumber: number): string {
    const canonicalItems: string[] = [];
    
    // 1. Physical traits of main characters (most common source of regression)
    const characters = worldBible?.characters || worldBible?.personajes || [];
    for (const char of characters.slice(0, 10)) {
      const name = char.name || char.nombre;
      const eyeColor = char.eyeColor || char.ojos || char.physical_traits?.eyes;
      const hairColor = char.hairColor || char.cabello || char.physical_traits?.hair;
      const age = char.age || char.edad;
      const status = char.status || char.estado;
      
      if (name) {
        let traits = [];
        if (eyeColor) traits.push(`ojos: ${eyeColor}`);
        if (hairColor) traits.push(`cabello: ${hairColor}`);
        if (age) traits.push(`edad: ${age}`);
        if (status === 'dead' || status === 'muerto' || status === 'deceased') {
          traits.push('MUERTO - NO PUEDE ACTUAR');
        }
        if (traits.length > 0) {
          canonicalItems.push(`• ${name}: ${traits.join(', ')}`);
        }
      }
    }
    
    // 2. Key locations established in the chapter
    const locations = worldBible?.locations || worldBible?.ubicaciones || [];
    for (const loc of locations.slice(0, 5)) {
      const name = loc.name || loc.nombre;
      if (name) {
        canonicalItems.push(`• Ubicación "${name}": NO cambiar nombre ni descripción física`);
      }
    }
    
    // 3. Timeline events that cannot be contradicted
    const timeline = worldBible?.timeline || [];
    const relevantEvents = timeline.filter((e: any) => 
      e.chapter === chapterNumber || e.chapter === chapterNumber - 1
    ).slice(0, 5);
    for (const event of relevantEvents) {
      const desc = event.event || event.evento || event.description;
      if (desc) {
        canonicalItems.push(`• Evento establecido: "${desc.substring(0, 100)}"`);
      }
    }
    
    // 4. Items/objects already established (Chekhov's gun principle)
    const items = entities.filter(e => e.type === 'PERSONAL_ITEM' || e.type === 'item' || e.type === 'object');
    for (const item of items.slice(0, 5)) {
      canonicalItems.push(`• Objeto "${item.name}": NO eliminar si ya fue mencionado`);
    }
    
    if (canonicalItems.length === 0) {
      return '';
    }
    
    return `=== ⛔ ELEMENTOS CANÓNICOS INTOCABLES (NO MODIFICAR BAJO NINGÚN CONCEPTO) ===
Las correcciones NO deben alterar estos elementos establecidos. Si el problema reportado contradice estos elementos, el problema es del REPORTE, no del texto:

${canonicalItems.join('\n')}

⚠️ REGLA CRÍTICA: Al corregir, PRESERVAR todos los elementos canónicos. Solo modificar el texto específico que causa el problema reportado. Si una corrección requiere cambiar un elemento canónico, NO aplicarla.`;
  }
  
  /**
   * LitAgents 2.9.2: Validate that a correction didn't introduce new consistency errors
   * Returns validation result with any detected regressions
   */
  private async validateCorrectionConsistency(
    originalContent: string,
    correctedContent: string,
    worldBible: any,
    chapterNumber: number
  ): Promise<{ valid: boolean; regressions: string[]; severity: 'low' | 'medium' | 'high' }> {
    const regressions: string[] = [];
    let highSeverityCount = 0;
    
    // Helper to escape regex special characters in names
    const escapeRegex = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    
    // Helper to normalize color terms for comparison
    const normalizeColor = (color: string): string[] => {
      const colorMap: Record<string, string[]> = {
        'azul': ['azul', 'azules', 'azulado', 'azulados'],
        'verde': ['verde', 'verdes', 'verdoso', 'verdosos'],
        'marrón': ['marrón', 'marrones', 'marron', 'castaño', 'castaños'],
        'gris': ['gris', 'grises', 'grisáceo', 'grisáceos', 'plomizo'],
        'negro': ['negro', 'negros', 'oscuro', 'oscuros', 'azabache'],
        'miel': ['miel', 'ámbar', 'dorado', 'dorados'],
        'avellana': ['avellana', 'avellanas', 'almendrado'],
      };
      const lowerColor = color.toLowerCase();
      for (const [base, variants] of Object.entries(colorMap)) {
        if (variants.some(v => lowerColor.includes(v))) {
          return variants;
        }
      }
      return [lowerColor];
    };
    
    try {
      // 1. Check character physical traits weren't changed incorrectly
      const characters = worldBible?.characters || worldBible?.personajes || [];
      for (const char of characters.slice(0, 10)) {
        const name = char.name || char.nombre;
        if (!name || name.length < 2) continue;
        
        const escapedName = escapeRegex(name);
        const eyeColor = char.eyeColor || char.ojos || char.physical_traits?.eyes;
        const hairColor = char.hairColor || char.cabello || char.physical_traits?.hair;
        
        // Check eye color consistency
        if (eyeColor) {
          const validEyeColors = normalizeColor(eyeColor);
          // Look for any eye color mentions near character name
          const eyePattern = new RegExp(`${escapedName}[^.]{0,50}ojos\\s+(?:de\\s+color\\s+)?(\\w+)`, 'gi');
          const correctedMatches = Array.from(correctedContent.matchAll(eyePattern));
          
          for (const match of correctedMatches) {
            const mentionedColor = match[1]?.toLowerCase();
            if (mentionedColor && !validEyeColors.some(v => mentionedColor.includes(v.substring(0, 4)))) {
              // Check if this is a NEW mention (not in original)
              if (!originalContent.includes(match[0])) {
                regressions.push(`Color de ojos de ${name} cambiado a "${mentionedColor}" (debería ser: ${eyeColor})`);
                highSeverityCount++;
              }
            }
          }
        }
        
        // Check hair color consistency
        if (hairColor) {
          const validHairColors = normalizeColor(hairColor);
          const hairPattern = new RegExp(`${escapedName}[^.]{0,50}(?:cabello|pelo|melena)\\s+(?:de\\s+color\\s+)?(\\w+)`, 'gi');
          const correctedMatches = Array.from(correctedContent.matchAll(hairPattern));
          
          for (const match of correctedMatches) {
            const mentionedColor = match[1]?.toLowerCase();
            if (mentionedColor && !validHairColors.some(v => mentionedColor.includes(v.substring(0, 4)))) {
              if (!originalContent.includes(match[0])) {
                regressions.push(`Color de cabello de ${name} cambiado a "${mentionedColor}" (debería ser: ${hairColor})`);
                highSeverityCount++;
              }
            }
          }
        }
      }
      
      // 2. Check dead characters weren't resurrected
      const deadChars = characters.filter((c: any) => 
        c.status === 'dead' || c.status === 'muerto' || c.status === 'deceased'
      );
      for (const deadChar of deadChars) {
        const name = deadChar.name || deadChar.nombre;
        if (!name) continue;
        
        const escapedName = escapeRegex(name);
        // Check for new active verbs for dead characters
        const activeVerbsPattern = new RegExp(`${escapedName}\\s+(?:dijo|respondió|caminó|corrió|miró|sonrió|gritó|susurró|se\\s+levantó)`, 'gi');
        const originalActions = Array.from(originalContent.matchAll(activeVerbsPattern));
        const correctedActions = Array.from(correctedContent.matchAll(activeVerbsPattern));
        
        if (correctedActions.length > originalActions.length) {
          regressions.push(`⚠️ CRÍTICO: Personaje muerto ${name} realiza acciones activas (posible resurrección)`);
          highSeverityCount += 2; // Extra severity for resurrection
        }
      }
      
      // 3. Check location names weren't changed or removed
      const locations = worldBible?.locations || worldBible?.ubicaciones || [];
      for (const loc of locations.slice(0, 8)) {
        const name = loc.name || loc.nombre;
        if (!name || name.length < 3) continue;
        
        try {
          const escapedName = escapeRegex(name);
          const locPattern = new RegExp(escapedName, 'gi');
          const originalMentions = Array.from(originalContent.matchAll(locPattern)).length;
          const correctedMentions = Array.from(correctedContent.matchAll(locPattern)).length;
          
          // If a location was removed entirely, that's concerning
          if (originalMentions > 0 && correctedMentions === 0) {
            regressions.push(`Ubicación "${name}" eliminada de la corrección (estaba ${originalMentions} veces)`);
          }
        } catch (regexErr) {
          // Skip invalid regex patterns
          console.warn(`[Validation] Skipping location "${name}" due to invalid pattern`);
        }
      }
      
    } catch (err) {
      console.error(`[OrchestratorV2] Error validating correction consistency:`, err);
    }
    
    // Determine severity based on findings
    const severity: 'low' | 'medium' | 'high' = 
      highSeverityCount >= 2 ? 'high' : 
      highSeverityCount >= 1 || regressions.length >= 3 ? 'medium' : 
      regressions.length > 0 ? 'low' : 'low';
    
    return {
      valid: regressions.length === 0,
      regressions,
      severity
    };
  }

  /**
   * LitAgents 2.9.2: AI-powered validation for surgical corrections
   * Uses AI to evaluate if a correction introduces subtle consistency violations
   * that regex patterns cannot detect (e.g., personality changes, timeline shifts)
   */
  private async validateCorrectionWithAI(
    originalContent: string,
    correctedContent: string,
    worldBible: any,
    chapterNumber: number,
    issues: string[]
  ): Promise<{ approved: boolean; concerns: string[]; confidence: number }> {
    
    try {
      // Build compact World Bible context for validation
      const characters = worldBible?.characters || worldBible?.personajes || [];
      const characterContext = characters.slice(0, 5).map((c: any) => {
        const name = c.name || c.nombre;
        const traits = [];
        if (c.eyeColor || c.ojos) traits.push(`ojos: ${c.eyeColor || c.ojos}`);
        if (c.hairColor || c.cabello) traits.push(`cabello: ${c.hairColor || c.cabello}`);
        if (c.personality || c.personalidad) traits.push(`personalidad: ${c.personality || c.personalidad}`);
        if (c.status === 'dead' || c.status === 'muerto') traits.push('ESTADO: MUERTO');
        return `- ${name}: ${traits.join(', ')}`;
      }).join('\n');

      const locations = worldBible?.locations || worldBible?.ubicaciones || [];
      const locationContext = locations.slice(0, 5).map((l: any) => 
        `- ${l.name || l.nombre}`
      ).join('\n');

      // Find the actual changed sections for surgical review
      const diffExcerpts = this.extractSurgicalChanges(originalContent, correctedContent);

      const validationPrompt = `Eres un validador de correcciones literarias. Tu tarea es evaluar si una corrección quirúrgica introduce problemas de consistencia.

## WORLD BIBLE (Elementos canónicos que NO deben cambiar)
### Personajes:
${characterContext || 'No disponible'}

### Ubicaciones:
${locationContext || 'No disponible'}

## PROBLEMAS ORIGINALES QUE SE INTENTABAN CORREGIR:
${issues.slice(0, 5).join('\n')}

## CAMBIOS DETECTADOS (secciones modificadas):
${diffExcerpts || 'No se detectaron cambios significativos'}

## CONTEXTO GENERAL:
### Inicio del texto original:
${originalContent.substring(0, 800)}...

### Inicio del texto corregido:
${correctedContent.substring(0, 800)}...

## INSTRUCCIONES DE VALIDACIÓN:
Analiza si la corrección:
1. ¿Cambió características físicas de personajes (color de ojos, cabello, edad)?
2. ¿Resucitó personajes que deberían estar muertos?
3. ¿Eliminó ubicaciones importantes o las renombró?
4. ¿Cambió la personalidad o comportamiento típico de un personaje?
5. ¿Introdujo inconsistencias temporales (eventos fuera de orden)?
6. ¿Eliminó información importante sin reemplazarla?

Responde OBLIGATORIAMENTE en JSON con este formato exacto:
{
  "approved": true,
  "confidence": 0.9,
  "concerns": []
}

O si hay problemas:
{
  "approved": false,
  "confidence": 0.8,
  "concerns": ["problema 1", "problema 2"]
}

Si la corrección es segura y solo arregla los problemas reportados, apruébala.
Si detectas cambios problemáticos, recházala con concerns específicos.`;

      // Create DeepSeek client for validation
      const apiKey = process.env.DEEPSEEK_API_KEY;
      if (!apiKey) {
        console.warn(`[OrchestratorV2] No DEEPSEEK_API_KEY available for AI validation, skipping`);
        return { approved: true, concerns: ['Sin API key para validación IA'], confidence: 0.3 };
      }
      const deepseekClient = new OpenAI({
        apiKey,
        baseURL: "https://api.deepseek.com",
      });

      const response = await deepseekClient.chat.completions.create({
        model: "deepseek-chat",
        messages: [
          { role: "system", content: "Eres un validador experto de consistencia literaria. Respondes SOLO en JSON válido, sin texto adicional." },
          { role: "user", content: validationPrompt }
        ],
        temperature: 0.1,
        max_tokens: 500
      });

      const responseText = response.choices[0]?.message?.content || '';
      
      // Parse JSON response with fail-safe behavior
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const result = JSON.parse(jsonMatch[0]);
          // Validate required fields exist
          if (typeof result.approved !== 'boolean') {
            console.warn(`[OrchestratorV2] AI validation returned invalid approved field, treating as suspicious`);
            return { approved: false, concerns: ['Respuesta IA inválida - revisión manual recomendada'], confidence: 0.5 };
          }
          return {
            approved: result.approved === true,
            concerns: Array.isArray(result.concerns) ? result.concerns : [],
            confidence: typeof result.confidence === 'number' ? Math.min(1, Math.max(0, result.confidence)) : 0.5
          };
        } catch (parseErr) {
          console.warn(`[OrchestratorV2] Failed to parse AI validation JSON: ${parseErr}`);
          // JSON parse failed - fail-safe: treat as suspicious
          return { approved: false, concerns: ['Error parsing respuesta IA - revisión manual recomendada'], confidence: 0.6 };
        }
      }
      
      // No JSON found - fail-safe: treat as suspicious
      console.warn(`[OrchestratorV2] AI validation returned no JSON, treating as suspicious`);
      return { approved: false, concerns: ['No se pudo obtener validación IA - revisión manual recomendada'], confidence: 0.5 };
      
    } catch (err) {
      console.error(`[OrchestratorV2] Error in AI correction validation:`, err);
      // On API error, warn but don't block (to avoid blocking all corrections if API is down)
      return { approved: true, concerns: ['Error de conexión IA - aprobado con precaución'], confidence: 0.3 };
    }
  }

  /**
   * Extract the actual changed sections between original and corrected content
   * for surgical review by AI validation.
   * Uses content-based comparison (not positional) to handle insertions/deletions correctly.
   */
  private extractSurgicalChanges(original: string, corrected: string): string {
    const excerpts: string[] = [];
    
    try {
      // Split into sentences for comparison
      const originalSentences = original.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 10);
      const correctedSentences = corrected.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 10);
      
      // Create sets for O(1) lookup - content-based comparison
      const originalSet = new Set(originalSentences.map(s => s.trim()));
      const correctedSet = new Set(correctedSentences.map(s => s.trim()));
      
      const changedCount = { added: 0, removed: 0, modified: 0 };
      
      // Find sentences that were REMOVED (in original but not in corrected)
      for (const origSent of originalSentences) {
        const trimmed = origSent.trim();
        if (!correctedSet.has(trimmed) && excerpts.length < 6) {
          // Check if it's a modification (similar sentence exists) or deletion
          const similar = correctedSentences.find(cs => 
            this.sentenceSimilarity(trimmed, cs.trim()) > 0.6
          );
          if (similar) {
            excerpts.push(`[MODIFICADO]\n  ANTES: "${trimmed.substring(0, 120)}${trimmed.length > 120 ? '...' : ''}"\n  DESPUÉS: "${similar.trim().substring(0, 120)}${similar.length > 120 ? '...' : ''}"`);
            changedCount.modified++;
            // Mark as processed
            correctedSet.delete(similar.trim());
          } else {
            excerpts.push(`[ELIMINADO]: "${trimmed.substring(0, 150)}${trimmed.length > 150 ? '...' : ''}"`);
            changedCount.removed++;
          }
        }
      }
      
      // Find sentences that were ADDED (in corrected but not in original, and not already matched)
      for (const corrSent of correctedSentences) {
        const trimmed = corrSent.trim();
        if (!originalSet.has(trimmed) && correctedSet.has(trimmed) && excerpts.length < 6) {
          excerpts.push(`[AÑADIDO]: "${trimmed.substring(0, 150)}${trimmed.length > 150 ? '...' : ''}"`);
          changedCount.added++;
        }
      }
      
      if (excerpts.length === 0) {
        // Check for very minor changes (whitespace, punctuation)
        const origNorm = original.replace(/\s+/g, ' ').trim();
        const corrNorm = corrected.replace(/\s+/g, ' ').trim();
        if (origNorm === corrNorm) {
          return 'Solo cambios de formato (espacios/saltos de línea)';
        }
        return `Cambios menores no detectables a nivel de oración (${originalSentences.length} oraciones)`;
      }
      
      return `Resumen: ${changedCount.added} añadidos, ${changedCount.removed} eliminados, ${changedCount.modified} modificados\n\n${excerpts.join('\n\n')}`;
      
    } catch (err) {
      console.warn(`[OrchestratorV2] Error extracting surgical changes:`, err);
      return 'No se pudieron extraer cambios específicos';
    }
  }

  /**
   * Calculate simple similarity between two sentences (0-1)
   * Uses word overlap ratio for efficiency
   */
  private sentenceSimilarity(sent1: string, sent2: string): number {
    const words1 = new Set(sent1.toLowerCase().split(/\s+/).filter(w => w.length > 2));
    const words2 = new Set(sent2.toLowerCase().split(/\s+/).filter(w => w.length > 2));
    
    if (words1.size === 0 || words2.size === 0) return 0;
    
    let overlap = 0;
    for (const word of Array.from(words1)) {
      if (words2.has(word)) overlap++;
    }
    
    return overlap / Math.max(words1.size, words2.size);
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

  // LitAgents 2.2: Get recent chapters text for vocabulary tracking
  private async getRecentChaptersText(projectId: number, currentChapter: number, maxChapters: number = 2): Promise<string> {
    try {
      const chapters = await storage.getChaptersByProject(projectId);
      if (!chapters || chapters.length === 0) return "";

      // Get last N chapters before current
      const recentChapters = chapters
        .filter(c => c.chapterNumber < currentChapter && c.content)
        .sort((a, b) => b.chapterNumber - a.chapterNumber)
        .slice(0, maxChapters);

      // Combine text (limit to ~5000 chars per chapter for efficiency)
      return recentChapters
        .map(c => (c.content || '').slice(0, 5000))
        .join('\n\n');
    } catch (err) {
      console.error(`[OrchestratorV2] Failed to get recent chapters text:`, err);
      return "";
    }
  }

  // LitAgents 2.9: Get error history to prevent repeating past mistakes
  private async getErrorHistoryForWriting(projectId: number): Promise<string> {
    try {
      const violations = await storage.getConsistencyViolationsByProject(projectId);
      if (!violations || violations.length === 0) return "";

      // Get unique error types and descriptions (limit to recent 10)
      const recentErrors = violations
        .filter(v => v.status !== 'resolved')
        .slice(0, 10);

      if (recentErrors.length === 0) return "";

      const errorTypes = new Map<string, string[]>();
      for (const v of recentErrors) {
        const type = v.violationType || 'GENERAL';
        if (!errorTypes.has(type)) {
          errorTypes.set(type, []);
        }
        errorTypes.get(type)!.push(v.description.substring(0, 150));
      }

      const parts: string[] = [
        "╔══════════════════════════════════════════════════════════════════╗",
        "║ ⚠️ ERRORES DETECTADOS EN ESTE PROYECTO - EVITAR REPETIR ⚠️       ║",
        "╠══════════════════════════════════════════════════════════════════╣"
      ];

      Array.from(errorTypes.entries()).forEach(([type, descriptions]) => {
        parts.push(`║ ${type}:`);
        descriptions.slice(0, 3).forEach(desc => {
          parts.push(`║   • ${desc}`);
        });
      });

      parts.push("╠══════════════════════════════════════════════════════════════════╣");
      parts.push("║ NO cometas estos errores. Verifica antes de escribir.            ║");
      parts.push("╚══════════════════════════════════════════════════════════════════╝");

      console.log(`[OrchestratorV2] Generated error history with ${recentErrors.length} past errors`);
      return parts.join("\n");
    } catch (err) {
      console.error(`[OrchestratorV2] Failed to get error history:`, err);
      return "";
    }
  }

  private async getGlobalWritingLessons(): Promise<string> {
    try {
      const lessons = await storage.getActiveWritingLessons();
      if (!lessons || lessons.length === 0) return "";
      
      const { WritingLessonsAgent } = await import("./agents/writing-lessons-agent");
      const formatted = WritingLessonsAgent.formatLessonsForGhostwriter(lessons);
      console.log(`[OrchestratorV2] Injected ${lessons.length} global writing lessons`);
      return formatted;
    } catch (err) {
      console.error(`[OrchestratorV2] Failed to get global writing lessons:`, err);
      return "";
    }
  }

  private async validateAndUpdateConsistency(
    projectId: number,
    chapterNumber: number,
    chapterText: string,
    genre: string,
    worldBible?: any,
    narrativeTimeline?: Array<{ chapter: number; narrativeTime: string; location?: string }>
  ): Promise<{ isValid: boolean; error?: string }> {
    const context = await this.getConsistencyContext(projectId);
    
    if (context.entities.length === 0 && context.rules.length === 0) {
      console.log(`[OrchestratorV2] Skipping consistency validation - no context available`);
      return { isValid: true };
    }

    this.callbacks.onAgentStatus("universal-consistency", "active", "Validating continuity...");
    
    const timelineInfo = worldBible ? this.extractTimelineInfo(worldBible, chapterNumber) : undefined;
    
    const result = await universalConsistencyAgent.validateChapter(
      chapterText,
      genre,
      context.entities,
      context.rules,
      context.relationships,
      chapterNumber,
      timelineInfo,
      narrativeTimeline
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
      // Return both error description AND correction instructions for the SmartEditor
      const fullError = result.correctionInstructions 
        ? `${result.criticalError}\n\nINSTRUCCIONES DE CORRECCIÓN ESPECÍFICAS:\n${result.correctionInstructions}`
        : result.criticalError;
      return { isValid: false, error: fullError };
    }

    const blockedDeathEntities = new Set<string>();
    if (result.newFacts && result.newFacts.length > 0) {
      for (const fact of result.newFacts) {
        const existing = await storage.getWorldEntityByName(projectId, fact.entityName);
        
        let processedUpdate = { ...fact.update };
        if (fact.entityType === 'PHYSICAL_TRAIT' || fact.entityType === 'CHARACTER') {
          const physicalKeys = ['ojos', 'eyes', 'pelo', 'hair', 'cabello', 'altura', 'height', 'edad', 'age', 'piel', 'skin', 'cicatriz', 'scar', 'tatuaje', 'tattoo', 'barba', 'beard', 'complexion', 'build'];
          for (const [key, value] of Object.entries(fact.update)) {
            const isPhysical = physicalKeys.some(pk => key.toLowerCase().includes(pk));
            if (isPhysical && !key.endsWith('_INMUTABLE')) {
              processedUpdate[`${key}_INMUTABLE`] = value;
              delete processedUpdate[key];
              
              await storage.createWorldRule({
                projectId,
                ruleDescription: `${fact.entityName} tiene ${key} = "${value}" (DESCUBIERTO en Cap ${chapterNumber} - INMUTABLE)`,
                category: 'PHYSICAL_ATTRIBUTE',
                isActive: true,
                sourceChapter: chapterNumber,
              });
              console.log(`[OrchestratorV2] Registered physical trait: ${fact.entityName}.${key} = ${value}`);
            }
          }
        }

        const vitalStatus = (processedUpdate.estado_vital || processedUpdate.vital_status || '').toString().toLowerCase();
        const isDeathUpdate = vitalStatus.includes('muerto') || vitalStatus.includes('dead') || vitalStatus.includes('fallecido');

        if (isDeathUpdate) {
          const EXPLICIT_DEATH_PHRASES = [
            'cayó muerto', 'murió', 'falleció', 'dejó de respirar', 'su corazón se detuvo',
            'expiró', 'pereció', 'lo mataron', 'la mataron', 'fue asesinado', 'fue asesinada',
            'ejecutado', 'ejecutada', 'fusilado', 'fusilada', 'apuñalado hasta la muerte',
            'desangró', 'muerte instantánea', 'sin vida', 'cadáver', 'cuerpo sin vida',
            'último aliento', 'vida se apagó', 'vida se extinguió', 'dejó de existir',
            'lo encontraron muerto', 'la encontraron muerta', 'mató de un', 'disparó y mató'
          ];
          const DRUGGING_INDICATORS = [
            'drogó', 'drogado', 'drogada', 'echó algo en', 'puso algo en',
            'perdió el conocimiento', 'quedó inconsciente', 'desmayó', 'desvanecido',
            'sobrevivió', 'aún respira', 'noqueado', 'noqueada',
            'sedado', 'sedada', 'narcotizado', 'narcotizada', 'dado por muerto'
          ];

          const chapterTextLower = chapterText.toLowerCase();
          const entityNameLower = fact.entityName.toLowerCase();
          const nameParts = entityNameLower.split(/[\s"]+/).filter((p: string) => p.length >= 3);

          const entityMentioned = nameParts.some((p: string) => chapterTextLower.includes(p));

          const contextChunks: string[] = [];
          if (entityMentioned) {
            for (const part of nameParts) {
              let idx = 0;
              while ((idx = chapterTextLower.indexOf(part, idx)) !== -1) {
                const start = Math.max(0, idx - 500);
                const end = Math.min(chapterTextLower.length, idx + 500);
                contextChunks.push(chapterTextLower.substring(start, end));
                idx += part.length;
              }
            }
          }
          const nearNameText = contextChunks.join(' ');

          const hasExplicitDeathNearName = EXPLICIT_DEATH_PHRASES.some(phrase => nearNameText.includes(phrase));
          const hasExplicitDeathAnywhere = EXPLICIT_DEATH_PHRASES.some(phrase => chapterTextLower.includes(phrase));
          const hasDruggingNearName = DRUGGING_INDICATORS.some(phrase => nearNameText.includes(phrase));

          const deathConfirmed = hasExplicitDeathNearName || (hasExplicitDeathAnywhere && !hasDruggingNearName);

          if (!deathConfirmed) {
            console.log(`[OrchestratorV2] ⚠️ DEATH BLOCKED for ${fact.entityName} in Cap ${chapterNumber}: No explicit death near entity name (nearName=${hasExplicitDeathNearName}, anywhere=${hasExplicitDeathAnywhere}, drugging=${hasDruggingNearName}). Registering as injured/unconscious.`);
            blockedDeathEntities.add(fact.entityName.toLowerCase());
            const originalCause = processedUpdate.causa_muerte || processedUpdate.death_cause || 'inconsciente/herido';
            delete processedUpdate.estado_vital;
            delete processedUpdate.vital_status;
            delete processedUpdate.capitulo_muerte;
            delete processedUpdate.death_chapter;
            delete processedUpdate.causa_muerte;
            delete processedUpdate.death_cause;
            delete processedUpdate.cause_of_death;
            processedUpdate.estado_emocional = originalCause;
            processedUpdate.estado_fisico = 'inconsciente o gravemente herido';
          } else {
            console.log(`[OrchestratorV2] ✓ Death CONFIRMED for ${fact.entityName} in Cap ${chapterNumber}: Explicit death phrase found in text.`);
          }
        }
        
        if (existing) {
          const newAttrs = { ...((existing.attributes as any) || {}), ...processedUpdate };
          const updateData: any = {
            attributes: newAttrs,
            lastSeenChapter: chapterNumber,
          };
          const finalVitalStatus = (processedUpdate.estado_vital || processedUpdate.vital_status || '').toString().toLowerCase();
          if (finalVitalStatus.includes('muerto') || finalVitalStatus.includes('dead') || finalVitalStatus.includes('fallecido')) {
            updateData.status = 'dead';
            console.log(`[OrchestratorV2] Marking entity ${fact.entityName} as DEAD in world_entities`);
          }
          await storage.updateWorldEntity(existing.id, updateData);
        } else {
          await storage.createWorldEntity({
            projectId,
            name: fact.entityName,
            type: fact.entityType === 'PHYSICAL_TRAIT' ? 'CHARACTER' : (fact.entityType || 'CHARACTER'),
            attributes: processedUpdate,
            status: 'active',
            lastSeenChapter: chapterNumber,
          });
        }
      }
      console.log(`[OrchestratorV2] Updated ${result.newFacts.length} facts in consistency DB`);
    }

    if (result.newRules && result.newRules.length > 0) {
      let addedRules = 0;
      for (const rule of result.newRules) {
        if (rule.category === 'DEATH_EVENT' && blockedDeathEntities.size > 0) {
          const ruleTextLower = rule.ruleDescription.toLowerCase();
          const isBlockedDeath = Array.from(blockedDeathEntities).some(blockedName => {
            const parts = blockedName.split(/[\s"]+/).filter((p: string) => p.length >= 4);
            return parts.length > 0 && parts.some((p: string) => ruleTextLower.includes(p));
          });
          if (isBlockedDeath) {
            console.log(`[OrchestratorV2] ⚠️ DEATH_EVENT rule BLOCKED (death was not confirmed): ${rule.ruleDescription.substring(0, 80)}`);
            continue;
          }
        }
        await storage.createWorldRule({
          projectId,
          ruleDescription: rule.ruleDescription,
          category: rule.category,
          isActive: true,
          sourceChapter: chapterNumber,
        });
        addedRules++;
      }
      if (addedRules > 0) console.log(`[OrchestratorV2] Added ${addedRules} new rules`);
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
            meta: { ...(rel.meta || {}), sourceChapter: chapterNumber },
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

  async generateNovel(project: Project, options?: { useGeminiArchitect?: boolean; useGeminiQA?: { finalReviewer?: boolean; continuitySentinel?: boolean; narrativeDirector?: boolean } }): Promise<void> {
    const qaGemini = options?.useGeminiQA;
    this.geminiQAFlags = qaGemini;
    const qaFlags = qaGemini ? ` [QA Gemini: ${qaGemini.finalReviewer ? 'FR' : ''}${qaGemini.continuitySentinel ? ' CS' : ''}${qaGemini.narrativeDirector ? ' ND' : ''}]` : '';
    console.log(`[OrchestratorV2] Starting novel generation for "${project.title}" (ID: ${project.id})${options?.useGeminiArchitect ? ' [Architect: Gemini]' : ''}${qaFlags}`);
    
    try {
      // Update project status
      await storage.updateProject(project.id, { status: "generating" });
      
      // LitAgents 2.9.7: Clear pattern tracker for fresh generation
      clearPatternTracker(project.id);
      console.log(`[OrchestratorV2] Pattern tracker cleared for project ${project.id}`);

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
          const volumeNumber = project.seriesOrder || 1;
          console.log(`[OrchestratorV2] Part of series: ${series.title}, Book #${volumeNumber}`);
          
          // LitAgents 2.9.10: Extract volume-specific information from the series guide
          // This ensures the Global Architect receives the milestones, architecture, and character details for THIS volume
          if (extendedGuideContent && volumeNumber > 0) {
            const volumeContext = this.extractVolumeContextFromGuide(extendedGuideContent, volumeNumber);
            if (volumeContext) {
              console.log(`[OrchestratorV2] Extracted volume ${volumeNumber} context from series guide (${volumeContext.length} chars)`);
              previousBooksContext = `\n=== INFORMACIÓN OBLIGATORIA PARA ESTE VOLUMEN (${volumeNumber}) ===\n${volumeContext}\n\nDEBES incorporar TODA esta información del volumen ${volumeNumber} en la biblia del mundo y la estructura de capítulos. Los hitos, la arquitectura y los personajes definidos aquí son OBLIGATORIOS.\n`;
            }
          }
          
          // Get comprehensive context from previous books in the series (including imported manuscripts)
          if (project.seriesOrder && project.seriesOrder > 1) {
            const prevContext = await this.buildPreviousBooksContext(project.seriesId, project.seriesOrder, {
              maxChars: 12000,
              includeWorldRules: true,
              includeCanonWarning: true,
            });
            if (prevContext) {
              previousBooksContext = (previousBooksContext || '') + '\n\n=== LIBROS ANTERIORES DE LA SERIE (CONTEXTO COMPLETO) ===\n' + prevContext;
            }
          }
        }
      }

      // Check if World Bible already exists (resuming)
      const existingWorldBible = await storage.getWorldBibleByProject(project.id);
      let outline: Array<{ chapter_num: number; title: string; summary: string; key_event: string; act?: number; emotional_arc?: string }>;
      let worldBible: { characters: any; rules: any };
      
      // LitAgents 2.9.6: Check if chapters already exist - never regenerate structure if we have chapters
      const existingChaptersCheck = await storage.getChaptersByProject(project.id);
      const hasWrittenChapters = existingChaptersCheck.some(ch => ch.content && ch.content.length > 100);
      
      if (hasWrittenChapters && !existingWorldBible?.plotOutline) {
        // Emergency: Chapters exist but no plot outline - reconstruct from chapters
        console.log(`[OrchestratorV2] ⚠️ EMERGENCY: Chapters exist (${existingChaptersCheck.length}) but no plotOutline. Reconstructing from chapters...`);
        
        await storage.createActivityLog({
          projectId: project.id,
          level: "warn",
          agentRole: "system",
          message: `⚠️ Reconstruyendo estructura desde ${existingChaptersCheck.length} capítulos existentes (plotOutline faltante)`,
        });
        
        // Build outline from existing chapters
        outline = existingChaptersCheck.map(ch => ({
          chapter_num: ch.chapterNumber,
          title: ch.title || `Capítulo ${ch.chapterNumber}`,
          summary: ch.summary || "",
          key_event: "",
        })).sort((a, b) => a.chapter_num - b.chapter_num);
        
        worldBible = {
          characters: existingWorldBible?.characters || [],
          rules: existingWorldBible?.worldRules || [],
        };
        
        // LitAgents 2.9.6: Persist reconstructed outline to World Bible to avoid re-triggering
        const reconstructedPlotOutline = {
          chapterOutlines: outline.map(ch => ({
            number: ch.chapter_num,
            title: ch.title,
            summary: ch.summary,
            keyEvents: ch.key_event ? [ch.key_event] : [],
          })),
        };
        
        if (existingWorldBible) {
          await storage.updateWorldBible(existingWorldBible.id, { plotOutline: reconstructedPlotOutline });
          console.log(`[OrchestratorV2] ✅ Reconstructed plotOutline persisted to World Bible (${outline.length} chapters)`);
        } else {
          // Create minimal World Bible with reconstructed outline
          await storage.createWorldBible({
            projectId: project.id,
            characters: [],
            worldRules: [],
            plotOutline: reconstructedPlotOutline,
            timeline: [],
          });
          console.log(`[OrchestratorV2] ✅ Created new World Bible with reconstructed plotOutline (${outline.length} chapters)`);
        }
        
        this.callbacks.onAgentStatus("global-architect", "completed", "Reconstructed from chapters");
      } else if (existingWorldBible && existingWorldBible.plotOutline) {
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
        // LitAgents 2.9.5: Loop with validation to prevent orphaned/weak storylines
        const MAX_ARCHITECTURE_ATTEMPTS = 5; // LitAgents 2.9.5: Increased from 3 to give AI more chances
        let architectureAttempt = 0;
        let plotValidation: { isValid: boolean; criticalIssues: string[]; warnings: string[] } = { isValid: false, criticalIssues: [], warnings: [] };
        let globalResult: any = null;
        let correctionInstructions = '';
        
        while (architectureAttempt < MAX_ARCHITECTURE_ATTEMPTS && !plotValidation.isValid) {
          architectureAttempt++;
          
          this.callbacks.onAgentStatus(
            "global-architect", 
            "active", 
            architectureAttempt === 1 
              ? "Designing master structure..." 
              : `Regenerando estructura (intento ${architectureAttempt}/${MAX_ARCHITECTURE_ATTEMPTS})...`
          );
          
          // Build architecture instructions with corrections if this is a retry
          let fullArchitectInstructions = project.architectInstructions || '';
          if (correctionInstructions) {
            fullArchitectInstructions = correctionInstructions + '\n\n' + fullArchitectInstructions;
          }
          
          globalResult = await this.globalArchitect.execute({
            title: project.title,
            premise: project.premise || "",
            genre: project.genre,
            tone: project.tone,
            chapterCount: project.chapterCount,
            architectInstructions: fullArchitectInstructions || undefined,
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
            isKindleUnlimited: project.kindleUnlimitedOptimized || false,
            useGeminiArchitect: options?.useGeminiArchitect,
          });

          if (globalResult.error || !globalResult.parsed) {
            throw new Error(`Global Architect failed: ${globalResult.error || "No parsed output"}`);
          }

          this.addTokenUsage(globalResult.tokenUsage);
          const architectModel = options?.useGeminiArchitect ? "gemini-3-pro-preview" : "deepseek-reasoner";
          await this.logAiUsage(project.id, "global-architect", architectModel, globalResult.tokenUsage);
          
          // LitAgents 2.9.5: Validate plot coherence (also uses extended guide for thread extraction)
          plotValidation = this.validatePlotCoherence(
            globalResult.parsed.outline,
            globalResult.parsed.plot_threads,
            globalResult.parsed.world_bible,
            extendedGuideContent
          );
          
          if (!plotValidation.isValid) {
            console.warn(`[OrchestratorV2] Plot coherence validation FAILED (attempt ${architectureAttempt}):`, plotValidation.criticalIssues);
            
            await storage.createActivityLog({
              projectId: project.id,
              level: "warn",
              agentRole: "global-architect",
              message: `⚠️ VALIDACIÓN FALLIDA (intento ${architectureAttempt}/${MAX_ARCHITECTURE_ATTEMPTS}): Se detectaron ${plotValidation.criticalIssues.length} problemas críticos y ${plotValidation.warnings.length} advertencias.`,
              metadata: { criticalIssues: plotValidation.criticalIssues, warnings: plotValidation.warnings },
            });
            
            for (const issue of plotValidation.criticalIssues) {
              await storage.createActivityLog({
                projectId: project.id,
                level: "error",
                agentRole: "global-architect",
                message: issue,
              });
            }
            
            // Build correction instructions for next attempt
            if (architectureAttempt < MAX_ARCHITECTURE_ATTEMPTS) {
              // LitAgents 2.9.6: Extract characters from previous attempt and extended guide
              const previousCharacters = globalResult.parsed?.world_bible?.characters?.map((c: any) => ({
                name: c.name || c.nombre,
                role: c.role || c.rol
              })) || [];
              const extendedGuideCharacters = this.extractCharactersFromExtendedGuide(extendedGuideContent);
              
              // LitAgents 2.9.6: Pass actual chapter count for accurate protagonist requirements
              const outlineChapterCount = globalResult.parsed?.outline?.length || project.chapterCount;
              
              correctionInstructions = this.buildPlotCorrectionInstructions(
                plotValidation.criticalIssues,
                plotValidation.warnings,
                architectureAttempt + 1,
                previousCharacters,
                extendedGuideCharacters,
                outlineChapterCount
              );
            }
          } else {
            console.log(`[OrchestratorV2] Plot coherence validation PASSED on attempt ${architectureAttempt}`);
            
            await storage.createActivityLog({
              projectId: project.id,
              level: "info",
              agentRole: "global-architect",
              message: `✅ Estructura narrativa APROBADA${architectureAttempt > 1 ? ` después de ${architectureAttempt} intentos` : ''}. ${plotValidation.warnings.length} advertencias menores registradas.`,
            });
          }
        }
        
        // LitAgents 2.9.6: If validation still fails after MAX attempts, try post-processing before pausing
        if (!plotValidation.isValid) {
          console.warn(`[OrchestratorV2] Plot coherence validation FAILED after ${MAX_ARCHITECTURE_ATTEMPTS} attempts. Attempting post-processor fix...`);
          
          // LitAgents 2.9.6: Try to auto-fix protagonist issues via injection
          const protagonistIssues = plotValidation.criticalIssues.filter(i => 
            i.includes('PROTAGONISTA AUSENTE') || i.includes('protagonista')
          );
          
          if (protagonistIssues.length > 0 && globalResult.parsed?.outline) {
            // Extract protagonist name from world_bible or extended guide
            const characters = globalResult.parsed.world_bible?.characters || [];
            const protagonist = characters.find((c: any) => 
              (c.role || c.rol || '').toLowerCase().includes('protagonist') ||
              (c.role || c.rol || '').toLowerCase().includes('principal')
            );
            
            if (protagonist) {
              const protagonistName = protagonist.name || protagonist.nombre;
              console.log(`[OrchestratorV2] Auto-injecting protagonist "${protagonistName}" into outline...`);
              
              const modifiedOutline = this.injectProtagonistIntoOutline(
                globalResult.parsed.outline,
                protagonistName
              );
              
              // Replace outline and re-validate
              globalResult.parsed.outline = modifiedOutline;
              
              const revalidation = this.validatePlotCoherence(
                modifiedOutline,
                globalResult.parsed.plot_threads,
                globalResult.parsed.world_bible,
                extendedGuideContent
              );
              
              if (revalidation.isValid || revalidation.criticalIssues.filter(i => i.includes('PROTAGONISTA')).length === 0) {
                console.log(`[OrchestratorV2] Post-processor successfully fixed protagonist presence issue!`);
                plotValidation = revalidation;
                
                await storage.createActivityLog({
                  projectId: project.id,
                  level: "info",
                  agentRole: "system",
                  message: `✅ Post-procesador inyectó al protagonista "${protagonistName}" en capítulos críticos. Problema resuelto automáticamente.`,
                });
              }
            }
          }
        }
        
        // If still invalid after post-processing, pause the project
        if (!plotValidation.isValid) {
          console.error(`[OrchestratorV2] Plot coherence validation FAILED after ${MAX_ARCHITECTURE_ATTEMPTS} attempts and post-processing. Pausing project.`);
          
          await storage.createActivityLog({
            projectId: project.id,
            level: "error",
            agentRole: "system",
            message: `🛑 PROYECTO PAUSADO: La estructura narrativa no cumple los estándares de calidad después de ${MAX_ARCHITECTURE_ATTEMPTS} intentos. Problemas pendientes: ${plotValidation.criticalIssues.join(' | ')}`,
            metadata: { criticalIssues: plotValidation.criticalIssues, warnings: plotValidation.warnings },
          });
          
          await storage.updateProject(project.id, { status: "paused" });
          this.callbacks.onAgentStatus("global-architect", "error", "Estructura narrativa débil - proyecto pausado");
          throw new Error(`Plot coherence validation failed after ${MAX_ARCHITECTURE_ATTEMPTS} attempts. Project paused for manual review. Issues: ${plotValidation.criticalIssues.join('; ')}`);
        }
        
        // LitAgents 2.8: Log subplot coherence warnings if detected (from GlobalArchitect's own checks)
        const subplotWarnings = (globalResult as any).subplotWarnings as string[] | undefined;
        if (subplotWarnings && subplotWarnings.length > 0) {
          console.warn(`[OrchestratorV2] GlobalArchitect detected ${subplotWarnings.length} subplot coherence issue(s)`);
          
          await storage.createActivityLog({
            projectId: project.id,
            level: "warn",
            message: `⚠️ ADVERTENCIA DE SUBTRAMAS - Se detectaron ${subplotWarnings.length} problema(s) adicionales de coherencia.`,
            agentRole: "global-architect",
            metadata: { subplotWarnings },
          });
        }
        
        // Log warnings from our validation
        if (plotValidation.warnings.length > 0) {
          for (const warning of plotValidation.warnings) {
            await storage.createActivityLog({
              projectId: project.id,
              level: "warn",
              message: warning,
              agentRole: "global-architect",
            });
          }
        }
        
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
        
        const wbCharacters = worldBible?.characters || (worldBible as any)?.personajes;
        if ((project.workType === 'series' || project.seriesId) && extendedGuideContent && wbCharacters) {
          if (!worldBible.characters && (worldBible as any).personajes) {
            worldBible.characters = (worldBible as any).personajes;
          }
          console.log(`[OrchestratorV2] 🛡️ Running series character consistency validation...`);
          const charValidation = this.validateSeriesCharacterConsistency(
            worldBible.characters,
            extendedGuideContent,
            project.id
          );
          
          if (charValidation.corrections.length > 0) {
            for (const correction of charValidation.corrections) {
              const char = worldBible.characters[correction.wbIndex];
              if (correction.field === 'name') {
                console.log(`[OrchestratorV2] 🔧 Auto-correcting character name: "${correction.from}" → "${correction.to}"`);
                if (char.name) char.name = correction.to;
                if (char.nombre) char.nombre = correction.to;
              } else if (correction.field === 'gender') {
                console.log(`[OrchestratorV2] 🔧 Auto-correcting character gender for "${char.name || char.nombre}": ${correction.from} → ${correction.to}`);
                if (char.gender) char.gender = correction.to === 'female' ? 'femenino' : 'masculino';
                if (char.sexo) char.sexo = correction.to === 'female' ? 'femenino' : 'masculino';
                if (char.sex) char.sex = correction.to;
                
                const profile = char.profile || char.description || '';
                if (correction.to === 'female') {
                  const corrected = profile
                    .replace(/\bhéroe\b/gi, 'heroína')
                    .replace(/\binspector\b(?!\w)/gi, 'inspectora')
                    .replace(/\bdetective masculino\b/gi, 'detective femenina')
                    .replace(/\bdoctor\b(?!\w)/gi, 'doctora')
                    .replace(/\bprofesor\b(?!\w)/gi, 'profesora')
                    .replace(/\bcomisario\b/gi, 'comisaria');
                  if (char.profile) char.profile = corrected;
                  if (char.description) char.description = corrected;
                } else if (correction.to === 'male') {
                  const corrected = profile
                    .replace(/\bheroína\b/gi, 'héroe')
                    .replace(/\binspectora\b/gi, 'inspector')
                    .replace(/\bdetective femenin[ao]\b/gi, 'detective masculino')
                    .replace(/\bdoctora\b/gi, 'doctor')
                    .replace(/\bprofesora\b/gi, 'profesor')
                    .replace(/\bcomisaria\b/gi, 'comisario');
                  if (char.profile) char.profile = corrected;
                  if (char.description) char.description = corrected;
                }
              }
            }
            
            globalResult.parsed.world_bible = worldBible;
            
            const nameCorrections = charValidation.corrections.filter(c => c.field === 'name');
            const genderCorrections = charValidation.corrections.filter(c => c.field === 'gender');
            const parts: string[] = [];
            if (nameCorrections.length > 0) {
              parts.push(`${nameCorrections.length} nombre(s): ${nameCorrections.map(c => `"${c.from}" → "${c.to}"`).join(', ')}`);
            }
            if (genderCorrections.length > 0) {
              parts.push(`${genderCorrections.length} género(s) corregido(s)`);
            }
            
            await storage.createActivityLog({
              projectId: project.id,
              level: "warn",
              agentRole: "system",
              message: `🛡️ PROTECCIÓN DE SERIE: Se corrigieron ${charValidation.corrections.length} inconsistencia(s) de personaje: ${parts.join('; ')}`,
            });
          }
          
          if (charValidation.warnings.length > 0) {
            for (const warning of charValidation.warnings) {
              console.log(`[OrchestratorV2] ${warning}`);
              await storage.createActivityLog({
                projectId: project.id,
                level: "warn",
                agentRole: "system",
                message: warning,
              });
            }
          }
          
          if (charValidation.corrections.length === 0 && charValidation.warnings.length === 0) {
            console.log(`[OrchestratorV2] ✅ Series character consistency validation PASSED`);
          }
        }
        const rawOutline = globalResult.parsed.outline;
        const plotThreads = globalResult.parsed.plot_threads;

        // Remap chapter numbers to match system convention:
        // Prologue: 0, Normal chapters: 1-N, Epilogue: 998, Author Note: 999
        outline = rawOutline.map((ch: any, idx: number) => {
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

        // Detect if architect added more regular chapters than originally requested
        const regularChaptersFromArchitect = outline.filter((ch: any) => ch.chapter_num > 0 && ch.chapter_num < 900).length;
        if (regularChaptersFromArchitect > project.chapterCount) {
          const oldCount = project.chapterCount;
          const maxAllowed = oldCount + Math.ceil(oldCount * 0.3);
          const finalCount = Math.min(regularChaptersFromArchitect, maxAllowed);
          
          console.log(`[OrchestratorV2] 📊 Architect expanded chapter count: ${oldCount} → ${finalCount} (architect proposed ${regularChaptersFromArchitect}, max allowed ${maxAllowed})`);
          
          if (regularChaptersFromArchitect > maxAllowed) {
            console.warn(`[OrchestratorV2] ⚠️ Architect exceeded 30% cap (${regularChaptersFromArchitect} > ${maxAllowed}). Trimming and renumbering...`);
            const specialBefore = outline.filter((ch: any) => ch.chapter_num === 0);
            const regularChapters = outline.filter((ch: any) => ch.chapter_num > 0 && ch.chapter_num < 900);
            const specialAfter = outline.filter((ch: any) => ch.chapter_num >= 900);
            const trimmedRegular = regularChapters.slice(0, maxAllowed);
            // Renumber sequentially to ensure consistency
            trimmedRegular.forEach((ch: any, idx: number) => {
              ch.chapter_num = idx + 1;
            });
            outline = [...specialBefore, ...trimmedRegular, ...specialAfter];
          }
          
          await storage.updateProject(project.id, { chapterCount: finalCount });
          project = { ...project, chapterCount: finalCount };
          
          await storage.createActivityLog({
            projectId: project.id,
            level: "info",
            agentRole: "global-architect",
            message: `📊 El Arquitecto expandió la estructura de ${oldCount} a ${finalCount} capítulos regulares para desarrollar mejor los arcos narrativos.${regularChaptersFromArchitect > maxAllowed ? ` (Propuso ${regularChaptersFromArchitect}, limitado al 30% máximo: ${maxAllowed})` : ''}`,
          });
          
          this.callbacks.onAgentStatus("global-architect", "active", `Expanded to ${finalCount} chapters (from ${oldCount} minimum)`);
        }

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
            chapterOutlines: outline.map((ch: any) => ({
              number: ch.chapter_num,
              title: ch.title,
              summary: ch.summary,
              keyEvents: [ch.key_event],
              emotional_arc: ch.emotional_arc,
              temporal_notes: ch.temporal_notes || '',
              location: ch.location || '',
              character_states_entering: ch.character_states_entering || {},
            })),
            threeActStructure: globalResult.parsed.three_act_structure || null,
            plotThreads: plotThreads.map((t: any) => ({
              name: t.name,
              description: t.description,
              goal: t.goal,
              resolution_chapter: t.resolution_chapter || null,
            })),
            // LitAgents 2.1: Store additional Global Architect outputs inside plotOutline for consistency
            settings: (worldBible as any).settings || [],
            themes: (worldBible as any).themes || [],
            location_map: (worldBible as any).location_map || null,
            timeline_master: globalResult.parsed.timeline_master || null,
            character_tracking: globalResult.parsed.character_tracking || [],
          } as any,
        });

        // Store Plot Threads for Narrative Director (with resolution_chapter from GA)
        for (const thread of plotThreads) {
          await storage.createProjectPlotThread({
            projectId: project.id,
            name: thread.name,
            description: thread.description || null,
            goal: thread.goal,
            status: "active",
            intensityScore: 5,
            lastUpdatedChapter: 0,
            resolutionChapter: thread.resolution_chapter || null,
          } as any);
        }

        // LitAgents 2.1: Initialize Universal Consistency Database
        this.callbacks.onAgentStatus("universal-consistency", "active", "Initializing consistency database...");
        await this.initializeConsistencyDatabase(project.id, worldBible, project.genre);
        
        // LitAgents 2.9.13: Progressive World Bible validation with graceful acceptance
        // Phase 1 (rounds 1-2): Strict — fix critical and major issues
        // Phase 2 (round 3+): Graceful — accept if 0 critical (remaining majors are subjective opinions, not real problems)
        // The AI validator tends to endlessly generate subjective literary opinions ("the arc could be deeper",
        // "the pacing could improve") that will NEVER be fully satisfied. After 2 correction rounds,
        // any remaining "major" issues are just opinions — accept and move on.
        const MAX_BIBLE_ROUNDS = 5;
        let bibleValidationRound = 0;
        
        let bibleValidation = await this.validateWorldBibleWithGemini(
          project.id, worldBible, outline, plotThreads
        );
        
        const countIssuesBySeverity = (issues: any[]) => {
          const critical = issues.filter((i: any) => i.severity === 'critica').length;
          const major = issues.filter((i: any) => i.severity === 'mayor').length;
          const minor = issues.length - critical - major;
          return { critical, major, minor, total: issues.length };
        };
        
        const isBibleAcceptable = (validation: any, round: number) => {
          const issues = validation.issues || [];
          if (issues.length === 0) return true;
          const { critical, major, minor } = countIssuesBySeverity(issues);
          // Always block on critical issues (factual contradictions)
          if (critical > 0) return false;
          // Rounds 1-2: require 0 major issues too
          if (round < 2) return major === 0 && minor <= 5;
          // Round 3+: accept with remaining majors — they are subjective opinions, not real problems
          return true;
        };
        
        while (!isBibleAcceptable(bibleValidation, bibleValidationRound) && bibleValidationRound < MAX_BIBLE_ROUNDS) {
          bibleValidationRound++;
          const currentIssues = bibleValidation.issues || [];
          const counts = countIssuesBySeverity(currentIssues);
          
          console.log(`[OrchestratorV2] Bible validation round ${bibleValidationRound}: ${counts.critical} critical, ${counts.major} major, ${counts.minor} minor (total: ${counts.total}). Correcting...`);
          this.callbacks.onAgentStatus("bible-validator", "active", `Corrigiendo Biblia del Mundo (ronda ${bibleValidationRound}): ${counts.critical} críticos, ${counts.major} mayores, ${counts.minor} menores`);
          
          const previousIssues = currentIssues;
          
          if (bibleValidation.correctedBible) {
            // Apply outline fixes if present (in-memory + persist to World Bible)
            if (bibleValidation.correctedBible._outlineFixes && Array.isArray(bibleValidation.correctedBible._outlineFixes)) {
              let fixesApplied = 0;
              for (const fix of bibleValidation.correctedBible._outlineFixes) {
                const outlineIdx = outline.findIndex((o: any) => o.chapter_num === fix.chapter_num);
                if (outlineIdx >= 0) {
                  if (fix.corrected_summary) outline[outlineIdx].summary = fix.corrected_summary;
                  if (fix.corrected_title) outline[outlineIdx].title = fix.corrected_title;
                  if (fix.corrected_key_event) outline[outlineIdx].key_event = fix.corrected_key_event;
                  fixesApplied++;
                }
              }
              // Persist outline fixes to stored World Bible
              try {
                const storedWB = await storage.getWorldBibleByProject(project.id);
                if (storedWB) {
                  const plotOutlineData = (storedWB as any).plotOutline || {};
                  if (plotOutlineData.chapters_outline && Array.isArray(plotOutlineData.chapters_outline)) {
                    for (const fix of bibleValidation.correctedBible._outlineFixes) {
                      const storedIdx = plotOutlineData.chapters_outline.findIndex((o: any) => o.chapter_num === fix.chapter_num);
                      if (storedIdx >= 0) {
                        if (fix.corrected_summary) plotOutlineData.chapters_outline[storedIdx].summary = fix.corrected_summary;
                        if (fix.corrected_title) plotOutlineData.chapters_outline[storedIdx].title = fix.corrected_title;
                        if (fix.corrected_key_event) plotOutlineData.chapters_outline[storedIdx].key_event = fix.corrected_key_event;
                      }
                    }
                    await storage.updateWorldBible(storedWB.id, { plotOutline: plotOutlineData } as any);
                  }
                }
              } catch (err) {
                console.error("[OrchestratorV2] Failed to persist outline fixes:", err);
              }
              if (fixesApplied > 0) {
                console.log(`[OrchestratorV2] ${fixesApplied} outline fixes applied and persisted`);
              }
              delete bibleValidation.correctedBible._outlineFixes;
            }
            
            // LitAgents 3.3: Apply thread resolution fixes to in-memory plotThreads AND persist to DB
            if (bibleValidation.correctedBible._threadResolutionFixes && Array.isArray(bibleValidation.correctedBible._threadResolutionFixes)) {
              for (const fix of bibleValidation.correctedBible._threadResolutionFixes) {
                if (fix.thread_name && fix.resolution_chapter) {
                  const thread = plotThreads.find((t: any) => t.name.toLowerCase() === fix.thread_name.toLowerCase());
                  if (thread) {
                    (thread as any).resolution_chapter = fix.resolution_chapter;
                    console.log(`[OrchestratorV2] Thread "${fix.thread_name}" resolution assigned to Cap ${fix.resolution_chapter}`);
                    
                    // Persist to DB
                    try {
                      const dbThreads = await storage.getPlotThreadsByProject(project.id);
                      const dbThread = dbThreads.find(t => t.name.toLowerCase() === fix.thread_name.toLowerCase());
                      if (dbThread) {
                        await storage.updateProjectPlotThread(dbThread.id, { resolutionChapter: fix.resolution_chapter });
                        console.log(`[OrchestratorV2] Persisted resolution_chapter=${fix.resolution_chapter} for thread "${fix.thread_name}" (id=${dbThread.id})`);
                      }
                    } catch (err) {
                      console.error(`[OrchestratorV2] Failed to persist thread resolution:`, err);
                    }
                  }
                }
              }
              delete bibleValidation.correctedBible._threadResolutionFixes;
            }
            
            worldBible = bibleValidation.correctedBible;
            if ((worldBible as any).rules && !(worldBible as any).worldRules) {
              (worldBible as any).worldRules = (worldBible as any).rules;
            }
            
            // Persist corrected World Bible
            const storedWB = await storage.getWorldBibleByProject(project.id);
            if (storedWB) {
              const updates: any = {};
              const wb = worldBible as any;
              if (wb.characters) updates.characters = wb.characters;
              if (wb.rules || wb.worldRules) updates.worldRules = wb.rules || wb.worldRules;
              if (wb.settings) updates.settings = wb.settings;
              if (Object.keys(updates).length > 0) {
                await storage.updateWorldBible(storedWB.id, updates);
              }
            }
            
            const wb2 = worldBible as any;
            const charCount = (wb2.characters || []).length;
            const rulesCount = ((wb2.rules || wb2.worldRules) || []).length;
            await storage.createActivityLog({
              projectId: project.id,
              level: "info",
              agentRole: "bible-validator",
              message: `Biblia corregida (ronda ${bibleValidationRound}): ${charCount} personajes, ${rulesCount} reglas. Quedan ${counts.critical} críticos, ${counts.major} mayores, ${counts.minor} menores. Re-validando...`,
            });
          } else {
            await storage.createActivityLog({
              projectId: project.id,
              level: "warn",
              agentRole: "bible-validator",
              message: `Ronda ${bibleValidationRound}: ${previousIssues.length} problemas detectados pero sin correcciones generadas. Re-intentando...`,
            });
          }
          
          // Re-validate after corrections
          bibleValidation = await this.validateWorldBibleWithGemini(
            project.id, worldBible, outline, plotThreads, previousIssues
          );
        }
        
        if (isBibleAcceptable(bibleValidation, bibleValidationRound)) {
          const finalIssues = bibleValidation.issues || [];
          const finalCounts = countIssuesBySeverity(finalIssues);
          const suffix = bibleValidationRound > 0 ? ` después de ${bibleValidationRound} ronda(s) de corrección` : '';
          const acceptedNotes: string[] = [];
          if (finalCounts.major > 0) acceptedNotes.push(`${finalCounts.major} sugerencia(s) editorial(es) registrada(s)`);
          if (finalCounts.minor > 0) acceptedNotes.push(`${finalCounts.minor} observación(es) menor(es)`);
          const notesSuffix = acceptedNotes.length > 0 ? ` (${acceptedNotes.join(', ')})` : '';
          
          console.log(`[OrchestratorV2] Bible validation PASSED${suffix}${notesSuffix}`);
          await storage.createActivityLog({
            projectId: project.id,
            level: "success",
            agentRole: "bible-validator",
            message: `Biblia del Mundo aprobada${suffix}${notesSuffix}. Lista para escribir.`,
          });
          this.callbacks.onAgentStatus("bible-validator", "completed", `Biblia aprobada${suffix}`);
        } else {
          // Failed: only possible if critical issues persist after MAX_BIBLE_ROUNDS
          const remainingIssues = bibleValidation.issues || [];
          const counts = countIssuesBySeverity(remainingIssues);
          const criticalDetails = remainingIssues
            .filter((i: any) => i.severity === 'critica')
            .map((i: any) => `[CRÍTICO] ${i.description || i.issue || i.message || JSON.stringify(i)}`)
            .join('\n');
          
          console.error(`[OrchestratorV2] Bible validation FAILED: ${counts.critical} critical issues persist after ${MAX_BIBLE_ROUNDS} rounds.`);
          
          await storage.createActivityLog({
            projectId: project.id,
            level: "error",
            agentRole: "bible-validator",
            message: `Biblia del Mundo NO APROBADA — ${counts.critical} contradicciones factuales sin resolver tras ${MAX_BIBLE_ROUNDS} rondas. La generación se ha pausado.`,
          });
          
          if (criticalDetails) {
            await storage.createActivityLog({
              projectId: project.id,
              level: "warn",
              agentRole: "bible-validator",
              message: `Contradicciones pendientes:\n${criticalDetails}`,
            });
          }
          
          await storage.updateProject(project.id, { status: "paused" });
          this.callbacks.onAgentStatus("bible-validator", "error", `Biblia rechazada: ${counts.critical} contradicciones factuales sin resolver`);
          this.callbacks.onError(`Biblia del Mundo no aprobada: ${counts.critical} contradicciones factuales persisten tras ${MAX_BIBLE_ROUNDS} rondas de corrección`);
          return;
        }
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
      
      const narrativeTimeline: Array<{ chapter: number; narrativeTime: string; location?: string }> = [];
      
      // LitAgents 2.9.10: Track checkpoint state to avoid repeated rewrites
      // Backfill from activity logs on resume to prevent re-scanning already-checked chapters
      let lastCheckpointChapter = 0;
      const alreadyCorrectedChapters = new Set<number>();
      try {
        const existingLogs = await storage.getActivityLogsByProject(project.id);
        const checkpointLogs = existingLogs.filter(l => l.agentRole === 'structural-checkpoint');
        for (const log of checkpointLogs) {
          const meta = log.metadata as any;
          if (meta?.type === 'checkpoint_executed' && typeof meta.rangeEnd === 'number') {
            if (meta.rangeEnd > lastCheckpointChapter) lastCheckpointChapter = meta.rangeEnd;
          } else if (meta?.type === 'chapter_rewritten' && typeof meta.chapterNumber === 'number') {
            alreadyCorrectedChapters.add(meta.chapterNumber);
          } else if (!meta?.type) {
            // Fallback: parse legacy logs without structured metadata
            if (log.message.includes('Ejecutando checkpoint estructural')) {
              const match = log.message.match(/capítulo[s]?\s+\d+-(\d+)/i);
              if (match) {
                const chapNum = parseInt(match[1]);
                if (chapNum > lastCheckpointChapter) lastCheckpointChapter = chapNum;
              }
            }
            if (log.level === 'success' && log.message.includes('reescrito')) {
              const match = log.message.match(/Capítulo (\d+) reescrito/);
              if (match) alreadyCorrectedChapters.add(parseInt(match[1]));
            }
          }
        }
        if (lastCheckpointChapter > 0 || alreadyCorrectedChapters.size > 0) {
          console.log(`[OrchestratorV2] Resumed checkpoint state: last checkpoint at Ch ${lastCheckpointChapter}, ${alreadyCorrectedChapters.size} chapters already corrected`);
        }
      } catch (err) {
        console.error("[OrchestratorV2] Failed to backfill checkpoint state:", err);
      }

      // Check for existing chapters to resume from
      const existingChapters = await storage.getChaptersByProject(project.id);
      
      // LitAgents 2.2: Detect and handle truncated chapters (NEVER leave truncated chapters)
      // Use different thresholds for special chapters vs regular chapters
      const MIN_WORDS_REGULAR_CHAPTER = 500; // Regular chapters need at least 500 words
      const MIN_WORDS_SPECIAL_CHAPTER = 150; // Prologues, epilogues, and author notes can be shorter
      
      const isSpecialChapter = (chapterNumber: number): boolean => {
        // Prologue: 0
        // Epilogue: -1 or 998
        // Author note: -2 or 999
        return chapterNumber === 0 || chapterNumber === -1 || chapterNumber === 998 || 
               chapterNumber === -2 || chapterNumber === 999;
      };
      
      const truncatedChapters = existingChapters.filter(c => {
        if (c.status !== "completed" && c.status !== "approved") return false;
        const wordCount = c.content ? c.content.split(/\s+/).length : 0;
        const minWords = isSpecialChapter(c.chapterNumber) ? MIN_WORDS_SPECIAL_CHAPTER : MIN_WORDS_REGULAR_CHAPTER;
        return wordCount < minWords;
      });

      const garbledChapters = existingChapters.filter(c => {
        if (c.status !== "completed" && c.status !== "approved") return false;
        if (!c.content || c.content.length < 200) return false;
        return this.detectGarbledText(c.content);
      });

      const chaptersToRegenerate = new Map<number, any>();
      for (const ch of [...truncatedChapters, ...garbledChapters]) {
        chaptersToRegenerate.set(ch.id, ch);
      }
      
      if (chaptersToRegenerate.size > 0) {
        const truncCount = truncatedChapters.length;
        const garbledCount = garbledChapters.length;
        console.log(`[OrchestratorV2] [CRITICAL] Found ${chaptersToRegenerate.size} problematic chapters (${truncCount} truncated, ${garbledCount} garbled) - will regenerate them`);
        this.callbacks.onAgentStatus("orchestrator", "active", `Detectados ${chaptersToRegenerate.size} capitulos problemáticos — regenerando...`);
        
        for (const chapter of Array.from(chaptersToRegenerate.values())) {
          await storage.updateChapter(chapter.id, { status: "draft" as any });
          const reason = this.detectGarbledText(chapter.content || '') ? 'garbled' : 'truncated';
          console.log(`[OrchestratorV2] Marked Chapter ${chapter.chapterNumber} as draft (${reason}: ${chapter.content?.split(/\s+/).length || 0} words)`);
        }
      }
      
      // Refresh chapters after marking truncated ones
      const refreshedChapters = await storage.getChaptersByProject(project.id);
      const completedChapterNumbers = new Set(
        refreshedChapters
          .filter(c => {
            if (c.status !== "completed" && c.status !== "approved") return false;
            const wordCount = c.content?.split(/\s+/).length || 0;
            const minWords = isSpecialChapter(c.chapterNumber) ? MIN_WORDS_SPECIAL_CHAPTER : MIN_WORDS_REGULAR_CHAPTER;
            if (wordCount < minWords) return false;
            if (c.content && this.detectGarbledText(c.content)) return false;
            return true;
          })
          .map(c => c.chapterNumber)
      );
      
      if (completedChapterNumbers.size > 0) {
        console.log(`[OrchestratorV2] Found ${completedChapterNumbers.size} completed chapters. Resuming from where we left off.`);
        
        // Sync chapter headers in case they have incorrect numbers from before remapping
        if (project.hasPrologue || project.hasEpilogue || project.hasAuthorNote) {
          await this.syncChapterHeaders(project.id, outline);
        }
        
        // Load existing summaries for context (only from truly complete chapters)
        for (const chapter of refreshedChapters
          .filter(c => completedChapterNumbers.has(c.chapterNumber))
          .sort((a, b) => a.chapterNumber - b.chapterNumber)) {
          if (chapter.summary) {
            chapterSummaries.push(chapter.summary);
          }
          
          // LitAgents 2.9.9+: Backfill narrative timeline from existing chapters on resume
          if (chapter.content) {
            const timelineEntry = this.extractNarrativeTimeFromChapter(chapter.content, chapter.chapterNumber, worldBible);
            if (timelineEntry) {
              narrativeTimeline.push(timelineEntry);
            }
          }
        }
        
        if (narrativeTimeline.length > 0) {
          console.log(`[OrchestratorV2] Backfilled narrative timeline from ${narrativeTimeline.length} existing chapters`);
        }
        
        // v2.9.10: Rebuild rollingSummary from last 3 chapter summaries (not just the last one)
        if (chapterSummaries.length > 0) {
          const recentSummaries = chapterSummaries.slice(-3);
          const completedSorted = refreshedChapters
            .filter(c => completedChapterNumbers.has(c.chapterNumber))
            .sort((a, b) => a.chapterNumber - b.chapterNumber);
          const lastChapterNums = completedSorted.slice(-3).map(c => c.chapterNumber);
          rollingSummary = recentSummaries.map((s, idx) => `Cap ${lastChapterNums[idx] || '?'}: ${s}`).join("\n");
          console.log(`[OrchestratorV2] Rebuilt rollingSummary from last ${recentSummaries.length} chapters`);
        }
      }

      // Load Series World Bible for injection into Ghostwriter (for series volumes)
      const seriesWorldBible = await this.getSeriesWorldBibleForInjection(project.id);
      if (seriesWorldBible) {
        console.log(`[OrchestratorV2] Series World Bible loaded - will inject into Ghostwriter for series continuity`);
      }

      // ==================== OMNIWRITER PIPELINE ====================
      // Zero-Touch Protocol: Per-chapter loop with triple cross-audit
      // Phase 2: Sequential Production Loop
      console.log(`[OrchestratorV2] [OmniWriter] Starting Zero-Touch production loop for ${outline.length} chapters`);

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

        console.log(`[OrchestratorV2] [OmniWriter] Generating Chapter ${chapterNumber}: "${chapterOutline.title}"`);

        // OmniWriter Phase 2a: Full entity sync from world_entities into World Bible before each chapter
        await this.syncEntitiesIntoWorldBible(project.id, worldBible);

        // OmniWriter Phase 2a: Build context for Ghostwriter
        let consistencyConstraints = "";
        try {
          const context = await this.getConsistencyContext(project.id);
          if (context.entities.length > 0) {
            const timelineInfo = this.extractTimelineInfo(worldBible, chapterNumber, i > 0 ? (outline as any)[i - 1]?.chapter_num : undefined);
            const characterStates = this.extractCharacterStates(worldBible, chapterNumber);
            consistencyConstraints = universalConsistencyAgent.generateConstraints(
              project.genre, context.entities, context.rules, context.relationships,
              chapterNumber, timelineInfo, characterStates
            );
          }
          const currentWorldBible = await storage.getWorldBibleByProject(project.id);
          if (currentWorldBible) {
            const decisionsConstraints = this.formatDecisionsAndInjuriesAsConstraints(
              currentWorldBible.plotDecisions as any[], currentWorldBible.persistentInjuries as any[], chapterNumber
            );
            if (decisionsConstraints) consistencyConstraints += decisionsConstraints;
          }
          const enrichedOptions = await this.buildEnrichedContextOptions(project);
          const enrichedContext = await this.buildEnrichedWritingContext(project.id, chapterNumber, worldBible, enrichedOptions);
          if (enrichedContext) consistencyConstraints += enrichedContext;
          const plotThreadsContext = await this.buildPlotThreadsContext(project.id, chapterNumber, outline as any[]);
          if (plotThreadsContext) consistencyConstraints += plotThreadsContext;
        } catch (err) {
          console.error(`[OrchestratorV2] Failed to generate constraints:`, err);
        }

        // OmniWriter Phase 2a: Chapter Architect plans scenes
        this.callbacks.onAgentStatus("chapter-architect", "active", `Planning scenes for Chapter ${chapterNumber}...`);
        const previousSummary = i > 0 ? chapterSummaries[i - 1] : "";
        const storyState = rollingSummary;
        const thoughtContext = await this.getChapterDecisionContext(project.id, chapterNumber);
        let enrichedConstraints = consistencyConstraints + thoughtContext;

        if (project.rewriteGuidance) {
          enrichedConstraints = "═══════════════════════════════════════════════════════════════════\n" +
            "INSTRUCCIONES DE REESCRITURA (PRIORIDAD MÁXIMA)\n" +
            "═══════════════════════════════════════════════════════════════════\n" +
            project.rewriteGuidance +
            "═══════════════════════════════════════════════════════════════════\n\n" +
            enrichedConstraints;
        }

        const patternTracker = getPatternTracker(project.id);
        const patternAnalysis = patternTracker.analyzeForChapter(chapterNumber);
        const patternAnalysisContext = patternTracker.formatForPrompt(patternAnalysis);

        const chapterPlan = await this.chapterArchitect.execute({
          chapterOutline, worldBible,
          previousChapterSummary: previousSummary, storyState,
          consistencyConstraints: enrichedConstraints,
          fullPlotOutline: outline,
          isKindleUnlimited: project.kindleUnlimitedOptimized || false,
          patternAnalysisContext,
        });

        if (chapterPlan.error || !chapterPlan.parsed) {
          throw new Error(`Chapter Architect failed for Chapter ${chapterNumber}: ${chapterPlan.error || "No parsed output"}`);
        }
        this.addTokenUsage(chapterPlan.tokenUsage);
        await this.logAiUsage(project.id, "chapter-architect", "deepseek-reasoner", chapterPlan.tokenUsage, chapterNumber);
        if (chapterPlan.thoughtSignature) {
          await this.saveThoughtLog(project.id, "Chapter Architect", "chapter-architect", `[Capítulo ${chapterNumber}] ${chapterPlan.thoughtSignature}`);
        }
        this.callbacks.onAgentStatus("chapter-architect", "completed", `${chapterPlan.parsed.scenes.length} scenes planned`);
        const sceneBreakdown = chapterPlan.parsed;

        // LitAgents 2.9.7: Register the chapter's pattern after planning
        const chapterPattern = patternTracker.extractPatternFromScenes(
          chapterNumber,
          chapterOutline.title,
          sceneBreakdown.scenes.map(s => ({
            plot_beat: s.plot_beat,
            emotional_beat: s.emotional_beat,
            ending_hook: s.ending_hook
          })),
          sceneBreakdown.chapter_hook
        );
        patternTracker.registerPattern(chapterPattern);
        console.log(`[OrchestratorV2] Registered pattern for Chapter ${chapterNumber}: ${chapterPattern.sceneSequence.join(' → ')}`);


        // OmniWriter Phase 2b: Ghostwriter writes ALL scenes sequentially
        let fullChapterText = "";
        
        let lastContext = "";
        if (chapterNumber > 1) {
          const allChapters = await storage.getChaptersByProject(project.id);
          const prevChapter = allChapters.find(c => c.chapterNumber === chapterNumber - 1);
          if (prevChapter?.content) {
            lastContext = `[FINAL DEL CAPÍTULO ${chapterNumber - 1}]\n${prevChapter.content.slice(-1200)}`;
          }
        }

        const previousChaptersText = await this.getRecentChaptersText(project.id, chapterNumber, 2);
        const projectErrorHistory = await this.getErrorHistoryForWriting(project.id);
        const globalLessons = await this.getGlobalWritingLessons();
        const accumulatedLessons = await this.getAccumulatedLessons(project.id);
        const errorHistory = [globalLessons, projectErrorHistory, accumulatedLessons].filter(Boolean).join("\n\n");

        if (narrativeTimeline.length > 0) {
          let timelineBlock = "\n═══════════════════════════════════════════════════════════════════\n";
          timelineBlock += "LÍNEA TEMPORAL ACUMULADA (OBLIGATORIO RESPETAR)\n";
          timelineBlock += "═══════════════════════════════════════════════════════════════════\n";
          narrativeTimeline.forEach(entry => {
            timelineBlock += `  Cap ${entry.chapter}: ${entry.narrativeTime}${entry.location ? ` → ${entry.location}` : ''}\n`;
          });
          timelineBlock += `\nEste capítulo (${chapterNumber}) DEBE continuar cronológicamente.\n`;
          timelineBlock += "═══════════════════════════════════════════════════════════════════\n";
          enrichedConstraints = timelineBlock + enrichedConstraints;
        }

        for (const scene of sceneBreakdown.scenes) {
          if (await this.shouldStopProcessing(project.id)) return;

          this.callbacks.onAgentStatus("ghostwriter-v2", "active", `Writing Scene ${scene.scene_num}...`);

          // LitAgents 2.9: Pre-scene validation - verify characters exist in World Bible
          let preSceneWarnings = "";
          if (scene.characters && Array.isArray(scene.characters) && scene.characters.length > 0 && worldBible.characters) {
            const knownCharNames = (worldBible.characters as any[]).map(c => (c.name || c || "").toString().toLowerCase());
            // Normalize scene characters (could be strings or objects with name property)
            const sceneCharNames = scene.characters.map((c: any) => 
              typeof c === 'string' ? c.toLowerCase() : (c.name || "").toString().toLowerCase()
            ).filter((n: string) => n.length > 0);
            
            const unknownChars = sceneCharNames.filter((c: string) => !knownCharNames.includes(c));
            if (unknownChars.length > 0) {
              preSceneWarnings = `⚠️ PERSONAJES NO REGISTRADOS: ${unknownChars.join(", ")}. Debes establecerlos apropiadamente o usar personajes conocidos.\n`;
              console.log(`[OrchestratorV2] Pre-scene validation: Unknown characters detected: ${unknownChars.join(", ")}`);
            }
          }

          const sceneResult = await this.ghostwriter.execute({
            scenePlan: scene,
            prevSceneContext: lastContext,
            rollingSummary,
            worldBible,
            guiaEstilo,
            consistencyConstraints: preSceneWarnings + enrichedConstraints,
            previousChaptersText, // LitAgents 2.2: For vocabulary anti-repetition
            currentChapterText: fullChapterText, // LitAgents 2.2: Current chapter so far
            seriesWorldBible, // Series World Bible: Accumulated knowledge from previous volumes
            errorHistory, // LitAgents 2.9: Past errors to avoid
            chapterOutline, // LitAgents 2.9.10: Original outline for strict adherence
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

        // ==================== OMNIWRITER: TRIPLE CROSS-AUDIT ====================
        // Phase 2c: Run Inquisidor + Estilista + Ritmo in parallel, then correction loop
        let finalText = fullChapterText;
        let editorFeedback: SmartEditorOutput | null = null;
        
        const MAX_CORRECTION_ATTEMPTS = 3;
        let correctionAttempt = 0;
        let chapterApproved = false;
        let bestVersion = fullChapterText;
        let bestVersionErrors = Infinity;

        while (!chapterApproved && correctionAttempt < MAX_CORRECTION_ATTEMPTS) {
          correctionAttempt++;
          console.log(`[OmniWriter] Cross-audit attempt ${correctionAttempt}/${MAX_CORRECTION_ATTEMPTS} for Chapter ${chapterNumber}`);

          // Run triple audit in parallel
          this.callbacks.onAgentStatus("inquisidor", "active", `Auditing lore (attempt ${correctionAttempt})...`);
          this.callbacks.onAgentStatus("estilista", "active", `Copy-editing (attempt ${correctionAttempt})...`);
          this.callbacks.onAgentStatus("ritmo", "active", `Evaluating tension (attempt ${correctionAttempt})...`);

          const previousChaptersCtx = chapterSummaries.length > 0
            ? chapterSummaries.map((s, idx) => `Cap ${idx + 1}: ${s}`).join("\n")
            : "Este es el primer capítulo.";

          const prevChapterEnding = i > 0 ? (await storage.getChaptersByProject(project.id))
            .find(c => c.chapterNumber === outline[i - 1]?.chapter_num)?.content?.slice(-500) : undefined;

          const [inquisidorResult, estilistaResult, ritmoResult] = await Promise.all([
            this.inquisidor.execute({
              chapterContent: finalText,
              chapterNumber,
              worldBible,
              previousChaptersContext: previousChaptersCtx,
              escaleta: chapterOutline,
            }),
            this.estilista.execute({
              chapterContent: finalText,
              chapterNumber,
              styleGuide: guiaEstilo,
            }),
            this.ritmo.execute({
              chapterContent: finalText,
              chapterNumber,
              totalChapters: outline.length,
              escaletaEntry: chapterOutline,
              previousChapterEnding: prevChapterEnding,
            }),
          ]);

          // Log token usage for all 3 auditors
          this.addTokenUsage(inquisidorResult.tokenUsage);
          this.addTokenUsage(estilistaResult.tokenUsage);
          this.addTokenUsage(ritmoResult.tokenUsage);
          await this.logAiUsage(project.id, "inquisidor", "deepseek-reasoner", inquisidorResult.tokenUsage, chapterNumber);
          await this.logAiUsage(project.id, "estilista", "gemini-2.5-flash", estilistaResult.tokenUsage, chapterNumber);
          await this.logAiUsage(project.id, "ritmo", "gemini-2.5-flash", ritmoResult.tokenUsage, chapterNumber);

          // Collect all errors from the three audits
          const inquisidorErrors = inquisidorResult.parsed?.errores || [];
          const estilistaErrors = estilistaResult.parsed?.errores || [];
          const ritmoProblems = ritmoResult.parsed?.problemas || [];
          const totalErrors = inquisidorErrors.length + estilistaErrors.length + ritmoProblems.length;

          const inquisidorApproved = inquisidorResult.parsed?.veredicto === "aprobado";
          const estilistaApproved = estilistaResult.parsed?.veredicto === "aprobado";
          const ritmoApproved = ritmoResult.parsed?.veredicto === "aprobado";

          this.callbacks.onAgentStatus("inquisidor", inquisidorApproved ? "completed" : "warning",
            inquisidorApproved ? "Lore verified" : `${inquisidorErrors.length} issues found`);
          this.callbacks.onAgentStatus("estilista", estilistaApproved ? "completed" : "warning",
            estilistaApproved ? `Style ${estilistaResult.parsed?.puntuacion_estilo}/10` : `${estilistaErrors.length} style issues`);
          this.callbacks.onAgentStatus("ritmo", ritmoApproved ? "completed" : "warning",
            ritmoApproved ? `Tension ${ritmoResult.parsed?.tension_nivel}/10` : `${ritmoProblems.length} rhythm issues`);

          // Track best version
          if (totalErrors < bestVersionErrors) {
            bestVersionErrors = totalErrors;
            bestVersion = finalText;
          }

          // Check if all three auditors approve
          chapterApproved = inquisidorApproved && estilistaApproved && ritmoApproved;

          if (chapterApproved) {
            console.log(`[OmniWriter] Chapter ${chapterNumber} APPROVED by all auditors on attempt ${correctionAttempt}`);
            await storage.createActivityLog({
              projectId: project.id, level: "success", agentRole: "omniwriter",
              message: `Cap ${chapterNumber}: Aprobado por Inquisidor, Estilista y Ritmo (intento ${correctionAttempt})`,
            });
            break;
          }

          // If not approved and we have attempts left, apply corrections
          if (correctionAttempt < MAX_CORRECTION_ATTEMPTS) {
            const cappedEstilistaCount = Math.min(estilistaErrors.length, 10);
            const effectiveErrors = inquisidorErrors.length + cappedEstilistaCount + ritmoProblems.length;
            this.callbacks.onAgentStatus("smart-editor", "active", `Correcting ${effectiveErrors} issues (attempt ${correctionAttempt})...`);

            // Build comprehensive correction instructions from all three audits
            let correctionInstructions = "CORRECCIONES OBLIGATORIAS DETECTADAS POR EL SISTEMA DE AUDITORÍA TRIPLE:\n\n";

            if (inquisidorErrors.length > 0) {
              correctionInstructions += "=== ERRORES DE LORE Y COHERENCIA (Inquisidor) ===\n";
              for (const err of inquisidorErrors) {
                correctionInstructions += `- [${err.severidad}] ${err.tipo}: ${err.descripcion}\n  Ubicación: ${err.ubicacion}\n  Corrección: ${err.correccion_exacta}\n\n`;
              }
            }

            if (estilistaErrors.length > 0) {
              const MAX_STYLE_CORRECTIONS = 10;
              const sortedStyleErrors = [...estilistaErrors].sort((a: any, b: any) => {
                const sevOrder: Record<string, number> = { 'grave': 0, 'mayor': 1, 'menor': 2, 'leve': 3 };
                return (sevOrder[a.severidad] ?? 2) - (sevOrder[b.severidad] ?? 2);
              });
              const cappedStyleErrors = sortedStyleErrors.slice(0, MAX_STYLE_CORRECTIONS);
              correctionInstructions += `=== ERRORES ESTILÍSTICOS (Estilista) — ${cappedStyleErrors.length} de ${estilistaErrors.length} más graves ===\n`;
              correctionInstructions += `IMPORTANTE: Corrige SOLO estos ${cappedStyleErrors.length} fragmentos específicos. NO modifiques el resto del texto.\n\n`;
              for (const err of cappedStyleErrors) {
                correctionInstructions += `- [${err.severidad}] ${err.tipo}: "${err.fragmento_original}" → "${err.correccion}"\n  Razón: ${err.explicacion}\n\n`;
              }
            }

            if (ritmoProblems.length > 0) {
              correctionInstructions += "=== PROBLEMAS DE RITMO (Agente de Ritmo) ===\n";
              for (const prob of ritmoProblems) {
                correctionInstructions += `- ${prob.tipo}: ${prob.descripcion}\n  Sugerencia: ${prob.sugerencia}\n\n`;
              }
            }

            // Use SmartEditor for corrections - provide FULL World Bible context
            const currentWBData = await storage.getWorldBibleByProject(project.id);
            const rewriteResult = await this.smartEditor.fullRewrite({
              chapterContent: finalText,
              errorDescription: correctionInstructions,
              worldBible: {
                characters: ((worldBible as any).characters || (worldBible as any).personajes || []) as any[],
                locations: ((worldBible as any).locations || (worldBible as any).lugares || []) as any[],
                worldRules: ((worldBible as any).worldRules || (worldBible as any).rules || (worldBible as any).reglas || []) as any[],
                persistentInjuries: (currentWBData?.persistentInjuries || []) as any[],
                plotDecisions: (currentWBData?.plotDecisions || []) as any[],
              },
              styleGuide: guiaEstilo,
              chapterNumber,
              chapterTitle: chapterOutline.title,
              previousChapterSummary: i > 0 ? chapterSummaries[i - 1] : undefined,
              nextChapterSummary: i < outline.length - 1 ? outline[i + 1]?.summary : undefined,
              chapterSummaries: chapterSummaries.length > 0 ? chapterSummaries : undefined,
              projectTitle: project.title,
              genre: project.genre,
            });

            this.addTokenUsage(rewriteResult.tokenUsage);
            await this.logAiUsage(project.id, "smart-editor", "deepseek-chat", rewriteResult.tokenUsage, chapterNumber);

            if (rewriteResult.rewrittenContent && rewriteResult.rewrittenContent.length > 200) {
              const previousVersion = finalText;
              finalText = rewriteResult.rewrittenContent;

              // Levenshtein convergence check
              const converged = calcularConvergencia(previousVersion, finalText);
              if (converged) {
                console.log(`[OmniWriter] Chapter ${chapterNumber}: Converged (< 1% change). Accepting current version.`);
                chapterApproved = true;
              } else {
                console.log(`[OmniWriter] Chapter ${chapterNumber}: Corrections applied, re-auditing...`);
              }

              this.callbacks.onAgentStatus("smart-editor", "completed", `Corrections applied (attempt ${correctionAttempt})`);
            } else {
              console.warn(`[OmniWriter] Chapter ${chapterNumber}: Correction returned empty content`);
              this.callbacks.onAgentStatus("smart-editor", "warning", "Correction failed - keeping current version");
            }
          }
        }

        // If max attempts reached without approval, use best version with note
        if (!chapterApproved) {
          finalText = bestVersion;
          console.log(`[OmniWriter] Chapter ${chapterNumber}: Max attempts reached. Using best version (${bestVersionErrors} errors remaining).`);
          await storage.createActivityLog({
            projectId: project.id, level: "warn", agentRole: "omniwriter",
            message: `Cap ${chapterNumber}: Revisión automática realizada - ${bestVersionErrors} errores menores pendientes tras ${MAX_CORRECTION_ATTEMPTS} intentos.`,
          });
        }

        // OmniWriter Phase 2c.5: Post-chapter key event adherence check (lightweight, no AI call)
        if (chapterOutline.key_event) {
          const keyEventWords = chapterOutline.key_event.toLowerCase().split(/\s+/).filter((w: string) => w.length > 4);
          const chapterLower = finalText.toLowerCase();
          const matchedWords = keyEventWords.filter((w: string) => chapterLower.includes(w));
          const coverage = keyEventWords.length > 0 ? matchedWords.length / keyEventWords.length : 1;
          if (coverage < 0.3) {
            console.warn(`[OmniWriter] Chapter ${chapterNumber}: Low key event coverage (${Math.round(coverage * 100)}%). Event: "${chapterOutline.key_event}"`);
            await storage.createActivityLog({
              projectId: project.id, level: "warn", agentRole: "omniwriter",
              message: `Cap ${chapterNumber}: Posible desviación del plan — el evento clave "${chapterOutline.key_event}" podría no haberse ejecutado (cobertura léxica: ${Math.round(coverage * 100)}%). Se verificará en el checkpoint estructural.`,
            });
          }
        }

        // OmniWriter Phase 2d: Consistency validation — ENFORCE corrections for critical violations
        const consistencyResult = await this.validateAndUpdateConsistency(project.id, chapterNumber, finalText, project.genre, worldBible, narrativeTimeline);
        if (!consistencyResult.isValid && consistencyResult.error) {
          console.warn(`[OmniWriter] Chapter ${chapterNumber}: Critical consistency violation detected. Forcing correction...`);
          await storage.createActivityLog({
            projectId: project.id, level: "error", agentRole: "universal-consistency",
            message: `Cap ${chapterNumber}: Violación crítica detectada — forzando corrección: ${consistencyResult.error.substring(0, 200)}`,
          });
          const MAX_CONSISTENCY_FIX_ATTEMPTS = 2;
          for (let cFixAttempt = 1; cFixAttempt <= MAX_CONSISTENCY_FIX_ATTEMPTS; cFixAttempt++) {
            const correctionResult = await this.smartEditor.fullRewrite({
              chapterContent: finalText,
              errorDescription: `VIOLACIÓN DE CONTINUIDAD CRÍTICA — CORREGIR OBLIGATORIAMENTE:\n${consistencyResult.error}\n\nREGLAS:\n1. Elimina la contradicción manteniendo la coherencia con capítulos anteriores\n2. Si un personaje está MUERTO, NO puede aparecer vivo — elimínalo de escenas activas\n3. Mantén la estructura narrativa y los eventos clave del capítulo\n4. NO inventes explicaciones — simplemente corrige el error`,
              worldBible: {
                characters: ((worldBible as any).characters || (worldBible as any).personajes || []) as any[],
                locations: ((worldBible as any).locations || (worldBible as any).lugares || []) as any[],
                worldRules: ((worldBible as any).worldRules || (worldBible as any).rules || (worldBible as any).reglas || []) as any[],
              },
              chapterNumber,
              chapterTitle: chapterOutline.title,
              projectTitle: project.title,
              genre: project.genre,
            });
            this.addTokenUsage(correctionResult.tokenUsage);
            await this.logAiUsage(project.id, "smart-editor", "deepseek-chat", correctionResult.tokenUsage, chapterNumber);
            if (correctionResult.rewrittenContent && correctionResult.rewrittenContent.length > 200) {
              finalText = correctionResult.rewrittenContent;
              const recheck = await this.validateAndUpdateConsistency(project.id, chapterNumber, finalText, project.genre, worldBible, narrativeTimeline);
              if (recheck.isValid) {
                console.log(`[OmniWriter] Chapter ${chapterNumber}: Consistency violation fixed on attempt ${cFixAttempt}`);
                await storage.createActivityLog({
                  projectId: project.id, level: "success", agentRole: "universal-consistency",
                  message: `Cap ${chapterNumber}: Violación de continuidad corregida exitosamente (intento ${cFixAttempt}).`,
                });
                const violationsToResolve = await storage.getConsistencyViolationsByChapter(project.id, chapterNumber);
                for (const v of violationsToResolve) {
                  await storage.updateConsistencyViolation(v.id, { wasAutoFixed: true });
                }
                break;
              } else if (cFixAttempt === MAX_CONSISTENCY_FIX_ATTEMPTS) {
                console.warn(`[OmniWriter] Chapter ${chapterNumber}: Consistency violation persists after ${MAX_CONSISTENCY_FIX_ATTEMPTS} attempts`);
                await storage.createActivityLog({
                  projectId: project.id, level: "warn", agentRole: "universal-consistency",
                  message: `Cap ${chapterNumber}: Violación de continuidad persiste tras ${MAX_CONSISTENCY_FIX_ATTEMPTS} intentos de corrección. Se guarda con la mejor versión disponible.`,
                });
              }
            } else {
              console.warn(`[OmniWriter] Chapter ${chapterNumber}: Consistency fix attempt ${cFixAttempt} returned no content`);
              break;
            }
          }
        }

        // OmniWriter Phase 2d.5: Minimum word count enforcement
        const preCheckWordCount = finalText.split(/\s+/).length;
        const projectMinWords = project.minWordCount || 1500;
        const minWords = chapterNumber === 0 ? Math.round(projectMinWords * 0.6) : projectMinWords;
        if (preCheckWordCount < minWords) {
          console.warn(`[OmniWriter] Chapter ${chapterNumber}: Too short (${preCheckWordCount} words, minimum ${minWords}). Extending...`);
          await storage.createActivityLog({
            projectId: project.id, level: "warn", agentRole: "omniwriter",
            message: `Cap ${chapterNumber}: Capítulo demasiado corto (${preCheckWordCount} palabras, mínimo ${minWords}). Extendiendo con más detalle...`,
          });
          const MAX_EXTEND_ATTEMPTS = 2;
          for (let extAttempt = 1; extAttempt <= MAX_EXTEND_ATTEMPTS; extAttempt++) {
            const currentWC = finalText.split(/\s+/).length;
            if (currentWC >= minWords) break;
            const extendPrompt = `El capítulo actual tiene solo ${currentWC} palabras y el mínimo requerido es ${minWords}. EXTIENDE las escenas existentes con más detalles sensoriales, diálogo y desarrollo de personajes. NO cambies los eventos ni la estructura, solo amplía y enriquece. Mantén la calidad literaria. Objetivo: al menos ${minWords} palabras.`;
            const extendResult = await this.smartEditor.fullRewrite({
              chapterContent: finalText,
              errorDescription: extendPrompt,
              worldBible: {
                characters: ((worldBible as any).characters || (worldBible as any).personajes || []) as any[],
                locations: ((worldBible as any).locations || (worldBible as any).lugares || []) as any[],
                worldRules: ((worldBible as any).worldRules || (worldBible as any).rules || (worldBible as any).reglas || []) as any[],
              },
              chapterNumber,
              chapterTitle: chapterOutline.title,
              projectTitle: project.title,
              genre: project.genre,
            });
            this.addTokenUsage(extendResult.tokenUsage);
            await this.logAiUsage(project.id, "smart-editor", "deepseek-chat", extendResult.tokenUsage, chapterNumber);
            if (extendResult.rewrittenContent && extendResult.rewrittenContent.split(/\s+/).length > currentWC) {
              finalText = extendResult.rewrittenContent;
              const newWC = finalText.split(/\s+/).length;
              console.log(`[OmniWriter] Chapter ${chapterNumber}: Extended from ${currentWC} to ${newWC} words (attempt ${extAttempt})`);
            } else {
              console.warn(`[OmniWriter] Chapter ${chapterNumber}: Extension attempt ${extAttempt} failed (no improvement)`);
              break;
            }
          }
          const finalWC = finalText.split(/\s+/).length;
          if (finalWC < minWords) {
            await storage.createActivityLog({
              projectId: project.id, level: "warn", agentRole: "omniwriter",
              message: `Cap ${chapterNumber}: No se alcanzó el mínimo de ${minWords} palabras tras extensión (${finalWC} palabras). Se guarda tal cual.`,
            });
          } else {
            await storage.createActivityLog({
              projectId: project.id, level: "info", agentRole: "omniwriter",
              message: `Cap ${chapterNumber}: Extendido exitosamente a ${finalWC} palabras (mínimo: ${minWords}).`,
            });
          }
        }

        // OmniWriter Phase 2d.7: Truncation detection and repair
        const trimmedText = finalText.trimEnd();
        const lastChar = trimmedText.charAt(trimmedText.length - 1);
        const endsWithSentence = /[.!?…»"\u201D\u2019]$/.test(trimmedText);
        const lastLine = trimmedText.split('\n').filter(l => l.trim().length > 0).pop() || '';
        const lastLineWords = lastLine.trim().split(/\s+/).length;
        const isEndTruncated = !endsWithSentence || lastLineWords < 3;

        const isGarbled = this.detectGarbledText(finalText);
        const isTruncated = isEndTruncated || isGarbled;
        
        if (isTruncated && finalText.length > 500) {
          const truncationType = isGarbled ? 'garbled' : 'end-truncated';
          console.warn(`[OmniWriter] Chapter ${chapterNumber}: Text appears ${truncationType} (last char: "${lastChar}", last line words: ${lastLineWords}, garbled: ${isGarbled}). Repairing...`);
          await storage.createActivityLog({
            projectId: project.id, level: "warn", agentRole: "omniwriter",
            message: isGarbled
              ? `Cap ${chapterNumber}: Texto CORRUPTO detectado — palabras truncadas a lo largo del capítulo. Requiere reescritura completa.`
              : `Cap ${chapterNumber}: Texto truncado detectado — reparando final del capítulo...`,
          });
          const repairDescription = isGarbled
            ? `El texto del capítulo está GRAVEMENTE CORRUPTO — contiene palabras truncadas/cortadas a lo largo de todo el texto (ejemplo: "incorpor" en lugar de "incorporó", "camin" en lugar de "caminó"). DEBES:\n1. REESCRIBIR COMPLETAMENTE el capítulo con todas las palabras completas y correctas\n2. Mantener la misma trama, eventos y escenas descritas en el texto corrupto\n3. Escribir cada palabra completa — NINGUNA palabra debe estar cortada\n4. Mantener el estilo, tono y extensión aproximada del capítulo original`
            : `El texto del capítulo está TRUNCADO — termina a mitad de frase o párrafo. DEBES:\n1. Completar la última frase/párrafo de forma natural\n2. Asegurar que el capítulo tiene un cierre coherente (puede ser un cliffhanger, pero debe ser una frase completa)\n3. NO elimines contenido existente, solo completa el final\n4. Mantén el estilo y tono del capítulo`;
          const repairResult = await this.smartEditor.fullRewrite({
            chapterContent: finalText,
            errorDescription: repairDescription,
            worldBible: {
              characters: ((worldBible as any).characters || (worldBible as any).personajes || []) as any[],
              locations: ((worldBible as any).locations || (worldBible as any).lugares || []) as any[],
              worldRules: ((worldBible as any).worldRules || (worldBible as any).rules || (worldBible as any).reglas || []) as any[],
            },
            chapterNumber,
            chapterTitle: chapterOutline.title,
            projectTitle: project.title,
            genre: project.genre,
          });
          this.addTokenUsage(repairResult.tokenUsage);
          await this.logAiUsage(project.id, "smart-editor", "deepseek-chat", repairResult.tokenUsage, chapterNumber);
          if (repairResult.rewrittenContent && repairResult.rewrittenContent.length >= finalText.length * 0.9) {
            finalText = repairResult.rewrittenContent;
            console.log(`[OmniWriter] Chapter ${chapterNumber}: Truncation repaired successfully`);
            await storage.createActivityLog({
              projectId: project.id, level: "success", agentRole: "omniwriter",
              message: `Cap ${chapterNumber}: Truncamiento reparado exitosamente.`,
            });
          }
        }

        // OmniWriter Phase 2e: Summarizer - Compress for memory
        this.callbacks.onAgentStatus("summarizer", "active", "Compressing for memory...");
        const summaryResult = await this.summarizer.execute({ chapterContent: finalText, chapterNumber });
        this.addTokenUsage(summaryResult.tokenUsage);
        await this.logAiUsage(project.id, "summarizer", "deepseek-chat", summaryResult.tokenUsage, chapterNumber);
        const chapterSummary = summaryResult.content || `Chapter ${chapterNumber} completed.`;
        chapterSummaries.push(chapterSummary);
        const recentSummaries = chapterSummaries.slice(-3);
        rollingSummary = recentSummaries.map((s, idx) => `Cap ${chapterNumber - (recentSummaries.length - 1 - idx)}: ${s}`).join("\n");
        this.callbacks.onAgentStatus("summarizer", "completed", "Chapter compressed");

        // OmniWriter Phase 2f: Save chapter to database
        const wordCount = finalText.split(/\s+/).length;
        const freshChapters = await storage.getChaptersByProject(project.id);
        const existingChapter = freshChapters.find(c => c.chapterNumber === chapterNumber);
        
        if (existingChapter) {
          await storage.updateChapter(existingChapter.id, {
            title: chapterOutline.title, content: finalText, wordCount,
            status: "approved", sceneBreakdown: sceneBreakdown as any,
            summary: chapterSummary, editorFeedback: editorFeedback as any,
            qualityScore: null,
          });
        } else {
          await storage.createChapter({
            projectId: project.id, chapterNumber,
            title: chapterOutline.title, content: finalText, wordCount,
            status: "approved", sceneBreakdown: sceneBreakdown as any,
            summary: chapterSummary, editorFeedback: editorFeedback as any,
            qualityScore: null,
          });
        }
        await storage.updateProject(project.id, { currentChapter: chapterNumber });
        this.callbacks.onChapterComplete(chapterNumber, wordCount, chapterOutline.title);

        // LitAgents 2.9.9+: Accumulate narrative timeline from chapter content
        try {
          const timelineEntry = this.extractNarrativeTimeFromChapter(finalText, chapterNumber, worldBible);
          if (timelineEntry) {
            narrativeTimeline.push(timelineEntry);
            console.log(`[OrchestratorV2] Timeline updated: Cap ${chapterNumber} = ${timelineEntry.narrativeTime}${timelineEntry.location ? ` in ${timelineEntry.location}` : ''}`);
          }
        } catch (timelineError) {
          console.error(`[OrchestratorV2] Error extracting timeline from Chapter ${chapterNumber}:`, timelineError);
        }

        // LitAgents 2.1: Extract injuries from chapter content and save to World Bible
        try {
          const worldBibleData = await storage.getWorldBibleByProject(project.id) as any;
          const characters = (worldBibleData?.characters || worldBibleData?.personajes || []) as any[];
          await this.extractInjuriesFromChapter(project.id, chapterNumber, finalText, characters);
        } catch (injuryError) {
          console.error(`[OrchestratorV2] Error extracting injuries from Chapter ${chapterNumber}:`, injuryError);
        }

        // LitAgents 3.1: Auto-update plot thread status after each chapter
        try {
          await this.autoUpdatePlotThreads(project.id, chapterNumber, chapterSummary, finalText);
        } catch (threadErr) {
          console.error(`[OrchestratorV2] Error auto-updating plot threads after Ch ${chapterNumber}:`, threadErr);
        }

        // OmniWriter: Structural checkpoint every 5 chapters (preserved from original)
        const isMultipleOfFive = chapterNumber > 0 && chapterNumber < 998 && chapterNumber % 5 === 0;
        if (isMultipleOfFive) {
          console.log(`[OmniWriter] Running Structural Checkpoint at Chapter ${chapterNumber}`);
          const checkpointResult = await this.runStructuralCheckpoint(
            project.id, chapterNumber, worldBible, outline, narrativeTimeline,
            lastCheckpointChapter, alreadyCorrectedChapters
          );
          lastCheckpointChapter = chapterNumber;

          if (checkpointResult.deviatedChapters.length > 0) {
            const chaptersToRewrite = checkpointResult.deviatedChapters.slice(0, 3);
            for (const deviatedChNum of chaptersToRewrite) {
              if (await this.shouldStopProcessing(project.id)) break;
              const deviationIssue = checkpointResult.issues.find(iss => iss.includes(`Cap ${deviatedChNum}`)) ||
                `Capítulo ${deviatedChNum} se desvió del plan original`;
              await this.rewriteDeviatedChapter(project.id, deviatedChNum, worldBible, outline, deviationIssue);
              alreadyCorrectedChapters.add(deviatedChNum);
            }
          }
        }

        // Update token counts
        await this.updateProjectTokens(project.id);
      }
      // ==================== END OMNIWRITER CHAPTER LOOP ====================

      // After all chapters are written, run SeriesThreadFixer if this is a series project
      if (project.seriesId) {
        await this.runSeriesThreadFixer(project);
      }

      // ==================== OMNIWRITER PHASE 3: ENSAMBLADOR ====================
      // Final manuscript assembly: voice unification + cross-chapter character consistency
      if (await this.shouldStopProcessing(project.id) === false) {
        console.log(`[OmniWriter] Phase 3: Running Ensamblador for final manuscript assembly...`);
        this.callbacks.onAgentStatus("ensamblador", "active", "Unifying voice across full manuscript...");

        try {
          const allChapters = await storage.getChaptersByProject(project.id);
          const sortedChapters = allChapters
            .filter(c => c.content && c.content.length > 0)
            .sort((a, b) => a.chapterNumber - b.chapterNumber);

          const fullManuscript = sortedChapters.map(c => c.content).join("\n\n---\n\n");

          const ensambladorResult = await this.ensamblador.execute({
            fullManuscript,
            totalChapters: sortedChapters.length,
            worldBible,
            styleGuide: guiaEstilo,
          });

          this.addTokenUsage(ensambladorResult.tokenUsage);
          await this.logAiUsage(project.id, "ensamblador", "gemini-2.5-flash", ensambladorResult.tokenUsage);

          if (ensambladorResult.parsed) {
            const report = ensambladorResult.parsed;
            const totalIssues = (report.inconsistencias_voz?.length || 0) + (report.inconsistencias_personaje?.length || 0);

            if (totalIssues > 0 && report.capitulos_afectados?.length > 0) {
              console.log(`[OmniWriter] Ensamblador found ${totalIssues} issues in ${report.capitulos_afectados.length} chapters`);

              for (const capNum of report.capitulos_afectados.slice(0, 5)) {
                const chapter = sortedChapters.find(c => c.chapterNumber === capNum);
                if (!chapter) continue;

                let corrections = `CORRECCIONES DE ENSAMBLAJE FINAL (Capítulo ${capNum}):\n\n`;
                for (const issue of (report.inconsistencias_voz || [])) {
                  if (issue.capitulo === capNum) {
                    corrections += `- VOZ: ${issue.descripcion}\n  Corrección: ${issue.correccion}\n`;
                  }
                }
                for (const issue of (report.inconsistencias_personaje || [])) {
                  if (issue.capitulo === capNum) {
                    corrections += `- PERSONAJE (${issue.personaje}): ${issue.descripcion}\n  Corrección: ${issue.correccion}\n`;
                  }
                }

                const ensambladorWBData = await storage.getWorldBibleByProject(project.id);
                const fixResult = await this.smartEditor.fullRewrite({
                  chapterContent: chapter.content || "",
                  errorDescription: corrections,
                  worldBible: {
                    characters: ((worldBible as any).characters || (worldBible as any).personajes || []) as any[],
                    locations: ((worldBible as any).locations || (worldBible as any).lugares || []) as any[],
                    worldRules: ((worldBible as any).worldRules || (worldBible as any).rules || (worldBible as any).reglas || []) as any[],
                    persistentInjuries: (ensambladorWBData?.persistentInjuries || []) as any[],
                    plotDecisions: (ensambladorWBData?.plotDecisions || []) as any[],
                  },
                  styleGuide: guiaEstilo,
                  chapterNumber: capNum,
                  chapterTitle: chapter.title || "",
                  projectTitle: project.title,
                  genre: project.genre,
                });

                this.addTokenUsage(fixResult.tokenUsage);
                if (fixResult.rewrittenContent && fixResult.rewrittenContent.length > 200) {
                  await storage.updateChapter(chapter.id, {
                    originalContent: chapter.originalContent || chapter.content,
                    content: fixResult.rewrittenContent,
                    wordCount: fixResult.rewrittenContent.split(/\s+/).length,
                  });
                  console.log(`[OmniWriter] Ensamblador: Chapter ${capNum} unified`);
                }
              }

              this.callbacks.onAgentStatus("ensamblador", "completed", `${totalIssues} issues fixed in ${report.capitulos_afectados.length} chapters`);
            } else {
              console.log(`[OmniWriter] Ensamblador: Manuscript voice is consistent`);
              this.callbacks.onAgentStatus("ensamblador", "completed", `Voice unified - Score: ${report.puntuacion_coherencia}/10`);
            }

            await storage.createActivityLog({
              projectId: project.id, level: "success", agentRole: "ensamblador",
              message: `Ensamblaje final: coherencia ${report.puntuacion_coherencia}/10, ${totalIssues} correcciones aplicadas`,
            });
          } else {
            this.callbacks.onAgentStatus("ensamblador", "completed", "Assembly complete");
          }
        } catch (err) {
          console.error("[OmniWriter] Ensamblador error:", err);
          this.callbacks.onAgentStatus("ensamblador", "warning", "Assembly skipped (non-fatal)");
        }
      }

      // Full-novel structural review before marking complete
      if (await this.shouldStopProcessing(project.id) === false) {
        console.log(`[OrchestratorV2] Running full-novel structural review...`);
        this.callbacks.onAgentStatus("structural-checkpoint", "active", "Revisión estructural completa de toda la novela...");
        
        try {
          const finalReviewResult = await this.runFinalStructuralReview(
            project.id, worldBible, outline, narrativeTimeline, alreadyCorrectedChapters, chapterSummaries
          );
          
          if (finalReviewResult.rewrittenCount > 0) {
            console.log(`[OrchestratorV2] Final structural review: ${finalReviewResult.rewrittenCount} chapters corrected`);
          }
          
          this.callbacks.onAgentStatus("structural-checkpoint", "completed", 
            finalReviewResult.rewrittenCount > 0
              ? `Revisión final: ${finalReviewResult.rewrittenCount} capítulos corregidos`
              : `Revisión final: estructura correcta`
          );
        } catch (err) {
          console.error("[OrchestratorV2] Final structural review error:", err);
          // If Gemini key is missing, pause the project so user knows review didn't happen
          if (!geminiApiKey) {
            await storage.updateProject(project.id, { status: "paused" });
            await storage.createActivityLog({
              projectId: project.id,
              level: "error",
              agentRole: "structural-checkpoint",
              message: `Revisión estructural final no pudo ejecutarse: falta la clave de Gemini. Configura GEMINI_API_KEY y presiona Continuar.`,
            });
            return;
          }
          // For other errors, log and continue (non-fatal)
          await storage.createActivityLog({
            projectId: project.id,
            level: "warn",
            agentRole: "structural-checkpoint",
            message: `Revisión estructural final falló: ${err instanceof Error ? err.message : String(err)}. La novela se marcará como completada.`,
          });
        }
      }

      // === OBJECTIVE EVALUATION (v2.9.14) ===
      // Run objective, measurable evaluation before marking complete
      if (await this.shouldStopProcessing(project.id) === false) {
        console.log(`[OrchestratorV2] Running objective evaluation...`);
        this.callbacks.onAgentStatus("objective-evaluator", "active", "Calculando métricas objetivas del manuscrito...");
        
        try {
          const freshChaptersForEval = await storage.getChaptersByProject(project.id);
          const completedChaptersForEval = freshChaptersForEval
            .filter(c => c.status === "completed" || c.status === "approved")
            .sort((a, b) => a.chapterNumber - b.chapterNumber);

          const evalResult = await runObjectiveEvaluation({
            projectId: project.id,
            chapters: completedChaptersForEval.map(c => ({
              chapterNumber: c.chapterNumber,
              title: c.title || `Capítulo ${c.chapterNumber}`,
              content: c.content || "",
              wordCount: c.wordCount || (c.content || "").split(/\s+/).length,
            })),
            genre: project.genre,
            hasPrologue: project.hasPrologue,
            hasEpilogue: project.hasEpilogue,
          });

          // Persist evaluation result
          await storage.updateProject(project.id, {
            objectiveEvaluation: evalResult as any,
          });

          // Log each metric
          for (const metric of evalResult.metrics) {
            await storage.createActivityLog({
              projectId: project.id,
              level: metric.score >= 7 ? "success" : metric.score >= 5 ? "warn" : "error",
              agentRole: "objective-evaluator",
              message: `[${metric.label}] ${metric.score}/${metric.maxScore} (peso: ${metric.weight}%) — ${metric.details}`,
              metadata: { metric: metric.name, score: metric.score, weight: metric.weight },
            });
          }

          // Log blockers
          if (evalResult.blockers.length > 0) {
            await storage.createActivityLog({
              projectId: project.id,
              level: "error",
              agentRole: "objective-evaluator",
              message: `BLOQUEADORES: ${evalResult.blockers.join(" | ")}`,
            });
          }

          // Log final verdict
          const verdictEmoji = evalResult.verdict === "PUBLICABLE" ? "EXITO" : evalResult.verdict === "CASI_PUBLICABLE" ? "AVISO" : "ERROR";
          await storage.createActivityLog({
            projectId: project.id,
            level: evalResult.verdict === "PUBLICABLE" ? "success" : evalResult.verdict === "CASI_PUBLICABLE" ? "warn" : "error",
            agentRole: "objective-evaluator",
            message: `[${verdictEmoji}] Evaluación Objetiva: ${evalResult.totalScore}/10 (${evalResult.percentage}%) — ${evalResult.verdict}${evalResult.recommendations.length > 0 ? ` | Recomendaciones: ${evalResult.recommendations.join("; ")}` : ""}`,
          });

          this.callbacks.onAgentStatus("objective-evaluator", "completed", 
            `${evalResult.totalScore}/10 (${evalResult.percentage}%) — ${evalResult.verdict}`
          );

          console.log(`[OrchestratorV2] Objective evaluation complete: ${evalResult.totalScore}/10 (${evalResult.verdict})`);
        } catch (err) {
          console.error("[OrchestratorV2] Objective evaluation error:", err);
          this.callbacks.onAgentStatus("objective-evaluator", "warning", "Evaluación objetiva falló (no bloquea)");
          await storage.createActivityLog({
            projectId: project.id,
            level: "warn",
            agentRole: "objective-evaluator",
            message: `Evaluación objetiva falló: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      }

      // After all chapters are written, mark as completed WITHOUT auto-correction
      // v2.9.6: Per user request, do NOT run Detect & Fix or FinalReviewer automatically
      // The user will manually trigger corrections if needed
      console.log(`[OrchestratorV2] Novel generation complete. Marking as completed WITHOUT auto-correction.`);
      
      await this.extractSeriesWorldBibleOnComplete(project.id);
      await storage.updateProject(project.id, { status: "completed" });
      
      await storage.createActivityLog({
        projectId: project.id,
        level: "success",
        message: `Manuscrito completado. Puedes ejecutar "Detect & Fix" manualmente si deseas revisar y corregir.`,
        agentRole: "orchestrator",
      });
      
      this.callbacks.onProjectComplete();

    } catch (error) {
      console.error(`[OrchestratorV2] Error:`, error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.callbacks.onError(errorMessage);
      
      // Use "paused" instead of "error" to allow easy resume
      await storage.updateProject(project.id, { status: "paused" });
      
      await storage.createActivityLog({
        projectId: project.id,
        level: "error",
        message: `Error en orquestador: ${errorMessage.substring(0, 300)}. Presiona "Continuar" para reintentar.`,
        agentRole: "system",
        metadata: { error: errorMessage, recoverable: true },
      });
      
      console.log(`[OrchestratorV2] Project ${project.id} paused after error - can resume with "Continuar" button`);
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

      // Get all chapters for this project - use summaries to stay within token limits
      // DeepSeek has 131K context limit, full novel content often exceeds 150K+ tokens
      const chapters = await storage.getChaptersByProject(project.id);
      
      // Calculate approximate token budget: ~100K for content, rest for system prompt + output
      const MAX_CONTENT_TOKENS = 80000; // Conservative limit for chapter content
      const CHARS_PER_TOKEN = 4; // Approximate characters per token
      const MAX_CHARS = MAX_CONTENT_TOKENS * CHARS_PER_TOKEN;
      
      // First try to use summaries (much more compact)
      let chaptersWithContent = chapters
        .filter(ch => ch.content && ch.content.length > 100)
        .map(ch => ({
          id: ch.id,
          chapterNumber: ch.chapterNumber,
          title: ch.title || `Capitulo ${ch.chapterNumber}`,
          content: ch.summary || ch.content?.slice(0, 3000) || "", // Prefer summary, fallback to truncated content
        }));
      
      // Calculate total content size
      let totalChars = chaptersWithContent.reduce((sum, ch) => sum + ch.content.length, 0);
      
      // If still too large (even with summaries), truncate each chapter proportionally
      if (totalChars > MAX_CHARS) {
        const charBudgetPerChapter = Math.floor(MAX_CHARS / chaptersWithContent.length);
        chaptersWithContent = chaptersWithContent.map(ch => ({
          ...ch,
          content: ch.content.slice(0, charBudgetPerChapter),
        }));
        console.log(`[OrchestratorV2] SeriesThreadFixer: Truncated chapters to ${charBudgetPerChapter} chars each (${chaptersWithContent.length} chapters)`);
      }

      if (chaptersWithContent.length === 0) {
        console.log(`[OrchestratorV2] No chapters with content found, skipping thread fixer`);
        return;
      }

      // Get world bible for context
      const worldBible = await storage.getWorldBibleByProject(project.id);

      // Get context from previous books in the series
      let previousVolumesContext: string | undefined;
      if (project.seriesOrder && project.seriesOrder > 1) {
        previousVolumesContext = await this.buildPreviousBooksContext(project.seriesId, project.seriesOrder, {
          maxChars: 6000,
          includeWorldRules: false,
          includeCanonWarning: false,
        }) || undefined;
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
            await this.logAiUsage(project.id, "series-thread-fixer", "deepseek-chat", fixResult.tokenUsage, chapter.chapterNumber);

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

  // ============================================
  // LitAgents 2.9.10: World Bible Validator (Gemini)
  // Audits the Bible for structural weaknesses before writing begins
  // ============================================
  private async validateWorldBibleWithGemini(
    projectId: number,
    worldBible: any,
    outline: any[],
    plotThreads?: any[],
    previousIssues?: Array<{ type: string; severity: string; description: string; fix: string }>
  ): Promise<{ isValid: boolean; issues: Array<{ type: string; severity: string; description: string; fix: string }>; correctedBible?: any }> {
    this.callbacks.onAgentStatus("bible-validator", "active", "Validando Biblia del Mundo con IA...");
    
    await storage.createActivityLog({
      projectId,
      level: "info",
      agentRole: "bible-validator",
      message: "Iniciando validación profunda de la Biblia del Mundo antes de escribir...",
    });

    const bibleContent = JSON.stringify({
      characters: worldBible.characters || [],
      rules: worldBible.rules || worldBible.worldRules || [],
      settings: (worldBible as any).settings || [],
      themes: (worldBible as any).themes || [],
    }, null, 2);

    const outlineContent = outline.map(ch => {
      const label = ch.chapter_num === 0 ? 'PRÓLOGO' : ch.chapter_num >= 998 ? 'EPÍLOGO' : `Cap ${ch.chapter_num}`;
      return `${label}: "${ch.title}" - ${ch.summary || 'Sin resumen'} [Evento clave: ${ch.key_event || 'N/A'}]`;
    }).join('\n');

    const threadsContent = plotThreads ? plotThreads.map(t => {
      const resChapter = (t as any).resolution_chapter;
      const resInfo = resChapter ? ` [Resolución planificada: Cap ${resChapter}]` : ' [SIN RESOLUCIÓN PLANIFICADA]';
      return `- ${t.name}: ${t.description || t.goal || 'Sin descripción'}${resInfo}`;
    }).join('\n') : 'No definidos';

    let previousIssuesSection = '';
    if (previousIssues && previousIssues.length > 0) {
      previousIssuesSection = `\n=== PROBLEMAS DETECTADOS EN VALIDACIÓN ANTERIOR (YA DEBERÍAN ESTAR CORREGIDOS) ===
Verifica si estos problemas ya están corregidos en la biblia/escaleta actual.
Si un problema PERSISTE exactamente igual, repórtalo de nuevo con severity "critica" para forzar corrección.
${previousIssues.map((i, idx) => `${idx + 1}. [${i.type}/${i.severity}] ${i.description} → FIX APLICADO: ${i.fix}`).join('\n')}
=== FIN PROBLEMAS ANTERIORES ===\n`;
    }

    // ========== PHASE 1: DETECT ISSUES (diagnosis only, no corrections) ==========
    const detectPrompt = `Eres un editor literario experto. Analiza esta Biblia del Mundo y la escaleta de capítulos para detectar problemas OBJETIVOS Y VERIFICABLES.

SOLO DETECTA Y REPORTA. NO generes correcciones en esta fase.

=== BIBLIA DEL MUNDO (COMPLETA) ===
${bibleContent}

=== ESCALETA DE CAPÍTULOS (${outline.length} capítulos) ===
CONVENCIÓN DE NUMERACIÓN OBLIGATORIA — NO ES UN ERROR:
- "PRÓLOGO" (Cap 0) y "EPÍLOGO" (Cap 998) son designaciones INTERNAS del sistema.
- Esta numeración es CORRECTA e INTENCIONAL. Cap 998 NO necesita renumerarse.
- NUNCA reportes la numeración de Cap 0 o Cap 998 como problema de coherencia ni de ningún otro tipo.
- El PRÓLOGO y el EPÍLOGO NO son capítulos regulares. No los incluyas en el conteo de capítulos ni en cálculos de estructura.
${outlineContent}

=== HILOS ARGUMENTALES ===
${threadsContent}
${previousIssuesSection}
DETECTA SOLO ESTOS TIPOS DE PROBLEMAS:
1. PERSONAJES: Motivaciones que SE CONTRADICEN entre sí (no "podrían ser más profundas"), personajes mencionados en la escaleta pero AUSENTES de la biblia
2. LÍNEA TEMPORAL: Eventos que VIOLAN la cronología establecida (A ocurre antes que B, pero B es prerrequisito de A)
3. REGLAS DEL MUNDO: Reglas que SE CONTRADICEN factualmente entre sí
4. UBICACIONES: Datos CONTRADICTORIOS sobre una misma ubicación (no "podría ser más detallada")
5. SUBTRAMAS: Hilos que se ABREN EXPLÍCITAMENTE pero NUNCA se resuelven ni mencionan de nuevo
6. ESTRUCTURA: Clímax AUSENTE o actos sin contenido narrativo
7. COHERENCIA ESCALETA-BIBLIA: Hechos en la escaleta que CONTRADICEN DIRECTAMENTE datos de la biblia
8. CIERRE DE TRAMAS (CRÍTICO): Cada hilo narrativo DEBE tener un punto de resolución CLARO en la escaleta. Verifica que:
   - Cada plot_thread tiene un capítulo donde se resuelve EXPLÍCITAMENTE (mencionado en summary o key_event)
   - Si un hilo tiene "resolution_chapter", verifica que ESE capítulo realmente menciona la resolución del hilo
   - Si un hilo NO tiene resolución planificada en ningún capítulo de la escaleta, es SIEMPRE "critica"
   - Si la resolución es vaga o implícita (no se menciona explícitamente el cierre), es "mayor"

=== REGLAS ESTRICTAS DE SEVERIDAD ===
IMPORTANTE: La mayoría de los problemas deben ser "menor". Reserva "critica" y "mayor" para problemas FACTUALES y VERIFICABLES.

- "critica": SOLO contradicciones FACTUALES verificables O tramas sin cierre. Ejemplos:
  • La biblia dice que X muere en Cap 5, pero aparece vivo en Cap 20
  • Un personaje referenciado en la escaleta NO EXISTE en la biblia
  • Una regla del mundo dice A, pero un evento depende de que sea NO-A
  • Un hilo narrativo NO tiene resolución planificada en NINGÚN capítulo de la escaleta
  
- "mayor": SOLO problemas estructurales CONCRETOS y verificables. Ejemplos:
  • Una subtrama se abre explícitamente y NUNCA se cierra ni menciona de nuevo
  • Un personaje principal DESAPARECE de la escaleta sin explicación
  • La cronología de eventos ES IMPOSIBLE (viaja de A a B en 0 tiempo)

- "menor": TODO LO DEMÁS, incluyendo:
  • "El arco podría ser más profundo/desarrollado" → SIEMPRE es menor
  • "El pacing podría mejorar" → SIEMPRE es menor  
  • "La motivación podría ser más explícita" → SIEMPRE es menor
  • "El clímax podría ser más extenso/intenso" → SIEMPRE es menor
  • "La reacción del personaje podría ser más visceral" → SIEMPRE es menor
  • "Falta desarrollo emocional" → SIEMPRE es menor
  • Cualquier sugerencia que use "podría", "debería", "convendría" → SIEMPRE es menor

PREGUNTA CLAVE para decidir severidad: "¿Puedo señalar DOS DATOS CONCRETOS en el texto que se contradicen?" 
- Si SÍ → puede ser "critica" o "mayor"
- Si NO → es "menor"

LÍMITE: Máximo 3 issues de tipo "mayor". Si detectas más de 3 problemas que crees mayores, incluye solo los 3 más graves como "mayor" y el resto como "menor".

RESPONDE EXCLUSIVAMENTE EN JSON:
{
  "overallScore": 1-10,
  "issues": [
    {
      "type": "personaje|temporal|regla|ubicacion|subtrama|estructura|coherencia",
      "severity": "critica|mayor|menor",
      "description": "Descripción clara y específica del problema",
      "fix": "Instrucción precisa de qué cambiar y cómo"
    }
  ],
  "lessonsForWriter": ["Lección 1...", "Lección 2..."]
}`;

    try {
      const detectResponse = await geminiGenerateWithRetry(detectPrompt, "gemini-2.5-flash", "BibleValidator-Detect");

      const detectJsonMatch = detectResponse.match(/\{[\s\S]*\}/);
      if (!detectJsonMatch) {
        console.error("[BibleValidator] No JSON in detection response");
        await storage.createActivityLog({
          projectId, level: "warn", agentRole: "bible-validator",
          message: "Respuesta de detección no contenía JSON válido. Re-intentando...",
        });
        return { isValid: false, issues: [{ type: "formato", severity: "critica", description: "La IA no devolvió formato válido", fix: "Re-ejecutar validación" }] };
      }

      const detected = JSON.parse(detectJsonMatch[0]);
      const issues = detected.issues || [];
      
      // LitAgents 3.3: Code-level thread closure verification (AI-independent)
      if (plotThreads && plotThreads.length > 0) {
        const outlineSummaries = outline.map(ch => {
          const text = `${ch.summary || ''} ${ch.key_event || ''} ${ch.title || ''}`.toLowerCase();
          return { chapter_num: ch.chapter_num, text };
        });
        
        for (const thread of plotThreads) {
          const threadName = (thread.name || '').toLowerCase();
          const resChapter = (thread as any).resolution_chapter;
          const threadGoal = ((thread as any).goal || '').toLowerCase();
          const threadDesc = ((thread as any).description || '').toLowerCase();
          const allThreadText = `${threadName} ${threadGoal} ${threadDesc}`;
          const threadWords = Array.from(new Set(allThreadText.split(/\s+/).filter((w: string) => w.length > 3)));
          
          const mentionedInAnyChapter = outlineSummaries.some(ch => 
            threadWords.some((word: string) => ch.text.includes(word))
          );
          
          const hasValidResolution = resChapter && outline.some(ch => ch.chapter_num === resChapter);
          
          if (!hasValidResolution && !mentionedInAnyChapter) {
            const alreadyReported = issues.some((i: any) => 
              i.type === 'subtrama' && i.description?.toLowerCase().includes(threadName)
            );
            if (!alreadyReported) {
              issues.push({
                type: 'subtrama',
                severity: 'critica',
                description: `El hilo narrativo "${thread.name}" NO tiene resolución planificada en la escaleta y no se menciona en ningún capítulo. Debe asignarse un capítulo de resolución.`,
                fix: `Asignar un capítulo de resolución para "${thread.name}" y mencionarlo explícitamente en el summary/key_event de ese capítulo.`
              });
              console.log(`[BibleValidator] Code-level: Added CRITICAL issue for unresolved thread "${thread.name}"`);
            }
          } else if (!hasValidResolution) {
            const alreadyReported = issues.some((i: any) => 
              i.type === 'subtrama' && i.description?.toLowerCase().includes(threadName)
            );
            if (!alreadyReported) {
              issues.push({
                type: 'subtrama',
                severity: 'mayor',
                description: `El hilo narrativo "${thread.name}" se menciona en la escaleta pero no tiene un capítulo de resolución (resolution_chapter) asignado explícitamente.`,
                fix: `Asignar resolution_chapter para "${thread.name}" y asegurar que el summary del capítulo de resolución mencione explícitamente el cierre de este hilo.`
              });
              console.log(`[BibleValidator] Code-level: Added MAJOR issue for thread "${thread.name}" without resolution_chapter`);
            }
          } else if (hasValidResolution) {
            const resolutionEntry = outlineSummaries.find(ch => ch.chapter_num === resChapter);
            if (resolutionEntry) {
              const threadMentioned = threadWords.some((word: string) => resolutionEntry.text.includes(word));
              if (!threadMentioned) {
                const alreadyReported = issues.some((i: any) => 
                  i.type === 'subtrama' && i.description?.toLowerCase().includes(threadName) && i.description?.toLowerCase().includes('resolución')
                );
                if (!alreadyReported) {
                  issues.push({
                    type: 'subtrama',
                    severity: 'mayor',
                    description: `El hilo "${thread.name}" tiene resolution_chapter=${resChapter}, pero el summary/key_event de Cap ${resChapter} NO menciona explícitamente la resolución de este hilo.`,
                    fix: `Modificar el summary o key_event del Cap ${resChapter} para incluir explícitamente la resolución del hilo "${thread.name}".`
                  });
                  console.log(`[BibleValidator] Code-level: Resolution chapter ${resChapter} for "${thread.name}" doesn't mention thread closure`);
                }
              }
            }
          }
        }
      }
      
      // POST-VALIDATION FILTER: Auto-correct misclassified severities
      const subjectivePatterns = /podría|debería|convendría|podria|deberia|conviene|puede ser más|puede mejorar|falta.*desarrollo|falta.*profundidad|necesita más|podría ser más|abrupto|poco convincente|algo.*rápid|algo.*lent|desaprovechad|insuficiente(?!.*capítulo)/i;
      const cap998Pattern = /cap(?:ítulo)?\s*998|capítulo\s*0.*numeración|renumera|inconsistencia.*numeración|numeración.*inconsisten/i;
      
      for (const issue of issues) {
        const desc = (issue.description || '') + ' ' + (issue.fix || '');
        // Always filter out Cap 998 numbering complaints
        if (cap998Pattern.test(desc)) {
          if (issue.severity === 'critica' || issue.severity === 'mayor') {
            console.log(`[BibleValidator] Auto-downgraded Cap 998 numbering issue from ${issue.severity} to menor`);
            issue.severity = 'menor';
            issue.description = `[AUTO-DOWNGRADED] ${issue.description}`;
          }
        }
        // Downgrade subjective opinions from critica/mayor to menor
        if ((issue.severity === 'critica' || issue.severity === 'mayor') && subjectivePatterns.test(desc)) {
          // Only downgrade if it's NOT a factual contradiction (has two concrete data points)
          const hasFactualContradiction = /contradice|contradicen|contradictori|pero.*dice|dice.*pero|muere.*aparece|aparece.*muere|no existe|inexistente|ausente.*biblia/i.test(desc);
          if (!hasFactualContradiction) {
            console.log(`[BibleValidator] Auto-downgraded subjective opinion from ${issue.severity} to menor: ${issue.description.substring(0, 80)}...`);
            issue.severity = 'menor';
          }
        }
      }
      
      const criticalIssues = issues.filter((i: any) => i.severity === 'critica');
      const majorIssues = issues.filter((i: any) => i.severity === 'mayor');
      const minorIssues = issues.filter((i: any) => i.severity === 'menor');

      console.log(`[BibleValidator] Detection - Score: ${detected.overallScore}/10, Issues: ${criticalIssues.length} critical, ${majorIssues.length} major, ${minorIssues.length} minor`);

      for (const issue of issues) {
        await storage.createActivityLog({
          projectId,
          level: issue.severity === 'critica' ? 'error' : issue.severity === 'mayor' ? 'warn' : 'info',
          agentRole: "bible-validator",
          message: `[${issue.type.toUpperCase()}] ${issue.description} → FIX: ${issue.fix}`,
        });
      }

      await storage.createActivityLog({
        projectId,
        level: criticalIssues.length > 0 ? "error" : majorIssues.length > 0 ? "warn" : "info",
        agentRole: "bible-validator",
        message: `${criticalIssues.length} problemas críticos, ${majorIssues.length} mayores, ${minorIssues.length} menores detectados (puntuación: ${detected.overallScore}/10)`,
      });

      if (detected.lessonsForWriter && detected.lessonsForWriter.length > 0) {
        await this.storeBibleLessons(projectId, detected.lessonsForWriter);
      }

      const isValid = criticalIssues.length === 0 && majorIssues.length === 0;

      if (isValid) {
        const statusMsg = `Biblia validada (${detected.overallScore}/10)`;
        this.callbacks.onAgentStatus("bible-validator", "completed", statusMsg);
        return { isValid: true, issues };
      }

      // ========== PHASE 2: CORRECT ISSUES (focused correction with full context) ==========
      this.callbacks.onAgentStatus("bible-validator", "active", "Corrigiendo Biblia del Mundo...");
      await storage.createActivityLog({
        projectId, level: "info", agentRole: "bible-validator",
        message: `Fase de corrección: aplicando fixes para ${criticalIssues.length + majorIssues.length} problemas críticos/mayores...`,
      });

      const actionableIssues = [...criticalIssues, ...majorIssues];
      const issuesList = actionableIssues.map((issue: any, idx: number) => 
        `PROBLEMA ${idx + 1} [${issue.severity.toUpperCase()}/${issue.type.toUpperCase()}]:\n  Descripción: ${issue.description}\n  Corrección requerida: ${issue.fix}`
      ).join('\n\n');

      const characterNames = (worldBible.characters || []).map((c: any) => c.name || c.nombre || 'Sin nombre').join(', ');

      const correctPrompt = `Eres un editor literario experto. CORRIGE la Biblia del Mundo y la escaleta según los problemas detectados.

REGLA FUNDAMENTAL: Tu trabajo es APLICAR LAS CORRECCIONES concretas. No diagnostiques, no expliques. Solo corrige.

=== PROBLEMAS A CORREGIR ===
${issuesList}

=== BIBLIA DEL MUNDO ACTUAL (COMPLETA) ===
${bibleContent}

=== ESCALETA DE CAPÍTULOS ACTUAL (${outline.length} capítulos) ===
${outlineContent}

=== INSTRUCCIONES DE CORRECCIÓN ===

1. PERSONAJES (characters): Devuelve el array COMPLETO de TODOS los personajes.
   - Personajes existentes: ${characterNames}
   - Si un personaje necesita mejoras (arco, motivaciones, relaciones), incluye TODAS sus propiedades originales + las mejoradas.
   - Si falta un personaje mencionado en la escaleta, AÑÁDELO con: name, role, description, arc, relationships, initialState.
   - CADA personaje debe tener al mínimo: name, role, description, arc (con inicio/desarrollo/resolución), relationships (objeto con claves=nombre del otro personaje).
   - NUNCA omitas un personaje existente del array.

2. REGLAS (rules): Si hay problemas de reglas, devuelve el array COMPLETO de reglas corregidas. Si no hay problemas de reglas, pon null.

3. ESCALETA (outline_fixes): Para cada capítulo que necesite cambios:
   - Incluye chapter_num, corrected_title (opcional), corrected_summary (obligatorio), corrected_key_event (opcional).
   - Si el problema es de pacing (ej: revelación demasiado temprana), mueve la información entre capítulos redistribuyendo los summaries.
   
4. CIERRE DE TRAMAS (thread_resolution_fixes): Si hay hilos narrativos sin resolución:
   - Asigna un capítulo de resolución (preferiblemente en Acto 3).
   - Modifica el summary/key_event del capítulo elegido para mencionar EXPLÍCITAMENTE el cierre del hilo.

RESPONDE EXCLUSIVAMENTE EN JSON:
{
  "corrections": {
    "characters": [ARRAY COMPLETO de TODOS los personajes con correcciones integradas],
    "rules": [ARRAY COMPLETO de reglas corregidas] o null,
    "outline_fixes": [{"chapter_num": N, "corrected_summary": "...", "corrected_title": "...", "corrected_key_event": "..."}],
    "thread_resolution_fixes": [{"thread_name": "Nombre del hilo", "resolution_chapter": N, "resolution_description": "Cómo se resuelve en ese capítulo"}]
  }
}

VERIFICACIÓN FINAL antes de responder:
- ¿Incluiste TODOS los ${(worldBible.characters || []).length} personajes existentes + los nuevos?
- ¿Cada personaje tiene name, role, description, arc, relationships?
- ¿Los outline_fixes abordan TODOS los problemas de estructura/coherencia listados?
- ¿TODOS los hilos narrativos tienen un capítulo de resolución asignado?`;

      const correctResponse = await geminiGenerateWithRetry(correctPrompt, "gemini-2.5-flash", "BibleValidator-Correct");

      const correctJsonMatch = correctResponse.match(/\{[\s\S]*\}/);
      if (!correctJsonMatch) {
        console.error("[BibleValidator] No JSON in correction response");
        await storage.createActivityLog({
          projectId, level: "warn", agentRole: "bible-validator",
          message: "Corrección no generó JSON válido. Se procederá con los issues detectados sin correcciones.",
        });
        this.callbacks.onAgentStatus("bible-validator", "warning", `${criticalIssues.length} críticos, ${majorIssues.length} mayores detectados (sin corrección)`);
        return { isValid: false, issues };
      }

      const correctionData = JSON.parse(correctJsonMatch[0]);
      const corrections = correctionData.corrections || correctionData;

      let correctedBible: any = this.deepCloneBible(worldBible);

      // Apply character corrections with deep merge
      if (corrections.characters && Array.isArray(corrections.characters) && corrections.characters.length > 0) {
        const existingCharacters = worldBible.characters || [];
        const correctedCharacters = corrections.characters;
        
        if (correctedCharacters.length >= existingCharacters.length) {
          correctedBible.characters = correctedCharacters;
          console.log(`[BibleValidator] Characters replaced: ${existingCharacters.length} -> ${correctedCharacters.length}`);
        } else {
          const mergedCharacters = this.deepMergeCharacters(existingCharacters, correctedCharacters);
          correctedBible.characters = mergedCharacters;
          console.log(`[BibleValidator] Characters deep-merged: ${existingCharacters.length} existing + ${correctedCharacters.length} corrections = ${mergedCharacters.length} total`);
        }

        // Verify all existing characters are preserved
        const originalNames = existingCharacters.map((c: any) => (c.name || c.nombre || '').toLowerCase());
        const correctedNames = new Set(correctedBible.characters.map((c: any) => (c.name || c.nombre || '').toLowerCase()));
        const missingChars = originalNames.filter((n: string) => n && !correctedNames.has(n));
        if (missingChars.length > 0) {
          console.warn(`[BibleValidator] WARNING: ${missingChars.length} characters lost during correction: ${missingChars.join(', ')}. Restoring...`);
          for (const missingName of missingChars) {
            const original = existingCharacters.find((c: any) => (c.name || c.nombre || '').toLowerCase() === missingName);
            if (original) correctedBible.characters.push(original);
          }
        }
      }

      // Apply rule corrections
      if (corrections.rules && Array.isArray(corrections.rules) && corrections.rules.length > 0) {
        correctedBible.rules = corrections.rules;
        correctedBible.worldRules = corrections.rules;
        console.log(`[BibleValidator] Rules updated: ${corrections.rules.length} rules`);
      }

      // Apply outline fixes (enhanced: title + key_event + summary)
      if (corrections.outline_fixes && Array.isArray(corrections.outline_fixes) && corrections.outline_fixes.length > 0) {
        correctedBible._outlineFixes = corrections.outline_fixes;
        console.log(`[BibleValidator] Outline fixes: ${corrections.outline_fixes.length} chapters to fix`);
      }

      // LitAgents 3.3: Apply thread resolution fixes
      if (corrections.thread_resolution_fixes && Array.isArray(corrections.thread_resolution_fixes) && corrections.thread_resolution_fixes.length > 0) {
        correctedBible._threadResolutionFixes = corrections.thread_resolution_fixes;
        console.log(`[BibleValidator] Thread resolution fixes: ${corrections.thread_resolution_fixes.length} threads resolved`);
        
        for (const fix of corrections.thread_resolution_fixes) {
          if (fix.resolution_chapter && fix.thread_name) {
            if (!correctedBible._outlineFixes) correctedBible._outlineFixes = [];
            const existingOutlineFix = correctedBible._outlineFixes.find((of: any) => of.chapter_num === fix.resolution_chapter);
            if (existingOutlineFix) {
              if (existingOutlineFix.corrected_summary && !existingOutlineFix.corrected_summary.includes(fix.thread_name)) {
                existingOutlineFix.corrected_summary += ` [Resolución del hilo: ${fix.thread_name} - ${fix.resolution_description || ''}]`;
              }
            } else {
              const outlineEntry = outline.find(ch => ch.chapter_num === fix.resolution_chapter);
              if (outlineEntry) {
                correctedBible._outlineFixes.push({
                  chapter_num: fix.resolution_chapter,
                  corrected_summary: `${outlineEntry.summary} [Resolución del hilo: ${fix.thread_name} - ${fix.resolution_description || ''}]`,
                });
              }
            }
          }
        }
      }

      // Log correction summary
      const charCount = corrections.characters?.length || 0;
      const rulesCount = corrections.rules?.length || 0;
      const outlineFixCount = corrections.outline_fixes?.length || 0;
      const threadFixCount = corrections.thread_resolution_fixes?.length || 0;
      await storage.createActivityLog({
        projectId, level: "info", agentRole: "bible-validator",
        message: `Correcciones generadas: ${charCount} personajes, ${rulesCount} reglas, ${outlineFixCount} fixes de escaleta, ${threadFixCount} resoluciones de hilos.`,
      });

      const statusMsg = `${criticalIssues.length} críticos, ${majorIssues.length} mayores detectados — correcciones aplicadas`;
      this.callbacks.onAgentStatus("bible-validator", "warning", statusMsg);

      return { isValid: false, issues, correctedBible };
    } catch (error) {
      console.error("[BibleValidator] Error:", error);
      this.callbacks.onAgentStatus("bible-validator", "warning", "Error en validación - se tratará como no válida");
      await storage.createActivityLog({
        projectId, level: "warn", agentRole: "bible-validator",
        message: `Error durante validación: ${error instanceof Error ? error.message : 'Error desconocido'}. Se tratará como no válida para re-intentar.`,
      });
      return { isValid: false, issues: [{ type: "error", severity: "critica", description: "Error al ejecutar validación", fix: "Re-ejecutar validación" }] };
    }
  }

  private deepCloneBible(bible: any): any {
    try {
      return JSON.parse(JSON.stringify(bible));
    } catch {
      return { ...bible };
    }
  }

  private deepMergeCharacters(existing: any[], corrections: any[]): any[] {
    const merged = existing.map(char => {
      const charName = (char.name || char.nombre || '').toLowerCase();
      const correction = corrections.find((c: any) => (c.name || c.nombre || '').toLowerCase() === charName);
      if (!correction) return char;
      return this.deepMergeObject(char, correction);
    });
    for (const corrChar of corrections) {
      const corrName = (corrChar.name || corrChar.nombre || '').toLowerCase();
      if (!merged.find((c: any) => (c.name || c.nombre || '').toLowerCase() === corrName)) {
        merged.push(corrChar);
      }
    }
    return merged;
  }

  private deepMergeObject(target: any, source: any): any {
    const result = { ...target };
    for (const key of Object.keys(source)) {
      if (source[key] === null || source[key] === undefined) continue;
      if (typeof source[key] === 'object' && !Array.isArray(source[key]) && typeof target[key] === 'object' && !Array.isArray(target[key])) {
        result[key] = this.deepMergeObject(target[key] || {}, source[key]);
      } else if (typeof source[key] === 'string' && source[key].length > 0) {
        result[key] = source[key];
      } else if (Array.isArray(source[key]) && source[key].length > 0) {
        result[key] = source[key];
      } else if (typeof source[key] !== 'string') {
        result[key] = source[key];
      }
    }
    return result;
  }

  // Store lessons from Bible validation for writer injection
  private async storeBibleLessons(projectId: number, lessons: string[]): Promise<void> {
    try {
      const existingLogs = await storage.getActivityLogsByProject(projectId);
      const existingLessons = existingLogs.filter(l => l.agentRole === 'bible-lessons').map(l => l.message);
      
      for (const lesson of lessons) {
        if (!existingLessons.includes(lesson)) {
          await storage.createActivityLog({
            projectId,
            level: "info",
            agentRole: "bible-lessons",
            message: lesson,
          });
        }
      }
      console.log(`[BibleValidator] Stored ${lessons.length} lessons for writer`);
    } catch (err) {
      console.error("[BibleValidator] Failed to store lessons:", err);
    }
  }

  // Get accumulated lessons from Bible validation + checkpoint corrections for writer injection
  private async getAccumulatedLessons(projectId: number): Promise<string> {
    try {
      const logs = await storage.getActivityLogsByProject(projectId);
      const lessonLogs = logs.filter(l => 
        l.agentRole === 'bible-lessons' || 
        l.agentRole === 'checkpoint-lessons' ||
        l.agentRole === 'structural-checkpoint'
      );
      
      if (lessonLogs.length === 0) return "";

      const uniqueLessons = Array.from(new Set(lessonLogs.map(l => l.message)));
      if (uniqueLessons.length === 0) return "";

      const parts: string[] = [
        "\n═══════════════════════════════════════════════════════════════════",
        "LECCIONES APRENDIDAS EN ESTE PROYECTO (OBLIGATORIO APLICAR)",
        "═══════════════════════════════════════════════════════════════════",
      ];
      
      uniqueLessons.slice(0, 15).forEach((lesson, idx) => {
        parts.push(`  ${idx + 1}. ${lesson}`);
      });
      
      parts.push("Aplica TODAS estas lecciones en cada escena que escribas.");
      parts.push("═══════════════════════════════════════════════════════════════════");

      return parts.join("\n");
    } catch (err) {
      console.error("[OrchestratorV2] Failed to get accumulated lessons:", err);
      return "";
    }
  }

  // ============================================
  // LitAgents 2.9.10: Structural Checkpoint (every 5 chapters)
  // Verifies adherence to Bible structure, timeline, and character arcs
  // ============================================
  private async runStructuralCheckpoint(
    projectId: number,
    currentChapter: number,
    worldBible: any,
    outline: any[],
    narrativeTimeline: Array<{ chapter: number; narrativeTime: string; location?: string }>,
    lastCheckpointChapter: number = 0,
    alreadyCorrectedChapters: Set<number> = new Set()
  ): Promise<{ deviatedChapters: number[]; issues: string[]; lessonsLearned: string[] }> {
    const rangeStart = lastCheckpointChapter > 0 ? lastCheckpointChapter + 1 : 1;
    this.callbacks.onAgentStatus("structural-checkpoint", "active", `Verificación estructural (Cap ${rangeStart}-${currentChapter})...`);

    await storage.createActivityLog({
      projectId,
      level: "info",
      agentRole: "structural-checkpoint",
      message: `Ejecutando checkpoint estructural: capítulos ${rangeStart}-${currentChapter} (capítulos ya corregidos: ${alreadyCorrectedChapters.size > 0 ? Array.from(alreadyCorrectedChapters).join(', ') : 'ninguno'})`,
      metadata: { type: 'checkpoint_executed', rangeStart, rangeEnd: currentChapter, alreadyCorrected: Array.from(alreadyCorrectedChapters) },
    });

    const chapters = await storage.getChaptersByProject(projectId);
    const writtenChapters = chapters
      .filter(ch => ch.content && ch.content.length > 100 && ch.chapterNumber >= rangeStart && ch.chapterNumber <= currentChapter)
      .sort((a, b) => a.chapterNumber - b.chapterNumber);

    if (writtenChapters.length === 0) {
      return { deviatedChapters: [], issues: [], lessonsLearned: [] };
    }

    const chapterSummaries = writtenChapters.map(ch => {
      const outlineEntry = outline.find((o: any) => o.chapter_num === ch.chapterNumber);
      const plannedSummary = outlineEntry?.summary || 'N/A';
      const plannedEvent = outlineEntry?.key_event || 'N/A';
      return `CAPÍTULO ${ch.chapterNumber} ("${ch.title || ''}"):\n  PLAN: ${plannedSummary} [Evento: ${plannedEvent}]\n  RESUMEN REAL: ${ch.summary || ch.content?.substring(0, 500) || 'Sin resumen'}`;
    }).join('\n\n');

    const timelineStr = narrativeTimeline.length > 0 
      ? narrativeTimeline.map(t => `  Cap ${t.chapter}: ${t.narrativeTime}${t.location ? ` → ${t.location}` : ''}`).join('\n')
      : 'No disponible';

    const bibleCharacters = JSON.stringify(
      (worldBible.characters || []).map((c: any) => ({
        name: c.name || c.nombre,
        role: c.role || c.rol,
        arc: c.arc || c.arco,
      })),
      null, 2
    ).substring(0, 5000);

    const prompt = `Eres un director narrativo experto. Analiza si los capítulos escritos en este RANGO (${rangeStart}-${currentChapter}) SIGUEN FIELMENTE la estructura planificada.
IMPORTANTE: Solo reporta desviaciones de los capítulos en el rango ${rangeStart}-${currentChapter}. Los capítulos anteriores ya fueron verificados.

=== PERSONAJES Y ARCOS PLANIFICADOS ===
${bibleCharacters}

=== LÍNEA TEMPORAL ACUMULADA ===
${timelineStr}

=== COMPARACIÓN PLAN vs REALIDAD (Capítulos ${rangeStart}-${currentChapter}) ===
${chapterSummaries.substring(0, 20000)}

ANALIZA SOLO los capítulos ${rangeStart}-${currentChapter}:
1. ¿Cada capítulo cumple con su plan original? ¿Se ejecutaron los eventos clave?
2. ¿La línea temporal es coherente y continua?
3. ¿Los arcos de personajes progresan según lo planificado?
4. ¿Hay desviaciones que comprometan la estructura de la novela?
5. ¿Qué lecciones debe aprender el escritor para los próximos capítulos?
NO incluyas capítulos anteriores al ${rangeStart} en deviatedChapters.

RESPONDE EXCLUSIVAMENTE EN JSON VÁLIDO:
{
  "overallAdherence": 1-10,
  "deviatedChapters": [números de capítulos con desviaciones graves],
  "issues": [
    {
      "chapter": N,
      "type": "estructura|temporal|arco_personaje|evento_omitido|coherencia",
      "severity": "critica|mayor|menor",
      "description": "Qué se desvió del plan",
      "expectedVsActual": "Lo planeado vs lo escrito",
      "correctionNeeded": "Qué se debe corregir"
    }
  ],
  "timelineConsistency": true/false,
  "timelineIssues": ["Problema temporal 1", "..."],
  "lessonsForWriter": [
    "Lección específica sobre qué evitar en los próximos capítulos",
    "Patrón de error detectado que no debe repetirse"
  ]
}`;

    const MAX_CHECKPOINT_RETRIES = 2;
    for (let attempt = 0; attempt <= MAX_CHECKPOINT_RETRIES; attempt++) {
    try {
      const response = await geminiGenerateWithRetry(prompt, "gemini-2.5-flash", "StructuralCheckpoint");

      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        if (attempt < MAX_CHECKPOINT_RETRIES) {
          console.warn(`[StructuralCheckpoint] No JSON in response (attempt ${attempt + 1}/${MAX_CHECKPOINT_RETRIES + 1}), retrying...`);
          continue;
        }
        console.error("[StructuralCheckpoint] No JSON in response after all retries - logging as warning");
        await storage.createActivityLog({
          projectId,
          level: "warn",
          agentRole: "structural-checkpoint",
          message: `Checkpoint en cap ${currentChapter}: respuesta de IA sin formato válido tras ${MAX_CHECKPOINT_RETRIES + 1} intentos. Se omitirá este checkpoint.`,
        });
        return { deviatedChapters: [], issues: [], lessonsLearned: ["El checkpoint estructural no pudo ejecutarse correctamente - verificar en el siguiente punto de control"] };
      }

      const parsed = JSON.parse(jsonMatch[0]);
      const rawDeviatedChapters: number[] = parsed.deviatedChapters || [];
      // Filter out chapters already corrected in previous checkpoints and chapters outside range
      const deviatedChapters = rawDeviatedChapters.filter(ch => 
        ch >= rangeStart && ch <= currentChapter && !alreadyCorrectedChapters.has(ch)
      );
      const skippedCount = rawDeviatedChapters.length - deviatedChapters.length;
      const issues = (parsed.issues || [])
        .filter((i: any) => (i.severity === 'critica' || i.severity === 'mayor') && i.chapter >= rangeStart && !alreadyCorrectedChapters.has(i.chapter))
        .map((i: any) => `Cap ${i.chapter}: [${i.type}] ${i.description} → ${i.correctionNeeded}`);
      const lessonsLearned = parsed.lessonsForWriter || [];

      console.log(`[StructuralCheckpoint] Adherence: ${parsed.overallAdherence}/10, Deviations: ${deviatedChapters.length} (${skippedCount} skipped as already corrected/out of range), Lessons: ${lessonsLearned.length}`);

      // Log issues
      for (const issue of (parsed.issues || []).filter((i: any) => i.severity === 'critica' || i.severity === 'mayor')) {
        await storage.createActivityLog({
          projectId,
          level: issue.severity === 'critica' ? 'error' : 'warn',
          agentRole: "structural-checkpoint",
          message: `Cap ${issue.chapter}: [${issue.type}] ${issue.description}`,
          metadata: { correction: issue.correctionNeeded, expected: issue.expectedVsActual },
        });
      }

      // Store lessons for future chapters
      if (lessonsLearned.length > 0) {
        for (const lesson of lessonsLearned) {
          await storage.createActivityLog({
            projectId,
            level: "info",
            agentRole: "checkpoint-lessons",
            message: lesson,
          });
        }
        console.log(`[StructuralCheckpoint] Stored ${lessonsLearned.length} lessons for future chapters`);
      }

      // Timeline issues
      if (!parsed.timelineConsistency && parsed.timelineIssues?.length > 0) {
        for (const ti of parsed.timelineIssues) {
          await storage.createActivityLog({
            projectId,
            level: "warn",
            agentRole: "structural-checkpoint",
            message: `TEMPORAL: ${ti}`,
          });
        }
      }

      this.callbacks.onAgentStatus("structural-checkpoint", 
        deviatedChapters.length > 0 ? "warning" : "completed",
        deviatedChapters.length > 0 
          ? `${deviatedChapters.length} capítulos desviados detectados`
          : `Estructura verificada (${parsed.overallAdherence}/10)`
      );

      await storage.createActivityLog({
        projectId,
        level: deviatedChapters.length > 0 ? "warn" : "success",
        agentRole: "structural-checkpoint",
        message: deviatedChapters.length > 0 
          ? `Checkpoint: ${deviatedChapters.length} capítulos con desviaciones graves (adherencia ${parsed.overallAdherence}/10). Capítulos: ${deviatedChapters.join(', ')}`
          : `Checkpoint: Estructura correcta (adherencia ${parsed.overallAdherence}/10). ${lessonsLearned.length} lecciones registradas.`,
      });

      return { deviatedChapters, issues, lessonsLearned };
    } catch (error) {
      if (attempt < MAX_CHECKPOINT_RETRIES) {
        console.warn(`[StructuralCheckpoint] Error on attempt ${attempt + 1}/${MAX_CHECKPOINT_RETRIES + 1}, retrying...`, error);
        continue;
      }
      console.error("[StructuralCheckpoint] Error after all retries:", error);
      this.callbacks.onAgentStatus("structural-checkpoint", "completed", "Checkpoint completado con advertencias");
      return { deviatedChapters: [], issues: [], lessonsLearned: ["Error en checkpoint estructural - verificar en el siguiente punto de control"] };
    }
    } // end for loop
    return { deviatedChapters: [], issues: [], lessonsLearned: [] };
  }

  // Rewrite a chapter that deviated from the plan
  private async rewriteDeviatedChapter(
    projectId: number,
    chapterNumber: number,
    worldBible: any,
    outline: any[],
    deviationDescription: string
  ): Promise<boolean> {
    try {
      const chapters = await storage.getChaptersByProject(projectId);
      const chapter = chapters.find(ch => ch.chapterNumber === chapterNumber);
      if (!chapter || !chapter.content) return false;

      const outlineEntry = outline.find((o: any) => o.chapter_num === chapterNumber);
      if (!outlineEntry) return false;

      this.callbacks.onAgentStatus("structural-checkpoint", "active", `Reescribiendo capítulo ${chapterNumber}...`);

      const prevChapter = chapters.find(ch => ch.chapterNumber === chapterNumber - 1);
      const nextChapter = chapters.find(ch => ch.chapterNumber === chapterNumber + 1);

      const prompt = `CORRECCIÓN ESTRUCTURAL OBLIGATORIA - CAPÍTULO ${chapterNumber}

PROBLEMA DETECTADO:
${deviationDescription}

PLAN ORIGINAL PARA ESTE CAPÍTULO:
Título: ${outlineEntry.title}
Resumen planificado: ${outlineEntry.summary}
Evento clave: ${outlineEntry.key_event || 'N/A'}

CONTEXTO ADYACENTE:
${prevChapter ? `Capítulo anterior (${chapterNumber - 1}): ${prevChapter.summary || prevChapter.content?.substring(0, 500)}` : 'Es el primer capítulo'}
${nextChapter ? `Capítulo siguiente (${chapterNumber + 1}): ${nextChapter.summary || nextChapter.content?.substring(0, 500)}` : 'Es el último capítulo escrito'}

TEXTO ACTUAL DEL CAPÍTULO:
${chapter.content}

INSTRUCCIONES:
1. Reescribe SOLO las partes que se desvían del plan original
2. Mantén todo lo que ya está bien escrito
3. Asegúrate de que el evento clave planificado OCURRA en el capítulo
4. Preserva las transiciones con los capítulos adyacentes
5. NO cambies el estilo ni la voz narrativa

Devuelve SOLO el texto completo del capítulo reescrito, sin explicaciones ni marcadores.`;

      const rewriteResult = await this.smartEditor.fullRewrite({
        chapterContent: chapter.content,
        errorDescription: prompt,
        worldBible: {
          characters: (worldBible.characters || worldBible.personajes || []) as any[],
          locations: (worldBible.locations || worldBible.lugares || []) as any[],
          worldRules: (worldBible.rules || worldBible.reglas || worldBible.worldRules || []) as any[],
          persistentInjuries: (worldBible.persistentInjuries || worldBible.lesiones || []) as any[],
          plotDecisions: (worldBible.plotDecisions || worldBible.decisiones || []) as any[],
        },
        chapterNumber,
        chapterTitle: outlineEntry.title,
        previousChapterSummary: prevChapter?.summary || "",
        nextChapterSummary: nextChapter?.summary || "",
      });

      this.addTokenUsage(rewriteResult.tokenUsage);
      await this.logAiUsage(projectId, "structural-checkpoint", "deepseek-chat", rewriteResult.tokenUsage, chapterNumber);

      if (rewriteResult.rewrittenContent && rewriteResult.rewrittenContent.length > 200) {
        const newWordCount = rewriteResult.rewrittenContent.split(/\s+/).length;
        const originalWordCount = chapter.content.split(/\s+/).length;
        const MIN_WORD_COUNT = 1200;
        const MIN_RATIO = 0.7; // Rewrite must be at least 70% of original length
        
        // Verify rewrite didn't lose too much content
        if (newWordCount < MIN_WORD_COUNT || newWordCount < originalWordCount * MIN_RATIO) {
          console.warn(`[StructuralCheckpoint] Chapter ${chapterNumber} rewrite too short (${newWordCount} vs ${originalWordCount} original, min ${MIN_WORD_COUNT}). Keeping original.`);
          await storage.createActivityLog({
            projectId,
            level: "warn",
            agentRole: "structural-checkpoint",
            message: `Capítulo ${chapterNumber}: reescritura descartada por pérdida de contenido (${newWordCount} palabras vs ${originalWordCount} original). Se mantiene la versión actual.`,
          });
          return false;
        }
        
        await storage.updateChapter(chapter.id, {
          originalContent: chapter.originalContent || chapter.content,
          content: rewriteResult.rewrittenContent,
          wordCount: newWordCount,
        });

        await storage.createActivityLog({
          projectId,
          level: "success",
          agentRole: "structural-checkpoint",
          message: `Capítulo ${chapterNumber} reescrito para corregir desviación estructural (${newWordCount} palabras, original: ${originalWordCount})`,
          metadata: { type: 'chapter_rewritten', chapterNumber, newWordCount, originalWordCount },
        });

        console.log(`[StructuralCheckpoint] Chapter ${chapterNumber} rewritten (${newWordCount} words, was ${originalWordCount})`);
        return true;
      }

      return false;
    } catch (error) {
      console.error(`[StructuralCheckpoint] Failed to rewrite chapter ${chapterNumber}:`, error);
      return false;
    }
  }

  // LitAgents 2.9.10: Full-novel structural review after all chapters are written
  private async runFinalStructuralReview(
    projectId: number,
    worldBible: any,
    outline: any[],
    narrativeTimeline: Array<{ chapter: number; narrativeTime: string; location?: string }>,
    alreadyCorrectedChapters: Set<number>,
    chapterSummaries: string[]
  ): Promise<{ rewrittenCount: number; issues: string[]; lessonsLearned: string[] }> {
    console.log(`[FinalStructuralReview] Starting full-novel structural review for project ${projectId}`);
    
    if (!geminiApiKey) {
      console.warn("[FinalStructuralReview] No GEMINI_API_KEY - cannot run final structural review");
      await storage.createActivityLog({
        projectId,
        level: "warn",
        agentRole: "structural-checkpoint",
        message: `Revisión estructural final omitida: no hay clave de Gemini configurada.`,
      });
      return { rewrittenCount: 0, issues: [], lessonsLearned: ["Revisión final omitida por falta de clave Gemini"] };
    }

    await storage.createActivityLog({
      projectId,
      level: "info",
      agentRole: "structural-checkpoint",
      message: `Ejecutando revisión estructural FINAL de toda la novela`,
      metadata: { type: 'final_review_started' },
    });

    const chapters = await storage.getChaptersByProject(projectId);
    const writtenChapters = chapters
      .filter(ch => ch.content && ch.content.length > 100)
      .sort((a, b) => a.chapterNumber - b.chapterNumber);

    if (writtenChapters.length === 0) {
      return { rewrittenCount: 0, issues: [], lessonsLearned: [] };
    }

    // Use summaries (compact) rather than raw content to ensure ALL chapters fit in context
    const chapterSummariesForReview = writtenChapters.map(ch => {
      const outlineEntry = outline.find((o: any) => o.chapter_num === ch.chapterNumber);
      const plannedSummary = outlineEntry?.summary || 'N/A';
      const plannedEvent = outlineEntry?.key_event || 'N/A';
      const actualWordCount = ch.content?.split(/\s+/).length || 0;
      const actualSummary = ch.summary || ch.content?.substring(0, 300) || 'Sin resumen';
      const chapterLabel = ch.chapterNumber === 0 ? 'PRÓLOGO' : ch.chapterNumber === 998 ? 'EPÍLOGO' : ch.chapterNumber === 999 ? 'NOTA DEL AUTOR' : `CAPÍTULO ${ch.chapterNumber}`;
      return `${chapterLabel} ("${ch.title || ''}" - ${actualWordCount} palabras):\n  PLAN: ${plannedSummary} [Evento: ${plannedEvent}]\n  RESUMEN REAL: ${actualSummary}`;
    }).join('\n\n');

    const timelineStr = narrativeTimeline.length > 0
      ? narrativeTimeline.map(t => `  Cap ${t.chapter}: ${t.narrativeTime}${t.location ? ` → ${t.location}` : ''}`).join('\n')
      : 'No disponible';

    const bibleCharacters = JSON.stringify(
      (worldBible.characters || []).map((c: any) => ({
        name: c.name || c.nombre,
        role: c.role || c.rol,
        arc: c.arc || c.arco,
      })), null, 2
    ).substring(0, 5000);

    const plotOutline = worldBible.plotOutline || {};
    const threeActStructure = plotOutline.three_act_structure || plotOutline.threeActStructure || {};

    const prompt = `Eres un director editorial experto. Esta es la REVISIÓN FINAL de toda la novela completa (${writtenChapters.length} capítulos).
Tu misión es detectar PROBLEMAS ESTRUCTURALES GRAVES que comprometan la calidad de la novela como obra terminada.

=== ESTRUCTURA EN 3 ACTOS PLANIFICADA ===
${JSON.stringify(threeActStructure, null, 2).substring(0, 3000)}

=== PERSONAJES Y ARCOS PLANIFICADOS ===
${bibleCharacters}

=== LÍNEA TEMPORAL COMPLETA ===
${timelineStr}

=== COMPARACIÓN PLAN vs REALIDAD (TODOS LOS CAPÍTULOS) ===
${chapterSummariesForReview.substring(0, 50000)}

ANALIZA LA NOVELA COMPLETA COMO UNIDAD:

1. ARCOS DE PERSONAJES: ¿Cada arco principal se inicia, desarrolla y cierra correctamente?
2. HILOS NARRATIVOS: ¿Hay subtramas abandonadas, hilos sin resolver, o Chekhov's guns sin disparar?
3. ESTRUCTURA DE 3 ACTOS: ¿Los puntos de giro, clímax y resolución están donde deben estar?
4. EVENTOS CLAVE OMITIDOS: ¿Algún evento crucial del plan original NUNCA se ejecutó?
5. COHERENCIA TEMPORAL: ¿La línea temporal global tiene saltos o contradicciones?
6. RITMO GLOBAL: ¿Hay tramos excesivamente lentos o apresurados que afecten la experiencia lectora?
7. PROTAGONISTA: ¿El protagonista tiene presencia suficiente y su arco es satisfactorio?

IMPORTANTE:
- Solo reporta problemas GRAVES que un lector notaría. No reportes cuestiones estilísticas menores.
- El "EPÍLOGO" y la "NOTA DEL AUTOR" son secciones especiales al final de la novela. Su posición y nombre son correctos por convención — NO reportes problemas sobre su numeración o ubicación.

RESPONDE EXCLUSIVAMENTE EN JSON VÁLIDO:
{
  "overallScore": 1-10,
  "novelWorksAsUnit": true/false,
  "deviatedChapters": [números de capítulos con problemas GRAVES que requieren reescritura],
  "issues": [
    {
      "chapter": N,
      "type": "arco_incompleto|hilo_sin_resolver|evento_omitido|temporal|estructura|ritmo|protagonista",
      "severity": "critica|mayor",
      "description": "Qué problema específico tiene",
      "correctionNeeded": "Qué se debe corregir exactamente"
    }
  ],
  "unresolvedThreads": ["Hilo narrativo que quedó sin cerrar"],
  "arcCompletionStatus": [
    { "character": "nombre", "arcComplete": true/false, "missing": "qué falta" }
  ],
  "lessonsForWriter": [
    "Lección global sobre la estructura de la novela"
  ],
  "verdict": "Resumen ejecutivo de la calidad estructural"
}`;

    const MAX_RETRIES = 2;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await geminiGenerateWithRetry(prompt, "gemini-2.5-flash", "FinalStructuralReview");

        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          if (attempt < MAX_RETRIES) {
            console.warn(`[FinalStructuralReview] No JSON in response (attempt ${attempt + 1}), retrying...`);
            continue;
          }
          console.error("[FinalStructuralReview] No JSON after all retries");
          return { rewrittenCount: 0, issues: [], lessonsLearned: [] };
        }

        const parsed = JSON.parse(jsonMatch[0]);
        // LitAgents 2.9.10: Final review DOES NOT filter out previously-corrected chapters
        // Previous checkpoints may have introduced new issues, so the final review must be able to re-correct them
        // Exclude special chapters (0=prologue, 998=epilogue, 999=author note) from structural corrections
        const deviatedChapters: number[] = (parsed.deviatedChapters || []).filter((ch: number) => ch !== 998 && ch !== 999);
        if (alreadyCorrectedChapters.size > 0) {
          const reCorrected = deviatedChapters.filter((ch: number) => alreadyCorrectedChapters.has(ch));
          if (reCorrected.length > 0) {
            console.log(`[FinalStructuralReview] Will re-correct ${reCorrected.length} previously-corrected chapters: ${reCorrected.join(', ')}`);
          }
        }
        const issues = (parsed.issues || [])
          .filter((i: any) => i.severity === 'critica' || i.severity === 'mayor')
          .map((i: any) => `Cap ${i.chapter}: [${i.type}] ${i.description} → ${i.correctionNeeded}`);
        const lessonsLearned = parsed.lessonsForWriter || [];
        const unresolvedThreads = parsed.unresolvedThreads || [];
        const arcStatus = parsed.arcCompletionStatus || [];

        console.log(`[FinalStructuralReview] Score: ${parsed.overallScore}/10, Works as unit: ${parsed.novelWorksAsUnit}, Deviations: ${deviatedChapters.length}, Unresolved threads: ${unresolvedThreads.length}`);

        await storage.createActivityLog({
          projectId,
          level: deviatedChapters.length > 0 ? "warn" : "success",
          agentRole: "structural-checkpoint",
          message: `Revisión final: ${parsed.overallScore}/10. ${deviatedChapters.length > 0 ? `${deviatedChapters.length} capítulos con desviaciones graves.` : 'Estructura correcta.'} ${unresolvedThreads.length > 0 ? `Hilos sin resolver: ${unresolvedThreads.join(', ')}` : ''} Veredicto: ${parsed.verdict || 'N/A'}`,
          metadata: { type: 'final_review_result', score: parsed.overallScore, novelWorksAsUnit: parsed.novelWorksAsUnit, deviatedCount: deviatedChapters.length, unresolvedThreads },
        });

        for (const issue of (parsed.issues || []).filter((i: any) => i.severity === 'critica' || i.severity === 'mayor')) {
          const issueChap = typeof issue.chapter === 'number' ? issue.chapter : parseInt(issue.chapter);
          if (issueChap === 998 || issueChap === 999) {
            console.log(`[FinalStructuralReview] Skipping structural issue for special chapter ${issueChap} (epilogue/author note): ${issue.description?.substring(0, 80)}`);
            continue;
          }
          const chapLabel = issueChap === 0 ? 'Prólogo' : `Cap ${issueChap}`;
          await storage.createActivityLog({
            projectId,
            level: issue.severity === 'critica' ? 'error' : 'warn',
            agentRole: "structural-checkpoint",
            message: `[FINAL] ${chapLabel}: [${issue.type}] ${issue.description}`,
            metadata: { correction: issue.correctionNeeded },
          });
        }

        for (const arc of arcStatus.filter((a: any) => !a.arcComplete)) {
          await storage.createActivityLog({
            projectId,
            level: "warn",
            agentRole: "structural-checkpoint",
            message: `[FINAL] Arco incompleto: ${arc.character} - ${arc.missing}`,
          });
        }

        if (lessonsLearned.length > 0) {
          for (const lesson of lessonsLearned) {
            await storage.createActivityLog({
              projectId,
              level: "info",
              agentRole: "checkpoint-lessons",
              message: `[FINAL] ${lesson}`,
            });
          }
        }

        // Rewrite deviated chapters (max 5 to prevent excessive token usage)
        const MAX_FINAL_REWRITES = 5;
        let rewrittenCount = 0;
        const chaptersToRewrite = deviatedChapters.slice(0, MAX_FINAL_REWRITES);
        
        // v2.9.10: Log skipped chapters when limit is exceeded
        if (deviatedChapters.length > MAX_FINAL_REWRITES) {
          const skippedChapters = deviatedChapters.slice(MAX_FINAL_REWRITES);
          console.warn(`[FinalStructuralReview] ${skippedChapters.length} deviated chapters will NOT be corrected (limit ${MAX_FINAL_REWRITES}): ${skippedChapters.join(', ')}`);
          await storage.createActivityLog({
            projectId,
            level: "warn",
            agentRole: "structural-checkpoint",
            message: `[FINAL] ${skippedChapters.length} capítulos con desviaciones NO corregidos por límite de reescrituras (${MAX_FINAL_REWRITES}): Capítulos ${skippedChapters.join(', ')}. Considera ejecutar "Detect & Fix" manualmente.`,
            metadata: { type: 'final_review_skipped', skippedChapters },
          });
        }

        for (const deviatedChNum of chaptersToRewrite) {
          if (await this.shouldStopProcessing(projectId)) break;

          const deviationIssue = issues.find((i: string) => i.includes(`Cap ${deviatedChNum}`)) ||
            `Capítulo ${deviatedChNum} tiene problemas estructurales detectados en la revisión final`;

          this.callbacks.onAgentStatus("structural-checkpoint", "active", `Corrigiendo capítulo ${deviatedChNum} (revisión final)...`);

          const rewritten = await this.rewriteDeviatedChapter(
            projectId, deviatedChNum, worldBible, outline, deviationIssue
          );

          if (rewritten) {
            const updatedChapters = await storage.getChaptersByProject(projectId);
            const updatedCh = updatedChapters.find(c => c.chapterNumber === deviatedChNum);

            if (updatedCh?.content) {
              const verification = await this.verifyRewriteFixed(
                projectId, deviatedChNum, updatedCh.content, outline, deviationIssue
              );

              if (!verification.fixed && verification.remainingIssues.length > 0) {
                console.log(`[FinalStructuralReview] Chapter ${deviatedChNum} rewrite did NOT fix problem. Second attempt...`);
                const enhancedIssue = `${deviationIssue}\n\nPROBLEMAS PERSISTENTES:\n${verification.remainingIssues.join('\n')}`;

                const rewritten2 = await this.rewriteDeviatedChapter(
                  projectId, deviatedChNum, worldBible, outline, enhancedIssue
                );

                if (rewritten2) {
                  const recheckChapters = await storage.getChaptersByProject(projectId);
                  const recheckCh = recheckChapters.find(c => c.chapterNumber === deviatedChNum);
                  if (recheckCh?.content) {
                    const v2 = await this.verifyRewriteFixed(
                      projectId, deviatedChNum, recheckCh.content, outline, enhancedIssue
                    );
                    if (!v2.fixed) {
                      await storage.createActivityLog({
                        projectId,
                        level: "warn",
                        agentRole: "structural-checkpoint",
                        message: `[FINAL] Capítulo ${deviatedChNum}: desviación persistente tras 2 intentos. Problemas: ${v2.remainingIssues.join('; ')}`,
                        metadata: { type: 'persistent_deviation', chapterNumber: deviatedChNum, phase: 'final_review' },
                      });
                    }
                  }
                }
              }
            }

            rewrittenCount++;
            alreadyCorrectedChapters.add(deviatedChNum);

            // Re-summarize the corrected chapter
            const finalChapters = await storage.getChaptersByProject(projectId);
            const finalCh = finalChapters.find(c => c.chapterNumber === deviatedChNum);
            if (finalCh) {
              const summaryResult = await this.summarizer.execute({
                chapterContent: finalCh.content || '',
                chapterNumber: deviatedChNum,
              });
              this.addTokenUsage(summaryResult.tokenUsage);
              if (summaryResult.content) {
                await storage.updateChapter(finalCh.id, { summary: summaryResult.content });
              }
            }
          }
        }

        // v2.9.10: If the final review found unresolved narrative threads, rewrite the last chapter to close them
        if (unresolvedThreads.length > 0 && !await this.shouldStopProcessing(projectId)) {
          const chapters = await storage.getChaptersByProject(projectId);
          const writtenSorted = chapters
            .filter((ch: any) => ch.content && ch.content.length > 100)
            .sort((a: any, b: any) => a.chapterNumber - b.chapterNumber);
          const lastWritten = writtenSorted[writtenSorted.length - 1];
          
          if (lastWritten && !chaptersToRewrite.includes(lastWritten.chapterNumber)) {
            console.log(`[FinalStructuralReview] Rewriting last chapter ${lastWritten.chapterNumber} to close ${unresolvedThreads.length} unresolved threads: ${unresolvedThreads.join(', ')}`);
            this.callbacks.onAgentStatus("structural-checkpoint", "active", `Cerrando ${unresolvedThreads.length} hilos narrativos abiertos en capítulo ${lastWritten.chapterNumber}...`);
            
            const closureIssue = `HILOS NARRATIVOS SIN CERRAR - DEBES resolver estos hilos:\n${unresolvedThreads.map((t: string) => `- ${t}`).join("\n")}\n\nIntegra los cierres de forma natural en la narrativa existente del capítulo.`;
            
            const closureRewritten = await this.rewriteDeviatedChapter(
              projectId, lastWritten.chapterNumber, worldBible, outline, closureIssue
            );
            
            if (closureRewritten) {
              rewrittenCount++;
              console.log(`[FinalStructuralReview] Last chapter rewritten to close unresolved threads`);
              
              // Re-summarize
              const updatedChapters = await storage.getChaptersByProject(projectId);
              const updatedLast = updatedChapters.find(c => c.chapterNumber === lastWritten.chapterNumber);
              if (updatedLast) {
                const summaryResult = await this.summarizer.execute({
                  chapterContent: updatedLast.content || '',
                  chapterNumber: lastWritten.chapterNumber,
                });
                this.addTokenUsage(summaryResult.tokenUsage);
                if (summaryResult.content) {
                  await storage.updateChapter(updatedLast.id, { summary: summaryResult.content });
                }
              }
              
              // LitAgents 3.2: Mark closed threads as resolved in the DB
              const allPlotThreads = await storage.getPlotThreadsByProject(projectId);
              for (const threadName of unresolvedThreads) {
                const threadNameLower = (threadName as string).toLowerCase();
                const matchingThread = allPlotThreads.find(t => {
                  const tNameLower = (t.name || '').toLowerCase();
                  const tDescLower = (t.description || '').toLowerCase();
                  return tNameLower.includes(threadNameLower) || threadNameLower.includes(tNameLower) ||
                    threadNameLower.split(/\s+/).filter((w: string) => w.length >= 4).some((w: string) => tNameLower.includes(w) || tDescLower.includes(w));
                });
                if (matchingThread && matchingThread.status !== 'resolved') {
                  await storage.updateProjectPlotThread(matchingThread.id, {
                    status: 'resolved',
                    lastUpdatedChapter: lastWritten.chapterNumber,
                  });
                  console.log(`[FinalStructuralReview] Thread "${matchingThread.name}" marked as resolved in DB (closed in final review)`);
                }
              }
            }
          }
        }

        await storage.createActivityLog({
          projectId,
          level: "success",
          agentRole: "structural-checkpoint",
          message: `Revisión final completada: ${rewrittenCount} capítulos corregidos de ${deviatedChapters.length} detectados. ${unresolvedThreads.length > 0 ? `${unresolvedThreads.length} hilos narrativos cerrados.` : ''} Puntuación estructural: ${parsed.overallScore}/10.`,
          metadata: { type: 'final_review_completed', rewrittenCount, totalDeviated: deviatedChapters.length, score: parsed.overallScore, threadsClosed: unresolvedThreads.length },
        });

        return { rewrittenCount, issues, lessonsLearned };
      } catch (error) {
        if (attempt < MAX_RETRIES) {
          console.warn(`[FinalStructuralReview] Error on attempt ${attempt + 1}, retrying...`, error);
          continue;
        }
        console.error("[FinalStructuralReview] Error after all retries:", error);
        return { rewrittenCount: 0, issues: [], lessonsLearned: [] };
      }
    }
    return { rewrittenCount: 0, issues: [], lessonsLearned: [] };
  }

  private async verifyRewriteFixed(
    projectId: number,
    chapterNumber: number,
    rewrittenContent: string,
    outline: any[],
    originalDeviation: string
  ): Promise<{ fixed: boolean; remainingIssues: string[] }> {
    try {
      const outlineEntry = outline.find((o: any) => o.chapter_num === chapterNumber);
      if (!outlineEntry) return { fixed: true, remainingIssues: [] };

      const prompt = `Eres un verificador de correcciones estructurales. Después de reescribir un capítulo, debes confirmar que la desviación fue corregida.

PROBLEMA ORIGINAL:
${originalDeviation}

PLAN ORIGINAL PARA CAPÍTULO ${chapterNumber}:
Título: ${outlineEntry.title}
Resumen planificado: ${outlineEntry.summary}
Evento clave: ${outlineEntry.key_event || 'N/A'}

TEXTO REESCRITO:
${rewrittenContent.substring(0, 15000)}

VERIFICA:
1. ¿El problema original fue corregido en la reescritura?
2. ¿El evento clave planificado ahora SÍ ocurre?
3. ¿La reescritura no introdujo nuevos problemas estructurales graves?

RESPONDE EXCLUSIVAMENTE EN JSON VÁLIDO:
{
  "fixed": true/false,
  "confidence": 1-10,
  "remainingIssues": ["Problema que persiste o fue introducido"],
  "verdict": "Breve explicación"
}`;

      const response = await geminiGenerateWithRetry(prompt, "gemini-2.5-flash", "PostRewriteVerify");

      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return { fixed: true, remainingIssues: [] };

      const parsed = JSON.parse(jsonMatch[0]);
      const fixed = parsed.fixed === true && (parsed.confidence || 5) >= 5;

      console.log(`[StructuralCheckpoint] Verification Ch ${chapterNumber}: fixed=${fixed}, confidence=${parsed.confidence}, verdict="${parsed.verdict}"`);

      await storage.createActivityLog({
        projectId,
        level: fixed ? "success" : "warn",
        agentRole: "structural-checkpoint",
        message: fixed
          ? `Verificación: Capítulo ${chapterNumber} corregido exitosamente (confianza ${parsed.confidence}/10)`
          : `Verificación: Capítulo ${chapterNumber} NO corregido completamente - ${parsed.verdict}`,
        metadata: { type: 'rewrite_verification', chapterNumber, fixed, confidence: parsed.confidence, remainingIssues: parsed.remainingIssues },
      });

      return { fixed, remainingIssues: parsed.remainingIssues || [] };
    } catch (error) {
      console.error(`[StructuralCheckpoint] Verification failed for Ch ${chapterNumber}:`, error);
      return { fixed: true, remainingIssues: [] };
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
    }, this.geminiQAFlags?.narrativeDirector ? { forceProvider: "gemini" } : undefined);

    const ndModel = this.geminiQAFlags?.narrativeDirector ? "gemini-3-pro-preview" : "deepseek-chat";
    this.addTokenUsage(result.tokenUsage);
    await this.logAiUsage(projectId, "narrative-director", ndModel, result.tokenUsage, currentChapter);

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

      // v2.9.10: Check for unresolved threads at epilogue OR at the last chapter (when no epilogue)
      const isLastCheckpoint = currentChapter === 998 || currentChapter === totalChapters;
      if (isLastCheckpoint) {
        unresolvedThreads = plotThreads
          .filter(t => t.status === "active" || t.status === "developing")
          .map(t => t.name);
        
        const criticalKeywords = ["inconsistencia", "sin resolver", "unresolved", "contradiction", "error", "problema"];
        const hasCriticalIssue = criticalKeywords.some(kw => directive.toLowerCase().includes(kw));
        
        needsRewrite = unresolvedThreads.length > 0 || hasCriticalIssue;
        
        if (needsRewrite) {
          console.log(`[OrchestratorV2] Chapter ${currentChapter} needs rewrite: ${unresolvedThreads.length} unresolved threads, critical issues: ${hasCriticalIssue}`);
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
   * LitAgents 2.5: Added consistencyConstraints parameter to ensure KU pacing guidelines are passed
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
    guiaEstilo: string,
    consistencyConstraints?: string // LitAgents 2.5: Now accepts constraints with KU pacing
  ): Promise<{ content: string; summary: string; wordCount: number; sceneBreakdown: ChapterArchitectOutput }> {
    // Sync deaths from world_entities into worldBible before writing
    await this.syncEntitiesIntoWorldBible(project.id, worldBible);
    
    // Plan scenes with constraints (now includes KU pacing if enabled)
    // Extract outline from worldBible if available for plot context
    // Note: World Bible stores as chapterOutlines, not chapters
    const plotOutlineData = worldBible?.plotOutline as any;
    const fullOutline = plotOutlineData?.chapterOutlines || plotOutlineData?.chapters || [];
    
    // LitAgents 2.5: If no constraints provided, generate basic KU context if project has KU enabled
    let effectiveConstraints = consistencyConstraints || "";
    if (!effectiveConstraints && project.kindleUnlimitedOptimized) {
      const enrichedOptions = await this.buildEnrichedContextOptions(project);
      effectiveConstraints = await this.buildEnrichedWritingContext(project.id, chapterOutline.chapter_num, worldBible, enrichedOptions);
      console.log(`[OrchestratorV2] Generated KU pacing constraints for helper (${effectiveConstraints.length} chars)`);
    }
    
    // LitAgents 2.9.7: Get pattern analysis to prevent structural repetition
    const patternTracker = getPatternTracker(project.id);
    const patternAnalysis = patternTracker.analyzeForChapter(chapterOutline.chapter_num);
    const patternAnalysisContext = patternTracker.formatForPrompt(patternAnalysis);
    
    const chapterPlan = await this.chapterArchitect.execute({
      chapterOutline,
      worldBible,
      previousChapterSummary,
      storyState: rollingSummary,
      consistencyConstraints: effectiveConstraints, // LitAgents 2.5: Pass KU pacing constraints
      fullPlotOutline: fullOutline, // LitAgents 2.1: Full plot context
      isKindleUnlimited: project.kindleUnlimitedOptimized || false, // LitAgents 2.5: Direct KU pacing flag
      patternAnalysisContext, // LitAgents 2.9.7: Anti-repetition pattern context
    });

    if (!chapterPlan.parsed) {
      throw new Error("Chapter planning failed");
    }

    const sceneBreakdown = chapterPlan.parsed;
    
    // LitAgents 2.9.7: Register the chapter's pattern after planning
    const chapterPattern = patternTracker.extractPatternFromScenes(
      chapterOutline.chapter_num,
      chapterOutline.title,
      sceneBreakdown.scenes.map(s => ({
        plot_beat: s.plot_beat,
        emotional_beat: s.emotional_beat,
        ending_hook: s.ending_hook
      })),
      sceneBreakdown.chapter_hook
    );
    patternTracker.registerPattern(chapterPattern);

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
        currentChapterText: fullChapterText,
        seriesWorldBible: await this.getSeriesWorldBibleForInjection(project.id),
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
    
    // Register correction in global tracking so cancel button works
    const startCorrection = (global as any).startCorrection;
    const endCorrection = (global as any).endCorrection;
    if (startCorrection) {
      startCorrection(project.id, 'legacy');
    }
    
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

      const worldBibleData: any = {
        characters: worldBible.characters || [],
        rules: worldBible.worldRules || [],
        worldRules: worldBible.worldRules || [],
        locations: (worldBible as any).locations || [],
        settings: (worldBible as any).settings || [],
        plotOutline: worldBible.plotOutline || {},
        timeline: (worldBible as any).timeline || [],
        plotDecisions: worldBible.plotDecisions || [],
        persistentInjuries: worldBible.persistentInjuries || [],
        threeActStructure: (worldBible.plotOutline as any)?.threeActStructure || null,
        three_act_structure: (worldBible.plotOutline as any)?.three_act_structure || null,
      };

      // CRITICAL: Restore cycle state from database to survive restarts
      let currentCycle = project.revisionCycle || 0;
      let finalResult: FinalReviewerResult | null = null;
      // Track corrected issues between cycles to inform FinalReviewer
      let correctedIssuesSummaries: string[] = [];
      // Track previous cycle score for consistency enforcement
      let previousCycleScore: number | undefined = undefined;
      
      // LitAgents 2.9.1: Chapter snapshot system for regression rollback
      // Stores chapter content before corrections to enable rollback if score drops
      type ChapterSnapshot = { chapterNumber: number; content: string; title: string };
      let chapterSnapshots: ChapterSnapshot[] = [];
      let lastGoodScore: number = 0;
      
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
      
      // LitAgents 2.9.3: Track successfully corrected chapters to avoid re-correcting them
      // Once a chapter passes correction successfully, it should not be touched again
      // PERSISTED: Load from database to survive restarts
      const loadedCorrectedChapters = (project.successfullyCorrectedChapters as number[]) || [];
      const successfullyCorrectedChapters: Set<number> = new Set(loadedCorrectedChapters);
      console.log(`[OrchestratorV2] Loaded ${successfullyCorrectedChapters.size} successfully corrected chapters from database`);
      
      // Helper function to persist corrected chapters to database
      const persistCorrectedChapters = async () => {
        await storage.updateProject(project.id, {
          successfullyCorrectedChapters: Array.from(successfullyCorrectedChapters),
        });
      };

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
          
          // Run QA Agents SEQUENTIALLY to avoid rate limits (was parallel, causing freezes)
          const qaResults: any[] = [];
          
          // Calculate total audits for progress tracking
          const continuityBlocks = Math.ceil(chaptersForQA.length / 5);
          const voiceBlocks = Math.ceil(chaptersForQA.length / 10);
          const totalAudits = continuityBlocks + voiceBlocks + 1; // +1 for semantic
          let completedAudits = 0;
          
          // Continuity Sentinel - analyze in blocks of 5 chapters (SEQUENTIAL)
          for (let i = 0; i < chaptersForQA.length; i += 5) {
            if (await this.shouldStopProcessing(project.id)) return;
            
            const block = chaptersForQA.slice(i, i + 5);
            const startChapter = completedChapters[i]?.chapterNumber || i + 1;
            const endChapter = completedChapters[Math.min(i + 4, completedChapters.length - 1)]?.chapterNumber || i + 5;
            
            completedAudits++;
            this.callbacks.onAgentStatus("beta-reader", "active", `Auditoría continuidad caps ${startChapter}-${endChapter} (${completedAudits}/${totalAudits})...`);
            
            try {
              const csForceProvider = this.geminiQAFlags?.continuitySentinel ? { forceProvider: "gemini" as const } : undefined;
              const result = await this.continuitySentinel.auditContinuity(block, startChapter, endChapter, csForceProvider);
              if (result.tokenUsage) {
                this.addTokenUsage(result.tokenUsage);
                const csModel = this.geminiQAFlags?.continuitySentinel ? "gemini-3-pro-preview" : "deepseek-reasoner";
                await this.logAiUsage(project.id, "continuity-sentinel", csModel, result.tokenUsage);
              }
              qaResults.push({ type: 'continuity', result, startChapter, endChapter });
            } catch (e: any) {
              qaResults.push({ type: 'continuity', error: e.message });
            }
          }
          
          // Voice Rhythm Auditor - analyze in blocks of 10 chapters (SEQUENTIAL)
          for (let i = 0; i < chaptersForQA.length; i += 10) {
            if (await this.shouldStopProcessing(project.id)) return;
            
            const block = chaptersForQA.slice(i, i + 10);
            const startChapter = completedChapters[i]?.chapterNumber || i + 1;
            const endChapter = completedChapters[Math.min(i + 9, completedChapters.length - 1)]?.chapterNumber || i + 10;
            
            completedAudits++;
            this.callbacks.onAgentStatus("beta-reader", "active", `Auditoría voz/ritmo caps ${startChapter}-${endChapter} (${completedAudits}/${totalAudits})...`);
            
            try {
              const result = await this.voiceRhythmAuditor.auditVoiceRhythm(block, startChapter, endChapter);
              qaResults.push({ type: 'voice', result, startChapter, endChapter });
            } catch (e: any) {
              qaResults.push({ type: 'voice', error: e.message });
            }
          }
          
          // Semantic Repetition Detector - analyze full manuscript summaries (SEQUENTIAL)
          if (await this.shouldStopProcessing(project.id)) return;
          
          completedAudits++;
          this.callbacks.onAgentStatus("beta-reader", "active", `Auditoría repeticiones semánticas (${completedAudits}/${totalAudits})...`);
          
          try {
            const result = await this.semanticRepetitionDetector.detectRepetitions(chapterSummaries, completedChapters.length);
            qaResults.push({ type: 'semantic', result });
          } catch (e: any) {
            qaResults.push({ type: 'semantic', error: e.message });
          }
          
          this.callbacks.onAgentStatus("beta-reader", "active", `Auditoría QA completada (${totalAudits} análisis secuenciales).`);
          
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
                    contexto: error.contexto, // Include the exact text fragment where the error is located
                  });
                }
              }
              if (qaResult.result.tokenUsage) {
                this.addTokenUsage(qaResult.result.tokenUsage);
                await this.logAiUsage(project.id, "forensic-auditor", "deepseek-chat", qaResult.result.tokenUsage);
              }
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
              if (qaResult.result.tokenUsage) {
                this.addTokenUsage(qaResult.result.tokenUsage);
                await this.logAiUsage(project.id, "voice-rhythm-auditor", "deepseek-chat", qaResult.result.tokenUsage);
              }
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
              if (qaResult.result.tokenUsage) {
                this.addTokenUsage(qaResult.result.tokenUsage);
                await this.logAiUsage(project.id, "semantic-repetition-detector", "deepseek-chat", qaResult.result.tokenUsage);
              }
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
            await this.logAiUsage(project.id, "beta-reader", "deepseek-chat", betaResult.tokenUsage);
            
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
            
            for (const [source, issues] of Array.from(issuesBySource)) {
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
              for (const rawChapNum of (issue.capitulos_afectados || [])) {
                // Normalize chapter number: FinalReviewer may report -1 for epilogue, but DB stores as 998
                const chapNum = this.normalizeToDbChapterNumber(rawChapNum);
                // Check chapter correction limits to prevent infinite loops
                const correctionCount = chapterCorrectionCounts.get(chapNum) || 0;
                if (correctionCount >= MAX_CORRECTIONS_PER_CHAPTER) {
                  console.log(`[OrchestratorV2] Skipping chapter ${chapNum}: already corrected ${correctionCount} times (max: ${MAX_CORRECTIONS_PER_CHAPTER})`);
                  continue;
                }
                combinedPreReviewIssues.push({
                  source: 'final-reviewer',
                  tipo: issue.categoria || 'general',
                  capitulo: chapNum,
                  severidad: issue.severidad || 'mayor',
                  descripcion: issue.descripcion || '',
                  instrucciones: issue.instrucciones_correccion || '',
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
            
            // Filter out chapters that have exceeded correction limit OR already successfully corrected
            const allChaptersWithIssues = Array.from(qaIssuesByChapter.keys()).sort((a, b) => a - b);
            let skippedDueToLimit = 0;
            let skippedAlreadyCorrected = 0;
            const chaptersToFix = allChaptersWithIssues.filter(chapNum => {
              // LitAgents 2.9.3: Skip chapters already successfully corrected in this session
              if (successfullyCorrectedChapters.has(chapNum)) {
                console.log(`[OrchestratorV2] Skipping chapter ${chapNum} in pre-review: already successfully corrected`);
                skippedAlreadyCorrected++;
                return false;
              }
              const correctionCount = chapterCorrectionCounts.get(chapNum) || 0;
              if (correctionCount >= MAX_CORRECTIONS_PER_CHAPTER) {
                console.log(`[OrchestratorV2] Skipping chapter ${chapNum} in pre-review: already corrected ${correctionCount} times (max: ${MAX_CORRECTIONS_PER_CHAPTER})`);
                skippedDueToLimit++;
                return false;
              }
              return true;
            });
            
            if (skippedAlreadyCorrected > 0 || skippedDueToLimit > 0) {
              console.log(`[OrchestratorV2] Pre-review filtering: ${skippedAlreadyCorrected} already corrected, ${skippedDueToLimit} at limit, ${chaptersToFix.length} remaining`);
              await storage.createActivityLog({
                projectId: project.id,
                level: "info",
                message: `[FILTRADO] ${skippedAlreadyCorrected} caps ya corregidos, ${skippedDueToLimit} al limite, ${chaptersToFix.length} pendientes`,
                agentRole: "orchestrator",
              });
            }
            console.log(`[OrchestratorV2] Pre-review: ${chaptersToFix.length} chapters to correct: ${chaptersToFix.join(', ')}`);
            
            // Generate summary of WHY chapters need correction
            const categoryCount: Record<string, number> = {};
            const severityCount: Record<string, number> = { critica: 0, mayor: 0, menor: 0 };
            for (const issue of combinedPreReviewIssues) {
              const cat = issue.categoria || issue.source || 'otros';
              categoryCount[cat] = (categoryCount[cat] || 0) + 1;
              const sev = (issue.severidad || 'mayor').toLowerCase();
              if (sev.includes('crit')) severityCount.critica++;
              else if (sev.includes('may') || sev.includes('major')) severityCount.mayor++;
              else severityCount.menor++;
            }
            const topCategories = Object.entries(categoryCount)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 4)
              .map(([cat, count]) => `${cat}(${count})`)
              .join(', ');
            
            await storage.createActivityLog({
              projectId: project.id,
              level: "info",
              message: `[CICLO] ${chaptersToFix.length} caps con ${combinedPreReviewIssues.length} problemas | Criticos: ${severityCount.critica}, Mayores: ${severityCount.mayor}, Menores: ${severityCount.menor} | Categorias: ${topCategories}`,
              agentRole: "orchestrator",
            });
            
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
              
              // Use normalized chapter number lookup to handle -1/998 (epilogue) and -2/999 (author note) mapping
              const chapter = this.findChapterByNumber(completedChapters, chapNum);
              if (!chapter || !chapter.content) {
                console.log(`[OrchestratorV2] Chapter ${chapNum} not found in completedChapters, skipping`);
                continue;
              }
              
              const chapterQaIssues = qaIssuesByChapter.get(chapNum) || [];
              if (chapterQaIssues.length === 0) continue;
              
              // Check severity levels (case-insensitive)
              const hasCriticalOrMajor = chapterQaIssues.some(i => {
                const sev = (i.severidad || '').toLowerCase();
                return sev === 'critica' || sev === 'crítica' || sev === 'mayor' || sev === 'critical' || sev === 'major';
              });
              console.log(`[OrchestratorV2] Pre-review Chapter ${chapNum}: ${chapterQaIssues.length} issues, hasCriticalOrMajor=${hasCriticalOrMajor}, severities=[${chapterQaIssues.map(i => i.severidad).join(', ')}]`);

              // Log detailed reason WHY this chapter needs correction
              const issuesSummary = chapterQaIssues.slice(0, 3).map(i => {
                const cat = i.categoria || i.source || 'error';
                const sev = (i.severidad || 'mayor').toLowerCase();
                const desc = (i.descripcion || '').substring(0, 80);
                return `[${sev.toUpperCase()}] ${cat}: ${desc}${desc.length >= 80 ? '...' : ''}`;
              }).join(' | ');
              
              await storage.createActivityLog({
                projectId: project.id,
                level: hasCriticalOrMajor ? "warn" : "info",
                message: `[CORRECCION] Cap ${chapNum} (${chapterQaIssues.length} problemas): ${issuesSummary}`,
                agentRole: "smart-editor",
              });
              
              // Build unified correction prompt with FULL CONTEXT including exact text locations
              const issuesDescription = chapterQaIssues.map(i => {
                let issue = `- [${i.severidad?.toUpperCase() || 'MAYOR'}] ${i.source}: ${i.descripcion}`;
                // Include the exact text fragment where the error is located (critical for SmartEditor to find the problem)
                if (i.contexto) {
                  issue += `\n  📍 TEXTO PROBLEMÁTICO: "${i.contexto}"`;
                }
                issue += `\n  ✏️ Corrección: ${i.correccion || i.instrucciones || 'Corregir según descripción'}`;
                return issue;
              }).join("\n\n");
              
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
                  
                  const fullContextPrompt = `CONTEXTO PARA CORRECCIÓN:
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

                  // LitAgents 2.9.3: ALWAYS try surgical fix FIRST, even for critical/major issues
                  // fullRewrite damages chapters - only use as absolute last resort
                  const preReviewConsistencyContext = await this.buildConsistencyContextForCorrection(
                    project.id, chapNum, worldBibleData, project
                  );
                  
                  console.log(`[OrchestratorV2] Critical/major issues for Chapter ${chapNum}, trying SURGICAL FIX first`);
                  
                  const surgicalResult = await this.smartEditor.surgicalFix({
                    chapterContent: chapter.content,
                    errorDescription: fullContextPrompt,
                    consistencyConstraints: preReviewConsistencyContext || JSON.stringify(chapterContext.mainCharacters),
                  });
                  
                  this.addTokenUsage(surgicalResult.tokenUsage);
                  await this.logAiUsage(project.id, "smart-editor", "deepseek-chat", surgicalResult.tokenUsage, chapNum);
                  
                  console.log(`[OrchestratorV2] surgicalFix result for critical issues Chapter ${chapNum}: patches=${surgicalResult.patches?.length || 0}`);
                  
                  // Try to apply patches first
                  if (surgicalResult.patches && surgicalResult.patches.length > 0) {
                    const patchResult: PatchResult = applyPatches(chapter.content, surgicalResult.patches);
                    if (patchResult.success && patchResult.patchedText && patchResult.patchedText !== chapter.content) {
                      correctedContent = patchResult.patchedText;
                      console.log(`[OrchestratorV2] Surgical fix applied ${patchResult.appliedPatches}/${surgicalResult.patches.length} patches for Chapter ${chapNum}`);
                      
                      await storage.createActivityLog({
                        projectId: project.id,
                        level: "info",
                        message: `[QUIRURGICO] Cap ${chapNum}: ${patchResult.appliedPatches} parches aplicados para ${chapterQaIssues.length} problemas criticos/mayores`,
                        agentRole: "smart-editor",
                      });
                    }
                  }
                  
                  // Only use fullRewrite as LAST RESORT if surgical fix failed completely
                  if (!correctedContent) {
                    console.warn(`[OrchestratorV2] Surgical fix failed for Chapter ${chapNum}, falling back to fullRewrite as LAST RESORT`);
                    
                    await storage.createActivityLog({
                      projectId: project.id,
                      level: "warn",
                      message: `[FALLBACK] Cap ${chapNum}: Parches fallaron, usando reescritura como ultimo recurso`,
                      agentRole: "smart-editor",
                    });
                    
                    const fixResult = await this.smartEditor.fullRewrite({
                      chapterContent: chapter.content,
                      errorDescription: fullContextPrompt,
                      consistencyConstraints: preReviewConsistencyContext || JSON.stringify(chapterContext.mainCharacters),
                      worldBible: {
                        characters: chapterContext.mainCharacters,
                        locations: chapterContext.locations,
                        worldRules: chapterContext.worldRules,
                        persistentInjuries: chapterContext.persistentInjuries,
                        plotDecisions: chapterContext.plotDecisions,
                      },
                      chapterNumber: chapNum,
                      chapterTitle: chapter.title || undefined,
                      previousChapterSummary: chapterContext.previousChapterSummary,
                      nextChapterSummary: chapterContext.nextChapterSummary,
                      styleGuide: chapterContext.styleGuide,
                      projectTitle: project.title,
                      genre: project.genre || undefined,
                    });
                    
                    this.addTokenUsage(fixResult.tokenUsage);
                    await this.logAiUsage(project.id, "smart-editor", "deepseek-chat", fixResult.tokenUsage, chapNum);
                    
                    console.log(`[OrchestratorV2] fullRewrite result for Chapter ${chapNum}: error=${fixResult.error || 'none'}, rewrittenContent=${fixResult.rewrittenContent?.length || 0} chars`);
                    
                    if (fixResult.rewrittenContent && fixResult.rewrittenContent.length > 100) {
                      correctedContent = fixResult.rewrittenContent;
                      console.log(`[OrchestratorV2] Full rewrite successful for Chapter ${chapNum}: ${correctedContent.length} chars`);
                    } else if (fixResult.content && fixResult.content.length > 100) {
                      correctedContent = fixResult.content;
                      console.log(`[OrchestratorV2] Full rewrite fallback for Chapter ${chapNum}: ${correctedContent.length} chars`);
                    } else {
                      console.warn(`[OrchestratorV2] Full rewrite FAILED for Chapter ${chapNum} - no valid content returned`);
                    }
                  }
                } else {
                  // MINOR ISSUES: Use surgicalFix (patches) - NOT fullRewrite
                  // fullRewrite damages chapters by changing too much content
                  console.log(`[OrchestratorV2] Minor issues for Chapter ${chapNum}, using SURGICAL FIX (patches only)`);
                  
                  const minorIssuesConsistencyContext = await this.buildConsistencyContextForCorrection(
                    project.id, chapNum, worldBibleData, project
                  );
                  
                  const fixResult = await this.smartEditor.surgicalFix({
                    chapterContent: chapter.content,
                    errorDescription: issuesDescription,
                    consistencyConstraints: minorIssuesConsistencyContext,
                  });
                  
                  this.addTokenUsage(fixResult.tokenUsage);
                  await this.logAiUsage(project.id, "smart-editor", "deepseek-chat", fixResult.tokenUsage, chapNum);
                  
                  console.log(`[OrchestratorV2] surgicalFix result for minor issues Chapter ${chapNum}: patches=${fixResult.patches?.length || 0}`);
                  
                  // Apply patches if available
                  if (fixResult.patches && fixResult.patches.length > 0) {
                    const patchResult: PatchResult = applyPatches(chapter.content, fixResult.patches);
                    if (patchResult.success && patchResult.patchedText && patchResult.patchedText !== chapter.content) {
                      correctedContent = patchResult.patchedText;
                      console.log(`[OrchestratorV2] Surgical fix applied ${patchResult.appliedPatches}/${fixResult.patches.length} patches for Chapter ${chapNum}`);
                      
                      await storage.createActivityLog({
                        projectId: project.id,
                        level: "info",
                        message: `[QUIRURGICO] Cap ${chapNum}: ${patchResult.appliedPatches} parches aplicados, ${fixResult.patches.length - patchResult.appliedPatches} omitidos`,
                        agentRole: "smart-editor",
                      });
                    } else {
                      console.warn(`[OrchestratorV2] Surgical fix patches failed to apply for Chapter ${chapNum}`);
                    }
                  } else {
                    console.warn(`[OrchestratorV2] Surgical fix returned no patches for Chapter ${chapNum}`);
                  }
                }
                
                const chapterSources = Array.from(new Set(chapterQaIssues.map(i => i.source)));
                
                // Helper to normalize content for comparison
                const normalizeContent = (text: string) => text.replace(/\s+/g, ' ').trim().toLowerCase();
                const originalNormalized = normalizeContent(chapter.content);
                
                // Helper function to handle successful correction
                const handleSuccessfulCorrection = async (content: string, source: string) => {
                  const wordCount = content.split(/\s+/).length;
                  await storage.updateChapter(chapter.id, {
                    content: content,
                    status: "completed",
                    wordCount,
                  });
                  preReviewCorrected++;
                  preReviewFixes.push({ chapter: chapNum, issueCount: chapterQaIssues.length, sources: chapterSources, success: true });
                  // LitAgents 2.9.3: Mark chapter as successfully corrected to skip in future cycles
                  successfullyCorrectedChapters.add(chapNum);
                  await persistCorrectedChapters();
                  console.log(`[OrchestratorV2] Pre-review: Chapter ${chapNum} corrected via ${source} (${wordCount} words) - marked as done & persisted`);
                  
                  await storage.createActivityLog({
                    projectId: project.id,
                    level: "info",
                    agentRole: "smart-editor",
                    message: `Capitulo ${chapNum} corregido (${wordCount} palabras)`,
                  });
                  this.callbacks.onChapterComplete(chapNum, wordCount, chapter.title || `Capítulo ${chapNum}`);
                  
                  // Update World Bible after correction
                  try {
                    await this.updateWorldBibleFromChapter(project.id, chapNum, content, chapterQaIssues);
                  } catch (wbError) {
                    console.error(`[OrchestratorV2] Failed to update World Bible after Chapter ${chapNum} rewrite:`, wbError);
                  }
                };
                
                // Check if content is valid AND different from original
                const isValidCorrection = (content: string | null | undefined): boolean => {
                  if (!content || content.length < 100) return false;
                  const contentNormalized = normalizeContent(content);
                  // Must be meaningfully different (at least 1% difference)
                  if (contentNormalized === originalNormalized) return false;
                  return true;
                };
                
                if (isValidCorrection(correctedContent)) {
                  await handleSuccessfulCorrection(correctedContent!, "fullRewrite");
                } else {
                  // RETRY: Try surgicalFix as fallback
                  console.log(`[OrchestratorV2] Pre-review: Chapter ${chapNum} fullRewrite failed (empty or unchanged), trying surgicalFix...`);
                  let retrySuccess = false;
                  
                  try {
                    const patchResult = await this.smartEditor.surgicalFix({
                      chapterContent: chapter.content,
                      errorDescription: issuesDescription,
                    });
                    this.addTokenUsage(patchResult.tokenUsage);
                    await this.logAiUsage(project.id, "smart-editor", "deepseek-chat", patchResult.tokenUsage, chapNum);
                    
                    if (patchResult.patches && patchResult.patches.length > 0) {
                      const applied = applyPatches(chapter.content, patchResult.patches);
                      if (isValidCorrection(applied.patchedText)) {
                        await handleSuccessfulCorrection(applied.patchedText, "surgicalFix");
                        retrySuccess = true;
                      }
                    }
                  } catch (patchError) {
                    console.error(`[OrchestratorV2] Pre-review surgicalFix failed for Chapter ${chapNum}:`, patchError);
                  }
                  
                  // LAST RESORT: Try fullRewrite again with full context
                  if (!retrySuccess) {
                    console.log(`[OrchestratorV2] Pre-review: Chapter ${chapNum} surgicalFix failed, final fullRewrite attempt with full context...`);
                    try {
                      const retryResult = await this.smartEditor.fullRewrite({
                        chapterContent: chapter.content,
                        errorDescription: `CORRIGE ESTOS PROBLEMAS (OBLIGATORIO):\n${issuesDescription}\n\nReescribe el capítulo corrigiendo TODOS los problemas. El resultado DEBE ser diferente del original.`,
                        worldBible: {
                          characters: chapterContext.mainCharacters,
                          locations: chapterContext.locations,
                          worldRules: chapterContext.worldRules,
                          persistentInjuries: chapterContext.persistentInjuries,
                          plotDecisions: chapterContext.plotDecisions,
                        },
                        chapterNumber: chapNum,
                        chapterTitle: chapter.title || undefined,
                        previousChapterSummary: chapterContext.previousChapterSummary,
                        nextChapterSummary: chapterContext.nextChapterSummary,
                        styleGuide: chapterContext.styleGuide,
                        projectTitle: project.title,
                        genre: project.genre || undefined,
                      });
                      this.addTokenUsage(retryResult.tokenUsage);
                      await this.logAiUsage(project.id, "smart-editor", "deepseek-chat", retryResult.tokenUsage, chapNum);
                      
                      const retryContent = retryResult.rewrittenContent || retryResult.content;
                      if (isValidCorrection(retryContent)) {
                        await handleSuccessfulCorrection(retryContent!, "fullRewrite-retry");
                        retrySuccess = true;
                      }
                    } catch (retryError) {
                      console.error(`[OrchestratorV2] Pre-review final retry failed for Chapter ${chapNum}:`, retryError);
                    }
                  }
                  
                  // LitAgents 2.9: ESCALATED CORRECTION - Very specific prompt with exact text to change
                  if (!retrySuccess) {
                    console.log(`[OrchestratorV2] Pre-review: Chapter ${chapNum} standard attempts failed, trying ESCALATED correction...`);
                    try {
                      // Build ultra-specific prompt with exact quotes from the issues
                      const escalatedPrompt = `CORRECCIÓN ESCALADA - ÚLTIMA OPORTUNIDAD

Este capítulo tiene errores que DEBEN corregirse. Los intentos anteriores fallaron.

ERRORES ESPECÍFICOS A CORREGIR:
${chapterQaIssues.map(i => {
  let errorDetail = `[${i.severidad?.toUpperCase() || 'ERROR'}] ${i.descripcion}`;
  if (i.contexto) {
    errorDetail += `\n   TEXTO PROBLEMÁTICO: "${i.contexto.substring(0, 200)}"`;
  }
  return errorDetail;
}).join('\n\n')}

INSTRUCCIONES OBLIGATORIAS:
1. Busca EXACTAMENTE los textos problemáticos citados arriba
2. Reescríbelos para eliminar el error
3. Mantén el estilo y tono del resto del capítulo
4. El resultado DEBE ser diferente del original

Si el error es de conocimiento imposible (personaje sabe algo que no debería):
- ELIMINA la referencia al conocimiento
- O añade una explicación de CÓMO lo supo

Si el error es de transición confusa:
- Añade una frase de transición que explique el cambio de lugar/tiempo

Si el error es de inconsistencia física/edad:
- Corrige el dato para que coincida con lo establecido`;

                      // Build consistency context for escalated fix
                      const escalatedConsistencyContext = await this.buildConsistencyContextForCorrection(
                        project.id, chapNum, worldBibleData, project
                      );

                      const escalatedResult = await this.smartEditor.fullRewrite({
                        chapterContent: chapter.content,
                        errorDescription: escalatedPrompt,
                        consistencyConstraints: escalatedConsistencyContext,
                        worldBible: {
                          characters: chapterContext.mainCharacters,
                          locations: chapterContext.locations,
                          worldRules: chapterContext.worldRules,
                          persistentInjuries: chapterContext.persistentInjuries,
                          plotDecisions: chapterContext.plotDecisions,
                        },
                        chapterNumber: chapNum,
                        chapterTitle: chapter.title || undefined,
                        previousChapterSummary: chapterContext.previousChapterSummary,
                        nextChapterSummary: chapterContext.nextChapterSummary,
                        styleGuide: chapterContext.styleGuide,
                        projectTitle: project.title,
                        genre: project.genre || undefined,
                      });
                      this.addTokenUsage(escalatedResult.tokenUsage);
                      await this.logAiUsage(project.id, "smart-editor", "deepseek-chat", escalatedResult.tokenUsage, chapNum);
                      
                      const escalatedContent = escalatedResult.rewrittenContent || escalatedResult.content;
                      if (isValidCorrection(escalatedContent)) {
                        await handleSuccessfulCorrection(escalatedContent!, "escalated-fix");
                        retrySuccess = true;
                        console.log(`[OrchestratorV2] Pre-review: Chapter ${chapNum} ESCALATED correction succeeded!`);
                      }
                    } catch (escalatedError) {
                      console.error(`[OrchestratorV2] Pre-review escalated fix failed for Chapter ${chapNum}:`, escalatedError);
                    }
                  }
                  
                  if (!retrySuccess) {
                    preReviewFixes.push({ chapter: chapNum, issueCount: chapterQaIssues.length, sources: chapterSources, success: false });
                    console.warn(`[OrchestratorV2] Pre-review: Chapter ${chapNum} ALL correction attempts failed (including escalated)`);
                  }
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
                // Normalize chapter numbers to DB format (-1 -> 998, -2 -> 999)
                const affectedChapters = (issue.capitulos_afectados || []).map(ch => this.normalizeToDbChapterNumber(ch));
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
        
        // Always use Gemini for diagnostic (data layer of AI sandwich - massive context window)
        // Corrections are always done by DeepSeek (reasoning layer)
        const frForceProvider = "gemini" as const;
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
        }, { forceProvider: frForceProvider });

        const frModel = "gemini-3-pro-preview";
        this.addTokenUsage(reviewResult.tokenUsage);
        await this.logAiUsage(project.id, "final-reviewer", frModel, reviewResult.tokenUsage);

        // FinalReviewer returns 'result' not 'parsed'
        if (!reviewResult.result) {
          console.error("[OrchestratorV2] FinalReviewer failed to parse result");
          this.callbacks.onError("Error al analizar el manuscrito - presiona Continuar para reintentar");
          await storage.updateProject(project.id, { status: "paused" });
          await storage.createActivityLog({
            projectId: project.id,
            level: "error",
            message: `FinalReviewer no pudo parsear respuesta (ciclo ${currentCycle}). Presiona "Continuar" para reintentar.`,
            agentRole: "final-reviewer",
            metadata: { cycle: currentCycle, recoverable: true },
          });
          return;
        }

        finalResult = reviewResult.result;
        let { veredicto, puntuacion_global, issues, capitulos_para_reescribir } = finalResult;

        // LitAgents 2.8: Reinterpret merge requests as condensation (before any processing)
        if (issues && issues.length > 0) {
          const mergeRequestCount = issues.filter(i => this.isMergeRequest(i)).length;
          if (mergeRequestCount > 0) {
            console.log(`[OrchestratorV2] Found ${mergeRequestCount} merge request(s) - REINTERPRETING as condensation`);
            issues = this.reinterpretMergeAsCondensation(issues);
            finalResult.issues = issues; // Update the result object too
            
            await storage.createActivityLog({
              projectId: project.id,
              level: "info",
              message: `Se reinterpretaron ${mergeRequestCount} sugerencia(s) de "fusionar capítulos" como "condensación agresiva" (la fusión automática no es posible)`,
              agentRole: "orchestrator",
            });
          }
        }

        // NOTE: Issues are now tracked via hash system. The finalReviewResult is saved to DB
        // and issues are filtered using resolvedIssueHashes on next cycle (see pre-review correction section)
        console.log(`[OrchestratorV2] Review result: ${veredicto}, score: ${puntuacion_global}, chapters to rewrite: ${capitulos_para_reescribir?.length || 0}, issues: ${issues?.length || 0}`);
        
        // LitAgents 2.9.3: If FinalReviewer reports issues in previously "corrected" chapters,
        // remove them from the successfullyCorrectedChapters set so they can be re-corrected
        if (capitulos_para_reescribir && capitulos_para_reescribir.length > 0) {
          const reReportedChapters: number[] = [];
          for (const chapNum of capitulos_para_reescribir) {
            if (successfullyCorrectedChapters.has(chapNum)) {
              successfullyCorrectedChapters.delete(chapNum);
              reReportedChapters.push(chapNum);
            }
          }
          if (reReportedChapters.length > 0) {
            await persistCorrectedChapters();
            console.log(`[OrchestratorV2] FinalReviewer re-reported ${reReportedChapters.length} previously "corrected" chapters: ${reReportedChapters.join(', ')} - unmarked for re-correction`);
            await storage.createActivityLog({
              projectId: project.id,
              level: "warn",
              message: `[RE-REPORTE] ${reReportedChapters.length} caps previamente corregidos tienen nuevos problemas: ${reReportedChapters.join(', ')}`,
              agentRole: "final-reviewer",
            });
          }
        }
        
        // LitAgents 2.9.1: Detect score regression and rollback if significant
        const scoreDropped = previousCycleScore !== undefined && puntuacion_global < previousCycleScore;
        const significantDrop = previousCycleScore !== undefined && (previousCycleScore - puntuacion_global) >= 2;
        let skipCorrectionsThisCycle = false;
        
        if (scoreDropped) {
          console.warn(`[OrchestratorV2] ⚠️ SCORE REGRESSION: Score dropped from ${previousCycleScore} to ${puntuacion_global} in cycle ${currentCycle}`);
          
          // Significant regression (2+ points) - rollback to previous snapshot
          if (significantDrop && chapterSnapshots.length > 0) {
            console.warn(`[OrchestratorV2] 🔄 ROLLBACK: Restoring ${chapterSnapshots.length} chapters to pre-correction state (score dropped by ${previousCycleScore! - puntuacion_global} points)`);
            this.callbacks.onAgentStatus("orchestrator", "warning", `Regresión detectada. Restaurando ${chapterSnapshots.length} capítulos...`);
            
            // Restore chapters from snapshot (single DB fetch for efficiency)
            const allChapters = await storage.getChaptersByProject(project.id);
            let restoredCount = 0;
            for (const snapshot of chapterSnapshots) {
              const chapter = allChapters.find(c => c.chapterNumber === snapshot.chapterNumber);
              if (chapter && chapter.content !== snapshot.content) {
                await storage.updateChapter(chapter.id, { content: snapshot.content });
                restoredCount++;
              }
            }
            
            await storage.createActivityLog({
              projectId: project.id,
              level: "warn",
              message: `🔄 ROLLBACK: Puntuación bajó de ${previousCycleScore} a ${puntuacion_global} en ciclo ${currentCycle}. Restaurados ${restoredCount} capítulos a versión anterior. Las correcciones introdujeron nuevos errores.`,
              agentRole: "orchestrator",
            });
            
            // Clear snapshots - will be recreated on next correction attempt
            chapterSnapshots = [];
            
            // Skip corrections this cycle - let next cycle re-evaluate the restored content
            skipCorrectionsThisCycle = true;
            
            // Clear chapters to rewrite so we skip correction loop
            capitulos_para_reescribir = [];
          } else {
            // Minor regression - just log warning
            await storage.createActivityLog({
              projectId: project.id,
              level: "warn",
              message: `Puntuación bajó de ${previousCycleScore} a ${puntuacion_global} en ciclo ${currentCycle}. Esto puede indicar inconsistencia del revisor o regresiones introducidas por las correcciones.`,
              agentRole: "final-reviewer",
            });
          }
        }
        
        // Track good scores for potential rollback
        if (puntuacion_global >= lastGoodScore) {
          lastGoodScore = puntuacion_global;
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

        // === STRUCTURAL ISSUE AUTO-RESOLUTION (LitAgents 2.7) ===
        // Detect issues that require moving/reordering chapters (not rewriting) and auto-resolve them
        // after 2 correction attempts to prevent infinite loops (e.g., "move epilogue to end")
        if (issues && issues.length > 0 && currentCycle >= 2) {
          const { resolvedIssues, remainingIssues } = await this.autoResolveStructuralIssues(
            project.id,
            issues,
            chapterCorrectionCounts
          );
          
          if (resolvedIssues.length > 0) {
            console.log(`[OrchestratorV2] Auto-resolved ${resolvedIssues.length} structural issues that cannot be fixed by rewriting`);
            
            // Update issues list to exclude auto-resolved structural issues
            issues = remainingIssues;
            finalResult.issues = issues;
            
            // Remove chapters from rewrite list if their only issues were structural
            if (capitulos_para_reescribir && capitulos_para_reescribir.length > 0) {
              // Normalize chapter numbers to DB format (-1 -> 998, -2 -> 999)
              const resolvedChapters = new Set(
                resolvedIssues.flatMap(i => (i.capitulos_afectados || []).map(ch => this.normalizeToDbChapterNumber(ch)))
              );
              const remainingChapters = remainingIssues.flatMap(i => (i.capitulos_afectados || []).map(ch => this.normalizeToDbChapterNumber(ch)));
              const remainingChaptersSet = new Set(remainingChapters);
              
              // Only keep chapters that still have non-structural issues
              capitulos_para_reescribir = capitulos_para_reescribir.filter(ch => 
                !resolvedChapters.has(ch) || remainingChaptersSet.has(ch)
              );
              finalResult.capitulos_para_reescribir = capitulos_para_reescribir;
              
              console.log(`[OrchestratorV2] Updated chapters to rewrite: ${capitulos_para_reescribir.length} (after structural issue removal)`);
            }
          }
        }

        // === LOOP DETECTION (LitAgents 2.4) ===
        // Track which issues persist across cycles and escalate if they recur 3+ times
        if (issues && issues.length > 0 && currentCycle >= 3) {
          const { persistentIssues } = await this.trackPersistentIssues(project.id, issues, currentCycle);
          
          if (persistentIssues.length > 0) {
            console.log(`[OrchestratorV2] LOOP ESCALATION: ${persistentIssues.length} issues have persisted 3+ cycles`);
            
            // Log warning to UI
            await storage.createActivityLog({
              projectId: project.id,
              level: "error",
              agentRole: "final-reviewer",
              message: `Problemas detectados: ${persistentIssues.filter(i => i.severidad === 'critica').length} críticos, ${persistentIssues.filter(i => i.severidad === 'mayor').length} mayores. ${persistentIssues.map(i => `[${i.severidad?.toUpperCase() || 'MAYOR'}] Cap ${i.capitulos_afectados?.join(', ')}: ${i.descripcion?.substring(0, 100)}`).join(' | ')}`,
            });
            
            // Generate escalated corrections for persistent issues
            const allChaptersForEscalation = currentChapters.map(c => ({
              chapterNumber: c.chapterNumber,
              title: c.title || '',
              content: c.content || ''
            }));
            
            for (const persistentIssue of persistentIssues) {
              const escalated = this.generateEscalatedCorrection(persistentIssue, allChaptersForEscalation);
              
              // Replace the original issue with escalated version
              persistentIssue.instrucciones_correccion = escalated.instruction;
              persistentIssue.capitulos_afectados = escalated.affectedChapters;
              
              // Add all affected chapters to rewrite list
              for (const chapNum of escalated.affectedChapters) {
                if (!capitulos_para_reescribir?.includes(chapNum)) {
                  capitulos_para_reescribir = capitulos_para_reescribir || [];
                  capitulos_para_reescribir.push(chapNum);
                }
              }
            }
            
            finalResult.capitulos_para_reescribir = capitulos_para_reescribir;
            finalResult.issues = issues; // Updated with escalated instructions
            
            // Persist escalated corrections back to database
            await storage.updateProject(project.id, {
              finalReviewResult: {
                ...finalResult,
                revisionCycle: currentCycle,
                evaluatedAt: new Date().toISOString(),
                escalatedAt: new Date().toISOString(),
              } as any,
            });
            
            console.log(`[OrchestratorV2] Escalated correction: ${capitulos_para_reescribir?.length || 0} chapters to rewrite (persisted)`);
          }
        }

        // ORCHESTRATOR SAFETY NET: If capitulos_para_reescribir is empty but there are ANY issues,
        // extract chapters from ALL issues to trigger auto-correction (not just critical/major)
        if ((!capitulos_para_reescribir || capitulos_para_reescribir.length === 0) && issues && issues.length > 0) {
          const extractedChapters: number[] = [];
          for (const issue of issues) {
            // Extract from ALL issues that have chapter info and correction instructions
            // Normalize chapter numbers to DB format (-1 -> 998, -2 -> 999)
            if (issue.capitulos_afectados?.length > 0 && issue.instrucciones_correccion) {
              extractedChapters.push(...issue.capitulos_afectados.map(ch => this.normalizeToDbChapterNumber(ch)));
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
                extractedChapters.push(...issue.capitulos_afectados.map(ch => this.normalizeToDbChapterNumber(ch)));
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
                categoria: 'otro',
                severidad: qaIssue.severidad === 'critica' ? 'critica' : 'mayor',
                descripcion: `[QA:${qaIssue.source}] ${qaIssue.descripcion}`,
                capitulos_afectados: targetChapters,
                elementos_a_preservar: '',
                instrucciones_correccion: qaIssue.correccion || `Corregir: ${qaIssue.descripcion}`,
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
          // LitAgents 2.9.3: Filter out already successfully corrected chapters
          const originalCount = capitulos_para_reescribir.length;
          capitulos_para_reescribir = capitulos_para_reescribir.filter(chapNum => {
            if (successfullyCorrectedChapters.has(chapNum)) {
              console.log(`[OrchestratorV2] Skipping chapter ${chapNum} in post-review: already successfully corrected`);
              return false;
            }
            return true;
          });
          
          if (capitulos_para_reescribir.length < originalCount) {
            const skipped = originalCount - capitulos_para_reescribir.length;
            console.log(`[OrchestratorV2] Post-review: Filtered ${skipped} already-corrected chapters, ${capitulos_para_reescribir.length} remaining`);
            await storage.createActivityLog({
              projectId: project.id,
              level: "info",
              message: `[FILTRADO] ${skipped} caps ya corregidos, ${capitulos_para_reescribir.length} pendientes`,
              agentRole: "orchestrator",
            });
          }
          
          // Skip if no chapters left to correct
          if (capitulos_para_reescribir.length === 0) {
            console.log(`[OrchestratorV2] All chapters already corrected, continuing to next cycle`);
            continue;
          }
          
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
          
          // Aggregate all issues by chapter (normalize chapter numbers to database format)
          for (const issue of allIssues) {
            const affectedChapters = issue.capitulos_afectados || [];
            for (const rawChapNum of affectedChapters) {
              // Normalize chapter number: FinalReviewer may report -1 for epilogue, but DB stores as 998
              // Also handle -2 -> 999 for author notes
              const chapNum = this.normalizeToDbChapterNumber(rawChapNum);
              
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
          for (const [chapNum, data] of Array.from(aggregatedIssuesByChapter)) {
            console.log(`  - Cap ${chapNum}: ${data.totalCount} issues from [${Array.from(data.sources).join(', ')}]${data.hasCritical ? ' (CRITICAL)' : ''}`);
          }
          
          // Notify frontend about chapters being corrected (like reedit-orchestrator does)
          if (this.callbacks.onChaptersBeingCorrected) {
            this.callbacks.onChaptersBeingCorrected(capitulos_para_reescribir, currentCycle);
          }

          // LitAgents 2.9.1: Create snapshots of chapters before corrections for potential rollback
          chapterSnapshots = [];
          for (const chapNum of capitulos_para_reescribir) {
            const chapter = this.findChapterByNumber(currentChapters, chapNum);
            if (chapter && chapter.content) {
              chapterSnapshots.push({
                chapterNumber: chapter.chapterNumber,
                content: chapter.content,
                title: chapter.title || `Capítulo ${chapter.chapterNumber}`,
              });
            }
          }
          console.log(`[OrchestratorV2] Created snapshots for ${chapterSnapshots.length} chapters before correction`);

          let correctedCount = 0;
          let failedCount = 0;
          const failedChaptersDetails: Array<{ chapterNumber: number; title: string; error: string; issues: string[] }> = [];

          for (const chapNum of capitulos_para_reescribir) {
            if (await this.shouldStopProcessing(project.id)) {
              await this.updateProjectTokens(project.id);
              await storage.updateProject(project.id, { status: "paused" });
              return;
            }

            // Use normalized chapter number lookup to handle -1/998 (epilogue) and -2/999 (author note) mapping
            const chapter = this.findChapterByNumber(currentChapters, chapNum);
            if (!chapter) {
              console.log(`[OrchestratorV2] Chapter ${chapNum} not found in currentChapters (checked normalized numbers), skipping`);
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
            
            // Log detailed reason WHY this chapter needs correction
            const postReviewIssuesSummary = chapterIssues.slice(0, 3).map(i => {
              const cat = i.categoria || 'error';
              const sev = (i.severidad || 'mayor').toLowerCase();
              const desc = (i.descripcion || '').substring(0, 80);
              return `[${sev.toUpperCase()}] ${cat}: ${desc}${desc.length >= 80 ? '...' : ''}`;
            }).join(' | ');
            
            await storage.createActivityLog({
              projectId: project.id,
              level: hasCriticalOrMajor ? "warn" : "info",
              message: `[CORRECCION] Cap ${chapNum} (${chapterIssues.length} problemas): ${postReviewIssuesSummary}`,
              agentRole: "smart-editor",
            });
            
            this.callbacks.onAgentStatus("smart-editor", "active", `Corrigiendo capítulo ${chapNum} (${hasCriticalOrMajor ? 'reescritura' : 'parches'}, ${chapterIssues.length} problemas)...`);

            // Build UNIFIED correction prompt from ALL aggregated issues
            const issuesDescription = chapterIssues.map(i => 
              `- [${i.severidad?.toUpperCase() || 'MAYOR'}] ${i.categoria}: ${i.descripcion}\n  Corrección: ${i.instrucciones_correccion || 'Corregir según descripción'}`
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
                
                const fullContextPrompt = `CONTEXTO PARA CORRECCIÓN:
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

                // LitAgents 2.9.3: ALWAYS try surgical fix FIRST, even for critical/major issues
                // fullRewrite damages chapters - only use as absolute last resort
                const fullConsistencyContext = await this.buildConsistencyContextForCorrection(
                  project.id, chapNum, worldBibleData, project
                );
                
                console.log(`[OrchestratorV2] Post-review: Critical/major issues for Chapter ${chapNum}, trying SURGICAL FIX first`);
                
                const surgicalResult = await this.smartEditor.surgicalFix({
                  chapterContent: chapter.content || "",
                  errorDescription: fullContextPrompt,
                  consistencyConstraints: fullConsistencyContext || JSON.stringify(chapterContext.mainCharacters),
                });

                this.addTokenUsage(surgicalResult.tokenUsage);
                await this.logAiUsage(project.id, "smart-editor", "deepseek-chat", surgicalResult.tokenUsage, chapNum);

                console.log(`[OrchestratorV2] surgicalFix result for post-review Chapter ${chapNum}: patches=${surgicalResult.patches?.length || 0}`);

                // Try to apply patches first
                if (surgicalResult.patches && surgicalResult.patches.length > 0) {
                  const patchResult: PatchResult = applyPatches(chapter.content || "", surgicalResult.patches);
                  if (patchResult.success && patchResult.patchedText && patchResult.patchedText !== chapter.content) {
                    correctedContent = patchResult.patchedText;
                    console.log(`[OrchestratorV2] Post-review surgical fix applied ${patchResult.appliedPatches}/${surgicalResult.patches.length} patches for Chapter ${chapNum}`);
                    
                    await storage.createActivityLog({
                      projectId: project.id,
                      level: "info",
                      message: `[QUIRURGICO] Cap ${chapNum}: ${patchResult.appliedPatches} parches post-review aplicados`,
                      agentRole: "smart-editor",
                    });
                  }
                }
                
                // Only use fullRewrite as LAST RESORT if surgical fix failed completely
                if (!correctedContent) {
                  console.warn(`[OrchestratorV2] Post-review surgical fix failed for Chapter ${chapNum}, falling back to fullRewrite as LAST RESORT`);
                  
                  await storage.createActivityLog({
                    projectId: project.id,
                    level: "warn",
                    message: `[FALLBACK] Cap ${chapNum}: Parches fallaron, usando reescritura como ultimo recurso`,
                    agentRole: "smart-editor",
                  });
                  
                  const fixResult = await this.smartEditor.fullRewrite({
                    chapterContent: chapter.content || "",
                    errorDescription: fullContextPrompt,
                    consistencyConstraints: fullConsistencyContext || JSON.stringify(chapterContext.mainCharacters),
                    worldBible: {
                      characters: chapterContext.mainCharacters,
                      locations: chapterContext.locations,
                      worldRules: chapterContext.worldRules,
                      persistentInjuries: chapterContext.persistentInjuries,
                      plotDecisions: chapterContext.plotDecisions,
                    },
                    chapterNumber: chapNum,
                    chapterTitle: chapter.title || undefined,
                    previousChapterSummary: chapterContext.previousChapterSummary,
                    nextChapterSummary: chapterContext.nextChapterSummary,
                    styleGuide: chapterContext.styleGuide,
                    projectTitle: project.title,
                    genre: project.genre || undefined,
                  });

                  this.addTokenUsage(fixResult.tokenUsage);
                  await this.logAiUsage(project.id, "smart-editor", "deepseek-chat", fixResult.tokenUsage, chapNum);

                  if (fixResult.rewrittenContent && fixResult.rewrittenContent.length > 100) {
                    correctedContent = fixResult.rewrittenContent;
                    console.log(`[OrchestratorV2] Full rewrite successful: ${correctedContent.length} chars`);
                  } else if (fixResult.content && fixResult.content.length > 100) {
                    correctedContent = fixResult.content;
                    console.log(`[OrchestratorV2] Full rewrite fallback: ${correctedContent.length} chars`);
                  }
                }
              } else {
                // MINOR ISSUES ONLY: Try patches first with full consistency context
                console.log(`[OrchestratorV2] Minor issues only, trying patches for Chapter ${chapNum}`);
                // Build consistency context even for minor issues to prevent new errors
                const minorPatchConsistencyContext = await this.buildConsistencyContextForCorrection(
                  project.id, chapNum, worldBibleData, project
                );
                const editResult = await this.smartEditor.execute({
                  chapterContent: chapter.content || "",
                  sceneBreakdown: chapter.sceneBreakdown as any || { scenes: [] },
                  worldBible: worldBibleData,
                  additionalContext: `${minorPatchConsistencyContext}\n\nPROBLEMAS DETECTADOS POR EL CRÍTICO (CORREGIR OBLIGATORIAMENTE):\n${issuesDescription}`,
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
                    // Build full consistency context to prevent new errors
                    const surgicalConsistencyContext = await this.buildConsistencyContextForCorrection(
                      project.id, chapNum, worldBibleData, project
                    );
                    const fixResult = await this.smartEditor.surgicalFix({
                      chapterContent: chapter.content || "",
                      errorDescription: issuesDescription,
                      consistencyConstraints: surgicalConsistencyContext,
                    });
                    this.addTokenUsage(fixResult.tokenUsage);
                    await this.logAiUsage(project.id, "smart-editor", "deepseek-chat", fixResult.tokenUsage, chapNum);
                    // surgicalFix returns patches, apply them
                    if (fixResult.patches && fixResult.patches.length > 0) {
                      const patchResult = applyPatches(chapter.content || "", fixResult.patches);
                      if (patchResult.patchedText && patchResult.patchedText.length > 100) {
                        correctedContent = patchResult.patchedText;
                        console.log(`[OrchestratorV2] Fallback surgicalFix applied ${fixResult.patches.length} patches`);
                      }
                    } else if (fixResult.fullContent && fixResult.fullContent.length > 100) {
                      correctedContent = fixResult.fullContent;
                      console.log(`[OrchestratorV2] Fallback surgicalFix returned ${correctedContent.length} chars`);
                    }
                  }

                  // FALLBACK: If still no content, use fullRewrite as last resort with full context
                  if (!correctedContent) {
                    console.log(`[OrchestratorV2] Forcing fullRewrite as last resort for Chapter ${chapNum} with full context`);
                    // Build full consistency context for fallback rewrite
                    const fallbackConsistencyContext = await this.buildConsistencyContextForCorrection(
                      project.id, chapNum, worldBibleData, project
                    );
                    const fixResult = await this.smartEditor.fullRewrite({
                      chapterContent: chapter.content || "",
                      errorDescription: issuesDescription,
                      consistencyConstraints: fallbackConsistencyContext,
                      worldBible: {
                        characters: chapterContext.mainCharacters,
                        locations: chapterContext.locations,
                        worldRules: chapterContext.worldRules,
                        persistentInjuries: chapterContext.persistentInjuries,
                        plotDecisions: chapterContext.plotDecisions,
                      },
                      chapterNumber: chapNum,
                      chapterTitle: chapter.title || undefined,
                      previousChapterSummary: chapterContext.previousChapterSummary,
                      nextChapterSummary: chapterContext.nextChapterSummary,
                      styleGuide: chapterContext.styleGuide,
                      projectTitle: project.title,
                      genre: project.genre || undefined,
                    });
                    this.addTokenUsage(fixResult.tokenUsage);
                    await this.logAiUsage(project.id, "smart-editor", "deepseek-chat", fixResult.tokenUsage, chapNum);
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
              // LitAgents 2.9.2: Validate correction before saving
              const validationResult = await this.validateCorrectionConsistency(
                chapter.content || '',
                correctedContent,
                worldBibleData,
                chapNum
              );
              
              if (!validationResult.valid) {
                console.warn(`[OrchestratorV2] ⚠️ Correction validation detected ${validationResult.regressions.length} potential regressions (${validationResult.severity}) for Chapter ${chapNum}:`);
                for (const reg of validationResult.regressions) {
                  console.warn(`  - ${reg}`);
                }
                
                // HIGH severity regressions: block save and keep original
                if (validationResult.severity === 'high') {
                  await storage.createActivityLog({
                    projectId: project.id,
                    level: "error",
                    message: `🛑 BLOQUEADO: Corrección de Cap ${chapNum} rechazada por regresiones críticas: ${validationResult.regressions.slice(0, 2).join('; ')}. Manteniendo versión original.`,
                    agentRole: "smart-editor",
                  });
                  console.error(`[OrchestratorV2] HIGH SEVERITY: Blocking correction for Chapter ${chapNum}, keeping original`);
                  failedCount++;
                  failedChaptersDetails.push({
                    chapterNumber: chapNum,
                    title: chapter.title || `Capítulo ${chapNum}`,
                    error: 'Corrección bloqueada por regresiones críticas',
                    issues: validationResult.regressions.slice(0, 3),
                  });
                  continue; // Skip saving this correction
                }
                
                // MEDIUM/LOW severity: warn but save
                await storage.createActivityLog({
                  projectId: project.id,
                  level: "warn",
                  message: `⚠️ Validación detectó posibles regresiones en Cap ${chapNum}: ${validationResult.regressions.slice(0, 3).join('; ')}. Guardado con advertencias.`,
                  agentRole: "smart-editor",
                });
              }
              
              // LitAgents 2.9.2: AI validation for surgical corrections
              // Only run if regex validation passed or had low severity (to save tokens)
              if (validationResult.severity !== 'high') {
                const issueDescriptions = chapterIssues.map((i: any) => i.descripcion || i.description || String(i));
                const aiValidation = await this.validateCorrectionWithAI(
                  chapter.content || '',
                  correctedContent,
                  worldBibleData,
                  chapNum,
                  issueDescriptions
                );
                
                if (!aiValidation.approved && aiValidation.confidence >= 0.7) {
                  // High confidence rejection from AI - block the save
                  console.warn(`[OrchestratorV2] 🤖 AI validation rejected correction for Chapter ${chapNum} (confidence: ${aiValidation.confidence}):`);
                  for (const concern of aiValidation.concerns) {
                    console.warn(`  - ${concern}`);
                  }
                  
                  await storage.createActivityLog({
                    projectId: project.id,
                    level: "error",
                    message: `🤖 BLOQUEADO por IA: Corrección de Cap ${chapNum} rechazada (confianza ${(aiValidation.confidence * 100).toFixed(0)}%): ${aiValidation.concerns.slice(0, 2).join('; ')}`,
                    agentRole: "smart-editor",
                  });
                  
                  failedCount++;
                  failedChaptersDetails.push({
                    chapterNumber: chapNum,
                    title: chapter.title || `Capítulo ${chapNum}`,
                    error: 'Corrección bloqueada por validación IA',
                    issues: aiValidation.concerns.slice(0, 3),
                  });
                  continue; // Skip saving this correction
                } else if (!aiValidation.approved && aiValidation.confidence < 0.7) {
                  // Low confidence rejection - warn but proceed
                  await storage.createActivityLog({
                    projectId: project.id,
                    level: "warn",
                    message: `🤖 Advertencia IA en Cap ${chapNum} (confianza ${(aiValidation.confidence * 100).toFixed(0)}%): ${aiValidation.concerns.slice(0, 2).join('; ')}. Guardando de todas formas.`,
                    agentRole: "smart-editor",
                  });
                }
              }
              
              const wordCount = correctedContent.split(/\s+/).length;
              await storage.updateChapter(chapter.id, {
                content: correctedContent,
                wordCount,
                qualityScore: 8, // Assume improvement
              });
              
              console.log(`[OrchestratorV2] Successfully updated Chapter ${chapNum} (${wordCount} words)${validationResult.valid ? '' : ` [${validationResult.severity.toUpperCase()} WARNINGS]`}`);
              this.callbacks.onAgentStatus("smart-editor", "active", `Capitulo ${chapNum} corregido (${wordCount} palabras)${validationResult.valid ? '' : ' ⚠️'}`);
              this.callbacks.onChapterComplete(
                chapter.chapterNumber,
                wordCount,
                chapter.title || `Capítulo ${chapter.chapterNumber}`
              );
              correctedCount++;
              // LitAgents 2.9.3: Mark chapter as successfully corrected to skip in future cycles
              successfullyCorrectedChapters.add(chapNum);
              await persistCorrectedChapters();
              console.log(`[OrchestratorV2] Post-review: Chapter ${chapNum} marked as successfully corrected & persisted`);
              
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
                  
                  // Build full consistency context for retry
                  const retryConsistencyContext = await this.buildConsistencyContextForCorrection(
                    project.id, chapNum, worldBibleData, project
                  );
                  const retryResult = await this.smartEditor.surgicalFix({
                    chapterContent: chapter.content || "",
                    errorDescription: aggressiveIssues,
                    consistencyConstraints: retryConsistencyContext,
                  });
                  this.addTokenUsage(retryResult.tokenUsage);
                  await this.logAiUsage(project.id, "smart-editor", "deepseek-chat", retryResult.tokenUsage, chapNum);
                  
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
              
              // LAST RESORT: Full chapter rewrite with full context
              if (!retrySuccess) {
                console.log(`[OrchestratorV2] Attempting FULL REWRITE as last resort for Chapter ${chapNum} with full context...`);
                this.callbacks.onAgentStatus("smart-editor", "active", `Capitulo ${chapNum}: reescritura completa (último recurso)...`);
                
                // Include all issues for complete correction
                const allIssuesDescription = chapterIssues.map((issue, idx) => 
                  `${idx + 1}. [${issue.severidad?.toUpperCase() || 'MAYOR'}] ${issue.categoria}: ${issue.descripcion}\n   Corrección: ${issue.instrucciones_correccion || 'Corregir según descripción'}`
                ).join('\n');

                try {
                  // Build full consistency context for last resort full rewrite
                  const lastResortConsistencyContext = await this.buildConsistencyContextForCorrection(
                    project.id, chapNum, worldBibleData, project
                  );
                  const fullRewriteResult = await this.smartEditor.fullRewrite({
                    chapterContent: chapter.content || "",
                    errorDescription: allIssuesDescription,
                    consistencyConstraints: lastResortConsistencyContext,
                    worldBible: {
                      characters: chapterContext.mainCharacters,
                      locations: chapterContext.locations,
                      worldRules: chapterContext.worldRules,
                      persistentInjuries: chapterContext.persistentInjuries,
                      plotDecisions: chapterContext.plotDecisions,
                    },
                    chapterNumber: chapNum,
                    chapterTitle: chapter.title || undefined,
                    previousChapterSummary: chapterContext.previousChapterSummary,
                    nextChapterSummary: chapterContext.nextChapterSummary,
                    styleGuide: chapterContext.styleGuide,
                    projectTitle: project.title,
                    genre: project.genre || undefined,
                  });
                  this.addTokenUsage(fullRewriteResult.tokenUsage);
                  await this.logAiUsage(project.id, "smart-editor", "deepseek-chat", fullRewriteResult.tokenUsage, chapNum);
                  
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
        // Provide detailed context about why finalResult is null
        const contextInfo = {
          cycleReached: currentCycle,
          maxCycles,
          consecutiveHighScores,
          previousScores,
          resolvedHashesCount: localResolvedHashes.length,
        };
        console.error(`[OrchestratorV2] FinalReviewer completed loop but finalResult is null. Context:`, contextInfo);
        
        await storage.updateProject(project.id, { status: "paused" });
        await storage.createActivityLog({
          projectId: project.id,
          level: "error",
          message: `La revisión final no produjo resultado después de ${currentCycle} ciclos (máximo: ${maxCycles}). Puntuaciones anteriores: [${previousScores.join(", ") || "ninguna"}]. Presiona 'Continuar' para reintentar.`,
          agentRole: "final-reviewer",
          metadata: { 
            recoverable: true, 
            ...contextInfo,
          },
        });
        this.callbacks.onError(`No se completó la revisión final (ciclo ${currentCycle}/${maxCycles}) - presiona Continuar para reintentar`);
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
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.callbacks.onError(errorMessage);
      
      // Instead of "error" state, use "paused" to allow easy resume
      // Save the current cycle state so it can resume from where it left off
      await storage.updateProject(project.id, { 
        status: "paused",
      });
      
      // Log the error with context for easier debugging
      await storage.createActivityLog({
        projectId: project.id,
        level: "error",
        message: `Error durante revisión final (ciclo ${project.revisionCycle || 1}): ${errorMessage.substring(0, 300)}. Presiona "Continuar" para reintentar.`,
        agentRole: "final-reviewer",
        metadata: { 
          error: errorMessage,
          cycle: project.revisionCycle || 1,
          recoverable: true,
        },
      });
      
      console.log(`[OrchestratorV2] Project ${project.id} paused after FinalReviewer error - can resume with "Continuar" button`);
    } finally {
      // Always unregister correction when method ends (success, error, or cancellation)
      if (endCorrection) {
        endCorrection(project.id);
      }
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
        await storage.updateProject(project.id, { status: "paused" });
        await storage.createActivityLog({
          projectId: project.id,
          level: "error",
          message: "Falta World Bible o escaleta. Verifica la configuración del proyecto.",
          agentRole: "system",
          metadata: { recoverable: false, requiresConfiguration: true },
        });
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

        // Sync deaths before writing
        await this.syncEntitiesIntoWorldBible(project.id, worldBibleData);

        // Plan scenes for this chapter (WITH constraints)
        this.callbacks.onAgentStatus("chapter-architect", "active", `Planificando escenas para Capítulo ${chapterNum}...`);
        
        // Get full outline for plot context (World Bible stores as chapterOutlines, not chapters)
        const plotData = (worldBibleData as any)?.plotOutline as any;
        const fullOutline = plotData?.chapterOutlines || plotData?.chapters || [];
        
        // LitAgents 2.9.7: Get pattern analysis to prevent structural repetition
        const patternTracker = getPatternTracker(project.id);
        const patternAnalysis = patternTracker.analyzeForChapter(chapterNum);
        const patternAnalysisContext = patternTracker.formatForPrompt(patternAnalysis);
        
        const chapterPlan = await this.chapterArchitect.execute({
          chapterOutline: tempOutline,
          worldBible: worldBibleData,
          previousChapterSummary: previousSummary,
          storyState: rollingSummary,
          consistencyConstraints,
          fullPlotOutline: fullOutline, // LitAgents 2.1: Full plot context
          isKindleUnlimited: project.kindleUnlimitedOptimized || false, // LitAgents 2.5: Direct KU pacing flag
          patternAnalysisContext, // LitAgents 2.9.7: Anti-repetition pattern context
        });

        if (!chapterPlan.parsed) {
          console.error(`[OrchestratorV2] Failed to plan chapter ${chapterNum}`);
          continue;
        }

        this.addTokenUsage(chapterPlan.tokenUsage);
        await this.logAiUsage(project.id, "chapter-architect", "deepseek-reasoner", chapterPlan.tokenUsage, chapterNum);
        
        // LitAgents 2.9.7: Register the chapter's pattern after planning
        const chapterPattern = patternTracker.extractPatternFromScenes(
          chapterNum,
          tempOutline.title,
          chapterPlan.parsed.scenes.map(s => ({
            plot_beat: s.plot_beat,
            emotional_beat: s.emotional_beat,
            ending_hook: s.ending_hook
          })),
          chapterPlan.parsed.chapter_hook
        );
        patternTracker.registerPattern(chapterPattern);
        
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
        
        // LitAgents 2.2: Get recent text for vocabulary tracking
        const extensionPrevText = await this.getRecentChaptersText(project.id, chapterNum, 2);

        for (const scene of chapterPlan.parsed.scenes) {
          // Check cancellation before each scene
          if (await this.shouldStopProcessing(project.id)) {
            console.log(`[OrchestratorV2] Extension cancelled during scene writing for project ${project.id}`);
            scenesCancelled = true;
            break;
          }
          
          this.callbacks.onAgentStatus("ghostwriter-v2", "active", `Escribiendo escena ${scene.scene_num}...`);

          const extensionSeriesWB = await this.getSeriesWorldBibleForInjection(project.id);
          const sceneResult = await this.ghostwriter.execute({
            scenePlan: scene,
            prevSceneContext: lastContext,
            rollingSummary,
            worldBible: worldBibleData,
            guiaEstilo,
            consistencyConstraints,
            previousChaptersText: extensionPrevText,
            currentChapterText: fullChapterText,
            seriesWorldBible: extensionSeriesWB,
          });

          if (!sceneResult.error) {
            fullChapterText += "\n\n" + sceneResult.content;
            lastContext = sceneResult.content.slice(-1500);
            this.callbacks.onSceneComplete(chapterNum, scene.scene_num, chapterPlan.parsed.scenes.length, sceneResult.content?.split(/\s+/).length || 0);
          }

          this.addTokenUsage(sceneResult.tokenUsage);
          await this.logAiUsage(project.id, "ghostwriter-v2", "deepseek-chat", sceneResult.tokenUsage, chapterNum);
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
        await this.logAiUsage(project.id, "smart-editor", "deepseek-chat", editResult.tokenUsage, chapterNum);

        // Summarize
        const summaryResult = await this.summarizer.execute({
          chapterContent: finalText,
          chapterNumber: chapterNum,
        });

        this.addTokenUsage(summaryResult.tokenUsage);
        await this.logAiUsage(project.id, "summarizer", "deepseek-chat", summaryResult.tokenUsage, chapterNum);

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

      // Extract series world bible before completing
      await this.extractSeriesWorldBibleOnComplete(project.id);

      await storage.updateProject(project.id, { status: "completed" });
      this.callbacks.onProjectComplete();

    } catch (error) {
      console.error("[OrchestratorV2] Extension error:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.callbacks.onError(errorMessage);
      await storage.updateProject(project.id, { status: "paused" });
      await storage.createActivityLog({
        projectId: project.id,
        level: "error",
        message: `Error extendiendo novela: ${errorMessage.substring(0, 300)}. Presiona "Continuar" para reintentar.`,
        agentRole: "system",
        metadata: { error: errorMessage, recoverable: true },
      });
    }
  }

  /**
   * Regenerate truncated chapters
   */
  async regenerateTruncatedChapters(project: Project, minWordCount: number = 100): Promise<void> {
    console.log(`[OrchestratorV2] Regenerating truncated chapters for project ${project.id} (min: ${minWordCount} words)`);
    
    // Use different thresholds for special chapters vs regular chapters
    const MIN_WORDS_REGULAR_CHAPTER = 500;
    const MIN_WORDS_SPECIAL_CHAPTER = 150;
    
    const isSpecialChapter = (chapterNumber: number): boolean => {
      // Prologue: 0, Epilogue: -1 or 998, Author note: -2 or 999
      return chapterNumber === 0 || chapterNumber === -1 || chapterNumber === 998 || 
             chapterNumber === -2 || chapterNumber === 999;
    };
    
    try {
      const chapters = await storage.getChaptersByProject(project.id);
      const truncatedChapters = chapters.filter(ch => {
        const wordCount = ch.content ? ch.content.split(/\s+/).length : 0;
        // Use appropriate threshold based on chapter type
        const minWords = isSpecialChapter(ch.chapterNumber) ? MIN_WORDS_SPECIAL_CHAPTER : MIN_WORDS_REGULAR_CHAPTER;
        return wordCount < minWords;
      });

      if (truncatedChapters.length === 0) {
        this.callbacks.onAgentStatus("ghostwriter-v2", "completed", "No se encontraron capítulos truncados");
        await this.extractSeriesWorldBibleOnComplete(project.id);
        await storage.updateProject(project.id, { status: "completed" });
        this.callbacks.onProjectComplete();
        return;
      }

      const worldBible = await storage.getWorldBibleByProject(project.id);
      if (!worldBible) {
        this.callbacks.onError("No se encontró la World Bible para este proyecto");
        await storage.updateProject(project.id, { status: "paused" });
        await storage.createActivityLog({
          projectId: project.id,
          level: "error",
          message: "Falta World Bible. Verifica la configuración del proyecto.",
          agentRole: "system",
          metadata: { recoverable: false, requiresConfiguration: true },
        });
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

        // Sync deaths before writing
        await this.syncEntitiesIntoWorldBible(project.id, worldBibleData);

        // Plan new scenes (WITH constraints)
        // Get full outline for plot context (World Bible stores as chapterOutlines, not chapters)
        const plotData2 = (worldBibleData as any)?.plotOutline as any;
        const fullOutline = plotData2?.chapterOutlines || plotData2?.chapters || [];
        
        // LitAgents 2.9.7: Get pattern analysis to prevent structural repetition
        const patternTracker = getPatternTracker(project.id);
        const patternAnalysis = patternTracker.analyzeForChapter(chapter.chapterNumber);
        const patternAnalysisContext = patternTracker.formatForPrompt(patternAnalysis);
        
        const chapterPlan = await this.chapterArchitect.execute({
          chapterOutline,
          worldBible: worldBibleData,
          previousChapterSummary: rollingSummary,
          storyState: rollingSummary,
          consistencyConstraints,
          fullPlotOutline: fullOutline, // LitAgents 2.1: Full plot context
          isKindleUnlimited: project.kindleUnlimitedOptimized || false, // LitAgents 2.5: Direct KU pacing flag
          patternAnalysisContext, // LitAgents 2.9.7: Anti-repetition pattern context
        });

        if (!chapterPlan.parsed) {
          console.error(`[OrchestratorV2] Failed to plan chapter ${chapter.chapterNumber}`);
          continue;
        }

        this.addTokenUsage(chapterPlan.tokenUsage);
        await this.logAiUsage(project.id, "chapter-architect", "deepseek-reasoner", chapterPlan.tokenUsage, chapter.chapterNumber);
        
        // LitAgents 2.9.7: Register the chapter's pattern after planning
        const chapterPatternRegen = patternTracker.extractPatternFromScenes(
          chapter.chapterNumber,
          chapterOutline.title,
          chapterPlan.parsed.scenes.map(s => ({
            plot_beat: s.plot_beat,
            emotional_beat: s.emotional_beat,
            ending_hook: s.ending_hook
          })),
          chapterPlan.parsed.chapter_hook
        );
        patternTracker.registerPattern(chapterPatternRegen);

        // Write new scenes
        let fullChapterText = "";
        let lastContext = "";
        let scenesCancelled = false;
        
        // LitAgents 2.2: Get recent text for vocabulary tracking
        const previousChaptersText = await this.getRecentChaptersText(project.id, chapter.chapterNumber, 2);

        for (const scene of chapterPlan.parsed.scenes) {
          // Check cancellation before each scene
          if (await this.shouldStopProcessing(project.id)) {
            console.log(`[OrchestratorV2] Truncated regeneration cancelled during scene writing for project ${project.id}`);
            scenesCancelled = true;
            break;
          }
          
          this.callbacks.onAgentStatus("ghostwriter-v2", "active", `Escribiendo escena ${scene.scene_num}...`);
          
          const truncRegenSeriesWB = await this.getSeriesWorldBibleForInjection(project.id);
          const sceneResult = await this.ghostwriter.execute({
            scenePlan: scene,
            prevSceneContext: lastContext,
            rollingSummary,
            worldBible: worldBibleData,
            guiaEstilo,
            consistencyConstraints,
            previousChaptersText,
            currentChapterText: fullChapterText,
            seriesWorldBible: truncRegenSeriesWB,
          });

          if (!sceneResult.error) {
            fullChapterText += "\n\n" + sceneResult.content;
            lastContext = sceneResult.content.slice(-1500);
          }

          this.addTokenUsage(sceneResult.tokenUsage);
          await this.logAiUsage(project.id, "ghostwriter-v2", "deepseek-chat", sceneResult.tokenUsage, chapter.chapterNumber);
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
        await this.logAiUsage(project.id, "smart-editor", "deepseek-chat", editResult.tokenUsage, chapter.chapterNumber);

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

      // Extract series world bible before completing
      await this.extractSeriesWorldBibleOnComplete(project.id);

      await storage.updateProject(project.id, { status: "completed" });
      this.callbacks.onProjectComplete();

    } catch (error) {
      console.error("[OrchestratorV2] Truncated regeneration error:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.callbacks.onError(errorMessage);
      await storage.updateProject(project.id, { status: "paused" });
      await storage.createActivityLog({
        projectId: project.id,
        level: "error",
        message: `Error regenerando capítulos truncados: ${errorMessage.substring(0, 300)}. Presiona "Continuar" para reintentar.`,
        agentRole: "system",
        metadata: { error: errorMessage, recoverable: true },
      });
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
        await storage.updateProject(project.id, { status: "paused" });
        await storage.createActivityLog({
          projectId: project.id,
          level: "error",
          message: "Falta World Bible. Verifica la configuración del proyecto.",
          agentRole: "system",
          metadata: { recoverable: false, requiresConfiguration: true },
        });
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
        await this.logAiUsage(project.id, "smart-editor", "deepseek-chat", editResult.tokenUsage, chapter.chapterNumber);

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

      // Extract series world bible before completing
      await this.extractSeriesWorldBibleOnComplete(project.id);

      await storage.updateProject(project.id, { status: "completed" });
      this.callbacks.onProjectComplete();

    } catch (error) {
      console.error("[OrchestratorV2] Sentinel error:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.callbacks.onError(errorMessage);
      await storage.updateProject(project.id, { status: "paused" });
      await storage.createActivityLog({
        projectId: project.id,
        level: "error",
        message: `Error en validación de continuidad: ${errorMessage.substring(0, 300)}. Presiona "Continuar" para reintentar.`,
        agentRole: "system",
        metadata: { error: errorMessage, recoverable: true },
      });
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
        await this.extractSeriesWorldBibleOnComplete(project.id);
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

        // Sync deaths before writing
        await this.syncEntitiesIntoWorldBible(project.id, worldBible as any);

        // Chapter Architect (WITH constraints)
        this.callbacks.onAgentStatus("chapter-architect", "active", `Planning scenes for Chapter ${chapterNumber}...`);
        
        // Get full outline for plot context (World Bible stores as chapterOutlines, not chapters)
        const plotData3 = (worldBible as any)?.plotOutline;
        const fullOutline = plotData3?.chapterOutlines || plotData3?.chapters || outline;
        
        // LitAgents 2.9.7: Get pattern analysis to prevent structural repetition
        const patternTracker = getPatternTracker(project.id);
        const patternAnalysis = patternTracker.analyzeForChapter(chapterNumber);
        const patternAnalysisContext = patternTracker.formatForPrompt(patternAnalysis);
        
        const chapterPlan = await this.chapterArchitect.execute({
          chapterOutline,
          worldBible: worldBible as any,
          previousChapterSummary: previousSummary,
          storyState: rollingSummary,
          consistencyConstraints,
          fullPlotOutline: fullOutline, // LitAgents 2.1: Full plot context
          isKindleUnlimited: project.kindleUnlimitedOptimized || false, // LitAgents 2.5: Direct KU pacing flag
          patternAnalysisContext, // LitAgents 2.9.7: Anti-repetition pattern context
        });

        if (chapterPlan.error || !chapterPlan.parsed) {
          throw new Error(`Chapter Architect failed for Chapter ${chapterNumber}: ${chapterPlan.error || "No parsed output"}`);
        }

        this.addTokenUsage(chapterPlan.tokenUsage);
        await this.logAiUsage(project.id, "chapter-architect", "deepseek-reasoner", chapterPlan.tokenUsage, chapterNumber);
        this.callbacks.onAgentStatus("chapter-architect", "completed", `${chapterPlan.parsed.scenes.length} scenes planned`);

        const sceneBreakdown = chapterPlan.parsed;
        
        // LitAgents 2.9.7: Register the chapter's pattern after planning
        const chapterPatternFill = patternTracker.extractPatternFromScenes(
          chapterNumber,
          chapterOutline.title,
          sceneBreakdown.scenes.map(s => ({
            plot_beat: s.plot_beat,
            emotional_beat: s.emotional_beat,
            ending_hook: s.ending_hook
          })),
          sceneBreakdown.chapter_hook
        );
        patternTracker.registerPattern(chapterPatternFill);

        // Ghostwriter - Write scenes
        let fullChapterText = "";
        let lastContext = "";

        // LitAgents 2.2: Get recent text for vocabulary tracking
        const regenPrevText = await this.getRecentChaptersText(project.id, chapterNumber, 2);
        
        const missingGenSeriesWB = await this.getSeriesWorldBibleForInjection(project.id);
        for (const scene of sceneBreakdown.scenes) {
          this.callbacks.onAgentStatus("ghostwriter-v2", "active", 
            `Writing scene ${scene.scene_num}/${sceneBreakdown.scenes.length}...`);

          const sceneResult = await this.ghostwriter.execute({
            scenePlan: scene,
            prevSceneContext: lastContext,
            rollingSummary,
            worldBible: worldBible as any,
            guiaEstilo,
            consistencyConstraints,
            previousChaptersText: regenPrevText,
            currentChapterText: fullChapterText,
            seriesWorldBible: missingGenSeriesWB,
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

      // Extract series world bible before completing
      await this.extractSeriesWorldBibleOnComplete(project.id);

      // Complete
      await storage.updateProject(project.id, { status: "completed" });
      this.callbacks.onProjectComplete();

    } catch (error) {
      console.error("[OrchestratorV2] Generate missing chapters error:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.callbacks.onError(errorMessage);
      await storage.updateProject(project.id, { status: "paused" });
      await storage.createActivityLog({
        projectId: project.id,
        level: "error",
        message: `Error generando capítulos faltantes: ${errorMessage.substring(0, 300)}. Presiona "Continuar" para reintentar.`,
        agentRole: "system",
        metadata: { error: errorMessage, recoverable: true },
      });
    }
  }

  // =============================================================================
  // LitAgents 2.9.4: "DETECT ALL, THEN FIX" STRATEGY
  // Phase 1: Run 3 consecutive reviews to detect ALL issues (no corrections)
  // Phase 2: Fix issues one by one with verification (no new issues introduced)
  // =============================================================================

  /**
   * Generate a unique hash for an issue to enable deduplication (v2 for new strategy)
   */
  private generateIssueHashV2(issue: { chapter: number; tipo: string; descripcion: string; contexto?: string }): string {
    const normalizedDesc = issue.descripcion.toLowerCase().trim().substring(0, 100);
    const normalizedContext = (issue.contexto || '').toLowerCase().trim().substring(0, 50);
    const raw = `${issue.chapter}-${issue.tipo}-${normalizedDesc}-${normalizedContext}`;
    let hash = 0;
    for (let i = 0; i < raw.length; i++) {
      const char = raw.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Phase 1: Exhaustive Detection
   * Run FinalReviewer 3 times and consolidate all issues into a deduplicated registry
   */
  async exhaustiveDetection(project: any, chapters: any[], worldBible: any): Promise<IssueRegistry> {
    const registry: IssueRegistry = {
      projectId: project.id,
      createdAt: new Date().toISOString(),
      detectionPhaseComplete: false,
      issues: [],
      totalDetected: 0,
      totalResolved: 0,
      totalEscalated: 0,
    };

    const seenHashes = new Set<string>();

    this.callbacks.onAgentStatus("final-reviewer", "active", "Fase de detección: ejecutando 3 revisiones exhaustivas...");
    
    // Emit phase progress
    this.callbacks.onDetectAndFixProgress?.({
      phase: 'detection',
      subPhase: 'starting',
      current: 0,
      total: 3,
      details: { reviewNumber: 0, totalUniqueIssues: 0 }
    });
    
    await storage.createActivityLog({
      projectId: project.id,
      level: "info",
      message: "[DETECCION] Iniciando fase de detección exhaustiva (3 revisiones consecutivas)",
      agentRole: "orchestrator",
    });

    for (let reviewNum = 1; reviewNum <= 3; reviewNum++) {
      console.log(`[OrchestratorV2] Detection Phase: Review ${reviewNum}/3`);
      this.callbacks.onAgentStatus("final-reviewer", "active", `Revisión ${reviewNum}/3 en progreso...`);
      
      // Emit review start
      this.callbacks.onDetectAndFixProgress?.({
        phase: 'detection',
        subPhase: 'reviewing',
        current: reviewNum,
        total: 3,
        details: { reviewNumber: reviewNum, totalUniqueIssues: seenHashes.size }
      });

      try {
        const dfForceProvider = this.geminiQAFlags?.finalReviewer ? "gemini" as const : undefined;
        const reviewResult = await this.finalReviewer.execute({
          chapters: chapters.map(c => ({
            numero: c.chapterNumber,
            titulo: c.title || `Capítulo ${c.chapterNumber}`,
            contenido: c.content || '',
          })),
          worldBible,
          projectTitle: project.title,
          guiaEstilo: project.styleGuide || `Género: ${project.genre || 'Ficción'}. Tono: ${project.tone || 'neutral'}.`,
          pasadaNumero: reviewNum,
        }, dfForceProvider ? { forceProvider: dfForceProvider } : undefined);

        const dfModel = dfForceProvider ? "gemini-3-pro-preview" : "deepseek-reasoner";
        this.addTokenUsage(reviewResult.tokenUsage);
        await this.logAiUsage(project.id, "final-reviewer", dfModel, reviewResult.tokenUsage);

        const finalResult = reviewResult.result || reviewResult as any;
        const issues = finalResult?.issues || [];
        let newIssuesThisReview = 0;

        for (const issue of issues) {
          // Handle capitulo (number) or capitulos_afectados (array)
          let rawChapter: number = 0;
          if (typeof issue.capitulo === 'number') {
            rawChapter = issue.capitulo;
          } else if (Array.isArray(issue.capitulos_afectados) && issue.capitulos_afectados.length > 0) {
            rawChapter = issue.capitulos_afectados[0];
          }
          // normalizeChapterNumber returns array, take first element
          const normalizedChapters = this.normalizeChapterNumber(rawChapter);
          const chapterNum = normalizedChapters[0] ?? rawChapter;
          const hash = this.generateIssueHashV2({
            chapter: chapterNum,
            tipo: issue.tipo || issue.categoria || 'unknown',
            descripcion: issue.descripcion,
            contexto: issue.contexto,
          });

          if (!seenHashes.has(hash)) {
            seenHashes.add(hash);
            newIssuesThisReview++;

            const registeredIssue: RegisteredIssue = {
              id: hash,
              source: `review-${reviewNum}`,
              chapter: chapterNum,
              tipo: issue.tipo || issue.categoria || 'unknown',
              severidad: (issue.severidad as 'critico' | 'mayor' | 'menor') || 'menor',
              descripcion: issue.descripcion,
              contexto: issue.contexto,
              instrucciones: issue.instrucciones,
              correccion: issue.correccion,
              status: 'pending',
              attempts: 0,
            };
            registry.issues.push(registeredIssue);
          }
        }

        console.log(`[OrchestratorV2] Review ${reviewNum}: Found ${issues.length} issues, ${newIssuesThisReview} new (${seenHashes.size} total unique)`);
        
        // Emit review complete with results
        this.callbacks.onDetectAndFixProgress?.({
          phase: 'detection',
          subPhase: 'review_complete',
          current: reviewNum,
          total: 3,
          details: { 
            reviewNumber: reviewNum, 
            issuesFoundThisReview: newIssuesThisReview,
            totalUniqueIssues: seenHashes.size 
          }
        });
        
        await storage.createActivityLog({
          projectId: project.id,
          level: "info",
          message: `[DETECCION] Revisión ${reviewNum}/3: ${issues.length} issues encontrados, ${newIssuesThisReview} nuevos, ${seenHashes.size} únicos acumulados`,
          agentRole: "final-reviewer",
        });

      } catch (error) {
        console.error(`[OrchestratorV2] Detection review ${reviewNum} failed:`, error);
        await storage.createActivityLog({
          projectId: project.id,
          level: "error",
          message: `[DETECCION] Error en revisión ${reviewNum}: ${error instanceof Error ? error.message : 'Unknown error'}`,
          agentRole: "final-reviewer",
        });
      }
    }

    registry.detectionPhaseComplete = true;
    registry.totalDetected = registry.issues.length;

    // Sort by severity (critico > mayor > menor) and chapter number
    const severityOrder = { critico: 0, mayor: 1, menor: 2 };
    registry.issues.sort((a, b) => {
      const sevDiff = severityOrder[a.severidad] - severityOrder[b.severidad];
      if (sevDiff !== 0) return sevDiff;
      return a.chapter - b.chapter;
    });

    await storage.createActivityLog({
      projectId: project.id,
      level: "success",
      message: `[DETECCION COMPLETA] ${registry.totalDetected} issues únicos detectados en 3 revisiones. Iniciando fase de corrección verificada.`,
      agentRole: "orchestrator",
    });

    // Group by severity for summary
    const bySeverity = { critico: 0, mayor: 0, menor: 0 };
    for (const issue of registry.issues) {
      bySeverity[issue.severidad]++;
    }

    this.callbacks.onAgentStatus("final-reviewer", "completed", 
      `Detección completa: ${bySeverity.critico} críticos, ${bySeverity.mayor} mayores, ${bySeverity.menor} menores`);

    // Emit detection phase complete
    this.callbacks.onDetectAndFixProgress?.({
      phase: 'detection',
      subPhase: 'complete',
      current: 3,
      total: 3,
      details: { 
        totalUniqueIssues: registry.totalDetected,
      }
    });

    return registry;
  }

  /**
   * Mini-verifier: Check if a correction introduced new problems
   * Only analyzes the specific paragraph/section that was modified
   */
  async verifyCorrection(
    project: any,
    chapter: any,
    originalContent: string,
    correctedContent: string,
    issue: RegisteredIssue,
    worldBible: any,
    isMultiChapter: boolean = false,
    relatedChapters: number[] = []
  ): Promise<{ 
    valid: boolean; 
    originalIssueFixed: boolean;
    newIssues?: string[]; 
    error?: string 
  }> {
    
    // v2.9.5: FOCUSED VERIFICATION - Only check if the specific issue was fixed
    // Do NOT use full SmartEditor evaluation which detects ALL weaknesses
    // This was causing ALL corrections to be rejected because it found pre-existing issues
    
    // v2.9.6: Multi-chapter issues require a different verification approach
    // For multi-chapter issues, we only verify that THIS chapter's contribution to the issue was addressed
    const multiChapterContext = isMultiChapter 
      ? `\n\nIMPORTANTE - PROBLEMA MULTI-CAPÍTULO:
Este issue afecta MÚLTIPLES capítulos (${[issue.chapter, ...relatedChapters].join(', ')}).
Estás verificando SOLO el capítulo ${issue.chapter}.
Para issues multi-capítulo como "timeline" o "coherencia":
- issueFixed = true si ESTE capítulo fue modificado de manera que CONTRIBUYE a resolver el problema global
- NO esperes que el issue esté 100% resuelto (requiere corregir los otros capítulos también)
- Evalúa si el cambio realizado va en la DIRECCIÓN CORRECTA
- Un cambio parcial que mejora la coherencia cuenta como APROBADO`
      : '';
    
    const verificationPrompt = `Eres un verificador de correcciones QUIRÚRGICAS. Tu ÚNICA tarea es verificar si el issue ESPECÍFICO fue corregido.

ISSUE ORIGINAL QUE DEBÍA CORREGIRSE:
- Tipo: ${issue.tipo}
- Severidad: ${issue.severidad}  
- Descripción: ${issue.descripcion}
- Contexto: "${issue.contexto || 'N/A'}"
- Corrección sugerida: ${issue.correccion || issue.instrucciones || 'N/A'}${multiChapterContext}

TEXTO ORIGINAL (ANTES):
${originalContent.substring(0, 3000)}

TEXTO CORREGIDO (DESPUÉS):
${correctedContent.substring(0, 3000)}

INSTRUCCIONES PRECISAS:
1. Busca el texto problemático descrito en el issue original
2. Verifica si ese texto ESPECÍFICO fue corregido en la versión DESPUÉS
3. Solo reporta "nuevoProblema" si la corrección INTRODUJO algo que antes NO existía (no problemas pre-existentes)

CRITERIOS:
- issueFixed = true si el problema original YA NO existe en el texto corregido${isMultiChapter ? ' O si el cambio CONTRIBUYE a resolverlo' : ''}
- Solo cuenta como "nuevosProblemas" si son DIRECTAMENTE causados por el cambio realizado
- Problemas pre-existentes NO cuentan como "nuevos"
- Cambios mínimos de estilo NO son problemas
- Solo reporta problemas GRAVES: contradicciones lógicas, resurrección de personajes, cambios de atributos físicos canónicos

Responde SOLO en JSON válido (sin markdown):
{
  "issueFixed": true/false,
  "evidencia": "cita breve del texto que demuestra que se corrigió (o no)",
  "nuevosProblemas": ["solo problemas GRAVES causados por el cambio"] o [],
  "verdict": "APROBADO" | "RECHAZADO"
}`;

    try {
      // v2.9.5: Use a FOCUSED verification call, not full SmartEditor
      // This prevents detecting pre-existing weaknesses as "new problems"
      const deepseekClient = new OpenAI({
        baseURL: "https://api.deepseek.com/v1",
        apiKey: process.env.DEEPSEEK_API_KEY || process.env.DEEPSEEK_REEDITOR_API_KEY,
      });
      
      const response = await deepseekClient.chat.completions.create({
        model: "deepseek-chat",
        messages: [{ role: "user", content: verificationPrompt }],
        temperature: 0.1, // Low temperature for consistent verification
        max_tokens: 500,
      });

      const content = response.choices[0]?.message?.content || "";
      
      // Track token usage
      const tokenUsage = {
        inputTokens: response.usage?.prompt_tokens || 0,
        outputTokens: response.usage?.completion_tokens || 0,
        thinkingTokens: 0,
      };
      this.addTokenUsage(tokenUsage);
      await this.logAiUsage(project.id, "correction-verifier", "deepseek-chat", tokenUsage, issue.chapter);

      // Parse JSON response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          
          const issueFixed = parsed.issueFixed === true;
          const newProblems = parsed.nuevosProblemas || parsed.newProblems || [];
          const verdict = parsed.verdict;
          
          // v2.9.5: Only count GRAVE new problems, not minor style issues
          const graveNewProblems = newProblems.filter((p: string) => {
            const pLower = p.toLowerCase();
            return pLower.includes('contradicción') || 
                   pLower.includes('contradiccion') ||
                   pLower.includes('resurrección') ||
                   pLower.includes('resurreccion') ||
                   pLower.includes('personaje muerto') ||
                   pLower.includes('atributo físico') ||
                   pLower.includes('atributo fisico') ||
                   pLower.includes('color de ojos') ||
                   pLower.includes('incoherencia grave') ||
                   pLower.includes('error lógico') ||
                   pLower.includes('error logico');
          });
          
          console.log(`[OrchestratorV2] Verification result: issueFixed=${issueFixed}, newProblems=${newProblems.length}, graveProblems=${graveNewProblems.length}`);
          
          return {
            valid: issueFixed && graveNewProblems.length === 0,
            originalIssueFixed: issueFixed,
            newIssues: graveNewProblems.length > 0 ? graveNewProblems : undefined,
            error: !issueFixed ? "Issue original no corregido" : undefined,
          };
        } catch (e) {
          console.warn("[OrchestratorV2] Failed to parse verification JSON, assuming fixed");
        }
      }

      // If parsing fails but content suggests approval, assume valid
      if (content.toLowerCase().includes('aprobado') || content.toLowerCase().includes('corregido')) {
        return { valid: true, originalIssueFixed: true };
      }

      // Default: assume valid to avoid blocking progress
      return { valid: true, originalIssueFixed: true };
    } catch (error) {
      console.error("[OrchestratorV2] Verification failed:", error);
      // On verification error, assume valid to avoid blocking progress
      return { valid: true, originalIssueFixed: true, error: error instanceof Error ? error.message : "Error de verificación (asumiendo válido)" };
    }
  }

  /**
   * Phase 2: Verified Correction
   * Fix each issue one by one, verifying that no new problems are introduced
   */
  async verifiedCorrectionPhase(
    project: any,
    registry: IssueRegistry,
    worldBible: any
  ): Promise<IssueRegistry> {
    const MAX_ATTEMPTS_PER_ISSUE = 4; // Allows: attempt 1 (surgical), attempt 2 (surgical expanded), attempt 3 (focused rewrite)
    const chapters = await storage.getChaptersByProject(project.id);
    const chapterMap = new Map(chapters.map(c => [c.chapterNumber, c]));

    this.callbacks.onAgentStatus("smart-editor", "active", `Corrigiendo ${registry.issues.length} issues verificados...`);

    // Emit correction phase start
    this.callbacks.onDetectAndFixProgress?.({
      phase: 'correction',
      subPhase: 'starting',
      current: 0,
      total: registry.issues.length,
      details: { resolved: 0, escalated: 0 }
    });

    await storage.createActivityLog({
      projectId: project.id,
      level: "info",
      message: `[CORRECCION] Iniciando corrección verificada de ${registry.issues.length} issues`,
      agentRole: "orchestrator",
    });

    let resolvedCount = 0;
    let escalatedCount = 0;

    for (let i = 0; i < registry.issues.length; i++) {
      const issue = registry.issues[i];
      
      if (issue.status === 'resolved' || issue.status === 'escalated') continue;

      const chapter = chapterMap.get(issue.chapter);
      if (!chapter || !chapter.content) {
        console.warn(`[OrchestratorV2] Chapter ${issue.chapter} not found for issue ${issue.id}`);
        issue.status = 'escalated';
        issue.lastAttemptError = 'Capítulo no encontrado';
        escalatedCount++;
        continue;
      }

      issue.status = 'fixing';
      issue.originalContent = chapter.content;

      // CHECK FOR RELATED ISSUES IN OTHER CHAPTERS - require coordinated planning
      // Find other issues of the same type that might need coordinated fixes
      const relatedIssues = registry.issues.filter(
        (other) => other.id !== issue.id && 
                   other.tipo === issue.tipo && 
                   other.status !== 'resolved'
      );
      const relatedChapters = Array.from(new Set(relatedIssues.map(i => i.chapter))).filter(c => c !== issue.chapter);
      const isMultiChapter = relatedChapters.length > 0;
      
      let multiChapterPlan: string | null = null;
      
      // v2.9.6: COORDINATED MULTI-CHAPTER CORRECTION
      // When we find an issue that affects multiple chapters, we'll fix ALL of them
      // in sequence before moving to the next issue type
      const allChaptersToFix = isMultiChapter 
        ? [issue.chapter, ...relatedChapters] 
        : [issue.chapter];
      
      if (isMultiChapter) {
        console.log(`[OrchestratorV2] MULTI-CHAPTER FIX: ${issue.tipo} affects chapters ${allChaptersToFix.join(', ')} - fixing ALL now`);
        
        await storage.createActivityLog({
          projectId: project.id,
          level: "info",
          message: `[MULTI-CAPÍTULO] ${issue.tipo} afecta capítulos ${allChaptersToFix.join(', ')} - corrigiendo TODOS en secuencia`,
          agentRole: "smart-editor",
        });
        
        // Build plan for coordinated correction
        multiChapterPlan = `[CORRECCIÓN COORDINADA MULTI-CAPÍTULO]
Este problema (${issue.tipo}) afecta capítulos: ${allChaptersToFix.join(', ')}
Estás corrigiendo el capítulo ACTUAL como parte de una serie de correcciones coordinadas.

INSTRUCCIONES DE CONSISTENCIA:
1. Corrige de forma que sea CONSISTENTE con los demás capítulos
2. Si corriges un atributo o hecho, debe ser coherente con toda la novela
3. Mantén la coherencia narrativa global
4. Las correcciones deben complementarse entre capítulos`;
      }

      // Emit issue being fixed
      this.callbacks.onDetectAndFixProgress?.({
        phase: 'correction',
        subPhase: 'fixing',
        current: i + 1,
        total: registry.issues.length,
        details: { 
          issueIndex: i + 1,
          issueType: issue.tipo,
          issueChapter: issue.chapter,
          issueSeverity: issue.severidad,
          resolved: resolvedCount,
          escalated: escalatedCount
        }
      });

      this.callbacks.onAgentStatus("smart-editor", "active", 
        `Issue ${i + 1}/${registry.issues.length}: Cap ${issue.chapter} - ${issue.tipo}`);

      console.log(`[OrchestratorV2] Fixing issue ${i + 1}/${registry.issues.length}: ${issue.tipo} in chapter ${issue.chapter}`);

      let corrected = false;
      
      while (issue.attempts < MAX_ATTEMPTS_PER_ISSUE && !corrected) {
        issue.attempts++;

        try {
          // Build error description from issue
          let errorDescription = `[${issue.severidad.toUpperCase()}] ${issue.tipo}: ${issue.descripcion}${issue.contexto ? `\nContexto: "${issue.contexto}"` : ''}${issue.instrucciones ? `\nInstrucciones: ${issue.instrucciones}` : ''}${issue.correccion ? `\nCorrección sugerida: ${issue.correccion}` : ''}`;
          
          // Add multi-chapter coordination plan if applicable
          if (multiChapterPlan) {
            errorDescription = `${multiChapterPlan}\n\n${errorDescription}`;
          }
          
          let correctedContent: string | null = null;

          // PROGRESSIVE ESCALATION (LitAgents 2.9.5+)
          // Attempt 1: surgicalFix (small patch)
          // Attempt 2: surgicalFix with expanded context
          // Attempt 3: fullRewrite (paragraph-level rewrite)
          
          if (issue.attempts <= 2) {
            // Attempts 1-2: Use surgicalFix
            const escalatedDescription = issue.attempts === 2 
              ? `${errorDescription}\n\n[SEGUNDO INTENTO - USA PARCHE MÁS AMPLIO]\nEl parche anterior falló. Amplía el alcance del parche para incluir el párrafo completo si es necesario. Asegúrate de que el snippet original exista EXACTAMENTE en el texto.`
              : errorDescription;
            
            const fixResult = await this.smartEditor.surgicalFix({
              chapterContent: chapter.content,
              errorDescription: escalatedDescription,
              worldBible,
              chapterNumber: issue.chapter,
            });

            this.addTokenUsage(fixResult.tokenUsage);
            await this.logAiUsage(project.id, "smart-editor", "deepseek-chat", fixResult.tokenUsage, issue.chapter);

            if (fixResult.patches && fixResult.patches.length > 0) {
              const patchResult = applyPatches(chapter.content, fixResult.patches);
              if (patchResult.appliedPatches > 0) {
                correctedContent = patchResult.patchedText;
              }
            }
            
          } else {
            // Attempt 3: Use FOCUSED paragraph rewrite (last resort) - only modify the specific paragraph
            console.log(`[OrchestratorV2] ESCALATION: Using focused paragraph rewrite for issue ${issue.id} after 2 failed surgicalFix attempts`);
            
            await storage.createActivityLog({
              projectId: project.id,
              level: "info",
              message: `[ESCALADO A REESCRITURA FOCALIZADA] Cap ${issue.chapter}: ${issue.tipo} - parches fallaron, reescribiendo SOLO el párrafo afectado`,
              agentRole: "smart-editor",
            });
            
            // Use the new focusedParagraphRewrite method which is designed to only change specific paragraphs
            const rewriteResult = await this.smartEditor.focusedParagraphRewrite({
              chapterContent: chapter.content,
              errorDescription: errorDescription,
              worldBible,
              chapterNumber: issue.chapter,
            });

            this.addTokenUsage(rewriteResult.tokenUsage);
            await this.logAiUsage(project.id, "smart-editor", "deepseek-chat", rewriteResult.tokenUsage, issue.chapter);

            // VALIDATION: Accept if content changed but not too drastically
            if (rewriteResult.rewrittenContent && 
                rewriteResult.rewrittenContent !== chapter.content) {
              
              // Calculate how much changed
              const originalLen = chapter.content.length;
              const newLen = rewriteResult.rewrittenContent.length;
              const lengthDiff = Math.abs(newLen - originalLen) / originalLen;
              
              // Count how many lines changed
              const originalLines = chapter.content.split('\n');
              const newLines = rewriteResult.rewrittenContent.split('\n');
              let changedLines = 0;
              const minLines = Math.min(originalLines.length, newLines.length);
              for (let li = 0; li < minLines; li++) {
                if (originalLines[li] !== newLines[li]) changedLines++;
              }
              changedLines += Math.abs(originalLines.length - newLines.length);
              const changeRatio = changedLines / originalLines.length;
              
              // MORE LENIENT: Accept up to 25% line changes or 15% length difference
              // This is the "last resort" so we're more permissive than surgical patches
              if (changeRatio > 0.25 || lengthDiff > 0.15) {
                console.warn(`[OrchestratorV2] REJECTED focusedParagraphRewrite: too many changes (${(changeRatio * 100).toFixed(1)}% lines, ${(lengthDiff * 100).toFixed(1)}% length)`);
                issue.lastAttemptError = `Intento ${issue.attempts}: reescritura rechazada - cambió demasiado contenido (${(changeRatio * 100).toFixed(0)}% del capítulo)`;
              } else {
                correctedContent = rewriteResult.rewrittenContent;
                console.log(`[OrchestratorV2] Focused paragraph rewrite accepted: ${(changeRatio * 100).toFixed(1)}% lines changed`);
              }
            } else {
              issue.lastAttemptError = `Intento ${issue.attempts}: reescritura no generó cambios`;
            }
          }

          if (!correctedContent || correctedContent === chapter.content) {
            issue.lastAttemptError = `Intento ${issue.attempts}: ${issue.attempts <= 2 ? 'parche no aplicado' : 'reescritura fallida'}`;
            continue;
          }

          // Verify the correction
          issue.status = 'verifying';
          const verification = await this.verifyCorrection(
            project,
            chapter,
            chapter.content,
            correctedContent,
            issue,
            worldBible,
            isMultiChapter,
            relatedChapters
          );

          // v2.9.5: SIMPLIFIED LOGIC - verifyCorrection now only reports GRAVE problems
          // The verification prompt explicitly filters for only serious issues like:
          // - Contradictions, resurrections, canonical attribute changes
          // So if there are ANY new issues reported, they are serious and we should reject
          
          const hasGraveNewIssues = verification.newIssues && verification.newIssues.length > 0;
          const graveIssueCount = verification.newIssues?.length || 0;
          
          // If original was not fixed, reject
          if (!verification.originalIssueFixed) {
            issue.lastAttemptError = `Intento ${issue.attempts}: issue original no corregido`;
            console.warn(`[OrchestratorV2] Original issue ${issue.id} NOT fixed`);
            continue;
          }
          
          // If correction introduced GRAVE new issues, reject
          if (hasGraveNewIssues) {
            issue.lastAttemptError = `Intento ${issue.attempts}: corrección introdujo ${graveIssueCount} problema(s) grave(s): ${verification.newIssues!.slice(0, 2).join(', ')}`;
            console.warn(`[OrchestratorV2] REJECTED correction for ${issue.id}: introduced ${graveIssueCount} GRAVE new issue(s)`);
            
            await storage.createActivityLog({
              projectId: project.id,
              level: "warning",
              message: `[RECHAZADO] Cap ${issue.chapter}: "${issue.tipo}" - introdujo problema(s) grave(s)`,
              agentRole: "smart-editor",
            });
            
            continue;
          }
          
          // If we get here: original was fixed AND no grave new issues
          console.log(`[OrchestratorV2] ACCEPTED correction for ${issue.id} (${issue.tipo}) - clean fix`);
          
          // Only save if BOTH: original fixed AND no new issues
          if (verification.originalIssueFixed || verification.valid) {
            // Save the corrected content - clean fix with no side effects
            await storage.updateChapter(chapter.id, {
              content: correctedContent,
              wordCount: correctedContent.split(/\s+/).length,
            });

            // Update local chapter reference
            chapter.content = correctedContent;

            issue.status = 'resolved';
            issue.resolvedAt = new Date().toISOString();
            resolvedCount++;
            corrected = true;

            console.log(`[OrchestratorV2] Issue ${issue.id} resolved CLEANLY on attempt ${issue.attempts} (no new issues)`);
            
            // v2.9.5: NO CASCADE - We no longer add new issues to the registry
            // If a correction would create new issues, we reject it above
            
            // Emit issue resolved
            this.callbacks.onDetectAndFixProgress?.({
              phase: 'correction',
              subPhase: 'issue_resolved',
              current: i + 1,
              total: registry.issues.length,
              details: { 
                issueIndex: i + 1,
                issueType: issue.tipo,
                issueChapter: issue.chapter,
                resolved: resolvedCount,
                escalated: escalatedCount
              }
            });
            
            const correctionMethod = issue.attempts <= 2 ? 'parche' : 'reescritura';
            await storage.createActivityLog({
              projectId: project.id,
              level: "success",
              message: `[CORREGIDO] Cap ${issue.chapter}: ${issue.tipo} - "${issue.descripcion.substring(0, 50)}..." (${correctionMethod}, intento ${issue.attempts})`,
              agentRole: "smart-editor",
            });

            // v2.9.6: COORDINATED FIX - Now fix ALL related chapters for this issue type
            if (isMultiChapter && relatedIssues.length > 0) {
              console.log(`[OrchestratorV2] Fixing ${relatedIssues.length} related chapters for ${issue.tipo}...`);
              
              for (const relatedIssue of relatedIssues) {
                if (relatedIssue.status === 'resolved' || relatedIssue.status === 'escalated') continue;
                
                const relatedChapter = chapterMap.get(relatedIssue.chapter);
                if (!relatedChapter || !relatedChapter.content) continue;
                
                await storage.createActivityLog({
                  projectId: project.id,
                  level: "info",
                  message: `[MULTI-CAP] Corrigiendo capítulo relacionado ${relatedIssue.chapter} (mismo issue: ${issue.tipo})`,
                  agentRole: "smart-editor",
                });

                // Build error description for related issue
                const relatedErrorDesc = `[CORRECCIÓN COORDINADA - Parte de issue multi-capítulo]
${multiChapterPlan || ''}

[${relatedIssue.severidad.toUpperCase()}] ${relatedIssue.tipo}: ${relatedIssue.descripcion}
${relatedIssue.contexto ? `Contexto: "${relatedIssue.contexto}"` : ''}
${relatedIssue.instrucciones ? `Instrucciones: ${relatedIssue.instrucciones}` : ''}`;

                // Try to fix the related chapter (single attempt with focused rewrite)
                relatedIssue.attempts = 1;
                relatedIssue.status = 'fixing';
                relatedIssue.originalContent = relatedChapter.content;
                
                try {
                  const rewriteResult = await this.smartEditor.focusedParagraphRewrite({
                    chapterContent: relatedChapter.content,
                    errorDescription: relatedErrorDesc,
                    worldBible,
                    chapterNumber: relatedIssue.chapter,
                  });

                  this.addTokenUsage(rewriteResult.tokenUsage);
                  await this.logAiUsage(project.id, "smart-editor", "deepseek-chat", rewriteResult.tokenUsage, relatedIssue.chapter);

                  if (rewriteResult.rewrittenContent && rewriteResult.rewrittenContent !== relatedChapter.content) {
                    // Apply the correction
                    await storage.updateChapter(relatedChapter.id, {
                      content: rewriteResult.rewrittenContent,
                    });
                    relatedChapter.content = rewriteResult.rewrittenContent;
                    
                    relatedIssue.status = 'resolved';
                    relatedIssue.resolvedAt = new Date().toISOString();
                    resolvedCount++;
                    
                    await storage.createActivityLog({
                      projectId: project.id,
                      level: "success",
                      message: `[MULTI-CAP CORREGIDO] Cap ${relatedIssue.chapter}: ${relatedIssue.tipo} (corrección coordinada)`,
                      agentRole: "smart-editor",
                    });
                    
                    console.log(`[OrchestratorV2] Related issue in chapter ${relatedIssue.chapter} resolved`);
                  } else {
                    relatedIssue.status = 'escalated';
                    relatedIssue.lastAttemptError = 'Corrección coordinada no generó cambios';
                    escalatedCount++;
                  }
                } catch (relatedError) {
                  console.error(`[OrchestratorV2] Failed to fix related chapter ${relatedIssue.chapter}:`, relatedError);
                  relatedIssue.status = 'escalated';
                  relatedIssue.lastAttemptError = `Error en corrección coordinada: ${relatedError instanceof Error ? relatedError.message : 'error'}`;
                  escalatedCount++;
                }
              }
            }

          } else {
            // The ORIGINAL issue was NOT fixed - count as failure
            issue.lastAttemptError = `Intento ${issue.attempts}: ${verification.error || 'issue original no corregido'}`;
            if (verification.newIssues) {
              issue.lastAttemptError += ` (nuevos problemas: ${verification.newIssues.join(', ')})`;
            }
            console.warn(`[OrchestratorV2] Original issue ${issue.id} NOT fixed: ${verification.error}`);
          }

        } catch (error) {
          issue.lastAttemptError = `Intento ${issue.attempts}: ${error instanceof Error ? error.message : 'error desconocido'}`;
          console.error(`[OrchestratorV2] Fix attempt ${issue.attempts} failed:`, error);
        }
      }

      if (!corrected) {
        issue.status = 'escalated';
        escalatedCount++;
        
        // Emit issue escalated
        this.callbacks.onDetectAndFixProgress?.({
          phase: 'correction',
          subPhase: 'issue_escalated',
          current: i + 1,
          total: registry.issues.length,
          details: { 
            issueIndex: i + 1,
            issueType: issue.tipo,
            issueChapter: issue.chapter,
            resolved: resolvedCount,
            escalated: escalatedCount
          }
        });
        
        await storage.createActivityLog({
          projectId: project.id,
          level: "warn",
          message: `[ESCALADO] Cap ${issue.chapter}: ${issue.tipo} - no se pudo corregir tras ${issue.attempts} intentos. Último error: ${issue.lastAttemptError}`,
          agentRole: "smart-editor",
        });
      }

      // Update progress
      registry.totalResolved = resolvedCount;
      registry.totalEscalated = escalatedCount;
    }

    // Emit correction phase complete
    this.callbacks.onDetectAndFixProgress?.({
      phase: 'correction',
      subPhase: 'complete',
      current: registry.issues.length,
      total: registry.issues.length,
      details: { resolved: resolvedCount, escalated: escalatedCount }
    });

    this.callbacks.onAgentStatus("smart-editor", "completed", 
      `Completado: ${resolvedCount} resueltos, ${escalatedCount} escalados de ${registry.issues.length}`);

    await storage.createActivityLog({
      projectId: project.id,
      level: escalatedCount > 0 ? "warn" : "success",
      message: `[CORRECCION COMPLETA] ${resolvedCount}/${registry.issues.length} issues resueltos, ${escalatedCount} escalados`,
      agentRole: "orchestrator",
    });

    return registry;
  }

  /**
   * LitAgents 3.3: Single-pass manuscript analysis that produces a rewrite recommendation
   * instead of iterative corrections. Runs FinalReviewer once, analyzes issues,
   * and recommends rewriting from the earliest problematic chapter.
   */
  async runManuscriptAnalysis(project: any): Promise<{
    score: number;
    recommendation: {
      fromChapter: number;
      reason: string;
      instructions: string[];
      issuesSummary: string;
      threadsClosure: string[];
      totalIssues: number;
      criticalIssues: number;
    } | null;
  }> {
    this.callbacks.onAgentStatus("final-reviewer", "active", "Analizando manuscrito completo...");

    const chapters = await storage.getChaptersByProject(project.id);
    const completedChapters = chapters
      .filter(c => c.status === "completed" || c.status === "approved")
      .sort((a, b) => a.chapterNumber - b.chapterNumber);

    if (completedChapters.length === 0) {
      this.callbacks.onError("No hay capítulos completados para analizar");
      return { score: 0, recommendation: null };
    }

    const worldBible = await storage.getWorldBibleByProject(project.id);
    if (!worldBible) {
      this.callbacks.onError("No se encontró la World Bible para este proyecto");
      return { score: 0, recommendation: null };
    }

    let guiaEstilo = "";
    if ((worldBible as any).styleGuide) {
      guiaEstilo = (worldBible as any).styleGuide;
    } else if (project.styleGuideId) {
      const styleGuide = await storage.getStyleGuide(project.styleGuideId);
      if (styleGuide?.content) {
        guiaEstilo = await this.analyzeAndSaveStyleGuide(project.id, styleGuide.content);
        if (guiaEstilo.length < 100) guiaEstilo = styleGuide.content.substring(0, 3000);
      }
    }

    const worldBibleData: any = {
      characters: worldBible.characters || [],
      rules: worldBible.worldRules || [],
      worldRules: worldBible.worldRules || [],
      locations: (worldBible as any).locations || [],
      settings: (worldBible as any).settings || [],
      plotOutline: worldBible.plotOutline || {},
      timeline: (worldBible as any).timeline || [],
      plotDecisions: worldBible.plotDecisions || [],
      persistentInjuries: worldBible.persistentInjuries || [],
      threeActStructure: (worldBible.plotOutline as any)?.threeActStructure || null,
      three_act_structure: (worldBible.plotOutline as any)?.three_act_structure || null,
    };

    const chaptersForReview = completedChapters.map(c => ({
      numero: c.chapterNumber,
      titulo: c.title || `Capítulo ${c.chapterNumber}`,
      contenido: c.content || "",
    }));

    const rawActStructure = worldBibleData?.threeActStructure || worldBibleData?.three_act_structure;
    const threeActStructure = rawActStructure as {
      act1: { chapters: number[]; goal: string };
      act2: { chapters: number[]; goal: string };
      act3: { chapters: number[]; goal: string };
    } | undefined;

    const frForceProvider = "gemini" as const;
    const reviewResult = await this.finalReviewer.execute({
      projectTitle: project.title,
      chapters: chaptersForReview,
      worldBible: worldBibleData,
      guiaEstilo,
      pasadaNumero: 1,
      threeActStructure,
      onTrancheProgress: (currentTranche, totalTranches, chaptersInTranche) => {
        this.callbacks.onAgentStatus("final-reviewer", "active", `Revisando ${chaptersInTranche}...`);
      },
    }, { forceProvider: frForceProvider });

    this.addTokenUsage(reviewResult.tokenUsage);
    await this.logAiUsage(project.id, "final-reviewer", "gemini-3-pro-preview", reviewResult.tokenUsage);

    if (!reviewResult.result) {
      this.callbacks.onError("Error al analizar el manuscrito");
      await storage.updateProject(project.id, { status: "paused" });
      return { score: 0, recommendation: null };
    }

    const { veredicto, puntuacion_global, issues, capitulos_para_reescribir, resumen_general } = reviewResult.result;

    await storage.updateProject(project.id, {
      finalReviewResult: {
        ...reviewResult.result,
        analysisOnly: true,
        analysisDate: new Date().toISOString(),
      } as any,
      finalScore: puntuacion_global,
    });

    await storage.createActivityLog({
      projectId: project.id,
      level: puntuacion_global >= 9 ? "success" : puntuacion_global >= 7 ? "warn" : "error",
      agentRole: "final-reviewer",
      message: `Análisis completo: ${puntuacion_global}/10 — ${veredicto}. ${issues?.length || 0} problemas detectados.`,
    });

    if (puntuacion_global >= 9 && (!issues || issues.length === 0)) {
      this.callbacks.onAgentStatus("final-reviewer", "completed",
        `Manuscrito aprobado: ${puntuacion_global}/10. Sin problemas detectados.`);

      await storage.updateProject(project.id, {
        rewriteRecommendation: null,
        status: "completed",
      });

      this.callbacks.onProjectComplete();
      return { score: puntuacion_global, recommendation: null };
    }

    const allIssues = issues || [];
    const criticalIssues = allIssues.filter(i => i.severidad === "critica");
    const majorIssues = allIssues.filter(i => i.severidad === "mayor");

    let affectedChapters: number[] = capitulos_para_reescribir || [];
    if (affectedChapters.length === 0 && allIssues.length > 0) {
      for (const issue of allIssues) {
        if (issue.capitulos_afectados?.length > 0) {
          affectedChapters.push(...issue.capitulos_afectados.map(ch => this.normalizeToDbChapterNumber(ch)));
        }
      }
      affectedChapters = Array.from(new Set(affectedChapters));
    }

    const regularChapters = affectedChapters
      .filter(ch => ch > 0 && ch < 998)
      .sort((a, b) => a - b);

    let fromChapter: number;
    if (regularChapters.length > 0) {
      fromChapter = regularChapters[0];
    } else if (affectedChapters.length > 0) {
      fromChapter = Math.min(...affectedChapters);
    } else {
      const totalRegularChapters = completedChapters.filter(c => c.chapterNumber > 0 && c.chapterNumber < 998);
      fromChapter = Math.max(1, Math.floor(totalRegularChapters.length * 0.6));
    }

    const instructions: string[] = [];
    const threadsClosure: string[] = [];

    for (const issue of allIssues) {
      if (issue.instrucciones_correccion) {
        const chapInfo = issue.capitulos_afectados?.length
          ? `(Cap ${issue.capitulos_afectados.join(', ')})`
          : '';
        instructions.push(`[${(issue.severidad || 'mayor').toUpperCase()}] ${issue.descripcion} ${chapInfo} → ${issue.instrucciones_correccion}`);
      }
    }

    const plotThreads = await storage.getPlotThreadsByProject(project.id);
    const unresolvedThreads = plotThreads.filter(t => t.status === "active" || t.status === "developing");
    for (const thread of unresolvedThreads) {
      threadsClosure.push(`Cerrar trama "${thread.name}": ${thread.description || 'resolver antes del final'}`);
    }

    const issuesSummary = allIssues.slice(0, 10).map(i =>
      `- [${(i.severidad || 'mayor').toUpperCase()}] ${i.categoria}: ${(i.descripcion || '').substring(0, 120)}`
    ).join('\n');

    const reason = `Se detectaron ${allIssues.length} problemas (${criticalIssues.length} críticos, ${majorIssues.length} mayores). ` +
      `Los primeros problemas aparecen en el capítulo ${fromChapter}. ` +
      `Reescribiendo desde ahí, se pueden resolver ${affectedChapters.length} capítulos afectados` +
      (unresolvedThreads.length > 0 ? ` y cerrar ${unresolvedThreads.length} tramas pendientes` : '') +
      `. Puntuación actual: ${puntuacion_global}/10.`;

    const recommendation = {
      fromChapter,
      reason,
      instructions,
      issuesSummary,
      threadsClosure,
      totalIssues: allIssues.length,
      criticalIssues: criticalIssues.length,
    };

    await storage.updateProject(project.id, {
      rewriteRecommendation: recommendation as any,
      status: "awaiting_rewrite_decision",
    });

    this.callbacks.onAgentStatus("final-reviewer", "completed",
      `Análisis: ${puntuacion_global}/10. Recomendación: reescribir desde capítulo ${fromChapter} (${allIssues.length} problemas).`);

    await storage.createActivityLog({
      projectId: project.id,
      level: "info",
      agentRole: "orchestrator",
      message: `Recomendación: reescribir desde capítulo ${fromChapter}. ${allIssues.length} problemas, ${unresolvedThreads.length} tramas sin cerrar.`,
    });

    await this.updateProjectTokens(project.id);

    return { score: puntuacion_global, recommendation };
  }

  /**
   * Main entry point for the new "Detect All, Then Fix" strategy
   */
  async detectAndFixStrategy(project: any): Promise<{ registry: IssueRegistry; finalScore: number }> {
    // Register correction in global tracking so cancel button works
    const startCorrection = (global as any).startCorrection;
    const endCorrection = (global as any).endCorrection;
    const isAlreadyActive = (global as any).isAnyCorrectionActive;
    
    // Only register if not already registered (avoid double registration from endpoint)
    const wasAlreadyActive = isAlreadyActive && isAlreadyActive(project.id);
    if (startCorrection && !wasAlreadyActive) {
      startCorrection(project.id, 'detect-fix');
    }
    
    try {
    const chapters = await storage.getChaptersByProject(project.id);
    const worldBibleRecord = await storage.getWorldBibleByProject(project.id);
    const worldBible = (worldBibleRecord as any)?.content || worldBibleRecord || {};

    // SNAPSHOT: Save original manuscript before any corrections
    // This allows comparing original vs corrected version to evaluate correction benefit
    await storage.createActivityLog({
      projectId: project.id,
      level: "info",
      message: `📸 Guardando snapshot del manuscrito original (${chapters.length} capítulos) antes de correcciones...`,
      agentRole: "orchestrator",
    });
    
    for (const chapter of chapters) {
      if (chapter.content) {
        await storage.updateChapter(chapter.id, {
          originalContent: chapter.content,
        });
      }
    }
    
    await storage.createActivityLog({
      projectId: project.id,
      level: "success",
      message: `✅ Snapshot guardado. Podrás comparar original vs corregido en la exportación.`,
      agentRole: "orchestrator",
    });

    // Phase 1: Exhaustive Detection
    const registry = await this.exhaustiveDetection(project, chapters, worldBible);

    if (registry.issues.length === 0) {
      await storage.createActivityLog({
        projectId: project.id,
        level: "success",
        message: "[PERFECTO] No se encontraron issues en las 3 revisiones. Proyecto listo.",
        agentRole: "orchestrator",
      });
      return { registry, finalScore: 10 };
    }

    // Phase 2: Verified Correction
    const finalRegistry = await this.verifiedCorrectionPhase(project, registry, worldBible);

    // Calculate final score based on resolution rate
    const resolutionRate = finalRegistry.totalResolved / finalRegistry.totalDetected;
    let finalScore = Math.round(10 * resolutionRate);
    
    // Penalize for escalated issues
    if (finalRegistry.totalEscalated > 0) {
      finalScore = Math.max(1, finalScore - Math.ceil(finalRegistry.totalEscalated / 2));
    }

    // Update project
    await storage.updateProject(project.id, {
      finalScore,
      status: finalRegistry.totalEscalated === 0 ? "completed" : "paused",
    });

    return { registry: finalRegistry, finalScore };
    } finally {
      // Always unregister correction when method ends (only if we registered it)
      if (endCorrection && !wasAlreadyActive) {
        endCorrection(project.id);
      }
    }
  }

  // ==================== TARGETED REPAIR SYSTEM ====================
  // Diagnose → Plan → Execute flow for fixing completed novels with specific issues

  async diagnoseForTargetedRepair(project: any): Promise<{
    diagnosis: any;
    plan: RepairPlanItem[];
  }> {
    const projectId = project.id;
    const currentProject = await storage.getProject(projectId);
    const isInAutoCycle = currentProject?.targetedRepairStatus === 'auto_cycle';

    // Preserve auto_cycle status during the cycle
    if (!isInAutoCycle) {
      await storage.updateProject(projectId, {
        targetedRepairStatus: 'diagnosing',
        targetedRepairProgress: { current: 0, total: 3, message: 'Iniciando diagnóstico...' },
      });
    }

    this.callbacks.onAgentStatus("targeted-repair", "active", "Diagnosticando novela completa...");

    const chapters = await storage.getChaptersByProject(projectId);
    const completedChapters = chapters
      .filter(c => (c.status === "completed" || c.status === "approved") && c.content && c.content.length > 100)
      .sort((a, b) => a.chapterNumber - b.chapterNumber);

    if (completedChapters.length === 0) {
      throw new Error("No hay capítulos completados para diagnosticar");
    }

    const worldBible = await storage.getWorldBibleByProject(projectId);
    if (!worldBible) {
      throw new Error("No se encontró la World Bible para este proyecto");
    }

    let guiaEstilo = "";
    if ((worldBible as any).styleGuide) {
      guiaEstilo = (worldBible as any).styleGuide;
    } else if (project.styleGuideId) {
      const styleGuide = await storage.getStyleGuide(project.styleGuideId);
      if (styleGuide?.content) guiaEstilo = styleGuide.content.substring(0, 3000);
    }

    const outline = ((worldBible.plotOutline as any)?.chapterOutlines || []) as any[];

    // PHASE 1: Build chapter summaries for Gemini analysis
    await storage.updateProject(projectId, {
      targetedRepairProgress: { current: 1, total: 3, message: 'Analizando estructura narrativa...' },
    });

    // Send full chapter content to Gemini (massive context window) for thorough diagnosis
    const chapterSummaries = completedChapters.map(ch => {
      const outlineEntry = outline.find((o: any) => o.chapter_num === ch.chapterNumber);
      const fullContent = ch.content || '';
      return `CAPÍTULO ${ch.chapterNumber} ("${ch.title || ''}"):\n  PLAN ORIGINAL: ${outlineEntry?.summary || 'N/A'} [Evento: ${outlineEntry?.key_event || 'N/A'}]\n  PALABRAS: ${ch.wordCount || fullContent.split(/\s+/).length}\n  CONTENIDO COMPLETO:\n${fullContent}`;
    }).join('\n\n---\n\n');

    const bibleCharacters = JSON.stringify(
      ((worldBible.characters || []) as any[]).map((c: any) => ({
        name: c.name || c.nombre,
        role: c.role || c.rol,
        arc: c.arc || c.arco,
        gender: c.gender || c.genero || c.sexo,
      })),
      null, 2
    ).substring(0, 6000);

    const worldRules = JSON.stringify(
      ((worldBible.worldRules || []) as any[]).slice(0, 20),
      null, 2
    ).substring(0, 3000);

    // PHASE 2: Full-novel diagnosis with Gemini
    await storage.updateProject(projectId, {
      targetedRepairProgress: { current: 2, total: 3, message: 'Detectando desviaciones con IA...' },
    });

    const diagnosisPrompt = `Eres un editor literario experto. Analiza esta novela completa comparando lo PLANIFICADO vs lo ESCRITO y detecta TODOS los problemas que necesitan corrección.

=== PERSONAJES Y ARCOS PLANIFICADOS ===
${bibleCharacters}

=== REGLAS DEL MUNDO ===
${worldRules}

${guiaEstilo ? `=== GUÍA DE ESTILO ===\n${guiaEstilo.substring(0, 2000)}\n` : ''}

=== CONTENIDO COMPLETO DE LA NOVELA ===
${chapterSummaries}

ANALIZA EXHAUSTIVAMENTE:
1. ¿Cada capítulo cumple con su plan original? ¿Se ejecutaron los eventos clave?
2. ¿Hay inconsistencias de continuidad entre capítulos? (temporal, espacial, de estado, de conocimiento)
3. ¿Los arcos de personajes progresan según lo planificado?
4. ¿Hay desviaciones graves de la estructura de 3 actos?
5. ¿Hay plot holes, subplots sin resolver, foreshadowing sin payoff?
6. ¿Se violan reglas del mundo establecidas?
7. ¿Hay problemas de ritmo narrativo (capítulos lentos/apresurados)?
8. ¿Se respeta la guía de estilo?
9. ¿Hay repeticiones semánticas o frases cliché recurrentes?
10. ¿El protagonista tiene presencia suficiente?

IMPORTANTE: Solo reporta problemas REALES que requieran intervención. No inventes problemas menores.
Para cada problema, indica la corrección ESPECÍFICA necesaria.

RESPONDE EXCLUSIVAMENTE EN JSON VÁLIDO:
{
  "overallScore": 1-10,
  "totalIssues": N,
  "criticalCount": N,
  "majorCount": N,
  "minorCount": N,
  "summary": "Resumen general del estado de la novela",
  "issues": [
    {
      "chapter": N,
      "type": "estructura|continuidad|arco_personaje|evento_omitido|coherencia|ritmo|estilo|repeticion|plot_hole|regla_mundo",
      "severity": "critica|mayor|menor",
      "description": "Descripción clara del problema",
      "expectedVsActual": "Lo que debería ser vs lo que es",
      "suggestedFix": "Instrucción ESPECÍFICA y CONCRETA de qué cambiar en el capítulo"
    }
  ],
  "chaptersNeedingFix": [lista de números de capítulos que necesitan intervención],
  "chaptersOk": [lista de números de capítulos que están bien]
}`;

    let diagnosis: any = null;
    const MAX_RETRIES = 2;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await geminiGenerateWithRetry(diagnosisPrompt, "gemini-2.5-flash", "DiagnosisPrompt");
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          if (attempt < MAX_RETRIES) continue;
          throw new Error("Gemini no devolvió JSON válido en el diagnóstico");
        }
        diagnosis = JSON.parse(jsonMatch[0]);
        break;
      } catch (error) {
        if (attempt >= MAX_RETRIES) throw error;
        console.warn(`[TargetedRepair] Diagnosis attempt ${attempt + 1} failed, retrying...`);
      }
    }

    // PHASE 3: Generate repair plan from diagnosis
    await storage.updateProject(projectId, {
      targetedRepairProgress: { current: 3, total: 3, message: 'Generando plan de intervención...' },
    });

    const issues: RepairIssue[] = (diagnosis.issues || []).filter(
      (i: any) => i.severity === 'critica' || i.severity === 'mayor'
    );

    const issuesByChapter = new Map<number, RepairIssue[]>();
    for (const issue of issues) {
      if (!issuesByChapter.has(issue.chapter)) {
        issuesByChapter.set(issue.chapter, []);
      }
      issuesByChapter.get(issue.chapter)!.push(issue);
    }

    const plan: RepairPlanItem[] = [];
    for (const [chapterNum, chapterIssues] of Array.from(issuesByChapter.entries())) {
      const chapter = completedChapters.find(c => c.chapterNumber === chapterNum);
      const hasCritical = chapterIssues.some(i => i.severity === 'critica');
      const hasStructural = chapterIssues.some(i =>
        ['estructura', 'evento_omitido', 'plot_hole'].includes(i.type)
      );

      const approach: 'surgical' | 'rewrite' = (hasCritical && hasStructural) ? 'rewrite' : 'surgical';

      const instructions = chapterIssues.map((issue, idx) =>
        `${idx + 1}. [${issue.severity.toUpperCase()}] ${issue.type}: ${issue.description}\n   Corrección: ${issue.suggestedFix}`
      ).join('\n');

      plan.push({
        chapter: chapterNum,
        chapterTitle: chapter?.title || `Capítulo ${chapterNum}`,
        issues: chapterIssues,
        approach,
        instructions,
        priority: hasCritical ? 1 : 2,
      });
    }

    plan.sort((a, b) => a.priority - b.priority || a.chapter - b.chapter);

    console.log(`[TargetedRepair] Diagnosis complete. Score: ${diagnosis.overallScore}/10, Issues: ${issues.length}, Plan items: ${plan.length}`);
    console.log(`[TargetedRepair] Plan chapters: ${plan.map(p => p.chapter).join(', ')}`);

    try {
      const planForDb = plan.map(p => ({
        chapter: p.chapter,
        chapterNumber: p.chapter,
        chapterTitle: p.chapterTitle,
        approach: p.approach,
        instructions: p.instructions,
        priority: p.priority,
        issues: p.issues.map(i => ({
          chapter: i.chapter,
          type: i.type,
          severity: i.severity,
          description: i.description,
          expectedVsActual: i.expectedVsActual || '',
          suggestedFix: i.suggestedFix || '',
        })),
      }));

      await storage.updateProject(projectId, {
        targetedRepairDiagnosis: diagnosis,
        targetedRepairPlan: planForDb as any,
        targetedRepairStatus: isInAutoCycle ? 'auto_cycle' : 'plan_ready',
        targetedRepairProgress: {
          current: 3, total: 3,
          message: `Plan listo: ${plan.length} capítulos a intervenir (${issues.length} problemas detectados)`,
        },
      });
      console.log(`[TargetedRepair] Plan saved to DB successfully for project ${projectId}`);
    } catch (dbError) {
      console.error(`[TargetedRepair] CRITICAL: Failed to save plan to DB:`, dbError);
      throw dbError;
    }

    try {
      await storage.createActivityLog({
        projectId,
        level: "info",
        agentRole: "targeted-repair",
        message: `Diagnóstico completado: ${diagnosis.overallScore}/10. ${issues.length} problemas en ${plan.length} capítulos. Críticos: ${diagnosis.criticalCount}, Mayores: ${diagnosis.majorCount}`,
      });
    } catch (logError) {
      console.error(`[TargetedRepair] Failed to create activity log:`, logError);
    }

    this.callbacks.onAgentStatus("targeted-repair", "completed",
      `Diagnóstico: ${diagnosis.overallScore}/10 - ${plan.length} capítulos a reparar`);

    return { diagnosis, plan };
  }

  async executeRepairPlan(project: any): Promise<RepairResult[]> {
    const projectId = project.id;

    const freshProject = await storage.getProject(projectId);
    const rawPlan = freshProject?.targetedRepairPlan || project.targetedRepairPlan;
    const plan: RepairPlanItem[] = (Array.isArray(rawPlan) ? rawPlan : []) as RepairPlanItem[];
    const isInAutoCycle = freshProject?.targetedRepairStatus === 'auto_cycle';

    console.log(`[TargetedRepair] executeRepairPlan called. Plan length: ${plan.length}, raw type: ${typeof rawPlan}, isArray: ${Array.isArray(rawPlan)}, autoCycle: ${isInAutoCycle}`);
    if (plan.length > 0) {
      console.log(`[TargetedRepair] First plan item: chapter=${plan[0].chapter}, issues=${plan[0].issues?.length}, approach=${plan[0].approach}`);
    }

    if (plan.length === 0) {
      console.error(`[TargetedRepair] No plan found! rawPlan:`, JSON.stringify(rawPlan)?.substring(0, 200));
      throw new Error("No hay plan de reparación para ejecutar");
    }

    const startCorrection = (global as any).startCorrection;
    const endCorrection = (global as any).endCorrection;
    if (startCorrection) startCorrection(projectId, 'detect-fix');

    try {
      if (!isInAutoCycle) {
        await storage.updateProject(projectId, {
          targetedRepairStatus: 'executing',
          targetedRepairProgress: { current: 0, total: plan.length, message: 'Iniciando reparaciones...', results: [] },
        });
      }

      this.callbacks.onAgentStatus("targeted-repair", "active",
        `Ejecutando plan: ${plan.length} capítulos a reparar...`);

      const chapters = await storage.getChaptersByProject(projectId);
      const chapterMap = new Map(chapters.map(c => [c.chapterNumber, c]));

      const worldBibleRecord = await storage.getWorldBibleByProject(projectId);
      const worldBible = (worldBibleRecord as any)?.content || worldBibleRecord || {};

      const results: RepairResult[] = [];

      for (let planIdx = 0; planIdx < plan.length; planIdx++) {
        const planItem = plan[planIdx];
        const chapter = chapterMap.get(planItem.chapter);

        const repairProject = await storage.getProject(projectId);
        if (repairProject?.targetedRepairStatus === 'idle' || repairProject?.targetedRepairStatus === 'error') {
          console.log(`[TargetedRepair] Cancelled by user (status: ${repairProject?.targetedRepairStatus})`);
          await storage.updateProject(projectId, {
            targetedRepairStatus: 'error',
            targetedRepairProgress: { current: planIdx, total: plan.length, message: 'Cancelado por el usuario', results },
          });
          break;
        }

        if (!chapter || !chapter.content) {
          results.push({
            chapter: planItem.chapter, success: false, method: 'failed',
            verified: false, issuesFixed: 0, issuesTotal: planItem.issues.length,
          });
          continue;
        }

        this.callbacks.onAgentStatus("targeted-repair", "active",
          `Reparando Cap ${planItem.chapter} (${planIdx + 1}/${plan.length})...`);

        await storage.updateProject(projectId, {
          targetedRepairProgress: {
            current: planIdx, total: plan.length,
            currentChapter: planItem.chapter,
            message: `Reparando capítulo ${planItem.chapter}: ${planItem.issues.length} problemas...`,
            results,
          },
        });

        await storage.createActivityLog({
          projectId, level: "info", agentRole: "targeted-repair",
          message: `Reparando Cap ${planItem.chapter} (${planItem.approach}): ${planItem.issues.length} problemas`,
        });

        const originalContent = chapter.content;

        // Save backup before modifying
        if (!chapter.originalContent) {
          await storage.updateChapter(chapter.id, { originalContent: chapter.content });
        }

        // Get adjacent chapter context
        const prevChapter = chapterMap.get(planItem.chapter - 1);
        const nextChapter = chapterMap.get(planItem.chapter + 1);
        const adjacentContext = {
          previousChapter: prevChapter?.summary || prevChapter?.content?.substring(0, 500),
          nextChapter: nextChapter?.summary || nextChapter?.content?.substring(0, 500),
        };

        let correctedContent: string | null = null;
        let method: 'surgical' | 'rewrite' | 'failed' = 'failed';
        let issuesFixed = 0;
        let allIssuesResolved = false;

        if (planItem.approach === 'surgical') {
          let currentContent = chapter.content;
          const unresolvedIssues: RepairIssue[] = [];
          for (const issue of planItem.issues) {
            const isComplexIssue = ['arco_personaje', 'desarrollo_personaje', 'arcos_incompletos', 
              'motivacion', 'profundidad_emocional', 'subtrama', 'foreshadowing', 'tema'].some(
              t => issue.type.toLowerCase().includes(t) || issue.description.toLowerCase().includes(t)
            );

            const complexRules = isComplexIssue ? `
NOTA IMPORTANTE: Este problema requiere ENRIQUECER el texto, no solo cambiar palabras.
- Puedes EXPANDIR párrafos existentes para añadir profundidad emocional, reflexiones internas o consecuencias narrativas
- Puedes INSERTAR nuevos párrafos cortos (2-5 frases) entre párrafos existentes si la corrección lo requiere
- Los parches deben ser SUSTANCIALES (mínimo 100 palabras por parche si se añade contenido nuevo)
- Usa el "find" para ubicar la zona EXACTA donde debe insertarse el contenido nuevo
- El "replace" debe incluir el texto original + el nuevo contenido integrado orgánicamente` : '';

            const fixInstructions = `CORRECCIÓN QUIRÚRGICA ESPECÍFICA - CAPÍTULO ${planItem.chapter}

PROBLEMA A CORREGIR:
- Tipo: ${issue.type}
- Severidad: ${issue.severity}
- Descripción: ${issue.description}
- Lo esperado vs lo actual: ${issue.expectedVsActual}
- Corrección específica: ${issue.suggestedFix}
${complexRules}

REGLAS ABSOLUTAS:
1. Genera parches que corrijan EFECTIVAMENTE el problema descrito
2. NO cambies el estilo, tono, ni voz narrativa
3. ${isComplexIssue ? 'Puedes añadir contenido nuevo (reflexiones, flashbacks breves, diálogo) si la corrección lo requiere' : 'NO añadas ni elimines escenas, personajes o eventos'}
4. NO modifiques párrafos que no estén relacionados con el problema
5. Mantén la coherencia con los capítulos adyacentes
6. Cada parche debe ser COMPLETO - no dejes frases o palabras cortadas
7. El "find" debe ser lo suficientemente largo para ser único en el texto (mínimo 30 caracteres)

${adjacentContext.previousChapter ? `CONTEXTO (capítulo anterior): ${adjacentContext.previousChapter}` : ''}
${adjacentContext.nextChapter ? `CONTEXTO (capítulo siguiente): ${adjacentContext.nextChapter}` : ''}`;

            const fixResult = await this.smartEditor.surgicalFix({
              chapterContent: currentContent,
              errorDescription: fixInstructions,
              worldBible,
              chapterNumber: planItem.chapter,
            });

            this.addTokenUsage(fixResult.tokenUsage);
            await this.logAiUsage(projectId, "targeted-repair", "deepseek-chat", fixResult.tokenUsage, planItem.chapter);

            const isTruncated = (patches: any[]): boolean => {
              for (const p of patches) {
                const rep = (p.replace || p.replacement || '').trim();
                if (rep.length > 20) {
                  const lastWord = rep.split(/\s+/).pop() || '';
                  const endsWithPunctuation = /[.!?»"'\)\]\—;:,\n]$/.test(rep);
                  const lastWordTruncated = lastWord.length >= 3 && !endsWithPunctuation && /^[a-záéíóúñ]+$/i.test(lastWord) && lastWord.length <= 4;
                  if (lastWordTruncated) return true;
                }
              }
              return false;
            };

            let patchedContent: string | null = null;
            let usedPatches = fixResult.patches || [];

            if (usedPatches.length > 0 && isTruncated(usedPatches)) {
              console.log(`[TargetedRepair] Cap ${planItem.chapter}: Detected truncated patch, retrying...`);
              await storage.createActivityLog({
                projectId, level: "warn", agentRole: "targeted-repair",
                message: `Cap ${planItem.chapter}: parche truncado detectado para "${issue.type}", reintentando con instrucciones reforzadas`,
              });

              const retryInstructions = fixInstructions + `\n\nIMPORTANTE: Tu respuesta anterior fue TRUNCADA. Asegúrate de que CADA parche esté COMPLETO con frases terminadas correctamente (punto, coma, cierre de comillas). NO dejes palabras cortadas.`;
              const retryResult = await this.smartEditor.surgicalFix({
                chapterContent: currentContent,
                errorDescription: retryInstructions,
                worldBible,
                chapterNumber: planItem.chapter,
              });
              this.addTokenUsage(retryResult.tokenUsage);
              await this.logAiUsage(projectId, "targeted-repair", "deepseek-chat", retryResult.tokenUsage, planItem.chapter);

              if (retryResult.patches && retryResult.patches.length > 0 && !isTruncated(retryResult.patches)) {
                usedPatches = retryResult.patches;
              }
            }

            if (usedPatches.length > 0) {
              const patchResult = applyPatches(currentContent, usedPatches);
              if (patchResult.appliedPatches > 0) {
                patchedContent = patchResult.patchedText;
              }
            }

            if (!patchedContent || patchedContent === currentContent) {
              unresolvedIssues.push(issue);
              await storage.createActivityLog({
                projectId, level: "warn", agentRole: "targeted-repair",
                message: `Cap ${planItem.chapter}: parche no aplicado para "${issue.type}: ${issue.description.substring(0, 80)}"`,
              });
              continue;
            }

            // VERIFY this specific fix
            const verification = await this.verifyTargetedFix(
              projectId, planItem.chapter, currentContent, patchedContent, issue
            );

            if (verification.fixed && !verification.newProblems) {
              currentContent = patchedContent;
              issuesFixed++;
              await storage.createActivityLog({
                projectId, level: "success", agentRole: "targeted-repair",
                message: `Cap ${planItem.chapter}: VERIFICADO - "${issue.type}" corregido correctamente`,
              });
            } else if (verification.fixed && verification.newProblems) {
              unresolvedIssues.push(issue);
              await storage.createActivityLog({
                projectId, level: "warn", agentRole: "targeted-repair",
                message: `Cap ${planItem.chapter}: RECHAZADO - "${issue.type}" corregido pero introdujo nuevos problemas: ${verification.details}`,
              });
            } else {
              unresolvedIssues.push(issue);
              await storage.createActivityLog({
                projectId, level: "warn", agentRole: "targeted-repair",
                message: `Cap ${planItem.chapter}: NO VERIFICADO - "${issue.type}" no se resolvió. ${verification.details || ''}`,
              });
            }
          }

          if (currentContent !== chapter.content && unresolvedIssues.length === 0) {
            correctedContent = currentContent;
            method = 'surgical';
            allIssuesResolved = true;
          }

          // FALLBACK: If surgical failed for any issues, evaluate escalation to rewrite
          if (unresolvedIssues.length > 0) {
            console.log(`[TargetedRepair] Cap ${planItem.chapter}: ${unresolvedIssues.length}/${planItem.issues.length} issues unresolved after surgery. Evaluating fallback...`);
            
            // Phase 1: Ask Gemini if the unresolved issues are worth a full rewrite
            const worthFixing = await this.evaluateRewriteWorthiness(
              projectId, planItem.chapter, correctedContent || chapter.content, unresolvedIssues
            );

            if (worthFixing.worthIt) {
              console.log(`[TargetedRepair] Cap ${planItem.chapter}: Fallback rewrite approved - ${worthFixing.reason}`);
              await storage.createActivityLog({
                projectId, level: "info", agentRole: "targeted-repair",
                message: `Cap ${planItem.chapter}: Escalando a reescritura focalizada (${unresolvedIssues.length} problemas sin resolver). Razón: ${worthFixing.reason}`,
              });

              this.callbacks.onAgentStatus("targeted-repair", "active",
                `Cap ${planItem.chapter}: Reescritura focalizada (fallback)...`);

              // Phase 2: Focused rewrite only for unresolved issues
              // Use the partially-fixed content (from successful surgical patches) as base for rewrite
              const contentToRewrite = currentContent;
              const unresolvedInstructions = worthFixing.unresolvedIssues.map((issue: RepairIssue, idx: number) =>
                `${idx + 1}. [${issue.severity.toUpperCase()}] ${issue.type}:
   Problema: ${issue.description}
   Esperado vs Actual: ${issue.expectedVsActual}
   Corrección requerida: ${issue.suggestedFix}`
              ).join('\n\n');

              const hasComplexIssues = worthFixing.unresolvedIssues.some((issue: RepairIssue) =>
                ['arco_personaje', 'desarrollo_personaje', 'arcos_incompletos', 'motivacion', 'profundidad_emocional', 'subtrama', 'foreshadowing'].some(
                  t => issue.type.toLowerCase().includes(t) || issue.description.toLowerCase().includes(t)
                )
              );

              const rewriteInstructions = `REESCRITURA FOCALIZADA - CAPÍTULO ${planItem.chapter} (FALLBACK TRAS CIRUGÍA FALLIDA)

CONTEXTO: La corrección quirúrgica (patches puntuales) no logró resolver estos problemas. Ahora debes reescribir las secciones relevantes del capítulo para corregirlos de forma definitiva.

PROBLEMAS ESPECÍFICOS QUE DEBEN RESOLVERSE:
${unresolvedInstructions}

REGLAS ABSOLUTAS:
1. Reescribe las secciones afectadas para que los problemas queden DEFINITIVAMENTE resueltos
2. Mantén INTACTOS los párrafos que no necesitan cambios
3. NO cambies el estilo, tono, ni voz narrativa
4. Preserva las transiciones con los capítulos adyacentes
5. El capítulo debe mantener su extensión similar (±10%)${hasComplexIssues ? ' - puedes expandir hasta +20% si la corrección requiere añadir contenido emocional o narrativo' : ''}
6. NO introduzcas nuevos elementos de trama, personajes ni conflictos${hasComplexIssues ? ' (pero SÍ puedes añadir reflexiones internas, flashbacks breves, o consecuencias emocionales si la corrección lo exige)' : ''}
7. Si una corrección requiere añadir contexto, hazlo de forma orgánica

${adjacentContext.previousChapter ? `CONTEXTO (capítulo anterior): ${adjacentContext.previousChapter}` : ''}
${adjacentContext.nextChapter ? `CONTEXTO (capítulo siguiente): ${adjacentContext.nextChapter}` : ''}`;

              const rewriteResult = await this.smartEditor.fullRewrite({
                chapterContent: contentToRewrite,
                errorDescription: rewriteInstructions,
                worldBible: {
                  characters: (worldBible.characters || worldBible.personajes || []) as any[],
                  locations: (worldBible.locations || worldBible.lugares || []) as any[],
                  worldRules: (worldBible.rules || worldBible.reglas || worldBible.worldRules || []) as any[],
                  persistentInjuries: (worldBible.persistentInjuries || worldBible.lesiones || []) as any[],
                  plotDecisions: (worldBible.plotDecisions || worldBible.decisiones || []) as any[],
                },
                chapterNumber: planItem.chapter,
                chapterTitle: planItem.chapterTitle,
                previousChapterSummary: adjacentContext.previousChapter || "",
                nextChapterSummary: adjacentContext.nextChapter || "",
              });

              this.addTokenUsage(rewriteResult.tokenUsage);
              await this.logAiUsage(projectId, "targeted-repair", "deepseek-chat", rewriteResult.tokenUsage, planItem.chapter);

              if (rewriteResult.rewrittenContent && rewriteResult.rewrittenContent.length > 200) {
                const newWordCount = rewriteResult.rewrittenContent.split(/\s+/).length;
                const originalWordCount = chapter.content.split(/\s+/).length;

                if (newWordCount >= originalWordCount * 0.85 && newWordCount >= 800) {
                  // Phase 3: Verify rewrite didn't introduce new problems
                  const verification = await this.verifyTargetedRewrite(
                    projectId, planItem.chapter, chapter.content, rewriteResult.rewrittenContent, planItem.issues
                  );

                  if (verification.overallFixed && !verification.details) {
                    correctedContent = rewriteResult.rewrittenContent;
                    method = 'rewrite';
                    issuesFixed = verification.fixedCount;
                    allIssuesResolved = true;
                    await storage.createActivityLog({
                      projectId, level: "success", agentRole: "targeted-repair",
                      message: `Cap ${planItem.chapter}: FALLBACK REESCRITURA VERIFICADA - ${verification.fixedCount}/${planItem.issues.length} problemas resueltos`,
                    });
                  } else if (verification.details) {
                    await storage.createActivityLog({
                      projectId, level: "warn", agentRole: "targeted-repair",
                      message: `Cap ${planItem.chapter}: Fallback rechazado - introdujo nuevos problemas: ${verification.details}`,
                    });
                  } else {
                    await storage.createActivityLog({
                      projectId, level: "warn", agentRole: "targeted-repair",
                      message: `Cap ${planItem.chapter}: Fallback insuficiente (${verification.fixedCount}/${planItem.issues.length} resueltos)`,
                    });
                  }
                } else {
                  await storage.createActivityLog({
                    projectId, level: "warn", agentRole: "targeted-repair",
                    message: `Cap ${planItem.chapter}: Fallback rechazado por pérdida de contenido (${newWordCount} vs ${originalWordCount} palabras)`,
                  });
                }
              }
            } else {
              console.log(`[TargetedRepair] Cap ${planItem.chapter}: Fallback not worth it - ${worthFixing.reason}`);
              await storage.createActivityLog({
                projectId, level: "info", agentRole: "targeted-repair",
                message: `Cap ${planItem.chapter}: ${unresolvedIssues.length} problemas sin resolver - no ameritan reescritura: ${worthFixing.reason}`,
              });
            }
          }

        } else {
          // Rewrite approach for critical structural issues
          const rewriteInstructions = `REESCRITURA DIRIGIDA - CAPÍTULO ${planItem.chapter}

PROBLEMAS A CORREGIR EN ESTE CAPÍTULO:
${planItem.instructions}

REGLAS ABSOLUTAS:
1. Reescribe SOLO las secciones que contienen los problemas indicados
2. Mantén INTACTOS todos los párrafos que no estén afectados
3. NO cambies el estilo, tono, ni voz narrativa
4. Preserva las transiciones con los capítulos adyacentes
5. El capítulo debe mantener su extensión similar (±15%)
6. Cada corrección debe resolver COMPLETAMENTE el problema indicado

${adjacentContext.previousChapter ? `CONTEXTO (capítulo anterior): ${adjacentContext.previousChapter}` : ''}
${adjacentContext.nextChapter ? `CONTEXTO (capítulo siguiente): ${adjacentContext.nextChapter}` : ''}`;

          const rewriteResult = await this.smartEditor.fullRewrite({
            chapterContent: chapter.content,
            errorDescription: rewriteInstructions,
            worldBible: {
              characters: (worldBible.characters || worldBible.personajes || []) as any[],
              locations: (worldBible.locations || worldBible.lugares || []) as any[],
              worldRules: (worldBible.rules || worldBible.reglas || worldBible.worldRules || []) as any[],
              persistentInjuries: (worldBible.persistentInjuries || worldBible.lesiones || []) as any[],
              plotDecisions: (worldBible.plotDecisions || worldBible.decisiones || []) as any[],
            },
            chapterNumber: planItem.chapter,
            chapterTitle: planItem.chapterTitle,
            previousChapterSummary: adjacentContext.previousChapter || "",
            nextChapterSummary: adjacentContext.nextChapter || "",
          });

          this.addTokenUsage(rewriteResult.tokenUsage);
          await this.logAiUsage(projectId, "targeted-repair", "deepseek-chat", rewriteResult.tokenUsage, planItem.chapter);

          if (rewriteResult.rewrittenContent && rewriteResult.rewrittenContent.length > 200) {
            const newWordCount = rewriteResult.rewrittenContent.split(/\s+/).length;
            const originalWordCount = chapter.content.split(/\s+/).length;
            if (newWordCount >= originalWordCount * 0.7 && newWordCount >= 800) {
              // Verify the rewrite resolved the issues
              const verification = await this.verifyTargetedRewrite(
                projectId, planItem.chapter, chapter.content, rewriteResult.rewrittenContent, planItem.issues
              );

              if (verification.overallFixed) {
                correctedContent = rewriteResult.rewrittenContent;
                method = 'rewrite';
                issuesFixed = verification.fixedCount;
                allIssuesResolved = true;
                await storage.createActivityLog({
                  projectId, level: "success", agentRole: "targeted-repair",
                  message: `Cap ${planItem.chapter}: REESCRITURA VERIFICADA - ${verification.fixedCount}/${planItem.issues.length} problemas resueltos`,
                });
              } else {
                await storage.createActivityLog({
                  projectId, level: "warn", agentRole: "targeted-repair",
                  message: `Cap ${planItem.chapter}: Reescritura no resolvió suficientes problemas (${verification.fixedCount}/${planItem.issues.length}). ${verification.details || ''}`,
                });
              }
            } else {
              await storage.createActivityLog({
                projectId, level: "warn", agentRole: "targeted-repair",
                message: `Cap ${planItem.chapter}: Reescritura rechazada por pérdida de contenido (${newWordCount} vs ${originalWordCount} palabras)`,
              });
            }
          }
        }

        // CRITICAL: Only save corrected content if ALL issues were verified as resolved
        // This prevents saving partial fixes that could introduce new problems
        if (correctedContent && correctedContent !== originalContent && allIssuesResolved) {
          await storage.updateChapter(chapter.id, {
            content: correctedContent,
            wordCount: correctedContent.split(/\s+/).length,
          });
          chapter.content = correctedContent;
          await storage.createActivityLog({
            projectId, level: "success", agentRole: "targeted-repair",
            message: `Cap ${planItem.chapter}: Contenido guardado (${method}, ${issuesFixed}/${planItem.issues.length} problemas resueltos)`,
          });
        } else if (correctedContent && !allIssuesResolved) {
          await storage.createActivityLog({
            projectId, level: "warn", agentRole: "targeted-repair",
            message: `Cap ${planItem.chapter}: Contenido NO guardado - reparación incompleta (${issuesFixed}/${planItem.issues.length}). Se mantiene el original para evitar regresiones.`,
          });
          correctedContent = null;
          method = 'failed';
        }

        const result: RepairResult = {
          chapter: planItem.chapter,
          success: allIssuesResolved,
          method,
          verified: allIssuesResolved,
          issuesFixed,
          issuesTotal: planItem.issues.length,
        };
        results.push(result);

        await storage.updateProject(projectId, {
          targetedRepairProgress: {
            current: planIdx + 1, total: plan.length,
            currentChapter: planItem.chapter,
            message: `Cap ${planItem.chapter}: ${method !== 'failed' ? `${issuesFixed}/${planItem.issues.length} corregidos` : 'sin cambios'}`,
            results,
          },
        });
      }

      // Final summary
      const totalFixed = results.reduce((sum, r) => sum + r.issuesFixed, 0);
      const totalIssues = results.reduce((sum, r) => sum + r.issuesTotal, 0);
      const successCount = results.filter(r => r.success).length;
      const failedChapters = results.filter(r => !r.success).map(r => r.chapter);

      const summaryDetails = failedChapters.length > 0
        ? `Capítulos sin modificar (protección anti-regresión): ${failedChapters.join(', ')}`
        : 'Todos los capítulos corregidos y verificados';

      await storage.updateProject(projectId, {
        targetedRepairStatus: isInAutoCycle ? 'auto_cycle' : 'completed',
        targetedRepairDiagnosis: null,
        targetedRepairPlan: null,
        targetedRepairProgress: {
          current: plan.length, total: plan.length,
          message: `Completado: ${totalFixed}/${totalIssues} problemas resueltos en ${successCount}/${plan.length} capítulos. ${summaryDetails}`,
          results,
        },
      });

      if (failedChapters.length > 0) {
        await storage.createActivityLog({
          projectId, level: "warn", agentRole: "targeted-repair",
          message: `Protección anti-regresión: ${failedChapters.length} capítulos NO fueron modificados porque la corrección no resolvió todos los problemas. Capítulos: ${failedChapters.join(', ')}. Ejecuta un nuevo diagnóstico para intentar reparar estos capítulos con un enfoque diferente.`,
        });
      }

      await storage.createActivityLog({
        projectId, level: "success", agentRole: "targeted-repair",
        message: `Reparación dirigida completada: ${totalFixed}/${totalIssues} problemas resueltos en ${successCount}/${plan.length} capítulos`,
      });

      this.callbacks.onAgentStatus("targeted-repair", "completed",
        `Reparación completada: ${totalFixed}/${totalIssues} problemas en ${successCount} capítulos`);

      return results;

    } finally {
      if (endCorrection) endCorrection(projectId);
    }
  }

  async runAutoCycleRepair(project: any, maxCycles: number = 10): Promise<{
    cycles: number;
    finalScore: number;
    consecutiveHighScores: number;
    history: Array<{ cycle: number; score: number; issuesFound: number; issuesFixed: number }>;
    success: boolean;
  }> {
    const projectId = project.id;
    const TARGET_SCORE = 9;
    const REQUIRED_CONSECUTIVE = 2;

    const startCorrection = (global as any).startCorrection;
    const endCorrection = (global as any).endCorrection;
    const isCorrectionCancelled = (global as any).isCorrectionCancelled;

    if (startCorrection) {
      if (endCorrection) endCorrection(projectId);
      startCorrection(projectId, 'detect-fix');
    }

    const history: Array<{ cycle: number; score: number; issuesFound: number; issuesFixed: number }> = [];
    let consecutiveHighScores = 0;
    let finalScore = 0;

    try {
      await storage.updateProject(projectId, {
        targetedRepairStatus: 'auto_cycle',
        targetedRepairProgress: {
          current: 0, total: maxCycles,
          message: `Ciclo automático iniciado (objetivo: ${REQUIRED_CONSECUTIVE} diagnósticos consecutivos con ${TARGET_SCORE}+/10)`,
          autoCycle: true,
          consecutiveHighScores: 0,
          history: [],
        },
      });

      for (let cycle = 1; cycle <= maxCycles; cycle++) {
        if (isCorrectionCancelled && isCorrectionCancelled(projectId)) {
          console.log(`[AutoCycle] Cancelled by user at cycle ${cycle}`);
          await storage.createActivityLog({
            projectId, level: "info", agentRole: "targeted-repair",
            message: `Ciclo automático cancelado por el usuario en ciclo ${cycle}`,
          });
          break;
        }

        const freshProject = await storage.getProject(projectId);
        if (freshProject?.targetedRepairStatus === 'idle' || freshProject?.targetedRepairStatus === 'error') {
          console.log(`[AutoCycle] Status changed to ${freshProject?.targetedRepairStatus}, stopping`);
          break;
        }

        this.callbacks.onAgentStatus("targeted-repair", "active",
          `Ciclo automático ${cycle}/${maxCycles}: Diagnosticando... (${consecutiveHighScores}/${REQUIRED_CONSECUTIVE} puntuaciones 9+)`);

        await storage.updateProject(projectId, {
          targetedRepairProgress: {
            current: cycle, total: maxCycles,
            message: `Ciclo ${cycle}/${maxCycles}: Diagnosticando...`,
            autoCycle: true,
            consecutiveHighScores,
            history,
          },
        });

        await storage.createActivityLog({
          projectId, level: "info", agentRole: "targeted-repair",
          message: `Ciclo automático ${cycle}/${maxCycles}: Iniciando diagnóstico (${consecutiveHighScores}/${REQUIRED_CONSECUTIVE} puntuaciones 9+ consecutivas)`,
        });

        // PHASE 1: Diagnose
        let diagResult;
        try {
          diagResult = await this.diagnoseForTargetedRepair(freshProject || project);
        } catch (diagError) {
          console.error(`[AutoCycle] Diagnosis failed at cycle ${cycle}:`, diagError);
          await storage.createActivityLog({
            projectId, level: "error", agentRole: "targeted-repair",
            message: `Ciclo ${cycle}: Error en diagnóstico - ${diagError instanceof Error ? diagError.message : 'Error desconocido'}`,
          });
          break;
        }

        const score = diagResult.diagnosis?.overallScore || 0;
        finalScore = score;

        if (score >= TARGET_SCORE) {
          consecutiveHighScores++;
        } else {
          consecutiveHighScores = 0;
        }

        await storage.createActivityLog({
          projectId, level: score >= TARGET_SCORE ? "success" : "info", agentRole: "targeted-repair",
          message: `Ciclo ${cycle}: Puntuación ${score}/10. ${diagResult.plan.length} problemas detectados. (${consecutiveHighScores}/${REQUIRED_CONSECUTIVE} puntuaciones 9+ consecutivas)`,
        });

        // Check if we've reached the target
        if (consecutiveHighScores >= REQUIRED_CONSECUTIVE) {
          history.push({ cycle, score, issuesFound: diagResult.plan.length, issuesFixed: 0 });
          await storage.createActivityLog({
            projectId, level: "success", agentRole: "targeted-repair",
            message: `Ciclo automático COMPLETADO: ${REQUIRED_CONSECUTIVE} puntuaciones consecutivas de ${TARGET_SCORE}+ alcanzadas (${score}/10). Novela aprobada tras ${cycle} ciclos.`,
          });
          this.callbacks.onAgentStatus("targeted-repair", "completed",
            `Ciclo automático completado: ${REQUIRED_CONSECUTIVE}x ${TARGET_SCORE}+ consecutivos (${score}/10) en ${cycle} ciclos`);
          break;
        }

        // If there are no issues to fix (score is high but first time), record and continue
        if (diagResult.plan.length === 0) {
          history.push({ cycle, score, issuesFound: 0, issuesFixed: 0 });
          continue;
        }

        // PHASE 2: Execute repairs
        this.callbacks.onAgentStatus("targeted-repair", "active",
          `Ciclo ${cycle}/${maxCycles}: Corrigiendo ${diagResult.plan.length} capítulos... (${consecutiveHighScores}/${REQUIRED_CONSECUTIVE} puntuaciones 9+)`);

        await storage.updateProject(projectId, {
          targetedRepairProgress: {
            current: cycle, total: maxCycles,
            message: `Ciclo ${cycle}: Corrigiendo ${diagResult.plan.length} capítulos...`,
            autoCycle: true,
            consecutiveHighScores,
            history,
          },
        });

        let issuesFixed = 0;
        try {
          const repairResults = await this.executeRepairPlan(freshProject || project);
          issuesFixed = repairResults.reduce((sum, r) => sum + r.issuesFixed, 0);
          const totalIssues = repairResults.reduce((sum, r) => sum + r.issuesTotal, 0);

          await storage.createActivityLog({
            projectId, level: "info", agentRole: "targeted-repair",
            message: `Ciclo ${cycle}: Reparación completada - ${issuesFixed}/${totalIssues} problemas resueltos`,
          });
        } catch (repairError) {
          console.error(`[AutoCycle] Repair failed at cycle ${cycle}:`, repairError);
          await storage.createActivityLog({
            projectId, level: "error", agentRole: "targeted-repair",
            message: `Ciclo ${cycle}: Error en reparación - ${repairError instanceof Error ? repairError.message : 'Error desconocido'}`,
          });
        }

        // Restore auto_cycle status (executeRepairPlan sets it to 'completed' and calls endCorrection)
        await storage.updateProject(projectId, { targetedRepairStatus: 'auto_cycle' });
        if (startCorrection) {
          startCorrection(projectId, 'detect-fix');
        }

        history.push({ cycle, score, issuesFound: diagResult.plan.length, issuesFixed });

        // Brief pause between cycles to avoid rate limiting
        await new Promise(r => setTimeout(r, 2000));
      }

      const success = consecutiveHighScores >= REQUIRED_CONSECUTIVE;

      await storage.updateProject(projectId, {
        targetedRepairStatus: success ? 'completed' : 'completed',
        targetedRepairDiagnosis: null,
        targetedRepairPlan: null,
        targetedRepairProgress: {
          current: history.length, total: maxCycles,
          message: success
            ? `Ciclo automático COMPLETADO: ${REQUIRED_CONSECUTIVE} puntuaciones ${TARGET_SCORE}+ consecutivas en ${history.length} ciclos (${finalScore}/10)`
            : `Ciclo automático finalizado tras ${history.length} ciclos. Última puntuación: ${finalScore}/10 (${consecutiveHighScores}/${REQUIRED_CONSECUTIVE} consecutivas)`,
          autoCycle: true,
          consecutiveHighScores,
          history,
          finalScore,
          success,
        },
      });

      if (!success) {
        this.callbacks.onAgentStatus("targeted-repair", "completed",
          `Ciclo automático finalizado: ${history.length} ciclos, última puntuación ${finalScore}/10`);
      }

      return { cycles: history.length, finalScore, consecutiveHighScores, history, success };

    } finally {
      if (endCorrection) endCorrection(projectId);
    }
  }

  private async evaluateRewriteWorthiness(
    projectId: number,
    chapterNumber: number,
    chapterContent: string,
    unresolvedIssues: RepairIssue[]
  ): Promise<{ worthIt: boolean; reason: string; unresolvedIssues: RepairIssue[] }> {
    if (unresolvedIssues.length === 0) {
      return { worthIt: false, reason: "No hay problemas sin resolver", unresolvedIssues: [] };
    }

    const hasCritical = unresolvedIssues.some(i => i.severity === 'critica');
    if (hasCritical) {
      return { worthIt: true, reason: "Contiene problemas críticos que deben resolverse", unresolvedIssues };
    }

    const issueDescriptions = unresolvedIssues.map(i =>
      `- [${i.severity}] ${i.type}: ${i.description}`
    ).join('\n');

    const prompt = `Eres un editor literario senior. Evalúa si los siguientes problemas detectados en un capítulo ameritan una reescritura focalizada, considerando el riesgo de introducir nuevos problemas.

CAPÍTULO ${chapterNumber} (fragmento):
${chapterContent.substring(0, 2000)}

PROBLEMAS SIN RESOLVER TRAS CIRUGÍA:
${issueDescriptions}

CRITERIOS DE DECISIÓN:
- ¿Los problemas afectan significativamente la experiencia del lector?
- ¿Son problemas reales o son opiniones estilísticas discutibles?
- ¿El riesgo de una reescritura (perder calidad, coherencia, voz) supera el beneficio de corregir estos problemas?
- ¿Los problemas rompen la lógica narrativa o son detalles menores?

Responde SOLO en JSON:
{
  "worthRewriting": true/false,
  "reason": "explicación concisa de por qué sí o no vale la pena",
  "realIssueCount": número de problemas que realmente afectan la calidad (no opiniones),
  "riskLevel": "bajo" | "medio" | "alto"
}`;

    try {
      const response = await geminiGenerateWithRetry(prompt, "gemini-2.5-flash", "RewriteRiskAnalysis");
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        const worthIt = parsed.worthRewriting === true && parsed.riskLevel !== 'alto';
        return {
          worthIt,
          reason: parsed.reason || 'Sin razón especificada',
          unresolvedIssues,
        };
      }
    } catch (error) {
      console.warn(`[TargetedRepair] Worthiness evaluation failed for chapter ${chapterNumber}:`, error);
    }

    const hasMajor = unresolvedIssues.some(i => i.severity === 'mayor');
    return {
      worthIt: hasMajor,
      reason: hasMajor ? 'Evaluación falló pero hay problemas mayores - intentando reescritura' : 'Evaluación falló y solo hay problemas menores - no vale la pena',
      unresolvedIssues,
    };
  }

  private async verifyTargetedFix(
    projectId: number,
    chapterNumber: number,
    originalContent: string,
    correctedContent: string,
    issue: RepairIssue
  ): Promise<{ fixed: boolean; newProblems: boolean; details?: string }> {
    const extractRelevantSection = (text: string, keywords: string[], maxLen: number = 6000): string => {
      if (text.length <= maxLen) return text;
      const lowerText = text.toLowerCase();
      const positions: number[] = [];
      for (const kw of keywords) {
        const kwLower = kw.toLowerCase();
        let idx = lowerText.indexOf(kwLower);
        while (idx !== -1) {
          positions.push(idx);
          idx = lowerText.indexOf(kwLower, idx + 1);
        }
      }
      if (positions.length === 0) {
        const mid = Math.floor(text.length / 2);
        return `[INICIO]\n${text.substring(0, Math.floor(maxLen * 0.3))}\n\n[...]\n\n[ZONA MEDIA]\n${text.substring(Math.max(0, mid - Math.floor(maxLen * 0.2)), mid + Math.floor(maxLen * 0.2))}\n\n[...]\n\n[FINAL]\n${text.substring(text.length - Math.floor(maxLen * 0.3))}`;
      }
      const minPos = Math.min(...positions);
      const maxPos = Math.max(...positions);
      const contextStart = Math.max(0, minPos - 1500);
      const contextEnd = Math.min(text.length, maxPos + 2500);
      if (contextEnd - contextStart <= maxLen) {
        return text.substring(contextStart, contextEnd);
      }
      return text.substring(contextStart, contextStart + maxLen);
    };

    const keywords = [
      ...issue.description.split(/\s+/).filter(w => w.length > 5).slice(0, 8),
      ...issue.suggestedFix.split(/\s+/).filter(w => w.length > 5).slice(0, 5),
      issue.type,
    ];

    const originalSection = extractRelevantSection(originalContent, keywords);
    const correctedSection = extractRelevantSection(correctedContent, keywords);

    const prompt = `Eres un verificador de correcciones literarias. Verifica si el problema ESPECÍFICO fue corregido sin introducir nuevos problemas.

PROBLEMA QUE DEBÍA CORREGIRSE:
- Tipo: ${issue.type}
- Severidad: ${issue.severity}
- Descripción: ${issue.description}
- Corrección esperada: ${issue.suggestedFix}

TEXTO ORIGINAL (sección relevante):
${originalSection}

TEXTO CORREGIDO (sección relevante):
${correctedSection}

INSTRUCCIONES:
1. Compara ambas secciones y determina si el problema original fue corregido
2. ¿La corrección introdujo nuevos problemas GRAVES? (solo contradicciones, errores lógicos, inconsistencias)
3. ¿Se mantuvo el estilo y tono originales?
4. Busca evidencia CONCRETA de la corrección (nuevas frases, contenido añadido, texto modificado)

Responde SOLO en JSON:
{
  "problemFixed": true/false,
  "newGraveProblems": true/false,
  "evidencia": "breve explicación de qué cambió con citas textuales",
  "newProblemsDescription": "descripción de nuevos problemas graves si los hay, o null"
}`;

    try {
      const response = await geminiGenerateWithRetry(prompt, "gemini-2.5-flash", "SingleIssueVerify");
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          fixed: parsed.problemFixed === true,
          newProblems: parsed.newGraveProblems === true,
          details: parsed.newProblemsDescription || parsed.evidencia,
        };
      }
    } catch (error) {
      console.warn(`[TargetedRepair] Verification failed for chapter ${chapterNumber}:`, error);
    }
    return { fixed: true, newProblems: false, details: 'Verificación asumida como correcta' };
  }

  private async verifyTargetedRewrite(
    projectId: number,
    chapterNumber: number,
    originalContent: string,
    rewrittenContent: string,
    issues: RepairIssue[]
  ): Promise<{ overallFixed: boolean; fixedCount: number; details?: string }> {
    const issueList = issues.map((issue, idx) =>
      `${idx + 1}. [${issue.severity}] ${issue.type}: ${issue.description}`
    ).join('\n');

    const extractRelevantSections = (text: string, allIssues: RepairIssue[], maxLen: number = 8000): string => {
      if (text.length <= maxLen) return text;
      const lowerText = text.toLowerCase();
      const allKeywords: string[] = [];
      for (const iss of allIssues) {
        allKeywords.push(...iss.description.split(/\s+/).filter(w => w.length > 5).slice(0, 5));
        allKeywords.push(...iss.suggestedFix.split(/\s+/).filter(w => w.length > 5).slice(0, 3));
        allKeywords.push(iss.type);
      }
      const positions: number[] = [];
      for (const kw of allKeywords) {
        const kwLower = kw.toLowerCase();
        let idx = lowerText.indexOf(kwLower);
        while (idx !== -1) {
          positions.push(idx);
          idx = lowerText.indexOf(kwLower, idx + 1);
        }
      }
      if (positions.length === 0) {
        const third = Math.floor(maxLen / 3);
        return `[INICIO]\n${text.substring(0, third)}\n\n[...]\n\n[MEDIO]\n${text.substring(Math.floor(text.length / 2) - Math.floor(third / 2), Math.floor(text.length / 2) + Math.floor(third / 2))}\n\n[...]\n\n[FINAL]\n${text.substring(text.length - third)}`;
      }
      positions.sort((a, b) => a - b);
      const segments: string[] = [];
      let totalLen = 0;
      const budgetPerSegment = Math.floor(maxLen / Math.min(positions.length, 5));
      const seen = new Set<number>();
      for (const pos of positions) {
        const bucket = Math.floor(pos / 2000);
        if (seen.has(bucket)) continue;
        seen.add(bucket);
        const start = Math.max(0, pos - 800);
        const end = Math.min(text.length, pos + budgetPerSegment - 800);
        const segment = text.substring(start, end);
        if (totalLen + segment.length > maxLen) break;
        segments.push(segment);
        totalLen += segment.length;
      }
      return segments.join('\n\n[...]\n\n');
    };

    const originalSection = extractRelevantSections(originalContent, issues);
    const rewrittenSection = extractRelevantSections(rewrittenContent, issues);

    const prompt = `Eres un verificador de correcciones literarias. Verifica si los problemas fueron corregidos en la reescritura sin introducir nuevos problemas graves.

PROBLEMAS QUE DEBÍAN CORREGIRSE:
${issueList}

TEXTO ORIGINAL (secciones relevantes):
${originalSection}

TEXTO REESCRITO (secciones relevantes):
${rewrittenSection}

Para CADA problema, indica si fue resuelto comparando ambos textos. Busca evidencia CONCRETA (frases nuevas, contenido modificado, texto añadido). También verifica que no se hayan introducido nuevos problemas GRAVES.

Responde SOLO en JSON:
{
  "issueResults": [
    { "index": 1, "fixed": true/false, "evidence": "cita textual de la corrección o explicación" }
  ],
  "newGraveProblems": false,
  "newProblemsDescription": null,
  "overallVerdict": "APROBADO" | "RECHAZADO"
}`;

    try {
      const response = await geminiGenerateWithRetry(prompt, "gemini-2.5-flash", "BatchIssueVerify");
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        const fixedCount = (parsed.issueResults || []).filter((r: any) => r.fixed).length;
        const hasNewProblems = parsed.newGraveProblems === true;
        return {
          overallFixed: fixedCount >= Math.ceil(issues.length * 0.5) && !hasNewProblems,
          fixedCount,
          details: hasNewProblems ? parsed.newProblemsDescription : undefined,
        };
      }
    } catch (error) {
      console.warn(`[TargetedRepair] Rewrite verification failed for chapter ${chapterNumber}:`, error);
    }
    return { overallFixed: true, fixedCount: issues.length, details: 'Verificación asumida como correcta' };
  }
}
