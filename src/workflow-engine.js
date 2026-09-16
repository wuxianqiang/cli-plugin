'use strict';
const { randomUUID } = require('node:crypto');
const { initialState, transition, STAGES, getExecutionConfig } = require('./workflow');

class WorkflowEngine {
  constructor(store) { this.store = store; }
  async run(args) {
    switch (args.command) {
      case 'init': return this.init(args);
      case 'next': return this.next(args);
      case 'result': return this.result(args);
      case 'clarify': return this.clarify(args);
      case 'status': return this.status(args);
      case 'approve': return this.change(args, 'approve');
      case 'revise': return this.change(args, 'revise', { feedback: args.feedback });
      case 'retry': return this.change(args, 'retry');
      case 'resume': return this.resume(args);
      default: return { type: 'workflow.help', commands: ['init', 'next', 'result', 'clarify', 'status', 'approve', 'revise', 'retry', 'resume'] };
    }
  }
  id(args) { return args.id || args.workflow || args.name; }
  init(args) {
    if (!args.name || !args.request) throw Object.assign(new Error('init requires --name and --request'), { code: 'INVALID_ARGUMENTS' });
    const state = initialState(args.name, args.request);
    this.store.create(state);
    return { type: 'workflow.created', workflowId: state.workflowId, status: state.status, currentStage: state.currentStage };
  }
  load(args) {
    const id = this.id(args);
    if (!id) throw Object.assign(new Error('Missing --id'), { code: 'INVALID_ARGUMENTS' });
    return this.store.read(id);
  }
  next(args) {
    const state = this.load(args);
    if (state.status === 'completed') return { type: 'workflow.completed', workflowId: state.workflowId };

    const stage = state.currentStage;
    const current = state.stages[stage];

    if (current.status === 'waiting_approval') {
      return {
        type: 'workflow.approval_required',
        workflowId: state.workflowId,
        stage,
        status: current.status,
        artifact: current.artifact,
        actions: {
          approve: { command: `dev-workflow approve --id ${state.workflowId}` },
          revise: { command: `dev-workflow revise --id ${state.workflowId} --feedback "<user-feedback>"` }
        }
      };
    }

    if (current.status === 'failed') {
      return {
        type: 'workflow.retry_required',
        workflowId: state.workflowId,
        stage,
        status: current.status,
        actions: {
          retry: { command: `dev-workflow retry --id ${state.workflowId}` }
        }
      };
    }

    if (current.status !== 'ready') {
      return {
        type: 'workflow.state',
        workflowId: state.workflowId,
        stage,
        status: current.status,
        next: null
      };
    }

    transition(state, 'next');
    const execution = getExecutionConfig(stage);
    const actionId = `action_${randomUUID()}`;
    const artifactPath = `.dev/workflows/${state.workflowId}/artifacts/${stage}.md`;
    const action = {
      type: 'workflow.action',
      id: actionId,
      workflowId: state.workflowId,
      stage,
      action: 'execute_skill',
      skill: { name: stage },
      execution,
      input: {
        request: state.request,
        artifacts: state.artifacts,
        feedback: current.feedback,
        clarification: state.clarification
      },
      clarification: stage === 'specify' ? {
        enabled: true,
        recordCommand: `dev-workflow clarify --id ${state.workflowId} --question-id "<question-id>" --question "<question>" --choice "<choice>" --answer "<user-answer>"`
      } : { enabled: false },
      expectedOutput: {
        artifact: artifactPath,
        result: {
          status: 'success | failed',
          artifact: artifactPath
        }
      },
      completion: {
        command: `dev-workflow result --id ${state.workflowId} --action ${actionId} --status success --artifact ${artifactPath}`,
        failureCommand: `dev-workflow result --id ${state.workflowId} --action ${actionId} --status failed`
      }
    };
    state.currentAction = { id: action.id, stage, attempt: current.attempt, execution };
    this.store.writeState(state);
    this.store.appendHistory({ type: 'workflow.action', workflowId: state.workflowId, actionId: action.id, stage, execution });
    return action;
  }
  clarify(args) {
    const state = this.load(args);
    transition(state, 'clarify', {
      questionId: args['question-id'] || args.questionId,
      question: args.question,
      choices: args.choices ? String(args.choices).split('|') : [],
      choice: args.choice,
      answer: args.answer
    });
    this.store.writeState(state);
    this.store.appendHistory({
      type: 'workflow.clarification',
      workflowId: state.workflowId,
      stage: state.currentStage,
      questionId: args['question-id'] || args.questionId,
      choice: args.choice
    });
    return {
      type: 'workflow.clarification.accepted',
      workflowId: state.workflowId,
      stage: state.currentStage,
      decision: state.clarification.decisions.at(-1),
      next: { command: `dev-workflow next --id ${state.workflowId}` }
    };
  }
  result(args) {
    const state = this.load(args);
    if (!args.action || !args.status) throw Object.assign(new Error('result requires --action and --status'), { code: 'INVALID_ARGUMENTS' });
    const artifacts = args.artifact ? [{ path: args.artifact }] : [];
    transition(state, 'result', { actionId: args.action, status: args.status, artifacts });
    this.store.writeState(state);
    this.store.appendHistory({ type: 'workflow.result', workflowId: state.workflowId, actionId: args.action, stage: state.currentStage, status: args.status, artifacts });

    return {
      type: 'workflow.result.accepted',
      workflowId: state.workflowId,
      stage: state.currentStage,
      status: state.stages[state.currentStage].status,
      artifacts,
      next: { command: `dev-workflow next --id ${state.workflowId}` }
    };
  }
  status(args) { const state = this.load(args); return { type: 'workflow.status', ...state }; }
  change(args, event, payload = {}) {
    const state = this.load(args);
    transition(state, event, payload);
    this.store.writeState(state);
    this.store.appendHistory({ type: `workflow.${event}`, workflowId: state.workflowId, stage: state.currentStage, ...payload });
    return { type: 'workflow.transition', workflowId: state.workflowId, event, currentStage: state.currentStage, status: state.status === 'completed' ? 'completed' : state.stages[state.currentStage].status, next: { command: `dev-workflow next --id ${state.workflowId}` } };
  }
  resume(args) {
    const state = this.load(args);
    return { type: 'workflow.resumed', workflowId: state.workflowId, currentStage: state.currentStage, status: state.stages[state.currentStage].status, next: { command: `dev-workflow next --id ${state.workflowId}` };
  }
  format(result) {
    if (result.type === 'workflow.action') {
      const execution = result.execution.strategy === 'parallel'
        ? `subagent/${result.execution.strategy}: ${result.execution.agents.join(', ')}`
        : `${result.execution.mode}/${result.execution.strategy}`;
      const clarification = result.clarification?.enabled
        ? `\n\nClarification: enabled\nRecord decision: ${result.clarification.recordCommand}`
        : '';
      return `[NEXT ACTION]\n\nStage: ${result.stage}\nAction: execute ${result.skill.name} skill\nExecution: ${execution}\nInput: ${JSON.stringify(result.input)}\nOutput: ${result.expectedOutput.artifact}${clarification}\n\nSuccess: ${result.completion.command}\nFailure: ${result.completion.failureCommand}`;
    }
    if (result.type === 'workflow.approval_required') {
      return `[APPROVAL REQUIRED]\n\nStage: ${result.stage}\nArtifact: ${result.artifact || '(none)'}\n\nApprove: ${result.actions.approve.command}\nRevise: ${result.actions.revise.command}`;
    }
    if (result.type === 'workflow.retry_required') {
      return `[RETRY REQUIRED]\n\nStage: ${result.stage}\n\nRetry: ${result.actions.retry.command}`;
    }
    if (result.type === 'workflow.status') return `Workflow: ${result.workflowId}\nStatus: ${result.status}\nCurrent stage: ${result.currentStage}\n` + STAGES.map(s => `  ${s.padEnd(10)} ${result.stages[s].status}`).join('\n');
    return JSON.stringify(result, null, 2);
  }
}
module.exports = { WorkflowEngine };
