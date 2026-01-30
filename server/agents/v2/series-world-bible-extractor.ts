import { BaseAgent, AgentResponse, AgentConfig } from "../base-agent";
import { storage } from "../../storage";
import { db } from "../../db";
import { seriesWorldBible } from "@shared/schema";
import { eq } from "drizzle-orm";

export interface SeriesWorldBibleCharacter {
  name: string;
  role: string;
  description: string;
  status: "alive" | "dead" | "missing" | "unknown";
  firstAppearanceVolume: number;
  lastSeenVolume: number;
  relationships: Array<{ character: string; relation: string }>;
  development: string;
  physicalTraits?: string[];
  skills?: string[];
}

export interface SeriesWorldBibleLocation {
  name: string;
  description: string;
  type: string;
  firstMentionVolume: number;
  significance: string;
  keyEvents?: string[];
}

export interface SeriesWorldBibleLesson {
  description: string;
  learnedByCharacter: string;
  volumeNumber: number;
  chapterNumber?: number;
  impact: string;
}

export interface SeriesWorldBibleRule {
  category: string;
  rule: string;
  establishedVolume: number;
  constraints?: string[];
}

export interface SeriesWorldBibleEvent {
  description: string;
  volumeNumber: number;
  chapterNumber?: number;
  affectedCharacters: string[];
  consequences: string;
  isRecurring?: boolean;
}

export interface SeriesWorldBibleObject {
  name: string;
  description: string;
  owner?: string;
  significance: string;
  status: "intact" | "destroyed" | "lost" | "transferred";
  firstAppearanceVolume: number;
}

export interface SeriesWorldBibleSecret {
  description: string;
  knownBy: string[];
  revealedVolume?: number;
  impact: string;
  isResolved: boolean;
}

export interface ExtractedWorldBibleData {
  characters: SeriesWorldBibleCharacter[];
  locations: SeriesWorldBibleLocation[];
  lessons: SeriesWorldBibleLesson[];
  worldRules: SeriesWorldBibleRule[];
  timeline: SeriesWorldBibleEvent[];
  objects: SeriesWorldBibleObject[];
  secrets: SeriesWorldBibleSecret[];
}

const EXTRACTOR_CONFIG: AgentConfig = {
  name: "series-world-bible-extractor",
  role: "series-world-bible-extractor",
  systemPrompt: `You are an expert literary analyst specializing in extracting world-building elements from completed novel manuscripts.

Your task is to analyze a completed volume of a series and extract all relevant information that should be carried forward to subsequent volumes.

EXTRACTION CATEGORIES:

1. CHARACTERS:
   - All named characters with their current status
   - Physical descriptions and distinguishing traits
   - Relationships between characters
   - Character development and growth
   - Skills and abilities

2. LOCATIONS:
   - All named places and settings
   - Geographical relationships
   - Significant events that occurred there
   - Atmosphere and characteristics

3. LESSONS/LEARNINGS:
   - What characters learned during this volume
   - Emotional growth and realizations
   - Skills acquired
   - Mistakes made and their impact

4. WORLD RULES:
   - Established laws (magical, scientific, social)
   - Cultural norms and taboos
   - Power dynamics and hierarchies
   - Limitations and constraints

5. TIMELINE EVENTS:
   - Major plot events with their consequences
   - Deaths, births, marriages, conflicts
   - Political or social changes
   - Events that will affect future volumes

6. SIGNIFICANT OBJECTS:
   - Magical items, weapons, heirlooms
   - Current ownership and status
   - Powers or significance

7. SECRETS:
   - Unrevealed information
   - Mysteries established
   - Foreshadowing elements
   - Who knows what

OUTPUT FORMAT:
Respond with a valid JSON object containing all extracted data. Be thorough but concise.
Focus on information that would be essential for writing future volumes in the series.`,
  model: "deepseek-chat",
};

export class SeriesWorldBibleExtractor extends BaseAgent {
  constructor() {
    super(EXTRACTOR_CONFIG);
  }

  async execute(input: { prompt: string; projectId?: number }): Promise<AgentResponse> {
    return this.generateContent(input.prompt, input.projectId);
  }

