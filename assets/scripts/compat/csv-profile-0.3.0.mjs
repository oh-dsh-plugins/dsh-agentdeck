#!/usr/bin/env node
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

function parseCsv(source) {
  const rows = [];
  let row = [], field = '', quoted = false, closed = false;
  const finishField = () => { row.push(field); field = ''; closed = false; };
  const finishRow = () => { finishField(); if (row.length > 1 || row[0] !== '') rows.push(row); row = []; };
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') { field += '"'; index++; }
        else { quoted = false; closed = true; }
      } else field += char;
      continue;
    }
    if (closed && ![',', '\r', '\n'].includes(char)) throw new Error('Unexpected character after a quoted CSV field');
    if (char === '"') {
      if (field.length) throw new Error('Quote inside an unquoted CSV field');
      quoted = true;
    } else if (char === ',') finishField();
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[index + 1] === '\n') index++;
      finishRow();
    } else field += char;
  }
  if (quoted) throw new Error('Unterminated quoted CSV field');
  if (field.length || row.length || closed) finishRow();
  return rows;
}

function main() {
  const [file, ...args] = process.argv.slice(2);
  if (!file || args.includes('--help')) {
    console.log('Usage: node csv-profile.mjs <csv-file> [--max-rows N]');
    return;
  }
  if (args.length && (args.length !== 2 || args[0] !== '--max-rows')) throw new Error('Expected --max-rows N');
  const maxRows = args.length ? Number(args[1]) : 100000;
  if (!Number.isInteger(maxRows) || maxRows < 1 || maxRows > 1000000) throw new Error('max-rows must be an integer from 1 to 1000000');
  const path = resolve(file);
  if (statSync(path).size > 33_554_432) throw new Error('CSV exceeds the 32 MiB local profiling limit');
  const rows = parseCsv(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
  if (!rows.length) throw new Error('CSV has no header');
  const [header, ...records] = rows;
  if (header.some(name => !name.trim()) || new Set(header).size !== header.length) throw new Error('CSV header names must be nonempty and unique');
  const columns = header.map(name => ({ name, present: 0, missing: 0, numeric: 0, min: null, max: null, mean: null }));
  for (let index = 0; index < records.length; index++) {
    const record = records[index];
    if (record.length !== header.length) throw new Error(`CSV record ${index + 2} has ${record.length} fields; expected ${header.length}`);
    if (index >= maxRows) continue;
    record.forEach((raw, column) => {
      const stats = columns[column];
      const value = raw.trim();
      if (!value) { stats.missing++; return; }
      stats.present++;
      if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value)) return;
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) return;
      stats.numeric++;
      stats.min = stats.min === null ? numeric : Math.min(stats.min, numeric);
      stats.max = stats.max === null ? numeric : Math.max(stats.max, numeric);
      stats.mean = stats.mean === null ? numeric : stats.mean * ((stats.numeric - 1) / stats.numeric) + numeric / stats.numeric;
    });
  }
  console.log(JSON.stringify({ path, totalRecords: records.length, profiledRows: Math.min(records.length, maxRows),
    truncated: records.length > maxRows, columns, note: 'Empty records are skipped; numeric summaries cover parseable finite numbers only. No raw sample values are emitted.' }, null, 2));
}
try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
