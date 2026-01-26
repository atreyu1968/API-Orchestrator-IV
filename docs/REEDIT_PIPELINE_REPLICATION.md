# Pipeline del Reescritor (Reedit System) - Instrucciones de Replicación

## Descripción General

El sistema Reedit de LitAgents permite importar manuscritos existentes y procesarlos a través de un pipeline de agentes de IA para mejorar su calidad editorial. A diferencia del generador de libros que crea contenido desde cero, el reescritor analiza, edita y pule manuscritos ya escritos.

---

## Arquitectura del Sistema

### Diagrama de Flujo del Pipeline

```
┌─────────────────────────────────────────────────────────────────┐
│                    IMPORTACIÓN DE MANUSCRITO                    │
│  - Upload archivo (TXT, MD, DOCX)                              │
│  - Detección automática de capítulos                           │
│  - Detección de idioma                                         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│               STAGE 1: ANÁLISIS ESTRUCTURAL                     │
│  - Detectar capítulos duplicados                               │
│  - Detectar capítulos fuera de orden                           │
│  - Identificar capítulos faltantes                             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│               STAGE 2: REVISIÓN EDITORIAL                       │
│  - ReeditEditorAgent evalúa cada capítulo                      │
│  - Score 1-10, issues, fortalezas, sugerencias                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│               STAGE 3: EXTRACCIÓN WORLD BIBLE                   │
│  - WorldBibleExtractorAgent analiza manuscrito                 │
│  - Extrae personajes, ubicaciones, timeline, reglas            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│         STAGE 4: EXPANSIÓN (OPCIONAL)                           │
│  - ChapterExpansionAnalyzer detecta capítulos cortos           │
│  - ChapterExpanderAgent expande contenido                      │
│  - NewChapterGeneratorAgent inserta nuevos capítulos           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│               STAGE 5: QA (AUDITORÍAS)                          │
│  - ContinuitySentinel: Coherencia entre capítulos              │
│  - VoiceRhythmAuditor: Consistencia de voz                     │
│  - SemanticRepetitionDetector: Repeticiones                    │
│  - AnachronismDetector: Anacronismos históricos                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│             STAGE 6: REESCRITURA NARRATIVA                      │
│  - Ghostwriter corrige problemas detectados en QA              │
│  - Microcirugía: cambios mínimos preservando 95%               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│             STAGE 7: COPY-EDITING                               │
│  - ReeditCopyEditorAgent pule cada capítulo                    │
│  - Fluidez, gramática, formato de diálogos                     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│             STAGE 8: REVISIÓN FINAL (LOOP)                      │
│  - FinalReviewerAgent evalúa manuscrito completo               │
│  - Sistema de tranches para manuscritos largos                 │
│  - Detección de issues con severidad                           │
│  - PAUSA para aprobación del usuario (checklist)               │
│  - Loop hasta score >= 9 (2 veces consecutivas)                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      COMPLETADO                                 │
│  - Exportación Markdown/DOCX                                   │
│  - Traducción opcional                                         │
└─────────────────────────────────────────────────────────────────┘
```

---

## 1. Agentes del Pipeline

### 1.1 ReeditEditorAgent
**Función**: Evalúa calidad de cada capítulo individual.

```typescript
interface EditorResult {
  score: number;              // 1-10
  issues: string[];           // Problemas detectados
  strengths: string[];        // Fortalezas
  suggestions: string[];      // Sugerencias de mejora
  pacingNotes: string;        // Notas sobre ritmo
}
```

---

### 1.2 ReeditCopyEditorAgent
**Función**: Pule texto con cambios mínimos (microcirugía).

**Regla principal**: Preservar 95% del texto original. Solo corregir:
- Pronombres arcaicos (Egli/Ella en italiano → lui/lei)
- Oraciones > 45 palabras
- Repeticiones consecutivas
- Voz pasiva excesiva

---

### 1.3 WorldBibleExtractorAgent
**Función**: Extrae información del mundo narrativo del manuscrito existente.

