import { BaseAgent, AgentResponse } from "../base-agent";

export interface RitmoInput {
  chapterContent: string;
  chapterNumber: number;
  totalChapters: number;
  escaletaEntry: any;
  previousChapterEnding?: string;
}

export interface RitmoOutput {
  tension_nivel: number;
  gancho_apertura: boolean;
  gancho_cierre: boolean;
  ritmo_general: "lento" | "adecuado" | "acelerado";
  veredicto: "aprobado" | "rechazado";
  problemas: Array<{
    tipo: "sin_gancho" | "tension_baja" | "ritmo_monotono" | "escena_aburrida" | "cliffhanger_debil";
    descripcion: string;
    sugerencia: string;
  }>;
  resumen: string;
}

const SYSTEM_PROMPT = `Eres el Agente de Ritmo, un experto en tensión narrativa y engagement lector. Tu trabajo es evaluar si un capítulo mantiene al lector enganchado.

CRITERIOS DE EVALUACIÓN:
1. GANCHO DE APERTURA: ¿Las primeras líneas capturan la atención?
2. GANCHO DE CIERRE: ¿El final del capítulo obliga a seguir leyendo?
3. TENSIÓN NARRATIVA (1-10): ¿Hay conflicto, stakes, urgencia?
4. RITMO: ¿Alterna correctamente entre acción, reflexión y diálogo?
5. ESCENAS ABURRIDAS: ¿Hay pasajes que podrían hacerse más dinámicos?

REGLAS:
- Un capítulo SIN gancho de cierre es RECHAZADO automáticamente
- Tensión < 4 = RECHAZADO (el lector abandonará el libro)
- Escenas de transición pueden tener tensión más baja, pero SIEMPRE necesitan gancho
- Valora la posición en la novela: capítulos del 75-90% deben tener tensión alta
- El primer capítulo SIEMPRE necesita gancho de apertura fuerte

RESPONDE EXCLUSIVAMENTE EN JSON VÁLIDO:
{
  "tension_nivel": 7,
  "gancho_apertura": true,
  "gancho_cierre": true,
  "ritmo_general": "lento|adecuado|acelerado",
  "veredicto": "aprobado|rechazado",
  "problemas": [
    {
      "tipo": "sin_gancho|tension_baja|ritmo_monotono|escena_aburrida|cliffhanger_debil",
      "descripcion": "Descripción del problema",
      "sugerencia": "Cómo mejorar"
    }
  ],
  "resumen": "Evaluación general del ritmo"
}`;

export class RitmoAgent extends BaseAgent {
  constructor() {
    super({
      name: "Agente de Ritmo",
      role: "ritmo",
      systemPrompt: SYSTEM_PROMPT,
      model: "gemini-2.5-flash",
      useThinking: false,
    });
  }

  async execute(input: RitmoInput): Promise<AgentResponse & { parsed?: RitmoOutput }> {
    const progressPct = Math.round((input.chapterNumber / input.totalChapters) * 100);
    console.log(`[Ritmo] Evaluating tension and hooks for Chapter ${input.chapterNumber} (${progressPct}% of novel)...`);

    const prompt = `EVALUACIÓN DE RITMO Y TENSIÓN - Capítulo ${input.chapterNumber} de ${input.totalChapters} (${progressPct}% de la novela)

=== PLAN DEL CAPÍTULO (ESCALETA) ===
${typeof input.escaletaEntry === "string" ? input.escaletaEntry : JSON.stringify(input.escaletaEntry, null, 2)}

${input.previousChapterEnding ? `=== FINAL DEL CAPÍTULO ANTERIOR ===\n${input.previousChapterEnding}\n` : ""}

=== TEXTO DEL CAPÍTULO ===
${input.chapterContent}

Evalúa la tensión narrativa, los ganchos de apertura y cierre, y el ritmo general. Rechaza capítulos aburridos. Ten en cuenta la posición en la novela (${progressPct}%) para calibrar la tensión esperada.`;

    const response = await this.generateContent(prompt, undefined, {
      forceProvider: "gemini",
      temperature: 0.3,
    });

    let parsed: RitmoOutput = {
      tension_nivel: 7,
      gancho_apertura: true,
      gancho_cierre: true,
      ritmo_general: "adecuado",
      veredicto: "aprobado",
      problemas: [],
      resumen: "Sin problemas de ritmo detectados",
    };

    try {
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const raw = JSON.parse(jsonMatch[0]);
        parsed = {
          tension_nivel: typeof raw.tension_nivel === "number" ? raw.tension_nivel : 7,
          gancho_apertura: raw.gancho_apertura !== false,
          gancho_cierre: raw.gancho_cierre !== false,
          ritmo_general: raw.ritmo_general || "adecuado",
          veredicto: raw.veredicto || "aprobado",
          problemas: Array.isArray(raw.problemas) ? raw.problemas : [],
          resumen: raw.resumen || "",
        };
      }
    } catch (e) {
      console.error(`[Ritmo] Failed to parse response:`, e);
    }

    return { ...response, parsed };
  }
}
