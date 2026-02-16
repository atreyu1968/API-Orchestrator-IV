import { BaseAgent, AgentResponse } from "../base-agent";

export interface InquisidorInput {
  chapterContent: string;
  chapterNumber: number;
  worldBible: any;
  previousChaptersContext: string;
  escaleta: any;
}

export interface InquisidorIssue {
  tipo: "agujero_guion" | "contradiccion" | "vacio_informacion" | "violacion_biblia" | "falta_pista";
  severidad: "critica" | "mayor" | "menor";
  descripcion: string;
  ubicacion: string;
  correccion_exacta: string;
}

export interface InquisidorOutput {
  errores: InquisidorIssue[];
  veredicto: "aprobado" | "requiere_correccion";
  resumen: string;
}

const SYSTEM_PROMPT = `Eres El Inquisidor, un auditor narrativo implacable. Tu misión es encontrar por qué la historia NO funciona.

TIPOS DE ERRORES A DETECTAR:
1. AGUJEROS DE GUION: Eventos que no tienen explicación, acciones sin consecuencias
2. CONTRADICCIONES: Hechos que se contradicen entre capítulos o dentro del mismo capítulo
3. VACÍOS DE INFORMACIÓN: Datos necesarios para entender la trama que nunca se proporcionan
4. VIOLACIONES DE LA WORLD BIBLE: Cualquier desviación de los personajes, reglas, o ubicaciones establecidas
5. FALTA DE PISTAS: Elementos del desenlace que no están sembrados previamente (Chekhov's Gun)

REGLAS:
- Sé implacable. Si encuentras un error, propón la SOLUCIÓN EXACTA que el Editor debe insertar
- Compara TODO contra la World Bible: nombres, atributos físicos, relaciones, cronología
- Verifica que cada personaje actúa de forma consistente con su perfil establecido
- Verifica la lógica causal: cada efecto debe tener su causa

RESPONDE EXCLUSIVAMENTE EN JSON VÁLIDO con esta estructura:
{
  "errores": [
    {
      "tipo": "agujero_guion|contradiccion|vacio_informacion|violacion_biblia|falta_pista",
      "severidad": "critica|mayor|menor",
      "descripcion": "Descripción del error",
      "ubicacion": "Fragmento o párrafo donde ocurre",
      "correccion_exacta": "Texto exacto que debe insertarse o reemplazarse"
    }
  ],
  "veredicto": "aprobado|requiere_correccion",
  "resumen": "Resumen del análisis"
}

Si no hay errores, responde con "errores": [] y "veredicto": "aprobado".`;

export class InquisidorAgent extends BaseAgent {
  constructor() {
    super({
      name: "El Inquisidor",
      role: "inquisidor",
      systemPrompt: SYSTEM_PROMPT,
      model: "deepseek-reasoner",
      useThinking: true,
    });
  }

  async execute(input: InquisidorInput): Promise<AgentResponse & { parsed?: InquisidorOutput }> {
    console.log(`[Inquisidor] Auditing Chapter ${input.chapterNumber} for plot holes and contradictions...`);

    const worldBibleStr = typeof input.worldBible === "string"
      ? input.worldBible
      : JSON.stringify(input.worldBible, null, 2);

    const prompt = `AUDITORÍA DE LORE Y COHERENCIA - Capítulo ${input.chapterNumber}

=== WORLD BIBLE (PUNTO DE VERDAD) ===
${worldBibleStr}

=== ESCALETA DEL CAPÍTULO ===
${typeof input.escaleta === "string" ? input.escaleta : JSON.stringify(input.escaleta, null, 2)}

=== CONTEXTO DE CAPÍTULOS ANTERIORES ===
${input.previousChaptersContext || "Este es el primer capítulo."}

=== TEXTO DEL CAPÍTULO A AUDITAR ===
${input.chapterContent}

Analiza este capítulo buscando TODOS los errores posibles. Compara contra la World Bible y los capítulos anteriores. Sé exhaustivo e implacable.`;

    const response = await this.generateContent(prompt);

    let parsed: InquisidorOutput = {
      errores: [],
      veredicto: "aprobado",
      resumen: "Sin problemas detectados",
    };

    try {
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const raw = JSON.parse(jsonMatch[0]);
        parsed = {
          errores: Array.isArray(raw.errores) ? raw.errores : [],
          veredicto: raw.veredicto || (Array.isArray(raw.errores) && raw.errores.length > 0 ? "requiere_correccion" : "aprobado"),
          resumen: raw.resumen || "",
        };
      }
    } catch (e) {
      console.error(`[Inquisidor] Failed to parse response:`, e);
    }

    return { ...response, parsed };
  }
}
