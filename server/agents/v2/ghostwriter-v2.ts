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
  lastSceneEndState?: string; // LitAgents 2.9.5: Physical state at end of previous scene
  chapterOutline?: { chapter_num: number; title: string; summary: string; key_event: string; emotional_arc?: string }; // v2.9.10: Original outline for strict adherence
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

══════════════════════════════════════════════════════════════════════
LA BIBLIA DEL MUNDO SIEMPRE MANDA (v2.9.9+)
══════════════════════════════════════════════════════════════════════
Antes de escribir CUALQUIER detalle sobre un personaje, ubicación u objeto:
1. CONSULTA el World Bible inyectado en el prompt
2. Los atributos físicos (ojos, cabello, altura, cicatrices) son INMUTABLES
3. Los nombres de personajes secundarios NUNCA se inventan ni modifican
4. Las relaciones entre personajes están ESTABLECIDAS - no inventes nuevas
5. La cronología temporal es SAGRADA - respeta fechas y secuencia de eventos

Si un personaje secundario aparece en la escena:
- VERIFICA su nombre exacto en el índice de personajes
- VERIFICA sus atributos físicos antes de describirlo
- VERIFICA su relación con el protagonista
- NO inventes apodos o variaciones del nombre

══════════════════════════════════════════════════════════════════════
COHERENCIA TEMPORAL OBLIGATORIA (v2.9.9+)
══════════════════════════════════════════════════════════════════════
La cronología es MATEMÁTICA - las cuentas DEBEN cuadrar:
1. Si la LÍNEA TEMPORAL ACUMULADA dice que el Cap anterior fue "Día 3, noche",
   este capítulo NO puede empezar en "Día 2" ni saltar a "Día 10" sin transición
2. "Hace X días/semanas" se calcula desde el día actual de la trama, NO desde hoy
3. Si un personaje estaba en Ciudad A al final del capítulo anterior,
   NO puede aparecer en Ciudad B (a 500km) sin viaje explícito o elipsis
4. Las heridas tienen tiempo de curación: un brazo roto NO se cura en 2 días
5. Los eventos recordados DEBEN haber ocurrido en capítulos ANTERIORES
6. Si hay una LÍNEA TEMPORAL ACUMULADA en el contexto, CONSULTARLA antes de
   usar cualquier referencia temporal relativa ("ayer", "hace una semana", etc)

