---
name: specify
description: Clarifies a development request into a precise, testable product specification and writes the specification artifact.
---

# Specify Skill

## Role

Turn the user's development request into a clear, bounded, testable specification.

You own requirements clarification, not technical implementation or architecture.

## Input

Use the workflow action's `input` object as the primary context:

- `input.request`: original user request
- `input.artifacts`: relevant previous artifacts
- `input.feedback`: revision feedback, when present

Read referenced artifacts when they contain information needed to clarify the request.

## Responsibilities

1. Identify the problem and desired outcome.
2. Define scope and explicit non-goals.
3. Identify functional requirements.
4. Identify important constraints and assumptions.
5. Define acceptance criteria that can be verified.
6. Preserve unresolved questions instead of silently inventing requirements.

Do not design implementation details unless they are already required by the request.
Do not modify application source code.

## Artifact

Write the complete specification to the artifact path provided by `expectedOutput.artifact`.

Recommended structure:

```markdown
# Specification

## Goal

## Background

## Scope

## Non-Goals

## Functional Requirements

## Constraints and Assumptions

## Acceptance Criteria

## Open Questions
```

The artifact is the source of detailed requirements. Keep the completion response compact.

## Completion Result

Return a concise structured result conceptually equivalent to:

```json
{
  "status": "success",
  "summary": "Specification defines scope, requirements, and acceptance criteria.",
  "artifact": ".dev/workflows/<workflow-id>/artifacts/specify.md"
}
```

If the request cannot be specified safely because essential information is missing, return `failed` with the reason rather than fabricating requirements.

## Revision

When `input.feedback` is present, revise the existing specification according to that feedback. Preserve valid existing requirements and update affected sections.
