import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { writeFile, chmod } from 'node:fs/promises';
import SkillRegistry from '@deepseek-ai/dsh-skill';
import TokenMeter from '@deepseek-ai/dsh-token-meter';
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { createNativeHarness, ROUTE, bounded, deferred } from '../scripts/probe-native.mjs';
import { browserReadiness, OwnedBrowserSessions } from '../lib/host/browser-runtime.js';
import { bindRoleAgent } from '../lib/role.js';

const status = { protocol_version: '1.9', local_auth: { mode: 'required', paired_devices: 1 }, browsers: [{ instance_id: 'fixture-browser', extension_protocol_version: '1.9', unresponsive: false, version_skew: false }] };
function probe(value, { exitCode = 0, lossy = false, bskPath = '/configured/bsk', entries, noEditor = false } = {}) {
  const calls = [];
  const configEditor = noEditor ? undefined : { entries: () => entries ?? [{ options: { name: '@wxg-prc-cpg/browser-skill-dsh-plugin' }, fiber: { state: 2, effectiveConfig: { bskPath } } }] };
  const subprocess = { async resolveExecutable(...args) { calls.push(args[0]); return '/fixture/bsk'; }, spawn(spec) { calls.push(spec); return { done: Promise.resolve({ exitCode }), waitForExit: async () => true, collected: { stdout: { readFrom: () => ({ text: JSON.stringify(value), lossy }) } } }; } };
  return { ctx: { get: key => key === 'subprocess' ? subprocess : key === 'configEditor' ? configEditor : undefined }, calls };
}
test('readiness checks verified compatible connections without daemon startup or sessions', async () => {
  const p = probe(status);
  assert.equal((await browserReadiness(p.ctx, new AbortController().signal)).state, 'ready');
  assert.equal(p.calls[0], '/configured/bsk', 'uses the active plugin CLI path instead of a different PATH binary');
  assert.deepEqual(p.calls[1].argv, ['/fixture/bsk', 'status', '--json']);
  assert.equal(p.calls[1].env.BSK_AUTO_START, '0');
  for (const value of [ { ...status, local_auth: { mode: 'warn', paired_devices: 0 } }, { ...status, browsers: [] }, { ...status, browsers: [{ ...status.browsers[0], unresponsive: true }] } ]) {
    assert.equal((await browserReadiness(probe(value).ctx, new AbortController().signal)).state, 'unverified');
  }
  assert.equal((await browserReadiness(probe(status, { lossy: true }).ctx, new AbortController().signal)).state, 'unverified');
  const abort = new AbortController(); abort.abort(new Error('cancel readiness'));
  await assert.rejects(browserReadiness(p.ctx, abort.signal), /cancel readiness/);
});

test('readiness does not probe another binary when active plugin configuration is unavailable or ambiguous', async () => {
  const entry = { options: { name: '@wxg-prc-cpg/browser-skill-dsh-plugin' }, fiber: { state: 2, effectiveConfig: { bskPath: '/custom/cli' } } };
  for (const options of [{ noEditor: true }, { entries: [] }, { entries: [entry, entry] }, { entries: [{ ...entry, fiber: { ...entry.fiber, state: 4 } }] }, { entries: [{ ...entry, fiber: { state: 2 } }] }]) {
    const p = probe(status, options);
    assert.equal((await browserReadiness(p.ctx, new AbortController().signal)).state, 'unverified');
    assert.deepEqual(p.calls, []);
  }
});

test('ownership accepts only successful exact-agent receipts and joins one cleanup', async () => {
  const agent = { model: { current: () => ROUTE } }, sibling = {};
  let stops = 0, disposed = 0;
  const ctx = { tools: { resolve: async () => ({ dispose() { disposed++; } }), execute: async request => {
    assert.equal(request.agent, agent); assert.equal(request.signal.aborted, false);
    const args = JSON.parse(request.calls[0].arguments); stops++;
    return { results: [{ result: { isError: false, value: { stopped: args.session } } }] };
  } } };
  const owner = new OwnedBrowserSessions(ctx, agent);
  const receipt = { isError: false, value: { sessionId: 'ours', browserInstanceId: 'fixture-browser' } };
  owner.observe({ agent: sibling, name: 'bsk_session', arguments: { action: 'start' } }, receipt);
  assert.deepEqual(owner.scope.sessionIds, []);
  owner.observe({ agent, name: 'bsk_session', arguments: { action: 'start' } }, { isError: true });
  owner.observe({ agent, name: 'bsk_session', arguments: { action: 'start' } }, receipt);
  await Promise.all([owner.close(), owner.close()]);
  assert.equal(stops, 1); assert.equal(disposed, 1); assert.deepEqual(owner.scope.sessionIds, []);
});

