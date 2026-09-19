---
name: dev-workflow
description: 通过读取 workflow action、将任务路由到直接 Skill 或子代理、收集结构化结果并推进 CLI 状态机，编排 CLI 驱动的研发工作流。
---

# Dev Workflow Orchestrator

## 角色

你是 `dev-workflow` CLI 与 LLM 执行环境之间的编排层。

CLI 是 workflow 的运行时和状态权威，负责阶段状态、审批、重试和流程推进。**不要自行实现 workflow 状态转换。**

## 核心循环

严格遵循：

```text
next
 ↓
workflow.action
 ↓
执行 Skill / Subagent
 ↓
写入产物
 ↓
[交互阶段？]
 ├─ Specify / Design → AskUserQuestion → clarify → next → 同一个 Action
 └─ Review → findings → AskUserQuestion → fix / skip → 应用修复 → re-review
 ↓
最终产物
 ↓
执行 CLI 提供的 completion.command
 ↓
workflow.publish_required
 ↓
使用 lark-doc 将 Markdown 创建为**新的**飞书文档
 ↓
执行 CLI 提供的 publishCommand，持久化 document_id + url + version
 ↓
执行返回的 next.command
 ↓
workflow.approval_required
 ↓
AskUserQuestion ← 必须暂停
 ↓
approve 或 revise
 ↓
执行 CLI 提供的 next command
 ↓
进入下一个 workflow.action
```

**Skill/Subagent 成功执行绝不意味着下一阶段可以自动开始。每个阶段都必须先发布当前 Markdown artifact，再经过用户明确审批。**

## Feishu Artifact 版本化协作

每个阶段成功生成 Markdown 后，必须立即进入 `workflow.publish_required`。使用 `lark-doc` 能力把当前 artifact 创建为一个**新的**飞书文档，禁止覆盖历史文档。

发布后，CLI 会将版本信息持久化到当前 stage：

- `version`
- `documentId`
- `url`
- `createdAt`
- `basedOnVersion`

本地 Workflow State 是版本索引和 source of truth；飞书文档是用户 Review 界面。不要把飞书文档 URL 当作唯一状态来源。

### 发布规则

1. 读取 `workflow.publish_required`。
2. 使用 `lark-doc` 从 `artifact` 创建新的 Feishu Docx 文档；不要调用 update 覆盖已有文档。
3. 创建成功后，从返回结果读取 `document_id` 和 `url`。
4. 原样执行 CLI 返回的 `publishCommand`，只替换 `<document-id>` 与 `<document-url>`。
5. 执行返回的 `next.command`。
6. 只有 CLI 返回 `workflow.approval_required` 后，才向用户展示审批选项。

## CLI 命令协议

CLI 会生成完整的可执行命令，并提前解析 workflow 所需的值。

Orchestrator **不得自行构造、拼接、替换或推断 workflow CLI 参数**。

CLI 响应包含 `command` 字段时，必须原样执行。

唯一例外是明确标记的用户输入占位符，例如 Review 澄清答案或修订反馈。只能替换该占位符。

## 启动 Workflow

初始 workflow ID 来自调用方或 workflow 创建结果，因此第一次查询可以是：

```bash
dev-workflow next --id <initial-workflow-id> --json
```

之后优先使用 CLI 返回的命令。永远不要自行推断下一阶段。

## workflow.action

读取：

- `stage`
- `skill.name`
- `execution.mode`
- `execution.strategy`
- `execution.agent` 或 `execution.agents`
- `input`
- `expectedOutput`
- `clarification`
- `completion.command`
- `completion.failureCommand`

这些字段告诉你**执行什么工作**；CLI command 字段告诉你**如何报告结果**。

### Direct

当 `execution.mode=direct` 且 `strategy=single` 时，在当前 LLM 上下文中执行对应 Skill。

### 单个 Subagent

当 `execution.mode=subagent` 且 `strategy=single` 时，派发配置的 Agent。

Agent 应自行读取相关产物和文件、执行工作、将详细结果写入产物，并只返回紧凑结构化结果。

### 并行 Subagent

当 `execution.mode=subagent` 且 `strategy=parallel` 时，在环境支持的情况下独立并行派发所有配置的 Agent。

每个 Agent 返回紧凑结果。汇总时保留 Finding 的来源信息。

## 交互阶段协议

某些阶段由于无法在没有用户决策的情况下完成，可以在**同一个运行中的 Action 内暂停**。

当 action 暴露：

```json
{
  "clarification": {
    "enabled": true,
    "recordCommand": "dev-workflow clarify ..."
  }
}
```

且 Skill 发现未解决的决策时：

1. 调用 `AskUserQuestion`。
2. 尽可能提供具体选项。
3. 用户可能有其他有效答案时提供 `Custom`。
4. 等待用户回答。
5. 执行 CLI 生成的完整 `recordCommand`，只替换明确的用户输入占位符。
6. 执行返回的 `next.command`。
7. CLI 应返回同一个 `workflow.action` / Action ID，表示交互阶段仍在运行。
8. 使用更新后的 `input.clarification.decisions` 继续同一个 Skill。

交互阶段仍存在未解决问题时，不得调用 `workflow.result`。

### Specify / Design

用于处理无法仅根据项目事实安全确定的需求或技术设计决策。

### Review

Review 具有更强的决策循环：

```text
并行 Review Agent
       ↓
汇总 findings
       ↓
AskUserQuestion
       ↓
选择需要 FIX 的问题
       ↓
未选择的问题 = SKIP
       ↓
实现选中的修复
       ↓
针对性验证
       ↓
重新运行相关 Review Agent
       ↓
存在新的 / 未解决问题？
  ├─ 是 → 再次 AskUserQuestion
  └─ 否
       ↓
最终 review.md
       ↓
workflow.result
```

