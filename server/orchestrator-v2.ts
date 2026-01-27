// LitAgents 2.0 - Scene-Based Orchestrator
// Implements the new pipeline: Global Architect → Chapter Architect → Ghostwriter (scene by scene) → Smart Editor → Patcher → Summarizer → Narrative Director
// LitAgents 2.1: Now with Universal Consistency Module for continuity enforcement

import * as fs from "fs";
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
import { universalConsistencyAgent } from "./agents/v2/universal-consistency";
import { FinalReviewerAgent, type FinalReviewerResult, type FinalReviewIssue } from "./agents/final-reviewer";
import { applyPatches, type PatchResult } from "./utils/patcher";
import type { TokenUsage } from "./agents/base-agent";
import type { Project, Chapter, InsertPlotThread, WorldEntity, WorldRuleRecord, EntityRelationship } from "@shared/schema";
import { consistencyViolations } from "@shared/schema";
import { db } from "./db";
import { eq, and, desc } from "drizzle-orm";
import { isProjectCancelledFromDb, generateGenerationToken, isGenerationTokenValid } from "./agents";
import { calculateRealCost, formatCostForStorage } from "./cost-calculator";

interface OrchestratorV2Callbacks {
  onAgentStatus: (role: string, status: string, message?: string) => void;
  onChapterComplete: (chapterNumber: number, wordCount: number, chapterTitle: string) => void;
  onSceneComplete: (chapterNumber: number, sceneNumber: number, totalScenes: number, wordCount: number) => void;
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
  private finalReviewer = new FinalReviewerAgent();
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

  private async logAiUsage(
    projectId: number,
    agentName: string,
    model: string,
    usage?: TokenUsage,
    chapterNumber?: number
  ) {
    if (!usage) return;
    
    try {
      const costs = calculateRealCost(
        model,
        usage.inputTokens || 0,
        usage.outputTokens || 0,
        usage.thinkingTokens || 0
      );
      
      await storage.createAiUsageEvent({
        projectId,
        agentName,
        model,
        inputTokens: usage.inputTokens || 0,
        outputTokens: usage.outputTokens || 0,
        thinkingTokens: usage.thinkingTokens || 0,
        inputCostUsd: formatCostForStorage(costs.inputCost),
        outputCostUsd: formatCostForStorage(costs.outputCost + costs.thinkingCost),
        totalCostUsd: formatCostForStorage(costs.totalCost),
        chapterNumber,
        operation: "generate",
      });
    } catch (err) {
      console.error(`[OrchestratorV2] Failed to log AI usage for ${agentName}:`, err);
    }
  }

  // ============================================
  // UNIVERSAL CONSISTENCY MODULE INTEGRATION
  // ============================================

  private async initializeConsistencyDatabase(projectId: number, worldBible: any, genre: string): Promise<void> {
    console.log(`[OrchestratorV2] Initializing consistency database for project ${projectId}`);
    
    try {
      console.log(`[OrchestratorV2] Checking existing entities...`);
      const existingEntities = await storage.getWorldEntitiesByProject(projectId);
      if (existingEntities.length > 0) {
        console.log(`[OrchestratorV2] Consistency DB already initialized (${existingEntities.length} entities)`);
        this.callbacks.onAgentStatus("consistency", "completed", `Using ${existingEntities.length} existing entities`);
        return;
      }

      const characters = worldBible.characters || [];
      const rules = worldBible.worldRules || [];
      console.log(`[OrchestratorV2] Extracting entities from ${characters.length} characters and ${rules.length} rules...`);

      const { entities, rules: extractedRules } = await universalConsistencyAgent.extractInitialEntities(
        characters,
        rules,
        genre,
        projectId
      );

      console.log(`[OrchestratorV2] Creating ${entities.length} entities in database...`);
      for (let i = 0; i < entities.length; i++) {
        await storage.createWorldEntity(entities[i]);
        if ((i + 1) % 10 === 0) {
          console.log(`[OrchestratorV2] Created ${i + 1}/${entities.length} entities...`);
        }
      }

      console.log(`[OrchestratorV2] Creating ${extractedRules.length} rules in database...`);
      for (const rule of extractedRules) {
        await storage.createWorldRule(rule);
      }

      console.log(`[OrchestratorV2] Initialized: ${entities.length} entities, ${extractedRules.length} rules`);
      this.callbacks.onAgentStatus("consistency", "completed", `Initialized ${entities.length} entities, ${extractedRules.length} rules`);
    } catch (error) {
      console.error(`[OrchestratorV2] Error initializing consistency database:`, error);
      // Don't fail the entire pipeline for consistency errors - continue without
      this.callbacks.onAgentStatus("consistency", "error", `Error: ${error instanceof Error ? error.message : 'Unknown'}`);
    }
  }

  private async getConsistencyContext(projectId: number): Promise<{
    entities: Array<{ name: string; type: string; attributes: any; status: string; lastSeenChapter?: number }>;
    rules: Array<{ ruleDescription: string; category: string }>;
    relationships: Array<{ subject: string; target: string; relationType: string; meta?: any }>;
  }> {
    const [dbEntities, dbRules, dbRelationships] = await Promise.all([
      storage.getWorldEntitiesByProject(projectId),
      storage.getWorldRulesByProject(projectId),
      storage.getEntityRelationshipsByProject(projectId),
    ]);

    const entityMap = new Map(dbEntities.map(e => [e.id, e.name]));

    return {
      entities: dbEntities.map(e => ({
        name: e.name,
        type: e.type,
        attributes: e.attributes || {},
        status: e.status,
        lastSeenChapter: e.lastSeenChapter || undefined,
      })),
      rules: dbRules.map(r => ({
        ruleDescription: r.ruleDescription,
        category: r.category || 'GENERAL',
      })),
      relationships: dbRelationships.map(r => ({
        subject: entityMap.get(r.subjectId) || `Entity#${r.subjectId}`,
        target: entityMap.get(r.targetId) || `Entity#${r.targetId}`,
        relationType: r.relationType,
        meta: r.meta || {},
      })),
    };
  }

