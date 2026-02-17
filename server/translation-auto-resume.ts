import { storage } from "./storage";
import { TranslatorAgent } from "./agents/translator";
import type { Translation } from "@shared/schema";

const activeTranslations = new Map<number, boolean>();

const WATCHDOG_INTERVAL_MS = 1 * 60 * 1000; // Check every 1 minute
const FROZEN_THRESHOLD_MS = 10 * 60 * 1000; // Consider frozen after 10 minutes (increased to avoid cutting long operations)

let watchdogInterval: NodeJS.Timeout | null = null;

export function getActiveTranslations() {
  return activeTranslations;
}

export async function translationWatchdogCheck(): Promise<void> {
  try {
    const translations = await storage.getAllTranslations();
    const processingTranslations = translations.filter(t => t.status === "translating");
    
    if (processingTranslations.length === 0) return;
    
    const now = new Date();
    
    for (const translation of processingTranslations) {
      const heartbeatAt = (translation as any).heartbeatAt ? new Date((translation as any).heartbeatAt) : null;
      const lastActivity = heartbeatAt || (translation.createdAt ? new Date(translation.createdAt) : null);
      
      if (!lastActivity) continue;
      
      const timeSinceActivity = now.getTime() - lastActivity.getTime();
      
      if (timeSinceActivity > FROZEN_THRESHOLD_MS) {
        console.log(`[TranslationWatchdog] Translation ${translation.id} frozen - no heartbeat for ${Math.round(timeSinceActivity / 60000)} minutes`);
        
        if (!activeTranslations.has(translation.id)) {
          console.log(`[TranslationWatchdog] Auto-resuming frozen translation ${translation.id}...`);
          resumeTranslation(translation);
        }
      }
    }
  } catch (error) {
    console.error("[TranslationWatchdog] Error during watchdog check:", error);
  }
}

export function startTranslationWatchdog(): void {
  if (watchdogInterval) {
    console.log("[TranslationWatchdog] Watchdog already running");
    return;
  }
  
  console.log("[TranslationWatchdog] Starting watchdog (checking every 2 minutes for frozen translations)");
  watchdogInterval = setInterval(translationWatchdogCheck, WATCHDOG_INTERVAL_MS);
  
  translationWatchdogCheck();
}

export function stopTranslationWatchdog(): void {
  if (watchdogInterval) {
    clearInterval(watchdogInterval);
    watchdogInterval = null;
    console.log("[TranslationWatchdog] Watchdog stopped");
  }
}

