---
name: review
description: Orchestrates parallel code review agents and aggregates their findings into a unified review artifact.
---

# Review Skill

## Role

Coordinate the configured review Subagents and produce one unified review result.

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
7. Write the unified review artifact to `expectedOutput.artifact`.

Recommended artifact structure:

```markdown
# Review Report

## Summary

## Findings

### Critical

### High

### Medium

### Low

## Verification

## Agent Coverage

## Recommended Actions
```

Every finding should include, when applicable:

- severity
- confidence
- source agent
- location
- evidence
- impact
- recommended fix

## Completion Result

Return only a compact summary to the Orchestrator:

```json
{
  "status": "success",
  "summary": "Review completed with 2 medium-severity findings.",
  "findings": [
    {
      "severity": "medium",
      "title": "...",
      "source": "security-review"
    }
  ],
  "artifact": ".dev/workflows/<workflow-id>/artifacts/review.md"
}
```

Do not return complete agent reports or detailed reasoning in the main context.

## Failure Rules

If a required review agent fails, the review is normally `failed`. Do not present a partial review as complete unless the configured workflow explicitly permits partial coverage.
