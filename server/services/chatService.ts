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
- Tienes acceso al manuscrito completo y puedes ver el resumen de todos los capítulos
- Puedes leer el contenido específico de cualquier capítulo cuando el autor lo solicite
- Puedes proponer reescrituras y correcciones que el autor puede aprobar o rechazar
- Si hay una Guía Extendida, debes usarla para asegurar que los capítulos cumplan con los requisitos de extensión

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

IMPORTANTE:
- Responde siempre en español
- Cuando el autor señale un problema, proporciona soluciones concretas
- Analiza el contexto antes de proponer cambios
- Ten en cuenta la voz y estilo del autor
- Sé específico: indica números de capítulo, nombres de personajes, etc.
- Si hay un objetivo mínimo de palabras por capítulo, verifica que se cumpla y sugiere expansiones si es necesario

CUANDO EL AUTOR PIDA UNA CORRECCIÓN O REESCRITURA (como "corrige X", "cambia Y", "mejora Z", "reescribe...", "expande..."):
Después de tu explicación, incluye las propuestas de cambio en este formato exacto:

---PROPUESTA---
tipo: [chapter|dialogue|description|style|expansion]
capitulo: [número del capítulo afectado]
descripcion: [descripción breve del cambio]
texto_original: [el texto que se va a reemplazar, si aplica - puede ser vacío para expansiones]
texto_propuesto: [el nuevo texto propuesto o el texto expandido completo]
---FIN_PROPUESTA---

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
    } else if (context.chapters && context.chapters.length > 0 && session.agentType === "reeditor") {
      const chapterSummaries = context.chapters.map((ch: any) => {
        const content = 'editedContent' in ch 
          ? (ch.editedContent || ch.originalContent)
          : ('content' in ch ? ch.content : '');
        const wordCount = content ? content.split(/\s+/).length : 0;
        return `- Capítulo ${ch.chapterNumber}: "${ch.title || 'Sin título'}" (${wordCount.toLocaleString()} palabras)`;
      }).join('\n');
      
      parts.push(`
MANUSCRITO COMPLETO - RESUMEN DE CAPÍTULOS:
${chapterSummaries}

Nota: Puedes pedir el contenido específico de cualquier capítulo mencionando su número.
`);
    }

    if (context.styleGuide) {
      parts.push(`
GUÍA DE ESTILO DEL AUTOR:
${context.styleGuide.substring(0, 3000)}
`);
    }

    if (context.extendedGuide) {
      parts.push(`
GUÍA EXTENDIDA (EXTENSIÓN DE PALABRAS):
${context.extendedGuide.substring(0, 5000)}
`);
    }

    return parts.join('\n');
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
    const contextPrompt = this.buildContextPrompt(context, session);
    
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
