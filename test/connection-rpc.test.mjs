import assert from 'node:assert/strict';
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import vm from 'node:vm';
import { request as httpRequest } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import Loader, { Group } from '@deepseek-ai/cordis-plugin-loader';
import AgentPresetRegistry from '@deepseek-ai/dsh-agent-preset-registry';
import * as Connection from '@deepseek-ai/dsh-client-connection';
import SkillRegistry from '@deepseek-ai/dsh-skill';
import Storage from '@deepseek-ai/dsh-storage';
import * as StorageJson from '@deepseek-ai/dsh-storage-json';
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain';
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local';
import TokenMeter from '@deepseek-ai/dsh-token-meter';
import * as AgentDeck from '../lib/index.js';
import { ROUTE, bounded, createNativeHarness, deferred } from '../scripts/probe-native.mjs';

import { ownerConnection } from '../scripts/fixture-web.mjs';

async function fixture({ loadHost = true } = {}) {
  const h = await createNativeHarness();
  let hostFiber;
  let owner;
  try {
    const nativeTools = import.meta.resolve('@deepseek-ai/dsh-tools/package.json');
    const hostModules = dirname(dirname(dirname(fileURLToPath(nativeTools))));
    await writeFile(join(h.storageRoot, 'package.json'), JSON.stringify({ name: 'agentdeck-rpc-native-fixture', type: 'module', private: true }));
    await symlink(hostModules, join(h.storageRoot, 'node_modules'), 'dir');
    const ctx = h.ctx.extend({ baseUrl: pathToFileURL(join(h.storageRoot, 'package.json')).href });
    await bounded(ctx.plugin(Loader, { baseUrl: ctx.baseUrl }), 'RPC Loader');
    ctx.get('loader').builtins.group = Group;
    for (const plugin of [Storage, SkillRegistry, TokenMeter, LocalSubprocess]) await bounded(ctx.plugin(plugin), plugin.name);
    await bounded(ctx.plugin(StorageJson, { root: join(h.storageRoot, 'rpc-domain') }), 'RPC JSON storage');
    await bounded(ctx.plugin(StorageDomain, { backend: 'json' }), 'RPC storage domain');
    await bounded(ctx.plugin(AgentPresetRegistry, { default: 'fixture-standard' }), 'RPC preset registry');
    await bounded(ctx.get('agentPresets').register({ id: 'fixture-standard', name: 'Fixture parent', plugins: [] }), 'RPC parent preset');
    h.parent.options.maxTokens = 1536;
    owner = await ownerConnection(ctx);
    // The shared /api interceptor is intentionally occupied before Host mounts,
    // exactly as the native API Gateway owns it in the running application.
    ctx.get('connection').rpc.intercept('/api', endpoint => endpoint === 'fixture.core', async () => ({ ok: true, value: { core: true } }));
    const mountHost = async () => {
      hostFiber = ctx.plugin(AgentDeck, { customAgentDirs: [], projectConfigDirectory: '.dsh/agentdeck' });
      await bounded(hostFiber, 'actual Host RPC registration');
      for (const runtime of ctx.registry.values()) for (const fiber of runtime.fibers) {
        if (fiber.parent.fiber.uid === hostFiber.uid) {
          await bounded(fiber.await(), 'Host optional injection activation');
          assert.equal(fiber.state, 2, `Host injection ${JSON.stringify(fiber.inject)} must be active`);
        }
      }
    };
    if (loadHost) await mountHost();
    return {
      h, ctx, ...owner,
      async disposeHost() { await hostFiber.dispose(); },
      reloadHost: async () => { await hostFiber.dispose(); await mountHost(); },
      async close() { try { await hostFiber?.dispose(); } finally { try { await owner.close(); } finally { await h.close(); } } },
    };
  } catch (error) {
    try { await hostFiber?.dispose(); } finally { try { await owner?.close(); } finally { await h.close(); } }
    throw error;
  }
}
function value(result) { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; }

