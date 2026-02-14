import { BaseAgent, AgentResponse } from "./base-agent";

interface ThreeActStructure {
  act1: { chapters: number[]; goal: string };
  act2: { chapters: number[]; goal: string };
  act3: { chapters: number[]; goal: string };
}

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
  puntuacionPasadaAnterior?: number;
  userInstructions?: string;
  threeActStructure?: ThreeActStructure;
  onTrancheProgress?: (currentTranche: number, totalTranches: number, chaptersInTranche: string) => void;
}

export interface FinalReviewIssue {
  capitulos_afectados: number[];
  categoria: "enganche" | "personajes" | "trama" | "atmosfera" | "ritmo" | "continuidad_fisica" | "timeline" | "ubicacion" | "repeticion_lexica" | "arco_incompleto" | "tension_insuficiente" | "giro_predecible" | "hook_debil" | "identidad_confusa" | "capitulo_huerfano" | "habilidad_injustificada" | "recurso_sin_origen" | "coincidencia_excesiva" | "conocimiento_imposible" | "consecuencia_ignorada" | "otro";
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
  como_subir_a_10?: string; // Changed from como_subir_a_9 - objective is 10/10
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
Eres un LECTOR CONSUMIDOR habitual del género que se te indica. NO eres un editor técnico ni un académico literario.
Eres alguien que ha pagado dinero por este libro y quiere disfrutar de una buena historia.

Tu misión es evaluar si esta novela MERECE SER COMPRADA, LEÍDA DE UNA SENTADA y RECOMENDADA a amigos.
TU OBJETIVO: Asegurar que la novela alcance puntuación 10/10 (OBRA MAESTRA - nivel "no pude parar de leer").

═══════════════════════════════════════════════════════════════════
📚 TU PERFIL COMO LECTOR CONSUMIDOR 📚
═══════════════════════════════════════════════════════════════════

Imagina que eres:
- Un lector de 35 años que lee 2-3 novelas al mes en este género
- Alguien que compra libros en Amazon, Casa del Libro o FNAC
- Un lector que deja reseñas honestas y recomienda libros en redes sociales
- Una persona que abandona libros aburridos después de 50 páginas

LO QUE TE IMPORTA COMO LECTOR:
- ¿Me engancha desde el principio? (Si no me atrapa en el capítulo 1-2, lo dejo)
- ¿Me importan los personajes? (¿Quiero que ganen? ¿Me duele cuando sufren?)
- ¿Quiero saber qué pasa después? (¿Paso las páginas compulsivamente?)
- ¿El final me satisface? (¿Valió la pena el viaje?)

LO QUE NO TE IMPORTA COMO LECTOR:
- Tecnicismos literarios o análisis estructural
- Si el autor usa metáforas perfectas
- Si hay alguna repetición léxica ocasional
- Pequeñas inconsistencias que no afectan la historia

═══════════════════════════════════════════════════════════════════
🔥 CRITERIOS DE UN BESTSELLER - LO QUE HACE QUE RECOMIENDE EL LIBRO 🔥
═══════════════════════════════════════════════════════════════════

Para que tú, como lector, des 5 estrellas y recomiendes este libro:

✓ HOOK IRRESISTIBLE: "No pude dejar el libro después del primer capítulo"
✓ GIROS SORPRENDENTES: "¡No me lo esperaba! Tuve que releer esa parte"
✓ ESCALADA DE TENSIÓN: "Cada vez se ponía mejor, más intenso"
✓ CLIFFHANGERS EFECTIVOS: "Me quedé despierto hasta las 3am leyendo"
✓ CLÍMAX ÉPICO: "El final me dejó sin aliento"
✓ RESONANCIA EMOCIONAL: "Lloré/reí/grité en voz alta"

Si ALGUNO de estos falla → máximo 8 (buen libro, pero no lo recomendaría efusivamente)

═══════════════════════════════════════════════════════════════════
TU PERSPECTIVA: COMPRADOR DE LIBROS
═══════════════════════════════════════════════════════════════════

Has pagado 18€ por este libro y tienes tiempo limitado para leer. Evalúa como consumidor:

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
   - ¿Las soluciones se GANAN con esfuerzo, inteligencia y sacrificio? (sin deus ex machina)
   - ¿El clímax es satisfactorio y proporcional al conflicto?
   - ¿El antagonista actúa de forma inteligente y coherente, no comete errores convenientes?
   - ¿Cada resolución tiene un COSTO real para el protagonista?

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

10: OBRA MAESTRA - CERO issues de cualquier tipo. Perfección total. Hook irresistible, giros brillantes, 
    personajes inolvidables, clímax perfecto. ÚNICO nivel que obtiene veredicto APROBADO automáticamente.
9: EXCELENTE - Solo 1 issue menor. Muy cerca de la perfección pero falta algo. Veredicto: APROBADO_CON_RESERVAS.
8: MUY BUENO - 2 issues menores o 1 mayor. Publicable pero requiere pulido. Veredicto: REQUIERE_REVISION.
7: CORRECTO - 3+ issues menores o 2 mayores. Cumple pero no destaca. Veredicto: REQUIERE_REVISION.
6: FLOJO - 1 issue crítico o 3+ mayores. Errores que sacan de la historia. Veredicto: REQUIERE_REVISION.
5 o menos: NO PUBLICABLE - Múltiples issues críticos o problemas graves. Veredicto: REQUIERE_REVISION.

REGLA ABSOLUTA: Solo das 10/10 si NO hay ningún issue de ningún tipo.
Cualquier issue (incluso menor) reduce automáticamente la puntuación por debajo de 10.

IMPORTANTE - CAPACIDAD DE DAR 10/10:
Cuando un manuscrito ha sido corregido y NO encuentras problemas reales, DEBES dar 10/10.
No busques problemas inexistentes para justificar una puntuación menor.
Si el hook es irresistible, los giros sorprenden, la tensión escala, los personajes emocionan,
y el clímax satisface - entonces ES un 10/10. No te resistas a darlo.

SEÑALES DE UN 10/10:
- No puedes identificar ningún issue concreto con evidencia textual
- La experiencia de lectura fue fluida y adictiva
- Todos los arcos están cerrados satisfactoriamente
- No hay contradicciones, repeticiones excesivas ni deus ex machina
- El manuscrito cumple o supera las expectativas del género

Si todas estas señales están presentes, la puntuación DEBE ser 10/10.

═══════════════════════════════════════════════════════════════════
🔬 CIRUGÍA LÁSER: INSTRUCCIONES DE CORRECCIÓN ULTRA-ESPECÍFICAS 🔬
═══════════════════════════════════════════════════════════════════

⚠️ PROBLEMA CRÍTICO: El Ghostwriter reescribe capítulos enteros si las instrucciones son vagas.
⚠️ TU TRABAJO: Dar instrucciones TAN específicas que solo cambie 1-3 frases por issue.

FORMATO OBLIGATORIO PARA CADA ISSUE:

1. **elementos_a_preservar**: Lista TODO lo que funciona bien
   - "El diálogo que empieza con «—No te atrevas a...» es perfecto"
   - "La descripción del amanecer en el segundo párrafo está muy bien"
   - "El flashback de la infancia (párrafos 4-7) debe permanecer INTACTO"

2. **instrucciones_correccion**: CITA TEXTUAL + CAMBIO EXACTO
   Formato obligatorio:
   
