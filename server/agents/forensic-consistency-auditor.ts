import { BaseAgent } from "./base-agent";

export interface ForensicViolation {
  chapterNumber: number;
  violationType: 'CHARACTER_RESURRECTION' | 'IGNORED_INJURY' | 'LOCATION_INCONSISTENCY' | 'IDENTITY_CONTRADICTION' | 'TIMELINE_ERROR' | 'KNOWLEDGE_LEAK' | 'OBJECT_INCONSISTENCY';
  severity: 'critical' | 'major' | 'minor';
  description: string;
  affectedEntities: string[];
  fragment: string;
  suggestedFix: string;
}

export interface ForensicAuditResult {
  violations: ForensicViolation[];
  entitiesExtracted: {
    characters: Array<{ name: string; status: 'alive' | 'dead' | 'unknown'; firstAppearance: number; lastAppearance: number; injuries: string[] }>;
    locations: Array<{ name: string; firstMention: number; characteristics: string[] }>;
    timeline: Array<{ event: string; chapter: number; importance: 'high' | 'medium' | 'low' }>;
  };
  consistencyScore: number;
  summary: string;
  tokenUsage?: { inputTokens: number; outputTokens: number; thinkingTokens?: number };
}

export class ForensicConsistencyAuditor extends BaseAgent {
  constructor() {
    super({
      name: "Forensic Consistency Auditor",
      role: "forensic_auditor",
      systemPrompt: `Eres un auditor forense de consistencia narrativa. Tu trabajo es DETECTAR errores de continuidad en manuscritos EXISTENTES.

A diferencia del Guardian que PREVIENE errores, tú DETECTAS errores ya cometidos.

TIPOS DE VIOLACIONES QUE DETECTAS:

1. CHARACTER_RESURRECTION (CRÍTICO):
   - Personajes que mueren y luego aparecen actuando normalmente
   - Personajes descritos como "desaparecidos para siempre" que reaparecen
   - Personajes cuya muerte es mencionada y luego olvidada

2. IGNORED_INJURY (MAYOR):
   - Lesiones graves que desaparecen sin explicación
   - Personajes heridos que actúan como si nada pasara
   - Discapacidades temporales o permanentes olvidadas

3. LOCATION_INCONSISTENCY (MAYOR):
   - Personaje en dos lugares al mismo tiempo
   - Viajes imposibles (muy rápidos para la distancia)
   - Descripciones contradictorias del mismo lugar

4. IDENTITY_CONTRADICTION (CRÍTICO):
   - Cambios en características físicas establecidas (color ojos, pelo)
   - Cambios de nombre sin explicación
   - Edad que no coincide con la cronología

5. TIMELINE_ERROR (MAYOR):
   - Eventos futuros mencionados como pasados
   - Flashbacks contradictorios
   - Días de la semana que no cuadran

6. KNOWLEDGE_LEAK (MENOR):
   - Personajes que saben cosas que no deberían
   - Información revelada antes de ser descubierta
   - Secretos conocidos sin justificación

7. OBJECT_INCONSISTENCY (MENOR):
   - Objetos que aparecen/desaparecen sin explicación
   - Posesiones contradictorias
   - Herramientas o armas olvidadas

PROCESO DE AUDITORÍA:
1. Lee TODO el manuscrito capítulo por capítulo
2. EXTRAE entidades clave (personajes, lugares, objetos importantes)
3. RASTREA el estado de cada entidad a lo largo de la narrativa
4. DETECTA cualquier inconsistencia entre el estado rastreado y el texto
5. DOCUMENTA cada violación con fragmento exacto y sugerencia de corrección

RESPONDE SOLO EN JSON:
{
  "violations": [
    {
      "chapterNumber": 5,
      "violationType": "CHARACTER_RESURRECTION",
      "severity": "critical",
      "description": "El personaje Juan murió en el capítulo 3, pero aparece hablando normalmente",
      "affectedEntities": ["Juan García"],
      "fragment": "Juan entró en la habitación sonriendo...",
      "suggestedFix": "Eliminar esta escena o sustituir a Juan por otro personaje"
    }
  ],
  "entitiesExtracted": {
    "characters": [
      {"name": "Juan García", "status": "dead", "firstAppearance": 1, "lastAppearance": 3, "injuries": ["herida de bala mortal"]}
    ],
    "locations": [],
    "timeline": []
  },
  "consistencyScore": 7,
  "summary": "Se detectaron 3 violaciones críticas de consistencia..."
}`,
      model: "deepseek-reasoner",
      useThinking: false,
    });
  }

