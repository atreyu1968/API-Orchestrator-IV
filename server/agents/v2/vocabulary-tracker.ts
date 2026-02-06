// LitAgents 2.9.9+ - Enhanced Vocabulary Tracker
// Tracks used expressions and vocabulary to prevent semantic repetition
// v2.9.9+: Forced dialogue tag detection, similar phrase detection, repetitive structural patterns

interface VocabularyReport {
  overusedWords: string[];
  recentExpressions: string[];
  dialogueVerbs: { verb: string; count: number }[];
  paragraphStarters: string[];
  avoidInNextScene: string[];
  domainWords: { word: string; count: number }[];
  sceneTransitions: string[];
  forcedDialogueTags: { tag: string; count: number }[];
  similarPhrases: { phrase: string; similar: string; similarity: number }[];
  repetitiveStructures: { pattern: string; occurrences: string[] }[];
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

// AI cliche patterns to detect - LitAgents 2.9.9+ expanded list
const AI_CLICHES = [
  // Classic AI clichés
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
  /sinti[oó] un vac[ií]o/i,
  // New expressions to avoid (v2.9.9+)
  /no pudo evitar (pensar|sentir|notar)/i,
  /algo en su interior/i,
  /antes de que pudiera reaccionar/i,
  /todo cambi[oó] en un instante/i,
  /una oleada de .+ lo\/la inund[oó]/i,
  /sin poder evitarlo/i,
  /con el coraz[oó]n en un pu[nñ]o/i,
  /un mar de dudas/i,
  /el aire se volvi[oó] denso/i,
  /como por arte de magia/i,
  /justo a tiempo/i,
  /en el momento preciso/i,
  /una extra[nñ]a sensaci[oó]n/i,
  /algo no cuadraba/i,
  /un presentimiento/i,
  /su instinto le dec[ií]a/i,
  /la respuesta lleg[oó] de improviso/i,
  /como si hubiera le[ií]do su mente/i,
  /todo encaj[oó] de repente/i,
  /las piezas del puzzle/i,
  /un escalofrío le recorri[oó]/i,
  /se qued[oó] sin palabras/i,
  /el silencio lo\/la dec[ií]a todo/i,
  /sus miradas se cruzaron/i,
  /una tensi[oó]n palpable/i,
  /el ambiente se enrareci[oó]/i,
  /algo indefinible/i,
  /por alguna raz[oó]n/i,
  /sin saber por qu[eé]/i
];

const FORCED_DIALOGUE_TAGS = [
  'mascullo', 'espeto', 'gruno', 'susurro', 'replico',
  'bramo', 'jadeo', 'balbuceo', 'tartamudeo', 'siseo',
  'rugio', 'vocifero', 'farfullo', 'cuchicheo', 'rezongo',
  'bufo', 'chillo', 'gimio', 'sollozo', 'lamento',
  'sentencio', 'ordeno', 'suplico', 'imploro', 'exigio'
];

const REPETITIVE_STRUCTURE_PATTERNS = [
  { regex: /no solo (.{5,60}), sino (?:que )?(.{5,60})/gi, name: 'no solo X, sino que Y' },
  { regex: /(?:no|ni) (?:era|fue|hab[ií]a sido) (.{5,40}), (?:era|fue|hab[ií]a sido) (.{5,40})/gi, name: 'no era X, era Y' },
  { regex: /(?:m[aá]s|menos) que (.{5,40}), (?:era|fue|se trataba de) (.{5,40})/gi, name: 'más que X, era Y' },
  { regex: /tanto (.{5,40}) como (.{5,40})/gi, name: 'tanto X como Y' },
  { regex: /si (.{5,40}), entonces (.{5,40})/gi, name: 'si X, entonces Y' },
  { regex: /no (?:era|había|fue) (.{5,40})[,.;] (?:sino|era|fue) (.{5,40})/gi, name: 'no era X, sino Y' },
];

function extractPhrases(text: string, minLen: number = 8, maxLen: number = 60): string[] {
  const sentences = text.split(/[.!?;]+/).map(s => s.trim()).filter(s => s.length >= minLen);
  const phrases: string[] = [];
  for (const sentence of sentences) {
    const clauses = sentence.split(/[,—]+/).map(c => c.trim()).filter(c => c.length >= minLen && c.length <= maxLen);
    phrases.push(...clauses);
  }
  return phrases;
}

function phraseSimilarity(a: string, b: string): number {
  const normalize = (s: string) => normalizeText(s).replace(/[^a-z0-9\s]/g, '').trim();
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return 1.0;
  const wordsA = na.split(/\s+/);
  const wordsB = nb.split(/\s+/);
  if (wordsA.length < 3 || wordsB.length < 3) return 0;
  const setA = new Set(wordsA);
  const setB = new Set(wordsB);
  const intersection = Array.from(setA).filter(w => setB.has(w) && !STOP_WORDS.has(w));
  const contentWordsA = wordsA.filter(w => !STOP_WORDS.has(w));
  const contentWordsB = wordsB.filter(w => !STOP_WORDS.has(w));
  if (contentWordsA.length === 0 || contentWordsB.length === 0) return 0;
  return (intersection.length * 2) / (contentWordsA.length + contentWordsB.length);
}

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
    
    // v2.9.9+: Detect forced dialogue tags ("telling" instead of "showing")
    const forcedTagCount = new Map<string, number>();
    for (const tag of FORCED_DIALOGUE_TAGS) {
      const tagRegex = new RegExp(`\\b${tag}\\b`, 'gi');
      const tagMatches = normalizedText.match(tagRegex);
      if (tagMatches && tagMatches.length > 0) {
        forcedTagCount.set(tag, tagMatches.length);
      }
    }
    const forcedDialogueTags = Array.from(forcedTagCount.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count);
    const totalForcedTags = forcedDialogueTags.reduce((sum, t) => sum + t.count, 0);

