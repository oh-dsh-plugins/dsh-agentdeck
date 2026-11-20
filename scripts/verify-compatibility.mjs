#!/usr/bin/env node
// Build/pack once before invoking. Installs are confined to this runner's owned root.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { hostPackages } from './host-packages.mjs';

const exec = promisify(execFile);
const source = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const root = resolve(option('--root') ?? join(source, '.agentdeck-dev', 'compatibility'));
const versions = (option('--versions') ?? '0.2.2-rc.1,0.2.2-rc.2,0.2.2-rc.3,0.2.2-rc.4,0.2.2-rc.5').split(',');
assert.ok(versions.length && new Set(versions).size === versions.length);
for (const version of versions) assert.match(version, /^[0-9]+[.][0-9]+[.][0-9]+(?:-[A-Za-z0-9.-]+)?$/);
const env = { ...process.env }; delete env.NODE_PATH; delete env.NODE_OPTIONS; delete env.AGENTDECK_DSH_ROOT;
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
// Install, verify and release each host sequentially to bound temporary disk use.
const version = JSON.parse(await readFile(join(source, 'package.json'), 'utf8')).version;
const archive = await realpath(resolve(option('--archive') ?? join(source, 'artifacts', 'dsh-agentdeck-' + version + '.tgz')));
const bytes = await readFile(archive);
const sha256 = createHash('sha256').update(bytes).digest('hex');
const integrity = 'sha512-' + createHash('sha512').update(bytes).digest('base64');
const results = [];
const upgrade = versions.includes('0.2.2-rc.1') && versions.includes('0.2.2-rc.5');
const data = join(root, 'upgrade-state');
if (upgrade) { assert.equal(dirname(data), root); await rm(data, { recursive: true, force: true }); await mkdir(data); }
for (const version of versions) {
  await prepare(version);
  const cell = join(root, version), project = join(cell, 'project'), host = hostOf(version);
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
  // Keep the tiny installed candidate/resources until upgrade proof completes;
  // release only this exact marked runner's rebuildable host closure.
  const hostPrefix = join(cell, 'host');
  assert.equal(await realpath(hostPrefix), hostPrefix); assert.equal(dirname(hostPrefix), cell);
  await rm(hostPrefix, { recursive: true });
}
if (upgrade) console.log('Passed persisted rc.1 -> rc.5 continuation');
assert.equal(createHash('sha256').update(await readFile(archive)).digest('hex'), sha256, 'Archive changed during verification');
console.log(JSON.stringify({ archive, sha256, versions: results.map(item => item.version), upgrade: versions.includes('0.2.2-rc.1') && versions.includes('0.2.2-rc.5') }, null, 2));
