// LitAgents 2.0 - Narrative Director Agent
// Uses DeepSeek R1 (deepseek-reasoner) for strategic oversight

import { BaseAgent, AgentResponse } from "../base-agent";
import { PROMPTS_V2 } from "../agent-prompts-v2";

export interface PlotThread {
  name: string;
  status: string;
  goal: string;
  lastUpdatedChapter: number;
}

export interface NarrativeDirectorInput {
  recentSummaries: string;
  plotThreads: PlotThread[];
  currentChapter: number;
  totalChapters: number;
}

export interface ThreadUpdate {
  name: string;
  new_status: string;
  note: string;
}

export interface NarrativeDirectorOutput {
  pacing_assessment: string;
  forgotten_threads: string[];
  tension_level: number;
  tension_recommendation: string;
  character_consistency_issues: string[];
  directive: string;
  thread_updates: ThreadUpdate[];
}

const SYSTEM_PROMPT = `
Eres el Narrative Director de LitAgents 2.0, el Showrunner que supervisa el rumbo de la novela.
Tu trabajo es analizar el progreso cada 5 capítulos y emitir directivas de corrección.

RESPONSABILIDADES:
1. RITMO: ¿La historia avanza o se estanca?
2. HILOS OLVIDADOS: ¿Hay tramas abandonadas demasiado tiempo?
3. TENSIÓN: ¿El nivel es apropiado para este punto de la novela?
4. COHERENCIA: ¿Los personajes actúan de forma consistente?

PUNTOS DE VERIFICACIÓN:
- 25% de la novela: Deberían establecerse todos los conflictos principales
- 50% de la novela: Punto medio con gran revelación o giro
- 75% de la novela: Preparación para el clímax, máxima tensión
- 90% de la novela: Resolución en progreso

Tu directiva será usada por el Ghostwriter para los próximos 5 capítulos.
Sé ESPECÍFICO y ACCIONABLE.

Genera respuestas en JSON válido.
`;

export class NarrativeDirectorAgent extends BaseAgent {
  constructor() {
    super({
      name: "Narrative Director",
      role: "narrative-director",
      systemPrompt: SYSTEM_PROMPT,
      model: "deepseek-reasoner", // R1 for strategic thinking
      useThinking: true,
    });
  }

  async execute(input: NarrativeDirectorInput): Promise<AgentResponse & { parsed?: NarrativeDirectorOutput }> {
    console.log(`[NarrativeDirector] Analyzing progress at Chapter ${input.currentChapter}/${input.totalChapters} (${Math.round(input.currentChapter/input.totalChapters*100)}%)...`);
    
    const prompt = PROMPTS_V2.NARRATIVE_DIRECTOR(
      input.recentSummaries,
      input.plotThreads,
      input.currentChapter,
      input.totalChapters
    );

    const response = await this.generateContent(prompt);
    
    if (response.error) {
      return response;
    }

    // Parse JSON response
    try {
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as NarrativeDirectorOutput;
        console.log(`[NarrativeDirector] Tension: ${parsed.tension_level}/10, Forgotten threads: ${parsed.forgotten_threads?.length || 0}`);
        console.log(`[NarrativeDirector] Directive: ${parsed.directive}`);
        return { ...response, parsed };
      }
    } catch (e) {
      console.error("[NarrativeDirector] Failed to parse JSON response:", e);
    }

    return response;
  }
}
