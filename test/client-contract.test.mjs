import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import { parse } from 'yaml';
import { parseOverrideText } from '../lib/core/index.js';
import { applyDefinitionActions } from '../lib/host/setup.js';

const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8');
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
  schemaVersion: 3, id: 'general', title: { en: 'General', zh: '通用' },
  description: { en: 'General tasks', zh: '通用任务' }, instructions: 'Preserve task authorization.',
  capabilities: ['files-read'], skills: [], scripts: [], inputs: ['Task'], deliverables: ['Report'],
  model: { mode: 'inherit' }, reasoning: { mode: 'inherit-compatible' },
  enabled: true,
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
    if (endpoint === 'agentdeck.inspectDefinition') {
      try { return ok({ id: parseOverrideText(payload.text).id }); }
      catch (error) { return { ok: false, error: { message: error.message } }; }
    }
    const response = responder(call, calls.length);
    if (endpoint !== 'agentdeck.previewChange') return response;
    return Promise.resolve(response).then(value => {
      const preview = value?.ok && value.value;
      if (preview && typeof preview.impactRevision === 'string' && (typeof preview.text === 'string' || preview.reset === true)) return value;
      if (!value?.ok) return value;
      const snapshot = controller.getSnapshot();
      const role = snapshot.catalog?.agents.find(item => item.id === payload.id);
      const stored = snapshot.catalog?.overrides.find(item => item.id === payload.id);
      const text = payload.actions ? applyDefinitionActions(stored?.text, role, payload.actions) : payload.text;
      return ok({ id: payload.id, ...(payload.reset ? { reset: true } : { text }), impacts: [], impactRevision: 'compat-' + payload.id });
    });
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
    : call.endpoint === 'agentdeck.previewChange'
      ? ok({ id: 'general', text, impacts: [], impactRevision: 'change-r1' })
      : { ok: false, error: { code: 'CONFLICT', message: 'Override changed' } });
  await controller.loadCatalog();
  controller.edit('general', text);
  const answer = await controller.save('general');
  assert.equal(answer.ok, false);
  assert.equal(controller.getSnapshot().drafts.general.text, text);
  assert.equal(controller.getSnapshot().drafts.general.expectedRevision, 'override-r1');
  assert.equal(controller.getSnapshot().errors.save.code, 'CONFLICT');
  assert.deepEqual(calls.at(-1).payload, { id: 'general', text, expectedRevision: 'override-r1', impactRevision: 'change-r1', acceptedIndirectRoles: [] });
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
  const started = deferred();
  let saved = false;
  const first = 'id: general\nenabled: false\n';
  const later = first + 'instructions: Keep this later edit\n';
  const { controller } = harness(call => {
    if (call.endpoint === 'agentdeck.save') { started.resolve(); return pending.promise; }
    return ok(saved ? catalog([{ id: 'general', text: first, revision: 'override-r2' }]) : catalog());
  });
  await controller.loadCatalog();
  controller.edit('general', first);
  const saving = controller.save('general');
  await started.promise;
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
  assert.equal(controller.getSnapshot().drafts.general.form.enabled, false);
  assert.equal(parse(await controller.materializeDraft('general')).enabled, false);
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
  assert.deepEqual(JSON.parse(call.payload.text), { schemaVersion: 3, id: 'project-reader', extends: 'general' });
  assert.equal('expectedRevision' in call.payload, false);
  controller.dispose();
});

test('import updates an existing role with its override revision and preserves other drafts', async () => {
  const { controller, calls } = harness(call => call.endpoint === 'agentdeck.save'
    ? ok({ ...call.payload, revision: 'override-r2' })
    : ok(catalog([{ id: 'general', revision: 'override-r1', text: 'id: general\n' }])));
  await controller.loadCatalog();
  const text = 'schemaVersion: 1\nid: general\nenabled: false\n';
  assert.equal(await controller.importText(text), true);
  assert.equal(controller.useExistingDocument(), true);
  assert.equal(controller.getSnapshot().creating, false);
  assert.equal(controller.getSnapshot().selectedId, 'general');
  assert.equal(controller.getSnapshot().drafts.general.text, text);
  await controller.save('general');
  assert.equal(calls.find(call => call.endpoint === 'agentdeck.save').payload.expectedRevision, 'override-r1');
  controller.edit('general', 'id: general\ninstructions: keep\n');
  assert.equal(await controller.importText(text), true);
  assert.equal(controller.useExistingDocument(), false);
  assert.equal(controller.getSnapshot().drafts.general.text, 'id: general\ninstructions: keep\n');
  assert.equal(await controller.importText('x'.repeat(1024 * 1024 + 1)), false);
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
  assert.equal(await controller.importText('id: other-role\nextends: general\n'), false);
  assert.equal(controller.getSnapshot().drafts['@new'].text, draft);
  controller.dispose();
});

test('reset calls the Host and leaves the draft intact on failure', async () => {
  const { controller, calls } = harness(call => call.endpoint === 'agentdeck.catalog'
    ? ok(catalog([{ id: 'general', revision: 'override-r1', text: 'id: general\n' }]))
    : call.endpoint === 'agentdeck.previewChange'
      ? ok({ id: 'general', reset: true, impacts: [], impactRevision: 'reset-r1' })
      : { ok: false, error: { code: 'STORAGE', message: 'Store is read only' } });
  await controller.loadCatalog();
  controller.edit('general', 'id: general\nenabled: false\n');
  const before = controller.getSnapshot().drafts.general.text;
  assert.equal((await controller.reset('general')).ok, false);
  assert.equal(controller.getSnapshot().drafts.general.text, before);
  assert.deepEqual(calls.at(-1).payload, { id: 'general', expectedRevision: 'override-r1', impactRevision: 'reset-r1', acceptedIndirectRoles: [] });
  controller.dispose();
});

