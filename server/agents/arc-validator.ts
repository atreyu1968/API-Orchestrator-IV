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

    if (milestonesForVolume.length === 0 && activeThreads.length === 0) {
      return {
        content: "No hay hitos ni hilos definidos para verificar.",
        result: {
          overallScore: 100,
          passed: true,
          milestonesChecked: 0,
          milestonesFulfilled: 0,
          threadsProgressed: 0,
          threadsResolved: 0,
          milestoneVerifications: [],
          threadProgressions: [],
          findings: ["No hay hitos ni hilos argumentales definidos para este volumen. Define hitos e hilos en la guia de serie para habilitar la verificacion automatica."],
          recommendations: "Sube una guia de serie y usa 'Extraer Hitos' para definir automaticamente los puntos de verificacion del arco.",
          arcHealthSummary: "Sin elementos de arco definidos - el volumen no puede ser verificado hasta que se definan hitos y/o hilos argumentales.",
        }
      };
    }

    if (!input.chaptersSummary || input.chaptersSummary.trim().length < 100) {
      return {
        content: "No hay contenido suficiente para verificar el arco.",
        result: {
          overallScore: 0,
          passed: false,
          milestonesChecked: milestonesForVolume.length,
          milestonesFulfilled: 0,
          threadsProgressed: 0,
          threadsResolved: 0,
          milestoneVerifications: milestonesForVolume.map(m => ({
            milestoneId: m.id,
            description: m.description,
            isFulfilled: false,
            verificationNotes: "No hay contenido de capitulos para verificar",
            confidence: 0,
          })),
          threadProgressions: activeThreads.map(t => ({
            threadId: t.id,
            threadName: t.threadName,
            currentStatus: t.status as "active" | "developing" | "resolved" | "abandoned",
            progressedInVolume: false,
            resolvedInVolume: false,
            progressNotes: "No hay contenido de capitulos para verificar",
          })),
          findings: ["El proyecto no tiene capitulos escritos o el contenido es insuficiente para verificar el arco narrativo."],
          recommendations: "Genera capitulos para este volumen antes de ejecutar la verificacion de arco.",
          arcHealthSummary: "Verificacion imposible - se requiere contenido de capitulos para analizar.",
        }
      };
    }

    const milestonesText = milestonesForVolume.map(m => `
- ID: ${m.id}
  Tipo: ${m.milestoneType}
  Descripcion: ${m.description}
  Requerido: ${m.isRequired ? "SI" : "NO"}
  Estado actual: ${m.isFulfilled ? "CUMPLIDO" : "PENDIENTE"}
`).join("\n");

    const threadsText = activeThreads.length > 0
      ? activeThreads.map(t => `
- ID: ${t.id}
  Nombre: ${t.threadName}
  Descripcion: ${t.description || "Sin descripcion"}
  Introducido en: Volumen ${t.introducedVolume}
  Importancia: ${t.importance}
  Estado actual: ${t.status}
`).join("\n")
      : "No hay hilos argumentales activos definidos.";

    const previousContext = input.previousVolumesContext 
      ? `\nCONTEXTO DE VOLUMENES ANTERIORES:\n${input.previousVolumesContext}`
      : "";

    const prompt = `
SERIE: "${input.seriesTitle}"
VOLUMEN: ${input.volumeNumber} de ${input.totalVolumes}
PROYECTO: "${input.projectTitle}"
${previousContext}

WORLD BIBLE:
${JSON.stringify(input.worldBible, null, 2)}

HITOS A VERIFICAR PARA ESTE VOLUMEN:
${milestonesText}

HILOS ARGUMENTALES ACTIVOS:
${threadsText}

RESUMEN DEL VOLUMEN (contenido de capitulos):
${input.chaptersSummary.substring(0, 80000)}

INSTRUCCIONES:
1. Analiza el resumen del volumen buscando evidencia de cumplimiento de hitos
2. Para cada hito listado arriba, indica si se cumple y en que capitulo
3. Verifica la progresion de cada hilo argumental activo
4. Evalua la salud general del arco de la serie
5. Calcula una puntuacion general (0-100)

IMPORTANTE: Responde UNICAMENTE con JSON valido, sin texto adicional.
`;

    console.log(`[ArcValidator] Starting verification for project "${input.projectTitle}" vol ${input.volumeNumber}`);
    console.log(`[ArcValidator] Milestones to check: ${milestonesForVolume.length}, Active threads: ${activeThreads.length}`);
    console.log(`[ArcValidator] Chapters summary length: ${input.chaptersSummary.length} chars`);

    const response = await this.generateContent(prompt);
    
    if (response.error) {
      console.error("[ArcValidator] AI generation error:", response.error);
      return {
        ...response,
        result: {
          overallScore: 0,
          passed: false,
          milestonesChecked: milestonesForVolume.length,
          milestonesFulfilled: 0,
          threadsProgressed: 0,
          threadsResolved: 0,
          milestoneVerifications: [],
          threadProgressions: [],
          findings: [`Error de IA: ${response.error}`],
          recommendations: "Reintenta la verificacion. Si el error persiste, contacta soporte.",
          arcHealthSummary: "Error en la verificacion automatica.",
        }
      };
    }

    console.log(`[ArcValidator] Raw response length: ${response.content.length}`);
    
    try {
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]) as ArcValidatorResult;
        console.log(`[ArcValidator] Successfully parsed result: score=${result.overallScore}, passed=${result.passed}`);
        return { ...response, result };
      } else {
        console.error("[ArcValidator] No JSON found in response. Content preview:", response.content.substring(0, 500));
      }
    } catch (e) {
      console.error("[ArcValidator] Failed to parse JSON response:", e);
      console.error("[ArcValidator] Content that failed to parse:", response.content.substring(0, 1000));
    }

    return { 
      ...response, 
      result: { 
        overallScore: 50,
        passed: false,
        milestonesChecked: milestonesForVolume.length,
        milestonesFulfilled: 0,
        threadsProgressed: 0,
        threadsResolved: 0,
        milestoneVerifications: milestonesForVolume.map(m => ({
          milestoneId: m.id,
          description: m.description,
          isFulfilled: false,
          verificationNotes: "No se pudo analizar automaticamente",
          confidence: 0,
        })),
        threadProgressions: activeThreads.map(t => ({
          threadId: t.id,
          threadName: t.threadName,
          currentStatus: t.status as "active" | "developing" | "resolved" | "abandoned",
          progressedInVolume: false,
          resolvedInVolume: false,
          progressNotes: "No se pudo analizar automaticamente",
        })),
        findings: ["La IA no devolvio un formato JSON valido. Verifica los logs del servidor para mas detalles."],
        recommendations: "Reintenta la verificacion. Si el problema persiste, revisa que los capitulos tengan contenido narrativo claro.",
        arcHealthSummary: "Verificacion parcial - el analisis automatico fallo pero se listaron los elementos a verificar.",
      }
    };
  }
}
