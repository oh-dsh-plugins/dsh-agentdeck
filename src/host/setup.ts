import { parseDocument } from 'yaml';
import { agentRevision, parseOverrideText, resolveContextBudget, validateAgent } from '../core/index.js';
import { keys, record, tokens } from '../core/validation.js';
import type { AgentDefinition } from '../core/index.js';
import { object, requiredString } from './types.js';
import type { JsonObject, OverrideRecord } from './types.js';
import { roleChoice } from './selection.js';

export const setupDiagnostic = (code: string, message: string, params?: JsonObject) => ({ code, message, ...(params ? { params } : {}) });
export function setupRoute(value: unknown) {
  const route = object(value, 'route');
  return { provider: requiredString(route.provider, 'provider', 256), model: requiredString(route.model, 'model', 256) };
}
export function setupRoleIds(value: unknown): string[] {
  if (!Array.isArray(value) || !value.length || value.length > 100) throw new Error('Select between 1 and 100 agents.');
  const ids = value.map(id => requiredString(id, 'role id', 64));
  if (new Set(ids).size !== ids.length) throw new Error('Agent ids must be unique.');
  return ids;
}
export const setupResources = (role: AgentDefinition) => ({ model: role.model, reasoning: role.reasoning, ...(role.output ? { output: role.output } : {}), context: role.context });

// Use the same complete-definition validator as saved roles, including candidate limits.
const strategyTemplate = {
  schemaVersion: 2, id: 'setup', title: { en: 'Setup', zh: 'Setup' },
  description: { en: 'Setup', zh: 'Setup' }, instructions: 'Setup', capabilities: [],
  skills: [], scripts: [], inputs: [], deliverables: [], enabled: true,
  context: { targetTokens: 1, elasticTokens: 1 },
};
export function normalizeSetupStrategy(value: unknown): JsonObject {
  const strategy = record(value, 'strategy');
  if (!['inherit', 'fixed', 'auto'].includes(strategy.mode as string)) throw new Error('strategy.mode must be inherit, fixed or auto');
  const auto = strategy.mode === 'auto';
  keys(strategy, auto ? ['mode', 'candidates', 'defaultCandidate']
    : strategy.mode === 'fixed' ? ['mode', 'provider', 'model', 'reasoning', 'outputPolicy']
      : ['mode', 'reasoning', 'outputPolicy'], 'strategy');
  const model = auto ? { mode: 'auto', candidates: strategy.candidates, defaultCandidate: strategy.defaultCandidate }
    : strategy.mode === 'fixed' ? { mode: 'fixed', provider: strategy.provider, model: strategy.model } : { mode: 'inherit' };
  const reasoning = auto ? { mode: 'model-default' } : strategy.reasoning ?? { mode: strategy.mode === 'inherit' ? 'inherit-compatible' : 'model-default' };
  const parsed = validateAgent({ ...strategyTemplate, model, reasoning });
  if (strategy.mode === 'fixed' && parsed.reasoning.mode === 'inherit-compatible') throw new Error('Fixed strategy reasoning must be model-default or fixed');
  if (auto) return parsed.model;
  const output = strategy.outputPolicy === undefined ? { mode: 'preserve' } : record(strategy.outputPolicy, 'strategy.outputPolicy');
  keys(output, ['mode', 'maxTokens'], 'strategy.outputPolicy');
  if (!['preserve', 'set', 'clear'].includes(output.mode as string)) throw new Error('strategy.outputPolicy.mode must be preserve, set or clear');
  if (output.mode !== 'set' && Object.hasOwn(output, 'maxTokens')) throw new Error('strategy.outputPolicy.maxTokens requires set mode');
  const outputPolicy = output.mode === 'set' ? { mode: 'set', maxTokens: tokens(output.maxTokens, 'strategy.outputPolicy.maxTokens', 1) } : { mode: output.mode };
  return { ...parsed.model, reasoning: parsed.reasoning, outputPolicy };
}

export function setupStrategyRoutes(strategy: JsonObject): { provider: string; model: string }[] {
  const parsed = normalizeSetupStrategy(strategy);
  const routes = parsed.mode === 'inherit' ? [] : parsed.mode === 'fixed' ? [parsed] : parsed.candidates;
  const unique = new Map<string, { provider: string; model: string }>();
  for (const route of routes) unique.set(JSON.stringify([route.provider, route.model]), { provider: route.provider, model: route.model });
  return [...unique.values()];
}

