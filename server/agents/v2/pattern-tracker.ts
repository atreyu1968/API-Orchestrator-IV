/**
 * Pattern Tracker - LitAgents 2.9.7
 * Tracks structural patterns within a novel to prevent repetition
 * 
 * Monitors:
 * - Scene type sequences (action → dialogue → reflection)
 * - Beat patterns (investigation → discovery → confrontation)
 * - Information acquisition methods (how protagonist learns things)
 * - Chapter opening/closing patterns
 */

export type SceneType = 
  | 'action'           // Physical conflict, chase, escape
  | 'dialogue'         // Conversation-focused
  | 'investigation'    // Protagonist actively searching/analyzing
  | 'discovery'        // Finding new information
  | 'confrontation'    // Face-to-face with antagonist/obstacle
  | 'reflection'       // Internal monologue, processing
  | 'transition'       // Travel, time passage
  | 'revelation'       // Major plot twist revealed
  | 'planning'         // Characters strategizing
  | 'infiltration'     // Sneaking, undercover work
  | 'interrogation'    // Extracting information from someone
  | 'escape'           // Fleeing danger
  | 'setup'            // Establishing new elements
  | 'payoff'           // Resolution of earlier setup
  | 'climax'           // High-tension peak moment
  | 'aftermath'        // Dealing with consequences
  | 'romantic'         // Romance-focused scene
  | 'suspense';        // Building tension without action

export type InfoAcquisitionMethod =
  | 'deduction'        // Protagonist figures it out
  | 'interrogation'    // Extracts from witness/suspect
  | 'surveillance'     // Watching/following
  | 'document_search'  // Finding papers, files, records
  | 'digital_forensics'// Hacking, tech investigation
  | 'physical_evidence'// Examining crime scene, objects
  | 'informant'        // Someone provides info (limit use)
  | 'overheard'        // Eavesdropping (limit use)
  | 'anonymous_tip'    // AVOID - deus ex machina
  | 'confession'       // Someone confesses
  | 'accident';        // Stumbles upon (limit use)

export type ChapterOpening =
  | 'in_media_res'     // Starting in middle of action
  | 'dialogue'         // Opens with conversation
  | 'description'      // Setting/atmosphere description
  | 'reflection'       // Internal thoughts
  | 'continuation'     // Direct continuation from previous
  | 'time_jump'        // "Three days later..."
  | 'flashback'        // Past event
  | 'hook_question';   // Poses intriguing question

export type ChapterClosing =
  | 'cliffhanger'      // Danger imminent
  | 'revelation'       // Shocking discovery
  | 'decision'         // Character makes crucial choice
  | 'arrival'          // Reaching destination/goal
  | 'question'         // Unanswered question posed
  | 'threat'           // New threat emerges
  | 'loss'             // Character loses something/someone
  | 'victory'          // Minor win before bigger challenge
  | 'betrayal'         // Trust broken
  | 'mystery_deepens'; // More questions than answers

export interface ChapterPattern {
  chapterNum: number;
  title: string;
  sceneSequence: SceneType[];
  infoMethods: InfoAcquisitionMethod[];
  opening: ChapterOpening;
  closing: ChapterClosing;
  emotionalArc: string;
  primaryConflictType: string;
  weatherMentioned: boolean;
  travelScene: boolean;
  phoneCall: boolean;
  anonymousTip: boolean;
}

export interface PatternAnalysis {
  recentPatterns: ChapterPattern[];
  avoidSequences: string[];
  avoidOpenings: ChapterOpening[];
  avoidClosings: ChapterClosing[];
  overusedSceneTypes: SceneType[];
  overusedInfoMethods: InfoAcquisitionMethod[];
  consecutivePatternWarnings: string[];
  suggestions: string[];
}

export class PatternTracker {
  private patterns: Map<number, ChapterPattern> = new Map();
  private projectId: number;

  constructor(projectId: number) {
    this.projectId = projectId;
  }

  registerPattern(pattern: ChapterPattern): void {
    this.patterns.set(pattern.chapterNum, pattern);
    console.log(`[PatternTracker] Registered pattern for Chapter ${pattern.chapterNum}: ${pattern.sceneSequence.join(' → ')}`);
  }

