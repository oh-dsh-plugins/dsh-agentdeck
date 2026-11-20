import { lstat, mkdir, readFile, readlink, realpath, symlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { hostPackages } from './host-packages.mjs';

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
const packages = hostPackages(manifest);
const linked = [];
const versions = {};
if (process.env.AGENTDECK_EXPECT_DSH_VERSION && hostManifest.version !== process.env.AGENTDECK_EXPECT_DSH_VERSION) throw new Error('The selected DSH version does not match this fixture.');
for (const name of packages) {
  const target = join(hostRoot, 'node_modules', name);
  try { await lstat(target); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (process.env.AGENTDECK_EXPECT_DSH_VERSION) throw new Error(`Missing native fixture dependency ${name} in ${hostRoot}`);
    continue;
  }
  const dependency = JSON.parse(await readFile(join(target, 'package.json'), 'utf8'));
  versions[name] = dependency.version;
  if (process.env.AGENTDECK_EXPECT_DSH_VERSION && name.startsWith('@deepseek-ai/dsh-') && dependency.version !== hostManifest.version) {
    throw new Error(`Mixed native versions: ${name}@${dependency.version} with DSH ${hostManifest.version}`);
  }
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
console.log(JSON.stringify({ hostRoot, version: hostManifest.version, linked, versions }, null, 2));
