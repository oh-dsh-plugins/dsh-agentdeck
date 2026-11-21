import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import Storage from '@deepseek-ai/dsh-storage';
import * as JsonStorage from '@deepseek-ai/dsh-storage-json';
import * as Domains from '@deepseek-ai/dsh-storage-domain';
import { loadBuiltinAgents, validateAgent, agentRevision } from '../lib/core/index.js';
import { AgentDeckController } from '../lib/host/controller.js';
import { AgentDeckStore } from '../lib/host/store.js';
import { roleChoice } from '../lib/host/selection.js';

const factory = loadBuiltinAgents().find(role => role.id === 'reader');
const pool = () => [
  { id: 'fast', purpose: 'Read a bounded source.', provider: 'p', model: 'm', reasoning: { mode: 'model-default' } },
  { id: 'deep', purpose: 'Compare a large source collection.', provider: 'q', model: 'large', reasoning: { mode: 'fixed', effort: 'high' } },
];
const autoRole = (model = {}) => validateAgent({ ...factory, schemaVersion: 2,
  model: { mode: 'auto', candidates: pool(), defaultCandidate: 'fast', ...model }, reasoning: { mode: 'model-default' } });
const fixedRole = () => validateAgent({ ...factory, schemaVersion: 2,
  model: { mode: 'fixed', provider: 'q', model: 'large' }, reasoning: { mode: 'model-default' }, output: { maxTokens: 20_000 } });
const parent = { provider: 'p', model: 'm', reasoningEffort: 'low', maxTokens: 1000 };
const definition = patch => JSON.stringify({ schemaVersion: 2, id: 'reader', ...patch });
const autoPatch = (extra = {}) => ({ model: { mode: 'auto', candidates: pool(), defaultCandidate: 'fast' }, ...extra });

// Native JSON/Domain storage is real. Model metadata/authorization are bounded
// service fixtures; no provider request, tool execution or child dispatch occurs.
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'agentdeck-selection-v2-'));
  const calls = { providers: 0, directory: [], metadata: [], config: [], observations: 0, disposed: 0 };
  let root, store, controller;
  const actor = { id: 'parent', options: { ...parent }, model: { current: () => ({ provider: 'p', model: 'm' }) },
    session: { header: { cwd: directory }, requestHeader: () => undefined } };
  async function activate() {
    root = new Context();
    await root.plugin(Storage);
    await root.plugin(JsonStorage, { root: join(directory, 'store') });
    await root.plugin(Domains, { backend: 'json' });
    store = await AgentDeckStore.open(root);
    root.provide('tools', { definitions: () => [], schemas: () => [], resolve: async () => ({ dispose() {} }) });
    root.provide('agents', { list: () => [actor], get: id => id === actor.id ? actor : undefined });
    root.provide('subagents', { getProvider: () => ({}), rootOf: agent => agent });
    root.provide('sessionQuery', { observeSession: async () => ({ events: [], [Symbol.dispose]() {} }) });
    root.provide('agentPresets', { resolve: async id => ({ id }), register: async () => async () => {} });
    root.provide('fs', {});
    root.provide('workingDirectory', { get: () => directory });
    root.provide('skills', {});
    root.provide('tokenMeter', {});
    root.provide('llm', {
      listProviders: () => { calls.providers++; return [{ id: 'p', name: 'P' }, { id: 'q', name: 'Q' }]; },
      listModels: async provider => { calls.directory.push(provider); return []; },
      resolveModelInfo: async (provider, model) => {
        calls.metadata.push([provider, model]);
        return { provider, id: model, name: `${provider}/${model} declaration`,
          context: { contextWindow: provider === 'q' ? 131_072 : 32_768 }, defaultMaxTokens: 4000,
          reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] } };
      },
      resolveCallConfig: async config => { calls.config.push({ ...config }); return { ...config, maxTokens: config.maxTokens ?? 4000 }; },
    });
    controller = new AgentDeckController(root, store);
  }
  await activate();
  return { actor, calls, directory,
    get root() { return root; }, get store() { return store; }, get controller() { return controller; },
    allow(routes) {
      root.get('sessionQuery').observeSession = async id => {
        assert.equal(id, actor.id);
        calls.observations++;
        return { events: routes === undefined ? [] : [{ type: 'subagent/model-selection-policy', data: { allowedModels: routes } }],
          [Symbol.dispose]() { calls.disposed++; } };
      };
    },
    async reopen() { await controller.dispose(); await root.fiber.dispose(); await activate(); },
    async close() {
      try { await controller.dispose(); await root.fiber.dispose(); }
      finally {
        const resolved = await realpath(directory);
        assert.equal(dirname(resolved), await realpath(tmpdir()));
        assert.ok(basename(resolved).startsWith('agentdeck-selection-v2-'));
        await rm(resolved, { recursive: true, force: true });
      }
    },
  };
}

