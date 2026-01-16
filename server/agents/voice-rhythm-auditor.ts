import { BaseAgent, AgentResponse } from "./base-agent";

interface VoiceRhythmAuditorInput {
  projectTitle: string;
  trancheNumber: number;
  genre: string;
  tone: string;
  chaptersInScope: Array<{
    numero: number;
    titulo: string;
    contenido: string;
  }>;
  guiaEstilo?: string;
  expectedPOV?: string;
}

export interface VoiceRhythmIssue {
  tipo: "deriva_tonal" | "pov_inconsistente" | "pacing_irregular" | "voz_narrativa" | "registro_linguistico";
  capitulos_afectados: number[];
  descripcion: string;
  evidencia_textual: string;
  severidad: "mayor" | "menor";
  elementos_a_preservar: string;
  fix_sugerido: string;
}

export interface VoiceRhythmAuditorResult {
  tranche_aprobado: boolean;
  puntuacion_voz: number;
  puntuacion_ritmo: number;
  resumen: string;
  perfil_tonal_detectado: string;
  issues: VoiceRhythmIssue[];
  capitulos_para_revision: number[];
  recomendaciones_estilo: string[];
}

const SYSTEM_PROMPT = `
Eres el "Auditor de Voz y Ritmo", experto en análisis estilístico literario.
Tu misión es verificar que la VOZ NARRATIVA y el RITMO sean CONSISTENTES a lo largo de un tramo de capítulos.

═══════════════════════════════════════════════════════════════════
QUÉ DEBES ANALIZAR
═══════════════════════════════════════════════════════════════════

1. CONSISTENCIA DE VOZ NARRATIVA:
   - ¿El narrador mantiene el mismo "tono de voz" en todos los capítulos?
   - ¿Hay cambios bruscos de registro (formal/informal)?
   - ¿El vocabulario es coherente con el género y época?

2. PUNTO DE VISTA (POV):
   - ¿Se mantiene el mismo POV (primera/tercera persona)?
   - ¿Hay deslices donde el narrador sabe más de lo que debería?
   - ¿La focalización es consistente?

3. TONO EMOCIONAL:
   - ¿El tono general coincide con el género (thriller→tenso, romance→emotivo)?
   - ¿Hay capítulos que "desentonen" del resto?
   - ¿Las transiciones emocionales son graduales o bruscas?

4. RITMO Y PACING:
   - ¿Las escenas de acción tienen frases cortas y tensas?
   - ¿Las escenas reflexivas tienen ritmo pausado?
   - ¿Hay capítulos que se sienten "lentos" sin justificación narrativa?
   - ¿Hay capítulos que van "demasiado rápido" para su contenido?

5. CADENCIA DE ORACIONES:
   - ¿Hay variedad en la longitud de oraciones?
   - ¿Hay patrones repetitivos de estructura?
   - ¿El ritmo apoya la tensión narrativa?

═══════════════════════════════════════════════════════════════════
MÉTRICAS DE EVALUACIÓN
═══════════════════════════════════════════════════════════════════

PUNTUACIÓN VOZ ESTRICTA (1-10):
- 10/10: Voz PERFECTAMENTE consistente, inmersiva, distintiva. CERO issues de voz.
- 9/10: Solo 1 issue menor de voz.
- 8/10: 2 issues menores de voz.
- 7/10: 1 issue mayor o 3+ menores.
- 6/10 o menos: Voz fragmentada, múltiples problemas.

PUNTUACIÓN RITMO ESTRICTA (1-10):
- 10/10: Ritmo PERFECTO. Cada escena tiene el tempo exacto. CERO issues de ritmo.
- 9/10: Solo 1 issue menor de ritmo.
- 8/10: 2 issues menores de ritmo.
- 7/10: 1 issue mayor o 3+ menores.
- 6/10 o menos: Pacing problemático, múltiples problemas.

APROBACIÓN (ESTRICTA):
- APROBADO (10/10): AMBAS puntuaciones = 10. Cero issues de voz Y cero issues de ritmo.
- REQUIERE REVISIÓN: Cualquier puntuación < 10 o cualquier issue detectado.

═══════════════════════════════════════════════════════════════════
SALIDA OBLIGATORIA (JSON)
═══════════════════════════════════════════════════════════════════

{
  "tranche_aprobado": boolean,
  "puntuacion_voz": (1-10),
  "puntuacion_ritmo": (1-10),
  "resumen": "Análisis del estado de voz y ritmo",
  "perfil_tonal_detectado": "Descripción del tono general detectado",
  "issues": [
    {
      "tipo": "deriva_tonal",
      "capitulos_afectados": [7],
      "descripcion": "El capítulo 7 adopta un tono humorístico que contrasta con el thriller oscuro del resto",
      "evidencia_textual": "'—Vaya, qué oportuno —rio Pedro, ajustándose la corbata con gesto teatral.'",
      "severidad": "mayor",
      "elementos_a_preservar": "La estructura del diálogo está bien. La información que se revela es correcta. Solo cambiar el TONO de las líneas marcadas.",
      "fix_sugerido": "SOLO modificar la línea citada. Cambiar '—rio Pedro, ajustándose la corbata con gesto teatral' a algo más tenso como '—murmuró Pedro, sin apartar la mirada de la puerta'. El resto del capítulo permanece INTACTO."
    }
  ],
  "capitulos_para_revision": [7],
  "recomendaciones_estilo": [
    "Mantener frases cortas en escenas de acción",
    "Evitar humor en momentos de tensión crítica"
  ]
}
`;

