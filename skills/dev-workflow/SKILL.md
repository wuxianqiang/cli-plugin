---
name: dev-workflow
description: Orchestrates the CLI-driven development workflow; the Web UI is a Docs review workspace only.
---

# Dev Workflow Orchestrator

The CLI is the workflow runtime and state authority. It owns stage state, approval, retry, revision, and progression. The Web UI never advances, approves, retries, or revises a workflow.

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
node ./bin/dev-workflow.js approve --id <workflow-id> --json
node ./bin/dev-workflow.js apply-comments --id <workflow-id> --json
node ./bin/dev-workflow.js revise --id <workflow-id> --feedback "<user-feedback>" --json
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

The local Web UI is a **Docs Review workspace**, not a workflow controller.

It may:

- show the SDD timeline and current stage/status;
- render the current Markdown artifact;
- allow selecting text and adding annotations/comments;
- underline annotated text in the preview;
- list existing annotations;
- sync new annotations to the shared workflow store.

It must **not** provide buttons or API actions for:

- approve / proceed;
- retry;
- revise;
- apply Docs comments;
- any other workflow transition.

The Web UI cannot wake or drive the Claude/Agent CLI, so workflow progression must never depend on a browser action or browser `wait` loop.

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
AskUserQuestion in CLI / Claude conversation
 ├─ 通过并进入下一阶段
 │    └─ approve → next
 ├─ 拉取 Docs 评论并重新修改
 │    └─ apply-comments → next → current Skill
 └─ 直接修改并提供反馈
      └─ revise(feedback) → next → current Skill
```

Every successful stage requires an explicit human decision in the CLI / Claude conversation.

## CLI Command Protocol

When the CLI returns a `command`, execute that exact command. Do not reconstruct workflow IDs, action IDs, or other generated arguments. Only replace explicitly marked user-input placeholders.

Start/resume with:

```bash
node ./bin/dev-workflow.js next --id <workflow-id> --json
```

After a stage result enters `waiting_approval`, **do not call `wait` and do not wait for the browser**. Call `next` to obtain `workflow.approval_required`, then use `AskUserQuestion` in the CLI/Claude conversation.

## Stage Completion Approval

When `workflow.result` returns `status=waiting_approval`:

1. Execute the returned continuation command and obtain `workflow.approval_required`.
2. Call `AskUserQuestion` in the CLI / Claude conversation.
3. Present these choices:
   - **通过并进入下一阶段** — execute the exact `actions.approve.command`.
   - **拉取 Docs 评论并重新修改** — execute the exact `actions.applyComments.command`.
   - **直接修改并提供反馈** — collect the user's feedback, substitute only the `<user-feedback>` placeholder, and execute the exact `actions.revise.command`.
4. After `approve`, execute the returned `next.command` and continue to the next stage.
5. After `apply-comments` or `revise`, execute the returned `next.command` and rerun the current stage Skill with the resulting input.
6. Never automatically approve a completed stage.

The browser may remain open as a read-only review surface, but it has no role in the approval handshake.

## Docs Comment Revision

The Markdown preview supports selecting text and adding a typed annotation. Each annotation must retain:

- current stage;
- selected quote;
- source start/end offsets when available;
- human comment;
- annotation type;
- open/resolved status.

When the user chooses **“拉取 Docs 评论并重新修改”** in the CLI:

1. Execute the exact `actions.applyComments.command` returned by `workflow.approval_required`.
2. The workflow transitions the current stage from `waiting_approval` to `ready` and records the open annotation IDs in history.
3. Execute the returned `next.command`.
4. The resulting `workflow.action.input.annotations` contains the open annotations for the current stage.
5. The stage Skill must review every annotation, use its target quote as context, and update the current artifact accordingly.
6. Complete the stage with the normal `workflow.result` command.
7. The stage returns to `waiting_approval`, creating another CLI approval cycle.

Do not silently mark Docs annotations as resolved before the Agent has incorporated them into the artifact. The open annotation list is the authoritative human feedback for the revision pass.

## Interactive Clarification

For `Specify` and `Design`, if the running action exposes `clarification.enabled=true` and discovers a material unresolved decision:

1. Use `AskUserQuestion` in the CLI / Claude conversation.
2. If there are multiple viable options, present them explicitly (for example, recommended Option A, Option B, or a custom suggestion).
3. Record the decision using the exact `clarification.recordCommand`.
4. Execute the returned `next.command`.
5. Continue the same action until all material questions are resolved.

Do not call `workflow.result` while unresolved clarification remains.

## Review

Review findings require explicit `fix` or `skip` decisions in the CLI / Claude conversation. Selected fixes must be implemented and verified, then relevant review agents rerun. Newly discovered findings require another human decision cycle.

The Web UI can display review artifacts and comments but cannot decide which findings to fix or skip.

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
4. If the result is `workflow.approval_required`, call `AskUserQuestion` in the CLI / Claude conversation.
5. If the user selected Docs comments, execute the exact `apply-comments` command returned by the approval response, then the exact `next.command`.
6. Pass the resulting `workflow.action.input.annotations` into the current Skill revision.

Never use the Web UI as the source of workflow-control decisions.
