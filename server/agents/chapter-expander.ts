import { BaseAgent, AgentResponse } from "./base-agent";

interface ChapterSummary {
  chapterNumber: number;
  title: string;
  wordCount: number;
  summary: string;
}

interface ExpansionAnalysisInput {
  chapters: ChapterSummary[];
  genre: string;
  targetMinWordsPerChapter: number;
  enableNewChapters: boolean;
  enableChapterExpansion: boolean;
}

export interface ExpansionPlan {
  chaptersToExpand: Array<{
    chapterNumber: number;
    currentWords: number;
    targetWords: number;
    expansionType: "scenes" | "dialogue" | "description" | "introspection";
    suggestedContent: string;
    necessityScore: number;
  }>;
  newChaptersToInsert: Array<{
    insertAfterChapter: number;
    title: string;
    purpose: string;
    plotPoints: string[];
    estimatedWords: number;
    necessityScore: number;
    justification: string;
  }>;
  totalEstimatedNewWords: number;
  reasoning: string;
  overallNecessityAssessment: "none" | "minor" | "moderate" | "critical";
}

interface ChapterExpansionInput {
  chapterContent: string;
  chapterNumber: number;
  chapterTitle: string;
  expansionPlan: {
    targetWords: number;
    expansionType: string;
    suggestedContent: string;
  };
  worldBible?: any;
  adjacentContext?: { previousSummary?: string; nextSummary?: string };
}

export interface ExpandedChapterResult {
  expandedContent: string;
  originalWordCount: number;
  newWordCount: number;
  addedScenes: string[];
  addedDialogues: number;
  addedDescriptions: string[];
}

interface NewChapterInput {
  insertAfterChapter: number;
  title: string;
  purpose: string;
  plotPoints: string[];
  estimatedWords: number;
  worldBible?: any;
  previousChapterSummary: string;
  nextChapterSummary: string;
  genre: string;
}

export interface NewChapterResult {
  content: string;
  title: string;
  wordCount: number;
  chapterNumber: number;
}

const ANALYSIS_SYSTEM_PROMPT = `Eres un ARQUITECTO LITERARIO CONSERVADOR experto en análisis estructural de novelas. Tu filosofía: "Si no está roto, no lo arregles."

PRINCIPIO FUNDAMENTAL: La mayoría de manuscritos NO necesitan expansión ni capítulos nuevos. Solo recomienda cambios cuando hay un PROBLEMA REAL que afecte la comprensión del lector.

═══════════════════════════════════════════════════════════════════
CUÁNDO SÍ RECOMENDAR EXPANSIÓN DE CAPÍTULO (necessityScore >= 0.7):
═══════════════════════════════════════════════════════════════════
- Capítulo CRÍTICO para la trama con menos de 1200 palabras (escena climática comprimida)
- Salto emocional que confunde al lector (el personaje pasa de triste a feliz sin transición)
- Escena de acción que termina de forma tan abrupta que parece cortada

CUÁNDO NO RECOMENDAR EXPANSIÓN (necessityScore < 0.5):
- El capítulo tiene menos palabras pero FUNCIONA narrativamente
- Es un capítulo de transición que cumple su propósito
- El ritmo rápido es INTENCIONAL para el género (thriller, acción)

═══════════════════════════════════════════════════════════════════
CUÁNDO SÍ INSERTAR NUEVO CAPÍTULO (necessityScore >= 0.8):
═══════════════════════════════════════════════════════════════════
- Salto temporal de MESES/AÑOS sin ninguna explicación que deja al lector perdido
- Personaje que aparece muerto/herido/transformado sin mostrar cómo ocurrió
- Hueco argumental CRÍTICO que rompe la lógica de la historia
- Subplot importante que desaparece sin resolución

CUÁNDO NUNCA INSERTAR NUEVO CAPÍTULO (necessityScore = 0):
- Saltos temporales menores (horas, días) que son normales en narrativa
- Querer "desarrollar más" una relación que ya funciona
- Añadir "más contexto" cuando el contexto existente es suficiente
- El manuscrito ya tiene buen ritmo y fluye naturalmente

ESCALA DE necessityScore:
- 0.0-0.3: Completamente innecesario, no sugerir
- 0.4-0.6: Opcional, podría ayudar pero no es crítico - NO INCLUIR
- 0.7-0.8: Recomendado, mejora significativamente la narrativa
- 0.9-1.0: CRÍTICO, hay un hueco que confunde al lector

REGLA DE ORO: Si tienes dudas, NO lo sugieras. Es mejor un manuscrito ligeramente corto que uno inflado con relleno.`;

