import assert from 'node:assert/strict';
import { mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Loader, { Group } from '@deepseek-ai/cordis-plugin-loader';
import AgentPresetRegistry from '@deepseek-ai/dsh-agent-preset-registry';
import SkillRegistry from '@deepseek-ai/dsh-skill';
import Storage from '@deepseek-ai/dsh-storage';
import * as StorageJson from '@deepseek-ai/dsh-storage-json';
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain';
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local';
import TokenMeter from '@deepseek-ai/dsh-token-meter';
import BasicCompaction from '@deepseek-ai/dsh-compaction-basic';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { LlmError } from '@deepseek-ai/dsh-llm';
import * as AgentDeck from '../lib/index.js';
import { textRevision } from '../lib/host/store.js';
import {
  CHILD_TEXT, ROUTE, bounded, createNativeHarness, deferred, noticeMessages,
} from '../scripts/probe-native.mjs';

let serial = 0;
export async function fixture({ holdChild = false, subprocess = true, allowNativeFallback = false, policy, web = false, parentCompaction = false, omitRecovery = false, directory, resumeSessionId, parentSessionId, plugin = AgentDeck, beforeActivation } = {}) {
  const h = await createNativeHarness({ holdChild, policy, directory, resumeSessionId, parentSessionId, beforeActivation });
  const webCalls = [];
  const webReadyCalls = [];
  let hostFiber;
  try {
    // Loader may write a resolver helper into its package scope. Keep that scope
    // task-owned while resolving the existing installed DSH dependency closure.
    const hostModules = dirname(dirname(dirname(fileURLToPath(import.meta.resolve('@deepseek-ai/dsh-tools/package.json')))));
    const loaderRoot = await mkdtemp(join(h.storageRoot, 'loader-'));
    await writeFile(join(loaderRoot, 'package.json'), JSON.stringify({ name: 'agentdeck-host-native-fixture', type: 'module', private: true }));
    await symlink(hostModules, join(loaderRoot, 'node_modules'), 'dir');
    const ctx = h.ctx.extend({ baseUrl: pathToFileURL(join(loaderRoot, 'package.json')).href });
    await bounded(ctx.plugin(Loader, { baseUrl: ctx.baseUrl }), 'Host Loader setup');
    // The real application bootstrap supplies this public Loader builtin.
    ctx.get('loader').builtins.group = Group;
    await bounded(ctx.plugin(Storage), 'native storage hub');
    await bounded(ctx.plugin(StorageJson, { root: join(h.storageRoot, 'agentdeck-data') }), 'native JSON storage');
    await bounded(ctx.plugin(StorageDomain, { backend: 'json' }), 'native storage domain');
    await bounded(ctx.plugin(SkillRegistry), 'native skills');
    if (!omitRecovery) await bounded(ctx.plugin(TokenMeter), 'native token meter');
    // Some hosts provide global recovery; Web instead isolates it in the parent preset.
    if (!omitRecovery && !parentCompaction) await bounded(h.ctx.plugin(BasicCompaction, { headroomTokens: 1024, maxTokens: 1024, retainTokens: 128, thresholdRatio: 0.5 }), 'shared native host compaction');
    if (subprocess) await bounded(ctx.plugin(LocalSubprocess), 'native subprocess');
    if (web) {
      const { default: WebRuntime } = await import('@deepseek-ai/dsh-web');
      await bounded(ctx.plugin(WebRuntime, { fetchProvider: 'fixture-local-fetch' }), 'native web service');
      ctx.get('web').registerFetchProvider({
        id: 'fixture-local-fetch',
        available: () => true,
        async ready(llmProvider) { webReadyCalls.push(llmProvider); return llmProvider === ROUTE.provider; },
        async fetch(request, signal) {
          signal?.throwIfAborted();
          webCalls.push({ request, signal });
          return { url: request.url, statusCode: 200, body: { kind: 'text', content: 'Deterministic local web evidence.' }, truncated: false };
        },
      });
    }
    await bounded(ctx.plugin(AgentPresetRegistry, { default: 'fixture-standard' }), 'native preset registry');
    const presets = ctx.get('agentPresets');
    await bounded(presets.register({ id: 'fixture-standard', name: 'Fixture parent', plugins: [
      ...(web ? [{ id: 'fixture-parent-web', name: '@deepseek-ai/dsh-tool-web', config: { search: false, fetch: true } }] : []),
      ...(parentCompaction ? [{ id: 'fixture-parent-compaction', name: 'cordis:group', group: true, isolate: { compaction: true }, config: [
        { id: 'fixture-parent-compaction-basic', name: '@deepseek-ai/dsh-compaction-basic' },
      ] }] : []),
    ] }), 'parent preset');
    if (web || parentCompaction) await bounded(presets.select(h.parent, 'fixture-standard'), 'parent scoped consumers');
    h.parent.options.maxTokens = 1536;
    const config = { customAgentDirs: [], projectConfigDirectory: '.dsh/agentdeck', allowNativeFallback };
    const mountHost = async () => {
      hostFiber = ctx.plugin(plugin, config);
      await bounded(hostFiber, 'actual AgentDeck Host plugin');
    };
    if (plugin) await mountHost();
    const call = async (name, args = {}, { id = `host-call-${++serial}`, agent = h.parent, signal = new AbortController().signal, toolSet } = {}) => {
      const batch = await bounded(ctx.tools.execute({
        calls: [{ type: 'tool-call', id, name, arguments: JSON.stringify(args) }], agent, signal,
        ...(toolSet === undefined ? {} : { toolSet }),
      }), `Host pipeline ${name}`, 15_000);
      assert.equal(batch.results.length, 1);
      return batch.results[0].result;
    };
    return {
      h, ctx, call, presets, webCalls, webReadyCalls,
      domain: () => ctx.get('storageDomain').get('dsh_agentdeck'),
      async reloadHost() { await hostFiber.dispose(); await mountHost(); },
      async close() { try { await hostFiber?.dispose(); } finally { await h.close(); } },
    };
  } catch (error) {
    try { await hostFiber?.dispose(); } finally { await h.close(); }
    throw error;
  }
}
export const text = result => result.content.filter(block => block.type === 'text').map(block => block.text).join('\n');
export function success(result) { assert.equal(result.isError, false, text(result)); return result.value; }
// Seed task-owned configuration for native behavior tests without mounting the owner RPC.
export const ownerSave = (f, id, text) => f.domain().table('overrides').put(id, { id, text, revision: textRevision(text), updatedAt: Date.now() });
export const start = (f, fields = {}, options) => f.call('scene_agent_start', {
  role: 'reader', prompt: 'Read only the authorized fixture evidence and report what was verified.', ...fields,
}, options);
