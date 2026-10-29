# 行程报告成员选择与 SiliconFlow 暂停

2026-10-27，用户 Confirm Development。范围：行程日报／周报／月报的现有统一入口；不改项目四岗位工作链，不启动手机端开发，不自动推送 GitHub。

## 已确认交互与通道

- 报告按钮旁单选 Codex、Cursor、WorkBuddy；默认 Codex，浏览器记住选择。一次明确点击只派给一个成员。
- Codex 复用本机 ChatGPT 登录 CLI；Cursor 复用现有 ask 模式 CLI，长事实底稿经本机临时交接文件只读传入；WorkBuddy 复用现有每小时桌面领取队列，保持用户当前调度设置。
- 只发送所选周期的日程事实及复盘，材料仅传登记数量；不调用 SiliconFlow 或 VaultRAG，不将普通报告伪造成业务项目。生成成员仍受各自账户登录、可用额度及现有占用限制。
- 成员返回完整草稿后可编辑，显式保存才进入原报告库。生成、内容审阅、业务完成及文件验收保持各自边界。

## 唯一台账及执行治理

`agendaReportJobs`、`executionAttempts`、`executionCommands` 均保存在原 `data/store.json`。报告作业引用固定事实底稿、源哈希、所选成员和当前尝试；不会在 `departmentRuns` 建立隐藏工作链。

`executionAttempts.purpose=agenda-report` 复用现有成员全局占用、领取凭证、开始证据及结果收编。报告专用输入哈希根据周期、实际底稿和行程身份计算，排除随机报告 ID、生成时间及无关提醒状态；事实变化后的返回保留 held，不覆盖新尝试，不作为最新事实直接保存。月报可经明确确认另存为历史草稿及 Obsidian 版本，见 `SPEC-agenda-report-obsidian.md`。同一事实输入、同一成员最多三次尝试。

状态：waiting、doing、done、failed、uncertain、interrupted、held、cancelled。页面 GET 只更新／核对状态，不发起成员执行；刷新和重启不自动重发。重复提交使用幂等键；已领取或已开始的超时必须核对旧会话停止并记录依据后，才允许明确重试。等待未领取的到期和明确失败可手动重试；不自动切换成员。

WorkBuddy request 保留 `purpose`、jobId、attemptId；领取经原 `/api/workbuddy/claim` 核验，补齐 claimId、inputHash；开始自报经报告专用 started 接口。结果必须准确包含 jobId、agentId、attemptId、claimId、output。开始自报不等于独立执行证明。

## 接口

- `POST /api/agenda/reports/draft`：`{view,anchorDate,agentId,idempotencyKey}`，202 返回 `{job}`；缺少成员不回落到模型 API。
- `GET /api/agenda/reports/jobs`、`GET /api/agenda/reports/jobs/:id`：状态与可用草稿。
- `POST /api/agenda/reports/jobs/:id/started`：attemptId、claimId、inputHash、idempotencyKey。
- `POST .../:id/reconcile`：confirmed、stopped、evidence、resultHash、resolution=do-not-apply、idempotencyKey。
- `POST .../:id/retry`：confirmed、attemptId、resultHash、idempotencyKey，严格校验当前尝试。
- `POST /api/reports` 保存成员报告时绑定 sourceJobId 和 sourceHash，再核对当前事实；用户编辑正文保留。以上报告执行接口限本机。

## 全局暂停 SiliconFlow

- `remote.providerPauses.siliconflow` 保存暂停及恢复信息；接口地址、模型和 API Key 原样保留。本次生产配置同时关闭当前模型路由，让旧服务在更新期间也不再调用。
- `lib/llm.js` 在资料库准备及网络请求之前检查 provider policy；暂停状态下，即使提交 enabled=true，SiliconFlow 请求仍被阻止。正常模型设置保存不能解除暂停，连接测试也不例外。
- `GET/POST /api/llm/provider-pause` 读取／明确改变状态；恢复须本机 `confirmed:true`。设置页明确提示保留配置，恢复按钮再次确认费用影响；不会因余额变化、刷新或失败自动恢复。
- 暂停仅作用于本工作台对 SiliconFlow 域名的直接模型调用；不管理其他软件自身的账户配置。非 SiliconFlow 通道不受此提供方开关影响。

## 参考与技术选择

沿用 Node.js、原生 ES Modules 和本机文件队列，不引入新服务、数据库或 SDK。参考 [openai/codex 的开源事件示例](https://github.com/openai/codex/blob/main/sdk/typescript/samples/basic_streaming.ts) 的完成／失败回执设计；在本项目原有 Codex 事件解析器上复用，而非把 ChatGPT 登录转为通用 API 代理。Cursor 沿用已安装且已有测试覆盖的 CLI 适配器，不因文档 URL 变动擅自升级运行时。

## 隔离验收

- `test/agenda-report-jobs.test.cjs`：三成员替身、全局暂停零网络、配置与密钥保留、幂等、全局占用、源变化／迟到／重启、核对与重试、实际队列文件的 claim/start/result v2 协议。
- `test/agenda-report-members.browser.cjs`：真实隔离 HTTP 接口及页面的单选、等待、失败／明确重试、刷新不重复执行、完整编辑及人工保存、暂停拦截连接测试、中文／英语和窄屏。
- 既有日程筛选、改期、复盘防丢失及复盘笔记浏览器回归通过；完整 `npm test` 通过，翻译检查覆盖 981 条系统文案。
- 本轮测试的真实成员与付费模型调用为零。隔离适配器验收不能冒充生产账户已完成真实月报生成。
