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
Tu trabajo es descomponer cada capítulo en 3-4 escenas cinematográficas perfectamente estructuradas.

PRINCIPIOS DE DISEÑO DE ESCENAS:
1. Cada escena debe tener un OBJETIVO claro (plot beat + emotional beat)
2. Las escenas deben FLUIR naturalmente una a otra
3. La primera escena conecta con el capítulo anterior
4. La última escena tiene el HOOK más fuerte
5. Varía los tipos: acción, diálogo, reflexión, tensión

ESTRUCTURA IDEAL:
- Escena 1 (300-400 palabras): Conexión + Setup
- Escena 2 (300-400 palabras): Desarrollo + Complicación
- Escena 3 (300-400 palabras): Tensión + Clímax del capítulo
- Escena 4 (200-300 palabras, opcional): Cierre + Hook irresistible

Genera respuestas en JSON válido con el array de scenes.
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

    const response = await this.generateContent(prompt);
    
    if (response.error) {
      return response;
    }

    // Parse JSON response
    try {
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as ChapterArchitectOutput;
        console.log(`[ChapterArchitect] Successfully parsed: ${parsed.scenes?.length || 0} scenes, target: ${parsed.total_word_target} words`);
        return { ...response, parsed };
      }
    } catch (e) {
      console.error("[ChapterArchitect] Failed to parse JSON response:", e);
    }

    return response;
  }
}
