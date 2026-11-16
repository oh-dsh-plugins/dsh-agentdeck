#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

function main() {
  const [directory, ...args] = process.argv.slice(2);
  if (!directory || args.includes('--help')) {
    console.log('Usage: node project-checks.mjs <root> [--run <script> [-- <arguments...>]]');
    return;
  }
  const root = resolve(directory);
  const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  const scripts = pkg.scripts ?? {};
  if (!scripts || typeof scripts !== 'object' || Array.isArray(scripts)
    || Object.values(scripts).some(value => typeof value !== 'string')) throw new Error('package.json scripts must be a string mapping');
  let manager;
  if (pkg.packageManager !== undefined) {
    if (typeof pkg.packageManager !== 'string' || !/^(npm|pnpm|yarn)@\S+$/.test(pkg.packageManager)) {
      throw new Error('Only existing npm, pnpm or yarn runners are supported; no manager will be installed');
    }
    manager = pkg.packageManager.split('@')[0];
  } else if (existsSync(resolve(root, 'pnpm-lock.yaml'))) manager = 'pnpm';
  else if (existsSync(resolve(root, 'yarn.lock'))) manager = 'yarn';
  else manager = 'npm';
  if (!args.length) {
    console.log(JSON.stringify({ root, manager, scripts, note: 'Listing only. Review lifecycle commands before using --run; no dependencies are installed.' }, null, 2));
    return;
  }
  if (args[0] !== '--run' || !args[1] || args[1].startsWith('-') || (args.length > 2 && args[2] !== '--')) {
    throw new Error('Expected --run <script> followed optionally by -- <arguments...>');
  }
  const name = args[1];
  if (!Object.hasOwn(scripts, name)) throw new Error(`Unknown project script: ${name}`);
  const installs = /\b(?:npm|pnpm|yarn|bun)\s+(?:--[\w-]+(?:=\S+)?\s+)*(?:install|add|ci|exec|dlx|create)\b|\bnpx\b|\bcorepack\s+(?:enable|prepare|install|use)\b/i;
  const checked = new Set();
  const inspect = script => {
    if (checked.has(script) || !Object.hasOwn(scripts, script)) return;
    checked.add(script);
    const command = scripts[script];
    if (installs.test(command)) throw new Error(`Refusing dependency installation/download command in script ${script}: ${command}`);
    for (const match of command.matchAll(/\b(?:npm|pnpm|yarn)\s+run\s+([\w:.-]+)/g)) inspect(match[1]);
    inspect(`pre${script}`);
    inspect(`post${script}`);
  };
  inspect(name);
  const dependencies = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
  if (dependencies.length && !existsSync(resolve(root, 'node_modules')) && !existsSync(resolve(root, '.pnp.cjs'))) {
    throw new Error('Project dependencies are missing. Ask the project owner to prepare them; this helper does not install packages.');
  }
  console.error(JSON.stringify({ root, manager, script: name, inspectedScripts: [...checked], command: scripts[name] }));
  const result = spawnSync(manager, ['run', name, ...(manager === 'npm' ? ['--'] : []), ...args.slice(3)], {
    cwd: root, stdio: 'inherit', shell: false,
    env: { ...process.env, npm_config_offline: 'true', YARN_ENABLE_NETWORK: '0', COREPACK_ENABLE_NETWORK: '0', COREPACK_ENABLE_DOWNLOAD_PROMPT: '0' },
  });
  if (result.error) throw new Error(`Could not run existing ${manager}: ${result.error.message}`);
  if (result.signal) throw new Error(`Project script terminated by ${result.signal}`);
  process.exitCode = result.status ?? 1;
}
try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
