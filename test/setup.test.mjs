import assert from 'node:assert/strict';
import test from 'node:test';
import { loadBuiltinAgents } from '../lib/core/index.js';
import { suggestRole, SuggestionError } from '../lib/host/suggestions.js';

const base = loadBuiltinAgents().find(role => role.id === 'reader');
const generator = { provider: 'p', model: 'generator' };
const route = { provider: 'q', model: 'execution' };
const fixed = { model: { mode: 'fixed', ...route }, reasoning: { mode: 'model-default' }, reason: 'Use the explicitly chosen route; performance is unverified.' };
const candidate = (id = 'primary') => ({ id, purpose: 'Read bounded sources.', ...route, reasoning: { mode: 'model-default' } });
const auto = { model: { mode: 'auto', candidates: [candidate()], defaultCandidate: 'primary' }, reasoning: { mode: 'model-default' }, reason: 'The primary candidate handles source reading.' };
function fixture(options = {}) {
  const calls = [];
  const llm = {
    listProviders() { if (options.providerFailure) throw new Error('Provider directory offline'); return [{ id: 'p' }, { id: 'q' }]; },
    async listModels(provider) { if (options.listFailure) throw new Error('Directory offline'); return [{ provider, id: provider === 'p' ? 'generator' : 'execution', name: provider }]; },
    resolveModelInfo() { throw new Error('Optional metadata must not gate generation'); },
    async *stream(request) {
      calls.push(request);
      if (options.wait) { await options.wait; request.signal.throwIfAborted(); }
      if (options.error) throw new Error(options.error);
      yield { type: 'text-delta', text: options.raw ?? JSON.stringify(options.reply ?? fixed) };
      if (!options.noFinish) yield { type: 'finish', reason: options.finish ?? { kind: 'stop' } };
    },
  };
  return { calls, ctx: { get: name => name === 'llm' ? llm : undefined }, llm };
}
function request(model = fixed.model, patch = {}) {
  return { version: 1, id: base.id, definition: { ...base, model, reasoning: { mode: 'model-default' } }, generator, revision: 'reader-r1', requirements: 'Use configured routes.', ...patch };
}
const signal = () => new AbortController().signal;

test('fixed suggestion uses the owner generator without Session, metadata or a plugin output cap', async () => {
  const f = fixture();
  const result = await suggestRole(f.ctx, request(), signal());
  assert.deepEqual(result.model, fixed.model);
  assert.equal(result.revision, 'reader-r1');
  assert.deepEqual(result.generator, generator);
  assert.equal(f.calls.length, 1);
  const call = f.calls[0];
  assert.equal(call.provider, generator.provider);
  assert.equal(call.model, generator.model);
  assert.equal(Object.hasOwn(call, 'maxTokens'), false);
  const prompt = JSON.parse(call.messages[0].content[0].text);
  assert.equal(prompt.mode, 'fixed');
  assert.deepEqual(prompt.constraints.fixedRoute, route);
  assert.equal(prompt.constraints.generatorIsExecutionConstraint, false);
  assert.equal(Object.hasOwn(prompt.current, 'context'), false);
});

test('auto suggestion accepts an incomplete editor seed and resource-free candidate purposes', async () => {
  const f = fixture({ reply: auto });
  const result = await suggestRole(f.ctx, request({ mode: 'auto', candidates: [], defaultCandidate: '' }), signal());
  assert.deepEqual(result.model, auto.model);
  assert.equal(Object.hasOwn(result.model.candidates[0], 'maxTokens'), false);
});

test('multiple candidate plan is explicit in the prompt and requires multiple results', async () => {
  const multi = { ...auto, model: { ...auto.model, candidates: [candidate('primary'), candidate('review')] } };
  const f = fixture({ reply: multi });
  const result = await suggestRole(f.ctx, request({ mode: 'auto', candidates: [], defaultCandidate: '' }, { candidatePlan: 'multiple' }), signal());
  assert.equal(result.model.candidates.length, 2);
  const prompt = JSON.parse(f.calls[0].messages[0].content[0].text);
  assert.match(prompt.constraints.candidates, /at least two/);
  await assert.rejects(suggestRole(fixture({ reply: auto }).ctx, request({ mode: 'auto', candidates: [], defaultCandidate: '' }, { candidatePlan: 'multiple' }), signal()), /multiple candidates/);
});

for (const options of [{ listFailure: true }, { providerFailure: true }]) test('directory failure preserves explicit routes and still sends the selected generation request', async () => {
  const f = fixture(options);
  const result = await suggestRole(f.ctx, request(), signal());
  assert.equal(f.calls.length, 1);
  assert.deepEqual(result.model, fixed.model);
  assert.ok(result.diagnostics.length);
});

for (const [options, stage, message] of [
  [{ error: 'HTTP 401 unauthorized' }, 'generation', /401/],
  [{ error: 'HTTP 429 rate limit' }, 'generation', /429/],
  [{ raw: '' }, 'response', /empty/],
  [{ raw: '{incomplete', finish: { kind: 'max-tokens' } }, 'truncated', /incomplete/],
  [{ raw: '{broken' }, 'response', /JSON|property|Expected/],
  [{ noFinish: true }, 'generation', /terminal/],
  [{ finish: { kind: 'error', failure: { message: 'Provider overloaded' } } }, 'generation', /overloaded/],
]) test('suggestion failure retains stage, route and raw response: ' + stage + ' ' + message, async () => {
  const f = fixture(options);
  await assert.rejects(suggestRole(f.ctx, request(), signal()), error => {
    assert.ok(error instanceof SuggestionError);
    assert.equal(error.details.stage, stage);
    assert.equal(error.details.provider, generator.provider);
    assert.equal(error.details.model, generator.model);
    assert.match(error.message, message);
    assert.equal(error.details.rawResponse, options.error ? '' : options.raw ?? JSON.stringify(fixed));
    return true;
  });
});

for (const reply of [
  { ...fixed, model: auto.model },
  { ...fixed, model: { mode: 'fixed', provider: 'other', model: 'invented' } },
  { ...fixed, output: { maxTokens: 1000 } },
  { ...fixed, model: { ...fixed.model, maxTokens: 1000 } },
]) test('generated settings cannot alter mode, explicit route or unrelated fields ' + JSON.stringify(reply), async () => {
  const f = fixture({ reply });
  await assert.rejects(suggestRole(f.ctx, request(), signal()), SuggestionError);
});

test('cancellation aborts generation and never returns an applicable suggestion', async () => {
  let release;
  const f = fixture({ wait: new Promise(resolve => { release = resolve; }) });
  const abort = new AbortController();
  const work = suggestRole(f.ctx, request(), abort.signal);
  while (!f.calls.length) await new Promise(resolve => setImmediate(resolve));
  abort.abort(new Error('Owner cancelled'));
  release();
  await assert.rejects(work, /Owner cancelled/);
  assert.equal(f.calls.length, 1);
});
