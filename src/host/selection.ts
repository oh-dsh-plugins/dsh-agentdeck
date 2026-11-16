import { agentRevision } from '../core/index.js';
import type { AgentDefinition } from '../core/index.js';
import { optionalString, requiredString } from './types.js';
import type { EffectiveSelection, JsonObject, RoutingDecision } from './types.js';

/** Resolve only the authored choice. Native authorization and parameter validation follow. */
export function roleChoice(role: AgentDefinition, parent: JsonObject | undefined, request: JsonObject = {}, requireRevision = false): {
  configured: EffectiveSelection | undefined;
  explicit: boolean;
  outputSource: 'candidate' | 'role' | 'parent' | 'native-default' | 'unknown';
  decision?: RoutingDecision;
} {
  const revision = agentRevision(role);
  const expected = optionalString(request.revision, 'revision');
  if (expected !== undefined && expected !== revision) throw new Error('The role revision changed. Read its candidate summary again before dispatch.');
  const provider = optionalString(request.provider, 'provider');
  const model = optionalString(request.model, 'model');
  if ((provider === undefined) !== (model === undefined)) throw new Error('provider and model must be supplied together.');
  if (request.maxTokens !== undefined) throw new Error('Output policy is owner-configured; a dispatch cannot override maxTokens.');
  const requestedEffort = optionalString(request.reasoning_effort, 'reasoning_effort');
  const candidateId = optionalString(request.candidateId, 'candidateId');
  if (role.model.mode === 'auto') {
    if (requireRevision && expected === undefined) throw new Error('Candidate dispatch requires the role revision from scene_agent_catalog candidates.');
    const candidates = role.model.candidates ?? [];
    let id = candidateId ?? role.model.defaultCandidate;
    let source: RoutingDecision['source'] = candidateId ? 'recommended' : 'default';
    if (provider && !candidateId) {
      const matches = candidates.filter(candidate => candidate.provider === provider && candidate.model === model
        && (requestedEffort === undefined || candidate.reasoning.mode === 'fixed' && candidate.reasoning.effort === requestedEffort));
      if (matches.length !== 1) throw new Error('Explicit route must identify exactly one configured candidate; use candidateId.');
      id = matches[0].id;
      source = 'legacy-route';
    }
    const candidate = candidates.find(value => value.id === id);
    if (!candidate) throw new Error('Unknown candidate id or invalid default. Read the current candidate summary; no child was started.');
    if (provider && (provider !== candidate.provider || model !== candidate.model)) throw new Error('Explicit route conflicts with the selected candidate.');
    const effort = candidate.reasoning.mode === 'fixed' ? candidate.reasoning.effort : undefined;
    if (requestedEffort !== undefined && requestedEffort !== effort) throw new Error('Explicit effort conflicts with the selected candidate; update its policy through the owner UI.');
    const reason = request.candidateReason === undefined ? undefined : requiredString(request.candidateReason, 'candidateReason', 240);
    return { configured: { provider: candidate.provider, model: candidate.model, ...(effort ? { reasoningEffort: effort } : {}), maxTokens: candidate.maxTokens }, explicit: true, outputSource: 'candidate',
      decision: { candidateId: candidate.id, roleRevision: revision, source, ...(reason ? { reason } : {}) } };
  }
  if (candidateId !== undefined || request.candidateReason !== undefined) throw new Error('Candidates are supported only by an auto role.');
  const route = provider && model ? { provider, model } : role.model.mode === 'fixed'
    ? { provider: role.model.provider!, model: role.model.model! } : parent ? { provider: parent.provider, model: parent.model } : undefined;
  const maximum = role.output?.maxTokens ?? parent?.maxTokens;
  const outputSource = role.output?.maxTokens !== undefined ? 'role' : parent?.maxTokens !== undefined ? 'parent' : 'unknown';
  if (!route) return { configured: undefined, explicit: false, outputSource };
  const changed = !parent || route.provider !== parent.provider || route.model !== parent.model;
  const effort = requestedEffort ?? (role.reasoning.mode === 'fixed' ? role.reasoning.effort
    : role.reasoning.mode === 'inherit-compatible' && !changed ? parent?.reasoningEffort : undefined);
  return { configured: { ...route, ...(effort ? { reasoningEffort: effort } : {}), ...(maximum === undefined ? {} : { maxTokens: maximum }) },
    explicit: provider !== undefined || role.model.mode === 'fixed' || requestedEffort !== undefined || role.reasoning.mode !== 'inherit-compatible', outputSource };
}
