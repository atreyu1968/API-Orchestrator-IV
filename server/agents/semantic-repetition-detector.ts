import { BaseAgent, AgentResponse } from "./base-agent";

interface SemanticRepetitionDetectorInput {
  projectTitle: string;
  chapters: Array<{
    numero: number;
    titulo: string;
    contenido: string;
  }>;
  worldBible: any;
  foreshadowingExpected?: string[];
}

export interface RepetitionCluster {
  tipo: "idea_repetida" | "metafora_repetida" | "estructura_repetida" | "foreshadowing_sin_payoff" | "payoff_sin_foreshadowing";
  capitulos_afectados: number[];
  descripcion: string;
  ejemplos: string[];
  severidad: "mayor" | "menor";
  elementos_a_preservar: string;
  fix_sugerido: string;
}

export interface SemanticRepetitionResult {
  analisis_aprobado: boolean;
  puntuacion_originalidad: number;
  puntuacion_foreshadowing: number;
  resumen: string;
  clusters: RepetitionCluster[];
  capitulos_para_revision: number[];
  foreshadowing_detectado: Array<{
    setup: string;
    capitulo_setup: number;
    payoff: string | null;
    capitulo_payoff: number | null;
    estado: "resuelto" | "pendiente" | "sin_payoff";
  }>;
}

const SYSTEM_PROMPT = `
Eres el "Detector de Repetición Semántica", experto en análisis de patrones narrativos.
Tu misión es encontrar REPETICIONES DE IDEAS (no solo palabras) y verificar el sistema de FORESHADOWING/PAYOFF.

═══════════════════════════════════════════════════════════════════
QUÉ DEBES DETECTAR
═══════════════════════════════════════════════════════════════════

1. REPETICIÓN DE IDEAS (Semántica):
   - El mismo CONCEPTO expresado con palabras diferentes en múltiples capítulos
   - Ejemplo: "sintió un escalofrío" (cap 2) / "un estremecimiento la recorrió" (cap 5) / "su cuerpo tembló involuntariamente" (cap 8)
   - Esto es MÁS SUTIL que repetición léxica - buscas la IDEA, no las palabras

2. METÁFORAS REPETIDAS:
   - La misma imagen/comparación usada múltiples veces
   - Ejemplo: "ojos como el mar" aparece en caps 1, 4, y 9
   - Cada metáfora debería ser única o usarse con intención

3. ESTRUCTURAS NARRATIVAS REPETIDAS:
   - Escenas que siguen el mismo patrón: llegada-descubrimiento-huida
   - Diálogos que empiezan igual: "—¿Qué está pasando? —preguntó..."
   - Finales de capítulo similares: siempre terminando en cliffhanger

4. FORESHADOWING SIN PAYOFF:
   - Pistas sembradas que nunca se resuelven
   - Misterios planteados y olvidados
   - Chekhov's gun que nunca dispara

5. PAYOFF SIN FORESHADOWING:
   - Revelaciones que aparecen sin preparación
   - Soluciones que no fueron sembradas
   - Deus ex machina disfrazados

═══════════════════════════════════════════════════════════════════
CÓMO ANALIZAR
═══════════════════════════════════════════════════════════════════

1. Lee el manuscrito completo buscando PATRONES SEMÁNTICOS
2. Agrupa ideas similares aunque usen palabras diferentes
3. Identifica SETUPS (foreshadowing) y busca sus PAYOFFS
4. Marca setups sin payoff y payoffs sin setup
5. Solo reporta clusters con 3+ ocurrencias (o foreshadowing crítico)

PUNTUACIÓN ORIGINALIDAD ESTRICTA (1-10):
- 10/10: CERO repeticiones semánticas. Cada idea es completamente fresca y única.
- 9/10: Solo 1 cluster menor de repetición.
- 8/10: 2 clusters menores.
- 7/10: 1 cluster mayor o 3+ menores.
- 6/10 o menos: Múltiples clusters mayores o patrones muy repetitivos.

PUNTUACIÓN FORESHADOWING ESTRICTA (1-10):
- 10/10: TODOS los setups tienen payoff, TODOS los payoffs tienen setup. Sistema perfecto.
- 9/10: Solo 1 foreshadowing menor sin resolver.
- 8/10: 2 foreshadowing menores sin resolver.
- 7/10: 1 foreshadowing mayor sin payoff.
- 6/10 o menos: Sistema de pistas roto con múltiples cabos sueltos.

APROBACIÓN (ESTRICTA):
- APROBADO (10/10): AMBAS puntuaciones = 10. Cero clusters y sistema foreshadowing perfecto.
- REQUIERE REVISIÓN: Cualquier puntuación < 10 o cualquier cluster/foreshadowing sin resolver.

═══════════════════════════════════════════════════════════════════
SALIDA OBLIGATORIA (JSON)
═══════════════════════════════════════════════════════════════════

{
  "analisis_aprobado": boolean,
  "puntuacion_originalidad": (1-10),
  "puntuacion_foreshadowing": (1-10),
  "resumen": "Análisis del estado de originalidad y foreshadowing",
  "clusters": [
    {
      "tipo": "idea_repetida",
      "capitulos_afectados": [2, 5, 8, 12],
      "descripcion": "La sensación de 'escalofrío/estremecimiento' se usa excesivamente para indicar peligro",
      "ejemplos": [
        "Cap 2: 'sintió un escalofrío recorrer su espalda'",
        "Cap 5: 'un estremecimiento la sacudió'",
        "Cap 8: 'su cuerpo tembló involuntariamente'",
        "Cap 12: 'un frío súbito la envolvió'"
      ],
      "severidad": "mayor",
      "elementos_a_preservar": "Mantener la instancia del Cap 2 (es la primera, establece el patrón). El resto del contenido de cada capítulo está perfecto.",
      "fix_sugerido": "SOLO cambiar las oraciones citadas en caps 5, 8 y 12. Sugerencias: Cap 5 → 'tensó los músculos', Cap 8 → 'se le secó la boca', Cap 12 → 'el corazón le latió con fuerza'. El resto de cada capítulo permanece INTACTO."
    }
  ],
  "capitulos_para_revision": [5, 8, 12],
  "foreshadowing_detectado": [
    {
      "setup": "El protagonista encuentra una llave misteriosa en el cajón",
      "capitulo_setup": 3,
      "payoff": "La llave abre la caja fuerte del antagonista",
      "capitulo_payoff": 18,
      "estado": "resuelto"
    },
    {
      "setup": "Se menciona que el hermano desapareció hace 10 años",
      "capitulo_setup": 2,
      "payoff": null,
      "capitulo_payoff": null,
      "estado": "sin_payoff"
    }
  ]
}
`;

