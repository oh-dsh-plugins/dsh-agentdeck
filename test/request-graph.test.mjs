import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

let registration;
vm.runInNewContext(await readFile(new URL('../lib/client.js', import.meta.url), 'utf8'), {
  window: { __ModuleLoader__: { load(value) { registration = value; } } },
  AbortController, TextEncoder, setTimeout, clearTimeout,
});
const plugin = registration.factory(() => ({}));
const clone = value => JSON.parse(JSON.stringify(value));
const role = id => ({ schemaVersion: 1, id, revision: id + '-1', title: { en: id, zh: id }, description: { en: id, zh: id }, instructions: 'Read.', capabilities: [], skills: [], scripts: [], inputs: [], deliverables: [], model: { mode: 'inherit' }, reasoning: { mode: 'inherit-compatible' }, context: {}, enabled: true, missingCapabilities: [] });
const catalog = { agents: [role('general'), role('reader')], overrides: [], diagnostics: [], sessions: [] };
function fixture(respond) {
  const calls = [];
  const controller = plugin.createController({ rpc: { async call(channel, endpoint, payload, signal) {
    assert.equal(channel, '/agentdeck');
    const call = { name: endpoint.slice('agentdeck.'.length), payload: clone(payload), signal };
    calls.push(call);
    const value = respond ? await respond(call) : call.name === 'catalog' ? clone(catalog) : call.name === 'preview' ? { agent: role(payload.id), budget: { known: false } } : { runs: [] };
    return { ok: true, value };
  } } });
  return { controller, calls };
}

test('page read planner opens and switches inherited roles without any model directory reads', async () => {
  const { controller, calls } = fixture();
  try {
    await controller.loadCatalog();
    await controller.syncReads();
    await controller.syncReads();
    controller.select('reader');
    await controller.syncReads();
    assert.deepEqual(calls.map(call => call.name), ['catalog', 'preview', 'preview']);
    assert.deepEqual(calls.filter(call => call.name === 'preview').map(call => call.payload.id), ['general', 'reader']);
  } finally { controller.dispose(); }
});

test('refresh follows the visible tab and never fans out hidden model/preview reads', async () => {
  const { controller, calls } = fixture();
  try {
    await controller.loadCatalog();
    controller.set({ tab: 'runs' });
    await controller.refresh();
    assert.deepEqual(calls.slice(1).map(call => call.name), ['catalog', 'runs']);
    controller.set({ tab: 'diagnostics' });
    calls.length = 0;
    await controller.refresh();
    assert.deepEqual(calls.map(call => call.name), ['catalog']);
    controller.set({ tab: 'roles' });
    calls.length = 0;
    await controller.refresh();
    await controller.syncReads();
    assert.deepEqual(calls.map(call => call.name), ['catalog', 'preview']);
  } finally { controller.dispose(); }
});

test('Session changes wait for the new catalog before issuing role reads and preserve drafts', async () => {
  const { controller, calls } = fixture();
  try {
    await controller.loadCatalog();
    controller.edit('general', 'unsaved draft');
    controller.setSession('new-session');
    await controller.syncReads();
    assert.equal(calls.length, 1);
    await controller.loadCatalog();
    await controller.syncReads();
    assert.deepEqual(calls.slice(1).map(call => call.name), ['catalog', 'preview']);
    assert.equal(calls.at(-1).payload.sessionId, 'new-session');
    assert.equal(controller.getSnapshot().drafts.general.text, 'unsaved draft');
  } finally { controller.dispose(); }
});

const autoRole = (count = 3) => ({ ...role('general'), schemaVersion: 2, reasoning: { mode: 'model-default' }, model: { mode: 'auto', defaultCandidate: 'fast', candidates: ['fast', 'deep', 'balanced'].slice(0, count).map(id => ({ id, purpose: 'Use for ' + id, provider: 'provider-' + id, model: 'model-' + id, reasoning: { mode: 'model-default' }, maxTokens: 4096 })) } });

test('auto roles open with one selected preview regardless of candidate count and never enumerate directories', async () => {
  for (const count of [1, 3]) {
    const agent = autoRole(count);
    const { controller, calls } = fixture(call => call.name === 'catalog' ? { ...clone(catalog), agents: [agent] } : { agent, model: { provider: 'provider-fast', id: 'model-fast', metadataResolved: true }, budget: { known: false } });
    try {
      await controller.loadCatalog();
      await controller.syncReads();
      await controller.syncReads();
      assert.deepEqual(calls.map(call => call.name), ['catalog', 'preview']);
      assert.deepEqual(calls[1].payload, { id: 'general', revision: 'general-1', candidateId: 'fast' });
      controller.updateCandidate('general', 0, { model: 'draft-model', maxTokens: 8000 });
      await controller.syncReads();
      assert.equal(calls.length, 2, 'unsaved candidate edits do not resolve metadata for a new route');
      if (count === 3) {
        controller.selectPreviewCandidate('general', 'deep');
        await controller.syncReads();
        await controller.syncReads();
        assert.deepEqual(calls.map(call => call.name), ['catalog', 'preview', 'preview']);
        assert.equal(calls.at(-1).payload.candidateId, 'deep');
        assert.equal(controller.getSnapshot().drafts.general.form.model.defaultCandidate, 'fast');
      }
      const before = calls.length;
      await controller.refresh();
      await controller.syncReads();
      assert.deepEqual(calls.slice(before).map(call => call.name), ['catalog', 'preview']);
      assert.equal(controller.getSnapshot().drafts.general.form.model.candidates[0].model, 'draft-model');
      assert.equal(calls.some(call => call.name === 'models'), false);
    } finally { controller.dispose(); }
  }
});