function assertNoDirectory(calls) {
  assert.equal(calls.providers, 0);
  assert.deepEqual(calls.directory, []);
}

function assertDeclared(preview, route) {
  assert.deepEqual(preview.configuredSelection, route);
  assert.equal(preview.effectiveSelection, undefined);
  assert.equal(preview.model.metadataResolved, true);
  assert.equal(preview.model.authorized, null);
  assert.deepEqual(preview.authorization, { status: 'unknown' });
  assert.deepEqual(preview.recovery, { policy: 'native', contextWindow: route.provider === 'q' ? 131072 : 32768 });
  for (const field of ['output', 'capacity', 'budget']) assert.equal(Object.hasOwn(preview, field), false);
}

test('unknown Session policy stays unknown in preview and blocks inherited task admission with its own code', async () => {
  const f = await fixture();
  try {
    f.allow({ unsupported: true });
    const preview = await f.controller.preview('reader', f.actor);
    assert.equal(preview.authorization.status, 'unknown');
    await assert.rejects(f.controller.start({ role: 'reader', prompt: 'Read the authorized source.' },
      { agent: f.actor, callId: 'unknown-policy', signal: new AbortController().signal }), error => {
        assert.equal(error.code, 'AGENTDECK_MODEL_POLICY_UNKNOWN');
        assert.equal(error.details.status, 'unknown');
        return true;
      });
    assert.equal(f.calls.config.length, 0, 'Unknown policy must stop admission before native parameter resolution or dispatch');
    assertNoDirectory(f.calls);
  } finally { await f.close(); }
});

test('auto choice requires a current revision and uses candidate policy without parent effort or cap', () => {
  const role = autoRole();
  const revision = agentRevision(role);
  assert.throws(() => roleChoice(role, parent, {}, true), /requires the role revision/);
  const selected = roleChoice(role, parent, { revision }, true);
  assert.deepEqual(selected, { configured: { provider: 'p', model: 'm' }, explicit: true,
    outputSource: 'native-default', decision: { candidateId: 'fast', roleRevision: revision, source: 'default' } });
  assert.equal(selected.configured.reasoningEffort, undefined);
  assert.deepEqual(roleChoice(role, undefined).configured, selected.configured, 'No Session is needed to read authored candidate policy.');
});

test('a recommended candidate pins route, effort and bounded decision provenance', () => {
  const role = autoRole();
  const revision = agentRevision(role);
  const candidateReason = 'The source comparison needs the configured deep candidate.';
  const choice = roleChoice(role, parent, { revision, candidateId: 'deep', candidateReason,
    provider: 'q', model: 'large', reasoning_effort: 'high' }, true);
  assert.deepEqual(choice.configured, { provider: 'q', model: 'large', reasoningEffort: 'high' });
  assert.deepEqual(choice.decision, { candidateId: 'deep', roleRevision: revision, source: 'recommended', reason: candidateReason });
  assert.equal(choice.outputSource, 'native-default');
  assert.equal(roleChoice(role, parent, { revision, candidateId: 'deep', candidateReason: 'x'.repeat(240) }, true).decision.reason.length, 240);
});

