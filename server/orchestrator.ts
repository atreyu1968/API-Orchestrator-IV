import { storage } from "./storage";
import { 
  ArchitectAgent, 
  GhostwriterAgent, 
  EditorAgent, 
  CopyEditorAgent, 
  FinalReviewerAgent, 
  ContinuitySentinelAgent,
  VoiceRhythmAuditorAgent,
  SemanticRepetitionDetectorAgent,
  type EditorResult, 
  type FinalReviewerResult,
  type ContinuitySentinelResult,
  type VoiceRhythmAuditorResult,
  type SemanticRepetitionResult
} from "./agents";
import type { TokenUsage } from "./agents/base-agent";
import type { Project, WorldBible, Chapter, PlotOutline, Character, WorldRule, TimelineEvent } from "@shared/schema";

interface OrchestratorCallbacks {
  onAgentStatus: (role: string, status: string, message?: string) => void;
  onChapterComplete: (chapterNumber: number, wordCount: number, chapterTitle: string) => void;
  onChapterRewrite: (chapterNumber: number, chapterTitle: string, currentIndex: number, totalToRewrite: number, reason: string) => void;
  onChapterStatusChange: (chapterNumber: number, status: string) => void;
  onProjectComplete: () => void;
  onError: (error: string) => void;
}

interface ParsedWorldBible {
  world_bible: {
    personajes: any[];
    lugares: any[];
    reglas_lore: any[];
  };
  escaleta_capitulos: any[];
  premisa?: string;
  estructura_tres_actos?: any;
}

interface SectionData {
  numero: number;
  titulo: string;
  cronologia: string;
  ubicacion: string;
  elenco_presente: string[];
  objetivo_narrativo: string;
  beats: string[];
  continuidad_salida?: string;
  continuidad_entrada?: string;
  tipo?: "prologue" | "chapter" | "epilogue" | "author_note";
  funcion_estructural?: string;
  informacion_nueva?: string;
  pregunta_dramatica?: string;
  conflicto_central?: {
    tipo?: string;
    descripcion?: string;
    stakes?: string;
  };
  giro_emocional?: {
    emocion_inicio?: string;
    emocion_final?: string;
  };
  recursos_literarios_sugeridos?: string[];
  tono_especifico?: string;
  prohibiciones_este_capitulo?: string[];
  arcos_que_avanza?: Array<{
    arco?: string;
    de?: string;
    a?: string;
  }>;
  riesgos_de_verosimilitud?: {
    posibles_deus_ex_machina?: string[];
    setup_requerido?: string[];
    justificacion_causal?: string;
  };
}

export class Orchestrator {
  private architect = new ArchitectAgent();
  private ghostwriter = new GhostwriterAgent();
  private editor = new EditorAgent();
  private copyeditor = new CopyEditorAgent();
  private finalReviewer = new FinalReviewerAgent();
  private continuitySentinel = new ContinuitySentinelAgent();
  private voiceRhythmAuditor = new VoiceRhythmAuditorAgent();
  private semanticRepetitionDetector = new SemanticRepetitionDetectorAgent();
  private callbacks: OrchestratorCallbacks;
  private maxRefinementLoops = 3;
  private maxFinalReviewCycles = 3;
  private continuityCheckpointInterval = 5;
  private currentProjectGenre = "";
  
  private cumulativeTokens = {
    inputTokens: 0,
    outputTokens: 0,
    thinkingTokens: 0,
  };

  private static readonly HISTORICAL_VOCABULARY: Record<string, { valid: string[], forbidden: string[], alternatives: Record<string, string> }> = {
    historical_thriller: {
      valid: [
        "veneno", "pócima", "brebaje", "ungüento", "cataplasma",
        "hierba venenosa", "extracto letal", "sustancia mortífera",
        "el hongo del centeno", "el cornezuelo", "la cicuta", "el acónito",
        "humores", "miasma", "putrefacción", "gangrena",
        "médico", "galeno", "sanador", "boticario", "herbolario",
        "bisturí", "escalpelo", "lanceta", "cauterio", "sanguijuela",
        "pergamino", "códice", "tablilla", "estilete", "cálamo",
        "denario", "sestercio", "as", "áureo",
        "toga", "túnica", "estola", "palla", "calcei",
        "ínsula", "domus", "villa", "thermae", "foro",
        "legado", "pretor", "edil", "cuestor", "tribuno"
      ],
      forbidden: [
        "formol", "formaldehído", "metrónomo", "Claviceps purpurea",
        "bacteria", "virus", "célula", "microscopio", "antibiótico",
        "ADN", "gen", "cromosoma", "proteína", "enzima",
        "oxígeno", "hidrógeno", "nitrógeno", "carbono", "molécula",
        "parálisis de análisis", "estrés", "trauma", "psicología",
        "kilómetro", "metro", "centímetro", "gramo", "litro",
        "reloj", "minuto", "segundo", "hora exacta",
        "electricidad", "voltaje", "batería", "motor",
        "nomenclatura binomial", "taxonomía científica moderna"
      ],
      alternatives: {
        "Claviceps purpurea": "el hongo del centeno / cornezuelo",
        "formol": "ungüento de conservación / aceites aromáticos",
        "bacteria": "miasma / corrupción del aire / humores pútridos",
        "virus": "pestilencia / mal invisible / aire corrupto",
        "estrés": "agotamiento / tensión del ánimo / fatiga nerviosa",
        "trauma": "herida del alma / cicatriz interior / shock",
        "minutos": "el tiempo de un rezo / un suspiro / un instante",
        "microscopio": "lupa / cristal de aumento",
        "análisis": "examen / escrutinio / inspección minuciosa"
      }
    },
    historical: {
      valid: [
        "carta", "misiva", "telegrama", "telégrafo",
        "automóvil", "carruaje", "tranvía", "ferrocarril",
        "peseta", "real", "duro", "céntimo",
        "fonógrafo", "gramófono", "cinematógrafo",
        "corsé", "polisón", "levita", "chistera", "bombín"
      ],
      forbidden: [
        "internet", "ordenador", "teléfono móvil", "smartphone",
        "avión comercial", "helicóptero", "televisión",
        "plástico", "nylon", "poliéster", "sintético",
        "antibiótico", "penicilina", "vacuna moderna",
        "psicoanálisis", "inconsciente", "complejo de Edipo"
      ],
      alternatives: {
        "estrés": "nerviosismo / agitación / desasosiego",
        "trauma": "conmoción / impresión terrible",
        "email": "carta / telegrama urgente"
      }
    },
    thriller: {
      valid: [],
      forbidden: [],
      alternatives: {}
    },
    mystery: {
      valid: [],
      forbidden: [],
      alternatives: {}
    },
    romance: {
      valid: [],
      forbidden: [],
      alternatives: {}
    },
    fantasy: {
      valid: [],
      forbidden: [],
      alternatives: {}
    },
    scifi: {
      valid: [],
      forbidden: [],
      alternatives: {}
    }
  };

  constructor(callbacks: OrchestratorCallbacks) {
    this.callbacks = callbacks;
  }
  
  private async trackTokenUsage(projectId: number, tokenUsage?: TokenUsage): Promise<void> {
    if (!tokenUsage) return;
    
    this.cumulativeTokens.inputTokens += tokenUsage.inputTokens;
    this.cumulativeTokens.outputTokens += tokenUsage.outputTokens;
    this.cumulativeTokens.thinkingTokens += tokenUsage.thinkingTokens;
    
    await storage.updateProject(projectId, {
      totalInputTokens: this.cumulativeTokens.inputTokens,
      totalOutputTokens: this.cumulativeTokens.outputTokens,
      totalThinkingTokens: this.cumulativeTokens.thinkingTokens,
    });
  }
  
  private resetTokenTracking(): void {
    this.cumulativeTokens = {
      inputTokens: 0,
      outputTokens: 0,
      thinkingTokens: 0,
    };
  }

