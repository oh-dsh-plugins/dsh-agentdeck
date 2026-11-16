import { randomUUID } from 'node:crypto';
import { ToolCallId } from '@deepseek-ai/dsh-llm';
import type { HostContext, RuntimeAgent } from './types.js';

export interface BrowserSupport {
  backend: 'mcp' | 'bsk' | 'none';
  state: 'ready' | 'unverified' | 'unsupported';
  reason: string;
  allowedNames: string[];
}
export interface BrowserEvidence {
  /** Activation alone does not prove that the CLI and extension can operate. */
  bsk?: { state: 'ready' | 'unverified' | 'unsupported'; reason: string };
}
export interface BrowserInvocationScope {
  sessionIds?: readonly string[];
  requestIds?: readonly string[];
  pageIds?: readonly number[];
}

const prefixes = ['mcp__chrome-devtools__', 'mcp__browser__'] as const;
const mcpObserve = new Set(['take_snapshot', 'take_screenshot', 'list_pages', 'list_console_messages', 'list_network_requests', 'get_console_message', 'get_network_request', 'get_css_styles', 'wait_for']);
const mcpInteract = new Set(['click', 'fill', 'fill_form', 'hover', 'press_key', 'navigate_page', 'close_page', 'resize_page', 'emulate']);
const bskObserve = new Set(['bsk_session', 'bsk_inspect']);
const bskInteract = new Set(['bsk_session', 'bsk_inspect', 'bsk_page', 'bsk_interact', 'bsk_tabs', 'bsk_assist']);
const actions = new Set(['click', 'fill', 'select', 'press', 'hover', 'scroll-to', 'wheel', 'drag']);
const directActions = new Set([...actions, 'focus', 'blur']);
// Compound JSON is an open protocol field in BrowserSkill 0.5.0. Keep the first
// adapter to documented basic keys; direct wheel/drag retain their native schema.
const compoundActions = new Set(['click', 'fill', 'select', 'press', 'hover', 'scroll-to']);
const compoundKeys = new Set(['ref', 'selector', 'value', 'values', 'key', 'url', 'state']);
const commonKeys = ['action', 'session', 'tabId', 'timeoutMs', 'contextId', 'observationId', 'expect', 'dependsOn'];
const bskKeys: Record<string, ReadonlySet<string>> = Object.fromEntries(Object.entries({
  bsk_session: ['requestId', 'url', 'width', 'height', 'noFocus', 'incognito', 'policy', 'maxTokens', 'matchText', 'contextLines', 'settle'],
  bsk_inspect: ['maxDepth', 'maxTokens', 'cursor', 'ref', 'selector', 'readFields', 'maxNodes', 'readTimeoutMs', 'extractKind', 'extractTarget', 'extractFields', 'itemSelector', 'extractFormat', 'csvSafe', 'maxRows', 'maxColumns', 'extractTimeoutMs', 'maxBytes', 'since', 'limit', 'maxTextChars', 'includeStack', 'budget'],
  bsk_page: ['url', 'waitUntil', 'hard', 'state', 'target', 'pollMs'],
  bsk_interact: ['target', 'to', 'value', 'values', 'key', 'button', 'clickCount', 'captureId', 'imageX', 'imageY', 'fromOffsetX', 'fromOffsetY', 'toOffsetX', 'toOffsetY', 'deltaX', 'deltaY', 'durationMs', 'holdMs', 'dragMode', 'modifiers', 'noClear', 'settleMs', 'policy', 'stepAction', 'params', 'steps', 'untilVisible', 'waitTimeoutMs', 'matchText', 'contextLines'],
  bsk_tabs: ['scope', 'active', 'index', 'url'],
  bsk_assist: ['dialogId', 'text', 'width', 'height'],
}).map(([name, keys]) => [name, new Set([...commonKeys, ...keys])]));
const dangerous = new Set(['expression', 'initScript', 'extraHttpHeaders', 'rule', 'replay', 'debugAction', 'videoAction', 'unverified', 'browser', 'files', 'output', 'saveFull', 'file', 'baseline']);
const observe = (capabilities: readonly string[]) => capabilities.includes('browser-observe') || interact(capabilities);
const interact = (capabilities: readonly string[]) => capabilities.includes('browser-interact');
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

