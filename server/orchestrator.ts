import { storage } from "./storage";
import { 
  ArchitectAgent, 
  GhostwriterAgent, 
  EditorAgent, 
  CopyEditorAgent, 
  FinalReviewerAgent, 
  ContinuitySentinelAgent,
  VoiceRhythmAuditorAgent,
  SemanticRepetitionDetectorAgent,
  isProjectCancelledFromDb,
  type EditorResult, 
  type FinalReviewerResult,
  type ContinuitySentinelResult,
  type VoiceRhythmAuditorResult,
  type SemanticRepetitionResult
} from "./agents";
import type { TokenUsage } from "./agents/base-agent";
import type { Project, WorldBible, Chapter, PlotOutline, Character, WorldRule, TimelineEvent } from "@shared/schema";

interface OrchestratorCallbacks {
  onAgentStatus: (role: string, status: string, message?: string) => void;
  onChapterComplete: (chapterNumber: number, wordCount: number, chapterTitle: string) => void;
  onChapterRewrite: (chapterNumber: number, chapterTitle: string, currentIndex: number, totalToRewrite: number, reason: string) => void;
  onChapterStatusChange: (chapterNumber: number, status: string) => void;
  onProjectComplete: () => void;
  onError: (error: string) => void;
}

interface ParsedWorldBible {
  world_bible: {
    personajes: any[];
    lugares: any[];
    reglas_lore: any[];
  };
  escaleta_capitulos: any[];
  premisa?: string;
  estructura_tres_actos?: any;
}

interface SectionData {
  numero: number;
  titulo: string;
  cronologia: string;
  ubicacion: string;
  elenco_presente: string[];
  objetivo_narrativo: string;
  beats: string[];
  continuidad_salida?: string;
  continuidad_entrada?: string;
  tipo?: "prologue" | "chapter" | "epilogue" | "author_note" | "book_prologue" | "book_epilogue";
  funcion_estructural?: string;
  informacion_nueva?: string;
  pregunta_dramatica?: string;
  conflicto_central?: {
    tipo?: string;
    descripcion?: string;
    stakes?: string;
  };
  giro_emocional?: {
    emocion_inicio?: string;
    emocion_final?: string;
  };
  recursos_literarios_sugeridos?: string[];
  tono_especifico?: string;
  prohibiciones_este_capitulo?: string[];
  arcos_que_avanza?: Array<{
    arco?: string;
    de?: string;
    a?: string;
  }>;
  // Bookbox-specific fields
  bookNumber?: number;
  bookTitle?: string;
  riesgos_de_verosimilitud?: {
    posibles_deus_ex_machina?: string[];
    setup_requerido?: string[];
    justificacion_causal?: string;
  };
}

export class Orchestrator {
  private architect = new ArchitectAgent();
  private ghostwriter = new GhostwriterAgent();
  private editor = new EditorAgent();
  private copyeditor = new CopyEditorAgent();
  private finalReviewer = new FinalReviewerAgent();
  private continuitySentinel = new ContinuitySentinelAgent();
  private voiceRhythmAuditor = new VoiceRhythmAuditorAgent();
  private semanticRepetitionDetector = new SemanticRepetitionDetectorAgent();
  private callbacks: OrchestratorCallbacks;
  private maxRefinementLoops = 3;
  private maxFinalReviewCycles = 15; // Continue until score >= 9 twice consecutively, up to this maximum
  private minAcceptableScore = 9; // Minimum score required for approval
  private requiredConsecutiveHighScores = 2; // Must achieve 9+ this many times in a row
  private continuityCheckpointInterval = 5;
  private currentProjectGenre = "";
  
  private cumulativeTokens = {
    inputTokens: 0,
    outputTokens: 0,
    thinkingTokens: 0,
  };

  /**
   * Calculate per-chapter word count target from total novel target
   * @param totalNovelTarget - Total word count for the entire novel (e.g., 90000)
   * @param totalChapters - Number of chapters in the novel
   * @param defaultPerChapter - Default per-chapter minimum if no total is set (default: 2500)
   * @returns Per-chapter word count target
   */
  private calculatePerChapterTarget(totalNovelTarget: number | null | undefined, totalChapters: number, defaultPerChapter: number = 2500): number {
    if (!totalNovelTarget || totalNovelTarget <= 0) {
      return defaultPerChapter; // Use default if no target set
    }
    if (totalChapters <= 0) {
      return defaultPerChapter;
    }
    // Calculate per-chapter target from total / chapters
    const calculated = Math.round(totalNovelTarget / totalChapters);
    // Ensure minimum reasonable chapter length (at least 1500 words)
    return Math.max(calculated, 1500);
  }

  private static readonly HISTORICAL_VOCABULARY: Record<string, { valid: string[], forbidden: string[], alternatives: Record<string, string> }> = {
    historical_thriller: {
      valid: [
        "veneno", "pócima", "brebaje", "ungüento", "cataplasma",
        "hierba venenosa", "extracto letal", "sustancia mortífera",
        "el hongo del centeno", "el cornezuelo", "la cicuta", "el acónito",
        "humores", "miasma", "putrefacción", "gangrena",
        "médico", "galeno", "sanador", "boticario", "herbolario",
        "bisturí", "escalpelo", "lanceta", "cauterio", "sanguijuela",
        "pergamino", "códice", "tablilla", "estilete", "cálamo",
        "denario", "sestercio", "as", "áureo",
        "toga", "túnica", "estola", "palla", "calcei",
        "ínsula", "domus", "villa", "thermae", "foro",
        "legado", "pretor", "edil", "cuestor", "tribuno"
      ],
      forbidden: [
        "formol", "formaldehído", "metrónomo", "Claviceps purpurea",
        "bacteria", "virus", "célula", "microscopio", "antibiótico",
        "ADN", "gen", "cromosoma", "proteína", "enzima",
        "oxígeno", "hidrógeno", "nitrógeno", "carbono", "molécula",
        "parálisis de análisis", "estrés", "trauma", "psicología",
        "kilómetro", "metro", "centímetro", "gramo", "litro",
        "reloj", "minuto", "segundo", "hora exacta",
        "electricidad", "voltaje", "batería", "motor",
        "nomenclatura binomial", "taxonomía científica moderna"
      ],
      alternatives: {
        "Claviceps purpurea": "el hongo del centeno / cornezuelo",
        "formol": "ungüento de conservación / aceites aromáticos",
        "bacteria": "miasma / corrupción del aire / humores pútridos",
        "virus": "pestilencia / mal invisible / aire corrupto",
        "estrés": "agotamiento / tensión del ánimo / fatiga nerviosa",
        "trauma": "herida del alma / cicatriz interior / shock",
        "minutos": "el tiempo de un rezo / un suspiro / un instante",
        "microscopio": "lupa / cristal de aumento",
        "análisis": "examen / escrutinio / inspección minuciosa"
      }
    },
    historical: {
      valid: [
        "carta", "misiva", "telegrama", "telégrafo",
        "automóvil", "carruaje", "tranvía", "ferrocarril",
        "peseta", "real", "duro", "céntimo",
        "fonógrafo", "gramófono", "cinematógrafo",
        "corsé", "polisón", "levita", "chistera", "bombín"
      ],
      forbidden: [
        "internet", "ordenador", "teléfono móvil", "smartphone",
        "avión comercial", "helicóptero", "televisión",
        "plástico", "nylon", "poliéster", "sintético",
        "antibiótico", "penicilina", "vacuna moderna",
        "psicoanálisis", "inconsciente", "complejo de Edipo"
      ],
      alternatives: {
        "estrés": "nerviosismo / agitación / desasosiego",
        "trauma": "conmoción / impresión terrible",
        "email": "carta / telegrama urgente"
      }
    },
    thriller: {
      valid: [],
      forbidden: [],
      alternatives: {}
    },
    mystery: {
      valid: [],
      forbidden: [],
      alternatives: {}
    },
    romance: {
      valid: [],
      forbidden: [],
      alternatives: {}
    },
    fantasy: {
      valid: [],
      forbidden: [],
      alternatives: {}
    },
    scifi: {
      valid: [],
      forbidden: [],
      alternatives: {}
    }
  };

  constructor(callbacks: OrchestratorCallbacks) {
    this.callbacks = callbacks;
  }
  
  private async trackTokenUsage(
    projectId: number, 
    tokenUsage?: TokenUsage,
    agentName?: string,
    model?: string,
    chapterNumber?: number,
    operation?: string
  ): Promise<void> {
    if (!tokenUsage) return;
    
    this.cumulativeTokens.inputTokens += tokenUsage.inputTokens;
    this.cumulativeTokens.outputTokens += tokenUsage.outputTokens;
    this.cumulativeTokens.thinkingTokens += tokenUsage.thinkingTokens;
    
    await storage.updateProject(projectId, {
      totalInputTokens: this.cumulativeTokens.inputTokens,
      totalOutputTokens: this.cumulativeTokens.outputTokens,
      totalThinkingTokens: this.cumulativeTokens.thinkingTokens,
    });
    
    // Register detailed AI usage event for cost tracking
    if (agentName && model) {
      const costs = this.calculateTokenCosts(model, tokenUsage);
      await storage.createAiUsageEvent({
        projectId,
        agentName,
        model,
        inputTokens: tokenUsage.inputTokens,
        outputTokens: tokenUsage.outputTokens,
        thinkingTokens: tokenUsage.thinkingTokens,
        inputCostUsd: costs.inputCost.toFixed(6),
        outputCostUsd: costs.outputCost.toFixed(6),
        totalCostUsd: costs.totalCost.toFixed(6),
        chapterNumber: chapterNumber || null,
        operation: operation || null,
      });
    }
  }
  
  private calculateTokenCosts(model: string, tokenUsage: TokenUsage): { inputCost: number; outputCost: number; totalCost: number } {
    // Pricing per million tokens
    const pricing: Record<string, { input: number; output: number; thinking: number }> = {
      "gemini-3-pro-preview": { input: 1.25, output: 10.00, thinking: 3.00 },
      "gemini-3-flash": { input: 0.50, output: 3.00, thinking: 1.50 },
      "gemini-2.5-flash": { input: 0.30, output: 2.50, thinking: 1.00 },
      "gemini-2.0-flash": { input: 0.15, output: 0.60, thinking: 0.30 },
    };
    
    const modelPricing = pricing[model] || pricing["gemini-3-pro-preview"];
    
    const inputCost = (tokenUsage.inputTokens / 1_000_000) * modelPricing.input;
    const outputCost = (tokenUsage.outputTokens / 1_000_000) * modelPricing.output;
    const thinkingCost = (tokenUsage.thinkingTokens / 1_000_000) * modelPricing.thinking;
    
    return {
      inputCost,
      outputCost: outputCost + thinkingCost,
      totalCost: inputCost + outputCost + thinkingCost,
    };
  }
  
  private resetTokenTracking(): void {
    this.cumulativeTokens = {
      inputTokens: 0,
      outputTokens: 0,
      thinkingTokens: 0,
    };
  }

  private validateImmediateContinuity(
    chapterContent: string,
    characterStates: Map<string, { alive: boolean; location: string; injuries: string[]; lastSeen: number }>,
    worldBible: any
  ): { valid: boolean; violations: string[] } {
    const violations: string[] = [];
    const contentLower = chapterContent.toLowerCase();

    characterStates.forEach((state, name) => {
      // Defensive guard: skip entries without valid name
      if (!name || typeof name !== 'string' || name.trim().length === 0) return;
      
      const nameLower = name.toLowerCase();
      const nameInContent = contentLower.includes(nameLower);

      if (!state.alive && nameInContent) {
        const actionPatterns = [
          `${nameLower} dijo`, `${nameLower} habló`, `${nameLower} respondió`,
          `${nameLower} caminó`, `${nameLower} corrió`, `${nameLower} miró`,
          `${nameLower} sonrió`, `${nameLower} asintió`, `${nameLower} se levantó`,
          `—dijo ${nameLower}`, `—respondió ${nameLower}`, `—exclamó ${nameLower}`,
        ];
        
        for (const pattern of actionPatterns) {
          if (contentLower.includes(pattern)) {
            violations.push(
              `PERSONAJE MUERTO ACTUANDO: "${name}" murió en el Capítulo ${state.lastSeen} pero aparece realizando acciones en este capítulo. Buscar y eliminar: "${pattern}"`
            );
            break;
          }
        }
      }

      if (state.alive && state.injuries.length > 0 && nameInContent) {
        let injuryMentioned = false;
        for (const injury of state.injuries) {
          if (contentLower.includes(injury.toLowerCase())) {
            injuryMentioned = true;
            break;
          }
        }
        
        const hasPhysicalAction = contentLower.includes(`${nameLower} corrió`) ||
                                   contentLower.includes(`${nameLower} luchó`) ||
                                   contentLower.includes(`${nameLower} saltó`) ||
                                   contentLower.includes(`${nameLower} golpeó`);
        
        if (hasPhysicalAction && !injuryMentioned) {
          violations.push(
            `HERIDA IGNORADA: "${name}" tiene heridas [${state.injuries.join(", ")}] que deberían afectar sus acciones físicas pero no se mencionan.`
          );
        }
      }
    });

    return {
      valid: violations.length === 0,
      violations
    };
  }

  private buildSlidingContextWindow(
    completedChapters: Chapter[],
    currentChapterIndex: number,
    allSections: SectionData[]
  ): { context: string; characterStates: Map<string, { alive: boolean; location: string; injuries: string[]; lastSeen: number }> } {
    const emptyResult = { context: "", characterStates: new Map() };
    if (completedChapters.length === 0) return emptyResult;

    const sortedChapters = [...completedChapters]
      .filter(c => c.status === "completed" && c.content)
      .sort((a, b) => a.chapterNumber - b.chapterNumber);

    if (sortedChapters.length === 0) return emptyResult;

    const contextParts: string[] = [];
    const FULL_CONTEXT_CHAPTERS = 2;
    const SUMMARY_CONTEXT_CHAPTERS = 5;

    // Build accumulated character state from all completed chapters
    const characterStates: Map<string, { alive: boolean; location: string; injuries: string[]; lastSeen: number }> = new Map();
    const keyEvents: string[] = [];

    for (const chapter of sortedChapters) {
      const state = chapter.continuityState as any;
      if (state?.character_states) {
        for (const char of state.character_states) {
          characterStates.set(char.name || char.personaje, {
            alive: char.alive !== false && char.status !== "dead" && char.estado !== "muerto",
            location: char.location || char.ubicacion || "desconocida",
            injuries: char.injuries || char.heridas || [],
            lastSeen: chapter.chapterNumber,
          });
        }
      }
      if (state?.key_events) {
        keyEvents.push(...state.key_events.slice(-2));
      }
    }

    // Build mandatory constraints from character states
    const mandatoryConstraints: string[] = [];
    characterStates.forEach((state, name) => {
      if (!state.alive) {
        mandatoryConstraints.push(`⛔ ${name}: MUERTO (Cap ${state.lastSeen}) - NO puede aparecer activo`);
      } else if (state.injuries.length > 0) {
        mandatoryConstraints.push(`⚠️ ${name}: Heridas activas [${state.injuries.join(", ")}] - DEBEN mencionarse`);
      }
      if (state.location && state.alive) {
        mandatoryConstraints.push(`📍 ${name}: Última ubicación = ${state.location}`);
      }
    });

    for (let i = sortedChapters.length - 1; i >= 0; i--) {
      const chapter = sortedChapters[i];
      const distanceFromCurrent = sortedChapters.length - 1 - i;

      if (distanceFromCurrent < FULL_CONTEXT_CHAPTERS) {
        const continuityState = chapter.continuityState 
          ? JSON.stringify(chapter.continuityState)
          : "";
        contextParts.unshift(`
[CAPÍTULO ${chapter.chapterNumber} - ${chapter.title}] (COMPLETO)
Estado de continuidad: ${continuityState || "No disponible"}
`);
      } else if (distanceFromCurrent < FULL_CONTEXT_CHAPTERS + SUMMARY_CONTEXT_CHAPTERS) {
        const section = allSections.find(s => s.numero === chapter.chapterNumber);
        const summary = section 
          ? `Objetivo: ${section.objetivo_narrativo || "N/A"}. Ubicación: ${section.ubicacion || "N/A"}. Elenco: ${section.elenco_presente?.join(", ") || "N/A"}.`
          : "Resumen no disponible";
        
        contextParts.unshift(`[Cap ${chapter.chapterNumber}: ${chapter.title}] ${summary}`);
      } else {
        contextParts.unshift(`[Cap ${chapter.chapterNumber}: ${chapter.title}]`);
      }
    }

    // Build the context with mandatory constraints at the top
    let context = `
═══════════════════════════════════════════════════════════════════
🚨🚨🚨 RESTRICCIONES DE CONTINUIDAD OBLIGATORIAS 🚨🚨🚨
═══════════════════════════════════════════════════════════════════
${mandatoryConstraints.length > 0 ? mandatoryConstraints.join("\n") : "Sin restricciones especiales"}

VIOLACIONES DE ESTAS RESTRICCIONES = RECHAZO AUTOMÁTICO DEL CAPÍTULO
═══════════════════════════════════════════════════════════════════

CONTEXTO DE CAPÍTULOS ANTERIORES:
${contextParts.join("\n")}
═══════════════════════════════════════════════════════════════════`;

    return { context, characterStates };
  }

