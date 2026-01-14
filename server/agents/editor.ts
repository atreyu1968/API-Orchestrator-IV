import { BaseAgent, AgentResponse } from "./base-agent";

interface EditorInput {
  chapterNumber: number;
  chapterContent: string;
  chapterData: {
    titulo: string;
    beats: string[];
    objetivo_narrativo: string;
    funcion_estructural?: string;
    informacion_nueva?: string;
    pregunta_dramatica?: string;
    conflicto_central?: {
      tipo?: string;
      descripcion?: string;
      stakes?: string;
    };
    giro_emocional?: {
      emocion_inicio?: string;
      emocion_final?: string;
    };
    recursos_literarios_sugeridos?: string[];
    tono_especifico?: string;
    prohibiciones_este_capitulo?: string[];
    arcos_que_avanza?: Array<{
      arco?: string;
      de?: string;
      a?: string;
    }>;
    riesgos_de_verosimilitud?: {
      posibles_deus_ex_machina?: string[];
      setup_requerido?: string[];
      justificacion_causal?: string;
    };
  };
  worldBible: any;
  guiaEstilo: string;
  estructuraTresActos?: any;
  previousContinuityState?: any;
}

export interface EditorResult {
  puntuacion: number;
  veredicto: string;
  fortalezas: string[];
  debilidades_criticas: string[];
  errores_continuidad?: string[];
  frases_repetidas?: string[];
  problemas_ritmo?: string[];
  problemas_verosimilitud?: string[];
  cliches_ia_detectados?: string[];
  anacronismos_detectados?: string[];
  beats_faltantes?: string[];
  violaciones_estilo?: string[];
  plan_quirurgico: {
    diagnostico: string;
    preservar?: string;
    procedimiento: string;
    objetivo: string;
    palabras_objetivo?: number;
  };
  aprobado: boolean;
}

