// LitAgents 2.0 - Prompts optimizados para DeepSeek (V3 y R1)

/**
 * Find a character in the World Bible by name (fuzzy match)
 */
function findCharacterInWorldBible(charName: string, worldBible: any): any | null {
  const characters = worldBible?.characters || worldBible?.personajes || [];
  const charNameLower = charName.toLowerCase().trim();
  
  return characters.find((c: any) => {
    const wbName = (c.name || c.nombre || '').toLowerCase().trim();
    return wbName.includes(charNameLower) || charNameLower.includes(wbName) || 
           wbName.split(' ')[0] === charNameLower.split(' ')[0];
  }) || null;
}

/**
 * Extract physical attributes for characters appearing in a scene
 * This prevents the Ghostwriter from inventing incorrect eye colors, hair, etc.
 */
function extractCharacterAttributesForScene(sceneCharacters: string[], worldBible: any): string | null {
  const characters = worldBible?.characters || worldBible?.personajes || [];
  if (!worldBible || characters.length === 0 || !sceneCharacters || sceneCharacters.length === 0) {
    return null;
  }
  
  const lines: string[] = [];
  
  for (const charName of sceneCharacters) {
    // Find matching character in World Bible (fuzzy match on name)
    const wbChar = findCharacterInWorldBible(charName, worldBible);
    
    if (wbChar) {
      const attrs: string[] = [];
      
      // Extract physical attributes from various possible fields
      if (wbChar.eyeColor) attrs.push(`Ojos: ${wbChar.eyeColor}`);
      if (wbChar.hairColor) attrs.push(`Cabello: ${wbChar.hairColor}`);
      if (wbChar.age) attrs.push(`Edad: ${wbChar.age}`);
      if (wbChar.height) attrs.push(`Altura: ${wbChar.height}`);
      if (wbChar.physicalTraits) attrs.push(`Rasgos: ${wbChar.physicalTraits}`);
      
      // Also check traits array for physical descriptions
      if (wbChar.traits && Array.isArray(wbChar.traits)) {
        const physicalTraits = wbChar.traits.filter((t: string) => 
          /ojo|cabello|pelo|altura|cicatriz|tatuaje|físic/i.test(t)
        );
        if (physicalTraits.length > 0) {
          attrs.push(...physicalTraits.map((t: string) => `  - ${t}`));
        }
      }
      
      // Check description for "INMUTABLE" markers
      if (wbChar.description) {
        const inmutableMatch = wbChar.description.match(/\(INMUTABLE[^)]*\)/gi);
        if (inmutableMatch) {
          attrs.push(`⚠️ ${inmutableMatch.join(', ')}`);
        }
        // Also extract eye/hair from description if not already found
        if (!wbChar.eyeColor) {
          const eyeMatch = wbChar.description.match(/ojos?\s+([\w\s]+?)(?:\s*\(|,|\.)/i);
          if (eyeMatch) attrs.push(`Ojos: ${eyeMatch[1].trim()}`);
        }
      }
      
      if (attrs.length > 0) {
        lines.push(`    📌 ${wbChar.name}:`);
        for (const attr of attrs) {
          lines.push(`       ${attr}`);
        }
      }
    }
  }
  
  return lines.length > 0 ? lines.join('\n') : null;
}

/**
 * Extract character relationships relevant to characters in the scene
 */
function extractCharacterRelationshipsForScene(sceneCharacters: string[], worldBible: any): string | null {
  if (!sceneCharacters || sceneCharacters.length < 2) return null;
  
  const lines: string[] = [];
  const characters = worldBible?.characters || worldBible?.personajes || [];
  
  for (const charName of sceneCharacters) {
    const wbChar = findCharacterInWorldBible(charName, worldBible);
    if (!wbChar) continue;
    
    // Check for relationships field
    const relationships = wbChar.relationships || wbChar.relaciones || [];
    if (Array.isArray(relationships) && relationships.length > 0) {
      // Filter to only show relationships with other characters in this scene
      const relevantRels = relationships.filter((rel: any) => {
        const targetName = (rel.character || rel.personaje || rel.with || '').toLowerCase();
        return sceneCharacters.some(sc => targetName.includes(sc.toLowerCase()) || sc.toLowerCase().includes(targetName));
      });
      
      if (relevantRels.length > 0) {
        lines.push(`    📌 ${wbChar.name || wbChar.nombre}:`);
        for (const rel of relevantRels) {
          const target = rel.character || rel.personaje || rel.with || '';
          const type = rel.type || rel.tipo || rel.relation || '';
          const desc = rel.description || rel.descripcion || '';
          lines.push(`       → ${target}: ${type}${desc ? ` - ${desc}` : ''}`);
        }
      }
    }
    
    // Also check description for relationship mentions
    if (wbChar.description || wbChar.descripcion) {
      const desc = wbChar.description || wbChar.descripcion;
      for (const otherChar of sceneCharacters) {
        if (otherChar.toLowerCase() === charName.toLowerCase()) continue;
        if (desc.toLowerCase().includes(otherChar.toLowerCase())) {
          // There's a mention - could extract but would need more context
        }
      }
    }
  }
  
  return lines.length > 0 ? lines.join('\n') : null;
}

/**
 * Extract location description if the scene setting matches a World Bible location
 */
function extractLocationForScene(sceneSetting: string, worldBible: any): string | null {
  const locations = worldBible?.locations || worldBible?.lugares || worldBible?.settings || [];
  if (!locations || locations.length === 0 || !sceneSetting) return null;
  
  const settingLower = sceneSetting.toLowerCase();
  
  for (const loc of locations) {
    const locName = (loc.name || loc.nombre || '').toLowerCase();
    if (locName && (settingLower.includes(locName) || locName.includes(settingLower.split(' ')[0]))) {
      const lines: string[] = [];
      lines.push(`    📍 ${loc.name || loc.nombre}:`);
      if (loc.description || loc.descripcion) {
        lines.push(`       ${loc.description || loc.descripcion}`);
      }
      if (loc.sensoryDetails || loc.detalles_sensoriales) {
        const details = loc.sensoryDetails || loc.detalles_sensoriales;
        if (typeof details === 'string') {
          lines.push(`       Ambiente: ${details}`);
        } else if (Array.isArray(details)) {
          lines.push(`       Ambiente: ${details.join(', ')}`);
        }
      }
      if (loc.atmosphere || loc.atmosfera) {
        lines.push(`       Atmósfera: ${loc.atmosphere || loc.atmosfera}`);
      }
      return lines.join('\n');
    }
  }
  
  return null;
}

/**
 * Extract world rules that might be relevant (always include if present)
 */
function extractWorldRules(worldBible: any): string | null {
  const rules = worldBible?.rules || worldBible?.reglas_lore || worldBible?.worldRules || worldBible?.reglas || [];
  if (!rules || rules.length === 0) return null;
  
  const lines: string[] = [];
  for (const rule of rules.slice(0, 5)) { // Limit to top 5 rules to save tokens
    if (typeof rule === 'string') {
      lines.push(`    • ${rule}`);
    } else if (rule.rule || rule.regla) {
      lines.push(`    • ${rule.rule || rule.regla}`);
    }
  }
  
  return lines.length > 0 ? lines.join('\n') : null;
}

/**
 * Extract prohibited vocabulary
 */
function extractProhibitedVocabulary(worldBible: any): string | null {
  const vocab = worldBible?.vocabulario_prohibido || worldBible?.prohibitedWords || [];
  if (!vocab || vocab.length === 0) return null;
  
  return vocab.slice(0, 20).join(', '); // Limit to 20 words
}

/**
 * Extract dead characters to prevent resurrections
 */
function extractDeadCharacters(worldBible: any): string | null {
  const characters = worldBible?.characters || worldBible?.personajes || [];
  const deadChars: string[] = [];
  
  for (const char of characters) {
    const status = (char.status || char.estado || '').toLowerCase();
    const isDead = status.includes('muerto') || status.includes('dead') || 
                   status.includes('fallecido') || status.includes('deceased');
    
    // Also check description for death markers
    const desc = (char.description || char.descripcion || '').toLowerCase();
    const descDead = desc.includes('murió') || desc.includes('falleció') || 
                     desc.includes('fue asesinado') || desc.includes('(muerto)');
    
    if (isDead || descDead) {
      const name = char.name || char.nombre;
      const deathChapter = char.deathChapter || char.capitulo_muerte || '';
      deadChars.push(deathChapter ? `${name} (murió en cap. ${deathChapter})` : name);
    }
  }
  
  return deadChars.length > 0 ? deadChars.join(', ') : null;
}

/**
 * Extract active injuries for characters in the scene
 */
function extractActiveInjuries(sceneCharacters: string[], worldBible: any): string | null {
  const lines: string[] = [];
  
  for (const charName of sceneCharacters) {
    const wbChar = findCharacterInWorldBible(charName, worldBible);
    if (!wbChar) continue;
    
    const injuries = wbChar.injuries || wbChar.lesiones || wbChar.activeInjuries || [];
    const physicalState = wbChar.physicalState || wbChar.estadoFisico || '';
    
    const charInjuries: string[] = [];
    
    if (Array.isArray(injuries) && injuries.length > 0) {
      charInjuries.push(...injuries.map((i: any) => typeof i === 'string' ? i : i.description || i.descripcion));
    }
    
    if (physicalState) {
      charInjuries.push(physicalState);
    }
    
    // Check description for injury markers
    const desc = (wbChar.description || wbChar.descripcion || '');
    const injuryMatch = desc.match(/\(LESIÓN[^)]*\)|\(HERIDA[^)]*\)|\(INJURY[^)]*\)/gi);
    if (injuryMatch) {
      charInjuries.push(...injuryMatch);
    }
    
    if (charInjuries.length > 0) {
      lines.push(`    🏥 ${wbChar.name || wbChar.nombre}: ${charInjuries.join(', ')}`);
    }
  }
  
  return lines.length > 0 ? lines.join('\n') : null;
}

/**
 * Extract established objects (Chekhov's Gun) that have been mentioned
 */
function extractEstablishedObjects(worldBible: any): string | null {
  const objects = worldBible?.objects || worldBible?.objetos || worldBible?.establishedItems || [];
  if (!objects || objects.length === 0) return null;
  
  const lines: string[] = [];
  for (const obj of objects) { // LitAgents 2.9.8: No limit - include ALL objects
    if (typeof obj === 'string') {
      lines.push(`    • ${obj}`);
    } else {
      const name = obj.name || obj.nombre || '';
      const owner = obj.owner || obj.propietario || '';
      const chapter = obj.establishedIn || obj.capitulo || '';
      if (name) {
        let line = `    • ${name}`;
        if (owner) line += ` (de ${owner})`;
        if (chapter) line += ` [cap. ${chapter}]`;
        lines.push(line);
      }
    }
  }
  
  return lines.length > 0 ? lines.join('\n') : null;
}

/**
 * LitAgents 2.9.8: Extract FULL character index from World Bible
 * Provides complete list of ALL characters for consistency reference
 */
function extractFullCharacterIndex(worldBible: any): string | null {
  const characters = worldBible?.characters || worldBible?.personajes || [];
  if (!characters || characters.length === 0) return null;
  
  const lines: string[] = [];
  for (const char of characters) {
    const name = char.name || char.nombre || '';
    if (!name) continue;
    
    const details: string[] = [];
    if (char.role || char.rol) details.push(char.role || char.rol);
    if (char.eyeColor) details.push(`ojos ${char.eyeColor}`);
    if (char.hairColor) details.push(`cabello ${char.hairColor}`);
    if (char.age) details.push(`${char.age} años`);
    if (char.occupation || char.ocupacion) details.push(char.occupation || char.ocupacion);
    if (char.status === 'dead' || char.estado === 'muerto') details.push('☠️ MUERTO');
    
    const detailStr = details.length > 0 ? ` — ${details.join(', ')}` : '';
    lines.push(`    • ${name}${detailStr}`);
  }
  
  return lines.length > 0 ? lines.join('\n') : null;
}

