import { BaseAgent, AgentResponse } from "./base-agent";

interface TranslatorInput {
  content: string;
  sourceLanguage: string;
  targetLanguage: string;
  chapterTitle?: string;
  chapterNumber?: number;
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
NORMAS EDITORIALES ESPAÑOL:
- DIÁLOGOS: Usar raya (—) para introducir diálogos. Ejemplo: —Hola —dijo María—. ¿Cómo estás?
- COMILLAS: Usar comillas angulares « » para citas textuales. Comillas inglesas " " solo para citas dentro de citas.
- PUNTUACIÓN: Los signos de interrogación y exclamación van al principio (¿?) y al final (?).
- NÚMEROS: Escribir con letras del uno al nueve, cifras del 10 en adelante.`,

  en: `
ENGLISH EDITORIAL STANDARDS:
- DIALOGUE: Use quotation marks for dialogue. Example: "Hello," said Mary. "How are you?"
- QUOTES: Use double quotes " " for dialogue and direct speech. Single quotes ' ' for quotes within quotes.
- PUNCTUATION: Periods and commas go inside quotation marks. Question marks and exclamation points go inside only if part of the quote.
- NUMBERS: Spell out one through nine, use numerals for 10 and above.
- CONTRACTIONS: Preserve natural contractions (don't, can't, won't) in dialogue.`,

  fr: `
NORMES ÉDITORIALES FRANÇAIS:
- DIALOGUES: Utiliser les guillemets français « » avec espaces insécables. Tiret cadratin (—) pour les incises.
- PONCTUATION: Espace insécable avant : ; ! ? et après « et avant ».
- NOMBRES: Écrire en lettres de un à neuf, chiffres à partir de 10.
- MAJUSCULES: Les noms de langues, nationalités s'écrivent en minuscules (français, anglais).`,

  de: `
DEUTSCHE REDAKTIONSSTANDARDS:
- DIALOGE: Anführungszeichen „..." oder »...« verwenden. Beispiel: „Hallo", sagte Maria.
- ZITATE: Doppelte Anführungszeichen für direkte Rede. Einfache ‚...' für Zitate im Zitat.
- KOMPOSITA: Bindestriche bei zusammengesetzten Wörtern korrekt verwenden.
- ZAHLEN: Eins bis neun ausschreiben, ab 10 Ziffern verwenden.`,

  it: `
NORME EDITORIALI ITALIANO:
- DIALOGHI: Usare le virgolette basse « » o le caporali. Trattino lungo (—) per incisi.
- PUNTEGGIATURA: Virgola e punto dentro le virgolette solo se parte del discorso diretto.
- NUMERI: Scrivere in lettere da uno a nove, cifre da 10 in poi.
- ACCENTI: Attenzione agli accenti gravi (è, à) e acuti (é, perché).`,

  pt: `
NORMAS EDITORIAIS PORTUGUÊS:
- DIÁLOGOS: Usar travessão (—) para introduzir diálogos. Exemplo: — Olá — disse Maria.
- ASPAS: Usar aspas curvas " " para citações. Aspas simples ' ' para citações dentro de citações.
- PONTUAÇÃO: Vírgula e ponto fora das aspas, exceto se fizerem parte da citação.
- NÚMEROS: Escrever por extenso de um a nove, algarismos a partir de 10.`,

  ca: `
NORMES EDITORIALS CATALÀ:
- DIÀLEGS: Usar guió llarg (—) per introduir diàlegs. Exemple: —Hola —va dir Maria—. Com estàs?
- COMETES: Usar cometes baixes « » per a citacions. Cometes altes " " per a citacions dins de citacions.
- PUNTUACIÓ: Els signes d'interrogació i exclamació van al principi (¿?) i al final (?).
- NÚMEROS: Escriure amb lletres de l'u al nou, xifres del 10 endavant.`,
};

const SYSTEM_PROMPT = `
Eres un TRADUCTOR LITERARIO PROFESIONAL de élite. Tu trabajo es traducir textos literarios de un idioma a otro manteniendo:

1. LA ESENCIA LITERARIA: Preserva el estilo, la voz narrativa y el tono del autor original.
2. LA FLUIDEZ: La traducción debe sonar natural en el idioma destino, como si fuera escrita originalmente en ese idioma.
3. EXPRESIONES IDIOMÁTICAS: Adapta las expresiones culturales al equivalente más apropiado en el idioma destino.
4. NOMBRES PROPIOS: Mantén los nombres de personajes y lugares en su forma original, a menos que tengan una traducción establecida.
5. FORMATO PROFESIONAL: El texto debe estar maquetado en Markdown limpio, listo para publicación.

REGLAS CRÍTICAS:
- NUNCA omitas ni resumas contenido. La traducción debe ser COMPLETA.
- PRESERVA la estructura de párrafos y diálogos.
- APLICA las normas tipográficas correctas del idioma destino (comillas, guiones de diálogo, etc.).

SALIDA REQUERIDA (JSON):
{
  "translated_text": "El texto completo traducido en Markdown",
  "source_language": "código ISO del idioma origen",
  "target_language": "código ISO del idioma destino",
  "notes": "Breves notas sobre decisiones de traducción importantes (expresiones adaptadas, etc.)"
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
TAREA: Traducir el siguiente texto de ${sourceLangName.toUpperCase()} a ${targetLangName.toUpperCase()}.

${targetRules}
${chapterInfo}

═══════════════════════════════════════════════════════════════════
TEXTO A TRADUCIR:
═══════════════════════════════════════════════════════════════════

${input.content}

═══════════════════════════════════════════════════════════════════

INSTRUCCIONES:
1. Traduce el texto completo de ${sourceLangName} a ${targetLangName}
2. Mantén el estilo literario y la voz narrativa
3. Aplica las normas tipográficas de ${targetLangName}
4. Devuelve el resultado en formato JSON como se especifica

IMPORTANTE: Responde ÚNICAMENTE con JSON válido, sin texto adicional.
`;

    console.log(`[Translator] Starting translation from ${input.sourceLanguage} to ${input.targetLanguage}`);
    console.log(`[Translator] Content length: ${input.content.length} chars`);

    const response = await this.generateContent(prompt);

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
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
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
