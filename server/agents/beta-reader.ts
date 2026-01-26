// LitAgents 2.1 - Beta Reader Agent (The Critic)
// Analyzes completed novels and orders surgical rewrites to improve commercial viability

import OpenAI from 'openai';
import { CRITIC_PROMPTS, GENRE_CRITERIA } from './critic-prompts';
import { storage } from '../storage';
import { calculateRealCost, formatCostForStorage } from '../cost-calculator';

export interface BetaReaderReport {
  score: number;
  viability: 'High' | 'Medium' | 'Low';
  critique_summary: string;
  strengths: string[];
  weaknesses: string[];
  flagged_chapters: FlaggedChapter[];
  market_comparison: string;
}

export interface FlaggedChapter {
  chapter_number: number;
  issue_type: 'PACING_SLOW' | 'CHARACTER_FLAT' | 'DIALOGUE_WEAK' | 'TENSION_DROP' | 'LOGIC_HOLE' | 'EXPOSITION_DUMP';
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  specific_fix: string;
}

interface EvaluationResult {
  report: BetaReaderReport;
  tokenUsage: {
    inputTokens: number;
    outputTokens: number;
    thinkingTokens: number;
  };
}

interface RewriteResult {
  newContent: string;
  tokenUsage: {
    inputTokens: number;
    outputTokens: number;
  };
}

export class BetaReaderAgent {
  private client: OpenAI;
  private reasonerModel: string = 'deepseek-reasoner';
  private writerModel: string = 'deepseek-chat';

  constructor() {
    this.client = new OpenAI({
      apiKey: process.env.DEEPSEEK_API_KEY,
      baseURL: 'https://api.deepseek.com'
    });
  }

