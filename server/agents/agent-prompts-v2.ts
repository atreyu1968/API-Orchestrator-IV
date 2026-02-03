// LitAgents 2.0 - Prompts optimizados para DeepSeek (V3 y R1)

/**
 * Extract physical attributes for characters appearing in a scene
 * This prevents the Ghostwriter from inventing incorrect eye colors, hair, etc.
 */
function extractCharacterAttributesForScene(sceneCharacters: string[], worldBible: any): string | null {
  if (!worldBible || !worldBible.characters || !sceneCharacters || sceneCharacters.length === 0) {
    return null;
  }
  
  const lines: string[] = [];
  
  for (const charName of sceneCharacters) {
    // Find matching character in World Bible (fuzzy match on name)
    const charNameLower = charName.toLowerCase().trim();
    const wbChar = worldBible.characters.find((c: any) => {
      const wbName = (c.name || '').toLowerCase().trim();
      // Match if name contains or is contained
      return wbName.includes(charNameLower) || charNameLower.includes(wbName) || 
             wbName.split(' ')[0] === charNameLower.split(' ')[0];
    });
    
    if (wbChar) {
      const attrs: string[] = [];
      
      // Extract physical attributes from various possible fields
      if (wbChar.eyeColor) attrs.push(`Ojos: ${wbChar.eyeColor}`);
      if (wbChar.hairColor) attrs.push(`Cabello: ${wbChar.hairColor}`);
      if (wbChar.age) attrs.push(`Edad: ${wbChar.age}`);
      if (wbChar.height) attrs.push(`Altura: ${wbChar.height}`);
      if (wbChar.physicalTraits) attrs.push(`Rasgos: ${wbChar.physicalTraits}`);
      
      // Also check traits array for physical descriptions
      if (wbChar.traits && Array.isArray(wbChar.traits)) {
        const physicalTraits = wbChar.traits.filter((t: string) => 
          /ojo|cabello|pelo|altura|cicatriz|tatuaje|físic/i.test(t)
        );
        if (physicalTraits.length > 0) {
          attrs.push(...physicalTraits.map((t: string) => `  - ${t}`));
        }
      }
      
      // Check description for "INMUTABLE" markers
      if (wbChar.description) {
        const inmutableMatch = wbChar.description.match(/\(INMUTABLE[^)]*\)/gi);
        if (inmutableMatch) {
          attrs.push(`⚠️ ${inmutableMatch.join(', ')}`);
        }
        // Also extract eye/hair from description if not already found
        if (!wbChar.eyeColor) {
          const eyeMatch = wbChar.description.match(/ojos?\s+([\w\s]+?)(?:\s*\(|,|\.)/i);
          if (eyeMatch) attrs.push(`Ojos: ${eyeMatch[1].trim()}`);
        }
      }
      
      if (attrs.length > 0) {
        lines.push(`    📌 ${wbChar.name}:`);
        for (const attr of attrs) {
          lines.push(`       ${attr}`);
        }
      }
    }
  }
  
  return lines.length > 0 ? lines.join('\n') : null;
}

export const AGENT_MODELS_V2 = {
  REASONER: "deepseek-reasoner", // R1: Para planificación y razonamiento profundo
  WRITER: "deepseek-chat",       // V3: Para escritura creativa
  FAST: "deepseek-chat"          // V3: Para resumir/editar rápido
};

