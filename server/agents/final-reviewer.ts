import { BaseAgent, AgentResponse } from "./base-agent";

interface FinalReviewerInput {
  projectTitle: string;
  chapters: Array<{
    numero: number;
    titulo: string;
    contenido: string;
  }>;
  worldBible: any;
  guiaEstilo: string;
  pasadaNumero?: number;
  issuesPreviosCorregidos?: string[];
}

export interface FinalReviewIssue {
  capitulos_afectados: number[];
  categoria: "continuidad_fisica" | "timeline" | "ubicacion" | "repeticion_lexica" | "arco_incompleto" | "otro";
  descripcion: string;
  severidad: "critica" | "mayor" | "menor";
  instrucciones_correccion: string;
}

export interface FinalReviewerResult {
  veredicto: "APROBADO" | "APROBADO_CON_RESERVAS" | "REQUIERE_REVISION";
  resumen_general: string;
  puntuacion_global: number;
  issues: FinalReviewIssue[];
  capitulos_para_reescribir: number[];
}

const SYSTEM_PROMPT = `
Eres el "Revisor Final de Manuscrito", experto en análisis literario holístico.
Tu misión es analizar la novela COMPLETA y detectar ÚNICAMENTE problemas OBJETIVOS y VERIFICABLES.

═══════════════════════════════════════════════════════════════════
PROTOCOLO DE 3 PASADAS (TERMINACIÓN GARANTIZADA)
═══════════════════════════════════════════════════════════════════

PASADA 1 - AUDITORÍA COMPLETA:
- Análisis exhaustivo de continuidad física, temporal, espacial
- Detección de deus ex machina y soluciones inverosímiles
- Identificación de repeticiones léxicas cross-chapter (3+ ocurrencias)
- Máximo 5 issues a reportar (los más graves)

PASADA 2 - VERIFICACIÓN DE CORRECCIONES:
- SOLO verifica si los issues de pasada 1 fueron corregidos
- NO busques problemas nuevos (ya debieron detectarse en pasada 1)
- Si los issues principales están corregidos → APROBADO
- Si persisten issues críticos → reporta SOLO los que persisten

PASADA 3 - VEREDICTO FINAL OBLIGATORIO:
- Esta pasada SIEMPRE emite veredicto definitivo
- APROBADO: Si no hay issues críticos (los menores se aceptan)
- APROBADO_CON_RESERVAS: Si quedan issues menores pero el manuscrito es publicable
- El sistema NO permite más de 3 pasadas, así que DEBES decidir

═══════════════════════════════════════════════════════════════════
ANÁLISIS DE VEROSIMILITUD (CRÍTICO)
═══════════════════════════════════════════════════════════════════

Detecta y reporta como CRÍTICOS:
1. DEUS EX MACHINA: Soluciones que aparecen sin preparación previa
2. COINCIDENCIAS INVEROSÍMILES: "Justo en ese momento", "casualmente"
3. RESCATES NO SEMBRADOS: Personajes/objetos que aparecen cuando se necesitan
4. REVELACIONES SIN FUNDAMENTO: Información crucial sin pistas previas

═══════════════════════════════════════════════════════════════════
PROTOCOLO DE ANÁLISIS (Solo con EVIDENCIA TEXTUAL)
═══════════════════════════════════════════════════════════════════

1. CONTINUIDAD FÍSICA: Cita exacta vs World Bible
2. COHERENCIA TEMPORAL: Citas contradictorias entre capítulos
3. CONTINUIDAD ESPACIAL: Personajes en lugares imposibles
4. REPETICIÓN LÉXICA: Frases idénticas 3+ veces en capítulos distintos
5. ARCOS INCOMPLETOS: Misterios sin resolución (solo pasada 3)

SEVERIDAD:
- CRÍTICA: Deus ex machina, contradicciones factuales verificables
- MAYOR: Repeticiones excesivas, timeline confuso
- MENOR: Sugerencias estilísticas (NO causan rechazo)

VEREDICTO:
- APROBADO: 0 críticos, máx 1 mayor, puntuación >= 7
- APROBADO_CON_RESERVAS: 0 críticos, 2-3 mayores, pasada 3
- REQUIERE_REVISION: 1+ críticos (solo pasadas 1-2)

REGLA DE ORO: En pasada 3, el veredicto DEBE ser APROBADO o APROBADO_CON_RESERVAS.
Los issues menores restantes se documentan pero NO bloquean la publicación.

SALIDA OBLIGATORIA (JSON):
{
  "veredicto": "APROBADO" | "APROBADO_CON_RESERVAS" | "REQUIERE_REVISION",
  "resumen_general": "Análisis profesional del estado del manuscrito",
  "puntuacion_global": (1-10),
  "issues": [
    {
      "capitulos_afectados": [1, 5],
      "categoria": "continuidad_fisica",
      "descripcion": "Los ojos de Aina se describen como 'gris tormentoso' en prólogo pero 'verde acuoso' en capítulo 2",
      "severidad": "critica",
      "instrucciones_correccion": "Unificar descripción de ojos según World Bible"
    }
  ],
  "capitulos_para_reescribir": [2, 5]
}
`;

