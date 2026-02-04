/**
 * Gemini Context Manager
 * Uses your own Gemini API key for portability
 * Uses STANDARD mode (full context injection per request)
 */

import { GoogleGenerativeAI } from "@google/generative-ai";

// Use your own Gemini API key
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const MODEL_NAME = "gemini-1.5-flash"; // Best for high-volume analysis tasks

export type AuditMode = 'CACHE' | 'STANDARD';

export interface ContextResult {
  success: boolean;
  mode: AuditMode;
  cacheId?: string;
  cacheName?: string;
  expiresAt?: Date;
  novelContent?: string;
  bibleContent?: string | null;
  error?: string;
}

let currentContext: ContextResult | null = null;

export function getModelName(): string {
  return MODEL_NAME;
}

export function getCurrentContext(): ContextResult | null {
  return currentContext;
}

/**
 * Initialize novel context - uses STANDARD mode (Context Caching not supported by Replit AI)
 */
export async function initializeNovelContext(
  novelContent: string,
  bibleContent: string | null,
  novelTitle: string
): Promise<ContextResult> {
  console.log(`[CacheManager] Initializing context for: ${novelTitle}`);
  
  let fullContext = `=== NOVELA COMPLETA ===\n\n${novelContent}`;
  if (bibleContent) {
    fullContext += `\n\n=== BIBLIA DE LA HISTORIA ===\n\n${bibleContent}`;
  }
  
  console.log(`[CacheManager] Context size: ${fullContext.length} chars`);
  console.log("[CacheManager] Using STANDARD mode (Replit AI Integrations)");
  
  // Replit AI Integrations does not support Context Caching
  // Always use STANDARD mode with full context injection
  currentContext = {
    success: true,
    mode: 'STANDARD',
    novelContent,
    bibleContent,
  };
  
  return currentContext;
}

/**
 * Check if a cache is still valid
 */
export async function isCacheValid(cacheId: string): Promise<boolean> {
  try {
    const cacheManager = new GoogleAICacheManager(GEMINI_API_KEY);
    const cache = await cacheManager.get(cacheId);
    if (!cache.expireTime) return false;
    return new Date(cache.expireTime) > new Date();
  } catch {
    return false;
  }
}

/**
 * Delete a cache when no longer needed
 */
export async function deleteCache(cacheId: string): Promise<boolean> {
  try {
    const cacheManager = new GoogleAICacheManager(GEMINI_API_KEY);
    await cacheManager.delete(cacheId);
    console.log(`[CacheManager] Cache deleted: ${cacheId}`);
    currentContext = null;
    return true;
  } catch (error) {
    console.error("[CacheManager] Error deleting cache:", error);
    return false;
  }
}

/**
 * Clear current context
 */
export function clearContext(): void {
  currentContext = null;
}
