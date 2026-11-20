import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import test from 'node:test';
import {
  PRIVATE_TOOL, ROUTE, bounded, createNativeHarness, deferred,
  noticeMessages, proveNativeSuccess,
} from '../scripts/probe-native.mjs';

const textOf = (result) => result.content
  .filter((block) => block.type === 'text').map((block) => block.text).join('\n');

// These exercise installed native services, not a copy of their implementation.
// They prove the private capability seam. AgentDeck's host tool mapping/preset
// composition and Team coexistence need the Lead's separate integration tests.
test('native private pipeline accepts exactly one real child and delivers one normal completion notice', async () => {
  const proof = await proveNativeSuccess();
  assert.equal(proof.acceptedChildren, 1);
  assert.equal(proof.completionNotices, 1);
  assert.equal(proof.callerIdentityPreserved, true);
  assert.equal(proof.paidModelCalls, 0);
});

test('model registry hides native tools and rejects forged calls with step admission', async () => {
  const h = await createNativeHarness();
  try {
    for (const name of [PRIVATE_TOOL, 'list_subagent_models']) {
      assert.ok(h.ctx.tools.get(name, h.privateKey), `${name} must exist privately`);
      assert.equal(h.ctx.tools.get(name, h.parent), undefined);
      assert.equal(h.ctx.tools.executable(name, h.parent), undefined);
      assert.equal(h.ctx.tools.get(name), undefined);
    }
    const signal = new AbortController().signal;
    const toolSet = await h.ctx.tools.resolve({
      agent: h.parent, modelSelection: h.parent.model.current(), signal,
    });
    try {
      assert.ok(!h.ctx.tools.schemas(h.parent, toolSet)
        .some(({ name }) => name === PRIVATE_TOOL || name === 'list_subagent_models'));
      for (const name of [PRIVATE_TOOL, 'list_subagent_models']) {
        const call = h.input({ ...ROUTE }, signal);
        const batch = await h.ctx.tools.execute({
          ...call, toolSet,
          calls: call.calls.map((block) => ({ ...block, name })),
        });
        assert.equal(batch.results[0].result.isError, true);
        assert.equal(batch.results[0].result.error.info.code, 'UNKNOWN_TOOL');
      }
    } finally {
      toolSet.dispose();
    }
    assert.equal(h.starts.length, 0);
    assert.equal(h.adapter.requests.length, 0);
  } finally {
    await h.close();
  }
});

test('private lookup preserves exact caller scoped guards and denial without a child', async () => {
  const h = await createNativeHarness();
  try {
    const seen = [];
    const release = h.parent.ctx.tools.guard((exec) => {
      seen.push(exec.agent);
      return 'parent scope forbids this native delegation';
    });
    try {
      const result = await h.invoke({ ...ROUTE });
      assert.equal(result.isError, true);
      assert.match(textOf(result), /parent scope forbids/);
      assert.deepEqual(seen, [h.parent]);
      assert.equal(h.outcomes.at(-1).exec.agent, h.parent);
      assert.equal(h.starts.length, 0);
      assert.equal(h.adapter.resolutions.length, 0);
      assert.equal(h.adapter.requests.length, 0);
    } finally {
      release();
    }
  } finally {
    await h.close();
  }
});

test('explicit fields enforce parent route when the calling Session has no model policy', async () => {
  const h = await createNativeHarness();
  try {
    const result = await h.invoke({ provider: ROUTE.provider, model: 'forbidden' });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /not allowed for this Session/);
    assert.match(textOf(result), /without a recorded model-selection policy/);
    assert.equal(h.adapter.resolutions.length, 0, 'policy must deny before adapter lookup');
    assert.equal(h.starts.length, 0);
  } finally {
    await h.close();
  }
});

