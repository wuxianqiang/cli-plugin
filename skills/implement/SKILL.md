---
name: implement
description: Executes the approved implementation task plan through the configured implementation subagent and records implementation results.
---

# Implement Skill

## Role

Coordinate execution of the approved task plan. The actual code changes should be performed by the configured implementation Subagent.

This Skill is an execution boundary: it prepares focused context for the Subagent, validates the result, and records a concise completion summary.

## Input

Use:

- `input.request`
- `input.artifacts`
- `input.feedback`
- `expectedOutput.artifact`
- the action's `execution.agent` configuration

Read the specification, design, and task artifacts as needed. Do not copy their full contents into the Subagent prompt when file paths are sufficient.

## Subagent Dispatch

Dispatch the configured implementation agent from `execution.agent`.

Provide:

- original request
- relevant artifact paths
- implementation task plan
- current feedback
- expected implementation outcome

Tell the Subagent to inspect the repository itself, implement the tasks, run appropriate tests, and report verification results.

The Subagent owns source-code modifications. Do not duplicate its implementation work in the Orchestrator context.

## Required Implementation Behavior

The implementation agent should:

1. Inspect the current repository state.
2. Read the specification, design, and tasks artifacts.
3. Implement the tasks in dependency order.
4. Avoid unrelated changes.
5. Run relevant tests, type checks, linting, or build checks when available.
6. Record important implementation notes in the implementation artifact.
7. Return a compact result containing status, summary, changed areas, and verification.

## Artifact

Write or finalize `expectedOutput.artifact` with a concise implementation report:

```markdown
# Implementation Report

## Summary

## Changes

## Verification

## Remaining Issues
```

The artifact should not contain a full transcript or chain of thought.

## Completion Result

Return a compact result conceptually equivalent to:

```json
{
  "status": "success",
  "summary": "Implementation completed and verification passed.",
  "decisions": [],
  "artifact": ".dev/workflows/<workflow-id>/artifacts/implement.md"
}
```

Use `failed` if implementation is incomplete or required verification fails.

## Failure Rules

Do not report success merely because files were changed. A successful implementation requires the requested work to be complete enough for review and relevant verification to have been attempted.
