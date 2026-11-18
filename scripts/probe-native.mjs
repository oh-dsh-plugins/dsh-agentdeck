#!/usr/bin/env node
/**
 * Isolated native DSH 0.2.2-rc.3 proof. All runtime imports use public exports.
 * The only substitute is a deterministic, local LLM adapter: there is no HTTP,
 * credential access, profile mutation, or paid model call. Native AgentLoop,
 * spawn, policy projections, tool pipeline, inbox and JSONL persistence run.
 *
 * Run: node scripts/probe-native.mjs
 * Tests: node --test test/native-pipeline.test.mjs
 * Host packages must already be linked by the project owner's dev setup.
 */
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Context } from '@deepseek-ai/cordis';
import AgentRegistry from '@deepseek-ai/dsh-agent';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import LocalFileSystem from '@deepseek-ai/dsh-fs-local';
import LlmRuntime, { LlmAdapter, LlmError } from '@deepseek-ai/dsh-llm';
import { createScope, scopeParentOf } from '@deepseek-ai/dsh-scope';
import SessionStore from '@deepseek-ai/dsh-session';
import * as JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl';
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection';
import SessionQueryEngine from '@deepseek-ai/dsh-session-query';
import SubagentRuntime from '@deepseek-ai/dsh-subagent';
import * as NativeSpawn from '@deepseek-ai/dsh-subagent-spawn-in-process';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import * as NativeExecutor from '@deepseek-ai/dsh-tool-executor-native';
import * as NativeSubagentTool from '@deepseek-ai/dsh-tool-subagent';
import ToolsService from '@deepseek-ai/dsh-tools';
import nativeToolsPackage from '@deepseek-ai/dsh-tools/package.json' with { type: 'json' };
import { ToolExecutionPipeline, executeToolBatch } from '@deepseek-ai/dsh-tools/pipeline';
import WorkingDirectoryService from '@deepseek-ai/dsh-working-directory';

export const PRIVATE_TOOL = 'agentdeck_native_private_probe';
export const ROUTE = { provider: 'agentdeck-local-proof', model: 'parent' };
export const CHILD_TEXT = 'Native child completed the isolated proof.';
export const deferred = () => Promise.withResolvers();

// Exact reads, replay, observation and persistence use native behavior. The
// optional full-text index is intentionally outside this isolated proof.
class ExactReadQuery extends SessionQueryEngine {
  async searchSessions() { throw new Error('Full-text search is not part of this exact-read integration fixture.'); }
  async searchEvents() { throw new Error('Full-text search is not part of this exact-read integration fixture.'); }
}

/** No polling: an event/gate resolves, with a bounded diagnostic deadline. */
export async function bounded(promise, label, ms = 8_000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function cancellableGate(promise, signal) {
  signal?.throwIfAborted();
  if (!signal) return promise;
  let onAbort;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        onAbort = () => reject(signal.reason);
        signal.addEventListener('abort', onAbort, { once: true });
      }),
    ]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

/** Real LlmRuntime resolves capabilities and dispatches this local adapter. */
export class LocalProofAdapter extends LlmAdapter {
  requests = [];
  resolutions = [];
  childStarted = deferred();
  resolutionStarted = deferred();
  childGate;
  resolutionGate;
  setupReply;

  providerInfo(id) { return { id, name: 'Isolated local proof adapter' }; }

  async listModels(provider) {
    return ['parent', 'allowed', 'forbidden'].map((id) => ({ provider, id, name: id }));
  }

  async resolveModel(provider, model, signal) {
    this.resolutions.push({ provider, model, signal });
    this.resolutionStarted.resolve({ provider, model, signal });
    if (this.resolutionGate) await cancellableGate(this.resolutionGate.promise, signal);
    signal?.throwIfAborted();
    if (!['parent', 'allowed', 'forbidden'].includes(model)) {
      throw new LlmError(`Unknown local proof model: ${model}`, 'UNKNOWN_MODEL');
    }
    return {
      provider, id: model, name: model,
      context: { contextWindow: 16_384 },
      reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] },
    };
  }

  async *stream(options) {
    options.signal?.throwIfAborted();
    this.requests.push(options);
    const isParent = options.sessionId === 'native-proof-parent';
    if (!isParent) {
      this.childStarted.resolve(options);
      if (this.childGate) await cancellableGate(this.childGate.promise, options.signal);
    }
    options.signal?.throwIfAborted();
    const text = this.setupReply ?? (isParent ? 'Parent received the native completion notice.' : CHILD_TEXT);
    yield { type: 'block-start', index: 0, blockType: 'text' };
    yield { type: 'text-delta', index: 0, text };
    yield { type: 'block-end', index: 0, block: { type: 'text', text } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  }
}

