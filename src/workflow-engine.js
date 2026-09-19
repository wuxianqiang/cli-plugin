'use strict';

const { randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { initialState, transition, STAGES, getExecutionConfig } = require('./workflow');

function quoteShell(value) {
  return '"' + String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

class WorkflowEngine {
  constructor(store) {
    this.store = store;
  }

  projectArg() {
    return ` --project-dir ${quoteShell(this.store.root)}`;
  }

  command(command) {
    return `${command}${this.projectArg()}`;
  }

  currentBranch() {
    try {
      return execFileSync('git', ['branch', '--show-current'], {
        cwd: this.store.root,
        encoding: 'utf8'
      }).trim();
    } catch (error) {
      throw Object.assign(new Error('Unable to determine current git branch'), {
        code: 'GIT_BRANCH_UNAVAILABLE',
        cause: error
      });
    }
  }

  async run(args) {
    switch (args.command) {
      case 'init': return this.init(args);
      case 'next': return this.next(args);
      case 'result': return this.result(args);
      case 'publish': return this.publish(args);
      case 'comment-review': return this.commentReview(args);
      case 'clarify': return this.clarify(args);
      case 'status': return this.status(args);
      case 'approve': return this.change(args, 'approve');
      case 'revise': return this.change(args, 'revise', { feedback: args.feedback });
      case 'retry': return this.change(args, 'retry');
      case 'resume': return this.resume(args);
      default:
        return {
          type: 'workflow.help',
          commands: [
            'init', 'next', 'result', 'publish', 'comment-review',
            'clarify', 'status', 'approve', 'revise', 'retry', 'resume'
          ]
        };
    }
  }

  id(args) {
    return args.id || args.workflow || args.name;
  }

  bootstrapRequired() {
    const branch = this.currentBranch();
    return {
      type: 'workflow.bootstrap_required',
      projectDir: this.store.root,
      branch,
      instruction: '当前项目还没有工作流。首次启动必须先执行 init，并传入用户的原始开发需求；不要先调用 next、status 或 help 探测。',
      next: {
        command: this.command('dev-workflow init --request "<user-request>"')
      }
    };
  }

  init(args) {
    if (!args.request) {
      throw Object.assign(new Error('init requires --request'), {
        code: 'INVALID_ARGUMENTS'
      });
    }

    const branch = this.currentBranch();

    if (!branch) {
      throw Object.assign(
        new Error('Workflow requires a named git branch; detached HEAD is not supported'),
        { code: 'GIT_BRANCH_REQUIRED' }
      );
    }

    const state = initialState(branch, args.request, branch);
    this.store.create(state);

    return {
      type: 'workflow.created',
      workflowId: state.workflowId,
      status: state.status,
      currentStage: state.currentStage,
      next: {
        command: this.command(`dev-workflow next --id ${state.workflowId}`)
      }
    };
  }

  load(args) {
    const id = this.id(args);

    if (!id) {
      throw Object.assign(new Error('Missing --id'), {
        code: 'INVALID_ARGUMENTS'
      });
    }

    return this.store.read(id);
  }

  buildAction(state, stage, actionId) {
    const current = state.stages[stage];
    const execution = getExecutionConfig(stage);
    const artifactPath = `.dev/workflows/${encodeURIComponent(state.workflowId)}/artifacts/${stage}.md`;
    const clarificationEnabled = ['specify', 'design', 'review'].includes(stage);

    return {
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
        review: current.reviewSource
          ? {
              mode: 'feishu_comments',
              document: current.reviewSource,
              instruction: '先读取该版本飞书文档的评论，理解并应用用户明确提出的修改意见；不要修改未被评论要求变更的内容。'
            }
          : null,
        clarification: state.clarification
      },
      clarification: clarificationEnabled
        ? {
            enabled: true,
            purpose: stage === 'review'
              ? 'record review finding fix/skip decisions'
              : 'record unresolved decisions',
            recordCommand: this.command(
              `dev-workflow clarify --id ${state.workflowId} --question-id "<question-id>" --question "<question>" --choice "<choice>" --answer "<user-answer>"`
            )
          }
        : { enabled: false },
      expectedOutput: {
        artifact: artifactPath,
        result: {
          status: 'success | failed',
          artifact: artifactPath
        }
      },
      completion: {
        command: this.command(
          `dev-workflow result --id ${state.workflowId} --action ${actionId} --status success --artifact ${artifactPath}`
        ),
        failureCommand: this.command(
          `dev-workflow result --id ${state.workflowId} --action ${actionId} --status failed`
        )
      }
    };
  }

  next(args) {
    if (!this.id(args)) {
      return this.bootstrapRequired();
    }

    let state;
    try {
      state = this.load(args);
    } catch (error) {
      if (error.code === 'WORKFLOW_NOT_FOUND') {
        return this.bootstrapRequired();
      }
      throw error;
    }

    if (state.status === 'completed') {
      return {
        type: 'workflow.completed',
        workflowId: state.workflowId
      };
    }

    const stage = state.currentStage;
    const current = state.stages[stage];

    if (current.status === 'publishing') {
      return {
        type: 'workflow.publish_required',
        workflowId: state.workflowId,
        stage,
        artifact: current.artifact,
        version: (current.publication?.currentVersion || 0) + 1,
        instruction: '将当前 Markdown artifact 创建为新的飞书文档。不要覆盖任何历史文档。创建成功后记录 document_id 和 url。',
        publishCommand: this.command(
          `dev-workflow publish --id ${state.workflowId} --document-id "<document-id>" --url "<document-url>"`
        )
      };
    }

    if (current.status === 'waiting_approval') {
      return {
        type: 'workflow.approval_required',
        workflowId: state.workflowId,
        stage,
        status: current.status,
        artifact: current.artifact,
        publication: current.publication?.versions.at(-1) || null,
        actions: {
          approve: {
            command: this.command(`dev-workflow approve --id ${state.workflowId}`)
          },
          revise: {
            command: this.command(
              `dev-workflow revise --id ${state.workflowId} --feedback "<user-feedback>"`
            )
          },
          commentReview: {
            command: this.command(
              `dev-workflow comment-review --id ${state.workflowId}`
            )
          }
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
          retry: {
            command: this.command(
              `dev-workflow retry --id ${state.workflowId}`
            )
          }
        }
      };
    }

    if (
      current.status === 'running' &&
      ['specify', 'design', 'review'].includes(stage) &&
      state.currentAction?.id
    ) {
      return this.buildAction(state, stage, state.currentAction.id);
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

    const actionId = `action_${randomUUID()}`;
    const action = this.buildAction(state, stage, actionId);

    state.currentAction = {
      id: action.id,
      stage,
      attempt: current.attempt,
      execution: action.execution
    };

    this.store.writeState(state);
    this.store.appendHistory({
      type: 'workflow.action',
      workflowId: state.workflowId,
      actionId: action.id,
      stage,
      execution: action.execution
    });

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
      next: {
        command: this.command(`dev-workflow next --id ${state.workflowId}`)
      }
    };
  }

  result(args) {
    const state = this.load(args);

    if (!args.action || !args.status) {
      throw Object.assign(
        new Error('result requires --action and --status'),
        { code: 'INVALID_ARGUMENTS' }
      );
    }

    const artifacts = args.artifact ? [{ path: args.artifact }] : [];

    transition(state, 'result', {
      actionId: args.action,
      status: args.status,
      artifacts
    });

    this.store.writeState(state);
    this.store.appendHistory({
      type: 'workflow.result',
      workflowId: state.workflowId,
      actionId: args.action,
      stage: state.currentStage,
      status: args.status,
      artifacts
    });

    return {
      type: 'workflow.result.accepted',
      workflowId: state.workflowId,
      stage: state.currentStage,
      status: state.stages[state.currentStage].status,
      artifacts,
      next: {
        command: this.command(`dev-workflow next --id ${state.workflowId}`)
      }
    };
  }

  publish(args) {
    const state = this.load(args);

    if (!args['document-id'] || !args.url) {
      throw Object.assign(
        new Error('publish requires --document-id and --url'),
        { code: 'INVALID_ARGUMENTS' }
      );
    }

    transition(state, 'publish', {
      documentId: args['document-id'],
      url: args.url
    });

    this.store.writeState(state);

    const publication =
      state.stages[state.currentStage].publication.versions.at(-1);

    this.store.appendHistory({
      type: 'workflow.published',
      workflowId: state.workflowId,
      stage: state.currentStage,
      publication
    });

    return {
      type: 'workflow.published',
      workflowId: state.workflowId,
      stage: state.currentStage,
      artifact: state.stages[state.currentStage].artifact,
      publication,
      next: {
        command: this.command(`dev-workflow next --id ${state.workflowId}`)
      }
    };
  }

  commentReview(args) {
    const state = this.load(args);

    transition(state, 'comment_review');
    this.store.writeState(state);

    this.store.appendHistory({
      type: 'workflow.comment_review_requested',
      workflowId: state.workflowId,
      stage: state.currentStage,
      publication: state.stages[state.currentStage].reviewSource
    });

    return {
      type: 'workflow.comment_review_requested',
      workflowId: state.workflowId,
      stage: state.currentStage,
      publication: state.stages[state.currentStage].reviewSource,
      next: {
        command: this.command(`dev-workflow next --id ${state.workflowId}`)
      }
    };
  }

  status(args) {
    if (!this.id(args)) {
      return this.bootstrapRequired();
    }

    try {
      const state = this.load(args);
      return {
        type: 'workflow.status',
        ...state
      };
    } catch (error) {
      if (error.code === 'WORKFLOW_NOT_FOUND') {
        return this.bootstrapRequired();
      }
      throw error;
    }
  }

  change(args, event, payload = {}) {
    const state = this.load(args);

    transition(state, event, payload);
    this.store.writeState(state);

    this.store.appendHistory({
      type: `workflow.${event}`,
      workflowId: state.workflowId,
      stage: state.currentStage,
      ...payload
    });

    return {
      type: 'workflow.transition',
      workflowId: state.workflowId,
      event,
      currentStage: state.currentStage,
      status: state.status === 'completed'
        ? 'completed'
        : state.stages[state.currentStage].status,
      next: {
        command: this.command(`dev-workflow next --id ${state.workflowId}`)
      }
    };
  }

  resume(args) {
    const state = this.load(args);

    return {
      type: 'workflow.resumed',
      workflowId: state.workflowId,
      currentStage: state.currentStage,
      status: state.stages[state.currentStage].status,
      next: {
        command: this.command(`dev-workflow next --id ${state.workflowId}`)
      }
    };
  }

  format(result) {
    if (result.type === 'workflow.action') {
      const execution = result.execution.strategy === 'parallel'
        ? `subagent/${result.execution.strategy}: ${result.execution.agents.join(', ')}`
        : `${result.execution.mode}/${result.execution.strategy}`;

      const clarification = result.clarification?.enabled
        ? `\\n\\nClarification: enabled\\nPurpose: ${result.clarification.purpose}\\nRecord decision: ${result.clarification.recordCommand}`
        : '';

      return `[NEXT ACTION]\\n\\nStage: ${result.stage}\\nAction: execute ${result.skill.name} skill\\nExecution: ${execution}\\nInput: ${JSON.stringify(result.input)}\\nOutput: ${result.expectedOutput.artifact}${clarification}\\n\\nSuccess: ${result.completion.command}\\nFailure: ${result.completion.failureCommand}`;
    }

    if (result.type === 'workflow.bootstrap_required') {
      return `[BOOTSTRAP REQUIRED]\\n\\nProject: ${result.projectDir}\\nBranch: ${result.branch}\\n\\n${result.instruction}\\n\\nInit: ${result.next.command}`;
    }

    if (result.type === 'workflow.publish_required') {
      return `[PUBLISH REQUIRED]\\n\\nStage: ${result.stage}\\nArtifact: ${result.artifact || '(none)'}\\nVersion: ${result.version}\\n\\nCreate a NEW Feishu document from the artifact. Do not overwrite previous documents.\\nAfter creation: ${result.publishCommand}`;
    }

    if (result.type === 'workflow.approval_required') {
      return `[APPROVAL REQUIRED]\\n\\nStage: ${result.stage}\\nArtifact: ${result.artifact || '(none)'}\\nFeishu: ${result.publication?.url || '(not published)'}\\n\\nContinue: ${result.actions.approve.command}\\nModify directly: ${result.actions.revise.command}\\nPull Feishu comments and revise: ${result.actions.commentReview.command}`;
    }

    if (result.type === 'workflow.retry_required') {
      return `[RETRY REQUIRED]\\n\\nStage: ${result.stage}\\n\\nRetry: ${result.actions.retry.command}`;
    }

    if (result.type === 'workflow.status') {
      return `Workflow: ${result.workflowId}\\nStatus: ${result.status}\\nCurrent stage: ${result.currentStage}\\n` +
        STAGES.map(s => `  ${s.padEnd(10)} ${result.stages[s].status}`).join('\\n');
    }

    return JSON.stringify(result, null, 2);
  }
}

module.exports = { WorkflowEngine };