test('stale or conflicting auto selections fail instead of changing candidate or native settings', () => {
  const role = autoRole();
  const revision = agentRevision(role);
  const cases = [
    [{ revision: 'stale' }, /role revision changed/],
    [{ candidateId: 'missing' }, /Unknown candidate/],
    [{ provider: 'q' }, /supplied together/],
    [{ model: 'large' }, /supplied together/],
    [{ provider: 'outside', model: 'unconfigured' }, /exactly one configured candidate/],
    [{ candidateId: 'deep', provider: 'p', model: 'm' }, /route conflicts/],
    [{ candidateId: 'deep', reasoning_effort: 'low' }, /effort conflicts/],
    [{ candidateId: 'fast', reasoning_effort: 'low' }, /effort conflicts/],
    [{ maxTokens: 1 }, /native model settings/],
    [{ candidateReason: '' }, /non-empty string/],
    [{ candidateReason: 'x'.repeat(241) }, /max 240/],
  ];
  for (const [request, expected] of cases) assert.throws(() => roleChoice(role, parent, { revision, ...request }, true), expected);
});

test('legacy raw auto routes must uniquely identify one configured candidate', () => {
  const candidates = pool();
  candidates[0] = { ...candidates[0], provider: 'q', model: 'large', reasoning: { mode: 'fixed', effort: 'low' } };
  const role = autoRole({ candidates });
  const revision = agentRevision(role);
  assert.throws(() => roleChoice(role, parent, { revision, provider: 'q', model: 'large' }, true), /exactly one configured candidate/);
  const choice = roleChoice(role, parent, { revision, provider: 'q', model: 'large', reasoning_effort: 'high' }, true);
  assert.equal(choice.decision.candidateId, 'deep');
  assert.equal(choice.decision.source, 'legacy-route');
  assert.equal(choice.configured.maxTokens, undefined);
  assert.throws(() => roleChoice(role, parent, { revision, provider: 'q', model: 'large', reasoning_effort: 'other' }, true), /exactly one configured candidate/);
});

test('inherit and fixed roles preserve compatible effort and ignore retired role caps', () => {
  const { maxTokens, ...route } = parent;
  assert.deepEqual(roleChoice(factory, parent).configured, route);
  const fixed = roleChoice(fixedRole(), parent);
  assert.deepEqual(fixed.configured, { provider: 'q', model: 'large' });
  assert.equal(fixed.outputSource, 'parent');
  const inherited = validateAgent({ ...factory, schemaVersion: 2, output: { maxTokens: 20_000 } });
  assert.deepEqual(roleChoice(inherited, parent).configured, route);
  assert.throws(() => roleChoice(factory, parent, { candidateId: 'fast' }), /only by an auto role/);
  assert.throws(() => roleChoice(factory, parent, { candidateReason: 'choose fast' }), /only by an auto role/);
  assert.throws(() => roleChoice(factory, parent, { maxTokens: 5000 }), /native model settings/);
});

test('catalog exposes a fixed default route denial before dispatch without model discovery', async () => {
  const f = await fixture();
  try {
    const saved = await f.controller.save({ id: 'reader', text: definition({ model: { mode: 'fixed', provider: 'q', model: 'large' } }) });
    const listed = (await f.controller.catalog(f.actor)).agents.find(role => role.id === 'reader');
    assert.equal(listed.capabilitiesAvailable, true);
    assert.equal(listed.available, false);
    assert.equal(listed.authorization.status, 'denied');
    assert.equal(listed.authorization.code, 'AGENTDECK_MODEL_NOT_AUTHORIZED');
    assert.equal(listed.authorization.policy, 'parent-only');
    assert.deepEqual(listed.authorization.allowedModels, [{ provider: 'p', model: 'm' }]);
    assert.deepEqual(listed.configuredSelection, { provider: 'q', model: 'large' });
    const preview = await f.controller.preview('reader', f.actor);
    assert.deepEqual(preview.authorization, listed.authorization);
    assert.equal(preview.agent.available, false);
    assert.equal(f.store.getOverride('reader').revision, saved.revision);
    assert.deepEqual(f.calls.config, []);
    assertNoDirectory(f.calls);
  } finally { await f.close(); }
});

