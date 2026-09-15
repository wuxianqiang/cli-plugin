const test = require('node:test');
const assert = require('node:assert/strict');
const { initialState, transition } = require('../src/workflow');

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