  async generateNovel(project: Project): Promise<void> {
    try {
      // Check if chapters already exist (recovery after crash)
      const existingChapters = await storage.getChaptersByProject(project.id);
      if (existingChapters.length > 0) {
        console.log(`[Orchestrator] Found ${existingChapters.length} existing chapters for project ${project.id}. Delegating to resumeNovel instead.`);
        return this.resumeNovel(project);
      }

      this.resetTokenTracking();
      this.currentProjectGenre = project.genre;
      await storage.updateProject(project.id, { status: "generating" });

      let styleGuideContent = "";
      let authorName = "";
      let extendedGuideContent = "";
      
      if (project.styleGuideId) {
        const styleGuide = await storage.getStyleGuide(project.styleGuideId);
        if (styleGuide) {
          styleGuideContent = styleGuide.content;
        }
      }
      
      if (project.pseudonymId) {
        const pseudonym = await storage.getPseudonym(project.pseudonymId);
        if (pseudonym) {
          authorName = pseudonym.name;
        }
      }

      if ((project as any).extendedGuideId) {
        const extendedGuide = await storage.getExtendedGuide((project as any).extendedGuideId);
        if (extendedGuide) {
          extendedGuideContent = extendedGuide.content;
          console.log(`[Orchestrator] Using extended guide: "${extendedGuide.title}" (${extendedGuide.wordCount} words)`);
        }
      }

      let seriesContextContent = "";
      if (project.seriesId) {
        const seriesData = await storage.getSeries(project.seriesId);
        if (seriesData) {
          if (seriesData.seriesGuide) {
            seriesContextContent += `\n\n═══════════════════════════════════════════════════════════════════
GUÍA DE LA SERIE: "${seriesData.title}"
═══════════════════════════════════════════════════════════════════
${seriesData.seriesGuide}
═══════════════════════════════════════════════════════════════════\n`;
            console.log(`[Orchestrator] Using series guide for "${seriesData.title}" (${seriesData.seriesGuide.split(/\s+/).length} words)`);
          }

          const fullContinuity = await storage.getSeriesFullContinuity(project.seriesId);
          const previousVolumes = fullContinuity.projectSnapshots.filter(s => s.projectId !== project.id);
          const manuscriptSnapshots = fullContinuity.manuscriptSnapshots;
          
          const allSeriesManuscripts = await storage.getImportedManuscriptsBySeries(project.seriesId);
          const manuscriptsWithoutAnalysis = allSeriesManuscripts.filter(m => !m.continuitySnapshot);
          
          if (manuscriptsWithoutAnalysis.length > 0) {
            console.log(`[Orchestrator] WARNING: ${manuscriptsWithoutAnalysis.length} imported manuscript(s) in series without continuity analysis: ${manuscriptsWithoutAnalysis.map(m => `"${m.title}"`).join(", ")}`);
          }

          const totalPreviousVolumes = previousVolumes.length + manuscriptSnapshots.length + manuscriptsWithoutAnalysis.length;
          
          if (totalPreviousVolumes > 0) {
            seriesContextContent += `\n═══════════════════════════════════════════════════════════════════
VOLÚMENES ANTERIORES DE LA SERIE (${totalPreviousVolumes} libros)
═══════════════════════════════════════════════════════════════════\n`;
            
            const allVolumes: Array<{ order: number | null; content: string }> = [];
            
            for (const snapshot of previousVolumes) {
              allVolumes.push({
                order: null,
                content: `
--- VOLUMEN AI (Project ID: ${snapshot.projectId}) ---
Sinopsis: ${snapshot.synopsis || "No disponible"}
Estado de personajes: ${JSON.stringify(snapshot.characterStates)}
Hilos no resueltos: ${JSON.stringify(snapshot.unresolvedThreads)}
Eventos clave: ${JSON.stringify(snapshot.keyEvents)}
───────────────────────────────────────────────────────────────────\n`
              });
            }
            
            for (const ms of manuscriptSnapshots) {
              const snapshot = ms.snapshot;
              allVolumes.push({
                order: ms.seriesOrder,
                content: `
--- VOLUMEN ${ms.seriesOrder || "?"}: "${ms.title}" (Manuscrito Importado - Análisis Completo) ---
Sinopsis: ${snapshot?.synopsis || "No disponible"}
Estado de personajes: ${JSON.stringify(snapshot?.characterStates || [])}
Hilos no resueltos: ${JSON.stringify(snapshot?.unresolvedThreads || [])}
Ganchos de serie: ${JSON.stringify(snapshot?.seriesHooks || [])}
Eventos clave: ${JSON.stringify(snapshot?.keyEvents || [])}
───────────────────────────────────────────────────────────────────\n`
              });
            }
            
            for (const unanalyzedMs of manuscriptsWithoutAnalysis) {
              const chapters = await storage.getImportedChaptersByManuscript(unanalyzedMs.id);
              const chapterSummaries = chapters.slice(0, 5).map(ch => {
                const content = ch.editedContent || ch.originalContent;
                const preview = content.length > 500 ? content.substring(0, 500) + "..." : content;
                return `Cap ${ch.chapterNumber}: ${preview}`;
              }).join("\n\n");
              
              allVolumes.push({
                order: unanalyzedMs.seriesOrder,
                content: `
--- VOLUMEN ${unanalyzedMs.seriesOrder || "?"}: "${unanalyzedMs.title}" (Manuscrito Importado - Sin Análisis Detallado) ---
NOTA: Este manuscrito no tiene análisis de continuidad completo. Extractos de los primeros capítulos:

${chapterSummaries || "Sin capítulos disponibles"}

(Se recomienda ejecutar el análisis de continuidad para obtener información detallada)
───────────────────────────────────────────────────────────────────\n`
              });
            }
            
            allVolumes.sort((a, b) => (a.order || 0) - (b.order || 0));
            for (const vol of allVolumes) {
              seriesContextContent += vol.content;
            }
            
            console.log(`[Orchestrator] Loaded ${previousVolumes.length} AI project snapshots, ${manuscriptSnapshots.length} analyzed manuscripts, and ${manuscriptsWithoutAnalysis.length} unanalyzed manuscripts for series continuity`);
          }
        }
      }

      const effectivePremise = extendedGuideContent || seriesContextContent
        ? `${project.premise || ""}${extendedGuideContent ? `\n\n--- GUÍA DE ESCRITURA EXTENDIDA ---\n${extendedGuideContent}` : ""}${seriesContextContent}`
        : (project.premise || "");

      const savedWorldBible = await storage.getWorldBibleByProject(project.id);
      const savedChapters = await storage.getChaptersByProject(project.id);
      
      // plotOutline can be an object with 'escaleta' array or directly an array
      const plotOutlineData = savedWorldBible?.plotOutline as any;
      const hasPlotOutline = plotOutlineData && (
        Array.isArray(plotOutlineData) ? plotOutlineData.length > 0 :
        (plotOutlineData.escaleta && Array.isArray(plotOutlineData.escaleta) && plotOutlineData.escaleta.length > 0)
      );
      
      const hasValidWorldBible = savedWorldBible && 
        (savedWorldBible.characters as any[])?.length > 0 && 
        (hasPlotOutline || savedChapters.length > 0);
      
      let worldBibleData: ParsedWorldBible | null = null;
      
      if (hasValidWorldBible && savedChapters.length > 0) {
        console.log(`[Orchestrator] RESUME: World Bible already exists with ${(savedWorldBible!.characters as any[]).length} characters and ${savedChapters.length} chapters. Skipping Architect.`);
        this.callbacks.onAgentStatus("architect", "completed", "Estructura narrativa ya existente - reanudando escritura");
        await storage.createActivityLog({
          projectId: project.id,
          level: "info",
          message: `Reanudando desde World Bible existente (${(savedWorldBible!.characters as any[]).length} personajes, ${savedChapters.length} capítulos)`,
          agentRole: "system",
        });
        
        worldBibleData = this.reconstructWorldBibleData(savedWorldBible!, project);
        
        // Check if there are pending chapters - if so, delegate to resumeNovel
        const pendingChapters = savedChapters.filter(ch => ch.status === "pending" || ch.status === "writing");
        
        if (pendingChapters.length > 0) {
          console.log(`[Orchestrator] Found ${pendingChapters.length} pending chapters - delegating to resumeNovel`);
          return this.resumeNovel(project);
        }
      }

      const MAX_ARCHITECT_RETRIES = 3;
      let architectAttempt = 0;
      let architectResult: any = null;
      let lastArchitectError = "";

      while (architectAttempt < MAX_ARCHITECT_RETRIES) {
        architectAttempt++;
        
        this.callbacks.onAgentStatus("architect", "thinking", 
          architectAttempt > 1 
            ? `El Arquitecto está reintentando (intento ${architectAttempt}/${MAX_ARCHITECT_RETRIES})...` 
            : "El Arquitecto está diseñando la estructura narrativa..."
        );
        
        try {
          architectResult = await this.architect.execute({
            title: project.title,
            premise: effectivePremise,
            genre: project.genre,
            tone: project.tone,
            chapterCount: project.chapterCount,
            hasPrologue: project.hasPrologue,
            hasEpilogue: project.hasEpilogue,
            hasAuthorNote: project.hasAuthorNote,
            architectInstructions: project.architectInstructions || undefined,
            kindleUnlimitedOptimized: (project as any).kindleUnlimitedOptimized || false,
          });

          await this.trackTokenUsage(project.id, architectResult.tokenUsage, "El Arquitecto", "gemini-3-pro-preview", undefined, "world_bible");

          if (architectResult.error || architectResult.timedOut) {
            lastArchitectError = architectResult.error || "Timeout durante la generación del World Bible";
            console.error(`[Orchestrator] Architect attempt ${architectAttempt} failed: ${lastArchitectError}`);
            
            if (architectAttempt < MAX_ARCHITECT_RETRIES) {
              await storage.createActivityLog({
                projectId: project.id,
                level: "warn",
                message: `Arquitecto falló (intento ${architectAttempt}): ${lastArchitectError}. Reintentando...`,
                agentRole: "architect",
              });
              await new Promise(resolve => setTimeout(resolve, 5000));
              continue;
            }
          } else if (!architectResult.content || architectResult.content.trim().length === 0) {
            lastArchitectError = "El Arquitecto no generó contenido válido";
            console.error(`[Orchestrator] Architect attempt ${architectAttempt} returned empty content`);
            
            if (architectAttempt < MAX_ARCHITECT_RETRIES) {
              await storage.createActivityLog({
                projectId: project.id,
                level: "warn",
                message: `Arquitecto devolvió contenido vacío (intento ${architectAttempt}). Reintentando...`,
                agentRole: "architect",
              });
              await new Promise(resolve => setTimeout(resolve, 5000));
              continue;
            }
          } else {
            if (architectResult.thoughtSignature) {
              await storage.createThoughtLog({
                projectId: project.id,
                agentName: "El Arquitecto",
                agentRole: "architect",
                thoughtContent: architectResult.thoughtSignature,
              });
            }

            worldBibleData = this.parseArchitectOutput(architectResult.content);
            
            const hasCharacters = (worldBibleData.world_bible?.personajes?.length || 0) > 0;
            const escaletaLength = worldBibleData.escaleta_capitulos?.length || 0;
            const hasChapters = escaletaLength > 0;
            
            const expectedChapters = project.chapterCount + 
              (project.hasPrologue ? 1 : 0) + 
              (project.hasEpilogue ? 1 : 0) + 
              (project.hasAuthorNote ? 1 : 0);
            const hasEnoughChapters = escaletaLength >= expectedChapters;
            
            if (!hasCharacters || !hasChapters) {
              lastArchitectError = `World Bible vacía o incompleta: ${hasCharacters ? '✓' : '✗'} personajes (${worldBibleData.world_bible?.personajes?.length || 0}), ${hasChapters ? '✓' : '✗'} capítulos (${escaletaLength})`;
              console.error(`[Orchestrator] Architect attempt ${architectAttempt}: ${lastArchitectError}`);
              console.error(`[Orchestrator] Architect raw content preview (first 2000 chars):\n${architectResult.content?.substring(0, 2000)}`);
              
              if (architectAttempt < MAX_ARCHITECT_RETRIES) {
                await storage.createActivityLog({
                  projectId: project.id,
                  level: "warn",
                  message: `World Bible incompleta (intento ${architectAttempt}): ${lastArchitectError}. Reintentando...`,
                  agentRole: "architect",
                });
                worldBibleData = null;
                await new Promise(resolve => setTimeout(resolve, 5000));
                continue;
              }
            } else if (!hasEnoughChapters) {
              lastArchitectError = `Escaleta incompleta: generados ${escaletaLength} capítulos, esperados ${expectedChapters} (${project.chapterCount} capítulos + extras)`;
              console.error(`[Orchestrator] Architect attempt ${architectAttempt}: ${lastArchitectError}`);
              
              if (architectAttempt < MAX_ARCHITECT_RETRIES) {
                await storage.createActivityLog({
                  projectId: project.id,
                  level: "warn",
                  message: `Escaleta truncada (intento ${architectAttempt}): ${escaletaLength}/${expectedChapters} capítulos. Reintentando con más tokens...`,
                  agentRole: "architect",
                });
                worldBibleData = null;
                await new Promise(resolve => setTimeout(resolve, 5000));
                continue;
              }
            } else {
              console.log(`[Orchestrator] World Bible parsed successfully on attempt ${architectAttempt}: ${worldBibleData.world_bible?.personajes?.length || 0} characters, ${escaletaLength}/${expectedChapters} chapters`);
              break;
            }
          }
        } catch (error) {
          lastArchitectError = String(error);
          console.error(`[Orchestrator] Architect attempt ${architectAttempt} exception: ${lastArchitectError}`);
          
          if (architectAttempt < MAX_ARCHITECT_RETRIES) {
            await storage.createActivityLog({
              projectId: project.id,
              level: "warn",
              message: `Arquitecto excepción (intento ${architectAttempt}): ${lastArchitectError}. Reintentando...`,
              agentRole: "architect",
            });
            await new Promise(resolve => setTimeout(resolve, 5000));
            continue;
          }
        }
        
        if (architectAttempt >= MAX_ARCHITECT_RETRIES) break;
      }

      if (!worldBibleData || !worldBibleData.world_bible?.personajes?.length || !worldBibleData.escaleta_capitulos?.length) {
        const errorMsg = `El Arquitecto falló después de ${MAX_ARCHITECT_RETRIES} intentos: ${lastArchitectError}. El proyecto se pausará para permitir reintento manual.`;
        console.error(`[Orchestrator] CRITICAL: ${errorMsg}`);
        this.callbacks.onAgentStatus("architect", "error", errorMsg);
        this.callbacks.onError(errorMsg);
        
        await storage.createActivityLog({
          projectId: project.id,
          level: "error",
          message: `Arquitecto falló tras ${MAX_ARCHITECT_RETRIES} intentos. Proyecto pausado para reintento manual.`,
          agentRole: "architect",
          metadata: { lastError: lastArchitectError },
        });
        
        await storage.updateProject(project.id, { status: "paused" });
        return;
      }
      
      const worldBible = await storage.createWorldBible({
        projectId: project.id,
        timeline: this.convertTimeline(worldBibleData),
        characters: this.convertCharacters(worldBibleData),
        worldRules: this.convertWorldRules(worldBibleData),
        plotOutline: this.convertPlotOutline(worldBibleData),
      });

      // Verify World Bible was saved correctly before proceeding
      const MAX_VERIFY_ATTEMPTS = 5;
      let verifyAttempt = 0;
      let worldBibleVerified = false;
      
      while (verifyAttempt < MAX_VERIFY_ATTEMPTS) {
        const savedWorldBible = await storage.getWorldBibleByProject(project.id);
        const hasData = savedWorldBible && (
          ((savedWorldBible.timeline as any[]) || []).length > 0 ||
          ((savedWorldBible.characters as any[]) || []).length > 0 ||
          (savedWorldBible.plotOutline && Object.keys(savedWorldBible.plotOutline as object).length > 0)
        );
        
        if (hasData) {
          console.log(`[Orchestrator] World Bible verified: ${((savedWorldBible.characters as any[]) || []).length} characters, ${((savedWorldBible.timeline as any[]) || []).length} timeline events`);
          worldBibleVerified = true;
          break;
        }
        
        verifyAttempt++;
        console.warn(`[Orchestrator] World Bible verification attempt ${verifyAttempt}/${MAX_VERIFY_ATTEMPTS}: data not yet available`);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      
      if (!worldBibleVerified) {
        const errorMsg = "La biblia del mundo no se guardó correctamente. Intente de nuevo.";
        console.error(`[Orchestrator] CRITICAL: World Bible verification failed after ${MAX_VERIFY_ATTEMPTS} attempts`);
        this.callbacks.onError(errorMsg);
        await storage.updateProject(project.id, { status: "error" });
        return;
      }

      this.callbacks.onAgentStatus("architect", "completed", "Estructura narrativa completada");

      const allSections = this.buildSectionsList(project, worldBibleData);
      const chapters: Chapter[] = [];
      
      // CRITICAL: Re-check for existing chapters right before creation to prevent race conditions
      const existingChaptersBeforeCreate = await storage.getChaptersByProject(project.id);
      if (existingChaptersBeforeCreate.length > 0) {
        console.log(`[Orchestrator] DUPLICATE PREVENTION: Found ${existingChaptersBeforeCreate.length} chapters created during architect phase. Using existing chapters.`);
        await storage.createActivityLog({
          projectId: project.id,
          level: "warn",
          message: `Detectados ${existingChaptersBeforeCreate.length} capítulos durante fase de arquitecto. Usando capítulos existentes para evitar duplicados.`,
          agentRole: "orchestrator",
        });
        // Sort by chapter number and use existing chapters
        const sortedExisting = existingChaptersBeforeCreate.sort((a, b) => a.chapterNumber - b.chapterNumber);
        chapters.push(...sortedExisting);
      } else {
        // Create chapters only if none exist
        for (let i = 0; i < allSections.length; i++) {
          const section = allSections[i];
          
          // Double-check this specific chapter doesn't exist (belt-and-suspenders approach)
          const existingForNumber = await storage.getChaptersByProject(project.id);
          const alreadyExists = existingForNumber.find(c => c.chapterNumber === section.numero);
          
          if (alreadyExists) {
            console.log(`[Orchestrator] DUPLICATE PREVENTION: Chapter ${section.numero} already exists (id=${alreadyExists.id}). Skipping creation.`);
            chapters.push(alreadyExists);
            continue;
          }
          
          const chapter = await storage.createChapter({
            projectId: project.id,
            chapterNumber: section.numero,
            title: section.titulo,
            status: "pending",
          });
          chapters.push(chapter);
        }
      }

      let previousContinuity = "";
      let previousContinuityStateForEditor: any = null;
      let accumulatedContinuityIssues: string[] = [];
      
      const baseStyleGuide = `Género: ${project.genre}, Tono: ${project.tone}`;
      const fullStyleGuide = styleGuideContent 
        ? `${baseStyleGuide}\n\n--- GUÍA DE ESTILO DEL AUTOR ---\n${styleGuideContent}`
        : baseStyleGuide;

      for (let i = 0; i < chapters.length; i++) {
        if (await isProjectCancelledFromDb(project.id)) {
          console.log(`[Orchestrator] Project ${project.id} cancelled before chapter ${i + 1}. Stopping.`);
          await storage.createActivityLog({
            projectId: project.id,
            level: "info",
            message: `Generación detenida por el usuario antes del capítulo ${i + 1}`,
            agentRole: "orchestrator",
          });
          return;
        }

        const chapter = chapters[i];
        const sectionData = allSections[i];

        await storage.updateChapter(chapter.id, { status: "writing" });
        this.callbacks.onChapterStatusChange(sectionData.numero, "writing");
        await storage.updateProject(project.id, { currentChapter: i + 1 });

        const sectionLabel = this.getSectionLabel(sectionData);
        this.callbacks.onAgentStatus("ghostwriter", "writing", `El Narrador está escribiendo ${sectionLabel}...`);

        let chapterContent = "";
        let approved = false;
        let refinementAttempts = 0;
        let refinementInstructions = "";

        let extractedContinuityState: any = null;
        
        let bestVersion = { content: "", score: 0, continuityState: null as any };
        
        while (!approved && refinementAttempts < this.maxRefinementLoops) {
          const baseStyleGuide = `Género: ${project.genre}, Tono: ${project.tone}`;
          const fullStyleGuide = styleGuideContent 
            ? `${baseStyleGuide}\n\n--- GUÍA DE ESTILO DEL AUTOR ---\n${styleGuideContent}`
            : baseStyleGuide;

          const { context: slidingContext, characterStates } = this.buildSlidingContextWindow(chapters, i, allSections);
          const optimizedContinuity = slidingContext || previousContinuity;

          const isRewrite = refinementAttempts > 0;
          // Use per-chapter limits if set, otherwise calculate from total novel target
          // SPECIAL: Author's Note has different word limits (800-1200 words)
          const isAuthorNote = sectionData.tipo === "author_note" || sectionData.numero === -2;
          const projectMinPerChapter = (project as any).minWordsPerChapter;
          const projectMaxPerChapter = (project as any).maxWordsPerChapter;
          const totalNovelTarget = (project as any).minWordCount;
          const perChapterTarget = isAuthorNote ? 800 : (projectMinPerChapter || this.calculatePerChapterTarget(totalNovelTarget, allSections.length));
          const perChapterMax = isAuthorNote ? 1200 : (projectMaxPerChapter || Math.round(perChapterTarget * 1.15));
          const writerResult = await this.ghostwriter.execute({
            chapterNumber: sectionData.numero,
            chapterData: sectionData,
            worldBible: worldBibleData.world_bible,
            guiaEstilo: fullStyleGuide,
            previousContinuity: optimizedContinuity,
            refinementInstructions,
            authorName,
            isRewrite,
            minWordCount: perChapterTarget,
            maxWordCount: perChapterMax,
            extendedGuideContent: extendedGuideContent || undefined,
            previousChapterContent: isRewrite ? bestVersion.content : undefined,
            kindleUnlimitedOptimized: (project as any).kindleUnlimitedOptimized || false,
          });

          // CRITICAL: Validate that content exists before processing
          if (!writerResult.content || writerResult.content.trim().length === 0) {
            console.error(`[Orchestrator] CRITICAL: Ghostwriter returned NULL/EMPTY content for ${sectionLabel}. Retrying...`);
            this.callbacks.onAgentStatus("ghostwriter", "error", 
              `${sectionLabel} vacío. La IA no devolvió contenido. Reintentando...`
            );
            refinementAttempts++;
            refinementInstructions = `CRÍTICO: Tu respuesta anterior estaba VACÍA. DEBES escribir el capítulo COMPLETO. NO devuelvas una respuesta vacía.`;
            await new Promise(resolve => setTimeout(resolve, 10000));
            continue;
          }

          const { cleanContent, continuityState } = this.ghostwriter.extractContinuityState(writerResult.content);
          let currentContent = cleanContent;
          const currentContinuityState = continuityState;
          
          // CRITICAL: Double-check after extraction that content is not empty
          if (!currentContent || currentContent.trim().length === 0) {
            console.error(`[Orchestrator] CRITICAL: Content extraction resulted in EMPTY content for ${sectionLabel}. Retrying...`);
            this.callbacks.onAgentStatus("ghostwriter", "error", 
              `${sectionLabel} vacío tras extracción. Reintentando...`
            );
            refinementAttempts++;
            refinementInstructions = `CRÍTICO: Tu respuesta contenía solo metadatos sin contenido narrativo. DEBES escribir el capítulo COMPLETO con prosa narrativa.`;
            await new Promise(resolve => setTimeout(resolve, 10000));
            continue;
          }
          
          // Validate word count with user-defined min/max per chapter
          const ABSOLUTE_MIN = 500; // Detect severe truncation
          const TARGET_MIN = perChapterTarget; // Use project's minWordsPerChapter
          const TARGET_MAX = perChapterMax; // Use project's maxWordsPerChapter
          const contentWordCount = currentContent.split(/\s+/).filter((w: string) => w.length > 0).length;
          
          // Check for severe truncation (less than 500 words)
          if (contentWordCount < ABSOLUTE_MIN) {
            console.warn(`[Orchestrator] Capítulo severamente truncado: ${contentWordCount} palabras < ${ABSOLUTE_MIN}. Reintentando...`);
            this.callbacks.onAgentStatus("ghostwriter", "warning", 
              `${sectionLabel} truncado (${contentWordCount} palabras). Reintentando...`
            );
            refinementAttempts++;
            refinementInstructions = `CRÍTICO: Tu respuesta fue TRUNCADA con solo ${contentWordCount} palabras. DEBES escribir el capítulo COMPLETO con ${TARGET_MIN}-${TARGET_MAX} palabras.`;
            await new Promise(resolve => setTimeout(resolve, 10000));
            continue;
          }
          
          // Check if it meets the target minimum (with 15% margin) - retry with increasingly urgent prompts
          if (contentWordCount < TARGET_MIN) {
            // If we still have retry attempts, try again
            if (refinementAttempts < this.maxRefinementLoops - 1) {
              console.warn(`[Orchestrator] Capítulo corto: ${contentWordCount} palabras < ${TARGET_MIN} objetivo. Reintentando...`);
              this.callbacks.onAgentStatus("ghostwriter", "warning", 
                `${sectionLabel} muy corto (${contentWordCount}/${TARGET_MIN}-${TARGET_MAX} palabras). Expandiendo...`
              );
              refinementAttempts++;
              refinementInstructions = `CRÍTICO: Tu capítulo tiene solo ${contentWordCount} palabras pero el rango aceptable es ${TARGET_MIN}-${TARGET_MAX} palabras. DEBES expandir cada beat con más descripciones sensoriales, diálogos extensos y monólogo interno. NO resumas - NARRA cada momento con detalle.`;
              await new Promise(resolve => setTimeout(resolve, 10000));
              continue;
            } else {
              // Final attempt exhausted - save content but mark as needs_expansion
              console.warn(`[Orchestrator] ⚠️ CAPÍTULO CORTO: ${sectionLabel} tiene ${contentWordCount}/${TARGET_MIN}-${TARGET_MAX} palabras. Marcando para expansión.`);
              this.callbacks.onAgentStatus("ghostwriter", "warning", 
                `${sectionLabel} guardado con ${contentWordCount} palabras (objetivo: ${TARGET_MIN}-${TARGET_MAX}). Requiere expansión.`
              );
              
              // Track token usage even for short chapters
              await this.trackTokenUsage(project.id, writerResult.tokenUsage, "El Narrador", "gemini-3-pro-preview", sectionData.numero, "chapter_write_short");
              
              if (writerResult.thoughtSignature) {
                await storage.createThoughtLog({
                  projectId: project.id,
                  chapterId: chapter.id,
                  agentName: "El Narrador",
                  agentRole: "ghostwriter",
                  thoughtContent: writerResult.thoughtSignature,
                });
              }
              
              // Mark chapter as needing expansion - will be handled specially
              await storage.updateChapter(chapter.id, {
                content: currentContent,
                wordCount: contentWordCount,
                status: "needs_expansion",
                needsRevision: true,
                revisionReason: `Capítulo corto: ${contentWordCount}/${TARGET_MIN}-${TARGET_MAX} palabras después de ${refinementAttempts + 1} intentos`
              });
              
              // Emit chapter status change callback
              this.callbacks.onChapterStatusChange(sectionData.numero, "needs_expansion");
              
              continue; // Skip to next chapter without editor pass
            }
          }
          
          await this.trackTokenUsage(project.id, writerResult.tokenUsage, "El Narrador", "gemini-3-pro-preview", sectionData.numero, "chapter_write");

          if (writerResult.thoughtSignature) {
            await storage.createThoughtLog({
              projectId: project.id,
              chapterId: chapter.id,
              agentName: "El Narrador",
              agentRole: "ghostwriter",
              thoughtContent: writerResult.thoughtSignature,
            });
          }

          // IMMEDIATE CONTINUITY VALIDATION - Check before sending to Editor
          if (characterStates.size > 0) {
            const continuityCheck = this.validateImmediateContinuity(currentContent, characterStates, worldBibleData.world_bible);
            
            if (!continuityCheck.valid) {
              console.warn(`[Orchestrator] VIOLACIÓN DE CONTINUIDAD detectada en ${sectionLabel}:`, continuityCheck.violations);
              this.callbacks.onAgentStatus("ghostwriter", "warning", 
                `${sectionLabel} tiene ${continuityCheck.violations.length} violación(es) de continuidad. Corrigiendo...`
              );
              
              // Force a rewrite with specific continuity fix instructions
              refinementAttempts++;
              refinementInstructions = `🚨 VIOLACIÓN DE CONTINUIDAD CRÍTICA 🚨\n\nTu capítulo contiene los siguientes errores que DEBEN corregirse:\n\n${continuityCheck.violations.map((v, idx) => `${idx + 1}. ${v}`).join("\n\n")}\n\nReescribe el capítulo CORRIGIENDO estos errores. El resto del contenido está bien, solo corrige las violaciones de continuidad.`;
              await new Promise(resolve => setTimeout(resolve, 5000));
              continue;
            }
          }

          await storage.updateChapter(chapter.id, { status: "editing" });
          this.callbacks.onAgentStatus("editor", "editing", `El Editor está revisando ${sectionLabel}...`);

          const editorResult = await this.editor.execute({
            chapterNumber: sectionData.numero,
            chapterContent: currentContent,
            chapterData: sectionData,
            worldBible: worldBibleData.world_bible,
            guiaEstilo: `Género: ${project.genre}, Tono: ${project.tone}`,
            previousContinuityState: previousContinuityStateForEditor,
          });

          await this.trackTokenUsage(project.id, editorResult.tokenUsage, "El Editor", "gemini-3-pro-preview", sectionData.numero, "chapter_edit");

          if (editorResult.thoughtSignature) {
            await storage.createThoughtLog({
              projectId: project.id,
              chapterId: chapter.id,
              agentName: "El Editor",
              agentRole: "editor",
              thoughtContent: editorResult.thoughtSignature,
            });
          }

          const currentScore = editorResult.result?.puntuacion || 0;
          
          if (currentScore >= bestVersion.score) {
            bestVersion = { 
              content: currentContent, 
              score: currentScore, 
              continuityState: currentContinuityState 
            };
            console.log(`[Orchestrator] New best version for ${sectionLabel}: ${currentScore}/10`);
          } else {
            console.log(`[Orchestrator] Keeping previous best version (${bestVersion.score}/10) over current (${currentScore}/10)`);
          }

          if (editorResult.result?.aprobado) {
            approved = true;
            this.callbacks.onAgentStatus("editor", "completed", `${sectionLabel} aprobado (${currentScore}/10)`);
          } else {
            refinementAttempts++;
            
            refinementInstructions = this.buildRefinementInstructions(editorResult.result);
            
            // LOG REJECTION PATTERN FOR POST-FIRST-REWRITE ANALYSIS
            if (refinementAttempts >= 2 && editorResult.result) {
              const diagnosis = editorResult.result.plan_quirurgico;
              console.log(`\n${'='.repeat(80)}`);
              console.log(`[REJECTION PATTERN DETECTED] ${sectionLabel} - Attempt ${refinementAttempts}/${this.maxRefinementLoops}`);
              console.log(`Project: ${project.title} (ID: ${project.id})`);
              console.log(`Genre: ${project.genre}`);
              console.log(`Score: ${currentScore}/10`);
              console.log(`Diagnosis: ${diagnosis?.diagnostico || 'N/A'}`);
              console.log(`Procedure: ${diagnosis?.procedimiento || 'N/A'}`);
              console.log(`Objective: ${diagnosis?.objetivo || 'N/A'}`);
              console.log(`${'='.repeat(80)}\n`);
            }
            
            this.callbacks.onAgentStatus("editor", "editing", 
              `${sectionLabel} rechazado (${currentScore}/10). Mejor: ${bestVersion.score}/10. Intento ${refinementAttempts}/${this.maxRefinementLoops}.`
            );

            if (refinementAttempts < this.maxRefinementLoops) {
              this.callbacks.onAgentStatus("ghostwriter", "writing", 
                `El Narrador está reescribiendo ${sectionLabel} siguiendo el Plan Quirúrgico...`
              );
            }
          }
        }
        
        chapterContent = bestVersion.content;
        extractedContinuityState = bestVersion.continuityState;
        console.log(`[Orchestrator] Using best version for ${sectionLabel}: ${bestVersion.score}/10`);

        this.callbacks.onAgentStatus("copyeditor", "polishing", `El Estilista está puliendo ${sectionLabel}...`);

        const polishResult = await this.copyeditor.execute({
          chapterContent,
          chapterNumber: sectionData.numero,
          chapterTitle: sectionData.titulo,
          guiaEstilo: styleGuideContent || undefined,
        });

        await this.trackTokenUsage(project.id, polishResult.tokenUsage, "El Estilista", "gemini-3-pro-preview", sectionData.numero, "polish");

        if (polishResult.thoughtSignature) {
          await storage.createThoughtLog({
            projectId: project.id,
            chapterId: chapter.id,
            agentName: "El Estilista",
            agentRole: "copyeditor",
            thoughtContent: polishResult.thoughtSignature,
          });
        }

        const finalContent = polishResult.result?.texto_final || chapterContent;
        const wordCount = finalContent.split(/\s+/).length;

        await storage.updateChapter(chapter.id, {
          content: finalContent,
          wordCount,
          status: "completed",
          continuityState: extractedContinuityState,
        });

        if (extractedContinuityState) {
          previousContinuity = JSON.stringify(extractedContinuityState);
          previousContinuityStateForEditor = extractedContinuityState;
          console.log(`[Orchestrator] Passing continuity state to next chapter: ${Object.keys(extractedContinuityState.characterStates || {}).length} characters tracked`);
        } else {
          previousContinuity = sectionData.continuidad_salida || 
            `${sectionLabel} completado. Los personajes terminaron en: ${sectionData.ubicacion}`;
          previousContinuityStateForEditor = null;
        }

        this.callbacks.onChapterComplete(i + 1, wordCount, sectionData.titulo);
        this.callbacks.onAgentStatus("copyeditor", "completed", `${sectionLabel} finalizado (${wordCount} palabras)`);

        await this.updateWorldBibleTimeline(project.id, worldBible.id, sectionData.numero, sectionData);
        
        const completedChaptersCount = i + 1;
        if (completedChaptersCount > 0 && completedChaptersCount % this.continuityCheckpointInterval === 0) {
          const completedChaptersForCheckpoint = await storage.getChaptersByProject(project.id);
          const chaptersInScope = completedChaptersForCheckpoint
            .filter(c => c.status === "completed" && c.chapterNumber > 0)
            .sort((a, b) => a.chapterNumber - b.chapterNumber)
            .slice(-this.continuityCheckpointInterval);
          
          if (chaptersInScope.length >= this.continuityCheckpointInterval) {
            const checkpointNumber = Math.floor(completedChaptersCount / this.continuityCheckpointInterval);
            const checkpointResult = await this.runContinuityCheckpoint(
              project,
              checkpointNumber,
              chaptersInScope,
              worldBibleData,
              accumulatedContinuityIssues
            );
            
            if (!checkpointResult.passed && checkpointResult.chaptersToRevise.length > 0) {
              accumulatedContinuityIssues = [...accumulatedContinuityIssues, ...checkpointResult.issues];
              
              const hasSignificantIssues = checkpointResult.issues.some(issue => 
                issue.includes("[CRITICA]") || issue.includes("[CRÍTICA]") ||
                issue.includes("[MAYOR]") || issue.includes("[mayor]")
              );
              
              if (hasSignificantIssues) {
                this.callbacks.onAgentStatus("continuity-sentinel", "editing", 
                  `Disparando correcciones para ${checkpointResult.chaptersToRevise.length} capítulos con errores detectados`
                );
                
                for (let idx = 0; idx < checkpointResult.chaptersToRevise.length; idx++) {
                  // Check cancellation before each chapter correction
                  if (await isProjectCancelledFromDb(project.id)) {
                    console.log(`[Orchestrator] Continuity corrections cancelled at chapter ${idx + 1}/${checkpointResult.chaptersToRevise.length}`);
                    return;
                  }
                  
                  const chapterNum = checkpointResult.chaptersToRevise[idx];
                  const chapterToFix = chaptersInScope.find(c => c.chapterNumber === chapterNum);
                  const sectionForFix = allSections.find(s => s.numero === chapterNum);
                  
                  if (chapterToFix && sectionForFix) {
                    this.callbacks.onAgentStatus("continuity-sentinel", "editing", 
                      `Corrigiendo capítulo ${chapterNum} (${idx + 1}/${checkpointResult.chaptersToRevise.length})`
                    );
                    
                    const issuesForChapter = checkpointResult.issues.filter(issue => 
                      issue.includes(`capítulo ${chapterNum}`) || issue.includes(`Cap ${chapterNum}`)
                    ).join("\n");
                    
                    await this.rewriteChapterForQA(
                      project,
                      chapterToFix,
                      sectionForFix,
                      worldBibleData,
                      fullStyleGuide,
                      "continuity",
                      issuesForChapter || checkpointResult.issues.join("\n")
                    );
                  }
                }
                
                this.callbacks.onAgentStatus("continuity-sentinel", "completed", 
                  `Correcciones de continuidad completadas para ${checkpointResult.chaptersToRevise.length} capítulos`
                );
              }
            }
          }
        }
      }

      // QA: Voice & Rhythm Auditor - SKIP if already completed OR in final review phase to prevent cost inflation
      const projectStateForVoice = await storage.getProject(project.id);
      const skipVoiceAudit = (projectStateForVoice?.revisionCycle || 0) > 0 || 
                             (projectStateForVoice as any)?.voiceAuditCompleted === true;
      
      if (skipVoiceAudit) {
        this.callbacks.onAgentStatus("voice-auditor", "skipped", 
          `Auditor de voz omitido - ${(projectStateForVoice as any)?.voiceAuditCompleted ? 'ya completado previamente' : 'proyecto en fase de revisión'}`
        );
        console.log(`[Orchestrator] Skipping voice auditor for project ${project.id} - voiceAuditCompleted=${(projectStateForVoice as any)?.voiceAuditCompleted}, revisionCycle=${projectStateForVoice?.revisionCycle}`);
      } else {
        // CRITICAL: Mark voice audit complete IMMEDIATELY BEFORE any analysis to prevent infinite loops on freeze
        await storage.updateProject(project.id, { voiceAuditCompleted: true } as any);
        console.log(`[Orchestrator:generateNovel] Voice audit marked complete IMMEDIATELY for project ${project.id} - prevents re-runs on freeze`);
        
        const allCompletedChapters = await storage.getChaptersByProject(project.id);
        const completedForAnalysis = allCompletedChapters.filter(c => c.status === "completed" && c.content);
        
        if (completedForAnalysis.length >= 5) {
          const trancheSize = 10;
          const totalTranches = Math.ceil(completedForAnalysis.length / trancheSize);
          
          for (let t = 0; t < totalTranches; t++) {
            const trancheChapters = completedForAnalysis.slice(t * trancheSize, (t + 1) * trancheSize);
            if (trancheChapters.length > 0) {
              const voiceResult = await this.runVoiceRhythmAudit(project, t + 1, trancheChapters, styleGuideContent);
              
              if (!voiceResult.passed && voiceResult.chaptersToRevise.length > 0) {
                this.callbacks.onAgentStatus("voice-auditor", "editing", 
                  `Puliendo ${voiceResult.chaptersToRevise.length} capítulos con problemas de voz/ritmo`
                );
                
                for (let idx = 0; idx < voiceResult.chaptersToRevise.length; idx++) {
                  // Check cancellation before each chapter correction
                  if (await isProjectCancelledFromDb(project.id)) {
                    console.log(`[Orchestrator] Voice corrections cancelled at chapter ${idx + 1}/${voiceResult.chaptersToRevise.length} (generateNovel)`);
                    return;
                  }
                  
                  const chapterNum = voiceResult.chaptersToRevise[idx];
                  const chapterToPolish = trancheChapters.find(c => c.chapterNumber === chapterNum);
                  if (chapterToPolish) {
                    this.callbacks.onAgentStatus("voice-auditor", "editing", 
                      `Puliendo capítulo ${chapterNum} (${idx + 1}/${voiceResult.chaptersToRevise.length})`
                    );
                    
                    const issuesForChapter = voiceResult.issues.filter(issue => 
                      issue.includes(`capítulo ${chapterNum}`) || issue.includes(`Cap ${chapterNum}`)
                    ).join("\n");
                    
                    await this.polishChapterForVoice(
                      project,
                      chapterToPolish,
                      styleGuideContent,
                      issuesForChapter || voiceResult.issues.join("\n")
                    );
                  }
                }
                
                this.callbacks.onAgentStatus("voice-auditor", "completed", 
                  `Correcciones de voz/ritmo completadas para ${voiceResult.chaptersToRevise.length} capítulos`
                );
              }
            }
          }
        }
      }

      // QA: Semantic Repetition Detector - SKIP if already completed OR in final review phase to prevent cost inflation
      // MAX 2 attempts to fix semantic issues, then accept with warnings
      const currentProjectState = await storage.getProject(project.id);
      const skipSemanticDetectorGen = (currentProjectState?.revisionCycle || 0) > 0 || 
                                      (currentProjectState as any)?.semanticCheckCompleted === true;
      const MAX_SEMANTIC_ATTEMPTS = 2;
      
      if (skipSemanticDetectorGen) {
        this.callbacks.onAgentStatus("semantic-detector", "skipped", 
          `Detector semántico omitido - ${(currentProjectState as any)?.semanticCheckCompleted ? 'ya completado previamente' : 'proyecto en fase de revisión'}`
        );
        console.log(`[Orchestrator] Skipping semantic detector for project ${project.id} - semanticCheckCompleted=${(currentProjectState as any)?.semanticCheckCompleted}, revisionCycle=${currentProjectState?.revisionCycle}`);
      } else {
        // CRITICAL: Mark semantic check complete IMMEDIATELY to prevent infinite loops on freeze
        await storage.updateProject(project.id, { semanticCheckCompleted: true } as any);
        console.log(`[Orchestrator:generateNovel] Semantic check marked complete IMMEDIATELY for project ${project.id} - prevents re-runs on freeze`);
        
        let semanticAttempt = 0;
        let semanticPassed = false;
        let semanticActuallyRan = false;
        
        while (semanticAttempt < MAX_SEMANTIC_ATTEMPTS && !semanticPassed) {
          // Check cancellation at start of each semantic attempt
          if (await isProjectCancelledFromDb(project.id)) {
            console.log(`[Orchestrator] Semantic detector cancelled for project ${project.id}`);
            return;
          }
          
          semanticAttempt++;
          
          const refreshedChaptersForSemantic = await storage.getChaptersByProject(project.id);
          const completedForSemanticAnalysis = refreshedChaptersForSemantic.filter(c => c.status === "completed" && c.content);

          if (completedForSemanticAnalysis.length === 0) break;
          
          semanticActuallyRan = true; // Mark that we actually ran the detector
          this.callbacks.onAgentStatus("semantic-detector", "analyzing", 
            `Análisis semántico (intento ${semanticAttempt}/${MAX_SEMANTIC_ATTEMPTS})...`
          );
          
          const semanticResult = await this.runSemanticRepetitionAnalysis(project, completedForSemanticAnalysis, worldBibleData);
          
          if (semanticResult.passed) {
            semanticPassed = true;
            console.log(`[Orchestrator] Semantic check PASSED for project ${project.id}`);
            this.callbacks.onAgentStatus("semantic-detector", "complete", 
              `Análisis semántico aprobado`
            );
            break;
          }
          
          if (semanticAttempt >= MAX_SEMANTIC_ATTEMPTS) {
            // Mark completed even at max attempts to prevent re-running
            await storage.updateProject(project.id, { semanticCheckCompleted: true } as any);
            console.log(`[Orchestrator] Semantic check max attempts reached, marking as completed for project ${project.id}`);
            this.callbacks.onAgentStatus("semantic-detector", "warning", 
              `Máximo de intentos alcanzado. Continuando con observaciones menores.`
            );
            break;
          }
          
          if (semanticResult.chaptersToRevise.length > 0) {
            // Mark as completed BEFORE starting corrections to prevent re-running on interruption
            await storage.updateProject(project.id, { semanticCheckCompleted: true } as any);
            console.log(`[Orchestrator] Semantic check marked complete BEFORE corrections for project ${project.id}`);
            
            this.callbacks.onAgentStatus("semantic-detector", "editing", 
              `Corrigiendo ${semanticResult.chaptersToRevise.length} capítulos (intento ${semanticAttempt})`
            );
            
            for (let i = 0; i < semanticResult.chaptersToRevise.length; i++) {
              // Check cancellation before each chapter correction
              if (await isProjectCancelledFromDb(project.id)) {
                console.log(`[Orchestrator] Semantic corrections cancelled at chapter ${i + 1}/${semanticResult.chaptersToRevise.length}`);
                return;
              }
              
              const chapterNum = semanticResult.chaptersToRevise[i];
              const chapterToFix = completedForSemanticAnalysis.find(c => c.chapterNumber === chapterNum);
              const sectionForFix = allSections.find((s: any) => s.numero === chapterNum);
              
              if (chapterToFix && sectionForFix) {
                const freshChapter = await storage.getChaptersByProject(project.id)
                  .then(chs => chs.find(c => c.chapterNumber === chapterNum));
                if (!freshChapter) continue;
                
                this.callbacks.onAgentStatus("semantic-detector", "editing", 
                  `Corrigiendo capítulo ${chapterNum} (${i + 1}/${semanticResult.chaptersToRevise.length})`
                );
                
                const clusterIssues = semanticResult.clusters
                  .filter(c => c.capitulos_afectados?.includes(chapterNum))
                  .map(c => `Repetición de idea: "${c.descripcion}"\n⚠️ PRESERVAR: ${c.elementos_a_preservar || "El resto del capítulo"}\n✏️ CORRECCIÓN: ${c.fix_sugerido}`)
                  .join("\n\n");
                
                const foreshadowingIssues = semanticResult.foreshadowingStatus
                  .filter(f => f.estado === "sin_payoff")
                  .map(f => `Foreshadowing sin resolver: "${f.setup}" (plantado en cap ${f.capitulo_setup}) - DEBES resolverlo en este capítulo o eliminarlo`)
                  .join("\n");
                
                const allIssues = [clusterIssues, foreshadowingIssues].filter(Boolean).join("\n\n");
                
                if (allIssues) {
                  await this.rewriteChapterForQA(
                    project,
                    freshChapter,
                    sectionForFix,
                    worldBibleData,
                    fullStyleGuide,
                    "semantic",
                    allIssues
                  );
                }
              }
            }
            
            this.callbacks.onAgentStatus("semantic-detector", "completed", 
              `Correcciones semánticas completadas para ${semanticResult.chaptersToRevise.length} capítulos`
            );
            // Break after corrections - don't re-analyze (semanticCheckCompleted already true)
            break;
          }
        }
      }

      const finalReviewApproved = await this.runFinalReview(
        project, 
        chapters, 
        worldBibleData, 
        fullStyleGuide, 
        allSections,
        styleGuideContent,
        authorName
      );

      if (finalReviewApproved) {
        await storage.updateProject(project.id, { status: "completed" });
        this.callbacks.onProjectComplete();
      } else {
        await storage.updateProject(project.id, { status: "failed_final_review" });
        this.callbacks.onError("El manuscrito no pasó la revisión final después de múltiples intentos.");
      }

    } catch (error) {
      console.error("[Orchestrator] Error:", error);
      await storage.updateProject(project.id, { status: "error" });
      this.callbacks.onError(error instanceof Error ? error.message : "Error desconocido");
    }
  }

  async resumeNovel(project: Project): Promise<void> {
    try {
      const existingTokens = {
        inputTokens: project.totalInputTokens || 0,
        outputTokens: project.totalOutputTokens || 0,
        thinkingTokens: project.totalThinkingTokens || 0,
      };
      this.cumulativeTokens = existingTokens;
      
      await storage.updateProject(project.id, { status: "generating" });

      const worldBible = await storage.getWorldBibleByProject(project.id);
      if (!worldBible) {
        this.callbacks.onError("No se encontró el World Bible del proyecto. Debe iniciar una nueva generación.");
        await storage.updateProject(project.id, { status: "error" });
        return;
      }

      const existingChapters = await storage.getChaptersByProject(project.id);
      if (existingChapters.length === 0) {
        this.callbacks.onError("No se encontraron capítulos. Debe iniciar una nueva generación.");
        await storage.updateProject(project.id, { status: "error" });
        return;
      }

      let styleGuideContent = "";
      let authorName = "";
      let extendedGuideContent = "";
      
      if (project.styleGuideId) {
        const styleGuide = await storage.getStyleGuide(project.styleGuideId);
        if (styleGuide) styleGuideContent = styleGuide.content;
      }
      
      if (project.pseudonymId) {
        const pseudonym = await storage.getPseudonym(project.pseudonymId);
        if (pseudonym) authorName = pseudonym.name;
      }

      if ((project as any).extendedGuideId) {
        const extendedGuide = await storage.getExtendedGuide((project as any).extendedGuideId);
        if (extendedGuide) {
          extendedGuideContent = extendedGuide.content;
          console.log(`[Orchestrator:Resume] Using extended guide: "${extendedGuide.title}"`);
        }
      }

      const pendingChapters = existingChapters
        .filter(c => c.status !== "completed")
        .sort((a, b) => {
          const orderA = a.chapterNumber === 0 ? -1000 : a.chapterNumber === -1 ? 1000 : a.chapterNumber === -2 ? 1001 : a.chapterNumber;
          const orderB = b.chapterNumber === 0 ? -1000 : b.chapterNumber === -1 ? 1000 : b.chapterNumber === -2 ? 1001 : b.chapterNumber;
          return orderA - orderB;
        });

      if (pendingChapters.length === 0) {
        this.callbacks.onAgentStatus("orchestrator", "completed", "Todos los capítulos ya están completados.");
        await storage.updateProject(project.id, { status: "completed" });
        this.callbacks.onProjectComplete();
        return;
      }

      const completedChapters = existingChapters.filter(c => c.status === "completed");
      const lastCompleted = completedChapters.length > 0 
        ? completedChapters.sort((a, b) => b.chapterNumber - a.chapterNumber)[0]
        : null;
      
      let previousContinuity = lastCompleted?.continuityState 
        ? JSON.stringify(lastCompleted.continuityState)
        : lastCompleted?.content 
          ? `Capítulo anterior completado. Contenido termina con: ${lastCompleted.content.slice(-500)}`
          : "";
      
      let previousContinuityStateForEditor: any = lastCompleted?.continuityState || null;

      this.callbacks.onAgentStatus("orchestrator", "resuming", 
        `Retomando generación. ${pendingChapters.length} capítulos pendientes de ${existingChapters.length} totales.`
      );

      const worldBibleData = this.reconstructWorldBibleData(worldBible, project);
      
      // Initialize characterStates for continuity validation
      const characterStates: Map<string, { alive: boolean; location: string; injuries: string[]; lastSeen: number }> = new Map();

      for (const chapter of pendingChapters) {
        const sectionData = this.buildSectionDataFromChapter(chapter, worldBibleData);
        const sectionLabel = this.getSectionLabel(sectionData);
        
        // RESUME FIX: Check if chapter already has content (was interrupted during editing)
        // If it has content, skip writing phase and go directly to editing
        const hasExistingContent = chapter.content && chapter.content.trim().length > 100;
        
        if (hasExistingContent && chapter.status === "editing") {
          console.log(`[Orchestrator:Resume] Chapter ${chapter.chapterNumber} already has content (${chapter.wordCount} words) and was in editing. Skipping to completion.`);
          
          // Mark as completed since it was already edited
          await storage.updateChapter(chapter.id, { status: "completed" });
          this.callbacks.onChapterStatusChange(chapter.chapterNumber, "completed");
          this.callbacks.onAgentStatus("orchestrator", "resuming", 
            `${sectionLabel} ya tenía contenido editado. Marcado como completado.`
          );
          
          // Update continuity for next chapter
          previousContinuity = chapter.continuityState 
            ? JSON.stringify(chapter.continuityState)
            : `Capítulo anterior completado. Contenido termina con: ${chapter.content!.slice(-500)}`;
          previousContinuityStateForEditor = chapter.continuityState || null;
          
          continue; // Skip to next chapter
        }
        
        // Reset chapters that were left in inconsistent states (editing without content)
        if (chapter.status === "editing" && !hasExistingContent) {
          console.log(`[Orchestrator:Resume] Chapter ${chapter.chapterNumber} was in editing state but has no content. Resetting to write.`);
        }
        
        await storage.updateChapter(chapter.id, { status: "writing" });
        this.callbacks.onChapterStatusChange(chapter.chapterNumber, "writing");

        this.callbacks.onAgentStatus("ghostwriter", "writing", `El Narrador está escribiendo ${sectionLabel}...`);

        let chapterContent = "";
        let approved = false;
        let refinementAttempts = 0;
        let refinementInstructions = "";
        let extractedContinuityState: any = null;
        
        let bestVersion = { content: "", score: 0, continuityState: null as any };

        while (!approved && refinementAttempts < this.maxRefinementLoops) {
          const baseStyleGuide = `Género: ${project.genre}, Tono: ${project.tone}`;
          const fullStyleGuide = styleGuideContent 
            ? `${baseStyleGuide}\n\n--- GUÍA DE ESTILO DEL AUTOR ---\n${styleGuideContent}`
            : baseStyleGuide;

          const isRewrite = refinementAttempts > 0;
          // Use project's per-chapter settings, fallback to calculated from total
          // SPECIAL: Author's Note has different word limits (800-1200 words)
          const isAuthorNoteResume = sectionData.tipo === "author_note" || sectionData.numero === -2;
          const totalChaptersResume = existingChapters.length || project.chapterCount || 1;
          const calculatedTarget = this.calculatePerChapterTarget((project as any).minWordCount, totalChaptersResume);
          const perChapterMinResume = isAuthorNoteResume ? 800 : ((project as any).minWordsPerChapter || calculatedTarget);
          const perChapterMaxResume = isAuthorNoteResume ? 1200 : ((project as any).maxWordsPerChapter || Math.round(perChapterMinResume * 1.15));
          const writerResult = await this.ghostwriter.execute({
            chapterNumber: sectionData.numero,
            chapterData: sectionData,
            worldBible: worldBibleData.world_bible,
            guiaEstilo: fullStyleGuide,
            previousContinuity,
            refinementInstructions,
            authorName,
            isRewrite,
            minWordCount: perChapterMinResume,
            maxWordCount: perChapterMaxResume,
            extendedGuideContent: extendedGuideContent || undefined,
            previousChapterContent: isRewrite ? bestVersion.content : undefined,
            kindleUnlimitedOptimized: (project as any).kindleUnlimitedOptimized || false,
          });

          // CRITICAL: Validate that content exists before processing
          if (!writerResult.content || writerResult.content.trim().length === 0) {
            console.error(`[Orchestrator] CRITICAL: Ghostwriter returned NULL/EMPTY content for ${sectionLabel}. Retrying...`);
            this.callbacks.onAgentStatus("ghostwriter", "error", 
              `${sectionLabel} vacío. La IA no devolvió contenido. Reintentando...`
            );
            refinementAttempts++;
            refinementInstructions = `CRÍTICO: Tu respuesta anterior estaba VACÍA. DEBES escribir el capítulo COMPLETO. NO devuelvas una respuesta vacía.`;
            await new Promise(resolve => setTimeout(resolve, 10000));
            continue;
          }

          const { cleanContent, continuityState } = this.ghostwriter.extractContinuityState(writerResult.content);
          let currentContent = cleanContent;
          const currentContinuityState = continuityState;
          
          // CRITICAL: Double-check after extraction that content is not empty
          if (!currentContent || currentContent.trim().length === 0) {
            console.error(`[Orchestrator] CRITICAL: Content extraction resulted in EMPTY content for ${sectionLabel}. Retrying...`);
            this.callbacks.onAgentStatus("ghostwriter", "error", 
              `${sectionLabel} vacío tras extracción. Reintentando...`
            );
            refinementAttempts++;
            refinementInstructions = `CRÍTICO: Tu respuesta contenía solo metadatos sin contenido narrativo. DEBES escribir el capítulo COMPLETO con prosa narrativa.`;
            await new Promise(resolve => setTimeout(resolve, 10000));
            continue;
          }
          
          // Validate word count with user-defined min/max per chapter
          const ABSOLUTE_MIN = 500; // Detect severe truncation
          const TARGET_MIN = perChapterMinResume; // Use project's minWordsPerChapter
          const TARGET_MAX = perChapterMaxResume; // Use project's maxWordsPerChapter
          const contentWordCount = currentContent.split(/\s+/).filter((w: string) => w.length > 0).length;
          
          // Check for severe truncation (less than 500 words)
          if (contentWordCount < ABSOLUTE_MIN) {
            console.warn(`[Orchestrator] Capítulo severamente truncado: ${contentWordCount} palabras < ${ABSOLUTE_MIN}. Reintentando...`);
            this.callbacks.onAgentStatus("ghostwriter", "warning", 
              `${sectionLabel} truncado (${contentWordCount} palabras). Reintentando...`
            );
            refinementAttempts++;
            refinementInstructions = `CRÍTICO: Tu respuesta fue TRUNCADA con solo ${contentWordCount} palabras. DEBES escribir el capítulo COMPLETO con ${TARGET_MIN}-${TARGET_MAX} palabras.`;
            await new Promise(resolve => setTimeout(resolve, 10000));
            continue;
          }
          
          // Check if it meets the target minimum (with 15% margin) - retry with increasingly urgent prompts
          if (contentWordCount < TARGET_MIN) {
            // If we still have retry attempts, try again
            if (refinementAttempts < this.maxRefinementLoops - 1) {
              console.warn(`[Orchestrator] Capítulo corto: ${contentWordCount} palabras < ${TARGET_MIN} objetivo. Reintentando...`);
              this.callbacks.onAgentStatus("ghostwriter", "warning", 
                `${sectionLabel} muy corto (${contentWordCount}/${TARGET_MIN}-${TARGET_MAX} palabras). Expandiendo...`
              );
              refinementAttempts++;
              refinementInstructions = `CRÍTICO: Tu capítulo tiene solo ${contentWordCount} palabras pero el rango aceptable es ${TARGET_MIN}-${TARGET_MAX} palabras. DEBES expandir cada beat con más descripciones sensoriales, diálogos extensos y monólogo interno. NO resumas - NARRA cada momento con detalle.`;
              await new Promise(resolve => setTimeout(resolve, 10000));
              continue;
            } else {
              // Final attempt exhausted - save content but mark as needs_expansion
              console.warn(`[Orchestrator] ⚠️ CAPÍTULO CORTO: ${sectionLabel} tiene ${contentWordCount}/${TARGET_MIN}-${TARGET_MAX} palabras. Marcando para expansión.`);
              this.callbacks.onAgentStatus("ghostwriter", "warning", 
                `${sectionLabel} guardado con ${contentWordCount} palabras (objetivo: ${TARGET_MIN}-${TARGET_MAX}). Requiere expansión.`
              );
              
              // Track token usage even for short chapters
              await this.trackTokenUsage(project.id, writerResult.tokenUsage, "El Narrador", "gemini-3-pro-preview", sectionData.numero, "chapter_write_short");
              
              if (writerResult.thoughtSignature) {
                await storage.createThoughtLog({
                  projectId: project.id,
                  chapterId: chapter.id,
                  agentName: "El Narrador",
                  agentRole: "ghostwriter",
                  thoughtContent: writerResult.thoughtSignature,
                });
              }
              
              // Mark chapter as needing expansion - will be handled specially
              await storage.updateChapter(chapter.id, {
                content: currentContent,
                wordCount: contentWordCount,
                status: "needs_expansion",
                needsRevision: true,
                revisionReason: `Capítulo corto: ${contentWordCount}/${TARGET_MIN}-${TARGET_MAX} palabras después de ${refinementAttempts + 1} intentos`
              });
              
              // Emit chapter status change callback
              this.callbacks.onChapterStatusChange(sectionData.numero, "needs_expansion");
              
              continue; // Skip to next chapter without editor pass
            }
          }
          
          await this.trackTokenUsage(project.id, writerResult.tokenUsage, "El Narrador", "gemini-3-pro-preview", sectionData.numero, "chapter_write");

          if (writerResult.thoughtSignature) {
            await storage.createThoughtLog({
              projectId: project.id,
              chapterId: chapter.id,
              agentName: "El Narrador",
              agentRole: "ghostwriter",
              thoughtContent: writerResult.thoughtSignature,
            });
          }

          // IMMEDIATE CONTINUITY VALIDATION - Check before sending to Editor
          if (characterStates.size > 0) {
            const continuityCheck = this.validateImmediateContinuity(currentContent, characterStates, worldBibleData.world_bible);
            
            if (!continuityCheck.valid) {
              console.warn(`[Orchestrator] VIOLACIÓN DE CONTINUIDAD detectada en ${sectionLabel}:`, continuityCheck.violations);
              this.callbacks.onAgentStatus("ghostwriter", "warning", 
                `${sectionLabel} tiene ${continuityCheck.violations.length} violación(es) de continuidad. Corrigiendo...`
              );
              
              // Force a rewrite with specific continuity fix instructions
              refinementAttempts++;
              refinementInstructions = `🚨 VIOLACIÓN DE CONTINUIDAD CRÍTICA 🚨\n\nTu capítulo contiene los siguientes errores que DEBEN corregirse:\n\n${continuityCheck.violations.map((v, idx) => `${idx + 1}. ${v}`).join("\n\n")}\n\nReescribe el capítulo CORRIGIENDO estos errores. El resto del contenido está bien, solo corrige las violaciones de continuidad.`;
              await new Promise(resolve => setTimeout(resolve, 5000));
              continue;
            }
          }

          await storage.updateChapter(chapter.id, { status: "editing" });
          this.callbacks.onAgentStatus("editor", "editing", `El Editor está revisando ${sectionLabel}...`);

          const editorResult = await this.editor.execute({
            chapterNumber: sectionData.numero,
            chapterContent: currentContent,
            chapterData: sectionData,
            worldBible: worldBibleData.world_bible,
            guiaEstilo: `Género: ${project.genre}, Tono: ${project.tone}`,
            previousContinuityState: previousContinuityStateForEditor,
          });

          await this.trackTokenUsage(project.id, editorResult.tokenUsage, "El Editor", "gemini-3-pro-preview", sectionData.numero, "chapter_edit");

          if (editorResult.thoughtSignature) {
            await storage.createThoughtLog({
              projectId: project.id,
              chapterId: chapter.id,
              agentName: "El Editor",
              agentRole: "editor",
              thoughtContent: editorResult.thoughtSignature,
            });
          }

          const currentScore = editorResult.result?.puntuacion || 0;
          
          if (currentScore >= bestVersion.score) {
            bestVersion = { 
              content: currentContent, 
              score: currentScore, 
              continuityState: currentContinuityState 
            };
            console.log(`[Orchestrator Resume] New best version for ${sectionLabel}: ${currentScore}/10`);
          } else {
            console.log(`[Orchestrator Resume] Keeping previous best version (${bestVersion.score}/10) over current (${currentScore}/10)`);
          }

          if (editorResult.result?.aprobado) {
            approved = true;
            this.callbacks.onAgentStatus("editor", "completed", `${sectionLabel} aprobado (${currentScore}/10)`);
          } else {
            refinementAttempts++;
            refinementInstructions = this.buildRefinementInstructions(editorResult.result);
            this.callbacks.onAgentStatus("editor", "editing", 
              `${sectionLabel} rechazado (${currentScore}/10). Mejor: ${bestVersion.score}/10. Intento ${refinementAttempts}/${this.maxRefinementLoops}.`
            );
          }
        }
        
        chapterContent = bestVersion.content;
        extractedContinuityState = bestVersion.continuityState;
        console.log(`[Orchestrator Resume] Using best version for ${sectionLabel}: ${bestVersion.score}/10`);

        this.callbacks.onAgentStatus("copyeditor", "polishing", `El Estilista está puliendo ${sectionLabel}...`);

        const polishResult = await this.copyeditor.execute({
          chapterContent,
          chapterNumber: sectionData.numero,
          chapterTitle: sectionData.titulo,
          guiaEstilo: styleGuideContent || undefined,
        });

        await this.trackTokenUsage(project.id, polishResult.tokenUsage, "El Estilista", "gemini-3-pro-preview", sectionData.numero, "polish");

        if (polishResult.thoughtSignature) {
          await storage.createThoughtLog({
            projectId: project.id,
            chapterId: chapter.id,
            agentName: "El Estilista",
            agentRole: "copyeditor",
            thoughtContent: polishResult.thoughtSignature,
          });
        }

        const finalContent = polishResult.result?.texto_final || chapterContent;
        const wordCount = finalContent.split(/\s+/).length;

        await storage.updateChapter(chapter.id, {
          content: finalContent,
          wordCount,
          status: "completed",
          continuityState: extractedContinuityState,
        });

        if (extractedContinuityState) {
          previousContinuity = JSON.stringify(extractedContinuityState);
          previousContinuityStateForEditor = extractedContinuityState;
          console.log(`[Orchestrator Resume] Passing continuity state to next chapter`);
        } else {
          previousContinuity = `${sectionLabel} completado.`;
          previousContinuityStateForEditor = null;
        }

        const freshChapters = await storage.getChaptersByProject(project.id);
        const completedCount = freshChapters.filter(c => c.status === "completed").length;
        this.callbacks.onChapterComplete(completedCount, wordCount, sectionData.titulo);
        this.callbacks.onAgentStatus("copyeditor", "completed", `${sectionLabel} finalizado (${wordCount} palabras)`);

        // QA: Continuity Sentinel checkpoint every 5 chapters
        if (completedCount > 0 && completedCount % this.continuityCheckpointInterval === 0) {
          const chaptersForCheckpoint = freshChapters
            .filter(c => c.status === "completed" && c.chapterNumber > 0)
            .sort((a, b) => a.chapterNumber - b.chapterNumber)
            .slice(-this.continuityCheckpointInterval);
          
          if (chaptersForCheckpoint.length >= this.continuityCheckpointInterval) {
            const checkpointNumber = Math.floor(completedCount / this.continuityCheckpointInterval);
            const checkpointResult = await this.runContinuityCheckpoint(
              project,
              checkpointNumber,
              chaptersForCheckpoint,
              worldBibleData,
              []
            );
            
            if (!checkpointResult.passed && checkpointResult.chaptersToRevise.length > 0) {
              const hasSignificantIssues = checkpointResult.issues.some(issue => 
                issue.includes("[CRITICA]") || issue.includes("[CRÍTICA]") ||
                issue.includes("[MAYOR]") || issue.includes("[mayor]")
              );
              
              if (hasSignificantIssues) {
                this.callbacks.onAgentStatus("continuity-sentinel", "editing", 
                  `Disparando correcciones para ${checkpointResult.chaptersToRevise.length} capítulos con errores detectados`
                );
                
                for (let idx = 0; idx < checkpointResult.chaptersToRevise.length; idx++) {
                  // Check cancellation before each chapter correction
                  if (await isProjectCancelledFromDb(project.id)) {
                    console.log(`[Orchestrator] Continuity corrections cancelled at chapter ${idx + 1}/${checkpointResult.chaptersToRevise.length} (resumeNovel)`);
                    return;
                  }
                  
                  const chapterNum = checkpointResult.chaptersToRevise[idx];
                  const chapterToFix = chaptersForCheckpoint.find(c => c.chapterNumber === chapterNum);
                  const sectionForFix = this.buildSectionDataFromChapter(chapterToFix!, worldBibleData);
                  
                  if (chapterToFix) {
                    this.callbacks.onAgentStatus("continuity-sentinel", "editing", 
                      `Corrigiendo capítulo ${chapterNum} (${idx + 1}/${checkpointResult.chaptersToRevise.length})`
                    );
                    
                    const issuesForChapter = checkpointResult.issues.filter(issue => 
                      issue.includes(`capítulo ${chapterNum}`) || issue.includes(`Cap ${chapterNum}`)
                    ).join("\n");
                    
                    const baseStyleGuide = `Género: ${project.genre}, Tono: ${project.tone}`;
                    const fullStyleGuide = styleGuideContent 
                      ? `${baseStyleGuide}\n\n--- GUÍA DE ESTILO DEL AUTOR ---\n${styleGuideContent}`
                      : baseStyleGuide;
                    
                    await this.rewriteChapterForQA(
                      project,
                      chapterToFix,
                      sectionForFix,
                      worldBibleData,
                      fullStyleGuide,
                      "continuity",
                      issuesForChapter || checkpointResult.issues.join("\n")
                    );
                  }
                }
                
                this.callbacks.onAgentStatus("continuity-sentinel", "completed", 
                  `Correcciones de continuidad completadas para ${checkpointResult.chaptersToRevise.length} capítulos`
                );
              }
            }
          }
        }
      }

      // QA: Voice & Rhythm Auditor after all chapters complete - SKIP if already completed OR in final review phase
      const projectForVoiceCheck = await storage.getProject(project.id);
      const skipVoiceAuditor = (projectForVoiceCheck?.revisionCycle || 0) > 0 || 
                               (projectForVoiceCheck as any)?.voiceAuditCompleted === true;
      
      if (skipVoiceAuditor) {
        this.callbacks.onAgentStatus("voice-auditor", "skipped", 
          `Auditor de voz omitido - ${(projectForVoiceCheck as any)?.voiceAuditCompleted ? 'ya completado previamente' : 'proyecto en fase de revisión final'}`
        );
        console.log(`[Orchestrator] Skipping voice auditor for project ${project.id} - voiceAuditCompleted=${(projectForVoiceCheck as any)?.voiceAuditCompleted}, revisionCycle=${projectForVoiceCheck?.revisionCycle}`);
      } else {
        // CRITICAL: Mark voice audit complete IMMEDIATELY BEFORE any analysis to prevent infinite loops on freeze
        await storage.updateProject(project.id, { voiceAuditCompleted: true } as any);
        console.log(`[Orchestrator:resumeNovel] Voice audit marked complete IMMEDIATELY for project ${project.id} - prevents re-runs on freeze`);
        
        const allCompletedChapters = await storage.getChaptersByProject(project.id);
        const completedForAnalysis = allCompletedChapters.filter(c => c.status === "completed" && c.content);
        
        if (completedForAnalysis.length >= 5) {
          const trancheSize = 10;
          const totalTranches = Math.ceil(completedForAnalysis.length / trancheSize);
          
          for (let t = 0; t < totalTranches; t++) {
            const trancheChapters = completedForAnalysis.slice(t * trancheSize, (t + 1) * trancheSize);
            if (trancheChapters.length > 0) {
              const voiceResult = await this.runVoiceRhythmAudit(project, t + 1, trancheChapters, styleGuideContent);
              
              if (!voiceResult.passed && voiceResult.chaptersToRevise.length > 0) {
                this.callbacks.onAgentStatus("voice-auditor", "editing", 
                  `Puliendo ${voiceResult.chaptersToRevise.length} capítulos con problemas de voz/ritmo`
                );
                
                for (let idx = 0; idx < voiceResult.chaptersToRevise.length; idx++) {
                  // Check cancellation before each chapter correction
                  if (await isProjectCancelledFromDb(project.id)) {
                    console.log(`[Orchestrator] Voice corrections cancelled at chapter ${idx + 1}/${voiceResult.chaptersToRevise.length} (resumeNovel)`);
                    return;
                  }
                  
                  const chapterNum = voiceResult.chaptersToRevise[idx];
                  const chapterToPolish = trancheChapters.find(c => c.chapterNumber === chapterNum);
                  if (chapterToPolish) {
                    this.callbacks.onAgentStatus("voice-auditor", "editing", 
                      `Puliendo capítulo ${chapterNum} (${idx + 1}/${voiceResult.chaptersToRevise.length})`
                    );
                    
                    const issuesForChapter = voiceResult.issues.filter(issue => 
                      issue.includes(`capítulo ${chapterNum}`) || issue.includes(`Cap ${chapterNum}`)
                    ).join("\n");
                    
                    await this.polishChapterForVoice(
                      project,
                      chapterToPolish,
                      styleGuideContent,
                      issuesForChapter || voiceResult.issues.join("\n")
                    );
                  }
                }
                
                this.callbacks.onAgentStatus("voice-auditor", "completed", 
                  `Correcciones de voz/ritmo completadas para ${voiceResult.chaptersToRevise.length} capítulos`
                );
              }
            }
          }
        }
      }

      // QA: Semantic Repetition Detector - SKIP if already completed OR in final review phase (revisionCycle > 0)
      // MAX 2 attempts to fix semantic issues, then accept with warnings
      const updatedProject = await storage.getProject(project.id);
      const alreadyInFinalReview = (updatedProject?.revisionCycle || 0) > 0;
      const semanticAlreadyCompleted = (updatedProject as any)?.semanticCheckCompleted === true;
      const skipSemanticDetector = alreadyInFinalReview || semanticAlreadyCompleted;
      const MAX_SEMANTIC_ATTEMPTS_RESUME = 2;
      
      if (skipSemanticDetector) {
        this.callbacks.onAgentStatus("semantic-detector", "skipped", 
          `Detector semántico omitido - ${semanticAlreadyCompleted ? 'ya completado previamente' : `proyecto en fase de revisión final (ciclo ${updatedProject?.revisionCycle})`}`
        );
        console.log(`[Orchestrator] Skipping semantic detector for project ${project.id} - semanticCheckCompleted=${semanticAlreadyCompleted}, revisionCycle=${updatedProject?.revisionCycle}`);
      } else {
        // CRITICAL: Mark semantic check complete IMMEDIATELY to prevent infinite loops on freeze
        await storage.updateProject(project.id, { semanticCheckCompleted: true } as any);
        console.log(`[Orchestrator:resumeNovel] Semantic check marked complete IMMEDIATELY for project ${project.id} - prevents re-runs on freeze`);
        
        let semanticAttemptResume = 0;
        let semanticPassedResume = false;
        let semanticActuallyRanResume = false;
        
        while (semanticAttemptResume < MAX_SEMANTIC_ATTEMPTS_RESUME && !semanticPassedResume) {
          // Check cancellation at start of each semantic attempt
          if (await isProjectCancelledFromDb(project.id)) {
            console.log(`[Orchestrator:Resume] Semantic detector cancelled for project ${project.id}`);
            return;
          }
          
          semanticAttemptResume++;
          
          const refreshedChaptersForSemantic = await storage.getChaptersByProject(project.id);
          const completedForSemanticAnalysis = refreshedChaptersForSemantic.filter(c => c.status === "completed" && c.content);

          if (completedForSemanticAnalysis.length === 0) break;
          
          semanticActuallyRanResume = true; // Mark that we actually ran the detector
          this.callbacks.onAgentStatus("semantic-detector", "analyzing", 
            `Análisis semántico (intento ${semanticAttemptResume}/${MAX_SEMANTIC_ATTEMPTS_RESUME})...`
          );
          
          const semanticResult = await this.runSemanticRepetitionAnalysis(project, completedForSemanticAnalysis, worldBibleData);
          
          if (semanticResult.passed) {
            semanticPassedResume = true;
            console.log(`[Orchestrator:Resume] Semantic check PASSED for project ${project.id}`);
            this.callbacks.onAgentStatus("semantic-detector", "complete", 
              `Análisis semántico aprobado`
            );
            break;
          }
          
          if (semanticAttemptResume >= MAX_SEMANTIC_ATTEMPTS_RESUME) {
            // Mark completed even at max attempts to prevent re-running
            await storage.updateProject(project.id, { semanticCheckCompleted: true } as any);
            console.log(`[Orchestrator:Resume] Semantic check max attempts reached, marking as completed for project ${project.id}`);
            this.callbacks.onAgentStatus("semantic-detector", "warning", 
              `Máximo de intentos alcanzado. Continuando con observaciones menores.`
            );
            break;
          }
          
          if (semanticResult.chaptersToRevise.length > 0) {
            // Mark as completed BEFORE starting corrections to prevent re-running on interruption
            await storage.updateProject(project.id, { semanticCheckCompleted: true } as any);
            console.log(`[Orchestrator:Resume] Semantic check marked complete BEFORE corrections for project ${project.id}`);
            
            this.callbacks.onAgentStatus("semantic-detector", "editing", 
              `Corrigiendo ${semanticResult.chaptersToRevise.length} capítulos (intento ${semanticAttemptResume})`
            );
            
            for (let i = 0; i < semanticResult.chaptersToRevise.length; i++) {
              // Check cancellation before each chapter correction
              if (await isProjectCancelledFromDb(project.id)) {
                console.log(`[Orchestrator:Resume] Semantic corrections cancelled at chapter ${i + 1}/${semanticResult.chaptersToRevise.length}`);
                return;
              }
              
              const chapterNum = semanticResult.chaptersToRevise[i];
              const chapterToFix = completedForSemanticAnalysis.find(c => c.chapterNumber === chapterNum);
              
              if (chapterToFix) {
                const sectionForFix = this.buildSectionDataFromChapter(chapterToFix, worldBibleData);
                const freshChapter = await storage.getChaptersByProject(project.id)
                  .then(chs => chs.find(c => c.chapterNumber === chapterNum));
                if (!freshChapter) continue;
                
                this.callbacks.onAgentStatus("semantic-detector", "editing", 
                  `Corrigiendo capítulo ${chapterNum} (${i + 1}/${semanticResult.chaptersToRevise.length})`
                );
                
                const clusterIssues = semanticResult.clusters
                  .filter(c => c.capitulos_afectados?.includes(chapterNum))
                  .map(c => `Repetición de idea: "${c.descripcion}"\n⚠️ PRESERVAR: ${c.elementos_a_preservar || "El resto del capítulo"}\n✏️ CORRECCIÓN: ${c.fix_sugerido}`)
                  .join("\n\n");
                
                const foreshadowingIssues = semanticResult.foreshadowingStatus
                  .filter(f => f.estado === "sin_payoff")
                  .map(f => `Foreshadowing sin resolver: "${f.setup}" (plantado en cap ${f.capitulo_setup}) - DEBES resolverlo o eliminarlo`)
                  .join("\n");
                
                const allIssues = [clusterIssues, foreshadowingIssues].filter(Boolean).join("\n\n");
                
                if (allIssues) {
                  const baseStyleGuide = `Género: ${project.genre}, Tono: ${project.tone}`;
                  const fullStyleGuideResume = styleGuideContent 
                    ? `${baseStyleGuide}\n\n--- GUÍA DE ESTILO DEL AUTOR ---\n${styleGuideContent}`
                    : baseStyleGuide;
                  
                  await this.rewriteChapterForQA(
                    project,
                    freshChapter,
                    sectionForFix,
                    worldBibleData,
                    fullStyleGuideResume,
                    "semantic",
                    allIssues
                  );
                }
              }
            }
            
            this.callbacks.onAgentStatus("semantic-detector", "completed", 
              `Correcciones semánticas completadas para ${semanticResult.chaptersToRevise.length} capítulos`
            );
            // Break after corrections - don't re-analyze (semanticCheckCompleted already true)
            break;
          }
        }
      }

      // Final Review
      const finalChapters = await storage.getChaptersByProject(project.id);
      const allSections = (worldBibleData.escaleta_capitulos as any[]) || [];
      const baseStyleGuide = `Género: ${project.genre}, Tono: ${project.tone}`;
      const fullStyleGuide = styleGuideContent 
        ? `${baseStyleGuide}\n\n--- GUÍA DE ESTILO DEL AUTOR ---\n${styleGuideContent}`
        : baseStyleGuide;
      
      const finalReviewApproved = await this.runFinalReview(
        project, 
        finalChapters, 
        worldBibleData, 
        fullStyleGuide, 
        allSections,
        styleGuideContent,
        authorName
      );

      if (finalReviewApproved) {
        await storage.updateProject(project.id, { status: "completed" });
        this.callbacks.onProjectComplete();
      } else {
        await storage.updateProject(project.id, { status: "failed_final_review" });
        this.callbacks.onError("El manuscrito no pasó la revisión final después de múltiples intentos.");
      }

    } catch (error) {
      console.error("[Orchestrator] Resume error:", error);
      await storage.updateProject(project.id, { status: "error" });
      this.callbacks.onError(error instanceof Error ? error.message : "Error al retomar la generación");
    }
  }

  private reconstructWorldBibleData(worldBible: WorldBible, project: Project): ParsedWorldBible {
    const plotOutlineData = worldBible.plotOutline as any;
    const timeline = (worldBible.timeline as TimelineEvent[]) || [];
    
    const lugares = timeline
      .map((t: any) => t.ubicacion || t.location)
      .filter((loc: any) => loc)
      .filter((loc: string, i: number, arr: string[]) => arr.indexOf(loc) === i);
    
    // Reconstruir escaleta_capitulos desde chapterOutlines con todos los campos adicionales
    const escaleta_capitulos = (plotOutlineData?.chapterOutlines || []).map((c: any) => ({
      numero: c.number,
      titulo: c.titulo || c.summary || `Capítulo ${c.number}`,
      cronologia: c.cronologia || "",
      ubicacion: c.ubicacion || "",
      elenco_presente: c.elenco_presente || [],
      objetivo_narrativo: c.summary || "",
      beats: c.keyEvents || [],
      funcion_estructural: c.funcion_estructural,
      informacion_nueva: c.informacion_nueva,
      pregunta_dramatica: c.pregunta_dramatica,
      conflicto_central: c.conflicto_central,
      giro_emocional: c.giro_emocional,
      recursos_literarios_sugeridos: c.recursos_literarios_sugeridos,
      tono_especifico: c.tono_especifico,
      prohibiciones_este_capitulo: c.prohibiciones_este_capitulo,
      arcos_que_avanza: c.arcos_que_avanza,
      continuidad_entrada: c.continuidad_entrada,
      continuidad_salida: c.continuidad_salida,
      riesgos_de_verosimilitud: c.riesgos_de_verosimilitud,
    }));
    
    return {
      world_bible: {
        personajes: (worldBible.characters as Character[]) || [],
        lugares: lugares,
        reglas_lore: (worldBible.worldRules as WorldRule[]) || [],
      },
      escaleta_capitulos,
      premisa: plotOutlineData?.premise || project.premise || "",
    };
  }

  private buildSectionDataFromChapter(chapter: Chapter, worldBibleData: ParsedWorldBible): SectionData {
    const plotItem = (worldBibleData.escaleta_capitulos as any[])?.find(
      (p: any) => p.numero === chapter.chapterNumber
    );
    
    return {
      numero: chapter.chapterNumber,
      titulo: chapter.title || `Capítulo ${chapter.chapterNumber}`,
      cronologia: plotItem?.cronologia || "",
      ubicacion: plotItem?.ubicacion || "",
      elenco_presente: plotItem?.elenco_presente || [],
      objetivo_narrativo: plotItem?.objetivo_narrativo || "",
      beats: plotItem?.beats || [],
      continuidad_salida: plotItem?.continuidad_salida || "",
      tipo: chapter.chapterNumber === 0 ? "prologue" 
        : chapter.chapterNumber === -1 ? "epilogue" 
        : chapter.chapterNumber === -2 ? "author_note" 
        : "chapter",
      funcion_estructural: plotItem?.funcion_estructural,
      informacion_nueva: plotItem?.informacion_nueva,
      conflicto_central: plotItem?.conflicto_central,
      giro_emocional: plotItem?.giro_emocional,
      riesgos_de_verosimilitud: plotItem?.riesgos_de_verosimilitud,
    };
  }

  private async runFinalReview(
    project: Project,
    chapters: Chapter[],
    worldBibleData: ParsedWorldBible,
    guiaEstilo: string,
    allSections: SectionData[],
    styleGuideContent: string,
    authorName: string
  ): Promise<boolean> {
    let revisionCycle = 0;
    let issuesPreviosCorregidos: string[] = [];
    let consecutiveHighScores = 0; // Track consecutive scores >= 9
    let previousScores: number[] = []; // Track score history
    
    while (revisionCycle < this.maxFinalReviewCycles) {
      const consecutiveInfo = consecutiveHighScores > 0 
        ? ` [${consecutiveHighScores}/${this.requiredConsecutiveHighScores} puntuaciones 9+ consecutivas]`
        : "";
      this.callbacks.onAgentStatus("final-reviewer", "reviewing", 
        `El Revisor Final está analizando el manuscrito completo... (Ciclo ${revisionCycle + 1}/${this.maxFinalReviewCycles})${consecutiveInfo}`
      );

      const updatedChapters = await storage.getChaptersByProject(project.id);
      const chaptersForReview = updatedChapters
        .filter(c => c.content)
        .sort((a, b) => a.chapterNumber - b.chapterNumber)
        .map(c => ({
          numero: c.chapterNumber,
          titulo: c.title || `Capítulo ${c.chapterNumber}`,
          contenido: c.content || "",
        }));

      const reviewResult = await this.finalReviewer.execute({
        projectTitle: project.title,
        chapters: chaptersForReview,
        worldBible: worldBibleData.world_bible,
        guiaEstilo,
        pasadaNumero: revisionCycle + 1,
        issuesPreviosCorregidos,
      });

      await this.trackTokenUsage(project.id, reviewResult.tokenUsage, "El Revisor Final", "gemini-3-pro-preview", undefined, "final_review");

      if (reviewResult.thoughtSignature) {
        await storage.createThoughtLog({
          projectId: project.id,
          agentName: "El Revisor Final",
          agentRole: "final-reviewer",
          thoughtContent: reviewResult.thoughtSignature,
        });
      }

      const result = reviewResult.result;
      
      // Round score to integer for database storage (finalScore is integer type)
      const scoreForDb = result?.puntuacion_global != null 
        ? Math.round(result.puntuacion_global) 
        : null;
      
      await storage.updateProject(project.id, { 
        revisionCycle: revisionCycle + 1,
        finalReviewResult: result as any,
        finalScore: scoreForDb
      });
      
      // === NUEVO: Procesar decisiones de trama, lesiones persistentes y capítulos huérfanos ===
      if (result) {
        // Guardar plot_decisions y persistent_injuries en World Bible
        const worldBible = await storage.getWorldBibleByProject(project.id);
        if (worldBible) {
          let needsUpdate = false;
          const updates: any = {};
          
          if (result.plot_decisions && result.plot_decisions.length > 0) {
            updates.plotDecisions = result.plot_decisions;
            needsUpdate = true;
            await storage.createActivityLog({
              projectId: project.id,
              level: "info",
              message: `Final Reviewer detectó ${result.plot_decisions.length} decisiones de trama críticas`,
              agentRole: "final-reviewer",
            });
          }
          
          if (result.persistent_injuries && result.persistent_injuries.length > 0) {
            updates.persistentInjuries = result.persistent_injuries;
            needsUpdate = true;
            await storage.createActivityLog({
              projectId: project.id,
              level: "info", 
              message: `Final Reviewer detectó ${result.persistent_injuries.length} lesiones persistentes que verificar`,
              agentRole: "final-reviewer",
            });
          }
          
          if (needsUpdate) {
            await storage.updateWorldBible(worldBible.id, updates);
            console.log(`[FinalReviewer] World Bible actualizado con: plotDecisions=${updates.plotDecisions?.length || 0}, persistentInjuries=${updates.persistentInjuries?.length || 0}`);
            await storage.createActivityLog({
              projectId: project.id,
              level: "info",
              message: `World Bible actualizado: ${updates.plotDecisions?.length || 0} decisiones de trama, ${updates.persistentInjuries?.length || 0} lesiones persistentes guardadas`,
              agentRole: "final-reviewer",
            });
          }
        }
        
        // Crear issues adicionales para plot_decisions inconsistentes
        if (result.plot_decisions) {
          const inconsistentDecisions = result.plot_decisions.filter(d => d.consistencia_actual === "inconsistente");
          for (const decision of inconsistentDecisions) {
            const newIssue = {
              capitulos_afectados: decision.capitulos_afectados,
              categoria: "identidad_confusa" as const,
              descripcion: `DECISIÓN DE TRAMA INCONSISTENTE: ${decision.decision}. ${decision.problema || ""}`,
              severidad: "critica" as const,
              elementos_a_preservar: "Preservar toda la trama excepto las líneas que crean la confusión de identidad",
              instrucciones_correccion: `CLARIFICAR: En el capítulo ${decision.capitulo_establecido} establecer claramente que ${decision.decision}. En capítulos posteriores, asegurar que esta decisión sea coherente.`
            };
            result.issues = result.issues || [];
            result.issues.push(newIssue);
            if (!result.capitulos_para_reescribir?.includes(decision.capitulo_establecido)) {
              result.capitulos_para_reescribir = result.capitulos_para_reescribir || [];
              result.capitulos_para_reescribir.push(decision.capitulo_establecido);
            }
          }
        }
        
        // Crear issues para lesiones persistentes ignoradas
        if (result.persistent_injuries) {
          const ignoredInjuries = result.persistent_injuries.filter(i => i.consistencia === "ignorada");
          for (const injury of ignoredInjuries) {
            const newIssue = {
              capitulos_afectados: injury.capitulos_verificados,
              categoria: "continuidad_fisica" as const,
              descripcion: `LESIÓN IGNORADA: ${injury.personaje} sufrió ${injury.tipo_lesion} en Cap ${injury.capitulo_ocurre} pero no se refleja después. ${injury.problema || ""}`,
              severidad: "critica" as const,
              elementos_a_preservar: "Preservar la trama y diálogos. Solo añadir referencias a la lesión.",
              instrucciones_correccion: `OPCIÓN A: Modificar Cap ${injury.capitulo_ocurre} para que la lesión sea superficial (roce, sin daño real). OPCIÓN B: En caps ${injury.capitulos_verificados.join(", ")}, añadir 1-2 referencias sutiles a ${injury.efecto_esperado}. Elegir la opción que requiera menos cambios.`
            };
            result.issues = result.issues || [];
            result.issues.push(newIssue);
            // Añadir el capítulo donde ocurre la lesión para posible corrección
            if (!result.capitulos_para_reescribir?.includes(injury.capitulo_ocurre)) {
              result.capitulos_para_reescribir = result.capitulos_para_reescribir || [];
              result.capitulos_para_reescribir.push(injury.capitulo_ocurre);
            }
          }
        }
        
        // Crear issues para capítulos huérfanos
        if (result.orphan_chapters) {
          for (const orphan of result.orphan_chapters) {
            const newIssue = {
              capitulos_afectados: [orphan.capitulo],
              categoria: "capitulo_huerfano" as const,
              descripcion: `CAPÍTULO HUÉRFANO: ${orphan.razon}`,
              severidad: "mayor" as const,
              elementos_a_preservar: orphan.recomendacion === "eliminar" ? "N/A - capítulo a eliminar" : "El contenido emocional si se reubica",
              instrucciones_correccion: orphan.recomendacion === "eliminar" 
                ? `ELIMINAR este capítulo completo. No aporta a la trama.`
                : orphan.recomendacion === "reubicar_como_flashback"
                  ? `Convertir en flashback breve (máx 500 palabras) e integrar en otro capítulo relevante.`
                  : `Integrar el contenido esencial en el capítulo anterior o siguiente.`
            };
            result.issues = result.issues || [];
            result.issues.push(newIssue);
            if (!result.capitulos_para_reescribir?.includes(orphan.capitulo)) {
              result.capitulos_para_reescribir = result.capitulos_para_reescribir || [];
              result.capitulos_para_reescribir.push(orphan.capitulo);
            }
          }
        }
      }
      // === FIN NUEVO ===

      const currentScore = result?.puntuacion_global || 0;
      previousScores.push(currentScore);
      
      // Track consecutive high scores
      if (currentScore >= this.minAcceptableScore) {
        consecutiveHighScores++;
      } else {
        consecutiveHighScores = 0; // Reset counter if score drops below 9
      }
      
      // Verificar si hay CUALQUIER issue que deba corregirse
      const allIssues = result?.issues || [];
      const hasAnyIssues = allIssues.length > 0;
      
      // APROBADO: Puntuación >= 9 por N veces consecutivas Y SIN NINGÚN issue
      if (consecutiveHighScores >= this.requiredConsecutiveHighScores && !hasAnyIssues) {
        const recentScores = previousScores.slice(-this.requiredConsecutiveHighScores).join(", ");
        const mensaje = result?.veredicto === "APROBADO_CON_RESERVAS"
          ? `Manuscrito APROBADO CON RESERVAS. Puntuaciones consecutivas: ${recentScores}/10.`
          : `Manuscrito APROBADO. Puntuaciones consecutivas: ${recentScores}/10. CERO issues pendientes. Calidad bestseller confirmada.`;
        this.callbacks.onAgentStatus("final-reviewer", "completed", mensaje);
        return true;
      }
      
      // Si hay CUALQUIER issue (crítico, mayor o menor), FORZAR corrección antes de aprobar
      if (hasAnyIssues) {
        const criticalCount = allIssues.filter(i => i.severidad === "critica").length;
        const majorCount = allIssues.filter(i => i.severidad === "mayor").length;
        const minorCount = allIssues.filter(i => i.severidad === "menor").length;
        
        this.callbacks.onAgentStatus("final-reviewer", "editing", 
          `Puntuación ${currentScore}/10. Corrigiendo ${allIssues.length} issues detectados (${criticalCount} críticos, ${majorCount} mayores, ${minorCount} menores) antes de poder aprobar.`
        );
        
        // Asegurar que TODOS los capítulos afectados por CUALQUIER issue están en la lista
        const chaptersToRewrite = result?.capitulos_para_reescribir || [];
        allIssues.forEach(issue => {
          issue.capitulos_afectados.forEach(ch => {
            if (!chaptersToRewrite.includes(ch)) {
              chaptersToRewrite.push(ch);
            }
          });
        });
        if (result) {
          result.capitulos_para_reescribir = chaptersToRewrite;
          result.veredicto = "REQUIERE_REVISION";
        }
        // Continuar hacia la sección de reescritura (no hacer continue aquí)
      } else if (currentScore >= this.minAcceptableScore && consecutiveHighScores < this.requiredConsecutiveHighScores) {
        // Puntuación >= 9 pero aún no suficientes consecutivas, Y sin issues
        this.callbacks.onAgentStatus("final-reviewer", "reviewing", 
          `Puntuación ${currentScore}/10 sin issues. Necesita ${this.requiredConsecutiveHighScores - consecutiveHighScores} evaluación(es) más con 9+ para confirmar.`
        );
        revisionCycle++;
        continue; // Re-evaluate without rewriting
      }
      
      // Si el revisor aprobó pero la puntuación es < 9, continuamos refinando
      // PERO no creamos issues sintéticos con capítulos hardcodeados para evitar bucles infinitos
      if ((result?.veredicto === "APROBADO" || result?.veredicto === "APROBADO_CON_RESERVAS") && currentScore < this.minAcceptableScore) {
        this.callbacks.onAgentStatus("final-reviewer", "editing", 
          `Sin problemas específicos pero puntuación ${currentScore}/10 < ${this.minAcceptableScore}. Continuando refinamiento...`
        );
        
        // Solo marcamos como REQUIERE_REVISION pero NO creamos issues sintéticos
        // El sistema re-evaluará sin reescribir capítulos si no hay issues reales
        if (result) {
          result.veredicto = "REQUIERE_REVISION";
          // NO crear issues sintéticos - dejar que el ciclo continúe para re-evaluar
        }
        
        revisionCycle++;
        continue; // Re-evaluar sin reescribir
      }
      
      // LÍMITE MÁXIMO DE CICLOS alcanzado
      if (revisionCycle === this.maxFinalReviewCycles - 1) {
        const avgScore = previousScores.length > 0 
          ? (previousScores.reduce((a, b) => a + b, 0) / previousScores.length).toFixed(1)
          : currentScore;
        
        // No aprobar si hay CUALQUIER issue sin resolver
        if (currentScore >= this.minAcceptableScore && !hasAnyIssues) {
          this.callbacks.onAgentStatus("final-reviewer", "completed", 
            `Límite de ${this.maxFinalReviewCycles} ciclos alcanzado. Puntuación final: ${currentScore}/10 (promedio: ${avgScore}). CERO issues. APROBADO.`
          );
          return true;
        } else if (hasAnyIssues) {
          this.callbacks.onAgentStatus("final-reviewer", "error", 
            `Límite de ${this.maxFinalReviewCycles} ciclos alcanzado con ${allIssues.length} issues sin resolver. Proyecto pausado para revisión manual.`
          );
          await storage.updateProject(project.id, {
            status: "awaiting_instructions",
            architectInstructions: `[PAUSA] Límite de ciclos alcanzado con ${allIssues.length} issues pendientes:\n${allIssues.map(i => `- [${i.severidad.toUpperCase()}] ${i.descripcion}`).join("\n")}`,
            finalScore: currentScore
          });
          return false;
        } else {
          this.callbacks.onAgentStatus("final-reviewer", "error", 
            `Límite de ${this.maxFinalReviewCycles} ciclos alcanzado. Puntuación final: ${currentScore}/10 NO alcanza el mínimo de ${this.minAcceptableScore}. Proyecto NO APROBADO.`
          );
          return false;
        }
      }

      const issueCount = result?.issues?.length || 0;
      const chaptersToRewrite = result?.capitulos_para_reescribir || [];
      
      this.callbacks.onAgentStatus("final-reviewer", "editing", 
        `Manuscrito REQUIERE REVISIÓN. ${issueCount} problemas detectados en ${chaptersToRewrite.length || "varios"} capítulos.`
      );
      
      if (chaptersToRewrite.length === 0) {
        if (result?.issues && result.issues.length > 0) {
          const affectedChapters = new Set<number>();
          result.issues.forEach(issue => {
            issue.capitulos_afectados.forEach(ch => affectedChapters.add(ch));
          });
          
          if (affectedChapters.size > 0) {
            chaptersToRewrite.push(...Array.from(affectedChapters));
          } else {
            this.callbacks.onAgentStatus("final-reviewer", "error", 
              `Revisión rechazada pero sin capítulos específicos. Marcando como fallo.`
            );
            revisionCycle++;
            continue;
          }
        } else {
          if (currentScore >= this.minAcceptableScore) {
            consecutiveHighScores++;
            if (consecutiveHighScores >= this.requiredConsecutiveHighScores) {
              this.callbacks.onAgentStatus("final-reviewer", "completed", 
                `Revisión completada sin problemas. ${consecutiveHighScores}x puntuaciones ${this.minAcceptableScore}+ consecutivas alcanzadas.`
              );
              return true;
            } else {
              this.callbacks.onAgentStatus("final-reviewer", "reviewing", 
                `Puntuación ${currentScore}/10. Necesita ${this.requiredConsecutiveHighScores - consecutiveHighScores} más para confirmar.`
              );
              revisionCycle++;
              continue;
            }
          } else {
            consecutiveHighScores = 0;
            
            // Detectar estancamiento: múltiples evaluaciones sin issues y sin alcanzar 9
            const recentScores = previousScores.slice(-3);
            const isStagnant = recentScores.length >= 3 && 
              recentScores.every(s => s >= 7 && s < this.minAcceptableScore);
            
            if (isStagnant) {
              const avgScore = (recentScores.reduce((a, b) => a + b, 0) / recentScores.length).toFixed(1);
              this.callbacks.onAgentStatus("final-reviewer", "paused", 
                `ESTANCAMIENTO: 3 evaluaciones consecutivas con ~${avgScore}/10 sin issues específicos. El manuscrito está bien pero no alcanza el 9. Pausando para instrucciones del usuario.`
              );
              
              await storage.updateProject(project.id, {
                status: "awaiting_instructions",
                architectInstructions: `[PAUSA] El manuscrito mantiene una puntuación de ${avgScore}/10 pero el revisor no encuentra problemas específicos para mejorar. Por favor, proporciona instrucciones sobre cómo proceder.`,
                finalScore: currentScore
              });
              
              return false;
            }
            
            this.callbacks.onAgentStatus("final-reviewer", "reviewing", 
              `Sin problemas específicos pero puntuación ${currentScore}/10 < ${this.minAcceptableScore}. Continuando refinamiento...`
            );
            revisionCycle++;
            continue;
          }
        }
      }

      for (let rewriteIndex = 0; rewriteIndex < chaptersToRewrite.length; rewriteIndex++) {
        if (await isProjectCancelledFromDb(project.id)) {
          console.log(`[Orchestrator] Project ${project.id} cancelled during revision. Stopping.`);
          await storage.createActivityLog({
            projectId: project.id,
            level: "info",
            message: `Revisión detenida por el usuario`,
            agentRole: "orchestrator",
          });
          return false;
        }

        const chapterNum = chaptersToRewrite[rewriteIndex];
        const chapter = updatedChapters.find(c => c.chapterNumber === chapterNum);
        const sectionData = allSections.find(s => s.numero === chapterNum);
        
        if (!chapter || !sectionData) continue;

        const issuesForChapter = result?.issues?.filter(
          i => i.capitulos_afectados.includes(chapterNum)
        ) || [];
        
        const revisionInstructions = issuesForChapter.map(issue => {
          const preservar = (issue as any).elementos_a_preservar 
            ? `\n⚠️ PRESERVAR (NO MODIFICAR): ${(issue as any).elementos_a_preservar}` 
            : "";
          return `[${issue.categoria.toUpperCase()}] ${issue.descripcion}${preservar}\n✏️ CORRECCIÓN QUIRÚRGICA: ${issue.instrucciones_correccion}`;
        }).join("\n\n");

        const issuesSummary = issuesForChapter.map(i => i.categoria).join(", ") || "correcciones generales";

        await storage.updateChapter(chapter.id, { 
          status: "revision",
          needsRevision: true,
          revisionReason: revisionInstructions 
        });

        this.callbacks.onChapterStatusChange(chapterNum, "revision");

        const sectionLabel = this.getSectionLabel(sectionData);
        
        this.callbacks.onChapterRewrite(
          chapterNum, 
          sectionData.titulo, 
          rewriteIndex + 1, 
          chaptersToRewrite.length,
          issuesSummary
        );
        
        // MICROSURGERY MODE: Use CopyEditor for surgical corrections instead of full Ghostwriter rewrite
        // Still report as ghostwriter for UI compatibility
        this.callbacks.onAgentStatus("ghostwriter", "writing", 
          `Microcirugía ${sectionLabel} (${rewriteIndex + 1}/${chaptersToRewrite.length}): ${issuesSummary}`
        );

        // Get continuity context for corrections
        const previousChapter = updatedChapters.find(c => c.chapterNumber === chapterNum - 1);
        const continuityContext = previousChapter?.content 
          ? `\nCONTEXTO DE CONTINUIDAD (final del capítulo anterior):\n${previousChapter.content.slice(-1500)}\n` 
          : "";

        // Build targeted correction prompt for microsurgery
        const microsurgeryPrompt = `
CORRECCIONES DEL REVISOR FINAL - MODO MICROCIRUGÍA:
${revisionInstructions}
${continuityContext}
INSTRUCCIONES CRÍTICAS:
- Modifica SOLO las frases/párrafos específicos indicados en cada corrección
- Preserva el 95% del texto original INTACTO
- NO reescribas secciones que funcionan bien
- Si la instrucción dice "BUSCAR X REEMPLAZAR POR Y", hazlo exactamente
- Aplica cambios quirúrgicos mínimos
- Mantén la continuidad con el capítulo anterior

Género: ${project.genre}, Tono: ${project.tone}
${styleGuideContent ? `\nGUÍA DE ESTILO:\n${styleGuideContent}` : ""}`;

        const copyEditResult = await this.copyeditor.execute({
          chapterContent: chapter.content || "",
          chapterNumber: sectionData.numero,
          chapterTitle: sectionData.titulo,
          guiaEstilo: microsurgeryPrompt,
        });

        await this.trackTokenUsage(project.id, copyEditResult.tokenUsage, "El Estilista", "gemini-3-pro-preview", sectionData.numero, "final_review_microsurgery");

        let finalContent = copyEditResult.result?.texto_final || chapter.content || "";
        
        // Quick verification: ensure minimum changes were applied
        const originalWordCount = (chapter.content || "").split(/\s+/).filter((w: string) => w.length > 0).length;
        const newWordCount = finalContent.split(/\s+/).filter((w: string) => w.length > 0).length;
        const wordDiff = Math.abs(newWordCount - originalWordCount);
        const changeRatio = wordDiff / originalWordCount;
        
        // If microsurgery failed (no changes or too many changes), log warning
        if (changeRatio === 0) {
          console.warn(`[Orchestrator] Microsurgery applied no changes to chapter ${chapterNum}`);
        } else if (changeRatio > 0.3) {
          console.warn(`[Orchestrator] Microsurgery changed ${Math.round(changeRatio * 100)}% of chapter ${chapterNum} - may have over-corrected`);
        }

        const wordCount = newWordCount;

        await storage.updateChapter(chapter.id, {
          content: finalContent,
          wordCount,
          status: "completed",
          needsRevision: false,
          revisionReason: null,
        });

        this.callbacks.onChapterComplete(chapterNum, wordCount, sectionData.titulo);
        this.callbacks.onAgentStatus("copyeditor", "completed", 
          `${sectionLabel} corregido y finalizado (${wordCount} palabras)`
        );
      }

      // Acumular los issues corregidos para informar al revisor en la siguiente pasada
      if (result?.issues) {
        const issuesDeEsteCiclo = result.issues.map(i => 
          `[${i.categoria}] ${i.descripcion} (Caps ${i.capitulos_afectados.join(", ")})`
        );
        issuesPreviosCorregidos = [...issuesPreviosCorregidos, ...issuesDeEsteCiclo];
      }

      revisionCycle++;
    }

    return false;
  }

  async runFinalReviewOnly(project: Project): Promise<void> {
    try {
      this.cumulativeTokens = {
        inputTokens: project.totalInputTokens || 0,
        outputTokens: project.totalOutputTokens || 0,
        thinkingTokens: project.totalThinkingTokens || 0,
      };
      
      let styleGuideContent = "";
      let authorName = "";
      
      if (project.styleGuideId) {
        const styleGuide = await storage.getStyleGuide(project.styleGuideId);
        if (styleGuide) {
          styleGuideContent = styleGuide.content;
        }
      }
      
      if (project.pseudonymId) {
        const pseudonym = await storage.getPseudonym(project.pseudonymId);
        if (pseudonym) {
          authorName = pseudonym.name;
        }
      }

      const worldBible = await storage.getWorldBibleByProject(project.id);
      if (!worldBible) {
        this.callbacks.onError("No se encontró la biblia del mundo para este proyecto");
        return;
      }

      const worldBibleData: ParsedWorldBible = {
        world_bible: {
          personajes: worldBible.characters as any[] || [],
          lugares: [],
          reglas_lore: worldBible.worldRules as any[] || [],
        },
        escaleta_capitulos: worldBible.plotOutline as any[] || [],
      };

      const chapters = await storage.getChaptersByProject(project.id);
      const allSections = this.buildSectionsListFromChapters(chapters, worldBibleData);
      const guiaEstilo = `Género: ${project.genre}, Tono: ${project.tone}`;

      const completedChapters = chapters.filter(c => c.status === "completed" && c.content);
      
      if (completedChapters.length > 0) {
        // Check if voice audit was already completed to prevent infinite loops
        const currentProjectForVoice = await storage.getProject(project.id);
        const voiceAlreadyDone = (currentProjectForVoice as any)?.voiceAuditCompleted === true;
        
        if (voiceAlreadyDone) {
          this.callbacks.onAgentStatus("voice-auditor", "skipped", 
            `Auditor de voz omitido - ya completado previamente`
          );
          console.log(`[Orchestrator:runFinalReviewOnly] Skipping voice auditor for project ${project.id} - already completed`);
        } else {
          this.callbacks.onAgentStatus("voice-auditor", "analyzing", 
            `Ejecutando análisis de voz y ritmo antes de revisión final...`
          );
          
          // Mark voice audit as completed BEFORE corrections to prevent re-running on interruption
          await storage.updateProject(project.id, { voiceAuditCompleted: true } as any);
          console.log(`[Orchestrator:runFinalReviewOnly] Voice audit marked complete BEFORE corrections for project ${project.id}`);
          
          const trancheSize = 10;
          const totalTranches = Math.ceil(completedChapters.length / trancheSize);
          let voiceCorrectionsApplied = false;
          
          for (let t = 0; t < totalTranches; t++) {
            const trancheChapters = completedChapters.slice(t * trancheSize, (t + 1) * trancheSize);
            if (trancheChapters.length > 0) {
              const voiceResult = await this.runVoiceRhythmAudit(project, t + 1, trancheChapters, styleGuideContent);
              
              if (!voiceResult.passed && voiceResult.chaptersToRevise.length > 0) {
                voiceCorrectionsApplied = true;
                this.callbacks.onAgentStatus("voice-auditor", "editing", 
                  `Corrigiendo ${voiceResult.chaptersToRevise.length} capítulos con issues de voz/ritmo...`
                );
                
                for (let idx = 0; idx < voiceResult.chaptersToRevise.length; idx++) {
                  // Check cancellation before each chapter correction
                  if (await isProjectCancelledFromDb(project.id)) {
                    console.log(`[Orchestrator] Voice corrections cancelled at chapter ${idx + 1}/${voiceResult.chaptersToRevise.length} (runFinalReviewOnly)`);
                    return;
                  }
                  
                  const chapterNum = voiceResult.chaptersToRevise[idx];
                  const chapter = chapters.find(c => c.chapterNumber === chapterNum);
                  const sectionData = allSections.find(s => s.numero === chapterNum);
                  if (chapter && sectionData) {
                    this.callbacks.onAgentStatus("voice-auditor", "editing", 
                      `Corrigiendo capítulo ${chapterNum} (${idx + 1}/${voiceResult.chaptersToRevise.length})`
                    );
                    const correctionInstructions = voiceResult.issues.join("\n");
                    await this.rewriteChapterForQA(project, chapter, sectionData, worldBibleData, guiaEstilo, "voice", correctionInstructions);
                  }
                }
              }
            }
          }
          
          if (voiceCorrectionsApplied) {
            this.callbacks.onAgentStatus("voice-auditor", "completed", 
              `Correcciones de voz/ritmo completadas`
            );
          } else {
            this.callbacks.onAgentStatus("voice-auditor", "complete", 
              `Análisis de voz aprobado`
            );
          }
        }
        
        // Check if semantic check was already completed to prevent infinite loops
        const currentProjectForSemantic = await storage.getProject(project.id);
        const semanticAlreadyDone = (currentProjectForSemantic as any)?.semanticCheckCompleted === true;
        
        if (semanticAlreadyDone) {
          this.callbacks.onAgentStatus("semantic-detector", "skipped", 
            `Detector semántico omitido - ya completado previamente`
          );
          console.log(`[Orchestrator:runFinalReviewOnly] Skipping semantic detector for project ${project.id} - already completed`);
        } else {
          this.callbacks.onAgentStatus("semantic-detector", "analyzing", 
            `Ejecutando análisis semántico antes de revisión final...`
          );
          
          // CRITICAL: Mark as completed BEFORE analysis to prevent infinite loops on freeze
          await storage.updateProject(project.id, { semanticCheckCompleted: true } as any);
          console.log(`[Orchestrator:runFinalReviewOnly] Semantic check marked complete IMMEDIATELY for project ${project.id} - prevents re-runs on freeze`);
          
          const semanticResult = await this.runSemanticRepetitionAnalysis(project, completedChapters, worldBibleData);
          
          if (!semanticResult.passed && semanticResult.chaptersToRevise.length > 0) {
            this.callbacks.onAgentStatus("semantic-detector", "editing", 
              `Corrigiendo ${semanticResult.chaptersToRevise.length} capítulos con repeticiones semánticas...`
            );
            
            for (let idx = 0; idx < semanticResult.chaptersToRevise.length; idx++) {
              // Check cancellation before each chapter correction
              if (await isProjectCancelledFromDb(project.id)) {
                console.log(`[Orchestrator] Semantic corrections cancelled at chapter ${idx + 1}/${semanticResult.chaptersToRevise.length} (runFinalReviewOnly)`);
                return;
              }
              
              const chapterNum = semanticResult.chaptersToRevise[idx];
              const chapter = chapters.find(c => c.chapterNumber === chapterNum);
              const sectionData = allSections.find(s => s.numero === chapterNum);
              if (chapter && sectionData) {
                this.callbacks.onAgentStatus("semantic-detector", "editing", 
                  `Corrigiendo capítulo ${chapterNum} (${idx + 1}/${semanticResult.chaptersToRevise.length})`
                );
                const semanticIssues = semanticResult.clusters
                  .filter(c => c.capitulos_afectados?.includes(chapterNum))
                  .map(c => `Repetición semántica: "${c.concepto}" aparece ${c.frecuencia} veces`);
                const correctionInstructions = semanticIssues.join("\n");
                await this.rewriteChapterForQA(project, chapter, sectionData, worldBibleData, guiaEstilo, "semantic", correctionInstructions);
              }
            }
            
            this.callbacks.onAgentStatus("semantic-detector", "completed", 
              `Correcciones semánticas completadas para ${semanticResult.chaptersToRevise.length} capítulos`
            );
          } else {
            this.callbacks.onAgentStatus("semantic-detector", "complete", 
              `Análisis semántico aprobado`
            );
          }
        }
      }

      const approved = await this.runFinalReview(
        project,
        chapters,
        worldBibleData,
        guiaEstilo,
        allSections,
        styleGuideContent,
        authorName
      );

      if (approved) {
        await storage.updateProject(project.id, { 
          status: "completed",
          finalReviewResult: { approved }
        });
        this.callbacks.onAgentStatus("final-reviewer", "completed", "Revisión final aprobada");
        this.callbacks.onProjectComplete();
      } else {
        await storage.updateProject(project.id, { 
          status: "failed_final_review",
          finalReviewResult: { approved }
        });
        this.callbacks.onAgentStatus("final-reviewer", "error", "Revisión final NO aprobada - puntuación insuficiente");
        this.callbacks.onError("El manuscrito no alcanzó la puntuación mínima de 9 después de múltiples intentos.");
      }
    } catch (error) {
      console.error("Final review error:", error);
      this.callbacks.onError(`Error en revisión final: ${error instanceof Error ? error.message : "Error desconocido"}`);
      await storage.updateProject(project.id, { status: "error" });
    }
  }

  async extendNovel(project: Project, fromChapter: number, toChapter: number): Promise<void> {
    try {
      console.log(`[Orchestrator:Extend] Extending project ${project.id} from chapter ${fromChapter + 1} to ${toChapter}`);
      
      this.cumulativeTokens = {
        inputTokens: project.totalInputTokens || 0,
        outputTokens: project.totalOutputTokens || 0,
        thinkingTokens: project.totalThinkingTokens || 0,
      };

      const worldBible = await storage.getWorldBibleByProject(project.id);
      if (!worldBible) {
        this.callbacks.onError("No se encontró la biblia del mundo para este proyecto. Necesita generar primero.");
        await storage.updateProject(project.id, { status: "error" });
        return;
      }

      let styleGuideContent = "";
      let authorName = "";
      let extendedGuideContent = "";
      
      if (project.styleGuideId) {
        const styleGuide = await storage.getStyleGuide(project.styleGuideId);
        if (styleGuide) styleGuideContent = styleGuide.content;
      }
      
      if (project.pseudonymId) {
        const pseudonym = await storage.getPseudonym(project.pseudonymId);
        if (pseudonym) authorName = pseudonym.name;
      }

      if ((project as any).extendedGuideId) {
        const extendedGuide = await storage.getExtendedGuide((project as any).extendedGuideId);
        if (extendedGuide) extendedGuideContent = extendedGuide.content;
      }

      // Get existing chapters to understand the story so far
      const existingChapters = await storage.getChaptersByProject(project.id);
      const completedChapters = existingChapters
        .filter(c => c.status === "completed" && c.chapterNumber > 0)
        .sort((a, b) => a.chapterNumber - b.chapterNumber);

      const lastCompletedChapter = completedChapters.length > 0 
        ? completedChapters[completedChapters.length - 1] 
        : null;

      // Build summary of story so far for the Architect
      const storySoFar = completedChapters.map(c => 
        `Capítulo ${c.chapterNumber}: ${c.title || "Sin título"}`
      ).join("\n");

      this.callbacks.onAgentStatus("architect", "planning", 
        `El Arquitecto está planificando los capítulos ${fromChapter + 1} a ${toChapter}...`
      );

      // Call the Architect to generate outline for new chapters
      const chaptersToGenerate = toChapter - fromChapter;
      const architectPrompt = `
EXTENSIÓN DE NOVELA EN PROGRESO

La novela ya tiene ${fromChapter} capítulos escritos. Necesitas planificar los capítulos ${fromChapter + 1} hasta ${toChapter} (${chaptersToGenerate} capítulos adicionales).

INFORMACIÓN DEL PROYECTO:
- Título: ${project.title}
- Género: ${project.genre}
- Tono: ${project.tone}
- Premisa: ${project.premise || "No especificada"}

CAPÍTULOS EXISTENTES:
${storySoFar}

ÚLTIMO CAPÍTULO COMPLETADO:
${lastCompletedChapter ? `
Capítulo ${lastCompletedChapter.chapterNumber}: ${lastCompletedChapter.title || "Sin título"}
Contenido (últimas 1000 palabras):
${lastCompletedChapter.content?.slice(-4000) || "Sin contenido disponible"}
` : "No hay capítulos previos"}

PERSONAJES EXISTENTES:
${JSON.stringify(worldBible.characters, null, 2)}

REGLAS DEL MUNDO:
${JSON.stringify(worldBible.worldRules, null, 2)}

INSTRUCCIONES:
1. Genera una escaleta detallada SOLO para los capítulos ${fromChapter + 1} hasta ${toChapter}
2. Mantén la continuidad con la historia existente
3. Cada capítulo debe tener: numero, titulo, resumen, puntos_clave, personajes_involucrados
4. Los números de capítulo deben ser consecutivos desde ${fromChapter + 1}

Responde SOLO con un JSON válido con la estructura:
{
  "escaleta_capitulos": [
    {
      "numero": ${fromChapter + 1},
      "titulo": "...",
      "resumen": "...",
      "puntos_clave": ["..."],
      "personajes_involucrados": ["..."]
    }
  ]
}
`;

      const architectResult = await this.architect.execute({
        title: project.title,
        premise: architectPrompt,
        genre: project.genre,
        chapterCount: chaptersToGenerate,
        hasPrologue: false,
        hasEpilogue: false,
        hasAuthorNote: false,
        tone: project.tone,
      });

      if (!architectResult.content) {
        this.callbacks.onError("El Arquitecto no generó una escaleta válida para la extensión");
        await storage.updateProject(project.id, { status: "error" });
        return;
      }

      await this.trackTokenUsage(project.id, architectResult.tokenUsage, "El Arquitecto", "gemini-3-pro-preview", undefined, "extend_outline");

      // Parse the new chapter outlines
      let newChapterOutlines: any[] = [];
      try {
        const jsonMatch = architectResult.content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          newChapterOutlines = parsed.escaleta_capitulos || [];
        }
      } catch (e) {
        console.error("[Orchestrator:Extend] Failed to parse architect response:", e);
        this.callbacks.onError("Error al parsear la escaleta de extensión");
        await storage.updateProject(project.id, { status: "error" });
        return;
      }

      if (newChapterOutlines.length === 0) {
        this.callbacks.onError("El Arquitecto no generó capítulos para la extensión");
        await storage.updateProject(project.id, { status: "error" });
        return;
      }

      this.callbacks.onAgentStatus("architect", "completed", 
        `Escaleta generada: ${newChapterOutlines.length} capítulos planificados`
      );

      // Create chapter records for the new chapters
      for (const outline of newChapterOutlines) {
        await storage.createChapter({
          projectId: project.id,
          chapterNumber: outline.numero,
          title: outline.titulo,
          content: "",
          wordCount: 0,
          status: "pending",
        });
      }

      console.log(`[Orchestrator:Extend] Created ${newChapterOutlines.length} new chapter records`);

      // Build world bible data for ghostwriter
      const worldBibleData = this.reconstructWorldBibleData(worldBible, project);
      
      // Add the new outlines to the world bible data
      worldBibleData.escaleta_capitulos = [
        ...(worldBibleData.escaleta_capitulos || []),
        ...newChapterOutlines
      ];

      // Initialize character states from existing chapters
      const characterStates: Map<string, { alive: boolean; location: string; injuries: string[]; lastSeen: number }> = new Map();

      // Get continuity from last completed chapter
      let previousContinuity = lastCompletedChapter?.continuityState 
        ? JSON.stringify(lastCompletedChapter.continuityState)
        : lastCompletedChapter?.content 
          ? `Capítulo anterior completado. Contenido termina con: ${lastCompletedChapter.content.slice(-500)}`
          : "";

      let previousContinuityStateForEditor: any = lastCompletedChapter?.continuityState || null;

      // Get the newly created pending chapters
      const allChapters = await storage.getChaptersByProject(project.id);
      const pendingChapters = allChapters
        .filter(c => c.status === "pending" && c.chapterNumber > fromChapter)
        .sort((a, b) => a.chapterNumber - b.chapterNumber);

      this.callbacks.onAgentStatus("ghostwriter", "writing", 
        `Iniciando escritura de ${pendingChapters.length} capítulos nuevos...`
      );

      // Generate content for each new chapter (similar to resumeNovel logic)
      for (const chapter of pendingChapters) {
        if (await isProjectCancelledFromDb(project.id)) {
          this.callbacks.onAgentStatus("orchestrator", "cancelled", "Extensión cancelada por el usuario");
          await storage.updateProject(project.id, { status: "cancelled" });
          return;
        }

        const sectionData = this.buildSectionDataFromChapter(chapter, worldBibleData);
        
        await storage.updateChapter(chapter.id, { status: "writing" });
        this.callbacks.onChapterStatusChange(chapter.chapterNumber, "writing");

        const sectionLabel = this.getSectionLabel(sectionData);
        this.callbacks.onAgentStatus("ghostwriter", "writing", `El Narrador está escribiendo ${sectionLabel}...`);

        let chapterContent = "";
        let approved = false;
        let refinementAttempts = 0;
        let refinementInstructions = "";
        let extractedContinuityState: any = null;
        
        let bestVersion = { content: "", score: 0, continuityState: null as any };

        while (!approved && refinementAttempts < this.maxRefinementLoops) {
          const baseStyleGuide = `Género: ${project.genre}, Tono: ${project.tone}`;
          const fullStyleGuide = styleGuideContent 
            ? `${baseStyleGuide}\n\n--- GUÍA DE ESTILO DEL AUTOR ---\n${styleGuideContent}`
            : baseStyleGuide;

          const isRewrite = refinementAttempts > 0;
          // SPECIAL: Author's Note has different word limits (800-1200 words)
          const isAuthorNoteExtend = sectionData.tipo === "author_note" || sectionData.numero === -2;
          const perChapterMin = isAuthorNoteExtend ? 800 : ((project as any).minWordsPerChapter || 2500);
          const perChapterMax = isAuthorNoteExtend ? 1200 : ((project as any).maxWordsPerChapter || Math.round(perChapterMin * 1.15));
          
          const writerResult = await this.ghostwriter.execute({
            chapterNumber: sectionData.numero,
            chapterData: sectionData,
            worldBible: worldBibleData.world_bible,
            guiaEstilo: fullStyleGuide,
            previousContinuity,
            refinementInstructions,
            authorName,
            isRewrite,
            minWordCount: perChapterMin,
            maxWordCount: perChapterMax,
            extendedGuideContent: extendedGuideContent || undefined,
            previousChapterContent: isRewrite ? bestVersion.content : undefined,
            kindleUnlimitedOptimized: (project as any).kindleUnlimitedOptimized || false,
          });

          // CRITICAL: Validate that content exists before processing
          if (!writerResult.content || writerResult.content.trim().length === 0) {
            console.error(`[Orchestrator] CRITICAL: Ghostwriter returned NULL/EMPTY content for ${sectionLabel} (expansion). Skipping...`);
            this.callbacks.onAgentStatus("ghostwriter", "error", 
              `${sectionLabel} vacío tras expansión. Saltando al siguiente.`
            );
            continue;
          }

          const { cleanContent, continuityState } = this.ghostwriter.extractContinuityState(writerResult.content);
          let currentContent = cleanContent;
          const currentContinuityState = continuityState;
          
          // CRITICAL: Double-check after extraction that content is not empty
          if (!currentContent || currentContent.trim().length === 0) {
            console.error(`[Orchestrator] CRITICAL: Content extraction resulted in EMPTY content for ${sectionLabel} (expansion). Skipping...`);
            this.callbacks.onAgentStatus("ghostwriter", "error", 
              `${sectionLabel} vacío tras extracción (expansión). Saltando al siguiente.`
            );
            continue;
          }
          
          const contentWordCount = currentContent.split(/\s+/).filter((w: string) => w.length > 0).length;
          
          await this.trackTokenUsage(project.id, writerResult.tokenUsage, "El Narrador", "gemini-3-pro-preview", sectionData.numero, "extend_write");

          // Editor review
          this.callbacks.onAgentStatus("editor", "reviewing", `El Editor está revisando ${sectionLabel}...`);
          
          const editorResult = await this.editor.execute({
            chapterNumber: sectionData.numero,
            chapterContent: currentContent,
            chapterData: sectionData,
            worldBible: worldBibleData.world_bible,
            previousContinuityState: previousContinuityStateForEditor,
            guiaEstilo: fullStyleGuide,
          });

          await this.trackTokenUsage(project.id, editorResult.tokenUsage, "El Editor", "gemini-3-pro-preview", sectionData.numero, "extend_edit");

          if (editorResult.result) {
            const score = editorResult.result.puntuacion || 0;
            
            if (score > bestVersion.score) {
              bestVersion = { content: currentContent, score, continuityState: currentContinuityState };
            }

            if (score >= 8 || refinementAttempts >= this.maxRefinementLoops - 1) {
              approved = true;
              chapterContent = bestVersion.content;
              extractedContinuityState = bestVersion.continuityState;
            } else {
              refinementInstructions = editorResult.result.plan_quirurgico?.procedimiento || "Mejorar la calidad general";
              refinementAttempts++;
              this.callbacks.onAgentStatus("editor", "refining", 
                `${sectionLabel}: Puntuación ${score}/10, refinando (intento ${refinementAttempts})...`
              );
            }
          } else {
            approved = true;
            chapterContent = currentContent;
            extractedContinuityState = currentContinuityState;
          }
        }

        // Save the chapter
        const wordCount = chapterContent.split(/\s+/).filter((w: string) => w.length > 0).length;
        await storage.updateChapter(chapter.id, {
          content: chapterContent,
          wordCount,
          status: "completed",
          continuityState: extractedContinuityState,
        });

        this.callbacks.onChapterComplete(chapter.chapterNumber, wordCount, chapter.title ?? "");

        // Update continuity for next chapter
        previousContinuity = extractedContinuityState 
          ? JSON.stringify(extractedContinuityState)
          : `Capítulo ${chapter.chapterNumber} completado. Termina con: ${chapterContent.slice(-500)}`;
        previousContinuityStateForEditor = extractedContinuityState;
      }

      // Mark project as completed
      await storage.updateProject(project.id, { status: "completed" });
      this.callbacks.onAgentStatus("orchestrator", "completed", 
        `Extensión completada: ${pendingChapters.length} capítulos generados`
      );
      this.callbacks.onProjectComplete();

    } catch (error) {
      console.error("[Orchestrator:Extend] Error:", error);
      this.callbacks.onError(`Error en extensión: ${error instanceof Error ? error.message : "Error desconocido"}`);
      await storage.updateProject(project.id, { status: "error" });
    }
  }