const EXPANSION_SYSTEM_PROMPT = `Eres un MAESTRO DE PROSA LITERARIA. Tu misión es EXPANDIR capítulos manteniendo la voz del autor original.

TÉCNICAS DE EXPANSIÓN PERMITIDAS:
1. ESCENAS NUEVAS: Añadir escenas que profundicen en el personaje o la trama
2. DIÁLOGOS: Expandir conversaciones existentes o añadir nuevas que revelen carácter
3. DESCRIPCIONES SENSORIALES: Añadir atmósfera con los 5 sentidos
4. INTROSPECCIÓN: Profundizar en el monólogo interno del protagonista
5. DETALLES DEL MUNDO: Añadir elementos del worldbuilding orgánicamente

REGLAS CRÍTICAS:
- NUNCA cambies el significado o la dirección de la trama
- PRESERVA el tono y la voz del autor original
- Las expansiones deben sentirse ORGÁNICAS, no añadidos forzados
- El ritmo narrativo debe mantenerse coherente
- NO añadas cliffhangers que no existían
- NO resuelvas conflictos que deben permanecer abiertos

CALIDAD DE PROSA:
- Variación en longitud de oraciones
- Inmersión sensorial
- Mostrar en lugar de contar
- Evitar clichés de IA (crucial, enigmático, repentinamente, etc.)`;

const NEW_CHAPTER_SYSTEM_PROMPT = `Eres un MAESTRO ESCRITOR DE FICCIÓN. Tu misión es crear NUEVOS CAPÍTULOS que se integren perfectamente en la narrativa existente.

EL CAPÍTULO NUEVO DEBE:
1. CONTINUAR orgánicamente desde el capítulo anterior
2. PREPARAR el terreno para el capítulo siguiente
3. DESARROLLAR elementos de trama o personaje según el propósito indicado
4. MANTENER el tono, estilo y voz del resto de la novela
5. INCLUIR un mini-arco propio (tensión → desarrollo → resolución parcial)

ESTRUCTURA RECOMENDADA:
- Gancho inicial que enganche al lector
- Desarrollo del propósito principal del capítulo
- Subtramas o desarrollo de personajes secundarios
- Cliffhanger o momento de reflexión al final

CALIDAD LITERARIA:
- Prosa rica con variación de ritmo
- Diálogos naturales que revelen personalidad
- Descripciones sensoriales inmersivas
- Mostrar emociones a través de acciones físicas
- Evitar exposición directa (show don't tell)`;

export class ChapterExpansionAnalyzer extends BaseAgent {
  constructor() {
    super({
      name: "Expansion Analyzer",
      role: "expansion_analyzer",
      systemPrompt: ANALYSIS_SYSTEM_PROMPT,
      model: "gemini-2.5-flash",
      useThinking: true,
    });
  }

  async execute(input: ExpansionAnalysisInput): Promise<AgentResponse & { result?: ExpansionPlan }> {
    const chaptersList = input.chapters.map(c => 
      `Cap ${c.chapterNumber}: "${c.title}" (${c.wordCount} palabras)\n  Resumen: ${c.summary}`
    ).join("\n\n");

    const prompt = `
ANÁLISIS DE EXPANSIÓN DE MANUSCRITO

GÉNERO: ${input.genre}
OBJETIVO MÍNIMO POR CAPÍTULO: ${input.targetMinWordsPerChapter} palabras
OPCIONES HABILITADAS:
- Expansión de capítulos existentes: ${input.enableChapterExpansion ? "SÍ" : "NO"}
- Inserción de nuevos capítulos: ${input.enableNewChapters ? "SÍ" : "NO"}

═══════════════════════════════════════════════════════════════════
CAPÍTULOS DEL MANUSCRITO:
═══════════════════════════════════════════════════════════════════

${chaptersList}

═══════════════════════════════════════════════════════════════════
INSTRUCCIONES:
═══════════════════════════════════════════════════════════════════

1. Analiza qué capítulos necesitan expansión (por debajo del objetivo o con desarrollo insuficiente)
2. Identifica puntos donde insertar nuevos capítulos mejoraría la narrativa
3. Prioriza calidad sobre cantidad - solo sugiere expansiones que realmente aporten valor

RESPONDE CON JSON:
{
  "chaptersToExpand": [
    {
      "chapterNumber": 5,
      "currentWords": 1200,
      "targetWords": 2500,
      "expansionType": "scenes|dialogue|description|introspection",
      "suggestedContent": "Descripción de qué tipo de contenido añadir",
      "necessityScore": 0.8
    }
  ],
  "newChaptersToInsert": [
    {
      "insertAfterChapter": 7,
      "title": "Título sugerido",
      "purpose": "Propósito narrativo del capítulo",
      "plotPoints": ["Punto 1", "Punto 2", "Punto 3"],
      "estimatedWords": 2500,
      "necessityScore": 0.9,
      "justification": "Hay un salto de 3 meses sin explicación que deja al lector confundido sobre cómo X pasó a Y"
    }
  ],
  "totalEstimatedNewWords": 15000,
  "reasoning": "Explicación del análisis",
  "overallNecessityAssessment": "none|minor|moderate|critical"
}

IMPORTANTE: 
- Si el manuscrito NO necesita expansión ni capítulos nuevos, devuelve arrays VACÍOS con overallNecessityAssessment: "none"
- Solo incluye items con necessityScore >= 0.7 para expansiones y >= 0.8 para nuevos capítulos
- Es PERFECTAMENTE VÁLIDO devolver todo vacío si el manuscrito ya está completo`;

    console.log(`[ExpansionAnalyzer] Analyzing ${input.chapters.length} chapters for expansion opportunities`);
    
    const response = await this.generateContent(prompt);

    if (response.error) {
      return { ...response, result: undefined };
    }

    try {
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]) as ExpansionPlan;
        console.log(`[ExpansionAnalyzer] Found ${result.chaptersToExpand?.length || 0} chapters to expand, ${result.newChaptersToInsert?.length || 0} new chapters to insert`);
        return { ...response, result };
      }
    } catch (e) {
      console.error("[ExpansionAnalyzer] Failed to parse response:", e);
    }

    return { ...response, result: undefined };
  }
}

