import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

const source = await readFile(new URL('../src/client/index.js', import.meta.url), 'utf8');
let registration;
vm.runInNewContext(source, {
  window: { __ModuleLoader__: { load(value) { registration = value; } } },
  AbortController, TextEncoder, setTimeout, clearTimeout,
});
// These tests exercise the pure client state and carrier contract. No React view is rendered.
const plugin = registration.factory(name => {
  assert.equal(name, 'react');
  return {};
});
const clone = value => JSON.parse(JSON.stringify(value));
const ok = value => ({ ok: true, value });
const general = {
  schemaVersion: 1, id: 'general', title: { en: 'General', zh: '通用' },
  description: { en: 'General tasks', zh: '通用任务' }, instructions: 'Preserve task authorization.',
  capabilities: ['files-read'], skills: [], scripts: [], inputs: ['Task'], deliverables: ['Report'],
  model: { mode: 'inherit' }, reasoning: { mode: 'inherit-compatible' },
  context: { targetTokens: 24000, elasticTokens: 12000 }, enabled: true,
  revision: 'factory-r1', builtin: true, available: true, missingCapabilities: [],
};
const catalog = (overrides = [], agents = [general]) => ({
  agents: clone(agents), overrides: clone(overrides), diagnostics: [],
  runtime: { compatibilityVersion: '0.2.2-rc.3', nativeProvider: true, storage: true },
  sessions: [{ id: 'session-a', title: 'Session A' }],
});
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
function harness(responder = () => ok(catalog())) {
  const calls = [];
  const controller = plugin.createController({ rpc: { call(channel, endpoint, payload, signal) {
    assert.equal(channel, '/agentdeck');
    assert.ok(endpoint.startsWith('agentdeck.'));
    const call = { channel, endpoint, payload: clone(payload), signal };
    calls.push(call);
    return responder(call, calls.length);
  } } });
  return { controller, calls };
}

test('static module uses host React and additive native settings registration', () => {
  assert.equal(registration.id, 'dsh-agentdeck');
  assert.deepEqual(clone(plugin.inject), ['slots', 'locale', 'connection']);
  const slots = [];
  const dictionaries = [];
  const effects = [];
  const subscriptions = new Set();
  const locale = {
    active: 'en',
    getSnapshot() { return { active: this.active }; },
    register(ns, language, values) { dictionaries.push({ ns, language, values }); return () => {}; },
    bind() { return key => plugin.dictionaries[locale.active][key]; },
    subscribe(callback) { subscriptions.add(callback); return () => subscriptions.delete(callback); },
  };
  const ctx = {
    get(name) { assert.equal(name, 'locale'); return locale; },
    effect(callback) { effects.push(callback()); },
    slots: {
      inject(name, callback) { effects.push(callback()); },
      register(options, component) { const entry = { ...options, component, disposed: false }; slots.push(entry); return () => { entry.disposed = true; }; },
    },
  };
  plugin.apply(ctx);
  assert.deepEqual(dictionaries.map(item => item.language), ['en', 'zh']);
  assert.equal(slots[0].name, 'settings.section');
  assert.equal(slots[0].id, 'agentdeck');
  assert.equal(slots[0].order, 30);
  assert.equal(slots[0].label, 'AgentDeck');
  assert.equal(slots[1].name, 'settings.section.icon');
  assert.equal(slots[1].id, 'agentdeck');
  locale.active = 'zh';
  for (const callback of subscriptions) callback();
  assert.equal(slots[0].disposed, true);
  assert.equal(slots.at(-1).label, '代理工具箱');
  assert.equal(slots.at(-1).component, slots[0].component, 'Locale changes keep the component identity stable');
  effects.reverse().forEach(dispose => dispose?.());
  assert.equal(subscriptions.size, 0);
  assert.ok(slots.every(entry => entry.disposed));
});

test('RPC reads a DIRECT operation result and works without a selected Session', async () => {
  const { controller, calls } = harness();
  const answer = await controller.loadCatalog();
  assert.equal(answer.ok, true);
  assert.equal(controller.getSnapshot().selectedId, 'general');
  assert.deepEqual(calls[0].payload, {});
  assert.equal(calls[0].endpoint, 'agentdeck.catalog');
  assert.ok(calls[0].signal instanceof AbortSignal);
  controller.dispose();
});

test('RPC failure and obsolete response.result envelope are surfaced', async () => {
  const { controller } = harness(() => ({ ok: false, error: { code: 'DENIED', message: 'Session access denied' } }));
  assert.equal((await controller.loadCatalog()).ok, false);
  assert.equal(controller.getSnapshot().errors.catalog.code, 'DENIED');
  assert.equal(controller.getSnapshot().catalog, null);
  controller.dispose();
  const invalid = harness(() => ({ result: ok(catalog()) })).controller;
  assert.equal((await invalid.loadCatalog()).ok, false);
  assert.equal(invalid.getSnapshot().errors.catalog.code, 'malformedResponse');
  invalid.dispose();
});

