import type { HostContext, RunRecord } from './types.js';

function text(content: any): string { return Array.isArray(content) ? content.filter(block => block?.type === 'text').map(block => block.text).join('\n') : ''; }
function items(value: unknown): unknown[] { return value === undefined || value === null ? [] : Array.isArray(value) ? value : [value]; }

/** A current native turn owns its report; an older successful turn is history. */
export async function readRunResult(ctx: HostContext, run: RunRecord, offset = 0, limit = 12_000): Promise<Record<string, any>> {
  if (!run.childId) return { childId: null, status: run.phase, summary: run.error ?? 'Task has not published a child.', rawText: '', totalCharacters: 0 };
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1) throw new Error('Result offset/limit must be non-negative/positive integers.');
  const snapshot = await ctx.sessionQuery.readSession(run.childId);
  let rawText = '';
  let nativeStop: any;
  let turnStarted = false;
  const usage: Record<'inputTokens' | 'outputTokens' | 'cacheReadTokens' | 'cacheWriteTokens' | 'reasoningTokens', number | null> = { inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null, reasoningTokens: null };
  for (const event of snapshot.events) {
    if (event.type === 'turn/start') { rawText = ''; nativeStop = undefined; turnStarted = true; }
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
    : !nativeStop ? (turnStarted || live?.status === 'running' ? 'running' : 'pending')
    : validStatus ? report.status : 'finished-unverified';
  const start = Math.floor(offset);
  const size = Math.min(50_000, Math.floor(limit));
  const end = Math.min(rawText.length, start + size);
  return {
    childId: run.childId, status, summary: typeof report?.summary === 'string' ? report.summary : rawText.slice(0, 2000),
    evidence: items(report?.evidence), coverage: report?.coverage ?? null,
    artifacts: items(report?.artifacts),
    limitations: report?.limitations === undefined ? validStatus ? [] : ['Final answer is not a validated AgentDeck completion report. Inspect the evidence before accepting completion.'] : items(report.limitations),
    rawText: rawText.slice(start, end), totalCharacters: rawText.length,
    ...(end < rawText.length ? { nextOffset: end } : {}), usage: Object.values(usage).some(value => value !== null) ? usage : null, nativeStop: nativeStop ?? null,
  };
}
