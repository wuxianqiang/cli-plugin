#!/usr/bin/env node
'use strict';

const { WorkflowStore } = require('../src/workflow-store');
const { WorkflowEngine } = require('../src/workflow-engine');
const { parseArgs } = require('../src/args');

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const store = new WorkflowStore(process.cwd());
  const engine = new WorkflowEngine(store);
  const result = await engine.run(args);
  const output = args.json ? JSON.stringify(result, null, 2) : engine.format(result);
  process.stdout.write(output + '\n');
}

main().catch((error) => {
  const payload = { type: 'workflow.error', error: { code: error.code || 'INTERNAL_ERROR', message: error.message } };
  process.stderr.write(JSON.stringify(payload, null, 2) + '\n');
  process.exitCode = 1;
});
