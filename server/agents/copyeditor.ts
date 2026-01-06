import { BaseAgent, AgentResponse } from "./base-agent";

interface CopyEditorInput {
  chapterContent: string;
  chapterNumber: number;
  chapterTitle: string;
  guiaEstilo?: string;
  targetLanguage?: string;
}

export interface CopyEditorResult {
  texto_final: string;
  cambios_realizados: string;
  repeticiones_suavizadas?: string[];
  mejoras_fluidez?: string[];
  idioma_detectado: string;
}

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
NORME EDITORIALI ITALIANO (OBBLIGATORIO):
- DIALOGHI: Usare ESCLUSIVAMENTE il trattino lungo (—) per introdurre i dialoghi. MAI usare virgolette di nessun tipo ("", «», <<>>).
  Esempio corretto: —Ciao —disse Maria—. Come stai?
  Esempio SBAGLIATO: «Ciao» disse Maria. / "Ciao" disse Maria. / <<Ciao>> disse Maria.
- INCISI NEL DIALOGO: Il trattino lungo chiude l'inciso e ne apre un altro dopo l'attribuzione.
  Esempio: —Non so —rispose lui scrollando le spalle—. Forse domani.
- PUNTEGGIATURA: Il punto finale va DOPO il trattino di chiusura inciso, non dentro il dialogo.
- NUMERI: Scrivere in lettere da uno a nove, cifre da 10 in poi.
- ACCENTI: Attenzione agli accenti gravi (è, à) e acuti (é, perché).
- CONSISTENZA: Tutto il testo DEVE usare lo stesso sistema. Se trovi "«»", '""', o '<<>>', convertili TUTTI a trattini lunghi (—).`,

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

const LANGUAGE_FLUENCY_RULES: Record<string, string> = {
  es: `
REGLAS DE FLUIDEZ ESPAÑOL:
- FRASES LARGAS: Dividir oraciones de más de 50 palabras. Usar punto y seguido o punto y coma.
- PRONOMBRES ARCAICOS: Evitar "él" al inicio de oración cuando el sujeto está claro. Preferir sujeto implícito.
- REPETICIONES: "su... su... su..." en secuencia suena mecánico. Variar con "el/la", posesivos alternativos o reformular.
- GERUNDIOS ENCADENADOS: Evitar más de 2 gerundios seguidos ("estando haciendo pensando").
- PASIVAS: Preferir voz activa cuando sea natural. "El libro fue escrito por María" → "María escribió el libro".
- LEÍSMO/LAÍSMO: Mantener uso correcto de le/la/lo según la región del texto.`,

  en: `
ENGLISH FLUENCY RULES:
- LONG SENTENCES: Break sentences over 40 words. Use periods or semicolons for natural pauses.
- PASSIVE VOICE: Prefer active voice. "The ball was thrown by John" → "John threw the ball".
- REPETITIONS: Avoid repeating the same word within 3 sentences. Use synonyms or pronouns.
- SENTENCE VARIETY: Mix short punchy sentences with longer ones for rhythm.
- AWKWARD CONSTRUCTIONS: Avoid "There is/There are" as sentence starters when possible.
- ADVERB PLACEMENT: Keep adverbs close to the verbs they modify.`,

  fr: `
RÈGLES DE FLUIDITÉ FRANÇAIS:
- PHRASES LONGUES: Diviser les phrases de plus de 50 mots. Utiliser le point-virgule ou les deux-points.
- PRONOMS FORMELS: Éviter "il/elle" au début de phrase si le sujet est clair du contexte.
- RÉPÉTITIONS: Varier le vocabulaire. "Il a dit... Il a fait... Il a pensé..." → utiliser des synonymes.
- PASSÉ SIMPLE vs PASSÉ COMPOSÉ: Maintenir la cohérence temporelle dans le récit.
- SUBJONCTIF: S'assurer de l'utilisation correcte du subjonctif après "que".
- LIAISONS: Veiller à la fluidité des liaisons entre les phrases.`,

  de: `
DEUTSCHE FLÜSSIGKEITSREGELN:
- LANGE SÄTZE: Sätze über 40 Wörter aufteilen. Punkt oder Semikolon für natürliche Pausen verwenden.
- PASSIV: Aktiv bevorzugen. "Das Buch wurde von Maria geschrieben" → "Maria schrieb das Buch".
- WORTSTELLUNG: Verb an zweiter Stelle im Hauptsatz beachten.
- WIEDERHOLUNGEN: Dasselbe Wort nicht innerhalb von 3 Sätzen wiederholen.
- KOMPOSITA: Lange zusammengesetzte Wörter wenn möglich aufteilen oder umschreiben.
- KONJUNKTIV: Korrekten Konjunktiv in indirekter Rede verwenden.`,

  it: `
