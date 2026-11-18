import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { resolveCatalog } from '../core/index.js';
import type { AgentDefinition } from '../core/index.js';
import { messageOf } from './types.js';
import type { HostContext, RuntimeAgent, OverrideRecord } from './types.js';

export type RoleLayer = { source: string; text: string; failure?: string };
type RoleCatalog = ReturnType<typeof catalogFrom>;

async function readLayers(folder: string): Promise<RoleLayer[]> {
  const values: RoleLayer[] = [];
  let names: string[];
  try {
    names = (await readdir(folder)).filter(name => /\.ya?ml$/i.test(name)).sort();
    if (names.length > 100) throw new Error('More than 100 role files; reduce the directory before loading.');
  } catch (error) {
    if ((error as any).code !== 'ENOENT') values.push({ source: folder, text: '', failure: messageOf(error) });
    return values;
  }
  for (const name of names) {
    const path = join(folder, name);
    let handle;
    let prefix = '';
    try {
      const notRegular = 'Role definition must be a regular UTF-8 file.';
      if (!(await stat(path)).isFile()) throw new Error(notRegular);
      // A replacement between stat and open must not make us wait for a FIFO writer.
      handle = await open(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
      const info = await handle.stat();
      if (!info.isFile()) throw new Error(notRegular);
      const maximum = info.size > 1_048_576 ? 65_536 : 1_048_577;
      const buffer = Buffer.alloc(maximum);
      let bytesRead = 0;
      while (bytesRead < maximum) {
        const chunk = await handle.read(buffer, bytesRead, maximum - bytesRead, bytesRead);
        if (!chunk.bytesRead) break;
        bytesRead += chunk.bytesRead;
      }
      prefix = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytesRead), { stream: info.size > 1_048_576 });
      if (info.size > 1_048_576 || bytesRead > 1_048_576) {
        prefix = prefix.slice(0, prefix.lastIndexOf('\n') + 1);
        throw new Error('Role definition exceeds the 1 MiB limit.');
      }
      const after = await handle.stat();
      if (after.size !== info.size || after.mtimeMs !== info.mtimeMs) throw new Error('Role definition changed while loading; retry after the edit finishes.');
      values.push({ source: path, text: prefix });
    } catch (error) { values.push({ source: path, text: prefix, failure: messageOf(error) }); }
    finally { await handle?.close(); }
  }
  return values;
}

function catalogFrom(layers: RoleLayer[]) {
  const catalog = resolveCatalog(layers);
  const blockers = catalog.diagnostics.filter(diagnostic => !diagnostic.id && layers.some(layer => layer.failure && layer.source === diagnostic.source));
  return { ...catalog, layers, blockers };
}

/** Global writes and ordinary reads use the same layer order. A write captures every
 * known project overlay once, then simulates independent catalogs from those inputs. */
export class RoleCatalogs {
  constructor(private readonly ctx: HostContext, private readonly overrides: () => OverrideRecord[],
    private readonly sharedDirectories: string[], private readonly projectDirectory: string) {}

  cwd(agent?: RuntimeAgent): string | undefined {
    return agent ? this.ctx.get('workingDirectory')?.get(agent.session) ?? agent.session.header.cwd : undefined;
  }

  private userLayers(): RoleLayer[] {
    return this.overrides().map(value => ({ source: 'user:' + value.id, text: value.text }));
  }

  private projectRoot(agent?: RuntimeAgent): string | undefined {
    const cwd = this.cwd(agent);
    return cwd ? resolve(cwd) : undefined;
  }

  async read(agent?: RuntimeAgent): Promise<RoleCatalog> {
    const user = this.userLayers();
    const project = this.projectRoot(agent);
    const layers = await Promise.all([...this.sharedDirectories, ...(project ? [join(project, this.projectDirectory)] : [])].map(readLayers));
    return catalogFrom([...user, ...layers.flat()]);
  }

  async forWrite(actor?: RuntimeAgent, signal?: AbortSignal): Promise<ConfigurationSnapshot> {
    const user = this.userLayers();
    const current = this.projectRoot(actor);
    const records = await this.ctx.get('sessionQuery')?.listSessions?.(signal) ?? [];
    signal?.throwIfAborted();
    const roots = new Set<string>();
    if (current) roots.add(current);
    for (const record of records) {
      if (record.header.cwd) roots.add(resolve(record.header.cwd));
    }
    for (const agent of this.ctx.agents.list()) {
      const cwd = this.projectRoot(agent);
      if (cwd) roots.add(cwd);
    }
    const shared = (await Promise.all(this.sharedDirectories.map(readLayers))).flat();
    const projects = new Map<string, RoleLayer[]>();
    // Limit concurrent directory and file reads regardless of the number of Sessions.
    const ordered = [...roots].sort();
    for (let index = 0; index < ordered.length; index += 8) {
      signal?.throwIfAborted();
      const chunk = ordered.slice(index, index + 8);
      const layers = await Promise.all(chunk.map(cwd => readLayers(join(cwd, this.projectDirectory))));
      for (const [offset, inputs] of layers.entries()) if (inputs.length) projects.set(chunk[offset], inputs);
    }
    signal?.throwIfAborted();
    return new ConfigurationSnapshot(user, shared, projects, current);
  }
}

export class ConfigurationSnapshot {
  constructor(readonly user: RoleLayer[], private readonly shared: RoleLayer[],
    private readonly projects: ReadonlyMap<string, RoleLayer[]>, readonly currentProject?: string) {}

  catalogs() {
    const base = [...this.user, ...this.shared];
    const global = catalogFrom(base);
    const projects = new Map([...this.projects].map(([cwd, layers]) => [cwd, catalogFrom([...base, ...layers])]));
    return { global, projects, current: (this.currentProject && projects.get(this.currentProject)) || global };
  }

  withWrite(id: string, text?: string): ConfigurationSnapshot {
    const source = 'user:' + id;
    const user = this.user.filter(layer => layer.source !== source);
    if (text !== undefined) user.push({ source, text });
    user.sort((a, b) => a.source.slice(5).localeCompare(b.source.slice(5)));
    return new ConfigurationSnapshot(user, this.shared, this.projects, this.currentProject);
  }

  fingerprint(): string {
    return createHash('sha256').update(JSON.stringify([this.user, this.shared, [...this.projects], this.currentProject])).digest('hex');
  }
}

export type ConfigurationCatalogs = ReturnType<ConfigurationSnapshot['catalogs']>;

export function assertReadable(catalogs: ConfigurationCatalogs): void {
  const blocker = [catalogs.global, ...catalogs.projects.values()].flatMap(catalog => catalog.blockers)[0];
  if (blocker) throw new Error(
    'Resolve unreadable role sources before saving. ' + blocker.source + ': ' + blocker.message,
  );
}

export function assertNoRoleLoss(before: ConfigurationCatalogs, after: ConfigurationCatalogs, targetId?: string): void {
  const compare = (baseline: AgentDefinition[], next: AgentDefinition[], project?: string) => {
    const remaining = new Set(next.map(role => role.id));
    const lost = baseline.filter(role => role.id !== targetId && !remaining.has(role.id)).map(role => role.id);
    if (lost.length) throw new Error(
      `This change invalidates derived agents: ${lost.join(', ')}. Update their definitions first.${project ? ' Project: ' + project : ''}`,
    );
  };
  compare(before.global.agents, after.global.agents);
  for (const [cwd, catalog] of before.projects) compare(catalog.agents, after.projects.get(cwd)!.agents, cwd);
}
