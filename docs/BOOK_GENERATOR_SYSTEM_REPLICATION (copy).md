# Sistema de Generación de Libros - Instrucciones de Replicación

## Descripción General

LitAgents es un sistema de orquestación de agentes de IA para generar novelas completas de forma autónoma. Utiliza 9 agentes especializados que trabajan en secuencia para producir manuscritos de calidad editorial, desde la planificación inicial hasta la revisión final.

---

## Arquitectura del Sistema

### Diagrama de Flujo

```
┌─────────────────────────────────────────────────────────────────┐
│                         FRONTEND                                │
│  - Formulario de creación de proyecto                          │
│  - Dashboard de progreso en tiempo real                        │
│  - Visualización de capítulos y estados                        │
│  - Exportación de manuscrito                                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                       QueueManager                              │
│  - Cola de proyectos                                           │
│  - Auto-recovery para proyectos congelados                     │
│  - Gestión de concurrencia                                     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Orchestrator                               │
│  - Coordina todos los agentes                                  │
│  - Gestiona el flujo de generación                             │
│  - Maneja refinamiento y revisión                              │
└─────────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
┌───────────────┐   ┌───────────────┐   ┌───────────────┐
│  Architect    │   │  Ghostwriter  │   │    Editor     │
│  (Planner)    │   │   (Writer)    │   │  (Reviewer)   │
└───────────────┘   └───────────────┘   └───────────────┘
        │                     │                     │
        ▼                     ▼                     ▼
┌───────────────┐   ┌───────────────┐   ┌───────────────┐
│  CopyEditor   │   │ FinalReviewer │   │  Continuity   │
│  (Polisher)   │   │  (QA Final)   │   │   Sentinel    │
└───────────────┘   └───────────────┘   └───────────────┘
        │
        ▼
┌───────────────┐   ┌───────────────┐
│ VoiceRhythm   │   │  Semantic     │
│   Auditor     │   │  Detector     │
└───────────────┘   └───────────────┘
```

---

## 1. Agentes del Sistema

### 1.1 ArchitectAgent (Arquitecto)
**Archivo**: `server/agents/architect.ts`

**Función**: Planifica la estructura completa de la novela.

**Genera**:
- World Bible (personajes, lugares, reglas del mundo)
- Escaleta de capítulos (beats, objetivos, conflictos)
- Estructura de 3 actos
- Arcos narrativos y subtramas

**Input**:
```typescript
interface ArchitectInput {
  title: string;
  premise?: string;
  genre: string;
  tone: string;
  chapterCount: number;
  hasPrologue?: boolean;
  hasEpilogue?: boolean;
  hasAuthorNote?: boolean;
  guiaEstilo?: string;
  architectInstructions?: string;
}
```

**Output**: World Bible + Escaleta en JSON

---

### 1.2 GhostwriterAgent (Narrador)
**Archivo**: `server/agents/ghostwriter.ts`

**Función**: Escribe el contenido de cada capítulo.

**Recibe**:
- Beats del capítulo (de la escaleta)
- Contexto de capítulos anteriores
- World Bible
- Guía de estilo
- Instrucciones de reescritura (si aplica)

**Genera**: Prosa narrativa completa (2500-3500 palabras por capítulo)

---

### 1.3 EditorAgent (Editor)
**Archivo**: `server/agents/editor.ts`

**Función**: Evalúa y aprueba/rechaza capítulos.

**Evalúa**:
- Calidad de la prosa
- Cumplimiento de los beats
- Coherencia narrativa
- Extensión adecuada

**Output**:
```typescript
interface EditorResult {
  approved: boolean;
  score: number;           // 1-10
  feedback: string;
  refinement_instructions?: string;
}
```

**Umbral de aprobación**: Score >= 8

---

### 1.4 CopyEditorAgent (Estilista)
**Archivo**: `server/agents/copyeditor.ts`

**Función**: Pule el texto final de cada capítulo.

**Corrige**:
- Errores gramaticales
- Repeticiones léxicas
- Fluidez y ritmo
- Formato de diálogos

---

