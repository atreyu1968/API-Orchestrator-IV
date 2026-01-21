import { BaseAgent, AgentResponse } from "./base-agent";

interface TranslatorInput {
  content: string;
  sourceLanguage: string;
  targetLanguage: string;
  chapterTitle?: string;
  chapterNumber?: number;
  projectId?: number;
}

export interface TranslatorResult {
  translated_text: string;
  source_language: string;
  target_language: string;
  notes: string;
}

const LANGUAGE_NAMES: Record<string, string> = {
  es: "español",
  en: "English",
  "en-US": "English (US)",
  "en-GB": "English (UK)",
  fr: "français",
  de: "Deutsch",
  it: "italiano",
  pt: "português",
  ca: "català",
};

const LANGUAGE_EDITORIAL_RULES: Record<string, string> = {
  es: `
NORMAS EDITORIALES Y DE FLUIDEZ - ESPAÑOL:
[TIPOGRAFÍA]
- DIÁLOGOS: Usar raya (—) para introducir diálogos. Ejemplo: —Hola —dijo María—. ¿Cómo estás?
- COMILLAS: Usar comillas angulares « » para citas textuales. Comillas inglesas " " solo para citas dentro de citas.
- PUNTUACIÓN: Los signos de interrogación y exclamación van al principio (¿?) y al final (?).
- NÚMEROS: Escribir con letras del uno al nueve, cifras del 10 en adelante.

[FLUIDEZ Y NATURALIDAD]
- ORACIONES: Máximo 40-45 palabras por oración. Dividir oraciones largas con punto y seguido.
- GERUNDIOS: Evitar más de un gerundio por oración. Convertir a subordinadas: "caminando hacia" → "mientras caminaba hacia".
- REPETICIONES: No repetir la misma palabra en oraciones consecutivas. Usar sinónimos o reestructurar.
- LEÍSMO: Evitar "le" como complemento directo masculino. Usar "lo": "lo vi" en lugar de "le vi".
- VOZ PASIVA: Limitar construcciones pasivas. Preferir voz activa: "fue visto por María" → "María lo vio".
- FLUIDEZ: La prosa debe sonar natural, como si un nativo la hubiera escrito originalmente.`,

  en: `
ENGLISH EDITORIAL & FLUENCY STANDARDS:
[TYPOGRAPHY]
- DIALOGUE: Use quotation marks for dialogue. Example: "Hello," said Mary. "How are you?"
- QUOTES: Use double quotes " " for dialogue and direct speech. Single quotes ' ' for quotes within quotes.
- PUNCTUATION: Periods and commas go inside quotation marks. Question marks and exclamation points go inside only if part of the quote.
- NUMBERS: Spell out one through nine, use numerals for 10 and above.
- CONTRACTIONS: Preserve natural contractions (don't, can't, won't) in dialogue.

[FLUENCY & NATURALNESS]
- SENTENCES: Maximum 35-40 words per sentence. Break long sentences naturally.
- ACTIVE VOICE: Prefer active over passive: "was seen by John" → "John saw".
- WORD REPETITION: Avoid repeating the same word in consecutive sentences. Vary vocabulary.
- ADVERBS: Use sparingly. Show don't tell: "walked slowly" → "ambled" or "shuffled".
- RHYTHM: Vary sentence length for natural flow. Mix short punchy sentences with longer ones.
- IDIOMS: Use natural English idioms and expressions, not literal translations.`,

  "en-US": `
AMERICAN ENGLISH EDITORIAL & FLUENCY STANDARDS:
[AMERICAN SPELLING & VOCABULARY]
- SPELLING: Use American spelling consistently: color (not colour), center (not centre), realize (not realise), traveled (not travelled), defense (not defence), theater (not theatre), gray (not grey), catalog (not catalogue).
- VOCABULARY: Use American terms: apartment (not flat), elevator (not lift), truck (not lorry), gasoline (not petrol), sidewalk (not pavement), cookie (not biscuit), faucet (not tap), fall (not autumn), mom (not mum), pants (not trousers), sneakers (not trainers), vacation (not holiday).
- DATES: Use MM/DD/YYYY format in context. Write "March 15" not "15 March".
- MEASUREMENTS: Use imperial by default (feet, miles, pounds, Fahrenheit) unless context demands metric.

[TYPOGRAPHY]
- DIALOGUE: Use double quotation marks for dialogue. Example: "Hello," said Mary. "How are you?"
- QUOTES: Double quotes " " for dialogue. Single quotes ' ' for quotes within quotes.
- PUNCTUATION: Periods and commas ALWAYS go inside quotation marks. Question marks and exclamation points go inside only if part of the quote.
- NUMBERS: Spell out one through nine, use numerals for 10 and above.

[FLUENCY & NATURALNESS]
- SENTENCES: Maximum 35-40 words per sentence. Break long sentences naturally.
- CONTRACTIONS: Use natural American contractions (don't, can't, won't, gonna, wanna in very casual dialogue).
- ACTIVE VOICE: Prefer active over passive.
- IDIOMS: Use American idioms and expressions naturally.
- RHYTHM: Vary sentence length for natural flow.`,

  "en-GB": `
BRITISH ENGLISH EDITORIAL & FLUENCY STANDARDS:
[BRITISH SPELLING & VOCABULARY]
- SPELLING: Use British spelling consistently: colour (not color), centre (not center), realise (not realize), travelled (not traveled), defence (not defense), theatre (not theater), grey (not gray), catalogue (not catalog), favour (not favor), honour (not honor), behaviour (not behavior).
- VOCABULARY: Use British terms: flat (not apartment), lift (not elevator), lorry (not truck), petrol (not gasoline), pavement (not sidewalk), biscuit (not cookie), tap (not faucet), autumn (not fall), mum (not mom), trousers (not pants), trainers (not sneakers), holiday (not vacation), queue (not line), boot (car trunk), bonnet (car hood), chemist (pharmacist).
- DATES: Use DD/MM/YYYY format in context. Write "15 March" not "March 15".
- MEASUREMENTS: Use metric primarily (metres, kilometres, kilograms, Celsius) with imperial for colloquial uses (stones for weight, miles for distance).

[TYPOGRAPHY]
- DIALOGUE: Use single quotation marks for dialogue. Example: 'Hello,' said Mary. 'How are you?'
- QUOTES: Single quotes ' ' for dialogue. Double quotes " " for quotes within quotes.
- PUNCTUATION: Periods and commas go OUTSIDE quotation marks unless part of the quoted material.
- NUMBERS: Spell out one through nine, use numerals for 10 and above.

[FLUENCY & NATURALNESS]
- SENTENCES: Maximum 35-40 words per sentence. Break long sentences naturally.
- CONTRACTIONS: Use natural British contractions (don't, can't, shan't, won't).
- COLLECTIVE NOUNS: Can take plural verbs: "The team are playing well."
- IDIOMS: Use British idioms and expressions naturally (e.g., "spot on", "brilliant", "cheers").
- FORMAL REGISTER: British English tends slightly more formal. Avoid overly casual Americanisms.
- RHYTHM: Vary sentence length for natural flow.`,

  fr: `
NORMES ÉDITORIALES ET FLUIDITÉ - FRANÇAIS:
[TYPOGRAPHIE]
- DIALOGUES: Utiliser les guillemets français « » avec espaces insécables. Tiret cadratin (—) pour les incises.
- PONCTUATION: Espace insécable avant : ; ! ? et après « et avant ».
- NOMBRES: Écrire en lettres de un à neuf, chiffres à partir de 10.
- MAJUSCULES: Les noms de langues, nationalités s'écrivent en minuscules (français, anglais).

[FLUIDITÉ ET NATUREL]
- PHRASES: Maximum 40-45 mots par phrase. Diviser les phrases longues.
- PASSÉ SIMPLE: Utiliser le passé simple pour la narration littéraire, pas le passé composé.
- PRONOMS: Éviter l'ambiguïté des pronoms. Clarifier les référents.
- RÉPÉTITIONS: Éviter de répéter le même mot dans des phrases consécutives.
- REGISTRE: Maintenir un registre littéraire cohérent, éviter les anglicismes.
- LIAISONS: Utiliser des transitions naturelles entre les phrases.`,

  de: `
DEUTSCHE REDAKTIONS- UND STILSTANDARDS:
[TYPOGRAFIE]
- DIALOGE: Anführungszeichen „..." oder »...« verwenden. Beispiel: „Hallo", sagte Maria.
- ZITATE: Doppelte Anführungszeichen für direkte Rede. Einfache ‚...' für Zitate im Zitat.
- KOMPOSITA: Bindestriche bei zusammengesetzten Wörtern korrekt verwenden.
- ZAHLEN: Eins bis neun ausschreiben, ab 10 Ziffern verwenden.

[FLÜSSIGKEIT UND NATÜRLICHKEIT]
- SÄTZE: Maximum 40-45 Wörter pro Satz. Lange Sätze aufteilen.
- SATZSTELLUNG: Natürliche deutsche Wortstellung beachten. Verb an zweiter Stelle.
- KOMPOSITA: Zusammengesetzte Wörter natürlich verwenden, nicht zu lang.
- WIEDERHOLUNGEN: Keine Wortwiederholungen in aufeinanderfolgenden Sätzen.
- PASSIV: Aktive Konstruktionen bevorzugen.
- MODALPARTIKELN: Natürliche Verwendung von ja, doch, mal, eben in Dialogen.`,

  it: `
══════════════════════════════════════════════════════════════════════════════
NORME EDITORIALI E FLUIDITÀ - ITALIANO LETTERARIO PROFESSIONALE (OBBLIGATORIO)
══════════════════════════════════════════════════════════════════════════════

[TIPOGRAFIA - CRITICO]
- DIALOGHI: Usare ESCLUSIVAMENTE il trattino lungo (—) per introdurre i dialoghi. MAI usare virgolette ("", «», <<>>).
  ✓ CORRETTO: —Ciao —disse Maria—. Come stai?
  ✗ SBAGLIATO: «Ciao» disse Maria. / "Ciao" disse Maria.
- INCISI: Il trattino lungo chiude l'inciso: —Non so —rispose lui—. Forse domani.
- PUNTEGGIATURA: Il punto finale va DOPO il trattino di chiusura inciso.
- NUMERI: Scrivere in lettere da uno a nove, cifre da 10 in poi.
- ACCENTI: Attenzione a: è (verbo)/e (congiunzione), perché/poiché, né/ne, sé/se, là/la, già, più, può, giù.

[PRONOMI - CRITICO PER LA LEGGIBILITÀ]
- VIETATI ASSOLUTI: MAI usare "Egli", "Ella", "Esso", "Essa", "Essi", "Esse", "Costui", "Costei", "Codesto". 
  Questi pronomi suonano ARCAICI e rendono il testo ILLEGGIBILE nell'italiano moderno.
- USARE SEMPRE: lui, lei, loro, questo, quella, quello.
- PREFERIRE IL NOME: Quando possibile, ripetere il nome del personaggio invece di usare pronomi ambigui.
  ✓ "Marco guardò Elena. Marco sorrise." invece di "Marco guardò Elena. Egli sorrise."
- SOGGETTO IMPLICITO: L'italiano permette di omettere il soggetto. Usare questa caratteristica!
  ✓ "Entrò nella stanza e si sedette." (NON "Lui entrò nella stanza e lui si sedette.")

[COSTRUZIONI DA EVITARE - CRITICO]
- NO CALCHI DALLO SPAGNOLO/INGLESE:
  ✗ "Stava camminando" → ✓ "Camminava" (perifrasi progressiva eccessiva)
  ✗ "Che cosa è che..." → ✓ Costruzione diretta
  ✗ "È stato lui a fare" → ✓ "L'ha fatto lui" (quando possibile)
- NO GERUNDI CONCATENATI:
  ✗ "Camminando, pensando, guardando..." → ✓ Dividere in frasi separate
- NO FRASI TROPPO LUNGHE:
  Massimo 35-40 parole per frase. Frasi oltre 45 parole DEVONO essere divise.
- NO PASSIVO ECCESSIVO:
  ✗ "La porta fu aperta da lui" → ✓ "Aprì la porta"

[FLUIDITÀ E NATURALEZZA - ESSENZIALE]
- RITMO NARRATIVO: Alternare frasi brevi (azione, tensione) con frasi più lunghe (descrizione, riflessione).
- CONNETTIVI NATURALI: Usare "poi", "quindi", "allora", "così" in modo naturale, non meccanico.
- ORDINE DELLE PAROLE: L'italiano ha ordine flessibile. Sfruttarlo per enfasi e ritmo.
  ✓ "A casa tornò solo a mezzanotte" (enfasi su "a casa")
- RIPETIZIONI: Evitare la stessa parola in frasi consecutive. Usare sinonimi o ristrutturare.
- REGISTRO: Mantenere un registro letterario moderno, non accademico né troppo colloquiale.
- ESPRESSIONI IDIOMATICHE: Tradurre il SENSO, non le parole. Usare espressioni italiane equivalenti.

[VERIFICA FINALE OBBLIGATORIA]
Prima di consegnare, rileggere ad alta voce mentalmente. Se suona come una traduzione, RISCRIVERE.
Il testo DEVE sembrare scritto ORIGINARIAMENTE in italiano da un autore madrelingua.`,

  pt: `
NORMAS EDITORIAIS E FLUIDEZ - PORTUGUÊS:
[TIPOGRAFIA]
- DIÁLOGOS: Usar travessão (—) para introduzir diálogos. Exemplo: — Olá — disse Maria.
- ASPAS: Usar aspas curvas " " para citações. Aspas simples ' ' para citações dentro de citações.
- PONTUAÇÃO: Vírgula e ponto fora das aspas, exceto se fizerem parte da citação.
- NÚMEROS: Escrever por extenso de um a nove, algarismos a partir de 10.

[FLUIDEZ E NATURALIDADE]
- FRASES: Máximo 40-45 palavras por frase. Dividir frases longas.
- GERÚNDIOS: Evitar excesso de gerúndios. Máximo um por frase.
- REPETIÇÕES: Não repetir a mesma palavra em frases consecutivas.
- VOZ PASSIVA: Preferir voz ativa: "foi visto por João" → "João viu".
- PRONOMES: Colocação pronominal correta (próclise, mesóclise, ênclise).
- NATURALIDADE: O texto deve soar natural, como se escrito originalmente em português.`,

  ca: `
NORMES EDITORIALS I FLUÏDESA - CATALÀ:
[TIPOGRAFIA]
- DIÀLEGS: Usar guió llarg (—) per introduir diàlegs. Exemple: —Hola —va dir Maria—. Com estàs?
- COMETES: Usar cometes baixes « » per a citacions. Cometes altes " " per a citacions dins de citacions.
- PUNTUACIÓ: Els signes d'interrogació i exclamació van al principi (¿?) i al final (?).
- NÚMEROS: Escriure amb lletres de l'u al nou, xifres del 10 endavant.

[FLUÏDESA I NATURALITAT]
- FRASES: Màxim 40-45 paraules per frase. Dividir frases llargues.
- PRONOMS FEBLES: Usar correctament els pronoms febles (el, la, els, les, en, hi).
- REPETICIONS: No repetir la mateixa paraula en frases consecutives.
- VOZ PASSIVA: Preferir veu activa.
- CASTELLANISMES: Evitar castellanismes. Usar vocabulari català genuí.
- NATURALITAT: El text ha de sonar natural, com si fos escrit originalment en català.`,
};