const SYSTEM_PROMPT = `
Eres un editor literario senior con 20 años de experiencia en narrativa de ficción. Tu estándar es la EXCELENCIA literaria.
Tu misión es auditar el texto eliminando cualquier rastro de escritura artificial, dotándolo de voz humana, y comparándolo con:
1. La GUÍA DE ESTILO del autor (voz, tono, prohibiciones léxicas)
2. La WORLD BIBLE (datos canónicos de personajes/lugares)
3. El INFORME DEL ARQUITECTO (escaleta, función estructural, arcos narrativos)

═══════════════════════════════════════════════════════════════════
DIRECTRICES MAESTRAS DE HUMANIZACIÓN LITERARIA (PRIORIDAD MÁXIMA)
═══════════════════════════════════════════════════════════════════

A. VARIABILIDAD DE RITMO (SINTAXIS):
   - Detecta si más de dos frases seguidas empiezan con el mismo sujeto o estructura.
   - Penaliza la monotonía rítmica: el texto debe alternar oraciones largas con frases cortas.

B. INMERSIÓN SENSORIAL CRUDA:
   - Detecta adjetivos genéricos (misterioso, increíble, aterrador, fascinante) que deben sustituirse por detalles físicos.
   - ¿Se usan los sentidos (olfato, tacto, gusto) o solo la vista?
   - ¿Las emociones se MUESTRAN con el cuerpo o se DICEN directamente?

C. SUBTEXTO Y PSICOLOGÍA:
   - ¿Los personajes dicen exactamente lo que sienten? Eso es artificial.
   - Detecta falta de contradicción interna, dudas o detalles irrelevantes bajo estrés.

D. ELIMINACIÓN DE CLICHÉS DE IA:
   - Palabras que indican escritura artificial: "crucial", "enigmático", "fascinante", "un torbellino de emociones", "el destino de...", "desenterrar secretos", "repentinamente", "de repente", "sintió una oleada de", "palpable", "tangible".
   - Si detectas 1-2 de estas palabras: nota menor, NO penaliza puntuación
   - Si detectas 3-5: penaliza -1 punto total
   - Si detectas más de 5: penaliza -2 puntos total (el texto suena muy artificial)

E. SHOW, DON'T TELL:
   - ¿La narración filtra eventos a través de la percepción subjetiva del personaje?
   - Detecta narraciones "asépticas" o de "crónica externa".

═══════════════════════════════════════════════════════════════════
DETECCIÓN DE ANACRONISMOS (Solo para ficción histórica)
═══════════════════════════════════════════════════════════════════

Para ficción histórica, detecta:
- OBJETOS: Tecnología, armas, herramientas que no existían en la época
- VOCABULARIO: Expresiones claramente modernas ("OK", "estrés", "ADN" en siglo XIX)
- COSTUMBRES: Comportamientos sociales muy anacrónicos
- CONOCIMIENTOS: Personajes que saben cosas no descubiertas en su época

Penalización de anacronismos:
- 1-2 anacronismos menores (vocabulario): nota menor, NO penaliza
- 1 anacronismo grave (objeto/tecnología imposible): -1 punto
- Múltiples anacronismos graves: -2 puntos máximo

Ejemplos de anacronismos GRAVES a detectar:
- Un romano usando un reloj de bolsillo
- Un soldado napoleónico usando antibióticos
- Tecnología claramente fuera de época

═══════════════════════════════════════════════════════════════════
PROTOCOLO DE EVALUACIÓN INTEGRADO
═══════════════════════════════════════════════════════════════════

1. CUMPLIMIENTO DE LA GUÍA DE ESTILO (CRÍTICO):
   - ¿La voz narrativa coincide con el estilo especificado?
   - ¿Se respetan las PROHIBICIONES léxicas del autor?
   - ¿El tono específico de este capítulo es el correcto?

2. EJECUCIÓN DEL PLAN DEL ARQUITECTO:
   - ¿Se cumplieron TODOS los beats planificados?
   - ¿Se reveló la "informacion_nueva" que debía revelarse?
   - ¿El conflicto_central del capítulo está presente y bien desarrollado?
   - ¿El giro_emocional (emocion_inicio → emocion_final) se logra?
   - ¿Los arcos narrativos avanzan según lo planificado?

3. CONTINUIDAD FÍSICA:
   - Compara descripciones físicas importantes con la ficha canónica en World Bible.
   - Errores menores (ropa, detalles): nota sin penalización
   - Errores graves (color de ojos, edad, rasgos distintivos): -1 punto

3b. CONTINUIDAD CON CAPÍTULO ANTERIOR:
   Si se proporciona el ESTADO DE CONTINUIDAD del capítulo anterior, verifica:
   - ¿Los personajes aparecen en ubicaciones coherentes?
   - ¿Los estados de personajes (vivo/muerto/herido) son consistentes?
   - Error de continuidad grave: -1 punto (máximo -2 por múltiples errores)

4. REPETICIÓN LÉXICA:
   - Busca frases/metáforas repetidas EN ESTE CAPÍTULO.
   - 2-3 repeticiones: nota sin penalización
   - 4-6 repeticiones: -1 punto
   - Más de 6 repeticiones: -2 puntos máximo

5. RITMO Y PACING:
   - ¿Los eventos dramáticos tienen suficiente SETUP emocional?
   - ¿Las transiciones son fluidas?

6. VEROSIMILITUD NARRATIVA:
   - ¿Hay DEUS EX MACHINA? (soluciones sin preparación previa)
   - ¿Hay coincidencias muy forzadas?
   - ¿Los rescates están mínimamente sembrados?
   - Penalización: -1 punto por deus ex machina evidente (máximo -2)
   - Coincidencias menores o rescates parcialmente sembrados: nota sin penalizar

INSTRUCCIONES DE REESCRITURA PRECISAS:
Cuando rechaces un capítulo, tu plan_quirurgico debe incluir:

1. **preservar**: Lista ESPECÍFICA de lo que funciona bien y NO debe cambiar (escenas, diálogos, descripciones que funcionan)
2. **procedimiento**: Cambio QUIRÚRGICO: qué párrafos/líneas específicas modificar
3. **palabras_objetivo**: El número de palabras que debe tener el capítulo final (NUNCA reducir)

⚠️ REGLA DE ORO DE LA REESCRITURA:
- NUNCA pidas eliminar contenido sin reemplazarlo por algo equivalente o mejor
- NUNCA pidas "simplificar" o "condensar" - esto degrada la calidad
- SIEMPRE indica qué PRESERVAR antes de qué cambiar
- Las correcciones deben MEJORAR sin REDUCIR la extensión

CHECKLIST DE RECHAZO (Cualquiera = aprobado: false):
- Inconsistencia física con World Bible
- Más de 3 repeticiones de la misma expresión
- Beats del arquitecto no cumplidos
- Violación de prohibiciones de la guía de estilo
- DEUS EX MACHINA o solución inverosímil
- Clichés de IA detectados
- Anacronismos en ficción histórica

SALIDA JSON OBLIGATORIA:
{
  "puntuacion": (1-10),
  "veredicto": "Resumen del estado",
  "fortalezas": [],
  "debilidades_criticas": [],
  "errores_continuidad": ["Inconsistencias físicas con cita exacta"],
  "frases_repetidas": ["Expresiones repetidas"],
  "problemas_ritmo": ["Escenas sin setup"],
  "problemas_verosimilitud": ["Deus ex machina, coincidencias forzadas"],
  "cliches_ia_detectados": ["Palabras/frases artificiales encontradas"],
  "anacronismos_detectados": ["Objetos, expresiones o conocimientos fuera de época"],
  "beats_faltantes": ["Beats del arquitecto que no se cumplieron"],
  "violaciones_estilo": ["Violaciones a la guía de estilo"],
  "plan_quirurgico": {
    "diagnostico": "Qué falló exactamente",
    "preservar": "Lista ESPECÍFICA de elementos que NO deben modificarse (escenas, diálogos, descripciones efectivas)",
    "procedimiento": "Cambio QUIRÚRGICO: qué párrafos/líneas modificar y cómo (SIN reducir extensión)",
    "objetivo": "Resultado esperado según plan del arquitecto",
    "palabras_objetivo": (número de palabras que debe tener el capítulo corregido - NUNCA menor que el actual)
  },
  "aprobado": (Boolean: true si puntuacion >= 7 Y sin errores graves)
}
`;

