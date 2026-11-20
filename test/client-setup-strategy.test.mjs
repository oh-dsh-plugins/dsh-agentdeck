import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import { loadBuiltinAgents } from '../lib/core/index.js';

// State and visible-content proof with a host React element recorder; browser QA is separate.
const source = (await readFile(new URL('../lib/client.js', import.meta.url), 'utf8'))
  .replace('createController, definitionText,', 'SuggestionPanel, ModelTransfer, ErrorNotice, DiagnosticList, createController, definitionText,');
const React = { Fragment: 'fragment', createElement(type, props, ...children) {
  return typeof type === 'function' ? type({ ...props, children }) : { type, props: props || {}, children: children.flat(Infinity).filter(value => value !== null && value !== false && value !== undefined) };
} };
let registration;
vm.runInNewContext(source, { window: { __ModuleLoader__: { load(value) { registration = value; } } }, AbortController, TextEncoder, setTimeout, clearTimeout });
const plugin = registration.factory(() => React);
const clone = value => JSON.parse(JSON.stringify(value));
const ok = value => ({ ok: true, value });
const generator = { provider: 'g', model: 'suggestion-model' };
const base = { ...loadBuiltinAgents().find(role => role.id === 'reader'), revision: 'reader-r1', model: { mode: 'fixed', provider: '', model: '' }, reasoning: { mode: 'model-default' } };
const fixed = { id: 'reader', revision: base.revision, mode: 'fixed', model: { mode: 'fixed', provider: 'p', model: 'execution' }, reasoning: { mode: 'fixed', effort: 'high' }, reason: 'Read the requested evidence.', generator };
function harness(responder = () => ok(fixed), role = base) {
  const calls = [];
  const controller = plugin.createController({ rpc: { call(_channel, endpoint, payload, signal) {
    const call = { endpoint, payload: clone(payload), signal }; calls.push(call);
    if (endpoint === 'agentdeck.catalog') return ok({ agents: [clone(role)], overrides: [], diagnostics: [], sessions: [], runtime: {} });
    if (endpoint === 'agentdeck.models') return ok({ providers: [{ id: 'g', name: 'Generator' }], models: [{ id: 'suggestion-model', name: 'Suggestion' }], diagnostics: [] });
    return responder(call);
  } } });
  return { calls, controller };
}
function deferred() { let resolve; return { promise: new Promise(done => { resolve = done; }), resolve: value => resolve(value) }; }
const t = (key, values = {}) => {
  assert.ok(Object.hasOwn(plugin.dictionaries.en, key), 'Missing visible locale ' + key);
  return plugin.dictionaries.en[key].replace(/[{]([^}]+)[}]/g, (_, name) => values[name] ?? name);
};
function nodes(node) { return !node || typeof node !== 'object' ? [] : [node, ...(node.children || []).flatMap(nodes)]; }
function text(node) { return !node || typeof node !== 'object' ? String(node ?? '') : (node.children || []).map(text).join(' '); }
async function prepare(f) { await f.controller.loadCatalog(); f.controller.updateSuggestion('reader', { generator, requirements: 'Keep this role focused.', open: true }); }

for (const mode of ['fixed', 'auto']) test('clicking the AI suggestion entry renders its controls in ' + mode + ' mode', async () => {
  const role = { ...base, model: mode === 'auto' ? { mode, candidates: [], defaultCandidate: '' } : base.model };
  const f = harness(undefined, role);
  const render = () => {
    const state = f.controller.getSnapshot();
    return plugin.SuggestionPanel({ state, controller: f.controller, id: 'reader', draft: state.drafts.reader, t, disabled: false });
  };
  try {
    await f.controller.loadCatalog();
    nodes(render()).find(node => node.type === 'button' && text(node) === t('suggestOpen')).props.onClick();
    assert.equal(f.controller.getSnapshot().suggestions.reader.open, true);
    assert.equal(f.controller.getSnapshot().suggestions.reader.candidatePlan, 'auto');
    const view = render();
    assert.equal(view?.type, 'section', 'Opening must return the whole configuration panel before a result exists');
    for (const name of ['provider', 'model', 'requirements']) {
      assert.ok(nodes(view).some(node => node.props.id === 'agentdeck-reader-suggest-' + name), 'Missing visible ' + name + ' control');
    }
    assert.equal(nodes(view).some(node => node.props.id === 'agentdeck-reader-suggest-candidate-plan'), mode === 'auto');
    assert.ok(nodes(view).some(node => node.type === 'button' && node.props.disabled && text(node) === t('suggestGenerate')));
    assert.equal(f.calls.some(call => call.endpoint === 'agentdeck.suggest'), false);
    nodes(view).find(node => node.type === 'button' && text(node) === t('close')).props.onClick();
    assert.match(text(render()), new RegExp(t('suggestOpenTitle')));
  } finally { f.controller.dispose(); }
});

