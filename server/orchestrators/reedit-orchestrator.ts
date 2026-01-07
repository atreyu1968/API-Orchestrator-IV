import { storage } from "../storage";
import { BaseAgent } from "../agents/base-agent";
import type { ReeditProject, ReeditChapter } from "@shared/schema";

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
      model: "gemini-2.5-flash",
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

LANGUAGE-SPECIFIC FLUENCY RULES:
- ITALIAN: NEVER use "Egli/Ella/Esso/Essa" - use proper names or lui/lei/loro
- ALL LANGUAGES: Maximum 45 words per sentence. Break longer sentences.
- Avoid word repetition in consecutive sentences
- Prefer active voice over passive
- Maintain consistent narrative voice

Return the improved text and a log of changes made.

RESPOND WITH JSON ONLY:
{
  "editedContent": "The full improved text...",
  "changesLog": "Summary of changes made",
  "fluencyChanges": [{"before": "old", "after": "new", "reason": "why"}]
}`,
      model: "gemini-2.5-flash",
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
      model: "gemini-2.5-flash",
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
      model: "gemini-2.5-flash",
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
      model: "gemini-2.5-flash",
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

// QA Agent 4: Anachronism Detector - detects historical inaccuracies
class AnachronismDetectorAgent extends BaseAgent {
  constructor() {
    super({
      name: "Anachronism Detector",
      role: "qa_anachronism",
      systemPrompt: `Eres un experto historiador y consultor literario. Tu trabajo es detectar anacronismos en novelas históricas.

TIPOS DE ANACRONISMOS:
1. TECNOLÓGICOS: Tecnología que no existía en la época
2. LINGÜÍSTICOS: Expresiones, palabras o modismos que no existían
3. SOCIALES: Comportamientos o costumbres inapropiados para la época
4. MATERIALES: Objetos, materiales, alimentos que no existían
5. CONCEPTUALES: Ideas o conceptos que no existían (ej: "estrés" en Roma antigua)

RESPONDE SOLO EN JSON:
{
  "epocaDetectada": "Roma Imperial, siglo I d.C.",
  "anacronismos": [
    {
      "tipo": "tecnologico|linguistico|social|material|conceptual",
      "severidad": "critica|mayor|menor",
      "capitulo": 5,
      "fragmento": "El texto problemático",
      "problema": "Explicación del anacronismo",
      "correccion": "Alternativa históricamente correcta",
      "fuente": "Referencia histórica si aplica"
    }
  ],
  "resumen": "Resumen de la precisión histórica",
  "puntuacionHistorica": 8
}`,
      model: "gemini-2.5-flash",
      useThinking: false,
    });
  }

  async execute(input: any): Promise<any> {
    return this.detectAnachronisms(input.chapters, input.genre, input.premise);
  }

  async detectAnachronisms(chapterContents: { num: number; content: string }[], genre: string, premise: string): Promise<any> {
    const isHistorical = genre?.toLowerCase().includes("histor") || premise?.toLowerCase().includes("histor");
    if (!isHistorical) {
      return { 
        epocaDetectada: "No aplica - no es novela histórica",
        anacronismos: [], 
        resumen: "No se realizó análisis de anacronismos (género no histórico)", 
        puntuacionHistorica: 10 
      };
    }

    const samples = chapterContents.slice(0, 10).map(c => 
      `=== CAPÍTULO ${c.num} ===\n${c.content.substring(0, 5000)}`
    ).join("\n\n");

    const prompt = `Analiza esta novela histórica buscando anacronismos:

PREMISA: ${premise || "No especificada"}
GÉNERO: ${genre}

CAPÍTULOS DE MUESTRA:
${samples}