function mcpName(name: string): { prefix: typeof prefixes[number]; suffix: string } | undefined {
  const prefix = prefixes.find(value => name.startsWith(value));
  if (!prefix) return undefined;
  const suffix = name.slice(prefix.length);
  return mcpObserve.has(suffix) || mcpInteract.has(suffix) ? { prefix, suffix } : undefined;
}
function mcpAllowed(name: string, capabilities: readonly string[]): boolean {
  const tool = mcpName(name);
  return !!tool && (mcpObserve.has(tool.suffix) ? observe(capabilities) : interact(capabilities));
}

/** Freeze a single discovered surface. MCP readiness is tool admission, not a live-page probe. */
export function inspectBrowserSupport(names: readonly string[], capabilities: readonly string[], evidence: BrowserEvidence = {}): BrowserSupport {
  if (!observe(capabilities)) return { backend: 'none', state: 'unsupported', reason: 'This role has no browser capability.', allowedNames: [] };
  const found = new Set(names);
  let partialMcp = false;
  for (const prefix of prefixes) {
    const allowedNames = [...found].filter(name => name.startsWith(prefix) && mcpAllowed(name, capabilities)).sort();
    if (!allowedNames.length) continue;
    partialMcp = true;
    const readable = found.has(`${prefix}take_snapshot`) || found.has(`${prefix}take_screenshot`);
    const actionable = ['click', 'fill', 'fill_form'].some(suffix => found.has(`${prefix}${suffix}`));
    if (readable && (!interact(capabilities) || actionable)) return {
      backend: 'mcp', state: 'ready', reason: `${prefix} has the admitted observation${interact(capabilities) ? ' and interaction' : ''} tools; live connection is checked by native execution.`, allowedNames,
    };
  }
  const bskNames = [...found].filter(name => (interact(capabilities) ? bskInteract : bskObserve).has(name)).sort();
  if (bskNames.length || evidence.bsk) {
    const required = interact(capabilities) ? ['bsk_session', 'bsk_inspect', 'bsk_page', 'bsk_interact'] : ['bsk_session', 'bsk_inspect'];
    const complete = required.every(name => found.has(name));
    const proof = evidence.bsk;
    if (complete && proof?.state === 'ready' && text(proof.reason)) return { backend: 'bsk', state: 'ready', reason: proof.reason, allowedNames: bskNames };
    return { backend: 'bsk', state: proof?.state === 'unsupported' ? 'unsupported' : 'unverified',
      reason: proof?.state === 'unsupported' ? proof.reason : !complete ? 'BrowserSkill declarations are incomplete for this role.' : proof?.reason || 'BrowserSkill needs independent child activation and CLI/extension readiness evidence before permission freeze.', allowedNames: [] };
  }
  return { backend: partialMcp ? 'mcp' : 'none', state: partialMcp ? 'unverified' : 'unsupported',
    reason: partialMcp ? 'No single MCP namespace has the required observation and interaction tools.' : 'No supported browser tool surface was admitted.', allowedNames: [] };
}

export function browserToolAllowed(name: string, capabilities: readonly string[], support: BrowserSupport): boolean {
  if (support.state !== 'ready' || !support.allowedNames.includes(name)) return false;
  if (support.backend === 'bsk') return (interact(capabilities) ? bskInteract : observe(capabilities) ? bskObserve : new Set<string>()).has(name);
  if (support.backend !== 'mcp' || !mcpAllowed(name, capabilities)) return false;
  const selected = prefixes.find(prefix => support.allowedNames.some(value => mcpName(value)?.prefix === prefix));
  return mcpName(name)?.prefix === selected;
}

