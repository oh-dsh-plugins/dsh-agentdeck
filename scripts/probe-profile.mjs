// Cold boot an isolated profile installed through the selected native CLI.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const [hostPath, profile, patch, archive, sha256, expectedVersion] = process.argv.slice(2);
const host = await realpath(hostPath);
const nativeRequire = createRequire(join(host, 'package.json'));
const nativeImport = name => import(pathToFileURL(nativeRequire.resolve(name)).href);
const profileRoot = join(process.env.DSH_HOME, 'profiles', profile);
const installed = join(profileRoot, 'node_modules', 'dsh-agentdeck');
const installedRequire = createRequire(join(installed, 'package.json'));
const manifest = JSON.parse(await readFile(join(profileRoot, 'package.json'), 'utf8'));
assert.equal(await realpath(manifest.dependencies['dsh-agentdeck'].slice('file:'.length)), archive);
assert.equal(createHash('sha256').update(await readFile(archive)).digest('hex'), sha256);
assert.ok(manifest.dsh.profile.bundles.includes('dsh-agentdeck'));

// Resolve the modules as the provider actually does after boot, including the
// native runtime bridge that the loader registers for profile packages.
const { runProfile } = await nativeImport('@deepseek-ai/dsh/profile-boot');
const { createLaunchEnvironmentSnapshot } = await nativeImport('@deepseek-ai/dsh-launch-environment');
const boot = await runProfile({ profile, patchFiles: [patch], args: [], environment: createLaunchEnvironmentSnapshot([]) });
try {
  const names = boot.ctx.get('tools').definitions().map(tool => tool.name);
  for (const name of ['scene_agent_catalog', 'scene_agent_start', 'scene_agent_control', 'scene_agent_result']) {
    assert.equal(names.filter(value => value === name).length, 1, `Expected one active ${name}`);
  }
  const own = (await realpath(installed)) + sep;
  for (const name of ['dsh-agentdeck', 'dsh-agentdeck/role', 'dsh-agentdeck/client']) {
    assert.ok((await realpath(installedRequire.resolve(name))).startsWith(own), `Unexpected bundle entry ${name}`);
  }
  const { getDshRuntimeVersion } = await nativeImport('@deepseek-ai/dsh-app-boot');
  assert.equal(getDshRuntimeVersion(), expectedVersion);
  console.log(JSON.stringify({ profile, version: expectedVersion, sha256, active: true }));
} finally {
  await boot.ctx.fiber.dispose();
}
