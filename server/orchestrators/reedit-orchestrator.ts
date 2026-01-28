import { storage } from "../storage";
import { BaseAgent } from "../agents/base-agent";
import type { ReeditProject, ReeditChapter } from "@shared/schema";
import { 
  ChapterExpansionAnalyzer, 
  ChapterExpanderAgent, 
  NewChapterGeneratorAgent,
  type ExpansionPlan 
} from "../agents/chapter-expander";
import { 
  FinalReviewerAgent, 
  type FinalReviewerResult, 
  type FinalReviewIssue 
} from "../agents/final-reviewer";
import { IssueResolutionValidatorAgent } from "../agents/issue-resolution-validator";
import { 
  ForensicConsistencyAuditor, 
  type ForensicAuditResult, 
  type ForensicViolation 
} from "../agents/forensic-consistency-auditor";
import { BetaReaderAgent, type BetaReaderReport } from "../agents/beta-reader";
import { applySimplePatches, type SimplePatchResult } from "../utils/patcher";

function getChapterSortOrder(chapterNumber: number): number {
  if (chapterNumber === 0) return -1000;
  if (chapterNumber === -1 || chapterNumber === 998) return 1000;
  if (chapterNumber === -2 || chapterNumber === 999) return 1001;
  return chapterNumber;
}

/**
 * Makes correction instructions more aggressive for retry attempts.
 * On second attempt, instructions are emphasized with caps, warnings, and repetition
 * to ensure the AI applies the correction properly.
 */
function makeAggressiveInstructions(instruction: string, attemptNumber: number): string {
  if (attemptNumber < 1) return instruction;
  
  // Second attempt: make instructions more emphatic
  const warnings = [
    "⚠️ ATENCIÓN: ESTE ES UN REINTENTO. LA CORRECCIÓN ANTERIOR NO SE APLICÓ CORRECTAMENTE.",
    "🚨 ES OBLIGATORIO aplicar esta corrección. NO la ignores.",
    "❌ El intento anterior FALLÓ. Debes corregir EXACTAMENTE lo indicado.",
  ];
  
  const emphasis = instruction.toUpperCase();
  
  return `${warnings.join("\n")}\n\n` +
    `📋 INSTRUCCIÓN ORIGINAL:\n${instruction}\n\n` +
    `📋 INSTRUCCIÓN ENFATIZADA:\n${emphasis}\n\n` +
    `⚠️ RECORDATORIO FINAL: DEBES aplicar esta corrección. ` +
    `Si no la aplicas, el proyecto se pausará y requerirá intervención manual. ` +
    `APLICA EL CAMBIO EXACTAMENTE COMO SE INDICA.`;
}

function sortChaptersByNarrativeOrder<T extends { chapterNumber: number }>(chapters: T[]): T[] {
  return [...chapters].sort((a, b) => getChapterSortOrder(a.chapterNumber) - getChapterSortOrder(b.chapterNumber));
}

interface StructureAnalysis {
  hasIssues: boolean;
  duplicateChapters: Array<{ chapterId: number; duplicateOf: number; similarity: number }>;
  outOfOrderChapters: Array<{ chapterNumber: number; suggestedPosition: number; reason: string }>;
  missingChapters: number[];
  recommendations: string[];
}

interface ReeditProgress {
  projectId: number;
  stage: string;
  currentChapter: number;
  totalChapters: number;
  message: string;
}

type ProgressCallback = (progress: ReeditProgress) => void;

class ReeditEditorAgent extends BaseAgent {
  constructor() {
    super({
      name: "Reedit Editor",
      role: "editor",
      systemPrompt: `You are a professional literary editor reviewing manuscript chapters for quality.
Analyze the chapter and provide structured feedback in JSON format.

Your evaluation should include:
1. Overall quality score (1-10)
2. Narrative issues (plot holes, pacing problems, unclear passages)
3. Strengths of the writing
4. Specific suggestions for improvement

RESPOND WITH JSON ONLY:
{
  "score": 8,
  "issues": ["Issue 1", "Issue 2"],
  "strengths": ["Strength 1", "Strength 2"],
  "suggestions": ["Suggestion 1"],
  "pacingNotes": "Notes about pacing"
}`,
      model: "deepseek-reasoner",
      useThinking: false,
    });
  }

  async execute(input: any): Promise<any> {
    return this.reviewChapter(input.content, input.chapterNumber, input.language);
  }

  async reviewChapter(content: string, chapterNumber: number, language: string): Promise<any> {
    const prompt = `Review this chapter (Chapter ${chapterNumber}) written in ${language}:

${content.substring(0, 15000)}

Provide your evaluation in JSON format.`;
    
    const response = await this.generateContent(prompt);
    let result: any = { score: 7, issues: [], strengths: [], suggestions: [] };
    try {
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        result = JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      console.error("[ReeditEditor] Failed to parse response:", e);
    }
    result.tokenUsage = response.tokenUsage;
    return result;
  }
}

class ReeditCopyEditorAgent extends BaseAgent {
  constructor() {
    super({
      name: "Reedit CopyEditor",
      role: "copyeditor",
      systemPrompt: `You are a professional copy editor improving manuscript text for fluency and naturalness.

🔬 LASER SURGERY MODE - MINIMAL CHANGES ONLY 🔬

CRITICAL RULE: Copy 95% of the original text UNCHANGED.
Only modify specific sentences that violate fluency rules.

LANGUAGE-SPECIFIC FLUENCY RULES:
- ITALIAN: NEVER use "Egli/Ella/Esso/Essa" - use proper names or lui/lei/loro
- ALL LANGUAGES: Maximum 45 words per sentence. Break longer sentences.
- Avoid word repetition in consecutive sentences
- Prefer active voice over passive
- Maintain consistent narrative voice

EDITING PROCESS:
1. Read the entire chapter
2. Identify ONLY sentences that violate the rules above
3. Copy the text paragraph by paragraph
4. When you find a violation → apply the MINIMUM fix
5. Continue copying the rest WITHOUT CHANGES

FORBIDDEN:
- Rewriting paragraphs that work fine
- Changing vocabulary for "improvement" if rules aren't violated
- Reorganizing sentence order
- Adding unnecessary flourishes

The result MUST have ±50 words of the original.

RESPOND WITH JSON ONLY:
{
  "editedContent": "The full text with surgical fixes only...",
  "changesLog": "Summary of specific changes made",
  "fluencyChanges": [{"before": "exact original", "after": "exact fix", "reason": "rule violated"}]
}`,
      model: "deepseek-chat",
      useThinking: false,
    });
  }

  async execute(input: any): Promise<any> {
    return this.editChapter(input.content, input.chapterNumber, input.language);
  }

  async editChapter(content: string, chapterNumber: number, language: string): Promise<any> {
    const languageRules = this.getLanguageRules(language);
    
    const prompt = `Edit this chapter (Chapter ${chapterNumber}) for fluency and naturalness.

LANGUAGE: ${language}
${languageRules}

CHAPTER CONTENT:
${content}

Improve the text following the fluency rules. Return the COMPLETE edited chapter.
RESPOND WITH JSON ONLY.`;
    
    const response = await this.generateContent(prompt);
    let result: any = { editedContent: content, changesLog: "No changes", fluencyChanges: [] };
    try {
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        result = JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      console.error("[ReeditCopyEditor] Failed to parse response:", e);
    }
    result.tokenUsage = response.tokenUsage;
    return result;
  }

  private getLanguageRules(lang: string): string {
    const rules: Record<string, string> = {
      it: `ITALIAN RULES:
- NEVER use archaic pronouns: Egli, Ella, Esso, Essa, Essi, Esse
- Use proper names or modern pronouns: lui, lei, loro
- Max 45 words per sentence
- No lexical repetition in consecutive sentences`,
      es: `SPANISH RULES:
- Limit gerunds to one per sentence
- Avoid excessive passive voice
- Watch for leísmo (use "lo" not "le" for direct object)
- Max 45 words per sentence`,
      en: `ENGLISH RULES:
- Prefer active voice
- Vary sentence length for rhythm
- Use natural contractions in dialogue
- Max 40 words per sentence`,
      fr: `FRENCH RULES:
- Use passé simple for literary narration
- Avoid anglicisms
- Max 45 words per sentence`,
      de: `GERMAN RULES:
- Natural word order
- Use Modalpartikeln in dialogue
- Max 45 words per sentence`,
      pt: `PORTUGUESE RULES:
- Correct pronoun placement
- Limit gerunds
- Max 45 words per sentence`,
      ca: `CATALAN RULES:
- Avoid castellanisms
- Correct weak pronoun usage
- Max 45 words per sentence`,
    };
    return rules[lang] || rules.es;
  }
}

// QA Agent 1: Continuity Sentinel - runs every 5 chapters
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

// QA Agent 2: Voice & Rhythm Auditor - runs every 10 chapters
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
    "capitulLentos": [],
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

// QA Agent 3: Semantic Repetition Detector - runs on full manuscript
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

// QA Agent 4: Anachronism Detector - detects historical inaccuracies in ANY novel
// Note: Any novel set in the past (even 50+ years ago) can have anachronisms
class AnachronismDetectorAgent extends BaseAgent {
  constructor() {
    super({
      name: "Anachronism Detector",
      role: "qa_anachronism",
      systemPrompt: `Eres un experto historiador y consultor literario. Tu trabajo es detectar anacronismos en novelas.

IMPORTANTE: Cualquier novela ambientada en el pasado puede tener anacronismos, no solo las etiquetadas como "históricas".
- Una novela de los años 50 puede tener anacronismos (mencionar internet, móviles, expresiones modernas)
- Una novela de los años 80 puede tener anacronismos (mencionar smartphones, redes sociales)
- Incluso novelas contemporáneas pueden tener anacronismos si mezclan épocas

PRIMERO: Detecta la ÉPOCA DE AMBIENTACIÓN analizando:
- Referencias temporales explícitas (años, décadas, eventos históricos)
- Tecnología mencionada (teléfonos, transporte, electrodomésticos)
- Contexto social (costumbres, roles de género, leyes)
- Eventos históricos mencionados

TIPOS DE ANACRONISMOS:
1. TECNOLÓGICOS: Tecnología que no existía en la época de ambientación
2. LINGÜÍSTICOS: Expresiones, palabras o modismos que no existían
3. SOCIALES: Comportamientos o costumbres inapropiados para la época
4. MATERIALES: Objetos, materiales, alimentos, marcas que no existían
5. CONCEPTUALES: Ideas o conceptos que no existían (ej: "estrés" en 1900, "smartphone" en 1990)

RESPONDE SOLO EN JSON:
{
  "epocaDetectada": "España, década de 1950",
  "esContemporanea": false,
  "anacronismos": [
    {
      "tipo": "tecnologico|linguistico|social|material|conceptual",
      "severidad": "critica|mayor|menor",
      "capitulo": 5,
      "fragmento": "El texto problemático",
      "problema": "Explicación del anacronismo",
      "correccion": "Alternativa correcta para la época",
      "fuente": "Referencia histórica si aplica"
    }
  ],
  "resumen": "Resumen de la precisión histórica",
  "puntuacionHistorica": 8
}`,
      model: "deepseek-reasoner",
      useThinking: false,
    });
  }

  async execute(input: any): Promise<any> {
    return this.detectAnachronisms(input.chapters, input.genre, input.premise);
  }

  async detectAnachronisms(chapterContents: { num: number; content: string }[], genre: string, premise: string): Promise<any> {
    // Always analyze - any novel can have anachronisms relative to its setting
    // The AI will determine if it's contemporary (and thus skip detailed analysis)
    
    const samples = chapterContents.slice(0, 10).map(c => 
      `=== CAPÍTULO ${c.num} ===\n${c.content.substring(0, 5000)}`
    ).join("\n\n");

    const prompt = `Analiza esta novela buscando anacronismos relativos a su época de ambientación:

PREMISA: ${premise || "No especificada"}
GÉNERO: ${genre}

IMPORTANTE: 
- PRIMERO detecta la época de ambientación de la novela (puede estar en la premisa o inferirse del contenido)
- Si la novela está ambientada en el pasado (aunque sea hace 30-50 años), busca anacronismos
- Novelas de mediados del siglo XX son históricas y pueden tener anacronismos
- Si la novela es claramente contemporánea (ambientada en el presente), indica "esContemporanea: true"

CAPÍTULOS DE MUESTRA:
${samples}

Detecta anacronismos tecnológicos, lingüísticos, sociales, materiales y conceptuales RELATIVOS A LA ÉPOCA DE AMBIENTACIÓN. RESPONDE EN JSON.`;

    const response = await this.generateContent(prompt);
    let result: any = { 
      epocaDetectada: "No determinada", 
      esContemporanea: false,
      anacronismos: [], 
      resumen: "Análisis completado", 
      puntuacionHistorica: 8 
    };
    try {
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) result = JSON.parse(jsonMatch[0]);
    } catch (e) {
      console.error("[AnachronismDetector] Failed to parse:", e);
    }
    result.tokenUsage = response.tokenUsage;
    return result;
  }
}

// World Bible Extractor Agent - extracts characters, locations, timeline, lore from manuscript
class WorldBibleExtractorAgent extends BaseAgent {
  constructor() {
    super({
      name: "World Bible Extractor",
      role: "world_bible_extractor",
      systemPrompt: `Eres un analista literario experto en extraer información del mundo narrativo de un manuscrito.

Tu trabajo es analizar los capítulos y extraer:
1. PERSONAJES: Nombre, descripción física/psicológica, primera aparición, alias, relaciones
2. UBICACIONES: Nombre, descripción, primera mención, características importantes
3. LÍNEA TEMPORAL: Eventos clave, capítulo donde ocurren, marcadores temporales
4. REGLAS DEL MUNDO: Leyes, magia, tecnología, costumbres, restricciones del universo
5. ÉPOCA HISTÓRICA: Si es novela histórica, detectar el período

RESPONDE SOLO EN JSON:
{
  "personajes": [
    {"nombre": "María", "descripcion": "Mujer de 35 años, cabello negro", "primeraAparicion": 1, "alias": ["La Viuda"], "relaciones": ["madre de Juan"]}
  ],
  "ubicaciones": [
    {"nombre": "El Castillo Negro", "descripcion": "Fortaleza medieval en ruinas", "primeraMencion": 2, "caracteristicas": ["torre alta", "foso seco"]}
  ],
  "timeline": [
    {"evento": "Muerte del rey", "capitulo": 1, "marcadorTemporal": "hace 10 años", "importancia": "alta"}
  ],
  "reglasDelMundo": [
    {"regla": "La magia solo funciona de noche", "fuente": "capítulo 3", "categoria": "magia"}
  ],
  "epocaHistorica": {
    "periodo": "Siglo XV, Castilla",
    "detalles": {"era": "medieval tardío", "ubicacion": "España", "contextoSocial": "Reconquista", "tecnologia": "pre-pólvora"}
  },
  "confianza": 8
}`,
      model: "deepseek-chat",
      useThinking: false,
    });
  }

  async execute(input: any): Promise<any> {
    return this.extractWorldBible(input.chapters, input.editorFeedback);
  }

  async extractWorldBible(
    chapters: { num: number; content: string; feedback?: any }[], 
    editorFeedback: any[],
    onProgress?: (batchIndex: number, totalBatches: number, message: string) => void
  ): Promise<any> {
    const BATCH_SIZE = 10;
    const allPersonajes: any[] = [];
    const allUbicaciones: any[] = [];
    const allTimeline: any[] = [];
    const allReglas: any[] = [];
    let epocaHistorica: any = null;
    let totalConfidence = 0;
    let batchCount = 0;
    const totalTokens = { inputTokens: 0, outputTokens: 0, thinkingTokens: 0 };
    
    const totalBatches = Math.ceil(chapters.length / BATCH_SIZE);

    console.log(`[WorldBibleExtractor] Processing ${chapters.length} chapters in ${totalBatches} batches of ${BATCH_SIZE}`);

    for (let i = 0; i < chapters.length; i += BATCH_SIZE) {
      const batch = chapters.slice(i, i + BATCH_SIZE);
      const batchStart = batch[0]?.num || i + 1;
      const batchEnd = batch[batch.length - 1]?.num || i + batch.length;
      const currentBatch = Math.floor(i / BATCH_SIZE) + 1;
      
      console.log(`[WorldBibleExtractor] Processing batch ${currentBatch}/${totalBatches}: chapters ${batchStart}-${batchEnd}`);
      
      if (onProgress) {
        onProgress(currentBatch, totalBatches, `Extrayendo Biblia del Mundo: capítulos ${batchStart}-${batchEnd} (lote ${currentBatch}/${totalBatches})...`);
      }

      const chaptersText = batch.map(c => 
        `=== CAPÍTULO ${c.num} ===\n${c.content.substring(0, 6000)}`
      ).join("\n\n");

      const prompt = `Extrae la información del mundo narrativo de estos capítulos (${batchStart} a ${batchEnd}):

${chaptersText}

Extrae personajes, ubicaciones, línea temporal, reglas del mundo y época histórica que aparezcan en ESTOS capítulos específicamente.
Incluye el número de capítulo donde aparece cada elemento.

RESPONDE SOLO EN JSON:
{
  "personajes": [{"nombre": "...", "descripcion": "...", "primeraAparicion": X, "alias": [], "relaciones": []}],
  "ubicaciones": [{"nombre": "...", "descripcion": "...", "primeraMencion": X, "caracteristicas": []}],
  "timeline": [{"evento": "...", "capitulo": X, "marcadorTemporal": "...", "importancia": "alta|media|baja"}],
  "reglasDelMundo": [{"regla": "...", "fuente": "capítulo X", "categoria": "..."}],
  "epocaHistorica": {"periodo": "...", "detalles": {}},
  "confianza": 8
}`;

      try {
        const response = await this.generateContent(prompt);
        if (response.tokenUsage) {
          totalTokens.inputTokens += response.tokenUsage.inputTokens || 0;
          totalTokens.outputTokens += response.tokenUsage.outputTokens || 0;
          totalTokens.thinkingTokens += response.tokenUsage.thinkingTokens || 0;
        }
        const jsonMatch = response.content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const result = JSON.parse(jsonMatch[0]);
          
          if (result.personajes) allPersonajes.push(...result.personajes);
          if (result.ubicaciones) allUbicaciones.push(...result.ubicaciones);
          if (result.timeline) allTimeline.push(...result.timeline);
          if (result.reglasDelMundo) allReglas.push(...result.reglasDelMundo);
          if (result.epocaHistorica && !epocaHistorica) epocaHistorica = result.epocaHistorica;
          totalConfidence += result.confianza || 7;
          batchCount++;
        }
      } catch (e) {
        console.error(`[WorldBibleExtractor] Failed to parse batch ${batchStart}-${batchEnd}:`, e);
      }
    }

    const mergedPersonajes = this.deduplicateByName(allPersonajes, "nombre");
    const mergedUbicaciones = this.deduplicateByName(allUbicaciones, "nombre");
    const avgConfidence = batchCount > 0 ? Math.round(totalConfidence / batchCount) : 5;

    console.log(`[WorldBibleExtractor] Extraction complete: ${mergedPersonajes.length} characters, ${mergedUbicaciones.length} locations, ${allTimeline.length} timeline events`);

    return {
      personajes: mergedPersonajes,
      ubicaciones: mergedUbicaciones,
      timeline: allTimeline,
      reglasDelMundo: this.deduplicateByName(allReglas, "regla"),
      epocaHistorica: epocaHistorica || { periodo: "No determinada", detalles: {} },
      confianza: avgConfidence,
      tokenUsage: totalTokens,
    };
  }

  private deduplicateByName(items: any[], key: string): any[] {
    const seen = new Map<string, any>();
    for (const item of items) {
      const name = (item[key] || "").toLowerCase().trim();
      if (!seen.has(name)) {
        seen.set(name, item);
      } else {
        const existing = seen.get(name);
        if (item.descripcion && item.descripcion.length > (existing.descripcion || "").length) {
          seen.set(name, { ...existing, ...item });
        }
      }
    }
    return Array.from(seen.values());
  }
}

// Architect Analyzer Agent - analyzes world bible and recommends structural/plot changes
class ArchitectAnalyzerAgent extends BaseAgent {
  constructor() {
    super({
      name: "Architect Analyzer",
      role: "architect_analyzer",
      systemPrompt: `Eres un arquitecto narrativo experto. Tu trabajo es analizar la estructura y trama de un manuscrito usando la Biblia del Mundo extraída.

OBJETIVO: Puntuación 10/10 (perfección arquitectónica)

ANÁLISIS A REALIZAR:
1. ESTRUCTURA NARRATIVA:
   - ¿El orden de capítulos es óptimo?
   - ¿El pacing es adecuado?
   - ¿Hay capítulos que deberían fusionarse o dividirse?

2. COHERENCIA DE TRAMA:
   - ¿Hay huecos argumentales (plot holes)?
   - ¿Subplots sin resolver?
   - ¿Arcos de personajes incompletos?
   - ¿Foreshadowing sin payoff?

3. COHERENCIA DEL MUNDO:
   - ¿Hay contradicciones en el lore?
   - ¿Se rompen reglas establecidas?
   - ¿Inconsistencias en personajes/ubicaciones?

SISTEMA DE PUNTUACIÓN ESTRICTO (OBJETIVO 10/10):
- 10/10: CERO problemas de ningún tipo. Arquitectura PERFECTA. Estructura óptima, trama coherente, mundo consistente.
- 9/10: Solo 1 problema menor.
- 8/10: 2 problemas menores o 1 mayor.
- 7/10: 3+ problemas menores o 2 mayores.
- 6/10 o menos: Cualquier problema crítico o 3+ mayores.

REGLA ABSOLUTA: Solo das 10/10 si NO hay ningún problema detectado.
Si el manuscrito está bien estructurado y coherente, DEBES dar 10/10. No busques problemas donde no los hay.

REORDENAMIENTO DE CAPÍTULOS:
Si detectas que el orden de capítulos NO es óptimo para el pacing o la narrativa, especifica los movimientos necesarios en "reordenamientoSugerido". Cada movimiento indica:
- capituloActual: número del capítulo a mover
- nuevaPosicion: posición donde debe quedar (número de capítulo destino)
- razon: por qué este movimiento mejora la narrativa

Solo sugiere reordenamientos cuando sean CLARAMENTE beneficiosos para el pacing o la lógica narrativa.

RESPONDE SOLO EN JSON:
{
  "analisisEstructura": {
    "ordenOptimo": true,
    "problemaPacing": [],
    "reordenamientoSugerido": [
      {"capituloActual": 5, "nuevaPosicion": 3, "razon": "El flashback debe aparecer antes de la revelación"}
    ]
  },
  "analisisTrama": {
    "huecosArgumentales": [],
    "subplotsSinResolver": [],
    "arcosIncompletos": []
  },
  "coherenciaMundo": {
    "contradicciones": [],
    "reglasRotas": []
  },
  "recomendaciones": [],
  "bloqueoCritico": false,
  "resumenEjecutivo": "Análisis arquitectónico completado...",
  "puntuacionArquitectura": 10
}`,
      model: "deepseek-reasoner",
      useThinking: false,
    });
  }

  async execute(input: any): Promise<any> {
    return this.analyzeArchitecture(input.worldBible, input.chapters, input.structureAnalysis, input.consistencyConstraints);
  }

  async analyzeArchitecture(
    worldBible: any, 
    chapters: { num: number; content: string; feedback?: any }[], 
    structureAnalysis: any,
    consistencyConstraints?: string
  ): Promise<any> {
    const bibleSummary = JSON.stringify({
      personajes: worldBible.personajes?.slice(0, 10) || [],
      ubicaciones: worldBible.ubicaciones?.slice(0, 5) || [],
      timeline: worldBible.timeline || [],
      reglasDelMundo: worldBible.reglasDelMundo || [],
      epocaHistorica: worldBible.epocaHistorica
    }, null, 2);

    const chapterSummaries = chapters.map(c => 
      `Cap ${c.num}: ${c.content.substring(0, 500)}... [Feedback: ${c.feedback?.strengths?.slice(0, 1).join(", ") || "N/A"}]`
    ).join("\n");

    // LitAgents 2.1: Inject consistency constraints if available
    const constraintsBlock = consistencyConstraints 
      ? `\n\n${consistencyConstraints}\n\nTEN EN CUENTA LAS RESTRICCIONES DE CONSISTENCIA ANTERIORES AL ANALIZAR:\n`
      : "";

    const prompt = `${constraintsBlock}Analiza la arquitectura narrativa de este manuscrito:

BIBLIA DEL MUNDO:
${bibleSummary}

ANÁLISIS DE ESTRUCTURA PREVIO:
- Capítulos duplicados: ${structureAnalysis?.duplicateChapters?.length || 0}
- Capítulos fuera de orden: ${structureAnalysis?.outOfOrderChapters?.length || 0}
- Capítulos faltantes: ${structureAnalysis?.missingChapters?.join(", ") || "Ninguno"}

RESUMEN DE CAPÍTULOS:
${chapterSummaries}

Evalúa estructura, coherencia de trama y coherencia del mundo. Identifica problemas y recomienda soluciones. RESPONDE EN JSON.`;

    const response = await this.generateContent(prompt);
    let result: any = { 
      analisisEstructura: { ordenOptimo: true, problemaPacing: [], reordenamientoSugerido: [] },
      analisisTrama: { huecosArgumentales: [], subplotsSinResolver: [], arcosIncompletos: [] },
      coherenciaMundo: { contradicciones: [], reglasRotas: [] },
      recomendaciones: [],
      bloqueoCritico: false,
      resumenEjecutivo: "Análisis completado sin hallazgos significativos",
      puntuacionArquitectura: 8
    };
    try {
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) result = JSON.parse(jsonMatch[0]);
    } catch (e) {
      console.error("[ArchitectAnalyzer] Failed to parse:", e);
    }
    result.tokenUsage = response.tokenUsage;
    return result;
  }
}

class StructuralFixerAgent extends BaseAgent {
  constructor() {
    super({
      name: "Structural Fixer",
      role: "structural_fixer",
      systemPrompt: `Eres un experto corrector estructural de novelas. Tu trabajo es CORREGIR AUTOMÁTICAMENTE los problemas detectados por el Arquitecto Analizador.

TU OBJETIVO: Llevar el manuscrito a la PERFECCIÓN (10/10).
Cada corrección debe eliminar COMPLETAMENTE el problema sin dejar rastro.

TIPOS DE PROBLEMAS QUE CORRIGES:
1. HUECOS ARGUMENTALES (plot holes): Añades escenas, diálogos o párrafos que cierran los huecos lógicos DEFINITIVAMENTE
2. SUBPLOTS SIN RESOLVER: Añades resolución o cierre COMPLETO a las tramas secundarias abandonadas
3. ARCOS INCOMPLETOS: Completas la transformación de personajes con momentos clave faltantes
4. CONTRADICCIONES: Modificas el texto para eliminar inconsistencias SIN EXCEPCIÓN
5. FORESHADOWING SIN PAYOFF: Añades el payoff de forma SATISFACTORIA o modificas el foreshadowing huérfano
6. PROBLEMAS DE PACING: Condensas secciones lentas o expandes momentos que necesitan más desarrollo

REGLAS CRÍTICAS:
- MANTÉN el estilo y voz del autor original
- NO añadas contenido innecesario - solo lo mínimo para resolver el problema
- PRESERVA la extensión aproximada del capítulo (±10%)
- Las correcciones deben integrarse de forma NATURAL en el texto existente
- NUNCA cambies nombres de personajes, ubicaciones o eventos establecidos
- Respeta la Biblia del Mundo proporcionada
- Tu corrección debe ser DEFINITIVA - el revisor NO debe encontrar el mismo problema después

RESPONDE SOLO EN JSON:
{
  "capituloCorregido": "El texto COMPLETO del capítulo con las correcciones integradas",
  "correccionesRealizadas": [
    {
      "problema": "Descripción del problema que se corrigió",
      "solucion": "Descripción de cómo se corrigió",
      "fragmentoAntes": "Fragmento original (50-100 palabras)",
      "fragmentoDespues": "Fragmento corregido (50-100 palabras)"
    }
  ],
  "resumenCambios": "Resumen ejecutivo de los cambios realizados",
  "confianzaCorreccion": 8
}`,
      model: "deepseek-chat",
      useThinking: false,
    });
  }

