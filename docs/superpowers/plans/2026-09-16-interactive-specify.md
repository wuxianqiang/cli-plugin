# Interactive Specify Clarification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Specify into an interactive requirements-clarification loop that asks the user to resolve material ambiguity before generating the final specification.

**Architecture:** Keep the CLI as workflow state authority and command generator. Specify remains a direct skill, but its action protocol explicitly supports clarification questions, user decisions, and repeated execution before final artifact generation. Clarification state is persisted in the workflow state so the LLM does not have to infer or reconstruct the decision history.

**Tech Stack:** Node.js 20+, CommonJS, node:test, JSON workflow state, Claude Code AskUserQuestion.

**Spec:** Interactive Specify design approved in conversation.

## Global Constraints

- CLI decides workflow state and generates executable commands.
- Orchestrator/LLM decides how to execute the action and must use AskUserQuestion for material requirement decisions.
- No automatic assumption when multiple reasonable requirement choices exist.
- Final `specify.md` is generated only after clarification has no unresolved material questions.
- Workflow-level stage approval remains separate from Specify's internal clarification loop.

---

### Task 1: Persist Specify clarification decisions

**Files:**
- Modify: `src/workflow.js`
- Test: `test/workflow.test.js`

**Interfaces:**
- `initialState()` adds `clarification` with `status`, `questions`, and `decisions`.
- `transition()` accepts a `clarify` event to record a resolved question without changing the workflow stage.

- [ ] **Step 1: Add tests** for initial clarification state and recording a decision.
- [ ] **Step 2: Run `node --test` and verify the new assertions fail.
- [ ] **Step 3: Implement the minimal clarification state and transition.
- [ ] **Step 4: Run `node --test` and verify all tests pass.

### Task 2: Expose clarification capability in CLI actions

**Files:**
- Modify: `src/workflow-engine.js`
- Test: `test/workflow.test.js`

**Interfaces:**
- Specify `workflow.action` declares `clarification.enabled=true`.
- The action input includes persisted clarification decisions.
- A CLI result path remains available after each clarification cycle; the LLM continues the Specify action rather than advancing the stage.

- [ ] **Step 1: Add tests for Specify action clarification metadata and decisions.
- [ ] **Step 2: Run the focused tests and verify failure.
- [ ] **Step 3: Implement action metadata and persisted decision input.
- [ ] **Step 4: Run the full test suite.

### Task 3: Rewrite Specify as an interactive clarification protocol

**Files:**
- Modify: `skills/specify/SKILL.md`

**Interfaces:**
- Specify analyzes request/context, identifies material ambiguity, calls AskUserQuestion with 2-3 concrete options plus a custom option, records the decision, and repeats.
- Specify may proceed without asking only when the answer is directly established by user input/project facts or the ambiguity does not affect scope/behavior/acceptance criteria.
- Final artifact is generated only when no material unresolved questions remain.
- Clarification decisions are written to `decisions.md`; final requirements go to `specify.md`.

- [ ] **Step 1: Replace one-shot responsibilities with the clarification loop protocol.
- [ ] **Step 2: Document AskUserQuestion option requirements and decision recording.
- [ ] **Step 3: Document the distinction between internal clarification and workflow-level approval.

### Task 4: Verify end-to-end behavior

**Files:**
- Test: `test/workflow.test.js`
- Modify: `README.md` if CLI behavior needs user-facing documentation.

- [ ] **Step 1: Run `node --test`.
- [ ] **Step 2: Verify Specify action exposes clarification state and existing approval flow remains unchanged.
- [ ] **Step 3: Re-read modified files for protocol consistency.