  async runContinuitySentinelForce(project: Project): Promise<void> {
    try {
      this.cumulativeTokens = {
        inputTokens: project.totalInputTokens || 0,
        outputTokens: project.totalOutputTokens || 0,
        thinkingTokens: project.totalThinkingTokens || 0,
      };

      const worldBible = await storage.getWorldBibleByProject(project.id);
      if (!worldBible) {
        this.callbacks.onError("No se encontró la biblia del mundo para este proyecto");
        return;
      }

      const worldBibleData: ParsedWorldBible = {
        world_bible: {
          personajes: worldBible.characters as any[] || [],
          lugares: [],
          reglas_lore: worldBible.worldRules as any[] || [],
        },
        escaleta_capitulos: worldBible.plotOutline as any[] || [],
      };

      let styleGuideContent = "";
      if (project.styleGuideId) {
        const styleGuide = await storage.getStyleGuide(project.styleGuideId);
        if (styleGuide) {
          styleGuideContent = styleGuide.content;
        }
      }

      const chapters = await storage.getChaptersByProject(project.id);
      const allSections = this.buildSectionsListFromChapters(chapters, worldBibleData);
      const guiaEstilo = `Género: ${project.genre}, Tono: ${project.tone}. ${styleGuideContent}`;

      this.callbacks.onAgentStatus("continuity-sentinel", "analyzing", 
        "Ejecutando análisis de continuidad forzado sobre todo el manuscrito..."
      );

      // Run Sentinel on all chapters
      const result = await this.runContinuityCheckpoint(
        project,
        99, // Special checkpoint number indicating forced run
        chapters,
        worldBibleData,
        []
      );

      if (result.passed) {
        this.callbacks.onAgentStatus("continuity-sentinel", "completed", 
          "No se encontraron issues de continuidad"
        );
        await storage.updateProject(project.id, { status: "completed" });
        this.callbacks.onProjectComplete();
        return;
      }

      // Process issues and rewrite affected chapters
      const hasCriticalOrMajor = result.issues.some(issue => 
        issue.includes("[CRITICA]") || issue.includes("[CRÍTICA]") ||
        issue.includes("[MAYOR]") || issue.includes("[mayor]")
      );

      if (hasCriticalOrMajor && result.chaptersToRevise.length > 0) {
        this.callbacks.onAgentStatus("continuity-sentinel", "warning", 
          `${result.issues.length} issues detectados. Forzando reescritura de capítulos: ${result.chaptersToRevise.join(", ")}`
        );

        const correctionInstructions = result.issues.join("\n");

        for (let idx = 0; idx < result.chaptersToRevise.length; idx++) {
          // Check cancellation before each chapter correction
          if (await isProjectCancelledFromDb(project.id)) {
            console.log(`[Orchestrator] Force sentinel corrections cancelled at chapter ${idx + 1}/${result.chaptersToRevise.length}`);
            return;
          }
          
          const chapterNum = result.chaptersToRevise[idx];
          const chapter = chapters.find(c => c.chapterNumber === chapterNum);
          const sectionData = allSections.find(s => s.numero === chapterNum);

          if (chapter && sectionData) {
            this.callbacks.onAgentStatus("continuity-sentinel", "editing", 
              `Corrigiendo capítulo ${chapterNum} (${idx + 1}/${result.chaptersToRevise.length})`
            );
            
            this.callbacks.onChapterRewrite(
              chapterNum,
              chapter.title || `Capítulo ${chapterNum}`,
              idx + 1,
              result.chaptersToRevise.length,
              "Corrección forzada por Centinela"
            );

            await this.rewriteChapterForQA(
              project,
              chapter,
              sectionData,
              worldBibleData,
              guiaEstilo,
              "continuity",
              correctionInstructions
            );
          }
        }

        this.callbacks.onAgentStatus("continuity-sentinel", "completed", 
          `Reescritura completada para ${result.chaptersToRevise.length} capítulos`
        );
      }

      await storage.updateProject(project.id, { status: "completed" });
      this.callbacks.onProjectComplete();
    } catch (error) {
      console.error("Force continuity sentinel error:", error);
      this.callbacks.onError(`Error en Centinela forzado: ${error instanceof Error ? error.message : "Error desconocido"}`);
      await storage.updateProject(project.id, { status: "error" });
    }
  }