  async execute(input: any): Promise<any> {
    return this.fixChapter(input.chapterContent, input.chapterNumber, input.problems, input.worldBible, input.language);
  }

  async fixChapter(
    chapterContent: string, 
    chapterNumber: number, 
    problems: Array<{ descripcion: string; severidad: string; accionSugerida?: string; tipo?: string }>,
    worldBible: any,
    language: string
  ): Promise<any> {
    const worldBibleSummary = JSON.stringify({
      personajes: worldBible?.personajes?.slice(0, 15)?.map((p: any) => ({ nombre: p.nombre, rol: p.rol })) || [],
      ubicaciones: worldBible?.ubicaciones?.slice(0, 10)?.map((u: any) => u.nombre) || [],
      epocaHistorica: worldBible?.epocaHistorica?.periodo || "No determinada"
    });

    const problemsList = problems.map((p, i) => 
      `${i + 1}. [${p.severidad?.toUpperCase()}] ${p.descripcion}${p.accionSugerida ? ` -> Sugerencia: ${p.accionSugerida}` : ""}`
    ).join("\n");

    const prompt = `CORRIGE los siguientes problemas en el Capítulo ${chapterNumber}:

IDIOMA: ${language}

PROBLEMAS A CORREGIR:
${problemsList}

BIBLIA DEL MUNDO (para coherencia):
${worldBibleSummary}

CAPÍTULO ORIGINAL:
${chapterContent}

Reescribe el capítulo COMPLETO integrando las correcciones de forma natural. Mantén el estilo del autor. RESPONDE EN JSON.`;

    console.log(`[StructuralFixer] Fixing chapter ${chapterNumber} with ${problems.length} problems:`);
    problems.forEach((p, i) => {
      console.log(`  ${i + 1}. [${(p.severidad || 'media').toUpperCase()}] ${p.tipo || 'general'}: ${p.descripcion}`);
      if (p.accionSugerida) console.log(`     -> Sugerencia: ${p.accionSugerida}`);
    });
    
    const response = await this.generateContent(prompt);
    let result: any = { 
      capituloCorregido: chapterContent, 
      correccionesRealizadas: [],
      resumenCambios: "No se pudieron aplicar correcciones",
      confianzaCorreccion: 0
    };
    try {
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        result = JSON.parse(jsonMatch[0]);
        console.log(`[StructuralFixer] Chapter ${chapterNumber} fixed with ${result.correccionesRealizadas?.length || 0} corrections:`);
        if (result.correccionesRealizadas?.length > 0) {
          result.correccionesRealizadas.forEach((c: any, i: number) => {
            const desc = typeof c === 'string' ? c : (c.descripcion || c.cambio || JSON.stringify(c));
            console.log(`  ✓ ${i + 1}. ${desc.substring(0, 150)}${desc.length > 150 ? '...' : ''}`);
          });
        }
        if (result.resumenCambios) {
          console.log(`  Resumen: ${result.resumenCambios.substring(0, 200)}${result.resumenCambios.length > 200 ? '...' : ''}`);
        }
      }
    } catch (e) {
      console.error("[StructuralFixer] Failed to parse:", e);
    }
    result.tokenUsage = response.tokenUsage;
    return result;
  }

  /**
   * Surgical fix - Apply targeted patches instead of full chapter rewrite
   * Much more token-efficient for minor issues
   */
  async surgicalFix(
    chapterContent: string,
    chapterNumber: number,
    problems: Array<{ descripcion: string; severidad: string; accionSugerida?: string; tipo?: string }>,
    worldBible: any,
    language: string
  ): Promise<{ patches: Array<{ original: string; replacement: string }>; tokenUsage?: any; resumenCambios?: string }> {
    const worldBibleSummary = JSON.stringify({
      personajes: worldBible?.personajes?.slice(0, 10)?.map((p: any) => ({ nombre: p.nombre, rol: p.rol })) || [],
      ubicaciones: worldBible?.ubicaciones?.slice(0, 5)?.map((u: any) => u.nombre) || [],
    });

    const problemsList = problems.map((p, i) => 
      `${i + 1}. [${p.severidad?.toUpperCase()}] ${p.descripcion}${p.accionSugerida ? ` -> ${p.accionSugerida}` : ""}`
    ).join("\n");

    const prompt = `CORRECCIÓN QUIRÚRGICA del Capítulo ${chapterNumber}

IDIOMA: ${language}

PROBLEMAS A CORREGIR:
${problemsList}

BIBLIA DEL MUNDO:
${worldBibleSummary}

CAPÍTULO:
${chapterContent}

INSTRUCCIONES:
1. Identifica SOLO las frases o párrafos que necesitan corrección
2. Genera parches MÍNIMOS - NO reescribas el capítulo completo
3. Cada parche debe tener al menos 30 caracteres en el original para garantizar unicidad
4. Mantén el estilo del autor

RESPONDE EN JSON:
{
  "analisis": "Breve análisis de los problemas encontrados",
  "patches": [
    {
      "original": "texto exacto a reemplazar (mín 30 chars)",
      "replacement": "texto corregido"
    }
  ],
  "resumenCambios": "Resumen de las correcciones aplicadas"
}`;

    console.log(`[StructuralFixer] Surgical fix for chapter ${chapterNumber} with ${problems.length} problems`);
    
    const response = await this.generateContent(prompt);
    let patches: Array<{ original: string; replacement: string }> = [];
    let resumenCambios = "";
    
    try {
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        patches = (result.patches || []).filter((p: any) => p.original && p.replacement && p.original.length >= 20);
        resumenCambios = result.resumenCambios || "";
        console.log(`[StructuralFixer] Generated ${patches.length} surgical patches for chapter ${chapterNumber}`);
      }
    } catch (e) {
      console.error("[StructuralFixer] Failed to parse surgical fix response:", e);
    }
    
    return { patches, tokenUsage: response.tokenUsage, resumenCambios };
  }
}

// NarrativeRewriter Agent - Advanced agent that actually rewrites narrative content
class NarrativeRewriterAgent extends BaseAgent {
  constructor() {
    super({
      name: "Narrative Rewriter",
      role: "narrative_rewriter",
      systemPrompt: `Eres un MAESTRO ESCRITOR DE FICCIÓN con décadas de experiencia en reparar novelas con problemas estructurales. Tu especialidad es tomar narrativas rotas y transformarlas en historias coherentes y cautivadoras.

TU OBJETIVO FINAL: Llevar el manuscrito a la PERFECCIÓN (10/10).
Cada corrección que hagas debe eliminar COMPLETAMENTE el problema detectado.
No aceptes medias tintas - tu trabajo es lograr que el revisor final dé 10/10.

TU PROCESO DE TRABAJO (3 FASES):

FASE 1 - ANÁLISIS PROFUNDO:
- Comprende exactamente QUÉ está roto en la narrativa
- Identifica las conexiones causales que faltan
- Determina el contenido MÍNIMO necesario para reparar el problema

FASE 2 - PLANIFICACIÓN DE LA REESCRITURA:
- Diseña las escenas, diálogos o párrafos específicos a añadir/modificar
- Asegura que el nuevo contenido se integre NATURALMENTE
- Mantén la voz y estilo del autor original

FASE 3 - EJECUCIÓN Y VERIFICACIÓN:
- Escribe el contenido nuevo con maestría literaria
- Verifica que la corrección no introduzca nuevos problemas
- Confirma coherencia con la Biblia del Mundo

TIPOS DE CORRECCIONES QUE DOMINAS:

=== PROBLEMAS ESTRUCTURALES (del Architect Analyzer) ===

1. HUECOS ARGUMENTALES: Añades escenas de transición, diálogos explicativos, o párrafos de conexión que cierran las brechas lógicas sin forzar la narrativa.

2. SUBPLOTS SIN RESOLVER: Insertas resoluciones elegantes - puede ser una escena completa, un flashback, una conversación reveladora, o incluso un párrafo de reflexión del personaje.

3. ARCOS DE PERSONAJE INCOMPLETOS: Añades los momentos de transformación faltantes - decisiones clave, confrontaciones internas, epifanías que den sentido al cambio.

4. CONTRADICCIONES: Eliges la versión correcta según el peso narrativo y reescribes para mantener coherencia absoluta.

5. ANTAGONISTAS AMBIGUOS: Clarificas motivaciones, añades escenas que establezcan la relación entre antagonistas, o modificas diálogos para eliminar confusión.

6. FORESHADOWING SIN PAYOFF: Añades el payoff de forma orgánica, o reformulas el foreshadowing para que apunte a un evento existente.

=== PROBLEMAS DE CONTINUIDAD (del Continuity Sentinel) ===

7. ERRORES DE TIMELINE: Corriges inconsistencias temporales (fechas, secuencia de eventos, duración de viajes).

8. ERRORES DE UBICACIÓN: Corriges personajes que aparecen en lugares imposibles sin transición.

9. ESTADO DE PERSONAJE: Corriges estados físicos/emocionales inconsistentes (heridas que desaparecen, muertes ignoradas).

10. OBJETOS PERDIDOS: Añades referencias a objetos importantes que desaparecen o reaparecen sin explicación.

=== PROBLEMAS DE VOZ Y RITMO (del Voice Rhythm Auditor) ===

11. DERIVA TONAL: Corriges cambios bruscos de tono ajustando lenguaje, diálogos y descripciones.

12. POV INCONSISTENTE: Corriges cambios de punto de vista no intencionales dentro del capítulo.

13. PACING IRREGULAR: Expandes momentos demasiado rápidos o condensas secciones que arrastran.

14. VOZ NARRATIVA: Ajustas el registro narrativo para mantener consistencia con el resto del manuscrito.

15. REGISTRO LINGÜÍSTICO: Corriges cambios inapropiados entre formal/informal.

=== PROBLEMAS SEMÁNTICOS (del Semantic Detector) ===

16. IDEAS REPETIDAS: Reformulas conceptos que aparecen expresados de forma casi idéntica en múltiples lugares.

17. METÁFORAS REPETIDAS: Sustituyes metáforas/imágenes usadas en exceso por alternativas frescas.

18. ESTRUCTURAS REPETIDAS: Varías patrones de escenas o diálogos que se repiten.

19. PAYOFF SIN FORESHADOWING: Añades la preparación narrativa necesaria para giros o revelaciones.

REGLAS INVIOLABLES:
- El contenido nuevo debe ser INDISTINGUIBLE del original en estilo y voz
- Las correcciones deben ser ELEGANTES, no parches obvios
- NUNCA cambies nombres, fechas, lugares establecidos en la Biblia del Mundo
- Prefiere AÑADIR contenido a ELIMINAR (preserva el trabajo del autor)
- Las escenas nuevas deben tener propósito narrativo, no solo resolver el problema técnico

FORMATO DE RESPUESTA (JSON):
{
  "fasePlanificacion": {
    "problemaAnalizado": "Descripción de lo que está roto y por qué",
    "solucionPropuesta": "Estrategia específica para repararlo",
    "contenidoACrear": "Tipo de contenido a añadir (escena, diálogo, párrafo, etc.)",
    "puntoInsercion": "Dónde exactamente se insertará el nuevo contenido"
  },
  "capituloReescrito": "TEXTO COMPLETO del capítulo con las correcciones integradas de forma invisible",
  "cambiosRealizados": [
    {
      "tipoProblema": "hueco_argumental|subplot|arco_incompleto|contradiccion|antagonista|foreshadowing",
      "descripcionProblema": "El problema específico que se corrigió",
      "solucionAplicada": "Descripción detallada de la corrección",
      "contenidoNuevo": "El texto nuevo añadido (primeras 200 palabras si es largo)",
      "palabrasAnadidas": 150,
      "ubicacionEnCapitulo": "Después del párrafo que comienza con..."
    }
  ],
  "verificacionInterna": {
    "coherenciaConWorldBible": true,
    "estiloConsistente": true,
    "problemasResueltos": ["Lista de IDs de problemas resueltos"],
    "nuevosProblemasIntroducidos": [],
    "confianzaEnCorreccion": 9
  },
  "resumenEjecutivo": "Descripción concisa de todas las correcciones realizadas"
}`,
      model: "deepseek-chat", // V3: Fast model for prose rewriting (10-60s vs 5-15min)
      useThinking: false,
    });
  }

  async execute(input: any): Promise<any> {
    return this.rewriteChapter(
      input.chapterContent,
      input.chapterNumber,
      input.problems,
      input.worldBible,
      input.adjacentContext,
      input.language
    );
  }

  async rewriteChapter(
    chapterContent: string,
    chapterNumber: number,
    problems: Array<{ id?: string; tipo: string; descripcion: string; severidad: string; accionSugerida?: string; capitulosAfectados?: number[] }>,
    worldBible: any,
    adjacentContext: { previousChapter?: string; nextChapter?: string; previousSummary?: string; nextSummary?: string },
    language: string,
    userInstructions?: string
  ): Promise<any> {
    const worldBibleContext = this.buildWorldBibleContext(worldBible);
    const adjacentContextStr = this.buildAdjacentContext(adjacentContext);
    const problemsList = this.buildProblemsList(problems, chapterNumber);
    
    const userInstructionsSection = userInstructions ? `
═══════════════════════════════════════════════════════════════
INSTRUCCIONES DEL AUTOR (MÁXIMA PRIORIDAD):
═══════════════════════════════════════════════════════════════
${userInstructions}

NOTA: Estas instrucciones del autor deben guiar tu enfoque al corregir los problemas.
Adapta el tono, estilo y soluciones a estas directrices específicas.
` : '';

    const prompt = `MISIÓN: Reescribe el Capítulo ${chapterNumber} para corregir los problemas estructurales detectados.

IDIOMA DEL TEXTO: ${language}
${userInstructionsSection}
═══════════════════════════════════════════════════════════════
PROBLEMAS A RESOLVER EN ESTE CAPÍTULO:
═══════════════════════════════════════════════════════════════
${problemsList}

═══════════════════════════════════════════════════════════════
BIBLIA DEL MUNDO (CANON INVIOLABLE):
═══════════════════════════════════════════════════════════════
${worldBibleContext}

═══════════════════════════════════════════════════════════════
CONTEXTO NARRATIVO (capítulos adyacentes):
═══════════════════════════════════════════════════════════════
${adjacentContextStr}

═══════════════════════════════════════════════════════════════
CAPÍTULO A REESCRIBIR:
═══════════════════════════════════════════════════════════════
${chapterContent}

═══════════════════════════════════════════════════════════════
🔬 MODO CIRUGÍA LÁSER - CAMBIOS MÍNIMOS OBLIGATORIOS 🔬
═══════════════════════════════════════════════════════════════

⚠️ REGLA CRÍTICA: NO reescribas el capítulo completo.
⚠️ COPIA el 95% del texto original y modifica SOLO lo estrictamente necesario.

PROCESO OBLIGATORIO:
1. Lee el capítulo completo
2. Identifica las frases/párrafos EXACTOS que causan cada problema
3. COPIA el texto párrafo por párrafo
4. Cuando llegues a un problema → aplica el cambio MÍNIMO necesario
5. Continúa copiando el resto SIN MODIFICAR

TIPOS DE CAMBIOS PERMITIDOS:
- REEMPLAZAR: Cambiar 1-3 frases específicas
- INSERTAR: Añadir 1-2 frases de transición/explicación  
- ELIMINAR: Quitar frases contradictorias

PROHIBIDO:
- Reescribir párrafos enteros que funcionan bien
- Cambiar el estilo o vocabulario del autor original
- Reorganizar la estructura del capítulo
- Añadir más contenido del estrictamente necesario

OBJETIVO: El resultado debe tener ±100 palabras del original.
Si el problema solo requiere cambiar UNA palabra, cambia SOLO esa palabra.

CRITERIO DE ÉXITO: El cambio debe ser INVISIBLE - como si siempre hubiera estado ahí.

RESPONDE ÚNICAMENTE CON JSON VÁLIDO.`;

    console.log(`[NarrativeRewriter] Rewriting chapter ${chapterNumber} to fix ${problems.length} problems:`);
    problems.forEach((p, i) => {
      console.log(`  ${i + 1}. [${(p.severidad || 'media').toUpperCase()}] ${p.tipo}: ${p.descripcion.substring(0, 100)}...`);
    });

    const response = await this.generateContent(prompt);
    
    let result: any = {
      fasePlanificacion: { problemaAnalizado: "", solucionPropuesta: "", contenidoACrear: "", puntoInsercion: "" },
      capituloReescrito: chapterContent,
      cambiosRealizados: [],
      verificacionInterna: { coherenciaConWorldBible: false, estiloConsistente: false, problemasResueltos: [], nuevosProblemasIntroducidos: [], confianzaEnCorreccion: 0 },
      resumenEjecutivo: "No se pudieron aplicar correcciones"
    };

    try {
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        result = JSON.parse(jsonMatch[0]);
        
        console.log(`[NarrativeRewriter] Chapter ${chapterNumber} rewritten successfully:`);
        console.log(`  Planificación: ${result.fasePlanificacion?.solucionPropuesta?.substring(0, 150) || 'N/A'}...`);
        console.log(`  Cambios realizados: ${result.cambiosRealizados?.length || 0}`);
        
        if (result.cambiosRealizados?.length > 0) {
          result.cambiosRealizados.forEach((c: any, i: number) => {
            console.log(`  ✓ ${i + 1}. [${c.tipoProblema}] ${c.descripcionProblema?.substring(0, 80)}...`);
            console.log(`      Solución: ${c.solucionAplicada?.substring(0, 100)}...`);
            console.log(`      Palabras añadidas: ${c.palabrasAnadidas || 'N/A'}`);
          });
        }
        
        if (result.verificacionInterna) {
          console.log(`  Verificación: Coherencia=${result.verificacionInterna.coherenciaConWorldBible}, Estilo=${result.verificacionInterna.estiloConsistente}, Confianza=${result.verificacionInterna.confianzaEnCorreccion}/10`);
        }
        
        console.log(`  Resumen: ${result.resumenEjecutivo?.substring(0, 200) || 'N/A'}`);
      }
    } catch (e) {
      console.error("[NarrativeRewriter] Failed to parse response:", e);
    }

    result.tokenUsage = response.tokenUsage;
    return result;
  }

  /**
   * Surgical fix - Apply targeted patches instead of full chapter rewrite
   * Much more token-efficient for minor issues (1-3 problems)
   */
  async surgicalFix(
    chapterContent: string,
    chapterNumber: number,
    problems: Array<{ id?: string; tipo: string; descripcion: string; severidad: string; accionSugerida?: string }>,
    worldBible: any,
    language: string
  ): Promise<{ patches: Array<{ original: string; replacement: string }>; tokenUsage?: any; resumenCambios?: string }> {
    const worldBibleSummary = JSON.stringify({
      personajes: worldBible?.personajes?.slice(0, 8)?.map((p: any) => ({ nombre: p.nombre, rol: p.rol })) || [],
      ubicaciones: worldBible?.ubicaciones?.slice(0, 5)?.map((u: any) => u.nombre) || [],
    });

    const problemsList = problems.map((p, i) => 
      `${i + 1}. [${(p.severidad || 'media').toUpperCase()}] ${p.tipo}: ${p.descripcion}${p.accionSugerida ? ` -> ${p.accionSugerida}` : ""}`
    ).join("\n");

    const prompt = `CORRECCIÓN QUIRÚRGICA - Capítulo ${chapterNumber}

IDIOMA: ${language}

PROBLEMAS A CORREGIR:
${problemsList}

BIBLIA DEL MUNDO:
${worldBibleSummary}

CAPÍTULO:
${chapterContent}

═══════════════════════════════════════════════════════════════
INSTRUCCIONES CRÍTICAS:
═══════════════════════════════════════════════════════════════
1. Identifica SOLO las frases o párrafos que causan cada problema
2. Genera parches MÍNIMOS - NO reescribas el capítulo completo
3. Cada parche "original" debe tener al menos 30 caracteres para garantizar unicidad
4. Mantén el estilo y vocabulario exacto del autor
5. Si un problema se resuelve cambiando 1 palabra, cambia SOLO esa palabra

RESPONDE EN JSON:
{
  "analisis": "Breve descripción de los problemas y dónde están",
  "patches": [
    {
      "original": "texto exacto a reemplazar (mín 30 chars, copiar literalmente del texto)",
      "replacement": "texto corregido manteniendo estilo del autor"
    }
  ],
  "resumenCambios": "Resumen de las correcciones quirúrgicas aplicadas"
}`;

    console.log(`[NarrativeRewriter] Surgical fix for chapter ${chapterNumber} with ${problems.length} problems`);
    
    const response = await this.generateContent(prompt);
    let patches: Array<{ original: string; replacement: string }> = [];
    let resumenCambios = "";
    
    try {
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        patches = (result.patches || []).filter((p: any) => 
          p.original && p.replacement && p.original.length >= 30
        );
        resumenCambios = result.resumenCambios || "";
        console.log(`[NarrativeRewriter] Generated ${patches.length} surgical patches for chapter ${chapterNumber}`);
        patches.forEach((p, i) => {
          console.log(`  ${i + 1}. "${p.original.substring(0, 50)}..." → "${p.replacement.substring(0, 50)}..."`);
        });
      }
    } catch (e) {
      console.error("[NarrativeRewriter] Failed to parse surgical fix response:", e);
    }
    
    return { patches, tokenUsage: response.tokenUsage, resumenCambios };
  }

  private buildWorldBibleContext(worldBible: any): string {
    if (!worldBible) return "No hay Biblia del Mundo disponible.";
    
    const sections: string[] = [];
    
    if (worldBible.personajes?.length > 0) {
      const chars = worldBible.personajes.slice(0, 20).map((p: any) => 
        `• ${p.nombre} (${p.rol || 'secundario'}): ${p.descripcion?.substring(0, 150) || 'Sin descripción'}${p.arcoNarrativo ? ` | Arco: ${p.arcoNarrativo.substring(0, 100)}` : ''}`
      ).join("\n");
      sections.push(`PERSONAJES:\n${chars}`);
    }
    
    if (worldBible.ubicaciones?.length > 0) {
      const locs = worldBible.ubicaciones.slice(0, 10).map((u: any) => 
        `• ${u.nombre}: ${u.descripcion?.substring(0, 100) || 'Sin descripción'}`
      ).join("\n");
      sections.push(`UBICACIONES:\n${locs}`);
    }
    
    if (worldBible.timeline?.length > 0) {
      const events = worldBible.timeline.slice(0, 15).map((t: any) => 
        `• ${t.evento}: ${t.descripcion?.substring(0, 80) || ''}`
      ).join("\n");
      sections.push(`TIMELINE:\n${events}`);
    }
    
    if (worldBible.reglas?.length > 0) {
      const rules = worldBible.reglas.slice(0, 10).map((r: any) => 
        `• ${typeof r === 'string' ? r : r.regla || JSON.stringify(r)}`
      ).join("\n");
      sections.push(`REGLAS DEL MUNDO:\n${rules}`);
    }
    
    return sections.join("\n\n") || "Biblia del Mundo vacía.";
  }

  private buildAdjacentContext(context: { previousChapter?: string; nextChapter?: string; previousSummary?: string; nextSummary?: string }): string {
    const parts: string[] = [];
    
    if (context.previousSummary) {
      parts.push(`CAPÍTULO ANTERIOR (resumen):\n${context.previousSummary}`);
    } else if (context.previousChapter) {
      parts.push(`CAPÍTULO ANTERIOR (extracto):\n${context.previousChapter.substring(0, 2000)}...`);
    }
    
    if (context.nextSummary) {
      parts.push(`CAPÍTULO SIGUIENTE (resumen):\n${context.nextSummary}`);
    } else if (context.nextChapter) {
      parts.push(`CAPÍTULO SIGUIENTE (extracto):\n${context.nextChapter.substring(0, 2000)}...`);
    }
    
    return parts.join("\n\n") || "No hay contexto de capítulos adyacentes disponible.";
  }

  private buildProblemsList(problems: Array<{ id?: string; tipo: string; descripcion: string; severidad: string; accionSugerida?: string }>, chapterNumber: number): string {
    return problems.map((p, i) => {
      const id = p.id || `P${i + 1}`;
      const severity = p.severidad?.toUpperCase() || 'MEDIA';
      const type = p.tipo || 'general';
      const suggestion = p.accionSugerida ? `\n   ACCIÓN SUGERIDA: ${p.accionSugerida}` : '';
      
      return `[${id}] [${severity}] ${type}
   ${p.descripcion}${suggestion}`;
    }).join("\n\n");
  }
}

class ReeditFinalReviewerAgent extends BaseAgent {
  constructor() {
    super({
      name: "Revisor Final de Re-edición",
      role: "final_reviewer",
      systemPrompt: `Eres un experto de la industria editorial evaluando manuscritos para potencial de bestseller.
IMPORTANTE: Todas tus respuestas deben estar en ESPAÑOL.

Evalúa el manuscrito y proporciona:
1. Puntuación de bestseller (1-10)
2. Fortalezas principales
3. Áreas que necesitan mejora
4. Evaluación del potencial de mercado
5. Recomendaciones para el autor

RESPONDE ÚNICAMENTE CON JSON EN ESPAÑOL:
{
  "bestsellerScore": 8,
  "strengths": ["Trama atrapante", "Personajes bien desarrollados"],
  "weaknesses": ["Problemas de ritmo en la parte central"],
  "marketPotential": "alto",
  "recommendations": ["Apretar el segundo acto", "Fortalecer el final"]
}`,
      model: "deepseek-reasoner",
      useThinking: false,
    });
  }

  async execute(input: any): Promise<any> {
    return this.reviewManuscript(input.summaries, input.totalChapters, input.totalWords);
  }

  async reviewManuscript(summaries: string[], totalChapters: number, totalWords: number): Promise<any> {
    const prompt = `Evalúa este manuscrito para determinar su potencial de bestseller.
IMPORTANTE: Responde COMPLETAMENTE EN ESPAÑOL.

ESTADÍSTICAS DEL MANUSCRITO:
- Total de Capítulos: ${totalChapters}
- Total de Palabras: ${totalWords}

RESÚMENES Y CALIDAD DE LOS CAPÍTULOS:
${summaries.join("\n\n")}

Proporciona tu evaluación en formato JSON, con todos los textos en ESPAÑOL.`;
    
    const response = await this.generateContent(prompt);
    let result: any = { bestsellerScore: 7, strengths: [], weaknesses: [], recommendations: [], marketPotential: "moderate" };
    try {
      // Try to find JSON in content first
      let jsonContent = response.content || "";
      
      console.log(`[ReeditFinalReviewer] Response received - content length: ${jsonContent.length}, thoughtSignature length: ${response.thoughtSignature?.length || 0}`);
      
      // If content is empty but thoughtSignature has content, try to extract from there
      if (jsonContent.trim().length === 0 && response.thoughtSignature && response.thoughtSignature.length > 0) {
        console.log("[ReeditFinalReviewer] Content empty, checking thoughtSignature for JSON...");
        
        // Try to find JSON with bestsellerScore first
        const scoreMatch = response.thoughtSignature.match(/(\{[\s\S]*?"bestsellerScore"[\s\S]*?\})/);
        if (scoreMatch) {
          try {
            JSON.parse(scoreMatch[1]);
            jsonContent = scoreMatch[1];
            console.log("[ReeditFinalReviewer] Found valid JSON with bestsellerScore in thoughtSignature");
          } catch {
            // Not valid, try broader match
          }
        }
        
        // If still empty, try any JSON
        if (jsonContent.trim().length === 0) {
          const jsonInThought = response.thoughtSignature.match(/\{[\s\S]*\}/);
          if (jsonInThought) {
            try {
              JSON.parse(jsonInThought[0]);
              jsonContent = jsonInThought[0];
              console.log("[ReeditFinalReviewer] Found valid JSON in thoughtSignature (generic match)");
            } catch {
              console.log("[ReeditFinalReviewer] Found JSON-like structure but couldn't parse");
            }
          }
        }
      }
      
      // Also check if content has JSON wrapped in code blocks
      if (jsonContent.includes("```")) {
        const codeBlockMatch = jsonContent.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (codeBlockMatch) {
          jsonContent = codeBlockMatch[1].trim();
          console.log("[ReeditFinalReviewer] Extracted JSON from code block");
        }
      }
      
      const jsonMatch = jsonContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        // Check multiple possible score field names
        const score = parsed.bestsellerScore || parsed.puntuacion_global || parsed.score || parsed.puntuacionGlobal;
        if (score !== undefined && score > 0) {
          parsed.bestsellerScore = score;
          result = parsed;
          console.log(`[ReeditFinalReviewer] Successfully parsed response: score ${result.bestsellerScore}/10`);
        } else {
          console.warn(`[ReeditFinalReviewer] Parsed JSON but no valid score found`);
        }
      }
    } catch (e) {
      console.error("[ReeditFinalReviewer] Failed to parse response:", e);
      console.error("[ReeditFinalReviewer] Content preview:", response.content?.substring(0, 500) || "EMPTY");
      if (response.thoughtSignature) {
        console.error("[ReeditFinalReviewer] ThoughtSignature preview:", response.thoughtSignature.substring(0, 500));
      }
    }
    result.tokenUsage = response.tokenUsage;
    return result;
  }
}