### 1.5 ContinuitySentinelAgent (Centinela de Continuidad)
**Archivo**: `server/agents/continuity-sentinel.ts`

**Función**: Verifica coherencia entre capítulos.

**Detecta**:
- Personajes muertos actuando
- Heridas ignoradas
- Inconsistencias de ubicación
- Línea temporal rota

---

### 1.6 VoiceRhythmAuditorAgent (Auditor de Voz)
**Archivo**: `server/agents/voice-rhythm-auditor.ts`

**Función**: Analiza consistencia de voz narrativa.

**Evalúa**:
- Tono consistente
- Ritmo de prosa
- Estilo del autor

---

### 1.7 SemanticRepetitionDetectorAgent (Detector Semántico)
**Archivo**: `server/agents/semantic-repetition-detector.ts`

**Función**: Detecta y corrige repeticiones.

**Busca**:
- Clusters de palabras repetidas
- Frases similares
- Foreshadowing no resuelto

---

### 1.8 FinalReviewerAgent (Revisor Final)
**Archivo**: `server/agents/final-reviewer.ts`

**Función**: Evaluación final del manuscrito completo.

**Output**:
```typescript
interface FinalReviewerResult {
  score: number;                    // 1-10
  approved: boolean;
  issues: FinalReviewIssue[];
  chaptersToRewrite: number[];
  plotDecisions?: any[];
  persistentInjuries?: any[];
}
```

**Criterio de aprobación**: Score >= 9 en 2 ciclos consecutivos

---

## 2. Schema de Base de Datos

### Tabla `projects`

```sql
CREATE TABLE projects (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  premise TEXT,
  genre TEXT NOT NULL DEFAULT 'fantasy',
  tone TEXT NOT NULL DEFAULT 'dramatic',
  chapter_count INTEGER NOT NULL DEFAULT 5,
  has_prologue BOOLEAN NOT NULL DEFAULT false,
  has_epilogue BOOLEAN NOT NULL DEFAULT false,
  has_author_note BOOLEAN NOT NULL DEFAULT false,
  pseudonym_id INTEGER REFERENCES pseudonyms(id),
  style_guide_id INTEGER REFERENCES style_guides(id),
  status TEXT NOT NULL DEFAULT 'idle',
  current_chapter INTEGER DEFAULT 0,
  revision_cycle INTEGER DEFAULT 0,
  voice_audit_completed BOOLEAN DEFAULT false,
  semantic_check_completed BOOLEAN DEFAULT false,
  final_review_result JSONB,
  final_score INTEGER,
  total_input_tokens INTEGER DEFAULT 0,
  total_output_tokens INTEGER DEFAULT 0,
  min_word_count INTEGER,
  min_words_per_chapter INTEGER DEFAULT 1500,
  max_words_per_chapter INTEGER DEFAULT 3500,
  architect_instructions TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);
```

### Tabla `chapters`

```sql
CREATE TABLE chapters (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  chapter_number INTEGER NOT NULL,
  title TEXT,
  content TEXT,
  original_content TEXT,
  word_count INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  needs_revision BOOLEAN DEFAULT false,
  revision_reason TEXT,
  continuity_state JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);
```

### Tabla `world_bibles`

```sql
CREATE TABLE world_bibles (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  timeline JSONB DEFAULT '[]',
  characters JSONB DEFAULT '[]',
  world_rules JSONB DEFAULT '[]',
  plot_outline JSONB DEFAULT '{}',
  plot_decisions JSONB DEFAULT '[]',
  persistent_injuries JSONB DEFAULT '[]',
  raw_response TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);
```

---

## 3. Estados del Proyecto

| Estado | Descripción |
|--------|-------------|
| `idle` | Proyecto creado, no iniciado |
| `generating` | Generación en progreso |
| `paused` | Pausado por usuario o error |
| `completed` | Novela completada y aprobada |
| `error` | Error crítico |
| `cancelled` | Cancelado por usuario |

### Estados de Capítulo

| Estado | Descripción |
|--------|-------------|
| `pending` | Pendiente de escribir |
| `writing` | Ghostwriter escribiendo |
| `reviewing` | Editor revisando |
| `revision` | Requiere reescritura |
| `editing` | CopyEditor puliendo |
| `completed` | Capítulo finalizado |

