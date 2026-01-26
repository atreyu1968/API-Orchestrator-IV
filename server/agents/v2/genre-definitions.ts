export interface GenreTrackingConfig {
  focus: string;
  critical_rules: string[];
  tracked_attributes: string[];
  relationship_types: string[];
}

export const GENRE_TRACKING_CONFIG: Record<string, GenreTrackingConfig> = {
  "crime_thriller": {
    focus: "Coartadas, Ubicaciones Exactas, Líneas de Tiempo, Evidencias Físicas, Identidad de Sospechosos.",
    critical_rules: [
      "Un personaje no puede estar en dos lugares al mismo tiempo.",
      "La causa de muerte debe ser consistente con la autopsia establecida.",
      "Las coartadas verificadas son inmutables.",
      "La cadena de custodia de la evidencia no puede romperse inexplicablemente.",
      "La identidad de víctima/sospechoso no puede cambiar sin explicación narrativa.",
      "Los roles de personajes (forense, detective, sospechoso) deben ser coherentes."
    ],
    tracked_attributes: ["is_suspect", "alibi", "alibi_verified", "motive", "location_at_crime", "has_evidence_against"],
    relationship_types: ["SUSPECTS", "ALIBI_FOR", "WITNESSED", "KILLED", "FOUND_BODY", "LOCATED_AT"]
  },

  "mystery": {
    focus: "Pistas, Sospechosos, Coartadas, Revelaciones Progresivas, Red Herrings.",
    critical_rules: [
      "Las pistas sembradas deben tener relevancia o ser red herrings claramente marcados.",
      "Los sospechosos deben tener motivo, medios y oportunidad coherentes.",
      "La revelación final debe ser lógicamente deducible de pistas previas.",
      "No se pueden introducir elementos cruciales en el último momento (fair play).",
      "Los personajes no pueden olvidar información crítica sin justificación."
    ],
    tracked_attributes: ["is_suspect", "alibi", "motive", "means", "opportunity", "secrets_known"],
    relationship_types: ["SUSPECTS", "KNOWS_SECRET", "ALIBI_FOR", "BLACKMAILS", "LIES_TO"]
  },

  "historical_thriller": {
    focus: "Tecnología Forense de la Época, Tiempos de Viaje Históricos, Contexto Político Real.",
    critical_rules: [
      "No se pueden usar métodos forenses modernos (ADN, huellas digitales) si no existían en el año establecido.",
      "Los tiempos de viaje deben respetar el transporte de la época (caballo, tren a vapor, barco).",
      "Las motivaciones deben encajar con la moralidad y política del momento histórico.",
      "El lenguaje debe evitar anacronismos lingüísticos.",
      "Los objetos y tecnología deben existir en la época."
    ],
    tracked_attributes: ["social_rank", "historical_role", "allegiance", "available_technology"],
    relationship_types: ["SERVES", "COMMANDS", "ALLIED_WITH", "ENEMY_OF", "LOCATED_AT"]
  },

  "historical": {
    focus: "Fechas de Eventos Reales, Etiqueta Social, Vestimenta, Tecnología Disponible.",
    critical_rules: [
      "CERO ANACRONISMOS: No mencionar objetos, conceptos o palabras que no existían.",
      "Los grandes eventos históricos (batallas, coronaciones) deben ocurrir en su fecha exacta.",
      "El lenguaje y la jerarquía social deben respetarse estrictamente (tratos de nobleza, roles de género de la época).",
      "La vestimenta y costumbres deben ser apropiadas para la época y clase social."
    ],
    tracked_attributes: ["social_class", "occupation", "historical_fate", "allegiances"],
    relationship_types: ["MARRIED_TO", "PARENT_OF", "SERVES", "RULES_OVER", "CONTEMPORARY_OF"]
  },

  "science_fiction": {
    focus: "Leyes de la Física (Reales o Ficticias), Consistencia Tecnológica, Biología Alienígena.",
    critical_rules: [
      "Si se establece una limitación tecnológica (ej: el escudo dura 5 min), no se puede romper sin una mejora explícita.",
      "Las reglas del viaje espacial (FTL, criogenia) deben ser constantes.",
      "La fisiología alienígena o IA debe seguir sus propias reglas biológicas/lógicas.",
      "Los recursos (energía, oxígeno, combustible) deben ser finitos y rastreados."
    ],
    tracked_attributes: ["species", "tech_level", "augmentations", "ship_capabilities", "resources"],
    relationship_types: ["COMMANDS", "CREW_OF", "ALLIED_WITH", "HOSTILE_TO", "PROGRAMMED_BY"]
  },

  "fantasy": {
    focus: "Sistemas de Magia (Hard/Soft), Costes de poder, Geopolítica de Reinos, Inventario Mágico.",
    critical_rules: [
      "El coste de la magia (maná, sangre, energía) debe pagarse siempre.",
      "No se pueden inventar poderes nuevos para resolver un problema (Deus Ex Machina).",
      "Las distancias de viaje deben respetar el mapa establecido.",
      "Los objetos mágicos tienen limitaciones que deben respetarse.",
      "Las razas/especies tienen características fijas."
    ],
    tracked_attributes: ["race", "magic_ability", "magic_cost", "allegiance", "magical_items", "power_level"],
    relationship_types: ["SWORN_TO", "ENEMY_OF", "MENTOR_OF", "POSSESSES", "BOUND_BY"]
  },

  "dystopian": {
    focus: "Reglas de la Opresión, Escasez de Recursos, Vigilancia, Estratificación Social.",
    critical_rules: [
      "El sistema de vigilancia/control del gobierno tiene reglas fijas que no se pueden burlar fácilmente.",
      "La escasez de recursos (comida, agua, energía) es un límite duro para los personajes.",
      "Las consecuencias de la desobediencia deben ser consistentes y brutales.",
      "La estratificación social dicta acceso a recursos y libertades."
    ],
    tracked_attributes: ["social_tier", "ration_level", "surveillance_status", "resistance_affiliation"],
    relationship_types: ["CONTROLS", "RESISTS", "INFORMANT_FOR", "PROTECTS", "TRADES_WITH"]
  },

  "romance": {
    focus: "Niveles de intimidad, Secretos compartidos, Estado emocional, Malentendidos, Obstáculos Externos.",
    critical_rules: [
      "El nivel de intimidad no puede saltar o retroceder sin un evento narrativo mayor.",
      "Los secretos revelados no pueden ser 'des-conocidos'.",
      "La 'Química' o tensión emocional debe ser monitoreada y mantenida.",
      "Los obstáculos para estar juntos deben ser lógicos y no simples coincidencias repetitivas."
    ],
    tracked_attributes: ["relationship_status", "intimacy_level", "secrets_known", "emotional_state", "obstacles"],
    relationship_types: ["LOVES", "ATTRACTED_TO", "EX_OF", "RIVAL_FOR", "CONFIDED_IN", "JEALOUS_OF"]
  },

  "horror": {
    focus: "Reglas del Monstruo/Entidad, Nivel de Aislamiento, Salud Mental, Recursos de Supervivencia.",
    critical_rules: [
      "La entidad sobrenatural debe seguir sus propias reglas (ej: no puede cruzar agua, solo sale de noche).",
      "El aislamiento (sin señal, sin salida) no puede romperse mágicamente.",
      "Las reacciones de miedo deben ser realistas; los personajes no se vuelven inmunes al terror sin razón.",
      "Los recursos de supervivencia (luz, armas, refugio) son finitos."
    ],
    tracked_attributes: ["sanity_level", "is_infected", "survival_resources", "knows_entity_weakness"],
    relationship_types: ["HUNTED_BY", "PROTECTS", "TRUSTS", "SUSPECTS", "SACRIFICED"]
  },

  "adventure": {
    focus: "Geografía, Suministros/Inventario, Estado Físico/Heridas, El 'Reloj' (Tiempo Límite).",
    critical_rules: [
      "Las heridas físicas reducen la capacidad del personaje y no sanan instantáneamente.",
      "El inventario es limitado; no pueden sacar objetos que no empacaron.",
      "La geografía y el clima dictan la velocidad de movimiento.",
      "Los plazos y fechas límite deben respetarse."
    ],
    tracked_attributes: ["physical_condition", "injuries", "inventory", "location", "deadline"],
    relationship_types: ["TRAVELLING_WITH", "GUIDES", "PURSUES", "RESCUES", "COMPETES_WITH"]
  },

  "thriller": {
    focus: "Tensión Constante, Amenazas Físicas, Conspiraciones, Cuenta Regresiva.",
    critical_rules: [
      "Las heridas tienen consecuencias reales en la capacidad del personaje.",
      "Los antagonistas deben tener motivaciones coherentes y no ser malvados sin razón.",
      "La escalada de tensión debe ser progresiva y justificada.",
      "Los recursos (munición, aliados, tiempo) son finitos.",
      "Las identidades y lealtades establecidas no cambian sin justificación."
    ],
    tracked_attributes: ["allegiance", "injuries", "resources", "known_threats", "deadline"],
    relationship_types: ["PURSUES", "ALLIED_WITH", "BETRAYS", "PROTECTS", "THREATENS"]
  }
};

export function getGenreConfig(genre: string): GenreTrackingConfig {
  const normalized = genre.toLowerCase().replace(/_/g, "_");
  return GENRE_TRACKING_CONFIG[normalized] || GENRE_TRACKING_CONFIG["mystery"];
}
