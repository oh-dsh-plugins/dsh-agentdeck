import { execFileSync } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const data = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: root, encoding: 'utf8' }))[0];
const names = new Set(data.files.map(file => file.path));
const required = ['lib/index.js', 'lib/role.js', 'lib/client.js', 'assets/scripts/compat/csv-profile-0.3.0.mjs', 'cordis.patch.yml', 'locale/en.json', 'locale/zh.json', 'icon.svg', 'README.md', 'README.zh-CN.md', 'CHANGELOG.md', 'CONTRIBUTING.md', 'SECURITY.md', 'THIRD_PARTY_NOTICES.md', 'docs/core-contract.md', 'docs/ui-contract.md', 'docs/validation.md', 'docs/releasing.md', 'LICENSE'];
const forbidden = [...names].filter(name => /^(?:\.agentdeck-dev\/|\.ci-browser\/|node_modules\/|issues\/|AGENTS\.md$|PRODUCT\.md$|docs\/verification\.md$|\.env(?:\.|$))/.test(name) || /\.(?:tgz|log)$/.test(name));
if (forbidden.length) throw new Error(`Local-only files must not be packed: ${forbidden.join(', ')}`);
for (const name of required) {
  if (!names.has(name)) throw new Error(`Missing packed resource: ${name}`);
  await access(new URL(name, root));
}
for (const locale of ['en', 'zh']) {
  const dict = JSON.parse(await readFile(new URL(`locale/${locale}.json`, root), 'utf8'));
  if (!dict.meta?.title || !dict.meta?.description) throw new Error(`Missing display metadata: ${locale}`);
}
const icon = await readFile(new URL('icon.svg', root), 'utf8');
if (!icon.includes('<svg') || Buffer.byteLength(icon) > 262144) throw new Error('Invalid bundled icon.');
if (![...names].some(name => name.startsWith('assets/'))) throw new Error('No factory agent assets are packed.');
console.log(JSON.stringify({ name: data.name, version: data.version, files: data.files.length, unpackedSize: data.unpackedSize, requiredResources: 'present' }, null, 2));
