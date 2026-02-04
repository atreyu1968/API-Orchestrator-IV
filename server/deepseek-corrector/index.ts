import OpenAI from 'openai';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { db } from '../db';
import { correctedManuscripts, manuscriptAudits, projects } from '@shared/schema';
import { eq } from 'drizzle-orm';
import type { CorrectionRecord, AuditIssue, AgentReport } from '@shared/schema';
import { getStructuralIssueFromCorrection, applyStructuralResolution } from './structural-resolver';

export { applyStructuralResolution, getStructuralIssueFromCorrection } from './structural-resolver';

const deepseek = new OpenAI({
  baseURL: 'https://api.deepseek.com',
  apiKey: process.env.DEEPSEEK_API_KEY
});

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

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

interface CharacterBibleExtraction {
  characterName: string;
  attribute: string;
  correctValue: string;
  incorrectValue: string;
  chapterName: string;
}

function extractChapterNumbersFromLocation(location: string): number[] {
  const numbers: number[] = [];
  const matches = location.match(/\d+/g);
  if (matches) {
    for (const m of matches) {
      const num = parseInt(m, 10);
      if (num > 0 && num < 100) {
        numbers.push(num);
      }
    }
  }
  return Array.from(new Set(numbers)).sort((a, b) => a - b);
}

function extractEpilogueContent(manuscript: string): { content: string; title: string } | null {
  const pattern = /(?:^|\n)((?:EPÍLOGO|Epílogo|EPILOGO|Epilogo)[^\n]*\n)([\s\S]*?)$/i;
  const match = manuscript.match(pattern);
  if (match) {
    return {
      title: match[1].trim(),
      content: match[2].trim()
    };
  }
  return null;
}

function findAttributeInChapterContent(content: string, incorrectValue: string, attribute: string): string | null {
  if (!incorrectValue || incorrectValue.length < 2) return null;
  
  const patterns: string[] = [];
  const escapedValue = incorrectValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  
  patterns.push(`[^.]*${escapedValue}[^.]*\\.`);
  
  if (attribute === 'ojos' || attribute === 'eyes') {
    patterns.push(`[^.]*ojos\\s+${escapedValue}[^.]*\\.`);
    patterns.push(`[^.]*${escapedValue}\\s+ojos[^.]*\\.`);
    patterns.push(`[^.]*mirada\\s+${escapedValue}[^.]*\\.`);
    patterns.push(`[^.]*iris\\s+${escapedValue}[^.]*\\.`);
  } else if (attribute === 'cabello' || attribute === 'pelo' || attribute === 'hair') {
    patterns.push(`[^.]*cabello\\s+${escapedValue}[^.]*\\.`);
    patterns.push(`[^.]*${escapedValue}\\s+cabello[^.]*\\.`);
    patterns.push(`[^.]*pelo\\s+${escapedValue}[^.]*\\.`);
    patterns.push(`[^.]*melena\\s+${escapedValue}[^.]*\\.`);
  }
  
  for (const pattern of patterns) {
    try {
      const regex = new RegExp(pattern, 'gi');
      const matches = content.match(regex);
      if (matches && matches.length > 0) {
        return matches[0].trim();
      }
    } catch (e) {
      continue;
    }
  }
  
  const simpleMatch = content.match(new RegExp(`[^.]{0,100}${escapedValue}[^.]{0,100}\\.`, 'i'));
  if (simpleMatch) {
    return simpleMatch[0].trim();
  }
  
  return null;
}

function findAnyAttributeMentionNotMatchingBible(
  content: string, 
  characterName: string, 
  attribute: string, 
  correctValue: string
): string | null {
  const firstName = characterName.split(' ')[0];
  const lastName = characterName.split(' ').slice(1).join(' ');
  const escapedCorrect = correctValue.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  
  let attributePatterns: RegExp[] = [];
  
  if (attribute === 'ojos' || attribute === 'eyes') {
    attributePatterns = [
      /[^.]*\bojos\s+(\w+(?:\s+\w+)?)[^.]*\./gi,
      /[^.]*\bmirada\s+(\w+)[^.]*\./gi,
      /[^.]*\biris\s+(\w+)[^.]*\./gi,
      /[^.]*(\w+)\s+ojos\b[^.]*\./gi
    ];
  } else if (attribute === 'cabello' || attribute === 'pelo' || attribute === 'hair') {
    attributePatterns = [
      /[^.]*\bcabello\s+(\w+(?:\s+\w+)?)[^.]*\./gi,
      /[^.]*\bpelo\s+(\w+(?:\s+\w+)?)[^.]*\./gi,
      /[^.]*\bmelena\s+(\w+(?:\s+\w+)?)[^.]*\./gi,
      /[^.]*(\w+(?:\s+\w+)?)\s+cabello\b[^.]*\./gi
    ];
  }
  
  for (const pattern of attributePatterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      const sentence = match[0];
      const foundValue = match[1]?.toLowerCase() || '';
      
      const mentionsCharacter = sentence.toLowerCase().includes(firstName.toLowerCase()) ||
                                (lastName && sentence.toLowerCase().includes(lastName.toLowerCase()));
      
      if (mentionsCharacter || attributePatterns.length > 0) {
        const correctWords = correctValue.toLowerCase().split(/\s+/);
        const foundWords = foundValue.split(/\s+/);
        const matchesCorrect = correctWords.some((cw: string) => foundWords.some((fw: string) => fw.includes(cw) || cw.includes(fw)));
        
        if (!matchesCorrect && foundValue.length > 2) {
          console.log(`[CharacterBible Search] Encontrada mención incorrecta: "${sentence.substring(0, 60)}..." (valor: "${foundValue}", debería ser: "${correctValue}")`);
          return sentence.trim();
        }
      }
    }
  }
  
  return null;
}