  async regenerateTruncatedChapters(project: Project, minWordCount: number = 100): Promise<void> {
    try {
      this.cumulativeTokens = {
        inputTokens: project.totalInputTokens || 0,
        outputTokens: project.totalOutputTokens || 0,
        thinkingTokens: project.totalThinkingTokens || 0,
      };
      this.currentProjectGenre = project.genre;

      const worldBible = await storage.getWorldBibleByProject(project.id);
      if (!worldBible) {
        this.callbacks.onError("No se encontró la biblia del mundo para este proyecto");
        return;
      }

      const worldBibleData: ParsedWorldBible = {
        world_bible: {
          personajes: worldBible.characters as any[] || [],
          lugares: [],
          reglas_lore: worldBible.worldRules as any[] || [],
        },
        escaleta_capitulos: worldBible.plotOutline as any[] || [],
      };

      let styleGuideContent = "";
      if (project.styleGuideId) {
        const styleGuide = await storage.getStyleGuide(project.styleGuideId);
        if (styleGuide) {
          styleGuideContent = styleGuide.content;
        }
      }

      const chapters = await storage.getChaptersByProject(project.id);
      const allSections = this.buildSectionsListFromChapters(chapters, worldBibleData);
      const guiaEstilo = `Género: ${project.genre}, Tono: ${project.tone}. ${styleGuideContent}`;

      const truncatedChapters = chapters.filter(ch => {
        const wordCount = ch.content ? ch.content.split(/\s+/).length : 0;
        return wordCount < minWordCount;
      });

      if (truncatedChapters.length === 0) {
        this.callbacks.onAgentStatus("ghostwriter", "completed", 
          "No se encontraron capítulos truncados"
        );
        await storage.updateProject(project.id, { status: "completed" });
        this.callbacks.onProjectComplete();
        return;
      }

      this.callbacks.onAgentStatus("ghostwriter", "writing", 
        `Regenerando ${truncatedChapters.length} capítulos truncados: ${truncatedChapters.map(c => c.chapterNumber).join(", ")}`
      );

      for (let i = 0; i < truncatedChapters.length; i++) {
        // Check cancellation before each chapter regeneration
        if (await isProjectCancelledFromDb(project.id)) {
          console.log(`[Orchestrator] Truncated chapter regeneration cancelled at chapter ${i + 1}/${truncatedChapters.length}`);
          return;
        }
        
        const chapter = truncatedChapters[i];
        const sectionData = allSections.find(s => s.numero === chapter.chapterNumber);

        if (!sectionData) {
          console.error(`No section data found for chapter ${chapter.chapterNumber}`);
          continue;
        }

        this.callbacks.onAgentStatus("ghostwriter", "writing", 
          `Regenerando capítulo truncado ${chapter.chapterNumber} (${i + 1}/${truncatedChapters.length})`
        );

        this.callbacks.onChapterRewrite(
          chapter.chapterNumber,
          chapter.title || `Capítulo ${chapter.chapterNumber}`,
          i + 1,
          truncatedChapters.length,
          "Regeneración de capítulo truncado"
        );

        const previousChapters = chapters
          .filter(c => c.chapterNumber < chapter.chapterNumber)
          .sort((a, b) => a.chapterNumber - b.chapterNumber);
        
        const lastThreeChapters = previousChapters.slice(-3).map(c => ({
          numero: c.chapterNumber,
          titulo: c.title,
          contenido: c.content
        }));

        this.callbacks.onAgentStatus("ghostwriter", "writing", 
          `Escribiendo Capítulo ${chapter.chapterNumber}: "${sectionData.titulo}"`
        );

        const previousContinuity = lastThreeChapters.length > 0 
          ? `Resumen de capítulos anteriores:\n${lastThreeChapters.map(c => `Cap ${c.numero} "${c.titulo}": ${c.contenido?.slice(0, 500)}...`).join("\n\n")}`
          : "";

        // Retry loop for truncated responses
        const MAX_REGENERATION_ATTEMPTS = 3;
        // Use project's per-chapter settings, fallback to calculated from total
        // SPECIAL: Author's Note has different word limits (800-1200 words)
        const isAuthorNoteRegen = chapter.chapterNumber === -2;
        const calculatedTargetRegen = this.calculatePerChapterTarget((project as any).minWordCount, chapters.length);
        const perChapterMinRegen = isAuthorNoteRegen ? 800 : ((project as any).minWordsPerChapter || calculatedTargetRegen);
        const perChapterMaxRegen = isAuthorNoteRegen ? 1200 : ((project as any).maxWordsPerChapter || Math.round(perChapterMinRegen * 1.15));
        const MARGIN_REGEN = 0.15; // 15% flexibility
        const TARGET_MIN_WORDS = Math.round(perChapterMinRegen * (1 - MARGIN_REGEN));
        const TARGET_MAX_WORDS = perChapterMaxRegen;
        const ABSOLUTE_MIN_WORDS = 500;
        let regenerationAttempt = 0;
        let successfulContent = "";
        let successfulWordCount = 0;

        while (regenerationAttempt < MAX_REGENERATION_ATTEMPTS) {
          regenerationAttempt++;
          
          const writerResult = await this.ghostwriter.execute({
            chapterNumber: chapter.chapterNumber,
            chapterData: sectionData,
            worldBible: worldBibleData.world_bible,
            guiaEstilo,
            previousContinuity,
            refinementInstructions: regenerationAttempt > 1 
              ? `CRÍTICO: Tu respuesta anterior fue TRUNCADA. DEBES escribir el capítulo COMPLETO con ${TARGET_MIN_WORDS}-${TARGET_MAX_WORDS} palabras.`
              : "",
            authorName: "",
            isRewrite: regenerationAttempt > 1,
            minWordCount: perChapterMinRegen,
            maxWordCount: perChapterMaxRegen,
            kindleUnlimitedOptimized: (project as any).kindleUnlimitedOptimized || false,
          });

          await this.trackTokenUsage(project.id, writerResult.tokenUsage, "El Narrador", "gemini-3-pro-preview", chapter.chapterNumber, "chapter_regenerate");

          // CRITICAL: Validate that content exists before processing
          if (!writerResult.content || writerResult.content.trim().length === 0) {
            console.error(`[Orchestrator] CRITICAL: Ghostwriter returned NULL/EMPTY content for Chapter ${chapter.chapterNumber} (regenerate). Retrying...`);
            continue; // Will try again on next iteration
          }

          const { cleanContent } = this.ghostwriter.extractContinuityState(writerResult.content);
          
          // CRITICAL: Double-check after extraction that content is not empty
          if (!cleanContent || cleanContent.trim().length === 0) {
            console.error(`[Orchestrator] CRITICAL: Content extraction resulted in EMPTY content for Chapter ${chapter.chapterNumber} (regenerate). Retrying...`);
            continue; // Will try again on next iteration
          }
          
          const wordCount = cleanContent.split(/\s+/).filter((w: string) => w.length > 0).length;

          // Accept if it meets the target minimum (with 15% margin)
          if (wordCount >= TARGET_MIN_WORDS) {
            successfulContent = cleanContent;
            successfulWordCount = wordCount;
            break;
          }
          
          // On last attempt, save as needs_expansion if below target but above absolute min
          if (regenerationAttempt >= MAX_REGENERATION_ATTEMPTS && wordCount >= ABSOLUTE_MIN_WORDS) {
            console.warn(`[Orchestrator] Capítulo ${chapter.chapterNumber} corto (${wordCount}/${TARGET_MIN_WORDS}-${TARGET_MAX_WORDS}). Guardando para expansión.`);
            await storage.updateChapter(chapter.id, {
              content: cleanContent,
              wordCount: wordCount,
              status: "needs_expansion",
              needsRevision: true,
              revisionReason: `Capítulo corto: ${wordCount}/${TARGET_MIN_WORDS}-${TARGET_MAX_WORDS} palabras después de ${MAX_REGENERATION_ATTEMPTS} intentos`
            });
            this.callbacks.onAgentStatus("ghostwriter", "warning", 
              `Capítulo ${chapter.chapterNumber} guardado con ${wordCount} palabras. Requiere expansión.`
            );
            break; // Move to next chapter
          }

          console.warn(`[Orchestrator] Capítulo ${chapter.chapterNumber} corto (${wordCount}/${TARGET_MIN_WORDS}-${TARGET_MAX_WORDS} palabras). Intento ${regenerationAttempt}/${MAX_REGENERATION_ATTEMPTS}`);
          this.callbacks.onAgentStatus("ghostwriter", "warning", 
            `Capítulo ${chapter.chapterNumber} corto (${wordCount}/${TARGET_MIN_WORDS}-${TARGET_MAX_WORDS} palabras). Reintentando ${regenerationAttempt}/${MAX_REGENERATION_ATTEMPTS}...`
          );
          
          // Wait before retry
          await new Promise(resolve => setTimeout(resolve, 15000));
        }

        if (successfulWordCount < ABSOLUTE_MIN_WORDS) {
          console.error(`[Orchestrator] Capítulo ${chapter.chapterNumber} sigue truncado después de ${MAX_REGENERATION_ATTEMPTS} intentos`);
          this.callbacks.onError(`Capítulo ${chapter.chapterNumber} no pudo regenerarse correctamente después de ${MAX_REGENERATION_ATTEMPTS} intentos`);
          continue;
        }

        await storage.updateChapter(chapter.id, {
          content: successfulContent,
          status: "completed"
        });

        this.callbacks.onChapterComplete(
          chapter.chapterNumber,
          successfulWordCount,
          sectionData.titulo
        );
      }

      this.callbacks.onAgentStatus("ghostwriter", "completed", 
        `Regeneración completada para ${truncatedChapters.length} capítulos`
      );

      await storage.updateProject(project.id, { status: "completed" });
      this.callbacks.onProjectComplete();
    } catch (error) {
      console.error("Regenerate truncated chapters error:", error);
      this.callbacks.onError(`Error regenerando capítulos: ${error instanceof Error ? error.message : "Error desconocido"}`);
      // Reset to paused instead of error so user can retry
      await storage.updateProject(project.id, { status: "paused" });
      this.callbacks.onAgentStatus("ghostwriter", "idle", "Error en regeneración. Proyecto pausado.");
    }
  }

