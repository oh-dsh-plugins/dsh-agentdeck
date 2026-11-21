import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { createSystemMessage, createUserMessage } from '@deepseek-ai/dsh-llm';
import SkillRegistry from '@deepseek-ai/dsh-skill';
import TokenMeter from '@deepseek-ai/dsh-token-meter';
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt';
import * as Role from '../lib/role.js';
import { createNativeHarness, ROUTE, bounded, deferred } from '../scripts/probe-native.mjs';

const projectHelper = 'assets/scripts/project-checks.mjs';
const csvHelper = 'assets/scripts/csv-profile.mjs';
let serial = 0;
async function snapshot(capabilities = ['files-read'], patch = {}) {
  return {
    id: `role-fixture-${++serial}`, presetId: `role-fixture-${serial}`,
    role: { schemaVersion: 1, id: 'reader', title: { en: 'Reader', zh: '阅读员' }, description: { en: 'Read evidence.', zh: '阅读证据。' },
      instructions: 'Read evidence and preserve the delegated authorization.', capabilities,
      skills: ['evidence'], scripts: capabilities.includes('project-runner') ? [projectHelper, csvHelper] : [],
      inputs: [], deliverables: [], model: { mode: 'inherit' }, reasoning: { mode: 'model-default' },
      context: { targetTokens: 10_000, elasticTokens: 16_000 }, enabled: true },
    skills: [{ id: 'evidence', description: 'Use when reading evidence.', body: 'Read the requested evidence and cite exact source locations.' }],
    budget: { known: true, targetTokens: 10_000, elasticTokens: 16_000, headroomTokens: 1024, diagnostics: [] },
    model: { ...ROUTE }, createdAt: 1, policyVersion: 1,
    scriptRevisions: Object.fromEntries(await Promise.all([projectHelper, csvHelper].map(async path => [path, createHash('sha256').update(await readFile(new URL(`../${path}`, import.meta.url))).digest('hex')]))),
    ...patch,
  };
}
async function fixture(definition) {
  const h = await createNativeHarness();
  await h.ctx.plugin(TokenMeter);
  await h.ctx.plugin(SkillRegistry);
  let bodies = 0;
  for (const name of ['read', 'write', 'bash', 'subagent']) h.ctx.tools.register(defineTool({
    name, description: name, parameters: {}, output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute() { bodies++; return 'fixture result'; },
  }));
  let fiber;
  let handle;
  const start = async () => {
    handle = await h.ctx.agents.create({ sessionId: `role-agent-${serial}`, meta: { cwd: h.storageRoot },
      agentOptions: { ...ROUTE, reasoningEffort: 'low' },
      setup: async agentCtx => {
        fiber = agentCtx.plugin(Role, { snapshot: definition });
        await fiber;
      },
    });
    return handle.agent;
  };
  const call = async (name, args = {}, signal = new AbortController().signal) => {
    const result = await h.ctx.tools.execute({ calls: [{ type: 'tool-call', id: `role-call-${++serial}`, name, arguments: JSON.stringify(args) }], agent: handle.agent, signal });
    return result.results[0].result;
  };
  return { h, start, call, get agent() { return handle?.agent; }, get fiber() { return fiber; }, get bodies() { return bodies; },
    async close() { try { await handle?.dispose(); } finally { await h.close(); } } };
}
const text = result => result.content.map(block => block.type === 'text' ? block.text : '').join('\n');

test('role masks global tools, denies new scoped tools, preserves siblings and releases both owners', async () => {
  const f = await fixture(await snapshot());
  try {
    const agent = await f.start();
    assert.equal(agent.model.current().reasoningEffort, undefined, 'model-default clears inherited effort');
    assert.ok(f.h.ctx.tools.get('read', agent));
    for (const name of ['write', 'bash', 'subagent']) assert.equal(f.h.ctx.tools.get(name, agent), undefined);
    assert.ok(f.h.ctx.tools.get('bash', f.h.parent), 'sibling remains unrestricted');
    assert.equal((await f.call('read')).isError, false);
    const before = f.bodies;
    agent.ctx.tools.register(defineTool({ name: 'late_shell', description: 'late fixture tool', parameters: {},
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute() { throw new Error('disallowed body must not execute'); } }));
    const rejected = await f.call('late_shell');
    assert.equal(rejected.isError, true);
    assert.match(text(rejected), /does not permit tool late_shell/);
    assert.equal(f.bodies, before);
    await f.fiber.dispose();
    assert.ok(f.h.ctx.tools.get('bash', agent), 'plugin unload releases Agent-owned mask');
    assert.equal(f.h.ctx.tools.get('agentdeck_skill', agent), undefined);
    assert.equal((await agent.ctx.get('skills').list({ scope: agent })).length, 0);
  } finally { await f.close(); }
});

