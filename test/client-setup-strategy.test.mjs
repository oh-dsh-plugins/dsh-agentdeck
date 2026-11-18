import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

// State contracts plus actual SetupPanel function rendering with a tiny host-React
// element recorder. This does not claim browser layout/accessibility verification.
const source = (await readFile(new URL('../lib/client.js',import.meta.url),'utf8'))
 .replace('createController, definitionText,','SetupPanel, createController, definitionText,');
const React = { Fragment:'fragment',createElement(type,props,...children){return typeof type==='function'?type({...props,children}):{type,props:props||{},children:children.flat(Infinity).filter(v=>v!==null&&v!==false&&v!==undefined)};} };
function loadPlugin(timers = { setTimeout, clearTimeout }) {
 let registration;
 vm.runInNewContext(source,{window:{__ModuleLoader__:{load(value){registration=value;}}},AbortController,TextEncoder,...timers});
 return registration.factory(()=>React);
}
const plugin=loadPlugin();
const clone=value=>JSON.parse(JSON.stringify(value));
const base={schemaVersion:1,id:'reader',title:{en:'Reader',zh:'阅读'},description:{en:'Read',zh:'读'},instructions:'Read.',enabled:true,capabilities:[],skills:[],scripts:[],inputs:[],deliverables:[],model:{mode:'inherit'},reasoning:{mode:'inherit-compatible'},context:{targetTokens:1000,elasticTokens:2000},revision:'reader-v1'};
const resources=role=>({model:role.model,reasoning:role.reasoning,context:role.context});
const catalog=(agents=[base],overrides=[])=>({agents,overrides,diagnostics:[],sessions:[],runtime:{}});
const ok=value=>({ok:true,value});
const deferred=()=>{let resolve;return {promise:new Promise(done=>resolve=done),resolve:value=>resolve(value)}};
function harness(responder, client = plugin){const calls=[];return {calls,controller:client.createController({rpc:{call(channel,endpoint,payload){calls.push({endpoint,payload:clone(payload)});return responder(endpoint,payload);}}})};}
function flatten(node){return !node||typeof node!=='object'?[]:[node,...(node.children||[]).flatMap(flatten)];}
function render(controller){const state=controller.getSnapshot();return plugin.SetupPanel({state,controller,t:(key,params)=>{assert.ok(Object.hasOwn(plugin.dictionaries.en,key),'Missing visible locale: '+key);return plugin.dictionaries.en[key].replace(/\{(\w+)\}/g,(_,key)=>params?.[key]??key);},locale:{resolveText:value=>value.en}});}

test('first open selects only clean unconfigured owned roles and never reseeds an emptied scope',async()=>{
 const agents=[base,{...base,id:'configured'},{...base,id:'disabled',enabled:false},{...base,id:'source',source:'/roles/source.yml'},{...base,id:'dirty'}];
 const f=harness(endpoint=>ok(endpoint==='agentdeck.catalog'?catalog(agents,[{id:'configured',text:'saved',revision:'r1'}]):{providers:[],models:[]}));
 try{await f.controller.loadCatalog();f.controller.edit('dirty','unsaved');f.controller.openSetup();
 assert.deepEqual(clone(f.controller.getSnapshot().setupOptions.roleIds),['reader']);
 f.controller.updateSetup({roleIds:[]});f.controller.set({setupOpen:false});f.controller.openSetup();assert.deepEqual(clone(f.controller.getSnapshot().setupOptions.roleIds),[]);
 f.controller.updateSetup({scopePolicy:'replace-selected'});assert.deepEqual(clone(f.controller.getSnapshot().setupOptions.roleIds),[]);
 assert.equal(f.controller.setupProtection(agents[3]),'setupSourceProtected');render(f.controller);
 }finally{f.controller.dispose();}
});

