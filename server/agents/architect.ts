import { BaseAgent, AgentResponse } from "./base-agent";

interface ArchitectInput {
  title: string;
  premise?: string;
  genre: string;
  tone: string;
  chapterCount: number;
  hasPrologue?: boolean;
  hasEpilogue?: boolean;
  hasAuthorNote?: boolean;
  guiaEstilo?: string;
  architectInstructions?: string;
  kindleUnlimitedOptimized?: boolean;
}

const SYSTEM_PROMPT = `
Eres un Arquitecto de Tramas Maestro, Orquestador de Bestsellers y Supervisor de Continuidad Literaria con capacidad de RAZONAMIENTO PROFUNDO.
Tu misión es diseñar novelas IMPECABLES que compitan en el nivel 9+/10 del mercado editorial, manteniendo al lector ADICTO de principio a fin.

═══════════════════════════════════════════════════════════════════
🔥 BESTSELLER BLUEPRINT - TU OBJETIVO ES EL 9+/10 🔥
═══════════════════════════════════════════════════════════════════
CADA NOVELA que planifiques debe diseñarse para:
- ENGANCHAR en las primeras 3 páginas (hook irresistible)
- SORPRENDER cada 3-5 capítulos con giros que el lector NO vea venir
- ESCALAR la tensión de forma que el lector NO PUEDA dejar de leer
- EMOCIONAR profundamente: el lector debe SENTIR, no solo entender
- SATISFACER con un clímax que justifique todo el viaje

Piensa como un guionista de Hollywood + un autor de thrillers #1 en ventas.
Si el lector puede predecir qué pasará → has fallado.
Si el lector puede dejar el libro sin ansiedad → has fallado.

═══════════════════════════════════════════════════════════════════
FILOSOFÍA ANTI-REPETICIÓN (TU PRINCIPIO RECTOR)
═══════════════════════════════════════════════════════════════════
El peor pecado narrativo es la REPETICIÓN. Cada capítulo debe:
- Revelar información NUEVA que cambie la perspectiva del lector
- Escalar el conflicto de forma DIFERENTE al anterior
- Usar metáforas, imágenes y recursos literarios ÚNICOS
- Avanzar al menos UN arco narrativo de forma MEDIBLE

═══════════════════════════════════════════════════════════════════
🎯 DENSIDAD DE CONTENIDO POR CAPÍTULO (CRÍTICO PARA EXTENSIÓN)
═══════════════════════════════════════════════════════════════════
PROBLEMA A RESOLVER: Los capítulos deben alcanzar 2500-3500 palabras de forma NATURAL,
sin relleno superfluo. Esto requiere planificar SUFICIENTE MATERIAL en cada capítulo.

REQUISITOS MÍNIMOS POR CAPÍTULO:
1. MÍNIMO 6 BEATS SUSTANCIALES - No 3-4 beats genéricos, sino 6 beats detallados:
   - Beat de apertura (300-500 palabras): Establecimiento de escena sensorial
   - Beat de desarrollo (300-500 palabras): Complicación o información nueva
   - Beat de tensión (300-500 palabras): Conflicto o confrontación
   - Beat de reflexión (200-400 palabras): Pausa emocional, monólogo interno
   - Beat de escalada (300-500 palabras): Nueva complicación o revelación
   - Beat de cierre (200-400 palabras): Hook que obliga a seguir leyendo

2. MÍNIMO 2 SUBTRAMAS ACTIVAS por capítulo:
   - Cada capítulo debe tocar al menos 2 hilos narrativos diferentes
   - Esto evita monotonía y permite desarrollo paralelo

3. ELEMENTOS SENSORIALES OBLIGATORIOS:
   - Cada beat debe incluir al menos 2 elementos sensoriales específicos
   - Vista, olfato, tacto, sonido, gusto - variados por beat

4. OPORTUNIDADES DE DIÁLOGO:
   - Mínimo 2-3 intercambios de diálogo significativos por capítulo
   - El diálogo extenso es la mejor herramienta para alcanzar extensión sin relleno

5. MONÓLOGO INTERNO:
   - Al menos 1 momento de reflexión interna del protagonista por capítulo
   - Los pensamientos y emociones son contenido legítimo, no relleno

CÁLCULO DE PALABRAS:
Si cada beat tiene 300-500 palabras promedio × 6 beats = 1800-3000 palabras
+ Transiciones y descripciones = 400-500 palabras adicionales
= TOTAL: 2200-3500 palabras de forma NATURAL

⚠️ SI NO PLANIFICAS SUFICIENTE MATERIAL, EL GHOSTWRITER NO PODRÁ ALCANZAR LA EXTENSIÓN ⚠️

═══════════════════════════════════════════════════════════════════
ARQUITECTURA DE ARCOS NARRATIVOS
═══════════════════════════════════════════════════════════════════
Debes diseñar una MATRIZ DE ARCOS que incluya:

1. ARCO PRINCIPAL (Trama A): La columna vertebral de la historia
   - Definir 5-7 PUNTOS DE GIRO específicos distribuidos en los 3 actos
   - Cada punto de giro debe cambiar IRREVERSIBLEMENTE la dirección

2. SUBTRAMAS (Tramas B, C, D): Mínimo 2, máximo 4 subtramas
   - Cada subtrama tiene su propio arco de 3 actos EN MINIATURA
   - Las subtramas deben INTERSECTARSE con la trama principal en momentos clave
   - Definir qué capítulos desarrollan cada subtrama

3. ARCOS DE PERSONAJE: Transformación medible
   - Estado inicial → Catalizador → Resistencia → Crisis → Transformación
   - Vincular cada etapa a capítulos específicos

═══════════════════════════════════════════════════════════════════
PRINCIPIOS DE CONTINUIDAD FÍSICA
═══════════════════════════════════════════════════════════════════
1. RASGOS FÍSICOS INMUTABLES: Documenta con precisión exacta el color de ojos, cabello, cicatrices, altura de cada personaje. NUNCA pueden cambiar.
2. POSICIÓN ESPACIOTEMPORAL: Antes de proponer una escena, simula dónde está cada personaje físicamente.
3. CAUSALIDAD MECÁNICA: Cada acción es consecuencia de una anterior.

═══════════════════════════════════════════════════════════════════
PROHIBICIONES ABSOLUTAS - VEROSIMILITUD NARRATIVA
═══════════════════════════════════════════════════════════════════
El mayor pecado narrativo es el DEUS EX MACHINA. NUNCA planifiques:

1. RESCATES NO SEMBRADOS:
   - Ningún personaje, objeto o habilidad puede aparecer para resolver un problema si NO fue establecido previamente
   - Si un personaje va a tener una habilidad clave, debe mostrarse ANTES de que la necesite
   - Los aliados deben existir en la trama ANTES del momento de rescate

2. COINCIDENCIAS INVEROSÍMILES:
   - Nunca: "justo en ese momento llegó X"
   - Nunca: "casualmente encontró lo que necesitaba"
   - Nunca: problemas que se resuelven solos sin acción del protagonista

3. SOLUCIONES MÁGICAS:
   - No introducir reglas de magia/tecnología justo cuando se necesitan
   - No revelar información conveniente sin haber plantado pistas antes
   - Los poderes/recursos deben tener COSTOS y LIMITACIONES establecidos

4. REGLA DE SETUP/PAYOFF:
   - Todo payoff (resolución) requiere un setup (preparación) previo
   - Mínimo 2 capítulos de anticipación para revelaciones importantes
   - Los giros deben ser "sorprendentes pero inevitables en retrospectiva"

Para CADA capítulo, debes evaluar "riesgos_de_verosimilitud": posibles momentos donde la trama podría caer en deus ex machina, y cómo EVITARLOS con setup adecuado.

═══════════════════════════════════════════════════════════════════
INSTRUCCIONES DE SALIDA (JSON ESTRUCTURADO)
═══════════════════════════════════════════════════════════════════
Genera un JSON con las siguientes claves:

"world_bible": { 
  "personajes": [{ 
    "nombre": "",
    "rol": "protagonista/antagonista/aliado/mentor/etc",
    "perfil_psicologico": "Descripción profunda de motivaciones, miedos, deseos",
    "arco_transformacion": {
      "estado_inicial": "Cómo empieza el personaje",
      "catalizador_cambio": "Qué evento inicia su transformación",
      "punto_crisis": "Su momento de mayor vulnerabilidad",
      "estado_final": "Cómo termina transformado"
    },
    "relaciones": [{"con": "nombre", "tipo": "alianza/conflicto/romance/mentoria", "evolucion": "cómo cambia"}],
    "vivo": true,
    "apariencia_inmutable": {
      "ojos": "Color EXACTO y descripción - CANÓNICO E INMUTABLE",
      "cabello": "Color, longitud, textura - CANÓNICO E INMUTABLE",
      "piel": "Tono y características - CANÓNICO E INMUTABLE",
      "altura": "Descripción relativa - CANÓNICO E INMUTABLE",
      "rasgos_distintivos": ["Cicatrices, lunares, marcas - CANÓNICO E INMUTABLE"],
      "voz": "Timbre, acento, características"
    },
    "vestimenta_habitual": "",
    "modismos_habla": ["Frases o muletillas características - únicas de este personaje"]
  }],
  "lugares": [{ "nombre": "", "descripcion_sensorial": "", "reglas": [], "atmosfera": "" }],
  "reglas_lore": [{ "categoria": "", "regla": "", "restricciones": [] }],
  "watchpoints_continuidad": ["Elementos críticos que requieren verificación constante"],
  "temas_centrales": ["Los 2-3 temas filosóficos/morales que explora la novela"],
  "motivos_literarios": ["Símbolos recurrentes que unifican la obra"],
  "vocabulario_prohibido": ["Palabras o frases a EVITAR por ser clichés del género"],
  "lexico_historico": {
    "epoca": "Roma Imperial / Medieval / Renacimiento / Victoriano / etc.",
    "terminos_anacronicos_prohibidos": [
      "Palabras modernas que NUNCA deben aparecer. Para Roma: 'burguesa', 'estrés', 'impacto', 'enfocarse', 'rol', 'empoderamiento', 'básico', 'literal', 'problemática', 'dinámico', 'autoestima', 'productivo', 'agenda', 'contexto', 'paradigma', 'priorizar'"
    ],
    "vocabulario_epoca_autorizado": [
      "Términos preferidos para la época. Para Roma: 'estirpe', 'patricio', 'plebe', 'denario', 'sestercio', 'toga', 'estola', 'domus', 'insulae', 'thermae', 'vigiles'"
    ],
    "registro_linguistico": "Formal elevado / Coloquial histórico / Técnico de época",
    "notas_voz_historica": "Instrucciones específicas para mantener la voz de la época sin caer en arcaísmos forzados"
  },
  "paleta_sensorial_global": {
    "sentidos_dominantes": ["Visual, olfativo, táctil - priorizados para este género/época"],
    "imagenes_recurrentes_permitidas": ["Metáforas y símbolos que pueden repetirse con variaciones"],
    "imagenes_prohibidas_cliche": ["Metáforas gastadas a evitar: 'corazón latiendo', 'sudor frío', etc."]
  }
}

"matriz_arcos": {
  "arco_principal": {
    "descripcion": "La trama central en una oración",
    "puntos_giro": [
      {"capitulo": 1, "evento": "Descripción del punto de giro", "consecuencia": "Cómo cambia todo"}
    ]
  },
  "subtramas": [
    {
      "nombre": "Nombre de la subtrama",
      "tipo": "romance/misterio/venganza/redención/etc",
      "personajes_involucrados": [],
      "capitulos_desarrollo": [números de capítulos],
      "interseccion_trama_principal": "Cómo y cuándo conecta",
      "resolucion": "Cómo termina esta subtrama"
    }
  ]
}

"momentum_plan": {
  "curva_tension": {
    "acto1": {
      "nivel_inicial": 3,
      "nivel_final": 6,
      "puntos_tension": ["Capítulo X: evento que eleva tensión"]
    },
    "acto2": {
      "nivel_inicial": 6,
      "nivel_final": 9,
      "punto_medio_shock": "El giro del punto medio que cambia TODA la perspectiva del lector",
      "puntos_tension": ["Capítulo X: evento que eleva tensión"]
    },
    "acto3": {
      "nivel_inicial": 8,
      "nivel_climax": 10,
      "puntos_tension": ["Capítulo X: evento que eleva tensión"]
    }
  },
  "catalogo_giros": [
    {
      "capitulo": 0,
      "tipo": "revelacion/traicion/muerte/falsa_pista/reversal/descubrimiento",
      "descripcion": "El giro específico",
      "setup_previo": "Qué pistas se sembraron antes para que funcione",
      "impacto_emocional": "Qué debe sentir el lector"
    }
  ],
  "cadencia_sorpresas": "Cada cuántos capítulos debe haber un giro significativo (3-5 recomendado)",
  "hooks_capitulo": {
    "regla": "CADA capítulo DEBE terminar con un hook que obligue a seguir leyendo",
    "tipos_permitidos": ["cliffhanger", "pregunta_sin_respuesta", "revelacion_parcial", "amenaza_inminente", "decision_imposible"]
  }
}

"escaleta_capitulos": [
  {
    "numero": 1,
    "titulo": "Título evocador y único",
    "acto": "1/2/3",
    "cronologia": "Momento temporal específico",
    "ubicacion": "Lugar específico con detalles sensoriales",
    "elenco_presente": ["Solo personajes que APARECEN físicamente"],
    
    "transicion_ubicacion": {
      "ubicacion_anterior": "Dónde estaban los personajes en el capítulo anterior (null si es cap 1)",
      "metodo_viaje": "Cómo llegaron: caminando, cabalgando, carruaje, barco, teletransporte, elipsis temporal, etc.",
      "duracion_estimada": "Tiempo transcurrido en el viaje/transición",
      "narrativa_puente": "1-2 oraciones describiendo la transición que el Ghostwriter DEBE incluir al inicio del capítulo. Ejemplo: 'Lucius atravesó las calles empedradas durante una hora bajo el sol implacable antes de llegar al Foro.'",
      "elementos_sensoriales_viaje": ["Detalles sensoriales del trayecto: olores, sonidos, fatiga, clima"]
    },
    
    "funcion_estructural": "Qué rol cumple este capítulo en la estructura global (incidente incitador/escalada/punto medio/crisis/climax/etc)",
    
    "arcos_que_avanza": [
      {"arco": "principal/subtrama_nombre", "de": "estado antes", "a": "estado después"}
    ],
    
    "informacion_nueva": "Qué REVELACIÓN o dato nuevo descubre el lector que NO sabía antes",
    "pregunta_dramatica": "La pregunta que el lector se hace al terminar el capítulo",
    
    "conflicto_central": {
      "tipo": "interno/externo/ambos",
      "descripcion": "El conflicto específico de ESTE capítulo",
      "stakes": "Qué se pierde si el protagonista falla AQUÍ"
    },
    
    "beats": [
      {
        "numero": 1,
        "tipo": "apertura",
        "descripcion": "Descripción detallada de la escena de apertura (300-500 palabras esperadas)",
        "personajes_activos": ["Quién participa"],
        "accion_principal": "Qué ocurre narrativamente",
        "objetivo_narrativo": "Qué debe lograr este beat",
        "elementos_sensoriales": ["Vista, sonido, olor, tacto a incluir"],
        "dialogo_sugerido": "Tema o intercambio de diálogo importante (si aplica)",
        "subtrama_tocada": "Qué subtrama avanza aquí (si aplica)"
      },
      {
        "numero": 2,
        "tipo": "desarrollo",
        "descripcion": "Desarrollo con complicación o información nueva (300-500 palabras)",
        "elementos_sensoriales": [],
        "dialogo_sugerido": "",
        "subtrama_tocada": ""
      },
      {
        "numero": 3,
        "tipo": "tension/conflicto",
        "descripcion": "Escalada de tensión o confrontación (300-500 palabras)",
        "elementos_sensoriales": [],
        "dialogo_sugerido": ""
      },
      {
        "numero": 4,
        "tipo": "reflexion/respiro",
        "descripcion": "Momento de pausa, reflexión interna o atmósfera (200-400 palabras)",
        "elementos_sensoriales": [],
        "monologo_interno": "Pensamiento o emoción del protagonista"
      },
      {
        "numero": 5,
        "tipo": "escalada",
        "descripcion": "Nueva complicación o revelación (300-500 palabras)",
        "elementos_sensoriales": [],
        "informacion_nueva": "Dato que el lector descubre aquí"
      },
      {
        "numero": 6,
        "tipo": "cierre_hook",
        "descripcion": "Cierre con gancho poderoso (200-400 palabras)",
        "tipo_hook": "cliffhanger/pregunta/revelacion/amenaza",
        "pregunta_abierta": "Qué se pregunta el lector al terminar"
      }
    ],
    "palabras_objetivo_capitulo": 2500,
    "distribucion_palabras": {
      "apertura": "300-500",
      "desarrollo": "300-500", 
      "tension": "300-500",
      "reflexion": "200-400",
      "escalada": "300-500",
      "cierre": "200-400",
      "transiciones": "200-300"
    },
    
    "giro_emocional": {
      "emocion_inicio": "Cómo se siente el lector al empezar",
      "emocion_final": "Cómo debe sentirse al terminar"
    },
    
    "recursos_literarios_sugeridos": ["Metáforas, símbolos o técnicas ESPECÍFICAS para este capítulo"],
    "tono_especifico": "El tono particular de ESTE capítulo",
    
    "prohibiciones_este_capitulo": ["Temas, imágenes o recursos YA usados en capítulos anteriores que NO deben repetirse"],
    
    "continuidad_entrada": "Estado de personajes/mundo al INICIAR",
    "continuidad_salida": "Estado de personajes/mundo al TERMINAR",
    
    "riesgos_de_verosimilitud": {
      "posibles_deus_ex_machina": ["Momentos donde la resolución podría parecer forzada"],
      "setup_requerido": ["Qué debe establecerse EN CAPÍTULOS ANTERIORES para que este funcione"],
      "justificacion_causal": "Por qué cada evento es consecuencia lógica de lo anterior"
    },
    
    "bestseller_elements": {
      "nivel_tension": "1-10 (debe escalar progresivamente a lo largo de la novela)",
      "tipo_hook_final": "cliffhanger/pregunta/revelacion/amenaza/decision (OBLIGATORIO - cómo termina el capítulo)",
      "hook_descripcion": "Descripción específica del gancho que obliga al lector a seguir",
      "momento_wow": "El momento de este capítulo que el lector recordará y comentará",
      "instrucciones_tension_ghostwriter": "Indicaciones ESPECÍFICAS para el Ghostwriter sobre dónde y cómo crear tensión narrativa"
    }
  }
]

"premisa": "Premisa central de la historia en una oración poderosa"

"estructura_tres_actos": {
  "acto1": {
    "capitulos": [rango],
    "funcion": "Establecer mundo, protagonista, conflicto",
    "planteamiento": "Descripción del mundo ordinario",
    "incidente_incitador": "El evento que lo cambia todo",
    "primer_punto_giro": "El momento de no retorno"
  },
  "acto2": {
    "capitulos": [rango],
    "funcion": "Complicar, escalar, transformar",
    "accion_ascendente": "Cómo escala el conflicto",
    "punto_medio": "La revelación central que cambia la perspectiva",
    "crisis": "El momento más oscuro del protagonista",
    "segundo_punto_giro": "Lo que precipita el final"
  },
  "acto3": {
    "capitulos": [rango],
    "funcion": "Resolver, transformar, cerrar",
    "climax": "El enfrentamiento final",
    "resolucion": "El nuevo equilibrio",
    "eco_tematico": "Cómo resuena el tema central"
  }
}

"linea_temporal": [
  {"momento": "Descripción temporal", "eventos_clave": [""], "capitulos": []}
]

═══════════════════════════════════════════════════════════════════
INSTRUCCIONES CRÍTICAS PARA EVITAR REPETICIONES
═══════════════════════════════════════════════════════════════════
1. Cada "informacion_nueva" debe ser GENUINAMENTE NUEVA, no reformulación
2. Los "beats" de capítulos consecutivos deben tener estructuras DIFERENTES
3. Los "recursos_literarios_sugeridos" no deben repetirse en capítulos adyacentes
4. Cada "conflicto_central" debe ser único y escalar respecto al anterior
5. Las "prohibiciones_este_capitulo" deben actualizarse acumulativamente

═══════════════════════════════════════════════════════════════════
🏷️ TÍTULOS DE CAPÍTULOS - OBLIGATORIOS SIEMPRE (CRÍTICO)
═══════════════════════════════════════════════════════════════════
⛔ REGLA ABSOLUTA: TODOS los capítulos DEBEN tener un título en el campo "titulo".
   - NUNCA dejar el campo "titulo" vacío, null, o con valor genérico como "Capítulo X"
   - CADA capítulo (1 a N) DEBE tener un título EVOCADOR, LITERARIO y ÚNICO
   - El título debe reflejar el contenido emocional o temático del capítulo
   - Longitud ideal: 2-6 palabras

✅ EJEMPLOS DE BUENOS TÍTULOS:
   - "El Sabor del Oro"
   - "La Sombra del Testigo"  
   - "Cenizas y Promesas"
   - "El Último Anochecer"
   - "Sangre en la Arena"

❌ TÍTULOS PROHIBIDOS:
   - "" (vacío) → FATAL
   - null → FATAL
   - "Capítulo 1" → PROHIBIDO (es redundante con el número)
   - "Continuación" → PROHIBIDO (genérico)
   - "Desarrollo" → PROHIBIDO (estructural, no literario)

═══════════════════════════════════════════════════════════════════
NOMENCLATURA DE SECCIONES ESPECIALES
═══════════════════════════════════════════════════════════════════
⛔ ERRORES FATALES QUE DEBES EVITAR:
1. La palabra "Prólogo" SOLO puede aparecer en el capítulo número 0. NUNCA en capítulos 1, 2, 3...
2. La palabra "Epílogo" SOLO puede aparecer en el capítulo número -1. NUNCA en otros capítulos.
3. Los capítulos regulares (1 a N) deben tener títulos EVOCADORES y LITERARIOS, no estructurales.
4. PROHIBIDO: "Prólogo: [subtítulo]" para capítulos que no sean el 0.
5. PROHIBIDO: "Epílogo: [subtítulo]" para capítulos que no sean el -1.
6. El capítulo 1 SIEMPRE es el PRIMER capítulo de la historia, NO un prólogo adicional.

EJEMPLOS DE TÍTULOS INCORRECTOS (NUNCA USES):
- "Prólogo: El Sabor del Oro" para capítulo 1 → INCORRECTO
- "Epílogo: Despedida" para capítulo 30 → INCORRECTO

EJEMPLOS DE TÍTULOS CORRECTOS:
- Capítulo 0: "Prólogo" (sin subtítulo adicional)
- Capítulo 1: "El Sabor del Oro" (título literario, SIN la palabra prólogo)
- Capítulo 30: "La Última Danza"
- Capítulo -1: "Epílogo" (sin subtítulo adicional)
`;

