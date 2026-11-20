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
const ok = value => ({ ok: true, value });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const providers = [{ id: 'a', name: 'Provider A' }, { id: 'b', name: 'Provider B' }];
const candidate = (id, provider, model) => ({ id, purpose: id + ' tasks', provider, model, reasoning: { mode: 'fixed', effort: 'high' }, maxTokens: 8192 });
const agent = { schemaVersion: 2, id: 'general', revision: 'r1', model: { mode: 'auto', defaultCandidate: 'first', candidates: [candidate('first', 'a', 'old-a'), candidate('second', 'b', 'old-b'), candidate('third', 'a', 'other-a')] }, reasoning: { mode: 'model-default' }, enabled: true };
const directory = (provider, ids) => ({ providers, models: ids.map(id => ({ provider, id, name: id, metadataResolved: false })), diagnostics: [] });
const metadata = (provider, model) => ({ providers, models: [{ provider, id: model, metadataResolved: true, efforts: [{ id: 'native-high' }] }], diagnostics: [] });
function fixture(respond) {
  const calls = [];
  const controller = plugin.createController({ rpc: { call(channel, endpoint, payload, signal) {
    const call = { name: endpoint.slice('agentdeck.'.length), payload: clone(payload), signal };
    calls.push(call);
    return Promise.resolve(call.name === 'catalog' ? ok({ agents: [clone(agent)], overrides: [] }) : respond(call));
  } } });
  return { controller, calls };
}

test('candidate dropdown options are lazy, shared only within a provider, and never resolve all candidate metadata', async () => {
  const { controller, calls } = fixture(call => ok(call.payload.model ? metadata(call.payload.provider, call.payload.model) : directory(call.payload.provider, ['configured'])));
  try {
    await controller.loadCatalog();
    assert.equal(calls.length, 1);
    await controller.loadCandidateOptions('general', 0);
    await controller.loadCandidateOptions('general', 2);
    assert.deepEqual(calls.slice(1).map(call => call.payload), [{ view: 'options', provider: 'a' }]);
    assert.equal(calls.some(call => call.payload.model), false);
    await controller.loadCandidateOptions('general', 1);
    assert.deepEqual(calls.slice(1).map(call => call.payload.provider), ['a', 'b']);
    await controller.loadProviders();
    await controller.loadProviders();
    assert.equal(calls.length, 3, 'provider ids returned by an options read are reused');
  } finally { controller.dispose(); }
});

test('a slow provider does not cancel or block another candidate list or exact metadata', async () => {
  const slow = deferred();
  const { controller, calls } = fixture(call => call.payload.provider === 'a' && !call.payload.model ? slow.promise : ok(call.payload.model ? metadata('b', call.payload.model) : directory('b', ['old-b', 'new-b'])));
  try {
    await controller.loadCatalog();
    const first = controller.loadCandidateOptions('general', 0);
    assert.equal((await controller.loadCandidateOptions('general', 1)).ok, true);
    assert.equal(calls[1].signal.aborted, false);
    assert.equal(controller.modelOptionsState('a').busy, true);
    assert.equal(controller.modelOptionsState('b').busy, false);
    assert.equal((await controller.loadCandidateMetadata('general', 1)).ok, true);
    assert.equal(controller.modelMetadataState('b', 'old-b').model.efforts[0].id, 'native-high');
    assert.equal(controller.modelOptionsState('a').busy, true);
    slow.resolve(ok(directory('a', ['old-a'])));
    assert.equal((await first).ok, true);
    assert.deepEqual(clone(controller.modelOptionsState('a').items).map(item => item.id), ['old-a']);
    assert.deepEqual(clone(controller.modelOptionsState('b').items).map(item => item.id), ['old-b', 'new-b']);
  } finally { controller.dispose(); }
});

test('failed candidate lists keep independent errors and retry without a poisoned cache', async () => {
  let attempts = 0;
  const { controller } = fixture(call => ok(call.payload.provider === 'a' && ++attempts === 1 ? { providers, models: [], diagnostics: ['Provider A unavailable'] } : directory(call.payload.provider, ['configured'])));
  try {
    await controller.loadCatalog();
    assert.equal((await controller.loadCandidateOptions('general', 0)).ok, false);
    assert.equal((await controller.loadCandidateOptions('general', 1)).ok, true);
    assert.match(controller.modelOptionsState('a').error.message, /Provider A unavailable/);
    assert.equal(controller.modelOptionsState('b').error, null);
    assert.equal(controller.modelOptionsState('a').loaded, false);
    assert.equal((await controller.loadCandidateOptions('general', 0)).ok, true);
    assert.equal(controller.modelOptionsState('a').error, null);
    assert.equal(attempts, 2);
  } finally { controller.dispose(); }
});

