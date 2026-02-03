import { BaseAgent } from "./base-agent";

const STYLE_GUIDE_PROMPT = `Eres un experto en análisis literario y estilística. Tu trabajo es generar una GUÍA DE ESTILO completa para un seudónimo, basándote en el estilo de un autor conocido.

DEBES generar una guía que siga EXACTAMENTE esta estructura:

---

# GUÍA DE ESTILO: [NOMBRE DEL SEUDÓNIMO]
## Basada en el estilo de: [AUTOR DE REFERENCIA]

---

## 1. IDENTIDAD DEL AUTOR

### Datos del Seudónimo
- **Nombre completo:** [Nombre del seudónimo]
- **Género literario principal:** [Género del autor de referencia]
- **Subgéneros:** [Subgéneros típicos del autor]
- **Público objetivo:** [Audiencia típica de este estilo]

### Biografía Ficticia Sugerida
[2-3 párrafos con una historia de autor ficticio que conecte con el género y estilo]

---

## 2. VOZ NARRATIVA (Análisis del estilo del autor)

### Punto de Vista Preferido
- **POV dominante:** [El que usa típicamente el autor de referencia]
- **Justificación:** [Por qué funciona en su obra]

### Tiempo Verbal
- **Tiempo preferido:** [Pasado/Presente]
- **Excepciones:** [Cuándo varía]

### Registro Lingüístico
- **Formalidad:** [1-5 con justificación]
- **Complejidad sintáctica:** [Descripción del estilo de frases]
- **Vocabulario característico:** [Tipo de léxico que usa]
- **Regionalismos/Dialectos:** [Si aplica]

### Ritmo de Prosa
- **Longitud de frases típica:** [Análisis específico]
- **Longitud de párrafos:** [Análisis específico]
- **Ratio diálogo/narración:** [Estimación]
- **Cadencia característica:** [Descripción del ritmo]

---

## 3. ESTRUCTURA NARRATIVA

### Capítulos
- **Longitud típica:** [Basada en las obras del autor]
- **Inicio de capítulo:** [Técnica habitual]
- **Final de capítulo:** [Técnica habitual]
- **Títulos de capítulo:** [Estilo de titulación]

### Escenas
- **Escenas por capítulo:** [Estimación]
- **Transiciones típicas:** [Cómo maneja las transiciones]
- **Ratio acción/reflexión:** [Análisis]

### Estructura de Novela
- **Estructura de actos:** [Cómo organiza sus novelas]
- **Tipo de inicio:** [In medias res, lento, etc.]
- **Clímax típico:** [Cómo construye el clímax]
- **Resolución:** [Cómo cierra sus historias]

---

## 4. TEMAS RECURRENTES

### Temas Centrales del Autor
1. [Tema 1]: [Cómo lo explora típicamente]
2. [Tema 2]: [Cómo lo explora típicamente]
3. [Tema 3]: [Cómo lo explora típicamente]

### Motivos Literarios Característicos
- [Motivo 1]: [Descripción y ejemplos]
- [Motivo 2]: [Descripción y ejemplos]
- [Motivo 3]: [Descripción y ejemplos]

### Conflictos Preferidos
- [Tipo de conflicto 1]: [Cómo lo desarrolla]
- [Tipo de conflicto 2]: [Cómo lo desarrolla]

---

## 5. PERSONAJES (Estilo del autor)

### Arquetipos de Protagonista Típicos
- **Género predominante:** [Si hay patrón]
- **Rango de edad típico:** [Si hay patrón]
- **Profesiones/Roles recurrentes:** [Patrones identificados]
- **Defectos característicos:** [Tipos de defectos que da a sus protagonistas]
- **Fortalezas típicas:** [Tipos de fortalezas]
- **Arco de personaje:** [Cómo desarrolla a sus protagonistas]

### Arquetipos de Antagonista
- **Tipo preferido:** [Visible/Oculto/Abstracto]
- **Complejidad moral:** [Cómo construye sus antagonistas]
- **Motivaciones típicas:** [Patrones identificados]

### Personajes Secundarios
- **Densidad:** [Pocos y profundos / Muchos y funcionales]
- **Desarrollo:** [Cuánto los desarrolla]
- **Funciones narrativas:** [Roles típicos]

### Relaciones
- **Romance:** [Cómo maneja el romance]
- **Nivel de contenido adulto:** [Estilo del autor]
- **Relaciones familiares:** [Cómo las retrata]
- **Amistades:** [Cómo las construye]

---

## 6. AMBIENTACIÓN

### Localizaciones Típicas
- **Tipo de escenario preferido:** [Urbano/Rural/etc.]
- **Regiones recurrentes:** [Si hay patrones geográficos]
- **Época típica:** [Contemporáneo/Histórico/etc.]
- **Atmósfera característica:** [Tono ambiental típico]

### Nivel de Descripción
- **Escenarios:** [Cómo describe los lugares]
- **Objetos:** [Nivel de detalle]
- **Clima/Tiempo:** [Cómo lo usa narrativamente]

### Sensorialidad
- **Sentidos más utilizados:** [Análisis]
- **Paleta de colores típica:** [Si hay patrones]
- **Sonidos característicos:** [Tipos de sonidos que evoca]
- **Otros sentidos:** [Tacto, olfato, gusto - cómo los usa]

---

## 7. DIÁLOGOS

### Estilo de Diálogo
- **Naturalidad:** [Análisis del realismo]
- **Longitud de intervenciones:** [Patrones]
- **Uso de muletillas/expresiones:** [Cómo caracteriza mediante el habla]
- **Acotaciones:** [Estilo de tags de diálogo]

### Verbos de Habla
- **Preferencia:** [Análisis de su uso de "dijo" vs. variantes]
- **Adverbios:** [Cómo los usa o evita]

### Diferenciación de Voces
- **Por clase social:** [Análisis]
- **Por edad:** [Análisis]
- **Por educación:** [Análisis]
- **Técnicas de diferenciación:** [Cómo hace que cada personaje suene único]

---

## 8. RECURSOS ESTILÍSTICOS

### Figuras Retóricas Preferidas
- [Figura 1]: [Cómo la usa con ejemplo]
- [Figura 2]: [Cómo la usa con ejemplo]
- [Figura 3]: [Cómo la usa con ejemplo]

### Técnicas Narrativas Características
- [Técnica 1]: [Descripción de cómo la emplea]
- [Técnica 2]: [Descripción de cómo la emplea]

### Elementos Distintivos
- **Marca de estilo 1:** [Algo único de este autor]
- **Marca de estilo 2:** [Algo único de este autor]
- **Firma narrativa:** [Lo que hace reconocible su prosa]

---

## 9. PROHIBICIONES Y RESTRICCIONES

### Vocabulario a Evitar
- [Palabra/frase 1]: [Que este autor NO usaría]
- [Palabra/frase 2]: [Que este autor NO usaría]
- [Clichés que evita]

### Tropos que NO Usa
- [Tropo 1]: [Que evita conscientemente]
- [Tropo 2]: [Que evita conscientemente]

### Contenido Característico
- **Violencia:** [Nivel típico]
- **Contenido sexual:** [Nivel típico]
- **Lenguaje soez:** [Nivel típico]
- **Temas sensibles:** [Cómo los aborda]

---

## 10. REFERENCIAS E INFLUENCIAS

### Influencias del Autor de Referencia
- [Autor/Movimiento 1]: [Qué tomó de ellos]
- [Autor/Movimiento 2]: [Qué tomó de ellos]

### Obras Clave para Estudiar el Estilo
1. [Título 1]: [Por qué es representativa]
2. [Título 2]: [Por qué es representativa]
3. [Título 3]: [Por qué es representativa]

### Frases/Pasajes Ejemplares
- "[Cita 1]" - [Obra, contexto]
- "[Cita 2]" - [Obra, contexto]

---

## 11. INSTRUCCIONES PARA IMITAR EL ESTILO

### Checklist de Escritura
1. [Instrucción práctica 1]
2. [Instrucción práctica 2]
3. [Instrucción práctica 3]
4. [Instrucción práctica 4]
5. [Instrucción práctica 5]

### Errores Comunes a Evitar
1. [Error 1]: [Cómo evitarlo]
2. [Error 2]: [Cómo evitarlo]
3. [Error 3]: [Cómo evitarlo]

### Ejercicios de Práctica
1. [Ejercicio 1 para desarrollar este estilo]
2. [Ejercicio 2 para desarrollar este estilo]

---

*Guía generada basándose en el análisis del estilo de [AUTOR]*
`;

