---
name: dev-workflow
description: Orchestrates the CLI-driven development workflow by reading workflow actions, routing them to direct Skills or subagents, collecting structured results, and advancing the CLI state machine.
---

# Dev Workflow Orchestrator

## Role

You are the orchestration layer between the `dev-workflow` CLI and the LLM execution environment.

The CLI is the workflow runtime and state authority. You are responsible for interpreting the CLI's next action and executing it through the requested Skill or Subagent strategy.

**Do not implement workflow state transitions yourself.** The CLI owns stage state, approval, retry, and progression.

## CLI Command Protocol

The CLI is responsible for constructing workflow commands with all workflow-generated values already resolved.

**The Orchestrator must not construct, concatenate, substitute, or infer CLI workflow arguments.**

When the CLI response contains a `command` field, treat that command as the authoritative executable command and execute it exactly as returned.

For example, when `workflow.action` returns:

```json
{
  "id": "action_123",
  "workflowId": "add-modal",
  "completion": {
    "command": "dev-workflow result --id add-modal --action action_123 --status success --artifact .dev/workflows/add-modal/artifacts/specify.md",
    "failureCommand": "dev-workflow result --id add-modal --action action_123 --status failed"
  }
}
```

The Orchestrator executes the returned command directly. It must **not** reconstruct it from `workflowId`, `id`, `artifact`, or any other response field.

### Command sources

Use commands only from the CLI response:

| Situation | Command source |
|---|---|
| Start/continue workflow | `workflow.action` or `workflow.result.accepted` command fields |
| Record successful execution | `workflow.action.completion.command` |
| Record failed execution | `workflow.action.completion.failureCommand` |
| Approval | `workflow.approval_required.actions.approve.command` |
| Revision | `workflow.approval_required.actions.revise.command` |
| Retry | `workflow.retry_required.actions.retry.command` |
| Continue after transition | `next.command` when returned by the CLI |

The Orchestrator may inspect other fields to decide **how to execute the work**, but those fields are not used to construct CLI commands.

### Exception: user-provided values

Some commands require information that does not exist until the user responds. For example, a revision requires user feedback.

The CLI therefore returns the command shape with a clearly marked user-input slot:

```text
dev-workflow revise --id add-modal --feedback "<user-feedback>"
```

In this case, the Orchestrator may replace **only the explicit user-input slot** with the user's actual feedback. It must not alter any CLI-generated workflow identifier, stage identifier, action identifier, or artifact path.

No workflow-generated placeholder such as `<workflow-id>`, `<action-id>`, or `<artifact-path>` should appear in normal CLI-generated execution commands.

## Core Loop

Always follow this loop:

```text
1. dev-workflow next --id <initial-workflow-id> --json
                ↓
2. inspect workflow result
                ↓
3. execute the requested Skill / Subagent strategy
                ↓
4. persist the stage artifact
                ↓
5. execute the exact CLI command returned by the workflow action
                ↓
6. call the exact `next` command returned by the CLI
```

The initial workflow lookup may require the workflow ID supplied by the user or the surrounding execution context. After that, all workflow-generated command arguments must come from CLI-generated commands.

`result` does not advance the workflow. `next` remains the only source of truth for what happens next.

## CLI Invocation

Prefer JSON output so the orchestration decision is based on structured data:

```bash
dev-workflow next --id <initial-workflow-id> --json
```

If the CLI is not globally installed, invoke the repository's executable directly, for example:

```bash
node /path/to/cli-plugin/bin/dev-workflow.js next --id <initial-workflow-id> --json
```

Once the CLI returns a command, execute the returned command rather than recreating an equivalent command manually.

Never infer the next stage from the previous stage. Always ask the CLI.

## Result Routing

### `workflow.action`

This is the primary execution instruction.

Read:

- `stage`
- `skill.name`
- `execution.mode`
- `execution.strategy`
- `input`
- `expectedOutput`
- `id`
- `completion.command`
- `completion.failureCommand`

The first fields determine **what work to execute**. The command fields determine **how to report the result to the CLI**.

### Direct execution

For:

```json
{
  "execution": {
    "mode": "direct",
    "strategy": "single"
  }
}
```

Execute the referenced Skill in the current LLM context.

The Skill must produce the expected artifact and a concise structured completion summary.

Do not unnecessarily copy large intermediate analysis into the Orchestrator context. Put detailed material in the artifact and keep the returned summary compact.

### Single Subagent execution

For:

```json
{
  "execution": {
    "mode": "subagent",
    "strategy": "single",
    "agent": {
      "name": "implement-agent"
    }
  }
}
```

Dispatch the named Subagent with only the context required for the task.

The Subagent should:

1. Read the relevant artifacts/files itself.
2. Perform the requested work.
3. Write detailed output to the expected artifact when appropriate.
4. Return a compact structured result.

The Orchestrator should consume the compact result instead of importing the Subagent's full reasoning into the main context.

### Parallel Subagent execution

For:

```json
{
  "execution": {
    "mode": "subagent",
    "strategy": "parallel",
    "agents": ["security-review", "performance-review"]
  }
}
```

Dispatch all listed agents independently and in parallel when the execution environment supports parallel subagents.

Each agent receives the same relevant workflow context unless the action explicitly provides a narrower scope.

Each agent returns a compact result such as:

