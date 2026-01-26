// LitAgents 2.0 - Patcher utility using fuse.js for fuzzy text matching
import Fuse from 'fuse.js';

export interface Patch {
  original_text_snippet: string;
  replacement_text: string;
  reason: string;
}

export interface PatchResult {
  success: boolean;
  patchedText: string;
  appliedPatches: number;
  failedPatches: Patch[];
  log: string[];
}

/**
 * Apply patches to text using exact matching first, then fuzzy matching as fallback.
 * This avoids full rewrites by making surgical corrections.
 */
export function applyPatches(text: string, patches: Patch[]): PatchResult {
  let result = text;
  let appliedPatches = 0;
  const failedPatches: Patch[] = [];
  const log: string[] = [];

  if (!patches || patches.length === 0) {
    return {
      success: true,
      patchedText: text,
      appliedPatches: 0,
      failedPatches: [],
      log: ['No patches to apply']
    };
  }

  for (const patch of patches) {
    if (!patch.original_text_snippet || patch.original_text_snippet.length < 10) {
      log.push(`Skipping patch with too short snippet: "${patch.original_text_snippet?.substring(0, 20)}..."`);
      failedPatches.push(patch);
      continue;
    }

    // Try exact match first (most reliable)
    if (result.includes(patch.original_text_snippet)) {
      result = result.replace(patch.original_text_snippet, patch.replacement_text);
      appliedPatches++;
      log.push(`✓ Applied patch (exact match): "${patch.original_text_snippet.substring(0, 30)}..." → Reason: ${patch.reason}`);
      continue;
    }

    // Try normalized match (ignore extra whitespace)
    const normalizedOriginal = normalizeWhitespace(patch.original_text_snippet);
    const normalizedResult = normalizeWhitespace(result);
    
    if (normalizedResult.includes(normalizedOriginal)) {
      // Find the actual position in original text
      const fuzzyMatch = findFuzzyMatch(result, patch.original_text_snippet);
      if (fuzzyMatch) {
        result = result.substring(0, fuzzyMatch.start) + 
                 patch.replacement_text + 
                 result.substring(fuzzyMatch.end);
        appliedPatches++;
        log.push(`✓ Applied patch (normalized match): "${patch.original_text_snippet.substring(0, 30)}..." → Reason: ${patch.reason}`);
        continue;
      }
    }

    // Fallback: Use Fuse.js for fuzzy matching
    const fuzzyResult = fuzzyFindAndReplace(result, patch);
    if (fuzzyResult.success) {
      result = fuzzyResult.text;
      appliedPatches++;
      log.push(`✓ Applied patch (fuzzy match, score: ${fuzzyResult.score?.toFixed(3)}): "${patch.original_text_snippet.substring(0, 30)}..." → Reason: ${patch.reason}`);
    } else {
      failedPatches.push(patch);
      log.push(`✗ Failed to apply patch: "${patch.original_text_snippet.substring(0, 40)}..." - No match found`);
    }
  }

  return {
    success: failedPatches.length === 0,
    patchedText: result,
    appliedPatches,
    failedPatches,
    log
  };
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

interface FuzzyMatch {
  start: number;
  end: number;
  text: string;
}

function findFuzzyMatch(haystack: string, needle: string): FuzzyMatch | null {
  const normalizedNeedle = normalizeWhitespace(needle);
  const words = normalizedNeedle.split(' ');
  
  // Find the first word to anchor the search
  const firstWord = words[0];
  let searchStart = 0;
  
  while (searchStart < haystack.length) {
    const firstWordIndex = haystack.indexOf(firstWord, searchStart);
    if (firstWordIndex === -1) return null;
    
    // Try to match the full phrase from this position
    let matchEnd = firstWordIndex;
    let wordIndex = 0;
    let currentPos = firstWordIndex;
    
    while (wordIndex < words.length && currentPos < haystack.length) {
      const word = words[wordIndex];
      const wordPos = haystack.indexOf(word, currentPos);
      
      if (wordPos === -1 || wordPos > currentPos + word.length + 5) {
        // Word not found or too far away
        break;
      }
      
      currentPos = wordPos + word.length;
      matchEnd = currentPos;
      wordIndex++;
    }
    
    if (wordIndex === words.length) {
      return {
        start: firstWordIndex,
        end: matchEnd,
        text: haystack.substring(firstWordIndex, matchEnd)
      };
    }
    
    searchStart = firstWordIndex + 1;
  }
  
  return null;
}

interface FuzzyReplaceResult {
  success: boolean;
  text: string;
  score?: number;
}

function fuzzyFindAndReplace(text: string, patch: Patch): FuzzyReplaceResult {
  // Split text into sentences for more granular matching
  const sentences = text.split(/(?<=[.!?])\s+/);
  
  // Use Fuse.js to find the closest matching sentence
  const fuse = new Fuse(sentences, {
    includeScore: true,
    threshold: 0.4, // Allow 40% difference
    ignoreLocation: true,
    minMatchCharLength: 10
  });

  const results = fuse.search(patch.original_text_snippet);
  
  if (results.length === 0 || !results[0].score || results[0].score > 0.4) {
    // No good match found, try matching smaller chunks
    return tryChunkMatch(text, patch);
  }

  const bestMatch = results[0];
  const matchedSentence = sentences[bestMatch.refIndex];
  
  // Replace the matched sentence with the replacement text
  const newText = text.replace(matchedSentence, patch.replacement_text);
  
  if (newText === text) {
    return { success: false, text };
  }

  return {
    success: true,
    text: newText,
    score: bestMatch.score
  };
}

function tryChunkMatch(text: string, patch: Patch): FuzzyReplaceResult {
  // Try to find a close match by searching for key phrases from the original
  const words = patch.original_text_snippet.split(/\s+/);
  
  if (words.length < 4) {
    return { success: false, text };
  }

  // Take the first and last 3 words as anchors
  const startAnchor = words.slice(0, 3).join(' ');
  const endAnchor = words.slice(-3).join(' ');

  const startIndex = text.toLowerCase().indexOf(startAnchor.toLowerCase());
  if (startIndex === -1) {
    return { success: false, text };
  }

  // Search for end anchor after start anchor
  const searchAfter = startIndex + startAnchor.length;
  const endIndex = text.toLowerCase().indexOf(endAnchor.toLowerCase(), searchAfter);
  
  if (endIndex === -1 || endIndex - startIndex > patch.original_text_snippet.length * 1.5) {
    return { success: false, text };
  }

  const actualEnd = endIndex + endAnchor.length;
  const matchedText = text.substring(startIndex, actualEnd);
  
  // Verify the match is similar enough
  const similarity = calculateSimilarity(matchedText, patch.original_text_snippet);
  if (similarity < 0.6) {
    return { success: false, text };
  }

  const newText = text.substring(0, startIndex) + 
                  patch.replacement_text + 
                  text.substring(actualEnd);

  return {
    success: true,
    text: newText,
    score: 1 - similarity
  };
}

function calculateSimilarity(a: string, b: string): number {
  const aLower = a.toLowerCase();
  const bLower = b.toLowerCase();
  
  if (aLower === bLower) return 1;
  
  const aSet = new Set(aLower.split(/\s+/));
  const bSet = new Set(bLower.split(/\s+/));
  
  let intersection = 0;
  for (const word of aSet) {
    if (bSet.has(word)) intersection++;
  }
  
  const union = aSet.size + bSet.size - intersection;
  return intersection / union;
}
