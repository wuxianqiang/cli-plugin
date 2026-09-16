# CLI-Driven LLM Workflow

A small, dependency-free Node.js workflow runtime for LLM-driven development workflows.

## Protocol

The CLI is the workflow runtime and state authority. The LLM is the executor and decision-maker.

The protocol is intentionally loop-based: **`next` gets an action, the LLM executes it, `result` reports completion, and `next` asks the CLI what happens next.**

## Browser SDD Workspace

The workflow can expose a local browser workspace for human-in-the-loop interaction. It shows the full SDD timeline, current stage, artifact preview, annotations, approval actions, and live state updates.

```text
Specify → Design → Tasks → Implement → Review
   ↑
   └── current stage is highlighted in the browser
```

Start it for an existing workflow:

```bash
dev-workflow web --id add-modal
```

The server binds to `127.0.0.1` and uses an available local port by default. The CLI prints the URL and opens the browser when supported. Keep it running while the Agent executes the workflow. For a background process, launch the command with the host shell's background mechanism.

Document stages provide a Markdown preview and allow the user to select text and attach custom annotations. Annotations are stored separately at:

```text
.dev/workflows/<workflow-id>/annotations.json
```

Browser approval/revision actions update the same workflow state used by the CLI. An Agent that needs to wait for a browser decision can use:

```bash
dev-workflow wait --id add-modal
```

`wait` returns when the workflow stage/status changes, allowing the orchestrator to resume with the CLI-provided `next` command.

## Commands

```bash
dev-workflow init --name add-modal --request "Add a reusable Modal component"
dev-workflow web --id add-modal
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

dev-workflow wait --id add-modal
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
    Human decision in Browser / AskUserQuestion
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
      ├─ Yes → human decision again
      └─ No → generate specify.md
         ↓
    result → next
         ↓
    workflow.approval_required
         ↓
    Browser approval / revision
```

Clarification decisions are persisted in workflow state. The final `specify.md` contains only confirmed requirements. Specify must not silently choose between multiple reasonable product behaviors.

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
│ waiting_approval     │ → browser / approve / revise
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

Each successful stage enters `waiting_approval`. The next stage starts only after approval. Failed stages require `retry`; user changes use `revise`.

## Development

Node.js >= 20. No runtime dependencies.

```bash
npm test
node bin/dev-workflow.js init --name demo --request "Add a Modal"
```
