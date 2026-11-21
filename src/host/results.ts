import { createHash } from 'node:crypto';
import type { RunRecord } from './types.js';
import { record, type ResultQueries } from './contracts.js';

export class ResultRevisionError extends Error {
  constructor() { super('Result revision is missing or changed. Reload the first page.'); }
}

function text(content: unknown): string { return Array.isArray(content) ? content.filter(block => record(block) && block.type === 'text' && typeof block.text === 'string').map(block => block.text).join('\n') : ''; }
function items(value: unknown): unknown[] { return value === undefined || value === null ? [] : Array.isArray(value) ? value : [value]; }

/** Current-turn evidence owns its result; unsupported terminal states stay unverified. */
export async function readRunResult(queries: ResultQueries, run: RunRecord, offset = 0, limit = 12_000, expectedRevision?: unknown, signal?: AbortSignal): Promise<Record<string, unknown>> {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1) throw new Error('Result offset/limit must be non-negative/positive integers.');
  if (offset > 0 && (typeof expectedRevision !== 'string' || !expectedRevision || !run.childId)) throw new ResultRevisionError();
  if (!run.childId) return { childId: null, status: run.phase, summary: run.error ?? 'Task has not published a child.', rawText: '', totalCharacters: 0 };
  const events = await queries.events(run.childId, signal);
  let rawText = '';
  let nativeStop: unknown;
  let ended = false;
  let turnIdentity: [number | undefined, unknown] | undefined;
  const usage: Record<'inputTokens' | 'outputTokens' | 'cacheReadTokens' | 'cacheWriteTokens' | 'reasoningTokens', number | null> = { inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null, reasoningTokens: null };
  for (const event of events) {
    if (event.type === 'turn/start') { rawText = ''; nativeStop = undefined; ended = false; turnIdentity = [event.seq, event.data.turn]; }
    if (event.type === 'assistant/message') {
      const value = text(record(event.data.message) ? event.data.message.content : undefined);
      rawText = value;
      if (record(event.data.usage)) for (const key of Object.keys(usage) as (keyof typeof usage)[]) {
        const value = event.data.usage[key];
        if (typeof value === 'number' && Number.isFinite(value)) usage[key] = (usage[key] ?? 0) + value;
      }
    }
    if (event.type === 'turn/end') { nativeStop = event.data.reason; ended = true; }
  }
  const candidate = rawText.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let report: Record<string, unknown> | undefined;
  try { const value: unknown = JSON.parse(candidate); if (record(value)) report = value; } catch { /* Plain final answers remain available. */ }
  const validStatus = typeof report?.status === 'string' && ['completed', 'partial', 'failed', 'cancelled'].includes(report.status);
  const terminal = record(nativeStop) ? nativeStop.kind : undefined;
  const known = terminal === 'completed' || terminal === 'error' || terminal === 'aborted' || terminal === 'interrupted' || terminal === 'max-tokens';
  const unknown = ended && !known;
  const status = !ended ? (turnIdentity || queries.status(run.childId) === 'running' ? 'running' : 'pending')
    : terminal === 'aborted' || terminal === 'interrupted' ? 'cancelled' : terminal === 'max-tokens' ? 'partial'
    : terminal === 'error' ? 'failed' : unknown || !validStatus ? 'finished-unverified' : report!.status;
  const diagnostics = unknown ? ['Native terminal outcome is unsupported; inspect nativeStop and evidence before accepting completion.'] : [];
  // Usage counters do not change report pagination identity.
  const resultRevision = createHash('sha256').update(JSON.stringify([run.childId, turnIdentity, rawText, status, nativeStop])).digest('hex');
  if (offset > 0 && expectedRevision !== resultRevision) throw new ResultRevisionError();
  const start = Math.floor(offset);
  const end = Math.min(rawText.length, start + Math.min(50_000, Math.floor(limit)));
  // Keep the structured preview bounded independently of the raw-text cursor.
  // The complete report (including oversized fields) remains available in rawText pages.
  const preview = { evidence: items(report?.evidence), coverage: report?.coverage ?? null,
    artifacts: items(report?.artifacts), limitations: items(report?.limitations) };
  const budget = Math.min(4000, Math.max(256, limit));
  const details = { evidence: [] as unknown[], coverage: null as unknown, artifacts: [] as unknown[], limitations: [] as unknown[] };
  let remaining = budget;
  const omitted: string[] = [];
  for (const key of ['limitations', 'coverage', 'artifacts', 'evidence'] as const) {
    const size = JSON.stringify(preview[key]).length;
    if (size <= remaining) {
      Object.assign(details, { [key]: preview[key] });
      remaining -= size;
    } else omitted.push(key);
  }
  if (omitted.length) details.limitations.push(`Large fields in the paged raw text: ${omitted.join(', ')}.`);
  if (!validStatus && report?.limitations === undefined) details.limitations.push('Final answer is not a validated AgentDeck completion report. Inspect the evidence before accepting completion.');
  let stop = nativeStop ?? null;
  if (record(nativeStop) && JSON.stringify(nativeStop).length > budget) {
    const cause = record(nativeStop.error) ? nativeStop.error : nativeStop;
    const message = cause.message ?? nativeStop.message ?? nativeStop.error;
    stop = { kind: typeof terminal === 'string' ? terminal.slice(0, 100) : 'unknown', truncated: true,
      code: typeof cause.code === 'string' ? cause.code.slice(0, 100) : typeof cause.code === 'number' ? cause.code : undefined,
      message: (typeof message === 'string' ? message : JSON.stringify(nativeStop)).slice(0, budget),
      source: { sessionId: run.childId, event: 'turn/end', turn: turnIdentity?.[1] } };
  } else if (typeof stop === 'string') stop = stop.slice(0, budget);
  return {
    childId: run.childId, status, summary: (typeof report?.summary === 'string' ? report.summary : rawText).slice(0, Math.min(2000, budget)),
    ...details, limitations: [...details.limitations, ...diagnostics],
    diagnostics, resultRevision, rawText: rawText.slice(start, end), totalCharacters: rawText.length,
    ...(end < rawText.length ? { nextOffset: end } : {}), usage: Object.values(usage).some(value => value !== null) ? usage : null, nativeStop: stop,
  };
}
