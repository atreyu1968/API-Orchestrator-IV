/**
 * Gemini Context Manager
 * Uses your own Gemini API key for portability
 * Uses STANDARD mode only (full context injection per request)
 */

export type AuditMode = 'STANDARD';

export interface ContextResult {
  success: boolean;
  mode: AuditMode;
  novelContent?: string;
  bibleContent?: string | null;
  error?: string;
}

let currentContext: ContextResult | null = null;

const MODEL_NAME = "gemini-2.5-flash";

export function getModelName(): string {
  return MODEL_NAME;
}

export function getCurrentContext(): ContextResult | null {
  return currentContext;
}

/**
 * Initialize novel context for analysis
 */
export async function initializeNovelContext(
  novelContent: string,
  bibleContent: string | null,
  novelTitle: string
): Promise<ContextResult> {
  console.log(`[ContextManager] Initializing context for: ${novelTitle}`);
  
  let fullContext = `=== NOVELA COMPLETA ===\n\n${novelContent}`;
  if (bibleContent) {
    fullContext += `\n\n=== BIBLIA DE LA HISTORIA ===\n\n${bibleContent}`;
  }
  
  console.log(`[ContextManager] Context size: ${fullContext.length} chars`);
  console.log("[ContextManager] Using STANDARD mode with gemini-2.5-flash");
  
  currentContext = {
    success: true,
    mode: 'STANDARD',
    novelContent,
    bibleContent,
  };
  
  return currentContext;
}

/**
 * Clear current context
 */
export function clearContext(): void {
  currentContext = null;
}