```typescript
interface WorldBibleExtract {
  personajes: Character[];
  ubicaciones: Location[];
  timeline: TimelineEvent[];
  reglasDelMundo: WorldRule[];
  epocaHistorica: HistoricalPeriod;
  confianza: number;          // 1-10
}
```

---

### 1.4 ContinuitySentinelAgent
**Función**: Detecta inconsistencias de continuidad.

**Detecta**:
- Personajes muertos que actúan
- Heridas ignoradas
- Cambios de ubicación imposibles
- Contradicciones temporales

---

### 1.5 VoiceRhythmAuditorAgent
**Función**: Analiza consistencia de voz narrativa.

---

### 1.6 SemanticRepetitionDetectorAgent
**Función**: Detecta repeticiones semánticas.

**Busca**:
- Ideas repetidas en diferentes capítulos
- Frases recurrentes
- Foreshadowing sin resolver

---

### 1.7 AnachronismDetectorAgent
**Función**: Detecta anacronismos históricos.

**Detecta** (según época de ambientación):
- Tecnología que no existía
- Expresiones lingüísticas anacrónicas
- Comportamientos sociales incorrectos
- Objetos/materiales incorrectos
- Conceptos que no existían

---

### 1.8 ChapterExpansionAnalyzer
**Función**: Identifica capítulos que necesitan expansión.

```typescript
interface ExpansionPlan {
  chaptersToExpand: Array<{
    chapterNumber: number;
    currentWords: number;
    targetWords: number;
    expansionSuggestions: string[];
  }>;
  newChaptersToInsert: Array<{
    insertAfter: number;
    purpose: string;
    suggestedBeats: string[];
  }>;
}
```

---

### 1.9 FinalReviewerAgent
**Función**: Evaluación final del manuscrito completo.

**Sistema de Tranches**: Para manuscritos largos (> 131k tokens), divide en tranches de 8 capítulos procesados secuencialmente.

```typescript
interface FinalReviewIssue {
  categoria: string;           // continuidad, ritmo, anacronismo, etc.
  severidad: "critica" | "mayor" | "menor";
  descripcion: string;
  capitulos_afectados: number[];
  elementos_a_preservar: string;
  instrucciones_correccion: string;
}
```

---

### 1.10 IssueResolutionValidatorAgent
**Función**: Valida que las correcciones aplicadas resolvieron los issues.

---

## 2. Schema de Base de Datos

### Tabla `reedit_projects`

```sql
CREATE TABLE reedit_projects (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  original_file_name TEXT NOT NULL,
  source_project_id INTEGER REFERENCES projects(id),
  detected_language TEXT,
  total_chapters INTEGER DEFAULT 0,
  processed_chapters INTEGER DEFAULT 0,
  
  -- Estado del pipeline
  current_stage TEXT NOT NULL DEFAULT 'uploaded',
  current_chapter INTEGER DEFAULT 0,
  current_activity TEXT,
  
  -- Resultados
  bestseller_score INTEGER,
  final_review_result JSONB,
  structure_analysis JSONB,
  
  -- Referencias
  style_guide_id INTEGER REFERENCES style_guides(id),
  pseudonym_id INTEGER REFERENCES pseudonyms(id),
  
  -- Tokens
  total_input_tokens INTEGER DEFAULT 0,
  total_output_tokens INTEGER DEFAULT 0,
  total_thinking_tokens INTEGER DEFAULT 0,
  total_word_count INTEGER DEFAULT 0,
  
  -- Estado
  status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  heartbeat_at TIMESTAMP,
  cancel_requested BOOLEAN DEFAULT false,
  
  -- Expansión
  expand_chapters BOOLEAN DEFAULT false,
  insert_new_chapters BOOLEAN DEFAULT false,
  target_min_words_per_chapter INTEGER DEFAULT 2000,
  expansion_plan JSONB,
  
  -- Ciclos de revisión
  revision_cycle INTEGER DEFAULT 0,
  total_review_cycles INTEGER DEFAULT 0,
  consecutive_high_scores INTEGER DEFAULT 0,
  previous_scores JSONB,
  
  -- Sistema de pausa
  non_perfect_final_reviews INTEGER DEFAULT 0,
  pause_reason TEXT,
  pending_user_instructions TEXT,
  architect_instructions TEXT,
  
  -- Tracking de issues
  resolved_issue_hashes JSONB DEFAULT '[]',
  chapter_correction_counts JSONB DEFAULT '{}',
  chapter_change_history JSONB DEFAULT '{}',
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);
```