  async generateNovel(project: Project): Promise<void> {
    try {
      this.resetTokenTracking();
      this.currentProjectGenre = project.genre;
      await storage.updateProject(project.id, { status: "generating" });

      let styleGuideContent = "";
      let authorName = "";
      let extendedGuideContent = "";
      
      if (project.styleGuideId) {
        const styleGuide = await storage.getStyleGuide(project.styleGuideId);
        if (styleGuide) {
          styleGuideContent = styleGuide.content;
        }
      }
      
      if (project.pseudonymId) {
        const pseudonym = await storage.getPseudonym(project.pseudonymId);
        if (pseudonym) {
          authorName = pseudonym.name;
        }
      }

      if ((project as any).extendedGuideId) {
        const extendedGuide = await storage.getExtendedGuide((project as any).extendedGuideId);
        if (extendedGuide) {
          extendedGuideContent = extendedGuide.content;
          console.log(`[Orchestrator] Using extended guide: "${extendedGuide.title}" (${extendedGuide.wordCount} words)`);
        }
      }

      const effectivePremise = extendedGuideContent 
        ? `${project.premise || ""}\n\n--- GUÍA DE ESCRITURA EXTENDIDA ---\n${extendedGuideContent}`
        : (project.premise || "");

      this.callbacks.onAgentStatus("architect", "thinking", "El Arquitecto está diseñando la estructura narrativa...");
      
      const architectResult = await this.architect.execute({
        title: project.title,
        premise: effectivePremise,
        genre: project.genre,
        tone: project.tone,
        chapterCount: project.chapterCount,
        hasPrologue: project.hasPrologue,
        hasEpilogue: project.hasEpilogue,
        hasAuthorNote: project.hasAuthorNote,
      });

      await this.trackTokenUsage(project.id, architectResult.tokenUsage);

      if (architectResult.thoughtSignature) {
        await storage.createThoughtLog({
          projectId: project.id,
          agentName: "El Arquitecto",
          agentRole: "architect",
          thoughtContent: architectResult.thoughtSignature,
        });
      }

      const worldBibleData = this.parseArchitectOutput(architectResult.content);
      
      const worldBible = await storage.createWorldBible({
        projectId: project.id,
        timeline: this.convertTimeline(worldBibleData),
        characters: this.convertCharacters(worldBibleData),
        worldRules: this.convertWorldRules(worldBibleData),
        plotOutline: this.convertPlotOutline(worldBibleData),
      });

      this.callbacks.onAgentStatus("architect", "completed", "Estructura narrativa completada");

      const allSections = this.buildSectionsList(project, worldBibleData);
      const chapters: Chapter[] = [];
      
      for (let i = 0; i < allSections.length; i++) {
        const section = allSections[i];
        const chapter = await storage.createChapter({
          projectId: project.id,
          chapterNumber: section.numero,
          title: section.titulo,
          status: "pending",
        });
        chapters.push(chapter);
      }

      let previousContinuity = "";
      let previousContinuityStateForEditor: any = null;
      let accumulatedContinuityIssues: string[] = [];
      
      const baseStyleGuide = `Género: ${project.genre}, Tono: ${project.tone}`;
      const fullStyleGuide = styleGuideContent 
        ? `${baseStyleGuide}\n\n--- GUÍA DE ESTILO DEL AUTOR ---\n${styleGuideContent}`
        : baseStyleGuide;

      for (let i = 0; i < chapters.length; i++) {
        const chapter = chapters[i];
        const sectionData = allSections[i];

        await storage.updateChapter(chapter.id, { status: "writing" });
        await storage.updateProject(project.id, { currentChapter: i + 1 });

        const sectionLabel = this.getSectionLabel(sectionData);
        this.callbacks.onAgentStatus("ghostwriter", "writing", `El Narrador está escribiendo ${sectionLabel}...`);

        let chapterContent = "";
        let approved = false;
        let refinementAttempts = 0;
        let refinementInstructions = "";

        let extractedContinuityState: any = null;
        
        let bestVersion = { content: "", score: 0, continuityState: null as any };
        
        while (!approved && refinementAttempts < this.maxRefinementLoops) {
          const baseStyleGuide = `Género: ${project.genre}, Tono: ${project.tone}`;
          const fullStyleGuide = styleGuideContent 
            ? `${baseStyleGuide}\n\n--- GUÍA DE ESTILO DEL AUTOR ---\n${styleGuideContent}`
            : baseStyleGuide;

          const isRewrite = refinementAttempts > 0;
          const writerResult = await this.ghostwriter.execute({
            chapterNumber: sectionData.numero,
            chapterData: sectionData,
            worldBible: worldBibleData.world_bible,
            guiaEstilo: fullStyleGuide,
            previousContinuity,
            refinementInstructions,
            authorName,
            isRewrite,
          });

          const { cleanContent, continuityState } = this.ghostwriter.extractContinuityState(writerResult.content);
          const currentContent = cleanContent;
          const currentContinuityState = continuityState;
          
          await this.trackTokenUsage(project.id, writerResult.tokenUsage);

          if (writerResult.thoughtSignature) {
            await storage.createThoughtLog({
              projectId: project.id,
              chapterId: chapter.id,
              agentName: "El Narrador",
              agentRole: "ghostwriter",
              thoughtContent: writerResult.thoughtSignature,
            });
          }

          await storage.updateChapter(chapter.id, { status: "editing" });
          this.callbacks.onAgentStatus("editor", "editing", `El Editor está revisando ${sectionLabel}...`);

          const editorResult = await this.editor.execute({
            chapterNumber: sectionData.numero,
            chapterContent: currentContent,
            chapterData: sectionData,
            worldBible: worldBibleData.world_bible,
            guiaEstilo: `Género: ${project.genre}, Tono: ${project.tone}`,
            previousContinuityState: previousContinuityStateForEditor,
          });

          await this.trackTokenUsage(project.id, editorResult.tokenUsage);

          if (editorResult.thoughtSignature) {
            await storage.createThoughtLog({
              projectId: project.id,
              chapterId: chapter.id,
              agentName: "El Editor",
              agentRole: "editor",
              thoughtContent: editorResult.thoughtSignature,
            });
          }

          const currentScore = editorResult.result?.puntuacion || 0;
          
          if (currentScore >= bestVersion.score) {
            bestVersion = { 
              content: currentContent, 
              score: currentScore, 
              continuityState: currentContinuityState 
            };
            console.log(`[Orchestrator] New best version for ${sectionLabel}: ${currentScore}/10`);
          } else {
            console.log(`[Orchestrator] Keeping previous best version (${bestVersion.score}/10) over current (${currentScore}/10)`);
          }

          if (editorResult.result?.aprobado) {
            approved = true;
            this.callbacks.onAgentStatus("editor", "completed", `${sectionLabel} aprobado (${currentScore}/10)`);
          } else {
            refinementAttempts++;
            
            refinementInstructions = this.buildRefinementInstructions(editorResult.result);
            
            this.callbacks.onAgentStatus("editor", "editing", 
              `${sectionLabel} rechazado (${currentScore}/10). Mejor: ${bestVersion.score}/10. Intento ${refinementAttempts}/${this.maxRefinementLoops}.`
            );

            if (refinementAttempts < this.maxRefinementLoops) {
              this.callbacks.onAgentStatus("ghostwriter", "writing", 
                `El Narrador está reescribiendo ${sectionLabel} siguiendo el Plan Quirúrgico...`
              );
            }
          }
        }
        
        chapterContent = bestVersion.content;
        extractedContinuityState = bestVersion.continuityState;
        console.log(`[Orchestrator] Using best version for ${sectionLabel}: ${bestVersion.score}/10`);

        this.callbacks.onAgentStatus("copyeditor", "polishing", `El Estilista está puliendo ${sectionLabel}...`);

        const polishResult = await this.copyeditor.execute({
          chapterContent,
          chapterNumber: sectionData.numero,
          chapterTitle: sectionData.titulo,
          guiaEstilo: styleGuideContent || undefined,
        });

        await this.trackTokenUsage(project.id, polishResult.tokenUsage);

        if (polishResult.thoughtSignature) {
          await storage.createThoughtLog({
            projectId: project.id,
            chapterId: chapter.id,
            agentName: "El Estilista",
            agentRole: "copyeditor",
            thoughtContent: polishResult.thoughtSignature,
          });
        }

        const finalContent = polishResult.result?.texto_final || chapterContent;
        const wordCount = finalContent.split(/\s+/).length;

        await storage.updateChapter(chapter.id, {
          content: finalContent,
          wordCount,
          status: "completed",
          continuityState: extractedContinuityState,
        });

        if (extractedContinuityState) {
          previousContinuity = JSON.stringify(extractedContinuityState);
          previousContinuityStateForEditor = extractedContinuityState;
          console.log(`[Orchestrator] Passing continuity state to next chapter: ${Object.keys(extractedContinuityState.characterStates || {}).length} characters tracked`);
        } else {
          previousContinuity = sectionData.continuidad_salida || 
            `${sectionLabel} completado. Los personajes terminaron en: ${sectionData.ubicacion}`;
          previousContinuityStateForEditor = null;
        }

        this.callbacks.onChapterComplete(i + 1, wordCount, sectionData.titulo);
        this.callbacks.onAgentStatus("copyeditor", "completed", `${sectionLabel} finalizado (${wordCount} palabras)`);

        await this.updateWorldBibleTimeline(project.id, worldBible.id, sectionData.numero, sectionData);
        
        const completedChaptersCount = i + 1;
        if (completedChaptersCount > 0 && completedChaptersCount % this.continuityCheckpointInterval === 0) {
          const completedChaptersForCheckpoint = await storage.getChaptersByProject(project.id);
          const chaptersInScope = completedChaptersForCheckpoint
            .filter(c => c.status === "completed" && c.chapterNumber > 0)
            .sort((a, b) => a.chapterNumber - b.chapterNumber)
            .slice(-this.continuityCheckpointInterval);
          
          if (chaptersInScope.length >= this.continuityCheckpointInterval) {
            const checkpointNumber = Math.floor(completedChaptersCount / this.continuityCheckpointInterval);
            const checkpointResult = await this.runContinuityCheckpoint(
              project,
              checkpointNumber,
              chaptersInScope,
              worldBibleData,
              accumulatedContinuityIssues
            );
            
            if (!checkpointResult.passed && checkpointResult.chaptersToRevise.length > 0) {
              accumulatedContinuityIssues = [...accumulatedContinuityIssues, ...checkpointResult.issues];
              
              const hasCriticalIssues = checkpointResult.issues.some(issue => 
                issue.includes("[CRITICA]") || issue.includes("[CRÍTICA]")
              );
              
              if (hasCriticalIssues) {
                this.callbacks.onAgentStatus("continuity-sentinel", "editing", 
                  `Disparando correcciones inmediatas para ${checkpointResult.chaptersToRevise.length} capítulos con errores críticos`
                );
                
                for (const chapterNum of checkpointResult.chaptersToRevise) {
                  const chapterToFix = chaptersInScope.find(c => c.chapterNumber === chapterNum);
                  const sectionForFix = allSections.find(s => s.numero === chapterNum);
                  
                  if (chapterToFix && sectionForFix) {
                    const issuesForChapter = checkpointResult.issues.filter(issue => 
                      issue.includes(`capítulo ${chapterNum}`) || issue.includes(`Cap ${chapterNum}`)
                    ).join("\n");
                    
                    await this.rewriteChapterForQA(
                      project,
                      chapterToFix,
                      sectionForFix,
                      worldBibleData,
                      fullStyleGuide,
                      "continuity",
                      issuesForChapter || checkpointResult.issues.join("\n")
                    );
                  }
                }
              }
            }
          }
        }
      }

      const allCompletedChapters = await storage.getChaptersByProject(project.id);
      const completedForAnalysis = allCompletedChapters.filter(c => c.status === "completed" && c.content);
      
      if (completedForAnalysis.length >= 5) {
        const trancheSize = 10;
        const totalTranches = Math.ceil(completedForAnalysis.length / trancheSize);
        
        for (let t = 0; t < totalTranches; t++) {
          const trancheChapters = completedForAnalysis.slice(t * trancheSize, (t + 1) * trancheSize);
          if (trancheChapters.length > 0) {
            const voiceResult = await this.runVoiceRhythmAudit(project, t + 1, trancheChapters, styleGuideContent);
            
            if (!voiceResult.passed && voiceResult.chaptersToRevise.length > 0) {
              this.callbacks.onAgentStatus("voice-auditor", "editing", 
                `Puliendo ${voiceResult.chaptersToRevise.length} capítulos con problemas de voz/ritmo`
              );
              
              for (const chapterNum of voiceResult.chaptersToRevise) {
                const chapterToPolish = trancheChapters.find(c => c.chapterNumber === chapterNum);
                if (chapterToPolish) {
                  const issuesForChapter = voiceResult.issues.filter(issue => 
                    issue.includes(`capítulo ${chapterNum}`) || issue.includes(`Cap ${chapterNum}`)
                  ).join("\n");
                  
                  await this.polishChapterForVoice(
                    project,
                    chapterToPolish,
                    styleGuideContent,
                    issuesForChapter || voiceResult.issues.join("\n")
                  );
                }
              }
            }
          }
        }
      }

      const refreshedChaptersForSemantic = await storage.getChaptersByProject(project.id);
      const completedForSemanticAnalysis = refreshedChaptersForSemantic.filter(c => c.status === "completed" && c.content);

      if (completedForSemanticAnalysis.length > 0) {
        const semanticResult = await this.runSemanticRepetitionAnalysis(project, completedForSemanticAnalysis, worldBibleData);
        
        if (!semanticResult.passed && semanticResult.chaptersToRevise.length > 0) {
          this.callbacks.onAgentStatus("semantic-detector", "editing", 
            `Corrigiendo ${semanticResult.chaptersToRevise.length} capítulos con repeticiones semánticas`
          );
          
          for (const chapterNum of semanticResult.chaptersToRevise) {
            const chapterToFix = completedForAnalysis.find(c => c.chapterNumber === chapterNum);
            const sectionForFix = allSections.find(s => s.numero === chapterNum);
            
            if (chapterToFix && sectionForFix) {
              const freshChapter = await storage.getChaptersByProject(project.id)
                .then(chs => chs.find(c => c.chapterNumber === chapterNum));
              if (!freshChapter) continue;
              
              const clusterIssues = semanticResult.clusters
                .filter(c => c.capitulos_afectados?.includes(chapterNum))
                .map(c => `Repetición de idea: "${c.idea_repetida}" aparece ${c.frecuencia || "múltiples"} veces`)
                .join("\n");
              
              const foreshadowingIssues = semanticResult.foreshadowingStatus
                .filter(f => f.estado === "sin_payoff")
                .map(f => `Foreshadowing sin resolver: "${f.descripcion}" (plantado en cap ${f.capitulo_sembrado})`)
                .join("\n");
              
              const allIssues = [clusterIssues, foreshadowingIssues].filter(Boolean).join("\n\n");
              
              if (allIssues) {
                await this.rewriteChapterForQA(
                  project,
                  freshChapter,
                  sectionForFix,
                  worldBibleData,
                  fullStyleGuide,
                  "semantic",
                  allIssues
                );
              }
            }
          }
        }
      }

      const finalReviewApproved = await this.runFinalReview(
        project, 
        chapters, 
        worldBibleData, 
        fullStyleGuide, 
        allSections,
        styleGuideContent,
        authorName
      );

      if (finalReviewApproved) {
        await storage.updateProject(project.id, { status: "completed" });
        this.callbacks.onProjectComplete();
      } else {
        await storage.updateProject(project.id, { status: "failed_final_review" });
        this.callbacks.onError("El manuscrito no pasó la revisión final después de múltiples intentos.");
      }

    } catch (error) {
      console.error("[Orchestrator] Error:", error);
      await storage.updateProject(project.id, { status: "error" });
      this.callbacks.onError(error instanceof Error ? error.message : "Error desconocido");
    }
  }

