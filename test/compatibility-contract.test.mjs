import assert from 'node:assert/strict';
import test from 'node:test';
import { activationSession, NativeSessionQueries } from '../lib/host/sessions.js';
import { modelView, sessionRoutes, routeAuthorization } from '../lib/host/models.js';
import { readRunResult } from '../lib/host/results.js';

const signal = new AbortController().signal;
const actor = { id: 'parent' };
const run = { id: 'run', parentId: 'parent', childId: 'child', revision: 'snapshot', phase: 'accepted' };

test('published ID and name receipts resolve once with the original Agent and signal', async () => {
  let calls = 0;
  const runtime = { async resolveName(caller, name, passedSignal) { calls++; assert.equal(caller, actor); assert.equal(name, 'reader'); assert.equal(passedSignal, signal); return 'child'; } };
  assert.equal(await activationSession({ kind: 'activation', subagentId: 'child' }, actor, signal, runtime), 'child');
  assert.equal(calls, 0);
  assert.equal(await activationSession({ kind: 'activation', name: 'reader' }, actor, signal, runtime), 'child');
  assert.equal(calls, 1);
  for (const receipt of [null, {}, { kind: 'other', subagentId: 'child' }, { kind: 'activation', subagentId: 'child', name: 'reader' }, { kind: 'activation', subagentId: '' }, { kind: 'activation', name: 7 }]) {
    await assert.rejects(activationSession(receipt, actor, signal, runtime), /receipt|identity/);
  }
  assert.equal(calls, 1, 'Unrecognized receipts cannot be guessed or retried');
  await assert.rejects(activationSession({ kind: 'activation', name: 'reader' }, actor, signal, {}), /identity/);
});

test('root discovery preserves native ordinary forks in both published contracts', () => {
  const fork = { id: 'ordinary-fork' }, child = { id: 'delegated-child' };
  const agents = { get: () => actor, list: () => [actor, fork, child], roots: () => [actor, fork] };
  const create = subagents => new NativeSessionQueries({ get: key => ({ agents, subagents })[key] });
  const old = create({ getProvider: () => ({}) });
  assert.deepEqual(old.roots(), [actor, fork]);
  assert.equal(old.diagnostics().rootDiscovery, 'registry');
  const modern = create({ rootOf: item => item === child ? actor : item, getProvider: () => ({}) });
  assert.deepEqual(modern.roots(), [actor, fork]);
  assert.equal(modern.diagnostics().rootDiscovery, 'tree');
  const unsupported = new NativeSessionQueries({ get: key => ({ agents: { list: () => [actor, child] }, subagents: {} })[key] });
  assert.throws(() => unsupported.roots(), /unavailable/);
});

test('startup repair requires unique catalog evidence and exact native parent/preset metadata', async () => {
  let entries = [{ id: 'child', mode: 'continuable', label: 'AgentDeck run: Read evidence' }];
  let header = { parentSession: 'parent', agentPreset: 'preset' };
  let disposed = 0, reads = 0;
  const query = { async observeSession(id, options) { assert.equal(id, 'parent'); assert.equal(options.signal, signal); return { projections: { values: { subagentCatalog: entries } }, [Symbol.dispose]() { disposed++; } }; }, async readSession(id, options) { reads++; assert.equal(id, 'child'); assert.equal(options.signal, signal); return { session: header }; } };
  const adapter = new NativeSessionQueries({ get: key => ({ agents: {}, subagents: {}, sessionQuery: query })[key] });
  assert.deepEqual(await adapter.startup(run, 'preset', signal), { kind: 'matched', childId: 'child' });
  header = { ...header, parentSession: 'unrelated' };
  assert.equal((await adapter.startup(run, 'preset', signal)).kind, 'mismatch');
  entries = [...entries, { ...entries[0], id: 'second-child' }];
  assert.equal((await adapter.startup(run, 'preset', signal)).kind, 'ambiguous');
  entries = [];
  assert.equal((await adapter.startup(run, 'preset', signal)).kind, 'missing');
  entries = { unsupported: true };
  assert.equal((await adapter.startup(run, 'preset', signal)).kind, 'unknown');
  assert.equal(reads, 2); assert.equal(disposed, 5);
});

test('unknown native model policy is distinct from absence and cannot authorize inherited routes', async () => {
  const route = { provider: 'p', model: 'm' };
  let events = [], disposed = 0;
  const ctx = { get: () => ({ async observeSession() { return { events, [Symbol.dispose]() { disposed++; } }; } }) };
  assert.equal(await sessionRoutes(ctx, actor, signal), undefined);
  assert.equal(routeAuthorization(route, route, undefined, true, false).status, 'authorized');
  for (const data of [{}, { allowedModels: 'unknown' }, { allowedModels: [{ provider: 'p', model: 7 }] }]) {
    events = [{ type: 'subagent/model-selection-policy', data }];
    const policy = await sessionRoutes(ctx, actor, signal);
    assert.equal(policy.kind, 'unknown');
    const authorization = routeAuthorization(route, route, policy, true, false);
    assert.equal(authorization.status, 'unknown'); assert.equal(authorization.code, 'AGENTDECK_MODEL_POLICY_UNKNOWN');
  }
  assert.equal(disposed, 4);
  assert.equal((await sessionRoutes({ get: () => undefined }, actor, signal)).kind, 'unknown');
});

test('model DTOs normalize structured names and efforts while retaining native IDs and finite capacity', () => {
  for (const efforts of [['high'], [{ id: 'high', name: 'High' }], [{ id: 'high', name: { id: 'high', name: 'High' } }]]) {
    const view = modelView({ provider: 'p', id: 'm', name: { id: 'm', name: 'Model label' }, reasoning: { efforts }, context: { contextWindow: Infinity }, defaultMaxTokens: NaN }, null);
    assert.equal(view.id, 'm'); assert.equal(view.name, 'Model label'); assert.equal(view.efforts[0].id, 'high');
    assert.equal(typeof view.efforts[0].label, 'string'); assert.equal(typeof view.efforts[0].name, 'string');
    assert.equal(view.contextWindow, undefined); assert.equal(view.defaultMaxTokens, undefined); assert.equal(view.authorized, null);
  }
  assert.throws(() => modelView({ provider: 'p', id: 'm', reasoning: { efforts: [{}] } }, null), /effort id/);
});

test('unsupported or malformed native turn endings preserve evidence without claiming success or failure', async () => {
  const report = { status: 'completed', summary: 'Claimed result', evidence: ['read'], limitations: [] };
  for (const reason of [{ kind: 'future-host-state', detail: 'wait' }, {}, null, 'unknown', undefined]) {
    const events = [{ type: 'turn/start', data: { turn: 1 } }, { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: JSON.stringify(report) }] } } }, { type: 'turn/end', data: { reason } }];
    const result = await readRunResult({ events: async () => events, status: () => undefined }, run);
    assert.equal(result.status, 'finished-unverified'); assert.deepEqual(result.evidence, ['read']);
    assert.ok(result.diagnostics.length); assert.equal(result.nativeStop, reason ?? null);
  }
});