test('AI generation requires a selected Session while fixed setup can run without one', async () => {
 const f = harness(endpoint => ok(endpoint === 'agentdeck.catalog'
  ? { ...catalog(), sessions: [{ id: 'live-session' }] }
  : { providers: [], models: [], rows: [], explicitRoutes: [{ provider: 'p', model: 'm' }] }));
 try {
  await f.controller.loadCatalog();
  f.controller.openSetup();
  const button = () => flatten(render(f.controller)).find(node => node.type === 'button' && node.children.includes(plugin.dictionaries.en.setupGenerate));
  const hint = () => flatten(render(f.controller)).some(node => node.type === 'p' && node.props.id === 'agentdeck-setup-session-required');
  for (const mode of ['inherit', 'auto']) {
   f.controller.updateSetup({ mode, proposalGenerator: { provider: 'p', model: 'm' } });
   assert.equal(button().props.disabled, true);
   assert.equal(button().props['aria-describedby'], 'agentdeck-setup-session-required');
   assert.equal(hint(), true);
  }
  f.controller.updateSetup({ defaultRoute: { provider: 'p', model: 'm' } });
  assert.equal(button().props.disabled, false);
  assert.equal(hint(), false);
  f.controller.setSession('live-session');
  await f.controller.loadCatalog();
  await f.controller.loadProviders();
  f.controller.updateSetup({ mode: 'auto', proposalGenerator: { provider: 'p', model: 'm' } });
  assert.equal(button().props.disabled, false);
  assert.equal(hint(), false);
  await button().props.onClick();
  assert.equal(f.calls.find(call => call.endpoint === 'agentdeck.recommend').payload.sessionId, 'live-session');
 } finally { f.controller.dispose(); }
});

test('inherit generation uses the AI proposal route and no-op rows never preview or save',async()=>{
 const f=harness(endpoint=>ok(endpoint==='agentdeck.catalog'?catalog():endpoint==='agentdeck.recommend'?{setupPolicy:{scopePolicy:'fill-unconfigured'},rows:[{id:'reader',title:base.title,status:'unchanged',applicable:false,before:resources(base),after:resources(base),reasons:[],warnings:[]}]}:{providers:[],models:[]}));
 try{await f.controller.loadCatalog();f.controller.openSetup();f.controller.updateSetup({proposalGenerator:{provider:'p',model:'m'}});await f.controller.recommendSetup();
 const call=f.calls.find(value=>value.endpoint==='agentdeck.recommend');assert.equal(Object.hasOwn(call.payload,'strategy'),false);
 assert.deepEqual(call.payload.generatorRoute,{provider:'p',model:'m'});
 assert.equal(f.calls.some(call=>call.endpoint==='agentdeck.previewSetup'),false);assert.equal((await f.controller.applySetup()).ok,false);render(f.controller);
 }finally{f.controller.dispose();}
});

test('generator options and default come from the selected Session policy', async () => {
 const selection = { provider: 'p', model: 'denied' };
 const explicitRoutes = [{ provider: 'q', model: 'large' }, { provider: 'p', model: 'allowed' }];
 const f = harness((endpoint, { sessionId }) => ok(endpoint === 'agentdeck.catalog' ? catalog() : {
  providers: [{ id: 'p' }, { id: 'q' }], models: [], selection, explicitRoutes: sessionId === 'with-policy' ? explicitRoutes : [],
 }));
 try {
  f.controller.setSession('with-policy');
  await f.controller.loadCatalog(); f.controller.openSetup(); await f.controller.loadProviders();
  const nodes = () => flatten(render(f.controller));
  const generator = nodes().find(node => node.type === 'select' && node.children.some(child => child?.children?.includes('q/large')));
  assert.deepEqual(clone(generator.children.map(child => child.children[0])), [plugin.dictionaries.en.chooseModel, 'q/large', 'p/allowed']);
  assert.deepEqual(clone(f.controller.getSnapshot().setupOptions.proposalGenerator), explicitRoutes[0]);
  const next = generator.children.find(child => child.children.includes('p/allowed'));
  generator.props.onChange({ target: { value: next.props.value } });
  assert.deepEqual(clone(f.controller.getSnapshot().setupOptions.proposalGenerator), explicitRoutes[1]);
  f.controller.setSession('empty-policy');
  await f.controller.loadCatalog(); await f.controller.loadProviders();
  assert.equal(nodes().find(node => node.type === 'button' && node.children.includes(plugin.dictionaries.en.setupGenerate)).props.disabled, true);
  assert.ok(nodes().some(node => node.children.includes(plugin.dictionaries.en.setupNoAuthorizedGenerator)));
 } finally { f.controller.dispose(); }
});

