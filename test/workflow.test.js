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
    stage: 'specify',
    choice: 'B',
    answer: 'Use asynchronous export.'
  });
  assert.equal(state.clarification.questions[0].status, 'resolved');
});

test('design can record an unresolved technical decision and remain in the same running action', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-workflow-'));
  const engine = new WorkflowEngine(new WorkflowStore(root));

  await engine.run({ command: 'init', name: 'demo', request: 'Add export' });
  const state = await engine.run({ command: 'status', id: 'demo' });
  state.currentStage = 'design';
  state.stages.specify.status = 'completed';
  state.stages.design.status = 'ready';
  engine.store.writeState(state);

  const action = await engine.run({ command: 'next', id: 'demo' });
  assert.equal(action.stage, 'design');
  assert.equal(action.clarification.enabled, true);

  const clarification = await engine.run({
    command: 'clarify',
    id: 'demo',
    'question-id': 'design_question_1',
    question: 'Which export architecture should be used?',
    choices: 'A: async job|B: sync response|C: custom',
    choice: 'A',
    answer: 'Use an asynchronous job.'
  });

  assert.equal(clarification.type, 'workflow.clarification.accepted');
  const resumed = await engine.run({ command: 'next', id: 'demo' });
  assert.equal(resumed.type, 'workflow.action');
  assert.equal(resumed.id, action.id);
  assert.equal(resumed.stage, 'design');
  assert.equal(resumed.input.clarification.decisions.at(-1).stage, 'design');
  assert.equal(resumed.input.clarification.decisions.at(-1).choice, 'A');
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

  assert.equal(result.status, 'publishing');
  assert.equal(result.next.command, 'dev-workflow next --id demo');

  const publish = await engine.run({ command: 'publish', id: 'demo', 'document-id': 'doxcn_v1', url: 'https://feishu.cn/docx/doxcn_v1' });
  assert.equal(publish.type, 'workflow.published');
  assert.equal(publish.publication.version, 1);

  const approval = await engine.run({ command: 'next', id: 'demo' });
  assert.equal(approval.type, 'workflow.approval_required');
  assert.equal(approval.actions.approve.command, 'dev-workflow approve --id demo');
  assert.equal(approval.actions.revise.command, 'dev-workflow revise --id demo --feedback "..."');
});

test('specify and design actions expose a CLI-generated clarification record command', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-workflow-'));
  const engine = new WorkflowEngine(new WorkflowStore(root));

  await engine.run({ command: 'init', name: 'demo', request: 'Add export' });
  const specifyAction = await engine.run({ command: 'next', id: 'demo' });

  assert.equal(specifyAction.clarification.enabled, true);
  assert.equal(
    specifyAction.clarification.recordCommand,
    'dev-workflow clarify --id demo --question-id "<question-id>" --question "<question>" --choice "<choice>" --answer "<user-answer>"'
  );

  await engine.run({ command: 'result', id: 'demo', action: specifyAction.id, status: 'success', artifact: 'specify.md' });
  await engine.run({ command: 'approve', id: 'demo' });
  const designAction = await engine.run({ command: 'next', id: 'demo' });

  assert.equal(designAction.clarification.enabled, true);
  assert.equal(designAction.clarification.recordCommand, specifyAction.clarification.recordCommand);
});

test('clarify command persists a decision and returns the next command', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-workflow-'));
  const engine = new WorkflowEngine(new WorkflowStore(root));

  await engine.run({ command: 'init', name: 'demo', request: 'Add export' });
  const action = await engine.run({ command: 'next', id: 'demo' });

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

  const resumed = await engine.run({ command: 'next', id: 'demo' });
  assert.equal(resumed.type, 'workflow.action');
  assert.equal(resumed.id, action.id);
  assert.equal(resumed.input.clarification.decisions[0].answer, 'async');
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


test('successful artifact must be published as an immutable Feishu document before approval', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-workflow-'));
  const engine = new WorkflowEngine(new WorkflowStore(root));
  await engine.run({ command: 'init', name: 'demo', request: 'Add Modal' });
  const action = await engine.run({ command: 'next', id: 'demo' });
  await engine.run({ command: 'result', id: 'demo', action: action.id, status: 'success', artifact: '.dev/workflows/demo/artifacts/specify.md' });

  const publish1 = await engine.run({ command: 'publish', id: 'demo', 'document-id': 'doc_v1', url: 'https://feishu.cn/docx/doc_v1' });
  assert.equal(publish1.publication.version, 1);

  const approval = await engine.run({ command: 'next', id: 'demo' });
  assert.equal(approval.type, 'workflow.approval_required');
  assert.equal(approval.actions.commentReview.command, 'dev-workflow comment-review --id demo');

  const state = await engine.run({ command: 'status', id: 'demo' });
  assert.equal(state.stages.specify.publication.versions.length, 1);
  assert.equal(state.stages.specify.publication.versions[0].documentId, 'doc_v1');
});

test('Feishu comment review creates a new artifact publication version', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-workflow-'));
  const engine = new WorkflowEngine(new WorkflowStore(root));
  await engine.run({ command: 'init', name: 'demo', request: 'Add Modal' });
  const action1 = await engine.run({ command: 'next', id: 'demo' });
  await engine.run({ command: 'result', id: 'demo', action: action1.id, status: 'success', artifact: '.dev/workflows/demo/artifacts/specify.md' });
  await engine.run({ command: 'publish', id: 'demo', 'document-id': 'doc_v1', url: 'https://feishu.cn/docx/doc_v1' });

  const approval = await engine.run({ command: 'next', id: 'demo' });
  assert.equal(approval.type, 'workflow.approval_required');

  const review = await engine.run({ command: 'comment-review', id: 'demo' });
  assert.equal(review.type, 'workflow.comment_review_requested');

  const action2 = await engine.run({ command: 'next', id: 'demo' });
  assert.equal(action2.stage, 'specify');
  assert.equal(action2.review.mode, 'feishu_comments');
  assert.equal(action2.review.document.documentId, 'doc_v1');

  await engine.run({ command: 'result', id: 'demo', action: action2.id, status: 'success', artifact: '.dev/workflows/demo/artifacts/specify.md' });
  await engine.run({ command: 'publish', id: 'demo', 'document-id': 'doc_v2', url: 'https://feishu.cn/docx/doc_v2' });

  const state = await engine.run({ command: 'status', id: 'demo' });
  assert.equal(state.stages.specify.publication.currentVersion, 2);
  assert.deepEqual(state.stages.specify.publication.versions.map(v => v.documentId), ['doc_v1', 'doc_v2']);
  assert.equal(state.stages.specify.publication.versions[1].basedOnVersion, 1);
});