  classifySceneType(plotBeat: string, emotionalBeat: string): SceneType {
    const combined = `${plotBeat} ${emotionalBeat}`.toLowerCase();
    
    if (/pelea|lucha|persecución|escape|huye|corre|ataca|dispara|combate/.test(combined)) return 'action';
    if (/escapa|huida|fuga/.test(combined)) return 'escape';
    if (/investiga|busca|analiza|examina|rastrea|revisa/.test(combined)) return 'investigation';
    if (/descubre|encuentra|halla|revela|se da cuenta/.test(combined)) return 'discovery';
    if (/enfrenta|confronta|cara a cara|acusa|desafía/.test(combined)) return 'confrontation';
    if (/interroga|pregunta|presiona|extrae información/.test(combined)) return 'interrogation';
    if (/infiltra|se cuela|disfraz|encubierto|espía/.test(combined)) return 'infiltration';
    if (/reflexiona|piensa|recuerda|medita|procesa/.test(combined)) return 'reflection';
    if (/viaja|conduce|tren|avión|camino|trayecto/.test(combined)) return 'transition';
    if (/revela|giro|verdad|secreto|shock/.test(combined)) return 'revelation';
    if (/planea|estrategia|organiza|prepara|coordina/.test(combined)) return 'planning';
    if (/tensión|acecha|observa|espera|silencio/.test(combined)) return 'suspense';
    if (/clímax|momento cumbre|decisivo|final/.test(combined)) return 'climax';
    if (/consecuencias|después|recupera|asimila/.test(combined)) return 'aftermath';
    if (/amor|beso|romance|íntimo|pasión/.test(combined)) return 'romantic';
    if (/habla|conversa|discute|diálogo|dice/.test(combined)) return 'dialogue';
    if (/establece|presenta|introduce|setup/.test(combined)) return 'setup';
    if (/resuelve|paga|cierra|payoff/.test(combined)) return 'payoff';
    
    return 'dialogue';
  }

  classifyInfoMethod(plotBeat: string): InfoAcquisitionMethod | null {
    const text = plotBeat.toLowerCase();
    
    if (/mensaje anónimo|llamada misteriosa|número oculto|correo sin remite/.test(text)) return 'anonymous_tip';
    if (/deduce|concluye|razona|conecta los puntos/.test(text)) return 'deduction';
    if (/interroga|pregunta|presiona|hace hablar/.test(text)) return 'interrogation';
    if (/vigila|sigue|observa|espía|rastrea/.test(text)) return 'surveillance';
    if (/documento|archivo|registro|papeles|expediente/.test(text)) return 'document_search';
    if (/hackea|ordenador|digital|base de datos|servidor/.test(text)) return 'digital_forensics';
    if (/escena del crimen|evidencia|prueba física|huella/.test(text)) return 'physical_evidence';
    if (/informante|contacto|fuente|soplo/.test(text)) return 'informant';
    if (/escucha|oye|conversación ajena/.test(text)) return 'overheard';
    if (/confiesa|admite|revela voluntariamente/.test(text)) return 'confession';
    if (/casualidad|tropiza|por accidente/.test(text)) return 'accident';
    
    return null;
  }