test('a refreshed Session policy replaces an obsolete generator selection', async () => {
 let route = { provider: 'p', model: 'first' };
 const f = harness(endpoint => ok(endpoint === 'agentdeck.catalog' ? catalog() : { providers: [], models: [], explicitRoutes: [route] }));
 try {
  f.controller.setSession('session');
  await f.controller.loadCatalog();
  f.controller.openSetup();
  await f.controller.loadProviders();
  assert.deepEqual(clone(f.controller.getSnapshot().setupOptions.proposalGenerator), route);
  route = { provider: 'p', model: 'second' };
  await f.controller.loadProviders(true);
  assert.deepEqual(clone(f.controller.getSnapshot().setupOptions.proposalGenerator), route);
  f.controller.updateSetup({ proposalGenerator: { provider: '', model: '' } });
  await f.controller.loadProviders(true);
  assert.deepEqual(clone(f.controller.getSnapshot().setupOptions.proposalGenerator), { provider: '', model: '' });
 } finally { f.controller.dispose(); }
});

test('fixed setup shows migration for each included auto role in a mixed batch', async()=>{
 const auto={mode:'auto',defaultCandidate:'old',candidates:[{id:'old',maxTokens:1000}]};
 const agents=[{...base,model:auto},{...base,id:'browser',title:{en:'Browser',zh:'Browser'},model:auto,capabilities:['browser-read']}];
 const f=harness(endpoint=>ok(endpoint==='agentdeck.catalog'?catalog(agents):{providers:[],models:[]}));
 try {
  await f.controller.loadCatalog(); f.controller.openSetup(); f.controller.updateSetup({mode:'fixed'});
  const migrations=()=>flatten(render(f.controller)).filter(node=>node.type==='select'&&node.children.some(child=>child?.props?.value==='@reset'));
  assert.equal(migrations().length,2);
  f.controller.updateSetup({browserSeparate:true}); assert.equal(migrations().length,2);
  f.controller.updateSetup({includeBrowser:false}); assert.equal(migrations().length,1);
 } finally { f.controller.dispose(); }
});

test('AI proposal can outlive the ordinary read timeout but still has an aborting deadline',async()=>{
 const timers=[];
 const client=loadPlugin({setTimeout(fn,ms){const timer={fn,ms};timers.push(timer);return timer;},clearTimeout(timer){if(timer)timer.cleared=true;}});
 const pending=deferred();
 const f=harness(endpoint=>endpoint==='agentdeck.catalog'?ok(catalog()):pending.promise,client);
 try {
  await f.controller.loadCatalog();
  assert.equal(timers.at(-1).ms,15000);
  f.controller.updateSetup({roleIds:['reader']});
  const proposal=f.controller.recommendSetup();
  const deadline=timers.at(-1);
  assert.equal(deadline.ms,120000);
  deadline.fn();
  const result=await proposal;
  assert.equal(result.error.code,'requestTimeout');
  assert.equal(f.controller.getSnapshot().busy.recommend,false);
 } finally { f.controller.dispose(); }
});

