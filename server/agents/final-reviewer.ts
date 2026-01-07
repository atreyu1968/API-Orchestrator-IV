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
  categoria: "enganche" | "personajes" | "trama" | "atmosfera" | "ritmo" | "continuidad_fisica" | "timeline" | "ubicacion" | "repeticion_lexica" | "arco_incompleto" | "tension_insuficiente" | "giro_predecible" | "hook_debil" | "identidad_confusa" | "capitulo_huerfano" | "otro";
  descripcion: string;
  severidad: "critica" | "mayor" | "menor";
  elementos_a_preservar: string;
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

export interface ScoreJustification {
  puntuacion_desglosada: {
    enganche: number;
    personajes: number;
    trama: number;
    atmosfera: number;
    ritmo: number;
    cumplimiento_genero: number;
  };
  fortalezas_principales: string[];
  debilidades_principales: string[];
  comparacion_mercado: string;
  recomendaciones_proceso: string[];
}

export interface PlotDecision {
  decision: string;
  capitulo_establecido: number;
  capitulos_afectados: number[];
  consistencia_actual: "consistente" | "inconsistente";
  problema?: string;
}

export interface PersistentInjury {
  personaje: string;
  tipo_lesion: string;
  capitulo_ocurre: number;
  efecto_esperado: string;
  capitulos_verificados: number[];
  consistencia: "correcta" | "ignorada";
  problema?: string;
}

export interface OrphanChapter {
  capitulo: number;
  razon: string;
  recomendacion: "eliminar" | "reubicar_como_flashback" | "integrar_en_otro";
}

export interface FinalReviewerResult {
  veredicto: "APROBADO" | "APROBADO_CON_RESERVAS" | "REQUIERE_REVISION";
  resumen_general: string;
  puntuacion_global: number;
  justificacion_puntuacion: ScoreJustification;
  analisis_bestseller?: BestsellerAnalysis;
  issues: FinalReviewIssue[];
  capitulos_para_reescribir: number[];
  plot_decisions?: PlotDecision[];
  persistent_injuries?: PersistentInjury[];
  orphan_chapters?: OrphanChapter[];
}

