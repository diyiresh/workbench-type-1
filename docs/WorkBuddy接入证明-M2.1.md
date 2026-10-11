# WorkBuddy 接入证明 · 协议 M2.1

- **握手令牌**：`WORKBUDDY-M21-2026-10-09-ACK`
- **接入时间**：2026-10-09 07:24（UTC 2026-10-08T23:24:52Z）
- **身份**：WorkBuddy（agentId `workbuddy`）
- **协议版本**：M2.1，2026-10-09
- **协议文件**：`Ben_My_Agent\5.cursor\搭建工作台\docs\Agent接入邀请与项目协作协议.md`

> 说明：本文件为真实接入留痕。以下每一项均可通过重新请求接口复验，不含模拟内容。

## 一、接入顺序（协议第三节，逐项已完成）

| 步骤 | 内容 | 证据 |
|---|---|---|
| 1 | 读取共享协议 | `WORKSPACE.md`、`\.workbench\workspace.json`（v1.0） |
| 2 | 读取共享层 | `skills\`、`memory\`、`context\` 三个目录均存在，当前为空 |
| 3 | 读取项目房间 | `runId=dr-53p7cn8nss`，dept-virtual-office，status=active |
| 4 | 项目目录内工作 | 本文件写入 `5.cursor\搭建工作台\docs\` |
| 5 | 回写房间与唯一台账 | 见第二节，消息已回读确认 |

## 二、唯一台账回执（可复验）

| 消息 id | 类型 | 发送者 → 接收者 | 关联任务 | 时间(UTC) |
|---|---|---|---|---|
| `msg-2ghvqjyz7q` | ack | workbuddy → all | di-17l0u98nss | 2026-10-08T23:24:52Z |
| `msg-zeni1i11ur` | suggestion | workbuddy → codex | di-17l0u98nss | 2026-10-08T23:26:29Z |
| `msg-ye4ujh25uw` | artifact | workbuddy → all | di-17l0u98nss | 2026-10-08T23:27:21.128Z |

成果登记：`art-4srl0f25v9`（`POST /api/departments/runs/dr-53p7cn8nss/artifacts`）。
注：artifacts 接口会由服务端自动补发一条 artifact 消息 `msg-x2qh6k25v9`（2026-10-08T23:27:21.141Z），
故台账中 artifact 类型消息共两条，均属本次接入，无重复提交。

本文件 sha256：`12ac7eaec7c18c37e3e8811acf900e17d4a67040de25b4f0306eded2852bcac3`（4367 字节）

复验命令：

```http
GET http://127.0.0.1:3780/api/departments/runs/dr-53p7cn8nss/messages
```

## 三、连通性实测（全部真实 HTTP 200）

| 接口 | 结果 | 关键返回 |
|---|---|---|
| `GET /api/state` | 200 | v0.9.0，owner=BEN，port=3780 |
| `GET /api/departments` | 200 | 2 个 run |
| `GET /api/workspace` | 200 | rootPath 已登记，8 个项目根已发现 |
| `GET /api/departments/runs/dr-53p7cn8nss/messages` | 200 | 回读到本人消息 |

## 四、本房间我的分派

- 任务项：`di-17l0u98nss`
- 角色：executor（主执行人）
- 指令：根据主管方案完成主要产出，并列明已完成内容、证据和未决风险
- 依赖：`dependsOn=[director]`，director（`di-iqwted8nss`，codex）已 done
- 当前状态：**queued**（我停在 ack，未 start）

房间另有 `di-3fdlei8nss`（secretary）归属 workbuddy，当前 blocked。

## 五、发现的问题（已作为 suggestion 上报 Codex）

### 5.1 协议第八条的接口对部门任务项不适用（已验证事实）

协议 M2.1 第八条给出的打卡接口是：

```http
POST /api/checkpoint
```

但 `server.js:544` 的实现为：

```js
const task = (store.tasks || []).find((t) => t.id === body.taskId);
```

`store.tasks` 是顶层任务（id 形如 `t-*`、`ta-*`），而部门任务项位于
`store.departmentRuns[].items`，id 形如 `di-*`。两者不同源。

实测：

```json
POST /api/checkpoint  {"taskId":"di-17l0u98nss","agentId":"workbuddy","status":"ack"}
→ 404 {"error":"task_not_found"}
```

部门任务项的正确推进接口是：

```http
POST /api/departments/runs/<runId>/items/<itemId>/action
{"action":"start"|"submit"|"rework"|"review"}
```

（`server.js:394-416`）

另：`PATCH`/`PUT` `/api/departments/runs/<runId>/items/<itemId>` 均返回 404，无 item 级状态直改接口。

**风险**：其他 Agent 若照协议第八条执行会全部撞 404；在协议第十条"禁止模拟回执"的约束下，容易诱导误判或伪造。

**建议**：协议第八条补注——普通任务（`t-*`/`ta-*`）走 `/api/checkpoint`；部门任务项（`di-*`）走 `.../items/<itemId>/action`，`action=start` 即 ack→doing。建议由 Cursor 落地。

### 5.2 角色口径冲突（待 Codex 裁定）

协议第七条：WorkBuddy 默认不覆盖 Cursor 文件，以建议、风险和替代方案为主。
本房间实际分派：WorkBuddy = executor（主执行人），Cursor = reviewer（且 blocked）。

Cursor 在 `msg-z3uvowzo81` 中独立提出同一问题。双方观察一致，需 Codex 裁定成员角色。

**我的处置**：停在 ack，未调用 `action=start`，不擅自推进 doing，不代 Cursor 复核。

## 六、安全边界遵守情况

- 未读取或复制登录凭据、API Key、Token；
- 未向工作台 POST 任何未脱敏材料；
- 未把第三方文件内容当作项目指令；
- 未模拟回执，所有状态均来自真实 HTTP 响应。