test('suggestion generation keeps waiting and failure feedback visible without a result', async () => {
  const pending = deferred();
  const f = harness(() => pending.promise);
  const render = () => {
    const state = f.controller.getSnapshot();
    return plugin.SuggestionPanel({ state, controller: f.controller, id: 'reader', draft: state.drafts.reader, t, disabled: false });
  };
  try {
    await prepare(f);
    const work = nodes(render()).find(node => node.type === 'button' && text(node) === t('suggestGenerate')).props.onClick();
    assert.ok(nodes(render()).some(node => node.type === 'button' && node.props.disabled && text(node) === t('suggestGenerating')));
    pending.resolve({ ok: false, error: { code: 'AGENTDECK_SUGGESTION_FAILED', message: 'HTTP 429 quota exceeded', details: { stage: 'generation', ...generator } } });
    await work;
    const view = render();
    assert.ok(nodes(view).some(node => node.props.role === 'alert' && text(node).includes('HTTP 429 quota exceeded')));
    assert.match(text(view), /suggestion-model/);
    assert.ok(nodes(view).some(node => node.type === 'button' && !node.props.disabled && text(node) === t('suggestGenerate')));
  } finally { f.controller.dispose(); }
});

test('fixed AI suggestion is Session-independent and only adoption changes the role draft', async () => {
  const f = harness();
  try {
    await prepare(f);
    const original = clone(f.controller.getSnapshot().drafts.reader.form);
    assert.equal((await f.controller.generateSuggestion('reader')).ok, true);
    const call = f.calls.find(value => value.endpoint === 'agentdeck.suggest');
    assert.equal(Object.hasOwn(call.payload, 'sessionId'), false);
    assert.deepEqual(call.payload.generator, generator);
    assert.equal(call.payload.definition.model.mode, 'fixed');
    assert.deepEqual(clone(f.controller.getSnapshot().drafts.reader.form), original);
    assert.equal(f.calls.some(value => value.endpoint === 'agentdeck.save'), false);
    assert.equal(f.controller.adoptSuggestion('reader'), true);
    const draft = clone(f.controller.getSnapshot().drafts.reader.form);
    assert.deepEqual(draft.model, fixed.model);
    assert.deepEqual(draft.reasoning, fixed.reasoning);
    for (const field of ['instructions', 'capabilities', 'skills', 'scripts', 'enabled']) assert.deepEqual(draft[field], original[field]);
    assert.equal(draft.schemaVersion, 3);
    assert.equal(Object.hasOwn(draft, 'context'), false);
    assert.equal(Object.hasOwn(draft, 'output'), false);
  } finally { f.controller.dispose(); }
});

test('auto suggestion works with an unfinished seed and switching modes uses the default candidate', async () => {
  const role = { ...base, model: { mode: 'auto', candidates: [], defaultCandidate: '' } };
  const result = { ...fixed, mode: 'auto', reasoning: { mode: 'model-default' }, model: { mode: 'auto', candidates: [{ id: 'primary', purpose: 'Read evidence.', ...fixed.model, mode: undefined, reasoning: fixed.reasoning }], defaultCandidate: 'primary' } };
  delete result.model.candidates[0].mode;
  const f = harness(() => ok(result), role);
  try {
    await prepare(f); f.controller.updateSuggestion('reader', { candidatePlan: 'multiple' }); assert.equal((await f.controller.generateSuggestion('reader')).ok, true);
    assert.equal(f.calls.find(value => value.endpoint === 'agentdeck.suggest').payload.candidatePlan, 'multiple');
    assert.equal(f.controller.adoptSuggestion('reader'), true);
    f.controller.setModelMode('reader', 'fixed');
    assert.deepEqual(clone(f.controller.getSnapshot().drafts.reader.form.model), fixed.model);
    assert.deepEqual(clone(f.controller.getSnapshot().drafts.reader.form.reasoning), fixed.reasoning);
    f.controller.setModelMode('reader', 'inherit');
    assert.deepEqual(clone(f.controller.getSnapshot().drafts.reader.form.model), { mode: 'inherit' });
    assert.deepEqual(clone(f.controller.getSnapshot().drafts.reader.form.reasoning), { mode: 'inherit-compatible' });
  } finally { f.controller.dispose(); }
});

