import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { loadBuiltinAgents, loadBuiltinSkills, validateAgent, parseOverrideText,
  resolveCatalog, agentRevision, resolveContextBudget } from '../lib/core/index.js';

const ids = ['general', 'code-scout', 'researcher', 'reader', 'architect', 'implementer', 'test-runner',
  'test-designer', 'debugger', 'reviewer', 'ui-verifier', 'data-analyst', 'docs-writer',
  'security-reviewer', 'performance-debugger', 'long-document-reader'];
const override = (source, value) => ({ source, text: typeof value === 'string' ? value : JSON.stringify({ schemaVersion: 1, ...value }) });
const find = (catalog, id) => catalog.agents.find(agent => agent.id === id);

test('factory catalog has all 13 roles and 3 variants, complete English resources and bounded general capabilities', () => {
  const agents = loadBuiltinAgents();
  assert.deepEqual(agents.map(agent => agent.id), ids);
  assert.equal(new Set(agents.map(agent => agent.id)).size, 16);
  assert.deepEqual(agents.filter(agent => agent.extends).map(agent => [agent.id, agent.extends]), [
    ['security-reviewer', 'reviewer'], ['performance-debugger', 'debugger'], ['long-document-reader', 'reader'],
  ]);
  const skills = loadBuiltinSkills();
  assert.equal(skills.length, 16);
  for (const skill of skills) {
    assert.ok(skill.description.length > 30, skill.id);
    assert.ok(skill.body.length > 1300, `${skill.id}: full skill body`);
    assert.match(skill.body, /\nname: /);
  }
  const available = new Set(skills.map(skill => skill.id));
  for (const agent of agents) {
    assert.deepEqual(validateAgent(agent), agent);
    assert.ok(agent.instructions.length > 1800, agent.id);
    assert.ok(agent.inputs.length >= 2 && agent.deliverables.length >= 2);
    for (const skill of agent.skills) assert.ok(available.has(skill), `${agent.id}: ${skill}`);
    for (const script of agent.scripts) assert.ok(existsSync(new URL(`../${script}`, import.meta.url)), script);
    assert.equal(agent.model.mode, 'inherit');
  }
  assert.deepEqual(agents[0].capabilities, ['files-read', 'web-research']);
  for (const id of ['code-scout', 'reader', 'reviewer', 'security-reviewer', 'long-document-reader']) {
    assert.deepEqual(agents.find(agent => agent.id === id).capabilities, ['files-read']);
  }
  agents[0].title.en = 'changed';
  agents[0].skills.push('unknown');
  assert.equal(loadBuiltinAgents()[0].title.en, 'General assistant');
  assert.deepEqual(loadBuiltinAgents()[0].skills, ['task-handoff']);
});

test('strict complete validation rejects unknown shapes, invalid model pairs and inconsistent budgets', () => {
  const base = loadBuiltinAgents()[0];
  const invalid = [
    { surprise: true }, { schemaVersion: 3 }, { id: 'General' }, { id: '../general' }, { enabled: 'true' },
    { title: { en: 'Title' } }, { description: { ...base.description, extra: 'no' } },
    { capabilities: ['files-read', 'files-read'] }, { capabilities: ['all-tools'] },
    { model: { mode: 'fixed', provider: 'provider' } }, { model: { mode: 'fixed', model: 'model' } },
    { model: { mode: 'inherit', model: 'model', provider: 'provider' } },
    { model: { mode: 'fixed', provider: '', model: 'x' } },
    { reasoning: { mode: 'fixed' } }, { reasoning: { mode: 'model-default', effort: 'high' } },
    { reasoning: { mode: 'inherit-compatible', unknown: true } },
    { context: { targetTokens: -1, elasticTokens: 1000 } }, { context: { targetTokens: 1.5, elasticTokens: 1000 } },
    { context: { targetTokens: 2000, elasticTokens: 1000 } }, { context: { targetTokens: NaN, elasticTokens: 1000 } },
    { context: { targetTokens: 1000, elasticTokens: Infinity } },
    { context: { targetTokens: 1000, elasticTokens: 1000, extra: 1 } },
  ];
  for (const patch of invalid) assert.throws(() => validateAgent({ ...base, ...patch }), undefined, JSON.stringify(patch));
  assert.throws(() => validateAgent([]), /plain mapping/);
  assert.throws(() => validateAgent(Object.create({ ...base })), /plain mapping/);
  assert.deepEqual(validateAgent({ ...base, model: { mode: 'fixed', provider: 'p', model: 'm' }, reasoning: { mode: 'fixed', effort: 'high' } }).model,
    { mode: 'fixed', provider: 'p', model: 'm' });
});