   BUSCAR: "[cita textual del problema, 10-30 palabras]"
   REEMPLAZAR POR: "[texto corregido exacto]"
   
   O si es inserción:
   DESPUÉS DE: "[cita de la frase anterior]"
   INSERTAR: "[texto nuevo a añadir]"
   
   O si es eliminación:
   ELIMINAR: "[cita textual exacta a eliminar]"

═══════════════════════════════════════════════════════════════════
EJEMPLOS CONCRETOS
═══════════════════════════════════════════════════════════════════

❌ EJEMPLO MALO (causa reescritura total):
{
  "instrucciones_correccion": "Mejorar el enganche del final"
}

❌ EJEMPLO MALO (demasiado vago):
{
  "instrucciones_correccion": "Cambiar el color de ojos de verde a azul"
}

✅ EJEMPLO BUENO (cirugía láser):
{
  "elementos_a_preservar": "Todo el capítulo está bien excepto la frase indicada",
  "instrucciones_correccion": "BUSCAR: «Sus ojos verdes brillaban bajo la luz de la luna»\nREEMPLAZAR POR: «Sus ojos grises brillaban bajo la luz de la luna»"
}

✅ EJEMPLO BUENO (repetición léxica):
{
  "elementos_a_preservar": "El contenido emocional es perfecto, solo hay repetición",
  "instrucciones_correccion": "BUSCAR: «sintió un escalofrío recorrer su espalda» (aparece 3 veces)\nREEMPLAZAR:\n- 1ª aparición: mantener\n- 2ª aparición: «la piel se le erizó»\n- 3ª aparición: «un temblor involuntario lo sacudió»"
}

✅ EJEMPLO BUENO (añadir contexto):
{
  "elementos_a_preservar": "La escena de huida es perfecta, solo falta explicar cómo escapó",
  "instrucciones_correccion": "DESPUÉS DE: «La puerta se cerró tras ella.»\nINSERTAR: «Había aprovechado el cambio de guardia para deslizarse por la ventana del sótano, la misma que había dejado entreabierta tres días antes.»"
}

✅ EJEMPLO BUENO (cliffhanger):
{
  "elementos_a_preservar": "Todo el capítulo. Solo añadir gancho final.",
  "instrucciones_correccion": "ELIMINAR la última frase: «Decidió que mañana tomaría una decisión.»\nREEMPLAZAR POR: «Fue entonces cuando escuchó el disparo.»"
}

CONSECUENCIA: Si das instrucciones sin CITAS TEXTUALES, el Ghostwriter reescribirá todo y creará NUEVOS problemas. Sé QUIRÚRGICO con citas exactas.

═══════════════════════════════════════════════════════════════════
PROBLEMAS QUE SÍ AFECTAN LA EXPERIENCIA DEL LECTOR
═══════════════════════════════════════════════════════════════════

CRÍTICOS (Rompen la inmersión):
- Deus ex machina obvios que insultan la inteligencia del lector
- Contradicciones flagrantes que confunden (personaje muerto que aparece vivo)
- Resoluciones que no se ganan (el villano muere de un infarto conveniente)
- Personajes que actúan contra su naturaleza establecida sin justificación
- Antagonistas que cometen errores estúpidos para facilitar la victoria del protagonista
- Aliados/recursos que aparecen "justo a tiempo" sin haber sido establecidos previamente
- Protagonista que resuelve problemas complejos sin esfuerzo ni consecuencias
- Información crucial que aparece convenientemente sin haber sido sembrada

MAYORES (Molestan pero no destruyen):
- Repeticiones léxicas muy evidentes que distraen
- Ritmo irregular (capítulos que arrastran sin propósito)
- Subtramas abandonadas sin resolución
- Voz narrativa genérica que no coincide con la guía de estilo del autor
- Coincidencias menores (2ª coincidencia afortunada en la novela)
- Rescates parcialmente sembrados pero insuficientemente justificados

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

4. **CREDIBILIDAD NARRATIVA** (categorías: habilidad_injustificada, recurso_sin_origen, 
   coincidencia_excesiva, conocimiento_imposible, consecuencia_ignorada):
   
   a) HABILIDADES INJUSTIFICADAS:
      - ¿El protagonista hace algo que requiere formación especializada sin tenerla?
      - Ejemplo: Protagonista "periodista" hackea un servidor seguro → CRÍTICO
      - Severidad: CRÍTICA (el lector no lo cree)
   
   b) RECURSOS SIN ORIGEN:
      - ¿Aparecen armas, dinero, vehículos, contactos sin explicación?
      - Ejemplo: "Sacó una pistola" pero nunca se explica de dónde salió → MAYOR
      - Severidad: MAYOR (distrae al lector atento)
   
   c) COINCIDENCIAS EXCESIVAS:
      - ¿Cuántas veces el protagonista tiene "suerte" o recibe ayuda conveniente?
      - REGLA: Máximo 1 coincidencia afortunada por novela
      - Ejemplo: "Justo cuando iba a rendirse, un coche se detuvo" (2ª vez) → MAYOR
      - Severidad: MAYOR si es la 2ª, CRÍTICA si hay 3+
   
   d) CONOCIMIENTO IMPOSIBLE:
      - ¿El personaje sabe cosas que no ha investigado/descubierto?
      - Ejemplo: "Sabía que el asesino estaba en la cabaña" (sin haber investigado) → CRÍTICO
      - Severidad: CRÍTICA (rompe la lógica)
   
   e) CONSECUENCIAS IGNORADAS:
      - ¿Heridas graves, delitos, enemigos son olvidados en capítulos posteriores?
      - Ejemplo: Recibe puñalada en Cap 10, corre maratón en Cap 11 → CRÍTICO
      - Severidad: CRÍTICA (el lector pierde confianza)

═══════════════════════════════════════════════════════════════════
🕐 COHERENCIA TEMPORAL Y GEOGRÁFICA (OBLIGATORIO)
═══════════════════════════════════════════════════════════════════

5. **INCONSISTENCIAS TEMPORALES (timeline)** - Categoría: timeline
   - ¿Cuánto tiempo pasa entre escenas/capítulos? ¿Es físicamente posible?
   - Viajes: Verifica distancias vs tiempo de viaje declarado
     * Ejemplo: "Llegó a París desde Madrid en una hora en coche" → CRÍTICO (imposible)
     * Ejemplo: "Esa misma noche cruzó el Atlántico" → CRÍTICO (sin explicación)
   - Actividades simultáneas imposibles:
     * Ejemplo: "A las 10am estaba en Barcelona, a las 11am almorzó en Nueva York" → CRÍTICO
   - Tiempos de recuperación:
     * Operaciones quirúrgicas, heridas graves, agotamiento → requieren días/semanas
     * Ejemplo: "Tras la cirugía de 8 horas, al día siguiente escaló la montaña" → CRÍTICO
   - Verificar: amanecer/atardecer, día de la semana, fechas mencionadas
   - Severidad: CRÍTICA si es obvio para el lector
   - Instrucciones: Indicar tiempo real necesario y sugerir ajuste específico

