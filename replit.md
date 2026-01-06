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

## Recent Changes (2026-01-06)

### Bug Fixes Applied
- **Integer score validation**: Added `Math.round()` to all audit report scores (architectResult.puntuacionArquitectura, continuityResult.puntuacion, voiceResult.puntuacion, semanticResult.puntuacion, anachronismResult.puntuacion, bestsellerScore) to prevent "integer 9.5" database errors
- **Spanish accent support in severities**: Extended severity matching to include both "critica" and "crítica" for proper detection of critical anachronisms
- **consolidateAllProblems() function**: Created helper function to merge Architect + QA findings by chapter (not yet integrated into pipeline flow)

### Pipeline Optimization (PENDING for future projects)

**Current Flow (in-use for project 4 "La superficie rota")**:
1. Editor Review → 2. World Bible → 3. Architect → 4. NarrativeRewriter (Architect fixes) → 5. CopyEditor (all chapters) → 6. QA Agents → 7. QA Corrections → 8. Final Review

**Optimized Flow (to be implemented after project 4 completes)**:
1. Editor Review → 2. World Bible → 3. Architect → 4. QA Agents (MOVED HERE) → 5. consolidateAllProblems() → 6. SINGLE NarrativeRewriter pass → 7. CopyEditor (only non-rewritten chapters) → 8. Final Review

**Expected savings**: 40-60% token reduction by eliminating redundant rewriting passes

### Project Status
- Project 4 "La superficie rota": Processing QA stage (65 chapters, 95,922 words)
- Pipeline optimization deferred to avoid breaking resume state mid-processing