# 其他 Agent 接入说明

工作台是本机唯一台账。Cursor、Codex、豆包、WorkBuddy、DeepSeek、Docker、Ollama 都可以读、写，不要各记一份进度。

默认根地址：`http://127.0.0.1:3780`

## Codex 总管（真实本机接入）

`GET /api/codex/status` 检测已安装 CLI 和 ChatGPT 登录；不返回登录凭据。

`POST /api/codex/jobs`：`{ "test": true }` 真实连接测试；或 `{ "runId": "工作链ID", "role": "director" }` 拆解目标，`role: "reviewer"` 独立复核。返回 202 与 job。`GET /api/codex/jobs` 查看结果；任务完成自动保存到部门阶段，无需回填。

仅在相应阶段待启动时运行；执行人为 Codex 时不能再由 Codex 自审。后台失败保留目标并允许重试，服务重启将未完成调用标为中断。不调用付费 API。默认三成员分工为 Codex 主管与整合、WorkBuddy 执行、Cursor 独立复核；role: secretary 可进行整合。WorkBuddy 使用桌面定时任务每小时运行 scripts/workbuddy-queue.js 领取并报送结果，Cursor 使用已登录的 Agent CLI；启用项目自动执行后无需用户逐项目转发邀请或回填。须保持工作台及 WorkBuddy 登录运行，等待领取最多约一小时。Docker/Ollama、DeepSeek、豆包接入暂缓。材料由用户人工脱敏；正式写作仍需 Start Writing。

## 项目群聊（真实成员回复）

项目房间发送消息时可选择 Codex、Cursor、WorkBuddy，或正文 @成员。默认由 Codex 回答。群聊回复独立保存在唯一台账 `chatJobs` 与 `projectMessages.replyTo`，不改变阶段、不解除自动接力暂停，也不替代正式复核或写作批准。

消息接口增加 `chat:true` 后触发成员回复；省略该字段仍只保存留言。WorkBuddy 的讨论也通过 `scripts/workbuddy-queue.js` 原队列领取，无需逐次转发；领取脚本会区分群聊和业务任务，群聊不领取部门阶段。服务和 WorkBuddy 须持续运行，按现有每小时定时任务等待领取，可手动运行现有任务加速。失败在群聊中显示，可单独重试。详见 `docs/项目群聊接入与验收.md`。

## 读接口

```
GET /api/state
GET /api/health
```

命令行（在本目录）：

```
node cli.js brief
node cli.js tasks
```

## 写进展（推荐）

完成一段工作后打卡，不要只在聊天里说「做完了」。

```
POST /api/checkpoint
Content-Type: application/json

{
  "taskId": "t-spinach-p2",
  "agentId": "codex",
  "progress": 45,
  "status": "doing",
  "nextAction": "下一句人话",
  "notes": "这段实际改了什么"
}
```

## 分派

```
POST /api/dispatch

{
  "taskId": "t-gov-pipeline",
  "ownerAgentId": "doubao",
  "helperAgentIds": ["cursor", "ollama"],
  "collab": "lead-review"
}
```

`collab` 取值：`lead` 主控 · `collab` 协作 · `split` 分头 · `lead-review` 主控+复核。

## 虚拟部门（v0.8）

董事长只提交一次目标，工作台建立 `主管 → 执行 → 独立复核 → 整合` 工作链：

```
GET  /api/departments
POST /api/departments/runs
{ "goal": "要完成的目标", "context": "约束、材料与判断标准" }

GET  /api/departments/runs/<runId>
POST /api/departments/runs/<runId>/items/<itemId>/model-execute
```

尚未机器接入的 Agent 完成工作后，可由页面「人工 / 外部 Agent 回填」写回真实成果。复核人不得与主执行人相同；复核退回后主执行项进入返工，原成果与意见均保留。

## 记忆与教训

