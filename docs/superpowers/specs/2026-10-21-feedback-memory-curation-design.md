# 临床 Agent 反馈与定时记忆整理设计

日期：2026-10-21

状态：待用户审阅

## 摘要

测试阶段建立两条低负担的反馈入口：

1. 同事直接与被测 Agent 对话，由 Agent 把明确的问题、纠正和期望记录成结构化反馈。
2. 同事填写一个极简 Excel；每行只要求写“实际问题”，其余字段尽量通过下拉框或自动补充完成。

General Agent 每周读取新增反馈、Excel 和相关对话证据，完成去重、聚类和冲突识别，生成候选
记忆。管理员审核后，把通过的内容发布成只读、带版本的知识包，供相关业务 Agent 在下一周使用。

第一期只允许公司级与能力级知识进入共享知识包，不发布个人级长期记忆。该机制不训练模型权重，
也还不是完整的 RSI；它负责收集经验、形成题库和改进候选。

## 目标

- 同事在真实工作中发现问题时，可以在一分钟内留下反馈。
- Agent 自动记录足够的来源、证据和上下文，使问题可以复现和判断。
- 对话反馈与 Excel 反馈能够合并，但互不覆盖。
- 相似问题进入同一 Issue Cluster，重复报告不重复处理。
- 相互矛盾的要求保留为 Conflict Group，不强行取平均。
- 每周生成一个固定版本的只读知识包，可审核、可追溯、可回滚。
- 原始反馈、长期知识、长任务中间状态和 RSI Benchmark 严格分层。
- 反馈基础设施不进入 RSI 的自动优化范围。

## 非目标

- 不训练或微调模型权重。
- 不允许被测 Agent 在测试阶段实时改写自己的长期记忆。
- V0 不提供个人级长期记忆。
- V0 不建设完整的反馈管理后台。
- 不自动发布未经管理员审核的知识。
- 不把未审核的同事反馈直接送入 RSI。
- 不替换现有的评估中心、Benchmark、快照或 RSI 工具包。

## 核心概念

- **Issue Report**：一条独立问题记录，包含用户原话、实际表现、期望、证据和 Session 信息。
- **Issue Cluster**：具有相同能力、现象和可能根因的一组问题。
- **Conflict Group**：不能同时成立或同时应用的一组意见。
- **Memory Candidate**：经过聚类后提炼出的候选长期规则。
- **Memory Pack**：经管理员审核的只读知识包，分版本发布。
- **长任务中间状态**：scratchpad、计划、Goal 状态和上下文压缩摘要，只服务当前 Session。
- **RSI**：以冻结 Benchmark 和评分为依据，生成并测量 Harness 候选，只保留严格提分的版本。

## 分层边界

| 机制 | 生命周期 | 作用 |
| --- | --- | --- |
| Session 上下文、scratchpad、压缩摘要 | 单个 Session | 保持当前任务连续 |
| Issue Report | 长期保留，直到归档 | 保存原始经验和证据 |
| Memory Pack | 按周发布 | 提供经审核的稳定知识 |
| Benchmark 与 RSI | 跨 Agent 版本 | 测量和筛选能力改动 |

信息只能向上提升，不能反向自动写入：

```text
对话 / Excel / Agent 自述
           |
           v
       Issue Report
           |
           v
   聚类 / 重复 / 冲突识别
           |
           v
       管理员审核
           |
           +------> Memory Pack
           |
           +------> Skill / Prompt 候选
           |
           +------> Benchmark Case
```

## 组件

新增一个插件 `clinical-feedback-loop`，包含三个 Skill：

1. `feedback-capture`
   - 安装在被测 Agent：CRF Reviewer、SAP Author、Table Shell Author。
   - 识别明确反馈并写出 Issue Report。
   - 不修改 Memory、Skill、Prompt 或 Hook。

2. `feedback-curator`
   - 安装在 General Agent。
   - 导入 Excel，读取 Issue Report，规范化、去重、聚类并识别冲突。
   - 生成每周审核包和 Memory Candidate。

3. `curated-memory-reader`
   - 安装在需要长期知识的业务 Agent。
   - 只读取当前激活的 Memory Pack 索引。
   - 没有写入能力，不参与反馈收集或知识发布。

插件还包含：

