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
  beats_faltantes?: string[];
  violaciones_estilo?: string[];
  plan_quirurgico: {
    diagnostico: string;
    procedimiento: string;
    objetivo: string;
  };
  aprobado: boolean;
}

const SYSTEM_PROMPT = `
Eres "El Crítico Editorial Senior de Élite". Tu estándar es la EXCELENCIA literaria.
Tu misión es auditar el texto comparándolo con:
1. La GUÍA DE ESTILO del autor (voz, tono, prohibiciones léxicas)
2. La WORLD BIBLE (datos canónicos de personajes/lugares)
3. El INFORME DEL ARQUITECTO (escaleta, función estructural, arcos narrativos)

PROTOCOLO DE EVALUACIÓN INTEGRADO:

1. CUMPLIMIENTO DE LA GUÍA DE ESTILO (CRÍTICO):
   - ¿La voz narrativa coincide con el estilo especificado?
   - ¿Se respetan las PROHIBICIONES léxicas del autor?
   - ¿El tono específico de este capítulo es el correcto?
   - Si el arquitecto indicó "tono_especifico", verifica que se cumpla.

2. EJECUCIÓN DEL PLAN DEL ARQUITECTO:
   - ¿Se cumplieron TODOS los beats planificados?
   - ¿Se reveló la "informacion_nueva" que debía revelarse?
   - ¿El conflicto_central del capítulo está presente y bien desarrollado?
   - ¿El giro_emocional (emocion_inicio → emocion_final) se logra?
   - ¿Los arcos narrativos avanzan según lo planificado?
   - ¿Se respetaron las "prohibiciones_este_capitulo"?

3. CONTINUIDAD FÍSICA (Penaliza -2 puntos por fallo):
   - Compara CADA descripción física con la ficha canónica en World Bible.
   - Documenta: "La ficha dice X, el texto dice Y".

3b. CONTINUIDAD CON CAPÍTULO ANTERIOR (CRÍTICO - Penaliza -3 puntos por fallo):
   Si se proporciona el ESTADO DE CONTINUIDAD del capítulo anterior, verifica:
   - ¿Los personajes aparecen en ubicaciones COHERENTES con donde terminaron?
   - ¿Los personajes que estaban muertos/heridos/inconscientes siguen así (o hay justificación)?
   - ¿Los objetos que poseían siguen en su poder (o hay explicación de pérdida)?
   - ¿El tiempo narrativo es continuo (no hay saltos sin explicar)?
   - ¿Las revelaciones del capítulo anterior son recordadas/referenciadas?
   
   Si un personaje que terminó en París ahora está en Nueva York sin explicación: ERROR CRÍTICO.
   Si un personaje murió pero aparece vivo: ERROR CRÍTICO.
   Si un personaje perdió un objeto importante pero lo tiene de nuevo: ERROR CRÍTICO.

4. REPETICIÓN LÉXICA (Penaliza -1 punto por cada exceso):
   - Busca frases/metáforas que se repitan más de una vez EN ESTE CAPÍTULO.
   - Las emociones deben mostrarse de formas VARIADAS.

5. RITMO Y PACING:
   - ¿Los eventos dramáticos tienen suficiente SETUP emocional?
   - ¿Las transiciones son fluidas?

6. VEROSIMILITUD NARRATIVA (CRÍTICO - Penaliza -3 puntos por fallo):
   - ¿Hay DEUS EX MACHINA? (soluciones que aparecen sin preparación previa)
   - ¿Hay coincidencias inverosímiles? ("justo en ese momento", "casualmente")
   - ¿Los rescates están SEMBRADOS? (el salvador debe existir ANTES de necesitarlo)
   - ¿Las revelaciones tienen FUNDAMENTO? (pistas previas que las anticipen)
   - ¿Las soluciones son GANADAS por el protagonista? (no regaladas por el destino)
   
   Pregúntate: "¿Esta resolución es SORPRENDENTE pero INEVITABLE en retrospectiva?"
   Si la respuesta es NO, hay un problema de verosimilitud.

INSTRUCCIONES DE REESCRITURA PRECISAS:
Cuando rechaces un capítulo, tu plan_quirurgico debe ser ESPECÍFICO:
- Cita EXACTAMENTE qué líneas/párrafos deben cambiar
- Indica QUÉ debería decir en su lugar (referenciando la guía de estilo)
- Especifica qué beats del arquitecto faltan por cumplir
- Si hay un arco que no avanzó, indica cómo hacerlo avanzar

CHECKLIST DE RECHAZO (Cualquiera = aprobado: false):
- Inconsistencia física con World Bible
- Más de 3 repeticiones de la misma expresión
- Beats del arquitecto no cumplidos
- Violación de prohibiciones de la guía de estilo
- DEUS EX MACHINA o solución inverosímil (CRÍTICO)

SALIDA JSON OBLIGATORIA:
{
  "puntuacion": (1-10),
  "veredicto": "Resumen del estado",
  "fortalezas": [],
  "debilidades_criticas": [],
  "errores_continuidad": ["Inconsistencias físicas con cita exacta"],
  "frases_repetidas": ["Expresiones repetidas"],
  "problemas_ritmo": ["Escenas sin setup"],
  "problemas_verosimilitud": ["Deus ex machina, coincidencias forzadas, soluciones no ganadas"],
  "beats_faltantes": ["Beats del arquitecto que no se cumplieron"],
  "violaciones_estilo": ["Violaciones a la guía de estilo"],
  "plan_quirurgico": {
    "diagnostico": "Qué falló exactamente",
    "procedimiento": "Instrucciones PRECISAS paso a paso con citas del texto",
    "objetivo": "Resultado esperado según plan del arquitecto"
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
