// LitAgents 2.1 - The Critic (Beta Reader) Prompts
// Genre-aware evaluation prompts for commercial viability assessment

export const CRITIC_PROMPTS = {
  // A. THE EVALUATOR (R1 - Reasoner)
  // Analyzes global structure using chapter summaries
  FULL_EVALUATION: (genre: string, summaryBlock: string, firstChapter: string, lastChapter: string) => `
Actúa como un Editor Senior de una editorial "Big Five", especializado en ${genre}.
Has recibido un manuscrito. Aquí tienes la radiografía estructural:

=== RESUMEN CAPÍTULO A CAPÍTULO ===
${summaryBlock}

=== MUESTRA DE INICIO (GANCHO) ===
"${firstChapter.substring(0, 4000)}..."

=== MUESTRA DE FINAL (CLÍMAX/RESOLUCIÓN) ===
"${lastChapter.substring(Math.max(0, lastChapter.length - 4000))}..."

TAREA:
Realiza una crítica despiadada enfocada en la viabilidad comercial.

1. **Ritmo (Pacing):** ¿Dónde se estanca la historia? Identifica el "valle de la muerte" (segundo acto aburrido).
2. **Arco de Personaje:** ¿El protagonista del final es diferente al del inicio? ¿Hay transformación?
3. **Promesa del Género:** ¿Cumple lo que promete un ${genre}?
   - Thriller: ¿Hay tensión sostenida y giros inesperados?
   - Romance: ¿Hay química creíble y resolución emocional satisfactoria?
   - Mystery: ¿Las pistas están bien sembradas? ¿El culpable es sorprendente pero justo?
   - Historical: ¿La ambientación es inmersiva? ¿Los detalles de época son creíbles?
4. **Gancho Inicial:** ¿El primer capítulo engancha al lector de tienda de libros que hojea?
5. **Satisfacción del Cierre:** ¿El final paga las promesas del inicio?

SALIDA JSON (Plan de Acción):
{
  "score": <1-10>,
  "viability": "<High/Medium/Low>",
  "critique_summary": "<Texto de opinión de 300 palabras con el análisis general>",
  "strengths": ["<Punto fuerte 1>", "<Punto fuerte 2>"],
  "weaknesses": ["<Debilidad 1>", "<Debilidad 2>"],
  "flagged_chapters": [
    {
      "chapter_number": <número>,
      "issue_type": "<PACING_SLOW|CHARACTER_FLAT|DIALOGUE_WEAK|TENSION_DROP|LOGIC_HOLE|EXPOSITION_DUMP>",
      "severity": "<HIGH|MEDIUM|LOW>",
      "specific_fix": "<Instrucción concreta de corrección>"
    }
  ],
  "market_comparison": "<A qué bestsellers del género se parece, y en qué se queda corto>"
}

NOTA: Sé conservador. Solo marca capítulos que realmente maten el interés del lector.
Un libro de 8+ no necesita muchos arreglos. Uno de 5-7 necesita cirugía en puntos clave.
`,

  // B. THE EXECUTOR (V3 - Writer)
  // Rewrites a specific chapter based on the critique
  SURGICAL_REWRITE: (originalText: string, issueType: string, fixInstruction: string, genre: string) => `
ACTÚA COMO UN 'BOOK DOCTOR' (Editor de Desarrollo) especializado en ${genre}.

CAPÍTULO ORIGINAL:
"${originalText}"

EL DIAGNÓSTICO DEL CRÍTICO:
Problema detectado: ${issueType}

TU ORDEN DE OPERACIÓN:
"${fixInstruction}"

INSTRUCCIONES:
Reescribe el capítulo para obedecer la orden. Guías específicas:

- **PACING_SLOW**: Elimina secciones que no avancen la trama. Comprime diálogos. Acelera transiciones.
- **CHARACTER_FLAT**: Añade conflicto interno, decisiones difíciles, reacciones emocionales físicas.
- **DIALOGUE_WEAK**: Haz el diálogo más natural, con subtexto. Cada personaje debe tener voz única.
- **TENSION_DROP**: Añade stakes, amenazas inminentes, relojes de cuenta atrás narrativos.
- **LOGIC_HOLE**: Añade justificación o elimina la inconsistencia sin cambiar hechos clave.
- **EXPOSITION_DUMP**: Distribuye la información en acción, diálogo natural, o elimina lo innecesario.

REGLAS INQUEBRANTABLES:
1. NO cambies hechos clave de la trama (muertes, objetos obtenidos, revelaciones) a menos que se te pida explícitamente.
2. Mantén el estilo de prosa original (si es lírico, sigue lírico; si es directo, sigue directo).
3. Mantén la longitud aproximada del capítulo original (±20%).
4. Preserva el formato de diálogo español (guion largo —).

OUTPUT: Solo el texto del capítulo reescrito. Sin comentarios, sin explicaciones.
`,

  // C. QUICK ASSESSMENT (V3 - For pre-filtering)
  // Fast check to see if a chapter needs the critic's attention
  QUICK_SCAN: (chapterText: string, chapterNumber: number, genre: string) => `
Eres un lector profesional de manuscritos. Lee este capítulo ${chapterNumber} de una novela de ${genre}:

"${chapterText.substring(0, 6000)}..."

Responde SOLO con JSON:
{
  "needs_attention": <true/false>,
  "issue_type": "<PACING_SLOW|CHARACTER_FLAT|DIALOGUE_WEAK|TENSION_DROP|LOGIC_HOLE|EXPOSITION_DUMP|NONE>",
  "severity": "<HIGH|MEDIUM|LOW|NONE>",
  "one_line_reason": "<En una frase, por qué necesita o no atención>"
}

Sé estricto: Solo marca "needs_attention": true si hay un problema real que afecte la experiencia del lector.
`,
};

