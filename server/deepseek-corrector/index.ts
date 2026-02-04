import OpenAI from 'openai';
import { db } from '../db';
import { correctedManuscripts, manuscriptAudits, projects } from '@shared/schema';
import { eq } from 'drizzle-orm';
import type { CorrectionRecord, AuditIssue, AgentReport } from '@shared/schema';

const deepseek = new OpenAI({
  baseURL: 'https://api.deepseek.com',
  apiKey: process.env.DEEPSEEK_API_KEY
});

const SYSTEM_PROMPT = `Eres un Editor Literario Técnico ("Ghostwriter") especializado en corrección invisible.
Tu objetivo es solucionar inconsistencias lógicas manteniendo la prosa EXACTA del autor original.
NO eres un co-autor creativo. NO mejores el estilo. NO resumas.
Tu única métrica de éxito es que el lector no note que el texto ha sido editado.

REGLAS ABSOLUTAS:
1. Mantén el tono, vocabulario y ritmo del autor.
2. NO añadas información nueva que no sea estrictamente necesaria.
3. Devuelve SOLO el texto corregido, sin explicaciones, sin markdown, sin comillas.`;

interface CorrectionRequest {
  fullChapter: string;
  targetText: string;
  instruction: string;
  suggestion: string;
}

interface CorrectionResult {
  success: boolean;
  originalText: string;
  correctedText: string;
  diffStats: {
    wordsAdded: number;
    wordsRemoved: number;
    lengthChange: number;
  };
  error?: string;
}

function extractContext(fullText: string, targetText: string, contextChars: number = 500): {
  prevContext: string;
  nextContext: string;
  targetIndex: number;
} {
  const targetIndex = fullText.indexOf(targetText);
  if (targetIndex === -1) {
    const normalizedTarget = targetText.replace(/\s+/g, ' ').trim();
    const normalizedFull = fullText.replace(/\s+/g, ' ');
    const normalizedIndex = normalizedFull.indexOf(normalizedTarget);
    if (normalizedIndex === -1) {
      return { prevContext: '', nextContext: '', targetIndex: -1 };
    }
  }
  
  const prevContext = fullText.substring(Math.max(0, targetIndex - contextChars), targetIndex);
  const nextContext = fullText.substring(
    targetIndex + targetText.length,
    targetIndex + targetText.length + contextChars
  );
  
  return { prevContext, nextContext, targetIndex };
}

function calculateDiffStats(original: string, corrected: string) {
  const originalWords = original.split(/\s+/).filter(w => w.length > 0);
  const correctedWords = corrected.split(/\s+/).filter(w => w.length > 0);
  
  return {
    wordsAdded: Math.max(0, correctedWords.length - originalWords.length),
    wordsRemoved: Math.max(0, originalWords.length - correctedWords.length),
    lengthChange: corrected.length - original.length
  };
}