function wireStatus(url, headers, body) {
  // Fetch normalizes the Host authority in this Node baseline. Use the Node
  // HTTP client for admission failures so the forged Host reaches the wire.
  return bounded(new Promise((resolve, reject) => {
    const request = httpRequest(url, { method: 'POST', signal: AbortSignal.timeout(8_000), headers: { 'content-type': 'application/json', ...headers } }, response => {
      response.on('error', reject);
      response.resume();
      response.once('end', () => resolve(response.statusCode));
    });
    request.once('error', reject);
    request.end(body);
  }), 'raw HTTP auth admission response');
}

test('explicit public native RPC getter retains the consumer scope through Cordis', async () => {
  const f = await fixture({ loadHost: false });
  let binding;
  try {
    binding = f.ctx.plugin({ inject: ['connection', 'webServer'], apply(connected) {
      const getter = Object.getOwnPropertyDescriptor(Connection.HostConnectionService.prototype, 'rpc').get;
      const rpc = getter.call(connected.connection);
      connected.effect(() => rpc.handle('/fixture-native', async () => ({ ok: true, value: { native: true } })), 'explicit public getter registration');
    } });
    await bounded(binding, 'public Connection getter binding');
    assert.deepEqual(value(await f.rpc.call('/fixture-native', 'fixture.test', {})), { native: true });
    assert.deepEqual(value(await f.rpc.call('/api', 'fixture.core', {})), { core: true });
    await binding.dispose();
    await assert.rejects(f.rpc.call('/fixture-native', 'fixture.test', {}), /HTTP 404/);
    assert.deepEqual(value(await f.rpc.call('/api', 'fixture.core', {})), { core: true });
  } finally { await binding?.dispose(); await f.close(); }
});

test('auto suggestion without a Session goes through the Client, owner RPC and native LLM stream', async () => {
  const f = await fixture(); let controller;
  try {
    const plugin = await clientPlugin(); controller = plugin.createController({ rpc: f.rpc });
    value(await controller.loadCatalog());
    controller.setModelMode('reader', 'auto');
    controller.openSuggestion('reader');
    const generator = { provider: ROUTE.provider, model: ROUTE.model };
    value(await controller.loadSuggestionModelOptions());
    controller.updateSuggestion('reader', { generator });
    value(await controller.loadSuggestionModelOptions(ROUTE.provider));
    assert.ok(controller.suggestionModelOptionsState(ROUTE.provider).items.some(model => model.id === ROUTE.model));
    f.h.adapter.setupReply = JSON.stringify({ model: { mode: 'auto', defaultCandidate: 'local', candidates: [{ id: 'local', purpose: 'Read sources.', ...generator, reasoning: { mode: 'model-default' } }] }, reasoning: { mode: 'model-default' }, reason: 'Use this configured candidate for reading.' });
    const result = value(await controller.generateSuggestion('reader'));
    assert.equal(result.mode, 'auto');
    assert.equal(result.model.defaultCandidate, 'local');
    assert.equal(f.h.adapter.requests.length, 1);
    assert.equal(f.h.adapter.requests[0].provider, generator.provider);
    assert.equal(f.h.adapter.requests[0].model, generator.model);
    assert.equal(controller.adoptSuggestion('reader'), true);
    assert.equal(controller.getSnapshot().drafts.reader.form.model.candidates[0].maxTokens, undefined);
    assert.deepEqual(value(await f.rpc.call('/agentdeck', 'agentdeck.catalog', {})).overrides, []);
    assert.equal(f.h.starts.length, 0);
  } finally { controller?.dispose(); await f.close(); }
});

