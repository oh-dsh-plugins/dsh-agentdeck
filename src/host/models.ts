import type { HostContext, RuntimeAgent, JsonObject, EffectiveSelection } from './types.js';
import { messageOf, requiredString } from './types.js';
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm';
import type { HostFamily } from './compatibility.js';
import { record, type ModelView, type EffortView, type ModelQueries, type RoutePolicy, type ModelRoute } from './contracts.js';

export function currentSelection(agent?: RuntimeAgent): JsonObject | undefined {
  const current = agent?.model?.current?.();
  if (current?.provider && current.model) return { ...current };
  if (agent?.options?.provider && agent.options.model) return { ...agent.options };
  return undefined;
}

export function delegationSelection(agent?: RuntimeAgent): JsonObject | undefined {
  if (!agent) return undefined;
  const config = agent.session.requestHeader()?.config;
  if (config) return { provider: config.provider, model: config.model, ...(config.reasoningEffort === undefined ? {} : { reasoningEffort: config.reasoningEffort }), ...(agent.options.maxTokens === undefined ? {} : { maxTokens: agent.options.maxTokens }) };
  return agent.options.provider && agent.options.model ? { ...agent.options } : undefined;
}

export type { RoutePolicy } from './contracts.js';
const unknownPolicy = (): Exclude<RoutePolicy, ModelRoute[] | undefined> => ({ kind: 'unknown', message: 'Native Session model policy is unavailable or unsupported. Authorization remains unknown; native delegation will not be bypassed.' });
function policyUnknown(policy: RoutePolicy): policy is Exclude<RoutePolicy, ModelRoute[] | undefined> { return policy !== undefined && !Array.isArray(policy); }
function policyName(agent: RuntimeAgent | undefined, policy: RoutePolicy, family?: HostFamily): string {
  if (!agent) return 'not-selected';
  if (policyUnknown(policy)) return 'unknown';
  if (!policy) return 'parent-only';
  return family === 'live-policy' ? 'live' : 'session';
}

export async function sessionRoutes(ctx: HostContext, agent?: RuntimeAgent, signal?: AbortSignal): Promise<RoutePolicy> {
  if (!agent) return undefined;
  const query = ctx.get('sessionQuery');
  if (!query || typeof query.observeSession !== 'function') return unknownPolicy();
  using observation = await query.observeSession(agent.id, { projectionMode: 'none', signal });
  signal?.throwIfAborted();
  if (!Array.isArray(observation.events)) return unknownPolicy();
  for (const event of observation.events) {
    if (event.type !== 'subagent/model-selection-policy') continue;
    const routes: unknown = event.data?.allowedModels;
    if (!Array.isArray(routes) || !routes.every(route => record(route) && typeof route.provider === 'string' && !!route.provider.trim() && typeof route.model === 'string' && !!route.model.trim())) return unknownPolicy();
    return routes.map(route => ({ provider: route.provider, model: route.model }));
  }
  return undefined;
}

async function liveRoutes(ctx: HostContext, agent?: RuntimeAgent, signal?: AbortSignal): Promise<RoutePolicy> {
  signal?.throwIfAborted();
  if (!agent) return undefined;
  const settings: unknown = ctx.get('subagentModelSelection');
  if (settings === undefined) return undefined;
  if (!record(settings) || typeof settings.allowedRoutes !== 'function') return unknownPolicy();
  try {
    const routes: unknown = settings.allowedRoutes();
    if (routes === undefined) return undefined;
    if (!Array.isArray(routes) || !routes.every(route => record(route) && typeof route.provider === 'string' && !!route.provider.trim() && typeof route.model === 'string' && !!route.model.trim())) return unknownPolicy();
    return routes.map(route => ({ provider: route.provider, model: route.model }));
  } catch (error) {
    if (record(error) && error.code === 'INVALID_MODEL_SELECTION_SETTINGS') return { kind: 'unknown', code: error.code, message: messageOf(error) };
    throw error;
  }
}

export function explicitModelRoutes(parent: JsonObject | undefined, routes: Awaited<ReturnType<typeof sessionRoutes>>) {
  return policyUnknown(routes) ? [] : routes ?? (parent?.provider && parent.model ? [{ provider: parent.provider, model: parent.model }] : []);
}