  private async validateAndUpdateConsistency(
    projectId: number,
    chapterNumber: number,
    chapterText: string,
    genre: string
  ): Promise<{ isValid: boolean; error?: string }> {
    const context = await this.getConsistencyContext(projectId);
    
    if (context.entities.length === 0 && context.rules.length === 0) {
      console.log(`[OrchestratorV2] Skipping consistency validation - no context available`);
      return { isValid: true };
    }

    this.callbacks.onAgentStatus("consistency", "active", "Validating continuity...");
    
    const result = await universalConsistencyAgent.validateChapter(
      chapterText,
      genre,
      context.entities,
      context.rules,
      context.relationships,
      chapterNumber
    );

    if (!result.isValid && result.criticalError) {
      await storage.createConsistencyViolation({
        projectId,
        chapterNumber,
        violationType: 'CONTRADICTION',
        severity: 'critical',
        description: result.criticalError,
        affectedEntities: [],
        wasAutoFixed: false,
      });

      this.callbacks.onAgentStatus("consistency", "warning", `Violation: ${result.criticalError}`);
      return { isValid: false, error: result.criticalError };
    }

    if (result.newFacts && result.newFacts.length > 0) {
      for (const fact of result.newFacts) {
        const existing = await storage.getWorldEntityByName(projectId, fact.entityName);
        if (existing) {
          const newAttrs = { ...((existing.attributes as any) || {}), ...fact.update };
          await storage.updateWorldEntity(existing.id, {
            attributes: newAttrs,
            lastSeenChapter: chapterNumber,
          });
        } else {
          await storage.createWorldEntity({
            projectId,
            name: fact.entityName,
            type: fact.entityType || 'CHARACTER',
            attributes: fact.update,
            status: 'active',
            lastSeenChapter: chapterNumber,
          });
        }
      }
      console.log(`[OrchestratorV2] Updated ${result.newFacts.length} facts in consistency DB`);
    }

    if (result.newRules && result.newRules.length > 0) {
      for (const rule of result.newRules) {
        await storage.createWorldRule({
          projectId,
          ruleDescription: rule.ruleDescription,
          category: rule.category,
          isActive: true,
          sourceChapter: chapterNumber,
        });
      }
      console.log(`[OrchestratorV2] Added ${result.newRules.length} new rules`);
    }

    if (result.newRelationships && result.newRelationships.length > 0) {
      const entities = await storage.getWorldEntitiesByProject(projectId);
      const entityNameToId = new Map(entities.map(e => [e.name.toLowerCase(), e.id]));
      
      for (const rel of result.newRelationships) {
        const subjectId = entityNameToId.get(rel.subject.toLowerCase());
        const targetId = entityNameToId.get(rel.target.toLowerCase());
        
        if (subjectId && targetId) {
          await storage.createEntityRelationship({
            projectId,
            subjectId,
            targetId,
            relationType: rel.relationType,
            meta: rel.meta || {},
            sourceChapter: chapterNumber,
          });
        }
      }
      console.log(`[OrchestratorV2] Added ${result.newRelationships.length} new relationships`);
    }

    // Any warning is also a violation that must be corrected
    if (result.warnings && result.warnings.length > 0) {
      const warningText = result.warnings.join("; ");
      
      // Log each warning as a violation
      for (const warning of result.warnings) {
        await storage.createConsistencyViolation({
          projectId,
          chapterNumber,
          violationType: 'WARNING',
          severity: 'major',
          description: warning,
          affectedEntities: [],
          wasAutoFixed: false,
        });
      }
      
      this.callbacks.onAgentStatus("consistency", "warning", `${result.warnings.length} issues detected - forcing rewrite`);
      return { isValid: false, error: warningText };
    }
    
    this.callbacks.onAgentStatus("consistency", "completed", "Continuity validated");
    return { isValid: true };
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

  private generateTitleFromSummary(summary: string): string {
    if (!summary || summary.length < 5) return "";
    
    // Try to extract a meaningful phrase from the summary
    // Look for key patterns that often contain good titles
    
    // Pattern 1: Look for quoted content (ship names, place names, etc.)
    const quotedMatch = summary.match(/'([^']{3,30})'/);
    if (quotedMatch) return quotedMatch[1];
    
    // Pattern 2: Get the first sentence only
    const firstSentence = summary.split(/[.!?]/)[0]?.trim() || "";
    if (!firstSentence || firstSentence.length < 5) return "";
    
    // Pattern 3: Look for key nouns/phrases that make good titles
    // Common chapter title patterns: "El/La [noun]", "Los/Las [noun]", action phrases
    const keyPhrases = [
      /el (hallazgo|descubrimiento|misterio|secreto|cadáver|cuerpo|testigo|sospechoso|rastro|encuentro|interrogatorio|enfrentamiento|conflicto|amanecer|anochecer|regreso|viaje)/i,
      /la (huida|búsqueda|revelación|traición|verdad|mentira|pista|sombra|luz|noche|tormenta|calma|confesión|escena|evidencia)/i,
      /las? (sombras?|huellas?|señales?|marcas?|aguas?)/i,
      /los? (secretos?|indicios?|restos?)/i,
    ];
    
    for (const pattern of keyPhrases) {
      const match = firstSentence.match(pattern);
      if (match) {
        let title = match[0].charAt(0).toUpperCase() + match[0].slice(1);
        return title;
      }
    }
    
    // Pattern 4: Extract first 3-5 significant words from first sentence
    const words = firstSentence.split(/\s+/).slice(0, 5);
    let title = words.join(" ");
    
    // Truncate at word boundary to max 35 chars
    if (title.length > 35) {
      const lastSpace = title.lastIndexOf(" ", 35);
      title = title.slice(0, lastSpace > 10 ? lastSpace : 35);
    }
    
    // Remove trailing articles or prepositions
    title = title.replace(/\s+(el|la|los|las|un|una|de|del|en|a|y|con|por|para)$/i, "");
    
    // Remove trailing punctuation
    title = title.replace(/[.,;:!?]+$/, "");
    
    // Capitalize first letter
    if (title.length > 0) {
      title = title.charAt(0).toUpperCase() + title.slice(1);
    }
    
    return title.length > 5 ? title : "";
  }

