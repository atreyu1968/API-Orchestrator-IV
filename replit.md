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
- **Model**: Gemini 3 Pro Preview, accessed via Replit AI Integrations.
- **Configuration**: Uses `thinkingBudget: 10000` for deep reasoning and `temperature: 1.0`, `topP: 0.95` for creative output.
- **Client Setup**: Utilizes the `@google/genai` SDK with Replit's proxy, eliminating the need for an external API key.

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

## External Dependencies

### AI Services
- **Replit AI Integrations**: Provides access to the Gemini API using `AI_INTEGRATIONS_GEMINI_API_KEY` and `AI_INTEGRATIONS_GEMINI_BASE_URL` environment variables.
- **Models**: `gemini-3-pro-preview` for text generation, `gemini-2.5-flash-image` for image generation.

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