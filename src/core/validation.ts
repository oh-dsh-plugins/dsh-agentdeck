import { parseAllDocuments } from 'yaml';
import type { AgentDefinition, LocalizedText, ModelCandidate } from './types.js';

export const CAPABILITIES = [
  'files-read', 'source-edit', 'project-runner', 'web-research',
  'browser-observe', 'browser-interact', 'data-query', 'artifact-write',
] as const;
const fields = ['schemaVersion', 'id', 'title', 'description', 'instructions', 'capabilities',
  'skills', 'scripts', 'inputs', 'deliverables', 'model', 'reasoning', 'context', 'enabled', 'extends'];
const own = (value: object, key: string) => Object.hasOwn(value, key);

export function record(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new Error(`${path} must be a plain mapping`);
  }
  return value as Record<string, unknown>;
}
export function keys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new Error(`${path}: unknown field ${key}`);
  }
}
export function text(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.includes('\0')) {
    throw new Error(`${path} must be a nonempty string without NUL`);
  }
  return value;
}
export function identifier(value: unknown, path: string): string {
  const id = text(value, path);
  if (id.length > 64 || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(id)) {
    throw new Error(`${path} must be a lowercase kebab-case identifier of at most 64 characters`);
  }
  return id;
}
export function tokens(value: unknown, path: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > 16_777_216) {
    throw new Error(`${path} must be an integer between ${minimum} and 16777216`);
  }
  return value as number;
}
export function strings(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array of strings`);
  const result = value.map((item, index) => text(item, `${path}[${index}]`));
  if (new Set(result).size !== result.length) throw new Error(`${path} contains duplicate entries`);
  return result;
}
function localized(value: unknown, path: string): LocalizedText {
  const item = record(value, path);
  keys(item, ['en', 'zh'], path);
  return { en: text(item.en, `${path}.en`), zh: text(item.zh, `${path}.zh`) };
}

function candidates(value: unknown, path: string): ModelCandidate[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 3) {
    throw new Error(`${path} must contain between 1 and 3 candidates`);
  }
  const parsed = Array.from(value, (value, index): ModelCandidate => {
    const pathItem = `${path}[${index}]`;
    const item = record(value, pathItem);
    keys(item, ['id', 'purpose', 'provider', 'model', 'reasoning', 'maxTokens'], pathItem);
    const purpose = text(item.purpose, `${pathItem}.purpose`);
    if (purpose.length > 240) throw new Error(`${pathItem}.purpose must be at most 240 characters`);
    const reasoning = record(item.reasoning, `${pathItem}.reasoning`);
    keys(reasoning, ['mode', 'effort'], `${pathItem}.reasoning`);
    if (reasoning.mode !== 'model-default' && reasoning.mode !== 'fixed') {
      throw new Error(`${pathItem}.reasoning.mode must be model-default or fixed`);
    }
    const parsedReasoning: ModelCandidate['reasoning'] = { mode: reasoning.mode };
    if (reasoning.mode === 'fixed') parsedReasoning.effort = text(reasoning.effort, `${pathItem}.reasoning.effort`);
    else if (own(reasoning, 'effort')) throw new Error(`${pathItem}.reasoning.effort requires fixed mode`);
    return {
      id: identifier(item.id, `${pathItem}.id`), purpose,
      provider: text(item.provider, `${pathItem}.provider`), model: text(item.model, `${pathItem}.model`),
      reasoning: parsedReasoning, maxTokens: tokens(item.maxTokens, `${pathItem}.maxTokens`, 1),
    };
  });
  if (new Set(parsed.map(item => item.id)).size !== parsed.length) throw new Error(`${path} contains duplicate candidate ids`);
  return parsed;
}

function output(value: unknown, path: string): { maxTokens: number } {
  const item = record(value, path);
  keys(item, ['maxTokens'], path);
  return { maxTokens: tokens(item.maxTokens, `${path}.maxTokens`, 1) };
}

export function validateAgent(value: unknown): AgentDefinition {
  const item = record(value, 'agent');
  if (item.schemaVersion !== 1 && item.schemaVersion !== 2) throw new Error('agent.schemaVersion must be 1 or 2');
  const v2 = item.schemaVersion === 2;
  keys(item, v2 ? [...fields, 'output'] : fields, 'agent');
  const model = record(item.model, 'agent.model');
  keys(model, v2 ? ['mode', 'provider', 'model', 'candidates', 'defaultCandidate'] : ['mode', 'provider', 'model'], 'agent.model');
  if (model.mode !== 'inherit' && model.mode !== 'fixed' && !(v2 && model.mode === 'auto')) {
    throw new Error(`agent.model.mode must be ${v2 ? 'inherit, fixed or auto' : 'inherit or fixed'}`);
  }
  let parsedModel: AgentDefinition['model'];
  if (model.mode === 'auto') {
    if (own(model, 'provider') || own(model, 'model')) throw new Error('agent.model auto mode cannot specify provider or model');
    const parsedCandidates = candidates(model.candidates, 'agent.model.candidates');
    const defaultCandidate = identifier(model.defaultCandidate, 'agent.model.defaultCandidate');
    if (!parsedCandidates.some(item => item.id === defaultCandidate)) throw new Error('agent.model.defaultCandidate must identify a candidate');
    parsedModel = { mode: 'auto', candidates: parsedCandidates, defaultCandidate };
  } else {
    if (own(model, 'candidates') || own(model, 'defaultCandidate')) throw new Error('agent.model candidates and defaultCandidate require auto mode');
    parsedModel = model.mode === 'fixed'
      ? { mode: 'fixed', provider: text(model.provider, 'agent.model.provider'), model: text(model.model, 'agent.model.model') }
      : { mode: 'inherit' };
    if (model.mode === 'inherit' && (own(model, 'provider') || own(model, 'model'))) {
      throw new Error('agent.model inherit mode cannot specify provider or model');
    }
  }
  const reasoning = record(item.reasoning, 'agent.reasoning');
  keys(reasoning, ['mode', 'effort'], 'agent.reasoning');
  if (!['inherit-compatible', 'model-default', 'fixed'].includes(reasoning.mode as string)) {
    throw new Error('agent.reasoning.mode must be inherit-compatible, model-default or fixed');
  }
  const parsedReasoning: AgentDefinition['reasoning'] = { mode: reasoning.mode as AgentDefinition['reasoning']['mode'] };
  if (reasoning.mode === 'fixed') parsedReasoning.effort = text(reasoning.effort, 'agent.reasoning.effort');
  else if (own(reasoning, 'effort')) throw new Error('agent.reasoning.effort requires fixed mode');
  if (model.mode === 'auto' && reasoning.mode !== 'model-default') throw new Error('agent.reasoning must use model-default for auto mode');
  if (model.mode === 'auto' && own(item, 'output')) throw new Error('agent.output cannot be specified for auto mode; candidates own maxTokens');
  const parsedOutput = own(item, 'output') ? output(item.output, 'agent.output') : undefined;
  const context = record(item.context, 'agent.context');
  keys(context, ['targetTokens', 'elasticTokens'], 'agent.context');
  const targetTokens = tokens(context.targetTokens, 'agent.context.targetTokens', 1);
  const elasticTokens = tokens(context.elasticTokens, 'agent.context.elasticTokens', 1);
  if (elasticTokens < targetTokens) throw new Error('agent.context.elasticTokens must be at least targetTokens');
  const capabilities = strings(item.capabilities, 'agent.capabilities');
  for (const capability of capabilities) {
    if (!(CAPABILITIES as readonly string[]).includes(capability)) throw new Error(`agent.capabilities: unknown capability ${capability}`);
  }
  if (typeof item.enabled !== 'boolean') throw new Error('agent.enabled must be a boolean');
  return {
    schemaVersion: item.schemaVersion, id: identifier(item.id, 'agent.id'), title: localized(item.title, 'agent.title'),
    description: localized(item.description, 'agent.description'), instructions: text(item.instructions, 'agent.instructions'),
    capabilities, skills: strings(item.skills, 'agent.skills'), scripts: strings(item.scripts, 'agent.scripts'),
    inputs: strings(item.inputs, 'agent.inputs'), deliverables: strings(item.deliverables, 'agent.deliverables'),
    model: parsedModel, reasoning: parsedReasoning, ...(parsedOutput ? { output: parsedOutput } : {}),
    context: { targetTokens, elasticTokens }, enabled: item.enabled,
    ...(own(item, 'extends') ? { extends: identifier(item.extends, 'agent.extends') } : {}),
  };
}

/** Validate partial shapes before inheritance, including values that a later layer might replace. */
export function validateOverride(value: unknown): Record<string, unknown> {
  const item = record(value, 'override');
  if (item.schemaVersion !== 1 && item.schemaVersion !== 2) throw new Error('override.schemaVersion must be 1 or 2');
  const v2 = item.schemaVersion === 2;
  keys(item, [...fields, 'displayName', ...(v2 ? ['output'] : [])], 'override');
  identifier(item.id, 'override.id');
  if (own(item, 'extends')) identifier(item.extends, 'override.extends');
  if (own(item, 'enabled') && typeof item.enabled !== 'boolean') throw new Error('override.enabled must be a boolean');
  if (own(item, 'displayName')) {
    text(item.displayName, 'override.displayName');
    if (own(item, 'title')) throw new Error('override cannot specify both displayName and title');
  }
  for (const field of ['title', 'description']) {
    if (!own(item, field)) continue;
    const part = record(item[field], `override.${field}`);
    keys(part, ['en', 'zh'], `override.${field}`);
    if (!Object.keys(part).length) throw new Error(`override.${field} cannot be empty`);
    for (const [key, value] of Object.entries(part)) text(value, `override.${field}.${key}`);
  }
  if (own(item, 'instructions')) {
    if (typeof item.instructions === 'string') text(item.instructions, 'override.instructions');
    else {
      const part = record(item.instructions, 'override.instructions');
      keys(part, ['append', 'replace'], 'override.instructions');
      if (!Object.keys(part).length) throw new Error('override.instructions requires append or replace');
      for (const [key, value] of Object.entries(part)) text(value, `override.instructions.${key}`);
    }
  }
  for (const field of ['capabilities', 'skills', 'scripts']) {
    if (!own(item, field)) continue;
    const value = item[field];
    const lists: string[][] = [];
    if (Array.isArray(value)) lists.push(strings(value, `override.${field}`));
    else {
      const part = record(value, `override.${field}`);
      keys(part, ['add', 'remove', 'replace'], `override.${field}`);
      if (!Object.keys(part).length) throw new Error(`override.${field} requires add, remove or replace`);
      for (const [key, values] of Object.entries(part)) lists.push(strings(values, `override.${field}.${key}`));
    }
    if (field === 'capabilities') for (const list of lists) for (const capability of list) {
      if (!(CAPABILITIES as readonly string[]).includes(capability)) throw new Error(`override.capabilities: unknown capability ${capability}`);
    }
  }
  for (const field of ['inputs', 'deliverables']) if (own(item, field)) strings(item[field], `override.${field}`);
  for (const field of ['model', 'reasoning', 'context']) {
    if (!own(item, field)) continue;
    const part = record(item[field], `override.${field}`);
    keys(part, field === 'model' ? ['mode', 'provider', 'model', ...(v2 ? ['candidates', 'defaultCandidate'] : [])]
      : field === 'reasoning' ? ['mode', 'effort'] : ['targetTokens', 'elasticTokens'], `override.${field}`);
    if (!Object.keys(part).length) throw new Error(`override.${field} cannot be empty`);
    for (const [key, value] of Object.entries(part)) {
      if (field === 'context') tokens(value, `override.${field}.${key}`, 1);
      else if (field === 'model' && key === 'candidates') candidates(value, 'override.model.candidates');
      else if (field === 'model' && key === 'defaultCandidate') identifier(value, 'override.model.defaultCandidate');
      else text(value, `override.${field}.${key}`);
    }
    if (field === 'model') {
      if (own(part, 'mode') && !['inherit', 'fixed', ...(v2 ? ['auto'] : [])].includes(part.mode as string)) throw new Error('override.model.mode is invalid');
      if (v2) {
        const route = own(part, 'provider') || own(part, 'model');
        const auto = own(part, 'candidates') || own(part, 'defaultCandidate');
        if (route && (part.mode === 'inherit' || part.mode === 'auto')) throw new Error('override.model provider and model require fixed mode');
        if (auto && (route || part.mode === 'inherit' || part.mode === 'fixed')) throw new Error('override.model candidates and defaultCandidate require auto mode');
        if (own(part, 'candidates') && own(part, 'defaultCandidate')
          && !(part.candidates as ModelCandidate[]).some(candidate => candidate.id === part.defaultCandidate)) {
          throw new Error('override.model.defaultCandidate must identify a candidate');
        }
      }
    }
    if (field === 'reasoning') {
      if (own(part, 'mode') && !['inherit-compatible', 'model-default', 'fixed'].includes(part.mode as string)) throw new Error('override.reasoning.mode is invalid');
      if (v2 && own(part, 'mode') && part.mode !== 'fixed' && own(part, 'effort')) throw new Error('override.reasoning.effort requires fixed mode');
    }
  }
  if (own(item, 'output') && item.output !== null) output(item.output, 'override.output');
  if (v2 && own(item, 'model') && record(item.model, 'override.model').mode === 'auto') {
    if (own(item, 'reasoning')) {
      const reasoning = record(item.reasoning, 'override.reasoning');
      if (reasoning.mode !== 'model-default' || own(reasoning, 'effort')) throw new Error('override.reasoning must use model-default for auto mode');
    }
    if (own(item, 'output') && item.output !== null) throw new Error('override.output cannot be specified for auto mode; candidates own maxTokens');
  }
  return item;
}

export function parseOverrideText(input: string): Record<string, unknown> {
  if (typeof input !== 'string') throw new Error('override text must be a string');
  if (Buffer.byteLength(input, 'utf8') > 1_048_576) throw new Error('override exceeds the 1 MiB limit');
  const documents = parseAllDocuments(input, {
    version: '1.2', schema: 'core', strict: true, uniqueKeys: true,
    stringKeys: true, merge: false, resolveKnownTags: false, logLevel: 'silent',
  });
  if (documents.length !== 1) throw new Error('Override YAML must contain exactly one document');
  const document = documents[0];
  const problems = [...document.errors, ...document.warnings];
  if (problems.length) throw new Error(`Invalid override YAML: ${problems.map(problem => problem.message).join('; ')}`);
  // No executable tags, custom objects, merge keys or alias expansion are permitted.
  return validateOverride(document.toJS({ maxAliasCount: 0 }));
}