### Tabla `reedit_chapters`

```sql
CREATE TABLE reedit_chapters (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES reedit_projects(id) ON DELETE CASCADE,
  chapter_number INTEGER NOT NULL,
  original_chapter_number INTEGER,
  title TEXT,
  
  -- Contenido
  original_content TEXT NOT NULL,
  edited_content TEXT,
  
  -- Feedback del editor
  editor_score INTEGER,
  editor_feedback JSONB,
  narrative_issues JSONB,
  
  -- Cambios del copyeditor
  copyeditor_changes TEXT,
  fluency_improvements JSONB,
  
  -- Flags
  is_duplicate BOOLEAN DEFAULT false,
  duplicate_of_chapter INTEGER,
  is_out_of_order BOOLEAN DEFAULT false,
  suggested_order INTEGER,
  
  -- Estado
  word_count INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  processing_stage TEXT DEFAULT 'none',
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);
```

### Tabla `reedit_world_bibles`

```sql
CREATE TABLE reedit_world_bibles (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES reedit_projects(id) ON DELETE CASCADE,
  characters JSONB,
  locations JSONB,
  timeline JSONB,
  lore_rules JSONB,
  historical_period JSONB,
  character_relationships JSONB,
  plot_decisions JSONB DEFAULT '[]',
  persistent_injuries JSONB DEFAULT '[]',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);
```

### Tabla `reedit_issues`

```sql
CREATE TABLE reedit_issues (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES reedit_projects(id) ON DELETE CASCADE,
  chapter_number INTEGER NOT NULL,
  category TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'mayor',
  description TEXT NOT NULL,
  text_citation TEXT,
  correction_instruction TEXT,
  source TEXT NOT NULL DEFAULT 'qa',
  review_cycle INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending, approved, rejected, resolved
  resolved_at TIMESTAMP,
  rejection_reason TEXT,
  issue_hash TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);
```

### Tabla `reedit_audit_reports`

```sql
CREATE TABLE reedit_audit_reports (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES reedit_projects(id) ON DELETE CASCADE,
  audit_type TEXT NOT NULL,       -- continuity, voice_rhythm, semantic_repetition, final_review
  chapter_range TEXT,             -- e.g., "1-5", "all"
  score INTEGER,
  findings JSONB,
  recommendations JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);
```

---

## 3. Estados del Proyecto

### Estados Principales

| Estado | Descripción |
|--------|-------------|
| `pending` | Importado, esperando inicio |
| `processing` | Pipeline en ejecución |
| `paused` | Pausado por usuario o límite |
| `awaiting_instructions` | Esperando instrucciones del usuario |
| `awaiting_issue_approval` | Esperando aprobación de issues (checklist) |
| `completed` | Procesamiento completado |
| `error` | Error crítico |

### Etapas del Pipeline (currentStage)

| Etapa | Descripción |
|-------|-------------|
| `uploaded` | Archivo subido, no procesado |
| `analyzing` | Análisis estructural |
| `editing` | Revisión editorial |
| `world_bible` | Extracción de World Bible |
| `expansion` | Expansión de capítulos |
| `qa` | Auditorías de calidad |
| `narrative_rewriting` | Reescritura de problemas |
| `copyediting` | Pulido final |
| `reviewing` | Revisión final (loop) |
| `completed` | Terminado |

---

## 4. Flujo del Pipeline

### 4.1 Importación de Manuscrito

