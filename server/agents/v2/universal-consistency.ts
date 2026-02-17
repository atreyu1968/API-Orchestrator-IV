import OpenAI from 'openai';
import { getGenreConfig, GenreTrackingConfig } from './genre-definitions';
import type { WorldEntity, WorldRuleRecord, EntityRelationship } from '@shared/schema';

interface ValidationResult {
  isValid: boolean;
  criticalError?: string;
  correctionInstructions?: string; // Specific instructions on HOW to fix the error
  warnings?: string[];
  newFacts?: Array<{
    entityName: string;
    entityType: string;
    update: Record<string, any>;
  }>;
  newRules?: Array<{
    ruleDescription: string;
    category: string;
  }>;
  newRelationships?: Array<{
    subject: string;
    target: string;
    relationType: string;
    meta?: Record<string, any>;
  }>;
}

interface EntityForPrompt {
  name: string;
  type: string;
  attributes: Record<string, any>;
  status: string;
  lastSeenChapter?: number;
}

interface RuleForPrompt {
  ruleDescription: string;
  category: string;
}

interface RelationshipForPrompt {
  subject: string;
  target: string;
  relationType: string;
  meta?: Record<string, any>;
}

export class UniversalConsistencyAgent {
  private client: OpenAI;
  private model: string;

  constructor() {
    this.client = new OpenAI({
      apiKey: process.env.DEEPSEEK_API_KEY,
      baseURL: 'https://api.deepseek.com'
    });
    this.model = 'deepseek-chat';
  }