test('generated YAML omits runtime fields and contains a complete core definition', () => {
  const definition = JSON.parse(plugin.definitionText(general));
  assert.deepEqual(definition.model, { mode: 'inherit' });
  assert.equal(definition.enabled, true);
  assert.equal(definition.instructions, general.instructions);
  for (const key of ['revision', 'builtin', 'available', 'missingCapabilities']) assert.equal(key in definition, false);
});

test('save errors preserve raw YAML and the revision used for concurrency control', async () => {
  const text = 'schemaVersion: 1\nid: general\nenabled: false\n';
  const { controller, calls } = harness(call => call.endpoint === 'agentdeck.catalog'
    ? ok(catalog([{ id: 'general', text: 'id: general\n', revision: 'override-r1' }]))
    : { ok: false, error: { code: 'CONFLICT', message: 'Override changed' } });
  await controller.loadCatalog();
  controller.edit('general', text);
  const answer = await controller.save('general');
  assert.equal(answer.ok, false);
  assert.equal(controller.getSnapshot().drafts.general.text, text);
  assert.equal(controller.getSnapshot().drafts.general.expectedRevision, 'override-r1');
  assert.equal(controller.getSnapshot().errors.save.code, 'CONFLICT');
  assert.deepEqual(calls.at(-1).payload, { id: 'general', text, expectedRevision: 'override-r1' });
  controller.dispose();
});

test('refresh preserves dirty drafts, including their old expectedRevision', async () => {
  let revision = 'override-r1';
  const { controller } = harness(() => ok(catalog([{ id: 'general', text: 'id: general\n', revision }])));
  await controller.loadCatalog();
  controller.edit('general', 'id: general\nenabled: false\n');
  revision = 'override-r2';
  await controller.loadCatalog();
  assert.equal(controller.getSnapshot().drafts.general.expectedRevision, 'override-r1');
  assert.equal(controller.getSnapshot().drafts.general.text, 'id: general\nenabled: false\n');
  controller.discard('general');
  assert.equal(controller.getSnapshot().drafts.general.expectedRevision, 'override-r2');
  controller.dispose();
});

test('typing during an in-flight save survives a successful response and reload', async () => {
  const pending = deferred();
  let saved = false;
  const first = 'id: general\nenabled: false\n';
  const later = first + 'instructions: Keep this later edit\n';
  const { controller } = harness(call => {
    if (call.endpoint === 'agentdeck.save') return pending.promise;
    return ok(saved ? catalog([{ id: 'general', text: first, revision: 'override-r2' }]) : catalog());
  });
  await controller.loadCatalog();
  controller.edit('general', first);
  const saving = controller.save('general');
  controller.edit('general', later);
  saved = true;
  pending.resolve(ok({ id: 'general', text: first, revision: 'override-r2' }));
  assert.equal((await saving).ok, true);
  const draft = controller.getSnapshot().drafts.general;
  assert.equal(draft.text, later);
  assert.equal(draft.baseline, first);
  assert.equal(draft.expectedRevision, 'override-r2');
  controller.dispose();
});

test('structured controls cannot overwrite dirty raw YAML', async () => {
  const { controller } = harness();
  await controller.loadCatalog();
  controller.updateForm('general', { enabled: false });
  assert.equal(JSON.parse(controller.getSnapshot().drafts.general.text).enabled, false);
  controller.edit('general', 'id: general\ninstructions: custom\n');
  controller.updateForm('general', { enabled: true });
  assert.equal(controller.getSnapshot().drafts.general.text, 'id: general\ninstructions: custom\n');
  controller.dispose();
});

test('create and derive send a real YAML override through agentdeck.save', async () => {
  const { controller, calls } = harness(call => call.endpoint === 'agentdeck.save'
    ? ok({ id: call.payload.id, text: call.payload.text, revision: 'custom-r1' }) : ok(catalog()));
  await controller.loadCatalog();
  controller.beginCreate('general');
  controller.setNewId('project-reader');
  assert.equal((await controller.save('@new')).ok, true);
  const call = calls.find(call => call.endpoint === 'agentdeck.save');
  assert.equal(call.payload.id, 'project-reader');
  assert.deepEqual(JSON.parse(call.payload.text), { schemaVersion: 1, id: 'project-reader', extends: 'general' });
  assert.equal('expectedRevision' in call.payload, false);
  controller.dispose();
});