  async extractFromProject(projectId: number, volumeNumber: number): Promise<ExtractedWorldBibleData | null> {
    const project = await storage.getProject(projectId);
    if (!project) {
      console.error(`[SeriesWorldBibleExtractor] Project ${projectId} not found`);
      return null;
    }

    if (!project.seriesId) {
      console.error(`[SeriesWorldBibleExtractor] Project ${projectId} is not part of a series`);
      return null;
    }

    const allChapters = await storage.getChaptersByProject(projectId);
    const completedChapters = allChapters.filter(ch => ch.content && ch.content.length > 100);

    if (completedChapters.length === 0) {
      console.error(`[SeriesWorldBibleExtractor] No completed chapters found for project ${projectId}`);
      return null;
    }

    const manuscriptText = completedChapters
      .sort((a, b) => a.chapterNumber - b.chapterNumber)
      .map(ch => `--- Chapter ${ch.chapterNumber}: ${ch.title || 'Untitled'} ---\n\n${ch.content}`)
      .join("\n\n");

    const truncatedManuscript = manuscriptText.length > 150000 
      ? manuscriptText.substring(0, 150000) + "\n\n[... manuscript truncated for analysis ...]"
      : manuscriptText;

    const prompt = `Analyze the following manuscript (Volume ${volumeNumber} of a series) and extract all world-building elements that should be carried forward to future volumes.

MANUSCRIPT:
${truncatedManuscript}

INSTRUCTIONS:
1. Extract ALL named characters with their current status at the end of this volume
2. Extract ALL named locations mentioned
3. Identify key lessons and character growth
4. Note any world rules or laws established
5. List major plot events and their consequences
6. Catalog significant objects and their current state
7. Record any secrets or mysteries that remain unresolved

Respond with a valid JSON object following this exact structure:
{
  "characters": [
    {
      "name": "Character Name",
      "role": "protagonist/antagonist/supporting/minor",
      "description": "Brief description",
      "status": "alive/dead/missing/unknown",
      "firstAppearanceVolume": ${volumeNumber},
      "lastSeenVolume": ${volumeNumber},
      "relationships": [{"character": "Other Name", "relation": "friend/enemy/lover/family"}],
      "development": "How they changed during this volume",
      "physicalTraits": ["trait1", "trait2"],
      "skills": ["skill1", "skill2"]
    }
  ],
  "locations": [
    {
      "name": "Location Name",
      "description": "Brief description",
      "type": "city/building/region/etc",
      "firstMentionVolume": ${volumeNumber},
      "significance": "Why this place matters",
      "keyEvents": ["event1", "event2"]
    }
  ],
  "lessons": [
    {
      "description": "What was learned",
      "learnedByCharacter": "Character Name",
      "volumeNumber": ${volumeNumber},
      "impact": "How this affects future behavior"
    }
  ],
  "worldRules": [
    {
      "category": "magic/society/physics/etc",
      "rule": "Description of the rule",
      "establishedVolume": ${volumeNumber},
      "constraints": ["limitation1", "limitation2"]
    }
  ],
  "timeline": [
    {
      "description": "Major event description",
      "volumeNumber": ${volumeNumber},
      "affectedCharacters": ["name1", "name2"],
      "consequences": "What this means for the future"
    }
  ],
  "objects": [
    {
      "name": "Object Name",
      "description": "What it is",
      "owner": "Current owner or null",
      "significance": "Why it matters",
      "status": "intact/destroyed/lost/transferred",
      "firstAppearanceVolume": ${volumeNumber}
    }
  ],
  "secrets": [
    {
      "description": "The secret or mystery",
      "knownBy": ["character1", "character2"],
      "revealedVolume": null,
      "impact": "Potential impact when revealed",
      "isResolved": false
    }
  ]
}`;

    console.log(`[SeriesWorldBibleExtractor] Extracting world bible from project ${projectId} (Volume ${volumeNumber})`);

    try {
      const response = await this.execute({ prompt, projectId });
      
      if (!response.content) {
        console.error(`[SeriesWorldBibleExtractor] Empty response from AI`);
        return null;
      }

      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.error(`[SeriesWorldBibleExtractor] No JSON found in response`);
        return null;
      }

      const extracted: ExtractedWorldBibleData = JSON.parse(jsonMatch[0]);
      console.log(`[SeriesWorldBibleExtractor] Extracted: ${extracted.characters?.length || 0} characters, ${extracted.locations?.length || 0} locations, ${extracted.lessons?.length || 0} lessons`);

      return extracted;
    } catch (error) {
      console.error(`[SeriesWorldBibleExtractor] Error extracting:`, error);
      return null;
    }
  }

  async mergeAndSaveToSeries(seriesId: number, volumeNumber: number, extracted: ExtractedWorldBibleData): Promise<void> {
    const existing = await db.select().from(seriesWorldBible).where(eq(seriesWorldBible.seriesId, seriesId)).limit(1);

    if (existing.length === 0) {
      await db.insert(seriesWorldBible).values({
        seriesId,
        characters: extracted.characters as any,
        locations: extracted.locations as any,
        lessons: extracted.lessons as any,
        worldRules: extracted.worldRules as any,
        timeline: extracted.timeline as any,
        objects: extracted.objects as any,
        secrets: extracted.secrets as any,
        lastUpdatedVolume: volumeNumber,
      });
      console.log(`[SeriesWorldBibleExtractor] Created new series world bible for series ${seriesId}`);
    } else {
      const current = existing[0];
      
      const mergedCharacters = this.mergeCharacters(
        (current.characters as SeriesWorldBibleCharacter[]) || [],
        extracted.characters,
        volumeNumber
      );
      
      const mergedLocations = this.mergeLocations(
        (current.locations as SeriesWorldBibleLocation[]) || [],
        extracted.locations
      );
      
      const mergedLessons = [
        ...((current.lessons as SeriesWorldBibleLesson[]) || []),
        ...extracted.lessons
      ];
      
      const mergedRules = this.mergeRules(
        (current.worldRules as SeriesWorldBibleRule[]) || [],
        extracted.worldRules
      );
      
      const mergedTimeline = [
        ...((current.timeline as SeriesWorldBibleEvent[]) || []),
        ...extracted.timeline
      ];
      
      const mergedObjects = this.mergeObjects(
        (current.objects as SeriesWorldBibleObject[]) || [],
        extracted.objects,
        volumeNumber
      );
      
      const mergedSecrets = this.mergeSecrets(
        (current.secrets as SeriesWorldBibleSecret[]) || [],
        extracted.secrets
      );

      await db.update(seriesWorldBible)
        .set({
          characters: mergedCharacters as any,
          locations: mergedLocations as any,
          lessons: mergedLessons as any,
          worldRules: mergedRules as any,
          timeline: mergedTimeline as any,
          objects: mergedObjects as any,
          secrets: mergedSecrets as any,
          lastUpdatedVolume: volumeNumber,
          updatedAt: new Date(),
        })
        .where(eq(seriesWorldBible.id, current.id));

      console.log(`[SeriesWorldBibleExtractor] Updated series world bible for series ${seriesId} with volume ${volumeNumber} data`);
    }
  }

  private mergeCharacters(
    existing: SeriesWorldBibleCharacter[],
    newChars: SeriesWorldBibleCharacter[],
    volumeNumber: number
  ): SeriesWorldBibleCharacter[] {
    const merged = [...existing];
    
    for (const newChar of newChars) {
      const existingIndex = merged.findIndex(c => 
        c.name.toLowerCase() === newChar.name.toLowerCase()
      );
      
      if (existingIndex >= 0) {
        const existingPhysicalTraits = merged[existingIndex].physicalTraits || [];
        const newPhysicalTraits = newChar.physicalTraits || [];
        const existingSkills = merged[existingIndex].skills || [];
        const newSkills = newChar.skills || [];
        
        merged[existingIndex] = {
          ...merged[existingIndex],
          status: newChar.status,
          lastSeenVolume: volumeNumber,
          description: newChar.description || merged[existingIndex].description,
          relationships: [...(merged[existingIndex].relationships || []), ...(newChar.relationships || [])],
          development: merged[existingIndex].development + " | " + newChar.development,
          physicalTraits: Array.from(new Set([...existingPhysicalTraits, ...newPhysicalTraits])),
          skills: Array.from(new Set([...existingSkills, ...newSkills])),
        };
      } else {
        merged.push({
          ...newChar,
          firstAppearanceVolume: volumeNumber,
          lastSeenVolume: volumeNumber,
        });
      }
    }
    
    return merged;
  }

  private mergeLocations(
    existing: SeriesWorldBibleLocation[],
    newLocations: SeriesWorldBibleLocation[]
  ): SeriesWorldBibleLocation[] {
    const merged = [...existing];
    
    for (const newLoc of newLocations) {
      const existingIndex = merged.findIndex(l => 
        l.name.toLowerCase() === newLoc.name.toLowerCase()
      );
      
      if (existingIndex >= 0) {
        merged[existingIndex] = {
          ...merged[existingIndex],
          keyEvents: [...(merged[existingIndex].keyEvents || []), ...(newLoc.keyEvents || [])],
          significance: merged[existingIndex].significance + " | " + newLoc.significance,
        };
      } else {
        merged.push(newLoc);
      }
    }
    
    return merged;
  }

  private mergeRules(
    existing: SeriesWorldBibleRule[],
    newRules: SeriesWorldBibleRule[]
  ): SeriesWorldBibleRule[] {
    const merged = [...existing];
    
    for (const newRule of newRules) {
      const exists = merged.some(r => 
        r.rule.toLowerCase() === newRule.rule.toLowerCase()
      );
      
      if (!exists) {
        merged.push(newRule);
      }
    }
    
    return merged;
  }

  private mergeObjects(
    existing: SeriesWorldBibleObject[],
    newObjects: SeriesWorldBibleObject[],
    volumeNumber: number
  ): SeriesWorldBibleObject[] {
    const merged = [...existing];
    
    for (const newObj of newObjects) {
      const existingIndex = merged.findIndex(o => 
        o.name.toLowerCase() === newObj.name.toLowerCase()
      );
      
      if (existingIndex >= 0) {
        merged[existingIndex] = {
          ...merged[existingIndex],
          status: newObj.status,
          owner: newObj.owner || merged[existingIndex].owner,
        };
      } else {
        merged.push({
          ...newObj,
          firstAppearanceVolume: volumeNumber,
        });
      }
    }
    
    return merged;
  }

  private mergeSecrets(
    existing: SeriesWorldBibleSecret[],
    newSecrets: SeriesWorldBibleSecret[]
  ): SeriesWorldBibleSecret[] {
    const merged = [...existing];
    
    for (const newSecret of newSecrets) {
      const existingIndex = merged.findIndex(s => 
        s.description.toLowerCase().includes(newSecret.description.toLowerCase().substring(0, 50))
      );
      
      if (existingIndex >= 0) {
        if (newSecret.isResolved && !merged[existingIndex].isResolved) {
          merged[existingIndex] = {
            ...merged[existingIndex],
            isResolved: true,
            revealedVolume: newSecret.revealedVolume,
          };
        }
      } else {
        merged.push(newSecret);
      }
    }
    
    return merged;
  }

  async extractFromManuscript(manuscriptId: number, volumeNumber: number): Promise<ExtractedWorldBibleData | null> {
    const manuscript = await storage.getImportedManuscript(manuscriptId);
    if (!manuscript) {
      console.error(`[SeriesWorldBibleExtractor] Manuscript ${manuscriptId} not found`);
      return null;
    }

    if (!manuscript.seriesId) {
      console.error(`[SeriesWorldBibleExtractor] Manuscript ${manuscriptId} is not part of a series`);
      return null;
    }

    const allChapters = await storage.getImportedChaptersByManuscript(manuscriptId);
    const validChapters = allChapters.filter(ch => {
      const content = ch.editedContent || ch.originalContent;
      return content && content.length > 100;
    });

    if (validChapters.length === 0) {
      console.error(`[SeriesWorldBibleExtractor] No valid chapters found for manuscript ${manuscriptId}`);
      return null;
    }

    const manuscriptText = validChapters
      .sort((a, b) => a.chapterNumber - b.chapterNumber)
      .map(ch => `--- Chapter ${ch.chapterNumber}: ${ch.title || 'Untitled'} ---\n\n${ch.editedContent || ch.originalContent}`)
      .join("\n\n");

    const truncatedManuscript = manuscriptText.length > 150000 
      ? manuscriptText.substring(0, 150000) + "\n\n[... manuscript truncated for analysis ...]"
      : manuscriptText;

    const prompt = `Analyze the following imported manuscript (Volume ${volumeNumber} of a series) and extract all world-building elements that should be carried forward to future volumes.

MANUSCRIPT:
${truncatedManuscript}

INSTRUCTIONS:
1. Extract ALL named characters with their current status at the end of this volume
2. Extract ALL named locations mentioned
3. Identify key lessons and character growth
4. Note any world rules or laws established
5. List major plot events and their consequences
6. Catalog significant objects and their current state
7. Record any secrets or mysteries that remain unresolved

Respond with a valid JSON object following this exact structure:
{
  "characters": [
    {
      "name": "Character Name",
      "role": "protagonist/antagonist/supporting/minor",
      "description": "Brief description",
      "status": "alive/dead/missing/unknown",
      "firstAppearanceVolume": ${volumeNumber},
      "lastSeenVolume": ${volumeNumber},
      "relationships": [{"character": "Other Name", "relation": "friend/enemy/lover/family"}],
      "development": "How they changed during this volume",
      "physicalTraits": ["trait1", "trait2"],
      "skills": ["skill1", "skill2"]
    }
  ],
  "locations": [
    {
      "name": "Location Name",
      "description": "Brief description",
      "type": "city/building/region/etc",
      "firstMentionVolume": ${volumeNumber},
      "significance": "Why this place matters",
      "keyEvents": ["event1", "event2"]
    }
  ],
  "lessons": [
    {
      "description": "What was learned",
      "learnedByCharacter": "Character Name",
      "volumeNumber": ${volumeNumber},
      "impact": "How this affects future behavior"
    }
  ],
  "worldRules": [
    {
      "category": "magic/society/physics/etc",
      "rule": "Description of the rule",
      "establishedVolume": ${volumeNumber},
      "constraints": ["limitation1", "limitation2"]
    }
  ],
  "timeline": [
    {
      "description": "Major event description",
      "volumeNumber": ${volumeNumber},
      "affectedCharacters": ["name1", "name2"],
      "consequences": "What this means for the future"
    }
  ],
  "objects": [
    {
      "name": "Object Name",
      "description": "What it is",
      "owner": "Current owner or null",
      "significance": "Why it matters",
      "status": "intact/destroyed/lost/transferred",
      "firstAppearanceVolume": ${volumeNumber}
    }
  ],
  "secrets": [
    {
      "description": "The secret or mystery",
      "knownBy": ["character1", "character2"],
      "revealedVolume": null,
      "impact": "Potential impact when revealed",
      "isResolved": false
    }
  ]
}`;

    console.log(`[SeriesWorldBibleExtractor] Extracting world bible from manuscript ${manuscriptId} (Volume ${volumeNumber})`);

    try {
      const response = await this.execute({ prompt });
      
      if (!response.content) {
        console.error(`[SeriesWorldBibleExtractor] Empty response from AI for manuscript`);
        return null;
      }

      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.error(`[SeriesWorldBibleExtractor] No JSON found in response for manuscript`);
        return null;
      }

      const extracted: ExtractedWorldBibleData = JSON.parse(jsonMatch[0]);
      console.log(`[SeriesWorldBibleExtractor] Extracted from manuscript: ${extracted.characters?.length || 0} characters, ${extracted.locations?.length || 0} locations, ${extracted.lessons?.length || 0} lessons`);

      return extracted;
    } catch (error) {
      console.error(`[SeriesWorldBibleExtractor] Error extracting from manuscript:`, error);
      return null;
    }
  }

  async getSeriesWorldBible(seriesId: number): Promise<ExtractedWorldBibleData | null> {
    const result = await db.select().from(seriesWorldBible).where(eq(seriesWorldBible.seriesId, seriesId)).limit(1);
    
    if (result.length === 0) return null;
    
    return {
      characters: (result[0].characters as SeriesWorldBibleCharacter[]) || [],
      locations: (result[0].locations as SeriesWorldBibleLocation[]) || [],
      lessons: (result[0].lessons as SeriesWorldBibleLesson[]) || [],
      worldRules: (result[0].worldRules as SeriesWorldBibleRule[]) || [],
      timeline: (result[0].timeline as SeriesWorldBibleEvent[]) || [],
      objects: (result[0].objects as SeriesWorldBibleObject[]) || [],
      secrets: (result[0].secrets as SeriesWorldBibleSecret[]) || [],
    };
  }

  formatForGhostwriter(data: ExtractedWorldBibleData, targetVolume: number): string {
    let context = `=== SERIES WORLD BIBLE (Accumulated from previous volumes) ===\n\n`;

    if (data.characters.length > 0) {
      context += `## ESTABLISHED CHARACTERS:\n`;
      for (const char of data.characters) {
        context += `\n### ${char.name} (${char.role})\n`;
        context += `- Status: ${char.status}\n`;
        context += `- First appeared: Volume ${char.firstAppearanceVolume}\n`;
        context += `- Description: ${char.description}\n`;
        if (char.development) context += `- Development so far: ${char.development}\n`;
        if (char.physicalTraits?.length) context += `- Physical traits: ${char.physicalTraits.join(", ")}\n`;
        if (char.skills?.length) context += `- Skills: ${char.skills.join(", ")}\n`;
        if (char.relationships?.length) {
          context += `- Relationships: ${char.relationships.map(r => `${r.relation} of ${r.character}`).join(", ")}\n`;
        }
      }
    }

    if (data.locations.length > 0) {
      context += `\n## ESTABLISHED LOCATIONS:\n`;
      for (const loc of data.locations) {
        context += `\n### ${loc.name} (${loc.type})\n`;
        context += `- ${loc.description}\n`;
        context += `- Significance: ${loc.significance}\n`;
        if (loc.keyEvents?.length) context += `- Past events here: ${loc.keyEvents.join("; ")}\n`;
      }
    }

    if (data.lessons.length > 0) {
      context += `\n## LESSONS LEARNED (by characters):\n`;
      for (const lesson of data.lessons) {
        context += `- ${lesson.learnedByCharacter} (Vol. ${lesson.volumeNumber}): ${lesson.description}\n`;
        context += `  Impact: ${lesson.impact}\n`;
      }
    }

    if (data.worldRules.length > 0) {
      context += `\n## ESTABLISHED WORLD RULES:\n`;
      for (const rule of data.worldRules) {
        context += `- [${rule.category}] ${rule.rule}\n`;
        if (rule.constraints?.length) context += `  Constraints: ${rule.constraints.join(", ")}\n`;
      }
    }

    if (data.timeline.length > 0) {
      context += `\n## KEY PAST EVENTS (Timeline):\n`;
      for (const event of data.timeline) {
        context += `- Vol. ${event.volumeNumber}: ${event.description}\n`;
        context += `  Affected: ${event.affectedCharacters.join(", ")}\n`;
        context += `  Consequences: ${event.consequences}\n`;
      }
    }

    if (data.objects.length > 0) {
      context += `\n## SIGNIFICANT OBJECTS:\n`;
      for (const obj of data.objects) {
        context += `- ${obj.name}: ${obj.description}\n`;
        context += `  Status: ${obj.status}${obj.owner ? `, owned by ${obj.owner}` : ""}\n`;
        context += `  Significance: ${obj.significance}\n`;
      }
    }

    if (data.secrets.length > 0) {
      const unresolvedSecrets = data.secrets.filter(s => !s.isResolved);
      if (unresolvedSecrets.length > 0) {
        context += `\n## UNRESOLVED SECRETS/MYSTERIES:\n`;
        for (const secret of unresolvedSecrets) {
          context += `- ${secret.description}\n`;
          context += `  Known by: ${secret.knownBy.join(", ")}\n`;
          context += `  Potential impact: ${secret.impact}\n`;
        }
      }
    }

    context += `\n=== END SERIES WORLD BIBLE ===\n`;
    context += `\nIMPORTANT: You are writing Volume ${targetVolume}. All the above information is established canon from previous volumes. Maintain consistency with all characters, locations, rules, and events.\n`;

    return context;
  }
}
