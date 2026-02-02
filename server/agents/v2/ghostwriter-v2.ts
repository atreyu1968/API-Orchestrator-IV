// LitAgents 2.0 - Ghostwriter V2 Agent
// Uses DeepSeek V3 (deepseek-chat) for fast creative writing
// Writes ONE SCENE at a time instead of full chapters

import { BaseAgent, AgentResponse } from "../base-agent";
import { PROMPTS_V2 } from "../agent-prompts-v2";
import { ScenePlan } from "./chapter-architect";
import { vocabularyTracker } from "./vocabulary-tracker";

export interface GhostwriterV2Input {
  scenePlan: ScenePlan;
  prevSceneContext: string;
  rollingSummary: string;
  worldBible: any;
  guiaEstilo: string;
  consistencyConstraints?: string;
  previousChaptersText?: string;
  currentChapterText?: string;
  seriesWorldBible?: any; // Accumulated knowledge from previous volumes in the series
  errorHistory?: string; // LitAgents 2.9: Past errors to avoid in this project
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

    // LitAgents 2.2: Inject consistency constraints
    if (input.consistencyConstraints) {
      prompt = `${input.consistencyConstraints}\n\n---\n\n${prompt}`;
      console.log(`[GhostwriterV2] Injected consistency constraints (${input.consistencyConstraints.length} chars)`);
    }

    // Series World Bible: Inject accumulated knowledge from previous volumes
    if (input.seriesWorldBible) {
      const seriesContext = this.formatSeriesWorldBible(input.seriesWorldBible);
      if (seriesContext) {
        prompt = `${seriesContext}\n\n---\n\n${prompt}`;
        console.log(`[GhostwriterV2] Injected series world bible context (${seriesContext.length} chars)`);
      }
    }

    // LitAgents 2.2: Generate anti-repetition vocabulary guidance
    if (input.previousChaptersText || input.currentChapterText) {
      const antiRepetitionPrompt = vocabularyTracker.generateAntiRepetitionPrompt(
        input.previousChaptersText || '',
        input.currentChapterText || ''
      );
      if (antiRepetitionPrompt) {
        prompt = `${antiRepetitionPrompt}\n\n${prompt}`;
        console.log(`[GhostwriterV2] Injected anti-repetition vocabulary guidance`);
      }
    }

    // LitAgents 2.9: Inject error history to avoid past mistakes
    if (input.errorHistory) {
      prompt = `${input.errorHistory}\n\n${prompt}`;
      console.log(`[GhostwriterV2] Injected error history (${input.errorHistory.length} chars)`);
    }

    const response = await this.generateContent(prompt, undefined, { temperature: 1.1 });
    
    if (!response.error) {
      const wordCount = response.content.split(/\s+/).length;
      console.log(`[GhostwriterV2] Wrote ${wordCount} words for Scene ${input.scenePlan.scene_num}`);
      
      // LitAgents 2.9: Pre-validation - detect truncated or incomplete scenes
      const content = response.content.trim();
      const lastChar = content.slice(-1);
      const endsWithPunctuation = ['.', '!', '?', '"', '»', ')'].includes(lastChar);
      const hasAbruptEnding = content.endsWith('...') || content.endsWith('—') || !endsWithPunctuation;
      const isTooShort = wordCount < 150; // Scenes should be at least 150 words
      
      if (isTooShort || (hasAbruptEnding && !endsWithPunctuation)) {
        console.warn(`[GhostwriterV2] Scene ${input.scenePlan.scene_num} may be truncated (${wordCount} words, ends with "${lastChar}")`);
        // Could implement auto-retry here in future versions
      }
    }
    
