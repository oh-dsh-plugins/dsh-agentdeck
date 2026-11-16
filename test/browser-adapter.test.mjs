import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { activateBrowserSkill, browserInvocationDenial, browserToolAllowed, inspectBrowserSupport } from '../src/host/browser.ts';

const capabilities = ['browser-observe', 'browser-interact'];
const chrome = suffix => `mcp__chrome-devtools__${suffix}`;
const other = suffix => `mcp__browser__${suffix}`;
const bskNames = ['bsk_session', 'bsk_inspect', 'bsk_interact', 'bsk_page', 'bsk_tabs', 'bsk_assist'];
const bsk = () => inspectBrowserSupport(bskNames, capabilities, { bsk: { state: 'ready', reason: 'Isolated fixture activation and runtime evidence.' } });
const owned = { sessionIds: ['owned-session'], requestIds: ['owned-request'], pageIds: [7] };
const denial = (name, args, scope = owned) => browserInvocationDenial(name, args, capabilities, bsk(), scope);

test('browser discovery freezes one exact MCP namespace and rejects suffix aliases', () => {
  const support = inspectBrowserSupport([
    chrome('take_snapshot'), chrome('click'), chrome('evil_click'), chrome('evaluate_script'),
    other('take_snapshot'), other('click'), ...bskNames,
  ], capabilities, { bsk: { state: 'ready', reason: 'Do not mix this backend with MCP.' } });
  assert.equal(support.backend, 'mcp');
  assert.equal(support.state, 'ready');
  assert.deepEqual(support.allowedNames, [chrome('click'), chrome('take_snapshot')]);
  assert.equal(browserToolAllowed(chrome('evil_click'), capabilities, support), false);
  assert.equal(browserToolAllowed(other('click'), capabilities, support), false);
  assert.equal(browserToolAllowed('bsk_interact', capabilities, support), false);
  assert.equal(inspectBrowserSupport([chrome('click')], capabilities).state, 'unverified');
  assert.equal(inspectBrowserSupport([chrome('take_snapshot'), other('click')], capabilities).state, 'unverified');
  assert.equal(inspectBrowserSupport([chrome('take_snapshot')], ['browser-observe']).state, 'ready');
  assert.equal(inspectBrowserSupport([chrome('take_snapshot')], []).backend, 'none');
});

test('BrowserSkill names and activation alone do not claim CLI/extension readiness', () => {
  const unknown = inspectBrowserSupport(bskNames, capabilities);
  assert.equal(unknown.state, 'unverified');
  assert.deepEqual(unknown.allowedNames, []);
  const missingCli = inspectBrowserSupport(bskNames, capabilities, { bsk: { state: 'unsupported', reason: 'The bsk CLI is absent.' } });
  assert.equal(missingCli.state, 'unsupported');
  assert.equal(missingCli.reason, 'The bsk CLI is absent.');
  assert.deepEqual(missingCli.allowedNames, []);
  const partial = inspectBrowserSupport(['bsk_session'], capabilities, { bsk: { state: 'ready', reason: 'Insufficient declarations.' } });
  assert.equal(partial.state, 'unverified');
  assert.equal(inspectBrowserSupport(['bsk_unknown'], capabilities).backend, 'none');
});

test('compound BrowserSkill actions cannot introduce scripts or replace the owned control target', () => {
  assert.equal(denial('bsk_interact', { action: 'fill', session: 'owned-session', target: '@e3', value: 'Ada' }), undefined);
  assert.equal(denial('bsk_interact', { action: 'step', session: 'owned-session', stepAction: 'fill', params: '{"ref":"e3","value":"Ada"}' }), undefined);
  assert.equal(denial('bsk_interact', { action: 'plan', session: 'owned-session', steps: [{ action: 'fill', ref: '@e3', value: 'Ada' }, { action: 'click', ref: '@e4' }] }), undefined);
  for (const args of [
    { action: 'evaluate', expression: 'document.cookie' },
    { action: 'step', stepAction: 'evaluate', params: '{}' },
    { action: 'step', stepAction: 'click', params: '{"action":"evaluate"}' },
    { action: 'step', stepAction: 'click', params: '{"expression":"1"}' },
    { action: 'step', stepAction: 'click', params: '{"session":"foreign"}' },
    { action: 'step', stepAction: 'click', params: '{"session_id":"foreign"}' },
    { action: 'step', stepAction: 'click', params: '{"unverified":true}' },
    { action: 'step', stepAction: 'click', params: '{"deltaX":1e999}' },
    { action: 'step', stepAction: 'click', params: 'invalid JSON' },
    { action: 'step', stepAction: 'navigate', params: '{"url":"file:///private/task"}' },
    { action: 'plan', steps: [{ action: 'evaluate' }] },
    { action: 'plan', steps: [{ action: 'click', contextId: 'replacement' }] },
    { action: 'plan', steps: [{ action: 'click', session_id: 'foreign' }] },
    { action: 'plan', steps: [{ action: 'click', executeScript: '1' }] },
    { action: 'plan', steps: [] },
    { action: 'plan', steps: Array.from({ length: 21 }, () => ({ action: 'click' })) },
    { action: 'click', deltaX: Infinity },
  ]) assert.equal(typeof denial('bsk_interact', { session: 'owned-session', ...args }), 'string', JSON.stringify(args));
});