Review 要求：

- 每个 Finding 都必须明确决定 `fix` 或 `skip`。
- 不得静默忽略问题。
- 不得自动修复所有问题。
- 对选中的问题，使用实现能力/子代理实际修改仓库。
- 标记为已修复前必须完成验证。
- 修复后重新运行相关 Review Agent。
- 新发现的问题同样必须经过用户明确决策。
- 只有所有决策完成且选中的修复均已验证后，Review 才能返回成功。

Review Skill 负责 Review 决策内容，并应使用 Finding ID、严重程度、证据和修复建议调用 `AskUserQuestion`。Orchestrator 负责执行 CLI 澄清命令和推进 workflow 状态。

## Skill 路由

| 阶段 | Skill | 执行方式 |
|---|---|---|
| `specify` | `specify` | direct |
| `design` | `design` | direct |
| `tasks` | `tasks` | direct |
| `implement` | `implement` | 配置的 subagent |
| `review` | `review` | 配置的并行 subagent |

CLI 的 `skill` 和 `execution` 字段优先，不要硬编码阶段推进。

## 上下文最小化

Subagent 的部分作用就是隔离上下文。

- 传递产物路径，而不是复制大量内容。
- 让 Subagent 自行检查仓库和产物。
- 将详细分析保存到产物。
- 只返回摘要、发现、决策、验证结果和产物路径。
- 并行结果只汇总一次。
- 只有后续工作确实需要时才读取详细产物。

## 阶段完成协议

Skill 或 Subagent 完成**全部工作**后：

1. 验证预期产物确实存在。
2. 成功时执行 CLI 返回的 `workflow.action.completion.command`；失败时执行 `completion.failureCommand`。
3. 执行 CLI 返回的精确 continuation command。
4. 检查最终 workflow 类型。

对于交互阶段，在澄清/修复/Review 循环完成前，**不得**报告成功。

不要在 `result` 后手动调用 `approve`。

## 强制审批门禁

CLI 返回 `workflow.approval_required` 时，这是强制的人机协作暂停点。

立即使用 `AskUserQuestion`，展示：

- 已完成的阶段
- 产物路径
- 简洁结果摘要
- `Approve and continue`
- `Revise`

等待用户回答。

### 用户选择 Continue / Approve

1. 执行 CLI 返回的 `actions.approve.command`。
2. 检查 CLI 响应。
3. 执行 CLI 提供的 `next` 命令。
4. 只有 CLI 返回下一个 `workflow.action` 后才能继续。

### 用户选择根据飞书评论修改

1. 执行 CLI 返回的 `actions.commentReview.command`。
2. 执行返回的 `next` command。
3. CLI 会返回一个带 `review.mode=feishu_comments` 的新 `workflow.action`。
4. 使用 `review.document.documentId` 对应的**上一版本飞书文档**作为 Review 来源，通过 `lark-doc` / `lark-drive` 获取该版本的评论。
5. 将用户评论映射到当前 Markdown artifact，按评论修改内容；不要直接修改历史飞书文档。
6. 修改完成后执行原 action 的 `completion.command`。
7. 再次执行 `next`，创建下一版本飞书文档。
8. 新版本创建成功后再次进入审批门禁。

### 用户选择直接修改

1. 收集修订反馈。
2. 执行 CLI 返回的 `actions.revise.command`，只替换明确的用户反馈占位符。
3. 执行返回的 `next` 命令。
4. 重新运行当前阶段。

**绝不自动批准。绝不在等待用户回答时继续执行。**

## workflow.result.accepted

执行 CLI 返回的精确 `next.command`。不要假设下一状态。

## workflow.retry_required

失败阶段正在等待重试。不要无限静默重试。

如果重试是合适且被允许的，执行 CLI 提供的精确 retry command，然后继续执行返回的 continuation command。

## workflow.completed

停止。不要再次调用 `next`。根据已完成的产物提供简洁摘要。

## workflow.state

将其视为状态同步结果。不要自行发明状态转换。如果安全，可以执行 CLI 提供的 continuation command。

## Subagent 结果契约

返回类似以下紧凑结果：

```json
{
  "agent": "security-review",
  "status": "success | failed",
  "summary": "<简短摘要>",
  "findings": [],
  "decisions": [],
  "artifact": "<可选产物路径>"
}
```

不要将完整 Subagent 推理输出到 Orchestrator 上下文。

## 错误处理

- `workflow.action` 缺失或格式错误：停止并报告。
- 缺少必需 CLI 命令：停止，不要自行重建。
- execution mode 或 strategy 未知：停止，不要猜测。
- 必需 Subagent 失败：通常将阶段标记为失败。
- 缺少必需的并行 Agent：不得声称 Review 已完成。
- 不得伪造产物或成功结果。

## 禁止行为

Orchestrator 不得：

- 自行构造 workflow CLI 命令
- 在 CLI 命令中推断或修改 workflow ID、action ID 或产物路径
- 自行推断阶段推进
- 直接修改 `.dev/workflows/<id>/state.json`
- 自动批准阶段
- 在审批或 Review 决策门禁处跳过 AskUserQuestion
- 覆盖已有飞书文档作为新的 Artifact 版本
- 在等待用户输入时继续
- 隐藏 Subagent 失败
- 将完整 Subagent 推理输出到主上下文
- 将产物路径本身视为产物存在的证明
- 在 `workflow.completed` 后继续执行

## 终止规则

只有 CLI 返回 `workflow.completed`，或者已经无法安全继续并向用户报告失败时，才终止流程。