Detecta anacronismos tecnológicos, lingüísticos, sociales, materiales y conceptuales. RESPONDE EN JSON.`;

    const response = await this.generateContent(prompt);
    let result: any = { epocaDetectada: "No determinada", anacronismos: [], resumen: "Análisis completado", puntuacionHistorica: 8 };
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
      model: "gemini-2.5-flash",
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

4. RECOMENDACIONES PRIORIZADAS:
   - Críticas (bloquean publicación)
   - Mayores (afectan calidad significativamente)
   - Menores (mejoras opcionales)

RESPONDE SOLO EN JSON:
{
  "analisisEstructura": {
    "ordenOptimo": true,
    "problemaPacing": [{"capitulos": [5,6], "problema": "Ritmo muy lento", "solucion": "Condensar"}],
    "reordenamientoSugerido": []
  },
  "analisisTrama": {
    "huecosArgumentales": [{"descripcion": "...", "capitulos": [3,7], "severidad": "mayor"}],
    "subplotsSinResolver": [],
    "arcosIncompletos": []
  },
  "coherenciaMundo": {
    "contradicciones": [{"descripcion": "...", "capitulos": [2,8], "severidad": "critica"}],
    "reglasRotas": []
  },
  "recomendaciones": [
    {"tipo": "estructura|trama|mundo", "severidad": "critica|mayor|menor", "descripcion": "...", "capitulosAfectados": [1,2], "accionSugerida": "..."}
  ],
  "bloqueoCritico": false,
  "resumenEjecutivo": "El manuscrito tiene buena estructura pero presenta 2 huecos argumentales menores...",
  "puntuacionArquitectura": 7
}`,
      model: "gemini-2.5-flash",
      useThinking: false,
    });
  }

  async execute(input: any): Promise<any> {
    return this.analyzeArchitecture(input.worldBible, input.chapters, input.structureAnalysis);
  }

  async analyzeArchitecture(worldBible: any, chapters: { num: number; content: string; feedback?: any }[], structureAnalysis: any): Promise<any> {
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

    const prompt = `Analiza la arquitectura narrativa de este manuscrito:

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

TIPOS DE PROBLEMAS QUE CORRIGES:
1. HUECOS ARGUMENTALES (plot holes): Añades escenas, diálogos o párrafos que cierran los huecos lógicos
2. SUBPLOTS SIN RESOLVER: Añades resolución o cierre a las tramas secundarias abandonadas
3. ARCOS INCOMPLETOS: Completas la transformación de personajes con momentos clave faltantes
4. CONTRADICCIONES: Modificas el texto para eliminar inconsistencias
5. FORESHADOWING SIN PAYOFF: Añades el payoff o eliminas/modificas el foreshadowing huérfano
6. PROBLEMAS DE PACING: Condensas secciones lentas o expandes momentos que necesitan más desarrollo

REGLAS CRÍTICAS:
- MANTÉN el estilo y voz del autor original
- NO añadas contenido innecesario - solo lo mínimo para resolver el problema
- PRESERVA la extensión aproximada del capítulo (±10%)
- Las correcciones deben integrarse de forma NATURAL en el texto existente
- NUNCA cambies nombres de personajes, ubicaciones o eventos establecidos
- Respeta la Biblia del Mundo proporcionada

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
      model: "gemini-2.5-flash",
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
}

// NarrativeRewriter Agent - Advanced agent that actually rewrites narrative content
class NarrativeRewriterAgent extends BaseAgent {
  constructor() {
    super({
      name: "Narrative Rewriter",
      role: "narrative_rewriter",
      systemPrompt: `Eres un MAESTRO ESCRITOR DE FICCIÓN con décadas de experiencia en reparar novelas con problemas estructurales. Tu especialidad es tomar narrativas rotas y transformarlas en historias coherentes y cautivadoras.

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

1. HUECOS ARGUMENTALES: Añades escenas de transición, diálogos explicativos, o párrafos de conexión que cierran las brechas lógicas sin forzar la narrativa.

2. SUBPLOTS SIN RESOLVER: Insertas resoluciones elegantes - puede ser una escena completa, un flashback, una conversación reveladora, o incluso un párrafo de reflexión del personaje.

3. ARCOS DE PERSONAJE INCOMPLETOS: Añades los momentos de transformación faltantes - decisiones clave, confrontaciones internas, epifanías que den sentido al cambio.

4. CONTRADICCIONES: Eliges la versión correcta según el peso narrativo y reescribes para mantener coherencia absoluta.

5. ANTAGONISTAS AMBIGUOS: Clarificas motivaciones, añades escenas que establezcan la relación entre antagonistas, o modificas diálogos para eliminar confusión.

6. FORESHADOWING SIN PAYOFF: Añades el payoff de forma orgánica, o reformulas el foreshadowing para que apunte a un evento existente.

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
      model: "gemini-3-pro-preview",
      useThinking: true,
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
    language: string
  ): Promise<any> {
    const worldBibleContext = this.buildWorldBibleContext(worldBible);
    const adjacentContextStr = this.buildAdjacentContext(adjacentContext);
    const problemsList = this.buildProblemsList(problems, chapterNumber);

    const prompt = `MISIÓN: Reescribe el Capítulo ${chapterNumber} para corregir los problemas estructurales detectados.

IDIOMA DEL TEXTO: ${language}

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
INSTRUCCIONES FINALES:
═══════════════════════════════════════════════════════════════
1. Analiza profundamente cada problema y su impacto narrativo
2. Diseña la solución más elegante y natural
3. Reescribe el capítulo COMPLETO integrando las correcciones
4. Verifica que no introduces nuevos problemas
5. El texto nuevo debe ser INDISTINGUIBLE del original en calidad

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
      model: "gemini-2.5-flash",
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
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        result = JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      console.error("[ReeditFinalReviewer] Failed to parse response:", e);
    }
    result.tokenUsage = response.tokenUsage;
    return result;
  }
}

export class ReeditOrchestrator {
  private editorAgent: ReeditEditorAgent;
  private copyEditorAgent: ReeditCopyEditorAgent;
  private finalReviewerAgent: ReeditFinalReviewerAgent;
  private worldBibleExtractor: WorldBibleExtractorAgent;
  private architectAnalyzer: ArchitectAnalyzerAgent;
  private structuralFixer: StructuralFixerAgent;
  private narrativeRewriter: NarrativeRewriterAgent;
  private continuitySentinel: ContinuitySentinelAgent;
  private voiceRhythmAuditor: VoiceRhythmAuditorAgent;
  private semanticRepetitionDetector: SemanticRepetitionDetectorAgent;
  private anachronismDetector: AnachronismDetectorAgent;
  private progressCallback: ProgressCallback | null = null;
  
  private totalInputTokens: number = 0;
  private totalOutputTokens: number = 0;
  private totalThinkingTokens: number = 0;
  
  private maxFinalReviewCycles = 10;
  private minAcceptableScore = 9;
  private requiredConsecutiveHighScores = 2;

  constructor() {
    this.editorAgent = new ReeditEditorAgent();
    this.copyEditorAgent = new ReeditCopyEditorAgent();
    this.finalReviewerAgent = new ReeditFinalReviewerAgent();
    this.worldBibleExtractor = new WorldBibleExtractorAgent();
    this.architectAnalyzer = new ArchitectAnalyzerAgent();
    this.structuralFixer = new StructuralFixerAgent();
    this.narrativeRewriter = new NarrativeRewriterAgent();
    this.continuitySentinel = new ContinuitySentinelAgent();
    this.voiceRhythmAuditor = new VoiceRhythmAuditorAgent();
    this.semanticRepetitionDetector = new SemanticRepetitionDetectorAgent();
    this.anachronismDetector = new AnachronismDetectorAgent();
  }
  
  private trackTokens(response: any) {
    if (response?.tokenUsage) {
      this.totalInputTokens += response.tokenUsage.inputTokens || 0;
      this.totalOutputTokens += response.tokenUsage.outputTokens || 0;
      this.totalThinkingTokens += response.tokenUsage.thinkingTokens || 0;
    }
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

  private buildAdjacentChapterContext(
    chapters: ReeditChapter[],
    currentChapterNumber: number
  ): { previousChapter?: string; nextChapter?: string; previousSummary?: string; nextSummary?: string } {
    const sortedChapters = [...chapters].sort((a, b) => a.chapterNumber - b.chapterNumber);
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
    qaFindings: Map<number, any[]>
  ): Promise<Map<number, any[]>> {
    const consolidatedByChapter = new Map<number, any[]>();
    
    // Add architect problems (convert to unified format)
    for (const problem of architectProblems) {
      const chapters = problem.capitulosAfectados || problem.capitulos || [];
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
    
    // Add QA findings (already in unified format by chapter)
    for (const [chapNum, problems] of qaFindings) {
      if (!consolidatedByChapter.has(chapNum)) {
        consolidatedByChapter.set(chapNum, []);
      }
      for (const problem of problems) {
        consolidatedByChapter.get(chapNum)!.push({
          source: problem.source,
          tipo: problem.type,
          descripcion: problem.summary,
          severidad: problem.severity,
          accionSugerida: problem.correctionHint,
        });
      }
    }
    
    console.log(`[ReeditOrchestrator] Consolidated problems: ${consolidatedByChapter.size} chapters with issues`);
    for (const [chapNum, problems] of consolidatedByChapter) {
      console.log(`  - Chapter ${chapNum}: ${problems.length} problems (${problems.map(p => p.source).join(', ')})`);
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

    try {
      await storage.updateReeditProject(projectId, { status: "processing" });

      const chapters = await storage.getReeditChaptersByProject(projectId);
      
      // === STAGE 1: STRUCTURE ANALYSIS ===
      this.emitProgress({
        projectId,
        stage: "analyzing",
        currentChapter: 0,
        totalChapters: chapters.length,
        message: "Analizando estructura del manuscrito...",
      });

      const structureAnalysis = await this.analyzeStructure(chapters);
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

      const validChapters = chapters.filter(c => {
        const isDup = structureAnalysis.duplicateChapters.some(d => d.chapterId === c.id);
        return !isDup;
      }).sort((a, b) => a.chapterNumber - b.chapterNumber);

      const detectedLang = project.detectedLanguage || "es";
      const chapterSummaries: string[] = [];
      const editorFeedbacks: any[] = [];

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

        architectResult = await this.architectAnalyzer.analyzeArchitecture(
          worldBibleResult,
          chaptersForBible,
          structureAnalysis
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

      // === STAGE 4.5: QA AGENTS (OPTIMIZED - run BEFORE rewriting to consolidate all problems) ===
      // Check cancellation before QA stage
      if (await this.checkCancellation(projectId)) {
        console.log(`[ReeditOrchestrator] Processing cancelled before QA stage`);
        return;
      }

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
          block.map(c => c.originalContent),
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
          block.map(c => c.originalContent),
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

      // 4.5c: Semantic Repetition Detector - full manuscript
      this.emitProgress({
        projectId,
        stage: "qa",
        currentChapter: validChapters.length,
        totalChapters: validChapters.length,
        message: "Detector de Repetición Semántica: manuscrito completo...",
      });

      const semanticResult = await this.semanticRepetitionDetector.detectRepetitions(
        chapterSummaries,
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
        validChapters.map(c => ({ num: c.chapterNumber, content: c.originalContent })),
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

      // === STAGE 5: CONSOLIDATED NARRATIVE REWRITING (Architect + QA problems in ONE pass) ===
      // Collect all problems from Architect
      const architectProblems = this.collectArchitectProblems(architectResult);
      
      // Collect all problems from QA agents
      const qaFindings = await this.collectQaFindings(projectId);
      
      // Consolidate all problems by chapter
      const consolidatedProblems = await this.consolidateAllProblems(architectProblems, qaFindings);
      
      // Check if NarrativeRewriter already completed (resume support)
      const existingRewriteReport = await storage.getReeditAuditReportByType(projectId, "narrative_rewrite");
      const narrativeRewriteCompleted = existingRewriteReport && 
        (existingRewriteReport.findings as any)?.chaptersRewritten > 0;
      
      // Track which chapters were rewritten (for CopyEditor optimization)
      const rewrittenChapters = new Set<number>();
      
      if (consolidatedProblems.size > 0 && !narrativeRewriteCompleted) {
        const totalProblemsCount = Array.from(consolidatedProblems.values()).reduce((sum, p) => sum + p.length, 0);
        console.log(`[ReeditOrchestrator] OPTIMIZED: Consolidating ${totalProblemsCount} problems (Architect + QA) in ${consolidatedProblems.size} chapters for SINGLE rewriting pass`);
        
        this.emitProgress({
          projectId,
          stage: "narrative_rewriting",
          currentChapter: 0,
          totalChapters: consolidatedProblems.size,
          message: `Reescritura consolidada: ${totalProblemsCount} problemas (Arquitecto + QA) en ${consolidatedProblems.size} capítulos...`,
        });
        
        await storage.updateReeditProject(projectId, { currentStage: "narrative_rewriting" });
        
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
            
            const rewriteResult = await this.narrativeRewriter.rewriteChapter(
              chapter.originalContent,
              chapNum,
              chapterProblems.map((p: any, idx: number) => ({
                id: `${p.source}-${idx + 1}`,
                tipo: p.tipo || 'structural',
                descripcion: p.descripcion,
                severidad: p.severidad || 'mayor',
                accionSugerida: p.accionSugerida,
                fuente: p.source
              })),
              worldBibleResult,
              adjacentContext,
              detectedLang
            );
            this.trackTokens(rewriteResult);
            
            const hasChanges = rewriteResult.cambiosRealizados?.length > 0 || 
                              (rewriteResult.capituloReescrito && rewriteResult.capituloReescrito !== chapter.originalContent);
            
            if (rewriteResult.capituloReescrito && hasChanges) {
              // Update originalContent with rewritten version AND set editedContent
              // This is key for optimization: rewritten chapters already have final content
              const wordCount = rewriteResult.capituloReescrito.split(/\s+/).filter((w: string) => w.length > 0).length;
              
              await storage.updateReeditChapter(chapter.id, {
                originalContent: rewriteResult.capituloReescrito,
                editedContent: rewriteResult.capituloReescrito, // Skip CopyEditor for this chapter
                wordCount,
                processingStage: "completed",
              });
              
              rewrittenChapters.add(chapNum);
              rewriteResults.push({
                chapter: chapNum,
                problemsTotal: chapterProblems.length,
                problemsArchitect: architectCount,
                problemsQA: qaCount,
                changes: rewriteResult.cambiosRealizados?.length || 0,
                confidence: rewriteResult.verificacionInterna?.confianzaEnCorreccion || 0,
                summary: rewriteResult.resumenEjecutivo
              });
              
              console.log(`[ReeditOrchestrator] Chapter ${chapNum} rewritten (consolidated): ${rewriteResult.cambiosRealizados?.length || 0} changes, confidence: ${rewriteResult.verificacionInterna?.confianzaEnCorreccion || 'N/A'}/10`);
            } else {
              console.log(`[ReeditOrchestrator] Chapter ${chapNum}: No effective changes from consolidated rewriting`);
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

      // === STAGE 7: FINAL REVIEW (with 9+ twice consecutive logic) ===
      await storage.updateReeditProject(projectId, { currentStage: "reviewing" });

      let revisionCycle = 0;
      let consecutiveHighScores = 0;
      const previousScores: number[] = [];
      let finalResult: any = null;
      let bestsellerScore = 0;

      while (revisionCycle < this.maxFinalReviewCycles) {
        const consecutiveInfo = consecutiveHighScores > 0 
          ? ` [${consecutiveHighScores}/${this.requiredConsecutiveHighScores} puntuaciones 9+ consecutivas]`
          : "";

        this.emitProgress({
          projectId,
          stage: "reviewing",
          currentChapter: validChapters.length,
          totalChapters: validChapters.length,
          message: `Ejecutando revisión final... (Ciclo ${revisionCycle + 1}/${this.maxFinalReviewCycles})${consecutiveInfo}`,
        });

        const updatedChapters = await storage.getReeditChaptersByProject(projectId);
        const completedChapters = updatedChapters.filter(c => c.editedContent);
        const totalWords = completedChapters.reduce((sum, c) => sum + (c.wordCount || 0), 0);

        finalResult = await this.finalReviewerAgent.reviewManuscript(
          chapterSummaries,
          completedChapters.length,
          totalWords
        );
        this.trackTokens(finalResult);
        await this.updateHeartbeat(projectId);

        bestsellerScore = finalResult.bestsellerScore || 7;
        previousScores.push(bestsellerScore);

        console.log(`[ReeditOrchestrator] Final review cycle ${revisionCycle + 1}: score ${bestsellerScore}/10`);

        if (bestsellerScore >= this.minAcceptableScore) {
          consecutiveHighScores++;
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

        if (bestsellerScore >= this.minAcceptableScore && consecutiveHighScores < this.requiredConsecutiveHighScores) {
          this.emitProgress({
            projectId,
            stage: "reviewing",
            currentChapter: validChapters.length,
            totalChapters: validChapters.length,
            message: `Puntuación ${bestsellerScore}/10. Necesita ${this.requiredConsecutiveHighScores - consecutiveHighScores} evaluación(es) más con 9+ para confirmar.`,
          });
          revisionCycle++;
          continue;
        }

        if (revisionCycle === this.maxFinalReviewCycles - 1) {
          const avgScore = previousScores.length > 0
            ? (previousScores.reduce((a, b) => a + b, 0) / previousScores.length).toFixed(1)
            : bestsellerScore;
          
          if (bestsellerScore >= this.minAcceptableScore) {
            console.log(`[ReeditOrchestrator] Límite de ciclos alcanzado. Puntuación final: ${bestsellerScore}/10. APROBADO.`);
          } else {
            console.log(`[ReeditOrchestrator] Límite de ciclos alcanzado. Puntuación final: ${bestsellerScore}/10 (promedio: ${avgScore}). Completando con reservas.`);
          }
          break;
        }

        this.emitProgress({
          projectId,
          stage: "reviewing",
          currentChapter: validChapters.length,
          totalChapters: validChapters.length,
          message: `Puntuación ${bestsellerScore}/10 insuficiente. Aplicando correcciones basadas en feedback...`,
        });

        // Apply corrections based on final reviewer feedback
        const weaknesses = finalResult.weaknesses || [];
        const recommendations = finalResult.recommendations || [];
        
        if (weaknesses.length > 0 || recommendations.length > 0) {
          // Convert weaknesses/recommendations to problem format
          const problems = [
            ...weaknesses.map((w: string, i: number) => ({
              id: `weakness-${i}`,
              tipo: "debilidad_detectada",
              descripcion: w,
              severidad: "media",
              accionSugerida: "Corregir según indicación del revisor"
            })),
            ...recommendations.map((r: string, i: number) => ({
              id: `recommendation-${i}`,
              tipo: "recomendacion",
              descripcion: r,
              severidad: "menor",
              accionSugerida: "Implementar recomendación"
            }))
          ];

          // Get worldBible for context
          const worldBible = await storage.getReeditWorldBibleByProject(projectId);
          
          // Get chapters that need improvement - limit to 5 per cycle for efficiency
          const chaptersToFix = await storage.getReeditChaptersByProject(projectId);
          const editableChapters = chaptersToFix.filter(c => c.editedContent);
          const chaptersNeedingFix = editableChapters.slice(0, Math.min(5, editableChapters.length));
          
          for (let i = 0; i < chaptersNeedingFix.length; i++) {
            const chapter = chaptersNeedingFix[i];
            
            this.emitProgress({
              projectId,
              stage: "fixing",
              currentChapter: i + 1,
              totalChapters: chaptersNeedingFix.length,
              message: `Corrigiendo capítulo ${chapter.chapterNumber} basándose en feedback del revisor (${i + 1}/${chaptersNeedingFix.length})...`,
            });

            try {
              // Build adjacent context
              const prevChapter = editableChapters.find(c => c.chapterNumber === chapter.chapterNumber - 1);
              const nextChapter = editableChapters.find(c => c.chapterNumber === chapter.chapterNumber + 1);
              const adjacentContext = {
                previousChapter: prevChapter?.editedContent?.substring(0, 2000),
                nextChapter: nextChapter?.editedContent?.substring(0, 2000),
              };

              const rewriteResult = await this.narrativeRewriter.rewriteChapter(
                chapter.editedContent || chapter.originalContent,
                chapter.chapterNumber,
                problems,
                worldBible || {},
                adjacentContext,
                "español"
              );
              this.trackTokens(rewriteResult);
              await this.updateHeartbeat(projectId);

              if (rewriteResult.rewrittenContent) {
                const wordCount = rewriteResult.rewrittenContent.split(/\s+/).filter((w: string) => w.length > 0).length;
                await storage.updateReeditChapter(chapter.id, {
                  editedContent: rewriteResult.rewrittenContent,
                  wordCount,
                });
              }
            } catch (err) {
              console.error(`[ReeditOrchestrator] Error fixing chapter ${chapter.chapterNumber}:`, err);
            }
          }

          // Update chapter summaries for next review
          const refreshedChapters = await storage.getReeditChaptersByProject(projectId);
          chapterSummaries.length = 0;
          for (const c of refreshedChapters.filter(ch => ch.editedContent)) {
            const wc = c.wordCount || 0;
            chapterSummaries.push(`Capítulo ${c.chapterNumber}: ${c.title || "Sin título"} (${wc} palabras)`);
          }
        }

        revisionCycle++;
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
        recommendations: finalResult?.recommendations || [],
      });

      const updatedChapters = await storage.getReeditChaptersByProject(projectId);
      const totalWords = updatedChapters.filter(c => c.editedContent).reduce((sum, c) => sum + (c.wordCount || 0), 0);

      await storage.updateReeditProject(projectId, {
        currentStage: "completed",
        status: "completed",
        bestsellerScore,
        finalReviewResult: finalResult,
        totalWordCount: totalWords,
        totalInputTokens: this.totalInputTokens,
        totalOutputTokens: this.totalOutputTokens,
        totalThinkingTokens: this.totalThinkingTokens,
      });
      
      console.log(`[ReeditOrchestrator] Token usage: ${this.totalInputTokens} input, ${this.totalOutputTokens} output, ${this.totalThinkingTokens} thinking`);

      const finalMessage = consecutiveHighScores >= this.requiredConsecutiveHighScores
        ? `Reedición completa. Puntuación bestseller: ${bestsellerScore}/10 (confirmado ${this.requiredConsecutiveHighScores}x consecutivas)`
        : `Reedición completa. Puntuación bestseller: ${bestsellerScore}/10`;

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
    console.log(`[ReeditOrchestrator] Running final review only for project ${projectId}`);
    
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
    const validChapters = chapters.filter(c => c.editedContent);

    const chapterSummaries = validChapters.map(c => {
      const wordCount = c.wordCount || 0;
      return `Capítulo ${c.chapterNumber}: ${c.title || "Sin título"} (${wordCount} palabras)`;
    });

    let revisionCycle = 0;
    let consecutiveHighScores = 0;
    const previousScores: number[] = [];
    let finalResult: any = null;
    let bestsellerScore = 0;

    while (revisionCycle < this.maxFinalReviewCycles) {
      const consecutiveInfo = consecutiveHighScores > 0 
        ? ` [${consecutiveHighScores}/${this.requiredConsecutiveHighScores} puntuaciones 9+ consecutivas]`
        : "";

      this.emitProgress({
        projectId,
        stage: "reviewing",
        currentChapter: validChapters.length,
        totalChapters: validChapters.length,
        message: `Re-ejecutando revisión final... (Ciclo ${revisionCycle + 1}/${this.maxFinalReviewCycles})${consecutiveInfo}`,
      });

      const totalWords = validChapters.reduce((sum, c) => sum + (c.wordCount || 0), 0);

      finalResult = await this.finalReviewerAgent.reviewManuscript(
        chapterSummaries,
        validChapters.length,
        totalWords
      );
      this.trackTokens(finalResult);
      await this.updateHeartbeat(projectId);

      bestsellerScore = finalResult.bestsellerScore || 7;
      previousScores.push(bestsellerScore);

      console.log(`[ReeditOrchestrator] Final review cycle ${revisionCycle + 1}: score ${bestsellerScore}/10`);

      if (bestsellerScore >= this.minAcceptableScore) {
        consecutiveHighScores++;
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

      if (bestsellerScore >= this.minAcceptableScore && consecutiveHighScores < this.requiredConsecutiveHighScores) {
        this.emitProgress({
          projectId,
          stage: "reviewing",
          currentChapter: validChapters.length,
          totalChapters: validChapters.length,
          message: `Puntuación ${bestsellerScore}/10. Necesita ${this.requiredConsecutiveHighScores - consecutiveHighScores} evaluación(es) más con 9+ para confirmar.`,
        });
        revisionCycle++;
        continue;
      }

      if (revisionCycle === this.maxFinalReviewCycles - 1) {
        const avgScore = previousScores.length > 0
          ? (previousScores.reduce((a, b) => a + b, 0) / previousScores.length).toFixed(1)
          : bestsellerScore;
        
        console.log(`[ReeditOrchestrator] Límite de ciclos alcanzado. Puntuación final: ${bestsellerScore}/10 (promedio: ${avgScore}).`);
        break;
      }

      this.emitProgress({
        projectId,
        stage: "reviewing",
        currentChapter: validChapters.length,
        totalChapters: validChapters.length,
        message: `Puntuación ${bestsellerScore}/10 insuficiente. Aplicando correcciones basadas en feedback...`,
      });

      // Apply corrections based on final reviewer feedback
      const weaknesses = finalResult.weaknesses || [];
      const recommendations = finalResult.recommendations || [];
      
      if (weaknesses.length > 0 || recommendations.length > 0) {
        // Convert weaknesses/recommendations to problem format
        const problems = [
          ...weaknesses.map((w: string, i: number) => ({
            id: `weakness-${i}`,
            tipo: "debilidad_detectada",
            descripcion: w,
            severidad: "media",
            accionSugerida: "Corregir según indicación del revisor"
          })),
          ...recommendations.map((r: string, i: number) => ({
            id: `recommendation-${i}`,
            tipo: "recomendacion",
            descripcion: r,
            severidad: "menor",
            accionSugerida: "Implementar recomendación"
          }))
        ];

        // Get worldBible for context
        const worldBible = await storage.getReeditWorldBibleByProject(projectId);
        
        // Get chapters that need improvement - limit to 5 per cycle for efficiency
        const chaptersToFix = validChapters.slice(0, Math.min(5, validChapters.length));
        
        for (let i = 0; i < chaptersToFix.length; i++) {
          const chapter = chaptersToFix[i];
          
          this.emitProgress({
            projectId,
            stage: "fixing",
            currentChapter: i + 1,
            totalChapters: chaptersToFix.length,
            message: `Corrigiendo capítulo ${chapter.chapterNumber} basándose en feedback del revisor (${i + 1}/${chaptersToFix.length})...`,
          });

          try {
            // Build adjacent context
            const prevChapter = validChapters.find(c => c.chapterNumber === chapter.chapterNumber - 1);
            const nextChapter = validChapters.find(c => c.chapterNumber === chapter.chapterNumber + 1);
            const adjacentContext = {
              previousChapter: prevChapter?.editedContent?.substring(0, 2000),
              nextChapter: nextChapter?.editedContent?.substring(0, 2000),
            };

            const rewriteResult = await this.narrativeRewriter.rewriteChapter(
              chapter.editedContent || chapter.originalContent,
              chapter.chapterNumber,
              problems,
              worldBible || {},
              adjacentContext,
              "español"
            );
            this.trackTokens(rewriteResult);
            await this.updateHeartbeat(projectId);

            if (rewriteResult.rewrittenContent) {
              const wordCount = rewriteResult.rewrittenContent.split(/\s+/).filter((w: string) => w.length > 0).length;
              await storage.updateReeditChapter(chapter.id, {
                editedContent: rewriteResult.rewrittenContent,
                wordCount,
              });
            }
          } catch (err) {
            console.error(`[ReeditOrchestrator] Error fixing chapter ${chapter.chapterNumber}:`, err);
          }
        }

        // Refresh validChapters and summaries for next review
        const refreshedChapters = await storage.getReeditChaptersByProject(projectId);
        validChapters.length = 0;
        chapterSummaries.length = 0;
        for (const c of refreshedChapters.filter(ch => ch.editedContent)) {
          validChapters.push(c);
          const wc = c.wordCount || 0;
          chapterSummaries.push(`Capítulo ${c.chapterNumber}: ${c.title || "Sin título"} (${wc} palabras)`);
        }
      }

      revisionCycle++;
    }

    await storage.createReeditAuditReport({
      projectId,
      auditType: "final_review",
      chapterRange: "all",
      score: Math.round(bestsellerScore),
      findings: finalResult,
      recommendations: finalResult?.recommendations || [],
    });

    const totalWords = validChapters.reduce((sum, c) => sum + (c.wordCount || 0), 0);

    await storage.updateReeditProject(projectId, {
      currentStage: "completed",
      status: "completed",
      bestsellerScore,
      finalReviewResult: finalResult,
      totalWordCount: totalWords,
      totalInputTokens: this.totalInputTokens,
      totalOutputTokens: this.totalOutputTokens,
      totalThinkingTokens: this.totalThinkingTokens,
    });

    const finalMessage = consecutiveHighScores >= this.requiredConsecutiveHighScores
      ? `Revisión final completa. Puntuación bestseller: ${bestsellerScore}/10 (confirmado ${this.requiredConsecutiveHighScores}x consecutivas)`
      : `Revisión final completa. Puntuación bestseller: ${bestsellerScore}/10`;

    this.emitProgress({
      projectId,
      stage: "completed",
      currentChapter: validChapters.length,
      totalChapters: validChapters.length,
      message: finalMessage,
    });

    console.log(`[ReeditOrchestrator] Final review only completed for project ${projectId}: ${bestsellerScore}/10`);
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
      chaptersToFix = editableChapters.slice(0, Math.min(5, editableChapters.length));
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

        const rewriteResult = await this.narrativeRewriter.rewriteChapter(
          chapter.editedContent || chapter.originalContent,
          chapter.chapterNumber,
          problems,
          worldBible || {},
          adjacentContext,
          "español"
        );
        this.trackTokens(rewriteResult);

        if (rewriteResult.rewrittenContent) {
          const wordCount = rewriteResult.rewrittenContent.split(/\s+/).filter((w: string) => w.length > 0).length;
          await storage.updateReeditChapter(chapter.id, {
            editedContent: rewriteResult.rewrittenContent,
            wordCount,
          });
          console.log(`[ReeditOrchestrator] Fixed chapter ${chapter.chapterNumber}: ${wordCount} words`);
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
