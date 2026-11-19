import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { constants } from 'node:fs';
import { mkdir, mkdtemp, open, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import Storage from '@deepseek-ai/dsh-storage';
import * as JsonStorage from '@deepseek-ai/dsh-storage-json';
import * as Domains from '@deepseek-ai/dsh-storage-domain';
import { loadBuiltinAgents, validateAgent, agentRevision, parseOverrideText } from '../lib/core/index.js';
import { AgentDeckController } from '../lib/host/controller.js';
import { AgentDeckStore } from '../lib/host/store.js';
import { roleChoice } from '../lib/host/selection.js';

const factory = loadBuiltinAgents().find(role => role.id === 'reader');
const pool = () => [
  { id: 'fast', purpose: 'Read a bounded source.', provider: 'p', model: 'm', reasoning: { mode: 'model-default' }, maxTokens: 6000 },
  { id: 'deep', purpose: 'Compare a large source collection.', provider: 'q', model: 'large', reasoning: { mode: 'fixed', effort: 'high' }, maxTokens: 20_000 },
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
  const calls = { providers: 0, directory: [], metadata: [], config: [], stream: [], observations: 0, disposed: 0 };
  let root, store, controller;
  let finishKind = 'stop';
  let aiOutput = JSON.stringify({ strategies: { reader: { mode: 'auto', candidates: [pool()[0]], defaultCandidate: 'fast' } } });
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
    root.provide('agentPresets', { resolve: async id => ({ id }), register: async () => async () => {} });
    root.provide('fs', {});
    root.provide('workingDirectory', { get: () => directory });
    root.provide('skills', {});
    root.provide('tokenMeter', {});
    root.provide('llm', {
      listProviders: () => { calls.providers++; return [{ id: 'p', name: 'P' }, { id: 'q', name: 'Q' }]; },
      listModels: async provider => { calls.directory.push(provider); return []; },
      resolveModelInfo: async (provider, model) => {
        calls.metadata.push([provider, model]); if (model === 'missing') throw new Error('Unavailable declaration');
        return { provider, id: model, name: `${provider}/${model} declaration`,
          context: { contextWindow: provider === 'q' ? 131_072 : 32_768 }, defaultMaxTokens: 4000, inputModalities: model === 'vision' ? ['text', 'image'] : ['text'],
          reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] } };
      },
      resolveCallConfig: async config => { calls.config.push({ ...config }); return { ...config, maxTokens: config.maxTokens ?? 4000 }; },
      stream: async options => {
        assert.deepEqual(options.messages.map(message => [message.role, message.content.map(block => block.type)]), [['user', ['text']]]);
        calls.stream.push({ ...options });
        const output = aiOutput;
        return (async function* () {
          yield { type: 'text-delta', index: 0, text: output };
          yield { type: 'finish', reason: { kind: finishKind } };
        })();
      },
    });
    controller = new AgentDeckController(root, store);
  }
  await activate();
  return { actor, calls, directory,
    get root() { return root; }, get store() { return store; }, get controller() { return controller; },
    setAiOutput(value) { aiOutput = typeof value === 'string' ? value : JSON.stringify(value); },
    setFinishKind(kind) { finishKind = kind; },
    allow(routes) {
      root.provide('sessionQuery', { observeSession: async id => {
        assert.equal(id, actor.id);
        calls.observations++;
        return { events: [{ type: 'subagent/model-selection-policy', data: { allowedModels: routes } }],
          [Symbol.dispose]() { calls.disposed++; } };
      } });
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

const recommend = (f, ids, extra = {}, actor) => f.controller.operation('recommend', { roleIds: ids, defaultRoute: { provider: 'q', model: 'large' }, imageRoute: { provider: 'q', model: 'vision' }, ...extra }, actor);
const payload = proposal => ({ rows: proposal.rows.filter(row => row.applicable).map(row => ({ id: row.id, text: row.proposedText, roleRevision: row.roleRevision, expectedRevision: row.expectedRevision })) });
test('setup resolves only selected routes, preserves authored YAML and treats authorization as advice', async () => {
 const f = await fixture(); try {
  f.allow([]);
  const text = '# Keep this comment\nschemaVersion: 1\nid: reader\ninstructions: My authored task rule\n';
  await f.controller.save({id:'reader',text});
  const proposal = await recommend(f, ['reader','ui-verifier'], {}, f.actor);
  assert.deepEqual(f.calls.metadata, [['q','large'],['q','vision']]); assert.deepEqual(f.calls.directory, []); assert.deepEqual(f.calls.config, []);
  const reader = proposal.rows.find(row => row.id === 'reader');
  assert.equal(reader.applicable, true); assert.ok(reader.warnings.some(d => d.code === 'setup.authorizationWarning'));
  assert.match(reader.proposedText, /Keep this comment/); assert.match(reader.proposedText, /My authored task rule/);
  assert.equal(proposal.rows.find(row => row.id === 'ui-verifier').applicable, true);
  assert.equal((await f.controller.operation('applySetup', payload(proposal), f.actor)).status, 'completed');
  assert.equal(f.store.getOverride('reader').text, reader.proposedText);
 } finally {await f.close();}
});
test('legacy setup validates role IDs before metadata and loads only routes used by included roles', async () => {
 const f = await fixture(); try {
  await assert.rejects(recommend(f, ['unknown-role']), /Unknown or invalid agent/);
  assert.deepEqual(f.calls.metadata, []);
  const proposal = await recommend(f, ['reader', 'ui-verifier'], { includeBrowser: false });
  assert.deepEqual(f.calls.metadata, [['q', 'large']]);
  assert.equal(proposal.rows[0].applicable, true);
  assert.equal(proposal.rows[1].applicable, false);
  assert.deepEqual(proposal.rows[1].warnings.filter(warning => warning.code === 'setup.metadataMissing'), []);
 } finally { await f.close(); }
});

test('missing metadata and image support do not produce applicable browser settings', async () => {
 const f = await fixture(); try {
  const text = await recommend(f,['ui-verifier'],{imageRoute:{provider:'p',model:'m'}});
  assert.equal(text.rows[0].applicable,false); assert.ok(text.rows[0].warnings.some(d=>d.code==='setup.imageRequired'));
  const missing = await recommend(f,['reader'],{defaultRoute:{provider:'q',model:'missing'}});
  assert.equal(missing.rows[0].applicable,false); assert.equal(missing.rows[0].proposedText,undefined);
 } finally {await f.close();}
});
test('apply rejects stale selected revisions before any write and preflights invalid inheritance', async () => {
 const f = await fixture(); try {
  const p = await recommend(f,['reader','general']);
  await f.controller.save({id:'reader',text:JSON.stringify({schemaVersion:1,id:'reader',enabled:false})});
  await assert.rejects(f.controller.operation('applySetup',payload(p)),/changed/); assert.equal(f.store.getOverride('general'),undefined);
  const fresh=await recommend(f,['general','reader']);const bad=payload(fresh);bad.rows.find(row=>row.id==='reader').text=JSON.stringify({schemaVersion:1,id:'reader',extends:'not-existing'});
  await assert.rejects(f.controller.operation('applySetup',bad),/parent|inherit/i);assert.equal(f.store.getOverride('general'),undefined);
 } finally {await f.close();}
});
test('apply orders bases before derived agents and supports an explicit valid prefix', async () => {
 const f = await fixture(); try {
  await f.controller.save({id:'derived-reader',text:JSON.stringify({schemaVersion:1,id:'derived-reader',extends:'reader'})});
  const p=await recommend(f,['derived-reader','reader']);const result=await f.controller.operation('applySetup',payload(p));
  assert.equal(result.status,'completed');assert.deepEqual(result.rows.map(row=>row.id),['reader','derived-reader']);
  assert.equal((await f.controller.catalog()).agents.find(role=>role.id==='derived-reader').model.model,'large');
 } finally {await f.close();}
});
test('setup previews resolve the selected inheritance combination without flattening or writing', async () => {
 const f=await fixture();try {
  await f.controller.save({id:'reader',text:definition({context:{targetTokens:16000,elasticTokens:48000}})});
  await f.controller.save({id:'derived-reader',text:JSON.stringify({schemaVersion:1,id:'derived-reader',extends:'reader',capabilities:['browser-observe']})});
  const before=f.store.overrides();const p=await recommend(f,['derived-reader','reader'],{defaultRoute:{provider:'p',model:'small'}});
  const child=p.rows.find(row=>row.id==='derived-reader');const base=p.rows.find(row=>row.id==='reader');
  assert.equal(child.after.context.elasticTokens,base.after.context.elasticTokens);
  assert.equal(child.after.context.elasticTokens,27129);assert.equal(parseOverrideText(child.proposedText).extends,'reader');assert.equal(parseOverrideText(child.proposedText).context,undefined);
  const all=payload(p);const childOnly=await f.controller.operation('previewSetup',{rows:all.rows.filter(row=>row.id===child.id)});
  assert.equal(childOnly.resources[child.id].context.elasticTokens,48000);assert.equal(childOnly.resources.reader.context.elasticTokens,48000);
  const baseOnly=await f.controller.operation('previewSetup',{rows:all.rows.filter(row=>row.id===base.id)});
  assert.equal(baseOnly.resources[child.id].context.elasticTokens,27129);assert.equal(baseOnly.resources[child.id].model.model,'small');
  assert.deepEqual(f.store.overrides(),before);
  assert.equal((await f.controller.operation('applySetup',all)).status,'completed');
  const actual=(await f.controller.catalog()).agents.find(role=>role.id===child.id);
  assert.deepEqual(actual.context,child.after.context);assert.deepEqual(actual.model,child.after.model);
 }finally{await f.close();}
});
test('failed route metadata yields one localized diagnostic with the original cause', async () => {
 const f=await fixture();try {
  const p=await recommend(f,['reader','general','ui-verifier'],{defaultRoute:{provider:'q',model:'missing'},imageRoute:{provider:'q',model:'missing'}});
  assert.equal(p.rows.every(row=>!row.applicable),true);assert.equal(p.diagnostics.length,1);
  assert.equal(p.diagnostics[0].code,'setup.metadataFailed');assert.deepEqual(p.diagnostics[0].params,{provider:'q',model:'missing'});
  assert.equal(p.diagnostics[0].original,'Unavailable declaration');assert.equal(p.diagnostics[0].message.includes('q/missing'),true);
  assert.deepEqual(f.calls.metadata,[['q','missing']]);
 }finally{await f.close();}
});

test('recommendation uses inherited Session output and preserves its advisory boundary', async () => {
 const f=await fixture();try {
  f.actor.options.maxTokens=24576;f.allow([]);
  await f.controller.save({id:'reader',text:definition({context:{targetTokens:16000,elasticTokens:48000}})});
  let p=await recommend(f,['reader'],{defaultRoute:{provider:'p',model:'small'}},f.actor);
  assert.equal(p.rows[0].applicable,true);assert.deepEqual(p.rows[0].after.context,{targetTokens:6553,elasticTokens:6553});
  assert.ok(p.rows[0].warnings.some(item=>item.code==='setup.authorizationWarning'));
  assert.deepEqual(f.calls.config,[]);
  f.actor.options.maxTokens=32768;
  p=await recommend(f,['reader'],{defaultRoute:{provider:'p',model:'small'}},f.actor);
  assert.equal(p.rows[0].applicable,true);assert.ok(p.rows[0].warnings.some(item=>item.code==='setup.sessionNoCapacity'));
  assert.deepEqual(p.rows[0].after.context,{targetTokens:16000,elasticTokens:48000});
  assert.equal((await f.controller.operation('applySetup',payload(p),f.actor)).status,'completed');
 }finally{await f.close();}
});
test('role output overrides Session output and no-Session estimates disclose the default assumption', async () => {
 const f=await fixture();try {
  f.actor.options.maxTokens=24576;
  await f.controller.save({id:'reader',text:definition({output:{maxTokens:1000},context:{targetTokens:16000,elasticTokens:48000}})});
  let p=await recommend(f,['reader'],{defaultRoute:{provider:'p',model:'small'}},f.actor);
  assert.deepEqual(p.rows[0].after.context,{targetTokens:16000,elasticTokens:30129});
  await f.controller.reset({id:'reader',expectedRevision:f.store.getOverride('reader').revision});
  p=await recommend(f,['reader'],{defaultRoute:{provider:'p',model:'small'}});
  assert.ok(p.rows[0].warnings.some(item=>item.code==='setup.outputAssumed'));
 }finally{await f.close();}
});

const strategyRequest = (strategy, extra = {}) => ({ roleIds: ['reader'], strategy, scopePolicy: 'fill-unconfigured', includeBrowser: false, ...extra });
const strategyPayload = (proposal, scopePolicy = 'fill-unconfigured') => ({ ...payload(proposal), setupPolicy: { scopePolicy } });

test('AI setup proposes from the active Session model and reuses preview/apply validation', async () => {
 const f = await fixture(); try {
  const proposal = await f.controller.operation('recommend', { roleIds: ['reader'], includeBrowser: false }, f.actor);
  assert.equal(proposal.proposalSource, 'ai');
  assert.deepEqual(proposal.proposalGenerator, { provider: 'p', model: 'm' });
  assert.equal(f.calls.stream.length, 1);
  const streamRequest = f.calls.stream[0];
  assert.equal(streamRequest.provider, 'p'); assert.equal(streamRequest.model, 'm');
  assert.equal(streamRequest.maxTokens, 1200); assert.ok(streamRequest.signal);
  const prompt = JSON.parse(streamRequest.messages[0].content[0].text);
  assert.equal(prompt.roles[0].id, 'reader');
  assert.deepEqual(prompt.constraints.allowedModels.map(model => [model.provider, model.model]), [['p', 'm']]);
  assert.equal(proposal.rows[0].applicable, true);
  assert.equal(proposal.rows[0].after.model.mode, 'auto');
  const request = strategyPayload(proposal);
  const preview = await f.controller.operation('previewSetup', request, f.actor);
  assert.deepEqual(preview.resources.reader.model, proposal.rows[0].after.model);
  const applied = await f.controller.operation('applySetup', { ...request, impactRevision: preview.impactRevision, acceptedIndirectRoles: [] }, f.actor);
  assert.equal(applied.status, 'completed');
  assert.equal(f.store.getOverride('reader').text, proposal.rows[0].proposedText);
 } finally { await f.close(); }
});

test('setup model choices come from the configured provider without Session policy or exact metadata', async () => {
 const f = await fixture(); try {
  f.allow([{ provider: 'p', model: 'm' }]);
  const llm = f.root.get('llm');
  llm.listModels = async provider => {
   f.calls.directory.push(provider);
   return [{ provider, id: 'image-only', name: 'Image' }, { provider, id: 'free-choice', name: 'Free choice' }];
  };
  const providers = await f.controller.operation('models', { view: 'setup-options' });
  assert.deepEqual(providers.providers.map(provider => provider.id), ['p', 'q']);
  assert.deepEqual(providers.models, []);
  const choices = await f.controller.operation('models', { view: 'setup-options', provider: 'q' }, f.actor);
  assert.deepEqual(choices.models.map(({ provider, id, name }) => [provider, id, name]), [['q', 'image-only', 'Image'], ['q', 'free-choice', 'Free choice']]);
  assert.deepEqual(f.calls.directory, ['q']);
  assert.deepEqual(f.calls.metadata, []);
  assert.equal(f.calls.observations, 0);
 } finally { await f.close(); }
});

test('AI setup generates and previews from a configured model without a Session', async () => {
 const f = await fixture(); try {
  const generatorRoute = { provider: 'q', model: 'unlisted' };
  f.root.get('llm').listModels = async provider => provider === 'p' ? [{ provider, id: 'm', name: 'M' }] : [];
  const proposal = await f.controller.operation('recommend', { roleIds: ['reader'], generatorRoute });
  assert.deepEqual(proposal.proposalGenerator, generatorRoute);
  assert.equal(proposal.rows[0].applicable, true);
  assert.equal(proposal.rows[0].warnings.some(warning => warning.code === 'setup.authorizationUnknown'), true);
  assert.equal(f.calls.stream[0].model, 'unlisted');
  assert.equal(f.calls.observations, 0);
  const preview = await f.controller.operation('previewSetup', strategyPayload(proposal));
  assert.equal(preview.resources.reader.model.mode, 'auto');
  assert.equal(f.store.getOverride('reader'), undefined);
 } finally { await f.close(); }
});

test('AI setup generator can differ from a selected Session policy and reports native route failures', async () => {
 const f = await fixture(); try {
  f.allow([{ provider: 'p', model: 'm' }]);
  const request = { roleIds: ['reader'], generatorRoute: { provider: 'q', model: 'custom' } };
  const proposal = await f.controller.operation('recommend', request, f.actor);
  assert.deepEqual(proposal.proposalGenerator, request.generatorRoute);
  assert.equal(proposal.rows[0].applicable, true);
  assert.equal(f.calls.stream[0].provider, 'q');
  f.root.get('llm').stream = async () => { throw new Error('Provider rejected the model ID'); };
  await assert.rejects(f.controller.operation('recommend', request, f.actor), /generation failed.*q\/custom.*Provider rejected the model ID/);
 } finally { await f.close(); }
});

test('AI setup validates request options before querying models or generating', async () => {
 const f = await fixture(); try {
  const request = { roleIds: ['reader'] };
  await assert.rejects(f.controller.operation('recommend', { ...request, scopePolicy: 'invalid' }, f.actor), /scope policy/);
  await assert.rejects(f.controller.operation('recommend', { ...request, resourceMigration: { general: { mode: 'reset' } } }, f.actor), /must name a selected role/);
  assert.deepEqual(f.calls.metadata, []);
  assert.equal(f.calls.stream.length, 0);
 } finally { await f.close(); }
});

test('AI setup skips generation and metadata for protected roles', async () => {
 const f = await fixture(); try {
  await f.controller.save({ id: 'reader', text: definition({ instructions: 'Keep my settings.' }) });
  const preserved = await f.controller.operation('recommend', { roleIds: ['reader'] }, f.actor);
  assert.equal(preserved.rows[0].status, 'preserved');
  assert.deepEqual(f.calls.metadata, []);
  assert.equal(f.calls.stream.length, 0);
  f.setAiOutput({ strategies: { general: { mode: 'auto', candidates: [pool()[0]], defaultCandidate: 'fast' } } });
  const mixed = await f.controller.operation('recommend', { roleIds: ['reader', 'general'] }, f.actor);
  assert.equal(mixed.rows[0].status, 'preserved');
  assert.equal(mixed.rows[1].applicable, true);
  assert.deepEqual(JSON.parse(f.calls.stream[0].messages[0].content[0].text).roles.map(role => role.id), ['general']);
 } finally { await f.close(); }
});

test('AI setup closes an active generator when a chunk arrives after cancellation', async () => {
 const f = await fixture(); try {
  const abort = new AbortController();
  let pulledAgain = false;
  let closed = false;
  f.root.get('llm').stream = async () => (async function* () {
   try {
    abort.abort();
    yield { type: 'text-delta', text: '{' };
    pulledAgain = true;
   } finally { closed = true; }
  })();
  await assert.rejects(f.controller.operation('recommend', { roleIds: ['reader'] }, f.actor, abort.signal), { name: 'AbortError' });
  assert.equal(pulledAgain, false);
  assert.equal(closed, true);
 } finally { await f.close(); }
});

test('AI setup bounds accumulated response bytes and closes the stream', async () => {
 const f = await fixture(); try {
  let pulledAgain = false;
  let closed = false;
  f.root.get('llm').stream = async () => (async function* () {
   try {
    yield { type: 'text-delta', text: '界'.repeat(50_000) };
    yield { type: 'text-delta', text: '界'.repeat(50_000) };
    pulledAgain = true;
   } finally { closed = true; }
  })();
  await assert.rejects(f.controller.operation('recommend', { roleIds: ['reader'] }, f.actor), /response is too large/);
  assert.equal(pulledAgain, false);
  assert.equal(closed, true);
 } finally { await f.close(); }
});

test('AI setup surfaces partial metadata failures without offering failed routes', async () => {
 const f = await fixture(); try {
  f.allow([{ provider: 'p', model: 'm' }, { provider: 'q', model: 'missing' }]);
  const proposal = await f.controller.operation('recommend', { roleIds: ['reader'] }, f.actor);
  assert.equal(proposal.rows[0].applicable, true);
  assert.deepEqual(JSON.parse(f.calls.stream[0].messages[0].content[0].text).constraints.allowedModels.map(model => model.model), ['m']);
  assert.deepEqual(proposal.diagnostics.map(({ code, params, original }) => ({ code, params, original })), [
   { code: 'setup.metadataFailed', params: { provider: 'q', model: 'missing' }, original: 'Unavailable declaration' },
  ]);
 } finally { await f.close(); }
});

test('AI setup rejects an oversized prompt before starting the model stream', async () => {
 const f = await fixture(); try {
  await f.controller.save({ id: 'reader', text: definition({ instructions: '界'.repeat(100_000) }) });
  await assert.rejects(f.controller.operation('recommend', { roleIds: ['reader'], scopePolicy: 'replace-selected' }, f.actor), /prompt is too large/);
  assert.equal(f.calls.stream.length, 0);
 } finally { await f.close(); }
});

test('AI setup reuses one Session route observation across directory reads', async () => {
 const f = await fixture(); try {
  f.allow([{ provider: 'p', model: 'm' }, { provider: 'p', model: 'model-1' }, { provider: 'p', model: 'model-2' }]);
  await f.controller.operation('recommend', { roleIds: ['reader'], generatorRoute: { provider: 'p', model: 'm' } }, f.actor);
  assert.ok(f.calls.observations <= 1, 'Session policy was observed repeatedly: ' + f.calls.observations);
 } finally { await f.close(); }
});

test('AI setup bounds concurrent metadata resolution across allowed routes', async () => {
 const f = await fixture(); try {
  const routes = Array.from({ length: 20 }, (_, i) => ({ provider: 'p', model: 'model-' + i }));
  f.allow([{ provider: 'p', model: 'm' }, ...routes]);
  let active = 0; let peak = 0;
  f.root.get('llm').resolveModelInfo = async (provider, model) => { active++; peak = Math.max(peak, active); await new Promise(resolve => setTimeout(resolve, 2)); active--; return { provider, id: model, name: model, context: { contextWindow: 32768 }, defaultMaxTokens: 4000, inputModalities: ['text'], reasoning: { efforts: [] } }; };
  await f.controller.operation('recommend', { roleIds: ['reader'], generatorRoute: routes[0] }, f.actor);
  assert.ok(peak <= 8, 'metadata resolution exceeded the concurrency budget: ' + peak);
 } finally { await f.close(); }
});

test('AI setup resolves only native allowed routes without enumerating provider catalogs', async () => {
 const f = await fixture(); try {
  f.allow([{ provider: 'p', model: 'm' }, { provider: 'q', model: 'large' }]);
  f.root.get('llm').listModels = async () => { throw new Error('AI setup must not enumerate provider catalogs'); };
  const proposal = await f.controller.operation('recommend', { roleIds: ['reader'], includeBrowser: false }, f.actor);
  assert.deepEqual(f.calls.directory, []);
  assert.deepEqual([...new Map(f.calls.metadata.map(route => [route.join('\0'), route])).values()], [['p', 'm'], ['q', 'large']]);
  const prompt = JSON.parse(f.calls.stream[0].messages[0].content[0].text);
  assert.deepEqual(prompt.constraints.allowedModels.map(model => [model.provider, model.model]), [['p', 'm'], ['q', 'large']]);
  assert.equal(proposal.proposalSource, 'ai');
 } finally { await f.close(); }
});

test('AI setup reports missing metadata for the selected generator before streaming', async () => {
 const f = await fixture(); try {
  const request = { roleIds: ['reader'], generatorRoute: { provider: 'q', model: 'missing' } };
  await assert.rejects(f.controller.operation('recommend', request, f.actor), /generation failed for q\/missing: Unavailable declaration/);
  assert.deepEqual(f.calls.stream, []);
 } finally { await f.close(); }
});

test('AI setup accepts an explicitly selected authorized generator route', async () => {
 const f = await fixture(); try {
  f.allow([{ provider: 'q', model: 'large' }]);
  f.setAiOutput({ strategies: { reader: { mode: 'auto', candidates: [{ id: 'selected', purpose: 'Use the selected route.', provider: 'q', model: 'large', reasoning: { mode: 'model-default' }, maxTokens: 6000 }], defaultCandidate: 'selected' } } });
  const proposal = await f.controller.operation('recommend', { roleIds: ['reader'], includeBrowser: false, generatorRoute: { provider: 'q', model: 'large' } }, f.actor);
  assert.equal(proposal.proposalSource, 'ai');
  assert.deepEqual(proposal.proposalGenerator, { provider: 'q', model: 'large' });
  assert.equal(f.calls.stream[0].provider, 'q'); assert.equal(f.calls.stream[0].model, 'large');
  const prompt = JSON.parse(f.calls.stream[0].messages[0].content[0].text);
  assert.deepEqual(prompt.constraints.proposalGenerator, { provider: 'q', model: 'large' });
  const example = prompt.output.example.strategies.reader;
  assert.equal(example.mode, 'auto');
  assert.equal(example.candidates[0].id, example.defaultCandidate);
  assert.deepEqual(example.candidates[0].reasoning, { mode: 'model-default' });
  assert.equal(proposal.rows[0].after.model.candidates[0].provider, 'q');
 } finally { await f.close(); }
});

test('AI setup honors the generator budget and handles terminal status before decoding JSON', async () => {
 const f = await fixture(); try {
  f.allow([{ provider: 'p', model: 'm' }]);
  const request = { roleIds: ['reader', 'general', 'researcher', 'architect'], includeBrowser: false };
  f.setAiOutput('{"strategies":');
  f.setFinishKind('max-tokens');
  await assert.rejects(f.controller.operation('recommend', request, f.actor), /reached the model output budget/);
  assert.equal(f.calls.stream[0].maxTokens, 4000);
 } finally { await f.close(); }
});

test('AI setup checks input plus output against the generator context before streaming', async () => {
 const f = await fixture(); try {
  const llm = f.root.get('llm');
  const resolve = llm.resolveModelInfo;
  llm.resolveModelInfo = async (...args) => ({ ...await resolve(...args), context: { contextWindow: 1024 } });
  const request = { roleIds: ['reader', 'general'], includeBrowser: false };
  await assert.rejects(f.controller.operation('recommend', request, f.actor), /generator context window.*Select fewer roles/);
  assert.equal(f.calls.stream.length, 0);
  llm.resolveModelInfo = resolve;
  f.root.get('tokenMeter').estimateMessage = () => 31_000;
  await assert.rejects(f.controller.operation('recommend', request, f.actor), /generator context window/);
  assert.equal(f.calls.stream.length, 0);
 } finally { await f.close(); }
});

test('AI setup rejects a generator that explicitly lacks text input before streaming', async () => {
 const f = await fixture(); try {
  const llm = f.root.get('llm');
  const resolve = llm.resolveModelInfo;
  llm.resolveModelInfo = async (...args) => ({ ...await resolve(...args), inputModalities: ['image'] });
  const request = { roleIds: ['reader'], includeBrowser: false };
  await assert.rejects(f.controller.operation('recommend', request, f.actor), /p\/m.*does not support text input/);
  assert.equal(f.calls.stream.length, 0);
  llm.resolveModelInfo = async (...args) => ({ ...await resolve(...args), inputModalities: undefined });
  assert.equal((await f.controller.operation('recommend', request, f.actor)).rows[0].applicable, true);
 } finally { await f.close(); }
});

test('AI setup excludes image-only role candidates and preserves a valid text row', async () => {
 const f = await fixture(); try {
  f.allow([{ provider: 'p', model: 'm' }, { provider: 'p', model: 'vision' }]);
  const llm = f.root.get('llm');
  const resolve = llm.resolveModelInfo;
  llm.resolveModelInfo = async (provider, model, signal) => ({ ...await resolve(provider, model, signal), inputModalities: model === 'vision' ? ['image'] : ['text'] });
  const auto = model => ({ mode: 'auto', candidates: [{ ...pool()[0], model }], defaultCandidate: 'fast' });
  f.setAiOutput({ strategies: { general: auto('m'), reader: auto('vision'), 'ui-verifier': auto('vision') } });
  const proposal = await f.controller.operation('recommend', { roleIds: ['general', 'reader', 'ui-verifier'] }, f.actor);
  const prompt = JSON.parse(f.calls.stream[0].messages[0].content[0].text);
  assert.deepEqual(prompt.constraints.allowedModels.map(row => row.model), ['m']);
  assert.equal(proposal.rows.find(row => row.id === 'general').applicable, true);
  for (const id of ['reader', 'ui-verifier']) {
   const row = proposal.rows.find(row => row.id === id);
   assert.equal(row.applicable, false);
   assert.match(row.warnings.find(warning => warning.code === 'setup.generatedStrategyInvalid').original, /p\/vision.*does not support text input/);
  }
 } finally { await f.close(); }
});

test('AI setup accepts a single fenced JSON response and still rejects prose', async () => {
 const f = await fixture(); try {
  const request = { roleIds: ['reader'], includeBrowser: false };
  const json = JSON.stringify({ strategies: { reader: { mode: 'auto', candidates: [pool()[0]], defaultCandidate: 'fast' } } });
  const fence = String.fromCharCode(96).repeat(3);
  const fenced = fence + 'json\r\n' + json + '\r\n' + fence;
  f.setAiOutput(fenced);
  assert.equal((await f.controller.operation('recommend', request, f.actor)).proposalSource, 'ai');
  f.setAiOutput('Here is the proposal:\n' + fenced);
  await assert.rejects(f.controller.operation('recommend', request, f.actor), /strict JSON/);
  f.setAiOutput(fence + 'json\n{"strategies":{}}\n' + fence);
  const { rows: [row] } = await f.controller.operation('recommend', request, f.actor);
  assert.equal(row.status, 'blocked');
  assert.match(row.warnings.at(-1).original, /missing a strategy for reader/);
 } finally { await f.close(); }
});

test('Session provider options and AI candidate proposals use the same explicit policy', async () => {
 const f = await fixture(); try {
  const allowed = [{ provider: 'q', model: 'large' }];
  f.allow(allowed);
  assert.deepEqual((await f.controller.models(f.actor, { view: 'options' })).explicitRoutes, allowed);
  assert.deepEqual(f.calls.directory, []);
  assert.deepEqual(f.calls.metadata, []);
  const proposal = await f.controller.operation('recommend', { roleIds: ['reader'] }, f.actor);
  assert.deepEqual(proposal.proposalGenerator, { provider: 'p', model: 'm' });
  const choices = JSON.parse(f.calls.stream[0].messages[0].content[0].text).constraints.allowedModels;
  assert.deepEqual(choices.map(({ provider, model }) => ({ provider, model })), allowed);
  assert.equal(proposal.rows[0].status, 'blocked');
  assert.match(proposal.rows[0].warnings.at(-1).original, /unavailable or unauthorized model: p\/m/);
  assert.deepEqual(f.calls.directory, []);
 } finally { await f.close(); }
});

test('one AI request proposes independent role strategies and enforces exact role coverage', async () => {
 const f = await fixture(); try {
  f.allow([{ provider: 'p', model: 'm' }, { provider: 'q', model: 'large' }]);
  const strategy = candidate => ({ mode: 'auto', candidates: [candidate], defaultCandidate: candidate.id });
  const [fast, deep] = pool();
  const request = { roleIds: ['reader', 'general'], includeBrowser: false };
  f.setAiOutput({ strategies: { reader: strategy(fast), general: strategy(deep) } });
  const proposal = await f.controller.operation('recommend', request, f.actor);
  assert.equal(f.calls.stream.length, 1);
  assert.equal(f.calls.stream[0].maxTokens, 2400);
  assert.deepEqual(proposal.rows.map(row => [row.id, row.after.model.defaultCandidate]), [['reader', 'fast'], ['general', 'deep']]);
  const preview = await f.controller.operation('previewSetup', strategyPayload(proposal), f.actor);
  assert.equal(preview.resources.reader.model.defaultCandidate, 'fast');
  assert.equal(preview.resources.general.model.defaultCandidate, 'deep');
  for (const [strategies, cause] of [
   [{ reader: strategy(fast) }, /missing a strategy for general/],
   [{ reader: strategy(fast), general: { candidates: [deep], defaultCandidate: 'deep' } }, /strategy.mode/],
  ]) {
   f.setAiOutput({ strategies });
   const partial = await f.controller.operation('recommend', request, f.actor);
   assert.deepEqual(partial.rows.map(row => [row.id, row.status, row.applicable]), [['reader', 'changed', true], ['general', 'blocked', false]]);
   assert.equal(partial.rows[1].proposedText, undefined);
   assert.equal(partial.rows[1].warnings.at(-1).code, 'setup.generatedStrategyInvalid');
   assert.match(partial.rows[1].warnings.at(-1).original, cause);
   const partialPayload = strategyPayload(partial);
   assert.deepEqual(partialPayload.rows.map(row => row.id), ['reader']);
   const partialPreview = await f.controller.operation('previewSetup', partialPayload, f.actor);
   assert.equal(partialPreview.resources.reader.model.defaultCandidate, 'fast');
   assert.deepEqual(partialPreview.resources.general, partial.rows[1].before);
  }
  f.setAiOutput({ strategies: { reader: strategy(fast), general: strategy(deep), outside: strategy(fast) } });
  await assert.rejects(f.controller.operation('recommend', request, f.actor), /strategy for an unselected role/);
  assert.equal(f.store.getOverride('reader'), undefined);
 } finally { await f.close(); }
});

test('AI setup rejects a proposal when a role changes during generation', async () => {
 const f = await fixture(); try {
  const llm = f.root.get('llm');
  const stream = llm.stream;
  llm.stream = async options => {
   await f.controller.save({ id: 'reader', text: definition({ instructions: 'Read the updated sources.' }) });
   return stream(options);
  };
  await assert.rejects(f.controller.operation('recommend', { roleIds: ['reader'], scopePolicy: 'replace-selected' }, f.actor), /Selected roles changed during AI setup/);
  assert.match(f.store.getOverride('reader').text, /Read the updated sources/);
 } finally { await f.close(); }
});

test('AI setup rejects concurrent edits to selected override text even when the role is unchanged', async () => {
 const f = await fixture(); try {
  const text = definition({ instructions: 'Read sources with care.' });
  await f.controller.save({ id: 'reader', text });
  const llm = f.root.get('llm');
  const stream = llm.stream;
  llm.stream = async options => {
   await f.controller.save({ id: 'reader', text: '# updated comment\n' + text, expectedRevision: f.store.getOverride('reader').revision });
   return stream(options);
  };
  await assert.rejects(f.controller.operation('recommend', { roleIds: ['reader'], scopePolicy: 'replace-selected' }, f.actor), /Selected roles changed during AI setup/);
  assert.match(f.store.getOverride('reader').text, /updated comment/);
 } finally { await f.close(); }
});

test('cancelled metadata workers do not start queued routes', async () => {
 const f = await fixture(); try {
  const controller = new AbortController();
  f.allow(Array.from({ length: 20 }, (_, i) => ({ provider: 'p', model: 'model-' + i })));
  let started = 0;
  f.root.get('llm').resolveModelInfo = async (provider, id) => {
   if (++started === 8) controller.abort();
   return { provider, id };
  };
  await assert.rejects(f.controller.operation('recommend', { roleIds: ['reader'], generatorRoute: { provider: 'p', model: 'model-0' } }, f.actor, controller.signal), { name: 'AbortError' });
  assert.equal(started, 8);
  assert.equal(f.calls.stream.length, 0);
 } finally { await f.close(); }
});

test('browser-only inherit strategy validates the inherited route', async () => {
 const f = await fixture(); try {
  f.allow([]);
  await assert.rejects(f.controller.operation('recommend', { roleIds: ['ui-verifier'], browserStrategy: { mode: 'inherit' } }, f.actor), /unavailable or unauthorized model: p\/m/);
  assert.equal(f.calls.stream.length, 0);
 } finally { await f.close(); }
});

test('explicit browser-only setup resolves only its selected model', async () => {
 const f = await fixture(); try {
  f.allow([{ provider: 'p', model: 'm' }, { provider: 'p', model: 'vision' }, { provider: 'q', model: 'large' }]);
  const proposal = await f.controller.operation('recommend', { roleIds: ['ui-verifier'], browserStrategy: { mode: 'fixed', provider: 'p', model: 'vision' } }, f.actor);
  assert.equal(proposal.rows[0].after.model.model, 'vision');
  assert.deepEqual(f.calls.metadata, [['p', 'vision']]);
  assert.ok(f.calls.metadata.length <= 2);
  assert.equal(f.calls.stream.length, 0);
 } finally { await f.close(); }
});

test('AI setup keeps fully excluded browser batches read-only and rejects reclassified roles', async () => {
 const f = await fixture(); try {
  const id = 'ui-verifier';
  const model = { mode: 'fixed', provider: 'p', model: 'vision' };
  const saved = await f.controller.save({ id, text: JSON.stringify({ schemaVersion: 2, id, model }) });
  const request = { roleIds: [id], includeBrowser: false, scopePolicy: 'replace-selected' };
  const stable = await f.controller.operation('recommend', request, f.actor);
  assert.equal(stable.rows[0].status, 'preserved');
  const resolved = f.controller.resolved.bind(f.controller);
  let changed = false;
  f.controller.resolved = async actor => {
   const snapshot = await resolved(actor);
   if (!changed) {
    changed = true;
    await f.store.save(id, JSON.stringify({ schemaVersion: 2, id, model, capabilities: { replace: ['files-read'] } }), saved.revision);
   }
   return snapshot;
  };
  await assert.rejects(f.controller.operation('recommend', request, f.actor), /Selected roles changed during AI setup/);
  assert.equal(f.calls.stream.length, 0);
  assert.deepEqual(f.calls.metadata, []);
 } finally { await f.close(); }
});

test('AI setup uses an explicit browser strategy without asking the generator for it', async () => {
 const f = await fixture(); try {
  f.allow([{ provider: 'p', model: 'm' }, { provider: 'p', model: 'vision' }]);
  const browserStrategy = { mode: 'fixed', provider: 'p', model: 'vision' };
  const request = { roleIds: ['reader', 'ui-verifier'], browserStrategy };
  const proposal = await f.controller.operation('recommend', request, f.actor);
  assert.deepEqual(JSON.parse(f.calls.stream[0].messages[0].content[0].text).roles.map(role => role.id), ['reader']);
  assert.deepEqual(proposal.rows.map(row => [row.id, row.status, row.after.model.mode]), [['reader', 'changed', 'auto'], ['ui-verifier', 'changed', 'fixed']]);
  assert.equal(proposal.rows[1].after.model.model, 'vision');
  const browserOnly = await f.controller.operation('recommend', { ...request, roleIds: ['ui-verifier'] }, f.actor);
  assert.equal(browserOnly.rows[0].after.model.model, 'vision');
  assert.equal(proposal.rows[0].reasons.at(-1).code, 'setup.strategyGenerated');
  for (const row of [proposal.rows[1], browserOnly.rows[0]]) {
   assert.equal(row.reasons.at(-1).code, 'setup.strategySelected');
   assert.match(row.reasons.at(-1).message, /owner-selected/);
  }
  assert.equal(f.calls.stream.length, 1);
  await assert.rejects(f.controller.operation('recommend', { ...request, browserStrategy: { ...browserStrategy, model: 'foreign' } }, f.actor), /unavailable or unauthorized model: p\/foreign/);
  assert.equal(f.calls.stream.length, 1);
 } finally { await f.close(); }
});

test('AI setup blocks a row with a generated route outside the resolved authorized model directory', async () => {
 const f = await fixture(); try {
  f.setAiOutput({ strategies: { reader: { mode: 'auto', candidates: [{ id: 'foreign', purpose: 'Use an unavailable route.', provider: 'q', model: 'large', reasoning: { mode: 'model-default' }, maxTokens: 6000 }], defaultCandidate: 'foreign' } } });
  const { rows: [row] } = await f.controller.operation('recommend', { roleIds: ['reader'], includeBrowser: false }, f.actor);
  assert.equal(row.status, 'blocked');
  assert.equal(row.applicable, false);
  assert.equal(row.proposedText, undefined);
  assert.match(row.warnings.at(-1).original, /AI setup proposal selected an unavailable or unauthorized model: q\/large/);
  assert.equal(f.calls.stream.length, 1);
 } finally { await f.close(); }
});

test('new setup defaults can be a no-op and protected overrides require explicit replacement', async () => {
 const f = await fixture(); try {
  const p = await f.controller.operation('recommend', strategyRequest({mode:'inherit'}));
  assert.equal(p.rows[0].status, 'unchanged'); assert.equal(p.rows[0].applicable, false);
  assert.equal(p.rows[0].proposedText, undefined); assert.equal(f.store.getOverride('reader'), undefined);
  assert.deepEqual(f.calls.metadata, []);
  await f.controller.save({id:'reader', text:definition({instructions:'Keep my policy'})});
  const kept = await f.controller.operation('recommend', strategyRequest({mode:'fixed',provider:'q',model:'large'}));
  assert.equal(kept.rows[0].status, 'preserved'); assert.equal(kept.rows[0].proposedText, undefined);
  assert.deepEqual(f.calls.metadata, []);
  const changed = await f.controller.operation('recommend', strategyRequest({mode:'fixed',provider:'q',model:'large'}, {scopePolicy:'replace-selected'}));
  assert.equal(changed.rows[0].status, 'changed');
  await assert.rejects(f.controller.operation('previewSetup', strategyPayload(changed)), /protected/);
  const request = strategyPayload(changed, 'replace-selected');
  const preview = await f.controller.operation('previewSetup', request);
  await assert.rejects(f.controller.operation('applySetup', request), /preview/);
  assert.equal((await f.controller.operation('applySetup', {...request, impactRevision:preview.impactRevision, acceptedIndirectRoles:[]})).status, 'completed');
  assert.match(f.store.getOverride('reader').text, /Keep my policy/);
 } finally { await f.close(); }
});

test('new auto strategy authors native independent candidates and requires an exit migration', async () => {
 const f = await fixture(); try {
  const p = await f.controller.operation('recommend', strategyRequest({mode:'auto', candidates:pool(), defaultCandidate:'deep'}), f.actor);
  assert.equal(p.rows[0].status,'changed');
  assert.deepEqual(f.calls.metadata, [['p','m'],['q','large']]);
  assert.deepEqual(f.calls.directory,[]); assert.deepEqual(f.calls.config,[]);
  const request = strategyPayload(p); const preview = await f.controller.operation('previewSetup',request,f.actor);
  assert.equal((await f.controller.operation('applySetup',{...request,impactRevision:preview.impactRevision},f.actor)).status,'completed');
  const role = (await f.controller.catalog()).agents.find(role=>role.id==='reader');
  assert.equal(role.model.mode,'auto'); assert.equal(role.model.defaultCandidate,'deep');
  assert.deepEqual(role.model.candidates,pool()); assert.equal(role.output,undefined);
  const exit = strategyRequest({mode:'inherit'},{scopePolicy:'replace-selected'});
  const blocked = await f.controller.operation('recommend',exit,f.actor);
  assert.equal(blocked.rows[0].status,'blocked'); assert.equal(blocked.rows[0].proposedText,undefined);
  const migrated = await f.controller.operation('recommend',{...exit,resourceMigration:{reader:{mode:'candidate',candidateId:'deep'}}},f.actor);
  assert.equal(migrated.rows[0].status,'changed'); assert.equal(migrated.rows[0].after.output.maxTokens,20000);
 } finally { await f.close(); }
});

test('inactive browser strategy does not validate or fetch unrelated routes and mixed contracts reject', async () => {
 const f = await fixture(); try {
  const p = await f.controller.operation('recommend',strategyRequest({mode:'inherit'},{browserStrategy:{mode:'fixed',provider:'q'}}));
  assert.equal(p.rows[0].status,'unchanged'); assert.deepEqual(f.calls.metadata,[]);
  await assert.rejects(f.controller.operation('recommend',strategyRequest({mode:'inherit'},{defaultRoute:{provider:'q',model:'large'}})),/mix/);
  await assert.rejects(f.controller.operation('recommend',strategyRequest({mode:'inherit'},{scopePolicy:'all'})),/policy/);
  await assert.rejects(f.controller.operation('recommend',{roleIds:['reader'],scopePolicy:'fill-unconfigured'}),/Select a provider and model/);
 } finally { await f.close(); }
});

test('indirect prefix impacts require version-bound acceptance even when final resources match', async () => {
 const f = await fixture(); try {
  const save = async (id,patch) => f.controller.save({id,text:JSON.stringify({schemaVersion:2,id,...patch})});
  await save('base-review',{extends:'reader',model:{mode:'fixed',provider:'p',model:'m'}});
  await save('middle-review',{extends:'base-review'});
  await save('protected-review',{extends:'middle-review'});
  const catalog = await f.controller.catalog();
  const row = (id,patch) => ({id,text:JSON.stringify({...parseOverrideText(f.store.getOverride(id).text),...patch}),roleRevision:catalog.agents.find(role=>role.id===id).revision,expectedRevision:f.store.getOverride(id).revision});
  const request = {setupPolicy:{scopePolicy:'replace-selected'},rows:[row('middle-review',{model:{mode:'fixed',provider:'p',model:'m'}}),row('base-review',{model:{mode:'fixed',provider:'q',model:'large'}})]};
  const preview = await f.controller.operation('previewSetup',request);
  const impact = preview.impacts.find(value=>value.id==='protected-review');
  assert.equal(impact.before.model.model,'m'); assert.equal(impact.after.model.model,'m');
  assert.equal(impact.prefixes.length,1); assert.equal(impact.prefixes[0].afterId,'base-review');
  assert.equal(impact.prefixes[0].resources.model.model,'large');
  const originalText = f.store.getOverride('base-review').text;
  await assert.rejects(f.controller.operation('applySetup',{...request,impactRevision:preview.impactRevision}),/Confirm every/);
  assert.equal(f.store.getOverride('base-review').text,originalText);
  await assert.rejects(f.controller.operation('applySetup',{...request,impactRevision:'stale',acceptedIndirectRoles:['protected-review']}),/preview/);
  const batch = f.store.saveBatch.bind(f.store);
  f.store.saveBatch = (rows,preflight) => batch(rows,async index=>{await preflight(index);if(index===1)throw new Error('Injected second-write failure');});
  const result = await f.controller.operation('applySetup',{...request,impactRevision:preview.impactRevision,acceptedIndirectRoles:['protected-review']});
  assert.equal(result.status,'stopped'); assert.deepEqual(result.rows.map(row=>row.status),['applied','failed']);
  assert.equal((await f.controller.catalog()).agents.find(role=>role.id==='protected-review').model.model,'large');
 } finally { await f.close(); }
});

test('selected derived roles retain intermediate prefix impacts in a batch', async () => {
 const f = await fixture(); try {
  const save = async (id, patch) => f.controller.save({ id, text: JSON.stringify({ schemaVersion: 2, id, ...patch }) });
  await save('batch-base', { extends: 'reader', model: { mode: 'fixed', provider: 'p', model: 'm' } });
  await save('batch-child', { extends: 'batch-base' });
  const catalog = await f.controller.catalog();
  const row = (id, patch) => ({ id, text: JSON.stringify({ schemaVersion: 2, id, ...patch }), roleRevision: catalog.agents.find(role => role.id === id).revision, expectedRevision: f.store.getOverride(id).revision });
  const request = { setupPolicy: { scopePolicy: 'replace-selected' }, rows: [row('batch-base', { extends: 'reader', model: { mode: 'fixed', provider: 'q', model: 'large' } }), row('batch-child', { extends: 'batch-base' })] };
  const preview = await f.controller.previewSetup(request);
  const impact = preview.impacts.find(value => value.id === 'batch-child');
  assert.equal(impact.prefixes[0].afterId, 'batch-base');
  await assert.rejects(f.controller.applySetup({ ...request, impactRevision: preview.impactRevision }), /Confirm every/);
  const originalBatch = f.store.saveBatch.bind(f.store);
  f.store.saveBatch = (rows, validate) => originalBatch(rows, async index => { await validate(index); if (index === 1) throw new Error('Injected second-write failure'); });
  const result = await f.controller.applySetup({ ...request, impactRevision: preview.impactRevision, acceptedIndirectRoles: ['batch-child'] });
  assert.deepEqual(result.rows.map(row => row.status), ['applied', 'failed']);
  assert.equal((await f.controller.catalog()).agents.find(role => role.id === 'batch-child').model.model, 'large');
 } finally { await f.close(); }
});

test('batch setup discloses global impacts hidden or altered by a project overlay', async () => {
 const f = await fixture(); try {
  const hidden = 'global-only-reader', both = 'global-and-project-reader';
  for (const id of [hidden, both]) await f.controller.save({ id, text: JSON.stringify({ schemaVersion: 2, id, extends: 'reader' }) });
  const folder = join(f.directory, '.dsh', 'agentdeck');
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, 'fixed.yml'), JSON.stringify({ schemaVersion: 2, id: hidden, model: { mode: 'fixed', provider: 'p', model: 'project-model' } }));
  await writeFile(join(folder, 'budget.yml'), JSON.stringify({ schemaVersion: 2, id: both, context: { targetTokens: 2000, elasticTokens: 4000 } }));
  const before = (await f.controller.catalog(f.actor)).agents.find(role => role.id === 'reader');
  const request = { setupPolicy: { scopePolicy: 'fill-unconfigured' }, rows: [{ id: before.id, roleRevision: before.revision,
   text: JSON.stringify({ schemaVersion: 2, id: before.id, model: { mode: 'fixed', provider: 'p', model: 'global-model' } }) }] };
  const preview = await f.controller.operation('previewSetup', request, f.actor);
  assert.equal(preview.resources[hidden].model.model, 'project-model');
  const globalOnly = preview.impacts.find(impact => impact.id === hidden);
  assert.equal(globalOnly?.scope, 'global');
  assert.equal(globalOnly.before.model.mode, 'inherit');
  assert.equal(globalOnly.prefixes[0].resources.model.model, 'global-model');
  const scoped = preview.impacts.find(impact => impact.id === both);
  assert.equal(scoped.after.context.targetTokens, 2000);
  assert.equal(scoped.global.after.model.model, 'global-model');
  assert.notEqual(scoped.global.after.context.targetTokens, 2000);
  const apply = acceptedIndirectRoles => f.controller.operation('applySetup', { ...request, impactRevision: preview.impactRevision, acceptedIndirectRoles }, f.actor);
  await assert.rejects(apply([both]), /Confirm every/);
  assert.equal(f.store.getOverride('reader'), undefined);
  assert.equal((await apply([both, hidden])).status, 'completed');
  assert.equal((await f.controller.catalog()).agents.find(role => role.id === hidden).model.model, 'global-model');
 } finally { await f.close(); }
});