REGOLE DI FLUIDITÀ ITALIANO:
- FRASI LUNGHE: Dividere le frasi oltre le 50 parole. Usare punto e virgola o due punti.
- PRONOMI ARCAICI: "Egli/Ella/Esso" sono troppo formali. Preferire "lui/lei" o il soggetto implicito.
- RIPETIZIONI RAVVICINATE: "archiviate in archivi", "sua... sua... sua..." suonano meccaniche. Variare il lessico.
- GERUNDI CONCATENATI: Evitare più di 2 gerundi consecutivi.
- PASSIVO: Preferire la forma attiva quando naturale.
- COERENZA TEMPORALE: Mantenere coerenza tra passato remoto, imperfetto e presente.
- INCISI: Non abusare di incisi troppo lunghi che spezzano il flusso narrativo.`,

  pt: `
REGRAS DE FLUIDEZ PORTUGUÊS:
- FRASES LONGAS: Dividir frases com mais de 50 palavras. Usar ponto e vírgula ou dois pontos.
- PRONOMES FORMAIS: Evitar "ele/ela" no início da frase quando o sujeito está claro.
- REPETIÇÕES: Variar o vocabulário. Evitar "seu... seu... seu..." em sequência.
- GERÚNDIOS: Evitar mais de 2 gerúndios consecutivos.
- VOZ PASSIVA: Preferir voz ativa quando natural.
- COLOCAÇÃO PRONOMINAL: Manter a próclise/mesóclise/ênclise correta.`,

  ca: `
REGLES DE FLUÏDESA CATALÀ:
- FRASES LLARGUES: Dividir oracions de més de 50 paraules. Usar punt i coma o dos punts.
- PRONOMS FEBLES: Col·locar correctament els pronoms febles (em, et, es, ens, us).
- REPETICIONS: Variar el vocabulari. Evitar "seu... seu... seu..." en seqüència.
- GERUNDIS: Evitar més de 2 gerundis consecutius.
- VEU PASSIVA: Preferir la veu activa quan sigui natural.
- ARTICLE PERSONAL: Usar "en/na" correctament amb noms propis.`,
};

const SYSTEM_PROMPT = `
Eres el "Corrector de Estilo y Editor Multilingüe de Élite". Tu misión es la perfección ortotipográfica, el maquetado profesional, la ELIMINACIÓN DE REPETICIONES y la MEJORA DE LA FLUIDEZ NATURAL.

REGLA FUNDAMENTAL - NO TRADUCIR:
⚠️ NUNCA traduzcas el texto. Mantén SIEMPRE el idioma original del manuscrito. Tu trabajo es CORREGIR y MEJORAR LA FLUIDEZ, no traducir.