test('catalog distinguishes unknown authorization, inherited routes and an explicit empty policy', async () => {
  const f = await fixture();
  try {
    const unknown = (await f.controller.catalog()).agents.find(role => role.id === 'reader');
    assert.equal(unknown.available, false);
    assert.equal(unknown.capabilitiesAvailable, true);
    assert.equal(unknown.authorization.status, 'unknown');
    f.allow([]);
    const inherited = (await f.controller.catalog(f.actor)).agents.find(role => role.id === 'reader');
    assert.equal(inherited.authorization.status, 'authorized', 'Native implicit inheritance keeps the current route.');
    assert.equal(inherited.available, true);
    await f.controller.save({ id: 'reader', text: definition({ model: { mode: 'fixed', provider: 'p', model: 'm' } }) });
    const fixed = (await f.controller.catalog(f.actor)).agents.find(role => role.id === 'reader');
    assert.equal(fixed.authorization.status, 'denied', 'An explicit route must satisfy the saved policy even for the same model.');
    assert.equal(fixed.authorization.policy, 'session');
    assert.deepEqual(fixed.authorization.allowedModels, []);
    assert.deepEqual(f.calls.metadata, []);
    assert.deepEqual(f.calls.config, []);
  } finally { await f.close(); }
});

test('invalid candidate preview cannot retain a capability-only available badge', async () => {
  const f = await fixture();
  try {
    await f.controller.save({ id: 'reader', text: definition(autoPatch()) });
    const preview = await f.controller.preview('reader', f.actor, undefined, { candidateId: 'missing' });
    assert.equal(preview.authorization.status, 'unknown');
    assert.equal(preview.agent.authorization.status, 'unknown');
    assert.equal(preview.agent.capabilitiesAvailable, true);
    assert.equal(preview.agent.available, false);
    assert.ok(preview.diagnostics.length);
    assert.deepEqual(f.calls.config, []);
  } finally { await f.close(); }
});

test('auto default authorization does not select another allowed candidate', async () => {
  const f = await fixture();
  try {
    await f.controller.save({ id: 'reader', text: definition(autoPatch()) });
    f.allow([{ provider: 'q', model: 'large' }]);
    const listed = (await f.controller.catalog(f.actor)).agents.find(role => role.id === 'reader');
    assert.equal(listed.authorization.status, 'denied');
    assert.equal(listed.configuredSelection.model, 'm');
    const preview = await f.controller.preview('reader', f.actor, undefined, { candidateId: 'deep' });
    assert.equal(preview.authorization.status, 'authorized');
    assert.equal(preview.agent.available, true);
    assert.equal(preview.configuredSelection.model, 'large');
    assert.equal((await f.controller.catalog(f.actor)).agents.find(role => role.id === 'reader').authorization.status, 'denied');
    assert.equal(f.calls.observations, f.calls.disposed);
  } finally { await f.close(); }
});