test('a changed unrelated catalog invalidates setup impact consent before any new writes', async () => {
 const f = await fixture(); try {
  const p = await f.controller.operation('recommend',strategyRequest({mode:'fixed',provider:'q',model:'large'}));
  const request = strategyPayload(p);const preview = await f.controller.operation('previewSetup',request);
  await f.controller.save({id:'general',text:JSON.stringify({schemaVersion:1,id:'general',instructions:'A separate change'})});
  await assert.rejects(f.controller.operation('applySetup',{...request,impactRevision:preview.impactRevision}),/preview/);
  assert.equal(f.store.getOverride('reader'),undefined);
 } finally { await f.close(); }
});

test('batch failure preserves successful rows and leaves later rows untouched', async () => {
 const f = await fixture(); try {
  const result=await f.store.saveBatch([{id:'a',text:'first'},{id:'b',text:'second'},{id:'c',text:'third'}],async index=>{if(index===1)throw new Error('Changed external source');});
  assert.equal(result.status,'stopped');assert.deepEqual(result.rows.map(row=>row.status),['applied','failed','not-run']);
  assert.equal(f.store.getOverride('a').text,'first');assert.equal(f.store.getOverride('b'),undefined);assert.equal(f.store.getOverride('c'),undefined);
 } finally {await f.close();}
});

