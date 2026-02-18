import { storage } from "../storage";

export interface ObjectiveMetric {
  name: string;
  label: string;
  score: number;
  maxScore: number;
  weight: number;
  details: string;
  issues: string[];
}

export interface ObjectiveEvaluationResult {
  totalScore: number;
  maxPossibleScore: number;
  percentage: number;
  verdict: "PUBLICABLE" | "CASI_PUBLICABLE" | "NECESITA_TRABAJO";
  metrics: ObjectiveMetric[];
  summary: string;
  blockers: string[];
  recommendations: string[];
}

interface EvaluationInput {
  projectId: number;
  chapters: Array<{
    chapterNumber: number;
    title: string;
    content: string;
    wordCount: number;
  }>;
  genre: string;
  hasPrologue: boolean;
  hasEpilogue: boolean;
}

function extractProtagonistName(worldBible: any): string {
  if (!worldBible) return "";

  if (worldBible.protagonista?.nombre) return worldBible.protagonista.nombre;
  if (worldBible.protagonist?.name) return worldBible.protagonist.name;

  const chars: any[] = worldBible.personajes || worldBible.characters || [];
  if (Array.isArray(chars) && chars.length > 0) {
    const protag = chars.find((c: any) =>
      c.rol === "protagonista" || c.role === "protagonist" ||
      c.rol === "principal" || c.role === "main"
    );
    if (protag) return protag.nombre || protag.name || "";
    return chars[0]?.nombre || chars[0]?.name || "";
  }

  return "";
}

