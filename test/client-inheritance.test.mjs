import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import { agentRevision, loadBuiltinAgents, resolveCatalog } from '../lib/core/index.js';

let registration;
vm.runInNewContext(await readFile(new URL('../src/client/index.js', import.meta.url), 'utf8'), {
  window: { __ModuleLoader__: { load(value) { registration = value; } } },
  AbortController, TextEncoder, setTimeout, clearTimeout,
});
// Exercise authored text through the real catalog parser; no React/DOM is rendered.
const plugin = registration.factory(() => ({}));
const general = loadBuiltinAgents().find(role => role.id === 'general');
const capped = { ...general, schemaVersion: 2, id: 'capped-base', output: { maxTokens: 4096 } };
const auto = {
  ...general, schemaVersion: 2, id: 'auto-base', reasoning: { mode: 'model-default' },
  model: { mode: 'auto', defaultCandidate: 'fast', candidates: [{ id: 'fast', purpose: 'Small task', provider: 'p', model: 'm', reasoning: { mode: 'model-default' }, maxTokens: 2048 }] },
};
function fixture(extra = []) {
  const rows = new Map([capped, auto, ...extra].map(role => [role.id, JSON.stringify(role)]));
  const revisions = new Map();
  let sequence = 0;
  const catalog = () => {
    const resolved = resolveCatalog([...rows].map(([id, text]) => ({ source: id, text })));
    return {
      ...resolved, agents: resolved.agents.map(role => ({ ...role, revision: agentRevision(role) })),
      overrides: [...rows].map(([id, text]) => ({ id, text, revision: revisions.get(id) || 'seed' })), sessions: [],
    };
  };
  const controller = plugin.createController({ rpc: { async call(_channel, endpoint, payload) {
    if (endpoint === 'agentdeck.catalog') return { ok: true, value: catalog() };
    assert.equal(endpoint, 'agentdeck.save');
    const proposed = new Map(rows).set(payload.id, payload.text);
    const resolved = resolveCatalog([...proposed].map(([id, text]) => ({ source: id, text })));
    const failure = resolved.diagnostics.find(item => item.id === payload.id);
    if (failure) return { ok: false, error: { code: 'invalidDefinition', message: failure.message } };
    rows.set(payload.id, payload.text);
    revisions.set(payload.id, 'saved-' + ++sequence);
    return { ok: true, value: { id: payload.id, text: payload.text, revision: revisions.get(payload.id) } };
  } } });
  return { controller, rows };
}

test('new derived roles inherit the schema required by their selected saved base', async () => {
  for (const base of ['auto-base', 'capped-base']) {
    const { controller } = fixture();
    try {
      await controller.loadCatalog();
      controller.beginCreate(base);
      controller.setNewId('derived');
      assert.equal((await controller.save('@new')).ok, true, controller.getSnapshot().errors.save?.message);
      const result = controller.getSnapshot().catalog.agents.find(role => role.id === 'derived');
      assert.equal(result.schemaVersion, 2);
      assert.equal(result.model.mode, base === 'auto-base' ? 'auto' : 'inherit');
      if (base === 'capped-base') assert.equal(result.output.maxTokens, 4096);
    } finally { controller.dispose(); }
  }
});

test('switching the base updates the new draft schema without rewriting imported text', async () => {
  const { controller } = fixture();
  try {
    await controller.loadCatalog();
    controller.beginCreate('general');
    controller.setNewId('derived');
    controller.setNewBase('auto-base');
    assert.equal((await controller.save('@new')).ok, true, controller.getSnapshot().errors.save?.message);
    assert.equal(controller.getSnapshot().catalog.agents.find(role => role.id === 'derived').schemaVersion, 2);
    const imported = JSON.stringify({ schemaVersion: 2, id: 'imported-role', extends: 'auto-base' });
    controller.importText(imported);
    controller.setNewBase('general');
    assert.equal(controller.getSnapshot().drafts['@new'].text, imported);
  } finally { controller.dispose(); }
});

test('clearing an inherited output cap remains cleared after later edits, save and reload', async () => {
  const { controller, rows } = fixture([{ schemaVersion: 2, id: 'derived', extends: 'capped-base' }]);
  try {
    await controller.loadCatalog();
    assert.equal(controller.getSnapshot().drafts.derived.form.output.maxTokens, 4096);
    controller.updateForm('derived', { output: undefined });
    controller.updateForm('derived', { enabled: false });
    assert.equal((await controller.save('derived')).ok, true, controller.getSnapshot().errors.save?.message);
    const saved = controller.getSnapshot().catalog.agents.find(role => role.id === 'derived');
    assert.equal(saved.output, undefined, 'blank output must not re-inherit the base cap');
    assert.equal(saved.enabled, false);
    assert.equal(JSON.parse(rows.get('derived')).output, null, 'override encodes an explicit inherited-cap clear');
    await controller.loadCatalog();
    assert.equal(controller.getSnapshot().drafts.derived.form.output, undefined);
    assert.equal(controller.getSnapshot().drafts.derived.text, controller.getSnapshot().drafts.derived.baseline);
  } finally { controller.dispose(); }
});