test('global writes reject invalidating roles in other live or stored project roots', async () => {
 const f = await fixture();
 try {
  const other = join(f.directory, 'other');
  const dir = join(other, '.dsh', 'agentdeck');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'role.yml'), JSON.stringify({ schemaVersion: 2, id: 'budget-reader', extends: 'reader', output: { maxTokens: 2000 } }));
  f.root.provide('sessionQuery', { listSessions: async () => [{ header: { cwd: other }, live: false, persisted: true }] });
  const proposal = await f.controller.operation('recommend', { roleIds: ['reader'], strategy: { mode: 'auto', candidates: [pool()[0]], defaultCandidate: 'fast' } });
  const request = strategyPayload(proposal);
  const invalidates = /invalidates derived agents: budget-reader/;
  await assert.rejects(f.controller.operation('previewSetup', request), invalidates);
  await assert.rejects(f.controller.operation('applySetup', request), invalidates);
  await assert.rejects(f.controller.save({ id: 'reader', text: request.rows[0].text }), invalidates);
  assert.equal(f.store.getOverride('reader'), undefined);
  const base = await f.controller.save({ id: 'custom-base', text: JSON.stringify({ schemaVersion: 2, id: 'custom-base', extends: 'reader' }) });
  await writeFile(join(dir, 'role.yml'), JSON.stringify({ schemaVersion: 2, id: 'project-reader', extends: 'custom-base' }));
  const agent = { ...f.actor, id: 'other', session: { ...f.actor.session, header: { cwd: other } } };
  f.root.get('workingDirectory').get = session => session.header.cwd;
  f.root.get('agents').list = () => [f.actor, agent];
  f.root.get('sessionQuery').listSessions = async () => [];
  await assert.rejects(f.controller.reset({ id: 'custom-base', expectedRevision: base.revision }), /invalidates derived agents: project-reader/);
  assert.equal(f.store.getOverride('custom-base').revision, base.revision);
 } finally { await f.close(); }
});

