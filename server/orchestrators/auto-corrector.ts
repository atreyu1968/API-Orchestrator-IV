import { db } from '../db';
import { eq } from 'drizzle-orm';
import {
  autoCorrectionRuns,
  manuscriptAudits,
  correctedManuscripts,
  projects,
  type AutoCorrectionCycle,
  type AutoCorrectionLogEntry,
  type AuditIssue,
  type AgentReport,
  type CorrectionRecord,
} from '@shared/schema';
import { storage } from '../storage';

const activeRuns = new Map<number, { cancelled: boolean }>();

export type AutoCorrectorProgressCallback = (event: {
  phase: string;
  message: string;
  cycle?: number;
  maxCycles?: number;
  score?: number;
  criticalIssues?: number;
  details?: Record<string, any>;
}) => void;

export async function cleanupZombieRuns(): Promise<number> {
  const activeStatuses = ['pending', 'auditing', 'correcting', 'approving', 'finalizing', 're_auditing'];
  const allRuns = await db.select().from(autoCorrectionRuns);
  let cleaned = 0;
  const now = Date.now();
  const GRACE_PERIOD_MS = 60_000;
  for (const run of allRuns) {
    if (activeStatuses.includes(run.status) && !activeRuns.has(run.id)) {
      const createdAt = new Date(run.createdAt).getTime();
      if (now - createdAt < GRACE_PERIOD_MS) {
        console.log(`[AutoCorrector] Run #${run.id} is recent (${Math.round((now - createdAt) / 1000)}s old), skipping cleanup`);
        continue;
      }
      console.log(`[AutoCorrector] Zombie run #${run.id} detected (status: ${run.status}). Marking as failed.`);
      const logs = (run.progressLog as AutoCorrectionLogEntry[]) || [];
      logs.push({
        timestamp: new Date().toISOString(),
        phase: 'error',
        message: 'Run interrumpido por reinicio del servidor. Usa "Reintentar" para volver a ejecutar.',
      });
      await db.update(autoCorrectionRuns)
        .set({ status: 'failed', errorMessage: 'Interrumpido por reinicio del servidor', progressLog: logs })
        .where(eq(autoCorrectionRuns.id, run.id));
      cleaned++;
    }
  }
  if (cleaned > 0) {
    console.log(`[AutoCorrector] Cleaned up ${cleaned} zombie run(s)`);
  }
  return cleaned;
}

export async function retryAutoCorrectionRun(
  runId: number,
  onProgress?: AutoCorrectorProgressCallback
): Promise<{ success: boolean; runId?: number; error?: string }> {
  const [oldRun] = await db.select().from(autoCorrectionRuns).where(eq(autoCorrectionRuns.id, runId));
  if (!oldRun) {
    return { success: false, error: 'Run no encontrado' };
  }
  if (!['failed', 'cancelled'].includes(oldRun.status)) {
    return { success: false, error: 'Solo se pueden reintentar runs fallidos o cancelados' };
  }
  return startAutoCorrectionRun(oldRun.projectId, {
    maxCycles: oldRun.maxCycles || 3,
    targetScore: oldRun.targetScore || 85,
    maxCriticalIssues: oldRun.maxCriticalIssues || 0,
  }, onProgress);
}

export async function cancelAutoCorrectionRun(runId: number): Promise<boolean> {
  const run = activeRuns.get(runId);
  if (run) {
    run.cancelled = true;
  }
  await db.update(autoCorrectionRuns)
    .set({ status: 'cancelled' })
    .where(eq(autoCorrectionRuns.id, runId));
  return true;
}

async function isCancelled(runId: number, control: { cancelled: boolean }): Promise<boolean> {
  if (control.cancelled) return true;
  const [run] = await db.select().from(autoCorrectionRuns).where(eq(autoCorrectionRuns.id, runId));
  if (run && run.status === 'cancelled') {
    control.cancelled = true;
    return true;
  }
  return false;
}

export function isRunActive(runId: number): boolean {
  return activeRuns.has(runId);
}

