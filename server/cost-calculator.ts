// Real pricing per model (per 1M tokens)
// Source: DeepSeek API pricing as of Jan 2025

export interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
  thinkingPerMillion: number; // For reasoning models like R1
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  // DeepSeek R1 (deepseek-reasoner) - Slow reasoning model for planning
  "deepseek-reasoner": {
    inputPerMillion: 0.55,
    outputPerMillion: 2.19,
    thinkingPerMillion: 0.55, // Thinking tokens at input rate
  },
  // DeepSeek V3/Chat - Fast model for writing and editing
  "deepseek-chat": {
    inputPerMillion: 0.28,
    outputPerMillion: 0.42,
    thinkingPerMillion: 0.28,
  },
  // Gemini 3 Pro Preview - Optional high-speed alternative
  "gemini-3-pro-preview": {
    inputPerMillion: 1.25,
    outputPerMillion: 10.0,
    thinkingPerMillion: 3.0,
  },
  // Gemini 2.5 Flash - Cheap Gemini option
  "gemini-2.5-flash": {
    inputPerMillion: 0.30,
    outputPerMillion: 2.5,
    thinkingPerMillion: 1.0,
  },
  // Default fallback (uses DeepSeek V3 rates)
  "default": {
    inputPerMillion: 0.28,
    outputPerMillion: 0.42,
    thinkingPerMillion: 0.28,
  },
};

export function calculateRealCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  thinkingTokens: number = 0
): { inputCost: number; outputCost: number; thinkingCost: number; totalCost: number } {
  const pricing = MODEL_PRICING[model] || MODEL_PRICING["default"];
  
  const inputCost = (inputTokens / 1_000_000) * pricing.inputPerMillion;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPerMillion;
  const thinkingCost = (thinkingTokens / 1_000_000) * pricing.thinkingPerMillion;
  const totalCost = inputCost + outputCost + thinkingCost;
  
  return {
    inputCost: Math.round(inputCost * 1000000) / 1000000,
    outputCost: Math.round(outputCost * 1000000) / 1000000,
    thinkingCost: Math.round(thinkingCost * 1000000) / 1000000,
    totalCost: Math.round(totalCost * 1000000) / 1000000,
  };
}

export function formatCostForStorage(cost: number): string {
  return cost.toFixed(6);
}

// Agent to model mapping for reference
export const AGENT_MODEL_MAPPING: Record<string, string> = {
  // V2 Agents (DeepSeek)
  "global-architect": "deepseek-reasoner",
  "chapter-architect": "deepseek-reasoner",
  "narrative-director": "deepseek-reasoner",
  "ghostwriter-v2": "deepseek-chat",
  "smart-editor": "deepseek-chat",
  "summarizer": "deepseek-chat",
  // Legacy V1 Agents (Gemini) - kept for compatibility
  "architect": "gemini-3-pro-preview",
  "ghostwriter": "gemini-3-pro-preview",
  "editor": "gemini-2.5-flash",
  "copyeditor": "gemini-2.5-flash",
  "final-reviewer": "deepseek-reasoner",
  "continuity-sentinel": "gemini-2.5-flash",
  "voice-auditor": "gemini-2.5-flash",
  "semantic-detector": "gemini-2.5-flash",
  "translator": "deepseek-chat",
  "arc-validator": "gemini-2.5-flash",
  "series-thread-fixer": "gemini-2.5-flash",
};