test('batch consent includes other projects and rejects stale project changes', async () => {
 const f = await fixture();
 try {
  const other = join(f.directory, 'other');
  const dir = join(other, '.dsh', 'agentdeck');
  await mkdir(dir, { recursive: true });
  const file = join(dir, 'role.yml');
  const role = { schemaVersion: 2, id: 'project-reader', extends: 'reader' };
  await writeFile(file, JSON.stringify(role));
  f.root.provide('sessionQuery', { listSessions: async () => [{ header: { cwd: other } }] });
  const proposal = await f.controller.operation('recommend', { roleIds: ['reader'], strategy: { mode: 'fixed', provider: 'q', model: 'large' } });
  const request = strategyPayload(proposal);
  const preview = await f.controller.operation('previewSetup', request);
  const [impact] = preview.impacts;
  assert.equal(impact.id, 'project-reader');
  assert.equal(impact.projects[0].cwd, other);
  assert.equal(impact.projects[0].after.model.mode, 'fixed');
  await assert.rejects(f.controller.operation('applySetup', { ...request, impactRevision: preview.impactRevision }), /Confirm every indirect role impact/);
  await writeFile(file, JSON.stringify({ ...role, displayName: 'Changed after preview' }));
  await assert.rejects(f.controller.operation('applySetup', { ...request, impactRevision: preview.impactRevision, acceptedIndirectRoles: [role.id] }), /preview changed/);
  const current = await f.controller.operation('previewSetup', request);
  const receipt = await f.controller.operation('applySetup', { ...request, impactRevision: current.impactRevision, acceptedIndirectRoles: [role.id] });
  assert.equal(receipt.status, 'completed');
 } finally { await f.close(); }
});

