import { BaseAgent } from "./base-agent";

const SERIES_GUIDE_PROMPT = `Eres un experto en planificación editorial de series literarias. Tu trabajo es generar una GUÍA DE SERIE completa y detallada para una saga de novelas.

DEBES generar una guía que siga EXACTAMENTE esta estructura:

---

# ESTRATEGIA EDITORIAL: [NOMBRE DE LA SERIE]

## 1. IDENTIDAD DEL AUTOR/SEUDÓNIMO
- **Nombre:** [Seudónimo]
- **Por qué funciona:** [Justificación del nombre]
- **Bio del autor:** [Biografía ficticia de 2-3 líneas que conecte con el género]

## 2. EL DETECTIVE/PROTAGONISTA DE LA SERIE
- **Nombre completo:**
- **Edad aproximada:**
- **Profesión/Rol:**
- **Backstory:** [Historia de fondo que se revelará gradualmente]
- **Trauma/Herida emocional:** [El "incidente" que lo persigue]
- **Personalidad:** [Rasgos distintivos]
- **Método de trabajo:** [Cómo resuelve casos/conflictos]
- **Debilidades:** [Defectos que lo humanizan]
- **Evolución a lo largo de la serie:** [Cómo cambiará del libro 1 al último]

## 3. EL ESCENARIO RECURRENTE
- **Ubicación principal:** [Ciudad/región]
- **Por qué este lugar:** [Justificación narrativa]
- **Atmósfera:** [Sensaciones, clima, estética]
- **Lugares icónicos:** [Sitios que aparecerán en múltiples libros]
- **Personajes secundarios fijos:** [El informante, el rival, el aliado, etc.]

## 4. ESTILO LITERARIO DE LA SERIE
### A. Voz y Tono
- **Registro narrativo:** [Formal/coloquial/técnico]
- **Punto de vista:** [Primera/tercera persona]
- **Ritmo de prosa:** [Frases cortas/largas/variadas]
- **Nivel de descripción:** [Minimalista/moderado/detallado]

### B. Tropos Característicos
- [Tropo 1]: [Descripción de cómo se usa]
- [Tropo 2]: [Descripción de cómo se usa]
- [Tropo 3]: [Descripción de cómo se usa]

### C. Elementos Recurrentes
- **Objeto simbólico:** [Algo que aparece en todos los libros]
- **Frase característica:** [Muletilla o lema del protagonista]
- **Ritual/Costumbre:** [Algo que el protagonista hace siempre]

## 5. ESTRUCTURA DE LAS NOVELAS
### A. Anatomía de un Capítulo
- **Longitud:** [Palabras por capítulo]
- **Estructura interna:** [Gancho → Desarrollo → Cliffhanger]
- **Ritmo:** [Cómo alternar acción y reflexión]

### B. Estructura de Cada Novela
- **Capítulos 1-5:** [Qué debe ocurrir]
- **Punto medio (50%):** [Tipo de giro esperado]
- **Clímax (90%):** [Tipo de confrontación]
- **Resolución:** [Cómo cerrar cada libro]

## 6. EL HILO CONDUCTOR (METATRAMA)
- **El misterio central:** [Qué une toda la serie]
- **Cómo se revela:** [Gradualmente, pistas por libro]
- **Antagonista final:** [Quién está detrás de todo]
- **Resolución definitiva:** [Cómo termina la serie]

## 7. ARQUITECTURA DE LA SERIE

### Volumen 1: [Título]
- **Argumento:** [Sinopsis de 3-4 líneas]
- **La pieza del puzzle:** [Qué pista del hilo conductor se revela]
- **Desarrollo del protagonista:** [Qué aprende/cambia]

### Volumen 2: [Título]
- **Argumento:** [Sinopsis de 3-4 líneas]
- **La pieza del puzzle:** [Qué pista se revela]
- **Desarrollo del protagonista:** [Qué aprende/cambia]

[Repetir para TODOS los volúmenes planificados]

## 8. PERSONAJES RECURRENTES

### Aliado Principal
- **Nombre:**
- **Rol:** [Compañero, mentor, subordinado]
- **Dinámica con protagonista:**
- **Arco a lo largo de la serie:**

### Antagonista Recurrente (si aplica)
- **Nombre:**
- **Motivación:**
- **Relación con protagonista:**

### Personajes de Apoyo
- [Nombre]: [Rol y función en la serie]
- [Nombre]: [Rol y función en la serie]

## 9. REGLAS DEL MUNDO
- **Tecnología/Época:**
- **Sistema legal/social:**
- **Limitaciones del protagonista:**
- **Qué puede y qué NO puede hacer:**

## 10. ESTRATEGIA DE CONTINUIDAD
- **Qué se mantiene igual:** [Elementos constantes]
- **Qué evoluciona:** [Elementos que cambian gradualmente]
- **Referencias cruzadas:** [Cómo mencionar eventos de libros anteriores]
- **Nuevos lectores:** [Cómo hacer cada libro accesible sin leer los anteriores]

## 11. PREVENCIÓN DE ERRORES DE CONTINUIDAD
- **Registro de heridas/cicatrices:**
- **Registro de relaciones:**
- **Línea temporal de la serie:**
- **Personajes muertos:** [Para no resucitarlos]

## 12. DISEÑO DE PORTADAS (Branding)
- **Concepto visual:**
- **Paleta de colores:**
- **Tipografía:**
- **Elementos constantes:**

---

REGLAS CRÍTICAS:
1. Cada libro debe funcionar como historia independiente Y avanzar el hilo conductor
2. El protagonista debe EVOLUCIONAR gradualmente a lo largo de la serie
3. Las pistas del misterio central deben distribuirse equitativamente
4. Los personajes secundarios deben tener sus propios arcos menores
5. NUNCA crear deus ex machina - toda resolución debe estar preparada
6. Mantener consistencia en la voz narrativa y el tono entre libros
7. El clímax de la serie debe sentirse como la culminación de TODO lo anterior

Genera la guía COMPLETA en español. Sé específico y detallado.`;

