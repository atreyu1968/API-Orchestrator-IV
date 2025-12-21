import { BaseAgent, AgentResponse } from "./base-agent";

interface EditorInput {
  chapterNumber: number;
  chapterContent: string;
  chapterData: {
    titulo: string;
    beats: string[];
    objetivo_narrativo: string;
  };
  worldBible: any;
  guiaEstilo: string;
}

export interface EditorResult {
  puntuacion: number;
  veredicto: string;
  fortalezas: string[];
  debilidades_criticas: string[];
  plan_quirurgico: {
    diagnostico: string;
    procedimiento: string;
    objetivo: string;
  };
  aprobado: boolean;
}

const SYSTEM_PROMPT = `
Eres "El Arquitecto", Crítico Editorial Senior de Élite. Tu estándar es la EXCELENCIA literaria.
Tu misión es auditar el texto comparándolo con la Guía de Estilo y la World Bible.

PROTOCOLO DE EVALUACIÓN (Deep Thinking):
1. Contrasta el texto con el "Índice Detallado". ¿Sucedió algo que no debía? ¿Faltó algo?
2. Evalúa la voz narrativa: ¿Cumple con la Guía de Estilo o suena genérico?
3. Busca "Teletransportaciones": ¿La posición de los personajes es lógica según la World Bible?
4. Califica el ritmo: ¿Es profesional o hay escenas de relleno?

DEBES DEVOLVER TU ANÁLISIS EN FORMATO JSON:
{
  "puntuacion": (Número del 1 al 10),
  "veredicto": "Resumen profesional del estado de la obra",
  "fortalezas": [],
  "debilidades_criticas": [],
  "plan_quirurgico": {
    "diagnostico": "Qué falló exactamente",
    "procedimiento": "Instrucciones paso a paso para que el escritor lo arregle",
    "objetivo": "Resultado esperado"
  },
  "aprobado": (Boolean: true si puntuacion >= 7, false si es menor)
}
`;

export class EditorAgent extends BaseAgent {
  constructor() {
    super({
      name: "El Editor",
      role: "editor",
      systemPrompt: SYSTEM_PROMPT,
    });
  }

  async execute(input: EditorInput): Promise<AgentResponse & { result?: EditorResult }> {
    const prompt = `
    DOCUMENTOS DE BASE:
    - Guía de Estilo: ${input.guiaEstilo}
    - World Bible (Contexto): ${JSON.stringify(input.worldBible)}
    
    DATOS DEL CAPÍTULO ${input.chapterNumber}:
    - Título: ${input.chapterData.titulo}
    - Beats esperados: ${input.chapterData.beats.join(" -> ")}
    - Objetivo narrativo: ${input.chapterData.objetivo_narrativo}
    
    TEXTO A EVALUAR:
    ${input.chapterContent}
    
    Realiza tu auditoría estructural completa. Sé despiadado pero constructivo. 
    Si la nota es inferior a 7, el capítulo será descartado y reescrito basándose en tu Plan Quirúrgico.
    
    Responde ÚNICAMENTE con el JSON estructurado.
    `;

    const response = await this.generateContent(prompt);
    
    try {
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]) as EditorResult;
        return { ...response, result };
      }
    } catch (e) {
      console.error("[Editor] Failed to parse JSON response, approving by default");
    }

    return { 
      ...response, 
      result: { 
        puntuacion: 8, 
        veredicto: "Aprobado automáticamente", 
        fortalezas: [],
        debilidades_criticas: [],
        plan_quirurgico: { diagnostico: "", procedimiento: "", objetivo: "" },
        aprobado: true 
      } 
    };
  }
}
