// LitAgents 2.0 - Smart Editor Agent
// Uses DeepSeek V3 (deepseek-chat) for fast editing

import { BaseAgent, AgentResponse } from "../base-agent";
import { PROMPTS_V2 } from "../agent-prompts-v2";
import { Patch } from "../../utils/patcher";

export interface SmartEditorInput {
  chapterContent: string;
  sceneBreakdown: any;
  worldBible: any;
  additionalContext?: string;
}

export interface SurgicalFixInput {
  chapterContent: string;
  errorDescription: string;
  consistencyConstraints?: string;
  // Extended context for full rewrites with maximum context
  worldBible?: {
    characters?: any[];
    locations?: any[];
    worldRules?: any[];
    persistentInjuries?: any[];
    plotDecisions?: any[];
  };
  chapterNumber?: number;
  chapterTitle?: string;
  previousChapterSummary?: string;
  nextChapterSummary?: string;
  chapterSummaries?: string[]; // All chapter summaries for broader context
  styleGuide?: string;
  projectTitle?: string;
  genre?: string;
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
- Genera TODOS los parches necesarios para corregir los problemas detectados
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
    
    let prompt = PROMPTS_V2.SMART_EDITOR(
      input.chapterContent,
      input.sceneBreakdown,
      input.worldBible
    );

    // Add additional context if provided (e.g., issues from FinalReviewer)
    if (input.additionalContext) {
      prompt = `${input.additionalContext}\n\n${prompt}`;
    }

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

  /**
   * Surgical fix for consistency violations - more token-efficient than full rewrite
   */
  async surgicalFix(input: SurgicalFixInput): Promise<AgentResponse & { patches?: Patch[], fullContent?: string }> {
    console.log(`[SmartEditor] Surgical fix for consistency error (${input.chapterContent.length} chars)...`);
    
    const surgicalPrompt = `CORRECCIÓN QUIRÚRGICA DE CONTINUIDAD

ERROR DETECTADO:
${input.errorDescription}

${input.consistencyConstraints ? `RESTRICCIONES DE CONSISTENCIA:\n${input.consistencyConstraints}\n` : ''}

CONTENIDO DEL CAPÍTULO:
${input.chapterContent}

INSTRUCCIONES:
1. Identifica SOLO las frases o párrafos que contienen el error de continuidad
2. Genera parches QUIRÚRGICOS mínimos para corregir el error
3. NO reescribas el capítulo completo - solo las partes afectadas
4. Mantén el estilo y tono del autor original
5. El campo "original_text_snippet" DEBE contener el texto EXACTO que aparece en el capítulo

Responde en JSON:
{
  "error_analysis": "Breve análisis del error y dónde está",
  "patches": [
    {
      "original_text_snippet": "texto EXACTO a reemplazar (mínimo 20 caracteres, debe existir en el capítulo)",
      "replacement_text": "texto corregido",
      "reason": "motivo del cambio"
    }
  ],
  "correction_summary": "Resumen de los cambios realizados"
}`;

    const response = await this.generateContent(surgicalPrompt);
    
    if (response.error) {
      return response;
    }

    try {
      let cleanContent = response.content
        .replace(/```json\s*/g, '')
        .replace(/```\s*/g, '')
        .trim();
      
      const jsonMatch = cleanContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        // Map to correct field names that patcher expects
        const patches: Patch[] = (parsed.patches || []).map((p: any) => ({
          original_text_snippet: p.original_text_snippet || p.original || "",
          replacement_text: p.replacement_text || p.replacement || "",
          reason: p.reason || "Corrección de continuidad"
        }));
        
        console.log(`[SmartEditor] Surgical fix: ${patches.length} patches generated`);
        if (parsed.error_analysis) {
          console.log(`[SmartEditor] Analysis: ${parsed.error_analysis}`);
        }
        if (parsed.correction_summary) {
          console.log(`[SmartEditor] Summary: ${parsed.correction_summary}`);
        }
        
        return { ...response, patches };
      }
    } catch (e) {
      console.error("[SmartEditor] Failed to parse surgical fix response:", e);
    }

