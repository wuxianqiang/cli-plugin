'use strict';
const STAGES = ['specify', 'design', 'tasks', 'implement', 'review'];
const VALID_STAGE_STATUSES = ['pending', 'ready', 'running', 'completed', 'failed', 'waiting_approval'];

function initialState(workflowId, request) {
  const stages = Object.fromEntries(STAGES.map((stage, index) => [stage, {
    status: index === 0 ? 'ready' : 'pending', attempt: 0, artifact: null, feedback: null
  }]));
  return {
    version: '1.0', workflowId, request, status: 'running', currentStage: 'specify',
    currentAction: null, stages, artifacts: [], history: []
  };
}

function transition(state, event, payload = {}) {
  const stage = state.currentStage;
  const current = state.stages[stage];
  if (!VALID_STAGE_STATUSES.includes(current.status)) throw new Error(`Invalid stage status: ${current.status}`);
  if (event === 'next') {
    if (current.status !== 'ready') throw Object.assign(new Error(`Stage ${stage} is not ready`), { code: 'STAGE_NOT_READY' });
    current.status = 'running'; current.attempt += 1;
    return;
  }
  if (event === 'result') {
    if (!state.currentAction || state.currentAction.id !== payload.actionId) throw Object.assign(new Error('Action ID does not match the current action'), { code: 'ACTION_MISMATCH' });
    if (current.status !== 'running') throw Object.assign(new Error(`Stage ${stage} is not running`), { code: 'STAGE_NOT_RUNNING' });
    if (payload.status === 'success') { current.status = 'waiting_approval'; current.artifact = payload.artifacts?.[0]?.path || payload.artifact || null; if (current.artifact) state.artifacts.push({ stage, path: current.artifact }); }
    else current.status = 'failed';
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
module.exports = { STAGES, initialState, transition };
