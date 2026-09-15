---
name: tasks
description: Breaks an approved technical design into small, ordered, independently verifiable implementation tasks.
---

# Tasks Skill

## Role

Convert the approved specification and technical design into an implementation plan that another agent can execute safely.

You own task decomposition, ordering, dependencies, and verification criteria. You do not implement the tasks.

## Input

Use:

- `input.request`
- `input.artifacts`
- `input.feedback`

Read the specification and design artifacts before producing tasks.

## Responsibilities

1. Identify the files/modules likely to change.
2. Break work into small, concrete tasks.
3. Order tasks according to dependencies.
4. Define what each task changes and why.
5. Define verification for each task.
6. Identify risks, dependencies, and tasks requiring special care.

Tasks should be specific enough for an implementation agent to execute without reconstructing the design from scratch.

Do not modify application source code.

## Artifact

Write the task plan to `expectedOutput.artifact`.

Recommended structure:

```markdown
# Implementation Tasks

## Task 1: ...
- Goal:
- Files:
- Changes:
- Dependencies:
- Verification:

## Task 2: ...
...

## Verification Plan

## Risks and Notes
```

Prefer 3–10 meaningful tasks over a large list of trivial edits.

## Completion Result

Return a compact structured result conceptually equivalent to:

```json
{
  "status": "success",
  "summary": "Implementation plan contains ordered, verifiable tasks.",
  "decisions": ["..."],
  "artifact": ".dev/workflows/<workflow-id>/artifacts/tasks.md"
}
```

## Revision

When `input.feedback` is present, update the task plan without discarding unaffected tasks or design decisions.
