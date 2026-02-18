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
- **Default Provider**: DeepSeek for general tasks, final review, and creative tasks.
- **Optional Provider**: Gemini for creative tasks, analysis, specific QA agents (Final Reviewer, Continuity Sentinel, Narrative Director), and Global Architect planning.
- **Performance Optimization**: Focus on V3 models for faster processing and `temperature: 1.0` for creative output.

### Build System
- **Development**: `tsx` (hot reload).
- **Production**: `esbuild` for server, Vite for client.

### Feature Specifications
- **Optimized Pipeline**: Streamlined re-edit pipeline reducing token consumption and enhancing chapter management.
- **Automated Pause & Approval**: System pauses for user intervention after non-perfect evaluations; requires high score with no critical issues for project approval.
- **Robust Recovery Systems**: Includes issue hash tracking, immediate cancellation, fast-track resume, server restart recovery, and generation token system.
- **Universal Consistency Module**: Prevents continuity violations by injecting constraints before writing and validating after each chapter, tracking entities, rules, and relationships.
- **Anti-Repetition & Humanization**: Vocabulary tracking and explicit Ghostwriter instructions to prevent overused words, repetitive phrases, and AI cliches. Automatically regenerates truncated chapters.
- **Full Context Injection**: Ghostwriter receives comprehensive scene context from World Bible for consistency.
- **Series World Bible Propagation**: Carries forward accumulated world-building knowledge across multi-book series for continuity.
- **Proactive Quality Prevention**: Enhanced vocabulary tracking, transition validation, and Chekhov's Gun validation.
- **Surgical-First Corrections**: Prioritizes surgical patching for all issue types, using full rewrites only as a last resort.
- **Detect All, Then Fix Strategy**: Two-phase correction (Detection then Verified Correction) with immediate verification and escalation.
- **Zero-Cascade with Focused Verification**: Corrections do not cascade; employs progressive escalation for failed surgical patches.
- **OmniWriter Zero-Touch Pipeline**: Chapter-level audit using Inquisidor, Estilista, Ritmo auditors in parallel; SmartEditor for recursive corrections; Ensamblador for voice unification.
- **Plot Coherence Validation**: Global Architect output is strictly validated BEFORE chapter generation.
- **Protagonist Presence Enforcement**: Three-tier defense ensures protagonist appears in at least 40% of chapters.
- **Cumulative Correction Phases**: Corrections build on previous ones; in-memory chapter array is updated for fresh `adjacentContext`.
- **Character Consistency & Emergency Recovery**: Enforces character consistency during regeneration and provides emergency chapter recovery.
- **Enhanced Error Recovery**: All orchestrator errors result in a "paused" status for easy resume.
- **Chapter Backup System**: Automatic backups before destructive chapter operations.
- **Pattern Tracker Anti-Repetition**: Prevents repetitive narrative structures.
- **Temporal Chronology Injection & Reinforcement**: Injects dated events and enforces temporal consistency with a four-layer defense.
- **Resilient Audit Execution**: Progressive audit execution saves agent results immediately to DB.
- **Structural Issue Detection**: Identifies and auto-resolves structural issues to prevent infinite rewrite loops.
- **Re-editor**: Functions as a Development Editor with forensic consistency audits and commercial viability analysis.
- **World Bible Validator**: Gemini audits the entire World Bible for objective factual contradictions before writing begins.
- **Structural Checkpoint System**: Every 5 chapters, Gemini compares written chapters against the original plan to detect structural deviations.
- **Accumulated Learning System**: Lessons from validation and correction cycles are stored per-project and injected into subsequent Ghostwriter calls.
- **Flexible Chapter Count**: Global Architect treats user's chapter count as a MINIMUM, allowing up to 30% more chapters.
- **Global Architect Large Novel Support**: For novels with 20+ chapters, uses compact output, increased token limits, smart chapter completion, and truncation repair.
- **Series Character Protection System**: Multi-layer defense to prevent AI from changing character names, genders, or roles in series.
- **Volume Context Propagation System**: Ensures all volume-specific information from the series guide transfers completely.
- **Death Synchronization System**: Syncs character deaths from `world_entities` to the World Bible. Includes code-level death verification: requires explicit death phrases in chapter text near the entity name and blocks drugging/unconsciousness from being registered as death.
- **Full Entity Synchronization System**: Extends death sync to all entity types (characters, locations, objects, secrets).
- **Objective Evaluation System**: Data-driven publishability assessment using 6 weighted metrics (coherence, plot, structure, prose, length, protagonist). Protagonist presence uses partial name matching for accuracy.
- **Gemini Rate Limit Resilience**: All direct Gemini API calls use `geminiGenerateWithRetry()` with exponential backoff.
- **SmartEditor Anti-Regression System**: Full rewrite prompts include explicit anti-regression rules.
- **Enhanced Structural Adherence**: Ghostwriter outline injection includes explicit priority rules.
- **Minimum Chapter Word Count Enforcement**: Chapters below minimum length are automatically extended.
- **Progressive Thread Closure System**: When 5 or fewer chapters remain, injects urgency instructions to close unresolved plot threads proactively. Distributes thread closures across remaining chapters with escalating urgency (MEDIA → ALTA → CRÍTICA). Prevents rushed endings by forcing thread resolution BEFORE the epilogue.
- **Auto Thread Status Update**: After each chapter, analyzes summary and text to auto-detect resolved threads (using keyword proximity + resolution indicators). Updates thread status in real-time for accurate progressive closure.
- **Chapter Backup System**: Automatic backups before destructive chapter operations.
- **Scene-Based Pipeline (LitAgents 2.0)**: Optimized for DeepSeek AI models with specialized agents and `fuse.js` for surgical JSON patching. Includes a four-layer prose quality detection system.
- **Enforced Continuity Corrections (LitAgents 3.2)**: When Universal Consistency detects critical violations (dead characters reappearing), SmartEditor auto-corrects with up to 2 rewrite attempts before proceeding.
- **Plot Thread DB Sync (LitAgents 3.2)**: Final structural review now updates plot_threads status to "resolved" in DB after closing threads in the last chapter. Objective Evaluator performs content-based verification to detect threads resolved in text but still "active" in DB.
- **Truncation Detection & Repair (LitAgents 3.2)**: After chapter finalization, detects text ending mid-sentence (no final punctuation or last line < 3 words) and auto-repairs via SmartEditor.
- **Estilista Issue Cap (LitAgents 3.2)**: Maximum 30 style issues per chapter, prioritized by severity (critica > mayor > menor), preventing inflated correction lists.

## External Dependencies

### AI Services
- **DeepSeek**: Primary AI provider (requires `DEEPSEEK_API_KEY`, `DEEPSEEK_TRANSLATOR_API_KEY`, `DEEPSEEK_REEDITOR_API_KEY`).
- **Replit AI Integrations**: Gemini API access (requires `AI_INTEGRATIONS_GEMINI_API_KEY`, `AI_INTEGRATIONS_GEMINI_BASE_URL`).

### Database
- **PostgreSQL**: Accessed via `DATABASE_URL`.
- **Drizzle Kit**: For database migrations.

### Key NPM Packages
- `@google/genai`: Google Gemini AI SDK.
- `drizzle-orm` / `drizzle-zod`: ORM and schema validation.
- `express`: Node.js web framework.
- `@tanstack/react-query`: React asynchronous state management.
- `wouter`: Lightweight React routing.
- Radix UI primitives: UI component foundation.