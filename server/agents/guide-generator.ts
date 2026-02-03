import { BaseAgent } from "./base-agent";

const GUIDE_GENERATOR_PROMPT = `Eres un experto en planificación de novelas. Tu trabajo es generar una GUÍA DE ESCRITURA completa y detallada para una novela basándote en:
1. Un argumento/sinopsis proporcionado
2. El género y tono preferidos
3. La guía de estilo del autor (si se proporciona)
4. El contexto de la serie (si aplica)

DEBES generar una guía que siga EXACTAMENTE esta estructura:

---

# GUÍA DE ESCRITURA: [TÍTULO DE LA NOVELA]

## 1. PREMISA
[Una frase potente que resuma el conflicto central y el gancho emocional]

## 2. GÉNERO Y TONO
- **Género principal:** [thriller / romance / fantasía / etc.]
- **Subgénero:** [si aplica]
- **Tono narrativo:** [oscuro / esperanzador / tenso / etc.]
- **Clasificación:** [adulto / joven adulto]

## 3. TRAMA PRINCIPAL
**Conflicto central:** [Descripción del conflicto que atraviesa toda la novela]

**Objetivo del protagonista:** [Qué debe lograr]
**Obstáculo principal:** [Qué le impide lograrlo]
**Lo que está en juego:** [Qué pierde si falla]

**Desarrollo por actos:**
- **Acto 1 (capítulos 1-X):** [Planteamiento]
- **Punto de giro 1 (~25%):** [Evento que cambia el rumbo]
- **Acto 2 (capítulos X-Y):** [Complicaciones]
- **Punto medio (~50%):** [Revelación o crisis]
- **Punto de giro 2 (~75%):** [Crisis mayor]
- **Acto 3 (capítulos Y-Z):** [Resolución]

## 4. SUBTRAMAS

### Subtrama 1: [Nombre descriptivo]
- **Personajes:** [nombres]
- **Objetivo:** [qué se busca resolver]
- **Capítulos:** [lista específica: 3, 7, 12, 18, 25]
- **Resolución:** [cómo termina]

### Subtrama 2: [Nombre descriptivo]
- **Personajes:** [nombres]
- **Objetivo:** [qué se busca resolver]
- **Capítulos:** [lista específica]
- **Resolución:** [cómo termina]

### Subtrama 3: [Nombre descriptivo]
[Repetir estructura]

## 5. PERSONAJES PRINCIPALES

### Protagonista
- **Nombre completo:** 
- **Edad:** 
- **Apariencia física:**
  - Ojos: [color específico]
  - Cabello: [color, largo, estilo]
  - Altura/complexión:
  - Rasgos distintivos: [cicatrices, marcas]
- **Personalidad:** [3-5 rasgos dominantes]
- **Motivación principal:** [qué quiere por encima de todo]
- **Miedo profundo:** [qué teme]
- **Defecto fatal:** [debilidad que causa problemas]
- **Voz/forma de hablar:** [registro, muletillas]
- **Arco de transformación:**
  - Inicio: [cómo es al principio]
  - Cambio: [qué evento lo transforma]
  - Final: [en qué se convierte]

### Antagonista
- **Nombre completo:**
- **Relación con protagonista:**
- **Motivación:** [por qué hace lo que hace]
- **Método:** [cómo opera]
- **Debilidad:** [qué puede derrotarlo]

### Personajes secundarios
[Repetir estructura simplificada para cada uno relevante]

## 6. UBICACIONES

### Ubicación principal: [nombre]
- **Época/período:**
- **Atmósfera:** [sensaciones que evoca]
- **Clima típico:**
- **Olores característicos:**
- **Sonidos ambiente:**

### Ubicaciones secundarias:
1. **[Nombre]:** [descripción breve]
2. **[Nombre]:** [descripción breve]

## 7. LÍNEA TEMPORAL
- **Época:** [año/período]
- **Duración de la historia:** [días/semanas/meses]
- **Eventos clave con fechas:**
  1. [Fecha]: [evento]
  2. [Fecha]: [evento]

- **Flashbacks planificados:**
  - Capítulo X: [a qué momento]

## 8. ESTRUCTURA DE CAPÍTULOS
- **Total de capítulos:** [número]
- **Prólogo:** [sí/no - breve descripción si sí]
- **Epílogo:** [sí/no - breve descripción si sí]
- **Palabras por capítulo:** [mínimo-máximo]

### Resumen por capítulo:
- **Capítulo 1 - "[Título]":** [resumen de 2-3 líneas + evento clave]
- **Capítulo 2 - "[Título]":** [resumen + evento clave]
[Continuar para TODOS los capítulos]

## 9. REGLAS DEL MUNDO
- **Tecnología disponible:** [qué existe y qué no]
- **Sistema de magia/poderes:** [si aplica, reglas y limitaciones]
- **Estructura social:** [clases, gobiernos]
- **Restricciones históricas:** [si es histórico]

## 10. RELACIONES ENTRE PERSONAJES
- [Personaje A] ↔ [Personaje B]: [tipo de relación, evolución]
- [Personaje A] ↔ [Personaje C]: [tipo de relación, evolución]

**Conflictos interpersonales:**
- [Personaje] vs [Personaje]: [motivo]

## 11. TEMAS Y SÍMBOLOS
- **Tema central:** [idea abstracta que explora]
- **Temas secundarios:** [lista]

**Símbolos recurrentes:**
- [Objeto/elemento]: representa [significado]

**Motivos literarios:**
- [Motivo]: aparece en capítulos [X, Y, Z]

## 12. VOZ NARRATIVA Y ESTILO
- **Punto de vista:** [primera persona / tercera limitada / omnisciente]
- **Tiempo verbal:** [pasado / presente]
- **Personaje(s) POV:** [quién narra]

**Estilo deseado:**
- Ritmo de frases: [cortas / largas / variado]
- Nivel de descripción: [minimalista / moderado / detallado]
- Diálogos: [abundantes / equilibrados / escasos]
- Tono emocional: [contenido / expresivo / intenso]

**Palabras/frases a EVITAR:**
- [lista de palabras prohibidas]

## 13. OBJETOS IMPORTANTES (Chekhov's Gun)
1. **[Objeto]:** se introduce en capítulo [X], se usa en capítulo [Y]
2. **[Objeto]:** se introduce en capítulo [X], se usa en capítulo [Y]

## 14. GIROS Y REVELACIONES
1. **Giro 1 (Capítulo X):** [qué se revela]
   - Pistas previas en capítulos: [lista]
2. **Giro 2 (Capítulo Y):** [qué se revela]
   - Pistas previas en capítulos: [lista]

## 15. CLIFFHANGERS PLANIFICADOS
- Final del capítulo X: [gancho]
- Final del capítulo Y: [gancho]

---

REGLAS CRÍTICAS:
1. Las subtramas DEBEN aparecer en mínimo 3 capítulos cada una (idealmente 5+)
2. El protagonista DEBE aparecer en al menos 30% de los capítulos
3. Los puntos de giro DEBEN estar en los porcentajes correctos (25%, 50%, 75%)
4. TODOS los objetos importantes deben establecerse ANTES de usarse
5. NO dejar tramas sin resolver al final
6. Los capítulos deben tener resúmenes ESPECÍFICOS, no genéricos
7. Si es parte de una serie, mantener coherencia con libros anteriores

PREVENCIÓN DE DEUS EX MACHINA - OBLIGATORIO:
8. TODA resolución de conflicto debe estar PREPARADA con antelación:
   - Si un personaje tiene una habilidad que salva el día, debe mencionarse en capítulos anteriores
   - Si un objeto es crucial para la solución, debe aparecer antes (Chekhov's Gun)
   - Si un aliado aparece para ayudar, debe haberse establecido previamente
   - Las coincidencias NO pueden resolver conflictos principales
9. Para cada GIRO o RESOLUCIÓN importante:
   - Especifica en qué capítulos se siembran las PISTAS (mínimo 2-3 pistas)
   - La primera pista debe aparecer al menos 5 capítulos antes del giro
10. Las SOLUCIONES deben surgir de:
   - Habilidades ya demostradas del protagonista
   - Información ya revelada al lector
   - Objetos/recursos ya establecidos en la historia
   - Aliados ya presentados con motivación clara
11. PROHIBIDO:
   - Personajes nuevos que salvan la situación en el último momento
   - Habilidades ocultas nunca mencionadas que resuelven todo
   - Coincidencias convenientes que solucionan conflictos
   - Revelaciones de última hora sin pistas previas

Genera la guía COMPLETA en español. Sé específico y detallado. No uses placeholders genéricos.`;