async function nativeBrowserFixture(t, { holdChild = false } = {}) {
  const base = process.env.AGENTDECK_BROWSER_MODULE_BASE;
  if (!base) { t.skip('Set AGENTDECK_BROWSER_MODULE_BASE for the installed public BrowserSkill module.'); return; }
  const req = createRequire(resolve(base, 'package.json'));
  const native = createRequire(import.meta.resolve('@deepseek-ai/dsh-tools/package.json'));
  const Browser = await import(pathToFileURL(req.resolve('@wxg-prc-cpg/browser-skill-dsh-plugin')).href);
  const NativeSkill = await import(pathToFileURL(native.resolve('@deepseek-ai/dsh-tool-skill')).href);
  const h = await createNativeHarness({ holdChild });
  const priorPath = process.env.PATH;
  const calls = [], journal = { records: new Map(), save() {}, release() {} }, cleanupSeen = deferred();
  let handle, stopRole;
  const binary = join(h.storageRoot, 'bsk');
  await writeFile(binary, '#!/bin/sh\nprintf \'%s\\n\' \'' + JSON.stringify(status) + '\'\n'); await chmod(binary, 0o700);
  process.env.PATH = h.storageRoot + ':' + priorPath;
  const runner = { async run(args) {
    calls.push(args);
    if (args[0] === '--version') return { code: 0, stdout: 'fixture', stderr: '' };
    if (args[0] === 'session' && args[1] === 'start') return { code: 0, stdout: JSON.stringify({ session_id: 'owned-native', browser_instance_id: 'fixture-browser' }), stderr: '' };
    if (args[0] === 'session' && args[1] === 'request') {
      const state = args.includes('--prepare') ? 'prepared' : args.includes('--claim') ? 'active' : args.includes('--cancel') ? 'closed' : undefined;
      if (state === 'closed') cleanupSeen.resolve();
      if (state) return { code: 0, stdout: JSON.stringify({ state }), stderr: '' };
    }
    throw new Error('Unexpected BrowserSkill command: ' + JSON.stringify(args));
  }, killAll() {}, killFor() { return 0; } };
  try {
    await h.ctx.plugin(SkillRegistry); await h.ctx.plugin(TokenMeter); await h.ctx.plugin(LocalSubprocess); await h.ctx.plugin(NativeSkill);
    const browserFiber = await h.ctx.plugin(Object.assign((ctx, config) => Browser.apply(ctx, config, { runnerFactory: () => runner, startJournal: journal }), { inject: ['tools'] }), { bskPath: binary, lazyTools: true, observationEnabled: false });
    await h.ctx.plugin(ctx => { ctx.provide('configEditor', { entries: () => [{ options: { name: '@wxg-prc-cpg/browser-skill-dsh-plugin' }, fiber: browserFiber }] }); });
    handle = await h.ctx.agents.create({ sessionId: 'native-browser-owned-proof', meta: { cwd: h.storageRoot }, agentOptions: ROUTE, setup: async (ctx, agent) => {
      stopRole = await bindRoleAgent(ctx, agent, { id: 'browser-owned-proof', presetId: 'browser-owned-proof', policyVersion: 1, createdAt: 1, model: ROUTE, expectedWorkspace: h.storageRoot,
        role: { schemaVersion: 1, id: 'ui-verifier', title: { en: 'Browser proof', zh: '浏览器验证' }, description: { en: 'Inspect delegated page', zh: '检查页面' }, instructions: 'Inspect only the delegated page.', capabilities: ['browser-observe', 'browser-interact'], skills: [], scripts: [], inputs: [], deliverables: [], model: { mode: 'inherit' }, reasoning: { mode: 'model-default' }, context: { targetTokens: 10000, elasticTokens: 32000 }, enabled: true },
        skills: [], budget: { known: false, targetTokens: 10000, elasticTokens: 32000, headroomTokens: 0, diagnostics: [] } });
    } });
    const call = async (args, signal = new AbortController().signal) => (await h.ctx.tools.execute({ agent: handle.agent, signal, calls: [{ type: 'tool-call', id: 'browser-proof-' + calls.length, name: 'bsk_session', arguments: JSON.stringify(args) }] })).results[0].result;
    return { h, agent: handle.agent, calls, journal, call, cleanupSeen, stopRole: () => stopRole(), async close() { try { await stopRole?.(); await handle?.dispose(); } finally { process.env.PATH = priorPath; await h.close(); } } };
  } catch (error) { process.env.PATH = priorPath; await handle?.dispose(); await h.close(); throw error; }
}