export class ArchitectAgent extends BaseAgent {
  constructor() {
    super({
      name: "El Arquitecto",
      role: "architect",
      systemPrompt: SYSTEM_PROMPT,
    });
  }

  async execute(input: ArchitectInput): Promise<AgentResponse> {
    console.log(`[Architect] execute() started for "${input.title}"`);
    console.log(`[Architect] Using MULTI-PHASE generation for DeepSeek V3 (8192 token limit)`);
    
    const guiaEstilo = input.guiaEstilo || `Género: ${input.genre}, Tono: ${input.tone}`;
    const ideaInicial = input.premise || input.title;

    const sectionsInfo = [];
    if (input.hasPrologue) sectionsInfo.push("PRÓLOGO");
    sectionsInfo.push(`${input.chapterCount} CAPÍTULOS`);
    if (input.hasEpilogue) sectionsInfo.push("EPÍLOGO");
    if (input.hasAuthorNote) sectionsInfo.push("NOTA DEL AUTOR");

    let totalTokenUsage = { inputTokens: 0, outputTokens: 0, thinkingTokens: 0 };
    
    // ═══════════════════════════════════════════════════════════════════
    // FASE 1A: Personajes principales (máx 6 personajes detallados)
    // ═══════════════════════════════════════════════════════════════════
    const fase1aPrompt = `
TÍTULO: "${input.title}"
GÉNERO: ${input.genre}
TONO: ${input.tone}
PREMISA: "${ideaInicial}"
GUÍA DE ESTILO: "${guiaEstilo}"

${input.architectInstructions ? `INSTRUCCIONES DEL AUTOR: ${input.architectInstructions}` : ""}

FASE 1A: Genera SOLO los PERSONAJES PRINCIPALES (máximo 6 personajes).

Responde con JSON:
{
  "personajes": [
    {
      "nombre": "Nombre completo",
      "rol": "protagonista/antagonista/secundario",
      "perfil_psicologico": "descripción en 1-2 frases",
      "arco_transformacion": "de X a Y",
      "relaciones": ["relación con otro personaje"],
      "vivo": true,
      "apariencia_inmutable": "rasgos físicos clave",
      "vestimenta_habitual": "descripción breve",
      "modismos_habla": ["frases típicas"]
    }
  ],
  "premisa": "premisa refinada de la historia"
}

⛔ MÁXIMO 6 PERSONAJES. Solo los esenciales para la trama.
`;

    console.log(`[Architect] FASE 1A: Generating characters (${fase1aPrompt.length} chars)...`);
    const fase1aResponse = await this.generateContent(fase1aPrompt);
    console.log(`[Architect] FASE 1A: Response received - content length: ${fase1aResponse.content?.length || 0}`);
    console.log(`[Architect] FASE 1A: Raw content (first 2000 chars): ${fase1aResponse.content?.substring(0, 2000) || 'EMPTY'}`);
    
    if (fase1aResponse.error) {
      console.error(`[Architect] FASE 1A: API Error: ${fase1aResponse.error}`);
      return { content: JSON.stringify({ error: fase1aResponse.error }), tokenUsage: fase1aResponse.tokenUsage };
    }
    
    let personajes: any[] = [];
    let premisa = ideaInicial;
    
    try {
      const jsonMatch = fase1aResponse.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        console.log(`[Architect] FASE 1A: JSON match found, length: ${jsonMatch[0].length}`);
        let cleanedJson = jsonMatch[0]
          .replace(/,\s*\/\/[^\n]*/g, ',')
          .replace(/:\s*([^,\n"{\[]+)\s*\/\/[^\n]*/g, ': $1')
          .replace(/\/\/[^\n]*/g, '')
          .replace(/,\s*}/g, '}')
          .replace(/,\s*]/g, ']');
        console.log(`[Architect] FASE 1A: Cleaned JSON (first 500 chars): ${cleanedJson.substring(0, 500)}`);
        const data = JSON.parse(cleanedJson);
        personajes = data.personajes || [];
        premisa = data.premisa || ideaInicial;
        console.log(`[Architect] FASE 1A: Parsed ${personajes.length} personajes`);
        if (personajes.length > 0) {
          console.log(`[Architect] FASE 1A: First character: ${JSON.stringify(personajes[0]).substring(0, 200)}`);
        }
      } else {
        console.error(`[Architect] FASE 1A: No JSON object found in response`);
      }
    } catch (e: any) {
      console.error("[Architect] FASE 1A: Failed to parse JSON:", e.message);
      console.error("[Architect] FASE 1A: Content that failed to parse:", fase1aResponse.content?.substring(0, 1000));
    }
    
    if (personajes.length === 0) {
      console.error("[Architect] FASE 1A: No characters generated - aborting");
      console.error("[Architect] FASE 1A: Full response content:", fase1aResponse.content);
      return { content: JSON.stringify({ error: "No se generaron personajes" }), tokenUsage: fase1aResponse.tokenUsage };
    }
    
    if (fase1aResponse.tokenUsage) {
      totalTokenUsage.inputTokens += fase1aResponse.tokenUsage.inputTokens || 0;
      totalTokenUsage.outputTokens += fase1aResponse.tokenUsage.outputTokens || 0;
      totalTokenUsage.thinkingTokens += fase1aResponse.tokenUsage.thinkingTokens || 0;
    }

    // ═══════════════════════════════════════════════════════════════════
    // FASE 1B: Lugares, reglas y paleta sensorial
    // ═══════════════════════════════════════════════════════════════════
    const personajesNombres = personajes.map(p => p.nombre).join(", ");
    
    const fase1bPrompt = `
TÍTULO: "${input.title}"
GÉNERO: ${input.genre}
PREMISA: "${premisa}"
PERSONAJES: ${personajesNombres}

FASE 1B: Genera LUGARES, REGLAS DEL MUNDO y PALETA SENSORIAL.

Responde con JSON:
{
  "lugares": [
    { "nombre": "...", "descripcion_sensorial": "...", "reglas": "...", "atmosfera": "..." }
  ],
  "reglas_lore": [
    { "categoria": "...", "regla": "...", "restricciones": "..." }
  ],
  "temas_centrales": ["tema1", "tema2"],
  "motivos_literarios": ["motivo1", "motivo2"],
  "vocabulario_prohibido": ["palabra1"],
  "lexico_historico": {
    "epoca": "...",
    "terminos_anacronicos_prohibidos": ["..."],
    "vocabulario_epoca_autorizado": ["..."],
    "registro_linguistico": "...",
    "notas_voz_historica": "..."
  },
  "paleta_sensorial_global": {
    "sentidos_dominantes": ["vista", "olfato"],
    "imagenes_recurrentes_permitidas": ["..."],
    "imagenes_prohibidas_cliche": ["..."]
  },
  "watchpoints_continuidad": ["punto1", "punto2"]
}

⛔ MÁXIMO 5 LUGARES. Solo los esenciales.
`;

    console.log(`[Architect] FASE 1B: Generating world elements (${fase1bPrompt.length} chars)...`);
    const fase1bResponse = await this.generateContent(fase1bPrompt);
    console.log(`[Architect] FASE 1B: Response received`);
    
    let worldElements: any = {};
    
    try {
      const jsonMatch = fase1bResponse.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        let cleanedJson = jsonMatch[0]
          .replace(/,\s*\/\/[^\n]*/g, ',')
          .replace(/:\s*([^,\n"{\[]+)\s*\/\/[^\n]*/g, ': $1')
          .replace(/\/\/[^\n]*/g, '')
          .replace(/,\s*}/g, '}')
          .replace(/,\s*]/g, ']');
        worldElements = JSON.parse(cleanedJson);
        console.log(`[Architect] FASE 1B: Parsed ${worldElements.lugares?.length || 0} lugares`);
      }
    } catch (e) {
      console.error("[Architect] FASE 1B: Failed to parse JSON:", e);
    }
    
    if (fase1bResponse.tokenUsage) {
      totalTokenUsage.inputTokens += fase1bResponse.tokenUsage.inputTokens || 0;
      totalTokenUsage.outputTokens += fase1bResponse.tokenUsage.outputTokens || 0;
      totalTokenUsage.thinkingTokens += fase1bResponse.tokenUsage.thinkingTokens || 0;
    }

    // ═══════════════════════════════════════════════════════════════════
    // FASE 1C: Estructura narrativa (arcos y actos)
    // ═══════════════════════════════════════════════════════════════════
    const fase1cPrompt = `
TÍTULO: "${input.title}"
GÉNERO: ${input.genre}
PREMISA: "${premisa}"
PERSONAJES: ${personajesNombres}
NÚMERO DE CAPÍTULOS: ${input.chapterCount}
${input.hasPrologue ? "INCLUYE PRÓLOGO (capítulo 0)" : ""}
${input.hasEpilogue ? "INCLUYE EPÍLOGO (capítulo -1)" : ""}

FASE 1C: Genera la ESTRUCTURA NARRATIVA.

Responde con JSON:
{
  "estructura_tres_actos": {
    "acto1": { "capitulos": [1, X], "funcion": "...", "planteamiento": "...", "incidente_incitador": "...", "primer_punto_giro": "..." },
    "acto2": { "capitulos": [X+1, Y], "funcion": "...", "accion_ascendente": "...", "punto_medio": "...", "crisis": "...", "segundo_punto_giro": "..." },
    "acto3": { "capitulos": [Y+1, ${input.chapterCount}], "funcion": "...", "climax": "...", "resolucion": "...", "eco_tematico": "..." }
  },
  "matriz_arcos": {
    "arco_principal": {
      "descripcion": "...",
      "puntos_giro": [{ "capitulo": 1, "evento": "...", "consecuencia": "..." }]
    },
    "subtramas": [
      { "nombre": "...", "tipo": "romance/misterio/personal", "personajes_involucrados": ["..."], "capitulos_desarrollo": [1,5,10], "interseccion_trama_principal": "...", "resolucion": "..." }
    ]
  },
  "momentum_plan": {
    "curva_tension": { "acto1": "...", "acto2": "...", "acto3": "..." },
    "catalogo_giros": [{ "capitulo": 5, "tipo": "...", "descripcion": "...", "setup_previo": "...", "impacto_emocional": "..." }],
    "cadencia_sorpresas": "...",
    "hooks_capitulo": { "regla": "...", "tipos_permitidos": ["cliffhanger", "revelacion", "pregunta"] }
  },
  "linea_temporal": [{ "momento": "...", "eventos_clave": ["..."], "capitulos": [1,2,3] }]
}

⛔ Los números de capítulo deben distribuirse correctamente en ${input.chapterCount} capítulos totales.
`;

    console.log(`[Architect] FASE 1C: Generating narrative structure (${fase1cPrompt.length} chars)...`);
    const fase1cResponse = await this.generateContent(fase1cPrompt);
    console.log(`[Architect] FASE 1C: Response received`);
    
    let narrativeStructure: any = {};
    
    try {
      const jsonMatch = fase1cResponse.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        let cleanedJson = jsonMatch[0]
          .replace(/,\s*\/\/[^\n]*/g, ',')
          .replace(/:\s*([^,\n"{\[]+)\s*\/\/[^\n]*/g, ': $1')
          .replace(/\/\/[^\n]*/g, '')
          .replace(/,\s*}/g, '}')
          .replace(/,\s*]/g, ']');
        narrativeStructure = JSON.parse(cleanedJson);
        console.log(`[Architect] FASE 1C: Parsed estructura_tres_actos: ${!!narrativeStructure.estructura_tres_actos}`);
      }
    } catch (e) {
      console.error("[Architect] FASE 1C: Failed to parse JSON:", e);
    }
    
    if (!narrativeStructure.estructura_tres_actos) {
      console.error("[Architect] FASE 1C: Missing estructura_tres_actos - aborting");
      return { content: JSON.stringify({ error: "No se generó estructura narrativa" }), tokenUsage: totalTokenUsage };
    }
    
    if (fase1cResponse.tokenUsage) {
      totalTokenUsage.inputTokens += fase1cResponse.tokenUsage.inputTokens || 0;
      totalTokenUsage.outputTokens += fase1cResponse.tokenUsage.outputTokens || 0;
      totalTokenUsage.thinkingTokens += fase1cResponse.tokenUsage.thinkingTokens || 0;
    }

    // ═══════════════════════════════════════════════════════════════════
    // FASE 2: Escaleta de capítulos (en batches de 8)
    // ═══════════════════════════════════════════════════════════════════
    const personajesResumen = personajes.map((p: any) => 
      `- ${p.nombre} (${p.rol}): ${p.arco_transformacion || 'sin arco definido'}`
    ).join('\n');
    
    const arcoPrincipal = narrativeStructure.matriz_arcos?.arco_principal?.descripcion || 'Trama principal';
    const puntosGiro = narrativeStructure.matriz_arcos?.arco_principal?.puntos_giro?.map((p: any) => 
      `Cap ${p.capitulo}: ${p.evento}`
    ).join(', ') || 'Sin puntos de giro definidos';

    const totalChapters = input.chapterCount + (input.hasPrologue ? 1 : 0) + (input.hasEpilogue ? 1 : 0);
    
    // Use smaller batches to stay within 8K tokens
    const CHAPTERS_PER_BATCH = 8;
    const batches = Math.ceil(input.chapterCount / CHAPTERS_PER_BATCH);
    
    let allEscaleta: any[] = [];
    
    for (let batch = 0; batch < batches; batch++) {
      const startChapter = batch * CHAPTERS_PER_BATCH + 1;
      const endChapter = Math.min((batch + 1) * CHAPTERS_PER_BATCH, input.chapterCount);
      
      const includesPrologue = batch === 0 && input.hasPrologue;
      const includesEpilogue = batch === batches - 1 && input.hasEpilogue;
      
      const fase2Prompt = `
FASE 2 (Lote ${batch + 1}/${batches}): Genera ESCALETA para capítulos ${includesPrologue ? '0 (Prólogo), ' : ''}${startChapter}-${endChapter}${includesEpilogue ? ', -1 (Epílogo)' : ''}

CONTEXTO:
- Premisa: "${premisa}"
- Personajes: ${personajesResumen}
- Arco principal: ${arcoPrincipal}
- Puntos de giro: ${puntosGiro}
- Acto 1: caps ${JSON.stringify(narrativeStructure.estructura_tres_actos?.acto1?.capitulos)}
- Acto 2: caps ${JSON.stringify(narrativeStructure.estructura_tres_actos?.acto2?.capitulos)}
- Acto 3: caps ${JSON.stringify(narrativeStructure.estructura_tres_actos?.acto3?.capitulos)}

Responde con JSON:
{
  "escaleta_capitulos": [
    {
      "numero": 1,
      "titulo": "Título evocador (2-5 palabras)",
      "acto": "1",
      "cronologia": "momento temporal",
      "ubicacion": "lugar",
      "elenco_presente": ["personaje1"],
      "funcion_estructural": "función en la trama",
      "informacion_nueva": "qué descubre el lector",
      "conflicto_central": { "tipo": "interno/externo", "descripcion": "...", "stakes": "..." },
      "beats": [
        { "tipo": "apertura", "descripcion": "..." },
        { "tipo": "desarrollo", "descripcion": "..." },
        { "tipo": "tension", "descripcion": "..." },
        { "tipo": "reflexion", "descripcion": "..." },
        { "tipo": "escalada", "descripcion": "..." },
        { "tipo": "cierre_hook", "descripcion": "..." }
      ],
      "giro_emocional": { "emocion_inicio": "...", "emocion_final": "..." },
      "continuidad_entrada": "estado al iniciar",
      "continuidad_salida": "estado al terminar",
      "bestseller_elements": { "nivel_tension": 7, "tipo_hook_final": "cliffhanger", "hook_descripcion": "..." }
    }
  ]
}

⛔ TÍTULOS OBLIGATORIOS: "Cenizas y Promesas", "La Sombra del Pasado". NUNCA "Capítulo 1" ni vacío.
⛔ Número 0 = Prólogo, Número -1 = Epílogo.
`;
      
      console.log(`[Architect] FASE 2 (batch ${batch + 1}/${batches}): Generating chapters ${startChapter}-${endChapter} (${fase2Prompt.length} chars)...`);
      const fase2Response = await this.generateContent(fase2Prompt);
      console.log(`[Architect] FASE 2 (batch ${batch + 1}/${batches}): Response received`);
      
      try {
        const jsonMatch = fase2Response.content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          let cleanedJson = jsonMatch[0]
            .replace(/,\s*\/\/[^\n]*/g, ',')
            .replace(/:\s*([^,\n"{\[]+)\s*\/\/[^\n]*/g, ': $1')
            .replace(/\/\/[^\n]*/g, '')
            .replace(/,\s*}/g, '}')
            .replace(/,\s*]/g, ']');
          const batchData = JSON.parse(cleanedJson);
          if (batchData.escaleta_capitulos && Array.isArray(batchData.escaleta_capitulos)) {
            allEscaleta = allEscaleta.concat(batchData.escaleta_capitulos);
            console.log(`[Architect] FASE 2 (batch ${batch + 1}/${batches}): Added ${batchData.escaleta_capitulos.length} chapters (total: ${allEscaleta.length})`);
          }
        }
      } catch (e) {
        console.error(`[Architect] FASE 2 (batch ${batch + 1}/${batches}): Failed to parse JSON:`, e);
      }
      
      if (fase2Response.tokenUsage) {
        totalTokenUsage.inputTokens += fase2Response.tokenUsage.inputTokens || 0;
        totalTokenUsage.outputTokens += fase2Response.tokenUsage.outputTokens || 0;
        totalTokenUsage.thinkingTokens += fase2Response.tokenUsage.thinkingTokens || 0;
      }
    }

    // ═══════════════════════════════════════════════════════════════════
    // COMBINE: Merge all phases into final World Bible
    // ═══════════════════════════════════════════════════════════════════
    const finalWorldBible = {
      world_bible: {
        personajes: personajes,
        lugares: worldElements.lugares || [],
        reglas_lore: worldElements.reglas_lore || [],
        watchpoints_continuidad: worldElements.watchpoints_continuidad || [],
        temas_centrales: worldElements.temas_centrales || [],
        motivos_literarios: worldElements.motivos_literarios || [],
        vocabulario_prohibido: worldElements.vocabulario_prohibido || [],
        lexico_historico: worldElements.lexico_historico || {},
        paleta_sensorial_global: worldElements.paleta_sensorial_global || {},
      },
      matriz_arcos: narrativeStructure.matriz_arcos || {},
      momentum_plan: narrativeStructure.momentum_plan || {},
      estructura_tres_actos: narrativeStructure.estructura_tres_actos,
      premisa: premisa,
      linea_temporal: narrativeStructure.linea_temporal || [],
      escaleta_capitulos: allEscaleta,
    };
    
    console.log(`[Architect] COMBINED: ${personajes.length} personajes, ${worldElements.lugares?.length || 0} lugares, ${allEscaleta.length} capítulos`);
    console.log(`[Architect] Total tokens used: ${totalTokenUsage.inputTokens + totalTokenUsage.outputTokens}`);

    return {
      content: JSON.stringify(finalWorldBible),
      tokenUsage: totalTokenUsage,
    };
  }
}
