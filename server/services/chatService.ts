import { GoogleGenAI } from "@google/genai";
import { storage } from "../storage";
import type { ChatSession, ChatMessage, Project, ReeditProject, ReeditChapter, Chapter, WorldBible, ReeditWorldBible } from "@shared/schema";

const ai = new GoogleGenAI({
  apiKey: process.env.AI_INTEGRATIONS_GEMINI_API_KEY,
  httpOptions: {
    apiVersion: "",
    baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL,
  },
});

const ARCHITECT_SYSTEM_PROMPT = `
Eres el Arquitecto de Tramas, un asistente experto en narrativa literaria que ayuda a los autores durante el proceso de creación de novelas.

CAPACIDADES:
- TIENES ACCESO DIRECTO AL MANUSCRITO: Los primeros capítulos ya están cargados en tu contexto. Puedes leerlos y analizarlos directamente.
- Si necesitas ver capítulos adicionales, menciona el número específico y serán cargados automáticamente.
- NO pidas al usuario que copie contenido - ya tienes acceso directo al manuscrito.

Tu rol es responder preguntas y dar consejo sobre:
- Estructura narrativa y arcos argumentales
- Desarrollo de personajes y sus motivaciones
- Ritmo y tensión dramática
- Giros argumentales y sorpresas
- Continuidad y coherencia interna
- Worldbuilding y reglas del universo
- Diálogos y caracterización
- Técnicas para mantener al lector enganchado

IMPORTANTE:
- Responde siempre en español
- Sé conciso pero profundo en tus análisis
- Ofrece sugerencias específicas y accionables
- Cuando sea relevante, haz referencia a los datos del proyecto actual
- Mantén un tono profesional pero cercano

CUANDO EL AUTOR PIDA UN CAMBIO CONCRETO (como "cambia X por Y", "añade...", "elimina...", "modifica..."):
Después de tu explicación, incluye las propuestas de cambio en este formato exacto:

---PROPUESTA---
tipo: [chapter|character|worldbible]
objetivo: [nombre o número del elemento a modificar]
descripcion: [descripción breve del cambio]
contenido_propuesto: [el nuevo contenido o cambio específico]
---FIN_PROPUESTA---

Puedes incluir múltiples propuestas si el cambio afecta a varios elementos.
Solo usa este formato cuando el autor pida explícitamente un cambio que se pueda aplicar al manuscrito.
`;

const REEDITOR_SYSTEM_PROMPT = `
Eres el Re-editor, un asistente experto en corrección y mejora de manuscritos que ayuda a los autores a pulir sus textos.

CAPACIDADES:
- TIENES ACCESO DIRECTO AL MANUSCRITO: Los primeros capítulos ya están cargados en tu contexto. Puedes leerlos y analizarlos directamente.
- Si necesitas ver capítulos adicionales que no están en el contexto, menciona el número específico y serán cargados automáticamente.
- Puedes proponer reescrituras y correcciones que el autor puede aprobar o rechazar.
- Si hay una Guía Extendida, debes usarla para asegurar que los capítulos cumplan con los requisitos de extensión.
- NO pidas al usuario que copie contenido - ya tienes acceso directo al manuscrito.

Tu rol es responder preguntas y dar consejo sobre:
- Correcciones de estilo y fluidez
- Errores de continuidad detectados por el autor
- Problemas de ritmo o pacing
- Diálogos que no suenan naturales
- Descripciones que necesitan ajuste
- Inconsistencias en los personajes
- Errores históricos o de ambientación
- Repeticiones léxicas o estructurales
- Expansión de capítulos cortos para cumplir objetivos de palabras

INSTRUCCIÓN CRÍTICA - GUÍA DE ESTILO:
═══════════════════════════════════════════════════════════════════
Si hay una "GUÍA DE ESTILO DEL AUTOR" en el contexto, DEBES aplicarla estrictamente.
Esta guía contiene las preferencias del autor sobre:
- Vocabulario específico a usar o evitar
- Términos prohibidos para el período histórico
- Estilo de diálogo y narración
- Registro lingüístico (formal/coloquial)
- Expresiones características de la época

ANTES de proponer cualquier texto, verifica que:
1. No uses términos modernos prohibidos en la guía
2. Respetas el vocabulario autorizado de época
3. Mantienes el tono y registro indicado
4. Sigues las instrucciones específicas del autor
═══════════════════════════════════════════════════════════════════

IMPORTANTE:
- Responde siempre en español
- Cuando el autor señale un problema, proporciona soluciones concretas
- Analiza el contexto antes de proponer cambios
- Ten en cuenta la voz y estilo del autor (lee la GUÍA DE ESTILO)
- Sé específico: indica números de capítulo, nombres de personajes, etc.
- Si hay un objetivo mínimo de palabras por capítulo, verifica que se cumpla y sugiere expansiones si es necesario

CUANDO EL AUTOR PIDA UNA CORRECCIÓN O REESCRITURA (como "corrige X", "cambia Y", "mejora Z", "reescribe...", "expande..."):
Después de tu explicación, incluye las propuestas de cambio en este formato exacto:

---PROPUESTA---
tipo: [chapter|dialogue|description|style|expansion]
capitulo: [número del capítulo afectado]
descripcion: [descripción breve del cambio]
texto_original: [el texto EXACTO que se va a reemplazar - copia literalmente del manuscrito incluyendo puntuación y espacios]
texto_propuesto: [el nuevo texto propuesto - DEBE seguir la GUÍA DE ESTILO]
---FIN_PROPUESTA---

CRÍTICO PARA texto_original:
- Copia el texto EXACTAMENTE como aparece en el manuscrito
- Incluye suficiente contexto (al menos 50 caracteres) para encontrarlo
- Preserva puntuación, espacios y saltos de línea originales

Puedes incluir múltiples propuestas si la corrección afecta a varias partes.
Solo usa este formato cuando el autor pida explícitamente una corrección que se pueda aplicar al manuscrito.
`;