test('native scoped skill loader preserves snapshot content and complete workspace instructions', async t => {
  const definition = await snapshot();
  definition.role.instructions += ' Preserve {{literal-template-text}} exactly.';
  const f = await fixture(definition);
  try {
    await writeFile(join(f.h.storageRoot, 'AGENTS.md'), 'Keep fixture evidence attributable.\n');
    const agent = await f.start();
    definition.skills[0].body = 'Concurrent replacement must not enter the running task.';
    const loaded = await f.call('agentdeck_skill', { id: 'evidence' });
    assert.equal(loaded.isError, false, text(loaded));
    assert.match(loaded.value, /cite exact source locations/);
    assert.doesNotMatch(loaded.value, /Concurrent replacement/);
    assert.equal((await f.call('agentdeck_skill', { id: 'unlisted' })).isError, true);
    const signal = new AbortController().signal;
    const base = await f.h.ctx.systemPrompt.assemble({ scope: f.h.parent, agent: f.h.parent, signal });
    const assembly = await agent.ctx.systemPrompt.assemble({ scope: agent, agent, modelSelection: agent.model.current(), signal });
    const prompt = renderPrompt(assembly);
    assert.match(prompt, /Keep fixture evidence attributable/);
    assert.match(prompt, /Preserve \{\{literal-template-text\}\} exactly/);
    assert.match(prompt, /evidence: Use when reading evidence/);
    assert.doesNotMatch(prompt, /Read the requested evidence and cite exact source locations/);
    const meter = agent.ctx.get('tokenMeter');
    const estimate = (subject, value) => meter.measure(subject.session, { config: ROUTE, tools: value.tools }).totalTokens + meter.estimateMessage(createSystemMessage(renderPrompt(value)));
    t.diagnostic(`Native first-request input estimate before role helpers: ${estimate(f.h.parent, base)}; after helpers/catalog/instructions: ${estimate(agent, assembly)} tokens (heuristic; no efficiency claim).`);
  } finally { await f.close(); }
});

test('role snapshot rejects another native model route before any child request', async () => {
  const f = await fixture(await snapshot(['files-read'], { model: { provider: ROUTE.provider, model: 'allowed' } }));
  try {
    await assert.rejects(f.start(), /snapshot model route differs/);
    assert.equal(f.h.adapter.requests.length, 0);
  } finally { await f.close(); }
});

test('same-route snapshot effort is validated by the native adapter before publication', async () => {
  const f = await fixture(await snapshot(['files-read'], { model: { ...ROUTE, reasoningEffort: 'unsupported' } }));
  try {
    await assert.rejects(f.start(), /unsupported|reasoning effort/i);
    assert.equal(f.h.adapter.requests.length, 0);
  } finally { await f.close(); }
});

test('oversized instructions and irreparable pending material fail before model dispatch', async () => {
  const definition = await snapshot();
  definition.budget.elasticTokens = 400;
  definition.role.instructions = 'Large fixed instruction. '.repeat(1000);
  const oversized = await fixture(definition);
  try { await assert.rejects(oversized.start(), /fixed instructions need approximately/); }
  finally { await oversized.close(); }
  const f = await fixture(await snapshot());
  try {
    const agent = await f.start();
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'x'.repeat(120_000) }], source: { kind: 'user' } }));
    await bounded(agent.whenIdle(), 'role rejected oversized pending material');
    assert.equal(f.h.adapter.requests.length, 0);
    assert.ok(f.h.events.some(({ session, event }) => session === agent.session && event.type === 'turn/end' && event.data.reason.kind === 'error' && /total ceiling/.test(event.data.reason.error.message)));
  } finally { await f.close(); }
});

test('reader has no runner/evaluator, and attachment reads require this Session’s admitted reference', async () => {
  const f = await fixture(await snapshot());
  try {
    const agent = await f.start();
    assert.equal(f.h.ctx.tools.get('agentdeck_run_project_script', agent), undefined);
    assert.equal(f.h.ctx.tools.get('agentdeck_parse_data', agent), undefined);
    const result = await f.call('agentdeck_read_attachment', { attachment_id: 'unowned-reference' });
    assert.equal(result.isError, true);
    assert.match(text(result), /not present in this Agent/);
  } finally { await f.close(); }
});

test('pinned helper lists/runs only existing checks, rejects downloads and reports missing revisions', async () => {
  const f = await fixture(await snapshot(['files-read', 'project-runner']));
  try {
    await f.h.ctx.plugin(LocalSubprocess);
    await writeFile(join(f.h.storageRoot, 'package.json'), JSON.stringify({ scripts: { test: 'node -e "console.log(12345)"', deploy: 'echo forbidden', 'check:install': 'npm install' } }));
    await f.start();
    const listing = await f.call('agentdeck_run_project_script');
    assert.equal(listing.isError, false, text(listing));
    assert.deepEqual(listing.value.available, ['test', 'check:install']);
    assert.equal((await f.call('agentdeck_run_project_script', { script: 'deploy' })).isError, true);
    const run = await f.call('agentdeck_run_project_script', { script: 'test' });
    assert.equal(run.isError, false, text(run));
    assert.equal(run.value.exitCode, 0);
    assert.match(run.value.stdout, /12345/);
    const refused = await f.call('agentdeck_run_project_script', { script: 'check:install' });
    assert.equal(refused.value.exitCode, 1);
    assert.match(refused.value.stderr, /Refusing dependency installation/);
  } finally { await f.close(); }
  const changed = await snapshot(['files-read', 'project-runner']);
  changed.scriptRevisions[projectHelper] = '0'.repeat(64);
  const invalid = await fixture(changed);
  try {
    await invalid.start();
    const result = await invalid.call('agentdeck_run_project_script');
    assert.equal(result.isError, true);
    assert.match(text(result), /Helper revision changed/);
  } finally { await invalid.close(); }
});