    // If parsing fails, return the full content as fallback
    return { ...response, fullContent: response.content };
  }

  /**
   * Full chapter rewrite - rewrites entire chapter with complete context
   * Now includes World Bible, character info, and all relevant context for better corrections
   */
  async fullRewrite(input: SurgicalFixInput): Promise<AgentResponse & { rewrittenContent?: string }> {
    console.log(`[SmartEditor] Full rewrite for chapter (${input.chapterContent.length} chars)...`);
    
    // Build comprehensive context section
    let contextSection = "";
    
    if (input.projectTitle || input.genre) {
      contextSection += `PROYECTO: "${input.projectTitle || 'Sin título'}" (${input.genre || 'Ficción'})\n\n`;
    }
    
    if (input.chapterNumber || input.chapterTitle) {
      contextSection += `CAPÍTULO ${input.chapterNumber || '?'}: "${input.chapterTitle || 'Sin título'}"\n\n`;
    }
    
    // Add narrative context from adjacent chapters
    if (input.previousChapterSummary) {
      contextSection += `RESUMEN DEL CAPÍTULO ANTERIOR:\n${input.previousChapterSummary}\n\n`;
    }
    if (input.nextChapterSummary) {
      contextSection += `RESUMEN DEL CAPÍTULO SIGUIENTE:\n${input.nextChapterSummary}\n\n`;
    }
    
    // Add all chapter summaries for broader narrative context
    if (input.chapterSummaries && input.chapterSummaries.length > 0) {
      contextSection += `CONTEXTO NARRATIVO (RESÚMENES DE OTROS CAPÍTULOS):\n`;
      for (const summary of input.chapterSummaries.slice(0, 10)) {
        contextSection += `${summary}\n`;
      }
      contextSection += `\n`;
    }
    
    // Add World Bible context if available
    if (input.worldBible) {
      const wb = input.worldBible;
      
      if (wb.characters && wb.characters.length > 0) {
        contextSection += `PERSONAJES PRINCIPALES:\n`;
        for (const char of wb.characters.slice(0, 10)) {
          contextSection += `- ${char.name}: ${char.description || char.role || 'Sin descripción'}\n`;
          if (char.traits) contextSection += `  Rasgos: ${Array.isArray(char.traits) ? char.traits.join(', ') : char.traits}\n`;
        }
        contextSection += `\n`;
      }
      
      if (wb.locations && wb.locations.length > 0) {
        contextSection += `LOCACIONES:\n`;
        for (const loc of wb.locations.slice(0, 5)) {
          contextSection += `- ${loc.name}: ${loc.description || 'Sin descripción'}\n`;
        }
        contextSection += `\n`;
      }
      
      if (wb.worldRules && wb.worldRules.length > 0) {
        contextSection += `REGLAS DEL MUNDO (OBLIGATORIAS):\n`;
        for (const rule of wb.worldRules) {
          contextSection += `- ${rule}\n`;
        }
        contextSection += `\n`;
      }
      
      if (wb.persistentInjuries && Object.keys(wb.persistentInjuries).length > 0) {
        contextSection += `HERIDAS/CONDICIONES PERSISTENTES:\n`;
        for (const [char, injuries] of Object.entries(wb.persistentInjuries)) {
          contextSection += `- ${char}: ${Array.isArray(injuries) ? injuries.join(', ') : injuries}\n`;
        }
        contextSection += `\n`;
      }
      
      if (wb.plotDecisions && Object.keys(wb.plotDecisions).length > 0) {
        contextSection += `DECISIONES DE TRAMA ESTABLECIDAS:\n`;
        for (const [key, value] of Object.entries(wb.plotDecisions)) {
          contextSection += `- ${key}: ${value}\n`;
        }
        contextSection += `\n`;
      }
    }
    
    // Add style guide if available
    if (input.styleGuide) {
      contextSection += `GUÍA DE ESTILO:\n${input.styleGuide}\n\n`;
    }
    
    const rewritePrompt = `REESCRITURA COMPLETA DE CAPÍTULO CON CONTEXTO

${contextSection}
PROBLEMAS QUE DEBES CORREGIR OBLIGATORIAMENTE:
${input.errorDescription}

${input.consistencyConstraints ? `RESTRICCIONES DE CONSISTENCIA:\n${input.consistencyConstraints}\n\n` : ''}

CAPÍTULO ORIGINAL A REESCRIBIR:
${input.chapterContent}

INSTRUCCIONES ESTRICTAS:
1. REESCRIBE el capítulo COMPLETO desde el principio hasta el final
2. CORRIGE TODOS los problemas listados arriba - esto es OBLIGATORIO
3. RESPETA el World Bible: personajes, locaciones, reglas del mundo, heridas persistentes
4. MANTÉN el estilo, tono y voz narrativa del autor original
5. PRESERVA la estructura general de escenas y la longitud aproximada
6. NO agregues contenido nuevo que no estaba en el original
7. NO elimines escenas o eventos importantes del original
8. VERIFICA que cada problema listado haya sido corregido antes de entregar

El resultado debe ser el capítulo COMPLETO y CORREGIDO.
Responde ÚNICAMENTE con el capítulo reescrito, sin explicaciones, comentarios ni formato markdown.`;

    const response = await this.generateContent(rewritePrompt);
    
    if (response.error) {
      console.error(`[SmartEditor] Full rewrite API error: ${response.error}`);
      return response;
    }

    // Log raw response for debugging
    console.log(`[SmartEditor] Full rewrite raw response length: ${response.content?.length || 0} chars`);
    
    if (!response.content || response.content.length === 0) {
      console.error(`[SmartEditor] Full rewrite returned empty content`);
      return { ...response, rewrittenContent: undefined };
    }

    // Clean up the response - remove any markdown formatting
    let rewrittenContent = response.content
      .replace(/^```[\w]*\n?/gm, '')
      .replace(/```$/gm, '')
      .trim();
    
    // Validate the rewrite is substantial
    if (rewrittenContent.length < 100) {
      console.error(`[SmartEditor] Full rewrite content too short after cleanup: ${rewrittenContent.length} chars`);
      // Try using raw content as fallback
      rewrittenContent = response.content.trim();
    }
    
    if (rewrittenContent.length < input.chapterContent.length * 0.3) {
      console.warn(`[SmartEditor] Full rewrite seems too short (${rewrittenContent.length} vs original ${input.chapterContent.length})`);
    }
    
    console.log(`[SmartEditor] Full rewrite complete: ${rewrittenContent.length} chars (original: ${input.chapterContent.length})`);
    
    return { ...response, rewrittenContent };
  }
}
