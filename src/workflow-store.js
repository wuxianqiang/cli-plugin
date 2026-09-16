'use strict';
const fs = require('node:fs');
const path = require('node:path');

class WorkflowStore {
  constructor(projectRoot) {
    this.root = projectRoot;
    this.base = path.join(projectRoot, '.dev', 'workflows');
  }
  dir(id) { return path.join(this.base, id); }
  statePath(id) { return path.join(this.dir(id), 'state.json'); }
  historyPath(id) { return path.join(this.dir(id), 'history.jsonl'); }
  annotationPath(id) { return path.join(this.dir(id), 'annotations.json'); }
  artifactDir(id) { return path.join(this.dir(id), 'artifacts'); }
  ensure(id) { fs.mkdirSync(this.artifactDir(id), { recursive: true }); }
  exists(id) { return fs.existsSync(this.statePath(id)); }
  create(state) {
    if (this.exists(state.workflowId)) throw Object.assign(new Error(`Workflow already exists: ${state.workflowId}`), { code: 'WORKFLOW_EXISTS' });
    this.ensure(state.workflowId);
    this.writeState(state);
    this.writeAnnotations(state.workflowId, []);
    this.appendHistory({ type: 'workflow.created', workflowId: state.workflowId });
  }
  read(id) {
    if (!this.exists(id)) throw Object.assign(new Error(`Workflow not found: ${id}`), { code: 'WORKFLOW_NOT_FOUND' });
    return JSON.parse(fs.readFileSync(this.statePath(id), 'utf8'));
  }
  writeState(state) {
    this.ensure(state.workflowId);
    const tmp = this.statePath(state.workflowId) + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n');
    fs.renameSync(tmp, this.statePath(state.workflowId));
  }
  readAnnotations(id) {
    this.ensure(id);
    const file = this.annotationPath(id);
    if (!fs.existsSync(file)) return [];
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  writeAnnotations(id, annotations) {
    this.ensure(id);
    const tmp = this.annotationPath(id) + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(annotations, null, 2) + '\n');
    fs.renameSync(tmp, this.annotationPath(id));
  }
  addAnnotation(id, annotation) {
    const value = { id: annotation.id || `annotation_${Date.now()}`, workflowId: id, createdAt: new Date().toISOString(), status: 'open', ...annotation };
    const annotations = this.readAnnotations(id);
    annotations.push(value);
    this.writeAnnotations(id, annotations);
    this.appendHistory({ type: 'annotation.created', workflowId: id, annotation: value });
    return value;
  }
  addDecision(id, decision) {
    const value = { id: decision.id || `decision_${Date.now()}`, workflowId: id, createdAt: new Date().toISOString(), ...decision };
    this.appendHistory({ type: 'human.decision', workflowId: id, decision: value });
    return value;
  }
  appendHistory(event) {
    fs.appendFileSync(this.historyPath(event.workflowId), JSON.stringify({ ...event, timestamp: new Date().toISOString() }) + '\n');
  }
}
module.exports = { WorkflowStore };