  private buildSectionsListFromChapters(chapters: Chapter[], worldBibleData: ParsedWorldBible): SectionData[] {
    return chapters.map((chapter, index) => {
      const chapterData = worldBibleData.escaleta_capitulos?.[index] || {};
      let tipo: "prologue" | "chapter" | "epilogue" | "author_note" = "chapter";
      
      if (chapter.title === "Prólogo") tipo = "prologue";
      else if (chapter.title === "Epílogo") tipo = "epilogue";
      else if (chapter.title === "Nota del Autor") tipo = "author_note";

      return {
        numero: chapter.chapterNumber,
        titulo: chapter.title || `Capítulo ${chapter.chapterNumber}`,
        cronologia: chapterData.cronologia || "",
        ubicacion: chapterData.ubicacion || "",
        elenco_presente: chapterData.elenco_presente || [],
        objetivo_narrativo: chapterData.objetivo_narrativo || "",
        beats: chapterData.beats || [],
        continuidad_salida: chapterData.continuidad_salida,
        tipo,
        funcion_estructural: chapterData.funcion_estructural,
        informacion_nueva: chapterData.informacion_nueva,
        conflicto_central: chapterData.conflicto_central,
        giro_emocional: chapterData.giro_emocional,
        riesgos_de_verosimilitud: chapterData.riesgos_de_verosimilitud,
      };
    });
  }

