/**
 * Agent Runner - Executes literary analysis agents
 * Uses your own Gemini API key for portability
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import type { AgentReport, AuditIssue } from "@shared/schema";
import { getCurrentContext, getModelName } from "./cache-manager";

// Use your own Gemini API key
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

export type AgentType = 'CONTINUITY' | 'CHARACTER' | 'STYLE';

interface AgentConfig {
  type: AgentType;
  prompt: string;
  focusAreas: string[];
}

const AGENT_CONFIGS: Record<AgentType, AgentConfig> = {
  CONTINUITY: {
    type: 'CONTINUITY',
    focusAreas: ['Cronología', 'Relaciones', 'Objetos', 'Ubicaciones', 'Datos biográficos'],
    prompt: `ROL: AGENTE FORENSE DE CONTINUIDAD - Editor profesional de manuscritos

MISIÓN CRÍTICA: Detectar TODAS las inconsistencias factuales en la novela. Sé extremadamente meticuloso.

=== ERRORES PRIORITARIOS A DETECTAR ===

1. RELACIONES FAMILIARES CONTRADICTORIAS (CRÍTICO):
   - Personaje mencionado como "hija" en un capítulo y "sobrina" en otro
   - Cambios en parentesco: hermano/primo, esposa/novia, etc.
   - Contradicciones en árbol genealógico
   
2. INCONSISTENCIAS DE EDAD Y FECHAS (CRÍTICO):
   - Edad de un personaje que no cuadra con fechas mencionadas
   - Ejemplo: "Murió hace 10 años cuando ella tenía 5" pero luego "tiene 20 años" = no cuadra
   - Personajes que no envejecen coherentemente
   - Fechas históricas que contradicen edades establecidas

3. ATRIBUTOS FÍSICOS CAMBIANTES (ALTO):
   - Color de ojos/pelo que cambia entre capítulos
   - Cicatrices, marcas, tatuajes que aparecen/desaparecen
   - Altura, complexión mencionada diferente

4. OBJETOS Y POSESIONES:
   - Items destruidos que reaparecen
   - Objetos en posesión de quien no debería tenerlos
   - Dinero/recursos que no cuadran

5. UBICACIONES Y GEOGRAFÍA:
   - Distancias imposibles de recorrer en el tiempo indicado
   - Descripciones contradictorias del mismo lugar
   - Personajes en dos lugares simultáneamente

6. LÍNEA TEMPORAL:
   - Eventos fuera de secuencia lógica
   - Flashbacks que contradicen el presente narrativo
   - Estaciones/clima inconsistentes con fechas

INSTRUCCIONES:
- Lee CADA capítulo comparándolo con los demás
- Extrae TODOS los datos factuales y compáralos
- Si X="hija" en Cap.5 pero X="sobrina" en Cap.12, eso es CRÍTICO
- Si edad + fecha de evento no cuadra matemáticamente, es CRÍTICO
- Cita el texto exacto donde encontraste la contradicción

FORMATO JSON REQUERIDO:
{
  "agentType": "CONTINUITY",
  "overallScore": [0-100],
  "analysis": "[Resumen detallado de hallazgos, 3-4 párrafos]",
  "issues": [
    {
      "location": "Capítulo X vs Capítulo Y",
      "description": "[Contradicción específica con citas textuales]",
      "severity": "CRITICAL|HIGH|MEDIUM|LOW",
      "suggestion": "[Corrección específica propuesta]"
    }
  ]
}`
  },
  
  CHARACTER: {
    type: 'CHARACTER',
    focusAreas: ['Coherencia de datos', 'Relaciones', 'Biografía', 'Psicología'],
    prompt: `ROL: AGENTE FORENSE DE PERSONAJES - Editor profesional de manuscritos

MISIÓN CRÍTICA: Verificar coherencia FACTUAL y psicológica de cada personaje.

=== ERRORES PRIORITARIOS A DETECTAR ===

1. DATOS BIOGRÁFICOS CONTRADICTORIOS (CRÍTICO):
   - Nombre que cambia (ej: "María" en un cap, "Marta" en otro)
   - Profesión diferente en distintos capítulos
   - Lugar de nacimiento contradictorio
   - Estado civil que cambia sin explicación (casado/soltero)
   
2. RELACIONES FAMILIARES INCONSISTENTES (CRÍTICO):
   - Personaje es "hija de X" en un lugar y "sobrina de X" en otro
   - Número de hijos que varía
   - Hermanos que aparecen/desaparecen
   - Padres vivos/muertos según conveniencia

3. CRONOLOGÍA PERSONAL (ALTO):
   - Eventos de la vida que no cuadran con la edad actual
   - "Trabajé 20 años como médico" pero el personaje tiene 30 años
   - Fechas de nacimiento/muerte de familiares inconsistentes

4. CONOCIMIENTOS Y HABILIDADES:
   - Sabe algo en un capítulo que no debería saber
   - Olvida habilidades establecidas previamente
   - Idiomas que habla varían

5. COHERENCIA PSICOLÓGICA:
   - Cambios de personalidad sin justificación narrativa
   - Motivaciones contradictorias
   - Miedos/traumas que desaparecen sin resolver

INSTRUCCIONES:
- Crea una ficha mental de cada personaje principal
- Compara TODOS los datos mencionados sobre cada uno
- Detecta cualquier contradicción factual
- Cita textualmente las contradicciones encontradas

FORMATO JSON REQUERIDO:
{
  "agentType": "CHARACTER",
  "overallScore": [0-100],
  "analysis": "[Análisis detallado de coherencia de personajes]",
  "issues": [
    {
      "location": "Capítulo X vs Capítulo Y",
      "description": "[Contradicción con citas textuales]",
      "severity": "CRITICAL|HIGH|MEDIUM|LOW",
      "suggestion": "[Corrección propuesta]"
    }
  ]
}`
  },
  
  STYLE: {
    type: 'STYLE',
    focusAreas: ['Prosa', 'Ritmo', 'Diálogos', 'Repeticiones'],
    prompt: `ROL: AGENTE DE ESTILO - Editor literario profesional

MISIÓN: Evaluar calidad de prosa y detectar problemas técnicos de escritura.

=== PROBLEMAS A DETECTAR ===

1. REPETICIONES LÉXICAS (ALTO):
   - Misma palabra/frase usada excesivamente
   - Muletillas del autor ("de repente", "sin embargo")
   - Descripciones repetitivas de rasgos físicos

2. SHOW DON'T TELL (MEDIO):
   - Exceso de exposición vs. demostración
   - Emociones explicadas en lugar de mostradas
   - Backstory en info-dumps

3. DIÁLOGOS (ALTO):
   - Diálogos poco naturales o expositivos
   - Voces indistinguibles entre personajes
   - Uso excesivo de adverbios en acotaciones

4. RITMO Y PACING:
   - Secciones que arrastran
   - Transiciones bruscas
   - Escenas innecesarias

5. CLICHÉS Y LUGARES COMUNES:
   - Frases hechas excesivas
   - Descripciones gastadas
   - Metáforas trilladas

FORMATO JSON REQUERIDO:
{
  "agentType": "STYLE",
  "overallScore": [0-100],
  "analysis": "[Análisis de calidad estilística]",
  "issues": [
    {
      "location": "Capítulo X",
      "description": "[Problema específico con ejemplo]",
      "severity": "CRITICAL|HIGH|MEDIUM|LOW",
      "suggestion": "[Corrección propuesta]"
    }
  ]
}`
  }
};

/**
 * Run a single agent - uses Standard mode with full context injection
 */