test('global-only preview labels global and divergent project impacts separately', async () => {
  const f = await fixture();
  try {
    const derived = { schemaVersion: 2, id: 'derived-reader', extends: 'reader' };
    await f.controller.save({ id: derived.id, text: JSON.stringify(derived) });
    const other = join(f.directory, 'other');
    const directory = join(other, '.dsh', 'agentdeck');
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'role.yml'), JSON.stringify({ ...derived, output: { maxTokens: 2000 } }));
    f.root.provide('sessionQuery', { listSessions: async () => [{ header: { cwd: other } }] });
    const proposal = await f.controller.recommend({ roleIds: ['reader'], strategy: { mode: 'fixed', provider: 'q', model: 'large' } });
    const preview = await f.controller.previewSetup(strategyPayload(proposal));
    const impact = preview.impacts.find(item => item.id === derived.id);
    assert.equal(impact.scope, 'global');
    assert.equal(impact.projects[0].cwd, other);
    assert.equal(impact.projects[0].after.output.maxTokens, 2000);
  } finally { await f.close(); }
});

test('setup consent covers a selected role ID when another project owns that role', async () => {
 const f = await fixture();
 try {
  const projects = ['other-a', 'other-b'].map(name => join(f.directory, name));
  const id = 'derived-reader';
  const derived = { schemaVersion: 2, id, extends: 'reader' };
  const saved = await f.controller.save({ id, text: JSON.stringify(derived) });
  for (const cwd of projects) {
   const directory = join(cwd, '.dsh', 'agentdeck');
   await mkdir(directory, { recursive: true });
   await writeFile(join(directory, 'role.yml'), JSON.stringify({ ...derived, context: { targetTokens: 1000, elasticTokens: 2000 } }));
  }
  f.allow([{ provider: 'p', model: 'm' }]);
  f.root.get('sessionQuery').listSessions = async () => projects.map(cwd => ({ header: { cwd } }));
  f.root.get('workingDirectory').get = session => session.header.cwd;
  const catalog = await f.controller.catalog(f.actor);
  const fixed = (provider, model) => ({ mode: 'fixed', provider, model });
  const request = { setupPolicy: { scopePolicy: 'replace-selected' }, rows: [
   { id: 'reader', roleRevision: catalog.agents.find(role => role.id === 'reader').revision, text: definition({ model: fixed('q', 'large') }) },
   { id, roleRevision: catalog.agents.find(role => role.id === id).revision, expectedRevision: saved.revision,
    text: JSON.stringify({ ...derived, model: fixed('p', 'm') }) },
  ] };
  const preview = await f.controller.previewSetup(request, f.actor);
  assert.deepEqual(preview.resources[id].model, fixed('p', 'm'));
  const impact = preview.impacts.find(item => item.id === id);
  assert.equal(impact?.scope, 'projects');
  assert.deepEqual(impact.projects.map(project => project.cwd), projects);
  for (const project of impact.projects) {
   assert.deepEqual(project.before.model, { mode: 'inherit' });
   assert.deepEqual(project.after.model, fixed('q', 'large'));
  }
  const apply = acceptedIndirectRoles => f.controller.applySetup({ ...request, impactRevision: preview.impactRevision, acceptedIndirectRoles }, f.actor);
  await assert.rejects(apply([]), /Confirm every indirect role impact/);
  assert.equal(f.store.getOverride('reader'), undefined);
  assert.equal((await apply([id])).status, 'completed');
 } finally { await f.close(); }
});

