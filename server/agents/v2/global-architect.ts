// LitAgents 2.0 - Global Architect Agent
// Uses DeepSeek R1 (deepseek-reasoner) for deep planning

import { BaseAgent, AgentResponse } from "../base-agent";
import { PROMPTS_V2 } from "../agent-prompts-v2";

export interface GlobalArchitectInput {
  title: string;
  premise: string;
  genre: string;
  tone: string;
  chapterCount: number;
  architectInstructions?: string;
  extendedGuide?: string;
  styleGuide?: string;
  hasPrologue?: boolean;
  hasEpilogue?: boolean;
  hasAuthorNote?: boolean;
  workType?: string;
  seriesName?: string;
  seriesOrder?: number;
  previousBooksContext?: string;
  minWordsPerChapter?: number;
  maxWordsPerChapter?: number;
  isKindleUnlimited?: boolean;
}

export interface GlobalArchitectOutput {
  world_bible: {
    characters: Array<{
      name: string;
      role: string;
      profile: string;
      arc: string;
      appearance?: {
        eyes?: string;
        hair?: string;
        distinguishing_features?: string[];
      };
      initial_state?: {
        location?: string;
        physical_condition?: string;
        resources?: string[];
        skills?: string[];
      };
    }>;
    rules: Array<{
      category: string;
      rule: string;
      constraints?: string[];
    }>;
    settings?: Array<{
      name: string;
      description: string;
      atmosphere: string;
    }>;
    themes?: string[];
    location_map?: {
      primary_locations?: Array<{
        name: string;
        type?: string;
        key_places?: string[];
      }>;
      travel_times?: Array<{
        from: string;
        to: string;
        by_car?: string;
        by_plane?: string;
        by_train?: string;
      }>;
    };
  };
  plot_threads: Array<{
    name: string;
    description?: string;
    goal: string;
  }>;
  timeline_master?: {
    story_duration?: string;
    start_date?: string;
    chapter_timeline?: Array<{
      chapter: number;
      day: string;
      time_of_day: string;
      duration?: string;
      location?: string;
    }>;
    key_temporal_constraints?: string[];
  };
  character_tracking?: Array<{
    character: string;
    chapter_states?: Array<{
      chapter: number;
      location?: string;
      physical_state?: string;
      emotional_state?: string;
      key_possessions?: string[];
    }>;
  }>;
  outline: Array<{
    chapter_num: number;
    title: string;
    act?: number;
    summary: string;
    key_event: string;
    emotional_arc?: string;
    temporal_notes?: string;
    location?: string;
    character_states_entering?: string;
  }>;
  three_act_structure?: {
    act1: { chapters: number[]; goal: string };
    act2: { chapters: number[]; goal: string };
    act3: { chapters: number[]; goal: string };
  };
}

const SYSTEM_PROMPT = `
Eres el Global Architect, el Arquitecto Narrativo Maestro de LitAgents 2.0.
Tu misión es diseñar la estructura maestra de novelas que compitan al nivel de bestsellers internacionales.

PRINCIPIOS FUNDAMENTALES:
1. Cada novela debe tener una PREMISA clara que genere conflicto
2. Los personajes deben tener ARCOS de transformación medibles
3. La estructura de 3 ACTOS debe estar perfectamente balanceada
4. Cada capítulo debe tener un PROPÓSITO claro en la narrativa global
5. Los hilos narrativos deben mantener la TENSIÓN a lo largo de toda la obra

REGLAS DE DISEÑO:
- Mínimo 3 personajes principales con arcos definidos
- Mínimo 2 hilos narrativos que se entrelazan
- Cada capítulo debe tener un evento clave que avance la trama
- Los puntos de giro deben estar estratégicamente ubicados (25%, 50%, 75%)
- El clímax debe resolver los hilos principales mientras deja espacio para reflexión

Genera respuestas en JSON válido y estructurado.
`;

export class GlobalArchitectAgent extends BaseAgent {
  constructor() {
    super({
      name: "Global Architect",
      role: "global-architect",
      systemPrompt: SYSTEM_PROMPT,
      model: "deepseek-reasoner", // R1 for deep planning
      useThinking: true,
    });
  }