test('import updates an existing role with its override revision and preserves other drafts', async () => {
  const { controller, calls } = harness(call => call.endpoint === 'agentdeck.save'
    ? ok({ ...call.payload, revision: 'override-r2' })
    : ok(catalog([{ id: 'general', revision: 'override-r1', text: 'id: general\n' }])));
  await controller.loadCatalog();
  const text = 'schemaVersion: 1\nid: general\nenabled: false\n';
  assert.equal(controller.importText(text), true);
  assert.equal(controller.getSnapshot().creating, false);
  assert.equal(controller.getSnapshot().selectedId, 'general');
  assert.equal(controller.getSnapshot().drafts.general.text, text);
  await controller.save('general');
  assert.equal(calls.find(call => call.endpoint === 'agentdeck.save').payload.expectedRevision, 'override-r1');
  controller.edit('general', 'id: general\ninstructions: keep\n');
  assert.equal(controller.importText(text), false);
  assert.equal(controller.getSnapshot().drafts.general.text, 'id: general\ninstructions: keep\n');
  assert.equal(controller.getSnapshot().errors.import.code, 'draftConflict');
  assert.equal(controller.importText('x'.repeat(1024 * 1024 + 1)), false);
  assert.equal(controller.getSnapshot().errors.import.code, 'importTooLarge');
  controller.dispose();
});

test('a new draft is preserved across cancel, derive and import attempts', async () => {
  const { controller } = harness();
  await controller.loadCatalog();
  controller.beginCreate();
  controller.setNewId('project-reader');
  const draft = controller.getSnapshot().drafts['@new'].text;
  controller.set({ creating: false });
  controller.beginCreate('reader');
  assert.equal(controller.getSnapshot().drafts['@new'].text, draft);
  assert.equal(controller.getSnapshot().creating, true);
  assert.equal(controller.importText('id: other-role\nextends: general\n'), false);
  assert.equal(controller.getSnapshot().drafts['@new'].text, draft);
  controller.dispose();
});

test('reset calls the Host and leaves the draft intact on failure', async () => {
  const { controller, calls } = harness(call => call.endpoint === 'agentdeck.catalog'
    ? ok(catalog([{ id: 'general', revision: 'override-r1', text: 'id: general\n' }]))
    : { ok: false, error: { code: 'STORAGE', message: 'Store is read only' } });
  await controller.loadCatalog();
  controller.edit('general', 'id: general\nenabled: false\n');
  const before = controller.getSnapshot().drafts.general.text;
  assert.equal((await controller.reset('general')).ok, false);
  assert.equal(controller.getSnapshot().drafts.general.text, before);
  assert.deepEqual(calls.at(-1).payload, { id: 'general', expectedRevision: 'override-r1' });
  controller.dispose();
});

test('saving an existing role includes the selected Session and expected revision', async () => {
  const text = 'schemaVersion: 1\nid: general\nenabled: false\n';
  const { controller, calls } = harness(call => call.endpoint === 'agentdeck.save'
    ? ok({ id: call.payload.id, text: call.payload.text, revision: 'override-r2' })
    : ok(catalog([{ id: 'general', text: 'id: general\n', revision: 'override-r1' }])));
  controller.setSession('session-a');
  await controller.loadCatalog();
  controller.edit('general', text);
  assert.equal((await controller.save('general')).ok, true);
  const save = calls.find(call => call.endpoint === 'agentdeck.save');
  assert.deepEqual(save.payload, { sessionId: 'session-a', id: 'general', text, expectedRevision: 'override-r1' });
  assert.ok(calls.filter(call => call.endpoint === 'agentdeck.catalog').every(call => call.payload.sessionId === 'session-a'));
  controller.dispose();
});

test('deriving a project role includes the selected Session in the new-role save', async () => {
  const projectRole = { ...general, id: 'project-base', builtin: false };
  const { controller, calls } = harness(call => {
    if (call.endpoint === 'agentdeck.catalog') return ok(catalog([], [general, projectRole]));
    assert.equal(call.endpoint, 'agentdeck.save');
    assert.equal(call.payload.sessionId, 'session-a', 'Derivation must use the same project catalog as the selected Session');
    return ok({ id: call.payload.id, text: call.payload.text, revision: 'custom-r1' });
  });
  controller.setSession('session-a');
  await controller.loadCatalog();
  controller.beginCreate('project-base');
  controller.setNewId('project-derived');
  assert.equal((await controller.save('@new')).ok, true);
  const save = calls.find(call => call.endpoint === 'agentdeck.save');
  assert.equal(save.payload.id, 'project-derived');
  assert.equal(save.payload.sessionId, 'session-a');
  assert.equal('expectedRevision' in save.payload, false);
  assert.deepEqual(JSON.parse(save.payload.text), { schemaVersion: 1, id: 'project-derived', extends: 'project-base' });
  controller.dispose();
});

test('reset includes the selected Session and keeps its revision check', async () => {
  const { controller, calls } = harness(call => call.endpoint === 'agentdeck.reset'
    ? ok({ id: call.payload.id, reset: true })
    : ok(catalog([{ id: 'general', text: 'id: general\n', revision: 'override-r1' }])));
  controller.setSession('session-a');
  await controller.loadCatalog();
  assert.equal((await controller.reset('general')).ok, true);
  const reset = calls.find(call => call.endpoint === 'agentdeck.reset');
  assert.deepEqual(reset.payload, { sessionId: 'session-a', id: 'general', expectedRevision: 'override-r1' });
  assert.ok(calls.filter(call => call.endpoint === 'agentdeck.catalog').every(call => call.payload.sessionId === 'session-a'));
  controller.dispose();
});