  async resumeNovel(project: Project): Promise<void> {
    try {
      const existingTokens = {
        inputTokens: project.totalInputTokens || 0,
        outputTokens: project.totalOutputTokens || 0,
        thinkingTokens: project.totalThinkingTokens || 0,
      };
      this.cumulativeTokens = existingTokens;
      
      await storage.updateProject(project.id, { status: "generating" });

      const worldBible = await storage.getWorldBibleByProject(project.id);
      if (!worldBible) {
        this.callbacks.onError("No se encontró el World Bible del proyecto. Debe iniciar una nueva generación.");
        await storage.updateProject(project.id, { status: "error" });
        return;
      }

      const existingChapters = await storage.getChaptersByProject(project.id);
      if (existingChapters.length === 0) {
        this.callbacks.onError("No se encontraron capítulos. Debe iniciar una nueva generación.");
        await storage.updateProject(project.id, { status: "error" });
        return;
      }

      let styleGuideContent = "";
      let authorName = "";
      
      if (project.styleGuideId) {
        const styleGuide = await storage.getStyleGuide(project.styleGuideId);
        if (styleGuide) styleGuideContent = styleGuide.content;
      }
      
      if (project.pseudonymId) {
        const pseudonym = await storage.getPseudonym(project.pseudonymId);
        if (pseudonym) authorName = pseudonym.name;
      }

      const pendingChapters = existingChapters
        .filter(c => c.status !== "completed")
        .sort((a, b) => {
          const orderA = a.chapterNumber === 0 ? -1000 : a.chapterNumber === -1 ? 1000 : a.chapterNumber === -2 ? 1001 : a.chapterNumber;
          const orderB = b.chapterNumber === 0 ? -1000 : b.chapterNumber === -1 ? 1000 : b.chapterNumber === -2 ? 1001 : b.chapterNumber;
          return orderA - orderB;
        });

      if (pendingChapters.length === 0) {
        this.callbacks.onAgentStatus("orchestrator", "completed", "Todos los capítulos ya están completados.");
        await storage.updateProject(project.id, { status: "completed" });
        this.callbacks.onProjectComplete();
        return;
      }

      const completedChapters = existingChapters.filter(c => c.status === "completed");
      const lastCompleted = completedChapters.length > 0 
        ? completedChapters.sort((a, b) => b.chapterNumber - a.chapterNumber)[0]
        : null;
      
      let previousContinuity = lastCompleted?.continuityState 
        ? JSON.stringify(lastCompleted.continuityState)
        : lastCompleted?.content 
          ? `Capítulo anterior completado. Contenido termina con: ${lastCompleted.content.slice(-500)}`
          : "";
      
      let previousContinuityStateForEditor: any = lastCompleted?.continuityState || null;

      this.callbacks.onAgentStatus("orchestrator", "resuming", 
        `Retomando generación. ${pendingChapters.length} capítulos pendientes de ${existingChapters.length} totales.`
      );

      const worldBibleData = this.reconstructWorldBibleData(worldBible, project);

      for (const chapter of pendingChapters) {
        const sectionData = this.buildSectionDataFromChapter(chapter, worldBibleData);
        
        await storage.updateChapter(chapter.id, { status: "writing" });

        const sectionLabel = this.getSectionLabel(sectionData);
        this.callbacks.onAgentStatus("ghostwriter", "writing", `El Narrador está escribiendo ${sectionLabel}...`);

        let chapterContent = "";
        let approved = false;
        let refinementAttempts = 0;
        let refinementInstructions = "";
        let extractedContinuityState: any = null;
        
        let bestVersion = { content: "", score: 0, continuityState: null as any };

        while (!approved && refinementAttempts < this.maxRefinementLoops) {
          const baseStyleGuide = `Género: ${project.genre}, Tono: ${project.tone}`;
          const fullStyleGuide = styleGuideContent 
            ? `${baseStyleGuide}\n\n--- GUÍA DE ESTILO DEL AUTOR ---\n${styleGuideContent}`
            : baseStyleGuide;

          const isRewrite = refinementAttempts > 0;
          const writerResult = await this.ghostwriter.execute({
            chapterNumber: sectionData.numero,
            chapterData: sectionData,
            worldBible: worldBibleData.world_bible,
            guiaEstilo: fullStyleGuide,
            previousContinuity,
            refinementInstructions,
            authorName,
            isRewrite,
          });

          const { cleanContent, continuityState } = this.ghostwriter.extractContinuityState(writerResult.content);
          const currentContent = cleanContent;
          const currentContinuityState = continuityState;
          
          await this.trackTokenUsage(project.id, writerResult.tokenUsage);

          if (writerResult.thoughtSignature) {
            await storage.createThoughtLog({
              projectId: project.id,
              chapterId: chapter.id,
              agentName: "El Narrador",
              agentRole: "ghostwriter",
              thoughtContent: writerResult.thoughtSignature,
            });
          }

          await storage.updateChapter(chapter.id, { status: "editing" });
          this.callbacks.onAgentStatus("editor", "editing", `El Editor está revisando ${sectionLabel}...`);

          const editorResult = await this.editor.execute({
            chapterNumber: sectionData.numero,
            chapterContent: currentContent,
            chapterData: sectionData,
            worldBible: worldBibleData.world_bible,
            guiaEstilo: `Género: ${project.genre}, Tono: ${project.tone}`,
            previousContinuityState: previousContinuityStateForEditor,
          });

          await this.trackTokenUsage(project.id, editorResult.tokenUsage);

          if (editorResult.thoughtSignature) {
            await storage.createThoughtLog({
              projectId: project.id,
              chapterId: chapter.id,
              agentName: "El Editor",
              agentRole: "editor",
              thoughtContent: editorResult.thoughtSignature,
            });
          }

          const currentScore = editorResult.result?.puntuacion || 0;
          
          if (currentScore >= bestVersion.score) {
            bestVersion = { 
              content: currentContent, 
              score: currentScore, 
              continuityState: currentContinuityState 
            };
            console.log(`[Orchestrator Resume] New best version for ${sectionLabel}: ${currentScore}/10`);
          } else {
            console.log(`[Orchestrator Resume] Keeping previous best version (${bestVersion.score}/10) over current (${currentScore}/10)`);
          }

          if (editorResult.result?.aprobado) {
            approved = true;
            this.callbacks.onAgentStatus("editor", "completed", `${sectionLabel} aprobado (${currentScore}/10)`);
          } else {
            refinementAttempts++;
            refinementInstructions = this.buildRefinementInstructions(editorResult.result);
            this.callbacks.onAgentStatus("editor", "editing", 
              `${sectionLabel} rechazado (${currentScore}/10). Mejor: ${bestVersion.score}/10. Intento ${refinementAttempts}/${this.maxRefinementLoops}.`
            );
          }
        }
        
        chapterContent = bestVersion.content;
        extractedContinuityState = bestVersion.continuityState;
        console.log(`[Orchestrator Resume] Using best version for ${sectionLabel}: ${bestVersion.score}/10`);

        this.callbacks.onAgentStatus("copyeditor", "polishing", `El Estilista está puliendo ${sectionLabel}...`);

        const polishResult = await this.copyeditor.execute({
          chapterContent,
          chapterNumber: sectionData.numero,
          chapterTitle: sectionData.titulo,
          guiaEstilo: styleGuideContent || undefined,
        });

        await this.trackTokenUsage(project.id, polishResult.tokenUsage);

        if (polishResult.thoughtSignature) {
          await storage.createThoughtLog({
            projectId: project.id,
            chapterId: chapter.id,
            agentName: "El Estilista",
            agentRole: "copyeditor",
            thoughtContent: polishResult.thoughtSignature,
          });
        }

        const finalContent = polishResult.result?.texto_final || chapterContent;
        const wordCount = finalContent.split(/\s+/).length;

        await storage.updateChapter(chapter.id, {
          content: finalContent,
          wordCount,
          status: "completed",
          continuityState: extractedContinuityState,
        });

        if (extractedContinuityState) {
          previousContinuity = JSON.stringify(extractedContinuityState);
          previousContinuityStateForEditor = extractedContinuityState;
          console.log(`[Orchestrator Resume] Passing continuity state to next chapter`);
        } else {
          previousContinuity = `${sectionLabel} completado.`;
          previousContinuityStateForEditor = null;
        }

        const freshChapters = await storage.getChaptersByProject(project.id);
        const completedCount = freshChapters.filter(c => c.status === "completed").length;
        this.callbacks.onChapterComplete(completedCount, wordCount, sectionData.titulo);
        this.callbacks.onAgentStatus("copyeditor", "completed", `${sectionLabel} finalizado (${wordCount} palabras)`);

        // QA: Continuity Sentinel checkpoint every 5 chapters
        if (completedCount > 0 && completedCount % this.continuityCheckpointInterval === 0) {
          const chaptersForCheckpoint = freshChapters
            .filter(c => c.status === "completed" && c.chapterNumber > 0)
            .sort((a, b) => a.chapterNumber - b.chapterNumber)
            .slice(-this.continuityCheckpointInterval);
          
          if (chaptersForCheckpoint.length >= this.continuityCheckpointInterval) {
            const checkpointNumber = Math.floor(completedCount / this.continuityCheckpointInterval);
            const checkpointResult = await this.runContinuityCheckpoint(
              project,
              checkpointNumber,
              chaptersForCheckpoint,
              worldBibleData,
              []
            );
            
            if (!checkpointResult.passed && checkpointResult.chaptersToRevise.length > 0) {
              const hasCriticalIssues = checkpointResult.issues.some(issue => 
                issue.includes("[CRITICA]") || issue.includes("[CRÍTICA]")
              );
              
              if (hasCriticalIssues) {
                this.callbacks.onAgentStatus("continuity-sentinel", "editing", 
                  `Disparando correcciones para ${checkpointResult.chaptersToRevise.length} capítulos con errores críticos`
                );
                
                for (const chapterNum of checkpointResult.chaptersToRevise) {
                  const chapterToFix = chaptersForCheckpoint.find(c => c.chapterNumber === chapterNum);
                  const sectionForFix = this.buildSectionDataFromChapter(chapterToFix!, worldBibleData);
                  
                  if (chapterToFix) {
                    const issuesForChapter = checkpointResult.issues.filter(issue => 
                      issue.includes(`capítulo ${chapterNum}`) || issue.includes(`Cap ${chapterNum}`)
                    ).join("\n");
                    
                    const baseStyleGuide = `Género: ${project.genre}, Tono: ${project.tone}`;
                    const fullStyleGuide = styleGuideContent 
                      ? `${baseStyleGuide}\n\n--- GUÍA DE ESTILO DEL AUTOR ---\n${styleGuideContent}`
                      : baseStyleGuide;
                    
                    await this.rewriteChapterForQA(
                      project,
                      chapterToFix,
                      sectionForFix,
                      worldBibleData,
                      fullStyleGuide,
                      "continuity",
                      issuesForChapter || checkpointResult.issues.join("\n")
                    );
                  }
                }
              }
            }
          }
        }
      }

      // QA: Voice & Rhythm Auditor after all chapters complete
      const allCompletedChapters = await storage.getChaptersByProject(project.id);
      const completedForAnalysis = allCompletedChapters.filter(c => c.status === "completed" && c.content);
      
      if (completedForAnalysis.length >= 5) {
        const trancheSize = 10;
        const totalTranches = Math.ceil(completedForAnalysis.length / trancheSize);
        
        for (let t = 0; t < totalTranches; t++) {
          const trancheChapters = completedForAnalysis.slice(t * trancheSize, (t + 1) * trancheSize);
          if (trancheChapters.length > 0) {
            const voiceResult = await this.runVoiceRhythmAudit(project, t + 1, trancheChapters, styleGuideContent);
            
            if (!voiceResult.passed && voiceResult.chaptersToRevise.length > 0) {
              this.callbacks.onAgentStatus("voice-auditor", "editing", 
                `Puliendo ${voiceResult.chaptersToRevise.length} capítulos con problemas de voz/ritmo`
              );
              
              for (const chapterNum of voiceResult.chaptersToRevise) {
                const chapterToPolish = trancheChapters.find(c => c.chapterNumber === chapterNum);
                if (chapterToPolish) {
                  const issuesForChapter = voiceResult.issues.filter(issue => 
                    issue.includes(`capítulo ${chapterNum}`) || issue.includes(`Cap ${chapterNum}`)
                  ).join("\n");
                  
                  await this.polishChapterForVoice(
                    project,
                    chapterToPolish,
                    styleGuideContent,
                    issuesForChapter || voiceResult.issues.join("\n")
                  );
                }
              }
            }
          }
        }
      }

      // QA: Semantic Repetition Detector
      const refreshedChaptersForSemantic = await storage.getChaptersByProject(project.id);
      const completedForSemanticAnalysis = refreshedChaptersForSemantic.filter(c => c.status === "completed" && c.content);

      if (completedForSemanticAnalysis.length > 0) {
        const semanticResult = await this.runSemanticRepetitionAnalysis(project, completedForSemanticAnalysis, worldBibleData);
        
        if (!semanticResult.passed && semanticResult.chaptersToRevise.length > 0) {
          this.callbacks.onAgentStatus("semantic-detector", "editing", 
            `Corrigiendo ${semanticResult.chaptersToRevise.length} capítulos con repeticiones semánticas`
          );
          
          for (const chapterNum of semanticResult.chaptersToRevise) {
            const chapterToFix = completedForSemanticAnalysis.find(c => c.chapterNumber === chapterNum);
            
            if (chapterToFix) {
              const sectionForFix = this.buildSectionDataFromChapter(chapterToFix, worldBibleData);
              const freshChapter = await storage.getChaptersByProject(project.id)
                .then(chs => chs.find(c => c.chapterNumber === chapterNum));
              if (!freshChapter) continue;
              
              const clusterIssues = semanticResult.clusters
                .filter(c => c.capitulos_afectados?.includes(chapterNum))
                .map(c => `Repetición de idea: "${c.idea_repetida}" aparece ${c.frecuencia || "múltiples"} veces`)
                .join("\n");
              
              const foreshadowingIssues = semanticResult.foreshadowingStatus
                .filter(f => f.estado === "sin_payoff")
                .map(f => `Foreshadowing sin resolver: "${f.descripcion}" (plantado en cap ${f.capitulo_sembrado})`)
                .join("\n");
              
              const allIssues = [clusterIssues, foreshadowingIssues].filter(Boolean).join("\n\n");
              
              if (allIssues) {
                const baseStyleGuide = `Género: ${project.genre}, Tono: ${project.tone}`;
                const fullStyleGuide = styleGuideContent 
                  ? `${baseStyleGuide}\n\n--- GUÍA DE ESTILO DEL AUTOR ---\n${styleGuideContent}`
                  : baseStyleGuide;
                
                await this.rewriteChapterForQA(
                  project,
                  freshChapter,
                  sectionForFix,
                  worldBibleData,
                  fullStyleGuide,
                  "semantic",
                  allIssues
                );
              }
            }
          }
        }
      }

      // Final Review
      const finalChapters = await storage.getChaptersByProject(project.id);
      const allSections = (worldBibleData.escaleta_capitulos as any[]) || [];
      const baseStyleGuide = `Género: ${project.genre}, Tono: ${project.tone}`;
      const fullStyleGuide = styleGuideContent 
        ? `${baseStyleGuide}\n\n--- GUÍA DE ESTILO DEL AUTOR ---\n${styleGuideContent}`
        : baseStyleGuide;
      
      const finalReviewApproved = await this.runFinalReview(
        project, 
        finalChapters, 
        worldBibleData, 
        fullStyleGuide, 
        allSections,
        styleGuideContent,
        authorName
      );

      if (finalReviewApproved) {
        await storage.updateProject(project.id, { status: "completed" });
        this.callbacks.onProjectComplete();
      } else {
        await storage.updateProject(project.id, { status: "failed_final_review" });
        this.callbacks.onError("El manuscrito no pasó la revisión final después de múltiples intentos.");
      }

    } catch (error) {
      console.error("[Orchestrator] Resume error:", error);
      await storage.updateProject(project.id, { status: "error" });
      this.callbacks.onError(error instanceof Error ? error.message : "Error al retomar la generación");
    }
  }