```typescript
// 1. Upload del archivo
const formData = new FormData();
formData.append("manuscript", file);
formData.append("title", "Mi Novela");

// POST /api/reedit-projects
const project = await fetch("/api/reedit-projects", {
  method: "POST",
  body: formData,
});

// 2. El backend parsea el archivo y detecta capítulos
const chapters = parseManuscript(fileContent);

// 3. Crear registros en BD
for (const chapter of chapters) {
  await storage.createReeditChapter({
    projectId: project.id,
    chapterNumber: chapter.number,
    title: chapter.title,
    originalContent: chapter.content,
    wordCount: countWords(chapter.content),
  });
}
```

### 4.2 Inicio del Procesamiento

```typescript
// POST /api/reedit-projects/:id/start
const orchestrator = new ReeditOrchestrator();
orchestrator.processProject(projectId);
```

### 4.3 Stage 1: Análisis Estructural

```typescript
async analyzeStructure(chapters: ReeditChapter[]): Promise<StructureAnalysis> {
  const analysis: StructureAnalysis = {
    duplicateChapters: [],
    outOfOrderChapters: [],
    missingChapters: [],
    recommendations: [],
  };
  
  // Detectar duplicados por similitud de contenido
  for (let i = 0; i < chapters.length; i++) {
    for (let j = i + 1; j < chapters.length; j++) {
      const similarity = calculateSimilarity(chapters[i], chapters[j]);
      if (similarity > 0.85) {
        analysis.duplicateChapters.push({
          chapterId: chapters[j].id,
          duplicateOf: chapters[i].chapterNumber,
          similarity,
        });
      }
    }
  }
  
  // Detectar capítulos fuera de orden
  // ...
  
  return analysis;
}
```

### 4.4 Stage 2: Revisión Editorial

```typescript
for (const chapter of validChapters) {
  const editor = new ReeditEditorAgent();
  const feedback = await editor.reviewChapter(
    chapter.originalContent,
    chapter.chapterNumber,
    detectedLanguage
  );
  
  await storage.updateReeditChapter(chapter.id, {
    editorScore: feedback.score,
    editorFeedback: feedback,
    processingStage: "editor",
  });
}
```

### 4.5 Stage 3: Extracción World Bible

```typescript
const extractor = new WorldBibleExtractorAgent();
const worldBible = await extractor.extractWorldBible(
  chapters.map(c => ({ num: c.chapterNumber, content: c.originalContent })),
  editorFeedbacks
);

await storage.createReeditWorldBible({
  projectId,
  characters: worldBible.personajes,
  locations: worldBible.ubicaciones,
  timeline: worldBible.timeline,
  loreRules: worldBible.reglasDelMundo,
  historicalPeriod: worldBible.epocaHistorica,
});
```

### 4.6 Stage 4: Expansión (Opcional)

```typescript
if (project.expandChapters) {
  const analyzer = new ChapterExpansionAnalyzer();
  const plan = await analyzer.analyzeForExpansion(
    chapters,
    project.targetMinWordsPerChapter
  );
  
  for (const toExpand of plan.chaptersToExpand) {
    const expander = new ChapterExpanderAgent();
    const expanded = await expander.expandChapter(
      chapter.originalContent,
      toExpand.expansionSuggestions,
      worldBible
    );
    
    await storage.updateReeditChapter(chapter.id, {
      editedContent: expanded.expandedContent,
    });
  }
  
  if (project.insertNewChapters) {
    for (const newChapter of plan.newChaptersToInsert) {
      const generator = new NewChapterGeneratorAgent();
      const generated = await generator.generateChapter(
        newChapter.purpose,
        newChapter.suggestedBeats,
        worldBible
      );
      
      // Insertar y renumerar capítulos
      await insertAndRenumberChapters(projectId, newChapter.insertAfter, generated);
    }
  }
}
```

### 4.7 Stage 5: QA (Auditorías)

