# SPEC：Super-agent 架构吸收升级（基于 DeepSeek 文章）

> 状态：Phase1/Phase2 本地实现完成 · 分支 `feature/v3-bold-workspace` · 2026-11-01 用户授权审查并推送最新 v3。下文“未推送”描述原阶段交付时点，当前发布情况以 Git 提交和远端分支为准。
> 来源文章：DeepSeek Super-agent（mp.weixin.qq.com/...zoS7GlReWPhfCjENGxXCdg）  
> 参考原型（只吸收模式，不整仓迁入）：https://github.com/deepseek-ai/dsh-superagent-prototype  
> 基线：本地 v3 Bold Workspace + Codex WIP（已本地提交，未推送）

## 1. 目标

把文章中的 Router/Worker、事件触发（Fast/Slow Path）、订阅直投、异步起停、Inline/Spill 召回、Watchdog 外控环等模式，**映射进本工作台现有架构**（Node HTTP + `store.json` + agent-dispatch / execution-governance / department / project-chat / WorkBuddy queue），而不是替换为 DeepSeek Harness/SQLite Engine。

## 2. 文章模块 → 本仓映射

| 文章模块 | 吸收重点 | 本仓落点（现有 / 新增） |
|---|---|---|
| [2] Dual-layer Router vs Worker | Router 只路由/回复；Worker 隔离执行 | Router ≈ `server.js` API + intake；Worker ≈ `executionAttempts` / jobs / WorkBuddy；订阅直投可绕过 Router 二次决策 |
| [3] Event Triggers · Fast/Slow Path · Subscribe | 确定性过滤 → LLM 慢路径；线程订阅直投 | `lib/superagent-intake.js`：filter + queue + **CRUD 订阅** + **plan/deliver 共用路径**；台账 `store.superagent.*` |
| [4] Inline & Spill / Chain of Recall | 短上下文内联，长上下文外溢再召回 | Phase3：对接 `project-chat.promptFor`、部门阶段 prompt、Vault/笔记 |
| [5] Async ReAct start/stop · 通道篇幅 | 长任务不阻塞聊天；IM 短、文档结构化 | **Phase2** `lib/superagent-async.js`：`asyncRuns` 可轮询；stop 协作式；可选挂 `attemptId` 走 governance.failed；`channelReplyHint` |
| [6] Compute/state/env 分离 · Watchdog | 状态外置；卡住/跑偏外控 | `lib/superagent-watchdog.js` 扫描 attempt + **asyncRuns**；暂停复用 `automationPaused` |

Ticket/Assignment：文章 Ticket ≈ `store.inbox` + `executionAttempts`；Thread ≈ `departmentRuns` + `projectMessages`；Async ≈ `store.superagent.asyncRuns`。

## 3. 明确非目标（本升级阶段）

- 不安装 / 不依赖 `deepseek-harness`、`dsh-superagent` 或其 SQLite Engine
- 不做云端 Brain/Hand 拆分，不做整仓 Harness 替换
- Phase2 **不做** UI 大改、不做 Inline/Spill 真召回、不做自动杀进程
- 不推送 GitHub（可与远端合并时机由 BEN 决定）
- 不改写 SJZZ 成本软件仓

## 4. 分阶段计划

### Phase1（已完成）— domain + intake + watchdog 骨架
- 纯模型：`lib/superagent-model.js`
- Fast Path / Slow Path 队列 / fan-out 预览
- Watchdog 只读扫描 + 确认后 pause
- HTTP 预览路由 + 单测

### Phase2（已完成 · 本提交）— 订阅直投落地 + 异步 start/stop
- 订阅 CRUD：`upsertSubscription` / `removeSubscription` / list
- **共用** `planFanOut` → `deliverFanOut`（`dryRun` 即 preview）；真实直投：
  - 房间：`collaboration.postMessage`（sender=`superagent`）
  - Worker：`store.inbox` 写入 `kind=superagent-direct`（无 `departmentItemId`，不干扰正式 claim）
  - 幂等：`store.superagent.deliveryLog`（eventKey + subscriptionId）
  - 尊重 `automationPaused` / 归档（默认 skip；`bypassPause` 仅显式）
