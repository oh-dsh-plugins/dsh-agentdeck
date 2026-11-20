import assert from 'node:assert/strict';
import test from 'node:test';
import { parse } from 'yaml';
import { loadBuiltinAgents, parseOverrideText } from '../lib/core/index.js';
import { applyDefinitionActions, setupResources } from '../lib/host/setup.js';

const role = loadBuiltinAgents().find(value => value.id === 'reader');
const fixed = { mode: 'fixed', provider: 'p', model: 'manual' };
const auto = { mode: 'auto', candidates: [{ id: 'primary', purpose: 'Read evidence.', provider: 'p', model: 'manual', reasoning: { mode: 'fixed', effort: 'high' } }], defaultCandidate: 'primary' };

test('structured edits migrate only the edited legacy document and preserve unrelated YAML', () => {
  const source = "# Keep this note\nschemaVersion: 2\nid: reader\ninstructions:\n  append: Cite evidence.\nskills:\n  add: [custom]\ncontext: {targetTokens: 1000, elasticTokens: 2000}\noutput: {maxTokens: 3000}\nmodel:\n  mode: auto\n  defaultCandidate: primary\n  candidates:\n    - {id: primary, purpose: Read., provider: p, model: manual, reasoning: {mode: model-default}, maxTokens: 1024}\n";
  const text = applyDefinitionActions(source, role, [{ path: ['model'], op: 'set', value: fixed }]);
  assert.match(text, /# Keep this note/);
  const data = parse(text);
  assert.equal(data.schemaVersion, 3);
  assert.deepEqual(data.model, fixed);
  assert.deepEqual(data.instructions, { append: 'Cite evidence.' });
  assert.deepEqual(data.skills, { add: ['custom'] });
  assert.equal(Object.hasOwn(data, 'context'), false);
  assert.equal(Object.hasOwn(data, 'output'), false);
  assert.equal(parseOverrideText(text).schemaVersion, 3);
  assert.match(source, /maxTokens: 1024/);
});

test('candidate mode transitions need no migration resource choice', () => {
  const initial = applyDefinitionActions(undefined, role, [{ path: ['model'], op: 'set', value: auto }]);
  const changed = applyDefinitionActions(initial, role, [{ path: ['model'], op: 'set', value: fixed }, { path: ['reasoning'], op: 'set', value: { mode: 'fixed', effort: 'high' } }]);
  assert.deepEqual(parse(changed).model, fixed);
  const inherited = applyDefinitionActions(changed, role, [{ path: ['model'], op: 'set', value: { mode: 'inherit' } }, { path: ['reasoning'], op: 'set', value: { mode: 'inherit-compatible' } }]);
  assert.deepEqual(parse(inherited).model, { mode: 'inherit' });
  assert.deepEqual(setupResources(role), { model: role.model, reasoning: role.reasoning });
});

test('structured actions cannot edit permissions, instructions, retired resources or a different role', () => {
  for (const path of [['context'], ['output'], ['instructions'], ['capabilities'], ['model', 'provider']]) {
    assert.throws(() => applyDefinitionActions(undefined, role, [{ path, op: 'set', value: {} }]));
  }
  assert.throws(() => applyDefinitionActions("schemaVersion: 3\nid: general\n", role, [{ path: ['enabled'], op: 'set', value: false }]));
});
