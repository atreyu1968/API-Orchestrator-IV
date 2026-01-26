// LitAgents 2.0 - Ghostwriter V2 Agent
// Uses DeepSeek V3 (deepseek-chat) for fast creative writing
// Writes ONE SCENE at a time instead of full chapters

import { BaseAgent, AgentResponse } from "../base-agent";
import { PROMPTS_V2 } from "../agent-prompts-v2";
import { ScenePlan } from "./chapter-architect";

export interface GhostwriterV2Input {
  scenePlan: ScenePlan;
  prevSceneContext: string;
  rollingSummary: string;
  worldBible: any;
  guiaEstilo: string;
  consistencyConstraints?: string;
}

const SYSTEM_PROMPT = `
Eres el Ghostwriter de LitAgents 2.0, un novelista fantasma de élite especializado en prosa inmersiva.
Tu trabajo es escribir UNA ESCENA a la vez, manteniendo el flujo narrativo perfecto.

REGLAS DE ORO:
1. MUESTRA, NO CUENTES - Las emociones son sensaciones físicas
2. CONTINUIDAD PERFECTA - El texto debe fluir desde el contexto anterior
3. PROSA SENSORIAL - Usa los 5 sentidos, no solo la vista
4. DIÁLOGO ESPAÑOL - Guion largo (—), puntuación correcta
5. NO TERMINES EL CAPÍTULO - Solo termina la escena según el plan

PROHIBIDO ABSOLUTAMENTE:
- Clichés de IA: "crucial", "fascinante", "torbellino de emociones", "enigmático"
- Comentarios de autor: [entre corchetes], notas meta
- Repetir información ya establecida
- Deus ex machina o coincidencias forzadas

Tu output es SOLO el texto narrativo. Sin marcadores, sin comentarios, sin explicaciones.
`;

export class GhostwriterV2Agent extends BaseAgent {
  constructor() {
    super({
      name: "Ghostwriter V2",
      role: "ghostwriter-v2",
      systemPrompt: SYSTEM_PROMPT,
      model: "deepseek-chat", // V3 for fluent creative prose
      useThinking: false,
    });
  }

  async execute(input: GhostwriterV2Input): Promise<AgentResponse> {
    console.log(`[GhostwriterV2] Writing Scene ${input.scenePlan.scene_num}: "${input.scenePlan.plot_beat.substring(0, 50)}..."`);
    
    let prompt = PROMPTS_V2.GHOSTWRITER_SCENE(
      input.scenePlan,
      input.prevSceneContext,
      input.rollingSummary,
      input.worldBible,
      input.guiaEstilo
    );

    if (input.consistencyConstraints) {
      prompt = `${input.consistencyConstraints}\n\n---\n\n${prompt}`;
      console.log(`[GhostwriterV2] Injected consistency constraints (${input.consistencyConstraints.length} chars)`);
    }

    const response = await this.generateContent(prompt, undefined, { temperature: 1.1 });
    
    if (!response.error) {
      const wordCount = response.content.split(/\s+/).length;
      console.log(`[GhostwriterV2] Wrote ${wordCount} words for Scene ${input.scenePlan.scene_num}`);
    }
    
    return response;
  }
}