export class ReeditOrchestrator {
  private editorAgent: ReeditEditorAgent;
  private copyEditorAgent: ReeditCopyEditorAgent;
  private quickFinalReviewerAgent: ReeditFinalReviewerAgent;
  private fullFinalReviewerAgent: FinalReviewerAgent;
  private worldBibleExtractor: WorldBibleExtractorAgent;
  private architectAnalyzer: ArchitectAnalyzerAgent;
  private structuralFixer: StructuralFixerAgent;
  private narrativeRewriter: NarrativeRewriterAgent;
  private continuitySentinel: ContinuitySentinelAgent;
  private voiceRhythmAuditor: VoiceRhythmAuditorAgent;
  private semanticRepetitionDetector: SemanticRepetitionDetectorAgent;
  private anachronismDetector: AnachronismDetectorAgent;
  private forensicAuditor: ForensicConsistencyAuditor;
  private betaReader: BetaReaderAgent;
  private expansionAnalyzer: ChapterExpansionAnalyzer;
  private chapterExpander: ChapterExpanderAgent;
  private newChapterGenerator: NewChapterGeneratorAgent;
  private progressCallback: ProgressCallback | null = null;
  
  private totalInputTokens: number = 0;
  private totalOutputTokens: number = 0;
  private totalThinkingTokens: number = 0;
  
  private maxFinalReviewCycles = 10;
  private minAcceptableScore = 9; // Acepta 9+ como suficiente (antes era 10)
  private requiredConsecutiveHighScores = 1; // Solo necesita 1 puntuación 9+ sin issues críticos (antes eran 2)

  constructor() {
    this.editorAgent = new ReeditEditorAgent();
    this.copyEditorAgent = new ReeditCopyEditorAgent();
    this.quickFinalReviewerAgent = new ReeditFinalReviewerAgent();
    this.fullFinalReviewerAgent = new FinalReviewerAgent();
    this.worldBibleExtractor = new WorldBibleExtractorAgent();
    this.architectAnalyzer = new ArchitectAnalyzerAgent();
    this.structuralFixer = new StructuralFixerAgent();
    this.narrativeRewriter = new NarrativeRewriterAgent();
    this.continuitySentinel = new ContinuitySentinelAgent();
    this.voiceRhythmAuditor = new VoiceRhythmAuditorAgent();
    this.semanticRepetitionDetector = new SemanticRepetitionDetectorAgent();
    this.anachronismDetector = new AnachronismDetectorAgent();
    this.forensicAuditor = new ForensicConsistencyAuditor();
    this.betaReader = new BetaReaderAgent();
    this.expansionAnalyzer = new ChapterExpansionAnalyzer();
    this.chapterExpander = new ChapterExpanderAgent();
    this.newChapterGenerator = new NewChapterGeneratorAgent();
  }
  
  private trackTokens(response: any) {
    if (response?.tokenUsage) {
      this.totalInputTokens += response.tokenUsage.inputTokens || 0;
      this.totalOutputTokens += response.tokenUsage.outputTokens || 0;
      this.totalThinkingTokens += response.tokenUsage.thinkingTokens || 0;
    }
  }
  