/** Propose declarations only: authorization and plugin availability remain native runtime checks. */
export function recommendStrategyRole(role: AgentDefinition, override: OverrideRecord | undefined, strategy: JsonObject, models: JsonObject[], options: {
  externalSource?: string; includeBrowser: boolean; capabilitiesMissing: boolean; parent?: JsonObject;
  scopePolicy: 'fill-unconfigured' | 'replace-selected'; resourceMigration?: JsonObject;
}): JsonObject {
  const parsed = normalizeSetupStrategy(strategy);
  if (!['fill-unconfigured', 'replace-selected'].includes(options.scopePolicy)) throw new Error('Invalid setup scopePolicy');
  const browser = role.capabilities.some(value => value.startsWith('browser-'));
  const reasons: ReturnType<typeof setupDiagnostic>[] = [];
  const warnings: ReturnType<typeof setupDiagnostic>[] = [];
  const before = setupResources(role);
  const row: JsonObject = { id: role.id, title: role.title, roleRevision: agentRevision(role),
    ...(override ? { expectedRevision: override.revision, currentText: override.text } : {}),
    ...(options.externalSource ? { source: options.externalSource } : {}), before, after: before,
    status: 'blocked', applicable: false, reasons, warnings };
  const stop = (status: string, code: string, message: string, params?: JsonObject) => {
    row.status = status; warnings.push(setupDiagnostic(code, message, params)); return row;
  };
  if (options.capabilitiesMissing) warnings.push(setupDiagnostic('setup.capabilityWarning', 'Some runtime capabilities are missing or unverified. Saving does not enable plugins.'));
  if (options.externalSource) return stop('preserved', 'setup.sourceOwned', 'Edit the source file for this agent.', { source: options.externalSource });
  if (browser && !options.includeBrowser) return stop('preserved', 'setup.browserExcluded', 'Browser support was not selected.');
  if (options.scopePolicy === 'fill-unconfigured' && (override || !role.enabled)) return stop('preserved', 'setup.configuredPreserved', 'Existing overrides and disabled agents are preserved.');

  let model: AgentDefinition['model'] = parsed.mode === 'auto' ? parsed as AgentDefinition['model']
    : parsed.mode === 'fixed' ? { mode: 'fixed', provider: parsed.provider, model: parsed.model } : { mode: 'inherit' };
  let reasoning: AgentDefinition['reasoning'] = parsed.mode === 'auto' ? { mode: 'model-default' } : parsed.reasoning;
  let output = role.output;
  let clearOutput = false;
  if (role.model.mode === 'auto' && parsed.mode !== 'auto') {
    if (!options.resourceMigration) return stop('blocked', 'setup.migrationRequired', 'Confirm a candidate resource migration or an explicit resource reset before leaving auto mode.');
    const migration = record(options.resourceMigration, 'resourceMigration');
    keys(migration, migration.mode === 'candidate' ? ['mode', 'candidateId'] : ['mode'], 'resourceMigration');
    if (migration.mode === 'candidate') {
      const candidate = role.model.candidates?.find(value => value.id === migration.candidateId);
      if (!candidate) return stop('blocked', 'setup.migrationCandidateMissing', 'Select an existing candidate for resource migration.');
      reasoning = candidate.reasoning; output = { maxTokens: candidate.maxTokens };
    } else if (migration.mode === 'reset') {
      reasoning = { mode: 'model-default' }; output = undefined; clearOutput = true;
    } else throw new Error('resourceMigration.mode must be candidate or reset');
  } else if (parsed.mode === 'auto') { output = undefined; clearOutput = role.model.mode !== 'auto' || role.output !== undefined; }
  else if (parsed.outputPolicy.mode === 'set') output = { maxTokens: parsed.outputPolicy.maxTokens };
  else if (parsed.outputPolicy.mode === 'clear') { output = undefined; clearOutput = true; }

  const metadata = (provider: string, id: string) => models.find(value => value.provider === provider && value.id === id && value.metadataResolved);
  // Missing metadata is not the same as a declared lack of image support.
  for (const route of setupStrategyRoutes(parsed)) {
    if (!metadata(route.provider, route.model)) return stop('blocked', 'setup.metadataMissing', 'Resolve every selected model declaration before applying.');
  }
  if (browser && model.mode === 'auto') {
    const candidates = model.candidates!.filter(candidate => metadata(candidate.provider, candidate.model)?.inputModalities?.includes('image'));
    if (!candidates.some(candidate => candidate.id === model.defaultCandidate)) return stop('blocked', 'setup.defaultCandidateFiltered', 'The browser default is not a declared image candidate. Confirm a new default before applying.');
    if (candidates.length !== model.candidates!.length) warnings.push(setupDiagnostic('setup.candidatesFiltered', 'Non-image candidates were excluded from the browser pool.'));
    model = { ...model, candidates };
  }
  const proposed: AgentDefinition = { ...role, schemaVersion: parsed.mode === 'auto' || output || clearOutput ? 2 : role.schemaVersion,
    model, reasoning, context: { ...role.context } };
  if (output) proposed.output = output; else delete proposed.output;
  // A no-op inherit selection must not freeze Session estimates into an override.
  const originalPatch = override ? parseOverrideText(override.text) : undefined;
  const clearChangesDeclaration = clearOutput && originalPatch?.output !== null;
  const setChangesDeclaration = parsed.outputPolicy?.mode === 'set'
    && (originalPatch?.output as JsonObject | undefined)?.maxTokens !== output?.maxTokens;
  const sameResources = JSON.stringify(before) === JSON.stringify(setupResources(proposed));
  if (model.mode === 'inherit' && sameResources && !clearChangesDeclaration && !setChangesDeclaration) {
    row.status = 'unchanged';
    if (!options.parent) warnings.push(setupDiagnostic('setup.inheritanceUnverified', 'The inherited model and capabilities are not verified without a Session.'));
    return row;
  }
  const choices = model.mode === 'auto' ? model.candidates!.map(candidate => ({ provider: candidate.provider, model: candidate.model,
    reasoningEffort: candidate.reasoning.mode === 'fixed' ? candidate.reasoning.effort : undefined, maxTokens: candidate.maxTokens }))
    : [roleChoice(proposed, options.parent).configured];
  const budgets: ReturnType<typeof resolveContextBudget>[] = [];
  for (const choice of choices) {
    if (!choice) { warnings.push(setupDiagnostic('setup.inheritanceUnverified', 'Inheritance can be saved without a Session; its effective model and capabilities are not verified.')); continue; }
    const info = metadata(choice.provider, choice.model);
    if (!info) {
      if (model.mode !== 'inherit') return stop('blocked', 'setup.metadataMissing', 'Resolve the selected model declaration before applying.');
      warnings.push(setupDiagnostic('setup.inheritanceUnverified', 'The inherited model declaration is unavailable; its capabilities are not verified.')); continue;
    }
    if (info.authorized === false) warnings.push(setupDiagnostic('setup.authorizationWarning', 'The current Session does not authorize this model. Saving does not grant authorization.'));
    else if (info.authorized !== true) warnings.push(setupDiagnostic('setup.authorizationUnknown', 'Session authorization is unverified. Saving does not grant authorization.'));
    if (browser && !info.inputModalities?.includes('image')) return stop('blocked', 'setup.imageRequired', 'Browser verification requires declared image input support.');
    if (choice.reasoningEffort && !info.efforts?.some((effort: JsonObject) => effort.id === choice.reasoningEffort)) return stop('blocked', 'setup.effortUnsupported', 'The selected model does not declare the requested reasoning effort.');
    if (choice.maxTokens === undefined) warnings.push(setupDiagnostic('setup.outputAssumed', 'Input estimates use the model default output; another Session may inherit a different limit.'));
    const budget = resolveContextBudget({ ...role.context, windowTokens: info.contextWindow, outputTokens: choice.maxTokens ?? info.defaultMaxTokens });
    budgets.push(budget);
    if (budget.known && budget.safeInputTokens === 0) return stop('blocked', 'setup.noCapacity', 'An output reservation exhausts a selected model context window.');
  }
  // Equal effective output is not a no-op when an explicit clear changes future inheritance.
  if (sameResources && !clearChangesDeclaration && !setChangesDeclaration) { row.status = 'unchanged'; return row; }
  if (budgets.length !== choices.length || budgets.some(budget => !budget.known)) {
    warnings.push(setupDiagnostic('setup.capacityUnknown', 'Some declared capacities are unknown. Existing input targets are preserved.'));
  } else if (budgets.length) {
    proposed.context = { targetTokens: Math.min(...budgets.map(budget => budget.targetTokens)), elasticTokens: Math.min(...budgets.map(budget => budget.elasticTokens)) };
    if (JSON.stringify(proposed.context) !== JSON.stringify(role.context)) reasons.push(setupDiagnostic('setup.contextClamped', 'Clamp input targets to the minimum safe capacity of every selected candidate.', { tokens: proposed.context.elasticTokens }));
  }
  validateAgent(proposed);
  const doc = parseDocument(override?.text ?? JSON.stringify({ schemaVersion: role.schemaVersion, id: role.id }));
  if (proposed.schemaVersion !== role.schemaVersion || clearOutput || output) doc.set('schemaVersion', proposed.schemaVersion);
  doc.set('model', model); doc.set('reasoning', reasoning);
  if (clearOutput) doc.set('output', null);
  else if (output && (parsed.outputPolicy?.mode === 'set' || role.model.mode === 'auto')) doc.set('output', output);
  if (JSON.stringify(proposed.context) !== JSON.stringify(role.context)) doc.set('context', proposed.context);
  const proposedText = doc.toString(); parseOverrideText(proposedText);
  reasons.push(setupDiagnostic('setup.strategySelected', 'Use the owner-selected strategy without ranking or discovering models.'));
  return { ...row, status: 'changed', applicable: true, after: setupResources(proposed), proposedText };
}

