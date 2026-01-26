import OpenAI from 'openai';
import { getGenreConfig, GenreTrackingConfig } from './genre-definitions';
import type { WorldEntity, WorldRuleRecord, EntityRelationship } from '@shared/schema';

interface ValidationResult {
  isValid: boolean;
  criticalError?: string;
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
    chapterNumber: number
  ): string {
    const config = getGenreConfig(genre);

    const entityBlock = entities.length > 0
      ? entities.map(e => {
          const attrs = Object.entries(e.attributes || {})
            .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
            .join(', ');
          return `- [${e.type}] ${e.name} (${e.status}): ${attrs || 'sin atributos'}`;
        }).join('\n')
      : '(Sin entidades registradas aún)';

    const rulesBlock = rules.length > 0
      ? rules.map(r => `- [${r.category || 'GENERAL'}] ${r.ruleDescription}`).join('\n')
      : '(Sin reglas establecidas aún)';

    const relationshipsBlock = relationships.length > 0
      ? relationships.map(r => `- ${r.subject} --[${r.relationType}]--> ${r.target}`).join('\n')
      : '(Sin relaciones registradas)';

    const genreRules = config.critical_rules.map(r => `- ${r}`).join('\n');

    return `
⛔ SISTEMA DE CONSISTENCIA UNIVERSAL ACTIVO (${genre.toUpperCase()})
═══════════════════════════════════════════════════════════════════

ESCRIBIENDO CAPÍTULO ${chapterNumber}. Debes respetar ESTRICTAMENTE la Base de Datos de Verdad.
El lector notará cualquier contradicción. Las violaciones causarán RECHAZO AUTOMÁTICO.

FOCO DEL GÉNERO: ${config.focus}

📊 ESTADO ACTUAL DE PERSONAJES Y OBJETOS:
${entityBlock}

🔗 RELACIONES ENTRE PERSONAJES:
${relationshipsBlock}

📜 HECHOS INMUTABLES ESTABLECIDOS:
${rulesBlock}

⚠️ REGLAS CRÍTICAS DEL GÉNERO (${genre}):
${genreRules}

═══════════════════════════════════════════════════════════════════
ANTES DE ESCRIBIR CUALQUIER ESCENA, VERIFICA:
1. ¿Los personajes muertos siguen muertos?
2. ¿Las coartadas/alibis establecidos se respetan?
3. ¿Las ubicaciones son físicamente posibles?
4. ¿Los roles de personajes (detective, víctima, sospechoso) son consistentes?
5. ¿No hay anacronismos o tecnología imposible para la época?
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

    const prompt = `Actúa como un Supervisor de Continuidad (Script Supervisor) experto en ${genre}.
Tu trabajo es detectar CONTRADICCIONES LÓGICAS en el texto generado.

BASE DE DATOS DE VERDAD (Estado ANTES de este capítulo):

ENTIDADES:
${JSON.stringify(entities, null, 2)}

REGLAS INMUTABLES:
${JSON.stringify(rules, null, 2)}

RELACIONES:
${JSON.stringify(relationships, null, 2)}

REGLAS CRÍTICAS DEL GÉNERO:
${JSON.stringify(config.critical_rules, null, 2)}

═══════════════════════════════════════════════════════════════════

CAPÍTULO ${chapterNumber} A EVALUAR:
"""
${chapterText.substring(0, 12000)}
"""
${chapterText.length > 12000 ? '... (truncado)' : ''}

═══════════════════════════════════════════════════════════════════

TAREA DE AUDITORÍA:

1. CONTRADICCIONES DIRECTAS: ¿Hay personajes muertos que actúan? ¿Coartadas rotas? ¿Ubicaciones imposibles?
2. INCONSISTENCIAS DE ROL: ¿Un personaje cambia de rol sin explicación (ej: de forense a sospechoso)?
3. INCONSISTENCIAS DE IDENTIDAD: ¿Se confunden personajes? ¿Cambian atributos físicos?
4. VIOLACIONES DE REGLAS: ¿Se rompen las reglas físicas/mágicas/históricas del mundo?
5. ANACRONISMOS: ¿Hay tecnología, objetos o expresiones que no pertenecen a la época?

TAMBIÉN EXTRAE:
- Nuevos hechos importantes que deben registrarse para futuros capítulos
- Nuevas relaciones entre personajes reveladas
- Cambios de estado de personajes (ubicación, heridas, muerte, etc.)

RESPONDE EN JSON:
{
  "isValid": boolean,
  "criticalError": "Descripción del error crítico que BLOQUEA la aprobación, o null si no hay",
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
}`;

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

    for (const char of worldBibleCharacters) {
      const attributes: Record<string, any> = {};

      if (char.role) attributes.role = char.role;
      if (char.aparienciaInmutable) {
        attributes.appearance = char.aparienciaInmutable;
      }
      if (char.appearance) {
        attributes.appearance = char.appearance;
      }
      if (char.profile) attributes.profile = char.profile;

      for (const attrKey of config.tracked_attributes) {
        if (char[attrKey] !== undefined) {
          attributes[attrKey] = char[attrKey];
        }
      }

      entities.push({
        projectId,
        name: char.name,
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