  private buildSectionsList(project: Project, worldBibleData: ParsedWorldBible): SectionData[] {
    const sections: SectionData[] = [];
    const escaleta = worldBibleData.escaleta_capitulos || [];
    
    // Helper to find chapter data by numero instead of by array index
    const findChapterByNumero = (numero: number) => 
      escaleta.find((c: any) => c.numero === numero) || {};

    // Check if this is a bookbox project with structure defined
    const bookboxStructure = (project as any).bookboxStructure as {
      books: Array<{
        bookNumber: number;
        title: string;
        startChapter: number;
        endChapter: number;
        hasPrologue: boolean;
        hasEpilogue: boolean;
      }>;
    } | null;

    const isBookbox = (project as any).workType === "bookbox" && bookboxStructure?.books && bookboxStructure.books.length > 0;

    if (isBookbox) {
      // BOOKBOX MODE: Generate sections for each book in the structure
      let sectionCounter = 0;
      
      for (const book of bookboxStructure!.books) {
        // Add book prologue if it has one
        if (book.hasPrologue) {
          const prologueNumero = -(1000 + book.bookNumber * 10); // Unique negative number for book prologues
          const prologueData = findChapterByNumero(prologueNumero);
          sections.push({
            numero: prologueNumero,
            titulo: prologueData.titulo || `Prólogo - ${book.title}`,
            cronologia: prologueData.cronologia || `Antes del inicio de ${book.title}`,
            ubicacion: prologueData.ubicacion || "",
            elenco_presente: prologueData.elenco_presente || [],
            objetivo_narrativo: prologueData.objetivo_narrativo || `Establecer el tono para ${book.title}`,
            beats: prologueData.beats || ["Gancho inicial", "Presentación del contexto", "Sembrar intriga"],
            tipo: "book_prologue",
            bookNumber: book.bookNumber,
            bookTitle: book.title,
            continuidad_salida: prologueData.continuidad_salida,
            funcion_estructural: prologueData.funcion_estructural,
            riesgos_de_verosimilitud: prologueData.riesgos_de_verosimilitud,
          });
          sectionCounter++;
        }

        // Add chapters for this book
        for (let chapterNum = book.startChapter; chapterNum <= book.endChapter; chapterNum++) {
          const chapterData = findChapterByNumero(chapterNum);
          sections.push({
            numero: chapterNum,
            titulo: chapterData.titulo || `Capítulo ${chapterNum}`,
            cronologia: chapterData.cronologia || "",
            ubicacion: chapterData.ubicacion || "",
            elenco_presente: chapterData.elenco_presente || [],
            objetivo_narrativo: chapterData.objetivo_narrativo || "",
            beats: chapterData.beats || [],
            continuidad_salida: chapterData.continuidad_salida,
            continuidad_entrada: chapterData.continuidad_entrada,
            tipo: "chapter",
            bookNumber: book.bookNumber,
            bookTitle: book.title,
            funcion_estructural: chapterData.funcion_estructural,
            informacion_nueva: chapterData.informacion_nueva,
            pregunta_dramatica: chapterData.pregunta_dramatica,
            conflicto_central: chapterData.conflicto_central,
            giro_emocional: chapterData.giro_emocional,
            recursos_literarios_sugeridos: chapterData.recursos_literarios_sugeridos,
            tono_especifico: chapterData.tono_especifico,
            prohibiciones_este_capitulo: chapterData.prohibiciones_este_capitulo,
            arcos_que_avanza: chapterData.arcos_que_avanza,
            riesgos_de_verosimilitud: chapterData.riesgos_de_verosimilitud,
          });
          sectionCounter++;
        }

        // Add book epilogue if it has one
        if (book.hasEpilogue) {
          const epilogueNumero = -(2000 + book.bookNumber * 10); // Unique negative number for book epilogues
          const epilogueData = findChapterByNumero(epilogueNumero);
          sections.push({
            numero: epilogueNumero,
            titulo: epilogueData.titulo || `Epílogo - ${book.title}`,
            cronologia: epilogueData.cronologia || `Después del final de ${book.title}`,
            ubicacion: epilogueData.ubicacion || "",
            elenco_presente: epilogueData.elenco_presente || [],
            objetivo_narrativo: epilogueData.objetivo_narrativo || `Cerrar los arcos de ${book.title}`,
            beats: epilogueData.beats || ["Resolución", "Transición", "Cierre emocional"],
            tipo: "book_epilogue",
            bookNumber: book.bookNumber,
            bookTitle: book.title,
            continuidad_entrada: epilogueData.continuidad_entrada,
            funcion_estructural: epilogueData.funcion_estructural,
          });
          sectionCounter++;
        }
      }

      // Add author note at the end if project has one
      if (project.hasAuthorNote) {
        sections.push({
          numero: -2,
          titulo: "Nota del Autor",
          cronologia: "",
          ubicacion: "",
          elenco_presente: [],
          objetivo_narrativo: "Reflexiones del autor sobre el proceso creativo y la historia",
          beats: ["Agradecimientos", "Inspiración de la obra", "Mensaje personal"],
          tipo: "author_note",
        });
      }

      console.log(`[Orchestrator] Bookbox structure built: ${sections.length} sections across ${bookboxStructure!.books.length} books`);
      return sections;
    }

    // STANDARD MODE: Original behavior for non-bookbox projects
    if (project.hasPrologue) {
      // Look for prologue data from Architect (numero=0) instead of using synthetic defaults
      const prologueData = findChapterByNumero(0);
      sections.push({
        numero: 0,
        titulo: prologueData.titulo || "Prólogo",
        cronologia: prologueData.cronologia || "Antes del inicio de la historia",
        ubicacion: prologueData.ubicacion || "",
        elenco_presente: prologueData.elenco_presente || [],
        objetivo_narrativo: prologueData.objetivo_narrativo || "Establecer el tono y generar intriga para la historia que está por comenzar",
        beats: prologueData.beats || ["Gancho inicial", "Presentación del mundo", "Sembrar misterio"],
        tipo: "prologue",
        continuidad_salida: prologueData.continuidad_salida,
        funcion_estructural: prologueData.funcion_estructural,
        informacion_nueva: prologueData.informacion_nueva,
        conflicto_central: prologueData.conflicto_central,
        giro_emocional: prologueData.giro_emocional,
        riesgos_de_verosimilitud: prologueData.riesgos_de_verosimilitud,
      });
    }

    // Build chapters 1 through chapterCount by looking up by numero, not by array index
    for (let chapterNum = 1; chapterNum <= project.chapterCount; chapterNum++) {
      const chapterData = findChapterByNumero(chapterNum);
      sections.push({
        numero: chapterNum,
        titulo: chapterData.titulo || `Capítulo ${chapterNum}`,
        cronologia: chapterData.cronologia || "",
        ubicacion: chapterData.ubicacion || "",
        elenco_presente: chapterData.elenco_presente || [],
        objetivo_narrativo: chapterData.objetivo_narrativo || "",
        beats: chapterData.beats || [],
        continuidad_salida: chapterData.continuidad_salida,
        continuidad_entrada: chapterData.continuidad_entrada,
        tipo: "chapter",
        funcion_estructural: chapterData.funcion_estructural,
        informacion_nueva: chapterData.informacion_nueva,
        pregunta_dramatica: chapterData.pregunta_dramatica,
        conflicto_central: chapterData.conflicto_central,
        giro_emocional: chapterData.giro_emocional,
        recursos_literarios_sugeridos: chapterData.recursos_literarios_sugeridos,
        tono_especifico: chapterData.tono_especifico,
        prohibiciones_este_capitulo: chapterData.prohibiciones_este_capitulo,
        arcos_que_avanza: chapterData.arcos_que_avanza,
        riesgos_de_verosimilitud: chapterData.riesgos_de_verosimilitud,
      });
    }

    if (project.hasEpilogue) {
      const epilogueData = findChapterByNumero(-1);
      sections.push({
        numero: -1,
        titulo: epilogueData.titulo || "Epílogo",
        cronologia: epilogueData.cronologia || "Después del final de la historia",
        ubicacion: epilogueData.ubicacion || "",
        elenco_presente: epilogueData.elenco_presente || [],
        objetivo_narrativo: epilogueData.objetivo_narrativo || "Cerrar los arcos narrativos y ofrecer una conclusión satisfactoria",
        beats: epilogueData.beats || ["Resolución final", "Mirada al futuro", "Cierre emocional"],
        tipo: "epilogue",
        continuidad_entrada: epilogueData.continuidad_entrada,
        funcion_estructural: epilogueData.funcion_estructural,
        conflicto_central: epilogueData.conflicto_central,
        giro_emocional: epilogueData.giro_emocional,
      });
    }

    if (project.hasAuthorNote) {
      sections.push({
        numero: -2,
        titulo: "Nota del Autor",
        cronologia: "",
        ubicacion: "",
        elenco_presente: [],
        objetivo_narrativo: "Reflexiones del autor sobre el proceso creativo y la historia",
        beats: ["Agradecimientos", "Inspiración de la obra", "Mensaje personal"],
        tipo: "author_note",
      });
    }

    return sections;
  }

