import { createHash } from 'node:crypto';
import type { AgentDefinition } from './types.js';
import { validateAgent } from './validation.js';

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const item = value as Record<string, unknown>;
    return `{${Object.keys(item).sort().map(key => `${JSON.stringify(key)}:${canonical(item[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Hash normalized complete content; object insertion order never changes a revision. */
export function agentRevision(agent: AgentDefinition): string {
  return createHash('sha256').update(canonical(validateAgent(agent)), 'utf8').digest('hex');
}
