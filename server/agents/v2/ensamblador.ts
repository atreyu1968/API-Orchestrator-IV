import { BaseAgent, AgentResponse } from "../base-agent";

export interface EnsambladorInput {
  fullManuscript: string;
  totalChapters: number;
  worldBible: any;
  styleGuide: string;
}

export interface EnsambladorOutput {
  puntuacion_coherencia: number;
  inconsistencias_voz: Array<{
    capitulo: number;
    descripcion: string;
    correccion: string;
  }>;
  inconsistencias_personaje: Array<{
    capitulo: number;
    personaje: string;
    descripcion: string;
    correccion: string;
  }>;
  capitulos_afectados: number[];
  resumen: string;
}

const SYSTEM_PROMPT = `Eres El Ensamblador, el agente final del pipeline OmniWriter. Tienes el manuscrito completo ante ti.

TU MISIÓN:
1. CONSISTENCIA DE PERSONAJE: Verifica que ningún personaje cambie de personalidad, apariencia o voz del capítulo 1 al último
2. UNIFICACIÓN DE VOZ: Asegura que el tono narrativo sea coherente a lo largo de toda la obra
3. TRANSICIONES: Evalúa las transiciones entre capítulos
4. CIERRE DE OBRA: Verifica que todos los hilos narrativos estén cerrados o intencionalmente abiertos

REGLAS:
- NO reescribas capítulos enteros, identifica correcciones quirúrgicas
- Mantén el estilo original del autor
- Las correcciones deben ser mínimas pero precisas
- Documenta cada problema detectado

RESPONDE EN JSON VÁLIDO:
{
  "puntuacion_coherencia": 8,
  "inconsistencias_voz": [
    {"capitulo": 5, "descripcion": "Cambio abrupto de tono formal a coloquial", "correccion": "Mantener registro formal"}
  ],
  "inconsistencias_personaje": [
    {"capitulo": 7, "personaje": "María", "descripcion": "Ojos cambian de verdes a azules", "correccion": "Corregir a ojos verdes"}
  ],
  "capitulos_afectados": [5, 7],
  "resumen": "Resumen del análisis de ensamblaje"
}`;

export class EnsambladorAgent extends BaseAgent {
  constructor() {
    super({
      name: "El Ensamblador",
      role: "ensamblador",
      systemPrompt: SYSTEM_PROMPT,
      model: "gemini-2.5-flash",
      useThinking: false,
    });
  }

  async execute(input: EnsambladorInput): Promise<AgentResponse & { parsed?: EnsambladorOutput }> {
    console.log(`[Ensamblador] Analyzing manuscript (${input.totalChapters} chapters)...`);

    const worldBibleStr = typeof input.worldBible === "string"
      ? input.worldBible
      : JSON.stringify(input.worldBible, null, 2);

    const manuscriptPreview = input.fullManuscript.length > 200000
      ? input.fullManuscript.substring(0, 200000) + "\n\n[...TRUNCADO POR LONGITUD...]"
      : input.fullManuscript;

    const prompt = `ANÁLISIS DE ENSAMBLAJE FINAL DEL MANUSCRITO

=== WORLD BIBLE (REFERENCIA DE VERDAD) ===
${worldBibleStr}

=== GUÍA DE ESTILO ===
${input.styleGuide || "Estándar literario español."}

=== MANUSCRITO COMPLETO (${input.totalChapters} capítulos) ===
${manuscriptPreview}

INSTRUCCIONES:
1. Lee el manuscrito completo de principio a fin
2. CONSISTENCIA DE PERSONAJE: Verifica que ningún personaje cambie atributos entre capítulos
3. UNIFICACIÓN DE VOZ: Detecta cambios de tono narrativo entre capítulos
4. Evalúa TRANSICIONES entre capítulos
5. Verifica HILOS NARRATIVOS cerrados

Reporta los problemas encontrados. NO reescribas el manuscrito.`;

    const response = await this.generateContent(prompt, undefined, {
      forceProvider: "gemini",
    });

    let parsed: EnsambladorOutput = {
      puntuacion_coherencia: 8,
      inconsistencias_voz: [],
      inconsistencias_personaje: [],
      capitulos_afectados: [],
      resumen: "Ensamblaje completado sin problemas detectados",
    };

    try {
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const raw = JSON.parse(jsonMatch[0]);
        parsed = {
          puntuacion_coherencia: raw.puntuacion_coherencia ?? 8,
          inconsistencias_voz: Array.isArray(raw.inconsistencias_voz) ? raw.inconsistencias_voz : [],
          inconsistencias_personaje: Array.isArray(raw.inconsistencias_personaje) ? raw.inconsistencias_personaje : [],
          capitulos_afectados: Array.isArray(raw.capitulos_afectados) ? raw.capitulos_afectados : [],
          resumen: raw.resumen || "",
        };
      }
    } catch (e) {
      console.error(`[Ensamblador] Failed to parse JSON response`);
    }

    return { ...response, parsed };
  }
}