interface ChatContext {
  project?: Project | ReeditProject;
  chapters?: Chapter[] | ReeditChapter[];
  worldBible?: WorldBible | ReeditWorldBible | null;
  styleGuide?: string;
  extendedGuide?: string;
  recentMessages: ChatMessage[];
}

export class ChatService {
  private async buildContext(session: ChatSession): Promise<ChatContext> {
    const recentMessages = await storage.getChatMessagesBySession(session.id);
    const context: ChatContext = { recentMessages };

    if (session.agentType === "architect" && session.projectId) {
      const project = await storage.getProject(session.projectId);
      if (project) {
        context.project = project;
        const chapters = await storage.getChaptersByProject(project.id);
        context.chapters = chapters;
        const worldBible = await storage.getWorldBibleByProject(project.id);
        context.worldBible = worldBible;
        if (project.styleGuideId) {
          const guide = await storage.getStyleGuide(project.styleGuideId);
          context.styleGuide = guide?.content;
        }
        if (project.extendedGuideId) {
          const extGuide = await storage.getExtendedGuide(project.extendedGuideId);
          context.extendedGuide = extGuide?.content;
        }
      }
    } else if (session.agentType === "reeditor" && session.reeditProjectId) {
      const reeditProject = await storage.getReeditProject(session.reeditProjectId);
      if (reeditProject) {
        context.project = reeditProject;
        const chapters = await storage.getReeditChaptersByProject(reeditProject.id);
        context.chapters = chapters;
        const worldBible = await storage.getReeditWorldBibleByProject(reeditProject.id);
        context.worldBible = worldBible;
        if ('styleGuideId' in reeditProject && reeditProject.styleGuideId) {
          const guide = await storage.getStyleGuide(reeditProject.styleGuideId as number);
          context.styleGuide = guide?.content;
        }
        if ('extendedGuideId' in reeditProject && reeditProject.extendedGuideId) {
          const extGuide = await storage.getExtendedGuide(reeditProject.extendedGuideId as number);
          context.extendedGuide = extGuide?.content;
        }
      }
    }

    return context;
  }

