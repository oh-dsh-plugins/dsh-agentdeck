import { parseDocument } from 'yaml';
import { loadBuiltinAgents } from './builtins.js';
import { identifier, parseOverrideText, record, validateAgent } from './validation.js';
import type { AgentDefinition, AgentDiagnostic, CatalogResult } from './types.js';

interface Layer {
  id: string;
  source?: string;
  builtin?: AgentDefinition;
  patch?: Record<string, unknown>;
  previous?: Layer;
  failure?: string;
}
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

function mergeList(base: unknown, patch: unknown): string[] {
  if (Array.isArray(patch)) return [...patch];
  const operation = record(patch, 'list operation');
  const initial = (operation.replace ?? base ?? []) as string[];
  const removed = new Set((operation.remove ?? []) as string[]);
  const result = initial.filter(value => !removed.has(value));
  for (const value of (operation.add ?? []) as string[]) if (!result.includes(value)) result.push(value);
  return result;
}

function apply(base: AgentDefinition | undefined, patch: Record<string, unknown>): AgentDefinition {
  const result: Record<string, unknown> = base ? structuredClone(base) as unknown as Record<string, unknown> : {};
  const model = patch.model === undefined ? undefined : record(patch.model, 'model');
  if (model?.mode === 'auto' && base?.model.mode !== 'auto') {
    // Candidate settings replace inherited role-wide reasoning and output only on a transition.
    // Explicit caller settings still pass through below and are checked instead of discarded.
    delete result.output;
    result.reasoning = { mode: 'model-default' };
  }
  for (const [field, value] of Object.entries(patch)) {
    if (field === 'displayName') {
      result.title = { en: value, zh: value };
    } else if (field === 'instructions' && typeof value !== 'string') {
      const operation = record(value, 'instructions operation');
      const first = operation.replace ?? result.instructions;
      // Appending without a base must not accidentally create a complete new definition.
      if (typeof first !== 'string') throw new Error('instructions.append requires inherited instructions or replace');
      result.instructions = operation.append ? `${first}\n\n${operation.append}` : first;
    } else if (field === 'output' && value === null) {
      delete result.output;
    } else if (['capabilities', 'skills', 'scripts'].includes(field)) {
      result[field] = mergeList(result[field], value);
    } else if (['title', 'description', 'context', 'model', 'reasoning'].includes(field)) {
      const part = record(value, field);
      const current = result[field] as Record<string, unknown> | undefined;
      // A mode transition starts a fresh pair; incompatible inherited provider/effort must not leak.
      const reset = (field === 'model' || field === 'reasoning') && part.mode !== undefined && current?.mode !== part.mode;
      result[field] = { ...(reset ? {} : current), ...part };
    } else result[field] = value;
  }
  return validateAgent(result);
}

/** Recover only a valid scalar id for attribution; never use unvalidated content as a definition. */
function recoverId(text: string): string | undefined {
  // Keep attribution bounded even when the definition exceeds the size limit. Only complete
  // prefix lines may identify a role; never interpret a cut-off identifier as another role.
  let bounded = text;
  if (Buffer.byteLength(text, 'utf8') > 1_048_576) {
    const prefix = text.slice(0, 65536);
    bounded = prefix.slice(0, prefix.lastIndexOf('\n') + 1);
  }
  try {
    const document = parseDocument(bounded, { schema: 'core', strict: true, merge: false, resolveKnownTags: false, logLevel: 'silent' });
    return identifier(document.get('id'), 'override.id');
  } catch { return undefined; }
}

export function resolveCatalog(overrides: readonly { source: string; text: string; failure?: string }[] = []): CatalogResult {
  const diagnostics: AgentDiagnostic[] = [];
  const latest = new Map<string, Layer>();
  for (const builtin of loadBuiltinAgents()) latest.set(builtin.id, { id: builtin.id, builtin });
  for (const override of overrides) {
    let patch: Record<string, unknown>;
    try {
      if (typeof override.source !== 'string' || !override.source.trim()) throw new Error('override.source must be a nonempty string');
      if (override.failure) throw new Error(override.failure);
      patch = parseOverrideText(override.text);
    } catch (error) {
      const id = typeof override.text === 'string' ? recoverId(override.text) : undefined;
      const failure = message(error);
      diagnostics.push({ ...(id ? { id } : {}), source: override.source, message: failure });
      // A recognized broken role is a tombstone, not an implicit fallback to its factory definition.
      if (id) latest.set(id, { id, source: override.source, failure });
      continue;
    }
    const id = patch.id as string;
    latest.set(id, { id, source: override.source, patch, previous: latest.get(id) });
  }

  const cache = new Map<Layer, AgentDefinition>();
  const failures = new Map<Layer, string>();
  const active: Layer[] = [];
  const resolve = (layer: Layer): AgentDefinition => {
    const cached = cache.get(layer);
    if (cached) return cached;
    if (failures.has(layer)) throw new Error(failures.get(layer));
    const cycle = active.indexOf(layer);
    if (cycle >= 0) throw new Error(`Inheritance cycle: ${[...active.slice(cycle).map(item => item.id), layer.id].join(' -> ')}`);
    active.push(layer);
    try {
      if (layer.failure) throw new Error(layer.failure);
      if (layer.builtin) {
        if (layer.builtin.extends) {
          const parent = latest.get(layer.builtin.extends);
          if (!parent) throw new Error(`Missing parent agent: ${layer.builtin.extends}`);
          // Factory variants are complete definitions but still depend on a valid inheritance graph.
          resolve(parent);
        }
        cache.set(layer, layer.builtin);
        return layer.builtin;
      }
      const patch = layer.patch!;
      let base: AgentDefinition | undefined;
      if (typeof patch.extends === 'string') {
        const parent = latest.get(patch.extends);
        if (!parent) throw new Error(`Missing parent agent: ${patch.extends}`);
        base = resolve(parent);
      } else if (layer.previous) base = resolve(layer.previous);
      const resolved = apply(base, patch);
      cache.set(layer, resolved);
      return resolved;
    } catch (error) {
      failures.set(layer, message(error));
      throw error;
    } finally { active.pop(); }
  };

  const agents: AgentDefinition[] = [];
  for (const layer of latest.values()) {
    try { agents.push(structuredClone(resolve(layer))); }
    catch (error) {
      const failure = message(error);
      if (!diagnostics.some(item => item.id === layer.id && item.source === layer.source && item.message === failure)) {
        diagnostics.push({ id: layer.id, ...(layer.source ? { source: layer.source } : {}), message: failure });
      }
    }
  }
  return { agents, diagnostics };
}
