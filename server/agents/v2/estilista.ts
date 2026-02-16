import { BaseAgent, AgentResponse } from "../base-agent";

export interface EstilistaInput {
  chapterContent: string;
  chapterNumber: number;
  styleGuide: string;
}

export interface EstilistaIssue {
  tipo: "ortografia" | "tipografia" | "tono" | "registro" | "puntuacion" | "formato_dialogo";
  severidad: "critica" | "mayor" | "menor";
  fragmento_original: string;
  correccion: string;
  explicacion: string;
}

export interface EstilistaOutput {
  errores: EstilistaIssue[];
  veredicto: "aprobado" | "requiere_correccion";
  puntuacion_estilo: number;
  resumen: string;
}

const SYSTEM_PROMPT = `Eres El Estilista, un corrector ortotipográfico de élite con temperatura 0. Tu trabajo es garantizar la perfección formal del texto.

ÁREAS DE CORRECCIÓN:
1. ORTOGRAFÍA: Errores ortográficos, acentuación incorrecta, uso de mayúsculas
2. TIPOGRAFÍA: Guiones largos (—) para diálogos, comillas correctas, espaciado
3. TONO: Desviaciones respecto a la guía de estilo del autor
4. REGISTRO: Lenguaje fuera del registro definido (formal/informal/coloquial)
5. PUNTUACIÓN: Comas, puntos, punto y coma mal utilizados
6. FORMATO DE DIÁLOGO: Guion largo seguido de espacio, puntuación dentro del diálogo

REGLAS ESTRICTAS:
- NO cambies el contenido narrativo, solo la forma
- Respeta el estilo del autor definido en la guía
- Los diálogos en español usan guion largo (—), NUNCA comillas
- Verifica coherencia de tiempos verbales dentro de cada párrafo
- No introduzcas cambios de significado

RESPONDE EXCLUSIVAMENTE EN JSON VÁLIDO:
{
  "errores": [
    {
      "tipo": "ortografia|tipografia|tono|registro|puntuacion|formato_dialogo",
      "severidad": "critica|mayor|menor",
      "fragmento_original": "Texto tal como aparece",
      "correccion": "Texto corregido",
      "explicacion": "Por qué se corrige"
    }
  ],
  "veredicto": "aprobado|requiere_correccion",
  "puntuacion_estilo": 8,
  "resumen": "Resumen de la calidad estilística"
}`;

export class EstilistaAgent extends BaseAgent {
  constructor() {
    super({
      name: "El Estilista",
      role: "estilista",
      systemPrompt: SYSTEM_PROMPT,
      model: "gemini-2.5-flash",
      useThinking: false,
    });
  }

  async execute(input: EstilistaInput): Promise<AgentResponse & { parsed?: EstilistaOutput }> {
    console.log(`[Estilista] Copy-editing Chapter ${input.chapterNumber}...`);

    const prompt = `CORRECCIÓN ORTOTIPOGRÁFICA Y DE TONO - Capítulo ${input.chapterNumber}

=== GUÍA DE ESTILO DEL AUTOR ===
${input.styleGuide || "No se proporcionó guía de estilo. Usa estándar literario español."}

=== TEXTO DEL CAPÍTULO ===
${input.chapterContent}

Analiza el texto buscando errores ortográficos, tipográficos, de tono y de formato. NO modifiques el contenido narrativo, solo la forma. Sé preciso y exhaustivo.`;

    const response = await this.generateContent(prompt, undefined, {
      forceProvider: "gemini",
      temperature: 0,
    });

    let parsed: EstilistaOutput = {
      errores: [],
      veredicto: "aprobado",
      puntuacion_estilo: 10,
      resumen: "Sin errores estilísticos detectados",
    };

    try {
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const raw = JSON.parse(jsonMatch[0]);
        parsed = {
          errores: Array.isArray(raw.errores) ? raw.errores : [],
          veredicto: raw.veredicto || (Array.isArray(raw.errores) && raw.errores.length > 0 ? "requiere_correccion" : "aprobado"),
          puntuacion_estilo: typeof raw.puntuacion_estilo === "number" ? raw.puntuacion_estilo : 8,
          resumen: raw.resumen || "",
        };
      }
    } catch (e) {
      console.error(`[Estilista] Failed to parse response:`, e);
    }

    return { ...response, parsed };
  }
}