function parameterDenial(value: unknown, depth = 0, remaining = { nodes: 0 }): string | undefined {
  if (++remaining.nodes > 4096 || depth > 16) return 'Browser arguments exceed the bounded parameter shape.';
  if (typeof value === 'number' && !Number.isFinite(value)) return 'Browser numeric arguments must be finite.';
  if (value === null || value === undefined || ['string', 'number', 'boolean'].includes(typeof value)) return undefined;
  if (Array.isArray(value)) {
    for (const item of value) { const denial = parameterDenial(item, depth + 1, remaining); if (denial) return denial; }
    return undefined;
  }
  if (!object(value)) return 'Browser arguments must contain only JSON values.';
  for (const [key, item] of Object.entries(value)) {
    if (dangerous.has(key)) return `Browser parameter ${key} is outside the bounded adapter.`;
    if (key === 'url') {
      if (typeof item !== 'string') return 'Browser URL must be a string.';
      try {
        const url = new URL(item);
        if ((url.protocol !== 'https:' && url.protocol !== 'http:' && item !== 'about:blank') || url.username || url.password) return 'Browser navigation permits only HTTP(S) or about:blank without credentials.';
      } catch { return 'Browser URL is invalid.'; }
    }
    const denial = parameterDenial(item, depth + 1, remaining);
    if (denial) return denial;
  }
  return undefined;
}

function compoundDenial(args: Record<string, unknown>): string | undefined {
  if (args.action === 'step') {
    if (typeof args.stepAction !== 'string' || (!compoundActions.has(args.stepAction) && args.stepAction !== 'navigate')) return 'BrowserSkill step action is outside the bounded adapter.';
    if (typeof args.params !== 'string' || args.params.length > 32_768) return 'BrowserSkill step params must be bounded JSON.';
    let params: unknown;
    try { params = JSON.parse(args.params); } catch { return 'BrowserSkill step params must be valid JSON.'; }
    if (!object(params)) return 'BrowserSkill step params must be an object.';
    if (Object.keys(params).some(key => !compoundKeys.has(key))) return 'BrowserSkill step parameters are outside the bounded protocol keys; identity and conditions belong on the outer call.';
    return parameterDenial(params);
  }
  if (args.action !== 'plan') return undefined;
  if (!Array.isArray(args.steps) || args.steps.length < 1 || args.steps.length > 20) return 'BrowserSkill plan requires 1 to 20 steps.';
  for (const step of args.steps) {
    if (!object(step) || typeof step.action !== 'string' || (!compoundActions.has(step.action) && step.action !== 'wait-for-element')) return 'BrowserSkill plan contains an unsupported action.';
    if (Object.keys(step).some(key => key !== 'action' && key !== 'expect' && !compoundKeys.has(key))) return 'BrowserSkill plan parameters cannot replace the outer identity or extend the bounded protocol keys.';
  }
  return undefined;
}

