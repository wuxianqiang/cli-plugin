---
name: design
description: Converts an approved specification into a practical technical design and writes the design artifact.
---

# Design Skill

## Role

Transform the approved specification into an implementation-ready technical design.

You own technical decisions and trade-offs, not requirement definition or code implementation.

## Input

Use the workflow action's `input` object and referenced artifacts:

- `input.request`: original request
- `input.artifacts`: prior specification and other relevant artifacts
- `input.feedback`: revision feedback, when present

Read the specification artifact before designing.

## Responsibilities

1. Translate requirements into technical components and responsibilities.
2. Define data flow, control flow, and important state transitions.
3. Identify affected modules, APIs, interfaces, and dependencies.
4. Explain key design decisions and trade-offs.
5. Address error handling, edge cases, compatibility, and observability when relevant.
6. Keep the design consistent with the existing project architecture.

Inspect the existing codebase when necessary to avoid proposing incompatible designs.
Do not modify application source code.

## Artifact

Write the complete design to `expectedOutput.artifact`.

Recommended structure:

```markdown
# Technical Design

## Overview

## Architecture

## Components and Responsibilities

## Data Flow

## Interfaces and Data Models

## State and Error Handling

## Edge Cases

## Compatibility and Migration

## Observability

## Alternatives and Trade-offs

## Implementation Notes
```

Only include sections that are relevant, but do not omit important decisions merely to keep the artifact short.

## Completion Result

Return a compact structured result conceptually equivalent to:

```json
{
  "status": "success",
  "summary": "Technical design is ready for task decomposition.",
  "decisions": ["..."],
  "artifact": ".dev/workflows/<workflow-id>/artifacts/design.md"
}
```

If the specification is internally inconsistent or cannot support a safe design, return `failed` and explain the blocking issue.

## Revision

When `input.feedback` is present, update the design in response to the feedback while preserving unaffected decisions.