/**
 * LitAgents 2.9.8: Extract FULL location index from World Bible
 * Provides complete list of ALL locations for consistency reference
 */
function extractFullLocationIndex(worldBible: any): string | null {
  const locations = worldBible?.locations || worldBible?.lugares || worldBible?.settings || [];
  if (!locations || locations.length === 0) return null;
  
  const lines: string[] = [];
  for (const loc of locations) {
    const name = loc.name || loc.nombre || '';
    if (!name) continue;
    
    const details: string[] = [];
    if (loc.type || loc.tipo) details.push(loc.type || loc.tipo);
    if (loc.region || loc.zona) details.push(loc.region || loc.zona);
    
    const detailStr = details.length > 0 ? ` — ${details.join(', ')}` : '';
    lines.push(`    • ${name}${detailStr}`);
  }
  
  return lines.length > 0 ? lines.join('\n') : null;
}

/**
 * LitAgents 2.9.8: Extract FULL object index from World Bible (no limit)
 * Provides complete list of ALL significant objects for Chekhov's Gun compliance
 */
function extractFullObjectIndex(worldBible: any): string | null {
  const objects = worldBible?.objects || worldBible?.objetos || worldBible?.establishedItems || [];
  if (!objects || objects.length === 0) return null;
  
  const lines: string[] = [];
  for (const obj of objects) { // No limit - include ALL objects
    if (typeof obj === 'string') {
      lines.push(`    • ${obj}`);
    } else {
      const name = obj.name || obj.nombre || '';
      const owner = obj.owner || obj.propietario || '';
      const significance = obj.significance || obj.importancia || '';
      if (name) {
        let line = `    • ${name}`;
        if (owner) line += ` (de ${owner})`;
        if (significance) line += ` — ${significance}`;
        lines.push(line);
      }
    }
  }
  
  return lines.length > 0 ? lines.join('\n') : null;
}

/**
 * Extract continuity watchpoints (critical points to watch)
 */
function extractWatchpoints(worldBible: any): string | null {
  const watchpoints = worldBible?.watchpoints_continuidad || worldBible?.watchpoints || [];
  if (!watchpoints || watchpoints.length === 0) return null;
  
  const lines: string[] = [];
  for (const wp of watchpoints.slice(0, 5)) { // Limit to 5 watchpoints
    if (typeof wp === 'string') {
      lines.push(`    ⚠️ ${wp}`);
    } else {
      lines.push(`    ⚠️ ${wp.description || wp.descripcion || JSON.stringify(wp)}`);
    }
  }
  
  return lines.length > 0 ? lines.join('\n') : null;
}

/**
 * Extract central themes of the novel
 */
function extractCentralThemes(worldBible: any): string | null {
  const themes = worldBible?.temas_centrales || worldBible?.centralThemes || worldBible?.themes || [];
  if (!themes || themes.length === 0) return null;
  
  const themeList = themes.slice(0, 5).map((t: any) => {
    if (typeof t === 'string') return t;
    return t.name || t.nombre || t.theme || t.tema || '';
  }).filter(Boolean);
  
  return themeList.length > 0 ? themeList.join(', ') : null;
}

/**
 * Extract literary motifs
 */
function extractLiteraryMotifs(worldBible: any): string | null {
  const motifs = worldBible?.motivos_literarios || worldBible?.literaryMotifs || worldBible?.motifs || [];
  if (!motifs || motifs.length === 0) return null;
  
  const motifList = motifs.slice(0, 5).map((m: any) => {
    if (typeof m === 'string') return m;
    return m.name || m.nombre || m.motif || m.motivo || '';
  }).filter(Boolean);
  
  return motifList.length > 0 ? motifList.join(', ') : null;
}

/**
 * Extract global sensory palette (characteristic colors, sounds, smells)
 */
function extractSensoryPalette(worldBible: any): string | null {
  const palette = worldBible?.paleta_sensorial_global || worldBible?.sensoryPalette || worldBible?.palette || {};
  if (!palette || Object.keys(palette).length === 0) return null;
  
  const lines: string[] = [];
  
  if (palette.colores || palette.colors) {
    lines.push(`    🎨 Colores: ${Array.isArray(palette.colores || palette.colors) ? (palette.colores || palette.colors).join(', ') : palette.colores || palette.colors}`);
  }
  if (palette.sonidos || palette.sounds) {
    lines.push(`    🔊 Sonidos: ${Array.isArray(palette.sonidos || palette.sounds) ? (palette.sonidos || palette.sounds).join(', ') : palette.sonidos || palette.sounds}`);
  }
  if (palette.olores || palette.smells) {
    lines.push(`    👃 Olores: ${Array.isArray(palette.olores || palette.smells) ? (palette.olores || palette.smells).join(', ') : palette.olores || palette.smells}`);
  }
  if (palette.texturas || palette.textures) {
    lines.push(`    ✋ Texturas: ${Array.isArray(palette.texturas || palette.textures) ? (palette.texturas || palette.textures).join(', ') : palette.texturas || palette.textures}`);
  }
  if (palette.atmosfera || palette.atmosphere) {
    lines.push(`    🌫️ Atmósfera: ${palette.atmosfera || palette.atmosphere}`);
  }
  
  return lines.length > 0 ? lines.join('\n') : null;
}

/**
 * Extract character voice/speech patterns for characters in the scene
 */
function extractCharacterVoices(sceneCharacters: string[], worldBible: any): string | null {
  const lines: string[] = [];
  
  for (const charName of sceneCharacters) {
    const wbChar = findCharacterInWorldBible(charName, worldBible);
    if (!wbChar) continue;
    
    const voice = wbChar.voice || wbChar.voz || wbChar.speechPattern || wbChar.patron_habla || '';
    const dialect = wbChar.dialect || wbChar.dialecto || '';
    const catchphrases = wbChar.catchphrases || wbChar.muletillas || [];
    
    const voiceInfo: string[] = [];
    if (voice) voiceInfo.push(voice);
    if (dialect) voiceInfo.push(`Dialecto: ${dialect}`);
    if (Array.isArray(catchphrases) && catchphrases.length > 0) {
      voiceInfo.push(`Muletillas: "${catchphrases.slice(0, 3).join('", "')}"`);
    }
    
    if (voiceInfo.length > 0) {
      lines.push(`    🗣️ ${wbChar.name || wbChar.nombre}: ${voiceInfo.join(' | ')}`);
    }
  }
  
  return lines.length > 0 ? lines.join('\n') : null;
}

/**
 * Extract character arcs and current state in story
 */
function extractCharacterArcs(sceneCharacters: string[], worldBible: any): string | null {
  const lines: string[] = [];
  
  for (const charName of sceneCharacters) {
    const wbChar = findCharacterInWorldBible(charName, worldBible);
    if (!wbChar) continue;
    
    const arc = wbChar.arc || wbChar.arco || wbChar.characterArc || wbChar.arco_personaje || '';
    const currentState = wbChar.currentState || wbChar.estado_actual || '';
    const motivation = wbChar.motivation || wbChar.motivacion || '';
    const fear = wbChar.fear || wbChar.miedo || wbChar.greatestFear || '';
    
    const arcInfo: string[] = [];
    if (arc) arcInfo.push(`Arco: ${arc}`);
    if (currentState) arcInfo.push(`Estado: ${currentState}`);
    if (motivation) arcInfo.push(`Motivación: ${motivation}`);
    if (fear) arcInfo.push(`Miedo: ${fear}`);
    
    if (arcInfo.length > 0) {
      lines.push(`    📈 ${wbChar.name || wbChar.nombre}:`);
      for (const info of arcInfo) {
        lines.push(`       ${info}`);
      }
    }
  }
  
  return lines.length > 0 ? lines.join('\n') : null;
}

/**
 * Extract the premise of the novel (short summary)
 */
function extractPremise(worldBible: any): string | null {
  const premise = worldBible?.premisa || worldBible?.premise || '';
  if (!premise) return null;
  
  // Limit to first 200 characters to save tokens
  if (premise.length > 200) {
    return premise.substring(0, 200) + '...';
  }
  return premise;
}

/**
 * Extract timeline/era constraints
 */
function extractTimelineConstraints(worldBible: any): string | null {
  const era = worldBible?.era || worldBible?.epoca || worldBible?.timePeriod || '';
  const year = worldBible?.year || worldBible?.año || '';
  const technology = worldBible?.technology || worldBible?.tecnologia || '';
  
  const lines: string[] = [];
  if (era) lines.push(`    📅 Época: ${era}`);
  if (year) lines.push(`    📅 Año: ${year}`);
  if (technology) lines.push(`    💻 Tecnología: ${technology}`);
  
  // LitAgents 2.9.9: Extract dated events from World Bible
  const events = worldBible?.events || worldBible?.eventos || 
                 worldBible?.timeline || worldBible?.linea_temporal ||
                 worldBible?.keyEvents || worldBible?.eventosClave ||
                 worldBible?.timeline_master?.key_events || [];
  
  if (Array.isArray(events) && events.length > 0) {
    lines.push(`\n    ⏱️ CRONOLOGÍA DE EVENTOS (OBLIGATORIO RESPETAR):`);
    const sortedEvents = [...events].sort((a: any, b: any) => {
      const dateA = a.date || a.fecha || a.day || a.dia || '';
      const dateB = b.date || b.fecha || b.day || b.dia || '';
      return String(dateA).localeCompare(String(dateB));
    });
    
    for (const event of sortedEvents) {
      const date = event.date || event.fecha || event.day || event.dia || '';
      const description = event.description || event.descripcion || event.event || event.evento || '';
      const chapter = event.chapter || event.capitulo || '';
      
      if (date && description) {
        let eventLine = `      • ${date}: ${description}`;
        if (chapter) eventLine += ` [Cap. ${chapter}]`;
        lines.push(eventLine);
      }
    }
    
    lines.push(`\n    ⚠️ IMPORTANTE: Las referencias temporales ("hace X días", "ayer", "la semana pasada") DEBEN ser consistentes con esta cronología.`);
  }
  
  // Extract character-related dated events (deaths, injuries, meetings, etc.)
  const characters = worldBible?.characters || worldBible?.personajes || [];
  const datedCharacterEvents: string[] = [];
  
  for (const char of characters) {
    const name = char.name || char.nombre || '';
    const deathDate = char.deathDate || char.fechaMuerte || '';
    const injuryDate = char.injuryDate || char.fechaLesion || '';
    const charEvents = char.events || char.eventos || [];
    
    if (deathDate) {
      datedCharacterEvents.push(`      • ${deathDate}: Muerte de ${name}`);
    }
    if (injuryDate) {
      const injury = char.injury || char.lesion || 'lesión';
      datedCharacterEvents.push(`      • ${injuryDate}: ${name} sufre ${injury}`);
    }
    if (Array.isArray(charEvents)) {
      for (const evt of charEvents) {
        const evtDate = evt.date || evt.fecha || '';
        const evtDesc = evt.description || evt.descripcion || '';
        if (evtDate && evtDesc) {
          datedCharacterEvents.push(`      • ${evtDate}: ${name} - ${evtDesc}`);
        }
      }
    }
  }
  
  if (datedCharacterEvents.length > 0) {
    lines.push(`\n    👤 EVENTOS DE PERSONAJES FECHADOS:`);
    lines.push(...datedCharacterEvents);
  }
  
  return lines.length > 0 ? lines.join('\n') : null;
}

