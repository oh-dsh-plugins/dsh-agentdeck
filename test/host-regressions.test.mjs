import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import Storage from '@deepseek-ai/dsh-storage';
import * as JsonStorage from '@deepseek-ai/dsh-storage-json';
import * as Domains from '@deepseek-ai/dsh-storage-domain';
import * as HostPlugin from '../lib/index.js';
import { AgentDeckStore, storeSpec } from '../lib/host/store.js';
import { AgentDeckController } from '../lib/host/controller.js';
import { readRunResult } from '../lib/host/results.js';
import { missingCapabilities } from '../lib/host/capabilities.js';
import nativeToolsPackage from '@deepseek-ai/dsh-tools/package.json' with { type: 'json' };
import { loadBuiltinAgents, resolveCatalog } from '../lib/core/index.js';

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'agentdeck-host-regression-'));
  const root = new Context();
  await root.plugin(Storage);
  await root.plugin(JsonStorage, { root: join(directory, 'store') });
  await root.plugin(Domains, { backend: 'json' });
  const store = await AgentDeckStore.open(root);
  root.provide('tools', { definitions: () => [], schemas: () => [], resolve: async () => ({ dispose() {} }) });
  root.provide('agents', { list: () => [], get: () => undefined });
  root.provide('subagents', { getProvider: () => ({}), rootOf: agent => agent });
  root.provide('sessionQuery', { observeSession: async () => ({ events: [], [Symbol.dispose]() {} }) });
  root.provide('agentPresets', { resolve: async id => ({ id }), register: async () => async () => {} });
  root.provide('fs', {});
  root.provide('workingDirectory', { get: () => directory });
  root.provide('skills', {});
  root.provide('tokenMeter', {});
  root.provide('llm', {
    listProviders: () => [{ id: 'p', name: 'P' }, { id: 'q', name: 'Q' }],
    listModels: async provider => [{ provider, id: 'm', name: 'M' }],
    resolveModelInfo: async (provider, model) => ({ provider, id: model, name: model, context: { contextWindow: 32_768 }, defaultMaxTokens: 4000, reasoning: { efforts: [{ id: 'low', name: 'Low' }] } }),
    resolveCallConfig: async config => ({ ...config, maxTokens: config.maxTokens ?? 4000 }),
  });
  const actor = { id: 'parent', options: { provider: 'p', model: 'm', maxTokens: 10_000 }, model: { current: () => ({ provider: 'p', model: 'm' }) }, session: { header: { cwd: directory }, requestHeader: () => undefined } };
  const controller = new AgentDeckController(root, store);
  return { root, store, controller, actor, directory, async close() {
    try { await controller.dispose(); await root.fiber.dispose(); }
    finally {
      const resolved = await realpath(directory);
      assert.equal(dirname(resolved), await realpath(tmpdir()));
      assert.ok(basename(resolved).startsWith('agentdeck-host-regression-'));
      await rm(resolved, { recursive: true, force: true });
    }
  } };
}

// These are Host-boundary regressions. The fixture uses real native durable
// storage; model/catalog services are stubs. Full dispatch is a separate suite.
test('Host entry imports and native domain name is legal', () => {
  assert.equal(typeof HostPlugin.apply, 'function');
  assert.match(storeSpec.name, /^[a-z][a-z0-9_]*$/);
});

test('native durable store survives reopen and rejects stale CAS without overwriting', async () => {
  const f = await fixture();
  try {
    const first = await f.store.save('reader', 'schemaVersion: 1\nid: reader\nenabled: false\n');
    await assert.rejects(f.store.save('reader', 'schemaVersion: 1\nid: reader\nenabled: true\n', 'stale'), /changed/);
    await f.store.close();
    const reopened = await AgentDeckStore.open(f.root);
    assert.equal(reopened.getOverride('reader').revision, first.revision);
    await reopened.close();
  } finally { await f.close(); }
});

test('catalog validation and per-role CAS share one serial commit boundary', async () => {
  const f = await fixture();
  try {
    const a = await f.controller.save({ id: 'a', text: 'schemaVersion: 1\nid: a\nextends: reader\n' });
    const b = await f.controller.save({ id: 'b', text: 'schemaVersion: 1\nid: b\nextends: reader\n' });
    const outcomes = await Promise.allSettled([
      f.controller.save({ id: 'a', text: 'schemaVersion: 1\nid: a\nextends: b\n', expectedRevision: a.revision }),
      f.controller.save({ id: 'b', text: 'schemaVersion: 1\nid: b\nextends: a\n', expectedRevision: b.revision }),
    ]);
    assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
    assert.match(outcomes.find(result => result.status === 'rejected').reason.message, /cycle/i);
    const catalog = resolveCatalog(f.store.overrides().map(value => ({ source: value.id, text: value.text })));
    assert.ok(catalog.agents.some(role => role.id === 'a'));
    assert.ok(catalog.agents.some(role => role.id === 'b'));
  } finally { await f.close(); }
});

