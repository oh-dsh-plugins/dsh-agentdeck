import test from 'node:test';
import assert from 'node:assert/strict';
import { loadBuiltinAgents, validateAgent, parseOverrideText, resolveCatalog, agentRevision } from '../lib/core/index.js';

const factory = () => loadBuiltinAgents().find(agent => agent.id === 'general');
const candidate = (id = 'quick', patch = {}) => ({
  id, purpose: 'Read and summarize a bounded source.', provider: 'provider', model: 'small',
  reasoning: { mode: 'model-default' }, maxTokens: 2048, ...patch,
});
const autoModel = (items = [candidate()], defaultCandidate = items[0]?.id) => ({ mode: 'auto', candidates: items, defaultCandidate });
const autoAgent = (patch = {}) => ({ ...factory(), schemaVersion: 2, model: autoModel(), reasoning: { mode: 'model-default' }, ...patch });
const override = (source, patch) => ({ source, text: JSON.stringify({ schemaVersion: 2, id: 'general', ...patch }) });
const find = (catalog, id = 'general') => catalog.agents.find(agent => agent.id === id);
const parse = patch => parseOverrideText(JSON.stringify({ schemaVersion: 2, id: 'general', ...patch }));

// Recorded from the existing v1 compiled implementation before adding schema v2.
test('v1 factories and pinned revisions remain unchanged without an implicit schema upgrade', () => {
  const agents = loadBuiltinAgents();
  for (const agent of agents) {
    assert.equal(agent.schemaVersion, 1);
    assert.deepEqual(validateAgent(agent), agent);
    assert.equal(Object.hasOwn(agent, 'output'), false);
    assert.deepEqual(agent.model, { mode: 'inherit' });
  }
  assert.equal(agentRevision(agents[0]), '10a1c2614bd8543d4f9daf557d3fa6ee8589de9cf12745ab01a2b4f901778d35');
  assert.equal(agentRevision(agents[1]), 'e6b95f750b87d0f17a81424ed40d1d2882e4f69787089edb4048f359cae91b63');
  const resolved = resolveCatalog([override('v1', { schemaVersion: 1, title: { en: 'Old extension' } })]);
  assert.deepEqual(resolved.diagnostics, []);
  assert.equal(find(resolved).schemaVersion, 1);
  assert.equal(find(resolved).instructions, factory().instructions);
});

test('v2 validates inline candidates with individual routes, effort and bounded output', () => {
  const items = [candidate('quick', { purpose: 'x'.repeat(240), maxTokens: 1 }),
    candidate('thorough', { model: 'large', reasoning: { mode: 'fixed', effort: 'high' }, maxTokens: 16_777_216 }),
    candidate('review')];
  const input = autoAgent({ model: autoModel(items, 'thorough') });
  const parsed = validateAgent(input);
  assert.deepEqual(parsed, input);
  assert.notEqual(parsed.model.candidates, input.model.candidates);
  assert.deepEqual(parse({ model: input.model }).model, input.model);
  for (const mode of ['inherit', 'fixed']) {
    const model = mode === 'fixed' ? { mode, provider: 'provider', model: 'model' } : { mode };
    for (const maxTokens of [1, 16_777_216]) {
      const agent = { ...factory(), schemaVersion: 2, model, output: { maxTokens } };
      assert.deepEqual(validateAgent(agent), agent);
    }
  }
});

test('v2 rejects missing, excessive, duplicated and malformed candidates before inheritance', () => {
  const badItems = [
    [], [candidate('a'), candidate('b'), candidate('c'), candidate('d')],
    [candidate(), candidate()], [null], [candidate(), ,],
    [candidate('Bad')], [candidate('x'.repeat(65))], [candidate('bad_id')],
    [candidate('quick', { purpose: '' })], [candidate('quick', { purpose: 'x'.repeat(241) })],
    [candidate('quick', { provider: '' })], [candidate('quick', { model: '' })],
    [candidate('quick', { reasoning: { mode: 'inherit-compatible' } })],
    [candidate('quick', { reasoning: { mode: 'fixed' } })],
    [candidate('quick', { reasoning: { mode: 'model-default', effort: 'high' } })],
    [candidate('quick', { reasoning: { mode: 'fixed', effort: 'high', extra: true } })],
    [candidate('quick', { extra: true })], [candidate('quick', { maxTokens: undefined })],
    ...[0, -1, 1.5, 16_777_217, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, '2048'].map(maxTokens => [candidate('quick', { maxTokens })]),
  ];
  for (const items of badItems) {
    assert.throws(() => validateAgent(autoAgent({ model: autoModel(items, 'quick') })), undefined, JSON.stringify(items));
    assert.throws(() => parse({ model: autoModel(items, 'quick') }), undefined, JSON.stringify(items));
  }
  for (const field of ['id', 'purpose', 'provider', 'model', 'reasoning', 'maxTokens']) {
    const item = candidate();
    delete item[field];
    assert.throws(() => validateAgent(autoAgent({ model: autoModel([item], 'quick') })), undefined, field);
    assert.throws(() => parse({ model: autoModel([item], 'quick') }), undefined, field);
  }
});

