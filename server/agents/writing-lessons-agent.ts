import { BaseAgent } from "./base-agent";
import { storage } from "../storage";
import type { WritingLesson, InsertWritingLesson } from "@shared/schema";

interface AuditIssue {
  categoria: string;
  severidad: string;
  descripcion: string;
  instrucciones_correccion?: string;
  capitulos_afectados?: number[];
}

interface ProjectAuditData {
  projectId: number;
  title: string;
  genre: string;
  issues: AuditIssue[];
  puntuacion_global: number;
}

interface ExtractedLesson {
  category: string;
  lesson: string;
  rationale: string;
  bad_example?: string;
  good_example?: string;
  severity_weight: number;
}

const SYSTEM_PROMPT = `Eres un analista experto en calidad narrativa. Tu trabajo es examinar los errores detectados en auditorías de múltiples novelas y extraer LECCIONES GENERALIZABLES que se puedan aplicar a CUALQUIER novela futura.

REGLAS CRÍTICAS:
1. NO incluyas nombres de personajes, lugares o tramas específicas en las lecciones.
2. Las lecciones deben ser UNIVERSALES, aplicables a cualquier género y estilo.
3. Agrupa errores similares en UNA SOLA lección (no repitas).
4. Prioriza las lecciones por frecuencia y severidad.
5. Cada lección debe ser ACCIONABLE: el escritor debe poder aplicarla directamente.
6. Incluye ejemplos genéricos (malo vs bueno) cuando sea posible.
7. Máximo 20 lecciones - solo las más importantes y recurrentes.

CATEGORÍAS VÁLIDAS:
- repeticion_lexica: Palabras, frases o rasgos físicos repetidos en exceso
- continuidad: Inconsistencias en hechos, ubicaciones, objetos o estado de personajes
- estructura: Problemas con prólogos, epílogos, orden de capítulos, spoilers
- personajes: Arcos incompletos, cambios de personalidad injustificados, apariciones/desapariciones
- ritmo: Problemas de pacing, relleno, escenas sin propósito
- dialogo: Acotaciones telling vs showing, diálogos artificiales
- temporal: Inconsistencias en línea temporal, cronología rota
- atmosfera: Títulos que no encajan, tono inconsistente
- trama: Deus ex machina, agujeros de guion, resoluciones forzadas
- transiciones: Saltos geográficos o temporales sin explicar

FORMATO DE RESPUESTA (JSON):
{
  "lessons": [
    {
      "category": "repeticion_lexica",
      "lesson": "Descripción concisa de la regla a seguir",
      "rationale": "Por qué es importante, basado en los errores observados",
      "bad_example": "Ejemplo genérico de lo que NO hacer",
      "good_example": "Ejemplo genérico de lo que SÍ hacer",
      "severity_weight": 8
    }
  ]
}`;

export class WritingLessonsAgent extends BaseAgent {
  constructor() {
    super({
      name: "Agente de Lecciones de Escritura",
      role: "writing-lessons",
      systemPrompt: SYSTEM_PROMPT,
      model: "deepseek-chat",
      useThinking: false,
    });
  }

  async execute(input: any): Promise<any> {
    return this.refreshLessons();
  }

  async analyzeAndExtractLessons(): Promise<{ lessons: ExtractedLesson[]; projectsAnalyzed: number }> {
    const allProjects = await storage.getAllProjects();
    const auditData: ProjectAuditData[] = [];

    console.log(`[WritingLessonsAgent] Scanning ${allProjects.length} total projects for audit data...`);

    for (const project of allProjects) {
      if (!project.finalReviewResult) {
        console.log(`[WritingLessonsAgent] Project ${project.id} "${project.title}": no finalReviewResult, skipping`);
        continue;
      }
      const review = project.finalReviewResult as any;
      const issues: AuditIssue[] = [];

      if (review.issues && Array.isArray(review.issues) && review.issues.length > 0) {
        issues.push(...review.issues);
      }

      if (review.justificacion_puntuacion?.debilidades_principales) {
        const debilidades = review.justificacion_puntuacion.debilidades_principales as string[];
        for (const d of debilidades) {
          const alreadyCovered = issues.some(i => i.descripcion && d.includes(i.descripcion.substring(0, 30)));
          if (!alreadyCovered) {
            issues.push({
              categoria: "calidad_general",
              severidad: "menor",
              descripcion: d,
            });
          }
        }
      }

      if (review.justificacion_puntuacion?.recomendaciones_proceso) {
        const recs = review.justificacion_puntuacion.recomendaciones_proceso as string[];
        for (const r of recs) {
          issues.push({
            categoria: "proceso",
            severidad: "menor",
            descripcion: r,
          });
        }
      }

      if (issues.length === 0) {
        console.log(`[WritingLessonsAgent] Project ${project.id} "${project.title}": finalReviewResult exists but no issues/debilidades found (keys: ${Object.keys(review).join(", ")})`);
        continue;
      }

      console.log(`[WritingLessonsAgent] Project ${project.id} "${project.title}": found ${issues.length} issues/insights`);
      auditData.push({
        projectId: project.id,
        title: project.title,
        genre: project.genre,
        issues,
        puntuacion_global: review.puntuacion_global || 0,
      });
    }

    if (auditData.length === 0) {
      console.log("[WritingLessonsAgent] No audit data found to analyze across any projects");
      return { lessons: [], projectsAnalyzed: 0 };
    }

    console.log(`[WritingLessonsAgent] Analyzing audits from ${auditData.length} projects`);

    const issuesSummary = auditData.map(p => {
      const issueLines = p.issues.map(i => 
        `  - [${i.severidad}] ${i.categoria}: ${i.descripcion}${i.instrucciones_correccion ? ` → Corrección: ${i.instrucciones_correccion}` : ''}`
      ).join("\n");
      return `Proyecto "${p.title}" (${p.genre}, puntuación: ${p.puntuacion_global}/10):\n${issueLines}`;
    }).join("\n\n");

    const prompt = `Analiza los siguientes errores detectados en ${auditData.length} auditorías de novelas completadas.
Extrae LECCIONES GENERALIZABLES que cualquier escritor debería seguir para evitar estos problemas en futuras novelas.

ERRORES DETECTADOS EN AUDITORÍAS:
═══════════════════════════════════════
${issuesSummary}
═══════════════════════════════════════

Recuerda:
- Generaliza los errores específicos en reglas universales
- No menciones nombres de personajes, lugares o tramas concretas
- Agrupa errores similares de distintos proyectos en una sola lección
- Prioriza por frecuencia (si el mismo error aparece en 3+ proyectos, es más importante)
- severity_weight de 1 (menor) a 10 (crítico)

Responde SOLO con JSON válido.`;

    const result = await this.generateContent(prompt);

    if (result.error) {
      console.error("[WritingLessonsAgent] Error generating lessons:", result.error);
      return { lessons: [], projectsAnalyzed: auditData.length };
    }

    try {
      const content = result.content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      const parsed = JSON.parse(content);
      const lessons: ExtractedLesson[] = (parsed.lessons || []).map((l: any) => ({
        category: l.category || "otro",
        lesson: l.lesson || "",
        rationale: l.rationale || "",
        bad_example: l.bad_example || null,
        good_example: l.good_example || null,
        severity_weight: Math.min(10, Math.max(1, l.severity_weight || 5)),
      }));

      console.log(`[WritingLessonsAgent] Extracted ${lessons.length} lessons from ${auditData.length} projects`);
      return { lessons, projectsAnalyzed: auditData.length };
    } catch (err) {
      console.error("[WritingLessonsAgent] Failed to parse lessons JSON:", err);
      console.error("[WritingLessonsAgent] Raw content:", result.content.substring(0, 500));
      return { lessons: [], projectsAnalyzed: auditData.length };
    }
  }

