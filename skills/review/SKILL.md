---
name: review
description: Orchestrates parallel code review agents, asks the user which findings to fix or skip, applies selected fixes, and verifies the final result.
---

# Review Skill

## Role

Coordinate the configured review Subagents, aggregate their findings, let the user decide which actionable findings should be fixed, apply the selected fixes, and produce one final verified review result.

A review is not complete merely because findings have been written to `review.md`. The review stage is complete only after every finding has an explicit user decision (`fix` or `skip`) and all selected fixes have been implemented and verified.

The CLI declares the review execution strategy. When the action specifies parallel Subagents, dispatch all configured agents independently and aggregate their compact results.

## Input

Use:

- `input.request`
- `input.artifacts`
- `input.feedback`
- `expectedOutput.artifact`
- the action's `execution.agents`

Read the implementation artifact and inspect the relevant repository state. Review agents should inspect source code themselves rather than relying on copied snippets.

## Review Agents

The default review group is:

- `security-review`
- `performance-review`
- `architecture-review`
- `stability-review`

Do not silently omit a configured required agent.

## Dispatch

Run configured review agents in parallel when supported by the execution environment.

Each agent should receive:

- original request
- relevant artifact paths
- implementation result
- repository context
- its specific review scope

Each agent must return a compact structured result and may write a detailed agent-specific artifact.

## Aggregation

After all required agents finish:

1. Collect their compact results.
2. Preserve source-agent provenance for every finding.
3. Deduplicate overlapping findings.
4. Normalize severity and confidence.
5. Prioritize actionable issues.
6. Record unresolved disagreements when they matter.
7. Give every finding a stable identifier such as `F-001`.
8. Write the current review findings to `expectedOutput.artifact`.

Every finding should include, when applicable:

- id
- severity
- confidence
- source agent
- location
- evidence
- impact
- recommended fix

## User Decision Gate

**Do not treat the first review report as the final result.** After findings are aggregated, inspect which findings have a concrete recommended fix and ask the user what should happen.

Use `AskUserQuestion` to present the actionable findings. The question must support selective decisions rather than forcing all findings to be fixed or all findings to be skipped.

For example:

```text
Review found 3 actionable findings:

F-001 [High] Missing permission check
Recommended fix: validate the permission before executing the operation.

F-002 [Medium] Repeated API request
Recommended fix: deduplicate requests with the existing request cache.

F-003 [Low] Error message loses context
Recommended fix: preserve the original error code.

Choose which findings to fix. Findings not selected will be recorded as skipped.
```

Recommended choices:

- `Fix F-001, F-002`
- `Fix F-001, F-002, F-003`
- `Skip all`
- `Custom selection`

If there are many findings, use a multi-select question when the host supports it. The user may select any subset.

A finding that the user does not select is **skipped**, not silently forgotten. Record the user's decision and rationale when provided.

For each decision, record:

```json
{
  "findingId": "F-001",
  "decision": "fix | skip",
  "reason": "<optional user reason>"
}
```

Persist these decisions in the review workflow state through the CLI clarification mechanism. The Review Skill must use the CLI-generated clarification command exposed by the workflow action; it must not invent a different workflow command.

## Applying Selected Fixes

For every finding marked `fix`:

1. Dispatch the implementation capability/subagent with the finding, evidence, location, and recommended fix.
2. The implementation agent must modify the repository, not merely describe the change.
3. Run focused verification for the changed code.
4. Record the implementation result and verification.

Do not modify the repository for findings marked `skip`.

The implementation agent should receive only the relevant finding information and artifact paths needed to perform the fix, keeping the main context small.

## Re-review After Fixes

After selected fixes finish:

1. Re-run the relevant review agents against the updated repository.
2. Verify that each selected finding is actually resolved.
3. Check that the fix did not introduce a new regression in the affected area.
4. If a selected finding remains unresolved, present it to the user again with its updated evidence and recommended next action.
5. If the user chooses to skip it on the second decision, record it as skipped.
6. If new actionable findings are discovered, assign new finding IDs and ask the user whether to fix or skip them.

This can repeat until there are no unresolved user decisions and no selected fixes awaiting verification.

Do not automatically fix newly discovered issues without user selection.

## Final Review Artifact

Only after the decision/fix/review loop is complete, write the final unified review artifact to `expectedOutput.artifact`.

Recommended artifact structure:

```markdown
# Review Report

## Summary

## Findings

### Critical

### High

### Medium

### Low

## User Decisions

| Finding | Decision | Reason |
|---|---|---|
| F-001 | Fix | ... |
| F-002 | Skip | ... |

## Applied Fixes

## Verification

## Agent Coverage

## Remaining Risks

## Recommended Actions
```

The final artifact must distinguish:

- fixed and verified findings
- explicitly skipped findings
- unresolved findings, if any

There must be no finding that silently disappears between the initial review and the final report.

## Completion Result

Return only a compact summary to the Orchestrator:

```json
{
  "status": "success",
  "summary": "Review completed: 2 findings fixed and verified, 1 finding skipped by the user.",
  "findings": [
    {
      "id": "F-001",
      "severity": "high",
      "title": "...",
      "decision": "fix",
      "status": "verified",
      "source": "security-review"
    },
    {
      "id": "F-002",
      "severity": "medium",
      "title": "...",
      "decision": "skip",
      "status": "skipped",
      "source": "performance-review"
    }
  ],
  "artifact": ".dev/workflows/<workflow-id>/artifacts/review.md"
}
```

Do not return complete agent reports or detailed reasoning in the main context.

## Failure Rules

If a required review agent fails, the review is normally `failed`. Do not present a partial review as complete unless the configured workflow explicitly permits partial coverage.

If a selected fix cannot be safely implemented or verified, report the failure and ask the user whether to retry the fix or skip that finding. Do not mark it as fixed without verification.