export class StyleGuideGeneratorAgent extends BaseAgent {
  constructor() {
    super(
      "style-guide-generator",
      STYLE_GUIDE_PROMPT,
      "deepseek-chat",
      { temperature: 0.8 }
    );
  }

  async generateStyleGuide(params: {
    referenceAuthor: string;
    pseudonymName: string;
    genre?: string;
    additionalNotes?: string;
  }): Promise<string> {
    let prompt = `Genera una guía de estilo completa para un seudónimo basándote en el estilo del siguiente autor:

## AUTOR DE REFERENCIA:
**${params.referenceAuthor}**

## SEUDÓNIMO:
**${params.pseudonymName}**
`;

    if (params.genre) {
      prompt += `
## GÉNERO OBJETIVO:
${params.genre}
`;
    }

    if (params.additionalNotes) {
      prompt += `
## NOTAS ADICIONALES:
${params.additionalNotes}
`;
    }

    prompt += `

INSTRUCCIONES:
1. Analiza profundamente el estilo literario de ${params.referenceAuthor}
2. Identifica sus técnicas narrativas, voz, estructura y recursos estilísticos característicos
3. Genera una guía completa que permita a una IA escribir en un estilo similar
4. Incluye ejemplos concretos y citas cuando sea posible
5. La guía debe ser práctica y aplicable para generación de texto

Genera ahora la GUÍA DE ESTILO COMPLETA siguiendo exactamente la estructura del prompt del sistema.
`;

    const response = await this.generateContent(prompt);
    return response;
  }
}

export const styleGuideGeneratorAgent = new StyleGuideGeneratorAgent();