export const AGENT_MODELS_V2 = {
  REASONER: "deepseek-reasoner", // R1: Para planificación y razonamiento profundo
  WRITER: "deepseek-chat",       // V3: Para escritura creativa
  FAST: "deepseek-chat"          // V3: Para resumir/editar rápido
};

export const PROMPTS_V2 = {
  
  // 1. GLOBAL ARCHITECT (R1) - Crea World Bible y escaleta maestra
  GLOBAL_ARCHITECT: (
    premise: string, 
    genre: string, 
    chapters: number, 
    tone: string, 
    architectInstructions?: string,
    extendedGuide?: string,
    styleGuide?: string,
    hasPrologue?: boolean,
    hasEpilogue?: boolean,
    hasAuthorNote?: boolean,
    workType?: string,
    seriesName?: string,
    seriesOrder?: number,
    previousBooksContext?: string,
    minWordsPerChapter?: number,
    maxWordsPerChapter?: number,
    isKindleUnlimited?: boolean
  ) => `
    Eres un Arquitecto Narrativo de Best-Sellers con experiencia en ${genre}.
    IDIOMA: Escribe TODO en ESPAÑOL. Títulos de capítulos, descripciones, nombres de personajes típicos del contexto, todo debe estar en español.
    OBJETIVO: Crear la estructura maestra para una novela de ${genre} con un MÍNIMO de ${chapters} capítulos regulares.
    PREMISA: "${premise}"
    TONO: ${tone}
    ${architectInstructions ? `INSTRUCCIONES ADICIONALES DEL AUTOR: ${architectInstructions}` : ''}
    
    === CONFIGURACIÓN DE LA NOVELA ===
    - Estructura: ${hasPrologue ? 'Con Prólogo' : 'Sin Prólogo'} | ${hasEpilogue ? 'Con Epílogo' : 'Sin Epílogo'} | ${hasAuthorNote ? 'Con Nota del Autor' : 'Sin Nota del Autor'}
    - Palabras por capítulo: ${minWordsPerChapter || 1500}-${maxWordsPerChapter || 3500}
    ${workType === 'series' ? `
    === INFORMACIÓN DE SERIE ===
    - Nombre de la serie: ${seriesName || 'No especificado'}
    - Este es el libro #${seriesOrder || 1} de la serie
    ${previousBooksContext ? `- Contexto de libros anteriores: ${previousBooksContext}` : ''}
    
    ╔══════════════════════════════════════════════════════════════════╗
    ║ ⚠️ PROTECCIÓN DE PERSONAJES DE SERIE (INVIOLABLE)               ║
    ╠══════════════════════════════════════════════════════════════════╣
    ║                                                                  ║
    ║ Los personajes definidos en la guía de la serie son SAGRADOS.   ║
    ║ ESTÁ ABSOLUTAMENTE PROHIBIDO:                                   ║
    ║                                                                  ║
    ║ 1. CAMBIAR NOMBRES: Si la guía dice "Elena Voss", NO puedes    ║
    ║    renombrarla como "Helena", "Elisa", ni ningún otro nombre.   ║
    ║    Usa el nombre EXACTO tal como aparece en la guía.            ║
    ║                                                                  ║
    ║ 2. CAMBIAR SEXO/GÉNERO: Si un personaje es mujer en la guía,   ║
    ║    DEBE ser mujer en la biblia del mundo. Si es hombre, DEBE    ║
    ║    ser hombre. NUNCA cambiar el género de un personaje.         ║
    ║                                                                  ║
    ║ 3. CAMBIAR ROL: Si la guía define un personaje como             ║
    ║    protagonista/antagonista/aliado, MANTÉN ese mismo rol.       ║
    ║                                                                  ║
    ║ 4. INVENTAR REEMPLAZOS: NO sustituyas personajes de la guía    ║
    ║    por personajes nuevos con funciones similares.               ║
    ║                                                                  ║
    ║ 5. ALTERAR ATRIBUTOS FÍSICOS: Ojos, cabello, edad, rasgos      ║
    ║    distintivos definidos en la guía son INMUTABLES.             ║
    ║                                                                  ║
    ║ REGLA: Copia los personajes de la guía de serie TAL CUAL.      ║
    ║ Puedes AÑADIR personajes nuevos secundarios, pero NUNCA        ║
    ║ modificar los existentes de la guía.                            ║
    ╚══════════════════════════════════════════════════════════════════╝
    ` : ''}
    ${extendedGuide ? `
    === GUÍA DE ESCRITURA EXTENDIDA (SEGUIR OBLIGATORIAMENTE) ===
    Esta guía contiene los personajes, escenarios, estructura y detalles específicos que DEBES respetar:
    
    ${extendedGuide}
    
    IMPORTANTE: Usa EXACTAMENTE los personajes, nombres, ubicaciones y estructura definidos en esta guía. NO inventes personajes nuevos a menos que la guía lo permita.
    ${workType === 'series' ? `
    ⚠️ RECORDATORIO SERIE: Los nombres y géneros de los personajes en esta guía son INMUTABLES.
    Si la guía dice "Inspector García" (hombre), NO lo conviertas en "Inspectora García" ni en "Inspector Gómez".
    Copia EXACTAMENTE cada nombre, sexo y rol tal como aparece arriba.` : ''}
    ` : ''}
    ${styleGuide ? `
    === GUÍA DE ESTILO ===
    ${styleGuide}
    ` : ''}
    ${isKindleUnlimited ? `
    ╔══════════════════════════════════════════════════════════════════╗
    ║ OPTIMIZACIÓN KINDLE UNLIMITED (KU) - OBLIGATORIO                 ║
    ╠══════════════════════════════════════════════════════════════════╣
    ║ Esta novela será publicada en Kindle Unlimited. DISEÑA para     ║
    ║ maximizar retención de lectores y pages read:                    ║
    ║                                                                  ║
    ║ 1. ESTRUCTURA DE CAPÍTULOS:                                      ║
    ║    - Planifica CLIFFHANGERS al final de CADA capítulo           ║
    ║    - Cada capítulo debe terminar en: pregunta sin respuesta,    ║
    ║      revelación impactante, peligro inminente, o decisión       ║
    ║      crucial pendiente                                           ║
    ║    - NUNCA termines un capítulo con resolución completa         ║
    ║                                                                  ║
    ║ 2. HOOKS DE APERTURA:                                            ║
    ║    - Planifica que cada capítulo abra con acción o tensión      ║
    ║    - Las primeras líneas deben capturar inmediatamente          ║
    ║    - Evita aperturas descriptivas largas o introspectivas       ║
    ║                                                                  ║
    ║ 3. RITMO Y PACING:                                               ║
    ║    - Alterna tensión alta/media - nunca 2 capítulos lentos      ║
    ║    - Planifica eventos significativos cada 2-3 capítulos        ║
    ║    - Los capítulos deben tener longitud consistente             ║
    ║      (2000-3500 palabras ideal para KU)                          ║
    ║                                                                  ║
    ║ 4. PUNTOS DE NO RETORNO:                                         ║
    ║    - Ubica eventos irreversibles en el 25%, 50%, y 75%          ║
    ║    - Estos eventos deben hacer imposible abandonar la lectura   ║
    ╚══════════════════════════════════════════════════════════════════╝
    ` : ''}

    PROCESO DE DISEÑO:
    1. Analiza la premisa y define los temas centrales
    2. Diseña personajes memorables con arcos de transformación
    3. Establece las reglas del mundo (especialmente si es fantasía/ciencia ficción)
    4. Planifica la estructura de 3 actos con puntos de giro
    5. Define los hilos narrativos que mantendrán la tensión
    6. **NUEVO**: Crea la LÍNEA TEMPORAL MAESTRA (qué día/momento ocurre cada capítulo)
    7. **NUEVO**: Crea el MAPA DE UBICACIONES con tiempos de viaje realistas
    8. **NUEVO**: Define el ESTADO INICIAL de cada personaje principal

    ╔══════════════════════════════════════════════════════════════════╗
    ║ REGLAS DE DISEÑO ANTI-CLICHÉ (OBLIGATORIAS EN TODO CAPÍTULO)    ║
    ╠══════════════════════════════════════════════════════════════════╣
    ║                                                                  ║
    ║ 1. PROTAGONISTA ACTIVO:                                         ║
    ║    - El protagonista obtiene información por MÉRITO PROPIO      ║
    ║    - PROHIBIDO planificar: mensajes anónimos, llamadas          ║
    ║      misteriosas, informantes oportunos, "alguien le envía"     ║
    ║    - Cada descubrimiento debe ser GANADO: investigación,        ║
    ║      interrogatorio, deducción, infiltración, vigilancia.       ║
    ║                                                                  ║
    ║ 2. VARIEDAD ESTRUCTURAL EN CADA CAPÍTULO:                       ║
    ║    - NO repetir patrones consecutivos. Si Cap 5 tiene           ║
    ║      "viaje + reflexión + encuentro", Cap 6 debe ser diferente. ║
    ║    - Alternar: acción, diálogo tenso, descubrimiento,           ║
    ║      confrontación, análisis, escape, trampa, traición.         ║
    ║    - Evitar abuso de descripciones climáticas (lluvia, frío).   ║
    ║                                                                  ║
    ║ 3. ANTAGONISTAS COMPETENTES E INTELIGENTES:                     ║
    ║    - Los villanos NO explican sus planes al héroe.              ║
    ║    - No planificar escenas tipo "el villano monologa antes      ║
    ║      de matar". Los antagonistas ACTÚAN con competencia.        ║
    ║    - Si hay confrontación verbal, el villano AMENAZA o PROVOCA, ║
    ║      pero NUNCA revela su estrategia completa.                  ║
    ║                                                                  ║
    ║ 4. GESTOS Y MULETILLAS LIMITADOS:                               ║
    ║    - Define gestos característicos pero planifica su uso        ║
    ║      ESPACIADO (1 vez cada 5-10 capítulos, no en cada uno).     ║
    ║    - Evitar que un personaje repita el mismo gesto físico       ║
    ║      (tocarse anillo, cicatriz, etc.) en múltiples capítulos.   ║
    ║                                                                  ║
    ║ 5. CREDIBILIDAD NARRATIVA (FUNDAMENTAL):                        ║
    ║    - Define EXPLÍCITAMENTE las habilidades del protagonista     ║
    ║      (formación, idiomas, combate, tecnología, contactos).      ║
    ║    - El protagonista SOLO puede usar habilidades definidas.     ║
    ║    - Define recursos iniciales (dinero, armas, vehículos).      ║
    ║    - Planifica cómo el protagonista OBTIENE nuevos recursos     ║
    ║      durante la trama (no pueden aparecer mágicamente).         ║
    ║    - Máximo 1 coincidencia afortunada en toda la novela.        ║
    ║    - Las heridas graves tienen consecuencias en capítulos       ║
    ║      posteriores (no desaparecen convenientemente).             ║
    ║    - Los enemigos recuerdan al protagonista y toman medidas.    ║
    ╚══════════════════════════════════════════════════════════════════╝

    ╔══════════════════════════════════════════════════════════════════╗
    ║ REGLA DE CAPÍTULOS: MÍNIMO ${chapters} CAPÍTULOS REGULARES               ║
    ╠══════════════════════════════════════════════════════════════════╣
    ║ El usuario solicita un MÍNIMO de ${chapters} capítulos regulares.         ║
    ║                                                                  ║
    ║ REGLA DE FLEXIBILIDAD NARRATIVA:                                 ║
    ║ Si ${chapters} capítulos NO son suficientes para desarrollar              ║
    ║ correctamente todos los arcos narrativos, hilos de trama,        ║
    ║ y puntos de giro, PUEDES añadir capítulos regulares adicionales. ║
    ║                                                                  ║
    ║ CRITERIOS para añadir capítulos:                                 ║
    ║ - Los arcos de personajes necesitan más espacio para resolverse  ║
    ║ - Los puntos de giro están demasiado comprimidos                 ║
    ║ - La tensión narrativa no puede construirse adecuadamente        ║
    ║ - Los hilos secundarios no tienen espacio para desarrollarse     ║
    ║ - El desenlace se siente apresurado                              ║
    ║                                                                  ║
    ║ LÍMITES: Puedes añadir hasta un 30% más de capítulos             ║
    ║ (máximo ${chapters + Math.ceil(chapters * 0.3)} capítulos regulares si es necesario).        ║
    ║ No añadas capítulos innecesarios de relleno.                     ║
    ║                                                                  ║
    ║ El prólogo y epílogo son ADICIONALES, NO cuentan:                ║
    ║ ${hasPrologue ? '  - Prólogo = chapter_num: 0 (ADICIONAL, no cuenta)' : '  - Sin prólogo'}         ║
    ║ ${hasEpilogue ? '  - Epílogo = chapter_num: 998 (ADICIONAL, no cuenta)' : '  - Sin epílogo'}       ║
    ║                                                                  ║
    ║ VERIFICA: chapter_num 1, 2, 3... consecutivos SIN saltos.        ║
    ╚══════════════════════════════════════════════════════════════════╝

    ╔══════════════════════════════════════════════════════════════════╗
    ║ ⚠️ REGLA CRÍTICA: PRESENCIA DEL PROTAGONISTA (OBLIGATORIA)      ║
    ╠══════════════════════════════════════════════════════════════════╣
    ║                                                                  ║
    ║ El PROTAGONISTA (personaje principal, POV, héroe) DEBE:         ║
    ║                                                                  ║
    ║ 1. Estar EXPLÍCITAMENTE NOMBRADO en el "summary" O "key_event"  ║
    ║    de AL MENOS el 40% de los capítulos (${Math.ceil(chapters * 0.4)} de ${chapters} caps).       ║
    ║                                                                  ║
    ║ 2. Aparecer en los capítulos MÁS IMPORTANTES:                   ║
    ║    - Prólogo (si existe): establecer al protagonista            ║
    ║    - Capítulo 1: OBLIGATORIO                                    ║
    ║    - Punto de giro 25% (~Cap ${Math.ceil(chapters * 0.25)}): OBLIGATORIO                  ║
    ║    - Punto medio 50% (~Cap ${Math.ceil(chapters * 0.5)}): OBLIGATORIO                    ║
    ║    - Clímax 75% (~Cap ${Math.ceil(chapters * 0.75)}): OBLIGATORIO                        ║
    ║    - Capítulo final: OBLIGATORIO                                ║
    ║                                                                  ║
    ║ 3. En el "summary" o "key_event", usa el NOMBRE PROPIO del      ║
    ║    protagonista, NO solo pronombres o "el protagonista".        ║
    ║    INCORRECTO: "El héroe descubre la verdad"                    ║
    ║    CORRECTO: "María descubre que su padre la traicionó"         ║
    ║                                                                  ║
    ║ 4. Si la guía extendida define un protagonista, USA ESE NOMBRE. ║
    ║    NO inventes nombres diferentes para el personaje principal.  ║
    ║                                                                  ║
    ║ VALIDACIÓN: El sistema RECHAZARÁ estructuras donde el           ║
    ║ protagonista no aparezca en suficientes capítulos.              ║
    ╚══════════════════════════════════════════════════════════════════╝

    ${chapters > 20 ? `
    ╔══════════════════════════════════════════════════════════════════╗
    ║ FORMATO COMPACTO OBLIGATORIO (NOVELA DE ${chapters} CAPÍTULOS)            ║
    ╠══════════════════════════════════════════════════════════════════╣
    ║ ATENCIÓN: Con ${chapters} capítulos, tu respuesta JSON será MUY larga.    ║
    ║ Para evitar truncamiento, usa el FORMATO COMPACTO:              ║
    ║                                                                  ║
    ║ 1. En "outline": SOLO usa chapter_num, title, act, summary,     ║
    ║    key_event, structural_role. NO incluyas emotional_arc,        ║
    ║    temporal_notes, location, ni character_states_entering.        ║
    ║ 2. En "summary": máximo 1 línea (40-60 palabras).               ║
    ║ 3. En "key_event": máximo 15 palabras.                          ║
    ║ 4. "timeline_master": SOLO story_duration, start_date, y        ║
    ║    key_events (máx 8-10 eventos clave). NO chapter_timeline.    ║
    ║ 5. "character_tracking": OMITIR completamente.                  ║
    ║ 6. Personajes: máximo 5-6 líneas cada uno.                      ║
    ║ 7. PRIORIDAD ABSOLUTA: Generar los ${chapters} capítulos COMPLETOS.      ║
    ║    Si dudas entre más detalle o más capítulos, SIEMPRE elige    ║
    ║    completar TODOS los capítulos.                               ║
    ╚══════════════════════════════════════════════════════════════════╝
    ` : ''}
    SALIDA REQUERIDA (JSON Estricto):
    {
      "world_bible": { 
        "characters": [
          {
            "name": "Nombre del personaje",
            "role": "protagonista/antagonista/aliado/mentor",
            "profile": "Descripción psicológica profunda",
            "arc": "Transformación a lo largo de la historia",
            "appearance": {
              "eyes": "Color de ojos (INMUTABLE)",
              "hair": "Color y estilo de cabello (INMUTABLE)",
              "distinguishing_features": ["Rasgos distintivos"]
            },
            "initial_state": {
              "location": "Ciudad/lugar donde empieza",
              "physical_condition": "Sano/heridas previas/discapacidades",
              "resources": ["Armas", "Dinero aproximado", "Vehículos", "Contactos clave"],
              "skills": ["Habilidades específicas que posee"]
            }
          }
        ],
        "rules": [
          {"category": "magia/sociedad/tecnología", "rule": "Descripción de la regla", "constraints": ["Limitaciones"]}
        ],
        "settings": [
          {"name": "Nombre del lugar", "description": "Descripción sensorial", "atmosphere": "Atmósfera"}
        ],
        "themes": ["Tema filosófico/moral 1", "Tema 2"],
        "location_map": {
          "primary_locations": [
            {"name": "Madrid", "type": "ciudad", "key_places": ["Hotel X", "Comisaría Central"]},
            {"name": "Barcelona", "type": "ciudad", "key_places": ["Puerto", "Barrio Gótico"]}
          ],
          "travel_times": [
            {"from": "Madrid", "to": "Barcelona", "by_car": "6 horas", "by_plane": "1.5 horas", "by_train": "2.5 horas"},
            {"from": "Centro Madrid", "to": "Aeropuerto Barajas", "by_car": "40 minutos"}
          ]
        }
      },
      "plot_threads": [ 
        { "name": "Nombre del hilo narrativo", "description": "Qué impulsa este hilo", "goal": "Resolución esperada" }
      ],
      ${chapters > 20 ? `"timeline_master": {
        "story_duration": "X días/semanas/meses",
        "start_date": "Día 1 (o fecha concreta si aplica)",
        "key_events": [
          {"date": "Día 1", "event": "Evento clave", "chapter": 1}
        ],
        "key_temporal_constraints": ["Restricción temporal importante"]
      },` : `"timeline_master": {
        "story_duration": "X días/semanas/meses",
        "start_date": "Día 1 (o fecha concreta si aplica)",
        "chapter_timeline": [
          {"chapter": 1, "day": "Día 1", "time_of_day": "mañana", "duration": "4 horas", "location": "Madrid"},
          {"chapter": 2, "day": "Día 1", "time_of_day": "tarde-noche", "duration": "6 horas", "location": "Madrid"},
          {"chapter": 3, "day": "Día 2", "time_of_day": "mañana", "duration": "3 horas", "location": "En ruta a Barcelona"}
        ],
        "key_events": [
          {"date": "Día 1", "event": "Asesinato de Víctima X", "chapter": 1, "consequences": "Inicia la investigación"},
          {"date": "Día 3", "event": "Protagonista descubre pista clave", "chapter": 5},
          {"date": "Día 5", "event": "Confrontación con sospechoso", "chapter": 8, "consequences": "Protagonista resulta herido"},
          {"date": "Día 7", "event": "Revelación del verdadero culpable", "chapter": 12}
        ],
        "key_temporal_constraints": [
          "Entre Cap 5 y Cap 6: personaje se recupera de herida (mínimo 3 días)",
          "Cap 10: debe coincidir con evento lunar/festivo/fecha límite"
        ]
      },`}
      ${chapters <= 20 ? `"character_tracking": [
        {
          "character": "Protagonista",
          "chapter_states": [
            {"chapter": 1, "location": "Madrid, hotel", "physical_state": "Sano", "emotional_state": "Determinado", "key_possessions": ["Pistola", "Móvil", "500€"]},
            {"chapter": 5, "location": "Barcelona, hospital", "physical_state": "Herida en hombro izquierdo", "emotional_state": "Frustrado", "key_possessions": ["Pistola confiscada", "Móvil destruido"]}
          ]
        }
      ],` : ''}
      "outline": [
        ${chapters > 20 ? `{ 
          "chapter_num": 1, 
          "title": "Título evocador", 
          "act": 1,
          "summary": "Sinopsis concisa de 1 línea", 
          "key_event": "Evento principal del capítulo",
          "structural_role": "inciting_incident | act1_turn | midpoint | act2_crisis | climax | resolution | null"
        }` : `{ 
          "chapter_num": 1, 
          "title": "Título evocador del capítulo", 
          "act": 1,
          "summary": "Sinopsis de 2-3 líneas de lo que ocurre", 
          "key_event": "El evento principal que define el capítulo",
          "structural_role": "inciting_incident | act1_turn | midpoint | act2_crisis | climax | resolution | null",
          "emotional_arc": "De qué emoción a qué emoción viaja el lector",
          "temporal_notes": "Día X, mañana/tarde/noche, X horas después del capítulo anterior",
          "location": "Ciudad/lugar principal donde transcurre",
          "character_states_entering": "Estado relevante de personajes al empezar (heridas, ubicación previa)"
        }`}
      ],
      "three_act_structure": {
        "act1": { "chapters": [1, 2, 3], "goal": "Establecer mundo y conflicto" },
        "act2": { "chapters": [4, 5, 6, 7, 8], "goal": "Complicar y escalar" },
        "act3": { "chapters": [9, 10, 11, 12], "goal": "Climax y resolución" }
      }
    }

    ${chapters > 20 ? `
    RECORDATORIO FINAL: Tu outline DEBE tener EXACTAMENTE ${chapters} entradas (chapter_num 1 a ${chapters}).
    Sé CONCISO en cada entrada. Prioriza COMPLETAR TODOS LOS CAPÍTULOS sobre el detalle.
    ` : ''}
    ╔══════════════════════════════════════════════════════════════════╗
    ║ STRUCTURAL_ROLE - OBLIGATORIO para puntos clave               ║
    ╠══════════════════════════════════════════════════════════════════╣
    ║ Cada capítulo DEBE tener "structural_role" con UNO de estos   ║
    ║ valores o null si no es un punto estructural clave:            ║
    ║                                                                ║
    ║ "inciting_incident" - El detonante que lanza la trama (~10%)  ║
    ║ "act1_turn"  - Giro del Acto 1: el punto de no retorno (~25%)║
    ║ "midpoint"   - Punto medio: revelación/crisis central (~50%) ║
    ║ "act2_crisis"- Crisis del Acto 2: todo se derrumba (~75%)    ║
    ║ "climax"     - Clímax: confrontación definitiva (~85-90%)    ║
    ║ "resolution" - Resolución: desenlace y cierre (~95-100%)     ║
    ║                                                                ║
    ║ REGLAS:                                                        ║
    ║ - act1_turn, midpoint y act2_crisis son OBLIGATORIOS           ║
    ║ - Cada valor puede usarse SOLO UNA VEZ                         ║
    ║ - Los demás capítulos deben tener structural_role: null        ║
    ╚══════════════════════════════════════════════════════════════════╝

    Piensa paso a paso en la estructura de 3 actos antes de generar el JSON.
    Asegúrate de que cada capítulo tenga un propósito claro y avance la trama.
  `,

  // 2. CHAPTER ARCHITECT (R1) - Divide capítulo en escenas
  CHAPTER_ARCHITECT: (
    chapterOutline: { chapter_num: number; title: string; summary: string; key_event: string; emotional_arc?: string },
    worldBible: any,
    previousChapterSummary: string,
    storyState: string
  ) => {
    // Extract all World Bible information for scene planning
    const deadCharacters = extractDeadCharacters(worldBible);
    const worldRules = extractWorldRules(worldBible);
    const establishedObjects = extractEstablishedObjects(worldBible);
    const watchpoints = extractWatchpoints(worldBible);
    const centralThemes = extractCentralThemes(worldBible);
    const timelineConstraints = extractTimelineConstraints(worldBible);
    const premise = extractPremise(worldBible);
    
    // Extract all characters with their key info
    const characters = worldBible?.characters || worldBible?.personajes || [];
    const characterSummaries = characters.slice(0, 15).map((c: any) => {
      const name = c.name || c.nombre || '';
      const role = c.role || c.rol || '';
      const status = c.status || c.estado || 'vivo';
      const injuries = c.injuries || c.lesiones || [];
      const injuryStr = Array.isArray(injuries) && injuries.length > 0 ? ` [HERIDAS: ${injuries.slice(0, 2).join(', ')}]` : '';
      return `${name}${role ? ` (${role})` : ''}${status.toLowerCase().includes('muert') ? ' ☠️MUERTO' : ''}${injuryStr}`;
    }).join(', ');
    
    // Extract locations
    const locations = worldBible?.locations || worldBible?.lugares || [];
    const locationNames = locations.slice(0, 10).map((l: any) => l.name || l.nombre || '').filter(Boolean).join(', ');
    
    // Build World Bible context section
    let worldBibleContext = '';
    if (deadCharacters || worldRules || establishedObjects || watchpoints || centralThemes || timelineConstraints) {
      worldBibleContext = `
    ╔══════════════════════════════════════════════════════════════════╗
    ║ 📖 CONTEXTO DEL WORLD BIBLE - RESPETAR EN LA PLANIFICACIÓN      ║
    ╚══════════════════════════════════════════════════════════════════╝
${premise ? `    PREMISA: ${premise}\n` : ''}${timelineConstraints ? `${timelineConstraints}\n` : ''}${deadCharacters ? `    ☠️ PERSONAJES MUERTOS (NO incluir en escenas): ${deadCharacters}\n` : ''}${worldRules ? `    REGLAS DEL MUNDO:\n${worldRules}\n` : ''}${establishedObjects ? `    OBJETOS ESTABLECIDOS:\n${establishedObjects}\n` : ''}${centralThemes ? `    TEMAS CENTRALES: ${centralThemes}\n` : ''}${watchpoints ? `    PUNTOS DE CONTINUIDAD:\n${watchpoints}\n` : ''}`;
    }
    
    return `
    Eres el Director de Escena, especialista en desglosar capítulos en escenas cinematográficas.
    
    CAPÍTULO ${chapterOutline.chapter_num}: "${chapterOutline.title}"
    RESUMEN DEL CAPÍTULO: ${chapterOutline.summary}
    EVENTO CLAVE: ${chapterOutline.key_event}
    ARCO EMOCIONAL: ${chapterOutline.emotional_arc || 'No especificado'}
    
    CONTEXTO ANTERIOR: ${previousChapterSummary || 'Inicio de la novela'}
    ESTADO ACTUAL DE LA HISTORIA: ${storyState}
${worldBibleContext}
    PERSONAJES DISPONIBLES: ${characterSummaries || 'No especificados'}
    UBICACIONES DISPONIBLES: ${locationNames || 'No especificadas'}

    ╔══════════════════════════════════════════════════════════════════╗
    ║ ⚠️ ADHERENCIA ESTRICTA AL PLAN ORIGINAL (v2.9.10)               ║
    ╠══════════════════════════════════════════════════════════════════╣
    ║ Las escenas que planifiques DEBEN cubrir EXACTAMENTE:           ║
    ║ 1. El RESUMEN del capítulo → cada punto debe tener una escena  ║
    ║ 2. El EVENTO CLAVE → DEBE ocurrir en una de las escenas       ║
    ║ 3. El ARCO EMOCIONAL → debe reflejarse en los emotional_beats ║
    ║                                                                 ║
    ║ PROHIBIDO:                                                      ║
    ║ - Inventar eventos que NO están en el resumen                  ║
    ║ - Omitir el evento clave planificado                           ║
    ║ - Cambiar el orden de eventos del resumen                      ║
    ║ - Añadir subtramas no mencionadas en el plan                   ║
    ║ - Sustituir el evento clave por otro diferente                 ║
    ║                                                                 ║
    ║ Tu trabajo es DESCOMPONER el plan en escenas, NO reinventarlo. ║
    ╚══════════════════════════════════════════════════════════════════╝

    OBJETIVO: Desglosar este capítulo en 3-4 escenas escribibles que:
    - Cubran TODOS los puntos del RESUMEN planificado
    - Incluyan el EVENTO CLAVE como momento central
    - Mantengan el ritmo narrativo
    - Generen tensión y emoción
    - Terminen con hooks que impulsen a continuar

    ╔══════════════════════════════════════════════════════════════════╗
    ║ REGLAS ANTI-CLICHÉ (OBLIGATORIAS)                               ║
    ╠══════════════════════════════════════════════════════════════════╣
    ║ 1. PROTAGONISTA ACTIVO: El protagonista DEBE obtener            ║
    ║    información por mérito propio (investigación, deducción,     ║
    ║    interrogatorios). PROHIBIDO: mensajes anónimos, llamadas     ║
    ║    misteriosas o informantes que "aparecen" con pistas.         ║
    ║                                                                  ║
    ║ 2. VARIEDAD ESTRUCTURAL: Cada escena debe tener estructura      ║
    ║    diferente. PROHIBIDO repetir patrones como:                  ║
    ║    - Conducir → Clima → Mensaje → Llegar tarde                  ║
    ║    - Personaje reflexiona → Recibe llamada → Sale corriendo     ║
    ║    Varía: acción directa, diálogo tenso, descubrimiento,        ║
    ║    confrontación, infiltración, análisis de pruebas.            ║
    ║                                                                  ║
    ║ 3. ANTAGONISTAS INTELIGENTES: Los villanos NO explican sus      ║
    ║    planes. Actúan, no monologan. Si hay enfrentamiento verbal,  ║
    ║    el antagonista provoca/amenaza, pero NUNCA revela su         ║
    ║    estrategia completa al héroe.                                ║
    ║                                                                  ║
    ║ 4. CREDIBILIDAD NARRATIVA (VERIFICAR EN CADA ESCENA):          ║
    ║    - ¿El protagonista tiene las habilidades para esta acción?   ║
    ║    - ¿Los recursos usados tienen origen explicado?              ║
    ║    - ¿Hay más de 1 coincidencia afortunada? → ELIMINAR          ║
    ║    - ¿El personaje sabe cosas que no debería saber?             ║
    ║    - ¿Las heridas/consecuencias anteriores se respetan?         ║
    ╚══════════════════════════════════════════════════════════════════╝

    ╔══════════════════════════════════════════════════════════════════╗
    ║ COHERENCIA TEMPORAL, GEOGRÁFICA Y FÍSICA (OBLIGATORIA)          ║
    ╠══════════════════════════════════════════════════════════════════╣
    ║                                                                  ║
    ║ 🕐 TIEMPO - En cada escena especifica:                          ║
    ║    - Cuánto tiempo ha pasado desde la escena anterior           ║
    ║    - Hora aproximada del día (amanecer, mediodía, noche)        ║
    ║    - Viajes: tiempo REALISTA (Madrid-Barcelona: 6h coche)       ║
    ║    - Recuperación: heridas graves → días/semanas, NO horas      ║
    ║                                                                  ║
    ║ 📍 GEOGRAFÍA - Ubicación coherente:                             ║
    ║    - Ubicación específica de cada escena                        ║
    ║    - Transiciones lógicas entre lugares                         ║
    ║    - Si cambia de ciudad/país: indicar medio de transporte      ║
    ║    - PROHIBIDO: personaje en sótano mirando por ventana         ║
    ║                                                                  ║
    ║ 🏥 ESTADO FÍSICO - Rastrear lesiones activas:                   ║
    ║    - Si hay heridas previas, listarlas en el plan de escena     ║
    ║    - Pierna rota → no correr, necesita apoyo                    ║
    ║    - Brazo herido → no cargar peso con ese brazo                ║
    ║    - Costillas rotas → dolor al respirar, no puede pelear       ║
    ║    - Pérdida de sangre → debilidad, palidez, fatiga             ║
    ║    - En emotional_beat: incluir mención al dolor/limitación     ║
    ╚══════════════════════════════════════════════════════════════════╝

    SALIDA REQUERIDA (JSON):
    {
      "scenes": [
        {
          "scene_num": 1,
          "characters": ["Personaje1", "Personaje2"],
          "setting": "Lugar + hora del día + tiempo desde escena anterior",
          "plot_beat": "Acción específica que ocurre (qué pasa)",
          "emotional_beat": "Cambio interno + limitaciones físicas si aplica",
          "sensory_details": ["Vista", "Sonido", "Olor relevante"],
          "dialogue_focus": "Tema principal de los diálogos si los hay",
          "ending_hook": "Cómo termina la escena para impulsar la siguiente",
          "physical_constraints": "Lesiones activas de personajes presentes (opcional)",
          "word_target": 350
        }
      ],
      "chapter_hook": "Cómo debe terminar el capítulo para obligar a leer el siguiente",
      "total_word_target": 1400
    }

    REGLAS:
    - Cada escena debe tener 300-400 palabras objetivo
    - La primera escena conecta con el capítulo anterior
    - La última escena tiene el hook más fuerte
    - Varía los tipos de escenas: acción, diálogo, reflexión, tensión
  `;
  },

  // 3. GHOSTWRITER (V3) - Escribe escena por escena
  GHOSTWRITER_SCENE: (
    scenePlan: {
      scene_num: number;
      characters: string[];
      setting: string;
      plot_beat: string;
      emotional_beat: string;
      sensory_details?: string[];
      dialogue_focus?: string;
      ending_hook: string;
      word_target?: number;
    },
    prevSceneContext: string,
    rollingSummary: string,
    worldBible: any,
    guiaEstilo: string
  ) => {
    // Extract all World Bible information relevant to this scene
    const characterAttributes = extractCharacterAttributesForScene(scenePlan.characters, worldBible);
    const characterRelationships = extractCharacterRelationshipsForScene(scenePlan.characters, worldBible);
    const locationInfo = extractLocationForScene(scenePlan.setting, worldBible);
    const worldRules = extractWorldRules(worldBible);
    const prohibitedVocab = extractProhibitedVocabulary(worldBible);
    const deadCharacters = extractDeadCharacters(worldBible);
    const activeInjuries = extractActiveInjuries(scenePlan.characters, worldBible);
    const establishedObjects = extractEstablishedObjects(worldBible);
    const watchpoints = extractWatchpoints(worldBible);
    // New extractions
    const centralThemes = extractCentralThemes(worldBible);
    const literaryMotifs = extractLiteraryMotifs(worldBible);
    const sensoryPalette = extractSensoryPalette(worldBible);
    const characterVoices = extractCharacterVoices(scenePlan.characters, worldBible);
    const characterArcs = extractCharacterArcs(scenePlan.characters, worldBible);
    const premise = extractPremise(worldBible);
    const timelineConstraints = extractTimelineConstraints(worldBible);
    
    // LitAgents 2.9.8: Extract FULL indices for complete context awareness
    const fullCharacterIndex = extractFullCharacterIndex(worldBible);
    const fullLocationIndex = extractFullLocationIndex(worldBible);
    const fullObjectIndex = extractFullObjectIndex(worldBible);
    
    // Build the World Bible injection section
    let worldBibleSection = '';
    
    const hasAnyInfo = characterAttributes || characterRelationships || locationInfo || 
                       worldRules || deadCharacters || activeInjuries || establishedObjects || watchpoints ||
                       centralThemes || literaryMotifs || sensoryPalette || characterVoices || characterArcs ||
                       premise || timelineConstraints || fullCharacterIndex || fullLocationIndex || fullObjectIndex;
    
    if (hasAnyInfo) {
      worldBibleSection = `
    ╔══════════════════════════════════════════════════════════════════╗
    ║ 📖 INFORMACIÓN CANÓNICA DEL WORLD BIBLE - OBLIGATORIO RESPETAR  ║
    ╚══════════════════════════════════════════════════════════════════╝
${premise ? `
    ▓▓▓ PREMISA DE LA NOVELA ▓▓▓
    ${premise}
` : ''}${timelineConstraints ? `
    ▓▓▓ CONTEXTO TEMPORAL ▓▓▓
${timelineConstraints}
` : ''}${characterAttributes ? `
    ▓▓▓ ATRIBUTOS FÍSICOS (NO INVENTAR OTROS) ▓▓▓
${characterAttributes}
` : ''}${characterRelationships ? `
    ▓▓▓ RELACIONES ENTRE PERSONAJES ▓▓▓
${characterRelationships}
` : ''}${characterVoices ? `
    ▓▓▓ VOZ Y FORMA DE HABLAR ▓▓▓
${characterVoices}
` : ''}${characterArcs ? `
    ▓▓▓ ARCOS DE PERSONAJE ▓▓▓
${characterArcs}
` : ''}${activeInjuries ? `
    ▓▓▓ LESIONES ACTIVAS (LIMITAN ACCIONES) ▓▓▓
${activeInjuries}
    → Personajes heridos NO pueden realizar acciones que requieran la parte lesionada.
` : ''}${deadCharacters ? `
    ▓▓▓ ☠️ PERSONAJES MUERTOS (NO PUEDEN APARECER VIVOS) ▓▓▓
    ${deadCharacters}
    → PROHIBIDO: resucitar, mencionar como vivos, o hacer que actúen.
` : ''}${locationInfo ? `
    ▓▓▓ UBICACIÓN CANÓNICA ▓▓▓
${locationInfo}
` : ''}${establishedObjects ? `
    ▓▓▓ OBJETOS ESTABLECIDOS (Chekhov's Gun) ▓▓▓
${establishedObjects}
    → Solo puedes usar objetos ya mencionados. NO inventes objetos nuevos convenientes.
` : ''}${worldRules ? `
    ▓▓▓ REGLAS DEL MUNDO ▓▓▓
${worldRules}
` : ''}${centralThemes ? `
    ▓▓▓ TEMAS CENTRALES ▓▓▓
    ${centralThemes}
` : ''}${literaryMotifs ? `
    ▓▓▓ MOTIVOS LITERARIOS RECURRENTES ▓▓▓
    ${literaryMotifs}
` : ''}${sensoryPalette ? `
    ▓▓▓ PALETA SENSORIAL GLOBAL ▓▓▓
${sensoryPalette}
` : ''}${watchpoints ? `
    ▓▓▓ PUNTOS CRÍTICOS DE CONTINUIDAD ▓▓▓
${watchpoints}
` : ''}
    ┌──────────────────────────────────────────────────────────────────┐
    │ 📋 ÍNDICE COMPLETO DEL WORLD BIBLE (v2.9.8)                      │
    │ Referencia de TODOS los elementos canónicos de la novela        │
    └──────────────────────────────────────────────────────────────────┘
${fullCharacterIndex ? `
    ▸ TODOS LOS PERSONAJES:
${fullCharacterIndex}
` : ''}${fullLocationIndex ? `
    ▸ TODAS LAS UBICACIONES:
${fullLocationIndex}
` : ''}${fullObjectIndex ? `
    ▸ TODOS LOS OBJETOS SIGNIFICATIVOS:
${fullObjectIndex}
` : ''}
    ⚠️ USA esta información EXACTAMENTE. NO inventes detalles que contradigan lo anterior.
    ⚠️ CONSULTA el índice completo antes de mencionar cualquier personaje, lugar u objeto.

    ┌──────────────────────────────────────────────────────────────────┐
    │ 🔒 VERIFICACIÓN OBLIGATORIA DE PERSONAJES SECUNDARIOS (v2.9.9+) │
    └──────────────────────────────────────────────────────────────────┘
    Antes de escribir CUALQUIER personaje que no sea el protagonista:
    1. BUSCA su nombre EXACTO en el índice de personajes arriba
    2. VERIFICA sus atributos físicos (ojos, cabello, edad) - NO inventes otros
    3. CONFIRMA su relación establecida con otros personajes
    4. USA su voz característica si está definida
    
    ERRORES COMUNES A EVITAR:
    ❌ Cambiar "María" por "Mari" o "Mariela" sin autorización
    ❌ Describir ojos azules cuando la Biblia dice marrones
    ❌ Inventar parentesco o relaciones no establecidas
    ❌ Dar habilidades que no están en el backstory del personaje

    ┌──────────────────────────────────────────────────────────────────┐
    │ ⏰ VERIFICACIÓN CRONOLÓGICA OBLIGATORIA (v2.9.9+)               │
    └──────────────────────────────────────────────────────────────────┘
    La cronología temporal es SAGRADA e INMUTABLE:
    1. CONSULTA el contexto temporal arriba antes de usar fechas
    2. Las referencias temporales ("hace X días", "ayer") DEBEN cuadrar
    3. Si un evento ocurrió el "día 5", no puede mencionarse el "día 3"
    4. Los flashbacks deben ubicarse correctamente en la línea temporal
    
    ERRORES COMUNES A EVITAR:
    ❌ "Hace una semana" cuando solo han pasado 2 días en la trama
    ❌ Personajes recordando eventos que aún no han ocurrido
    ❌ Confundir el orden de eventos entre capítulos
    ❌ Anacronismos tecnológicos (smartphones en época sin ellos)

`;
    }
    
    return `
    Eres un Novelista Fantasma de élite. Estás escribiendo UNA ESCENA de una novela mayor.
${worldBibleSection}
    ═══════════════════════════════════════════════════════════════════
    CONTEXTO MEMORIA (Lo que pasó antes en la novela):
    ═══════════════════════════════════════════════════════════════════
    ${rollingSummary}

    ═══════════════════════════════════════════════════════════════════
    CONTEXTO INMEDIATO (Últimas líneas escritas - mantén este flujo):
    ═══════════════════════════════════════════════════════════════════
    "${prevSceneContext}"

    ═══════════════════════════════════════════════════════════════════
    PLAN DE ESTA ESCENA (Escena ${scenePlan.scene_num}):
    ═══════════════════════════════════════════════════════════════════
    LUGAR: ${scenePlan.setting}
    PERSONAJES: ${scenePlan.characters.join(', ')}
    ACCIÓN: ${scenePlan.plot_beat}
    EMOCIÓN: ${scenePlan.emotional_beat}
    ${scenePlan.sensory_details ? `DETALLES SENSORIALES: ${scenePlan.sensory_details.join(', ')}` : ''}
    ${scenePlan.dialogue_focus ? `FOCO DE DIÁLOGO: ${scenePlan.dialogue_focus}` : ''}
    CIERRE: ${scenePlan.ending_hook}
    PALABRAS OBJETIVO: ${scenePlan.word_target || 350}

    ═══════════════════════════════════════════════════════════════════
    GUÍA DE ESTILO DEL AUTOR - ADHESIÓN OBLIGATORIA:
    ═══════════════════════════════════════════════════════════════════
    ${guiaEstilo}
    
    INSTRUCCIONES DE ADHESIÓN (INVIOLABLES):
    1. Tu VOZ NARRATIVA debe imitar fielmente el estilo descrito arriba: ritmo de frases, nivel de formalidad, densidad descriptiva, uso de metáforas.
    2. RESPETA las PROHIBICIONES LÉXICAS del autor: si hay palabras o expresiones vetadas, NO las uses bajo ninguna circunstancia.
    3. ADOPTA las TÉCNICAS NARRATIVAS preferidas: si el autor prefiere diálogos concisos, escribe diálogos concisos.
    4. MANTÉN la CADENCIA del autor: replica su patrón de frases cortas/largas.
    5. Si la guía describe un TONO específico (irónico, lírico, seco, poético, crudo), ese tono DEBE impregnar cada párrafo.
    6. NUNCA impongas tu propio estilo sobre el del autor. Eres un GHOSTWRITER: tu voz desaparece, la del autor prevalece.

    ═══════════════════════════════════════════════════════════════════
    INSTRUCCIONES CRÍTICAS:
    ═══════════════════════════════════════════════════════════════════
    1. Escribe ${scenePlan.word_target || 350}-${(scenePlan.word_target || 350) + 100} palabras.
    2. "Show, don't tell" - Usa prosa sensorial, muestra emociones con el cuerpo.
    3. Si es continuación, NO repitas explicaciones. Sigue la acción fluidamente.
    4. NO termines el capítulo, solo termina la escena según el plan.
    5. Usa guion largo (—) para diálogos en español.
    6. PROHIBIDO: usar clichés de IA como "crucial", "fascinante", "torbellino de emociones".
${prohibitedVocab ? `    7. VOCABULARIO PROHIBIDO (NO USAR): ${prohibitedVocab}` : ''}
    
    ┌──────────────────────────────────────────────────────────────────┐
    │ 🔗 TRANSICIONES ENTRE CAPÍTULOS (v2.9.9)                         │
    └──────────────────────────────────────────────────────────────────┘
    Si el "CONTEXTO INMEDIATO" muestra el FINAL DEL CAPÍTULO ANTERIOR:
    - Tu apertura DEBE conectar naturalmente con ese cierre
    - Si hay cambio de ubicación/tiempo: ORIENTA al lector sutilmente
    - Usa técnicas de transición: paso del tiempo, reflexión breve, 
      descripción sensorial del nuevo entorno, acción continua
    - NO saltes bruscamente a una nueva escena sin conexión
    - Evita clichés: "Mientras tanto", "Al día siguiente", "En otro lugar"

    ╔══════════════════════════════════════════════════════════════════╗
    ║ ERRORES FATALES - TOLERANCIA CERO (REESCRITURA AUTOMÁTICA)      ║
    ╠══════════════════════════════════════════════════════════════════╣
    ║                                                                  ║
    ║ ❌ DEUS EX MACHINA DIGITAL:                                     ║
    ║    - Mensajes anónimos/encriptados con pistas                   ║
    ║    - Llamadas de números ocultos con información clave          ║
    ║    - Informantes que "aparecen" justo cuando se necesitan       ║
    ║    - Correos electrónicos misteriosos con coordenadas/fotos     ║
    ║    → El protagonista DEBE descubrir por MÉRITO PROPIO:          ║
    ║      interrogando, investigando, deduciendo, infiltrándose.     ║
    ║                                                                  ║
    ║ ❌ VILLANO EXPLICATIVO:                                         ║
    ║    - Antagonista que monologa sus planes al héroe               ║
    ║    - "Déjame explicarte por qué hago esto..."                   ║
    ║    - Villano que revela debilidades de su plan                  ║
    ║    → Los antagonistas ACTÚAN, no explican. Son competentes      ║
    ║      y representan amenaza real. Si hablan, AMENAZAN/PROVOCAN.  ║
    ║                                                                  ║
    ║ ❌ REPETICIÓN DE PATRONES:                                      ║
    ║    - Misma secuencia: conducir → clima → mensaje → llegar       ║
    ║    - Abuso de descripciones atmosféricas (lluvia, frío)         ║
    ║    - Protagonista siempre reactivo (espera, recibe, va)         ║
    ║    → VARÍA la estructura: acción directa, confrontación,        ║
    ║      análisis forense, diálogo de esgrima, infiltración.        ║
    ║                                                                  ║
    ║ ❌ MULETILLAS FÍSICAS EXCESIVAS:                                ║
    ║    - Repetir el mismo gesto (tocarse anillo, cicatriz, etc.)    ║
    ║    - Más de 2 veces por capítulo = ERROR                        ║
    ║    → USA gestos variados según la emoción del momento.          ║
    ║                                                                  ║
    ║ ❌ FALTA DE CREDIBILIDAD (VERIFICAR SIEMPRE):                   ║
    ║    - Habilidades no justificadas: Si el protagonista hackea,    ║
    ║      pelea, habla idiomas → debe tener formación previa.        ║
    ║    - Recursos sin origen: Dinero, armas, vehículos, contactos   ║
    ║      → deben tener explicación lógica.                          ║
    ║    - Coincidencias excesivas: Máximo 1 coincidencia afortunada  ║
    ║      por novela. El resto debe ser GANADO por el protagonista.  ║
    ║    - Conocimiento imposible: El personaje NO puede saber cosas  ║
    ║      que no ha investigado/descubierto.                         ║
    ║    - Falta de consecuencias: Heridas, delitos, enemigos deben   ║
    ║      tener repercusiones en capítulos posteriores.              ║
    ║    → PREGÚNTATE: ¿Un lector atento lo creería?                  ║
    ╚══════════════════════════════════════════════════════════════════╝
    
    ╔══════════════════════════════════════════════════════════════════╗
    ║ 🔗 TRANSICIONES Y CHEKHOV'S GUN (LitAgents 2.5)                 ║
    ╠══════════════════════════════════════════════════════════════════╣
    ║                                                                  ║
    ║ TRANSICIONES SUAVES (NUNCA saltos bruscos):                     ║
    ║    - Si cambia la ubicación: describe brevemente el tránsito    ║
    ║      ("Veinte minutos después, el taxi lo dejó en...")          ║
    ║    - Si cambia el tiempo: indica el paso del tiempo             ║
    ║      ("Al día siguiente...", "Cuando el reloj marcó las...")    ║
    ║    - Si cambia la perspectiva: transición gradual, no corte     ║
    ║    - PROHIBIDO: saltar de un lugar a otro sin conectar          ║
    ║    → La última frase de cada escena debe ANTICIPAR el cambio    ║
    ║                                                                  ║
    ║ CHEKHOV'S GUN (Todo objeto usado debe estar establecido):       ║
    ║    - Si un personaje usa un objeto (arma, herramienta, etc.)    ║
    ║      → debe haberse mencionado antes en la narrativa            ║
    ║    - PROHIBIDO: objetos que "aparecen" convenientemente         ║
    ║      ("sacó un frasco de..." sin haberlo establecido antes)     ║
    ║    - Si es improvisado: describe explícitamente la búsqueda     ║
    ║      ("Buscó algo que sirviera. Encontró un trozo de...")       ║
    ║    → ANTES de usar cualquier objeto: ¿ya se mencionó?           ║
    ╚══════════════════════════════════════════════════════════════════╝
    
    ╔══════════════════════════════════════════════════════════════════╗
    ║ 🕐📍🏥 COHERENCIA TEMPORAL, GEOGRÁFICA Y FÍSICA                  ║
    ╠══════════════════════════════════════════════════════════════════╣
    ║                                                                  ║
    ║ TIEMPO - Verifica ANTES de escribir:                            ║
    ║    - ¿Cuánto tiempo real pasó desde la escena anterior?         ║
    ║    - Si el personaje viaja: tiempo REALISTA                     ║
    ║      (Madrid-Barcelona: 6h coche, 2.5h tren alta velocidad)     ║
    ║    - Si hubo herida grave: recuperación = días/semanas          ║
    ║    - Mantén coherencia día/noche                                ║
    ║                                                                  ║
    ║ GEOGRAFÍA - No "teletransportes":                               ║
    ║    - Si cambia de ubicación: mencionar el traslado              ║
    ║    - Coherencia espacial: no subir escaleras si está en ático   ║
    ║    - No mirar por ventana si está en sótano o habitación interior║
    ║    - Direcciones consistentes (izquierda/derecha)               ║
    ║                                                                  ║
    ║ ESTADO FÍSICO - Lesiones activas LIMITAN acciones:              ║
    ║    - Pierna rota/herida: cojea, no corre, necesita apoyo        ║
    ║    - Brazo herido: dolor al moverlo, no carga peso              ║
    ║    - Costillas rotas: respira con dificultad, muecas de dolor   ║
    ║    - Conmoción: mareos, visión borrosa, confusión               ║
    ║    - Pérdida de sangre: debilidad, palidez, fatiga              ║
    ║    - Quemaduras: piel tirante, dolor al moverse                 ║
    ║    -> Al describir acciones, INCLUIR limitaciones si hay lesion  ║
    ║    -> Ejemplo: "Se apoyo en la pared para avanzar, la pierna    ║
    ║      herida palpitando con cada paso."                          ║
    +------------------------------------------------------------------+
    
    +------------------------------------------------------------------+
    | HUMANIZACION DEL LENGUAJE - ANTI-REPETICION SEMANTICA            |
    +------------------------------------------------------------------+
    |                                                                  |
    | EVITAR REPETICIONES:                                             |
    |    - NO repetir la misma palabra en la misma oracion             |
    |    - NO usar sinonimos obvios en oraciones consecutivas          |
    |      (dijo/exclamo/murmuro en 3 lineas seguidas)                 |
    |    - NO abusar de estructuras: "Sujeto + verbo + complemento"    |
    |    - VARIAR longitud de oraciones: cortas + largas               |
    |    - EVITAR inicio repetitivo de parrafos (El, La, Un, Una...)   |
    |                                                                  |
    | EXPRESIONES PROHIBIDAS (cliches de IA):                          |
    |    - "un torbellino de emociones"                                |
    |    - "el peso de [algo] sobre sus hombros"                       |
    |    - "el silencio era ensordecedor"                              |
    |    - "una mezcla de [emocion] y [emocion]"                       |
    |    - "sin previo aviso"                                          |
    |    - "en cuestion de segundos"                                   |
    |    - "como si el tiempo se hubiera detenido"                     |
    |    - "un escalofrio recorrio su espalda"                         |
    |    - "el corazon le latia con fuerza"                            |
    |    - "sus ojos se encontraron"                                   |
    |    - "trago saliva"                                              |
    |    - "contuvo la respiracion"                                    |
    |    - "no podia creer lo que estaba viendo"                       |
    |    - "algo dentro de el/ella"                                    |
    |    - "en lo mas profundo de su ser"                              |
    |    -> USA descripciones originales y especificas                 |
    |                                                                  |
    | HUMANIZACION - ESCRIBE COMO UN HUMANO:                           |
    |    - Imperfecciones controladas: pensamientos incompletos        |
    |    - Ritmo natural: pausas, dudas, interrupciones                |
    |    - Sensorialidad concreta: olores, texturas, sonidos ESPECIFICOS|
    |    - Comparaciones frescas, no manidas                           |
    |    - Dialogo que suena a conversacion real, no a libreto         |
    |    - Variacion en verbos de dialogo: dijo, pero tambien silencio,|
    |      pausa, gesto, sin verbo (solo accion + dialogo)             |
    |                                                                  |
    | ANTI-MONOTONIA:                                                  |
    |    - Alterna descripcion + accion + dialogo + reflexion          |
    |    - Evita bloques largos de un solo tipo                        |
    |    - Usa fragmentos cuando la tension lo requiera                |
    |    - "Disparo. Silencio. Luego, el grito."                       |
    +------------------------------------------------------------------+
    
    SALIDA: Solo el texto de la narrativa. Sin comentarios, sin marcadores.
  `;
  },

  // 4. SMART EDITOR (V3) - Evalúa y genera parches
  SMART_EDITOR: (chapterContent: string, sceneBreakdown: any, worldBible: any, chapterOutline?: { chapter_num: number; title: string; summary: string; key_event: string; emotional_arc?: string }) => `
    Eres un Editor Senior de novelas con 20 años de experiencia.
    
    TEXTO A EVALUAR:
    ═══════════════════════════════════════════════════════════════════
    ${chapterContent}
    ═══════════════════════════════════════════════════════════════════

    PLAN DE ESCENAS DEL CAPÍTULO:
    ${JSON.stringify(sceneBreakdown, null, 2)}
${chapterOutline ? `
    ╔══════════════════════════════════════════════════════════════════╗
    ║ 📋 PLAN ORIGINAL DEL GLOBAL ARCHITECT (ADHERENCIA OBLIGATORIA)  ║
    ╠══════════════════════════════════════════════════════════════════╣
    ║ CAPÍTULO ${chapterOutline.chapter_num}: "${chapterOutline.title}"
    ║ RESUMEN PLANIFICADO: ${chapterOutline.summary}
    ║ EVENTO CLAVE: ${chapterOutline.key_event}
    ${chapterOutline.emotional_arc ? `║ ARCO EMOCIONAL: ${chapterOutline.emotional_arc}` : ''}
    ╠══════════════════════════════════════════════════════════════════╣
    ║ VERIFICACIÓN DE ADHERENCIA (CRÍTICA):                          ║
    ║ Compara el texto escrito contra este plan original.             ║
    ║ Si el capítulo NO cubre el RESUMEN o el EVENTO CLAVE:          ║
    ║   → LÓGICA = 4 máximo (desviación del plan = error grave)      ║
    ║ Si el capítulo inventa eventos NO planificados:                ║
    ║   → LÓGICA = 5 máximo                                         ║
    ║ Si el evento clave está ausente o sustituido:                  ║
    ║   → LÓGICA = 3 máximo (fallo crítico de adherencia)            ║
    ╚══════════════════════════════════════════════════════════════════╝
` : ''}
    PERSONAJES CANÓNICOS (verificar continuidad):
    ${JSON.stringify((worldBible.characters || worldBible.personajes || []).map((c: any) => ({ name: c.name || c.nombre, appearance: c.appearance || c.descripcion })))}

    CRITERIOS DE EVALUACIÓN (Doble 10):
    1. LÓGICA (1-10): ¿Tiene sentido la trama? ¿Hay errores de continuidad? ¿Los personajes actúan coherentemente?
    2. ESTILO (1-10): ¿Es buena la prosa? ¿Ritmo adecuado? ¿Evita clichés? ¿Muestra en vez de contar?

    ╔══════════════════════════════════════════════════════════════════╗
    ║ ERRORES FATALES - DETECTAR Y PENALIZAR (SCORE < 5 AUTOMÁTICO)   ║
    ╠══════════════════════════════════════════════════════════════════╣
    ║                                                                  ║
    ║ ❌ DEUS EX MACHINA DIGITAL: Si el protagonista recibe           ║
    ║    información de forma pasiva (mensaje anónimo, llamada        ║
    ║    misteriosa, informante oportuno) → LÓGICA = 4 máximo.        ║
    ║                                                                  ║
    ║ ❌ VILLANO EXPLICATIVO: Si un antagonista explica su plan       ║
    ║    o motivaciones al héroe en lugar de actuar                   ║
    ║    → ESTILO = 4 máximo.                                         ║
    ║                                                                  ║
    ║ ❌ PATRÓN REPETITIVO: Si la estructura es idéntica a            ║
    ║    capítulos anteriores (conducir→clima→mensaje→llegar)         ║
    ║    → ESTILO = 5 máximo.                                         ║
    ║                                                                  ║
    ║ ❌ MULETILLA FÍSICA: Si un gesto/descripción se repite          ║
    ║    más de 2 veces en el capítulo → ESTILO - 2 puntos.           ║
    ║                                                                  ║
    ║ ❌ FALTA DE CREDIBILIDAD:                                       ║
    ║    - Habilidad no justificada (protagonista hace algo sin       ║
    ║      formación previa) → LÓGICA = 5 máximo.                     ║
    ║    - Recurso sin origen (dinero, arma, contacto mágico)         ║
    ║      → LÓGICA = 5 máximo.                                       ║
    ║    - Coincidencia conveniente (2ª o más en la novela)           ║
    ║      → LÓGICA - 2 puntos.                                       ║
    ║    - Conocimiento imposible (sabe sin haber investigado)        ║
    ║      → LÓGICA = 4 máximo.                                       ║
    ║    - Herida/consecuencia ignorada → LÓGICA = 5 máximo.          ║
    ║                                                                  ║
    ║ ❌ INCOHERENCIA TEMPORAL/GEOGRÁFICA/FÍSICA:                     ║
    ║    - Viaje imposible (distancia vs tiempo)                      ║
    ║      → LÓGICA = 4 máximo.                                       ║
    ║    - "Teletransportación" sin explicación                       ║
    ║      → LÓGICA = 5 máximo.                                       ║
    ║    - Personaje en sótano mirando por ventana                    ║
    ║      → LÓGICA = 5 máximo.                                       ║
    ║    - Acción imposible con lesión activa (correr con pierna      ║
    ║      rota, pelear con costillas rotas sin mención de dolor)     ║
    ║      → LÓGICA = 4 máximo.                                       ║
    ║    - Recuperación milagrosa (herida grave → activo en horas)    ║
    ║      → LÓGICA = 5 máximo.                                       ║
    ╚══════════════════════════════════════════════════════════════════╝
    
    ╔══════════════════════════════════════════════════════════════════╗
    ║ 🔗 TRANSICIONES, CONOCIMIENTO Y CHEKHOV'S GUN (LitAgents 2.9)  ║
    ╠══════════════════════════════════════════════════════════════════╣
    ║                                                                  ║
    ║ ❌ TRANSICIÓN ESPACIAL CONFUSA (PENALIZACIÓN SEVERA):           ║
    ║    - Personaje cambia de ubicación sin explicar cómo llegó      ║
    ║      (estaba en A, ahora está en B sin transición)              ║
    ║      → LÓGICA = 6 máximo.                                       ║
    ║    - "Puerta que lleva a lugar incongruente" (sótano→terraza)   ║
    ║      → LÓGICA = 5 máximo.                                       ║
    ║    → FEEDBACK: especificar la transición confusa exacta.        ║
    ║                                                                  ║
    ║ ❌ TRANSICIÓN TEMPORAL CONFUSA (PENALIZACIÓN SEVERA):           ║
    ║    - Salto de tiempo sin indicador (mañana→noche sin contexto)  ║
    ║      → ESTILO = 6 máximo.                                       ║
    ║    - Capítulo termina de noche, siguiente empieza de día sin    ║
    ║      indicar paso del tiempo                                    ║
    ║      → LÓGICA = 6 máximo.                                       ║
    ║    → FEEDBACK: identificar el salto temporal no señalado.       ║
    ║                                                                  ║
    ║ ❌ CONOCIMIENTO INTERNO INCORRECTO (CRÍTICO):                   ║
    ║    - Personaje "reconoce" algo/alguien que nunca ha visto       ║
    ║      (ej: "reconoció los ojos del cuadro" sin haber visto al    ║
    ║       dueño de esos ojos antes)                                 ║
    ║      → LÓGICA = 4 máximo.                                       ║
    ║    - Personaje sabe información que no ha obtenido en escena    ║
    ║      (ej: sabe el nombre de alguien sin que se lo dijeran)      ║
    ║      → LÓGICA = 5 máximo.                                       ║
    ║    - Personaje deduce correctamente sin pistas suficientes      ║
    ║      → LÓGICA = 6 máximo.                                       ║
    ║    → FEEDBACK: explicar qué sabe y por qué no debería saberlo.  ║
    ║                                                                  ║
    ║ ❌ INCONSISTENCIA DE EDAD/TIEMPO NARRATIVO:                     ║
    ║    - Edad del personaje no coincide con lo establecido          ║
    ║      (tenía 10 años en prólogo, ahora tiene 25 sin time skip)   ║
    ║      → LÓGICA = 4 máximo.                                       ║
    ║    - Eventos que no cuadran con línea temporal                  ║
    ║      → LÓGICA = 5 máximo.                                       ║
    ║    → FEEDBACK: indicar la inconsistencia de edad/tiempo.        ║
    ║                                                                  ║
    ║ ❌ OBJETO SIN ORIGEN (Chekhov's Gun inverso):                   ║
    ║    - Personaje usa objeto no mencionado anteriormente           ║
    ║      (frasco, herramienta, arma que "aparece" de la nada)       ║
    ║      → LÓGICA = 6 máximo.                                       ║
    ║    → FEEDBACK: identificar el objeto y sugerir establecerlo.    ║
    ║                                                                  ║
    ║ ❌ ATRIBUTO FÍSICO INCONSISTENTE:                               ║
    ║    - Joya/anillo/cicatriz presente/ausente sin explicación      ║
    ║      (llevaba anillo, ahora no lo tiene sin mencionarlo)        ║
    ║      → LÓGICA = 6 máximo.                                       ║
    ║    - Color de ojos/pelo cambia sin justificación                ║
    ║      → LÓGICA = 5 máximo.                                       ║
    ║    → FEEDBACK: especificar el atributo inconsistente.           ║
    ║                                                                  ║
    ║ ❌ REPETICIÓN DE PALABRAS TÉCNICAS:                             ║
    ║    - Misma palabra técnica/específica 3+ veces en 2 párrafos    ║
    ║      → ESTILO - 1 punto.                                        ║
    ║    → FEEDBACK: identificar la palabra y sugerir sinónimos.      ║
    ╚══════════════════════════════════════════════════════════════════╝

    REGLAS DE APROBACIÓN:
    - Score > 8 en AMBOS criterios: APROBADO (is_approved: true)
    - Score 5-8 en algún criterio: GENERAR PARCHES para corrección
    - Score < 5 en algún criterio: REESCRITURA NECESARIA (is_approved: false, needs_rewrite: true)

    SI GENERAS PARCHES:
    - Cada parche debe tener texto EXACTO a buscar (mínimo 20 caracteres para unicidad)
    - El reemplazo debe ser mejora puntual, NO reescritura completa
    - Genera TODOS los parches necesarios para corregir los problemas detectados

    SALIDA JSON OBLIGATORIA:
    {
      "logic_score": 1-10,
      "style_score": 1-10,
      "is_approved": boolean,
      "needs_rewrite": boolean,
      "feedback": "Resumen de la evaluación",
      "strengths": ["Punto fuerte 1", "Punto fuerte 2"],
      "weaknesses": ["Debilidad 1", "Debilidad 2"],
      "patches": [
        {
          "original_text_snippet": "Texto exacto a buscar (mínimo 20 chars, único en el documento)",
          "replacement_text": "Texto corregido",
          "reason": "Gramática / Continuidad / Estilo / Cliché"
        }
      ]
    }
  `,

  // 5. SUMMARIZER (V3) - Comprime capítulo para memoria
  SUMMARIZER: (chapterContent: string, chapterNumber: number) => `
    Eres un especialista en compresión narrativa. Tu trabajo es crear resúmenes ÚTILES para mantener la continuidad.

    CAPÍTULO ${chapterNumber} A RESUMIR:
    ═══════════════════════════════════════════════════════════════════
    ${chapterContent}
    ═══════════════════════════════════════════════════════════════════

    CREA UN RESUMEN DE MÁXIMO 200 PALABRAS que capture:
    
    OBLIGATORIO (Información crítica para continuidad):
    1. HECHOS: ¿Qué PASÓ concretamente? (acciones, descubrimientos, decisiones)
    2. CAMBIOS DE ESTADO: ¿Alguien murió, se hirió, cambió de bando, desapareció?
    3. OBJETOS: ¿Se obtuvo/perdió algo importante?
    4. RELACIONES: ¿Cambió alguna relación entre personajes?
    5. UBICACIÓN: ¿Dónde terminaron los personajes principales?
    6. REVELACIONES: ¿Qué información nueva se reveló?

    IGNORAR (No incluir):
    - Prosa poética o descripciones atmosféricas
    - Diálogos decorativos sin información nueva
    - Reflexiones internas sin consecuencias
    
    FORMATO DE SALIDA:
    Texto plano directo, sin bullets ni formato. Escribe como un párrafo denso de información.
  `,

  // 6. NARRATIVE DIRECTOR (R1) - Cada 5 capítulos revisa rumbo
  NARRATIVE_DIRECTOR: (
    recentSummaries: string, 
    plotThreads: Array<{ name: string; status: string; goal: string; lastUpdatedChapter: number }>,
    currentChapter: number,
    totalChapters: number
  ) => `
    Eres el Showrunner de esta novela. Tu trabajo es asegurar que la historia mantiene su rumbo y momentum.

    ═══════════════════════════════════════════════════════════════════
    PROGRESO: Capítulo ${currentChapter} de ${totalChapters} (${Math.round(currentChapter/totalChapters*100)}% completado)
    ═══════════════════════════════════════════════════════════════════

    HILOS NARRATIVOS ACTIVOS:
    ${plotThreads.map(t => `- ${t.name} [${t.status}]: ${t.goal} (último update: cap ${t.lastUpdatedChapter})`).join('\n')}

    RESÚMENES DE LOS ÚLTIMOS 5 CAPÍTULOS:
    ═══════════════════════════════════════════════════════════════════
    ${recentSummaries}
    ═══════════════════════════════════════════════════════════════════

    ANALIZA Y RESPONDE:

    1. RITMO: ¿La historia avanza adecuadamente o se ha estancado?
    2. HILOS OLVIDADOS: ¿Hay hilos narrativos que no se han tocado en demasiado tiempo?
    3. TENSIÓN: ¿El nivel de tensión es apropiado para este punto de la novela?
    4. COHERENCIA: ¿Los personajes actúan de forma consistente con su perfil?

    SALIDA JSON:
    {
      "pacing_assessment": "Análisis del ritmo (1-2 oraciones)",
      "forgotten_threads": ["Lista de hilos que necesitan atención"],
      "tension_level": 1-10,
      "tension_recommendation": "¿Subir, mantener o dar respiro?",
      "character_consistency_issues": ["Problemas de coherencia si los hay"],
      "directive": "Directiva de corrección para los próximos 5 capítulos (ej: 'Aumentar ritmo, resolver subtrama romántica, preparar revelación del cap 15')",
      "thread_updates": [
        { "name": "Nombre del hilo", "new_status": "active/resolved/ignored", "note": "Razón del cambio" }
      ]
    }

    Sé específico y accionable en tu directiva. El Ghostwriter usará esto como guía.
  `
};
