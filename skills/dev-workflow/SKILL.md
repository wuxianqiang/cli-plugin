---
name: dev-workflow
description: Orchestrates the CLI-driven development workflow by reading workflow actions, routing them to direct Skills or subagents, collecting structured results, and advancing the CLI state machine.
---

# Dev Workflow Orchestrator

## Role

You are the orchestration layer between the `dev-workflow` CLI and the LLM execution environment.

The CLI is the workflow runtime and state authority. You are responsible for interpreting the CLI's next action and executing it through the requested Skill or Subagent strategy.

**Do not implement workflow state transitions yourself.** The CLI owns stage state, approval, retry, and progression.

## Core Loop

Always follow this loop:

```text
1. dev-workflow next --id <workflow-id> --json
                ↓
2. inspect workflow result
                ↓
3. execute the requested Skill / Subagent strategy
                ↓
4. persist the stage artifact
                ↓
5. dev-workflow result --id <workflow-id> --action <action-id> --status <success|failed> --artifact <path>
                ↓
6. call dev-workflow next again
```

`result` does not advance the workflow. `next` remains the only source of truth for what happens next.

## CLI Invocation

Prefer JSON output so the orchestration decision is based on structured data:

```bash
dev-workflow next --id <workflow-id> --json
```

If the CLI is not globally installed, invoke the repository's executable directly, for example:

```bash
node /path/to/cli-plugin/bin/dev-workflow.js next --id <workflow-id> --json
```

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

Then route according to `execution`.

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

After execution succeeds, call:

```bash
dev-workflow result \
  --id <workflow-id> \
  --action <action-id> \
  --status success \
  --artifact <artifact-path>
```

After execution fails:

```bash
dev-workflow result \
  --id <workflow-id> \
  --action <action-id> \
  --status failed
```

Do not call `approve`, `revise`, or `retry` immediately after `result` unless the user explicitly asks for that action. Call `next` first and follow the CLI response.

## `workflow.result.accepted`

When `result` returns:

```json
{
  "type": "workflow.result.accepted",
  "next": {
    "command": "dev-workflow next --id <workflow-id>"
  }
}
```

Immediately call the provided `next` command unless execution must stop for an external reason.

## `workflow.approval_required`

Do not automatically approve.

Present the artifact and ask the user whether to:

- approve
- revise

If the user approves, execute the CLI-provided approve command, then call `next`.

If the user requests changes, execute the CLI-provided revise command with concise feedback, then call `next`.

## `workflow.retry_required`

A failed stage is waiting for retry.

Do not silently retry indefinitely. If retry is appropriate, execute the CLI-provided retry command, then call `next`.

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
- Unknown `execution.mode`: stop; do not guess.
- Unknown `execution.strategy`: stop; do not silently fall back to direct execution.
- Subagent failure: collect the failure result and mark the stage failed unless the Skill explicitly defines a recoverable partial-result policy.
- One failed agent in a required parallel group normally causes the aggregate execution to fail; do not claim the review is complete with missing required agents.
- Never fabricate a successful artifact.

## Forbidden Behavior

The Orchestrator must not:

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