/** Real native services; task-owned temporary JSONL data is removed on close. */
export async function createNativeHarness({ policy, toolOptions = {}, holdChild = false } = {}) {
  assert.equal(nativeToolsPackage.version, '0.2.2-rc.3', 'this proof pins the installed DSH compatibility baseline');
  const tempParent = await realpath(tmpdir());
  const storageRoot = await mkdtemp(join(tempParent, 'agentdeck-native-proof-'));
  const root = new Context();
  const adapter = new LocalProofAdapter();
  if (holdChild) adapter.childGate = deferred();
  const events = [];
  const starts = [];
  const ends = [];
  const outcomes = [];
  const activations = [];
  let restoreActivationCapture;
  let ctx;
  let parentHandle;
  let privateScope;
  let closed = false;

  async function close() {
    if (closed) return;
    closed = true;
    adapter.childGate?.resolve();
    adapter.resolutionGate?.resolve();
    try {
      if (ctx && parentHandle) {
        await ctx.subagents.drainDescendants([parentHandle.agent]);
        await parentHandle.dispose();
      }
      await privateScope?.dispose();
    } finally {
      try {
        restoreActivationCapture?.();
        await root.fiber.dispose();
      } finally {
        // Verify the exact resolved task-owned target before recursive cleanup.
        const target = await realpath(storageRoot);
        assert.equal(dirname(target), tempParent);
        assert.ok(basename(target).startsWith('agentdeck-native-proof-'));
        await rm(target, { recursive: true });
      }
    }
  }

  try {
    await root.plugin(SessionStore);
    await root.plugin(SessionProjectionRegistry);
    await root.plugin(SystemPrompt, { includeRuntimeContext: false });
    await root.plugin(LocalFileSystem, { cwd: storageRoot });
    await root.plugin(WorkingDirectoryService, { defaultDirectory: storageRoot });
    await root.plugin(LlmRuntime);
    await root.plugin(ToolsService);
    await root.plugin(NativeExecutor);
    await root.plugin(JsonlPersistence, { root: join(storageRoot, 'sessions'), compression: 'none' });
    await root.plugin(ExactReadQuery);
    await root.plugin(AgentRegistry);
    await root.plugin(AgentLoop);
    await root.plugin(SubagentRuntime);
    await root.plugin(NativeSpawn);
    await root.plugin(Object.assign((owner) => {
      ctx = owner;
      // Observe only this isolated runtime's public startup boundary. The exact
      // returned activation is needed to evict one fixture child for cold-resume
      // proofs; native ids/events are never synthesized and no global prototype
      // or manager internals are patched.
      const subagents = owner.get('subagents');
      const ownStart = Object.getOwnPropertyDescriptor(subagents, 'startActivation');
      const startActivation = subagents.startActivation;
      Object.defineProperty(subagents, 'startActivation', {
        configurable: true, writable: true,
        async value(spec) {
          const activation = await startActivation.call(subagents, spec);
          activations.push(activation);
          return activation;
        },
      });
      restoreActivationCapture = () => {
        if (ownStart) Object.defineProperty(subagents, 'startActivation', ownStart);
        else delete subagents.startActivation;
      };
      owner.llm.registerAdapter([ROUTE.provider], adapter);
      owner.on('session/event', (session, event) => events.push({ session, event }));
      owner.on('subagent/start', (info) => starts.push(info));
      owner.on('subagent/end', (info) => ends.push(info));
      owner.on('tools/result', (exec, result) => outcomes.push({ exec, result }));
    }, { inject: ['agents', 'subagents', 'tools', 'llm', 'systemPrompt', 'sessionProjections'] }));

    // Mint at a root scope: it must never become an ancestor of the model Agent.
    const privateKey = {};
    privateScope = createScope(ctx, privateKey);
    assert.equal(scopeParentOf(privateKey), undefined);
    await privateScope.ctx.plugin(NativeSubagentTool, {
      provider: 'spawn', toolName: PRIVATE_TOOL, modelSelection: true,
      modelDiscovery: true, maxDepth: 1, ...toolOptions,
    });
    parentHandle = await ctx.agents.create({
      sessionId: 'native-proof-parent',
      meta: { cwd: storageRoot },
      agentOptions: { ...ROUTE, reasoningEffort: 'low' },
      setup: (_agentCtx, agent) => {
        if (policy) agent.session.append('subagent/model-selection-policy', { allowedModels: policy });
      },
    });
    const parent = parentHandle.agent;
    // The source controls definition lookup only. The caller remains the exact
    // published Agent, preserving policy scope, model policy and child lineage.
    const pipeline = new ToolExecutionPipeline(ctx, {
      get: (name) => name === PRIVATE_TOOL
        ? ctx.tools.executable(name, privateKey)
        : undefined,
    });
    let nextCall = 0;
    const input = (args, signal = new AbortController().signal, agent = parent) => ({
      calls: [{
        type: 'tool-call', id: `native-proof-call-${++nextCall}`,
        name: PRIVATE_TOOL, arguments: JSON.stringify({
          description: 'Native private scope proof', prompt: 'Complete this isolated native proof.', ...args,
        }),
      }], signal, agent,
    });
    const invoke = async (args = {}, signal, agent) => {
      const batch = await executeToolBatch(input(args, signal, agent), pipeline, () => 1);
      assert.equal(batch.results.length, 1);
      const result = batch.results[0].result;
      if (result.isError) return result;
      assert.equal(result.value.kind, 'activation');
      assert.equal(typeof result.value.name, 'string', 'rc.3 native receipt identifies a child by name');
      // The probe's stable helper shape adds a derived Session id. The actual
      // native receipt remains name-only in outcomes; public resolution provides
      // the real identity rather than assuming a removed native output field.
      const subagentId = await ctx.subagents.resolveName(agent ?? parent, result.value.name, signal ?? new AbortController().signal);
      return { ...result, value: { ...result.value, subagentId } };
    };
    const waitForSettlement = async () => {
      await bounded(ctx.subagents.waitForTreeWork(parent), 'native subagent tree settlement');
      await bounded(parent.whenIdle(), 'parent completion notice turn');
    };
    const activationFor = (childId) => {
      const activation = activations.findLast(value => value.childId === childId);
      assert.ok(activation, `No exact native startup activation captured for ${childId}`);
      return activation;
    };
    return {
      ctx, parent, adapter, privateKey, pipeline, events, starts, ends, outcomes, activations,
      invoke, input, activationFor, waitForSettlement, close, storageRoot,
    };
  } catch (error) {
    await close();
    throw error;
  }
}