test('selected Session suggestion resolves a project role and keeps generation independent', async () => {
  const plugin = await clientPlugin(); const f = await fixture(); let controller;
  try {
    const projectRoot = join(f.h.storageRoot, '.dsh', 'agentdeck');
    await mkdir(projectRoot, { recursive: true });
    await writeFile(join(projectRoot, 'project-reader.yml'), JSON.stringify({
      schemaVersion: 3, id: 'project-reader', extends: 'reader',
      model: { mode: 'fixed', provider: ROUTE.provider, model: ROUTE.model },
      reasoning: { mode: 'model-default' },
    }));
    controller = plugin.createController({ rpc: f.rpc });
    controller.setSession(f.h.parent.id);
    const catalog = value(await controller.loadCatalog());
    assert.ok(catalog.agents.some(role => role.id === 'project-reader'));
    controller.openSuggestion('project-reader');
    controller.updateSuggestion('project-reader', { generator: ROUTE });
    f.h.adapter.setupReply = JSON.stringify({ model: { mode: 'fixed', ...ROUTE }, reasoning: { mode: 'model-default' }, reason: 'Keep the project role on its configured route.' });
    const result = value(await controller.generateSuggestion('project-reader'));
    assert.equal(result.id, 'project-reader');
    assert.equal(result.model.provider, ROUTE.provider);
    assert.equal(f.h.adapter.requests.length, 1);
  } finally { controller?.dispose(); await f.close(); }
});

test('disabled roles can still generate an AI suggestion for later adoption', async () => {
  const plugin = await clientPlugin(); const f = await fixture(); let controller;
  try {
    const id = 'disabled-reader';
    value(await f.rpc.call('/agentdeck', 'agentdeck.save', {
      id,
      text: JSON.stringify({ schemaVersion: 3, id, extends: 'reader', enabled: false, model: { mode: 'fixed', ...ROUTE }, reasoning: { mode: 'model-default' } }),
    }));
    controller = plugin.createController({ rpc: f.rpc });
    await controller.loadCatalog();
    controller.openSuggestion(id);
    controller.updateSuggestion(id, { generator: ROUTE });
    f.h.adapter.setupReply = JSON.stringify({ model: { mode: 'fixed', ...ROUTE }, reasoning: { mode: 'model-default' }, reason: 'Keep the disabled role configuration ready for adoption.' });
    const result = value(await controller.generateSuggestion(id));
    assert.equal(result.id, id);
    assert.equal(result.model.model, ROUTE.model);
    assert.equal(f.h.adapter.requests.length, 1);
  } finally { controller?.dispose(); await f.close(); }
});

test('dedicated AgentDeck HTTP RPC coexists with an occupied native /api interceptor', async () => {
  const f = await fixture();
  try {
    assert.deepEqual(value(await f.rpc.call('/api', 'fixture.core', {})), { core: true });
    const catalog = value(await f.rpc.call('/agentdeck', 'agentdeck.catalog', { sessionId: f.h.parent.id }));
    assert.ok(catalog.agents.some(agent => agent.id === 'reader'));
    const models = value(await f.rpc.call('/agentdeck', 'agentdeck.models', { sessionId: f.h.parent.id }));
    assert.ok(models.models.some(model => model.provider === ROUTE.provider && model.id === ROUTE.model && model.authorized));
    const preview = value(await f.rpc.call('/agentdeck', 'agentdeck.preview', { id: 'reader', sessionId: f.h.parent.id }));
    assert.equal(preview.agent.id, 'reader');
    assert.equal(preview.effectiveSelection.maxTokens, 1536);
    const providers = value(await f.rpc.call('/agentdeck', 'agentdeck.models', { view: 'options' }));
    assert.ok(providers.providers.length > 0);
    assert.deepEqual(providers.models, []);
    const options = value(await f.rpc.call('/agentdeck', 'agentdeck.models', { view: 'options', provider: ROUTE.provider }));
    assert.ok(options.models.every(row => row.metadataResolved === false && row.efforts === undefined));
    const exact = value(await f.rpc.call('/agentdeck', 'agentdeck.models', { view: 'options', provider: ROUTE.provider, model: ROUTE.model }));
    assert.equal(exact.models[0].metadataResolved, true);
    assert.ok(Array.isArray(exact.models[0].efforts));
    assert.deepEqual(value(await f.rpc.call('/agentdeck', 'agentdeck.runs', { sessionId: f.h.parent.id })).runs, []);
    for (const [endpoint, payload, message] of [
      ['agentdeck.unknown', {}, /Unknown AgentDeck operation/],
      ['other.catalog', {}, /Unknown AgentDeck endpoint/],
      ['agentdeck.catalog', { sessionId: 'not-a-live-session' }, /not live/],
      ['agentdeck.catalog', [], /object/i],
    ]) {
      const rejected = await f.rpc.call('/agentdeck', endpoint, payload);
      assert.equal(rejected.ok, false);
      assert.equal(typeof rejected.error.code, 'string');
      assert.equal(typeof rejected.error.details, 'object');
      assert.match(rejected.error.message, message);
    }
    await assert.rejects(f.rpc.call('/api', 'agentdeck.catalog', {}), /HTTP 404/);
    assert.deepEqual(value(await f.rpc.call('/api', 'fixture.core', {})), { core: true });
    assert.ok(f.requests.some(request => request.path === 'agentdeck/agentdeck.catalog' && request.status === 200));
  } finally { await f.close(); }
});

