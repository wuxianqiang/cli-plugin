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
- `input.clarification`: decisions already recorded by the workflow

Read the specification artifact before designing.

## Responsibilities

1. Translate requirements into technical components and responsibilities.
2. Define data flow, control flow, and important state transitions.
3. Identify affected modules, APIs, interfaces, and dependencies.
4. Explain key design decisions and trade-offs.
5. Address error handling, edge cases, compatibility, and observability when relevant.
6. Keep the design consistent with the existing project architecture.
7. Identify technical decisions that cannot be safely determined from the specification or codebase alone.

Inspect the existing codebase when necessary to avoid proposing incompatible designs.
Do not modify application source code.

## Interactive Design Decisions

Design is an interactive decision-making stage, not a one-shot document generation step.

When you encounter multiple technically reasonable approaches and the available project facts do not determine which one should be selected, **do not silently choose one**. Ask the user with `AskUserQuestion` before finalizing the design.

Typical cases include:

- Multiple architecture approaches with materially different trade-offs.
- Different API or data-model strategies that affect compatibility or future evolution.
- Multiple state-management or caching strategies where the requirements do not determine the choice.
- Different migration or rollout approaches with meaningful operational differences.
- Any technical boundary where choosing one option would create an assumption that should belong to the user.

The question should be concrete and decision-oriented. Prefer presenting 2–3 viable options, with a recommended option when there is a clear technical basis for the recommendation, plus a custom option when appropriate.

Example:

```text
Question: How should the export service handle large files?

A. Asynchronous job + polling (Recommended)
   Better for large files and avoids keeping the request open.

B. Synchronous response
   Simpler, but the request remains open until export completes.

C. Custom
   Let the user describe another approach.
```

### Decision loop

For every unresolved design decision:

1. Analyze the requirement and existing codebase.
2. Determine whether the choice can be established from facts. If yes, decide it yourself and continue.
3. If multiple reasonable approaches remain, call `AskUserQuestion`.
4. Present concise options, normally `A`, `B`, and `C: Custom` when useful. Mark a recommendation only when there is a concrete technical reason.
5. After the user answers, persist the decision using the CLI-generated clarification command from `workflow.action.clarification.recordCommand`.
6. Call the returned `next` command so the same Design action resumes with the updated decision context.
7. Re-evaluate the remaining design. Repeat the loop if another unresolved decision is discovered.
8. Only after all material design decisions are resolved, generate the complete `design.md`.

The clarification loop does **not** complete the Design stage. It keeps the same workflow action and action ID running until the design document is ready.

Do not ask questions for decisions that can be determined from repository facts, established project conventions, or requirements that already constrain the choice.

## Artifact

Write the **complete** design to `expectedOutput.artifact` only after all material design decisions have been resolved.

The final artifact must reflect the user's selected decisions and must not leave unresolved alternatives where a concrete implementation decision is required.

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

If revision introduces a new unresolved technical decision, use the same interactive decision loop before regenerating the complete design document.
