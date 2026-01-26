// LitAgents 2.0 - Scene-Based Orchestrator
// Implements the new pipeline: Global Architect → Chapter Architect → Ghostwriter (scene by scene) → Smart Editor → Patcher → Summarizer → Narrative Director

import { storage } from "./storage";
import {
  GlobalArchitectAgent,
  ChapterArchitectAgent,
  GhostwriterV2Agent,
  SmartEditorAgent,
  SummarizerAgent,
  NarrativeDirectorAgent,
  type GlobalArchitectOutput,
  type ChapterArchitectOutput,
  type SmartEditorOutput,
  type NarrativeDirectorOutput,
  type PlotThread as AgentPlotThread,
  type ScenePlan
} from "./agents/v2";
import { applyPatches, type PatchResult } from "./utils/patcher";
import type { TokenUsage } from "./agents/base-agent";
import type { Project, Chapter, InsertPlotThread } from "@shared/schema";
import { isProjectCancelledFromDb } from "./agents";

interface OrchestratorV2Callbacks {
  onAgentStatus: (role: string, status: string, message?: string) => void;
  onChapterComplete: (chapterNumber: number, wordCount: number, chapterTitle: string) => void;
  onSceneComplete: (chapterNumber: number, sceneNumber: number, wordCount: number) => void;
  onProjectComplete: () => void;
  onError: (error: string) => void;
}

export class OrchestratorV2 {
  private globalArchitect = new GlobalArchitectAgent();
  private chapterArchitect = new ChapterArchitectAgent();
  private ghostwriter = new GhostwriterV2Agent();
  private smartEditor = new SmartEditorAgent();
  private summarizer = new SummarizerAgent();
  private narrativeDirector = new NarrativeDirectorAgent();
  private callbacks: OrchestratorV2Callbacks;
  
  private cumulativeTokens = {
    inputTokens: 0,
    outputTokens: 0,
    thinkingTokens: 0,
  };

  constructor(callbacks: OrchestratorV2Callbacks) {
    this.callbacks = callbacks;
  }

  private addTokenUsage(usage?: TokenUsage) {
    if (usage) {
      this.cumulativeTokens.inputTokens += usage.inputTokens || 0;
      this.cumulativeTokens.outputTokens += usage.outputTokens || 0;
      this.cumulativeTokens.thinkingTokens += usage.thinkingTokens || 0;
    }
  }

  private async updateProjectTokens(projectId: number) {
    await storage.updateProject(projectId, {
      totalInputTokens: this.cumulativeTokens.inputTokens,
      totalOutputTokens: this.cumulativeTokens.outputTokens,
      totalThinkingTokens: this.cumulativeTokens.thinkingTokens,
    });
  }

  private generateTitleFromHook(hookOrBeat: string): string {
    if (!hookOrBeat || hookOrBeat.length < 3) return "";
    
    // Clean and truncate the hook to create a title
    let title = hookOrBeat.trim();
    
    // Remove common prefixes
    title = title.replace(/^(el |la |los |las |un |una |unos |unas )/i, "");
    
    // Capitalize first letter
    title = title.charAt(0).toUpperCase() + title.slice(1);
    
    // Truncate to reasonable length (max 50 chars for a title)
    if (title.length > 50) {
      const lastSpace = title.lastIndexOf(" ", 50);
      title = title.slice(0, lastSpace > 20 ? lastSpace : 50) + "...";
    }
    
    // Remove trailing punctuation except ellipsis
    title = title.replace(/[.,;:!?]+$/, "");
    
    return title || "Sin título";
  }