  private async syncChapterHeaders(projectId: number, outline: Array<{ chapter_num: number; title: string }>): Promise<void> {
    const existingChapters = await storage.getChaptersByProject(projectId);
    if (existingChapters.length === 0) return;

    console.log(`[OrchestratorV2] Syncing chapter headers for ${existingChapters.length} existing chapters...`);

    const headerPatterns = [
      /^#\s*(Capítulo|Capitulo|CAPÍTULO|CAPITULO)\s+(\d+)\s*[:|-]?\s*([^\n]*)/im,
      /^(Capítulo|Capitulo|CAPÍTULO|CAPITULO)\s+(\d+)\s*[:|-]?\s*([^\n]*)/im,
      /^#\s*(Prólogo|Prologo|PRÓLOGO|PROLOGO)\s*[:|-]?\s*([^\n]*)/im,
      /^#\s*(Epílogo|Epilogo|EPÍLOGO|EPILOGO)\s*[:|-]?\s*([^\n]*)/im,
    ];

    for (const chapter of existingChapters) {
      if (!chapter.content) continue;

      // Find the corresponding outline entry for this chapter
      const outlineEntry = outline.find(o => o.chapter_num === chapter.chapterNumber);
      
      // Extract any existing title from the content header
      let existingTitleFromContent = "";
      let hasHeader = false;
      for (const pattern of headerPatterns) {
        const match = chapter.content.match(pattern);
        if (match) {
          hasHeader = true;
          // Get the title part (after the colon/dash)
          const titlePart = match[match.length - 1]?.trim() || "";
          if (titlePart && !titlePart.match(/^(Prólogo|Epílogo|Capítulo \d+)$/i)) {
            existingTitleFromContent = titlePart;
          }
          break;
        }
      }
      
      // Priority: chapter.title from DB (if not generic) > existingTitleFromContent > outlineEntry?.title (if not generic)
      // Also try to extract a title from the chapter summary if no descriptive title exists
      let titleToUse = "";
      
      // Helper to check if a title is valid (not too long, not generic)
      const isValidTitle = (title: string) => {
        if (!title || title.length > 60) return false;  // Too long = probably content, not title
        if (title.match(/^Capítulo \d+$/i)) return false;  // Generic
        return true;
      };
      
      if (chapter.title && isValidTitle(chapter.title)) {
        titleToUse = chapter.title;
      } else if (existingTitleFromContent && isValidTitle(existingTitleFromContent)) {
        titleToUse = existingTitleFromContent;
      } else if (outlineEntry?.title && isValidTitle(outlineEntry.title)) {
        titleToUse = outlineEntry.title;
      } else if (chapter.summary) {
        // Try to generate a title from the chapter summary
        titleToUse = this.generateTitleFromSummary(chapter.summary);
      }
      
      // Remove "Prólogo:", "Epílogo:", or "Capítulo X:" prefix from title if it exists
      titleToUse = titleToUse.replace(/^(Prólogo|Prologo|Epílogo|Epilogo|Nota del Autor)\s*[:|-]?\s*/i, "").trim();
      titleToUse = titleToUse.replace(/^Capítulo\s+\d+\s*[:|-]?\s*/i, "").trim();
      
      // Determine the correct header and DB title based on chapter number
      let correctHeader = "";
      let correctDbTitle = "";
      if (chapter.chapterNumber === 0) {
        correctHeader = "# Prólogo";
        correctDbTitle = "Prólogo";
        if (titleToUse && titleToUse.toLowerCase() !== "prólogo") {
          correctHeader += `: ${titleToUse}`;
          correctDbTitle += `: ${titleToUse}`;
        }
      } else if (chapter.chapterNumber === 998) {
        correctHeader = "# Epílogo";
        correctDbTitle = "Epílogo";
        if (titleToUse && titleToUse.toLowerCase() !== "epílogo") {
          correctHeader += `: ${titleToUse}`;
          correctDbTitle += `: ${titleToUse}`;
        }
      } else if (chapter.chapterNumber === 999) {
        correctHeader = "# Nota del Autor";
        correctDbTitle = "Nota del Autor";
      } else {
        correctHeader = `# Capítulo ${chapter.chapterNumber}`;
        correctDbTitle = titleToUse || `Capítulo ${chapter.chapterNumber}`;
        if (titleToUse && !titleToUse.match(/^Capítulo \d+$/i)) {
          correctHeader += `: ${titleToUse}`;
        }
      }

      let updatedContent = chapter.content;
      let contentWasUpdated = false;
      let titleWasUpdated = false;

      // Check if we need to update an existing header
      for (const pattern of headerPatterns) {
        const match = updatedContent.match(pattern);
        if (match) {
          const oldHeader = match[0];
          if (oldHeader !== correctHeader) {
            updatedContent = updatedContent.replace(pattern, correctHeader);
            contentWasUpdated = true;
            console.log(`[OrchestratorV2] Chapter ${chapter.chapterNumber}: "${oldHeader.substring(0, 40)}..." -> "${correctHeader}"`);
          }
          break;
        }
      }

      // If no header exists, add one at the beginning
      if (!hasHeader) {
        updatedContent = correctHeader + "\n\n" + updatedContent.trimStart();
        contentWasUpdated = true;
        console.log(`[OrchestratorV2] Chapter ${chapter.chapterNumber}: Added header "${correctHeader}"`);
      }

      // Check if DB title needs updating
      if (chapter.title !== correctDbTitle) {
        titleWasUpdated = true;
        console.log(`[OrchestratorV2] Chapter ${chapter.chapterNumber}: DB title "${chapter.title}" -> "${correctDbTitle}"`);
      }

      // Update in database
      if (contentWasUpdated || titleWasUpdated) {
        const updates: any = {};
        if (contentWasUpdated) updates.content = updatedContent;
        if (titleWasUpdated) updates.title = correctDbTitle;
        await storage.updateChapter(chapter.id, updates);
      }
    }
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
        const timeline = (existingWorldBible.timeline || []) as any[];
        
        // Build a map of chapter numbers to titles from timeline (which has the correct titles)
        const timelineTitles: Record<number, string> = {};
        for (const entry of timeline) {
          if (entry.chapter !== undefined && entry.title) {
            timelineTitles[entry.chapter] = entry.title;
          }
        }
        
        const rawOutline = (plotOutline.chapterOutlines || []).map((ch: any) => ({
          chapter_num: ch.number,
          // Priority: plotOutline title > timeline title > fallback
          title: ch.title || timelineTitles[ch.number] || `Capítulo ${ch.number}`,
          summary: ch.summary || "",
          key_event: ch.keyEvents?.[0] || "",
        }));
        
        // Apply chapter number remapping if needed (for prologue/epilogue/author note)
        const totalChapters = rawOutline.length;
        outline = rawOutline.map((ch: any, idx: number) => {
          let actualNumber = ch.chapter_num;
          let actualTitle = ch.title;
          
          if (project.hasPrologue && idx === 0) {
            actualNumber = 0;
            actualTitle = "Prólogo";
          } else if (project.hasAuthorNote && idx === totalChapters - 1) {
            actualNumber = 999;
            actualTitle = "Nota del Autor";
          } else if (project.hasEpilogue && (
            (project.hasAuthorNote && idx === totalChapters - 2) ||
            (!project.hasAuthorNote && idx === totalChapters - 1)
          )) {
            actualNumber = 998;
            actualTitle = "Epílogo";
          } else if (project.hasPrologue) {
            actualNumber = idx;
            // Update title to match the new chapter number if it was a generic title
            if (ch.title && ch.title.match(/^Capítulo \d+$/i)) {
              actualTitle = `Capítulo ${actualNumber}`;
            }
          }
          
          return { ...ch, chapter_num: actualNumber, title: actualTitle };
        });
        
        console.log(`[OrchestratorV2] Loaded ${outline.length} chapter outlines. Numbers: ${outline.map(c => c.chapter_num).join(', ')}`);
        
        // LitAgents 2.1: Ensure consistency database is initialized even when resuming
        // (in case project was reset but World Bible preserved)
        this.callbacks.onAgentStatus("consistency", "active", "Checking consistency database...");
        await this.initializeConsistencyDatabase(project.id, worldBible, project.genre);
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
        await this.logAiUsage(project.id, "global-architect", "deepseek-reasoner", globalResult.tokenUsage);
        this.callbacks.onAgentStatus("global-architect", "completed", "Master structure complete");

        worldBible = globalResult.parsed.world_bible;
        const rawOutline = globalResult.parsed.outline;
        const plotThreads = globalResult.parsed.plot_threads;

        // Remap chapter numbers to match system convention:
        // Prologue: 0, Normal chapters: 1-N, Epilogue: 998, Author Note: 999
        outline = rawOutline.map((ch, idx) => {
          let actualNumber = ch.chapter_num;
          const totalChapters = rawOutline.length;
          let actualTitle = ch.title;
          
          if (project.hasPrologue && idx === 0) {
            actualNumber = 0;
            actualTitle = "Prólogo";
          } else if (project.hasAuthorNote && idx === totalChapters - 1) {
            actualNumber = 999;
            actualTitle = "Nota del Autor";
          } else if (project.hasEpilogue && (
            (project.hasAuthorNote && idx === totalChapters - 2) ||
            (!project.hasAuthorNote && idx === totalChapters - 1)
          )) {
            actualNumber = 998;
            actualTitle = "Epílogo";
          } else if (project.hasPrologue) {
            actualNumber = idx;
            // Update title to match the new chapter number if it was a generic title
            if (ch.title.match(/^Capítulo \d+$/i)) {
              actualTitle = `Capítulo ${actualNumber}`;
            }
          }
          
          return { ...ch, chapter_num: actualNumber, title: actualTitle };
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
              title: ch.title,
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
          await storage.createProjectPlotThread({
            projectId: project.id,
            name: thread.name,
            description: thread.description || null,
            goal: thread.goal,
            status: "active",
            intensityScore: 5,
            lastUpdatedChapter: 0,
          });
        }

        // LitAgents 2.1: Initialize Universal Consistency Database
        this.callbacks.onAgentStatus("consistency", "active", "Initializing consistency database...");
        await this.initializeConsistencyDatabase(project.id, worldBible, project.genre);
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
        
        // Sync chapter headers in case they have incorrect numbers from before remapping
        if (project.hasPrologue || project.hasEpilogue || project.hasAuthorNote) {
          await this.syncChapterHeaders(project.id, outline);
        }
        
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

        // 2a.0: LitAgents 2.1 - Generate consistency constraints BEFORE planning
        // This prevents the Chapter Architect from planning scenes that violate consistency
        let consistencyConstraints = "";
        try {
          const context = await this.getConsistencyContext(project.id);
          if (context.entities.length > 0) {
            consistencyConstraints = universalConsistencyAgent.generateConstraints(
              project.genre,
              context.entities,
              context.rules,
              context.relationships,
              chapterNumber
            );
            console.log(`[OrchestratorV2] Generated consistency constraints (${consistencyConstraints.length} chars) - Will inject to ChapterArchitect AND Ghostwriter`);
          }
        } catch (err) {
          console.error(`[OrchestratorV2] Failed to generate constraints:`, err);
        }

        // 2a: Chapter Architect - Plan scenes (now WITH constraints)
        this.callbacks.onAgentStatus("chapter-architect", "active", `Planning scenes for Chapter ${chapterNumber}...`);
        
        const previousSummary = i > 0 ? chapterSummaries[i - 1] : "";
        const storyState = rollingSummary;

        const chapterPlan = await this.chapterArchitect.execute({
          chapterOutline,
          worldBible,
          previousChapterSummary: previousSummary,
          storyState,
          consistencyConstraints, // LitAgents 2.1: Inject constraints to planning phase
        });

        if (chapterPlan.error || !chapterPlan.parsed) {
          throw new Error(`Chapter Architect failed for Chapter ${chapterNumber}: ${chapterPlan.error || "No parsed output"}`);
        }

        this.addTokenUsage(chapterPlan.tokenUsage);
        await this.logAiUsage(project.id, "chapter-architect", "deepseek-reasoner", chapterPlan.tokenUsage, chapterNumber);
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
            consistencyConstraints,
          });

          if (sceneResult.error) {
            console.error(`[OrchestratorV2] Scene ${scene.scene_num} failed:`, sceneResult.error);
            continue; // Try to continue with next scene
          }

          this.addTokenUsage(sceneResult.tokenUsage);
          await this.logAiUsage(project.id, "ghostwriter-v2", "deepseek-chat", sceneResult.tokenUsage, chapterNumber);
          
          fullChapterText += "\n\n" + sceneResult.content;
          lastContext = sceneResult.content.slice(-1500); // Keep last 1500 chars for context

          const sceneWordCount = sceneResult.content.split(/\s+/).length;
          this.callbacks.onSceneComplete(chapterNumber, scene.scene_num, sceneBreakdown.scenes.length, sceneWordCount);
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
        await this.logAiUsage(project.id, "smart-editor", "deepseek-chat", editResult.tokenUsage, chapterNumber);

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

