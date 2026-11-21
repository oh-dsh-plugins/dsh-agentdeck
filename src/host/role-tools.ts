import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { defineTool, type ToolRunContext } from '@deepseek-ai/dsh-tools';
import type { HostContext, RoleSnapshot, RuntimeAgent } from './types.js';

const MAX_FILE = 1_048_576;
const MAX_OUTPUT = 24_000;
const PROJECT_HELPER = 'assets/scripts/project-checks.mjs';
const CSV_HELPER = 'assets/scripts/csv-profile.mjs';
const textOutput = { schema: { type: 'string' as const }, render: (_args: unknown, value: string) => [{ type: 'text' as const, text: value }] };
const jsonOutput = { schema: { type: 'object' as const, additionalProperties: true as const }, render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }] };

function caller(exec: ToolRunContext, expected: RuntimeAgent): void {
  if (exec.agent !== expected) throw new Error('AgentDeck helper requires its exact owning Agent.');
  exec.signal.throwIfAborted();
}
function service(ctx: HostContext, key: string): any {
  const value = ctx.get(key as any);
  if (!value) throw new Error(`AgentDeck capability unavailable: native ${key} service is not mounted.`);
  return value;
}
function integer(value: unknown, fallback: number, max: number): number {
  const number = value === undefined ? fallback : value;
  if (!Number.isSafeInteger(number) || (number as number) < 1 || (number as number) > max) throw new Error(`Expected an integer from 1 to ${max}.`);
  return number as number;
}
function capped(text: string, maximum = MAX_OUTPUT): string {
  return text.length <= maximum ? text : `${text.slice(0, maximum)}\n[Output truncated at ${maximum} characters.]`;
}
async function readBounded(ctx: HostContext, path: string, cwd: string, signal: AbortSignal, limit = MAX_FILE): Promise<{ target: any; text: string }> {
  const fs = service(ctx, 'fs');
  const target = await fs.resolve(path, { cwd, signal });
  const bytes = await fs.readBytes(target, signal, limit);
  if (bytes.includes(0)) throw new Error('Binary data is not supported by this text helper.');
  return { target, text: new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '') };
}

/** Verify pinned package resources in the same execution world as native fs/subprocess. */
export async function ownedHelper(ctx: HostContext, snapshot: RoleSnapshot, path: string, signal: AbortSignal): Promise<string> {
  if (!snapshot.role.scripts.includes(path)) throw new Error(`This role does not own helper ${path}.`);
  const revision = snapshot.scriptRevisions?.[path];
  if (!revision || !/^[a-f0-9]{64}$/.test(revision)) throw new Error(`Pinned revision is unavailable for helper ${path}; resume with the original snapshot dependencies.`);
  const fs = service(ctx, 'fs');
  const absolute = fileURLToPath(new URL(`../../${path}`, import.meta.url));
  const target = await fs.resolve(absolute, { signal });
  const bytes = await fs.readBytes(target, signal, 262_144);
  if (createHash('sha256').update(bytes).digest('hex') !== revision) throw new Error(`Helper revision changed: ${path}; the running snapshot cannot use replacement code.`);
  signal.throwIfAborted();
  return fs.processPath(target);
}

async function runHelper(ctx: HostContext, agent: RuntimeAgent, path: string, args: string[], signal: AbortSignal, timeoutMs: number): Promise<Record<string, any>> {
  const subprocess = service(ctx, 'subprocess');
  const cwd = await service(ctx, 'workingDirectory').ensure(agent, signal);
  const node = await subprocess.resolveExecutable('node', undefined, signal);
  const timeout = new AbortController();
  const control = AbortSignal.any([signal, timeout.signal]);
  const timer = setTimeout(() => timeout.abort(new Error(`AgentDeck helper exceeded ${timeoutMs} ms.`)), timeoutMs);
  let handle: any;
  let joined = false;
  try {
    handle = subprocess.spawn({
      argv: [node, path, ...args], cwd, signal: control, graceMs: 1000,
      stdio: { stdin: 'ignore', stdout: { maxBytes: 32_768 }, stderr: { maxBytes: 16_384 } },
      env: { npm_config_offline: 'true', YARN_ENABLE_NETWORK: '0', COREPACK_ENABLE_NETWORK: '0', COREPACK_ENABLE_DOWNLOAD_PROMPT: '0' },
    });
    const outcome = await handle.done;
    if (!await handle.waitForExit()) throw new Error('Native subprocess could not confirm helper quiescence.');
    joined = true;
    signal.throwIfAborted();
    if (timeout.signal.aborted) throw timeout.signal.reason;
    const stdout = handle.collected.stdout?.readFrom(0) ?? { text: '', lossy: false };
    const stderr = handle.collected.stderr?.readFrom(0) ?? { text: '', lossy: false };
    return { exitCode: outcome.exitCode, signal: outcome.signal, stdout: capped(stdout.text, 16_000), stderr: capped(stderr.text, 8_000), truncated: stdout.lossy || stderr.lossy || stdout.text.length > 16_000 || stderr.text.length > 8_000 };
  } finally {
    clearTimeout(timer);
    if (handle && !joined) {
      handle.terminate();
      await handle.done.catch(() => undefined);
      await handle.waitForExit();
    }
  }
}