async function aiFlexibleAttributeSearch(
  chapterContent: string,
  characterName: string,
  attribute: string,
  correctValue: string,
  chapterTitle: string
): Promise<{ sentence: string; incorrectValue: string } | null> {
  if (!GEMINI_API_KEY) {
    console.log('[AI-Search] No Gemini API key, skipping AI search');
    return null;
  }
  
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    
    const prompt = `Eres un detector de inconsistencias en manuscritos literarios.

TAREA: Buscar en el siguiente capítulo cualquier mención del atributo "${attribute}" del personaje "${characterName}" que NO coincida con el valor canónico de la Biblia de Personajes.

VALOR CANÓNICO (Biblia de Personajes): ${attribute} = "${correctValue}"

CAPÍTULO A ANALIZAR:
---
${chapterTitle}
${chapterContent.substring(0, 15000)}
---

INSTRUCCIONES:
1. Busca CUALQUIER oración que describa el ${attribute} de ${characterName} (o pronombres que se refieran a este personaje)
2. Si encuentras una descripción que NO coincide con "${correctValue}", devuelve esa oración EXACTA
3. Considera sinónimos y variaciones: para "ojos" también busca "mirada", "iris", "pupilas"; para "cabello" busca "pelo", "melena", etc.
4. El personaje puede referirse por nombre, apellido, o pronombres como "él/ella", "su", etc.

FORMATO DE RESPUESTA (JSON estricto):
Si encuentras inconsistencia:
{"found": true, "sentence": "La oración exacta del manuscrito que contiene el valor incorrecto", "incorrectValue": "el valor incorrecto mencionado"}

Si NO hay inconsistencia o el atributo no se menciona:
{"found": false}

IMPORTANTE: Solo devuelve el JSON, sin explicaciones ni markdown.`;

    const result = await model.generateContent(prompt);
    const response = result.response.text().trim();
    
    console.log(`[AI-Search] Response for ${characterName}/${attribute} in ${chapterTitle}:`, response.substring(0, 200));
    
    const cleanedResponse = response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    
    try {
      const parsed = JSON.parse(cleanedResponse);
      if (parsed.found && parsed.sentence && parsed.incorrectValue) {
        console.log(`[AI-Search] FOUND inconsistency: "${parsed.incorrectValue}" should be "${correctValue}"`);
        return {
          sentence: parsed.sentence,
          incorrectValue: parsed.incorrectValue
        };
      }
    } catch (parseErr) {
      console.log('[AI-Search] Failed to parse JSON response:', parseErr);
    }
    
    return null;
  } catch (error) {
    console.error('[AI-Search] Error during AI search:', error);
    return null;
  }
}

function findAttributeBySearchingAll(
  content: string,
  characterName: string,
  attribute: string,
  correctValue: string,
  incorrectValue: string
): string | null {
  let result = findAttributeInChapterContent(content, incorrectValue, attribute);
  
  if (!result) {
    console.log(`[CharacterBible] No encontrado valor incorrecto específico, buscando cualquier mención que no coincida con la Biblia...`);
    result = findAnyAttributeMentionNotMatchingBible(content, characterName, attribute, correctValue);
  }
  
  return result;
}

async function findAttributeBySearchingAllWithAI(
  content: string,
  characterName: string,
  attribute: string,
  correctValue: string,
  incorrectValue: string,
  chapterTitle: string
): Promise<{ sentence: string; incorrectValue: string } | null> {
  let result = findAttributeInChapterContent(content, incorrectValue, attribute);
  
  if (result) {
    return { sentence: result, incorrectValue };
  }
  
  console.log(`[CharacterBible] Regex no encontró valor incorrecto, intentando búsqueda con IA...`);
  const regexResult = findAnyAttributeMentionNotMatchingBible(content, characterName, attribute, correctValue);
  
  if (regexResult) {
    return { sentence: regexResult, incorrectValue: 'detectado por regex' };
  }
  
  console.log(`[CharacterBible] Regex falló, usando Gemini AI para búsqueda flexible...`);
  const aiResult = await aiFlexibleAttributeSearch(content, characterName, attribute, correctValue, chapterTitle);
  
  return aiResult;
}