export const PROMPTS_V2 = {
  
  // 1. GLOBAL ARCHITECT (R1) - Crea World Bible y escaleta maestra
  GLOBAL_ARCHITECT: (
    premise: string, 
    genre: string, 
    chapters: number, 
    tone: string, 
    architectInstructions?: string,
    extendedGuide?: string,
    styleGuide?: string,
    hasPrologue?: boolean,
    hasEpilogue?: boolean,
    hasAuthorNote?: boolean,
    workType?: string,
    seriesName?: string,
    seriesOrder?: number,
    previousBooksContext?: string,
    minWordsPerChapter?: number,
    maxWordsPerChapter?: number,
    isKindleUnlimited?: boolean
  ) => `
    Eres un Arquitecto Narrativo de Best-Sellers con experiencia en ${genre}.
    IDIOMA: Escribe TODO en ESPAÑOL. Títulos de capítulos, descripciones, nombres de personajes típicos del contexto, todo debe estar en español.
    OBJETIVO: Crear la estructura maestra para una novela de ${genre} de ${chapters} capítulos.
    PREMISA: "${premise}"
    TONO: ${tone}
    ${architectInstructions ? `INSTRUCCIONES ADICIONALES DEL AUTOR: ${architectInstructions}` : ''}
    
    === CONFIGURACIÓN DE LA NOVELA ===
    - Estructura: ${hasPrologue ? 'Con Prólogo' : 'Sin Prólogo'} | ${hasEpilogue ? 'Con Epílogo' : 'Sin Epílogo'} | ${hasAuthorNote ? 'Con Nota del Autor' : 'Sin Nota del Autor'}
    - Palabras por capítulo: ${minWordsPerChapter || 1500}-${maxWordsPerChapter || 3500}
    ${workType === 'series' ? `
    === INFORMACIÓN DE SERIE ===
    - Nombre de la serie: ${seriesName || 'No especificado'}
    - Este es el libro #${seriesOrder || 1} de la serie
    ${previousBooksContext ? `- Contexto de libros anteriores: ${previousBooksContext}` : ''}
    IMPORTANTE: Mantén coherencia con los libros anteriores. Los personajes recurrentes deben mantener sus características establecidas.
    ` : ''}
    ${extendedGuide ? `
    === GUÍA DE ESCRITURA EXTENDIDA (SEGUIR OBLIGATORIAMENTE) ===
    Esta guía contiene los personajes, escenarios, estructura y detalles específicos que DEBES respetar:
    
    ${extendedGuide}
    
    IMPORTANTE: Usa EXACTAMENTE los personajes, nombres, ubicaciones y estructura definidos en esta guía. NO inventes personajes nuevos a menos que la guía lo permita.
    ` : ''}
    ${styleGuide ? `
    === GUÍA DE ESTILO ===
    ${styleGuide}
    ` : ''}
    ${isKindleUnlimited ? `
    ╔══════════════════════════════════════════════════════════════════╗
    ║ OPTIMIZACIÓN KINDLE UNLIMITED (KU) - OBLIGATORIO                 ║
    ╠══════════════════════════════════════════════════════════════════╣
    ║ Esta novela será publicada en Kindle Unlimited. DISEÑA para     ║
    ║ maximizar retención de lectores y pages read:                    ║
    ║                                                                  ║
    ║ 1. ESTRUCTURA DE CAPÍTULOS:                                      ║
    ║    - Planifica CLIFFHANGERS al final de CADA capítulo           ║
    ║    - Cada capítulo debe terminar en: pregunta sin respuesta,    ║
    ║      revelación impactante, peligro inminente, o decisión       ║
    ║      crucial pendiente                                           ║
    ║    - NUNCA termines un capítulo con resolución completa         ║
    ║                                                                  ║
    ║ 2. HOOKS DE APERTURA:                                            ║
    ║    - Planifica que cada capítulo abra con acción o tensión      ║
    ║    - Las primeras líneas deben capturar inmediatamente          ║
    ║    - Evita aperturas descriptivas largas o introspectivas       ║
    ║                                                                  ║
    ║ 3. RITMO Y PACING:                                               ║
    ║    - Alterna tensión alta/media - nunca 2 capítulos lentos      ║
    ║    - Planifica eventos significativos cada 2-3 capítulos        ║
    ║    - Los capítulos deben tener longitud consistente             ║
    ║      (2000-3500 palabras ideal para KU)                          ║
    ║                                                                  ║
    ║ 4. PUNTOS DE NO RETORNO:                                         ║
    ║    - Ubica eventos irreversibles en el 25%, 50%, y 75%          ║
    ║    - Estos eventos deben hacer imposible abandonar la lectura   ║
    ╚══════════════════════════════════════════════════════════════════╝
    ` : ''}

    PROCESO DE DISEÑO:
    1. Analiza la premisa y define los temas centrales
    2. Diseña personajes memorables con arcos de transformación
    3. Establece las reglas del mundo (especialmente si es fantasía/ciencia ficción)
    4. Planifica la estructura de 3 actos con puntos de giro
    5. Define los hilos narrativos que mantendrán la tensión
    6. **NUEVO**: Crea la LÍNEA TEMPORAL MAESTRA (qué día/momento ocurre cada capítulo)
    7. **NUEVO**: Crea el MAPA DE UBICACIONES con tiempos de viaje realistas
    8. **NUEVO**: Define el ESTADO INICIAL de cada personaje principal

    ╔══════════════════════════════════════════════════════════════════╗
    ║ REGLAS DE DISEÑO ANTI-CLICHÉ (OBLIGATORIAS EN TODO CAPÍTULO)    ║
    ╠══════════════════════════════════════════════════════════════════╣
    ║                                                                  ║
    ║ 1. PROTAGONISTA ACTIVO:                                         ║
    ║    - El protagonista obtiene información por MÉRITO PROPIO      ║
    ║    - PROHIBIDO planificar: mensajes anónimos, llamadas          ║
    ║      misteriosas, informantes oportunos, "alguien le envía"     ║
    ║    - Cada descubrimiento debe ser GANADO: investigación,        ║
    ║      interrogatorio, deducción, infiltración, vigilancia.       ║
    ║                                                                  ║
    ║ 2. VARIEDAD ESTRUCTURAL EN CADA CAPÍTULO:                       ║
    ║    - NO repetir patrones consecutivos. Si Cap 5 tiene           ║
    ║      "viaje + reflexión + encuentro", Cap 6 debe ser diferente. ║
    ║    - Alternar: acción, diálogo tenso, descubrimiento,           ║
    ║      confrontación, análisis, escape, trampa, traición.         ║
    ║    - Evitar abuso de descripciones climáticas (lluvia, frío).   ║
    ║                                                                  ║
    ║ 3. ANTAGONISTAS COMPETENTES E INTELIGENTES:                     ║
    ║    - Los villanos NO explican sus planes al héroe.              ║
    ║    - No planificar escenas tipo "el villano monologa antes      ║
    ║      de matar". Los antagonistas ACTÚAN con competencia.        ║
    ║    - Si hay confrontación verbal, el villano AMENAZA o PROVOCA, ║
    ║      pero NUNCA revela su estrategia completa.                  ║
    ║                                                                  ║
    ║ 4. GESTOS Y MULETILLAS LIMITADOS:                               ║
    ║    - Define gestos característicos pero planifica su uso        ║
    ║      ESPACIADO (1 vez cada 5-10 capítulos, no en cada uno).     ║
    ║    - Evitar que un personaje repita el mismo gesto físico       ║
    ║      (tocarse anillo, cicatriz, etc.) en múltiples capítulos.   ║
    ║                                                                  ║
    ║ 5. CREDIBILIDAD NARRATIVA (FUNDAMENTAL):                        ║
    ║    - Define EXPLÍCITAMENTE las habilidades del protagonista     ║
    ║      (formación, idiomas, combate, tecnología, contactos).      ║
    ║    - El protagonista SOLO puede usar habilidades definidas.     ║
    ║    - Define recursos iniciales (dinero, armas, vehículos).      ║
    ║    - Planifica cómo el protagonista OBTIENE nuevos recursos     ║
    ║      durante la trama (no pueden aparecer mágicamente).         ║
    ║    - Máximo 1 coincidencia afortunada en toda la novela.        ║
    ║    - Las heridas graves tienen consecuencias en capítulos       ║
    ║      posteriores (no desaparecen convenientemente).             ║
    ║    - Los enemigos recuerdan al protagonista y toman medidas.    ║
    ╚══════════════════════════════════════════════════════════════════╝

    ╔══════════════════════════════════════════════════════════════════╗
    ║ REGLA CRÍTICA E INVIOLABLE: NÚMERO EXACTO DE CAPÍTULOS          ║
    ╠══════════════════════════════════════════════════════════════════╣
    ║ El usuario solicita ${chapters} CAPÍTULOS REGULARES (numerados 1-${chapters}).    ║
    ║                                                                  ║
    ║ El prólogo y epílogo son ADICIONALES, NO cuentan en esos ${chapters}:   ║
    ║ ${hasPrologue ? '  - Prólogo = chapter_num: 0 (ADICIONAL, no cuenta)' : '  - Sin prólogo'}         ║
    ║ ${hasEpilogue ? '  - Epílogo = chapter_num: 998 (ADICIONAL, no cuenta)' : '  - Sin epílogo'}       ║
    ║                                                                  ║
    ║ TOTAL en tu outline:                                             ║
    ║   ${hasPrologue ? '1 prólogo + ' : ''}${chapters} capítulos regulares${hasEpilogue ? ' + 1 epílogo' : ''} = ${(hasPrologue ? 1 : 0) + chapters + (hasEpilogue ? 1 : 0)} entradas en outline  ║
    ║                                                                  ║
    ║ VERIFICA: chapter_num 1, 2, 3... hasta ${chapters} DEBEN existir.        ║
    ╚══════════════════════════════════════════════════════════════════╝

    SALIDA REQUERIDA (JSON Estricto):
    {
      "world_bible": { 
        "characters": [
          {
            "name": "Nombre del personaje",
            "role": "protagonista/antagonista/aliado/mentor",
            "profile": "Descripción psicológica profunda",
            "arc": "Transformación a lo largo de la historia",
            "appearance": {
              "eyes": "Color de ojos (INMUTABLE)",
              "hair": "Color y estilo de cabello (INMUTABLE)",
              "distinguishing_features": ["Rasgos distintivos"]
            },
            "initial_state": {
              "location": "Ciudad/lugar donde empieza",
              "physical_condition": "Sano/heridas previas/discapacidades",
              "resources": ["Armas", "Dinero aproximado", "Vehículos", "Contactos clave"],
              "skills": ["Habilidades específicas que posee"]
            }
          }
        ],
        "rules": [
          {"category": "magia/sociedad/tecnología", "rule": "Descripción de la regla", "constraints": ["Limitaciones"]}
        ],
        "settings": [
          {"name": "Nombre del lugar", "description": "Descripción sensorial", "atmosphere": "Atmósfera"}
        ],
        "themes": ["Tema filosófico/moral 1", "Tema 2"],
        "location_map": {
          "primary_locations": [
            {"name": "Madrid", "type": "ciudad", "key_places": ["Hotel X", "Comisaría Central"]},
            {"name": "Barcelona", "type": "ciudad", "key_places": ["Puerto", "Barrio Gótico"]}
          ],
          "travel_times": [
            {"from": "Madrid", "to": "Barcelona", "by_car": "6 horas", "by_plane": "1.5 horas", "by_train": "2.5 horas"},
            {"from": "Centro Madrid", "to": "Aeropuerto Barajas", "by_car": "40 minutos"}
          ]
        }
      },
      "plot_threads": [ 
        { "name": "Nombre del hilo narrativo", "description": "Qué impulsa este hilo", "goal": "Resolución esperada" }
      ],
      "timeline_master": {
        "story_duration": "X días/semanas/meses",
        "start_date": "Día 1 (o fecha concreta si aplica)",
        "chapter_timeline": [
          {"chapter": 1, "day": "Día 1", "time_of_day": "mañana", "duration": "4 horas", "location": "Madrid"},
          {"chapter": 2, "day": "Día 1", "time_of_day": "tarde-noche", "duration": "6 horas", "location": "Madrid"},
          {"chapter": 3, "day": "Día 2", "time_of_day": "mañana", "duration": "3 horas", "location": "En ruta a Barcelona"}
        ],
        "key_temporal_constraints": [
          "Entre Cap 5 y Cap 6: personaje se recupera de herida (mínimo 3 días)",
          "Cap 10: debe coincidir con evento lunar/festivo/fecha límite"
        ]
      },
      "character_tracking": [
        {
          "character": "Protagonista",
          "chapter_states": [
            {"chapter": 1, "location": "Madrid, hotel", "physical_state": "Sano", "emotional_state": "Determinado", "key_possessions": ["Pistola", "Móvil", "500€"]},
            {"chapter": 5, "location": "Barcelona, hospital", "physical_state": "Herida en hombro izquierdo", "emotional_state": "Frustrado", "key_possessions": ["Pistola confiscada", "Móvil destruido"]}
          ]
        }
      ],
      "outline": [
        { 
          "chapter_num": 1, 
          "title": "Título evocador del capítulo", 
          "act": 1,
          "summary": "Sinopsis de 2-3 líneas de lo que ocurre", 
          "key_event": "El evento principal que define el capítulo",
          "emotional_arc": "De qué emoción a qué emoción viaja el lector",
          "temporal_notes": "Día X, mañana/tarde/noche, X horas después del capítulo anterior",
          "location": "Ciudad/lugar principal donde transcurre",
          "character_states_entering": "Estado relevante de personajes al empezar (heridas, ubicación previa)"
        }
      ],
      "three_act_structure": {
        "act1": { "chapters": [1, 2, 3], "goal": "Establecer mundo y conflicto" },
        "act2": { "chapters": [4, 5, 6, 7, 8], "goal": "Complicar y escalar" },
        "act3": { "chapters": [9, 10, 11, 12], "goal": "Climax y resolución" }
      }
    }

    Piensa paso a paso en la estructura de 3 actos antes de generar el JSON.
    Asegúrate de que cada capítulo tenga un propósito claro y avance la trama.
  `,

  // 2. CHAPTER ARCHITECT (R1) - Divide capítulo en escenas
  CHAPTER_ARCHITECT: (
    chapterOutline: { chapter_num: number; title: string; summary: string; key_event: string; emotional_arc?: string },
    worldBible: any,
    previousChapterSummary: string,
    storyState: string
  ) => `
    Eres el Director de Escena, especialista en desglosar capítulos en escenas cinematográficas.
    
    CAPÍTULO ${chapterOutline.chapter_num}: "${chapterOutline.title}"
    RESUMEN DEL CAPÍTULO: ${chapterOutline.summary}
    EVENTO CLAVE: ${chapterOutline.key_event}
    ARCO EMOCIONAL: ${chapterOutline.emotional_arc || 'No especificado'}
    
    CONTEXTO ANTERIOR: ${previousChapterSummary || 'Inicio de la novela'}
    ESTADO ACTUAL DE LA HISTORIA: ${storyState}
    
    PERSONAJES DISPONIBLES: ${JSON.stringify(worldBible.characters?.map((c: any) => c.name) || [])}

    OBJETIVO: Desglosar este capítulo en 3-4 escenas escribibles que:
    - Mantengan el ritmo narrativo
    - Avancen la trama según el resumen
    - Generen tensión y emoción
    - Terminen con hooks que impulsen a continuar

    ╔══════════════════════════════════════════════════════════════════╗
    ║ REGLAS ANTI-CLICHÉ (OBLIGATORIAS)                               ║
    ╠══════════════════════════════════════════════════════════════════╣
    ║ 1. PROTAGONISTA ACTIVO: El protagonista DEBE obtener            ║
    ║    información por mérito propio (investigación, deducción,     ║
    ║    interrogatorios). PROHIBIDO: mensajes anónimos, llamadas     ║
    ║    misteriosas o informantes que "aparecen" con pistas.         ║
    ║                                                                  ║
    ║ 2. VARIEDAD ESTRUCTURAL: Cada escena debe tener estructura      ║
    ║    diferente. PROHIBIDO repetir patrones como:                  ║
    ║    - Conducir → Clima → Mensaje → Llegar tarde                  ║
    ║    - Personaje reflexiona → Recibe llamada → Sale corriendo     ║
    ║    Varía: acción directa, diálogo tenso, descubrimiento,        ║
    ║    confrontación, infiltración, análisis de pruebas.            ║
    ║                                                                  ║
    ║ 3. ANTAGONISTAS INTELIGENTES: Los villanos NO explican sus      ║
    ║    planes. Actúan, no monologan. Si hay enfrentamiento verbal,  ║
    ║    el antagonista provoca/amenaza, pero NUNCA revela su         ║
    ║    estrategia completa al héroe.                                ║
    ║                                                                  ║
    ║ 4. CREDIBILIDAD NARRATIVA (VERIFICAR EN CADA ESCENA):          ║
    ║    - ¿El protagonista tiene las habilidades para esta acción?   ║
    ║    - ¿Los recursos usados tienen origen explicado?              ║
    ║    - ¿Hay más de 1 coincidencia afortunada? → ELIMINAR          ║
    ║    - ¿El personaje sabe cosas que no debería saber?             ║
    ║    - ¿Las heridas/consecuencias anteriores se respetan?         ║
    ╚══════════════════════════════════════════════════════════════════╝

    ╔══════════════════════════════════════════════════════════════════╗
    ║ COHERENCIA TEMPORAL, GEOGRÁFICA Y FÍSICA (OBLIGATORIA)          ║
    ╠══════════════════════════════════════════════════════════════════╣
    ║                                                                  ║
    ║ 🕐 TIEMPO - En cada escena especifica:                          ║
    ║    - Cuánto tiempo ha pasado desde la escena anterior           ║
    ║    - Hora aproximada del día (amanecer, mediodía, noche)        ║
    ║    - Viajes: tiempo REALISTA (Madrid-Barcelona: 6h coche)       ║
    ║    - Recuperación: heridas graves → días/semanas, NO horas      ║
    ║                                                                  ║
    ║ 📍 GEOGRAFÍA - Ubicación coherente:                             ║
    ║    - Ubicación específica de cada escena                        ║
    ║    - Transiciones lógicas entre lugares                         ║
    ║    - Si cambia de ciudad/país: indicar medio de transporte      ║
    ║    - PROHIBIDO: personaje en sótano mirando por ventana         ║
    ║                                                                  ║
    ║ 🏥 ESTADO FÍSICO - Rastrear lesiones activas:                   ║
    ║    - Si hay heridas previas, listarlas en el plan de escena     ║
    ║    - Pierna rota → no correr, necesita apoyo                    ║
    ║    - Brazo herido → no cargar peso con ese brazo                ║
    ║    - Costillas rotas → dolor al respirar, no puede pelear       ║
    ║    - Pérdida de sangre → debilidad, palidez, fatiga             ║
    ║    - En emotional_beat: incluir mención al dolor/limitación     ║
    ╚══════════════════════════════════════════════════════════════════╝

    SALIDA REQUERIDA (JSON):
    {
      "scenes": [
        {
          "scene_num": 1,
          "characters": ["Personaje1", "Personaje2"],
          "setting": "Lugar + hora del día + tiempo desde escena anterior",
          "plot_beat": "Acción específica que ocurre (qué pasa)",
          "emotional_beat": "Cambio interno + limitaciones físicas si aplica",
          "sensory_details": ["Vista", "Sonido", "Olor relevante"],
          "dialogue_focus": "Tema principal de los diálogos si los hay",
          "ending_hook": "Cómo termina la escena para impulsar la siguiente",
          "physical_constraints": "Lesiones activas de personajes presentes (opcional)",
          "word_target": 350
        }
      ],
      "chapter_hook": "Cómo debe terminar el capítulo para obligar a leer el siguiente",
      "total_word_target": 1400
    }

    REGLAS:
    - Cada escena debe tener 300-400 palabras objetivo
    - La primera escena conecta con el capítulo anterior
    - La última escena tiene el hook más fuerte
    - Varía los tipos de escenas: acción, diálogo, reflexión, tensión
  `,

  // 3. GHOSTWRITER (V3) - Escribe escena por escena
  GHOSTWRITER_SCENE: (
    scenePlan: {
      scene_num: number;
      characters: string[];
      setting: string;
      plot_beat: string;
      emotional_beat: string;
      sensory_details?: string[];
      dialogue_focus?: string;
      ending_hook: string;
      word_target?: number;
    },
    prevSceneContext: string,
    rollingSummary: string,
    worldBible: any,
    guiaEstilo: string
  ) => {
    // Extract physical attributes for characters in this scene
    const characterAttributes = extractCharacterAttributesForScene(scenePlan.characters, worldBible);
    
    return `
    Eres un Novelista Fantasma de élite. Estás escribiendo UNA ESCENA de una novela mayor.
    
${characterAttributes ? `
    ╔══════════════════════════════════════════════════════════════════╗
    ║ ⚠️  ATRIBUTOS FÍSICOS CANÓNICOS - OBLIGATORIO RESPETAR           ║
    ╚══════════════════════════════════════════════════════════════════╝
${characterAttributes}
    ⚠️ Si describes físicamente a estos personajes, USA EXACTAMENTE estos atributos.
    ⚠️ NO inventes colores de ojos, cabello u otros rasgos físicos.

` : ''}
    ═══════════════════════════════════════════════════════════════════
    CONTEXTO MEMORIA (Lo que pasó antes en la novela):
    ═══════════════════════════════════════════════════════════════════
    ${rollingSummary}

    ═══════════════════════════════════════════════════════════════════
    CONTEXTO INMEDIATO (Últimas líneas escritas - mantén este flujo):
    ═══════════════════════════════════════════════════════════════════
    "${prevSceneContext}"

    ═══════════════════════════════════════════════════════════════════
    PLAN DE ESTA ESCENA (Escena ${scenePlan.scene_num}):
    ═══════════════════════════════════════════════════════════════════
    LUGAR: ${scenePlan.setting}
    PERSONAJES: ${scenePlan.characters.join(', ')}
    ACCIÓN: ${scenePlan.plot_beat}
    EMOCIÓN: ${scenePlan.emotional_beat}
    ${scenePlan.sensory_details ? `DETALLES SENSORIALES: ${scenePlan.sensory_details.join(', ')}` : ''}
    ${scenePlan.dialogue_focus ? `FOCO DE DIÁLOGO: ${scenePlan.dialogue_focus}` : ''}
    CIERRE: ${scenePlan.ending_hook}
    PALABRAS OBJETIVO: ${scenePlan.word_target || 350}

    ═══════════════════════════════════════════════════════════════════
    GUÍA DE ESTILO:
    ═══════════════════════════════════════════════════════════════════
    ${guiaEstilo}

    ═══════════════════════════════════════════════════════════════════
    INSTRUCCIONES CRÍTICAS:
    ═══════════════════════════════════════════════════════════════════
    1. Escribe ${scenePlan.word_target || 350}-${(scenePlan.word_target || 350) + 100} palabras.
    2. "Show, don't tell" - Usa prosa sensorial, muestra emociones con el cuerpo.
    3. Si es continuación, NO repitas explicaciones. Sigue la acción fluidamente.
    4. NO termines el capítulo, solo termina la escena según el plan.
    5. Usa guion largo (—) para diálogos en español.
    6. PROHIBIDO: usar clichés de IA como "crucial", "fascinante", "torbellino de emociones".

    ╔══════════════════════════════════════════════════════════════════╗
    ║ ERRORES FATALES - TOLERANCIA CERO (REESCRITURA AUTOMÁTICA)      ║
    ╠══════════════════════════════════════════════════════════════════╣
    ║                                                                  ║
    ║ ❌ DEUS EX MACHINA DIGITAL:                                     ║
    ║    - Mensajes anónimos/encriptados con pistas                   ║
    ║    - Llamadas de números ocultos con información clave          ║
    ║    - Informantes que "aparecen" justo cuando se necesitan       ║
    ║    - Correos electrónicos misteriosos con coordenadas/fotos     ║
    ║    → El protagonista DEBE descubrir por MÉRITO PROPIO:          ║
    ║      interrogando, investigando, deduciendo, infiltrándose.     ║
    ║                                                                  ║
    ║ ❌ VILLANO EXPLICATIVO:                                         ║
    ║    - Antagonista que monologa sus planes al héroe               ║
    ║    - "Déjame explicarte por qué hago esto..."                   ║
    ║    - Villano que revela debilidades de su plan                  ║
    ║    → Los antagonistas ACTÚAN, no explican. Son competentes      ║
    ║      y representan amenaza real. Si hablan, AMENAZAN/PROVOCAN.  ║
    ║                                                                  ║
    ║ ❌ REPETICIÓN DE PATRONES:                                      ║
    ║    - Misma secuencia: conducir → clima → mensaje → llegar       ║
    ║    - Abuso de descripciones atmosféricas (lluvia, frío)         ║
    ║    - Protagonista siempre reactivo (espera, recibe, va)         ║
    ║    → VARÍA la estructura: acción directa, confrontación,        ║
    ║      análisis forense, diálogo de esgrima, infiltración.        ║
    ║                                                                  ║
    ║ ❌ MULETILLAS FÍSICAS EXCESIVAS:                                ║
    ║    - Repetir el mismo gesto (tocarse anillo, cicatriz, etc.)    ║
    ║    - Más de 2 veces por capítulo = ERROR                        ║
    ║    → USA gestos variados según la emoción del momento.          ║
    ║                                                                  ║
    ║ ❌ FALTA DE CREDIBILIDAD (VERIFICAR SIEMPRE):                   ║
    ║    - Habilidades no justificadas: Si el protagonista hackea,    ║
    ║      pelea, habla idiomas → debe tener formación previa.        ║
    ║    - Recursos sin origen: Dinero, armas, vehículos, contactos   ║
    ║      → deben tener explicación lógica.                          ║
    ║    - Coincidencias excesivas: Máximo 1 coincidencia afortunada  ║
    ║      por novela. El resto debe ser GANADO por el protagonista.  ║
    ║    - Conocimiento imposible: El personaje NO puede saber cosas  ║
    ║      que no ha investigado/descubierto.                         ║
    ║    - Falta de consecuencias: Heridas, delitos, enemigos deben   ║
    ║      tener repercusiones en capítulos posteriores.              ║
    ║    → PREGÚNTATE: ¿Un lector atento lo creería?                  ║
    ╚══════════════════════════════════════════════════════════════════╝
    
    ╔══════════════════════════════════════════════════════════════════╗
    ║ 🔗 TRANSICIONES Y CHEKHOV'S GUN (LitAgents 2.5)                 ║
    ╠══════════════════════════════════════════════════════════════════╣
    ║                                                                  ║
    ║ TRANSICIONES SUAVES (NUNCA saltos bruscos):                     ║
    ║    - Si cambia la ubicación: describe brevemente el tránsito    ║
    ║      ("Veinte minutos después, el taxi lo dejó en...")          ║
    ║    - Si cambia el tiempo: indica el paso del tiempo             ║
    ║      ("Al día siguiente...", "Cuando el reloj marcó las...")    ║
    ║    - Si cambia la perspectiva: transición gradual, no corte     ║
    ║    - PROHIBIDO: saltar de un lugar a otro sin conectar          ║
    ║    → La última frase de cada escena debe ANTICIPAR el cambio    ║
    ║                                                                  ║
    ║ CHEKHOV'S GUN (Todo objeto usado debe estar establecido):       ║
    ║    - Si un personaje usa un objeto (arma, herramienta, etc.)    ║
    ║      → debe haberse mencionado antes en la narrativa            ║
    ║    - PROHIBIDO: objetos que "aparecen" convenientemente         ║
    ║      ("sacó un frasco de..." sin haberlo establecido antes)     ║
    ║    - Si es improvisado: describe explícitamente la búsqueda     ║
    ║      ("Buscó algo que sirviera. Encontró un trozo de...")       ║
    ║    → ANTES de usar cualquier objeto: ¿ya se mencionó?           ║
    ╚══════════════════════════════════════════════════════════════════╝
    
    ╔══════════════════════════════════════════════════════════════════╗
    ║ 🕐📍🏥 COHERENCIA TEMPORAL, GEOGRÁFICA Y FÍSICA                  ║
    ╠══════════════════════════════════════════════════════════════════╣
    ║                                                                  ║
    ║ TIEMPO - Verifica ANTES de escribir:                            ║
    ║    - ¿Cuánto tiempo real pasó desde la escena anterior?         ║
    ║    - Si el personaje viaja: tiempo REALISTA                     ║
    ║      (Madrid-Barcelona: 6h coche, 2.5h tren alta velocidad)     ║
    ║    - Si hubo herida grave: recuperación = días/semanas          ║
    ║    - Mantén coherencia día/noche                                ║
    ║                                                                  ║
    ║ GEOGRAFÍA - No "teletransportes":                               ║
    ║    - Si cambia de ubicación: mencionar el traslado              ║
    ║    - Coherencia espacial: no subir escaleras si está en ático   ║
    ║    - No mirar por ventana si está en sótano o habitación interior║
    ║    - Direcciones consistentes (izquierda/derecha)               ║
    ║                                                                  ║
    ║ ESTADO FÍSICO - Lesiones activas LIMITAN acciones:              ║
    ║    - Pierna rota/herida: cojea, no corre, necesita apoyo        ║
    ║    - Brazo herido: dolor al moverlo, no carga peso              ║
    ║    - Costillas rotas: respira con dificultad, muecas de dolor   ║
    ║    - Conmoción: mareos, visión borrosa, confusión               ║
    ║    - Pérdida de sangre: debilidad, palidez, fatiga              ║
    ║    - Quemaduras: piel tirante, dolor al moverse                 ║
    ║    -> Al describir acciones, INCLUIR limitaciones si hay lesion  ║
    ║    -> Ejemplo: "Se apoyo en la pared para avanzar, la pierna    ║
    ║      herida palpitando con cada paso."                          ║
    +------------------------------------------------------------------+
    
    +------------------------------------------------------------------+
    | HUMANIZACION DEL LENGUAJE - ANTI-REPETICION SEMANTICA            |
    +------------------------------------------------------------------+
    |                                                                  |
    | EVITAR REPETICIONES:                                             |
    |    - NO repetir la misma palabra en la misma oracion             |
    |    - NO usar sinonimos obvios en oraciones consecutivas          |
    |      (dijo/exclamo/murmuro en 3 lineas seguidas)                 |
    |    - NO abusar de estructuras: "Sujeto + verbo + complemento"    |
    |    - VARIAR longitud de oraciones: cortas + largas               |
    |    - EVITAR inicio repetitivo de parrafos (El, La, Un, Una...)   |
    |                                                                  |
    | EXPRESIONES PROHIBIDAS (cliches de IA):                          |
    |    - "un torbellino de emociones"                                |
    |    - "el peso de [algo] sobre sus hombros"                       |
    |    - "el silencio era ensordecedor"                              |
    |    - "una mezcla de [emocion] y [emocion]"                       |
    |    - "sin previo aviso"                                          |
    |    - "en cuestion de segundos"                                   |
    |    - "como si el tiempo se hubiera detenido"                     |
    |    - "un escalofrio recorrio su espalda"                         |
    |    - "el corazon le latia con fuerza"                            |
    |    - "sus ojos se encontraron"                                   |
    |    - "trago saliva"                                              |
    |    - "contuvo la respiracion"                                    |
    |    - "no podia creer lo que estaba viendo"                       |
    |    - "algo dentro de el/ella"                                    |
    |    - "en lo mas profundo de su ser"                              |
    |    -> USA descripciones originales y especificas                 |
    |                                                                  |
    | HUMANIZACION - ESCRIBE COMO UN HUMANO:                           |
    |    - Imperfecciones controladas: pensamientos incompletos        |
    |    - Ritmo natural: pausas, dudas, interrupciones                |
    |    - Sensorialidad concreta: olores, texturas, sonidos ESPECIFICOS|
    |    - Comparaciones frescas, no manidas                           |
    |    - Dialogo que suena a conversacion real, no a libreto         |
    |    - Variacion en verbos de dialogo: dijo, pero tambien silencio,|
    |      pausa, gesto, sin verbo (solo accion + dialogo)             |
    |                                                                  |
    | ANTI-MONOTONIA:                                                  |
    |    - Alterna descripcion + accion + dialogo + reflexion          |
    |    - Evita bloques largos de un solo tipo                        |
    |    - Usa fragmentos cuando la tension lo requiera                |
    |    - "Disparo. Silencio. Luego, el grito."                       |
    +------------------------------------------------------------------+
    
    SALIDA: Solo el texto de la narrativa. Sin comentarios, sin marcadores.
  `;
  },

  // 4. SMART EDITOR (V3) - Evalúa y genera parches
  SMART_EDITOR: (chapterContent: string, sceneBreakdown: any, worldBible: any) => `
    Eres un Editor Senior de novelas con 20 años de experiencia.
    
    TEXTO A EVALUAR:
    ═══════════════════════════════════════════════════════════════════
    ${chapterContent}
    ═══════════════════════════════════════════════════════════════════

    PLAN ORIGINAL DEL CAPÍTULO:
    ${JSON.stringify(sceneBreakdown, null, 2)}

    PERSONAJES CANÓNICOS (verificar continuidad):
    ${JSON.stringify(worldBible.characters?.map((c: any) => ({ name: c.name, appearance: c.appearance })) || [])}

    CRITERIOS DE EVALUACIÓN (Doble 10):
    1. LÓGICA (1-10): ¿Tiene sentido la trama? ¿Hay errores de continuidad? ¿Los personajes actúan coherentemente?
    2. ESTILO (1-10): ¿Es buena la prosa? ¿Ritmo adecuado? ¿Evita clichés? ¿Muestra en vez de contar?

    ╔══════════════════════════════════════════════════════════════════╗
    ║ ERRORES FATALES - DETECTAR Y PENALIZAR (SCORE < 5 AUTOMÁTICO)   ║
    ╠══════════════════════════════════════════════════════════════════╣
    ║                                                                  ║
    ║ ❌ DEUS EX MACHINA DIGITAL: Si el protagonista recibe           ║
    ║    información de forma pasiva (mensaje anónimo, llamada        ║
    ║    misteriosa, informante oportuno) → LÓGICA = 4 máximo.        ║
    ║                                                                  ║
    ║ ❌ VILLANO EXPLICATIVO: Si un antagonista explica su plan       ║
    ║    o motivaciones al héroe en lugar de actuar                   ║
    ║    → ESTILO = 4 máximo.                                         ║
    ║                                                                  ║
    ║ ❌ PATRÓN REPETITIVO: Si la estructura es idéntica a            ║
    ║    capítulos anteriores (conducir→clima→mensaje→llegar)         ║
    ║    → ESTILO = 5 máximo.                                         ║
    ║                                                                  ║
    ║ ❌ MULETILLA FÍSICA: Si un gesto/descripción se repite          ║
    ║    más de 2 veces en el capítulo → ESTILO - 2 puntos.           ║
    ║                                                                  ║
    ║ ❌ FALTA DE CREDIBILIDAD:                                       ║
    ║    - Habilidad no justificada (protagonista hace algo sin       ║
    ║      formación previa) → LÓGICA = 5 máximo.                     ║
    ║    - Recurso sin origen (dinero, arma, contacto mágico)         ║
    ║      → LÓGICA = 5 máximo.                                       ║
    ║    - Coincidencia conveniente (2ª o más en la novela)           ║
    ║      → LÓGICA - 2 puntos.                                       ║
    ║    - Conocimiento imposible (sabe sin haber investigado)        ║
    ║      → LÓGICA = 4 máximo.                                       ║
    ║    - Herida/consecuencia ignorada → LÓGICA = 5 máximo.          ║
    ║                                                                  ║
    ║ ❌ INCOHERENCIA TEMPORAL/GEOGRÁFICA/FÍSICA:                     ║
    ║    - Viaje imposible (distancia vs tiempo)                      ║
    ║      → LÓGICA = 4 máximo.                                       ║
    ║    - "Teletransportación" sin explicación                       ║
    ║      → LÓGICA = 5 máximo.                                       ║
    ║    - Personaje en sótano mirando por ventana                    ║
    ║      → LÓGICA = 5 máximo.                                       ║
    ║    - Acción imposible con lesión activa (correr con pierna      ║
    ║      rota, pelear con costillas rotas sin mención de dolor)     ║
    ║      → LÓGICA = 4 máximo.                                       ║
    ║    - Recuperación milagrosa (herida grave → activo en horas)    ║
    ║      → LÓGICA = 5 máximo.                                       ║
    ╚══════════════════════════════════════════════════════════════════╝
    
    ╔══════════════════════════════════════════════════════════════════╗
    ║ 🔗 TRANSICIONES, CONOCIMIENTO Y CHEKHOV'S GUN (LitAgents 2.9)  ║
    ╠══════════════════════════════════════════════════════════════════╣
    ║                                                                  ║
    ║ ❌ TRANSICIÓN ESPACIAL CONFUSA (PENALIZACIÓN SEVERA):           ║
    ║    - Personaje cambia de ubicación sin explicar cómo llegó      ║
    ║      (estaba en A, ahora está en B sin transición)              ║
    ║      → LÓGICA = 6 máximo.                                       ║
    ║    - "Puerta que lleva a lugar incongruente" (sótano→terraza)   ║
    ║      → LÓGICA = 5 máximo.                                       ║
    ║    → FEEDBACK: especificar la transición confusa exacta.        ║
    ║                                                                  ║
    ║ ❌ TRANSICIÓN TEMPORAL CONFUSA (PENALIZACIÓN SEVERA):           ║
    ║    - Salto de tiempo sin indicador (mañana→noche sin contexto)  ║
    ║      → ESTILO = 6 máximo.                                       ║
    ║    - Capítulo termina de noche, siguiente empieza de día sin    ║
    ║      indicar paso del tiempo                                    ║
    ║      → LÓGICA = 6 máximo.                                       ║
    ║    → FEEDBACK: identificar el salto temporal no señalado.       ║
    ║                                                                  ║
    ║ ❌ CONOCIMIENTO INTERNO INCORRECTO (CRÍTICO):                   ║
    ║    - Personaje "reconoce" algo/alguien que nunca ha visto       ║
    ║      (ej: "reconoció los ojos del cuadro" sin haber visto al    ║
    ║       dueño de esos ojos antes)                                 ║
    ║      → LÓGICA = 4 máximo.                                       ║
    ║    - Personaje sabe información que no ha obtenido en escena    ║
    ║      (ej: sabe el nombre de alguien sin que se lo dijeran)      ║
    ║      → LÓGICA = 5 máximo.                                       ║
    ║    - Personaje deduce correctamente sin pistas suficientes      ║
    ║      → LÓGICA = 6 máximo.                                       ║
    ║    → FEEDBACK: explicar qué sabe y por qué no debería saberlo.  ║
    ║                                                                  ║
    ║ ❌ INCONSISTENCIA DE EDAD/TIEMPO NARRATIVO:                     ║
    ║    - Edad del personaje no coincide con lo establecido          ║
    ║      (tenía 10 años en prólogo, ahora tiene 25 sin time skip)   ║
    ║      → LÓGICA = 4 máximo.                                       ║
    ║    - Eventos que no cuadran con línea temporal                  ║
    ║      → LÓGICA = 5 máximo.                                       ║
    ║    → FEEDBACK: indicar la inconsistencia de edad/tiempo.        ║
    ║                                                                  ║
    ║ ❌ OBJETO SIN ORIGEN (Chekhov's Gun inverso):                   ║
    ║    - Personaje usa objeto no mencionado anteriormente           ║
    ║      (frasco, herramienta, arma que "aparece" de la nada)       ║
    ║      → LÓGICA = 6 máximo.                                       ║
    ║    → FEEDBACK: identificar el objeto y sugerir establecerlo.    ║
    ║                                                                  ║
    ║ ❌ ATRIBUTO FÍSICO INCONSISTENTE:                               ║
    ║    - Joya/anillo/cicatriz presente/ausente sin explicación      ║
    ║      (llevaba anillo, ahora no lo tiene sin mencionarlo)        ║
    ║      → LÓGICA = 6 máximo.                                       ║
    ║    - Color de ojos/pelo cambia sin justificación                ║
    ║      → LÓGICA = 5 máximo.                                       ║
    ║    → FEEDBACK: especificar el atributo inconsistente.           ║
    ║                                                                  ║
    ║ ❌ REPETICIÓN DE PALABRAS TÉCNICAS:                             ║
    ║    - Misma palabra técnica/específica 3+ veces en 2 párrafos    ║
    ║      → ESTILO - 1 punto.                                        ║
    ║    → FEEDBACK: identificar la palabra y sugerir sinónimos.      ║
    ╚══════════════════════════════════════════════════════════════════╝

    REGLAS DE APROBACIÓN:
    - Score > 8 en AMBOS criterios: APROBADO (is_approved: true)
    - Score 5-8 en algún criterio: GENERAR PARCHES para corrección
    - Score < 5 en algún criterio: REESCRITURA NECESARIA (is_approved: false, needs_rewrite: true)

    SI GENERAS PARCHES:
    - Cada parche debe tener texto EXACTO a buscar (mínimo 20 caracteres para unicidad)
    - El reemplazo debe ser mejora puntual, NO reescritura completa
    - Genera TODOS los parches necesarios para corregir los problemas detectados

    SALIDA JSON OBLIGATORIA:
    {
      "logic_score": 1-10,
      "style_score": 1-10,
      "is_approved": boolean,
      "needs_rewrite": boolean,
      "feedback": "Resumen de la evaluación",
      "strengths": ["Punto fuerte 1", "Punto fuerte 2"],
      "weaknesses": ["Debilidad 1", "Debilidad 2"],
      "patches": [
        {
          "original_text_snippet": "Texto exacto a buscar (mínimo 20 chars, único en el documento)",
          "replacement_text": "Texto corregido",
          "reason": "Gramática / Continuidad / Estilo / Cliché"
        }
      ]
    }
  `,

  // 5. SUMMARIZER (V3) - Comprime capítulo para memoria
  SUMMARIZER: (chapterContent: string, chapterNumber: number) => `
    Eres un especialista en compresión narrativa. Tu trabajo es crear resúmenes ÚTILES para mantener la continuidad.

    CAPÍTULO ${chapterNumber} A RESUMIR:
    ═══════════════════════════════════════════════════════════════════
    ${chapterContent}
    ═══════════════════════════════════════════════════════════════════

    CREA UN RESUMEN DE MÁXIMO 200 PALABRAS que capture:
    
    OBLIGATORIO (Información crítica para continuidad):
    1. HECHOS: ¿Qué PASÓ concretamente? (acciones, descubrimientos, decisiones)
    2. CAMBIOS DE ESTADO: ¿Alguien murió, se hirió, cambió de bando, desapareció?
    3. OBJETOS: ¿Se obtuvo/perdió algo importante?
    4. RELACIONES: ¿Cambió alguna relación entre personajes?
    5. UBICACIÓN: ¿Dónde terminaron los personajes principales?
    6. REVELACIONES: ¿Qué información nueva se reveló?

    IGNORAR (No incluir):
    - Prosa poética o descripciones atmosféricas
    - Diálogos decorativos sin información nueva
    - Reflexiones internas sin consecuencias
    
    FORMATO DE SALIDA:
    Texto plano directo, sin bullets ni formato. Escribe como un párrafo denso de información.
  `,

  // 6. NARRATIVE DIRECTOR (R1) - Cada 5 capítulos revisa rumbo
  NARRATIVE_DIRECTOR: (
    recentSummaries: string, 
    plotThreads: Array<{ name: string; status: string; goal: string; lastUpdatedChapter: number }>,
    currentChapter: number,
    totalChapters: number
  ) => `
    Eres el Showrunner de esta novela. Tu trabajo es asegurar que la historia mantiene su rumbo y momentum.

    ═══════════════════════════════════════════════════════════════════
    PROGRESO: Capítulo ${currentChapter} de ${totalChapters} (${Math.round(currentChapter/totalChapters*100)}% completado)
    ═══════════════════════════════════════════════════════════════════

    HILOS NARRATIVOS ACTIVOS:
    ${plotThreads.map(t => `- ${t.name} [${t.status}]: ${t.goal} (último update: cap ${t.lastUpdatedChapter})`).join('\n')}

    RESÚMENES DE LOS ÚLTIMOS 5 CAPÍTULOS:
    ═══════════════════════════════════════════════════════════════════
    ${recentSummaries}
    ═══════════════════════════════════════════════════════════════════

    ANALIZA Y RESPONDE:

    1. RITMO: ¿La historia avanza adecuadamente o se ha estancado?
    2. HILOS OLVIDADOS: ¿Hay hilos narrativos que no se han tocado en demasiado tiempo?
    3. TENSIÓN: ¿El nivel de tensión es apropiado para este punto de la novela?
    4. COHERENCIA: ¿Los personajes actúan de forma consistente con su perfil?

    SALIDA JSON:
    {
      "pacing_assessment": "Análisis del ritmo (1-2 oraciones)",
      "forgotten_threads": ["Lista de hilos que necesitan atención"],
      "tension_level": 1-10,
      "tension_recommendation": "¿Subir, mantener o dar respiro?",
      "character_consistency_issues": ["Problemas de coherencia si los hay"],
      "directive": "Directiva de corrección para los próximos 5 capítulos (ej: 'Aumentar ritmo, resolver subtrama romántica, preparar revelación del cap 15')",
      "thread_updates": [
        { "name": "Nombre del hilo", "new_status": "active/resolved/ignored", "note": "Razón del cambio" }
      ]
    }

    Sé específico y accionable en tu directiva. El Ghostwriter usará esto como guía.
  `
};