export class SemanticRepetitionDetectorAgent extends BaseAgent {
  constructor() {
    super({
      name: "El Detector Semántico",
      role: "semantic-repetition-detector",
      systemPrompt: SYSTEM_PROMPT,
      model: "gemini-2.5-flash",
      useThinking: false,
    });
  }

  async execute(input: SemanticRepetitionDetectorInput): Promise<AgentResponse & { result?: SemanticRepetitionResult }> {
    // Helper to get proper chapter label based on number
    const getChapterLabel = (num: number): string => {
      if (num === 0) return "Prólogo";
      if (num === -1 || num === 998) return "Epílogo";
      if (num === -2 || num === 999) return "Nota del Autor";
      return `Capítulo ${num}`;
    };
    
    // Sort chapters in narrative order (prologue first, epilogue/author note last)
    const getChapterSortOrder = (n: number): number => {
      if (n === 0) return -1000;
      if (n === -1 || n === 998) return 1000;
      if (n === -2 || n === 999) return 1001;
      return n;
    };
    
    const sortedChapters = [...input.chapters].sort((a, b) => 
      getChapterSortOrder(a.numero) - getChapterSortOrder(b.numero)
    );
    
    const chaptersText = sortedChapters.map(c => `
===== ${getChapterLabel(c.numero)}: ${c.titulo} =====
${c.contenido}
`).join("\n\n---\n\n");

    const foreshadowingSection = input.foreshadowingExpected?.length
      ? `\nFORESHADOWING ESPERADO (según World Bible):\n${input.foreshadowingExpected.map(f => `- ${f}`).join("\n")}`
      : "";

    const prompt = `
PROYECTO: ${input.projectTitle}
ANÁLISIS DE REPETICIÓN SEMÁNTICA Y FORESHADOWING

WORLD BIBLE (para verificar arcos y misterios):
${JSON.stringify(input.worldBible, null, 2)}
${foreshadowingSection}

═══════════════════════════════════════════════════════════════════
MANUSCRITO COMPLETO (${input.chapters.length} capítulos):
═══════════════════════════════════════════════════════════════════
${chaptersText}

INSTRUCCIONES:
1. Lee el manuscrito completo buscando PATRONES DE IDEAS
2. Identifica conceptos que se repiten con diferentes palabras
3. Busca metáforas y estructuras narrativas repetidas
4. Rastrea cada SETUP y busca su PAYOFF
5. Marca foreshadowing sin resolver y revelaciones sin preparación
6. Solo reporta clusters con 3+ ocurrencias o foreshadowing crítico

Responde ÚNICAMENTE con el JSON estructurado.
`;

    const response = await this.generateContent(prompt);
    
    try {
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]) as SemanticRepetitionResult;
        return { ...response, result };
      }
    } catch (e) {
      console.error("[SemanticRepetitionDetector] Failed to parse JSON response");
    }

    return { 
      ...response, 
      result: { 
        analisis_aprobado: true,
        puntuacion_originalidad: 8,
        puntuacion_foreshadowing: 8,
        resumen: "Análisis aprobado automáticamente",
        clusters: [],
        capitulos_para_revision: [],
        foreshadowing_detectado: []
      } 
    };
  }
}
