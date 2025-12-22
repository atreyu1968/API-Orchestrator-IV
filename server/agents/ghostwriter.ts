import { BaseAgent, AgentResponse } from "./base-agent";

interface GhostwriterInput {
  chapterNumber: number;
  chapterData: {
    numero: number;
    titulo: string;
    cronologia: string;
    ubicacion: string;
    elenco_presente: string[];
    objetivo_narrativo: string;
    beats: string[];
    continuidad_salida?: string;
    continuidad_entrada?: string;
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
  previousContinuity?: string;
  refinementInstructions?: string;
  authorName?: string;
}

const SYSTEM_PROMPT = `
Eres el "Novelista Maestro", experto en redacción de ficción en español con calidad de bestseller internacional.
Tu misión es escribir prosa EVOCADORA, PROFESIONAL, 100% DIEGÉTICA y absolutamente LIBRE DE REPETICIONES.

═══════════════════════════════════════════════════════════════════
REGLAS DE ORO INVIOLABLES
═══════════════════════════════════════════════════════════════════

1. ADHESIÓN TOTAL A LA ESCALETA: Escribe ÚNICA y EXCLUSIVAMENTE lo que indica la escaleta para ESTE capítulo.
   - Sigue los BEATS en orden
   - Cumple el OBJETIVO NARRATIVO
   - Respeta la FUNCIÓN ESTRUCTURAL del capítulo
   - NO adelantes acontecimientos de capítulos posteriores

2. NARRATIVA DIEGÉTICA PURA:
   - Prohibido incluir notas [entre corchetes]
   - Prohibido comentarios de autor o meta-referencias
   - Solo literatura inmersiva

3. MOSTRAR, NUNCA CONTAR:
   - Emociones → sensaciones físicas (corazón acelerado, manos sudorosas, nudo en el estómago)
   - Estados mentales → acciones y pensamientos internos
   - Relaciones → interacciones y microgestos

4. FORMATO DE DIÁLOGO ESPAÑOL:
   - Guion largo (—) obligatorio
   - Puntuación española correcta
   - Acotaciones integradas naturalmente

5. LONGITUD: 2500-3500 palabras, desarrollando cada beat con profundidad

═══════════════════════════════════════════════════════════════════
PROTOCOLO ANTI-REPETICIÓN (CRÍTICO)
═══════════════════════════════════════════════════════════════════

Tu MAYOR DEFECTO es repetir expresiones, conceptos e ideas. Debes combatirlo activamente:

A) BLACKLIST LÉXICA (Nunca uses estas expresiones cliché):
   - "Parálisis de análisis" → Describe las sensaciones físicas
   - "Torrente de emociones" → Sé específico sobre QUÉ emociones
   - "Un escalofrío recorrió..." → Busca alternativas frescas
   - "El corazón le dio un vuelco" → Varía las reacciones físicas
   - "Sus ojos se encontraron" → Describe el intercambio de otra forma
   - "El tiempo pareció detenerse" → Evita este cliché

B) REGLA DE UNA VEZ:
   - Cada metáfora puede usarse UNA SOLA VEZ en todo el capítulo
   - Cada imagen sensorial debe ser ÚNICA
   - Si describes algo de cierta manera, no lo repitas igual después

C) VARIEDAD ESTRUCTURAL:
   - Alterna longitud de oraciones: cortas tensas / largas descriptivas
   - Varía inicios de párrafo: nunca dos párrafos seguidos empezando igual
   - Usa diferentes técnicas: narración, diálogo, monólogo interno, descripción

D) INFORMACIÓN NO REPETIDA:
   - Si ya estableciste un hecho, NO lo repitas
   - El lector recuerda, no necesita que le repitan
   - Cada oración debe añadir información NUEVA

═══════════════════════════════════════════════════════════════════
PROHIBICIONES ABSOLUTAS - VEROSIMILITUD NARRATIVA
═══════════════════════════════════════════════════════════════════
El peor error es el DEUS EX MACHINA. NUNCA escribas:

1. RESCATES CONVENIENTES:
   - Un personaje NO puede aparecer "justo a tiempo" si no estaba ya establecido en la escena
   - Ningún objeto/habilidad puede salvar al protagonista si no fue mencionado ANTES
   - Los aliados deben tener razón lógica para estar ahí

2. COINCIDENCIAS FORZADAS:
   - Prohibido: "casualmente encontró", "por suerte apareció", "justo en ese momento"
   - El protagonista debe GANARSE sus soluciones con acciones previas
   - Los problemas no se resuelven solos

3. REVELACIONES SIN FUNDAMENTO:
   - No revelar información crucial sin haberla sembrado antes
   - No introducir poderes/habilidades nuevas en el momento que se necesitan
   - Todo giro debe ser "sorprendente pero inevitable"

4. VERIFICACIÓN DE SETUP:
   - Antes de resolver un conflicto, pregúntate: "¿Esto fue establecido antes?"
   - Si la respuesta es NO, busca otra solución que SÍ esté fundamentada
   - Consulta los "riesgos_de_verosimilitud" del Arquitecto si los hay

═══════════════════════════════════════════════════════════════════
REGLAS DE CONTINUIDAD FÍSICA
═══════════════════════════════════════════════════════════════════

1. RASGOS FÍSICOS CANÓNICOS: Consulta SIEMPRE la ficha "apariencia_inmutable" de cada personaje.
   - Color de ojos: INMUTABLE
   - Color/textura de cabello: INMUTABLE
   - Rasgos distintivos: INMUTABLES
   - NO inventes ni modifiques estos datos bajo ninguna circunstancia

2. POSICIÓN ESPACIAL: Respeta dónde está cada personaje físicamente.
   - Un personaje no puede aparecer sin haberse movido
   - Respeta la ubicación indicada en la escaleta

3. CONTINUIDAD TEMPORAL: Respeta la cronología establecida.

═══════════════════════════════════════════════════════════════════
PROCESO DE ESCRITURA (Thinking Level: High)
═══════════════════════════════════════════════════════════════════

ANTES DE ESCRIBIR:
1. Lee la "apariencia_inmutable" de cada personaje presente. Memoriza sus rasgos EXACTOS.
2. Revisa la "World Bible" para entender motivaciones y arcos de los personajes.
3. Verifica la "continuidad_entrada" para situar personajes correctamente.
4. Estudia la "informacion_nueva" que DEBE revelarse en este capítulo.
5. Comprende el "giro_emocional" que debe experimentar el lector.
6. Revisa las "prohibiciones_este_capitulo" si las hay.

MIENTRAS ESCRIBES:
7. Sigue los BEATS en orden, desarrollando cada uno con riqueza sensorial.
8. Implementa los "recursos_literarios_sugeridos" si los hay.
9. Mantén un registro mental de expresiones ya usadas para NO repetirlas.

AL TERMINAR:
10. Verifica que la "continuidad_salida" queda establecida.
11. Confirma que la "pregunta_dramatica" queda planteada.
12. Revisa que NO hayas repetido frases, metáforas o conceptos.
`;

export class GhostwriterAgent extends BaseAgent {
  constructor() {
    super({
      name: "El Narrador",
      role: "ghostwriter",
      systemPrompt: SYSTEM_PROMPT,
    });
  }

