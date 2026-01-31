// LitAgents 2.5 - Enhanced Vocabulary Tracker
// Tracks used expressions and vocabulary to prevent semantic repetition
// Improved: Lower thresholds, domain-specific word detection, transition tracking

interface VocabularyReport {
  overusedWords: string[];
  recentExpressions: string[];
  dialogueVerbs: { verb: string; count: number }[];
  paragraphStarters: string[];
  avoidInNextScene: string[];
  domainWords: { word: string; count: number }[]; // Technical/domain-specific words
  sceneTransitions: string[]; // Track how scenes end for transition quality
}

// Common words to ignore (articles, prepositions, etc.)
const STOP_WORDS = new Set([
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'de', 'del', 'al',
  'en', 'con', 'por', 'para', 'sin', 'sobre', 'entre', 'hacia', 'hasta',
  'que', 'y', 'o', 'pero', 'ni', 'sino', 'aunque', 'porque', 'como', 'si',
  'no', 'se', 'su', 'sus', 'mi', 'mis', 'tu', 'tus', 'yo', 'me', 'te', 'le',
  'lo', 'les', 'nos', 'os', 'este', 'esta', 'esto', 'estos', 'estas',
  'ese', 'esa', 'eso', 'esos', 'esas', 'aquel', 'aquella', 'aquello',
  'era', 'fue', 'sido', 'ser', 'estar', 'estaba', 'habia', 'tenia', 'hacia',
  'mas', 'menos', 'muy', 'tan', 'ya', 'aun', 'todavia', 'cuando', 'donde',
  'quien', 'cual', 'cuyo', 'cada', 'todo', 'toda', 'todos', 'todas', 'nada',
  'algo', 'alguien', 'nadie', 'mismo', 'misma', 'otro', 'otra', 'otros', 'otras'
]);

// Dialogue verbs to track (normalized without accents)
const DIALOGUE_VERBS = [
  'dijo', 'pregunto', 'respondio', 'exclamo', 'murmuro', 'susurro',
  'grito', 'anadio', 'replico', 'contesto', 'inquirio', 'protesto',
  'admitio', 'confeso', 'aseguro', 'afirmo', 'nego', 'interrumpio',
  'sentencio', 'espeto', 'mascullo', 'balbuceo', 'tartamudeo', 'solto'
];

// Normalize text by removing Spanish accents
function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

// AI cliche patterns to detect
const AI_CLICHES = [
  /torbellino de emociones?/i,
  /el peso (de .+)? sobre sus hombros/i,
  /silencio (era )?ensordecedor/i,
  /mezcla de .+ y .+/i,
  /sin previo aviso/i,
  /en cuesti[oó]n de segundos/i,
  /como si el tiempo se hubiera detenido/i,
  /escalofr[ií]o recorri[oó] su (espalda|cuerpo)/i,
  /coraz[oó]n (le )?lat[ií]a con fuerza/i,
  /sus ojos se encontraron/i,
  /trag[oó] saliva/i,
  /contuvo la respiraci[oó]n/i,
  /no pod[ií]a creer lo que (estaba viendo|ve[ií]a)/i,
  /algo dentro de [eé]l\/ella/i,
  /en lo m[aá]s profundo de su ser/i,
  /un nudo en (la garganta|el est[oó]mago)/i,
  /el mundo se detuvo/i,
  /suspir[oó] profundamente/i,
  /l[aá]grimas rodaron por sus mejillas/i,
  /apret[oó] los pu[nñ]os/i,
  /la sangre se le hel[oó]/i,
  /sinti[oó] un vac[ií]o/i
];

export class VocabularyTracker {
  
  analyzeText(text: string): VocabularyReport {
    const normalizedText = normalizeText(text);
    
    const words = normalizedText
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 3 && !STOP_WORDS.has(w));
    
    const wordCount = new Map<string, number>();
    for (const word of words) {
      wordCount.set(word, (wordCount.get(word) || 0) + 1);
    }
    