async function addLog(runId: number, phase: string, message: string, details?: Record<string, any>) {
  const [run] = await db.select().from(autoCorrectionRuns).where(eq(autoCorrectionRuns.id, runId));
  if (!run) return;

  const logs = (run.progressLog as AutoCorrectionLogEntry[]) || [];
  logs.push({
    timestamp: new Date().toISOString(),
    phase,
    message,
    details,
  });

  if (logs.length > 200) {
    logs.splice(0, logs.length - 200);
  }

  await db.update(autoCorrectionRuns)
    .set({ progressLog: logs })
    .where(eq(autoCorrectionRuns.id, runId));
}

async function updateRunStatus(runId: number, status: string, extra?: Record<string, any>) {
  await db.update(autoCorrectionRuns)
    .set({ status, ...extra })
    .where(eq(autoCorrectionRuns.id, runId));
}

export async function startAutoCorrectionRun(
  projectId: number,
  options: {
    maxCycles?: number;
    targetScore?: number;
    maxCriticalIssues?: number;
  } = {},
  onProgress?: AutoCorrectorProgressCallback
): Promise<{ success: boolean; runId?: number; error?: string }> {
  try {
    const project = await storage.getProject(projectId);
    if (!project) {
      return { success: false, error: 'Proyecto no encontrado' };
    }

    const chapters = await storage.getChaptersByProject(projectId);
    if (!chapters || chapters.length === 0) {
      return { success: false, error: 'El proyecto no tiene capítulos' };
    }

    const activeStatuses = ['pending', 'auditing', 'correcting', 'approving', 'finalizing', 're_auditing'];
    const existingRuns = await db.select().from(autoCorrectionRuns)
      .where(eq(autoCorrectionRuns.projectId, projectId));
    const hasActiveRun = existingRuns.some(r => activeStatuses.includes(r.status));
    if (hasActiveRun) {
      return { success: false, error: 'Ya hay una auto-corrección activa para este proyecto' };
    }

    const [run] = await db.insert(autoCorrectionRuns).values({
      projectId,
      status: 'pending',
      currentCycle: 1,
      maxCycles: options.maxCycles || 3,
      targetScore: options.targetScore || 85,
      maxCriticalIssues: options.maxCriticalIssues || 0,
      cycleHistory: [],
      progressLog: [],
      totalIssuesFixed: 0,
      totalStructuralChanges: 0,
    }).returning();

    const runControl = { cancelled: false };
    activeRuns.set(run.id, runControl);

    console.log(`[AutoCorrector] Starting run #${run.id} for project ${projectId} (${project.title})`);

    executeAutoCorrectionLoop(run.id, projectId, runControl, onProgress).catch(async (err) => {
      console.error(`[AutoCorrector] Fatal error in run ${run.id}:`, err);
      await updateRunStatus(run.id, 'failed', { errorMessage: String(err) });
      activeRuns.delete(run.id);
    });

    return { success: true, runId: run.id };
  } catch (error) {
    console.error('[AutoCorrector] Error starting run:', error);
    return { success: false, error: String(error) };
  }
}