---

## 4. Flujo de Generación

### 4.1 Fase 1: Arquitectura (ArchitectAgent)

```typescript
// 1. Crear proyecto
const project = await storage.createProject({
  title: "Mi Novela",
  premise: "Un detective investiga...",
  genre: "thriller",
  tone: "oscuro",
  chapterCount: 15,
  hasPrologue: true,
  hasEpilogue: true,
});

// 2. Generar World Bible
const architect = new ArchitectAgent();
const response = await architect.execute({
  title: project.title,
  premise: project.premise,
  genre: project.genre,
  tone: project.tone,
  chapterCount: project.chapterCount,
});

// 3. Guardar World Bible
const worldBible = await storage.createWorldBible({
  projectId: project.id,
  characters: response.result.world_bible.personajes,
  timeline: response.result.world_bible.linea_temporal,
  worldRules: response.result.world_bible.reglas_lore,
  plotOutline: response.result.escaleta_capitulos,
});

// 4. Crear capítulos vacíos
for (const section of response.result.escaleta_capitulos) {
  await storage.createChapter({
    projectId: project.id,
    chapterNumber: section.numero,
    title: section.titulo,
    status: "pending",
  });
}
```

### 4.2 Fase 2: Escritura (Ghostwriter + Editor Loop)

```typescript
for (const chapter of chapters) {
  let approved = false;
  let attempts = 0;
  
  while (!approved && attempts < 3) {
    // Escribir capítulo
    const ghostwriter = new GhostwriterAgent();
    const content = await ghostwriter.execute({
      sectionData: escaleta[chapter.chapterNumber],
      worldBible,
      previousContext,
      styleGuide,
      refinementInstructions: attempts > 0 ? feedback : undefined,
    });
    
    // Evaluar capítulo
    const editor = new EditorAgent();
    const review = await editor.execute({
      chapterContent: content.result.chapter_text,
      sectionData: escaleta[chapter.chapterNumber],
      worldBible,
    });
    
    if (review.result.approved && review.result.score >= 8) {
      approved = true;
      await storage.updateChapter(chapter.id, {
        content: content.result.chapter_text,
        status: "completed",
        wordCount: countWords(content.result.chapter_text),
      });
    } else {
      feedback = review.result.refinement_instructions;
      attempts++;
    }
  }
  
  // Pulir con CopyEditor
  const copyeditor = new CopyEditorAgent();
  const polished = await copyeditor.execute({
    chapterContent: chapter.content,
    styleGuide,
  });
  
  await storage.updateChapter(chapter.id, {
    content: polished.result.polished_text,
  });
}
```

### 4.3 Fase 3: Auditorías Globales

```typescript
// Auditoría de voz
const voiceAuditor = new VoiceRhythmAuditorAgent();
const voiceResult = await voiceAuditor.execute({
  chapters: allChapters,
  styleGuide,
});

// Detector de repeticiones
const semanticDetector = new SemanticRepetitionDetectorAgent();
const semanticResult = await semanticDetector.execute({
  chapters: allChapters,
});

// Corregir problemas detectados
if (semanticResult.result.clusters.length > 0) {
  for (const cluster of semanticResult.result.clusters) {
    // Reescribir capítulos afectados con microcirugía
    await rewriteChapterWithFix(cluster.chapter, cluster.issue);
  }
}
```

### 4.4 Fase 4: Revisión Final (Loop)

```typescript
let approved = false;
let consecutiveHighScores = 0;
const REQUIRED_HIGH_SCORES = 2;

while (!approved && revisionCycle < 15) {
  const finalReviewer = new FinalReviewerAgent();
  const review = await finalReviewer.execute({
    fullManuscript: getAllChaptersContent(),
    worldBible,
  });
  
  if (review.result.score >= 9) {
    consecutiveHighScores++;
    if (consecutiveHighScores >= REQUIRED_HIGH_SCORES) {
      approved = true;
      await storage.updateProject(project.id, {
        status: "completed",
        finalScore: review.result.score,
      });
    }
  } else {
    consecutiveHighScores = 0;
    
    // Corregir issues detectados
    for (const issue of review.result.issues) {
      await applyCorrection(issue);
    }
    
    revisionCycle++;
  }
}
```

