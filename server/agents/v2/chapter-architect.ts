// LitAgents 2.0 - Chapter Architect Agent
// Uses DeepSeek R1 (deepseek-reasoner) for scene planning

import { BaseAgent, AgentResponse } from "../base-agent";
import { PROMPTS_V2 } from "../agent-prompts-v2";

export interface ChapterOutline {
  chapter_num: number;
  title: string;
  summary: string;
  key_event: string;
  emotional_arc?: string;
}

export interface ChapterArchitectInput {
  chapterOutline: ChapterOutline;
  worldBible: any;
  previousChapterSummary: string;
  storyState: string;
  consistencyConstraints?: string;
  fullPlotOutline?: ChapterOutline[]; // Complete plot outline for all chapters
  isKindleUnlimited?: boolean; // LitAgents 2.5: Direct KU flag for guaranteed pacing enforcement
  patternAnalysisContext?: string; // LitAgents 2.9.7: Anti-repetition pattern analysis
}

export interface ScenePlan {
  scene_num: number;
  characters: string[];
  setting: string;
  plot_beat: string;
  emotional_beat: string;
  sensory_details?: string[];
  dialogue_focus?: string;
  ending_hook: string;
  word_target?: number;
  // LitAgents 2.1: Filled after scene is written
  actual_summary?: string; // Brief summary of what actually happened in the scene
  word_count?: number; // Actual word count after writing
}

export interface ChapterArchitectOutput {
  scenes: ScenePlan[];
  chapter_hook: string;
  total_word_target: number;
}

const SYSTEM_PROMPT = `
Eres el Chapter Architect, el Director de Escena de LitAgents 2.0.
Tu trabajo es descomponer cada capítulo en 3-5 escenas cinematográficas perfectamente estructuradas.

PRINCIPIOS DE DISEÑO DE ESCENAS:
1. Cada escena debe tener un OBJETIVO claro (plot beat + emotional beat)
2. Las escenas deben FLUIR naturalmente una a otra
3. La primera escena conecta con el capítulo anterior
4. La última escena tiene el HOOK más fuerte
5. Varía los tipos: acción, diálogo, reflexión, tensión

╔══════════════════════════════════════════════════════════════════╗
║ VARIACIÓN ORGÁNICA DEL NÚMERO DE ESCENAS (LitAgents 2.9)        ║
╠══════════════════════════════════════════════════════════════════╣
║ NO uses siempre 4 escenas. Adapta según la complejidad:         ║
║                                                                  ║
║ • 3 ESCENAS: Capítulos de transición, reflexivos, epílogos      ║
║   - Cuando el capítulo es más introspectivo o de setup menor    ║
║   - Cuando el ritmo requiere brevedad                           ║
║                                                                  ║
║ • 4 ESCENAS: Capítulos estándar de desarrollo                   ║
║   - Equilibrio entre acción y desarrollo                        ║
║   - La mayoría de capítulos del segundo acto                    ║
║                                                                  ║
║ • 5 ESCENAS: Capítulos clímax, confrontaciones, revelaciones    ║
║   - Eventos mayores que requieren más espacio narrativo         ║
║   - Puntos de giro de la trama (25%, 50%, 75%)                  ║
║   - Clímax del tercer acto                                      ║
╚══════════════════════════════════════════════════════════════════╝

ESTRUCTURA FLEXIBLE:
- Escena 1 (300-400 palabras): Conexión + Setup
- Escena 2 (300-400 palabras): Desarrollo + Complicación
- Escena 3 (300-400 palabras): Tensión / Conflicto central
- Escena 4 (200-300 palabras, si aplica): Escalada o resolución parcial
- Escena 5 (200-300 palabras, para clímax): Hook explosivo + Cierre dramático

Genera respuestas en JSON válido con el array de scenes (entre 3 y 5 escenas).
`;

export class ChapterArchitectAgent extends BaseAgent {
  constructor() {
    super({
      name: "Chapter Architect",
      role: "chapter-architect",
      systemPrompt: SYSTEM_PROMPT,
      model: "deepseek-reasoner", // R1 for planning
      useThinking: true,
    });
  }

