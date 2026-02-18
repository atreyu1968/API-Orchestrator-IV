import OpenAI from 'openai';
import { db } from '../db';
import { correctedManuscripts } from '@shared/schema';
import { eq } from 'drizzle-orm';
import type { CorrectionRecord, AuditIssue } from '@shared/schema';

const deepseek = new OpenAI({
  baseURL: 'https://api.deepseek.com',
  apiKey: process.env.DEEPSEEK_API_KEY
});

export interface StructuralIssue {
  id: string;
  type: 'duplicate_chapters' | 'duplicate_scenes' | 'redundant_content' | 'continuity_conflict' | 'repeated_scene' | 'narrative_flow_break';
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  description: string;
  affectedChapters: number[];
  affectedContent: string[];
  resolutionOptions: ResolutionOption[];
  conflictDetails?: ContinuityConflict;
  recommendedOption?: string;
}

export interface ContinuityConflict {
  chapterA: number;
  chapterB: number;
  factA: string;
  factB: string;
  conflictType: 'temporal' | 'spatial' | 'character' | 'object' | 'logic';
}

export interface ResolutionOption {
  id: string;
  type: 'delete' | 'rewrite' | 'merge' | 'modify_a' | 'modify_b' | 'add_explanation' | 'add_transition';
  label: string;
  description: string;
  chaptersToDelete?: number[];
  chapterToKeep?: number;
  chaptersToMerge?: number[];
  chapterToModify?: number;
  targetFact?: string;
  correctFact?: string;
  estimatedTokens?: number;
  transitionContext?: {
    fromChapter: number;
    toChapter: number;
    endingContext: string;
    startingContext: string;
  };
}

export interface StructuralResolutionProgress {
  phase: 'detecting' | 'resolving' | 'rewriting' | 'completed' | 'error';
  message: string;
  current?: number;
  total?: number;
}