  private reconstructWorldBibleData(worldBible: WorldBible, project: Project): ParsedWorldBible {
    const plotOutlineData = worldBible.plotOutline as any;
    const timeline = (worldBible.timeline as TimelineEvent[]) || [];
    
    const lugares = timeline
      .map((t: any) => t.ubicacion || t.location)
      .filter((loc: any) => loc)
      .filter((loc: string, i: number, arr: string[]) => arr.indexOf(loc) === i);
    
    // Reconstruir escaleta_capitulos desde chapterOutlines con todos los campos adicionales
    const escaleta_capitulos = (plotOutlineData?.chapterOutlines || []).map((c: any) => ({
      numero: c.number,
      titulo: c.titulo || c.summary || `Capítulo ${c.number}`,
      cronologia: c.cronologia || "",
      ubicacion: c.ubicacion || "",
      elenco_presente: c.elenco_presente || [],
      objetivo_narrativo: c.summary || "",
      beats: c.keyEvents || [],
      funcion_estructural: c.funcion_estructural,
      informacion_nueva: c.informacion_nueva,
      pregunta_dramatica: c.pregunta_dramatica,
      conflicto_central: c.conflicto_central,
      giro_emocional: c.giro_emocional,
      recursos_literarios_sugeridos: c.recursos_literarios_sugeridos,
      tono_especifico: c.tono_especifico,
      prohibiciones_este_capitulo: c.prohibiciones_este_capitulo,
      arcos_que_avanza: c.arcos_que_avanza,
      continuidad_entrada: c.continuidad_entrada,
      continuidad_salida: c.continuidad_salida,
      riesgos_de_verosimilitud: c.riesgos_de_verosimilitud,
    }));
    
    return {
      world_bible: {
        personajes: (worldBible.characters as Character[]) || [],
        lugares: lugares,
        reglas_lore: (worldBible.worldRules as WorldRule[]) || [],
      },
      escaleta_capitulos,
      premisa: plotOutlineData?.premise || project.premise || "",
    };
  }