test('YAML parser accepts exact schema and rejects unsafe, ambiguous or unknown content', () => {
  assert.deepEqual(parseOverrideText('schemaVersion: 1\nid: reader\ninstructions:\n  append: Read carefully.\n'),
    { schemaVersion: 1, id: 'reader', instructions: { append: 'Read carefully.' } });
  const bad = [
    '', '[]', 'id: reader', 'schemaVersion: 3\nid: reader', 'schemaVersion: 1\nid: reader\nextra: true',
    'schemaVersion: 1\nid: reader\nid: general', 'schemaVersion: 1\nid: reader\n---\nid: general',
    'schemaVersion: 1\nid: reader\ninstructions: !execute command',
    'schemaVersion: 1\nid: reader\ninstructions: !!js/function function() {}',
    'schemaVersion: 1\nid: reader\ninstructions: &a [*a]',
    'schemaVersion: 1\nid: reader\ntitle: &a { en: a, zh: a }\ndescription: *a',
    'schemaVersion: 1\nid: reader\n<<: {enabled: false}',
    'schemaVersion: 1\nid: reader\n__proto__: {polluted: true}',
    'schemaVersion: 1\nid: reader\nmodel: {mode: nope}',
    'schemaVersion: 1\nid: reader\ninstructions: {}',
    'schemaVersion: 1\nid: reader\nskills: {extra: [x]}',
    'schemaVersion: 1\nid: reader\ncapabilities: {remove: [unknown]}',
    'schemaVersion: 1\nid: reader\ncontext: {targetTokens: -1}',
  ];
  for (const text of bad) assert.throws(() => parseOverrideText(text), undefined, text);
  assert.throws(() => parseOverrideText('x'.repeat(1_048_577)), /1 MiB/);
  assert.throws(() => parseOverrideText('中'.repeat(400000)), /1 MiB/);
  assert.equal({}.polluted, undefined);
});

test('ordered overrides merge localized and nested fields, instruction operations and explicit list operations', () => {
  const original = loadBuiltinAgents().find(agent => agent.id === 'reader');
  const result = resolveCatalog([
    override('profile/reader.yml', { id: 'reader', title: { en: 'Profile reader' },
      instructions: { append: 'Profile note.' }, context: { targetTokens: 18000 },
      skills: { remove: ['task-handoff'], add: ['custom-skill'] }, scripts: [] }),
    override('project/reader.yml', { id: 'reader', instructions: { replace: 'Replacement instructions.', append: 'Project note.' },
      capabilities: { replace: ['files-read'], add: ['web-research'], remove: ['artifact-write'] } }),
    override('project/new.yml', { id: 'custom-reader', extends: 'reader', displayName: 'Custom reader',
      instructions: { append: 'Child note.' }, enabled: false }),
  ]);
  assert.deepEqual(result.diagnostics, []);
  const reader = find(result, 'reader');
  assert.equal(reader.title.en, 'Profile reader');
  assert.equal(reader.title.zh, original.title.zh);
  assert.equal(reader.context.targetTokens, 18000);
  assert.equal(reader.context.elasticTokens, original.context.elasticTokens);
  assert.equal(reader.instructions, 'Replacement instructions.\n\nProject note.');
  assert.deepEqual(reader.skills, ['evidence-reading', 'custom-skill']);
  assert.deepEqual(reader.scripts, []);
  assert.deepEqual(reader.capabilities, ['files-read', 'web-research']);
  assert.equal(find(result, 'custom-reader').instructions, `${reader.instructions}\n\nChild note.`);
  assert.deepEqual(find(result, 'custom-reader').title, { en: 'Custom reader', zh: 'Custom reader' });
  assert.equal(find(result, 'custom-reader').enabled, false);
  assert.deepEqual(result.agents.map(agent => agent.id), [...ids, 'custom-reader']);
});