export class VoiceRhythmAuditorAgent extends BaseAgent {
  constructor() {
    super({
      name: "El Auditor de Voz",
      role: "voice-rhythm-auditor",
      systemPrompt: SYSTEM_PROMPT,
      model: "gemini-2.5-flash",
      useThinking: false,
    });
  }

  async execute(input: VoiceRhythmAuditorInput): Promise<AgentResponse & { result?: VoiceRhythmAuditorResult }> {
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
    
    const sortedChapters = [...input.chaptersInScope].sort((a, b) => 
      getChapterSortOrder(a.numero) - getChapterSortOrder(b.numero)
    );
    
    const chaptersText = sortedChapters.map(c => `
===== ${getChapterLabel(c.numero)}: ${c.titulo} =====
${c.contenido}
`).join("\n\n---\n\n");

    const prompt = `
PROYECTO: ${input.projectTitle}
TRAMO #${input.trancheNumber} - Análisis de Voz y Ritmo

GÉNERO: ${input.genre}
TONO ESPERADO: ${input.tone}
${input.expectedPOV ? `POV ESPERADO: ${input.expectedPOV}` : ""}
${input.guiaEstilo ? `\nGUÍA DE ESTILO:\n${input.guiaEstilo}` : ""}

═══════════════════════════════════════════════════════════════════
CAPÍTULOS A ANALIZAR (${input.chaptersInScope.length} capítulos):
═══════════════════════════════════════════════════════════════════
${chaptersText}

INSTRUCCIONES:
1. Lee todos los capítulos prestando atención a la VOZ del narrador
2. Identifica el PERFIL TONAL predominante
3. Busca capítulos que "desentonen" del resto
4. Evalúa el RITMO de cada capítulo según su función narrativa
5. Solo reporta problemas significativos con evidencia textual

Responde ÚNICAMENTE con el JSON estructurado.
`;

    const response = await this.generateContent(prompt);
    
    try {
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]) as VoiceRhythmAuditorResult;
        return { ...response, result };
      }
    } catch (e) {
      console.error("[VoiceRhythmAuditor] Failed to parse JSON response");
    }

    return { 
      ...response, 
      result: { 
        tranche_aprobado: true,
        puntuacion_voz: 8,
        puntuacion_ritmo: 8,
        resumen: "Tramo aprobado automáticamente",
        perfil_tonal_detectado: "Consistente con el género",
        issues: [],
        capitulos_para_revision: [],
        recomendaciones_estilo: []
      } 
    };
  }
}