const AI_CRUTCH_WORDS: Record<string, string[]> = {
  en: [
    "suddenly", "shrouded", "unfold", "crucial", "pivotal", "amidst", "whilst",
    "endeavor", "plethora", "myriad", "utilize", "facilitate", "commence",
    "terminate", "subsequently", "aforementioned", "nevertheless", "furthermore",
    "enigmatic", "palpable", "tangible", "visceral", "resonate", "unravel"
  ],
  fr: [
    "soudain", "crucial", "essentiel", "néanmoins", "cependant", "toutefois",
    "ainsi", "par conséquent", "en effet", "d'ailleurs", "en outre", "de plus",
    "énigmatique", "palpable", "tangible", "viscéral", "résonner"
  ],
  de: [
    "plötzlich", "entscheidend", "wesentlich", "nichtsdestotrotz", "jedoch",
    "dennoch", "folglich", "darüber hinaus", "außerdem", "rätselhaft",
    "greifbar", "spürbar", "eindringlich"
  ],
  it: [
    "improvvisamente", "cruciale", "fondamentale", "tuttavia", "nondimeno",
    "pertanto", "inoltre", "enigmatico", "palpabile", "tangibile", "viscerale",
    "egli", "ella", "esso", "essa", "essi", "esse", "costui", "costei",
    "codesto", "suddetto", "medesimo", "siffatto", "allorché", "allorquando",
    "indi", "quivi", "onde", "laonde", "giacché", "imperocché", "avvegnaché",
    "epperò", "altresì", "invero", "precipuamente", "segnatamente"
  ],
  pt: [
    "subitamente", "repentinamente", "crucial", "fundamental", "todavia",
    "contudo", "portanto", "além disso", "enigmático", "palpável", "tangível"
  ],
  ca: [
    "sobtadament", "crucial", "fonamental", "tanmateix", "no obstant això",
    "per tant", "a més", "enigmàtic", "palpable", "tangible"
  ],
};