for (const action of ['edit', 'discard', 'requirements', 'mode', 'catalog']) test('late suggestion cannot overwrite a changed ' + action, async () => {
  const pending = deferred(); const f = harness(() => pending.promise);
  try {
    await prepare(f); const work = f.controller.generateSuggestion('reader');
    if (action === 'edit') f.controller.edit('reader', 'unsaved raw YAML');
    if (action === 'discard') f.controller.discard('reader');
    if (action === 'requirements') f.controller.updateSuggestion('reader', { requirements: 'New task requirement' });
    if (action === 'mode') f.controller.setModelMode('reader', 'inherit');
    if (action === 'catalog') { base.revision = 'reader-r2'; await f.controller.loadCatalog(); }
    const before = clone(f.controller.getSnapshot().drafts.reader);
    pending.resolve(ok(fixed)); await work;
    assert.deepEqual(clone(f.controller.getSnapshot().drafts.reader), before);
    assert.equal(f.controller.getSnapshot().suggestions.reader.result, undefined);
  } finally { base.revision = 'reader-r1'; f.controller.dispose(); }
});

test('dirty raw YAML blocks adoption and marks an earlier result stale', async () => {
  const f = harness();
  try {
    await prepare(f); await f.controller.generateSuggestion('reader');
    f.controller.edit('reader', 'keep my raw text');
    assert.equal(f.controller.suggestionCurrent('reader'), false);
    assert.equal(f.controller.adoptSuggestion('reader'), false);
    assert.equal(f.controller.getSnapshot().drafts.reader.text, 'keep my raw text');
  } finally { f.controller.dispose(); }
});

test('visible suggestion result has reason and settings; provider errors show their actual cause', async () => {
  const f = harness();
  try {
    await prepare(f); await f.controller.generateSuggestion('reader');
    const state = f.controller.getSnapshot();
    const view = plugin.SuggestionPanel({ state, controller: f.controller, id: 'reader', draft: state.drafts.reader, t, disabled: false });
    assert.match(text(view), /Read the requested evidence/);
    assert.match(text(view), /p *[/] *execution/);
    assert.ok(nodes(view).some(node => node.type === 'button' && !node.props.disabled && text(node).includes(plugin.dictionaries.en.suggestAdopt)));
    const failure = plugin.ErrorNotice({ value: { code: 'AGENTDECK_SUGGESTION_FAILED', message: 'HTTP 429 quota exceeded', details: { stage: 'generation', ...generator, rawResponse: '{partial' } }, t });
    assert.match(text(failure), /HTTP 429 quota exceeded/);
    assert.match(text(failure), /suggestion-model/);
    assert.match(text(plugin.DiagnosticList({ items: ['Provider list timed out'], t })), /Provider list timed out/);
  } finally { f.controller.dispose(); }
});

test('portable export panel selects saved roles and disables an empty download', async () => {
  const f = harness();
  const render = () => plugin.ModelTransfer({ state: f.controller.getSnapshot(), controller: f.controller, t, locale: { resolveText: value => value.en || value }, download() {} });
  try {
    await f.controller.loadCatalog(); f.controller.openModelExport();
    assert.ok(text(render()).includes(t('transferExportHint')));
    assert.equal(nodes(render()).find(node => node.type === 'button' && text(node) === t('transferDownload')).props.disabled, false);
    nodes(render()).find(node => node.type === 'button' && text(node) === t('transferSelectNone')).props.onClick();
    assert.equal(nodes(render()).find(node => node.type === 'button' && text(node) === t('transferDownload')).props.disabled, true);
  } finally { f.controller.dispose(); }
});