  /**
   * Format the full plot outline as context for coherent scene planning.
   * Shows past chapters (what already happened), current chapter (what to plan),
   * and future chapters (what's coming next) for full narrative awareness.
   */
  private formatPlotContext(fullOutline: ChapterOutline[], currentChapterNum: number): string {
    const parts: string[] = [];
    parts.push("=== CONTEXTO COMPLETO DE LA TRAMA ===");
    parts.push("IMPORTANTE: Las escenas que diseñes DEBEN ser coherentes con toda la historia, no solo con este capítulo.\n");
    
    // Separate past, current, and future chapters
    const pastChapters = fullOutline.filter(c => c.chapter_num < currentChapterNum);
    const currentChapter = fullOutline.find(c => c.chapter_num === currentChapterNum);
    const futureChapters = fullOutline.filter(c => c.chapter_num > currentChapterNum);
    
    // Past chapters (summarized to save tokens)
    if (pastChapters.length > 0) {
      parts.push("📖 LO QUE YA OCURRIÓ (no contradecir):");
      for (const ch of pastChapters.slice(-5)) { // Only last 5 chapters for context
        parts.push(`  Cap ${ch.chapter_num} "${ch.title}": ${ch.summary}`);
        if (ch.key_event) {
          parts.push(`    → Evento clave: ${ch.key_event}`);
        }
      }
      if (pastChapters.length > 5) {
        parts.push(`  [...${pastChapters.length - 5} capítulos anteriores omitidos para brevedad]`);
      }
      parts.push("");
    }
    
    // Current chapter (what we're planning - highlighted)
    if (currentChapter) {
      parts.push("🎯 CAPÍTULO ACTUAL A DISEÑAR:");
      parts.push(`  Cap ${currentChapter.chapter_num} "${currentChapter.title}"`);
      parts.push(`  Trama: ${currentChapter.summary}`);
      parts.push(`  Evento clave: ${currentChapter.key_event}`);
      if (currentChapter.emotional_arc) {
        parts.push(`  Arco emocional: ${currentChapter.emotional_arc}`);
      }
      parts.push("");
    }
    
    // Future chapters (what's coming - for foreshadowing and setup)
    if (futureChapters.length > 0) {
      parts.push("📅 LO QUE VIENE DESPUÉS (preparar el terreno):");
      for (const ch of futureChapters.slice(0, 3)) { // Only next 3 chapters
        parts.push(`  Cap ${ch.chapter_num} "${ch.title}": ${ch.summary}`);
        if (ch.key_event) {
          parts.push(`    → Prepara: ${ch.key_event}`);
        }
      }
      if (futureChapters.length > 3) {
        parts.push(`  [...${futureChapters.length - 3} capítulos futuros más]`);
      }
      parts.push("");
    }
    
    parts.push("INSTRUCCIONES:");
    parts.push("1. Las escenas deben CONECTAR con lo que ya ocurrió");
    parts.push("2. No introducir elementos que contradigan capítulos anteriores");
    parts.push("3. Preparar sutilmente los eventos de capítulos futuros (foreshadowing)");
    parts.push("4. Mantener coherencia con el arco emocional general");
    
    return parts.join("\n");
  }

