import { createHash } from 'node:crypto';
import { defineDomain } from '@deepseek-ai/dsh-storage-domain';
import { z } from 'zod';
import type { HostContext, OverrideRecord, RoleSnapshot, RunRecord } from './types.js';

const overrideSchema = z.object({ id: z.string(), text: z.string(), revision: z.string(), updatedAt: z.number() });
const snapshotBase = z.object({ id: z.string(), presetId: z.string(), role: z.record(z.string(), z.unknown()), skills: z.array(z.unknown()), model: z.record(z.string(), z.unknown()), createdAt: z.number(), scriptRevisions: z.record(z.string(), z.string()).optional(), composition: z.literal('native-minimal').optional(), webTools: z.boolean().optional(), sourceRevision: z.string().optional(), candidateId: z.string().optional() });
const snapshotSchema = z.discriminatedUnion('policyVersion', [
  snapshotBase.extend({ policyVersion: z.literal(1), budget: z.record(z.string(), z.unknown()) }),
  snapshotBase.extend({ policyVersion: z.literal(2) }),
]);
const runSchema = z.object({ id: z.string(), roleId: z.string(), revision: z.string(), parentId: z.string(), childId: z.string().optional(), description: z.string(), createdAt: z.number(), phase: z.enum(['starting', 'accepted', 'uncertain', 'failed']), error: z.string().optional(), model: z.record(z.string(), z.unknown()).optional(), fallback: z.object({ to: z.enum(['general', 'native']), reason: z.string() }).optional(), decision: z.object({ candidateId: z.string(), roleRevision: z.string(), source: z.enum(['default', 'recommended', 'legacy-route']), reason: z.string().optional() }).optional() });

// Domain validates the public parse contract; the host and plugin may use different Zod minor typings.
export const storeSpec = defineDomain({
  name: 'dsh_agentdeck', version: 1, layout: 'per-record',
  tables: { overrides: { valueSchema: overrideSchema }, snapshots: { valueSchema: snapshotSchema }, runs: { valueSchema: runSchema } },
} as any);

export function textRevision(text: string): string { return createHash('sha256').update(text).digest('hex'); }

export class WriteOutcomeUnknownError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'WriteOutcomeUnknownError';
  }
}

/** Owns plugin data, never the active profile's composition. */
export class AgentDeckStore {
  private serial = Promise.resolve();
  private constructor(private readonly domain: any) {}
  static async open(ctx: HostContext): Promise<AgentDeckStore> {
    const facility = ctx.get('storageDomain');
    if (!facility) throw new Error('AgentDeck requires the native storageDomain service for durable configuration and resume snapshots.');
    const domain = await (facility as any).open(storeSpec);
    return new AgentDeckStore(domain);
  }
  private table(name: 'overrides' | 'snapshots' | 'runs'): any { return this.domain.table(name); }
  overrides(): OverrideRecord[] { return [...this.table('overrides').entries()].map(([, value]: any) => value).sort((a, b) => a.id.localeCompare(b.id)); }
  snapshots(): RoleSnapshot[] { return [...this.table('snapshots').entries()].map(([, value]: any) => value); }
  runs(): RunRecord[] { return [...this.table('runs').entries()].map(([, value]: any) => value).sort((a, b) => b.createdAt - a.createdAt); }
  getRun(id: string): RunRecord | undefined { return this.table('runs').get(id); }
  getOverride(id: string): OverrideRecord | undefined { return this.table('overrides').get(id); }
  async snapshot(value: RoleSnapshot): Promise<void> {
    if (!this.table('snapshots').get(value.id)) await this.table('snapshots').put(value.id, value);
  }
  async run(value: RunRecord): Promise<void> {
    await this.mutate(async () => {
      const current = this.getRun(value.id);
      if (current?.childId && !value.childId) return;
      if (current?.childId && value.childId !== current.childId) throw new Error('A startup receipt cannot change its accepted child identity.');
      await this.table('runs').put(value.id, value);
    });
  }
  async save(id: string, text: string, expectedRevision?: string, validate?: () => Promise<void>): Promise<OverrideRecord> {
    return this.mutate(async () => {
      const current = this.getOverride(id);
      if (current && current.revision !== expectedRevision) throw new Error('Agent configuration changed. Reload it before saving; your draft has not been applied.');
      if (!current && expectedRevision) throw new Error('Agent override no longer exists. Reload before saving.');
      await validate?.();
      const value = { id, text, revision: textRevision(text), updatedAt: Date.now() };
      try {
        await this.table('overrides').put(id, value);
      } catch (error) {
        throw new WriteOutcomeUnknownError(error instanceof Error ? error.message : String(error), error);
      }
      return value;
    });
  }
  /** Serial with ordinary saves/resets; storage writes remain independent, not atomic. */
  async saveBatch(rows: { id: string; text: string; expectedRevision?: string }[], validate: (index: number) => Promise<void>) {
    return this.mutate(async () => {
      const results: { id: string; status: 'applied' | 'failed' | 'uncertain' | 'not-run'; revision?: string; message?: string }[] = [];
      let stopped = false;
      for (const [index, row] of rows.entries()) {
        if (stopped) { results.push({ id: row.id, status: 'not-run' }); continue; }
        let writing = false;
        try {
          const current = this.getOverride(row.id);
          if (current?.revision !== row.expectedRevision) throw new Error('Agent configuration changed. Reload it before saving; your draft has not been applied.');
          await validate(index);
          const value = { id: row.id, text: row.text, revision: textRevision(row.text), updatedAt: Date.now() };
          writing = true;
          await this.table('overrides').put(row.id, value);
          if (this.getOverride(row.id)?.text !== row.text) throw new Error('Saved configuration could not be confirmed. Refresh before another apply.');
          results.push({ id: row.id, status: 'applied', revision: value.revision });
        } catch (error) {
          results.push({ id: row.id, status: writing ? 'uncertain' : 'failed', message: error instanceof Error ? error.message : String(error) });
          stopped = true;
        }
      }
      return { status: stopped ? 'stopped' : 'completed', rows: results };
    });
  }
  async reset(id: string, expectedRevision: string, validate?: () => Promise<void>): Promise<void> {
    await this.mutate(async () => {
      const current = this.getOverride(id);
      if (!current || current.revision !== expectedRevision) throw new Error('Agent configuration changed. Reload before resetting.');
      await validate?.();
      try {
        await this.table('overrides').delete(id);
      } catch (error) {
        throw new WriteOutcomeUnknownError(error instanceof Error ? error.message : String(error), error);
      }
    });
  }
  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.serial.then(operation);
    this.serial = next.then(() => undefined, () => undefined);
    return next;
  }
  async close(): Promise<void> { await this.serial; await this.domain.close(); }
}
