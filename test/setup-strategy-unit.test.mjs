import assert from 'node:assert/strict';
import test from 'node:test';
import { loadBuiltinAgents, validateAgent, parseOverrideText, resolveCatalog } from '../lib/core/index.js';
import { normalizeSetupStrategy, setupStrategyRoutes, recommendStrategyRole } from '../lib/host/setup.js';

// Exercise the compiled source, with declaration fixtures only. No model requests or storage writes.
const factory = loadBuiltinAgents().find(role => role.id === 'reader');
const role = (patch = {}) => validateAgent({ ...factory, ...patch });
const candidate = (id = 'fast', patch = {}) => ({ id, purpose: 'Read selected sources.', provider: 'p', model: id,
  reasoning: { mode: 'model-default' }, maxTokens: 1000, ...patch });
const auto = (candidates = [candidate()], defaultCandidate = candidates[0]?.id) => ({ mode: 'auto', candidates, defaultCandidate });
const fixed = (patch = {}) => ({ mode: 'fixed', provider: 'p', model: 'fast', ...patch });
const declaration = (id = 'fast', patch = {}) => ({ provider: 'p', id, metadataResolved: true, authorized: true,
  contextWindow: 32_768, defaultMaxTokens: 4000, efforts: [{ id: 'high' }], inputModalities: ['text', 'image'], ...patch });
const options = { scopePolicy: 'replace-selected', includeBrowser: true, capabilitiesMissing: false };
const override = text => ({ id: 'reader', text, revision: 'saved-revision', updatedAt: 1 });
const recommend = (r, strategy, models = [declaration()], opts = {}, saved) => recommendStrategyRole(r, saved, strategy, models, { ...options, ...opts });
const diagnostic = (row, code) => row.warnings.some(value => value.code === code);
function inert(row, status) {
  assert.equal(row.status, status); assert.equal(row.applicable, false);
  assert.equal(Object.hasOwn(row, 'proposedText'), false);
}

test('normalization supplies explicit defaults and only returns owner-selected routes', () => {
  assert.deepEqual(normalizeSetupStrategy(fixed()), { ...fixed(), reasoning: { mode: 'model-default' }, outputPolicy: { mode: 'preserve' } });
  assert.deepEqual(normalizeSetupStrategy({ mode: 'inherit' }), { mode: 'inherit', reasoning: { mode: 'inherit-compatible' }, outputPolicy: { mode: 'preserve' } });
  assert.deepEqual(setupStrategyRoutes({ mode: 'inherit' }), []);
  assert.deepEqual(setupStrategyRoutes(auto([candidate(), candidate('deep', { model: 'fast' })])), [{ provider: 'p', model: 'fast' }]);
});

test('normalization rejects mixed modes, illegal fields and incomplete candidate resources', () => {
  const invalid = [
    { mode: 'inherit', provider: 'p' }, { ...fixed(), candidates: [] }, { ...auto(), reasoning: { mode: 'model-default' } },
    { ...auto(), outputPolicy: { mode: 'clear' } }, auto([]), auto(Array.from({ length: 4 }, (_, i) => candidate(`route-${i}`))),
    auto([candidate(), candidate()]), auto([candidate()], 'absent'), auto([candidate('fast', { purpose: '' })]),
    auto([candidate('fast', { maxTokens: undefined })]), auto([candidate('fast', { reasoning: { mode: 'inherit-compatible' } })]),
    auto([candidate('fast', { reasoning: { mode: 'model-default', effort: 'high' } })]),
    fixed({ reasoning: { mode: 'inherit-compatible' } }), fixed({ reasoning: { mode: 'fixed' } }),
    fixed({ outputPolicy: { mode: 'preserve', maxTokens: 100 } }), fixed({ outputPolicy: { mode: 'set', maxTokens: 0 } }),
    fixed({ outputPolicy: { mode: 'clear', extra: true } }),
  ];
  for (const value of invalid) assert.throws(() => normalizeSetupStrategy(value), undefined, JSON.stringify(value));
});

test('existing inherit resources are an actual no-op, including a small current Session window', () => {
  const r = role({ model: { mode: 'inherit' }, reasoning: { mode: 'inherit-compatible' } });
  const row = recommend(r, { mode: 'inherit' }, [declaration('fast', { contextWindow: 8192 })], { parent: { provider: 'p', model: 'fast', maxTokens: 1000 } });
  inert(row, 'unchanged'); assert.deepEqual(row.after, row.before); assert.deepEqual(row.after.context, r.context);
});

