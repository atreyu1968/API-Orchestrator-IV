# LitAgents - Autonomous Literary Agent Orchestration System

## Overview

LitAgents is a Node.js application that orchestrates 4 autonomous AI literary agents using Google's Gemini 3 Pro model with advanced reasoning capabilities. The system manages the complete novel-writing workflow from plot planning to final manuscript production.

The application features:
- **9 Specialized AI Agents**: 
  - **Core Pipeline**: Architect (plot planning), Ghostwriter (prose writing), Editor (quality auditing), Copy Editor (style polishing)
  - **Structural Fixer** (NEW): Automatically corrects plot holes, incomplete arcs, contradictions, and unresolved subplots detected by ArchitectAnalyzer
  - **3-Layer QA System**: Continuity Sentinel (every 5 chapters - temporal/spatial/state drift detection), Voice & Rhythm Auditor (10-chapter tranches - tonal consistency and pacing), Semantic Repetition Detector (manuscript-wide - idea repetition and foreshadowing payoff tracking)
  - **Final Reviewer**: End-to-end manuscript validation
- **World Bible System**: Persistent memory for characters, locations, timeline events, and lore rules
- **Thought Signature Logging**: Captures AI reasoning processes for auditing how decisions were made
- **Real-time Dashboard**: Monitors agent status, chapter progress, and console output
- **Refinement Loops**: Automatic rejection and rewriting of chapters that don't meet quality thresholds
- **Auto-Recovery System**: Heartbeat monitoring detects frozen generations (8 min inactivity) and automatically restarts them with logging
- **Imported Manuscripts**: Upload external Word documents in 6 languages (EN, FR, DE, IT, PT, CA), automatically parse chapters, and professionally edit them using the CopyEditor agent with token cost tracking

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React with TypeScript
- **Build Tool**: Vite with custom configuration for Replit environment
- **Routing**: Wouter for lightweight client-side routing
- **State Management**: TanStack Query for server state and caching
- **UI Components**: shadcn/ui component library with Radix UI primitives
- **Styling**: Tailwind CSS with custom theme using CSS variables for light/dark mode
- **Design System**: Microsoft Fluent Design approach - productivity-focused with clear typography hierarchy (Inter for UI, JetBrains Mono for logs, Merriweather for manuscripts)

### Backend Architecture
- **Runtime**: Node.js with Express
- **Language**: TypeScript with ES modules
- **API Pattern**: RESTful endpoints with Server-Sent Events (SSE) for real-time updates
- **Agent System**: Modular agent classes extending a BaseAgent abstract class
  - Each agent has specialized system prompts optimized for Gemini 3's reasoning mode
  - Orchestrator manages the pipeline flow between agents
  - Refinement loops (max 3 attempts) allow the Editor agent to reject and trigger rewrites
  - **Critical**: Editor feedback (continuity errors, verisimilitude problems, missing beats, repeated phrases, style violations) is explicitly passed to Ghostwriter during rewrites via `buildRefinementInstructions()`

### Data Storage
- **Database**: PostgreSQL with Drizzle ORM
- **Schema Location**: `shared/schema.ts` contains all table definitions
- **Key Tables**:
  - `projects`: Novel projects with genre, tone, chapter count, and series settings (workType, seriesId, seriesOrder)
  - `chapters`: Individual chapter content with status tracking
  - `worldBibles`: JSON storage for characters, timeline, rules, and plot outlines
  - `thoughtLogs`: AI reasoning signatures for each agent action
  - `agentStatuses`: Real-time status tracking for dashboard display
  - `series`: Groups projects into series/trilogies for continuity (includes `seriesGuide` for uploaded Word documents with series-wide plot guidance)
  - `continuitySnapshots`: Stores summaries of completed works for AI continuity (8-12k tokens)
  - `importedManuscripts`: External manuscript uploads with language and status tracking
  - `importedChapters`: Chapters parsed from uploaded manuscripts with original/edited content and token usage

### AI Integration
- **Model**: Gemini 3 Pro Preview via Replit AI Integrations
- **Configuration**: 
  - `thinkingConfig.thinkingBudget: 10000` for deep reasoning
  - `temperature: 1.0` and `topP: 0.95` for creative output
- **Client Setup**: Uses `@google/genai` SDK with Replit's proxy endpoints (no external API key required)

### Build System
- **Development**: `tsx` for TypeScript execution with hot reload
- **Production**: esbuild bundles server code, Vite builds client assets
- **Output**: Combined into `dist/` directory with static files in `dist/public/`

## External Dependencies

### AI Services
- **Replit AI Integrations**: Provides Gemini API access through environment variables:
  - `AI_INTEGRATIONS_GEMINI_API_KEY`
  - `AI_INTEGRATIONS_GEMINI_BASE_URL`
- Models used: `gemini-3-pro-preview` for text generation, `gemini-2.5-flash-image` for image generation

### Database
- **PostgreSQL**: Connection via `DATABASE_URL` environment variable
- **Drizzle Kit**: Database migrations stored in `migrations/` directory

### Key NPM Packages
- `@google/genai`: Gemini AI SDK
- `drizzle-orm` / `drizzle-zod`: Database ORM with Zod schema validation
- `express`: HTTP server framework
- `@tanstack/react-query`: Async state management
- `wouter`: Client-side routing
- Radix UI primitives: Accessible component foundations

## Recent Changes (2026-01-07)

### Pipeline Optimization IMPLEMENTED

The re-edit pipeline has been optimized to reduce token consumption by 40-60%:

**NEW Optimized Flow (ACTIVE)**:
1. **Editor Review** → Initial quality assessment of all chapters
2. **World Bible Extraction** → Extract characters, locations, timeline, lore
3. **Architect Analysis** → Detect structural issues (plot holes, contradictions, incomplete arcs)
4. **QA Agents** (MOVED BEFORE REWRITING) → Run all 4 QA agents: Continuity Sentinel, Voice & Rhythm, Semantic Repetition, Anachronism Detector
5. **consolidateAllProblems()** → Merge Architect + QA findings by chapter into unified problem list
6. **SINGLE NarrativeRewriter Pass** → One consolidated rewriting pass fixing ALL problems (structural + QA)
7. **CopyEditor** (OPTIMIZED) → Only processes chapters NOT rewritten (rewritten chapters skip this stage)
8. **Final Review** → Bestseller validation with 9+ consecutive score logic

**Key Optimizations**:
- Eliminated redundant `qa_corrections` stage (was a second NarrativeRewriter pass)
- CopyEditor now skips chapters that were already rewritten by NarrativeRewriter
- Single consolidated rewrite addresses both Architect structural issues AND QA problems
- Rewritten chapters get `editedContent` set directly, bypassing CopyEditor entirely

**Expected Token Savings**: 40-60% reduction in token usage for manuscripts with significant issues

### Previous Bug Fixes (2026-01-06)
- **Integer score validation**: Added `Math.round()` to all audit report scores to prevent database errors
- **Spanish accent support in severities**: Extended severity matching to include both "critica" and "crítica"
- **consolidateAllProblems() function**: Helper function to merge Architect + QA findings by chapter

### Project Status
- Project 4 "La superficie rota": COMPLETED (65 chapters, 97,683 words, score 9/10, "muy alto potencial de mercado")
- Pipeline optimization: IMPLEMENTED and ready for next project