/** Native schema/policy checks remain authoritative; this guard only narrows them. */
export function browserInvocationDenial(name: string, args: unknown, capabilities: readonly string[], support: BrowserSupport, owned: BrowserInvocationScope = {}): string | undefined {
  if (prefixes.some(prefix => name === `${prefix}new_page`)) return 'MCP page creation is outside this adapter: task-owned page receipts are not tracked.';
  if (!browserToolAllowed(name, capabilities, support)) return `Browser tool ${name} is outside the frozen backend.`;
  if (!object(args)) return 'Browser arguments must be an object.';
  const invalid = parameterDenial(args);
  if (invalid) return invalid;
  if (support.backend === 'mcp') {
    if (mcpName(name)?.suffix === 'close_page' && (typeof args.pageId !== 'number' || !owned.pageIds?.includes(args.pageId))) return 'Browser cleanup requires a page created by this task.';
    return undefined;
  }
  if (Object.keys(args).some(key => !bskKeys[name]?.has(key))) return 'BrowserSkill arguments include a parameter outside the bounded adapter.';
  if (typeof args.action !== 'string') return 'BrowserSkill requires an explicit supported action.';
  const canInteract = interact(capabilities);
  const allowed = name === 'bsk_session' ? ['sync', 'share', 'cooperation-status', 'wait-user', ...(canInteract ? ['start', 'stop'] : [])]
    : name === 'bsk_inspect' ? ['observe', 'snapshot', 'html', 'screenshot', 'console', 'network', 'read', 'extract']
    : name === 'bsk_page' ? ['navigate', 'back', 'forward', 'reload', 'wait', 'wait-for-element']
    : name === 'bsk_interact' ? [...directActions, 'step', 'plan']
    : name === 'bsk_tabs' ? ['list', 'create', 'select', 'close']
    : name === 'bsk_assist' ? ['resize', 'dialog-status', 'dialog-accept', 'dialog-dismiss'] : [];
  if (!allowed.includes(args.action)) return `BrowserSkill action ${args.action} is outside the bounded adapter.`;
  if (name === 'bsk_tabs' && args.action === 'list' && args.scope !== 'agent') return 'BrowserSkill tab listing requires the agent scope.';
  if (name === 'bsk_session' && args.action === 'start') return args.session !== undefined || args.requestId !== undefined || args.tabId !== undefined ? 'BrowserSkill start cannot reuse an existing session, request, or tab identity.' : undefined;
  const ownsSession = text(args.session) && !!owned.sessionIds?.includes(args.session);
  const ownsStop = name === 'bsk_session' && args.action === 'stop' && text(args.requestId) && !!owned.requestIds?.includes(args.requestId) && args.session === undefined;
  if (!ownsSession && !ownsStop) return 'BrowserSkill requires an explicit session or stop request created by this task.';
  if (args.requestId !== undefined && !ownsStop) return 'BrowserSkill stop request is not owned by this task.';
  return name === 'bsk_interact' ? compoundDenial(args) : undefined;
}

/** Invoke the native skill pipeline before tool discovery/restriction; never starts a browser. */
export async function activateBrowserSkill(ctx: HostContext, agent: RuntimeAgent, signal: AbortSignal): Promise<{ activated: boolean; reason: string }> {
  signal.throwIfAborted();
  const modelSelection = agent.model.current();
  if (!modelSelection || typeof ctx.tools?.resolve !== 'function' || typeof ctx.tools?.execute !== 'function') throw new Error('BrowserSkill activation is unsupported: native tool resolution/execution is unavailable.');
  const before = await ctx.tools.resolve({ agent, modelSelection, signal });
  try {
    if (!ctx.tools.schemas(agent, before).some((tool: { name: string }) => tool.name === 'skill')) throw new Error('BrowserSkill activation is unsupported: the native skill tool is not admitted before permission freeze.');
    const batch = await ctx.tools.execute({ agent, signal, toolSet: before, calls: [{ type: 'tool-call', id: ToolCallId(`agentdeck-browser-skill-${randomUUID()}`), name: 'skill', arguments: JSON.stringify({ name: 'browser-skill' }) }] });
    signal.throwIfAborted();
    const result = batch.results[0]?.result;
    const skill = result?.value;
    if (result?.isError || !object(skill) || skill.name !== 'browser-skill' || !text(skill.content)) throw new Error('BrowserSkill activation failed through the native skill pipeline; no supported skill body was returned.');
    const base = skill.resourceBase;
    if (!object(base) || !((base.kind === 'directory' && text(base.path)) || (base.kind === 'url' && text(base.url)))) throw new Error('BrowserSkill activation is unsupported: the skill has no readable reference resource base.');
  } finally { before.dispose(); }
  const after = await ctx.tools.resolve({ agent, modelSelection, signal });
  try {
    const admitted = new Set(ctx.tools.schemas(agent, after).map((tool: { name: string }) => tool.name));
    if (![...bskInteract].every(name => admitted.has(name))) throw new Error('BrowserSkill activation is unsupported: the six native BrowserSkill tools were not admitted after skill invocation.');
  } finally { after.dispose(); }
  return { activated: true, reason: 'The native skill pipeline activated six BrowserSkill tools and returned readable skill references; CLI/extension readiness was not probed.' };
}