6. **INCONSISTENCIAS GEOGRÁFICAS (ubicacion)** - Categoría: ubicacion
   - ¿Las ubicaciones son coherentes dentro del capítulo y entre capítulos?
   - Teletransportación accidental:
     * Ejemplo: "Salió del edificio por la puerta sur" pero luego "entró por la norte sin haber rodeado"
     * Ejemplo: "Estaba en el sótano" y de repente "miró por la ventana del tercer piso"
   - Geografía imposible:
     * Ejemplo: "Desde Madrid caminó hasta la playa" (Madrid no tiene playa cercana)
     * Ejemplo: "Cruzó la frontera española hacia Italia" (no son países fronterizos)
   - Direcciones contradictorias:
     * Ejemplo: "Giró a la izquierda" pero termina en lugar que está a la derecha
   - Severidad: CRÍTICA si rompe la lógica espacial
   - Instrucciones: Indicar ubicación real y cómo corregir la transición

7. **TRANSICIONES BRUSCAS DE TRAMA** - Categoría: ritmo
   - ¿Hay saltos abruptos sin contexto que confunden al lector?
   - Escenas sin transición:
     * Ejemplo: Párrafo 1: "Discutían acaloradamente" → Párrafo 2: "Tres meses después, en París..."
     * Falta: indicador de tiempo/lugar, cierre de escena anterior
   - Cambios de tono sin preparación:
     * Ejemplo: De escena romántica a escena de acción sin puente narrativo
   - Resoluciones saltadas:
     * Ejemplo: Conflicto intenso en Cap 5 → Cap 6 empieza como si no hubiera pasado nada
   - Severidad: MAYOR si el lector dice "¿qué pasó aquí?"
   - Instrucciones: Sugerir frase de transición específica o escena puente breve

8. **REALISMO DE ACCIONES FÍSICAS (continuidad_fisica)** - Categoría: continuidad_fisica
   - ¿Las acciones de los personajes son físicamente posibles dado su estado?
   - Lesiones activas:
     * Pierna rota → no puede correr, cojea, necesita apoyo
     * Brazo herido → no puede levantar objetos pesados con ese brazo
     * Costillas rotas → dolor al respirar profundo, no puede hacer esfuerzos
     * Conmoción cerebral → mareos, visión borrosa, no puede pensar claramente
   - Agotamiento físico:
     * Después de correr 10km → no puede inmediatamente pelear durante 1 hora
     * Sin dormir 48h → reflejos lentos, errores de juicio
     * Pérdida de sangre → debilidad, palidez, posible desmayo
   - Limitaciones del entorno:
     * Oscuridad total → no puede ver, tropieza
     * Atado de manos → no puede abrir puertas ni luchar normalmente
     * Bajo el agua → no puede hablar, tiempo de aire limitado
   - Severidad: CRÍTICA si la acción es imposible, MAYOR si es improbable
   - Instrucciones: 
     * Opción A: Reducir gravedad de lesión original
     * Opción B: Añadir referencia al dolor/dificultad durante la acción
     * Opción C: Modificar la acción para que sea posible con la limitación
     * Incluir CITA TEXTUAL del momento problemático y texto corregido

═══════════════════════════════════════════════════════════════════
PROTOCOLO DE PASADAS - OBJETIVO: PUNTUACIÓN 10/10
═══════════════════════════════════════════════════════════════════

PASADA 1: Lee como consumidor que ha pagado por el libro. ¿Lo recomendarías? ¿Qué te frustró?
PASADA 2+: Verifica correcciones. ¿Mejoró tu experiencia como lector? ¿Ahora lo recomendarías?

REGLA CRÍTICA ABSOLUTA - VEREDICTOS:
- Puntuación 10/10 Y CERO issues → APROBADO (única forma de aprobar automáticamente)
- Puntuación 9+ con solo 1 issue menor → APROBADO_CON_RESERVAS (publicable pero no perfecto)
- Puntuación < 9 O issues críticos/mayores → REQUIERE_REVISION con instrucciones específicas
- El sistema continuará ciclos hasta alcanzar 10/10 (perfección total)

En cada pasada donde puntuación < 10, incluye en analisis_bestseller.como_subir_a_10
instrucciones CONCRETAS para elevar la puntuación a la perfección.