  private buildSectionDataFromChapter(chapter: Chapter, worldBibleData: ParsedWorldBible): SectionData {
    const plotItem = (worldBibleData.escaleta_capitulos as any[])?.find(
      (p: any) => p.numero === chapter.chapterNumber
    );
    
    return {
      numero: chapter.chapterNumber,
      titulo: chapter.title || `Capítulo ${chapter.chapterNumber}`,
      cronologia: plotItem?.cronologia || "",
      ubicacion: plotItem?.ubicacion || "",
      elenco_presente: plotItem?.elenco_presente || [],
      objetivo_narrativo: plotItem?.objetivo_narrativo || "",
      beats: plotItem?.beats || [],
      continuidad_salida: plotItem?.continuidad_salida || "",
      tipo: chapter.chapterNumber === 0 ? "prologue" 
        : chapter.chapterNumber === -1 ? "epilogue" 
        : chapter.chapterNumber === -2 ? "author_note" 
        : "chapter",
      funcion_estructural: plotItem?.funcion_estructural,
      informacion_nueva: plotItem?.informacion_nueva,
      conflicto_central: plotItem?.conflicto_central,
      giro_emocional: plotItem?.giro_emocional,
      riesgos_de_verosimilitud: plotItem?.riesgos_de_verosimilitud,
    };
  }

  private async runFinalReview(
    project: Project,
    chapters: Chapter[],
    worldBibleData: ParsedWorldBible,
    guiaEstilo: string,
    allSections: SectionData[],
    styleGuideContent: string,
    authorName: string
  ): Promise<boolean> {
    let revisionCycle = 0;
    let issuesPreviosCorregidos: string[] = [];
    
    while (revisionCycle < this.maxFinalReviewCycles) {
      this.callbacks.onAgentStatus("final-reviewer", "reviewing", 
        `El Revisor Final está analizando el manuscrito completo... (Ciclo ${revisionCycle + 1}/${this.maxFinalReviewCycles})`
      );

      const updatedChapters = await storage.getChaptersByProject(project.id);
      const chaptersForReview = updatedChapters
        .filter(c => c.content)
        .sort((a, b) => a.chapterNumber - b.chapterNumber)
        .map(c => ({
          numero: c.chapterNumber,
          titulo: c.title || `Capítulo ${c.chapterNumber}`,
          contenido: c.content || "",
        }));

      const reviewResult = await this.finalReviewer.execute({
        projectTitle: project.title,
        chapters: chaptersForReview,
        worldBible: worldBibleData.world_bible,
        guiaEstilo,
        pasadaNumero: revisionCycle + 1,
        issuesPreviosCorregidos,
      });

      await this.trackTokenUsage(project.id, reviewResult.tokenUsage);

      if (reviewResult.thoughtSignature) {
        await storage.createThoughtLog({
          projectId: project.id,
          agentName: "El Revisor Final",
          agentRole: "final-reviewer",
          thoughtContent: reviewResult.thoughtSignature,
        });
      }

      const result = reviewResult.result;
      
      await storage.updateProject(project.id, { 
        revisionCycle: revisionCycle + 1,
        finalReviewResult: result as any,
        finalScore: result?.puntuacion_global ?? null
      });

      if (result?.veredicto === "APROBADO" || result?.veredicto === "APROBADO_CON_RESERVAS") {
        const mensaje = result.veredicto === "APROBADO_CON_RESERVAS"
          ? `Manuscrito APROBADO CON RESERVAS (${result.puntuacion_global}/10). Issues menores documentados.`
          : `Manuscrito APROBADO (${result.puntuacion_global}/10). Sin inconsistencias detectadas.`;
        this.callbacks.onAgentStatus("final-reviewer", "completed", mensaje);
        return true;
      }
      
      // TERMINACIÓN FORZADA en pasada 3: si el revisor devuelve REQUIERE_REVISION,
      // forzamos aprobación con advertencias ya que no se permiten más ciclos
      if (revisionCycle === this.maxFinalReviewCycles - 1) {
        this.callbacks.onAgentStatus("final-reviewer", "completed", 
          `Pasada final completada. Manuscrito aceptado con ${result?.issues?.length || 0} issues menores documentados (${result?.puntuacion_global || 7}/10).`
        );
        return true;
      }

      const issueCount = result?.issues?.length || 0;
      const chaptersToRewrite = result?.capitulos_para_reescribir || [];
      
      this.callbacks.onAgentStatus("final-reviewer", "editing", 
        `Manuscrito REQUIERE REVISIÓN. ${issueCount} problemas detectados en ${chaptersToRewrite.length || "varios"} capítulos.`
      );
      
      if (chaptersToRewrite.length === 0) {
        if (result?.issues && result.issues.length > 0) {
          const affectedChapters = new Set<number>();
          result.issues.forEach(issue => {
            issue.capitulos_afectados.forEach(ch => affectedChapters.add(ch));
          });
          
          if (affectedChapters.size > 0) {
            chaptersToRewrite.push(...Array.from(affectedChapters));
          } else {
            this.callbacks.onAgentStatus("final-reviewer", "error", 
              `Revisión rechazada pero sin capítulos específicos. Marcando como fallo.`
            );
            revisionCycle++;
            continue;
          }
        } else {
          this.callbacks.onAgentStatus("final-reviewer", "completed", 
            `Revisión completada sin problemas específicos.`
          );
          return true;
        }
      }

      for (let rewriteIndex = 0; rewriteIndex < chaptersToRewrite.length; rewriteIndex++) {
        const chapterNum = chaptersToRewrite[rewriteIndex];
        const chapter = updatedChapters.find(c => c.chapterNumber === chapterNum);
        const sectionData = allSections.find(s => s.numero === chapterNum);
        
        if (!chapter || !sectionData) continue;

        const issuesForChapter = result?.issues?.filter(
          i => i.capitulos_afectados.includes(chapterNum)
        ) || [];
        
        const revisionInstructions = issuesForChapter.map(issue => 
          `[${issue.categoria.toUpperCase()}] ${issue.descripcion}\nCORRECCIÓN: ${issue.instrucciones_correccion}`
        ).join("\n\n");

        const issuesSummary = issuesForChapter.map(i => i.categoria).join(", ") || "correcciones generales";

        await storage.updateChapter(chapter.id, { 
          status: "revision",
          needsRevision: true,
          revisionReason: revisionInstructions 
        });

        this.callbacks.onChapterStatusChange(chapterNum, "revision");

        const sectionLabel = this.getSectionLabel(sectionData);
        
        this.callbacks.onChapterRewrite(
          chapterNum, 
          sectionData.titulo, 
          rewriteIndex + 1, 
          chaptersToRewrite.length,
          issuesSummary
        );
        
        this.callbacks.onAgentStatus("ghostwriter", "writing", 
          `Reescribiendo ${sectionLabel} (${rewriteIndex + 1}/${chaptersToRewrite.length}): ${issuesSummary}`
        );

        const previousChapter = updatedChapters.find(c => c.chapterNumber === chapterNum - 1);
        const previousContinuity = previousChapter?.content 
          ? `Continuidad del capítulo anterior disponible.` 
          : "";

        const writerResult = await this.ghostwriter.execute({
          chapterNumber: sectionData.numero,
          chapterData: sectionData,
          worldBible: worldBibleData.world_bible,
          guiaEstilo,
          previousContinuity,
          refinementInstructions: `CORRECCIONES DEL REVISOR FINAL:\n${revisionInstructions}`,
          authorName,
        });

        let chapterContent = writerResult.content;
        await this.trackTokenUsage(project.id, writerResult.tokenUsage);

        this.callbacks.onAgentStatus("editor", "editing", `El Editor está revisando ${sectionLabel}...`);

        const editorResult = await this.editor.execute({
          chapterNumber: sectionData.numero,
          chapterContent,
          chapterData: sectionData,
          worldBible: worldBibleData.world_bible,
          guiaEstilo: `Género: ${project.genre}, Tono: ${project.tone}`,
        });

        await this.trackTokenUsage(project.id, editorResult.tokenUsage);

        if (!editorResult.result?.aprobado) {
          const refinementInstructions = this.buildRefinementInstructions(editorResult.result);
          const rewriteResult = await this.ghostwriter.execute({
            chapterNumber: sectionData.numero,
            chapterData: sectionData,
            worldBible: worldBibleData.world_bible,
            guiaEstilo,
            previousContinuity,
            refinementInstructions,
            authorName,
          });
          chapterContent = rewriteResult.content;
          await this.trackTokenUsage(project.id, rewriteResult.tokenUsage);
        }

        this.callbacks.onAgentStatus("copyeditor", "polishing", `El Estilista está puliendo ${sectionLabel}...`);

        const polishResult = await this.copyeditor.execute({
          chapterContent,
          chapterNumber: sectionData.numero,
          chapterTitle: sectionData.titulo,
          guiaEstilo: styleGuideContent || undefined,
        });
        await this.trackTokenUsage(project.id, polishResult.tokenUsage);

        const finalContent = polishResult.result?.texto_final || chapterContent;
        const wordCount = finalContent.split(/\s+/).length;

        await storage.updateChapter(chapter.id, {
          content: finalContent,
          wordCount,
          status: "completed",
          needsRevision: false,
          revisionReason: null,
        });

        this.callbacks.onChapterComplete(chapterNum, wordCount, sectionData.titulo);
        this.callbacks.onAgentStatus("copyeditor", "completed", 
          `${sectionLabel} corregido y finalizado (${wordCount} palabras)`
        );
      }

      // Acumular los issues corregidos para informar al revisor en la siguiente pasada
      if (result?.issues) {
        const issuesDeEsteCiclo = result.issues.map(i => 
          `[${i.categoria}] ${i.descripcion} (Caps ${i.capitulos_afectados.join(", ")})`
        );
        issuesPreviosCorregidos = [...issuesPreviosCorregidos, ...issuesDeEsteCiclo];
      }

      revisionCycle++;
    }

    return false;
  }