  private getSectionLabel(section: SectionData): string {
    switch (section.tipo) {
      case "prologue":
        return "el Prólogo";
      case "epilogue":
        return "el Epílogo";
      case "author_note":
        return "la Nota del Autor";
      case "book_prologue":
        return section.bookTitle ? `el Prólogo de ${section.bookTitle}` : "el Prólogo del Libro";
      case "book_epilogue":
        return section.bookTitle ? `el Epílogo de ${section.bookTitle}` : "el Epílogo del Libro";
      default:
        return `el Capítulo ${section.numero}`;
    }
  }

  private buildRefinementInstructions(editorResult: EditorResult | undefined): string {
    if (!editorResult) return "";

    const parts: string[] = [];
    
    parts.push(`═══════════════════════════════════════════════════════════════════`);
    parts.push(`FEEDBACK COMPLETO DEL EDITOR - PUNTUACIÓN: ${editorResult.puntuacion}/10`);
    parts.push(`═══════════════════════════════════════════════════════════════════`);
    
    if (editorResult.veredicto) {
      parts.push(`\nVEREDICTO: ${editorResult.veredicto}`);
    }
    
    // CRÍTICO: Errores de continuidad (el problema del cap 16)
    if (editorResult.errores_continuidad && editorResult.errores_continuidad.length > 0) {
      parts.push(`\n🚨 ERRORES DE CONTINUIDAD (CRÍTICO - CORREGIR PRIMERO):\n${editorResult.errores_continuidad.map(e => `  ❌ ${e}`).join("\n")}`);
    }
    
    // Problemas de verosimilitud (deus ex machina, coincidencias)
    if (editorResult.problemas_verosimilitud && editorResult.problemas_verosimilitud.length > 0) {
      parts.push(`\n🚨 PROBLEMAS DE VEROSIMILITUD (CRÍTICO):\n${editorResult.problemas_verosimilitud.map(p => `  ❌ ${p}`).join("\n")}`);
    }
    
    // Beats faltantes del Arquitecto
    if (editorResult.beats_faltantes && editorResult.beats_faltantes.length > 0) {
      parts.push(`\n📋 BEATS FALTANTES (DEBEN INCLUIRSE):\n${editorResult.beats_faltantes.map(b => `  ⚠️ ${b}`).join("\n")}`);
    }
    
    if (editorResult.debilidades_criticas && editorResult.debilidades_criticas.length > 0) {
      parts.push(`\n⚠️ DEBILIDADES A CORREGIR:\n${editorResult.debilidades_criticas.map(d => `  - ${d}`).join("\n")}`);
    }
    
    // Frases repetidas
    if (editorResult.frases_repetidas && editorResult.frases_repetidas.length > 0) {
      parts.push(`\n🔄 FRASES/EXPRESIONES REPETIDAS (VARIAR):\n${editorResult.frases_repetidas.map(f => `  - "${f}"`).join("\n")}`);
    }
    
    // Problemas de ritmo
    if (editorResult.problemas_ritmo && editorResult.problemas_ritmo.length > 0) {
      parts.push(`\n⏱️ PROBLEMAS DE RITMO:\n${editorResult.problemas_ritmo.map(r => `  - ${r}`).join("\n")}`);
    }
    
    // Violaciones de estilo
    if (editorResult.violaciones_estilo && editorResult.violaciones_estilo.length > 0) {
      parts.push(`\n📝 VIOLACIONES DE ESTILO:\n${editorResult.violaciones_estilo.map(v => `  - ${v}`).join("\n")}`);
    }
    
    // Plan quirúrgico detallado
    if (editorResult.plan_quirurgico) {
      const plan = editorResult.plan_quirurgico;
      parts.push(`\n═══════════════════════════════════════════════════════════════════`);
      parts.push(`PLAN QUIRÚRGICO DE CORRECCIÓN (SEGUIR AL PIE DE LA LETRA)`);
      parts.push(`═══════════════════════════════════════════════════════════════════`);
      if (plan.diagnostico) {
        parts.push(`\n📌 DIAGNÓSTICO:\n${plan.diagnostico}`);
      }
      if (plan.procedimiento) {
        parts.push(`\n📌 PROCEDIMIENTO PASO A PASO:\n${plan.procedimiento}`);
      }
      if (plan.objetivo) {
        parts.push(`\n📌 OBJETIVO FINAL:\n${plan.objetivo}`);
      }
    }
    
    // Fortalezas a mantener
    if (editorResult.fortalezas && editorResult.fortalezas.length > 0) {
      parts.push(`\n✅ FORTALEZAS A MANTENER:\n${editorResult.fortalezas.map(f => `  + ${f}`).join("\n")}`);
    }
    
    const vocab = this.getHistoricalVocabularySection();
    if (vocab) {
      parts.push(vocab);
    }

    parts.push(`\n═══════════════════════════════════════════════════════════════════`);
    parts.push(`INSTRUCCIÓN FINAL: Reescribe el capítulo corrigiendo TODOS los problemas`);
    parts.push(`listados arriba. Prioriza errores de continuidad y verosimilitud.`);
    parts.push(`USA SOLO el vocabulario de época permitido. EVITA términos prohibidos.`);
    parts.push(`═══════════════════════════════════════════════════════════════════`);

    return parts.join("\n");
  }

  private getHistoricalVocabularySection(): string | null {
    const vocab = Orchestrator.HISTORICAL_VOCABULARY[this.currentProjectGenre];
    if (!vocab || (vocab.valid.length === 0 && vocab.forbidden.length === 0)) {
      return null;
    }

    const parts: string[] = [];
    parts.push(`\n═══════════════════════════════════════════════════════════════════`);
    parts.push(`VOCABULARIO DE ÉPOCA (CRÍTICO PARA EVITAR ANACRONISMOS)`);
    parts.push(`═══════════════════════════════════════════════════════════════════`);

    if (vocab.forbidden.length > 0) {
      parts.push(`\n🚫 TÉRMINOS PROHIBIDOS (NUNCA USAR):`);
      parts.push(vocab.forbidden.map(t => `  ❌ "${t}"`).join("\n"));
    }

    if (Object.keys(vocab.alternatives).length > 0) {
      parts.push(`\n🔄 ALTERNATIVAS VÁLIDAS:`);
      for (const [forbidden, valid] of Object.entries(vocab.alternatives)) {
        parts.push(`  "${forbidden}" → usar: ${valid}`);
      }
    }

    if (vocab.valid.length > 0) {
      parts.push(`\n✅ VOCABULARIO DE ÉPOCA VÁLIDO (PREFERIR):`);
      parts.push(`  ${vocab.valid.slice(0, 20).join(", ")}${vocab.valid.length > 20 ? "..." : ""}`);
    }

    return parts.join("\n");
  }

