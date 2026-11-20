import assert from 'node:assert/strict';
import { symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import Loader, { Group } from '@deepseek-ai/cordis-plugin-loader';
import AgentPresetRegistry from '@deepseek-ai/dsh-agent-preset-registry';
import SkillRegistry from '@deepseek-ai/dsh-skill';
import Storage from '@deepseek-ai/dsh-storage';
import * as StorageJson from '@deepseek-ai/dsh-storage-json';
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain';
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local';
import TokenMeter from '@deepseek-ai/dsh-token-meter';
import BasicCompaction from '@deepseek-ai/dsh-compaction-basic';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { LlmError } from '@deepseek-ai/dsh-llm';
import * as AgentDeck from '../lib/index.js';
import { textRevision } from '../lib/host/store.js';
import {
  CHILD_TEXT, ROUTE, bounded, createNativeHarness, deferred, noticeMessages,
} from '../scripts/probe-native.mjs';

import { fixture, text, success, ownerSave, start } from '../scripts/fixture-host.mjs';
let serial = 0;

// Deliberately imports the complete lib/index.js Host entry. Narrow controller
// tests cannot establish that its domain, dependency graph or preset can mount.
test('actual Host entry, JSON domain and native preset start one guarded child with one completion notice', async () => {
  const f = await fixture({ holdChild: true });
  try {
    const catalog = success(await f.call('scene_agent_catalog'));
    assert.ok(catalog.agents.some(role => role.id === 'reader'));
    assert.ok(f.domain(), 'real dsh_agentdeck storage domain must open');
    const run = success(await start(f));
    assert.equal(run.phase, 'accepted');
    assert.equal(run.status, 'started');
    const child = f.ctx.agents.get(run.childId);
    assert.ok(child, 'actual native Agent must be registered');
    await bounded(f.h.adapter.childStarted.promise, 'actual role first request');
    assert.equal(f.h.starts.length, 1);
    assert.equal(f.h.ends.length, 0);
    assert.equal(noticeMessages(f.h).length, 0);
    assert.equal(child.session.header.parentSession, f.h.parent.id);
    assert.match(child.session.header.agentPreset, /^agentdeck-reader-/);
    assert.equal(child.options.maxTokens, 1536);
    const request = f.h.adapter.requests.find(value => value.sessionId === child.id);
    assert.equal(request.maxTokens, 1536);
    const names = request.tools.map(tool => tool.name);
    assert.ok(names.includes('read'));
    assert.ok(names.includes('glob'));
    assert.ok(names.includes('agentdeck_skill'));
    for (const forbidden of ['write', 'edit', 'bash', 'scene_agent_start', 'agentdeck_run_project_script']) assert.ok(!names.includes(forbidden), forbidden);
    assert.equal(f.presets.serviceFor(child, 'compaction'), undefined, 'new roles do not mount a separate recovery service');
    assert.ok(f.ctx.get('compaction'), 'the host native recovery service remains available');
    const skill = success(await f.call('agentdeck_skill', { id: 'evidence-reading' }, { agent: child }));
    assert.equal(typeof skill, 'string');
    assert.ok(skill.length > 20);
    const hidden = await f.call('bash', {}, { agent: child });
    assert.equal(hidden.isError, true);
    const privateName = f.h.outcomes.find(({ exec }) => exec.name.startsWith('agentdeck_native_')).exec.name;
    assert.equal(f.ctx.tools.get(privateName, f.h.parent), undefined);
    assert.equal(f.ctx.tools.get(privateName, child), undefined);
    const snapshots = [...f.domain().table('snapshots').entries()].map(([, snapshot]) => snapshot);
    assert.equal(snapshots.length, 1);
    assert.equal(snapshots[0].policyVersion, 2);
    assert.equal(Object.hasOwn(snapshots[0], 'budget'), false);
    assert.equal(Object.hasOwn(snapshots[0].model, 'maxTokens'), false);
    assert.equal(snapshots[0].presetId, child.session.header.agentPreset);
    f.h.adapter.childGate.resolve();
    await f.h.waitForSettlement();
    assert.equal(f.h.ends.length, 1);
    assert.equal(f.h.ends[0].stopReason, 'completed');
    assert.equal(noticeMessages(f.h).length, 1);
    assert.ok(noticeMessages(f.h)[0].content.some(block => block.type === 'text' && block.text === CHILD_TEXT));
    const result = success(await f.call('scene_agent_result', { childId: child.id }));
    assert.equal(result.status, 'finished-unverified');
    assert.equal(result.nativeStop.kind, 'completed');
    assert.equal(result.rawText, CHILD_TEXT);
    assert.ok(result.limitations.length > 0, 'plain output must not become a validated completion report');
    const first = success(await f.call('scene_agent_result', { childId: child.id, limit: 4 }));
    const offset = first.nextOffset;
    const missing = await f.call('scene_agent_result', { childId: child.id, offset });
    assert.equal(missing.isError, true);
    assert.match(text(missing), /revision.*first page/i);
    const second = success(await f.call('scene_agent_result', { childId: child.id, offset, resultRevision: first.resultRevision }));
    assert.equal(first.rawText + second.rawText, result.rawText);
  } finally { await f.close(); }
});

test('namespaced Host controls retain native ownership while ordinary Team tool names are shadowed', async () => {
  const f = await fixture({ holdChild: true });
  let other;
  let stop;
  try {
    let shadowCalls = 0;
    for (const name of ['send_message', 'list_agents']) f.h.parent.ctx.tools.register(defineTool({
      name, description: 'Fixture Team name shadow', parameters: {},
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute() { shadowCalls++; throw new Error('Ordinary Team name must not control an AgentDeck child.'); },
    }));
    const run = success(await start(f));
    const child = f.ctx.agents.get(run.childId);
    assert.ok(child);
    f.h.adapter.childGate.resolve();
    await f.h.waitForSettlement();
    const status = success(await f.call('scene_agent_control', { action: 'status', childId: child.id }));
    assert.equal(status.status, 'finished-unverified');
    other = await f.ctx.agents.create({ sessionId: `other-parent-${++serial}`, agentOptions: ROUTE });
    const unauthorized = await f.call('scene_agent_control', { action: 'interrupt', childId: child.id }, { agent: other.agent });
    assert.equal(unauthorized.isError, true);
    assert.match(text(unauthorized), /exact direct parent/);
    f.h.adapter.childGate = deferred();
    const entered = deferred();
    stop = f.ctx.on('session/event', (session, event) => {
      if (session.id === child.id && event.type === 'turn/start') entered.resolve();
    });
    const receipt = success(await f.call('scene_agent_control', { action: 'continue', childId: child.id, message: 'Read one more bounded piece of evidence.' }));
    assert.equal(receipt.accepted, true);
    assert.equal(typeof receipt.messageId, 'string');
    await bounded(entered.promise, 'continued native child turn');
    const running = success(await f.call('scene_agent_control', { action: 'status', childId: child.id }));
    assert.equal(running.status, 'running');
    assert.equal(running.rawText, '', 'prior final answer is not current-turn success');
    success(await f.call('scene_agent_control', { action: 'interrupt', childId: child.id }));
    await f.h.waitForSettlement();
    const cancelled = success(await f.call('scene_agent_result', { childId: child.id }));
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(cancelled.nativeStop.kind, 'aborted');
    const control = f.ctx.tools.schemas(f.h.parent).find(tool => tool.name === 'scene_agent_control');
    assert.deepEqual(control.parameters.properties.action.enum, ['status', 'continue', 'interrupt']);
    f.h.adapter.childStarted = deferred();
    const teamReceipt = success(await f.h.invoke({ name: 'fixture-team', description: 'Independent native Team sibling' }));
    const team = f.ctx.agents.get(teamReceipt.subagentId);
    const teamRequest = await bounded(f.h.adapter.childStarted.promise, 'independent native Team sibling request');
    assert.ok(team);
    assert.notEqual(team.id, child.id);
    assert.equal(teamRequest.sessionId, team.id);
    if (typeof f.ctx.subagents.rootOf === 'function') assert.equal(f.ctx.subagents.rootOf(team).id, f.h.parent.id, 'the sibling shares the actual native tree');
    else {
      const children = await f.ctx.subagents.listChildren(f.h.parent.id);
      assert.ok(children.some(entry => entry.id === team.id), 'the legacy native catalog proves the same direct parent');
    }
    // Native settlement may already release the stopped AgentDeck residency.
    // Compare the current registry cut rather than an earlier execution object.
    const stoppedResidency = f.ctx.agents.get(child.id);
    const parentResidency = f.ctx.agents.get(f.h.parent.id);
    assert.ok(parentResidency);
    const release = await f.call('scene_agent_control', { action: 'release', childId: child.id });
    assert.equal(release.isError, true, 'removed release-by-id must fail rather than close the shared native tree');
    assert.ok(f.ctx.agents.get(child.id) === stoppedResidency, 'rejected release leaves the stopped AgentDeck residency unchanged');
    assert.ok(f.ctx.agents.get(team.id) === team, 'rejected release preserves the independent Team sibling');
    assert.ok(f.ctx.agents.get(f.h.parent.id) === parentResidency, 'rejected release preserves the parent residency');
    assert.equal(teamRequest.signal.aborted, false);
    assert.equal(shadowCalls, 0);
    assert.equal(new Set(f.h.starts.filter(info => info.id !== team.id).map(info => info.id)).size, 1, 'continuation must retain the same durable child identity');
  } finally { stop?.(); await other?.dispose(); await f.close(); }
});

test('Host pipeline retains policy refusal and durable same-call idempotence without fallback or duplicate starts', async () => {
  const f = await fixture({ allowNativeFallback: true });
  let release;
  try {
    const callId = `denied-start-${++serial}`;
    release = f.h.parent.ctx.tools.guard(exec => exec.name.startsWith('agentdeck_native_') ? 'fixture denies the private native delegation' : undefined);
    const denied = await start(f, {}, { id: callId });
    assert.equal(denied.isError, true);
    assert.match(text(denied), /fixture denies the private native delegation/);
    assert.equal(f.h.starts.length, 0);
    const records = [...f.domain().table('runs').entries()].map(([, value]) => value);
    assert.equal(records.length, 1);
    assert.equal(records[0].phase, 'failed');
    assert.equal(records[0].fallback, undefined);
    release(); release = undefined;
    const retried = await start(f, {}, { id: callId });
    assert.equal(retried.isError, true);
    assert.match(text(retried), /Previous startup.*failed/);
    assert.equal(f.h.starts.length, 0);
    const acceptedId = `accepted-start-${++serial}`;
    const accepted = success(await start(f, {}, { id: acceptedId }));
    const duplicate = success(await start(f, {}, { id: acceptedId }));
    assert.equal(duplicate.childId, accepted.childId);
    assert.equal(duplicate.reused, true);
    assert.equal(f.h.starts.length, 1);
    await f.h.waitForSettlement();
    assert.equal(noticeMessages(f.h).length, 1);
  } finally { release?.(); await f.close(); }
});

test('Host rejects unauthorized explicit routes and unknown roles before accepting a child', async () => {
  const f = await fixture({ allowNativeFallback: true });
  try {
    await ownerSave(f, 'reader', JSON.stringify({ schemaVersion: 1, id: 'reader', model: { mode: 'fixed', provider: ROUTE.provider, model: 'forbidden' } }));
    const listed = success(await f.call('scene_agent_catalog')).agents.find(role => role.id === 'reader');
    assert.equal(listed.available, false);
    assert.equal(listed.capabilitiesAvailable, true);
    assert.equal(listed.authorization.status, 'denied');
    assert.deepEqual(listed.configuredSelection, { provider: ROUTE.provider, model: 'forbidden' });
    const preview = success(await f.call('scene_agent_catalog', { action: 'preview', id: 'reader' }));
    assert.equal(preview.authorization.code, 'AGENTDECK_MODEL_NOT_AUTHORIZED');
    const denied = await start(f);
    assert.equal(denied.isError, true);
    assert.match(text(denied), /AGENTDECK_MODEL_NOT_AUTHORIZED/);
    assert.match(text(denied), /not authorized by this Session/);
    assert.match(text(denied), /No child was started/);
    assert.match(text(denied), /Allowed explicit routes:/);
    assert.match(text(denied), /create a new Session/);
    const explicit = await start(f, { provider: ROUTE.provider, model: 'also-forbidden' });
    assert.equal(explicit.isError, true);
    assert.match(text(explicit), /also-forbidden.*not authorized/);
    const unknown = await start(f, { role: 'nonexistent-role' });
    assert.equal(unknown.isError, true);
    assert.match(text(unknown), /Unknown or invalid AgentDeck role/);
    assert.equal(f.h.starts.length, 0);
    assert.equal([...f.domain().table('runs').entries()].length, 0);
  } finally { await f.close(); }
});

test('native capacity exhaustion through the Host does not duplicate an uncertain startup', async () => {
  const f = await fixture({ holdChild: true });
  try {
    for (let index = 0; index < 8; index++) success(await start(f, { prompt: `Read bounded evidence unit ${index}.` }));
    assert.equal(f.h.starts.length, 8);
    const rejectedId = `capacity-reject-${++serial}`;
    const overflow = await start(f, {}, { id: rejectedId });
    assert.equal(overflow.isError, true);
    assert.match(text(overflow), /capacity|active subagents|limit|pool/i);
    assert.equal(f.h.starts.length, 8);
    const retry = await start(f, {}, { id: rejectedId });
    assert.equal(retry.isError, true);
    assert.match(text(retry), /Previous startup.*uncertain/);
    assert.equal(f.h.starts.length, 8);
    f.h.adapter.childGate.resolve();
    await f.h.waitForSettlement();
    assert.equal(f.h.ends.length, 8);
    assert.equal(noticeMessages(f.h).length, 8);
  } finally { await f.close(); }
});

test('legacy model configuration actions return owner migration guidance without writing', async () => {
  const f = await fixture();
  try {
    const original = 'schemaVersion: 1\nid: reader\ninstructions: Owner instructions.\n';
    await ownerSave(f, 'reader', original);
    const before = f.domain().table('overrides').get('reader');
    for (const args of [
      { action: 'save', id: 'reader', expectedRevision: before.revision, text: original.replace('Owner', 'Model') },
      { action: 'reset', id: 'reader', expectedRevision: before.revision },
    ]) {
      const result = await f.call('scene_agent_catalog', args);
      assert.equal(result.isError, true);
      assert.match(text(result), /AGENTDECK_OWNER_CONFIGURATION_REQUIRED/);
      assert.deepEqual(f.domain().table('overrides').get('reader'), before);
    }
  } finally { await f.close(); }
});

test('resource-free snapshot survives Host reload and cold child continuation with original role and native output defaults', async () => {
  const f = await fixture({ holdChild: true });
  try {
    const run = success(await start(f));
    const child = f.ctx.agents.get(run.childId);
    assert.ok(child);
    f.h.adapter.childGate.resolve();
    await f.h.waitForSettlement();
    const presetId = child.session.header.agentPreset;
    const oldSnapshot = [...f.domain().table('snapshots').entries()].map(([, value]) => value).find(value => value.id === run.revision);
    assert.ok(oldSnapshot);
    // Cold-resume setup releases the exact public startup activation. Production
    // Host controls have no release-by-id operation in rc.3.
    const activation = f.h.activationFor(child.id);
    await bounded(activation.dispose(), 'release exact snapshot fixture activation');
    assert.equal(f.ctx.agents.get(child.id), undefined);
    await ownerSave(f, 'reader', 'schemaVersion: 1\nid: reader\ninstructions: New revision sentinel must affect only future tasks.\n');
    f.h.parent.options.maxTokens = 3072;
    await f.reloadHost();
    assert.equal(f.domain().table('snapshots').get(run.revision).policyVersion, 2);
    assert.equal(f.domain().table('snapshots').get(run.revision).model.maxTokens, undefined);
    assert.equal((await f.presets.resolve(presetId)).broken, undefined);
    f.h.adapter.childGate = deferred();
    f.h.adapter.childStarted = deferred();
    success(await f.call('scene_agent_control', { action: 'continue', childId: child.id, message: 'Continue the original authorized task from persisted evidence.' }));
    await bounded(f.h.adapter.childStarted.promise, 'cold child actual model request');
    const resumed = f.ctx.agents.get(child.id);
    assert.ok(resumed);
    assert.notEqual(resumed, child);
    await bounded(activation.dispose(), 'repeat disposal of the old exact fixture activation');
    assert.equal(f.ctx.agents.get(child.id), resumed, 'an old activation must not evict a later cold residency');
    assert.equal(resumed.session.header.agentPreset, presetId);
    assert.equal(resumed.options.maxTokens, undefined);
    const request = f.h.adapter.requests.filter(value => value.sessionId === child.id).at(-1);
    assert.equal(request.maxTokens, undefined);
    const prompt = request.messages.filter(message => message.role === 'system').flatMap(message => message.content).map(block => block.text ?? '').join('\n');
    assert.ok(prompt.includes(oldSnapshot.role.instructions));
    assert.doesNotMatch(prompt, /New revision sentinel/);
    assert.equal(f.ctx.tools.get('scene_agent_start', resumed), undefined);
    assert.ok(f.ctx.tools.get('agentdeck_skill', resumed));
    assert.equal(f.h.starts.length, 2, 'cold continuation publishes a new residency for the same durable child id');
    assert.ok(f.h.starts.every(info => info.id === child.id));
    f.h.adapter.childGate.resolve();
    await f.h.waitForSettlement();
    const result = success(await f.call('scene_agent_result', { childId: child.id }));
    assert.equal(result.rawText, CHILD_TEXT);
  } finally { await f.close(); }
});

test('factory general uses a persisted constrained native-minimal fallback only before child startup', async () => {
  const f = await fixture({ subprocess: false, allowNativeFallback: true, holdChild: true });
  try {
    const run = success(await start(f, { role: 'general' }));
    assert.equal(run.fallback.to, 'native');
    assert.match(run.fallback.reason, /before startup/);
    const child = f.ctx.agents.get(run.childId);
    assert.ok(child);
    const snapshot = f.domain().table('snapshots').get(run.revision);
    assert.equal(snapshot.composition, 'native-minimal');
    assert.equal(snapshot.role.id, 'general');
    assert.equal(snapshot.model.maxTokens, undefined);
    assert.equal(child.session.header.agentPreset, snapshot.presetId);
    assert.equal(f.presets.serviceFor(child, 'compaction'), undefined);
    assert.ok(f.ctx.get('compaction'));
    assert.equal(f.ctx.tools.get('scene_agent_start', child), undefined);
    assert.equal(f.ctx.tools.get('bash', child), undefined);
    assert.ok(f.ctx.tools.get('agentdeck_skill', child));
    f.h.adapter.childGate.resolve();
    await f.h.waitForSettlement();
    assert.equal(f.h.starts.length, 1);
    assert.equal(noticeMessages(f.h).length, 1);
    await bounded(f.h.activationFor(child.id).dispose(), 'release exact native-minimal fixture activation');
    assert.equal(f.ctx.agents.get(child.id), undefined);
    await f.reloadHost();
    f.h.adapter.childGate = deferred();
    f.h.adapter.childStarted = deferred();
    success(await f.call('scene_agent_control', { action: 'continue', childId: child.id, message: 'Continue with the same bounded native fallback composition.' }));
    await bounded(f.h.adapter.childStarted.promise, 'native-minimal cold model request');
    const resumed = f.ctx.agents.get(child.id);
    assert.equal(resumed.session.header.agentPreset, snapshot.presetId);
    assert.equal(f.ctx.tools.get('scene_agent_start', resumed), undefined);
    assert.equal(f.ctx.tools.get('bash', resumed), undefined);
    assert.equal(resumed.options.maxTokens, undefined);
    f.h.adapter.childGate.resolve();
    await f.h.waitForSettlement();
  } finally { await f.close(); }
});

test('role native compaction replaces historical input with a smaller checkpoint and continues successfully', async t => {
  const f = await fixture();
  try {
    await ownerSave(f, 'reader', 'schemaVersion: 1\nid: reader\ncontext:\n  targetTokens: 6000\n  elasticTokens: 10000\n');
    const historical = 'Historical fixture evidence with a retrievable source. '.repeat(160);
    const run = success(await start(f, { prompt: `Read the first source.\n${historical}` }));
    await f.h.waitForSettlement();
    success(await f.call('scene_agent_control', { action: 'continue', childId: run.childId, message: `Read the second source.\n${historical}` }));
    await f.h.waitForSettlement();
    success(await f.call('scene_agent_control', { action: 'continue', childId: run.childId, message: `Read the third source.\n${historical}` }));
    await f.h.waitForSettlement();
    const query = f.ctx.get('sessionQuery');
    const before = await query.readSurface(run.childId);
    const meter = f.ctx.get('tokenMeter');
    const beforeTokens = meter.measure(f.h.events.findLast(({ session }) => session.id === run.childId).session).totalTokens;
    success(await f.call('scene_agent_control', { action: 'continue', childId: run.childId, message: 'Now return the bounded verified handoff using the retained evidence.' }));
    await f.h.waitForSettlement();
    const after = await query.readSurface(run.childId);
    const log = await query.readSession(run.childId);
    const summaries = log.events.filter(event => event.type === 'compaction/summary' && event.seq > before.capturedThroughSeq);
    const afterTokens = meter.measure(f.h.events.findLast(({ session }) => session.id === run.childId).session).totalTokens;
    t.diagnostic(`Native request estimate before/after recovery: ${beforeTokens} -> ${afterTokens} tokens.`);
    assert.ok(beforeTokens > 8192, 'historical input must exceed the shared host pressure threshold before recovery');
    assert.ok(afterTokens < 8192, 'native recovery must return the continued request below the shared host threshold');
    assert.ok(summaries.length > 0, 'native pressure recovery must commit a new summary on this continuation');
    const ends = log.events.filter(event => event.type === 'compaction/end' && event.seq > before.capturedThroughSeq);
    assert.ok(ends.length > 0);
    assert.ok(ends.every(event => !event.data.error), JSON.stringify(ends));
    assert.ok(summaries.every(event => event.data.shadowedTokenCount > 0 && event.data.shadowedSeqs.length > 0));
    assert.ok(after.events.some(event => event.type === 'user/message' && typeof event.surfaceOp === 'object' && event.surfaceOp.op === 'replace'));
    const beforeSize = JSON.stringify(before.events).length;
    const afterSize = JSON.stringify(after.events).length;
    assert.ok(afterSize < beforeSize, `native current history should shrink: ${beforeSize} -> ${afterSize}`);
    assert.ok(f.h.adapter.requests.some(request => request.purpose === 'compaction'), 'summary must run through native LlmRuntime with the local adapter');
    const result = success(await f.call('scene_agent_result', { childId: run.childId }));
    assert.equal(result.nativeStop.kind, 'completed');
    assert.equal(result.rawText, CHILD_TEXT);
    assert.equal(new Set(f.h.starts.map(info => info.id)).size, 1);
    t.diagnostic(`Native compaction committed ${summaries.length} summary; serialized current surface ${beforeSize} -> ${afterSize} characters. Summary adapter is deterministic and local; this measures mechanics, not summary quality or efficiency.`);
  } finally { await f.close(); }
});

test('required custom skills reject missing dependencies before start and retain native snapshot bodies across cold restoration', async () => {
  const f = await fixture({ holdChild: true });
  let unregister;
  try {
    await ownerSave(f, 'reader', 'schemaVersion: 1\nid: reader\nskills: [task-handoff, fixture-required-missing]\n');
    const refused = await start(f);
    assert.equal(refused.isError, true);
    assert.match(text(refused), /Required role skill is unavailable: fixture-required-missing/);
    assert.equal(f.h.starts.length, 0);
    assert.equal([...f.domain().table('runs').entries()].length, 0);
    assert.equal([...f.domain().table('snapshots').entries()].length, 0);

    const nativeSkills = f.ctx.get('skills');
    const id = 'fixture-native-custom';
    const originalBody = 'Read the anchored fixture source completely. Preserve this original custom skill revision.';
    const originalBase = { kind: 'directory', path: f.h.storageRoot };
    unregister = nativeSkills.register({ name: id, description: 'Custom native fixture skill.', content: originalBody, source: 'runtime', resourceBase: originalBase });
    await ownerSave(f, 'reader', `schemaVersion: 1\nid: reader\nskills: [task-handoff, ${id}]\n`);
    const run = success(await start(f));
    const child = f.ctx.agents.get(run.childId);
    assert.ok(child);
    const storedSkill = f.domain().table('snapshots').get(run.revision).skills.find(skill => skill.id === id);
    assert.equal(storedSkill.body, originalBody);
    assert.deepEqual(storedSkill.resourceBase, originalBase);
    const loaded = success(await f.call('agentdeck_skill', { id }, { agent: child }));
    assert.ok(loaded.startsWith(originalBody));
    assert.ok(loaded.includes(JSON.stringify(originalBase)));
    unregister();
    const replacementBody = 'Replacement custom provider body must not enter an already accepted task.';
    unregister = nativeSkills.register({ name: id, description: 'Replacement native fixture skill.', content: replacementBody, source: 'runtime', resourceBase: { kind: 'opaque', description: 'Replacement resources.' } });
    assert.equal((await nativeSkills.get(id, { scope: f.h.parent, cwd: f.h.storageRoot })).content, replacementBody);
    const retained = success(await f.call('agentdeck_skill', { id }, { agent: child }));
    assert.ok(retained.startsWith(originalBody));
    assert.ok(!retained.includes(replacementBody));
    f.h.adapter.childGate.resolve();
    await f.h.waitForSettlement();
    await bounded(f.h.activationFor(child.id).dispose(), 'release exact custom-skill fixture activation');
    assert.equal(f.ctx.agents.get(child.id), undefined);
    await f.reloadHost();
    f.h.adapter.childGate = deferred();
    f.h.adapter.childStarted = deferred();
    success(await f.call('scene_agent_control', { action: 'continue', childId: child.id, message: 'Resume the original skill-bound task.' }));
    await bounded(f.h.adapter.childStarted.promise, 'custom-skill cold child request');
    const resumed = f.ctx.agents.get(child.id);
    assert.ok(resumed);
    assert.notEqual(resumed, child);
    const restored = success(await f.call('agentdeck_skill', { id }, { agent: resumed }));
    assert.ok(restored.startsWith(originalBody));
    assert.ok(restored.includes(JSON.stringify(originalBase)));
    assert.ok(!restored.includes(replacementBody));
    assert.equal(f.domain().table('snapshots').get(run.revision).skills.find(skill => skill.id === id).body, originalBody);
    f.h.adapter.childGate.resolve();
    await f.h.waitForSettlement();
    assert.equal(new Set(f.h.starts.map(info => info.id)).size, 1);
  } finally { unregister?.(); await f.close(); }
});

test('uncertain receipt is reconciled from native catalog and exact metadata without repeating work', async () => {
  const f = await fixture();
  try {
    const original = success(await start(f, {}, { id: 'lost-receipt' }));
    await f.h.waitForSettlement();
    const table = f.domain().table('runs');
    const { childId, ...saved } = table.get(original.id);
    // Fault injection in task-owned fixture data represents a crash after native
    // acceptance and before the plugin's accepted receipt reached durability.
    await table.put(original.id, { ...saved, phase: 'uncertain', error: 'Simulated lost accepted receipt.' });
    const view = success(await f.call('scene_agent_catalog', { action: 'runs' }));
    const repaired = view.runs.find(run => run.id === original.id);
    assert.equal(repaired.phase, 'accepted', JSON.stringify(view));
    assert.equal(repaired.childId, childId);
    assert.equal(table.get(original.id).childId, childId);
    const repeated = success(await start(f, {}, { id: 'lost-receipt' }));
    assert.equal(repeated.reused, true);
    assert.equal(repeated.childId, childId);
    assert.equal(new Set(f.h.starts.map(info => info.id)).size, 1);
  } finally { await f.close(); }
});

test('preset-scoped native web consumers admit general and researcher fetches while reader stays read-only', async () => {
  const f = await fixture({ web: true, holdChild: true });
  try {
    assert.equal(f.ctx.tools.get('web_fetch'), undefined, 'the parent web consumer must not be registered globally');
    const parentFetch = f.ctx.tools.get('web_fetch', f.h.parent);
    assert.ok(parentFetch, 'the real parent preset must own a native conditional fetch consumer');
    const catalog = success(await f.call('scene_agent_catalog'));
    for (const id of ['general', 'researcher']) {
      const role = catalog.agents.find(candidate => candidate.id === id);
      assert.equal(role.available, true, JSON.stringify(role));
      assert.ok(!role.missingCapabilities.includes('web-research'));
    }
    let forbiddenWrites = 0;
    for (const role of ['general', 'researcher', 'reader']) {
      f.h.adapter.childStarted = deferred();
      const run = success(await start(f, { role }));
      const request = await bounded(f.h.adapter.childStarted.promise, `${role} native web tool admission`);
      const child = f.ctx.agents.get(run.childId);
      assert.ok(child);
      const webEnabled = role !== 'reader';
      const snapshot = f.domain().table('snapshots').get(run.revision);
      assert.equal(snapshot.webTools, webEnabled);
      assert.equal(request.tools.some(tool => tool.name === 'web_fetch'), webEnabled);
      assert.equal(f.ctx.tools.get('write', child), undefined);
      child.ctx.tools.register(defineTool({
        name: 'write', description: 'Late scoped write fixture', parameters: {},
        output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
        async execute() { forbiddenWrites++; return 'disallowed write body ran'; },
      }));
      const write = await f.call('write', {}, { agent: child });
      assert.equal(write.isError, true);
      assert.match(text(write), /does not permit tool write/);
      if (webEnabled) {
        const controller = new AbortController();
        const toolSet = await f.ctx.tools.resolve({ agent: child, modelSelection: child.model.current(), signal: controller.signal });
        try {
          assert.ok(f.ctx.tools.schemas(child, toolSet).some(tool => tool.name === 'web_fetch'));
          const url = `https://fixture.invalid/${role}`;
          const fetched = await f.call('web_fetch', { url }, { agent: child, signal: controller.signal, toolSet });
          success(fetched);
          assert.match(text(fetched), /Deterministic local web evidence/);
          assert.equal(f.webCalls.at(-1).request.url, url);
          assert.equal(f.webCalls.at(-1).signal, controller.signal, 'native web consumer must preserve caller cancellation');
        } finally { toolSet.dispose(); }
      } else {
        assert.equal(f.ctx.tools.get('web_fetch', child), undefined);
        const missing = await f.call('web_fetch', { url: 'https://fixture.invalid/reader' }, { agent: child });
        assert.equal(missing.isError, true);
        assert.match(text(missing), /does not permit tool web_fetch/, 'the native role guard denies before unknown-tool dispatch');
        // Even a late plugin exposing the genuine native fetch definition must
        // not grant this reader a capability its role snapshot does not own.
        child.ctx.tools.register(parentFetch);
        const blocked = await f.call('web_fetch', { url: 'https://fixture.invalid/reader' }, { agent: child });
        assert.equal(blocked.isError, true);
        assert.match(text(blocked), /does not permit tool web_fetch/);
      }
    }
    assert.equal(forbiddenWrites, 0);
    assert.deepEqual(f.webCalls.map(call => call.request.url), ['https://fixture.invalid/general', 'https://fixture.invalid/researcher']);
    assert.ok(f.webReadyCalls.includes(ROUTE.provider), 'native conditional admission must check readiness for the actual chat route');
    f.h.adapter.childGate.resolve();
    await f.h.waitForSettlement();
    assert.equal(f.h.starts.length, 3);
    assert.equal(f.h.ends.length, 3);
    assert.equal(noticeMessages(f.h).length, 3);
  } finally { await f.close(); }
});

test('new roles accept input above the retired 48k ceiling within the actual native model window', async t => {
  const f = await fixture({ holdChild: true });
  try {
    const resolveModel = f.h.adapter.resolveModel.bind(f.h.adapter);
    f.h.adapter.resolveModel = async (...args) => ({ ...await resolveModel(...args), context: { contextWindow: 262144 } });
    const run = success(await start(f, { prompt: 'Read source. '.repeat(7500) }));
    f.h.adapter.childGate.resolve();
    await f.h.waitForSettlement();
    f.h.adapter.childGate = deferred();
    f.h.adapter.childStarted = deferred();
    success(await f.call('scene_agent_control', { action: 'continue', childId: run.childId, message: 'Next source. '.repeat(7500) }));
    await bounded(f.h.adapter.childStarted.promise, 'second large native request');
    const child = f.ctx.agents.get(run.childId);
    const tokens = f.ctx.get('tokenMeter').measure(child.session).totalTokens;
    assert.ok(tokens > 48000, String(tokens));
    const snapshot = f.domain().table('snapshots').get(run.revision);
    assert.equal(snapshot.policyVersion, 2);
    assert.equal(snapshot.budget, undefined);
    assert.equal(snapshot.model.maxTokens, undefined);
    f.h.adapter.childGate.resolve();
    await f.h.waitForSettlement();
    const result = success(await f.call('scene_agent_result', { childId: run.childId }));
    assert.equal(result.nativeStop.kind, 'completed');
    assert.equal(result.rawText, CHILD_TEXT);
    t.diagnostic('Accepted ' + tokens + ' native input tokens in a 262144-token local fixture window; no role ceiling was applied.');
  } finally { await f.close(); }
});

test('native provider context overflow compacts and retries the same child without replaying tool effects', async t => {
  const f = await fixture();
  try {
    const run = success(await start(f, { prompt: 'Retain this source as earlier authorized evidence. '.repeat(70) }));
    await f.h.waitForSettlement();
    const callsBefore = f.h.outcomes.length;
    const stream = f.h.adapter.stream.bind(f.h.adapter);
    let injected = false;
    f.h.adapter.stream = async function* (options) {
      if (options.sessionId === run.childId && options.purpose !== 'compaction' && !injected) {
        injected = true;
        f.h.adapter.requests.push(options);
        throw new LlmError('Fixture provider rejected the current context window.', 'CONTEXT_WINDOW_EXCEEDED');
      }
      yield* stream(options);
    };
    success(await f.call('scene_agent_control', { action: 'continue', childId: run.childId, message: 'Use the retained evidence and finish this same task.' }));
    await f.h.waitForSettlement();
    assert.equal(injected, true);
    assert.ok(f.h.adapter.requests.some(request => request.purpose === 'compaction'));
    const log = await f.ctx.get('sessionQuery').readSession(run.childId);
    assert.ok(log.events.some(event => event.type === 'compaction/summary'));
    const result = success(await f.call('scene_agent_result', { childId: run.childId }));
    assert.equal(result.nativeStop.kind, 'completed');
    assert.equal(result.rawText, CHILD_TEXT);
    assert.equal(new Set(f.h.starts.map(info => info.id)).size, 1);
    const during = f.h.outcomes.slice(callsBefore);
    assert.ok(during.every(({ exec }) => ['scene_agent_control', 'scene_agent_result'].includes(exec.name)));
    t.diagnostic('Injected one standard provider overflow; native summary and retry completed in the original child Session.');
  } finally { await f.close(); }
});

for (const coldResume of [false, true]) test(`Web parent-scoped recovery compacts child overflow after ${coldResume ? 'cold restore' : 'warm continuation'}`, async t => {
  const f = await fixture({ parentCompaction: true });
  try {
    // Exercise unchanged native defaults with a capacity and history large enough
    // for their 64k headroom and proportional retained tail, rather than role quotas.
    const resolveModel = f.h.adapter.resolveModel.bind(f.h.adapter);
    f.h.adapter.resolveModel = async (...args) => ({ ...await resolveModel(...args), context: { contextWindow: 262144 } });
    assert.equal(f.ctx.get('compaction'), undefined, 'Web has no Host-wide recovery backend');
    assert.ok(f.presets.serviceFor(f.h.parent, 'compaction'), 'only the parent preset initially owns recovery');
    const history = 'Retain this source as earlier authorized evidence. '.repeat(1800);
    const run = success(await start(f, { prompt: history }));
    await f.h.waitForSettlement();
    for (let turn = 0; turn < 2; turn++) {
      success(await f.call('scene_agent_control', { action: 'continue', childId: run.childId, message: history }));
      await f.h.waitForSettlement();
    }
    if (coldResume) {
      await bounded(f.h.activationFor(run.childId).dispose(), 'evict child before recovery proof');
      await f.reloadHost();
    }
    const callsBefore = f.h.outcomes.length;
    const requestsBefore = f.h.adapter.requests.length;
    const stream = f.h.adapter.stream.bind(f.h.adapter);
    let injected = false;
    f.h.adapter.stream = async function* (options) {
      if (options.sessionId === run.childId && options.purpose !== 'compaction' && !injected) {
        injected = true;
        f.h.adapter.requests.push(options);
        throw new LlmError('Fixture provider rejected the current context window.', 'CONTEXT_WINDOW_EXCEEDED');
      }
      yield* stream(options);
    };
    success(await f.call('scene_agent_control', { action: 'continue', childId: run.childId, message: 'Use the retained evidence and finish this same task.' }));
    await f.h.waitForSettlement();
    assert.equal(injected, true);
    const recovery = f.h.adapter.requests.slice(requestsBefore).filter(request => request.purpose === 'compaction');
    assert.ok(recovery.length > 0, 'provider overflow must invoke native compaction');
    assert.ok(recovery.every(request => request.sessionId === run.childId), 'the sibling parent backend must not recover this child');
    const log = await f.ctx.get('sessionQuery').readSession(run.childId);
    assert.ok(log.events.some(event => event.type === 'compaction/summary'));
    const result = success(await f.call('scene_agent_result', { childId: run.childId }));
    assert.equal(result.nativeStop.kind, 'completed');
    assert.equal(result.rawText, CHILD_TEXT);
    assert.equal(new Set(f.h.starts.map(info => info.id)).size, 1);
    assert.ok(f.h.outcomes.slice(callsBefore).every(({ exec }) => ['scene_agent_control', 'scene_agent_result'].includes(exec.name)), 'recovery must not replay tool effects');
    const snapshot = f.domain().table('snapshots').get(run.revision);
    assert.equal(snapshot.policyVersion, 2);
    assert.equal(snapshot.budget, undefined);
    assert.equal(snapshot.model.maxTokens, undefined);
    t.diagnostic('Parent-only Web scope recovered overflow in the original child with native defaults; no role quota or real model call.');
  } finally { await f.close(); }
});

test('native output cutoff remains partial with retained text and can continue in the same child', async () => {
  const f = await fixture();
  try {
    const stream = f.h.adapter.stream.bind(f.h.adapter);
    let truncate = true;
    f.h.adapter.stream = async function* (options) {
      for await (const chunk of stream(options)) yield chunk.type === 'finish' && truncate && options.purpose !== 'compaction'
        ? { type: 'finish', reason: { kind: 'max-tokens' } } : chunk;
    };
    const run = success(await start(f));
    await f.h.waitForSettlement();
    const partial = success(await f.call('scene_agent_result', { childId: run.childId }));
    assert.equal(partial.status, 'partial');
    assert.equal(partial.nativeStop.kind, 'max-tokens');
    assert.equal(partial.rawText, CHILD_TEXT);
    truncate = false;
    success(await f.call('scene_agent_control', { action: 'continue', childId: run.childId, message: 'Continue the incomplete answer from its retained text.' }));
    await f.h.waitForSettlement();
    const result = success(await f.call('scene_agent_result', { childId: run.childId }));
    assert.equal(result.nativeStop.kind, 'completed');
    assert.equal(new Set(f.h.starts.map(info => info.id)).size, 1);
  } finally { await f.close(); }
});

test('persisted policy-one task restores its historical cap and isolated recovery without migrating its snapshot', async () => {
  const f = await fixture({ holdChild: true });
  try {
    const run = success(await start(f));
    const child = f.ctx.agents.get(run.childId);
    f.h.adapter.childGate.resolve();
    await f.h.waitForSettlement();
    const original = f.domain().table('snapshots').get(run.revision);
    const historical = { ...original, policyVersion: 1,
      model: { ...original.model, maxTokens: 2048 },
      budget: { known: true, targetTokens: 6000, elasticTokens: 10000, safeInputTokens: 13312, headroomTokens: 1024, diagnostics: [] },
      role: { ...original.role, schemaVersion: 2, output: { maxTokens: 2048 }, context: { targetTokens: 6000, elasticTokens: 10000 } } };
    await f.domain().table('snapshots').put(run.revision, historical);
    await bounded(f.h.activationFor(child.id).dispose(), 'evict legacy compatibility fixture residency');
    await f.reloadHost();
    f.h.adapter.childGate = deferred();
    f.h.adapter.childStarted = deferred();
    success(await f.call('scene_agent_control', { action: 'continue', childId: child.id, message: 'Continue the historical task with its original policy.' }));
    await bounded(f.h.adapter.childStarted.promise, 'historical child restored');
    const resumed = f.ctx.agents.get(child.id);
    assert.equal(resumed.options.maxTokens, 2048);
    assert.ok(f.presets.serviceFor(resumed, 'compaction'));
    assert.equal(f.h.adapter.requests.filter(request => request.sessionId === child.id).at(-1).maxTokens, 2048);
    assert.deepEqual(f.domain().table('snapshots').get(run.revision), historical);
    f.h.adapter.childGate.resolve();
    await f.h.waitForSettlement();
    assert.equal(success(await f.call('scene_agent_result', { childId: child.id })).nativeStop.kind, 'completed');
  } finally { await f.close(); }
});

test('legacy auto candidates pin authorized route and effort without carrying retired caps into new tasks or cold resume', async () => {
  const f = await fixture({ holdChild: true });
  const definition = cap => `schemaVersion: 2\nid: auto-reader\nextends: reader\nmodel:\n  mode: auto\n  defaultCandidate: quick\n  candidates:\n    - id: quick\n      purpose: Small verified read\n      provider: ${ROUTE.provider}\n      model: ${ROUTE.model}\n      reasoning: { mode: fixed, effort: low }\n      maxTokens: ${cap}\n    - id: blocked\n      purpose: POOL_ONLY_SENTINEL\n      provider: ${ROUTE.provider}\n      model: forbidden\n      reasoning: { mode: fixed, effort: high }\n      maxTokens: 3072\nreasoning: { mode: model-default }\n`;
  try {
    await ownerSave(f, 'auto-reader', definition(2048));
    const pool = success(await f.call('scene_agent_catalog', { action: 'candidates', id: 'auto-reader' }));
    assert.equal(pool.candidates.length, 2);
    assert.equal(pool.candidates[0].authorization, 'authorized');
    assert.equal(pool.candidates[1].authorization, 'denied');
    assert.equal(pool.instructions, undefined);
    for (const args of [
      {},
      { revision: 'stale', candidateId: 'quick' },
      { revision: pool.revision, candidateId: 'missing' },
      { revision: pool.revision, candidateId: 'blocked' },
    ]) {
      const refused = await start(f, { role: 'auto-reader', ...args });
      assert.equal(refused.isError, true);
    }
    assert.equal(f.h.starts.length, 0);
    assert.equal([...f.domain().table('runs').entries()].length, 0);
    const callId = `candidate-start-${++serial}`;
    const args = { role: 'auto-reader', revision: pool.revision, candidateId: 'quick', candidateReason: 'Bounded source lookup' };
    const run = success(await start(f, args, { id: callId }));
    const duplicate = success(await start(f, args, { id: callId }));
    assert.equal(duplicate.childId, run.childId);
    assert.equal(duplicate.reused, true);
    assert.equal(f.h.starts.length, 1);
    const snapshot = f.domain().table('snapshots').get(run.revision);
    const receipt = f.domain().table('runs').get(run.id);
    assert.equal(snapshot.sourceRevision, pool.revision);
    assert.equal(snapshot.candidateId, 'quick');
    assert.equal(snapshot.role.model.mode, 'fixed');
    assert.equal(snapshot.role.model.candidates, undefined, 'The selected child does not carry the pool');
    assert.equal(receipt.decision.reason, args.candidateReason);
    assert.equal(receipt.decision.candidateId, 'quick');
    const child = f.ctx.agents.get(run.childId);
    assert.equal(child.options.maxTokens, 1536);
    const first = f.h.adapter.requests.find(value => value.sessionId === child.id);
    assert.equal(first.maxTokens, 1536);
    assert.equal(first.reasoningEffort, 'low');
    assert.equal(first.model, ROUTE.model);
    assert.doesNotMatch(JSON.stringify(first.messages), /POOL_ONLY_SENTINEL/);
    f.h.adapter.childGate.resolve();
    await f.h.waitForSettlement();
    const sameChoice = success(await start(f, { ...args, candidateReason: 'Different short explanation' }));
    await f.h.waitForSettlement();
    assert.equal(sameChoice.revision, run.revision, 'Per-run explanation must not create a new role snapshot');
    const activation = f.h.activationFor(child.id);
    await bounded(activation.dispose(), 'release candidate fixture exact activation');
    await ownerSave(f, 'auto-reader', definition(1024));
    f.h.parent.options.maxTokens = 8192;
    await f.reloadHost();
    f.h.adapter.childGate = deferred();
    f.h.adapter.childStarted = deferred();
    success(await f.call('scene_agent_control', { action: 'continue', childId: child.id, message: 'Continue the same bounded read.' }));
    await bounded(f.h.adapter.childStarted.promise, 'cold selected candidate request');
    const resumed = f.ctx.agents.get(child.id);
    const cold = f.h.adapter.requests.filter(value => value.sessionId === child.id).at(-1);
    assert.equal(resumed.options.maxTokens, undefined);
    assert.equal(cold.maxTokens, undefined);
    assert.equal(cold.reasoningEffort, 'low');
    assert.equal(f.domain().table('snapshots').get(run.revision).sourceRevision, pool.revision);
    f.h.adapter.childGate.resolve();
    await f.h.waitForSettlement();
    assert.equal(f.h.starts.length, 3);
    assert.equal(noticeMessages(f.h).length, 3);
  } finally { await f.close(); }
});