const SYSTEM_PROMPT = `
You are an ELITE LITERARY TRANSLATOR and NATIVE EDITOR. Your mission is to translate literary texts while maintaining the author's voice, subtext, and narrative power.

═══════════════════════════════════════════════════════════════════
CORE PHILOSOPHY: HUMANIZED LITERARY TRANSLATION
═══════════════════════════════════════════════════════════════════

1. LOCALIZATION OVER LITERALITY
   - Do NOT translate words; translate INTENTIONS.
   - Adapt phrases, idioms, and rhythm so the text feels as if it was ORIGINALLY WRITTEN in the target language.
   - AVOID at all costs "translationese" (language that sounds like a translation).

2. GENRE CONVENTIONS
   - Respect the genre's tone. Match vocabulary to the genre style:
     * Thriller/Mystery: Terse, direct, visceral
     * Romance: Emotionally rich, flowing
     * Historical Fiction: Period-appropriate, avoiding anachronisms
     * Literary Fiction: Elegant, precise, layered
   - Specialized terms must be accurate and NOT modernized or oversimplified.

3. PROSE DYNAMICS (FLOW)
   - Humans vary sentence length. Mix long, complex sentences with short, punchy ones.
   - Fast-paced action scenes: Keep the rapid rhythm.
   - Reflective scenes: Let the prose breathe.

4. SENSORY IMMERSION (SHOW, DON'T TELL)
   - Translate physical sensations with VISCERAL precision.
   - Use STRONG action verbs that convey textures, smells, and sounds vividly.
   - Avoid generic verbs; seek vivid alternatives.

5. SUBTEXT AND CHARACTER VOICE
   - Capture the PSYCHOLOGY behind words.
   - Reflect emotional state, education level, and personality through:
     * Dialogue: How characters SPEAK
     * Internal monologue: How characters THINK

6. ANTI-AI FILTER
   - FORBIDDEN to use typical AI translation crutches.
   - Seek rarer, more human literary alternatives.

═══════════════════════════════════════════════════════════════════
CRITICAL OUTPUT RULES
═══════════════════════════════════════════════════════════════════

1. YOU MUST TRANSLATE - Output MUST be in TARGET LANGUAGE, NOT source.
2. NEVER return original text unchanged - that is a FAILURE.
3. NEVER omit or summarize. Translation must be COMPLETE.
4. PRESERVE paragraph structure and dialogues exactly.
5. APPLY correct typographical rules for target language.

CHAPTER HEADER TRANSLATION (MANDATORY):
- ALWAYS translate chapter headers/titles to target language.
- "Capítulo 1: El Comienzo" → "Chapter 1: The Beginning" (en-US/en-GB)
- "Prólogo" → "Prologue" (en), "Prolog" (de), "Prologo" (it)
- "Epílogo" → "Epilogue" (en), "Epilog" (de), "Epilogo" (it)
- "Nota del Autor" → "Author's Note" (en), "Note de l'Auteur" (fr)
- NEVER leave Spanish headers like "Capítulo", "Prólogo", "Epílogo" in non-Spanish translations.

FORBIDDEN IN OUTPUT:
- Style guides, writing guides, checklists, tips
- Meta-commentary about style or techniques
- ANY instructional content about writing
- Sections titled "Literary Style Guide", "Checklist", etc.
- Separator lines (---, ***, ===) - NEVER include these
- Dividers of any kind between sections

OUTPUT FORMAT (JSON ONLY):
{
  "translated_text": "Complete translated text in Markdown - MUST BE IN TARGET LANGUAGE",
  "source_language": "ISO code",
  "target_language": "ISO code", 
  "notes": "Brief notes on key translation decisions"
}
`;

