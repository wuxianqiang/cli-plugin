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

test('specify starts an interactive clarification state', () => {
  const state = initialState('demo', 'Add export');
  assert.deepEqual(state.clarification, {
    status: 'not_started',
    questions: [],
    decisions: []
  });
  transition(state, 'next');
  assert.equal(state.clarification.status, 'in_progress');
});

test('clarification records the user decision without completing specify', () => {
  const state = initialState('demo', 'Add export');
  transition(state, 'next');
  state.currentAction = { id: 'action_1' };

  transition(state, 'clarify', {
    questionId: 'question_1',
    question: 'How should large exports work?',
    choices: ['A: sync', 'B: async', 'C: custom'],
    choice: 'B',
    answer: 'Use asynchronous export.'
  });

  assert.equal(state.stages.specify.status, 'running');
  assert.equal(state.clarification.decisions.length, 1);
  assert.deepEqual(state.clarification.decisions[0], {
    questionId: 'question_1',
    choice: 'B',
    answer: 'Use asynchronous export.'
  });
  assert.equal(state.clarification.questions[0].status, 'resolved');
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

test('specify action exposes a CLI-generated clarification record command', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-workflow-'));
  const engine = new WorkflowEngine(new WorkflowStore(root));

  await engine.run({ command: 'init', name: 'demo', request: 'Add export' });
  const action = await engine.run({ command: 'next', id: 'demo' });

  assert.equal(action.clarification.enabled, true);
  assert.equal(
    action.clarification.recordCommand,
    'dev-workflow clarify --id demo --question-id "<question-id>" --question "<question>" --choice "<choice>" --answer "<user-answer>"'
  );
  assert.deepEqual(action.input.clarification.decisions, []);
});

test('clarify command persists a decision and returns the next command', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-workflow-'));
  const engine = new WorkflowEngine(new WorkflowStore(root));

  await engine.run({ command: 'init', name: 'demo', request: 'Add export' });
  await engine.run({ command: 'next', id: 'demo' });

  const result = await engine.run({
    command: 'clarify',
    id: 'demo',
    'question-id': 'question_1',
    question: 'Export mode?',
    choices: 'A: sync|B: async|C: custom',
    choice: 'B',
    answer: 'async'
  });

  assert.equal(result.type, 'workflow.clarification.accepted');
  assert.equal(result.decision.choice, 'B');
  assert.equal(result.next.command, 'dev-workflow next --id demo');

  const state = await engine.run({ command: 'status', id: 'demo' });
  assert.equal(state.clarification.decisions[0].answer, 'async');
});

test('workflow action declares direct execution for lightweight skills', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-workflow-'));
  const engine = new WorkflowEngine(new WorkflowStore(root));

  await engine.run({ command: 'init', name: 'demo', request: 'Add Modal' });
  const action = await engine.run({ command: 'next', id: 'demo' });

  assert.equal(action.execution.mode, 'direct');
  assert.equal(action.execution.strategy, 'single');
  assert.equal(action.execution.agent, null);
});

test('workflow action declares subagent execution for context-heavy skills', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-workflow-'));
  const engine = new WorkflowEngine(new WorkflowStore(root));

  await engine.run({ command: 'init', name: 'demo', request: 'Add Modal' });
  const state = await engine.run({ command: 'status', id: 'demo' });
  state.currentStage = 'implement';
  state.stages.specify.status = 'completed';
  state.stages.design.status = 'completed';
  state.stages.tasks.status = 'completed';
  state.stages.implement.status = 'ready';
  engine.store.writeState(state);

  const action = await engine.run({ command: 'next', id: 'demo' });

  assert.equal(action.execution.mode, 'subagent');
  assert.equal(action.execution.strategy, 'single');
  assert.equal(action.execution.agent.name, 'implement-agent');
});

test('review action declares parallel subagent execution', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-workflow-'));
  const engine = new WorkflowEngine(new WorkflowStore(root));

  await engine.run({ command: 'init', name: 'demo', request: 'Review Modal' });
  const state = await engine.run({ command: 'status', id: 'demo' });
  state.currentStage = 'review';
  for (const stage of ['specify', 'design', 'tasks', 'implement']) {
    state.stages[stage].status = 'completed';
  }
  state.stages.review.status = 'ready';
  engine.store.writeState(state);

  const action = await engine.run({ command: 'next', id: 'demo' });

  assert.equal(action.execution.mode, 'subagent');
  assert.equal(action.execution.strategy, 'parallel');
  assert.deepEqual(action.execution.agents, [
    'security-review',
    'performance-review',
    'architecture-review',
    'stability-review'
  ]);
});
