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

/** Match native implicit inheritance and explicit route policy without discovering models. */
export function routeAuthorization(configured: EffectiveSelection | undefined, parent: JsonObject | undefined,
  routes: { provider: string; model: string }[] | undefined, hasSession: boolean, explicit: boolean): JsonObject {
  if (!hasSession || !configured || !parent) return { status: 'unknown' };
  const same = parent.provider === configured.provider && parent.model === configured.model;
  const allowedModels = routes ?? [{ provider: parent.provider, model: parent.model }];
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

export function modelView(info: JsonObject, authorized: boolean | null): JsonObject {
  return { provider: info.provider, id: info.id, name: info.name ?? info.id, authorized, metadataResolved: true, ...(info.context?.contextWindow ? { contextWindow: info.context.contextWindow } : {}), ...(info.defaultMaxTokens ? { defaultMaxTokens: info.defaultMaxTokens } : {}), efforts: info.reasoning?.efforts ?? [], ...(info.reasoning?.defaultEffort ? { defaultEffort: info.reasoning.defaultEffort } : {}), ...(info.inputModalities ? { inputModalities: info.inputModalities } : {}) };
}

export async function modelDirectory(ctx: HostContext, agent?: RuntimeAgent, query?: { provider: string; model?: string }, signal?: AbortSignal, optionsOnly = false, authorizedRoutesOnly = false, routeSnapshot?: { routes: Awaited<ReturnType<typeof sessionRoutes>> }): Promise<JsonObject> {
  const llm = ctx.get('llm') as any;
  if (!llm) return { providers: [], models: [], policy: agent ? 'parent-only' : 'not-selected', diagnostics: ['Native llm service is unavailable.'] };
  const providers = llm.listProviders();
  const selection = currentSelection(agent);
  const inheritance = delegationSelection(agent);
  if (optionsOnly && !query) return { providers, models: [], ...(selection ? { selection } : {}), policy: agent ? 'unresolved' : 'not-selected', diagnostics: [] };
  const routes = routeSnapshot ? routeSnapshot.routes : await sessionRoutes(ctx, agent, signal);
  const allowed = (provider: string, model: string) => !agent ? null : routes ? routes.some(route => route.provider === provider && route.model === model) : inheritance?.provider === provider && inheritance.model === model;
  const diagnostics: string[] = [];
  const rows = new Map<string, any>();
  const exact = query?.model ? { provider: query.provider, model: query.model } : undefined;
  if (!exact && !authorizedRoutesOnly) await Promise.all(providers.filter((provider: any) => !query || provider.id === query.provider).map(async (provider: any) => {
    try {
      for (const entry of await llm.listModels(provider.id)) rows.set(`${provider.id}\0${entry.id}`, entry);
    } catch (error) { diagnostics.push(`${provider.id}: ${messageOf(error)}`); }
  }));
  const routeRows = authorizedRoutesOnly
    ? (routes ?? (inheritance ? [{ provider: inheritance.provider, model: inheritance.model }] : []))
    : [...(routes ?? []), ...(selection ? [{ provider: selection.provider, model: selection.model }] : []), ...(inheritance ? [{ provider: inheritance.provider, model: inheritance.model }] : [])];
  for (const route of exact ? [exact] : routeRows.filter(route => !query || route.provider === query.provider)) {
    const key = `${route.provider}\0${route.model}`;
    if (!rows.has(key)) rows.set(key, { provider: route.provider, id: route.model, name: route.model });
  }
  const entries = [...rows.values()];
  const models = new Array<JsonObject>(entries.length);
  let cursor = 0;
  const resolveOne = async () => {
    while (true) {
      signal?.throwIfAborted();
      const index = cursor++;
      if (index >= entries.length) return;
      const entry = entries[index];
      const provider = entry.provider;
      const base = { provider, id: entry.id, name: entry.name ?? entry.id, authorized: allowed(provider, entry.id) };
      if (optionsOnly && !exact) { models[index] = { ...base, metadataResolved: false }; continue; }
      try {
        const info = await llm.resolveModelInfo(provider, entry.id, signal);
        models[index] = modelView(info, base.authorized);
      } catch (error) { signal?.throwIfAborted(); models[index] = { ...base, metadataResolved: false, error: messageOf(error) }; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(8, entries.length) }, resolveOne));
  signal?.throwIfAborted();
  return { providers, models, ...(selection ? { selection } : {}), policy: !agent ? 'not-selected' : routes ? 'session' : 'parent-only', diagnostics };
}