  async generateNovel(project: Project): Promise<void> {
    console.log(`[OrchestratorV2] Starting novel generation for "${project.title}" (ID: ${project.id})`);
    
    try {
      // Update project status
      await storage.updateProject(project.id, { status: "generating" });

      // Fetch extended guide if exists
      let extendedGuideContent: string | undefined;
      if (project.extendedGuideId) {
        const extendedGuide = await storage.getExtendedGuide(project.extendedGuideId);
        if (extendedGuide) {
          extendedGuideContent = extendedGuide.content;
          console.log(`[OrchestratorV2] Loaded extended guide: ${extendedGuide.title} (${extendedGuide.wordCount} words)`);
        }
      }

      // Fetch style guide - first check project, then pseudonym's active guide
      let styleGuideContent: string | undefined;
      if (project.styleGuideId) {
        const styleGuide = await storage.getStyleGuide(project.styleGuideId);
        if (styleGuide) {
          styleGuideContent = styleGuide.content;
          console.log(`[OrchestratorV2] Loaded project style guide`);
        }
      } else if (project.pseudonymId) {
        // Get the active style guide from the pseudonym
        const pseudonymGuides = await storage.getStyleGuidesByPseudonym(project.pseudonymId);
        const activeGuide = pseudonymGuides.find(g => g.isActive);
        if (activeGuide) {
          styleGuideContent = activeGuide.content;
          console.log(`[OrchestratorV2] Loaded pseudonym's active style guide: ${activeGuide.title}`);
        }
      }

      // Fetch series info if this is part of a series
      let seriesName: string | undefined;
      let previousBooksContext: string | undefined;
      if (project.seriesId) {
        const series = await storage.getSeries(project.seriesId);
        if (series) {
          seriesName = series.title;
          console.log(`[OrchestratorV2] Part of series: ${series.title}, Book #${project.seriesOrder}`);
          
          // Get context from previous books in the series
          if (project.seriesOrder && project.seriesOrder > 1) {
            const seriesProjects = await storage.getProjectsBySeries(project.seriesId);
            const previousBooks = seriesProjects
              .filter(p => p.seriesOrder && p.seriesOrder < project.seriesOrder! && p.status === 'completed')
              .sort((a, b) => (a.seriesOrder || 0) - (b.seriesOrder || 0));
            
            if (previousBooks.length > 0) {
              const contexts: string[] = [];
              for (const prevBook of previousBooks) {
                const prevWorldBible = await storage.getWorldBibleByProject(prevBook.id);
                if (prevWorldBible && prevWorldBible.characters) {
                  const chars = Array.isArray(prevWorldBible.characters) ? prevWorldBible.characters : [];
                  contexts.push(`Libro ${prevBook.seriesOrder}: "${prevBook.title}" - Personajes: ${JSON.stringify(chars.slice(0, 5))}`);
                }
              }
              previousBooksContext = contexts.join('\n');
              console.log(`[OrchestratorV2] Loaded context from ${previousBooks.length} previous books`);
            }
          }
        }
      }

      // Check if World Bible already exists (resuming)
      const existingWorldBible = await storage.getWorldBibleByProject(project.id);
      let outline: Array<{ chapter_num: number; title: string; summary: string; key_event: string; act?: number; emotional_arc?: string }>;
      let worldBible: { characters: any; rules: any };
      
      if (existingWorldBible && existingWorldBible.plotOutline) {
        // Resuming - use existing outline and world bible
        console.log(`[OrchestratorV2] World Bible exists. Resuming chapter generation.`);
        this.callbacks.onAgentStatus("global-architect", "completed", "Using existing structure");
        
        // Load world bible data for agents
        worldBible = {
          characters: existingWorldBible.characters || [],
          rules: existingWorldBible.worldRules || [],
        };
        
        const plotOutline = existingWorldBible.plotOutline as any;
        const rawOutline = (plotOutline.chapterOutlines || []).map((ch: any) => ({
          chapter_num: ch.number,
          title: ch.title || `Capítulo ${ch.number}`,
          summary: ch.summary || "",
          key_event: ch.keyEvents?.[0] || "",
        }));
        
        // Apply chapter number remapping if needed (for prologue/epilogue/author note)
        const totalChapters = rawOutline.length;
        outline = rawOutline.map((ch: any, idx: number) => {
          let actualNumber = ch.chapter_num;
          
          if (project.hasPrologue && idx === 0) {
            actualNumber = 0;
          } else if (project.hasAuthorNote && idx === totalChapters - 1) {
            actualNumber = 999;
          } else if (project.hasEpilogue && (
            (project.hasAuthorNote && idx === totalChapters - 2) ||
            (!project.hasAuthorNote && idx === totalChapters - 1)
          )) {
            actualNumber = 998;
          } else if (project.hasPrologue) {
            actualNumber = idx;
          }
          
          return { ...ch, chapter_num: actualNumber };
        });
        
        console.log(`[OrchestratorV2] Loaded ${outline.length} chapter outlines. Numbers: ${outline.map(c => c.chapter_num).join(', ')}`);
      } else {
        // Phase 1: Global Architecture - create new World Bible
        this.callbacks.onAgentStatus("global-architect", "active", "Designing master structure...");
        
        const globalResult = await this.globalArchitect.execute({
          title: project.title,
          premise: project.premise || "",
          genre: project.genre,
          tone: project.tone,
          chapterCount: project.chapterCount,
          architectInstructions: project.architectInstructions || undefined,
          extendedGuide: extendedGuideContent,
          styleGuide: styleGuideContent,
          hasPrologue: project.hasPrologue,
          hasEpilogue: project.hasEpilogue,
          hasAuthorNote: project.hasAuthorNote,
          workType: project.workType || undefined,
          seriesName,
          seriesOrder: project.seriesOrder || undefined,
          previousBooksContext,
          minWordsPerChapter: project.minWordsPerChapter || undefined,
          maxWordsPerChapter: project.maxWordsPerChapter || undefined,
        });

        if (globalResult.error || !globalResult.parsed) {
          throw new Error(`Global Architect failed: ${globalResult.error || "No parsed output"}`);
        }

        this.addTokenUsage(globalResult.tokenUsage);
        this.callbacks.onAgentStatus("global-architect", "completed", "Master structure complete");

        worldBible = globalResult.parsed.world_bible;
        const rawOutline = globalResult.parsed.outline;
        const plotThreads = globalResult.parsed.plot_threads;

        // Remap chapter numbers to match system convention:
        // Prologue: 0, Normal chapters: 1-N, Epilogue: 998, Author Note: 999
        outline = rawOutline.map((ch, idx) => {
          let actualNumber = ch.chapter_num;
          const totalChapters = rawOutline.length;
          
          if (project.hasPrologue && idx === 0) {
            actualNumber = 0;
          } else if (project.hasAuthorNote && idx === totalChapters - 1) {
            actualNumber = 999;
          } else if (project.hasEpilogue && (
            (project.hasAuthorNote && idx === totalChapters - 2) ||
            (!project.hasAuthorNote && idx === totalChapters - 1)
          )) {
            actualNumber = 998;
          } else if (project.hasPrologue) {
            actualNumber = idx;
          }
          
          return { ...ch, chapter_num: actualNumber };
        });

        // Store World Bible with timeline derived from outline
        const timeline = outline.map(ch => ({
          chapter: ch.chapter_num,
          title: ch.title,
          events: [ch.key_event],
          summary: ch.summary,
          act: ch.act || (ch.chapter_num <= Math.ceil(outline.length * 0.25) ? 1 : 
                          ch.chapter_num <= Math.ceil(outline.length * 0.75) ? 2 : 3),
        }));

        await storage.createWorldBible({
          projectId: project.id,
          characters: worldBible.characters as any,
          worldRules: worldBible.rules as any,
          timeline: timeline as any,
          plotOutline: {
            chapterOutlines: outline.map(ch => ({
              number: ch.chapter_num,
              summary: ch.summary,
              keyEvents: [ch.key_event],
            })),
            threeActStructure: globalResult.parsed.three_act_structure || null,
            plotThreads: plotThreads.map(t => ({
              name: t.name,
              description: t.description,
              goal: t.goal,
            })),
          } as any,
        });

        // Store Plot Threads for Narrative Director
        for (const thread of plotThreads) {
          await storage.createPlotThread({
            projectId: project.id,
            name: thread.name,
            description: thread.description || null,
            goal: thread.goal,
            status: "active",
            intensityScore: 5,
            lastUpdatedChapter: 0,
          });
        }
      }

      // Get style guide
      let guiaEstilo = "";
      if (project.styleGuideId) {
        const styleGuide = await storage.getStyleGuide(project.styleGuideId);
        if (styleGuide) {
          guiaEstilo = styleGuide.content;
        }
      }

      // Phase 2: Generate each chapter
      let rollingSummary = "Inicio de la novela.";
      const chapterSummaries: string[] = [];

      // Check for existing chapters to resume from
      const existingChapters = await storage.getChaptersByProject(project.id);
      const completedChapterNumbers = new Set(
        existingChapters
          .filter(c => c.status === "completed" || c.status === "approved")
          .map(c => c.chapterNumber)
      );
      
      if (completedChapterNumbers.size > 0) {
        console.log(`[OrchestratorV2] Found ${completedChapterNumbers.size} completed chapters. Resuming from where we left off.`);
        
        // Load existing summaries for context
        for (const chapter of existingChapters.sort((a, b) => a.chapterNumber - b.chapterNumber)) {
          if (chapter.summary) {
            chapterSummaries.push(chapter.summary);
            rollingSummary = chapter.summary;
          }
        }
      }

      for (let i = 0; i < outline.length; i++) {
        if (await isProjectCancelledFromDb(project.id)) {
          console.log(`[OrchestratorV2] Project ${project.id} was cancelled`);
          return;
        }

        const chapterOutline = outline[i];
        const chapterNumber = chapterOutline.chapter_num;

        // Skip already completed chapters
        if (completedChapterNumbers.has(chapterNumber)) {
          console.log(`[OrchestratorV2] Skipping Chapter ${chapterNumber} (already completed)`);
          continue;
        }

        console.log(`[OrchestratorV2] Generating Chapter ${chapterNumber}: "${chapterOutline.title}"`);

        // 2a: Chapter Architect - Plan scenes
        this.callbacks.onAgentStatus("chapter-architect", "active", `Planning scenes for Chapter ${chapterNumber}...`);
        
        const previousSummary = i > 0 ? chapterSummaries[i - 1] : "";
        const storyState = rollingSummary;

        const chapterPlan = await this.chapterArchitect.execute({
          chapterOutline,
          worldBible,
          previousChapterSummary: previousSummary,
          storyState,
        });

        if (chapterPlan.error || !chapterPlan.parsed) {
          throw new Error(`Chapter Architect failed for Chapter ${chapterNumber}: ${chapterPlan.error || "No parsed output"}`);
        }

        this.addTokenUsage(chapterPlan.tokenUsage);
        this.callbacks.onAgentStatus("chapter-architect", "completed", `${chapterPlan.parsed.scenes.length} scenes planned`);

        const sceneBreakdown = chapterPlan.parsed;

        // 2b: Ghostwriter - Write scene by scene
        let fullChapterText = "";
        let lastContext = "";

        for (const scene of sceneBreakdown.scenes) {
          if (await isProjectCancelledFromDb(project.id)) {
            console.log(`[OrchestratorV2] Project ${project.id} was cancelled during scene writing`);
            return;
          }

          this.callbacks.onAgentStatus("ghostwriter-v2", "active", `Writing Scene ${scene.scene_num}...`);

          const sceneResult = await this.ghostwriter.execute({
            scenePlan: scene,
            prevSceneContext: lastContext,
            rollingSummary,
            worldBible,
            guiaEstilo,
          });

          if (sceneResult.error) {
            console.error(`[OrchestratorV2] Scene ${scene.scene_num} failed:`, sceneResult.error);
            continue; // Try to continue with next scene
          }

          this.addTokenUsage(sceneResult.tokenUsage);
          
          fullChapterText += "\n\n" + sceneResult.content;
          lastContext = sceneResult.content.slice(-1500); // Keep last 1500 chars for context

          const sceneWordCount = sceneResult.content.split(/\s+/).length;
          this.callbacks.onSceneComplete(chapterNumber, scene.scene_num, sceneWordCount);
        }

        this.callbacks.onAgentStatus("ghostwriter-v2", "completed", "All scenes written");

        // 2c: Smart Editor - Evaluate and patch
        this.callbacks.onAgentStatus("smart-editor", "active", "Evaluating chapter...");

        const editResult = await this.smartEditor.execute({
          chapterContent: fullChapterText,
          sceneBreakdown,
          worldBible,
        });

        this.addTokenUsage(editResult.tokenUsage);

        let finalText = fullChapterText;
        let editorFeedback: SmartEditorOutput | null = null;

        if (editResult.parsed) {
          editorFeedback = editResult.parsed;

          if (editResult.parsed.is_approved) {
            this.callbacks.onAgentStatus("smart-editor", "completed", `Approved: ${editResult.parsed.logic_score}/10 Logic, ${editResult.parsed.style_score}/10 Style`);
          } else if (editResult.parsed.patches && editResult.parsed.patches.length > 0) {
            // Apply patches
            this.callbacks.onAgentStatus("smart-editor", "active", `Applying ${editResult.parsed.patches.length} patches...`);
            
            const patchResult = applyPatches(fullChapterText, editResult.parsed.patches);
            finalText = patchResult.patchedText;

            console.log(`[OrchestratorV2] Patch results: ${patchResult.appliedPatches}/${editResult.parsed.patches.length} applied`);
            patchResult.log.forEach(log => console.log(`  ${log}`));

            this.callbacks.onAgentStatus("smart-editor", "completed", `${patchResult.appliedPatches} patches applied`);
          } else if (editResult.parsed.needs_rewrite) {
            console.log(`[OrchestratorV2] Chapter ${chapterNumber} needs rewrite, but continuing with current version`);
            this.callbacks.onAgentStatus("smart-editor", "completed", "Needs improvement (continuing)");
          }
        }

        // 2d: Summarizer - Compress for memory
        this.callbacks.onAgentStatus("summarizer", "active", "Compressing for memory...");

        const summaryResult = await this.summarizer.execute({
          chapterContent: finalText,
          chapterNumber,
        });

        this.addTokenUsage(summaryResult.tokenUsage);

        const chapterSummary = summaryResult.content || `Chapter ${chapterNumber} completed.`;
        chapterSummaries.push(chapterSummary);

        // Update rolling summary (keep last 3 chapters for context)
        const recentSummaries = chapterSummaries.slice(-3);
        rollingSummary = recentSummaries.map((s, idx) => `Cap ${chapterNumber - (recentSummaries.length - 1 - idx)}: ${s}`).join("\n");

        this.callbacks.onAgentStatus("summarizer", "completed", "Chapter compressed");

        // Save chapter to database
        const wordCount = finalText.split(/\s+/).length;
        
        await storage.createChapter({
          projectId: project.id,
          chapterNumber,
          title: chapterOutline.title,
          content: finalText,
          wordCount,
          status: "approved",
          sceneBreakdown: sceneBreakdown as any,
          summary: chapterSummary,
          editorFeedback: editorFeedback as any,
          qualityScore: editorFeedback ? Math.round((editorFeedback.logic_score + editorFeedback.style_score) / 2) : null,
        });

        await storage.updateProject(project.id, { currentChapter: chapterNumber });
        this.callbacks.onChapterComplete(chapterNumber, wordCount, chapterOutline.title);

        // 2e: Narrative Director - Check every 5 chapters
        if (chapterNumber > 0 && chapterNumber % 5 === 0) {
          await this.runNarrativeDirector(project.id, chapterNumber, project.chapterCount, chapterSummaries);
        }

        // Update token counts
        await this.updateProjectTokens(project.id);
      }

      // Complete
      await storage.updateProject(project.id, { status: "completed" });
      this.callbacks.onProjectComplete();

    } catch (error) {
      console.error(`[OrchestratorV2] Error:`, error);
      this.callbacks.onError(error instanceof Error ? error.message : String(error));
      await storage.updateProject(project.id, { status: "error" });
    }
  }

