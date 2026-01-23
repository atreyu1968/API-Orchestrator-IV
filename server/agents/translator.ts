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
══════════════════════════════════════════════════════════════════════════════
NORMAS EDITORIALES Y DE FLUIDEZ - ESPAÑOL LITERARIO PROFESIONAL (OBLIGATORIO)
══════════════════════════════════════════════════════════════════════════════

[TIPOGRAFÍA - CRÍTICO]
- DIÁLOGOS: Usar EXCLUSIVAMENTE raya (—) para introducir diálogos. NUNCA comillas.
  ✓ CORRECTO: —Hola —dijo María—. ¿Cómo estás?
  ✗ INCORRECTO: "Hola" dijo María. / «Hola» dijo María.
- INCISOS: La raya cierra el inciso: —No sé —respondió él—. Quizá mañana.
- PUNTUACIÓN: Signos de apertura ¿¡ SIEMPRE. El punto va DESPUÉS de la raya de cierre.
- COMILLAS: Solo « » para citas textuales o pensamientos. " " para citas dentro de citas.
- NÚMEROS: Letras del uno al nueve, cifras del 10 en adelante.

[PRONOMBRES - CRÍTICO PARA LA LEGIBILIDAD]
- EVITAR ARCAÍSMOS: No usar "éste", "ése", "aquél" con tilde (RAE 2010 recomienda sin tilde).
- LEÍSMO: NUNCA "le" como complemento directo masculino.
  ✗ "Le vi ayer" → ✓ "Lo vi ayer"
- SUJETO IMPLÍCITO: El español permite omitir el sujeto. ¡USARLO!
  ✓ "Entró en la habitación y se sentó." (NO "Él entró en la habitación y él se sentó.")
- PREFERIR EL NOMBRE: Cuando haya ambigüedad, repetir el nombre del personaje.

[CONSTRUCCIONES A EVITAR - CRÍTICO]
- NO CALCOS DEL INGLÉS:
  ✗ "Estaba siendo perseguido" → ✓ "Lo perseguían"
  ✗ "Hacer sentido" → ✓ "Tener sentido"
  ✗ "En orden a" → ✓ "Para"
- NO GERUNDIOS ENCADENADOS:
  ✗ "Caminando, pensando, mirando..." → ✓ Dividir en oraciones
- NO ORACIONES LARGAS:
  Máximo 35-40 palabras por oración. Oraciones de más de 45 palabras DEBEN dividirse.
- NO VOZ PASIVA EXCESIVA:
  ✗ "La puerta fue abierta por él" → ✓ "Abrió la puerta"
- NO QUEÍSMO/DEQUEÍSMO:
  ✗ "Pienso de que..." → ✓ "Pienso que..."
  ✗ "Me alegro que..." → ✓ "Me alegro de que..."

[FLUIDEZ Y NATURALIDAD - ESENCIAL]
- RITMO: Alternar oraciones cortas (acción, tensión) con oraciones más largas (descripción).
- CONECTORES NATURALES: Usar "luego", "entonces", "así que", "por eso" de forma natural.
- ORDEN FLEXIBLE: El español permite orden flexible. Usarlo para énfasis y ritmo.
  ✓ "A casa volvió solo a medianoche" (énfasis en "a casa")
- REPETICIONES: Evitar la misma palabra en oraciones consecutivas.
- REGISTRO: Mantener un registro literario moderno, ni académico ni demasiado coloquial.
- EXPRESIONES IDIOMÁTICAS: Traducir el SENTIDO, no las palabras.

[TUTEO / USTED - CRÍTICO]
- COHERENCIA ABSOLUTA: El tratamiento (tú/usted) entre dos personajes DEBE ser CONSTANTE.
- REGLA BASE:
  • Compañeros/amigos/familia cercana → tuteo (tú)
  • Superiores jerárquicos/desconocidos/respeto → usted
  • Señor/Señora + apellido → SIEMPRE usted
- TRANSICIONES: Si un personaje pasa de usted a tú, debe ser un MOMENTO significativo, explícito.
  ✓ "¿Puedo tutearte?" y transición clara.
  ✗ Alternar tú/usted sin explicación = ERROR GRAVE.
- VERIFICACIÓN: Revisar cada par de personajes y verificar coherencia del tratamiento.

[FORMATO DE TÍTULOS DE CAPÍTULOS - OBLIGATORIO]
- FORMATO: "# Capítulo X: Título" (H1 en Markdown, con dos puntos)
  ✓ # Capítulo 1: El Comienzo
  ✓ # Prólogo
  ✓ # Epílogo
  ✗ ## Capítulo 1 (no H2)
  ✗ Capítulo 1 - Título (no usar guion)
  ✗ CAPÍTULO 1: TÍTULO (no todo en mayúsculas)
- MAYÚSCULAS DEL TÍTULO: Primera letra mayúscula, resto minúsculas (excepto nombres propios).
  ✓ # Capítulo 5: La noche cae sobre Madrid
  ✗ # Capítulo 5: LA NOCHE CAE SOBRE MADRID
- SIN SEPARADORES: Ninguna línea --- o === entre capítulos.

[VERIFICACIÓN FINAL OBLIGATORIA]
Releer mentalmente en voz alta. Si suena a traducción, REESCRIBIR.
El texto DEBE parecer escrito ORIGINALMENTE en español por un autor nativo.`,

  en: `
══════════════════════════════════════════════════════════════════════════════
ENGLISH EDITORIAL & FLUENCY STANDARDS - PROFESSIONAL LITERARY (MANDATORY)
══════════════════════════════════════════════════════════════════════════════

[TYPOGRAPHY - CRITICAL]
- DIALOGUE: Use double quotation marks EXCLUSIVELY for dialogue.
  ✓ CORRECT: "Hello," said Mary. "How are you?"
  ✗ WRONG: 'Hello,' said Mary. (British style - use only for en-GB)
- PUNCTUATION: Periods and commas ALWAYS inside quotation marks.
  Question/exclamation marks inside only if part of the quote.
