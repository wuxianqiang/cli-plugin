# CLI-Driven LLM Workflow

A small, dependency-free Node.js workflow runtime for LLM-driven development workflows.

## Protocol

The CLI is the workflow runtime and state authority. The LLM is the executor and decision-maker.

```text
LLM -> next -> CLI -> Action -> LLM executes Skill
LLM -> result -> CLI -> State/Transition -> LLM
```

## Commands

```bash
dev-workflow init --name add-modal --request "Add a reusable Modal component"
dev-workflow next --id add-modal --json
dev-workflow result --id add-modal --action ACTION_ID --status success --artifact .dev/workflows/add-modal/artifacts/specify.md
dev-workflow approve --id add-modal
dev-workflow revise --id add-modal --feedback "Support ESC to close"
dev-workflow retry --id add-modal
dev-workflow status --id add-modal --json
dev-workflow resume --id add-modal
```

State is stored project-locally under `.dev/workflows/<workflow-id>/`.

## Workflow

```text
specify -> design -> tasks -> implement -> review
```

Each successful stage enters `waiting_approval`. The next stage starts only after `approve`. Failed stages require `retry`; user changes use `revise`.

## Development

Node.js >= 20. No runtime dependencies.

```bash
npm test
node bin/dev-workflow.js init --name demo --request "Add a Modal"
```
