# LitAgents - Autonomous Literary Agent Orchestration System

## Overview

LitAgents is a Node.js application designed for orchestrating autonomous AI literary agents using Google's Gemini 3 Pro. Its primary purpose is to manage the entire novel-writing workflow, from initial plot planning to the production of a final, polished manuscript. The system aims to provide a comprehensive solution for authoring and refining literary works, enhancing efficiency and quality through AI-driven processes.

Key capabilities include:
- Orchestration of 9 specialized AI agents covering plot planning, prose writing, editing, quality assurance, and structural corrections.
- A persistent World Bible system for maintaining consistent lore and character details.
- Logging of AI reasoning processes for transparency and auditing.
- A real-time dashboard for monitoring progress and agent activities.
- Automated refinement loops for re-writing content that does not meet quality standards.
- An auto-recovery system to handle stalled AI generations.
- The ability to import and professionally edit external manuscripts in multiple languages.
- Advanced features like chapter expansion, new chapter insertion, and chapter reordering for narrative optimization.
- An automatic pause system for user intervention and a robust approval logic to ensure high-quality manuscript completion.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React with TypeScript, built using Vite.
- **Routing**: Wouter for client-side navigation.
- **State Management**: TanStack Query for server state and caching.
- **UI Components**: shadcn/ui library leveraging Radix UI primitives.
- **Styling**: Tailwind CSS with a custom theme supporting light/dark modes.
- **Design System**: Adheres to Microsoft Fluent Design principles, emphasizing productivity and clear typography (Inter, JetBrains Mono, Merriweather).

### Backend Architecture
- **Runtime**: Node.js with Express.
- **Language**: TypeScript with ES modules.
- **API Pattern**: RESTful endpoints supplemented with Server-Sent Events (SSE) for real-time updates.
- **Agent System**: Features modular agent classes inheriting from a BaseAgent, each with specialized system prompts optimized for Gemini 3's reasoning mode. An orchestrator manages the pipeline flow, incorporating refinement loops where the Editor agent can trigger rewrites based on detailed feedback.

### Data Storage
- **Database**: PostgreSQL, managed with Drizzle ORM.
- **Schema**: Defined in `shared/schema.ts`.
- **Key Tables**: `projects`, `chapters`, `worldBibles`, `thoughtLogs`, `agentStatuses`, `series`, `continuitySnapshots`, `importedManuscripts`, `importedChapters`. These tables store project metadata, chapter content, world-building elements, AI process logs, real-time status, series information, continuity summaries, and details on imported manuscripts.

### AI Integration
- **Default Provider**: DeepSeek (cost-efficient), with Gemini as optional high-speed alternative.
- **DeepSeek Models**:
  - `deepseek-chat` (V3): Fast model (10-60s response), used for prose generation, editing, translation, and QA checks.
  - `deepseek-reasoner` (R1): Slow reasoning model (5-15min), reserved only for Final Review.
- **Gemini Models**: `gemini-3-pro-preview` for creative, `gemini-2.5-flash` for analysis.
- **Provider Switching**: Users can switch between DeepSeek (economic) and Gemini (fast) via the sidebar selector.
- **Performance Optimization**: Most agents now use V3 (fast) instead of R1 (slow) to reduce processing time from hours to minutes.
- **Configuration**: Uses `temperature: 1.0` for creative output.
- **Client Setup**: Utilizes the `@google/genai` SDK for Gemini or OpenAI-compatible API for DeepSeek.

### Build System
- **Development**: `tsx` for TypeScript execution with hot reload.
- **Production**: `esbuild` for server code bundling and Vite for client asset compilation, outputting to a `dist/` directory.

