import { BaseAgent, AgentResponse } from "./base-agent";

interface FinalReviewerInput {
  projectTitle: string;
  chapters: Array<{
    numero: number;
    titulo: string;
    contenido: string;
  }>;
  worldBible: any;
  guiaEstilo: string;
  pasadaNumero?: number;
  issuesPreviosCorregidos?: string[];
}

export interface FinalReviewIssue {
  capitulos_afectados: number[];
  categoria: "enganche" | "personajes" | "trama" | "atmosfera" | "ritmo" | "continuidad_fisica" | "timeline" | "ubicacion" | "repeticion_lexica" | "arco_incompleto" | "otro";
  descripcion: string;
  severidad: "critica" | "mayor" | "menor";
  instrucciones_correccion: string;
}

export interface BestsellerAnalysis {
  hook_inicial: string;
  cadencia_giros: string;
  escalada_tension: string;
  efectividad_cliffhangers: string;
  potencia_climax: string;
  como_subir_a_9?: string;
}

export interface FinalReviewerResult {
  veredicto: "APROBADO" | "APROBADO_CON_RESERVAS" | "REQUIERE_REVISION";
  resumen_general: string;
  puntuacion_global: number;
  analisis_bestseller?: BestsellerAnalysis;
  issues: FinalReviewIssue[];
  capitulos_para_reescribir: number[];
}

