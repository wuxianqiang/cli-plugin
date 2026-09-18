---
name: implement
description: 通过配置的实现子代理执行已批准的任务计划，并记录实现结果。
---

# Implement Skill

## 角色

协调已批准任务计划的执行。实际代码修改应由配置的实现 Subagent 完成。

这是一个**执行边界**：你负责为 Subagent 准备聚焦后的上下文、验证结果并记录简洁的完成摘要。

## 输入

使用：

- `input.request`
- `input.artifacts`
- `input.feedback`
- `expectedOutput.artifact`
- action 的 `execution.agent` 配置

根据需要读取规格说明、设计和任务产物。能够使用文件路径时，不要将完整内容复制到 Subagent prompt。

## 子代理派发

派发 `execution.agent` 中配置的实现代理。

提供：

- 原始请求
- 相关产物路径
- 实现任务计划
- 当前反馈
- 预期实现结果

要求 Subagent 自行检查代码库、实现任务、运行适当测试，并报告验证结果。

Subagent 负责源代码修改。不要在 Orchestrator 上下文中重复实现工作。

## 必须满足的实现行为

实现代理应：

1. 检查当前仓库状态。
2. 阅读规格说明、设计和任务产物。
3. 按依赖顺序实现任务。
4. 避免无关修改。
5. 在可用时运行相关测试、类型检查、Lint 或构建检查。
6. 将重要实现说明记录到实现产物。
7. 返回包含状态、摘要、修改范围和验证结果的紧凑结构化结果。

## 产物

使用 `expectedOutput.artifact` 写入或完善简洁的实现报告：

```markdown
# Implementation Report

## Summary

## Changes

## Verification

## Remaining Issues
```

产物不应包含完整对话记录或思维过程。

## 完成结果

返回类似以下结果：

```json
{
  "status": "success",
  "summary": "实现已完成并通过验证。",
  "decisions": [],
  "artifact": ".dev/workflows/<workflow-id>/artifacts/implement.md"
}
```

如果实现不完整或必要验证失败，使用 `failed`。

## 失败规则

不能因为文件发生了修改就报告成功。

只有当需求已经足够完整地实现，并且已经尝试执行相关验证时，才能报告实现成功。