  analyzeForChapter(currentChapterNum: number): PatternAnalysis {
    const analysis: PatternAnalysis = {
      recentPatterns: [],
      avoidSequences: [],
      avoidOpenings: [],
      avoidClosings: [],
      overusedSceneTypes: [],
      overusedInfoMethods: [],
      consecutivePatternWarnings: [],
      suggestions: []
    };

    const allPatterns = Array.from(this.patterns.values()).sort((a, b) => a.chapterNum - b.chapterNum);
    const recentPatterns = allPatterns.filter(p => p.chapterNum >= currentChapterNum - 5 && p.chapterNum < currentChapterNum);
    analysis.recentPatterns = recentPatterns;

    const sceneTypeCounts = new Map<SceneType, number>();
    const infoMethodCounts = new Map<InfoAcquisitionMethod, number>();
    const openingCounts = new Map<ChapterOpening, number>();
    const closingCounts = new Map<ChapterClosing, number>();
    const sequenceStrings: string[] = [];

    for (const pattern of allPatterns) {
      if (pattern.chapterNum >= currentChapterNum) continue;

      pattern.sceneSequence.forEach(st => {
        sceneTypeCounts.set(st, (sceneTypeCounts.get(st) || 0) + 1);
      });

      pattern.infoMethods.forEach(im => {
        infoMethodCounts.set(im, (infoMethodCounts.get(im) || 0) + 1);
      });

      openingCounts.set(pattern.opening, (openingCounts.get(pattern.opening) || 0) + 1);
      closingCounts.set(pattern.closing, (closingCounts.get(pattern.closing) || 0) + 1);

      sequenceStrings.push(pattern.sceneSequence.join('→'));
    }

    const totalChapters = allPatterns.filter(p => p.chapterNum < currentChapterNum).length;
    const overuseThreshold = Math.max(3, totalChapters * 0.3);

    sceneTypeCounts.forEach((count, type) => {
      if (count >= overuseThreshold) {
        analysis.overusedSceneTypes.push(type);
      }
    });

    infoMethodCounts.forEach((count, method) => {
      if (count >= 3) {
        analysis.overusedInfoMethods.push(method);
      }
    });

    const lastThreeOpenings = recentPatterns.slice(-3).map(p => p.opening);
    const lastThreeClosings = recentPatterns.slice(-3).map(p => p.closing);

    if (lastThreeOpenings.length >= 2 && lastThreeOpenings[0] === lastThreeOpenings[1]) {
      analysis.avoidOpenings.push(lastThreeOpenings[0]);
      analysis.consecutivePatternWarnings.push(
        `Los últimos ${lastThreeOpenings.filter(o => o === lastThreeOpenings[0]).length} capítulos abrieron con '${lastThreeOpenings[0]}'. VARÍA la apertura.`
      );
    }

    if (lastThreeClosings.length >= 2 && lastThreeClosings[0] === lastThreeClosings[1]) {
      analysis.avoidClosings.push(lastThreeClosings[0]);
      analysis.consecutivePatternWarnings.push(
        `Los últimos ${lastThreeClosings.filter(c => c === lastThreeClosings[0]).length} capítulos cerraron con '${lastThreeClosings[0]}'. VARÍA el cierre.`
      );
    }

    if (recentPatterns.length >= 2) {
      const lastTwoSequences = recentPatterns.slice(-2).map(p => p.sceneSequence.join('→'));
      if (lastTwoSequences[0] === lastTwoSequences[1]) {
        analysis.avoidSequences.push(lastTwoSequences[0]);
        analysis.consecutivePatternWarnings.push(
          `Los capítulos ${recentPatterns[recentPatterns.length-2].chapterNum} y ${recentPatterns[recentPatterns.length-1].chapterNum} tienen IDÉNTICA estructura de escenas. El próximo capítulo DEBE ser diferente.`
        );
      }
    }

    const sequenceFreq = new Map<string, number>();
    sequenceStrings.forEach(seq => {
      sequenceFreq.set(seq, (sequenceFreq.get(seq) || 0) + 1);
    });
    sequenceFreq.forEach((count, seq) => {
      if (count >= 2) {
        analysis.avoidSequences.push(seq);
      }
    });

    const anonymousTipCount = allPatterns.filter(p => p.anonymousTip).length;
    if (anonymousTipCount >= 1) {
      analysis.suggestions.push(`Ya se usó 'mensaje anónimo/llamada misteriosa' ${anonymousTipCount} vez(ces). PROHIBIDO usar de nuevo.`);
    }

    const weatherCount = recentPatterns.filter(p => p.weatherMentioned).length;
    if (weatherCount >= 2) {
      analysis.suggestions.push(`${weatherCount} de los últimos ${recentPatterns.length} capítulos mencionan el clima. EVITA descripciones atmosféricas.`);
    }

    const travelCount = recentPatterns.filter(p => p.travelScene).length;
    if (travelCount >= 2) {
      analysis.suggestions.push(`${travelCount} de los últimos ${recentPatterns.length} capítulos tienen escenas de viaje/conducción. EVITA transiciones de viaje.`);
    }

    const phoneCount = recentPatterns.filter(p => p.phoneCall).length;
    if (phoneCount >= 2) {
      analysis.suggestions.push(`${phoneCount} de los últimos ${recentPatterns.length} capítulos incluyen llamadas telefónicas importantes. BUSCA otros medios de comunicación.`);
    }

    if (analysis.overusedSceneTypes.length > 0) {
      analysis.suggestions.push(`Tipos de escena sobreusados: ${analysis.overusedSceneTypes.join(', ')}. Prioriza: ${this.getSuggestedAlternatives(analysis.overusedSceneTypes)}`);
    }

    return analysis;
  }