test('model queries forward exact provider/model and the explicitly selected Session', async () => {
  const metadata = { providers: [{ id: 'actual', name: 'Actual provider' }], models: [{ provider: 'actual', id: 'real-model', name: 'Real model', authorized: null, efforts: [] }], policy: 'not-selected', diagnostics: [] };
  const { controller, calls } = harness(() => ok(metadata));
  controller.setSession('session-a');
  await controller.loadModels('actual', 'real-model');
  assert.deepEqual(calls.find(call => call.payload.model).payload, { sessionId: 'session-a', view: 'options', provider: 'actual', model: 'real-model' });
  assert.equal(controller.getSnapshot().models.models[0].authorized, null);
  assert.deepEqual(clone(controller.getSnapshot().models.models[0].efforts), []);
  controller.dispose();
});

test('provider discovery does not implicitly resolve an inherited model', async () => {
  const metadata = { providers: [{ id: 'actual', name: 'Actual provider' }], models: [], selection: { provider: 'actual', model: 'omitted-model', reasoningEffort: 'medium' }, policy: 'session', diagnostics: [] };
  const { controller, calls } = harness(call => ok(call.payload.model ? { ...metadata, models: [{ provider: 'actual', id: 'omitted-model', authorized: true, efforts: [{ id: 'medium', name: 'Medium' }] }] } : metadata));
  controller.setSession('session-a');
  await controller.loadModels();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].payload, { sessionId: 'session-a', view: 'options' });
  assert.equal(controller.getSnapshot().models, null);
  assert.deepEqual(clone(controller.getSnapshot().providers), metadata.providers);
  controller.dispose();
});

test('preview retains native effective selection and unknown budget values verbatim', async () => {
  const preview = { agent: general, effectiveSelection: { provider: 'actual', model: 'real-model', reasoningEffort: 'high', maxTokens: 8192 }, budget: { known: false, targetTokens: 24000, elasticTokens: 12000, headroomTokens: 0, diagnostics: ['Window unknown'] }, diagnostics: [] };
  const { controller, calls } = harness(() => ok(preview));
  await controller.loadPreview('general');
  assert.deepEqual(clone(controller.getSnapshot().preview.effectiveSelection), preview.effectiveSelection);
  assert.equal(controller.getSnapshot().preview.budget.safeInputTokens, undefined);
  assert.deepEqual(calls[0].payload, { id: 'general' });
  controller.dispose();
});

test('later fixed-model selection stays current while independent earlier metadata completes', async () => {
  const first = deferred();
  const second = deferred();
  const providers = [{ id: 'one' }, { id: 'two' }];
  const metadata = (provider, id) => ({ providers, models: [{ provider, id, metadataResolved: true, efforts: [] }], diagnostics: [] });
  const { controller, calls } = harness(call => call.payload.model ? call.payload.provider === 'one' ? first.promise : second.promise : ok({ providers, models: [], diagnostics: [] }));
  try {
    const old = controller.loadModels('one', 'a');
    const latest = controller.loadModels('two', 'b');
    assert.equal(calls[0].signal.aborted, false);
    second.resolve(ok(metadata('two', 'b')));
    assert.equal((await latest).ok, true);
    first.resolve(ok(metadata('one', 'a')));
    assert.equal((await old).ok, true);
    assert.equal(controller.getSnapshot().models.models[0].id, 'b');
    assert.equal(controller.modelMetadataState('one', 'a').model.id, 'a');
  } finally { controller.dispose(); }
});

test('result paging uses nextOffset and does not fabricate completion from idle', async () => {
  const { controller, calls } = harness(call => ok({
    childId: call.payload.childId, status: 'idle', summary: '', rawText: call.payload.offset ? 'second' : 'first',
    totalCharacters: 11, ...(call.payload.offset ? {} : { nextOffset: 5 }), limitations: ['Outcome not declared'],
  }));
  await controller.loadResult('child-a');
  assert.equal(controller.getSnapshot().result.status, 'idle');
  await controller.loadResult('child-a', true);
  assert.equal(controller.getSnapshot().result.rawText, 'firstsecond');
  assert.equal(calls[1].payload.offset, 5);
  assert.equal(controller.getSnapshot().result.nextOffset, undefined);
  controller.dispose();
});

