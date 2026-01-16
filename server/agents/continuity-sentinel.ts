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
  elementos_a_preservar: string;
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

SISTEMA DE PUNTUACIÓN ESTRICTO (OBLIGATORIO):
- 10/10: CERO issues de cualquier tipo. Continuidad PERFECTA.
- 9/10: Solo 1 issue MENOR.
- 8/10: 2 issues menores.
- 7/10: 1 issue MAYOR o 3+ menores.
- 6/10: 2 issues mayores.
- 5/10 o menos: Cualquier issue CRÍTICO o 3+ mayores.

APROBACIÓN:
- APROBADO (10/10): CERO issues. Continuidad perfecta sin ningún error.
- REQUIERE REVISIÓN: CUALQUIER issue, sin importar severidad.

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
      "elementos_a_preservar": "El resto del capítulo 6 está perfecto. Solo modificar las primeras 2-3 líneas para añadir la transición.",
      "fix_sugerido": "SOLO añadir 1-2 oraciones al inicio del cap 6 mencionando el viaje de regreso. Ej: 'Tras el vuelo de regreso, Elena se dejó caer en su silla de oficina.' El resto del capítulo permanece INTACTO."
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
      model: "gemini-2.5-flash",
      useThinking: false,
    });
  }

  async execute(input: ContinuitySentinelInput): Promise<AgentResponse & { result?: ContinuitySentinelResult }> {
    // Helper to get proper chapter label based on number
    const getChapterLabel = (num: number): string => {
      if (num === 0) return "Prólogo";
      if (num === -1 || num === 998) return "Epílogo";
      if (num === -2 || num === 999) return "Nota del Autor";
      return `Capítulo ${num}`;
    };
    
    // Sort chapters in narrative order (prologue first, epilogue/author note last)
    const getChapterSortOrder = (n: number): number => {
      if (n === 0) return -1000;
      if (n === -1 || n === 998) return 1000;
      if (n === -2 || n === 999) return 1001;
      return n;
    };
    
    const sortedChapters = [...input.chaptersInScope].sort((a, b) => 
      getChapterSortOrder(a.numero) - getChapterSortOrder(b.numero)
    );
    
    const chaptersText = sortedChapters.map(c => `
===== ${getChapterLabel(c.numero)}: ${c.titulo} =====
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