  async runFinalReviewOnly(project: Project): Promise<void> {
    try {
      this.cumulativeTokens = {
        inputTokens: project.totalInputTokens || 0,
        outputTokens: project.totalOutputTokens || 0,
        thinkingTokens: project.totalThinkingTokens || 0,
      };
      
      let styleGuideContent = "";
      let authorName = "";
      
      if (project.styleGuideId) {
        const styleGuide = await storage.getStyleGuide(project.styleGuideId);
        if (styleGuide) {
          styleGuideContent = styleGuide.content;
        }
      }
      
      if (project.pseudonymId) {
        const pseudonym = await storage.getPseudonym(project.pseudonymId);
        if (pseudonym) {
          authorName = pseudonym.name;
        }
      }

      const worldBible = await storage.getWorldBibleByProject(project.id);
      if (!worldBible) {
        this.callbacks.onError("No se encontró la biblia del mundo para este proyecto");
        return;
      }

      const worldBibleData: ParsedWorldBible = {
        world_bible: {
          personajes: worldBible.characters as any[] || [],
          lugares: [],
          reglas_lore: worldBible.worldRules as any[] || [],
        },
        escaleta_capitulos: worldBible.plotOutline as any[] || [],
      };

      const chapters = await storage.getChaptersByProject(project.id);
      const allSections = this.buildSectionsListFromChapters(chapters, worldBibleData);
      const guiaEstilo = `Género: ${project.genre}, Tono: ${project.tone}`;

      const approved = await this.runFinalReview(
        project,
        chapters,
        worldBibleData,
        guiaEstilo,
        allSections,
        styleGuideContent,
        authorName
      );

      await storage.updateProject(project.id, { 
        status: "completed",
        finalReviewResult: { approved }
      });

      if (approved) {
        this.callbacks.onAgentStatus("final-reviewer", "completed", "Revisión final aprobada");
      } else {
        this.callbacks.onAgentStatus("final-reviewer", "completed", "Revisión final completada (límite de ciclos alcanzado)");
      }

      this.callbacks.onProjectComplete();
    } catch (error) {
      console.error("Final review error:", error);
      this.callbacks.onError(`Error en revisión final: ${error instanceof Error ? error.message : "Error desconocido"}`);
      await storage.updateProject(project.id, { status: "completed" });
    }
  }

  private buildSectionsListFromChapters(chapters: Chapter[], worldBibleData: ParsedWorldBible): SectionData[] {
    return chapters.map((chapter, index) => {
      const chapterData = worldBibleData.escaleta_capitulos?.[index] || {};
      let tipo: "prologue" | "chapter" | "epilogue" | "author_note" = "chapter";
      
      if (chapter.title === "Prólogo") tipo = "prologue";
      else if (chapter.title === "Epílogo") tipo = "epilogue";
      else if (chapter.title === "Nota del Autor") tipo = "author_note";

      return {
        numero: chapter.chapterNumber,
        titulo: chapter.title || `Capítulo ${chapter.chapterNumber}`,
        cronologia: chapterData.cronologia || "",
        ubicacion: chapterData.ubicacion || "",
        elenco_presente: chapterData.elenco_presente || [],
        objetivo_narrativo: chapterData.objetivo_narrativo || "",
        beats: chapterData.beats || [],
        continuidad_salida: chapterData.continuidad_salida,
        tipo,
        funcion_estructural: chapterData.funcion_estructural,
        informacion_nueva: chapterData.informacion_nueva,
        conflicto_central: chapterData.conflicto_central,
        giro_emocional: chapterData.giro_emocional,
        riesgos_de_verosimilitud: chapterData.riesgos_de_verosimilitud,
      };
    });
  }

  private buildSectionsList(project: Project, worldBibleData: ParsedWorldBible): SectionData[] {
    const sections: SectionData[] = [];

    if (project.hasPrologue) {
      sections.push({
        numero: 0,
        titulo: "Prólogo",
        cronologia: "Antes del inicio de la historia",
        ubicacion: "",
        elenco_presente: [],
        objetivo_narrativo: "Establecer el tono y generar intriga para la historia que está por comenzar",
        beats: ["Gancho inicial", "Presentación del mundo", "Sembrar misterio"],
        tipo: "prologue",
      });
    }

    for (let i = 0; i < project.chapterCount; i++) {
      const chapterData = worldBibleData.escaleta_capitulos?.[i] || {};
      sections.push({
        numero: i + 1,
        titulo: chapterData.titulo || `Capítulo ${i + 1}`,
        cronologia: chapterData.cronologia || "",
        ubicacion: chapterData.ubicacion || "",
        elenco_presente: chapterData.elenco_presente || [],
        objetivo_narrativo: chapterData.objetivo_narrativo || "",
        beats: chapterData.beats || [],
        continuidad_salida: chapterData.continuidad_salida,
        continuidad_entrada: chapterData.continuidad_entrada,
        tipo: "chapter",
        funcion_estructural: chapterData.funcion_estructural,
        informacion_nueva: chapterData.informacion_nueva,
        pregunta_dramatica: chapterData.pregunta_dramatica,
        conflicto_central: chapterData.conflicto_central,
        giro_emocional: chapterData.giro_emocional,
        recursos_literarios_sugeridos: chapterData.recursos_literarios_sugeridos,
        tono_especifico: chapterData.tono_especifico,
        prohibiciones_este_capitulo: chapterData.prohibiciones_este_capitulo,
        arcos_que_avanza: chapterData.arcos_que_avanza,
        riesgos_de_verosimilitud: chapterData.riesgos_de_verosimilitud,
      });
    }

    if (project.hasEpilogue) {
      sections.push({
        numero: -1,
        titulo: "Epílogo",
        cronologia: "Después del final de la historia",
        ubicacion: "",
        elenco_presente: [],
        objetivo_narrativo: "Cerrar los arcos narrativos y ofrecer una conclusión satisfactoria",
        beats: ["Resolución final", "Mirada al futuro", "Cierre emocional"],
        tipo: "epilogue",
      });
    }

    if (project.hasAuthorNote) {
      sections.push({
        numero: -2,
        titulo: "Nota del Autor",
        cronologia: "",
        ubicacion: "",
        elenco_presente: [],
        objetivo_narrativo: "Reflexiones del autor sobre el proceso creativo y la historia",
        beats: ["Agradecimientos", "Inspiración de la obra", "Mensaje personal"],
        tipo: "author_note",
      });
    }

    return sections;
  }

  private getSectionLabel(section: SectionData): string {
    switch (section.tipo) {
      case "prologue":
        return "el Prólogo";
      case "epilogue":
        return "el Epílogo";
      case "author_note":
        return "la Nota del Autor";
      default:
        return `el Capítulo ${section.numero}`;
    }
  }

  private buildRefinementInstructions(editorResult: EditorResult | undefined): string {
    if (!editorResult) return "";

    const parts: string[] = [];
    
    parts.push(`═══════════════════════════════════════════════════════════════════`);
    parts.push(`FEEDBACK COMPLETO DEL EDITOR - PUNTUACIÓN: ${editorResult.puntuacion}/10`);
    parts.push(`═══════════════════════════════════════════════════════════════════`);
    
    if (editorResult.veredicto) {
      parts.push(`\nVEREDICTO: ${editorResult.veredicto}`);
    }
    
    // CRÍTICO: Errores de continuidad (el problema del cap 16)
    if (editorResult.errores_continuidad && editorResult.errores_continuidad.length > 0) {
      parts.push(`\n🚨 ERRORES DE CONTINUIDAD (CRÍTICO - CORREGIR PRIMERO):\n${editorResult.errores_continuidad.map(e => `  ❌ ${e}`).join("\n")}`);
    }
    
    // Problemas de verosimilitud (deus ex machina, coincidencias)
    if (editorResult.problemas_verosimilitud && editorResult.problemas_verosimilitud.length > 0) {
      parts.push(`\n🚨 PROBLEMAS DE VEROSIMILITUD (CRÍTICO):\n${editorResult.problemas_verosimilitud.map(p => `  ❌ ${p}`).join("\n")}`);
    }
    
    // Beats faltantes del Arquitecto
    if (editorResult.beats_faltantes && editorResult.beats_faltantes.length > 0) {
      parts.push(`\n📋 BEATS FALTANTES (DEBEN INCLUIRSE):\n${editorResult.beats_faltantes.map(b => `  ⚠️ ${b}`).join("\n")}`);
    }
    
    if (editorResult.debilidades_criticas && editorResult.debilidades_criticas.length > 0) {
      parts.push(`\n⚠️ DEBILIDADES A CORREGIR:\n${editorResult.debilidades_criticas.map(d => `  - ${d}`).join("\n")}`);
    }
    
    // Frases repetidas
    if (editorResult.frases_repetidas && editorResult.frases_repetidas.length > 0) {
      parts.push(`\n🔄 FRASES/EXPRESIONES REPETIDAS (VARIAR):\n${editorResult.frases_repetidas.map(f => `  - "${f}"`).join("\n")}`);
    }
    
    // Problemas de ritmo
    if (editorResult.problemas_ritmo && editorResult.problemas_ritmo.length > 0) {
      parts.push(`\n⏱️ PROBLEMAS DE RITMO:\n${editorResult.problemas_ritmo.map(r => `  - ${r}`).join("\n")}`);
    }
    
    // Violaciones de estilo
    if (editorResult.violaciones_estilo && editorResult.violaciones_estilo.length > 0) {
      parts.push(`\n📝 VIOLACIONES DE ESTILO:\n${editorResult.violaciones_estilo.map(v => `  - ${v}`).join("\n")}`);
    }
    
    // Plan quirúrgico detallado
    if (editorResult.plan_quirurgico) {
      const plan = editorResult.plan_quirurgico;
      parts.push(`\n═══════════════════════════════════════════════════════════════════`);
      parts.push(`PLAN QUIRÚRGICO DE CORRECCIÓN (SEGUIR AL PIE DE LA LETRA)`);
      parts.push(`═══════════════════════════════════════════════════════════════════`);
      if (plan.diagnostico) {
        parts.push(`\n📌 DIAGNÓSTICO:\n${plan.diagnostico}`);
      }
      if (plan.procedimiento) {
        parts.push(`\n📌 PROCEDIMIENTO PASO A PASO:\n${plan.procedimiento}`);
      }
      if (plan.objetivo) {
        parts.push(`\n📌 OBJETIVO FINAL:\n${plan.objetivo}`);
      }
    }
    
    // Fortalezas a mantener
    if (editorResult.fortalezas && editorResult.fortalezas.length > 0) {
      parts.push(`\n✅ FORTALEZAS A MANTENER:\n${editorResult.fortalezas.map(f => `  + ${f}`).join("\n")}`);
    }
    
    const vocab = this.getHistoricalVocabularySection();
    if (vocab) {
      parts.push(vocab);
    }

    parts.push(`\n═══════════════════════════════════════════════════════════════════`);
    parts.push(`INSTRUCCIÓN FINAL: Reescribe el capítulo corrigiendo TODOS los problemas`);
    parts.push(`listados arriba. Prioriza errores de continuidad y verosimilitud.`);
    parts.push(`USA SOLO el vocabulario de época permitido. EVITA términos prohibidos.`);
    parts.push(`═══════════════════════════════════════════════════════════════════`);

    return parts.join("\n");
  }