test('project preview is read-only until the draft is bound to the selected Session', async () => {
  const text = 'schemaVersion: 1\nid: general\nenabled: false\n';
  const { controller, calls } = harness(call => call.endpoint === 'agentdeck.save'
    ? ok({ id: call.payload.id, text: call.payload.text, revision: 'override-r2' })
    : ok(catalog([{ id: 'general', text: 'id: general\n', revision: 'override-r1' }])));
  controller.setSession('session-a');
  await controller.loadCatalog();
  controller.edit('general', text);
  assert.equal((await controller.save('general')).ok, false);
  assert.equal((await controller.reset('general')).ok, false);
  assert.ok(calls.every(call => call.endpoint === 'agentdeck.catalog'));
  assert.equal(controller.useProjectEdit('general'), true);
  controller.edit('general', text);
  controller.setSession('session-b');
  assert.equal((await controller.save('general')).ok, false);
  controller.setSession('session-a');
  await controller.loadCatalog();
  assert.equal((await controller.save('general')).ok, true);
  const save = calls.find(call => call.endpoint === 'agentdeck.save');
  assert.deepEqual(save.payload, { sessionId: 'session-a', id: 'general', text, expectedRevision: 'override-r1', impactRevision: 'compat-general', acceptedIndirectRoles: [] });
  assert.ok(calls.filter(call => call.endpoint === 'agentdeck.catalog').every(call => call.payload.sessionId === 'session-a'));
  controller.dispose();
});

test('deriving a project role includes the selected Session in the new-role save', async () => {
  const projectRole = { ...general, id: 'project-base', builtin: false };
  const { controller, calls } = harness(call => {
    if (call.endpoint === 'agentdeck.catalog') return ok(catalog([], [general, projectRole]));
    assert.equal(call.payload.sessionId, 'session-a', 'Derivation must use the same project catalog as the selected Session');
    if (call.endpoint === 'agentdeck.previewChange') return ok({ id: call.payload.id, text: call.payload.text, impacts: [], impactRevision: 'project-r1' });
    assert.equal(call.endpoint, 'agentdeck.save');
    return ok({ id: call.payload.id, text: call.payload.text, revision: 'custom-r1' });
  });
  controller.setSession('session-a');
  await controller.loadCatalog();
  controller.beginCreate('project-base');
  assert.equal(controller.getSnapshot().creating, false);
  assert.equal(controller.useProjectEdit('project-base'), true);
  controller.beginCreate('project-base');
  controller.setNewId('project-derived');
  assert.equal((await controller.save('@new')).ok, true);
  const save = calls.find(call => call.endpoint === 'agentdeck.save');
  assert.equal(save.payload.id, 'project-derived');
  assert.equal(save.payload.sessionId, 'session-a');
  assert.equal('expectedRevision' in save.payload, false);
  assert.deepEqual(JSON.parse(save.payload.text), { schemaVersion: 3, id: 'project-derived', extends: 'project-base' });
  controller.dispose();
});

test('reset includes the selected Session and keeps its revision check', async () => {
  const { controller, calls } = harness(call => call.endpoint === 'agentdeck.reset'
    ? ok({ id: call.payload.id, reset: true })
    : ok(catalog([{ id: 'general', text: 'id: general\n', revision: 'override-r1' }])));
  controller.setSession('session-a');
  await controller.loadCatalog();
  assert.equal(controller.useProjectEdit('general'), true);
  assert.equal((await controller.reset('general')).ok, true);
  const reset = calls.find(call => call.endpoint === 'agentdeck.reset');
  assert.deepEqual(reset.payload, { sessionId: 'session-a', id: 'general', expectedRevision: 'override-r1', impactRevision: 'compat-general', acceptedIndirectRoles: [] });
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
  const preview = { agent: general, effectiveSelection: { provider: 'actual', model: 'real-model', reasoningEffort: 'high' }, budget: { known: false, targetTokens: 24000, elasticTokens: 12000, headroomTokens: 0, diagnostics: ['Window unknown'] }, diagnostics: [] };
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
    totalCharacters: 11, resultRevision: 'revision-one', ...(call.payload.offset ? {} : { nextOffset: 5 }), limitations: ['Outcome not declared'],
  }));
  await controller.loadResult('child-a');
  assert.equal(controller.getSnapshot().result.status, 'idle');
  await controller.loadResult('child-a', true);
  assert.equal(controller.getSnapshot().result.rawText, 'firstsecond');
  assert.equal(calls[1].payload.offset, 5);
  assert.equal(calls[1].payload.resultRevision, 'revision-one');
  assert.equal(controller.getSnapshot().result.nextOffset, undefined);
  controller.dispose();
});

test('native stop pages stay separate from result text and share its revision', async () => {
  let revision = 'same';
  const { controller, calls } = harness(({ payload }) => {
    if (payload.section === 'nativeStop') return ok({
      childId: payload.childId, section: 'nativeStop', resultRevision: revision, totalCharacters: 10,
      rawText: payload.offset ? 'tail' : 'reason', ...(payload.offset ? {} : { nextOffset: 6 }),
    });
    return ok({ childId: payload.childId, status: 'failed', resultRevision: revision,
      rawText: payload.offset ? 'body' : '', totalCharacters: 4, nativeStopTruncated: true,
      ...(payload.childId === 'child-with-text' && !payload.offset ? { rawText: 'first', totalCharacters: 9, nextOffset: 5 } : {}),
    });
  });
  try {
    await controller.loadResult('child-with-text');
    await controller.loadNativeStop('child-with-text');
    await controller.loadResult('child-with-text', true);
    await controller.loadNativeStop('child-with-text');
    assert.equal(controller.getSnapshot().result.rawText, 'firstbody');
    assert.equal(controller.getSnapshot().result.nativeStopPage.rawText, 'reasontail');
    assert.equal(controller.getSnapshot().result.nativeStopPage.nextOffset, undefined);
    assert.deepEqual(calls.filter(call => call.payload.section === 'nativeStop').map(call => [call.payload.offset, call.payload.resultRevision]), [[0, 'same'], [6, 'same']]);
    await controller.loadResult('child-without-text');
    assert.equal(controller.getSnapshot().result.nativeStopPage, undefined);
    revision = 'changed';
    const stale = await controller.loadNativeStop('child-without-text');
    assert.equal(stale.error.code, 'AGENTDECK_RESULT_CHANGED');
    assert.equal(controller.getSnapshot().resultStale, true);
    await controller.loadResult('child-without-text');
    await controller.loadNativeStop('child-without-text');
    assert.equal(controller.getSnapshot().result.rawText, '');
    assert.equal(controller.getSnapshot().result.nativeStopPage.rawText, 'reason');
    controller.closeResult();
    assert.equal(controller.getSnapshot().result, null);
  } finally { controller.dispose(); }
});

