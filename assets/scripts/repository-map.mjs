#!/usr/bin/env node
import { readdir, stat } from 'node:fs/promises';
import { resolve, relative, join } from 'node:path';

async function main() {
  const [directory, ...args] = process.argv.slice(2);
  if (!directory || args.includes('--help')) {
    console.log('Usage: node repository-map.mjs <root> [--limit N]');
    return;
  }
  if (args.length && (args.length !== 2 || args[0] !== '--limit')) throw new Error('Expected --limit N');
  const limit = args.length ? Number(args[1]) : 250;
  if (!Number.isInteger(limit) || limit < 1 || limit > 5000) throw new Error('limit must be an integer from 1 to 5000');
  const root = resolve(directory);
  if (!(await stat(root)).isDirectory()) throw new Error('root must be a directory');
  const excluded = new Set(['.git', '.hg', '.svn', 'node_modules', 'vendor', 'dist', 'build', 'lib', 'coverage', '.next', '.cache']);
  const files = [];
  const diagnostics = [];
  let truncated = false;
  async function visit(path, depth) {
    let entries;
    try { entries = await readdir(path, { withFileTypes: true }); }
    catch (error) { diagnostics.push({ path: relative(root, path) || '.', message: error.message }); return; }
    entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    for (const entry of entries) {
      if (truncated) return;
      const target = join(path, entry.name);
      if (entry.isFile()) {
        if (files.length === limit) { truncated = true; return; }
        files.push(relative(root, target));
      } else if (entry.isDirectory() && !excluded.has(entry.name)) {
        if (depth >= 12) { diagnostics.push({ path: relative(root, target), message: 'Maximum traversal depth reached' }); continue; }
        await visit(target, depth + 1);
      }
      // Symlinks are not followed, so the inventory stays inside the selected tree.
    }
  }
  await visit(root, 0);
  console.log(JSON.stringify({ root, files, truncated, excludedDirectories: [...excluded], diagnostics }, null, 2));
}
try { await main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