test('native route policy rejects incomplete or forbidden selections and preserves explicit effort', async () => {
  const h = await createNativeHarness({
    policy: [{ provider: ROUTE.provider, model: 'allowed' }],
    toolOptions: { agentOptions: { provider: ROUTE.provider, model: 'forbidden' } },
  });
  try {
    for (const fields of [
      { provider: ROUTE.provider, model: 'forbidden' },
      { ...ROUTE },
    ]) {
      const result = await h.invoke(fields);
      assert.equal(result.isError, true);
      assert.match(textOf(result), /not allowed for this Session/);
    }
    const effortOnly = await h.invoke({ reasoning_effort: 'high' });
    assert.equal(effortOnly.isError, true);
    // Published hosts differ in preflight order: rc.1 checks the forbidden
    // default route; newer hosts first reject incomplete explicit effort.
    assert.match(textOf(effortOnly), /reasoning_effort.*requires both.*provider.*model|not allowed for this Session/);
    assert.equal(h.adapter.resolutions.length, 0);
    assert.equal(h.starts.length, 0);
    const accepted = await h.invoke({ provider: ROUTE.provider, model: 'allowed', reasoning_effort: 'high' });
    assert.equal(accepted.isError, false, textOf(accepted));
    await h.waitForSettlement();
    assert.equal(h.starts.length, 1);
    const childRequest = h.adapter.requests.find((request) => request.sessionId === accepted.value.subagentId);
    assert.equal(childRequest.model, 'allowed');
    assert.equal(childRequest.reasoningEffort, 'high');
    assert.equal(noticeMessages(h).length, 1);
  } finally {
    await h.close();
  }
});

test('native adapter rejects unsupported explicit reasoning effort before accepting a child', async () => {
  const h = await createNativeHarness();
  try {
    const result = await h.invoke({ ...ROUTE, reasoning_effort: 'unsupported' });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /unsupported|reasoning effort/i);
    assert.equal(h.adapter.resolutions.length, 1);
    assert.equal(h.starts.length, 0);
    assert.equal(h.adapter.requests.length, 0);
  } finally {
    await h.close();
  }
});

test('caller cancellation before dispatch and during native preflight accepts no child', async () => {
  const h = await createNativeHarness();
  try {
    const preAborted = new AbortController();
    preAborted.abort();
    const skipped = await h.invoke({ ...ROUTE }, preAborted.signal);
    assert.equal(skipped.isError, true);
    assert.equal(skipped.error.info.code, 'ABORTED_BEFORE_DISPATCH');
    assert.equal(h.adapter.resolutions.length, 0);

    h.adapter.resolutionGate = deferred();
    const controller = new AbortController();
    const running = h.invoke({ ...ROUTE }, controller.signal);
    const resolving = await bounded(h.adapter.resolutionStarted.promise, 'native route preflight entry');
    assert.equal(resolving.signal.aborted, false);
    controller.abort();
    const cancelled = await bounded(running, 'cancelled native preflight drains');
    assert.equal(cancelled.isError, true);
    assert.equal(resolving.signal.aborted, true);
    assert.equal(h.starts.length, 0);
    assert.equal(h.ends.length, 0);
    assert.equal(noticeMessages(h).length, 0);
    assert.equal(h.adapter.requests.length, 0);
  } finally {
    await h.close();
  }
});

test('accepted native child survives caller signal cancellation and accepts only real ancestor interruption', async () => {
  const h = await createNativeHarness({ holdChild: true });
  try {
    const controller = new AbortController();
    const accepted = await h.invoke({ ...ROUTE }, controller.signal);
    assert.equal(accepted.isError, false, textOf(accepted));
    const request = await bounded(h.adapter.childStarted.promise, 'native child stream entry');
    controller.abort();
    assert.equal(request.signal.aborted, false, 'tool signal ownership ends at child acceptance');
    assert.equal(h.starts.length, 1);
    assert.throws(() => h.ctx.subagents.interrupt(accepted.value.subagentId, {
      kind: 'ancestor', agent: { id: h.parent.id },
    }), (error) => error.code === 'UNAUTHORIZED');
    assert.equal(request.signal.aborted, false);
    h.ctx.subagents.interrupt(accepted.value.subagentId, { kind: 'ancestor', agent: h.parent });
    assert.equal(request.signal.aborted, true);
    await h.waitForSettlement();
    assert.equal(h.starts.length, 1);
    assert.equal(h.ends.length, 1);
    assert.equal(h.ends[0].stopReason, 'aborted');
    assert.equal(noticeMessages(h).length, 1);
    assert.match(noticeMessages(h)[0].source.summary, /stopped before it finished/);
  } finally {
    await h.close();
  }
});

test('native harness teardown removes task-owned persistent data', async () => {
  const h = await createNativeHarness();
  const target = h.storageRoot;
  await access(target);
  await h.close();
  await assert.rejects(access(target), { code: 'ENOENT' });
});
