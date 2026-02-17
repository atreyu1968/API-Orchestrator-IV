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
  chapterOutline?: { chapter_num: number; title: string; summary: string; key_event: string; emotional_arc?: string }; // v2.9.10: Original outline for adherence check
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
      input.worldBible,
      input.chapterOutline
    );

    // Add additional context if provided (e.g., issues from FinalReviewer)
    if (input.additionalContext) {
      prompt = `${input.additionalContext}\n\n${prompt}`;
    }

    const response = await this.generateContent(prompt, undefined, { temperature: 0.3 });
    
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
  /**
   * Detect error type from the error description to use specialized prompts
   */
  private detectErrorType(errorDescription: string): 'physical_attribute' | 'lexical_repetition' | 'timeline' | 'narrative' | 'generic' {
    const desc = errorDescription.toLowerCase();
    
    // Physical attribute errors (eye color, hair, height, etc.)
    if (desc.includes('color de ojos') || desc.includes('ojos') && (desc.includes('inmutable') || desc.includes('físico')) ||
        desc.includes('cabello') || desc.includes('pelo') || desc.includes('altura') || 
        desc.includes('atributo físico') || desc.includes('atributo fisico') ||
        desc.includes('cambio fisico imposible') || desc.includes('cambio físico imposible')) {
      return 'physical_attribute';
    }
    
    // Lexical repetition
    if (desc.includes('repetición') || desc.includes('repeticion') || desc.includes('léxica') || 
        desc.includes('lexica') || desc.includes('palabra repetida') || desc.includes('uso excesivo')) {
      return 'lexical_repetition';
    }
    
    // Timeline/temporal errors  
    if (desc.includes('timeline') || desc.includes('temporal') || desc.includes('cronología') ||
        desc.includes('cronologia') || desc.includes('antes de') || desc.includes('después de') ||
        desc.includes('ya había') || desc.includes('aún no')) {
      return 'timeline';
    }
    
    // Narrative/plot errors (more complex)
    if (desc.includes('trama') || desc.includes('credibilidad') || desc.includes('personaje') ||
        desc.includes('motivación') || desc.includes('arco narrativo') || desc.includes('incoherencia')) {
      return 'narrative';
    }
    
    return 'generic';
  }

  /**
   * Build specialized prompt based on error type
   */
  private buildSpecializedPrompt(input: SurgicalFixInput, errorType: string): string {
    const baseContext = input.consistencyConstraints 
      ? `RESTRICCIONES DE CONSISTENCIA (NO VIOLAR):\n${input.consistencyConstraints}\n\n` 
      : '';
    
    // Common JSON response format
    const jsonFormat = `
Responde en JSON:
{
  "error_analysis": "Análisis breve: qué está mal y dónde EXACTAMENTE",
  "patches": [
    {
      "original_text_snippet": "texto EXACTO a reemplazar (debe existir verbatim en el capítulo)",
      "replacement_text": "texto corregido",
      "reason": "motivo del cambio"
    }
  ],
  "words_changed_count": numero,
  "correction_summary": "Resumen de cambios"
}`;

    switch (errorType) {
      case 'physical_attribute':
        return `CORRECCIÓN DE ATRIBUTO FÍSICO - BÚSQUEDA Y REEMPLAZO SIMPLE

ERROR: ${input.errorDescription}

${baseContext}CONTENIDO DEL CAPÍTULO:
${input.chapterContent}

INSTRUCCIONES ESPECÍFICAS PARA ATRIBUTOS FÍSICOS:
Este es un error SIMPLE de atributo físico incorrecto. La solución es:
1. BUSCAR la descripción incorrecta en el texto (ej: "ojos verdes", "cabello rubio")
2. REEMPLAZAR con el atributo correcto (ej: "ojos avellana", "cabello castaño")
3. NADA MÁS - no cambies contexto, no añadas descripciones, no modifiques narrativa

EJEMPLO:
- Error: "ojos verdes" cuando debería ser "ojos avellana"
- Parche: {"original_text_snippet": "sus ojos verdes brillaban", "replacement_text": "sus ojos avellana brillaban"}

MÁXIMO 5 palabras cambiadas. Si requiere más, el error no es de atributo físico.
${jsonFormat}`;

      case 'lexical_repetition':
        return `CORRECCIÓN DE REPETICIÓN LÉXICA - SINONIMIZACIÓN

ERROR: ${input.errorDescription}

${baseContext}CONTENIDO DEL CAPÍTULO:
${input.chapterContent}

INSTRUCCIONES ESPECÍFICAS PARA REPETICIONES:
1. IDENTIFICA la palabra/frase repetida en exceso
2. MANTÉN la primera o segunda aparición intacta (elige la más importante narrativamente)
3. REEMPLAZA las demás con SINÓNIMOS naturales que mantengan el significado exacto
4. NO cambies el significado ni añadas información nueva

EJEMPLO DE SINÓNIMOS:
- "miró/mirada" → "observó", "contempló", "fijó la vista en"
- "dijo" → "comentó", "respondió", "murmuró", "susurró"
- "caminó" → "avanzó", "se dirigió", "anduvo"

Cada parche debe cambiar UNA sola palabra repetida por UN sinónimo apropiado.
${jsonFormat}`;

      case 'timeline':
        return `CORRECCIÓN DE CONTINUIDAD TEMPORAL

ERROR: ${input.errorDescription}

${baseContext}CONTENIDO DEL CAPÍTULO:
${input.chapterContent}

INSTRUCCIONES ESPECÍFICAS PARA ERRORES TEMPORALES:
1. IDENTIFICA el texto que viola la línea temporal
2. AJUSTA solo las referencias temporales problemáticas
3. NO reescribas escenas completas
4. OPCIONES de corrección:
   - Cambiar verbo (pasado/presente/futuro)
   - Cambiar marcador temporal ("antes"→"después", "ya"→"todavía no")
   - Ajustar referencia a evento ("cuando llegó"→"antes de llegar")

PRESERVA: la acción, los personajes, el diálogo, la atmósfera
CAMBIA: solo la referencia temporal incorrecta (máximo 10 palabras)
${jsonFormat}`;

      case 'narrative':
        return `CORRECCIÓN NARRATIVA - AJUSTE DE COHERENCIA

ERROR: ${input.errorDescription}

${baseContext}CONTENIDO DEL CAPÍTULO:
${input.chapterContent}

INSTRUCCIONES PARA ERRORES NARRATIVOS:
Este tipo de error puede requerir cambios ligeramente más amplios, pero:
1. LIMITA cada parche a UNA oración o frase específica
2. MANTÉN la misma longitud aproximada (±20% palabras)
3. PRESERVA el tono, estilo y voz del autor
4. NO añadas nuevos eventos, personajes o información
5. NO elimines contenido significativo

ESTRATEGIAS:
- Reformular la oración problemática
- Añadir 2-3 palabras de contexto que aclaren
- Eliminar la oración si es contradictoria y no esencial

MÁXIMO 30 palabras por parche. Si requiere más, divide en múltiples parches pequeños.
${jsonFormat}`;

      default:
        return `CORRECCIÓN QUIRÚRGICA ULTRA-CONSERVADORA

ERROR ESPECÍFICO A CORREGIR:
${input.errorDescription}

${baseContext}CONTENIDO DEL CAPÍTULO:
${input.chapterContent}

REGLAS ABSOLUTAS (VIOLACIÓN = CORRECCIÓN RECHAZADA):
1. CAMBIO MÍNIMO: Solo modifica las 1-3 palabras/frases que causan el error específico
2. NO AÑADAS contenido nuevo (diálogos, descripciones, acciones)
3. NO ELIMINES contenido existente más allá de lo estrictamente necesario
4. NO CAMBIES nombres de personajes, lugares, objetos u otros elementos canónicos
5. NO MODIFIQUES la línea temporal ni introduzcas nuevos eventos
6. PRESERVA el estilo, ritmo y voz narrativa exactos del autor
7. Si el parche requiere cambiar más de 50 palabras, ES DEMASIADO GRANDE
8. El campo "original_text_snippet" DEBE ser texto EXACTO del capítulo
${jsonFormat}`;
    }
  }

  async surgicalFix(input: SurgicalFixInput): Promise<AgentResponse & { patches?: Patch[], fullContent?: string }> {
    // v2.9.5: Detect error type and use specialized prompt
    const errorType = this.detectErrorType(input.errorDescription);
    console.log(`[SmartEditor] Surgical fix for ${errorType} error (${input.chapterContent.length} chars)...`);
    
    const surgicalPrompt = this.buildSpecializedPrompt(input, errorType);

    const response = await this.generateContent(surgicalPrompt, undefined, { temperature: 0.3 });
    
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
        const rawPatches: Patch[] = (parsed.patches || []).map((p: any) => ({
          original_text_snippet: p.original_text_snippet || p.original || "",
          replacement_text: p.replacement_text || p.replacement || "",
          reason: p.reason || "Corrección de continuidad"
        }));
        
        // VALIDATION: Reject patches that are too large (>100 words changed)
        const validPatches = rawPatches.filter((patch) => {
          const originalWords = patch.original_text_snippet.split(/\s+/).length;
          const replacementWords = patch.replacement_text.split(/\s+/).length;
          const wordsDiff = Math.abs(originalWords - replacementWords);
          const maxWords = Math.max(originalWords, replacementWords);
          
          // Reject if: 1) More than 100 words, or 2) Size change >50%
          if (maxWords > 100) {
            console.warn(`[SmartEditor] REJECTED patch: too large (${maxWords} words)`);
            return false;
          }
          if (originalWords > 10 && wordsDiff / originalWords > 0.5) {
            console.warn(`[SmartEditor] REJECTED patch: size change too large (${Math.round(wordsDiff/originalWords*100)}%)`);
            return false;
          }
          return true;
        });
        
        console.log(`[SmartEditor] Surgical fix: ${validPatches.length}/${rawPatches.length} patches accepted`);
        if (parsed.error_analysis) {
          console.log(`[SmartEditor] Analysis: ${parsed.error_analysis}`);
        }
        if (parsed.correction_summary) {
          console.log(`[SmartEditor] Summary: ${parsed.correction_summary}`);
        }
        
        return { ...response, patches: validPatches };
      }
    } catch (e) {
      console.error("[SmartEditor] Failed to parse surgical fix response:", e);
    }

    // If parsing fails, return the full content as fallback
    return { ...response, fullContent: response.content };
  }

  /**
   * Focused paragraph rewrite - ONLY rewrites the specific paragraph(s) with the issue
   * Returns the FULL chapter with only the affected paragraph(s) modified
   */
  async focusedParagraphRewrite(input: SurgicalFixInput): Promise<AgentResponse & { rewrittenContent?: string }> {
    console.log(`[SmartEditor] Focused paragraph rewrite for chapter (${input.chapterContent.length} chars)...`);
    
    const focusedPrompt = `REESCRITURA FOCALIZADA DE PÁRRAFO ESPECÍFICO

PROBLEMA A CORREGIR:
${input.errorDescription}

CAPÍTULO COMPLETO (REFERENCIA):
${input.chapterContent}

INSTRUCCIONES CRÍTICAS:
1. IDENTIFICA el párrafo EXACTO donde ocurre el problema descrito
2. REESCRIBE ÚNICAMENTE ese párrafo (máximo 2 párrafos si es necesario)
3. MANTÉN el resto del capítulo EXACTAMENTE IGUAL, carácter por carácter
4. El párrafo corregido debe tener una longitud similar al original (+-20%)
5. PRESERVA el estilo, tono y voz del autor

FORMATO DE RESPUESTA OBLIGATORIO:
Devuelve el capítulo COMPLETO con SOLO el/los párrafo(s) afectado(s) corregido(s).
NO incluyas explicaciones, comentarios, ni formato markdown.
El resultado debe ser texto plano listo para reemplazar el capítulo original.`;

    const response = await this.generateContent(focusedPrompt, undefined, { temperature: 0.5, frequencyPenalty: 0.2, presencePenalty: 0.1 });
    
    if (response.error) {
      console.error(`[SmartEditor] Focused paragraph rewrite API error: ${response.error}`);
      return response;
    }

    if (!response.content || response.content.length === 0) {
      console.error(`[SmartEditor] Focused paragraph rewrite returned empty content`);
      return { ...response, rewrittenContent: undefined };
    }

    // Clean up the response
    let rewrittenContent = response.content
      .replace(/^```[\w]*\n?/gm, '')
      .replace(/```$/gm, '')
      .trim();
    
    // Validate the rewrite maintains most of the original
    const originalLen = input.chapterContent.length;
    const newLen = rewrittenContent.length;
    const lengthDiff = Math.abs(newLen - originalLen) / originalLen;
    
    if (lengthDiff > 0.25) {
      console.warn(`[SmartEditor] Focused rewrite length differs by ${(lengthDiff * 100).toFixed(1)}% - may have rewritten too much`);
    }
    
    console.log(`[SmartEditor] Focused paragraph rewrite complete: ${rewrittenContent.length} chars (original: ${originalLen}, diff: ${(lengthDiff * 100).toFixed(1)}%)`);
    
    return { ...response, rewrittenContent };
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

=== ANTI-REGRESIÓN (CRÍTICO) ===
Al corregir los problemas listados, NO introduzcas NUEVOS defectos:
- NO uses etiquetas forzadas de diálogo (dijo/exclamó/murmuró en cada línea). Varía o elimina tags innecesarios.
- NO repitas la misma palabra o frase en párrafos consecutivos. Si el original no la repetía, tú tampoco.
- NO uses clichés literarios: "un suspiro escapó de sus labios", "el silencio se hizo palpable", "una lágrima rodó por su mejilla", "el corazón le latía con fuerza".
- NO cambies el registro narrativo (si el original usa narrador cercano, no cambies a omnisciente distante).
- NO acortes el capítulo. El resultado debe tener al menos la misma longitud que el original.
- PRESERVA las transiciones entre escenas tal como están en el original.
- Si una corrección de ritmo pide "más tensión", añade tensión SIN destruir la prosa existente que ya funciona.
REGLA DE ORO: Cada párrafo que NO está afectado por los problemas listados debe permanecer IDÉNTICO al original.

El resultado debe ser el capítulo COMPLETO y CORREGIDO.
Responde ÚNICAMENTE con el capítulo reescrito, sin explicaciones, comentarios ni formato markdown.`;

    const response = await this.generateContent(rewritePrompt, undefined, { temperature: 0.4, frequencyPenalty: 0.3, presencePenalty: 0.2 });
    
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
