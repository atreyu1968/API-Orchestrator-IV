// LitAgents 2.0 - Agent Exports

export { GlobalArchitectAgent, type GlobalArchitectInput, type GlobalArchitectOutput } from './global-architect';
export { ChapterArchitectAgent, type ChapterArchitectInput, type ChapterArchitectOutput, type ScenePlan } from './chapter-architect';
export { GhostwriterV2Agent, type GhostwriterV2Input } from './ghostwriter-v2';
export { SmartEditorAgent, type SmartEditorInput, type SmartEditorOutput } from './smart-editor';
export { SummarizerAgent, type SummarizerInput } from './summarizer';
export { NarrativeDirectorAgent, type NarrativeDirectorInput, type NarrativeDirectorOutput, type PlotThread, type ThreadUpdate } from './narrative-director';

// Re-export prompts
export { PROMPTS_V2, AGENT_MODELS_V2 } from '../agent-prompts-v2';
