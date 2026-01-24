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
    transicion_ubicacion?: {
      ubicacion_anterior?: string;
      metodo_viaje?: string;
      duracion_estimada?: string;
      narrativa_puente?: string;
      elementos_sensoriales_viaje?: string[];
    };
  };
  worldBible: any;
  guiaEstilo: string;
  previousContinuity?: string;
  refinementInstructions?: string;
  authorName?: string;
  isRewrite?: boolean;
  minWordCount?: number;
  maxWordCount?: number;
  extendedGuideContent?: string;
  previousChapterContent?: string;
  kindleUnlimitedOptimized?: boolean;
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

5. LONGITUD: Respeta ESTRICTAMENTE el rango de palabras indicado en las instrucciones específicas del capítulo

═══════════════════════════════════════════════════════════════════
PROTOCOLO ANTI-REPETICIÓN (CRÍTICO)
═══════════════════════════════════════════════════════════════════

Tu MAYOR DEFECTO es repetir expresiones, conceptos e ideas. Debes combatirlo activamente:

A) BLACKLIST LÉXICA - CLICHÉS TRADICIONALES (Nunca uses):
   - "Parálisis de análisis" → Describe las sensaciones físicas
   - "Torrente de emociones" → Sé específico sobre QUÉ emociones
   - "Un escalofrío recorrió..." → Busca alternativas frescas
   - "El corazón le dio un vuelco" → Varía las reacciones físicas
   - "Sus ojos se encontraron" → Describe el intercambio de otra forma
   - "El tiempo pareció detenerse" → Evita este cliché

A2) BLACKLIST LÉXICA - CLICHÉS DE IA (PROHIBIDO ABSOLUTAMENTE):
   ⚠️ ESTAS PALABRAS CAUSAN RECHAZO AUTOMÁTICO DEL EDITOR:
   - "crucial" → usa: "determinante", "vital", "decisivo"
   - "enigmático/a" → usa: "misterioso", "indescifrable", "oscuro"
   - "fascinante" → usa: "cautivador", "hipnótico", "absorbente"
   - "torbellino de emociones" → describe CADA emoción por separado
   - "el destino de..." → reformula sin usar "destino"
   - "desenterrar secretos" → usa: "descubrir", "revelar", "sacar a la luz"
   - "repentinamente" / "de repente" → usa: "súbitamente", "de pronto", o simplemente omítelo
   - "sintió una oleada de" → describe la sensación física directamente
   - "palpable" → usa: "evidente", "manifiesto", "perceptible"
   - "tangible" → usa: "concreto", "real", "material"
   - "un torbellino de" → evita cualquier uso de "torbellino"
   - "se apoderó de" → usa: "lo invadió", "lo dominó"

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
TRANSICIONES DE UBICACIÓN (OBLIGATORIAS)
═══════════════════════════════════════════════════════════════════
Cuando hay cambio de ubicación entre capítulos, el inicio DEBE incluir una transición narrativa:
- NUNCA comiences un capítulo con el personaje ya en la nueva ubicación sin narrar el viaje
- Describe el trayecto: método de viaje, duración, sensaciones físicas (fatiga, clima, olores)
- Si el Arquitecto proporciona "transicion_ubicacion", DEBES usarla como guía obligatoria
- La transición debe integrarse naturalmente, no como un bloque informativo separado

Ejemplo INCORRECTO: "Lucius entró en el Anfiteatro..." (sin transición desde ubicación anterior)
Ejemplo CORRECTO: "El sol del mediodía castigaba sus hombros mientras Lucius atravesaba la Via Sacra. Una hora de caminata lo separaba del Atrium, tiempo suficiente para que el sudor empapara su túnica. Cuando finalmente divisó las columnas del Anfiteatro..."

