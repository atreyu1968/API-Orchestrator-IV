# LitAgents - Autonomous Literary Agent Orchestration System

## Overview
LitAgents is a Node.js application designed to orchestrate autonomous AI literary agents for managing the entire novel-writing workflow. It provides a comprehensive solution for authoring and refining literary works, enhancing efficiency and quality through AI-driven processes. Key capabilities include orchestrating specialized AI agents, maintaining a persistent World Bible for consistency, real-time monitoring, automated refinement loops, and auto-recovery systems. The system supports importing and editing external manuscripts, advanced chapter manipulation, and an automatic pause and approval system for quality assurance. LitAgents focuses on a scene-based writing pipeline with surgical JSON patching for token efficiency, enhanced consistency checks, proactive quality prevention, and robust error recovery, aiming to improve literary output and market potential.

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
- **Schema**: Tables for projects, chapters, world Bibles, thought logs, agent statuses, series, continuity snapshots, imported manuscripts, plot threads, world entities, and consistency violations.

### AI Integration
- **Default Provider**: DeepSeek (cost-efficient) for general tasks, final review, and creative tasks.
- **Optional Provider**: Gemini for creative tasks and analysis, and for specific QA agents (Final Reviewer, Continuity Sentinel, Narrative Director) and Global Architect planning.
- **Performance Optimization**: Focus on V3 models for faster processing.
- **Configuration**: `temperature: 1.0` for creative output.

### Build System
- **Development**: `tsx` (hot reload).
- **Production**: `esbuild` for server, Vite for client.