export async function runAgent(agentType: AgentType): Promise<AgentReport> {
  console.log(`[AgentRunner] Running ${agentType} agent...`);
  
  const config = AGENT_CONFIGS[agentType];
  const context = getCurrentContext();
  
  try {
    console.log(`[AgentRunner] ${agentType}: Using Gemini ${getModelName()}`);
    
    const model = genAI.getGenerativeModel({
      model: getModelName(),
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.3,
        maxOutputTokens: 8192,
      },
    });
    
    let fullContext = "";
    if (context?.novelContent) {
      fullContext = `=== NOVELA COMPLETA ===\n\n${context.novelContent}`;
      if (context.bibleContent) {
        fullContext += `\n\n=== BIBLIA DE LA HISTORIA ===\n\n${context.bibleContent}`;
      }
    }
    
    const systemPrompt = "Eres un Editor Literario Senior. Responde SIEMPRE en JSON válido.";
    const fullPrompt = `SYSTEM: ${systemPrompt}\n\nCONTEXTO:\n${fullContext}\n\n${config.prompt}`;
    
    const result = await model.generateContent(fullPrompt);
    const text = result.response.text();
    
    if (!text) {
      throw new Error("No text response from Gemini");
    }
    
    const parsed = JSON.parse(text) as AgentReport;
    
    if (!parsed.agentType || typeof parsed.overallScore !== 'number' || !Array.isArray(parsed.issues)) {
      throw new Error("Invalid agent report structure");
    }
    
    console.log(`[AgentRunner] ${agentType} complete: score ${parsed.overallScore}, ${parsed.issues.length} issues`);
    
    return {
      agentType: config.type,
      overallScore: Math.min(100, Math.max(0, parsed.overallScore)),
      analysis: parsed.analysis || "",
      issues: parsed.issues.map(issue => ({
        location: issue.location || "Unknown",
        description: issue.description || "",
        severity: (['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].includes(issue.severity) 
          ? issue.severity 
          : 'MEDIUM') as AuditIssue['severity'],
        suggestion: issue.suggestion || "",
      })),
    };
    
  } catch (error) {
    console.error(`[AgentRunner] ${agentType} agent error:`, error);
    
    return {
      agentType: config.type,
      overallScore: 0,
      analysis: `Error durante el análisis: ${error instanceof Error ? error.message : 'Error desconocido'}`,
      issues: [{
        location: "Sistema",
        description: `El agente de ${agentType} encontró un error`,
        severity: 'HIGH',
        suggestion: "Reintentar el análisis",
      }],
    };
  }
}

/**
 * Run all agents in parallel
 */
export async function runAllAgents(): Promise<AgentReport[]> {
  console.log("[AgentRunner] Starting parallel agent execution...");
  
  const results = await Promise.all([
    runAgent('CONTINUITY'),
    runAgent('CHARACTER'),
    runAgent('STYLE'),
  ]);
  
  console.log("[AgentRunner] All agents completed");
  return results;
}

/**
 * Count critical issues from all reports
 */
export function countCriticalIssues(reports: AgentReport[]): number {
  return reports.reduce((count, report) => {
    return count + report.issues.filter(i => i.severity === 'CRITICAL').length;
  }, 0);
}

/**
 * Calculate overall score from all reports
 */
export function calculateOverallScore(reports: AgentReport[]): number {
  if (reports.length === 0) return 0;
  const totalScore = reports.reduce((sum, report) => sum + report.overallScore, 0);
  return Math.round(totalScore / reports.length);
}
