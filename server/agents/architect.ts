import { BaseAgent, AgentResponse } from "./base-agent";

interface ArchitectInput {
  title: string;
  genre: string;
  tone: string;
  chapterCount: number;
  ideaInicial?: string;
  guiaEstilo?: string;
}

const SYSTEM_PROMPT = `
Eres un Arquitecto de Tramas Maestro y Supervisor de Continuidad Literaria con capacidad de RAZONAMIENTO PROFUNDO (Deep Thinking).
Tu especialidad es la logística narrativa rigurosa. Tu salida DEBE ser un objeto JSON válido para alimentar el sistema de memoria de la aplicación.

PRINCIPIOS DE RAZONAMIENTO (Tus Guardrails):
1. ANTES de proponer una escena, simula internamente la posición física de cada personaje.
2. Si un personaje se mueve, debe haber un rastro de tiempo y espacio coherente.
3. Asegura la causalidad mecánica: cada acción debe ser consecuencia de una anterior.

TU MISIÓN:
Crear la "Guía de Escritura Extendida" (Blueprint) y la base de datos "World Bible".

INSTRUCCIONES DE SALIDA:
Genera un JSON con las siguientes claves:
- "world_bible": { 
    "personajes": [{ "nombre": "", "rol": "", "perfil_psicologico": "", "arco": "", "relaciones": [], "vivo": true }], 
    "lugares": [{ "nombre": "", "descripcion": "", "reglas": [] }], 
    "reglas_lore": [{ "categoria": "", "regla": "", "restricciones": [] }] 
  }
- "escaleta_capitulos": [
    {
      "numero": 1,
      "titulo": "",
      "cronologia": "",
      "ubicacion": "",
      "elenco_presente": [],
      "objetivo_narrativo": "",
      "beats": [],
      "continuidad_salida": "Estado final de los personajes y el entorno para el próximo agente"
    }
]
- "premisa": "Premisa central de la historia"
- "estructura_tres_actos": {
    "acto1": { "planteamiento": "", "incidente_incitador": "" },
    "acto2": { "accion_ascendente": "", "punto_medio": "", "complicaciones": "" },
    "acto3": { "climax": "", "resolucion": "" }
  }
`;

export class ArchitectAgent extends BaseAgent {
  constructor() {
    super({
      name: "El Arquitecto",
      role: "architect",
      systemPrompt: SYSTEM_PROMPT,
    });
  }

  async execute(input: ArchitectInput): Promise<AgentResponse> {
    const guiaEstilo = input.guiaEstilo || `Género: ${input.genre}, Tono: ${input.tone}`;
    const ideaInicial = input.ideaInicial || input.title;

    const prompt = `
    Basándote en esta idea: "${ideaInicial}" 
    Y siguiendo esta Guía de Estilo: "${guiaEstilo}"
    
    Genera el plan completo para una novela de ${input.chapterCount} capítulos.
    
    TÍTULO: ${input.title}
    GÉNERO: ${input.genre}
    TONO: ${input.tone}
    
    Genera el plan completo de la novela siguiendo tus protocolos de arquitectura.
    Responde ÚNICAMENTE con el JSON estructurado según las instrucciones.
    `;

    const response = await this.generateContent(prompt);
    
    try {
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        JSON.parse(jsonMatch[0]);
        response.content = jsonMatch[0];
      }
    } catch (e) {
      console.error("[Architect] Failed to parse JSON response");
    }

    return response;
  }
}