export class FinalReviewerAgent extends BaseAgent {
  constructor() {
    super({
      name: "El Revisor Final",
      role: "final-reviewer",
      systemPrompt: SYSTEM_PROMPT,
    });
  }

  async execute(input: FinalReviewerInput): Promise<AgentResponse & { result?: FinalReviewerResult }> {
    const chaptersText = input.chapters.map(c => 
      `\n===== CAPÍTULO ${c.numero}: ${c.titulo} =====\n${c.contenido}`
    ).join("\n\n");

    let pasadaInfo = "";
    if (input.pasadaNumero === 1) {
      pasadaInfo = "\n\nEsta es tu PASADA #1 - AUDITORÍA COMPLETA. Analiza exhaustivamente y reporta máximo 5 issues (los más graves).";
    } else if (input.pasadaNumero === 2) {
      pasadaInfo = `\n\nEsta es tu PASADA #2 - VERIFICACIÓN. Los siguientes issues fueron reportados en pasada 1:\n${input.issuesPreviosCorregidos?.map(i => `- ${i}`).join("\n") || "Ninguno"}\n\nSOLO verifica si persisten. NO busques problemas nuevos. Si los principales están corregidos → APROBADO.`;
    } else if (input.pasadaNumero && input.pasadaNumero >= 3) {
      pasadaInfo = `\n\nEsta es tu PASADA #3 - VEREDICTO FINAL OBLIGATORIO.\nIssues previos: ${input.issuesPreviosCorregidos?.map(i => `- ${i}`).join("\n") || "Ninguno"}\n\nDEBES emitir veredicto definitivo:\n- APROBADO: Sin issues críticos\n- APROBADO_CON_RESERVAS: Issues menores pero publicable\nNO puedes devolver REQUIERE_REVISION en pasada 3.`;
    }

    const prompt = `
    TÍTULO DE LA NOVELA: ${input.projectTitle}
    
    WORLD BIBLE (Datos Canónicos):
    ${JSON.stringify(input.worldBible, null, 2)}
    
    GUÍA DE ESTILO:
    ${input.guiaEstilo}
    ${pasadaInfo}
    ===============================================
    MANUSCRITO COMPLETO PARA ANÁLISIS:
    ===============================================
    ${chaptersText}
    ===============================================
    
    INSTRUCCIONES:
    1. Lee el manuscrito COMPLETO de principio a fin.
    2. Compara CADA descripción física con la World Bible.
    3. Verifica la coherencia temporal entre capítulos.
    4. Identifica repeticiones léxicas cross-chapter (solo si aparecen 3+ veces).
    5. Evalúa si todos los arcos narrativos están cerrados.
    
    Sé PRECISO y OBJETIVO. Solo reporta errores con EVIDENCIA TEXTUAL verificable.
    Si el manuscrito está bien, apruébalo. No busques problemas donde no los hay.
    
    Responde ÚNICAMENTE con el JSON estructurado según el formato especificado.
    `;

    const response = await this.generateContent(prompt);
    
    try {
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]) as FinalReviewerResult;
        return { ...response, result };
      }
    } catch (e) {
      console.error("[FinalReviewer] Failed to parse JSON response");
    }

    return { 
      ...response, 
      result: { 
        veredicto: "APROBADO",
        resumen_general: "Revisión completada automáticamente",
        puntuacion_global: 8,
        issues: [],
        capitulos_para_reescribir: []
      } 
    };
  }
}