test('explicit output clear is not suppressed by equal effective resources', () => {
  const r = role({ schemaVersion: 2, model: { mode: 'inherit' }, reasoning: { mode: 'inherit-compatible' } });
  const strategy = { mode: 'inherit', outputPolicy: { mode: 'clear' } };
  const row = recommend(r, strategy, []);
  assert.equal(row.status, 'changed'); assert.equal(parseOverrideText(row.proposedText).output, null);
  const repeated = recommend(r, strategy, [], {}, override(row.proposedText));
  inert(repeated, 'unchanged');
});

test('fill-unconfigured and protected ownership never emit pending writes', () => {
  const r = role();
  inert(recommend(r, fixed(), [], { scopePolicy: 'fill-unconfigured' }, override('schemaVersion: 1\nid: reader\n')), 'preserved');
  inert(recommend(role({ enabled: false }), fixed(), [], { scopePolicy: 'fill-unconfigured' }), 'preserved');
  inert(recommend(r, fixed(), [], { externalSource: '/owner/role.yml' }), 'preserved');
  inert(recommend(role({ capabilities: ['browser-observe'] }), auto(), [], { includeBrowser: false }), 'preserved');
});

test('non-auto to auto replaces the model, clears role resources, and retains unrelated YAML', () => {
  const saved = override('# keep root comment\nschemaVersion: 2\nid: derived-reader\nextends: reader\ninstructions:\n  append: Keep my custom rule\noutput:\n  maxTokens: 2000\n');
  const r = role({ id: 'derived-reader', extends: 'reader', schemaVersion: 2, model: { mode: 'fixed', provider: 'old', model: 'old' },
    reasoning: { mode: 'fixed', effort: 'high' }, output: { maxTokens: 2000 } });
  const row = recommend(r, auto(), [declaration()], {}, saved);
  assert.equal(row.status, 'changed'); assert.match(row.proposedText, /keep root comment/); assert.match(row.proposedText, /Keep my custom rule/);
  const patch = parseOverrideText(row.proposedText);
  assert.equal(patch.schemaVersion, 2); assert.equal(patch.extends, 'reader'); assert.deepEqual(patch.model, auto());
  assert.deepEqual(patch.reasoning, { mode: 'model-default' }); assert.equal(patch.output, null); assert.equal(row.after.output, undefined);
  const catalog = resolveCatalog([{ source: 'base', text: 'schemaVersion: 2\nid: reader\noutput: { maxTokens: 9000 }\n' }, { source: 'derived', text: row.proposedText }]);
  assert.deepEqual(catalog.diagnostics, []); assert.equal(catalog.agents.find(value => value.id === r.id).output, undefined);
});

test('an identical auto pool does not create a redundant override', () => {
  const r = role({ schemaVersion: 2, model: auto(), reasoning: { mode: 'model-default' } });
  inert(recommend(r, auto()), 'unchanged');
});

test('leaving auto is blocked until an explicit per-role migration is supplied', () => {
  const r = role({ schemaVersion: 2, model: auto([candidate('fast', { reasoning: { mode: 'fixed', effort: 'high' }, maxTokens: 6000 })]), reasoning: { mode: 'model-default' } });
  const blocked = recommend(r, fixed()); inert(blocked, 'blocked'); assert.ok(diagnostic(blocked, 'setup.migrationRequired'));
  inert(recommend(r, fixed(), [declaration()], { resourceMigration: { mode: 'candidate', candidateId: 'missing' } }), 'blocked');
  const copied = recommend(r, fixed(), [declaration()], { resourceMigration: { mode: 'candidate', candidateId: 'fast' } });
  assert.equal(copied.status, 'changed'); assert.deepEqual(copied.after.reasoning, { mode: 'fixed', effort: 'high' });
  assert.deepEqual(copied.after.output, { maxTokens: 6000 }); assert.deepEqual(parseOverrideText(copied.proposedText).model, fixed());
  const reset = recommend(r, { mode: 'inherit' }, [], { resourceMigration: { mode: 'reset' } });
  assert.equal(reset.status, 'changed'); assert.deepEqual(reset.after.reasoning, { mode: 'model-default' });
  assert.equal(parseOverrideText(reset.proposedText).output, null);
});

