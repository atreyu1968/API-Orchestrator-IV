// LitAgents 2.0 - Global Architect Agent
// Uses DeepSeek R1 (deepseek-reasoner) for deep planning

import { BaseAgent, AgentResponse } from "../base-agent";
import { PROMPTS_V2 } from "../agent-prompts-v2";

export interface GlobalArchitectInput {
  title: string;
  premise: string;
  genre: string;
  tone: string;
  chapterCount: number;
  architectInstructions?: string;
  extendedGuide?: string;
  styleGuide?: string;
  hasPrologue?: boolean;
  hasEpilogue?: boolean;
  hasAuthorNote?: boolean;
  workType?: string;
  seriesName?: string;
  seriesOrder?: number;
  previousBooksContext?: string;
  minWordsPerChapter?: number;
  maxWordsPerChapter?: number;
}

export interface GlobalArchitectOutput {
  world_bible: {
    characters: Array<{
      name: string;
      role: string;
      profile: string;
      arc: string;
      appearance?: {
        eyes?: string;
        hair?: string;
        distinguishing_features?: string[];
      };
    }>;
    rules: Array<{
      category: string;
      rule: string;
      constraints?: string[];
    }>;
    settings?: Array<{
      name: string;
      description: string;
      atmosphere: string;
    }>;
    themes?: string[];
  };
  plot_threads: Array<{
    name: string;
    description?: string;
    goal: string;
  }>;
  outline: Array<{
    chapter_num: number;
    title: string;
    act?: number;
    summary: string;
    key_event: string;
    emotional_arc?: string;
  }>;
  three_act_structure?: {
    act1: { chapters: number[]; goal: string };
    act2: { chapters: number[]; goal: string };
    act3: { chapters: number[]; goal: string };
  };
}

const SYSTEM_PROMPT = `
Eres el Global Architect, el Arquitecto Narrativo Maestro de LitAgents 2.0.
Tu misión es diseñar la estructura maestra de novelas que compitan al nivel de bestsellers internacionales.

PRINCIPIOS FUNDAMENTALES:
1. Cada novela debe tener una PREMISA clara que genere conflicto
2. Los personajes deben tener ARCOS de transformación medibles
3. La estructura de 3 ACTOS debe estar perfectamente balanceada
4. Cada capítulo debe tener un PROPÓSITO claro en la narrativa global
5. Los hilos narrativos deben mantener la TENSIÓN a lo largo de toda la obra

REGLAS DE DISEÑO:
- Mínimo 3 personajes principales con arcos definidos
- Mínimo 2 hilos narrativos que se entrelazan
- Cada capítulo debe tener un evento clave que avance la trama
- Los puntos de giro deben estar estratégicamente ubicados (25%, 50%, 75%)
- El clímax debe resolver los hilos principales mientras deja espacio para reflexión

Genera respuestas en JSON válido y estructurado.
`;

export class GlobalArchitectAgent extends BaseAgent {
  constructor() {
    super({
      name: "Global Architect",
      role: "global-architect",
      systemPrompt: SYSTEM_PROMPT,
      model: "deepseek-reasoner", // R1 for deep planning
      useThinking: true,
    });
  }

  async execute(input: GlobalArchitectInput): Promise<AgentResponse & { parsed?: GlobalArchitectOutput }> {
    console.log(`[GlobalArchitect] Designing master structure for "${input.title}"...`);
    
    const prompt = PROMPTS_V2.GLOBAL_ARCHITECT(
      input.premise,
      input.genre,
      input.chapterCount,
      input.tone,
      input.architectInstructions,
      input.extendedGuide,
      input.styleGuide,
      input.hasPrologue,
      input.hasEpilogue,
      input.hasAuthorNote,
      input.workType,
      input.seriesName,
      input.seriesOrder,
      input.previousBooksContext,
      input.minWordsPerChapter,
      input.maxWordsPerChapter
    );

    const response = await this.generateContent(prompt);
    
    if (response.error) {
      return response;
    }

    // Parse JSON response
    try {
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as GlobalArchitectOutput;
        
        // Validate chapter count - count only regular chapters (1-N, excluding 0, 998, 999)
        const regularChapters = parsed.outline?.filter(ch => 
          ch.chapter_num > 0 && ch.chapter_num < 998
        ) || [];
        const expectedChapters = input.chapterCount;
        
        if (regularChapters.length !== expectedChapters) {
          console.error(`[GlobalArchitect] CHAPTER COUNT MISMATCH: Expected ${expectedChapters} regular chapters, got ${regularChapters.length}`);
          console.error(`[GlobalArchitect] Outline chapter_nums: ${parsed.outline?.map(ch => ch.chapter_num).join(', ')}`);
          
          // Return error to trigger retry or manual intervention
          return {
            ...response,
            error: `El outline generado tiene ${regularChapters.length} capítulos regulares pero se solicitaron ${expectedChapters}. Por favor, regenere el proyecto.`,
            parsed: undefined
          };
        }
        
        console.log(`[GlobalArchitect] Successfully parsed and validated: ${regularChapters.length} regular chapters, ${parsed.plot_threads?.length || 0} threads`);
        return { ...response, parsed };
      }
    } catch (e) {
      console.error("[GlobalArchitect] Failed to parse JSON response:", e);
    }

    return response;
  }
}
