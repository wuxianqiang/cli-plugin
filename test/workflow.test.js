const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { initialState, transition } = require('../src/workflow');
const { WorkflowStore } = require('../src/workflow-store');
const { WorkflowEngine } = require('../src/workflow-engine');

test('workflow progresses specify -> design after approval', () => {
  const state = initialState('demo', 'Add Modal');
  assert.equal(state.currentStage, 'specify');
  transition(state, 'next');
  assert.equal(state.stages.specify.status, 'running');
  state.currentAction = { id: 'action_1' };
  transition(state, 'result', { actionId: 'action_1', status: 'success', artifact: 'spec.md' });
  assert.equal(state.stages.specify.status, 'waiting_approval');
  transition(state, 'approve');
  assert.equal(state.currentStage, 'design');
  assert.equal(state.stages.design.status, 'ready');
});

test('failed stage can retry', () => {
  const state = initialState('demo', 'Add Modal');
  transition(state, 'next');
  state.currentAction = { id: 'action_1' };
  transition(state, 'result', { actionId: 'action_1', status: 'failed' });
  assert.equal(state.stages.specify.status, 'failed');
  transition(state, 'retry');
  assert.equal(state.stages.specify.status, 'ready');
});

test('result tells the LLM to call next so the CLI remains the workflow driver', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-workflow-'));
  const store = new WorkflowStore(root);
  const engine = new WorkflowEngine(store);

  await engine.run({ command: 'init', name: 'demo', request: 'Add Modal' });
  const action = await engine.run({ command: 'next', id: 'demo' });
  const result = await engine.run({
    command: 'result',
    id: 'demo',
    action: action.id,
    status: 'success',
    artifact: '.dev/workflows/demo/artifacts/specify.md'
  });

  assert.equal(result.status, 'waiting_approval');
  assert.equal(result.next.command, 'dev-workflow next --id demo');

  const approval = await engine.run({ command: 'next', id: 'demo' });
  assert.equal(approval.type, 'workflow.approval_required');
  assert.equal(approval.actions.approve.command, 'dev-workflow approve --id demo');
  assert.equal(approval.actions.revise.command, 'dev-workflow revise --id demo --feedback "..."');
});