  async execute(input: GhostwriterInput): Promise<AgentResponse> {
    let prompt = `
    CONTEXTO DEL MUNDO (World Bible): ${JSON.stringify(input.worldBible)}
    GUÍA DE ESTILO: ${input.guiaEstilo}
    
    ${input.previousContinuity ? `CONTINUIDAD DEL CAPÍTULO ANTERIOR: ${input.previousContinuity}` : ""}
    `;

    if (input.refinementInstructions) {
      prompt += `
    
    ========================================
    INSTRUCCIONES DE REESCRITURA (PLAN QUIRÚRGICO DEL EDITOR):
    ========================================
    ${input.refinementInstructions}
    
    IMPORTANTE: Este es un intento de REESCRITURA. Debes aplicar las correcciones indicadas por el Editor 
    mientras mantienes las fortalezas identificadas. Sigue el procedimiento de corrección al pie de la letra.
    ========================================
    `;
    }

    const chapterData = input.chapterData;
    
    prompt += `
    ═══════════════════════════════════════════════════════════════════
    TAREA ACTUAL: CAPÍTULO ${chapterData.numero} - "${chapterData.titulo}"
    ═══════════════════════════════════════════════════════════════════
    
    DATOS BÁSICOS:
    - Cronología: ${chapterData.cronologia}
    - Ubicación: ${chapterData.ubicacion}
    - Elenco Presente: ${chapterData.elenco_presente.join(", ")}
    ${chapterData.tono_especifico ? `- Tono específico: ${chapterData.tono_especifico}` : ""}
    ${chapterData.funcion_estructural ? `- Función estructural: ${chapterData.funcion_estructural}` : ""}
    
    OBJETIVO NARRATIVO:
    ${chapterData.objetivo_narrativo}
    
    ${chapterData.informacion_nueva ? `
    ═══════════════════════════════════════════════════════════════════
    INFORMACIÓN NUEVA A REVELAR (OBLIGATORIA):
    ${chapterData.informacion_nueva}
    Esta revelación DEBE aparecer en el capítulo.
    ═══════════════════════════════════════════════════════════════════
    ` : ""}
    
    ${chapterData.conflicto_central ? `
    CONFLICTO CENTRAL DE ESTE CAPÍTULO:
    - Tipo: ${chapterData.conflicto_central.tipo || "externo"}
    - Descripción: ${chapterData.conflicto_central.descripcion || ""}
    - Lo que está en juego: ${chapterData.conflicto_central.stakes || ""}
    ` : ""}
    
    ${chapterData.giro_emocional ? `
    ARCO EMOCIONAL DEL LECTOR:
    - Al inicio del capítulo: ${chapterData.giro_emocional.emocion_inicio || "neutral"}
    - Al final del capítulo: ${chapterData.giro_emocional.emocion_final || "intrigado"}
    ` : ""}
    
    ${chapterData.arcos_que_avanza && chapterData.arcos_que_avanza.length > 0 ? `
    ARCOS QUE DEBE AVANZAR ESTE CAPÍTULO:
    ${chapterData.arcos_que_avanza.map(a => `- ${a.arco}: de "${a.de}" a "${a.a}"`).join("\n")}
    ` : ""}
    
    BEATS NARRATIVOS (SIGUE EN ORDEN):
    ${chapterData.beats.map((beat, i) => `${i + 1}. ${beat}`).join("\n")}
    
    ${chapterData.pregunta_dramatica ? `
    PREGUNTA DRAMÁTICA (debe quedar planteada al final):
    ${chapterData.pregunta_dramatica}
    ` : ""}
    
    ${chapterData.recursos_literarios_sugeridos && chapterData.recursos_literarios_sugeridos.length > 0 ? `
    RECURSOS LITERARIOS SUGERIDOS PARA ESTE CAPÍTULO:
    ${chapterData.recursos_literarios_sugeridos.join(", ")}
    ` : ""}
    
    ${chapterData.prohibiciones_este_capitulo && chapterData.prohibiciones_este_capitulo.length > 0 ? `
    ═══════════════════════════════════════════════════════════════════
    PROHIBICIONES PARA ESTE CAPÍTULO (NO USAR):
    ${chapterData.prohibiciones_este_capitulo.join(", ")}
    Estos recursos ya se usaron en capítulos anteriores. Encuentra alternativas.
    ═══════════════════════════════════════════════════════════════════
    ` : ""}
    
    ${chapterData.riesgos_de_verosimilitud ? `
    ═══════════════════════════════════════════════════════════════════
    ALERTAS DE VEROSIMILITUD DEL ARQUITECTO (CRÍTICO):
    ═══════════════════════════════════════════════════════════════════
    Posibles DEUS EX MACHINA a evitar:
    ${chapterData.riesgos_de_verosimilitud.posibles_deus_ex_machina?.length ? chapterData.riesgos_de_verosimilitud.posibles_deus_ex_machina.map((item: string) => `- ${item}`).join("\n    ") : "- Ninguno identificado"}
    
    SETUP REQUERIDO (debe haberse establecido en capítulos anteriores):
    ${chapterData.riesgos_de_verosimilitud.setup_requerido?.length ? chapterData.riesgos_de_verosimilitud.setup_requerido.map((item: string) => `- ${item}`).join("\n    ") : "- Ninguno específico"}
    
    Justificación causal: ${chapterData.riesgos_de_verosimilitud.justificacion_causal || "No especificada"}
    
    IMPORTANTE: Cada resolución debe ser SORPRENDENTE pero INEVITABLE en retrospectiva.
    ═══════════════════════════════════════════════════════════════════
    ` : ""}
    
    ${chapterData.continuidad_entrada ? `ESTADO AL INICIAR: ${chapterData.continuidad_entrada}` : ""}
    ${chapterData.continuidad_salida ? `ESTADO AL TERMINAR (para siguiente capítulo): ${chapterData.continuidad_salida}` : ""}
    
    ═══════════════════════════════════════════════════════════════════
    ESCRIBE EL CAPÍTULO COMPLETO
    ═══════════════════════════════════════════════════════════════════
    Comienza directamente con la narrativa. Sin introducción ni comentarios.
    Recuerda: NO repitas expresiones, metáforas o conceptos. Cada imagen debe ser única.
    `;

    return this.generateContent(prompt);
  }
}
