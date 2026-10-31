# SPEC：Super-agent 架构吸收升级（基于 DeepSeek 文章）

> 状态：Phase1 骨架落地中 · 分支 `feature/v3-bold-workspace` · **本阶段不推送 GitHub**  
> 来源文章：DeepSeek Super-agent（mp.weixin.qq.com/...zoS7GlReWPhfCjENGxXCdg）  
> 参考原型（只吸收模式，不整仓迁入）：https://github.com/deepseek-ai/dsh-superagent-prototype  
> 基线：本地 v3 Bold Workspace + Codex WIP（已本地提交，未推送）

## 1. 目标

把文章中的 Router/Worker、事件触发（Fast/Slow Path）、订阅直投、异步起停、Inline/Spill 召回、Watchdog 外控环等模式，**映射进本工作台现有架构**（Node HTTP + `store.json` + agent-dispatch / execution-governance / department / project-chat / WorkBuddy queue），而不是替换为 DeepSeek Harness/SQLite Engine。

## 2. 文章模块 → 本仓映射

| 文章模块 | 吸收重点 | 本仓落点（现有 / 新增） |
|---|---|---|
| [2] Dual-layer Router vs Worker | Router 只路由/回复；Worker 隔离执行 | Router ≈ `server.js` API + 后续 intake；Worker ≈ `executionAttempts` / `codexJobs` / `externalJobs` / `chatJobs` / WorkBuddy queue；领取仍走 `lib/agent-dispatch.js` |
| [3] Event Triggers · Fast/Slow Path · Subscribe | 确定性过滤 → LLM 慢路径；线程订阅直投 | **新增** `lib/superagent-intake.js`；订阅台账 `store.superagent.subscriptions`；事件可对齐 `store.events` / 项目消息 |
| [4] Inline & Spill / Chain of Recall | 短上下文内联，长上下文外溢再召回 | Phase3：对接 `project-chat.promptFor`、部门阶段 prompt、Vault/笔记；本阶段只留类型位 |
| [5] Async ReAct start/stop · 通道篇幅 | 长任务不阻塞聊天；IM 短、文档结构化 | Phase2：对齐 `project-chat` 与 `execution-governance` lease/claim；通道策略挂 `store.superagent.channels` |
| [6] Compute/state/env 分离 · Watchdog | 状态外置；卡住/跑偏外控 | **新增** `lib/superagent-watchdog.js` 扫描 lease 过期、无进展、重试过多；暂停复用现有 `automationPaused` + `governance.touch`，**不自动 reconcile** |

Ticket/Assignment：文章 Ticket ≈ 本仓 `store.inbox` 指派 + `executionAttempts`；Thread ≈ `departmentRuns` 房间 + `projectMessages`。

## 3. 明确非目标（本升级阶段）

- 不安装 / 不依赖 `deepseek-harness`、`dsh-superagent` 或其 SQLite Engine
- 不做云端 Brain/Hand 拆分，不做整仓 Harness 替换
- Phase1 **不做** UI 大改、不做 Inline/Spill 真召回、不做自动杀进程
- 不推送 GitHub；与远端合并等 Codex 额度恢复后再做
- 不改写 SJZZ 成本软件仓；本 SPEC 仅针对 AI 工作台

## 4. 分阶段计划

### Phase1（本提交）— domain + intake + watchdog 骨架
- 纯模型辅助：`lib/superagent-model.js`
- Fast Path 过滤 + Slow Path 候选队列 + 订阅直投预览：`lib/superagent-intake.js`
- Watchdog 扫描（只读建议；可选确认后 pause）：`lib/superagent-watchdog.js`
- 只读/预览向 HTTP：`/api/superagent/...`
- 单测覆盖过滤、fan-out、卡住检测
- `store.superagent` **加法字段**（缺省则运行时 ensure，不破坏旧数据）

### Phase2 — 订阅直投落地 + 异步 start/stop
- 事件真实写入后按订阅 fan-out 到 worker/房间
- chat 与长任务解耦的 start/stop 语义（对齐 governance lease）

### Phase3 — Inline / Spill 召回
- prompt 组装分层：Inline 摘要 + Spill 指针 + 按需 Chain of Recall

### Phase4 — 投机安静工作（speculative quiet work）
- 低打扰后台预研，需用户可见开关与撤销

### Phase5 — compute / state / env 分离（更晚）
- 执行环境与台账进一步隔离；仍不引入 Harness 依赖

## 5. Phase1 验收标准

1. `docs/SPEC-superagent-upgrade.md` 存在且映射准确  
2. Fast Path：可对 trigger 给出 `accept | ignore | slow_path`，规则来自默认或 `store.superagent.intake`  
3. 订阅 fan-out 预览：给定 event，返回将投递的 worker / project-room 列表（可不落盘）  
4. Watchdog：对 lease 过期 / ACTIVE 无进展 / 同 step 失败过多给出 `notify | pause | none`，默认**不自动改台账**  
5. `test/superagent-*.test.cjs`（或等价）通过，并挂入 `npm test`  
6. 工作树在 Phase1 提交后干净（允许无关 brief 噪音）；**未** `git push`

## 6. 配置草图（加法）

```json
{
  "superagent": {
    "intake": {
      "allowedSources": ["project-chat", "department", "webhook", "schedule", "system"],
      "ignorePatterns": ["^ping$", "^健康检查"],
      "forceSlowPathTypes": ["ambiguous", "natural-language"]
    },
    "subscriptions": [],
    "channels": { "imMaxWords": 100, "docStructured": true },
    "watchdog": {
      "noProgressMs": 900000,
      "maxFailuresPerStep": 3
    }
  }
}
```
