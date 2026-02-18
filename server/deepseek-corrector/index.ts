import OpenAI from 'openai';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { db } from '../db';
import { correctedManuscripts, manuscriptAudits, projects } from '@shared/schema';
import { eq } from 'drizzle-orm';
import type { CorrectionRecord, AuditIssue, AgentReport } from '@shared/schema';
import { getStructuralIssueFromCorrection, applyStructuralResolution } from './structural-resolver';

export { applyStructuralResolution, getStructuralIssueFromCorrection, isNarrativeFlowIssue, extractFlowBreakContext, generateFlowTransitionOptions } from './structural-resolver';

const deepseek = new OpenAI({
  baseURL: 'https://api.deepseek.com',
  apiKey: process.env.DEEPSEEK_API_KEY
});

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

const SYSTEM_PROMPT = `Eres un Editor Literario Técnico ("Cirujano de Texto") especializado en corrección invisible y MÍNIMA.
Tu objetivo es solucionar EXACTAMENTE el problema indicado sin alterar NADA más.
NO eres un co-autor creativo. NO mejores el estilo. NO resumas. NO embellezas.
Tu única métrica de éxito es que el lector no note que el texto ha sido editado.

REGLAS ABSOLUTAS:
1. Mantén el tono, vocabulario y ritmo del autor EXACTAMENTE como está.
2. NO añadas información nueva que no sea estrictamente necesaria para la corrección.
3. Devuelve SOLO el texto corregido, sin explicaciones, sin markdown, sin comillas.
4. PROHIBIDO usar clichés de IA: "un escalofrío recorrió", "el peso de", "no pudo evitar", "algo en su interior", "una oleada de", "el mundo se detuvo", "como si el universo", "sin poder evitarlo", "un nudo en", "la tensión era palpable", "intercambiaron una mirada", "con determinación renovada", "el silencio se hizo ensordecedor", "no era solo", "más que", "era como si", "sintió que", "una sensación de".
5. NO embellezas ni añadas metáforas. Sé MÍNIMO: cambia SOLO las palabras estrictamente necesarias.
6. Si la corrección requiere cambiar UNA palabra, cambia UNA palabra. No reescribas la oración entera.
7. PRINCIPIO DE NO-DAÑO: tu corrección NO debe introducir nuevos problemas. No cambies nombres de personajes, no alteres hechos establecidos, no modifiques descripciones que ya eran correctas, no añadas frases que no existían.
8. Preserva TODA la información factual del texto original: nombres, lugares, fechas, descripciones físicas, relaciones entre personajes.
9. El texto corregido debe tener una LONGITUD SIMILAR al original (±15%). No expandas ni recortes significativamente.`;

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
  
  const chapterPatterns = [
    /Cap[íi]tulos?\s*([\d,\s]+(?:y\s*\d+)?)/gi,
    /Cap[íi]tulo\s*(\d+)/gi,
    /capítulos\s*(\d+),\s*(\d+),\s*(\d+)/gi,
    /en los capítulos\s*([\d,\sy]+)/gi
  ];
  
  for (const pattern of chapterPatterns) {
    let match;
    while ((match = pattern.exec(location)) !== null) {
      const numStr = match[1] || match[0];
      const nums = numStr.match(/\d+/g);
      if (nums) {
        for (const n of nums) {
          const num = parseInt(n, 10);
          if (num > 0 && num < 100) {
            numbers.push(num);
          }
        }
      }
    }
  }
  
  if (numbers.length === 0) {
    const simpleMatches = location.match(/\d+/g);
    if (simpleMatches) {
      for (const m of simpleMatches) {
        const num = parseInt(m, 10);
        if (num > 0 && num < 100) {
          numbers.push(num);
        }
      }
    }
  }
  
  return Array.from(new Set(numbers)).sort((a, b) => a - b);
}

