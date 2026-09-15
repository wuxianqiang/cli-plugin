'use strict';
const { randomUUID } = require('node:crypto');
const { initialState, transition, STAGES } = require('./workflow');

class WorkflowEngine {
  constructor(store) { this.store = store; }
  async run(args) {
    switch (args.command) {
      case 'init': return this.init(args);
      case 'next': return this.next(args);
      case 'result': return this.result(args);
      case 'status': return this.status(args);
      case 'approve': return this.change(args, 'approve');
      case 'revise': return this.change(args, 'revise', { feedback: args.feedback });
      case 'retry': return this.change(args, 'retry');
      case 'resume': return this.resume(args);
      default: return { type: 'workflow.help', commands: ['init','next','result','status','approve','revise','retry','resume'] };
    }
  }
  id(args) { return args.id || args.workflow || args.name; }
  init(args) {
    if (!args.name || !args.request) throw Object.assign(new Error('init requires --name and --request'), { code: 'INVALID_ARGUMENTS' });
    const state = initialState(args.name, args.request); this.store.create(state);
    return { type: 'workflow.created', workflowId: state.workflowId, status: state.status, currentStage: state.currentStage };
  }
  load(args) { const id = this.id(args); if (!id) throw Object.assign(new Error('Missing --id'), { code: 'INVALID_ARGUMENTS' }); return this.store.read(id); }
  next(args) {
    const state = this.load(args);
    if (state.status === 'completed') return { type: 'workflow.completed', workflowId: state.workflowId };
    const stage = state.currentStage; const current = state.stages[stage];
    if (current.status !== 'ready') return { type: 'workflow.state', workflowId: state.workflowId, stage, status: current.status, next: current.status === 'waiting_approval' ? 'approve' : current.status === 'failed' ? 'retry' : null };
    transition(state, 'next');
    const action = { type: 'workflow.action', id: `action_${randomUUID()}`, workflowId: state.workflowId, stage, action: 'execute_skill', skill: { name: stage }, input: { request: state.request, artifacts: state.artifacts, feedback: current.feedback }, expectedOutput: { artifact: `.dev/workflows/${state.workflowId}/artifacts/${stage}.md` }, completion: { command: `dev-workflow result --id ${state.workflowId} --action ACTION_ID --status success --artifact .dev/workflows/${state.workflowId}/artifacts/${stage}.md` } };
    state.currentAction = { id: action.id, stage, attempt: current.attempt }; this.store.writeState(state); this.store.appendHistory({ type: 'workflow.action', workflowId: state.workflowId, actionId: action.id, stage });
    return action;
  }
  result(args) {
    const state = this.load(args); if (!args.action || !args.status) throw Object.assign(new Error('result requires --action and --status'), { code: 'INVALID_ARGUMENTS' });
    const artifacts = args.artifact ? [{ path: args.artifact }] : [];
    transition(state, 'result', { actionId: args.action, status: args.status, artifacts });
    this.store.writeState(state); this.store.appendHistory({ type: 'workflow.result', workflowId: state.workflowId, actionId: args.action, stage: state.currentStage, status: args.status, artifacts });
    return { type: 'workflow.result.accepted', workflowId: state.workflowId, stage: state.currentStage, status: state.stages[state.currentStage].status, artifacts, next: state.stages[state.currentStage].status === 'waiting_approval' ? { action: 'approve' } : { action: 'retry' } };
  }
  status(args) { const state = this.load(args); return { type: 'workflow.status', ...state }; }
  change(args, event, payload = {}) { const state = this.load(args); transition(state, event, payload); this.store.writeState(state); this.store.appendHistory({ type: `workflow.${event}`, workflowId: state.workflowId, stage: state.currentStage, ...payload }); return { type: 'workflow.transition', workflowId: state.workflowId, event, currentStage: state.currentStage, status: state.status === 'completed' ? 'completed' : state.stages[state.currentStage].status }; }
  resume(args) { const state = this.load(args); return { type: 'workflow.resumed', workflowId: state.workflowId, currentStage: state.currentStage, status: state.stages[state.currentStage].status, next: 'dev-workflow next' }; }
  format(result) {
    if (result.type === 'workflow.action') return `[NEXT ACTION]\n\nStage: ${result.stage}\nAction: execute ${result.skill.name} skill\nInput: ${JSON.stringify(result.input)}\nOutput: ${result.expectedOutput.artifact}\n\n${result.completion.command.replace('ACTION_ID', result.id)}`;
    if (result.type === 'workflow.status') return `Workflow: ${result.workflowId}\nStatus: ${result.status}\nCurrent stage: ${result.currentStage}\n` + STAGES.map(s => `  ${s.padEnd(10)} ${result.stages[s].status}`).join('\n');
    return JSON.stringify(result, null, 2);
  }
}
module.exports = { WorkflowEngine };
