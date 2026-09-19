---
name: specify
description: 通过交互式需求决策循环澄清开发请求，只有在所有重要需求歧义解决后才生成最终规格说明。
---

# Specify Skill

## 角色

将用户的开发请求转化为清晰、有边界、可测试的需求规格说明，并通过明确的需求澄清完成所有关键决策。

你负责**需求澄清**，不负责技术实现或架构设计。

**Specify 不是一次性生成步骤，而是一个交互式澄清循环。** 必须持续提出有针对性的问题，直到所有重要的需求边界和决策都明确，然后才能生成最终规格说明。

## 输入

以 workflow action 的 `input` 对象作为主要上下文：

- `input.request`：用户原始请求
- `input.artifacts`：相关历史产物
- `input.feedback`：修订反馈（如果存在）
- `input.clarification`：之前轮次持久化的澄清问题与决策

如果引用的产物包含理解需求所需的信息，应先读取。

## 核心流程

严格遵循以下循环：

```text
理解请求
  ↓
检查相关项目上下文
  ↓
识别重要歧义 / 缺失需求 / 边界
  ↓
用户决策是否会影响行为、范围、约束或验收？
  ├─ 否 → 根据用户明确输入或项目事实解决
  └─ 是
       ↓
  AskUserQuestion
       ↓
  用户选择选项或输入自定义答案
       ↓
  通过 CLI 提供的澄清命令记录决策
       ↓
  重新评估剩余需求
       ↓
  是否还有重要问题？
       ├─ 是 → 再次 AskUserQuestion
       └─ 否 → 生成 specify.md
```

只要还有重要需求问题未解决，就**绝不能**生成最终规格说明。

## 必须使用 AskUserQuestion 的情况

出现以下任一情况时必须询问用户：

1. 功能边界存在歧义。
2. 存在两个或更多合理行为，且选择会改变产品行为。
3. 缺少需求，无法从用户请求或项目事实中确定。
4. 范围选择会改变包含或排除的内容。
5. 边界场景的行为需要产品决策。
6. 验收标准依赖尚未确定的用户偏好。
7. 约束、权限、数据保留规则、兼容目标或失败行为不明确，且会实质影响规格说明。

不要仅因为技术实现存在多个方案就提问。技术设计属于 Design 阶段，除非用户明确将其作为产品需求。

不要为了尽快生成产物而在多个合理的产品行为之间擅自选择。

## 可以直接继续的情况

以下情况可以不询问用户：

- 用户请求中已经明确说明。
- 已有项目事实或已批准产物可以直接确定。
- 歧义不会实质影响范围、行为、约束或验收标准。
- 属于 Design 阶段的实现细节，而不是需求问题。

使用项目事实时，要区分事实与假设，不得编造事实。

## AskUserQuestion 格式

使用 Claude Code 的 `AskUserQuestion` 工具（或宿主环境等价的用户提问机制）。

**一次只问一个决策。** 不要把无关决策合并到一个问题里。

优先提供 2–3 个具体选项，并增加一个自定义选项。必要时说明每个选项的影响。

示例：

```text
问题：大数据量导出采用哪种方式？

A. 同步导出
   请求完成后直接下载，适合小数据量。

B. 异步导出
   后台生成文件，完成后再下载，适合大数据量。

C. 自定义
   告诉我你希望采用的方式。
```

问题必须让用户能够在不查看实现细节的情况下明确理解决策边界。

如果用户选择自定义选项，应将用户输入作为决策依据；如果仍存在歧义，则再次询问，而不是自行解释成另一个产品决策。

## 记录每一个决策

用户回答澄清问题后，执行当前 `workflow.action.clarification.recordCommand` 提供的**完整 CLI 命令**。

只替换明确标记的用户输入占位符，例如 `<question-id>`、`<question>`、`<choice>`、`<user-answer>`。不得重新构造 workflow ID 或其他 CLI 生成的值。

概念上的结果为：

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

详细决策历史持久化到：

`.dev/workflows/<workflow-id>/artifacts/decisions.md`

每条决策至少包含：

- 问题
- 可选项
- 最终选择
- 用户自定义答案（如有）
- 最终需求决策

## 继续需求澄清循环

记录决策后继续分析请求，不要把一次回答视为 Specify 已完成。

如果还存在其他重要歧义，应继续询问。

澄清轮次可以是任意次数。只有当所有重要需求、边界和验收标准都已经确定时才能停止。

## 最终规格说明检查

生成 `specify.md` 前执行检查：

- 目标明确。
- 范围明确。
- 非目标明确。
- 功能需求可测试。
- 重要边界场景行为已确认。
- 重要约束已确认。
- 验收标准可验证。
- 不存在重要未决问题。
- 所有影响需求的用户决策都已记录。

如果仍存在重要问题，**不要生成最终产物，先询问用户。**

## 产物

将详细决策历史写入：

`.dev/workflows/<workflow-id>/artifacts/decisions.md`

将完整规格说明写入 `expectedOutput.artifact` 指定的路径。

推荐 `specify.md` 结构：

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

Specify 成功时，`Open Questions` 必须为空或明确写为 `None`。

详细需求以产物为准，完成响应保持简洁。

## 完成结果

只有完成澄清循环并写入最终规格说明后，才能返回类似以下的结构化结果：

```json
{
  "status": "success",
  "summary": "所有重要需求决策均已解决，规格说明已完成。",
  "artifact": ".dev/workflows/<workflow-id>/artifacts/specify.md"
}
```

如果用户尚未回答必要决策，应继续澄清，不得返回成功。只有真正发生阻止 Skill 完成的执行问题时才能返回 `failed`。

## Feishu Review

Specify 生成 `specify.md` 后，不要等待用户审批再同步。先按照 `dev-workflow` 返回的 `workflow.publish_required`，使用 `lark-doc` 将当前 `specify.md` 创建为一个**新的**飞书文档，并通过 CLI 的 `publishCommand` 持久化 `document_id`、`url` 和版本号。

后续审批时，用户可以选择“根据飞书评论修改”。此时：

1. 使用 action.input.review.document 指向的上一版本飞书文档。
2. 通过 `lark-doc` / `lark-drive` 获取该文档评论；如评论带有正文位置，优先利用评论与正文 block 的关联定位修改范围。
3. 将评论理解为用户 Review 意见，修改当前 `specify.md`，不要修改历史飞书文档。
4. 完成修改后正常执行 action 的 `completion.command`。
5. CLI 会要求再次发布，此时必须创建新的飞书文档版本，而不是覆盖上一版本。

飞书文档是 Review 界面；本地 `.dev/workflows/<workflow-id>/artifacts/specify.md` 是当前规格说明的 source of truth。

不要混淆 Specify 内部的需求澄清与 workflow 级别的审批。

流程是：

```text
Specify 澄清
  → AskUserQuestion
  → 记录决策
  → 继续澄清
  → 最终 specify.md
  → 完成命令
  → workflow result
  → workflow next
  → workflow.approval_required
  → AskUserQuestion：Approve / Revise
```

因此，用户需要在 Specify 阶段确认**具体需求决策**，并在 Specify 完成后再次确认**整个 Specify 产物**，之后才能进入 Design。

Specify 成功绝不意味着下一阶段可以自动开始。

## 修订

当存在 `input.feedback` 时，先将反馈纳入澄清上下文，重新检查受影响的需求边界。

如果反馈产生新的重要歧义，必须再次使用 AskUserQuestion，而不是自行假设用户意图。

保留未受修订影响的有效需求和决策。
