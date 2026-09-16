#!/usr/bin/env node
'use strict';

const { execFile } = require('node:child_process');
const { WorkflowStore } = require('../src/workflow-store');
const { WorkflowEngine } = require('../src/workflow-engine');
const { WorkflowWebServer } = require('../src/web-server');
const { parseArgs } = require('../src/args');

function openBrowser(url) {
  const platform = process.platform;
  if (platform === 'darwin') return execFile('open', [url]);
  if (platform === 'win32') return execFile('cmd', ['/c', 'start', '', url]);
  return execFile('xdg-open', [url]);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const store = new WorkflowStore(process.cwd());
  const engine = new WorkflowEngine(store);

  if (args.command === 'web') {
    const workflowId = args.id || args.workflow || args.name;
    if (!workflowId) throw Object.assign(new Error('web requires --id'), { code: 'INVALID_ARGUMENTS' });
    store.read(workflowId);
    const server = new WorkflowWebServer(store, engine, { port: args.port ? Number(args.port) : 0 });
    const address = await server.start();
    const url = `${address.url}/?workflowId=${encodeURIComponent(workflowId)}`;
    process.stdout.write(`${JSON.stringify({ type: 'workflow.web.started', workflowId, url, port: address.port })}\n`);
    if (!args['no-open']) openBrowser(url).on('error', () => {});
    const shutdown = async () => { await server.stop(); process.exit(0); };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
    return;
  }

  const result = await engine.run(args);
  const output = args.json ? JSON.stringify(result, null, 2) : engine.format(result);
  process.stdout.write(output + '\n');
}

main().catch((error) => {
  const payload = { type: 'workflow.error', error: { code: error.code || 'INTERNAL_ERROR', message: error.message } };
  process.stderr.write(JSON.stringify(payload, null, 2) + '\n');
  process.exitCode = 1;
});