    // v2.9.9+: Detect similar/nearly identical descriptive phrases
    const phrases = extractPhrases(text);
    const similarPhrases: { phrase: string; similar: string; similarity: number }[] = [];
    for (let i = 0; i < phrases.length && i < 200; i++) {
      for (let j = i + 1; j < phrases.length && j < 200; j++) {
        const sim = phraseSimilarity(phrases[i], phrases[j]);
        if (sim >= 0.7 && phrases[i] !== phrases[j]) {
          similarPhrases.push({
            phrase: phrases[i].substring(0, 80),
            similar: phrases[j].substring(0, 80),
            similarity: Math.round(sim * 100)
          });
        }
      }
    }
    const uniqueSimilar = similarPhrases.slice(0, 10);

    // v2.9.9+: Detect repetitive structural patterns
    const repetitiveStructures: { pattern: string; occurrences: string[] }[] = [];
    for (const { regex, name } of REPETITIVE_STRUCTURE_PATTERNS) {
      regex.lastIndex = 0;
      const matches: string[] = [];
      let match;
      while ((match = regex.exec(text)) !== null) {
        matches.push(match[0].substring(0, 100));
      }
      if (matches.length >= 2) {
        repetitiveStructures.push({ pattern: name, occurrences: matches });
      }
    }

    // Generate avoid list for next scene
    const avoidInNextScene: string[] = [];
    
    // Add overused dialogue verbs (threshold lowered to 1)
    dialogueVerbs
      .filter(v => v.count >= 1)
      .forEach(v => avoidInNextScene.push(`verbo "${v.verb}" (ya usado ${v.count}x)`));
    
    // v2.9.9+: Flag forced dialogue tags
    if (totalForcedTags >= 3) {
      avoidInNextScene.push(`⚠️ ACOTACIONES FORZADAS (${totalForcedTags}x): ${forcedDialogueTags.map(t => `"${t.tag}"(${t.count}x)`).join(', ')} — MUESTRA emociones con acciones físicas, no con verbos de habla forzados`);
    }
    forcedDialogueTags
      .filter(t => t.count >= 2)
      .forEach(t => avoidInNextScene.push(`acotación forzada "${t.tag}" (${t.count}x) — usa "dijo" + acción física`));

    // v2.9.9+: Flag similar phrases
    uniqueSimilar.forEach(sp =>
      avoidInNextScene.push(`frases casi idénticas: "${sp.phrase}" ≈ "${sp.similar}" (${sp.similarity}% similitud) — reformula completamente`)
    );

    // v2.9.9+: Flag repetitive structures
    repetitiveStructures.forEach(rs =>
      avoidInNextScene.push(`estructura repetitiva "${rs.pattern}" usada ${rs.occurrences.length}x — varía la construcción gramatical`)
    );

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
      sceneTransitions,
      forcedDialogueTags,
      similarPhrases: uniqueSimilar,
      repetitiveStructures
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
    
    let prompt = `
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

    if (currentAnalysis.forcedDialogueTags.length > 0) {
      const total = currentAnalysis.forcedDialogueTags.reduce((s, t) => s + t.count, 0);
      prompt += `
+------------------------------------------------------------------+
| ⚠️ ACOTACIONES DE DIÁLOGO FORZADAS (${total} detectadas)           |
+------------------------------------------------------------------+
| PROBLEMA: Usar verbos como "masculló", "espetó", "gruñó" es     |
| "CONTAR" las emociones en vez de "MOSTRARLAS".                   |
| SOLUCIÓN: Usa "dijo" + acción física que MUESTRE la emoción:     |
|   ✗ "—No me importa —masculló con rabia."                       |
|   ✓ "—No me importa. —Apretó los puños sobre la mesa."          |
|   ✗ "—¡Sal de aquí! —espetó furiosamente."                      |
|   ✓ "—¡Sal de aquí! —Se levantó de golpe, volcando la silla."   |
+------------------------------------------------------------------+
`;
    }

    if (currentAnalysis.similarPhrases.length > 0) {
      prompt += `
+------------------------------------------------------------------+
| ⚠️ FRASES DESCRIPTIVAS CASI IDÉNTICAS DETECTADAS                  |
+------------------------------------------------------------------+
${currentAnalysis.similarPhrases.map(sp => `| "${sp.phrase}" ≈ "${sp.similar}" (${sp.similarity}%)`).join('\n')}
| -> Cada descripción debe ser ÚNICA. Reformula completamente.     |
+------------------------------------------------------------------+
`;
    }

    if (currentAnalysis.repetitiveStructures.length > 0) {
      prompt += `
+------------------------------------------------------------------+
| ⚠️ ESTRUCTURAS GRAMATICALES REPETITIVAS                           |
+------------------------------------------------------------------+
${currentAnalysis.repetitiveStructures.map(rs => `| Patrón "${rs.pattern}" usado ${rs.occurrences.length}x`).join('\n')}
| -> Varía la construcción: usa oraciones simples, subordinadas,   |
|    yuxtapuestas, interrogativas retóricas, etc.                  |
+------------------------------------------------------------------+
`;
    }

    return prompt;
  }

  generateQuickAvoidList(recentText: string): string[] {
    const analysis = this.analyzeText(recentText);
    return analysis.avoidInNextScene.slice(0, 10);
  }
}

export const vocabularyTracker = new VocabularyTracker();
