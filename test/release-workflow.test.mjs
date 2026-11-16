import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, rmSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, basename } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parse } from 'yaml';

const workflow = parse(readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8'));
const steps = workflow.jobs.publish.steps;
const compare = steps.find(step => step.name === 'Verify every file before retaining an existing original archive').run.match(/python3 - <<'PY'\n([\s\S]*)\nPY\s*$/)[1];
const provenance = steps.find(step => step.name === 'Require provenance to identify the tested tag').run.match(/node --input-type=module <<'NODE'\n([\s\S]*)\nNODE\s*$/)[1];
const createArchives = `
import io, json, sys, tarfile
from pathlib import Path
plan = json.load(sys.stdin)
for filename, entries in plan.items():
    with tarfile.open(Path('artifacts') / filename, 'w:gz') as archive:
        for entry in entries:
            info = tarfile.TarInfo(entry['name'])
            info.mode = entry.get('mode', 0o600)
            data = entry.get('text', '').encode()
            if entry.get('link'):
                info.type = tarfile.SYMTYPE
                info.linkname = entry['link']
            else:
                info.size = len(data)
            archive.addfile(info, io.BytesIO(data))
`;
const original = [{ name: 'package/index.js', text: 'export const value = 1;\n', mode: 0o600 }];
function fixture(t, entries) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'agentdeck-release-test-')));
  t.after(() => {
    assert.equal(realpathSync(root), root);
    assert.equal(resolve(root, '..'), realpathSync(tmpdir()));
    assert.ok(basename(root).startsWith('agentdeck-release-test-'));
    rmSync(root, { recursive: true });
  });
  mkdirSync(join(root, 'artifacts'));
  const result = spawnSync('python3', ['-c', createArchives], { cwd: root, input: JSON.stringify({ 'published.tgz': original, 'dsh-agentdeck-0.2.4.tgz': entries }), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return { root, result: () => spawnSync('python3', ['-c', compare], { cwd: root, env: { ...process.env, VERSION: '0.2.4' }, encoding: 'utf8' }) };
}

test('release rerun retains the original npm bytes when only archive read bits differ', t => {
  const { root, result } = fixture(t, [{ ...original[0], mode: 0o644 }]);
  const published = readFileSync(join(root, 'artifacts/published.tgz'));
  const outcome = result();
  assert.equal(outcome.status, 0, outcome.stderr);
  assert.deepEqual(readFileSync(join(root, 'artifacts/dsh-agentdeck-0.2.4.tgz')), published);
  assert.equal(existsSync(join(root, 'artifacts/published.tgz')), false);
});

test('release rerun rejects changed contents, unsafe entries and write or executable permissions', async t => {
  const cases = [
    ['content', [{ ...original[0], text: 'export const value = 2;\n' }]],
    ['extra file', [...original, { name: 'package/extra.js', text: 'extra' }]],
    ['executable mode', [{ ...original[0], mode: 0o700 }]],
    ['writable mode', [{ ...original[0], mode: 0o620 }]],
    ['symbolic link', [{ ...original[0], link: 'other.js' }]],
    ['duplicate path', [...original, original[0]]],
    ['parent path', [{ ...original[0], name: 'package/../index.js' }]],
  ];
  for (const [name, entries] of cases) await t.test(name, child => {
    const { root, result } = fixture(child, entries);
    const before = readFileSync(join(root, 'artifacts/dsh-agentdeck-0.2.4.tgz'));
    const outcome = result();
    assert.notEqual(outcome.status, 0);
    assert.match(outcome.stderr, /differs|unique regular package files/);
    assert.deepEqual(readFileSync(join(root, 'artifacts/dsh-agentdeck-0.2.4.tgz')), before);
    assert.equal(existsSync(join(root, 'artifacts/published.tgz')), true);
  });
});

test('unpublished npm release provenance requires the tested commit and matching tag ref', () => {
  const cases = [
    ['tested', 'refs/tags/v0.2.5', 0],
    ['main', 'refs/heads/main', 1],
    ['tested', 'refs/tags/v0.2.6', 1],
  ];
  for (const [sha, ref, status] of cases) {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', provenance], { env: { ...process.env, RELEASE_TAG: 'v0.2.5', SOURCE_COMMIT: 'tested', GITHUB_SHA: sha, GITHUB_REF: ref }, encoding: 'utf8' });
    assert.equal(result.status, status, result.stderr);
  }
});