  private async runNarrativeDirector(
    projectId: number,
    currentChapter: number,
    totalChapters: number,
    chapterSummaries: string[]
  ): Promise<void> {
    this.callbacks.onAgentStatus("narrative-director", "active", "Analyzing story progress...");

    // Get plot threads from database
    const dbThreads = await storage.getPlotThreadsByProject(projectId);
    const plotThreads: AgentPlotThread[] = dbThreads.map(t => ({
      name: t.name,
      status: t.status,
      goal: t.goal || "",
      lastUpdatedChapter: t.lastUpdatedChapter || 0,
    }));

    // Get recent summaries
    const recentSummaries = chapterSummaries.slice(-5).map((s, idx) => {
      const chapNum = currentChapter - (chapterSummaries.slice(-5).length - 1 - idx);
      return `Capítulo ${chapNum}: ${s}`;
    }).join("\n\n");

    const result = await this.narrativeDirector.execute({
      recentSummaries,
      plotThreads,
      currentChapter,
      totalChapters,
    });

    this.addTokenUsage(result.tokenUsage);

    if (result.parsed) {
      console.log(`[OrchestratorV2] Narrative Director directive: ${result.parsed.directive}`);
      
      // Update thread statuses if needed
      if (result.parsed.thread_updates) {
        for (const update of result.parsed.thread_updates) {
          const thread = dbThreads.find(t => t.name === update.name);
          if (thread) {
            await storage.updatePlotThread(thread.id, {
              status: update.new_status,
              lastUpdatedChapter: currentChapter,
            });
          }
        }
      }

      this.callbacks.onAgentStatus("narrative-director", "completed", `Tension: ${result.parsed.tension_level}/10`);
    } else {
      this.callbacks.onAgentStatus("narrative-director", "completed", "Analysis complete");
    }
  }