---

## 5. Sistema de Callbacks (Tiempo Real)

### Interface

```typescript
interface OrchestratorCallbacks {
  onAgentStatus: (role: string, status: string, message?: string) => void;
  onChapterComplete: (chapterNumber: number, wordCount: number, title: string) => void;
  onChapterRewrite: (chapterNumber: number, title: string, index: number, total: number, reason: string) => void;
  onChapterStatusChange: (chapterNumber: number, status: string) => void;
  onProjectComplete: () => void;
  onError: (error: string) => void;
}
```

### Uso con SSE

```typescript
// Endpoint SSE
app.get("/api/projects/:id/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  
  const callbacks: OrchestratorCallbacks = {
    onAgentStatus: (role, status, message) => {
      res.write(`data: ${JSON.stringify({ type: "agent", role, status, message })}\n\n`);
    },
    onChapterComplete: (num, words, title) => {
      res.write(`data: ${JSON.stringify({ type: "chapter", num, words, title })}\n\n`);
    },
    // ... otros callbacks
  };
  
  const orchestrator = new Orchestrator(callbacks);
  orchestrator.generateNovel(project);
});
```

---

## 6. Sistema de Auto-Recovery

### QueueManager
**Archivo**: `server/queue-manager.ts`

Monitorea proyectos "congelados" (sin actividad por X minutos) y los reinicia automáticamente.

```typescript
const FROZEN_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutos

async function checkFrozenProjects(): Promise<void> {
  const projects = await storage.getActiveProjects();
  
  for (const project of projects) {
    const lastActivity = await getLastActivityTime(project.id);
    const timeSince = Date.now() - lastActivity;
    
    if (timeSince > FROZEN_THRESHOLD_MS) {
      console.log(`[QueueManager] Resuming frozen project ${project.id}`);
      await resumeProject(project);
    }
  }
}

// Ejecutar cada 2 minutos
setInterval(checkFrozenProjects, 2 * 60 * 1000);
```

---

## 7. Configuración de IA

### DeepSeek (Económico)

```typescript
const client = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: "https://api.deepseek.com/v1"
});

// V3 para generación rápida
const response = await client.chat.completions.create({
  model: "deepseek-chat",
  temperature: 1.0,
  messages: [...]
});

// R1 para razonamiento profundo (solo FinalReviewer)
const response = await client.chat.completions.create({
  model: "deepseek-reasoner",
  messages: [...]
});
```

### Gemini (Alternativa rápida)

```typescript
import { GoogleGenAI } from "@google/genai";

const genAI = new GoogleGenAI({
  apiKey: process.env.AI_INTEGRATIONS_GEMINI_API_KEY,
});

const model = genAI.getGenerativeModel({ 
  model: "gemini-3-pro-preview"
});

const result = await model.generateContent({
  contents: [{ role: "user", parts: [{ text: prompt }] }],
  generationConfig: {
    temperature: 1.0,
  }
});
```

---

## 8. API Endpoints

### Proyectos

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/api/projects` | Listar proyectos |
| POST | `/api/projects` | Crear proyecto |
| GET | `/api/projects/:id` | Obtener proyecto |
| PATCH | `/api/projects/:id` | Actualizar proyecto |
| DELETE | `/api/projects/:id` | Eliminar proyecto |
| POST | `/api/projects/:id/generate` | Iniciar generación |
| POST | `/api/projects/:id/pause` | Pausar generación |
| POST | `/api/projects/:id/resume` | Reanudar generación |
| POST | `/api/projects/:id/cancel` | Cancelar generación |
| GET | `/api/projects/:id/stream` | SSE de progreso |
| GET | `/api/projects/:id/export` | Exportar manuscrito |

### Capítulos

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/api/projects/:id/chapters` | Listar capítulos |
| GET | `/api/chapters/:id` | Obtener capítulo |
| PATCH | `/api/chapters/:id` | Actualizar capítulo |

