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

export type GeminiModel = "gemini-3-pro-preview" | "gemini-2.5-flash";

export interface AgentConfig {
  name: string;
  role: string;
  systemPrompt: string;
  model?: GeminiModel;
  useThinking?: boolean;
}

const DEFAULT_TIMEOUT_MS = 12 * 60 * 1000;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 5000;

const RATE_LIMIT_MAX_RETRIES = 5;
const RATE_LIMIT_DELAYS_MS = [30000, 60000, 90000, 120000, 180000];

function isRateLimitError(error: any): boolean {
  const errorStr = String(error?.message || error || "");
  return errorStr.includes("RATELIMIT_EXCEEDED") || 
         errorStr.includes("429") || 
         errorStr.includes("Rate limit") ||
         errorStr.includes("rate limit");
}

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

  protected async generateContent(prompt: string, projectId?: number, options?: { temperature?: number }): Promise<AgentResponse> {
    let lastError: Error | null = null;
    const temperature = options?.temperature ?? 1.0;
    let rateLimitAttempts = 0;
    
    const maxAttempts = MAX_RETRIES + RATE_LIMIT_MAX_RETRIES + 1;
    
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (projectId && isProjectCancelled(projectId)) {
        return {
          content: "",
          error: "CANCELLED: Project generation was cancelled",
          timedOut: false,
        };
      }
      
      try {
        const modelToUse = this.config.model || "gemini-3-pro-preview";
        const useThinking = this.config.useThinking !== false;
        
        const generatePromise = this.ai.models.generateContent({
          model: modelToUse,
          contents: [
            { role: "user", parts: [{ text: this.config.systemPrompt }] },
            { role: "model", parts: [{ text: "Entendido. Estoy listo para cumplir mi rol." }] },
            { role: "user", parts: [{ text: prompt }] },
          ],
          config: {
            temperature,
            topP: 0.95,
            ...(useThinking && modelToUse === "gemini-3-pro-preview" ? {
              thinkingConfig: {
                thinkingBudget: 4096,
                includeThoughts: true,
              },
            } : {}),
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
            if ((part as any).thought === true) {
              thoughtSignature += part.text || "";
            } else if (part.text) {
              content += part.text;
            }
          }
        }
        
        if (!thoughtSignature && candidate?.content?.parts) {
          console.log(`[${this.config.name}] No thought signature captured. Parts structure:`, 
            candidate.content.parts.map((p: any) => ({ 
              hasText: !!p.text, 
              textLength: p.text?.length || 0,
              thought: p.thought,
              keys: Object.keys(p)
            }))
          );
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
        
        if (isRateLimitError(error)) {
          rateLimitAttempts++;
          if (rateLimitAttempts <= RATE_LIMIT_MAX_RETRIES) {
            const delayMs = RATE_LIMIT_DELAYS_MS[Math.min(rateLimitAttempts - 1, RATE_LIMIT_DELAYS_MS.length - 1)];
            console.log(`[${this.config.name}] Rate limit hit (attempt ${rateLimitAttempts}/${RATE_LIMIT_MAX_RETRIES}). Waiting ${delayMs / 1000}s before retry...`);
            await sleep(delayMs);
            continue;
          }
          console.error(`[${this.config.name}] Rate limit exceeded after ${RATE_LIMIT_MAX_RETRIES} retries`);
          return {
            content: "",
            error: `RATE_LIMIT: ${errorMessage}`,
            timedOut: false,
          };
        }
        
        console.error(`[${this.config.name}] Attempt ${attempt + 1} failed:`, errorMessage);
        
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
