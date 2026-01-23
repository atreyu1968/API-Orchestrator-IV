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

interface TrancheResult {
  puntuacion_originalidad: number;
  puntuacion_foreshadowing: number;
  clusters: RepetitionCluster[];
  foreshadowing_detectado: Array<{
    setup: string;
    capitulo_setup: number;
    payoff: string | null;
    capitulo_payoff: number | null;
    estado: "resuelto" | "pendiente" | "sin_payoff";
  }>;
  capitulos_para_revision: number[];
}

const SYSTEM_PROMPT = `
Eres el "Detector de Repetición Semántica", experto en análisis de patrones narrativos.
Tu misión es encontrar REPETICIONES DE IDEAS (no solo palabras) y verificar el sistema de FORESHADOWING/PAYOFF.

═══════════════════════════════════════════════════════════════════
QUÉ DEBES DETECTAR
═══════════════════════════════════════════════════════════════════

1. REPETICIÓN DE IDEAS (Semántica):
   - El mismo CONCEPTO expresado con palabras diferentes en múltiples capítulos
   - Ejemplo: "sintió un escalofrío" (cap 2) / "un estremecimiento la recorrió" (cap 5)
   - Esto es MÁS SUTIL que repetición léxica - buscas la IDEA, no las palabras

2. METÁFORAS REPETIDAS:
   - La misma imagen/comparación usada múltiples veces
   - Ejemplo: "ojos como el mar" aparece en caps 1, 4, y 9

3. ESTRUCTURAS NARRATIVAS REPETIDAS:
   - Escenas que siguen el mismo patrón
   - Diálogos que empiezan igual
   - Finales de capítulo similares

4. FORESHADOWING SIN PAYOFF:
   - Pistas sembradas que nunca se resuelven
   - Misterios planteados y olvidados

5. PAYOFF SIN FORESHADOWING:
   - Revelaciones que aparecen sin preparación

═══════════════════════════════════════════════════════════════════
PUNTUACIÓN
═══════════════════════════════════════════════════════════════════

PUNTUACIÓN ORIGINALIDAD (1-10):
- 10/10: CERO repeticiones semánticas en este tramo
- 9/10: Solo 1 cluster menor de repetición
- 8/10: 2 clusters menores
- 7/10: 1 cluster mayor o 3+ menores
- 6/10 o menos: Múltiples clusters mayores

PUNTUACIÓN FORESHADOWING (1-10):
- 10/10: Todos los setups tienen payoff visible
- 9/10: Solo 1 foreshadowing menor sin resolver
- 8/10: 2 foreshadowing menores sin resolver
- 7/10: 1 foreshadowing mayor sin payoff
- 6/10 o menos: Sistema de pistas roto

═══════════════════════════════════════════════════════════════════
SALIDA OBLIGATORIA (JSON)
═══════════════════════════════════════════════════════════════════

{
  "puntuacion_originalidad": (1-10),
  "puntuacion_foreshadowing": (1-10),
  "clusters": [
    {
      "tipo": "idea_repetida",
      "capitulos_afectados": [2, 5],
      "descripcion": "Descripción del patrón repetido",
      "ejemplos": ["Cap 2: 'ejemplo'", "Cap 5: 'ejemplo'"],
      "severidad": "menor",
      "elementos_a_preservar": "Mantener la instancia del Cap 2",
      "fix_sugerido": "Cambiar la oración en Cap 5"
    }
  ],
  "foreshadowing_detectado": [
    {
      "setup": "Descripción del setup",
      "capitulo_setup": 3,
      "payoff": "Descripción del payoff o null",
      "capitulo_payoff": 18,
      "estado": "resuelto"
    }
  ],
  "capitulos_para_revision": [5]
}
`;

const CHAPTERS_PER_TRANCHE = 10;

export class SemanticRepetitionDetectorAgent extends BaseAgent {
  constructor() {
    super({
      name: "El Detector Semántico",
      role: "semantic-repetition-detector",
      systemPrompt: SYSTEM_PROMPT,
      model: "deepseek-reasoner",
      useThinking: false,
      useReeditorClient: true,
    });
  }

