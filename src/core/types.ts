export interface LocalizedText { en: string; zh: string }

export interface ModelCandidate {
  id: string;
  purpose: string;
  provider: string;
  model: string;
  reasoning: { mode: 'model-default' | 'fixed'; effort?: string };
  maxTokens: number;
}

export interface AgentDefinition {
  schemaVersion: 1 | 2;
  id: string;
  title: LocalizedText;
  description: LocalizedText;
  instructions: string;
  capabilities: string[];
  skills: string[];
  scripts: string[];
  inputs: string[];
  deliverables: string[];
  model: { mode: 'inherit' | 'fixed' | 'auto'; provider?: string; model?: string; candidates?: ModelCandidate[]; defaultCandidate?: string };
  reasoning: { mode: 'inherit-compatible' | 'model-default' | 'fixed'; effort?: string };
  output?: { maxTokens: number };
  context: { targetTokens: number; elasticTokens: number };
  enabled: boolean;
  extends?: string;
}

export interface SkillDefinition { id: string; description: string; body: string }
export interface AgentDiagnostic { id?: string; source?: string; message: string }
export interface CatalogResult { agents: AgentDefinition[]; diagnostics: AgentDiagnostic[] }

export interface ContextBudgetInput {
  windowTokens?: number;
  outputTokens?: number;
  fixedTokens?: number;
  targetTokens: number;
  elasticTokens: number;
}
export interface ContextBudget {
  known: boolean;
  targetTokens: number;
  elasticTokens: number;
  safeInputTokens?: number;
  headroomTokens: number;
  materialTokens?: number;
  diagnostics: string[];
}