export async function runObjectiveEvaluation(input: EvaluationInput): Promise<ObjectiveEvaluationResult> {
  const { projectId, chapters, genre, hasPrologue, hasEpilogue } = input;

  const metrics: ObjectiveMetric[] = [];
  const blockers: string[] = [];

  const regularChapters = chapters.filter(c =>
    c.chapterNumber !== 0 && c.chapterNumber !== 998 && c.chapterNumber !== 999
  );

  // === METRIC 1: NARRATIVE COHERENCE (consistency violations) ===
  const allViolations = await storage.getConsistencyViolationsByProject(projectId);
  const pendingViolations = allViolations.filter(v => v.status === "pending");
  const criticalViolations = pendingViolations.filter(v => v.severity === "critical");
  const deathViolations = pendingViolations.filter(v => v.violationType === "DEAD_CHARACTER_ACTS");
  const majorViolations = pendingViolations.filter(v => v.severity === "major");

  let coherenceScore = 10;
  const coherenceIssues: string[] = [];
  const formatChapLabel = (num: number) => num === 0 ? 'Prólogo' : num === 998 ? 'Epílogo' : num === 999 ? 'Nota del Autor' : `Cap ${num}`;

  if (deathViolations.length > 0) {
    coherenceScore = 0;
    blockers.push(`${deathViolations.length} personaje(s) muerto(s) que aparecen vivos en capítulos posteriores`);
    for (const v of deathViolations.slice(0, 5)) {
      coherenceIssues.push(`${formatChapLabel(v.chapterNumber)}: ${v.description.substring(0, 120)}`);
    }
  }
  const nonDeathCritical = criticalViolations.filter(v => v.violationType !== "DEAD_CHARACTER_ACTS");
  if (nonDeathCritical.length > 0) {
    coherenceScore = Math.max(0, coherenceScore - Math.min(nonDeathCritical.length * 3, 8));
    for (const v of nonDeathCritical.slice(0, 3)) {
      coherenceIssues.push(`[CRÍTICO] ${formatChapLabel(v.chapterNumber)}: ${v.description.substring(0, 120)}`);
    }
  }
  if (majorViolations.length > 0) {
    coherenceScore = Math.max(0, coherenceScore - Math.min(majorViolations.length, 4));
    for (const v of majorViolations.slice(0, 3)) {
      coherenceIssues.push(`[MAYOR] ${formatChapLabel(v.chapterNumber)}: ${v.description.substring(0, 120)}`);
    }
  }

  metrics.push({
    name: "narrative_coherence",
    label: "Coherencia Narrativa",
    score: Math.max(0, Math.min(10, coherenceScore)),
    maxScore: 10,
    weight: 25,
    details: pendingViolations.length === 0
      ? "Sin violaciones de continuidad detectadas"
      : `${pendingViolations.length} violaciones pendientes (${criticalViolations.length} críticas, ${deathViolations.length} muertes)`,
    issues: coherenceIssues,
  });

  // === METRIC 2: PLOT COMPLETENESS (unresolved threads) ===
  // LitAgents 3.2: Content-based verification for threads marked as "active" in DB
  // The DB status may be stale if auto-update didn't detect resolution or final review closed them
  const plotThreads = await storage.getPlotThreadsByProject(projectId);
  let activeThreads = plotThreads.filter(t => t.status === "active" || t.status === "developing");
  let resolvedThreads = plotThreads.filter(t => t.status === "resolved");
  const totalThreads = plotThreads.length;

  // Content-based fallback: check last 5 chapters for thread resolution keywords
  if (activeThreads.length > 0 && chapters.length > 0) {
    const lastChapters = chapters
      .filter(c => c.content && c.content.length > 100)
      .sort((a, b) => (a.chapterNumber || 0) - (b.chapterNumber || 0))
      .slice(-5);
    const lastChaptersText = lastChapters.map(c => (c.content || '').toLowerCase()).join(' ');

    const resolutionKeywords = [
      'resuelve', 'resuelto', 'resolvió', 'concluye', 'concluyó', 'cierra', 'cerró',
      'desenlace', 'se completa', 'pone fin', 'revelación', 'verdad', 'final',
      'destino', 'consecuencia', 'muerte', 'muere', 'murió', 'sacrificio', 'sacrifica',
      'traición', 'venganza', 'justicia', 'castigo', 'redención', 'perdón',
    ];

    const stillActive: typeof activeThreads = [];
    for (const thread of activeThreads) {
      const threadWords = [
        ...(thread.name || '').toLowerCase().split(/\s+/),
        ...(thread.goal || '').toLowerCase().split(/\s+/),
        ...(thread.description || '').toLowerCase().split(/\s+/),
      ].filter(w => w.length >= 4);
      const uniqueWords = Array.from(new Set(threadWords)).slice(0, 8);

      const textMatches = uniqueWords.filter(w => lastChaptersText.includes(w)).length;
      const hasResolutionNearby = resolutionKeywords.some(rk => {
        const idx = lastChaptersText.indexOf(rk);
        if (idx < 0) return false;
        const nearby = lastChaptersText.substring(Math.max(0, idx - 300), Math.min(lastChaptersText.length, idx + 300));
        return uniqueWords.filter(w => nearby.includes(w)).length >= 2;
      });

      if (textMatches >= 2 && hasResolutionNearby) {
        resolvedThreads.push(thread);
        console.log(`[ObjectiveEvaluator] Thread "${thread.name}" detected as content-resolved in final chapters (DB status was: ${thread.status})`);
      } else {
        stillActive.push(thread);
      }
    }
    activeThreads = stillActive;
  }

  let plotScore = 10;
  const plotIssues: string[] = [];
  if (totalThreads > 0) {
    const resolutionRate = resolvedThreads.length / totalThreads;
    plotScore = Math.round(resolutionRate * 10);

    if (activeThreads.length > 0) {
      if (activeThreads.length >= 3) {
        blockers.push(`${activeThreads.length} hilos argumentales sin resolver`);
      }
      for (const t of activeThreads.slice(0, 5)) {
        plotIssues.push(`Hilo sin resolver: "${t.name}" - ${t.description?.substring(0, 80) || "sin descripción"}`);
      }
    }
  }

  metrics.push({
    name: "plot_completeness",
    label: "Completitud de Trama",
    score: Math.max(0, Math.min(10, plotScore)),
    maxScore: 10,
    weight: 20,
    details: totalThreads === 0
      ? "Sin hilos registrados (verificar manualmente)"
      : `${resolvedThreads.length}/${totalThreads} hilos resueltos, ${activeThreads.length} pendientes`,
    issues: plotIssues,
  });

  // === METRIC 3: ADEQUATE LENGTH ===
  const totalWords = chapters.reduce((sum, c) => sum + (c.wordCount || 0), 0);
  const avgWordsPerChapter = regularChapters.length > 0
    ? Math.round(totalWords / regularChapters.length)
    : 0;

  const genreMinWords: Record<string, number> = {
    fantasy: 60000, thriller: 50000, romance: 45000, mystery: 50000,
    historical: 55000, scifi: 55000, horror: 45000, literary: 50000,
  };
  const minWords = genreMinWords[genre] || 50000;
  const shortChapters = regularChapters.filter(c => (c.wordCount || 0) < 800);

  let lengthScore = 10;
  const lengthIssues: string[] = [];

  if (totalWords < minWords * 0.7) {
    lengthScore = 3;
    blockers.push(`Novela demasiado corta: ${totalWords.toLocaleString()} palabras (mínimo: ${minWords.toLocaleString()})`);
    lengthIssues.push(`Total: ${totalWords.toLocaleString()} palabras, muy por debajo del mínimo para ${genre}`);
  } else if (totalWords < minWords) {
    lengthScore = 6;
    lengthIssues.push(`Total: ${totalWords.toLocaleString()} palabras, ligeramente bajo para ${genre} (mín: ${minWords.toLocaleString()})`);
  }

  if (shortChapters.length > 0) {
    const shortPenalty = Math.min(Math.ceil(shortChapters.length / 3), 3);
    lengthScore = Math.max(3, lengthScore - shortPenalty);
    for (const c of shortChapters.slice(0, 3)) {
      lengthIssues.push(`Cap ${c.chapterNumber}: solo ${c.wordCount} palabras (muy corto)`);
    }
    if (shortChapters.length > 3) {
      lengthIssues.push(`...y ${shortChapters.length - 3} capítulos cortos más`);
    }
  }

  const chapterWordCounts = regularChapters.map(c => c.wordCount || 0);
  if (chapterWordCounts.length > 2) {
    const mean = totalWords / regularChapters.length;
    const variance = chapterWordCounts.reduce((sum, w) => sum + Math.pow(w - mean, 2), 0) / chapterWordCounts.length;
    const stdDev = Math.sqrt(variance);
    const cv = mean > 0 ? stdDev / mean : 0;
    if (cv > 0.5) {
      lengthScore = Math.max(3, lengthScore - 2);
      lengthIssues.push(`Alta variabilidad en longitud de capítulos (CV: ${(cv * 100).toFixed(0)}%). Rango: ${Math.min(...chapterWordCounts)}-${Math.max(...chapterWordCounts)} palabras`);
    }
  }

  metrics.push({
    name: "adequate_length",
    label: "Extensión Adecuada",
    score: Math.max(0, Math.min(10, lengthScore)),
    maxScore: 10,
    weight: 10,
    details: `${totalWords.toLocaleString()} palabras en ${chapters.length} capítulos (media: ${avgWordsPerChapter.toLocaleString()}/cap)`,
    issues: lengthIssues,
  });

  // === METRIC 4: PROSE QUALITY (audit issues from pipeline) ===
  const activityLogs = await storage.getActivityLogsByProject(projectId);

  const omniwriterWarnings = activityLogs.filter(l =>
    l.agentRole === "omniwriter" && l.level === "warn" && l.message?.includes("errores menores pendientes")
  );
  const chaptersWithPendingErrors = omniwriterWarnings.length;

  let proseScore = 10;
  const proseIssues: string[] = [];

  const pendingErrorRatio = regularChapters.length > 0
    ? chaptersWithPendingErrors / regularChapters.length
    : 0;

  if (pendingErrorRatio > 0.5) {
    proseScore = 5;
    proseIssues.push(`${chaptersWithPendingErrors}/${regularChapters.length} capítulos con errores de estilo sin resolver`);
  } else if (pendingErrorRatio > 0.3) {
    proseScore = 7;
    proseIssues.push(`${chaptersWithPendingErrors}/${regularChapters.length} capítulos con errores de estilo menores`);
  } else if (pendingErrorRatio > 0.1) {
    proseScore = 8;
  }

  const repetitionLogs = activityLogs.filter(l =>
    l.message?.includes("repetición textual") || l.message?.includes("REPETICIÓN")
  );
  if (repetitionLogs.length > 0) {
    const repPenalty = Math.min(repetitionLogs.length * 2, 4);
    proseScore = Math.max(2, proseScore - repPenalty);
    blockers.push(`${repetitionLogs.length} capítulo(s) con repetición textual detectada`);
    for (const r of repetitionLogs.slice(0, 3)) {
      proseIssues.push(r.message?.substring(0, 120) || "Repetición textual");
    }
  }

  metrics.push({
    name: "prose_quality",
    label: "Calidad de Prosa",
    score: Math.max(0, Math.min(10, proseScore)),
    maxScore: 10,
    weight: 15,
    details: chaptersWithPendingErrors === 0
      ? "Todos los capítulos pasaron la auditoría de estilo"
      : `${chaptersWithPendingErrors} capítulos con issues de estilo pendientes`,
    issues: proseIssues,
  });

  // === METRIC 5: NARRATIVE STRUCTURE (turning points, climax) ===
  let structureScore = 10;
  const structureIssues: string[] = [];

  const finalStructuralLog = activityLogs.find(l =>
    l.agentRole === "structural-checkpoint" && l.message?.includes("Revisión final:")
  );

  if (finalStructuralLog?.message) {
    const scoreMatch = finalStructuralLog.message.match(/(\d+)\/10/);
    const deviatedMatch = finalStructuralLog.message.match(/(\d+) capítulos con desviaciones graves/);
    if (scoreMatch) {
      structureScore = parseInt(scoreMatch[1]);
    }
    if (deviatedMatch) {
      const deviatedCount = parseInt(deviatedMatch[1]);
      if (deviatedCount > regularChapters.length * 0.3) {
        structureIssues.push(`${deviatedCount} capítulos con desviaciones graves del plan original`);
        if (deviatedCount > regularChapters.length * 0.5) {
          blockers.push(`Más del 50% de capítulos se desvían del plan original`);
        }
      }
    }

    const unresolvedMatch = finalStructuralLog.message.match(/Hilos sin resolver: (.+?)(?:Veredicto:|$)/);
    if (unresolvedMatch) {
      const threads = unresolvedMatch[1].split(",").map(t => t.trim()).filter(t => t.length > 0);
      if (threads.length > 0) {
        structureIssues.push(`Hilos sin resolver según revisión final: ${threads.join("; ")}`);
      }
    }
  }

  const errorCheckpoints = activityLogs.filter(l =>
    l.agentRole === "structural-checkpoint" && l.level === "error" && l.message?.includes("[FINAL]") &&
    !l.message?.includes("Cap 998") && !l.message?.includes("Cap 999")
  );
  if (errorCheckpoints.length > 0) {
    const errPenalty = Math.min(errorCheckpoints.length, 3);
    structureScore = Math.max(2, structureScore - errPenalty);
    for (const e of errorCheckpoints.slice(0, 3)) {
      structureIssues.push(e.message?.substring(0, 120) || "Error estructural");
    }
  }

  metrics.push({
    name: "narrative_structure",
    label: "Estructura Narrativa",
    score: Math.max(0, Math.min(10, structureScore)),
    maxScore: 10,
    weight: 20,
    details: finalStructuralLog
      ? `Adherencia estructural según revisión final`
      : "Sin revisión estructural final disponible",
    issues: structureIssues,
  });

  // === METRIC 6: PROTAGONIST PRESENCE ===
  let protagonistScore = 10;
  const protagonistIssues: string[] = [];

  const worldBible = await storage.getWorldBibleByProject(projectId);
  const worldBibleData = worldBible
    ? { characters: worldBible.characters, personajes: worldBible.characters }
    : null;
  const protagonistName = extractProtagonistName(worldBibleData);

  if (protagonistName) {
    let chaptersWithProtagonist = 0;
    const nameLower = protagonistName.toLowerCase();
    const nameSearchParts = nameLower
      .replace(/["'«»""'']/g, ' ')
      .split(/\s+/)
      .filter(p => p.length >= 3 && !['el', 'la', 'los', 'las', 'del', 'de', 'the'].includes(p));
    
    for (const ch of regularChapters) {
      if (ch.content) {
        const contentLower = ch.content.toLowerCase();
        const found = contentLower.includes(nameLower) || 
          nameSearchParts.some(part => contentLower.includes(part));
        if (found) {
          chaptersWithProtagonist++;
        }
      }
    }
    const presenceRate = regularChapters.length > 0
      ? chaptersWithProtagonist / regularChapters.length
      : 0;

    if (presenceRate < 0.4) {
      protagonistScore = 3;
      blockers.push(`Protagonista (${protagonistName}) solo aparece en ${(presenceRate * 100).toFixed(0)}% de capítulos (mínimo: 40%)`);
      protagonistIssues.push(`${protagonistName} presente en ${chaptersWithProtagonist}/${regularChapters.length} capítulos (${(presenceRate * 100).toFixed(0)}%)`);
    } else if (presenceRate < 0.6) {
      protagonistScore = 6;
      protagonistIssues.push(`${protagonistName} presente en ${chaptersWithProtagonist}/${regularChapters.length} capítulos (${(presenceRate * 100).toFixed(0)}%) - aceptable pero bajo`);
    } else if (presenceRate < 0.8) {
      protagonistScore = 8;
    }
  } else {
    protagonistScore = 5;
    protagonistIssues.push("No se pudo identificar al protagonista en la Biblia del Mundo");
  }

  metrics.push({
    name: "protagonist_presence",
    label: "Presencia del Protagonista",
    score: Math.max(0, Math.min(10, protagonistScore)),
    maxScore: 10,
    weight: 10,
    details: protagonistName
      ? `Protagonista: ${protagonistName}`
      : "Protagonista no identificado",
    issues: protagonistIssues,
  });

  // === CALCULATE WEIGHTED TOTAL ===
  const totalWeight = metrics.reduce((sum, m) => sum + m.weight, 0);
  const weightedScore = metrics.reduce((sum, m) => sum + (m.score / m.maxScore) * m.weight, 0);
  const percentage = Math.round((weightedScore / totalWeight) * 100);
  const totalScore = Math.round((weightedScore / totalWeight) * 10 * 10) / 10;

  // === DETERMINE VERDICT ===
  let verdict: ObjectiveEvaluationResult["verdict"];
  if (blockers.length > 0) {
    verdict = "NECESITA_TRABAJO";
  } else if (percentage >= 80) {
    verdict = "PUBLICABLE";
  } else if (percentage >= 60) {
    verdict = "CASI_PUBLICABLE";
  } else {
    verdict = "NECESITA_TRABAJO";
  }

  // === GENERATE RECOMMENDATIONS ===
  const recommendations: string[] = [];
  const sortedMetrics = [...metrics].sort((a, b) => (a.score / a.maxScore) - (b.score / b.maxScore));

  for (const m of sortedMetrics) {
    if (m.score < m.maxScore * 0.7) {
      switch (m.name) {
        case "narrative_coherence":
          recommendations.push("Ejecutar 'Detect & Fix' para resolver violaciones de continuidad, especialmente personajes muertos que aparecen vivos");
          break;
        case "plot_completeness":
          recommendations.push("Revisar y cerrar los hilos argumentales pendientes en los últimos capítulos");
          break;
        case "adequate_length":
          recommendations.push("Expandir capítulos cortos o añadir escenas para alcanzar la extensión mínima del género");
          break;
        case "prose_quality":
          recommendations.push("Ejecutar una pasada adicional de corrección de estilo en los capítulos con errores pendientes");
          break;
        case "narrative_structure":
          recommendations.push("Alinear capítulos desviados con el plan original o ajustar el plan para reflejar la nueva dirección");
          break;
        case "protagonist_presence":
          recommendations.push("Aumentar la presencia del protagonista en capítulos donde no aparece o aparece de forma secundaria");
          break;
      }
    }
  }

  // === BUILD SUMMARY ===
  const verdictLabels = {
    PUBLICABLE: "PUBLICABLE - Lista para publicar",
    CASI_PUBLICABLE: "CASI PUBLICABLE - Requiere ajustes menores",
    NECESITA_TRABAJO: "NECESITA TRABAJO - Requiere correcciones significativas",
  };

  const summary = [
    `Evaluación Objetiva: ${totalScore}/10 (${percentage}%)`,
    `Veredicto: ${verdictLabels[verdict]}`,
    `${chapters.length} capítulos, ${totalWords.toLocaleString()} palabras`,
    blockers.length > 0 ? `BLOQUEADORES: ${blockers.length}` : "Sin bloqueadores",
  ].join(" | ");

  return {
    totalScore,
    maxPossibleScore: 10,
    percentage,
    verdict,
    metrics,
    summary,
    blockers,
    recommendations,
  };
}