test('a stale result page preserves loaded text and a first-page reload replaces it', async () => {
  let revision = 'old';
  const run = { id: 'run', childId: 'child-a', parentId: 'parent', phase: 'accepted', nativeStatus: 'running' };
  const { controller } = harness(call => call.endpoint === 'agentdeck.runs' ? ok({ runs: [run] }) : ok({
    childId: 'child-a', status: 'running', rawText: revision, resultRevision: revision,
    totalCharacters: 10, nextOffset: call.payload.offset ? undefined : revision.length,
  }));
  try {
    await controller.loadRuns();
    await controller.loadResult('child-a');
    assert.equal(controller.getSnapshot().runs[0].businessStatus, 'running');
    revision = 'new';
    const stale = await controller.loadResult('child-a', true);
    assert.equal(stale.error.code, 'AGENTDECK_RESULT_CHANGED');
    assert.equal(controller.getSnapshot().result.rawText, 'old');
    assert.equal(controller.getSnapshot().resultStale, true);
    assert.equal(controller.getSnapshot().runs[0].businessStatus, undefined);
    assert.equal(controller.getSnapshot().runs[0].businessStatusCheckedAt, undefined);
    await controller.loadResult('child-a');
    assert.equal(controller.getSnapshot().result.rawText, 'new');
    assert.equal(controller.getSnapshot().resultStale, false);
    assert.ok(controller.getSnapshot().runs[0].businessStatusCheckedAt);
    assert.equal(controller.getSnapshot().errors.result, null);
  } finally { controller.dispose(); }
});

test('historical run filters are independent and result detail backfills only observed status', async () => {
  const run = { id: 'run', childId: 'child', parentId: 'past-parent', phase: 'accepted', nativeStatus: 'not-resident' };
  const { controller, calls } = harness(call => call.endpoint === 'agentdeck.runs'
    ? ok({ runs: [run], parentIds: ['past-parent'] })
    : ok({ childId: 'child', status: 'finished-unverified', rawText: '', resultRevision: 'r1' }));
  try {
    controller.setSession('preview-session');
    controller.setRunParent('past-parent');
    await controller.loadRuns();
    assert.deepEqual(calls.map(call => call.payload), [{ parentId: 'past-parent' }]);
    assert.equal(controller.getSnapshot().runs[0].businessStatus, undefined);
    await controller.loadResult('child');
    assert.equal('sessionId' in calls.at(-1).payload, false);
    assert.equal(controller.getSnapshot().runs[0].businessStatus, 'finished-unverified');
    assert.ok(controller.getSnapshot().runs[0].businessStatusCheckedAt);
    await controller.loadRuns();
    assert.equal(controller.getSnapshot().runs[0].businessStatus, undefined);
    assert.equal(controller.getSnapshot().result, null);
  } finally { controller.dispose(); }
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
  const pending = deferred(), started = deferred();
  const f = deadlineHarness(call => {
    if (call.endpoint === 'agentdeck.catalog') return ok(catalog());
    if (call.endpoint === 'agentdeck.previewChange') return ok({ id: 'general', text: call.payload.text, impacts: [], impactRevision: 'change-r1' });
    started.resolve();
    return pending.promise;
  });
  await f.controller.loadCatalog();
  f.controller.edit('general', 'schemaVersion: 1\nid: general\nenabled: false\n');
  const saving = f.controller.save('general');
  await started.promise;
  assert.equal(f.timers.size, 0);
  pending.resolve({ ok: false, error: { message: 'fixture save failed' } });
  assert.equal((await saving).ok, false);
  assert.equal(f.calls.filter(call => call.endpoint === 'agentdeck.save').length, 1);
  assert.match(f.controller.getSnapshot().drafts.general.text, /enabled: false/);
  f.controller.dispose();
});

const candidate = (id, extra = {}) => ({ id, purpose: 'Use for ' + id, provider: 'provider-' + id, model: 'model-' + id, reasoning: { mode: 'model-default' }, ...extra });
const autoRole = () => ({ ...clone(general), schemaVersion: 3, model: { mode: 'auto', defaultCandidate: 'fast', candidates: [candidate('fast'), candidate('deep', { reasoning: { mode: 'fixed', effort: 'high' } })] }, reasoning: { mode: 'model-default' } });