test('owner save allows a new project derivation but preserves roles already valid outside the project', async () => {
 const f = await fixture();
 try {
  const localParent = 'local-parent';
  const local = join(f.directory, '.dsh', 'agentdeck');
  await mkdir(local, { recursive: true });
  await writeFile(join(local, 'parent.yml'), JSON.stringify({ schemaVersion: 2, id: localParent, extends: 'reader' }));
  const role = (id, parent) => JSON.stringify({ schemaVersion: 2, id, extends: parent });
  const id = 'existing-reader';
  const saved = await f.controller.save({ id, text: role(id, 'reader') }, f.actor);
  const newId = 'local-reader';
  assert.equal((await f.controller.save({ id: newId, text: role(newId, localParent) }, f.actor)).id, newId);
  await assert.rejects(f.controller.save({ id, text: role(id, localParent), expectedRevision: saved.revision }, f.actor), /invalidates derived agents: existing-reader/);
  assert.equal(f.store.getOverride(id).revision, saved.revision);
  assert.ok((await f.controller.catalog()).agents.some(agent => agent.id === id));
 } finally { await f.close(); }
});

test('an unopened historical role FIFO is rejected without holding the save open', { skip: process.platform === 'win32' }, async () => {
 const f = await fixture();
 let pending, unblock, timer;
 try {
  const other = join(f.directory, 'historical');
  const directory = join(other, '.dsh', 'agentdeck');
  await mkdir(directory, { recursive: true });
  const path = join(directory, 'role.yml');
  execFileSync('mkfifo', [path]);
  f.root.provide('sessionQuery', { listSessions: async () => [{ header: { cwd: other } }] });
  pending = f.controller.save({ id: 'reader', text: definition({ instructions: 'Read the source.' }) }).catch(error => error);
  const outcome = await Promise.race([pending, new Promise(resolve => { timer = setTimeout(() => resolve('pending'), 750); })]);
  if (outcome === 'pending') unblock = await open(path, constants.O_RDWR | constants.O_NONBLOCK);
  assert.match(outcome?.message ?? String(outcome), /regular UTF-8 file/);
  assert.equal(f.store.getOverride('reader'), undefined);
 } finally {
  clearTimeout(timer);
  await pending;
  await unblock?.close();
  await f.close();
 }
});