### Feature Specifications
- **Optimized Pipeline**: Streamlined re-edit pipeline reducing token consumption and enhancing chapter management.
- **Automated Pause & Approval**: System pauses for user intervention after non-perfect evaluations; requires high score with no critical issues for project approval.
- **Robust Recovery Systems**: Includes issue hash tracking, immediate cancellation, fast-track resume, server restart recovery, and generation token system.
- **Universal Consistency Module**: Prevents continuity violations by injecting constraints before writing and validating after each chapter, tracking entities, rules, and relationships.
- **Anti-Repetition & Humanization**: Vocabulary tracking and explicit Ghostwriter instructions to prevent overused words, repetitive phrases, and AI cliches. Automatically regenerates truncated chapters.
- **Full Context Injection**: Ghostwriter receives comprehensive scene context from World Bible, including physical attributes, relationships, location descriptions, world rules, prohibited vocabulary, premise, timeline, character voices, arcs, motivations, themes, motifs, sensory palette, and continuity watchpoints.
- **Series World Bible Propagation**: Carries forward accumulated world-building knowledge across multi-book series for continuity.
- **Proactive Quality Prevention**: Enhanced vocabulary tracking, transition validation, and Chekhov's Gun validation.
- **Surgical-First Corrections**: Prioritizes surgical patching for all issue types, using full rewrites only as a last resort. Provides detailed correction visibility.
- **Detect All, Then Fix Strategy**: A two-phase correction strategy (Detection then Verified Correction) to prevent inconsistencies, with immediate verification and escalation for unresolved issues.
- **Zero-Cascade with Focused Verification**: Corrections do not cascade; only grave new problems are reported. Employs progressive escalation for failed surgical patches, including focused full rewrites with strict validation. Supports multi-chapter coordination and specialized prompts by error type.
- **OmniWriter Zero-Touch Pipeline**: Replaces old scene-based audit with a chapter-level approach using Inquisidor, Estilista, and Ritmo auditors in parallel. SmartEditor applies recursive corrections with Levenshtein convergence detection. Ensamblador provides final voice unification and cross-chapter character consistency.
- **Plot Coherence Validation**: Global Architect output is strictly validated BEFORE chapter generation to prevent structural issues.
- **Protagonist Presence Enforcement**: Three-tier defense system ensures protagonist appears in at least 40% of chapters with explicit naming, through prompt instructions, specific correction instructions, and automatic post-processing.
- **Cumulative Correction Phases**: Corrections build on previous ones; in-memory chapter array is updated after each successful correction for fresh adjacentContext.
- **Character Consistency & Emergency Recovery**: Enforces character consistency during regeneration and provides emergency chapter recovery to reconstruct outlines from existing chapters. Extended guide character extraction parses multiple formats.
- **Cancel Correction Button**: Properly stops active corrections, with orchestrator checking cancellation flags and logging traceability.
- **Enhanced Error Recovery**: All orchestrator errors result in a "paused" status for easy resume, preserving state and providing activity logs with context.
- **Chapter Backup System**: Automatic backups before destructive chapter operations (merge, delete), including full chapter data, restorable via API.
- **Pattern Tracker Anti-Repetition**: Prevents repetitive narrative structures by classifying scene types, tracking information acquisition methods, monitoring chapter opening/closing patterns, and detecting consecutive repetition.
- **Full World Bible Context Injection**: Ghostwriter receives a complete index of all World Bible content, including all characters, locations, and significant objects, to prevent continuity violations.
- **Temporal Chronology Injection**: Enhanced timeline extraction injects dated events from the World Bible into the Ghostwriter prompt, including key events, character-specific dated events, and temporal constraints.
- **Timeline Reinforcement System**: Four-layer temporal consistency defense with a Rolling Narrative Timeline Tracker, post-write validation, critical error types for timeline contradictions, and strengthened Ghostwriter system prompts enforcing temporal rules.
- **Resilient Audit Execution**: Progressive audit execution saves each agent result immediately to DB, preventing data loss on connection failures. Supports resuming from failure points.
- **Structural Issue Detection**: Identifies and auto-resolves structural issues to prevent infinite rewrite loops.
- **Re-editor**: Functions as a Development Editor with forensic consistency audits and commercial viability analysis, using surgical fix optimization.
- **World Bible Validator**: Gemini audits the entire World Bible for objective factual contradictions before writing begins, with strict severity classification and graceful acceptance criteria. Only blocks pipeline on factual contradictions.
- **Structural Checkpoint System**: Every 5 chapters, Gemini compares written chapters against the original plan to detect structural deviations, automatically rewriting deviated chapters with incremental analysis and post-rewrite verification. Includes a full-novel final structural review.
- **Accumulated Learning System**: Lessons from Bible validation, structural checkpoints, and correction cycles are stored per-project and injected into every subsequent Ghostwriter call, creating a feedback loop for preventing recurring problems.
- **Flexible Chapter Count**: Global Architect treats user's chapter count as a MINIMUM, allowing up to 30% more chapters if narrative arc requires it, with orchestrator managing expansion and database updates.
- **Global Architect Large Novel Support**: For novels with 20+ chapters, uses a compact output format, increased token limits, smart chapter completion, and truncation repair for robust planning.
- **Series Character Protection System**: Multi-layer defense to prevent AI from changing character names, genders, or roles in series, including reinforced prompts, post-generation validation, and activity log warnings.
- **Volume Context Propagation System**: Ensures all volume-specific information from the series guide transfers completely to the World Bible generation process.
- **Death Synchronization System**: Before each chapter's Ghostwriter call, deaths recorded in `world_entities` are synced back into the in-memory World Bible `characters` array AND persisted to the `worldBibles` table. This eliminates the root cause of dead characters appearing alive: the World Bible and entity DB now always agree on who is dead. Applied in all Ghostwriter paths (main pipeline, regeneration, extension, fill missing). Entity status is also set to 'dead' when death facts are recorded.
- **Full Entity Synchronization System**: Extends death sync to ALL entity types. Before each chapter, `syncEntitiesIntoWorldBible()` syncs: character locations, emotional states, trauma, knowledge, personal items (mapped by owner), immutable physical traits, ages; location descriptions/atmosphere/features (creates new locations if not in WB); object ownership/location/status (creates new objects if not in WB); secrets (distributed to characters who know them). New characters from world_entities are also added to the World Bible. All bilingual fields (`characters`/`personajes`, `ubicaciones`/`locations`, `objetos`/`objects`) are kept in sync. Changes persist to DB for resume consistency.
- **Objective Evaluation System**: Data-driven publishability assessment using 6 weighted metrics (coherence 25%, plot 20%, structure 20%, prose 15%, length 10%, protagonist 10%). Calculates scores from DB data without AI calls. Verdicts: PUBLICABLE (80%+), CASI_PUBLICABLE (60-79%), NECESITA_TRABAJO (<60% or blockers). Persisted as JSONB, viewable and re-runnable from dashboard.
- **Gemini Rate Limit Resilience**: All direct Gemini API calls (bible-validator, structural checkpoints, final review, post-rewrite verification, diagnosis, risk analysis, issue verification) use `geminiGenerateWithRetry()` with exponential backoff (15s-120s, 5 retries) to handle 429/RESOURCE_EXHAUSTED errors gracefully instead of wasting validation rounds.
- **SmartEditor Anti-Regression System**: Full rewrite prompts include explicit anti-regression rules preventing introduction of forced dialogue tags, repetitive phrases, clichés, register changes, and chapter shortening during corrections. Temperature reduced to 0.4 for higher correction fidelity. "Golden Rule" preserves unaffected paragraphs identically.
- **Enhanced Structural Adherence**: Ghostwriter outline injection includes explicit priority rules for key event execution, character inclusion, and emotional arc adherence. Post-chapter lightweight lexical coverage check (no AI call) warns when key events may not have been executed, deferring to structural checkpoint for verification.

### LitAgents 2.0 (Scene-Based Pipeline)
- **Architecture**: Scene-based writing pipeline optimized for DeepSeek AI models.
- **Agents**: Global Architect, Chapter Architect, Ghostwriter V2, Smart Editor, Summarizer, Narrative Director.
- **Patcher Utility**: Uses `fuse.js` for surgical JSON patching.
- **Narrative Quality Guard**: Four-layer prose quality detection system for forced dialogue tags, similar phrase detection, repetitive structural patterns, and enhanced anti-cliché.

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