### Feature Specifications
- **Optimized Pipeline**: Streamlined re-edit pipeline reducing token consumption by consolidating problem detection and rewriting into a single pass.
- **Manuscript Expansion System**: Agents (`ChapterExpansionAnalyzer`, `ChapterExpanderAgent`, `NewChapterGeneratorAgent`) for expanding short chapters and inserting new ones to fill narrative gaps.
- **Chapter Reordering System**: Architect Analyzer can recommend and execute chapter reordering for improved narrative pacing, including automatic renumbering and title updates.
- **Internal Chapter Header Sync**: Automatically updates chapter headers within the content (`originalContent`, `editedContent`) when chapters are reordered or inserted.
- **Automatic Pause System**: The system pauses after multiple non-perfect evaluations, awaiting user instructions.
- **Approval Logic**: Requires a single score of 9+ with no critical issues for project approval, preventing infinite loops on minor issues.
- **Issue Hash Tracking System**: Prevents re-reporting of already resolved issues by generating and tracking unique hashes for issues.
- **Improved Cancellation**: Allows for immediate cancellation of processes, with checks implemented before each chapter correction.
- **Fast-Track Resume System**: Optimizes project resumption from `awaiting_instructions` by skipping unnecessary pipeline stages and directly engaging `runFinalReviewOnly()` with user instructions.
- **Robust Server Restart Recovery**: When the server restarts during active generation, the QueueManager automatically marks incomplete projects as "paused", ensuring `resumeNovel()` is used instead of `generateNovel()`. This prevents regenerating the World Bible from scratch on each restart and allows chapter generation to continue from where it left off.
- **Translation Export Improvements**: Markdown exports now: (1) strip code fences/JSON artifacts from AI output, (2) omit trailing dividers after the last chapter, and (3) use localized chapter labels (Prologue, Epilogue, Author's Note, Chapter) based on project language for 7 languages (es, en, fr, de, it, pt, ca).
- **Immediate Continuity Validation**: Validates each chapter immediately after writing, before the Editor stage. Detects dead characters acting, ignored injuries, and location inconsistencies. If violations are found, forces a targeted rewrite with specific correction instructions before proceeding.
- **Mandatory Continuity Constraints**: The Ghostwriter now receives prominent, structured constraints at the top of its context listing dead characters, active injuries, and last known locations, with clear warnings that violations will trigger automatic rejection.
- **DeepSeek-Based FinalReviewer with Tranche System**: The FinalReviewer uses DeepSeek-reasoner (131k token limit) instead of Gemini for cost efficiency. Full manuscripts are divided into tranches of 8 chapters each, processed sequentially with accumulated context passed between tranches to ensure consistency. Features include:
  - **Accumulated Context**: Each tranche receives a summary of issues found in previous tranches to avoid duplicate reports and detect cross-tranche inconsistencies.
  - **Intelligent Deduplication**: Similar issues from different tranches are merged, with affected chapters combined and issues sorted by severity (critical first).
  - **WorldBible Sync**: After review, plotDecisions and persistentInjuries are saved to WorldBible for continuity enforcement.
  - **Ghostwriter Integration**: Issues with detailed correction instructions are passed to the Ghostwriter, which receives the full context for surgical rewrites.

## External Dependencies

### AI Services
- **DeepSeek**: Primary AI provider for cost efficiency. Uses `DEEPSEEK_API_KEY` environment variable. Optional separate keys: `DEEPSEEK_TRANSLATOR_API_KEY`, `DEEPSEEK_REEDITOR_API_KEY`.
- **Replit AI Integrations**: Provides access to the Gemini API using `AI_INTEGRATIONS_GEMINI_API_KEY` and `AI_INTEGRATIONS_GEMINI_BASE_URL` environment variables.
- **Models**: `deepseek-chat` (V3) and `deepseek-reasoner` (R1) for DeepSeek; `gemini-3-pro-preview` for text generation, `gemini-2.5-flash-image` for image generation.

### Database
- **PostgreSQL**: Accessed via the `DATABASE_URL` environment variable.
- **Drizzle Kit**: Used for database migrations, stored in the `migrations/` directory.

### Key NPM Packages
- `@google/genai`: Google Gemini AI SDK.
- `drizzle-orm` / `drizzle-zod`: ORM for database interaction and Zod for schema validation.
- `express`: Web application framework for Node.js.
- `@tanstack/react-query`: Library for asynchronous state management in React.
- `wouter`: Lightweight routing library for React.
- Radix UI primitives: Core components for building accessible UIs.