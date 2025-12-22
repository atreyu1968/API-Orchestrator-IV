import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({
  apiKey: process.env.AI_INTEGRATIONS_GEMINI_API_KEY,
  httpOptions: {
    apiVersion: "",
    baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL,
  },
});

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
}

export interface AgentResponse {
  content: string;
  thoughtSignature?: string;
  tokenUsage?: TokenUsage;
  timedOut?: boolean;
  error?: string;
}

export interface AgentConfig {
  name: string;
  role: string;
  systemPrompt: string;
}

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 5000;

const activeAbortControllers = new Map<number, AbortController>();

export function registerProjectAbortController(projectId: number): AbortController {
  const controller = new AbortController();
  activeAbortControllers.set(projectId, controller);
  return controller;
}

export function cancelProject(projectId: number): boolean {
  const controller = activeAbortControllers.get(projectId);
  if (controller) {
    controller.abort();
    activeAbortControllers.delete(projectId);
    return true;
  }
  return false;
}

export function isProjectCancelled(projectId: number): boolean {
  const controller = activeAbortControllers.get(projectId);
  return controller?.signal.aborted ?? false;
}

export function clearProjectAbortController(projectId: number): void {
  activeAbortControllers.delete(projectId);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operationName: string
): Promise<T> {
  let timeoutId: NodeJS.Timeout;
  
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`TIMEOUT: ${operationName} exceeded ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timeoutId!);
    return result;
  } catch (error) {
    clearTimeout(timeoutId!);
    throw error;
  }
}

export abstract class BaseAgent {
  protected config: AgentConfig;
  protected ai = ai;
  protected timeoutMs = DEFAULT_TIMEOUT_MS;

  constructor(config: AgentConfig) {
    this.config = config;
  }

  get name(): string {
    return this.config.name;
  }

  get role(): string {
    return this.config.role;
  }

  protected async generateContent(prompt: string, projectId?: number): Promise<AgentResponse> {
    let lastError: Error | null = null;
    
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (projectId && isProjectCancelled(projectId)) {
        return {
          content: "",
          error: "CANCELLED: Project generation was cancelled",
          timedOut: false,
        };
      }
      
      try {
        const generatePromise = this.ai.models.generateContent({
          model: "gemini-3-pro-preview",
          contents: [
            { role: "user", parts: [{ text: this.config.systemPrompt }] },
            { role: "model", parts: [{ text: "Entendido. Estoy listo para cumplir mi rol." }] },
            { role: "user", parts: [{ text: prompt }] },
          ],
          config: {
            temperature: 1.0,
            topP: 0.95,
            thinkingConfig: {
              thinkingBudget: 8192,
            },
          },
        });

        const response = await withTimeout(
          generatePromise,
          this.timeoutMs,
          `${this.config.name} AI generation`
        );

        const candidate = response.candidates?.[0];
        let content = "";
        let thoughtSignature = "";

        if (candidate?.content?.parts) {
          for (const part of candidate.content.parts) {
            if (part.thought) {
              thoughtSignature += part.text || "";
            } else if (part.text) {
              content += part.text;
            }
          }
        }

        const usageMetadata = response.usageMetadata;
        const tokenUsage: TokenUsage = {
          inputTokens: usageMetadata?.promptTokenCount || 0,
          outputTokens: usageMetadata?.candidatesTokenCount || 0,
          thinkingTokens: usageMetadata?.thoughtsTokenCount || 0,
        };

        return { content, thoughtSignature, tokenUsage };
      } catch (error) {
        lastError = error as Error;
        const errorMessage = lastError.message || String(error);
        
        console.error(`[${this.config.name}] Attempt ${attempt + 1}/${MAX_RETRIES + 1} failed:`, errorMessage);
        
        if (errorMessage.startsWith("TIMEOUT:")) {
          if (attempt < MAX_RETRIES) {
            console.log(`[${this.config.name}] Retrying after timeout...`);
            await sleep(RETRY_DELAY_MS);
            continue;
          }
          return {
            content: "",
            error: errorMessage,
            timedOut: true,
          };
        }
        
        if (attempt < MAX_RETRIES) {
          console.log(`[${this.config.name}] Retrying after error...`);
          await sleep(RETRY_DELAY_MS * (attempt + 1));
          continue;
        }
      }
    }
    
    return {
      content: "",
      error: lastError?.message || "Unknown error after all retries",
      timedOut: false,
    };
  }

  abstract execute(input: any): Promise<AgentResponse>;
}