test('v2 requires a valid explicit default and rejects every cross-mode or role-wide conflict', () => {
  const invalidModels = [
    { mode: 'auto', candidates: [candidate()] }, autoModel([candidate()], 'missing'),
    autoModel([candidate()], 'Bad'), { ...autoModel(), provider: 'provider' },
    { ...autoModel(), model: 'model' }, { ...autoModel(), extra: true },
    { mode: 'inherit', candidates: [candidate()] }, { mode: 'inherit', defaultCandidate: 'quick' },
    { mode: 'inherit', provider: 'provider' },
    { mode: 'fixed', provider: 'provider', model: 'model', candidates: [candidate()] },
    { mode: 'fixed', provider: 'provider', model: 'model', defaultCandidate: 'quick' },
  ];
  for (const model of invalidModels) {
    assert.throws(() => validateAgent(autoAgent({ model })), undefined, JSON.stringify(model));
  }
  for (const model of invalidModels.slice(1)) assert.throws(() => parse({ model }), undefined, JSON.stringify(model));
  for (const reasoning of [{ mode: 'inherit-compatible' }, { mode: 'fixed', effort: 'high' }, { mode: 'model-default', effort: 'high' }]) {
    assert.throws(() => validateAgent(autoAgent({ reasoning })), undefined, JSON.stringify(reasoning));
    assert.throws(() => parse({ model: autoModel(), reasoning }), undefined, JSON.stringify(reasoning));
  }
  assert.throws(() => validateAgent(autoAgent({ output: { maxTokens: 1000 } })), /output/);
  assert.throws(() => parse({ model: autoModel(), output: { maxTokens: 1000 } }), /output/);
  assert.throws(() => parse({ model: { provider: 'provider', candidates: [candidate()] } }), /auto mode/);
  assert.throws(() => parse({ reasoning: { mode: 'model-default', effort: 'high' } }), /requires fixed/);
});

test('v2 output only accepts the bounded complete cap shape; null is an override clear operation', () => {
  const invalid = [null, {}, [], { maxTokens: 1, extra: true }, ...[0, -1, 1.5, 16_777_217, NaN, Infinity, '2048'].map(maxTokens => ({ maxTokens }))];
  for (const output of invalid) {
    assert.throws(() => validateAgent({ ...factory(), schemaVersion: 2, output }), undefined, JSON.stringify(output));
    if (output !== null) assert.throws(() => parse({ output }), undefined, JSON.stringify(output));
  }
  assert.equal(parse({ output: null }).output, null);
  const result = resolveCatalog([
    override('cap', { output: { maxTokens: 1024 } }),
    override('clear', { output: null }),
  ]);
  assert.deepEqual(result.diagnostics, []);
  assert.equal(Object.hasOwn(find(result), 'output'), false);
  assert.equal(find(result).schemaVersion, 2);
});

test('partial v2 extensions inherit v1 content while auto transitions normalize only inherited settings', () => {
  const first = override('fixed-v1', { schemaVersion: 1, model: { mode: 'fixed', provider: 'old', model: 'old' }, reasoning: { mode: 'fixed', effort: 'high' } });
  const cap = override('cap-v2', { output: { maxTokens: 1000 } });
  const auto = override('auto-v2', { model: autoModel() });
  const result = resolveCatalog([first, cap, auto]);
  assert.deepEqual(result.diagnostics, []);
  const role = find(result);
  assert.equal(role.schemaVersion, 2);
  assert.deepEqual(role.model, autoModel());
  assert.deepEqual(role.reasoning, { mode: 'model-default' });
  assert.equal(Object.hasOwn(role, 'output'), false);
  assert.equal(role.instructions, factory().instructions);
  assert.deepEqual(role.context, factory().context);
  const child = resolveCatalog([override('derived', { id: 'custom-reader', extends: 'reader', model: autoModel() })]);
  assert.deepEqual(child.diagnostics, []);
  assert.equal(find(child, 'custom-reader').instructions, loadBuiltinAgents().find(agent => agent.id === 'reader').instructions);
  assert.deepEqual(find(child, 'custom-reader').reasoning, { mode: 'model-default' });
  for (const conflict of [{ reasoning: { mode: 'fixed', effort: 'high' } }, { reasoning: { effort: 'high' } }, { output: { maxTokens: 999 } }]) {
    const broken = resolveCatalog([first, cap, override('conflict', { model: autoModel(), ...conflict })]);
    assert.equal(find(broken), undefined);
    assert.match(broken.diagnostics[0].message, /auto mode/);
  }
  const reordered = resolveCatalog([first, cap, override('order', { output: null, reasoning: { mode: 'model-default' }, model: autoModel() })]);
  assert.deepEqual(reordered.diagnostics, []);
  assert.deepEqual(find(reordered), role);
});