test('selected project role can be a derivation parent and external edits are not falsely saved', async () => {
  const f = await fixture();
  try {
    const folder = join(f.directory, '.dsh', 'agentdeck');
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, 'project-reader.yaml'), 'schemaVersion: 1\nid: project-reader\nextends: reader\n');
    await f.controller.save({ id: 'derived-reader', text: 'schemaVersion: 1\nid: derived-reader\nextends: project-reader\n' }, f.actor);
    const catalog = await f.controller.catalog(f.actor);
    assert.ok(catalog.agents.some(role => role.id === 'derived-reader'));
    await assert.rejects(f.controller.save({ id: 'project-reader', text: 'schemaVersion: 1\nid: project-reader\nextends: reader\n' }, f.actor), /owned by.*project-reader\.yaml/);
  } finally { await f.close(); }
});

test('oversized role file disables its identified role while the next file still loads', async () => {
  const f = await fixture();
  try {
    const folder = join(f.directory, '.dsh', 'agentdeck');
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, 'a-reader.yaml'), 'schemaVersion: 1\nid: reader\ninstructions: |\n  ' + 'x'.repeat(1_048_577));
    await writeFile(join(folder, 'z-extra.yaml'), 'schemaVersion: 1\nid: extra\nextends: general\n');
    const catalog = await f.controller.catalog(f.actor);
    assert.ok(!catalog.agents.some(role => role.id === 'reader'));
    assert.ok(!catalog.agents.some(role => role.id === 'long-document-reader'));
    assert.ok(catalog.agents.some(role => role.id === 'extra'));
    assert.ok(catalog.agents.some(role => role.id === 'researcher'));
    assert.ok(catalog.diagnostics.some(item => item.id === 'reader' && /1 MiB/.test(item.message)));
  } finally { await f.close(); }
});

test('unidentifiable unreadable source blocks selection with a diagnostic', async () => {
  const f = await fixture();
  try {
    await mkdir(join(f.directory, '.dsh', 'agentdeck', 'not-a-file.yaml'), { recursive: true });
    const catalog = await f.controller.catalog(f.actor);
    assert.ok(catalog.agents.every(role => !role.available));
    await assert.rejects(f.controller.preview('reader', f.actor), /cannot be read safely/);
  } finally { await f.close(); }
});

test('provider-only discovery returns real filtered metadata and rejects model-only queries', async () => {
  const f = await fixture();
  try {
    const directory = await f.controller.models(undefined, { provider: 'p' });
    assert.equal(directory.models.length, 1);
    assert.equal(directory.models[0].provider, 'p');
    assert.equal(directory.models[0].authorized, null);
    await assert.rejects(f.controller.models(undefined, { model: 'm' }), /requires its provider/);
  } finally { await f.close(); }
});

test('preview reports native inherited parameters without a plugin quota', async () => {
  const f = await fixture();
  try {
    const preview = await f.controller.preview('reader', f.actor);
    assert.equal(preview.effectiveSelection.maxTokens, 10_000);
    assert.equal(preview.recovery.policy, 'native');
    assert.equal(preview.recovery.contextWindow, 32_768);
    assert.equal(preview.budget, undefined);
    assert.equal(preview.output, undefined);
  } finally { await f.close(); }
});

test('encoded script traversal is rejected before any privileged resource digest or child start', async () => {
  const f = await fixture();
  try {
    await f.controller.save({ id: 'reader', text: 'schemaVersion: 1\nid: reader\nscripts:\n  - assets/scripts/%2e%2e/%2e%2e/README.md\n' });
    await assert.rejects(f.controller.start({ role: 'reader', prompt: 'Read the task.' }, { agent: f.actor, callId: 'encoded-script', signal: new AbortController().signal }), /outside the packaged scripts directory/);
    assert.equal(f.store.runs().length, 0);
    assert.equal(f.store.snapshots().length, 0);
  } finally { await f.close(); }
});

