import type { ContextBudget, ContextBudgetInput } from './types.js';
import { tokens } from './validation.js';

/** Targets include all input. Elastic is the total ceiling, never an added allowance. */
export function resolveContextBudget(input: ContextBudgetInput): ContextBudget {
  const target = tokens(input.targetTokens, 'targetTokens', 1);
  const elastic = tokens(input.elasticTokens, 'elasticTokens', 1);
  if (elastic < target) throw new Error('elasticTokens must be at least targetTokens');
  const fixed = input.fixedTokens === undefined ? 0 : tokens(input.fixedTokens, 'fixedTokens');
  const window = input.windowTokens === undefined ? undefined : tokens(input.windowTokens, 'windowTokens', 1);
  const output = input.outputTokens === undefined ? undefined : tokens(input.outputTokens, 'outputTokens');
  const diagnostics: string[] = [];
  // Reserve five percent for tokenizer/accounting differences, at least 1K where possible.
  const headroomTokens = window === undefined ? 0 : Math.min(window, Math.max(1024, Math.ceil(window * 0.05)));
  if (window === undefined) diagnostics.push('Model context window is unknown; configured targets are requests, not confirmed safe capacity.');
  if (output === undefined) diagnostics.push('Output token reservation is unknown; safe input capacity cannot be confirmed.');
  if (window === undefined || output === undefined) {
    return { known: false, targetTokens: target, elasticTokens: elastic, headroomTokens, diagnostics };
  }
  const safeInputTokens = Math.max(0, window - output - headroomTokens);
  const materialTokens = Math.max(0, safeInputTokens - fixed);
  if (output + headroomTokens >= window) diagnostics.push('Output reservation and headroom exhaust the context window.');
  if (fixed > safeInputTokens) diagnostics.push('Fixed context exceeds safe input capacity; reduce instructions, skills, tools or history before loading material.');
  if (target > safeInputTokens || elastic > safeInputTokens) diagnostics.push('Configured context targets were clamped to safe input capacity.');
  return {
    known: true, targetTokens: Math.min(target, safeInputTokens), elasticTokens: Math.min(elastic, safeInputTokens),
    safeInputTokens, headroomTokens, materialTokens, diagnostics,
  };
}
