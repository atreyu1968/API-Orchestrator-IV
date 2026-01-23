import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import { calculateRealCost, formatCostForStorage } from "../cost-calculator";
import { storage } from "../storage";

// AI Provider configuration
export type AIProvider = "gemini" | "deepseek";

// Get current AI provider from environment
export function getAIProvider(): AIProvider {
  const provider = process.env.AI_PROVIDER?.toLowerCase();
  if (provider === "gemini") return "gemini";
  return "deepseek"; // Default to DeepSeek (more cost-effective)
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

// DeepSeek client for Translator (separate API key for parallel operations)
function getDeepSeekTranslatorClient(): OpenAI | null {
  // Use dedicated translator key if available, fallback to main key
  const apiKey = process.env.DEEPSEEK_TRANSLATOR_API_KEY || process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return null;
  return new OpenAI({
    apiKey,
    baseURL: "https://api.deepseek.com",
  });
}

// DeepSeek client for Re-editor (separate API key for parallel operations)
function getDeepSeekReeditorClient(): OpenAI | null {
  // Use dedicated re-editor key if available, fallback to main key
  const apiKey = process.env.DEEPSEEK_REEDITOR_API_KEY || process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return null;
  return new OpenAI({
    apiKey,
    baseURL: "https://api.deepseek.com",
  });
}

export { getDeepSeekTranslatorClient, getDeepSeekReeditorClient };

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
// Default to V3 for stability, but allow override per agent
function mapGeminiToDeepSeek(geminiModel: GeminiModel): DeepSeekModel {
  return "deepseek-chat"; // Default fallback
}

// Agent-specific DeepSeek model recommendations:
// - Ghostwriter: deepseek-chat (V3) - fluent creative prose
// - Editor: deepseek-reasoner (R1) - deep analysis for continuity issues
// - Final Reviewer: deepseek-reasoner (R1) - critical evaluation
// - Copyeditor: deepseek-chat (V3) - fast corrections
export const AGENT_DEEPSEEK_MODELS: Record<string, DeepSeekModel> = {
  "ghostwriter": "deepseek-chat",      // V3 for fluent prose
  "editor": "deepseek-reasoner",        // R1 for deep analysis
  "final-reviewer": "deepseek-reasoner", // R1 for critical evaluation
  "final_reviewer": "deepseek-reasoner", // R1 for reedit final reviewer
  "copyeditor": "deepseek-chat",        // V3 for fast corrections
  "continuity-validator": "deepseek-reasoner", // R1 for detecting issues
  "chapter-expansion-analyzer": "deepseek-chat", // V3 for analysis
  "chapter-expander": "deepseek-chat",  // V3 for prose expansion
  "new-chapter-generator": "deepseek-chat", // V3 for prose generation
  "qa_continuity": "deepseek-reasoner", // R1 for continuity analysis
  "qa_voice": "deepseek-reasoner",      // R1 for voice/rhythm analysis
  "qa_semantic": "deepseek-reasoner",   // R1 for semantic analysis
  "qa_anachronism": "deepseek-reasoner", // R1 for anachronism detection
  "world_bible_extractor": "deepseek-chat", // V3 for extraction
  "narrative_rewriter": "deepseek-chat", // V3 for rewriting
  "manuscript-analyzer": "deepseek-reasoner", // R1 for deep manuscript analysis
  "arc-validator": "deepseek-reasoner", // R1 for series arc validation
  "series-thread-fixer": "deepseek-chat", // V3 for series thread fixes
  "editor": "deepseek-reasoner", // R1 for editorial analysis
  "copyeditor": "deepseek-chat", // V3 for creative polish
  "continuity-sentinel": "deepseek-reasoner", // R1 for continuity analysis
  "voice-rhythm-auditor": "deepseek-reasoner", // R1 for voice/rhythm analysis
  "semantic-repetition-detector": "deepseek-reasoner", // R1 for semantic analysis
  "restructurer": "deepseek-reasoner", // R1 for structural analysis
  "expansion_analyzer": "deepseek-reasoner", // R1 for expansion analysis
  "translator": "deepseek-chat", // V3 for translation
  "italian-reviewer": "deepseek-reasoner", // R1 for Italian review
  "chapter_expander": "deepseek-chat", // V3 for chapter expansion
  "new_chapter_generator": "deepseek-chat", // V3 for new chapter generation
  "ghostwriter": "deepseek-chat", // V3 for creative writing
  "final-reviewer": "deepseek-reasoner", // R1 for final review analysis
};

export type AIModel = GeminiModel | DeepSeekModel;

export interface AgentConfig {
  name: string;
  role: string;
  systemPrompt: string;
  model?: AIModel;
  useThinking?: boolean;
  useTranslatorClient?: boolean; // Use dedicated DeepSeek API key for translator
  useReeditorClient?: boolean; // Use dedicated DeepSeek API key for re-editor
}

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes for DeepSeek R1
const MAX_RETRIES = 4; // Increased retries for production stability
const RETRY_DELAY_MS = 8000; // Longer delay between retries

const RATE_LIMIT_MAX_RETRIES = 5;
const RATE_LIMIT_DELAYS_MS = [30000, 60000, 90000, 120000, 180000];

function isRateLimitError(error: any): boolean {
  const errorStr = String(error?.message || error || "");
  return errorStr.includes("RATELIMIT_EXCEEDED") || 
         errorStr.includes("429") || 
         errorStr.includes("Rate limit") ||
         errorStr.includes("rate limit");
}

function isConnectionError(error: any): boolean {
  const errorStr = String(error?.message || error || "");
  return errorStr.includes("ECONNRESET") || 
         errorStr.includes("ETIMEDOUT") ||
         errorStr.includes("ECONNREFUSED") ||
         errorStr.includes("socket hang up") ||
         errorStr.includes("network") ||
         errorStr.includes("fetch failed") ||
         errorStr.includes("Connection") ||
         errorStr.includes("ENOTFOUND");
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

  protected async generateContent(prompt: string, projectId?: number, options?: { temperature?: number; forceProvider?: AIProvider }): Promise<AgentResponse> {
    console.log(`[${this.config.name}] generateContent() called (prompt: ${prompt.length} chars)`);
    const provider = options?.forceProvider || getAIProvider();
    console.log(`[${this.config.name}] AI provider: ${provider}${options?.forceProvider ? ' (forced)' : ''}`);
    
    if (provider === "deepseek") {
      console.log(`[${this.config.name}] Calling generateWithDeepSeek()...`);
      return this.generateWithDeepSeek(prompt, projectId, options);
    }
    
    return this.generateWithGemini(prompt, projectId, options);
  }

  private async generateWithDeepSeek(prompt: string, projectId?: number, options?: { temperature?: number }): Promise<AgentResponse> {
    // Use dedicated client if configured (translator or re-editor)
    let deepseek: OpenAI | null;
    let keyName: string;
    
    if (this.config.useTranslatorClient) {
      deepseek = getDeepSeekTranslatorClient();
      keyName = "DEEPSEEK_TRANSLATOR_API_KEY";
    } else if (this.config.useReeditorClient) {
      deepseek = getDeepSeekReeditorClient();
      keyName = "DEEPSEEK_REEDITOR_API_KEY";
    } else {
      deepseek = getDeepSeekClient();
      keyName = "DEEPSEEK_API_KEY";
    }
    
    if (!deepseek) {
      return {
        content: "",
        error: `DeepSeek API key not configured. Please add ${keyName}.`,
        timedOut: false,
      };
    }

    let lastError: Error | null = null;
    const temperature = options?.temperature ?? 1.0;
    let rateLimitAttempts = 0;
    
    const maxAttempts = MAX_RETRIES + RATE_LIMIT_MAX_RETRIES + 1;
    
    // Use agent-specific DeepSeek model if configured, otherwise fallback to V3
    const agentName = this.config.name.toLowerCase();
    const deepseekModel = AGENT_DEEPSEEK_MODELS[agentName] || "deepseek-chat";
    console.log(`[${this.config.name}] Using DeepSeek model: ${deepseekModel} (agent-specific selection)`);
    
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

        console.log(`[${this.config.name}] Creating DeepSeek request (messages: ${messages.length}, model: ${deepseekModel})...`);
        
        // DeepSeek R1 (reasoner) uses different parameters than V3 (chat)
        // R1: max_completion_tokens (16000 limit), no temperature support
        // V3: max_tokens (8192 limit), temperature 0-2
        const isReasonerModel = deepseekModel === "deepseek-reasoner";
        
        const requestParams: any = {
          model: deepseekModel,
          messages,
          stream: false,
        };
        
        if (isReasonerModel) {
          // R1 uses max_completion_tokens and doesn't support temperature
          requestParams.max_completion_tokens = 16000;
        } else {
          // V3: max_tokens limit is 8192 - this is a hard API limit
          // For large outputs like World Bible, we need to use streaming or split requests
          requestParams.max_tokens = 8192;
          requestParams.temperature = Math.min(temperature, 2.0);
        }
        
        // CRITICAL DEBUG: Log the exact parameters being sent to DeepSeek
        const systemPromptLength = this.config.systemPrompt?.length || 0;
        const userPromptLength = prompt?.length || 0;
        console.log(`[${this.config.name}] DEBUG REQUEST PARAMS:`);
        console.log(`  - model: ${requestParams.model}`);
        console.log(`  - max_tokens: ${requestParams.max_tokens || 'N/A'}`);
        console.log(`  - max_completion_tokens: ${requestParams.max_completion_tokens || 'N/A'}`);
        console.log(`  - temperature: ${requestParams.temperature || 'N/A'}`);
        console.log(`  - stream: ${requestParams.stream}`);
        console.log(`  - systemPrompt length: ${systemPromptLength} chars`);
        console.log(`  - userPrompt length: ${userPromptLength} chars`);
        console.log(`  - total prompt chars: ${systemPromptLength + userPromptLength}`);
        
        const generatePromise = deepseek.chat.completions.create(requestParams);

        console.log(`[${this.config.name}] DeepSeek request created, awaiting response (timeout: ${this.timeoutMs}ms)...`);

        const response = await withTimeout(
          generatePromise,
          this.timeoutMs,
          `${this.config.name} DeepSeek generation`
        );
        
        const elapsedMs = Date.now() - startTime;
        console.log(`[${this.config.name}] DeepSeek API call completed in ${Math.round(elapsedMs / 1000)}s`);
        
        // CRITICAL DEBUG: Log the raw response structure
        console.log(`[${this.config.name}] DEBUG RAW RESPONSE:`);
        console.log(`  - response.id: ${response.id || 'N/A'}`);
        console.log(`  - response.model: ${response.model || 'N/A'}`);
        console.log(`  - response.choices length: ${response.choices?.length || 0}`);
        console.log(`  - response.usage: ${JSON.stringify(response.usage || {})}`);

        const choice = response.choices?.[0];
        let content = choice?.message?.content || "";
        let thoughtSignature = "";

        // DeepSeek R1 returns reasoning in reasoning_content field
        if ((choice?.message as any)?.reasoning_content) {
          thoughtSignature = (choice.message as any).reasoning_content;
        }
        
        // DEBUG: Log content length and preview for architect debugging
        console.log(`[${this.config.name}] DeepSeek response - content length: ${content.length}, reasoning length: ${thoughtSignature.length}`);
        
        // CRITICAL DEBUG: Log finish_reason
        console.log(`[${this.config.name}] DEBUG finish_reason: ${choice?.finish_reason || 'N/A'}`);
        
        // If content is empty, log more details
        if (content.length === 0) {
          console.log(`[${this.config.name}] WARNING: Empty content received!`);
          console.log(`  - choice.message: ${JSON.stringify(choice?.message || {}).substring(0, 500)}`);
          if (thoughtSignature.length > 0) {
            console.log(`  - reasoning_content preview (first 500): ${thoughtSignature.substring(0, 500)}`);
          }
        }
        if (content.length > 0) {
          console.log(`[${this.config.name}] DeepSeek content preview (first 500): ${content.substring(0, 500)}`);
        } else if (thoughtSignature.length > 0) {
          // If content is empty but reasoning has JSON, try to extract it
          const jsonMatch = thoughtSignature.match(/```(?:json)?\s*([\s\S]*?)```/);
          if (jsonMatch) {
            console.log(`[${this.config.name}] Found JSON in reasoning_content, extracting...`);
            content = jsonMatch[1].trim();
          } else {
            // Try to find raw JSON object in reasoning
            const rawJsonMatch = thoughtSignature.match(/(\{[\s\S]*"world_bible"[\s\S]*\})/);
            if (rawJsonMatch) {
              console.log(`[${this.config.name}] Found raw JSON in reasoning_content, extracting...`);
              content = rawJsonMatch[1];
            }
          }
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
            const delayMs = RETRY_DELAY_MS * (attempt + 1);
            console.log(`[${this.config.name}] Retrying DeepSeek after timeout (waiting ${delayMs/1000}s)...`);
            await sleep(delayMs);
            continue;
          }
          return {
            content: "",
            error: errorMessage,
            timedOut: true,
          };
        }
        
        if (isConnectionError(error)) {
          if (attempt < MAX_RETRIES) {
            const delayMs = RETRY_DELAY_MS * (attempt + 2);
            console.log(`[${this.config.name}] Connection error detected. Retrying in ${delayMs/1000}s (attempt ${attempt + 1}/${MAX_RETRIES})...`);
            await sleep(delayMs);
            continue;
          }
          console.error(`[${this.config.name}] DeepSeek connection failed after ${MAX_RETRIES} retries`);
          return {
            content: "",
            error: `CONNECTION_ERROR: ${errorMessage}`,
            timedOut: false,
          };
        }
        
        if (attempt < MAX_RETRIES) {
          const delayMs = RETRY_DELAY_MS * (attempt + 1);
          console.log(`[${this.config.name}] Retrying DeepSeek after error (waiting ${delayMs/1000}s)...`);
          await sleep(delayMs);
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
                thinkingBudget: 10000,
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