/** Uses exactly the models selected by the owner, never inference or speculative rankings. */
export function recommendRole(role: AgentDefinition, override: OverrideRecord | undefined, model: JsonObject | undefined, options: { externalSource?: string; includeBrowser: boolean; capabilitiesMissing: boolean; parent?: JsonObject }) {
  const browser = role.capabilities.some(value => value.startsWith('browser-'));
  const reasons = [setupDiagnostic(browser ? 'setup.imageRoute' : 'setup.defaultRoute', browser ? 'Use the selected image model for browser verification.' : 'Use the selected default model.')];
  const warnings: ReturnType<typeof setupDiagnostic>[] = [];
  let applicable = true;
  if (options.externalSource) { applicable = false; warnings.push(setupDiagnostic('setup.sourceOwned', 'Edit the source file for this agent.', { source: options.externalSource })); }
  if (browser && !options.includeBrowser) { applicable = false; warnings.push(setupDiagnostic('setup.browserExcluded', 'Browser support was not selected.')); }
  if (!model?.metadataResolved) { applicable = false; warnings.push(setupDiagnostic('setup.metadataMissing', 'Resolve the selected model metadata before applying.')); }
  if (browser && model?.metadataResolved && !model.inputModalities?.includes('image')) { applicable = false; warnings.push(setupDiagnostic('setup.imageRequired', 'Browser verification requires a declared image input model.')); }
  if (model?.authorized === false) warnings.push(setupDiagnostic('setup.authorizationWarning', 'The current Session does not authorize this model. Saving does not grant authorization.'));
  if (options.capabilitiesMissing) warnings.push(setupDiagnostic('setup.capabilityWarning', 'Some runtime capabilities are missing or unverified. Saving does not enable plugins.'));
  const row: JsonObject = { id: role.id, title: role.title, roleRevision: agentRevision(role), ...(override ? { expectedRevision: override.revision, currentText: override.text } : {}), applicable, reasons, warnings, before: setupResources(role), ...(options.externalSource ? { source: options.externalSource } : {}) };
  if (!applicable || !model) return row;
  const doc = parseDocument(override?.text ?? JSON.stringify({ schemaVersion: role.schemaVersion, id: role.id }));
  doc.set('model', { mode: 'fixed', provider: model.provider, model: model.id });
  doc.set('reasoning', { mode: 'model-default' });
  let context = role.context;
  const proposedRole: AgentDefinition = { ...role, model: { mode: 'fixed', provider: model.provider, model: model.id }, reasoning: { mode: 'model-default' } };
  const choice = roleChoice(proposedRole, options.parent);
  if (choice.configured?.maxTokens === undefined) warnings.push(setupDiagnostic('setup.outputAssumed', 'Input estimates use the model default output; a Session may inherit a different output limit.'));
  const budget = resolveContextBudget({ ...context, windowTokens: model.contextWindow, outputTokens: choice.configured?.maxTokens ?? model.defaultMaxTokens });
  if (budget.known && budget.safeInputTokens === 0) {
    if (choice.outputSource === 'parent') warnings.push(setupDiagnostic('setup.sessionNoCapacity', 'The current Session output limit leaves no input capacity. Existing input targets are preserved; saving does not change that Session.'));
    else { row.applicable = false; warnings.push(setupDiagnostic('setup.noCapacity', 'The output reservation exhausts this model context window.')); return row; }
  } else if (budget.known && (budget.targetTokens !== context.targetTokens || budget.elasticTokens !== context.elasticTokens)) {
    context = { targetTokens: budget.targetTokens, elasticTokens: budget.elasticTokens }; doc.set('context', context);
    reasons.push(setupDiagnostic('setup.contextClamped', 'Clamp input targets to the declared context window after output and headroom.', { tokens: budget.safeInputTokens }));
  }
  if (!budget.known) warnings.push(setupDiagnostic('setup.capacityUnknown', 'Declared context or output capacity is unknown. Existing targets are preserved.'));
  const proposedText = doc.toString(); parseOverrideText(proposedText);
  return { ...row, proposedText, after: { ...setupResources(role), model: { mode: 'fixed', provider: model.provider, model: model.id }, reasoning: { mode: 'model-default' }, context } };
}