test('real native child freezes BrowserSkill after readiness, denies foreign sessions and cleans on normal turn', async t => {
  const f = await nativeBrowserFixture(t); if (!f) return;
  try {
    const denied = await f.call({ action: 'stop', session: 'foreign' }); assert.equal(denied.isError, true);
    const accepted = await f.call({ action: 'start' }); assert.equal(accepted.isError, false, JSON.stringify(accepted));
    assert.equal(accepted.value.sessionId, 'owned-native');
    assert.equal(f.h.adapter.requests.length, 0);
    f.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Complete the local browser lifecycle proof.' }], source: { kind: 'user' } }));
    await bounded(f.agent.whenIdle(), 'normal browser task cleanup');
    assert.equal(f.h.adapter.requests.length, 1);
    assert.equal(f.journal.records.size, 0);
    assert.ok(f.calls.some(args => args[0] === 'session' && args[1] === 'request' && args.includes('--cancel')));
  } finally { await f.close(); }
});

test('cancelled native model turn starts browser cleanup with an independent signal', async t => {
  const f = await nativeBrowserFixture(t, { holdChild: true }); if (!f) return;
  try {
    assert.equal((await f.call({ action: 'start' })).isError, false);
    f.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Wait for local cancellation.' }], source: { kind: 'user' } }));
    await bounded(f.h.adapter.childStarted.promise, 'local model turn started');
    f.agent.cancel({ kind: 'user' });
    await bounded(f.agent.whenIdle(), 'native cancelled turn settled');
    await bounded(f.cleanupSeen.promise, 'idle cancellation initiated native browser cleanup');
    await bounded(f.stopRole(), 'join cancellation cleanup before scope disposal');
    assert.equal(f.journal.records.size, 0);
    assert.ok(f.h.events.some(({ session, event }) => session === f.agent.session && event.type === 'turn/end' && event.data.reason.kind === 'aborted'));
  } finally { await f.close(); }
});

test('successful browser start receipt survives native post-execute cancellation', async t => {
  const f = await nativeBrowserFixture(t); if (!f) return;
  const abort = new AbortController();
  const unbind = f.agent.ctx.on('tools/post-execute', async (execution, result, next) => {
    if (execution.name === 'bsk_session' && execution.arguments.action === 'start' && !result.isError) abort.abort(new Error('cancel after browser creation'));
    return await next();
  });
  try {
    const result = await f.call({ action: 'start' }, abort.signal);
    assert.equal(result.isError, true);
    assert.equal(result.error.info.code, 'ABORTED');
    assert.equal(f.journal.records.size, 1, 'native browser was created before cancellation');
    await bounded(f.stopRole(), 'join cleanup after the final result lost its success value');
    assert.equal(f.journal.records.size, 0, 'already-created native browser session is still owned and closed');
  } finally { unbind(); await f.close(); }
});

test('real native child joins browser cleanup before scope disposal and preserves parent tools', async t => {
  const f = await nativeBrowserFixture(t); if (!f) return;
  try {
    assert.equal((await f.call({ action: 'start' })).isError, false);
    await bounded(f.stopRole(), 'cancelled or unloaded browser task cleanup');
    assert.equal(f.journal.records.size, 0);
    assert.ok(f.calls.some(args => args[0] === 'session' && args[1] === 'request' && args.includes('--cancel')));
    assert.ok(f.h.ctx.tools.get('skill', f.h.parent));
  } finally { await f.close(); }
});