        // 2c.5: LitAgents 2.1 - Universal Consistency Validation
        const consistencyResult = await this.validateAndUpdateConsistency(
          project.id,
          chapterNumber,
          finalText,
          project.genre
        );

        if (!consistencyResult.isValid && consistencyResult.error) {
          console.warn(`[OrchestratorV2] CRITICAL consistency violation in Chapter ${chapterNumber}: ${consistencyResult.error}`);
          this.callbacks.onAgentStatus("consistency", "warning", "Applying surgical fix to affected scenes...");
          
          // Use SmartEditor's surgicalFix method for targeted correction
          // This is much more token-efficient than rewriting the entire chapter
          this.callbacks.onAgentStatus("smart-editor", "active", "Fixing continuity error surgically...");
          
          const surgicalFixResult = await this.smartEditor.surgicalFix({
            chapterContent: finalText,
            errorDescription: consistencyResult.error,
            consistencyConstraints,
          });
          
          this.addTokenUsage(surgicalFixResult.tokenUsage);
          await this.logAiUsage(project.id, "smart-editor", "deepseek-chat", surgicalFixResult.tokenUsage, chapterNumber);
          
          // Apply patches if available, otherwise use full content as fallback
          if (surgicalFixResult.patches && surgicalFixResult.patches.length > 0) {
            const patchResult: PatchResult = applyPatches(finalText, surgicalFixResult.patches);
            if (patchResult.success && patchResult.patchedContent) {
              finalText = patchResult.patchedContent;
              console.log(`[OrchestratorV2] Chapter ${chapterNumber}: Applied ${patchResult.appliedCount} surgical patches to fix consistency violation`);
            } else if (surgicalFixResult.fullContent) {
              finalText = surgicalFixResult.fullContent;
              console.log(`[OrchestratorV2] Chapter ${chapterNumber}: Used full content from editor (patches failed)`);
            }
          } else if (surgicalFixResult.fullContent) {
            finalText = surgicalFixResult.fullContent;
            console.log(`[OrchestratorV2] Chapter ${chapterNumber}: Applied editor corrections for consistency fix`);
          }
          
          // Mark ALL violations for this chapter as auto-fixed
          const violations = await db.select().from(consistencyViolations)
            .where(and(
              eq(consistencyViolations.projectId, project.id),
              eq(consistencyViolations.chapterNumber, chapterNumber),
              eq(consistencyViolations.status, "pending")
            ));
          
          if (violations.length > 0) {
            for (const violation of violations) {
              await db.update(consistencyViolations)
                .set({ 
                  wasAutoFixed: true, 
                  status: "resolved",
                  resolvedAt: new Date(),
                  fixDescription: "Corrección quirúrgica aplicada para resolver violación de continuidad" 
                })
                .where(eq(consistencyViolations.id, violation.id));
            }
            console.log(`[OrchestratorV2] Marked ${violations.length} consistency violation(s) as RESOLVED for Chapter ${chapterNumber}`);
          }
          
          this.callbacks.onAgentStatus("smart-editor", "completed", "Continuity error fixed surgically");
        }

        // 2d: Summarizer - Compress for memory
        this.callbacks.onAgentStatus("summarizer", "active", "Compressing for memory...");

        const summaryResult = await this.summarizer.execute({
          chapterContent: finalText,
          chapterNumber,
        });

        this.addTokenUsage(summaryResult.tokenUsage);
        await this.logAiUsage(project.id, "summarizer", "deepseek-chat", summaryResult.tokenUsage, chapterNumber);

        const chapterSummary = summaryResult.content || `Chapter ${chapterNumber} completed.`;
        chapterSummaries.push(chapterSummary);

        // Update rolling summary (keep last 3 chapters for context)
        const recentSummaries = chapterSummaries.slice(-3);
        rollingSummary = recentSummaries.map((s, idx) => `Cap ${chapterNumber - (recentSummaries.length - 1 - idx)}: ${s}`).join("\n");

        this.callbacks.onAgentStatus("summarizer", "completed", "Chapter compressed");

        // Save chapter to database (update if exists, create if not)
        const wordCount = finalText.split(/\s+/).length;
        
        // Check if chapter already exists (e.g., was reset to pending)
        const existingChapter = existingChapters.find(c => c.chapterNumber === chapterNumber);
        
        if (existingChapter) {
          // Update existing chapter instead of creating a duplicate
          await storage.updateChapter(existingChapter.id, {
            title: chapterOutline.title,
            content: finalText,
            wordCount,
            status: "approved",
            sceneBreakdown: sceneBreakdown as any,
            summary: chapterSummary,
            editorFeedback: editorFeedback as any,
            qualityScore: editorFeedback ? Math.round((editorFeedback.logic_score + editorFeedback.style_score) / 2) : null,
          });
          console.log(`[OrchestratorV2] Updated existing chapter ${chapterNumber} (ID: ${existingChapter.id})`);
        } else {
          // Create new chapter
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
          console.log(`[OrchestratorV2] Created new chapter ${chapterNumber}`);
        }

        await storage.updateProject(project.id, { currentChapter: chapterNumber });
        this.callbacks.onChapterComplete(chapterNumber, wordCount, chapterOutline.title);

        // 2e: Narrative Director - Check every 5 chapters, before epilogue, AND always with epilogue (998)
        const isMultipleOfFive = chapterNumber > 0 && chapterNumber < 998 && chapterNumber % 5 === 0;
        const currentIdx = outline.findIndex((ch: any) => ch.chapter_num === chapterNumber);
        const nextChapter = outline[currentIdx + 1];
        const isLastBeforeEpilogue = nextChapter && (nextChapter.chapter_num === 998 || nextChapter.chapter_num === 999);
        const isEpilogue = chapterNumber === 998; // Always run Director with epilogue for final coherence check
        
        if (isMultipleOfFive || isLastBeforeEpilogue || isEpilogue) {
          let label: string;
          if (isEpilogue) {
            label = "Final coherence review with epilogue";
          } else if (isLastBeforeEpilogue) {
            label = "Pre-epilogue review";
          } else {
            label = `Chapter ${chapterNumber} checkpoint`;
          }
          console.log(`[OrchestratorV2] Running Narrative Director: ${label}`);
          const directorResult = await this.runNarrativeDirector(project.id, chapterNumber, project.chapterCount, chapterSummaries);
          
          // If epilogue needs rewrite due to unresolved threads or issues
          if (isEpilogue && directorResult.needsRewrite) {
            console.log(`[OrchestratorV2] Rewriting epilogue to resolve: ${directorResult.unresolvedThreads.join(", ")}`);
            this.callbacks.onAgentStatus("ghostwriter-v2", "active", "Rewriting epilogue to close narrative threads...");
            
            // Get current epilogue chapter
            const allChapters = await storage.getChaptersByProject(project.id);
            const epilogueChapter = allChapters.find(c => c.chapterNumber === 998);
            
            if (epilogueChapter) {
              // Generate enhanced scene plan with closure instructions
              const closureInstructions = directorResult.unresolvedThreads.length > 0 
                ? `Debes añadir cierres para: ${directorResult.unresolvedThreads.join(", ")}`
                : directorResult.directive;
              
              // Get previous chapter summary for context
              const prevChapterSummary = chapterSummaries[chapterSummaries.length - 2] || "";
              
              // Rewrite epilogue using Ghostwriter with closure instructions
              const rewriteResult = await this.ghostwriter.execute({
                scenePlan: {
                  scene_num: 1,
                  characters: [],
                  setting: "Final",
                  plot_beat: closureInstructions,
                  emotional_beat: "Cierre y resolución de todos los hilos narrativos",
                  ending_hook: "Conclusión satisfactoria",
                },
                prevSceneContext: prevChapterSummary,
                rollingSummary: rollingSummary,
                worldBible,
                guiaEstilo: "",
              });
              
              this.addTokenUsage(rewriteResult.tokenUsage);
              
              if (rewriteResult.content) {
                await storage.updateChapter(epilogueChapter.id, {
                  originalContent: epilogueChapter.originalContent, // Keep original
                  content: rewriteResult.content,
                });
                
                console.log(`[OrchestratorV2] Epilogue rewritten to close ${directorResult.unresolvedThreads.length} narrative threads`);
                this.callbacks.onAgentStatus("ghostwriter-v2", "completed", `Epilogue rewritten (${directorResult.unresolvedThreads.length} threads closed)`);
              } else {
                console.log(`[OrchestratorV2] Epilogue rewrite failed - no content generated`);
                this.callbacks.onAgentStatus("ghostwriter-v2", "completed", "Rewrite skipped");
              }
            }
          }
        }