test('BrowserSkill policy refuses profile selection, user tabs, debug changes and implicit cleanup', () => {
  assert.equal(denial('bsk_session', { action: 'start' }), undefined);
  assert.match(denial('bsk_session', { action: 'start', browser: 'personal-profile' }), /browser/);
  assert.match(denial('bsk_session', { action: 'start', grantPermissions: true }), /outside/);
  assert.match(denial('bsk_session', { action: 'start', session: 'foreign-session' }), /cannot reuse/);
  assert.match(denial('bsk_session', { action: 'sync', session: 'owned-session', baseline: '/other-task.json' }), /baseline/);
  assert.match(browserInvocationDenial('bsk_session', { action: 'start' }, ['browser-observe'], bsk()), /outside/);
  assert.match(denial('bsk_session', { action: 'stop' }), /created by this task/);
  assert.match(denial('bsk_session', { action: 'stop', session: 'foreign-session' }), /created by this task/);
  assert.equal(denial('bsk_session', { action: 'stop', session: 'owned-session' }), undefined);
  assert.equal(denial('bsk_session', { action: 'stop', requestId: 'owned-request' }), undefined);
  assert.match(denial('bsk_session', { action: 'stop', session: 'owned-session', requestId: 'foreign-request' }), /not owned/);
  assert.match(denial('bsk_inspect', { action: 'snapshot' }), /created by this task/);
  for (const action of ['borrow', 'return']) assert.match(denial('bsk_tabs', { action, session: 'owned-session', tabId: 7 }), /outside/);
  for (const scope of [undefined, 'all', 'user']) assert.match(denial('bsk_tabs', { action: 'list', scope, session: 'owned-session' }), /agent scope/);
  assert.equal(denial('bsk_tabs', { action: 'list', scope: 'agent', session: 'owned-session' }), undefined);
  assert.match(denial('bsk_inspect', { action: 'debug', session: 'owned-session', debugAction: 'replay' }), /debugAction/);
  assert.match(denial('bsk_inspect', { action: 'debug', session: 'owned-session', debugAction: 'rule_add' }), /debugAction/);
  assert.match(denial('bsk_assist', { action: 'emulate', session: 'owned-session' }), /outside/);
  assert.match(denial('bsk_assist', { action: 'request-help', session: 'owned-session' }), /outside/);
  assert.match(denial('bsk_assist', { action: 'operation-cancel', session: 'owned-session', operationId: 'other-task' }), /outside/);
});

test('MCP guard retains ordinary operations and narrows hidden script/header and cleanup paths', () => {
  const support = inspectBrowserSupport(['take_snapshot', 'click', 'navigate_page', 'emulate', 'new_page', 'close_page'].map(chrome), capabilities);
  const call = (suffix, args, scope = owned) => browserInvocationDenial(chrome(suffix), args, capabilities, support, scope);
  assert.equal(call('click', { pageId: 7, uid: 'node-1' }), undefined);
  assert.equal(support.allowedNames.includes(chrome('new_page')), false);
  assert.match(call('new_page', { url: 'about:blank' }), /page receipts are not tracked/);
  assert.match(call('navigate_page', { pageId: 7, url: 'https://example.test', initScript: 'fetch("/write")' }), /initScript/);
  assert.match(call('navigate_page', { pageId: 7, url: 'javascript:alert(1)' }), /HTTP/);
  assert.match(call('emulate', { pageId: 7, extraHttpHeaders: '{"Authorization":"value"}' }), /extraHttpHeaders/);
  assert.match(call('close_page', { pageId: 8 }), /created by this task/);
  assert.match(call('close_page', { pageId: 7 }, {}), /created by this task/);
  assert.equal(call('close_page', { pageId: 7 }), undefined);
});