test('leaving auto starts a fresh model pair and rejects an incomplete fixed route', () => {
  const auto = override('auto', { model: autoModel() });
  for (const model of [{ mode: 'inherit' }, { mode: 'fixed', provider: 'new', model: 'new' }]) {
    const result = resolveCatalog([auto, override('leave', { model, output: { maxTokens: 4096 } })]);
    assert.deepEqual(result.diagnostics, []);
    assert.deepEqual(find(result).model, model);
    assert.deepEqual(find(result).reasoning, { mode: 'model-default' });
    assert.deepEqual(find(result).output, { maxTokens: 4096 });
  }
  for (const model of [{ mode: 'fixed', provider: 'new' }, { mode: 'fixed', model: 'new' }]) {
    const result = resolveCatalog([auto, override('incomplete', { model })]);
    assert.equal(find(result), undefined);
    assert.match(result.diagnostics[0].message, /agent.model/);
  }
  for (const conflict of [{ reasoning: { mode: 'fixed', effort: 'high' } }, { output: { maxTokens: 1000 } }]) {
    const result = resolveCatalog([auto, override('inherited-auto-conflict', conflict)]);
    assert.equal(find(result), undefined);
    assert.match(result.diagnostics[0].message, /auto mode/);
  }
});

test('candidate arrays replace as a whole and the inherited default must remain valid', () => {
  const initial = override('initial', { model: autoModel([candidate(), candidate('thorough')], 'quick') });
  const replacement = candidate('quick', { provider: 'new', model: 'replacement', maxTokens: 4096 });
  const result = resolveCatalog([initial, override('replace', { model: { candidates: [replacement] } })]);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(find(result).model, autoModel([replacement]));
  const broken = resolveCatalog([initial, override('missing-default', { model: { candidates: [candidate('other')] } })]);
  assert.equal(find(broken), undefined);
  assert.match(broken.diagnostics[0].message, /defaultCandidate/);
  const repaired = resolveCatalog([initial, override('new-default', { model: autoModel([candidate('other')]) })]);
  assert.deepEqual(repaired.diagnostics, []);
  assert.deepEqual(find(repaired).model, autoModel([candidate('other')]));
  for (const candidates of [{ add: [candidate('other')] }, [{ id: 'quick', maxTokens: 4096 }]]) {
    assert.throws(() => parse({ model: { candidates } }));
  }
});

test('schema v1 strictly rejects all v2 feature fields and auto mode', () => {
  const v1 = factory();
  const features = [{ output: { maxTokens: 1024 } }, { output: null }, { model: autoModel() },
    { model: { mode: 'inherit', candidates: [candidate()] } }, { model: { mode: 'inherit', defaultCandidate: 'quick' } }];
  for (const feature of features) {
    assert.throws(() => validateAgent({ ...v1, ...feature }), undefined, JSON.stringify(feature));
    assert.throws(() => parseOverrideText(JSON.stringify({ schemaVersion: 1, id: 'general', ...feature })), undefined, JSON.stringify(feature));
  }
  for (const schemaVersion of [0, 3, '2', undefined]) {
    assert.throws(() => validateAgent({ ...v1, schemaVersion }));
    assert.throws(() => parse({ schemaVersion }));
  }
});

test('v2 revisions include candidate semantics and role output while preserving canonical object order', () => {
  const role = autoAgent({ model: autoModel([candidate(), candidate('thorough')]) });
  const revision = agentRevision(role);
  const reordered = structuredClone(role);
  reordered.model = Object.fromEntries(Object.entries(reordered.model).reverse());
  reordered.model.candidates = reordered.model.candidates.map(item => Object.fromEntries(Object.entries(item).reverse()));
  assert.equal(agentRevision(reordered), revision);
  for (const patch of [{ purpose: 'A different purpose' }, { provider: 'new' }, { model: 'new' },
    { reasoning: { mode: 'fixed', effort: 'high' } }, { maxTokens: 4096 }]) {
    assert.notEqual(agentRevision({ ...role, model: autoModel([candidate('quick', patch), candidate('thorough')]) }), revision);
  }
  assert.notEqual(agentRevision({ ...role, model: autoModel(role.model.candidates, 'thorough') }), revision);
  assert.notEqual(agentRevision({ ...role, model: autoModel([...role.model.candidates].reverse(), 'quick') }), revision);
  const inherited = { ...factory(), schemaVersion: 2 };
  assert.notEqual(agentRevision({ ...inherited, output: { maxTokens: 1000 } }), agentRevision(inherited));
});
