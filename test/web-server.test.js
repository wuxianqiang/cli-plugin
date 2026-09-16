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

test('web server exposes workflow state and annotations', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-workflow-'));
  const store = new WorkflowStore(root);
  const state = initialState('web-test', 'add modal');
  store.create(state);
  const engine = new WorkflowEngine(store);
  const server = new WorkflowWebServer(store, engine, { port: 0 });
  const address = await server.start();
  try {
    const stateResponse = await fetch(`${address.url}/api/workflows/web-test`);
    assert.equal(stateResponse.status, 200);
    assert.equal((await stateResponse.json()).currentStage, 'specify');

    const annotationResponse = await fetch(`${address.url}/api/workflows/web-test/annotations`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'custom', content: '补充移动端场景', target: { quote: 'modal' } })
    });
    assert.equal(annotationResponse.status, 201);
    assert.equal((await annotationResponse.json()).content, '补充移动端场景');

    const annotations = await fetch(`${address.url}/api/workflows/web-test/annotations`).then(r => r.json());
    assert.equal(annotations.length, 1);
  } finally {
    await server.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('browser approval changes shared state so wait can resume', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-workflow-wait-'));
  const store = new WorkflowStore(root);
  const state = initialState('wait-test', 'add modal');
  store.create(state);
  const engine = new WorkflowEngine(store);
  const server = new WorkflowWebServer(store, engine, { port: 0 });
  const address = await server.start();

  try {
    const action = await engine.run({ command: 'next', id: 'wait-test' });
    fs.mkdirSync(path.join(root, '.dev/workflows/wait-test/artifacts'), { recursive: true });
    fs.writeFileSync(path.join(root, '.dev/workflows/wait-test/artifacts/specify.md'), '# Specify');
    await engine.run({ command: 'result', id: 'wait-test', action: action.id, status: 'success', artifact: '.dev/workflows/wait-test/artifacts/specify.md' });

    const waiting = engine.run({ command: 'wait', id: 'wait-test', timeout: 3000, interval: 20 });
    await new Promise(resolve => setTimeout(resolve, 50));

    const response = await fetch(`${address.url}/api/workflows/wait-test/decisions`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'approve', stage: 'specify' })
    });
    assert.equal(response.status, 201);

    const resumed = await waiting;
    assert.equal(resumed.type, 'workflow.wait.completed');
    assert.equal(resumed.currentStage, 'design');
    assert.equal(resumed.stageStatus, 'ready');
  } finally {
    await server.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
