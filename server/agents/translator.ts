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
NORME EDITORIALI E FLUIDITÀ - ITALIANO (OBBLIGATORIO):
[TIPOGRAFIA - CRITICO]
- DIALOGHI: Usare ESCLUSIVAMENTE il trattino lungo (—) per introdurre i dialoghi. MAI usare virgolette di nessun tipo ("", «», <<>>).
  Esempio corretto: —Ciao —disse Maria—. Come stai?
  Esempio SBAGLIATO: «Ciao» disse Maria. / "Ciao" disse Maria.
- INCISI: Il trattino lungo chiude l'inciso e ne apre un altro dopo l'attribuzione.
  Esempio: —Non so —rispose lui—. Forse domani.
- PUNTEGGIATURA: Il punto finale va DOPO il trattino di chiusura inciso.
- NUMERI: Scrivere in lettere da uno a nove, cifre da 10 in poi.
- ACCENTI: Attenzione agli accenti gravi (è, à) e acuti (é, perché).
- CONSISTENZA: Se nel testo originale ci sono "«»", '""' o '<<>>', convertili TUTTI a trattini lunghi (—).

[FLUIDITÀ E NATURALEZZA - CRITICO]
- PRONOMI ARCAICI: MAI usare "Egli", "Ella", "Esso", "Essa", "Essi", "Esse". Usare SEMPRE il nome proprio o pronomi moderni (lui, lei, loro).
- FRASI: Massimo 40-45 parole per frase. Le frasi oltre 50 parole DEVONO essere divise.
- RIPETIZIONI LESSICALI: Non ripetere la stessa parola in frasi consecutive. Usare sinonimi o ristrutturare.
- PASSIVO: Limitare la voce passiva. Preferire costruzioni attive.
- GERUNDI: Evitare catene di gerundi. Massimo uno per frase.
- RITMO: Alternare frasi brevi e lunghe per un ritmo narrativo naturale.
- NATURALEZZA: Il testo deve suonare come se fosse stato scritto originariamente in italiano da un madrelingua.`,

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

const SYSTEM_PROMPT = `
You are an ELITE PROFESSIONAL LITERARY TRANSLATOR. Your ONLY job is to translate literary texts from one language to another.

CRITICAL RULES:
1. YOU MUST TRANSLATE - The output text MUST be in the TARGET LANGUAGE, NOT the source language.
2. NEVER return the original text unchanged - that is a FAILURE.
3. Preserve the literary style, narrative voice and tone of the original author.
4. The translation must sound natural in the target language, as if it was originally written in that language.
5. Adapt cultural expressions to the most appropriate equivalent in the target language.
6. Keep proper names of characters and places in their original form, unless they have an established translation.
7. NEVER omit or summarize content. The translation must be COMPLETE.
8. PRESERVE paragraph structure and dialogues.
9. APPLY correct typographical rules for the target language (quotation marks, dialogue dashes, etc.).

FORBIDDEN - DO NOT INCLUDE IN OUTPUT:
- Style guides or writing guides of any kind
- Meta-commentary about the author's style or techniques
- Checklists, tips, or instructions about writing
- Sections titled "Literary Style Guide", "Writing Guide", "Checklist", etc.
- ANY instructional or educational content about writing techniques

Your output must contain ONLY the translated narrative text, nothing else.

REQUIRED OUTPUT (JSON):
{
  "translated_text": "The complete translated text in Markdown format - THIS MUST BE IN THE TARGET LANGUAGE. NO STYLE GUIDES.",
  "source_language": "ISO code of source language",
  "target_language": "ISO code of target language",
  "notes": "Brief notes about important translation decisions"
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

  async execute(input: TranslatorInput): Promise<AgentResponse & { result?: TranslatorResult }> {
    const sourceLangName = LANGUAGE_NAMES[input.sourceLanguage] || input.sourceLanguage;
    const targetLangName = LANGUAGE_NAMES[input.targetLanguage] || input.targetLanguage;
    const targetRules = LANGUAGE_EDITORIAL_RULES[input.targetLanguage] || "";

    const chapterInfo = input.chapterTitle 
      ? `\nCAPÍTULO: ${input.chapterNumber !== undefined ? input.chapterNumber : ""} - ${input.chapterTitle}`
      : "";

    const prompt = `
TASK: TRANSLATE the following text FROM ${sourceLangName.toUpperCase()} TO ${targetLangName.toUpperCase()}.

CRITICAL: The output "translated_text" MUST BE WRITTEN ENTIRELY IN ${targetLangName.toUpperCase()}. 
DO NOT return the text in ${sourceLangName} - that would be a FAILURE.

${targetRules}
${chapterInfo}

═══════════════════════════════════════════════════════════════════
SOURCE TEXT (in ${sourceLangName} - TO BE TRANSLATED):
═══════════════════════════════════════════════════════════════════

${input.content}

═══════════════════════════════════════════════════════════════════

INSTRUCTIONS:
1. TRANSLATE the complete text from ${sourceLangName} to ${targetLangName}
2. The "translated_text" field MUST contain text in ${targetLangName}, NOT in ${sourceLangName}
3. Preserve the literary style and narrative voice
4. Apply the typographical rules of ${targetLangName}
5. Return the result as valid JSON only

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
        console.log(`[Translator] Successfully parsed translation result`);
        return { ...response, result };
      }
    } catch (e) {
      console.error("[Translator] Failed to parse JSON response:", e);
    }

    return {
      ...response,
      result: {
        translated_text: response.content,
        source_language: input.sourceLanguage,
        target_language: input.targetLanguage,
        notes: "Respuesta no estructurada - se devuelve el contenido raw",
      }
    };
  }
}
