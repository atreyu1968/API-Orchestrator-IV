import { BaseAgent } from "./base-agent";

interface ChangeHistoryEntry {
  issue: string;
  fix: string;
  timestamp: string;
}

interface ValidationResult {
  isResolved: boolean;
  confidence: number;
  reasoning: string;
}

export class IssueResolutionValidatorAgent extends BaseAgent {
  constructor() {
    super({
      name: "Issue Resolution Validator",
      role: "issue_validator",
      systemPrompt: `Eres un experto en análisis literario. Tu trabajo es determinar si un problema reportado por un revisor ya fue abordado en correcciones previas.

CONTEXTO:
- El revisor final puede describir el mismo problema de formas diferentes cada vez
- Tu trabajo es comparar el problema NUEVO con el historial de correcciones del capítulo
- Determina si el problema nuevo es esencialmente el mismo que uno ya corregido

CRITERIOS PARA CONSIDERAR RESUELTO:
1. El problema nuevo describe lo mismo que una corrección previa (aunque con palabras diferentes)
2. La corrección previa aborda directamente el tipo de problema reportado
3. El problema es una variante menor de algo ya corregido

CRITERIOS PARA CONSIDERAR NO RESUELTO:
1. El problema nuevo es diferente de todos los problemas corregidos
2. El problema es una regresión (algo que se arregló pero volvió a aparecer)
3. La corrección previa fue insuficiente para el tipo de problema

RESPONDE SOLO EN JSON:
{
  "isResolved": true/false,
  "confidence": 0.0-1.0,
  "reasoning": "Explicación breve de tu decisión"
}`,
      model: "deepseek-chat",
      useThinking: false,
    });
  }

  async execute(input: any): Promise<any> {
    const result = await this.validateResolution(
      input.newIssue,
      input.changeHistory,
      input.chapterNumber
    );
    return { content: JSON.stringify(result), tokenUsage: { input: 0, output: 0, thinking: 0 } };
  }

  async validateResolution(
    newIssue: { tipo: string; descripcion: string; severidad?: string },
    changeHistory: ChangeHistoryEntry[],
    chapterNumber: number
  ): Promise<ValidationResult> {
    if (!changeHistory || changeHistory.length === 0) {
      return {
        isResolved: false,
        confidence: 1.0,
        reasoning: "No hay historial de correcciones previas para este capítulo",
      };
    }

    // LIMIT HISTORY to last 5 entries to prevent token bloat
    const recentHistory = changeHistory.slice(-5);
    
    const historyText = recentHistory
      .map((h, i) => `Corrección ${i + 1}:\n- Problema: ${h.issue.substring(0, 500)}\n- Solución aplicada: ${h.fix.substring(0, 500)}`)
      .join("\n\n");

    const prompt = `Analiza si el siguiente problema NUEVO ya fue resuelto en correcciones previas:

CAPÍTULO: ${chapterNumber}

PROBLEMA NUEVO REPORTADO:
- Tipo: ${newIssue.tipo}
- Severidad: ${newIssue.severidad || "no especificada"}
- Descripción: ${newIssue.descripcion}

HISTORIAL DE CORRECCIONES PREVIAS EN ESTE CAPÍTULO:
${historyText}

¿El problema nuevo ya fue abordado por alguna corrección previa? Considera que el revisor puede describir el mismo problema con palabras diferentes.

RESPONDE EN JSON.`;

    try {
      const response = await this.generateContent(prompt);
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        return {
          isResolved: result.isResolved === true,
          confidence: typeof result.confidence === "number" ? result.confidence : 0.5,
          reasoning: result.reasoning || "Sin razonamiento proporcionado",
        };
      }
    } catch (e) {
      console.error("[IssueResolutionValidator] Failed to parse response:", e);
    }

    return {
      isResolved: false,
      confidence: 0.5,
      reasoning: "Error al procesar la validación",
    };
  }
}