```json
{
  "agent": "security-review",
  "status": "success",
  "summary": "No high-confidence security issues found.",
  "findings": [],
  "artifact": ".dev/workflows/demo/artifacts/review-security.md"
}
```

After all agents finish, aggregate their results into the stage artifact:

```text
.dev/workflows/<workflow-id>/artifacts/review.md
```

The aggregate should contain findings, severity, source agent, evidence, and recommended fixes. The Orchestrator's in-context summary should remain short.

## Skill Router

The default stage-to-Skill mapping is:

| Stage | Skill |
|---|---|
| `specify` | `specify` |
| `design` | `design` |
| `tasks` | `tasks` |
| `implement` | `implement` / configured Subagent |
| `review` | `review` / configured Review Subagents |

The CLI's `skill.name` and `execution` fields take precedence over this table.

Do not hard-code stage progression in the Skill Router.

## Context Minimization

The primary purpose of Subagent execution is context isolation.

Follow these rules:

- Do not paste full Subagent reasoning back into the main context.
- Prefer artifact paths over large inline content.
- Pass only the request, relevant artifact paths, current feedback, and narrowly scoped instructions.
- Ask Subagents to return summaries, findings, decisions, and artifact paths rather than full traces.
- For parallel execution, aggregate results once instead of replaying each agent's complete response.
- If detailed information is needed later, read the artifact on demand.

Use this pattern:

```text
Main Context
    │
    ├── request
    ├── artifact paths
    └── execution instruction
             │
             ▼
        Subagent Context
             │
       large analysis
             │
             ▼
        artifact + summary
             │
             ▼
        Main Context
```

## Result Protocol

After execution succeeds, execute the exact command returned in:

```text
workflow.action.completion.command
```

Do not reconstruct it from the action ID, workflow ID, or artifact path.

After execution fails, execute the exact command returned in:

```text
workflow.action.completion.failureCommand
```

Do not call `approve`, `revise`, or `retry` immediately after reporting `result` unless the user explicitly asks for that action. Execute the CLI-provided continuation command and follow the returned workflow response.

## `workflow.result.accepted`

When `result` returns:

```json
{
  "type": "workflow.result.accepted",
  "next": {
    "command": "dev-workflow next --id add-modal"
  }
}
```

Execute the exact `next.command` returned by the CLI unless execution must stop for an external reason.

## `workflow.approval_required`

Do not automatically approve.

Present the artifact and ask the user whether to:

- approve
- revise

If the user approves, execute the exact CLI-provided approve command, then follow the CLI response.

If the user requests changes, use the CLI-provided revise command and replace only its explicit user-feedback slot with the user's feedback, then follow the CLI response.

## `workflow.retry_required`

A failed stage is waiting for retry.

Do not silently retry indefinitely. If retry is appropriate, execute the exact CLI-provided retry command, then follow the CLI response.

If the failure requires user intervention, explain the failure instead.

## `workflow.completed`

Stop the workflow loop.

Provide a concise final summary using the completed artifacts. Do not call `next` again.

## `workflow.state`

Treat this as a state synchronization signal. Do not invent a transition.

Inspect the status and, when safe, call `next` again. If the state indicates another actor is currently executing the action, wait rather than creating duplicate work.

## Subagent Result Contract

Every Subagent should return a compact result with this conceptual shape:

```json
{
  "agent": "<agent-name>",
  "status": "success | failed",
  "summary": "<short summary>",
  "findings": [],
  "decisions": [],
  "artifact": "<optional artifact path>"
}
```

The exact fields may be extended by a specialized Skill, but the result must remain small enough to safely return to the Orchestrator.

## Parallel Aggregation

For parallel agents:

```text
                    workflow.action
                         │
                         ▼
                    Orchestrator
                         │
            ┌────────────┼────────────┐
            ▼            ▼            ▼
         Agent A      Agent B      Agent C ...
            │            │            │
            ▼            ▼            ▼
         Result A      Result B      Result C
            └────────────┼────────────┘
                         ▼
                    Aggregator
                         │
                         ▼
                  stage artifact
                         │
                         ▼
                 CLI `result`
```

For review workflows, preserve the source agent on every finding so aggregation does not lose provenance.

## Error Handling

- Invalid or missing `workflow.action`: stop and report the malformed action.
- Missing CLI command in a state that requires an action: stop; do not reconstruct the command.
- Unknown `execution.mode`: stop; do not guess.
- Unknown `execution.strategy`: stop; do not silently fall back to direct execution.
- Subagent failure: collect the failure result and mark the stage failed unless the Skill explicitly defines a recoverable partial-result policy.
- One failed agent in a required parallel group normally causes the aggregate execution to fail; do not claim the review is complete with missing required agents.
- Never fabricate a successful artifact.

## Forbidden Behavior

The Orchestrator must not:

- Construct `dev-workflow result --id ... --action ...` commands itself.
- Replace workflow-generated values in CLI commands.
- Decide that `specify` is followed by `design` without asking the CLI.
- Mutate `.dev/workflows/<id>/state.json` directly.
- Reimplement CLI transition rules.
- Automatically approve a stage.
- Hide Subagent failures.
- Dump complete Subagent reasoning into the main context.
- Treat an artifact path as proof that the artifact was actually created.
- Continue after `workflow.completed`.

## Termination Rule

The Orchestrator terminates only when the CLI returns:

```text
workflow.completed
```

or when execution cannot safely continue and the failure is reported to the user.