═══════════════════════════════════════════════════════════════════
LÉXICO HISTÓRICO - VOZ DE ÉPOCA (CRÍTICO)
═══════════════════════════════════════════════════════════════════
Consulta SIEMPRE la sección "lexico_historico" del World Bible:
- NUNCA uses términos de "terminos_anacronicos_prohibidos" - son palabras modernas inaceptables
- PRIORIZA el "vocabulario_epoca_autorizado" para mantener la voz histórica auténtica
- Respeta el "registro_linguistico" indicado (formal/coloquial/técnico de época)
- Cuando dudes sobre una palabra, elige la alternativa más antigua/clásica

TÉRMINOS MODERNOS PROHIBIDOS EN FICCIÓN HISTÓRICA (lista por defecto):
"burguesa", "estrés", "impacto" (metafórico), "enfocarse", "rol", "empoderamiento", "básico", 
"literal", "problemática", "dinámico", "autoestima", "productivo", "agenda" (metafórico), 
"contexto", "paradigma", "priorizar", "gestionar", "implementar", "escenario" (metafórico)

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
⛔ CONTINUITY GATE - VERIFICACIÓN OBLIGATORIA (CRÍTICO)
═══════════════════════════════════════════════════════════════════
ANTES de escribir UNA SOLA LÍNEA de prosa, DEBES verificar el estado de CADA personaje:

1. ESTADO VITAL: ¿Está VIVO, MUERTO, HERIDO, INCONSCIENTE, DESAPARECIDO?
   - Si un personaje murió en capítulos anteriores → NO PUEDE APARECER (excepto flashback explícito)
   - Si está herido → La herida DEBE afectar sus acciones
   - Si está inconsciente → NO PUEDE actuar hasta que despierte

2. UBICACIÓN: ¿Dónde está físicamente cada personaje?
   - Un personaje en Roma NO PUEDE aparecer en Egipto sin viaje narrado
   - Respeta la última ubicación conocida del capítulo anterior

3. OBJETOS POSEÍDOS: ¿Qué tiene cada personaje?
   - Si soltó un arma → NO la tiene hasta que la recupere
   - Si perdió algo → NO puede usarlo

⚠️ Si detectas CUALQUIER conflicto entre el estado anterior y lo que pide la escaleta:
   - NO escribas el capítulo
   - Indica el conflicto en tu respuesta
   - El Editor rechazará automáticamente cualquier violación de continuidad vital

═══════════════════════════════════════════════════════════════════
🛡️ LEXICAL SHIELD - AUDITORÍA DE VOCABULARIO (OBLIGATORIO)
═══════════════════════════════════════════════════════════════════
Para ficción histórica, ANTES de escribir, prepara mentalmente sustituciones para:

PROHIBIDO → USAR EN SU LUGAR:
- "física" (ciencia) → "naturaleza", "la mecánica del cuerpo"
- "shock" → "estupor", "parálisis del espanto", "el golpe del horror"
- "microscópico" → "invisible al ojo", "diminuto", "imperceptible"
- "psicológico" → "del ánimo", "del espíritu", "mental"
- "trauma" → "herida del alma", "cicatriz invisible", "la marca"
- "estrés" → "tensión", "agobio", "peso del momento"
- "impacto" → "golpe", "efecto", "consecuencia"

Si dudas de una palabra: ¿Existía en la época? Si no → busca alternativa.

═══════════════════════════════════════════════════════════════════
⚔️ ACTION RULEBOOK - FACTIBILIDAD FÍSICA (PARA ESCENAS DE ACCIÓN)
═══════════════════════════════════════════════════════════════════
En escenas de combate o acción física:

1. CAPACIDADES DEL PERSONAJE: Consulta su ficha en World Bible
   - Un escriba no lucha como un gladiador
   - Un anciano no corre como un joven
   - Una herida previa LIMITA las acciones

2. REALISMO MÉDICO:
   - Un brazo herido NO puede sostener peso
   - La pérdida de sangre causa debilidad progresiva
   - El dolor afecta la concentración

