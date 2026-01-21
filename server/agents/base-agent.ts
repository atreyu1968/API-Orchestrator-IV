import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import { calculateRealCost, formatCostForStorage } from "../cost-calculator";
import { storage } from "../storage";

// AI Provider configuration
export type AIProvider = "gemini" | "deepseek";

// Get current AI provider from environment
export function getAIProvider(): AIProvider {
  const provider = process.env.AI_PROVIDER?.toLowerCase();
  if (provider === "deepseek") return "deepseek";
  return "gemini"; // Default to Gemini
}

// Gemini client
const geminiClient = new GoogleGenAI({
  apiKey: process.env.AI_INTEGRATIONS_GEMINI_API_KEY,
  httpOptions: {
    apiVersion: "",
    baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL,
  },
});

// DeepSeek client (OpenAI-compatible API)
function getDeepSeekClient(): OpenAI | null {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return null;
  return new OpenAI({
    apiKey,
    baseURL: "https://api.deepseek.com",
  });
}

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

export type GeminiModel = "gemini-3-pro-preview" | "gemini-2.5-flash" | "gemini-2.0-flash";
export type DeepSeekModel = "deepseek-reasoner" | "deepseek-chat";

// Map Gemini models to DeepSeek equivalents
function mapGeminiToDeepSeek(geminiModel: GeminiModel): DeepSeekModel {
  switch (geminiModel) {
    case "gemini-3-pro-preview":
      return "deepseek-reasoner"; // R1 for deep reasoning/creative tasks
    case "gemini-2.5-flash":
    case "gemini-2.0-flash":
    default:
      return "deepseek-chat"; // V3 for fast analysis tasks
  }
}

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

