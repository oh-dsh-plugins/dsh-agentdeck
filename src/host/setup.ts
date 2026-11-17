import { parseDocument } from 'yaml';
import { agentRevision, parseOverrideText, resolveContextBudget } from '../core/index.js';
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
