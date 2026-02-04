# LitAgents - Autonomous Literary Agent Orchestration System

## Overview
LitAgents is a Node.js application designed to orchestrate autonomous AI literary agents for managing the entire novel-writing workflow. It aims to provide a comprehensive solution for authoring and refining literary works, enhancing efficiency and quality through AI-driven processes. Key capabilities include orchestrating specialized AI agents, maintaining a persistent World Bible for consistency, real-time monitoring, automated refinement loops, and auto-recovery systems. The system supports importing and editing external manuscripts, advanced chapter manipulation, and an automatic pause and approval system for quality assurance. LitAgents focuses on a scene-based writing pipeline with surgical JSON patching for token efficiency, enhanced consistency checks, proactive quality prevention, and robust error recovery.

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
- **Optional Provider**: Gemini for creative tasks and analysis.
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
- **Plot Coherence Validation**: Global Architect output is strictly validated BEFORE chapter generation to prevent structural issues such as orphaned plot threads, weak plot threads, unresolved plot threads, absent protagonists, and missing turning points.
- **Protagonist Presence Enforcement (v2.9.6)**: Three-tier defense system ensures protagonist appears in at least 40% of chapters with explicit naming. Tier 1: Clear prompt instructions. Tier 2: Specific correction instructions on regeneration. Tier 3: Automatic post-processor that injects protagonist name into critical chapters (prologue, ch1, 25%, 50%, 75%, final) and additional chapters until 40% requirement is met.
- **Cumulative Correction Phases (v2.9.6)**: When multiple chapters are corrected in the same review cycle, each correction now builds on the previous one. The in-memory chapter array is updated after each successful correction, so subsequent chapters receive fresh adjacentContext (previous/next chapter content) instead of stale pre-correction content.
- **Character Consistency & Emergency Recovery**: Enforces character consistency during regeneration and provides emergency chapter recovery to reconstruct outlines from existing chapters if plotOutline is missing. Extended guide character extraction parses multiple formats (bullet lists, headers, prose mentions).
- **Cancel Correction Button**: The "Cancelar Corrección" button now properly stops active corrections. The orchestrator checks cancellation flags via `shouldStopProcessing()` at multiple loop points, with logged traceability.
- **Enhanced Error Recovery**: All orchestrator errors result in a "paused" status for easy resume, preserving state and providing activity logs with context.
- **Chapter Backup System (v2.9.6)**: Automatic backups are created before any destructive chapter operations (merge, delete). Backups include full chapter data (content, metadata, scores) and can be restored via API. Prevents data loss during chapter manipulation. Endpoints: `GET /api/projects/:id/chapter-backups` (list), `POST /api/chapter-backups/:id/restore` (restore).
- **Pattern Tracker Anti-Repetition (v2.9.7)**: Prevents repetitive narrative structures within individual novels during generation. The Pattern Tracker module classifies 18 scene types (action, investigation, confrontation, escape, etc.), tracks information acquisition methods to prevent deus ex machina patterns, monitors chapter opening/closing patterns for variety, and detects consecutive repetition and overused scene types. The Chapter Architect receives explicit "avoid these patterns" instructions based on accumulated pattern analysis. Pattern tracking is per-project; each novel maintains its own unique tracker instance that is cleared at the start of a new generation.
- **Full World Bible Context Injection (v2.9.8)**: Ghostwriter now receives a COMPLETE INDEX of all World Bible content, not just scene-specific elements. Three new extraction functions (extractFullCharacterIndex, extractFullLocationIndex, extractFullObjectIndex) provide comprehensive lists of ALL characters, locations, and significant objects from the World Bible. This prevents continuity violations caused by the Ghostwriter being unaware of canonical elements not directly appearing in the current scene. The object limit has been removed (previously capped at 10). The prompt includes a dedicated "ÍNDICE COMPLETO DEL WORLD BIBLE" section for full canonical reference during writing.
- **Structural Issue Detection**: Identifies and auto-resolves structural issues to prevent infinite rewrite loops.
- **Re-editor**: Functions as a Development Editor with forensic consistency audits and commercial viability analysis, using surgical fix optimization.

### LitAgents 2.0 (Scene-Based Pipeline)
- **Architecture**: Scene-based writing pipeline optimized for DeepSeek AI models.
- **Agents**: Global Architect, Chapter Architect, Ghostwriter V2, Smart Editor, Summarizer, Narrative Director.
- **Patcher Utility**: Uses `fuse.js` for surgical JSON patching.

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