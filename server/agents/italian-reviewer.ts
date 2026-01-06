import { BaseAgent, AgentResponse } from "./base-agent";

interface ItalianReviewInput {
  chapterContent: string;
  chapterNumber: number;
}

export interface ItalianReviewResult {
  valutazione_generale: string;
  punteggio_fluidita: number;
  problemi_identificati: {
    categoria: string;
    descrizione: string;
    esempio_originale: string;
    suggerimento: string;
    priorita: "alta" | "media" | "bassa";
  }[];
  testo_corretto: string;
}

const SYSTEM_PROMPT = `
Sei un editor letterario italiano di altissimo livello, specializzato nella narrativa contemporanea. 
Il tuo compito è analizzare testi in italiano e identificare problemi di naturalezza, fluidità e stile.

AREE DI ANALISI:

1. FRASI TROPPO LUNGHE
   - Identifica frasi che superano le 40-50 parole
   - Suggerisci come dividerle mantenendo il ritmo narrativo

2. RIPETIZIONI LESSICALI
   - Parole ripetute troppo vicine (stesso paragrafo o paragrafi adiacenti)
   - Concetti ridondanti espressi con parole diverse
   - Strutture sintattiche ripetitive

3. COSTRUZIONI INNATURALI
   - "Egli/Ella" → troppo formale per narrativa moderna, preferire il soggetto implicito o "lui/lei"
   - Forme passive evitabili
   - Ordine delle parole che suona tradotto dall'inglese
   - Espressioni che un italiano nativo non userebbe mai

4. COERENZA DEI TEMPI VERBALI
   - Salti ingiustificati tra passato remoto, imperfetto e presente
   - Uso del congiuntivo dove necessario

5. DIALOGHI E PUNTEGGIATURA (CRITICO)
   - Standard per narrativa italiana: ESCLUSIVAMENTE trattino lungo (—) per introdurre i dialoghi
   - MAI usare virgolette di nessun tipo ("", «», <<>>)
   - Esempio corretto: —Ciao —disse Maria—. Come stai?
   - Se trovi virgolette, segnalarlo come problema ALTA priorità

6. REGISTRO STILISTICO
   - Miscele inappropriate di registro formale/informale
   - Termini tecnici o burocratici in contesti narrativi

OUTPUT RICHIESTO (JSON):
{
  "valutazione_generale": "Breve valutazione complessiva del testo (2-3 frasi)",
  "punteggio_fluidita": 8,  // da 1 a 10
  "problemi_identificati": [
    {
      "categoria": "Frase troppo lunga",
      "descrizione": "Spiegazione del problema",
      "esempio_originale": "Il testo originale problematico...",
      "suggerimento": "Come riscriverlo in modo più naturale...",
      "priorita": "alta"
    }
  ],
  "testo_corretto": "Il testo completo del capitolo con tutte le correzioni applicate"
}

IMPORTANTE:
- Non inventare problemi. Segnala solo quelli reali e significativi.
- Mantieni la voce narrativa dell'autore.
- Ordina i problemi per priorità (alta → media → bassa).
- Il "testo_corretto" deve contenere TUTTO il capitolo, non riassunti.
`;

export class ItalianReviewerAgent extends BaseAgent {
  constructor() {
    super({
      name: "Revisore Italiano",
      role: "italian-reviewer",
      systemPrompt: SYSTEM_PROMPT,
      model: "gemini-2.5-flash",
      useThinking: false,
    });
  }

  async execute(input: ItalianReviewInput): Promise<AgentResponse & { result?: ItalianReviewResult }> {
    const prompt = `
Analizza il seguente capitolo in italiano e identifica tutti i problemi di naturalezza e fluidità.

CAPITOLO ${input.chapterNumber}:

${input.chapterContent}

Rispondi SOLO con il JSON strutturato come specificato nel system prompt.
`;

    const response = await this.generateContent(prompt);
    
    try {
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]) as ItalianReviewResult;
        return { ...response, result };
      }
    } catch (e) {
      console.error("[ItalianReviewer] Failed to parse JSON response:", e);
    }

    return { 
      ...response, 
      result: undefined 
    };
  }
}