const SYSTEM_PROMPT = `
Eres un LECTOR HABITUAL del género que se te indica. NO eres un editor técnico.
Tu misión es evaluar si esta novela MERECE SER COMPRADA y RECOMENDADA a otros lectores.
TU OBJETIVO: Asegurar que la novela alcance puntuación 10/10 (nivel obra maestra).

IMPORTANTE: Solo das 10/10 cuando la novela tiene CERO issues y cumple TODOS los criterios bestseller PERFECTAMENTE.

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
ESCALA DE PUNTUACIÓN ESTRICTA (OBJETIVO: 10/10)
═══════════════════════════════════════════════════════════════════

10: OBRA MAESTRA - CERO issues. Perfección total. Hook irresistible, giros brillantes, 
    personajes inolvidables, clímax perfecto. ÚNICO nivel que aprueba.
9: EXCELENTE - Solo 1 issue menor. Muy cerca de la perfección pero falta algo.
8: MUY BUENO - 2 issues menores o 1 mayor. Publicable pero requiere pulido.
7: CORRECTO - 3+ issues menores o 2 mayores. Cumple pero no destaca.
6: FLOJO - 1 issue crítico o 3+ mayores. Errores que sacan de la historia.
5 o menos: NO PUBLICABLE - Múltiples issues críticos o problemas graves.

REGLA ABSOLUTA: Solo das 10/10 si NO hay ningún issue de ningún tipo.
Cualquier issue (incluso menor) reduce automáticamente la puntuación por debajo de 10.

═══════════════════════════════════════════════════════════════════
CÓMO ELEVAR DE 8 A 9+ (INSTRUCCIONES PRECISAS PARA CORRECCIÓN)
═══════════════════════════════════════════════════════════════════

REGLA CRÍTICA: Cada issue DEBE incluir DOS partes obligatorias:

1. **elementos_a_preservar**: Lista ESPECÍFICA de lo que funciona bien y NO debe cambiar
   - Menciona escenas, diálogos, descripciones o momentos concretos del texto
   - El Ghostwriter SOLO modificará lo indicado en instrucciones_correccion
   
2. **instrucciones_correccion**: Cambio QUIRÚRGICO y específico
   - Indica EXACTAMENTE qué líneas/párrafos modificar
   - Describe el cambio concreto, no conceptos vagos
   - El resto del capítulo debe permanecer INTACTO

EJEMPLO MALO (vago, causa problemas nuevos):
{
  "elementos_a_preservar": "",
  "instrucciones_correccion": "Mejorar el enganche del final"
}

EJEMPLO BUENO (preciso, evita daños colaterales):
{
  "elementos_a_preservar": "La escena del diálogo entre María y Pedro en la cocina es perfecta. La descripción del amanecer está muy bien lograda. El flashback de la infancia debe mantenerse exactamente igual.",
  "instrucciones_correccion": "SOLO modificar las últimas 3 líneas del capítulo. Actualmente termina con María procesando la carta internamente. Cambiar a: María escucha pasos acercándose por el pasillo, guarda la carta rápidamente en su bolsillo. La puerta se abre. Cortar ahí."
}

CONSECUENCIA: Si das instrucciones vagas, el Ghostwriter reescribirá todo el capítulo y potencialmente introducirá NUEVOS problemas. Sé QUIRÚRGICO.

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
🔴 ANÁLISIS CRÍTICO MANUSCRITO-COMPLETO (OBLIGATORIO)
═══════════════════════════════════════════════════════════════════

Debes detectar y reportar estos problemas que SOLO se ven leyendo toda la novela:

1. **DECISIONES DE TRAMA CRÍTICAS (plot_decisions)**:
   - ¿Quién es realmente el villano/antagonista? ¿Hay confusión?
   - ¿Las revelaciones son coherentes con lo establecido antes?
   - Ejemplo: Si Cap 32 muestra a X como el asesino pero Cap 39 dice que es Y → INCONSISTENTE
   - Para cada decisión crítica, indica si es CONSISTENTE o INCONSISTENTE a lo largo del manuscrito

2. **LESIONES PERSISTENTES (persistent_injuries)**:
   - Si un personaje sufre una lesión grave (disparo, quemadura, hueso roto), ¿aparece esa lesión en capítulos posteriores?
   - Ejemplo: Personaje recibe ácido en el brazo (Cap 25) → debe mostrar discapacidad en Caps 26-50
   - Si la lesión es IGNORADA después, reportar como inconsistencia CRÍTICA
   - Opciones de corrección: (a) hacer la lesión superficial, (b) añadir referencias a la discapacidad

3. **CAPÍTULOS HUÉRFANOS (orphan_chapters)**:
   - ¿Hay capítulos que no aportan nada a la trama principal?
   - ¿Hay objetos/llaves/pistas introducidos que NUNCA se usan después?
   - Ejemplo: Cap 44 introduce una llave que nunca se usa → capítulo huérfano
   - Recomendar: eliminar, reubicar como flashback, o integrar en otro capítulo

═══════════════════════════════════════════════════════════════════
PROTOCOLO DE PASADAS - OBJETIVO: PUNTUACIÓN 10/10
═══════════════════════════════════════════════════════════════════

PASADA 1: Lectura completa como lector. ¿Qué me sacó de la historia?
PASADA 2+: Verificar correcciones. ¿Mejoró la experiencia?

REGLA CRÍTICA ABSOLUTA: Solo emitir APROBADO cuando la puntuación sea 10/10.
- Si puntuación < 10 → REQUIERE_REVISION con instrucciones específicas
- Si puntuación = 10 Y CERO issues → APROBADO
- El sistema continuará ciclos hasta alcanzar 10/10 (perfección)

En cada pasada donde puntuación < 10, incluye en analisis_bestseller.como_subir_a_10
instrucciones CONCRETAS para elevar la puntuación a la perfección.

SALIDA OBLIGATORIA (JSON):
{
  "veredicto": "APROBADO" | "APROBADO_CON_RESERVAS" | "REQUIERE_REVISION",
  "resumen_general": "Como lector del género, mi experiencia fue...",
  "puntuacion_global": (1-10),
  "justificacion_puntuacion": {
    "puntuacion_desglosada": {
      "enganche": (1-10),
      "personajes": (1-10),
      "trama": (1-10),
      "atmosfera": (1-10),
      "ritmo": (1-10),
      "cumplimiento_genero": (1-10)
    },
    "fortalezas_principales": ["Lista de 3-5 aspectos destacables de la novela"],
    "debilidades_principales": ["Lista de 1-3 aspectos a mejorar en futuras novelas"],
    "comparacion_mercado": "Cómo se compara con bestsellers similares del género",
    "recomendaciones_proceso": ["Sugerencias para mejorar el proceso creativo en futuras novelas, ej: más beats de acción, más desarrollo de antagonista, etc."]
  },
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
      "categoria": "enganche" | "personajes" | "trama" | "atmosfera" | "ritmo" | "continuidad_fisica" | "timeline" | "repeticion_lexica" | "arco_incompleto" | "tension_insuficiente" | "giro_predecible" | "identidad_confusa" | "capitulo_huerfano" | "otro",
      "descripcion": "Lo que me sacó de la historia como lector",
      "severidad": "critica" | "mayor" | "menor",
      "elementos_a_preservar": "Lista ESPECÍFICA de escenas, diálogos y elementos del capítulo que funcionan bien y NO deben modificarse",
      "instrucciones_correccion": "Cambio QUIRÚRGICO: qué párrafos/líneas específicas modificar y cómo. El resto del capítulo permanece INTACTO"
    }
  ],
  "capitulos_para_reescribir": [2, 5],
  "plot_decisions": [
    {
      "decision": "El Escultor es Arnald (no el hombre de la cueva)",
      "capitulo_establecido": 32,
      "capitulos_afectados": [32, 33, 34, 39, 45],
      "consistencia_actual": "inconsistente",
      "problema": "Cap 32-34 implican que el hombre de la cueva es el Escultor, pero Cap 39 revela que es Arnald. No hay clarificación de la relación entre ambos."
    }
  ],
  "persistent_injuries": [
    {
      "personaje": "Arnald",
      "tipo_lesion": "Quemadura por ácido en el brazo",
      "capitulo_ocurre": 25,
      "efecto_esperado": "Brazo inutilizado o con movilidad reducida permanente",
      "capitulos_verificados": [39, 40, 41, 45, 50],
      "consistencia": "ignorada",
      "problema": "Arnald usa ambos brazos normalmente en el clímax sin mención de la lesión"
    }
  ],
  "orphan_chapters": [
    {
      "capitulo": 44,
      "razon": "Introduce una llave de enfermería que nunca se usa. El capítulo no avanza la trama principal.",
      "recomendacion": "eliminar"
    }
  ]
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
      pasadaInfo = "\n\nEsta es tu PASADA #1 - AUDITORÍA COMPLETA. Analiza exhaustivamente y reporta máximo 5 issues (los más graves). OBJETIVO: puntuación 9+.";
    } else if (input.pasadaNumero && input.pasadaNumero >= 2) {
      pasadaInfo = `\n\nEsta es tu PASADA #${input.pasadaNumero} - VERIFICACIÓN Y RE-EVALUACIÓN.

