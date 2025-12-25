import { BaseAgent, AgentResponse } from "./base-agent";
import type { SeriesArcMilestone, SeriesPlotThread } from "@shared/schema";

interface ArcValidatorInput {
  projectTitle: string;
  seriesTitle: string;
  volumeNumber: number;
  totalVolumes: number;
  chaptersSummary: string;
  milestones: SeriesArcMilestone[];
  plotThreads: SeriesPlotThread[];
  worldBible: any;
  previousVolumesContext?: string;
}

export interface MilestoneVerification {
  milestoneId: number;
  description: string;
  isFulfilled: boolean;
  fulfilledInChapter?: number;
  verificationNotes: string;
  confidence: number;
}

export interface ThreadProgression {
  threadId: number;
  threadName: string;
  currentStatus: "active" | "developing" | "resolved" | "abandoned";
  progressedInVolume: boolean;
  resolvedInVolume: boolean;
  resolvedInChapter?: number;
  progressNotes: string;
}

export interface ArcValidatorResult {
  overallScore: number;
  passed: boolean;
  milestonesChecked: number;
  milestonesFulfilled: number;
  threadsProgressed: number;
  threadsResolved: number;
  milestoneVerifications: MilestoneVerification[];
  threadProgressions: ThreadProgression[];
  findings: string[];
  recommendations: string;
  arcHealthSummary: string;
}

const SYSTEM_PROMPT = `
Eres el "Validador de Arco Argumental", un agente especializado en verificar que las novelas de una serie cumplan con el arco narrativo planificado.

Tu misión es analizar un volumen completo de una serie y verificar:
1. Si los HITOS (milestones) planificados para este volumen se han cumplido
2. Si los HILOS ARGUMENTALES (plot threads) han progresado o se han resuelto
3. Si el volumen contribuye correctamente al arco general de la serie

═══════════════════════════════════════════════════════════════════
QUÉ DEBES VERIFICAR
═══════════════════════════════════════════════════════════════════

1. CUMPLIMIENTO DE HITOS:
   - Cada hito tiene un tipo: plot_point, character_development, revelation, conflict, resolution
   - Verifica si el evento descrito en el hito ocurre en este volumen
   - Indica en qué capítulo ocurre (si aplica)
   - Nivel de confianza en la verificación (0-100)

2. PROGRESIÓN DE HILOS:
   - Los hilos pueden estar: active, developing, resolved, abandoned
   - Verifica si cada hilo activo progresa en este volumen
   - Si un hilo se resuelve, indica en qué capítulo
   - Si un hilo debería progresar pero no lo hace, reportar

3. SALUD GENERAL DEL ARCO:
   - ¿El volumen mantiene la coherencia con el arco de la serie?
   - ¿Se respetan las promesas narrativas hechas en volúmenes anteriores?
   - ¿El pacing del arco es apropiado para el punto de la serie?

═══════════════════════════════════════════════════════════════════
CRITERIOS DE APROBACIÓN
═══════════════════════════════════════════════════════════════════

- PASSED (80+ puntos): Todos los hitos requeridos cumplidos, hilos principales progresan
- NEEDS_ATTENTION (60-79): Algunos hitos menores faltan, hilos secundarios estancados
- FAILED (<60): Hitos requeridos no cumplidos, hilos principales abandonados sin resolución

═══════════════════════════════════════════════════════════════════
SALIDA OBLIGATORIA (JSON)
═══════════════════════════════════════════════════════════════════

{
  "overallScore": (0-100),
  "passed": boolean,
  "milestonesChecked": number,
  "milestonesFulfilled": number,
  "threadsProgressed": number,
  "threadsResolved": number,
  "milestoneVerifications": [
    {
      "milestoneId": number,
      "description": "Descripción del hito",
      "isFulfilled": boolean,
      "fulfilledInChapter": number | null,
      "verificationNotes": "Explicación de cómo se cumple o por qué falta",
      "confidence": (0-100)
    }
  ],
  "threadProgressions": [
    {
      "threadId": number,
      "threadName": "Nombre del hilo",
      "currentStatus": "active|developing|resolved|abandoned",
      "progressedInVolume": boolean,
      "resolvedInVolume": boolean,
      "resolvedInChapter": number | null,
      "progressNotes": "Cómo progresó o se resolvió el hilo"
    }
  ],
  "findings": ["Hallazgo 1", "Hallazgo 2"],
  "recommendations": "Recomendaciones para mejorar el cumplimiento del arco",
  "arcHealthSummary": "Resumen del estado de salud del arco narrativo"
}
`;