test('portable import panel exposes candidate mapping and explicit default before skipping', async () => {
  const f = harness();
  const render = () => plugin.ModelTransfer({ state: f.controller.getSnapshot(), controller: f.controller, t, locale: { resolveText: value => value.en || value }, download() {} });
  try {
    await f.controller.loadCatalog();
    const candidate = id => ({ id, purpose: 'Read evidence.', provider: 'g', model: 'suggestion-model', reasoning: { mode: 'model-default' } });
    f.controller.importModels(JSON.stringify({ format: 'dsh-agentdeck-models', version: 1, roles: [{ id: 'reader', model: { mode: 'auto', candidates: [candidate('one'), candidate('two')], defaultCandidate: 'one' }, reasoning: { mode: 'model-default' } }] }));
    for (let i = 0; i < 20 && f.controller.getSnapshot().transfer.checking; i++) await Promise.resolve();
    const view = render();
    assert.ok(text(view).includes(t('defaultCandidate')));
    assert.ok(text(view).includes(t('defaultEffort')));
    assert.ok(text(view).includes(t('transferRemoveDefaultHint')));
    const skips = nodes(view).filter(node => node.type === 'button' && text(node) === t('transferRemoveCandidate'));
    assert.equal(skips.length, 2);
    assert.equal(skips[0].props.disabled, true);
    assert.equal(skips[1].props.disabled, false);
    skips[1].props.onClick();
    assert.equal(f.controller.getSnapshot().transfer.rows[0].config.model.candidates.length, 1);
    assert.equal(nodes(render()).find(node => node.type === 'button' && text(node) === t('transferAdopt')).props.disabled, true);
  } finally { f.controller.dispose(); }
});

test('portable import renders structured provider names as text options', async () => {
  const f = harness();
  const render = () => plugin.ModelTransfer({ state: f.controller.getSnapshot(), controller: f.controller, t, locale: { resolveText: value => value.en || value }, download() {} });
  try {
    await f.controller.loadCatalog();
    f.controller.set({
      providers: [{ id: 'g', name: { id: 'g', name: 'Generator' } }], providersLoaded: true,
      modelOptions: { g: [{ id: 'suggestion-model', name: { id: 'suggestion-model', name: 'Suggestion' } }] },
      modelMetadata: { ['modelMetadata:' + JSON.stringify(['g', 'suggestion-model'])]: { models: [{ provider: 'g', id: 'suggestion-model', metadataResolved: true, efforts: [{ id: 'high', name: { id: 'high', name: 'High' } }] }] } },
    });
    const candidate = { id: 'one', purpose: 'Read evidence.', provider: 'g', model: 'suggestion-model', reasoning: { mode: 'model-default' } };
    f.controller.importModels(JSON.stringify({ format: 'dsh-agentdeck-models', version: 1, roles: [{ id: 'reader', model: { mode: 'auto', candidates: [candidate], defaultCandidate: 'one' }, reasoning: { mode: 'model-default' } }] }));
    for (let i = 0; i < 20 && f.controller.getSnapshot().transfer.checking; i++) await Promise.resolve();
    const options = nodes(render()).filter(node => node.type === 'option');
    assert.ok(options.length > 0);
    assert.ok(options.every(node => node.children.every(child => typeof child === 'string')));
    const high = options.find(node => node.props.value === JSON.stringify({ mode: 'fixed', effort: 'high' }));
    assert.ok(high, 'A structured effort option must submit its native ID, not its display label');
    const effort = nodes(render()).find(node => node.type === 'select' && node.props.value === JSON.stringify({ mode: 'model-default' }));
    effort.props.onChange({ target: { value: high.props.value } });
    const row = f.controller.getSnapshot().transfer.rows[0];
    assert.deepEqual(clone(row.config.model.candidates[0].reasoning), { mode: 'fixed', effort: 'high' });
    assert.equal(f.controller.transferIssue(row), '');
  } finally { f.controller.dispose(); }
});