function extractCharacterBibleInfo(description: string): CharacterBibleExtraction | null {
  const patterns = [
    /La ficha de personaje de (\w+(?:\s+\w+)?)\s+describe su (\w+(?:\s+\w+)?)\s+como ['"]([^'"]+)['"]\.\s*Sin embargo,?\s*(?:en el )?(\w+(?:\s+\d+)?),?\s*se menciona que (?:su \w+ es |es )['"]?([^'".\n]+)['"]?/i,
    /ficha.*?(\w+(?:\s+\w+)?).*?(\w+).*?['"]([^'"]+)['"].*?(\w+(?:\s+\d+)?).*?['"]([^'"]+)['"]/i,
    /Character Bible.*?(\w+).*?['"]([^'"]+)['"].*?(\w+(?:\s+\d+)?).*?['"]([^'"]+)['"]/i
  ];

  for (const pattern of patterns) {
    const match = description.match(pattern);
    if (match) {
      if (match.length >= 6) {
        return {
          characterName: match[1].trim(),
          attribute: match[2].trim(),
          correctValue: match[3].trim(),
          incorrectValue: match[5].trim(),
          chapterName: match[4].trim()
        };
      }
    }
  }

  const colorVsBibleMatch = description.match(/color de (?:cabello|ojos|pelo) de (\w+(?:\s+\w+)?)\s+es inconsistente/i);
  const bibleSpecMatch = description.match(/(?:BIBLIA|Character Bible).*?(?:especifica|indica|dice).*?['"]([^'"]+)['"]/i) ||
                        description.match(/(?:BIBLIA|Character Bible).*?(?:hair|eyes|cabello|ojos)['"]?:\s*['"]([^'"]+)['"]/i);
  const manuscriptValueMatch = description.match(/(?:Prólogo|narrativa).*?(?:describe|se describe).*?como\s*['"]([^'"]+)['"]/i) ||
                               description.match(/se describen.*?como\s*['"]([^'"]+)['"]/i);
  const locationVsMatch = description.match(/(Prólogo|Cap[íi]tulo\s*\d+)\s*vs/i);
  
  if (colorVsBibleMatch && bibleSpecMatch) {
    const characterName = colorVsBibleMatch[1];
    const correctValue = bibleSpecMatch[1];
    const incorrectValue = manuscriptValueMatch ? manuscriptValueMatch[1] : '';
    const location = locationVsMatch ? locationVsMatch[1] : 'Prólogo';
    const attribute = description.toLowerCase().includes('cabello') || description.toLowerCase().includes('hair') ? 'cabello' : 'ojos';
    
    console.log('[CharacterBible] Color inconsistente detectado:', {
      characterName,
      attribute,
      correctValue,
      incorrectValue,
      location
    });
    
    return {
      characterName,
      attribute,
      correctValue,
      incorrectValue,
      chapterName: location
    };
  }

  const multiChapterBibleMatch = description.match(/Character Bible vs múltiples cap[íi]tulos/i) ||
                                  description.match(/BIBLIA.*?indica.*?son ['"]([^'"]+)['"]/i);
  const eyesMatch = description.match(/ojos son ['"]([^'"]+)['"]/i);
  const narrativeMatch = description.match(/narrativa se describen.*?como ['"]([^'"]+)['"]/i);
  const chaptersListMatch = description.match(/Cap[íi]tulos?\s*([\d,\s]+)/i);
  
  if (multiChapterBibleMatch || (eyesMatch && narrativeMatch)) {
    const correctValue = eyesMatch ? eyesMatch[1] : '';
    const incorrectValue = narrativeMatch ? narrativeMatch[1] : '';
    const personNameMatch = description.match(/de\s+(\w+\s+\w+)\s+es\s+inconsistente/i) ||
                           description.match(/ojos de\s+(\w+\s+\w+)/i);
    
    console.log('[CharacterBible] Multi-capítulo detectado:', {
      correctValue,
      incorrectValue,
      chapters: chaptersListMatch ? chaptersListMatch[1] : 'múltiples'
    });
    
    return {
      characterName: personNameMatch ? personNameMatch[1] : 'Personaje',
      attribute: 'ojos',
      correctValue,
      incorrectValue,
      chapterName: chaptersListMatch ? `Capítulos ${chaptersListMatch[1]}` : 'múltiples capítulos'
    };
  }

  const nameInconsistentMatch = description.match(/se (?:le )?presenta como ['"]([^'"]+)['"].*?(?:Biblia|Bible).*?(?:su nombre es|nombre es|es) ['"]([^'"]+)['"]/i);
  const chapterForNameMatch = description.match(/(?:en el\s+)?(Cap[íi]tulo\s*\d+|Prólogo)/i);
  
  if (nameInconsistentMatch && chapterForNameMatch) {
    console.log('[CharacterBible] Nombre inconsistente detectado:', {
      incorrectName: nameInconsistentMatch[1],
      correctName: nameInconsistentMatch[2],
      chapter: chapterForNameMatch[1]
    });
    return {
      characterName: nameInconsistentMatch[2].split(' ')[0] || 'Personaje',
      attribute: 'nombre',
      correctValue: nameInconsistentMatch[2].trim(),
      incorrectValue: nameInconsistentMatch[1].trim(),
      chapterName: chapterForNameMatch[1].trim()
    };
  }

  const bibleMatch = description.match(/\*?\*?Character Bible\*?\*?:?\s*(?:\w+:?\s*)?["']([^"']+)["']/i) ||
                    description.match(/Character Bible.*?:\s*["']([^"']+)["']/i) ||
                    description.match(/Biblia de Personajes.*?["']([^"']+)["']/i) ||
                    description.match(/hair:\s*["']([^"']+)["']/i) ||
                    description.match(/cabello.*?como\s*["']([^"']+)["']/i) ||
                    description.match(/nombre es ['"]([^'"]+)['"]/i);
  
  const manuscriptMatch = description.match(/se (?:le )?presenta como ['"]([^'"]+)['"]/i) ||
                         description.match(/\*?\*?(?:Prólogo|Cap[íi]tulo\s*\d+)\*?\*?:?\s*["']([^"']+)["']/i) ||
                         description.match(/(?:en el\s+)?(?:Prólogo|Cap[íi]tulo\s*\d+).*?['"]([^'"]+)['"]/i);
  
  const locationMatch = description.match(/(?:\*\*)?(?:en el\s+)?(Prólogo|Cap[íi]tulo\s*\d+)(?:\*\*)?/i);
  
  const nameMatch = description.match(/ficha de personaje de (\w+(?:\s+\w+)?)/i) || 
                   description.match(/personaje\s+de\s+(\w+(?:\s+\w+)?)/i) ||
                   description.match(/de\s+(\w+(?:\s+\w+)?)\s+describe/i) ||
                   description.match(/aliada? de (\w+)/i);
  
  const attrMatch = description.match(/describe su (\w+(?:\s+\w+)?)/i) ||
                   description.match(/su\s+(\w+)\s+como/i) ||
                   description.match(/(\w+):\s*["'][^"']+["']/i) ||
                   description.match(/nombre.*?inconsistente/i);

  if (bibleMatch && manuscriptMatch && locationMatch) {
    console.log('[CharacterBible] Extracted:', {
      correctValue: bibleMatch[1],
      incorrectValue: manuscriptMatch[1],
      chapter: locationMatch[1]
    });
    return {
      characterName: nameMatch ? nameMatch[1].trim() : 'Personaje',
      attribute: attrMatch ? (attrMatch[1] ? attrMatch[1].trim() : 'nombre') : 'atributo',
      correctValue: bibleMatch[1].trim(),
      incorrectValue: manuscriptMatch[1].trim(),
      chapterName: locationMatch[1].trim()
    };
  }

  return null;
}

function findTextWithIncorrectValue(manuscript: string, incorrectValue: string, chapterName: string): { 
  foundText: string; 
  chapterContent: string;
  chapterIndex: number;
} | null {
  const chapters = manuscript.split(/(?=^(?:Capítulo|CAPÍTULO|Prólogo|PRÓLOGO)\s*\d*)/mi);
  
  for (let i = 0; i < chapters.length; i++) {
    const chapter = chapters[i];
    const chapterHeader = chapter.split('\n')[0] || '';
    
    const isTargetChapter = 
      (chapterName.toLowerCase() === 'prólogo' && /prólogo/i.test(chapterHeader)) ||
      new RegExp(chapterName.replace(/\s+/g, '\\s*'), 'i').test(chapterHeader);
    
    if (isTargetChapter) {
      console.log(`[CharacterBible] Buscando "${incorrectValue}" en ${chapterName}`);
      
      const fullPhraseIndex = chapter.toLowerCase().indexOf(incorrectValue.toLowerCase());
      if (fullPhraseIndex !== -1) {
        const sentenceStart = Math.max(0, chapter.lastIndexOf('.', fullPhraseIndex) + 1);
        const sentenceEnd = chapter.indexOf('.', fullPhraseIndex + incorrectValue.length);
        const sentence = chapter.substring(sentenceStart, sentenceEnd > 0 ? sentenceEnd + 1 : fullPhraseIndex + 200).trim();
        
        console.log(`[CharacterBible] Encontrado frase completa: "${sentence.substring(0, 60)}..."`);
        return {
          foundText: sentence,
          chapterContent: chapter,
          chapterIndex: i
        };
      }
      
      const incorrectWords = incorrectValue.split(/\s+/).filter(w => w.length > 3);
      const allWordsPattern = incorrectWords.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
      const multiWordRegex = new RegExp(allWordsPattern, 'gi');
      const multiWordMatch = chapter.match(multiWordRegex);
      
      if (multiWordMatch) {
        const index = chapter.search(multiWordRegex);
        if (index !== -1) {
          const sentenceStart = Math.max(0, chapter.lastIndexOf('.', index) + 1);
          const sentenceEnd = chapter.indexOf('.', index + multiWordMatch[0].length);
          const sentence = chapter.substring(sentenceStart, sentenceEnd > 0 ? sentenceEnd + 1 : index + 200).trim();
          
          if (sentence.length > 10) {
            console.log(`[CharacterBible] Encontrado multi-palabra: "${sentence.substring(0, 60)}..."`);
            return {
              foundText: sentence,
              chapterContent: chapter,
              chapterIndex: i
            };
          }
        }
      }
      
      const lastWord = incorrectWords[incorrectWords.length - 1];
      if (lastWord && lastWord.length > 4) {
        const lastWordRegex = new RegExp(lastWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        const lastWordMatch = chapter.match(lastWordRegex);
        if (lastWordMatch) {
          const index = chapter.search(lastWordRegex);
          if (index !== -1) {
            const sentenceStart = Math.max(0, chapter.lastIndexOf('.', index) + 1);
            const sentenceEnd = chapter.indexOf('.', index + lastWord.length);
            const sentence = chapter.substring(sentenceStart, sentenceEnd > 0 ? sentenceEnd + 1 : index + 200).trim();
            
            if (sentence.length > 10 && sentence.toLowerCase().includes(lastWord.toLowerCase())) {
              console.log(`[CharacterBible] Encontrado por apellido "${lastWord}": "${sentence.substring(0, 60)}..."`);
              return {
                foundText: sentence,
                chapterContent: chapter,
                chapterIndex: i
              };
            }
          }
        }
      }
      
      console.log(`[CharacterBible] No encontrado "${incorrectValue}" en ${chapterName}`);
    }
  }
  
  return null;
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

function hasExplicitChapterList(location: string): boolean {
  const listPatterns = [
    /(?:prólogo|cap\.?\s*\d+)(?:\s*,\s*(?:\d+|prólogo|cap\.?\s*\d+))+/i,
    /múltiples\s+cap[íi]tulos/i,
    /cap[íi]tulos?\s*[\d,\s]+/i,
    /\d+\s*,\s*\d+\s*,\s*\d+/
  ];
  return listPatterns.some(p => p.test(location));
}

function extractChapterListFromLocation(location: string): (number | 'prólogo')[] {
  const chapters: (number | 'prólogo')[] = [];
  
  if (/prólogo/i.test(location)) {
    chapters.push('prólogo');
  }
  
  const numPattern = /(?:cap\.?\s*)?(\d+)/gi;
  let match;
  while ((match = numPattern.exec(location)) !== null) {
    const num = parseInt(match[1]);
    if (!chapters.includes(num) && num > 0 && num < 200) {
      chapters.push(num);
    }
  }
  
  return chapters;
}

function extractConceptFromDescription(description: string): string | null {
  const patterns = [
    /La descripción del?\s+(.+?)\s+se repite/i,
    /descripción de[l]?\s+(.+?)\s+se repite/i,
    /(.+?)\s+se repite con una frecuencia/i,
    /(.+?)\s+aparece de forma repetitiva/i,
    /menciones? de[l]?\s+(.+?)\s+(?:se|es|son)/i,
    /(?:el|la|los|las)\s+(.+?)\s+(?:es|son|aparece|se usa)/i
  ];
  
  for (const pattern of patterns) {
    const match = description.match(pattern);
    if (match && match[1]) {
      const concept = match[1].trim();
      if (concept.length > 5 && concept.length < 200) {
        console.log(`[MultiChapter] Concepto extraído: "${concept}"`);
        return concept;
      }
    }
  }
  
  console.log(`[MultiChapter] No se pudo extraer concepto de: "${description.substring(0, 100)}..."`);
  return null;
}

function extractChapterContent2(manuscript: string, chapterRef: number | 'prólogo'): { content: string; title: string } | null {
  let pattern: RegExp;
  
  if (chapterRef === 'prólogo') {
    pattern = /(?:^|\n)((?:PRÓLOGO|Prólogo)[^\n]*\n)([\s\S]*?)(?=\n(?:Capítulo|CAPÍTULO|CAP\.)\s*\d+|$)/i;
  } else {
    pattern = new RegExp(
      `(?:^|\\n)((?:Capítulo|CAPÍTULO|CAP\\.?)\\s*${chapterRef}[^\\n]*\\n)([\\s\\S]*?)(?=\\n(?:Capítulo|CAPÍTULO|CAP\\.?)\\s*\\d+|$)`,
      'i'
    );
  }
  
  const match = manuscript.match(pattern);
  if (match) {
    return {
      title: match[1].trim(),
      content: match[2].trim()
    };
  }
  return null;
}

async function findConceptInChapter(
  chapterContent: string,
  concept: string,
  fullDescription: string
): Promise<{ sentence: string; context: string } | null> {
  const stopWords = ['de', 'del', 'la', 'el', 'los', 'las', 'en', 'con', 'una', 'un', 'se', 'que', 'por', 'para'];
  const keywords = concept.split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.includes(w.toLowerCase()))
    .map(w => w.toLowerCase());
  
  console.log(`[MultiChapter] Buscando keywords: ${keywords.join(', ')}`);
  
  const sentences = chapterContent.split(/(?<=[.!?])\s+/);
  let bestMatch: { sentence: string; context: string; score: number } | null = null;
  
  for (const sentence of sentences) {
    if (sentence.length < 20) continue;
    
    const sentenceLower = sentence.toLowerCase();
    const matchCount = keywords.filter(kw => sentenceLower.includes(kw)).length;
    const score = matchCount / keywords.length;
    
    if (score >= 0.4 && (!bestMatch || score > bestMatch.score)) {
      const idx = chapterContent.indexOf(sentence);
      const contextStart = Math.max(0, idx - 200);
      const contextEnd = Math.min(chapterContent.length, idx + sentence.length + 200);
      const context = chapterContent.substring(contextStart, contextEnd);
      
      bestMatch = { sentence, context, score };
    }
  }
  
  if (bestMatch) {
    console.log(`[MultiChapter] Encontrado (score ${bestMatch.score.toFixed(2)}): "${bestMatch.sentence.substring(0, 60)}..."`);
    return { sentence: bestMatch.sentence, context: bestMatch.context };
  }
  
  console.log(`[MultiChapter] No encontrado en capítulo`);
  return null;
}

async function generateVariedAlternative(
  originalSentence: string,
  context: string,
  concept: string,
  fullDescription: string,
  chapterRef: number | 'prólogo',
  variationIndex: number
): Promise<string> {
  const prompt = `Eres un editor literario experto. El autor usa descripciones muy similares a lo largo de la novela, causando monotonía.

PROBLEMA:
${fullDescription}

ORACIÓN A VARIAR (del ${chapterRef === 'prólogo' ? 'Prólogo' : 'Capítulo ' + chapterRef}):
"${originalSentence}"

CONTEXTO:
${context}

INSTRUCCIONES:
1. Reescribe la oración manteniendo el MISMO significado pero con vocabulario y estructura DIFERENTE
2. Esta es la variación #${variationIndex + 1}, debe ser ÚNICA respecto a otras variaciones
3. Mantén el tono y estilo del autor
4. NO cambies los hechos ni los personajes mencionados
5. Devuelve SOLO la oración reescrita, sin explicaciones

ORACIÓN VARIADA:`;

  const completion = await deepseek.chat.completions.create({
    model: 'deepseek-chat',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.7 + (variationIndex * 0.1),
    max_tokens: 500
  });

  return completion.choices[0]?.message?.content?.trim() || originalSentence;
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
  
  const uniqueWords = Array.from(new Set(keyWords));
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

      const characterBibleInfo = extractCharacterBibleInfo(issue.description);
      
      if (characterBibleInfo) {
        const isVsPrologo = issue.location?.toLowerCase().includes('vs prólogo') ||
                            issue.location?.toLowerCase().includes('vs prologo') ||
                            (issue.location?.toLowerCase().includes('bible') && issue.location?.toLowerCase().includes('prólogo'));
        
        if (isVsPrologo) {
          console.log('[CharacterBible] Detectado caso vs Prólogo');
          
          onProgress?.({
            phase: 'analyzing',
            current: i + 1,
            total: allIssues.length,
            message: `Character Bible vs Prólogo: buscando "${characterBibleInfo.incorrectValue}" en Prólogo...`
          });
          
          const prologueData = extractChapterContent2(correctedContent, 'prólogo');
          if (prologueData) {
            const foundResult = await findAttributeBySearchingAllWithAI(
              prologueData.content,
              characterBibleInfo.characterName,
              characterBibleInfo.attribute,
              characterBibleInfo.correctValue,
              characterBibleInfo.incorrectValue,
              'Prólogo'
            );
            
            if (foundResult) {
              console.log(`[CharacterBible AI] Prólogo: encontrado "${foundResult.sentence.substring(0, 50)}..." (valor: ${foundResult.incorrectValue})`);
              
              const result = await correctSingleIssue({
                fullChapter: prologueData.content,
                targetText: foundResult.sentence,
                instruction: `El personaje ${characterBibleInfo.characterName} tiene ${characterBibleInfo.attribute} como "${characterBibleInfo.correctValue}" según la biblia de personajes. Cambiar "${foundResult.incorrectValue}" a "${characterBibleInfo.correctValue}".`,
                suggestion: `Reemplazar con: "${characterBibleInfo.correctValue}"`
              });
              
              pendingCorrections.push({
                id: `correction-${Date.now()}-${i}-prologue`,
                issueId: `issue-${i}`,
                location: 'Prólogo',
                chapterNumber: 0,
                originalText: result.originalText,
                correctedText: result.correctedText,
                instruction: `[CHARACTER-BIBLE AI] ${characterBibleInfo.attribute}: "${foundResult.incorrectValue}" → "${characterBibleInfo.correctValue}"`,
                severity: issue.severity,
                status: result.success ? 'pending' : 'rejected',
                diffStats: result.diffStats,
                createdAt: new Date().toISOString()
              });
              
              totalOccurrences++;
              if (result.success) successCount++;
            }
          }
          continue;
        }
        
        const isMultiChapterBible = issue.location?.toLowerCase().includes('vs capítulos') ||
                                    issue.location?.toLowerCase().includes('múltiples') ||
                                    issue.description.toLowerCase().includes('vs múltiples') ||
                                    (issue.location?.match(/\d+/g)?.length || 0) > 2;
        
        if (isMultiChapterBible) {
          console.log('[CharacterBible Multi] Detectado caso multi-capítulo');
          const chapterNumbers = extractChapterNumbersFromLocation(issue.location || issue.description);
          const hasEpilogue = issue.location?.toLowerCase().includes('epílogo') || 
                              issue.location?.toLowerCase().includes('epilogo');
          
          console.log(`[CharacterBible Multi] Capítulos: ${chapterNumbers.join(', ')}, Epílogo: ${hasEpilogue}`);
          
          onProgress?.({
            phase: 'analyzing',
            current: i + 1,
            total: allIssues.length,
            message: `Character Bible multi-capítulo: buscando "${characterBibleInfo.incorrectValue}" en ${chapterNumbers.length} capítulos...`
          });
          
          for (const chapterNum of chapterNumbers) {
            const chapterRef = `Capítulo ${chapterNum}`;
            const chapterData = extractChapterContent2(correctedContent, chapterNum);
            
            if (chapterData) {
              onProgress?.({
                phase: 'analyzing',
                current: i + 1,
                total: allIssues.length,
                message: `IA buscando "${characterBibleInfo.attribute}" de ${characterBibleInfo.characterName} en ${chapterRef}...`
              });
              
              const foundResult = await findAttributeBySearchingAllWithAI(
                chapterData.content,
                characterBibleInfo.characterName,
                characterBibleInfo.attribute,
                characterBibleInfo.correctValue,
                characterBibleInfo.incorrectValue,
                chapterRef
              );
              
              if (foundResult) {
                console.log(`[CharacterBible AI Multi] ${chapterRef}: encontrado "${foundResult.sentence.substring(0, 50)}..." (valor: ${foundResult.incorrectValue})`);
                
                const result = await correctSingleIssue({
                  fullChapter: chapterData.content,
                  targetText: foundResult.sentence,
                  instruction: `El personaje ${characterBibleInfo.characterName} tiene ${characterBibleInfo.attribute} como "${characterBibleInfo.correctValue}" según la biblia de personajes. Cambiar "${foundResult.incorrectValue}" a "${characterBibleInfo.correctValue}".`,
                  suggestion: `Reemplazar con: "${characterBibleInfo.correctValue}"`
                });
                
                pendingCorrections.push({
                  id: `correction-${Date.now()}-${i}-ch${chapterNum}`,
                  issueId: `issue-${i}`,
                  location: chapterRef,
                  chapterNumber: chapterNum,
                  originalText: result.originalText,
                  correctedText: result.correctedText,
                  instruction: `[CHARACTER-BIBLE AI] ${characterBibleInfo.attribute}: "${foundResult.incorrectValue}" → "${characterBibleInfo.correctValue}"`,
                  severity: issue.severity,
                  status: result.success ? 'pending' : 'rejected',
                  diffStats: result.diffStats,
                  createdAt: new Date().toISOString()
                });
                
                totalOccurrences++;
                if (result.success) successCount++;
                
                await new Promise(resolve => setTimeout(resolve, 500));
              } else {
                console.log(`[CharacterBible AI Multi] ${chapterRef}: No se encontró inconsistencia`);
              }
            }
          }
          
          if (hasEpilogue) {
            const epilogueData = extractEpilogueContent(correctedContent);
            if (epilogueData) {
              onProgress?.({
                phase: 'analyzing',
                current: i + 1,
                total: allIssues.length,
                message: `IA buscando "${characterBibleInfo.attribute}" de ${characterBibleInfo.characterName} en Epílogo...`
              });
              
              const foundResult = await findAttributeBySearchingAllWithAI(
                epilogueData.content,
                characterBibleInfo.characterName,
                characterBibleInfo.attribute,
                characterBibleInfo.correctValue,
                characterBibleInfo.incorrectValue,
                'Epílogo'
              );
              
              if (foundResult) {
                console.log(`[CharacterBible AI] Epílogo: encontrado "${foundResult.sentence.substring(0, 50)}..." (valor: ${foundResult.incorrectValue})`);
                
                const result = await correctSingleIssue({
                  fullChapter: epilogueData.content,
                  targetText: foundResult.sentence,
                  instruction: `El personaje ${characterBibleInfo.characterName} tiene ${characterBibleInfo.attribute} como "${characterBibleInfo.correctValue}" según la biblia de personajes. Cambiar "${foundResult.incorrectValue}" a "${characterBibleInfo.correctValue}".`,
                  suggestion: `Reemplazar con: "${characterBibleInfo.correctValue}"`
                });
                
                pendingCorrections.push({
                  id: `correction-${Date.now()}-${i}-epilogue`,
                  issueId: `issue-${i}`,
                  location: 'Epílogo',
                  chapterNumber: 999,
                  originalText: result.originalText,
                  correctedText: result.correctedText,
                  instruction: `[CHARACTER-BIBLE AI] ${characterBibleInfo.attribute}: "${foundResult.incorrectValue}" → "${characterBibleInfo.correctValue}"`,
                  severity: issue.severity,
                  status: result.success ? 'pending' : 'rejected',
                  diffStats: result.diffStats,
                  createdAt: new Date().toISOString()
                });
                
                totalOccurrences++;
                if (result.success) successCount++;
              }
            }
          }
          
          continue;
        }
        
        onProgress?.({
          phase: 'analyzing',
          current: i + 1,
          total: allIssues.length,
          message: `Detectado issue de Character Bible: buscando "${characterBibleInfo.incorrectValue}" en ${characterBibleInfo.chapterName}...`
        });

        const foundResult = findTextWithIncorrectValue(
          correctedContent,
          characterBibleInfo.incorrectValue,
          characterBibleInfo.chapterName
        );

        if (foundResult) {
          const result = await correctSingleIssue({
            fullChapter: foundResult.chapterContent,
            targetText: foundResult.foundText,
            instruction: `El personaje ${characterBibleInfo.characterName} tiene ${characterBibleInfo.attribute} como "${characterBibleInfo.correctValue}" según la biblia de personajes. Corregir "${characterBibleInfo.incorrectValue}" a "${characterBibleInfo.correctValue}".`,
            suggestion: `Cambiar la descripción para que coincida con la biblia: "${characterBibleInfo.correctValue}"`
          });

          const correctionRecord: CorrectionRecord = {
            id: `correction-${Date.now()}-${i}-charfix`,
            issueId: `issue-${i}`,
            location: characterBibleInfo.chapterName,
            chapterNumber: parseInt(characterBibleInfo.chapterName.match(/\d+/)?.[0] || '0'),
            originalText: result.originalText,
            correctedText: result.correctedText,
            instruction: `[CHARACTER-BIBLE] ${issue.description}`,
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
          continue;
        }
      }

      console.log(`[DeepSeek] Checking multi-chapter for location: "${issue.location.substring(0, 80)}..."`);
      const hasMultiChapter = hasExplicitChapterList(issue.location);
      console.log(`[DeepSeek] hasExplicitChapterList: ${hasMultiChapter}`);
      
      if (hasMultiChapter) {
        const chapterList = extractChapterListFromLocation(issue.location);
        const concept = extractConceptFromDescription(issue.description);
        
        console.log(`[DeepSeek] MultiChapter - chapters: ${chapterList.length}, concept: ${concept ? 'found' : 'null'}`);
        
        if (chapterList.length > 0 && concept) {
          onProgress?.({
            phase: 'analyzing',
            current: i + 1,
            total: allIssues.length,
            message: `Múltiples capítulos (${chapterList.length}): buscando "${concept.substring(0, 40)}..." en cada uno...`
          });

          let foundCount = 0;
          for (let j = 0; j < chapterList.length; j++) {
            const chapterRef = chapterList[j];
            const chapterData = extractChapterContent2(correctedContent, chapterRef);
            
            if (chapterData) {
              const foundConcept = await findConceptInChapter(chapterData.content, concept, issue.description);
              
              if (foundConcept) {
                onProgress?.({
                  phase: 'correcting',
                  current: i + 1,
                  total: allIssues.length,
                  message: `Generando variación ${j + 1}/${chapterList.length} para ${chapterRef === 'prólogo' ? 'Prólogo' : 'Cap. ' + chapterRef}...`
                });

                const alternative = await generateVariedAlternative(
                  foundConcept.sentence,
                  foundConcept.context,
                  concept,
                  issue.description,
                  chapterRef,
                  j
                );

                const chapterNum = chapterRef === 'prólogo' ? 0 : chapterRef;
                const correctionRecord: CorrectionRecord = {
                  id: `correction-${Date.now()}-${i}-multi-${j}`,
                  issueId: `issue-${i}`,
                  location: chapterRef === 'prólogo' ? 'Prólogo' : `Capítulo ${chapterRef}`,
                  chapterNumber: chapterNum,
                  originalText: foundConcept.sentence,
                  correctedText: alternative,
                  instruction: `[VARIACIÓN-MÚLTIPLE] ${issue.description}`,
                  severity: issue.severity,
                  status: alternative !== foundConcept.sentence ? 'pending' : 'rejected',
                  diffStats: calculateDiffStats(foundConcept.sentence, alternative),
                  createdAt: new Date().toISOString()
                };

                pendingCorrections.push(correctionRecord);
                
                if (alternative !== foundConcept.sentence) {
                  successCount++;
                  foundCount++;
                }

                await new Promise(resolve => setTimeout(resolve, 400));
              }
            }
          }
          
          totalOccurrences += Math.max(foundCount, 1);
          
          if (foundCount > 0) {
            continue;
          }
        }
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