- 极简 Excel 模板；
- Issue Report JSON Schema；
- Feedback 分类字典；
- Memory Candidate 与 Memory Pack Schema；
- 每周审核包模板。

## 数据目录

建议使用 Project 级目录，具体根路径在实现时沿用现有数据目录约定：

```text
feedback/
├── inbox/
│   └── <user_id>/<yyyy-mm-dd>/<feedback_id>.json
├── normalized/
├── clusters/
├── conflicts/
├── reviews/<yyyy-mm-dd>/
├── decisions/
├── memory-packs/<version>/
│   ├── manifest.yaml
│   ├── MEMORY.md
│   ├── entries/
│   └── changelog.md
└── active-memory-pack.json
```

`active-memory-pack.json` 只记录当前版本和内容哈希。切换版本或回滚时只改这个指针，不改历史包。

## V0 记忆策略

PH 当前的 `memory.enabled` 同时控制是否注入记忆和是否准备记忆目录，不能直接表达“可读不可写”。因此
V0 采用以下策略：

- 被测 Agent 的原生长期 Memory 保持关闭。
- 每周整理后的知识通过只读 Memory Pack 提供。
- `curated-memory-reader` 根据激活指针读取一个小型索引。
- 只有 General Agent 和管理员能够创建或发布新 Pack。
- 被测 Agent 没有 Pack 写权限。

后续可增加原生 `memory.mode = curated_read_only`，但不改变本设计的数据流。

## 共享知识范围

V0 只允许：

- `scope: company`
- `scope: capability`

不允许 `scope: user`。个人偏好、单个同事的习惯和只适用于某个客户/项目的事实不进入共享知识包。

能力级知识必须写明适用范围：

```yaml
applies_to:
  - crf-review
  - sap-authoring
  - tfl-shell-authoring
```

项目级知识保留在 Workspace 或组织 Handbook，不自动升级为公司级规则。

## 对话自动记录

### 触发条件

`feedback-capture` 在以下情况记录：

- 用户明确说“记一下”“这是一个问题”“应该改成……”；
- 用户明确纠正 Agent 的事实、格式或流程；
- Agent 在任务中发现无法自行消解的要求冲突；
- 用户要求把某项不满或改进建议提交给管理员。

普通讨论、备选方案和 Agent 自己的猜测不能当作反馈。

### Issue Report

每条报告是不可变的独立 JSON。原始报告不修改；后续补充通过新报告链接原报告：

```yaml
id: FB-2026-10-21-0001
created_at: 2026-10-21T10:30:00+08:00
source: colleague_test
project_id: default_project
agent_id: co_test_sap
capability: sap-authoring
user_id: user-123
session_id: session-...
trace_path: ...
workspace: ...
case_id: null
observed: SAP 在方案没有规定时写入了缺失数据方法
expected: 应保持未决，并登记为 open question
category: unsupported_claim
severity: high
evidence:
  - artifact: outputs/sap-draft.docx
    locator: Section 8.5
  - trace: session-...
root_cause_hint:
  - skill
  - prompt
status: new
sensitivity: internal
```

自动补充的信息包括：

- 原始用户措辞；
- 模型和思考等级；
- 与该问题相关的工具调用；
- 输入和输出的哈希；
- 来源是同事测试还是 RSI 评估；
- 脱敏说明；
- 是否与已有报告相似。

### 记录规则

- 一条报告只写一个独立问题。
- 用户原话和 Agent 概括分字段保存。
- 优先保存证据指针和短摘录，不整份复制文档。
- 在 Session 结束或上下文压缩前写入持久反馈目录。
- 期望不明确时，最多追问一次。
- 不保存密码、受试者信息、客户受控资料或完整敏感文档。
- 持久化失败时，返回可复制的报告块并标记 `pending_import`，不能静默丢失。

## 极简 Excel

Excel 显示六列：

| ID | 能力 | 实际问题 | 期望结果 | 严重度 | 证据 |
| --- | --- | --- | --- | --- | --- |

同事真正需要输入的只有：

- 实际问题；
- 期望结果；
- 证据，可不填。

`ID` 预填；`能力` 和 `严重度` 使用下拉框：

- 能力：`CRF Review`、`SAP`、`Table Shell`、`Workflow`、`Other`
- 严重度：`Blocker`、`High`、`Normal`、`Low`

