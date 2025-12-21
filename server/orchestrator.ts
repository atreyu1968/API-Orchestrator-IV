import { storage } from "./storage";
import { ArchitectAgent, GhostwriterAgent, EditorAgent, CopyEditorAgent, type EditorResult } from "./agents";
import type { Project, WorldBible, Chapter, PlotOutline, Character, WorldRule, TimelineEvent } from "@shared/schema";

interface OrchestratorCallbacks {
  onAgentStatus: (role: string, status: string, message?: string) => void;
  onChapterComplete: (chapterNumber: number, wordCount: number) => void;
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

export class Orchestrator {
  private architect = new ArchitectAgent();
  private ghostwriter = new GhostwriterAgent();
  private editor = new EditorAgent();
  private copyeditor = new CopyEditorAgent();
  private callbacks: OrchestratorCallbacks;
  private maxRefinementLoops = 2;

  constructor(callbacks: OrchestratorCallbacks) {
    this.callbacks = callbacks;
  }

  async generateNovel(project: Project): Promise<void> {
    try {
      await storage.updateProject(project.id, { status: "generating" });

      this.callbacks.onAgentStatus("architect", "thinking", "El Arquitecto está diseñando la estructura narrativa...");
      
      const architectResult = await this.architect.execute({
        title: project.title,
        genre: project.genre,
        tone: project.tone,
        chapterCount: project.chapterCount,
      });

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

      const chapters: Chapter[] = [];
      for (let i = 0; i < project.chapterCount; i++) {
        const chapter = await storage.createChapter({
          projectId: project.id,
          chapterNumber: i + 1,
          title: worldBibleData.escaleta_capitulos?.[i]?.titulo || `Capítulo ${i + 1}`,
          status: "pending",
        });
        chapters.push(chapter);
      }

      let previousContinuity = "";

      for (let i = 0; i < chapters.length; i++) {
        const chapter = chapters[i];
        const chapterData = worldBibleData.escaleta_capitulos?.[i] || {
          numero: i + 1,
          titulo: `Capítulo ${i + 1}`,
          cronologia: "",
          ubicacion: "",
          elenco_presente: [],
          objetivo_narrativo: "",
          beats: [],
        };

        await storage.updateChapter(chapter.id, { status: "writing" });
        await storage.updateProject(project.id, { currentChapter: i + 1 });

        this.callbacks.onAgentStatus("ghostwriter", "writing", `El Narrador está escribiendo el Capítulo ${i + 1}...`);

        let chapterContent = "";
        let approved = false;
        let refinementAttempts = 0;
        let refinementInstructions = "";

        while (!approved && refinementAttempts < this.maxRefinementLoops) {
          const writerResult = await this.ghostwriter.execute({
            chapterNumber: i + 1,
            chapterData,
            worldBible: worldBibleData.world_bible,
            guiaEstilo: `Género: ${project.genre}, Tono: ${project.tone}`,
            previousContinuity,
            refinementInstructions,
          });

          chapterContent = writerResult.content;

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
          this.callbacks.onAgentStatus("editor", "editing", `El Editor está revisando el Capítulo ${i + 1}...`);

          const editorResult = await this.editor.execute({
            chapterNumber: i + 1,
            chapterContent,
            chapterData,
            worldBible: worldBibleData.world_bible,
            guiaEstilo: `Género: ${project.genre}, Tono: ${project.tone}`,
          });

          if (editorResult.thoughtSignature) {
            await storage.createThoughtLog({
              projectId: project.id,
              chapterId: chapter.id,
              agentName: "El Editor",
              agentRole: "editor",
              thoughtContent: editorResult.thoughtSignature,
            });
          }

          if (editorResult.result?.aprobado) {
            approved = true;
            this.callbacks.onAgentStatus("editor", "completed", `Capítulo ${i + 1} aprobado (${editorResult.result.puntuacion}/10)`);
          } else {
            refinementAttempts++;
            
            refinementInstructions = this.buildRefinementInstructions(editorResult.result);
            
            this.callbacks.onAgentStatus("editor", "editing", 
              `Capítulo ${i + 1} rechazado (${editorResult.result?.puntuacion || 0}/10). Intento ${refinementAttempts}/${this.maxRefinementLoops}.`
            );

            if (refinementAttempts < this.maxRefinementLoops) {
              this.callbacks.onAgentStatus("ghostwriter", "writing", 
                `El Narrador está reescribiendo el Capítulo ${i + 1} siguiendo el Plan Quirúrgico...`
              );
            }
          }
        }

        this.callbacks.onAgentStatus("copyeditor", "polishing", `El Estilista está puliendo el Capítulo ${i + 1}...`);

        const polishResult = await this.copyeditor.execute({
          chapterContent,
          chapterNumber: i + 1,
          chapterTitle: chapterData.titulo || `Capítulo ${i + 1}`,
        });

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
        });

        previousContinuity = chapterData.continuidad_salida || 
          `Capítulo ${i + 1} completado. Los personajes terminaron en: ${chapterData.ubicacion}`;

        this.callbacks.onChapterComplete(i + 1, wordCount);
        this.callbacks.onAgentStatus("copyeditor", "completed", `Capítulo ${i + 1} finalizado (${wordCount} palabras)`);

        await this.updateWorldBibleTimeline(project.id, worldBible.id, i + 1, chapterData);
      }

