'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { WorkflowStore } = require('../src/workflow-store');
const { WorkflowEngine } = require('../src/workflow-engine');
const { WorkflowWebServer } = require('../src/web-server');
const { initialState } = require('../src/workflow');

test('web server exposes workflow state and annotations without workflow controls', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-workflow-'));
  const store = new WorkflowStore(root);
  store.create(initialState('web-test', 'add modal'));
  const engine = new WorkflowEngine(store);
  const server = new WorkflowWebServer(store, engine, { port: 0 });
  const address = await server.start();
  try {
    const stateResponse = await fetch(`${address.url}/api/workflows/web-test`);
    assert.equal(stateResponse.status, 200);
    assert.equal((await stateResponse.json()).currentStage, 'specify');

    const annotationResponse = await fetch(`${address.url}/api/workflows/web-test/annotations`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'custom', content: '补充移动端场景', stage: 'specify', target: { quote: 'modal' } })
    });
    assert.equal(annotationResponse.status, 201);
    assert.equal((await annotationResponse.json()).content, '补充移动端场景');

    const annotations = await fetch(`${address.url}/api/workflows/web-test/annotations`).then(r => r.json());
    assert.equal(annotations.length, 1);

    const decisionResponse = await fetch(`${address.url}/api/workflows/web-test/decisions`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'approve', stage: 'specify' })
    });
    assert.equal(decisionResponse.status, 404);
    assert.equal(store.read('web-test').currentStage, 'specify');
  } finally {
    await server.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('CLI apply-comments transitions waiting approval back to ready and injects open docs comments', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-workflow-comments-'));
  const store = new WorkflowStore(root);
  store.create(initialState('comments-test', 'add modal'));
  const engine = new WorkflowEngine(store);
  const server = new WorkflowWebServer(store, engine, { port: 0 });
  const address = await server.start();

  try {
    const action = await engine.run({ command: 'next', id: 'comments-test' });
    fs.mkdirSync(path.join(root, '.dev/workflows/comments-test/artifacts'), { recursive: true });
    fs.writeFileSync(path.join(root, '.dev/workflows/comments-test/artifacts/specify.md'), '# Specify\nPlease add mobile handling.');
    await engine.run({ command: 'result', id: 'comments-test', action: action.id, status: 'success', artifact: '.dev/workflows/comments-test/artifacts/specify.md' });

    await fetch(`${address.url}/api/workflows/comments-test/annotations`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'change', content: '补充移动端处理', stage: 'specify', target: { quote: 'Please add mobile handling.', start: 10, end: 36 } })
    });

    assert.equal(store.read('comments-test').stages.specify.status, 'waiting_approval');

    const transition = await engine.run({ command: 'apply-comments', id: 'comments-test' });
    assert.equal(transition.type, 'workflow.transition');
    assert.equal(store.read('comments-test').stages.specify.status, 'ready');
    assert.equal(transition.annotations, 1);

    const next = await engine.run({ command: 'next', id: 'comments-test' });
    assert.equal(next.input.annotations.length, 1);
    assert.equal(next.input.annotations[0].content, '补充移动端处理');
    assert.match(next.input.feedback, /Apply the open Docs comments/);
  } finally {
    await server.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('waiting approval exposes CLI commands for AskUserQuestion decisions', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-workflow-approval-'));
  const store = new WorkflowStore(root);
  store.create(initialState('approval-test', 'add modal'));
  const engine = new WorkflowEngine(store);

  try {
    const action = await engine.run({ command: 'next', id: 'approval-test' });
    fs.mkdirSync(path.join(root, '.dev/workflows/approval-test/artifacts'), { recursive: true });
    fs.writeFileSync(path.join(root, '.dev/workflows/approval-test/artifacts/specify.md'), '# Specify');
    await engine.run({ command: 'result', id: 'approval-test', action: action.id, status: 'success', artifact: '.dev/workflows/approval-test/artifacts/specify.md' });

    const approval = await engine.run({ command: 'next', id: 'approval-test' });
    assert.equal(approval.type, 'workflow.approval_required');
    assert.match(approval.actions.approve.command, /dev-workflow approve/);
    assert.match(approval.actions.applyComments.command, /dev-workflow apply-comments/);
    assert.match(approval.actions.revise.command, /dev-workflow revise/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