  generateConstraints(
    genre: string,
    entities: EntityForPrompt[],
    rules: RuleForPrompt[],
    relationships: RelationshipForPrompt[],
    chapterNumber: number,
    timelineInfo?: {
      chapter_timeline?: Array<{ chapter: number; day: string; time_of_day: string; duration?: string; location?: string }>;
      previous_chapter?: { day: string; time_of_day: string; location?: string };
      current_chapter?: { day: string; time_of_day: string; location?: string };
      travel_times?: Array<{ from: string; to: string; by_car?: string; by_plane?: string; by_train?: string }>;
    },
    characterStates?: Array<{
      character: string;
      current_location?: string;
      physical_state?: string;
      active_injuries?: string[];
      key_possessions?: string[];
    }>
  ): string {
    const config = getGenreConfig(genre);

    // LitAgents 2.1+: Build detailed character profiles with physical descriptions
    // Distinguish between truly immutable attributes and mutable-with-explanation
    const TRULY_IMMUTABLE = ['ojos', 'eyes', 'eye_color', 'altura', 'height']; // Cannot change (without magic/surgery)
    const MUTABLE_WITH_EXPLANATION = ['pelo', 'hair', 'cabello', 'barba', 'beard', 'peso', 'weight', 'build', 'cicatriz', 'scar', 'tatuaje', 'tattoo', 'complexion', 'piel', 'skin'];
    
    const entityBlock = entities.length > 0
      ? entities.filter(e => e.type === 'CHARACTER').map(e => {
          const allAttrs = Object.entries(e.attributes || {});
          
          // Categorize attributes
          const trulyImmutable = allAttrs.filter(([k]) => 
            TRULY_IMMUTABLE.some(ti => k.toLowerCase().includes(ti))
          );
          const mutableWithExplanation = allAttrs.filter(([k]) => 
            MUTABLE_WITH_EXPLANATION.some(mwe => k.toLowerCase().includes(mwe)) &&
            !TRULY_IMMUTABLE.some(ti => k.toLowerCase().includes(ti))
          );
          const otherAttrs = allAttrs.filter(([k]) => 
            !TRULY_IMMUTABLE.some(ti => k.toLowerCase().includes(ti)) &&
            !MUTABLE_WITH_EXPLANATION.some(mwe => k.toLowerCase().includes(mwe)) &&
            !k.endsWith('_INMUTABLE')
          );
          
          let result = `\n══════════════════════════════════════\n`;
          result += `[FICHA] ${e.name.toUpperCase()} (${e.status})`;
          result += `\n══════════════════════════════════════`;
          
          // Truly immutable attributes (cannot change)
          if (trulyImmutable.length > 0) {
            result += `\n[INMUTABLE] (no puede cambiar):`;
            trulyImmutable.forEach(([k, v]) => {
              const cleanKey = k.replace('_INMUTABLE', '').replace(/_/g, ' ');
              result += `\n   - ${cleanKey}: ${v}`;
            });
          }
          
          // Mutable with explanation
          if (mutableWithExplanation.length > 0) {
            result += `\n[ACTUAL] (puede cambiar SI SE EXPLICA):`;
            mutableWithExplanation.forEach(([k, v]) => {
              const cleanKey = k.replace('_INMUTABLE', '').replace(/_/g, ' ');
              result += `\n   - ${cleanKey}: ${v}`;
            });
          }
          
          // No description yet
          if (trulyImmutable.length === 0 && mutableWithExplanation.length === 0) {
            result += `\n[DESCRIPCION FISICA]: (No establecida - puedes describirla, sera registrada)`;
          }
          
          // Other attributes (role, personality, etc.)
          if (otherAttrs.length > 0) {
            result += `\n\n[PERFIL]:`;
            otherAttrs.forEach(([k, v]) => {
              if (typeof v === 'string' && v.length < 200) {
                result += `\n   - ${k}: ${v}`;
              }
            });
          }
          
          return result;
        }).join('\n')
      : '(Sin personajes registrados aún - las descripciones físicas serán extraídas automáticamente)';

    // LitAgents 2.1+: Build location profiles with immutable characteristics
    const locationBlock = entities.filter(e => e.type === 'LOCATION').length > 0
      ? entities.filter(e => e.type === 'LOCATION').map(e => {
          const allAttrs = Object.entries(e.attributes || {});
          
          let result = `\n[LUGAR] ${e.name.toUpperCase()}`;
          result += `\n   Estado: ${e.status}`;
          
          // Location characteristics
          const locAttrs = allAttrs.filter(([k]) => 
            ['descripcion', 'description', 'atmosfera', 'atmosphere', 'tipo', 'type', 'caracteristicas', 'features', 'acceso', 'access', 'distancia', 'distance'].some(la => k.toLowerCase().includes(la))
          );
          
          if (locAttrs.length > 0) {
            locAttrs.forEach(([k, v]) => {
              const cleanKey = k.replace('_INMUTABLE', '').replace(/_/g, ' ');
              result += `\n   - ${cleanKey}: ${v}`;
            });
          }
          
          // Current occupants
          const occupants = allAttrs.find(([k]) => k.toLowerCase().includes('ocupantes') || k.toLowerCase().includes('occupants'));
          if (occupants) {
            result += `\n   Ocupantes actuales: ${occupants[1]}`;
          }
          
          return result;
        }).join('\n')
      : '';

    // LitAgents 2.1+: Character position tracking
    const characterPositions = entities.filter(e => e.type === 'CHARACTER' && e.attributes).map(e => {
      const attrs = e.attributes as Record<string, any>;
      const location = attrs.ubicacion_actual || attrs.current_location || attrs.location;
      const lastSeen = e.lastSeenChapter;
      if (location) {
        return `   - ${e.name}: ${location} (desde Cap ${lastSeen || '?'})`;
      }
      return null;
    }).filter(Boolean);

    const positionBlock = characterPositions.length > 0
      ? `\n[POSICION ACTUAL DE PERSONAJES]:\n${characterPositions.join('\n')}\n   ADVERTENCIA: Los personajes NO pueden cambiar de ubicacion sin mostrar el desplazamiento`
      : '';

    const rulesBlock = rules.length > 0
      ? rules.map(r => `- [${r.category || 'GENERAL'}] ${r.ruleDescription}`).join('\n')
      : '(Sin reglas establecidas aún)';

    const relationshipsBlock = relationships.length > 0
      ? relationships.map(r => `- ${r.subject} --[${r.relationType}]--> ${r.target}`).join('\n')
      : '(Sin relaciones registradas)';

    // LitAgents 2.2: Extract OBJECTS tracking
    const objectEntities = entities.filter(e => e.type === 'OBJECT');
    const objectsBlock = objectEntities.length > 0
      ? objectEntities.map(obj => {
          const attrs = obj.attributes || {};
          const owner = attrs.propietario || attrs.owner || attrs.poseedor || 'desconocido';
          const location = attrs.ubicacion || attrs.location || 'desconocida';
          const desc = attrs.descripcion || attrs.description || '';
          return `   [OBJ] ${obj.name}: en posesion de ${owner} | ubicacion: ${location}${desc ? ` | ${desc}` : ''}`;
        }).join('\n')
      : '';

    // LitAgents 2.2: Extract EMOTIONAL STATES
    const emotionalStates = entities.filter(e => e.type === 'CHARACTER' && e.attributes).map(e => {
      const attrs = e.attributes as Record<string, any>;
      const emotion = attrs.estado_emocional || attrs.emotional_state || attrs.emocion;
      const trauma = attrs.trauma || attrs.duelo || attrs.grief;
      if (emotion || trauma) {
        let state = `   [EMO] ${e.name}: `;
        if (emotion) state += `${emotion}`;
        if (trauma) state += ` | TRAUMA: ${trauma}`;
        return state;
      }
      return null;
    }).filter(Boolean);
    const emotionalBlock = emotionalStates.length > 0
      ? `\n[ESTADOS EMOCIONALES ACTIVOS]:\n${emotionalStates.join('\n')}\n   ADVERTENCIA: Las emociones intensas persisten - no pueden estar felices tras una tragedia sin transicion`
      : '';

    // LitAgents 2.2: Extract SECRETS (what each character knows)
    const secretEntities = entities.filter(e => e.type === 'SECRET');
    const characterKnowledge = entities.filter(e => e.type === 'CHARACTER' && e.attributes).map(e => {
      const attrs = e.attributes as Record<string, any>;
      const knows = attrs.conoce || attrs.knows || attrs.sabe;
      const ignora = attrs.ignora || attrs.doesnt_know || attrs.no_sabe;
      if (knows || ignora) {
        let knowledge = `   [INFO] ${e.name}:`;
        if (knows) knowledge += `\n      SABE: ${knows}`;
        if (ignora) knowledge += `\n      NO SABE: ${ignora}`;
        return knowledge;
      }
      return null;
    }).filter(Boolean);
    const secretsBlock = (secretEntities.length > 0 || characterKnowledge.length > 0)
      ? `\n[SECRETOS Y CONOCIMIENTO]:\n${secretEntities.map(s => `   [SECRETO] ${s.name}: ${s.attributes?.descripcion || s.attributes?.description || ''} (conocido por: ${s.attributes?.conocido_por || s.attributes?.known_by || 'nadie'})`).join('\n')}${characterKnowledge.length > 0 ? '\n' + characterKnowledge.join('\n') : ''}\n   ADVERTENCIA: Un personaje NO puede actuar sobre informacion que NO posee`
      : '';

    // LitAgents 2.2: Extract NARRATIVE PROMISES (Chekhov's gun)
    const promises = entities.filter(e => e.type === 'NARRATIVE_PROMISE' || e.type === 'FORESHADOWING');
    const promisesBlock = promises.length > 0
      ? `\n[PROMESAS NARRATIVAS - Chekhov's Gun]:\n${promises.map(p => {
          const attrs = p.attributes || {};
          const resolved = attrs.resuelto || attrs.resolved;
          const status = resolved ? '[OK]' : '[PENDIENTE]';
          return `   ${status} ${p.name}: ${attrs.descripcion || attrs.description || ''} (Cap ${p.lastSeenChapter || '?'})`;
        }).join('\n')}\n   ADVERTENCIA: Elementos mencionados deben cumplir su proposito narrativo`
      : '';

    // LitAgents 2.2: Extract AGREEMENTS and LIES
    const agreementRelations = relationships.filter(r => 
      ['PROMETIO', 'PROMISE', 'ACUERDO', 'AGREEMENT', 'MINTIO', 'LIED', 'JURO', 'SWORE'].some(t => r.relationType.toUpperCase().includes(t))
    );
    const agreementsBlock = agreementRelations.length > 0
      ? `\n[ACUERDOS, PROMESAS Y MENTIRAS]:\n${agreementRelations.map(r => {
          const label = r.relationType.toUpperCase().includes('MINT') || r.relationType.toUpperCase().includes('LIE') ? '[MENTIRA]' : '[ACUERDO]';
          return `   ${label} ${r.subject} -> ${r.target}: ${r.relationType}${r.meta?.detalle ? ` (${r.meta.detalle})` : ''}`;
        }).join('\n')}\n   ADVERTENCIA: Las promesas rotas tienen consecuencias. Las mentiras deben mantenerse consistentes.`
      : '';

    const genreRules = config.critical_rules.map(r => `- ${r}`).join('\n');

    // NEW: Build temporal coherence block
    let temporalBlock = "";
    if (timelineInfo) {
      temporalBlock = `
[COHERENCIA TEMPORAL] (OBLIGATORIA):
`;
      if (timelineInfo.previous_chapter) {
        temporalBlock += `- Capitulo anterior: ${timelineInfo.previous_chapter.day}, ${timelineInfo.previous_chapter.time_of_day}`;
        if (timelineInfo.previous_chapter.location) {
          temporalBlock += ` en ${timelineInfo.previous_chapter.location}`;
        }
        temporalBlock += `\n`;
      }
      if (timelineInfo.current_chapter) {
        temporalBlock += `- Este capitulo (${chapterNumber}): ${timelineInfo.current_chapter.day}, ${timelineInfo.current_chapter.time_of_day}`;
        if (timelineInfo.current_chapter.location) {
          temporalBlock += ` en ${timelineInfo.current_chapter.location}`;
        }
        temporalBlock += `\n`;
      }
      if (timelineInfo.travel_times && timelineInfo.travel_times.length > 0) {
        temporalBlock += `\n[TIEMPOS DE VIAJE] (respetar para transiciones):\n`;
        timelineInfo.travel_times.slice(0, 8).forEach(t => {
          const times = [t.by_car && `coche: ${t.by_car}`, t.by_plane && `avion: ${t.by_plane}`, t.by_train && `tren: ${t.by_train}`].filter(Boolean).join(', ');
          temporalBlock += `- ${t.from} -> ${t.to}: ${times}\n`;
        });
      }
    }

    // NEW: Build character state block with injuries/locations
    let characterStateBlock = "";
    if (characterStates && characterStates.length > 0) {
      characterStateBlock = `
[ESTADO FISICO DE PERSONAJES AL INICIO DEL CAPITULO]:
`;
      characterStates.forEach(cs => {
        characterStateBlock += `- ${cs.character}:\n`;
        if (cs.current_location) characterStateBlock += `    Ubicacion: ${cs.current_location}\n`;
        if (cs.physical_state) characterStateBlock += `    Estado fisico: ${cs.physical_state}\n`;
        if (cs.active_injuries && cs.active_injuries.length > 0) {
          characterStateBlock += `    [LESIONES ACTIVAS]: ${cs.active_injuries.join(', ')}\n`;
          characterStateBlock += `       -> Estas lesiones LIMITAN sus acciones fisicas\n`;
        }
        if (cs.key_possessions && cs.key_possessions.length > 0) {
          characterStateBlock += `    Posesiones: ${cs.key_possessions.join(', ')}\n`;
        }
      });
    }

    // LitAgents 2.4: DECEASED CHARACTERS TRACKING
    // Extract all characters marked as DEAD/MUERTO/FALLECIDO to prevent resurrection
    const DEATH_STATUS_MARKERS = ['dead', 'muerto', 'fallecido', 'deceased', 'killed', 'asesinado', 'ejecutado'];
    const deceasedCharacters = entities.filter(e => {
      if (e.type !== 'CHARACTER') return false;
      const status = (e.status || '').toLowerCase();
      const attrs = e.attributes || {};
      const vitalStatus = (attrs.estado_vital || attrs.vital_status || attrs.status || '').toString().toLowerCase();
      const deathChapter = attrs.capitulo_muerte || attrs.death_chapter;
      
      return DEATH_STATUS_MARKERS.some(marker => 
        status.includes(marker) || vitalStatus.includes(marker)
      ) || deathChapter;
    });

    let deceasedBlock = '';
    if (deceasedCharacters.length > 0) {
      deceasedBlock = `
╔══════════════════════════════════════════════════════════════════╗
║  [ALERTA CRITICA] PERSONAJES FALLECIDOS - NO PUEDEN APARECER     ║
╠══════════════════════════════════════════════════════════════════╣
`;
      deceasedCharacters.forEach(char => {
        const attrs = char.attributes || {};
        const deathChapter = attrs.capitulo_muerte || attrs.death_chapter || '?';
        const deathCause = attrs.causa_muerte || attrs.death_cause || attrs.cause_of_death || 'no especificada';
        deceasedBlock += `║  [MUERTO] ${char.name.toUpperCase().padEnd(20)} | Murió Cap ${deathChapter} | Causa: ${deathCause.substring(0, 30)}\n`;
      });
      deceasedBlock += `╠══════════════════════════════════════════════════════════════════╣
║  PROHIBIDO: Estos personajes NO pueden hablar, actuar, aparecer  ║
║  NI ser mencionados como si estuvieran vivos después de su       ║
║  muerte. Solo pueden aparecer en flashbacks CLARAMENTE marcados. ║
╚══════════════════════════════════════════════════════════════════╝
`;
    }

    // LitAgents 2.5: CRITICAL CHARACTER CONSTRAINTS EXTRACTION
    // Extract rules about permanent disabilities (aphonia, blindness, deafness, etc.)
    // These are the most commonly violated constraints and need PROMINENT visibility
    // ONLY target specific disability keywords, not generic terms like "permanent"
    
    // Define constraint types for targeted alternatives
    interface CriticalConstraint {
      keywords: string[];
      type: 'SPEECH' | 'VISION' | 'HEARING' | 'MOBILITY' | 'MEMORY';
    }
    
    const CONSTRAINT_TYPES: CriticalConstraint[] = [
      { 
        keywords: ['afonía', 'afonia', 'mudo', 'muda', 'no puede hablar', 'no habla', 'sin voz', 
                   'aphonia', 'mute', 'cannot speak', 'voiceless', 'speechless', 'psicógena'],
        type: 'SPEECH'
      },
      {
        keywords: ['ciego', 'ciega', 'ceguera', 'no puede ver', 'sin vision', 'blind', 'blindness', 'cannot see'],
        type: 'VISION'
      },
      {
        keywords: ['sordo', 'sorda', 'sordera', 'no puede oir', 'no oye', 'deaf', 'deafness', 'cannot hear'],
        type: 'HEARING'
      },
      {
        keywords: ['paralizado', 'paralizada', 'paralisis', 'no puede caminar', 'silla de ruedas',
                   'paralyzed', 'paralysis', 'wheelchair', 'cannot walk'],
        type: 'MOBILITY'
      },
      {
        keywords: ['amnesia', 'no recuerda', 'perdio la memoria', 'memory loss', 'cannot remember'],
        type: 'MEMORY'
      }
    ];
    
    // Helper to detect which constraint type matches
    const detectConstraintType = (text: string): CriticalConstraint['type'] | null => {
      const textLower = text.toLowerCase();
      for (const constraint of CONSTRAINT_TYPES) {
        if (constraint.keywords.some(kw => textLower.includes(kw))) {
          return constraint.type;
        }
      }
      return null;
    };
    
    // Only extract rules in CHARACTER_TRAIT category that match critical constraints
    const CRITICAL_RULE_CATEGORIES = ['CHARACTER_TRAIT', 'PHYSICAL_ATTRIBUTE', 'DISABILITY', 'CONDICION_FISICA'];
    const criticalRulesWithType: Array<{rule: RuleForPrompt, constraintType: CriticalConstraint['type']}> = [];
    
    rules.forEach(r => {
      // Only check rules in critical categories
      if (r.category && CRITICAL_RULE_CATEGORIES.some(cat => r.category.toUpperCase().includes(cat))) {
        const constraintType = detectConstraintType(r.ruleDescription);
        if (constraintType) {
          criticalRulesWithType.push({ rule: r, constraintType });
        }
      } else {
        // Also check rules without category but with explicit constraint keywords
        const constraintType = detectConstraintType(r.ruleDescription);
        if (constraintType) {
          criticalRulesWithType.push({ rule: r, constraintType });
        }
      }
    });
    
    // Extract from character attributes (only physical/trait attributes)
    const CRITICAL_ATTRIBUTE_KEYS = ['condicion', 'discapacidad', 'disability', 'trait', 'estado_fisico', 
                                      'physical_state', 'voz', 'voice', 'habla', 'speech', 'vision', 'oido', 'hearing'];
    const charactersWithCriticalConstraints: Array<{name: string, constraint: string, details: string, constraintType: CriticalConstraint['type']}> = [];
    
    entities.filter(e => e.type === 'CHARACTER').forEach(char => {
      const attrs = char.attributes || {};
      Object.entries(attrs).forEach(([key, value]) => {
        const keyLower = key.toLowerCase();
        // Only check attributes that are likely to be physical/trait related
        if (CRITICAL_ATTRIBUTE_KEYS.some(ak => keyLower.includes(ak))) {
          const constraintType = detectConstraintType(String(value));
          if (constraintType) {
            charactersWithCriticalConstraints.push({
              name: char.name,
              constraint: key.replace(/_/g, ' ').toUpperCase(),
              details: String(value),
              constraintType
            });
          }
        }
      });
    });
    
    // Collect detected constraint types to show relevant alternatives only
    const detectedTypes = new Set<CriticalConstraint['type']>();
    criticalRulesWithType.forEach(r => detectedTypes.add(r.constraintType));
    charactersWithCriticalConstraints.forEach(c => detectedTypes.add(c.constraintType));

    let criticalConstraintsBlock = '';
    if (criticalRulesWithType.length > 0 || charactersWithCriticalConstraints.length > 0) {
      criticalConstraintsBlock = `
╔══════════════════════════════════════════════════════════════════════════════╗
║  [RESTRICCIONES CRITICAS DE PERSONAJES] - VIOLACION = RECHAZO AUTOMATICO    ║
╠══════════════════════════════════════════════════════════════════════════════╣
`;
      // Add rules
      criticalRulesWithType.forEach(({rule}) => {
        const truncatedRule = rule.ruleDescription.length > 75 
          ? rule.ruleDescription.substring(0, 72) + '...'
          : rule.ruleDescription;
        criticalConstraintsBlock += `║  [!] ${truncatedRule.padEnd(72)}║\n`;
      });
      
      // Add character-specific constraints
      charactersWithCriticalConstraints.forEach(cc => {
        const line = `${cc.name}: ${cc.constraint} = ${cc.details}`;
        const truncatedLine = line.length > 72 ? line.substring(0, 69) + '...' : line;
        criticalConstraintsBlock += `║  [!] ${truncatedLine.padEnd(72)}║\n`;
      });
      
      // Show type-specific alternatives only for detected constraint types
      if (detectedTypes.has('SPEECH')) {
        criticalConstraintsBlock += `╠══════════════════════════════════════════════════════════════════════════════╣
║  ALTERNATIVAS para personajes que NO PUEDEN HABLAR (afonía/mudez):          ║
║  - Gestos, señas, lenguaje corporal, expresiones faciales                   ║
║  - Comunicacion escrita (notas, mensajes, escribir en superficies)          ║
║  - Movimientos de cabeza (asentir, negar), apuntar con el dedo              ║
║  - Sonidos no verbales (sollozos, jadeos) - NUNCA palabras articuladas      ║
║  PROHIBIDO: Susurros, palabras entrecortadas, "articular", "musitar", "dijo"║
`;
      }
      if (detectedTypes.has('VISION')) {
        criticalConstraintsBlock += `╠══════════════════════════════════════════════════════════════════════════════╣
║  ALTERNATIVAS para personajes CIEGOS:                                       ║
║  - Describir otros sentidos (tacto, oido, olfato) - NUNCA "vio", "miro"     ║
║  - Orientacion por sonidos, texturas, olores familiares                     ║
║  PROHIBIDO: "sus ojos captaron", "observo", "contemplo", "diviso"           ║
`;
      }
      if (detectedTypes.has('HEARING')) {
        criticalConstraintsBlock += `╠══════════════════════════════════════════════════════════════════════════════╣
║  ALTERNATIVAS para personajes SORDOS:                                       ║
║  - Lectura de labios, lenguaje de signos, vibraciones                       ║
║  PROHIBIDO: "escucho", "oyo", referencias a sonidos percibidos              ║
`;
      }
      if (detectedTypes.has('MOBILITY')) {
        criticalConstraintsBlock += `╠══════════════════════════════════════════════════════════════════════════════╣
║  ALTERNATIVAS para personajes con MOVILIDAD REDUCIDA:                       ║
║  - Silla de ruedas, muletas, ayuda de otros personajes                      ║
║  PROHIBIDO: "camino", "corrio", "se levanto" sin asistencia                 ║
`;
      }
      criticalConstraintsBlock += `╚══════════════════════════════════════════════════════════════════════════════╝
`;
    }

    return `
[SISTEMA DE CONSISTENCIA UNIVERSAL ACTIVO] (${genre.toUpperCase()})
===================================================================

ESCRIBIENDO CAPITULO ${chapterNumber}. Debes respetar ESTRICTAMENTE la Base de Datos de Verdad.
El lector notara cualquier contradiccion. Las violaciones causaran RECHAZO AUTOMATICO.

FOCO DEL GENERO: ${config.focus}
${deceasedBlock}
${criticalConstraintsBlock}
${temporalBlock}
${characterStateBlock}
[FICHAS DE PERSONAJES]:
${entityBlock}
${positionBlock}
${emotionalBlock}
${locationBlock ? `
[LOCALIZACIONES CONOCIDAS]:
${locationBlock}
` : ''}
${objectsBlock ? `
[OBJETOS IMPORTANTES] (Tracking de posesiones):
${objectsBlock}
   ADVERTENCIA: Un personaje NO puede usar un objeto que no posee
` : ''}
[RELACIONES ENTRE PERSONAJES]:
${relationshipsBlock}
${agreementsBlock}
${secretsBlock}
${promisesBlock}

[HECHOS INMUTABLES ESTABLECIDOS]:
${rulesBlock}

[REGLAS CRITICAS DEL GENERO] (${genre}):
${genreRules}

===================================================================
REGLAS DE CONSISTENCIA NARRATIVA:
- Un personaje NO puede estar en dos lugares al mismo tiempo
- Para cambiar de ubicacion, MOSTRAR el desplazamiento (caminando, en coche, etc.)
- Respetar tiempos de viaje realistas entre ubicaciones
- Las descripciones de lugares deben ser CONSISTENTES en toda la novela
- Si un lugar tiene caracteristicas establecidas (color paredes, distribucion), mantenerlas
- Un personaje NO puede usar informacion que NO tiene
- Los estados emocionales persisten - transiciones realistas
- Las promesas y mentiras deben ser consistentes
- Los objetos no aparecen magicamente - tracking de posesiones

REGLAS DE COHERENCIA TEMPORAL (BLOQUEANTES si se violan):
- Las referencias temporales relativas ("hace X días", "ayer") se calculan desde
  el día narrativo ACTUAL, no desde la perspectiva del lector
- Si la cronología dice Día 3, "hace una semana" es IMPOSIBLE si la trama empezó hace 3 días
- Los desplazamientos entre ciudades requieren tiempo proporcional a la distancia
- Las heridas graves (fracturas, quemaduras) NO se curan de un capítulo a otro sin elipsis
- Un capítulo que termina "de noche" no puede ser seguido por uno que empieza "esa misma mañana"
- Los eventos que un personaje recuerda DEBEN haber ocurrido en capítulos ANTERIORES
- Las estaciones del año deben ser coherentes con el paso del tiempo narrativo
===================================================================
`;
  }