test('auto setup asks AI without a prebuilt candidate pool',async()=>{
 const response={setupPolicy:{scopePolicy:'fill-unconfigured'},rows:[{id:'reader',title:base.title,status:'unchanged',applicable:false,before:resources(base),after:resources(base),reasons:[],warnings:[]}]};
 const f=harness(endpoint=>ok(endpoint==='agentdeck.catalog'?catalog():endpoint==='agentdeck.recommend'?response:{providers:[],models:[]}));
 try{await f.controller.loadCatalog();f.controller.openSetup();f.controller.updateSetup({mode:'auto'});
  const nodes=flatten(render(f.controller));
  assert.ok(nodes.some(node=>node.type==='p'&&node.children.includes(plugin.dictionaries.en.setupAiProposalHint)));
  await f.controller.recommendSetup();
  const call=f.calls.find(value=>value.endpoint==='agentdeck.recommend');
  assert.equal(Object.hasOwn(call.payload,'strategy'),false);
  assert.equal(Object.hasOwn(call.payload,'browserStrategy'),false);
  assert.deepEqual(call.payload.scopePolicy,'fill-unconfigured');
 }finally{f.controller.dispose();}
});

test('candidate inputs survive mode switches; deleted default requires an explicit new choice',async()=>{
 const f=harness(()=>ok(catalog()));try{await f.controller.loadCatalog();f.controller.openSetup();f.controller.updateSetup({mode:'auto'});
 f.controller.addSetupCandidate();const first=f.controller.getSnapshot().setupOptions.auto.candidates[0].id;
 f.controller.updateSetupCandidate(first,{purpose:'Bounded reading',provider:'p',model:'fast',maxTokens:1000});f.controller.addSetupCandidate();f.controller.addSetupCandidate();f.controller.addSetupCandidate();
 assert.equal(f.controller.getSnapshot().setupOptions.auto.candidates.length,3);
 f.controller.updateSetup({auto:{...f.controller.getSnapshot().setupOptions.auto,defaultCandidate:first}});f.controller.updateSetup({mode:'fixed'});f.controller.updateSetup({mode:'auto'});
 assert.equal(f.controller.getSnapshot().setupOptions.auto.candidates[0].purpose,'Bounded reading');f.controller.removeSetupCandidate(first);
 assert.equal(f.controller.getSnapshot().setupOptions.auto.defaultCandidate,'');assert.equal(plugin.formIssues({model:f.controller.getSnapshot().setupOptions.auto}).length>0,true);render(f.controller);
 }finally{f.controller.dispose();}
});

test('candidate caps use exact declared defaults only and stale metadata cannot overwrite a new cap',async()=>{
 const pending=deferred();const f=harness(endpoint=>endpoint==='agentdeck.models'?pending.promise:ok(catalog()));
 try{await f.controller.loadCatalog();f.controller.updateSetup({mode:'auto'});f.controller.addSetupCandidate();const id=f.controller.getSnapshot().setupOptions.auto.candidates[0].id;f.controller.updateSetupCandidate(id,{provider:'p'});
 const work=f.controller.setSetupCandidateModel(id,'m');assert.equal(f.controller.getSnapshot().setupOptions.auto.candidates[0].maxTokens,'');
 f.controller.updateSetupCandidate(id,{maxTokens:1234});pending.resolve(ok({providers:[],models:[{provider:'p',id:'m',metadataResolved:true,defaultMaxTokens:4000}]}));await work;
 assert.equal(f.controller.getSnapshot().setupOptions.auto.candidates[0].maxTokens,1234);
 f.controller.updateSetupCandidate(id,{maxTokens:''});await f.controller.setSetupCandidateModel(id,'m');assert.equal(f.controller.getSnapshot().setupOptions.auto.candidates[0].maxTokens,4000);
 }finally{f.controller.dispose();}
});