  async execute(input: ChapterArchitectInput): Promise<AgentResponse & { parsed?: ChapterArchitectOutput }> {
    console.log(`[ChapterArchitect] Planning scenes for Chapter ${input.chapterOutline.chapter_num}: "${input.chapterOutline.title}"...`);
    
    let prompt = PROMPTS_V2.CHAPTER_ARCHITECT(
      input.chapterOutline,
      input.worldBible,
      input.previousChapterSummary,
      input.storyState
    );

    // LitAgents 2.1: Add full plot context for coherent scene planning
    if (input.fullPlotOutline && input.fullPlotOutline.length > 0) {
      const currentChapterNum = input.chapterOutline.chapter_num;
      const plotContext = this.formatPlotContext(input.fullPlotOutline, currentChapterNum);
      prompt = `${plotContext}\n\n---\n\n${prompt}`;
      console.log(`[ChapterArchitect] Added full plot context (${input.fullPlotOutline.length} chapters)`);
    }

    // LitAgents 2.1: Inject consistency constraints before planning scenes
    if (input.consistencyConstraints) {
      prompt = `${input.consistencyConstraints}\n\n---\n\nAHORA, TENIENDO EN CUENTA LAS RESTRICCIONES DE CONSISTENCIA Y LA TRAMA COMPLETA, diseña las escenas:\n\n${prompt}`;
      console.log(`[ChapterArchitect] Injected consistency constraints (${input.consistencyConstraints.length} chars) - Preventing inconsistent scene planning`);
    }

    // LitAgents 2.9.7: Inject pattern analysis to prevent structural repetition
    if (input.patternAnalysisContext) {
      prompt = `${input.patternAnalysisContext}\n\n---\n\n${prompt}`;
      console.log(`[ChapterArchitect] Injected pattern analysis context (${input.patternAnalysisContext.length} chars) - Anti-repetition enabled`);
    }

    // LitAgents 2.5: Inject KU pacing requirements directly - guaranteed to be present regardless of constraints
    if (input.isKindleUnlimited) {
      const kuPacingDirective = `
╔══════════════════════════════════════════════════════════════════════════════╗
║  ⚡ KINDLE UNLIMITED - RITMO RÁPIDO OBLIGATORIO EN DISEÑO DE ESCENAS ⚡       ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  DISEÑA escenas CORTAS y TENSAS. Cada escena debe:                          ║
║  • Tener un CONFLICTO ACTIVO (no solo conversación)                         ║
║  • Empezar en medio de la acción (in media res)                             ║
║  • Terminar en CLIFFHANGER o momento de tensión                             ║
║  • Máximo 400-500 palabras por escena                                       ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  PROHIBIDO en escenas KU:                                                   ║
║  • Escenas de solo diálogo sin acción física                                ║
║  • Setup lento o "escenas de transición"                                    ║
║  • Más de 3 escenas por capítulo                                            ║
║  • Escenas contemplativas o de pura descripción                             ║
╚══════════════════════════════════════════════════════════════════════════════╝
`;
      prompt = `${kuPacingDirective}\n\n${prompt}`;
      console.log(`[ChapterArchitect] Injected KU pacing directive - FAST PACING ENFORCED`);
    }

    // LitAgents 2.9: Auto-retry on parse failure (up to 3 attempts)
    const maxAttempts = 3;
    let lastResponse: AgentResponse | null = null;
    let totalTokenUsage = { inputTokens: 0, outputTokens: 0, thinkingTokens: 0 };

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const attemptPrompt = attempt > 1 
        ? `${prompt}\n\n⚠️ INTENTO ${attempt}/${maxAttempts}: Tu respuesta anterior no contenía JSON válido. DEBES responder con un objeto JSON válido que contenga: { "scenes": [...], "chapter_hook": "...", "total_word_target": ... }`
        : prompt;

      const response = await this.generateContent(attemptPrompt);
      lastResponse = response;
      
      // Accumulate token usage across retries
      if (response.tokenUsage) {
        totalTokenUsage.inputTokens += response.tokenUsage.inputTokens || 0;
        totalTokenUsage.outputTokens += response.tokenUsage.outputTokens || 0;
        totalTokenUsage.thinkingTokens += response.tokenUsage.thinkingTokens || 0;
      }
      
      if (response.error) {
        console.error(`[ChapterArchitect] Attempt ${attempt}/${maxAttempts} API error:`, response.error);
        if (attempt === maxAttempts) {
          return { ...response, tokenUsage: totalTokenUsage };
        }
        continue;
      }

      // Parse JSON response
      try {
        const jsonMatch = response.content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]) as ChapterArchitectOutput;
          if (parsed.scenes && Array.isArray(parsed.scenes) && parsed.scenes.length > 0) {
            console.log(`[ChapterArchitect] Successfully parsed (attempt ${attempt}): ${parsed.scenes.length} scenes, target: ${parsed.total_word_target} words`);
            return { ...response, parsed, tokenUsage: totalTokenUsage };
          } else {
            console.warn(`[ChapterArchitect] Attempt ${attempt}/${maxAttempts}: JSON parsed but scenes array missing or empty`);
          }
        } else {
          console.warn(`[ChapterArchitect] Attempt ${attempt}/${maxAttempts}: No JSON object found in response`);
        }
      } catch (e) {
        console.error(`[ChapterArchitect] Attempt ${attempt}/${maxAttempts} parse error:`, e);
      }

      if (attempt < maxAttempts) {
        console.log(`[ChapterArchitect] Retrying... (${attempt}/${maxAttempts})`);
      }
    }

    console.error(`[ChapterArchitect] All ${maxAttempts} attempts failed to produce valid JSON`);
    return { ...lastResponse!, tokenUsage: totalTokenUsage };
  }
}
