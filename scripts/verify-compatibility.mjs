#!/usr/bin/env node
// Build/pack once before invoking. Installs are confined to this runner's owned root.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { hostPackages } from './host-packages.mjs';

const exec = promisify(execFile);
const source = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const root = resolve(option('--root') ?? join(source, '.agentdeck-dev', 'compatibility'));
const sourceManifest = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'));
const declared = sourceManifest.engines.dsh.split(/\s*\|\|\s*/);
const selected = option('--versions')?.split(',') ?? declared;
assert.ok(selected.length && new Set(selected).size === selected.length);
for (const version of selected) assert.ok(declared.includes(version), `Unsupported DSH matrix version: ${version}`);
// The manifest orders source hosts before their persisted-upgrade targets.
const versions = declared.filter(version => selected.includes(version));
const env = { ...process.env };
for (const key of Object.keys(env)) {
  if (key.startsWith('DSH_') || ['NODE_PATH', 'NODE_OPTIONS', 'AGENTDECK_DSH_ROOT'].includes(key)) delete env[key];
}
const marker = join(root, '.agentdeck-compatibility.json');
await mkdir(root, { recursive: true });
try { assert.equal(JSON.parse(await readFile(marker, 'utf8')).purpose, 'agentdeck-isolated-compatibility'); }
catch (error) { if (error.code !== 'ENOENT') throw error; assert.deepEqual(await readdir(root), [], 'Refuse an unowned nonempty root'); await writeFile(marker, JSON.stringify({ purpose: 'agentdeck-isolated-compatibility' })); }
async function run(command, argv, cwd, log, extra = {}) {
  try {
    const out = await exec(command, argv, { cwd, env: { ...env, ...extra }, timeout: 10 * 60_000, maxBuffer: 16 * 1024 * 1024 });
    await writeFile(log, out.stdout + '\n' + out.stderr); return out.stdout;
  } catch (error) {
    await writeFile(log, String(error.stdout ?? '') + '\n' + String(error.stderr ?? '') + '\n' + error.message);
    throw new Error('Command failed (' + error.code + '); see ' + log + '\n' + String(error.stdout ?? error.stderr ?? '').slice(-2500));
  }
}
const hostOf = version => join(root, version, 'host', 'lib', 'node_modules', '@deepseek-ai', 'dsh');
async function prepare(version) {
  const cell = join(root, version); await mkdir(cell, { recursive: true });
  const host = hostOf(version);
  const prefix = join(cell, 'host');
  try { assert.equal(await realpath(prefix), prefix); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  assert.equal(dirname(prefix), cell); assert.equal(dirname(cell), root);
  await rm(prefix, { recursive: true, force: true });
  await run('npm', ['install', '--global', '--prefix', prefix, '--legacy-peer-deps', '--ignore-scripts', '--no-audit', '--no-fund', '@deepseek-ai/dsh@' + version], cell, join(cell, 'host-install.log'));
  // The CLI declares public SDK contracts as development dependencies. Install
  // that published exact set too; never fill missing contracts from a global host.
  const manifest = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'));
  const packages = new Map(hostPackages(manifest).filter(name => name.startsWith('@deepseek-ai/dsh-')).map(name => [name, version]));
  let phase = 0;
  for (;;) {
    const requested = [...packages].map(([name, range]) => name + '@' + range);
    await run('npm', ['install', '--prefix', host, '--include=dev', '--no-save', '--legacy-peer-deps', '--ignore-scripts', '--no-audit', '--no-fund', ...requested], cell, join(cell, 'host-sdk-install-' + phase++ + '.log'));
    const scope = join(host, 'node_modules', '@deepseek-ai');
    const native = await readdir(scope);
    const required = new Map();
    for (const name of native) {
      const pkg = JSON.parse(await readFile(join(scope, name, 'package.json'), 'utf8'));
      if (name.startsWith('dsh-')) assert.equal(pkg.version, version, 'Mixed native SDK version: ' + pkg.name);
      for (const dependency of Object.keys(pkg.dependencies ?? {})) if (dependency.startsWith('@deepseek-ai/dsh-')) required.set(dependency, version);
      for (const [dependency, range] of Object.entries(pkg.peerDependencies ?? {})) if (!pkg.peerDependenciesMeta?.[dependency]?.optional) required.set(dependency, dependency.startsWith('@deepseek-ai/dsh-') ? version : range);
    }
    const missing = [];
    for (const [name, range] of required) {
      try {
        const pkg = JSON.parse(await readFile(join(host, 'node_modules', name, 'package.json'), 'utf8'));
        if (name.startsWith('@deepseek-ai/dsh-')) assert.equal(pkg.version, version, 'Mixed native dependency: ' + name);
      } catch (error) { if (error.code !== 'ENOENT') throw error; missing.push([name, range]); }
    }
    if (!missing.length) break;
    assert.ok(missing.some(([name]) => !packages.has(name)), 'Native SDK installation did not make progress');
    for (const [name, range] of missing) packages.set(name, range);
  }
  assert.equal(JSON.parse(await readFile(join(host, 'package.json'), 'utf8')).version, version);
  console.log('Prepared DSH ' + version);
}
async function verifyNativeProfile(host, cell, version, archive, sha256) {
  const isolation = await mkdtemp(join(cell, 'native-profile-'));
  const patch = join(isolation, 'presets.patch.yml');
  const bootEnv = {
    DSH_HOME: join(isolation, 'home'), DSH_AGENTS_HOME: join(isolation, 'agents'),
    pnpm_config_store_dir: join(root, 'native-pnpm-store'),
    PATH: dirname(process.execPath) + delimiter + env.PATH,
  };
  await writeFile(patch, '- insert:\n    - id: fixture-preset-registry\n      name: "@deepseek-ai/dsh-agent-preset-registry"\n      config:\n        default: fixture-standard\n');
  const hostManifest = JSON.parse(await readFile(join(host, 'package.json'), 'utf8'));
  await run(process.execPath, [join(host, hostManifest.bin.dsh), 'plugin', '--profile', 'compat', 'add', archive], isolation, join(cell, 'native-install.log'), bootEnv);
  await run(process.execPath, [join(source, 'scripts/probe-profile.mjs'), host, 'compat', patch, archive, sha256, version], isolation, join(cell, 'native-boot.log'), bootEnv);
}

// Install, verify and release each host sequentially to bound temporary disk use.
const { version } = sourceManifest;
const archive = await realpath(resolve(option('--archive') ?? join(source, 'artifacts', 'dsh-agentdeck-' + version + '.tgz')));
const bytes = await readFile(archive);
const sha256 = createHash('sha256').update(bytes).digest('hex');
const integrity = 'sha512-' + createHash('sha512').update(bytes).digest('base64');
const results = [];
const upgrade = versions.includes('0.2.2-rc.1') && versions.includes('0.2.2-rc.5');
const data = join(root, 'upgrade-state');
const alphaVersions = versions.filter(value => value.startsWith('0.2.3-alpha.'));
const workspaceUpgrade = versions.includes('0.2.2-rc.5') && alphaVersions.length > 0;
const upgradeRoot = workspaceUpgrade ? await mkdtemp(join(root, 'workspace-upgrade-')) : undefined;
const workspaceLayouts = ['inherited', 'moved'];
const workspaceSeed = layout => join(upgradeRoot, 'seed-' + layout);
const published031 = 'https://registry.npmjs.org/dsh-agentdeck/-/dsh-agentdeck-0.3.1.tgz';
const published031Sha = '9cac0b1c6be3a1b1691bae1f0809f6ccc7c355bc99293a3e7b05046e2bef132b';
const workspaceProofs = [];
if (workspaceUpgrade) assert.ok(alphaVersions.every(version => versions.indexOf(version) > versions.indexOf('0.2.2-rc.5')), 'Run RC.5 before the Alpha workspace probes');
if (upgrade) { assert.equal(dirname(data), root); await rm(data, { recursive: true, force: true }); await mkdir(data); }
for (const version of versions) {
  await prepare(version);
  const cell = join(root, version), project = join(cell, 'project'), host = hostOf(version);
  await verifyNativeProfile(host, cell, version, archive, sha256);
  // This exact subtree contains only fixtures made by this marked runner.
  assert.equal(dirname(project), cell); assert.equal(dirname(cell), root);
  await rm(project, { recursive: true, force: true }); await mkdir(project);
  await writeFile(join(project, 'package.json'), JSON.stringify({ name: 'agentdeck-isolated-fixture', private: true, type: 'module' }));
  await run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--legacy-peer-deps', archive, '@wxg-prc-cpg/browser-skill-dsh-plugin@0.5.0'], project, join(cell, 'candidate-install.log'));
  const lock = JSON.parse(await readFile(join(project, 'package-lock.json'), 'utf8'));
  assert.equal(lock.packages['node_modules/dsh-agentdeck'].integrity, integrity, 'The installed archive must be the tested bytes');
  const candidate = join(project, 'node_modules', 'dsh-agentdeck');
  const manifest = JSON.parse(await readFile(join(candidate, 'package.json'), 'utf8'));
  await writeFile(join(project, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
  for (const item of await readdir(candidate)) {
    if (item === 'package.json' || item === 'node_modules') continue;
    await symlink(join(candidate, item), join(project, item));
  }
  for (const name of ['scripts', 'test', 'src', '.github']) await cp(join(source, name), join(project, name), { recursive: true });
  await run(process.execPath, ['scripts/link-host.mjs'], project, join(cell, 'link.log'), { AGENTDECK_DSH_ROOT: host, AGENTDECK_EXPECT_DSH_VERSION: version });
  // Resolve from the fixture and the installed plugin independently. Every native
  // entry must be inside this selected host, never the developer's global install.
  const check = "import assert from 'node:assert/strict'; import {createRequire} from 'node:module'; import {realpath,readFile} from 'node:fs/promises'; import {join,sep} from 'node:path'; import {pathToFileURL} from 'node:url'; const host=await realpath(process.env.AGENTDECK_DSH_ROOT); for(const base of ['package.json','node_modules/dsh-agentdeck/package.json','node_modules/@wxg-prc-cpg/browser-skill-dsh-plugin/package.json']) {const req=createRequire(pathToFileURL(join(process.cwd(),base))); for(const name of ['@deepseek-ai/cordis','@deepseek-ai/cordis-plugin-loader','@deepseek-ai/dsh-tools','@deepseek-ai/dsh-agent','@deepseek-ai/dsh-subagent','@deepseek-ai/dsh-session-query']) {const path=await realpath(req.resolve(name)); assert.ok(path.startsWith(host+sep),base+' resolved foreign '+name+': '+path);}} await import('dsh-agentdeck'); await import('dsh-agentdeck/role'); await import('dsh-agentdeck/client'); console.log(JSON.stringify({host,version:process.env.AGENTDECK_EXPECT_DSH_VERSION,entries:'loaded',nativeClosure:'isolated'}));";
  // Client is a browser IIFE, so its public entry is resolved/read separately by
  // existing client contract tests rather than evaluated as a server module.
  const serverCheck = check.replace("await import('dsh-agentdeck/client');", "");
  await run(process.execPath, ['--input-type=module', '-e', serverCheck], project, join(cell, 'entry-proof.log'), { AGENTDECK_DSH_ROOT: host, AGENTDECK_EXPECT_DSH_VERSION: version });
  const tests = (await readdir(join(project, 'test'))).filter(name => name.endsWith('.test.mjs')).sort().map(name => 'test/' + name);
  const output = await run(process.execPath, ['--test', '--test-reporter=spec', ...tests], project, join(cell, 'tests.log'), { AGENTDECK_EXPECT_DSH_VERSION: version, AGENTDECK_BROWSER_MODULE_BASE: project });
  const counts = output.split('\n').filter(line => /(?:tests|pass|fail|skipped|cancelled) \d+$/.test(line));
  assert.ok(counts.some(line => /fail 0$/.test(line)) && counts.some(line => /skipped 0$/.test(line)), 'All fixture tests must execute and pass');
  results.push({ version, sha256, counts, entryProof: 'isolated' });
  await writeFile(join(root, 'results.json'), JSON.stringify({ archive, sha256, results }, null, 2));
  console.log('Passed DSH ' + version + ': ' + counts.join(', '));
  if (upgrade && (version === '0.2.2-rc.1' || version === '0.2.2-rc.5')) {
    const phase = version === '0.2.2-rc.1' ? 'create' : 'resume';
    await run(process.execPath, ['scripts/probe-upgrade.mjs', phase, data], project, join(root, 'upgrade-' + phase + '.log'), { AGENTDECK_EXPECT_DSH_VERSION: version });
  }
  if (workspaceUpgrade && version === '0.2.2-rc.5') {
    const download = await run('npm', ['pack', published031, '--ignore-scripts', '--json', '--pack-destination', upgradeRoot], project, join(root, 'published-0.3.1.log'));
    const [{ filename }] = JSON.parse(download);
    assert.equal(filename, 'dsh-agentdeck-0.3.1.tgz');
    const releaseArchive = join(upgradeRoot, filename);
    assert.equal(createHash('sha256').update(await readFile(releaseArchive)).digest('hex'), published031Sha);
    const old = join(project, 'published');
    await mkdir(old);
    await run('npm', ['install', '--prefix', old, '--ignore-scripts', '--no-audit', '--no-fund', '--legacy-peer-deps', releaseArchive], project, join(root, 'published-0.3.1-install.log'));
    const oldEntry = join(old, 'node_modules', 'dsh-agentdeck', 'lib', 'index.js');
    for (const layout of workspaceLayouts) {
      const directory = workspaceSeed(layout);
      await mkdir(directory);
      for (const phase of ['seed', 'capture-active', 'capture']) {
        await run(process.execPath, ['scripts/probe-workspace-upgrade.mjs', phase, directory, oldEntry, layout], project,
          join(root, 'workspace-' + layout + '-' + phase + '.log'), { AGENTDECK_EXPECT_DSH_VERSION: version });
      }
    }
  }
  if (workspaceUpgrade && alphaVersions.includes(version)) {
    for (const layout of workspaceLayouts) {
      const directory = join(upgradeRoot, version + '-' + layout);
      await cp(workspaceSeed(layout), directory, { recursive: true, verbatimSymlinks: true });
      await run(process.execPath, ['scripts/probe-workspace-upgrade.mjs', 'resume', directory], project,
        join(cell, 'workspace-' + layout + '-resume.log'), { AGENTDECK_EXPECT_DSH_VERSION: version });
      workspaceProofs.push({ from: '0.2.2-rc.5', to: version, layout });
    }
  }
  // Keep the tiny installed candidate/resources until upgrade proof completes;
  // release only this exact marked runner's rebuildable host closure.
  const hostPrefix = join(cell, 'host');
  assert.equal(await realpath(hostPrefix), hostPrefix); assert.equal(dirname(hostPrefix), cell);
  await rm(hostPrefix, { recursive: true });
}
if (upgrade) console.log('Passed persisted rc.1 -> rc.5 continuation');
assert.equal(createHash('sha256').update(await readFile(archive)).digest('hex'), sha256, 'Archive changed during verification');
const summary = { archive, sha256, results, upgrade, workspaceProofs };
await writeFile(join(root, 'results.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify({ archive, sha256, versions: results.map(item => item.version), upgrade, workspaceProofs }, null, 2));
