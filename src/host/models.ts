import type { HostContext, RuntimeAgent, JsonObject, EffectiveSelection } from './types.js';
import { messageOf } from './types.js';

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

export async function sessionRoutes(ctx: HostContext, agent?: RuntimeAgent, signal?: AbortSignal): Promise<{ provider: string; model: string }[] | undefined> {
  if (!agent) return undefined;
  const query = ctx.get('sessionQuery') as any;
  if (!query) return undefined;
  const observation = await query.observeSession(agent.id, { projectionMode: 'none', signal });
  try {
    const events = observation.events;
    for (let index = 0; index < events.length; index++) {
      const event = events[index];
      if (event.type === 'subagent/model-selection-policy') return event.data.allowedModels;
    }
    return undefined;
  } finally { observation[Symbol.dispose](); }
}

export function explicitModelRoutes(parent: JsonObject | undefined, routes: Awaited<ReturnType<typeof sessionRoutes>>) {
  return routes ?? (parent?.provider && parent.model ? [{ provider: parent.provider, model: parent.model }] : []);
}

/** Match native implicit inheritance and explicit route policy without discovering models. */
export function routeAuthorization(configured: EffectiveSelection | undefined, parent: JsonObject | undefined,
  routes: { provider: string; model: string }[] | undefined, hasSession: boolean, explicit: boolean): JsonObject {
  if (!hasSession || !configured || !parent) return { status: 'unknown' };
  const same = parent.provider === configured.provider && parent.model === configured.model;
  const allowedModels = explicitModelRoutes(parent, routes);
  if ((!explicit && same) || allowedModels.some(route => route.provider === configured.provider && route.model === configured.model)) return { status: 'authorized' };
  const allowed = allowedModels.slice(0, 8).map(route => `${route.provider}/${route.model}`).join(', ') || '(none)';
  return { status: 'denied', code: 'AGENTDECK_MODEL_NOT_AUTHORIZED', policy: routes ? 'session' : 'parent-only',
    route: { provider: configured.provider, model: configured.model }, allowedModels,
    message: `[AGENTDECK_MODEL_NOT_AUTHORIZED] The effective role route ${configured.provider}/${configured.model} is not authorized by this Session. No child was started. Allowed explicit routes: ${allowed}${allowedModels.length > 8 ? ' (more in Session policy)' : ''}. The owner can change the saved role model in AgentDeck, or configure native /model-selection-settings and create a new Session. Settings changes do not authorize this existing Session. Native delegation will not be bypassed.` };
}

export class ModelAuthorizationError extends Error {
  readonly code = 'AGENTDECK_MODEL_NOT_AUTHORIZED';
  constructor(readonly details: JsonObject) { super(details.message); }
}

export function supportsTextInput(model: JsonObject): boolean {
  return !Array.isArray(model.inputModalities) || model.inputModalities.includes('text');
}

export function modelView(info: JsonObject, authorized: boolean | null): JsonObject {
  return { provider: info.provider, id: info.id, name: info.name ?? info.id, authorized, metadataResolved: true, ...(info.context?.contextWindow ? { contextWindow: info.context.contextWindow } : {}), ...(info.defaultMaxTokens ? { defaultMaxTokens: info.defaultMaxTokens } : {}), efforts: info.reasoning?.efforts ?? [], ...(info.reasoning?.defaultEffort ? { defaultEffort: info.reasoning.defaultEffort } : {}), ...(info.inputModalities ? { inputModalities: info.inputModalities } : {}) };
}

type ModelRoute = { provider: string; model: string };
type ModelEntry = { provider: string; id: string; name?: string };
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
    provider, id, name: name ?? id, authorized: allowed(provider, id), metadataResolved: false,
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
  const allowed = modelPermissions(agent, explicitModelRoutes(delegationSelection(agent), policy));
  const unique = new Map(entries.map(route => [JSON.stringify([route.provider, route.model]), { provider: route.provider, id: route.model }]));
  return resolveModelRows(ctx, [...unique.values()], allowed, signal);
}

function modelPermissions(agent: RuntimeAgent | undefined, routes: ModelRoute[]): ModelAuthorization {
  const allowed = new Set(routes.map(route => JSON.stringify([route.provider, route.model])));
  return (provider, model) => agent ? allowed.has(JSON.stringify([provider, model])) : null;
}

export async function modelDirectory(ctx: HostContext, agent?: RuntimeAgent, query?: { provider: string; model?: string }, signal?: AbortSignal, optionsOnly = false, authorizedRoutesOnly = false, routeSnapshot?: { routes: Awaited<ReturnType<typeof sessionRoutes>> }): Promise<JsonObject> {
  const llm = ctx.get('llm') as any;
  if (!llm) return { providers: [], models: [], policy: agent ? 'parent-only' : 'not-selected', diagnostics: ['Native llm service is unavailable.'] };
  const providers = llm.listProviders();
  const selection = currentSelection(agent);
  const inheritance = delegationSelection(agent);
  const routes = routeSnapshot ? routeSnapshot.routes : await sessionRoutes(ctx, agent, signal);
  signal?.throwIfAborted();
  const explicitRoutes = explicitModelRoutes(inheritance, routes);
  if (optionsOnly && !query) return { providers, models: [], ...(selection ? { selection } : {}), explicitRoutes, policy: !agent ? 'not-selected' : routes ? 'session' : 'parent-only', diagnostics: [] };
  const allowed = modelPermissions(agent, explicitRoutes);
  const diagnostics: string[] = [];
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
    : [...(routes ?? []), ...(selection ? [{ provider: selection.provider, model: selection.model }] : []), ...(inheritance ? [{ provider: inheritance.provider, model: inheritance.model }] : [])];
  for (const route of exact ? [exact] : routeRows.filter(route => !query || route.provider === query.provider)) {
    const key = `${route.provider}\0${route.model}`;
    if (!rows.has(key)) rows.set(key, { provider: route.provider, id: route.model, name: route.model });
  }
  const models = await resolveModelRows(ctx, [...rows.values()], allowed, signal, optionsOnly && !exact);
  return { providers, models, ...(selection ? { selection } : {}), policy: !agent ? 'not-selected' : routes ? 'session' : 'parent-only', diagnostics };
}