        // Update token counts
        await this.updateProjectTokens(project.id);
      }

      // After all chapters are written, check if we need to run FinalReviewer
      // Get fresh project data to check current score
      const freshProject = await storage.getProject(project.id);
      const currentScore = freshProject?.finalScore || 0;
      
      if (currentScore >= 9) {
        // Already has a passing score, mark as completed
        console.log(`[OrchestratorV2] Project already has score ${currentScore}/10, marking as completed`);
        await storage.updateProject(project.id, { status: "completed" });
        this.callbacks.onProjectComplete();
      } else {
        // Need to run FinalReviewer to get/improve score
        console.log(`[OrchestratorV2] Project has score ${currentScore}/10 (< 9), running FinalReviewer...`);
        await this.runFinalReviewOnly(project, 3);
      }

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
  ): Promise<{ needsRewrite: boolean; directive: string; unresolvedThreads: string[] }> {
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

    let needsRewrite = false;
    let directive = "";
    let unresolvedThreads: string[] = [];

    if (result.parsed) {
      console.log(`[OrchestratorV2] Narrative Director directive: ${result.parsed.directive}`);
      directive = result.parsed.directive || "";
      
      // Update thread statuses if needed
      if (result.parsed.thread_updates) {
        for (const update of result.parsed.thread_updates) {
          const thread = dbThreads.find(t => t.name === update.name);
          if (thread) {
            await storage.updateProjectPlotThread(thread.id, {
              status: update.new_status,
              lastUpdatedChapter: currentChapter,
            });
          }
        }
      }

      // Check for unresolved threads at epilogue
      if (currentChapter === 998) {
        unresolvedThreads = plotThreads
          .filter(t => t.status === "active" || t.status === "developing")
          .map(t => t.name);
        
        // Needs rewrite if there are unresolved threads or critical issues in directive
        const criticalKeywords = ["inconsistencia", "sin resolver", "unresolved", "contradiction", "error", "problema"];
        const hasCriticalIssue = criticalKeywords.some(kw => directive.toLowerCase().includes(kw));
        
        needsRewrite = unresolvedThreads.length > 0 || hasCriticalIssue;
        
        if (needsRewrite) {
          console.log(`[OrchestratorV2] Epilogue needs rewrite: ${unresolvedThreads.length} unresolved threads, critical issues: ${hasCriticalIssue}`);
        }
      }

      this.callbacks.onAgentStatus("narrative-director", "completed", `Tension: ${result.parsed.tension_level}/10`);
    } else {
      this.callbacks.onAgentStatus("narrative-director", "completed", "Analysis complete");
    }

    return { needsRewrite, directive, unresolvedThreads };
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
    
    // Plan scenes (note: this helper doesn't have consistency constraints context)
    const chapterPlan = await this.chapterArchitect.execute({
      chapterOutline,
      worldBible,
      previousChapterSummary,
      storyState: rollingSummary,
      // consistencyConstraints not available in this simplified helper
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
        // Note: consistencyConstraints not available in this simplified helper
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
   * Run final review only - V2 version with auto-correction
   * Uses FinalReviewer for comprehensive analysis and auto-corrects problematic chapters
   */
  async runFinalReviewOnly(project: Project, maxCycles: number = 2): Promise<void> {
    console.log(`[OrchestratorV2] Running final review for project ${project.id}`);
    
    try {
      this.callbacks.onAgentStatus("final-reviewer", "active", "Ejecutando revisión final completa...");
      
      const chapters = await storage.getChaptersByProject(project.id);
      const completedChapters = chapters
        .filter(c => c.status === "completed" || c.status === "approved")
        .sort((a, b) => a.chapterNumber - b.chapterNumber);
      
      if (completedChapters.length === 0) {
        this.callbacks.onError("No hay capítulos completados para revisar");
        return;
      }

      const worldBible = await storage.getWorldBibleByProject(project.id);
      if (!worldBible) {
        this.callbacks.onError("No se encontró la World Bible para este proyecto");
        return;
      }

      let guiaEstilo = "";
      if (project.styleGuideId) {
        const styleGuide = await storage.getStyleGuide(project.styleGuideId);
        if (styleGuide) guiaEstilo = styleGuide.content;
      }

      const worldBibleData = {
        characters: worldBible.characters || [],
        rules: worldBible.worldRules || [],
      };

      let currentCycle = 0;
      let finalResult: FinalReviewerResult | null = null;

      while (currentCycle < maxCycles) {
        currentCycle++;
        console.log(`[OrchestratorV2] Final review cycle ${currentCycle}/${maxCycles}`);

        if (await isProjectCancelledFromDb(project.id)) {
          console.log(`[OrchestratorV2] Final review cancelled for project ${project.id}`);
          await this.updateProjectTokens(project.id);
          await storage.updateProject(project.id, { status: "paused" });
          return;
        }

        // Refresh chapters from storage to get any updates from previous cycle
        const freshChapters = await storage.getChaptersByProject(project.id);
        const currentChapters = freshChapters
          .filter(c => c.status === "completed" || c.status === "approved")
          .sort((a, b) => a.chapterNumber - b.chapterNumber);

        // Prepare chapters for FinalReviewer
        const chaptersForReview = currentChapters.map(c => ({
          numero: c.chapterNumber,
          titulo: c.title || `Capítulo ${c.chapterNumber}`,
          contenido: c.content || "",
        }));

        this.callbacks.onAgentStatus("final-reviewer", "active", `Analizando manuscrito completo (ciclo ${currentCycle})...`);

        // Run FinalReviewer
        const reviewResult = await this.finalReviewer.execute({
          projectTitle: project.title,
          chapters: chaptersForReview,
          worldBible: worldBibleData,
          guiaEstilo,
          pasadaNumero: currentCycle,
        });

        this.addTokenUsage(reviewResult.tokenUsage);
        await this.logAiUsage(project.id, "final-reviewer", "deepseek-reasoner", reviewResult.tokenUsage);

        // FinalReviewer returns 'result' not 'parsed'
        if (!reviewResult.result) {
          console.error("[OrchestratorV2] FinalReviewer failed to parse result");
          this.callbacks.onError("Error al analizar el manuscrito");
          await storage.updateProject(project.id, { status: "error" });
          return;
        }

        finalResult = reviewResult.result;
        let { veredicto, puntuacion_global, issues, capitulos_para_reescribir } = finalResult;

        console.log(`[OrchestratorV2] Review result: ${veredicto}, score: ${puntuacion_global}, chapters to rewrite: ${capitulos_para_reescribir?.length || 0}, issues: ${issues?.length || 0}`);

        // ORCHESTRATOR SAFETY NET: If capitulos_para_reescribir is empty but there are critical/major issues,
        // extract chapters from those issues to trigger auto-correction
        if ((!capitulos_para_reescribir || capitulos_para_reescribir.length === 0) && issues && issues.length > 0) {
          const extractedChapters: number[] = [];
          for (const issue of issues) {
            if ((issue.severidad === "critica" || issue.severidad === "mayor") && 
                issue.capitulos_afectados?.length > 0) {
              extractedChapters.push(...issue.capitulos_afectados);
            }
          }
          if (extractedChapters.length > 0) {
            capitulos_para_reescribir = Array.from(new Set(extractedChapters));
            finalResult.capitulos_para_reescribir = capitulos_para_reescribir;
            console.log(`[OrchestratorV2] SAFETY NET: Extracted ${capitulos_para_reescribir.length} chapters from ${issues.filter(i => i.severidad === "critica" || i.severidad === "mayor").length} critical/major issues: ${capitulos_para_reescribir.join(", ")}`);
          }
        }

        // STRICT QUALITY GATE: Only consider done if score >= 9
        const meetsQualityThreshold = puntuacion_global >= 9;
        
        // If score >= 9, we're done regardless of veredicto
        if (meetsQualityThreshold) {
          console.log(`[OrchestratorV2] Score ${puntuacion_global} >= 9. Quality threshold met.`);
          break;
        }
        
        // Score < 9: need to correct. If no chapters extracted, mark for manual intervention
        if ((capitulos_para_reescribir?.length || 0) === 0) {
          console.log(`[OrchestratorV2] Score ${puntuacion_global} < 9 but no chapters to rewrite. Will mark as failed_final_review for manual intervention.`);
          break;
        }

        // Auto-correct problematic chapters
        if (capitulos_para_reescribir && capitulos_para_reescribir.length > 0 && currentCycle < maxCycles) {
          console.log(`[OrchestratorV2] Starting auto-correction for ${capitulos_para_reescribir.length} chapters`);
          this.callbacks.onAgentStatus("smart-editor", "active", `Auto-corrigiendo ${capitulos_para_reescribir.length} capítulo(s)...`);

          let correctedCount = 0;
          let failedCount = 0;

          for (const chapNum of capitulos_para_reescribir) {
            if (await isProjectCancelledFromDb(project.id)) {
              await this.updateProjectTokens(project.id);
              await storage.updateProject(project.id, { status: "paused" });
              return;
            }

            const chapter = currentChapters.find(c => c.chapterNumber === chapNum);
            if (!chapter) {
              console.log(`[OrchestratorV2] Chapter ${chapNum} not found, skipping`);
              continue;
            }

            // Get issues for this chapter
            const chapterIssues = issues.filter(i => i.capitulos_afectados?.includes(chapNum));
            if (chapterIssues.length === 0) {
              console.log(`[OrchestratorV2] No issues found for Chapter ${chapNum}, skipping`);
              continue;
            }

            // Check if any issue is critical - if so, use surgicalFix instead
            const hasCriticalIssue = chapterIssues.some(i => i.severidad === "critica");

            console.log(`[OrchestratorV2] Correcting Chapter ${chapNum}: ${chapterIssues.length} issues (critical: ${hasCriticalIssue})`);
            this.callbacks.onAgentStatus("smart-editor", "active", `Corrigiendo capítulo ${chapNum}${hasCriticalIssue ? ' (crítico)' : ''}...`);

            // Build correction prompt from issues
            const issuesDescription = chapterIssues.map(i => 
              `- [${i.severidad.toUpperCase()}] ${i.categoria}: ${i.descripcion}\n  Corrección: ${i.instrucciones_correccion}`
            ).join("\n");

            let correctedContent: string | null = null;

            try {
              if (hasCriticalIssue) {
                // Use surgicalFix for critical issues - it does a more thorough rewrite
                console.log(`[OrchestratorV2] Using surgicalFix for critical issue in Chapter ${chapNum}`);
                const fixResult = await this.smartEditor.surgicalFix({
                  chapterContent: chapter.content || "",
                  errorDescription: issuesDescription,
                  consistencyConstraints: JSON.stringify(worldBibleData.characters?.slice(0, 5) || []),
                });

                this.addTokenUsage(fixResult.tokenUsage);
                await this.logAiUsage(project.id, "smart-editor", "deepseek-chat", fixResult.tokenUsage, chapNum);

                if (fixResult.parsed?.corrected_text && fixResult.parsed.corrected_text.length > 100) {
                  correctedContent = fixResult.parsed.corrected_text;
                  console.log(`[OrchestratorV2] surgicalFix returned ${correctedContent.length} chars for Chapter ${chapNum}`);
                } else {
                  console.error(`[OrchestratorV2] surgicalFix returned empty/invalid content for Chapter ${chapNum}`);
                }
              } else {
                // Use SmartEditor patches for non-critical issues
                console.log(`[OrchestratorV2] Using SmartEditor patches for Chapter ${chapNum}`);
                const editResult = await this.smartEditor.execute({
                  chapterContent: chapter.content || "",
                  sceneBreakdown: chapter.sceneBreakdown as any || { scenes: [] },
                  worldBible: worldBibleData,
                  additionalContext: `PROBLEMAS DETECTADOS POR EL CRÍTICO (CORREGIR OBLIGATORIAMENTE):\n${issuesDescription}`,
                });

                this.addTokenUsage(editResult.tokenUsage);
                await this.logAiUsage(project.id, "smart-editor", "deepseek-chat", editResult.tokenUsage, chapNum);

                if (editResult.parsed) {
                  // Apply patches if available
                  if (editResult.parsed.patches && editResult.parsed.patches.length > 0) {
                    console.log(`[OrchestratorV2] Applying ${editResult.parsed.patches.length} patches to Chapter ${chapNum}`);
                    const patchResult = applyPatches(chapter.content || "", editResult.parsed.patches);
                    if (patchResult.appliedPatches > 0) {
                      correctedContent = patchResult.patchedText;
                      console.log(`[OrchestratorV2] Applied ${patchResult.appliedPatches} patches to Chapter ${chapNum}`);
                    } else {
                      console.log(`[OrchestratorV2] No patches applied to Chapter ${chapNum}`);
                    }
                  }
                  
                  // If no patches applied but needs_rewrite is true, use surgicalFix as fallback
                  if (!correctedContent && editResult.parsed.needs_rewrite) {
                    console.log(`[OrchestratorV2] Using surgicalFix as fallback for Chapter ${chapNum}`);
                    const fixResult = await this.smartEditor.surgicalFix({
                      chapterContent: chapter.content || "",
                      errorDescription: issuesDescription,
                    });
                    this.addTokenUsage(fixResult.tokenUsage);
                    if (fixResult.parsed?.corrected_text && fixResult.parsed.corrected_text.length > 100) {
                      correctedContent = fixResult.parsed.corrected_text;
                      console.log(`[OrchestratorV2] Fallback surgicalFix returned ${correctedContent.length} chars`);
                    }
                  }

                  // FALLBACK: If still no content and we have issues, force surgicalFix
                  if (!correctedContent) {
                    console.log(`[OrchestratorV2] Forcing surgicalFix as last resort for Chapter ${chapNum}`);
                    const fixResult = await this.smartEditor.surgicalFix({
                      chapterContent: chapter.content || "",
                      errorDescription: issuesDescription,
                    });
                    this.addTokenUsage(fixResult.tokenUsage);
                    if (fixResult.parsed?.corrected_text && fixResult.parsed.corrected_text.length > 100) {
                      correctedContent = fixResult.parsed.corrected_text;
                    }
                  }
                }
              }
            } catch (error) {
              console.error(`[OrchestratorV2] Error correcting Chapter ${chapNum}:`, error);
              this.callbacks.onAgentStatus("smart-editor", "error", `Error en capítulo ${chapNum}: ${error instanceof Error ? error.message : 'desconocido'}`);
              failedCount++;
              continue;
            }

            // Update chapter if we have corrected content
            if (correctedContent && correctedContent !== chapter.content) {
              const wordCount = correctedContent.split(/\s+/).length;
              await storage.updateChapter(chapter.id, {
                content: correctedContent,
                wordCount,
                qualityScore: 8, // Assume improvement
              });
              
              console.log(`[OrchestratorV2] Successfully updated Chapter ${chapNum} (${wordCount} words)`);
              this.callbacks.onAgentStatus("smart-editor", "active", `Capítulo ${chapNum} corregido (${wordCount} palabras)`);
              this.callbacks.onChapterComplete(
                chapter.chapterNumber,
                wordCount,
                chapter.title || `Capítulo ${chapter.chapterNumber}`
              );
              correctedCount++;
            } else {
              console.log(`[OrchestratorV2] Chapter ${chapNum} unchanged or empty response`);
              failedCount++;
            }
          }

          console.log(`[OrchestratorV2] Auto-correction complete: ${correctedCount} corrected, ${failedCount} failed`);
          this.callbacks.onAgentStatus("smart-editor", "completed", `${correctedCount}/${capitulos_para_reescribir.length} capítulos corregidos`);
        }
      }

      await this.updateProjectTokens(project.id);

      // Determine final status based on review result
      if (!finalResult) {
        await storage.updateProject(project.id, { status: "error" });
        this.callbacks.onError("No se pudo completar la revisión final");
        return;
      }

      const { veredicto, puntuacion_global, resumen_general, justificacion_puntuacion, analisis_bestseller, issues, capitulos_para_reescribir } = finalResult;
      // Only consider approved if score >= 9 AND veredicto is positive
      const approved = puntuacion_global >= 9 && (veredicto === "APROBADO" || veredicto === "APROBADO_CON_RESERVAS");

      await storage.updateProject(project.id, { 
        status: approved ? "completed" : "failed_final_review",
        finalScore: puntuacion_global,
        finalReviewResult: finalResult as any,
      });

      if (approved) {
        this.callbacks.onAgentStatus("final-reviewer", "completed", `${veredicto} (${puntuacion_global}/10)`);
        this.callbacks.onProjectComplete();
      } else {
        this.callbacks.onAgentStatus("final-reviewer", "error", `${veredicto} (${puntuacion_global}/10) - ${capitulos_para_reescribir?.length || 0} capítulos requieren revisión manual`);
        this.callbacks.onError(`El manuscrito obtuvo ${puntuacion_global}/10 con veredicto ${veredicto}. Revisa los capítulos problemáticos manualmente.`);
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

        // LitAgents 2.1: Generate constraints BEFORE planning
        let consistencyConstraints = "";
        try {
          const context = await this.getConsistencyContext(project.id);
          if (context.entities.length > 0) {
            consistencyConstraints = universalConsistencyAgent.generateConstraints(
              project.genre,
              context.entities,
              context.rules,
              context.relationships,
              chapterNum
            );
          }
        } catch (err) {
          console.error(`[OrchestratorV2] Failed to generate constraints for extend:`, err);
        }

        // Plan scenes for this chapter (WITH constraints)
        this.callbacks.onAgentStatus("chapter-architect", "active", `Planificando escenas para Capítulo ${chapterNum}...`);
        
        const chapterPlan = await this.chapterArchitect.execute({
          chapterOutline: tempOutline,
          worldBible: worldBibleData,
          previousChapterSummary: previousSummary,
          storyState: rollingSummary,
          consistencyConstraints,
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
            consistencyConstraints, // LitAgents 2.1: Inject to writing stage
          });

          if (!sceneResult.error) {
            fullChapterText += "\n\n" + sceneResult.content;
            lastContext = sceneResult.content.slice(-1500);
            this.callbacks.onSceneComplete(chapterNum, scene.scene_num, chapterPlan.parsed.scenes.length, sceneResult.content?.split(/\s+/).length || 0);
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

        // LitAgents 2.1: Generate constraints BEFORE planning
        let consistencyConstraints = "";
        try {
          const context = await this.getConsistencyContext(project.id);
          if (context.entities.length > 0) {
            consistencyConstraints = universalConsistencyAgent.generateConstraints(
              project.genre,
              context.entities,
              context.rules,
              context.relationships,
              chapter.chapterNumber
            );
          }
        } catch (err) {
          console.error(`[OrchestratorV2] Failed to generate constraints for truncated regen:`, err);
        }

        // Plan new scenes (WITH constraints)
        const chapterPlan = await this.chapterArchitect.execute({
          chapterOutline,
          worldBible: worldBibleData,
          previousChapterSummary: rollingSummary,
          storyState: rollingSummary,
          consistencyConstraints,
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
            consistencyConstraints, // LitAgents 2.1: Inject to writing stage
          });

          if (!sceneResult.error) {
            fullChapterText += "\n\n" + sceneResult.content;
            lastContext = sceneResult.content.slice(-1500);
          }

          this.addTokenUsage(sceneResult.tokenUsage);
          this.callbacks.onSceneComplete(chapter.chapterNumber, scene.scene_num, chapterPlan.parsed.scenes.length, sceneResult.content?.split(/\s+/).length || 0);
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

  /**
   * Generate missing chapters that weren't written during initial generation
   * This handles cases where the pipeline jumped over chapters
   */
  async generateMissingChapters(project: Project): Promise<void> {
    fs.writeFileSync("/tmp/debug_generate_missing.txt", `[${new Date().toISOString()}] generateMissingChapters START for project ${project.id}\n`, { flag: "a" });
    console.log(`[OrchestratorV2] generateMissingChapters STARTED for project ${project.id}`);
    try {
      fs.writeFileSync("/tmp/debug_generate_missing.txt", `[${new Date().toISOString()}] About to update project status\n`, { flag: "a" });
      console.log(`[OrchestratorV2] Updating project status to generating...`);
      
      try {
        const updateResult = await storage.updateProject(project.id, { status: "generating" });
        fs.writeFileSync("/tmp/debug_generate_missing.txt", `[${new Date().toISOString()}] updateProject returned: ${JSON.stringify(updateResult)}\n`, { flag: "a" });
      } catch (updateError: any) {
        fs.writeFileSync("/tmp/debug_generate_missing.txt", `[${new Date().toISOString()}] updateProject ERROR: ${updateError.message}\n${updateError.stack}\n`, { flag: "a" });
        throw updateError;
      }
      
      fs.writeFileSync("/tmp/debug_generate_missing.txt", `[${new Date().toISOString()}] Project status updated successfully\n`, { flag: "a" });
      console.log(`[OrchestratorV2] Project status updated successfully`);
      this.callbacks.onAgentStatus("orchestrator-v2", "active", "Analizando capítulos faltantes...");

      fs.writeFileSync("/tmp/debug_generate_missing.txt", `[${new Date().toISOString()}] About to get World Bible\n`, { flag: "a" });
      
      // Get World Bible and outline
      const worldBible = await storage.getWorldBibleByProject(project.id);
      fs.writeFileSync("/tmp/debug_generate_missing.txt", `[${new Date().toISOString()}] World Bible result: ${worldBible ? 'FOUND' : 'NULL'}\n`, { flag: "a" });
      if (!worldBible || !worldBible.plotOutline) {
        throw new Error("No se encontró el World Bible con el outline de capítulos");
      }

      const plotOutline = worldBible.plotOutline as any;
      const rawOutline = (plotOutline.chapterOutlines || []).map((ch: any) => ({
        chapter_num: ch.chapter_num ?? ch.number ?? 0,
        title: ch.title || `Capítulo ${ch.chapter_num ?? ch.number ?? 0}`,
        summary: ch.summary || ch.description || "",
        key_event: ch.key_event || ch.keyEvent || "",
        emotional_arc: ch.emotional_arc || ch.emotionalArc || "",
      }));

      // Remap chapter numbers for prologue/epilogue
      const outline = rawOutline.map((ch: any, idx: number) => {
        let actualNum = ch.chapter_num;
        let actualTitle = ch.title;

        if (project.hasPrologue && idx === 0) {
          actualNum = 0;
          actualTitle = "Prólogo";
        } else if (project.hasEpilogue && idx === rawOutline.length - 1) {
          actualNum = 998;
          actualTitle = "Epílogo";
        } else if (project.hasAuthorNote && idx === rawOutline.length - 1) {
          actualNum = 999;
          actualTitle = "Nota del Autor";
        } else if (project.hasPrologue) {
          actualNum = idx; // Adjust for prologue offset
        }

        return { ...ch, chapter_num: actualNum, title: actualTitle };
      });

      // Get existing chapters
      const existingChapters = await storage.getChaptersByProject(project.id);
      const existingNumbers = new Set(existingChapters.map(c => c.chapterNumber));

      // Calculate expected chapter numbers based on project config
      const expectedChapterNumbers: number[] = [];
      if (project.hasPrologue) expectedChapterNumbers.push(0);
      for (let i = 1; i <= project.chapterCount; i++) {
        expectedChapterNumbers.push(i);
      }
      // Note: We don't add 998 (epilogue) or 999 (author's note) here - those are handled separately
      
      // Find missing chapters from outline (excluding epilogue 998 and author note 999)
      const missingFromOutline = outline.filter((ch: any) => 
        !existingNumbers.has(ch.chapter_num) && ch.chapter_num < 998
      );
      
      // Also find chapters expected by chapterCount but not in existing chapters
      const missingFromExpected = expectedChapterNumbers.filter(num => 
        !existingNumbers.has(num)
      );
      
      // Combine both sources, deduplicate
      const allMissingNumbers = new Set([
        ...missingFromOutline.map((c: any) => c.chapter_num),
        ...missingFromExpected
      ]);
      
      // For chapters not in outline, we need to create synthetic outline entries
      interface ChapterOutlineEntry {
        chapter_num: number;
        title: string;
        summary: string;
        key_event: string;
        emotional_arc?: string;
      }
      const outlineMap = new Map<number, ChapterOutlineEntry>(outline.map((ch: any) => [ch.chapter_num, ch]));
      const missingChapters: ChapterOutlineEntry[] = Array.from(allMissingNumbers).sort((a, b) => a - b).map(num => {
        if (outlineMap.has(num)) {
          return outlineMap.get(num)!;
        }
        // Create synthetic outline entry for chapters not in World Bible
        return {
          chapter_num: num,
          title: `Capítulo ${num}`,
          summary: `Continúa la narrativa del capítulo ${num - 1}`,
          key_event: "",
          emotional_arc: "",
        };
      });

      fs.writeFileSync("/tmp/debug_generate_missing.txt", `[${new Date().toISOString()}] Outline chapters: ${outline.map((c: any) => c.chapter_num).join(', ')}\n`, { flag: "a" });
      fs.writeFileSync("/tmp/debug_generate_missing.txt", `[${new Date().toISOString()}] Expected chapters (from chapterCount=${project.chapterCount}): ${expectedChapterNumbers.join(', ')}\n`, { flag: "a" });
      fs.writeFileSync("/tmp/debug_generate_missing.txt", `[${new Date().toISOString()}] Existing chapters: ${Array.from(existingNumbers).sort((a: any, b: any) => a - b).join(', ')}\n`, { flag: "a" });
      fs.writeFileSync("/tmp/debug_generate_missing.txt", `[${new Date().toISOString()}] Missing chapters (< 998): ${missingChapters.map((c: any) => c.chapter_num).join(', ') || 'NONE'}\n`, { flag: "a" });

      if (missingChapters.length === 0) {
        fs.writeFileSync("/tmp/debug_generate_missing.txt", `[${new Date().toISOString()}] No missing chapters found, setting status to completed\n`, { flag: "a" });
        this.callbacks.onAgentStatus("orchestrator-v2", "completed", "No hay capítulos faltantes");
        await storage.updateProject(project.id, { status: "completed" });
        this.callbacks.onProjectComplete();
        return;
      }

      console.log(`[OrchestratorV2] Found ${missingChapters.length} missing chapters: ${missingChapters.map((c: any) => c.chapter_num).join(', ')}`);
      this.callbacks.onAgentStatus("orchestrator-v2", "active", 
        `Generando ${missingChapters.length} capítulos faltantes: ${missingChapters.map((c: any) => c.chapter_num).join(', ')}`);

      // Get style guide
      let guiaEstilo = "";
      if (project.styleGuideId) {
        const styleGuide = await storage.getStyleGuide(project.styleGuideId);
        if (styleGuide) guiaEstilo = styleGuide.content;
      }

      // Build context from existing chapters
      const sortedExisting = existingChapters
        .filter(c => c.chapterNumber < 998)
        .sort((a, b) => a.chapterNumber - b.chapterNumber);
      
      const chapterSummaries: string[] = sortedExisting.map(c => c.summary || "");
      let rollingSummary = sortedExisting.length > 0 
        ? (sortedExisting[sortedExisting.length - 1].summary || "")
        : "Inicio de la novela.";

      // Generate each missing chapter
      for (const chapterOutline of missingChapters) {
        if (await isProjectCancelledFromDb(project.id)) {
          console.log(`[OrchestratorV2] Project ${project.id} was cancelled`);
          return;
        }

        const chapterNumber = chapterOutline.chapter_num;
        console.log(`[OrchestratorV2] Generating missing Chapter ${chapterNumber}: "${chapterOutline.title}"`);

        // Get previous chapter summary for context
        const prevChapter = sortedExisting.find(c => c.chapterNumber === chapterNumber - 1);
        const previousSummary = prevChapter?.summary || rollingSummary;

        // LitAgents 2.1: Generate constraints BEFORE planning
        let consistencyConstraints = "";
        try {
          const context = await this.getConsistencyContext(project.id);
          if (context.entities.length > 0) {
            consistencyConstraints = universalConsistencyAgent.generateConstraints(
              project.genre,
              context.entities,
              context.rules,
              context.relationships,
              chapterNumber
            );
          }
        } catch (err) {
          console.error(`[OrchestratorV2] Failed to generate constraints for fill missing:`, err);
        }

        // Chapter Architect (WITH constraints)
        this.callbacks.onAgentStatus("chapter-architect", "active", `Planning scenes for Chapter ${chapterNumber}...`);
        
        const chapterPlan = await this.chapterArchitect.execute({
          chapterOutline,
          worldBible: worldBible as any,
          previousChapterSummary: previousSummary,
          storyState: rollingSummary,
          consistencyConstraints,
        });

        if (chapterPlan.error || !chapterPlan.parsed) {
          throw new Error(`Chapter Architect failed for Chapter ${chapterNumber}: ${chapterPlan.error || "No parsed output"}`);
        }

        this.addTokenUsage(chapterPlan.tokenUsage);
        await this.logAiUsage(project.id, "chapter-architect", "deepseek-reasoner", chapterPlan.tokenUsage, chapterNumber);
        this.callbacks.onAgentStatus("chapter-architect", "completed", `${chapterPlan.parsed.scenes.length} scenes planned`);

        const sceneBreakdown = chapterPlan.parsed;

        // Ghostwriter - Write scenes
        let fullChapterText = "";
        let lastContext = "";

        for (const scene of sceneBreakdown.scenes) {
          this.callbacks.onAgentStatus("ghostwriter-v2", "active", 
            `Writing scene ${scene.scene_num}/${sceneBreakdown.scenes.length}...`);

          const sceneResult = await this.ghostwriter.execute({
            scenePlan: scene,
            prevSceneContext: lastContext,
            rollingSummary,
            worldBible: worldBible as any,
            guiaEstilo,
            consistencyConstraints, // LitAgents 2.1: Inject to writing stage
          });

          this.addTokenUsage(sceneResult.tokenUsage);
          await this.logAiUsage(project.id, "ghostwriter-v2", "deepseek-chat", sceneResult.tokenUsage, chapterNumber);

          const sceneText = sceneResult.content || "";
          fullChapterText += (fullChapterText ? "\n\n" : "") + sceneText;
          lastContext = sceneText.slice(-1500);

          this.callbacks.onSceneComplete(
            chapterNumber, 
            scene.scene_num, 
            sceneBreakdown.scenes.length,
            sceneText.split(/\s+/).length
          );
        }

        this.callbacks.onAgentStatus("ghostwriter-v2", "completed", "All scenes written");

        // Smart Editor
        this.callbacks.onAgentStatus("smart-editor", "active", "Reviewing chapter...");
        
        const editResult = await this.smartEditor.execute({
          chapterContent: fullChapterText,
          sceneBreakdown,
          worldBible: worldBible as any,
        });

        this.addTokenUsage(editResult.tokenUsage);
        await this.logAiUsage(project.id, "smart-editor", "deepseek-chat", editResult.tokenUsage, chapterNumber);

        let finalText = fullChapterText;
        let editorFeedback = editResult.parsed;

        if (editResult.parsed?.patches && editResult.parsed.patches.length > 0) {
          const patchResult = applyPatches(fullChapterText, editResult.parsed.patches);
          if (patchResult.appliedPatches > 0) {
            finalText = patchResult.patchedText;
            this.callbacks.onAgentStatus("smart-editor", "completed", `${patchResult.appliedPatches} patches applied`);
          }
        }

        // Summarizer
        this.callbacks.onAgentStatus("summarizer", "active", "Compressing for memory...");

        const summaryResult = await this.summarizer.execute({
          chapterContent: finalText,
          chapterNumber,
        });

        this.addTokenUsage(summaryResult.tokenUsage);
        await this.logAiUsage(project.id, "summarizer", "deepseek-chat", summaryResult.tokenUsage, chapterNumber);

        const chapterSummary = summaryResult.content || `Chapter ${chapterNumber} completed.`;
        chapterSummaries.push(chapterSummary);
        rollingSummary = chapterSummary;

        this.callbacks.onAgentStatus("summarizer", "completed", "Chapter compressed");

        // Save chapter
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

        console.log(`[OrchestratorV2] Created missing chapter ${chapterNumber}`);
        this.callbacks.onChapterComplete(chapterNumber, wordCount, chapterOutline.title);

        // Update token counts
        await this.updateProjectTokens(project.id);
      }

      // Run final Narrative Director review
      const allChapters = await storage.getChaptersByProject(project.id);
      const allSummaries = allChapters
        .filter(c => c.chapterNumber < 998)
        .sort((a, b) => a.chapterNumber - b.chapterNumber)
        .map(c => c.summary || "");

      const lastRegularChapter = Math.max(...allChapters.filter(c => c.chapterNumber < 998).map(c => c.chapterNumber));
      
      console.log(`[OrchestratorV2] Running final Narrative Director review after missing chapters`);
      await this.runNarrativeDirector(project.id, lastRegularChapter, project.chapterCount, allSummaries);

      // Complete
      await storage.updateProject(project.id, { status: "completed" });
      this.callbacks.onProjectComplete();

    } catch (error) {
      console.error("[OrchestratorV2] Generate missing chapters error:", error);
      this.callbacks.onError(error instanceof Error ? error.message : String(error));
      await storage.updateProject(project.id, { status: "error" });
    }
  }
}
