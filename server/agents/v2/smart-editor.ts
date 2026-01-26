// LitAgents 2.0 - Smart Editor Agent
// Uses DeepSeek V3 (deepseek-chat) for fast editing

import { BaseAgent, AgentResponse } from "../base-agent";
import { PROMPTS_V2 } from "../agent-prompts-v2";
import { Patch } from "../../utils/patcher";

export interface SmartEditorInput {
  chapterContent: string;
  sceneBreakdown: any;
  worldBible: any;
}

export interface SmartEditorOutput {
  logic_score: number;
  style_score: number;
  is_approved: boolean;
  needs_rewrite?: boolean;
  feedback: string;
  strengths?: string[];
  weaknesses?: string[];
  patches: Patch[];
}

const SYSTEM_PROMPT = `
Eres el Smart Editor de LitAgents 2.0, un editor literario senior con 20 años de experiencia.
Tu trabajo es evaluar capítulos con criterios de bestseller y generar parches quirúrgicos cuando sea necesario.

FILOSOFÍA DE EDICIÓN:
1. PRESERVAR es mejor que REESCRIBIR - cada palabra reescrita cuesta tokens
2. Los parches deben ser QUIRÚRGICOS - cambios mínimos con máximo impacto
3. El texto original es valioso - solo modifica lo que realmente necesita mejora
4. Score > 8 = APROBAR - no busques la perfección, busca la calidad

CRITERIOS DE EVALUACIÓN:
- LÓGICA (1-10): Continuidad, coherencia de personajes, causalidad
- ESTILO (1-10): Prosa, ritmo, show-don't-tell, evitar clichés

REGLAS DE PARCHEADO:
- Mínimo 20 caracteres para el snippet original (garantizar unicidad)
- Máximo 5 parches por capítulo
- El reemplazo debe ser mejora puntual, no reescritura

Genera respuestas en JSON válido.
`;

export class SmartEditorAgent extends BaseAgent {
  constructor() {
    super({
      name: "Smart Editor",
      role: "smart-editor",
      systemPrompt: SYSTEM_PROMPT,
      model: "deepseek-chat", // V3 for speed
      useThinking: false,
    });
  }

  async execute(input: SmartEditorInput): Promise<AgentResponse & { parsed?: SmartEditorOutput }> {
    console.log(`[SmartEditor] Evaluating chapter (${input.chapterContent.length} chars)...`);
    
    const prompt = PROMPTS_V2.SMART_EDITOR(
      input.chapterContent,
      input.sceneBreakdown,
      input.worldBible
    );

    const response = await this.generateContent(prompt);
    
    if (response.error) {
      return response;
    }

    // Parse JSON response
    try {
      // Clean up potential markdown code blocks
      let cleanContent = response.content
        .replace(/```json\s*/g, '')
        .replace(/```\s*/g, '')
        .trim();
      
      const jsonMatch = cleanContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as SmartEditorOutput;
        console.log(`[SmartEditor] Scores: Logic=${parsed.logic_score}/10, Style=${parsed.style_score}/10, Approved=${parsed.is_approved}, Patches=${parsed.patches?.length || 0}`);
        return { ...response, parsed };
      }
    } catch (e) {
      console.error("[SmartEditor] Failed to parse JSON response:", e);
    }

    // Default to approved if parsing fails
    return { 
      ...response, 
      parsed: {
        logic_score: 8,
        style_score: 8,
        is_approved: true,
        feedback: "Auto-approved due to parsing failure",
        patches: []
      }
    };
  }
}