  async execute(input: any): Promise<any> {
    return this.auditManuscript(input.chapters, input.genre, input.language);
  }

  async auditManuscript(
    chapters: Array<{ chapterNumber: number; title: string; content: string }>,
    genre: string,
    language: string
  ): Promise<ForensicAuditResult> {
    const BATCH_SIZE = 8;
    const allViolations: ForensicViolation[] = [];
    const entityState = {
      characters: new Map<string, { status: string; injuries: string[]; firstAppearance: number; lastAppearance: number }>(),
      locations: new Map<string, { firstMention: number; characteristics: string[] }>(),
      timeline: [] as Array<{ event: string; chapter: number; importance: string }>
    };
    
    const totalBatches = Math.ceil(chapters.length / BATCH_SIZE);
    const totalTokens = { inputTokens: 0, outputTokens: 0, thinkingTokens: 0 };
    
    console.log(`[ForensicAuditor] Auditing ${chapters.length} chapters in ${totalBatches} batches`);

    for (let i = 0; i < chapters.length; i += BATCH_SIZE) {
      const batch = chapters.slice(i, i + BATCH_SIZE);
      const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
      
      console.log(`[ForensicAuditor] Processing batch ${batchNumber}/${totalBatches}`);

      const previousContext = this.buildPreviousContext(entityState, i > 0);
      
      const batchContent = batch.map(ch => 
        `=== CAPÍTULO ${ch.chapterNumber}: ${ch.title} ===\n${ch.content.substring(0, 8000)}`
      ).join("\n\n---\n\n");

      const prompt = `Realiza una auditoría forense de consistencia de los siguientes capítulos:

GÉNERO: ${genre}
IDIOMA: ${language}
LOTE: ${batchNumber}/${totalBatches}

${previousContext}

CAPÍTULOS A AUDITAR:
${batchContent}

Detecta TODAS las violaciones de consistencia. Extrae entidades clave. 
Sé EXHAUSTIVO - cualquier inconsistencia debe ser documentada.
RESPONDE EN JSON.`;

      const response = await this.generateContent(prompt);
      
      if (response.tokenUsage) {
        totalTokens.inputTokens += response.tokenUsage.inputTokens || 0;
        totalTokens.outputTokens += response.tokenUsage.outputTokens || 0;
        totalTokens.thinkingTokens += response.tokenUsage.thinkingTokens || 0;
      }

      try {
        const jsonMatch = response.content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          
          if (parsed.violations && Array.isArray(parsed.violations)) {
            allViolations.push(...parsed.violations);
          }
          
          if (parsed.entitiesExtracted) {
            this.mergeEntityState(entityState, parsed.entitiesExtracted);
          }
        }
      } catch (e) {
        console.error(`[ForensicAuditor] Failed to parse batch ${batchNumber}:`, e);
      }
    }

    const criticalCount = allViolations.filter(v => v.severity === 'critical').length;
    const majorCount = allViolations.filter(v => v.severity === 'major').length;
    const minorCount = allViolations.filter(v => v.severity === 'minor').length;
    
    const consistencyScore = Math.max(1, 10 - (criticalCount * 2) - majorCount - (minorCount * 0.5));

