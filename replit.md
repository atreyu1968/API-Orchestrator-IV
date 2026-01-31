# LitAgents - Autonomous Literary Agent Orchestration System

## Overview

LitAgents is a Node.js application designed for orchestrating autonomous AI literary agents to manage the entire novel-writing workflow, from initial plot planning to the production of a final, polished manuscript. It aims to provide a comprehensive solution for authoring and refining literary works, enhancing efficiency and quality through AI-driven processes. Key capabilities include orchestrating specialized AI agents, maintaining a persistent World Bible for consistency, logging AI reasoning, providing a real-time monitoring dashboard, and implementing automated refinement loops and auto-recovery systems. The system also supports importing and editing external manuscripts, advanced chapter manipulation, and an automatic pause and approval system for quality assurance. LitAgents 2.0 introduces a scene-based writing pipeline with surgical JSON patching for token efficiency and enhanced consistency checks.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React with TypeScript (Vite).
- **Routing**: Wouter.
- **State Management**: TanStack Query.
- **UI Components**: shadcn/ui (Radix UI primitives).
- **Styling**: Tailwind CSS (light/dark modes).
- **Design System**: Microsoft Fluent Design principles.

### Backend Architecture
- **Runtime**: Node.js with Express.
- **Language**: TypeScript (ES modules).
- **API Pattern**: RESTful endpoints with Server-Sent Events (SSE).
- **Agent System**: Modular agent classes (BaseAgent) with specialized system prompts. An orchestrator manages pipelines and refinement loops.

### Data Storage
- **Database**: PostgreSQL (Drizzle ORM).
- **Schema**: Defined in `shared/schema.ts` with tables for projects, chapters, world Bibles, thought logs, agent statuses, series, continuity snapshots, imported manuscripts, plot threads, world entities, and consistency violations.

### AI Integration
- **Default Provider**: DeepSeek (cost-efficient) with Gemini as an optional alternative.
- **DeepSeek Models**: `deepseek-chat` (V3) for general tasks, `deepseek-reasoner` (R1) for final review.
- **Gemini Models**: `gemini-3-pro-preview` for creative tasks, `gemini-2.5-flash` for analysis.
- **Performance Optimization**: Focus on V3 models for faster processing.
- **Configuration**: `temperature: 1.0` for creative output.

### Build System
- **Development**: `tsx` (hot reload).
- **Production**: `esbuild` for server, Vite for client.

### Feature Specifications
- **Optimized Pipeline**: Streamlined re-edit pipeline reducing token consumption.
- **Manuscript Expansion System**: Agents for expanding and inserting chapters.
- **Chapter Reordering System**: Architect Analyzer recommends and executes reordering.
- **Internal Chapter Header Sync**: Automatic header updates.
- **Automatic Pause System**: Pauses for user intervention after non-perfect evaluations.
- **Approval Logic**: Requires high score with no critical issues for project approval.
- **Issue Hash Tracking System**: Prevents re-reporting resolved issues.
- **Improved Cancellation**: Immediate process cancellation.
- **Fast-Track Resume System**: Optimizes project resumption by skipping unnecessary stages.
- **Robust Server Restart Recovery**: QueueManager marks incomplete projects as "paused" for seamless resume.
- **Generation Token System**: Prevents parallel orchestrator executions. Each new process gets a unique token stored in the database. Orchestrators validate their token before each critical operation, stopping immediately if invalidated by a newer process. This prevents duplicate chapter generation and token waste during auto-recovery.
- **Translation Export Improvements**: Markdown exports strip artifacts, omit dividers, and use localized chapter labels.
- **Immediate Continuity Validation**: Validates chapters after writing, enforcing consistency through targeted rewrites.
- **Mandatory Continuity Constraints**: Ghostwriter receives structured constraints to prevent violations.
- **DeepSeek-Based FinalReviewer with Tranche System**: Divides manuscripts into tranches for cost-efficient review, accumulating context and deduplicating issues. Token-aware tranche sizing (70K limit per tranche) with 40K reserved for prompt overhead.

### LitAgents 2.0 (Scene-Based Pipeline)
- **Architecture**: Scene-based writing pipeline optimized for DeepSeek AI models.
- **6 New Agents**: Global Architect, Chapter Architect, Ghostwriter V2, Smart Editor, Summarizer, Narrative Director.
- **Patcher Utility**: Uses `fuse.js` for surgical JSON patching.
- **Model Assignment**: R1 for planning, V3 for writing/editing.
- **Frontend Integration**: Pipeline selection, v2 agent names, scene progress indicator, and SSE event handling for granular progress.

### LitAgents 2.1 (Universal Consistency Module)
- **Purpose**: Prevents continuity violations by injecting constraints before writing and validating after each chapter.
- **Database Schema**: New tables for `world_entities`, `world_rules`, `entity_relationships`, `consistency_violations`.
- **Genre Definitions**: Tracks rules for 10+ genres.
- **UniversalConsistencyAgent**: Extracts entities, generates constraints, validates chapters, and generates rewrite instructions for violations.
- **Orchestrator Integration**: Initializes consistency DB, injects constraints, validates chapters, and logs violations.

### LitAgents 2.2 (Anti-Repetition and Humanization)
- **VocabularyTracker**: Analyzes recent text to detect overused words, repeated dialogue verbs, repetitive paragraph starters, and AI cliches. Normalizes Spanish accents for consistent detection.
- **Humanization Instructions**: Ghostwriter receives 15+ prohibited AI expressions, rhythm variation rules, and anti-monotony guidelines.
- **Context Injection**: All Ghostwriter calls receive `previousChaptersText` and `currentChapterText` for anti-repetition guidance BEFORE writing.
- **Truncated Chapter Protection**: System automatically detects chapters with <500 words and marks them for regeneration on resume. NEVER leaves truncated chapters.