test('an authorized image-only route from a saved definition cannot launch a text task', async () => {
  const f = await fixture();
  try {
    const route = { provider: 'q', model: 'image-only' };
    f.allow([route]);
    const llm = f.root.get('llm');
    const resolve = llm.resolveModelInfo;
    llm.resolveModelInfo = async (...args) => ({ ...(await resolve(...args)), inputModalities: ['image'] });
    await f.controller.save({ id: 'reader', text: definition({ model: { mode: 'fixed', ...route } }) }, f.actor);
    const preview = await f.controller.preview('reader', f.actor);
    assert.equal(preview.authorization.status, 'authorized');
    assert.equal(preview.agent.available, false);
    assert.ok(preview.diagnostics.some(message => /supports text input/.test(message)));
    await assert.rejects(f.controller.start({ role: 'reader', prompt: 'Read the task.' }, {
      agent: f.actor, callId: 'non-text', signal: new AbortController().signal,
    }), /supports text input/);
    assert.equal(f.store.snapshots().length, 0);
  } finally { await f.close(); }
});

test('AI setup uses fast candidate declarations while a different adapter remains stalled', async t => {
 const f = await fixture();
 try {
  f.allow([{ provider: 'p', model: 'm' }, { provider: 'q', model: 'stuck' }]);
  const llm = f.root.get('llm');
  const resolve = llm.resolveModelInfo;
  let markStarted;
  const started = new Promise(done => { markStarted = done; });
  let finishLate;
  let slowSignal;
  llm.resolveModelInfo = async (provider, model, signal) => {
   if (model !== 'stuck') return resolve(provider, model);
   slowSignal = signal;
   markStarted();
   return new Promise(done => { finishLate = done; });
  };
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const response = f.controller.operation('recommend', { roleIds: ['reader'] }, f.actor);
  await started;
  await new Promise(done => setImmediate(done));
  t.mock.timers.tick(10_000);
  const reply = await Promise.race([response, new Promise(done => setImmediate(() => done(null)))]);
  assert.ok(reply, 'generation must settle before the stalled metadata lookup returns');
  assert.equal(reply.rows[0].applicable, true);
   const choices = () => JSON.parse(f.calls.stream[0].messages[0].content[0].text).constraints.allowedModels.map(({ provider, model }) => ({ provider, model }));
   assert.deepEqual(choices(), [{ provider: 'p', model: 'm' }]);
  assert.equal(slowSignal.aborted, true);
  finishLate({ provider: 'q', id: 'stuck' });
  await new Promise(done => setImmediate(done));
  assert.deepEqual(choices(), [{ provider: 'p', model: 'm' }]);
 } finally { await f.close(); }
});

