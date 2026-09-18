---
name: review
description: 编排并行代码审查代理，询问用户选择修复或跳过问题，应用选中的修复并验证最终结果。
---

# Review Skill

## 角色

协调配置的 Review Subagent，汇总审查发现，让用户决定哪些可操作问题需要修复，然后应用选中的修复并完成最终验证。

Review 不能仅因为问题已经写入 `review.md` 就算完成。只有当每个发现都有明确的用户决策（`fix` 或 `skip`），并且所有选中的修复都已经实现和验证后，Review 阶段才算完成。

CLI 决定 Review 的执行策略。当 action 指定并行 Subagent 时，独立派发所有配置的代理，并汇总它们的紧凑结果。

## 输入

使用：

- `input.request`
- `input.artifacts`
- `input.feedback`
- `expectedOutput.artifact`
- action 的 `execution.agents`

读取实现产物并检查相关仓库状态。Review Agent 应自行检查源代码，而不是依赖复制到上下文中的代码片段。

## Review Agents

默认 Review Agent 包括：

- `security-review`
- `performance-review`
- `architecture-review`
- `stability-review`

不要静默跳过配置中要求执行的代理。

## 派发

在执行环境支持时，并行运行所有配置的 Review Agent。

每个 Agent 应获得：

- 原始请求
- 相关产物路径
- 实现结果
- 仓库上下文
- 自己负责的审查范围

每个 Agent 必须返回紧凑的结构化结果，也可以写入详细的 Agent 专属产物。

## 汇总

所有必需 Agent 完成后：

1. 收集紧凑结果。
2. 保留每个发现的来源 Agent。
3. 去重重叠问题。
4. 统一严重程度和置信度。
5. 优先处理可执行问题。
6. 在重要时记录无法解决的分歧。
7. 为每个发现分配稳定 ID，例如 `F-001`。
8. 将当前 Review 发现写入 `expectedOutput.artifact`。

每个发现应尽可能包含：

- id
- severity
- confidence
- source agent
- location
- evidence
- impact
- recommended fix

## 用户决策门禁

**不要把第一次 Review 报告视为最终结果。** 汇总发现后，检查哪些问题具有明确的修复建议，并询问用户如何处理。

使用 `AskUserQuestion` 展示可操作的问题。必须支持用户选择性修复，而不能强制全部修复或全部跳过。

例如：

```text
Review 发现 3 个可处理问题：

F-001 [High] 缺少权限检查
建议修复：执行操作前增加权限校验。

F-002 [Medium] API 重复请求
建议修复：使用现有请求缓存进行请求去重。

F-003 [Low] 错误信息丢失上下文
建议修复：保留原始错误码。

请选择需要修复的问题，未选中的问题将记录为跳过。
```

推荐选项：

- `修复 F-001、F-002`
- `修复 F-001、F-002、F-003`
- `全部跳过`
- `自定义选择`

如果发现较多，宿主支持时使用多选问题。用户可以选择任意子集。

用户没有选择的发现属于**跳过**，不能静默遗忘。需要记录用户的决定，以及用户提供的原因。

每个决策记录：

```json
{
  "findingId": "F-001",
  "decision": "fix | skip",
  "reason": "<可选的用户原因>"
}
```

通过 CLI clarification 机制将这些决策持久化到 Review workflow state。Review Skill 必须使用 workflow action 暴露的 CLI 澄清命令，不能自行发明其他 workflow 命令。

## 应用选中的修复

对于每个标记为 `fix` 的发现：

1. 将问题、证据、位置和修复建议派发给实现能力/子代理。
2. 实现代理必须实际修改仓库，而不是只描述修改方式。
3. 对修改后的代码执行针对性验证。
4. 记录实现结果和验证结果。

对于标记为 `skip` 的问题，不得修改仓库。

实现代理只应接收执行该问题所需的相关信息和产物路径，以控制主上下文规模。

## 修复后的重新 Review

选中的修复完成后：

1. 针对更新后的仓库重新运行相关 Review Agent。
2. 验证每个选中的问题是否真正解决。
3. 检查修复是否在受影响区域引入新的回归。
4. 如果选中的问题仍未解决，再次向用户展示更新后的证据和建议处理方式。
5. 如果用户第二次选择跳过，则记录为 `skip`。
6. 如果发现新的可操作问题，为其分配新的 Finding ID，并询问用户修复还是跳过。

这个过程可以重复，直到没有未决用户决策，也没有等待验证的选中修复。

不得在没有用户选择的情况下自动修复新发现的问题。

## 最终 Review 产物

只有完成决策 → 修复 → Review 循环后，才能将最终统一 Review 产物写入 `expectedOutput.artifact`。

推荐结构：

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

最终产物必须区分：

- 已修复并验证的问题
- 用户明确跳过的问题
- 尚未解决的问题（如有）

初始 Review 到最终报告之间，不能有任何问题静默消失。

## 完成结果

只向 Orchestrator 返回紧凑摘要：

```json
{
  "status": "success",
  "summary": "Review 完成：2 个问题已修复并验证，1 个问题由用户选择跳过。",
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

不要向主上下文返回完整 Agent 报告或详细推理。

## 失败规则

如果必需的 Review Agent 失败，通常整个 Review 应返回 `failed`。除非 workflow 明确允许部分覆盖，否则不能把部分 Review 当作完成。

如果选中的修复无法安全实现或验证，应报告失败，并询问用户重试修复还是跳过该问题。未经过验证不得标记为已修复。