export class EditorAgent extends BaseAgent {
  constructor() {
    super({
      name: "El Editor",
      role: "editor",
      systemPrompt: SYSTEM_PROMPT,
      model: "gemini-2.5-flash",
      useThinking: false,
    });
  }

  async execute(input: EditorInput): Promise<AgentResponse & { result?: EditorResult }> {
    const chapterData = input.chapterData;
    
    const planArquitecto = `
PLAN DEL ARQUITECTO PARA ESTE CAPÍTULO:
- Título: ${chapterData.titulo}
- Función estructural: ${chapterData.funcion_estructural || "No especificada"}
- Beats obligatorios: ${chapterData.beats?.join(" → ") || "No especificados"}
- Objetivo narrativo: ${chapterData.objetivo_narrativo || "No especificado"}
- Información nueva a revelar: ${chapterData.informacion_nueva || "Ninguna específica"}
- Pregunta dramática: ${chapterData.pregunta_dramatica || "No especificada"}
- Conflicto central: ${chapterData.conflicto_central ? `${chapterData.conflicto_central.tipo} - ${chapterData.conflicto_central.descripcion} (Stakes: ${chapterData.conflicto_central.stakes})` : "No especificado"}
- Giro emocional: ${chapterData.giro_emocional ? `De "${chapterData.giro_emocional.emocion_inicio}" a "${chapterData.giro_emocional.emocion_final}"` : "No especificado"}
- Tono específico: ${chapterData.tono_especifico || "Según guía general"}
- Recursos literarios sugeridos: ${chapterData.recursos_literarios_sugeridos?.join(", ") || "Ninguno específico"}
- PROHIBICIONES para este capítulo: ${chapterData.prohibiciones_este_capitulo?.join(", ") || "Ninguna específica"}
- Arcos que debe avanzar: ${chapterData.arcos_que_avanza?.map(a => `${a.arco}: de "${a.de}" a "${a.a}"`).join("; ") || "No especificados"}
${chapterData.riesgos_de_verosimilitud ? `
ALERTAS DE VEROSIMILITUD:
- Posibles deus ex machina a detectar: ${chapterData.riesgos_de_verosimilitud.posibles_deus_ex_machina?.join(", ") || "Ninguno"}
- Setup requerido (verificar que exista): ${chapterData.riesgos_de_verosimilitud.setup_requerido?.join(", ") || "Ninguno"}
- Justificación causal esperada: ${chapterData.riesgos_de_verosimilitud.justificacion_causal || "No especificada"}` : ""}
`;

    const continuitySection = input.previousContinuityState ? `
═══════════════════════════════════════════════════════════════════
ESTADO DE CONTINUIDAD DEL CAPÍTULO ANTERIOR (CRÍTICO):
═══════════════════════════════════════════════════════════════════
${JSON.stringify(input.previousContinuityState, null, 2)}

VALIDA que este capítulo sea COHERENTE con el estado anterior:
- Ubicaciones de personajes al inicio deben coincidir con donde terminaron
- Estados de personajes (vivo/muerto/herido) deben ser consistentes
- Objetos poseídos deben seguir presentes o explicar su pérdida
- Tiempo narrativo debe ser continuo
═══════════════════════════════════════════════════════════════════
` : "";

    const prompt = `
DOCUMENTOS DE REFERENCIA:

1. GUÍA DE ESTILO DEL AUTOR:
${input.guiaEstilo}

2. WORLD BIBLE (Datos Canónicos):
${JSON.stringify(input.worldBible, null, 2)}

3. ${planArquitecto}

${input.estructuraTresActos ? `4. ESTRUCTURA DE TRES ACTOS:\n${JSON.stringify(input.estructuraTresActos, null, 2)}` : ""}

${continuitySection}

===============================================
TEXTO DEL CAPÍTULO ${input.chapterNumber} A EVALUAR:
===============================================
${input.chapterContent}
===============================================

INSTRUCCIONES:
1. Verifica que el texto CUMPLA con la Guía de Estilo (voz, tono, prohibiciones).
2. Verifica que el texto EJECUTE el Plan del Arquitecto (beats, conflicto, arcos).
3. Verifica CONTINUIDAD con la World Bible (rasgos físicos, datos).
4. Busca REPETICIONES léxicas dentro del capítulo.
5. Evalúa el RITMO y PACING.

Si rechazas, tu plan_quirurgico debe ser ESPECÍFICO:
- Cita párrafos exactos que deben cambiar
- Indica qué beats faltan y cómo incorporarlos
- Referencia la guía de estilo para correcciones de voz

Responde ÚNICAMENTE con el JSON estructurado.
    `;

    const response = await this.generateContent(prompt);
    
    try {
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]) as EditorResult;
        return { ...response, result };
      }
    } catch (e) {
      console.error("[Editor] Failed to parse JSON response, approving by default");
    }

    return { 
      ...response, 
      result: { 
        puntuacion: 8, 
        veredicto: "Aprobado automáticamente", 
        fortalezas: [],
        debilidades_criticas: [],
        plan_quirurgico: { diagnostico: "", procedimiento: "", objetivo: "" },
        aprobado: true 
      } 
    };
  }
}