test('setup metadata gives later authorized routes a turn even if every first lookup stalls', async t => {
 const f = await fixture();
 const stalled = [];
 try {
  const later = { provider: 'p', model: 'm' };
  const first = Array.from({ length: 8 }, (_, index) => ({ provider: 'q', model: 'stuck-' + index }));
  f.allow([...first, later]);
  const llm = f.root.get('llm');
  const resolve = llm.resolveModelInfo;
  let started;
  const initial = new Promise(done => { started = done; });
  llm.resolveModelInfo = async (provider, model, signal) => {
   if (provider === later.provider) {
    assert.equal(stalled.filter(call => !call.signal.aborted).length, 0);
    return resolve(provider, model, signal);
   }
   return new Promise(done => {
    stalled.push({ signal, done });
    if (stalled.length === first.length) started();
   });
  };
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = f.controller.operation('recommend', { roleIds: ['reader'] }, f.actor);
  await initial;
  for (let index = 0; index < 4; index++) {
   t.mock.timers.tick(1000);
   await new Promise(done => setImmediate(done));
  }
  const result = await pending;
  assert.equal(result.rows[0].applicable, true);
   const choices = JSON.parse(f.calls.stream[0].messages[0].content[0].text).constraints.allowedModels;
   assert.deepEqual(choices.map(({ provider, model }) => ({ provider, model })), [later]);
  assert.deepEqual(f.calls.metadata, [[later.provider, later.model]]);
 } finally {
  for (const { done } of stalled) done({});
  await f.close();
 }
});

test('all setup modes require text input even for a declared image model', async () => {
 const f = await fixture();
 try {
  const route = { provider: 'q', model: 'image-only' };
  const llm = f.root.get('llm');
  const resolve = llm.resolveModelInfo;
  llm.resolveModelInfo = async (...args) => ({ ...(await resolve(...args)), inputModalities: ['image'] });
  const fixed = { mode: 'fixed', ...route };
  const auto = { mode: 'auto', candidates: [{ ...pool()[0], ...route }], defaultCandidate: 'fast' };
  for (const settings of [{ strategy: fixed }, { strategy: auto }, { defaultRoute: route, imageRoute: route }]) {
   const result = await f.controller.recommend({ roleIds: ['reader', 'ui-verifier'], ...settings });
   assert.equal(result.rows.length, 2);
   for (const row of result.rows) {
    assert.equal(row.applicable, false, row.id);
    assert.ok(row.warnings.some(warning => warning.code === 'setup.textRequired'), row.id);
   }
  }
 } finally { await f.close(); }
});

test('single form edits preserve the authored layer and single writes require current indirect consent', async () => {
 const f = await fixture();
 try {
  const id = 'derived-reader';
  const baseline = '# preserve me\nschemaVersion: 2\nid: derived-reader\nextends: reader # parent\ncapabilities: { remove: [files-read] } # list edit\n';
  const saveParent = async (maxTokens, expectedRevision) => {
   const request = { id: 'reader', text: definition({ output: { maxTokens } }), expectedRevision };
   const checked = await f.controller.previewChange(request);
   return f.controller.save({ ...request, impactRevision: checked.impactRevision, acceptedIndirectRoles: checked.impacts.map(item => item.id) });
  };
  const parentSaved = await saveParent(4096);
  const derivedSaved = await f.controller.save({ id, text: baseline });
  const patch = await f.controller.previewChange({ id, expectedRevision: derivedSaved.revision, actions: [{ op: 'set', path: ['context', 'elasticTokens'], value: 50000 }] });
  for (const comment of ['# preserve me', '# parent', '# list edit']) assert.ok(patch.text.includes(comment));
  assert.equal(parseOverrideText(patch.text).output, undefined);
  const edited = await f.controller.save({ id, text: patch.text, expectedRevision: derivedSaved.revision, impactRevision: patch.impactRevision });
  const raw = { id: 'reader', text: definition({ output: { maxTokens: 8192 } }), expectedRevision: parentSaved.revision };
  const checked = await f.controller.previewChange(raw);
  assert.equal(checked.impacts.find(item => item.id === id).before.output.maxTokens, 4096);
  assert.equal(checked.impacts.find(item => item.id === id).after.output.maxTokens, 8192);
  await assert.rejects(f.controller.save(raw), /impact preview is required/);
  await assert.rejects(f.controller.save({ ...raw, impactRevision: checked.impactRevision }), /Confirm every/);
  const newParent = await saveParent(8192, parentSaved.revision);
  const clear = await f.controller.previewChange({ id, expectedRevision: edited.revision, actions: [{ op: 'clear-output', path: ['output'] }] });
  assert.equal(parseOverrideText(clear.text).output, null);
  await f.controller.save({ id, text: clear.text, expectedRevision: edited.revision, impactRevision: clear.impactRevision });
  await assert.rejects(f.controller.save({ ...raw, expectedRevision: newParent.revision, impactRevision: checked.impactRevision, acceptedIndirectRoles: [id] }), /preview changed/);
  assert.equal((await f.controller.catalog()).agents.find(role => role.id === id).output, undefined);
  const derivedRevision = f.store.getOverride(id).revision;
  const restore = await f.controller.previewChange({ id, expectedRevision: derivedRevision, actions: [{ op: 'delete', path: ['output'] }] });
  await f.controller.save({ id, text: restore.text, expectedRevision: derivedRevision, impactRevision: restore.impactRevision });
  assert.equal((await f.controller.catalog()).agents.find(role => role.id === id).output.maxTokens, 8192);
  const reset = { id: 'reader', expectedRevision: newParent.revision };
  await assert.rejects(f.controller.reset(reset), /impact preview is required/);
  const resetPreview = await f.controller.previewChange({ ...reset, reset: true });
  await f.controller.reset({ ...reset, impactRevision: resetPreview.impactRevision, acceptedIndirectRoles: [id] });
 } finally { await f.close(); }
});

test('sparse parent output preflight preserves a schema v1 derived override', async () => {
 const f = await fixture();
 try {
  const id = 'long-document-reader';
  const original = '# legacy author text\nschemaVersion: 1\nid: long-document-reader\nextends: reader\n';
  await f.controller.save({ id, text: original });
  const draft = { id: 'reader', actions: [
   { op: 'set', path: ['schemaVersion'], value: 2 },
   { op: 'set', path: ['output'], value: { maxTokens: 4096 } },
  ] };
  const preview = await f.controller.previewChange(draft);
  const impact = preview.impacts.find(item => item.id === id);
  assert.equal(impact.before.output, undefined);
  assert.equal(impact.after.output.maxTokens, 4096);
  await assert.rejects(f.controller.save({ id: draft.id, text: preview.text, impactRevision: preview.impactRevision }), /Confirm every/);
  await f.controller.save({ id: draft.id, text: preview.text, impactRevision: preview.impactRevision, acceptedIndirectRoles: [id] });
  assert.equal(f.store.getOverride(id).text, original);
  const role = (await f.controller.catalog()).agents.find(item => item.id === id);
  assert.equal(role.schemaVersion, 2);
  assert.equal(role.output.maxTokens, 4096);
 } finally { await f.close(); }
});

test('global generation keeps the exact route through a stalled provider directory and cancels before streaming', async t => {
 const f = await fixture();
 try {
  const llm = f.root.get('llm');
  let started;
  llm.listModels = provider => {
   if (provider === 'p') return Promise.resolve([{ provider: 'p', id: 'small', name: 'Fast listed option' }]);
   started();
   return new Promise(() => {});
  };
  const input = { roleIds: ['reader'], generatorRoute: { provider: 'p', model: 'm' } };
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const begin = () => new Promise(resolve => { started = resolve; });
  const inDirectory = begin();
  const work = f.controller.operation('recommend', input);
  await inDirectory;
  assert.deepEqual(f.calls.metadata[0], ['p', 'm']);
  // Let the fast listing's promise continuations settle before reaching the mock deadline.
  await new Promise(resolve => setImmediate(resolve));
  t.mock.timers.tick(4000);
  const result = await work;
  assert.equal(result.rows[0].applicable, true);
  assert.ok(result.models.some(model => model.provider === 'p' && model.id === 'small'));
  const directoryWarnings = result.diagnostics.filter(item => item.code === 'setup.directoryIncomplete');
  assert.equal(directoryWarnings.length, 1);
  assert.match(directoryWarnings[0].original, /^q:.*deadline/i);
  assert.equal(f.calls.stream.length, 1);
  const abort = new AbortController();
  const nextDirectory = begin();
  const pending = f.controller.operation('recommend', input, undefined, abort.signal);
  await nextDirectory;
  abort.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(f.calls.stream.length, 1);
 } finally { await f.close(); }
});
