#!/usr/bin/env node
'use strict';

const { execFile, spawn } = require('node:child_process');
const { WorkflowStore } = require('../src/workflow-store');
const { WorkflowEngine } = require('../src/workflow-engine');
const { DocsWebServer } = require('../src/docs-web-server');
const { parseArgs } = require('../src/args');

function openBrowser(url) {
  const platform = process.platform;
  if (platform === 'darwin') return execFile('open', [url]);
  if (platform === 'win32') return execFile('cmd', ['/c', 'start', '', url]);
  return execFile('xdg-open', [url]);
}

function webSessionAlive(session) {
  if (!session?.pid) return false;
  try { process.kill(session.pid, 0); return true; } catch { return false; }
}

function ensureWebWorkspace(workflowId, store) {
  const session = store.readWebSession(workflowId);
  if (webSessionAlive(session)) return { started: false, session };

  if (session) store.clearWebSession(workflowId);
  const child = spawn(process.execPath, [__filename, 'web', '--id', workflowId], {
    cwd: process.cwd(),
    detached: true,
    stdio: 'ignore',
    env: process.env,
  });
  child.unref();
  return { started: true, pid: child.pid };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const store = new WorkflowStore(process.cwd());
  const engine = new WorkflowEngine(store);

  if (args.command === 'web') {
    const workflowId = args.id || args.workflow || args.name;
    if (!workflowId) throw Object.assign(new Error('web requires --id'), { code: 'INVALID_ARGUMENTS' });
    store.read(workflowId);
    const server = new DocsWebServer(store, { port: args.port ? Number(args.port) : 0 });
    const address = await server.start();
    const url = `${address.url}/?workflowId=${encodeURIComponent(workflowId)}`;
    store.writeWebSession(workflowId, { pid: process.pid, url, port: address.port, startedAt: new Date().toISOString() });
    process.stdout.write(`${JSON.stringify({ type: 'workflow.web.started', workflowId, url, port: address.port })}\n`);
    if (!args['no-open']) openBrowser(url).on('error', () => {});
    const shutdown = async () => { store.clearWebSession(workflowId); await server.stop(); process.exit(0); };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
    return;
  }

  const result = await engine.run(args);

  // A stage that finishes successfully enters waiting_approval. Start/reuse
  // the Docs Review workspace as a read-only companion. Workflow decisions
  // are made only by the CLI / Claude conversation via AskUserQuestion.
  if (result.type === 'workflow.result.accepted' && result.status === 'waiting_approval') {
    const web = ensureWebWorkspace(result.workflowId, store);
    result.web = { started: web.started, url: web.session?.url || null };
  }

  const output = args.json ? JSON.stringify(result, null, 2) : engine.format(result);
  process.stdout.write(output + '\n');
}

main().catch((error) => {
  const payload = { type: 'workflow.error', error: { code: error.code || 'INTERNAL_ERROR', message: error.message } };
  process.stderr.write(JSON.stringify(payload, null, 2) + '\n');
  process.exitCode = 1;
});