async function resumeTranslation(translation: Translation): Promise<void> {
  const translationId = translation.id;
  
  if (activeTranslations.has(translationId)) {
    console.log(`[TranslationAutoResume] Translation ${translationId} already active, skipping.`);
    return;
  }
  
  activeTranslations.set(translationId, true);
  
  try {
    const projectId = translation.projectId;
    const reeditProjectId = (translation as any).reeditProjectId;
    
    if (!projectId && !reeditProjectId) {
      console.log(`[TranslationAutoResume] Translation ${translationId} has no project, skipping.`);
      activeTranslations.delete(translationId);
      return;
    }

    let chaptersWithContent: any[] = [];
    const isReeditProject = !!reeditProjectId && !projectId;

    if (isReeditProject) {
      const project = await storage.getReeditProject(reeditProjectId);
      if (!project) {
        console.log(`[TranslationAutoResume] Reedit project ${reeditProjectId} not found, skipping.`);
        activeTranslations.delete(translationId);
        return;
      }
      
      const chapters = await storage.getReeditChaptersByProject(reeditProjectId);
      const getReeditChapterSortOrder = (n: number) => n === 0 ? -1000 : n === -1 || n === 998 ? 1000 : n === -2 || n === 999 ? 1001 : n;
      const sortedChapters = [...chapters].sort((a, b) => getReeditChapterSortOrder(a.chapterNumber) - getReeditChapterSortOrder(b.chapterNumber));
      chaptersWithContent = sortedChapters.filter(c => 
        (c.editedContent || c.originalContent)?.trim().length > 0
      );
    } else {
      const project = await storage.getProject(projectId!);
      if (!project) {
        console.log(`[TranslationAutoResume] Project ${projectId} not found, skipping.`);
        activeTranslations.delete(translationId);
        return;
      }

      const chapters = await storage.getChaptersByProject(projectId!);
      const sortedChapters = [...chapters].sort((a, b) => {
        const orderA = a.chapterNumber === 0 ? -1000 : a.chapterNumber === -1 ? 1000 : a.chapterNumber === -2 ? 1001 : a.chapterNumber;
        const orderB = b.chapterNumber === 0 ? -1000 : b.chapterNumber === -1 ? 1000 : b.chapterNumber === -2 ? 1001 : b.chapterNumber;
        return orderA - orderB;
      });
      chaptersWithContent = sortedChapters.filter(c => c.content && c.content.trim().length > 0);
    }

    const sourceLanguage = translation.sourceLanguage;
    const targetLanguage = translation.targetLanguage;
    const existingMarkdown = translation.markdown || "";
    const totalChapters = chaptersWithContent.length;
    
    let markdownChapterCount = 0;
    if (existingMarkdown.trim().length > 0) {
      const delimiterMatches = existingMarkdown.match(/\n\n---\n\n/g);
      markdownChapterCount = delimiterMatches ? delimiterMatches.length + 1 : 1;
    }
    
    const startFromChapter = Math.max(0, markdownChapterCount);
    const chaptersToTranslate = chaptersWithContent.slice(startFromChapter);

    console.log(`[TranslationAutoResume] Translation ${translationId}: resuming from chapter ${startFromChapter + 1}/${totalChapters} (${chaptersToTranslate.length} remaining)`);

    if (chaptersToTranslate.length === 0) {
      await storage.updateTranslation(translationId, {
        status: "completed",
        chaptersTranslated: totalChapters,
      });
      console.log(`[TranslationAutoResume] Translation ${translationId} already complete!`);
      activeTranslations.delete(translationId);
      return;
    }

    let currentMarkdown = existingMarkdown;
    let translatedCount = startFromChapter;
    const translator = new TranslatorAgent();

    for (let i = 0; i < chaptersToTranslate.length; i++) {
      const chapter = chaptersToTranslate[i];
      const currentChapterIndex = startFromChapter + i + 1;
      
      console.log(`[TranslationAutoResume] Translation ${translationId}: translating chapter ${currentChapterIndex}/${totalChapters}...`);
      
      await storage.updateTranslation(translationId, {
        heartbeatAt: new Date(),
      } as any);

      const content = isReeditProject 
        ? (chapter.editedContent || chapter.originalContent) 
        : chapter.content;
      
      try {
        const response = await translator.execute({
          content: content!,
          sourceLanguage,
          targetLanguage,
          chapterTitle: chapter.title,
          chapterNumber: chapter.chapterNumber,
        });
        const result = response.result;

        if (result && result.translated_text) {
          if (currentMarkdown.length > 0) {
            currentMarkdown += "\n\n---\n\n";
          }
          currentMarkdown += result.translated_text;
          translatedCount++;

          await storage.updateTranslation(translationId, {
            markdown: currentMarkdown,
            chaptersTranslated: translatedCount,
            heartbeatAt: new Date(),
          } as any);

          console.log(`[TranslationAutoResume] Translation ${translationId}: chapter ${currentChapterIndex}/${totalChapters} complete`);
        }
      } catch (error) {
        console.error(`[TranslationAutoResume] Error translating chapter ${currentChapterIndex}:`, error);
        await storage.updateTranslation(translationId, {
          status: "error",
        });
        activeTranslations.delete(translationId);
        return;
      }
    }

    await storage.updateTranslation(translationId, {
      status: "completed",
      chaptersTranslated: totalChapters,
    });

    console.log(`[TranslationAutoResume] Translation ${translationId} completed successfully!`);
    activeTranslations.delete(translationId);
    
  } catch (error) {
    console.error(`[TranslationAutoResume] Error resuming translation ${translationId}:`, error);
    activeTranslations.delete(translationId);
  }
}

export async function autoResumeTranslations(): Promise<void> {
  console.log("[TranslationAutoResume] Checking for translations that need to be resumed...");
  
  try {
    const translations = await storage.getAllTranslations();
    const processingTranslations = translations.filter(t => t.status === "translating");
    
    if (processingTranslations.length === 0) {
      console.log("[TranslationAutoResume] No translations in translating state.");
      return;
    }
    
    console.log(`[TranslationAutoResume] Found ${processingTranslations.length} translation(s) to resume:`, 
      processingTranslations.map(t => `${t.id}: ${t.projectTitle}`));
    
    for (const translation of processingTranslations) {
      resumeTranslation(translation);
    }
  } catch (error) {
    console.error("[TranslationAutoResume] Error checking translations:", error);
  }
}