test('catalog never audits historical presets; an individual result exposes its missing dependency', async () => {
  const f = await fixture();
  try {
    const role = loadBuiltinAgents().find(value => value.id === 'reader');
    await f.store.snapshot({ id: 'snapshot', presetId: 'snapshot-preset', role, skills: [], budget: { known: false, ...role.context, headroomTokens: 1024, diagnostics: [] }, model: { provider: 'p', model: 'm' }, createdAt: 1, policyVersion: 1 });
    let reads = 0;
    f.root.get('agentPresets').resolve = async id => { reads++; return { id, broken: 'missing dependency' }; };
    await f.controller.restore();
    assert.equal(reads, 0);
    await f.controller.catalog();
    assert.equal(reads, 0, 'Opening the role list must not create historical background audits');
    await f.store.run({ id: 'audit-one', roleId: 'reader', revision: 'snapshot', parentId: 'parent', childId: 'child', description: 'Read', createdAt: 1, phase: 'accepted' });
    f.root.get('sessionQuery').readSession = async () => ({ events: [] });
    const result = await f.controller.result({ childId: 'child' });
    assert.equal(reads, 1);
    assert.ok(result.diagnostics.some(item => /snapshot-preset.*missing dependency/.test(item)));
  } finally { await f.close(); }
});

test('no-Session native recovery preview does not wait for unrelated stored presets or providers', async () => {
  const f = await fixture();
  let release;
  const gate = new Promise(done => { release = done; });
  try {
    const role = loadBuiltinAgents().find(value => value.id === 'reader');
    await f.store.snapshot({ id: 'slow', presetId: 'slow-preset', role, skills: [], budget: { known: false, ...role.context, headroomTokens: 1024, diagnostics: [] }, model: { provider: 'p', model: 'm' }, createdAt: 1, policyVersion: 1 });
    let audits = 0;
    f.root.get('agentPresets').resolve = async id => { audits++; await gate; return { id }; };
    f.root.get('llm').listModels = async () => { throw new Error('No model listing is needed for this preview'); };
    const preview = await Promise.race([f.controller.preview('reader'), new Promise((_, reject) => setTimeout(() => reject(new Error('Preview waited for an unrelated preset')), 150))]);
    assert.equal(preview.agent.id, 'reader');
    assert.deepEqual(preview.recovery, { policy: 'native', contextWindow: undefined });
    assert.equal(preview.budget, undefined);
    assert.equal(audits, 0);
  } finally { release(); await f.close(); }
});

test('exact model metadata does not enumerate unrelated providers', async () => {
  const f = await fixture();
  try {
    const listed = [];
    const resolved = [];
    f.root.get('llm').listModels = async provider => { listed.push(provider); throw new Error('Listing must not be used for an exact query'); };
    f.root.get('llm').resolveModelInfo = async (provider, model) => { resolved.push([provider, model]); return { provider, id: model, name: 'Exact model', reasoning: { efforts: [] } }; };
    const directory = await f.controller.models(undefined, { provider: 'p', model: 'm' });
    assert.deepEqual(listed, []);
    assert.deepEqual(resolved, [['p', 'm']]);
    assert.equal(directory.models.length, 1);
    assert.equal(directory.models[0].name, 'Exact model');
  } finally { await f.close(); }
});

test('individual task diagnostics are bounded, deduplicate that preset and respect read cancellation', async () => {
  const f = await fixture();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  try {
    const role = loadBuiltinAgents().find(value => value.id === 'reader');
    await f.store.snapshot({ id: 'pending', presetId: 'pending-preset', role, skills: [], budget: { known: false, ...role.context, headroomTokens: 1024, diagnostics: [] }, model: { provider: 'p', model: 'm' }, createdAt: 1, policyVersion: 1 });
    let checks = 0;
    f.root.get('agentPresets').resolve = async id => { checks++; await gate; return { id }; };
    const started = performance.now();
    await f.store.run({ id: 'audit-pending', roleId: 'reader', revision: 'pending', parentId: 'parent', childId: 'child', description: 'Read', createdAt: 1, phase: 'accepted' });
    f.root.get('sessionQuery').readSession = async () => ({ events: [] });
    const reads = await Promise.all([f.controller.result({ childId: 'child' }), f.controller.result({ childId: 'child' })]);
    assert.ok(performance.now() - started < 1000, 'Unrelated Loader work must not hold task diagnostic reads');
    assert.equal(checks, 1);
    assert.ok(reads.every(read => read.diagnostics.some(item => /diagnostics are still loading/.test(item))));
    const aborter = new AbortController();
    const cancelled = f.controller.result({ childId: 'child' }, undefined, aborter.signal);
    const rejection = assert.rejects(cancelled, /cancel audit/);
    aborter.abort(new Error('cancel audit'));
    await rejection;
    assert.equal(checks, 1);
  } finally { release(); await f.close(); }
});