  /**
   * Analyze issues to identify recurrent categories that keep appearing
   * This helps diagnose WHY quality isn't improving
   */
  private analyzeRecurrentIssues(issues: any[]): string[] {
    const categoryCount: Record<string, number> = {};
    
    for (const issue of issues) {
      const category = issue.categoria || "sin_categoria";
      categoryCount[category] = (categoryCount[category] || 0) + 1;
    }
    
    // Return categories that appear more than once
    return Object.entries(categoryCount)
      .filter(([_, count]) => count > 1)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([cat, count]) => `${cat} (${count}x)`);
  }

  /**
   * Smart chapter correction: uses surgical fix for minor issues, full rewrite for critical ones
   * This saves significant tokens when only small fixes are needed
   */
  private async smartCorrectChapter(
    chapterContent: string,
    chapterNumber: number,
    problems: Array<{ id?: string; tipo: string; descripcion: string; severidad: string; accionSugerida?: string }>,
    worldBible: any,
    adjacentContext: { previousChapter?: string; nextChapter?: string },
    language: string,
    userInstructions?: string
  ): Promise<{ content: string | null; method: 'surgical' | 'full' | 'failed' }> {
    // Determine if surgical fix is appropriate
    const hasCriticalIssues = problems.some((p: any) => 
      p.severidad === 'critica' || p.severidad === 'critical'
    );
    
    // Issues that ALWAYS require full rewrite (cannot be fixed with simple patches)
    const requiresFullRewriteTypes = [
      'timeline', 'temporal', 'tiempo', 
      'ubicacion', 'geografica', 'geography', 'location',
      'continuidad_fisica', 'physical', 'injury', 'lesion',
      'ritmo', 'pacing', 'transition',
      'coherencia', 'continuity', 'consistency',
      'estructura', 'structure',
      'arco', 'arc', 'character_arc'
    ];
    
    const hasStructuralIssues = problems.some((p: any) => {
      const tipoLower = (p.tipo || '').toLowerCase();
      const descLower = (p.descripcion || '').toLowerCase();
      return requiresFullRewriteTypes.some(keyword => 
        tipoLower.includes(keyword) || descLower.includes(keyword)
      ) || 
      // Also detect by description content
      descLower.includes('teletransport') ||
      descLower.includes('recuperación milagrosa') ||
      descLower.includes('miraculous recovery') ||
      descLower.includes('viaje imposible') ||
      descLower.includes('impossible travel') ||
      descLower.includes('herida ignorada') ||
      descLower.includes('injury ignored') ||
      descLower.includes('lesión') ||
      descLower.includes('transición abrupta');
    });
    
    // Only use surgical fix for truly minor issues
    const useSurgicalFix = problems.length <= 2 && !hasCriticalIssues && !hasStructuralIssues;
    
    if (hasStructuralIssues) {
      console.log(`[ReeditOrchestrator] Chapter ${chapterNumber} has STRUCTURAL issues (coherence/timeline/physical) - forcing FULL REWRITE`);
    }
    
    // Try surgical fix first for minor issues
    if (useSurgicalFix) {
      console.log(`[ReeditOrchestrator] Using SURGICAL FIX for chapter ${chapterNumber} (${problems.length} minor problems)`);
      try {
        const surgicalResult = await this.narrativeRewriter.surgicalFix(
          chapterContent,
          chapterNumber,
          problems,
          worldBible || {},
          language
        );
        this.trackTokens(surgicalResult);
        
        if (surgicalResult.patches && surgicalResult.patches.length > 0) {
          const patchResult: SimplePatchResult = applySimplePatches(chapterContent, surgicalResult.patches);
          if (patchResult.success && patchResult.patchedContent) {
            console.log(`[ReeditOrchestrator] Applied ${patchResult.appliedCount} surgical patches to chapter ${chapterNumber}`);
            return { content: patchResult.patchedContent, method: 'surgical' };
          }
        }
        console.log(`[ReeditOrchestrator] Surgical fix produced no valid patches for chapter ${chapterNumber}, falling back to full rewrite`);
      } catch (err) {
        console.error(`[ReeditOrchestrator] Surgical fix error for chapter ${chapterNumber}:`, err);
      }
    }
    
    // Full rewrite for critical issues or when surgical fix fails
    console.log(`[ReeditOrchestrator] Using FULL REWRITE for chapter ${chapterNumber} (${problems.length} problems, critical: ${hasCriticalIssues})`);
    try {
      const rewriteResult = await this.narrativeRewriter.rewriteChapter(
        chapterContent,
        chapterNumber,
        problems,
        worldBible || {},
        adjacentContext,
        language,
        userInstructions
      );
      this.trackTokens(rewriteResult);
      
      if (rewriteResult.capituloReescrito) {
        return { content: rewriteResult.capituloReescrito, method: 'full' };
      }
    } catch (err) {
      console.error(`[ReeditOrchestrator] Full rewrite error for chapter ${chapterNumber}:`, err);
    }
    
    return { content: null, method: 'failed' };
  }
  
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
        console.log(`[ReeditOrchestrator] Filtering resolved issue: ${issue.categoria} - ${issue.descripcion?.substring(0, 50)}...`);
        filteredCount++;
      } else {
        newIssues.push(issue);
      }
    }
    
    if (filteredCount > 0) {
      console.log(`[ReeditOrchestrator] Filtered ${filteredCount} previously resolved issues, ${newIssues.length} new issues remain`);
    }
    
    return { newIssues, filteredCount };
  }
  
  /**
   * Mark issues as resolved by adding their hashes to the project's resolved list
   * AND updating the status in reedit_issues table so user can see them as "tachados".
   */
  private async markIssuesResolved(projectId: number, issues: FinalReviewIssue[]): Promise<void> {
    if (issues.length === 0) return;
    
    const project = await storage.getReeditProject(projectId);
    const existingHashes = (project?.resolvedIssueHashes as string[]) || [];
    
    const newHashes = issues.map(issue => this.generateIssueHash(issue));
    const combinedHashes = [...existingHashes, ...newHashes];
    const allHashes = combinedHashes.filter((hash, index) => combinedHashes.indexOf(hash) === index);
    
    await storage.updateReeditProject(projectId, {
      resolvedIssueHashes: allHashes as any,
    });
    
    // ALSO update reedit_issues table to mark as "resolved" so UI shows them as tachados
    const allIssuesInDb = await storage.getReeditIssuesByProject(projectId);
    let resolvedInDb = 0;
    for (const hash of newHashes) {
      const matchingIssue = allIssuesInDb.find(i => i.issueHash === hash);
      if (matchingIssue && matchingIssue.status !== "resolved") {
        await storage.resolveReeditIssue(matchingIssue.id);
        resolvedInDb++;
      }
    }
    
    console.log(`[ReeditOrchestrator] Marked ${newHashes.length} issues as resolved (total hashes: ${allHashes.length}, DB records: ${resolvedInDb})`);
  }
  
  /**
   * Create issue records in the database for user review before auto-correction.
   * Returns the number of issues created.
   */
  private async createIssueRecords(
    projectId: number,
    issues: FinalReviewIssue[],
    revisionCycle: number
  ): Promise<number> {
    if (issues.length === 0) return 0;
    
    // Clear previous pending issues (only keep resolved/rejected)
    const existingIssues = await storage.getReeditIssuesByProject(projectId);
    for (const issue of existingIssues) {
      if (issue.status === "pending" || issue.status === "approved") {
        // Remove stale pending/approved issues - they'll be recreated from fresh review
        await storage.updateReeditIssue(issue.id, { status: "rejected", rejectionReason: "Replaced by new review cycle" });
      }
    }
    
    let created = 0;
    for (const issue of issues) {
      const hash = this.generateIssueHash(issue);
      
      // Map severity from Spanish to English
      let severity: "critical" | "major" | "minor" | "suggestion" = "minor";
      const sev = issue.severidad as string;
      if (sev === "critica" || sev === "crítica") {
        severity = "critical";
      } else if (sev === "mayor") {
        severity = "major";
      } else if (sev === "menor") {
        severity = "minor";
      }
      
      // Get first affected chapter (for chapter-level tracking)
      const chapterNumber = issue.capitulos_afectados?.[0] || 1;
      
      await storage.createReeditIssue({
        projectId,
        chapterNumber,
        category: issue.categoria || "general",
        severity,
        description: issue.descripcion || "",
        textCitation: issue.elementos_a_preservar || null,
        correctionInstruction: issue.instrucciones_correccion || null,
        source: "final_reviewer",
        status: "pending",
        issueHash: hash,
        reviewCycle: revisionCycle,
      });
      created++;
    }
    
    console.log(`[ReeditOrchestrator] Created ${created} issue records for user review`);
    return created;
  }

  /**
   * Apply corrections for user-approved issues only. 
   * This is the LINEAR FLOW - after corrections are applied, the process ends.
   * Updates resolved hashes, correction counts, and change history to maintain consistent state.
   */
  private async applyUserApprovedCorrections(
    projectId: number,
    approvedIssues: any[],
    validChapters: any[],
    worldBible: any,
    guiaEstilo: string,
    userInstructions: string | undefined,
    resolvedHashes: string[],
    correctionCounts: Map<number, number>
  ): Promise<{ correctedCount: number }> {
    if (approvedIssues.length === 0) {
      console.log(`[ReeditOrchestrator] No approved issues to apply`);
      return { correctedCount: 0 };
    }

    console.log(`[ReeditOrchestrator] Applying ${approvedIssues.length} user-approved corrections`);
    let correctedCount = 0;
    
    // Load existing change history from project
    const project = await storage.getReeditProject(projectId);
    const chapterChangeHistory = new Map<number, Array<{ issue: string; fix: string; timestamp: string }>>(
      Object.entries((project?.chapterChangeHistory as any) || {}).map(([k, v]) => [parseInt(k), v as any])
    );

    // Group issues by chapter
    const issuesByChapter = new Map<number, any[]>();
    for (const issue of approvedIssues) {
      const chapterNum = issue.chapterNumber;
      if (!issuesByChapter.has(chapterNum)) {
        issuesByChapter.set(chapterNum, []);
      }
      issuesByChapter.get(chapterNum)!.push(issue);
    }

    // Apply corrections chapter by chapter
    for (const [chapterNum, chapterIssues] of issuesByChapter) {
      const chapter = validChapters.find((c: any) => c.chapterNumber === chapterNum);
      if (!chapter) {
        console.log(`[ReeditOrchestrator] Chapter ${chapterNum} not found, skipping`);
        continue;
      }

      console.log(`[ReeditOrchestrator] Applying ${chapterIssues.length} corrections to chapter ${chapterNum}`);

      // Map severity from database format to expected format
      const mapSeverity = (sev: string): string => {
        if (sev === "critical" || sev === "critica" || sev === "crítica") return "critica";
        if (sev === "major" || sev === "mayor") return "mayor";
        return "menor";
      };

      // Convert database issues to problem format for NarrativeRewriter
      const problems = chapterIssues.map((issue: any, idx: number) => ({
        id: `issue-${idx}`,
        tipo: issue.category || "otro",
        descripcion: issue.description,
        severidad: mapSeverity(issue.severity || "mayor"),
        accionSugerida: issue.correctionInstruction || "Corregir según indicación del usuario"
      }));

      // Build adjacent context
      const prevChapter = validChapters.find((c: any) => c.chapterNumber === chapterNum - 1);
      const nextChapter = validChapters.find((c: any) => c.chapterNumber === chapterNum + 1);
      const adjacentContext = {
        previousChapter: prevChapter?.editedContent?.substring(0, 2000),
        nextChapter: nextChapter?.editedContent?.substring(0, 2000),
      };

      try {
        const chapterContent = chapter.editedContent || chapter.originalContent;
        
        // Use smartCorrectChapter which automatically chooses surgical fix or full rewrite
        const correctionResult = await this.smartCorrectChapter(
          chapterContent,
          chapterNum,
          problems,
          worldBible || {},
          adjacentContext,
          "español",
          userInstructions || undefined
        );
        await this.updateHeartbeat(projectId);

        if (correctionResult.content) {
          const wordCount = correctionResult.content.split(/\s+/).filter((w: string) => w.length > 0).length;
          await storage.updateReeditChapter(chapter.id, {
            editedContent: correctionResult.content,
            wordCount,
          });
          
          // Update correction count for this chapter
          const currentCount = correctionCounts.get(chapterNum) || 0;
          correctionCounts.set(chapterNum, currentCount + 1);
          
          // Add issue hashes to resolved list AND mark as resolved in DB
          for (const issue of chapterIssues) {
            if (issue.issueHash && !resolvedHashes.includes(issue.issueHash)) {
              resolvedHashes.push(issue.issueHash);
            }
            // Mark issue as resolved in DB so it shows as "tachado" in UI
            if (issue.id) {
              await storage.resolveReeditIssue(issue.id);
            }
          }
          
          // Save change history for this chapter
          const issuesSummary = chapterIssues.map((i: any) => i.description?.substring(0, 300) || "").join("; ");
          const changesSummary = `Corrección ${correctionResult.method === 'surgical' ? 'quirúrgica' : 'completa'}: ${problems.length} problemas`;
          let existingHistory = chapterChangeHistory.get(chapterNum) || [];
          existingHistory.push({
            issue: issuesSummary,
            fix: changesSummary,
            timestamp: new Date().toISOString()
          });
          // Keep only last 10 entries to prevent bloat
          if (existingHistory.length > 10) existingHistory = existingHistory.slice(-10);
          chapterChangeHistory.set(chapterNum, existingHistory);
          
          correctedCount++;
          console.log(`[ReeditOrchestrator] Chapter ${chapterNum} corrected successfully (${wordCount} words)`);

          this.emitProgress({
            projectId,
            stage: "correcting",
            currentChapter: chapterNum,
            totalChapters: validChapters.length,
            message: `Capítulo ${chapterNum} corregido (${chapterIssues.length} problema(s))`,
          });
        }
      } catch (err) {
        console.error(`[ReeditOrchestrator] Error correcting chapter ${chapterNum}:`, err);
      }
    }
    
    // Persist all state to database to match main correction pipeline
    await storage.updateReeditProject(projectId, {
      chapterCorrectionCounts: Object.fromEntries(correctionCounts) as any,
      chapterChangeHistory: Object.fromEntries(chapterChangeHistory) as any,
      resolvedIssueHashes: resolvedHashes as any,
    });

    console.log(`[ReeditOrchestrator] Completed applying ${correctedCount} user-approved corrections (state persisted)`);
    return { correctedCount };
  }

  private async saveTokenUsage(projectId: number) {
    await storage.updateReeditProject(projectId, {
      totalInputTokens: this.totalInputTokens,
      totalOutputTokens: this.totalOutputTokens,
      totalThinkingTokens: this.totalThinkingTokens,
    });
    console.log(`[ReeditOrchestrator] Token usage saved: ${this.totalInputTokens} input, ${this.totalOutputTokens} output, ${this.totalThinkingTokens} thinking`);
  }

  private async updateHeartbeat(projectId: number, lastCompletedChapter?: number) {
    const updates: any = { 
      heartbeatAt: new Date(),
      totalInputTokens: this.totalInputTokens,
      totalOutputTokens: this.totalOutputTokens,
      totalThinkingTokens: this.totalThinkingTokens,
    };
    if (lastCompletedChapter !== undefined) {
      updates.lastCompletedChapter = lastCompletedChapter;
    }
    await storage.updateReeditProject(projectId, updates);
  }

  private updateChapterTitleNumber(title: string | null, newChapterNumber: number): string {
    if (!title) return `Capítulo ${newChapterNumber}`;
    
    // Match patterns like "Capítulo X:", "Capítulo X -", "Capítulo X" at the start
    const chapterPrefixPattern = /^Capítulo\s+\d+\s*[:|-]?\s*/i;
    
    if (chapterPrefixPattern.test(title)) {
      // Extract the subtitle (everything after the prefix)
      const subtitle = title.replace(chapterPrefixPattern, '').trim();
      if (subtitle) {
        return `Capítulo ${newChapterNumber}: ${subtitle}`;
      } else {
        return `Capítulo ${newChapterNumber}`;
      }
    }
    
    // Special titles that should NOT get "Capítulo X:" prefix
    const specialTitles = /^(prólogo|epílogo|preludio|interludio|epilogue|prologue|prelude|interlude)/i;
    if (specialTitles.test(title.trim())) {
      return title;
    }
    
    // For inserted chapters or chapters without prefix, ADD the "Capítulo X:" prefix
    // This ensures all regular chapters have consistent naming
    return `Capítulo ${newChapterNumber}: ${title}`;
  }

  /**
   * Update the chapter header inside the content text to match new chapter number.
   * This ensures the internal text reflects the correct chapter numbering.
   * Returns the updated content, or the original if no header was found.
   */
  private normalizeChapterHeaderContent(
    content: string | null,
    newChapterNumber: number,
    updatedTitle: string
  ): string | null {
    if (!content) return content;
    
    // Special titles that should NOT be renumbered
    const specialTitles = /^(prólogo|epílogo|preludio|interludio|epilogue|prologue|prelude|interlude)/i;
    if (specialTitles.test(updatedTitle.trim())) {
      return content;
    }
    
    // Pattern to match chapter headers at the start of content (with variations)
    // Matches: "Capítulo X", "Capítulo X:", "Capítulo X -", "CAPÍTULO X", "Chapter X", etc.
    // Also handles "Capitulo" without accent, roman numerals, etc.
    const headerPatterns = [
      // Spanish: Capítulo X: Título or Capítulo X - Título or just Capítulo X
      /^(Capítulo|Capitulo|CAPÍTULO|CAPITULO)\s+(\d+|[IVXLCDM]+)\s*[:|-]?\s*([^\n]*)/im,
      // English: Chapter X: Title
      /^(Chapter|CHAPTER)\s+(\d+|[IVXLCDM]+)\s*[:|-]?\s*([^\n]*)/im,
      // French: Chapitre X
      /^(Chapitre|CHAPITRE)\s+(\d+|[IVXLCDM]+)\s*[:|-]?\s*([^\n]*)/im,
      // Italian: Capitolo X
      /^(Capitolo|CAPITOLO)\s+(\d+|[IVXLCDM]+)\s*[:|-]?\s*([^\n]*)/im,
      // German: Kapitel X
      /^(Kapitel|KAPITEL)\s+(\d+|[IVXLCDM]+)\s*[:|-]?\s*([^\n]*)/im,
      // Catalan: Capítol X
      /^(Capítol|Capitol|CAPÍTOL|CAPITOL)\s+(\d+|[IVXLCDM]+)\s*[:|-]?\s*([^\n]*)/im,
    ];
    
    for (const pattern of headerPatterns) {
      const match = content.match(pattern);
      if (match) {
        const keyword = match[1]; // e.g., "Capítulo", "Chapter"
        // Reconstruct the header with the new number
        // Use the title directly as it already has the correct format
        const newHeader = updatedTitle;
        
        // Replace the old header with the new one
        const updatedContent = content.replace(pattern, newHeader);
        
        if (updatedContent !== content) {
          console.log(`[ReeditOrchestrator] Updated internal header: "${match[0].substring(0, 50)}..." -> "${newHeader}"`);
          return updatedContent;
        }
        break;
      }
    }
    
    return content;
  }

  private buildAdjacentChapterContext(
    chapters: ReeditChapter[],
    currentChapterNumber: number
  ): { previousChapter?: string; nextChapter?: string; previousSummary?: string; nextSummary?: string } {
    const sortedChapters = [...chapters].sort((a, b) => getChapterSortOrder(a.chapterNumber) - getChapterSortOrder(b.chapterNumber));
    const currentIndex = sortedChapters.findIndex(c => c.chapterNumber === currentChapterNumber);
    
    const context: { previousChapter?: string; nextChapter?: string; previousSummary?: string; nextSummary?: string } = {};
    
    if (currentIndex > 0) {
      const prevChapter = sortedChapters[currentIndex - 1];
      context.previousChapter = prevChapter.originalContent?.substring(0, 3000);
      context.previousSummary = `Capítulo ${prevChapter.chapterNumber}: ${prevChapter.title || 'Sin título'}`;
    }
    
    if (currentIndex < sortedChapters.length - 1) {
      const nextChapter = sortedChapters[currentIndex + 1];
      context.nextChapter = nextChapter.originalContent?.substring(0, 3000);
      context.nextSummary = `Capítulo ${nextChapter.chapterNumber}: ${nextChapter.title || 'Sin título'}`;
    }
    
    return context;
  }

  private async checkCancellation(projectId: number): Promise<boolean> {
    const project = await storage.getReeditProject(projectId);
    if (project?.cancelRequested) {
      console.log(`[ReeditOrchestrator] Cancellation requested for project ${projectId}`);
      await storage.updateReeditProject(projectId, {
        status: "paused",
        cancelRequested: false,
        errorMessage: "Cancelado por el usuario",
      });
      return true;
    }
    return false;
  }

  private async expandManuscript(
    projectId: number,
    project: ReeditProject,
    validChapters: ReeditChapter[],
    worldBible: any
  ): Promise<ReeditChapter[]> {
    const enableExpansion = project.expandChapters || false;
    const enableNewChapters = project.insertNewChapters || false;
    const targetMinWords = project.targetMinWordsPerChapter || 2000;

    if (!enableExpansion && !enableNewChapters) {
      console.log(`[ReeditOrchestrator] Expansion disabled for project ${projectId}`);
      return validChapters;
    }

    console.log(`[ReeditOrchestrator] Starting manuscript expansion`);
    console.log(`  - Expand existing chapters: ${enableExpansion}`);
    console.log(`  - Insert new chapters: ${enableNewChapters}`);
    console.log(`  - Target min words/chapter: ${targetMinWords}`);

    const projectGenre = (project as any).genre || "thriller literario";
    
    let plan = project.expansionPlan as any;
    
    // Constants for necessity filtering
    const EXPANSION_THRESHOLD = 0.7;
    const NEW_CHAPTER_THRESHOLD = 0.8;
    
    if (plan && plan.chaptersToExpand) {
      console.log(`[ReeditOrchestrator] Reusing existing expansion plan from database`);
      
      // Apply necessity filtering to reused plans as well (in case they're from before filtering was added)
      const originalExpandCount = plan.chaptersToExpand?.length || 0;
      const originalInsertCount = plan.newChaptersToInsert?.length || 0;
      
      if (plan.chaptersToExpand) {
        plan.chaptersToExpand = plan.chaptersToExpand.filter((exp: any) => {
          const score = exp.necessityScore ?? 1.0; // Legacy plans without score: assume they were needed
          if (score < EXPANSION_THRESHOLD) {
            console.log(`[ReeditOrchestrator] Filtering out expansion of chapter ${exp.chapterNumber} (necessityScore: ${score} < ${EXPANSION_THRESHOLD})`);
            return false;
          }
          return true;
        });
      }
      
      if (plan.newChaptersToInsert) {
        plan.newChaptersToInsert = plan.newChaptersToInsert.filter((ins: any) => {
          const score = ins.necessityScore ?? 1.0; // Legacy plans without score: assume they were needed
          if (score < NEW_CHAPTER_THRESHOLD) {
            console.log(`[ReeditOrchestrator] Filtering out new chapter "${ins.title}" after ch ${ins.insertAfterChapter} (necessityScore: ${score} < ${NEW_CHAPTER_THRESHOLD})`);
            return false;
          }
          return true;
        });
      }
      
      console.log(`  - Chapters to expand: ${plan.chaptersToExpand?.length || 0} (after filtering from ${originalExpandCount})`);
      console.log(`  - New chapters to insert: ${plan.newChaptersToInsert?.length || 0} (after filtering from ${originalInsertCount})`);
    } else {
      this.emitProgress({
        projectId,
        stage: "expansion",
        currentChapter: 0,
        totalChapters: validChapters.length,
        message: "Analizando manuscrito para expansión...",
      });

      const chapterSummaries = validChapters.map(c => ({
        chapterNumber: c.chapterNumber,
        title: c.title || `Capítulo ${c.chapterNumber}`,
        wordCount: c.wordCount || c.originalContent.split(/\s+/).length,
        summary: c.originalContent.substring(0, 1500) + (c.originalContent.length > 1500 ? "..." : ""),
      }));

      const analysisResult = await this.expansionAnalyzer.execute({
        chapters: chapterSummaries,
        genre: projectGenre,
        targetMinWordsPerChapter: targetMinWords,
        enableNewChapters,
        enableChapterExpansion: enableExpansion,
      });
      this.trackTokens(analysisResult);

      if (!analysisResult.result) {
        console.log(`[ReeditOrchestrator] Expansion analysis failed, continuing without expansion`);
        return validChapters;
      }

      plan = analysisResult.result;
      
      // Filter by necessity score - only keep items that are truly necessary
      const originalExpandCount = plan.chaptersToExpand?.length || 0;
      const originalInsertCount = plan.newChaptersToInsert?.length || 0;
      
      // Filter expansions by necessity score
      if (plan.chaptersToExpand) {
        plan.chaptersToExpand = plan.chaptersToExpand.filter((exp: any) => {
          const score = exp.necessityScore || 0;
          if (score < EXPANSION_THRESHOLD) {
            console.log(`[ReeditOrchestrator] Filtering out expansion of chapter ${exp.chapterNumber} (necessityScore: ${score} < ${EXPANSION_THRESHOLD})`);
            return false;
          }
          return true;
        });
      }
      
      // Filter new chapter insertions by necessity score (stricter threshold)
      if (plan.newChaptersToInsert) {
        plan.newChaptersToInsert = plan.newChaptersToInsert.filter((ins: any) => {
          const score = ins.necessityScore || 0;
          if (score < NEW_CHAPTER_THRESHOLD) {
            console.log(`[ReeditOrchestrator] Filtering out new chapter "${ins.title}" after ch ${ins.insertAfterChapter} (necessityScore: ${score} < ${NEW_CHAPTER_THRESHOLD})`);
            return false;
          }
          console.log(`[ReeditOrchestrator] Keeping new chapter "${ins.title}" (necessityScore: ${score}, justification: ${ins.justification || 'N/A'})`);
          return true;
        });
      }
      
      console.log(`[ReeditOrchestrator] Expansion plan created:`);
      console.log(`  - Chapters to expand: ${plan.chaptersToExpand?.length || 0} (filtered from ${originalExpandCount})`);
      console.log(`  - New chapters to insert: ${plan.newChaptersToInsert?.length || 0} (filtered from ${originalInsertCount})`);
      console.log(`  - Overall necessity: ${plan.overallNecessityAssessment || 'unknown'}`);
      console.log(`  - Estimated new words: ${plan.totalEstimatedNewWords || 0}`);

      await storage.updateReeditProject(projectId, {
        expansionPlan: plan as any,
      });
    }

    let updatedChapters = [...validChapters];

    if (enableExpansion && plan.chaptersToExpand?.length > 0) {
      let skippedCount = 0;
      for (let i = 0; i < plan.chaptersToExpand.length; i++) {
        const expansion = plan.chaptersToExpand[i];
        const chapter = updatedChapters.find(c => c.chapterNumber === expansion.chapterNumber);
        
        if (!chapter) continue;

        const currentWordCount = chapter.wordCount || chapter.originalContent.split(/\s+/).length;
        const targetThreshold = expansion.targetWords * 0.9;
        if (currentWordCount >= targetThreshold) {
          console.log(`[ReeditOrchestrator] Skipping chapter ${chapter.chapterNumber} (already expanded: ${currentWordCount} >= ${Math.round(targetThreshold)} words)`);
          skippedCount++;
          continue;
        }

        if (await this.checkCancellation(projectId)) return updatedChapters;

        this.emitProgress({
          projectId,
          stage: "expansion",
          currentChapter: i + 1,
          totalChapters: plan.chaptersToExpand.length,
          message: `Expandiendo capítulo ${chapter.chapterNumber}: ${chapter.title || "Sin título"}...`,
        });

        const adjacentContext = this.buildAdjacentChapterContext(updatedChapters, chapter.chapterNumber);

        const expandResult = await this.chapterExpander.execute({
          chapterContent: chapter.originalContent,
          chapterNumber: chapter.chapterNumber,
          chapterTitle: chapter.title || `Capítulo ${chapter.chapterNumber}`,
          expansionPlan: {
            targetWords: expansion.targetWords,
            expansionType: expansion.expansionType,
            suggestedContent: expansion.suggestedContent,
          },
          worldBible,
          adjacentContext: {
            previousSummary: adjacentContext.previousSummary,
            nextSummary: adjacentContext.nextSummary,
          },
        });
        this.trackTokens(expandResult);

        if (expandResult.result?.expandedContent) {
          const newWordCount = expandResult.result.newWordCount || expandResult.result.expandedContent.split(/\s+/).length;
          
          await storage.updateReeditChapter(chapter.id, {
            originalContent: expandResult.result.expandedContent,
            wordCount: newWordCount,
          });

          const chapterIndex = updatedChapters.findIndex(c => c.id === chapter.id);
          if (chapterIndex >= 0) {
            updatedChapters[chapterIndex] = {
              ...updatedChapters[chapterIndex],
              originalContent: expandResult.result.expandedContent,
              wordCount: newWordCount,
            };
          }

          console.log(`[ReeditOrchestrator] Chapter ${chapter.chapterNumber} expanded: ${expansion.currentWords} -> ${newWordCount} words`);
        }

        await this.updateHeartbeat(projectId);
      }
    }

    if (enableNewChapters && plan.newChaptersToInsert?.length > 0) {
      const sortedInsertions = [...plan.newChaptersToInsert].sort(
        (a, b) => b.insertAfterChapter - a.insertAfterChapter
      );

      for (let i = 0; i < sortedInsertions.length; i++) {
        const insertion = sortedInsertions[i];
        
        // Check if chapter with this title already exists (inserted in previous run)
        const existingNewChapter = updatedChapters.find(c => 
          c.title === insertion.title && c.originalContent && c.originalContent.length > 500
        );
        if (existingNewChapter) {
          console.log(`[ReeditOrchestrator] Skipping new chapter insertion after ${insertion.insertAfterChapter} (already exists: "${insertion.title}")`);
          continue;
        }

        if (await this.checkCancellation(projectId)) return updatedChapters;

        this.emitProgress({
          projectId,
          stage: "expansion",
          currentChapter: (plan.chaptersToExpand?.length || 0) + i + 1,
          totalChapters: (plan.chaptersToExpand?.length || 0) + plan.newChaptersToInsert.length,
          message: `Generando nuevo capítulo: "${insertion.title}"...`,
        });

        const prevChapter = updatedChapters.find(c => c.chapterNumber === insertion.insertAfterChapter);
        const nextChapter = updatedChapters.find(c => c.chapterNumber === insertion.insertAfterChapter + 1);

        const newChapterResult = await this.newChapterGenerator.execute({
          insertAfterChapter: insertion.insertAfterChapter,
          title: insertion.title,
          purpose: insertion.purpose,
          plotPoints: insertion.plotPoints,
          estimatedWords: insertion.estimatedWords,
          worldBible,
          previousChapterSummary: prevChapter?.originalContent?.substring(0, 2000) || "No disponible",
          nextChapterSummary: nextChapter?.originalContent?.substring(0, 2000) || "No disponible",
          genre: projectGenre,
        });
        this.trackTokens(newChapterResult);

        if (newChapterResult.result?.content) {
          // Use a temporary high number to avoid conflicts (will be renumbered later)
          // Calculate position: insert after the target chapter
          const tempChapterNumber = 9000 + i;
          const wordCount = newChapterResult.result.wordCount || newChapterResult.result.content.split(/\s+/).length;

          // Use createReeditChapterIfNotExists to prevent duplicates on pipeline restart/retry
          const newChapter = await storage.createReeditChapterIfNotExists({
            projectId,
            chapterNumber: tempChapterNumber,
            originalChapterNumber: tempChapterNumber, // Set originalChapterNumber for deduplication
            title: newChapterResult.result.title || insertion.title,
            originalContent: newChapterResult.result.content,
            wordCount,
            status: "pending",
            processingStage: "none",
          });

          // Store the intended position for sorting
          const insertPosition = insertion.insertAfterChapter + 0.5;
          updatedChapters.push({ ...newChapter, _sortOrder: insertPosition } as any);
          updatedChapters.sort((a, b) => {
            const orderA = (a as any)._sortOrder ?? a.chapterNumber;
            const orderB = (b as any)._sortOrder ?? b.chapterNumber;
            return orderA - orderB;
          });

          console.log(`[ReeditOrchestrator] New chapter created after ${insertion.insertAfterChapter}: "${insertion.title}" (${wordCount} words)`);
          
          // Renumber ALL chapters immediately after each new insertion so they appear correctly in UI
          await this.renumberChaptersInDatabase(updatedChapters, projectId);
        }

        await this.updateHeartbeat(projectId);
      }

      await storage.updateReeditProject(projectId, {
        totalChapters: updatedChapters.length,
      });
    }

    const totalWords = updatedChapters.reduce((sum, c) => sum + (c.wordCount || 0), 0);
    console.log(`[ReeditOrchestrator] Expansion complete: ${updatedChapters.length} chapters, ${totalWords} words`);

    return updatedChapters;
  }

  /**
   * Renumber all chapters in the database based on their _sortOrder (or chapterNumber).
   * This ensures new chapters appear in the correct position in the UI immediately.
   * Also updates the internal chapter headers in originalContent and editedContent.
   */
  private async renumberChaptersInDatabase(
    chapters: ReeditChapter[],
    projectId: number
  ): Promise<void> {
    let newChapterNum = 1;
    for (const chapter of chapters) {
      const updates: any = {};
      
      // Renumber if needed
      if (chapter.chapterNumber !== newChapterNum) {
        updates.originalChapterNumber = chapter.chapterNumber;
        updates.chapterNumber = newChapterNum;
      }
      
      // Update title prefix to match new chapter number
      const updatedTitle = this.updateChapterTitleNumber(chapter.title, newChapterNum);
      if (updatedTitle !== chapter.title) {
        updates.title = updatedTitle;
        console.log(`[ReeditOrchestrator] Renaming: "${chapter.title}" -> "${updatedTitle}"`);
      }
      
      // Update internal chapter headers in content (originalContent and editedContent)
      // This ensures the text content matches the new chapter number
      if (chapter.chapterNumber !== newChapterNum || updatedTitle !== chapter.title) {
        const titleForContent = updatedTitle;
        
        // Update originalContent header
        const updatedOriginalContent = this.normalizeChapterHeaderContent(
          chapter.originalContent,
          newChapterNum,
          titleForContent
        );
        if (updatedOriginalContent && updatedOriginalContent !== chapter.originalContent) {
          updates.originalContent = updatedOriginalContent;
          chapter.originalContent = updatedOriginalContent;
        }
        
        // Update editedContent header if it exists
        if (chapter.editedContent) {
          const updatedEditedContent = this.normalizeChapterHeaderContent(
            chapter.editedContent,
            newChapterNum,
            titleForContent
          );
          if (updatedEditedContent && updatedEditedContent !== chapter.editedContent) {
            updates.editedContent = updatedEditedContent;
            chapter.editedContent = updatedEditedContent;
          }
        }
      }
      
      // Apply updates if any
      if (Object.keys(updates).length > 0) {
        await storage.updateReeditChapter(chapter.id, updates);
        if (updates.chapterNumber) chapter.chapterNumber = newChapterNum;
        if (updates.title) chapter.title = updatedTitle;
      }
      
      newChapterNum++;
    }
    
    // Update project total chapters count
    await storage.updateReeditProject(projectId, {
      totalChapters: chapters.length,
    });
    
    console.log(`[ReeditOrchestrator] Renumbered ${chapters.length} chapters in database (including internal content headers)`);
  }

  /**
   * Reorder chapters based on Architect Analyzer recommendations.
   * Each reordering specifies which chapter should move to which position.
   */
  private async reorderChaptersFromAnalysis(
    chapters: ReeditChapter[],
    projectId: number,
    reordenamientos: Array<{ capituloActual: number; nuevaPosicion: number; razon: string }>
  ): Promise<ReeditChapter[]> {
    if (!reordenamientos || reordenamientos.length === 0) {
      return chapters;
    }

    console.log(`[ReeditOrchestrator] Reordering ${reordenamientos.length} chapters based on Architect analysis:`);
    
    // Sort chapters by current number
    let sortedChapters = [...chapters].sort((a, b) => getChapterSortOrder(a.chapterNumber) - getChapterSortOrder(b.chapterNumber));
    
    // Apply each reordering
    for (const reorder of reordenamientos) {
      const { capituloActual, nuevaPosicion, razon } = reorder;
      
      // Find the chapter to move
      const chapterIndex = sortedChapters.findIndex(c => c.chapterNumber === capituloActual);
      if (chapterIndex === -1) {
        console.log(`  [SKIP] Capítulo ${capituloActual} no encontrado`);
        continue;
      }
      
      const chapter = sortedChapters[chapterIndex];
      
      // Remove from current position
      sortedChapters.splice(chapterIndex, 1);
      
      // Insert at new position (adjusted for 0-based indexing)
      const newIndex = Math.max(0, Math.min(nuevaPosicion - 1, sortedChapters.length));
      sortedChapters.splice(newIndex, 0, chapter);
      
      console.log(`  ✓ Capítulo ${capituloActual} ("${chapter.title?.substring(0, 40)}...") -> posición ${nuevaPosicion}`);
      console.log(`    Razón: ${razon}`);
    }
    
    // Renumber all chapters in the database
    await this.renumberChaptersInDatabase(sortedChapters, projectId);
    
    console.log(`[ReeditOrchestrator] Chapter reordering complete`);
    
    return sortedChapters;
  }

  private async collectQaFindings(projectId: number): Promise<Map<number, any[]>> {
    const problemsByChapter = new Map<number, any[]>();
    
    const auditReports = await storage.getReeditAuditReportsByProject(projectId);
    
    // Collect from continuity reports
    const continuityReports = auditReports.filter(r => r.auditType === "continuity");
    for (const report of continuityReports) {
      const findings = report.findings as any;
      if (findings?.erroresContinuidad) {
        for (const error of findings.erroresContinuidad) {
          const chapNum = error.capitulo;
          if (typeof chapNum === 'number' && (error.severidad === 'critica' || error.severidad === 'crítica' || error.severidad === 'mayor')) {
            if (!problemsByChapter.has(chapNum)) {
              problemsByChapter.set(chapNum, []);
            }
            problemsByChapter.get(chapNum)!.push({
              source: "continuity_sentinel",
              type: error.tipo,
              severity: error.severidad,
              summary: error.descripcion,
              correctionHint: error.correccion,
              evidence: error.contexto,
            });
          }
        }
      }
    }
    
    // Collect from voice_rhythm reports
    const voiceReports = auditReports.filter(r => r.auditType === "voice_rhythm");
    for (const report of voiceReports) {
      const findings = report.findings as any;
      if (findings?.problemasTono) {
        for (const problem of findings.problemasTono) {
          if (problem.severidad === 'mayor') {
            const chapters = problem.capitulos || [];
            for (const chapNum of chapters) {
              if (typeof chapNum === 'number') {
                if (!problemsByChapter.has(chapNum)) {
                  problemsByChapter.set(chapNum, []);
                }
                problemsByChapter.get(chapNum)!.push({
                  source: "voice_rhythm_auditor",
                  type: problem.tipo,
                  severity: problem.severidad,
                  summary: problem.descripcion,
                  correctionHint: problem.correccion,
                  evidence: problem.ejemplo,
                });
              }
            }
          }
        }
      }
    }
    
    // Collect from semantic_repetition reports
    const semanticReports = auditReports.filter(r => r.auditType === "semantic_repetition");
    for (const report of semanticReports) {
      const findings = report.findings as any;
      if (findings?.repeticionesSemanticas) {
        for (const repetition of findings.repeticionesSemanticas) {
          if (repetition.severidad === 'mayor') {
            const chapters = repetition.ocurrencias || [];
            for (const chapNum of chapters) {
              if (typeof chapNum === 'number') {
                if (!problemsByChapter.has(chapNum)) {
                  problemsByChapter.set(chapNum, []);
                }
                problemsByChapter.get(chapNum)!.push({
                  source: "semantic_repetition_detector",
                  type: repetition.tipo,
                  severity: repetition.severidad,
                  summary: repetition.descripcion,
                  correctionHint: `${repetition.accion}: ${repetition.ejemplo || ''}`,
                  evidence: repetition.ejemplo,
                });
              }
            }
          }
        }
      }
    }
    
    // Collect from anachronism reports
    const anachronismReports = auditReports.filter(r => r.auditType === "anachronism");
    for (const report of anachronismReports) {
      const findings = report.findings as any;
      if (findings?.anacronismos) {
        for (const anachronism of findings.anacronismos) {
          if (anachronism.severidad === 'critica' || anachronism.severidad === 'crítica' || anachronism.severidad === 'mayor') {
            const chapNum = anachronism.capitulo;
            if (typeof chapNum === 'number') {
              if (!problemsByChapter.has(chapNum)) {
                problemsByChapter.set(chapNum, []);
              }
              problemsByChapter.get(chapNum)!.push({
                source: "anachronism_detector",
                type: anachronism.tipo,
                severity: anachronism.severidad,
                summary: `${anachronism.problema}: ${anachronism.fragmento}`,
                correctionHint: anachronism.correccion,
                evidence: anachronism.fragmento,
              });
            }
          }
        }
      }
    }
    
    return problemsByChapter;
  }

  private collectArchitectProblems(architectResult: any): any[] {
    const problems: any[] = [];
    
    // Collect from analisisTrama
    if (architectResult.analisisTrama) {
      const { huecosArgumentales, subplotsSinResolver, arcosIncompletos } = architectResult.analisisTrama;
      
      if (huecosArgumentales) {
        for (const hole of huecosArgumentales) {
          problems.push({
            tipo: "hueco_argumental",
            severidad: hole.severidad || "mayor",
            descripcion: hole.descripcion,
            capitulosAfectados: hole.capitulos || [],
            accionSugerida: "Añadir escena o diálogo que cierre el hueco lógico",
          });
        }
      }
      
      if (subplotsSinResolver) {
        for (const subplot of subplotsSinResolver) {
          problems.push({
            tipo: "subplot_sin_resolver",
            severidad: "mayor",
            descripcion: subplot.descripcion || subplot,
            capitulosAfectados: subplot.capitulos || [],
            accionSugerida: "Añadir resolución para la subtrama",
          });
        }
      }
      
      if (arcosIncompletos) {
        for (const arco of arcosIncompletos) {
          problems.push({
            tipo: "arco_incompleto",
            severidad: "mayor",
            descripcion: arco.descripcion || arco,
            capitulosAfectados: arco.capitulos || [],
            accionSugerida: "Completar la transformación del personaje",
          });
        }
      }
    }
    
    // Collect from coherenciaMundo
    if (architectResult.coherenciaMundo) {
      const { contradicciones, reglasRotas } = architectResult.coherenciaMundo;
      
      if (contradicciones) {
        for (const contradiccion of contradicciones) {
          problems.push({
            tipo: "contradiccion",
            severidad: contradiccion.severidad || "critica",
            descripcion: contradiccion.descripcion,
            capitulosAfectados: contradiccion.capitulos || [],
            accionSugerida: "Corregir la inconsistencia para mantener coherencia",
          });
        }
      }
      
      if (reglasRotas) {
        for (const regla of reglasRotas) {
          problems.push({
            tipo: "regla_rota",
            severidad: "mayor",
            descripcion: regla.descripcion || regla,
            capitulosAfectados: regla.capitulos || [],
            accionSugerida: "Ajustar el texto para respetar las reglas del mundo",
          });
        }
      }
    }
    
    // Collect from recomendaciones
    if (architectResult.recomendaciones) {
      for (const rec of architectResult.recomendaciones) {
        if (rec.severidad === "critica" || rec.severidad === "mayor") {
          problems.push({
            tipo: rec.tipo || "recomendacion",
            severidad: rec.severidad,
            descripcion: rec.descripcion,
            capitulosAfectados: rec.capitulosAfectados || [],
            accionSugerida: rec.accionSugerida,
          });
        }
      }
    }
    
    return problems;
  }

  private async consolidateAllProblems(
    architectProblems: any[],
    qaFindings: Map<number, any[]>,
    projectId?: number
  ): Promise<Map<number, any[]>> {
    const consolidatedByChapter = new Map<number, any[]>();
    
    // Get resolved issue hashes to filter out already-fixed problems
    let resolvedHashes: Set<string> = new Set();
    if (projectId) {
      const project = await storage.getReeditProject(projectId);
      const hashes = (project?.resolvedIssueHashes as string[]) || [];
      resolvedHashes = new Set(hashes);
      if (resolvedHashes.size > 0) {
        console.log(`[ReeditOrchestrator] Filtering out ${resolvedHashes.size} already-resolved issues`);
      }
    }
    
    // Add architect problems (convert to unified format), filtering resolved ones
    // IMPORTANT: Hash must use same fields as generateIssueHash (categoria, descripcion, capitulos_afectados)
    let skippedArchitect = 0;
    for (const problem of architectProblems) {
      const chapters = problem.capitulosAfectados || problem.capitulos || [];
      // Generate hash with ALL affected chapters (as in original issue creation)
      const hash = this.generateIssueHash({
        categoria: problem.tipo || problem.categoria || "structural",
        descripcion: problem.descripcion,
        capitulos_afectados: chapters.filter((c: any) => typeof c === 'number')
      });
      
      if (resolvedHashes.has(hash)) {
        skippedArchitect++;
        continue; // Skip resolved issues entirely
      }
      
      for (const chapNum of chapters) {
        if (typeof chapNum === 'number') {
          if (!consolidatedByChapter.has(chapNum)) {
            consolidatedByChapter.set(chapNum, []);
          }
          consolidatedByChapter.get(chapNum)!.push({
            source: "architect",
            tipo: problem.tipo,
            descripcion: problem.descripcion,
            severidad: problem.severidad,
            accionSugerida: problem.accionSugerida,
          });
        }
      }
    }
    
    // Add QA findings (already in unified format by chapter), filtering resolved ones
    let skippedQa = 0;
    for (const [chapNum, problems] of Array.from(qaFindings.entries())) {
      if (!consolidatedByChapter.has(chapNum)) {
        consolidatedByChapter.set(chapNum, []);
      }
      for (const problem of problems) {
        // Generate hash matching original issue creation format
        const hash = this.generateIssueHash({
          categoria: problem.type || problem.source || "qa",
          descripcion: problem.summary || problem.descripcion,
          capitulos_afectados: [chapNum]
        });
        if (resolvedHashes.has(hash)) {
          skippedQa++;
          continue; // Skip resolved issues
        }
        
        consolidatedByChapter.get(chapNum)!.push({
          source: problem.source,
          tipo: problem.type,
          descripcion: problem.summary,
          severidad: problem.severity,
          accionSugerida: problem.correctionHint,
        });
      }
    }
    
    // Remove chapters with no problems after filtering
    for (const [chapNum, problems] of Array.from(consolidatedByChapter.entries())) {
      if (problems.length === 0) {
        consolidatedByChapter.delete(chapNum);
      }
    }
    
    if (skippedArchitect > 0 || skippedQa > 0) {
      console.log(`[ReeditOrchestrator] Skipped ${skippedArchitect} architect + ${skippedQa} QA already-resolved issues`);
    }
    
    console.log(`[ReeditOrchestrator] Consolidated problems: ${consolidatedByChapter.size} chapters with issues`);
    for (const [chapNum, problems] of Array.from(consolidatedByChapter.entries())) {
      console.log(`  - Chapter ${chapNum}: ${problems.length} problems (${(problems as any[]).map((p: any) => p.source).join(', ')})`);
    }
    
    return consolidatedByChapter;
  }

  setProgressCallback(callback: ProgressCallback) {
    this.progressCallback = callback;
  }

  private emitProgress(progress: ReeditProgress) {
    if (this.progressCallback) {
      this.progressCallback(progress);
    }
    console.log(`[ReeditOrchestrator] ${progress.stage}: ${progress.message}`);
    
    // Persist activity message to database for real-time UI updates
    storage.updateReeditProject(progress.projectId, {
      currentActivity: progress.message,
      currentChapter: progress.currentChapter,
    }).catch(err => console.error("[ReeditOrchestrator] Failed to update currentActivity:", err));
  }

  async analyzeStructure(chapters: ReeditChapter[]): Promise<StructureAnalysis> {
    const analysis: StructureAnalysis = {
      hasIssues: false,
      duplicateChapters: [],
      outOfOrderChapters: [],
      missingChapters: [],
      recommendations: [],
    };

    // Separate special chapters from regular chapters
    // 0 = Prologue, 998 = Epilogue, 999 = Author's Note
    const specialChapterNumbers = [0, 998, 999];
    const regularChapters = chapters.filter(c => !specialChapterNumbers.includes(c.chapterNumber));
    const regularChapterNumbers = regularChapters.map(c => c.chapterNumber).sort((a, b) => a - b);
    
    // Add metadata about special chapters
    const hasPrologue = chapters.some(c => c.chapterNumber === 0);
    const hasEpilogue = chapters.some(c => c.chapterNumber === 998);
    const hasAuthorNote = chapters.some(c => c.chapterNumber === 999);
    (analysis as any).hasPrologue = hasPrologue;
    (analysis as any).hasEpilogue = hasEpilogue;
    (analysis as any).hasAuthorNote = hasAuthorNote;
    (analysis as any).totalChapters = chapters.length;
    (analysis as any).regularChapters = regularChapters.length;
    
    // Only check for missing chapters among regular chapters (1 to max regular chapter)
    const maxRegularChapter = regularChapterNumbers.length > 0 ? Math.max(...regularChapterNumbers) : 0;
    
    for (let i = 1; i <= maxRegularChapter; i++) {
      const count = regularChapterNumbers.filter(n => n === i).length;
      if (count === 0) {
        analysis.missingChapters.push(i);
        analysis.hasIssues = true;
      } else if (count > 1) {
        const duplicates = regularChapters.filter(c => c.chapterNumber === i);
        for (let j = 1; j < duplicates.length; j++) {
          const similarity = this.calculateSimilarity(
            duplicates[0].originalContent,
            duplicates[j].originalContent
          );
          analysis.duplicateChapters.push({
            chapterId: duplicates[j].id,
            duplicateOf: duplicates[0].id,
            similarity,
          });
        }
        analysis.hasIssues = true;
      }
    }

    for (let i = 0; i < chapters.length - 1; i++) {
      const current = chapters[i];
      const next = chapters[i + 1];
      
      if (current.chapterNumber > next.chapterNumber) {
        analysis.outOfOrderChapters.push({
          chapterNumber: next.chapterNumber,
          suggestedPosition: i,
          reason: `Chapter ${next.chapterNumber} appears after chapter ${current.chapterNumber}`,
        });
        analysis.hasIssues = true;
      }
    }

    if (analysis.duplicateChapters.length > 0) {
      analysis.recommendations.push(
        `Found ${analysis.duplicateChapters.length} duplicate chapter(s). Review and remove duplicates.`
      );
    }
    if (analysis.outOfOrderChapters.length > 0) {
      analysis.recommendations.push(
        `Found ${analysis.outOfOrderChapters.length} chapter(s) out of order. Reorder before processing.`
      );
    }
    if (analysis.missingChapters.length > 0) {
      analysis.recommendations.push(
        `Missing chapters: ${analysis.missingChapters.join(", ")}. Verify manuscript completeness.`
      );
    }

    return analysis;
  }

  private calculateSimilarity(text1: string, text2: string): number {
    const words1 = text1.toLowerCase().split(/\s+/);
    const words2 = text2.toLowerCase().split(/\s+/);
    const set1 = new Set(words1);
    const set2 = new Set(words2);
    
    let intersectionSize = 0;
    for (const word of words1) {
      if (set2.has(word)) {
        intersectionSize++;
        set2.delete(word);
      }
    }
    
    const unionSize = set1.size + set2.size;
    return unionSize > 0 ? intersectionSize / unionSize : 0;
  }

  async processProject(projectId: number): Promise<void> {
    const project = await storage.getReeditProject(projectId);
    if (!project) {
      throw new Error(`Reedit project ${projectId} not found`);
    }

    // Load existing token counts from database to continue accumulating
    this.totalInputTokens = project.totalInputTokens || 0;
    this.totalOutputTokens = project.totalOutputTokens || 0;
    this.totalThinkingTokens = project.totalThinkingTokens || 0;
    console.log(`[ReeditOrchestrator] Loaded existing tokens: ${this.totalInputTokens} input, ${this.totalOutputTokens} output, ${this.totalThinkingTokens} thinking`);

    // SPECIAL CASE: If resuming with existing finalReviewResult OR already in reviewing stage,
    // skip directly to final review (don't re-run entire pipeline)
    const hasExistingFinalReview = project.finalReviewResult && 
      ((project.finalReviewResult as any).puntuacion_global !== undefined ||
       (project.finalReviewResult as any).issues?.length > 0 || 
       (project.finalReviewResult as any).capitulos_para_reescribir?.length > 0);
    const hasUserInstructions = project.pendingUserInstructions && project.pendingUserInstructions.trim().length > 0;
    // Trigger fast-track if:
    // 1. Project was awaiting instructions with issues to fix
    // 2. Project was in "reviewing" stage (already past all earlier stages)
    // 3. Project has consecutive high scores pending confirmation
    // 4. Project was awaiting_issue_approval (user was reviewing issues checklist)
    const isResumingFromReviewing = project.currentStage === "reviewing";
    const hasConsecutiveScoresPending = (project.consecutiveHighScores || 0) >= 1;
    const isAwaitingIssueApproval = project.status === "awaiting_issue_approval";
    const isResumingFromPause = project.status === "awaiting_instructions" || 
      isAwaitingIssueApproval ||
      (project.status !== "completed" && isResumingFromReviewing);
    
    if ((hasExistingFinalReview && isResumingFromPause) || (isResumingFromReviewing && hasConsecutiveScoresPending) || isAwaitingIssueApproval) {
      console.log(`[ReeditOrchestrator] FAST-TRACK RESUME: Project has finalReviewResult with issues. Skipping to corrections + final review.`);
      console.log(`  - User instructions: ${hasUserInstructions ? 'YES' : 'NO'}`);
      console.log(`  - Previous stage: ${project.currentStage}`);
      
      this.emitProgress({
        projectId,
        stage: "fixing",
        currentChapter: 0,
        totalChapters: 0,
        message: "Retomando desde correcciones pendientes (salto rápido)...",
      });
      
      // Go directly to runFinalReviewOnly which handles corrections + re-review
      await this.runFinalReviewOnly(projectId);
      return;
    }

    // Detect resume stage - if project was interrupted, continue from where it left off
    const resumeStage = project.currentStage || "none";
    const stageOrder = ["none", "analyzing", "forensic_audit", "editing", "world_bible", "expansion", "architect", "qa", "narrative_rewriting", "copyediting", "beta_reader", "reviewing", "completed"];
    const resumeStageIndex = stageOrder.indexOf(resumeStage);
    
    if (resumeStageIndex > 0 && resumeStage !== "completed") {
      console.log(`[ReeditOrchestrator] RESUMING project ${projectId} from stage: ${resumeStage} (index ${resumeStageIndex})`);
      this.emitProgress({
        projectId,
        stage: resumeStage as any,
        currentChapter: 0,
        totalChapters: 0,
        message: `Retomando procesamiento desde etapa: ${resumeStage}...`,
      });
    }

    try {
      await storage.updateReeditProject(projectId, { status: "processing" });

      const chapters = await storage.getReeditChaptersByProject(projectId);
      
      // === STAGE 1: STRUCTURE ANALYSIS ===
      // Skip if already past this stage
      const skipAnalyzing = resumeStageIndex > stageOrder.indexOf("analyzing");
      let structureAnalysis: any = project.structureAnalysis || { duplicateChapters: [], outOfOrderChapters: [], missingChapters: [] };
      
      if (!skipAnalyzing) {
        this.emitProgress({
          projectId,
          stage: "analyzing",
          currentChapter: 0,
          totalChapters: chapters.length,
          message: "Analizando estructura del manuscrito...",
        });

        structureAnalysis = await this.analyzeStructure(chapters);
        await storage.updateReeditProject(projectId, {
          currentStage: "analyzing",
          structureAnalysis: structureAnalysis as any,
        });

        for (const dup of structureAnalysis.duplicateChapters) {
          await storage.updateReeditChapter(dup.chapterId, {
            isDuplicate: true,
            duplicateOfChapter: dup.duplicateOf,
            status: "skipped",
          });
        }

        for (const ooo of structureAnalysis.outOfOrderChapters) {
          const chapter = chapters.find(c => c.chapterNumber === ooo.chapterNumber);
          if (chapter) {
            await storage.updateReeditChapter(chapter.id, {
              isOutOfOrder: true,
              suggestedOrder: ooo.suggestedPosition,
            });
          }
        }
      } else {
        console.log(`[ReeditOrchestrator] Skipping STAGE 1 (analyzing) - already completed`);
      }

      let validChapters = chapters.filter(c => {
        const isDup = structureAnalysis.duplicateChapters?.some((d: any) => d.chapterId === c.id);
        return !isDup;
      }).sort((a, b) => getChapterSortOrder(a.chapterNumber) - getChapterSortOrder(b.chapterNumber));

      const detectedLang = project.detectedLanguage || "es";
      const chapterSummaries: string[] = [];
      const editorFeedbacks: any[] = [];

      // === STAGE 1.5: FORENSIC CONSISTENCY AUDIT ===
      // Unlike the Guardian (which prevents errors), the Forensic Auditor DETECTS existing errors
      const skipForensicAudit = resumeStageIndex > stageOrder.indexOf("forensic_audit");
      let forensicAuditResult: ForensicAuditResult | null = (project as any).forensicAuditResult || null;

      if (!skipForensicAudit) {
        // Check for cancellation before forensic audit
        if (await this.checkCancellation(projectId)) {
          console.log(`[ReeditOrchestrator] Processing cancelled before forensic audit`);
          return;
        }

        this.emitProgress({
          projectId,
          stage: "forensic_audit" as any,
          currentChapter: 0,
          totalChapters: validChapters.length,
          message: "Auditoría forense de consistencia (detectando errores existentes)...",
        });

        const chaptersForAudit = validChapters.map(c => ({
          chapterNumber: c.chapterNumber,
          title: c.title || `Capítulo ${c.chapterNumber}`,
          content: c.originalContent
        }));

        // Run Forensic Audit with error handling
        try {
          // Check if DeepSeek API key is configured (ForensicAuditor uses deepseek-reasoner)
          if (!process.env.DEEPSEEK_API_KEY) {
            console.warn(`[ReeditOrchestrator] DeepSeek API key not configured - skipping Forensic Audit`);
            // Persist skipped status so UI can reflect completion state
            await storage.updateReeditProject(projectId, {
              currentStage: "forensic_audit",
              forensicAuditResult: { 
                skipped: true, 
                reason: "DeepSeek API key not configured",
                violations: [],
                entitiesExtracted: { characters: [], locations: [], timeline: [] },
                consistencyScore: null,
                summary: "Auditoría forense omitida: API DeepSeek no configurada"
              } as any,
            });
            this.emitProgress({
              projectId,
              stage: "forensic_audit" as any,
              currentChapter: validChapters.length,
              totalChapters: validChapters.length,
              message: `Auditoría forense omitida: API DeepSeek no configurada`,
            });
          } else {
            forensicAuditResult = await this.forensicAuditor.auditManuscript(
              chaptersForAudit,
              project.genre || "general",
              detectedLang
            );
            this.trackTokens(forensicAuditResult);

            await storage.updateReeditProject(projectId, {
              currentStage: "forensic_audit",
              forensicAuditResult: forensicAuditResult as any,
            });

            const violationCount = forensicAuditResult?.violations?.length || 0;
            const criticalViolations = forensicAuditResult?.violations?.filter(v => v.severity === 'critical')?.length || 0;

            console.log(`[ReeditOrchestrator] Forensic Audit complete: ${violationCount} violations (${criticalViolations} critical), score: ${forensicAuditResult?.consistencyScore}/10`);

            this.emitProgress({
              projectId,
              stage: "forensic_audit" as any,
              currentChapter: validChapters.length,
              totalChapters: validChapters.length,
              message: `Auditoría forense: ${violationCount} violaciones detectadas (${criticalViolations} críticas) - Puntuación: ${forensicAuditResult?.consistencyScore}/10`,
            });
          }
        } catch (auditError: any) {
          console.error(`[ReeditOrchestrator] Forensic Audit failed:`, auditError.message);
          this.emitProgress({
            projectId,
            stage: "forensic_audit" as any,
            currentChapter: validChapters.length,
            totalChapters: validChapters.length,
            message: `Auditoría forense falló (continuando sin análisis): ${auditError.message?.substring(0, 100)}`,
          });
          // Continue pipeline even if forensic audit fails
        }

        await this.updateHeartbeat(projectId);
      } else {
        console.log(`[ReeditOrchestrator] Skipping STAGE 1.5 (forensic_audit) - already completed`);
      }

      // === STAGE 2: EDITOR REVIEW (all chapters first) ===
      await storage.updateReeditProject(projectId, { currentStage: "editing" });
      await this.updateHeartbeat(projectId);

      for (let i = 0; i < validChapters.length; i++) {
        // Check for cancellation before processing each chapter
        if (await this.checkCancellation(projectId)) {
          console.log(`[ReeditOrchestrator] Processing cancelled at editing stage, chapter ${i + 1}`);
          return;
        }

        const chapter = validChapters[i];
        
        // Skip chapters that were already processed (resume support)
        if (chapter.processingStage !== "none" && chapter.processingStage !== "editor" && chapter.editorFeedback) {
          console.log(`[ReeditOrchestrator] Skipping chapter ${chapter.chapterNumber} (already processed in editing stage)`);
          const existingFeedback = chapter.editorFeedback as any;
          editorFeedbacks.push(existingFeedback);
          chapterSummaries.push(
            `Capítulo ${chapter.chapterNumber} (Puntuación: ${chapter.editorScore || 7}/10): resumido`
          );
          continue;
        }
        
        this.emitProgress({
          projectId,
          stage: "editing",
          currentChapter: i + 1,
          totalChapters: validChapters.length,
          message: `Capítulo ${chapter.chapterNumber}: Revisión editorial...`,
        });

        await storage.updateReeditChapter(chapter.id, {
          status: "analyzing",
          processingStage: "editor",
        });

        const editorResult = await this.editorAgent.reviewChapter(
          chapter.originalContent,
          chapter.chapterNumber,
          detectedLang
        );
        this.trackTokens(editorResult);

        await storage.updateReeditChapter(chapter.id, {
          editorScore: editorResult.score || 7,
          editorFeedback: {
            issues: editorResult.issues || [],
            suggestions: editorResult.suggestions || [],
            strengths: editorResult.strengths || [],
          },
          narrativeIssues: {
            pacing: editorResult.pacingNotes || "",
          },
          processingStage: "world_bible",
        });

        editorFeedbacks.push(editorResult);
        chapterSummaries.push(
          `Capítulo ${chapter.chapterNumber} (Puntuación: ${editorResult.score || 7}/10): ${(editorResult.strengths || []).slice(0, 2).join(", ")}`
        );

        await storage.updateReeditProject(projectId, {
          currentChapter: i + 1,
        });
        
        // Update heartbeat and last completed chapter after each chapter
        await this.updateHeartbeat(projectId, chapter.chapterNumber);
      }

      // Check cancellation before World Bible extraction
      if (await this.checkCancellation(projectId)) {
        console.log(`[ReeditOrchestrator] Processing cancelled before World Bible extraction`);
        return;
      }

      // === STAGE 3: WORLD BIBLE EXTRACTION ===
      const chaptersForBible = validChapters.map((c, i) => ({
        num: c.chapterNumber,
        content: c.originalContent,
        feedback: editorFeedbacks[i]
      }));

      // Check if World Bible already exists (resume support)
      const existingWorldBible = await storage.getReeditWorldBibleByProject(projectId);
      let worldBibleResult: any;

      const existingCharacters = existingWorldBible?.characters as any[] | null;
      if (existingWorldBible && existingCharacters && existingCharacters.length > 0) {
        console.log(`[ReeditOrchestrator] Skipping World Bible extraction (already exists with ${existingCharacters.length} characters)`);
        worldBibleResult = {
          personajes: existingWorldBible.characters,
          ubicaciones: existingWorldBible.locations,
          timeline: existingWorldBible.timeline,
          reglasDelMundo: existingWorldBible.loreRules,
          epocaHistorica: {
            periodo: existingWorldBible.historicalPeriod,
            detalles: existingWorldBible.historicalDetails,
          },
          confianza: existingWorldBible.confidence,
        };
      } else {
        this.emitProgress({
          projectId,
          stage: "world_bible",
          currentChapter: 0,
          totalChapters: validChapters.length,
          message: "Iniciando extracción de Biblia del Mundo...",
        });

        await storage.updateReeditProject(projectId, { currentStage: "world_bible" });

        worldBibleResult = await this.worldBibleExtractor.extractWorldBible(
          chaptersForBible,
          editorFeedbacks,
          async (batchIndex, totalBatches, message) => {
            const chaptersProcessed = Math.min(batchIndex * 10, validChapters.length);
            this.emitProgress({
              projectId,
              stage: "world_bible",
              currentChapter: chaptersProcessed,
              totalChapters: validChapters.length,
              message,
            });
            await storage.updateReeditProject(projectId, {
              processedChapters: chaptersProcessed,
            });
          }
        );
        this.trackTokens(worldBibleResult);

        // Save world bible to database
        await storage.createReeditWorldBible({
          projectId,
          characters: worldBibleResult.personajes || [],
          locations: worldBibleResult.ubicaciones || [],
          timeline: worldBibleResult.timeline || [],
          loreRules: worldBibleResult.reglasDelMundo || [],
          historicalPeriod: worldBibleResult.epocaHistorica?.periodo || null,
          historicalDetails: worldBibleResult.epocaHistorica?.detalles || null,
          extractedFromChapters: validChapters.length,
          confidence: worldBibleResult.confianza || 7,
        });
      }

      // === STAGE 3.5: MANUSCRIPT EXPANSION (optional) ===
      // Check cancellation before expansion
      if (await this.checkCancellation(projectId)) {
        console.log(`[ReeditOrchestrator] Processing cancelled before expansion stage`);
        return;
      }

      // Reload project to get expansion settings
      const projectWithExpansion = await storage.getReeditProject(projectId);
      if (projectWithExpansion && (projectWithExpansion.expandChapters || projectWithExpansion.insertNewChapters)) {
        await storage.updateReeditProject(projectId, { currentStage: "expansion" });
        
        const worldBibleForExpansion = {
          characters: worldBibleResult.personajes || [],
          locations: worldBibleResult.ubicaciones || [],
          timeline: worldBibleResult.timeline || [],
          rules: worldBibleResult.reglasDelMundo || [],
        };

        const expandedChapters = await this.expandManuscript(
          projectId,
          projectWithExpansion,
          validChapters,
          worldBibleForExpansion
        );

        // Update validChapters with expanded result
        validChapters.length = 0;
        validChapters.push(...expandedChapters);

        await this.updateHeartbeat(projectId);
      }

      // Rebuild chaptersForBible AFTER expansion to include new/expanded chapters
      // This ensures Architect analyzes the complete manuscript including expansions
      const chaptersForArchitect = validChapters.map((c, i) => ({
        num: c.chapterNumber,
        content: c.editedContent || c.originalContent, // Use expanded content if available
        feedback: editorFeedbacks[i] || { score: 7, issues: [], strengths: [] }
      }));
      console.log(`[ReeditOrchestrator] Rebuilt chapters for Architect: ${chaptersForArchitect.length} chapters (includes expansions)`);

      // Re-analyze structure after expansion to reflect new/modified chapters
      if (projectWithExpansion?.expandChapters || projectWithExpansion?.insertNewChapters) {
        console.log(`[ReeditOrchestrator] Re-analyzing structure after expansion...`);
        structureAnalysis = await this.analyzeStructure(validChapters);
        await storage.updateReeditProject(projectId, {
          structureAnalysis: structureAnalysis as any,
          totalChapters: validChapters.length,
        });
        console.log(`[ReeditOrchestrator] Structure re-analyzed: ${validChapters.length} chapters, issues: ${structureAnalysis.hasIssues}`);
      }

      // === STAGE 4: ARCHITECT ANALYSIS ===
      // Check if Architect analysis already exists (resume support)
      const existingArchitectReport = await storage.getReeditAuditReportsByProject(projectId);
      const hasArchitectReport = existingArchitectReport.some(r => r.auditType === "architect");
      let architectResult: any;

      if (hasArchitectReport) {
        console.log(`[ReeditOrchestrator] Skipping Architect analysis (already exists)`);
        const existingReport = existingArchitectReport.find(r => r.auditType === "architect");
        architectResult = existingReport?.findings || {};
      } else {
        this.emitProgress({
          projectId,
          stage: "architect",
          currentChapter: validChapters.length,
          totalChapters: validChapters.length,
          message: "Arquitecto analizando estructura y trama...",
        });

        await storage.updateReeditProject(projectId, { currentStage: "architect" });

        // LitAgents 2.1: Generate consistency constraints for Architect analysis
        let architectConstraints = "";
        if (forensicAuditResult && !forensicAuditResult.skipped) {
          // Build constraints from forensic audit findings
          const violationsSummary = forensicAuditResult.violations?.slice(0, 20).map((v: any) => 
            `- [${v.type}] Cap ${v.chapter}: ${v.description}`
          ).join("\n") || "";
          
          if (violationsSummary) {
            architectConstraints = `
⛔ VIOLACIONES DE CONSISTENCIA DETECTADAS POR AUDITORÍA FORENSE:
${violationsSummary}

Al analizar la arquitectura, TEN EN CUENTA estas violaciones existentes y recomienda correcciones.
`;
          }
        }

        architectResult = await this.architectAnalyzer.analyzeArchitecture(
          worldBibleResult,
          chaptersForArchitect,
          structureAnalysis,
          architectConstraints
        );
        this.trackTokens(architectResult);

        await storage.createReeditAuditReport({
          projectId,
          auditType: "architect",
          chapterRange: "all",
          score: Math.round(architectResult.puntuacionArquitectura || 7),
          findings: architectResult,
          recommendations: architectResult.recomendaciones || [],
        });
      }

      // Check for critical blocks
      if (architectResult.bloqueoCritico) {
        console.log(`[ReeditOrchestrator] Critical block detected, continuing with warnings`);
      }

      // === STAGE 4.1: CHAPTER REORDERING (if recommended by Architect) ===
      const reordenamientos = architectResult.analisisEstructura?.reordenamientoSugerido || [];
      if (reordenamientos.length > 0) {
        this.emitProgress({
          projectId,
          stage: "architect",
          currentChapter: validChapters.length,
          totalChapters: validChapters.length,
          message: `Reordenando ${reordenamientos.length} capítulos según análisis arquitectónico...`,
        });

        validChapters = await this.reorderChaptersFromAnalysis(
          validChapters,
          projectId,
          reordenamientos
        );

        // Rebuild chapter arrays after reordering
        validChapters = validChapters.sort((a, b) => getChapterSortOrder(a.chapterNumber) - getChapterSortOrder(b.chapterNumber));
        console.log(`[ReeditOrchestrator] Chapters reordered. New order: ${validChapters.map(c => c.chapterNumber).join(', ')}`);
        
        await this.updateHeartbeat(projectId);
      }

      // === STAGE 4.5: QA AGENTS (OPTIMIZED - run BEFORE rewriting to consolidate all problems) ===
      // Check cancellation before QA stage
      if (await this.checkCancellation(projectId)) {
        console.log(`[ReeditOrchestrator] Processing cancelled before QA stage`);
        return;
      }

      // Skip QA if already past this stage (resume support)
      const skipQa = resumeStageIndex > stageOrder.indexOf("qa");
      
      if (skipQa) {
        console.log(`[ReeditOrchestrator] Skipping STAGE 4.5 (QA) - already completed (currentStage: ${resumeStage})`);
        this.emitProgress({
          projectId,
          stage: "qa",
          currentChapter: 0,
          totalChapters: 0,
          message: "Saltando etapa QA (ya completada)...",
        });
      } else {
        await storage.updateReeditProject(projectId, { currentStage: "qa" });

        // Clean up previous QA reports to avoid duplicates on restarts
        await storage.deleteReeditAuditReportsByType(projectId, "continuity");
        await storage.deleteReeditAuditReportsByType(projectId, "voice_rhythm");
        await storage.deleteReeditAuditReportsByType(projectId, "semantic_repetition");
        await storage.deleteReeditAuditReportsByType(projectId, "anachronism");

      // 4.5a: Continuity Sentinel - every 5 chapters
      const chapterBlocks5 = [];
      for (let i = 0; i < validChapters.length; i += 5) {
        chapterBlocks5.push(validChapters.slice(i, Math.min(i + 5, validChapters.length)));
      }

      // Calculate total QA operations for progress tracking
      const chapterBlocks10Count = Math.ceil(validChapters.length / 10);
      const totalQaOps = chapterBlocks5.length + chapterBlocks10Count + 2;
      let completedQaOps = 0;

      for (let blockIdx = 0; blockIdx < chapterBlocks5.length; blockIdx++) {
        const block = chapterBlocks5[blockIdx];
        const startChap = block[0].chapterNumber;
        const endChap = block[block.length - 1].chapterNumber;

        this.emitProgress({
          projectId,
          stage: "qa",
          currentChapter: blockIdx + 1,
          totalChapters: chapterBlocks5.length,
          message: `Centinela de Continuidad: capítulos ${startChap}-${endChap}...`,
        });

        const continuityResult = await this.continuitySentinel.auditContinuity(
          block.map(c => c.editedContent || c.originalContent),
          startChap,
          endChap
        );
        this.trackTokens(continuityResult);

        await storage.createReeditAuditReport({
          projectId,
          auditType: "continuity",
          chapterRange: `${startChap}-${endChap}`,
          score: Math.round(continuityResult.puntuacion || 8),
          findings: continuityResult,
          recommendations: continuityResult.erroresContinuidad?.map((e: any) => e.correccion) || [],
        });

        completedQaOps++;
        await this.updateHeartbeat(projectId, endChap);
      }

      // 4.5b: Voice & Rhythm Auditor - every 10 chapters
      const chapterBlocks10 = [];
      for (let i = 0; i < validChapters.length; i += 10) {
        chapterBlocks10.push(validChapters.slice(i, Math.min(i + 10, validChapters.length)));
      }

      for (let blockIdx = 0; blockIdx < chapterBlocks10.length; blockIdx++) {
        const block = chapterBlocks10[blockIdx];
        const startChap = block[0].chapterNumber;
        const endChap = block[block.length - 1].chapterNumber;

        this.emitProgress({
          projectId,
          stage: "qa",
          currentChapter: blockIdx + 1,
          totalChapters: chapterBlocks10.length,
          message: `Auditor de Voz y Ritmo: capítulos ${startChap}-${endChap}...`,
        });

        const voiceResult = await this.voiceRhythmAuditor.auditVoiceRhythm(
          block.map(c => c.editedContent || c.originalContent),
          startChap,
          endChap
        );
        this.trackTokens(voiceResult);

        await storage.createReeditAuditReport({
          projectId,
          auditType: "voice_rhythm",
          chapterRange: `${startChap}-${endChap}`,
          score: Math.round(voiceResult.puntuacion || 8),
          findings: voiceResult,
          recommendations: voiceResult.problemasTono?.map((p: any) => p.correccion) || [],
        });

        completedQaOps++;
        await this.updateHeartbeat(projectId, endChap);
      }

      // 4.5c: Semantic Repetition Detector - full manuscript (needs REAL content, not summaries)
      this.emitProgress({
        projectId,
        stage: "qa",
        currentChapter: validChapters.length,
        totalChapters: validChapters.length,
        message: "Detector de Repetición Semántica: manuscrito completo...",
      });

      // Pass real chapter content to semantic detector, not empty summaries
      const chapterContentsForSemantic = validChapters.map(c => 
        `=== CAPÍTULO ${c.chapterNumber}: ${c.title || ''} ===\n${c.editedContent || c.originalContent}`
      );
      
      const semanticResult = await this.semanticRepetitionDetector.detectRepetitions(
        chapterContentsForSemantic,
        validChapters.length
      );
      this.trackTokens(semanticResult);

      await storage.createReeditAuditReport({
        projectId,
        auditType: "semantic_repetition",
        chapterRange: "all",
        score: Math.round(semanticResult.puntuacion || 8),
        findings: semanticResult,
        recommendations: semanticResult.repeticionesSemanticas?.map((r: any) => `${r.accion}: ${r.descripcion}`) || [],
      });

      completedQaOps++;
      await this.updateHeartbeat(projectId, validChapters.length);

      // 4.5d: Anachronism Detector - for historical novels
      this.emitProgress({
        projectId,
        stage: "qa",
        currentChapter: validChapters.length,
        totalChapters: validChapters.length,
        message: "Detector de Anacronismos...",
      });

      const anachronismResult = await this.anachronismDetector.detectAnachronisms(
        validChapters.map(c => ({ num: c.chapterNumber, content: c.editedContent || c.originalContent })),
        "",
        project.title || ""
      );
      this.trackTokens(anachronismResult);

      await storage.createReeditAuditReport({
        projectId,
        auditType: "anachronism",
        chapterRange: "all",
        score: Math.round(anachronismResult.puntuacionHistorica || 10),
        findings: anachronismResult,
        recommendations: anachronismResult.anacronismos?.map((a: any) => a.correccion) || [],
      });

      completedQaOps++;
      await this.updateHeartbeat(projectId, validChapters.length);
      console.log(`[ReeditOrchestrator] QA stage completed: ${completedQaOps}/${totalQaOps} operations`);
      } // End of skipQa else block

      // === STAGE 5: CONSOLIDATED NARRATIVE REWRITING (Architect + QA problems in ONE pass) ===
      // Skip if already past this stage (resume support)
      const skipNarrativeRewriting = resumeStageIndex > stageOrder.indexOf("narrative_rewriting");
      
      if (skipNarrativeRewriting) {
        console.log(`[ReeditOrchestrator] Skipping STAGE 5 (narrative_rewriting) - already completed (currentStage: ${resumeStage})`);
        this.emitProgress({
          projectId,
          stage: "narrative_rewriting",
          currentChapter: 0,
          totalChapters: 0,
          message: "Saltando etapa de reescritura (ya completada)...",
        });
      } else {
        // CRITICAL: Update stage IMMEDIATELY after QA completes to prevent re-running QA on resume
        await storage.updateReeditProject(projectId, { currentStage: "narrative_rewriting" });
      }
      
      // Collect all problems from Architect
      const architectProblems = this.collectArchitectProblems(architectResult);
      
      // Collect all problems from QA agents
      const qaFindings = await this.collectQaFindings(projectId);
      
      // Consolidate all problems by chapter (filtering out already-resolved issues)
      const consolidatedProblems = await this.consolidateAllProblems(architectProblems, qaFindings, projectId);
      
      // Check if NarrativeRewriter already completed (resume support)
      const existingRewriteReport = await storage.getReeditAuditReportByType(projectId, "narrative_rewrite");
      const narrativeRewriteCompleted = existingRewriteReport && 
        (existingRewriteReport.findings as any)?.chaptersRewritten > 0;
      
      // Track which chapters were rewritten (for CopyEditor optimization)
      const rewrittenChapters = new Set<number>();
      
      // Get user instructions for rewriting (architectInstructions from project creation)
      const userRewriteInstructions = project.architectInstructions || "";
      
      if (consolidatedProblems.size > 0 && !narrativeRewriteCompleted && !skipNarrativeRewriting) {
        const totalProblemsCount = Array.from(consolidatedProblems.values()).reduce((sum, p) => sum + p.length, 0);
        console.log(`[ReeditOrchestrator] OPTIMIZED: Consolidating ${totalProblemsCount} problems (Architect + QA) in ${consolidatedProblems.size} chapters for SINGLE rewriting pass`);
        
        // Load change history for intelligent resolution tracking (shared with final review)
        type ChangeEntryNR = { issue: string; fix: string; timestamp: string };
        const loadedHistoryNR = (project?.chapterChangeHistory as Record<string, ChangeEntryNR[]>) || {};
        const chapterChangeHistoryNR: Map<number, ChangeEntryNR[]> = new Map(
          Object.entries(loadedHistoryNR).map(([k, v]) => [parseInt(k), v])
        );
        
        this.emitProgress({
          projectId,
          stage: "narrative_rewriting",
          currentChapter: 0,
          totalChapters: consolidatedProblems.size,
          message: `Reescritura consolidada: ${totalProblemsCount} problemas (Arquitecto + QA) en ${consolidatedProblems.size} capítulos...`,
        });
        
        if (userRewriteInstructions) {
          console.log(`[ReeditOrchestrator] User instructions for rewriting: "${userRewriteInstructions.substring(0, 100)}..."`);
        }
        
        let fixedCount = 0;
        const rewriteResults: any[] = [];
        const chapterEntries = Array.from(consolidatedProblems.entries()).sort((a, b) => a[0] - b[0]);
        
        for (const [chapNum, chapterProblems] of chapterEntries) {
          if (await this.checkCancellation(projectId)) {
            console.log(`[ReeditOrchestrator] Processing cancelled during narrative rewriting`);
            return;
          }
          
          const chapter = validChapters.find(c => c.chapterNumber === chapNum);
          if (!chapter) {
            console.log(`[ReeditOrchestrator] Chapter ${chapNum} not found for narrative rewriting`);
            continue;
          }
          
          // Group problems by source for logging
          const architectCount = chapterProblems.filter(p => p.source === 'architect').length;
          const qaCount = chapterProblems.filter(p => p.source !== 'architect').length;
          
          this.emitProgress({
            projectId,
            stage: "narrative_rewriting",
            currentChapter: fixedCount + 1,
            totalChapters: consolidatedProblems.size,
            message: `Reescribiendo capítulo ${chapNum}: ${chapterProblems.length} problemas (${architectCount} estructurales, ${qaCount} QA)...`,
          });
          
          try {
            const adjacentContext = this.buildAdjacentChapterContext(validChapters, chapNum);
            const chapterContent = chapter.editedContent || chapter.originalContent;
            const formattedProblems = chapterProblems.map((p: any, idx: number) => ({
              id: `${p.source}-${idx + 1}`,
              tipo: p.tipo || 'structural',
              descripcion: p.descripcion,
              severidad: p.severidad || 'mayor',
              accionSugerida: p.accionSugerida,
              fuente: p.source
            }));
            
            // Use smartCorrectChapter for automatic surgical/full decision
            const correctionResult = await this.smartCorrectChapter(
              chapterContent,
              chapNum,
              formattedProblems,
              worldBibleResult,
              adjacentContext,
              detectedLang,
              userRewriteInstructions || undefined
            );
            
            const hasChanges = correctionResult.content && correctionResult.content !== chapterContent;
            
            if (correctionResult.content && hasChanges) {
              const wordCount = correctionResult.content.split(/\s+/).filter((w: string) => w.length > 0).length;
              
              await storage.updateReeditChapter(chapter.id, {
                originalContent: correctionResult.content,
                editedContent: correctionResult.content,
                wordCount,
                processingStage: "completed",
              });
              
              rewrittenChapters.add(chapNum);
              rewriteResults.push({
                chapter: chapNum,
                problemsTotal: chapterProblems.length,
                problemsArchitect: architectCount,
                problemsQA: qaCount,
                changes: formattedProblems.length,
                confidence: 8,
                summary: `Corrección ${correctionResult.method === 'surgical' ? 'quirúrgica' : 'completa'}`
              });
              
              // SAVE CHANGE HISTORY for intelligent resolution validation
              const issuesSummaryNR = chapterProblems.map((p: any) => (p.descripcion || "").substring(0, 300)).join("; ");
              const changesSummaryNR = `${correctionResult.method === 'surgical' ? 'Parches quirúrgicos' : 'Reescritura completa'}: ${formattedProblems.length} problemas`;
              let existingHistoryNR = chapterChangeHistoryNR.get(chapNum) || [];
              existingHistoryNR.push({
                issue: issuesSummaryNR,
                fix: changesSummaryNR,
                timestamp: new Date().toISOString()
              });
              if (existingHistoryNR.length > 10) existingHistoryNR = existingHistoryNR.slice(-10);
              chapterChangeHistoryNR.set(chapNum, existingHistoryNR);
              
              await storage.updateReeditProject(projectId, {
                chapterChangeHistory: Object.fromEntries(chapterChangeHistoryNR) as any,
              });
              
              console.log(`[ReeditOrchestrator] Chapter ${chapNum} corrected (${correctionResult.method}): ${formattedProblems.length} problems fixed`);
            } else {
              console.log(`[ReeditOrchestrator] Chapter ${chapNum}: No effective changes from consolidated correction`);
            }
          } catch (rewriteError) {
            console.error(`[ReeditOrchestrator] Error rewriting chapter ${chapNum}:`, rewriteError);
          }
          
          fixedCount++;
          await this.updateHeartbeat(projectId);
        }
        
        // Save consolidated narrative rewriting report
        await storage.createReeditAuditReport({
          projectId,
          auditType: "narrative_rewrite",
          chapterRange: "all",
          score: rewriteResults.length > 0 ? Math.round(rewriteResults.reduce((sum, r) => sum + (r.confidence || 7), 0) / rewriteResults.length) : 7,
          findings: {
            optimizedPipeline: true,
            totalProblemsConsolidated: totalProblemsCount,
            chaptersRewritten: rewrittenChapters.size,
            architectProblemsTotal: architectProblems.length,
            qaProblemsTotal: Array.from(qaFindings.values()).reduce((sum, p) => sum + p.length, 0),
            rewriteResults: rewriteResults
          },
          recommendations: [],
        });
        
        console.log(`[ReeditOrchestrator] Consolidated narrative rewriting complete: ${rewrittenChapters.size} chapters updated`);
        
        // Reload chapters to get updated content
        const updatedChapters = await storage.getReeditChaptersByProject(projectId);
        validChapters.length = 0;
        validChapters.push(...updatedChapters.filter(c => c.originalContent));
      } else if (narrativeRewriteCompleted) {
        const chaptersRewritten = (existingRewriteReport.findings as any)?.chaptersRewritten || 0;
        console.log(`[ReeditOrchestrator] Skipping narrative rewriting (already completed: ${chaptersRewritten} chapters rewritten)`);
        // Mark rewritten chapters from previous run
        if (existingRewriteReport?.findings) {
          const results = (existingRewriteReport.findings as any)?.rewriteResults || [];
          for (const r of results) {
            if (r.chapter) rewrittenChapters.add(r.chapter);
          }
        }
      } else {
        console.log(`[ReeditOrchestrator] No problems to fix (Architect + QA both clean)`);
      }

      // Check cancellation before CopyEditor stage
      if (await this.checkCancellation(projectId)) {
        console.log(`[ReeditOrchestrator] Processing cancelled before CopyEditor stage`);
        return;
      }

      // === STAGE 6: COPY EDITING (OPTIMIZED - only chapters NOT rewritten) ===
      // Skip if already past this stage (resume support)
      const skipCopyEditing = resumeStageIndex > stageOrder.indexOf("copyediting");
      
      if (skipCopyEditing) {
        console.log(`[ReeditOrchestrator] Skipping STAGE 6 (copyediting) - already completed (currentStage: ${resumeStage})`);
        this.emitProgress({
          projectId,
          stage: "copyediting",
          currentChapter: 0,
          totalChapters: 0,
          message: "Saltando etapa de corrección de estilo (ya completada)...",
        });
      } else {
        const chaptersNeedingCopyEdit = validChapters.filter(c => !rewrittenChapters.has(c.chapterNumber));
        const skippedCount = validChapters.length - chaptersNeedingCopyEdit.length;
        
        console.log(`[ReeditOrchestrator] OPTIMIZED CopyEditor: Processing ${chaptersNeedingCopyEdit.length} chapters (skipping ${skippedCount} already rewritten)`);
        
        this.emitProgress({
          projectId,
          stage: "copyediting",
          currentChapter: 0,
          totalChapters: chaptersNeedingCopyEdit.length,
          message: `Corrección de estilo: ${chaptersNeedingCopyEdit.length} capítulos (${skippedCount} ya procesados)...`,
        });

        await storage.updateReeditProject(projectId, { currentStage: "copyediting" });
        await this.updateHeartbeat(projectId);

        for (let i = 0; i < chaptersNeedingCopyEdit.length; i++) {
        if (await this.checkCancellation(projectId)) {
          console.log(`[ReeditOrchestrator] Processing cancelled at copyediting stage, chapter ${i + 1}`);
          return;
        }

        const chapter = chaptersNeedingCopyEdit[i];
        
        // Skip chapters that were already copy-edited (resume support)
        if (chapter.editedContent && chapter.processingStage === "completed") {
          console.log(`[ReeditOrchestrator] Skipping chapter ${chapter.chapterNumber} (already completed)`);
          continue;
        }
        
        this.emitProgress({
          projectId,
          stage: "copyediting",
          currentChapter: i + 1,
          totalChapters: chaptersNeedingCopyEdit.length,
          message: `Capítulo ${chapter.chapterNumber}: Corrección de estilo...`,
        });

        await storage.updateReeditChapter(chapter.id, {
          processingStage: "copyeditor",
        });

        const contentToEdit = chapter.originalContent;
        
        const copyEditorResult = await this.copyEditorAgent.editChapter(
          contentToEdit,
          chapter.chapterNumber,
          detectedLang
        );
        this.trackTokens(copyEditorResult);

        const editedContent = copyEditorResult.editedContent || chapter.originalContent;
        const wordCount = editedContent.split(/\s+/).filter((w: string) => w.length > 0).length;

        await storage.updateReeditChapter(chapter.id, {
          editedContent,
          copyeditorChanges: copyEditorResult.changesLog || "",
          fluencyImprovements: copyEditorResult.fluencyChanges || [],
          wordCount,
          processingStage: "completed",
        });

        await storage.updateReeditProject(projectId, {
          processedChapters: rewrittenChapters.size + i + 1,
        });
        
        await this.updateHeartbeat(projectId, chapter.chapterNumber);
      }
      
      console.log(`[ReeditOrchestrator] CopyEditor stage complete: ${chaptersNeedingCopyEdit.length} chapters processed, ${skippedCount} skipped (already rewritten)`)
      } // End of skipCopyEditing else block

      // === STAGE 6.5: BETA READER (Commercial Viability Analysis) ===
      const skipBetaReader = resumeStageIndex > stageOrder.indexOf("beta_reader");
      let betaReaderReport: BetaReaderReport | null = (project as any).betaReaderReport || null;

      if (!skipBetaReader) {
        // Check for cancellation before beta reader analysis
        if (await this.checkCancellation(projectId)) {
          console.log(`[ReeditOrchestrator] Processing cancelled before Beta Reader analysis`);
          return;
        }

        this.emitProgress({
          projectId,
          stage: "beta_reader" as any,
          currentChapter: 0,
          totalChapters: validChapters.length,
          message: "Análisis de viabilidad comercial (Lector Beta)...",
        });

        await storage.updateReeditProject(projectId, { currentStage: "beta_reader" });

        // Get updated chapters with edited content
        const updatedChaptersForBeta = await storage.getReeditChaptersByProject(projectId);
        const chaptersWithContent = updatedChaptersForBeta
          .filter(c => c.editedContent || c.originalContent)
          .sort((a, b) => getChapterSortOrder(a.chapterNumber) - getChapterSortOrder(b.chapterNumber));

        // Calculate total word count
        const totalWordCount = chaptersWithContent.reduce((acc, c) => {
          const content = c.editedContent || c.originalContent;
          return acc + (content?.split(/\s+/).length || 0);
        }, 0);

        // Get summaries for beta reader
        const summariesForBeta = chaptersWithContent.map(c => c.summary || "");
        const firstChapterContent = chaptersWithContent[0]?.editedContent || chaptersWithContent[0]?.originalContent || "";
        const lastChapterContent = chaptersWithContent[chaptersWithContent.length - 1]?.editedContent || 
          chaptersWithContent[chaptersWithContent.length - 1]?.originalContent || "";

        // Run Beta Reader evaluation with error handling
        try {
          // Check if DeepSeek API key is configured
          if (!process.env.DEEPSEEK_API_KEY) {
            console.warn(`[ReeditOrchestrator] DeepSeek API key not configured - skipping Beta Reader analysis`);
            // Persist skipped status so UI can reflect completion state
            await storage.updateReeditProject(projectId, {
              currentStage: "beta_reader",
              betaReaderReport: {
                skipped: true,
                reason: "DeepSeek API key not configured",
                score: null,
                viability: null,
                critique_summary: "Análisis de lector beta omitido: API DeepSeek no configurada",
                strengths: [],
                weaknesses: [],
                flagged_chapters: [],
                market_comparison: null
              } as any,
              betaReaderScore: null,
              commercialViability: null,
            });
            this.emitProgress({
              projectId,
              stage: "beta_reader" as any,
              currentChapter: validChapters.length,
              totalChapters: validChapters.length,
              message: `Lector Beta omitido: API DeepSeek no configurada`,
            });
          } else {
            const betaResult = await this.betaReader.evaluateNovel(
              projectId,
              project.genre || "general",
              summariesForBeta,
              firstChapterContent.substring(0, 6000),
              lastChapterContent.substring(0, 6000)
            );

            betaReaderReport = betaResult.report;
            this.trackTokens({ tokenUsage: betaResult.tokenUsage });

            await storage.updateReeditProject(projectId, {
              currentStage: "beta_reader",
              betaReaderReport: betaReaderReport as any,
              betaReaderScore: betaReaderReport?.score || 5,
              commercialViability: betaReaderReport?.viability || "Medium",
            });

            console.log(`[ReeditOrchestrator] Beta Reader complete: Score ${betaReaderReport?.score}/10, Viability: ${betaReaderReport?.viability}`);

            this.emitProgress({
              projectId,
              stage: "beta_reader" as any,
              currentChapter: validChapters.length,
              totalChapters: validChapters.length,
              message: `Lector Beta: Viabilidad ${betaReaderReport?.viability} (${betaReaderReport?.score}/10) - ${betaReaderReport?.flagged_chapters?.length || 0} capítulos marcados`,
            });
          }
        } catch (betaError: any) {
          console.error(`[ReeditOrchestrator] Beta Reader failed:`, betaError.message);
          this.emitProgress({
            projectId,
            stage: "beta_reader" as any,
            currentChapter: validChapters.length,
            totalChapters: validChapters.length,
            message: `Lector Beta falló (continuando sin análisis comercial): ${betaError.message?.substring(0, 100)}`,
          });
          // Continue pipeline even if beta reader fails
        }

        await this.updateHeartbeat(projectId);
      } else {
        console.log(`[ReeditOrchestrator] Skipping STAGE 6.5 (beta_reader) - already completed`);
      }

      // === STAGE 7: FINAL REVIEW (with 10/10 twice consecutive logic using full content reviewer) ===
      await storage.updateReeditProject(projectId, { currentStage: "reviewing" });

      // Load saved review cycle state for resume support
      const savedProject = await storage.getReeditProject(projectId);
      let revisionCycle = savedProject?.revisionCycle || 0;
      let consecutiveHighScores = savedProject?.consecutiveHighScores || 0;
      const previousScores: number[] = (savedProject?.previousScores as number[]) || [];
      let nonPerfectCount = savedProject?.nonPerfectFinalReviews || 0;
      const userInstructions = savedProject?.pendingUserInstructions || "";
      let finalResult: FinalReviewerResult | null = null;
      let bestsellerScore = 0;
      const correctedIssueDescriptions: string[] = [];
      
      // Maximum non-10 scores before pausing for user instructions
      const MAX_NON_PERFECT_BEFORE_PAUSE = 15;
      // TOTAL cycle limit to prevent infinite loops (uses dedicated field that never resets)
      const MAX_TOTAL_CYCLES = 30;
      let totalCyclesExecuted = (savedProject?.totalReviewCycles || 0);

      if (revisionCycle > 0) {
        console.log(`[ReeditOrchestrator] RESUMING Final Review: cycle ${revisionCycle}, consecutive=${consecutiveHighScores}, nonPerfect=${nonPerfectCount}, scores=[${previousScores.join(',')}]`);
      }
      
      // If user provided instructions, add them to the correction context
      if (userInstructions) {
        console.log(`[ReeditOrchestrator] User instructions received: "${userInstructions.substring(0, 100)}..."`);
        correctedIssueDescriptions.push(`INSTRUCCIONES DEL USUARIO: ${userInstructions}`);
        // Clear instructions after applying
        await storage.updateReeditProject(projectId, { 
          pendingUserInstructions: null,
          pauseReason: null,
        });
      }

      // Get World Bible and style guide for full final review
      const worldBibleForReview = await storage.getReeditWorldBibleByProject(projectId);
      const guiaEstilo = (project as any).styleGuide || "";

      // Track resolved hashes locally to avoid stale data from project object
      let localResolvedHashes: string[] = (project.resolvedIssueHashes as string[]) || [];
      
      // Track chapters corrected - PERSISTED across restarts to prevent infinite loops
      const MAX_CORRECTIONS_PER_CHAPTER = 4; // Max times a chapter can be corrected before pausing
      const loadedCounts = (savedProject?.chapterCorrectionCounts as Record<string, number>) || {};
      const chapterCorrectionCounts: Map<number, number> = new Map(
        Object.entries(loadedCounts).map(([k, v]) => [parseInt(k), v])
      );
      
      // Load change history for intelligent resolution validation
      type ChangeEntry = { issue: string; fix: string; timestamp: string };
      const loadedHistory = (savedProject?.chapterChangeHistory as Record<string, ChangeEntry[]>) || {};
      const chapterChangeHistory: Map<number, ChangeEntry[]> = new Map(
        Object.entries(loadedHistory).map(([k, v]) => [parseInt(k), v])
      );
      console.log(`[ReeditOrchestrator] LOADED change history: ${chapterChangeHistory.size} chapters with history. Keys: [${Array.from(chapterChangeHistory.keys()).join(', ')}]`);
      const issueValidator = new IssueResolutionValidatorAgent();
      
      while (revisionCycle < this.maxFinalReviewCycles) {
        // Check for cancellation at start of each cycle
        if (await this.checkCancellation(projectId)) {
          console.log(`[ReeditOrchestrator] Cancelled during final review cycle ${revisionCycle}`);
          return;
        }
        
        // CRITICAL: Reload resolved hashes from DB to include newly resolved issues
        const refreshedProject = await storage.getReeditProject(projectId);
        localResolvedHashes = (refreshedProject?.resolvedIssueHashes as string[]) || [];
        
        // Check total cycle limit to prevent infinite loops
        totalCyclesExecuted++;
        if (totalCyclesExecuted > MAX_TOTAL_CYCLES) {
          const pauseReason = `Se alcanzó el límite de ${MAX_TOTAL_CYCLES} ciclos totales. Última puntuación: ${Math.round(bestsellerScore)}/10. Por favor, usa "Forzar completado" o proporciona instrucciones.`;
          console.log(`[ReeditOrchestrator] PAUSING: Total cycle limit reached (${totalCyclesExecuted})`);
          
          await storage.updateReeditProject(projectId, {
            status: "awaiting_instructions",
            pauseReason,
            totalReviewCycles: totalCyclesExecuted,
            consecutiveHighScores,
            nonPerfectFinalReviews: nonPerfectCount,
            previousScores: previousScores as any,
            finalReviewResult: finalResult,
            bestsellerScore: Math.round(bestsellerScore),
          });
          
          this.emitProgress({
            projectId,
            stage: "paused",
            currentChapter: validChapters.length,
            totalChapters: validChapters.length,
            message: pauseReason,
          });
          return;
        }
        const consecutiveInfo = consecutiveHighScores > 0 
          ? ` [${consecutiveHighScores}/${this.requiredConsecutiveHighScores} puntuaciones 10/10 consecutivas]`
          : "";

        this.emitProgress({
          projectId,
          stage: "reviewing",
          currentChapter: validChapters.length,
          totalChapters: validChapters.length,
          message: `Ejecutando revisión final COMPLETA... (Ciclo ${revisionCycle + 1}/${this.maxFinalReviewCycles})${consecutiveInfo}`,
        });

        // Get all completed chapters with FULL content for proper review
        const updatedChapters = await storage.getReeditChaptersByProject(projectId);
        const completedChapters = updatedChapters
          .filter(c => c.editedContent)
          .sort((a, b) => getChapterSortOrder(a.chapterNumber) - getChapterSortOrder(b.chapterNumber));

        // Build chapters array with full content for FinalReviewer
        const chaptersForReview = completedChapters.map(c => ({
          numero: c.chapterNumber,
          titulo: c.title || `Capítulo ${c.chapterNumber}`,
          contenido: c.editedContent || c.originalContent,
        }));

        // Call the FULL final reviewer with complete manuscript content
        const fullReviewResult = await this.fullFinalReviewerAgent.execute({
          projectTitle: project.title,
          chapters: chaptersForReview,
          worldBible: worldBibleForReview || {},
          guiaEstilo: guiaEstilo,
          pasadaNumero: revisionCycle + 1,
          issuesPreviosCorregidos: correctedIssueDescriptions,
        });
        this.trackTokens(fullReviewResult);
        await this.updateHeartbeat(projectId);

        finalResult = fullReviewResult.result || null;
        // Use raw score for threshold checks - only round when persisting to DB
        const rawScore = finalResult?.puntuacion_global || 7;
        bestsellerScore = rawScore; // Keep as float for accurate threshold comparison
        previousScores.push(rawScore);

        const veredicto = finalResult?.veredicto || "REQUIERE_REVISION";
        const rawIssuesForApproval = finalResult?.issues || [];
        const chapsToRewrite = finalResult?.capitulos_para_reescribir?.length || 0;
        
        // Filter out resolved issues BEFORE checking for critical issues
        // Use localResolvedHashes which is refreshed each cycle instead of stale project data
        const { newIssues: filteredIssuesForApproval } = this.filterNewIssues(rawIssuesForApproval, localResolvedHashes);
        
        // Check for critical issues from FILTERED list only
        const criticalIssues = filteredIssuesForApproval.filter((issue: any) => 
          issue.severidad === "critica" || issue.severidad === "crítica"
        );
        const hasCriticalIssues = criticalIssues.length > 0;
        const issuesCount = filteredIssuesForApproval.length;

        console.log(`[ReeditOrchestrator] Final review cycle ${revisionCycle + 1}: score ${rawScore}/10, veredicto: ${veredicto}, issues: ${issuesCount} (${criticalIssues.length} críticos, ${rawIssuesForApproval.length - issuesCount} ya resueltos), chapters to rewrite: ${chapsToRewrite}`);

        // Aprobar si: puntuación >= 9 Y no hay NINGÚN issue nuevo (crítico o no)
        // Si hay issues pendientes (incluso menores), deben corregirse antes de aprobar
        const hasAnyNewIssues = issuesCount > 0 || chapsToRewrite > 0;
        
        if (rawScore >= this.minAcceptableScore && !hasAnyNewIssues) {
          consecutiveHighScores++;
          nonPerfectCount = 0;
          console.log(`[ReeditOrchestrator] Score ${rawScore}/10 with NO new issues. Consecutive high scores: ${consecutiveHighScores}`);
        } else if (rawScore >= this.minAcceptableScore && hasAnyNewIssues) {
          // Puntuación alta pero con issues pendientes - no aprobar, corregir primero
          console.log(`[ReeditOrchestrator] Score ${rawScore}/10 is good but ${issuesCount} issue(s) remain (${criticalIssues.length} críticos). Correcting...`);
          // Don't increment consecutiveHighScores - must correct issues first
        } else {
          consecutiveHighScores = 0;
          nonPerfectCount++;
          
          // Check if we should pause for user instructions
          if (nonPerfectCount >= MAX_NON_PERFECT_BEFORE_PAUSE) {
            const pauseReason = `Después de ${nonPerfectCount} evaluaciones sin alcanzar 10/10, el proceso se ha pausado. Última puntuación: ${rawScore}/10. Issues detectados: ${issuesCount}. Por favor, proporciona instrucciones para continuar.`;
            
            console.log(`[ReeditOrchestrator] PAUSING after ${nonPerfectCount} non-perfect scores. Waiting for user instructions.`);
            
            await storage.updateReeditProject(projectId, {
              status: "awaiting_instructions",
              pauseReason,
              revisionCycle,
              consecutiveHighScores,
              nonPerfectFinalReviews: nonPerfectCount,
              previousScores: previousScores as any,
              finalReviewResult: finalResult,
              bestsellerScore: Math.round(bestsellerScore),
            });
            
            this.emitProgress({
              projectId,
              stage: "paused",
              currentChapter: validChapters.length,
              totalChapters: validChapters.length,
              message: pauseReason,
            });
            
            // Exit the loop - wait for user to resume with instructions
            return;
          }
        }

        if (consecutiveHighScores >= this.requiredConsecutiveHighScores) {
          const recentScores = previousScores.slice(-this.requiredConsecutiveHighScores).join(", ");
          console.log(`[ReeditOrchestrator] APROBADO: Puntuaciones consecutivas ${recentScores}/10`);
          
          this.emitProgress({
            projectId,
            stage: "reviewing",
            currentChapter: validChapters.length,
            totalChapters: validChapters.length,
            message: `Manuscrito APROBADO. Puntuaciones consecutivas: ${recentScores}/10. Calidad bestseller confirmada.`,
          });
          break;
        }

        // Only skip corrections if score is high AND no issues remain at all
        // If there are ANY issues (critical or not), we must fall through to the correction phase
        if (bestsellerScore >= this.minAcceptableScore && consecutiveHighScores < this.requiredConsecutiveHighScores && !hasAnyNewIssues) {
          this.emitProgress({
            projectId,
            stage: "reviewing",
            currentChapter: validChapters.length,
            totalChapters: validChapters.length,
            message: `Puntuación ${bestsellerScore}/10. Necesita ${this.requiredConsecutiveHighScores - consecutiveHighScores} evaluación(es) más con 10/10 para confirmar.`,
          });
          revisionCycle++;
          continue;
        }

        // Si llegamos al límite de ciclos sin el doble 10/10, incrementamos y dejamos
        // que el límite total (MAX_TOTAL_CYCLES) controle el bucle
        if (revisionCycle === this.maxFinalReviewCycles - 1) {
          const avgScore = previousScores.length > 0
            ? (previousScores.reduce((a, b) => a + b, 0) / previousScores.length).toFixed(1)
            : bestsellerScore;
          
          console.log(`[ReeditOrchestrator] Límite de ciclos locales alcanzado. Puntuación: ${bestsellerScore}/10 (promedio: ${avgScore}). Total ejecutados: ${totalCyclesExecuted}`);
          // NO reseteamos revisionCycle - dejamos que MAX_TOTAL_CYCLES controle el bucle
        }

        this.emitProgress({
          projectId,
          stage: "reviewing",
          currentChapter: validChapters.length,
          totalChapters: validChapters.length,
          message: `Puntuación ${bestsellerScore}/10 insuficiente. Corrigiendo ${chapsToRewrite} capítulo(s) con ${issuesCount} issue(s)...`,
        });

        // Apply corrections based on FULL final reviewer feedback
        const rawIssues = finalResult?.issues || [];
        const chaptersToRewrite = finalResult?.capitulos_para_reescribir || [];
        
        // Filter out issues that have already been resolved in previous cycles
        // Use localResolvedHashes which is refreshed each cycle instead of stale project data
        const { newIssues: issues, filteredCount } = this.filterNewIssues(rawIssues, localResolvedHashes);
        
        if (filteredCount > 0) {
          console.log(`[ReeditOrchestrator] ${filteredCount} issues ya resueltos fueron filtrados, quedan ${issues.length} nuevos`);
        }
        
        // === USER ISSUE APPROVAL FLOW (same as runFinalReviewOnly) ===
        // If there are new issues, create records and pause for user approval
        if (issues.length > 0) {
          // Check if we have user-approved issues to process
          const approvedIssues = await storage.getApprovedPendingIssues(projectId);
          
          if (approvedIssues.length === 0) {
            // Check if there are pending issues awaiting user decision
            const pendingIssues = await storage.getReeditIssuesByStatus(projectId, "pending");
            
            if (pendingIssues.length === 0) {
              // No approved or pending issues - create records and pause for user review
              await this.createIssueRecords(projectId, issues, revisionCycle);
              
              const criticalCount = issues.filter((i: any) => i.severidad === "critica" || i.severidad === "crítica").length;
              const majorCount = issues.filter((i: any) => i.severidad === "mayor").length;
              const minorCount = issues.filter((i: any) => i.severidad === "menor").length;
              const pauseReason = `Se detectaron ${issues.length} problema(s) (${criticalCount} crítico(s), ${majorCount} mayor(es), ${minorCount} menor(es)). Por favor revisa la lista de problemas y aprueba o rechaza cada uno antes de continuar con las correcciones automáticas.`;
              
              console.log(`[ReeditOrchestrator] PAUSING: ${issues.length} issues detected, awaiting user approval`);
              
              await storage.updateReeditProject(projectId, {
                status: "awaiting_issue_approval",
                currentStage: "reviewing",
                pauseReason,
                chapterCorrectionCounts: Object.fromEntries(chapterCorrectionCounts) as any,
              });
              
              this.emitProgress({
                projectId,
                stage: "awaiting_approval",
                currentChapter: 0,
                totalChapters: validChapters.length,
                message: pauseReason,
              });
              
              return; // Exit and wait for user to approve/reject issues
            }
            
            // There are pending issues - user hasn't decided yet, wait
            console.log(`[ReeditOrchestrator] ${pendingIssues.length} pending issues awaiting user decision`);
            return;
          }
          
          // User has approved some issues - apply corrections for those only
          console.log(`[ReeditOrchestrator] User approved ${approvedIssues.length} issues for correction`);
          
          // Apply corrections for approved issues only
          const correctionResults = await this.applyUserApprovedCorrections(
            projectId, 
            approvedIssues, 
            validChapters, 
            worldBibleForReview, 
            guiaEstilo, 
            userInstructions,
            localResolvedHashes,
            chapterCorrectionCounts
          );
          
          // Mark all approved issues as resolved in the database
          for (const issue of approvedIssues) {
            await storage.resolveReeditIssue(issue.id);
          }
          
          // Continue to next review cycle
          revisionCycle++;
          continue;
        }
        
        // Note: If we reach here, issues.length === 0 (approval flow already handled issues above)
        // Handle chaptersToRewrite separately when there are no specific issues
        if (chaptersToRewrite.length > 0) {
          // Convert chaptersToRewrite to synthetic issues for approval flow
          const syntheticIssues: any[] = chaptersToRewrite.map((chapNum: number) => ({
            categoria: "calidad_general",
            descripcion: `El capítulo ${chapNum} requiere mejoras de calidad según el revisor final.`,
            severidad: "mayor",
            capitulos_afectados: [chapNum],
            elementos_a_preservar: "",
            instrucciones_correccion: "Mejorar la calidad general del capítulo según las recomendaciones del revisor."
          }));
          
          // Create issue records for user approval
          const approvedIssuesForChapters = await storage.getApprovedPendingIssues(projectId);
          const pendingIssuesForChapters = await storage.getReeditIssuesByStatus(projectId, "pending");
          
          if (approvedIssuesForChapters.length === 0 && pendingIssuesForChapters.length === 0) {
            await this.createIssueRecords(projectId, syntheticIssues, revisionCycle);
            
            const pauseReason = `Se detectaron ${chaptersToRewrite.length} capítulo(s) que requieren mejoras de calidad. Por favor revisa la lista y aprueba o rechaza cada uno.`;
            
            console.log(`[ReeditOrchestrator] PAUSING: ${chaptersToRewrite.length} chapters to rewrite, awaiting user approval`);
            
            await storage.updateReeditProject(projectId, {
              status: "awaiting_issue_approval",
              currentStage: "reviewing",
              pauseReason,
              chapterCorrectionCounts: Object.fromEntries(chapterCorrectionCounts) as any,
            });
            
            this.emitProgress({
              projectId,
              stage: "awaiting_approval",
              currentChapter: 0,
              totalChapters: validChapters.length,
              message: pauseReason,
            });
            
            return;
          }
          
          // Get unique chapter numbers that need fixes (from approved issues if any)
          const chapterNumbersToFix = new Set<number>();
          for (const issue of approvedIssuesForChapters) {
            chapterNumbersToFix.add(issue.chapterNumber);
          }

          // Get chapters that need improvement
          const chaptersToFix = await storage.getReeditChaptersByProject(projectId);
          const editableChapters = chaptersToFix.filter(c => c.editedContent);
          
          // Only fix chapters specifically mentioned, limit to 5 per cycle
          // ALSO filter out chapters that have been corrected too many times to prevent infinite loops
          const chaptersNeedingFix = editableChapters
            .filter(c => chapterNumbersToFix.has(c.chapterNumber))
            .filter(c => {
              const correctionCount = chapterCorrectionCounts.get(c.chapterNumber) || 0;
              if (correctionCount >= MAX_CORRECTIONS_PER_CHAPTER) {
                console.log(`[ReeditOrchestrator] Skipping chapter ${c.chapterNumber}: already corrected ${correctionCount} times (max: ${MAX_CORRECTIONS_PER_CHAPTER})`);
                return false;
              }
              return true;
            })
            .slice(0, 10); // Corrige hasta 10 capítulos por ciclo
          
          if (chaptersNeedingFix.length === 0 && chapterNumbersToFix.size > 0) {
            // PAUSE for user intervention instead of auto-resolving
            const skippedChapters = Array.from(chapterNumbersToFix).join(", ");
            const pauseReason = `Los capítulos ${skippedChapters} han sido corregidos ${MAX_CORRECTIONS_PER_CHAPTER} veces sin resolver los problemas detectados. Por favor, revisa manualmente estos capítulos o proporciona instrucciones específicas para continuar.`;
            console.log(`[ReeditOrchestrator] PAUSING: All ${chapterNumbersToFix.size} chapters have reached max corrections`);
            
            await storage.updateReeditProject(projectId, {
              status: "awaiting_instructions",
              currentStage: "reviewing",
              pauseReason,
              chapterCorrectionCounts: Object.fromEntries(chapterCorrectionCounts) as any,
            });
            
            this.emitProgress({
              projectId,
              stage: "paused",
              currentChapter: 0,
              totalChapters: validChapters.length,
              message: pauseReason,
            });
            
            return; // Exit and wait for user instructions
          }
          
          for (let i = 0; i < chaptersNeedingFix.length; i++) {
            // Check cancellation before each chapter fix
            if (await this.checkCancellation(projectId)) {
              console.log(`[ReeditOrchestrator] Cancelled during chapter correction ${i + 1}/${chaptersNeedingFix.length}`);
              return;
            }
            
            const chapter = chaptersNeedingFix[i];
            
            // Get issues specific to this chapter
            let chapterIssues = issues.filter(iss => 
              iss.capitulos_afectados?.includes(chapter.chapterNumber)
            );

            // INTELLIGENT VALIDATION: Check if issues were already resolved based on change history
            const chapterHistory = chapterChangeHistory.get(chapter.chapterNumber) || [];
            console.log(`[ReeditOrchestrator] Chapter ${chapter.chapterNumber} - History entries: ${chapterHistory.length}, Issues to validate: ${chapterIssues.length}`);
            if (chapterHistory.length > 0 && chapterIssues.length > 0) {
              const validatedIssues: typeof chapterIssues = [];
              for (const issue of chapterIssues) {
                try {
                  const validation = await issueValidator.validateResolution(
                    { tipo: issue.categoria || "otro", descripcion: issue.descripcion, severidad: issue.severidad },
                    chapterHistory,
                    chapter.chapterNumber
                  );
                  if (validation.isResolved && validation.confidence >= 0.7) {
                    console.log(`[ReeditOrchestrator] Issue already resolved (confidence: ${validation.confidence}): ${issue.descripcion.substring(0, 80)}...`);
                    await this.markIssuesResolved(projectId, [issue]); // Mark as resolved
                  } else {
                    validatedIssues.push(issue);
                  }
                } catch (e) {
                  validatedIssues.push(issue); // On error, keep issue for correction
                }
              }
              if (validatedIssues.length < chapterIssues.length) {
                console.log(`[ReeditOrchestrator] Chapter ${chapter.chapterNumber}: ${chapterIssues.length - validatedIssues.length} issues validated as already resolved`);
              }
              chapterIssues = validatedIssues;
            }

            if (chapterIssues.length === 0 && !chaptersToRewrite.includes(chapter.chapterNumber)) {
              continue;
            }

            this.emitProgress({
              projectId,
              stage: "fixing",
              currentChapter: i + 1,
              totalChapters: chaptersNeedingFix.length,
              message: `Corrigiendo capítulo ${chapter.chapterNumber}: ${chapterIssues.length} issue(s) específicos...`,
            });

            try {
              // Get current correction count for aggressive retry logic
              const currentCorrectionCount = chapterCorrectionCounts.get(chapter.chapterNumber) || 0;
              const isRetry = currentCorrectionCount > 0;
              
              if (isRetry) {
                console.log(`[ReeditOrchestrator] Chapter ${chapter.chapterNumber}: RETRY ATTEMPT ${currentCorrectionCount + 1} - using aggressive instructions`);
              }
              
              // Convert FinalReviewIssues to problem format for NarrativeRewriter
              // On retry attempts, make instructions more aggressive
              const problems = chapterIssues.map((issue, idx) => ({
                id: `issue-${idx}`,
                tipo: issue.categoria || "otro",
                descripcion: issue.descripcion,
                severidad: issue.severidad || "media",
                accionSugerida: makeAggressiveInstructions(
                  issue.instrucciones_correccion || "Corregir según indicación",
                  currentCorrectionCount
                )
              }));

              // Build adjacent context
              const prevChapter = editableChapters.find(c => c.chapterNumber === chapter.chapterNumber - 1);
              const nextChapter = editableChapters.find(c => c.chapterNumber === chapter.chapterNumber + 1);
              const adjacentContext = {
                previousChapter: prevChapter?.editedContent?.substring(0, 2000),
                nextChapter: nextChapter?.editedContent?.substring(0, 2000),
              };

              // Use smartCorrectChapter for automatic surgical/full decision
              const chapterContent = chapter.editedContent || chapter.originalContent;
              const correctionResult = await this.smartCorrectChapter(
                chapterContent,
                chapter.chapterNumber,
                problems,
                worldBibleForReview || {},
                adjacentContext,
                "español",
                userInstructions || undefined
              );
              await this.updateHeartbeat(projectId);

              if (correctionResult.content) {
                const wordCount = correctionResult.content.split(/\s+/).filter((w: string) => w.length > 0).length;
                await storage.updateReeditChapter(chapter.id, {
                  editedContent: correctionResult.content,
                  wordCount,
                });
                
                // Increment correction count for this chapter to prevent infinite loops
                const currentCount = chapterCorrectionCounts.get(chapter.chapterNumber) || 0;
                chapterCorrectionCounts.set(chapter.chapterNumber, currentCount + 1);
                console.log(`[ReeditOrchestrator] Chapter ${chapter.chapterNumber} corrected via ${correctionResult.method} (count: ${currentCount + 1}/${MAX_CORRECTIONS_PER_CHAPTER})`);
                
                // SAVE CHANGE HISTORY for intelligent resolution validation (max 10 entries per chapter)
                const issuesSummary = chapterIssues.map(i => i.descripcion.substring(0, 300)).join("; ");
                const changesSummary = `Corrección ${correctionResult.method === 'surgical' ? 'quirúrgica' : 'completa'}: ${problems.length} problemas`;
                let existingHistory = chapterChangeHistory.get(chapter.chapterNumber) || [];
                existingHistory.push({
                  issue: issuesSummary,
                  fix: changesSummary,
                  timestamp: new Date().toISOString()
                });
                // Keep only last 10 entries to prevent bloat
                if (existingHistory.length > 10) existingHistory = existingHistory.slice(-10);
                chapterChangeHistory.set(chapter.chapterNumber, existingHistory);
                console.log(`[ReeditOrchestrator] SAVED history for chapter ${chapter.chapterNumber}: now has ${existingHistory.length} entries`);
                
                // PERSIST correction counts AND change history to database
                const countsToSaveNonFRO = Object.fromEntries(chapterCorrectionCounts);
                const historyToSaveNonFRO = Object.fromEntries(chapterChangeHistory);
                console.log(`[ReeditOrchestrator] PERSISTING to DB - Counts: ${JSON.stringify(countsToSaveNonFRO)}, History keys: ${Object.keys(historyToSaveNonFRO).join(', ')}`);
                await storage.updateReeditProject(projectId, {
                  chapterCorrectionCounts: countsToSaveNonFRO as any,
                  chapterChangeHistory: historyToSaveNonFRO as any,
                });
                
                // Track corrected issues so FinalReviewer doesn't report them again
                for (const issue of chapterIssues) {
                  correctedIssueDescriptions.push(issue.descripcion);
                }
                
                // Mark these issues as resolved with hash tracking
                await this.markIssuesResolved(projectId, chapterIssues);
              }
            } catch (err) {
              console.error(`[ReeditOrchestrator] Error fixing chapter ${chapter.chapterNumber}:`, err);
            }
          }
        }

        revisionCycle++;
        
        // Save review cycle state for resume support
        await storage.updateReeditProject(projectId, {
          revisionCycle,
          totalReviewCycles: totalCyclesExecuted,
          consecutiveHighScores,
          nonPerfectFinalReviews: nonPerfectCount,
          previousScores: previousScores as any,
        });
      }

      // CRITICAL: If we exited the loop without achieving 2x consecutive 10/10, pause for instructions
      // This prevents projects from being marked "completed" with low scores
      if (consecutiveHighScores < this.requiredConsecutiveHighScores) {
        // Build detailed diagnostic of WHY quality isn't improving
        const issues = finalResult?.problemas_detectados || [];
        const criticalIssues = issues.filter((i: any) => i.severidad === "critico" || i.severidad === "mayor");
        const recurrentCategories = this.analyzeRecurrentIssues(issues);
        
        let diagnosticDetails = "";
        
        // Analyze score progression
        if (previousScores.length >= 3) {
          const recentScores = previousScores.slice(-3);
          const avgRecent = recentScores.reduce((a, b) => a + b, 0) / recentScores.length;
          const isStagnant = recentScores.every(s => Math.abs(s - avgRecent) < 0.5);
          
          if (isStagnant) {
            diagnosticDetails += `\n\n📊 DIAGNÓSTICO: La puntuación está estancada (${recentScores.map(s => s.toFixed(1)).join(" → ")}). Las correcciones automáticas no están resolviendo los problemas fundamentales.`;
          }
        }
        
        // List critical/major issues preventing improvement
        if (criticalIssues.length > 0) {
          diagnosticDetails += `\n\n🚨 PROBLEMAS BLOQUEANTES (${criticalIssues.length}):`;
          criticalIssues.slice(0, 5).forEach((issue: any, idx: number) => {
            const caps = Array.isArray(issue.capitulos_afectados) 
              ? issue.capitulos_afectados.slice(0, 3).join(", ") + (issue.capitulos_afectados.length > 3 ? "..." : "")
              : issue.capitulos_afectados || "varios";
            diagnosticDetails += `\n  ${idx + 1}. [${issue.categoria}] ${issue.descripcion?.slice(0, 100)}... (Cap. ${caps})`;
          });
        }
        
        // Identify recurrent issue categories
        if (recurrentCategories.length > 0) {
          diagnosticDetails += `\n\n🔄 CATEGORÍAS RECURRENTES: ${recurrentCategories.join(", ")}`;
          diagnosticDetails += `\n   Estas categorías aparecen repetidamente, sugiriendo un problema estructural que requiere intervención manual.`;
        }
        
        // Provide actionable suggestions
        diagnosticDetails += `\n\n💡 OPCIONES:`;
        diagnosticDetails += `\n  1. "Forzar completado" - Aceptar el manuscrito con puntuación ${Math.round(bestsellerScore)}/10`;
        diagnosticDetails += `\n  2. Editar manualmente los capítulos problemáticos y reiniciar`;
        diagnosticDetails += `\n  3. Proporcionar instrucciones específicas sobre cómo abordar los problemas listados`;
        
        const pauseReason = `El proceso alcanzó ${revisionCycle} ciclos sin lograr 2 puntuaciones consecutivas de 9+/10. Última puntuación: ${Math.round(bestsellerScore)}/10.${diagnosticDetails}`;
        
        console.log(`[ReeditOrchestrator] PAUSING: Did not achieve required consecutive 9+ scores. Score: ${bestsellerScore}/10`);
        
        await storage.updateReeditProject(projectId, {
          status: "awaiting_instructions",
          pauseReason,
          revisionCycle,
          totalReviewCycles: totalCyclesExecuted,
          consecutiveHighScores,
          nonPerfectFinalReviews: nonPerfectCount,
          previousScores: previousScores as any,
          finalReviewResult: finalResult,
          bestsellerScore: Math.round(bestsellerScore),
        });
        
        this.emitProgress({
          projectId,
          stage: "paused",
          currentChapter: validChapters.length,
          totalChapters: validChapters.length,
          message: pauseReason,
        });
        
        return; // Exit without marking as completed
      }

      for (const chapter of validChapters) {
        await storage.updateReeditChapter(chapter.id, {
          status: "completed",
          processingStage: "completed",
        });
      }

      await storage.createReeditAuditReport({
        projectId,
        auditType: "final_review",
        chapterRange: "all",
        score: Math.round(bestsellerScore),
        findings: finalResult,
        recommendations: finalResult?.justificacion_puntuacion?.recomendaciones_proceso || [],
      });

      const updatedChapters = await storage.getReeditChaptersByProject(projectId);
      const totalWords = updatedChapters.filter(c => c.editedContent).reduce((sum, c) => sum + (c.wordCount || 0), 0);

      // Round score only when persisting to database (DB expects integer)
      const roundedScore = Math.round(bestsellerScore);
      await storage.updateReeditProject(projectId, {
        currentStage: "completed",
        status: "completed",
        bestsellerScore: roundedScore,
        finalReviewResult: finalResult,
        totalWordCount: totalWords,
        totalInputTokens: this.totalInputTokens,
        totalOutputTokens: this.totalOutputTokens,
        totalThinkingTokens: this.totalThinkingTokens,
      });
      
      console.log(`[ReeditOrchestrator] Token usage: ${this.totalInputTokens} input, ${this.totalOutputTokens} output, ${this.totalThinkingTokens} thinking`);

      const finalMessage = consecutiveHighScores >= this.requiredConsecutiveHighScores
        ? `Reedición completa. Puntuación bestseller: ${roundedScore}/10 (confirmado ${this.requiredConsecutiveHighScores}x consecutivas)`
        : `Reedición completa. Puntuación bestseller: ${roundedScore}/10`;

      this.emitProgress({
        projectId,
        stage: "completed",
        currentChapter: validChapters.length,
        totalChapters: validChapters.length,
        message: finalMessage,
      });

    } catch (error) {
      console.error(`[ReeditOrchestrator] Error processing project ${projectId}:`, error);
      await storage.updateReeditProject(projectId, {
        status: "error",
        errorMessage: error instanceof Error ? error.message : "Unknown error",
        totalInputTokens: this.totalInputTokens,
        totalOutputTokens: this.totalOutputTokens,
        totalThinkingTokens: this.totalThinkingTokens,
      });
      throw error;
    }
  }

  async runFinalReviewOnly(projectId: number): Promise<void> {
    console.log(`[ReeditOrchestrator] Running FULL final review only for project ${projectId}`);
    
    const project = await storage.getReeditProject(projectId);
    if (!project) {
      throw new Error(`Project ${projectId} not found`);
    }

    this.totalInputTokens = project.totalInputTokens || 0;
    this.totalOutputTokens = project.totalOutputTokens || 0;
    this.totalThinkingTokens = project.totalThinkingTokens || 0;

    await storage.updateReeditProject(projectId, { 
      status: "processing",
      currentStage: "reviewing",
      errorMessage: null,
    });

    const chapters = await storage.getReeditChaptersByProject(projectId);
    let validChapters = chapters.filter(c => c.editedContent).sort((a, b) => getChapterSortOrder(a.chapterNumber) - getChapterSortOrder(b.chapterNumber));

    // Get World Bible and style guide for full final review
    const worldBibleForReview = await storage.getReeditWorldBibleByProject(projectId);
    const guiaEstilo = (project as any).styleGuide || "";

    let revisionCycle = 0;
    // Preserve existing consecutive high scores when resuming
    let consecutiveHighScores = project.consecutiveHighScores || 0;
    console.log(`[ReeditOrchestrator] Starting with ${consecutiveHighScores} consecutive high score(s) from previous session`);
    const previousScores: number[] = [];
    let finalResult: FinalReviewerResult | null = null;
    let bestsellerScore = 0;
    const correctedIssueDescriptions: string[] = [];
    
    // TOTAL cycle limit to prevent infinite loops (uses dedicated field that never resets)
    const MAX_TOTAL_CYCLES = 30;
    let totalCyclesExecuted = project.totalReviewCycles || 0;
    
    // Check for user instructions and add them to context
    const userInstructions = project.pendingUserInstructions || "";
    if (userInstructions) {
      console.log(`[ReeditOrchestrator] User instructions found: "${userInstructions.substring(0, 100)}..."`);
      correctedIssueDescriptions.push(`INSTRUCCIONES DEL USUARIO: ${userInstructions}`);
      // NOTE: Instructions are cleared AFTER corrections are applied successfully (see below)
    }
    
    // If we have an existing finalReviewResult with issues, apply those corrections FIRST before running review
    // Skip corrections if we already have consecutive high scores (meaning previous review was 10/10)
    const existingFinalReview = project.finalReviewResult as any;
    const hasIssuesToFix = existingFinalReview?.issues?.length > 0 || existingFinalReview?.capitulos_para_reescribir?.length > 0;
    const skipCorrectionsForConsecutive = consecutiveHighScores >= 1 && !hasIssuesToFix;
    
    if (skipCorrectionsForConsecutive) {
      console.log(`[ReeditOrchestrator] Previous review was 10/10 with no issues. Proceeding directly to confirmation review.`);
    } else if (hasIssuesToFix) {
      // NOTE: Pre-corrections are now handled INSIDE the main loop below with proper limits
      // This section only logs and clears user instructions if any
      console.log(`[ReeditOrchestrator] Issues to fix detected. Will apply corrections in main loop with proper limits.`);
      
      // Clear user instructions upfront since they'll be passed to the main loop
      if (userInstructions) {
        await storage.updateReeditProject(projectId, { 
          pendingUserInstructions: null,
          pauseReason: null,
        });
        console.log(`[ReeditOrchestrator] User instructions cleared (will be applied in main correction loop)`);
      }
    }

    // Track resolved hashes locally to avoid stale data from project object
    let localResolvedHashesFRO: string[] = (project.resolvedIssueHashes as string[]) || [];
    
    // Track chapters corrected - PERSISTED across restarts to prevent infinite loops
    const MAX_CORRECTIONS_PER_CHAPTER_FRO = 4; // Max times a chapter can be corrected before pausing
    const loadedCountsFRO = (project?.chapterCorrectionCounts as Record<string, number>) || {};
    const chapterCorrectionCountsFRO: Map<number, number> = new Map(
      Object.entries(loadedCountsFRO).map(([k, v]) => [parseInt(k), v])
    );
    
    // Load change history for intelligent resolution validation
    type ChangeEntryFRO = { issue: string; fix: string; timestamp: string };
    const loadedHistoryFRO = (project?.chapterChangeHistory as Record<string, ChangeEntryFRO[]>) || {};
    const chapterChangeHistoryFRO: Map<number, ChangeEntryFRO[]> = new Map(
      Object.entries(loadedHistoryFRO).map(([k, v]) => [parseInt(k), v])
    );
    console.log(`[ReeditOrchestrator] FRO LOADED change history: ${chapterChangeHistoryFRO.size} chapters with history. Keys: [${Array.from(chapterChangeHistoryFRO.keys()).join(', ')}]`);
    const issueValidatorFRO = new IssueResolutionValidatorAgent();
    
    while (revisionCycle < this.maxFinalReviewCycles) {
      // Check for cancellation at start of each cycle
      if (await this.checkCancellation(projectId)) {
        console.log(`[ReeditOrchestrator] Cancelled during final review cycle ${revisionCycle}`);
        return;
      }
      
      // CRITICAL: Reload resolved hashes from DB to include newly resolved issues
      const refreshedProjectFRO = await storage.getReeditProject(projectId);
      localResolvedHashesFRO = (refreshedProjectFRO?.resolvedIssueHashes as string[]) || [];
      
      // Check total cycle limit to prevent infinite loops
      totalCyclesExecuted++;
      if (totalCyclesExecuted > MAX_TOTAL_CYCLES) {
        const pauseReason = `Se alcanzó el límite de ${MAX_TOTAL_CYCLES} ciclos totales. Última puntuación: ${Math.round(bestsellerScore)}/10. Por favor, usa "Forzar completado" o proporciona instrucciones.`;
        console.log(`[ReeditOrchestrator] PAUSING: Total cycle limit reached (${totalCyclesExecuted})`);
        
        await storage.updateReeditProject(projectId, {
          status: "awaiting_instructions",
          pauseReason,
          totalReviewCycles: totalCyclesExecuted,
          consecutiveHighScores,
          finalReviewResult: finalResult,
          bestsellerScore: Math.round(bestsellerScore),
        });
        
        this.emitProgress({
          projectId,
          stage: "paused",
          currentChapter: validChapters.length,
          totalChapters: validChapters.length,
          message: pauseReason,
        });
        return;
      }
      
      const consecutiveInfo = consecutiveHighScores > 0 
        ? ` [${consecutiveHighScores}/${this.requiredConsecutiveHighScores} puntuaciones 10/10 consecutivas]`
        : "";

      this.emitProgress({
        projectId,
        stage: "reviewing",
        currentChapter: validChapters.length,
        totalChapters: validChapters.length,
        message: `Re-ejecutando revisión final COMPLETA... (Ciclo ${revisionCycle + 1}/${this.maxFinalReviewCycles})${consecutiveInfo}`,
      });

      // Build chapters array with full content for FinalReviewer
      const chaptersForReview = validChapters.map(c => ({
        numero: c.chapterNumber,
        titulo: c.title || `Capítulo ${c.chapterNumber}`,
        contenido: c.editedContent || c.originalContent,
      }));

      // Call the FULL final reviewer with complete manuscript content
      // Pass user instructions so they are considered during issue detection
      const fullReviewResult = await this.fullFinalReviewerAgent.execute({
        projectTitle: project.title,
        chapters: chaptersForReview,
        worldBible: worldBibleForReview || {},
        guiaEstilo: guiaEstilo,
        pasadaNumero: revisionCycle + 1,
        issuesPreviosCorregidos: correctedIssueDescriptions,
        userInstructions: userInstructions || undefined,
      });
      this.trackTokens(fullReviewResult);
      await this.updateHeartbeat(projectId);

      finalResult = fullReviewResult.result || null;
      // Use raw score for threshold checks - only round when persisting to DB
      const rawScore = finalResult?.puntuacion_global || 7;
      bestsellerScore = rawScore; // Keep as float for accurate threshold comparison
      previousScores.push(rawScore);

      const veredicto = finalResult?.veredicto || "REQUIERE_REVISION";
      const rawIssuesFROApproval = finalResult?.issues || [];
      const chapsToRewrite = finalResult?.capitulos_para_reescribir?.length || 0;
      
      // Filter out resolved issues BEFORE checking for critical issues
      // Use localResolvedHashesFRO which is refreshed each cycle instead of stale project data
      const { newIssues: filteredIssuesFROApproval } = this.filterNewIssues(rawIssuesFROApproval, localResolvedHashesFRO);
      
      // Check for critical issues from FILTERED list only
      const criticalIssuesFRO = filteredIssuesFROApproval.filter((issue: any) => 
        issue.severidad === "critica" || issue.severidad === "crítica"
      );
      const hasCriticalIssuesFRO = criticalIssuesFRO.length > 0;
      const issuesCount = filteredIssuesFROApproval.length;

      console.log(`[ReeditOrchestrator] Final review cycle ${revisionCycle + 1}: score ${rawScore}/10, veredicto: ${veredicto}, issues: ${issuesCount} (${criticalIssuesFRO.length} críticos, ${rawIssuesFROApproval.length - issuesCount} ya resueltos), chapters to rewrite: ${chapsToRewrite}`);

      // Aprobar si: puntuación >= 9 Y no hay NINGÚN issue nuevo (crítico o no)
      // Si hay issues pendientes (incluso menores), deben corregirse antes de aprobar
      const hasAnyNewIssuesFRO = issuesCount > 0 || chapsToRewrite > 0;
      
      if (rawScore >= this.minAcceptableScore && !hasAnyNewIssuesFRO) {
        consecutiveHighScores++;
        console.log(`[ReeditOrchestrator] FRO: Score ${rawScore}/10 with NO new issues. Consecutive high scores: ${consecutiveHighScores}`);
      } else if (rawScore >= this.minAcceptableScore && hasAnyNewIssuesFRO) {
        // Puntuación alta pero con issues pendientes - no aprobar, corregir primero
        console.log(`[ReeditOrchestrator] FRO: Score ${rawScore}/10 is good but ${issuesCount} issue(s) remain (${criticalIssuesFRO.length} críticos). Correcting...`);
        // Don't increment consecutiveHighScores - must correct issues first
      } else {
        consecutiveHighScores = 0;
      }

      if (consecutiveHighScores >= this.requiredConsecutiveHighScores) {
        const recentScores = previousScores.slice(-this.requiredConsecutiveHighScores).join(", ");
        console.log(`[ReeditOrchestrator] APROBADO: Puntuaciones consecutivas ${recentScores}/10`);
        
        this.emitProgress({
          projectId,
          stage: "reviewing",
          currentChapter: validChapters.length,
          totalChapters: validChapters.length,
          message: `Manuscrito APROBADO. Puntuaciones consecutivas: ${recentScores}/10. Calidad bestseller confirmada.`,
        });
        break;
      }

      // Only skip corrections if score is high AND no issues remain at all
      // If there are ANY issues (critical or not), we must fall through to the correction phase
      if (bestsellerScore >= this.minAcceptableScore && consecutiveHighScores < this.requiredConsecutiveHighScores && !hasAnyNewIssuesFRO) {
        this.emitProgress({
          projectId,
          stage: "reviewing",
          currentChapter: validChapters.length,
          totalChapters: validChapters.length,
          message: `Puntuación ${bestsellerScore}/10. Necesita ${this.requiredConsecutiveHighScores - consecutiveHighScores} evaluación(es) más con 10/10 para confirmar.`,
        });
        revisionCycle++;
        continue;
      }

      // Si llegamos al límite de ciclos sin el doble 10/10, dejamos que MAX_TOTAL_CYCLES controle
      if (revisionCycle === this.maxFinalReviewCycles - 1) {
        const avgScore = previousScores.length > 0
          ? (previousScores.reduce((a, b) => a + b, 0) / previousScores.length).toFixed(1)
          : bestsellerScore;
        
        console.log(`[ReeditOrchestrator] Límite de ciclos locales alcanzado. Puntuación: ${bestsellerScore}/10 (promedio: ${avgScore}). Total: ${totalCyclesExecuted}`);
        // NO reseteamos revisionCycle - dejamos que MAX_TOTAL_CYCLES controle
      }

      this.emitProgress({
        projectId,
        stage: "reviewing",
        currentChapter: validChapters.length,
        totalChapters: validChapters.length,
        message: `Puntuación ${bestsellerScore}/10 insuficiente. Corrigiendo ${chapsToRewrite} capítulo(s) con ${issuesCount} issue(s)...`,
      });

      // Apply corrections based on FULL final reviewer feedback
      const rawIssuesFRO = finalResult?.issues || [];
      const chaptersToRewrite = finalResult?.capitulos_para_reescribir || [];
      
      // Filter out issues that have already been resolved in previous cycles
      // Use localResolvedHashesFRO which is refreshed each cycle instead of stale project data
      const { newIssues: issues, filteredCount: filteredCountFRO } = this.filterNewIssues(rawIssuesFRO, localResolvedHashesFRO);
      
      if (filteredCountFRO > 0) {
        console.log(`[ReeditOrchestrator] FRO: ${filteredCountFRO} issues ya resueltos fueron filtrados, quedan ${issues.length} nuevos`);
      }
      
      // === USER ISSUE APPROVAL FLOW ===
      // If there are new issues, create records and pause for user approval
      if (issues.length > 0) {
        // Check if we have user-approved issues to process
        const approvedIssues = await storage.getApprovedPendingIssues(projectId);
        
        if (approvedIssues.length === 0) {
          // No approved issues yet - create records and pause for user review
          await this.createIssueRecords(projectId, issues, revisionCycle);
          
          const criticalCount = issues.filter((i: any) => i.severidad === "critica" || i.severidad === "crítica").length;
          const pauseReason = `Se detectaron ${issues.length} problema(s) (${criticalCount} crítico(s)). Por favor revisa la lista de problemas y aprueba o rechaza cada uno antes de continuar con las correcciones automáticas.`;
          
          console.log(`[ReeditOrchestrator] FRO PAUSING: ${issues.length} issues detected, awaiting user approval`);
          
          await storage.updateReeditProject(projectId, {
            status: "awaiting_issue_approval",
            currentStage: "reviewing",
            pauseReason,
            chapterCorrectionCounts: Object.fromEntries(chapterCorrectionCountsFRO) as any,
          });
          
          this.emitProgress({
            projectId,
            stage: "awaiting_approval",
            currentChapter: 0,
            totalChapters: validChapters.length,
            message: pauseReason,
          });
          
          return; // Exit and wait for user to approve/reject issues
        }
        
        // User has approved some issues - only process those
        console.log(`[ReeditOrchestrator] FRO: User approved ${approvedIssues.length} issues for correction`);
        
        // LINEAR FLOW: After applying user-approved corrections, mark as completed and exit
        // This prevents infinite loops - user explicitly approved what to fix
        
        // Apply corrections for approved issues only, tracking all state properly
        const correctionResults = await this.applyUserApprovedCorrections(
          projectId, 
          approvedIssues, 
          validChapters, 
          worldBibleForReview, 
          guiaEstilo, 
          userInstructions,
          localResolvedHashesFRO,
          chapterCorrectionCountsFRO
        );
        
        // Mark all approved issues as resolved in the database
        for (const issue of approvedIssues) {
          await storage.resolveReeditIssue(issue.id);
        }
        
        // Refresh chapters to get updated word counts
        const updatedChapters = await storage.getReeditChaptersByProject(projectId);
        const totalWords = updatedChapters.reduce((sum, c) => sum + (c.wordCount || 0), 0);
        
        // Mark project as completed after applying user-approved corrections
        // Note: We explicitly don't re-run final review - user has accepted the corrections
        // Get the latest persisted state from applyUserApprovedCorrections
        const finalProject = await storage.getReeditProject(projectId);
        
        await storage.updateReeditProject(projectId, {
          currentStage: "completed",
          status: "completed",
          finalReviewResult: {
            ...finalResult,
            nota_usuario: `Usuario aprobó ${approvedIssues.length} correcciones. Manuscrito finalizado sin re-evaluación.`,
            completed_without_rereview: true,
            user_approved_count: approvedIssues.length,
          },
          bestsellerScore: Math.round(bestsellerScore),
          errorMessage: null,
          pauseReason: null,
          // Preserve state from applyUserApprovedCorrections
          resolvedIssueHashes: finalProject?.resolvedIssueHashes || localResolvedHashesFRO as any,
          chapterCorrectionCounts: finalProject?.chapterCorrectionCounts || Object.fromEntries(chapterCorrectionCountsFRO) as any,
          chapterChangeHistory: finalProject?.chapterChangeHistory,
        });
        
        this.emitProgress({
          projectId,
          stage: "completed",
          currentChapter: validChapters.length,
          totalChapters: validChapters.length,
          message: `Correcciones aplicadas exitosamente. ${approvedIssues.length} problemas corregidos. Manuscrito finalizado.`,
        });
        
        console.log(`[ReeditOrchestrator] LINEAR FLOW: Completed after applying ${approvedIssues.length} user-approved corrections`);
        await this.saveTokenUsage(projectId);
        return; // EXIT - Linear flow complete
      }
      
      if (issues.length > 0 || chaptersToRewrite.length > 0) {
        // Get unique chapter numbers that need fixes
        const chapterNumbersToFix = new Set<number>(chaptersToRewrite);
        for (const issue of issues) {
          if (issue.capitulos_afectados) {
            for (const chNum of issue.capitulos_afectados) {
              chapterNumbersToFix.add(chNum);
            }
          }
        }

        // Only fix chapters specifically mentioned, limit to 5 per cycle
        // ALSO filter out chapters that have been corrected too many times to prevent infinite loops
        const chaptersNeedingFix = validChapters
          .filter(c => chapterNumbersToFix.has(c.chapterNumber))
          .filter(c => {
            const correctionCount = chapterCorrectionCountsFRO.get(c.chapterNumber) || 0;
            if (correctionCount >= MAX_CORRECTIONS_PER_CHAPTER_FRO) {
              console.log(`[ReeditOrchestrator] FRO: Skipping chapter ${c.chapterNumber}: already corrected ${correctionCount} times (max: ${MAX_CORRECTIONS_PER_CHAPTER_FRO})`);
              return false;
            }
            return true;
          })
          .slice(0, 10); // Corrige hasta 10 capítulos por ciclo
        
        if (chaptersNeedingFix.length === 0 && chapterNumbersToFix.size > 0) {
          // PAUSE for user intervention instead of auto-resolving
          const skippedChaptersFRO = Array.from(chapterNumbersToFix).join(", ");
          const pauseReasonFRO = `Los capítulos ${skippedChaptersFRO} han sido corregidos ${MAX_CORRECTIONS_PER_CHAPTER_FRO} veces sin resolver los problemas detectados. Por favor, revisa manualmente estos capítulos o proporciona instrucciones específicas para continuar.`;
          console.log(`[ReeditOrchestrator] FRO PAUSING: All ${chapterNumbersToFix.size} chapters have reached max corrections`);
          
          await storage.updateReeditProject(projectId, {
            status: "awaiting_instructions",
            currentStage: "reviewing",
            pauseReason: pauseReasonFRO,
            chapterCorrectionCounts: Object.fromEntries(chapterCorrectionCountsFRO) as any,
          });
          
          this.emitProgress({
            projectId,
            stage: "paused",
            currentChapter: 0,
            totalChapters: validChapters.length,
            message: pauseReasonFRO,
          });
          
          return; // Exit and wait for user instructions
        }
        
        for (let i = 0; i < chaptersNeedingFix.length; i++) {
          // Check cancellation before each chapter fix
          if (await this.checkCancellation(projectId)) {
            console.log(`[ReeditOrchestrator] Cancelled during chapter correction (FRO) ${i + 1}/${chaptersNeedingFix.length}`);
            return;
          }
          
          const chapter = chaptersNeedingFix[i];
          
          // Get issues specific to this chapter
          let chapterIssuesFRO = issues.filter(iss => 
            iss.capitulos_afectados?.includes(chapter.chapterNumber)
          );

          // INTELLIGENT VALIDATION: Check if issues were already resolved based on change history
          const chapterHistoryFRO = chapterChangeHistoryFRO.get(chapter.chapterNumber) || [];
          console.log(`[ReeditOrchestrator] FRO Chapter ${chapter.chapterNumber} - History entries: ${chapterHistoryFRO.length}, Issues to validate: ${chapterIssuesFRO.length}`);
          if (chapterHistoryFRO.length > 0 && chapterIssuesFRO.length > 0) {
            const validatedIssuesFRO: typeof chapterIssuesFRO = [];
            for (const issue of chapterIssuesFRO) {
              try {
                const validation = await issueValidatorFRO.validateResolution(
                  { tipo: issue.categoria || "otro", descripcion: issue.descripcion, severidad: issue.severidad },
                  chapterHistoryFRO,
                  chapter.chapterNumber
                );
                if (validation.isResolved && validation.confidence >= 0.7) {
                  console.log(`[ReeditOrchestrator] FRO: Issue already resolved (confidence: ${validation.confidence}): ${issue.descripcion.substring(0, 80)}...`);
                  await this.markIssuesResolved(projectId, [issue]);
                } else {
                  validatedIssuesFRO.push(issue);
                }
              } catch (e) {
                validatedIssuesFRO.push(issue);
              }
            }
            if (validatedIssuesFRO.length < chapterIssuesFRO.length) {
              console.log(`[ReeditOrchestrator] FRO: Chapter ${chapter.chapterNumber}: ${chapterIssuesFRO.length - validatedIssuesFRO.length} issues validated as already resolved`);
            }
            chapterIssuesFRO = validatedIssuesFRO;
          }

          if (chapterIssuesFRO.length === 0 && !chaptersToRewrite.includes(chapter.chapterNumber)) {
            continue;
          }

          this.emitProgress({
            projectId,
            stage: "fixing",
            currentChapter: i + 1,
            totalChapters: chaptersNeedingFix.length,
            message: `Corrigiendo capítulo ${chapter.chapterNumber}: ${chapterIssuesFRO.length} issue(s) específicos...`,
          });

          try {
            // Get current correction count for aggressive retry logic
            const currentCorrectionCountFRO = chapterCorrectionCountsFRO.get(chapter.chapterNumber) || 0;
            const isRetryFRO = currentCorrectionCountFRO > 0;
            
            if (isRetryFRO) {
              console.log(`[ReeditOrchestrator] FRO Chapter ${chapter.chapterNumber}: RETRY ATTEMPT ${currentCorrectionCountFRO + 1} - using aggressive instructions`);
            }
            
            // Convert FinalReviewIssues to problem format for NarrativeRewriter
            // On retry attempts, make instructions more aggressive
            const problems = chapterIssuesFRO.map((issue, idx) => ({
              id: `issue-${idx}`,
              tipo: issue.categoria || "otro",
              descripcion: issue.descripcion,
              severidad: issue.severidad || "media",
              accionSugerida: makeAggressiveInstructions(
                issue.instrucciones_correccion || "Corregir según indicación",
                currentCorrectionCountFRO
              )
            }));

            // Build adjacent context
            const prevChapter = validChapters.find(c => c.chapterNumber === chapter.chapterNumber - 1);
            const nextChapter = validChapters.find(c => c.chapterNumber === chapter.chapterNumber + 1);
            const adjacentContext = {
              previousChapter: prevChapter?.editedContent?.substring(0, 2000),
              nextChapter: nextChapter?.editedContent?.substring(0, 2000),
            };

            // Use smartCorrectChapter for automatic surgical/full decision
            const chapterContent = chapter.editedContent || chapter.originalContent;
            const correctionResult = await this.smartCorrectChapter(
              chapterContent,
              chapter.chapterNumber,
              problems,
              worldBibleForReview || {},
              adjacentContext,
              "español",
              userInstructions || undefined
            );
            await this.updateHeartbeat(projectId);

            console.log(`[ReeditOrchestrator] FRO correction result for chapter ${chapter.chapterNumber}: method=${correctionResult.method}, has content=${!!correctionResult.content}`);
            if (correctionResult.content) {
              const wordCount = correctionResult.content.split(/\s+/).filter((w: string) => w.length > 0).length;
              await storage.updateReeditChapter(chapter.id, {
                editedContent: correctionResult.content,
                wordCount,
              });
              
              // Increment correction count for this chapter to prevent infinite loops
              const currentCountFRO = chapterCorrectionCountsFRO.get(chapter.chapterNumber) || 0;
              chapterCorrectionCountsFRO.set(chapter.chapterNumber, currentCountFRO + 1);
              console.log(`[ReeditOrchestrator] FRO: Chapter ${chapter.chapterNumber} corrected via ${correctionResult.method} (count: ${currentCountFRO + 1}/${MAX_CORRECTIONS_PER_CHAPTER_FRO})`);
              
              // SAVE CHANGE HISTORY for intelligent resolution validation (max 10 entries per chapter)
              const issuesSummaryFRO = chapterIssuesFRO.map(i => i.descripcion.substring(0, 300)).join("; ");
              const changesSummaryFRO = `Corrección ${correctionResult.method === 'surgical' ? 'quirúrgica' : 'completa'}: ${problems.length} problemas`;
              let existingHistoryFRO = chapterChangeHistoryFRO.get(chapter.chapterNumber) || [];
              existingHistoryFRO.push({
                issue: issuesSummaryFRO,
                fix: changesSummaryFRO,
                timestamp: new Date().toISOString()
              });
              // Keep only last 10 entries to prevent bloat
              if (existingHistoryFRO.length > 10) existingHistoryFRO = existingHistoryFRO.slice(-10);
              chapterChangeHistoryFRO.set(chapter.chapterNumber, existingHistoryFRO);
              console.log(`[ReeditOrchestrator] FRO SAVED history for chapter ${chapter.chapterNumber}: now has ${existingHistoryFRO.length} entries`);
              
              // PERSIST correction counts AND change history to database
              const countsToSave = Object.fromEntries(chapterCorrectionCountsFRO);
              const historyToSave = Object.fromEntries(chapterChangeHistoryFRO);
              console.log(`[ReeditOrchestrator] FRO PERSISTING to DB - Counts: ${JSON.stringify(countsToSave)}, History keys: ${Object.keys(historyToSave).join(', ')}`);
              await storage.updateReeditProject(projectId, {
                chapterCorrectionCounts: countsToSave as any,
                chapterChangeHistory: historyToSave as any,
              });
              
              // Mark these issues as resolved with hash tracking
              await this.markIssuesResolved(projectId, chapterIssuesFRO);
              
              // Track corrected issues so FinalReviewer doesn't report them again
              for (const issue of chapterIssuesFRO) {
                correctedIssueDescriptions.push(issue.descripcion);
              }
            } else {
              console.log(`[ReeditOrchestrator] FRO: Chapter ${chapter.chapterNumber} rewrite SKIPPED - no capituloReescrito in result`);
            }
          } catch (err) {
            console.error(`[ReeditOrchestrator] Error fixing chapter ${chapter.chapterNumber}:`, err);
          }
        }

        // Refresh validChapters for next review
        const refreshedChapters = await storage.getReeditChaptersByProject(projectId);
        validChapters = refreshedChapters.filter(ch => ch.editedContent).sort((a, b) => getChapterSortOrder(a.chapterNumber) - getChapterSortOrder(b.chapterNumber));
      }

      revisionCycle++;
    }

    // CRITICAL: If we exited the loop without achieving 2x consecutive 10/10, pause for instructions
    if (consecutiveHighScores < this.requiredConsecutiveHighScores) {
      // Build detailed diagnostic of WHY quality isn't improving
      const issues = finalResult?.problemas_detectados || [];
      const criticalIssues = issues.filter((i: any) => i.severidad === "critico" || i.severidad === "mayor");
      const recurrentCategories = this.analyzeRecurrentIssues(issues);
      
      let diagnosticDetails = "";
      
      // Analyze score progression
      if (previousScores.length >= 3) {
        const recentScores = previousScores.slice(-3);
        const avgRecent = recentScores.reduce((a, b) => a + b, 0) / recentScores.length;
        const isStagnant = recentScores.every(s => Math.abs(s - avgRecent) < 0.5);
        
        if (isStagnant) {
          diagnosticDetails += `\n\n📊 DIAGNÓSTICO: La puntuación está estancada (${recentScores.map(s => s.toFixed(1)).join(" → ")}). Las correcciones automáticas no están resolviendo los problemas fundamentales.`;
        }
      }
      
      // List critical/major issues preventing improvement
      if (criticalIssues.length > 0) {
        diagnosticDetails += `\n\n🚨 PROBLEMAS BLOQUEANTES (${criticalIssues.length}):`;
        criticalIssues.slice(0, 5).forEach((issue: any, idx: number) => {
          const caps = Array.isArray(issue.capitulos_afectados) 
            ? issue.capitulos_afectados.slice(0, 3).join(", ") + (issue.capitulos_afectados.length > 3 ? "..." : "")
            : issue.capitulos_afectados || "varios";
          diagnosticDetails += `\n  ${idx + 1}. [${issue.categoria}] ${issue.descripcion?.slice(0, 100)}... (Cap. ${caps})`;
        });
      }
      
      // Identify recurrent issue categories
      if (recurrentCategories.length > 0) {
        diagnosticDetails += `\n\n🔄 CATEGORÍAS RECURRENTES: ${recurrentCategories.join(", ")}`;
        diagnosticDetails += `\n   Estas categorías aparecen repetidamente, sugiriendo un problema estructural que requiere intervención manual.`;
      }
      
      // Provide actionable suggestions
      diagnosticDetails += `\n\n💡 OPCIONES:`;
      diagnosticDetails += `\n  1. "Forzar completado" - Aceptar el manuscrito con puntuación ${Math.round(bestsellerScore)}/10`;
      diagnosticDetails += `\n  2. Editar manualmente los capítulos problemáticos y reiniciar`;
      diagnosticDetails += `\n  3. Proporcionar instrucciones específicas sobre cómo abordar los problemas listados`;
      
      const pauseReason = `El proceso alcanzó ${revisionCycle} ciclos sin lograr 2 puntuaciones consecutivas de 9+/10. Última puntuación: ${Math.round(bestsellerScore)}/10.${diagnosticDetails}`;
      
      console.log(`[ReeditOrchestrator] PAUSING (runFinalReviewOnly): Did not achieve required consecutive 9+ scores. Score: ${bestsellerScore}/10`);
      
      await storage.updateReeditProject(projectId, {
        status: "awaiting_instructions",
        pauseReason,
        revisionCycle,
        totalReviewCycles: totalCyclesExecuted,
        consecutiveHighScores,
        previousScores: previousScores as any,
        finalReviewResult: finalResult,
        bestsellerScore: Math.round(bestsellerScore),
      });
      
      this.emitProgress({
        projectId,
        stage: "paused",
        currentChapter: validChapters.length,
        totalChapters: validChapters.length,
        message: pauseReason,
      });
      
      return; // Exit without marking as completed
    }

    await storage.createReeditAuditReport({
      projectId,
      auditType: "final_review",
      chapterRange: "all",
      score: Math.round(bestsellerScore),
      findings: finalResult,
      recommendations: finalResult?.justificacion_puntuacion?.recomendaciones_proceso || [],
    });

    const totalWords = validChapters.reduce((sum, c) => sum + (c.wordCount || 0), 0);

    await storage.updateReeditProject(projectId, {
      currentStage: "completed",
      status: "completed",
      bestsellerScore: Math.round(bestsellerScore),
      finalReviewResult: finalResult,
      totalWordCount: totalWords,
      totalInputTokens: this.totalInputTokens,
      totalOutputTokens: this.totalOutputTokens,
      totalThinkingTokens: this.totalThinkingTokens,
    });

    const finalMessage = `Revisión final completa. Puntuación bestseller: ${Math.round(bestsellerScore)}/10 (confirmado ${this.requiredConsecutiveHighScores}x consecutivas)`;

    this.emitProgress({
      projectId,
      stage: "completed",
      currentChapter: validChapters.length,
      totalChapters: validChapters.length,
      message: finalMessage,
    });

    console.log(`[ReeditOrchestrator] Full final review completed for project ${projectId}: ${bestsellerScore}/10`);
  }

  async applyReviewerCorrections(projectId: number): Promise<void> {
    const project = await storage.getReeditProject(projectId);
    if (!project) {
      throw new Error(`Project ${projectId} not found`);
    }

    const finalReviewResult = project.finalReviewResult as any;
    if (!finalReviewResult) {
      throw new Error(`No final review result found for project ${projectId}`);
    }

    const weaknesses = finalReviewResult.weaknesses || finalReviewResult.debilidades_principales || [];
    const recommendations = finalReviewResult.recommendations || finalReviewResult.recomendaciones_proceso || [];

    if (weaknesses.length === 0 && recommendations.length === 0) {
      console.log(`[ReeditOrchestrator] No weaknesses or recommendations to apply for project ${projectId}`);
      return;
    }

    console.log(`[ReeditOrchestrator] Applying corrections for project ${projectId}:`);
    console.log(`  - Weaknesses: ${weaknesses.length}`);
    console.log(`  - Recommendations: ${recommendations.length}`);

    // Convert to problem format
    const problems = [
      ...weaknesses.map((w: string, i: number) => ({
        id: `weakness-${i}`,
        tipo: "debilidad_detectada",
        descripcion: typeof w === 'string' ? w : JSON.stringify(w),
        severidad: "media",
        accionSugerida: "Corregir según indicación del revisor"
      })),
      ...recommendations.map((r: string, i: number) => ({
        id: `recommendation-${i}`,
        tipo: "recomendacion",
        descripcion: typeof r === 'string' ? r : JSON.stringify(r),
        severidad: "menor",
        accionSugerida: "Implementar recomendación"
      }))
    ];

    // Get worldBible
    const worldBible = await storage.getReeditWorldBibleByProject(projectId);
    
    // Get user instructions (architectInstructions or pendingUserInstructions)
    const userInstructions = project.pendingUserInstructions || project.architectInstructions || "";

    // Get all chapters
    const allChapters = await storage.getReeditChaptersByProject(projectId);
    const editableChapters = allChapters.filter(c => c.editedContent);

    // Extract chapter numbers mentioned in feedback
    const mentionedChapters = new Set<number>();
    const feedbackText = [...weaknesses, ...recommendations].join(' ');
    const chapterMatches = feedbackText.match(/cap[íi]tulo\s*(\d+)/gi) || [];
    chapterMatches.forEach(match => {
      const num = parseInt(match.replace(/\D/g, ''));
      if (!isNaN(num)) mentionedChapters.add(num);
    });

    // If specific chapters mentioned, prioritize those; otherwise fix first 5
    let chaptersToFix: ReeditChapter[];
    if (mentionedChapters.size > 0) {
      chaptersToFix = editableChapters.filter(c => mentionedChapters.has(c.chapterNumber));
      console.log(`[ReeditOrchestrator] Fixing ${chaptersToFix.length} specifically mentioned chapters: ${Array.from(mentionedChapters).join(', ')}`);
    } else {
      chaptersToFix = editableChapters.slice(0, Math.min(10, editableChapters.length));
      console.log(`[ReeditOrchestrator] No specific chapters mentioned, fixing first ${chaptersToFix.length} chapters`);
    }

    this.emitProgress({
      projectId,
      stage: "fixing",
      currentChapter: 0,
      totalChapters: chaptersToFix.length,
      message: `Aplicando correcciones del revisor a ${chaptersToFix.length} capítulos...`,
    });

    for (let i = 0; i < chaptersToFix.length; i++) {
      const chapter = chaptersToFix[i];

      this.emitProgress({
        projectId,
        stage: "fixing",
        currentChapter: i + 1,
        totalChapters: chaptersToFix.length,
        message: `Corrigiendo capítulo ${chapter.chapterNumber} (${i + 1}/${chaptersToFix.length})...`,
      });

      try {
        // Build adjacent context
        const prevChapter = editableChapters.find(c => c.chapterNumber === chapter.chapterNumber - 1);
        const nextChapter = editableChapters.find(c => c.chapterNumber === chapter.chapterNumber + 1);
        const adjacentContext = {
          previousChapter: prevChapter?.editedContent?.substring(0, 2000),
          nextChapter: nextChapter?.editedContent?.substring(0, 2000),
        };

        // Use smartCorrectChapter for automatic surgical/full decision
        const chapterContent = chapter.editedContent || chapter.originalContent;
        const correctionResult = await this.smartCorrectChapter(
          chapterContent,
          chapter.chapterNumber,
          problems,
          worldBible || {},
          adjacentContext,
          "español",
          userInstructions || undefined
        );

        if (correctionResult.content) {
          const wordCount = correctionResult.content.split(/\s+/).filter((w: string) => w.length > 0).length;
          await storage.updateReeditChapter(chapter.id, {
            editedContent: correctionResult.content,
            wordCount,
          });
          console.log(`[ReeditOrchestrator] Fixed chapter ${chapter.chapterNumber} via ${correctionResult.method}: ${wordCount} words`);
        }
      } catch (err) {
        console.error(`[ReeditOrchestrator] Error fixing chapter ${chapter.chapterNumber}:`, err);
      }
    }

    // Update project tokens
    await storage.updateReeditProject(projectId, {
      totalInputTokens: (project.totalInputTokens || 0) + this.totalInputTokens,
      totalOutputTokens: (project.totalOutputTokens || 0) + this.totalOutputTokens,
      totalThinkingTokens: (project.totalThinkingTokens || 0) + this.totalThinkingTokens,
    });

    this.emitProgress({
      projectId,
      stage: "fixing",
      currentChapter: chaptersToFix.length,
      totalChapters: chaptersToFix.length,
      message: `Correcciones aplicadas a ${chaptersToFix.length} capítulos. Listo para re-evaluación.`,
    });

    console.log(`[ReeditOrchestrator] Applied corrections to ${chaptersToFix.length} chapters for project ${projectId}`);
  }
}

export const reeditOrchestrator = new ReeditOrchestrator();
