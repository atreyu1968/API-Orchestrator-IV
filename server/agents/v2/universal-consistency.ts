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
    const entityBlock = entities.length > 0
      ? entities.filter(e => e.type === 'CHARACTER').map(e => {
          const allAttrs = Object.entries(e.attributes || {});
          // Separate physical attributes (immutable and discovered)
          const physicalAttrs = allAttrs.filter(([k]) => 
            k.endsWith('_INMUTABLE') || 
            ['ojos', 'eyes', 'pelo', 'hair', 'cabello', 'altura', 'height', 'edad', 'age', 'piel', 'skin', 'complexion', 'cicatriz', 'scar', 'tatuaje', 'tattoo', 'barba', 'beard', 'build', 'peso', 'weight'].some(phys => k.toLowerCase().includes(phys))
          );
          const otherAttrs = allAttrs.filter(([k]) => 
            !k.endsWith('_INMUTABLE') && 
            !['ojos', 'eyes', 'pelo', 'hair', 'cabello', 'altura', 'height', 'edad', 'age', 'piel', 'skin', 'complexion', 'cicatriz', 'scar', 'tatuaje', 'tattoo', 'barba', 'beard', 'build', 'peso', 'weight'].some(phys => k.toLowerCase().includes(phys))
          );
          
          let result = `\n══════════════════════════════════════\n`;
          result += `📋 FICHA: ${e.name.toUpperCase()} (${e.status})`;
          result += `\n══════════════════════════════════════`;
          
          // Physical profile section
          if (physicalAttrs.length > 0) {
            result += `\n📐 DESCRIPCIÓN FÍSICA (OBLIGATORIO RESPETAR):`;
            physicalAttrs.forEach(([k, v]) => {
              const cleanKey = k.replace('_INMUTABLE', '').replace(/_/g, ' ');
              const isImmutable = k.endsWith('_INMUTABLE');
              const icon = isImmutable ? '🔒' : '📝';
              result += `\n   ${icon} ${cleanKey}: ${v}`;
            });
          } else {
            result += `\n📐 DESCRIPCIÓN FÍSICA: (No establecida aún - puedes describirla, será registrada)`;
          }
          
          // Other attributes (role, personality, etc.)
          if (otherAttrs.length > 0) {
            result += `\n\n👤 PERFIL:`;
            otherAttrs.forEach(([k, v]) => {
              if (typeof v === 'string' && v.length < 200) {
                result += `\n   • ${k}: ${v}`;
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
          
          let result = `\n🏛️ ${e.name.toUpperCase()}`;
          result += `\n   Estado: ${e.status}`;
          
          // Location characteristics
          const locAttrs = allAttrs.filter(([k]) => 
            ['descripcion', 'description', 'atmosfera', 'atmosphere', 'tipo', 'type', 'caracteristicas', 'features', 'acceso', 'access', 'distancia', 'distance'].some(la => k.toLowerCase().includes(la))
          );
          
          if (locAttrs.length > 0) {
            locAttrs.forEach(([k, v]) => {
              const cleanKey = k.replace('_INMUTABLE', '').replace(/_/g, ' ');
              result += `\n   • ${cleanKey}: ${v}`;
            });
          }
          
          // Current occupants
          const occupants = allAttrs.find(([k]) => k.toLowerCase().includes('ocupantes') || k.toLowerCase().includes('occupants'));
          if (occupants) {
            result += `\n   👥 Ocupantes actuales: ${occupants[1]}`;
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
        return `   • ${e.name}: ${location} (desde Cap ${lastSeen || '?'})`;
      }
      return null;
    }).filter(Boolean);

    const positionBlock = characterPositions.length > 0
      ? `\n📍 POSICIÓN ACTUAL DE PERSONAJES:\n${characterPositions.join('\n')}\n   ⚠️ Los personajes NO pueden cambiar de ubicación sin mostrar el desplazamiento`
      : '';

    const rulesBlock = rules.length > 0
      ? rules.map(r => `- [${r.category || 'GENERAL'}] ${r.ruleDescription}`).join('\n')
      : '(Sin reglas establecidas aún)';

    const relationshipsBlock = relationships.length > 0
      ? relationships.map(r => `- ${r.subject} --[${r.relationType}]--> ${r.target}`).join('\n')
      : '(Sin relaciones registradas)';

    const genreRules = config.critical_rules.map(r => `- ${r}`).join('\n');

    // NEW: Build temporal coherence block
    let temporalBlock = "";
    if (timelineInfo) {
      temporalBlock = `
🕐 COHERENCIA TEMPORAL (OBLIGATORIA):
`;
      if (timelineInfo.previous_chapter) {
        temporalBlock += `- Capítulo anterior: ${timelineInfo.previous_chapter.day}, ${timelineInfo.previous_chapter.time_of_day}`;
        if (timelineInfo.previous_chapter.location) {
          temporalBlock += ` en ${timelineInfo.previous_chapter.location}`;
        }
        temporalBlock += `\n`;
      }
      if (timelineInfo.current_chapter) {
        temporalBlock += `- Este capítulo (${chapterNumber}): ${timelineInfo.current_chapter.day}, ${timelineInfo.current_chapter.time_of_day}`;
        if (timelineInfo.current_chapter.location) {
          temporalBlock += ` en ${timelineInfo.current_chapter.location}`;
        }
        temporalBlock += `\n`;
      }
      if (timelineInfo.travel_times && timelineInfo.travel_times.length > 0) {
        temporalBlock += `\n📍 TIEMPOS DE VIAJE (respetar para transiciones):\n`;
        timelineInfo.travel_times.slice(0, 8).forEach(t => {
          const times = [t.by_car && `coche: ${t.by_car}`, t.by_plane && `avión: ${t.by_plane}`, t.by_train && `tren: ${t.by_train}`].filter(Boolean).join(', ');
          temporalBlock += `- ${t.from} → ${t.to}: ${times}\n`;
        });
      }
    }

    // NEW: Build character state block with injuries/locations
    let characterStateBlock = "";
    if (characterStates && characterStates.length > 0) {
      characterStateBlock = `
🏥 ESTADO FÍSICO DE PERSONAJES AL INICIO DEL CAPÍTULO:
`;
      characterStates.forEach(cs => {
        characterStateBlock += `- ${cs.character}:\n`;
        if (cs.current_location) characterStateBlock += `    Ubicación: ${cs.current_location}\n`;
        if (cs.physical_state) characterStateBlock += `    Estado físico: ${cs.physical_state}\n`;
        if (cs.active_injuries && cs.active_injuries.length > 0) {
          characterStateBlock += `    ⚠️ LESIONES ACTIVAS: ${cs.active_injuries.join(', ')}\n`;
          characterStateBlock += `       → Estas lesiones LIMITAN sus acciones físicas\n`;
        }
        if (cs.key_possessions && cs.key_possessions.length > 0) {
          characterStateBlock += `    Posesiones: ${cs.key_possessions.join(', ')}\n`;
        }
      });
    }

    return `
⛔ SISTEMA DE CONSISTENCIA UNIVERSAL ACTIVO (${genre.toUpperCase()})
═══════════════════════════════════════════════════════════════════

ESCRIBIENDO CAPÍTULO ${chapterNumber}. Debes respetar ESTRICTAMENTE la Base de Datos de Verdad.
El lector notará cualquier contradicción. Las violaciones causarán RECHAZO AUTOMÁTICO.

FOCO DEL GÉNERO: ${config.focus}
${temporalBlock}
${characterStateBlock}
📊 FICHAS DE PERSONAJES:
${entityBlock}
${positionBlock}
${locationBlock ? `
🏛️ LOCALIZACIONES CONOCIDAS:
${locationBlock}
` : ''}
🔗 RELACIONES ENTRE PERSONAJES:
${relationshipsBlock}

📜 HECHOS INMUTABLES ESTABLECIDOS:
${rulesBlock}

⚠️ REGLAS CRÍTICAS DEL GÉNERO (${genre}):
${genreRules}

═══════════════════════════════════════════════════════════════════
REGLAS DE MOVIMIENTO Y UBICACIÓN:
• Un personaje NO puede estar en dos lugares al mismo tiempo
• Para cambiar de ubicación, MOSTRAR el desplazamiento (caminando, en coche, etc.)
• Respetar tiempos de viaje realistas entre ubicaciones
• Las descripciones de lugares deben ser CONSISTENTES en toda la novela
• Si un lugar tiene características establecidas (color paredes, distribución), mantenerlas
═══════════════════════════════════════════════════════════════════
`;
  }

  async validateChapter(
    chapterText: string,
    genre: string,
    entities: EntityForPrompt[],
    rules: RuleForPrompt[],
    relationships: RelationshipForPrompt[],
    chapterNumber: number
  ): Promise<ValidationResult> {
    const config = getGenreConfig(genre);

    const prompt = `Actúa como un Supervisor de Continuidad PERMISIVO experto en ${genre}.
Tu trabajo es detectar SOLO errores GRAVES Y EVIDENTES, NO interpretaciones ambiguas.

PRINCIPIO FUNDAMENTAL: EN CASO DE DUDA, APROBAR. Solo rechazar por errores INEQUÍVOCOS.

BASE DE DATOS DE REFERENCIA:

ENTIDADES:
${JSON.stringify(entities, null, 2)}

REGLAS:
${JSON.stringify(rules, null, 2)}

RELACIONES:
${JSON.stringify(relationships, null, 2)}

═══════════════════════════════════════════════════════════════════

CAPÍTULO ${chapterNumber} A EVALUAR:
"""
${chapterText.substring(0, 12000)}
"""
${chapterText.length > 12000 ? '... (truncado)' : ''}

═══════════════════════════════════════════════════════════════════

CRITERIOS DE ERROR CRÍTICO (SOLO estos bloquean):

1. MUERTO QUE ACTÚA: Un personaje explícitamente muerto aparece vivo y actuando
2. BILOCACIÓN: El mismo personaje en DOS lugares FÍSICAMENTE al MISMO tiempo
3. CAMBIO FÍSICO IMPOSIBLE: Ojos azules → verdes, pelo rubio → negro (sin explicación mágica/tinte)
4. CONTRADICCIÓN DIRECTA DE TEXTO: El texto dice "A" y luego dice "no-A" sin justificación

IMPORTANTE - NO SON ERRORES CRÍTICOS:
- Variaciones de voz/habla (susurros, ronquera, afonía temporal)
- Cambios emocionales o de comportamiento
- Detalles menores de vestimenta o apariencia
- Interpretaciones ambiguas de reglas
- Evolución natural de personajes
- Diferencias estilísticas en descripciones

TAMBIÉN EXTRAE (siempre, incluso si el capítulo es válido):
- Nuevos hechos importantes para futuros capítulos
- Nuevas relaciones reveladas
- Cambios de estado (ubicación, heridas, muerte)
- DETALLES FÍSICOS NUEVOS: Si el capítulo menciona por primera vez el color de ojos, pelo, altura, edad, cicatrices, tatuajes, o cualquier rasgo físico de un personaje que NO estaba en la base de datos, EXTRÁELO como newFact con entityType="PHYSICAL_TRAIT"
- LOCALIZACIONES NUEVAS: Si aparece un lugar nuevo con descripción (edificio, habitación, ciudad), extráelo como newFact con entityType="LOCATION" incluyendo: descripcion, atmosfera, caracteristicas
- CAMBIOS DE UBICACIÓN: Si un personaje cambia de ubicación, extráelo como newFact con entityType="CHARACTER" y update: { "ubicacion_actual": "nuevo lugar" }

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

    let feedback = `⛔ RECHAZO POR INCONSISTENCIA DE CONTINUIDAD

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