test('new complete roles and forward inheritance resolve deterministically without mutating factories', () => {
  const complete = { ...loadBuiltinAgents()[0], id: 'independent', title: { en: 'Independent', zh: '独立' } };
  const inputs = [
    override('child', { id: 'derived-reader', extends: 'future-reader', instructions: { append: 'Child instructions.' } }),
    override('parent', { id: 'future-reader', extends: 'reader', displayName: 'Future reader' }),
    override('complete', complete),
  ];
  const first = resolveCatalog(inputs);
  assert.deepEqual(first.diagnostics, []);
  assert.equal(find(first, 'derived-reader').title.en, 'Future reader');
  assert.deepEqual(find(first, 'independent'), complete);
  assert.deepEqual(first, resolveCatalog(inputs));
  find(first, 'reader').context.targetTokens = 1;
  assert.equal(loadBuiltinAgents().find(agent => agent.id === 'reader').context.targetTokens, 16000);
});

test('bad overrides remove their role and dependent derivations while unrelated roles remain usable', () => {
  const result = resolveCatalog([
    override('bad-reader.yml', { id: 'reader', unknown: true }),
    override('dependent.yml', { id: 'child-reader', extends: 'reader' }),
    override('missing.yml', { id: 'missing-child', extends: 'nonexistent' }),
    override('bad-budget.yml', { id: 'architect', context: { targetTokens: 100, elasticTokens: 10 } }),
    override('good.yml', { id: 'researcher', displayName: 'Still usable' }),
  ]);
  for (const id of ['reader', 'long-document-reader', 'child-reader', 'missing-child', 'architect']) assert.equal(find(result, id), undefined, id);
  assert.equal(find(result, 'general').enabled, true);
  assert.equal(find(result, 'researcher').title.en, 'Still usable');
  assert.equal(result.diagnostics.length, 5);
  assert.ok(result.diagnostics.some(item => item.id === 'reader' && item.source === 'bad-reader.yml'));
  assert.ok(result.diagnostics.some(item => item.id === 'missing-child' && /Missing parent/.test(item.message)));
  assert.ok(result.diagnostics.some(item => item.id === 'child-reader' && item.source === 'dependent.yml'));
  assert.equal(resolveCatalog([override('new-partial', { id: 'incomplete', instructions: 'Not complete.' })]).agents.length, 16);
});

test('cycles are diagnosed independently, including explicit self-inheritance', () => {
  const result = resolveCatalog([
    override('a', { id: 'cycle-a', extends: 'cycle-b' }), override('b', { id: 'cycle-b', extends: 'cycle-a' }),
    override('reader-self', { id: 'reader', extends: 'reader' }),
    override('child', { id: 'cycle-child', extends: 'cycle-a' }),
  ]);
  for (const id of ['cycle-a', 'cycle-b', 'cycle-child', 'reader', 'long-document-reader']) assert.equal(find(result, id), undefined);
  assert.equal(find(result, 'general').id, 'general');
  assert.equal(result.diagnostics.length, 5);
  assert.ok(result.diagnostics.every(item => /cycle/i.test(item.message)));
});

test('factory variant dependencies participate in inheritance cycles', () => {
  const result = resolveCatalog([override('factory-cycle', { id: 'reader', extends: 'long-document-reader' })]);
  assert.equal(find(result, 'reader'), undefined);
  assert.equal(find(result, 'long-document-reader'), undefined);
  assert.equal(result.diagnostics.length, 2);
  assert.ok(result.diagnostics.every(item => /Inheritance cycle/.test(item.message)));
  assert.equal(find(result, 'reviewer').enabled, true);
});

test('oversized identifiable role overrides are diagnosed without exposing the factory as a fallback', () => {
  const text = `schemaVersion: 1\nid: general\ninstructions: |\n  ${'x'.repeat(1_048_576)}\n`;
  const result = resolveCatalog([override('oversized-general', text)]);
  assert.equal(find(result, 'general'), undefined);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].id, 'general');
  assert.match(result.diagnostics[0].message, /1 MiB/);
});