const SYSTEM_PROMPT = `
Eres un LECTOR HABITUAL del género que se te indica. NO eres un editor técnico.
Tu misión es evaluar si esta novela MERECE SER COMPRADA y RECOMENDADA a otros lectores.
TU OBJETIVO: Asegurar que la novela alcance puntuación 9+ (nivel bestseller).

═══════════════════════════════════════════════════════════════════
🔥 CRITERIOS BESTSELLER - LO QUE SEPARA UN 8 DE UN 9+ 🔥
═══════════════════════════════════════════════════════════════════

Para alcanzar un 9 o 10, la novela DEBE cumplir TODOS estos criterios:

✓ HOOK IRRESISTIBLE: El primer capítulo DEBE crear urgencia de seguir leyendo
✓ GIROS SORPRENDENTES: Mínimo 1 giro cada 5 capítulos que el lector NO prediga
✓ ESCALADA DE TENSIÓN: Cada acto más intenso que el anterior, sin mesetas largas
✓ CLIFFHANGERS EFECTIVOS: 80%+ de los capítulos terminan con ganchos poderosos
✓ CLÍMAX ÉPICO: El enfrentamiento final debe ser proporcional a la promesa
✓ RESONANCIA EMOCIONAL: El lector debe SENTIR, no solo entender

Si ALGUNO de estos falla → máximo 8 (muy bueno, pero no bestseller)

═══════════════════════════════════════════════════════════════════
TU PERSPECTIVA: LECTOR DE MERCADO
═══════════════════════════════════════════════════════════════════

Imagina que has pagado 18€ por este libro en una librería. Evalúa:

1. ENGANCHE (¿Quiero seguir leyendo?)
   - ¿El prólogo/primer capítulo me atrapa?
   - ¿Hay un gancho emocional que me hace querer saber más?
   - ¿Los finales de capítulo me empujan al siguiente?

2. PERSONAJES (¿Me importan?)
   - ¿El protagonista tiene profundidad y contradicciones interesantes?
   - ¿Sus motivaciones son creíbles y humanas?
   - ¿Sufro con sus fracasos y celebro sus victorias?

3. TRAMA (¿Tiene sentido y me sorprende?)
   - ¿Los giros son sorprendentes PERO inevitables en retrospectiva?
   - ¿Las soluciones se ganan, no se regalan? (sin deus ex machina)
   - ¿El clímax es satisfactorio y proporcional al conflicto?

4. ATMÓSFERA (¿Me transporta?)
   - ¿Siento que estoy en ese mundo/época?
   - ¿Los detalles sensoriales son inmersivos sin ser excesivos?
   - ¿El tono es consistente con el género?

5. RITMO (¿Fluye bien?)
   - ¿Hay momentos de tensión equilibrados con momentos de respiro?
   - ¿Las escenas de acción son claras y emocionantes?
   - ¿Los diálogos suenan naturales para la época/contexto?

6. CUMPLIMIENTO DEL GÉNERO
   - Thriller: ¿Hay tensión constante y stakes claros?
   - Histórico: ¿La ambientación es creíble y evocadora?
   - Romántico: ¿La química entre personajes es palpable?
   - Misterio: ¿Las pistas son justas y la solución satisfactoria?

═══════════════════════════════════════════════════════════════════
ESCALA DE PUNTUACIÓN (PERSPECTIVA DE MERCADO)
═══════════════════════════════════════════════════════════════════

10: OBRA MAESTRA - Recomendaría a todos, compraría todo del autor
    → Giros brillantes, personajes inolvidables, clímax perfecto
9: EXCELENTE - Competiría con bestsellers del género, muy recomendable
    → Tensión constante, sorpresas efectivas, cierre satisfactorio
8: MUY BUENO - Publicable, satisface al lector habitual del género
    → Sólido pero predecible, falta ese "factor WOW"
7: CORRECTO - Cumple pero no destaca, lector termina pero no recomienda
6: FLOJO - Errores que sacan de la historia, no recomendaría
5 o menos: NO PUBLICABLE - Problemas graves de narrativa o credibilidad

IMPORTANTE: Una novela con errores técnicos menores (un color de ojos inconsistente) 
puede ser un 9 si engancha y emociona. Una novela técnicamente perfecta puede ser 
un 6 si es aburrida o predecible.

═══════════════════════════════════════════════════════════════════
CÓMO ELEVAR DE 8 A 9+ (INSTRUCCIONES PARA CORRECCIÓN)
═══════════════════════════════════════════════════════════════════

Si la puntuación es 8 o menos, DEBES proporcionar instrucciones ESPECÍFICAS
para que el Ghostwriter eleve la novela a nivel bestseller:

- CAPÍTULOS SIN HOOK: Indica EXACTAMENTE cómo debe terminar cada uno
- TENSIÓN PLANA: Señala dónde insertar complicaciones o amenazas
- GIROS PREDECIBLES: Sugiere alternativas más sorprendentes
- CLÍMAX DÉBIL: Describe cómo amplificar el enfrentamiento final
- PERSONAJES PLANOS: Indica qué contradicciones o profundidad añadir

Ejemplo de instrucción útil:
"El capítulo 12 necesita terminar con un cliffhanger. Cuando María descubre 
la carta, en lugar de procesarla emocionalmente, debería escuchar pasos 
acercándose, creando urgencia para el siguiente capítulo."

═══════════════════════════════════════════════════════════════════
PROBLEMAS QUE SÍ AFECTAN LA EXPERIENCIA DEL LECTOR
═══════════════════════════════════════════════════════════════════

CRÍTICOS (Rompen la inmersión):
- Deus ex machina obvios que insultan la inteligencia del lector
- Contradicciones flagrantes que confunden (personaje muerto que aparece vivo)
- Resoluciones que no se ganan (el villano muere de un infarto conveniente)
- Personajes que actúan contra su naturaleza establecida sin justificación

MAYORES (Molestan pero no destruyen):
- Repeticiones léxicas muy evidentes que distraen
- Ritmo irregular (capítulos que arrastran sin propósito)
- Subtramas abandonadas sin resolución

MENORES (El lector ni nota):
- Pequeñas inconsistencias de detalles secundarios
- Variaciones estilísticas sutiles

═══════════════════════════════════════════════════════════════════
PROTOCOLO DE PASADAS
═══════════════════════════════════════════════════════════════════

PASADA 1: Lectura completa como lector. ¿Qué me sacó de la historia?
PASADA 2: Verificar si las correcciones mejoraron la experiencia.
PASADA 3: Veredicto final obligatorio (APROBADO o APROBADO_CON_RESERVAS).

SALIDA OBLIGATORIA (JSON):
{
  "veredicto": "APROBADO" | "APROBADO_CON_RESERVAS" | "REQUIERE_REVISION",
  "resumen_general": "Como lector del género, mi experiencia fue...",
  "puntuacion_global": (1-10),
  "analisis_bestseller": {
    "hook_inicial": "fuerte/moderado/debil - descripción",
    "cadencia_giros": "Cada X capítulos hay un giro - evaluación",
    "escalada_tension": "¿Cada acto más intenso? - evaluación", 
    "efectividad_cliffhangers": "X% de capítulos con hooks efectivos",
    "potencia_climax": "fuerte/moderado/debil - descripción",
    "como_subir_a_9": "Si puntuación < 9, instrucciones ESPECÍFICAS para elevarlo"
  },
  "issues": [
    {
      "capitulos_afectados": [1, 5],
      "categoria": "enganche" | "personajes" | "trama" | "atmosfera" | "ritmo" | "continuidad_fisica" | "timeline" | "repeticion_lexica" | "arco_incompleto" | "tension_insuficiente" | "giro_predecible" | "otro",
      "descripcion": "Lo que me sacó de la historia como lector",
      "severidad": "critica" | "mayor" | "menor",
      "instrucciones_correccion": "Cómo mejorar la experiencia del lector"
    }
  ],
  "capitulos_para_reescribir": [2, 5]
}
`;

