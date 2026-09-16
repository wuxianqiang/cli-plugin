---
name: dev-workflow
description: Orchestrates the CLI-driven development workflow by reading workflow actions, routing them to direct Skills or subagents, collecting structured results, and advancing the CLI state machine with an optional local browser workspace for human-in-the-loop interaction.
---

# Dev Workflow Orchestrator

## Role

You are the orchestration layer between the `dev-workflow` CLI and the LLM execution environment.

The CLI is the workflow runtime and state authority. It owns stage state, approval, retry, and progression. **Do not implement workflow state transitions yourself.**

## Browser Workflow Workspace

The workflow has an optional local Web UI. Use it as the preferred human-in-the-loop surface when available.

Start it once after creating or resuming a workflow:

```bash
dev-workflow web --id <workflow-id>
```

The command prints a local URL. If the current environment supports opening a browser, it opens the URL automatically. The server remains running until the process receives SIGINT/SIGTERM. When you need the Agent to continue in the same terminal, launch the command in the background using the host shell.

The browser workspace displays:

- the complete SDD timeline: Specify → Design → Tasks → Implement → Review;
- the current stage and stage status;
- generated stage artifacts;
- human annotations attached to selected document text;
- human decisions and approval actions;
- live workflow updates through Server-Sent Events.

The browser is a presentation and interaction layer. **Workflow state remains owned by the CLI/state store.**

For document stages, users can select text in the artifact preview and add a custom annotation. An annotation is persisted separately from the Markdown artifact under the workflow directory, so Agent-generated documents remain clean.

## Core Loop

Follow this loop exactly:

```text
next
 ↓
workflow.action
 ↓
execute Skill / Subagent
 ↓
write artifact
 ↓
[interactive stage?]
 ├─ Specify/Design → Human decision → clarify → next → same Action
 └─ Review → findings → Human decision → fix/skip → apply selected fixes → re-review
 ↓
final artifact
 ↓
execute CLI-provided completion.command
 ↓
execute CLI-provided next.command
 ↓
workflow.approval_required
 ↓
Human approval in Browser or AskUserQuestion
 ↓
approve OR revise
 ↓
execute CLI-provided next command
 ↓
next workflow.action
```

**A successful Skill/Subagent execution never means the next stage may start automatically. Every stage requires explicit user approval.**

When browser HITL is enabled, prefer the browser for artifact review and approval. `AskUserQuestion` remains the fallback for decisions that are easier or more appropriate to resolve in the conversation.

## CLI Command Protocol

The CLI generates complete executable commands with workflow-generated values already resolved.

The Orchestrator must **not** construct, concatenate, substitute, or infer workflow CLI arguments.

When a CLI response contains a `command` field, execute that command exactly as returned.

The only exception is an explicitly marked user-input slot, such as a review clarification answer or revision feedback. Replace only that slot with the user's actual input.

## Starting a Workflow

The initial workflow ID comes from the caller or workflow creation result. The initial lookup may therefore be:

```bash
dev-workflow next --id <initial-workflow-id> --json
```

After that, prefer commands returned by the CLI. Never infer the next stage.

If the CLI is not globally installed, use the repository executable directly.

## `workflow.action`

Read:

- `stage`
- `skill.name`
- `execution.mode`
- `execution.strategy`
- `execution.agent` or `execution.agents`
- `input`
- `expectedOutput`
- `clarification`
- `completion.command`
- `completion.failureCommand`

These fields tell you **what work to execute**. The CLI command fields tell you **how to report the result**.

### Direct

For `execution.mode=direct` and `strategy=single`, execute the referenced Skill in the current LLM context.

### Single Subagent

For `execution.mode=subagent` and `strategy=single`, dispatch the configured agent.

The agent should read relevant artifacts/files itself, perform the work, write detailed output to the artifact, and return only a compact structured result.

### Parallel Subagents

For `execution.mode=subagent` and `strategy=parallel`, dispatch every configured agent independently and in parallel when supported.

Each agent should return a compact result. Aggregate the results into the stage artifact while preserving finding provenance.

## Interactive Stage Protocol

Some stages can pause **inside the same running Action** because the work cannot be completed without a user decision.

When the action exposes:

```json
{
  "clarification": {
    "enabled": true,
    "recordCommand": "dev-workflow clarify ..."
  }
}
```

and the Skill discovers an unresolved decision:

1. Prefer presenting the decision in the browser when the workflow Web UI is running.
2. Otherwise call `AskUserQuestion`.
3. Present concrete options whenever possible.
4. Include a `Custom` option when the user may have another valid answer.
5. Wait for the user's answer.
6. Execute the exact CLI-generated `recordCommand`, replacing only its explicit user-input placeholders.
7. Execute the returned `next.command`.
8. The CLI will return the same `workflow.action`/Action ID for an interactive running stage.
9. Continue the same Skill with the updated `input.clarification.decisions`.

Do not call `workflow.result` while the interactive stage still has unresolved questions.

### Specify / Design

Use this protocol for requirement or technical-design decisions that cannot be safely determined from project facts.

### Review

Review has a stronger decision loop:

```text
parallel review agents
        ↓
aggregate findings
        ↓
Human decision in Browser / AskUserQuestion
        ↓
select findings to FIX
        ↓
unselected findings = SKIP
        ↓
implement selected fixes
        ↓
focused verification
        ↓
re-run relevant review agents
        ↓
new/unresolved findings?
   ├─ yes → Human decision again
   └─ no
        ↓
final review.md
        ↓
workflow.result
```

For Review:

- Every finding must receive an explicit `fix` or `skip` decision.
- Do not silently ignore findings.
- Do not automatically fix every finding.
- For selected findings, use the implementation capability/subagent to actually modify the repository.
- Verify selected fixes before marking them fixed.
- Re-run relevant review agents after fixes.
- Newly discovered findings also require an explicit user decision.
- Only after all decisions and selected fixes are verified may Review return its final successful result.

## Skill Router

| Stage | Skill | Execution |
|---|---|---|
| `specify` | `specify` | direct |
| `design` | `design` | direct |
| `tasks` | `tasks` | direct |
| `implement` | `implement` | configured subagent |
| `review` | `review` | configured parallel subagents |

The CLI's `skill` and `execution` fields take precedence. Do not hard-code stage progression.

## Context Minimization

Subagents exist partly to isolate context.

- Pass artifact paths instead of large copied content.
- Let Subagents inspect the repository and artifacts themselves.
- Store detailed analysis in artifacts.
- Return only summaries, findings, decisions, verification, and artifact paths.
- Aggregate parallel results once.
- Read detailed artifacts only when later work requires them.

## Stage Completion Protocol

After a Skill or Subagent finishes its **complete** work:

1. Verify the expected artifact actually exists.
2. Execute the exact `workflow.action.completion.command` returned by the CLI on success, or `completion.failureCommand` on failure.
3. Execute the exact continuation command returned by the CLI.
4. Inspect the resulting workflow type.
5. If the result is `workflow.approval_required`, leave the workflow paused until a human approves or revises it.

For interactive stages, do **not** report success until their clarification/fix/review loop is complete.

Do not manually call `approve` after `result` unless the user has explicitly approved the stage.