/** Match native implicit inheritance and explicit route policy without discovering models. */
export function routeAuthorization(configured: EffectiveSelection | undefined, parent: JsonObject | undefined,
  routes: RoutePolicy, hasSession: boolean, explicit: boolean, family: HostFamily = 'session-policy'): JsonObject {
  if (!hasSession || !configured || !parent) return { status: 'unknown' };
  const same = parent.provider === configured.provider && parent.model === configured.model;
  if (family === 'live-policy' && !explicit && same) return { status: 'authorized' };
  if (policyUnknown(routes)) return { status: 'unknown', code: routes.code ?? 'AGENTDECK_MODEL_POLICY_UNKNOWN', policy: 'unknown', message: routes.message };
  const allowedModels = explicitModelRoutes(parent, routes);
  if ((!explicit && same) || allowedModels.some(route => route.provider === configured.provider && route.model === configured.model)) return { status: 'authorized' };
  const allowed = allowedModels.slice(0, 8).map(route => `${route.provider}/${route.model}`).join(', ') || '(none)';
  const live = family === 'live-policy';
  return { status: 'denied', code: 'AGENTDECK_MODEL_NOT_AUTHORIZED', policy: routes ? (live ? 'live' : 'session') : 'parent-only',
    route: { provider: configured.provider, model: configured.model }, allowedModels,
    message: `[AGENTDECK_MODEL_NOT_AUTHORIZED] The effective role route ${configured.provider}/${configured.model} is not authorized by this Session. No child was started. Allowed explicit routes: ${allowed}${allowedModels.length > 8 ? ' (additional routes available)' : ''}. ${live ? 'The owner can change the saved role model or update the current native model selection settings.' : 'The owner can change the saved role model in AgentDeck, or configure native /model-selection-settings and create a new Session. Settings changes do not authorize this existing Session.'} Native delegation will not be bypassed.` };
}

export class ModelAuthorizationError extends Error {
  readonly code: string;
  constructor(readonly details: JsonObject) {
    super(details.message);
    this.code = typeof details.code === 'string' ? details.code : 'AGENTDECK_MODEL_NOT_AUTHORIZED';
  }
}

export function supportsTextInput(model: JsonObject): boolean {
  return !Array.isArray(model.inputModalities) || model.inputModalities.includes('text');
}

export function displayName(value: unknown, fallback: string): string {
  if (typeof value === 'string') return value;
  if (record(value)) for (const key of ['label', 'name', 'id']) if (typeof value[key] === 'string') return value[key];
  return fallback;
}
export function modelView(info: JsonObject, authorized: boolean | null): ModelView {
  const provider = requiredString(info.provider, 'model provider');
  const id = requiredString(info.id, 'model id');
  const label = displayName(info.name, id);
  const source: unknown = info.reasoning?.efforts ?? [];
  if (!Array.isArray(source)) throw new Error('Native reasoning efforts have an unsupported structure.');
  const efforts: EffortView[] = source.map(value => {
    const effortId = requiredString(typeof value === 'string' ? value : value?.id, 'reasoning effort id');
    const effortLabel = displayName(value?.label ?? value?.name, effortId);
    return { id: effortId, label: effortLabel, name: effortLabel, ...(typeof value?.description === 'string' ? { description: value.description } : {}) };
  });
  const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;
  return { provider, id, name: label, label, authorized, metadataResolved: true, efforts,
    ...(positive(info.context?.contextWindow) ? { contextWindow: info.context.contextWindow } : {}),
    ...(positive(info.defaultMaxTokens) ? { defaultMaxTokens: info.defaultMaxTokens } : {}),
    ...(typeof info.reasoning?.defaultEffort === 'string' ? { defaultEffort: info.reasoning.defaultEffort } : {}),
    ...(Array.isArray(info.inputModalities) ? { inputModalities: info.inputModalities.filter((value: unknown) => typeof value === 'string') } : {}) };
}

/** Context-scoped query adapter; metadata never grants Session authorization. */
export function createModelQueries(ctx: HostContext, family: HostFamily = 'session-policy'): ModelQueries {
  const policy = (agent?: RuntimeAgent, signal?: AbortSignal) => family === 'live-policy' ? liveRoutes(ctx, agent, signal) : sessionRoutes(ctx, agent, signal);
  return {
    selection: currentSelection,
    inheritance: delegationSelection,
    policy,
    resolve: async (configured, signal, parent) => {
      const { reasoningEffort, ...config } = configured;
      return ctx.llm.resolveCallConfig({ ...(parent?.maxTokens === undefined ? {} : { maxTokens: parent.maxTokens }), ...config,
        ...(reasoningEffort ? { reasoningEffort: ReasoningEffortId(reasoningEffort) } : {}) }, signal);
    },
    info: async (provider, model, signal) => modelView(await ctx.llm.resolveModelInfo(provider, model, signal), null),
    directory: async (agent, query, signal, optionsOnly) => modelDirectory(ctx, agent, query, signal, optionsOnly, false, { routes: await policy(agent, signal), family }),
  };
}