填表人、测试轮次、时间和所属 Project 由工作簿元数据或导入过程补充。问题类型、根因、受影响产物
和建议处理方式由 Curator 推导，不让同事手填。

示例：

| ID | 能力 | 实际问题 | 期望结果 | 严重度 | 证据 |
| --- | --- | --- | --- | --- | --- |
| P02-004 | Table Shell | 主要终点表没有写分析人群和时点 | 表头或脚注明确 ITT、Week 12 | High | P02-SHELL-R1 |

## 每周整理

### 调度

默认每周一 02:00，使用 Project 时区，可由管理员调整。一次任务只处理过去七天，并保留明确的窗口
起止时间，重复运行不会重复导入。

### 规范化

Curator 依次执行：

1. 校验 JSON 和 Excel 行；
2. 把 Excel 行转换成 Issue Report；
3. 区分 `colleague_test` 和 `rsi_eval`；
4. 脱敏；
5. 对格式错误的记录生成隔离结果，而不是静默删除。

同样的 Excel 行或 Issue Report 重复导入时必须幂等。

### 聚类

以下条件全部满足时，可以进入同一个 Issue Cluster：

- 能力相同；
- 产物或工作流步骤相同；
- 可观察的失败方式相同；
- 可能根因属于同一类。

Cluster 保存报告 ID、场景变体、独立用户数、出现次数、首次/最近出现时间和最高严重度。所有原始
报告继续独立存在。

### 冲突

意见不一致时不形成“多数意见”。Curator 建立 Conflict Group，列出：

- 相互冲突的主张；
- 各自主张的证据；
- 涉及的同事、项目和能力；
- 是个人偏好、项目特例还是公司规则冲突；
- 最终决定、决定人和理由。

未决定前，该冲突不得生成公司级 Memory Candidate。

### 每周审核包

每周任务输出：

- 新增报告与数量；
- 新聚类和已有聚类的变化；
- 尚未解决的冲突；
- 候选 Memory；
- 候选 Skill 或 Prompt 修改；
- 候选 Benchmark Case；
- 被拒绝或延期的条目和原因；
- 隐私与格式违规。

审核包只是建议，不直接注入任何被测 Agent。

## Memory Candidate

```yaml
id: MC-2026-10-28-004
title: 方案没有依据时不得自行补充统计方法
scope: capability
capability: sap-authoring
rule: 当方案和批准记录都没有给出决定时，应登记为未决，不得把行业惯例写成已批准方法。
evidence:
  clusters:
    - FC-0007
  users: 3
  cases:
    - SYN-401
    - SYN-402
decision: pending
proposed_target: skill
```

管理员可以选择：

- `approve`；
- `edit`；
- `reject`；
- `defer`。

批准必须记录管理员身份、最终规则文字和理由。

一般情况下，候选规则需要重复证据或多个独立用户。单一报告只有在管理员明确记录理由时才能晋升为
公司级规则。

## Memory Pack

每个已发布 Pack 包含：

- 日期版本，例如 `2026.10.28.1`；
- 内容哈希；
- 创建与批准时间；
- 来源 Cluster 和 Report ID；
- 公司级或能力级适用范围；
- 面向人和 Agent 的索引；
- 机器可读 manifest；
- 与上一版本的 changelog。

发布 Pack 不修改原始报告。回滚只切换激活指针，不迁移历史数据。

## 与长期记忆的关系

- 测试期关闭原生自动长期 Memory。
- Memory Pack 是每周快照，不是实时写入路径。
- V0 不发布个人级记忆。
- 项目知识留在 Workspace、文件或 Handbook 中，但 V0 不通过原生 Memory 注入，也不会自动上升为
  共享知识。
- 一条反馈只有经过聚类和管理员审核后才可能进入 Memory Pack。
- 单个同事的偏好不能直接变成公司规则。

## 与长任务中间记忆的关系

- 压缩摘要、scratchpad、计划文件和 Goal 状态只保存当前任务的工作状态。
- Feedback Capture 必须在这些中间状态被压缩或删除前，把 Issue Report 持久化。
- 报告可以引用 Trace 或 scratchpad，但不能依赖 scratchpad 永久存在。
- 每周整理读取持久 Trace、Excel 和 Issue Report，不读取已删除的中间状态。