async function nativeFixture(t) {
  // Optional integration dependency: use the package's public export, never its
  // unpublished files. The env base is a resolver location, not a profile edit.
  const base = process.env.AGENTDECK_BROWSER_MODULE_BASE;
  const browserRequire = createRequire(base ? resolve(base, 'package.json') : import.meta.url);
  let browserEntry;
  try { browserEntry = browserRequire.resolve('@wxg-prc-cpg/browser-skill-dsh-plugin'); }
  catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error;
    t.skip('Optional BrowserSkill package is not resolvable; set AGENTDECK_BROWSER_MODULE_BASE to an installed module base for native proof.');
    return undefined;
  }
  const nativeRequire = createRequire(import.meta.resolve('@deepseek-ai/dsh-tools/package.json'));
  const [{ createNativeHarness, ROUTE }, { default: SkillRegistry }, NativeSkill, Browser] = await Promise.all([
    import('../scripts/probe-native.mjs'), import('@deepseek-ai/dsh-skill'),
    import(pathToFileURL(nativeRequire.resolve('@deepseek-ai/dsh-tool-skill')).href), import(pathToFileURL(browserEntry).href),
  ]);
  const h = await createNativeHarness();
  const calls = [];
  const journal = { records: new Map(), save() {}, release() {} };
  const runner = { async run(args) {
    calls.push(args);
    assert.deepEqual(args, ['--version'], 'activation proof must not start/navigate a browser');
    return { code: 0, stdout: 'isolated runner fixture', stderr: '', timedOut: false, aborted: false };
  }, killAll() {}, killFor() { return 0; } };
  let handle;
  try {
    await h.ctx.plugin(SkillRegistry);
    await h.ctx.plugin(NativeSkill);
    await h.ctx.plugin(Object.assign(ctx => Browser.apply(ctx, { lazyTools: true, observationEnabled: false }, { runnerFactory: () => runner, startJournal: journal }), { inject: ['tools'] }));
    return { h, calls, journal,
      async create(setup) {
        handle = await h.ctx.agents.create({ sessionId: 'browser-independent-proof', meta: { cwd: h.storageRoot }, agentOptions: ROUTE, setup });
        return handle.agent;
      },
      async close() { try { await handle?.dispose(); } finally { await h.close(); } },
    };
  } catch (error) { await h.close(); throw error; }
}

test('independent native child activates BrowserSkill before freeze with zero browser or model calls', async t => {
  const f = await nativeFixture(t);
  if (!f) return;
  try {
    const signal = new AbortController().signal;
    const child = await f.create(async (ctx, agent) => {
      assert.deepEqual(ctx.tools.definitions(agent).map(tool => tool.name).filter(name => name.startsWith('bsk_')), []);
      const result = await activateBrowserSkill(ctx, agent, signal);
      assert.equal(result.activated, true);
      assert.match(result.reason, /readiness was not probed/);
      const skill = await ctx.get('skills').get('browser-skill', { scope: agent, cwd: f.h.storageRoot, signal });
      assert.match(skill.content, /cooperation/);
      assert.equal(skill.resourceBase.kind, 'directory');
      const fs = ctx.get('fs');
      const reference = await fs.resolve('references/cooperation.md', { cwd: skill.resourceBase.path, signal });
      const bytes = await fs.readBytes(reference, signal, 65_536);
      assert.match(new TextDecoder().decode(bytes), /Shared browser control/);
      ctx.tools.restrict({ allow: bskNames });
      assert.equal(ctx.tools.get('skill', agent), undefined, 'activation completed before freeze removed the loader');
    });
    assert.notEqual(child, f.h.parent);
    assert.equal(f.h.adapter.requests.length, 0);
    assert.equal(f.journal.records.size, 0);
    assert.deepEqual(f.calls, [['--version']]);
  } finally { await f.close(); }
});

test('BrowserSkill activation refuses a child whose tool permissions were already frozen', async t => {
  const f = await nativeFixture(t);
  if (!f) return;
  try {
    await assert.rejects(f.create(async (ctx, agent) => {
      ctx.tools.restrict({ allow: [] });
      await activateBrowserSkill(ctx, agent, new AbortController().signal);
    }), /native skill tool is not admitted before permission freeze/);
    assert.equal(f.h.adapter.requests.length, 0);
    assert.deepEqual(f.calls, [['--version']]);
    assert.equal(f.journal.records.size, 0);
  } finally { await f.close(); }
});

test('BrowserSkill activation retains the native guard and refuses a denied skill invocation', async t => {
  const f = await nativeFixture(t);
  if (!f) return;
  try {
    await assert.rejects(f.create(async (ctx, agent) => {
      ctx.tools.guard(exec => {
        if (exec.name !== 'skill') return undefined;
        assert.equal(exec.agent, agent, 'native guard must receive the independent child identity');
        return 'Fixture native policy denies skill activation.';
      });
      await activateBrowserSkill(ctx, agent, new AbortController().signal);
    }), /activation failed through the native skill pipeline/);
    assert.equal(f.h.adapter.requests.length, 0);
    assert.deepEqual(f.calls, [['--version']]);
    assert.equal(f.journal.records.size, 0);
  } finally { await f.close(); }
});
