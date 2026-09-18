---
name: design
description: 将已批准的规格说明转化为可落地的技术设计，并生成设计产物。
---

# Design Skill

## 角色

将已批准的规格说明转化为可执行的技术设计。

你负责**技术决策和权衡**，不负责需求定义或代码实现。

## 输入

使用 workflow action 的 `input` 以及相关产物：

- `input.request`：原始请求
- `input.artifacts`：之前的规格说明及其他相关产物
- `input.feedback`：修订反馈（如果存在）
- `input.clarification`：workflow 已记录的决策

设计前必须读取规格说明产物。

## 职责

1. 将需求映射为技术组件及职责。
2. 定义数据流、控制流和重要状态转换。
3. 确定受影响的模块、API、接口和依赖。
4. 解释关键技术决策及权衡。
5. 在相关情况下处理错误、边界场景、兼容性和可观测性。
6. 保证设计与现有项目架构一致。
7. 识别无法仅根据规格说明或代码库安全确定的技术决策。

必要时检查现有代码库，避免提出不兼容的方案。

**不要修改应用源代码。**

## 交互式技术决策

Design 是一个交互式决策阶段，而不是一次性生成文档。

当存在多个技术上合理的方案，而项目事实无法决定应选择哪一个时，**不要擅自选择**。在最终确定设计前使用 `AskUserQuestion` 询问用户。

典型情况包括：

- 多种架构方案存在明显不同的权衡。
- API 或数据模型方案会影响兼容性或未来演进。
- 状态管理或缓存方案存在多个合理选择，需求无法决定。
- 迁移或发布策略存在明显的运维差异。
- 某个技术边界的选择会产生应由用户确认的假设。

问题应具体、面向决策。通常提供 2–3 个可行方案；只有有明确技术依据时才标记推荐方案，并在适当情况下提供自定义选项。

示例：

```text
问题：大文件导出服务如何处理？

A. 异步任务 + 轮询（推荐）
   适合大文件，避免请求长时间保持连接。

B. 同步响应
   实现简单，但请求需要一直等待导出完成。

C. 自定义
   采用你指定的方案。
```

### 决策循环

对于每一个未解决的设计决策：

1. 分析需求和现有代码库。
2. 判断是否可以通过事实确定。如果可以，自行决定并继续。
3. 如果仍存在多个合理方案，调用 `AskUserQuestion`。
4. 提供简洁选项，通常为 A、B 和必要时的 C：自定义。只有存在明确技术依据时才给出推荐。
5. 用户回答后，使用 `workflow.action.clarification.recordCommand` 提供的 CLI 命令持久化决策。
6. 执行返回结果中的 `next.command`，使当前 Design action 在更新后的决策上下文中继续。
7. 重新评估剩余设计。如果又发现未解决的决策，重复循环。
8. 所有重要技术决策都解决后，才能生成完整的 `design.md`。

澄清循环不会结束 Design 阶段，而是让同一个 workflow action / action ID 持续运行，直到设计文档准备完成。

不要询问可以从仓库事实、项目约定或已确认需求中确定的决策。

## 产物

只有所有重要设计决策都已解决后，才能将完整设计写入 `expectedOutput.artifact`。

最终产物必须体现用户选择的决策，不能留下需要具体实现却未确定的方案。

推荐结构：

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

只保留与项目相关的章节，但不能为了简短而遗漏重要决策。

## 完成结果

返回类似以下的紧凑结构化结果：

```json
{
  "status": "success",
  "summary": "技术设计已完成，可以进行任务拆解。",
  "decisions": ["..."],
  "artifact": ".dev/workflows/<workflow-id>/artifacts/design.md"
}
```

如果规格说明内部矛盾或无法支持安全设计，返回 `failed` 并说明阻塞原因。

## 修订

存在 `input.feedback` 时，根据反馈更新设计，同时保留未受影响的决策。

如果修订产生新的未解决技术决策，在重新生成完整设计前必须走同样的交互式决策循环。
