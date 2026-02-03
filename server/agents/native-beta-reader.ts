// LitAgents 2.1 - Native Beta Reader Agent
// Analyzes translated text as a native speaker of the target language
// Provides genre-aware corrections in the target language

import OpenAI from 'openai';
import { calculateRealCost, formatCostForStorage } from '../cost-calculator';
import { storage } from '../storage';

export interface NativeBetaReaderResult {
  overall_score: number;
  fluency_score: number;
  genre_adherence_score: number;
  cultural_adaptation_score: number;
  issues: NativeIssue[];
  corrections: NativeCorrection[];
  genre_feedback: string;
  cultural_notes: string[];
  final_verdict: 'APPROVED' | 'NEEDS_REVISION' | 'MAJOR_REWRITE';
}

export interface NativeIssue {
  type: 'GRAMMAR' | 'IDIOM' | 'REGISTER' | 'GENRE_MISMATCH' | 'CULTURAL_AWKWARD' | 'FLOW' | 'DIALOGUE';
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  location: string;
  description: string;
  suggestion: string;
}

export interface NativeCorrection {
  original: string;
  corrected: string;
  reason: string;
}

interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
}

const GENRE_EXPECTATIONS: Record<string, Record<string, string>> = {
  en: {
    'romance': 'Expect emotional depth, sensory language, intimate moments. Dialogue should feel natural and charged with tension or tenderness.',
    'fantasy': 'Expect rich world-building language, epic tone, formal dialogue for nobility. Action scenes should be vivid and dynamic.',
    'mystery': 'Expect tight pacing, atmospheric descriptions, precise clues. Dialogue should reveal character while hiding information.',
    'thriller': 'Expect punchy sentences, constant tension, urgent pacing. Short paragraphs, sharp dialogue.',
    'sci-fi': 'Expect technical plausibility, speculative concepts explained naturally. Balance exposition with action.',
    'horror': 'Expect building dread, sensory unease, psychological tension. Avoid over-explaining the threat.',
    'literary': 'Expect nuanced prose, thematic depth, character introspection. Language should be precise and evocative.',
    'historical': 'Expect period-appropriate language without being archaic. Historical details should feel natural, not forced.',
    'default': 'Expect clear, engaging prose appropriate to the story being told.'
  },
  es: {
    'romance': 'Esperar profundidad emocional, lenguaje sensorial, momentos íntimos. El diálogo debe sentirse natural y cargado de tensión o ternura.',
    'fantasy': 'Esperar lenguaje rico en construcción de mundos, tono épico, diálogo formal para la nobleza. Las escenas de acción deben ser vívidas y dinámicas.',
    'mystery': 'Esperar ritmo ajustado, descripciones atmosféricas, pistas precisas. El diálogo debe revelar personaje mientras oculta información.',
    'thriller': 'Esperar frases contundentes, tensión constante, ritmo urgente. Párrafos cortos, diálogo afilado.',
    'sci-fi': 'Esperar plausibilidad técnica, conceptos especulativos explicados naturalmente. Equilibrar exposición con acción.',
    'horror': 'Esperar pavor creciente, inquietud sensorial, tensión psicológica. Evitar explicar demasiado la amenaza.',
    'literary': 'Esperar prosa matizada, profundidad temática, introspección de personajes. El lenguaje debe ser preciso y evocador.',
    'historical': 'Esperar lenguaje apropiado a la época sin ser arcaico. Los detalles históricos deben sentirse naturales.',
    'default': 'Esperar prosa clara y atractiva apropiada para la historia que se cuenta.'
  },
  fr: {
    'romance': 'Attendre une profondeur émotionnelle, un langage sensoriel, des moments intimes. Le dialogue doit sembler naturel et chargé de tension.',
    'fantasy': 'Attendre un langage riche en construction de mondes, un ton épique. Les scènes d\'action doivent être vives et dynamiques.',
    'mystery': 'Attendre un rythme serré, des descriptions atmosphériques, des indices précis. Le dialogue doit révéler le caractère tout en cachant des informations.',
    'thriller': 'Attendre des phrases percutantes, une tension constante, un rythme urgent. Paragraphes courts, dialogues incisifs.',
    'sci-fi': 'Attendre une plausibilité technique, des concepts spéculatifs expliqués naturellement. Équilibrer l\'exposition avec l\'action.',
    'horror': 'Attendre une terreur croissante, un malaise sensoriel, une tension psychologique. Éviter de trop expliquer la menace.',
    'literary': 'Attendre une prose nuancée, une profondeur thématique, une introspection des personnages. Le langage doit être précis et évocateur.',
    'historical': 'Attendre un langage approprié à l\'époque sans être archaïque. Les détails historiques doivent sembler naturels.',
    'default': 'Attendre une prose claire et engageante appropriée à l\'histoire racontée.'
  },
  de: {
    'romance': 'Erwarten Sie emotionale Tiefe, sinnliche Sprache, intime Momente. Der Dialog sollte sich natürlich anfühlen.',
    'fantasy': 'Erwarten Sie reichhaltige Weltenbau-Sprache, epischen Ton. Actionszenen sollten lebendig und dynamisch sein.',
    'mystery': 'Erwarten Sie ein straffes Tempo, atmosphärische Beschreibungen, präzise Hinweise. Der Dialog sollte Charakter enthüllen.',
    'thriller': 'Erwarten Sie prägnante Sätze, ständige Spannung, dringendes Tempo. Kurze Absätze, scharfe Dialoge.',
    'sci-fi': 'Erwarten Sie technische Plausibilität, spekulativ erklärte Konzepte. Exposition mit Action ausbalancieren.',
    'horror': 'Erwarten Sie aufbauende Angst, sensorisches Unbehagen, psychologische Spannung. Die Bedrohung nicht übererklären.',
    'literary': 'Erwarten Sie nuancierte Prosa, thematische Tiefe, Charakterintrospektion. Die Sprache sollte präzise und evokativ sein.',
    'historical': 'Erwarten Sie epochengerechte Sprache ohne archaisch zu sein. Historische Details sollten sich natürlich anfühlen.',
    'default': 'Erwarten Sie klare, ansprechende Prosa, die der erzählten Geschichte angemessen ist.'
  },
  it: {
    'romance': 'Aspettarsi profondità emotiva, linguaggio sensoriale, momenti intimi. Il dialogo deve sembrare naturale.',
    'fantasy': 'Aspettarsi un linguaggio ricco per la costruzione del mondo, tono epico. Le scene d\'azione devono essere vivide.',
    'mystery': 'Aspettarsi un ritmo serrato, descrizioni atmosferiche, indizi precisi. Il dialogo deve rivelare il carattere.',
    'thriller': 'Aspettarsi frasi incisive, tensione costante, ritmo urgente. Paragrafi brevi, dialoghi taglienti.',
    'sci-fi': 'Aspettarsi plausibilità tecnica, concetti speculativi spiegati naturalmente. Bilanciare esposizione e azione.',
    'horror': 'Aspettarsi terrore crescente, disagio sensoriale, tensione psicologica. Evitare di spiegare troppo la minaccia.',
    'literary': 'Aspettarsi prosa sfumata, profondità tematica, introspezione dei personaggi. Il linguaggio deve essere preciso.',
    'historical': 'Aspettarsi un linguaggio appropriato all\'epoca senza essere arcaico. I dettagli storici devono sembrare naturali.',
    'default': 'Aspettarsi una prosa chiara e coinvolgente appropriata alla storia raccontata.'
  },
  pt: {
    'romance': 'Esperar profundidade emocional, linguagem sensorial, momentos íntimos. O diálogo deve parecer natural.',
    'fantasy': 'Esperar linguagem rica em construção de mundos, tom épico. Cenas de ação devem ser vívidas e dinâmicas.',
    'mystery': 'Esperar ritmo ajustado, descrições atmosféricas, pistas precisas. O diálogo deve revelar personagem.',
    'thriller': 'Esperar frases contundentes, tensão constante, ritmo urgente. Parágrafos curtos, diálogos afiados.',
    'sci-fi': 'Esperar plausibilidade técnica, conceitos especulativos explicados naturalmente. Equilibrar exposição com ação.',
    'horror': 'Esperar terror crescente, desconforto sensorial, tensão psicológica. Evitar explicar demais a ameaça.',
    'literary': 'Esperar prosa matizada, profundidade temática, introspecção de personagens. A linguagem deve ser precisa.',
    'historical': 'Esperar linguagem apropriada à época sem ser arcaica. Os detalhes históricos devem parecer naturais.',
    'default': 'Esperar prosa clara e envolvente apropriada à história contada.'
  },
  ca: {
    'romance': 'Esperar profunditat emocional, llenguatge sensorial, moments íntims. El diàleg ha de semblar natural.',
    'fantasy': 'Esperar llenguatge ric en construcció de mons, to èpic. Les escenes d\'acció han de ser vívides.',
    'mystery': 'Esperar ritme ajustat, descripcions atmosfèriques, pistes precises. El diàleg ha de revelar caràcter.',
    'thriller': 'Esperar frases contundents, tensió constant, ritme urgent. Paràgrafs curts, diàlegs afilats.',
    'sci-fi': 'Esperar plausibilitat tècnica, conceptes especulatius explicats naturalment. Equilibrar exposició amb acció.',
    'horror': 'Esperar terror creixent, inquietud sensorial, tensió psicològica. Evitar explicar massa l\'amenaça.',
    'literary': 'Esperar prosa matisada, profunditat temàtica, introspecció de personatges. El llenguatge ha de ser precís.',
    'historical': 'Esperar llenguatge apropiat a l\'època sense ser arcaic. Els detalls històrics han de semblar naturals.',
    'default': 'Esperar prosa clara i atractiva apropiada per a la història que s\'explica.'
  }
};

