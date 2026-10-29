# v2 部门协作（第一切片）

2026-10-29。在现有虚拟部门工作链上增加 Boss → Lead → Room，不另建进度表，不替换 Codex / WorkBuddy 执行器。

## 范围

仍以 `data/store.json` 的 `departmentRuns[]` 为唯一进度来源。`POST /api/departments/runs` 只有 JSON 布尔值 `v2: true` 时写入 `collabVersion: 2`。省略或传入其他值时 `collabVersion` 为 1，阶段顺序、领取、复核、整合和已有接口保持原样。

v2 不删除四阶段记录。阶段状态机继续使用 `director`、`executor`、`reviewer`、`secretary`。组织层只增加字段：

| 字段 | 含义 |
|---|---|
| `collabVersion` | `1` 兼容投影，`2` 本切片工作链 |
| `items[].orgRole` | 主管为 `lead`，其余三阶段为 `room` |
| `items[].roomId` | 稳定房间号，默认 `room-<role>` |
| `items[].parentItemId` | 房间的上一阶段；主管为 `null` |
| `items[].parentRef` | 主管指向 `{ orgRole: "boss", id: "boss" }` |
| `orgEdges` | `boss` → 主管房间 → 执行 → 复核 → 整合 |
| `items[].handoff` / `run.handoffs` | 主管封印的交接包 |
| `items[].circuitBreaker` | 同一阶段输入的 N=3 表面 |

董事长不是阶段项，不写阶段正文。暂停、继续、改派仍走原有执行治理和 `PATCH` 角色接口。

旧工作链在 `ensureDepartmentSystem` 里补齐上述默认值，不改 `status`、不改承办人、不增加控制代数。`circuitBreaker` 每次读取时按当前 `executionAttempts` 重算。

## 交接包

形状对齐九段现场重建包，但只写入本机台账，不引入脚手架脚本，也不调用模型。

```json
{
  "sealed": true,
  "toolSealed": true,
  "summary": "本阶段可交接的结论",
  "decisions": ["已决事项"],
  "openQuestions": ["未决问题"],
  "artifacts": [{ "name": "说明", "path": "docs/SPEC-v2-department-collab.md", "ref": "" }],
  "kvHints": { "next": "执行房间领取" },
  "sections": {
    "goal": "原始目标",
    "constraints": "约束",
    "activeFiles": ["lib/department.js"],
    "changes": "本阶段改动",
    "contracts": "仍生效的接口",
    "blacklist": ["不要再踩的做法"],
    "blockers": "当前阻塞",
    "nextAction": "恢复后的第一个动作",
    "acceptance": "验收命令"
  }
}
```

`sections.goal` / `constraints` 省略时从工作链目标与背景填入。`activeFiles` 最多 5 个，多了返回 `active_files_limit`。`kvHints` 只保留短字符串，键名含 token、password、secret、apiKey、credential 的项直接丢掉。`source: "chat"`、`channel: "project-chat"` 或 `toolSealed: false` 返回 `handoff_must_be_tool_sealed`。`agentId` 必须是主管；省略时按主管承办人记录。董事长或其他成员返回 `lead_required`。

## 接口

| 方法 | 路径 | 行为 |
|---|---|---|
| `POST` | `/api/departments/runs` | 可选 `v2: true`。返回的运行仍含四个阶段 |
| `GET` | `/api/departments/runs/:id/org` | 只读组织树：`boss`、`lead`、`rooms`、`edges` |
| `POST` | `/api/departments/runs/:id/handoff` | 仅本机。主管封印交接。`dispatch: true` 时先过 N=3 门禁，通过才落盘，且不启动成员 |

非 v2 运行调用交接返回 `v2_run_required`。同一输入已经三次时，`dispatch: true` 或 v2 的阶段 `action: "start"` 返回 `409`，`error` 为 `execution_budget_exhausted`，`reason` 说明第 4 次已阻断。只封印、不派发时仍可写入交接，便于记下阻塞。

房间领取继续用 `POST /api/agents/claim` 与 `/api/workbuddy/claim`。本切片不新开执行器，也不改 WorkBuddy 定时任务。

## N=3

计数与 `lib/execution-governance.js` 的阶段预算一致：同一 `runId`、阶段、`purpose: "stage"`、承办人、以及 `extra = null` 时的输入哈希。模型路由会带 `modelRoute` 额外字段，哈希不同，仍由原 `reserve()` 拦截，执行记录面板沿用原来的三次文案。

`circuitBreaker`：

```json
{ "limit": 3, "used": 3, "exhausted": true, "inputHash": "…", "reason": "同一输入已尝试 3 次，第 4 次相同尝试已阻断" }
```

## 界面

项目房间展示组织树、已封印交接卡，以及耗尽时的「同一输入已达三次」。新建协作任务可勾选「v2 部门协作」。v2 房间提供主管封印表单。未勾选的项目仍显示兼容投影，不出现封印表单。

## 验收

- `node test/v2-department-collab.test.js`：迁移默认值、v2 DAG、交接封印、聊天拒绝、非主管拒绝、文件数、N=3、旧运行拒绝交接，以及对应 HTTP。
- `npm test` 不调用 Cursor、Codex、WorkBuddy。
- 本地试运行见 README「v2 部门协作」。

## 非目标

不替换 Codex / WorkBuddy 执行器，不改主题、归档、语言和行程复盘笔记，不自动启动 WorkBuddy，不把密钥写入仓库。