  private buildContextPrompt(context: ChatContext, session: ChatSession): string {
    const parts: string[] = [];

    if (context.project) {
      const p = context.project;
      const storedChapters = context.chapters?.length || 0;
      const plannedChapters = 'chapterCount' in p ? (p.chapterCount || storedChapters) : storedChapters;
      const chapterCountForCalc = plannedChapters > 0 ? plannedChapters : 1;
      const minWordCount = 'minWordCount' in p ? p.minWordCount : null;
      const minWordsPerChapter = minWordCount 
        ? Math.round(minWordCount / chapterCountForCalc) 
        : null;
      
      parts.push(`
PROYECTO ACTUAL: "${p.title}"
- ID: ${p.id}
- Total capítulos planificados: ${plannedChapters}
- Capítulos generados: ${storedChapters}
- Estado: ${'status' in p ? p.status : 'N/A'}${minWordCount ? `
- Objetivo mínimo de palabras: ${minWordCount.toLocaleString()} palabras
- Mínimo por capítulo (estimado): ${minWordsPerChapter?.toLocaleString()} palabras` : ''}
`);
    }

    if (context.worldBible && 'characters' in context.worldBible && context.worldBible.characters) {
      const chars = context.worldBible.characters as any[];
      if (chars.length > 0) {
        parts.push(`
PERSONAJES PRINCIPALES:
${chars.slice(0, 5).map((c: any) => `- ${c.name}: ${c.role || c.description || 'Sin descripción'}`).join('\n')}
`);
      }
    }

    if (session.chapterNumber && context.chapters) {
      const targetChapter = context.chapters.find((ch: any) => ch.chapterNumber === session.chapterNumber);
      if (targetChapter) {
        const content = 'editedContent' in targetChapter 
          ? (targetChapter.editedContent || targetChapter.originalContent)
          : ('content' in targetChapter ? targetChapter.content : '');
        parts.push(`
CAPÍTULO EN CONTEXTO (${session.chapterNumber}): "${targetChapter.title || 'Sin título'}"
Contenido (primeras 2000 palabras):
${content?.substring(0, 10000) || 'Sin contenido disponible'}
`);
      }
    } else if (context.chapters && context.chapters.length > 0) {
      const sortedChapters = [...context.chapters].sort((a: any, b: any) => a.chapterNumber - b.chapterNumber);
      
      const chapterSummaries = sortedChapters.map((ch: any) => {
        const content = 'editedContent' in ch 
          ? (ch.editedContent || ch.originalContent)
          : ('content' in ch ? ch.content : '');
        const wordCount = content ? content.split(/\s+/).length : 0;
        return `- Capítulo ${ch.chapterNumber}: "${ch.title || 'Sin título'}" (${wordCount.toLocaleString()} palabras)`;
      }).join('\n');
      
      parts.push(`
MANUSCRITO COMPLETO - ÍNDICE DE CAPÍTULOS:
${chapterSummaries}
`);

      const MAX_CHAPTERS_IN_CONTEXT = 5;
      const MAX_CHARS_PER_CHAPTER = 15000;
      const chaptersToInclude = sortedChapters.slice(0, MAX_CHAPTERS_IN_CONTEXT);
      
      for (const ch of chaptersToInclude as any[]) {
        const content = 'editedContent' in ch 
          ? (ch.editedContent || ch.originalContent)
          : ('content' in ch ? ch.content : '');
        if (content) {
          const truncatedContent = content.length > MAX_CHARS_PER_CHAPTER 
            ? content.substring(0, MAX_CHARS_PER_CHAPTER) + '\n[... contenido truncado ...]'
            : content;
          parts.push(`
--- CAPÍTULO ${ch.chapterNumber}: "${ch.title || 'Sin título'}" ---
${truncatedContent}
`);
        }
      }
      
      if (sortedChapters.length > MAX_CHAPTERS_IN_CONTEXT) {
        parts.push(`
[Nota: Se muestran los primeros ${MAX_CHAPTERS_IN_CONTEXT} capítulos. Hay ${sortedChapters.length - MAX_CHAPTERS_IN_CONTEXT} capítulos adicionales disponibles. Pide capítulos específicos por número si necesitas verlos.]
`);
      }
    }

    if (context.styleGuide) {
      parts.push(`
═══════════════════════════════════════════════════════════════════
GUÍA DE ESTILO DEL AUTOR (OBLIGATORIA):
═══════════════════════════════════════════════════════════════════
${context.styleGuide.substring(0, 8000)}
═══════════════════════════════════════════════════════════════════
⚠️ TODO el texto que propongas DEBE seguir estrictamente esta guía.
═══════════════════════════════════════════════════════════════════
`);
    }

    if (context.extendedGuide) {
      parts.push(`
═══════════════════════════════════════════════════════════════════
GUÍA EXTENDIDA (EXTENSIÓN DE PALABRAS):
═══════════════════════════════════════════════════════════════════
${context.extendedGuide.substring(0, 8000)}
═══════════════════════════════════════════════════════════════════
`);
    }

    return parts.join('\n');
  }