test('fixed and auto previews without a Session retain declarations and actual model capacity', async () => {
  const f = await fixture();
  try {
    let saved = await f.controller.save({ id: 'reader', text: definition({ model: { mode: 'fixed', provider: 'q', model: 'large' }, output: { maxTokens: 20_000 } }) });
    const fixed = await f.controller.preview('reader');
    assertDeclared(fixed, { provider: 'q', model: 'large' }, 20_000, 'role', 104_518);
    assert.match(fixed.diagnostics.join('\n'), /Select a live Session/);
    saved = await f.controller.save({ id: 'reader', expectedRevision: saved.revision, text: definition(autoPatch()) });
    const selected = await f.controller.preview('reader');
    assertDeclared(selected, { provider: 'p', model: 'm' }, 6000, 'candidate', 25_129);
    const deep = await f.controller.preview('reader', undefined, undefined, { candidateId: 'deep', revision: agentRevision(autoRole()) });
    assertDeclared(deep, { provider: 'q', model: 'large', reasoningEffort: 'high' }, 20_000, 'candidate', 104_518);
    assertNoDirectory(f.calls);
    assert.deepEqual(f.calls.config, []);
    assert.deepEqual(f.calls.metadata, [['q', 'large'], ['p', 'm'], ['q', 'large']]);
    assert.ok(saved.revision);
  } finally { await f.close(); }
});

test('inheritance without a Session stays unknown and fixed previews show actual model capacity', async () => {
  const f = await fixture();
  try {
    const inherited = await f.controller.preview('reader');
    assert.equal(inherited.configuredSelection, undefined);
    assert.equal(inherited.model, undefined);
    assert.equal(inherited.recovery.policy, 'native');
    assert.deepEqual(f.calls.metadata, []);
    await f.controller.save({ id: 'reader', text: definition({ model: { mode: 'fixed', provider: 'q', model: 'large' } }) });
    const fixed = await f.controller.preview('reader');
    assert.deepEqual(fixed.configuredSelection, { provider: 'q', model: 'large' });
    assert.equal(fixed.effectiveSelection, undefined);
    assert.equal(fixed.recovery.contextWindow, 131072);
    assert.deepEqual(f.calls.config, []);
  } finally { await f.close(); }
});

test('a denied selected route retains declaration metadata without claiming parameter validation', async () => {
  const f = await fixture();
  try {
    await f.controller.save({ id: 'reader', text: definition(autoPatch()) });
    f.allow([{ provider: 'p', model: 'm' }]);
    const preview = await f.controller.preview('reader', f.actor, undefined, { candidateId: 'deep' });
    assert.equal(preview.authorization.status, 'denied');
    assert.match(preview.authorization.message, /not authorized by this Session/);
    assert.equal(preview.model.name, 'q/large declaration');
    assert.equal(preview.model.authorized, false);
    assert.equal(preview.model.contextWindow, 131_072);
    assert.deepEqual(preview.configuredSelection, { provider: 'q', model: 'large', reasoningEffort: 'high' });
    assert.equal(preview.effectiveSelection, undefined);
    assert.deepEqual(preview.recovery, { policy: 'native', contextWindow: 131072 });
    assert.deepEqual(f.calls.config, []);
    assert.equal(f.calls.observations, 1);
    assert.equal(f.calls.disposed, 1);
    assertNoDirectory(f.calls);
  } finally { await f.close(); }
});

test('legacy role and candidate caps stay inactive while previews follow native parent inheritance', async () => {
  const f = await fixture();
  try {
    f.allow([{ provider: 'p', model: 'm' }, { provider: 'q', model: 'large' }]);
    let saved = await f.controller.save({ id: 'reader', text: definition({ output: { maxTokens: 20_000 } }) });
    const inherited = await f.controller.preview('reader', f.actor);
    assert.equal(inherited.effectiveSelection.maxTokens, parent.maxTokens);
    saved = await f.controller.save({ id: 'reader', expectedRevision: saved.revision, text: definition(autoPatch()) });
    const selected = await f.controller.preview('reader', f.actor, undefined, { candidateId: 'deep' });
    assert.deepEqual(selected.effectiveSelection, { provider: 'q', model: 'large', reasoningEffort: 'high', maxTokens: parent.maxTokens });
    assert.equal(selected.authorization.status, 'authorized');
    assert.deepEqual(f.calls.config, [parent, { provider: 'q', model: 'large', reasoningEffort: 'high', maxTokens: parent.maxTokens }]);
    assert.equal(f.actor.options.maxTokens, 1000);
    assert.equal(Object.hasOwn(selected.configuredSelection, 'maxTokens'), false);
    assertNoDirectory(f.calls);
    assert.ok(saved.revision);
  } finally { await f.close(); }
});

