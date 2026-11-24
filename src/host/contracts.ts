import type { ToolRunContext } from '@deepseek-ai/dsh-tools';
import type { RuntimeAgent, RoleSnapshot, RunRecord, EffectiveSelection, JsonObject } from './types.js';

/** Agent handles remain opaque identities: adapters must forward the original object. */
export interface TaskCommands {
  invoke(presetId: string | undefined, args: Record<string, unknown>, outer: ToolRunContext, snapshot?: RoleSnapshot): Promise<string>;
  send(actor: RuntimeAgent, childId: string, text: string, signal: AbortSignal): Promise<string>;
  interrupt(actor: RuntimeAgent, childId: string): void;
  dispose(): Promise<void>;
}
export interface NativeEvent { type: string; seq?: number; data: Record<string, unknown> }
export type StartupLookup = { kind: 'missing' } | { kind: 'matched'; childId: string }
  | { kind: 'unknown' | 'ambiguous' | 'mismatch'; message: string };
export interface ResultQueries {
  events(sessionId: string, signal?: AbortSignal): Promise<readonly NativeEvent[]>;
  status(sessionId: string): string | undefined;
}
export interface SessionQueries extends ResultQueries {
  agent(sessionId: string): RuntimeAgent | undefined;
  roots(): RuntimeAgent[];
  startup(run: RunRecord, presetId?: string, signal?: AbortSignal): Promise<StartupLookup>;
  diagnostics(): { compatibilityVersion: string; minimumVersion: string; rootDiscovery: string; activationReceipt: string; nativeProvider: boolean; storage: boolean };
}
export type ModelRoute = { provider: string; model: string };
export type RoutePolicy = ModelRoute[] | undefined | { kind: 'unknown'; message: string; code?: string };
export interface ModelQueries {
  selection(agent?: RuntimeAgent): JsonObject | undefined;
  inheritance(agent?: RuntimeAgent): JsonObject | undefined;
  policy(agent?: RuntimeAgent, signal?: AbortSignal): Promise<RoutePolicy>;
  resolve(configured: EffectiveSelection, signal?: AbortSignal, parent?: JsonObject): Promise<EffectiveSelection>;
  info(provider: string, model: string, signal?: AbortSignal): Promise<ModelView>;
  directory(agent?: RuntimeAgent, query?: { provider: string; model?: string }, signal?: AbortSignal, optionsOnly?: boolean): Promise<JsonObject>;
}
export interface EffortView { id: string; label: string; name: string; description?: string }
export interface ModelView {
  provider: string; id: string; name: string; label: string; authorized: boolean | null; metadataResolved: true;
  efforts: EffortView[]; contextWindow?: number; defaultMaxTokens?: number; defaultEffort?: string; inputModalities?: string[];
}
export function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