async function clientPlugin() {
  const source = await readFile(new URL('../src/client/index.js', import.meta.url), 'utf8');
  let registration;
  // Capture the shipped pure module factory. No DOM, React component, or UI
  // renderer is emulated; all state methods below use the native HTTP caller.
  vm.runInNewContext(source, {
    window: { __ModuleLoader__: { load(module) { registration = module; } } },
    AbortController, TextEncoder, setTimeout, clearTimeout,
  });
  assert.equal(registration.id, 'dsh-agentdeck');
  return registration.factory(name => { assert.equal(name, 'react'); return {}; });
}

test('actual Client controller reads and saves/resets isolated definitions over native HTTP', async () => {
  const plugin = await clientPlugin();
  const f = await fixture();
  let controller;
  try {
    controller = plugin.createController({ rpc: f.rpc });
    value(await controller.loadCatalog());
    assert.ok(controller.getSnapshot().catalog.agents.length >= 13);
    controller.setSession(f.h.parent.id);
    value(await controller.loadModels());
    value(await controller.loadPreview('reader'));
    value(await controller.loadRuns());
    assert.equal(controller.getSnapshot().preview.effectiveSelection.maxTokens, 1536);
    assert.equal(controller.getSnapshot().runs.length, 0);
    controller.setSession('');
    value(await controller.loadCatalog());
    controller.beginCreate('reader');
    controller.setNewId('rpc-fixture-reader');
    const created = value(await controller.save('@new'));
    assert.equal(typeof created.revision, 'string');
    assert.ok(controller.getSnapshot().catalog.agents.some(agent => agent.id === 'rpc-fixture-reader'));
    const updatedText = JSON.stringify({ schemaVersion: 1, id: 'rpc-fixture-reader', extends: 'reader', instructions: 'Keep this isolated transport revision.' });
    controller.edit('rpc-fixture-reader', updatedText);
    const updated = value(await controller.save('rpc-fixture-reader'));
    assert.notEqual(updated.revision, created.revision);
    const stale = await f.rpc.call('/agentdeck', 'agentdeck.reset', { id: updated.id, expectedRevision: created.revision });
    assert.equal(stale.ok, false);
    assert.match(stale.error.message, /changed|conflict/i);
    assert.equal(controller.getSnapshot().drafts[updated.id].expectedRevision, updated.revision);
    value(await controller.reset(updated.id));
    assert.ok(!controller.getSnapshot().catalog.agents.some(agent => agent.id === updated.id));
    assert.deepEqual(controller.getSnapshot().catalog.overrides, []);
    const fresh = value(await f.rpc.call('/agentdeck', 'agentdeck.catalog', {}));
    assert.ok(fresh.agents.some(agent => agent.id === 'reader'));
    assert.deepEqual(fresh.overrides, []);
    assert.ok(f.requests.filter(request => request.path.startsWith('agentdeck/')).every(request => request.status === 200));
    assert.equal(f.h.starts.length, 0);
    assert.equal(f.h.adapter.requests.length, 0, 'metadata and configuration RPC must not generate a model response');
  } finally { controller?.dispose(); await f.close(); }
});

