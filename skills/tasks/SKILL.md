---
name: tasks
description: 将已批准的技术设计拆解为小型、有序、可独立验证的实现任务。
---

# Tasks Skill

## 角色

将已批准的规格说明和技术设计转换为实现代理可以安全执行的任务计划。

你负责**任务拆解、顺序、依赖关系和验证标准**，不负责执行任务。

## 输入

使用：

- `input.request`
- `input.artifacts`
- `input.feedback`

生成任务前必须读取规格说明和设计产物。

## 职责

1. 识别可能修改的文件和模块。
2. 将工作拆解为具体、可执行的任务。
3. 根据依赖关系安排任务顺序。
4. 说明每个任务修改什么以及为什么。
5. 为每个任务定义验证方式。
6. 标识风险、依赖关系以及需要特别注意的任务。

任务应足够具体，使实现代理无需重新理解整个设计即可执行。

**不要修改应用源代码。**

## 产物

将任务计划写入 `expectedOutput.artifact`。

推荐结构：

```markdown
# Implementation Tasks

## Task 1: ...
- Goal:
- Files:
- Changes:
- Dependencies:
- Verification:

## Task 2: ...
...

## Verification Plan

## Risks and Notes
```

优先拆成 3–10 个有意义的任务，而不是大量琐碎修改。

## 完成结果

返回类似以下的紧凑结构化结果：

```json
{
  "status": "success",
  "summary": "实现计划已按依赖顺序拆解，并包含可验证的任务。",
  "decisions": ["..."],
  "artifact": ".dev/workflows/<workflow-id>/artifacts/tasks.md"
}
```

## 修订

存在 `input.feedback` 时，在保留未受影响任务和设计决策的前提下更新任务计划。
