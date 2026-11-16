// Opt-in proof against the existing verified BrowserSkill connection. Opens only its own Agent Window.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import SkillRegistry from '@deepseek-ai/dsh-skill';
import TokenMeter from '@deepseek-ai/dsh-token-meter';
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local';
import { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm';
import { createNativeHarness, ROUTE, bounded } from './probe-native.mjs';
import { bindRoleAgent } from '../lib/role.js';
import { browserReadiness } from '../lib/host/browser-runtime.js';

const base = process.env.AGENTDECK_BROWSER_MODULE_BASE;
assert.ok(base, 'Set AGENTDECK_BROWSER_MODULE_BASE to the installed BrowserSkill public package root.');
const require = createRequire(resolve(base, 'package.json'));
const native = createRequire(import.meta.resolve('@deepseek-ai/dsh-tools/package.json'));
const Browser = await import(pathToFileURL(require.resolve('@wxg-prc-cpg/browser-skill-dsh-plugin')).href);
const NativeSkill = await import(pathToFileURL(native.resolve('@deepseek-ai/dsh-tool-skill')).href);
const h = await createNativeHarness();
let handle, stopRole, count = 0, session;
try {
  for (const plugin of [SkillRegistry, TokenMeter, LocalSubprocess, NativeSkill]) await h.ctx.plugin(plugin);
  const config = { bskPath: process.env.AGENTDECK_BSK_PATH ?? 'bsk', sessionStateDirectory: join(h.storageRoot, 'browser-sessions'), observationEnabled: false, lazyTools: true, maxSessions: 1 };
  const browserFiber = await h.ctx.plugin(Object.assign((ctx, value) => Browser.apply(ctx, value), { inject: ['tools'] }), config);
  await h.ctx.plugin(ctx => { ctx.provide('configEditor', { entries: () => [{ options: { name: '@wxg-prc-cpg/browser-skill-dsh-plugin' }, fiber: browserFiber }] }); });
  const readiness = await browserReadiness(h.ctx, new AbortController().signal);
  assert.equal(readiness.state, 'ready', readiness.reason);
  handle = await h.ctx.agents.create({ sessionId: 'agentdeck-live-browser-proof', meta: { cwd: h.storageRoot }, agentOptions: ROUTE, setup: async (ctx, agent) => {
    stopRole = await bindRoleAgent(ctx, agent, { id: 'live-browser-proof', presetId: 'live-browser-proof', policyVersion: 1, createdAt: 1, model: ROUTE,
      role: { schemaVersion: 1, id: 'ui-verifier', title: { en: 'Live browser proof', zh: '浏览器实测' }, description: { en: 'Inspect this task-owned DSH page', zh: '检查本任务页面' }, instructions: 'Read the existing DSH page only. Do not edit settings, user data or another window.', capabilities: ['browser-observe', 'browser-interact'], skills: [], scripts: [], inputs: [], deliverables: [], model: { mode: 'inherit' }, reasoning: { mode: 'model-default' }, context: { targetTokens: 14000, elasticTokens: 32000 }, enabled: true },
      skills: [], budget: { known: false, targetTokens: 14000, elasticTokens: 32000, headroomTokens: 0, diagnostics: [] } });
  } });
  async function call(name, args) {
    const batch = await h.ctx.tools.execute({ agent: handle.agent, signal: AbortSignal.timeout(30000), calls: [{ type: 'tool-call', id: ToolCallId('live-browser-' + ++count), name, arguments: JSON.stringify(args) }] });
    return batch.results[0].result;
  }
  const denied = await call('bsk_session', { action: 'stop', session: 'not-owned-by-this-child' });
  assert.equal(denied.isError, true);
  const started = await call('bsk_session', { action: 'start', url: 'http://127.0.0.1:3080/', noFocus: true });
  assert.equal(started.isError, false, JSON.stringify(started));
  session = started.value.sessionId;
  assert.equal(typeof session, 'string');
  const read = await call('bsk_inspect', { action: 'read', session, selector: 'title', readFields: JSON.stringify([{ key: 'title', read: 'text' }]), maxNodes: 1 });
  assert.equal(read.isError, false, JSON.stringify(read));
  assert.match(JSON.stringify(read.value), /DeepSeek Harness/);
  handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Finish the local browser proof and close only your own Agent Window.' }], source: { kind: 'user' } }));
  await bounded(handle.agent.whenIdle(), 'live browser turn and cleanup', 30000);
  await stopRole(); stopRole = undefined;
  console.log(JSON.stringify({ readiness: readiness.state, ownSession: session, pageTitle: 'DeepSeek Harness', foreignSessionDenied: true, localModelRequests: h.adapter.requests.length, paidModelRequests: 0, cleanup: 'native turn completed and scoped cleanup joined' }));
} finally {
  try { await stopRole?.(); await handle?.dispose(); } finally { await h.close(); }
}