  private getSuggestedAlternatives(overused: SceneType[]): string {
    const allTypes: SceneType[] = ['action', 'dialogue', 'investigation', 'discovery', 'confrontation', 
      'reflection', 'transition', 'revelation', 'planning', 'infiltration', 'interrogation', 
      'escape', 'setup', 'payoff', 'climax', 'aftermath', 'romantic', 'suspense'];
    
    const underused = allTypes.filter(t => !overused.includes(t));
    return underused.slice(0, 4).join(', ');
  }

  formatForPrompt(analysis: PatternAnalysis): string {
    if (analysis.recentPatterns.length === 0) {
      return '';
    }

    const lines: string[] = [];
    lines.push(`╔══════════════════════════════════════════════════════════════════╗`);
    lines.push(`║ 🔄 ANTI-REPETITION TRACKER (LitAgents 2.9.7)                     ║`);
    lines.push(`╠══════════════════════════════════════════════════════════════════╣`);
    
    lines.push(`║ PATRONES DE CAPÍTULOS RECIENTES (NO REPETIR):                   ║`);
    for (const pattern of analysis.recentPatterns.slice(-3)) {
      lines.push(`║   Cap ${pattern.chapterNum}: ${pattern.sceneSequence.join(' → ').substring(0, 50).padEnd(50)} ║`);
    }
    lines.push(`║                                                                  ║`);

    if (analysis.consecutivePatternWarnings.length > 0) {
      lines.push(`║ ⚠️ ADVERTENCIAS DE REPETICIÓN CONSECUTIVA:                      ║`);
      for (const warning of analysis.consecutivePatternWarnings) {
        const wrapped = this.wrapText(warning, 60);
        wrapped.forEach(line => lines.push(`║   ${line.padEnd(63)}║`));
      }
      lines.push(`║                                                                  ║`);
    }

    if (analysis.avoidSequences.length > 0) {
      lines.push(`║ ❌ SECUENCIAS A EVITAR:                                          ║`);
      for (const seq of analysis.avoidSequences.slice(0, 3)) {
        lines.push(`║   • ${seq.substring(0, 55).padEnd(60)} ║`);
      }
      lines.push(`║                                                                  ║`);
    }

    if (analysis.avoidOpenings.length > 0) {
      lines.push(`║ ❌ APERTURAS USADAS RECIENTEMENTE (VARIAR):                      ║`);
      lines.push(`║   ${analysis.avoidOpenings.join(', ').padEnd(63)}║`);
    }

    if (analysis.avoidClosings.length > 0) {
      lines.push(`║ ❌ CIERRES USADOS RECIENTEMENTE (VARIAR):                        ║`);
      lines.push(`║   ${analysis.avoidClosings.join(', ').padEnd(63)}║`);
    }

    if (analysis.overusedSceneTypes.length > 0) {
      lines.push(`║ ⚠️ TIPOS DE ESCENA SOBREUSADOS:                                 ║`);
      lines.push(`║   ${analysis.overusedSceneTypes.join(', ').padEnd(63)}║`);
    }

    if (analysis.suggestions.length > 0) {
      lines.push(`║                                                                  ║`);
      lines.push(`║ 💡 RECOMENDACIONES:                                              ║`);
      for (const suggestion of analysis.suggestions) {
        const wrapped = this.wrapText(suggestion, 60);
        wrapped.forEach(line => lines.push(`║   ${line.padEnd(63)}║`));
      }
    }

    lines.push(`╚══════════════════════════════════════════════════════════════════╝`);
    
    return lines.join('\n');
  }

  private wrapText(text: string, maxWidth: number): string[] {
    const words = text.split(' ');
    const lines: string[] = [];
    let currentLine = '';

    for (const word of words) {
      if ((currentLine + ' ' + word).length <= maxWidth) {
        currentLine = currentLine ? currentLine + ' ' + word : word;
      } else {
        if (currentLine) lines.push(currentLine);
        currentLine = word;
      }
    }
    if (currentLine) lines.push(currentLine);
    
    return lines;
  }