test('fixed route change resets effort by default and blocks unsupported explicit or migrated effort', () => {
  const r = role({ model: { mode: 'fixed', provider: 'old', model: 'old' }, reasoning: { mode: 'fixed', effort: 'high' } });
  const models = [declaration('fast', { efforts: [] })];
  assert.deepEqual(recommend(r, fixed(), models).after.reasoning, { mode: 'model-default' });
  const unsupported = recommend(r, fixed({ reasoning: { mode: 'fixed', effort: 'high' } }), models);
  inert(unsupported, 'blocked'); assert.ok(diagnostic(unsupported, 'setup.effortUnsupported'));
  const ar = role({ schemaVersion: 2, model: auto([candidate('fast', { reasoning: { mode: 'fixed', effort: 'high' } })]), reasoning: { mode: 'model-default' } });
  inert(recommend(ar, fixed(), models, { resourceMigration: { mode: 'candidate', candidateId: 'fast' } }), 'blocked');
});

test('every candidate declaration and effort is checked, not only the default', () => {
  const strategy = auto([candidate(), candidate('deep', { reasoning: { mode: 'fixed', effort: 'high' } })]);
  const missing = recommend(role(), strategy); inert(missing, 'blocked'); assert.ok(diagnostic(missing, 'setup.metadataMissing'));
  inert(recommend(role(), strategy, [declaration(), declaration('deep', { efforts: [] })]), 'blocked');
});

test('known candidate budgets clamp to minimum safe capacity; any known zero blocks', () => {
  const strategy = auto([candidate(), candidate('deep', { maxTokens: 2000 })]);
  const row = recommend(role({ context: { targetTokens: 16000, elasticTokens: 48000 } }), strategy,
    [declaration(), declaration('deep', { contextWindow: 16000 })]);
  assert.equal(row.status, 'changed'); assert.deepEqual(row.after.context, { targetTokens: 12976, elasticTokens: 12976 });
  const zero = recommend(role(), strategy, [declaration('fast', { contextWindow: undefined }), declaration('deep', { contextWindow: 2000 })]);
  inert(zero, 'blocked'); assert.ok(diagnostic(zero, 'setup.noCapacity'));
});

test('one unknown candidate budget preserves context rather than partially claiming safe capacity', () => {
  const r = role({ context: { targetTokens: 16000, elasticTokens: 48000 } });
  const row = recommend(r, auto([candidate(), candidate('deep')]), [declaration(), declaration('deep', { contextWindow: undefined })]);
  assert.equal(row.status, 'changed'); assert.deepEqual(row.after.context, r.context); assert.ok(diagnostic(row, 'setup.capacityUnknown'));
});

test('browser pools retain image candidates only and never silently choose a replacement default', () => {
  const r = role({ capabilities: ['browser-observe'] });
  const candidates = [candidate(), candidate('deep')];
  const models = [declaration(), declaration('deep', { inputModalities: ['text'] })];
  const row = recommend(r, auto(candidates), models);
  assert.equal(row.status, 'changed'); assert.equal(row.after.model.mode, 'auto'); assert.deepEqual(row.after.model.candidates, [candidate()]);
  assert.ok(diagnostic(row, 'setup.candidatesFiltered'));
  const missingDefault = recommend(r, auto(candidates, 'deep'), models);
  inert(missingDefault, 'blocked'); assert.ok(diagnostic(missingDefault, 'setup.defaultCandidateFiltered'));
  inert(recommend(r, auto([candidate('deep')]), models), 'blocked');
});

test('Session authorization and missing plugins remain advisory, while inheritance without Session is unverified', () => {
  const row = recommend(role(), fixed(), [declaration('fast', { authorized: false })], { capabilitiesMissing: true });
  assert.equal(row.status, 'changed'); assert.ok(diagnostic(row, 'setup.authorizationWarning')); assert.ok(diagnostic(row, 'setup.capabilityWarning'));
  const inherited = recommend(role({ model: { mode: 'fixed', provider: 'p', model: 'fast' } }), { mode: 'inherit' }, []);
  assert.equal(inherited.status, 'changed'); assert.ok(diagnostic(inherited, 'setup.inheritanceUnverified'));
});

test('non-auto output preserve, set and clear retain their declaration semantics', () => {
  const r = role({ schemaVersion: 2, output: { maxTokens: 2000 } });
  assert.deepEqual(recommend(r, fixed()).after.output, { maxTokens: 2000 });
  const set = recommend(r, fixed({ outputPolicy: { mode: 'set', maxTokens: 3000 } }));
  assert.deepEqual(set.after.output, { maxTokens: 3000 }); assert.deepEqual(parseOverrideText(set.proposedText).output, { maxTokens: 3000 });
  const cleared = recommend(r, fixed({ outputPolicy: { mode: 'clear' } }));
  assert.equal(cleared.after.output, undefined); assert.equal(parseOverrideText(cleared.proposedText).output, null);
});
