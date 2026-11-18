import { createHash } from 'node:crypto';
import type { HostContext, RunRecord } from './types.js';

export class ResultRevisionError extends Error {
  constructor() { super('Result revision is missing or changed. Reload the first page.'); }
}

function text(content: any): string { return Array.isArray(content) ? content.filter(block => block?.type === 'text').map(block => block.text).join('\n') : ''; }
function items(value: unknown): unknown[] { return value === undefined || value === null ? [] : Array.isArray(value) ? value : [value]; }

/** A current native turn owns its report; an older successful turn is history. */
export async function readRunResult(ctx: HostContext, run: RunRecord, offset = 0, limit = 12_000, expectedRevision?: unknown): Promise<Record<string, any>> {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1) throw new Error('Result offset/limit must be non-negative/positive integers.');
  if (offset > 0 && (typeof expectedRevision !== 'string' || !expectedRevision || !run.childId)) throw new ResultRevisionError();
  if (!run.childId) return { childId: null, status: run.phase, summary: run.error ?? 'Task has not published a child.', rawText: '', totalCharacters: 0 };
  const snapshot = await ctx.sessionQuery.readSession(run.childId);
  let rawText = '';
  let nativeStop: any;
  let turnIdentity: [number, number] | undefined;
  const usage: Record<'inputTokens' | 'outputTokens' | 'cacheReadTokens' | 'cacheWriteTokens' | 'reasoningTokens', number | null> = { inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null, reasoningTokens: null };
  for (const event of snapshot.events) {
    if (event.type === 'turn/start') {
      rawText = '';
      nativeStop = undefined;
      turnIdentity = [event.seq, event.data.turn];
    }
    if (event.type === 'assistant/message') {
      const value = text(event.data.message?.content);
      if (value) rawText = value;
      if (event.data.usage) for (const key of Object.keys(usage) as (keyof typeof usage)[]) {
        const value = event.data.usage[key];
        if (typeof value === 'number' && Number.isFinite(value)) usage[key] = (usage[key] ?? 0) + value;
      }
    }
    if (event.type === 'turn/end') nativeStop = event.data.reason;
  }
  const candidate = rawText.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let report: any;
  try { report = JSON.parse(candidate); } catch { /* Plain final answers remain available. */ }
  const validStatus = ['completed', 'partial', 'failed', 'cancelled'].includes(report?.status);
  const live = ctx.agents.get(run.childId as any);
  const terminalStatus = nativeStop?.kind;
  const status = terminalStatus && terminalStatus !== 'completed'
    ? (['aborted', 'interrupted'].includes(terminalStatus) ? 'cancelled' : terminalStatus === 'max-tokens' ? 'partial' : 'failed')
    : !nativeStop ? (turnIdentity || live?.status === 'running' ? 'running' : 'pending')
    : validStatus ? report.status : 'finished-unverified';
  // Report metadata is derived from rawText. Usage counters do not change the report.
  const resultRevision = createHash('sha256').update(JSON.stringify([run.childId, turnIdentity, rawText, status, nativeStop])).digest('hex');
  if (offset > 0 && expectedRevision !== resultRevision) throw new ResultRevisionError();
  const start = Math.floor(offset);
  const size = Math.min(50_000, Math.floor(limit));
  const end = Math.min(rawText.length, start + size);
  return {
    childId: run.childId, status, summary: typeof report?.summary === 'string' ? report.summary : rawText.slice(0, 2000),
    evidence: items(report?.evidence), coverage: report?.coverage ?? null,
    artifacts: items(report?.artifacts),
    limitations: report?.limitations === undefined ? validStatus ? [] : ['Final answer is not a validated AgentDeck completion report. Inspect the evidence before accepting completion.'] : items(report.limitations),
    resultRevision, rawText: rawText.slice(start, end), totalCharacters: rawText.length,
    ...(end < rawText.length ? { nextOffset: end } : {}), usage: Object.values(usage).some(value => value !== null) ? usage : null, nativeStop: nativeStop ?? null,
  };
}
