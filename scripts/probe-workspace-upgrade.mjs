// Independent processes prove the RC-to-Alpha workspace boundary with native persistence.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { fixture, start, success, text } from './fixture-host.mjs';
import { ownerConnection } from './fixture-web.mjs';
import { bounded, liveHost, noticeMessages } from './probe-native.mjs';

async function captureThroughClient(ctx) {
  const owner = await ownerConnection(ctx);
  let controller;
  try {
    const entry = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8');
    let registration;
    vm.runInNewContext(entry, {
      window: { __ModuleLoader__: { load(module) { registration = module; } } },
      AbortController, TextEncoder, setTimeout, clearTimeout,
    });
    assert.equal(registration.id, 'dsh-agentdeck');
    const plugin = registration.factory(name => { assert.equal(name, 'react'); return {}; });
    controller = plugin.createController({ rpc: owner.rpc });
    const catalog = await controller.loadCatalog();
    assert.equal(catalog.value.runtime.canCaptureWorkspaceCuts, true);
    const result = await controller.captureWorkspaceCuts();
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(controller.getSnapshot().workspaceCapture, result.value);
    assert.ok(owner.requests.some(request => request.path === 'agentdeck/agentdeck.captureWorkspaceCuts' && request.status === 200));
    return result.value;
  } finally {
    try { controller?.dispose(); } finally { await owner.close(); }
  }
}

const [phase, location, sourceEntry, layout = 'inherited'] = process.argv.slice(2);
const directory = resolve(location);
const receiptPath = join(directory, 'workspace-receipt.json');
const signal = new AbortController().signal;
if (phase === 'seed') {
  assert.ok(!liveHost && sourceEntry);
  const plugin = await import(pathToFileURL(resolve(sourceEntry)));
  const f = await fixture({ directory, plugin, holdChild: true });
  try {
    const expected = layout === 'moved' ? join(f.h.storageRoot, 'project-b') : f.h.storageRoot;
    if (layout === 'moved') await mkdir(expected);
    const run = success(await start(f, layout === 'moved' ? { cwd: expected } : {}));
    await bounded(f.h.adapter.childStarted.promise, 'published AgentDeck child request');
    const child = f.ctx.agents.get(run.childId);
    assert.equal(f.ctx.get('workingDirectory').get(child.session), expected);
    const snapshot = f.domain().table('snapshots').get(run.revision);
    assert.equal(snapshot.expectedWorkspace, undefined);
    f.h.adapter.childGate.resolve();
    await f.h.waitForSettlement();
    await writeFile(receiptPath, JSON.stringify({ run, snapshot, expected, layout }));
  } finally { await f.close(); }
} else {
  const { run, snapshot, expected, layout } = JSON.parse(await readFile(receiptPath, 'utf8'));
  const f = await fixture({ directory, parentSessionId: 'workspace-capture-probe',
    resumeSessionId: phase === 'capture' ? undefined : run.parentId, holdChild: true });
  try {
    if (phase === 'capture-active' || phase === 'capture') {
      assert.ok(!liveHost);
      assert.deepEqual(f.domain().table('snapshots').get(run.revision), snapshot);
      const cut = await captureThroughClient(f.ctx);
      if (phase === 'capture-active') {
        assert.equal(f.ctx.agents.get(run.parentId), f.h.parent);
        assert.deepEqual(cut.captured, []);
        assert.equal(cut.pending.length, 1);
        assert.equal(cut.pending[0].runId, run.id);
        assert.match(cut.pending[0].reason, /Restart DSH/);
        assert.equal(f.domain().table('runs').get(run.id).workspaceCut, undefined);
      } else {
        assert.deepEqual(cut.pending, []);
        assert.deepEqual(cut.captured, [run.childId]);
        assert.equal(f.domain().table('runs').get(run.id).workspaceCut.cwd, expected);
      }
    } else {
      assert.equal(phase, 'resume'); assert.ok(liveHost);
      assert.deepEqual(f.domain().table('snapshots').get(run.revision), snapshot);
      const message = 'Continue the original task after the DSH upgrade.';
      const request = await f.call('scene_agent_control', { action: 'continue', childId: run.childId, message });
      if (layout === 'inherited') {
        success(request);
        await bounded(f.h.adapter.childStarted.promise, 'upgraded task native request');
        const child = f.ctx.agents.get(run.childId);
        assert.equal(f.ctx.get('workingDirectory').get(child.session), expected);
        assert.equal(child.session.header.agentPreset, snapshot.presetId);
        f.h.adapter.childGate.resolve(); await f.h.waitForSettlement();
        assert.equal(noticeMessages(f.h).length, 1);
      } else {
        assert.equal(request.isError, true);
        assert.match(text(request), /AGENTDECK_WORKSPACE_MISMATCH/);
        // Native callers can also cold-restore a child without AgentDeck control.
        const native = f.ctx.get('subagents');
        await assert.rejects(native.sendMessage(f.h.parent, run.childId, [{ type: 'text', text: message }], { signal }),
          error => error.code === 'NOT_RESUMABLE' && error.cause?.code === 'AGENTDECK_WORKSPACE_MISMATCH');
        assert.equal(f.ctx.agents.get(run.childId), undefined);
        assert.equal(f.h.adapter.requests.filter(item => item.sessionId === run.childId).length, 0);
      }
    }
    console.log(JSON.stringify({ phase, layout, parentId: run.parentId, childId: run.childId, expected }));
  } finally { await f.close(); }
}