/** Register snapshot-owned skill bodies using the native scoped registry. */
export function registerRoleTools(ctx: HostContext, agent: RuntimeAgent, snapshot: RoleSnapshot): Array<() => void> {
  const disposers: Array<() => void> = [];
  const skills = snapshot.skills.length ? service(ctx, 'skills') : ctx.get('skills' as any);
  const names = new Map<string, string>();
  try {
    for (const skill of snapshot.skills) {
      const nativeName = `agentdeck-${createHash('sha256').update(`${snapshot.id}:${skill.id}`).digest('hex').slice(0, 20)}`;
      names.set(skill.id, nativeName);
      disposers.push(skills.register({
        name: nativeName, description: skill.description, content: skill.body,
        source: 'runtime', provider: 'agentdeck',
        resourceBase: (skill.resourceBase ?? { kind: 'opaque', description: `AgentDeck snapshot ${snapshot.id}; resources are listed in the role catalog.` }) as any,
      }));
    }
    disposers.push(ctx.tools.register(defineTool({
      name: 'agentdeck_skill',
      description: 'Load a skill from this role’s versioned catalog, returning its complete instructions.',
      parameters: { id: { type: 'string', required: true, description: 'Exact skill id from the role catalog.' } },
      output: textOutput,
      async execute(args, exec) {
        caller(exec, agent);
        const name = names.get(args.id);
        const expected = snapshot.skills.find(skill => skill.id === args.id);
        if (!name || !expected) throw new Error(`Unknown role skill: ${args.id}. Available: ${[...names.keys()].join(', ') || '(none)'}.`);
        const cwd = await service(ctx, 'workingDirectory').ensure(agent, exec.signal);
        const loaded = await service(ctx, 'skills').get(name, { scope: agent, cwd, signal: exec.signal });
        if (!loaded || loaded.content !== expected.body) throw new Error(`Skill revision unavailable: ${args.id}; the running snapshot cannot use a replacement.`);
        if (loaded.content.length > MAX_OUTPUT) throw new Error(`Skill ${args.id} exceeds the complete-load limit (${MAX_OUTPUT} characters); reduce the skill before creating a new task.`);
        return expected.resourceBase ? `${loaded.content}\n\nSkill resource base: ${JSON.stringify(expected.resourceBase)}` : loaded.content;
      },
    })));
    disposers.push(ctx.tools.register(defineTool({
      name: 'agentdeck_read_attachment',
      description: 'Read a bounded line range from a UTF-8 file attached to this Agent’s conversation.',
      parameters: {
        column: { type: 'integer', description: 'First UTF-16 character position on the starting line (1-based). Resume with the returned next offset and column.' },
        attachment_id: { type: 'string', required: true, description: 'Durable attachment id present in this conversation.' },
        offset: { type: 'integer', description: 'First line, starting at 1; defaults to 1.' },
        limit: { type: 'integer', description: 'Number of lines, from 1 to 200; defaults to 100. Files are limited to 1 MiB.' },
      },
      output: jsonOutput,
      async execute(args, exec) {
        caller(exec, agent);
        const ref = agent.session.deriveMessages().flatMap((message: any) => message.content)
          .find((block: any) => block.type === 'file' && block.attachment.attachmentId === args.attachment_id)?.attachment;
        if (!ref) throw new Error('Attachment is not present in this Agent’s conversation.');
        if (ref.bytes > MAX_FILE) throw new Error('Attachment exceeds the 1 MiB text-read limit; use an appropriate document reader.');
        const offset = integer(args.offset, 1, Number.MAX_SAFE_INTEGER);
        const limit = integer(args.limit, 100, 200);
        const chunks: Uint8Array[] = [];
        let length = 0;
        for await (const chunk of service(ctx, 'attachments').readFileStream(ref, exec.signal)) {
          exec.signal.throwIfAborted();
          length += chunk.length;
          if (length > MAX_FILE) throw new Error('Attachment exceeds the bounded read limit.');
          chunks.push(chunk);
        }
        const bytes = Buffer.concat(chunks);
        if (bytes.includes(0)) throw new Error('Binary attachment requires an appropriate document reader.');
        const lines = new TextDecoder('utf-8', { fatal: true }).decode(bytes).split(/\r?\n/);
        const column = integer(args.column, 1, MAX_FILE + 1);
        if (column > (lines[offset - 1]?.length ?? 0) + 1) throw new Error('Attachment column exceeds the line length.');
        const selected = lines.slice(offset - 1, offset - 1 + limit);
        if (selected.length) selected[0] = selected[0].slice(column - 1);
        const excerpt = selected.join('\n');
        let end = Math.min(MAX_OUTPUT, excerpt.length);
        // Keep both UTF-16 code units of a supplementary character on the same page.
        if (end < excerpt.length && /[\uDC00-\uDFFF]/.test(excerpt[end])) end--;
        const text = excerpt.slice(0, end);
        let next: { offset: number; column: number } | undefined;
        if (text.length < excerpt.length) {
          const pieces = text.split('\n');
          next = { offset: offset + pieces.length - 1, column: pieces.at(-1)!.length + (pieces.length === 1 ? column : 1) };
        } else if (offset - 1 + selected.length < lines.length) next = { offset: offset + selected.length, column: 1 };
        return { attachmentId: ref.attachmentId, name: capped(String(ref.name), 256), offset, totalLines: lines.length, text, truncated: !!next, ...(next ? { next } : {}) };
      },
    })));
    if (snapshot.role.capabilities.includes('project-runner') && snapshot.role.scripts.includes(PROJECT_HELPER)) disposers.push(ctx.tools.register(defineTool({
      name: 'agentdeck_run_project_script',
      description: 'List existing project checks or run one named check using this role’s pinned project helper. No dependencies are installed.',
      parameters: {
        script: { type: 'string', description: 'Existing package.json check name. Omit to list checks; only test, check, lint, typecheck and their colon variants are accepted.' },
        timeout_ms: { type: 'integer', description: 'Execution limit from 1 to 120000 ms; defaults to 60000.' },
      },
      output: jsonOutput,
      async execute(args, exec) {
        caller(exec, agent);
        const helper = await ownedHelper(ctx, snapshot, PROJECT_HELPER, exec.signal);
        const cwd = await service(ctx, 'workingDirectory').ensure(agent, exec.signal);
        const { text } = await readBounded(ctx, 'package.json', cwd, exec.signal, 262_144);
        const pkg = JSON.parse(text);
        const scripts = pkg.scripts ?? {};
        const checkName = /^(?:test|check|lint|typecheck)(?::[a-zA-Z0-9._-]+)*$/;
        const available = Object.keys(scripts).filter(name => name.length <= 128 && checkName.test(name) && typeof scripts[name] === 'string');
        if (args.script === undefined) return { available: available.slice(0, 100), truncated: available.length > 100 };
        if (!available.includes(args.script)) throw new Error('Select an existing project check from the listing.');
        return runHelper(ctx, agent, helper, [cwd, '--run', args.script], exec.signal, integer(args.timeout_ms, 60_000, 120_000));
      },
    })));
    if (snapshot.role.capabilities.includes('data-query')) disposers.push(ctx.tools.register(defineTool({
      name: 'agentdeck_parse_data',
      description: 'Summarize a bounded JSON dataset or profile CSV columns without evaluating code or emitting raw sample values.',
      parameters: {
        path: { type: 'string', required: true, description: 'Dataset path, relative to this Agent’s working directory.' },
        format: { type: 'string', enum: ['json', 'csv'], required: true, description: 'Input format. JSON is limited to 1 MiB; CSV to 32 MiB through the pinned CSV helper.' },
        max_rows: { type: 'integer', description: 'Maximum records to profile, from 1 to 10000; defaults to 1000.' },
      },
      output: jsonOutput,
      async execute(args, exec) {
        caller(exec, agent);
        const cwd = await service(ctx, 'workingDirectory').ensure(agent, exec.signal);
        const count = integer(args.max_rows, 1000, 10_000);
        if (args.format === 'csv') {
          const helper = await ownedHelper(ctx, snapshot, CSV_HELPER, exec.signal);
          const fs = service(ctx, 'fs');
          const target = await fs.resolve(args.path, { cwd, signal: exec.signal });
          return runHelper(ctx, agent, helper, [fs.processPath(target), '--max-rows', String(count)], exec.signal, 60_000);
        }
        const { text } = await readBounded(ctx, args.path, cwd, exec.signal);
        const value = JSON.parse(text);
        const rows = Array.isArray(value) ? value : [value];
        const columns = new Map<string, { present: number; nulls: number; numeric: number; min: number | null; max: number | null }>();
        for (const row of rows.slice(0, count)) {
          exec.signal.throwIfAborted();
          if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('JSON records must be objects.');
          for (const [key, cell] of Object.entries(row)) {
            if (key.length > 128) throw new Error('Dataset column names exceed 128 characters; select a dataset with bounded labels.');
            if (!columns.has(key) && columns.size >= 100) throw new Error('Dataset has more than 100 columns; select a narrower dataset.');
            const stats = columns.get(key) ?? { present: 0, nulls: 0, numeric: 0, min: null, max: null };
            stats.present++;
            if (cell === null) stats.nulls++;
            if (typeof cell === 'number' && Number.isFinite(cell)) {
              stats.numeric++; stats.min = stats.min === null ? cell : Math.min(stats.min, cell); stats.max = stats.max === null ? cell : Math.max(stats.max, cell);
            }
            columns.set(key, stats);
          }
        }
        return { totalRecords: rows.length, profiledRows: Math.min(count, rows.length), truncated: rows.length > count, columns: [...columns].map(([name, stats]) => ({ name, ...stats })) };
      },
    })));
    return disposers;
  } catch (error) {
    for (const dispose of disposers.reverse()) dispose();
    throw error;
  }
}