test('missing native subprocess and missing pinned revisions are reported without executing a check', async () => {
  const f = await fixture(await snapshot(['files-read', 'project-runner']));
  try {
    await writeFile(join(f.h.storageRoot, 'package.json'), JSON.stringify({ scripts: { test: 'node -e "console.log(1)"' } }));
    await f.start();
    const unavailable = await f.call('agentdeck_run_project_script', { script: 'test' });
    assert.equal(unavailable.isError, true);
    assert.match(text(unavailable), /native subprocess service is not mounted/);
  } finally { await f.close(); }
  const definition = await snapshot(['files-read', 'project-runner']);
  delete definition.scriptRevisions;
  const unpinned = await fixture(definition);
  try {
    await unpinned.start();
    const result = await unpinned.call('agentdeck_run_project_script');
    assert.equal(result.isError, true);
    assert.match(text(result), /Pinned revision is unavailable/);
  } finally { await unpinned.close(); }
});

test('project helper cancellation drains the real native subprocess', async () => {
  const f = await fixture(await snapshot(['files-read', 'project-runner']));
  try {
    await f.h.ctx.plugin(LocalSubprocess);
    await writeFile(join(f.h.storageRoot, 'package.json'), JSON.stringify({ scripts: { test: 'node -e "setTimeout(()=>{},60000)"' } }));
    const agent = await f.start();
    const runtime = agent.ctx.get('subprocess');
    const original = runtime.spawn;
    const started = deferred();
    runtime.spawn = function(spec) { const handle = original.call(this, spec); started.resolve(handle); return handle; };
    try {
      const controller = new AbortController();
      const running = f.call('agentdeck_run_project_script', { script: 'test' }, controller.signal);
      const handle = await bounded(started.promise, 'real helper subprocess start');
      controller.abort();
      const result = await bounded(running, 'native helper cancellation drains', 12_000);
      assert.equal(result.isError, true);
      await handle.done;
      assert.equal(await handle.waitForExit(), true);
    } finally { runtime.spawn = original; }
  } finally { await f.close(); }
});

test('data helper provides bounded numeric summaries without raw samples', async () => {
  const f = await fixture(await snapshot(['files-read', 'project-runner', 'data-query']));
  try {
    await f.h.ctx.plugin(LocalSubprocess);
    await writeFile(join(f.h.storageRoot, 'data.json'), JSON.stringify([{ amount: 3, secret: 'private-value' }, { amount: 7 }]));
    await writeFile(join(f.h.storageRoot, 'data.csv'), 'amount,label\n3,A\n7,B\n');
    await f.start();
    const json = await f.call('agentdeck_parse_data', { path: 'data.json', format: 'json', max_rows: 1 });
    assert.equal(json.isError, false, text(json));
    assert.equal(json.value.truncated, true);
    assert.equal(json.value.columns[0].min, 3);
    assert.doesNotMatch(JSON.stringify(json.value), /private-value/);
    await writeFile(join(f.h.storageRoot, 'wide.json'), JSON.stringify([{ ['x'.repeat(129)]: 1 }]));
    const wide = await f.call('agentdeck_parse_data', { path: 'wide.json', format: 'json' });
    assert.equal(wide.isError, true);
    assert.match(text(wide), /column names exceed 128/);
    const csv = await f.call('agentdeck_parse_data', { path: 'data.csv', format: 'csv' });
    assert.equal(csv.isError, false, text(csv));
    assert.equal(csv.value.exitCode, 0);
    assert.equal(JSON.parse(csv.value.stdout).columns[0].mean, 5);
  } finally { await f.close(); }
});

test('admitted long single-line attachment can be reconstructed through the tool cursor', async () => {
  const f = await fixture(await snapshot());
  try {
    const data = ' '.repeat(23998) + JSON.stringify('🌿' + '界🌿'.repeat(20000));
    const ref = { attachmentId: 'owned', name: 'long.json', bytes: Buffer.byteLength(data) };
    f.h.ctx.provide('attachments', { async *readFileStream() { yield Buffer.from(data); } });
    const agent = await f.start();
    agent.session.deriveMessages = () => [{ content: [{ type: 'file', attachment: ref }] }];
    let cursor = {};
    let reconstructed = '';
    do {
      const page = await f.call('agentdeck_read_attachment', { attachment_id: ref.attachmentId, ...cursor });
      assert.equal(page.isError, false, text(page));
      assert.ok(page.value.text.length <= 24000);
      assert.ok(page.value.text.isWellFormed(), 'each rendered attachment page contains complete Unicode characters');
      reconstructed += page.value.text;
      cursor = page.value.next;
    } while (cursor);
    assert.equal(reconstructed, data);
  } finally { await f.close(); }
});