      await storage.updateProject(project.id, { status: "completed" });
      this.callbacks.onProjectComplete();

    } catch (error) {
      console.error("[Orchestrator] Error:", error);
      await storage.updateProject(project.id, { status: "error" });
      this.callbacks.onError(error instanceof Error ? error.message : "Error desconocido");
    }
  }

  private buildRefinementInstructions(editorResult: EditorResult | undefined): string {
    if (!editorResult) return "";

    const parts: string[] = [];
    
    if (editorResult.veredicto) {
      parts.push(`VEREDICTO DEL EDITOR: ${editorResult.veredicto}`);
    }
    
    if (editorResult.debilidades_criticas && editorResult.debilidades_criticas.length > 0) {
      parts.push(`DEBILIDADES A CORREGIR:\n${editorResult.debilidades_criticas.map(d => `- ${d}`).join("\n")}`);
    }
    
    if (editorResult.plan_quirurgico) {
      const plan = editorResult.plan_quirurgico;
      if (plan.diagnostico) {
        parts.push(`DIAGNÓSTICO: ${plan.diagnostico}`);
      }
      if (plan.procedimiento) {
        parts.push(`PROCEDIMIENTO DE CORRECCIÓN: ${plan.procedimiento}`);
      }
      if (plan.objetivo) {
        parts.push(`OBJETIVO: ${plan.objetivo}`);
      }
    }
    
    if (editorResult.fortalezas && editorResult.fortalezas.length > 0) {
      parts.push(`MANTENER ESTAS FORTALEZAS:\n${editorResult.fortalezas.map(f => `- ${f}`).join("\n")}`);
    }

    return parts.join("\n\n");
  }

  private parseArchitectOutput(content: string): ParsedWorldBible {
    try {
      return JSON.parse(content);
    } catch {
      return {
        world_bible: { personajes: [], lugares: [], reglas_lore: [] },
        escaleta_capitulos: [],
      };
    }
  }

  private convertCharacters(data: ParsedWorldBible): Character[] {
    return (data.world_bible?.personajes || []).map((p: any) => ({
      name: p.nombre || p.name || "",
      role: p.rol || p.role || "",
      psychologicalProfile: p.perfil_psicologico || p.psychologicalProfile || "",
      arc: p.arco || p.arc || "",
      relationships: p.relaciones || p.relationships || [],
      isAlive: p.vivo !== false && p.isAlive !== false,
    }));
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
}