  extractPatternFromScenes(
    chapterNum: number,
    title: string,
    scenes: Array<{ plot_beat: string; emotional_beat: string; ending_hook: string }>,
    chapterHook: string
  ): ChapterPattern {
    const sceneSequence: SceneType[] = [];
    const infoMethods: InfoAcquisitionMethod[] = [];
    let weatherMentioned = false;
    let travelScene = false;
    let phoneCall = false;
    let anonymousTip = false;

    for (const scene of scenes) {
      const sceneType = this.classifySceneType(scene.plot_beat, scene.emotional_beat);
      sceneSequence.push(sceneType);

      const infoMethod = this.classifyInfoMethod(scene.plot_beat);
      if (infoMethod) {
        infoMethods.push(infoMethod);
        if (infoMethod === 'anonymous_tip') anonymousTip = true;
      }

      const combined = `${scene.plot_beat} ${scene.emotional_beat}`.toLowerCase();
      if (/lluvia|sol|nieve|tormenta|viento|calor|frío|niebla|cielo/.test(combined)) {
        weatherMentioned = true;
      }
      if (/conduce|viaja|tren|avión|coche|taxi|carretera/.test(combined)) {
        travelScene = true;
      }
      if (/llama|teléfono|móvil|mensaje|sms|whatsapp/.test(combined)) {
        phoneCall = true;
      }
    }

    const firstScene = scenes[0]?.plot_beat.toLowerCase() || '';
    let opening: ChapterOpening = 'continuation';
    if (/acción|pelea|corre|dispara/.test(firstScene)) opening = 'in_media_res';
    else if (/dice|habla|—/.test(firstScene)) opening = 'dialogue';
    else if (/describe|lugar|ambiente|sol|cielo/.test(firstScene)) opening = 'description';
    else if (/piensa|recuerda|reflexiona/.test(firstScene)) opening = 'reflection';
    else if (/después|más tarde|horas/.test(firstScene)) opening = 'time_jump';
    else if (/años atrás|recordó|flashback/.test(firstScene)) opening = 'flashback';

    const hookLower = chapterHook.toLowerCase();
    let closing: ChapterClosing = 'question';
    if (/peligro|amenaza|apunta|ataca/.test(hookLower)) closing = 'cliffhanger';
    else if (/descubre|revela|verdad/.test(hookLower)) closing = 'revelation';
    else if (/decide|elige|debe/.test(hookLower)) closing = 'decision';
    else if (/llega|encuentra|alcanza/.test(hookLower)) closing = 'arrival';
    else if (/traición|engaño|mentira/.test(hookLower)) closing = 'betrayal';
    else if (/pierde|muerte|muere/.test(hookLower)) closing = 'loss';
    else if (/logra|consigue|victoria/.test(hookLower)) closing = 'victory';
    else if (/misterio|pregunta|quién|por qué/.test(hookLower)) closing = 'mystery_deepens';

    return {
      chapterNum,
      title,
      sceneSequence,
      infoMethods,
      opening,
      closing,
      emotionalArc: scenes.map(s => s.emotional_beat).join(' → '),
      primaryConflictType: this.detectConflictType(scenes),
      weatherMentioned,
      travelScene,
      phoneCall,
      anonymousTip
    };
  }

  private detectConflictType(scenes: Array<{ plot_beat: string }>): string {
    const combined = scenes.map(s => s.plot_beat).join(' ').toLowerCase();
    
    if (/pelea|ataca|dispara|combate|lucha/.test(combined)) return 'físico';
    if (/investiga|busca|analiza|pistas/.test(combined)) return 'investigación';
    if (/discute|confronta|acusa|debate/.test(combined)) return 'interpersonal';
    if (/piensa|duda|decide|dilema/.test(combined)) return 'interno';
    if (/escape|huye|persecución/.test(combined)) return 'supervivencia';
    if (/infiltra|espía|encubierto/.test(combined)) return 'infiltración';
    
    return 'mixto';
  }

  getPatterns(): ChapterPattern[] {
    return Array.from(this.patterns.values()).sort((a, b) => a.chapterNum - b.chapterNum);
  }

  clearPatterns(): void {
    this.patterns.clear();
  }

  loadFromSummaries(summaries: Array<{ chapterNum: number; title: string; summary: string }>): void {
    for (const s of summaries) {
      const mockScenes = [{
        plot_beat: s.summary,
        emotional_beat: '',
        ending_hook: ''
      }];
      const pattern = this.extractPatternFromScenes(s.chapterNum, s.title, mockScenes, '');
      this.registerPattern(pattern);
    }
    console.log(`[PatternTracker] Loaded ${summaries.length} patterns from existing summaries`);
  }
}

export const patternTrackers = new Map<number, PatternTracker>();

export function getPatternTracker(projectId: number): PatternTracker {
  if (!patternTrackers.has(projectId)) {
    patternTrackers.set(projectId, new PatternTracker(projectId));
  }
  return patternTrackers.get(projectId)!;
}

export function clearPatternTracker(projectId: number): void {
  patternTrackers.delete(projectId);
}