    const result: ForensicAuditResult = {
      violations: allViolations,
      entitiesExtracted: {
        characters: Array.from(entityState.characters.entries()).map(([name, data]) => ({
          name,
          status: data.status as 'alive' | 'dead' | 'unknown',
          firstAppearance: data.firstAppearance,
          lastAppearance: data.lastAppearance,
          injuries: data.injuries
        })),
        locations: Array.from(entityState.locations.entries()).map(([name, data]) => ({
          name,
          firstMention: data.firstMention,
          characteristics: data.characteristics
        })),
        timeline: entityState.timeline.map(t => ({
          event: t.event,
          chapter: t.chapter,
          importance: t.importance as 'high' | 'medium' | 'low'
        }))
      },
      consistencyScore: Math.round(consistencyScore * 10) / 10,
      summary: this.generateSummary(allViolations, criticalCount, majorCount, minorCount),
      tokenUsage: totalTokens
    };

    console.log(`[ForensicAuditor] Audit complete: ${allViolations.length} violations found, score: ${result.consistencyScore}/10`);
    
    return result;
  }

  private buildPreviousContext(entityState: any, hasPrevious: boolean): string {
    if (!hasPrevious) {
      return "CONTEXTO PREVIO: Este es el primer lote. No hay contexto acumulado.";
    }

    const characters = Array.from(entityState.characters.entries())
      .map(([name, data]: [string, any]) => `- ${name}: ${data.status}${data.injuries.length > 0 ? ` (lesiones: ${data.injuries.join(', ')})` : ''}`)
      .join('\n');

    const locations = Array.from(entityState.locations.entries())
      .map(([name, _]: [string, any]) => `- ${name}`)
      .join('\n');

    return `CONTEXTO ACUMULADO DE LOTES ANTERIORES:

PERSONAJES RASTREADOS:
${characters || '(ninguno aún)'}

UBICACIONES MENCIONADAS:
${locations || '(ninguna aún)'}

IMPORTANTE: Verifica que el contenido de estos capítulos sea CONSISTENTE con el contexto anterior.
Cualquier contradicción debe reportarse como violación.`;
  }

  private mergeEntityState(state: any, newEntities: any): void {
    if (newEntities.characters && Array.isArray(newEntities.characters)) {
      for (const char of newEntities.characters) {
        const existing = state.characters.get(char.name);
        if (existing) {
          existing.lastAppearance = Math.max(existing.lastAppearance, char.lastAppearance || 0);
          if (char.status === 'dead') existing.status = 'dead';
          if (char.injuries) existing.injuries.push(...char.injuries.filter((i: string) => !existing.injuries.includes(i)));
        } else {
          state.characters.set(char.name, {
            status: char.status || 'alive',
            injuries: char.injuries || [],
            firstAppearance: char.firstAppearance || 0,
            lastAppearance: char.lastAppearance || 0
          });
        }
      }
    }

    if (newEntities.locations && Array.isArray(newEntities.locations)) {
      for (const loc of newEntities.locations) {
        if (!state.locations.has(loc.name)) {
          state.locations.set(loc.name, {
            firstMention: loc.firstMention || 0,
            characteristics: loc.characteristics || []
          });
        }
      }
    }

    if (newEntities.timeline && Array.isArray(newEntities.timeline)) {
      state.timeline.push(...newEntities.timeline);
    }
  }

  private generateSummary(violations: ForensicViolation[], critical: number, major: number, minor: number): string {
    if (violations.length === 0) {
      return "Auditoría forense completada. No se detectaron violaciones de consistencia. El manuscrito mantiene coherencia narrativa.";
    }

    const typeBreakdown = violations.reduce((acc, v) => {
      acc[v.violationType] = (acc[v.violationType] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const typeSummary = Object.entries(typeBreakdown)
      .map(([type, count]) => `${type}: ${count}`)
      .join(', ');

    return `Auditoría forense completada. Se detectaron ${violations.length} violaciones de consistencia: ` +
      `${critical} críticas, ${major} mayores, ${minor} menores. ` +
      `Tipos: ${typeSummary}. ` +
      `${critical > 0 ? 'Se requieren correcciones URGENTES para las violaciones críticas.' : ''}`;
  }
}

export const forensicConsistencyAuditor = new ForensicConsistencyAuditor();