  async refreshLessons(): Promise<{ created: number; projectsAnalyzed: number }> {
    const { lessons, projectsAnalyzed } = await this.analyzeAndExtractLessons();
    
    if (lessons.length === 0) {
      return { created: 0, projectsAnalyzed };
    }

    const allProjects = await storage.getAllProjects();
    const projectsWithAudits = allProjects
      .filter(p => {
        if (!p.finalReviewResult) return false;
        const r = p.finalReviewResult as any;
        return (r.issues?.length > 0) || 
               (r.justificacion_puntuacion?.debilidades_principales?.length > 0) ||
               (r.justificacion_puntuacion?.recomendaciones_proceso?.length > 0);
      })
      .map(p => p.id);

    await storage.deleteAllWritingLessons();

    let created = 0;
    for (const lesson of lessons) {
      await storage.createWritingLesson({
        category: lesson.category,
        lesson: lesson.lesson,
        rationale: lesson.rationale,
        badExample: lesson.bad_example || null,
        goodExample: lesson.good_example || null,
        severityWeight: lesson.severity_weight,
        evidenceCount: projectsAnalyzed,
        sourceProjectIds: projectsWithAudits,
        isActive: true,
      });
      created++;
    }

    console.log(`[WritingLessonsAgent] Refreshed: ${created} lessons from ${projectsAnalyzed} projects`);
    return { created, projectsAnalyzed };
  }

  static formatLessonsForGhostwriter(lessons: WritingLesson[]): string {
    if (!lessons || lessons.length === 0) return "";

    const parts: string[] = [
      "╔══════════════════════════════════════════════════════════════════╗",
      "║  LECCIONES APRENDIDAS DE AUDITORÍAS ANTERIORES                 ║",
      "║  (Errores detectados en novelas previas - NO REPETIR)          ║",
      "╠══════════════════════════════════════════════════════════════════╣",
    ];

    const byCategory = new Map<string, WritingLesson[]>();
    for (const l of lessons) {
      if (!byCategory.has(l.category)) byCategory.set(l.category, []);
      byCategory.get(l.category)!.push(l);
    }

    const categoryLabels: Record<string, string> = {
      repeticion_lexica: "REPETICIÓN LÉXICA",
      continuidad: "CONTINUIDAD",
      estructura: "ESTRUCTURA",
      personajes: "PERSONAJES",
      ritmo: "RITMO",
      dialogo: "DIÁLOGO",
      temporal: "TEMPORAL",
      atmosfera: "ATMÓSFERA",
      trama: "TRAMA",
      transiciones: "TRANSICIONES",
    };

    for (const [cat, catLessons] of Array.from(byCategory.entries())) {
      const label = categoryLabels[cat] || cat.toUpperCase();
      parts.push(`║`);
      parts.push(`║ ── ${label} ──`);
      for (const l of catLessons) {
        parts.push(`║   • ${l.lesson}`);
        if (l.badExample) parts.push(`║     ✗ MAL: ${l.badExample}`);
        if (l.goodExample) parts.push(`║     ✓ BIEN: ${l.goodExample}`);
      }
    }

    parts.push("╠══════════════════════════════════════════════════════════════════╣");
    parts.push("║ Aplica estas lecciones en CADA capítulo que escribas.           ║");
    parts.push("╚══════════════════════════════════════════════════════════════════╝");

    return parts.join("\n");
  }
}
