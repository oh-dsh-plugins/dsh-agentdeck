import { lstat, mkdir, readFile, readlink, realpath, symlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
let hostRoot = process.env.AGENTDECK_DSH_ROOT;
if (!hostRoot) {
  const cli = execFileSync('/bin/sh', ['-c', 'command -v dsh'], { encoding: 'utf8' }).trim();
  if (!cli) throw new Error('Set AGENTDECK_DSH_ROOT to the installed DSH package directory.');
  hostRoot = resolve(dirname(await realpath(cli)), '..');
}
hostRoot = await realpath(hostRoot);
const hostManifest = JSON.parse(await readFile(join(hostRoot, 'package.json'), 'utf8'));
if (hostManifest.name !== '@deepseek-ai/dsh') throw new Error(`Not a DSH package: ${hostRoot}`);
const packages = [...new Set([
  ...Object.keys(manifest.peerDependencies ?? {}),
  '@deepseek-ai/dsh-api-remotes',
  '@deepseek-ai/cordis-plugin-loader',
  '@deepseek-ai/dsh-subagent',
  '@deepseek-ai/dsh-agent-loop',
  '@deepseek-ai/dsh-working-directory',
  '@deepseek-ai/dsh-fs-local',
  '@deepseek-ai/dsh-session-persistence-jsonl',
  '@deepseek-ai/dsh-subagent-spawn-in-process',
  '@deepseek-ai/dsh-tool-executor-native',
  '@deepseek-ai/dsh-client-connection',
  '@deepseek-ai/dsh-host-webserver',
  '@deepseek-ai/dsh-credentials',
  '@deepseek-ai/dsh-subprocess-local',
  '@deepseek-ai/dsh-token-meter',
  '@deepseek-ai/dsh-compaction-basic',
  '@deepseek-ai/dsh-skill',
  '@deepseek-ai/dsh-tool-testkit',
  '@deepseek-ai/dsh-agent-loop-testkit',
  '@deepseek-ai/dsh-session-projection',
  '@deepseek-ai/dsh-system-prompt',
  '@deepseek-ai/dsh-commands',
  '@deepseek-ai/dsh-base',
  '@deepseek-ai/dsh-storage-domain',
  '@deepseek-ai/dsh-storage',
  '@deepseek-ai/dsh-storage-json',
  '@deepseek-ai/dsh-session-query',
  '@deepseek-ai/dsh-tool-fs',
  '@deepseek-ai/dsh-tool-fs-search',
  '@deepseek-ai/dsh-web',
  '@deepseek-ai/dsh-tool-web'
])];
const linked = [];
for (const name of packages) {
  const target = join(hostRoot, 'node_modules', name);
  try { await lstat(target); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
  const destination = join(root, 'node_modules', name);
  await mkdir(dirname(destination), { recursive: true });
  try {
    const info = await lstat(destination);
    if (!info.isSymbolicLink() || resolve(dirname(destination), await readlink(destination)) !== target) {
      throw new Error(`Refusing to replace existing dependency ${destination}; keep one host closure.`);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await symlink(target, destination, 'dir');
  }
  linked.push(name);
}
console.log(JSON.stringify({ hostRoot, version: hostManifest.version, linked }, null, 2));