  async execute(input: GlobalArchitectInput): Promise<AgentResponse & { parsed?: GlobalArchitectOutput }> {
    console.log(`[GlobalArchitect] Designing master structure for "${input.title}"...`);
    
    const prompt = PROMPTS_V2.GLOBAL_ARCHITECT(
      input.premise,
      input.genre,
      input.chapterCount,
      input.tone,
      input.architectInstructions,
      input.extendedGuide,
      input.styleGuide,
      input.hasPrologue,
      input.hasEpilogue,
      input.hasAuthorNote,
      input.workType,
      input.seriesName,
      input.seriesOrder,
      input.previousBooksContext,
      input.minWordsPerChapter,
      input.maxWordsPerChapter,
      input.isKindleUnlimited
    );

    // For large chapter counts, request more output tokens to avoid truncation
    const maxTokens = input.chapterCount > 20 ? 32000 : 16000;
    const response = await this.generateContent(prompt, undefined, { maxCompletionTokens: maxTokens });
    
    if (response.error) {
      return response;
    }

    // Parse JSON response with multiple recovery strategies
    let parsed: GlobalArchitectOutput | null = null;
    let parseError: string | null = null;
    const content = response.content || "";
    
    // Helper to clean and repair common JSON issues
    const cleanJsonString = (str: string): string => {
      return str
        // Remove markdown code blocks
        .replace(/```json\s*/gi, '')
        .replace(/```\s*/g, '')
        // Remove trailing commas before } or ]
        .replace(/,(\s*[}\]])/g, '$1')
        // Remove control characters except valid whitespace
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
        .trim();
    };
    
    try {
      // Strategy 1: Match JSON object containing expected keys
      const jsonMatch = content.match(/\{[\s\S]*"outline"[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const cleanedJson = cleanJsonString(jsonMatch[0]);
          parsed = JSON.parse(cleanedJson) as GlobalArchitectOutput;
        } catch (e) {
          // Strategy 2: Find first { and last } for malformed JSON
          const firstBrace = content.indexOf('{');
          const lastBrace = content.lastIndexOf('}');
          if (firstBrace !== -1 && lastBrace > firstBrace) {
            try {
              const extracted = content.substring(firstBrace, lastBrace + 1);
              const cleanedExtracted = cleanJsonString(extracted);
              parsed = JSON.parse(cleanedExtracted) as GlobalArchitectOutput;
            } catch (e2) {
              // Strategy 3: Try to find balanced braces
              try {
                const balanced = this.extractBalancedJson(content);
                if (balanced) {
                  parsed = JSON.parse(cleanJsonString(balanced)) as GlobalArchitectOutput;
                } else {
                  parseError = `JSON malformado: ${e2}`;
                }
              } catch (e3) {
                parseError = `JSON malformado después de limpieza: ${e3}`;
              }
            }
          }
        }
      } else {
        // Strategy 4: Try parsing the entire content
        try {
          const trimmed = cleanJsonString(content);
          if (trimmed.startsWith('{')) {
            parsed = JSON.parse(trimmed) as GlobalArchitectOutput;
          }
        } catch (e) {
          parseError = "No se encontró estructura JSON válida en la respuesta";
        }
      }
    } catch (e) {
      parseError = `Error de parsing: ${e}`;
    }
    
    // Strategy 5: Truncation repair - if JSON was cut off mid-stream, try to close it
    if (!parsed && content.includes('"outline"')) {
      console.log("[GlobalArchitect] Attempting truncation repair...");
      try {
        parsed = this.repairTruncatedJson(content) as GlobalArchitectOutput;
        if (parsed) {
          console.log(`[GlobalArchitect] Truncation repair succeeded! Outline has ${parsed.outline?.length || 0} entries`);
        }
      } catch (repairErr) {
        console.warn("[GlobalArchitect] Truncation repair failed:", repairErr);
      }
    }
    
    // Validate parsed result
    if (!parsed) {
      console.error("[GlobalArchitect] Failed to parse JSON response:", parseError);
      console.error("[GlobalArchitect] Raw content preview:", content.substring(0, 500));
      return {
        ...response,
        error: `Error al parsear respuesta del Global Architect: ${parseError}. La IA no devolvió JSON válido.`,
        parsed: undefined
      };
    }
    
    // Validate required fields
    if (!parsed.outline || !Array.isArray(parsed.outline)) {
      console.error("[GlobalArchitect] Missing or invalid outline in response");
      return {
        ...response,
        error: "La respuesta no contiene un outline válido. Por favor, regenere el proyecto.",
        parsed: undefined
      };
    }
    
    if (!parsed.world_bible) {
      console.error("[GlobalArchitect] Missing world_bible in response");
      return {
        ...response,
        error: "La respuesta no contiene world_bible. Por favor, regenere el proyecto.",
        parsed: undefined
      };
    }
    
    // Validate chapter count - count only regular chapters (1-N, excluding 0, 998, 999)
    let regularChapters = parsed.outline.filter(ch => 
      ch.chapter_num > 0 && ch.chapter_num < 998
    );
    const expectedChapters = input.chapterCount;
    
    if (regularChapters.length !== expectedChapters) {
      console.warn(`[GlobalArchitect] CHAPTER COUNT MISMATCH: Expected ${expectedChapters} regular chapters, got ${regularChapters.length}`);
      console.warn(`[GlobalArchitect] Outline chapter_nums: ${parsed.outline.map(ch => ch.chapter_num).join(', ')}`);
      
      // If we got SOME chapters (at least 25% of expected), try to complete the missing ones
      if (regularChapters.length >= Math.max(3, Math.floor(expectedChapters * 0.25)) && regularChapters.length < expectedChapters) {
        console.log(`[GlobalArchitect] Attempting to complete missing chapters (${regularChapters.length}/${expectedChapters})...`);
        
        const existingNums = new Set(regularChapters.map(ch => ch.chapter_num));
        const missingNums: number[] = [];
        for (let i = 1; i <= expectedChapters; i++) {
          if (!existingNums.has(i)) missingNums.push(i);
        }
        
        const completionPrompt = `
Tienes un outline PARCIAL de una novela de ${expectedChapters} capítulos. Faltan ${missingNums.length} capítulos.

CAPÍTULOS EXISTENTES:
${regularChapters.map(ch => `Cap ${ch.chapter_num}: "${ch.title}" - ${ch.summary}`).join('\n')}

THREE ACT STRUCTURE:
${parsed.three_act_structure ? JSON.stringify(parsed.three_act_structure) : 'No disponible'}

PLOT THREADS:
${(parsed.plot_threads || []).map(t => `- ${t.name}: ${t.goal}`).join('\n')}

GENERA SOLO LOS CAPÍTULOS FALTANTES: ${missingNums.join(', ')}

Responde SOLO con un JSON array de los capítulos faltantes:
[
  {"chapter_num": ${missingNums[0]}, "title": "...", "act": 1, "summary": "...", "key_event": "..."},
  ...
]

REGLAS:
- Mantén coherencia con los capítulos existentes
- Cada capítulo debe avanzar la trama
- Usa formato compacto: summary máximo 1 línea, key_event máximo 15 palabras
- GENERA EXACTAMENTE ${missingNums.length} capítulos (nums: ${missingNums.join(', ')})
`;
        
        try {
          const completionResponse = await this.generateContent(completionPrompt, undefined, { maxCompletionTokens: maxTokens });
          if (completionResponse.content && !completionResponse.error) {
            const completionContent = completionResponse.content;
            // Try to parse the completion array
            const arrayMatch = completionContent.match(/\[[\s\S]*\]/);
            if (arrayMatch) {
              const cleanedArray = arrayMatch[0]
                .replace(/```json\s*/gi, '').replace(/```\s*/g, '')
                .replace(/,(\s*[\]}])/g, '$1')
                .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
                .trim();
              const missingChapters = JSON.parse(cleanedArray);
              if (Array.isArray(missingChapters) && missingChapters.length > 0) {
                // Merge missing chapters into the outline
                parsed.outline = [...parsed.outline, ...missingChapters];
                parsed.outline.sort((a, b) => a.chapter_num - b.chapter_num);
                
                // Update three_act_structure to include new chapters
                if (parsed.three_act_structure) {
                  const allRegularNums = parsed.outline
                    .filter(ch => ch.chapter_num > 0 && ch.chapter_num < 998)
                    .map(ch => ch.chapter_num);
                  
                  for (const ch of missingChapters) {
                    if (ch.act && ch.chapter_num > 0 && ch.chapter_num < 998) {
                      const actKey = `act${ch.act}` as 'act1' | 'act2' | 'act3';
                      if (parsed.three_act_structure[actKey] && 
                          !parsed.three_act_structure[actKey].chapters.includes(ch.chapter_num)) {
                        parsed.three_act_structure[actKey].chapters.push(ch.chapter_num);
                        parsed.three_act_structure[actKey].chapters.sort((a, b) => a - b);
                      }
                    }
                  }
                }
                
                // Re-validate
                regularChapters = parsed.outline.filter(ch => ch.chapter_num > 0 && ch.chapter_num < 998);
                console.log(`[GlobalArchitect] After completion: ${regularChapters.length}/${expectedChapters} chapters`);
                
                // Merge token usage
                if (completionResponse.tokenUsage) {
                  response.tokenUsage = {
                    inputTokens: (response.tokenUsage?.inputTokens || 0) + (completionResponse.tokenUsage?.inputTokens || 0),
                    outputTokens: (response.tokenUsage?.outputTokens || 0) + (completionResponse.tokenUsage?.outputTokens || 0),
                    thinkingTokens: (response.tokenUsage?.thinkingTokens || 0) + (completionResponse.tokenUsage?.thinkingTokens || 0),
                  };
                }
              }
            }
          }
        } catch (completionError) {
          console.error(`[GlobalArchitect] Completion attempt failed:`, completionError);
        }
      }
      
      // Final check after completion attempt
      regularChapters = parsed.outline.filter(ch => ch.chapter_num > 0 && ch.chapter_num < 998);
      if (regularChapters.length !== expectedChapters) {
        console.error(`[GlobalArchitect] Still ${regularChapters.length}/${expectedChapters} chapters after completion attempt`);
        return {
          ...response,
          error: `El outline generado tiene ${regularChapters.length} capítulos regulares pero se solicitaron ${expectedChapters}. Por favor, regenere el proyecto.`,
          parsed: undefined
        };
      }
    }
    
    console.log(`[GlobalArchitect] Successfully parsed and validated: ${regularChapters.length} regular chapters, ${parsed.plot_threads?.length || 0} threads`);
    
    // LitAgents 2.8: Validate subplot coherence BEFORE writing begins
    const subplotValidation = this.validateSubplotCoherence(parsed);
    if (subplotValidation.hasIssues) {
      console.warn(`[GlobalArchitect] SUBPLOT COHERENCE ISSUES DETECTED:`);
      subplotValidation.issues.forEach(issue => console.warn(`  - ${issue}`));
      
      // Attach warnings to the response but don't fail - let the user decide
      return { 
        ...response, 
        parsed,
        subplotWarnings: subplotValidation.issues,
      } as AgentResponse & { parsed?: GlobalArchitectOutput; subplotWarnings?: string[] };
    }
    
    return { ...response, parsed };
  }

  /**
   * Repair truncated JSON by finding the last valid entry in the outline array
   * and closing all open brackets/braces. This salvages partial responses.
   */
  private repairTruncatedJson(content: string): any | null {
    const cleanedContent = content
      .replace(/```json\s*/gi, '').replace(/```\s*/g, '')
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
    
    const firstBrace = cleanedContent.indexOf('{');
    if (firstBrace === -1) return null;
    
    let json = cleanedContent.substring(firstBrace);
    
    // Find the last complete outline entry by looking for the last complete object pattern
    // Look for the last "chapter_num": N pattern that has a closing }
    const lastCompleteEntry = json.lastIndexOf('"}');
    if (lastCompleteEntry === -1) return null;
    
    // Truncate to last complete entry
    json = json.substring(0, lastCompleteEntry + 2);
    
    // Count unclosed brackets/braces
    let openBraces = 0;
    let openBrackets = 0;
    let inStr = false;
    let esc = false;
    
    for (const ch of json) {
      if (esc) { esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (!inStr) {
        if (ch === '{') openBraces++;
        else if (ch === '}') openBraces--;
        else if (ch === '[') openBrackets++;
        else if (ch === ']') openBrackets--;
      }
    }
    
    // Remove trailing commas
    json = json.replace(/,(\s*)$/, '$1');
    
    // Close open brackets and braces
    for (let i = 0; i < openBrackets; i++) json += ']';
    for (let i = 0; i < openBraces; i++) json += '}';
    
    // Clean trailing commas before closers
    json = json.replace(/,(\s*[}\]])/g, '$1');
    
    try {
      return JSON.parse(json);
    } catch {
      return null;
    }
  }

  /**
   * Extract balanced JSON from content by counting braces.
   * Handles cases where extra text follows the JSON object.
   */
  private extractBalancedJson(content: string): string | null {
    const firstBrace = content.indexOf('{');
    if (firstBrace === -1) return null;
    
    let depth = 0;
    let inString = false;
    let escaped = false;
    
    for (let i = firstBrace; i < content.length; i++) {
      const char = content[i];
      
      if (escaped) {
        escaped = false;
        continue;
      }
      
      if (char === '\\') {
        escaped = true;
        continue;
      }
      
      if (char === '"' && !escaped) {
        inString = !inString;
        continue;
      }
      
      if (!inString) {
        if (char === '{') depth++;
        if (char === '}') {
          depth--;
          if (depth === 0) {
            return content.substring(firstBrace, i + 1);
          }
        }
      }
    }
    
    return null; // Unbalanced braces
  }

  /**
   * LitAgents 2.8: Validates subplot coherence before writing begins.
   * Checks that each plot_thread has chapters that develop it.
   */
  private validateSubplotCoherence(output: GlobalArchitectOutput): { hasIssues: boolean; issues: string[] } {
    const issues: string[] = [];
    const plotThreads = output.plot_threads || [];
    const outline = output.outline || [];
    const threeActStructure = output.three_act_structure;
    
    // Check 1: Each plot_thread should be referenced in at least one chapter summary
    for (const thread of plotThreads) {
      const threadName = thread.name?.toLowerCase() || "";
      const threadGoal = thread.goal?.toLowerCase() || "";
      
      // Search for thread mentions in chapter summaries and key events
      const mentionedInChapters = outline.filter(ch => {
        const summary = (ch.summary || "").toLowerCase();
        const keyEvent = (ch.key_event || "").toLowerCase();
        const emotionalArc = (ch.emotional_arc || "").toLowerCase();
        const combined = `${summary} ${keyEvent} ${emotionalArc}`;
        
        // Check if any significant word from the thread appears
        const threadKeywords = threadName.split(/\s+/).filter(w => w.length > 3);
        return threadKeywords.some(keyword => combined.includes(keyword));
      });
      
      if (mentionedInChapters.length === 0) {
        issues.push(`SUBTRAMA HUÉRFANA: "${thread.name}" no tiene capítulos que la desarrollen explícitamente. Considere añadirla a los resúmenes de capítulos o eliminarla.`);
      } else if (mentionedInChapters.length < 2) {
        issues.push(`SUBTRAMA DÉBIL: "${thread.name}" solo aparece en 1 capítulo. Las subtramas efectivas necesitan setup + desarrollo + payoff (mínimo 3 apariciones).`);
      }
    }
    
    // Check 2: Three-act structure balance (if present)
    if (threeActStructure) {
      const act1Chapters = threeActStructure.act1?.chapters?.length || 0;
      const act2Chapters = threeActStructure.act2?.chapters?.length || 0;
      const act3Chapters = threeActStructure.act3?.chapters?.length || 0;
      const totalChapters = act1Chapters + act2Chapters + act3Chapters;
      
      if (totalChapters > 0) {
        // Ideal: Act1=25%, Act2=50%, Act3=25%
        const act1Ratio = act1Chapters / totalChapters;
        const act2Ratio = act2Chapters / totalChapters;
        const act3Ratio = act3Chapters / totalChapters;
        
        if (act1Ratio > 0.4) {
          issues.push(`ESTRUCTURA DESEQUILIBRADA: Acto 1 ocupa ${Math.round(act1Ratio * 100)}% de la novela (ideal: 20-25%). Setup demasiado largo puede causar ritmo lento.`);
        }
        if (act2Ratio < 0.35) {
          issues.push(`ESTRUCTURA DESEQUILIBRADA: Acto 2 solo ocupa ${Math.round(act2Ratio * 100)}% (ideal: 45-55%). El desarrollo de conflictos será insuficiente.`);
        }
        if (act3Ratio > 0.35) {
          issues.push(`ESTRUCTURA DESEQUILIBRADA: Acto 3 ocupa ${Math.round(act3Ratio * 100)}% (ideal: 20-25%). Resolución demasiado larga puede diluir el impacto.`);
        }
      }
    }
    
    // Check 3: Character arcs have proper development
    const characters = output.world_bible?.characters || [];
    for (const character of characters) {
      if (character.role === "protagonist" || character.role === "antagonist") {
        const charName = (character.name || "").toLowerCase();
        
        // Count chapter appearances in summaries/key events
        const appearances = outline.filter(ch => {
          const combined = `${ch.summary || ""} ${ch.key_event || ""}`.toLowerCase();
          return combined.includes(charName);
        });
        
        if (appearances.length < 3) {
          issues.push(`ARCO INCOMPLETO: ${character.name} (${character.role}) solo aparece en ${appearances.length} capítulo(s). Protagonistas/antagonistas necesitan presencia sostenida.`);
        }
      }
    }
    
    return {
      hasIssues: issues.length > 0,
      issues,
    };
  }
}