export function noticeMessages(harness) {
  return harness.events
    .filter(({ session, event }) => session === harness.parent.session && event.type === 'user/message')
    .map(({ event }) => event.data)
    .filter((message) => message.source.kind === 'subagent-settled');
}

export async function proveNativeSuccess() {
  const h = await createNativeHarness({ holdChild: true });
  try {
    const result = await bounded(h.invoke({ ...ROUTE, reasoning_effort: 'high' }), 'private native startup');
    assert.equal(result.isError, false, JSON.stringify(result));
    assert.equal(result.value.kind, 'activation');
    await bounded(h.adapter.childStarted.promise, 'native child first model request');
    assert.equal(h.starts.length, 1);
    assert.equal(h.ends.length, 0);
    assert.equal(noticeMessages(h).length, 0);
    const child = h.ctx.agents.get(result.value.subagentId);
    assert.ok(child, 'a real native Agent must be published');
    assert.equal(child.session.header.parentSession, h.parent.id);
    assert.equal(child.session.header.delegationDepth, 1);
    assert.deepEqual(child.model.current(), { ...ROUTE, reasoningEffort: 'high' });
    assert.equal(h.outcomes[0].exec.agent, h.parent);
    h.adapter.childGate.resolve();
    await h.waitForSettlement();
    assert.equal(h.ends.length, 1);
    assert.equal(h.ends[0].stopReason, 'completed');
    assert.equal(noticeMessages(h).length, 1);
    assert.equal(noticeMessages(h)[0].source.senderSessionId, child.id);
    assert.ok(noticeMessages(h)[0].content.some((block) => block.type === 'text' && block.text === CHILD_TEXT));
    assert.equal(h.adapter.requests.filter((request) => request.sessionId === child.id).length, 1);
    assert.equal(h.adapter.requests.filter((request) => request.sessionId === h.parent.id).length, 1);
    return {
      runtime: 'DSH native AgentLoop + spawn + ToolExecutionPipeline + JSONL',
      runtimeVersion: nativeToolsPackage.version,
      acceptedChildren: h.starts.length, completionNotices: noticeMessages(h).length,
      callerIdentityPreserved: h.outcomes[0].exec.agent === h.parent,
      childModelSelection: child.model.current(),
      paidModelCalls: 0,
    };
  } finally {
    await h.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await proveNativeSuccess(), null, 2));
}