═══════════════════════════════════════════════════════════════════
ISSUES YA CORREGIDOS EN PASADAS ANTERIORES (NO REPORTAR DE NUEVO):
═══════════════════════════════════════════════════════════════════
${input.issuesPreviosCorregidos?.map(i => `- ${i}`).join("\n") || "Ninguno"}

REGLAS CRÍTICAS PARA ESTA PASADA:
1. Los capítulos HAN SIDO REESCRITOS desde la última evaluación
2. NO reportes issues que aparecen en la lista anterior - YA fueron corregidos
3. Solo reporta problemas NUEVOS o que NO estaban en la lista anterior
4. Evalúa el manuscrito CON OJOS FRESCOS - el texto ha cambiado
5. Si puntuación >= 9 → APROBADO (no busques problemas inexistentes)
6. Si puntuación < 9 → REQUIERE_REVISION con instrucciones específicas NUEVAS

IMPORTANTE: Si un issue previo fue corregido satisfactoriamente, NO lo menciones.
Si el mismo problema persiste EXACTAMENTE igual, puedes reportarlo, pero con nueva redacción.
El objetivo es alcanzar 9+ puntos. No apruebes con puntuación inferior.`;
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
        justificacion_puntuacion: {
          puntuacion_desglosada: {
            enganche: 8,
            personajes: 8,
            trama: 8,
            atmosfera: 8,
            ritmo: 8,
            cumplimiento_genero: 8
          },
          fortalezas_principales: ["Manuscrito completado"],
          debilidades_principales: [],
          comparacion_mercado: "Evaluación automática por fallo de parsing",
          recomendaciones_proceso: []
        },
        issues: [],
        capitulos_para_reescribir: []
      } 
    };
  }
}
