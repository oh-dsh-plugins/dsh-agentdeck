#!/usr/bin/env node
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

function main() {
  const [file, ...args] = process.argv.slice(2);
  if (!file || args.includes('--help')) {
    console.log('Usage: node document-outline.mjs <text-file> [--limit N]');
    return;
  }
  if (args.length && (args.length !== 2 || args[0] !== '--limit')) throw new Error('Expected --limit N');
  const limit = args.length ? Number(args[1]) : 200;
  if (!Number.isInteger(limit) || limit < 1 || limit > 5000) throw new Error('limit must be an integer from 1 to 5000');
  const path = resolve(file);
  if (statSync(path).size > 8_388_608) throw new Error('Text file exceeds the 8 MiB navigation limit; select a bounded section');
  const source = readFileSync(path, 'utf8');
  if (source.includes('\0')) throw new Error('Binary document is not supported; use the appropriate document reader');
  const lines = source.replace(/^\uFEFF/, '').split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  const headings = [];
  let fence;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length && /^ {0,3}(?:`+|~+)\s*$/.test(line)) fence = undefined;
      continue;
    }
    if (fence) continue;
    const atx = line.match(/^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (atx) headings.push({ line: index + 1, level: atx[1].length, title: atx[2] });
    else if (index > 0 && /^ {0,3}(?:=+|-+)\s*$/.test(line) && lines[index - 1].trim()
      && !/^\s*(?:#|>|[-*+]\s)/.test(lines[index - 1])) {
      headings.push({ line: index, level: line.trim()[0] === '=' ? 1 : 2, title: lines[index - 1].trim() });
    }
  }
  const navigation = headings.length ? headings : lines.filter((_, index) => index % 80 === 0)
    .map((line, index) => ({ line: index * 80 + 1, level: 0, title: line.trim().slice(0, 120) || '(blank line)' }));
  console.log(JSON.stringify({ path, totalLines: lines.length, kind: headings.length ? 'headings' : 'text-blocks',
    entries: navigation.slice(0, limit), truncated: navigation.length > limit,
    note: 'Navigation only; the underlying sections have not been read or summarized.' }, null, 2));
}
try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