test('unmount aborts every pending operation and ignores late async answers', async () => {
  const pending = deferred();
  const { controller, calls } = harness(() => pending.promise);
  let emissions = 0;
  controller.subscribe(() => emissions++);
  const work = [controller.loadCatalog(), controller.loadModels(), controller.loadPreview('general'), controller.loadRuns(), controller.loadResult('child-a')];
  controller.dispose();
  assert.ok(calls.every(call => call.signal.aborted));
  const before = emissions;
  pending.resolve(ok(catalog()));
  const answers = await Promise.all(work);
  assert.ok(answers.every(answer => answer.aborted));
  assert.equal(emissions, before);
  assert.equal(controller.getSnapshot().catalog, null);
});

test('Session changes abort prior contextual reads and never drop role drafts', async () => {
  const pending = deferred();
  let wait = false;
  const { controller, calls } = harness(() => wait ? pending.promise : ok(catalog()));
  await controller.loadCatalog();
  controller.edit('general', 'id: general\nenabled: false\n');
  wait = true;
  const loading = controller.loadModels();
  controller.setSession('session-b');
  assert.equal(calls.at(-1).signal.aborted, true);
  pending.resolve(ok({ models: [{ id: 'stale' }] }));
  await loading;
  assert.equal(controller.getSnapshot().models, null);
  assert.equal(controller.getSnapshot().drafts.general.text, 'id: general\nenabled: false\n');
  controller.dispose();
});

test('zh/en resources match the registered dictionaries and include display metadata', async () => {
  assert.deepEqual(Object.keys(plugin.dictionaries.en).sort(), Object.keys(plugin.dictionaries.zh).sort());
  for (const language of ['en', 'zh']) {
    const resource = JSON.parse(await readFile(new URL(`../locale/${language}.json`, import.meta.url), 'utf8'));
    assert.ok(resource.meta.title.length > 0);
    assert.ok(resource.meta.description.length > 0);
    assert.deepEqual(resource.ui, clone(plugin.dictionaries[language]));
    for (const [key, value] of Object.entries(resource.ui)) {
      assert.equal(typeof value, 'string', key);
      assert.ok(value.length > 0, key);
      const placeholders = text => [...text.matchAll(/\{([a-zA-Z]+)\}/g)].map(match => match[1]).sort();
      assert.deepEqual(placeholders(value), placeholders(plugin.dictionaries.en[key]), key);
    }
  }
});

