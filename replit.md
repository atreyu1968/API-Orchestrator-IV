# LitAgents - Autonomous Literary Agent Orchestration System

## Overview

LitAgents is a Node.js application designed for orchestrating autonomous AI literary agents to manage the entire novel-writing workflow, from initial plot planning to the production of a final, polished manuscript. It aims to provide a comprehensive solution for authoring and refining literary works, enhancing efficiency and quality through AI-driven processes. Key capabilities include orchestrating specialized AI agents, maintaining a persistent World Bible for consistency, real-time monitoring, automated refinement loops, and auto-recovery systems. The system supports importing and editing external manuscripts, advanced chapter manipulation, and an automatic pause and approval system for quality assurance. LitAgents 2.0 introduces a scene-based writing pipeline with surgical JSON patching for token efficiency and enhanced consistency checks, focusing on proactive quality prevention and robust error recovery.

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
- **Default Provider**: DeepSeek (cost-efficient) for general tasks (`deepseek-chat` V3), final review (`deepseek-reasoner` R1), and creative tasks.
- **Optional Provider**: Gemini for creative tasks (`gemini-3-pro-preview`) and analysis (`gemini-2.5-flash`).
- **Performance Optimization**: Focus on V3 models for faster processing.
- **Configuration**: `temperature: 1.0` for creative output.

### Build System
- **Development**: `tsx` (hot reload).
- **Production**: `esbuild` for server, Vite for client.

### Feature Specifications
- **Optimized Pipeline**: Streamlined re-edit pipeline reducing token consumption and enhancing chapter management (expansion, reordering, header sync).
- **Automated Pause & Approval**: System pauses for user intervention after non-perfect evaluations; requires high score with no critical issues for project approval.
- **Robust Recovery Systems**: Includes issue hash tracking, immediate cancellation, fast-track resume, server restart recovery, and generation token system to prevent parallel orchestrator executions.
- **Translation Export Improvements**: Markdown exports strip artifacts, omit dividers, and use localized chapter labels.
- **Universal Consistency Module**: Prevents continuity violations by injecting constraints before writing and validating after each chapter, tracking entities, rules, and relationships.
- **Anti-Repetition & Humanization**: Vocabulary tracking and explicit Ghostwriter instructions to prevent overused words, repetitive phrases, and AI cliches. Automatically regenerates truncated chapters.
- **Series World Bible Propagation**: Carries forward accumulated world-building knowledge across multi-book series, extracting and injecting elements into Ghostwriter for continuity.
- **Proactive Quality Prevention**: Enhanced vocabulary tracking, transition validation (SmartEditor penalizes abrupt scene changes), and Chekhov's Gun validation (SmartEditor penalizes objects used without prior establishment).
- **LitAgents 2.9 (Log-Analysis Improvements)**: SmartEditor detects spatial/temporal transitions, impossible knowledge, age inconsistencies, and physical attribute changes with severe penalties (LOGIC = 4-6 max). UniversalConsistency tracks character ages (capitulo_edad_establecida) and PERSONAL_ITEM entities (rings, jewelry, watches). Escalated correction system with ultra-specific prompts on 4th retry. ChapterArchitect varies 3-5 scenes organically based on chapter complexity.
- **LitAgents 2.9.1 (Proactive Error Prevention)**: Error history injection into Ghostwriter to avoid repeating past consistency violations. Pre-scene character validation warns if characters in scenePlan are not in World Bible. SmartEditor applies patches even when "approved" for stricter quality. Ghostwriter pre-validates scenes detecting truncation (missing punctuation, <150 words). Unified 15-cycle limit for all review flows. "Reiniciar Correcciones" button to reset revision cycle and retry from scratch.
- **LitAgents 2.9.2 (Regression Rollback & Validation)**: Automatic chapter snapshot system stores content before corrections. If score drops by 2+ points between cycles, automatically rolls back affected chapters to pre-correction state and skips corrections that cycle. New "Canonical Elements" section in correction prompts explicitly lists physical traits, locations, timeline events, and objects that MUST NOT be modified. Post-correction validation detects potential regressions (changed eye colors, resurrected dead characters, removed locations) and logs warnings before saving.
- **LitAgents 2.9.3 (Surgical-First Corrections)**: ALWAYS uses surgicalFix (parches quirúrgicos) FIRST for ALL issue types, even critical/major. fullRewrite only used as absolute last resort when patches fail completely. This prevents corrections from damaging chapters by rewriting too much content. Detailed correction visibility: cycle summary shows issue counts/severity/categories, per-chapter logs show top 3 problems before correction with severity and category.
- **Enhanced Error Recovery**: All orchestrator errors result in a "paused" status for easy resume, preserving state and providing activity logs with context.
- **Death Tracking & Loop Prevention**: UniversalConsistency tracks character deaths to prevent resurrections. Loop detection system escalates recurring issues, with automatic scope expansion for persistent resurrection errors.
- **Structural Issue Detection**: Identifies and auto-resolves structural issues (e.g., chapter reordering, renaming) to prevent infinite rewrite loops, notifying the user for manual intervention.
- **Re-editor (Development Editor)**: Transforms Re-editor into a Development Editor with forensic consistency audits and commercial viability analysis (BetaReaderAgent). Features surgical fix optimization to minimize token consumption.

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