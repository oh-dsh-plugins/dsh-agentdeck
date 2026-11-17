import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

// State contracts plus actual SetupPanel function rendering with a tiny host-React
// element recorder. This does not claim browser layout/accessibility verification.
const source = (await readFile(new URL('../lib/client.js',import.meta.url),'utf8'))
 .replace('createController, definitionText,','SetupPanel, createController, definitionText,');
let registration;
vm.runInNewContext(source,{window:{__ModuleLoader__:{load(value){registration=value;}}},AbortController,TextEncoder,setTimeout,clearTimeout});
const React = { Fragment:'fragment',createElement(type,props,...children){return typeof type==='function'?type({...props,children}):{type,props:props||{},children:children.flat(Infinity).filter(v=>v!==null&&v!==false&&v!==undefined)};} };
const plugin=registration.factory(()=>React);
const clone=value=>JSON.parse(JSON.stringify(value));
const base={schemaVersion:1,id:'reader',title:{en:'Reader',zh:'阅读'},description:{en:'Read',zh:'读'},instructions:'Read.',enabled:true,capabilities:[],skills:[],scripts:[],inputs:[],deliverables:[],model:{mode:'inherit'},reasoning:{mode:'inherit-compatible'},context:{targetTokens:1000,elasticTokens:2000},revision:'reader-v1'};
const resources=role=>({model:role.model,reasoning:role.reasoning,context:role.context});
const catalog=(agents=[base],overrides=[])=>({agents,overrides,diagnostics:[],sessions:[],runtime:{}});
const ok=value=>({ok:true,value});
const deferred=()=>{let resolve;return {promise:new Promise(done=>resolve=done),resolve:value=>resolve(value)}};
function harness(responder){const calls=[];return {calls,controller:plugin.createController({rpc:{call(channel,endpoint,payload){calls.push({endpoint,payload:clone(payload)});return responder(endpoint,payload);}}})};}
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

test('inherit generation needs no route and no-op rows never preview or save',async()=>{
 const f=harness(endpoint=>ok(endpoint==='agentdeck.catalog'?catalog():endpoint==='agentdeck.recommend'?{setupPolicy:{scopePolicy:'fill-unconfigured'},rows:[{id:'reader',title:base.title,status:'unchanged',applicable:false,before:resources(base),after:resources(base),reasons:[],warnings:[]}]}:{providers:[],models:[]}));
 try{await f.controller.loadCatalog();f.controller.openSetup();await f.controller.recommendSetup();
 assert.deepEqual(f.calls.find(call=>call.endpoint==='agentdeck.recommend').payload.strategy,{mode:'inherit'});
 assert.equal(f.calls.some(call=>call.endpoint==='agentdeck.previewSetup'),false);assert.equal((await f.controller.applySetup()).ok,false);render(f.controller);
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

test('existing inherited output exposes an explicit clear choice without contaminating fixed inputs',async()=>{
 const f=harness(endpoint=>ok(endpoint==='agentdeck.catalog'?catalog([{...base,output:{maxTokens:2000}}]):endpoint==='agentdeck.recommend'?{setupPolicy:{scopePolicy:'fill-unconfigured'},rows:[]}:{providers:[],models:[]}));
 try{await f.controller.loadCatalog();f.controller.openSetup();
 assert.ok(flatten(render(f.controller)).some(node=>node.type==='details'&&node.props.open===true));
 f.controller.updateSetup({inheritOutputPolicy:{mode:'clear'}});f.controller.updateSetup({mode:'fixed'});f.controller.updateSetup({mode:'inherit'});await f.controller.recommendSetup();
 assert.deepEqual(f.calls.find(call=>call.endpoint==='agentdeck.recommend').payload.strategy,{mode:'inherit',outputPolicy:{mode:'clear'}});
 assert.equal(f.controller.getSnapshot().setupOptions.fixed.outputPolicy.mode,'preserve');
 }finally{f.controller.dispose();}
});

test('options, draft edits and Session changes invalidate consent and obsolete preview replies',async()=>{
 const f=harness(()=>ok(catalog()));try{await f.controller.loadCatalog();
 for(const change of [()=>f.controller.updateSetup({includeBrowser:false}),()=>f.controller.edit('reader','typed draft'),()=>f.controller.setSession('other')]){
 f.controller.set({setupProposal:{rows:[]},setupImpactRevision:'old',setupImpacts:[{id:'derived'}],setupAccepted:{derived:true},setupPreviewReady:true});change();assert.equal(f.controller.getSnapshot().setupProposal,null);assert.deepEqual(clone(f.controller.getSnapshot().setupAccepted),{});assert.equal(f.controller.getSnapshot().setupImpactRevision,null);
 }
 }finally{f.controller.dispose();}
});