function extractChapterNumbersFromDescription(description: string): number[] {
  const numbers: number[] = [];
  
  const patterns = [
    /Cap[íi]tulos?\s*([\d,\s]+(?:y\s*\d+)?)/gi,
    /en (?:el )?cap[íi]tulo\s*(\d+)/gi,
    /capítulos\s+(\d+)(?:,\s*(\d+))+/gi
  ];
  
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(description)) !== null) {
      for (let j = 1; j < match.length; j++) {
        if (match[j]) {
          const nums = match[j].match(/\d+/g);
          if (nums) {
            for (const n of nums) {
              const num = parseInt(n, 10);
              if (num > 0 && num < 100) {
                numbers.push(num);
              }
            }
          }
        }
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
    
    const isNameAttribute = attribute.toLowerCase() === 'nombre' || attribute.toLowerCase() === 'name';
    const isPhysicalAttribute = ['ojos', 'eyes', 'cabello', 'hair', 'pelo'].some(a => attribute.toLowerCase().includes(a));
    
    let searchInstructions = '';
    if (isNameAttribute) {
      searchInstructions = `
1. Busca CUALQUIER mención donde el personaje se presente o sea llamado por un nombre diferente a "${correctValue}"
2. Busca diálogos donde se presente: "—Me llamo X", "Soy X", "Inspector/Inspectora X", "Doctor/Doctora X", etc.
3. Busca presentaciones narrativas: "X se presentó", "conocido como X", "llamado X"
4. El nombre incorrecto puede ser un nombre completo, solo el nombre de pila, o solo el apellido diferente`;
    } else if (isPhysicalAttribute) {
      searchInstructions = `
1. Busca CUALQUIER oración que describa el ${attribute} del personaje
2. Considera sinónimos: para "ojos" → "mirada", "iris", "pupilas"; para "cabello" → "pelo", "melena", "cabellera"
3. Busca descripciones como "sus ojos X", "el pelo X", "mirada X", "cabello X y rizado", etc.
4. El personaje puede referirse por nombre, apellido, o pronombres`;
    } else {
      searchInstructions = `
1. Busca CUALQUIER oración que mencione el ${attribute} del personaje
2. Busca descripciones directas e indirectas del atributo
3. El personaje puede referirse por nombre, apellido, o pronombres`;
    }
    
    const prompt = `Eres un detector de inconsistencias en manuscritos literarios.

TAREA: Buscar en el siguiente capítulo cualquier mención del atributo "${attribute}" del personaje "${characterName}" que NO coincida con el valor canónico de la Biblia de Personajes.

VALOR CANÓNICO (Biblia de Personajes): ${attribute} = "${correctValue}"

CAPÍTULO A ANALIZAR:
---
${chapterTitle}
${chapterContent.substring(0, 15000)}
---

INSTRUCCIONES:${searchInstructions}

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

function isNarrativeTransitionIssue(description: string): boolean {
  const transitionKeywords = [
    'salto abrupt',
    'transición',
    'sin resolver',
    'sin explicar',
    'cliffhanger',
    'no se explica',
    'salta de',
    'omite cómo',
    'sin aclarar',
    'queda sin resolver',
    'no hay transición',
    'brecha narrativa',
    'discontinuidad',
    'una hora después',
    'tiempo después',
    'al día siguiente'
  ];
  
  const lowerDesc = description.toLowerCase();
  return transitionKeywords.some(kw => lowerDesc.includes(kw));
}

interface TransitionCorrectionResult {
  success: boolean;
  originalText: string;
  correctedText: string;
  transitionText: string;
  diffStats: {
    wordsAdded: number;
    wordsRemoved: number;
    lengthChange: number;
  };
  error?: string;
}

async function correctNarrativeTransition(
  chapterContent: string,
  issueDescription: string,
  chapterTitle: string
): Promise<TransitionCorrectionResult> {
  if (!GEMINI_API_KEY) {
    return {
      success: false,
      originalText: '',
      correctedText: '',
      transitionText: '',
      diffStats: { wordsAdded: 0, wordsRemoved: 0, lengthChange: 0 },
      error: 'No hay API key de Gemini'
    };
  }
  
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    
    const analysisPrompt = `Eres un editor literario experto en continuidad narrativa.

PROBLEMA DETECTADO:
${issueDescription}

CAPÍTULO A ANALIZAR:
---
${chapterTitle}
${chapterContent.substring(0, 20000)}
---

TAREA: Identificar el punto exacto donde hay un salto narrativo abrupto y proponer una transición.

INSTRUCCIONES:
1. Encuentra la oración EXACTA donde termina la escena (antes del salto)
2. Encuentra la oración EXACTA donde comienza la nueva escena (después del salto)
3. Propón un párrafo de transición (2-4 oraciones) que explique brevemente qué pasó entre ambos momentos

FORMATO DE RESPUESTA (JSON estricto):
{
  "found": true,
  "beforeJump": "Oración exacta donde termina la escena antes del salto",
  "afterJump": "Oración exacta donde comienza la escena después del salto", 
  "proposedTransition": "Párrafo de transición que explica lo que pasó entre ambos momentos, manteniendo el estilo del autor"
}

Si no puedes identificar el salto:
{"found": false, "reason": "explicación"}

IMPORTANTE: Solo devuelve el JSON, sin explicaciones ni markdown.`;

    const result = await model.generateContent(analysisPrompt);
    const response = result.response.text().trim();
    
    console.log(`[Transition AI] Analysis response:`, response.substring(0, 300));
    
    const cleanedResponse = response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    
    try {
      const parsed = JSON.parse(cleanedResponse);
      
      if (parsed.found && parsed.beforeJump && parsed.afterJump && parsed.proposedTransition) {
        const beforeIndex = chapterContent.indexOf(parsed.beforeJump);
        const afterIndex = chapterContent.indexOf(parsed.afterJump);
        
        if (beforeIndex !== -1 && afterIndex !== -1 && afterIndex > beforeIndex) {
          const originalSection = chapterContent.substring(beforeIndex, afterIndex + parsed.afterJump.length);
          
          const transitionParagraph = `\n\n${parsed.proposedTransition}\n\n`;
          const correctedSection = parsed.beforeJump + transitionParagraph + parsed.afterJump;
          
          console.log(`[Transition AI] Found jump point, adding transition of ${parsed.proposedTransition.length} chars`);
          
          return {
            success: true,
            originalText: originalSection,
            correctedText: correctedSection,
            transitionText: parsed.proposedTransition,
            diffStats: calculateDiffStats(originalSection, correctedSection)
          };
        } else {
          console.log(`[Transition AI] Could not locate jump points in chapter`);
        }
      }
    } catch (parseErr) {
      console.log('[Transition AI] Failed to parse JSON response:', parseErr);
    }
    
    return {
      success: false,
      originalText: '',
      correctedText: '',
      transitionText: '',
      diffStats: { wordsAdded: 0, wordsRemoved: 0, lengthChange: 0 },
      error: 'No se pudo identificar el punto de transición'
    };
  } catch (error) {
    console.error('[Transition AI] Error:', error);
    return {
      success: false,
      originalText: '',
      correctedText: '',
      transitionText: '',
      diffStats: { wordsAdded: 0, wordsRemoved: 0, lengthChange: 0 },
      error: String(error)
    };
  }
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

### REGLAS DE EJECUCIÓN (CRÍTICO - CUMPLIMIENTO OBLIGATORIO)
1. Reescribe SOLAMENTE el "TEXTO A CORREGIR". Ni una palabra más, ni una palabra menos de lo necesario.
2. Mantén el tono, vocabulario y ritmo del autor EXACTAMENTE (ver Contexto Previo para referencia).
3. El nuevo texto debe fluir naturalmente hacia el "Contexto Posterior".
4. NO añadas información nueva que no sea estrictamente necesaria para la corrección.
5. PRESERVA todos los nombres, lugares, descripciones y hechos que ya eran correctos en el texto.
6. Tu corrección debe tener longitud SIMILAR al texto original (±15%). No expandas ni recortes.
7. Devuelve SOLO el texto corregido, sin explicaciones ni markdown ni comillas.
8. PIENSA ANTES DE CORREGIR: ¿tu cambio puede crear un nuevo problema de continuidad, estilo o coherencia? Si sí, busca una corrección más conservadora.`;

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

    if (!correctedText || correctedText.length > textToCorrect.length * 1.5 || correctedText.length < textToCorrect.length * 0.4) {
      console.log(`[DeepSeek] Corrección rechazada: longitud original=${textToCorrect.length}, corregida=${correctedText.length} (ratio=${(correctedText.length / textToCorrect.length).toFixed(2)})`);
      return {
        success: false,
        originalText: textToCorrect,
        correctedText: textToCorrect,
        diffStats: { wordsAdded: 0, wordsRemoved: 0, lengthChange: 0 },
        error: 'Corrección descartada: cambio de longitud excesivo'
      };
    }

    const originalWords = new Set(textToCorrect.toLowerCase().split(/\s+/).filter(w => w.length > 3));
    const correctedWords = new Set(correctedText.toLowerCase().split(/\s+/).filter(w => w.length > 3));
    let preserved = 0;
    for (const w of Array.from(originalWords)) {
      if (correctedWords.has(w)) preserved++;
    }
    const preservationRatio = originalWords.size > 0 ? preserved / originalWords.size : 1;
    if (preservationRatio < 0.4) {
      console.log(`[DeepSeek] Corrección rechazada: demasiado diferente (preservación=${(preservationRatio * 100).toFixed(0)}%)`);
      return {
        success: false,
        originalText: textToCorrect,
        correctedText: textToCorrect,
        diffStats: { wordsAdded: 0, wordsRemoved: 0, lengthChange: 0 },
        error: 'Corrección descartada: reescritura excesiva'
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
  const quotedPhrases = description.match(/'([^']{5,80})'/g);
  if (quotedPhrases && quotedPhrases.length > 0) {
    const firstPhrase = quotedPhrases[0].replace(/'/g, '').trim();
    console.log(`[MultiChapter] Concepto de frase entrecomillada: "${firstPhrase}"`);
    return firstPhrase;
  }
  
  const doubleQuotedPhrases = description.match(/"([^"]{5,80})"/g);
  if (doubleQuotedPhrases && doubleQuotedPhrases.length > 0) {
    const firstPhrase = doubleQuotedPhrases[0].replace(/"/g, '').trim();
    console.log(`[MultiChapter] Concepto de frase con comillas dobles: "${firstPhrase}"`);
    return firstPhrase;
  }

  const patterns = [
    /La descripción del?\s+(.+?)\s+se repite/i,
    /descripción de[l]?\s+(.+?)\s+se repite/i,
    /(.+?)\s+se repite con una frecuencia/i,
    /(.+?)\s+aparece de forma repetitiva/i,
    /menciones? de[l]?\s+(.+?)\s+(?:se|es|son)/i,
    /(?:el|la|los|las)\s+(.+?)\s+(?:es|son|aparece|se usa)/i,
    /Frases como\s+(.+?)\s+aparecen/i,
    /ejemplos? (?:incluyen?|como)\s+(.+?)(?:\.|,|$)/i
  ];
  
  for (const pattern of patterns) {
    const match = description.match(pattern);
    if (match && match[1]) {
      const concept = match[1].trim();
      if (concept.length > 5 && concept.length < 200) {
        console.log(`[MultiChapter] Concepto extraído por patrón: "${concept}"`);
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

function extractAllQuotedPhrases(description: string): string[] {
  const phrases: string[] = [];
  const singleQuoted = description.match(/'([^']{3,80})'/g) || [];
  const doubleQuoted = description.match(/"([^"]{3,80})"/g) || [];
  
  for (const p of singleQuoted) {
    phrases.push(p.replace(/'/g, '').trim());
  }
  for (const p of doubleQuoted) {
    phrases.push(p.replace(/"/g, '').trim());
  }
  
  return phrases.filter(p => p.length >= 3);
}

async function findConceptInChapter(
  chapterContent: string,
  concept: string,
  fullDescription: string
): Promise<{ sentence: string; context: string } | null> {
  const contentLower = chapterContent.toLowerCase();
  const conceptLower = concept.toLowerCase();
  
  const directIndex = contentLower.indexOf(conceptLower);
  if (directIndex !== -1) {
    const lineStart = chapterContent.lastIndexOf('\n', directIndex) + 1;
    const lineEnd = chapterContent.indexOf('\n', directIndex);
    const sentence = chapterContent.substring(lineStart, lineEnd === -1 ? undefined : lineEnd).trim();
    
    if (sentence.length >= 20) {
      const contextStart = Math.max(0, directIndex - 200);
      const contextEnd = Math.min(chapterContent.length, directIndex + concept.length + 200);
      const context = chapterContent.substring(contextStart, contextEnd);
      
      console.log(`[MultiChapter] Encontrado directo: "${concept}" → "${sentence.substring(0, 60)}..."`);
      return { sentence, context };
    }
  }
  
  const allPhrases = extractAllQuotedPhrases(fullDescription);
  for (const phrase of allPhrases) {
    const phraseLower = phrase.toLowerCase();
    const phraseIndex = contentLower.indexOf(phraseLower);
    
    if (phraseIndex !== -1) {
      const lineStart = chapterContent.lastIndexOf('\n', phraseIndex) + 1;
      const lineEnd = chapterContent.indexOf('\n', phraseIndex);
      const sentence = chapterContent.substring(lineStart, lineEnd === -1 ? undefined : lineEnd).trim();
      
      if (sentence.length >= 20) {
        const contextStart = Math.max(0, phraseIndex - 200);
        const contextEnd = Math.min(chapterContent.length, phraseIndex + phrase.length + 200);
        const context = chapterContent.substring(contextStart, contextEnd);
        
        console.log(`[MultiChapter] Encontrado frase "${phrase}" → "${sentence.substring(0, 60)}..."`);
        return { sentence, context };
      }
    }
  }
  
  const stopWords = ['de', 'del', 'la', 'el', 'los', 'las', 'en', 'con', 'una', 'un', 'se', 'que', 'por', 'para'];
  const keywords = concept.split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.includes(w.toLowerCase()))
    .map(w => w.toLowerCase());
  
  if (keywords.length === 0) {
    console.log(`[MultiChapter] Sin keywords válidas para buscar`);
    return null;
  }
  
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
  
  console.log(`[MultiChapter] Intentando búsqueda con IA...`);
  const aiResult = await findConceptWithAI(chapterContent, concept, fullDescription);
  if (aiResult) {
    return aiResult;
  }
  
  console.log(`[MultiChapter] No encontrado en capítulo`);
  return null;
}

async function findConceptWithAI(
  chapterContent: string,
  concept: string,
  fullDescription: string
): Promise<{ sentence: string; context: string } | null> {
  const geminiApiKey = process.env.GEMINI_API_KEY || process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
  if (!geminiApiKey) {
    console.log(`[MultiChapter AI] No hay API key de Gemini disponible`);
    return null;
  }
  
  const chapterPreview = chapterContent.substring(0, 12000);
  
  const prompt = `Analiza el siguiente texto de un capítulo y encuentra una oración que coincida con el problema descrito.

PROBLEMA A BUSCAR:
${fullDescription}

CONCEPTO CLAVE:
"${concept}"

TEXTO DEL CAPÍTULO:
${chapterPreview}

INSTRUCCIONES:
1. Busca una oración que contenga el concepto descrito o algo muy similar
2. Si encuentras una coincidencia, devuelve EXACTAMENTE en este formato JSON:
{"found": true, "sentence": "la oración exacta del texto", "reason": "breve explicación"}
3. Si NO encuentras ninguna coincidencia, devuelve:
{"found": false}

Responde SOLO con el JSON, sin explicaciones adicionales.`;

  try {
    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI({ apiKey: geminiApiKey });
    
    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: prompt
    });
    
    const text = response.text?.trim() || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    
    if (jsonMatch) {
      const result = JSON.parse(jsonMatch[0]);
      
      if (result.found && result.sentence) {
        const sentenceIndex = chapterContent.indexOf(result.sentence);
        
        if (sentenceIndex !== -1) {
          const contextStart = Math.max(0, sentenceIndex - 200);
          const contextEnd = Math.min(chapterContent.length, sentenceIndex + result.sentence.length + 200);
          const context = chapterContent.substring(contextStart, contextEnd);
          
          console.log(`[MultiChapter AI] Encontrado: "${result.sentence.substring(0, 60)}..." - ${result.reason}`);
          return { sentence: result.sentence, context };
        } else {
          const lines = chapterContent.split('\n');
          for (const line of lines) {
            if (line.toLowerCase().includes(result.sentence.toLowerCase().substring(0, 30))) {
              const idx = chapterContent.indexOf(line);
              const contextStart = Math.max(0, idx - 200);
              const contextEnd = Math.min(chapterContent.length, idx + line.length + 200);
              const context = chapterContent.substring(contextStart, contextEnd);
              
              console.log(`[MultiChapter AI] Encontrado (fuzzy): "${line.substring(0, 60)}..."`);
              return { sentence: line.trim(), context };
            }
          }
        }
      }
    }
  } catch (error) {
    console.error(`[MultiChapter AI] Error:`, error);
  }
  
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
6. PROHIBIDO usar clichés de IA: "un escalofrío recorrió", "el peso de", "no pudo evitar", "algo en su interior", "una oleada de", "la tensión era palpable", "con determinación renovada"
7. Sé MÍNIMO: varía solo lo necesario para eliminar la repetición

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
5. PROHIBIDO usar clichés de IA: "un escalofrío recorrió", "el peso de", "no pudo evitar", "algo en su interior", "una oleada de", "la tensión era palpable", "intercambiaron una mirada", "con determinación renovada"
6. Sé MÍNIMO: varía solo las palabras necesarias para eliminar la repetición

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

function extractChapterContentByLocation(novelContent: string, location: string): string | null {
  const locLower = location.toLowerCase();

  if (locLower.includes('prólogo') || locLower.includes('prologo')) {
    const data = extractChapterContent2(novelContent, 'prólogo');
    return data?.content || null;
  }

  if (locLower.includes('epílogo') || locLower.includes('epilogo')) {
    const epiloguePattern = /(?:^|\n)((?:EPÍLOGO|Epílogo|EPILOGO|Epilogo)[^\n]*\n)([\s\S]*?)(?=\n(?:Capítulo|CAPÍTULO|CAP\.)\s*\d+|$)/i;
    const match = novelContent.match(epiloguePattern);
    return match ? match[2].trim() : null;
  }

  const chapterMatch = location.match(/Cap[íi]tulo\s*(\d+)/i);
  if (chapterMatch) {
    const chapterNum = parseInt(chapterMatch[1]);
    const data = extractChapterContent2(novelContent, chapterNum);
    return data?.content || null;
  }

  return null;
}

function extractTargetFromLocation(novelContent: string, location: string, description: string): string | null {
  const chapterContent = extractChapterContentByLocation(novelContent, location);
  if (!chapterContent) return null;

  const sentences = chapterContent.match(/[^.!?]+[.!?]+/g) || [];
  if (sentences.length === 0) return null;

  const stopWords = new Set(['como', 'para', 'pero', 'más', 'entre', 'sobre', 'tiene', 'puede', 'desde', 'hasta', 'esta', 'este', 'estos', 'estas', 'también', 'donde', 'cuando', 'porque', 'aunque', 'mientras', 'durante', 'según', 'dentro', 'fuera', 'antes', 'después', 'hacia', 'menos', 'mayor', 'menor', 'mejor', 'peor', 'cada', 'todo', 'toda', 'todos', 'todas', 'otro', 'otra', 'otros', 'otras', 'mismo', 'misma', 'those', 'these', 'which', 'where', 'about', 'after', 'being', 'could', 'would', 'should', 'their', 'there', 'these', 'through', 'before', 'between', 'under', 'above']);
  const keywords = description.toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 3 && !stopWords.has(w));

  if (keywords.length === 0) return null;

  const quotedPhrases: string[] = [];
  const quotedMatches = description.match(/["'«»""'']([^"'«»""'']+)["'«»""'']/g);
  if (quotedMatches) {
    for (const qm of quotedMatches) {
      const cleaned = qm.replace(/["'«»""'']/g, '').trim();
      if (cleaned.length >= 5) quotedPhrases.push(cleaned.toLowerCase());
    }
  }

  let bestMatch = '';
  let bestScore = 0;

  for (let i = 0; i < sentences.length; i++) {
    const context = sentences.slice(Math.max(0, i - 1), i + 2).join(' ');
    const contextLower = context.toLowerCase();
    let score = 0;

    for (const qp of quotedPhrases) {
      if (contextLower.includes(qp)) {
        score += 5;
      }
    }

    for (const keyword of keywords) {
      if (contextLower.includes(keyword)) {
        score++;
      }
    }

    const minScore = Math.max(2, Math.floor(keywords.length * 0.15));
    if (score > bestScore && score >= minScore) {
      bestScore = score;
      bestMatch = sentences[i].trim();
    }
  }

  if (bestMatch.length > 20 && bestMatch.length < 500) return bestMatch;

  return null;
}

async function findTargetWithAI(chapterContent: string, issueDescription: string, chapterRef: string): Promise<string | null> {
  if (!GEMINI_API_KEY) return null;

  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    const prompt = `Eres un editor literario. Analiza el siguiente capítulo y encuentra la frase o párrafo EXACTO que presenta el problema descrito.

PROBLEMA:
${issueDescription}

CAPÍTULO (${chapterRef}):
---
${chapterContent.substring(0, 15000)}
---

INSTRUCCIONES:
1. Encuentra el fragmento de texto EXACTO (tal como aparece en el capítulo) que contiene el problema descrito.
2. El fragmento debe ser una frase completa o un párrafo corto (entre 30 y 300 caracteres).
3. Copia el texto EXACTAMENTE como aparece, sin modificarlo.
4. Si no encuentras el problema específico en este capítulo, responde solo: NO_ENCONTRADO

Responde SOLO con el fragmento exacto del texto problemático, sin explicaciones ni comillas adicionales.`;

    const result = await model.generateContent(prompt);
    const response = result.response.text().trim();

    if (response === 'NO_ENCONTRADO' || response.length < 15 || response.length > 500) {
      return null;
    }

    if (chapterContent.includes(response)) {
      console.log(`[AI-Target] Encontrado exacto en ${chapterRef}: "${response.substring(0, 60)}..."`);
      return response;
    }

    const normalized = response.replace(/\s+/g, ' ').trim();
    const contentNormalized = chapterContent.replace(/\s+/g, ' ');
    if (contentNormalized.includes(normalized)) {
      const idx = contentNormalized.indexOf(normalized);
      let charCount = 0;
      let realStart = 0;
      for (let i = 0; i < chapterContent.length && charCount < idx; i++) {
        if (!/\s/.test(chapterContent[i]) || (i > 0 && !/\s/.test(chapterContent[i - 1]))) {
          charCount++;
        }
        realStart = i;
      }
      const extracted = chapterContent.substring(realStart, realStart + response.length + 50).trim();
      if (extracted.length > 20) {
        console.log(`[AI-Target] Encontrado normalizado en ${chapterRef}: "${extracted.substring(0, 60)}..."`);
        return extracted;
      }
    }

    console.log(`[AI-Target] ${chapterRef}: IA devolvió texto que no coincide exactamente. Intentando fuzzy match...`);

    const words = response.split(/\s+/).slice(0, 5).join('\\s+');
    if (words.length > 10) {
      const fuzzyPattern = new RegExp(words.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\s\+/g, '\\s+'), 'i');
      const fuzzyMatch = chapterContent.match(fuzzyPattern);
      if (fuzzyMatch) {
        const matchIdx = fuzzyMatch.index || 0;
        const endIdx = Math.min(chapterContent.length, matchIdx + response.length + 20);
        const sentenceEnd = chapterContent.indexOf('.', matchIdx + 20);
        const actualEnd = sentenceEnd > matchIdx && sentenceEnd < endIdx + 100 ? sentenceEnd + 1 : endIdx;
        const extracted = chapterContent.substring(matchIdx, actualEnd).trim();
        if (extracted.length > 20 && extracted.length < 500) {
          console.log(`[AI-Target] Encontrado por fuzzy en ${chapterRef}: "${extracted.substring(0, 60)}..."`);
          return extracted;
        }
      }
    }

    return null;
  } catch (error) {
    console.error(`[AI-Target] Error en findTargetWithAI:`, error);
    return null;
  }
}

async function smartChapterCorrection(
  fullContent: string,
  issue: AuditIssue & { agentType: string },
  location: string
): Promise<{ originalText: string; correctedText: string; success: boolean; diffStats: { wordsAdded: number; wordsRemoved: number; lengthChange: number } }> {
  if (!GEMINI_API_KEY) {
    return { originalText: '', correctedText: '', success: false, diffStats: { wordsAdded: 0, wordsRemoved: 0, lengthChange: 0 } };
  }

  try {
    const chapterContent = extractChapterContentByLocation(fullContent, location);
    if (!chapterContent || chapterContent.length < 50) {
      return { originalText: '', correctedText: '', success: false, diffStats: { wordsAdded: 0, wordsRemoved: 0, lengthChange: 0 } };
    }

    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    const prompt = `Eres un editor literario quirúrgico. Tu tarea es identificar y corregir UN problema específico en el siguiente texto de forma MÍNIMA.

PROBLEMA A CORREGIR:
${issue.description}

SUGERENCIA DEL AUDITOR:
${issue.suggestion || 'Ninguna proporcionada'}

SEVERIDAD: ${issue.severity}

TEXTO DEL CAPÍTULO (${location}):
---
${chapterContent.substring(0, 12000)}
---

INSTRUCCIONES CRÍTICAS:
1. Identifica el fragmento EXACTO (1-3 oraciones) que contiene el problema
2. Genera una versión corregida de SOLO ese fragmento
3. El cambio debe ser MÍNIMO: cambia SOLO las palabras estrictamente necesarias
4. Mantén el estilo, tono y vocabulario del autor original
5. NO introduzcas clichés de IA, metáforas nuevas ni embellecimientos
6. NO reescribas más texto del necesario
7. Si el problema es sobre algo AUSENTE (falta una mención, falta un detalle), identifica el punto exacto donde insertar y muestra las 1-2 oraciones circundantes con la inserción incluida

Responde EXCLUSIVAMENTE en JSON válido con este formato exacto (sin markdown, sin backticks):
{"original": "texto exacto copiado del capítulo que contiene el problema", "corrected": "mismo texto con la corrección mínima aplicada"}`;

    const result = await model.generateContent(prompt);
    let responseText = result.response.text().trim();

    responseText = responseText.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();

    let parsed: { original: string; corrected: string };
    try {
      parsed = JSON.parse(responseText);
    } catch {
      const jsonMatch = responseText.match(/\{[\s\S]*"original"[\s\S]*"corrected"[\s\S]*\}/);
      if (jsonMatch) {
        try {
          parsed = JSON.parse(jsonMatch[0]);
        } catch {
          console.log(`[SmartCorrection] No se pudo parsear JSON de respuesta`);
          return { originalText: '', correctedText: '', success: false, diffStats: { wordsAdded: 0, wordsRemoved: 0, lengthChange: 0 } };
        }
      } else {
        return { originalText: '', correctedText: '', success: false, diffStats: { wordsAdded: 0, wordsRemoved: 0, lengthChange: 0 } };
      }
    }

    if (!parsed.original || !parsed.corrected || parsed.original === parsed.corrected) {
      return { originalText: '', correctedText: '', success: false, diffStats: { wordsAdded: 0, wordsRemoved: 0, lengthChange: 0 } };
    }

    if (parsed.corrected.length > parsed.original.length * 1.5 || parsed.corrected.length < parsed.original.length * 0.4) {
      console.log(`[SmartCorrection] Rechazado por cambio excesivo: orig=${parsed.original.length}, corr=${parsed.corrected.length} (ratio=${(parsed.corrected.length / parsed.original.length).toFixed(2)})`);
      return { originalText: '', correctedText: '', success: false, diffStats: { wordsAdded: 0, wordsRemoved: 0, lengthChange: 0 } };
    }

    const origWords = new Set(parsed.original.toLowerCase().split(/\s+/).filter(w => w.length > 3));
    const corrWords = new Set(parsed.corrected.toLowerCase().split(/\s+/).filter(w => w.length > 3));
    let smartPreserved = 0;
    for (const w of Array.from(origWords)) {
      if (corrWords.has(w)) smartPreserved++;
    }
    const smartPreservation = origWords.size > 0 ? smartPreserved / origWords.size : 1;
    if (smartPreservation < 0.4) {
      console.log(`[SmartCorrection] Rechazado: reescritura excesiva (preservación=${(smartPreservation * 100).toFixed(0)}%)`);
      return { originalText: '', correctedText: '', success: false, diffStats: { wordsAdded: 0, wordsRemoved: 0, lengthChange: 0 } };
    }

    let verifiedOriginal = parsed.original;
    if (!chapterContent.includes(parsed.original)) {
      const normalizedOrig = parsed.original.replace(/\s+/g, ' ').trim();
      const normalizedContent = chapterContent.replace(/\s+/g, ' ');
      if (normalizedContent.includes(normalizedOrig)) {
        const sentences = chapterContent.split(/(?<=[.!?])\s+/);
        for (const s of sentences) {
          if (s.replace(/\s+/g, ' ').trim().includes(normalizedOrig.substring(0, 40))) {
            verifiedOriginal = s.trim();
            break;
          }
        }
      } else {
        const firstWords = parsed.original.split(/\s+/).slice(0, 6).join('\\s+');
        if (firstWords.length > 15) {
          try {
            const fuzzyRegex = new RegExp(firstWords.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\s\+/g, '\\s+'), 'i');
            const fuzzyMatch = chapterContent.match(fuzzyRegex);
            if (fuzzyMatch && fuzzyMatch.index !== undefined) {
              const sentEnd = chapterContent.indexOf('.', fuzzyMatch.index + 20);
              const endPos = sentEnd > fuzzyMatch.index ? sentEnd + 1 : fuzzyMatch.index + parsed.original.length;
              verifiedOriginal = chapterContent.substring(fuzzyMatch.index, Math.min(endPos, fuzzyMatch.index + parsed.original.length + 50)).trim();
            } else {
              console.log(`[SmartCorrection] No se verificó texto original en capítulo`);
              return { originalText: '', correctedText: '', success: false, diffStats: { wordsAdded: 0, wordsRemoved: 0, lengthChange: 0 } };
            }
          } catch {
            return { originalText: '', correctedText: '', success: false, diffStats: { wordsAdded: 0, wordsRemoved: 0, lengthChange: 0 } };
          }
        } else {
          return { originalText: '', correctedText: '', success: false, diffStats: { wordsAdded: 0, wordsRemoved: 0, lengthChange: 0 } };
        }
      }
    }

    console.log(`[SmartCorrection] Éxito en ${location}: "${verifiedOriginal.substring(0, 50)}..." → "${parsed.corrected.substring(0, 50)}..."`);
    
    return {
      originalText: verifiedOriginal,
      correctedText: parsed.corrected,
      success: true,
      diffStats: calculateDiffStats(verifiedOriginal, parsed.corrected)
    };
  } catch (error) {
    console.error(`[SmartCorrection] Error:`, error);
    return { originalText: '', correctedText: '', success: false, diffStats: { wordsAdded: 0, wordsRemoved: 0, lengthChange: 0 } };
  }
}

export async function startCorrectionProcess(
  auditId: number,
  onProgress?: (progress: { phase: string; current: number; total: number; message: string }) => void,
  options?: { source?: string }
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

    const severityOrder: Record<string, number> = {
      'structural': 0, 'estructural': 0,
      'critical': 1, 'crítico': 1, 'critico': 1, 'grave': 1,
      'high': 2, 'alto': 2, 'alta': 2,
      'medium': 3, 'medio': 3, 'media': 3,
      'low': 4, 'bajo': 4, 'baja': 4,
      'minor': 5, 'menor': 5,
    };

    allIssues.sort((a, b) => {
      const sevA = (a.severity || '').toLowerCase().trim();
      const sevB = (b.severity || '').toLowerCase().trim();
      const orderA = severityOrder[sevA] ?? 3;
      const orderB = severityOrder[sevB] ?? 3;
      return orderA - orderB;
    });

    console.log(`[DeepSeek] Issues ordenados por severidad: ${allIssues.map(i => i.severity).join(', ')}`);

    const [manuscript] = await db.insert(correctedManuscripts).values({
      auditId,
      projectId: audit.projectId,
      status: 'correcting',
      source: options?.source || 'manual',
      originalContent: audit.novelContent,
      totalIssues: allIssues.length,
      pendingCorrections: []
    }).returning();

    onProgress?.({ phase: 'starting', current: 0, total: allIssues.length, message: 'Iniciando corrección quirúrgica...' });

    const pendingCorrections: CorrectionRecord[] = [];
    let correctedContent = audit.novelContent;
    let successCount = 0;

    let totalOccurrences = 0;

    const applyCumulatively = (record: CorrectionRecord): void => {
      if (record.status === 'pending' && record.originalText && record.correctedText &&
          record.originalText !== record.correctedText &&
          !record.originalText.startsWith('[')) {
        const updated = correctedContent.replace(record.originalText, record.correctedText);
        if (updated !== correctedContent) {
          correctedContent = updated;
          console.log(`[Cumulative] Aplicado: "${record.originalText.substring(0, 50)}..." → "${record.correctedText.substring(0, 50)}..."`);
        }
      }
    }
    
    for (let i = 0; i < allIssues.length; i++) {
      const issue = allIssues[i];
      
      onProgress?.({
        phase: 'correcting',
        current: i + 1,
        total: allIssues.length,
        message: `Corrigiendo issue ${i + 1}/${allIssues.length} [${(issue.severity || 'medium').toUpperCase()}]: ${(issue.description || '').substring(0, 80)}`
      });

      if (isNarrativeTransitionIssue(issue.description)) {
        onProgress?.({
          phase: 'analyzing',
          current: i + 1,
          total: allIssues.length,
          message: `Detectado salto narrativo: generando transición con IA...`
        });
        
        const chapterMatch = issue.location.match(/Cap[íi]tulo\s*(\d+)/i);
        const chapterNum = chapterMatch ? parseInt(chapterMatch[1]) : null;
        
        let chapterData = null;
        if (chapterNum) {
          chapterData = extractChapterContent2(correctedContent, chapterNum);
        }
        
        if (chapterData) {
          const transitionResult = await correctNarrativeTransition(
            chapterData.content,
            issue.description,
            `Capítulo ${chapterNum}`
          );
          
          if (transitionResult.success) {
            console.log(`[Transition] Generada transición de ${transitionResult.transitionText.length} caracteres`);
            
            const correctionRecord: CorrectionRecord = {
              id: `correction-${Date.now()}-${i}-transition`,
              issueId: `issue-${i}`,
              location: issue.location,
              chapterNumber: chapterNum || 0,
              originalText: transitionResult.originalText,
              correctedText: transitionResult.correctedText,
              instruction: `[TRANSICIÓN NARRATIVA] ${issue.description.substring(0, 100)}...`,
              severity: issue.severity,
              status: 'pending',
              diffStats: transitionResult.diffStats,
              createdAt: new Date().toISOString()
            };
            
            pendingCorrections.push(correctionRecord);
            applyCumulatively(correctionRecord);
            totalOccurrences++;
            successCount++;
            
            await new Promise(resolve => setTimeout(resolve, 500));
            continue;
          }
        }
      }

      let targetText = extractTargetFromLocation(correctedContent, issue.location, issue.description);

      if (!targetText) {
        const chapterContent = extractChapterContentByLocation(correctedContent, issue.location);
        if (chapterContent) {
          console.log(`[DeepSeek] Keyword matching falló para issue ${i + 1}. Intentando con IA en "${issue.location}"...`);
          onProgress?.({
            phase: 'analyzing',
            current: i + 1,
            total: allIssues.length,
            message: `Buscando texto problemático con IA en ${issue.location}...`
          });
          targetText = await findTargetWithAI(chapterContent, issue.description, issue.location);
        }
      }
      
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
        applyCumulatively(correctionRecord);
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
            applyCumulatively(correctionRecord);

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
              applyCumulatively(correctionRecord);

              if (alternative !== phrase) {
                successCount++;
              }

              await new Promise(resolve => setTimeout(resolve, 300));
            }
            totalOccurrences += ngramPhrases.length;
          } else {
            console.log(`[DeepSeek] Issue genérico ${i + 1}: sin frases, intentando corrección inteligente...`);
            const smartGeneric = await smartChapterCorrection(correctedContent, issue, issue.location);
            if (smartGeneric.success) {
              const smartGenRecord: CorrectionRecord = {
                id: `correction-${Date.now()}-${i}-smart-generic`,
                issueId: `issue-${i}`,
                location: issue.location,
                chapterNumber: parseInt(issue.location.match(/\d+/)?.[0] || '0'),
                originalText: smartGeneric.originalText,
                correctedText: smartGeneric.correctedText,
                instruction: `[CORRECCIÓN-INTELIGENTE-GENÉRICA] ${issue.description}`,
                severity: issue.severity,
                status: 'pending',
                diffStats: smartGeneric.diffStats,
                createdAt: new Date().toISOString()
              };
              pendingCorrections.push(smartGenRecord);
              applyCumulatively(smartGenRecord);
              totalOccurrences++;
              successCount++;
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
              
              const cbPrologueRecord: CorrectionRecord = {
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
              };
              pendingCorrections.push(cbPrologueRecord);
              applyCumulatively(cbPrologueRecord);
              
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
          console.log(`[CharacterBible Multi] Location: "${issue.location}"`);
          console.log(`[CharacterBible Multi] Description: "${issue.description.substring(0, 200)}..."`);
          
          let chapterNumbers = extractChapterNumbersFromLocation(issue.location || '');
          if (chapterNumbers.length === 0) {
            chapterNumbers = extractChapterNumbersFromDescription(issue.description);
          }
          if (chapterNumbers.length === 0) {
            chapterNumbers = extractChapterNumbersFromLocation(issue.description);
          }
          
          const hasEpilogue = issue.location?.toLowerCase().includes('epílogo') || 
                              issue.location?.toLowerCase().includes('epilogo') ||
                              issue.description.toLowerCase().includes('epílogo');
          const hasPrologue = issue.location?.toLowerCase().includes('prólogo') ||
                              issue.description.toLowerCase().includes('prólogo');
          
          console.log(`[CharacterBible Multi] Capítulos extraídos: [${chapterNumbers.join(', ')}], Prólogo: ${hasPrologue}, Epílogo: ${hasEpilogue}`);
          
          const totalParts = chapterNumbers.length + (hasPrologue ? 1 : 0) + (hasEpilogue ? 1 : 0);
          
          onProgress?.({
            phase: 'analyzing',
            current: i + 1,
            total: allIssues.length,
            message: `Character Bible multi-capítulo: buscando en ${totalParts} partes (${hasPrologue ? 'Prólogo, ' : ''}${chapterNumbers.length} capítulos${hasEpilogue ? ', Epílogo' : ''})...`
          });
          
          if (hasPrologue) {
            const prologueData = extractChapterContent2(correctedContent, 'prólogo');
            if (prologueData) {
              onProgress?.({
                phase: 'analyzing',
                current: i + 1,
                total: allIssues.length,
                message: `IA buscando "${characterBibleInfo.attribute}" de ${characterBibleInfo.characterName} en Prólogo...`
              });
              
              const foundResult = await findAttributeBySearchingAllWithAI(
                prologueData.content,
                characterBibleInfo.characterName,
                characterBibleInfo.attribute,
                characterBibleInfo.correctValue,
                characterBibleInfo.incorrectValue,
                'Prólogo'
              );
              
              if (foundResult) {
                console.log(`[CharacterBible AI Multi] Prólogo: encontrado "${foundResult.sentence.substring(0, 50)}..." (valor: ${foundResult.incorrectValue})`);
                
                const result = await correctSingleIssue({
                  fullChapter: prologueData.content,
                  targetText: foundResult.sentence,
                  instruction: `El personaje ${characterBibleInfo.characterName} tiene ${characterBibleInfo.attribute} como "${characterBibleInfo.correctValue}" según la biblia de personajes. Cambiar "${foundResult.incorrectValue}" a "${characterBibleInfo.correctValue}".`,
                  suggestion: `Reemplazar con: "${characterBibleInfo.correctValue}"`
                });
                
                const cbMultiPrologueRec: CorrectionRecord = {
                  id: `correction-${Date.now()}-${i}-prologue-multi`,
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
                };
                pendingCorrections.push(cbMultiPrologueRec);
                applyCumulatively(cbMultiPrologueRec);
                
                totalOccurrences++;
                if (result.success) successCount++;
                
                await new Promise(resolve => setTimeout(resolve, 500));
              } else {
                console.log(`[CharacterBible AI Multi] Prólogo: No se encontró inconsistencia`);
              }
            }
          }
          
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
                
                const cbMultiChRec: CorrectionRecord = {
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
                };
                pendingCorrections.push(cbMultiChRec);
                applyCumulatively(cbMultiChRec);
                
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
                
                const cbEpilogueRec: CorrectionRecord = {
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
                };
                pendingCorrections.push(cbEpilogueRec);
                applyCumulatively(cbEpilogueRec);
                
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

        const regexResult = findTextWithIncorrectValue(
          correctedContent,
          characterBibleInfo.incorrectValue,
          characterBibleInfo.chapterName
        );

        if (regexResult) {
          const result = await correctSingleIssue({
            fullChapter: regexResult.chapterContent,
            targetText: regexResult.foundText,
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
          applyCumulatively(correctionRecord);
          totalOccurrences++;

          if (result.success) {
            successCount++;
          }
          continue;
        }
        
        console.log(`[CharacterBible] Regex no encontró, intentando búsqueda con IA en ${characterBibleInfo.chapterName}...`);
        
        const chapterNumber = characterBibleInfo.chapterName.match(/\d+/)?.[0];
        const isPrologue = characterBibleInfo.chapterName.toLowerCase().includes('prólogo') || 
                           characterBibleInfo.chapterName.toLowerCase().includes('prologo');
        
        let chapterData = null;
        if (isPrologue) {
          chapterData = extractChapterContent2(correctedContent, 'prólogo');
        } else if (chapterNumber) {
          chapterData = extractChapterContent2(correctedContent, parseInt(chapterNumber));
        }
        
        if (chapterData) {
          onProgress?.({
            phase: 'analyzing',
            current: i + 1,
            total: allIssues.length,
            message: `IA buscando "${characterBibleInfo.attribute}" de ${characterBibleInfo.characterName} en ${characterBibleInfo.chapterName}...`
          });
          
          const aiResult = await findAttributeBySearchingAllWithAI(
            chapterData.content,
            characterBibleInfo.characterName,
            characterBibleInfo.attribute,
            characterBibleInfo.correctValue,
            characterBibleInfo.incorrectValue,
            characterBibleInfo.chapterName
          );
          
          if (aiResult) {
            console.log(`[CharacterBible AI Single] ${characterBibleInfo.chapterName}: encontrado "${aiResult.sentence.substring(0, 50)}..." (valor: ${aiResult.incorrectValue})`);
            
            const result = await correctSingleIssue({
              fullChapter: chapterData.content,
              targetText: aiResult.sentence,
              instruction: `El personaje ${characterBibleInfo.characterName} tiene ${characterBibleInfo.attribute} como "${characterBibleInfo.correctValue}" según la biblia de personajes. Corregir "${aiResult.incorrectValue}" a "${characterBibleInfo.correctValue}".`,
              suggestion: `Cambiar la descripción para que coincida con la biblia: "${characterBibleInfo.correctValue}"`
            });

            const correctionRecord: CorrectionRecord = {
              id: `correction-${Date.now()}-${i}-charfix-ai`,
              issueId: `issue-${i}`,
              location: characterBibleInfo.chapterName,
              chapterNumber: parseInt(chapterNumber || '0'),
              originalText: result.originalText,
              correctedText: result.correctedText,
              instruction: `[CHARACTER-BIBLE AI] ${characterBibleInfo.attribute}: "${aiResult.incorrectValue}" → "${characterBibleInfo.correctValue}"`,
              severity: issue.severity,
              status: result.success ? 'pending' : 'rejected',
              diffStats: result.diffStats,
              createdAt: new Date().toISOString()
            };

            pendingCorrections.push(correctionRecord);
            applyCumulatively(correctionRecord);
            totalOccurrences++;

            if (result.success) {
              successCount++;
            }
            continue;
          }
        }
      }

      const issueOcurrencias = (issue as any).ocurrencias as Array<{capitulo: number; frase_exacta: string}> | undefined;
      
      if (issueOcurrencias && issueOcurrencias.length > 0) {
        console.log(`[DeepSeek] Issue tiene ${issueOcurrencias.length} ocurrencias pre-identificadas`);
        
        onProgress?.({
          phase: 'analyzing',
          current: i + 1,
          total: allIssues.length,
          message: `Procesando ${issueOcurrencias.length} ocurrencias identificadas por la auditoría...`
        });
        
        let foundCount = 0;
        for (let j = 0; j < issueOcurrencias.length; j++) {
          const occ = issueOcurrencias[j];
          const chapterRef = occ.capitulo === 0 ? 'prólogo' as const : occ.capitulo;
          const chapterData = extractChapterContent2(correctedContent, chapterRef);
          
          if (chapterData && occ.frase_exacta) {
            console.log(`[DeepSeek Ocurrencia] Cap ${occ.capitulo}: buscando "${occ.frase_exacta.substring(0, 50)}..."`);
            
            const phraseIndex = chapterData.content.indexOf(occ.frase_exacta);
            let sentence = occ.frase_exacta;
            let context = '';
            
            if (phraseIndex !== -1) {
              const contextStart = Math.max(0, phraseIndex - 200);
              const contextEnd = Math.min(chapterData.content.length, phraseIndex + occ.frase_exacta.length + 200);
              context = chapterData.content.substring(contextStart, contextEnd);
            } else {
              const lines = chapterData.content.split('\n');
              for (const line of lines) {
                if (line.toLowerCase().includes(occ.frase_exacta.toLowerCase().substring(0, 30))) {
                  sentence = line.trim();
                  const idx = chapterData.content.indexOf(line);
                  context = chapterData.content.substring(Math.max(0, idx - 200), Math.min(chapterData.content.length, idx + line.length + 200));
                  break;
                }
              }
            }
            
            onProgress?.({
              phase: 'correcting',
              current: i + 1,
              total: allIssues.length,
              message: `Corrigiendo ocurrencia ${j + 1}/${issueOcurrencias.length} en ${occ.capitulo === 0 ? 'Prólogo' : 'Cap. ' + occ.capitulo}...`
            });
            
            const alternative = await generateVariedAlternative(
              sentence,
              context,
              occ.frase_exacta,
              issue.description,
              chapterRef,
              j
            );
            
            const correctionRecord: CorrectionRecord = {
              id: `correction-${Date.now()}-${i}-occ-${j}`,
              issueId: `issue-${i}`,
              location: occ.capitulo === 0 ? 'Prólogo' : `Capítulo ${occ.capitulo}`,
              chapterNumber: occ.capitulo,
              originalText: sentence,
              correctedText: alternative,
              instruction: `[OCURRENCIA-AUDITORÍA] ${issue.description}`,
              severity: issue.severity,
              status: alternative !== sentence ? 'pending' : 'rejected',
              diffStats: calculateDiffStats(sentence, alternative),
              createdAt: new Date().toISOString()
            };
            
            pendingCorrections.push(correctionRecord);
            applyCumulatively(correctionRecord);
            
            if (alternative !== sentence) {
              successCount++;
              foundCount++;
            }
            
            await new Promise(resolve => setTimeout(resolve, 400));
          }
        }
        
        totalOccurrences += Math.max(foundCount, 1);
        if (foundCount > 0) {
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
                applyCumulatively(correctionRecord);
                
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

      console.log(`[DeepSeek] Issue ${i + 1}: métodos estándar fallaron. Intentando corrección inteligente por capítulo con IA...`);
      
      onProgress?.({
        phase: 'correcting',
        current: i + 1,
        total: allIssues.length,
        message: `IA analizando capítulo completo para corregir issue ${i + 1}...`
      });

      const smartResult = await smartChapterCorrection(correctedContent, issue, issue.location);
      
      if (smartResult.success) {
        console.log(`[SmartCorrection] Issue ${i + 1} CORREGIDO por IA: "${smartResult.originalText.substring(0, 60)}..."`);
        
        const smartRecord: CorrectionRecord = {
          id: `correction-${Date.now()}-${i}-smart`,
          issueId: `issue-${i}`,
          location: issue.location,
          chapterNumber: parseInt(issue.location.match(/\d+/)?.[0] || '0'),
          originalText: smartResult.originalText,
          correctedText: smartResult.correctedText,
          instruction: `[CORRECCIÓN-INTELIGENTE] ${issue.description}`,
          severity: issue.severity,
          status: 'pending',
          diffStats: smartResult.diffStats,
          createdAt: new Date().toISOString()
        };
        
        pendingCorrections.push(smartRecord);
        applyCumulatively(smartRecord);
        totalOccurrences++;
        successCount++;
      } else {
        console.log(`[DeepSeek] Issue ${i + 1} NO CORREGIDO tras todos los intentos. Location: "${issue.location}", Severity: ${issue.severity}`);
        
        pendingCorrections.push({
          id: `correction-${Date.now()}-${i}`,
          issueId: `issue-${i}`,
          location: issue.location,
          chapterNumber: parseInt(issue.location.match(/\d+/)?.[0] || '0'),
          originalText: '[No se pudo localizar el texto exacto]',
          correctedText: '',
          instruction: `[NO LOCALIZABLE] ${issue.description}`,
          severity: issue.severity,
          status: 'rejected',
          diffStats: { wordsAdded: 0, wordsRemoved: 0, lengthChange: 0 },
          createdAt: new Date().toISOString()
        });
        totalOccurrences++;
      }
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

    let updatedContent = manuscript.correctedContent || manuscript.originalContent;
    const nonCorrectableMarkers = [
      '[No se pudo localizar el texto exacto]',
      '[Problema genérico sin frases identificables]',
      '[Edita manualmente el texto original aquí]',
    ];
    if (!nonCorrectableMarkers.includes(correction.originalText)) {
      const beforeReplace = updatedContent;
      updatedContent = updatedContent.replace(correction.originalText, correction.correctedText);
      if (updatedContent === beforeReplace) {
        console.log(`[ApproveCorrection] WARNING: Replacement had no effect for correction ${correctionId}. Original text not found in content. Marking as skipped.`);
        correction.status = 'rejected';
        correction.reviewedAt = new Date().toISOString();
        await db.update(correctedManuscripts)
          .set({ pendingCorrections })
          .where(eq(correctedManuscripts.id, manuscriptId));
        return false;
      }
    }

    correction.status = 'approved';
    correction.reviewedAt = new Date().toISOString();

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