type ModelEntry = { provider: string; id: string; name?: unknown };
type ModelAuthorization = (provider: string, model: string) => boolean | null;

const METADATA_CONCURRENCY = 8;
// Keep the picker inside its RPC timeout even when an adapter ignores cancellation.
const METADATA_DEADLINE_MS = 4_000;
const MODEL_DIRECTORY_DEADLINE_MS = 4_000;
const METADATA_TIMEOUT = 'Model metadata did not resolve before the lookup deadline. Retry to check the declaration again.';
const DIRECTORY_TIMEOUT = 'Model directory did not resolve before the lookup deadline. Retry to check the provider declaration again.';

async function resolveModelRows(ctx: HostContext, entries: ModelEntry[], allowed: ModelAuthorization,
  signal?: AbortSignal, optionsOnly = false): Promise<JsonObject[]> {
  signal?.throwIfAborted();
  const rows: JsonObject[] = entries.map(({ provider, id, name }) => ({
    provider, id, name: displayName(name, id), label: displayName(name, id), authorized: allowed(provider, id), metadataResolved: false,
  }));
  if (optionsOnly || !entries.length) return rows;
  const llm = ctx.get('llm');
  if (!llm) return rows.map(row => ({ ...row, error: 'Native llm service is unavailable.' }));

  const deadline = new AbortController();
  const lookup = signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal;
  let stop!: () => void;
  const stopped = new Promise<void>(resolve => { stop = resolve; });
  lookup.addEventListener('abort', stop, { once: true });
  const timer = setTimeout(() => deadline.abort(), METADATA_DEADLINE_MS);
  // Reserve time for later groups even when every lookup in the first group stalls.
  const waves = Math.ceil(rows.length / METADATA_CONCURRENCY);
  const slotMs = Math.max(1, Math.floor(METADATA_DEADLINE_MS / waves));
  let cursor = 0;
  const worker = async () => {
    while (!lookup.aborted && cursor < rows.length) {
      const index = cursor++;
      const row = rows[index];
      const slot = new AbortController();
      const attempt = AbortSignal.any([lookup, slot.signal]);
      let cancel!: () => void;
      const cancelled = new Promise<undefined>(resolve => { cancel = () => resolve(undefined); });
      attempt.addEventListener('abort', cancel, { once: true });
      const slotTimer = setTimeout(() => slot.abort(), slotMs);
      try {
        const info = await Promise.race([llm.resolveModelInfo(row.provider, row.id, attempt), cancelled]);
        if (info && !attempt.aborted) rows[index] = modelView(info, row.authorized);
      } catch (error) {
        if (!attempt.aborted) rows[index] = { ...row, error: messageOf(error) };
      } finally {
        clearTimeout(slotTimer);
        attempt.removeEventListener('abort', cancel);
        if (slot.signal.aborted && !lookup.aborted) rows[index] = { ...row, error: METADATA_TIMEOUT };
      }
    }
  };
  try {
    await Promise.race([Promise.all(Array.from({ length: Math.min(METADATA_CONCURRENCY, rows.length) }, worker)), stopped]);
    signal?.throwIfAborted();
    return deadline.signal.aborted ? rows.map(row => row.metadataResolved || row.error ? row : { ...row, error: METADATA_TIMEOUT }) : rows;
  } finally {
    clearTimeout(timer);
    lookup.removeEventListener('abort', stop);
  }
}

/** Resolve a deduplicated batch with a single Session policy observation and deadline. */
export async function modelDeclarations(ctx: HostContext, entries: ModelRoute[], agent: RuntimeAgent | undefined,
  signal?: AbortSignal, routeSnapshot?: { routes: Awaited<ReturnType<typeof sessionRoutes>> }): Promise<JsonObject[]> {
  if (!entries.length) return [];
  const policy = routeSnapshot ? routeSnapshot.routes : await sessionRoutes(ctx, agent, signal);
  const allowed = modelPermissions(agent, explicitModelRoutes(delegationSelection(agent), policy), policyUnknown(policy));
  const unique = new Map(entries.map(route => [JSON.stringify([route.provider, route.model]), { provider: route.provider, id: route.model }]));
  return resolveModelRows(ctx, [...unique.values()], allowed, signal);
}

