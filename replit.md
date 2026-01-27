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
- **Translation Export Improvements**: Markdown exports strip artifacts, omit dividers, and use localized chapter labels.
- **Immediate Continuity Validation**: Validates chapters after writing, enforcing consistency through targeted rewrites.
- **Mandatory Continuity Constraints**: Ghostwriter receives structured constraints to prevent violations.
- **DeepSeek-Based FinalReviewer with Tranche System**: Divides manuscripts into tranches for cost-efficient review, accumulating context and deduplicating issues.

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

### Re-editor (LitEditors) Development Editor
- **Purpose**: Transforms the Re-editor into a Development Editor with forensic consistency audits and commercial viability analysis.
- **ForensicConsistencyAuditor**: Processes manuscripts in batches, detects 7 violation types, and builds incremental entity states.
- **BetaReaderAgent**: Provides commercial viability analysis with scores and market comparisons.
- **Pipeline Integration**: `forensic_audit` and `beta_reader` stages are integrated into the re-editing pipeline.
- **Database Schema**: New fields in `reedit_projects` for audit results and beta reader reports.

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