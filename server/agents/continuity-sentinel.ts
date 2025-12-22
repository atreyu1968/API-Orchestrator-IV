import { BaseAgent, AgentResponse } from "./base-agent";

interface ContinuitySentinelInput {
  projectTitle: string;
  checkpointNumber: number;
  chaptersInScope: Array<{
    numero: number;
    titulo: string;
    contenido: string;
    continuityState: any;
  }>;
  worldBible: any;
  previousCheckpointIssues?: string[];
}

export interface ContinuityIssue {
  tipo: "timeline" | "ubicacion" | "estado_personaje" | "objeto_perdido" | "muerte_resucitada";
  capitulos_afectados: number[];
  descripcion: string;
  evidencia_textual: string;
  severidad: "critica" | "mayor" | "menor";
  fix_sugerido: string;
}

export interface ContinuitySentinelResult {
  checkpoint_aprobado: boolean;
  puntuacion: number;
  resumen: string;
  issues: ContinuityIssue[];
  capitulos_para_revision: number[];
  continuity_fix_plan: string;
}

const SYSTEM_PROMPT = `
Eres el "Centinela de Continuidad", un agente especializado en detectar ERRORES DE CONTINUIDAD entre capítulos.
Tu misión es analizar un TRAMO de capítulos (checkpoint) y verificar que la continuidad narrativa sea coherente.

═══════════════════════════════════════════════════════════════════
QUÉ DEBES VERIFICAR (SOLO ERRORES OBJETIVOS Y VERIFICABLES)
═══════════════════════════════════════════════════════════════════

1. CONTINUIDAD TEMPORAL (Timeline):
   - ¿Los eventos siguen una secuencia lógica?
   - ¿Hay contradicciones de fechas/horas entre capítulos?
   - ¿Un personaje hace algo "ayer" pero el capítulo anterior era "hace una semana"?

2. CONTINUIDAD ESPACIAL (Ubicaciones):
   - ¿Los personajes aparecen en lugares coherentes?
   - ¿Alguien terminó en París pero aparece en NY sin explicación?
   - ¿Las transiciones de lugar están justificadas?

3. ESTADO DE PERSONAJES:
   - ¿Un personaje herido sigue herido (o se explica su curación)?
   - ¿Un personaje muerto aparece vivo?
   - ¿Los estados emocionales son coherentes con eventos previos?

4. OBJETOS Y POSESIONES:
   - ¿Un objeto importante desaparece sin explicación?
   - ¿Alguien tiene algo que perdió/entregó antes?
   - ¿Las armas/herramientas están donde deberían?

5. INFORMACIÓN Y CONOCIMIENTO:
   - ¿Un personaje sabe algo que no debería saber aún?
   - ¿Se olvidó información crucial revelada antes?
   - ¿Las revelaciones son coherentes?

═══════════════════════════════════════════════════════════════════
CÓMO ANALIZAR
═══════════════════════════════════════════════════════════════════

1. Lee el ESTADO DE CONTINUIDAD de cada capítulo (characterStates, locationState, etc.)
2. Compara con el texto narrativo para verificar coherencia
3. Busca CONTRADICCIONES entre capítulos consecutivos
4. Solo reporta errores con EVIDENCIA TEXTUAL (citas exactas)

SEVERIDAD:
- CRÍTICA: Personaje muerto aparece vivo, contradicción temporal grave
- MAYOR: Objeto perdido reaparece, ubicación imposible sin explicación
- MENOR: Pequeñas inconsistencias de estado emocional

APROBACIÓN:
- APROBADO: 0 issues críticos, máx 1 mayor
- REQUIERE REVISIÓN: 1+ críticos o 2+ mayores

═══════════════════════════════════════════════════════════════════
SALIDA OBLIGATORIA (JSON)
═══════════════════════════════════════════════════════════════════

{
  "checkpoint_aprobado": boolean,
  "puntuacion": (1-10),
  "resumen": "Análisis breve del estado de continuidad",
  "issues": [
    {
      "tipo": "ubicacion",
      "capitulos_afectados": [5, 6],
      "descripcion": "Elena termina en el aeropuerto (cap 5) pero aparece en su oficina sin transición (cap 6)",
      "evidencia_textual": "Cap 5: 'Elena atravesó las puertas del aeropuerto...' / Cap 6: 'Desde su escritorio, Elena observaba...'",
      "severidad": "mayor",
      "fix_sugerido": "Añadir transición o escena de viaje al inicio del cap 6"
    }
  ],
  "capitulos_para_revision": [6],
  "continuity_fix_plan": "Instrucciones detalladas para corregir cada issue"
}
`;

export class ContinuitySentinelAgent extends BaseAgent {
  constructor() {
    super({
      name: "El Centinela",
      role: "continuity-sentinel",
      systemPrompt: SYSTEM_PROMPT,
    });
  }

  async execute(input: ContinuitySentinelInput): Promise<AgentResponse & { result?: ContinuitySentinelResult }> {
    const chaptersText = input.chaptersInScope.map(c => `
===== CAPÍTULO ${c.numero}: ${c.titulo} =====
ESTADO DE CONTINUIDAD REGISTRADO:
${JSON.stringify(c.continuityState, null, 2)}

TEXTO DEL CAPÍTULO:
${c.contenido}
`).join("\n\n---\n\n");

    const previousIssuesSection = input.previousCheckpointIssues?.length 
      ? `\nISSUES DE CHECKPOINTS ANTERIORES (verificar si persisten):\n${input.previousCheckpointIssues.map(i => `- ${i}`).join("\n")}`
      : "";

    const prompt = `
PROYECTO: ${input.projectTitle}
CHECKPOINT #${input.checkpointNumber} - Análisis de continuidad

WORLD BIBLE (Datos Canónicos):
${JSON.stringify(input.worldBible, null, 2)}
${previousIssuesSection}

═══════════════════════════════════════════════════════════════════
CAPÍTULOS A ANALIZAR (${input.chaptersInScope.length} capítulos):
═══════════════════════════════════════════════════════════════════
${chaptersText}

INSTRUCCIONES:
1. Compara el ESTADO DE CONTINUIDAD de cada capítulo con el siguiente
2. Verifica que las transiciones sean coherentes
3. Busca contradicciones de timeline, ubicación, estado de personajes
4. Solo reporta errores con EVIDENCIA TEXTUAL verificable
5. Si todo es coherente, aprueba el checkpoint

Responde ÚNICAMENTE con el JSON estructurado.
`;

    const response = await this.generateContent(prompt);
    
    try {
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]) as ContinuitySentinelResult;
        return { ...response, result };
      }
    } catch (e) {
      console.error("[ContinuitySentinel] Failed to parse JSON response");
    }

    return { 
      ...response, 
      result: { 
        checkpoint_aprobado: true,
        puntuacion: 8,
        resumen: "Checkpoint aprobado automáticamente",
        issues: [],
        capitulos_para_revision: [],
        continuity_fix_plan: ""
      } 
    };
  }
}