SALIDA OBLIGATORIA (JSON):
{
  "veredicto": "APROBADO" | "APROBADO_CON_RESERVAS" | "REQUIERE_REVISION",
  "resumen_general": "Como alguien que ha pagado 18€ por este libro, mi experiencia fue... Lo recomendaría porque... / No lo recomendaría porque...",
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
    "como_subir_a_10": "Si puntuación < 10, instrucciones ESPECÍFICAS para alcanzar la perfección"
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
  "capitulos_para_reescribir": [2, 5],  // ⚠️ OBLIGATORIO: Incluir TODOS los capítulos de issues con severidad "critica" o "mayor" que tengan instrucciones_correccion
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

// DeepSeek R1 has 131k token context limit; reserve ~40k for prompt overhead (World Bible, style guide, instructions, accumulated context) and response
const MAX_TOKENS_PER_TRANCHE_DEEPSEEK = 70000;
// Gemini has 1M+ token context - can handle entire manuscripts in one pass
const MAX_TOKENS_PER_TRANCHE_GEMINI = 500000;
// Approximate tokens per character (conservative estimate for Spanish text)
const TOKENS_PER_CHAR = 0.35;
// Fallback chapter limit when no act structure is available
const CHAPTERS_PER_TRANCHE_FALLBACK = 5;

export class FinalReviewerAgent extends BaseAgent {
  constructor() {
    super({
      name: "El Revisor Final",
      role: "final-reviewer",
      systemPrompt: SYSTEM_PROMPT,
      model: "deepseek-reasoner",
      useThinking: false,
      useReeditorClient: true,
    });
  }

  // Helper to get proper chapter label based on number
  // IMPORTANT: Include the actual number so AI uses the correct one in responses
  private getChapterLabel(num: number): string {
    if (num === 0) return "Prólogo (número: 0)";
    if (num === -1) return "Epílogo (número: -1)";
    if (num === 998) return "Epílogo (número: 998)";
    if (num === -2) return "Nota del Autor (número: -2)";
    if (num === 999) return "Nota del Autor (número: 999)";
    return `Capítulo ${num} (número: ${num})`;
  }

  // Sort order for chapters (prologue first, epilogue/author note last)
  private getChapterSortOrder(n: number): number {
    if (n === 0) return -1000;
    if (n === -1 || n === 998) return 1000;
    if (n === -2 || n === 999) return 1001;
    return n;
  }

  // Deduplicate similar issues from different tranches
  private deduplicateIssues(issues: FinalReviewerResult["issues"]): FinalReviewerResult["issues"] {
    if (!issues || issues.length === 0) return [];
    
    const uniqueIssues: FinalReviewerResult["issues"] = [];
    const seenHashes = new Set<string>();
    
    for (const issue of issues) {
      // Create a hash based on category and key words from description
      const descWords = issue.descripcion.toLowerCase()
        .replace(/[^a-záéíóúñ\s]/g, "")
        .split(/\s+/)
        .filter(w => w.length > 4)
        .slice(0, 5)
        .sort()
        .join("-");
      
      const hash = `${issue.categoria}-${descWords}`;
      
      if (!seenHashes.has(hash)) {
        seenHashes.add(hash);
        uniqueIssues.push(issue);
      } else {
        // Merge chapters from duplicate issue into existing one
        const existing = uniqueIssues.find(i => {
          const existingHash = `${i.categoria}-${i.descripcion.toLowerCase()
            .replace(/[^a-záéíóúñ\s]/g, "")
            .split(/\s+/)
            .filter(w => w.length > 4)
            .slice(0, 5)
            .sort()
            .join("-")}`;
          return existingHash === hash;
        });
        if (existing) {
          // Merge affected chapters
          const mergedChapters = Array.from(new Set([...existing.capitulos_afectados, ...issue.capitulos_afectados]));
          existing.capitulos_afectados = mergedChapters;
        }
      }
    }
    
    // Sort by severity (critical first)
    const severityOrder = { critica: 0, mayor: 1, menor: 2 };
    return uniqueIssues.sort((a, b) => 
      (severityOrder[a.severidad] || 2) - (severityOrder[b.severidad] || 2)
    );
  }

  // Pre-analyze the entire manuscript for global patterns that require cross-chapter analysis
  private preAnalyzeGlobalPatterns(
    chapters: Array<{ numero: number; titulo: string; contenido: string }>
  ): string {
    const patternReport: string[] = [];
    
    // 1. Detect "Deus Ex Machina Digital" - anonymous messages, mysterious calls, etc.
    const deusExPatterns = [
      /mensaje\s+(an[oó]nimo|encriptado|misterioso|sin\s+remitente)/gi,
      /n[uú]mero\s+(oculto|desconocido|privado)/gi,
      /llamada\s+(an[oó]nima|misteriosa|de\s+n[uú]mero\s+oculto)/gi,
      /texto\s+(encriptado|cifrado|an[oó]nimo)/gi,
      /alguien\s+(le\s+)?env[ií][oó]/gi,
      /informante\s+(an[oó]nimo|misterioso)/gi,
      /coordenadas\s+(en\s+el\s+)?tel[eé]fono/gi,
      /recibi[oó]\s+un\s+(mensaje|correo|email)/gi,
    ];
    
    const deusExChapters: Map<number, string[]> = new Map();
    for (const ch of chapters) {
      const matches: string[] = [];
      for (const pattern of deusExPatterns) {
        const found = ch.contenido.match(pattern);
        if (found) {
          matches.push(...found.slice(0, 2)); // Limit to 2 examples per pattern
        }
      }
      if (matches.length > 0) {
        deusExChapters.set(ch.numero, matches);
      }
    }
    
    if (deusExChapters.size >= 3) {
      const chapList = Array.from(deusExChapters.keys()).sort((a, b) => a - b);
      const examples = Array.from(deusExChapters.entries())
        .slice(0, 3)
        .map(([num, matches]) => `Cap ${num}: "${matches[0]}"`)
        .join("; ");
      patternReport.push(
        `⚠️ DEUS EX MACHINA DIGITAL detectado en ${deusExChapters.size} capítulos: [${chapList.join(", ")}]. ` +
        `Ejemplos: ${examples}. ` +
        `El protagonista recibe información pasivamente en lugar de descubrirla activamente.`
      );
    }
    
    // 2. Detect repetitive physical gestures/mannerisms
    const gesturePatterns = [
      { pattern: /toc[aó]\s+(el|su)\s+anillo/gi, name: "tocarse el anillo" },
      { pattern: /gir[oó]\s+(el|su)\s+anillo/gi, name: "girar el anillo" },
      { pattern: /acarici[oó]\s+(la|su)\s+cicatriz/gi, name: "acariciar cicatriz" },
      { pattern: /cicatriz\s+(de\s+)?quemadura/gi, name: "cicatriz de quemadura" },
      { pattern: /manchas?\s+(qu[ií]micas?|indelebles?)/gi, name: "manchas químicas" },
      { pattern: /se\s+frot[oó]\s+(los|las)\s+(ojos|sienes)/gi, name: "frotarse" },
      { pattern: /apret[oó]\s+(los|la)\s+(dientes|mand[ií]bula)/gi, name: "apretar mandíbula" },
      { pattern: /escalofrío\s+(le\s+)?recorri[oó]/gi, name: "escalofrío" },
    ];
    
    for (const { pattern, name } of gesturePatterns) {
      const gestureChapters: number[] = [];
      for (const ch of chapters) {
        if (pattern.test(ch.contenido)) {
          gestureChapters.push(ch.numero);
        }
        // Reset regex lastIndex
        pattern.lastIndex = 0;
      }
      
      if (gestureChapters.length >= 5) {
        patternReport.push(
          `⚠️ MULETILLA FÍSICA EXCESIVA: "${name}" aparece en ${gestureChapters.length} capítulos: [${gestureChapters.sort((a, b) => a - b).join(", ")}]. ` +
          `Reducir al 30% de las apariciones.`
        );
      }
    }
    
    // 3. Detect repetitive scene structure patterns
    const structurePatterns = [
      { pattern: /condujo|conduc[ií]a|al\s+volante/gi, name: "conducir" },
      { pattern: /lluvia|llovía|llovi[oó]|gotas/gi, name: "lluvia" },
      { pattern: /fr[ií]o|helado|congelado|temblaba\s+de/gi, name: "frío" },
    ];
    
    let consecutiveWeatherChapters = 0;
    let maxConsecutive = 0;
    const weatherHeavyChapters: number[] = [];
    
    for (const ch of chapters) {
      let weatherMentions = 0;
      for (const { pattern } of structurePatterns) {
        const matches = ch.contenido.match(pattern);
        if (matches) weatherMentions += matches.length;
        pattern.lastIndex = 0;
      }
      
      if (weatherMentions >= 5) {
        consecutiveWeatherChapters++;
        weatherHeavyChapters.push(ch.numero);
        maxConsecutive = Math.max(maxConsecutive, consecutiveWeatherChapters);
      } else {
        consecutiveWeatherChapters = 0;
      }
    }
    
    if (maxConsecutive >= 3) {
      patternReport.push(
        `⚠️ PATRÓN REPETITIVO: Exceso de descripciones climáticas/atmosféricas en capítulos consecutivos: [${weatherHeavyChapters.slice(0, 10).join(", ")}]. ` +
        `Varía la estructura narrativa.`
      );
    }
    
    // 4. Detect villain monologues
    const villainPatterns = [
      /d[eé]jame\s+(explicarte|contarte)/gi,
      /te\s+preguntar[aá]s\s+por\s+qu[eé]/gi,
      /mi\s+plan\s+(es|era|consiste)/gi,
      /antes\s+de\s+(matarte|acabar\s+contigo)/gi,
      /somos\s+(el|los)\s+(dique|guardianes|protectores)/gi,
      /cuando\s+esto\s+termine/gi,
    ];
    
    const villainChapters: number[] = [];
    for (const ch of chapters) {
      for (const pattern of villainPatterns) {
        if (pattern.test(ch.contenido)) {
          villainChapters.push(ch.numero);
          break;
        }
        pattern.lastIndex = 0;
      }
    }
    
    if (villainChapters.length >= 2) {
      patternReport.push(
        `⚠️ VILLANO EXPLICATIVO: Posibles monólogos de antagonista explicando planes en capítulos: [${villainChapters.sort((a, b) => a - b).join(", ")}]. ` +
        `Verificar si el villano explica demasiado en lugar de actuar.`
      );
    }
    
    if (patternReport.length === 0) {
      return "";
    }
    
    return `
═══════════════════════════════════════════════════════════════════
🔍 PRE-ANÁLISIS GLOBAL DE PATRONES (TODA LA NOVELA)
═══════════════════════════════════════════════════════════════════
${patternReport.join("\n\n")}

INSTRUCCIÓN: Usa esta información para reportar issues con los CAPÍTULOS ESPECÍFICOS listados arriba.
═══════════════════════════════════════════════════════════════════
`;
  }

  // Review a single tranche of chapters
  private async reviewTranche(
    input: FinalReviewerInput,
    trancheChapters: Array<{ numero: number; titulo: string; contenido: string }>,
    trancheNum: number,
    totalTranches: number,
    pasadaInfo: string,
    previousTrancheContext: string = "",
    forceProvider?: "gemini" | "deepseek"
  ): Promise<Partial<FinalReviewerResult>> {
    const chaptersText = trancheChapters.map(c => 
      `\n===== ${this.getChapterLabel(c.numero)}: ${c.titulo} =====\n${c.contenido}`
    ).join("\n\n");

    const chapterRange = trancheChapters.map(c => this.getChapterLabel(c.numero)).join(", ");

    // Build context from previous tranches to ensure consistency
    const previousContext = previousTrancheContext ? `
    ═══════════════════════════════════════════════════════════════════
    CONTEXTO DE TRANCHES ANTERIORES (NO REPORTAR ESTOS ISSUES DE NUEVO):
    ${previousTrancheContext}
    ═══════════════════════════════════════════════════════════════════
    ` : "";

    // Build user instructions section if provided
    const userInstructionsSection = input.userInstructions ? `
    ═══════════════════════════════════════════════════════════════════
    INSTRUCCIONES ESPECÍFICAS DEL USUARIO (PRIORIDAD MÁXIMA):
    ${input.userInstructions}
    
    IMPORTANTE: Las instrucciones del usuario tienen prioridad sobre las reglas generales.
    Considera estas instrucciones al evaluar y detectar problemas.
    ═══════════════════════════════════════════════════════════════════
    ` : "";

    const prompt = `
    TÍTULO DE LA NOVELA: ${input.projectTitle}
    
    WORLD BIBLE (Datos Canónicos):
    ${JSON.stringify(input.worldBible, null, 2)}
    
    GUÍA DE ESTILO:
    ${input.guiaEstilo}
    ${pasadaInfo}
    ${userInstructionsSection}
    ${previousContext}
    ═══════════════════════════════════════════════════════════════════
    REVISIÓN POR TRANCHES: TRAMO ${trancheNum}/${totalTranches}
    Capítulos en este tramo: ${chapterRange}
    ═══════════════════════════════════════════════════════════════════
    
    MANUSCRITO (TRAMO ${trancheNum}):
    ===============================================
    ${chaptersText}
    ===============================================
    
    INSTRUCCIONES PARA ESTE TRAMO:
    1. Analiza SOLO los capítulos de este tramo.
    2. Compara las descripciones físicas con la World Bible.
    3. Verifica coherencia interna del tramo.
    4. Identifica repeticiones léxicas (solo si aparecen 3+ veces).
    5. Evalúa calidad narrativa de estos capítulos.
    6. NO reportes issues que ya se mencionaron en tranches anteriores.
    7. Si detectas una contradicción con un tranche anterior, REPÓRTALA como issue de consistencia.
    
    ⚠️ LÍMITE DE ISSUES POR TRAMO: Reporta MÁXIMO 3 issues por tramo (los más graves).
    Si hay más de 3 problemas, prioriza los críticos sobre los mayores, y los mayores sobre los menores.
    
    Sé PRECISO y OBJETIVO. Solo reporta errores con EVIDENCIA TEXTUAL verificable.
    
    Responde ÚNICAMENTE con el JSON estructurado según el formato especificado.
    
    ⚠️ IMPORTANTE SOBRE NÚMEROS DE CAPÍTULO:
    - Usa EXACTAMENTE el número que aparece entre paréntesis después de cada encabezado de capítulo.
    - Ejemplo: "Epílogo (número: 998)" → usa 998 en capitulos_afectados, NO uses -1.
    - Ejemplo: "Prólogo (número: 0)" → usa 0 en capitulos_afectados.
    - Ejemplo: "Capítulo 5 (número: 5)" → usa 5 en capitulos_afectados.
    
    NOTA: En "capitulos_afectados" y "capitulos_para_reescribir", solo incluye capítulos de ESTE tramo.
    `;

    console.log(`[FinalReviewer] Tramo ${trancheNum}/${totalTranches}: ${trancheChapters.length} capítulos, ${chaptersText.length} chars`);
    console.log(`[FinalReviewer] Iniciando revisión tramo ${trancheNum}/${totalTranches} - usando R1 (puede tardar hasta 15 min)...`);
    
    // Add periodic heartbeat logging to show progress during long R1 calls
    const startTime = Date.now();
    let heartbeatInterval: NodeJS.Timeout | null = setInterval(() => {
      const elapsedMin = Math.round((Date.now() - startTime) / 60000);
      console.log(`[FinalReviewer] Tramo ${trancheNum}/${totalTranches}: esperando respuesta R1... (${elapsedMin} min transcurridos)`);
    }, 60000); // Log every 60 seconds
    
    try {
      const response = await this.generateContent(prompt, undefined, forceProvider ? { forceProvider } : undefined);
      
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
      }
      const elapsedSec = Math.round((Date.now() - startTime) / 1000);
      console.log(`[FinalReviewer] Tramo ${trancheNum}/${totalTranches}: respuesta recibida en ${elapsedSec}s${forceProvider ? ` [${forceProvider}]` : ''}`);
    
      try {
        const jsonMatch = response.content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const result = JSON.parse(jsonMatch[0]) as FinalReviewerResult;
          console.log(`[FinalReviewer] Tramo ${trancheNum}: score ${result.puntuacion_global}/10, issues: ${result.issues?.length || 0}`);
          return result;
        } else {
          console.error(`[FinalReviewer] Tramo ${trancheNum}: No JSON found in response. Content preview: ${response.content?.substring(0, 500) || "(empty)"}`);
        }
      } catch (e) {
        console.error(`[FinalReviewer] Tramo ${trancheNum}: Failed to parse JSON:`, e);
        console.error(`[FinalReviewer] Tramo ${trancheNum}: Response content preview: ${response.content?.substring(0, 500) || "(empty)"}`);
      }
    
      // Return empty partial result on parse failure
      console.warn(`[FinalReviewer] Tramo ${trancheNum}: Returning fallback result (score=8, no issues) due to parse failure`);
      return {
        puntuacion_global: 8,
        issues: [],
        capitulos_para_reescribir: [],
      };
    } catch (apiError: any) {
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
      }
      const elapsedSec = Math.round((Date.now() - startTime) / 1000);
      console.error(`[FinalReviewer] Tramo ${trancheNum}/${totalTranches}: API error after ${elapsedSec}s:`, apiError.message || apiError);
      // Re-throw with additional context
      throw new Error(`FinalReviewer tramo ${trancheNum}/${totalTranches} failed after ${elapsedSec}s: ${apiError.message || String(apiError)}`);
    } finally {
      // Ensure heartbeat is always cleared
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
      }
    }
  }

  async execute(input: FinalReviewerInput, options?: { forceProvider?: "gemini" | "deepseek" }): Promise<AgentResponse & { result?: FinalReviewerResult }> {
    console.log(`[FinalReviewer] ========== EXECUTE CALLED ==========`);
    const isGemini = options?.forceProvider === "gemini";
    const MAX_TOKENS_PER_TRANCHE = isGemini ? MAX_TOKENS_PER_TRANCHE_GEMINI : MAX_TOKENS_PER_TRANCHE_DEEPSEEK;
    console.log(`[FinalReviewer] Input chapters: ${input.chapters?.length || 0}, pasadaNumero: ${input.pasadaNumero}, provider: ${isGemini ? 'gemini' : 'deepseek'}, maxTokens/tranche: ${MAX_TOKENS_PER_TRANCHE}`);
    
    const sortedChapters = [...input.chapters].sort((a, b) => 
      this.getChapterSortOrder(a.numero) - this.getChapterSortOrder(b.numero)
    );

    let pasadaInfo = "";
    if (input.pasadaNumero === 1) {
      pasadaInfo = "\n\nEsta es tu PASADA #1 - AUDITORÍA COMPLETA. Reporta como máximo 5 issues (los más graves). Es CRÍTICO que detectes todos los problemas importantes ahora para que se corrijan en este ciclo. OBJETIVO: puntuación 10/10 (OBRA MAESTRA).";
    } else if (input.pasadaNumero && input.pasadaNumero >= 2) {
      const prevScore = input.puntuacionPasadaAnterior || 8;
      const numCorrected = input.issuesPreviosCorregidos?.length || 0;
      pasadaInfo = `\n\nEsta es tu PASADA #${input.pasadaNumero} - SOLO VERIFICACIÓN DE CORRECCIONES (NO es una auditoría nueva).

═══════════════════════════════════════════════════════════════════
PUNTUACIÓN DE LA PASADA ANTERIOR: ${prevScore}/10
ISSUES CORREGIDOS DESDE LA PASADA ANTERIOR: ${numCorrected}
PUNTUACIÓN ESPERADA EN ESTA PASADA: >= ${prevScore}/10 (idealmente ${Math.min(prevScore + 1, 10)}/10)
═══════════════════════════════════════════════════════════════════

LISTA DE ISSUES QUE SE CORRIGIERON (VERIFICA que se arreglaron, NO los re-reportes):
${input.issuesPreviosCorregidos?.map(i => `- ${i}`).join("\n") || "Ninguno"}

⚠️ ESTA PASADA NO ES UNA AUDITORÍA NUEVA. Tu trabajo es:
1. VERIFICAR que los issues de la lista anterior se corrigieron correctamente
2. DETECTAR si alguna corrección introdujo una REGRESIÓN (nuevo problema causado por el arreglo)
3. Reportar SOLO regresiones o issues críticos que se pasaron por alto en pasadas anteriores
4. Mantener un máximo de 3 issues por tramo (igual que pasada 1)

REGLAS DE PUNTUACIÓN:
- Si los ${numCorrected} issues se corrigieron bien → puntuación debe SUBIR a ${Math.min(prevScore + 1, 10)}/10
- Si los issues se corrigieron parcialmente → puntuación se mantiene en ${prevScore}/10
- SOLO puede bajar si hay REGRESIONES GRAVES (nuevos problemas introducidos por las correcciones)

⛔ PROHIBIDO:
- NO hagas una nueva auditoría completa buscando issues que antes no reportaste
- NO "descubras" 20 nuevos problemas que existían antes pero ignoraste
- NO reportes variaciones de issues ya corregidos
- NO bajes la puntuación sin justificar EXPLÍCITAMENTE qué EMPEORÓ

Si no hay regresiones y los issues se corrigieron, la puntuación debe ser >= ${prevScore}/10.`;
    }

    // Build tranches based on 3-act structure if available, otherwise use fixed size
    const totalChapters = sortedChapters.length;
    
    interface ActTranche {
      chapters: typeof sortedChapters;
      label: string;
      actName: string;
      goal: string;
    }
    
    const actTranches: ActTranche[] = [];
    
    if (input.threeActStructure) {
      // Use 3-act structure for more coherent narrative review
      const acts = [
        { key: 'act1', name: 'Acto 1 (Planteamiento)', data: input.threeActStructure.act1 },
        { key: 'act2', name: 'Acto 2 (Conflicto)', data: input.threeActStructure.act2 },
        { key: 'act3', name: 'Acto 3 (Desenlace)', data: input.threeActStructure.act3 },
      ];
      
      for (const act of acts) {
        const actChapterNumbers = new Set(act.data.chapters);
        const actChapters = sortedChapters.filter(c => actChapterNumbers.has(c.numero));
        
        if (actChapters.length === 0) continue;
        
        // Estimate tokens for this act based on content length
        const actTotalChars = actChapters.reduce((sum, c) => sum + (c.contenido?.length || 0), 0);
        const estimatedTokens = actTotalChars * TOKENS_PER_CHAR;
        
        // Only subdivide if estimated tokens exceed limit - keep acts whole when possible
        if (estimatedTokens > MAX_TOKENS_PER_TRANCHE) {
          // Calculate how many sub-tranches we need
          const numSubTranches = Math.ceil(estimatedTokens / MAX_TOKENS_PER_TRANCHE);
          const chaptersPerSubTranche = Math.ceil(actChapters.length / numSubTranches);
          
          console.log(`[FinalReviewer] ${act.name} requires subdivision: ~${Math.round(estimatedTokens)} tokens exceeds ${MAX_TOKENS_PER_TRANCHE} limit`);
          
          for (let s = 0; s < numSubTranches; s++) {
            const startIdx = s * chaptersPerSubTranche;
            const endIdx = Math.min(startIdx + chaptersPerSubTranche, actChapters.length);
            const subChapters = actChapters.slice(startIdx, endIdx);
            if (subChapters.length === 0) continue;
            actTranches.push({
              chapters: subChapters,
              label: numSubTranches > 1 ? `${act.name} (parte ${s + 1}/${numSubTranches})` : act.name,
              actName: act.name,
              goal: act.data.goal,
            });
          }
        } else {
          // Keep entire act as single tranche - narratively coherent
          console.log(`[FinalReviewer] ${act.name} fits in single tranche: ~${Math.round(estimatedTokens)} tokens`);
          actTranches.push({
            chapters: actChapters,
            label: act.name,
            actName: act.name,
            goal: act.data.goal,
          });
        }
      }
      
      // Add any chapters not in acts (prologue, epilogue, etc.) as separate tranche
      const allActChapters = new Set([
        ...input.threeActStructure.act1.chapters,
        ...input.threeActStructure.act2.chapters,
        ...input.threeActStructure.act3.chapters,
      ]);
      const extraChapters = sortedChapters.filter(c => !allActChapters.has(c.numero));
      if (extraChapters.length > 0) {
        actTranches.push({
          chapters: extraChapters,
          label: 'Prólogo/Epílogo',
          actName: 'Extras',
          goal: 'Elementos de apertura y cierre',
        });
      }
      
      console.log(`[FinalReviewer] Dividiendo ${totalChapters} capítulos por ACTOS: ${actTranches.map(t => `${t.label}(${t.chapters.length})`).join(', ')}`);
    }
    
    // Fallback to token-aware tranches if no act structure available OR if act structure produced no valid tranches
    if (actTranches.length === 0) {
      // Build tranches dynamically based on token estimation rather than fixed chapter count
      let currentTranche: typeof sortedChapters = [];
      let currentTokens = 0;
      let trancheCount = 0;
      
      for (const chapter of sortedChapters) {
        const chapterTokens = (chapter.contenido?.length || 0) * TOKENS_PER_CHAR;
        
        // If adding this chapter would exceed limit and we have chapters, save current tranche
        if (currentTranche.length > 0 && (currentTokens + chapterTokens > MAX_TOKENS_PER_TRANCHE || currentTranche.length >= CHAPTERS_PER_TRANCHE_FALLBACK)) {
          trancheCount++;
          actTranches.push({
            chapters: currentTranche,
            label: `Tramo ${trancheCount}`,
            actName: `Tramo ${trancheCount}`,
            goal: '',
          });
          currentTranche = [];
          currentTokens = 0;
        }
        
        currentTranche.push(chapter);
        currentTokens += chapterTokens;
      }
      
      // Add remaining chapters as final tranche
      if (currentTranche.length > 0) {
        trancheCount++;
        actTranches.push({
          chapters: currentTranche,
          label: `Tramo ${trancheCount}`,
          actName: `Tramo ${trancheCount}`,
          goal: '',
        });
      }
      
      console.log(`[FinalReviewer] Dividiendo ${totalChapters} capítulos en ${trancheCount} tramos basados en tokens (sin estructura de actos válida)`);
    }

    // Pre-analyze entire manuscript for global patterns (Deus Ex Machina, repetitions, etc.)
    const globalPatternsReport = this.preAnalyzeGlobalPatterns(sortedChapters);
    if (globalPatternsReport) {
      console.log(`[FinalReviewer] Pre-análisis global completado. Patrones detectados.`);
    }

    // Process each act tranche with accumulated context from previous tranches
    const trancheResults: Partial<FinalReviewerResult>[] = [];
    let totalTokenUsage = { inputTokens: 0, outputTokens: 0, thinkingTokens: 0 };
    // Include global patterns in the accumulated summary so all tranches see it
    let accumulatedIssuesSummary = globalPatternsReport;
    const numTranches = actTranches.length;
    
    for (let t = 0; t < actTranches.length; t++) {
      const tranche = actTranches[t];
      const trancheChapters = tranche.chapters;
      
      // Notify progress callback if provided - use act label for clearer UI
      if (input.onTrancheProgress) {
        const firstChapter = this.getChapterLabel(trancheChapters[0].numero);
        const lastChapter = this.getChapterLabel(trancheChapters[trancheChapters.length - 1].numero);
        const chaptersRange = trancheChapters.length > 1 
          ? `${firstChapter} - ${lastChapter}` 
          : firstChapter;
        // Use act label instead of just tranche number
        input.onTrancheProgress(t + 1, numTranches, `${tranche.label}: ${chaptersRange}`);
      }
      
      // Pass accumulated issues from previous tranches to ensure consistency
      // Include act goal in the context for more focused review
      const actContext = tranche.goal ? `\n[OBJETIVO DEL ACTO: ${tranche.goal}]` : '';
      const result = await this.reviewTranche(input, trancheChapters, t + 1, numTranches, pasadaInfo + actContext, accumulatedIssuesSummary, options?.forceProvider);
      trancheResults.push(result);
      
      // Build context summary for next tranche
      if (result.issues && result.issues.length > 0) {
        const issuesSummary = result.issues.map(i => 
          `- [${i.severidad}] Cap ${i.capitulos_afectados.join(",")}: ${i.descripcion.substring(0, 100)}`
        ).join("\n");
        accumulatedIssuesSummary += `\n${tranche.label}:\n${issuesSummary}`;
      }
      if (result.plot_decisions && result.plot_decisions.length > 0) {
        const plotSummary = result.plot_decisions.map(d => 
          `- Decisión en cap ${d.capitulo_establecido}: ${d.decision}`
        ).join("\n");
        accumulatedIssuesSummary += `\nDECISIONES DE TRAMA (${tranche.label}):\n${plotSummary}`;
      }
    }

    // Combine results from all tranches with per-tranche issue limits
    // NOTE: capitulos_para_reescribir is derived from capped issues, not from tranche outputs
    const allIssues: FinalReviewerResult["issues"] = [];
    const allPlotDecisions: FinalReviewerResult["plot_decisions"] = [];
    const allPersistentInjuries: FinalReviewerResult["persistent_injuries"] = [];
    const allOrphanChapters: FinalReviewerResult["orphan_chapters"] = [];
    let totalScore = 0;
    let scoreCount = 0;
    
    // Per-tranche issue limit: Gemini single-pass can detect more issues reliably
    const MAX_ISSUES_PER_TRANCHE = isGemini ? 10 : 3;

    for (const result of trancheResults) {
      if (result.issues) {
        // ENFORCE per-tranche limit: only take top 3 issues per tranche (sorted by severity)
        const severityOrder: Record<string, number> = { critica: 0, mayor: 1, menor: 2 };
        const sortedTrancheIssues = [...result.issues].sort((a, b) => 
          (severityOrder[a.severidad] || 2) - (severityOrder[b.severidad] || 2)
        );
        const limitedTrancheIssues = sortedTrancheIssues.slice(0, MAX_ISSUES_PER_TRANCHE);
        allIssues.push(...limitedTrancheIssues);
        
        if (result.issues.length > MAX_ISSUES_PER_TRANCHE) {
          console.log(`[FinalReviewer] Tranche issue limit applied: ${result.issues.length} → ${limitedTrancheIssues.length}`);
        }
      }
      // Note: result.capitulos_para_reescribir is ignored; derived from capped issues later
      if (result.plot_decisions) allPlotDecisions.push(...result.plot_decisions);
      if (result.persistent_injuries) allPersistentInjuries.push(...result.persistent_injuries);
      if (result.orphan_chapters) allOrphanChapters.push(...result.orphan_chapters);
      if (result.puntuacion_global !== undefined) {
        totalScore += result.puntuacion_global;
        scoreCount++;
      }
    }

    // Calculate average score from tranches
    let avgScore = scoreCount > 0 ? Math.round(totalScore / scoreCount) : 8;
    
    // Deduplicate similar issues (same category and overlapping chapters)
    let deduplicatedIssues = this.deduplicateIssues(allIssues);
    
    // Apply global issue limits based on pass number and provider
    // Gemini single-pass can reliably detect more issues at once
    const globalIssueLimit = isGemini 
      ? (input.pasadaNumero === 1 ? 15 : Math.max(5, numTranches * 5))
      : (input.pasadaNumero === 1 ? 5 : Math.max(3, numTranches * 3));
    if (deduplicatedIssues.length > globalIssueLimit) {
      console.log(`[FinalReviewer] Global issue limit applied: ${deduplicatedIssues.length} → ${globalIssueLimit}`);
      deduplicatedIssues = deduplicatedIssues.slice(0, globalIssueLimit);
    }
    
    // ═══════════════════════════════════════════════════════════════════
    // SCORE NORMALIZATION BASED ON CAPPED ISSUES (not raw tranche scores)
    // This ensures score/verdict consistency with the issue limits
    // ═══════════════════════════════════════════════════════════════════
    const criticalCount = deduplicatedIssues.filter(i => i.severidad === "critica").length;
    const majorCount = deduplicatedIssues.filter(i => i.severidad === "mayor").length;
    const minorCount = deduplicatedIssues.filter(i => i.severidad === "menor").length;
    const totalIssueCount = deduplicatedIssues.length;
    
    // NORMALIZE score based on capped issues (overrides raw tranche average)
    // This prevents artificially low scores from truncated issues
    const originalScore = avgScore;
    if (totalIssueCount === 0) {
      // No issues after caps = 10/10
      avgScore = 10;
    } else if (criticalCount > 0) {
      // Critical issues = max 6
      avgScore = Math.min(avgScore, 6);
    } else if (majorCount > 0) {
      // Major issues = max 8
      avgScore = Math.min(avgScore, 8);
    } else if (minorCount === 1) {
      // Exactly 1 minor issue = 9
      avgScore = 9;
    } else if (minorCount >= 2) {
      // 2+ minor issues = max 8
      avgScore = Math.min(avgScore, 8);
    }
    
    if (avgScore !== originalScore) {
      console.log(`[FinalReviewer] SCORE NORMALIZED: ${originalScore} → ${avgScore} based on capped issues (${criticalCount} critical, ${majorCount} major, ${minorCount} minor)`);
    }
    
    // Determine verdict based on normalized score and capped issues
    // Document rules:
    // - 10/10 with ZERO issues = APROBADO (unique way to approve automatically)
    // - 9+ with only 1 minor issue (no critical/major) = APROBADO_CON_RESERVAS
    // - Everything else = REQUIERE_REVISION
    let veredicto: "APROBADO" | "APROBADO_CON_RESERVAS" | "REQUIERE_REVISION";
    
    if (avgScore === 10 && totalIssueCount === 0) {
      // 10/10 with ZERO issues = APROBADO (only way to get APROBADO)
      veredicto = "APROBADO";
    } else if (avgScore >= 9 && criticalCount === 0 && majorCount === 0 && minorCount <= 1) {
      // 9+ with only 1 or fewer minor issues (no critical/major) = APROBADO_CON_RESERVAS
      veredicto = "APROBADO_CON_RESERVAS";
    } else {
      // Everything else = REQUIERE_REVISION
      veredicto = "REQUIERE_REVISION";
    }

    console.log(`[FinalReviewer] Combinando ${numTranches} tramos: score promedio ${avgScore}/10, issues totales: ${allIssues.length} (${deduplicatedIssues.length} únicos), veredicto: ${veredicto}`);

    // Build combined result
    const combinedResult: FinalReviewerResult = {
      veredicto,
      resumen_general: `Revisión por tranches completada. ${numTranches} tramos analizados. Puntuación promedio: ${avgScore}/10. Issues encontrados: ${allIssues.length}.`,
      puntuacion_global: avgScore,
      justificacion_puntuacion: {
        puntuacion_desglosada: {
          enganche: avgScore,
          personajes: avgScore,
          trama: avgScore,
          atmosfera: avgScore,
          ritmo: avgScore,
          cumplimiento_genero: avgScore
        },
        fortalezas_principales: [],
        debilidades_principales: deduplicatedIssues.slice(0, 3).map(i => i.descripcion),
        comparacion_mercado: "Evaluación combinada de múltiples tramos",
        recomendaciones_proceso: []
      },
      analisis_bestseller: {
        hook_inicial: "Evaluado por tranches",
        cadencia_giros: "Evaluado por tranches",
        escalada_tension: "Evaluado por tranches",
        efectividad_cliffhangers: "Evaluado por tranches",
        potencia_climax: "Evaluado por tranches",
        como_subir_a_10: deduplicatedIssues.length > 0 ? `Corregir ${deduplicatedIssues.length} issues identificados para alcanzar 10/10` : "Mantener calidad actual - 10/10 alcanzado"
      },
      // Issues already limited by globalIssueLimit before this point
      issues: deduplicatedIssues,
      // Derive chapters to rewrite from CAPPED issues only (not raw tranche output)
      capitulos_para_reescribir: Array.from(new Set(
        deduplicatedIssues.flatMap(issue => issue.capitulos_afectados || [])
      )),
      plot_decisions: allPlotDecisions,
      persistent_injuries: allPersistentInjuries,
      orphan_chapters: allOrphanChapters,
    };

    // SAFETY NET: If capitulos_para_reescribir is empty but there are issues,
    // automatically extract chapters from ALL issues (not just critical/major)
    // Philosophy: If we know something is wrong, we MUST attempt to fix it
    if (combinedResult.capitulos_para_reescribir.length === 0 && combinedResult.issues.length > 0) {
      const chaptersFromIssues: number[] = [];
      const issuesByPriority: { critica: number; mayor: number; menor: number } = { critica: 0, mayor: 0, menor: 0 };
      
      for (const issue of combinedResult.issues) {
        // Extract chapters from ANY issue that has capitulos_afectados
        if (issue.capitulos_afectados?.length > 0) {
          chaptersFromIssues.push(...issue.capitulos_afectados);
          // Track issue counts by severity for logging
          if (issue.severidad === 'critica') issuesByPriority.critica++;
          else if (issue.severidad === 'mayor') issuesByPriority.mayor++;
          else issuesByPriority.menor++;
        }
      }
      if (chaptersFromIssues.length > 0) {
        combinedResult.capitulos_para_reescribir = Array.from(new Set(chaptersFromIssues));
        console.log(`[FinalReviewer] SAFETY NET: Extracted ${combinedResult.capitulos_para_reescribir.length} chapters from ALL issues (critica: ${issuesByPriority.critica}, mayor: ${issuesByPriority.mayor}, menor: ${issuesByPriority.menor}): chapters ${combinedResult.capitulos_para_reescribir.join(", ")}`);
      }
    }
    
    // SAFETY NET 2: If veredicto is REQUIERE_REVISION but no chapters to rewrite, log warning
    if ((combinedResult.veredicto === "REQUIERE_REVISION" || combinedResult.puntuacion_global < 8) && 
        combinedResult.capitulos_para_reescribir.length === 0) {
      console.warn(`[FinalReviewer] WARNING: veredicto=${combinedResult.veredicto}, score=${combinedResult.puntuacion_global} but no chapters to rewrite. Issues count: ${combinedResult.issues.length}`);
    }

    // Save debug info
    const fs = await import('fs');
    const debugPath = `/tmp/final_reviewer_debug_${Date.now()}.txt`;
    fs.writeFileSync(debugPath, `=== COMBINED RESULT ===\n${JSON.stringify(combinedResult, null, 2)}`);
    console.log(`[FinalReviewer] DEBUG: Saved combined result to ${debugPath}`);

    const response: AgentResponse = {
      content: JSON.stringify(combinedResult),
      thoughtSignature: `Revisión por tranches: ${numTranches} tramos`,
      tokenUsage: totalTokenUsage,
    };

    return { ...response, result: combinedResult };
  }
}