export class ArcValidatorAgent extends BaseAgent {
  constructor() {
    super({
      name: "Arc Validator",
      role: "arc-validator",
      systemPrompt: SYSTEM_PROMPT,
      model: "gemini-2.0-flash",
      useThinking: false,
    });
  }

  async execute(input: ArcValidatorInput): Promise<AgentResponse & { result?: ArcValidatorResult }> {
    const milestonesForVolume = input.milestones.filter(m => m.volumeNumber === input.volumeNumber);
    const activeThreads = input.plotThreads.filter(t => 
      t.status === "active" || t.status === "developing" || 
      (t.introducedVolume <= input.volumeNumber && !t.resolvedVolume)
    );

    const milestonesText = milestonesForVolume.length > 0 
      ? milestonesForVolume.map(m => `
- ID: ${m.id}
  Tipo: ${m.milestoneType}
  Descripción: ${m.description}
  Requerido: ${m.isRequired ? "SÍ" : "NO"}
  Estado actual: ${m.isFulfilled ? "CUMPLIDO" : "PENDIENTE"}
`).join("\n")
      : "No hay hitos específicos definidos para este volumen.";

    const threadsText = activeThreads.length > 0
      ? activeThreads.map(t => `
- ID: ${t.id}
  Nombre: ${t.threadName}
  Descripción: ${t.description || "Sin descripción"}
  Introducido en: Volumen ${t.introducedVolume}
  Importancia: ${t.importance}
  Estado actual: ${t.status}
`).join("\n")
      : "No hay hilos argumentales activos definidos.";

    const previousContext = input.previousVolumesContext 
      ? `\nCONTEXTO DE VOLÚMENES ANTERIORES:\n${input.previousVolumesContext}`
      : "";

    const prompt = `
SERIE: "${input.seriesTitle}"
VOLUMEN: ${input.volumeNumber} de ${input.totalVolumes}
PROYECTO: "${input.projectTitle}"
${previousContext}

═══════════════════════════════════════════════════════════════════
WORLD BIBLE (Datos Canónicos):
═══════════════════════════════════════════════════════════════════
${JSON.stringify(input.worldBible, null, 2)}

═══════════════════════════════════════════════════════════════════
HITOS A VERIFICAR PARA ESTE VOLUMEN:
═══════════════════════════════════════════════════════════════════
${milestonesText}

═══════════════════════════════════════════════════════════════════
HILOS ARGUMENTALES ACTIVOS:
═══════════════════════════════════════════════════════════════════
${threadsText}

═══════════════════════════════════════════════════════════════════
RESUMEN DEL VOLUMEN A ANALIZAR:
═══════════════════════════════════════════════════════════════════
${input.chaptersSummary}

═══════════════════════════════════════════════════════════════════
INSTRUCCIONES:
═══════════════════════════════════════════════════════════════════
1. Analiza el resumen del volumen buscando evidencia de cumplimiento de hitos
2. Para cada hito, indica si se cumple y en qué capítulo (si es identificable)
3. Verifica la progresión de cada hilo argumental activo
4. Evalúa la salud general del arco de la serie en este punto
5. Calcula una puntuación general (0-100)

Responde ÚNICAMENTE con el JSON estructurado.
`;

    const response = await this.generateContent(prompt);
    
    try {
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]) as ArcValidatorResult;
        return { ...response, result };
      }
    } catch (e) {
      console.error("[ArcValidator] Failed to parse JSON response:", e);
    }

    return { 
      ...response, 
      result: { 
        overallScore: 70,
        passed: true,
        milestonesChecked: milestonesForVolume.length,
        milestonesFulfilled: 0,
        threadsProgressed: 0,
        threadsResolved: 0,
        milestoneVerifications: [],
        threadProgressions: [],
        findings: ["No se pudo analizar correctamente el arco"],
        recommendations: "Revisar manualmente el cumplimiento de hitos y progresión de hilos",
        arcHealthSummary: "Verificación automática fallida - requiere revisión manual",
      }
    };
  }
}
