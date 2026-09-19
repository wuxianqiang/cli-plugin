'use strict';

const STAGES = ['specify', 'design', 'tasks', 'implement', 'review'];
const VALID_STAGE_STATUSES = ['pending', 'ready', 'running', 'publishing', 'completed', 'failed', 'waiting_approval'];
const CLARIFICATION_STAGES = ['specify', 'design'];

// The CLI declares how a stage should be executed; it never dispatches agents itself.
// This keeps workflow/state management separate from LLM orchestration.
const EXECUTION_CONFIG = {
  specify: { mode: 'direct', strategy: 'single', agent: null },
  design: { mode: 'direct', strategy: 'single', agent: null },
  tasks: { mode: 'direct', strategy: 'single', agent: null },
  implement: {
    mode: 'subagent',
    strategy: 'single',
    agent: { name: 'implement-agent', role: 'implementation' }
  },
  review: {
    mode: 'subagent',
    strategy: 'parallel',
    agents: [
      'security-review',
      'performance-review',
      'architecture-review',
      'stability-review'
    ]
  }
};

function getExecutionConfig(stage) {
  const config = EXECUTION_CONFIG[stage];
  if (!config) throw new Error(`Unknown stage execution config: ${stage}`);
  return JSON.parse(JSON.stringify(config));
}

function initialState(workflowId, request, branch = workflowId) {
  const stages = Object.fromEntries(STAGES.map((stage, index) => [stage, {
    status: index === 0 ? 'ready' : 'pending', attempt: 0, artifact: null, feedback: null, publication: { currentVersion: 0, versions: [] }
  }]));
  return {
    version: '1.0', workflowId, branch, request, status: 'running', currentStage: 'specify',
    currentAction: null,
    clarification: {
      status: 'not_started',
      questions: [],
      decisions: []
    },
    stages, artifacts: [], history: []
  };
}

function transition(state, event, payload = {}) {
  const stage = state.currentStage;
  const current = state.stages[stage];
  if (!VALID_STAGE_STATUSES.includes(current.status)) throw new Error(`Invalid stage status: ${current.status}`);

  if (event === 'next') {
    if (current.status !== 'ready') throw Object.assign(new Error(`Stage ${stage} is not ready`), { code: 'STAGE_NOT_READY' });
    current.status = 'running'; current.attempt += 1;
    if (CLARIFICATION_STAGES.includes(stage)) state.clarification.status = 'in_progress';
    return;
  }
  if (event === 'clarify') {
    if (!CLARIFICATION_STAGES.includes(stage) || current.status !== 'running') {
      throw Object.assign(new Error(`Clarification can only be recorded while ${stage} is running`), { code: 'CLARIFICATION_NOT_ACTIVE' });
    }
    if (!payload.questionId || !payload.question || !payload.choice || !payload.answer) {
      throw Object.assign(new Error('clarify requires --question-id, --question, --choice and --answer'), { code: 'INVALID_ARGUMENTS' });
    }
    const question = {
      id: payload.questionId,
      stage,
      question: payload.question,
      choices: payload.choices || [],
      status: 'resolved'
    };
    state.clarification.questions.push(question);
    state.clarification.decisions.push({
      questionId: payload.questionId,
      stage,
      choice: payload.choice,
      answer: payload.answer
    });
    state.clarification.status = 'in_progress';
    return;
  }
  if (event === 'result') {
    if (!state.currentAction || state.currentAction.id !== payload.actionId) throw Object.assign(new Error('Action ID does not match the current action'), { code: 'ACTION_MISMATCH' });
    if (current.status !== 'running') throw Object.assign(new Error(`Stage ${stage} is not running`), { code: 'STAGE_NOT_RUNNING' });
    if (payload.status === 'success') {
      current.status = 'publishing';
      current.artifact = payload.artifacts?.[0]?.path || payload.artifact || null;
      if (current.artifact) state.artifacts.push({ stage, path: current.artifact });
      if (CLARIFICATION_STAGES.includes(stage)) state.clarification.status = 'completed';
    } else current.status = 'failed';
    return;
  }
  if (event === 'publish') {
    if (current.status !== 'publishing') throw Object.assign(new Error(`Stage ${stage} is not waiting for publication`), { code: 'NOT_PUBLISHING' });
    if (!payload.documentId || !payload.url) throw Object.assign(new Error('publish requires --document-id and --url'), { code: 'INVALID_ARGUMENTS' });
    const publication = current.publication || { currentVersion: 0, versions: [] };
    const version = publication.currentVersion + 1;
    const record = {
      version,
      documentId: payload.documentId,
      url: payload.url,
      createdAt: new Date().toISOString(),
      basedOnVersion: publication.currentVersion || null
    };
    publication.currentVersion = version;
    publication.versions.push(record);
    current.publication = publication;
    current.status = 'waiting_approval';
    return;
  }
  if (event === 'comment_review') {
    if (current.status !== 'waiting_approval') throw Object.assign(new Error(`Stage ${stage} is not awaiting approval`), { code: 'NOT_AWAITING_APPROVAL' });
    if (!current.publication?.currentVersion) throw Object.assign(new Error(`Stage ${stage} has no published Feishu document`), { code: 'NO_FEISHU_PUBLICATION' });
    current.status = 'ready';
    current.feedback = `Review comments from Feishu document version ${current.publication.currentVersion}`;
    current.reviewSource = current.publication.versions.at(-1);
    state.currentAction = null;
    return;
  }
  if (event === 'approve') {
    if (current.status !== 'waiting_approval') throw Object.assign(new Error(`Stage ${stage} is not awaiting approval`), { code: 'NOT_AWAITING_APPROVAL' });
    const index = STAGES.indexOf(stage);
    if (index === STAGES.length - 1) { current.status = 'completed'; state.status = 'completed'; state.currentAction = null; return; }
    current.status = 'completed'; state.currentStage = STAGES[index + 1]; state.stages[state.currentStage].status = 'ready'; state.currentAction = null;
    return;
  }
  if (event === 'revise') {
    if (current.status !== 'waiting_approval') throw Object.assign(new Error(`Stage ${stage} is not awaiting approval`), { code: 'NOT_AWAITING_APPROVAL' });
    current.status = 'ready'; current.feedback = payload.feedback || null; state.currentAction = null; return;
  }
  if (event === 'retry') {
    if (current.status !== 'failed') throw Object.assign(new Error(`Stage ${stage} is not failed`), { code: 'STAGE_NOT_FAILED' });
    current.status = 'ready'; state.currentAction = null; return;
  }
  throw Object.assign(new Error(`Unknown transition: ${event}`), { code: 'UNKNOWN_TRANSITION' });
}

module.exports = { STAGES, VALID_STAGE_STATUSES, CLARIFICATION_STAGES, EXECUTION_CONFIG, getExecutionConfig, initialState, transition };
