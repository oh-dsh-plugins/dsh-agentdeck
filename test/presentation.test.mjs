import assert from 'node:assert/strict';
import test from 'node:test';
import { loadBuiltinAgents, agentRevision } from '../lib/core/index.js';
import { rolePresentation } from '../lib/core/presentation.js';
test('presentation translates factory contracts without changing canonical definitions', () => {
  for (const role of loadBuiltinAgents()) {
    const before = JSON.stringify(role); const revision = agentRevision(role); const display = rolePresentation(role);
    assert.deepEqual(display.inputs.map(value => value.en), role.inputs);
    assert.deepEqual(display.deliverables.map(value => value.en), role.deliverables);
    assert.ok(display.inputs.every(value => value.zh && value.zh !== value.en));
    assert.ok(display.deliverables.every(value => value.zh && value.zh !== value.en));
    assert.ok(display.skills.every(value => value.title.zh && value.description.zh && value.title.zh !== value.title.en));
    assert.equal(JSON.stringify(role), before); assert.equal(agentRevision(role), revision);
  }
  const role = loadBuiltinAgents()[0];
  assert.deepEqual(rolePresentation({ ...role, inputs: ['My authored text'] }).inputs, [{ en: 'My authored text', zh: 'My authored text' }]);
});