export class ChapterExpanderAgent extends BaseAgent {
  constructor() {
    super({
      name: "Chapter Expander",
      role: "chapter_expander",
      systemPrompt: EXPANSION_SYSTEM_PROMPT,
      model: "gemini-3-pro-preview",
      useThinking: true,
    });
  }

  async execute(input: ChapterExpansionInput): Promise<AgentResponse & { result?: ExpandedChapterResult }> {
    const worldBibleContext = input.worldBible ? this.buildWorldBibleContext(input.worldBible) : "";
    const adjacentContext = input.adjacentContext ? 
      `CONTEXTO ADYACENTE:\n- Capítulo anterior: ${input.adjacentContext.previousSummary || "N/A"}\n- Capítulo siguiente: ${input.adjacentContext.nextSummary || "N/A"}` : "";

    const prompt = `
EXPANSIÓN DE CAPÍTULO ${input.chapterNumber}: "${input.chapterTitle}"

OBJETIVO: Expandir de ${input.chapterContent.split(/\s+/).length} palabras a aproximadamente ${input.expansionPlan.targetWords} palabras.

TIPO DE EXPANSIÓN SOLICITADO: ${input.expansionPlan.expansionType}
CONTENIDO SUGERIDO: ${input.expansionPlan.suggestedContent}

${worldBibleContext}

${adjacentContext}

═══════════════════════════════════════════════════════════════════
CAPÍTULO ORIGINAL A EXPANDIR:
═══════════════════════════════════════════════════════════════════

${input.chapterContent}

═══════════════════════════════════════════════════════════════════
INSTRUCCIONES:
═══════════════════════════════════════════════════════════════════

1. EXPANDE el capítulo según el tipo y sugerencia indicados
2. INTEGRA las expansiones de forma ORGÁNICA en la narrativa existente
3. MANTÉN la voz, tono y estilo del autor original
4. NO cambies el significado ni la dirección de la trama

RESPONDE CON JSON:
{
  "expandedContent": "El capítulo completo expandido en Markdown (# para título)",
  "originalWordCount": 1200,
  "newWordCount": 2500,
  "addedScenes": ["Descripción breve de escena añadida 1", "Escena 2"],
  "addedDialogues": 5,
  "addedDescriptions": ["Tipo de descripción añadida 1", "Tipo 2"]
}`;

    console.log(`[ChapterExpander] Expanding chapter ${input.chapterNumber} from ~${input.chapterContent.split(/\s+/).length} to ${input.expansionPlan.targetWords} words`);
    
    const response = await this.generateContent(prompt);

    if (response.error) {
      return { ...response, result: undefined };
    }

    try {
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]) as ExpandedChapterResult;
        console.log(`[ChapterExpander] Chapter ${input.chapterNumber} expanded: ${result.originalWordCount} -> ${result.newWordCount} words`);
        return { ...response, result };
      }
    } catch (e) {
      console.error("[ChapterExpander] Failed to parse response:", e);
    }

    return { ...response, result: undefined };
  }

  private buildWorldBibleContext(worldBible: any): string {
    if (!worldBible) return "";
    
    const sections: string[] = ["BIBLIA DEL MUNDO:"];
    
    if (worldBible.characters?.length > 0) {
      const mainChars = worldBible.characters.slice(0, 5);
      sections.push("Personajes principales: " + mainChars.map((c: any) => 
        `${c.nombre || c.name} (${c.rol || c.role || 'personaje'})`
      ).join(", "));
    }
    
    if (worldBible.locations?.length > 0) {
      sections.push("Ubicaciones: " + worldBible.locations.slice(0, 5).map((l: any) => 
        l.nombre || l.name || l
      ).join(", "));
    }
    
    return sections.join("\n");
  }
}

