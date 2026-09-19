# CLI-Driven LLM Workflow

A small, dependency-free Node.js workflow runtime for LLM-driven development workflows.

## Protocol

The CLI is the workflow runtime and state authority. The LLM is the executor and decision-maker.

The protocol is intentionally loop-based: **`next` gets an action, the LLM executes it, `result` reports completion, and `next` asks the CLI what happens next.**

```text
                 ┌──────────────┐
                 │     LLM      │
                 └──────┬───────┘
                        │
                 1. next
                        ▼
                 ┌──────────────┐
                 │     CLI      │
                 │ State Engine │
                 └──────┬───────┘
                        │ Action
                        ▼
                 ┌──────────────┐
                 │ LLM executes │
                 │ Skill / Work │
                 └──────┬───────┘
                        │
                 2. result
                        ▼
                 ┌──────────────┐
                 │     CLI      │
                 │ update state │
                 └──────┬───────┘
                        │
                 3. next
                        ▼
                 ┌──────────────┐
                 │ next action  │
                 │ or approval  │
                 └──────────────┘
```

## Commands

```bash
dev-workflow init --name add-modal --request "Add a reusable Modal component"
dev-workflow next --id add-modal --json

dev-workflow clarify \
  --id add-modal \
  --question-id question_1 \
  --question "How should large exports work?" \
  --choice "B" \
  --answer "Use asynchronous export"

dev-workflow result \
  --id add-modal \
  --action ACTION_ID \
  --status success \
  --artifact .dev/workflows/add-modal/artifacts/specify.md

dev-workflow publish \
  --id add-modal \
  --document-id FEISHU_DOCUMENT_ID \
  --url FEISHU_DOCUMENT_URL

dev-workflow comment-review --id add-modal

dev-workflow next --id add-modal --json
dev-workflow approve --id add-modal
dev-workflow revise --id add-modal --feedback "Support ESC to close"
dev-workflow retry --id add-modal
dev-workflow status --id add-modal --json
dev-workflow resume --id add-modal
```

## Interactive Specify

Specify is an interactive requirements-clarification loop, not a one-shot spec generator.

```text
User request
    ↓
Specify analyzes requirements
    ↓
Material ambiguity / boundary?
    ├─ No → continue analysis
    └─ Yes
         ↓
    AskUserQuestion
      ├─ Option A
      ├─ Option B
      ├─ Option C
      └─ Custom
         ↓
    dev-workflow clarify
         ↓
    next → same Specify action
         ↓
    More ambiguity?
      ├─ Yes → AskUserQuestion again
      └─ No → generate specify.md
         ↓
    result → next
         ↓
    workflow.approval_required
         ↓
    Approve / Revise
```

Clarification decisions are persisted in workflow state and should be detailed in `.dev/workflows/<workflow-id>/artifacts/decisions.md`. The final `specify.md` contains only confirmed requirements. Specify must not silently choose between multiple reasonable product behaviors.

## LLM execution loop

```text
next
  ↓
workflow.action
  ↓
LLM executes skill
  ↓
result
  ↓
workflow.result.accepted
  ↓
next
  ↓
┌──────────────────────┐
│ waiting_approval     │ → approve / revise
│ failed               │ → retry
│ ready                │ → workflow.action
│ completed            │ → workflow.completed
└──────────────────────┘
```

`result` does **not** directly advance to the next stage. It only records what the LLM completed. The LLM then calls `next` again, and the CLI decides whether the workflow needs approval, retry, or the next executable stage.

State is stored project-locally under `.dev/workflows/<workflow-id>/`.

## Workflow

```text
specify -> design -> tasks -> implement -> review
```

Each successful stage follows:

```text
artifact.md
   ↓
workflow.publish_required
   ↓
create NEW Feishu document
   ↓
persist version + document_id + url
   ↓
waiting_approval
   ├─ Continue
   ├─ Direct modify
   └─ Pull Feishu comments → modify artifact → create next Feishu version
```

Feishu documents are immutable workflow review snapshots. A new artifact version always creates a new Feishu document; historical documents are never overwritten. Local workflow state stores the persistent mapping between artifact versions and Feishu document IDs/URLs.

Each successful stage enters `waiting_approval` only after its artifact has been published. The next stage starts only after `approve`. Failed stages require `retry`; user changes use `revise` or the Feishu comment review loop.

## Development

Node.js >= 20. No runtime dependencies.

```bash
npm test
node bin/dev-workflow.js init --name demo --request "Add a Modal"
```