const LANGUAGE_NATIVE_RULES: Record<string, string> = {
  en: `
As a NATIVE English reader and literary critic, evaluate this translated text:

FOCUS AREAS:
1. NATURAL FLOW: Does it read like it was written in English, not translated?
2. IDIOM: Are expressions natural? No "translationese" or calques from other languages.
3. REGISTER: Is the formality level consistent and appropriate?
4. DIALOGUE: Does spoken language feel authentic? Natural contractions, rhythm?
5. CULTURAL: Are references adapted or explained appropriately?

COMMON TRANSLATION ERRORS IN ENGLISH:
- Over-formal language where casual would be natural
- Missing contractions in dialogue ("I am" vs "I'm")
- Awkward word order from source language syntax
- Literal translations of idioms
- Incorrect article usage (a/an/the)
- Comma splices and run-on sentences
`,
  es: `
Como LECTOR NATIVO español y crítico literario, evalúa este texto traducido:

ÁREAS DE ENFOQUE:
1. FLUIDEZ NATURAL: ¿Se lee como si hubiera sido escrito en español, no traducido?
2. EXPRESIONES: ¿Son naturales? Sin "traduccionismo" ni calcos de otros idiomas.
3. REGISTRO: ¿El nivel de formalidad es consistente y apropiado?
4. DIÁLOGOS: ¿El lenguaje hablado suena auténtico? ¿Rayas correctas, ritmo natural?
5. CULTURAL: ¿Las referencias están adaptadas o explicadas apropiadamente?

ERRORES COMUNES EN TRADUCCIONES AL ESPAÑOL:
- Abuso de la voz pasiva (calco del inglés)
- Gerundios encadenados ("estaba caminando, pensando...")
- "Hacer sentido" en lugar de "tener sentido"
- Uso incorrecto de tú/usted o inconsistencias
- Leísmo/laísmo incorrecto
- Comillas en diálogos en lugar de rayas
- Oraciones demasiado largas sin pausas naturales
`,
  fr: `
En tant que LECTEUR NATIF français et critique littéraire, évaluez ce texte traduit:

DOMAINES D'INTÉRÊT:
1. FLUIDITÉ NATURELLE: Se lit-il comme s'il avait été écrit en français?
2. EXPRESSIONS: Sont-elles naturelles? Pas de "traductionisme".
3. REGISTRE: Le niveau de formalité est-il cohérent?
4. DIALOGUES: Le langage parlé semble-t-il authentique?
5. CULTUREL: Les références sont-elles adaptées?

ERREURS COURANTES:
- Anglicismes et calques
- Guillemets au lieu de tirets pour les dialogues
- Temps verbaux incorrects
`,
  de: `
Als MUTTERSPRACHLICHER deutscher Leser und Literaturkritiker bewerten Sie diesen übersetzten Text:

SCHWERPUNKTE:
1. NATÜRLICHER FLUSS: Liest es sich wie auf Deutsch geschrieben?
2. IDIOME: Sind Ausdrücke natürlich? Kein "Übersetzungsdeutsch".
3. REGISTER: Ist die Formalitätsebene konsistent?
4. DIALOGE: Klingt die gesprochene Sprache authentisch?
5. KULTURELL: Sind Referenzen angepasst?
`,
  it: `
Come LETTORE NATIVO italiano e critico letterario, valuta questo testo tradotto:

AREE DI FOCUS:
1. FLUSSO NATURALE: Si legge come se fosse stato scritto in italiano?
2. ESPRESSIONI: Sono naturali? Nessun "traduttese".
3. REGISTRO: Il livello di formalità è coerente?
4. DIALOGHI: Il linguaggio parlato sembra autentico?
5. CULTURALE: I riferimenti sono adattati?
`,
  pt: `
Como LEITOR NATIVO português e crítico literário, avalie este texto traduzido:

ÁREAS DE FOCO:
1. FLUXO NATURAL: Lê-se como se tivesse sido escrito em português?
2. EXPRESSÕES: São naturais? Sem "tradutês".
3. REGISTRO: O nível de formalidade é consistente?
4. DIÁLOGOS: A linguagem falada parece autêntica?
5. CULTURAL: As referências estão adaptadas?
`,
  ca: `
Com a LECTOR NATIU català i crític literari, avalua aquest text traduït:

ÀREES D'ENFOCAMENT:
1. FLUÏDESA NATURAL: Es llegeix com si s'hagués escrit en català?
2. EXPRESSIONS: Són naturals? Cap "traduccionisme".
3. REGISTRE: El nivell de formalitat és consistent?
4. DIÀLEGS: El llenguatge parlat sembla autèntic?
5. CULTURAL: Les referències estan adaptades?
`
};