test('model and reasoning mode transitions clear incompatible inherited fields and reject incomplete fixed selections', () => {
  const result = resolveCatalog([
    override('fixed', { id: 'reader', model: { mode: 'fixed', provider: 'provider', model: 'model' }, reasoning: { mode: 'fixed', effort: 'high' } }),
    override('inherit', { id: 'reader', model: { mode: 'inherit' }, reasoning: { mode: 'model-default' } }),
    override('bad-fixed', { id: 'reviewer', model: { mode: 'fixed', model: 'incomplete' } }),
  ]);
  assert.deepEqual(find(result, 'reader').model, { mode: 'inherit' });
  assert.deepEqual(find(result, 'reader').reasoning, { mode: 'model-default' });
  assert.equal(find(result, 'reviewer'), undefined);
  assert.equal(find(result, 'security-reviewer'), undefined);
  assert.equal(result.diagnostics.length, 2);
});

test('canonical revisions ignore object key order, include complete content and return a lowercase SHA-256', () => {
  const agent = loadBuiltinAgents()[0];
  const reordered = Object.fromEntries(Object.entries(agent).reverse());
  reordered.title = { zh: agent.title.zh, en: agent.title.en };
  reordered.context = { elasticTokens: agent.context.elasticTokens, targetTokens: agent.context.targetTokens };
  const revision = agentRevision(agent);
  assert.match(revision, /^[a-f0-9]{64}$/);
  assert.equal(agentRevision(reordered), revision);
  assert.notEqual(agentRevision({ ...agent, instructions: `${agent.instructions}\nA real change.` }), revision);
  assert.notEqual(agentRevision({ ...agent, enabled: false }), revision);
  assert.notEqual(agentRevision({ ...agent, capabilities: [...agent.capabilities].reverse() }), revision);
});

test('known budgets clamp total input targets once and subtract fixed context only from material', () => {
  const budget = resolveContextBudget({ windowTokens: 32000, outputTokens: 4000, fixedTokens: 10000, targetTokens: 20000, elasticTokens: 50000 });
  assert.deepEqual(budget, { known: true, targetTokens: 20000, elasticTokens: 26400, safeInputTokens: 26400,
    headroomTokens: 1600, materialTokens: 16400, diagnostics: ['Configured context targets were clamped to safe input capacity.'] });
  const hugeFixed = resolveContextBudget({ windowTokens: 8000, outputTokens: 2000, fixedTokens: 10000, targetTokens: 2000, elasticTokens: 4000 });
  assert.equal(hugeFixed.safeInputTokens, 4976);
  assert.equal(hugeFixed.targetTokens, 2000);
  assert.equal(hugeFixed.materialTokens, 0);
  assert.match(hugeFixed.diagnostics.join(' '), /Fixed context/);
  const exhausted = resolveContextBudget({ windowTokens: 1000, outputTokens: 2000, targetTokens: 100, elasticTokens: 200 });
  assert.equal(exhausted.safeInputTokens, 0);
  assert.equal(exhausted.materialTokens, 0);
  assert.equal(exhausted.targetTokens, 0);
  assert.equal(exhausted.elasticTokens, 0);
});

test('unknown window or output never advertises a confirmed safe capacity', () => {
  for (const metadata of [{}, { windowTokens: 32000 }, { outputTokens: 4000 }]) {
    const budget = resolveContextBudget({ ...metadata, targetTokens: 12000, elasticTokens: 24000 });
    assert.equal(budget.known, false);
    assert.equal(budget.targetTokens, 12000);
    assert.equal(budget.elasticTokens, 24000);
    assert.equal(budget.safeInputTokens, undefined);
    assert.equal(budget.materialTokens, undefined);
    assert.ok(budget.diagnostics.length);
  }
  for (const patch of [{ windowTokens: 0 }, { outputTokens: -1 }, { fixedTokens: -1 }, { targetTokens: 10, elasticTokens: 5 }, { windowTokens: Infinity }]) {
    assert.throws(() => resolveContextBudget({ targetTokens: 100, elasticTokens: 200, ...patch }));
  }
});
