import type { HostContext, RuntimeAgent, JsonObject } from './types.js';
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

export function modelView(info: JsonObject, authorized: boolean | null): JsonObject {
  return { provider: info.provider, id: info.id, name: info.name ?? info.id, authorized, metadataResolved: true, ...(info.context?.contextWindow ? { contextWindow: info.context.contextWindow } : {}), ...(info.defaultMaxTokens ? { defaultMaxTokens: info.defaultMaxTokens } : {}), efforts: info.reasoning?.efforts ?? [], ...(info.reasoning?.defaultEffort ? { defaultEffort: info.reasoning.defaultEffort } : {}), ...(info.inputModalities ? { inputModalities: info.inputModalities } : {}) };
}

export async function modelDirectory(ctx: HostContext, agent?: RuntimeAgent, query?: { provider: string; model?: string }, signal?: AbortSignal, optionsOnly = false): Promise<JsonObject> {
  const llm = ctx.get('llm') as any;
  if (!llm) return { providers: [], models: [], policy: agent ? 'parent-only' : 'not-selected', diagnostics: ['Native llm service is unavailable.'] };
  const providers = llm.listProviders();
  const selection = currentSelection(agent);
  const inheritance = delegationSelection(agent);
  if (optionsOnly && !query) return { providers, models: [], ...(selection ? { selection } : {}), policy: agent ? 'unresolved' : 'not-selected', diagnostics: [] };
  const routes = await sessionRoutes(ctx, agent, signal);
  const allowed = (provider: string, model: string) => !agent ? null : routes ? routes.some(route => route.provider === provider && route.model === model) : inheritance?.provider === provider && inheritance.model === model;
  const diagnostics: string[] = [];
  const rows = new Map<string, any>();
  const exact = query?.model ? { provider: query.provider, model: query.model } : undefined;
  if (!exact) await Promise.all(providers.filter((provider: any) => !query || provider.id === query.provider).map(async (provider: any) => {
    try {
      for (const entry of await llm.listModels(provider.id)) rows.set(`${provider.id}\0${entry.id}`, entry);
    } catch (error) { diagnostics.push(`${provider.id}: ${messageOf(error)}`); }
  }));
  for (const route of exact ? [exact] : [...(routes ?? []), ...(selection ? [{ provider: selection.provider, model: selection.model }] : []), ...(inheritance ? [{ provider: inheritance.provider, model: inheritance.model }] : [])].filter(route => !query || route.provider === query.provider)) {
    const key = `${route.provider}\0${route.model}`;
    if (!rows.has(key)) rows.set(key, { provider: route.provider, id: route.model, name: route.model });
  }
  const models = await Promise.all([...rows.values()].map(async entry => {
    const provider = entry.provider;
    const base = { provider, id: entry.id, name: entry.name ?? entry.id, authorized: allowed(provider, entry.id) };
    if (optionsOnly && !exact) return { ...base, metadataResolved: false };
    try {
      const info = await llm.resolveModelInfo(provider, entry.id, signal);
      return modelView(info, base.authorized);
    } catch (error) { signal?.throwIfAborted(); return { ...base, metadataResolved: false, error: messageOf(error) }; }
  }));
  signal?.throwIfAborted();
  return { providers, models, ...(selection ? { selection } : {}), policy: !agent ? 'not-selected' : routes ? 'session' : 'parent-only', diagnostics };
}