test('live Session choices retain ordinary forks and exclude delegated children through the native tree root', async () => {
  const f = await fixture();
  try {
    const root = f.actor;
    const fork = { ...root, id: 'ordinary-fork', session: { ...root.session, header: { parentSession: root.id } } };
    const child = { ...root, id: 'delegated-child' };
    f.root.get('agents').list = () => [root, fork, child];
    f.root.get('subagents').rootOf = agent => agent === child ? root : agent;
    const catalog = await f.controller.catalog();
    assert.deepEqual(catalog.sessions.map(session => session.id), [root.id, fork.id]);
    assert.equal(catalog.runtime.compatibilityVersion, nativeToolsPackage.version);
    assert.equal(catalog.runtime.minimumVersion, '0.2.2-rc.1');
    assert.equal(catalog.runtime.rootDiscovery, 'tree');
  } finally { await f.close(); }
});

test('missing native catalog projection retains uncertain startup and disposes the observation', async () => {
  const f = await fixture();
  try {
    await f.store.run({ id: 'uncertain-read', roleId: 'reader', revision: 'old', parentId: 'parent', description: 'Uncertain task', createdAt: 1, phase: 'uncertain' });
    let disposed = 0;
    const signal = new AbortController().signal;
    f.root.get('sessionQuery').observeSession = async (id, options) => {
      assert.equal(id, 'parent'); assert.equal(options.signal, signal);
      return { projections: { values: {} }, [Symbol.dispose]() { disposed++; } };
    };
    const { runs } = await f.controller.runs(undefined, signal);
    assert.equal(runs[0].phase, 'uncertain');
    assert.equal(runs[0].childId, undefined);
    assert.match(runs[0].error, /catalog projection is unavailable/);
    assert.equal(disposed, 1);
    assert.equal(f.store.getRun('uncertain-read').phase, 'uncertain');
  } finally { await f.close(); }
});

const report = { status: 'completed', summary: 'Previous work complete', evidence: ['old'] };
const turn = (type, data = {}) => ({ type, data });
const assistant = value => turn('assistant/message', { message: { content: [{ type: 'text', text: JSON.stringify(value) }] } });
const resultContext = events => ({ events: async () => events, status: () => undefined });
const run = { id: 'r', childId: 'child', parentId: 'parent', roleId: 'reader', revision: 'rev', description: 'Read', createdAt: 1, phase: 'accepted' };

test('latest cancelled or running turn cannot inherit an older completed report', async () => {
  const previous = [turn('turn/start'), assistant(report), turn('turn/end', { reason: { kind: 'completed' } })];
  const cancelled = await readRunResult(resultContext([...previous, turn('turn/start'), turn('turn/end', { reason: { kind: 'aborted' } })]), run);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.rawText, '');
  assert.deepEqual(cancelled.evidence, []);
  const running = await readRunResult(resultContext([...previous, turn('turn/start')]), run);
  assert.equal(running.status, 'running');
  assert.equal(running.summary, '');
});

test('result continuation requires the same report revision', async () => {
  const started = turn('turn/start', { turn: 1 });
  const message = assistant(report);
  const first = await readRunResult(resultContext([started, message]), run, 0, 12);
  assert.match(first.resultRevision, /^[a-f0-9]{64}$/);
  const nextOffset = first.nextOffset;
  await assert.rejects(readRunResult(resultContext([started, message]), run, nextOffset, 50_000), /revision.*first page/i);

  const usageOnly = assistant(report);
  usageOnly.data.usage = { inputTokens: 10 };
  const second = await readRunResult(resultContext([started, usageOnly]), run, nextOffset, 50_000, first.resultRevision);
  assert.equal(first.rawText + second.rawText, JSON.stringify(report));
  assert.deepEqual(second.evidence, first.evidence);

  const updates = [
    [started, assistant({ ...report, summary: 'Updated in the same turn' })],
    [started, message, turn('turn/end', { reason: { kind: 'completed' } })],
    [started, message, turn('turn/start', { turn: 2 }), message],
  ];
  for (const events of updates) {
    await assert.rejects(readRunResult(resultContext(events), run, nextOffset, 50_000, first.resultRevision), /revision.*first page/i);
  }
});

test('native failure and token ceiling constrain even a structured completed claim', async () => {
  for (const [kind, expected] of [['error', 'failed'], ['max-tokens', 'partial'], ['interrupted', 'cancelled']]) {
    const result = await readRunResult(resultContext([turn('turn/start'), assistant(report), turn('turn/end', { reason: { kind } })]), run);
    assert.equal(result.status, expected);
  }
});