### Series World Bible Propagation (LitAgents 2.3)
- **Purpose**: Carries forward accumulated world-building knowledge across volumes in a multi-book series.
- **Database Schema**: New `series_world_bible` table with JSONB fields for characters, locations, lessons, worldRules, timelineEvents, objects, and secrets.
- **SeriesWorldBibleExtractor Agent**: Uses DeepSeek to extract world-building elements from completed volumes, analyzing characters (traits, arcs, relationships), locations (significance, key events), narrative lessons, world rules, timeline events, and plot objects/secrets.
- **Automatic Extraction**: Triggers on all project completion paths (6 scenarios) in orchestrator-v2, merging new volume data with existing series knowledge.
- **Imported Manuscript Extraction**: Automatically extracts world bible data when manuscripts are linked (`/api/series/:id/link-manuscript`) or uploaded (`/api/series/:id/upload-volume`) to a series, ensuring consistency even for externally authored volumes.
- **Ghostwriter Injection**: formatSeriesWorldBible method provides contextualized world knowledge to Ghostwriter during scene writing for enhanced continuity.
- **Data Normalization**: Storage layer normalizes field names between extractor output and consumer expectations for consistent data contracts.
- **UI Component**: SeriesWorldBiblePanel displays accumulated data with expandable sections for all entity types.

### LitAgents 2.5 (Proactive Quality Prevention)
- **Purpose**: Prevents minor quality issues during initial composition rather than detecting them only during final review.
- **Enhanced VocabularyTracker**: Lower threshold (2 repetitions), detects domain-specific/technical words repeated 3+ times in 2 paragraphs, tracks scene transitions for abrupt changes.
- **Transition Validation**: SmartEditor penalizes abrupt scene transitions (location/time jumps without narrative connection) with -1 ESTILO per occurrence.
- **Chekhov's Gun Validation**: SmartEditor detects objects used without prior establishment, penalizing with -1 LÓGICA per occurrence.
- **Ghostwriter Prevention**: Explicit instructions about smooth transitions ("Veinte minutos después...") and object establishment before use.
- **Architecture Principle**: Prevention > Detection > Correction (minimize token waste on corrections during FinalReviewer cycles).

### LitAgents 2.4 (Death Tracking & Loop Prevention)
- **Purpose**: Prevents character resurrection errors and infinite correction loops in the FinalReviewer.
- **Deceased Character Tracking**: UniversalConsistency automatically extracts deaths (estado_vital=MUERTO, capitulo_muerte, causa_muerte) and injects a prominent "PERSONAJES FALLECIDOS" block into Ghostwriter constraints, prohibiting dead characters from appearing alive.
- **Death Detection in Validation**: validateChapter prompt explicitly instructs AI to detect and register character deaths with chapter number and cause.
- **Loop Detection System**: trackPersistentIssues() tracks issue hashes across cycles; issues recurring 3+ times trigger escalation.
- **Resurrection Error Detection**: isResurrectionError() identifies critical issues involving dead characters appearing alive.
- **Escalated Corrections**: generateEscalatedCorrection() creates expanded rewrite instructions that affect ALL chapters after the death event, with specific instructions to remove the dead character's active appearances.
- **Automatic Scope Expansion**: When resurrection errors persist, the system automatically expands the correction scope to include all post-death chapters instead of just the flagged ones.

### Re-editor (LitEditors) Development Editor
- **Purpose**: Transforms the Re-editor into a Development Editor with forensic consistency audits and commercial viability analysis.
- **ForensicConsistencyAuditor**: Processes manuscripts in batches, detects 7 violation types, and builds incremental entity states.
- **BetaReaderAgent**: Provides commercial viability analysis with scores and market comparisons.
- **Pipeline Integration**: `forensic_audit` and `beta_reader` stages are integrated into the re-editing pipeline.
- **Database Schema**: New fields in `reedit_projects` for audit results and beta reader reports.
- **Surgical Fix Optimization**: `smartCorrectChapter` method automatically selects surgical patches (≤3 minor problems) vs full rewrite (critical issues), reducing token consumption by ~50%.
- **NarrativeRewriter.surgicalFix**: Generates minimal patches for targeted corrections, preserving author voice and style.
- **applySimplePatches**: Patcher utility applies surgical corrections with fuzzy matching fallback for robust text replacement.

## External Dependencies

### AI Services
- **DeepSeek**: Primary AI provider (`DEEPSEEK_API_KEY`, `DEEPSEEK_TRANSLATOR_API_KEY`, `DEEPSEEK_REEDITOR_API_KEY`).
- **Replit AI Integrations**: Gemini API access (`AI_INTEGRATIONS_GEMINI_API_KEY`, `AI_INTEGRATIONS_GEMINI_BASE_URL`).

### Database
- **PostgreSQL**: Accessed via `DATABASE_URL`.
- **Drizzle Kit**: Used for database migrations.

### Key NPM Packages
- `@google/genai`: Google Gemini AI SDK.
- `drizzle-orm` / `drizzle-zod`: ORM and schema validation.
- `express`: Node.js web framework.
- `@tanstack/react-query`: React asynchronous state management.
- `wouter`: Lightweight React routing.
- Radix UI primitives: UI component foundation.