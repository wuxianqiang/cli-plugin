---
name: specify
description: Clarifies a development request through an interactive requirements-decision loop and writes the final specification only after material ambiguity is resolved.
---

# Specify Skill

## Role

Turn the user's development request into a clear, bounded, testable specification through explicit requirements clarification.

You own requirements clarification, not technical implementation or architecture.

**Specify is not a one-shot generation step. It is an interactive clarification loop.** You must continue asking targeted questions until all material requirement boundaries and decisions are resolved, then generate the final specification.

## Input

Use the workflow action's `input` object as the primary context:

- `input.request`: original user request
- `input.artifacts`: relevant previous artifacts
- `input.feedback`: revision feedback, when present
- `input.clarification`: persisted clarification questions and decisions from earlier cycles

Read referenced artifacts when they contain information needed to clarify the request.

## Core Protocol

Follow this loop:

```text
Understand request
      ↓
Inspect relevant project context
      ↓
Identify material ambiguity / missing requirement / boundary
      ↓
Does a user decision affect behavior, scope, constraints, or acceptance?
      ├─ No → resolve from explicit user input or project facts
      └─ Yes
           ↓
      AskUserQuestion
           ↓
      User selects an option or provides custom input
           ↓
      Record the decision through the CLI-provided clarification command
           ↓
      Re-evaluate the remaining requirements
           ↓
      More material questions?
           ├─ Yes → AskUserQuestion again
           └─ No → generate specify.md
```

Never generate the final specification while a material requirement question remains unresolved.

## When You MUST AskUserQuestion

Ask the user when any of the following is true:

1. The request has an ambiguous functional boundary.
2. Two or more reasonable behaviors are possible and the choice changes product behavior.
3. A requirement is missing and cannot be established from the user's request or project facts.
4. A scope decision changes what is included or excluded.
5. An edge-case behavior requires a product decision.
6. An acceptance criterion depends on an unresolved user preference.
7. A constraint, permission, data-retention rule, compatibility target, or failure behavior is unclear and materially affects the specification.

Do **not** ask merely because a technical implementation detail could have multiple solutions. Technical design belongs to the Design stage unless the user explicitly makes it a product requirement.

Do not silently choose between multiple reasonable product behaviors just to finish the artifact faster.

## When You MAY Proceed Without Asking

You may resolve an item without user interaction when:

- The answer is explicitly stated in the user's request.
- The answer is directly established by existing project facts or approved artifacts.
- The ambiguity does not materially affect scope, behavior, constraints, or acceptance criteria.
- It is an implementation detail that belongs to Design rather than requirements clarification.

When using project facts, distinguish facts from assumptions. Do not invent facts.

## AskUserQuestion Format

Use Claude Code's `AskUserQuestion` tool (or the host's equivalent user-question mechanism).

Ask **one decision at a time**. Do not bundle unrelated decisions into one question.

Prefer 2-3 concrete options plus a final custom option. Options should be materially different and explain the consequence of each choice when useful.

Example:

```text
Question: 大数据量导出采用哪种方式？

A. 同步导出
   请求完成后直接下载，适合小数据量。

B. 异步导出
   后台生成文件，完成后再下载，适合大数据量。

C. 自定义
   告诉我你希望采用的方式。
```

The question must make the decision boundary obvious enough that the user can choose without needing to inspect implementation details.

If a custom option is selected, use the user's response as the decision input and do not reinterpret it into a different product decision without asking again when ambiguity remains.

## Record Every Decision

After the user answers a clarification question, execute the **exact CLI command supplied by the current `workflow.action.clarification.recordCommand`**.

Only replace explicit user-input placeholders such as `<question-id>`, `<question>`, `<choice>`, and `<user-answer>`. Do not reconstruct workflow IDs or other CLI-generated values.

The command records the decision in workflow state. The conceptual result is:

```json
{
  "type": "workflow.clarification.accepted",
  "decision": {
    "questionId": "question_1",
    "choice": "B",
    "answer": "异步导出"
  },
  "next": {
    "command": "dev-workflow next --id <workflow-id>"
  }
}
```

Persist detailed decision history in:

`.dev/workflows/<workflow-id>/artifacts/decisions.md`

A decision entry should contain:

- question
- available choices
- selected choice
- user's custom answer when applicable
- resulting requirement decision

## Continue the Clarification Loop

After recording a decision, continue analyzing the request. Do not treat one answer as completion of Specify.

Ask the next question if another material ambiguity exists.

The loop can contain any number of clarification rounds. Stop only when all material requirements, boundaries, and acceptance criteria are sufficiently determined.

## Final Specification Gate

Before generating `specify.md`, perform an internal checklist:

- Goal is explicit.
- Scope is explicit.
- Non-goals are explicit.
- Functional requirements are testable.
- Material edge cases have a confirmed behavior.
- Important constraints are confirmed.
- Acceptance criteria are verifiable.
- No material open question remains.
- All user decisions that affected requirements have been recorded.

If a material question remains, **do not generate the final artifact**. Ask the user first.

## Artifact

Write the detailed decision history to:

`.dev/workflows/<workflow-id>/artifacts/decisions.md`

Write the complete final specification to the artifact path provided by `expectedOutput.artifact`.

Recommended `specify.md` structure:

```markdown
# Specification

## Goal

## Background

## Scope

## Non-Goals

## Functional Requirements

## Confirmed Decisions

## Constraints and Assumptions

## Acceptance Criteria

## Open Questions
```

`Open Questions` must be empty (or explicitly state `None`) when Specify reports success.

The artifact is the source of detailed requirements. Keep the completion response compact.

## Completion Result

Only after the clarification loop is complete and the final specification has been written, return a concise structured result conceptually equivalent to:

```json
{
  "status": "success",
  "summary": "Specification completed after resolving all material requirements decisions.",
  "artifact": ".dev/workflows/<workflow-id>/artifacts/specify.md"
}
```

If an essential decision cannot be resolved because the user has not answered, continue clarification rather than returning success. Return `failed` only for an actual execution problem that prevents the skill from completing.

## Workflow Approval Is Separate

Do not confuse Specify's internal clarification with the workflow-level approval gate.

The sequence is:

```text
Specify clarification
  → AskUserQuestion
  → record decision
  → continue clarification
  → final specify.md
  → completion command
  → workflow result
  → workflow next
  → workflow.approval_required
  → AskUserQuestion: Approve / Revise
```

The user therefore confirms **individual requirement decisions during Specify**, and separately confirms **the completed Specify artifact before Design begins**.

A successful Specify execution never means the next workflow stage may start automatically.

## Revision

When `input.feedback` is present, first incorporate the feedback into the clarification context. Re-open any requirement boundary affected by the feedback. If the feedback creates a new material ambiguity, use AskUserQuestion again instead of assuming the intended behavior.

Preserve valid existing requirements and decisions that are not affected by the revision.