test('native parameter rejection remains an unvalidated configured preview', async () => {
  const f = await fixture();
  try {
    await f.controller.save({ id: 'reader', text: definition({ output: { maxTokens: 20_000 } }) });
    f.root.get('llm').resolveCallConfig = async () => { throw new Error('Configured output exceeds this model output limit.'); };
    const preview = await f.controller.preview('reader', f.actor);
    assert.equal(preview.authorization.status, 'authorized');
    assert.equal(preview.model.metadataResolved, true);
    assert.equal(preview.effectiveSelection, undefined);
    assert.equal(preview.effectiveSelection, undefined);
    assert.equal(preview.recovery.policy, 'native');
    assert.match(preview.diagnostics.join('\n'), /Native parameter validation: Configured output exceeds this model output limit/);
  } finally { await f.close(); }
});

test('compact candidate summaries use only the configured pool and Session route policy', async () => {
  const f = await fixture();
  try {
    await f.controller.save({ id: 'reader', text: definition(autoPatch()) });
    const noSession = await f.controller.candidates('reader');
    assert.deepEqual(noSession, { id: 'reader', revision: agentRevision(autoRole()), mode: 'auto', defaultCandidate: 'fast',
      candidates: pool().map(candidate => ({ ...candidate, authorization: 'unknown' })) });
    f.allow([{ provider: 'p', model: 'm' }]);
    const selected = await f.controller.candidates('reader', f.actor);
    assert.deepEqual(selected.candidates, pool().map(candidate => ({ ...candidate, authorization: candidate.id === 'fast' ? 'authorized' : 'denied' })));
    assert.deepEqual(Object.keys(selected).sort(), ['candidates', 'defaultCandidate', 'id', 'mode', 'revision']);
    assert.deepEqual(f.calls.metadata, []);
    assert.deepEqual(f.calls.config, []);
    assertNoDirectory(f.calls);
    assert.equal(f.calls.observations, 1);
    assert.equal(f.calls.disposed, 1);
    assert.deepEqual(f.store.runs(), []);
    assert.deepEqual(f.store.snapshots(), []);
  } finally { await f.close(); }
});