test('structured live-model evidence objects remain available in the normalized result', async () => {
  const evidence = { package_name: 'dsh-agentdeck', package_version: '0.1.0', nonce: 'fixture-evidence-nonce' };
  const result = await readRunResult(resultContext([turn('turn/start'), assistant({ status: 'completed', summary: 'Package read.', evidence, coverage: { file_modifications: 0 }, artifacts: [], limitations: [] }), turn('turn/end', { reason: { kind: 'completed' } })]), run);
  assert.equal(result.status, 'completed');
  assert.deepEqual(result.evidence, [evidence]);
  assert.equal(result.coverage.file_modifications, 0);
});

test('unreported native usage stays unknown and partial reports do not invent zero counters', async () => {
  const unknown = await readRunResult(resultContext([turn('turn/start'), assistant(report), turn('turn/end', { reason: { kind: 'completed' } })]), run);
  assert.equal(unknown.usage, null);
  const message = assistant(report);
  message.data.usage = { inputTokens: 17, outputTokens: 5, cacheReadTokens: 0 };
  const known = await readRunResult(resultContext([turn('turn/start'), message, turn('turn/end', { reason: { kind: 'completed' } })]), run);
  assert.equal(known.usage.inputTokens, 17);
  assert.equal(known.usage.cacheReadTokens, 0);
  assert.equal(known.usage.cacheWriteTokens, null);
  assert.equal(known.usage.reasoningTokens, null);
});

test('child-owned filesystem is independent of parent visibility and every capability is checked', () => {
  const role = loadBuiltinAgents().find(value => value.id === 'implementer');
  assert.deepEqual(missingCapabilities(role, [], { files: true, runner: true, skills: true, meter: true }), []);
  const all = { ...role, capabilities: ['files-read', 'source-edit', 'artifact-write', 'data-query', 'project-runner', 'browser-interact', 'browser-observe', 'web-research'] };
  assert.equal(missingCapabilities(all, [], { files: false, runner: false, skills: true, meter: true }).length, 8);
});

test('GUI model discovery is staged without scanning unrelated providers or resolving list rows', async () => {
  const f = await fixture();
  try {
    const listed = [], resolved = [];
    const llm = f.root.get('llm');
    llm.listModels = async provider => { listed.push(provider); return [{ provider, id: 'a' }, { provider, id: 'b' }]; };
    llm.resolveModelInfo = async (provider, id) => { resolved.push([provider, id]); return { provider, id, reasoning: { efforts: [{ id: 'actual' }] } }; };
    const providers = await f.controller.models(undefined, { view: 'options' });
    assert.equal(providers.providers.length, 2);
    assert.deepEqual(providers.models, []);
    assert.deepEqual(listed, []);
    assert.deepEqual(resolved, []);
    const options = await f.controller.models(undefined, { view: 'options', provider: 'p' });
    assert.deepEqual(listed, ['p']);
    assert.deepEqual(resolved, []);
    assert.ok(options.models.every(row => row.metadataResolved === false && row.efforts === undefined));
    const exact = await f.controller.models(undefined, { view: 'options', provider: 'p', model: 'b' });
    assert.deepEqual(resolved, [['p', 'b']]);
    assert.equal(exact.models[0].efforts[0].id, 'actual');
    assert.equal(exact.models[0].metadataResolved, true);
  } finally { await f.close(); }
});

test('advisory reads never initialize dynamic ToolSets and preview reuses resolved metadata', async () => {
  const f = await fixture();
  try {
    f.root.get('tools').resolve = async () => { throw new Error('Page reads must not initialize dynamic providers'); };
    let resolutions = 0;
    const llm = f.root.get('llm');
    const resolve = llm.resolveModelInfo;
    llm.resolveModelInfo = async (...args) => { resolutions++; return resolve(...args); };
    const catalog = await f.controller.catalog(f.actor);
    const browser = catalog.agents.find(role => role.id === 'ui-verifier');
    assert.equal(browser.capabilityCheck, 'static');
    assert.ok(browser.unverifiedCapabilities.includes('browser-observe'));
    assert.ok(!browser.missingCapabilities.includes('browser-observe'));
    const preview = await f.controller.preview('reader', f.actor);
    assert.equal(resolutions, 1, 'One explicit metadata read; native resolveCallConfig validation remains separate.');
    assert.equal(preview.model.id, 'm');
    assert.equal(preview.model.authorized, true);
  } finally { await f.close(); }
});

test('preview cancellation rejects instead of disguising aborted model resolution as unknown budget', async () => {
  const f = await fixture();
  const abort = new AbortController();
  try {
    f.root.get('llm').resolveCallConfig = async () => { abort.abort(new Error('Preview cancelled')); throw abort.signal.reason; };
    await assert.rejects(f.controller.preview('reader', f.actor, abort.signal), /Preview cancelled/);
  } finally { await f.close(); }
});