- NUMBERS: Spell out one through nine, numerals for 10+.
- CONTRACTIONS: Use natural contractions in dialogue (don't, can't, won't, I'm, you're).

[AVOID AI-SOUNDING PROSE - CRITICAL]
- FORBIDDEN WORDS: NEVER use these AI crutch words:
  ✗ "suddenly", "shrouded", "unfold", "crucial", "pivotal", "amidst", "whilst"
  ✗ "endeavor", "plethora", "myriad", "utilize", "facilitate", "commence"
  ✗ "enigmatic", "palpable", "tangible", "visceral", "resonate", "unravel"
- SHOW DON'T TELL: Replace weak constructions:
  ✗ "He felt angry" → ✓ "His jaw tightened"
  ✗ "walked slowly" → ✓ "ambled" or "shuffled"
  ✗ "said angrily" → ✓ "snapped" or "growled"

[SENTENCE STRUCTURE - CRITICAL]
- LENGTH: Maximum 35-40 words per sentence. Break longer sentences.
- RHYTHM: Vary sentence length deliberately.
  Short sentences = tension, action, impact.
  Longer sentences = description, reflection, flow.
- ACTIVE VOICE: Prefer active over passive.
  ✗ "The door was opened by him" → ✓ "He opened the door"
- NO REPETITION: Never repeat the same word in consecutive sentences.
- SUBJECT VARIATION: Don't start consecutive sentences with the same word.
  ✗ "He walked. He stopped. He turned." → ✓ Vary the structure.

[FLUENCY & NATURALNESS - ESSENTIAL]
- IDIOMS: Use natural English expressions, never literal translations.
- DIALOGUE: Make it sound like real speech - fragmented, interrupted, natural.
- TRANSITIONS: Use subtle connectors (then, still, yet, though) not formal ones.
- REGISTER: Maintain consistent literary register - neither too formal nor too casual.

[CHAPTER TITLES FORMAT - MANDATORY]
- FORMAT: "# Chapter X: Title" (H1 in Markdown, with colon)
  ✓ # Chapter 1: The Beginning
  ✓ # Prologue
  ✓ # Epilogue
  ✗ ## Chapter 1 (not H2)
  ✗ Chapter 1 - Title (no dash)
  ✗ CHAPTER 1: TITLE (not all caps)
- TITLE CASE: First letter uppercase, rest lowercase (except proper nouns).
  ✓ # Chapter 5: The night falls over London
  ✗ # Chapter 5: THE NIGHT FALLS OVER LONDON
- NO SEPARATORS: No --- or === lines between chapters.

[FINAL CHECK - MANDATORY]
Read aloud mentally. If it sounds translated, REWRITE.
The text MUST read as if ORIGINALLY WRITTEN in English by a native author.`,

  "en-US": `
══════════════════════════════════════════════════════════════════════════════
AMERICAN ENGLISH EDITORIAL STANDARDS - PROFESSIONAL LITERARY (MANDATORY)
══════════════════════════════════════════════════════════════════════════════

[AMERICAN SPELLING & VOCABULARY - CRITICAL]
- SPELLING: Use American spelling CONSISTENTLY:
  ✓ color, center, realize, traveled, defense, theater, gray, catalog, favor, honor
  ✗ NEVER: colour, centre, realise, travelled, defence, theatre, grey, catalogue
- VOCABULARY: Use American terms EXCLUSIVELY:
  ✓ apartment, elevator, truck, gasoline, sidewalk, cookie, faucet, fall, mom, pants, sneakers, vacation
  ✗ NEVER: flat, lift, lorry, petrol, pavement, biscuit, tap, autumn, mum, trousers, trainers, holiday
- DATES: "March 15" (NOT "15 March"). Format: Month DD, YYYY.
- MEASUREMENTS: Imperial default (feet, miles, pounds, Fahrenheit).

[TYPOGRAPHY - CRITICAL]
- DIALOGUE: Double quotation marks " " EXCLUSIVELY.
  ✓ "Hello," said Mary. "How are you?"
- PUNCTUATION: Periods and commas ALWAYS inside quotation marks.
- NUMBERS: Spell out one through nine, numerals for 10+.

[AVOID AI-SOUNDING PROSE - CRITICAL]
- FORBIDDEN WORDS: Same as general English - no "suddenly", "shrouded", "endeavor", etc.
- SHOW DON'T TELL: Replace weak constructions with strong verbs.
- CONTRACTIONS: Use natural American contractions freely (don't, can't, won't, I'm, you're).
  In very casual dialogue: gonna, wanna, gotta are acceptable.

[SENTENCE STRUCTURE - CRITICAL]
- LENGTH: Maximum 35-40 words. Vary deliberately.
- RHYTHM: Short sentences for action/tension. Longer for description.
- ACTIVE VOICE: Strongly preferred over passive.
- NO REPETITION: Never same word in consecutive sentences.
- SUBJECT VARIATION: Don't start consecutive sentences with same word.

[FLUENCY & NATURALNESS - ESSENTIAL]
- IDIOMS: Use American expressions naturally (e.g., "ballpark figure", "touch base").
- DIALOGUE: Sound like real American speech - casual, contracted, natural.
- REGISTER: Maintain consistent literary register appropriate to genre.

[FINAL CHECK - MANDATORY]
Read aloud mentally. If ANY British spelling/vocabulary slips through, fix it.
The text MUST read as if ORIGINALLY WRITTEN by an American author.`,

  "en-GB": `
══════════════════════════════════════════════════════════════════════════════
BRITISH ENGLISH EDITORIAL STANDARDS - PROFESSIONAL LITERARY (MANDATORY)
══════════════════════════════════════════════════════════════════════════════

[BRITISH SPELLING & VOCABULARY - CRITICAL]
- SPELLING: Use British spelling CONSISTENTLY:
  ✓ colour, centre, realise, travelled, defence, theatre, grey, catalogue, favour, honour, behaviour
  ✗ NEVER: color, center, realize, traveled, defense, theater, gray, catalog
- VOCABULARY: Use British terms EXCLUSIVELY:
  ✓ flat, lift, lorry, petrol, pavement, biscuit, tap, autumn, mum, trousers, trainers, holiday, queue, boot, bonnet, chemist
  ✗ NEVER: apartment, elevator, truck, gasoline, sidewalk, cookie, faucet, fall, mom, pants, sneakers, vacation
- DATES: "15 March" (NOT "March 15"). Format: DD Month YYYY.
- MEASUREMENTS: Metric primary (metres, kilometres, kilograms, Celsius).
  Imperial for colloquial use (stones for weight, miles for distance).

[TYPOGRAPHY - CRITICAL]
- DIALOGUE: Single quotation marks ' ' for dialogue.
  ✓ 'Hello,' said Mary. 'How are you?'
  ✗ WRONG: "Hello," said Mary.
- PUNCTUATION: Periods and commas go OUTSIDE quotation marks (unless part of quoted material).
- NUMBERS: Spell out one through nine, numerals for 10+.

[AVOID AI-SOUNDING PROSE - CRITICAL]
- FORBIDDEN WORDS: No "suddenly", "shrouded", "endeavor" (or "endeavour"), "whilst" (use "while").
- SHOW DON'T TELL: Replace weak constructions with strong verbs.
- CONTRACTIONS: Use natural British contractions (don't, can't, shan't, won't, mustn't).

[SENTENCE STRUCTURE - CRITICAL]
- LENGTH: Maximum 35-40 words. Vary deliberately.
- RHYTHM: Short sentences for action/tension. Longer for description.
- ACTIVE VOICE: Preferred, but British English tolerates slightly more passive.
- COLLECTIVE NOUNS: Can take plural verbs: "The team are playing well."
- NO REPETITION: Never same word in consecutive sentences.

[FLUENCY & NATURALNESS - ESSENTIAL]
- IDIOMS: Use British expressions naturally (e.g., "spot on", "brilliant", "cheers", "sorted").
- REGISTER: Slightly more formal than American. Avoid overly casual Americanisms.
- DIALOGUE: Sound authentically British - understatement, politeness markers.

[FINAL CHECK - MANDATORY]
Read aloud mentally. If ANY American spelling/vocabulary slips through, fix it.
The text MUST read as if ORIGINALLY WRITTEN by a British author.`,

  fr: `
══════════════════════════════════════════════════════════════════════════════
NORMES ÉDITORIALES ET FLUIDITÉ - FRANÇAIS LITTÉRAIRE PROFESSIONNEL (OBLIGATOIRE)
══════════════════════════════════════════════════════════════════════════════

[TYPOGRAPHIE - CRITIQUE - OBLIGATOIRE]
- DIALOGUES: EXCLUSIVEMENT tiret cadratin (—) au début de chaque réplique. JAMAIS de guillemets pour les dialogues.
  ✓ CORRECT: — Bonjour, dit Marie.
  ✓ CORRECT: — Comment vas-tu ? demanda-t-il.
  ✓ CORRECT: — Je ne sais pas, répondit-elle. Peut-être demain.
  ✗ INCORRECT: « Bonjour », dit Marie. (réservé aux citations/pensées)
  ✗ INCORRECT: - Bonjour (tiret court interdit)
  ✗ INCORRECT: -- Bonjour (double tiret interdit)
- INCISES DIALOGUÉES: Virgule AVANT l'incise, point APRÈS si fin de phrase.
  ✓ — Je viendrai, dit-il.
  ✓ — Je viendrai, dit-il, mais tard.
  ✓ — Je viendrai, dit-il. Mais pas avant midi.
- GUILLEMETS « »: UNIQUEMENT pour citations textuelles ou pensées intérieures.
  ✓ Il pensa : « Quelle erreur ! »
  ✓ Le panneau indiquait : « Entrée interdite ».
- PONCTUATION FRANÇAISE (OBLIGATOIRE):
  • Espace insécable AVANT : ; ! ? (espace fine ou insécable)
  • Espace insécable APRÈS « et AVANT »
  ✓ CORRECT: Comment vas-tu ?  (espace avant ?)
  ✓ CORRECT: Attention : voici la suite.  (espace avant :)
  ✓ CORRECT: Quelle surprise !  (espace avant !)
  ✓ CORRECT: Oui ; peut-être.  (espace avant ;)
  ✗ INCORRECT: Comment vas-tu? (pas d'espace)
- NOMBRES: Lettres de un à neuf, chiffres à partir de 10.
- MAJUSCULES: Langues et nationalités en minuscules (français, anglais).

[TEMPS VERBAUX - CRITIQUE]
- NARRATION LITTÉRAIRE: Passé simple OBLIGATOIRE, pas passé composé.
  ✓ "Il entra dans la pièce" (passé simple)
  ✗ "Il est entré dans la pièce" (passé composé = oral/informel)
- IMPARFAIT: Pour descriptions et actions continues.
- COHÉRENCE: Ne pas mélanger passé simple et passé composé dans la narration.

[CONSTRUCTIONS À ÉVITER - CRITIQUE]
- PAS D'ANGLICISMES:
  ✗ "Réaliser" (au sens de "se rendre compte") → ✓ "Se rendre compte", "Comprendre"
  ✗ "Définitivement" (au sens de "certainement") → ✓ "Certainement", "Assurément"
  ✗ "Supporter" (au sens de "soutenir") → ✓ "Soutenir", "Appuyer"
- PAS DE LOURDEURS:
  ✗ "Il y a le fait que..." → ✓ Construction directe
  ✗ "Au niveau de..." → ✓ "Concernant", "Pour"
- PHRASES MAXIMUM: 40-45 mots. Au-delà, diviser.
- RÉPÉTITIONS: Jamais le même mot dans des phrases consécutives.

[FLUIDITÉ ET NATUREL - ESSENTIEL]
- PRONOMS: Éviter l'ambiguïté. Clarifier les référents si nécessaire.
- TRANSITIONS: Utiliser des connecteurs naturels (puis, alors, donc, ainsi).
- REGISTRE: Littéraire moderne, ni trop soutenu ni trop familier.
- RYTHME: Alterner phrases courtes (tension) et longues (description).
- EXPRESSIONS IDIOMATIQUES: Traduire le SENS, utiliser des expressions françaises authentiques.

[TUTOIEMENT / VOUVOIEMENT - CRITIQUE]
- COHÉRENCE ABSOLUE: Le traitement (tu/vous) entre deux personnages DOIT rester CONSTANT.
- RÈGLE DE BASE:
  • Collègues/amis proches → tutoiement (tu)
  • Supérieurs hiérarchiques/inconnus/respect → vouvoiement (vous)
  • Monsieur/Madame + nom → TOUJOURS vouvoiement
- TRANSITIONS: Si un personnage passe du vous au tu, cela doit être un MOMENT significatif, explicite.
  ✓ « Je peux te tutoyer ? » puis transition claire.
  ✗ Alterner tu/vous sans explication = ERREUR GRAVE.
- VÉRIFICATION: Tracer chaque paire de personnages et vérifier la cohérence du traitement.

[FORMAT DES TITRES DE CHAPITRES - OBLIGATOIRE]
- FORMAT: "# Chapitre X : Titre" (H1 en Markdown, avec deux-points et espace)
  ✓ # Chapitre 1 : Le Commencement
  ✓ # Prologue
  ✓ # Épilogue
  ✗ ## Chapitre 1 (pas H2)
  ✗ Chapitre 1 - Titre (pas de tiret)
  ✗ CHAPITRE 1 : TITRE (pas tout en majuscules)
- CASSE DU TITRE: Première lettre majuscule, reste en minuscules (sauf noms propres).
  ✓ # Chapitre 5 : La nuit tombe sur Paris
  ✗ # Chapitre 5 : LA NUIT TOMBE SUR PARIS
- PAS DE SÉPARATEURS: Aucune ligne --- ou === entre les chapitres.

[VÉRIFICATION FINALE OBLIGATOIRE]
Relire mentalement à haute voix. Si cela sonne comme une traduction, RÉÉCRIRE.
Le texte DOIT sembler écrit ORIGINELLEMENT en français par un auteur francophone.`,

  de: `
══════════════════════════════════════════════════════════════════════════════
DEUTSCHE REDAKTIONS- UND STILSTANDARDS - PROFESSIONELL LITERARISCH (PFLICHT)
══════════════════════════════════════════════════════════════════════════════

[TYPOGRAFIE - KRITISCH - PFLICHT]
- DIALOGE: AUSSCHLIESSLICH Anführungszeichen „..." (unten-oben) verwenden. NICHT »...«.
  ✓ KORREKT: „Hallo", sagte Maria. „Wie geht es dir?"
  ✓ KORREKT: „Ich weiß nicht", sagte er. „Vielleicht morgen."
  ✗ FALSCH: »Hallo«, sagte Maria. (Chevrons NICHT für Dialoge)
  ✗ FALSCH: "Hallo", sagte Maria. (englische Anführungszeichen)
  ✗ FALSCH: «Hallo», sagte Maria. (französische Guillemets)
- ZITAT IM ZITAT: Einfache Anführungszeichen ‚...' innerhalb von „...".
  ✓ „Er sagte: ‚Komm her!' und ging weiter."
- KOMMA BEI DIALOGEN: Komma VOR der Zuschreibung, Punkt NACH Abschluss.
  ✓ „Ich komme", sagte er.
  ✓ „Ich komme", sagte er, „aber erst später."
  ✓ „Ich komme." Er stand auf.
- ZAHLEN: Eins bis neun ausschreiben, ab 10 Ziffern.

[SATZSTRUKTUR - KRITISCH]
- WORTSTELLUNG: Natürliche deutsche Wortstellung. Verb an ZWEITER Stelle im Hauptsatz.
  ✓ "Gestern ging er nach Hause" (Verb an 2. Stelle)
- NEBENSÄTZE: Verb am Ende.
  ✓ "Er sagte, dass er müde sei"
- SATZLÄNGE: Maximum 40-45 Wörter. Längere Sätze AUFTEILEN.
- KLAMMERSÄTZE: Nicht zu viele Einschübe zwischen Subjekt und Verb.

[ZU VERMEIDENDE KONSTRUKTIONEN - KRITISCH]
- KEINE ANGLIZISMEN:
  ✗ "Das macht Sinn" → ✓ "Das ergibt Sinn", "Das ist sinnvoll"
  ✗ "Realisieren" (im Sinne von erkennen) → ✓ "Erkennen", "Begreifen"
- KEINE SUBSTANTIVITIS:
  ✗ "Die Durchführung der Untersuchung" → ✓ "Die Untersuchung durchführen"
- KEINE PASSIV-HÄUFUNG:
  ✗ "Es wurde beschlossen" → ✓ "Man beschloss", "Sie beschlossen"
- KEINE WIEDERHOLUNGEN: Nie dasselbe Wort in aufeinanderfolgenden Sätzen.

[FLÜSSIGKEIT UND NATÜRLICHKEIT - WESENTLICH]
- KOMPOSITA: Natürlich verwenden, aber nicht zu lang (max. 3-4 Teile).
- MODALPARTIKELN: Ja, doch, mal, eben, halt in Dialogen für Natürlichkeit.
  ✓ "Komm doch mal her" (natürlicher Dialog)
- KONJUNKTIV: Für indirekte Rede Konjunktiv I wenn möglich.
- RHYTHMUS: Kurze Sätze für Spannung, längere für Beschreibung.
- REGISTER: Literarisch modern, weder zu formell noch zu umgangssprachlich.

[DU / SIE - KRITISCH]
- ABSOLUTE KONSISTENZ: Die Anrede (du/Sie) zwischen zwei Figuren MUSS KONSTANT bleiben.
- GRUNDREGEL:
  • Kollegen/Freunde/Familie → Duzen (du)
  • Vorgesetzte/Fremde/Respekt → Siezen (Sie)
  • Herr/Frau + Nachname → IMMER Sie
- ÜBERGÄNGE: Wenn eine Figur vom Sie zum Du wechselt, muss es ein BEDEUTSAMER, expliziter Moment sein.
  ✓ „Wollen wir uns duzen?" dann klarer Übergang.
  ✗ Zwischen du/Sie wechseln ohne Erklärung = SCHWERER FEHLER.
- ÜBERPRÜFUNG: Jedes Figurenpaar durchgehen und Konsistenz der Anrede prüfen.

[KAPITELÜBERSCHRIFTEN-FORMAT - PFLICHT]
- FORMAT: "# Kapitel X: Titel" (H1 in Markdown, mit Doppelpunkt)
  ✓ # Kapitel 1: Der Anfang
  ✓ # Prolog
  ✓ # Epilog
  ✗ ## Kapitel 1 (nicht H2)
  ✗ Kapitel 1 - Titel (kein Bindestrich)
  ✗ KAPITEL 1: TITEL (nicht alles Großbuchstaben)
- TITELSCHREIBUNG: Erster Buchstabe groß, Rest klein (außer Eigennamen).
  ✓ # Kapitel 5: Die Nacht fällt über Berlin
  ✗ # Kapitel 5: DIE NACHT FÄLLT ÜBER BERLIN
- KEINE TRENNLINIEN: Keine --- oder === zwischen Kapiteln.

[ENDKONTROLLE - PFLICHT]
Mental laut lesen. Wenn es wie eine Übersetzung klingt, UMSCHREIBEN.
Der Text MUSS klingen, als wäre er URSPRÜNGLICH von einem deutschen Muttersprachler geschrieben.`,

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

[TU / LEI - CRITICO]
- COERENZA ASSOLUTA: Il trattamento (tu/Lei) tra due personaggi DEVE essere COSTANTE.
- REGOLA BASE:
  • Colleghi/amici/famiglia → dare del tu
  • Superiori/sconosciuti/rispetto → dare del Lei
  • Signor/Signora + cognome → SEMPRE Lei
- TRANSIZIONI: Se un personaggio passa dal Lei al tu, deve essere un MOMENTO significativo, esplicito.
  ✓ "Possiamo darci del tu?" poi transizione chiara.
  ✗ Alternare tu/Lei senza spiegazione = ERRORE GRAVE.
- VERIFICA: Controllare ogni coppia di personaggi per coerenza del trattamento.

[FORMATO TITOLI CAPITOLI - OBBLIGATORIO]
- FORMATO: "# Capitolo X: Titolo" (H1 in Markdown, con due punti)
  ✓ # Capitolo 1: L'inizio
  ✓ # Prologo
  ✓ # Epilogo
  ✗ ## Capitolo 1 (non H2)
  ✗ Capitolo 1 - Titolo (non usare trattino)
  ✗ CAPITOLO 1: TITOLO (non tutto maiuscolo)
- MAIUSCOLE DEL TITOLO: Prima lettera maiuscola, resto minuscolo (eccetto nomi propri).
  ✓ # Capitolo 5: La notte cala su Roma
  ✗ # Capitolo 5: LA NOTTE CALA SU ROMA
- NESSUN SEPARATORE: Nessuna linea --- o === tra capitoli.

[VERIFICA FINALE OBBLIGATORIA]
Prima di consegnare, rileggere ad alta voce mentalmente. Se suona come una traduzione, RISCRIVERE.
Il testo DEVE sembrare scritto ORIGINARIAMENTE in italiano da un autore madrelingua.`,

  pt: `
══════════════════════════════════════════════════════════════════════════════
NORMAS EDITORIAIS E FLUIDEZ - PORTUGUÊS LITERÁRIO PROFISSIONAL (OBRIGATÓRIO)
══════════════════════════════════════════════════════════════════════════════

[TIPOGRAFIA - CRÍTICO]
- DIÁLOGOS: Usar EXCLUSIVAMENTE travessão (—) para introduzir diálogos.
  ✓ CORRETO: — Olá — disse Maria. — Como estás?
  ✗ ERRADO: "Olá" disse Maria.
- INCISOS: O travessão fecha o inciso: — Não sei — respondeu ele. — Talvez amanhã.
- ASPAS: Curvas " " para citações. Simples ' ' para citações dentro de citações.
- NÚMEROS: Por extenso de um a nove, algarismos a partir de 10.

[COLOCAÇÃO PRONOMINAL - CRÍTICO]
- PRÓCLISE: Antes do verbo quando há palavra atrativa (não, nunca, que, se, etc.).
  ✓ "Não me disse nada" / "Que te aconteceu?"
- ÊNCLISE: Depois do verbo no início de frase e em imperativos.
  ✓ "Disse-me que viria" / "Dá-me isso"
- MESÓCLISE: No futuro e condicional (mais literário).
  ✓ "Dir-lhe-ei amanhã" / "Fá-lo-ia se pudesse"
- NUNCA começar frase com pronome átono no português europeu.
  ✗ "Me disse" → ✓ "Disse-me"

[CONSTRUÇÕES A EVITAR - CRÍTICO]
- SEM BRASILEIRISMOS (para pt-PT) / SEM LUSITANISMOS (para pt-BR):
  Adaptar vocabulário à variante pretendida.
- SEM GERÚNDIOS EXCESSIVOS:
  ✗ "Estava caminhando, pensando, olhando..." → ✓ Dividir em frases
- SEM VOZ PASSIVA EXCESSIVA:
  ✗ "A porta foi aberta por ele" → ✓ "Ele abriu a porta"
- FRASES: Máximo 40-45 palavras. Acima disso, DIVIDIR.
- REPETIÇÕES: Nunca a mesma palavra em frases consecutivas.

[FLUIDEZ E NATURALIDADE - ESSENCIAL]
- RITMO: Alternar frases curtas (tensão, ação) com longas (descrição).
- CONECTORES: Usar "depois", "então", "assim", "por isso" naturalmente.
- REGISTO: Literário moderno, nem demasiado formal nem coloquial.
- EXPRESSÕES IDIOMÁTICAS: Traduzir o SENTIDO, usar expressões portuguesas autênticas.

[TU / VOCÊ / O SENHOR - CRÍTICO]
- COERÊNCIA ABSOLUTA: O tratamento entre dois personagens DEVE ser CONSTANTE.
- REGRA BASE (pt-PT):
  • Colegas/amigos/família → tu
  • Superiores/desconhecidos/respeito → você ou o senhor/a senhora
  • Senhor/Senhora + apelido → SEMPRE o senhor/a senhora
- REGRA BASE (pt-BR):
  • Informal/amigos → você (mais comum)
  • Formal/respeito → o senhor/a senhora
- TRANSIÇÕES: Se um personagem muda de tratamento, deve ser um MOMENTO significativo.
  ✓ "Podemos tratar-nos por tu?" e transição clara.
  ✗ Alternar tratamentos sem explicação = ERRO GRAVE.

[FORMATO TÍTULOS CAPÍTULOS - OBRIGATÓRIO]
- FORMATO: "# Capítulo X: Título" (H1 em Markdown, com dois pontos)
  ✓ # Capítulo 1: O Começo
  ✓ # Prólogo
  ✓ # Epílogo
  ✗ ## Capítulo 1 (não H2)
  ✗ Capítulo 1 - Título (não usar travessão)
  ✗ CAPÍTULO 1: TÍTULO (não tudo maiúsculas)
- MAIÚSCULAS DO TÍTULO: Primeira letra maiúscula, resto minúsculas (exceto nomes próprios).
  ✓ # Capítulo 5: A noite cai sobre Lisboa
  ✗ # Capítulo 5: A NOITE CAI SOBRE LISBOA
- SEM SEPARADORES: Nenhuma linha --- ou === entre capítulos.

[VERIFICAÇÃO FINAL OBRIGATÓRIA]
Reler mentalmente em voz alta. Se soar como tradução, REESCREVER.
O texto DEVE parecer escrito ORIGINALMENTE em português por um autor nativo.`,

  ca: `
══════════════════════════════════════════════════════════════════════════════
NORMES EDITORIALS I FLUÏDESA - CATALÀ LITERARI PROFESSIONAL (OBLIGATORI)
══════════════════════════════════════════════════════════════════════════════

[TIPOGRAFIA - CRÍTIC]
- DIÀLEGS: Usar EXCLUSIVAMENT guió llarg (—) per introduir diàlegs.
  ✓ CORRECTE: —Hola —va dir Maria—. Com estàs?
  ✗ INCORRECTE: "Hola" va dir Maria. / «Hola» va dir Maria.
- INCISOS: El guió llarg tanca l'incís: —No ho sé —va respondre ell—. Potser demà.
- COMETES: Baixes « » per a citacions. Altes " " per a citacions dins de citacions.
- NÚMEROS: Lletres de l'u al nou, xifres del 10 endavant.
- PUNTUACIÓ: Signes d'interrogació i exclamació només al final (no al principi com en castellà).
  ✓ "Què vols?" (NO "¿Què vols?")

[PRONOMS FEBLES - CRÍTIC]
- COMBINACIONS: Usar correctament les combinacions de pronoms febles.
  ✓ "Li'l donaré" / "Me'n vaig" / "T'ho he dit"
- APOSTROFACIÓ: Apostrofar correctament davant vocal.
  ✓ "L'he vist" / "M'ha dit" / "N'hi ha"
- POSICIÓ: Davant el verb en indicatiu/subjuntiu, darrere en imperatiu/infinitiu/gerundi.
  ✓ "Ho faig" vs "Fes-ho" / "Fer-ho"

[CONSTRUCCIONS A EVITAR - CRÍTIC]
- RES DE CASTELLANISMES:
  ✗ "Doncs" (al principi de frase) → ✓ "Bé", "Així"
  ✗ "Bueno" → ✓ "Bé", "D'acord"
  ✗ "Vale" → ✓ "D'acord", "Molt bé"
  ✗ "Entonces" → ✓ "Aleshores", "Llavors"
- RES DE CALCS DEL CASTELLÀ:
  ✗ "Fer-se passar per" → ✓ "Fer passar-se per"
  ✗ "Tenir que" → ✓ "Haver de"
- FRASES: Màxim 40-45 paraules. Per sobre, DIVIDIR.
- REPETICIONS: Mai la mateixa paraula en frases consecutives.

[FLUÏDESA I NATURALITAT - ESSENCIAL]
- RITME: Alternar frases curtes (tensió, acció) amb llargues (descripció).
- CONNECTORS: Usar "després", "aleshores", "així", "per això" naturalment.
- REGISTRE: Literari modern, ni massa formal ni col·loquial.
- EXPRESSIONS IDIOMÀTIQUES: Traduir el SENTIT, usar expressions catalanes autèntiques.
- VARIETAT: Usar vocabulari català genuí, no catalanitzacions del castellà.

[TU / VOSTÈ - CRÍTIC]
- COHERÈNCIA ABSOLUTA: El tractament (tu/vostè) entre dos personatges HA DE ser CONSTANT.
- REGLA BASE:
  • Companys/amics/família → tuteig (tu)
  • Superiors/desconeguts/respecte → vostè
  • Senyor/Senyora + cognom → SEMPRE vostè
- TRANSICIONS: Si un personatge passa del vostè al tu, ha de ser un MOMENT significatiu, explícit.
  ✓ "Podem tutejar-nos?" i transició clara.
  ✗ Alternar tu/vostè sense explicació = ERROR GREU.

[FORMAT TÍTOLS CAPÍTOLS - OBLIGATORI]
- FORMAT: "# Capítol X: Títol" (H1 en Markdown, amb dos punts)
  ✓ # Capítol 1: El Començament
  ✓ # Pròleg
  ✓ # Epíleg
  ✗ ## Capítol 1 (no H2)
  ✗ Capítol 1 - Títol (no usar guió)
  ✗ CAPÍTOL 1: TÍTOL (no tot en majúscules)
- MAJÚSCULES DEL TÍTOL: Primera lletra majúscula, resta minúscules (excepte noms propis).
  ✓ # Capítol 5: La nit cau sobre Barcelona
  ✗ # Capítol 5: LA NIT CAU SOBRE BARCELONA
- SENSE SEPARADORS: Cap línia --- o === entre capítols.

[VERIFICACIÓ FINAL OBLIGATÒRIA]
Rellegir mentalment en veu alta. Si sona com una traducció, REESCRIURE.
El text HA DE semblar escrit ORIGINALMENT en català per un autor nadiu.`,
};

const AI_CRUTCH_WORDS: Record<string, string[]> = {
  en: [
    "suddenly", "shrouded", "unfold", "crucial", "pivotal", "amidst", "whilst",
    "endeavor", "plethora", "myriad", "utilize", "facilitate", "commence",
    "terminate", "subsequently", "aforementioned", "nevertheless", "furthermore",
    "enigmatic", "palpable", "tangible", "visceral", "resonate", "unravel",
    "delve", "tapestry", "intricacies", "nuanced", "multifaceted", "paradigm",
    "synergy", "holistic", "robust", "leverage", "juxtaposition", "dichotomy"
  ],
  es: [
    "de repente", "súbitamente", "crucial", "fundamental", "sin embargo",
    "no obstante", "por consiguiente", "asimismo", "además", "enigmático",
    "palpable", "tangible", "visceral", "desentrañar", "en aras de",
    "cabe destacar", "es menester", "en pos de", "a la sazón", "otrora"
  ],
  fr: [
    "soudain", "crucial", "essentiel", "néanmoins", "cependant", "toutefois",
    "ainsi", "par conséquent", "en effet", "d'ailleurs", "en outre", "de plus",
    "énigmatique", "palpable", "tangible", "viscéral", "résonner",
    "démystifier", "paradigme", "synergie", "holistique", "robuste"
  ],
  de: [
    "plötzlich", "entscheidend", "wesentlich", "nichtsdestotrotz", "jedoch",
    "dennoch", "folglich", "darüber hinaus", "außerdem", "rätselhaft",
    "greifbar", "spürbar", "eindringlich", "paradigmatisch", "ganzheitlich",
    "robust", "Synergie", "multifaktoriell", "nuanciert"
  ],
  it: [
    "improvvisamente", "cruciale", "fondamentale", "tuttavia", "nondimeno",
    "pertanto", "inoltre", "enigmatico", "palpabile", "tangibile", "viscerale",
    "egli", "ella", "esso", "essa", "essi", "esse", "costui", "costei",
    "codesto", "suddetto", "medesimo", "siffatto", "allorché", "allorquando",
    "indi", "quivi", "onde", "laonde", "giacché", "imperocché", "avvegnaché",
    "epperò", "altresì", "invero", "precipuamente", "segnatamente",
    "paradigmatico", "olistico", "robusto", "sinergia"
  ],
  pt: [
    "subitamente", "repentinamente", "crucial", "fundamental", "todavia",
    "contudo", "portanto", "além disso", "enigmático", "palpável", "tangível",
    "paradigmático", "holístico", "robusto", "sinergia", "multifacetado",
    "nuançado", "outrossim", "destarte", "mister"
  ],
  ca: [
    "sobtadament", "crucial", "fonamental", "tanmateix", "no obstant això",
    "per tant", "a més", "enigmàtic", "palpable", "tangible",
    "paradigmàtic", "holístic", "robust", "sinergia", "altrament"
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
      model: "deepseek-chat",
      useThinking: false,
      useTranslatorClient: true, // Use dedicated API key for parallel translation
    });
  }

  private applyFrenchTypography(text: string): string {
    let result = text;
    
    // 1. Normalize dialogue dashes: convert short dashes and double dashes to em dash
    result = result.replace(/^(\s*)(?:--|[-–])(\s*)/gm, '$1— ');
    
    // 2. Ensure em dash at dialogue start has single space after
    result = result.replace(/^(\s*)—\s*/gm, '$1— ');
    
    // 3. French punctuation: add non-breaking space BEFORE : ; ? !
    result = result.replace(/\s*([;:?!])/g, '\u00A0$1');
    
    // 4. French guillemets: space AFTER « and BEFORE »
    result = result.replace(/«\s*/g, '« ');
    result = result.replace(/\s*»/g, ' »');
    
    // 5. Convert dialogue guillemets to em dashes at line start
    result = result.replace(/^(\s*)«\s*([^»]+?)\s*»\s*,?\s*(dit|répondit|demanda|murmura|cria|chuchota|s'exclama|ajouta|reprit|interrompit|souffla|gémit|hurla|supplia)/gm, 
      '$1— $2, $3');
    
    // 6. Fix double spaces
    result = result.replace(/  +/g, ' ');
    
    // 7. Fix spacing after em dash at start (ensure exactly one space)
    result = result.replace(/^—\s{2,}/gm, '— ');
    
    console.log(`[Translator] Applied French typography rules`);
    return result;
  }

  private applySpanishTypography(text: string): string {
    let result = text;
    
    // 1. Normalize dialogue dashes to em dash (—) without space after
    result = result.replace(/^(\s*)(?:--|[-–])\s*/gm, '$1—');
    
    // 2. Ensure em dash at dialogue start has NO space after (Spanish style)
    result = result.replace(/^(\s*)—\s+/gm, '$1—');
    
    // 3. Convert dialogue with quotes to em dashes
    // «Hola» dijo María → —Hola —dijo María
    result = result.replace(/^(\s*)«([^»]+)»\s*,?\s*(dijo|respondió|preguntó|murmuró|gritó|susurró|exclamó|añadió|replicó|interrumpió)/gm,
      '$1—$2 —$3');
    // "Hola" dijo María → —Hola —dijo María
    result = result.replace(/^(\s*)"([^"]+)"\s*,?\s*(dijo|respondió|preguntó|murmuró|gritó|susurró|exclamó|añadió|replicó|interrumpió)/gm,
      '$1—$2 —$3');
    
    // 4. Fix double spaces
    result = result.replace(/  +/g, ' ');
    
    console.log(`[Translator] Applied Spanish typography rules`);
    return result;
  }

  private applyItalianTypography(text: string): string {
    let result = text;
    
    // 1. Normalize dialogue dashes to em dash (—) without space after
    result = result.replace(/^(\s*)(?:--|[-–])\s*/gm, '$1—');
    
    // 2. Ensure em dash at dialogue start has NO space after (Italian style like Spanish)
    result = result.replace(/^(\s*)—\s+/gm, '$1—');
    
    // 3. Convert dialogue with guillemets/quotes to em dashes
    result = result.replace(/^(\s*)«([^»]+)»\s*,?\s*(disse|rispose|domandò|mormorò|gridò|sussurrò|esclamò|aggiunse|replicò|interruppe)/gm,
      '$1—$2 —$3');
    result = result.replace(/^(\s*)"([^"]+)"\s*,?\s*(disse|rispose|domandò|mormorò|gridò|sussurrò|esclamò|aggiunse|replicò|interruppe)/gm,
      '$1—$2 —$3');
    
    // 4. Fix double spaces
    result = result.replace(/  +/g, ' ');
    
    console.log(`[Translator] Applied Italian typography rules`);
    return result;
  }

  private applyPortugueseTypography(text: string): string {
    let result = text;
    
    // 1. Normalize dialogue dashes to em dash (—) WITH space after (Portuguese style)
    result = result.replace(/^(\s*)(?:--|[-–])(\s*)/gm, '$1— ');
    
    // 2. Ensure em dash at dialogue start has single space after
    result = result.replace(/^(\s*)—\s*/gm, '$1— ');
    
    // 3. Convert dialogue with quotes to em dashes
    result = result.replace(/^(\s*)"([^"]+)"\s*,?\s*(disse|respondeu|perguntou|murmurou|gritou|sussurrou|exclamou|acrescentou|replicou|interrompeu)/gm,
      '$1— $2 — $3');
    
    // 4. Fix double spaces
    result = result.replace(/  +/g, ' ');
    
    // 5. Fix spacing after em dash (ensure exactly one space)
    result = result.replace(/^—\s{2,}/gm, '— ');
    
    console.log(`[Translator] Applied Portuguese typography rules`);
    return result;
  }

  private applyCatalanTypography(text: string): string {
    let result = text;
    
    // 1. Normalize dialogue dashes to em dash (—) without space after
    result = result.replace(/^(\s*)(?:--|[-–])\s*/gm, '$1—');
    
    // 2. Ensure em dash at dialogue start has NO space after (like Spanish)
    result = result.replace(/^(\s*)—\s+/gm, '$1—');
    
    // 3. Convert dialogue with guillemets/quotes to em dashes
    result = result.replace(/^(\s*)«([^»]+)»\s*,?\s*(va dir|va respondre|va preguntar|va murmurar|va cridar|va xiuxiuejar|va exclamar|va afegir|va replicar|va interrompre)/gm,
      '$1—$2 —$3');
    
    // 4. Remove opening ¿ and ¡ (Catalan doesn't use them)
    result = result.replace(/¿/g, '');
    result = result.replace(/¡/g, '');
    
    // 5. Fix double spaces
    result = result.replace(/  +/g, ' ');
    
    console.log(`[Translator] Applied Catalan typography rules`);
    return result;
  }

  private applyGermanTypography(text: string): string {
    let result = text;
    
    // 1. Convert English straight quotes to German quotes „..."
    // Opening quote at start of dialogue
    result = result.replace(/"([^"]+)"/g, '„$1"');
    
    // 2. Convert French guillemets to German quotes
    result = result.replace(/«([^»]+)»/g, '„$1"');
    result = result.replace(/»([^«]+)«/g, '„$1"');
    
    // 3. Fix any chevrons used incorrectly
    result = result.replace(/»/g, '"');
    result = result.replace(/«/g, '„');
    
    // 4. Fix double spaces
    result = result.replace(/  +/g, ' ');
    
    console.log(`[Translator] Applied German typography rules`);
    return result;
  }

  private normalizeChapterHeaders(text: string, targetLanguage: string): string {
    let result = text;
    
    // Language-specific chapter labels
    const chapterLabels: Record<string, { chapter: string, prologue: string, epilogue: string }> = {
      es: { chapter: 'Capítulo', prologue: 'Prólogo', epilogue: 'Epílogo' },
      en: { chapter: 'Chapter', prologue: 'Prologue', epilogue: 'Epilogue' },
      'en-US': { chapter: 'Chapter', prologue: 'Prologue', epilogue: 'Epilogue' },
      'en-GB': { chapter: 'Chapter', prologue: 'Prologue', epilogue: 'Epilogue' },
      fr: { chapter: 'Chapitre', prologue: 'Prologue', epilogue: 'Épilogue' },
      de: { chapter: 'Kapitel', prologue: 'Prolog', epilogue: 'Epilog' },
      it: { chapter: 'Capitolo', prologue: 'Prologo', epilogue: 'Epilogo' },
      pt: { chapter: 'Capítulo', prologue: 'Prólogo', epilogue: 'Epílogo' },
      'pt-PT': { chapter: 'Capítulo', prologue: 'Prólogo', epilogue: 'Epílogo' },
      'pt-BR': { chapter: 'Capítulo', prologue: 'Prólogo', epilogue: 'Epílogo' },
      ca: { chapter: 'Capítol', prologue: 'Pròleg', epilogue: 'Epíleg' },
    };
    
    const labels = chapterLabels[targetLanguage] || chapterLabels['en'];
    
    // 1. Remove separator lines (---, ===, ***)
    result = result.replace(/^[-=*]{3,}\s*$/gm, '');
    
    // 2. Convert H2/H3 chapter headers to H1
    // Match: ## Capítulo 1: Title or ### Chapter 1 - Title etc.
    const chapterPatterns = [
      // Multi-hash to single hash
      /^#{2,}\s*((?:Capítulo|Chapter|Chapitre|Kapitel|Capitolo|Capítol)\s+\d+)/gmi,
      /^#{2,}\s*((?:Prólogo|Prologue|Prolog|Prologo|Pròleg))/gmi,
      /^#{2,}\s*((?:Epílogo|Epilogue|Epilog|Epilogo|Epíleg|Épilogue))/gmi,
    ];
    
    for (const pattern of chapterPatterns) {
      result = result.replace(pattern, '# $1');
    }
    
    // 3. Normalize chapter format: "# Chapter X: Title" (with colon, not dash)
    // Pattern: # Capítulo 1 - Título -> # Capítulo 1: Título
    result = result.replace(/^#\s*((?:Capítulo|Chapter|Chapitre|Kapitel|Capitolo|Capítol)\s+\d+)\s*[-–—]\s*/gmi, 
      '# $1: ');
    
    // 4. Fix all-caps titles after chapter number
    // Match: # Capítulo 1: TÍTULO EN MAYÚSCULAS and convert to Title Case
    result = result.replace(/^(#\s*(?:Capítulo|Chapter|Chapitre|Kapitel|Capitolo|Capítol)\s+\d+:\s*)([A-ZÁÉÍÓÚÀÈÌÒÙÄÖÜÂÊÎÔÛÑÇ\s]+)$/gm,
      (match, prefix, title) => {
        // Convert to sentence case (first letter uppercase, rest lowercase)
        const titleLower = title.toLowerCase();
        const titleCase = titleLower.charAt(0).toUpperCase() + titleLower.slice(1);
        return prefix + titleCase;
      }
    );
    
    // 5. Remove empty lines created by separator removal
    result = result.replace(/\n{3,}/g, '\n\n');
    
    console.log(`[Translator] Normalized chapter headers for ${targetLanguage}`);
    return result;
  }

  private cleanTranslatedText(content: string, targetLanguage?: string): string {
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
          cleaned = this.cleanTranslatedText(parsed.translated_text, targetLanguage);
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
    
    // Apply language-specific typography rules
    if (targetLanguage) {
      switch (targetLanguage) {
        case 'fr':
          cleaned = this.applyFrenchTypography(cleaned);
          break;
        case 'es':
          cleaned = this.applySpanishTypography(cleaned);
          break;
        case 'it':
          cleaned = this.applyItalianTypography(cleaned);
          break;
        case 'pt':
        case 'pt-PT':
        case 'pt-BR':
          cleaned = this.applyPortugueseTypography(cleaned);
          break;
        case 'ca':
          cleaned = this.applyCatalanTypography(cleaned);
          break;
        case 'de':
          cleaned = this.applyGermanTypography(cleaned);
          break;
      }
      
      // Always normalize chapter headers for all languages
      cleaned = this.normalizeChapterHeaders(cleaned, targetLanguage);
    }
    
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
        // CRITICAL: Clean the translated text to remove any code artifacts + apply language-specific typography
        const cleanedText = this.cleanTranslatedText(result.translated_text, input.targetLanguage);
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

    // Fallback: clean the raw content before returning + apply language-specific typography
    const cleanedFallback = this.cleanTranslatedText(response.content, input.targetLanguage);
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
