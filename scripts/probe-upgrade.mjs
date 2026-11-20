#!/usr/bin/env node
// Separate processes, native persistence, actual Host plugin and no paid model.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fixture, success, start, ownerSave } from './fixture-host.mjs';
import { bounded, CHILD_TEXT, noticeMessages } from './probe-native.mjs';
const [phase, location] = process.argv.slice(2);
assert.ok(phase === 'create' || phase === 'resume');
const directory = resolve(location), receipt = join(directory, 'receipt.json');
const previous = phase === 'resume' ? JSON.parse(await readFile(receipt, 'utf8')) : undefined;
const f = await fixture({ directory, resumeSessionId: previous?.parentId, holdChild: true });
try {
  if (phase === 'create') {
    const run = success(await start(f));
    await bounded(f.h.adapter.childStarted.promise, 'old-host native child request');
    const child = f.ctx.agents.get(run.childId);
    const snapshot = f.domain().table('snapshots').get(run.revision);
    assert.equal(snapshot.policyVersion, 2);
    const request = f.h.adapter.requests.find(item => item.sessionId === child.id);
    const toolNames = request.tools.map(item => item.name).sort();
    assert.ok(toolNames.includes('read')); assert.ok(!toolNames.includes('write'));
    f.h.adapter.childGate.resolve(); await f.h.waitForSettlement();
    assert.equal(noticeMessages(f.h).length, 1);
    await ownerSave(f, 'reader', "schemaVersion: 1\nid: reader\ninstructions: Upgrade override sentinel applies to future tasks only.\n");
    await writeFile(receipt, JSON.stringify({ parentId: f.h.parent.id, run, snapshot, presetId: child.session.header.agentPreset, toolNames }, null, 2));
  } else {
    assert.equal(f.h.parent.id, previous.parentId);
    assert.deepEqual(f.domain().table('snapshots').get(previous.run.revision), previous.snapshot, 'Upgrade must not rewrite snapshots');
    assert.equal(f.domain().table('runs').get(previous.run.id).childId, previous.run.childId);
    assert.match(f.domain().table('overrides').get('reader').text, /Upgrade override sentinel/);
    success(await f.call('scene_agent_control', { action: 'continue', childId: previous.run.childId, message: 'Continue the original authorized task after the host upgrade.' }));
    await bounded(f.h.adapter.childStarted.promise, 'upgraded-host original child request');
    const child = f.ctx.agents.get(previous.run.childId);
    assert.ok(child); assert.equal(child.session.header.parentSession, previous.parentId);
    assert.equal(child.session.header.agentPreset, previous.presetId);
    const request = f.h.adapter.requests.find(item => item.sessionId === child.id);
    assert.deepEqual(request.tools.map(item => item.name).sort(), previous.toolNames);
    assert.equal(request.maxTokens, undefined, 'Native output defaults remain native on cold resume');
    const prompt = request.messages.filter(item => item.role === 'system').flatMap(item => item.content).map(item => item.text ?? '').join('\n');
    assert.ok(prompt.includes(previous.snapshot.role.instructions)); assert.doesNotMatch(prompt, /Upgrade override sentinel/);
    assert.ok(f.h.starts.every(item => item.id === previous.run.childId));
    f.h.adapter.childGate.resolve(); await f.h.waitForSettlement();
    assert.equal(noticeMessages(f.h).length, 1);
    const result = success(await f.call('scene_agent_result', { childId: previous.run.childId }));
    assert.equal(result.rawText, CHILD_TEXT); assert.equal(result.nativeStop.kind, 'completed');
  }
  console.log(JSON.stringify({ phase, host: process.env.AGENTDECK_EXPECT_DSH_VERSION, parentId: f.h.parent.id, childId: previous?.run.childId ?? f.h.starts[0].id, verified: true }));
} finally { await f.close(); }