```typescript
// Continuidad
const continuitySentinel = new ContinuitySentinelAgent();
const continuityResult = await continuitySentinel.analyze(chapters, worldBible);

// Voz y ritmo
const voiceAuditor = new VoiceRhythmAuditorAgent();
const voiceResult = await voiceAuditor.analyze(chapters);

// Repeticiones semánticas
const semanticDetector = new SemanticRepetitionDetectorAgent();
const semanticResult = await semanticDetector.detectRepetitions(chapterSummaries);

// Anacronismos
const anachronismDetector = new AnachronismDetectorAgent();
const anachronismResult = await anachronismDetector.detectAnachronisms(chapters, genre, premise);

// Guardar reportes
await storage.createReeditAuditReport({
  projectId,
  auditType: "continuity",
  findings: continuityResult.issues,
  score: continuityResult.score,
});
```

### 4.8 Stage 6-7: Reescritura y Copy-Editing

```typescript
// Reescritura narrativa (problemas detectados en QA)
for (const issue of allIssues) {
  const chapter = chapters.find(c => c.chapterNumber === issue.chapterNumber);
  
  const rewritten = await microsurgeryRewrite(
    chapter.editedContent || chapter.originalContent,
    issue.correctionInstruction,
    worldBible
  );
  
  await storage.updateReeditChapter(chapter.id, {
    editedContent: rewritten,
  });
}

// Copy-editing
for (const chapter of validChapters) {
  const copyeditor = new ReeditCopyEditorAgent();
  const polished = await copyeditor.polish(
    chapter.editedContent || chapter.originalContent,
    detectedLanguage
  );
  
  await storage.updateReeditChapter(chapter.id, {
    editedContent: polished.editedText,
    fluencyImprovements: polished.changes,
    processingStage: "copyeditor",
  });
}
```

### 4.9 Stage 8: Revisión Final (Loop con Aprobación)

```typescript
let approved = false;
let consecutiveHighScores = 0;

while (!approved && revisionCycle < 15) {
  const finalReviewer = new FinalReviewerAgent();
  const review = await finalReviewer.execute({
    chapters: validChapters.map(c => c.editedContent),
    worldBible,
    userInstructions: project.pendingUserInstructions,
  });
  
  if (review.score >= 9) {
    consecutiveHighScores++;
    if (consecutiveHighScores >= 2) {
      approved = true;
      await storage.updateReeditProject(projectId, {
        status: "completed",
        bestsellerScore: review.score,
      });
    }
  } else {
    consecutiveHighScores = 0;
    
    // Crear issues para aprobación del usuario
    await createIssueRecords(projectId, review.issues, revisionCycle);
    
    // PAUSAR para aprobación del usuario
    await storage.updateReeditProject(projectId, {
      status: "awaiting_issue_approval",
      pauseReason: `Se detectaron ${review.issues.length} problemas. Revisa y aprueba/rechaza cada uno.`,
    });
    
    return; // Esperar input del usuario
  }
  
  revisionCycle++;
}
```

---

## 5. Sistema de Aprobación de Issues (Checklist)

### Flujo

1. FinalReviewer detecta issues
2. Sistema crea registros en `reedit_issues` con status `pending`
3. Proyecto se pausa en `awaiting_issue_approval`
4. Usuario ve checklist en UI
5. Usuario aprueba/rechaza cada issue
6. Usuario hace clic en "Continuar"
7. Sistema aplica solo correcciones aprobadas
8. Vuelve a revisar

### API Endpoints

```typescript
// Ver issues pendientes
GET /api/reedit-projects/:id/issues

// Aprobar issue
POST /api/reedit-issues/:id/approve

// Rechazar issue
POST /api/reedit-issues/:id/reject
{ rejectionReason: "No es un problema real" }

// Aprobar todos
POST /api/reedit-projects/:id/issues/approve-all

// Continuar después de aprobación
POST /api/reedit-projects/:id/proceed-corrections
```

### UI del Checklist

```typescript
// Issues pendientes (checkbox, descripción, severidad)
// Issues resueltos (tachados con checkmark verde)

interface IssueDisplay {
  id: number;
  category: string;
  severity: "critica" | "mayor" | "menor";
  description: string;
  chapterNumber: number;
  status: "pending" | "approved" | "rejected" | "resolved";
}
```

---

## 6. Sistema de Hashes para Issues Resueltos

El sistema usa hashes únicos para evitar re-reportar issues ya corregidos:

```typescript
function generateIssueHash(issue: FinalReviewIssue): string {
  const data = JSON.stringify({
    categoria: issue.categoria,
    descripcion: issue.descripcion?.substring(0, 100),
    capitulos: issue.capitulos_afectados?.sort(),
  });
  return crypto.createHash("md5").update(data).digest("hex");
}

// Al detectar issues, filtrar los ya resueltos
const newIssues = issues.filter(issue => {
  const hash = generateIssueHash(issue);
  return !resolvedHashes.includes(hash);
});
```

---

## 7. Sistema de Tranches (Manuscritos Largos)

Para manuscritos que exceden el límite de tokens del modelo:

```typescript
const TRANCHE_SIZE = 8; // capítulos por tranche
const MAX_TOKENS = 131000; // límite DeepSeek

async function reviewInTranches(chapters: ReeditChapter[]): Promise<FinalReviewerResult> {
  const tranches = chunkArray(chapters, TRANCHE_SIZE);
  const allIssues: FinalReviewIssue[] = [];
  let accumulatedContext = "";
  
  for (let i = 0; i < tranches.length; i++) {
    const tranche = tranches[i];
    
    const result = await finalReviewer.execute({
      chapters: tranche,
      previousContext: accumulatedContext,
      trancheInfo: `Tranche ${i + 1}/${tranches.length}`,
    });
    
    allIssues.push(...result.issues);
    accumulatedContext += summarizeTranche(result);
  }
  
  // Deduplicar issues similares de diferentes tranches
  const deduplicatedIssues = deduplicateIssues(allIssues);
  
  return {
    score: calculateOverallScore(tranches),
    issues: deduplicatedIssues,
  };
}
```

---

## 8. Microcirugía (Cambios Mínimos)

Para correcciones, el sistema usa "microcirugía" que preserva el 95% del texto:

```typescript
const MICROSURGERY_PROMPT = `
🔬 MODO MICROCIRUGÍA - CAMBIOS MÍNIMOS 🔬

REGLA CRÍTICA: Copia el 95% del texto EXACTAMENTE como está.
Solo modifica las oraciones específicas que tienen el problema indicado.

PROCESO:
1. Lee el texto completo
2. Identifica SOLO las oraciones que violan la instrucción
3. Copia el resto del texto SIN CAMBIOS
4. Aplica la corrección MÍNIMA a las oraciones problemáticas

PROHIBIDO:
- Reescribir párrafos enteros
- Cambiar el estilo narrativo
- Añadir contenido nuevo
- Eliminar contenido que no tiene problemas
`;
```

---

## 9. Auto-Recovery

### Heartbeat

```typescript
async updateHeartbeat(projectId: number): Promise<void> {
  await storage.updateReeditProject(projectId, {
    heartbeatAt: new Date(),
  });
}

// Cada operación actualiza el heartbeat
for (const chapter of chapters) {
  await this.updateHeartbeat(projectId);
  // ... procesar capítulo
}
```

### Watchdog

```typescript
const FROZEN_THRESHOLD_MS = 6 * 60 * 1000; // 6 minutos

async function checkFrozenProjects(): Promise<void> {
  const projects = await storage.getAllReeditProjects();
  const processing = projects.filter(p => p.status === "processing");
  
  for (const project of processing) {
    const timeSince = Date.now() - project.heartbeatAt.getTime();
    if (timeSince > FROZEN_THRESHOLD_MS) {
      console.log(`[Watchdog] Resuming frozen reedit project ${project.id}`);
      await resumeReeditProject(project.id);
    }
  }
}
```

---

## 10. API Endpoints

### Gestión de Proyectos

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/api/reedit-projects` | Listar proyectos |
| POST | `/api/reedit-projects` | Importar manuscrito |
| GET | `/api/reedit-projects/:id` | Obtener proyecto |
| DELETE | `/api/reedit-projects/:id` | Eliminar proyecto |
| POST | `/api/reedit-projects/:id/start` | Iniciar procesamiento |
| POST | `/api/reedit-projects/:id/resume` | Reanudar |
| POST | `/api/reedit-projects/:id/cancel` | Cancelar |
| GET | `/api/reedit-projects/:id/stream` | SSE de progreso |

### Capítulos y Reportes

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/api/reedit-projects/:id/chapters` | Listar capítulos |
| GET | `/api/reedit-projects/:id/world-bible` | Obtener World Bible |
| GET | `/api/reedit-projects/:id/audit-reports` | Obtener reportes QA |