    return response;
  }

  /**
   * Format the series world bible into a context string for the Ghostwriter
   */
  private formatSeriesWorldBible(seriesWorldBible: any): string | null {
    if (!seriesWorldBible) return null;

    const sections: string[] = [];
    sections.push("=== CONTINUIDAD DE LA SERIE (VOLÚMENES ANTERIORES) ===");
    sections.push("IMPORTANTE: Esta información proviene de volúmenes anteriores. DEBES mantener coherencia con estos eventos y personajes establecidos.");

    // Characters from previous volumes
    if (seriesWorldBible.characters && seriesWorldBible.characters.length > 0) {
      sections.push("\n## PERSONAJES ESTABLECIDOS EN LA SERIE:");
      for (const char of seriesWorldBible.characters) {
        let charInfo = `- ${char.name}`;
        if (char.role) charInfo += ` (${char.role})`;
        if (char.current_status) charInfo += ` - Estado actual: ${char.current_status}`;
        if (char.arc_summary) charInfo += `\n  Arco: ${char.arc_summary}`;
        if (char.relationships && char.relationships.length > 0) {
          charInfo += `\n  Relaciones: ${char.relationships.join(", ")}`;
        }
        if (char.last_volume_appearance) charInfo += `\n  Última aparición: Volumen ${char.last_volume_appearance}`;
        sections.push(charInfo);
      }
    }

    // Locations
    if (seriesWorldBible.locations && seriesWorldBible.locations.length > 0) {
      sections.push("\n## LOCACIONES ESTABLECIDAS:");
      for (const loc of seriesWorldBible.locations) {
        let locInfo = `- ${loc.name}`;
        if (loc.significance) locInfo += `: ${loc.significance}`;
        if (loc.current_state) locInfo += ` (Estado actual: ${loc.current_state})`;
        if (loc.key_events && loc.key_events.length > 0) {
          locInfo += `\n  Eventos clave: ${loc.key_events.join("; ")}`;
        }
        sections.push(locInfo);
      }
    }

    // Lessons/themes from previous volumes
    if (seriesWorldBible.lessons && seriesWorldBible.lessons.length > 0) {
      sections.push("\n## LECCIONES Y TEMAS EXPLORADOS:");
      for (const lesson of seriesWorldBible.lessons) {
        let lessonInfo = `- ${lesson.theme || lesson.title}`;
        if (lesson.volume_learned) lessonInfo += ` (Volumen ${lesson.volume_learned})`;
        if (lesson.description) lessonInfo += `: ${lesson.description}`;
        sections.push(lessonInfo);
      }
    }

    // World rules/magic system
    if (seriesWorldBible.worldRules && seriesWorldBible.worldRules.length > 0) {
      sections.push("\n## REGLAS DEL MUNDO (NO VIOLAR):");
      for (const rule of seriesWorldBible.worldRules) {
        let ruleInfo = `- ${rule.rule_name || rule.name}`;
        if (rule.description) ruleInfo += `: ${rule.description}`;
        sections.push(ruleInfo);
      }
    }

    // Timeline events
    if (seriesWorldBible.timelineEvents && seriesWorldBible.timelineEvents.length > 0) {
      sections.push("\n## LÍNEA TEMPORAL DE LA SERIE:");
      const sortedEvents = [...seriesWorldBible.timelineEvents].sort((a: any, b: any) => 
        (a.volume || 0) - (b.volume || 0)
      );
      for (const event of sortedEvents) {
        let eventInfo = `- Vol.${event.volume}: ${event.event}`;
        if (event.consequences) eventInfo += ` → ${event.consequences}`;
        sections.push(eventInfo);
      }
    }

    // Objects/MacGuffins
    if (seriesWorldBible.objects && seriesWorldBible.objects.length > 0) {
      sections.push("\n## OBJETOS SIGNIFICATIVOS:");
      for (const obj of seriesWorldBible.objects) {
        let objInfo = `- ${obj.name}`;
        if (obj.description) objInfo += `: ${obj.description}`;
        if (obj.current_owner) objInfo += ` (Poseedor actual: ${obj.current_owner})`;
        if (obj.current_status) objInfo += ` [${obj.current_status}]`;
        sections.push(objInfo);
      }
    }

    // Secrets/mysteries
    if (seriesWorldBible.secrets && seriesWorldBible.secrets.length > 0) {
      sections.push("\n## SECRETOS Y MISTERIOS:");
      for (const secret of seriesWorldBible.secrets) {
        let secretInfo = `- ${secret.secret}`;
        if (secret.known_by && secret.known_by.length > 0) {
          secretInfo += ` (Conocido por: ${secret.known_by.join(", ")})`;
        }
        if (secret.resolved) {
          secretInfo += " [RESUELTO]";
          if (secret.resolution) secretInfo += `: ${secret.resolution}`;
        } else {
          secretInfo += " [PENDIENTE]";
        }
        sections.push(secretInfo);
      }
    }

    if (sections.length <= 2) {
      return null; // Only header, no actual content
    }

    sections.push("\n=== FIN CONTINUIDAD DE LA SERIE ===");
    return sections.join("\n");
  }
}