test('owner RPC rejects unreviewed or stale single changes with typed errors', async () => {
  const f = await fixture();
  try {
    const call = (method, payload) => f.rpc.call('/agentdeck', 'agentdeck.' + method, payload);
    const dependent = 'rpc-dependent';
    value(await call('save', { id: dependent, text: JSON.stringify({ schemaVersion: 3, id: dependent, extends: 'reader' }) }));
    const change = { id: 'reader', text: JSON.stringify({ schemaVersion: 3, id: 'reader', model: { mode: 'fixed', ...ROUTE } }) };
    const preview = value(await call('previewChange', change));
    assert.deepEqual(preview.impacts.map(role => role.id), [dependent]);
    for (const [payload, code] of [
      [change, 'PREVIEW_REQUIRED'],
      [{ ...change, impactRevision: 'old', acceptedIndirectRoles: [dependent] }, 'PREVIEW_CHANGED'],
      [{ ...change, impactRevision: preview.impactRevision }, 'CONSENT_REQUIRED'],
    ]) {
      const refused = await call('save', payload);
      assert.equal(refused.ok, false);
      assert.equal(refused.error.code, 'AGENTDECK_IMPACT_' + code);
    }
    assert.equal(value(await call('catalog', {})).overrides.length, 1);
    value(await call('save', { ...change, impactRevision: preview.impactRevision, acceptedIndirectRoles: [dependent] }));
    assert.equal(value(await call('catalog', {})).overrides.length, 2);
    for (const method of ['recommend', 'previewSetup', 'applySetup']) assert.equal((await call(method, {})).ok, false);
  } finally { await f.close(); }
});

for (const derivedId of ['rpc-derived-reader', 'constructor'])
test('actual Client per-role AI adoption and save roundtrip without a Session (' + derivedId + ')', async () => {
  const plugin = await clientPlugin(); const f = await fixture(); let controller;
  try {
    controller = plugin.createController({ rpc: f.rpc });
    value(await f.rpc.call('/agentdeck', 'agentdeck.save', { id: derivedId, text: JSON.stringify({ schemaVersion: 3, id: derivedId, extends: 'reader' }) }));
    value(await controller.loadCatalog());
    controller.setModelMode(derivedId, 'fixed');
    await controller.openSuggestion(derivedId);
    controller.updateSuggestion(derivedId, { generator: { provider: ROUTE.provider, model: 'forbidden' } });
    f.h.adapter.setupReply = JSON.stringify({ model: { mode: 'fixed', provider: ROUTE.provider, model: 'allowed' }, reasoning: { mode: 'model-default' }, reason: 'Use the chosen execution route for source reading.' });
    value(await controller.generateSuggestion(derivedId));
    assert.equal(value(await f.rpc.call('/agentdeck', 'agentdeck.catalog', {})).overrides.length, 1);
    assert.equal(controller.adoptSuggestion(derivedId), true);
    assert.equal(controller.getSnapshot().drafts[derivedId].form.model.model, 'allowed');
    assert.ok(controller.getSnapshot().drafts[derivedId].actions.some(action => action.path[0] === 'model'));
    value(await controller.save(derivedId));
    const saved = controller.getSnapshot().catalog.agents.find(role => role.id === derivedId);
    assert.equal(saved.model.model, 'allowed');
    assert.equal(saved.schemaVersion, 3);
    assert.equal(saved.output, undefined);
    assert.equal(saved.context, undefined);
    assert.equal(f.h.adapter.requests.length, 1);
    assert.equal(f.h.adapter.requests[0].model, 'forbidden');
    assert.equal(f.h.starts.length, 0);
    await f.reloadHost();
    value(await controller.loadCatalog());
    assert.equal(controller.getSnapshot().catalog.agents.find(role => role.id === derivedId).model.model, 'allowed');
  } finally { controller?.dispose(); await f.close(); }
});