### Issues (Checklist)

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/api/reedit-projects/:id/issues` | Listar issues |
| POST | `/api/reedit-issues/:id/approve` | Aprobar issue |
| POST | `/api/reedit-issues/:id/reject` | Rechazar issue |
| POST | `/api/reedit-projects/:id/proceed-corrections` | Aplicar correcciones |

### Exportación

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/api/reedit-projects/:id/export-markdown` | Exportar Markdown |
| GET | `/api/reedit-projects/:id/export` | Exportar DOCX |
| GET | `/api/reedit-projects/:id/translate-stream` | Traducir (SSE) |

---

## 11. Variables de Entorno

```bash
# Base de datos
DATABASE_URL=postgresql://...

# DeepSeek (principal)
DEEPSEEK_API_KEY=sk-...
DEEPSEEK_REEDITOR_API_KEY=sk-...  # Opcional, clave separada

# Gemini (alternativa)
AI_INTEGRATIONS_GEMINI_API_KEY=...
```

---

## 12. Checklist de Replicación

### Base
- [ ] Crear tablas: `reedit_projects`, `reedit_chapters`, `reedit_world_bibles`, `reedit_issues`, `reedit_audit_reports`
- [ ] Implementar parser de manuscritos (TXT, MD, DOCX)
- [ ] Implementar detección de capítulos
- [ ] Implementar detección de idioma

### Agentes
- [ ] Implementar `ReeditEditorAgent`
- [ ] Implementar `ReeditCopyEditorAgent`
- [ ] Implementar `WorldBibleExtractorAgent`
- [ ] Implementar `ContinuitySentinelAgent`
- [ ] Implementar `SemanticRepetitionDetectorAgent`
- [ ] Implementar `AnachronismDetectorAgent`
- [ ] Adaptar `FinalReviewerAgent` para reedit

### Orquestador
- [ ] Implementar `ReeditOrchestrator` con todas las stages
- [ ] Implementar sistema de resume (continuar desde stage interrumpida)
- [ ] Implementar fast-track resume para revisión final
- [ ] Implementar sistema de heartbeat

### Sistema de Issues
- [ ] Implementar creación de issues desde FinalReviewer
- [ ] Implementar hashes para evitar duplicados
- [ ] Implementar endpoints de aprobación/rechazo
- [ ] Implementar UI de checklist

### Expansión (Opcional)
- [ ] Implementar `ChapterExpansionAnalyzer`
- [ ] Implementar `ChapterExpanderAgent`
- [ ] Implementar `NewChapterGeneratorAgent`
- [ ] Implementar renumeración de capítulos

### Infraestructura
- [ ] Implementar SSE para progreso
- [ ] Implementar auto-recovery
- [ ] Implementar exportación Markdown/DOCX
- [ ] Integrar sistema de traducción

---

## Notas Importantes

1. **Orden de stages**: El pipeline debe ejecutarse en orden, pero puede resumirse desde cualquier stage interrumpida.

2. **Microcirugía**: Siempre preferir cambios mínimos. Preservar el 95% del texto original.

3. **Aprobación de usuario**: NUNCA aplicar correcciones automáticamente. Siempre pausar para que el usuario revise y apruebe.

4. **Hashes de issues**: Generar y almacenar hashes para evitar re-reportar problemas ya corregidos.

5. **Tranches**: Para manuscritos largos, dividir en tranches de 8 capítulos para no exceder límites de tokens.

6. **Heartbeat**: Actualizar heartbeat frecuentemente para que el watchdog pueda detectar proyectos congelados.

7. **Límite de correcciones**: Máximo 3 correcciones por capítulo para evitar loops infinitos.
