import { getDshRuntimeVersion } from '@deepseek-ai/dsh-app-boot';
import { isAbsolute, resolve } from 'node:path';
import type { HostContext, RuntimeAgent } from './types.js';

export const supportedHosts = {
  '0.2.2-rc.1': 'session-policy',
  '0.2.2-rc.2': 'session-policy',
  '0.2.2-rc.3': 'session-policy',
  '0.2.2-rc.4': 'session-policy',
  '0.2.2-rc.5': 'session-policy',
  '0.2.3-alpha.2': 'live-policy',
} as const;

export type HostFamily = (typeof supportedHosts)[keyof typeof supportedHosts];

export function hostCompatibility(version = getDshRuntimeVersion()): { version: string; family: HostFamily } {
  if (!Object.hasOwn(supportedHosts, version)) {
    throw new Error(`[AGENTDECK_UNSUPPORTED_DSH] DSH ${version} has no verified AgentDeck adapter.`);
  }
  return { version, family: supportedHosts[version as keyof typeof supportedHosts] };
}

export class WorkspaceCompatibilityError extends Error {
  constructor(readonly code: 'AGENTDECK_WORKSPACE_MISMATCH' | 'AGENTDECK_WORKSPACE_UNVERIFIED', message: string) {
    super(`[${code}] ${message}`);
  }
}

export async function delegationWorkspace(ctx: HostContext, family: HostFamily, parent: RuntimeAgent,
  requested: string | undefined, signal: AbortSignal): Promise<{ cwd: string; nativeCwd?: string; expectedWorkspace?: string }> {
  const directories = ctx.get('workingDirectory');
  if (!directories) throw new Error('AgentDeck requires the native workingDirectory service.');
  if (family === 'session-policy') {
    const cwd = requested !== undefined && isAbsolute(requested)
      ? resolve(requested)
      : resolve(await directories.ensure(parent, signal), requested ?? '.');
    return { cwd, nativeCwd: cwd };
  }
  const inherited = await directories.ensure(parent, signal);
  const cwd = await canonicalWorkspace(ctx, inherited, inherited, signal);
  if (requested !== undefined) await requireInheritedWorkspace(ctx, inherited, requested, signal, cwd);
  return { cwd, expectedWorkspace: cwd };
}

async function canonicalWorkspace(ctx: HostContext, path: string, cwd: string, signal?: AbortSignal): Promise<string> {
  const fs = ctx.get('fs');
  if (!fs) throw new WorkspaceCompatibilityError('AGENTDECK_WORKSPACE_UNVERIFIED', 'Native filesystem service is unavailable.');
  return fs.processPath(await fs.resolve(path, { cwd, signal }));
}

export async function requireInheritedWorkspace(ctx: HostContext, cwd: string, requested: string, signal?: AbortSignal,
  inherited?: string): Promise<string> {
  const expected = inherited ?? await canonicalWorkspace(ctx, cwd, cwd, signal);
  if (await canonicalWorkspace(ctx, requested, cwd, signal) !== expected) {
    throw new WorkspaceCompatibilityError('AGENTDECK_WORKSPACE_MISMATCH',
      `This DSH version delegates in the calling Session's workspace (${cwd}). Select a Session in the intended workspace before delegating.`);
  }
  return expected;
}