test('indirect consent is mandatory, subset-bound, and sent with the exact preview revision',async()=>{
 const row={id:'reader',title:base.title,status:'changed',applicable:true,proposedText:'new text',roleRevision:base.revision,before:resources(base),after:resources(base),reasons:[],warnings:[]};let preview=0;
 const f=harness(endpoint=>ok(endpoint==='agentdeck.catalog'?catalog():endpoint==='agentdeck.recommend'?{setupPolicy:{scopePolicy:'fill-unconfigured'},rows:[row]}:endpoint==='agentdeck.previewSetup'?{resources:{reader:resources(base)},impactRevision:'impact-'+(++preview),impacts:[{id:'derived',title:{en:'Derived'},before:resources(base),after:resources(base),prefixes:[{afterId:'reader',resources:resources(base)}]}]}:endpoint==='agentdeck.applySetup'?{status:'completed',rows:[{id:'reader',status:'applied'}]}:{providers:[],models:[]}));
 try{await f.controller.loadCatalog();f.controller.openSetup();await f.controller.recommendSetup();assert.equal((await f.controller.applySetup()).ok,false);
 const nodes=flatten(render(f.controller));assert.ok(nodes.some(node=>node.type==='button'&&node.props.disabled&&node.children.some(value=>typeof value==='string'&&value===plugin.dictionaries.en.setupApply.replace('{count}','1'))));
 f.controller.acceptSetupImpact('derived',true);await f.controller.selectSetup('reader',false);assert.deepEqual(clone(f.controller.getSnapshot().setupAccepted),{});assert.equal((await f.controller.applySetup()).ok,false);
 await f.controller.selectSetup('reader',true);f.controller.acceptSetupImpact('derived',true);await f.controller.applySetup();
 const call=f.calls.find(call=>call.endpoint==='agentdeck.applySetup');assert.equal(call.payload.impactRevision,'impact-2');assert.deepEqual(call.payload.acceptedIndirectRoles,['derived']);assert.deepEqual(call.payload.setupPolicy,{scopePolicy:'fill-unconfigured'});
 }finally{f.controller.dispose();}
});

test('constructor impact requires explicit boolean consent in the UI and apply request',async()=>{
 const row={id:'reader',title:base.title,status:'changed',applicable:true,proposedText:'new text',roleRevision:base.revision,before:resources(base),after:resources(base),reasons:[],warnings:[]};
 const impact={id:'constructor',title:{en:'Constructor'},before:resources(base),after:resources(base),prefixes:[{afterId:'reader',resources:resources(base)}]};
 const f=harness(endpoint=>ok(endpoint==='agentdeck.catalog'?catalog():endpoint==='agentdeck.recommend'?{setupPolicy:{scopePolicy:'fill-unconfigured'},rows:[row]}:endpoint==='agentdeck.previewSetup'?{resources:{reader:resources(base)},impactRevision:'constructor-impact',impacts:[impact]}:endpoint==='agentdeck.applySetup'?{status:'completed',rows:[{id:'reader',status:'applied'}]}:{providers:[],models:[]}));
 const assertConsent=accepted=>{
  const nodes=flatten(render(f.controller));
  const label=nodes.find(node=>node.type==='label'&&node.children.includes(plugin.dictionaries.en.setupAcceptImpact));
  assert.ok(label);const checkbox=flatten(label).find(node=>node.type==='input'&&node.props.type==='checkbox');
  assert.ok(checkbox);assert.equal(checkbox.props.checked,accepted);assert.equal(checkbox.props.disabled,false);
  const apply=nodes.find(node=>node.type==='button'&&node.children.includes(plugin.dictionaries.en.setupApply.replace('{count}','1')));
  assert.ok(apply);assert.equal(Boolean(apply.props.disabled),!accepted);
 };
 try{await f.controller.loadCatalog();f.controller.openSetup();await f.controller.recommendSetup();
 assert.equal(Object.hasOwn(f.controller.getSnapshot().setupAccepted,'constructor'),false);assertConsent(false);
 assert.equal((await f.controller.applySetup()).ok,false);assert.equal(f.calls.some(call=>call.endpoint==='agentdeck.applySetup'),false);
 f.controller.acceptSetupImpact('constructor',1);assertConsent(false);assert.equal((await f.controller.applySetup()).ok,false);
 f.controller.acceptSetupImpact('constructor',true);assertConsent(true);
 f.controller.acceptSetupImpact('constructor',false);assertConsent(false);assert.equal((await f.controller.applySetup()).ok,false);
 assert.equal(f.calls.some(call=>call.endpoint==='agentdeck.applySetup'),false);
 f.controller.acceptSetupImpact('constructor',true);assertConsent(true);assert.equal((await f.controller.applySetup()).ok,true);
 const call=f.calls.find(call=>call.endpoint==='agentdeck.applySetup');assert.deepEqual(call.payload.acceptedIndirectRoles,['constructor']);assert.equal(call.payload.impactRevision,'constructor-impact');
 }finally{f.controller.dispose();}
});