REGLAS DE INTERVENCIÓN:
1. INTEGRIDAD TOTAL: Prohibido resumir o condensar. El volumen de palabras debe mantenerse o aumentar ligeramente para mejorar la fluidez.
2. PRESERVAR IDIOMA: Mantén el texto en su idioma original. NO traduzcas bajo ninguna circunstancia.
3. PRESERVAR SENTIDO: El significado original debe mantenerse intacto. Solo mejoras estilísticas.
4. NORMAS TIPOGRÁFICAS: Aplica las normas editoriales del idioma detectado (diálogos, comillas, puntuación).
5. MAQUETADO: Devuelve el texto en Markdown limpio. Título en H1 (#).

PULIDO DE REPETICIONES (CRÍTICO):
6. DETECCIÓN DE FRASES REPETIDAS: Identifica expresiones, metáforas o descripciones que aparezcan más de una vez en el capítulo.
7. SUAVIZADO LÉXICO: Si encuentras la misma frase repetida, reemplaza las instancias adicionales con sinónimos o reformulaciones EN EL MISMO IDIOMA.
8. SENSACIONES VARIADAS: Las descripciones de emociones deben ser diversas.

MEJORA DE FLUIDEZ NATURAL (CRÍTICO):
9. FRASES LARGAS: Divide oraciones de más de 50 palabras en períodos más cortos usando puntuación adecuada.
10. PRONOMBRES ARCAICOS: Elimina pronombres excesivamente formales (Egli/Ella en italiano, He/She innecesarios en inglés, etc.).
11. CONSTRUCCIONES NATURALES: El texto debe sonar como lo escribiría un hablante nativo culto, no como una traducción.
12. RITMO NARRATIVO: Alterna frases cortas con largas para crear ritmo.
13. EVITAR REDUNDANCIAS: "archivados en archivos", "dijo diciendo" son errores a corregir.

SALIDA REQUERIDA (JSON):
{
  "texto_final": "El contenido completo del capítulo maquetado en Markdown (EN EL IDIOMA ORIGINAL)",
  "cambios_realizados": "Breve resumen de los ajustes técnicos hechos",
  "repeticiones_suavizadas": ["Lista de frases que fueron reformuladas para evitar repetición"],
  "mejoras_fluidez": ["Lista de mejoras de fluidez aplicadas (frases divididas, pronombres corregidos, etc.)"],
  "idioma_detectado": "código ISO del idioma (es, en, fr, de, it, pt, ca)"
}
`;

export class CopyEditorAgent extends BaseAgent {
  constructor() {
    super({
      name: "El Estilista",
      role: "copyeditor",
      systemPrompt: SYSTEM_PROMPT,
      model: "gemini-2.5-flash",
      useThinking: false,
    });
  }

  async execute(input: CopyEditorInput): Promise<AgentResponse & { result?: CopyEditorResult }> {
    const styleGuideSection = input.guiaEstilo 
      ? `\n    GUÍA DE ESTILO DEL AUTOR:\n    ${input.guiaEstilo}\n    \n    Respeta la voz y estilo definidos en la guía mientras aplicas las correcciones técnicas.\n`
      : "";

    const detectedLang = input.targetLanguage || "es";
    const languageRules = LANGUAGE_EDITORIAL_RULES[detectedLang] || LANGUAGE_EDITORIAL_RULES["en"] || "";
    const fluencyRules = LANGUAGE_FLUENCY_RULES[detectedLang] || LANGUAGE_FLUENCY_RULES["en"] || "";

    const prompt = `
    ⚠️ INSTRUCCIÓN CRÍTICA: NO TRADUCIR. Mantén el texto en su idioma original.
    
    IDIOMA DETECTADO DEL MANUSCRITO: ${detectedLang.toUpperCase()}
    
    ${languageRules}
    
    ${fluencyRules}
    
    Por favor, toma el siguiente texto y aplícale el protocolo de Corrección de Élite, Maquetado para Ebook y MEJORA DE FLUIDEZ NATURAL.
    
    IMPORTANTE: 
    - El texto debe permanecer en ${detectedLang.toUpperCase()}. NO lo traduzcas a español ni a ningún otro idioma.
    - Mejora la fluidez para que suene NATURAL en ${detectedLang.toUpperCase()}, como lo escribiría un autor nativo.
    - MANTÉN EL SENTIDO Y LA EXTENSIÓN del texto original.
    ${styleGuideSection}
    CAPÍTULO ${input.chapterNumber}: ${input.chapterTitle}
    
    ${input.chapterContent}
    
    Asegúrate de que:
    - Apliques las NORMAS EDITORIALES del idioma ${detectedLang.toUpperCase()} (ver arriba)
    - Apliques las REGLAS DE FLUIDEZ del idioma ${detectedLang.toUpperCase()} (ver arriba)
    - El formato Markdown sea impecable
    - El título esté formateado correctamente
    - No omitas ninguna escena ni reduzcas el contenido
    - Las frases largas (+50 palabras) se dividan correctamente
    - Los pronombres arcaicos se modernicen
    - El texto suene natural para un hablante nativo
    - ⚠️ NO TRADUZCAS el texto. Mantén el idioma original.
    
    Responde ÚNICAMENTE con el JSON estructurado.
    `;

    const response = await this.generateContent(prompt);
    
    try {
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]) as CopyEditorResult;
        return { ...response, result };
      }
    } catch (e) {
      console.error("[CopyEditor] Failed to parse JSON response");
    }

    return { 
      ...response, 
      result: { 
        texto_final: `# Capítulo ${input.chapterNumber}: ${input.chapterTitle}\n\n${input.chapterContent}`,
        cambios_realizados: "Sin cambios adicionales",
        idioma_detectado: detectedLang
      } 
    };
  }
}