  // PHASE 1: READ AND DIAGNOSE
  async evaluateNovel(
    projectId: number,
    genre: string,
    summaries: string[],
    firstChapter: string,
    lastChapter: string
  ): Promise<EvaluationResult> {
    console.log(`[BetaReader] Evaluating novel ${projectId} (${genre})...`);

    const summaryBlock = summaries
      .map((s, i) => `[Capítulo ${i + 1}]: ${s || 'Sin resumen disponible'}`)
      .join('\n');

    const prompt = CRITIC_PROMPTS.FULL_EVALUATION(
      genre,
      summaryBlock,
      firstChapter,
      lastChapter
    );

    const response = await this.client.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      model: this.reasonerModel,
      temperature: 0.7,
    });

    const content = response.choices[0]?.message?.content || '{}';
    const jsonStr = content.replace(/```json|```/g, '').trim();
    
    let report: BetaReaderReport;
    try {
      report = JSON.parse(jsonStr);
    } catch (e) {
      console.error('[BetaReader] Failed to parse evaluation response:', e);
      report = {
        score: 5,
        viability: 'Medium',
        critique_summary: 'Error al parsear la evaluación. El manuscrito requiere revisión manual.',
        strengths: [],
        weaknesses: ['Error de evaluación automática'],
        flagged_chapters: [],
        market_comparison: 'No disponible'
      };
    }

    const thinkingContent = (response.choices[0]?.message as any)?.reasoning_content || '';
    const thinkingTokens = Math.ceil(thinkingContent.length / 4);

    return {
      report,
      tokenUsage: {
        inputTokens: response.usage?.prompt_tokens || 0,
        outputTokens: response.usage?.completion_tokens || 0,
        thinkingTokens,
      }
    };
  }

  // PHASE 2: SURGICAL REWRITE
  async applyFix(
    chapterContent: string,
    issue: FlaggedChapter,
    genre: string
  ): Promise<RewriteResult> {
    console.log(`[BetaReader] Applying surgical fix to Chapter ${issue.chapter_number}...`);

    const prompt = CRITIC_PROMPTS.SURGICAL_REWRITE(
      chapterContent,
      issue.issue_type,
      issue.specific_fix,
      genre
    );

    const response = await this.client.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      model: this.writerModel,
      temperature: 0.5,
    });

    const newContent = response.choices[0]?.message?.content || chapterContent;

    return {
      newContent,
      tokenUsage: {
        inputTokens: response.usage?.prompt_tokens || 0,
        outputTokens: response.usage?.completion_tokens || 0,
      }
    };
  }

  // FULL PIPELINE: Evaluate + Apply Fixes
  async runFullCritique(
    projectId: number,
    onStatus?: (status: string, message: string) => void
  ): Promise<{ status: 'polished' | 'completed' | 'low_quality'; report: BetaReaderReport }> {
    const project = await storage.getProject(projectId);
    if (!project) throw new Error(`Project ${projectId} not found`);

    const chapters = await storage.getChaptersByProject(projectId);
    if (chapters.length === 0) throw new Error('No chapters found');

    const sortedChapters = chapters
      .filter(c => c.status === 'completed' || c.status === 'approved')
      .sort((a, b) => a.chapterNumber - b.chapterNumber);

    if (sortedChapters.length < 3) {
      throw new Error('Not enough completed chapters for critique');
    }

    const summaries = sortedChapters.map(c => c.summary || '');
    const firstChapter = sortedChapters[0].content || '';
    const lastChapter = sortedChapters[sortedChapters.length - 1].content || '';

    onStatus?.('beta-reader', 'Leyendo y analizando manuscrito completo...');

    const { report, tokenUsage } = await this.evaluateNovel(
      projectId,
      project.genre,
      summaries,
      firstChapter,
      lastChapter
    );

    await this.logUsage(projectId, 'beta-reader-evaluator', this.reasonerModel, tokenUsage);

    await storage.updateProject(projectId, {
      betaReaderReport: report as any,
      betaReaderScore: report.score,
      commercialViability: report.viability,
    });

    console.log(`[BetaReader] Evaluation complete: Score ${report.score}/10, Viability: ${report.viability}`);
    onStatus?.('beta-reader', `Evaluación: ${report.score}/10 - Viabilidad: ${report.viability}`);

    if (report.score < 4) {
      console.log(`[BetaReader] Score too low (${report.score}). Skipping fixes - needs manual intervention.`);
      onStatus?.('beta-reader', 'Calidad muy baja. Requiere intervención manual.');
      return { status: 'low_quality', report };
    }

    if (report.score >= 9) {
      console.log(`[BetaReader] Score excellent (${report.score}). No fixes needed.`);
      onStatus?.('beta-reader', 'Excelente calidad. Sin correcciones necesarias.');
      return { status: 'completed', report };
    }

    const highPriorityFixes = report.flagged_chapters.filter(f => f.severity === 'HIGH');
    const mediumPriorityFixes = report.flagged_chapters.filter(f => f.severity === 'MEDIUM');
    const fixesToApply = [...highPriorityFixes, ...mediumPriorityFixes].slice(0, 5);

    if (fixesToApply.length === 0) {
      console.log('[BetaReader] No fixes to apply.');
      return { status: 'completed', report };
    }

    console.log(`[BetaReader] Applying ${fixesToApply.length} surgical fixes...`);
    onStatus?.('beta-reader', `Aplicando ${fixesToApply.length} correcciones quirúrgicas...`);

    for (const fix of fixesToApply) {
      const chapter = sortedChapters.find(c => c.chapterNumber === fix.chapter_number);
      if (!chapter || !chapter.content) continue;

      const versionCount = await storage.getChapterVersionCount(chapter.id);
      await storage.createChapterVersion({
        chapterId: chapter.id,
        projectId,
        versionNumber: versionCount + 1,
        content: chapter.content,
        changeReason: `Pre-BetaReader: ${fix.issue_type}`,
      });

      onStatus?.('beta-reader', `Corrigiendo Capítulo ${fix.chapter_number}: ${fix.issue_type}...`);

      const { newContent, tokenUsage: rewriteUsage } = await this.applyFix(
        chapter.content,
        fix,
        project.genre
      );

      await this.logUsage(projectId, 'beta-reader-rewriter', this.writerModel, rewriteUsage);

      await storage.updateChapter(chapter.id, {
        content: newContent,
        wordCount: newContent.split(/\s+/).length,
      });

      await storage.createEditingQueueItem({
        projectId,
        chapterId: chapter.id,
        chapterNumber: fix.chapter_number,
        issueType: fix.issue_type,
        severity: fix.severity.toLowerCase(),
        instruction: fix.specific_fix,
        status: 'completed',
      });

      console.log(`[BetaReader] Fixed Chapter ${fix.chapter_number}`);
    }

    onStatus?.('beta-reader', `Completado: ${fixesToApply.length} capítulos mejorados`);
    return { status: 'polished', report };
  }

  private async logUsage(
    projectId: number,
    agentName: string,
    model: string,
    usage: { inputTokens: number; outputTokens: number; thinkingTokens?: number }
  ) {
    try {
      const costs = calculateRealCost(
        model,
        usage.inputTokens,
        usage.outputTokens,
        usage.thinkingTokens || 0
      );

      await storage.createAiUsageEvent({
        projectId,
        agentName,
        model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        thinkingTokens: usage.thinkingTokens || 0,
        inputCostUsd: formatCostForStorage(costs.inputCost),
        outputCostUsd: formatCostForStorage(costs.outputCost + costs.thinkingCost),
        totalCostUsd: formatCostForStorage(costs.totalCost),
        chapterNumber: null,
        operation: 'critique',
      });
    } catch (err) {
      console.error('[BetaReader] Failed to log usage:', err);
    }
  }
}

export const betaReaderAgent = new BetaReaderAgent();