  /**
   * Generate a single chapter using the V2 pipeline
   */
  async generateSingleChapter(
    project: Project,
    chapterOutline: {
      chapter_num: number;
      title: string;
      summary: string;
      key_event: string;
      emotional_arc?: string;
    },
    worldBible: any,
    previousChapterSummary: string,
    rollingSummary: string,
    guiaEstilo: string
  ): Promise<{ content: string; summary: string; wordCount: number; sceneBreakdown: ChapterArchitectOutput }> {
    
    // Plan scenes
    const chapterPlan = await this.chapterArchitect.execute({
      chapterOutline,
      worldBible,
      previousChapterSummary,
      storyState: rollingSummary,
    });

    if (!chapterPlan.parsed) {
      throw new Error("Chapter planning failed");
    }

    const sceneBreakdown = chapterPlan.parsed;

    // Write scenes
    let fullChapterText = "";
    let lastContext = "";

    for (const scene of sceneBreakdown.scenes) {
      const sceneResult = await this.ghostwriter.execute({
        scenePlan: scene,
        prevSceneContext: lastContext,
        rollingSummary,
        worldBible,
        guiaEstilo,
      });

      if (!sceneResult.error) {
        fullChapterText += "\n\n" + sceneResult.content;
        lastContext = sceneResult.content.slice(-1500);
      }
    }

    // Edit
    const editResult = await this.smartEditor.execute({
      chapterContent: fullChapterText,
      sceneBreakdown,
      worldBible,
    });

    let finalText = fullChapterText;
    if (editResult.parsed?.patches && editResult.parsed.patches.length > 0) {
      const patchResult = applyPatches(fullChapterText, editResult.parsed.patches);
      finalText = patchResult.patchedText;
    }

    // Summarize
    const summaryResult = await this.summarizer.execute({
      chapterContent: finalText,
      chapterNumber: chapterOutline.chapter_num,
    });

    return {
      content: finalText,
      summary: summaryResult.content || "",
      wordCount: finalText.split(/\s+/).length,
      sceneBreakdown,
    };
  }

