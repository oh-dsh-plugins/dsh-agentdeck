import { getDshRuntimeVersion } from '@deepseek-ai/dsh-app-boot';
import type { HostContext, RuntimeAgent, RunRecord } from './types.js';
import { record, type NativeEvent, type SessionQueries, type StartupLookup } from './contracts.js';

interface AgentDirectory { list(): RuntimeAgent[]; get(id: string): RuntimeAgent | undefined; roots?(): RuntimeAgent[] }
interface SubagentQueries { rootOf?(actor: RuntimeAgent): RuntimeAgent; resolveName?(actor: RuntimeAgent, name: string, signal: AbortSignal): Promise<string>; getProvider(name: string): unknown }
interface Observation { projections?: { values?: { subagentCatalog?: unknown } }; [Symbol.dispose](): void }
interface NativeQuery { observeSession(id: string, options: { signal?: AbortSignal }): Promise<Observation>; readSession(id: string, options?: { signal?: AbortSignal }): Promise<{ events: unknown; session: unknown }> }

/** Accept only the two published receipt contracts. Ambiguity never triggers dispatch. */
export async function activationSession(value: unknown, actor: RuntimeAgent, signal: AbortSignal,
  runtime: Pick<SubagentQueries, 'resolveName'>): Promise<string> {
  if (!record(value) || value.kind !== 'activation') throw new Error('Native delegation did not return a recognized activation receipt; reconcile without repeating dispatch.');
  if (typeof value.subagentId === 'string' && value.subagentId.trim() && value.name === undefined) return value.subagentId;
  if (typeof value.name === 'string' && value.name.trim() && value.subagentId === undefined && typeof runtime.resolveName === 'function') {
    const id = await runtime.resolveName(actor, value.name, signal);
    if (typeof id === 'string' && id.trim()) return id;
  }
  throw new Error('Native activation identity is unknown or ambiguous; reconcile the accepted child without repeating dispatch.');
}

/** Read-only native projections stay here; no private runtime helpers or synthetic Agents. */
export class NativeSessionQueries implements SessionQueries {
  private readonly registry: AgentDirectory;
  private readonly subagents: SubagentQueries;
  private get query(): NativeQuery { return this.ctx.get('sessionQuery') as NativeQuery; }
  private readonly rootMode: 'tree' | 'registry' | 'unavailable';
  constructor(private readonly ctx: HostContext, private readonly version = getDshRuntimeVersion()) {
    this.registry = ctx.get('agents') as AgentDirectory;
    this.subagents = ctx.get('subagents') as SubagentQueries;
    this.rootMode = typeof this.subagents?.rootOf === 'function' ? 'tree' : typeof this.registry?.roots === 'function' ? 'registry' : 'unavailable';
  }
  agent(id: string): RuntimeAgent | undefined { return this.registry?.get(id); }
  status(id: string): string | undefined { return this.agent(id)?.status; }
  roots(): RuntimeAgent[] {
    if (this.rootMode === 'tree') return this.registry.list().filter(agent => this.subagents.rootOf!(agent) === agent);
    if (this.rootMode === 'registry') return this.registry.roots!();
    throw new Error('Native root Session discovery is unavailable; no unverified registry entries are exposed.');
  }
  diagnostics() {
    return { compatibilityVersion: this.version, minimumVersion: '0.2.2-rc.1', rootDiscovery: this.rootMode,
      activationReceipt: typeof this.subagents?.resolveName === 'function' ? 'name' : 'id', nativeProvider: !!this.subagents?.getProvider('spawn'), storage: true };
  }
  async events(id: string, signal?: AbortSignal): Promise<readonly NativeEvent[]> {
    signal?.throwIfAborted();
    const snapshot = await this.query.readSession(id, { signal });
    signal?.throwIfAborted();
    if (!Array.isArray(snapshot.events) || !snapshot.events.every(event => record(event) && typeof event.type === 'string' && record(event.data))) throw new Error('Native Session events have an unsupported structure.');
    return snapshot.events as NativeEvent[];
  }
  async startup(run: RunRecord, presetId?: string, signal?: AbortSignal): Promise<StartupLookup> {
    signal?.throwIfAborted();
    using observation = await this.query.observeSession(run.parentId, { signal });
    const catalog = observation.projections?.values?.subagentCatalog;
    if (!Array.isArray(catalog) || !catalog.every(entry => record(entry) && typeof entry.id === 'string' && typeof entry.mode === 'string' && (entry.label === undefined || typeof entry.label === 'string'))) {
      return { kind: 'unknown', message: 'Native direct-child catalog projection is unavailable or unsupported; startup remains uncertain and will not be repeated.' };
    }
    const candidates = catalog.filter(entry => entry.mode === 'continuable' && entry.label?.startsWith('AgentDeck ' + run.id + ': '));
    if (!candidates.length) return { kind: 'missing' };
    if (candidates.length !== 1) return { kind: 'ambiguous', message: 'Startup ' + run.id + ' has multiple native catalog matches; inspect them without restarting the task.' };
    if (!presetId) return { kind: 'unknown', message: 'Startup ' + run.id + ' is missing its role snapshot.' };
    const child = await this.query.readSession(candidates[0].id, { signal });
    signal?.throwIfAborted();
    if (!record(child.session) || child.session.parentSession !== run.parentId || child.session.agentPreset !== presetId) {
      return { kind: 'mismatch', message: 'Startup ' + run.id + " does not match the child's native parent/preset metadata." };
    }
    return { kind: 'matched', childId: candidates[0].id };
  }
}
