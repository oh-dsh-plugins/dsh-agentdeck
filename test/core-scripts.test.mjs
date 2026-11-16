import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, symlinkSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const script = name => fileURLToPath(new URL(`../assets/scripts/${name}.mjs`, import.meta.url));
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'agentdeck-core-test-'));
  t.after(() => {
    const absolute = resolve(root);
    assert.equal(absolute, root);
    assert.equal(resolve(root, '..'), resolve(tmpdir()));
    assert.ok(basename(root).startsWith('agentdeck-core-test-'));
    rmSync(absolute, { recursive: true, force: true });
  });
  return root;
}
function run(name, ...args) {
  return spawnSync(process.execPath, [script(name), ...args], { encoding: 'utf8', timeout: 15000 });
}

test('project helper lists without execution and runs a declared existing check with real status', t => {
  const root = fixture(t);
  writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: {
    check: 'node -e "console.log(\'checked\')"', fail: 'node -e "process.exit(7)"',
  } }));
  const listing = run('project-checks', root);
  assert.equal(listing.status, 0, listing.stderr);
  assert.equal(JSON.parse(listing.stdout).manager, 'npm');
  assert.ok(!listing.stdout.includes('\nchecked\n'));
  const check = run('project-checks', root, '--run', 'check');
  assert.equal(check.status, 0, check.stderr);
  assert.match(check.stdout, /checked/);
  assert.equal(run('project-checks', root, '--run', 'fail').status, 7);
  assert.equal(run('project-checks', root, '--run', 'absent').status, 1);
});

test('project helper refuses install-like lifecycle chains and missing dependencies without attempting repair', t => {
  const root = fixture(t);
  writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: {
    check: 'node -e "console.log(\'should not run\')"', precheck: 'echo npm install',
  } }));
  const lifecycle = run('project-checks', root, '--run', 'check');
  assert.equal(lifecycle.status, 1);
  assert.match(lifecycle.stderr, /Refusing dependency installation/);
  assert.ok(!lifecycle.stdout.includes('should not run'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ dependencies: { unavailable: '1.0.0' },
    scripts: { check: 'node -e "console.log(\'should not run\')"' } }));
  const missing = run('project-checks', root, '--run', 'check');
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /dependencies are missing/);
  assert.equal(existsSync(join(root, 'node_modules')), false);
  assert.equal(existsSync(join(root, 'package-lock.json')), false);
  writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { check: 'npm run nested', nested: 'echo npx forbidden-download' } }));
  assert.match(run('project-checks', root, '--run', 'check').stderr, /Refusing dependency installation/);
});

test('repository inventory is deterministic, bounded, skips dependency trees and never follows symlinks', t => {
  const root = fixture(t);
  mkdirSync(join(root, 'src'));
  mkdirSync(join(root, 'node_modules'));
  writeFileSync(join(root, 'src', 'app.ts'), 'export const value = 1;');
  writeFileSync(join(root, 'README.md'), 'Project');
  writeFileSync(join(root, 'node_modules', 'hidden.js'), 'dependency');
  symlinkSync(join(root, 'src'), join(root, 'linked-source'));
  const first = run('repository-map', root);
  assert.equal(first.status, 0, first.stderr);
  const data = JSON.parse(first.stdout);
  assert.deepEqual(data.files, ['README.md', 'src/app.ts']);
  assert.deepEqual(first.stdout, run('repository-map', root).stdout);
  const limited = JSON.parse(run('repository-map', root, '--limit', '1').stdout);
  assert.equal(limited.files.length, 1);
  assert.equal(limited.truncated, true);
});

test('document outline preserves line anchors, excludes fenced headings and labels truncation', t => {
  const root = fixture(t);
  const path = join(root, 'notes.md');
  writeFileSync(path, '# Start\n\n```md\n# Ignored\n```\n\nSecond section\n--------------\n\n## End\n');
  const result = run('document-outline', path);
  assert.equal(result.status, 0, result.stderr);
  const data = JSON.parse(result.stdout);
  assert.deepEqual(data.entries, [
    { line: 1, level: 1, title: 'Start' }, { line: 7, level: 2, title: 'Second section' }, { line: 10, level: 2, title: 'End' },
  ]);
  const limited = JSON.parse(run('document-outline', path, '--limit', '1').stdout);
  assert.equal(limited.truncated, true);
  writeFileSync(path, 'plain text\n'.repeat(81));
  assert.equal(JSON.parse(run('document-outline', path).stdout).kind, 'text-blocks');
});

test('CSV profiler supports quoted multiline fields, finite numeric stats, missing values and explicit sampling', t => {
  const root = fixture(t);
  const path = join(root, 'values.csv');
  writeFileSync(path, '\uFEFFname,value,optional\r\n"person\nname",1,\r\n"quote ""x""",3,6\r\nother,5,9\r\n');
  const result = run('csv-profile', path);
  assert.equal(result.status, 0, result.stderr);
  const data = JSON.parse(result.stdout);
  assert.equal(data.totalRecords, 3);
  assert.equal(data.profiledRows, 3);
  assert.equal(data.truncated, false);
  assert.equal(data.columns[1].mean, 3);
  assert.equal(data.columns[1].min, 1);
  assert.equal(data.columns[1].max, 5);
  assert.equal(data.columns[2].missing, 1);
  assert.equal(data.columns[2].mean, 7.5);
  assert.ok(!result.stdout.includes('person'));
  const sample = JSON.parse(run('csv-profile', path, '--max-rows', '1').stdout);
  assert.equal(sample.profiledRows, 1);
  assert.equal(sample.totalRecords, 3);
  assert.equal(sample.truncated, true);
  assert.equal(sample.columns[1].mean, 1);
});

test('CSV profiler rejects ambiguous headers and malformed records instead of dropping data', t => {
  const root = fixture(t);
  const path = join(root, 'bad.csv');
  for (const csv of ['a,a\n1,2\n', 'a,\n1,2\n', 'a,b\n1\n', 'a,b\n"unterminated,1', 'a,b\n"closed"suffix,1\n']) {
    writeFileSync(path, csv);
    const result = run('csv-profile', path);
    assert.equal(result.status, 1, csv);
    assert.equal(result.stdout, '');
    assert.ok(result.stderr.length > 0);
  }
});