---

## 9. Variables de Entorno

```bash
# Base de datos
DATABASE_URL=postgresql://...

# DeepSeek (principal)
DEEPSEEK_API_KEY=sk-...

# Gemini (alternativa)
AI_INTEGRATIONS_GEMINI_API_KEY=...
AI_INTEGRATIONS_GEMINI_BASE_URL=...
```

---

## 10. Numeración Especial de Capítulos

| Número | Tipo |
|--------|------|
| `0` | Prólogo |
| `1-N` | Capítulos regulares |
| `-1` o `998` | Epílogo |
| `-2` o `999` | Nota del Autor |

```typescript
function getSortOrder(chapterNumber: number): number {
  if (chapterNumber === 0) return -1000;      // Prólogo primero
  if (chapterNumber === -1) return 1000;      // Epílogo al final
  if (chapterNumber === -2) return 1001;      // Nota después del epílogo
  return chapterNumber;                        // Capítulos normales
}
```

---

## 11. World Bible - Estructura

```typescript
interface WorldBible {
  characters: Character[];
  timeline: TimelineEvent[];
  worldRules: WorldRule[];
  plotOutline: {
    escaleta_capitulos: ChapterOutline[];
    estructura_tres_actos: ThreeActStructure;
    arcos_narrativos: NarrativeArc[];
  };
  plotDecisions: PlotDecision[];
  persistentInjuries: Injury[];
}

interface Character {
  nombre: string;
  rol: string;
  descripcion: string;
  arco_narrativo: string;
  relaciones: string[];
}

interface ChapterOutline {
  numero: number;
  titulo: string;
  ubicacion: string;
  elenco_presente: string[];
  objetivo_narrativo: string;
  beats: string[];
  conflicto_central: {
    tipo: string;
    descripcion: string;
    stakes: string;
  };
}
```

---

## 12. Checklist de Replicación

### Base
- [ ] Configurar base de datos PostgreSQL
- [ ] Crear tablas: `projects`, `chapters`, `world_bibles`
- [ ] Implementar storage methods (CRUD)
- [ ] Configurar cliente de IA (DeepSeek/Gemini)

### Agentes
- [ ] Implementar `BaseAgent` con manejo de tokens
- [ ] Implementar `ArchitectAgent` con prompts de planificación
- [ ] Implementar `GhostwriterAgent` con prompts de escritura
- [ ] Implementar `EditorAgent` con criterios de evaluación
- [ ] Implementar `CopyEditorAgent` para pulido
- [ ] Implementar `FinalReviewerAgent` para QA global

### Orquestador
- [ ] Implementar `Orchestrator` con flujo completo
- [ ] Implementar sistema de callbacks
- [ ] Implementar loop de refinamiento (Ghostwriter-Editor)
- [ ] Implementar loop de revisión final

### Infraestructura
- [ ] Implementar QueueManager para auto-recovery
- [ ] Crear endpoints API
- [ ] Implementar SSE para tiempo real
- [ ] Crear frontend con dashboard de progreso

### Opcional
- [ ] Implementar `ContinuitySentinelAgent`
- [ ] Implementar `VoiceRhythmAuditorAgent`
- [ ] Implementar `SemanticRepetitionDetectorAgent`
- [ ] Soporte para series de libros
- [ ] Exportación multi-formato (MD, DOCX, EPUB)

---

## Notas Importantes

1. **Orden de ejecución**: Architect -> Ghostwriter/Editor loop -> CopyEditor -> Auditorías -> FinalReviewer loop

2. **Tokens**: Registrar uso de tokens para control de costos.

3. **Contexto deslizante**: Proporcionar contexto de capítulos anteriores al Ghostwriter para coherencia.

4. **Criterio 9+**: El manuscrito solo se aprueba con score >= 9 en 2 ciclos consecutivos.

5. **Microcirugía**: Para correcciones menores, usar reescritura parcial preservando 95% del texto.

6. **World Bible persistente**: Actualizar plotDecisions y persistentInjuries después de cada revisión.
