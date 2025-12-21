import { BaseAgent, AgentResponse } from "./base-agent";

interface CopyEditorInput {
  chapterContent: string;
  chapterNumber: number;
  chapterTitle: string;
}

export interface CopyEditorResult {
  texto_final: string;
  cambios_realizados: string;
  idioma_detectado: string;
}

const SYSTEM_PROMPT = `
Eres el "Corrector de Estilo y Editor Multilingüe de Élite". Tu misión es la perfección ortotipográfica y el maquetado profesional.

REGLAS DE INTERVENCIÓN:
1. INTEGRIDAD TOTAL: Prohibido resumir o condensar. El volumen de palabras debe mantenerse o aumentar ligeramente para mejorar la fluidez.
2. IDIOMA ESPAÑOL: No reescribas el estilo del autor. Céntrate en ortografía, gramática, puntuación y tipografía.
3. DIÁLOGOS: Uso estricto de guiones largos (—) siguiendo la norma española.
4. MAQUETADO: Devuelve el texto en Markdown limpio. Título en H1 (#).

SALIDA REQUERIDA (JSON):
{
  "texto_final": "El contenido completo del capítulo maquetado en Markdown",
  "cambios_realizados": "Breve resumen de los ajustes técnicos hechos",
  "idioma_detectado": "es"
}
`;

export class CopyEditorAgent extends BaseAgent {
  constructor() {
    super({
      name: "El Estilista",
      role: "copyeditor",
      systemPrompt: SYSTEM_PROMPT,
    });
  }

  async execute(input: CopyEditorInput): Promise<AgentResponse & { result?: CopyEditorResult }> {
    const prompt = `
    Por favor, toma el siguiente texto y aplícale el protocolo de Corrección de Élite y Maquetado para Ebook:
    
    CAPÍTULO ${input.chapterNumber}: ${input.chapterTitle}
    
    ${input.chapterContent}
    
    Asegúrate de que:
    - Los diálogos usen la raya (—) correctamente
    - El formato Markdown sea impecable
    - El título esté formateado como # Capítulo X: Título
    - No omitas ninguna escena ni reduzcas el contenido
    
    Responde ÚNICAMENTE con el JSON estructurado.
    `;

    const response = await this.generateContent(prompt);
    
    try {
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]) as CopyEditorResult;
        return { ...response, result };
      }
    } catch (e) {
      console.error("[CopyEditor] Failed to parse JSON response");
    }

    return { 
      ...response, 
      result: { 
        texto_final: `# Capítulo ${input.chapterNumber}: ${input.chapterTitle}\n\n${input.chapterContent}`,
        cambios_realizados: "Sin cambios adicionales",
        idioma_detectado: "es"
      } 
    };
  }
}