  private sanitizeChapterTitles(data: ParsedWorldBible): ParsedWorldBible {
    if (!data.escaleta_capitulos) return data;
    
    data.escaleta_capitulos = data.escaleta_capitulos.map((cap: any) => {
      const numero = cap.numero;
      let titulo = cap.titulo || "";
      
      if (numero > 0) {
        if (titulo.toLowerCase().startsWith("prólogo:") || titulo.toLowerCase().startsWith("prologo:")) {
          const newTitle = titulo.replace(/^pr[oó]logo:\s*/i, "").trim();
          console.log(`[Orchestrator] FIXED title for chapter ${numero}: "${titulo}" → "${newTitle}"`);
          titulo = newTitle;
        }
      }
      
      if (numero !== -1) {
        if (titulo.toLowerCase().startsWith("epílogo:") || titulo.toLowerCase().startsWith("epilogo:")) {
          const newTitle = titulo.replace(/^ep[ií]logo:\s*/i, "").trim();
          console.log(`[Orchestrator] FIXED title for chapter ${numero}: "${titulo}" → "${newTitle}"`);
          titulo = newTitle;
        }
      }
      
      return { ...cap, titulo };
    });
    
    return data;
  }

  private parseArchitectOutput(content: string): ParsedWorldBible {
    console.log(`[Orchestrator] Parsing architect output, length: ${content.length}`);
    
    // Pre-processing: Clean content
    let cleanContent = content
      .replace(/^\uFEFF/, '')  // Remove BOM
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')  // Remove control chars
      .trim();
    
    // Remove markdown code blocks if present
    const jsonBlockMatch = cleanContent.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonBlockMatch) {
      console.log(`[Orchestrator] Found markdown code block, extracting JSON`);
      cleanContent = jsonBlockMatch[1].trim();
    }
    
    console.log(`[Orchestrator] Clean content length: ${cleanContent.length}, starts with: "${cleanContent.substring(0, 50)}"`);
    
    // Método 1: Parse directo
    try {
      const parsed = JSON.parse(cleanContent);
      
      // Normalize: if personajes is at root level, wrap it in world_bible
      if (parsed.personajes && !parsed.world_bible) {
        console.log(`[Orchestrator] Normalizing flat format to world_bible structure`);
        parsed.world_bible = {
          personajes: parsed.personajes,
          lugares: parsed.lugares || [],
          temas_centrales: parsed.temas_centrales || [],
          premisa: parsed.premisa || "",
        };
      }
      
      console.log(`[Orchestrator] Direct JSON parse SUCCESS - Characters: ${parsed.world_bible?.personajes?.length || 0}, Chapters: ${parsed.escaleta_capitulos?.length || 0}`);
      return this.sanitizeChapterTitles(parsed);
    } catch (e1) {
      console.log(`[Orchestrator] Direct parse failed: ${(e1 as Error).message}`);
    }
    
    // Método 2: Extraer JSON del texto (buscar estructura con world_bible)
    try {
      const worldBibleMatch = cleanContent.match(/"world_bible"\s*:/);
      if (worldBibleMatch && worldBibleMatch.index !== undefined) {
        let braceStart = cleanContent.lastIndexOf('{', worldBibleMatch.index);
        if (braceStart !== -1) {
          let depth = 0;
          let jsonEnd = -1;
          for (let i = braceStart; i < cleanContent.length; i++) {
            if (cleanContent[i] === '{') depth++;
            if (cleanContent[i] === '}') {
              depth--;
              if (depth === 0) {
                jsonEnd = i + 1;
                break;
              }
            }
          }
          
          if (jsonEnd !== -1) {
            const jsonStr = cleanContent.substring(braceStart, jsonEnd);
            const parsed = JSON.parse(jsonStr);
            console.log(`[Orchestrator] Extracted JSON SUCCESS - Characters: ${parsed.world_bible?.personajes?.length || 0}, Chapters: ${parsed.escaleta_capitulos?.length || 0}`);
            return this.sanitizeChapterTitles(parsed);
          }
        }
      }
    } catch (e2) {
      console.log(`[Orchestrator] JSON extraction method 2 failed: ${(e2 as Error).message}`);
    }
    
    // Método 3: Buscar primer { y último } (fallback)
    try {
      const firstBrace = cleanContent.indexOf('{');
      const lastBrace = cleanContent.lastIndexOf('}');
      
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        const jsonStr = cleanContent.substring(firstBrace, lastBrace + 1);
        const parsed = JSON.parse(jsonStr);
        console.log(`[Orchestrator] Fallback JSON parse SUCCESS - Characters: ${parsed.world_bible?.personajes?.length || 0}, Chapters: ${parsed.escaleta_capitulos?.length || 0}`);
        return this.sanitizeChapterTitles(parsed);
      }
    } catch (e3) {
      console.log(`[Orchestrator] Fallback parse failed: ${(e3 as Error).message}`);
    }
    
    // Método 4: Try with repaired JSON (fix common issues)
    try {
      let repairedContent = cleanContent
        .replace(/,\s*}/g, '}')  // Remove trailing commas before }
        .replace(/,\s*]/g, ']')  // Remove trailing commas before ]
        .replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3');  // Quote unquoted keys
      
      const firstBrace = repairedContent.indexOf('{');
      const lastBrace = repairedContent.lastIndexOf('}');
      
      if (firstBrace !== -1 && lastBrace !== -1) {
        const jsonStr = repairedContent.substring(firstBrace, lastBrace + 1);
        const parsed = JSON.parse(jsonStr);
        console.log(`[Orchestrator] Repaired JSON parse SUCCESS - Characters: ${parsed.world_bible?.personajes?.length || 0}, Chapters: ${parsed.escaleta_capitulos?.length || 0}`);
        return this.sanitizeChapterTitles(parsed);
      }
    } catch (e4) {
      console.log(`[Orchestrator] Repaired JSON parse failed: ${(e4 as Error).message}`);
    }
    
    // CRITICAL: Log the first 3000 chars to see what architect returned
    console.error(`[Orchestrator] ALL PARSE METHODS FAILED. Content preview (first 3000 chars):\n${cleanContent.substring(0, 3000)}`);
    console.error(`[Orchestrator] Content ends with (last 500 chars):\n${cleanContent.substring(cleanContent.length - 500)}`);
    
    return {
      world_bible: { personajes: [], lugares: [], reglas_lore: [] },
      escaleta_capitulos: [],
    };
  }

  private convertCharacters(data: ParsedWorldBible): Character[] {
    // Try multiple possible locations for characters array (use any for flexible access)
    const d = data as any;
    const personajes = d.world_bible?.personajes 
      || d.world_bible?.characters 
      || d.personajes 
      || d.characters 
      || [];
    
    console.log(`[Orchestrator] Converting ${personajes.length} characters`);
    
    return personajes.map((p: any) => {
      // Extraer apariencia inmutable del formato del Architect
      const aparienciaRaw = p.apariencia_inmutable || p.aparienciaInmutable || p.appearance || {};
      return {
        name: p.nombre || p.name || "",
        role: p.rol || p.role || "",
        psychologicalProfile: p.perfil_psicologico || p.psychologicalProfile || p.psychology || "",
        arc: p.arco || p.arc || "",
        relationships: p.relaciones || p.relationships || [],
        isAlive: p.vivo !== false && p.isAlive !== false,
        // CRÍTICO: Preservar apariencia física para continuidad
        aparienciaInmutable: {
          ojos: aparienciaRaw.ojos || aparienciaRaw.color_ojos || aparienciaRaw.eyes || "",
          cabello: aparienciaRaw.cabello || aparienciaRaw.color_cabello || aparienciaRaw.hair || "",
          rasgosDistintivos: aparienciaRaw.rasgos_distintivos || aparienciaRaw.rasgosDistintivos || aparienciaRaw.features || [],
          altura: aparienciaRaw.altura || aparienciaRaw.estatura || aparienciaRaw.height || "",
          edad: aparienciaRaw.edad || aparienciaRaw.edad_aparente || aparienciaRaw.age || "",
        },
      };
    });
  }

  private convertWorldRules(data: ParsedWorldBible): WorldRule[] {
    // Try multiple possible locations for rules array (use any for flexible access)
    const d = data as any;
    const reglas = d.world_bible?.reglas_lore 
      || d.world_bible?.rules 
      || d.world_bible?.world_rules
      || d.reglas_lore 
      || d.rules 
      || [];
    
    console.log(`[Orchestrator] Converting ${reglas.length} world rules`);
    
    return reglas.map((r: any) => ({
      category: r.categoria || r.category || "General",
      rule: r.regla || r.rule || r.descripcion || r.description || "",
      constraints: r.restricciones || r.constraints || r.limitaciones || [],
    }));
  }

  private convertTimeline(data: ParsedWorldBible): TimelineEvent[] {
    return (data.escaleta_capitulos || []).map((c: any) => ({
      chapter: c.numero || 0,
      event: c.objetivo_narrativo || c.titulo || "",
      characters: c.elenco_presente || [],
      significance: c.continuidad_salida || "",
    }));
  }

  private convertPlotOutline(data: ParsedWorldBible): PlotOutline {
    // Try multiple possible locations for structure (use any for flexible access)
    const d = data as any;
    const acts = d.estructura_tres_actos || d.three_act_structure || d.estructura || {};
    const premise = d.premisa || d.premise || d.world_bible?.premisa || "";
    
    console.log(`[Orchestrator] Converting plot outline - Premise length: ${premise.length}, Chapters: ${(d.escaleta_capitulos || []).length}`);
    
    return {
      premise,
      threeActStructure: {
        act1: {
          setup: acts.acto1?.planteamiento || "",
          incitingIncident: acts.acto1?.incidente_incitador || "",
        },
        act2: {
          risingAction: acts.acto2?.accion_ascendente || "",
          midpoint: acts.acto2?.punto_medio || "",
          complications: acts.acto2?.complicaciones || "",
        },
        act3: {
          climax: acts.acto3?.climax || "",
          resolution: acts.acto3?.resolucion || "",
        },
      },
      chapterOutlines: (data.escaleta_capitulos || []).map((c: any) => ({
        number: c.numero,
        summary: c.objetivo_narrativo || "",
        keyEvents: c.beats || [],
        // Datos adicionales para propagación completa en reanudaciones
        titulo: c.titulo,
        cronologia: c.cronologia,
        ubicacion: c.ubicacion,
        elenco_presente: c.elenco_presente,
        funcion_estructural: c.funcion_estructural,
        informacion_nueva: c.informacion_nueva,
        pregunta_dramatica: c.pregunta_dramatica,
        conflicto_central: c.conflicto_central,
        giro_emocional: c.giro_emocional,
        recursos_literarios_sugeridos: c.recursos_literarios_sugeridos,
        tono_especifico: c.tono_especifico,
        prohibiciones_este_capitulo: c.prohibiciones_este_capitulo,
        arcos_que_avanza: c.arcos_que_avanza,
        continuidad_entrada: c.continuidad_entrada,
        continuidad_salida: c.continuidad_salida,
        riesgos_de_verosimilitud: c.riesgos_de_verosimilitud,
      })),
    };
  }

  private async updateWorldBibleTimeline(projectId: number, worldBibleId: number, chapterNumber: number, chapterData: any): Promise<void> {
    const worldBible = await storage.getWorldBibleByProject(projectId);
    if (worldBible) {
      const timeline = (worldBible.timeline || []) as TimelineEvent[];
      
      const existingIndex = timeline.findIndex(t => t.chapter === chapterNumber);
      const newEvent: TimelineEvent = {
        chapter: chapterNumber,
        event: chapterData.objetivo_narrativo || `Eventos del capítulo ${chapterNumber}`,
        characters: chapterData.elenco_presente || [],
        significance: chapterData.continuidad_salida || "",
      };
      
      if (existingIndex >= 0) {
        timeline[existingIndex] = newEvent;
      } else {
        timeline.push(newEvent);
      }
      
      await storage.updateWorldBible(worldBible.id, { timeline });
    }
  }

  private async runContinuityCheckpoint(
    project: Project,
    checkpointNumber: number,
    chaptersInScope: Chapter[],
    worldBibleData: ParsedWorldBible,
    previousIssues: string[]
  ): Promise<{ passed: boolean; issues: string[]; chaptersToRevise: number[] }> {
    this.callbacks.onAgentStatus("continuity-sentinel", "analyzing", 
      `El Centinela está verificando continuidad (Checkpoint #${checkpointNumber})...`
    );

    const chaptersData = chaptersInScope.map(c => ({
      numero: c.chapterNumber,
      titulo: c.title || `Capítulo ${c.chapterNumber}`,
      contenido: c.content || "",
      continuityState: c.continuityState || {},
    }));

    const SENTINEL_TIMEOUT_MS = 5 * 60 * 1000;
    
    let result: Awaited<ReturnType<typeof this.continuitySentinel.execute>>;
    
    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("Sentinel timeout")), SENTINEL_TIMEOUT_MS);
      });
      
      result = await Promise.race([
        this.continuitySentinel.execute({
          projectTitle: project.title,
          checkpointNumber,
          chaptersInScope: chaptersData,
          worldBible: worldBibleData.world_bible,
          previousCheckpointIssues: previousIssues,
        }),
        timeoutPromise
      ]);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[Orchestrator] Continuity Sentinel error/timeout: ${errorMsg}`);
      this.callbacks.onAgentStatus("continuity-sentinel", "warning", 
        `Checkpoint #${checkpointNumber} omitido por timeout/error. Continuando...`
      );
      return { passed: true, issues: [], chaptersToRevise: [] };
    }

    await this.trackTokenUsage(project.id, result.tokenUsage, "El Centinela", "gemini-3-pro-preview", undefined, "continuity_check");

    if (result.thoughtSignature) {
      await storage.createThoughtLog({
        projectId: project.id,
        agentName: "El Centinela",
        agentRole: "continuity-sentinel",
        thoughtContent: result.thoughtSignature,
      });
    }

    const sentinelResult = result.result;
    
    if (sentinelResult?.checkpoint_aprobado) {
      this.callbacks.onAgentStatus("continuity-sentinel", "completed", 
        `Checkpoint #${checkpointNumber} APROBADO (${sentinelResult.puntuacion}/10). Sin issues de continuidad.`
      );
      return { passed: true, issues: [], chaptersToRevise: [] };
    } else {
      const issueDescriptions = (sentinelResult?.issues || []).map(i => 
        `[${i.severidad.toUpperCase()}] ${i.tipo}: ${i.descripcion}\n⚠️ PRESERVAR: ${i.elementos_a_preservar || "El resto del capítulo"}\n✏️ CORRECCIÓN: ${i.fix_sugerido}`
      );
      
      this.callbacks.onAgentStatus("continuity-sentinel", "warning", 
        `Checkpoint #${checkpointNumber}: ${sentinelResult?.issues?.length || 0} issues detectados. Caps afectados: ${sentinelResult?.capitulos_para_revision?.join(", ") || "N/A"}`
      );
      
      return { 
        passed: false, 
        issues: issueDescriptions, 
        chaptersToRevise: sentinelResult?.capitulos_para_revision || [] 
      };
    }
  }

  private async runVoiceRhythmAudit(
    project: Project,
    trancheNumber: number,
    chaptersInScope: Chapter[],
    styleGuideContent: string
  ): Promise<{ passed: boolean; issues: string[]; chaptersToRevise: number[] }> {
    this.callbacks.onAgentStatus("voice-auditor", "analyzing", 
      `El Auditor de Voz está analizando ritmo y tono (Tramo #${trancheNumber})...`
    );

    const chaptersData = chaptersInScope.map(c => ({
      numero: c.chapterNumber,
      titulo: c.title || `Capítulo ${c.chapterNumber}`,
      contenido: c.content || "",
    }));

    const result = await this.voiceRhythmAuditor.execute({
      projectTitle: project.title,
      trancheNumber,
      genre: project.genre,
      tone: project.tone,
      chaptersInScope: chaptersData,
      guiaEstilo: styleGuideContent || undefined,
    });

    await this.trackTokenUsage(project.id, result.tokenUsage, "El Auditor de Voz", "gemini-3-flash", undefined, "voice_audit");

    if (result.thoughtSignature) {
      await storage.createThoughtLog({
        projectId: project.id,
        agentName: "El Auditor de Voz",
        agentRole: "voice-auditor",
        thoughtContent: result.thoughtSignature,
      });
    }

    const auditResult = result.result;
    
    if (auditResult?.tranche_aprobado) {
      this.callbacks.onAgentStatus("voice-auditor", "completed", 
        `Tramo #${trancheNumber} APROBADO. Voz: ${auditResult.puntuacion_voz}/10, Ritmo: ${auditResult.puntuacion_ritmo}/10`
      );
      return { passed: true, issues: [], chaptersToRevise: [] };
    } else {
      const issueDescriptions = (auditResult?.issues || []).map(i => 
        `[${i.severidad.toUpperCase()}] ${i.tipo}: ${i.descripcion}\n⚠️ PRESERVAR: ${i.elementos_a_preservar || "El resto del capítulo"}\n✏️ CORRECCIÓN: ${i.fix_sugerido}`
      );
      
      this.callbacks.onAgentStatus("voice-auditor", "warning", 
        `Tramo #${trancheNumber}: Voz ${auditResult?.puntuacion_voz || 0}/10, Ritmo ${auditResult?.puntuacion_ritmo || 0}/10. ${auditResult?.issues?.length || 0} issues.`
      );
      
      return { 
        passed: false, 
        issues: issueDescriptions, 
        chaptersToRevise: auditResult?.capitulos_para_revision || [] 
      };
    }
  }

  private async runSemanticRepetitionAnalysis(
    project: Project,
    chapters: Chapter[],
    worldBibleData: ParsedWorldBible
  ): Promise<{ passed: boolean; clusters: any[]; foreshadowingStatus: any[]; chaptersToRevise: number[] }> {
    this.callbacks.onAgentStatus("semantic-detector", "analyzing", 
      `El Detector Semántico está buscando repeticiones y verificando foreshadowing...`
    );

    const chaptersData = chapters
      .filter(c => c.content)
      .sort((a, b) => a.chapterNumber - b.chapterNumber)
      .map(c => ({
        numero: c.chapterNumber,
        titulo: c.title || `Capítulo ${c.chapterNumber}`,
        contenido: c.content || "",
      }));

    const result = await this.semanticRepetitionDetector.execute({
      projectTitle: project.title,
      chapters: chaptersData,
      worldBible: worldBibleData.world_bible,
    });

    await this.trackTokenUsage(project.id, result.tokenUsage, "El Detector Semántico", "gemini-2.5-flash", undefined, "semantic_analysis");

    if (result.thoughtSignature) {
      await storage.createThoughtLog({
        projectId: project.id,
        agentName: "El Detector Semántico",
        agentRole: "semantic-detector",
        thoughtContent: result.thoughtSignature,
      });
    }

    const analysisResult = result.result;
    
    if (analysisResult?.analisis_aprobado) {
      this.callbacks.onAgentStatus("semantic-detector", "completed", 
        `Análisis APROBADO. Originalidad: ${analysisResult.puntuacion_originalidad}/10, Foreshadowing: ${analysisResult.puntuacion_foreshadowing}/10`
      );
    } else {
      const unresolvedForeshadowing = (analysisResult?.foreshadowing_detectado || [])
        .filter(f => f.estado === "sin_payoff").length;
      
      this.callbacks.onAgentStatus("semantic-detector", "warning", 
        `Originalidad: ${analysisResult?.puntuacion_originalidad || 0}/10, Foreshadowing: ${analysisResult?.puntuacion_foreshadowing || 0}/10. ${analysisResult?.clusters?.length || 0} clusters, ${unresolvedForeshadowing} foreshadowing sin resolver.`
      );
    }
    
    return { 
      passed: analysisResult?.analisis_aprobado || false, 
      clusters: analysisResult?.clusters || [],
      foreshadowingStatus: analysisResult?.foreshadowing_detectado || [],
      chaptersToRevise: analysisResult?.capitulos_para_revision || []
    };
  }

  private async rewriteChapterForQA(
    project: Project,
    chapter: Chapter,
    sectionData: any,
    worldBibleData: ParsedWorldBible,
    guiaEstilo: string,
    qaSource: "continuity" | "voice" | "semantic",
    correctionInstructions: string
  ): Promise<void> {
    const qaLabels = {
      continuity: "Centinela de Continuidad",
      voice: "Auditor de Voz",
      semantic: "Detector Semántico"
    };

    await storage.updateChapter(chapter.id, { 
      status: "revision",
      needsRevision: true,
      revisionReason: correctionInstructions 
    });

    this.callbacks.onChapterStatusChange(chapter.chapterNumber, "revision");
    
    const sectionLabel = this.getSectionLabel(sectionData);
    
    // Use CopyEditor for microsurgery instead of Ghostwriter for full rewrite
    // Report as ghostwriter for UI compatibility
    this.callbacks.onAgentStatus("ghostwriter", "writing", 
      `Microcirugía ${sectionLabel} por ${qaLabels[qaSource]}`
    );

    // Get continuity context for corrections (especially important for continuity QA)
    const allChapters = await storage.getChaptersByProject(project.id);
    const previousChapter = allChapters.find(c => c.chapterNumber === chapter.chapterNumber - 1);
    const continuityContext = previousChapter?.content 
      ? `\nCONTEXTO DE CONTINUIDAD (final del capítulo anterior):\n${previousChapter.content.slice(-1500)}\n` 
      : "";

    // Build targeted correction prompt for CopyEditor
    const correctionPrompt = `
CORRECCIONES ESPECÍFICAS DE ${qaLabels[qaSource].toUpperCase()}:
${correctionInstructions}
${continuityContext}
MODO MICROCIRUGÍA OBLIGATORIO:
- Modifica SOLO las frases/párrafos que causan el problema
- Preserva el 95% del texto original INTACTO
- NO reescribas secciones que funcionan bien
- Aplica cambios quirúrgicos mínimos
- Mantén la continuidad con el capítulo anterior
${guiaEstilo}`;

    const copyEditResult = await this.copyeditor.execute({
      chapterNumber: chapter.chapterNumber,
      chapterTitle: chapter.title || `Capítulo ${chapter.chapterNumber}`,
      chapterContent: chapter.content || "",
      guiaEstilo: correctionPrompt,
    });

    await this.trackTokenUsage(project.id, copyEditResult.tokenUsage, "El Estilista", "gemini-3-pro-preview", chapter.chapterNumber, "qa_microsurgery");

    const correctedContent = copyEditResult.result?.texto_final;
    if (correctedContent) {
      const wordCount = correctedContent.split(/\s+/).filter((w: string) => w.length > 0).length;
      
      await storage.updateChapter(chapter.id, {
        content: correctedContent,
        status: "completed",
        wordCount,
        needsRevision: false,
        revisionReason: null,
      });

      this.callbacks.onChapterStatusChange(chapter.chapterNumber, "completed");
      this.callbacks.onAgentStatus("ghostwriter", "completed", 
        `${sectionLabel} corregido (microcirugía)`
      );
    }
  }

  private async polishChapterForVoice(
    project: Project,
    chapter: Chapter,
    styleGuideContent: string,
    voiceIssues: string
  ): Promise<void> {
    await storage.updateChapter(chapter.id, { status: "editing" });
    this.callbacks.onChapterStatusChange(chapter.chapterNumber, "editing");
    
    this.callbacks.onAgentStatus("copyeditor", "polishing", 
      `Puliendo voz y ritmo del capítulo ${chapter.chapterNumber}`
    );

    const copyEditResult = await this.copyeditor.execute({
      chapterNumber: chapter.chapterNumber,
      chapterTitle: chapter.title || `Capítulo ${chapter.chapterNumber}`,
      chapterContent: chapter.content || "",
      guiaEstilo: `${styleGuideContent || "Tone: literary, professional"}\n\nCORRECCIONES DEL AUDITOR DE VOZ:\n${voiceIssues}\n\nAjusta el tono y ritmo según las indicaciones manteniendo el contenido narrativo.`,
    });

    await this.trackTokenUsage(project.id, copyEditResult.tokenUsage, "El Estilista", "gemini-3-pro-preview", chapter.chapterNumber, "voice_polish");

    const polishedContent = copyEditResult.result?.texto_final;
    if (polishedContent) {
      const wordCount = polishedContent.split(/\s+/).filter((w: string) => w.length > 0).length;
      
      await storage.updateChapter(chapter.id, {
        content: polishedContent,
        status: "completed",
        wordCount,
      });

      this.callbacks.onChapterStatusChange(chapter.chapterNumber, "completed");
      this.callbacks.onAgentStatus("copyeditor", "completed", 
        `Capítulo ${chapter.chapterNumber} pulido correctamente`
      );
    }
  }
}
