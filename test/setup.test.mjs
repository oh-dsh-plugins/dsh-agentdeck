import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
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
    });
    controller = new AgentDeckController(root, store);
  }
  await activate();
  return { actor, calls, directory,
    get root() { return root; }, get store() { return store; }, get controller() { return controller; },
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

test('new setup defaults can be a no-op and protected overrides require explicit replacement', async () => {
 const f = await fixture(); try {
  const p = await f.controller.operation('recommend', strategyRequest({mode:'inherit'}));
  assert.equal(p.rows[0].status, 'unchanged'); assert.equal(p.rows[0].applicable, false);
  assert.equal(p.rows[0].proposedText, undefined); assert.equal(f.store.getOverride('reader'), undefined);
  assert.deepEqual(f.calls.metadata, []);
  await f.controller.save({id:'reader', text:definition({instructions:'Keep my policy'})});
  const kept = await f.controller.operation('recommend', strategyRequest({mode:'fixed',provider:'q',model:'large'}));
  assert.equal(kept.rows[0].status, 'preserved'); assert.equal(kept.rows[0].proposedText, undefined);
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
  await assert.rejects(f.controller.operation('recommend',{roleIds:['reader'],scopePolicy:'fill-unconfigured'}),/strategy/);
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