export class GuideGeneratorAgent extends BaseAgent {
  constructor() {
    super(
      "guide-generator",
      GUIDE_GENERATOR_PROMPT,
      "deepseek-chat",
      { temperature: 0.9 }
    );
  }

  async generateWritingGuide(params: {
    argument: string;
    title: string;
    genre: string;
    tone: string;
    chapterCount: number;
    hasPrologue: boolean;
    hasEpilogue: boolean;
    styleGuideContent?: string;
    seriesContext?: string;
    kindleUnlimited?: boolean;
  }): Promise<string> {
    let prompt = `Genera una guía de escritura completa para la siguiente novela:

## ARGUMENTO/SINOPSIS:
${params.argument}

## CONFIGURACIÓN:
- **Título propuesto:** ${params.title}
- **Género:** ${params.genre}
- **Tono:** ${params.tone}
- **Número de capítulos:** ${params.chapterCount}
- **Incluye prólogo:** ${params.hasPrologue ? 'Sí' : 'No'}
- **Incluye epílogo:** ${params.hasEpilogue ? 'Sí' : 'No'}
- **Optimizado para Kindle Unlimited:** ${params.kindleUnlimited ? 'Sí (capítulos cortos, ritmo rápido, cliffhangers frecuentes)' : 'No'}
`;

    if (params.styleGuideContent) {
      prompt += `

## GUÍA DE ESTILO DEL AUTOR:
${params.styleGuideContent}

IMPORTANTE: Respeta el estilo, voz y preferencias descritas en la guía de estilo del autor.
`;
    }

    if (params.seriesContext) {
      prompt += `

## CONTEXTO DE LA SERIE:
${params.seriesContext}

INSTRUCCIONES CRÍTICAS PARA NOVELA DE SERIE:
1. Esta novela es parte de una serie. Mantén coherencia con los elementos establecidos.
2. Si la guía de la serie incluye HITOS para este volumen, DEBES cumplirlos TODOS en tu guía:
   - Los hitos de trama deben aparecer en capítulos específicos
   - Los hitos de personaje deben reflejarse en el desarrollo del protagonista
   - Los hitos de mundo deben establecerse/expandirse según corresponda
   - Los objetos/pistas (Chekhov's Gun) deben introducirse explícitamente
3. Incluye referencias explícitas a eventos de libros anteriores si los hay.
4. Prepara hilos para futuras entregas según los hitos del siguiente volumen.
5. En la sección "Registro de Chekhov's Gun" incluye los objetos/pistas de la serie.
`;
    }

    prompt += `

Genera ahora la GUÍA DE ESCRITURA COMPLETA siguiendo exactamente la estructura del prompt del sistema.
Sé muy específico en los resúmenes de cada capítulo - cada uno debe tener su evento clave único.
Las subtramas deben distribuirse en múltiples capítulos (mínimo 3, idealmente 5+).
`;

    const response = await this.generateContent(prompt);
    return response;
  }
}

export const guideGeneratorAgent = new GuideGeneratorAgent();
