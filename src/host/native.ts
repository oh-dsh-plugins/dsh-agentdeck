import { createScope } from '@deepseek-ai/dsh-scope';
import * as nativeSubagent from '@deepseek-ai/dsh-tool-subagent';
import { ToolExecutionPipeline } from '@deepseek-ai/dsh-tools/pipeline';
import type { ToolRunContext } from '@deepseek-ai/dsh-tools';
import type { HostContext, RoleSnapshot, RuntimeAgent } from './types.js';
import type { TaskCommands } from './contracts.js';
import { activationSession } from './sessions.js';

export class NativeDelegationFailure extends Error {
  readonly code: string;
  constructor(message: string, readonly noChildAccepted: boolean, code?: string) {
    super(message); this.name = 'NativeDelegationFailure'; this.code = code ?? 'AGENTDECK_NATIVE_FAILED';
  }
}

/** Each fixed capability is private; source lookup never changes the real caller. */
export class NativeDelegator implements TaskCommands {
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
    if (!outer.agent) throw new NativeDelegationFailure('Native delegation requires a real calling Agent.', true);
    const { pipeline, prepared } = await (async () => {
      outer.signal.throwIfAborted();
      const entry = await this.entry(presetId, snapshot?.policyVersion === 1 ? snapshot.model.maxTokens : undefined);
      if (!this.ctx.tools.executable(entry.name, entry.key)) throw new NativeDelegationFailure('Native spawn provider is unavailable; no child was started.', true, 'AGENTDECK_PROVIDER_UNAVAILABLE');
      const pipeline = new ToolExecutionPipeline(this.ctx, {
        get: name => name === entry.name && !this.closed ? this.ctx.tools.executable(entry.name, entry.key) : undefined,
      });
      const prepared = await pipeline.prepare({
        callId: `${outer.callId}:agentdeck-native` as any,
        rootCallId: outer.rootCallId, parent: outer.token,
        name: entry.name, arguments: args, agent: outer.agent, signal: outer.signal,
      });
      return { pipeline, prepared };
    })().catch(error => {
      if (error instanceof NativeDelegationFailure) throw error;
      throw new NativeDelegationFailure(error instanceof Error ? error.message : String(error), true);
    });
    const beforeDispatch = prepared.kind !== 'dispatch';
    const dispatched = prepared.kind === 'dispatch' ? await pipeline.dispatch(prepared.exec) : prepared;
    // Native capacity is reserved before activation. Trust the typed tool-body
    // refusal, not text or an error emitted by the post-execute pipeline.
    const error = !beforeDispatch && dispatched.kind === 'post-result' && dispatched.result.isError
      ? dispatched.result.error : undefined;
    const refusal = error?.info?.name === 'SubagentError' && error.info.code === 'ACTIVATION_LIMIT_REACHED'
      ? new NativeDelegationFailure(error.message, true, error.info.code) : undefined;
    const result = await pipeline.complete(prepared.exec, dispatched).catch(error => {
      if (!beforeDispatch && !refusal) throw error;
      throw new NativeDelegationFailure(error instanceof Error ? error.message : String(error), true);
    });
    for (const context of result.additionalContexts ?? []) outer.deferContext(context);
    if (result.isError) {
      throw new NativeDelegationFailure(result.error.message, beforeDispatch || refusal !== undefined, result.error.info?.code);
    }
    if (refusal) throw refusal;
    if (result.concludesTurn) outer.concludeTurn();
    try { return await activationSession(result.value, outer.agent, outer.signal, this.ctx.subagents); }
    catch (error) { throw new NativeDelegationFailure(`Native child was accepted but its Session identity could not be resolved: ${error instanceof Error ? error.message : String(error)}. Reconcile the existing startup; do not repeat it.`, false); }
  }
  async send(actor: RuntimeAgent, childId: string, text: string, signal: AbortSignal): Promise<string> {
    signal.throwIfAborted();
    return this.ctx.subagents.sendMessage(actor, childId as Parameters<HostContext['subagents']['sendMessage']>[1], [{ type: 'text', text }], { signal });
  }
  interrupt(actor: RuntimeAgent, childId: string): void {
    this.ctx.subagents.interrupt(childId as Parameters<HostContext['subagents']['interrupt']>[0], { kind: 'ancestor', agent: actor });
  }
  async dispose(): Promise<void> {
    this.closed = true;
    const entries = await Promise.allSettled([...this.entries.values()]);
    await Promise.all(entries.filter((entry): entry is PromiseFulfilledResult<any> => entry.status === 'fulfilled').map(entry => entry.value.dispose()));
    this.entries.clear();
  }
}