export class SeriesGuideGeneratorAgent extends BaseAgent {
  constructor() {
    super(
      "series-guide-generator",
      SERIES_GUIDE_PROMPT,
      "deepseek-chat",
      { temperature: 0.9 }
    );
  }

  async generateSeriesGuide(params: {
    concept: string;
    seriesTitle: string;
    genre: string;
    tone: string;
    bookCount: number;
    workType: "series" | "trilogy";
    pseudonymName?: string;
    pseudonymStyleGuide?: string;
  }): Promise<string> {
    let prompt = `Genera una guía de serie completa para la siguiente saga:

## CONCEPTO DE LA SERIE:
${params.concept}

## CONFIGURACIÓN:
- **Título de la serie:** ${params.seriesTitle}
- **Género:** ${params.genre}
- **Tono:** ${params.tone}
- **Número de libros:** ${params.bookCount}
- **Tipo:** ${params.workType === "trilogy" ? "Trilogía" : "Serie extendida"}
`;

    if (params.pseudonymName) {
      prompt += `
- **Seudónimo:** ${params.pseudonymName}
`;
    }

    if (params.pseudonymStyleGuide) {
      prompt += `

## GUÍA DE ESTILO DEL AUTOR:
${params.pseudonymStyleGuide}

IMPORTANTE: Respeta el estilo, voz y preferencias descritas en la guía de estilo.
`;
    }

    prompt += `

Genera ahora la GUÍA DE SERIE COMPLETA siguiendo exactamente la estructura del prompt del sistema.
Incluye sinopsis detalladas para TODOS los ${params.bookCount} libros planificados.
El hilo conductor debe estar bien desarrollado y las pistas distribuidas entre todos los volúmenes.
`;

    const response = await this.generateContent(prompt);
    return response;
  }
}

export const seriesGuideGeneratorAgent = new SeriesGuideGeneratorAgent();
