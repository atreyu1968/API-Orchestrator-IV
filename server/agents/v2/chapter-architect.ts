// LitAgents 2.0 - Chapter Architect Agent
// Uses DeepSeek R1 (deepseek-reasoner) for scene planning

import { BaseAgent, AgentResponse } from "../base-agent";
import { PROMPTS_V2 } from "../agent-prompts-v2";

export interface ChapterArchitectInput {
  chapterOutline: {
    chapter_num: number;
    title: string;
    summary: string;
    key_event: string;
    emotional_arc?: string;
  };
  worldBible: any;
  previousChapterSummary: string;
  storyState: string;
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

  async execute(input: ChapterArchitectInput): Promise<AgentResponse & { parsed?: ChapterArchitectOutput }> {
    console.log(`[ChapterArchitect] Planning scenes for Chapter ${input.chapterOutline.chapter_num}: "${input.chapterOutline.title}"...`);
    
    const prompt = PROMPTS_V2.CHAPTER_ARCHITECT(
      input.chapterOutline,
      input.worldBible,
      input.previousChapterSummary,
      input.storyState
    );

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