  async validateChapter(
    chapterText: string,
    genre: string,
    entities: EntityForPrompt[],
    rules: RuleForPrompt[],
    relationships: RelationshipForPrompt[],
    chapterNumber: number,
    timelineInfo?: {
      chapter_timeline?: Array<{ chapter: number; day: string; time_of_day: string; duration?: string; location?: string }>;
      previous_chapter?: { day: string; time_of_day: string; location?: string };
      current_chapter?: { day: string; time_of_day: string; location?: string };
      travel_times?: Array<{ from: string; to: string; by_car?: string; by_plane?: string; by_train?: string }>;
    },
    narrativeTimeline?: Array<{ chapter: number; narrativeTime: string; location?: string }>
  ): Promise<ValidationResult> {
    const config = getGenreConfig(genre);

    let timelineValidationBlock = "";
    if (timelineInfo || narrativeTimeline) {
      timelineValidationBlock = `
═══════════════════════════════════════════════════════════════════
LÍNEA TEMPORAL ACUMULADA (VERIFICACIÓN OBLIGATORIA):
═══════════════════════════════════════════════════════════════════
`;
      if (narrativeTimeline && narrativeTimeline.length > 0) {
        timelineValidationBlock += `CRONOLOGÍA REAL DE LA NOVELA:\n`;
        narrativeTimeline.forEach(entry => {
          timelineValidationBlock += `  Cap ${entry.chapter}: ${entry.narrativeTime}${entry.location ? ` en ${entry.location}` : ''}\n`;
        });
        timelineValidationBlock += `\n`;
      }
      if (timelineInfo?.current_chapter) {
        timelineValidationBlock += `ESTE CAPÍTULO (${chapterNumber}) DEBERÍA SER: ${timelineInfo.current_chapter.day}, ${timelineInfo.current_chapter.time_of_day}${timelineInfo.current_chapter.location ? ` en ${timelineInfo.current_chapter.location}` : ''}\n`;
      }
      if (timelineInfo?.previous_chapter) {
        timelineValidationBlock += `CAPÍTULO ANTERIOR FUE: ${timelineInfo.previous_chapter.day}, ${timelineInfo.previous_chapter.time_of_day}${timelineInfo.previous_chapter.location ? ` en ${timelineInfo.previous_chapter.location}` : ''}\n`;
      }
      if (timelineInfo?.travel_times && timelineInfo.travel_times.length > 0) {
        timelineValidationBlock += `\nTIEMPOS DE VIAJE CANÓNICOS:\n`;
        timelineInfo.travel_times.forEach(t => {
          const times = [t.by_car && `coche: ${t.by_car}`, t.by_plane && `avión: ${t.by_plane}`, t.by_train && `tren: ${t.by_train}`].filter(Boolean).join(', ');
          timelineValidationBlock += `  ${t.from} → ${t.to}: ${times}\n`;
        });
      }
      timelineValidationBlock += `
VERIFICA que el texto del capítulo NO contradiga esta cronología.
═══════════════════════════════════════════════════════════════════
`;
    }

    const prompt = `Actúa como un Supervisor de Continuidad experto en ${genre}.
Tu trabajo es detectar errores GRAVES Y EVIDENTES, incluyendo VIOLACIONES TEMPORALES.

PRINCIPIO FUNDAMENTAL: EN CASO DE DUDA, APROBAR. Solo rechazar por errores INEQUÍVOCOS.

BASE DE DATOS DE REFERENCIA:

ENTIDADES:
${JSON.stringify(entities, null, 2)}

REGLAS:
${JSON.stringify(rules, null, 2)}

RELACIONES:
${JSON.stringify(relationships, null, 2)}
${timelineValidationBlock}
═══════════════════════════════════════════════════════════════════

CAPÍTULO ${chapterNumber} A EVALUAR:
"""
${chapterText.substring(0, 12000)}
"""
${chapterText.length > 12000 ? '... (truncado)' : ''}

═══════════════════════════════════════════════════════════════════

CRITERIOS DE ERROR CRÍTICO (estos bloquean):

1. MUERTO QUE ACTÚA: Un personaje explícitamente muerto aparece vivo y actuando
2. BILOCACIÓN: El mismo personaje en DOS lugares FÍSICAMENTE al MISMO tiempo
3. CAMBIO FISICO IMPOSIBLE: Ojos azules a verdes, pelo rubio a negro (sin explicacion magica/tinte)
4. CONTRADICCIÓN DIRECTA DE TEXTO: El texto dice "A" y luego dice "no-A" sin justificación
5. INCONSISTENCIA DE EDAD: Edad del personaje no coincide con lo establecido
6. OBJETO PERSONAL INCONSISTENTE: Joya/anillo/reloj que estaba presente ahora no lo está sin explicación
7. CONOCIMIENTO IMPOSIBLE: Personaje sabe información que no ha obtenido en ninguna escena anterior
8. VIOLACIÓN TEMPORAL GRAVE: El texto contradice la línea temporal establecida:
   - "Hace una semana" cuando según la cronología solo han pasado 2 días
   - Mencionar que es "lunes por la mañana" cuando el capítulo anterior terminó en "miércoles por la noche" sin time skip
   - Eventos que ocurren ANTES de que hayan sucedido en la cronología
   - Personaje viajando 500km instantáneamente sin transición temporal
   - Confusión de orden día/noche dentro del mismo capítulo
   EXCEPCIONES IMPORTANTES (NO son violaciones temporales):
   a) Los recuerdos, flashbacks, memorias y reflexiones sobre el pasado NO son violaciones temporales. Si un personaje RECUERDA o PIENSA en un evento de años anteriores (ej: "recordó aquel día de 1939..."), eso NO contradice la línea temporal actual. Solo es violación si el texto NARRA un evento pasado como si ocurriera en el presente.
   b) El paso del tiempo DENTRO de un mismo capítulo es normal: un capítulo puede empezar al amanecer y terminar al atardecer, o cubrir varias horas del mismo día. Esto NO es una confusión temporal — es progresión narrativa natural.
   c) Mencionar eventos históricos que ocurrieron antes del inicio de la historia (ej: una guerra, una ejecución pasada) tampoco es violación si se mencionan como hechos del pasado.
9. RUPTURA DE HILO NARRATIVO: Un evento clave del capítulo anterior (promesa, peligro, herida, descubrimiento) es completamente ignorado sin justificación

IMPORTANTE - NO SON ERRORES CRÍTICOS:
- Variaciones de voz/habla (susurros, ronquera, afonía temporal)
- Cambios emocionales o de comportamiento
- Detalles menores de vestimenta o apariencia
- Interpretaciones ambiguas de reglas
- Evolución natural de personajes
- Diferencias estilísticas en descripciones
- Pequeñas imprecisiones temporales ("amanecer" vs "primera hora")

TAMBIÉN EXTRAE (siempre, incluso si el capítulo es válido):
- Nuevos hechos importantes para futuros capítulos
- Nuevas relaciones reveladas
- Cambios de estado (ubicación, heridas, muerte)

EXTRACCIÓN DETALLADA (usar entityType correspondiente):

0. [CRITICO] MUERTES DE PERSONAJES: entityType="CHARACTER"
   SOLO registrar si el personaje MUERE DEFINITIVAMENTE en este capítulo.
   
   ⚠️ ESTOS NO SON MUERTE — NO usar estado_vital "MUERTO":
   - Drogar a alguien (echar algo en su bebida, sedarlo)
   - Envenenar sin muerte explícita (cae inconsciente pero NO se confirma muerte)
   - Perder el conocimiento, desmayarse, desvanecerse
   - Ser dado por muerto (NO es lo mismo que estar muerto)
   - Captura, secuestro, paliza, tortura (aunque sea brutal)
   - Heridas graves pero no mortales
   - "Se desplomó" / "cayó al suelo" sin confirmación de muerte
   Ejemplo: "Elena le echó algo en el café y Lucas se desplomó" = DROGADO, NO MUERTO
   Ejemplo: "Elena envenenó a Lucas y perdió el conocimiento" = ENVENENADO/INCONSCIENTE, NO MUERTO
   
   Para estos casos, registrar como:
   update: { "estado_fisico": "inconsciente/drogado/herido", "estado_emocional": "descripción" }
   
   SOLO registrar muerte con CONFIRMACIÓN EXPLÍCITA e INEQUÍVOCA de muerte irreversible
   (ej: "cayó muerto", "dejó de respirar para siempre", "su corazón se detuvo", "murió", "falleció", "su cadáver"):
   Solo si hay CONFIRMACIÓN EXPLÍCITA de muerte irreversible:
   update: { 
     "estado_vital": "MUERTO",
     "capitulo_muerte": ${chapterNumber},
     "causa_muerte": "descripción breve de cómo murió"
   }
   ADEMÁS agregar en newRules:
   { "ruleDescription": "[NOMBRE] está MUERTO desde el capítulo ${chapterNumber}. NO puede aparecer vivo en capítulos posteriores.", "category": "DEATH_EVENT" }

1. DETALLES FÍSICOS: entityType="PHYSICAL_TRAIT"
   Color de ojos, pelo, altura, edad, cicatrices, tatuajes

1b. [NUEVO] EDAD DEL PERSONAJE: entityType="CHARACTER"
   Si se menciona la edad de un personaje, registrar OBLIGATORIAMENTE:
   update: { "edad": número, "capitulo_edad_establecida": ${chapterNumber} }
   CRÍTICO: La edad debe ser consistente en toda la novela (salvo time skips explícitos)

1c. [NUEVO] OBJETOS PERSONALES PERSISTENTES: entityType="PERSONAL_ITEM"
   Anillos, relojes, collares, pulseras, joyas que un personaje LLEVA habitualmente
   update: { 
     "propietario": "nombre del personaje",
     "descripcion": "anillo de oro con rubí en dedo anular izquierdo",
     "estado": "presente" o "ausente" o "perdido",
     "capitulo_primera_mencion": ${chapterNumber}
   }
   CRÍTICO: Si un personaje lleva un anillo distintivo, debe seguir llevándolo (o explicar por qué no)

2. LOCALIZACIONES: entityType="LOCATION"
   Incluir: descripcion, atmosfera, caracteristicas

3. CAMBIOS DE UBICACIÓN: entityType="CHARACTER"
   update: { "ubicacion_actual": "nuevo lugar" }

4. OBJETOS IMPORTANTES: entityType="OBJECT"
   Armas, llaves, documentos, joyas, evidencias
   update: { "propietario": "quién lo tiene", "ubicacion": "dónde está", "descripcion": "qué es" }

5. ESTADOS EMOCIONALES: entityType="CHARACTER"
   update: { "estado_emocional": "emoción actual", "trauma": "si hay duelo/trauma activo" }

6. SECRETOS/INFORMACIÓN: entityType="SECRET"
   update: { "descripcion": "el secreto", "conocido_por": "quién lo sabe" }
   O para conocimiento de personaje: entityType="CHARACTER"
   update: { "conoce": "qué sabe", "ignora": "qué NO sabe" }

7. PROMESAS NARRATIVAS (Chekhov): entityType="NARRATIVE_PROMISE"
   Elementos mencionados que deben resolverse
   update: { "descripcion": "qué se promete", "resuelto": false }

8. ACUERDOS/MENTIRAS: Usar newRelationships con relationType:
   "PROMETIO_A", "MINTIO_A", "JURO_A", "ACORDO_CON"
   meta: { "detalle": "descripción del acuerdo/mentira" }

RESPONDE EN JSON:
{
  "isValid": boolean,
  "criticalError": "Descripción del error crítico que BLOQUEA la aprobación, o null si no hay",
  "correctionInstructions": "INSTRUCCIONES ESPECÍFICAS Y DETALLADAS para corregir el error. Ejemplo: 'El personaje X tiene afonía, pero en el texto dice que susurra. SOLUCIÓN: Reemplazar el diálogo de X por comunicación no verbal (gestos, escribir notas, asentir). Localizar la frase exacta: [cita del texto problemático] y cambiarla por [alternativa correcta].' Si no hay error, dejar null.",
  "warnings": ["Lista de advertencias menores que no bloquean pero deben corregirse"],
  "newFacts": [
    { "entityName": "Nombre", "entityType": "CHARACTER|LOCATION|OBJECT|EVIDENCE", "update": { "atributo": "valor" } }
  ],
  "newRules": [
    { "ruleDescription": "Hecho inmutable establecido en este capítulo", "category": "TIMELINE|ALIBI|CAUSE_OF_DEATH|etc" }
  ],
  "newRelationships": [
    { "subject": "Personaje1", "target": "Personaje2", "relationType": "TIPO", "meta": {} }
  ]
}

IMPORTANTE SOBRE correctionInstructions:
- Debe ser MUY ESPECÍFICO: incluir la frase exacta del texto que viola la regla
- Debe proponer una ALTERNATIVA CONCRETA que respete la regla
- Si el personaje no puede hablar, sugerir gestos, señas, o comunicación escrita
- Si hay inconsistencia física (ej: ojos), indicar el color correcto
- Si hay error temporal/geográfico, indicar la corrección exacta`;

    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        response_format: { type: 'json_object' }
      });

      const content = response.choices[0]?.message?.content || '{}';
      const result = JSON.parse(content);

      return {
        isValid: result.isValid ?? true,
        criticalError: result.criticalError || undefined,
        correctionInstructions: result.correctionInstructions || undefined,
        warnings: result.warnings || [],
        newFacts: result.newFacts || [],
        newRules: result.newRules || [],
        newRelationships: result.newRelationships || []
      };
    } catch (error) {
      console.error('[UniversalConsistency] Error validando capítulo:', error);
      return { isValid: true, warnings: ['Error en validación de consistencia - continuando con fallback optimista'] };
    }
  }

  async extractInitialEntities(
    worldBibleCharacters: any[],
    worldBibleRules: any[],
    genre: string,
    projectId: number
  ): Promise<{
    entities: Array<Omit<WorldEntity, 'id' | 'createdAt' | 'updatedAt'>>;
    rules: Array<Omit<WorldRuleRecord, 'id' | 'createdAt'>>;
  }> {
    const config = getGenreConfig(genre);

    const entities: Array<Omit<WorldEntity, 'id' | 'createdAt' | 'updatedAt'>> = [];
    const rules: Array<Omit<WorldRuleRecord, 'id' | 'createdAt'>> = [];

    // LitAgents 2.1: Universal immutable physical attributes to extract
    const PHYSICAL_ATTR_KEYS = ['eyes', 'eye_color', 'ojos', 'hair', 'hair_color', 'cabello', 'height', 'altura', 'skin', 'piel', 'build', 'complexion', 'age', 'edad'];

    for (const char of worldBibleCharacters) {
      const attributes: Record<string, any> = {};
      const charName = char.name || char.nombre || 'Personaje desconocido';

      if (char.role) attributes.role = char.role;
      if (char.profile) attributes.profile = char.profile;

      // LitAgents 2.1: Extract physical attributes from appearance object (not just string)
      const appearance = char.appearance || char.aparienciaInmutable || char.apariencia;
      if (appearance) {
        if (typeof appearance === 'object' && appearance !== null) {
          // Appearance is an object - extract individual attributes with IMMUTABLE markers
          for (const [key, value] of Object.entries(appearance)) {
            if (value && typeof value === 'string') {
              const normalizedKey = key.toLowerCase();
              // Mark physical attributes as IMMUTABLE
              if (PHYSICAL_ATTR_KEYS.includes(normalizedKey)) {
                attributes[`${key}_INMUTABLE`] = value;
                // Generate rule for this immutable attribute
                rules.push({
                  projectId,
                  ruleDescription: `${charName} tiene ${key} = "${value}" (INMUTABLE - NUNCA CAMBIAR)`,
                  category: 'PHYSICAL_ATTRIBUTE',
                  isActive: true,
                  sourceChapter: 0
                });
              } else {
                attributes[key] = value;
              }
            }
          }
        } else if (typeof appearance === 'string') {
          // Appearance is a string - store as-is
          attributes.appearance = appearance;
        }
      }

      // Also check for top-level physical attributes
      for (const attrKey of PHYSICAL_ATTR_KEYS) {
        if (char[attrKey] && !attributes[`${attrKey}_INMUTABLE`]) {
          attributes[`${attrKey}_INMUTABLE`] = char[attrKey];
          rules.push({
            projectId,
            ruleDescription: `${charName} tiene ${attrKey} = "${char[attrKey]}" (INMUTABLE - NUNCA CAMBIAR)`,
            category: 'PHYSICAL_ATTRIBUTE',
            isActive: true,
            sourceChapter: 0
          });
        }
      }

      // Genre-specific tracked attributes
      for (const attrKey of config.tracked_attributes) {
        if (char[attrKey] !== undefined) {
          attributes[attrKey] = char[attrKey];
        }
      }

      entities.push({
        projectId,
        name: charName,
        type: 'CHARACTER',
        attributes,
        status: char.isAlive === false ? 'dead' : 'active',
        lastSeenChapter: 0
      });
    }

    for (const rule of worldBibleRules) {
      if (rule.rule) {
        rules.push({
          projectId,
          ruleDescription: rule.rule,
          category: rule.category || 'WORLD_RULE',
          isActive: true,
          sourceChapter: 0
        });
      }
    }

    for (const genreRule of config.critical_rules) {
      rules.push({
        projectId,
        ruleDescription: genreRule,
        category: 'GENRE_RULE',
        isActive: true,
        sourceChapter: null
      });
    }

    return { entities, rules };
  }

  formatValidationResultForRewrite(result: ValidationResult): string {
    if (result.isValid) return '';

    let feedback = `[RECHAZO] - INCONSISTENCIA DE CONTINUIDAD

ERROR CRÍTICO: ${result.criticalError}

`;

    if (result.warnings && result.warnings.length > 0) {
      feedback += `ADVERTENCIAS ADICIONALES:
${result.warnings.map(w => `- ${w}`).join('\n')}

`;
    }

    feedback += `INSTRUCCIONES DE CORRECCIÓN:
1. Lee cuidadosamente el error crítico arriba
2. Identifica las líneas específicas que violan la continuidad
3. Reescribe SOLO las secciones problemáticas, manteniendo el resto
4. Verifica que la corrección no introduzca nuevas inconsistencias

NO inventes explicaciones complicadas. Si un personaje estaba en un lugar, debe seguir ahí.
Si un personaje murió, no puede actuar. Si una coartada fue verificada, es inmutable.`;

    return feedback;
  }
}

export const universalConsistencyAgent = new UniversalConsistencyAgent();