export async function isProjectCancelledFromDb(projectId: number): Promise<boolean> {
  if (isProjectCancelled(projectId)) {
    return true;
  }
  
  try {
    const project = await storage.getProject(projectId);
    if (!project) return true;
    
    const cancelledStatuses = ["idle", "cancelled", "completed", "paused"];
    if (cancelledStatuses.includes(project.status)) {
      console.log(`[BaseAgent] Project ${projectId} cancelled via DB status: ${project.status}`);
      return true;
    }
  } catch (error) {
    console.error(`[BaseAgent] Error checking project status:`, error);
  }
  
  return false;
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
  protected ai = geminiClient;
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
    const provider = getAIProvider();
    
    if (provider === "deepseek") {
      return this.generateWithDeepSeek(prompt, projectId, options);
    }
    
    return this.generateWithGemini(prompt, projectId, options);
  }

  private async generateWithDeepSeek(prompt: string, projectId?: number, options?: { temperature?: number }): Promise<AgentResponse> {
    const deepseek = getDeepSeekClient();
    if (!deepseek) {
      return {
        content: "",
        error: "DeepSeek API key not configured. Please add DEEPSEEK_API_KEY.",
        timedOut: false,
      };
    }

    let lastError: Error | null = null;
    const temperature = options?.temperature ?? 1.0;
    let rateLimitAttempts = 0;
    
    const maxAttempts = MAX_RETRIES + RATE_LIMIT_MAX_RETRIES + 1;
    const geminiModel = this.config.model || "gemini-3-pro-preview";
    const deepseekModel = mapGeminiToDeepSeek(geminiModel);
    
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (projectId && isProjectCancelled(projectId)) {
        return {
          content: "",
          error: "CANCELLED: Project generation was cancelled",
          timedOut: false,
        };
      }
      
      try {
        const startTime = Date.now();
        console.log(`[${this.config.name}] Starting DeepSeek API call (${deepseekModel}, attempt ${attempt + 1})...`);
        
        const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
          { role: "system", content: this.config.systemPrompt },
          { role: "user", content: prompt },
        ];

        const generatePromise = deepseek.chat.completions.create({
          model: deepseekModel,
          messages,
          temperature: Math.min(temperature, 2.0), // DeepSeek max is 2.0
          max_tokens: 8192,
          stream: false,
        });

        const response = await withTimeout(
          generatePromise,
          this.timeoutMs,
          `${this.config.name} DeepSeek generation`
        );
        
        const elapsedMs = Date.now() - startTime;
        console.log(`[${this.config.name}] DeepSeek API call completed in ${Math.round(elapsedMs / 1000)}s`);

        const choice = response.choices?.[0];
        let content = choice?.message?.content || "";
        let thoughtSignature = "";

        // DeepSeek R1 returns reasoning in reasoning_content field
        if ((choice?.message as any)?.reasoning_content) {
          thoughtSignature = (choice.message as any).reasoning_content;
        }

        const usage = response.usage;
        const tokenUsage: TokenUsage = {
          inputTokens: usage?.prompt_tokens || 0,
          outputTokens: usage?.completion_tokens || 0,
          thinkingTokens: (usage as any)?.reasoning_tokens || 0,
        };

        // Track AI usage event with DeepSeek costs
        if (projectId && (tokenUsage.inputTokens > 0 || tokenUsage.outputTokens > 0)) {
          const costs = calculateDeepSeekCost(
            deepseekModel,
            tokenUsage.inputTokens,
            tokenUsage.outputTokens,
            tokenUsage.thinkingTokens
          );
          
          try {
            await storage.createAiUsageEvent({
              projectId,
              agentName: this.config.name,
              model: `deepseek:${deepseekModel}`,
              inputTokens: tokenUsage.inputTokens,
              outputTokens: tokenUsage.outputTokens,
              thinkingTokens: tokenUsage.thinkingTokens,
              inputCostUsd: formatCostForStorage(costs.inputCost),
              outputCostUsd: formatCostForStorage(costs.outputCost + costs.thinkingCost),
              totalCostUsd: formatCostForStorage(costs.totalCost),
              operation: "generate",
            });
          } catch (err) {
            console.error(`[${this.config.name}] Failed to log AI usage event:`, err);
          }
        }

        return { content, thoughtSignature, tokenUsage };
      } catch (error) {
        lastError = error as Error;
        const errorMessage = lastError.message || String(error);
        
        if (isRateLimitError(error)) {
          rateLimitAttempts++;
          if (rateLimitAttempts <= RATE_LIMIT_MAX_RETRIES) {
            const delayMs = RATE_LIMIT_DELAYS_MS[Math.min(rateLimitAttempts - 1, RATE_LIMIT_DELAYS_MS.length - 1)];
            console.log(`[${this.config.name}] DeepSeek rate limit hit (attempt ${rateLimitAttempts}/${RATE_LIMIT_MAX_RETRIES}). Waiting ${delayMs / 1000}s before retry...`);
            await sleep(delayMs);
            continue;
          }
          console.error(`[${this.config.name}] DeepSeek rate limit exceeded after ${RATE_LIMIT_MAX_RETRIES} retries`);
          return {
            content: "",
            error: `RATE_LIMIT: ${errorMessage}`,
            timedOut: false,
          };
        }
        
        console.error(`[${this.config.name}] DeepSeek attempt ${attempt + 1} failed:`, errorMessage);
        
        if (errorMessage.startsWith("TIMEOUT:")) {
          if (attempt < MAX_RETRIES) {
            console.log(`[${this.config.name}] Retrying DeepSeek after timeout...`);
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
          console.log(`[${this.config.name}] Retrying DeepSeek after error...`);
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

  private async generateWithGemini(prompt: string, projectId?: number, options?: { temperature?: number }): Promise<AgentResponse> {
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
        
        const startTime = Date.now();
        console.log(`[${this.config.name}] Starting Gemini API call (${modelToUse}, attempt ${attempt + 1})...`);
        
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
            maxOutputTokens: 65536,
            ...(useThinking && modelToUse === "gemini-3-pro-preview" ? {
              thinkingConfig: {
                thinkingBudget: 2048,
                includeThoughts: true,
              },
            } : {}),
          },
        });

        const response = await withTimeout(
          generatePromise,
          this.timeoutMs,
          `${this.config.name} Gemini generation`
        );
        
        const elapsedMs = Date.now() - startTime;
        console.log(`[${this.config.name}] Gemini API call completed in ${Math.round(elapsedMs / 1000)}s`);

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

        // Track AI usage event with real costs
        const modelToUseForCost = this.config.model || "gemini-3-pro-preview";
        if (projectId && (tokenUsage.inputTokens > 0 || tokenUsage.outputTokens > 0)) {
          const costs = calculateRealCost(
            modelToUseForCost,
            tokenUsage.inputTokens,
            tokenUsage.outputTokens,
            tokenUsage.thinkingTokens
          );
          
          try {
            await storage.createAiUsageEvent({
              projectId,
              agentName: this.config.name,
              model: modelToUseForCost,
              inputTokens: tokenUsage.inputTokens,
              outputTokens: tokenUsage.outputTokens,
              thinkingTokens: tokenUsage.thinkingTokens,
              inputCostUsd: formatCostForStorage(costs.inputCost),
              outputCostUsd: formatCostForStorage(costs.outputCost + costs.thinkingCost),
              totalCostUsd: formatCostForStorage(costs.totalCost),
              operation: "generate",
            });
          } catch (err) {
            console.error(`[${this.config.name}] Failed to log AI usage event:`, err);
          }
        }

        return { content, thoughtSignature, tokenUsage };
      } catch (error) {
        lastError = error as Error;
        const errorMessage = lastError.message || String(error);
        
        if (isRateLimitError(error)) {
          rateLimitAttempts++;
          if (rateLimitAttempts <= RATE_LIMIT_MAX_RETRIES) {
            const delayMs = RATE_LIMIT_DELAYS_MS[Math.min(rateLimitAttempts - 1, RATE_LIMIT_DELAYS_MS.length - 1)];
            console.log(`[${this.config.name}] Gemini rate limit hit (attempt ${rateLimitAttempts}/${RATE_LIMIT_MAX_RETRIES}). Waiting ${delayMs / 1000}s before retry...`);
            await sleep(delayMs);
            continue;
          }
          console.error(`[${this.config.name}] Gemini rate limit exceeded after ${RATE_LIMIT_MAX_RETRIES} retries`);
          return {
            content: "",
            error: `RATE_LIMIT: ${errorMessage}`,
            timedOut: false,
          };
        }
        
        console.error(`[${this.config.name}] Gemini attempt ${attempt + 1} failed:`, errorMessage);
        
        if (errorMessage.startsWith("TIMEOUT:")) {
          if (attempt < MAX_RETRIES) {
            console.log(`[${this.config.name}] Retrying Gemini after timeout...`);
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
          console.log(`[${this.config.name}] Retrying Gemini after error...`);
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

// DeepSeek pricing (per million tokens, as of Jan 2025)
// V3 (chat): $0.27 input, $1.10 output
// R1 (reasoner): $0.55 input, $2.19 output (reasoning tokens same as output)
function calculateDeepSeekCost(
  model: DeepSeekModel,
  inputTokens: number,
  outputTokens: number,
  thinkingTokens: number
): { inputCost: number; outputCost: number; thinkingCost: number; totalCost: number } {
  let inputRate: number;
  let outputRate: number;
  
  if (model === "deepseek-reasoner") {
    inputRate = 0.55 / 1_000_000;
    outputRate = 2.19 / 1_000_000;
  } else {
    inputRate = 0.27 / 1_000_000;
    outputRate = 1.10 / 1_000_000;
  }
  
  const inputCost = inputTokens * inputRate;
  const outputCost = outputTokens * outputRate;
  const thinkingCost = thinkingTokens * outputRate; // Reasoning tokens charged at output rate
  
  return {
    inputCost,
    outputCost,
    thinkingCost,
    totalCost: inputCost + outputCost + thinkingCost,
  };
}
