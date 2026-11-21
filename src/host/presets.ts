import { fileURLToPath } from 'node:url';
import type {} from '@deepseek-ai/dsh-agent-preset-registry';
import type { HostContext, RoleSnapshot } from './types.js';

import { usesBasicCompaction } from './capabilities.js';

export class SnapshotPresets {
  private readonly registered = new Map<string, Promise<() => Promise<void>>>();
  constructor(private readonly ctx: HostContext) {}
  async register(snapshot: RoleSnapshot): Promise<void> {
    if (snapshot.policyVersion !== 1 && snapshot.policyVersion !== 2) throw new Error(`Unsupported AgentDeck snapshot policy ${snapshot.policyVersion}`);
    let registration = this.registered.get(snapshot.presetId);
    if (!registration) {
      const legacy = snapshot.policyVersion === 1;
      if (legacy && !snapshot.budget) throw new Error('Historical snapshot is missing its context policy.');
      const basicCompaction = usesBasicCompaction(snapshot.policyVersion, !!this.ctx.get('compaction'));
      if (basicCompaction && !this.ctx.get('tokenMeter')) throw new Error('AgentDeck basic compaction requires the native tokenMeter service.');
      const ratio = legacy && snapshot.model.contextWindow ? Math.min(0.8, snapshot.budget!.targetTokens / snapshot.model.contextWindow) : 0.8;
      const retained = legacy ? Math.max(128, Math.min(4096, Math.floor(snapshot.budget!.elasticTokens / 4))) : undefined;
      const canWrite = snapshot.role.capabilities.some(capability => capability === 'source-edit' || capability === 'artifact-write');
      const definition = {
        id: snapshot.presetId,
        name: `${snapshot.role.title.zh} / ${snapshot.role.title.en} · AgentDeck`,
        description: `${snapshot.role.description.zh} / ${snapshot.role.description.en}`,
        order: 1000,
        plugins: [
          ...(snapshot.composition === 'native-minimal' ? [] : [
            { id: 'agentdeck-files', name: '@deepseek-ai/dsh-tool-fs', config: { read: true, readImage: true, write: canWrite, edit: canWrite, applyPatch: false } },
            { id: 'agentdeck-search', name: '@deepseek-ai/dsh-tool-fs-search', config: { sampleOverCapGlobResults: false } },
          ]),
          ...(snapshot.webTools ? [{ id: 'agentdeck-web', name: '@deepseek-ai/dsh-tool-web', config: { fetch: true, search: true, fetchMaxOutputChars: 40_000, searchMaxResults: 6 } }] : []),
          ...(snapshot.role.capabilities.some(value => value.startsWith('browser-')) ? [{ id: 'agentdeck-browser-skill-loader', name: '@deepseek-ai/dsh-tool-skill' }] : []),
          { id: 'agentdeck-native-executor', name: '@deepseek-ai/dsh-tool-executor-native' },
          // A parent's isolated preset is a sibling, so only Host-wide recovery can be reused.
          ...(basicCompaction ? [{ id: 'agentdeck-compaction', name: 'cordis:group', group: true, isolate: { compaction: true as const }, config: [
            { id: 'agentdeck-compaction-basic', name: '@deepseek-ai/dsh-compaction-basic', config: legacy ? {
              thresholdRatio: Math.max(0.01, ratio), retainTokens: retained,
              headroomTokens: snapshot.budget!.headroomTokens,
              maxTokens: Math.max(1, Math.min(8192, snapshot.model.maxTokens ?? 8192)),
              maxOverflowRetries: 1, compactionRetries: 1,
            } : {} },
          ] }] : []),
          { id: 'agentdeck-role-policy', name: fileURLToPath(new URL('../role.js', import.meta.url)), config: { snapshot } },
        ],
      };
      registration = this.ctx.agentPresets.register(definition);
      this.registered.set(snapshot.presetId, registration!);
      registration!.catch(() => this.registered.delete(snapshot.presetId));
    }
    await registration;
  }
  async verify(presetId: string): Promise<void> {
    // resolve audits the settled Host tree; never call it inside plugin activation.
    const preset = await this.ctx.agentPresets.resolve(presetId);
    if (preset.broken) throw new Error(`AgentDeck preset ${presetId} is unavailable: ${preset.broken}`);
  }
  private readonly audits = new Map<string, Promise<string | undefined>>();
  async audit(presetIds: string[], signal: AbortSignal): Promise<string[]> {
    signal.throwIfAborted();
    const results = new Map<string, string | undefined>();
    const pending = [...new Set(presetIds)].map(id => {
      let check = this.audits.get(id);
      if (!check) {
        check = this.verify(id).then(() => undefined, error => `${id}: ${error instanceof Error ? error.message : String(error)}`);
        this.audits.set(id, check);
        void check.finally(() => { if (this.audits.get(id) === check) this.audits.delete(id); });
      }
      return check.then(issue => { results.set(id, issue); });
    });
    // Native resolve has no cancellation argument and may join unrelated Loader
    // work. Keep diagnostics advisory; starts still perform strict verification.
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: (() => void) | undefined;
    try {
      await Promise.race([
        Promise.all(pending),
        new Promise<void>(resolve => { timer = setTimeout(resolve, 200); }),
        new Promise<never>((_, reject) => { abort = () => reject(signal.reason); signal.addEventListener('abort', abort, { once: true }); }),
      ]);
      signal.throwIfAborted();
      return [...new Set(presetIds)].flatMap(id => results.has(id) ? (results.get(id) ? [results.get(id)!] : []) : [`${id}: Native preset diagnostics are still loading; refresh to check again. New tasks are verified before dispatch.`]);
    } finally {
      clearTimeout(timer);
      if (abort) signal.removeEventListener('abort', abort);
    }
  }
  async dispose(): Promise<void> {
    const results = await Promise.allSettled([...this.registered.values()]);
    await Promise.all(results.filter((result): result is PromiseFulfilledResult<() => Promise<void>> => result.status === 'fulfilled').map(result => result.value()));
    this.registered.clear();
  }
}