export class NativeBetaReaderAgent {
  private client: OpenAI;
  private model: string = 'deepseek-chat';

  constructor() {
    const apiKey = process.env.DEEPSEEK_TRANSLATOR_API_KEY || process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      throw new Error('DEEPSEEK_API_KEY is not configured');
    }
    this.client = new OpenAI({
      apiKey,
      baseURL: 'https://api.deepseek.com'
    });
  }

  private getGenreExpectations(targetLang: string, genre: string): string {
    const langCode = targetLang.substring(0, 2).toLowerCase();
    const langExpectations = GENRE_EXPECTATIONS[langCode] || GENRE_EXPECTATIONS['en'];
    const normalizedGenre = genre?.toLowerCase() || 'default';
    return langExpectations[normalizedGenre] || langExpectations['default'];
  }

  private getNativeRules(targetLang: string): string {
    const langCode = targetLang.substring(0, 2).toLowerCase();
    return LANGUAGE_NATIVE_RULES[langCode] || LANGUAGE_NATIVE_RULES['en'];
  }

  async reviewTranslation(
    translationId: number,
    translatedText: string,
    targetLang: string,
    genre: string = 'default',
    chunkNumber?: number
  ): Promise<{ result: NativeBetaReaderResult; tokenUsage: TokenUsage }> {
    console.log(`[NativeBetaReader] Reviewing translation ${translationId} in ${targetLang} (genre: ${genre})...`);

    const nativeRules = this.getNativeRules(targetLang);
    const genreExpectations = this.getGenreExpectations(targetLang, genre);

    const prompt = `${nativeRules}

GENRE EXPECTATIONS (${genre.toUpperCase()}):
${genreExpectations}

TEXT TO REVIEW (first 3000 chars):
"""
${translatedText.substring(0, 3000)}
"""

ANALYZE as a native ${targetLang} reader and provide your assessment in JSON format:

{
  "overall_score": <1-10, 10 being perfect native quality>,
  "fluency_score": <1-10, how naturally it reads>,
  "genre_adherence_score": <1-10, how well it matches genre expectations>,
  "cultural_adaptation_score": <1-10, how well cultural references are handled>,
  "issues": [
    {
      "type": "<GRAMMAR|IDIOM|REGISTER|GENRE_MISMATCH|CULTURAL_AWKWARD|FLOW|DIALOGUE>",
      "severity": "<HIGH|MEDIUM|LOW>",
      "location": "<quote the problematic text>",
      "description": "<explain the issue in ${targetLang}>",
      "suggestion": "<provide the correct version in ${targetLang}>"
    }
  ],
  "corrections": [
    {
      "original": "<exact text to replace>",
      "corrected": "<corrected version>",
      "reason": "<brief reason in ${targetLang}>"
    }
  ],
  "genre_feedback": "<overall feedback about genre adherence in ${targetLang}>",
  "cultural_notes": ["<any cultural adaptation notes in ${targetLang}>"],
  "final_verdict": "<APPROVED|NEEDS_REVISION|MAJOR_REWRITE>"
}

⚠️ CRITICAL LANGUAGE REQUIREMENT - MANDATORY:
- You MUST write ALL feedback, descriptions, issues, suggestions, corrections, and notes in ${targetLang} ONLY
- The "description", "suggestion", "corrected", "reason", "genre_feedback", and "cultural_notes" fields MUST be in ${targetLang}
- Do NOT write any feedback in English (unless ${targetLang} is English)
- Focus on issues a NATIVE ${targetLang} speaker would notice
- Prioritize issues that break immersion or feel unnatural to native readers
- Provide ACTIONABLE corrections that can be applied directly to the text
- If the text reads naturally for a native ${targetLang} reader, give high scores and minimal issues`;

    try {
      const response = await this.client.chat.completions.create({
        messages: [{ role: 'user', content: prompt }],
        model: this.model,
        temperature: 0.4,
      });

      const tokenUsage: TokenUsage = {
        inputTokens: response.usage?.prompt_tokens || 0,
        outputTokens: response.usage?.completion_tokens || 0,
        thinkingTokens: 0,
      };

      const content = response.choices[0]?.message?.content || '{}';
      const jsonStr = content.replace(/```json|```/g, '').trim();
      
      let result: NativeBetaReaderResult;
      try {
        const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          result = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error('No JSON found in response');
        }
      } catch (e) {
        console.error('[NativeBetaReader] Failed to parse response:', e);
        result = {
          overall_score: 7,
          fluency_score: 7,
          genre_adherence_score: 7,
          cultural_adaptation_score: 7,
          issues: [],
          corrections: [],
          genre_feedback: 'Error parsing native reader feedback',
          cultural_notes: [],
          final_verdict: 'NEEDS_REVISION'
        };
      }

      await this.logUsage(translationId, tokenUsage, chunkNumber);

      console.log(`[NativeBetaReader] Review complete. Verdict: ${result.final_verdict}, Score: ${result.overall_score}/10`);
      return { result, tokenUsage };

    } catch (error) {
      console.error('[NativeBetaReader] API call failed:', error);
      throw error;
    }
  }

  async applyCorrections(
    text: string,
    corrections: NativeCorrection[]
  ): Promise<string> {
    let correctedText = text;
    let appliedCount = 0;

    for (const correction of corrections) {
      if (correctedText.includes(correction.original)) {
        correctedText = correctedText.replace(correction.original, correction.corrected);
        appliedCount++;
      }
    }

    console.log(`[NativeBetaReader] Applied ${appliedCount}/${corrections.length} corrections`);
    return correctedText;
  }

  private async logUsage(translationId: number, usage: TokenUsage, chunkNumber?: number) {
    try {
      const costs = calculateRealCost(
        this.model,
        usage.inputTokens,
        usage.outputTokens,
        0
      );
      await storage.createAiUsageEvent({
        translationId,
        agentName: 'native-beta-reader',
        model: this.model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        thinkingTokens: 0,
        inputCostUsd: formatCostForStorage(costs.inputCost),
        outputCostUsd: formatCostForStorage(costs.outputCost),
        totalCostUsd: formatCostForStorage(costs.totalCost),
        chapterNumber: chunkNumber,
        operation: 'native-review',
      });
    } catch (err) {
      console.error('[NativeBetaReader] Failed to log usage:', err);
    }
  }
}