test('candidate route selection resets only that route effort, keeps caps/default, and raw drafts remain locked', async () => {
  const { controller, calls } = fixture(call => ok(call.payload.model ? metadata(call.payload.provider, call.payload.model) : directory(call.payload.provider, ['chosen'])));
  try {
    await controller.loadCatalog();
    await controller.setCandidateProvider('general', 0, 'b');
    let form = controller.getSnapshot().drafts.general.form;
    assert.equal(form.model.candidates[0].model, '');
    assert.deepEqual(clone(form.model.candidates[0].reasoning), { mode: 'model-default' });
    assert.equal(form.model.candidates[0].maxTokens, 8192);
    assert.equal(form.model.defaultCandidate, 'first');
    assert.deepEqual(clone(form.model.candidates[1]), agent.model.candidates[1]);
    await controller.setCandidateModel('general', 0, 'chosen');
    form = controller.getSnapshot().drafts.general.form;
    assert.equal(form.model.candidates[0].model, 'chosen');
    assert.equal(controller.modelMetadataState('b', 'chosen').model.metadataResolved, true);
    assert.equal(form.schemaVersion, 3);
    controller.edit('general', 'hand-written YAML');
    const before = calls.length;
    await controller.setCandidateProvider('general', 0, 'a');
    await controller.setCandidateModel('general', 0, 'other');
    await controller.loadCandidateOptions('general', 0);
    assert.equal(calls.length, before);
    assert.equal(controller.getSnapshot().drafts.general.text, 'hand-written YAML');
  } finally { controller.dispose(); }
});

test('saved unavailable dropdown values remain explicit options and exact resolution can still succeed', async () => {
  const { controller } = fixture(call => ok(call.payload.model ? metadata(call.payload.provider, call.payload.model) : directory(call.payload.provider, ['configured'])));
  try {
    await controller.loadCatalog();
    assert.equal(plugin.selectionOptions('old-a', [], false)[0].availability, 'unknown');
    await controller.loadCandidateOptions('general', 0);
    const options = controller.modelOptionsState('a');
    const rows = plugin.selectionOptions('old-a', options.items, options.loaded);
    assert.deepEqual(clone(rows).map(row => [row.id, row.availability]), [['old-a', 'unavailable'], ['configured', undefined]]);
    assert.equal(controller.getSnapshot().drafts.general.form.model.candidates[0].model, 'old-a');
    await controller.loadCandidateMetadata('general', 0);
    assert.equal(controller.modelMetadataState('a', 'old-a').model.metadataResolved, true);
    assert.equal(controller.getSnapshot().drafts.general.form.model.candidates[0].model, 'old-a');
  } finally { controller.dispose(); }
});

test('matching preview metadata is reused while unresolved exact metadata exposes a retryable error', async () => {
  let attempts = 0;
  const { controller, calls } = fixture(call => ok(++attempts === 1 ? { providers, models: [{ provider: call.payload.provider, id: call.payload.model, metadataResolved: false, error: 'metadata unavailable' }], diagnostics: [] } : metadata(call.payload.provider, call.payload.model)));
  try {
    await controller.loadCatalog();
    controller.set({ preview: { agent, model: metadata('a', 'old-a').models[0] } });
    assert.equal((await controller.loadCandidateMetadata('general', 0)).ok, true);
    assert.equal(calls.length, 1);
    assert.equal((await controller.loadCandidateMetadata('general', 1)).ok, true);
    assert.match(controller.modelMetadataState('b', 'old-b').model.error, /metadata unavailable/);
    assert.equal(controller.modelMetadataState('b', 'old-b').model.metadataResolved, false);
    assert.equal((await controller.loadCandidateMetadata('general', 1)).ok, true);
    assert.equal(controller.modelMetadataState('b', 'old-b').model.metadataResolved, true);
    assert.equal(attempts, 2);
  } finally { controller.dispose(); }
});

test('same-provider retries fence late responses and Session changes cancel every scoped read', async () => {
  const pending = [];
  const { controller, calls } = fixture(() => { const work = deferred(); pending.push(work); return work.promise; });
  try {
    await controller.loadCatalog();
    const old = controller.loadModelOptions('a');
    const newest = controller.loadModelOptions('a', true);
    assert.equal(calls[1].signal.aborted, true);
    pending[1].resolve(ok(directory('a', ['new'])));
    assert.equal((await newest).ok, true);
    pending[0].resolve(ok(directory('a', ['stale'])));
    assert.equal((await old).aborted, true);
    assert.equal(controller.modelOptionsState('a').items[0].id, 'new');
    const work = [controller.loadCandidateOptions('general', 1), controller.loadCandidateMetadata('general', 1)];
    const draft = controller.getSnapshot().drafts.general.text;
    controller.setSession('other-session');
    assert.ok(calls.slice(-2).every(call => call.signal.aborted));
    pending.slice(2).forEach(item => item.resolve(ok(directory('b', ['stale']))));
    assert.ok((await Promise.all(work)).every(answer => answer.aborted));
    assert.equal(controller.modelOptionsState('a').loaded, false);
    assert.equal(controller.modelMetadataState('b', 'old-b').model, undefined);
    assert.equal(controller.getSnapshot().drafts.general.text, draft);
  } finally { controller.dispose(); }
});