- 摄入：`ingestAndDeliver` = filter → accept 则 deliver；slow_path 则入队（除非 `forceDeliver`）
- 异步：`lib/superagent-async.js` start/heartbeat/stop/complete；绑定输入的 idempotencyKey。仅登记异步跟踪，不启动执行器；挂接 ACTIVE attempt 的 stop 保持 stopping/uncertain 和成员占用，待原执行治理确认终止或实际返回后才能完成停止；不能用 complete 绕过核对。
- Watchdog 增加 `async_lease_expired` / `async_no_progress` / `async_stop_requested`
- HTTP：订阅写删、fanout deliver、ingest、async start/stop/heartbeat/complete

### Phase3 — Inline / Spill 召回
- prompt 组装分层：Inline 摘要 + Spill 指针 + 按需 Chain of Recall

### Phase4 — 投机安静工作（speculative quiet work）
- 低打扰后台预研，需用户可见开关与撤销

### Phase5 — compute / state / env 分离（更晚）
- 执行环境与台账进一步隔离；仍不引入 Harness 依赖

## 5. Phase2 验收标准（已满足）

1. 订阅可创建/列表/删除并持久在 `store.superagent.subscriptions`
2. preview 与 deliver 共用 fan-out 规划；deliver 幂等且在 pause 时默认跳过
3. Fast Path accept 经 ingest 可直投；slow_path 入队
4. async start 可轮询；stop 协作完成；可选联动 governance attempt
5. `test/superagent-intake.test.cjs`、`test/superagent-async.test.cjs`、`test/superagent-watchdog.test.cjs` 通过并挂入 `npm test`
6. 本地提交，**未** `git push`

## 6. 配置草图（加法）

```json
{
  "superagent": {
    "intake": {
      "allowedSources": ["project-chat", "department", "webhook", "schedule", "system", "inbox", "manual"],
      "ignorePatterns": ["^ping$", "^健康检查$", "^heartbeat$"],
      "forceSlowPathTypes": ["ambiguous", "natural-language", "nl"],
      "maxSlowPathQueue": 100,
      "maxDeliveryLog": 200
    },
    "subscriptions": [],
    "deliveryLog": [],
    "slowPathQueue": [],
    "asyncRuns": [],
    "channels": { "imMaxWords": 100, "docStructured": true },
    "watchdog": { "noProgressMs": 900000, "maxFailuresPerStep": 3 }
  }
}
```

## 7. Phase2 API 一览

| Method | Path | 说明 |
|---|---|---|
| GET | `/api/superagent/config` | 配置与计数 |
| GET/POST | `/api/superagent/subscriptions` | 列表 / upsert（写需本机） |
| DELETE | `/api/superagent/subscriptions/:id` | 删除（本机） |
| POST | `/api/superagent/filter/preview` | Fast Path 预览 |
| POST | `/api/superagent/fanout/preview` | dryRun 直投预览 |
| POST | `/api/superagent/fanout/deliver` | 真实直投（本机） |
| POST | `/api/superagent/ingest` | 过滤 + 直投/入队（本机） |
| GET | `/api/superagent/async` | 列出异步 run |
| POST | `/api/superagent/async/start` | 启动/幂等恢复 |
| GET | `/api/superagent/async/:id` | 查询 |
| POST | `/api/superagent/async/:id/stop` | 协作停止（confirmed） |
| POST | `/api/superagent/async/:id/heartbeat` | 续租 |
| POST | `/api/superagent/async/:id/complete` | 完成 |
| GET | `/api/superagent/watchdog/scan` | 扫描 |
| POST | `/api/superagent/watchdog/apply` | 确认后 pause |

## 8. 2026-11-01 推送前审查

用户授权将最新 v3（含 Codex 详细月度思考功能）推送到原 v3 分支，main 不变。旧“不推送”约束是阶段历史记录，已由本次授权更新。

- async 是跟踪层，不直接启动或杀死 CLI/Worker。记录显式标注 trackingOnly；停止绑定的执行时保留 stopping/uncertain 和成员占用，不将请求当作停止证明。后续适配器报错不能解除该占用，须由执行治理的核对或实际结果处理。complete 不能绕过未确认停止。
- 异步幂等键绑定项目、成员、attempt、目标、通道和用途；不同目标不能复用同一键。更新订阅后仍保持去重身份，ingest 不把自动生成的时间戳混入重放身份。
- Watchdog 扫描不改输入对象；重试告警仅统计相同 inputHash，未知输入不合并预算。扫描及暂停是状态控制，不替代实际执行停止证明。
- 回归使用隔离台账，不向真实成员投递消息。订阅去重日志仍按已有配置保留最近记录；长期全历史去重不在本阶段范围。