```
POST /api/memories
{ "title": "短标题", "body": "以后还要用的事实", "tags": ["gov-doc"], "pinned": false }

POST /api/lessons
{ "rule": "下次必须遵守的一条", "from": "哪次任务" }
```

## 报告

```
POST /api/reports/generate
{ "kind": "weekly" }
```

`kind`：`daily` 日报 · `retro` 每日复盘 · `guidance` 周指导 · `weekly` 周报 · `assessment` 月评估 · `monthly` 月报 · `quarterly` 季度总结。

## 下达（inbox）

董事长在工作区底部指令台下达后（或全员通告）：

```
POST /api/inbox            （仅董事长界面使用）
{ "toAgentId": "codex", "body": "把 M1 能力接到 Game.ts", "relatedId": "mod-spinach" }

GET /api/inbox?agentId=codex&status=queued
```

全员通告：`toAgentId` 传 `__all`，服务端展开为每人一条，共享 `broadcastId`，各 agent 均须回执。

### 指令生命周期（必须遵守）

领到指令后按阶段推进状态，不要一步跳到 done：

```
PATCH /api/inbox/<id>   { "status": "ack" }      收到指令，先确认
PATCH /api/inbox/<id>   { "status": "doing" }     开始执行
PATCH /api/inbox/<id>   { "status": "done" }      干完，然后照常 POST /api/checkpoint 打卡
```

状态流转：`queued 待领 → ack 已收悉 → doing 执行中 → done 已完成`。
然后仍用原来的 `POST /api/checkpoint` 打卡。

## 简报

```
GET /api/briefings
GET /api/brief-runs
POST /api/brief-runs
POST /api/briefings/dismiss
POST /api/crew/sync
```

## 报送定时简报

ChatGPT、WorkBuddy 或其他 Agent 生成简报后，统一报送到本机台账：

```http
POST /api/brief-runs
Content-Type: application/json

{
  "sourceId": "chatgpt-daily-priority",
  "externalRunId": "2026-09-27",
  "agentId": "chatgpt",
  "title": "Daily Priority Briefing",
  "completedAt": "2026-09-27T08:00:00+08:00",
  "body": "完整简报正文"
}
```

`sourceId` 首批值：`chatgpt-daily-priority`、`chatgpt-guangdong-construction`、`chatgpt-practical-ai`、`workbuddy-ai-news`。相同 `externalRunId` 自动去重。

## 规矩

1. 先读对应 `specs[]` 的对照清单，再动手。没有清单就先写规范。
2. 红区信息（证件、原件价格、未脱敏照片）不要 POST 进来。
3. 不要另建平行的进度表。更新 `tasks[].nextAction` 就是交接。

## 文件报送通道（不会跑 HTTP 的 agent 用）

把一个 JSON 文件放进工作台的 `data/dropbox/` 目录即完成打卡（约 20 秒内被收编）：

```json
{
  "agentId": "doubao",
  "taskId": "t-gov-pipeline",
  "progress": 40,
  "status": "doing",
  "nextAction": "下一步人话",
  "notes": "这段实际做了什么"
}
```

不会跑 HTTP 的定时简报也放进同一目录，但增加 `kind: "brief"`：

```json
{
  "kind": "brief",
  "sourceId": "workbuddy-ai-news",
  "externalRunId": "2026-09-27",
  "agentId": "workbuddy",
  "title": "每日 AI 新闻推送",
  "completedAt": "2026-09-27T16:30:00+08:00",
  "body": "完整简报正文"
}
```

成功后文件移入 `processed/`；失败移入 `failed/`（附 `.err.txt` 说明原因，通常是 taskId 拼错或缺 agentId）。

## 其他可用接口

- `POST /api/prompts`：沉淀提示词能力资产 `{ "title": "...", "tags": ["公文"], "body": "..." }`
- `POST /api/lessons`：沉淀教训（已有）
- `GET /api/llm/config` / `POST /api/llm/generate`：模型路由（本地 Ollama 或在线接口），供有能力的 agent 调用生成文本