3. CAUSALIDAD MECÁNICA:
   - Cada golpe tiene consecuencia física visible
   - La fatiga se acumula
   - Las armas se pierden, se rompen, se atascan

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
      model: "deepseek-reasoner",
      useThinking: true,
    });
  }

  async execute(input: GhostwriterInput): Promise<AgentResponse> {
    // SPECIAL HANDLING: Author's Note (Chapter -2)
    // This is NOT narrative fiction - it's a personal text from the author to readers
    if (input.chapterNumber === -2) {
      return this.executeAuthorNote(input);
    }
    
    let prompt = `
    CONTEXTO DEL MUNDO (World Bible): ${JSON.stringify(input.worldBible)}
    GUÍA DE ESTILO: ${input.guiaEstilo}
    
    ${input.previousContinuity ? `
    ═══════════════════════════════════════════════════════════════════
    ⛔ ESTADO DE CONTINUIDAD DEL CAPÍTULO ANTERIOR (VERIFICACIÓN OBLIGATORIA)
    ═══════════════════════════════════════════════════════════════════
    ${input.previousContinuity}
    
    ⚠️ ANTES DE ESCRIBIR, verifica que NINGÚN personaje listado como "dead" aparezca activo.
    ⚠️ Respeta las ubicaciones finales de cada personaje.
    ⚠️ Si un personaje tiene heridas o limitaciones, DEBEN afectar sus acciones.
    ═══════════════════════════════════════════════════════════════════
    ` : ""}
    `;

    const minWords = input.minWordCount || 2500;
    // Reduced from 1.4 to 1.15 to prevent manuscripts from exceeding target by more than 15%
    const maxWords = input.maxWordCount || Math.round(minWords * 1.15);
    
    prompt += `
    ╔═══════════════════════════════════════════════════════════════════╗
    ║  🚨🚨🚨 REQUISITO CRÍTICO DE EXTENSIÓN - LEE ESTO PRIMERO 🚨🚨🚨  ║
    ╠═══════════════════════════════════════════════════════════════════╣
    ║                                                                   ║
    ║   EXTENSIÓN MÍNIMA OBLIGATORIA: ${String(minWords).padStart(5)} PALABRAS               ║
    ║   EXTENSIÓN MÁXIMA RECOMENDADA: ${String(maxWords).padStart(5)} PALABRAS               ║
    ║                                                                   ║
    ║   ⛔ CUALQUIER CAPÍTULO MENOR A ${minWords} PALABRAS SERÁ         ║
    ║      RECHAZADO AUTOMÁTICAMENTE Y DEBERÁS REESCRIBIRLO            ║
    ║                                                                   ║
    ║   TÉCNICAS PARA ALCANZAR LA EXTENSIÓN:                           ║
    ║   • Desarrolla CADA beat con 300-500 palabras mínimo             ║
    ║   • Incluye descripciones sensoriales detalladas                 ║
    ║   • Escribe diálogos extensos con acotaciones ricas              ║
    ║   • Añade monólogo interno del protagonista                      ║
    ║   • Describe el entorno, la atmósfera, los olores, sonidos      ║
    ║   • NO resumas - NARRA con detalle cada momento                  ║
    ║                                                                   ║
    ╚═══════════════════════════════════════════════════════════════════╝
    `;

    if (input.extendedGuideContent) {
      prompt += `
    ═══════════════════════════════════════════════════════════════════
    GUÍA DE EXTENSIÓN DEL AUTOR (CRÍTICO):
    ═══════════════════════════════════════════════════════════════════
    ${input.extendedGuideContent}
    ═══════════════════════════════════════════════════════════════════
    `;
    }

    if (input.kindleUnlimitedOptimized) {
      prompt += `
    ═══════════════════════════════════════════════════════════════════
    ⚡⚡⚡ OPTIMIZACIÓN KINDLE UNLIMITED (ACTIVA) ⚡⚡⚡
    ═══════════════════════════════════════════════════════════════════
    Este proyecto está OPTIMIZADO para Kindle Unlimited. Aplica estas técnicas de escritura:
    
    1. PROSA ADICTIVA Y DIRECTA:
       - Frases cortas y punzantes que aceleran el ritmo
       - Mínima descripción ambiental, máxima acción y diálogo
       - Cada párrafo debe impulsar al lector hacia adelante
       - Evita digresiones y reflexiones extensas
    
    2. CLIFFHANGER OBLIGATORIO AL FINAL:
       - El capítulo DEBE terminar con un gancho irresistible
       - Técnicas: revelación parcial, peligro inminente, pregunta sin respuesta, giro inesperado
       - El lector debe NECESITAR pasar al siguiente capítulo
       - Ejemplos efectivos:
         • "Y entonces vi quién estaba detrás de la puerta."
         • "Lo que encontré me heló la sangre."
         • "Sabía que solo tenía una oportunidad. Esta."
    
    3. TÉCNICA PAGE-TURNER:
       - Empezar in media res (en mitad de la acción)
       - Tensión constante, sin momentos de respiro prolongados
       - Revelar información en dosis pequeñas (dosificar secretos)
       - Crear múltiples líneas de tensión simultáneas
    
    4. ESTRUCTURA DE CAPÍTULO KU:
       - Apertura: Hook inmediato en las primeras 2 frases
       - Desarrollo: Acción/conflicto creciente
       - Cierre: Cliffhanger que obliga a continuar
    
    5. RITMO FRENÉTICO:
       - Diálogos rápidos y tensos
       - Decisiones constantes del protagonista
       - Cada página debe aportar algo nuevo (revelación, peligro, giro)
    
    ⚠️ RECUERDA: En Kindle Unlimited cada página leída = ingresos.
    El lector NO PUEDE sentir que es buen momento para dejar de leer.
    ═══════════════════════════════════════════════════════════════════
    `;
    }

    if (input.refinementInstructions) {
      prompt += `
    
    ========================================
    INSTRUCCIONES DE REESCRITURA (PLAN QUIRÚRGICO DEL EDITOR):
    ========================================
    ${input.refinementInstructions}
    
    ⚠️ REGLAS DE REESCRITURA (CRÍTICAS):
    1. PRESERVA las fortalezas y pasajes efectivos del borrador anterior
    2. APLICA solo las correcciones específicas indicadas
    3. NO reduzcas la extensión - mantén o aumenta el número de palabras
    4. NO reescribas desde cero - es una EDICIÓN QUIRÚRGICA, no una reescritura total
    5. Si algo funcionaba bien, MANTENLO INTACTO
    ========================================
    `;

      if (input.previousChapterContent) {
        const truncatedPrevious = input.previousChapterContent.length > 20000 
          ? input.previousChapterContent.substring(0, 20000) + "\n[...contenido truncado...]"
          : input.previousChapterContent;
        prompt += `
    ========================================
    BORRADOR ANTERIOR (BASE PARA EDICIÓN):
    ========================================
    ${truncatedPrevious}
    ========================================
    
    INSTRUCCIÓN: Usa este borrador como BASE. Modifica SOLO lo que indican las instrucciones de corrección.
    `;
      }
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
    
    ${chapterData.transicion_ubicacion ? `
    ═══════════════════════════════════════════════════════════════════
    TRANSICIÓN DE UBICACIÓN (OBLIGATORIO AL INICIO DEL CAPÍTULO)
    ═══════════════════════════════════════════════════════════════════
    El capítulo DEBE comenzar narrando la transición desde la ubicación anterior:
    - Ubicación anterior: ${chapterData.transicion_ubicacion.ubicacion_anterior || "No especificada"}
    - Método de viaje: ${chapterData.transicion_ubicacion.metodo_viaje || "No especificado"}
    - Duración estimada: ${chapterData.transicion_ubicacion.duracion_estimada || "No especificada"}
    - Narrativa puente sugerida: ${chapterData.transicion_ubicacion.narrativa_puente || "No especificada"}
    - Elementos sensoriales del viaje: ${chapterData.transicion_ubicacion.elementos_sensoriales_viaje?.join(", ") || "No especificados"}
    
    IMPORTANTE: No comiences directamente en la nueva ubicación. Narra el trayecto.
    ═══════════════════════════════════════════════════════════════════
    ` : ""}
    
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
    
    BEATS NARRATIVOS (SIGUE EN ORDEN - DESARROLLA CADA UNO CON 300-500 PALABRAS):
    ${chapterData.beats.map((beat: any, i: number) => {
      // Handle both string and object beat formats
      if (typeof beat === 'string') {
        return `${i + 1}. ${beat}`;
      } else {
        // Object format with rich details
        let beatText = `${beat.numero || i + 1}. [${beat.tipo?.toUpperCase() || 'BEAT'}] ${beat.descripcion || ''}`;
        if (beat.personajes_activos?.length) beatText += `\n      Personajes: ${beat.personajes_activos.join(', ')}`;
        if (beat.accion_principal) beatText += `\n      Acción: ${beat.accion_principal}`;
        if (beat.elementos_sensoriales?.length) beatText += `\n      Elementos sensoriales a incluir: ${beat.elementos_sensoriales.join(', ')}`;
        if (beat.dialogo_sugerido) beatText += `\n      Diálogo sugerido: ${beat.dialogo_sugerido}`;
        if (beat.subtrama_tocada) beatText += `\n      Subtrama: ${beat.subtrama_tocada}`;
        if (beat.monologo_interno) beatText += `\n      Monólogo interno: ${beat.monologo_interno}`;
        if (beat.informacion_nueva) beatText += `\n      Información a revelar: ${beat.informacion_nueva}`;
        if (beat.tipo_hook) beatText += `\n      Tipo de hook: ${beat.tipo_hook}`;
        if (beat.pregunta_abierta) beatText += `\n      Pregunta para el lector: ${beat.pregunta_abierta}`;
        return beatText;
      }
    }).join("\n\n")}
    
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
    
    ${chapterData.continuidad_entrada ? `
    ═══════════════════════════════════════════════════════════════════
    ⛔ ESTADO OBLIGATORIO AL INICIAR (DEL ARQUITECTO) ⛔
    ═══════════════════════════════════════════════════════════════════
    ${chapterData.continuidad_entrada}
    
    VERIFICACIÓN OBLIGATORIA ANTES DE ESCRIBIR:
    - ¿Dónde están físicamente los personajes al comenzar?
    - ¿Qué heridas/limitaciones tienen? DEBEN afectar sus acciones.
    - ¿Qué objetos poseen? No pueden usar lo que no tienen.
    - ¿Qué hora/día es? Debe ser coherente con el capítulo anterior.
    ═══════════════════════════════════════════════════════════════════
    ` : ""}
    
    ${chapterData.continuidad_salida ? `
    ═══════════════════════════════════════════════════════════════════
    ESTADO OBLIGATORIO AL TERMINAR (PARA SIGUIENTE CAPÍTULO)
    ═══════════════════════════════════════════════════════════════════
    ${chapterData.continuidad_salida}
    El capítulo DEBE dejar a los personajes en este estado exacto.
    ═══════════════════════════════════════════════════════════════════
    ` : ""}
    
    ═══════════════════════════════════════════════════════════════════
    ⚠️ CHECKLIST DE CONTINUIDAD (VERIFICAR ANTES DE ESCRIBIR) ⚠️
    ═══════════════════════════════════════════════════════════════════
    1. UBICACIÓN: ¿El capítulo empieza donde terminó el anterior?
    2. TIEMPO: ¿La cronología es coherente (no hay saltos sin explicar)?
    3. PERSONAJES PRESENTES: ¿Solo aparecen los del "Elenco Presente"?
    4. PERSONAJES MUERTOS: ¿Ningún personaje marcado como "dead" aparece activo?
    5. HERIDAS: ¿Las lesiones del capítulo anterior siguen afectando?
    6. OBJETOS: ¿Los personajes solo usan objetos que realmente poseen?
    7. CONOCIMIENTO: ¿Nadie sabe información que no debería saber?
    
    ⛔ VIOLACIONES DE CONTINUIDAD = CAPÍTULO RECHAZADO ⛔
    ═══════════════════════════════════════════════════════════════════
    
    ═══════════════════════════════════════════════════════════════════
    🚨 RECORDATORIO FINAL: ESCRIBE EL CAPÍTULO COMPLETO 🚨
    ═══════════════════════════════════════════════════════════════════
    Comienza directamente con la narrativa. Sin introducción ni comentarios.
    Recuerda: NO repitas expresiones, metáforas o conceptos. Cada imagen debe ser única.
    
    ⚠️ TU CAPÍTULO DEBE TENER MÍNIMO ${minWords} PALABRAS ⚠️
    Si escribes menos, serás obligado a reescribir. Desarrolla cada escena con detalle.
    
    ═══════════════════════════════════════════════════════════════════
    ESTADO DE CONTINUIDAD (OBLIGATORIO AL FINAL)
    ═══════════════════════════════════════════════════════════════════
    DESPUÉS de escribir el capítulo, DEBES incluir un bloque JSON con el estado de continuidad.
    Este bloque DEBE estar al final, después del texto narrativo, separado por:
    
    ---CONTINUITY_STATE---
    {
      "characterStates": {
        "Nombre del Personaje": {
          "location": "Dónde termina este personaje",
          "status": "alive|dead|injured|unconscious|missing|imprisoned",
          "hasItems": ["objetos que posee"],
          "emotionalState": "estado emocional al final",
          "knowledgeGained": ["información nueva que sabe"]
        }
      },
      "narrativeTime": "Fecha/hora narrativa al terminar el capítulo",
      "keyReveals": ["revelaciones importantes hechas en este capítulo"],
      "pendingThreads": ["hilos narrativos abiertos pendientes de resolver"],
      "resolvedThreads": ["hilos narrativos cerrados en este capítulo"],
      "locationState": {
        "Nombre ubicación": "estado actual de la ubicación"
      }
    }
    
    INCLUYE TODOS los personajes que aparecen en el capítulo, no solo el protagonista.
    Este estado es CRÍTICO para mantener la continuidad entre capítulos.
    `;

    const temperature = input.isRewrite ? 0.7 : 1.0;
    return this.generateContent(prompt, undefined, { temperature });
  }
  
  extractContinuityState(content: string): { cleanContent: string; continuityState: any | null } {
    const separator = "---CONTINUITY_STATE---";
    const parts = content.split(separator);
    
    if (parts.length < 2) {
      console.log("[Ghostwriter] No continuity state separator found in content");
      return { cleanContent: content, continuityState: null };
    }
    
    const cleanContent = parts[0].trim();
    const stateJson = parts[1].trim();
    
    try {
      const continuityState = JSON.parse(stateJson);
      console.log("[Ghostwriter] Successfully extracted continuity state:", Object.keys(continuityState.characterStates || {}));
      return { cleanContent, continuityState };
    } catch (e) {
      console.log("[Ghostwriter] Failed to parse continuity state JSON:", e);
      const jsonMatch = stateJson.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const continuityState = JSON.parse(jsonMatch[0]);
          console.log("[Ghostwriter] Extracted continuity state via regex");
          return { cleanContent, continuityState };
        } catch (e2) {
          console.log("[Ghostwriter] Regex extraction also failed");
        }
      }
      return { cleanContent: content, continuityState: null };
    }
  }

  /**
   * Special method for generating Author's Note (Chapter -2)
   * This is NOT narrative fiction - it's a personal text from the author to readers
   */
  private async executeAuthorNote(input: GhostwriterInput): Promise<AgentResponse> {
    const authorName = input.authorName || "El Autor";
    const worldBible = input.worldBible;
    const title = worldBible?.titulo || "esta novela";
    const genre = worldBible?.genero || "ficción";
    const premise = worldBible?.premisa || "";
    const setting = worldBible?.ambientacion?.epoca || "";
    const location = worldBible?.ambientacion?.ubicacion || "";
    
    const authorNotePrompt = `
═══════════════════════════════════════════════════════════════════
⚠️ INSTRUCCIONES ESPECIALES: NOTA DEL AUTOR (NO ES NARRATIVA)
═══════════════════════════════════════════════════════════════════

IMPORTANTE: Esto NO es un capítulo de ficción. Es una NOTA DEL AUTOR - un texto 
personal y sincero dirigido directamente a los lectores, escrito en primera 
persona desde la perspectiva del autor "${authorName}".

═══════════════════════════════════════════════════════════════════
INFORMACIÓN DEL PROYECTO
═══════════════════════════════════════════════════════════════════
- Título de la novela: ${title}
- Género: ${genre}
- Premisa: ${premise}
- Época/Ambientación: ${setting}
- Ubicación: ${location}

═══════════════════════════════════════════════════════════════════
ESTRUCTURA DE LA NOTA DEL AUTOR
═══════════════════════════════════════════════════════════════════

La Nota del Autor debe incluir estos elementos (en el orden que prefieras):

1. SALUDO PERSONAL AL LECTOR
   - Agradece al lector por haber llegado hasta el final
   - Reconoce el tiempo que han dedicado a la historia

2. GÉNESIS DE LA HISTORIA
   - ¿Qué inspiró esta novela? (puede ser ficticio pero creíble)
   - ¿Qué pregunta o inquietud quería explorar el autor?
   - Menciona alguna anécdota sobre cómo surgió la idea

3. PROCESO DE INVESTIGACIÓN (si aplica al género)
   - Para novela histórica: menciona fuentes, viajes, expertos consultados
   - Para thriller: aspectos técnicos investigados
   - Para cualquier género: el trabajo detrás de la ambientación

4. REFLEXIÓN PERSONAL
   - ¿Qué significan los personajes para el autor?
   - ¿Qué mensaje o emoción espera transmitir?
   - Conexión emocional con la historia

5. AGRADECIMIENTOS BREVES
   - A la familia por su paciencia
   - Al equipo editorial (mencionado de forma genérica)
   - A los lectores fieles

6. CIERRE CÁLIDO
   - Invitación a conectar (redes sociales genéricas)
   - Despedida personal y cálida
   - Posible mención del próximo proyecto (opcional)

═══════════════════════════════════════════════════════════════════
TONO Y ESTILO
═══════════════════════════════════════════════════════════════════

- PRIMERA PERSONA: Escribe como "${authorName}" hablando directamente al lector
- TONO ÍNTIMO Y CERCANO: Como si hablaras con un amigo
- SINCERIDAD: Transmite pasión genuina por el oficio de escribir
- HUMILDAD: Sin arrogancia, con gratitud
- CALIDEZ: El lector debe sentirse valorado

PROHIBIDO:
- NO escribas narrativa ficticia (escenas, diálogos de personajes)
- NO incluyas spoilers de la trama
- NO uses el tono formal de la novela
- NO hagas referencias a IA o generación automática
- NO incluyas elementos meta-textuales sobre el proceso de escritura técnico

═══════════════════════════════════════════════════════════════════
EXTENSIÓN
═══════════════════════════════════════════════════════════════════

Escribe entre 800 y 1200 palabras. Es un texto breve pero significativo.

═══════════════════════════════════════════════════════════════════
FORMATO DE SALIDA
═══════════════════════════════════════════════════════════════════

Escribe SOLO el texto de la Nota del Autor, sin encabezados ni marcadores.
Comienza directamente con el texto, como si fuera la página de la nota
en un libro impreso.

Firma al final con:
${authorName}
[Mes y año ficticios coherentes]
`;

    console.log(`[Ghostwriter] Generating Author's Note for "${title}" by ${authorName}`);
    
    const response = await this.callModel(authorNotePrompt);
    
    return {
      content: response.content,
      agentType: "ghostwriter",
      thinking: response.thinking,
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
      thinkingTokens: response.thinkingTokens,
    };
  }
}