test('new feature controls cannot overwrite raw v1 or v2 imports and preserve CAS on refresh', async () => {
  for (const role of [general, autoRole()]) {
    const imported = plugin.definitionText({ ...role, enabled: false });
    const { controller, calls } = harness(call => call.endpoint === 'agentdeck.save'
      ? { ok: false, error: { code: 'CONFLICT', message: 'Concurrent override' } }
      : call.endpoint === 'agentdeck.previewChange'
        ? ok({ id: 'general', text: call.payload.text, impacts: [], impactRevision: 'change-r1' })
        : ok(catalog([{ id: 'general', text: 'schemaVersion: 1\nid: general\n', revision: 'override-r1' }])));
    try {
      await controller.loadCatalog();
      assert.equal(await controller.importText(imported), true);
      assert.equal(controller.useExistingDocument(), true);
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

test('preview facts keep native recovery and Session authorization independent', () => {
  const preview = { configuredSelection: { provider: 'p', model: 'm' }, effectiveSelection: { provider: 'p', model: 'm', maxTokens: 3000 }, authorization: { status: 'authorized' }, recovery: { policy: 'native', contextWindow: 131072 } };
  const facts = plugin.previewFacts(preview, 'session-a');
  assert.deepEqual(clone(facts.recovery), preview.recovery);
  assert.deepEqual(clone(facts.effectiveSelection), preview.effectiveSelection);
  assert.equal(facts.authorization.status, 'authorized');
  assert.equal(plugin.previewFacts(preview, '').authorization.status, 'unknown');
  assert.equal(plugin.previewFacts(null, 'session-a').authorization.status, 'unknown');
  assert.equal(plugin.previewFacts(null, '').recovery.policy, 'native');
});

test('no-Session preview diagnostics become an informational hint while real diagnostics remain visible', () => {
  const session = 'Select a live Session to validate authorization and effective output parameters. Model declarations and configured capacity are not task admission.';
  const inherited = 'Select a live Session to resolve inherited model parameters.';
  assert.equal(plugin.previewNeedsSession([session]), true);
  assert.equal(plugin.previewNeedsSession([inherited]), true);
  assert.deepEqual(plugin.previewDiagnostics([session, 'Model declaration: provider unavailable', inherited]), ['Model declaration: provider unavailable']);
  assert.deepEqual(plugin.previewDiagnostics([session], 'session-a'), [session]);
  assert.deepEqual(plugin.previewDiagnostics(['Native parameter validation: invalid route']), ['Native parameter validation: invalid route']);
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

const browserRole = {
  ...general, id: 'ui-verifier', available: false, capabilitiesAvailable: false,
  authorization: { status: 'authorized' }, unverifiedCapabilities: ['browser-observe'],
  browserSupport: { backend: 'bsk', state: 'unverified' },
};
const readyBrowserPreview = { agent: {
  ...browserRole, available: true, capabilitiesAvailable: true, unverifiedCapabilities: [],
  browserSupport: { backend: 'bsk', state: 'ready' },
} };

for (const failure of ['error', 'timeout']) test(`refresh invalidates ready evidence when the new preview ends in ${failure}`, async () => {
  const late = deferred();
  let refreshing = false;
  const f = deadlineHarness(call => call.endpoint === 'agentdeck.catalog' ? ok(catalog([], [browserRole]))
    : !refreshing ? ok(clone(readyBrowserPreview))
      : failure === 'error' ? { ok: false, error: { code: 'PROBE_FAILED', message: 'Readiness probe failed' } } : late.promise);
  await f.controller.loadCatalog();
  await f.controller.loadPreview(browserRole.id);
  assert.equal(plugin.roleView(browserRole, f.controller.getSnapshot().preview, true).available, true);
  f.controller.edit(browserRole.id, 'unsaved draft');
  refreshing = true;
  const work = f.controller.refresh();
  if (failure === 'timeout') {
    for (let turn = 0; turn < 20 && !f.controller.getSnapshot().busy.preview; turn++) await Promise.resolve();
    assert.equal(f.controller.getSnapshot().busy.preview, true);
    f.expire();
  }
  await work;
  const state = f.controller.getSnapshot();
  assert.equal(state.errors.preview.code, failure === 'error' ? 'PROBE_FAILED' : 'requestTimeout');
  assert.equal(state.preview, null);
  const listed = plugin.roleView(state.catalog.agents[0], state.preview, true);
  assert.equal(listed.available, false);
  assert.equal(plugin.roleStatus(listed), 'capabilityUnknown');
  assert.equal(listed.browserSupport.state, 'unverified');
  assert.equal(state.catalog.agents.filter(agent => !plugin.roleView(agent, state.preview, true).available).length, 1);
  assert.equal(state.drafts[browserRole.id].text, 'unsaved draft');
  late.resolve(ok(clone(readyBrowserPreview)));
  await Promise.resolve();
  assert.equal(f.controller.getSnapshot().preview, null, 'Late preview output cannot restore stale readiness.');
  refreshing = false;
  await f.controller.loadPreview(browserRole.id);
  assert.equal(plugin.roleView(browserRole, f.controller.getSnapshot().preview, true).available, true);
  f.controller.dispose();
});

test('refresh cancels an older preview before waiting for the new catalog', async () => {
  const late = deferred();
  const nextCatalog = deferred();
  let refreshing = false;
  const { controller, calls } = harness(call => call.endpoint === 'agentdeck.catalog'
    ? refreshing ? nextCatalog.promise : ok(catalog([], [browserRole])) : late.promise);
  await controller.loadCatalog();
  const older = controller.loadPreview(browserRole.id);
  const previousCall = calls.at(-1);
  refreshing = true;
  const work = controller.refresh();
  assert.equal(previousCall.signal.aborted, true);
  late.resolve(ok(clone(readyBrowserPreview)));
  await older;
  assert.equal(controller.getSnapshot().preview, null);
  nextCatalog.resolve({ ok: false, error: { code: 'CATALOG_FAILED', message: 'Catalog unavailable' } });
  await work;
  assert.equal(controller.getSnapshot().preview, null);
  controller.dispose();
});

test('role badges distinguish authorization from capabilities and keep default authorization in the list', () => {
  const denied = { ...general, capabilitiesAvailable: true, available: false, authorization: { status: 'denied' }, configuredSelection: { provider: 'q', model: 'large' } };
  assert.equal(plugin.roleStatus(denied), 'modelDenied');
  const unknown = { ...denied, authorization: { status: 'unknown' } };
  assert.equal(plugin.roleStatus(unknown), 'authorizationUnknown');
  assert.equal(plugin.roleStatus(unknown, false, false), 'noSession');
  assert.equal(plugin.roleStatus({ ...unknown, unverifiedCapabilities: ['browser-observe'] }, false, false), 'capabilityUnknown');
  assert.equal(plugin.roleStatus({ ...denied, enabled: false }), 'disabled');
  assert.equal(plugin.roleStatus({ ...denied, authorization: { status: 'authorized' }, available: true }), 'available');
  const selectedCandidate = { ...denied, available: true, authorization: { status: 'authorized' }, configuredSelection: { provider: 'p', model: 'm' }, browserSupport: { state: 'ready' } };
  const listed = plugin.roleView(denied, { agent: selectedCandidate }, true);
  assert.equal(plugin.roleStatus(listed), 'modelDenied', 'An allowed alternate preview does not change the saved default badge.');
  assert.equal(listed.browserSupport.state, 'ready');
  assert.equal(listed.available, false);
  assert.equal(plugin.roleStatus(plugin.roleView(denied, { agent: selectedCandidate })), 'available');
  assert.equal(denied.configuredSelection.model, 'large');
});

test('a denied alternate preview labels the selected model while the authorized default stays available', () => {
  const agent = { ...general, available: true, capabilitiesAvailable: true, authorization: { status: 'authorized' }, configuredSelection: { provider: 'p', model: 'm' } };
  const candidate = { ...agent, available: false, authorization: { status: 'denied' }, configuredSelection: { provider: 'q', model: 'large' } };
  assert.equal(plugin.roleStatus(plugin.roleView(agent, { agent: candidate }), true), 'selectedModelDenied');
  assert.equal(plugin.roleStatus(plugin.roleView(agent, { agent: candidate }, true)), 'available');
  assert.equal(agent.configuredSelection.model, 'm');
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

test('per-role evidence survives switching roles and is cleared by catalog/context changes', async () => {
 const browser={...general,id:'ui-verifier',revision:'browser-1',authorization:{status:'authorized'},capabilitiesAvailable:false,available:false,unverifiedCapabilities:['browser-observe']};
 const live={...browser,capabilitiesAvailable:true,available:true,unverifiedCapabilities:[]};
 const {controller}=harness(call=>ok(call.endpoint==='agentdeck.preview'?{agent:live}:catalog([], [general,browser])));
 await controller.loadCatalog();await controller.loadPreview('ui-verifier');controller.select('general');
 let s=controller.getSnapshot();assert.equal(plugin.roleView(browser,s.evidence['ui-verifier'].preview,true).available,true);
 await controller.loadCatalog();assert.deepEqual(clone(controller.getSnapshot().evidence),{});
 controller.setSession('session-a');assert.deepEqual(clone(controller.getSnapshot().evidence),{});controller.dispose();
});
test('a failed explicit recheck removes the role cache immediately and cannot restore readiness', async () => {
 const pending=deferred(); let recheck=false;
 const {controller}=harness(call=>call.endpoint==='agentdeck.catalog'?ok(catalog([], [browserRole])):recheck?pending.promise:ok(clone(readyBrowserPreview)));
 try {
  await controller.loadCatalog(); await controller.loadPreview(browserRole.id);
  assert.equal(plugin.roleView(browserRole,controller.getSnapshot().evidence[browserRole.id].preview,true).available,true);
  recheck=true; const work=controller.loadPreview(browserRole.id);
  assert.equal(controller.getSnapshot().evidence[browserRole.id],undefined);
  pending.resolve({ok:false,error:{code:'PROBE_FAILED',message:'Probe unavailable'}}); await work;
  assert.equal(plugin.roleStatus(plugin.roleView(browserRole,controller.getSnapshot().evidence[browserRole.id]?.preview,true)),'capabilityUnknown');
 } finally { controller.dispose(); }
});
test('typed unknown single writes reconcile save and reset without resubmitting', async () => {
 for (const kind of ['save', 'reset']) {
  let committed = false;
  const text = 'schemaVersion: 1\nid: general\nenabled: false\n';
  const { controller, calls } = harness(call => {
   if (call.endpoint === 'agentdeck.catalog') return ok(catalog(committed ? (kind === 'save' ? [{ id: 'general', text, revision: 'override-r2' }] : []) : [{ id: 'general', text: 'id: general\n', revision: 'override-r1' }]));
   if (call.endpoint === 'agentdeck.previewChange') return ok(kind === 'save' ? { id: 'general', text, impacts: [], impactRevision: 'change-r1' } : { id: 'general', reset: true, impacts: [], impactRevision: 'change-r1' });
   committed = true;
   return { ok: false, error: { code: 'AGENTDECK_WRITE_OUTCOME_UNKNOWN', message: 'write outcome unknown' } };
  });
  try {
   await controller.loadCatalog();
   if (kind === 'save') controller.edit('general', text);
   const answer = await controller[kind]('general');
   assert.equal(answer.ok, false);
   assert.equal(answer.observed, true);
   assert.equal(calls.filter(call => call.endpoint === 'agentdeck.' + kind).length, 1);
   if (kind === 'save') assert.equal(controller.getSnapshot().drafts.general.expectedRevision, 'override-r2');
  } finally { controller.dispose(); }
 }
});

test('catalog reload clears both list evidence and the unchanged detail preview', async () => {
 const {controller}=harness(call=>ok(call.endpoint==='agentdeck.preview'?clone(readyBrowserPreview):catalog([], [browserRole])));
 try {
  await controller.loadCatalog();controller.select(browserRole.id);await controller.loadPreview(browserRole.id);
  assert.equal(controller.getSnapshot().preview.agent.available,true);
  await controller.loadCatalog();const state=controller.getSnapshot();
  assert.equal(state.preview,null);assert.deepEqual(clone(state.evidence),{});
  assert.equal(plugin.roleStatus(plugin.roleView(browserRole,state.preview)),plugin.roleStatus(plugin.roleView(browserRole,state.evidence[browserRole.id]?.preview,true)));
 } finally {controller.dispose();}
});
test('catalog reload rejects a delayed preview even when the role revision is unchanged', async () => {
 const pending=deferred();const {controller}=harness(call=>call.endpoint==='agentdeck.preview'?pending.promise:ok(catalog([], [browserRole])));
 try {
  await controller.loadCatalog();const work=controller.loadPreview(browserRole.id);await controller.loadCatalog();
  pending.resolve(ok(clone(readyBrowserPreview)));await work;
  assert.equal(controller.getSnapshot().preview,null);assert.deepEqual(clone(controller.getSnapshot().evidence),{});
 } finally {controller.dispose();}
});

const modelBundle = roles => JSON.stringify({ format: 'dsh-agentdeck-models', version: 1, roles });
const autoTransfer = {
  model: { mode: 'auto', defaultCandidate: 'large', candidates: [
    { id: 'small', purpose: 'Fast checks', provider: 'remote', model: 'old-small', reasoning: { mode: 'model-default' } },
    { id: 'large', purpose: 'Deep review', provider: 'remote', model: 'old-large', reasoning: { mode: 'fixed', effort: 'xhigh' } },
  ] }, reasoning: { mode: 'model-default' },
};
const localModelResponse = call => ok({ providers: [{ id: 'local', name: 'Local' }], diagnostics: [], models: call.payload.model ? [{ provider: 'local', id: call.payload.model, metadataResolved: call.payload.model !== 'missing', efforts: ['low', 'high'], inputModalities: ['text'], authorized: null }] : [] });
function transferSettled(controller) {
  if (!controller.getSnapshot().transfer?.checking) return Promise.resolve();
  return new Promise(resolve => {
    const dispose = controller.subscribe(() => { if (!controller.getSnapshot().transfer?.checking) { dispose(); resolve(); } });
  });
}

test('portable model bundles preserve candidate order and defaults and exclude non-model settings', () => {
  const input = { ...general, ...autoTransfer, instructions: 'PRIVATE', apiKey: 'SECRET', source: '/private/path', skills: ['private-skill'] };
  const text = plugin.modelTransfer.write([input]);
  const bundle = clone(plugin.modelTransfer.read('\uFEFF' + text));
  assert.deepEqual(bundle.roles, [{ id: 'general', ...autoTransfer }]);
  for (const excluded of ['PRIVATE', 'SECRET', '/private/path', 'private-skill', 'instructions']) assert.equal(text.includes(excluded), false);
  for (const invalid of [modelBundle([]), modelBundle([input, input]), JSON.stringify({ format: 'dsh-agentdeck-models', version: 2, roles: [input] }), '{', modelBundle([{ ...input, model: { ...autoTransfer.model, defaultCandidate: 'absent' } }])]) {
    assert.throws(() => plugin.modelTransfer.read(invalid), error => error.code === 'modelTransferInvalid');
  }
  assert.throws(() => plugin.modelTransfer.read(' '.repeat(1024 * 1024 + 1)), error => error.code === 'importTooLarge');
});

test('portable export selects saved role settings even when a local draft is dirty', async () => {
  const { controller, calls } = harness();
  try {
    await controller.loadCatalog();
    controller.updateForm('general', autoTransfer);
    controller.openModelExport();
    const packet = JSON.parse(controller.exportModels());
    assert.deepEqual(packet.roles, [{ id: 'general', model: general.model, reasoning: general.reasoning }]);
    controller.updateModelTransfer(0, { selected: false });
    assert.throws(() => controller.exportModels(), error => error.code === 'modelTransferInvalid');
    assert.equal(calls.some(call => call.endpoint === 'agentdeck.save'), false);
  } finally { controller.dispose(); }
});

test('portable import maps local routes and efforts, preserves role fields and stages without saving', async () => {
  const stored = 'schemaVersion: 3\nid: general\ninstructions: Keep my local instructions.\nenabled: false\n';
  const role = { ...general, instructions: 'Keep my local instructions.', enabled: false };
  const { controller, calls } = harness(call => call.endpoint === 'agentdeck.catalog' ? ok(catalog([{ id: 'general', text: stored, revision: 'saved-r1' }], [role])) : call.endpoint === 'agentdeck.models' ? localModelResponse(call) : ok({}));
  try {
    await controller.loadCatalog();
    assert.equal(controller.importModels(modelBundle([{ id: 'general', ...autoTransfer }])), true);
    await transferSettled(controller);
    assert.equal(controller.transferIssue(controller.getSnapshot().transfer.rows[0]), 'transferProviderMissing');
    controller.mapTransferRoute(0, 'small', { provider: 'local', model: 'small' });
    controller.mapTransferRoute(0, 'large', { provider: 'local', model: 'large' });
    await controller.loadModelMetadata('local', 'small'); await controller.loadModelMetadata('local', 'large');
    assert.equal(controller.transferIssue(controller.getSnapshot().transfer.rows[0]), 'transferEffortMissing');
    assert.equal(controller.getSnapshot().transfer.rows[0].config.model.candidates[1].reasoning.effort, 'xhigh', 'Mapping a model must not silently weaken reasoning');
    controller.mapTransferRoute(0, 'large', { reasoning: { mode: 'fixed', effort: 'high' } });
    assert.equal(await controller.previewModelTransfer(), true);
    const preview = calls.find(call => call.endpoint === 'agentdeck.previewChange');
    assert.equal(preview.payload.expectedRevision, 'saved-r1');
    assert.deepEqual(preview.payload.actions.map(action => action.path), [['schemaVersion'], ['model'], ['reasoning']]);
    assert.equal(controller.adoptModelTransfer(), true);
    const draft = controller.getSnapshot().drafts.general;
    assert.equal(draft.form.instructions, role.instructions);
    assert.equal(draft.form.enabled, false);
    assert.equal(parse(draft.text).instructions, role.instructions);
    assert.equal(draft.expectedRevision, 'saved-r1');
    assert.equal(draft.form.model.defaultCandidate, 'large');
    assert.deepEqual(clone(draft.form.model.candidates.map(item => [item.id, item.purpose, item.provider, item.model])), [['small', 'Fast checks', 'local', 'small'], ['large', 'Deep review', 'local', 'large']]);
    assert.equal(calls.some(call => call.endpoint === 'agentdeck.save'), false);
    assert.equal(controller.getSnapshot().transfer, null);
  } finally { controller.dispose(); }
});

test('portable import requires explicit missing-role mapping and rejects duplicate destinations', async () => {
  const { controller } = harness(call => call.endpoint === 'agentdeck.models' ? localModelResponse(call) : ok(catalog()));
  try {
    await controller.loadCatalog();
    controller.importModels(modelBundle([{ id: 'general', model: general.model, reasoning: general.reasoning }, { id: 'remote-custom', model: general.model, reasoning: general.reasoning }]));
    await transferSettled(controller);
    assert.equal(controller.getSnapshot().transfer.rows[1].selected, false);
    controller.updateModelTransfer(1, { targetId: 'general', selected: true });
    assert.equal(controller.transferIssue(controller.getSnapshot().transfer.rows[0]), 'transferDuplicateTarget');
    assert.equal(await controller.previewModelTransfer(), false);
    controller.updateModelTransfer(0, { selected: false });
    assert.equal(await controller.previewModelTransfer(), true);
    assert.equal(controller.adoptModelTransfer(), true);
  } finally { controller.dispose(); }
});

test('portable import protects all existing drafts and rejects changes made after preview', async () => {
  const second = { ...general, id: 'reviewer' };
  const { controller } = harness(call => call.endpoint === 'agentdeck.catalog' ? ok(catalog([], [general, second])) : call.endpoint === 'agentdeck.models' ? localModelResponse(call) : ok({}));
  try {
    await controller.loadCatalog();
    controller.importModels(modelBundle([general, second])); await transferSettled(controller);
    controller.updateForm('reviewer', { instructions: 'An unsaved local edit' });
    assert.equal(await controller.previewModelTransfer(), false);
    assert.equal(controller.transferIssue(controller.getSnapshot().transfer.rows[1]), 'transferDraftConflict');
    controller.discard('reviewer');
    assert.equal(await controller.previewModelTransfer(), true);
    const first = controller.getSnapshot().drafts.general;
    controller.updateForm('reviewer', { instructions: 'A newer edit after preview' });
    assert.equal(controller.adoptModelTransfer(), false);
    assert.equal(controller.getSnapshot().drafts.general, first, 'No selected row may be partially staged');
    assert.equal(controller.getSnapshot().drafts.reviewer.form.instructions, 'A newer edit after preview');
  } finally { controller.dispose(); }
});

test('portable import detects catalog revision conflicts and does not overwrite managed external roles', async () => {
  let revised = false;
  const { controller } = harness(call => call.endpoint === 'agentdeck.catalog' ? ok(catalog([], [{ ...general, revision: revised ? 'new-r2' : general.revision }])) : call.endpoint === 'agentdeck.models' ? localModelResponse(call) : ok({}));
  try {
    await controller.loadCatalog(); controller.importModels(modelBundle([general])); await transferSettled(controller);
    assert.equal(await controller.previewModelTransfer(), true);
    revised = true; await controller.loadCatalog();
    assert.equal(controller.adoptModelTransfer(), false);
    assert.equal(controller.transferIssue(controller.getSnapshot().transfer.rows[0]), 'transferChanged');
    controller.set({ catalog: catalog([], [{ ...general, source: 'shared:/local/team.yml' }]) });
    controller.updateModelTransfer(0, { targetId: 'general' });
    assert.equal(controller.transferIssue(controller.getSnapshot().transfer.rows[0]), 'transferSourceOwned');
  } finally { controller.dispose(); }
});

test('late import previews cannot reopen a closed panel or cross a Session boundary', async () => {
  for (const close of [controller => controller.set({ transfer: null }), controller => controller.setSession('session-a')]) {
    const pending = deferred();
    const { controller } = harness(call => call.endpoint === 'agentdeck.catalog' ? ok(catalog()) : call.endpoint === 'agentdeck.models' ? localModelResponse(call) : pending.promise);
    try {
      await controller.loadCatalog(); controller.importModels(modelBundle([general])); await transferSettled(controller);
      const original = controller.getSnapshot().drafts.general;
      const work = controller.previewModelTransfer(); close(controller);
      pending.resolve(ok({ id: 'general', text: 'id: general\n', impacts: [], impactRevision: 'late' }));
      assert.equal(await work, false);
      assert.equal(controller.getSnapshot().transfer, null);
      assert.equal(controller.getSnapshot().drafts.general, original);
      if (controller.getSnapshot().sessionId) assert.equal(controller.importModels(modelBundle([general])), false);
    } finally { controller.dispose(); }
  }
});

test('portable candidate skipping requires an explicit replacement default and keeps a nonempty pool', async () => {
  const { controller } = harness(call => call.endpoint === 'agentdeck.models' ? localModelResponse(call) : ok(catalog()));
  try {
    await controller.loadCatalog(); controller.importModels(modelBundle([{ id: 'general', ...autoTransfer }])); await transferSettled(controller);
    assert.equal(controller.removeTransferRoute(0, 'large'), false);
    assert.equal(controller.setTransferDefault(0, 'absent'), false);
    assert.equal(controller.setTransferDefault(0, 'small'), true);
    assert.equal(controller.removeTransferRoute(0, 'large'), true);
    assert.equal(controller.removeTransferRoute(0, 'small'), false);
    controller.mapTransferRoute(0, 'small', { provider: 'local', model: 'small' });
    await controller.loadModelMetadata('local', 'small');
    assert.equal(await controller.previewModelTransfer(), true);
    assert.equal(controller.adoptModelTransfer(), true);
    const model = controller.getSnapshot().drafts.general.form.model;
    assert.equal(model.defaultCandidate, 'small');
    assert.deepEqual(clone(model.candidates.map(item => [item.id, item.purpose])), [['small', 'Fast checks']]);
  } finally { controller.dispose(); }
});

test('failed local metadata recheck cannot reuse a previously valid import preview or cache', async () => {
  let failed = false;
  const role = { ...general, model: { mode: 'fixed', provider: 'local', model: 'example' }, reasoning: { mode: 'model-default' } };
  const { controller } = harness(call => call.endpoint === 'agentdeck.models' ? failed && call.payload.model ? { ok: false, error: { code: 'lookupFailed', message: 'Local model lookup failed' } } : localModelResponse(call) : ok(catalog()));
  try {
    await controller.loadCatalog(); controller.importModels(modelBundle([role])); await transferSettled(controller);
    assert.equal(await controller.previewModelTransfer(), true);
    failed = true; await controller.checkModelTransfer(true);
    assert.equal(controller.transferIssue(controller.getSnapshot().transfer.rows[0]), 'transferUnresolved');
    assert.equal(controller.adoptModelTransfer(), false);
    assert.equal(controller.getSnapshot().drafts.general.form.model.mode, 'inherit');
  } finally { controller.dispose(); }
});

test('portable route validation blocks unresolved, image-only and unsupported reasoning metadata', () => {
  const route = { provider: 'local', model: 'example', reasoning: { mode: 'fixed', effort: 'high' } };
  assert.equal(plugin.modelTransfer.routeIssue(route, { metadataResolved: false }), 'transferUnresolved');
  assert.equal(plugin.modelTransfer.routeIssue(route, { metadataResolved: true, inputModalities: ['image'] }), 'transferTextRequired');
  assert.equal(plugin.modelTransfer.routeIssue(route, { metadataResolved: true, inputModalities: ['text'], efforts: ['low'] }), 'transferEffortMissing');
  assert.equal(plugin.modelTransfer.routeIssue(route, { metadataResolved: true, inputModalities: ['text'], efforts: ['high'], authorized: false }), '', 'Importing preferences must remain separate from native Session authorization');
  assert.equal(plugin.modelTransfer.routeIssue(route, { metadataResolved: true, inputModalities: ['text'], efforts: [{ id: 'high', name: 'High' }] }), '', 'Structured native effort metadata must match by id');
});

test('portable preview failure cannot leak into a closed or replaced transfer panel', async () => {
  for (const replace of [controller => controller.set({ transfer: null }), controller => controller.openModelExport(), controller => controller.importModels(modelBundle([general]))]) {
    const pending = deferred();
    const { controller, calls } = harness(call => call.endpoint === 'agentdeck.catalog' ? ok(catalog()) : call.endpoint === 'agentdeck.models' ? localModelResponse(call) : pending.promise);
    try {
      await controller.loadCatalog(); controller.importModels(modelBundle([general])); await transferSettled(controller);
      const work = controller.previewModelTransfer();
      const previewCall = calls.find(call => call.endpoint === 'agentdeck.previewChange');
      replace(controller);
      pending.resolve({ ok: false, error: { code: 'oldPreviewFailed', message: 'An obsolete preview failed' } });
      assert.equal(await work, false);
      assert.equal(controller.getSnapshot().errors.transfer, null, 'An obsolete error must not appear in a different panel');
      assert.equal(previewCall.signal.aborted, true, 'Closing or replacing the panel must cancel its read');
    } finally { controller.dispose(); }
  }
});

test('portable transfer stays locked while a write receipt is pending', { timeout: 2000 }, async () => {
  const receipt = deferred();
  const second = { ...general, id: 'reviewer' };
  let catalogReads = 0;
  const { controller, calls } = harness(call => call.endpoint === 'agentdeck.catalog' ? ++catalogReads === 1 ? ok(catalog([], [general, second])) : receipt.promise : call.endpoint === 'agentdeck.models' ? localModelResponse(call) : call.endpoint === 'agentdeck.save' ? { ok: false, error: { code: 'AGENTDECK_WRITE_OUTCOME_UNKNOWN', message: 'write outcome unknown' } } : ok({}));
  try {
    await controller.loadCatalog();
    const config = { ...autoTransfer, model: { ...autoTransfer.model, candidates: autoTransfer.model.candidates.map(item => ({ ...item, provider: 'local', model: item.id, reasoning: { mode: 'model-default' } })) } };
    controller.importModels(modelBundle([{ id: 'general', ...config }])); await transferSettled(controller);
    assert.equal(await controller.previewModelTransfer(), true);
    controller.updateForm('reviewer', { enabled: false });
    const saving = controller.save('reviewer');
    await Promise.race([new Promise(resolve => {
      if (controller.getSnapshot().busy.changeReceipt) return resolve();
      const off = controller.subscribe(() => { if (controller.getSnapshot().busy.changeReceipt) { off(); resolve(); } });
    }), saving.then(answer => { throw new Error('Save completed before receipt: ' + JSON.stringify(answer)); })]);
    const transfer = controller.getSnapshot().transfer;
    const draft = controller.getSnapshot().drafts.general;
    const requestCount = calls.length;
    assert.equal(controller.importModels(modelBundle([general])), false);
    controller.updateModelTransfer(0, { selected: false });
    controller.mapTransferRoute(0, 'small', { model: 'another' });
    assert.equal(controller.setTransferDefault(0, 'small'), false);
    assert.equal(controller.removeTransferRoute(0, 'small'), false);
    await controller.checkModelTransfer(true);
    assert.equal(await controller.previewModelTransfer(), false);
    assert.equal(controller.adoptModelTransfer(), false);
    assert.equal(controller.getSnapshot().transfer, transfer, 'The ready import must remain unchanged while the receipt is pending');
    assert.equal(controller.getSnapshot().drafts.general, draft);
    assert.equal(calls.length, requestCount, 'Blocked transfer actions must not issue RPCs');
    receipt.resolve(ok(catalog([], [general, second])));
    await saving;
    assert.equal(controller.adoptModelTransfer(), true, 'The same ready preview can be adopted once the receipt completes');
  } finally { receipt.resolve(ok(catalog([], [general, second]))); controller.dispose(); }
});

test('reset readback only accepts absence in the bound project', async () => {
  for (const receiptProject of ['A','B']) {
    let reads = 0;
    const {controller} = harness(call => {
      if (call.endpoint === 'agentdeck.catalog') return ok({ ...catalog(++reads === 1 ? [{id:'general',text:'id: general',revision:'rev'}] : []), project: reads === 1 ? 'A' : receiptProject });
      if (call.endpoint === 'agentdeck.previewChange') return ok({id:'general',project:'A',reset:true,impacts:[],impactRevision:'preview'});
      return {ok:false,error:{code:'AGENTDECK_WRITE_OUTCOME_UNKNOWN',message:'unknown'}};
    });
    try {
      await controller.loadCatalog();
      const receipt = await controller.reset('general');
      assert.equal(receipt.observed, receiptProject === 'A');
      assert.equal(receipt.uncertain, receiptProject !== 'A');
    } finally { controller.dispose(); }
  }
});

test('history load more appends within the selected parent', async () => {
  const {controller,calls} = harness(({payload}) => ok(payload.cursor ? {runs:[{id:'old'}]} : {runs:[{id:'recent'}],nextCursor:'recent'}));
  try {
    controller.setRunParent('parent');
    await controller.loadRuns();
    await controller.loadRuns(true);
    assert.deepEqual(calls.at(-1).payload,{parentId:'parent',cursor:'recent'});
    assert.deepEqual(clone(controller.getSnapshot().runs.map(row=>row.id)), ['recent','old']);
    assert.equal(controller.getSnapshot().runCursor, undefined);
  } finally { controller.dispose(); }
});
