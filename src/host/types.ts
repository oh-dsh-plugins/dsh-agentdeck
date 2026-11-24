import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type {} from '@deepseek-ai/dsh-session-query';
import type {} from '@deepseek-ai/dsh-working-directory';
import type { AgentDefinition, SkillDefinition } from '../core/index.js';

/** Public Cordis dependency APIs are discovered at runtime; narrow at each owner. */
export type HostContext = Context;
export type RuntimeAgent = Agent;
export type JsonObject = Record<string, any>;

export interface EffectiveSelection { provider: string; model: string; reasoningEffort?: string; maxTokens?: number }
export interface RoutingDecision { candidateId: string; roleRevision: string; source: 'default' | 'recommended' | 'legacy-route'; reason?: string }
export interface OverrideRecord { id: string; text: string; revision: string; updatedAt: number }
export interface RoleSnapshot {
  id: string;
  presetId: string;
  role: AgentDefinition;
  skills: (SkillDefinition & { resourceBase?: unknown })[];
  composition?: 'native-minimal';
  webTools?: boolean;
  /** Historical policy1 only; new policy2 snapshots inherit native recovery. */
  budget?: { known: boolean; targetTokens: number; elasticTokens: number; safeInputTokens?: number; headroomTokens: number; diagnostics: string[] };
  model: { provider: string; model: string; reasoningEffort?: string; maxTokens?: number; contextWindow?: number };
  createdAt: number;
  policyVersion: 1 | 2;
  scriptRevisions?: Record<string, string>;
  sourceRevision?: string;
  candidateId?: string;
  /** The native workspace used to assemble this Alpha snapshot. */
  expectedWorkspace?: string;
}

export interface WorkspaceCut {
  sourceVersion: string;
  childId: string;
  parentId: string;
  presetId: string;
  snapshotId: string;
  createdAt: number;
  cwd: string;
  cursor: number;
  directoryHistory: string;
}

export interface RunRecord {
  id: string; roleId: string; revision: string; parentId: string; childId?: string;
  description: string; createdAt: number;
  phase: 'starting' | 'accepted' | 'uncertain' | 'failed'; error?: string;
  model?: { provider: string; model: string; reasoningEffort?: string };
  fallback?: { to: 'general' | 'native'; reason: string };
  decision?: RoutingDecision;
  workspaceCut?: WorkspaceCut;
}

export function object(value: unknown, label = 'request'): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as JsonObject;
}
export function requiredString(value: unknown, label: string, limit = 100_000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > limit) throw new Error(`${label} must be a non-empty string (max ${limit} characters)`);
  return value;
}
export function optionalString(value: unknown, label: string): string | undefined {
  return value === undefined ? undefined : requiredString(value, label);
}
export function messageOf(error: unknown): string { return error instanceof Error ? error.message : String(error); }
export function jsonClone<T>(value: T): T { return JSON.parse(JSON.stringify(value)); }