test('owner saves and resets preserve other resolved roles inside the write queue', async () => {
  const f = await fixture();
  const text = (id, patch) => JSON.stringify({ schemaVersion: 2, id, ...patch });
  const save = (id, patch, expectedRevision) => f.controller.operation('save', { id, text: text(id, patch), expectedRevision }, f.actor);
  const reset = (id, expectedRevision) => f.controller.operation('reset', { id, expectedRevision }, f.actor);
  try {
    const base = await save('custom-base', { extends: 'reader' });
    // Queue the child first so the following write must validate against the serialized state.
    const childWrite = save('custom-child', { extends: 'custom-base', reasoning: { mode: 'fixed', effort: 'high' } });
    const resetBase = assert.rejects(reset('custom-base', base.revision), /invalidates derived agents: custom-child/);
    const child = await childWrite;
    await resetBase;
    assert.equal(f.store.getOverride('custom-base').revision, base.revision);
    await assert.rejects(save('custom-base', { extends: 'reader', ...autoPatch() }, base.revision), /invalidates derived agents: custom-child/);
    assert.equal(f.store.getOverride('custom-base').revision, base.revision);
    const rename = { id: 'custom-base', text: text('custom-base', { extends: 'reader', displayName: 'Updated base' }), expectedRevision: base.revision };
    const preview = await f.controller.previewChange(rename, f.actor);
    assert.deepEqual(preview.impacts.map(row => row.id), ['custom-child']);
    assert.equal(preview.impacts[0].requiresAcceptance, false);
    const updated = await f.controller.save(rename, f.actor);
    await reset('custom-child', child.revision);
    await reset('custom-base', updated.revision);
    assert.equal(f.store.getOverride('custom-base'), undefined);
  } finally { await f.close(); }
});
for (const action of ['save', 'reset']) {
  test(`owner ${action} protects global dependents hidden by project overrides`, async () => {
    const f = await fixture();
    const text = (id, patch) => JSON.stringify({ schemaVersion: 2, id, ...patch });
    const save = (id, patch, expectedRevision) => f.controller.operation('save', { id, text: text(id, patch), expectedRevision }, f.actor);
    try {
      const base = await save('custom-base', { extends: 'reader' });
      await save('custom-child', { extends: 'custom-base', reasoning: { mode: 'fixed', effort: 'high' } });
      const project = join(f.directory, '.dsh', 'agentdeck');
      await mkdir(project, { recursive: true });
      // Reset can remove a shadowed base. Save needs an unshadowed target,
      // so instead mask the child whose fixed reasoning conflicts with the new auto mode.
      const shadowId = action === 'reset' ? 'custom-base' : 'custom-child';
      await writeFile(join(project, `${shadowId}.yaml`), text(shadowId, { extends: 'reader' }));
      const mutation = action === 'reset'
        ? f.controller.operation('reset', { id: base.id, expectedRevision: base.revision }, f.actor)
        : save(base.id, { extends: 'reader', ...autoPatch() }, base.revision);
      await assert.rejects(mutation, /invalidates derived agents: custom-child/);
      assert.deepEqual(f.store.getOverride(base.id), base);
    } finally { await f.close(); }
  });
}

test('native JSON storage retains candidate decision and pinned snapshot fields across a fresh runtime', async () => {
  const f = await fixture();
  try {
    const sourceRevision = agentRevision(autoRole());
    const snapshot = { id: 'candidate-snapshot', presetId: 'candidate-preset',
      role: validateAgent({ ...fixedRole(), reasoning: { mode: 'fixed', effort: 'high' } }), sourceRevision, candidateId: 'deep',
      skills: [], composition: 'native-minimal', webTools: false, scriptRevisions: {},
      model: { provider: 'q', model: 'large', reasoningEffort: 'high', maxTokens: 20_000, contextWindow: 131_072 },
      budget: { known: true, targetTokens: 12_000, elasticTokens: 32_000, safeInputTokens: 104_518, headroomTokens: 6554, diagnostics: [] },
      createdAt: 1, policyVersion: 1 };
    await f.store.snapshot(snapshot);
    const expected = ['default', 'recommended', 'legacy-route'].map((source, index) => ({ id: `candidate-run-${source}`, roleId: 'reader',
      revision: snapshot.id, parentId: 'parent', childId: `child-${source}`, description: 'Selected candidate task', createdAt: index + 1, phase: 'accepted',
      model: snapshot.model, decision: { candidateId: 'deep', roleRevision: sourceRevision, source, ...(source === 'recommended' ? { reason: 'Compare the configured sources.' } : {}) } }));
    for (const run of expected) await f.store.run(run);
    await f.reopen();
    assert.deepEqual(f.store.snapshots(), [snapshot]);
    for (const run of expected) assert.deepEqual(f.store.getRun(run.id), run);
    assert.equal(f.store.snapshots()[0].role.model.candidates, undefined);
    assert.equal(f.store.snapshots()[0].role.model.defaultCandidate, undefined);
    await f.store.snapshot({ ...snapshot, candidateId: 'fast' });
    assert.equal(f.store.snapshots()[0].candidateId, 'deep', 'A stored snapshot identity remains immutable.');
  } finally { await f.close(); }
});
