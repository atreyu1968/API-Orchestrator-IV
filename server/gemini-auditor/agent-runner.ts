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
    focusAreas: ['Cronología', 'Objetos', 'Ubicaciones', 'Reglas del mundo'],
    prompt: `ROL: AGENTE DE CONTINUIDAD
TAREA: Detectar inconsistencias lógicas y temporales en la novela.

ANALIZA:
1. CRONOLOGÍA: Contradicciones temporales, eventos fuera de orden, edades que no cuadran
2. OBJETOS: Elementos que aparecen/desaparecen sin lógica
3. UBICACIONES: Distancias imposibles, descripciones contradictorias
4. REGLAS DEL MUNDO: Magia/tecnología usada inconsistentemente

FORMATO JSON REQUERIDO:
{
  "agentType": "CONTINUITY",
  "overallScore": [0-100],
  "analysis": "[Resumen de 2-3 párrafos]",
  "issues": [
    {
      "location": "[Capítulo X, cita]",
      "description": "[Problema]",
      "severity": "CRITICAL|HIGH|MEDIUM|LOW",
      "suggestion": "[Cómo arreglarlo]"
    }
  ]
}`
  },
  
  CHARACTER: {
    type: 'CHARACTER',
    focusAreas: ['Psicología', 'Voz', 'Evolución', 'Motivaciones'],
    prompt: `ROL: AGENTE DE PERSONAJES
TAREA: Evaluar psicología y coherencia de personajes.

ANALIZA:
1. EVOLUCIÓN: ¿Los arcos están justificados? ¿Hay cambios erráticos?
2. VOZ: ¿Cada personaje tiene voz distintiva y consistente?
3. MOTIVACIONES: ¿Las acciones tienen sentido según sus valores?
4. RELACIONES: ¿Las dinámicas evolucionan coherentemente?

FORMATO JSON REQUERIDO:
{
  "agentType": "CHARACTER",
  "overallScore": [0-100],
  "analysis": "[Resumen de 2-3 párrafos]",
  "issues": [
    {
      "location": "[Capítulo X, cita]",
      "description": "[Problema]",
      "severity": "CRITICAL|HIGH|MEDIUM|LOW",
      "suggestion": "[Cómo arreglarlo]"
    }
  ]
}`
  },
  
  STYLE: {
    type: 'STYLE',
    focusAreas: ['Prosa', 'Ritmo', 'Diálogos', 'Show vs Tell'],
    prompt: `ROL: AGENTE DE ESTILO
TAREA: Evaluar calidad de prosa y técnica narrativa.

ANALIZA:
1. SHOW DON'T TELL: Exceso de exposición vs. demostración
2. REPETICIONES: Palabras/frases usadas excesivamente
3. DIÁLOGOS: Naturalidad, voces distintivas
4. RITMO: Secciones estancadas, pacing, transiciones
5. PROSA: Calidad de descripciones, metáforas

FORMATO JSON REQUERIDO:
{
  "agentType": "STYLE",
  "overallScore": [0-100],
  "analysis": "[Resumen de 2-3 párrafos]",
  "issues": [
    {
      "location": "[Capítulo X, cita]",
      "description": "[Problema]",
      "severity": "CRITICAL|HIGH|MEDIUM|LOW",
      "suggestion": "[Cómo arreglarlo]"
    }
  ]
}`
  }
};

/**
 * Run a single agent - automatically uses Cache or Standard mode
 */
export async function runAgent(cacheIdOrContext: string, agentType: AgentType): Promise<AgentReport> {
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
export async function runAllAgents(cacheId: string): Promise<AgentReport[]> {
  console.log("[AgentRunner] Starting parallel agent execution...");
  
  const results = await Promise.all([
    runAgent(cacheId, 'CONTINUITY'),
    runAgent(cacheId, 'CHARACTER'),
    runAgent(cacheId, 'STYLE'),
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