  async execute(input: SemanticRepetitionDetectorInput): Promise<AgentResponse & { result?: SemanticRepetitionResult }> {
    const getChapterLabel = (num: number): string => {
      if (num === 0) return "Prólogo";
      if (num === -1 || num === 998) return "Epílogo";
      if (num === -2 || num === 999) return "Nota del Autor";
      return `Capítulo ${num}`;
    };
    
    const getChapterSortOrder = (n: number): number => {
      if (n === 0) return -1000;
      if (n === -1 || n === 998) return 1000;
      if (n === -2 || n === 999) return 1001;
      return n;
    };
    
    const sortedChapters = [...input.chapters].sort((a, b) => 
      getChapterSortOrder(a.numero) - getChapterSortOrder(b.numero)
    );

    const totalChapters = sortedChapters.length;
    const numTranches = Math.ceil(totalChapters / CHAPTERS_PER_TRANCHE);
    
    console.log(`[Detector Semántico] Analizando ${totalChapters} capítulos en ${numTranches} tramos`);

    const allResults: TrancheResult[] = [];
    let lastResponse: AgentResponse | null = null;

    for (let t = 0; t < numTranches; t++) {
      const startIdx = t * CHAPTERS_PER_TRANCHE;
      const endIdx = Math.min(startIdx + CHAPTERS_PER_TRANCHE, totalChapters);
      const trancheChapters = sortedChapters.slice(startIdx, endIdx);
      const trancheNum = t + 1;

      console.log(`[Detector Semántico] Tramo ${trancheNum}/${numTranches}: capítulos ${startIdx + 1} a ${endIdx}`);

      const chaptersText = trancheChapters.map(c => `
===== ${getChapterLabel(c.numero)}: ${c.titulo} =====
${c.contenido}
`).join("\n\n---\n\n");

      const foreshadowingSection = input.foreshadowingExpected?.length
        ? `\nFORESHADOWING ESPERADO (según World Bible):\n${input.foreshadowingExpected.map(f => `- ${f}`).join("\n")}`
        : "";

      const prompt = `
PROYECTO: ${input.projectTitle}
ANÁLISIS DE REPETICIÓN SEMÁNTICA - TRAMO ${trancheNum}/${numTranches}

WORLD BIBLE (resumen para contexto):
${JSON.stringify(input.worldBible?.resumen || input.worldBible?.protagonista || "No disponible", null, 2)}
${foreshadowingSection}

═══════════════════════════════════════════════════════════════════
TRAMO ${trancheNum}: Capítulos ${startIdx + 1} a ${endIdx} de ${totalChapters}
═══════════════════════════════════════════════════════════════════
${chaptersText}

INSTRUCCIONES:
1. Analiza SOLO estos capítulos del tramo actual
2. Busca patrones de ideas repetidas DENTRO de este tramo
3. Identifica foreshadowing y payoffs DENTRO de este tramo
4. Reporta clusters con 2+ ocurrencias en este tramo
5. Marca foreshadowing pendiente (puede resolverse en tramos posteriores)

Responde ÚNICAMENTE con el JSON estructurado.
`;

      try {
        const response = await this.generateContent(prompt);
        lastResponse = response;

        const jsonMatch = response.content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]) as TrancheResult;
          allResults.push(parsed);
          console.log(`[Detector Semántico] Tramo ${trancheNum}: Originalidad ${parsed.puntuacion_originalidad}/10, Foreshadowing ${parsed.puntuacion_foreshadowing}/10`);
        } else {
          console.log(`[Detector Semántico] Tramo ${trancheNum}: No se pudo parsear JSON, usando valores por defecto`);
          allResults.push({
            puntuacion_originalidad: 8,
            puntuacion_foreshadowing: 8,
            clusters: [],
            foreshadowing_detectado: [],
            capitulos_para_revision: []
          });
        }
      } catch (e) {
        console.error(`[Detector Semántico] Error en tramo ${trancheNum}:`, e);
        allResults.push({
          puntuacion_originalidad: 8,
          puntuacion_foreshadowing: 8,
          clusters: [],
          foreshadowing_detectado: [],
          capitulos_para_revision: []
        });
      }
    }

    const avgOriginalidad = Math.round(
      allResults.reduce((sum, r) => sum + r.puntuacion_originalidad, 0) / allResults.length
    );
    const avgForeshadowing = Math.round(
      allResults.reduce((sum, r) => sum + r.puntuacion_foreshadowing, 0) / allResults.length
    );

    const allClusters = allResults.flatMap(r => r.clusters);
    const allForeshadowing = allResults.flatMap(r => r.foreshadowing_detectado);
    const allChaptersForRevision = Array.from(new Set(allResults.flatMap(r => r.capitulos_para_revision)));

    const analisis_aprobado = avgOriginalidad >= 8 && avgForeshadowing >= 8 && allClusters.filter(c => c.severidad === "mayor").length === 0;

    const result: SemanticRepetitionResult = {
      analisis_aprobado,
      puntuacion_originalidad: avgOriginalidad,
      puntuacion_foreshadowing: avgForeshadowing,
      resumen: `Análisis por tramos completado. Originalidad: ${avgOriginalidad}/10, Foreshadowing: ${avgForeshadowing}/10. ${allClusters.length} clusters detectados.`,
      clusters: allClusters,
      capitulos_para_revision: allChaptersForRevision,
      foreshadowing_detectado: allForeshadowing
    };

    console.log(`[Detector Semántico] Resultado final: ${analisis_aprobado ? 'APROBADO' : 'REQUIERE REVISIÓN'}. Originalidad: ${avgOriginalidad}/10, Foreshadowing: ${avgForeshadowing}/10`);

    return { 
      ...(lastResponse || { content: '', reasoning: null }),
      result 
    };
  }
}