  /**
   * Run final review only - V2 simplified version
   * V2 pipeline handles editing during generation, so this mainly validates and marks complete
   */
  async runFinalReviewOnly(project: Project): Promise<void> {
    console.log(`[OrchestratorV2] Running final review for project ${project.id}`);
    
    try {
      this.callbacks.onAgentStatus("smart-editor", "active", "Ejecutando revisión final v2...");
      
      const chapters = await storage.getChaptersByProject(project.id);
      const completedChapters = chapters.filter(c => c.status === "completed" || c.status === "approved");
      
      if (completedChapters.length === 0) {
        this.callbacks.onError("No hay capítulos completados para revisar");
        return;
      }

      const worldBible = await storage.getWorldBibleByProject(project.id);
      if (!worldBible) {
        this.callbacks.onError("No se encontró la World Bible para este proyecto");
        return;
      }

      const worldBibleData = {
        characters: worldBible.characters || [],
        rules: worldBible.worldRules || [],
      };

      let totalScore = 0;
      let reviewedCount = 0;

      // Review each chapter with Smart Editor
      for (let i = 0; i < completedChapters.length; i++) {
        const chapter = completedChapters[i];
        
        if (await isProjectCancelledFromDb(project.id)) {
          console.log(`[OrchestratorV2] Final review cancelled for project ${project.id}`);
          await this.updateProjectTokens(project.id);
          await storage.updateProject(project.id, { status: "paused" });
          return;
        }

        this.callbacks.onAgentStatus("smart-editor", "active", `Revisando capítulo ${chapter.chapterNumber} (${i + 1}/${completedChapters.length})...`);

        const editResult = await this.smartEditor.execute({
          chapterContent: chapter.content || "",
          sceneBreakdown: chapter.sceneBreakdown as any || { scenes: [] },
          worldBible: worldBibleData,
        });

        this.addTokenUsage(editResult.tokenUsage);

        if (editResult.parsed) {
          const avgScore = (editResult.parsed.logic_score + editResult.parsed.style_score) / 2;
          totalScore += avgScore;
          reviewedCount++;

          // Always update quality score
          const updateData: any = { qualityScore: Math.round(avgScore) };

          // Apply patches if needed
          if (editResult.parsed.patches && editResult.parsed.patches.length > 0) {
            const patchResult = applyPatches(chapter.content || "", editResult.parsed.patches);
            if (patchResult.appliedPatches > 0) {
              updateData.content = patchResult.patchedText;
              updateData.wordCount = patchResult.patchedText.split(/\s+/).length;
            }
          }

          await storage.updateChapter(chapter.id, updateData);
          
          // Emit chapter complete callback
          const wordCount = updateData.content 
            ? updateData.content.split(/\s+/).length 
            : (chapter.content?.split(/\s+/).length || 0);
          this.callbacks.onChapterComplete(
            chapter.chapterNumber,
            wordCount,
            chapter.title || `Capítulo ${chapter.chapterNumber}`
          );
        }
      }

      await this.updateProjectTokens(project.id);

      const averageScore = reviewedCount > 0 ? totalScore / reviewedCount : 0;
      const approved = averageScore >= 7;

      await storage.updateProject(project.id, { 
        status: approved ? "completed" : "failed_final_review",
        finalReviewResult: { 
          approved, 
          averageScore: Math.round(averageScore * 10) / 10,
          chaptersReviewed: reviewedCount,
        }
      });

      if (approved) {
        this.callbacks.onAgentStatus("smart-editor", "completed", `Revisión aprobada (${averageScore.toFixed(1)}/10)`);
        this.callbacks.onProjectComplete();
      } else {
        this.callbacks.onAgentStatus("smart-editor", "error", `Puntuación insuficiente (${averageScore.toFixed(1)}/10)`);
        this.callbacks.onError(`El manuscrito obtuvo ${averageScore.toFixed(1)}/10, por debajo del mínimo de 7`);
      }
    } catch (error) {
      console.error("[OrchestratorV2] Final review error:", error);
      this.callbacks.onError(error instanceof Error ? error.message : String(error));
      await storage.updateProject(project.id, { status: "error" });
    }
  }