export class NewChapterGeneratorAgent extends BaseAgent {
  constructor() {
    super({
      name: "New Chapter Generator",
      role: "new_chapter_generator",
      systemPrompt: NEW_CHAPTER_SYSTEM_PROMPT,
      model: "gemini-3-pro-preview",
      useThinking: true,
    });
  }

  async execute(input: NewChapterInput): Promise<AgentResponse & { result?: NewChapterResult }> {
    const worldBibleContext = input.worldBible ? this.buildWorldBibleContext(input.worldBible) : "";

    const prompt = `
GENERACIÓN DE NUEVO CAPÍTULO

INSERTAR DESPUÉS DEL CAPÍTULO: ${input.insertAfterChapter}
TÍTULO SUGERIDO: "${input.title}"
GÉNERO: ${input.genre}
PALABRAS OBJETIVO: ${input.estimatedWords}

PROPÓSITO NARRATIVO: ${input.purpose}

PUNTOS DE TRAMA A DESARROLLAR:
${input.plotPoints.map((p, i) => `${i + 1}. ${p}`).join("\n")}

${worldBibleContext}

CONTEXTO NARRATIVO:
- RESUMEN DEL CAPÍTULO ANTERIOR (${input.insertAfterChapter}): ${input.previousChapterSummary}
- RESUMEN DEL CAPÍTULO SIGUIENTE (${input.insertAfterChapter + 1}): ${input.nextChapterSummary}

═══════════════════════════════════════════════════════════════════
INSTRUCCIONES:
═══════════════════════════════════════════════════════════════════

1. ESCRIBE un capítulo completo que cumpla el propósito indicado
2. CONECTA orgánicamente con el capítulo anterior y prepare el siguiente
3. DESARROLLA todos los puntos de trama indicados
4. MANTÉN el tono y estilo del género ${input.genre}
5. INCLUYE un mini-arco narrativo propio

RESPONDE CON JSON:
{
  "content": "El capítulo completo en Markdown (# para título)",
  "title": "Título final del capítulo",
  "wordCount": 2500,
  "chapterNumber": ${input.insertAfterChapter + 0.5}
}`;

    console.log(`[NewChapterGenerator] Creating new chapter after chapter ${input.insertAfterChapter}: "${input.title}"`);
    
    const response = await this.generateContent(prompt);

    if (response.error) {
      return { ...response, result: undefined };
    }

    try {
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]) as NewChapterResult;
        console.log(`[NewChapterGenerator] New chapter created: "${result.title}" (${result.wordCount} words)`);
        return { ...response, result };
      }
    } catch (e) {
      console.error("[NewChapterGenerator] Failed to parse response:", e);
    }

    return { ...response, result: undefined };
  }

  private buildWorldBibleContext(worldBible: any): string {
    if (!worldBible) return "";
    
    const sections: string[] = ["BIBLIA DEL MUNDO:"];
    
    if (worldBible.characters?.length > 0) {
      sections.push("PERSONAJES:");
      worldBible.characters.slice(0, 10).forEach((c: any) => {
        sections.push(`  - ${c.nombre || c.name}: ${c.descripcion || c.description || c.rol || 'personaje'}`);
      });
    }
    
    if (worldBible.locations?.length > 0) {
      sections.push("UBICACIONES:");
      worldBible.locations.slice(0, 5).forEach((l: any) => {
        sections.push(`  - ${l.nombre || l.name}: ${l.descripcion || l.description || ''}`);
      });
    }
    
    if (worldBible.rules?.length > 0) {
      sections.push("REGLAS DEL MUNDO:");
      worldBible.rules.slice(0, 5).forEach((r: any) => {
        sections.push(`  - ${r.nombre || r.name || r}: ${r.descripcion || r.description || ''}`);
      });
    }
    
    return sections.join("\n");
  }
}