  private getHistoricalVocabularySection(): string | null {
    const vocab = Orchestrator.HISTORICAL_VOCABULARY[this.currentProjectGenre];
    if (!vocab || (vocab.valid.length === 0 && vocab.forbidden.length === 0)) {
      return null;
    }

    const parts: string[] = [];
    parts.push(`\n═══════════════════════════════════════════════════════════════════`);
    parts.push(`VOCABULARIO DE ÉPOCA (CRÍTICO PARA EVITAR ANACRONISMOS)`);
    parts.push(`═══════════════════════════════════════════════════════════════════`);

    if (vocab.forbidden.length > 0) {
      parts.push(`\n🚫 TÉRMINOS PROHIBIDOS (NUNCA USAR):`);
      parts.push(vocab.forbidden.map(t => `  ❌ "${t}"`).join("\n"));
    }

    if (Object.keys(vocab.alternatives).length > 0) {
      parts.push(`\n🔄 ALTERNATIVAS VÁLIDAS:`);
      for (const [forbidden, valid] of Object.entries(vocab.alternatives)) {
        parts.push(`  "${forbidden}" → usar: ${valid}`);
      }
    }

    if (vocab.valid.length > 0) {
      parts.push(`\n✅ VOCABULARIO DE ÉPOCA VÁLIDO (PREFERIR):`);
      parts.push(`  ${vocab.valid.slice(0, 20).join(", ")}${vocab.valid.length > 20 ? "..." : ""}`);
    }

    return parts.join("\n");
  }

  private parseArchitectOutput(content: string): ParsedWorldBible {
    console.log(`[Orchestrator] Parsing architect output, length: ${content.length}`);
    
    // Método 1: Parse directo
    try {
      const parsed = JSON.parse(content);
      console.log(`[Orchestrator] Direct JSON parse SUCCESS - Characters: ${parsed.world_bible?.personajes?.length || 0}, Chapters: ${parsed.escaleta_capitulos?.length || 0}`);
      return parsed;
    } catch (e1) {
      console.log(`[Orchestrator] Direct parse failed: ${(e1 as Error).message}`);
    }
    
    // Método 2: Extraer JSON del texto (buscar estructura con world_bible)
    try {
      // Buscar el inicio del JSON real (puede estar precedido por texto)
      const worldBibleMatch = content.match(/"world_bible"\s*:/);
      if (worldBibleMatch && worldBibleMatch.index !== undefined) {
        // Encontrar la llave de apertura antes de world_bible
        let braceStart = content.lastIndexOf('{', worldBibleMatch.index);
        if (braceStart !== -1) {
          // Contar llaves para encontrar el cierre correcto
          let depth = 0;
          let jsonEnd = -1;
          for (let i = braceStart; i < content.length; i++) {
            if (content[i] === '{') depth++;
            if (content[i] === '}') {
              depth--;
              if (depth === 0) {
                jsonEnd = i + 1;
                break;
              }
            }
          }
          
          if (jsonEnd !== -1) {
            const jsonStr = content.substring(braceStart, jsonEnd);
            const parsed = JSON.parse(jsonStr);
            console.log(`[Orchestrator] Extracted JSON SUCCESS - Characters: ${parsed.world_bible?.personajes?.length || 0}, Chapters: ${parsed.escaleta_capitulos?.length || 0}`);
            return parsed;
          }
        }
      }
    } catch (e2) {
      console.log(`[Orchestrator] JSON extraction method 2 failed: ${(e2 as Error).message}`);
    }
    
    // Método 3: Buscar primer { y último } (fallback)
    try {
      const firstBrace = content.indexOf('{');
      const lastBrace = content.lastIndexOf('}');
      
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        const jsonStr = content.substring(firstBrace, lastBrace + 1);
        const parsed = JSON.parse(jsonStr);
        console.log(`[Orchestrator] Fallback JSON parse SUCCESS - Characters: ${parsed.world_bible?.personajes?.length || 0}, Chapters: ${parsed.escaleta_capitulos?.length || 0}`);
        return parsed;
      }
    } catch (e3) {
      console.log(`[Orchestrator] Fallback parse failed: ${(e3 as Error).message}`);
    }
    
    // CRITICAL: Log the first 2000 chars to see what architect returned
    console.error(`[Orchestrator] ALL PARSE METHODS FAILED. Content preview (first 2000 chars):\n${content.substring(0, 2000)}`);
    console.error(`[Orchestrator] Content ends with (last 500 chars):\n${content.substring(content.length - 500)}`);
    