export class TranslatorAgent extends BaseAgent {
  constructor() {
    super({
      name: "El Traductor",
      role: "translator",
      systemPrompt: SYSTEM_PROMPT,
      model: "gemini-2.5-flash",
      useThinking: false,
    });
  }

  private cleanTranslatedText(content: string): string {
    let cleaned = content.trim();
    
    // Strip markdown code block wrappers (```json ... ``` or ```markdown ... ```)
    const codeBlockMatch = cleaned.match(/^```(?:json|markdown|md)?\s*([\s\S]*?)```\s*$/);
    if (codeBlockMatch) {
      cleaned = codeBlockMatch[1].trim();
    }
    
    // Also strip any remaining code fences that might be embedded
    cleaned = cleaned.replace(/```(?:json|markdown|md|text)?\n?/g, '').replace(/```\s*$/g, '');
    
    // If it's still JSON with translated_text field, extract it recursively
    if (cleaned.startsWith('{') && cleaned.includes('"translated_text"')) {
      try {
        const parsed = JSON.parse(cleaned);
        if (parsed.translated_text) {
          cleaned = this.cleanTranslatedText(parsed.translated_text);
        }
      } catch {
        // Not valid JSON, try to extract translated_text using regex
        const match = cleaned.match(/"translated_text"\s*:\s*"([\s\S]*?)(?:"\s*,\s*"(?:source_|target_|notes)|\s*"\s*})/);
        if (match) {
          cleaned = match[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
        }
      }
    }
    