function modelPermissions(agent: RuntimeAgent | undefined, routes: ModelRoute[], unknown = false): ModelAuthorization {
  const allowed = new Set(routes.map(route => JSON.stringify([route.provider, route.model])));
  return (provider, model) => agent && !unknown ? allowed.has(JSON.stringify([provider, model])) : null;
}

export async function modelDirectory(ctx: HostContext, agent?: RuntimeAgent, query?: { provider: string; model?: string }, signal?: AbortSignal, optionsOnly = false, authorizedRoutesOnly = false, routeSnapshot?: { routes: RoutePolicy; family?: HostFamily }): Promise<JsonObject> {
  const llm = ctx.get('llm') as any;
  if (!llm) return { providers: [], models: [], policy: agent ? 'parent-only' : 'not-selected', diagnostics: ['Native llm service is unavailable.'] };
  const providers = llm.listProviders().map((provider: JsonObject) => ({ id: provider.id, name: displayName(provider.name, provider.id), label: displayName(provider.name, provider.id) }));
  const selection = currentSelection(agent);
  const inheritance = delegationSelection(agent);
  const routes = routeSnapshot ? routeSnapshot.routes : await sessionRoutes(ctx, agent, signal);
  signal?.throwIfAborted();
  const explicitRoutes = explicitModelRoutes(inheritance, routes);
  if (optionsOnly && !query) return { providers, models: [], ...(selection ? { selection } : {}), explicitRoutes, policy: policyName(agent, routes, routeSnapshot?.family), diagnostics: [] };
  const allowed = modelPermissions(agent, explicitRoutes, policyUnknown(routes));
  const diagnostics: string[] = policyUnknown(routes) ? [routes.message] : [];
  const rows = new Map<string, any>();
  const exact = query?.model ? { provider: query.provider, model: query.model } : undefined;
  if (!exact && !authorizedRoutesOnly) {
    const deadline = new AbortController();
    const lookup = signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal;
    let stop!: () => void;
    const stopped = new Promise<void>(resolve => { stop = resolve; });
    lookup.addEventListener('abort', stop, { once: true });
    const timer = setTimeout(() => deadline.abort(), MODEL_DIRECTORY_DEADLINE_MS);
    const pendingProviders = new Set<string>();
    const listProvider = async (provider: any) => {
      pendingProviders.add(provider.id);
      let cancel!: () => void;
      const cancelled = new Promise<undefined>(resolve => { cancel = () => resolve(undefined); });
      const list = Promise.resolve().then(() => llm.listModels(provider.id));
      // The native signature has no AbortSignal. Observe late rejection without
      // allowing it to keep this request alive or mutate the returned directory.
      list.catch(() => undefined);
      lookup.addEventListener('abort', cancel, { once: true });
      try {
        const entries = await Promise.race([list, cancelled]);
        if (!entries || lookup.aborted) return;
        for (const entry of entries) rows.set(`${provider.id}\0${entry.id}`, entry);
      } catch (error) {
        if (!lookup.aborted) diagnostics.push(`${provider.id}: ${messageOf(error)}`);
      } finally {
        if (!lookup.aborted) pendingProviders.delete(provider.id);
        lookup.removeEventListener('abort', cancel);
      }
    };
    const selected = providers.filter((provider: any) => !query || provider.id === query.provider);
    try {
      await Promise.race([Promise.all(selected.map(listProvider)), stopped]);
      signal?.throwIfAborted();
      if (deadline.signal.aborted) for (const id of pendingProviders) diagnostics.push(`${id}: ${DIRECTORY_TIMEOUT}`);
    } finally {
      clearTimeout(timer);
      lookup.removeEventListener('abort', stop);
    }
  }
  const routeRows = authorizedRoutesOnly
    ? explicitRoutes
    : [...(Array.isArray(routes) ? routes : []), ...(selection ? [{ provider: selection.provider, model: selection.model }] : []), ...(inheritance ? [{ provider: inheritance.provider, model: inheritance.model }] : [])];
  for (const route of exact ? [exact] : routeRows.filter(route => !query || route.provider === query.provider)) {
    const key = `${route.provider}\0${route.model}`;
    if (!rows.has(key)) rows.set(key, { provider: route.provider, id: route.model, name: route.model });
  }
  const models = await resolveModelRows(ctx, [...rows.values()], allowed, signal, optionsOnly && !exact);
  return { providers, models, ...(selection ? { selection } : {}), policy: policyName(agent, routes, routeSnapshot?.family), diagnostics };
}