  /**
   * Extend novel by generating additional chapters
   */
  async extendNovel(project: Project, fromChapter: number, toChapter: number): Promise<void> {
    console.log(`[OrchestratorV2] Extending project ${project.id} from chapter ${fromChapter + 1} to ${toChapter}`);
    
    try {
      const worldBible = await storage.getWorldBibleByProject(project.id);
      if (!worldBible || !worldBible.plotOutline) {
        this.callbacks.onError("No se encontró la World Bible con escaleta para este proyecto");
        await storage.updateProject(project.id, { status: "error" });
        return;
      }

      const worldBibleData = {
        characters: worldBible.characters || [],
        rules: worldBible.worldRules || [],
      };

      let guiaEstilo = "";
      if (project.styleGuideId) {
        const styleGuide = await storage.getStyleGuide(project.styleGuideId);
        if (styleGuide) guiaEstilo = styleGuide.content;
      }

      // Get existing chapters for context
      const existingChapters = await storage.getChaptersByProject(project.id);
      const sortedChapters = existingChapters
        .filter(c => c.status === "completed" || c.status === "approved")
        .sort((a, b) => a.chapterNumber - b.chapterNumber);

      let rollingSummary = sortedChapters.length > 0 
        ? sortedChapters.slice(-3).map(c => c.summary || `Cap ${c.chapterNumber} completado`).join("\n")
        : "Inicio de la novela.";

      // Generate new chapters from fromChapter+1 to toChapter
      this.callbacks.onAgentStatus("global-architect", "active", `Planificando capítulos ${fromChapter + 1} a ${toChapter}...`);

      // Create outlines for new chapters using Chapter Architect
      for (let chapterNum = fromChapter + 1; chapterNum <= toChapter; chapterNum++) {
        if (await isProjectCancelledFromDb(project.id)) {
          console.log(`[OrchestratorV2] Extension cancelled for project ${project.id}`);
          await this.updateProjectTokens(project.id);
          await storage.updateProject(project.id, { status: "paused" });
          return;
        }

        // Plan scenes first with a generic outline
        const tempOutline = {
          chapter_num: chapterNum,
          title: `Capítulo ${chapterNum}`,
          summary: `Continuación de la historia - Capítulo ${chapterNum}`,
          key_event: "Desarrollo de la trama",
        };

        const previousSummary = rollingSummary;

        // Plan scenes for this chapter
        this.callbacks.onAgentStatus("chapter-architect", "active", `Planificando escenas para Capítulo ${chapterNum}...`);
        
        const chapterPlan = await this.chapterArchitect.execute({
          chapterOutline: tempOutline,
          worldBible: worldBibleData,
          previousChapterSummary: previousSummary,
          storyState: rollingSummary,
        });

        if (!chapterPlan.parsed) {
          console.error(`[OrchestratorV2] Failed to plan chapter ${chapterNum}`);
          continue;
        }

        this.addTokenUsage(chapterPlan.tokenUsage);
        
        // Generate a better title from the chapter hook or first scene
        const generatedTitle = chapterPlan.parsed.chapter_hook 
          ? this.generateTitleFromHook(chapterPlan.parsed.chapter_hook)
          : chapterPlan.parsed.scenes[0]?.plot_beat 
            ? this.generateTitleFromHook(chapterPlan.parsed.scenes[0].plot_beat)
            : `Capítulo ${chapterNum}`;
        
        const chapterOutline = {
          ...tempOutline,
          title: generatedTitle,
        };

        // Write scenes
        let fullChapterText = "";
        let lastContext = "";
        let scenesCancelled = false;

        for (const scene of chapterPlan.parsed.scenes) {
          // Check cancellation before each scene
          if (await isProjectCancelledFromDb(project.id)) {
            console.log(`[OrchestratorV2] Extension cancelled during scene writing for project ${project.id}`);
            scenesCancelled = true;
            break;
          }
          
          this.callbacks.onAgentStatus("ghostwriter-v2", "active", `Escribiendo escena ${scene.scene_num}...`);

          const sceneResult = await this.ghostwriter.execute({
            scenePlan: scene,
            prevSceneContext: lastContext,
            rollingSummary,
            worldBible: worldBibleData,
            guiaEstilo,
          });

          if (!sceneResult.error) {
            fullChapterText += "\n\n" + sceneResult.content;
            lastContext = sceneResult.content.slice(-1500);
            this.callbacks.onSceneComplete(chapterNum, scene.scene_num, sceneResult.content?.split(/\s+/).length || 0);
          }

          this.addTokenUsage(sceneResult.tokenUsage);
        }
        
        if (scenesCancelled) {
          await this.updateProjectTokens(project.id);
          await storage.updateProject(project.id, { status: "paused" });
          return;
        }

        // Edit
        const editResult = await this.smartEditor.execute({
          chapterContent: fullChapterText,
          sceneBreakdown: chapterPlan.parsed,
          worldBible: worldBibleData,
        });

        let finalText = fullChapterText;
        if (editResult.parsed?.patches && editResult.parsed.patches.length > 0) {
          const patchResult = applyPatches(fullChapterText, editResult.parsed.patches);
          finalText = patchResult.patchedText;
        }

        this.addTokenUsage(editResult.tokenUsage);

        // Summarize
        const summaryResult = await this.summarizer.execute({
          chapterContent: finalText,
          chapterNumber: chapterNum,
        });

        this.addTokenUsage(summaryResult.tokenUsage);

        const chapterSummary = summaryResult.content || `Capítulo ${chapterNum} completado.`;
        rollingSummary = chapterSummary;

        // Save chapter
        const wordCount = finalText.split(/\s+/).length;
        await storage.createChapter({
          projectId: project.id,
          chapterNumber: chapterNum,
          title: chapterOutline.title,
          content: finalText,
          wordCount,
          status: "approved",
          sceneBreakdown: chapterPlan.parsed as any,
          summary: chapterSummary,
        });

        await storage.updateProject(project.id, { currentChapter: chapterNum });
        this.callbacks.onChapterComplete(chapterNum, wordCount, chapterOutline.title);
        await this.updateProjectTokens(project.id);
      }

      await storage.updateProject(project.id, { status: "completed" });
      this.callbacks.onProjectComplete();

    } catch (error) {
      console.error("[OrchestratorV2] Extension error:", error);
      this.callbacks.onError(error instanceof Error ? error.message : String(error));
      await storage.updateProject(project.id, { status: "error" });
    }
  }