  private extractRequestedChapters(message: string): number[] {
    const chapterNumbers: number[] = [];
    
    const patterns = [
      /cap[ií]tulo\s*(\d+)/gi,
      /cap\.?\s*(\d+)/gi,
      /chapter\s*(\d+)/gi,
      /\bcap\s+(\d+)/gi,
      /el\s+(\d+)/gi,
      /prólogo/gi,
      /epilogo|epílogo/gi,
    ];
    
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(message)) !== null) {
        if (match[1]) {
          chapterNumbers.push(parseInt(match[1], 10));
        } else if (match[0].toLowerCase().includes('prólogo')) {
          chapterNumbers.push(0);
        } else if (match[0].toLowerCase().includes('pílogo')) {
          chapterNumbers.push(-1);
        }
      }
    }
    
    return Array.from(new Set(chapterNumbers));
  }

  async sendMessage(
    sessionId: number,
    userMessage: string,
    onProgress?: (chunk: string) => void
  ): Promise<{ message: ChatMessage; inputTokens: number; outputTokens: number }> {
    const session = await storage.getChatSession(sessionId);
    if (!session) {
      throw new Error("Sesión de chat no encontrada");
    }

    const userMsg = await storage.createChatMessage({
      sessionId,
      role: "user",
      content: userMessage,
      chapterReference: session.chapterNumber,
    });

    const context = await this.buildContext(session);
    
    const requestedChapters = this.extractRequestedChapters(userMessage);
    let additionalChaptersContext = "";
    
    if (requestedChapters.length > 0 && context.chapters) {
      const sortedChapters = [...context.chapters].sort((a: any, b: any) => a.chapterNumber - b.chapterNumber);
      const alreadyIncludedNums = sortedChapters.slice(0, 5).map((c: any) => c.chapterNumber);
      
      for (const chNum of requestedChapters) {
        if (!alreadyIncludedNums.includes(chNum)) {
          const chapter = sortedChapters.find((c: any) => c.chapterNumber === chNum);
          if (chapter) {
            const ch = chapter as any;
            const content = 'editedContent' in ch 
              ? (ch.editedContent || ch.originalContent)
              : ('content' in ch ? ch.content : '');
            if (content) {
              const truncatedContent = content.length > 15000 
                ? content.substring(0, 15000) + '\n[... contenido truncado ...]'
                : content;
              additionalChaptersContext += `
--- CAPÍTULO ${ch.chapterNumber} (SOLICITADO): "${ch.title || 'Sin título'}" ---
${truncatedContent}
`;
            }
          }
        }
      }
    }
    
    const contextPrompt = this.buildContextPrompt(context, session) + additionalChaptersContext;
    
    const systemPrompt = session.agentType === "architect" 
      ? ARCHITECT_SYSTEM_PROMPT 
      : REEDITOR_SYSTEM_PROMPT;

    const conversationHistory = context.recentMessages.slice(-10).map(msg => ({
      role: msg.role as "user" | "model",
      parts: [{ text: msg.content }]
    }));

    conversationHistory.push({
      role: "user",
      parts: [{ text: userMessage }]
    });

    let fullResponse = "";
    let inputTokens = 0;
    let outputTokens = 0;

    try {
      const response = await ai.models.generateContentStream({
        model: "gemini-2.5-flash",
        contents: conversationHistory,
        config: {
          systemInstruction: `${systemPrompt}\n\n${contextPrompt}`,
          temperature: 0.7,
        }
      });

      for await (const chunk of response) {
        const text = chunk.text || "";
        fullResponse += text;
        if (onProgress) {
          onProgress(text);
        }
        if (chunk.usageMetadata) {
          inputTokens = chunk.usageMetadata.promptTokenCount || 0;
          outputTokens = chunk.usageMetadata.candidatesTokenCount || 0;
        }
      }

    } catch (error: any) {
      console.error("Error generating chat response:", error);
      fullResponse = `Error al procesar tu mensaje: ${error.message || 'Error desconocido'}`;
    }

    const assistantMsg = await storage.createChatMessage({
      sessionId,
      role: "assistant",
      content: fullResponse,
      chapterReference: session.chapterNumber,
    });

    await storage.updateChatMessage(assistantMsg.id, { inputTokens, outputTokens });

    await storage.updateChatSession(sessionId, {
      totalInputTokens: (session.totalInputTokens || 0) + inputTokens,
      totalOutputTokens: (session.totalOutputTokens || 0) + outputTokens,
    });

    return { message: assistantMsg, inputTokens, outputTokens };
  }

  async createSession(params: {
    projectId?: number;
    reeditProjectId?: number;
    agentType: "architect" | "reeditor";
    chapterNumber?: number;
    title?: string;
  }): Promise<ChatSession> {
    let projectTitle = "Nuevo chat";
    
    if (params.agentType === "architect" && params.projectId) {
      const project = await storage.getProject(params.projectId);
      projectTitle = project?.title || "Proyecto";
    } else if (params.agentType === "reeditor" && params.reeditProjectId) {
      const project = await storage.getReeditProject(params.reeditProjectId);
      projectTitle = project?.title || "Proyecto reedit";
    }

    const title = params.title || `Chat con ${params.agentType === "architect" ? "Arquitecto" : "Re-editor"} - ${projectTitle}`;

    return storage.createChatSession({
      projectId: params.projectId || null,
      reeditProjectId: params.reeditProjectId || null,
      agentType: params.agentType,
      title,
      chapterNumber: params.chapterNumber || null,
      status: "active",
    });
  }
}

export const chatService = new ChatService();
