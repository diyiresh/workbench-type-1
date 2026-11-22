# V8.0.0-beta.1 改进说明

本轮按「稳定 → 优雅 → 灵活 → 台账 → 能力」五段推进，只基于 V8。所有既有门禁（仅本机、attemptId/claimId、执行人不得自审、暂停、Start Writing、WorkBuddy 调度遵从用户选择）保持不变。

## 升级须知

- **须重启工作台服务**：后端拆分、台账缓存与新接口在重启后才生效。
- 版本号统一为 `8.0.0-beta.1`（原 `package.json` 为 `0.10.0`）。
- 未做任何 git 提交。`data/`、备份、日志、密钥仍在 `.gitignore` 之内。

## 一、稳定与安全

- `npm test` 恢复全绿；测试启动外部工具时一律 `platform: "linux"` 干跑。此前测试曾实际拉起 ComfyUI 与 UVR，已停止并改为不启动真实程序。
- `PUT /api/state` 与通用写接口仅限本机；`GET /api/state` 不再返回模型密钥与推送令牌；`PATCH /api/remote` 不再回显 API Key。
- 根目录研究残留（`*.pkl`、一次性分析脚本）移入 `archive/`，并加入 `.gitignore`。

## 二、界面

- 单一「今日」首页，五个主导航加 `Ctrl+K` 命令面板；指令台按需打开；主题收敛为精选调色板。
- 外观对话框新增「功能显示」：可隐藏简报、生活、学习、论文、订阅、外部工具，导航和命令面板同步隐藏，偏好保存在本机浏览器（`bench-v8-features`），不写台账。

## 三、结构

- `server.js` 由约 1560 行降至约 950 行；技能、Codex、超级 Agent、行程与报告、简报、模型与知识库、生活学习、本地文件、活动等路由拆入 `routes/*.js`，由 `lib/router.js` 分发，`local` 声明的路由对非本机请求统一返回 403。部门、指令与通用路由暂留 `server.js`。
- 前端 69 个 `data-act` 分支改为动作注册表（`public/js/actions.js`），重名注册直接报错；模块清单可声明 `actions`。
- 测试改由 `scripts/run-tests.cjs` + `test/suites.cjs` 统一运行：`npm test`（单元，并行，约 6 秒）、`npm run test:ui`（浏览器，串行）、`test:agents` / `test:skills` / `test:papers`。

## 四、台账

- `lib/ledger-store.js`：进程内缓存（按文件 mtime/大小/inode 与日期失效），每次读取得到独立副本；写入为临时文件 + 改名的原子写。并发写按顶层分区合并，同一分区双方都改时后写者胜并记录警告。
- 外部改动 `store.json` 后自动重新读取；读取本身不再重写文件。
- 备份分三层：近期快照（最多每 5 分钟一份，保留 12 份）、`hourly/*.json.gz`（48 份）、`daily/*.json.gz`（30 份）。原先每次写入都备份。
- `GET /api/state?slice=ui`：界面刷新不再下载外部任务全文输出，讨论正文截至 280 字；「备份」按钮仍取完整台账。
- **刻意未做 JSONL / SQLite**：实测 4.65 MB 台账中事件日志仅约 63 KB，大头是外部任务输出（约 908 KB）与项目讨论（约 918 KB）；解析约 10 ms。切换存储引擎收益小、迁移风险大，改用切片读取与缓存解决。

## 五、能力

### 统一待决收件箱

`GET /api/decisions`（只读）汇总等待董事长决定的事项：待核对执行、迟到成果、Start Writing、重试预算用尽、交付失败或失效、待复核、已暂停自动接力、未重试的群聊失败、待核验/受阻任务、未保存的报告草稿。归档项目不计入。每项给出原页面链接，收件箱本身不批准、不重试、不启动成员。首页侧栏显示前 4 项，完整列表在 `#home/decisions`。

### 项目活动时间线

`GET /api/departments/runs/<id>/timeline`（只读）按时间合并：目标、阶段开始/完成、executionAttempts 事件（领取、开始、成果、暂扣、待核对等）、复核通过/退回、交付配置/生成/复核、主管交接。项目房间执行面板下方显示最近 12 条。

### 工作台 MCP 服务器

`mcp/workbench-mcp.js`：零依赖 stdio MCP 服务器，所有工具都经由本机 HTTP API，服务端门禁照常生效。

| 工具 | 对应接口 |
| --- | --- |
| `workbench_brief` / `workbench_decisions` | 简报、待决事项（只读） |
| `workbench_checkpoint` | `POST /api/checkpoint` |
| `workbench_inbox` / `workbench_inbox_update` | 指令列表；状态只能逐级 queued → ack → doing → done |
| `workbench_claim` / `workbench_submit` | `POST /api/agents/claim` 与阶段回填，携带 attemptId、claimId |
| `workbench_handoff` | 主管交接（`source: "mcp"`，工具封装） |

- 身份只来自环境变量 `BENCH_AGENT_ID`，工具参数不接受 agentId；未设置时只能用只读工具。
- `BENCH_URL` 默认 `http://127.0.0.1:3780`，非本机地址直接拒绝启动。
- 未使用官方 TypeScript SDK，以免引入依赖并保证离线可用；支持协议版本 2025-06-18 / 2025-03-26 / 2024-11-05。

配置示例（按需加入各 Agent 自己的 MCP 配置，本轮未改动任何全局配置）：

```json
{
  "mcpServers": {
    "workbench": {
      "command": "node",
      "args": ["D:\\OneDrive\\Desktop\\Ben_My_Agent\\5.cursor\\搭建工作台\\mcp\\workbench-mcp.js"],
      "env": { "BENCH_AGENT_ID": "cursor" }
    }
  }
}
```

## 已知限制

- 待决事项的说明文字由服务端生成，目前只有中文。
- 部门、指令与通用 CRUD 路由仍在 `server.js`，下一轮可继续拆分。
- `test/department-scroll.browser.cjs` 依赖实时数据，未纳入任何套件。

## 验证

- `npm test`：56/56 通过，翻译覆盖 1252 条。
- `npm run test:ui`：26/26 浏览器用例通过。
- 新增：`router`、`ledger-store`、`security-guards`、`decision-inbox`、`mcp-server` 单元测试；`v8-studio` 浏览器用例增加功能隐藏与待决收件箱检查。