  /**
   * Regenerate truncated chapters
   */
  async regenerateTruncatedChapters(project: Project, minWordCount: number = 100): Promise<void> {
    console.log(`[OrchestratorV2] Regenerating truncated chapters for project ${project.id} (min: ${minWordCount} words)`);
    
    try {
      const chapters = await storage.getChaptersByProject(project.id);
      const truncatedChapters = chapters.filter(ch => {
        const wordCount = ch.content ? ch.content.split(/\s+/).length : 0;
        return wordCount < minWordCount;
      });

      if (truncatedChapters.length === 0) {
        this.callbacks.onAgentStatus("ghostwriter-v2", "completed", "No se encontraron capítulos truncados");
        await storage.updateProject(project.id, { status: "completed" });
        this.callbacks.onProjectComplete();
        return;
      }

      const worldBible = await storage.getWorldBibleByProject(project.id);
      if (!worldBible) {
        this.callbacks.onError("No se encontró la World Bible para este proyecto");
        await storage.updateProject(project.id, { status: "error" });
        return;
      }

      const worldBibleData = {
        characters: worldBible.characters || [],
        rules: worldBible.worldRules || [],
      };

      let guiaEstilo = "";
      if (project.styleGuideId) {
        const styleGuide = await storage.getStyleGuide(project.styleGuideId);
        if (styleGuide) guiaEstilo = styleGuide.content;
      }

      this.callbacks.onAgentStatus("ghostwriter-v2", "active", 
        `Regenerando ${truncatedChapters.length} capítulos truncados`);

      for (let i = 0; i < truncatedChapters.length; i++) {
        if (await isProjectCancelledFromDb(project.id)) {
          console.log(`[OrchestratorV2] Truncated regeneration cancelled for project ${project.id}`);
          await this.updateProjectTokens(project.id);
          await storage.updateProject(project.id, { status: "paused" });
          return;
        }

        const chapter = truncatedChapters[i];

        this.callbacks.onAgentStatus("ghostwriter-v2", "active", 
          `Regenerando capítulo ${chapter.chapterNumber} (${i + 1}/${truncatedChapters.length})`);

        // Get context from previous chapters
        const previousChapters = chapters
          .filter(c => c.chapterNumber < chapter.chapterNumber && c.content)
          .sort((a, b) => a.chapterNumber - b.chapterNumber);
        
        const rollingSummary = previousChapters.slice(-3)
          .map(c => c.summary || `Cap ${c.chapterNumber}: ${c.content?.slice(0, 200)}...`)
          .join("\n");

        const chapterOutline = {
          chapter_num: chapter.chapterNumber,
          title: chapter.title || `Capítulo ${chapter.chapterNumber}`,
          summary: chapter.summary || "Regeneración del capítulo",
          key_event: "Continuación de la historia",
        };

        // Plan new scenes
        const chapterPlan = await this.chapterArchitect.execute({
          chapterOutline,
          worldBible: worldBibleData,
          previousChapterSummary: rollingSummary,
          storyState: rollingSummary,
        });

        if (!chapterPlan.parsed) {
          console.error(`[OrchestratorV2] Failed to plan chapter ${chapter.chapterNumber}`);
          continue;
        }

        this.addTokenUsage(chapterPlan.tokenUsage);

        // Write new scenes
        let fullChapterText = "";
        let lastContext = "";
        let scenesCancelled = false;

        for (const scene of chapterPlan.parsed.scenes) {
          // Check cancellation before each scene
          if (await isProjectCancelledFromDb(project.id)) {
            console.log(`[OrchestratorV2] Truncated regeneration cancelled during scene writing for project ${project.id}`);
            scenesCancelled = true;
            break;
          }
          
          this.callbacks.onAgentStatus("ghostwriter-v2", "active", `Escribiendo escena ${scene.scene_num}...`);
          
          const sceneResult = await this.ghostwriter.execute({
            scenePlan: scene,
            prevSceneContext: lastContext,
            rollingSummary,
            worldBible: worldBibleData,
            guiaEstilo,
          });

          if (!sceneResult.error) {
            fullChapterText += "\n\n" + sceneResult.content;
            lastContext = sceneResult.content.slice(-1500);
          }

          this.addTokenUsage(sceneResult.tokenUsage);
          this.callbacks.onSceneComplete(chapter.chapterNumber, scene.scene_num, sceneResult.content?.split(/\s+/).length || 0);
        }
        
        if (scenesCancelled) {
          await this.updateProjectTokens(project.id);
          await storage.updateProject(project.id, { status: "paused" });
          return;
        }

        // Edit
        const editResult = await this.smartEditor.execute({
          chapterContent: fullChapterText,
          sceneBreakdown: chapterPlan.parsed,
          worldBible: worldBibleData,
        });

        let finalText = fullChapterText;
        if (editResult.parsed?.patches && editResult.parsed.patches.length > 0) {
          const patchResult = applyPatches(fullChapterText, editResult.parsed.patches);
          finalText = patchResult.patchedText;
        }

        this.addTokenUsage(editResult.tokenUsage);

        // Update chapter
        const wordCount = finalText.split(/\s+/).length;
        await storage.updateChapter(chapter.id, {
          content: finalText,
          wordCount,
          status: "approved",
          sceneBreakdown: chapterPlan.parsed as any,
        });

        this.callbacks.onChapterComplete(chapter.chapterNumber, wordCount, chapter.title || `Capítulo ${chapter.chapterNumber}`);
        await this.updateProjectTokens(project.id);
      }

      await storage.updateProject(project.id, { status: "completed" });
      this.callbacks.onProjectComplete();

    } catch (error) {
      console.error("[OrchestratorV2] Truncated regeneration error:", error);
      this.callbacks.onError(error instanceof Error ? error.message : String(error));
      await storage.updateProject(project.id, { status: "error" });
    }
  }

