import { createHash } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';
import { SessionId } from '@deepseek-ai/dsh-session';
import { hostCompatibility, WorkspaceCompatibilityError } from './compatibility.js';
import type { AgentDeckStore } from './store.js';
import type { HostContext, RoleSnapshot, RunRecord, RuntimeAgent, WorkspaceCut } from './types.js';

const domain = 'dsh_agentdeck';
const sameDirectory = (left: string, right: string) => isAbsolute(left) && isAbsolute(right) && resolve(left) === resolve(right);

function unavailable(detail: string): never {
  throw new WorkspaceCompatibilityError('AGENTDECK_WORKSPACE_UNVERIFIED', detail);
}

function directoryHistory(events: readonly { type: string; seq: number; data: unknown }[]): string {
  const transitions = events.filter(event => event.type === 'working-directory/change');
  return createHash('sha256').update(JSON.stringify(transitions.map(event => [event.seq, event.data]))).digest('hex');
}

function matches(header: { id: string; parentSession?: string; agentPreset?: string; origin?: string }, run: RunRecord, snapshot: RoleSnapshot): boolean {
  return header.origin === 'subagent' && header.id === run.childId && header.parentSession === run.parentId && header.agentPreset === snapshot.presetId;
}

/** Record the effective RC directory from a cold native observation; never restore the child to read it. */
export async function captureWorkspaceCuts(ctx: HostContext, store: AgentDeckStore, signal: AbortSignal) {
  const { version, family } = hostCompatibility();
  if (family !== 'session-policy') unavailable('Capture legacy workspaces before upgrading DSH.');
  const query = ctx.get('sessionQuery');
  const directories = ctx.get('workingDirectory');
  if (!query || !directories) unavailable('Native workspace observation is unavailable.');
  const snapshots = new Map(store.snapshots().map(snapshot => [snapshot.id, snapshot]));
  const captured: string[] = [];
  const pending: { runId: string; reason: string }[] = [];
  for (const run of store.runs()) {
    signal.throwIfAborted();
    if (run.phase === 'failed') continue;
    const snapshot = snapshots.get(run.revision);
    if (!run.childId || run.phase !== 'accepted' || !snapshot) {
      pending.push({ runId: run.id, reason: 'Native child or immutable snapshot identity is unresolved.' });
      continue;
    }
    if (snapshot.expectedWorkspace !== undefined) continue;
    try {
      if (ctx.agents.get(SessionId(run.parentId))) unavailable('Restart DSH on the same RC version, leave this parent Session unopened, then record workspaces again.');
      using observation = await query.observeSession(SessionId(run.childId), { signal });
      if (observation.source !== 'prepared' || !matches(observation.header, run, snapshot)) {
        unavailable('Expected a cold child with its recorded native parent and preset.');
      }
      const projected: unknown = observation.projections?.values.workingDirectory;
      const cwd = projected === null ? directories.defaultDirectory : projected;
      if (typeof cwd !== 'string' || !isAbsolute(cwd)) unavailable('The native RC projection has no effective absolute directory.');
      const cut: WorkspaceCut = { sourceVersion: version, childId: run.childId, parentId: run.parentId,
        presetId: snapshot.presetId, snapshotId: snapshot.id, createdAt: observation.header.createdAt,
        cwd, cursor: observation.cursor, directoryHistory: directoryHistory(observation.events) };
      signal.throwIfAborted();
      await store.run({ ...run, workspaceCut: cut });
      captured.push(run.childId);
    } catch (error) {
      signal.throwIfAborted();
      pending.push({ runId: run.id, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return { sourceVersion: version, captured, pending };
}

/** Same guard for AgentDeck control and native cold materialization. */
export async function migratedWorkspace(ctx: HostContext, run: RunRecord | undefined, snapshot: RoleSnapshot,
  childId: string, signal: AbortSignal): Promise<string> {
  const cut = run?.workspaceCut;
  if (!cut || !run || cut.childId !== childId || cut.parentId !== run.parentId || cut.snapshotId !== snapshot.id ||
    cut.presetId !== snapshot.presetId || !isAbsolute(cut.cwd) || hostCompatibility(cut.sourceVersion).family !== 'session-policy') {
    unavailable('This legacy task has no verified RC workspace receipt. Use the isolated pre-upgrade RC profile to recover it.');
  }
  const query = ctx.get('sessionQuery');
  if (!query) unavailable('Native Session observation is unavailable.');
  using observation = await query.observeSession(SessionId(childId), { signal });
  if (!matches(observation.header, run, snapshot) || observation.header.createdAt !== cut.createdAt ||
    observation.cursor < cut.cursor || directoryHistory(observation.events) !== cut.directoryHistory) {
    unavailable('This task no longer matches the recorded RC workspace receipt. Use the isolated pre-upgrade RC profile to recover it.');
  }
  return cut.cwd;
}

export async function roleWorkspace(ctx: HostContext, agent: RuntimeAgent, snapshot: RoleSnapshot, signal: AbortSignal): Promise<string | undefined> {
  if (hostCompatibility().family === 'session-policy') return undefined;
  if (snapshot.expectedWorkspace !== undefined) return snapshot.expectedWorkspace;
  const saved = ctx.get('storageDomain')?.get(domain);
  const run = saved && (Array.from(saved.table('runs').entries(), ([, value]) => value) as RunRecord[])
    .find(value => value.childId === agent.id && value.revision === snapshot.id);
  return migratedWorkspace(ctx, run, snapshot, agent.id, signal);
}

export function checkWorkspace(expected: string, actual: string): void {
  if (!sameDirectory(expected, actual)) {
    throw new WorkspaceCompatibilityError('AGENTDECK_WORKSPACE_MISMATCH',
      `Task workspace ${actual} differs from ${expected}. The task is paused. For legacy tasks, continue from the isolated pre-upgrade RC profile.`);
  }
}

export async function verifyWorkspaceDirectory(ctx: HostContext, expected: string, signal: AbortSignal): Promise<void> {
  const fs = ctx.get('fs');
  if (!fs) unavailable('Native filesystem service is unavailable.');
  const target = await fs.resolve(expected, { signal });
  if ((await fs.stat(target, signal))?.type !== 'directory') unavailable(`Task workspace ${expected} is unavailable. Restore it before continuing this task.`);
}

export function checkProjectedWorkspace(ctx: HostContext, expected: string, projection: unknown): void {
  const cwd = projection === null ? ctx.workingDirectory.defaultDirectory : projection;
  if (typeof cwd !== 'string' || !isAbsolute(cwd)) unavailable('The native Session projection has no effective absolute directory.');
  checkWorkspace(expected, cwd);
}

type WorkspaceAccess = { agent: RuntimeAgent; path: string | null; signal: AbortSignal };
type WorkspaceListener = (request: WorkspaceAccess, next: () => Promise<string>) => Promise<string>;

/** The Alpha native directory access waterfall runs under the service's per-Session serialization. */
export function fenceWorkspace(ctx: HostContext, agent: RuntimeAgent, expected: string) {
  const directories = ctx.get('workingDirectory');
  const fs = ctx.get('fs');
  if (!directories || !fs) unavailable('Native workspace services are unavailable.');
  // This public hook is declared by Alpha's workingDirectory SDK; baseline RC types omit it.
  const on = ctx.on as unknown as (name: 'working-directory/access', listener: WorkspaceListener) => () => void;
  // Register after the host's directory coordinators. This listener owns validation
  // only for an exact child whose native recovery could change its pinned root.
  return on.call(ctx, 'working-directory/access', async (request, next) => {
    if (request.agent !== agent) return next();
    const current = directories.get(agent.session);
    checkWorkspace(expected, current);
    if (request.path !== null) checkWorkspace(expected, resolve(current, request.path));
    await verifyWorkspaceDirectory(ctx, expected, request.signal);
    request.signal.throwIfAborted();
    agent.ctx.fiber.assertActive();
    const original = agent.session.header.cwd ?? directories.defaultDirectory;
    if (request.path === null && !sameDirectory(current, original)) {
      // The native terminal would stat again and could commit the original root
      // before returning. Reuse our validation under the same native serialization.
      return current;
    }
    const cwd = await next();
    checkWorkspace(expected, cwd);
    return cwd;
  });
}