function sanitizeResponse(response: string): string {
  let cleaned = response.trim();
  
  const prefixes = [
    /^(aquí tienes|aquí está|here is|here's)[^:]*:/i,
    /^(el texto|the text)[^:]*:/i,
    /^(corrección|correction)[^:]*:/i,
    /^```[a-z]*\n?/i,
  ];
  
  for (const prefix of prefixes) {
    cleaned = cleaned.replace(prefix, '');
  }
  
  cleaned = cleaned.replace(/```$/g, '');
  cleaned = cleaned.replace(/^["']|["']$/g, '');
  
  return cleaned.trim();
}

export async function correctSingleIssue(req: CorrectionRequest): Promise<CorrectionResult> {
  try {
    const { prevContext, nextContext, targetIndex } = extractContext(req.fullChapter, req.targetText);
    
    if (targetIndex === -1) {
      return {
        success: false,
        originalText: req.targetText,
        correctedText: req.targetText,
        diffStats: { wordsAdded: 0, wordsRemoved: 0, lengthChange: 0 },
        error: 'Texto objetivo no encontrado en el capítulo'
      };
    }

    const userPrompt = `### CONTEXTO PREVIO (NO EDITAR)
${prevContext.slice(-300)}

### TEXTO A CORREGIR (TARGET)
"${req.targetText}"

### CONTEXTO POSTERIOR (NO EDITAR)
${nextContext.slice(0, 300)}

### LA INCONSISTENCIA A REPARAR
Instrucción: ${req.instruction}
Solución requerida: ${req.suggestion}

### REGLAS DE EJECUCIÓN (CRÍTICO)
1. Reescribe SOLAMENTE el "TEXTO A CORREGIR".
2. Mantén el tono, vocabulario y ritmo del autor (ver Contexto Previo para referencia).
3. El nuevo texto debe fluir naturalmente hacia el "Contexto Posterior".
4. NO añadas información nueva que no sea estrictamente necesaria para la corrección.
5. Devuelve SOLO el texto corregido, sin explicaciones ni markdown ni comillas.`;

    const completion = await deepseek.chat.completions.create({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.3,
      max_tokens: 2000
    });

    const rawResponse = completion.choices[0]?.message?.content || '';
    const correctedText = sanitizeResponse(rawResponse);

    if (!correctedText || correctedText.length > req.targetText.length * 2.5) {
      return {
        success: false,
        originalText: req.targetText,
        correctedText: req.targetText,
        diffStats: { wordsAdded: 0, wordsRemoved: 0, lengthChange: 0 },
        error: 'Corrección descartada por anomalía de longitud'
      };
    }

    const diffStats = calculateDiffStats(req.targetText, correctedText);

    return {
      success: true,
      originalText: req.targetText,
      correctedText,
      diffStats
    };
  } catch (error) {
    console.error('Error en corrección DeepSeek:', error);
    return {
      success: false,
      originalText: req.targetText,
      correctedText: req.targetText,
      diffStats: { wordsAdded: 0, wordsRemoved: 0, lengthChange: 0 },
      error: error instanceof Error ? error.message : 'Error desconocido'
    };
  }
}

function extractTargetFromLocation(novelContent: string, location: string, description: string): string | null {
  const chapterMatch = location.match(/Cap[íi]tulo\s*(\d+)/i);
  if (!chapterMatch) return null;
  
  const chapterNum = parseInt(chapterMatch[1]);
  const chapterPattern = new RegExp(`===\\s*(?:CAPÍTULO|Capítulo|Cap\\.?)\\s*${chapterNum}[^=]*===([\\s\\S]*?)(?====|$)`, 'i');
  const chapterContentMatch = novelContent.match(chapterPattern);
  
  if (!chapterContentMatch) return null;
  
  const chapterContent = chapterContentMatch[1];
  
  const sentences = chapterContent.match(/[^.!?]+[.!?]+/g) || [];
  const keywords = description.toLowerCase().split(/\s+/).filter(w => w.length > 4);
  
  let bestMatch = '';
  let bestScore = 0;
  
  for (let i = 0; i < sentences.length; i++) {
    const context = sentences.slice(Math.max(0, i - 1), i + 2).join(' ');
    let score = 0;
    
    for (const keyword of keywords) {
      if (context.toLowerCase().includes(keyword)) {
        score++;
      }
    }
    
    if (score > bestScore) {
      bestScore = score;
      bestMatch = sentences[i].trim();
    }
  }
  
  return bestMatch.length > 20 ? bestMatch : null;
}

export async function startCorrectionProcess(
  auditId: number,
  onProgress?: (progress: { phase: string; current: number; total: number; message: string }) => void
): Promise<{ success: boolean; manuscriptId?: number; error?: string }> {
  try {
    const [audit] = await db.select().from(manuscriptAudits).where(eq(manuscriptAudits.id, auditId));
    
    if (!audit) {
      return { success: false, error: 'Auditoría no encontrada' };
    }

    if (!audit.finalAudit) {
      return { success: false, error: 'La auditoría no tiene reportes finales' };
    }

    const finalAudit = audit.finalAudit as any;
    const allIssues: Array<AuditIssue & { agentType: string }> = [];
    
    for (const report of (finalAudit.reports || [])) {
      for (const issue of (report.issues || [])) {
        allIssues.push({ ...issue, agentType: report.agentType });
      }
    }

    if (allIssues.length === 0) {
      return { success: false, error: 'No hay issues para corregir' };
    }

    const [manuscript] = await db.insert(correctedManuscripts).values({
      auditId,
      projectId: audit.projectId,
      status: 'correcting',
      originalContent: audit.novelContent,
      totalIssues: allIssues.length,
      pendingCorrections: []
    }).returning();

    onProgress?.({ phase: 'starting', current: 0, total: allIssues.length, message: 'Iniciando corrección quirúrgica...' });

    const pendingCorrections: CorrectionRecord[] = [];
    let correctedContent = audit.novelContent;
    let successCount = 0;

    for (let i = 0; i < allIssues.length; i++) {
      const issue = allIssues[i];
      
      onProgress?.({
        phase: 'correcting',
        current: i + 1,
        total: allIssues.length,
        message: `Corrigiendo issue ${i + 1}/${allIssues.length}: ${issue.severity}`
      });

      const targetText = extractTargetFromLocation(correctedContent, issue.location, issue.description);
      
      if (!targetText) {
        pendingCorrections.push({
          id: `correction-${Date.now()}-${i}`,
          issueId: `issue-${i}`,
          location: issue.location,
          chapterNumber: parseInt(issue.location.match(/\d+/)?.[0] || '0'),
          originalText: '[No se pudo localizar el texto exacto]',
          correctedText: '',
          instruction: issue.description,
          severity: issue.severity,
          status: 'pending',
          diffStats: { wordsAdded: 0, wordsRemoved: 0, lengthChange: 0 },
          createdAt: new Date().toISOString()
        });
        continue;
      }

      const result = await correctSingleIssue({
        fullChapter: correctedContent,
        targetText,
        instruction: issue.description,
        suggestion: issue.suggestion
      });

      const correctionRecord: CorrectionRecord = {
        id: `correction-${Date.now()}-${i}`,
        issueId: `issue-${i}`,
        location: issue.location,
        chapterNumber: parseInt(issue.location.match(/\d+/)?.[0] || '0'),
        originalText: result.originalText,
        correctedText: result.correctedText,
        instruction: issue.description,
        severity: issue.severity,
        status: result.success ? 'pending' : 'rejected',
        diffStats: result.diffStats,
        createdAt: new Date().toISOString()
      };

      pendingCorrections.push(correctionRecord);

      if (result.success) {
        successCount++;
      }

      await new Promise(resolve => setTimeout(resolve, 500));
    }

    await db.update(correctedManuscripts)
      .set({
        status: 'review',
        correctedContent,
        pendingCorrections,
        correctedIssues: successCount
      })
      .where(eq(correctedManuscripts.id, manuscript.id));

    onProgress?.({
      phase: 'completed',
      current: allIssues.length,
      total: allIssues.length,
      message: `Corrección completada. ${successCount}/${allIssues.length} issues corregidos. Esperando revisión.`
    });

    return { success: true, manuscriptId: manuscript.id };
  } catch (error) {
    console.error('Error en proceso de corrección:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Error desconocido' };
  }
}

export async function approveCorrection(manuscriptId: number, correctionId: string): Promise<boolean> {
  try {
    const [manuscript] = await db.select().from(correctedManuscripts).where(eq(correctedManuscripts.id, manuscriptId));
    
    if (!manuscript) return false;

    const pendingCorrections = (manuscript.pendingCorrections as CorrectionRecord[]) || [];
    const correction = pendingCorrections.find(c => c.id === correctionId);
    
    if (!correction) return false;

    correction.status = 'approved';
    correction.reviewedAt = new Date().toISOString();

    let updatedContent = manuscript.correctedContent || manuscript.originalContent;
    if (correction.originalText !== '[No se pudo localizar el texto exacto]') {
      updatedContent = updatedContent.replace(correction.originalText, correction.correctedText);
    }

    await db.update(correctedManuscripts)
      .set({
        pendingCorrections,
        correctedContent: updatedContent,
        approvedIssues: (manuscript.approvedIssues || 0) + 1
      })
      .where(eq(correctedManuscripts.id, manuscriptId));

    return true;
  } catch (error) {
    console.error('Error aprobando corrección:', error);
    return false;
  }
}

export async function rejectCorrection(manuscriptId: number, correctionId: string): Promise<boolean> {
  try {
    const [manuscript] = await db.select().from(correctedManuscripts).where(eq(correctedManuscripts.id, manuscriptId));
    
    if (!manuscript) return false;

    const pendingCorrections = (manuscript.pendingCorrections as CorrectionRecord[]) || [];
    const correction = pendingCorrections.find(c => c.id === correctionId);
    
    if (!correction) return false;

    correction.status = 'rejected';
    correction.reviewedAt = new Date().toISOString();

    await db.update(correctedManuscripts)
      .set({
        pendingCorrections,
        rejectedIssues: (manuscript.rejectedIssues || 0) + 1
      })
      .where(eq(correctedManuscripts.id, manuscriptId));

    return true;
  } catch (error) {
    console.error('Error rechazando corrección:', error);
    return false;
  }
}

export async function finalizeManuscript(manuscriptId: number): Promise<boolean> {
  try {
    const [manuscript] = await db.select().from(correctedManuscripts).where(eq(correctedManuscripts.id, manuscriptId));
    
    if (!manuscript) return false;

    await db.update(correctedManuscripts)
      .set({
        status: 'approved',
        completedAt: new Date()
      })
      .where(eq(correctedManuscripts.id, manuscriptId));

    return true;
  } catch (error) {
    console.error('Error finalizando manuscrito:', error);
    return false;
  }
}