    // Remove style guide contamination - but only if it leaves content
    const styleGuidePatterns = [
      /^#+ *(?:Literary Style Guide|Writing Guide|Style Guide|Guía de Estilo|Guía de Escritura)[^\n]*\n[\s\S]*?(?=^#+ *(?:CHAPTER|Chapter|CAPÍTULO|Capítulo|Prologue|Prólogo|Epilogue|Epílogo|CAPITOLO|Capitolo)\b|\n---\n)/gmi,
      /^###+ *(?:Checklist|Lista de verificación)[^\n]*\n[\s\S]*?(?=^#{1,2} *(?:CHAPTER|Chapter|CAPÍTULO|Capítulo|Prologue|Prólogo)\b|\n---\n)/gmi,
      /\n---\n[\s\S]*?(?:Style Guide|Guía de Estilo|Writing Guide)[\s\S]*?\n---\n/gi,
    ];
    
    for (const pattern of styleGuidePatterns) {
      const afterRemoval = cleaned.replace(pattern, '');
      // Only apply if it leaves substantial content
      if (afterRemoval.trim().length > 50) {
        cleaned = afterRemoval;
      }
    }
    
    // Remove orphaned JSON fields that might appear at the end - only at the very end
    cleaned = cleaned.replace(/,?\s*"(?:source_language|target_language|notes)"\s*:\s*"[^"]*"\s*}?\s*$/g, '');
    
