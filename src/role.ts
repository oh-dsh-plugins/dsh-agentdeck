import { dirname, join } from 'node:path';
import type { Context } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
import { createSystemMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm';
import { renderPrompt, type PromptPresentation } from '@deepseek-ai/dsh-system-prompt';
import { scopeParentOf } from '@deepseek-ai/dsh-scope';
import { toolAllowed } from './host/capabilities.js';
import { registerRoleTools } from './host/role-tools.js';
import { activateBrowserSkill, browserInvocationDenial, inspectBrowserSupport, type BrowserSupport } from './host/browser.js';
import { browserReadiness, OwnedBrowserSessions } from './host/browser-runtime.js';
import { jsonClone, type HostContext, type RoleSnapshot, type RuntimeAgent } from './host/types.js';

export const name = 'agentdeck-role';
export const inject = ['tools', 'systemPrompt'];
export interface Config { snapshot: RoleSnapshot }
export const Config = Schema.object({ snapshot: Schema.any().required() }) as Schema<Config>;
const attached = new WeakMap<RuntimeAgent, { id: string; ready: Promise<() => void | Promise<void>> }>();

function ceiling(snapshot: RoleSnapshot): number {
  const limits = [snapshot.budget.elasticTokens, snapshot.budget.safeInputTokens].filter((value): value is number => value !== undefined);
  if (limits.some(value => !Number.isSafeInteger(value) || value < 1)) throw new Error('AgentDeck snapshot has no usable total-input budget.');
  return Math.min(...limits);
}

async function workspaceInstructions(ctx: HostContext, agent: RuntimeAgent, signal: AbortSignal): Promise<string> {
  const fs = ctx.get('fs' as any) as any;
  const directories = ctx.get('workingDirectory' as any) as any;
  if (!fs || !directories) throw new Error('AgentDeck workspace instructions require native fs and workingDirectory services.');
  let directory = await directories.ensure(agent, signal);
  const parts: string[] = [];
  let bytes = 0;
  for (let depth = 0; depth < 64; depth++) {
    signal.throwIfAborted();
    const path = join(directory, 'AGENTS.md');
    const target = await fs.resolve(path, { signal });
    if (await fs.stat(target, signal)) {
      const content = await fs.readBytes(target, signal, 65_536);
      bytes += content.length;
      if (bytes > 131_072) throw new Error('Applicable workspace instructions exceed 128 KiB; reduce them before starting this role.');
      parts.unshift(`Instructions from ${path}:\n${new TextDecoder('utf-8', { fatal: true }).decode(content)}`);
    }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
    if (depth === 63) throw new Error('Workspace instruction ancestry exceeds the supported 64-directory limit.');
  }
  return parts.join('\n\n');
}

function catalog(snapshot: RoleSnapshot): string {
  return [
    `AgentDeck role: ${snapshot.role.id}; immutable snapshot: ${snapshot.id}.`,
    'Work as a leaf Agent. Preserve the delegated objective, authorization, owned paths and required evidence. Available capabilities do not expand task authorization.',
    'Follow applicable workspace instructions. Read nested AGENTS.md instructions before acting on files below their directory.',
    `Context budgets count all input, including instructions, tools, history and pending material: target ${snapshot.budget.targetTokens} tokens; total ceiling ${ceiling(snapshot)} tokens. Use bounded sources and native compaction; return a precise limitation when the retained input cannot fit.`,
    ...snapshot.budget.diagnostics.map(diagnostic => `Budget diagnostic: ${diagnostic}`),
    'Load relevant instructions with agentdeck_skill before using a catalog skill:',
    ...snapshot.skills.map(skill => `- ${skill.id}: ${skill.description}`),
    ...(snapshot.role.scripts.length ? ['Snapshot-owned helper resources:', ...snapshot.role.scripts.map(path => `- ${path} (${snapshot.scriptRevisions?.[path] ?? 'revision unavailable'})`)] : []),
    'Return an evidence-backed result. For a final handoff, prefer a JSON object with status (completed, partial, failed or cancelled), summary, evidence, coverage, artifacts and limitations. Native idleness alone is not successful completion.',
  ].join('\n');
}

/** Bind before first dispatch, identically for a preset or an admitted native fallback. */
export function bindRoleAgent(context: HostContext, agent: RuntimeAgent, input: RoleSnapshot, signal = new AbortController().signal): Promise<() => void | Promise<void>> {
  const existing = attached.get(agent);
  if (existing) {
    if (existing.id !== input.id) return Promise.reject(new Error('This Agent already owns a different AgentDeck snapshot.'));
    return existing.ready;
  }
  const snapshot = jsonClone(input);
  const ready = (async () => {
    if (snapshot.policyVersion !== 1) throw new Error(`Unsupported AgentDeck role policy ${snapshot.policyVersion}.`);
    const maximum = ceiling(snapshot);
    const ctx = agent.ctx as HostContext;
    const current = agent.model.current();
    if (current?.provider !== snapshot.model.provider || current?.model !== snapshot.model.model) throw new Error('AgentDeck snapshot model route differs from this Agent; create an authorized snapshot for its current route.');
    const llm = ctx.get('llm' as any) as any;
    if (!llm) throw new Error('AgentDeck role model validation requires the native llm service.');
    await llm.resolveCallConfig({ provider: snapshot.model.provider, model: snapshot.model.model,
      ...(snapshot.model.reasoningEffort === undefined ? {} : { reasoningEffort: snapshot.model.reasoningEffort }),
      ...(snapshot.model.maxTokens === undefined ? {} : { maxTokens: snapshot.model.maxTokens }) }, signal);
    if (snapshot.model.maxTokens !== undefined && (!Number.isSafeInteger(snapshot.model.maxTokens) || snapshot.model.maxTokens < 1)) throw new Error('Snapshot maxTokens must be a positive safe integer.');
    // AgentOptions is the public output-control API. Pin before any queued input runs,
    // including cold resume where native creation options can otherwise differ.
    if (snapshot.model.maxTokens === undefined) delete agent.options.maxTokens;
    else agent.options.maxTokens = snapshot.model.maxTokens;
    if (agent.options.maxTokens !== snapshot.model.maxTokens) throw new Error('Could not retain the snapshot output limit.');
    agent.model.select({ provider: snapshot.model.provider, model: snapshot.model.model,
      ...(snapshot.model.reasoningEffort === undefined ? {} : { reasoningEffort: ReasoningEffortId(snapshot.model.reasoningEffort) }) });
    const meter = ctx.get('tokenMeter' as any) as any;
    if (!meter) throw new Error('AgentDeck context policy requires the native tokenMeter service.');
    const roleCatalog = catalog(snapshot);
    const instructions = await workspaceInstructions(ctx, agent, signal);
    signal.throwIfAborted();
    const fixed = meter.estimateMessage(createSystemMessage([snapshot.role.instructions, roleCatalog, instructions].join('\n\n')));
    if (fixed > maximum) throw new Error(`AgentDeck fixed instructions need approximately ${fixed} input tokens, exceeding the total ceiling ${maximum}; reduce instructions or select a larger budget before starting.`);
    const modelSelection = agent.model.current();
    if (!modelSelection) throw new Error('AgentDeck could not resolve its pinned model for tool discovery.');
    let discovery = await ctx.tools.resolve({ agent, modelSelection, signal });
    let allowed: string[];
    let browserSupport: BrowserSupport;
    try {
      let names: string[] = ctx.tools.schemas(agent, discovery).map((tool: any) => tool.name);
      browserSupport = inspectBrowserSupport(names, snapshot.role.capabilities);
      if (snapshot.role.capabilities.some(value => value.startsWith('browser-')) && browserSupport.state !== 'ready') {
        let reason: string;
        try { reason = (await activateBrowserSkill(ctx, agent, signal)).reason; }
        catch (error) { signal.throwIfAborted(); reason = error instanceof Error ? error.message : String(error); }
        const renewed = await ctx.tools.resolve({ agent, modelSelection, signal });
        discovery.dispose();
        discovery = renewed;
        names = ctx.tools.schemas(agent, discovery).map((tool: any) => tool.name);
        const evidence = names.includes('bsk_session') ? await browserReadiness(ctx, signal) : { state: 'unverified' as const, reason };
        browserSupport = inspectBrowserSupport(names, snapshot.role.capabilities, { bsk: evidence });
        if (browserSupport.state !== 'ready') throw new Error(`AgentDeck browser backend is ${browserSupport.state}: ${browserSupport.reason} No live browser session was started; configure a supported backend before retrying.`);
      }
      const admitted = new Set(names);
      allowed = context.tools.definitions(scopeParentOf(agent)).map((tool: any) => tool.name).filter((name: string) => admitted.has(name) && toolAllowed(name, snapshot.role.capabilities, browserSupport));
    }
    finally { discovery.dispose(); }
    let observed: { presentation: PromptPresentation; toolSet?: any } | undefined;
    const browsers = browserSupport.backend === 'bsk' ? new OwnedBrowserSessions(ctx, agent) : undefined;
    return ctx.effect(function* () {
      // Include dynamic MCP/tool-provider declarations in the frozen allowed set.
      yield ctx.tools.restrict({ allow: allowed });
      yield ctx.tools.guard((execution: any) => {
        if (execution.agent !== agent) return 'AgentDeck role invocation requires its exact owning Agent.';
        if (!toolAllowed(execution.name, snapshot.role.capabilities, browserSupport)) return `AgentDeck role ${snapshot.role.id} does not permit tool ${execution.name}.`;
        if (browserSupport.allowedNames.includes(execution.name)) return browsers?.denial(execution.name, execution.arguments) ?? browserInvocationDenial(execution.name, execution.arguments, snapshot.role.capabilities, browserSupport, browsers?.scope);
        return undefined;
      });
      yield ctx.systemPrompt.section({ name: 'deployment:persona-prefix', order: 0, text: snapshot.role.instructions, interpolate: false });
      for (const release of registerRoleTools(ctx, agent, snapshot)) yield release;
      yield ctx.systemPrompt.section({ name: 'agentdeck:role-catalog', order: 80, interpolate: false, text: roleCatalog });
      if (instructions) yield ctx.systemPrompt.section({ name: 'agentdeck:workspace-instructions', order: 90, interpolate: false, text: instructions });
      yield ctx.on('system-prompt/assemble', async (_assembly: any, assembleContext: any, next: any) => {
        const presentation = await next(); observed = { presentation, toolSet: assembleContext.toolSet }; return presentation;
      });
      yield ctx.on('agent/pre-step', async (payload: any, next: any) => {
        const decision = await next();
        if (decision.kind !== 'enter') return decision;
        payload.signal.throwIfAborted();
        if (!observed) throw new Error('AgentDeck did not observe the native prompt assembly; context admission cannot be checked.');
        const tools = ctx.tools.schemas(agent, observed.toolSet);
        const header = { config: { ...payload.modelSelection, ...(snapshot.model.maxTokens === undefined ? {} : { maxTokens: snapshot.model.maxTokens }) }, tools };
        const measurement = meter.measure(agent.session, header);
        const previousSystem = agent.session.deriveMessages().filter((message: any) => message.role === 'system').reduce((sum: number, message: any) => sum + meter.estimateMessage(message), 0);
        const promptTokens = meter.estimateMessage(createSystemMessage(renderPrompt(observed.presentation as any)));
        const pending = decision.messages.reduce((sum: number, message: any) => sum + meter.estimateMessage(message), 0);
        const projected = Math.max(0, measurement.totalTokens - previousSystem) + promptTokens + pending;
        if (projected > maximum) throw new Error(`AgentDeck retained input is approximately ${projected} tokens after native recovery, above the total ceiling ${maximum}. Narrow the pending material or increase the role budget; no additional model request was sent.`);
        return decision;
      });
      if (browsers) {
        // Capture physical creation before later policy/cancellation can discard its value.
        // Observe only: every native post-execute decision remains authoritative.
        yield ctx.on('tools/post-execute', async (execution: any, result: any, next: any) => {
          if (execution.name === 'bsk_session' && execution.arguments?.action === 'start') browsers.observe(execution, result);
          return await next();
        });
        yield ctx.on('tools/result', (execution: any, result: any) => { browsers.observe(execution, result); return undefined; });
        yield ctx.on('agent/turn-stopping', async () => { await browsers.close(); });
        yield ctx.on('agent/status', ({ status }: any) => {
          if (status === 'idle') void browsers.close().catch(error => console.warn('AgentDeck browser cleanup:', error.message));
        });
        // LIFO unwind: join cleanup before removing the exact-agent guard/mask.
        yield async () => { await browsers.close(); };
      }
      yield () => attached.delete(agent);
    });
  })();
  attached.set(agent, { id: snapshot.id, ready });
  ready.catch(() => { if (attached.get(agent)?.ready === ready) attached.delete(agent); });
  return ready;
}

export function apply(context: Context, config: Config): void {
  const ctx = context as HostContext;
  const snapshot = jsonClone(config.snapshot);
  const bindings = new Map<RuntimeAgent, () => void | Promise<void>>();
  ctx.on('agent/created', async ({ agent, signal }) => {
    const subject = agent as RuntimeAgent;
    if (!bindings.has(subject)) bindings.set(subject, await bindRoleAgent(ctx, subject, snapshot, signal));
  });
  ctx.on('agent/disposed', ({ agent }) => { bindings.delete(agent as RuntimeAgent); });
  ctx.effect(() => async () => { await Promise.all([...bindings.values()].map(dispose => dispose())); bindings.clear(); });
}
