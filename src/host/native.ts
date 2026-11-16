import { createScope } from '@deepseek-ai/dsh-scope';
import * as nativeSubagent from '@deepseek-ai/dsh-tool-subagent';
import { ToolExecutionPipeline } from '@deepseek-ai/dsh-tools/pipeline';
import type { ToolRunContext } from '@deepseek-ai/dsh-tools';
import type { HostContext, RoleSnapshot } from './types.js';

export class NativeDelegationFailure extends Error {
  readonly code: string;
  constructor(message: string, readonly beforeDispatch: boolean, code?: string) {
    super(message); this.name = 'NativeDelegationFailure'; this.code = code ?? 'AGENTDECK_NATIVE_FAILED';
  }
}

/** Each fixed capability is private; source lookup never changes the real caller. */
export class NativeDelegator {
  private readonly entries = new Map<string, Promise<{ key: object; name: string; dispose(): Promise<void> }>>();
  private closed = false;
  constructor(private readonly ctx: HostContext) {}
  private entry(presetId?: string, maxTokens?: number): Promise<{ key: object; name: string; dispose(): Promise<void> }> {
    const identity = `${presetId ?? 'native-inherited'}-${maxTokens ?? 'default'}`;
    let pending = this.entries.get(identity);
    if (pending) return pending;
    pending = (async () => {
      if (this.closed) throw new Error('AgentDeck is unloading.');
      const key = {};
      const scope = createScope(this.ctx, key);
      const name = `agentdeck_native_${identity.replace(/[^a-z0-9]/g, '_')}`;
      try {
        await scope.ctx.plugin(nativeSubagent, {
          provider: 'spawn', toolName: name, modelSelection: true, modelDiscovery: false,
          ...(presetId ? { agentPreset: presetId } : {}),
          ...(maxTokens === undefined ? {} : { agentOptions: { maxTokens } }),
        });
        return { key, name, dispose: () => scope.dispose() };
      } catch (error) { await scope.dispose(); throw error; }
    })();
    this.entries.set(identity, pending);
    pending.catch(() => { if (this.entries.get(identity) === pending) this.entries.delete(identity); });
    return pending;
  }
  async invoke(presetId: string | undefined, args: Record<string, unknown>, outer: ToolRunContext, snapshot?: RoleSnapshot): Promise<string> {
    if (!outer.agent) throw new Error('Native delegation requires a real calling Agent.');
    outer.signal.throwIfAborted();
    const entry = await this.entry(presetId, snapshot?.model.maxTokens);
    if (!this.ctx.tools.executable(entry.name, entry.key)) throw new NativeDelegationFailure('Native spawn provider is unavailable; no child was started.', true, 'AGENTDECK_PROVIDER_UNAVAILABLE');
    const pipeline = new ToolExecutionPipeline(this.ctx, {
      get: name => name === entry.name && !this.closed ? this.ctx.tools.executable(entry.name, entry.key) : undefined,
    });
    const prepared = await pipeline.prepare({
      callId: `${outer.callId}:agentdeck-native` as any,
      rootCallId: outer.rootCallId, parent: outer.token,
      name: entry.name, arguments: args, agent: outer.agent, signal: outer.signal,
    });
    const beforeDispatch = prepared.kind !== 'dispatch';
    const dispatched = prepared.kind === 'dispatch' ? await pipeline.dispatch(prepared.exec) : prepared;
    const result = await pipeline.complete(prepared.exec, dispatched);
    for (const context of result.additionalContexts ?? []) outer.deferContext(context);
    if (result.isError) throw new NativeDelegationFailure(result.error.message, beforeDispatch, result.error.info?.code);
    if (result.concludesTurn) outer.concludeTurn();
    const value = result.value as any;
    if (value?.kind !== 'activation' || typeof value.name !== 'string') throw new NativeDelegationFailure('Native delegation did not return an activation name; do not retry blindly.', false);
    try { return await this.ctx.subagents.resolveName(outer.agent, value.name, outer.signal); }
    catch (error) { throw new NativeDelegationFailure(`Native child was accepted but its Session identity could not be resolved: ${error instanceof Error ? error.message : String(error)}. Reconcile the existing startup; do not repeat it.`, false); }
  }
  async dispose(): Promise<void> {
    this.closed = true;
    const entries = await Promise.allSettled([...this.entries.values()]);
    await Promise.all(entries.filter((entry): entry is PromiseFulfilledResult<any> => entry.status === 'fulfilled').map(entry => entry.value.dispose()));
    this.entries.clear();
  }
}