export function detectStructuralIssues(
  auditIssues: AuditIssue[],
  manuscriptContent: string
): StructuralIssue[] {
  const structuralIssues: StructuralIssue[] = [];
  
  for (const issue of auditIssues) {
    if (isStructuralIssue(issue)) {
      const chapters = extractAffectedChapters(issue.location, issue.description);
      
      if (chapters.length > 1) {
        const structuralIssue: StructuralIssue = {
          id: `structural-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          type: detectStructuralType(issue.description),
          severity: issue.severity,
          description: issue.description,
          affectedChapters: chapters,
          affectedContent: extractAffectedContent(manuscriptContent, chapters),
          resolutionOptions: generateResolutionOptions(chapters, issue.description)
        };
        
        structuralIssues.push(structuralIssue);
      }
    }
  }
  
  return structuralIssues;
}

function isStructuralIssue(issue: AuditIssue): boolean {
  const structuralPatterns = [
    /capítulos?\s+(son\s+)?idénticos/i,
    /repetición\s+literal/i,
    /mismo[s]?\s+evento[s]?/i,
    /contenido\s+duplicado/i,
    /escenas?\s+duplicada/i,
    /capítulos?\s+duplicados/i,
    /exactamente\s+los\s+mismos/i,
    /narran\s+lo\s+mismo/i,
    /repiten?\s+(el|los)\s+mismo/i,
    /se\s+repite\s+en\s+\w+\s+capítulos/i,
    /sensación\s+de\s*repetición/i,
    /teléfono.*vibr.*repite/i,
    /llamada.*repite/i,
    /interacción\s+redundante/i,
    /redundante\s+con/i,
    /el\s+mismo\s+\w+\s+(para|que)/i,
    /primera\s+parte.*segunda\s+parte/i
  ];
  
  const descriptionLower = issue.description.toLowerCase();
  const hasMultipleChapters = (issue.location?.match(/capítulo/gi)?.length || 0) >= 2 ||
                              (issue.location?.match(/,/g)?.length || 0) >= 2;
  const hasRedundancy = descriptionLower.includes('redundant') || 
                        descriptionLower.includes('mismo fragmento') ||
                        descriptionLower.includes('el mismo') ||
                        (descriptionLower.includes('primera') && descriptionLower.includes('segunda'));
  
  const isDialogueFix = /fecha.*inconsistente|afirma.*sin embargo|'[^']+'.*pero|hace\s+\w+\s+semanas/i.test(issue.description);
  
  return structuralPatterns.some(pattern => pattern.test(issue.description)) ||
    (descriptionLower.includes('capítulo') && 
     (descriptionLower.includes('idéntic') || descriptionLower.includes('duplic'))) ||
    (hasMultipleChapters && (descriptionLower.includes('repite') || descriptionLower.includes('similar'))) ||
    hasRedundancy ||
    isDialogueFix;
}

export function isDialogueFixableIssue(issue: AuditIssue): boolean {
  const dialoguePatterns = [
    /fecha.*inconsistente/i,
    /tiempo.*inconsistente/i,
    /cronología.*inconsistente/i,
    /afirma\s+que.*sin\s+embargo/i,
    /dice\s+que.*pero/i,
    /menciona.*contradice/i,
    /'[^']+'\s*(para|pero|sin embargo)/i,
    /"[^"]+"\s*(para|pero|sin embargo)/i,
    /hace\s+(dos|tres|cuatro|cinco|\d+)\s+(semanas?|días?|meses?)/i,
    /contraste\s+narrativo/i
  ];
  
  return dialoguePatterns.some(p => p.test(issue.description));
}

export function isContinuityConflict(issue: AuditIssue): boolean {
  const conflictPatterns = [
    /capítulo\s*\d+\s*vs\.?\s*capítulo\s*\d+/i,
    /sin embargo,?\s*(en|el)\s*capítulo/i,
    /inconsistencia\s*(temporal|lógica|de continuidad)/i,
    /contradicción\s*(en|entre)/i,
    /existe\s*una?\s*contradicción/i,
    /en\s*el\s*capítulo\s*\d+.*pero\s*(en\s*el\s*)?capítulo\s*\d+/i,
    /genera\s*una\s*inconsistencia/i,
    /esto\s*genera\s*una\s*incons/i,
    /capítulo\s*\d+.*sin embargo.*capítulo\s*\d+/i,
    /afiliación.*matones/i,
    /napolitano.*calabr/i,
    /calabr.*napolitano/i
  ];
  
  const locationPattern = /capítulo\s*\d+\s*vs\.?\s*capítulo\s*\d+/i;
  
  const fullText = `${issue.location || ''} ${issue.description}`;
  const hasConflictPattern = conflictPatterns.some(p => p.test(fullText));
  const hasVsInLocation = locationPattern.test(issue.location || '');
  
  console.log(`[ContinuityConflict] Checking: location="${issue.location?.substring(0, 50)}", hasVs=${hasVsInLocation}, hasPattern=${hasConflictPattern}`);
  
  return hasConflictPattern || hasVsInLocation;
}

export function isNarrativeFlowIssue(issue: AuditIssue): boolean {
  const flowPatterns = [
    /fluidez\s*narrativa/i,
    /inconsistencia\s*(en\s*la\s*)?fluidez/i,
    /interrup(ción|e)\s*(abrupta|de\s*la\s*narrativa)/i,
    /ruptura\s*(de\s*)?narrativa/i,
    /transición\s*(abrupta|brusca|inexistente)/i,
    /no\s*hay\s*(una\s*)?transición/i,
    /sin\s*transición/i,
    /salto\s*(abrupto|brusco|narrativo)/i,
    /cambio\s*significativo\s*de\s*(ubicación|escena)/i,
    /no\s*se\s*explica\s*cómo/i,
    /termina\s*con.*comienza\s*con/i,
    /cap[íi]tulo\s*\d+\s*vs\.?\s*cap[íi]tulo\s*\d+/i
  ];
  
  const fullText = `${issue.location || ''} ${issue.description}`;
  const hasFlowPattern = flowPatterns.some(p => p.test(fullText));
  const hasFluidezKeyword = fullText.toLowerCase().includes('fluidez') || 
                            fullText.toLowerCase().includes('transición') ||
                            (fullText.toLowerCase().includes('termina') && fullText.toLowerCase().includes('comienza'));
  
  console.log(`[NarrativeFlow] Checking: "${issue.description?.substring(0, 60)}...", hasPattern=${hasFlowPattern}, hasKeyword=${hasFluidezKeyword}`);
  
  return hasFlowPattern || hasFluidezKeyword;
}

export function extractFlowBreakContext(issue: AuditIssue, manuscriptContent: string): { fromChapter: number; toChapter: number; endingContext: string; startingContext: string } | null {
  const vsMatch = (issue.location || '').match(/cap[íi]tulo\s*(\d+)\s*vs\.?\s*cap[íi]tulo\s*(\d+)/i) ||
                  issue.description.match(/cap[íi]tulo\s*(\d+)\s*vs\.?\s*cap[íi]tulo\s*(\d+)/i);
  
  if (!vsMatch) {
    const chapPattern = /cap[íi]tulo\s*(\d+)/gi;
    const chapters: number[] = [];
    let m;
    while ((m = chapPattern.exec(issue.description)) !== null) {
      const num = parseInt(m[1]);
      if (!chapters.includes(num)) chapters.push(num);
    }
    if (chapters.length >= 2) {
      chapters.sort((a, b) => a - b);
      return extractChapterContexts(chapters[0], chapters[1], manuscriptContent);
    }
    return null;
  }
  
  const fromChapter = parseInt(vsMatch[1]);
  const toChapter = parseInt(vsMatch[2]);
  
  return extractChapterContexts(fromChapter, toChapter, manuscriptContent);
}

function extractChapterContexts(fromChapter: number, toChapter: number, manuscriptContent: string): { fromChapter: number; toChapter: number; endingContext: string; startingContext: string } {
  const getChapterEnd = (chapterNum: number): string => {
    const chapterPattern = new RegExp(`===\\s*(?:CAPÍTULO|Capítulo|Cap\\.?)\\s*${chapterNum}[^=]*===([\\s\\S]*?)(?====\\s*(?:CAPÍTULO|Capítulo|Cap\\.?|EPÍLOGO)|$)`, 'i');
    const match = manuscriptContent.match(chapterPattern);
    if (match && match[1]) {
      const content = match[1].trim();
      const paragraphs = content.split(/\n\n+/);
      const lastParagraphs = paragraphs.slice(-3).join('\n\n');
      return lastParagraphs.length > 1500 ? lastParagraphs.substring(lastParagraphs.length - 1500) : lastParagraphs;
    }
    return '';
  };
  
  const getChapterStart = (chapterNum: number): string => {
    const chapterPattern = new RegExp(`===\\s*(?:CAPÍTULO|Capítulo|Cap\\.?)\\s*${chapterNum}[^=]*===([\\s\\S]*?)(?====\\s*(?:CAPÍTULO|Capítulo|Cap\\.?|EPÍLOGO)|$)`, 'i');
    const match = manuscriptContent.match(chapterPattern);
    if (match && match[1]) {
      const content = match[1].trim();
      const paragraphs = content.split(/\n\n+/);
      const firstParagraphs = paragraphs.slice(0, 3).join('\n\n');
      return firstParagraphs.length > 1500 ? firstParagraphs.substring(0, 1500) : firstParagraphs;
    }
    return '';
  };
  
  return {
    fromChapter,
    toChapter,
    endingContext: getChapterEnd(fromChapter),
    startingContext: getChapterStart(toChapter)
  };
}

export function generateFlowTransitionOptions(
  fromChapter: number,
  toChapter: number,
  description: string,
  manuscriptContent: string
): ResolutionOption[] {
  const options: ResolutionOption[] = [];
  const context = extractChapterContexts(fromChapter, toChapter, manuscriptContent);
  
  options.push({
    id: `add-transition-end-${fromChapter}`,
    type: 'add_transition',
    label: `✨ RECOMENDADO: Añadir transición al final del Capítulo ${fromChapter}`,
    description: `Genera 1-2 párrafos de transición al final del Capítulo ${fromChapter} que faciliten el paso narrativo hacia el Capítulo ${toChapter}. Incluye anticipación sutil del cambio de escena.`,
    chapterToModify: fromChapter,
    transitionContext: context,
    estimatedTokens: 1200
  });
  
  options.push({
    id: `add-transition-start-${toChapter}`,
    type: 'add_transition',
    label: `Añadir transición al inicio del Capítulo ${toChapter}`,
    description: `Genera 1-2 párrafos de apertura del Capítulo ${toChapter} que conecten narrativamente con el cierre del Capítulo ${fromChapter}. Incluye orientación contextual para el lector.`,
    chapterToModify: toChapter,
    transitionContext: context,
    estimatedTokens: 1200
  });
  
  options.push({
    id: `add-transition-both-${fromChapter}-${toChapter}`,
    type: 'add_transition',
    label: `Añadir transiciones a ambos capítulos`,
    description: `Genera transiciones complementarias: un párrafo de cierre para el Capítulo ${fromChapter} y otro de apertura para el Capítulo ${toChapter}, creando una conexión narrativa fluida.`,
    chaptersToMerge: [fromChapter, toChapter],
    transitionContext: context,
    estimatedTokens: 2000
  });
  
  return options;
}

export function extractContinuityConflict(issue: AuditIssue): ContinuityConflict | null {
  const vsMatch = (issue.location || '').match(/capítulo\s*(\d+)\s*vs\.?\s*capítulo\s*(\d+)/i) ||
                  issue.description.match(/capítulo\s*(\d+)\s*vs\.?\s*capítulo\s*(\d+)/i);
  
  if (!vsMatch) {
    const chapPattern = /capítulo\s*(\d+)/gi;
    const chapters: number[] = [];
    let m;
    while ((m = chapPattern.exec(issue.description)) !== null) {
      const num = parseInt(m[1]);
      if (!chapters.includes(num)) chapters.push(num);
    }
    if (chapters.length >= 2) {
      return {
        chapterA: chapters[0],
        chapterB: chapters[1],
        factA: '',
        factB: '',
        conflictType: detectConflictType(issue.description)
      };
    }
    return null;
  }
  
  const chapterA = parseInt(vsMatch[1]);
  const chapterB = parseInt(vsMatch[2]);
  
  const factAMatch = issue.description.match(/\*\*Capítulo\s*\d+\*\*[:\s]*["']([^"']+)["']/i) ||
                    issue.description.match(/en\s*el\s*capítulo\s*\d+[,\s]+([^.]+)/i);
  const factBMatch = issue.description.match(/\*\*Capítulo\s*\d+\*\*[:\s]*["']([^"']+)["']/gi);
  
  let factA = factAMatch ? factAMatch[1] : '';
  let factB = '';
  
  if (factBMatch && factBMatch.length >= 2) {
    const secondMatch = factBMatch[1].match(/["']([^"']+)["']/);
    if (secondMatch) factB = secondMatch[1];
  }
  
  return {
    chapterA,
    chapterB,
    factA,
    factB,
    conflictType: detectConflictType(issue.description)
  };
}

function detectConflictType(description: string): 'temporal' | 'spatial' | 'character' | 'object' | 'logic' {
  const desc = description.toLowerCase();
  
  if (desc.includes('hora') || desc.includes('tiempo') || desc.includes('22:') || 
      desc.includes('amanecer') || desc.includes('noche') || desc.includes('día')) {
    return 'temporal';
  }
  if (desc.includes('lugar') || desc.includes('ubicación') || desc.includes('casa') ||
      desc.includes('despacho') || desc.includes('oficina')) {
    return 'spatial';
  }
  if (desc.includes('personaje') || desc.includes('nombre') || desc.includes('cabello') ||
      desc.includes('ojos') || desc.includes('aspecto')) {
    return 'character';
  }
  if (desc.includes('objeto') || desc.includes('arma') || desc.includes('coche') ||
      desc.includes('documento')) {
    return 'object';
  }
  return 'logic';
}

export function generateContinuityResolutionOptions(
  conflict: ContinuityConflict,
  description: string
): ResolutionOption[] {
  const options: ResolutionOption[] = [];
  
  options.push({
    id: `modify-a-${conflict.chapterA}`,
    type: 'modify_a',
    label: `Modificar Capítulo ${conflict.chapterA}`,
    description: `Ajustar el Capítulo ${conflict.chapterA} para que sea consistente con el Capítulo ${conflict.chapterB}`,
    chapterToModify: conflict.chapterA,
    estimatedTokens: 1500
  });
  
  options.push({
    id: `modify-b-${conflict.chapterB}`,
    type: 'modify_b',
    label: `Modificar Capítulo ${conflict.chapterB}`,
    description: `Ajustar el Capítulo ${conflict.chapterB} para que sea consistente con el Capítulo ${conflict.chapterA}`,
    chapterToModify: conflict.chapterB,
    estimatedTokens: 1500
  });
  
  options.push({
    id: `explain-${conflict.chapterA}-${conflict.chapterB}`,
    type: 'add_explanation',
    label: 'Añadir explicación narrativa',
    description: `Insertar una explicación en el texto que justifique la aparente inconsistencia (ej: paso del tiempo, cambio de planes del personaje, etc.)`,
    chapterToModify: conflict.chapterB,
    estimatedTokens: 800
  });
  
  return options;
}

function detectStructuralType(description: string): 'duplicate_chapters' | 'duplicate_scenes' | 'redundant_content' {
  const descLower = description.toLowerCase();
  
  if (descLower.includes('capítulo') && (descLower.includes('idéntic') || descLower.includes('duplicad'))) {
    return 'duplicate_chapters';
  }
  
  if (descLower.includes('escena') && (descLower.includes('duplicad') || descLower.includes('repet'))) {
    return 'duplicate_scenes';
  }
  
  return 'redundant_content';
}

function extractAffectedChapters(location: string, description: string): number[] {
  const chapters: number[] = [];
  const fullText = `${location} ${description}`;
  
  const capituloPattern = /Capítulo\s*(\d+)/gi;
  let match;
  while ((match = capituloPattern.exec(fullText)) !== null) {
    const num = parseInt(match[1]);
    if (!chapters.includes(num) && num > 0 && num < 200) {
      chapters.push(num);
    }
  }
  
  const rangePattern = /capítulos?\s*(\d+)\s*(?:,\s*(\d+)\s*)?(?:y|,)\s*(?:capítulo\s*)?(\d+)/gi;
  while ((match = rangePattern.exec(fullText)) !== null) {
    for (let i = 1; i <= 3; i++) {
      if (match[i]) {
        const num = parseInt(match[i]);
        if (!chapters.includes(num) && num > 0 && num < 200) {
          chapters.push(num);
        }
      }
    }
  }
  
  const numberListPattern = /(\d+)\s*,\s*(\d+)\s*y\s*(\d+)/g;
  while ((match = numberListPattern.exec(fullText)) !== null) {
    for (let i = 1; i <= 3; i++) {
      if (match[i]) {
        const num = parseInt(match[i]);
        if (!chapters.includes(num) && num > 0 && num < 200) {
          chapters.push(num);
        }
      }
    }
  }
  
  const twoNumberPattern = /(\d+)\s*y\s*(\d+)/g;
  while ((match = twoNumberPattern.exec(fullText)) !== null) {
    for (let i = 1; i <= 2; i++) {
      if (match[i]) {
        const num = parseInt(match[i]);
        if (!chapters.includes(num) && num > 0 && num < 200) {
          chapters.push(num);
        }
      }
    }
  }
  
  if (location) {
    const locationPattern = /(\d+)/g;
    const locationParts = location.split(/[,y]/i);
    for (const part of locationParts) {
      const numMatch = part.match(locationPattern);
      if (numMatch) {
        for (const n of numMatch) {
          const num = parseInt(n);
          if (!chapters.includes(num) && num > 0 && num < 200) {
            chapters.push(num);
          }
        }
      }
    }
  }
  
  return chapters.sort((a, b) => a - b);
}

function extractAffectedContent(manuscriptContent: string, chapters: number[]): string[] {
  const content: string[] = [];
  
  for (const chapterNum of chapters) {
    const chapterPattern = new RegExp(
      `(Capítulo\\s*${chapterNum}[^\\n]*\\n)([\\s\\S]*?)(?=Capítulo\\s*\\d+|$)`,
      'i'
    );
    const match = manuscriptContent.match(chapterPattern);
    if (match) {
      content.push(match[0].trim());
    }
  }
  
  return content;
}

function isRepeatedSceneIssue(description: string): boolean {
  const patterns = [
    /se repite\s*(con|en)/i,
    /repeti(ción|tiv[ao])/i,
    /misma\s*(escena|descripción|acción)/i,
    /muy\s*similar(es)?/i,
    /sensación\s*de\s*repetición/i,
    /objeto(tiva)?mente\s*se\s*repite/i,
    /teléfono\s*vibr/i,
    /llamada\s*(de|del)\s*\w+\s*se\s*repite/i
  ];
  return patterns.some(p => p.test(description));
}

function isRedundantInteractionIssue(description: string): boolean {
  const patterns = [
    /interacción\s+redundante/i,
    /redundante\s+con/i,
    /el\s+mismo\s+\w+\s+(para|que)/i,
    /primera\s+parte.*segunda\s+parte/i,
    /mismo\s+fragmento/i,
    /entrega.*el\s+mismo/i
  ];
  return patterns.some(p => p.test(description));
}

function generateResolutionOptions(chapters: number[], description: string): ResolutionOption[] {
  const options: ResolutionOption[] = [];
  const isRepeatedScene = isRepeatedSceneIssue(description);
  const isRedundant = isRedundantInteractionIssue(description);
  
  if (isRedundant && chapters.length <= 1) {
    const chapterName = chapters.length === 1 ? `Capítulo ${chapters[0]}` : 'Epílogo';
    
    options.push({
      id: `remove-first-occurrence`,
      type: 'rewrite',
      label: `✨ RECOMENDADO: Eliminar primera aparición`,
      description: `Elimina la primera interacción redundante del ${chapterName}, manteniendo la segunda que es más significativa narrativamente.`,
      chaptersToMerge: chapters.length > 0 ? chapters : [0],
      estimatedTokens: 2000
    });
    
    options.push({
      id: `remove-second-occurrence`,
      type: 'rewrite',
      label: `Eliminar segunda aparición`,
      description: `Elimina la segunda interacción del ${chapterName}, manteniendo solo la primera.`,
      chaptersToMerge: chapters.length > 0 ? chapters : [0],
      estimatedTokens: 2000
    });
    
    options.push({
      id: `modify-to-differ`,
      type: 'rewrite',
      label: `Modificar para diferenciar`,
      description: `Modifica una de las interacciones para que sean claramente diferentes y no redundantes.`,
      chaptersToMerge: chapters.length > 0 ? chapters : [0],
      estimatedTokens: 2500
    });
    
    return options;
  }
  
  const isDialogueFix = /fecha.*inconsistente|afirma.*sin embargo|'[^']+'.*pero|hace\s+\w+\s+semanas/i.test(description);
  if (isDialogueFix) {
    options.push({
      id: `fix-dialogue`,
      type: 'rewrite',
      label: `✨ RECOMENDADO: Corregir el diálogo`,
      description: `Modifica el diálogo para que sea consistente con la cronología establecida. Ajusta la referencia temporal para que coincida con los eventos.`,
      chaptersToMerge: chapters.length > 0 ? chapters : [0],
      estimatedTokens: 2000
    });
    
    options.push({
      id: `add-clarification`,
      type: 'rewrite',
      label: `Añadir aclaración narrativa`,
      description: `Mantiene el diálogo pero añade una aclaración del narrador que explique la discrepancia o corrija la percepción del lector.`,
      chaptersToMerge: chapters.length > 0 ? chapters : [0],
      estimatedTokens: 2500
    });
    
    return options;
  }
  
  if (isRepeatedScene && chapters.length > 2) {
    options.push({
      id: `vary-all-scenes`,
      type: 'rewrite',
      label: `✨ RECOMENDADO: Variar la escena en cada capítulo`,
      description: `Mantiene la primera aparición y genera variaciones únicas para los capítulos ${chapters.slice(1).join(', ')}. Cada variación tendrá diferente enfoque narrativo.`,
      chaptersToMerge: chapters.slice(1),
      estimatedTokens: chapters.length * 1500
    });
    
    options.push({
      id: `keep-first-remove-rest`,
      type: 'delete',
      label: `Eliminar escena de capítulos posteriores`,
      description: `Mantiene la escena solo en Capítulo ${chapters[0]} y la elimina de los capítulos ${chapters.slice(1).join(', ')}`,
      chapterToKeep: chapters[0],
      chaptersToDelete: chapters.slice(1)
    });
    
    options.push({
      id: `keep-last-remove-rest`,
      type: 'delete',
      label: `Mantener solo en último capítulo`,
      description: `Elimina la escena de los capítulos ${chapters.slice(0, -1).join(', ')} y la mantiene solo en Capítulo ${chapters[chapters.length - 1]}`,
      chapterToKeep: chapters[chapters.length - 1],
      chaptersToDelete: chapters.slice(0, -1)
    });
  } else {
    options.push({
      id: `delete-keep-first`,
      type: 'delete',
      label: `Eliminar duplicados (mantener Capítulo ${chapters[0]})`,
      description: `Mantiene el Capítulo ${chapters[0]} y elimina los capítulos ${chapters.slice(1).join(', ')}`,
      chapterToKeep: chapters[0],
      chaptersToDelete: chapters.slice(1)
    });
    
    if (chapters.length > 1) {
      options.push({
        id: `delete-keep-last`,
        type: 'delete',
        label: `Eliminar duplicados (mantener Capítulo ${chapters[chapters.length - 1]})`,
        description: `Mantiene el Capítulo ${chapters[chapters.length - 1]} y elimina los capítulos ${chapters.slice(0, -1).join(', ')}`,
        chapterToKeep: chapters[chapters.length - 1],
        chaptersToDelete: chapters.slice(0, -1)
      });
    }
    
    for (const chapter of chapters.slice(1)) {
      options.push({
        id: `rewrite-${chapter}`,
        type: 'rewrite',
        label: `Reescribir Capítulo ${chapter}`,
        description: `Genera contenido completamente nuevo para el Capítulo ${chapter}, diferente al Capítulo ${chapters[0]}`,
        chaptersToMerge: [chapter],
        estimatedTokens: 3000
      });
    }
    
    if (chapters.length === 2) {
      options.push({
        id: `merge-${chapters.join('-')}`,
        type: 'merge',
        label: `Fusionar Capítulos ${chapters.join(' y ')}`,
        description: `Combina los mejores elementos de ambos capítulos en uno solo`,
        chaptersToMerge: chapters,
        estimatedTokens: 4000
      });
    }
  }
  
  return options;
}

export async function applyStructuralResolution(
  manuscriptId: number,
  issueId: string,
  optionId: string,
  onProgress?: (progress: StructuralResolutionProgress) => void
): Promise<{ success: boolean; error?: string }> {
  try {
    const [manuscript] = await db.select()
      .from(correctedManuscripts)
      .where(eq(correctedManuscripts.id, manuscriptId));
    
    if (!manuscript) {
      return { success: false, error: 'Manuscrito no encontrado' };
    }
    
    const pendingCorrections = (manuscript.pendingCorrections as CorrectionRecord[]) || [];
    const structuralCorrection = pendingCorrections.find(c => c.id === issueId);
    
    if (!structuralCorrection) {
      return { success: false, error: 'Issue estructural no encontrado' };
    }
    
    const structuralIssue = getStructuralIssueFromCorrection(structuralCorrection);
    if (!structuralIssue) {
      return { success: false, error: 'No es un problema estructural válido' };
    }
    
    const option = structuralIssue.resolutionOptions.find(o => o.id === optionId);
    if (!option) {
      return { success: false, error: `Opción de resolución '${optionId}' no válida. Opciones disponibles: ${structuralIssue.resolutionOptions.map(o => o.id).join(', ')}` };
    }
    
    let content = manuscript.correctedContent || manuscript.originalContent;
    
    onProgress?.({
      phase: 'resolving',
      message: `Aplicando resolución: ${option.type}...`
    });
    
    switch (option.type) {
      case 'delete':
        content = await applyDeleteResolution(content, option, onProgress);
        break;
      case 'rewrite':
        content = await applyRewriteResolution(content, option, structuralCorrection.instruction, onProgress);
        break;
      case 'merge':
        content = await applyMergeResolution(content, option, onProgress);
        break;
      case 'modify_a':
      case 'modify_b':
      case 'add_explanation':
        if (structuralIssue.conflictDetails) {
          content = await applyContinuityResolution(
            content,
            option,
            structuralIssue.conflictDetails,
            structuralCorrection.instruction,
            onProgress
          );
        } else {
          return { success: false, error: 'No hay detalles del conflicto de continuidad' };
        }
        break;
      case 'add_transition':
        if (option.transitionContext) {
          content = await applyTransitionResolution(
            content,
            option,
            structuralCorrection.instruction,
            onProgress
          );
        } else {
          return { success: false, error: 'No hay contexto de transición disponible' };
        }
        break;
    }
    
    const updatedCorrections = pendingCorrections.map(c => {
      if (c.id === issueId) {
        return {
          ...c,
          status: 'applied' as const,
          correctedText: `[RESOLUCIÓN ESTRUCTURAL] ${option.type}: ${option.description}`,
          reviewedAt: new Date().toISOString()
        };
      }
      return c;
    });
    
    await db.update(correctedManuscripts)
      .set({
        correctedContent: content,
        pendingCorrections: updatedCorrections,
        approvedIssues: (manuscript.approvedIssues || 0) + 1
      })
      .where(eq(correctedManuscripts.id, manuscriptId));
    
    onProgress?.({
      phase: 'completed',
      message: 'Resolución estructural aplicada exitosamente'
    });
    
    return { success: true };
  } catch (error) {
    console.error('Error aplicando resolución estructural:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Error desconocido' };
  }
}

async function applyDeleteResolution(
  content: string,
  option: ResolutionOption,
  onProgress?: (progress: StructuralResolutionProgress) => void
): Promise<string> {
  let updatedContent = content;
  const chaptersToDelete = option.chaptersToDelete || [];
  
  for (let i = 0; i < chaptersToDelete.length; i++) {
    const chapterNum = chaptersToDelete[i];
    
    onProgress?.({
      phase: 'resolving',
      message: `Eliminando Capítulo ${chapterNum}...`,
      current: i + 1,
      total: chaptersToDelete.length
    });
    
    const chapterPattern = new RegExp(
      `(Capítulo\\s*${chapterNum}[^\\n]*\\n)([\\s\\S]*?)(?=Capítulo\\s*\\d+|$)`,
      'i'
    );
    
    updatedContent = updatedContent.replace(chapterPattern, '');
  }
  
  updatedContent = renumberChapters(updatedContent);
  
  return updatedContent;
}

async function applyRewriteResolution(
  content: string,
  option: ResolutionOption,
  issueDescription: string,
  onProgress?: (progress: StructuralResolutionProgress) => void
): Promise<string> {
  const chapterToRewrite = option.chaptersToMerge?.[0];
  if (!chapterToRewrite) return content;
  
  onProgress?.({
    phase: 'rewriting',
    message: `Generando nuevo contenido para Capítulo ${chapterToRewrite}...`
  });
  
  const chapterPattern = new RegExp(
    `(Capítulo\\s*${chapterToRewrite}[^\\n]*\\n)([\\s\\S]*?)(?=Capítulo\\s*\\d+|$)`,
    'i'
  );
  
  const match = content.match(chapterPattern);
  if (!match) return content;
  
  const chapterHeader = match[1];
  const originalChapterContent = match[2];
  
  const prevChapter = extractChapterContent(content, chapterToRewrite - 1);
  const nextChapter = extractChapterContent(content, chapterToRewrite + 1);
  
  const prompt = `Eres un novelista experto. El siguiente capítulo tiene contenido duplicado con otros capítulos y debe ser COMPLETAMENTE REESCRITO con eventos DIFERENTES.

PROBLEMA: ${issueDescription}

CAPÍTULO ANTERIOR (para continuidad):
${prevChapter ? prevChapter.substring(0, 2000) : 'Es el primer capítulo.'}

CAPÍTULO A REESCRIBIR:
${originalChapterContent}

CAPÍTULO SIGUIENTE (para continuidad):
${nextChapter ? nextChapter.substring(0, 2000) : 'Es el último capítulo.'}

INSTRUCCIONES:
1. Genera contenido COMPLETAMENTE NUEVO y DIFERENTE
2. Mantén los mismos personajes pero con eventos distintos
3. Asegura continuidad con el capítulo anterior y siguiente
4. Mantén el estilo y tono del autor original
5. Longitud similar al original (${originalChapterContent.split(/\s+/).length} palabras aprox.)

Devuelve SOLO el contenido del capítulo reescrito, sin el encabezado "Capítulo X":`;

  try {
    const response = await deepseek.chat.completions.create({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: 'Eres un novelista profesional que reescribe capítulos manteniendo el estilo del autor.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.8,
      max_tokens: 4000
    });
    
    const newContent = response.choices[0]?.message?.content?.trim() || originalChapterContent;
    
    return content.replace(chapterPattern, `${chapterHeader}${newContent}\n\n`);
  } catch (error) {
    console.error('Error reescribiendo capítulo:', error);
    return content;
  }
}

async function applyMergeResolution(
  content: string,
  option: ResolutionOption,
  onProgress?: (progress: StructuralResolutionProgress) => void
): Promise<string> {
  const chaptersToMerge = option.chaptersToMerge || [];
  if (chaptersToMerge.length < 2) return content;
  
  onProgress?.({
    phase: 'resolving',
    message: `Fusionando Capítulos ${chaptersToMerge.join(' y ')}...`
  });
  
  const chapterContents: string[] = [];
  for (const num of chaptersToMerge) {
    const chapterContent = extractChapterContent(content, num);
    if (chapterContent) {
      chapterContents.push(chapterContent);
    }
  }
  
  if (chapterContents.length < 2) return content;
  
  const prompt = `Eres un editor literario experto. Debes FUSIONAR los siguientes capítulos duplicados en UNO SOLO, conservando los mejores elementos de cada uno.

CAPÍTULO ${chaptersToMerge[0]}:
${chapterContents[0]}

CAPÍTULO ${chaptersToMerge[1]}:
${chapterContents[1]}

INSTRUCCIONES:
1. Combina los mejores elementos narrativos de ambos capítulos
2. Elimina redundancias y repeticiones
3. Mantén coherencia narrativa
4. El resultado debe ser UN SOLO capítulo cohesivo
5. Mantén el estilo y tono originales

Devuelve SOLO el contenido fusionado del capítulo, sin encabezados:`;

  try {
    const response = await deepseek.chat.completions.create({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: 'Eres un editor literario que fusiona capítulos duplicados.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.6,
      max_tokens: 5000
    });
    
    const mergedContent = response.choices[0]?.message?.content?.trim();
    
    if (mergedContent) {
      let updatedContent = content;
      const firstChapter = chaptersToMerge[0];
      
      const firstChapterPattern = new RegExp(
        `(Capítulo\\s*${firstChapter}[^\\n]*\\n)([\\s\\S]*?)(?=Capítulo\\s*\\d+|$)`,
        'i'
      );
      const firstMatch = updatedContent.match(firstChapterPattern);
      if (firstMatch) {
        updatedContent = updatedContent.replace(firstChapterPattern, `${firstMatch[1]}${mergedContent}\n\n`);
      }
      
      for (const chapterNum of chaptersToMerge.slice(1)) {
        const chapterPattern = new RegExp(
          `(Capítulo\\s*${chapterNum}[^\\n]*\\n)([\\s\\S]*?)(?=Capítulo\\s*\\d+|$)`,
          'i'
        );
        updatedContent = updatedContent.replace(chapterPattern, '');
      }
      
      updatedContent = renumberChapters(updatedContent);
      
      return updatedContent;
    }
  } catch (error) {
    console.error('Error fusionando capítulos:', error);
  }
  
  return content;
}

function extractChapterContent(content: string, chapterNum: number): string | null {
  const chapterPattern = new RegExp(
    `Capítulo\\s*${chapterNum}[^\\n]*\\n([\\s\\S]*?)(?=Capítulo\\s*\\d+|$)`,
    'i'
  );
  const match = content.match(chapterPattern);
  return match ? match[1].trim() : null;
}

function renumberChapters(content: string): string {
  let currentNumber = 1;
  
  return content.replace(
    /Capítulo\s*\d+/gi,
    () => `Capítulo ${currentNumber++}`
  );
}

export function getStructuralIssueFromCorrection(correction: CorrectionRecord): StructuralIssue | null {
  const mockIssue = { 
    description: correction.instruction, 
    location: correction.location,
    severity: correction.severity 
  } as any;
  
  if (isContinuityConflict(mockIssue)) {
    const conflict = extractContinuityConflict(mockIssue);
    if (conflict) {
      console.log(`[StructuralResolver] Conflicto de continuidad detectado: Cap ${conflict.chapterA} vs Cap ${conflict.chapterB}`);
      return {
        id: correction.id,
        type: 'continuity_conflict',
        severity: correction.severity,
        description: correction.instruction,
        affectedChapters: [conflict.chapterA, conflict.chapterB],
        affectedContent: [],
        resolutionOptions: generateContinuityResolutionOptions(conflict, correction.instruction),
        conflictDetails: conflict
      };
    }
  }
  
  if (!isStructuralIssueDescription(correction.instruction)) {
    return null;
  }
  
  const chapters = extractAffectedChapters(correction.location, correction.instruction);
  
  if (chapters.length <= 1) {
    console.log(`[StructuralResolver] No se pudieron extraer capítulos de: location="${correction.location}", instruction="${correction.instruction.substring(0, 100)}..."`);
    return null;
  }
  
  console.log(`[StructuralResolver] Capítulos afectados detectados: ${chapters.join(', ')}`);
  
  return {
    id: correction.id,
    type: detectStructuralType(correction.instruction),
    severity: correction.severity,
    description: correction.instruction,
    affectedChapters: chapters,
    affectedContent: [],
    resolutionOptions: generateResolutionOptions(chapters, correction.instruction)
  };
}

function isStructuralIssueDescription(description: string): boolean {
  const structuralPatterns = [
    /capítulos?\s+(son\s+)?idénticos/i,
    /repetición\s+literal/i,
    /mismo[s]?\s+evento[s]?/i,
    /contenido\s+duplicado/i,
    /escenas?\s+duplicada/i,
    /capítulos?\s+duplicados/i,
    /exactamente\s+los\s+mismos/i
  ];
  
  return structuralPatterns.some(pattern => pattern.test(description));
}

async function applyContinuityResolution(
  content: string,
  option: ResolutionOption,
  conflict: ContinuityConflict,
  fullDescription: string,
  onProgress?: (progress: StructuralResolutionProgress) => void
): Promise<string> {
  const chapterToModify = option.chapterToModify || conflict.chapterB;
  const chapterContent = extractChapterContent(content, chapterToModify);
  
  if (!chapterContent) {
    throw new Error(`No se pudo extraer el contenido del Capítulo ${chapterToModify}`);
  }

  onProgress?.({
    phase: 'rewriting',
    message: `Generando corrección para Capítulo ${chapterToModify}...`
  });

  let prompt = '';
  
  if (option.type === 'modify_a' || option.type === 'modify_b') {
    const otherChapter = option.type === 'modify_a' ? conflict.chapterB : conflict.chapterA;
    prompt = `Eres un editor literario experto. Debes modificar el siguiente capítulo para resolver una inconsistencia de continuidad.

PROBLEMA DETECTADO:
${fullDescription}

CAPÍTULO A MODIFICAR (Capítulo ${chapterToModify}):
${chapterContent.substring(0, 8000)}

INSTRUCCIONES:
1. Modifica SOLO las partes necesarias para que sea consistente con el Capítulo ${otherChapter}
2. Mantén el estilo narrativo, tono y voz del autor original
3. Los cambios deben ser mínimos y quirúrgicos
4. Devuelve el capítulo completo modificado, sin explicaciones ni markdown

CAPÍTULO CORREGIDO:`;
  } else if (option.type === 'add_explanation') {
    prompt = `Eres un editor literario experto. Debes añadir una explicación narrativa sutil que justifique una aparente inconsistencia.

PROBLEMA DETECTADO:
${fullDescription}

CAPÍTULO DONDE AÑADIR EXPLICACIÓN (Capítulo ${chapterToModify}):
${chapterContent.substring(0, 8000)}

INSTRUCCIONES:
1. Añade una frase o párrafo breve que explique narrativamente la inconsistencia
2. La explicación debe ser natural y fluir con el texto existente
3. Puede ser un pensamiento del personaje, una transición temporal, o un detalle contextual
4. Mantén el estilo del autor
5. Devuelve el capítulo completo con la explicación integrada, sin comentarios ni markdown

CAPÍTULO CON EXPLICACIÓN:`;
  } else {
    throw new Error(`Tipo de resolución no soportado: ${option.type}`);
  }

  const completion = await deepseek.chat.completions.create({
    model: 'deepseek-chat',
    messages: [
      { role: 'user', content: prompt }
    ],
    temperature: 0.4,
    max_tokens: 8000
  });

  const newChapterContent = completion.choices[0]?.message?.content?.trim();
  
  if (!newChapterContent || newChapterContent.length < 100) {
    throw new Error('La respuesta del modelo fue demasiado corta o vacía');
  }

  const chapterPattern = new RegExp(
    `(Capítulo\\s*${chapterToModify}[^\\n]*\\n)([\\s\\S]*?)(?=Capítulo\\s*\\d+|$)`,
    'i'
  );
  
  return content.replace(chapterPattern, `$1${newChapterContent}\n\n`);
}

async function applyTransitionResolution(
  content: string,
  option: ResolutionOption,
  fullDescription: string,
  onProgress?: (progress: StructuralResolutionProgress) => void
): Promise<string> {
  const { GoogleGenAI } = await import('@google/genai');
  
  const apiKey = process.env.GEMINI_API_KEY || process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('No se encontró API key de Gemini');
  }
  
  const genAI = new GoogleGenAI({ apiKey });
  const ctx = option.transitionContext!;
  
  onProgress?.({
    phase: 'rewriting',
    message: `Generando transición narrativa entre Capítulo ${ctx.fromChapter} y ${ctx.toChapter}...`
  });
  
  let prompt = '';
  let chapterToModify: number;
  let insertPosition: 'end' | 'start' | 'both';
  
  if (option.id.includes('end-')) {
    chapterToModify = ctx.fromChapter;
    insertPosition = 'end';
    prompt = `Eres un escritor literario experto en narrativa de thriller/novela negra. Tu tarea es generar 1-2 párrafos de TRANSICIÓN que se añadirán al FINAL del Capítulo ${ctx.fromChapter} para crear una conexión narrativa fluida con el Capítulo ${ctx.toChapter}.

PROBLEMA DETECTADO:
${fullDescription}

CONTEXTO - FINAL DEL CAPÍTULO ${ctx.fromChapter}:
"""
${ctx.endingContext}
"""

CONTEXTO - INICIO DEL CAPÍTULO ${ctx.toChapter}:
"""
${ctx.startingContext}
"""

INSTRUCCIONES:
1. Genera SOLO 1-2 párrafos de transición (máximo 200 palabras)
2. La transición debe cerrar naturalmente la escena del Capítulo ${ctx.fromChapter}
3. Incluye sutilmente una anticipación del cambio de escena/ubicación/tiempo
4. Mantén el mismo estilo narrativo y tono del texto original
5. NO uses frases cliché como "mientras tanto" o "en otro lugar"
6. Puede incluir pensamientos del personaje, paso del tiempo, o detalles sensoriales
7. Devuelve SOLO los párrafos de transición, sin explicaciones ni markdown

PÁRRAFOS DE TRANSICIÓN:`;
  } else if (option.id.includes('start-')) {
    chapterToModify = ctx.toChapter;
    insertPosition = 'start';
    prompt = `Eres un escritor literario experto en narrativa de thriller/novela negra. Tu tarea es generar 1-2 párrafos de APERTURA que se añadirán al INICIO del Capítulo ${ctx.toChapter} para crear una conexión narrativa fluida con el Capítulo ${ctx.fromChapter}.

PROBLEMA DETECTADO:
${fullDescription}

CONTEXTO - FINAL DEL CAPÍTULO ${ctx.fromChapter}:
"""
${ctx.endingContext}
"""

CONTEXTO - INICIO ACTUAL DEL CAPÍTULO ${ctx.toChapter}:
"""
${ctx.startingContext}
"""

INSTRUCCIONES:
1. Genera SOLO 1-2 párrafos de apertura/orientación (máximo 200 palabras)
2. La apertura debe orientar al lector sobre el cambio de escena/ubicación/tiempo
3. Conecta sutilmente con lo que ocurrió en el Capítulo ${ctx.fromChapter}
4. Mantén el mismo estilo narrativo y tono del texto original
5. NO uses frases cliché como "mientras tanto" o "al día siguiente"
6. Puede incluir reflexiones del personaje, descripción del nuevo entorno, o paso del tiempo
7. Devuelve SOLO los párrafos de apertura, sin explicaciones ni markdown

PÁRRAFOS DE APERTURA:`;
  } else {
    insertPosition = 'both';
    prompt = `Eres un escritor literario experto en narrativa de thriller/novela negra. Tu tarea es generar transiciones COMPLEMENTARIAS: un párrafo de cierre para el Capítulo ${ctx.fromChapter} y otro de apertura para el Capítulo ${ctx.toChapter}.

PROBLEMA DETECTADO:
${fullDescription}

CONTEXTO - FINAL DEL CAPÍTULO ${ctx.fromChapter}:
"""
${ctx.endingContext}
"""

CONTEXTO - INICIO DEL CAPÍTULO ${ctx.toChapter}:
"""
${ctx.startingContext}
"""

INSTRUCCIONES:
1. Genera exactamente 2 secciones claramente separadas
2. CIERRE (1 párrafo): Transición natural que cierra el Capítulo ${ctx.fromChapter}
3. APERTURA (1 párrafo): Orientación que abre el Capítulo ${ctx.toChapter}
4. Máximo 150 palabras por sección
5. Mantén el mismo estilo narrativo y tono
6. Evita clichés narrativos

Formato de respuesta:
---CIERRE---
[párrafo de cierre]
---APERTURA---
[párrafo de apertura]`;
    chapterToModify = ctx.fromChapter;
  }

  const response = await genAI.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
    config: {
      temperature: 0.7,
      maxOutputTokens: 1500
    }
  });

  const transitionText = response.text?.trim();
  
  if (!transitionText || transitionText.length < 50) {
    throw new Error('La respuesta del modelo fue demasiado corta o vacía');
  }

  console.log(`[Transition] Generated transition (${transitionText.length} chars) for position: ${insertPosition}`);

  if (insertPosition === 'end') {
    const endPattern = new RegExp(
      `(===\\s*(?:CAPÍTULO|Capítulo|Cap\\.?)\\s*${chapterToModify}[^=]*===)([\\s\\S]*?)(===\\s*(?:CAPÍTULO|Capítulo|Cap\\.?|EPÍLOGO))`,
      'i'
    );
    return content.replace(endPattern, (match, header, chapterContent, nextHeader) => {
      const trimmedContent = chapterContent.trimEnd();
      return `${header}${trimmedContent}\n\n${transitionText}\n\n${nextHeader}`;
    });
  } else if (insertPosition === 'start') {
    const startPattern = new RegExp(
      `(===\\s*(?:CAPÍTULO|Capítulo|Cap\\.?)\\s*${chapterToModify}[^=]*===\\s*\\n+)`,
      'i'
    );
    return content.replace(startPattern, `$1${transitionText}\n\n`);
  } else {
    const closingMatch = transitionText.match(/---CIERRE---\s*([\s\S]*?)---APERTURA---\s*([\s\S]*)/i);
    if (!closingMatch) {
      console.log('[Transition] Could not parse both sections, applying as single transition');
      const endPattern = new RegExp(
        `(===\\s*(?:CAPÍTULO|Capítulo|Cap\\.?)\\s*${ctx.fromChapter}[^=]*===)([\\s\\S]*?)(===\\s*(?:CAPÍTULO|Capítulo|Cap\\.?|EPÍLOGO))`,
        'i'
      );
      return content.replace(endPattern, (match, header, chapterContent, nextHeader) => {
        const trimmedContent = chapterContent.trimEnd();
        return `${header}${trimmedContent}\n\n${transitionText.replace(/---.*?---/g, '').trim()}\n\n${nextHeader}`;
      });
    }
    
    const closingParagraph = closingMatch[1].trim();
    const openingParagraph = closingMatch[2].trim();
    
    let modifiedContent = content;
    
    const endPattern = new RegExp(
      `(===\\s*(?:CAPÍTULO|Capítulo|Cap\\.?)\\s*${ctx.fromChapter}[^=]*===)([\\s\\S]*?)(===\\s*(?:CAPÍTULO|Capítulo|Cap\\.?|EPÍLOGO))`,
      'i'
    );
    modifiedContent = modifiedContent.replace(endPattern, (match, header, chapterContent, nextHeader) => {
      const trimmedContent = chapterContent.trimEnd();
      return `${header}${trimmedContent}\n\n${closingParagraph}\n\n${nextHeader}`;
    });
    
    const startPattern = new RegExp(
      `(===\\s*(?:CAPÍTULO|Capítulo|Cap\\.?)\\s*${ctx.toChapter}[^=]*===\\s*\\n+)`,
      'i'
    );
    modifiedContent = modifiedContent.replace(startPattern, `$1${openingParagraph}\n\n`);
    
    return modifiedContent;
  }
}