async function executeAutoCorrectionLoop(
  runId: number,
  projectId: number,
  control: { cancelled: boolean },
  onProgress?: AutoCorrectorProgressCallback
) {
  try {
    console.log(`[AutoCorrector] executeAutoCorrectionLoop started for run #${runId}, project ${projectId}`);
    const [run] = await db.select().from(autoCorrectionRuns).where(eq(autoCorrectionRuns.id, runId));
    if (!run) throw new Error('Run not found');

    const maxCycles = run.maxCycles || 3;
    const targetScore = run.targetScore || 85;
    const maxCritical = run.maxCriticalIssues || 0;
    let totalFixed = 0;
    let totalStructural = 0;

    for (let cycle = 1; cycle <= maxCycles; cycle++) {
      if (await isCancelled(runId, control)) {
        await addLog(runId, 'cancelled', `Ciclo ${cycle}: Cancelado por el usuario`);
        await updateRunStatus(runId, 'cancelled');
        onProgress?.({ phase: 'cancelled', message: 'Auto-corrección cancelada' });
        break;
      }

      const cycleStart = new Date().toISOString();
      await updateRunStatus(runId, 'auditing', { currentCycle: cycle });

      onProgress?.({
        phase: 'auditing',
        message: `Ciclo ${cycle}/${maxCycles}: Iniciando auditoría con Gemini...`,
        cycle,
        maxCycles,
      });
      await addLog(runId, 'auditing', `Ciclo ${cycle}: Iniciando auditoría`);

      console.log(`[AutoCorrector] Run #${runId} Cycle ${cycle}: Building novel content...`);
      const novelContent = await buildNovelContent(projectId);
      console.log(`[AutoCorrector] Run #${runId} Cycle ${cycle}: Novel content built (${novelContent.length} chars)`);
      const bibleContent = await buildBibleContent(projectId);
      console.log(`[AutoCorrector] Run #${runId} Cycle ${cycle}: Bible content built (${bibleContent?.length || 0} chars). Starting audit...`);

      const auditResult = await runAudit(runId, projectId, novelContent, bibleContent, cycle, onProgress);
      console.log(`[AutoCorrector] Run #${runId} Cycle ${cycle}: Audit result:`, JSON.stringify({ success: auditResult.success, score: auditResult.overallScore, critical: auditResult.criticalIssues, total: auditResult.totalIssues, error: auditResult.error }));

      if (await isCancelled(runId, control)) {
        await finishCancelled(runId, cycle, cycleStart, auditResult);
        onProgress?.({ phase: 'cancelled', message: 'Auto-corrección cancelada' });
        break;
      }

      if (!auditResult.success || !auditResult.auditId) {
        await addLog(runId, 'error', `Ciclo ${cycle}: Error en auditoría: ${auditResult.error}`);
        const cycleRecord: AutoCorrectionCycle = {
          cycle,
          auditId: auditResult.auditId || 0,
          overallScore: 0,
          criticalIssues: 0,
          totalIssues: 0,
          issuesFixed: 0,
          structuralChanges: 0,
          startedAt: cycleStart,
          completedAt: new Date().toISOString(),
          result: 'error',
        };
        await appendCycleHistory(runId, cycleRecord);
        await updateRunStatus(runId, 'failed', { errorMessage: auditResult.error });
        onProgress?.({ phase: 'error', message: `Error en auditoría: ${auditResult.error}` });
        break;
      }

      const { overallScore, criticalIssues, totalIssues, auditId } = auditResult;

      onProgress?.({
        phase: 'audit_complete',
        message: `Ciclo ${cycle}: Auditoría completada. Score: ${overallScore}, Issues críticos: ${criticalIssues}, Total: ${totalIssues}`,
        cycle,
        maxCycles,
        score: overallScore,
        criticalIssues,
      });

      await addLog(runId, 'audit_complete', `Ciclo ${cycle}: Score=${overallScore}, Críticos=${criticalIssues}, Total=${totalIssues}`);

      // Check if quality threshold is already met
      if (overallScore >= targetScore && criticalIssues <= maxCritical) {
        const cycleRecord: AutoCorrectionCycle = {
          cycle,
          auditId,
          overallScore,
          criticalIssues,
          totalIssues,
          issuesFixed: 0,
          structuralChanges: 0,
          startedAt: cycleStart,
          completedAt: new Date().toISOString(),
          result: 'threshold_met',
        };
        await appendCycleHistory(runId, cycleRecord);
        await updateRunStatus(runId, 'completed', {
          finalScore: overallScore,
          finalCriticalIssues: criticalIssues,
          totalIssuesFixed: totalFixed,
          totalStructuralChanges: totalStructural,
          completedAt: new Date(),
          currentAuditId: auditId,
        });
        await addLog(runId, 'completed', `Umbral de calidad alcanzado en ciclo ${cycle}. Score: ${overallScore} ≥ ${targetScore}`);
        onProgress?.({
          phase: 'completed',
          message: `Auto-corrección completada. Score final: ${overallScore}`,
          score: overallScore,
          criticalIssues,
        });
        break;
      }

      if (totalIssues === 0) {
        const cycleRecord: AutoCorrectionCycle = {
          cycle,
          auditId,
          overallScore,
          criticalIssues,
          totalIssues: 0,
          issuesFixed: 0,
          structuralChanges: 0,
          startedAt: cycleStart,
          completedAt: new Date().toISOString(),
          result: 'no_issues',
        };
        await appendCycleHistory(runId, cycleRecord);
        await updateRunStatus(runId, 'completed', {
          finalScore: overallScore,
          finalCriticalIssues: criticalIssues,
          completedAt: new Date(),
          currentAuditId: auditId,
        });
        await addLog(runId, 'completed', `Sin issues detectados en ciclo ${cycle}`);
        onProgress?.({ phase: 'completed', message: `Sin issues. Score: ${overallScore}` });
        break;
      }

      // PHASE 3: Run corrections
      if (await isCancelled(runId, control)) {
        await finishCancelled(runId, cycle, cycleStart, auditResult);
        break;
      }

      await updateRunStatus(runId, 'correcting', { currentAuditId: auditId });
      onProgress?.({
        phase: 'correcting',
        message: `Ciclo ${cycle}: Corrigiendo ${totalIssues} issues con DeepSeek...`,
        cycle,
        maxCycles,
      });
      await addLog(runId, 'correcting', `Ciclo ${cycle}: Iniciando corrección de ${totalIssues} issues`);

      const correctionResult = await runCorrections(runId, auditId, cycle, onProgress);

      if (await isCancelled(runId, control)) {
        await finishCancelled(runId, cycle, cycleStart, auditResult);
        break;
      }

      if (!correctionResult.success || !correctionResult.manuscriptId) {
        await addLog(runId, 'error', `Ciclo ${cycle}: Error en corrección: ${correctionResult.error}`);
        const cycleRecord: AutoCorrectionCycle = {
          cycle,
          auditId,
          overallScore,
          criticalIssues,
          totalIssues,
          issuesFixed: 0,
          structuralChanges: 0,
          startedAt: cycleStart,
          completedAt: new Date().toISOString(),
          result: 'error',
        };
        await appendCycleHistory(runId, cycleRecord);
        await updateRunStatus(runId, 'failed', { errorMessage: correctionResult.error });
        onProgress?.({ phase: 'error', message: `Error en corrección: ${correctionResult.error}` });
        break;
      }

      const manuscriptId = correctionResult.manuscriptId;

      // PHASE 4: Handle structural issues
      const structuralCount = await handleStructuralIssuesAutonomously(
        manuscriptId, auditId, novelContent, onProgress
      );
      totalStructural += structuralCount;

      if (await isCancelled(runId, control)) {
        await finishCancelled(runId, cycle, cycleStart, auditResult);
        break;
      }

      // PHASE 5: Auto-approve all pending corrections
      await updateRunStatus(runId, 'approving', { currentManuscriptId: manuscriptId });
      onProgress?.({
        phase: 'approving',
        message: `Ciclo ${cycle}: Auto-aprobando correcciones...`,
        cycle,
        maxCycles,
      });
      await addLog(runId, 'approving', `Ciclo ${cycle}: Auto-aprobando correcciones`);

      const approvedCount = await autoApproveAllCorrections(manuscriptId);

      // PHASE 6: Finalize manuscript
      await updateRunStatus(runId, 'finalizing');
      onProgress?.({
        phase: 'finalizing',
        message: `Ciclo ${cycle}: Finalizando manuscrito corregido...`,
        cycle,
        maxCycles,
      });

      const { finalizeManuscript } = await import('../deepseek-corrector/index');
      await finalizeManuscript(manuscriptId);

      // Update project chapters with corrected content
      await applyCorrectionsToChapters(projectId, manuscriptId);

      totalFixed += approvedCount;

      const cycleRecord: AutoCorrectionCycle = {
        cycle,
        auditId,
        manuscriptId,
        overallScore,
        criticalIssues,
        totalIssues,
        issuesFixed: approvedCount,
        structuralChanges: structuralCount,
        startedAt: cycleStart,
        completedAt: new Date().toISOString(),
        result: cycle === maxCycles ? 'max_cycles' : 'corrected',
      };
      await appendCycleHistory(runId, cycleRecord);

      await addLog(runId, 'cycle_complete', `Ciclo ${cycle}: ${approvedCount} correcciones aplicadas, ${structuralCount} cambios estructurales`);

      onProgress?.({
        phase: 'cycle_complete',
        message: `Ciclo ${cycle} completado. ${approvedCount} correcciones, ${structuralCount} estructurales.`,
        cycle,
        maxCycles,
        details: { approvedCount, structuralCount },
      });

      if (cycle === maxCycles) {
        await updateRunStatus(runId, 'completed', {
          totalIssuesFixed: totalFixed,
          totalStructuralChanges: totalStructural,
          completedAt: new Date(),
          currentAuditId: auditId,
          currentManuscriptId: manuscriptId,
        });
        await addLog(runId, 'completed', `Máximo de ciclos alcanzado (${maxCycles}). Total fixed: ${totalFixed}`);
        onProgress?.({
          phase: 'completed',
          message: `Auto-corrección completada tras ${maxCycles} ciclos. Total corregidos: ${totalFixed}`,
        });
        break;
      }

      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  } finally {
    activeRuns.delete(runId);
  }
}

async function buildNovelContent(projectId: number): Promise<string> {
  const chapters = await storage.getChaptersByProject(projectId);
  if (!chapters || chapters.length === 0) return '';

  const sorted = [...chapters].sort((a, b) => a.chapterNumber - b.chapterNumber);
  let content = '';

  for (const chapter of sorted) {
    if (chapter.content) {
      let label = '';
      if (chapter.chapterNumber === 0) label = 'Prólogo';
      else if (chapter.chapterNumber === 998) label = 'Epílogo';
      else if (chapter.chapterNumber === 999) label = 'Nota del Autor';
      else label = `Capítulo ${chapter.chapterNumber}`;

      content += `\n\n=== ${label}: ${chapter.title || ''} ===\n\n${chapter.content}`;
    }
  }

  return content;
}

async function buildBibleContent(projectId: number): Promise<string | null> {
  const worldBible = await storage.getWorldBibleByProject(projectId);
  if (!worldBible) return null;

  const parts: string[] = [];
  if (worldBible.characters) parts.push(`\n\n=== PERSONAJES ===\n${JSON.stringify(worldBible.characters, null, 2)}`);
  if (worldBible.timeline) parts.push(`\n\n=== LÍNEA TEMPORAL ===\n${JSON.stringify(worldBible.timeline, null, 2)}`);
  if (worldBible.worldRules) parts.push(`\n\n=== REGLAS DEL MUNDO ===\n${JSON.stringify(worldBible.worldRules, null, 2)}`);

  return parts.length > 0 ? parts.join('\n') : null;
}

async function runAudit(
  runId: number,
  projectId: number,
  novelContent: string,
  bibleContent: string | null,
  cycle: number,
  onProgress?: AutoCorrectorProgressCallback
): Promise<{
  success: boolean;
  auditId?: number;
  overallScore: number;
  criticalIssues: number;
  totalIssues: number;
  error?: string;
}> {
  try {
    const project = await storage.getProject(projectId);
    const novelTitle = project?.title || 'Untitled';
    console.log(`[AutoCorrector] runAudit cycle ${cycle}: Creating audit record for "${novelTitle}"...`);

    const [audit] = await db.insert(manuscriptAudits).values({
      projectId,
      status: 'pending',
      novelContent,
      bibleContent,
    }).returning();

    console.log(`[AutoCorrector] runAudit cycle ${cycle}: Audit record #${audit.id} created. Importing gemini-auditor...`);

    const {
      initializeNovelContext,
      runAllAgentsWithProgress,
      countCriticalIssues,
      calculateOverallScore,
    } = await import('../gemini-auditor');

    console.log(`[AutoCorrector] runAudit cycle ${cycle}: gemini-auditor imported. Initializing context...`);

    await db.update(manuscriptAudits)
      .set({ status: 'caching' })
      .where(eq(manuscriptAudits.id, audit.id));

    onProgress?.({
      phase: 'auditing',
      message: `Ciclo ${cycle}: Inicializando contexto Gemini...`,
      cycle,
    });

    const contextResult = await initializeNovelContext(novelContent, bibleContent, novelTitle);
    console.log(`[AutoCorrector] runAudit cycle ${cycle}: Context initialized: ${contextResult.success ? 'OK' : 'FAILED'}`);

    if (!contextResult.success) {
      await db.update(manuscriptAudits)
        .set({ status: 'error', errorMessage: 'Failed to initialize context' })
        .where(eq(manuscriptAudits.id, audit.id));
      return { success: false, auditId: audit.id, overallScore: 0, criticalIssues: 0, totalIssues: 0, error: 'Error inicializando contexto' };
    }

    await db.update(manuscriptAudits)
      .set({ status: 'analyzing' })
      .where(eq(manuscriptAudits.id, audit.id));

    onProgress?.({
      phase: 'auditing',
      message: `Ciclo ${cycle}: Ejecutando 3 agentes de auditoría en paralelo...`,
      cycle,
    });

    console.log(`[AutoCorrector] runAudit cycle ${cycle}: Running 3 agents in parallel...`);
    const reports = await runAllAgentsWithProgress(async (report) => {
      const updateData: Record<string, any> = {};
      if (report.agentType === 'CONTINUITY') updateData.continuityReport = report;
      if (report.agentType === 'CHARACTER') updateData.characterReport = report;
      if (report.agentType === 'STYLE') updateData.styleReport = report;

      await db.update(manuscriptAudits)
        .set(updateData)
        .where(eq(manuscriptAudits.id, audit.id));

      onProgress?.({
        phase: 'auditing',
        message: `Ciclo ${cycle}: Agente ${report.agentType} completado (${report.failed ? 'FALLIDO' : `Score: ${report.overallScore}`})`,
        cycle,
      });
    });

    const successfulReports = reports
      .filter(r => !r.failed)
      .map(r => ({ agentType: r.agentType, overallScore: r.overallScore, analysis: r.analysis, issues: r.issues }));

    const overallScore = calculateOverallScore(successfulReports);
    const criticalIssues = countCriticalIssues(successfulReports);
    const totalIssues = successfulReports.reduce((sum, r) => sum + r.issues.length, 0);

    const finalAudit = {
      timestamp: new Date().toISOString(),
      novelTitle,
      reports: successfulReports,
      criticalFlags: criticalIssues,
    };

    await db.update(manuscriptAudits)
      .set({
        status: 'completed',
        finalAudit,
        overallScore,
        criticalFlags: criticalIssues,
        completedAt: new Date(),
      })
      .where(eq(manuscriptAudits.id, audit.id));

    return {
      success: true,
      auditId: audit.id,
      overallScore,
      criticalIssues,
      totalIssues,
    };
  } catch (error) {
    console.error(`[AutoCorrector] Audit error cycle ${cycle}:`, error);
    return {
      success: false,
      overallScore: 0,
      criticalIssues: 0,
      totalIssues: 0,
      error: String(error),
    };
  }
}

async function runCorrections(
  runId: number,
  auditId: number,
  cycle: number,
  onProgress?: AutoCorrectorProgressCallback
): Promise<{ success: boolean; manuscriptId?: number; error?: string }> {
  try {
    const { startCorrectionProcess } = await import('../deepseek-corrector/index');

    const result = await startCorrectionProcess(auditId, (progress) => {
      onProgress?.({
        phase: 'correcting',
        message: `Ciclo ${cycle}: ${progress.message}`,
        cycle,
        details: { correctionPhase: progress.phase, current: progress.current, total: progress.total },
      });
    });

    return result;
  } catch (error) {
    console.error(`[AutoCorrector] Correction error cycle ${cycle}:`, error);
    return { success: false, error: String(error) };
  }
}

async function handleStructuralIssuesAutonomously(
  manuscriptId: number,
  auditId: number,
  novelContent: string,
  onProgress?: AutoCorrectorProgressCallback
): Promise<number> {
  try {
    const { detectStructuralIssues } = await import('../deepseek-corrector/structural-resolver');
    const { applyStructuralResolution } = await import('../deepseek-corrector/structural-resolver');

    const [audit] = await db.select().from(manuscriptAudits).where(eq(manuscriptAudits.id, auditId));
    if (!audit || !audit.finalAudit) return 0;

    const finalAudit = audit.finalAudit as any;
    const allIssues: AuditIssue[] = [];
    for (const report of (finalAudit.reports || [])) {
      for (const issue of (report.issues || [])) {
        allIssues.push(issue);
      }
    }

    const structuralIssues = detectStructuralIssues(allIssues, novelContent);

    if (structuralIssues.length === 0) return 0;

    onProgress?.({
      phase: 'structural',
      message: `Detectados ${structuralIssues.length} problemas estructurales. Resolviendo autónomamente...`,
    });

    let resolvedCount = 0;

    for (const issue of structuralIssues) {
      const selectedOption = selectBestResolutionOption(issue);
      if (!selectedOption) continue;

      onProgress?.({
        phase: 'structural',
        message: `Aplicando ${selectedOption.type} en capítulos ${issue.affectedChapters.join(', ')}...`,
      });

      const [manuscript] = await db.select().from(correctedManuscripts).where(eq(correctedManuscripts.id, manuscriptId));
      if (!manuscript) continue;

      const pendingCorrections = (manuscript.pendingCorrections as CorrectionRecord[]) || [];
      const structuralCorrectionId = `structural-auto-${Date.now()}-${resolvedCount}`;

      pendingCorrections.push({
        id: structuralCorrectionId,
        issueId: issue.id,
        location: `Capítulos ${issue.affectedChapters.join(', ')}`,
        chapterNumber: issue.affectedChapters[0],
        originalText: `[ESTRUCTURAL] ${issue.description}`,
        correctedText: JSON.stringify({
          structuralIssue: issue,
          selectedOption,
        }),
        instruction: `[AUTO-STRUCTURAL] ${issue.type}: ${issue.description}`,
        severity: issue.severity,
        status: 'pending',
        diffStats: { wordsAdded: 0, wordsRemoved: 0, lengthChange: 0 },
        createdAt: new Date().toISOString(),
      });

      await db.update(correctedManuscripts)
        .set({ pendingCorrections })
        .where(eq(correctedManuscripts.id, manuscriptId));

      try {
        const result = await applyStructuralResolution(manuscriptId, structuralCorrectionId, selectedOption.id);
        if (result.success) {
          resolvedCount++;
        }
      } catch (err) {
        console.error(`[AutoCorrector] Structural resolution error:`, err);
      }
    }

    return resolvedCount;
  } catch (error) {
    console.error('[AutoCorrector] Structural handling error:', error);
    return 0;
  }
}

function selectBestResolutionOption(issue: any): any {
  const options = issue.resolutionOptions || [];
  if (options.length === 0) return null;

  if (issue.recommendedOption) {
    const recommended = options.find((o: any) => o.id === issue.recommendedOption);
    if (recommended) return recommended;
  }

  switch (issue.type) {
    case 'duplicate_chapters':
    case 'duplicate_scenes':
      const deleteOption = options.find((o: any) => o.type === 'delete');
      const mergeOption = options.find((o: any) => o.type === 'merge');
      return mergeOption || deleteOption || options[0];

    case 'redundant_content':
      return options.find((o: any) => o.type === 'merge') ||
             options.find((o: any) => o.type === 'rewrite') ||
             options[0];

    case 'continuity_conflict':
      return options.find((o: any) => o.type === 'modify_a') ||
             options.find((o: any) => o.type === 'modify_b') ||
             options.find((o: any) => o.type === 'add_explanation') ||
             options[0];

    case 'narrative_flow_break':
      return options.find((o: any) => o.type === 'add_transition') ||
             options[0];

    case 'repeated_scene':
      return options.find((o: any) => o.type === 'rewrite') ||
             options.find((o: any) => o.type === 'delete') ||
             options[0];

    default:
      return options[0];
  }
}

async function autoApproveAllCorrections(manuscriptId: number): Promise<number> {
  try {
    const { approveCorrection } = await import('../deepseek-corrector/index');

    const [manuscript] = await db.select().from(correctedManuscripts).where(eq(correctedManuscripts.id, manuscriptId));
    if (!manuscript) return 0;

    const pendingCorrections = (manuscript.pendingCorrections as CorrectionRecord[]) || [];
    let approvedCount = 0;

    for (const correction of pendingCorrections) {
      if (correction.status === 'pending') {
        const nonCorrectableMarkers = [
          '[No se pudo localizar el texto exacto]',
          '[Problema genérico sin frases identificables]',
          '[Edita manualmente el texto original aquí]',
        ];

        if (nonCorrectableMarkers.includes(correction.originalText)) {
          continue;
        }

        if (correction.correctedText && correction.correctedText !== correction.originalText) {
          const success = await approveCorrection(manuscriptId, correction.id);
          if (success) {
            approvedCount++;
          }
        }
      }
    }

    return approvedCount;
  } catch (error) {
    console.error('[AutoCorrector] Auto-approve error:', error);
    return 0;
  }
}

async function applyCorrectionsToChapters(projectId: number, manuscriptId: number) {
  try {
    const [manuscript] = await db.select().from(correctedManuscripts).where(eq(correctedManuscripts.id, manuscriptId));
    if (!manuscript || !manuscript.correctedContent) return;

    const correctedContent = manuscript.correctedContent;
    const chapters = await storage.getChaptersByProject(projectId);
    if (!chapters) return;

    const chapterRegex = /=== (Prólogo|Epílogo|Nota del Autor|Capítulo \d+)(?::\s*([^=]*))?\s*===\s*([\s\S]*?)(?=\n\n===|$)/g;
    let match;

    while ((match = chapterRegex.exec(correctedContent)) !== null) {
      const label = match[1].trim();
      const content = match[3].trim();

      let chapterNumber: number;
      if (label === 'Prólogo') chapterNumber = 0;
      else if (label === 'Epílogo') chapterNumber = 998;
      else if (label === 'Nota del Autor') chapterNumber = 999;
      else chapterNumber = parseInt(label.replace('Capítulo ', ''));

      const existingChapter = chapters.find(c => c.chapterNumber === chapterNumber);
      if (existingChapter && content.length > 100) {
        await storage.updateChapter(existingChapter.id, { content });
      }
    }
  } catch (error) {
    console.error('[AutoCorrector] Error applying corrections to chapters:', error);
  }
}

async function appendCycleHistory(runId: number, cycle: AutoCorrectionCycle) {
  const [run] = await db.select().from(autoCorrectionRuns).where(eq(autoCorrectionRuns.id, runId));
  if (!run) return;

  const history = (run.cycleHistory as AutoCorrectionCycle[]) || [];
  history.push(cycle);

  await db.update(autoCorrectionRuns)
    .set({ cycleHistory: history })
    .where(eq(autoCorrectionRuns.id, runId));
}

async function finishCancelled(runId: number, cycle: number, cycleStart: string, auditResult: any) {
  const cycleRecord: AutoCorrectionCycle = {
    cycle,
    auditId: auditResult.auditId || 0,
    overallScore: auditResult.overallScore || 0,
    criticalIssues: auditResult.criticalIssues || 0,
    totalIssues: auditResult.totalIssues || 0,
    issuesFixed: 0,
    structuralChanges: 0,
    startedAt: cycleStart,
    completedAt: new Date().toISOString(),
    result: 'cancelled',
  };
  await appendCycleHistory(runId, cycleRecord);
  await updateRunStatus(runId, 'cancelled');
  await addLog(runId, 'cancelled', `Ciclo ${cycle}: Cancelado`);
}

export async function getAutoCorrectionRun(runId: number) {
  const [run] = await db.select().from(autoCorrectionRuns).where(eq(autoCorrectionRuns.id, runId));
  return run || null;
}

export async function getAutoCorrectionRunsByProject(projectId: number) {
  return db.select().from(autoCorrectionRuns)
    .where(eq(autoCorrectionRuns.projectId, projectId))
    .orderBy(autoCorrectionRuns.createdAt);
}