## 与 RSI 的关系

- `feedback-capture`、`feedback-curator` 和 `curated-memory-reader` 属于受保护基础设施，不进入
  RSI 的自动修改范围。
- Curator 可以提出 Benchmark Case，但必须经管理员确认后才能冻结。
- RSI 只读取冻结后的 Benchmark 和已有评分，不读取原始同事反馈。
- RSI 评估产生的反馈标记为 `source: rsi_eval`，默认不进入同事反馈池。
- 基线和 Candidate 测量时关闭 Memory 或使用隔离快照，避免一次运行影响下一次运行。
- RSI 可以按现有规则修改业务 Agent 的领域 Skill、`AGENTS.md` 或受限运行参数，但不能修改反馈协议
  或发布 Memory Pack。

## 隔离与隐私

- 同事只能查看自己的原始反馈，并可提交带 `clarifies` 关系的新报告补充原报告。
- General Agent 和 Project owner 可以为整理目的读取所有报告。
- 其他被测 Agent 不能读取原始 Issue Report。
- Memory Pack 只包含已审核、脱敏的公司级或能力级知识。
- 原始 Trace 只对 Project owner/admin 和授权 Curator 开放。
- 每条报告记录来源可见范围和敏感等级。
- RSI 产生的内容不能伪装成同事反馈。
- 秘密值和受控研究数据只保存指针或哈希，不复制正文。

## 异常处理

- **报告格式错误**：隔离并在周报中显示错误。
- **重复导入**：返回已有 ID，不做写入。
- **相似度不确定**：保持独立，交管理员判断。
- **意见冲突**：建立 Conflict Group，不发布任何相关内容。
- **Curator 失败**：保留上一版本 Pack，下一次重试。
- **发布失败**：保留 Candidate，不移动激活指针。
- **隐私违规**：阻止发布并等待管理员处理。
- **缺失 Session 证据**：允许记录，但标记证据质量较弱。

## 可观测性

周报统计：

- 按来源、能力、严重度和状态统计的报告数；
- Cluster 的合并与拆分；
- 待处理冲突；
- 已批准、拒绝和延期的 Candidate；
- Pack 版本、哈希和回滚记录；
- Schema 失败与脱敏数量；
- 从报告到聚类、从聚类到决定的时间。

## 测试

- 完整报告通过 Schema 校验，缺字段报告被拒绝。
- 相同 Report 或 Excel 行重复导入保持幂等。
- 相似报告能够聚类，原始报告不丢失。
- 冲突报告建立 Conflict Group，且不生成共享 Memory Candidate。
- 单个用户的个人偏好不能自动晋升为公司级规则。
- 周任务使用固定七日窗口，输出顺序稳定。
- 发布必须有管理员和有效哈希。
- 发布失败时上一版本 Pack 保持激活。
- 测试配置下被测 Agent 无法写入 Memory Pack 或原生 Memory。
- RSI 评估反馈不会进入同事反馈池。
- RSI 不能修改或关闭反馈基础设施。
- 原有会话和 Workspace 可见性隔离保持不变。

## 验收标准

1. 同事在 Excel 中最多填写三个实质性自由文本字段即可提交问题。
2. 被测 Agent 能记录来源、证据和期望，同时不修改自身 Memory 或 Skill。
3. General Agent 能合并相似报告，并单独展示矛盾报告。
4. 每周任务只生成审核包，不自动发布。
5. Project owner 能批准版本化 Memory Pack，并指定适用的能力 Agent。
6. 同事无法通过正常 UI 或 Agent 工具读取其他同事的原始反馈。
7. RSI 只能读取已审核的 Benchmark，不能读取或修改反馈基础设施。
8. 回滚到上一 Memory Pack 不需要数据迁移。

## 拆分

本设计是总契约，实施分为独立计划：

1. 反馈采集、Excel 导入、规范化、聚类与冲突处理；
2. 每周整理和只读 Memory Pack 发布；
3. CRF Review、SAP Authoring、Table Shell 的初始 Benchmark；
4. 可选的管理员反馈 UI 和原生只读 Memory 模式。

第一份实施计划只覆盖第 1、2 项。Benchmark 出题在反馈闭环完成至少一轮真实试用后开始。
