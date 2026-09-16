---
name: dev-workflow
description: Orchestrates the CLI-driven development workflow and supports browser-based human-in-the-loop approval.
---

# Dev Workflow Orchestrator

The CLI is the workflow runtime and state authority. It owns stage state, approval, retry, and progression. Do not implement workflow transitions yourself.

## Command Location — IMPORTANT

**All `dev-workflow` executable commands are defined in the repository's `bin/` directory.** Claude Code may not automatically discover commands from `bin/`, so do not assume `dev-workflow` is a globally available shell command.

The authoritative executable entrypoint is:

```text
bin/dev-workflow.js
```

When running the workflow from the repository root, use the `bin/` entrypoint directly:

```bash
node ./bin/dev-workflow.js <command> --id <workflow-id> --json
```

For example:

```bash
node ./bin/dev-workflow.js next --id <workflow-id> --json
node ./bin/dev-workflow.js wait --id <workflow-id> --json
node ./bin/dev-workflow.js approve --id <workflow-id> --json
node ./bin/dev-workflow.js apply-comments --id <workflow-id> --json
node ./bin/dev-workflow.js web --id <workflow-id>
```

If a workflow response contains a generated command such as `dev-workflow next ...`, execute that command exactly when the `dev-workflow` executable is available. **If the shell reports `dev-workflow: command not found`, do not stop or claim the command is unavailable. Resolve it to the repository entrypoint and execute:**

```bash
node ./bin/dev-workflow.js <the same command arguments>
```

Do not search for executable workflow commands in `skills/` or `src/`:

- `bin/` = executable CLI commands
- `skills/` = Skill definitions/instructions
- `src/` = CLI/runtime implementation modules

This distinction is mandatory for this workflow.

## Browser Workspace

The workflow has a local Web UI showing the complete SDD timeline, current stage/status, artifacts, annotations, decisions, and live updates.

The CLI automatically starts/reuses the browser workspace when a stage enters `waiting_approval`.

## Core Loop

```text
next
 ↓
workflow.action
 ↓
execute Skill / Subagent
 ↓
write artifact
 ↓
workflow.result
 ↓
workflow.approval_required
 ↓
┌──────────────────────────────────────────────┐
│ Browser / Claude approval                    │
│                                              │
│ 通过 → 下一阶段                               │
│                                              │
│ Docs 评论 → 拉取评论 → Agent 修改 → 再审批   │
│                                              │
│ 直接反馈 → Agent 修改 → 再审批               │
└──────────────────────────────────────────────┘
```

Every stage requires explicit human approval.

## CLI Command Protocol

When the CLI returns a `command`, execute that exact command. Do not reconstruct workflow IDs, action IDs, or other generated arguments. Only replace explicitly marked user-input placeholders.

If the returned command starts with `dev-workflow` but that executable is not on `PATH`, preserve the exact arguments and invoke the repository's `bin/dev-workflow.js` entrypoint instead.

Start/resume with:

```bash
node ./bin/dev-workflow.js next --id <workflow-id> --json
```

## Browser Approval Synchronization

This is critical: a browser decision changes the shared workflow state, but it cannot directly invoke or wake an LLM session. Therefore the Orchestrator must keep the current LLM workflow turn waiting while a browser approval is possible.

When `workflow.result` returns `status=waiting_approval`:

1. The CLI automatically starts/reuses the Web workspace.
2. Do **not** finish the orchestration turn merely because the result was accepted.
3. If browser HITL is being used, execute the CLI `wait` command from the repository's `bin/` directory:

```bash
node ./bin/dev-workflow.js wait --id <workflow-id> --json
```

4. `wait` blocks until the workflow state changes. The browser `approve`, `apply-comments`, `revise`, or `retry` endpoint changes the same state store.
5. When `wait` returns `workflow.wait.completed`, execute its exact `next.command`.
6. Continue with the returned `workflow.action`.

## Docs Comment Revision

When a stage is `waiting_approval`, the Browser Markdown preview supports selecting text and adding a typed annotation. Each annotation must retain:

- current stage
- selected quote
- source start/end offsets when available
- human comment
- annotation type

Annotations are persisted in the workflow's shared `.dev` state and are visible to both Browser and CLI.

If the user clicks **“拉取 Docs 评论并重新修改”**:

1. The Web server records the human decision.
2. The workflow transitions the current stage from `waiting_approval` to `ready`.
3. The CLI `wait` process wakes up because the shared state changed.
4. Execute the exact `next.command` returned by `wait`.
5. The resulting `workflow.action.input.annotations` contains the open annotations for the current stage.
6. The stage Skill must review every annotation, use its target quote as context, and update the current artifact accordingly.
7. Complete the stage with the normal `workflow.result` command.
8. The stage returns to `waiting_approval`, allowing another Browser review cycle.

Do not silently mark Docs annotations as resolved before the Agent has incorporated them into the artifact. The open annotation list is the authoritative human feedback for the revision pass.

### Claude Conversation Approval

If the user approves in the Claude conversation instead, execute the CLI-generated `approve` command directly. Do not call `wait` after the approval has already changed the state.

If the user chooses revise, execute the exact generated `revise` command with only the feedback placeholder replaced.

## Interactive Clarification

For `Specify` and `Design`, if the running action exposes `clarification.enabled=true` and discovers a material unresolved decision:

1. Prefer Browser clarification when the Web UI supports it.
2. Otherwise use `AskUserQuestion`.
3. Record the decision using the exact `clarification.recordCommand`.
4. Execute the returned `next.command`.
5. Continue the same action until all material questions are resolved.

Do not call `workflow.result` while unresolved clarification remains.

## Review

Review findings require explicit `fix` or `skip` decisions. Selected fixes must be implemented and verified, then relevant review agents rerun. Newly discovered findings require another human decision cycle.

## Stage Router

| Stage | Skill | Execution |
|---|---|---|
| specify | specify | direct |
| design | design | direct |
| tasks | tasks | direct |
| implement | implement | configured subagent |
| review | review | configured parallel subagents |

The CLI's `skill` and `execution` fields take precedence.

## Stage Completion

After a Skill/Subagent finishes:

1. Verify the expected artifact exists.
2. Execute the exact `completion.command` returned by the workflow action, or its failure command.
3. Execute the exact continuation command.
4. If the result is `workflow.approval_required`, use the Browser/Claude approval synchronization protocol above.
5. If the user selected Docs comments, execute the returned `next.command`; do not manually reconstruct the annotation payload.

Never automatically approve a completed stage.