    return {
      world_bible: { personajes: [], lugares: [], reglas_lore: [] },
      escaleta_capitulos: [],
    };
  }

  private convertCharacters(data: ParsedWorldBible): Character[] {
    return (data.world_bible?.personajes || []).map((p: any) => {
      // Extraer apariencia inmutable del formato del Architect
      const aparienciaRaw = p.apariencia_inmutable || p.aparienciaInmutable || {};
      return {
        name: p.nombre || p.name || "",
        role: p.rol || p.role || "",
        psychologicalProfile: p.perfil_psicologico || p.psychologicalProfile || "",
        arc: p.arco || p.arc || "",
        relationships: p.relaciones || p.relationships || [],
        isAlive: p.vivo !== false && p.isAlive !== false,
        // CRÍTICO: Preservar apariencia física para continuidad
        aparienciaInmutable: {
          ojos: aparienciaRaw.ojos || aparienciaRaw.color_ojos || "",
          cabello: aparienciaRaw.cabello || aparienciaRaw.color_cabello || "",
          rasgosDistintivos: aparienciaRaw.rasgos_distintivos || aparienciaRaw.rasgosDistintivos || [],
          altura: aparienciaRaw.altura || aparienciaRaw.estatura || "",
          edad: aparienciaRaw.edad || aparienciaRaw.edad_aparente || "",
        },
      };
    });
  }

  private convertWorldRules(data: ParsedWorldBible): WorldRule[] {
    return (data.world_bible?.reglas_lore || []).map((r: any) => ({
      category: r.categoria || r.category || "General",
      rule: r.regla || r.rule || "",
      constraints: r.restricciones || r.constraints || [],
    }));
  }

  private convertTimeline(data: ParsedWorldBible): TimelineEvent[] {
    return (data.escaleta_capitulos || []).map((c: any) => ({
      chapter: c.numero || 0,
      event: c.objetivo_narrativo || c.titulo || "",
      characters: c.elenco_presente || [],
      significance: c.continuidad_salida || "",
    }));
  }

  private convertPlotOutline(data: ParsedWorldBible): PlotOutline {
    const acts = data.estructura_tres_actos || {};
    return {
      premise: data.premisa || "",
      threeActStructure: {
        act1: {
          setup: acts.acto1?.planteamiento || "",
          incitingIncident: acts.acto1?.incidente_incitador || "",
        },
        act2: {
          risingAction: acts.acto2?.accion_ascendente || "",
          midpoint: acts.acto2?.punto_medio || "",
          complications: acts.acto2?.complicaciones || "",
        },
        act3: {
          climax: acts.acto3?.climax || "",
          resolution: acts.acto3?.resolucion || "",
        },
      },
      chapterOutlines: (data.escaleta_capitulos || []).map((c: any) => ({
        number: c.numero,
        summary: c.objetivo_narrativo || "",
        keyEvents: c.beats || [],
        // Datos adicionales para propagación completa en reanudaciones
        titulo: c.titulo,
        cronologia: c.cronologia,
        ubicacion: c.ubicacion,
        elenco_presente: c.elenco_presente,
        funcion_estructural: c.funcion_estructural,
        informacion_nueva: c.informacion_nueva,
        pregunta_dramatica: c.pregunta_dramatica,
        conflicto_central: c.conflicto_central,
        giro_emocional: c.giro_emocional,
        recursos_literarios_sugeridos: c.recursos_literarios_sugeridos,
        tono_especifico: c.tono_especifico,
        prohibiciones_este_capitulo: c.prohibiciones_este_capitulo,
        arcos_que_avanza: c.arcos_que_avanza,
        continuidad_entrada: c.continuidad_entrada,
        continuidad_salida: c.continuidad_salida,
        riesgos_de_verosimilitud: c.riesgos_de_verosimilitud,
      })),
    };
  }

  private async updateWorldBibleTimeline(projectId: number, worldBibleId: number, chapterNumber: number, chapterData: any): Promise<void> {
    const worldBible = await storage.getWorldBibleByProject(projectId);
    if (worldBible) {
      const timeline = (worldBible.timeline || []) as TimelineEvent[];
      
      const existingIndex = timeline.findIndex(t => t.chapter === chapterNumber);
      const newEvent: TimelineEvent = {
        chapter: chapterNumber,
        event: chapterData.objetivo_narrativo || `Eventos del capítulo ${chapterNumber}`,
        characters: chapterData.elenco_presente || [],
        significance: chapterData.continuidad_salida || "",
      };
      
      if (existingIndex >= 0) {
        timeline[existingIndex] = newEvent;
      } else {
        timeline.push(newEvent);
      }
      
      await storage.updateWorldBible(worldBible.id, { timeline });
    }
  }

  private async runContinuityCheckpoint(
    project: Project,
    checkpointNumber: number,
    chaptersInScope: Chapter[],
    worldBibleData: ParsedWorldBible,
    previousIssues: string[]
  ): Promise<{ passed: boolean; issues: string[]; chaptersToRevise: number[] }> {
    this.callbacks.onAgentStatus("continuity-sentinel", "analyzing", 
      `El Centinela está verificando continuidad (Checkpoint #${checkpointNumber})...`
    );

    const chaptersData = chaptersInScope.map(c => ({
      numero: c.chapterNumber,
      titulo: c.title || `Capítulo ${c.chapterNumber}`,
      contenido: c.content || "",
      continuityState: c.continuityState || {},
    }));

    const result = await this.continuitySentinel.execute({
      projectTitle: project.title,
      checkpointNumber,
      chaptersInScope: chaptersData,
      worldBible: worldBibleData.world_bible,
      previousCheckpointIssues: previousIssues,
    });

    await this.trackTokenUsage(project.id, result.tokenUsage);

    if (result.thoughtSignature) {
      await storage.createThoughtLog({
        projectId: project.id,
        agentName: "El Centinela",
        agentRole: "continuity-sentinel",
        thoughtContent: result.thoughtSignature,
      });
    }

    const sentinelResult = result.result;
    
    if (sentinelResult?.checkpoint_aprobado) {
      this.callbacks.onAgentStatus("continuity-sentinel", "completed", 
        `Checkpoint #${checkpointNumber} APROBADO (${sentinelResult.puntuacion}/10). Sin issues de continuidad.`
      );
      return { passed: true, issues: [], chaptersToRevise: [] };
    } else {
      const issueDescriptions = (sentinelResult?.issues || []).map(i => 
        `[${i.severidad.toUpperCase()}] ${i.tipo}: ${i.descripcion}`
      );
      
      this.callbacks.onAgentStatus("continuity-sentinel", "warning", 
        `Checkpoint #${checkpointNumber}: ${sentinelResult?.issues?.length || 0} issues detectados. Caps afectados: ${sentinelResult?.capitulos_para_revision?.join(", ") || "N/A"}`
      );
      
      return { 
        passed: false, 
        issues: issueDescriptions, 
        chaptersToRevise: sentinelResult?.capitulos_para_revision || [] 
      };
    }
  }

  private async runVoiceRhythmAudit(
    project: Project,
    trancheNumber: number,
    chaptersInScope: Chapter[],
    styleGuideContent: string
  ): Promise<{ passed: boolean; issues: string[]; chaptersToRevise: number[] }> {
    this.callbacks.onAgentStatus("voice-auditor", "analyzing", 
      `El Auditor de Voz está analizando ritmo y tono (Tramo #${trancheNumber})...`
    );

    const chaptersData = chaptersInScope.map(c => ({
      numero: c.chapterNumber,
      titulo: c.title || `Capítulo ${c.chapterNumber}`,
      contenido: c.content || "",
    }));

    const result = await this.voiceRhythmAuditor.execute({
      projectTitle: project.title,
      trancheNumber,
      genre: project.genre,
      tone: project.tone,
      chaptersInScope: chaptersData,
      guiaEstilo: styleGuideContent || undefined,
    });

    await this.trackTokenUsage(project.id, result.tokenUsage);

    if (result.thoughtSignature) {
      await storage.createThoughtLog({
        projectId: project.id,
        agentName: "El Auditor de Voz",
        agentRole: "voice-auditor",
        thoughtContent: result.thoughtSignature,
      });
    }

    const auditResult = result.result;
    
    if (auditResult?.tranche_aprobado) {
      this.callbacks.onAgentStatus("voice-auditor", "completed", 
        `Tramo #${trancheNumber} APROBADO. Voz: ${auditResult.puntuacion_voz}/10, Ritmo: ${auditResult.puntuacion_ritmo}/10`
      );
      return { passed: true, issues: [], chaptersToRevise: [] };
    } else {
      const issueDescriptions = (auditResult?.issues || []).map(i => 
        `[${i.severidad.toUpperCase()}] ${i.tipo}: ${i.descripcion}`
      );
      
      this.callbacks.onAgentStatus("voice-auditor", "warning", 
        `Tramo #${trancheNumber}: Voz ${auditResult?.puntuacion_voz || 0}/10, Ritmo ${auditResult?.puntuacion_ritmo || 0}/10. ${auditResult?.issues?.length || 0} issues.`
      );
      
      return { 
        passed: false, 
        issues: issueDescriptions, 
        chaptersToRevise: auditResult?.capitulos_para_revision || [] 
      };
    }
  }

  private async runSemanticRepetitionAnalysis(
    project: Project,
    chapters: Chapter[],
    worldBibleData: ParsedWorldBible
  ): Promise<{ passed: boolean; clusters: any[]; foreshadowingStatus: any[]; chaptersToRevise: number[] }> {
    this.callbacks.onAgentStatus("semantic-detector", "analyzing", 
      `El Detector Semántico está buscando repeticiones y verificando foreshadowing...`
    );

    const chaptersData = chapters
      .filter(c => c.content)
      .sort((a, b) => a.chapterNumber - b.chapterNumber)
      .map(c => ({
        numero: c.chapterNumber,
        titulo: c.title || `Capítulo ${c.chapterNumber}`,
        contenido: c.content || "",
      }));

    const result = await this.semanticRepetitionDetector.execute({
      projectTitle: project.title,
      chapters: chaptersData,
      worldBible: worldBibleData.world_bible,
    });

    await this.trackTokenUsage(project.id, result.tokenUsage);

    if (result.thoughtSignature) {
      await storage.createThoughtLog({
        projectId: project.id,
        agentName: "El Detector Semántico",
        agentRole: "semantic-detector",
        thoughtContent: result.thoughtSignature,
      });
    }

    const analysisResult = result.result;
    
    if (analysisResult?.analisis_aprobado) {
      this.callbacks.onAgentStatus("semantic-detector", "completed", 
        `Análisis APROBADO. Originalidad: ${analysisResult.puntuacion_originalidad}/10, Foreshadowing: ${analysisResult.puntuacion_foreshadowing}/10`
      );
    } else {
      const unresolvedForeshadowing = (analysisResult?.foreshadowing_detectado || [])
        .filter(f => f.estado === "sin_payoff").length;
      
      this.callbacks.onAgentStatus("semantic-detector", "warning", 
        `Originalidad: ${analysisResult?.puntuacion_originalidad || 0}/10, Foreshadowing: ${analysisResult?.puntuacion_foreshadowing || 0}/10. ${analysisResult?.clusters?.length || 0} clusters, ${unresolvedForeshadowing} foreshadowing sin resolver.`
      );
    }
    
    return { 
      passed: analysisResult?.analisis_aprobado || false, 
      clusters: analysisResult?.clusters || [],
      foreshadowingStatus: analysisResult?.foreshadowing_detectado || [],
      chaptersToRevise: analysisResult?.capitulos_para_revision || []
    };
  }

  private async rewriteChapterForQA(
    project: Project,
    chapter: Chapter,
    sectionData: any,
    worldBibleData: ParsedWorldBible,
    guiaEstilo: string,
    qaSource: "continuity" | "voice" | "semantic",
    correctionInstructions: string
  ): Promise<void> {
    const qaLabels = {
      continuity: "Centinela de Continuidad",
      voice: "Auditor de Voz",
      semantic: "Detector Semántico"
    };

    await storage.updateChapter(chapter.id, { 
      status: "revision",
      needsRevision: true,
      revisionReason: correctionInstructions 
    });

    this.callbacks.onChapterStatusChange(chapter.chapterNumber, "revision");
    
    const sectionLabel = this.getSectionLabel(sectionData);
    
    this.callbacks.onAgentStatus("ghostwriter", "writing", 
      `Reescribiendo ${sectionLabel} por ${qaLabels[qaSource]}`
    );

    const allChapters = await storage.getChaptersByProject(project.id);
    const previousChapter = allChapters.find(c => c.chapterNumber === chapter.chapterNumber - 1);
    
    let previousContinuity = "";
    if (previousChapter?.continuityState) {
      previousContinuity = `ESTADO DE CONTINUIDAD DEL CAPÍTULO ANTERIOR:\n${JSON.stringify(previousChapter.continuityState, null, 2)}`;
    } else if (previousChapter?.content) {
      const lastParagraphs = previousChapter.content.split("\n\n").slice(-3).join("\n\n");
      previousContinuity = `FINAL DEL CAPÍTULO ANTERIOR:\n${lastParagraphs}`;
    }

    const writerResult = await this.ghostwriter.execute({
      chapterNumber: sectionData.numero,
      chapterData: sectionData,
      worldBible: worldBibleData.world_bible,
      guiaEstilo,
      previousContinuity,
      refinementInstructions: `CORRECCIONES DE ${qaLabels[qaSource].toUpperCase()}:\n${correctionInstructions}`,
    });

    await this.trackTokenUsage(project.id, writerResult.tokenUsage);

    if (writerResult.content) {
      const wordCount = writerResult.content.split(/\s+/).filter(w => w.length > 0).length;
      
      await storage.updateChapter(chapter.id, {
        content: writerResult.content,
        status: "completed",
        wordCount,
        needsRevision: false,
        revisionReason: null,
      });

      this.callbacks.onChapterStatusChange(chapter.chapterNumber, "completed");
      this.callbacks.onAgentStatus("ghostwriter", "completed", 
        `${sectionLabel} reescrito correctamente`
      );
    }
  }

  private async polishChapterForVoice(
    project: Project,
    chapter: Chapter,
    styleGuideContent: string,
    voiceIssues: string
  ): Promise<void> {
    await storage.updateChapter(chapter.id, { status: "editing" });
    this.callbacks.onChapterStatusChange(chapter.chapterNumber, "editing");
    
    this.callbacks.onAgentStatus("copyeditor", "polishing", 
      `Puliendo voz y ritmo del capítulo ${chapter.chapterNumber}`
    );

    const copyEditResult = await this.copyeditor.execute({
      chapterNumber: chapter.chapterNumber,
      chapterTitle: chapter.title || `Capítulo ${chapter.chapterNumber}`,
      chapterContent: chapter.content || "",
      guiaEstilo: `${styleGuideContent || "Tone: literary, professional"}\n\nCORRECCIONES DEL AUDITOR DE VOZ:\n${voiceIssues}\n\nAjusta el tono y ritmo según las indicaciones manteniendo el contenido narrativo.`,
    });

    await this.trackTokenUsage(project.id, copyEditResult.tokenUsage);

    const polishedContent = copyEditResult.result?.texto_final;
    if (polishedContent) {
      const wordCount = polishedContent.split(/\s+/).filter((w: string) => w.length > 0).length;
      
      await storage.updateChapter(chapter.id, {
        content: polishedContent,
        status: "completed",
        wordCount,
      });

      this.callbacks.onChapterStatusChange(chapter.chapterNumber, "completed");
      this.callbacks.onAgentStatus("copyeditor", "completed", 
        `Capítulo ${chapter.chapterNumber} pulido correctamente`
      );
    }
  }
}