    // LitAgents 2.5: Lower threshold to 2 repetitions for sensitive detection
    const overusedWords = Array.from(wordCount.entries())
      .filter(([_, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([word, count]) => `${word}(${count}x)`);
    
    // LitAgents 2.5: Detect domain-specific/technical words (longer, less common)
    // Words with 7+ letters that appear 2+ times are likely domain-specific
    const domainWords = Array.from(wordCount.entries())
      .filter(([word, count]) => word.length >= 7 && count >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([word, count]) => ({ word, count }));
    
    // Extract dialogue verbs usage
    const dialogueVerbCount = new Map<string, number>();
    for (const verb of DIALOGUE_VERBS) {
      const regex = new RegExp(`\\b${verb}\\b`, 'gi');
      const matches = normalizedText.match(regex);
      if (matches && matches.length > 0) {
        dialogueVerbCount.set(verb, matches.length);
      }
    }
    const dialogueVerbs = Array.from(dialogueVerbCount.entries())
      .map(([verb, count]) => ({ verb, count }))
      .sort((a, b) => b.count - a.count);
    
    // Extract paragraph starters
    const paragraphs = text.split(/\n\n+/);
    const starters = paragraphs
      .map(p => p.trim().split(/\s+/)[0])
      .filter(Boolean)
      .slice(-10);
    
    // LitAgents 2.5: Track scene transitions (last sentences of paragraphs)
    const sceneTransitions = paragraphs
      .map(p => {
        const sentences = p.trim().split(/[.!?]+/).filter(Boolean);
        return sentences.length > 0 ? sentences[sentences.length - 1].trim().substring(0, 100) : '';
      })
      .filter(t => t.length > 20)
      .slice(-5);
    
    // Detect AI cliches in text
    const recentExpressions: string[] = [];
    for (const pattern of AI_CLICHES) {
      const matches = text.match(pattern);
      if (matches) {
        recentExpressions.push(matches[0]);
      }
    }
    
    // Generate avoid list for next scene
    const avoidInNextScene: string[] = [];
    
    // Add overused dialogue verbs (threshold lowered to 1)
    dialogueVerbs
      .filter(v => v.count >= 1)
      .forEach(v => avoidInNextScene.push(`verbo "${v.verb}" (ya usado ${v.count}x)`));
    
    // Add repeated paragraph starters
    const starterCounts = new Map<string, number>();
    starters.forEach(s => starterCounts.set(s.toLowerCase(), (starterCounts.get(s.toLowerCase()) || 0) + 1));
    Array.from(starterCounts.entries())
      .filter(([_, count]) => count >= 2)
      .forEach(([starter]) => avoidInNextScene.push(`iniciar parrafo con "${starter}"`));
    
    // Add detected cliches
    recentExpressions.forEach(expr => avoidInNextScene.push(`expresion "${expr}"`));
    
    // Add most overused content words (now includes 2x repetitions)
    overusedWords.slice(0, 8).forEach(w => avoidInNextScene.push(`palabra ${w}`));
    
    // LitAgents 2.5: Add domain-specific words to avoid list
    domainWords
      .filter(d => d.count >= 2)
      .forEach(d => avoidInNextScene.push(`término técnico "${d.word}" (${d.count}x) - usa sinónimo`));
    
    return {
      overusedWords,
      recentExpressions,
      dialogueVerbs,
      paragraphStarters: starters,
      avoidInNextScene,
      domainWords,
      sceneTransitions
    };
  }

  generateAntiRepetitionPrompt(previousChaptersText: string, currentChapterText: string): string {
    // Analyze recent chapters
    const recentAnalysis = this.analyzeText(previousChaptersText);
    const currentAnalysis = this.analyzeText(currentChapterText);
    
    // Combine avoid lists (unique items)
    const combinedSet = new Set([
      ...recentAnalysis.avoidInNextScene,
      ...currentAnalysis.avoidInNextScene
    ]);
    const allAvoid = Array.from(combinedSet);
    
    if (allAvoid.length === 0) {
      return '';
    }
    
    return `
+------------------------------------------------------------------+
| VOCABULARIO A EVITAR EN ESTA ESCENA (ya sobreutilizado):         |
+------------------------------------------------------------------+
${allAvoid.map(item => `| - ${item}`).join('\n')}
+------------------------------------------------------------------+
| -> Usa sinonimos frescos o reformula completamente               |
| -> Varia la estructura de las oraciones                          |
| -> Busca descripciones originales para las emociones             |
+------------------------------------------------------------------+
`;
  }

  generateQuickAvoidList(recentText: string): string[] {
    const analysis = this.analyzeText(recentText);
    return analysis.avoidInNextScene.slice(0, 10);
  }
}

export const vocabularyTracker = new VocabularyTracker();