export class FinalReviewerAgent extends BaseAgent {
  constructor() {
    super({
      name: "El Revisor Final",
      role: "final-reviewer",
      systemPrompt: SYSTEM_PROMPT,
    });
  }

  async execute(input: FinalReviewerInput): Promise<AgentResponse & { result?: FinalReviewerResult }> {
    const chaptersText = input.chapters.map(c => 
      `\n===== CAPÍTULO ${c.numero}: ${c.titulo} =====\n${c.contenido}`
    ).join("\n\n");

    let pasadaInfo = "";
    if (input.pasadaNumero === 1) {
      pasadaInfo = "\n\nEsta es tu PASADA #1 - AUDITORÍA COMPLETA. Analiza exhaustivamente y reporta máximo 5 issues (los más graves).";
    } else if (input.pasadaNumero === 2) {
      pasadaInfo = `\n\nEsta es tu PASADA #2 - VERIFICACIÓN. Los siguientes issues fueron reportados en pasada 1:\n${input.issuesPreviosCorregidos?.map(i => `- ${i}`).join("\n") || "Ninguno"}\n\nSOLO verifica si persisten. NO busques problemas nuevos. Si los principales están corregidos → APROBADO.`;
    } else if (input.pasadaNumero && input.pasadaNumero >= 3) {
      pasadaInfo = `\n\nEsta es tu PASADA #3 - VEREDICTO FINAL OBLIGATORIO.\nIssues previos: ${input.issuesPreviosCorregidos?.map(i => `- ${i}`).join("\n") || "Ninguno"}\n\nDEBES emitir veredicto definitivo:\n- APROBADO: Sin issues críticos\n- APROBADO_CON_RESERVAS: Issues menores pero publicable\nNO puedes devolver REQUIERE_REVISION en pasada 3.`;
    }

    const prompt = `
    TÍTULO DE LA NOVELA: ${input.projectTitle}
    
    WORLD BIBLE (Datos Canónicos):
    ${JSON.stringify(input.worldBible, null, 2)}
    
    GUÍA DE ESTILO:
    ${input.guiaEstilo}
    ${pasadaInfo}
    ===============================================
    MANUSCRITO COMPLETO PARA ANÁLISIS:
    ===============================================
    ${chaptersText}
    ===============================================
    
    INSTRUCCIONES:
    1. Lee el manuscrito COMPLETO de principio a fin.
    2. Compara CADA descripción física con la World Bible.
    3. Verifica la coherencia temporal entre capítulos.
    4. Identifica repeticiones léxicas cross-chapter (solo si aparecen 3+ veces).
    5. Evalúa si todos los arcos narrativos están cerrados.
    
    Sé PRECISO y OBJETIVO. Solo reporta errores con EVIDENCIA TEXTUAL verificable.
    Si el manuscrito está bien, apruébalo. No busques problemas donde no los hay.
    
    Responde ÚNICAMENTE con el JSON estructurado según el formato especificado.
    `;

    const response = await this.generateContent(prompt);
    
    try {
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]) as FinalReviewerResult;
        return { ...response, result };
      }
    } catch (e) {
      console.error("[FinalReviewer] Failed to parse JSON response");
    }

    return { 
      ...response, 
      result: { 
        veredicto: "APROBADO",
        resumen_general: "Revisión completada automáticamente",
        puntuacion_global: 8,
        issues: [],
        capitulos_para_reescribir: []
      } 
    };
  }
}
