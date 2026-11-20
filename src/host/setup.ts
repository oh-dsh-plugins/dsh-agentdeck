import { parseDocument } from 'yaml';
import { parseOverrideText } from '../core/index.js';
import type { AgentDefinition } from '../core/index.js';
import { object, type JsonObject } from './types.js';

/** Model changes retain inheritance impact preview, without retired resource fields. */
export const setupResources = (role: AgentDefinition) => ({ model: role.model, reasoning: role.reasoning });

export function applyDefinitionActions(baseText: string | undefined, role: Pick<AgentDefinition, 'schemaVersion' | 'id'>, actions: JsonObject[]): string {
  if (!Array.isArray(actions) || actions.length > 64) throw new Error('Definition edit actions must be an array of at most 64 items.');
  if (baseText !== undefined) parseOverrideText(baseText);
  const doc = parseDocument(baseText ?? JSON.stringify({ schemaVersion: 3, id: role.id }));
  // Upgrade only the edited definition; preserve unrelated authored fields and comments.
  doc.set('schemaVersion', 3);
  doc.delete('output');
  doc.delete('context');
  const current = doc.toJS();
  if (current.id !== role.id) throw new Error('Definition edit id must match the edited role.');
  if (Array.isArray(current?.model?.candidates)) current.model.candidates.forEach((_: unknown, index: number) => doc.deleteIn(['model', 'candidates', index, 'maxTokens']));
  for (const value of actions) {
    const action = object(value, 'definition action');
    const path = action.path;
    if (!Array.isArray(path) || path.length !== 1 || !['schemaVersion', 'enabled', 'model', 'reasoning'].includes(path[0])) throw new Error('Unsupported definition edit path.');
    if (action.op === 'set') {
      if (!Object.hasOwn(action, 'value')) throw new Error('Definition set actions require a value.');
      doc.setIn(path, action.value);
    } else if (action.op === 'delete') doc.deleteIn(path);
    else throw new Error('Unknown definition edit action.');
  }
  const text = doc.toString();
  parseOverrideText(text);
  return text;
}
