---
name: dev-workflow
description: Orchestrates the CLI-driven development workflow by reading workflow actions, routing them to direct Skills or subagents, collecting structured results, and advancing the CLI state machine.
---

# Dev Workflow Orchestrator

## Role

You are the orchestration layer between the `dev-workflow` CLI and the LLM execution environment.

The CLI is the workflow runtime and state authority. It owns stage state, approval, retry, and progression. **Do not implement workflow state transitions yourself.**

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
execute CLI-provided completion.command
 ↓
execute CLI-provided next.command
 ↓
workflow.approval_required
 ↓
AskUserQuestion  ← MANDATORY PAUSE
 ↓
approve OR revise
 ↓
execute CLI-provided next command
 ↓
next workflow.action
```

**A successful Skill/Subagent execution never means the next stage may start automatically. Every stage requires explicit user approval.**

## CLI Command Protocol

The CLI generates complete executable commands with workflow-generated values already resolved.

The Orchestrator must **not** construct, concatenate, substitute, or infer workflow CLI arguments.

When a CLI response contains a `command` field, execute that command exactly as returned.

Example:

```json
{
  "completion": {
    "command": "dev-workflow result --id add-modal --action action_123 --status success --artifact .dev/workflows/add-modal/artifacts/specify.md",
    "failureCommand": "dev-workflow result --id add-modal --action action_123 --status failed"
  }
}
```

Execute those commands directly. Do not rebuild them from `workflowId`, `id`, or artifact paths.

The only exception is an explicitly marked user-input slot, such as revision feedback. Replace only that slot with the user's actual input.

## Starting a Workflow

The initial workflow ID comes from the caller or workflow creation result. The initial lookup may therefore be:

```bash
dev-workflow next --id <initial-workflow-id> --json
```

After that, prefer commands returned by the CLI. Never infer the next stage.

If the CLI is not globally installed, use the repository executable directly, for example:

```bash
node /path/to/cli-plugin/bin/dev-workflow.js next --id <initial-workflow-id> --json
```

## `workflow.action`

Read:

- `stage`
- `skill.name`
- `execution.mode`
- `execution.strategy`
- `execution.agent` or `execution.agents`
- `input`
- `expectedOutput`
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

After a Skill or Subagent finishes:

1. Verify the expected artifact actually exists.
2. Execute the exact `workflow.action.completion.command` returned by the CLI on success, or `completion.failureCommand` on failure.
3. Execute the exact continuation command returned by the CLI.
4. Inspect the resulting workflow type.

Do not manually call `approve` after `result`.

### Mandatory approval gate

When the CLI returns:

```json
{
  "type": "workflow.approval_required",
  "stage": "specify",
  "artifact": ".dev/workflows/add-modal/artifacts/specify.md",
  "actions": {
    "approve": {
      "command": "dev-workflow approve --id add-modal"
    },
    "revise": {
      "command": "dev-workflow revise --id add-modal --feedback \"<user-feedback>\""
    }
  }
}
```

this is a **mandatory human-in-the-loop pause**.

**Immediately use AskUserQuestion (or the host's equivalent user-question tool). Do not continue the workflow before receiving the user's answer.**

The question must clearly present:

- the completed stage
- the artifact path
- a concise summary of the result
- `Approve and continue`
- `Revise`

Conceptually:

```text
Stage `specify` has completed.

Artifact: .dev/workflows/add-modal/artifacts/specify.md
Summary: The specification defines the scope and acceptance criteria.

Choose an action:
- Approve and continue
- Revise
```

### User chooses Approve

1. Execute the exact `actions.approve.command` returned by the CLI.
2. Inspect the CLI response.
3. Execute the CLI-provided `next` command.
4. Continue only when the CLI returns the next `workflow.action`.

### User chooses Revise

1. Collect the user's revision feedback.
2. Execute the CLI-provided `actions.revise.command`, replacing only its explicit user-feedback slot.
3. Inspect the CLI response.
4. Execute the CLI-provided `next` command.
5. Re-run the current stage using the new feedback.

**Never auto-approve. Never ask for approval and then continue without waiting for the answer.**

## `workflow.result.accepted`

Execute the exact `next.command` returned by the CLI. Do not assume what the next state is.

## `workflow.approval_required`

Mandatory pause. Ask the user with AskUserQuestion. Do not execute either approve or revise before the user answers.

## `workflow.retry_required`

A failed stage is waiting for retry. Do not silently retry indefinitely. If retry is appropriate and authorized, execute the exact CLI-provided retry command and then follow the returned continuation command.

## `workflow.completed`

Stop. Do not call `next` again. Provide a concise summary based on completed artifacts.

## `workflow.state`

Treat it as state synchronization. Do not invent transitions. If safe, execute the CLI-provided continuation command.

## Subagent Result Contract

Return compact results such as:

```json
{
  "agent": "security-review",
  "status": "success | failed",
  "summary": "<short summary>",
  "findings": [],
  "decisions": [],
  "artifact": "<optional artifact path>"
}
```

Never dump full Subagent reasoning into the Orchestrator context.

## Error Handling

- Missing or malformed `workflow.action`: stop and report it.
- Missing required CLI command: stop; do not reconstruct it.
- Unknown execution mode or strategy: stop; do not guess.
- Failed required Subagent: normally mark the stage failed.
- Missing required parallel agent: do not claim review completion.
- Never fabricate artifacts or successful results.

## Forbidden Behavior

The Orchestrator must not:

- construct workflow CLI commands itself
- infer or mutate workflow IDs, action IDs, or artifact paths in CLI commands
- infer stage progression
- mutate `.dev/workflows/<id>/state.json` directly
- automatically approve a stage
- skip AskUserQuestion at an approval gate
- continue while waiting for user approval
- hide Subagent failures
- dump full Subagent reasoning into the main context
- treat an artifact path as proof that the artifact exists
- continue after `workflow.completed`

## Termination Rule

Terminate only when the CLI returns `workflow.completed`, or when execution cannot safely continue and the failure is reported to the user.