test('auto preview falls back to the new saved default when a selected candidate is removed', async () => {
  let agent = autoRole();
  const { controller, calls } = fixture(call => call.name === 'catalog' ? { ...clone(catalog), agents: [clone(agent)] } : { agent: clone(agent), budget: { known: false } });
  try {
    await controller.loadCatalog();
    controller.selectPreviewCandidate('general', 'deep');
    await controller.syncReads();
    agent = { ...autoRole(1), revision: 'general-2' };
    await controller.refresh();
    assert.deepEqual(calls.filter(call => call.name === 'preview').map(call => call.payload), [{ id: 'general', revision: 'general-1', candidateId: 'deep' }, { id: 'general', revision: 'general-2', candidateId: 'fast' }]);
    assert.equal(calls.some(call => call.name === 'models'), false);
  } finally { controller.dispose(); }
});

test('auto Session changes preserve the candidate choice and wait for the new catalog', async () => {
  const agent = autoRole();
  const { controller, calls } = fixture(call => call.name === 'catalog' ? { ...clone(catalog), agents: [agent] } : { agent, budget: { known: false } });
  try {
    await controller.loadCatalog();
    controller.selectPreviewCandidate('general', 'deep');
    await controller.syncReads();
    controller.setSession('new-session');
    await controller.syncReads();
    assert.deepEqual(calls.map(call => call.name), ['catalog', 'preview']);
    await controller.loadCatalog();
    await controller.syncReads();
    assert.deepEqual(calls.slice(2).map(call => call.name), ['catalog', 'preview']);
    assert.deepEqual(calls.at(-1).payload, { id: 'general', sessionId: 'new-session', revision: 'general-1', candidateId: 'deep' });
  } finally { controller.dispose(); }
});

test('provider options survive exact metadata selection and reuse the loaded provider list', async () => {
  const { controller, calls } = fixture(call => ({ providers: [{ id: 'p' }], models: call.payload.model ? [{ provider: 'p', id: call.payload.model, metadataResolved: true, efforts: [{ id: 'real-effort' }] }] : [{ provider: 'p', id: 'a', metadataResolved: false }, { provider: 'p', id: 'b', metadataResolved: false }], diagnostics: [], policy: 'not-selected' }));
  try {
    await controller.loadModels('p', 'a');
    await controller.loadModels('p', 'b');
    assert.deepEqual(calls.map(call => call.payload), [{ view: 'options', provider: 'p', model: 'a' }, { view: 'options', provider: 'p' }, { view: 'options', provider: 'p', model: 'b' }]);
    assert.deepEqual(clone(controller.getSnapshot().modelOptions.p).map(row => row.id), ['a', 'b']);
    assert.equal(controller.getSnapshot().models.models[0].id, 'b');
    assert.equal(controller.getSnapshot().models.models[0].efforts[0].id, 'real-effort');
  } finally { controller.dispose(); }
});

test('a provider refresh removes deleted options without discarding exact metadata', async () => {
  let ids = ['a', 'b'];
  const { controller } = fixture(call => ({ providers: [{ id: 'p' }], models: call.payload.model ? [{ provider: 'p', id: 'a', metadataResolved: true, efforts: [] }] : ids.map(id => ({ provider: 'p', id, metadataResolved: false })) }));
  try {
    await controller.loadModels('p', 'a');
    await controller.loadModels('p');
    assert.deepEqual(clone(controller.getSnapshot().modelOptions.p).map(row => row.id), ['a', 'b']);
    ids = ['a'];
    await controller.loadModels('p');
    assert.deepEqual(clone(controller.getSnapshot().modelOptions.p).map(row => row.id), ['a']);
    assert.equal(controller.getSnapshot().models.models[0].metadataResolved, true);
  } finally { controller.dispose(); }
});

test('provider list diagnostics are visible and retry does not reuse a failed directory', async () => {
  let attempts = 0;
  const { controller } = fixture(() => ++attempts === 1 ? { providers: [{ id: 'p' }], models: [], diagnostics: ['p: unavailable'] } : { providers: [{ id: 'p' }], models: [{ provider: 'p', id: 'a', metadataResolved: false }], diagnostics: [] });
  try {
    assert.equal((await controller.loadModels('p')).ok, false);
    assert.match(controller.modelOptionsState('p').error.message, /p: unavailable/);
    assert.equal((await controller.loadModels('p')).ok, true);
    assert.equal(attempts, 2);
    assert.equal(controller.modelOptionsState('p').error, null);
    assert.equal(controller.getSnapshot().modelOptions.p[0].id, 'a');
  } finally { controller.dispose(); }
});

test('known model metadata finishes while its provider list never settles; disposing cancels the remaining list', async () => {
  const { controller, calls } = fixture(call => call.payload.model ? { providers: [{ id: 'p' }], models: [{ provider: 'p', id: 'a', metadataResolved: true, efforts: [{ id: 'native' }] }] } : new Promise(() => {}));
  try {
    const answer = await controller.loadModels('p', 'a');
    assert.equal(answer.ok, true);
    assert.equal(controller.getSnapshot().models.models[0].efforts[0].id, 'native');
    assert.equal(controller.modelMetadataState('p', 'a').busy, false);
    assert.equal(controller.modelOptionsState('p').busy, true);
    assert.equal(calls.length, 2);
    controller.dispose();
    assert.ok(calls.every(call => call.signal.aborted || call.payload.model));
  } finally { controller.dispose(); }
});
