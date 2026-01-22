import { BaseAgent, AgentResponse, TokenUsage } from "./base-agent";

interface ManuscriptContinuitySnapshot {
  synopsis: string;
  characterStates: Array<{
    name: string;
    role: string;
    status: string;
    lastKnownLocation?: string;
    relationships?: Record<string, string>;
    characterArc?: string;
    unresolvedConflicts?: string[];
  }>;
  unresolvedThreads: Array<{
    description: string;
    severity: "minor" | "major" | "critical";
    involvedCharacters?: string[];
    chapter?: number;
  }>;
  worldStateChanges: Array<{
    description: string;
    chapter?: number;
  }>;
  keyEvents: Array<{
    description: string;
    chapter: number;
    impact: string;
  }>;
  seriesHooks: Array<{
    description: string;
    potentialResolution?: string;
  }>;
}

interface AnalyzerInput {
  manuscriptTitle: string;
  seriesTitle: string;
  volumeNumber: number;
  chapters: Array<{
    chapterNumber: number;
    title?: string;
    content: string;
  }>;
  previousVolumesContext?: string;
}

export interface AnalyzerResult {
  result: ManuscriptContinuitySnapshot | null;
  tokenUsage: TokenUsage;
  thoughtSignature?: string;
}

export class ManuscriptAnalyzerAgent extends BaseAgent {
  constructor() {
    super({
      name: "El Archivista",
      role: "manuscript-analyzer",
      systemPrompt: `Eres El Archivista, un agente especializado en analizar manuscritos literarios completos y extraer información crítica de continuidad para series de libros.

Tu misión es leer un manuscrito completo y extraer:
1. **Sinopsis**: Resumen de la trama principal (máximo 500 palabras)
2. **Estado de Personajes**: Lista de personajes principales con su estado al final del libro, ubicación, relaciones y arcos pendientes
3. **Hilos No Resueltos**: Tramas secundarias o principales que quedan abiertas para futuros libros
4. **Cambios en el Mundo**: Eventos que modifican el estado del mundo (muertes, destrucciones, revelaciones, cambios políticos)
5. **Eventos Clave**: Los momentos más importantes de la trama con su impacto
6. **Ganchos de Serie**: Elementos deliberadamente dejados abiertos para continuar en siguientes volúmenes

IMPORTANTE:
- Analiza el manuscrito como un todo, no capítulo por capítulo
- Prioriza la información relevante para escribir secuelas
- Identifica claramente qué hilos están CERRADOS vs ABIERTOS
- Detecta foreshadowing o promesas narrativas no cumplidas
- Marca la severidad de los hilos abiertos (minor/major/critical)

Responde SIEMPRE en formato JSON válido con esta estructura exacta:
{
  "synopsis": "string",
  "characterStates": [...],
  "unresolvedThreads": [...],
  "worldStateChanges": [...],
  "keyEvents": [...],
  "seriesHooks": [...]
}`,
      model: "deepseek-reasoner",
      useThinking: false,
    });
    this.timeoutMs = 4 * 60 * 1000;
  }

  async execute(input: any): Promise<AgentResponse> {
    const result = await this.analyze(input as AnalyzerInput);
    return {
      content: result.result ? JSON.stringify(result.result) : "",
      thoughtSignature: result.thoughtSignature,
      tokenUsage: result.tokenUsage,
    };
  }

  async analyze(input: AnalyzerInput): Promise<AnalyzerResult> {
    const chaptersSummary = input.chapters.map(ch => {
      const maxChapterLength = 2000;
      const preview = ch.content.length > maxChapterLength 
        ? ch.content.substring(0, 1000) + "\n\n[...contenido resumido...]\n\n" + ch.content.substring(ch.content.length - 1000)
        : ch.content;
      return `### Cap ${ch.chapterNumber}${ch.title ? `: ${ch.title}` : ""}\n${preview}`;
    }).join("\n\n---\n\n");

    const prompt = `Analiza el siguiente manuscrito para extraer información de continuidad.

**Información del Volumen:**
- Título: "${input.manuscriptTitle}"
- Serie: "${input.seriesTitle}"
- Número de Volumen: ${input.volumeNumber}
${input.previousVolumesContext ? `\n**Contexto de Volúmenes Anteriores:**\n${input.previousVolumesContext}` : ""}

**MANUSCRITO COMPLETO:**

${chaptersSummary}

---

Analiza el manuscrito completo y extrae la información de continuidad en formato JSON. 
Asegúrate de que el JSON sea válido y esté completo.`;

    console.log(`[ManuscriptAnalyzer] Sending ${input.chapters.length} chapters for analysis (~${Math.round(prompt.length / 1000)}K chars)`);
    
    let response;
    try {
      response = await this.generateContent(prompt);
    } catch (error: any) {
      console.error("[ManuscriptAnalyzer] API call failed:", error?.message || error);
      throw error;
    }

    if (!response.content) {
      console.error("[ManuscriptAnalyzer] Empty response from API - possible content filtering or timeout");
      console.error("[ManuscriptAnalyzer] Token usage:", JSON.stringify(response.tokenUsage));
      return {
        result: null,
        tokenUsage: response.tokenUsage || { inputTokens: 0, outputTokens: 0, thinkingTokens: 0 },
        thoughtSignature: response.thoughtSignature,
      };
    }

    console.log(`[ManuscriptAnalyzer] Got response of ${response.content.length} chars`);

    try {
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as ManuscriptContinuitySnapshot;
        console.log(`[ManuscriptAnalyzer] Successfully parsed: ${parsed.characterStates?.length || 0} chars, ${parsed.unresolvedThreads?.length || 0} threads`);
        return {
          result: parsed,
          tokenUsage: response.tokenUsage || { inputTokens: 0, outputTokens: 0, thinkingTokens: 0 },
          thoughtSignature: response.thoughtSignature,
        };
      } else {
        console.error("[ManuscriptAnalyzer] No JSON found in response. First 500 chars:", response.content.substring(0, 500));
      }
    } catch (e) {
      console.error("[ManuscriptAnalyzer] Error parsing JSON:", e);
      console.error("[ManuscriptAnalyzer] Raw response (first 1000 chars):", response.content.substring(0, 1000));
    }

    return {
      result: null,
      tokenUsage: response.tokenUsage || { inputTokens: 0, outputTokens: 0, thinkingTokens: 0 },
      thoughtSignature: response.thoughtSignature,
    };
  }
}