test('inherit mode uses the AI form and preserves fixed inputs',async()=>{
 const f=harness(endpoint=>ok(endpoint==='agentdeck.catalog'?catalog([{...base,output:{maxTokens:2000}}]):endpoint==='agentdeck.recommend'?{setupPolicy:{scopePolicy:'fill-unconfigured'},rows:[]}:{providers:[],models:[]}));
 try{await f.controller.loadCatalog();f.controller.openSetup();
 assert.equal(flatten(render(f.controller)).some(node=>node.type==='details'&&node.props.open===true),false);
 f.controller.updateSetup({inheritOutputPolicy:{mode:'clear'},proposalGenerator:{provider:'p',model:'m'}});f.controller.updateSetup({mode:'fixed'});f.controller.updateSetup({mode:'inherit'});await f.controller.recommendSetup();
 const call=f.calls.find(value=>value.endpoint==='agentdeck.recommend');assert.equal(Object.hasOwn(call.payload,'strategy'),false);
 assert.deepEqual(call.payload.generatorRoute,{provider:'p',model:'m'});
 assert.equal(f.controller.getSnapshot().setupOptions.fixed.outputPolicy.mode,'preserve');
 }finally{f.controller.dispose();}
});

test('failed setup reconciliation cannot publish a receipt into a newly selected Session', async () => {
 const pending = deferred();
 const started = deferred();
 const f = harness(endpoint => endpoint === 'agentdeck.applySetup' ? { ok: false, error: { message: 'write response lost' } } : endpoint === 'agentdeck.catalog' ? (started.resolve(), pending.promise) : ok(catalog()));
 try {
  f.controller.setSession('old');
  f.controller.set({ setupPreviewReady: true, setupSelected: { reader: true }, setupProposal: { rows: [{ id: 'reader', applicable: true, proposedText: 'text', roleRevision: 'reader-v1' }] } });
  const write = f.controller.applySetup();
  await started.promise;
  // Resolve the old catalog with a failure synchronously during its error publication.
  const unsub = f.controller.subscribe(() => {
   if (f.controller.getSnapshot().errors.catalog) {
    unsub();
    f.controller.setSession('new');
   }
  });
  pending.resolve({ ok: false, error: { message: 'readback failed' } });
  await write;
  unsub();
  assert.equal(f.controller.getSnapshot().sessionId, 'new');
  assert.equal(f.controller.getSnapshot().setupResult, null);
 } finally { f.controller.dispose(); }
});

test('options, draft edits and Session changes invalidate consent and obsolete preview replies',async()=>{
 const f=harness(()=>ok(catalog()));try{await f.controller.loadCatalog();
 for(const change of [()=>f.controller.updateSetup({includeBrowser:false}),()=>f.controller.edit('reader','typed draft'),()=>f.controller.setSession('other')]){
 f.controller.set({setupProposal:{rows:[]},setupImpactRevision:'old',setupImpacts:[{id:'derived'}],setupAccepted:{derived:true},setupPreviewReady:true});change();assert.equal(f.controller.getSnapshot().setupProposal,null);assert.deepEqual(clone(f.controller.getSnapshot().setupAccepted),{});assert.equal(f.controller.getSnapshot().setupImpactRevision,null);
 }
 }finally{f.controller.dispose();}
});
