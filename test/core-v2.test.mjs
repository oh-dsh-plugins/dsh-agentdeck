import test from 'node:test';
import assert from 'node:assert/strict';
import { loadBuiltinAgents, validateAgent, parseOverrideText, resolveCatalog, agentRevision } from '../lib/core/index.js';

const factory = () => loadBuiltinAgents().find(role => role.id === 'reader');
const candidate = (id = 'primary') => ({ id, purpose: 'Read the requested evidence.', provider: 'p', model: id, reasoning: { mode: 'model-default' } });
const auto = (items = [candidate()]) => ({ mode: 'auto', candidates: items, defaultCandidate: items[0].id });
const layer = value => ({ source: 'user:reader', text: JSON.stringify(value) });

test('v3 factories have native resources and stable revisions without role quotas', () => {
  for (const role of loadBuiltinAgents()) {
    assert.equal(role.schemaVersion, 3);
    assert.deepEqual(validateAgent(role), role);
    assert.equal(Object.hasOwn(role, 'context'), false);
    assert.equal(Object.hasOwn(role, 'output'), false);
    assert.equal(agentRevision(role), agentRevision(structuredClone(role)));
  }
});

for (const version of [1, 2]) test('legacy schema ' + version + ' normalizes for new tasks without mutating its stored source', () => {
  const input = { ...factory(), schemaVersion: version, context: { targetTokens: 24000, elasticTokens: 48000 }, output: { maxTokens: 1200 } };
  if (version === 2) { input.model = auto(); input.model.candidates[0].maxTokens = 2048; input.reasoning = { mode: 'model-default' }; }
  const before = structuredClone(input);
  const active = validateAgent(input);
  assert.equal(active.schemaVersion, 3);
  assert.equal(Object.hasOwn(active, 'context'), false);
  assert.equal(Object.hasOwn(active, 'output'), false);
  if (version === 2) assert.equal(Object.hasOwn(active.model.candidates[0], 'maxTokens'), false);
  assert.deepEqual(input, before);
  const source = JSON.stringify(input);
  const resolved = resolveCatalog([layer(input)]);
  assert.deepEqual(resolved.diagnostics, []);
  assert.deepEqual(resolved.agents.find(role => role.id === 'reader'), active);
  assert.equal(source, JSON.stringify(input));
});

test('v3 accepts more than three candidates with purposes and no output cap', () => {
  const model = auto(['quick', 'deep', 'audit', 'large'].map(candidate));
  const role = validateAgent({ ...factory(), model, reasoning: { mode: 'model-default' } });
  assert.deepEqual(role.model, model);
  assert.deepEqual(parseOverrideText(JSON.stringify({ schemaVersion: 3, id: 'reader', model })).model, model);
});

test('v3 rejects retired resources and malformed candidate contracts', () => {
  for (const patch of [{ context: {} }, { output: { maxTokens: 1 } }, { model: { ...auto(), candidates: [{ ...candidate(), maxTokens: 1 }] } },
    { model: { ...auto(), candidates: [] } }, { model: auto([candidate(), candidate()]) }, { model: { ...auto(), defaultCandidate: 'absent' } },
    { model: auto([{ ...candidate(), purpose: '' }]) }, { model: auto([{ ...candidate(), reasoning: { mode: 'fixed' } }]) }]) {
    assert.throws(() => validateAgent({ ...factory(), ...patch }));
    assert.throws(() => parseOverrideText(JSON.stringify({ schemaVersion: 3, id: 'reader', ...patch })));
  }
});

test('legacy sparse layers preserve instructions and capabilities while removing active resources', () => {
  const resolved = resolveCatalog([
    layer({ schemaVersion: 2, id: 'reader', model: auto(), context: { targetTokens: 1000, elasticTokens: 2000 } }),
    { source: 'user:derived', text: JSON.stringify({ schemaVersion: 1, id: 'derived', extends: 'reader', instructions: { append: 'Cite sources.' }, skills: { add: ['extra'] } }) },
  ]);
  assert.deepEqual(resolved.diagnostics, []);
  const derived = resolved.agents.find(role => role.id === 'derived');
  assert.equal(derived.schemaVersion, 3);
  assert.match(derived.instructions, /Cite sources[.]$/);
  assert.ok(derived.skills.includes('extra'));
  assert.deepEqual(derived.model, auto());
  assert.equal(Object.hasOwn(derived, 'context'), false);
});