function deadlineHarness(responder) {
  const timers = new Map();
  let sequence = 0;
  let module;
  vm.runInNewContext(source, {
    window: { __ModuleLoader__: { load(value) { module = value; } } }, AbortController, TextEncoder,
    setTimeout(callback, delay) { assert.equal(delay, 15000); const id = ++sequence; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  const localPlugin = module.factory(() => ({}));
  const calls = [];
  const controller = localPlugin.createController({ rpc: { call(_channel, endpoint, payload, signal) {
    const call = { endpoint, payload, signal }; calls.push(call); return responder(call);
  } } });
  return { controller, calls, timers, expire() { for (const callback of [...timers.values()]) callback(); } };
}

test('a hung read times out visibly, preserves drafts, and allows retry without accepting late output', async () => {
  const late = deferred();
  let hanging = true;
  const f = deadlineHarness(call => call.endpoint === 'agentdeck.catalog' ? ok(catalog()) : hanging ? late.promise : ok({ agent: clone(general), budget: { known: false } }));
  await f.controller.loadCatalog();
  f.controller.edit('general', 'schemaVersion: 1\nid: general\nenabled: false\n');
  const work = f.controller.loadPreview('general');
  assert.equal(f.controller.getSnapshot().busy.preview, true);
  f.expire();
  assert.equal((await work).error.code, 'requestTimeout');
  assert.equal(f.calls.at(-1).signal.aborted, true);
  assert.equal(f.controller.getSnapshot().busy.preview, false);
  assert.equal(f.controller.getSnapshot().errors.preview.message, 'requestTimeout');
  assert.match(f.controller.getSnapshot().drafts.general.text, /enabled: false/);
  assert.equal(f.timers.size, 0);
  hanging = false;
  assert.equal((await f.controller.loadPreview('general')).ok, true);
  late.resolve(ok({ agent: { id: 'stale' } }));
  await Promise.resolve();
  assert.equal(f.controller.getSnapshot().preview.agent.id, 'general');
  assert.equal(f.controller.getSnapshot().errors.preview, null);
  assert.equal(f.timers.size, 0);
  f.controller.dispose();
});

test('unmount ends a non-cooperative read and clears its deadline without a false timeout error', async () => {
  const f = deadlineHarness(() => new Promise(() => {}));
  const work = f.controller.loadRuns();
  f.controller.dispose();
  assert.equal((await work).aborted, true);
  assert.equal(f.timers.size, 0);
  assert.equal(f.controller.getSnapshot().errors.runs, null);
});

test('mutations have no read deadline or automatic replay', async () => {
  const pending = deferred();
  const f = deadlineHarness(call => call.endpoint === 'agentdeck.catalog' ? ok(catalog()) : pending.promise);
  await f.controller.loadCatalog();
  f.controller.edit('general', 'schemaVersion: 1\nid: general\nenabled: false\n');
  const saving = f.controller.save('general');
  assert.equal(f.timers.size, 0);
  pending.resolve({ ok: false, error: { message: 'fixture save failed' } });
  assert.equal((await saving).ok, false);
  assert.equal(f.calls.filter(call => call.endpoint === 'agentdeck.save').length, 1);
  assert.match(f.controller.getSnapshot().drafts.general.text, /enabled: false/);
  f.controller.dispose();
});

const candidate = (id, extra = {}) => ({ id, purpose: 'Use for ' + id, provider: 'provider-' + id, model: 'model-' + id, reasoning: { mode: 'model-default' }, maxTokens: 4096, ...extra });
const autoRole = () => ({ ...clone(general), schemaVersion: 2, model: { mode: 'auto', defaultCandidate: 'fast', candidates: [candidate('fast'), candidate('deep', { reasoning: { mode: 'fixed', effort: 'high' }, maxTokens: 8192 })] }, reasoning: { mode: 'model-default' } });

test('existing v1 definitions stay v1 until a new feature is authored', async () => {
  const { controller } = harness();
  try {
    await controller.loadCatalog();
    assert.equal(JSON.parse(controller.getSnapshot().drafts.general.text).schemaVersion, 1);
    controller.updateForm('general', { enabled: false });
    controller.setModelMode('general', 'fixed');
    controller.updateForm('general', { model: { mode: 'fixed', provider: 'p', model: 'm' }, reasoning: { mode: 'fixed', effort: 'high' } });
    assert.equal(JSON.parse(controller.getSnapshot().drafts.general.text).schemaVersion, 1);
    controller.updateForm('general', { output: { maxTokens: 6000 } });
    let definition = JSON.parse(controller.getSnapshot().drafts.general.text);
    assert.equal(definition.schemaVersion, 2);
    assert.deepEqual(definition.output, { maxTokens: 6000 });
    controller.updateForm('general', { output: undefined });
    definition = JSON.parse(controller.getSnapshot().drafts.general.text);
    assert.equal(definition.schemaVersion, 2);
    assert.equal(definition.output, null, 'an override must explicitly clear an inherited output cap');
    controller.discard('general');
    assert.equal(JSON.parse(controller.getSnapshot().drafts.general.text).schemaVersion, 1);
    controller.setModelMode('general', 'auto');
    assert.equal(JSON.parse(controller.getSnapshot().drafts.general.text).schemaVersion, 2);
  } finally { controller.dispose(); }
});

test('output caps roundtrip through save and catalog without changing other definition fields', async () => {
  let current = clone(general);
  let override;
  const { controller, calls } = harness(call => {
    if (call.endpoint === 'agentdeck.save') {
      current = { ...JSON.parse(call.payload.text), revision: 'override-r2', builtin: true, available: true, missingCapabilities: [] };
      override = { id: current.id, text: call.payload.text, revision: current.revision };
      return ok(override);
    }
    return ok(catalog(override ? [override] : [], [current]));
  });
  try {
    await controller.loadCatalog();
    controller.updateForm('general', { output: { maxTokens: 7000 } });
    controller.updateForm('general', { context: { ...general.context, targetTokens: 25000 } });
    const authored = JSON.parse(controller.getSnapshot().drafts.general.text);
    assert.deepEqual(authored.output, { maxTokens: 7000 });
    assert.equal(authored.instructions, general.instructions);
    assert.equal((await controller.save('general')).ok, true);
    const draft = controller.getSnapshot().drafts.general;
    assert.equal(draft.text, draft.baseline);
    assert.equal(draft.expectedRevision, 'override-r2');
    assert.equal(draft.form.output.maxTokens, 7000);
    assert.deepEqual(JSON.parse(plugin.definitionText(current)), authored);
    assert.equal(calls.filter(call => call.endpoint === 'agentdeck.save').length, 1);
  } finally { controller.dispose(); }
});

test('inline auto editor owns candidate cap and effort, preserves defaults, and bounds candidates', async () => {
  let current = { ...clone(general), model: { mode: 'fixed', provider: 'p', model: 'm' }, reasoning: { mode: 'fixed', effort: 'high' } };
  let override;
  const { controller } = harness(call => {
    if (call.endpoint === 'agentdeck.save') {
      current = { ...JSON.parse(call.payload.text), revision: 'auto-r2', builtin: true, available: true, missingCapabilities: [] };
      override = { id: current.id, text: call.payload.text, revision: current.revision };
      return ok(override);
    }
    return ok(catalog(override ? [override] : [], [current]));
  });
  try {
    await controller.loadCatalog();
    controller.updateForm('general', { output: { maxTokens: 5000 } });
    controller.setModelMode('general', 'auto');
    let form = controller.getSnapshot().drafts.general.form;
    assert.equal(form.schemaVersion, 2);
    assert.equal('output' in form, false);
    assert.deepEqual(clone(form.reasoning), { mode: 'model-default' });
    assert.equal(form.model.candidates[0].maxTokens, 5000);
    assert.equal(form.model.candidates[0].provider, 'p');
    assert.equal(form.model.candidates[0].model, 'm');
    controller.updateCandidate('general', 0, { id: 'fast', purpose: 'Small tasks' });
    assert.equal(controller.getSnapshot().drafts.general.form.model.defaultCandidate, 'fast');
    controller.addCandidate('general');
    controller.updateCandidate('general', 1, candidate('deep', { reasoning: { mode: 'fixed', effort: 'high' }, maxTokens: 8000 }));
    form = controller.getSnapshot().drafts.general.form;
    controller.updateForm('general', { model: { ...form.model, defaultCandidate: 'deep' } });
    controller.addCandidate('general');
    controller.addCandidate('general');
    assert.equal(controller.getSnapshot().drafts.general.form.model.candidates.length, 3);
    controller.removeCandidate('general', 2);
    const authored = JSON.parse(controller.getSnapshot().drafts.general.text);
    assert.equal(authored.model.defaultCandidate, 'deep');
    assert.equal(authored.model.candidates[1].reasoning.effort, 'high');
    assert.equal(authored.model.candidates[1].maxTokens, 8000);
    assert.deepEqual(clone(plugin.formIssues(authored)), []);
    assert.equal((await controller.save('general')).ok, true);
    assert.deepEqual(JSON.parse(controller.getSnapshot().drafts.general.text), authored);
    controller.removeCandidate('general', 1);
    assert.equal(controller.getSnapshot().drafts.general.form.model.defaultCandidate, 'fast');
    controller.removeCandidate('general', 0);
    assert.equal(controller.getSnapshot().drafts.general.form.model.candidates.length, 1);
  } finally { controller.dispose(); }
});

test('structured validation rejects incomplete candidates and invalid caps without an RPC', async () => {
  const { controller, calls } = harness();
  try {
    await controller.loadCatalog();
    for (const maxTokens of [0, -1, 1.5, 16777217, Number.NaN, '4096']) {
      controller.updateForm('general', { output: { maxTokens } });
      assert.equal((await controller.save('general')).ok, false);
      assert.equal(controller.getSnapshot().errors.save.code, 'invalidForm');
      assert.equal(controller.getSnapshot().errors.save.details.issues[0].key, 'invalidOutput');
    }
    controller.setModelMode('general', 'auto');
    assert.equal((await controller.save('general')).ok, false);
    assert.ok(controller.getSnapshot().errors.save.details.issues.some(issue => issue.key === 'invalidCandidate'));
    controller.updateForm('general', { model: { mode: 'auto', defaultCandidate: 'missing', candidates: [candidate('same'), candidate('same')] } });
    assert.equal((await controller.save('general')).ok, false);
    assert.ok(controller.getSnapshot().errors.save.details.issues.some(issue => issue.key === 'invalidCandidates'));
    for (const invalid of [candidate('Bad_ID'), candidate('ok', { purpose: 'x'.repeat(241) }), candidate('ok', { reasoning: { mode: 'fixed', effort: '' } }), candidate('ok', { maxTokens: 0 })]) {
      assert.ok(plugin.formIssues({ ...autoRole(), model: { mode: 'auto', defaultCandidate: invalid.id, candidates: [invalid] } }).length > 0);
    }
    assert.equal(calls.filter(call => call.endpoint === 'agentdeck.save').length, 0);
  } finally { controller.dispose(); }
});

test('new feature controls cannot overwrite raw v1 or v2 imports and preserve CAS on refresh', async () => {
  for (const role of [general, autoRole()]) {
    const imported = plugin.definitionText({ ...role, enabled: false });
    const { controller, calls } = harness(call => call.endpoint === 'agentdeck.save' ? { ok: false, error: { code: 'CONFLICT', message: 'Concurrent override' } } : ok(catalog([{ id: 'general', text: 'schemaVersion: 1\nid: general\n', revision: 'override-r1' }])));
    try {
      await controller.loadCatalog();
      assert.equal(controller.importText(imported), true);
      controller.updateForm('general', { output: { maxTokens: 5000 } });
      controller.setModelMode('general', 'auto');
      controller.addCandidate('general');
      assert.equal(controller.getSnapshot().drafts.general.text, imported);
      await controller.loadCatalog();
      assert.equal(controller.getSnapshot().drafts.general.text, imported);
      assert.equal((await controller.save('general')).ok, false);
      assert.equal(calls.at(-1).payload.text, imported);
      assert.equal(calls.at(-1).payload.expectedRevision, 'override-r1');
      assert.equal(controller.getSnapshot().drafts.general.text, imported);
    } finally { controller.dispose(); }
  }
});

test('preview facts keep declared metadata, authorization and validated output independent', () => {
  const declaration = { configuredSelection: { provider: 'p', model: 'm', maxTokens: 4096 }, model: { provider: 'p', id: 'm', contextWindow: 100000 }, authorization: { status: 'unknown' }, output: { configuredMaxTokens: 4096, effectiveMaxTokens: 4096, source: 'candidate', validated: false }, capacity: { kind: 'configured', assemblyChecked: false } };
  let facts = clone(plugin.previewFacts(declaration, ''));
  assert.deepEqual(facts.authorization, { status: 'unknown' });
  assert.equal(facts.configuredSelection.model, 'm');
  assert.equal(facts.output.configuredMaxTokens, 4096);
  assert.equal(facts.output.validated, false);
  assert.equal(facts.capacity.kind, 'configured');
  assert.equal(facts.capacity.assemblyChecked, false);
  facts = clone(plugin.previewFacts({ ...declaration, authorization: { status: 'denied', message: 'Route denied' } }, 'session-a'));
  assert.deepEqual(facts.authorization, { status: 'denied', message: 'Route denied' });
  assert.equal(facts.configuredSelection.model, 'm');
  assert.equal(facts.output.validated, false);
  facts = clone(plugin.previewFacts({ ...declaration, authorization: { status: 'authorized' }, output: { configuredMaxTokens: 4096, effectiveMaxTokens: 3000, source: 'candidate', validated: true }, capacity: { kind: 'validated-parameters', assemblyChecked: false } }, 'session-a'));
  assert.equal(facts.output.effectiveMaxTokens, 3000);
  assert.equal(facts.output.validated, true);
  assert.equal(facts.capacity.assemblyChecked, false);
  assert.equal(plugin.previewFacts({ authorization: { status: 'authorized' } }, '').authorization.status, 'unknown');
  assert.equal(plugin.previewFacts(null, 'session-a').authorization.status, 'unknown');
  assert.equal(plugin.previewFacts(null, 'session-a').output.validated, false);
});

test('candidate preview sends the saved revision and ignores obsolete candidate responses', async () => {
  const stale = deferred();
  const agent = autoRole();
  const { controller, calls } = harness(call => call.endpoint === 'agentdeck.catalog' ? ok(catalog([], [agent])) : call.payload.candidateId === 'fast' ? stale.promise : ok({ agent, candidateId: call.payload.candidateId }));
  try {
    await controller.loadCatalog();
    const old = controller.loadPreview('general');
    controller.selectPreviewCandidate('general', 'deep');
    assert.equal((await controller.loadPreview('general')).ok, true);
    stale.resolve(ok({ agent, candidateId: 'fast' }));
    assert.equal((await old).aborted, true);
    assert.deepEqual(calls.filter(call => call.endpoint === 'agentdeck.preview').map(call => call.payload), [{ id: 'general', revision: 'factory-r1', candidateId: 'fast' }, { id: 'general', revision: 'factory-r1', candidateId: 'deep' }]);
    assert.equal(controller.getSnapshot().preview.candidateId, 'deep');
    assert.equal(controller.getSnapshot().drafts.general.form.model.defaultCandidate, 'fast');
  } finally { controller.dispose(); }
});

test('role details use current preview readiness without changing catalog or accepting another revision', () => {
  const agent = { ...general, available: false, unverifiedCapabilities: ['browser-observe'], browserSupport: { backend: 'bsk', state: 'unverified' } };
  const ready = { ...agent, available: true, unverifiedCapabilities: [], browserSupport: { backend: 'bsk', state: 'ready' } };
  const shown = plugin.roleView(agent, { agent: ready });
  assert.equal(shown.available, true);
  assert.equal(shown.browserSupport.state, 'ready');
  assert.deepEqual(shown.unverifiedCapabilities, []);
  assert.equal(agent.browserSupport.state, 'unverified', 'Cheap list evidence stays separate from the live preview');
  assert.equal(plugin.roleView(agent, null), agent);
  assert.equal(plugin.roleView(agent, { agent: { ...ready, revision: 'obsolete' } }), agent);
  assert.equal(plugin.roleView(agent, { agent: { ...ready, id: 'other-role' } }), agent);
  assert.equal(plugin.roleView(undefined, { agent: ready }), undefined);
});

test('client imports only host React, and every CSS color uses native aliases', () => {
  assert.deepEqual([...source.matchAll(/require\(['"]([^'"]+)['"]\)/g)].map(match => match[1]), ['react']);
  assert.equal(/\bfetch\s*\(/.test(source), false);
  assert.equal(/response\.result/.test(source), false);
  assert.equal(/#[0-9a-f]{3,8}\b/i.test(source), false);
  assert.equal(/(?:rgba?|hsla?)\(/.test(source), false);
  assert.match(source, /controller\.dispose\(\)/);
  assert.match(source, /fileReader\.current\?\.abort\(\)/);
});
