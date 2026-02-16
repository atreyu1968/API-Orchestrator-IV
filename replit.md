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
- **OmniWriter Zero-Touch Pipeline (v3.0)**: Replaces the old scene-based audit system with a chapter-level approach:
  - **Triple Cross-Audit**: Inquisidor (lore/plot holes), Estilista (copy editing at temp 0), Ritmo (tension/pacing) run in parallel after each chapter.
  - **Recursive Correction Loops**: SmartEditor applies corrections from all 3 auditors, with Levenshtein convergence detection (< 1% change threshold) to prevent infinite loops.
  - **Ensamblador Final Assembly (Phase 3)**: After all chapters complete, runs voice unification and cross-chapter character consistency across the full manuscript.
  - **New Agent Files**: `server/agents/v2/inquisidor.ts`, `server/agents/v2/estilista.ts`, `server/agents/v2/ritmo.ts`, `server/agents/v2/ensamblador.ts`
  - **Levenshtein Utility**: `server/utils/levenshtein.ts` for convergence detection.
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
- **World Bible Validator**: Gemini audits the entire World Bible for structural weaknesses before writing begins, auto-correcting detected issues and storing lessons for Ghostwriter injection.
- **Structural Checkpoint System**: Every 5 chapters, Gemini compares written chapters against the original plan to detect structural deviations. Deviated chapters are automatically rewritten (max 5 per checkpoint) with incremental analysis, tracking of already-corrected chapters, minimum word count verification, retry logic, and post-rewrite verification. Includes a full-novel final structural review.
- **Accumulated Learning System**: Lessons from Bible validation, structural checkpoints, and correction cycles are stored per-project and injected into every subsequent Ghostwriter call, creating a feedback loop for preventing recurring problems.

- **Flexible Chapter Count (v2.9.11)**: The Global Architect now treats the user's chapter count as a MINIMUM rather than an exact number. If the narrative arc requires more chapters for proper development (character arcs, plot turns, subplot resolution), the architect can add up to 30% more regular chapters. The orchestrator detects the expansion, enforces the 30% cap with safe trimming and renumbering, updates the project's chapterCount in the database, and logs the change. This prevents compressed narratives while maintaining reasonable bounds.
- **Optional Gemini Architect (v2.9.11)**: Users can optionally select Gemini instead of DeepSeek for the Global Architect when starting generation, via a checkbox in the generation dialog. Provides higher quality planning for complex novels at higher cost. The base agent automatically maps DeepSeek model names to Gemini equivalents when the Gemini provider is forced.
- **Optional Gemini QA Agents (v2.9.11)**: Users can optionally select Gemini for three QA agents: Final Reviewer (1 execution, detects global plot holes), Continuity Sentinel (per block, verifies continuity), and Narrative Director (per chapter, highest frequency/cost). Individual checkboxes in the generation dialog and correction triggers. Gemini is used for diagnosis/detection only; corrections always use DeepSeek. AI usage logging reflects correct model names based on provider selection. Flags propagated through generate-v2, final-review, and detect-and-fix routes.
- **Global Architect Large Novel Support (v2.9.10)**: For novels with 20+ chapters, the Global Architect uses a compact output format (fewer fields per chapter, concise summaries) to prevent token limit truncation. Features: (1) Compact prompt format omitting optional per-chapter fields for large novels. (2) Increased max_completion_tokens (32K for 20+ chapters). (3) Smart chapter completion - if the AI returns fewer chapters than requested but at least 25%, automatically makes a focused follow-up call to generate ONLY the missing chapters and merges them. (4) Truncation repair - salvages partially-truncated JSON responses by closing unclosed brackets/braces.
- **Series Character Protection System (v2.9.10)**: Multi-layer defense to prevent the AI from changing character names, genders, or roles when generating World Bibles for series books. Features: (1) Reinforced prompts in Global Architect, Guide Generator, and Series Bible Generator with explicit INMUTABLE character protection instructions. (2) Post-generation validation comparing generated World Bible characters against the series guide, with automatic name correction for mismatches. (3) Gender consistency detection using contextual analysis of the series guide. (4) Enhanced previousBooksContext with detailed character attributes (appearance, role) marked as INMUTABLE. (5) Activity log warnings for any detected character inconsistencies. (6) Gender auto-correction updates structured fields (gender/sexo/sex) plus word-boundary-aware profile/description text replacements.
- **Volume Context Propagation System (v2.9.10)**: Ensures ALL volume-specific information from the series guide transfers completely to the World Bible generation. The `extractVolumeContextFromGuide()` method extracts: HITOS DEL VOLUMEN N, ARQUITECTURA DEL VOLUMEN N, volume-specific arguments, protagonist section, recurring characters, world rules, main plot thread (metatrama), and continuity error prevention sections. Extracted context is injected prominently into `previousBooksContext` with "INFORMACIÓN OBLIGATORIA PARA ESTE VOLUMEN" header, making it mandatory for the Global Architect to incorporate into the World Bible and chapter structure.

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