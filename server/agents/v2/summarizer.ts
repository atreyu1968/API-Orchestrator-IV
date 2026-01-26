// LitAgents 2.0 - Summarizer Agent
// Uses DeepSeek V3 (deepseek-chat) for fast compression

import { BaseAgent, AgentResponse } from "../base-agent";
import { PROMPTS_V2 } from "../agent-prompts-v2";

export interface SummarizerInput {
  chapterContent: string;
  chapterNumber: number;
}

const SYSTEM_PROMPT = `
Eres el Summarizer de LitAgents 2.0, especialista en compresión narrativa eficiente.
Tu trabajo es crear resúmenes ÚTILES para mantener la continuidad sin desperdiciar tokens.

OBJETIVO: Máxima información útil en mínimas palabras (200 palabras máximo).

QUÉ INCLUIR (Crítico para continuidad):
- HECHOS: Qué pasó concretamente
- CAMBIOS: Muertes, heridas, cambios de bando
- OBJETOS: Qué se obtuvo/perdió
- RELACIONES: Cambios entre personajes
- UBICACIÓN: Dónde terminaron los personajes
- REVELACIONES: Información nueva descubierta

QUÉ IGNORAR:
- Prosa poética
- Diálogos decorativos
- Reflexiones sin consecuencias

Genera un párrafo denso de información, sin bullets ni formato.
`;

export class SummarizerAgent extends BaseAgent {
  constructor() {
    super({
      name: "Summarizer",
      role: "summarizer",
      systemPrompt: SYSTEM_PROMPT,
      model: "deepseek-chat", // V3 for speed
      useThinking: false,
    });
  }

  async execute(input: SummarizerInput): Promise<AgentResponse> {
    console.log(`[Summarizer] Compressing Chapter ${input.chapterNumber} (${input.chapterContent.length} chars)...`);
    
    const prompt = PROMPTS_V2.SUMMARIZER(
      input.chapterContent,
      input.chapterNumber
    );

    const response = await this.generateContent(prompt);
    
    if (!response.error) {
      const wordCount = response.content.split(/\s+/).length;
      console.log(`[Summarizer] Created summary: ${wordCount} words`);
    }
    
    return response;
  }
}