  /**
   * Run continuity sentinel check (simplified v2 version)
   */
  async runContinuitySentinelForce(project: Project): Promise<void> {
    console.log(`[OrchestratorV2] Running continuity sentinel for project ${project.id}`);
    
    try {
      this.callbacks.onAgentStatus("smart-editor", "active", "Ejecutando análisis de continuidad...");

      const chapters = await storage.getChaptersByProject(project.id);
      const worldBible = await storage.getWorldBibleByProject(project.id);
      
      if (!worldBible) {
        this.callbacks.onError("No se encontró la World Bible para este proyecto");
        await storage.updateProject(project.id, { status: "error" });
        return;
      }

      const worldBibleData = {
        characters: worldBible.characters || [],
        rules: worldBible.worldRules || [],
      };

      let guiaEstilo = "";
      if (project.styleGuideId) {
        const styleGuide = await storage.getStyleGuide(project.styleGuideId);
        if (styleGuide) guiaEstilo = styleGuide.content;
      }

      let issuesFound = 0;
      let chaptersFixed = 0;

      const chaptersWithContent = chapters.filter(c => c.content);
      for (let i = 0; i < chaptersWithContent.length; i++) {
        const chapter = chaptersWithContent[i];
        
        if (await isProjectCancelledFromDb(project.id)) {
          console.log(`[OrchestratorV2] Sentinel check cancelled for project ${project.id}`);
          await this.updateProjectTokens(project.id);
          await storage.updateProject(project.id, { status: "paused" });
          return;
        }

        this.callbacks.onAgentStatus("smart-editor", "active", `Analizando capítulo ${chapter.chapterNumber} (${i + 1}/${chaptersWithContent.length})...`);

        const editResult = await this.smartEditor.execute({
          chapterContent: chapter.content || "",
          sceneBreakdown: chapter.sceneBreakdown as any || { scenes: [] },
          worldBible: worldBibleData,
        });

        this.addTokenUsage(editResult.tokenUsage);

        if (editResult.parsed && !editResult.parsed.is_approved) {
          issuesFound++;
          
          if (editResult.parsed.patches && editResult.parsed.patches.length > 0) {
            const patchResult = applyPatches(chapter.content || "", editResult.parsed.patches);
            
            if (patchResult.appliedPatches > 0) {
              await storage.updateChapter(chapter.id, { 
                content: patchResult.patchedText,
                wordCount: patchResult.patchedText.split(/\s+/).length,
              });
              chaptersFixed++;
              this.callbacks.onChapterComplete(
                chapter.chapterNumber, 
                patchResult.patchedText.split(/\s+/).length,
                chapter.title || `Capítulo ${chapter.chapterNumber}`
              );
            }
          }
        }
      }

      await this.updateProjectTokens(project.id);

      if (chaptersFixed > 0) {
        this.callbacks.onAgentStatus("smart-editor", "completed", 
          `Correcciones aplicadas: ${chaptersFixed} capítulos mejorados`);
      } else if (issuesFound > 0) {
        this.callbacks.onAgentStatus("smart-editor", "completed", 
          `Análisis completado: ${issuesFound} capítulos con observaciones menores`);
      } else {
        this.callbacks.onAgentStatus("smart-editor", "completed", 
          "No se encontraron issues de continuidad");
      }

      await storage.updateProject(project.id, { status: "completed" });
      this.callbacks.onProjectComplete();

    } catch (error) {
      console.error("[OrchestratorV2] Sentinel error:", error);
      this.callbacks.onError(error instanceof Error ? error.message : String(error));
      await storage.updateProject(project.id, { status: "error" });
    }
  }
}
