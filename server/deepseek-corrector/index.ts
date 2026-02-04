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
  actualTarget: string;
} {
  let targetIndex = fullText.indexOf(targetText);
  let actualTarget = targetText;
  
  if (targetIndex === -1) {
    const normalizedTarget = targetText.replace(/\s+/g, ' ').trim();
    const normalizedFull = fullText.replace(/\s+/g, ' ');
    const normalizedIndex = normalizedFull.indexOf(normalizedTarget);
    
    if (normalizedIndex === -1) {
      const words = normalizedTarget.split(' ').filter(w => w.length > 5);
      if (words.length > 0) {
        const keywordPattern = words.slice(0, 3).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*?');
        const regex = new RegExp(keywordPattern, 'i');
        const match = fullText.match(regex);
        if (match && match.index !== undefined) {
          targetIndex = match.index;
          actualTarget = match[0];
        } else {
          return { prevContext: '', nextContext: '', targetIndex: -1, actualTarget: targetText };
        }
      } else {
        return { prevContext: '', nextContext: '', targetIndex: -1, actualTarget: targetText };
      }
    } else {
      let charCount = 0;
      let realIndex = 0;
      for (let i = 0; i < fullText.length && charCount < normalizedIndex; i++) {
        if (!/\s/.test(fullText[i]) || (i > 0 && !/\s/.test(fullText[i-1]))) {
          charCount++;
        }
        realIndex = i;
      }
      targetIndex = Math.max(0, realIndex - normalizedTarget.length);
      
      const endIndex = Math.min(fullText.length, targetIndex + normalizedTarget.length + 100);
      actualTarget = fullText.substring(targetIndex, endIndex).split(/\n\n/)[0];
    }
  }
  
  const prevContext = fullText.substring(Math.max(0, targetIndex - contextChars), targetIndex);
  const nextContext = fullText.substring(
    targetIndex + actualTarget.length,
    targetIndex + actualTarget.length + contextChars
  );
  
  return { prevContext, nextContext, targetIndex, actualTarget };
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
    const { prevContext, nextContext, targetIndex, actualTarget } = extractContext(req.fullChapter, req.targetText);
    
    if (targetIndex === -1) {
      return {
        success: false,
        originalText: req.targetText,
        correctedText: req.targetText,
        diffStats: { wordsAdded: 0, wordsRemoved: 0, lengthChange: 0 },
        error: 'Texto objetivo no encontrado en el capítulo'
      };
    }

    const textToCorrect = actualTarget || req.targetText;

    const userPrompt = `### CONTEXTO PREVIO (NO EDITAR)
${prevContext.slice(-300)}

### TEXTO A CORREGIR (TARGET)
"${textToCorrect}"

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

    if (!correctedText || correctedText.length > textToCorrect.length * 2.5) {
      return {
        success: false,
        originalText: textToCorrect,
        correctedText: textToCorrect,
        diffStats: { wordsAdded: 0, wordsRemoved: 0, lengthChange: 0 },
        error: 'Corrección descartada por anomalía de longitud'
      };
    }

    const diffStats = calculateDiffStats(textToCorrect, correctedText);

    return {
      success: true,
      originalText: textToCorrect,
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

function isGenericIssue(description: string, location: string): boolean {
  const genericPatterns = [
    /a lo largo de la novela/i,
    /de forma (muy )?similar/i,
    /repetitiv[ao]/i,
    /en múltiples (capítulos|escenas|lugares)/i,
    /frecuentemente/i,
    /constantemente/i,
    /siempre (se|usa|describe)/i,
    /en general/i,
    /throughout/i
  ];
  
  const hasGenericPattern = genericPatterns.some(p => p.test(description));
  const hasSpecificLocation = location && /cap[íi]tulo\s*\d+/i.test(location) && !location.toLowerCase().includes('múltiples');
  
  if (hasSpecificLocation) {
    return false;
  }
  
  const lacksSpecificChapter = !location || location.toLowerCase().includes('general') || location.toLowerCase().includes('múltiples');
  
  return hasGenericPattern && lacksSpecificChapter;
}

function extractRepetitivePhrases(description: string): string[] {
  const phrases: string[] = [];
  
  const quotedMatches = description.match(/['""']([^'""']+)['""']/g);
  if (quotedMatches) {
    for (const match of quotedMatches) {
      const cleaned = match.replace(/['""']/g, '').trim();
      if (cleaned.length >= 5) {
        phrases.push(cleaned);
      }
    }
  }
  
  const patternMatches = description.match(/(?:como|frases como|expresiones como|palabras como)\s+['""']?([^,.'""']+)['""']?/gi);
  if (patternMatches) {
    for (const match of patternMatches) {
      const cleaned = match.replace(/^(?:como|frases como|expresiones como|palabras como)\s*/i, '').replace(/['""']/g, '').trim();
      if (cleaned.length >= 5 && !phrases.includes(cleaned)) {
        phrases.push(cleaned);
      }
    }
  }
  
  if (phrases.length === 0) {
    const keyPhrasePatterns = [
      /(?:describe|menciona|repite|usa)\s+(?:como\s+)?["']?([^,."']+)["']?/gi,
      /(?:el|la|los|las)\s+["']?([^,."']{10,40})["']?\s+(?:se repite|aparece|es repetitiv)/gi,
      /(?:repetición de|exceso de)\s+["']?([^,."']+)["']?/gi,
    ];
    
    for (const pattern of keyPhrasePatterns) {
      let match;
      while ((match = pattern.exec(description)) !== null) {
        const cleaned = match[1].trim();
        if (cleaned.length >= 5 && cleaned.length <= 50 && !phrases.includes(cleaned)) {
          phrases.push(cleaned);
        }
      }
    }
  }
  
  if (phrases.length === 0) {
    const nouns = description.match(/(?:dolor|anillo|cicatriz|marca|manchas?|ojos?|manos?|herida)[a-záéíóú\s]{0,20}/gi);
    if (nouns) {
      for (const noun of nouns.slice(0, 3)) {
        const cleaned = noun.trim();
        if (cleaned.length >= 5 && !phrases.includes(cleaned)) {
          phrases.push(cleaned);
        }
      }
    }
  }
  
  return phrases;
}

function extractNGramsFromDescription(description: string, novelContent: string): string[] {
  const keyWords = description
    .toLowerCase()
    .replace(/[.,;:!?()'"]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 4)
    .filter(w => !['como', 'para', 'pero', 'este', 'esta', 'esto', 'esos', 'esas', 'forma', 'manera', 'novela', 'texto', 'capítulo', 'capítulos'].includes(w));
  
  const uniqueWords = [...new Set(keyWords)];
  const foundPhrases: string[] = [];
  
  for (const word of uniqueWords.slice(0, 5)) {
    const wordPattern = new RegExp(`[^.!?]*\\b${word}\\b[^.!?]*[.!?]`, 'gi');
    const matches = novelContent.match(wordPattern);
    if (matches && matches.length >= 2) {
      const shortestMatch = matches.reduce((a, b) => a.length <= b.length ? a : b).trim();
      if (shortestMatch.length >= 20 && shortestMatch.length <= 200 && !foundPhrases.includes(shortestMatch)) {
        foundPhrases.push(shortestMatch);
      }
    }
  }
  
  return foundPhrases.slice(0, 10);
}

interface FoundPhrase {
  text: string;
  chapterNumber: number;
  chapterTitle: string;
  context: string;
  position: number;
}

function findAllOccurrences(novelContent: string, phrases: string[]): FoundPhrase[] {
  const found: FoundPhrase[] = [];
  
  const chapterPattern = /===\s*(?:CAPÍTULO|Capítulo|Cap\.?)\s*(\d+)[^=]*===\s*([\s\S]*?)(?====|$)/gi;
  const chapters: Array<{ num: number; title: string; content: string; startPos: number }> = [];
  
  let match;
  while ((match = chapterPattern.exec(novelContent)) !== null) {
    chapters.push({
      num: parseInt(match[1]),
      title: `Capítulo ${match[1]}`,
      content: match[2],
      startPos: match.index
    });
  }
  
  for (const phrase of phrases) {
    const escapedPhrase = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const fuzzyPattern = new RegExp(escapedPhrase.split(/\s+/).join('\\s+'), 'gi');
    
    for (const chapter of chapters) {
      let phraseMatch;
      while ((phraseMatch = fuzzyPattern.exec(chapter.content)) !== null) {
        const contextStart = Math.max(0, phraseMatch.index - 100);
        const contextEnd = Math.min(chapter.content.length, phraseMatch.index + phraseMatch[0].length + 100);
        
        found.push({
          text: phraseMatch[0],
          chapterNumber: chapter.num,
          chapterTitle: chapter.title,
          context: '...' + chapter.content.substring(contextStart, contextEnd).trim() + '...',
          position: chapter.startPos + phraseMatch.index
        });
      }
    }
  }
  
  return found.sort((a, b) => a.position - b.position);
}

async function generateAlternativePhrase(
  originalPhrase: string,
  context: string,
  issueDescription: string
): Promise<string> {
  try {
    const prompt = `Eres un editor literario. Debes proponer UNA alternativa para la siguiente frase repetitiva, manteniendo el mismo significado pero con vocabulario diferente.

FRASE ORIGINAL: "${originalPhrase}"

CONTEXTO: ${context}

PROBLEMA: ${issueDescription}

REGLAS:
1. Mantén el significado exacto
2. Usa vocabulario completamente diferente
3. Mantén el tono y registro del texto
4. Devuelve SOLO la frase alternativa, sin explicaciones ni comillas

FRASE ALTERNATIVA:`;

    const completion = await deepseek.chat.completions.create({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: 'Eres un editor literario experto en variación de vocabulario. Devuelve solo la frase alternativa.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.7,
      max_tokens: 200
    });

    return sanitizeResponse(completion.choices[0]?.message?.content || originalPhrase);
  } catch (error) {
    console.error('Error generando alternativa:', error);
    return originalPhrase;
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

    let totalOccurrences = 0;
    
    for (let i = 0; i < allIssues.length; i++) {
      const issue = allIssues[i];
      
      onProgress?.({
        phase: 'correcting',
        current: i + 1,
        total: allIssues.length,
        message: `Corrigiendo issue ${i + 1}/${allIssues.length}: ${issue.severity}`
      });

      const targetText = extractTargetFromLocation(correctedContent, issue.location, issue.description);
      
      if (targetText) {
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
        totalOccurrences++;

        if (result.success) {
          successCount++;
        }

        await new Promise(resolve => setTimeout(resolve, 500));
        continue;
      }

      if (isGenericIssue(issue.description, issue.location)) {
        onProgress?.({
          phase: 'analyzing',
          current: i + 1,
          total: allIssues.length,
          message: `Analizando problema genérico: buscando frases repetitivas...`
        });

        const repetitivePhrases = extractRepetitivePhrases(issue.description);
        
        if (repetitivePhrases.length > 0) {
          const occurrences = findAllOccurrences(correctedContent, repetitivePhrases);
          
          onProgress?.({
            phase: 'correcting',
            current: i + 1,
            total: allIssues.length,
            message: `Encontradas ${occurrences.length} ocurrencias. Generando alternativas...`
          });

          for (let j = 0; j < occurrences.length; j++) {
            const occurrence = occurrences[j];
            
            onProgress?.({
              phase: 'correcting',
              current: i + 1,
              total: allIssues.length,
              message: `Generando alternativa ${j + 1}/${occurrences.length} para "${occurrence.text.substring(0, 30)}..."`
            });

            const alternative = await generateAlternativePhrase(
              occurrence.text,
              occurrence.context,
              issue.description
            );

            const correctionRecord: CorrectionRecord = {
              id: `correction-${Date.now()}-${i}-${j}`,
              issueId: `issue-${i}`,
              location: occurrence.chapterTitle,
              chapterNumber: occurrence.chapterNumber,
              originalText: occurrence.text,
              correctedText: alternative,
              instruction: `[REPETICIÓN] ${issue.description}`,
              severity: issue.severity,
              status: alternative !== occurrence.text ? 'pending' : 'rejected',
              diffStats: calculateDiffStats(occurrence.text, alternative),
              createdAt: new Date().toISOString()
            };

            pendingCorrections.push(correctionRecord);

            if (alternative !== occurrence.text) {
              successCount++;
            }

            await new Promise(resolve => setTimeout(resolve, 300));
          }
          totalOccurrences += occurrences.length;
        } else {
          onProgress?.({
            phase: 'analyzing',
            current: i + 1,
            total: allIssues.length,
            message: `Buscando patrones con n-gramas...`
          });

          const ngramPhrases = extractNGramsFromDescription(issue.description, correctedContent);
          
          if (ngramPhrases.length > 0) {
            onProgress?.({
              phase: 'correcting',
              current: i + 1,
              total: allIssues.length,
              message: `Encontradas ${ngramPhrases.length} frases con n-gramas. Generando alternativas...`
            });

            for (let j = 0; j < ngramPhrases.length; j++) {
              const phrase = ngramPhrases[j];
              
              const alternative = await generateAlternativePhrase(
                phrase,
                phrase,
                issue.description
              );

              const correctionRecord: CorrectionRecord = {
                id: `correction-${Date.now()}-${i}-ngram-${j}`,
                issueId: `issue-${i}`,
                location: 'Múltiples capítulos',
                chapterNumber: 0,
                originalText: phrase,
                correctedText: alternative,
                instruction: `[REPETICIÓN-NGRAMA] ${issue.description}`,
                severity: issue.severity,
                status: alternative !== phrase ? 'pending' : 'rejected',
                diffStats: calculateDiffStats(phrase, alternative),
                createdAt: new Date().toISOString()
              };

              pendingCorrections.push(correctionRecord);

              if (alternative !== phrase) {
                successCount++;
              }

              await new Promise(resolve => setTimeout(resolve, 300));
            }
            totalOccurrences += ngramPhrases.length;
          } else {
            pendingCorrections.push({
              id: `correction-${Date.now()}-${i}`,
              issueId: `issue-${i}`,
              location: issue.location,
              chapterNumber: 0,
              originalText: '[Problema genérico sin frases identificables]',
              correctedText: '',
              instruction: issue.description,
              severity: issue.severity,
              status: 'rejected',
              diffStats: { wordsAdded: 0, wordsRemoved: 0, lengthChange: 0 },
              createdAt: new Date().toISOString()
            });
            totalOccurrences++;
          }
        }
        continue;
      }

      pendingCorrections.push({
        id: `correction-${Date.now()}-${i}`,
        issueId: `issue-${i}`,
        location: issue.location,
        chapterNumber: parseInt(issue.location.match(/\d+/)?.[0] || '0'),
        originalText: '[No se pudo localizar el texto exacto]',
        correctedText: '',
        instruction: issue.description,
        severity: issue.severity,
        status: 'rejected',
        diffStats: { wordsAdded: 0, wordsRemoved: 0, lengthChange: 0 },
        createdAt: new Date().toISOString()
      });
      totalOccurrences++;
    }

    await db.update(correctedManuscripts)
      .set({
        status: 'review',
        correctedContent,
        pendingCorrections,
        totalIssues: totalOccurrences,
        correctedIssues: successCount
      })
      .where(eq(correctedManuscripts.id, manuscript.id));

    onProgress?.({
      phase: 'completed',
      current: allIssues.length,
      total: allIssues.length,
      message: `Corrección completada. ${successCount}/${totalOccurrences} correcciones generadas (de ${allIssues.length} issues). Esperando revisión.`
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
    const nonCorrectableMarkers = [
      '[No se pudo localizar el texto exacto]',
      '[Problema genérico sin frases identificables]'
    ];
    if (!nonCorrectableMarkers.includes(correction.originalText)) {
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