══════════════════════════════════════════════════════════════════════
PROHIBIDO ABSOLUTAMENTE:
══════════════════════════════════════════════════════════════════════
• Clichés de IA: "crucial", "fascinante", "torbellino de emociones", "enigmático"
• Expresiones sobreusadas: "no pudo evitar", "algo en su interior", "sin previo aviso"
• Comentarios de autor: [entre corchetes], notas meta
• Repetir información ya establecida
• Deus ex machina o coincidencias forzadas
• Soluciones fáciles: mensajes anónimos, informantes convenientes, "casualidades"
• Villanos que explican sus planes
• Habilidades no justificadas previamente

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

    // LitAgents 2.9.10: Inject original chapter outline for strict adherence
    if (input.chapterOutline) {
      const outlineBlock = `
╔══════════════════════════════════════════════════════════════════╗
║ 📋 PLAN ORIGINAL DEL CAPÍTULO ${input.chapterOutline.chapter_num} (ADHERENCIA OBLIGATORIA)    ║
╠══════════════════════════════════════════════════════════════════╣
║ TÍTULO: ${input.chapterOutline.title}
║ RESUMEN PLANIFICADO: ${input.chapterOutline.summary}
║ EVENTO CLAVE QUE DEBE OCURRIR: ${input.chapterOutline.key_event}
${input.chapterOutline.emotional_arc ? `║ ARCO EMOCIONAL: ${input.chapterOutline.emotional_arc}` : ''}
╠══════════════════════════════════════════════════════════════════╣
║ ⚠️ REGLA INVIOLABLE: Esta escena es PARTE de este capítulo.     ║
║ El capítulo COMPLETO debe cubrir el RESUMEN y el EVENTO CLAVE  ║
║ descritos arriba. NO inventes eventos diferentes ni omitas     ║
║ el evento clave planificado. NO cambies el orden de eventos.   ║
║ NO añadas subtramas o personajes no mencionados en el plan.    ║
║ SIGUE EL PLAN EXACTAMENTE.                                    ║
║                                                                ║
║ PRIORIDAD DE ADHERENCIA AL PLAN:                               ║
║ 1. El EVENTO CLAVE debe ocurrir explícitamente en el capítulo. ║
║    No basta con insinuarlo — debe EJECUTARSE narrativamente.   ║
║ 2. Los personajes listados en el plan DEBEN aparecer y actuar. ║
║ 3. El ARCO EMOCIONAL planeado debe reflejarse en la prosa.     ║
║ 4. NO desvíes la trama hacia eventos no planificados.          ║
║ 5. Si tu escena es la ÚLTIMA del capítulo, asegúrate de que    ║
║    el evento clave ya haya ocurrido o ocurra en esta escena.   ║
╚══════════════════════════════════════════════════════════════════╝`;
      prompt = `${outlineBlock}\n\n${prompt}`;
      console.log(`[GhostwriterV2] Injected original chapter outline for strict adherence`);
    }

    // LitAgents 2.9.5: Inject proactive pacing guidance based on scene type
    const pacingGuidance = this.generatePacingGuidance(input.scenePlan);
    if (pacingGuidance) {
      prompt = `${pacingGuidance}\n\n${prompt}`;
      console.log(`[GhostwriterV2] Injected proactive pacing guidance`);
    }

    // LitAgents 2.9.5: Inject physical continuity guidance
    const physicalContinuityGuidance = this.generatePhysicalContinuityGuidance(
      input.scenePlan,
      input.prevSceneContext,
      input.lastSceneEndState
    );
    if (physicalContinuityGuidance) {
      prompt = `${physicalContinuityGuidance}\n\n${prompt}`;
      console.log(`[GhostwriterV2] Injected physical continuity guidance`);
    }

    // LitAgents 2.9.5: Inject narrative credibility guidance
    const narrativeCredibilityGuidance = this.generateNarrativeCredibilityGuidance(input.scenePlan);
    if (narrativeCredibilityGuidance) {
      prompt = `${narrativeCredibilityGuidance}\n\n${prompt}`;
      console.log(`[GhostwriterV2] Injected narrative credibility guidance`);
    }

    const response = await this.generateContent(prompt, undefined, { temperature: 1.1, frequencyPenalty: 0.4, presencePenalty: 0.3 });
    
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

  /**
   * LitAgents 2.9.5: Generate proactive pacing guidance based on scene emotional beat
   * Prevents rhythm issues by providing specific instructions for the scene type
   */
  private generatePacingGuidance(scenePlan: ScenePlan): string {
    const emotionalBeat = (scenePlan.emotional_beat || '').toLowerCase();
    const plotBeat = (scenePlan.plot_beat || '').toLowerCase();
    
    // Detect scene type from emotional and plot beats
    const isActionScene = /acción|pelea|persecución|huida|combate|enfrentamiento|escape|lucha|batalla|chase|fight|action/.test(emotionalBeat + plotBeat);
    const isTenseScene = /tensión|suspense|amenaza|peligro|miedo|terror|ansiedad|nervios|alerta/.test(emotionalBeat + plotBeat);
    const isEmotionalScene = /emoción|tristeza|dolor|pérdida|duelo|llanto|despedida|reencuentro|amor|romance|pasión/.test(emotionalBeat + plotBeat);
    const isReflectiveScene = /reflexión|introspección|recuerdo|memoria|pensamiento|meditación|calma|paz|contemplación/.test(emotionalBeat + plotBeat);
    const isDialogueScene = /diálogo|conversación|discusión|debate|negociación|revelación|confesión/.test(emotionalBeat + plotBeat);
    const isClimaxScene = /clímax|punto álgido|confrontación final|revelación mayor|giro dramático/.test(emotionalBeat + plotBeat);

    const guidance: string[] = [];
    guidance.push("╔══════════════════════════════════════════════════════════════════╗");
    guidance.push("║ 🎵 GUÍA DE RITMO PROACTIVA - PREVENCIÓN DE PACING ISSUES        ║");
    guidance.push("╚══════════════════════════════════════════════════════════════════╝");

    if (isActionScene) {
      guidance.push(`
TIPO DE ESCENA DETECTADO: ACCIÓN/MOVIMIENTO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✓ Usa frases CORTAS y PUNZANTES (5-12 palabras por oración)
✓ Verbos de acción en presente o pretérito simple
✓ Párrafos breves (2-4 líneas máximo)
✓ Elimina adjetivos innecesarios - prioriza MOVIMIENTO
✓ Diálogos entrecortados, respiración agitada
✓ Descripciones sensoriales rápidas: dolor, impacto, velocidad

✗ EVITAR: Párrafos largos descriptivos
✗ EVITAR: Reflexiones internas extensas durante la acción
✗ EVITAR: Frases subordinadas complejas
✗ EVITAR: Descripciones detalladas del entorno durante combate`);
    } else if (isTenseScene) {
      guidance.push(`
TIPO DE ESCENA DETECTADO: TENSIÓN/SUSPENSE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✓ Alterna frases cortas con pausas descriptivas
✓ Enfatiza los SILENCIOS y lo que NO se dice
✓ Usa los sentidos: sonidos ominosos, sombras, olores
✓ Tiempo lento: cada segundo se siente eterno
✓ Personajes hiperconscientes del entorno

✗ EVITAR: Resolver la tensión demasiado rápido
✗ EVITAR: Diálogos casuales o humor fuera de lugar
✗ EVITAR: Descripciones rutinarias que rompan la atmósfera`);
    } else if (isEmotionalScene) {
      guidance.push(`
TIPO DE ESCENA DETECTADO: EMOCIONAL/INTIMIDAD
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✓ Ritmo pausado con respiraciones narrativas
✓ Enfócate en gestos pequeños pero significativos
✓ Las emociones son FÍSICAS: nudo en la garganta, peso en el pecho
✓ Permite silencios cargados de significado
✓ Los diálogos pueden ser entrecortados por la emoción

✗ EVITAR: Explicar las emociones - MUÉSTRALAS
✗ EVITAR: Transiciones abruptas a otros temas
✗ EVITAR: Interrumpir momentos emotivos con acción`);
    } else if (isReflectiveScene) {
      guidance.push(`
TIPO DE ESCENA DETECTADO: REFLEXIÓN/INTROSPECCIÓN
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✓ Frases más largas, cadencia contemplativa
✓ Permite divagaciones controladas del pensamiento
✓ Ancla las reflexiones en sensaciones físicas del presente
✓ Usa el entorno como espejo del estado interno

✗ EVITAR: Exceso de "pensó", "reflexionó", "se preguntó"
✗ EVITAR: Monólogos internos sin ancla sensorial
✗ EVITAR: Que la reflexión se extienda más de 2-3 párrafos sin interrupción`);
    } else if (isDialogueScene) {
      guidance.push(`
TIPO DE ESCENA DETECTADO: DIÁLOGO INTENSO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✓ Intercambios rápidos cuando hay tensión
✓ Beats de acción entre réplicas (gestos, miradas, movimientos)
✓ Subtexto: lo que NO dicen es tan importante como lo que dicen
✓ Cada personaje tiene su ritmo vocal único

✗ EVITAR: Párrafos de diálogo sin acción intercalada
✗ EVITAR: Que todos los personajes hablen igual
✗ EVITAR: Exposición larga disfrazada de diálogo`);
    } else if (isClimaxScene) {
      guidance.push(`
TIPO DE ESCENA DETECTADO: CLÍMAX/PUNTO ÁLGIDO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✓ Máxima intensidad - cada palabra cuenta
✓ Alterna entre acción frenética y momentos de suspensión
✓ Las stakes deben sentirse en cada línea
✓ Permite que el lector SIENTA el peso del momento

✗ EVITAR: Detalles irrelevantes que distraigan
✗ EVITAR: Resoluciones demasiado fáciles
✗ EVITAR: Romper la tensión con humor inapropiado`);
    } else {
      // General guidance
      guidance.push(`
GUÍA GENERAL DE RITMO
━━━━━━━━━━━━━━━━━━━━━━
✓ Varía la longitud de las frases para crear dinamismo
✓ Alterna entre acción, diálogo y descripción
✓ Cada párrafo debe impulsar la narrativa hacia adelante
✓ Los cambios de ritmo deben ser GRADUALES, no abruptos

✗ EVITAR: Párrafos uniformemente largos o cortos
✗ EVITAR: Secuencias repetitivas de estructura`);
    }

    guidance.push(`
REGLA DE ORO DEL RITMO: El tempo narrativo debe COINCIDIR con la emoción de la escena.
                        Acción rápida = prosa rápida. Momento íntimo = prosa pausada.`);

    return guidance.join("\n");
  }

  /**
   * LitAgents 2.9.5: Generate proactive physical continuity guidance
   * Prevents physical continuity errors by tracking positions, states, and movements
   */
  private generatePhysicalContinuityGuidance(
    scenePlan: ScenePlan,
    prevSceneContext: string,
    lastSceneEndState?: string
  ): string {
    const guidance: string[] = [];
    guidance.push("╔══════════════════════════════════════════════════════════════════╗");
    guidance.push("║ 🎯 CONTINUIDAD FÍSICA - PREVENCIÓN DE ERRORES ESPACIALES        ║");
    guidance.push("╚══════════════════════════════════════════════════════════════════╝");

    // Extract setting info
    const setting = scenePlan.setting || '';
    const characters = scenePlan.characters || [];

    guidance.push(`
UBICACIÓN DE ESTA ESCENA: ${setting}
PERSONAJES EN ESCENA: ${characters.join(', ')}

REGLAS DE CONTINUIDAD FÍSICA OBLIGATORIAS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. POSICIONES Y MOVIMIENTOS:
   ✓ Si un personaje está sentado, debe LEVANTARSE antes de caminar
   ✓ Si tiene algo en las manos, debe SOLTARLO o GUARDARLO antes de usar las manos
   ✓ Si está en un lugar, debe DESPLAZARSE para llegar a otro
   ✓ Las distancias deben ser coherentes (no puede susurrar desde el otro lado de la sala)

2. OBJETOS Y PERTENENCIAS:
   ✓ Si un personaje sostiene un objeto, sigue sosteniéndolo hasta que lo suelte explícitamente
   ✓ Los objetos no aparecen mágicamente - deben tomarse de algún lugar
   ✓ La ropa y accesorios se mantienen consistentes durante la escena
   ✓ Si algo se rompe o pierde, permanece roto o perdido

3. ESTADO FÍSICO:
   ✓ Las heridas persisten y afectan movimientos
   ✓ El cansancio acumulado se nota en acciones posteriores
   ✓ El clima/temperatura afecta a todos los personajes
   ✓ La iluminación determina qué pueden ver los personajes

4. ENTRADAS Y SALIDAS:
   ✓ Los personajes deben ENTRAR antes de participar
   ✓ Si alguien sale, no puede hablar en la siguiente línea
   ✓ Puertas: si están cerradas, deben abrirse; si abiertas, queda establecido`);

    if (lastSceneEndState) {
      guidance.push(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ESTADO AL FINAL DE LA ESCENA ANTERIOR:
${lastSceneEndState}
→ DEBES continuar desde este estado exacto.`);
    }

    if (prevSceneContext && prevSceneContext.length > 100) {
      // Extract last physical states from context
      guidance.push(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ VERIFICA antes de escribir:
   - ¿Dónde terminó cada personaje en la escena anterior?
   - ¿Qué tenían en las manos?
   - ¿En qué postura estaban (sentados, de pie, acostados)?
   - ¿Había puertas/ventanas abiertas o cerradas?`);
    }

    guidance.push(`
ERRORES COMUNES A EVITAR:
✗ "Cruzó los brazos" → cuando ya tiene algo en las manos
✗ "Se levantó" → cuando ya estaba de pie
✗ "Entró en la habitación" → cuando ya estaba dentro
✗ "Tomó su café" → cuando no se estableció que había café
✗ "Miró por la ventana" → en una habitación sin ventanas establecidas`);

    return guidance.join("\n");
  }

  /**
   * LitAgents 2.9.5: Generate proactive narrative credibility guidance
   * Prevents narrative logic issues and implausible plot developments
   */
  private generateNarrativeCredibilityGuidance(scenePlan: ScenePlan): string {
    const guidance: string[] = [];
    guidance.push("╔══════════════════════════════════════════════════════════════════╗");
    guidance.push("║ 🧠 CREDIBILIDAD NARRATIVA - PREVENCIÓN DE FALLOS LÓGICOS        ║");
    guidance.push("╚══════════════════════════════════════════════════════════════════╝");

    guidance.push(`
REGLAS DE CREDIBILIDAD NARRATIVA:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. CONOCIMIENTO DE PERSONAJES:
   ✓ Un personaje solo puede saber lo que ha visto/oído/le han contado
   ✓ No puede reaccionar a información que desconoce
   ✓ Los secretos permanecen secretos hasta que se revelan EN ESCENA
   ✓ Las deducciones deben basarse en evidencia disponible

2. CAUSALIDAD Y CONSECUENCIAS:
   ✓ Toda acción tiene consecuencias coherentes
   ✓ Las decisiones pasadas afectan el presente
   ✓ No hay coincidencias excesivas ni convenientes
   ✓ Los problemas requieren soluciones proporcionales

3. COMPORTAMIENTO COHERENTE:
   ✓ Los personajes actúan según su personalidad establecida
   ✓ Los cambios de actitud requieren motivación clara
   ✓ Las habilidades deben haberse establecido previamente
   ✓ Las limitaciones (miedos, debilidades) persisten

4. LÓGICA TEMPORAL:
   ✓ El tiempo transcurrido debe ser realista para las acciones
   ✓ Los viajes requieren tiempo proporcional a la distancia
   ✓ Los procesos (curación, aprendizaje) llevan tiempo realista
   ✓ La hora del día afecta la iluminación y actividad

5. VEROSIMILITUD DEL MUNDO:
   ✓ Las reglas del mundo (magia, tecnología) se aplican consistentemente
   ✓ La sociedad/cultura se comporta de forma coherente
   ✓ Las excepciones a las reglas tienen explicación`);

    // Add scene-specific credibility checks
    const plotBeat = scenePlan.plot_beat || '';
    
    if (/revela|descubre|averigua|se entera/.test(plotBeat.toLowerCase())) {
      guidance.push(`
⚠️ ESCENA DE REVELACIÓN DETECTADA:
   → ¿CÓMO se entera el personaje? Debe haber una fuente clara.
   → ¿Es PLAUSIBLE que esta información llegue ahora?
   → ¿Tenía el informante MOTIVO para revelar esto?`);
    }

    if (/llega|aparece|encuentra/.test(plotBeat.toLowerCase())) {
      guidance.push(`
⚠️ ESCENA DE LLEGADA/ENCUENTRO DETECTADA:
   → ¿Es REALISTA que se encuentren en este lugar/momento?
   → ¿Cuánto tiempo de viaje implica? ¿Es coherente con la línea temporal?
   → ¿Hay una razón NARRATIVA para este encuentro o es coincidencia?`);
    }

    if (/resuelve|soluciona|escapa|vence/.test(plotBeat.toLowerCase())) {
      guidance.push(`
⚠️ ESCENA DE RESOLUCIÓN DETECTADA:
   → ¿La solución usa habilidades/recursos ESTABLECIDOS previamente?
   → ¿El esfuerzo es PROPORCIONAL a la dificultad del problema?
   → ¿Se evita el "deus ex machina" (solución mágica conveniente)?`);
    }

    guidance.push(`
ERRORES COMUNES DE CREDIBILIDAD A EVITAR:
✗ Personaje sabe algo que no podría saber
✗ Habilidad aparece sin establecimiento previo
✗ Problema grave se resuelve demasiado fácil
✗ Viaje de horas completado en minutos narrativos
✗ Personaje actúa contra su naturaleza sin motivo
✗ Coincidencia demasiado conveniente para el plot`);

    return guidance.join("\n");
  }
}