test('native HTTP authentication and Host/Origin fence restrict AgentDeck to signed owner requests', async () => {
  const f = await fixture();
  try {
    const body = JSON.stringify({ type: 'client-request', rpcId: 'fixture-auth', method: 'agentdeck.catalog', payload: {} });
    for (const [headers, expected] of [
      [{}, 401],
      [{ cookie: 'invalid=fixture' }, 401],
      [{ cookie: f.cookie, origin: 'https://foreign.invalid' }, 403],
      [{ cookie: f.cookie, host: 'foreign.invalid' }, 403],
    ]) {
      if (headers.host) {
        assert.equal(await wireStatus(`${f.origin}/agentdeck/agentdeck.catalog`, headers, body), expected, 'the native fence must reject the forged wire Host');
      } else {
        const response = await fetch(`${f.origin}/agentdeck/agentdeck.catalog`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body });
        assert.equal(response.status, expected, `auth request header keys: ${Object.keys(headers).join(', ')}`);
        await response.arrayBuffer();
      }
    }
    // Native browser credentials only mint owner Peers in this baseline. This
    // proves the HTTP auth fence and signed owner path; the Host's separate
    // non-owner handler branch is not dynamically exercised by this fixture.
    assert.deepEqual(value(await f.rpc.call('/agentdeck', 'agentdeck.catalog', {})).overrides, []);
    assert.deepEqual(value(await f.rpc.call('/api', 'fixture.core', {})), { core: true });
  } finally { await f.close(); }
});

test('native HTTP caller abort reaches the real Host model metadata operation', async () => {
  const f = await fixture();
  try {
    f.h.adapter.resolutionStarted = deferred();
    f.h.adapter.resolutionGate = deferred();
    const controller = new AbortController();
    const pending = f.rpc.call('/agentdeck', 'agentdeck.models', { sessionId: f.h.parent.id }, controller.signal);
    const outcome = pending.then(answer => ({ answer }), error => ({ error }));
    const resolving = await bounded(f.h.adapter.resolutionStarted.promise, 'native HTTP metadata entered adapter');
    assert.equal(resolving.signal.aborted, false);
    const nativeAborted = deferred();
    resolving.signal.addEventListener('abort', () => nativeAborted.resolve(), { once: true });
    controller.abort();
    const cancelled = await bounded(outcome, 'native HTTP caller cancellation');
    assert.equal(cancelled.error?.name, 'AbortError');
    await bounded(nativeAborted.promise, 'HTTP socket closure forwards native handler cancellation');
    assert.equal(resolving.signal.aborted, true);
    assert.equal(f.h.starts.length, 0);
    assert.equal(f.h.adapter.requests.length, 0);
    f.h.adapter.resolutionGate.resolve();
    assert.deepEqual(value(await f.rpc.call('/api', 'fixture.core', {})), { core: true });
  } finally { await f.close(); }
});

test('Host route disposal and repeated reload retain the core API and close the native listener', async () => {
  const f = await fixture();
  const origin = f.origin;
  try {
    for (let index = 0; index < 2; index++) {
      assert.ok(value(await f.rpc.call('/agentdeck', 'agentdeck.catalog', {})).agents.length >= 13);
      await f.disposeHost();
      await assert.rejects(f.rpc.call('/agentdeck', 'agentdeck.catalog', {}), /HTTP 404/);
      assert.deepEqual(value(await f.rpc.call('/api', 'fixture.core', {})), { core: true });
      await f.reloadHost();
    }
    assert.ok(value(await f.rpc.call('/agentdeck', 'agentdeck.catalog', {})).agents.length >= 13);
  } finally { await f.close(); }
  await assert.rejects(fetch(origin, { signal: AbortSignal.timeout(1_000) }), error => ['ECONNREFUSED', 'UND_ERR_SOCKET'].includes(error.cause?.code));
});