// Genre-specific evaluation criteria
export const GENRE_CRITERIA: Record<string, { mustHave: string[]; dealBreakers: string[] }> = {
  thriller: {
    mustHave: ["Tensión sostenida", "Giros inesperados", "Stakes altos", "Antagonista amenazante"],
    dealBreakers: ["Ritmo lento en segundo acto", "Villano predecible", "Resolución Deus Ex Machina"]
  },
  mystery: {
    mustHave: ["Pistas justas sembradas", "Culpable sorprendente pero lógico", "Red herrings efectivos"],
    dealBreakers: ["Información oculta al lector", "Resolución que depende de coincidencia", "Detective pasivo"]
  },
  romance: {
    mustHave: ["Química creíble", "Obstáculos emocionales", "Resolución satisfactoria", "Momentos emotivos"],
    dealBreakers: ["Protagonistas sin química", "Conflicto artificial", "Falta de tensión romántica"]
  },
  historical: {
    mustHave: ["Ambientación inmersiva", "Detalles de época", "Conflicto relevante al período"],
    dealBreakers: ["Anacronismos evidentes", "Personajes con mentalidad moderna", "Ambientación genérica"]
  },
  fantasy: {
    mustHave: ["Sistema de magia coherente", "Worldbuilding inmersivo", "Conflicto épico"],
    dealBreakers: ["Magia como Deus Ex Machina", "Info-dumps de worldbuilding", "Elegido sin agency"]
  },
  crime_thriller: {
    mustHave: ["Procedimiento creíble", "Tensión moral", "Antagonista inteligente"],
    dealBreakers: ["Pistas imposibles de seguir", "Violencia gratuita", "Resolución artificial"]
  },
  historical_thriller: {
    mustHave: ["Tensión + Ambientación", "Hechos históricos integrados", "Stakes personales y políticos"],
    dealBreakers: ["Historia supera al thriller", "Thriller ignora la historia", "Exposición excesiva"]
  }
};