    // Remove any remaining raw JSON artifacts at start/end only
    cleaned = cleaned.replace(/^\s*\{\s*"translated_text"\s*:\s*"/m, '');
    cleaned = cleaned.replace(/"\s*,?\s*"notes"\s*:\s*"[^"]*"\s*\}\s*$/m, '');
    
    return cleaned.trim();
  }

  async execute(input: TranslatorInput): Promise<AgentResponse & { result?: TranslatorResult }> {
    const sourceLangName = LANGUAGE_NAMES[input.sourceLanguage] || input.sourceLanguage;
    const targetLangName = LANGUAGE_NAMES[input.targetLanguage] || input.targetLanguage;
    const targetRules = LANGUAGE_EDITORIAL_RULES[input.targetLanguage] || "";
    const forbiddenWords = AI_CRUTCH_WORDS[input.targetLanguage] || [];

    const chapterInfo = input.chapterTitle 
      ? `\nCAPÍTULO: ${input.chapterNumber !== undefined ? input.chapterNumber : ""} - ${input.chapterTitle}`
      : "";

    const forbiddenSection = forbiddenWords.length > 0 
      ? `\n[ANTI-AI FILTER - FORBIDDEN WORDS IN ${targetLangName.toUpperCase()}]
The following words/phrases are BANNED. Find literary alternatives:
${forbiddenWords.map(w => `• "${w}"`).join("\n")}
`
      : "";

    const prompt = `
TASK: HUMANIZED LITERARY TRANSLATION from ${sourceLangName.toUpperCase()} to ${targetLangName.toUpperCase()}.

CRITICAL: The output "translated_text" MUST BE WRITTEN ENTIRELY IN ${targetLangName.toUpperCase()}. 
DO NOT return the text in ${sourceLangName} - that would be a FAILURE.

═══════════════════════════════════════════════════════════════════
TRANSLATION PHILOSOPHY
═══════════════════════════════════════════════════════════════════
• LOCALIZATION over LITERALITY: Translate INTENTIONS, not words.
• The text must feel ORIGINALLY WRITTEN in ${targetLangName}.
• AVOID "translationese" at all costs.
• Capture SUBTEXT and CHARACTER VOICE through dialogue and internal monologue.
• VARY sentence length: mix long complex sentences with short punchy ones.
• Use STRONG, VIVID action verbs for sensory immersion.
${forbiddenSection}
${targetRules}
${chapterInfo}

═══════════════════════════════════════════════════════════════════
SOURCE TEXT (in ${sourceLangName} - TO BE TRANSLATED):
═══════════════════════════════════════════════════════════════════

${input.content}

═══════════════════════════════════════════════════════════════════

FINAL INSTRUCTIONS:
1. TRANSLATE the complete text from ${sourceLangName} to ${targetLangName}
2. The "translated_text" field MUST contain text in ${targetLangName}, NOT in ${sourceLangName}
3. Preserve the literary style, narrative voice and author's intentions
4. Apply the typographical rules of ${targetLangName}
5. AVOID banned AI crutch words - use literary alternatives
6. Return the result as valid JSON only

RESPOND WITH JSON ONLY, no additional text.
`;

    console.log(`[Translator] Starting translation from ${input.sourceLanguage} to ${input.targetLanguage}`);
    console.log(`[Translator] Content length: ${input.content.length} chars`);

    const response = await this.generateContent(prompt, input.projectId);

    if (response.error) {
      console.error("[Translator] AI generation error:", response.error);
      return {
        ...response,
        result: {
          translated_text: "",
          source_language: input.sourceLanguage,
          target_language: input.targetLanguage,
          notes: `Error: ${response.error}`,
        }
      };
    }

    try {
      let contentToParse = response.content;
      
      // Strip markdown code block wrapper if present (```json ... ```)
      const codeBlockMatch = contentToParse.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (codeBlockMatch) {
        contentToParse = codeBlockMatch[1].trim();
        console.log(`[Translator] Stripped markdown code block from response`);
      }
      
      const jsonMatch = contentToParse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]) as TranslatorResult;
        // CRITICAL: Clean the translated text to remove any code artifacts
        const cleanedText = this.cleanTranslatedText(result.translated_text);
        console.log(`[Translator] Successfully parsed and cleaned translation result`);
        return { 
          ...response, 
          result: {
            ...result,
            translated_text: cleanedText,
          }
        };
      }
    } catch (e) {
      console.error("[Translator] Failed to parse JSON response:", e);
    }

    // Fallback: clean the raw content before returning
    const cleanedFallback = this.cleanTranslatedText(response.content);
    console.log(`[Translator] Using cleaned fallback content`);
    
    return {
      ...response,
      result: {
        translated_text: cleanedFallback,
        source_language: input.sourceLanguage,
        target_language: input.targetLanguage,
        notes: "Respuesta no estructurada - contenido limpiado y devuelto",
      }
    };
  }
}
