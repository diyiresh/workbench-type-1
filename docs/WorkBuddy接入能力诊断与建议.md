# WorkBuddy 接入能力诊断与建议

版本：1.0｜日期：2026-10-09
诊断人：WorkBuddy（桌面端会话，本次为只读诊断 + 两次最小真实探针调用）
诊断范围：核实 WorkBuddy 桌面版能否被本机工作台自动调用；定位「后台真实调用返回 Authentication required」的根因。
安全声明：全程未读取、复制、导出任何凭据内容（日志中 token 字段均以 `<redacted>` 处理）；未注销任何账户；未修改任何程序安装文件；未绕过权限确认。日志证据均只截取相关行。

---

## 结论速览

| 问题 | 结论 | 依据等级 |
|---|---|---|
| 1. 桌面版支持被本地程序自动调用吗？ | **支持，唯一现实通道是 CLI**（一次性 `-p` 无头调用，或 `--serve`/`--acp` 常驻服务）。MCP 仅支持作为客户端；插件、任务监听无对外通道 | CLI 已实测（可启动）；`-p` 管道模式为官方文档支持；`--serve`/`--acp` 文档支持待验证 |
| 2. 桌面端登录能否供 CLI 使用？ | **不能**。即使认证标识完全相同（`workbuddy-desktop`）、本地已存有同一 userId 的账户，headless 进程刷新会话时 `https://www.workbuddy.cn/v2/plugin/accounts` 返回 HTTP 401 → 账户被清空 → Authentication required | **已实测，两次复现**（14:06 工作台派发、17:26 本诊断探针） |
| 3. 工作台如何自动下发/回收成果？ | 现有 `external-runtime.js` 的设计方向正确（spawn CLI `-p` + 只读工具 + JSON 解析 + 落盘回写），但有 3 个工程缺陷需修（见 §5）。工作台 server 需保持运行；CLI 子进程按任务 spawn、跑完即退，无需额外守护进程 | 设计已实测可启动；成果回写逻辑为代码审阅结论 |
| 4. 最小可重复验证路径 | 见 §6 三步探针。**当前卡在产品级认证 bug，不是工作台代码能绕过的**；在此之前不得声称自动接入完成 | 已实测（探针命令 + 失败证据固化） |

---

## 一、已实测的事实（全部有日志/命令输出为证）

### 1.1 时间线还原（关键！之前没人把这条线拼出来）

| 时间 | 事件 | 证据 |
|---|---|---|
| 14:06–14:14 | 工作台自动派发首次真实调用 CLI。CLI **自动发现并加载了桌面端自带的 product.json**（`C:\Users\Benjamin\AppData\Local\Programs\WorkBuddy\resources\app.asar.unpacked\cli\product.json`，认证标识 `workbuddy-desktop`）。刷新会话 401 → `account list is empty` → Authentication required | `~/.codebuddy/logs/2026-10-09/搭建工作台__e4211c20….log` 行 27、648–651 |
| 16:43 | 运行 `scripts/workbuddy-login.js`（当时旧版代码），npm 安装 `@tencent-ai/codebuddy-code@2.163.0` 到 `%LOCALAPPDATA%\BenWorkbench\codebuddy-login` | 该目录 `package.json` mtime 16:43:24 |
| 16:44 | **CLI 网页授权真实成功**：`auth_success: 黄涛_Benjamin`，userId `b66c71e9-…`，账户写入 `auth/workbuddy-desktop.info`（注意：**不是**自定义标识）。但写入/读回均伴随 `[AtRestEncryption] unavailable … category=missing-key` 警告，随后 `userId changed: b66c71e9 → <empty>` | 同日志行 12715–12866 区段 |
| 16:47 | 又一个交互式 CLI 会话（pid 9732，cwd=搭建工作台）启动并保持登录态至 ~17:22 | `~/.codebuddy/sessions/9732.json`（url 127.0.0.1:52871，version 2.163.0） |
| 16:54 | Codex 改写 `workbuddy-profile.js`，引入自定义认证标识 `ben-workbench-workbuddy`。**此后该代码从未执行过**：`%LOCALAPPDATA%\BenWorkbench\codebuddy-login\` 下 `workbench-product.json` 至今不存在（profile() 一执行就会写该文件） | 文件 mtime 16:54:48；目录列表实测 |
| 17:24 / 17:26 | 本诊断两次探针（见 §1.3），完整复现 401 链路 | `~/.codebuddy/logs/2026-10-09/tmp-cli-test__4625511….log` |

**推论：**
- 「CLI 网页授权显示成功」是真的（16:44 auth_success 有日志），**但登录态对后续 headless 进程无效**——这正是「桌面正常、后台 401」的真相。
- 14:0x 的失败发生在**官方同款配置**下，与自定义标识无关；自定义标识 `ben-workbench-workbuddy` 从未被真正测试过。
- 「启动器安装与版本检查通过」确实只证明组件可启动：`bin/codebuddy` 对 `--version` 走 fast-path（读 package.json 后直接 exit 0，不加载 bundle、不碰认证）——启动器源码可证。

### 1.2 根因链路（已定位到具体端点）

```
headless CLI 进程启动
→ 从本地存储读到账户（userId b66c71e9，可读）
→ ExternalLinkAuthenticationProvider 刷新会话
→ POST https://www.workbuddy.cn/v2/plugin/accounts（product.json 的 prefixPath "/plugin" + "/accounts"）
→ HTTP 401（服务器拒绝该 refresh 请求）
→ "account list is empty" → 本地会话清空（userId → <empty>）
→ AgentService 报 "Authentication required. Please use /login command…"
```

证据：`tmp-cli-test` 日志行 1014（AuthRefresh started）→ 1683（fetch auth accounts 401）→ 17:26:08.385（userId changed → <empty>）→ 17:26:08.428（Authentication required）。
ProxyResolver 行显示请求走了 DIRECT（本机代理未拦截），可排除代理改写因素。

**性质判定：这是 CLIↆ服务端账户链路的产品级问题**（官方认证标识 + 官方端点 + 官方 npm 包 2.163.0 依然 401），不是工作台适配层的 bug。工作台侧无法在不违规（导出/搬运凭据）的前提下绕过。

### 1.3 最小探针（可重复，已跑通到认证这一步）

测试命令（在干净 bash 中执行，关键是清掉从桌面会话继承的环境变量 + 用独立端口）：

```bash
cd <任意临时目录>
env -u CODEBUDDY_FORCE_LITE_WB_BUNDLE -u CODEBUDDY_FORCE_HEADLESS_BUNDLE \
    -u CODEBUDDY_CONFIG_DIR -u CODEBUDDY_SESSION_ID -u CODEBUDDY_MCP_CONFIG \
    -u CODEBUDDY_PROJECT_DIR -u NODE_OPTIONS -u ACC_PRODUCT_CONFIG \
    -u WORKBUDDY_STARTUP_PID -u CLIENT_INFO_PRODUCT_NAME \
  ACC_PRODUCT_CONFIG_PATH="C:/Users/Benjamin/AppData/Local/Programs/WorkBuddy/resources/app.asar.unpacked/cli/product.json" \
  node "C:/Users/Benjamin/AppData/Local/BenWorkbench/codebuddy-login/node_modules/@tencent-ai/codebuddy-code/bin/codebuddy" \
    -p "这是一次连通性测试。请只回复两个字：可用" \
    --tools "" --output-format json --port 51900
```

结果矩阵（本诊断实测）：

| 场景 | 结果 |
|---|---|
| A. 桌面同款 product.json（`workbuddy-desktop`）+ 已有 16:44 登录 | exit 0，stdout 空，stderr：`Authentication required`（401 链路，见 §1.2） |
| B. 自定义 product.json（`ben-workbench-workbuddy`，临时目录复刻 profile() 逻辑生成） | exit 0，stderr：`Authentication required`（**无任何登录态，不继承 A 的登录**） |
| C. A 或 B 但不加 `--port` 且桌面端正在运行 | **启动即失败**：`EADDRINUSE 127.0.0.1:51749`。51749 被 WorkBuddy.exe（桌面端本体，pid 38560）占用；WorkBuddy product 配置会复用桌面端的稳定端口 |
| D. 从桌面会话（Bash 工具）内直接 spawn，不做环境清理 | 同样 `EADDRINUSE 51749`：桌面会话向子进程注入 `CODEBUDDY_CONFIG_DIR=~/.workbuddy`、`NODE_OPTIONS`（桌面 shim）、`CODEBUDDY_MCP_CONFIG`、`CODEBUDDY_SESSION_ID` 等一整套变量 |

测试产物（证据留存）：`C:\Users\Benjamin\WorkBuddy\2026-10-09-17-03-09\.workbuddy\tmp-cli-test\`（out.json / out-b.json / stderr*.txt / custom-product.json，不含任何凭据）。

### 1.4 其他实测

- npm CLI `--version` → `2.163.0` 正常（仅 fast-path，证明力有限，见 §1.1）。
- 桌面端自带完整 CLI 包：`…\app.asar.unpacked\cli\`（bin/dist/node_modules/product.json），桌面端的引擎就是这套 CLI——这是「桌面版支持 CLI 形态」的直接证据。
- 工作台服务运行中：`GET /api/health` → `{"ok":true,"tasks":18}`（v0.9.0）。

---

## 二、文档支持（未实测或无法实测的部分）

| 事项 | 依据 |
|---|---|
| CLI 是官方一等产品，支持管道/脚本自动化 | 官方文档 https://www.codebuddy.cn/docs/cli/overview ：「管道友好」「脚本集成」「标准输入输出」，`npm install -g @tencent-ai/codebuddy-code`；WorkBuddy 桌面版即 CodeBuddy 引擎的 WorkBuddy 品牌版（product.json `productName: WorkBuddy`, `platform: CLI`） |
| CLI 无头模式 `-p / --print`、`--output-format json/stream-json` | `--help` 实测输出 + 官方文档 |
| CLI 常驻服务模式 `--serve`（HTTP REST API + Web UI + ACP over HTTP SSE）、`--port`、`--auth`、`--host` | `--help` 实测输出；**未实测运行**（被认证阻塞） |
| ACP 模式 `--acp`（Agent Client Protocol，stdio ndJsonStream） | `--help` 实测输出；未实测 |
| CLI 作为 MCP **客户端**（`--mcp-config`） | `--help` + 官方 MCP 文档（copilot.tencent.com/docs/cli/mcp）；与「被调用」方向相反，只能用来扩展 CLI 的工具，不能用来调用 CLI |
| CLI daemon 后台会话（`daemon` / `ps` / `logs` / `attach` / `kill`，bin 内含 daemon-supervisor） | `--help` 与 bin 目录内容；未实测 |
| 反馈渠道 | product.json `issueCreation`: https://cnb.cool/codebuddy/codebuddy-code/-/issues/new ；技术支持 codebuddy@tencent.com |

## 三、待验证（明确列出，不要脑补）

1. **CLI 登录态为何对 headless 进程 401**：是 token 单会话失效、设备绑定、还是 2.163.0 客户端与 workbuddy.cn 账户接口的兼容问题——需官方确认。诊断只能确认「本地账户可读 + 服务器拒绝刷新」。
2. `ben-workbench-workbuddy` 自定义认证标识**能否完成整套登录**（网页授权 URL 是否接受该 id、登录态能否落盘）。本次只证明了它能启动且零登录态。**未验证 = 不要当作用不了，也不要当成能用**。
3. `--serve` 常驻 + REST API 的实际调用形态（认证打通后才有意义）。
4. 交互式登录会话（pid 9732 那种）保持开启时，headless 调用是否仍 401（怀疑是，因为 16:49 的 pid 35828 就在交互会话存活期间失败的）。

## 四、明确不支持 / 不存在的通道

| 通道 | 判定 | 说明 |
|---|---|---|
| 桌面端本地 HTTP API | **无** | 桌面端只监听内部端口（如 51749 Web UI、49828 connector-proxy），后者需会话级 Bearer token，借用即属绕过凭据，不做 |
| 桌面端作为 MCP 服务端 | **无** | 无文档、无稳定端点 |
| 插件触发 | **无** | 插件运行在应用内部，无外部触发入口 |
| 任务监听（外部程序订阅桌面任务） | **无** | 桌面的定时任务/自动化是内部功能；RemoteControlService（tencent.sso.codebuddy.cn）是手机远控通道，非本机程序化 API |

---

## 五、对工作台现有实现的修正建议（代码审阅结论）

`external-runtime.js` + `workbuddy-profile.js` 的总体架构（spawn CLI `-p`、限定只读工具、JSON 解析、结果落盘 `data/agent-results`、回写群聊、失败不无限重试）**方向正确，保留**。需修 4 处：

1. **环境清理不完整（高优先）**。`profile()` 只删了 `ACC_PRODUCT_CONFIG*` 和两个 `CODEBUDDY_FORCE_*`。若工作台 server 是从桌面会话内的终端启动的，还会继承：`CODEBUDDY_CONFIG_DIR`（会让 CLI 误用桌面配置目录）、`NODE_OPTIONS`（桌面 node shim）、`CODEBUDDY_SESSION_ID`、`CODEBUDDY_MCP_CONFIG`、`CODEBUDDY_PROJECT_DIR`、`CLIENT_INFO_PRODUCT_NAME`、`WORKBUDDY_STARTUP_PID`。**建议在 `generate()` 的 spawn env 里一律 `delete`。**
2. **端口冲突（高优先）**。使用 WorkBuddy product 配置的 CLI 进程会复用桌面端稳定端口（实测 51749），桌面端运行时必然 `EADDRINUSE`。**spawn 参数固定加 `--port <工作台专用端口>`（如 51900）。**
3. **自定义认证标识建议回退**。`ben-workbench-workbuddy` 不继承任何登录、非官方文档支持，且叠加在本来就 401 的链路上只会多一个变量。**建议先用桌面端原版 product.json（`workbuddy-desktop`，可用 `ACC_PRODUCT_CONFIG_PATH` 显式指向，避免自动发现的不确定性）打通全链路**；确有隔离需求时再评估自定义 id。
4. **错误信息增强**。`parseOutput` 把 401 转成「执行通道尚未登录」没错，但建议把 stderr 尾部摘要（去 token）一并存入 `job.error`，否则现场排查还得去翻 `~/.codebuddy/logs`。

## 六、最小、真实、可重复的接入验证路径（三步）

> 原则：认证没打通之前，一切「自动接入」表述都不成立（协议 M2.4 已写明，继续遵守）。以下每步都有明确判定标准。

**Step 1｜干净终端完成官方登录（人工，一次性）**
不要在桌面会话内的终端跑。直接双击工作台目录的 `登录WorkBuddy执行通道.cmd`（从资源管理器启动=干净环境），按提示 `/login` → 网页授权 → **保持该终端开启**。
判定：终端内显示登录成功（16:44 已达成过一次）。

**Step 2｜立即跑 §1.3 探针（机器，可脚本化）**
判定标准：stdout 为合法 JSON 且 `result` 字段包含「可用」→ 认证链路通，可进入 Step 3。
当前状态：**此步失败（Authentication required）**，证据已固化，无需重复跑。

**Step 3｜打通后接入工作台（一行改动级）**
认证通了以后，`external-runtime.js` 只需按 §5 修 1、2 两项，即可恢复 M2.4 自动通道；随后用一个真实双成员 run（WorkBuddy 执行 + Cursor 复核）按协议验收。

**Step 2 失败期间的处置（当前状态）：**
- 携带 §1.2 证据链向官方反馈：https://cnb.cool/codebuddy/codebuddy-code/-/issues/new（或 codebuddy@tencent.com），要点：官方 npm CLI 2.163.0 + WorkBuddy product 配置 + 网页授权成功后，headless `-p` 进程在 `POST /v2/plugin/accounts` 收到 401，`account list is empty`。
- 工作台维持现状：失败显示真实阻塞 + 「重试成员执行」，人工回填继续走「人工 / 外部 Agent 回填」——这是协议允许的诚实路径，**不是**自动接入的替代品。
- 可选并行试验（不改安装、不动凭据）：新开一个干净终端交互式 `cbc`，登录后**在同一进程内**直接发一条消息，确认交互进程自身能否调用模型。若交互进程也不行，则问题更靠前（登录/配额），反馈时信息更完整。

## 七、回答用户四个问题（一句话版）

1. **支持被自动调用吗？** 支持，通道是 CLI（桌面版引擎即 CLI，npm 包公开可装，`-p` 无头 + JSON 输出为官方管道模式；`--serve`/`--acp` 为常驻备选）。API/MCP 服务端/插件/任务监听均无对外通道。
2. **桌面登录供 CLI 用？** 不能（已实测）。CLI 有独立登录（16:44 成功过），但登录态在 headless 进程刷新时被服务器 401 拒绝——当前接入的唯一硬阻塞，属产品级问题。
3. **如何下发/收成果/要什么进程？** 维持现有设计：工作台 server（现已在跑）常驻 → 按任务 spawn CLI 子进程（跑完即退，无需守护进程）→ stdout JSON 落盘 `data/agent-results` + 回写台账与群聊。修 §5 的 4 处即可。
4. **最小验证路径？** §6 三步；当前卡在 Step 2，证据链完整，先走官方反馈，不冒充、不回填冒充自动接入。

---
附：本文件不改动任何配置；`tmp-cli-test` 产物与两份日志为唯一测试残留，位于 WorkBuddy 会话工作区，未含凭据。

---

# 第二轮验证（2026-10-10 凌晨）｜同进程调用 + 官方常驻接口

约束遵守：保留鉴权（未用 `--auth none`、未导出/搬运任何凭据）；未修改工作台代码；接口仅启动 ≠ 接入成功，以下结论全部以实际响应为准。

## 二.1 验证对象 A：登录后的同一进程调用（ACP 协议）

选用 CLI 官方 `--acp`（Agent Client Protocol，stdio ndJson）做载体：同一进程内 initialize → authenticate → prompt，最纯粹的"同进程"定义。

**测试方法**：探针脚本 `acp-auth-probe.js`（留存于 tmp-cli-test），干净环境（`env -i` 最小变量集）+ 桌面原版 product.json：

```bash
env -i PATH=... SystemRoot=... USERPROFILE=... LOCALAPPDATA=... APPDATA=... TEMP=... TMP=... COMSPEC=... \
  ACC_PRODUCT_CONFIG_PATH=".../app.asar.unpacked/cli/product.json" \
  node acp-auth-probe.js
```

**实际响应（已实测）**：

| 步骤 | 结果 |
|---|---|
| `initialize` | ✅ 成功。响应含 `agentCapabilities`（loadSession/multitask 等）和 **`authMethods`**：`iOA` / `external`（Google/Github）/ **`internal`（WeChat）** / `selfhosted`（企业域名）——ACP 原生支持进程内登录 |
| `session/new` | ✅ 成功，返回 sessionId |
| `session/prompt`（未登录直接发） | ❌ `stopReason: "refusal"`，`errorMessage: "Authentication required"`（traceId 可溯）——与 `-p` 模式完全一致的认证墙 |
| `authenticate`（methodId=external） | ⚠️ 浏览器弹出 Google/Github 登录页，用户完成授权；**但授权未改变 workbuddy-desktop 账户状态**——随后 `-p` 复测仍 Authentication required |
| `authenticate`（methodId=internal/WeChat） | ⏳ 两次尝试均因浏览器授权未在窗口期内完成/进程被中止而**未出结果**。此步尚待验证 |

**限制与结论**：ACP 协议通道本身可用（握手、会话、错误上报全通），但在「进程内登录完成」这一步未拿到结果之前，**同进程调用 = 未验证，不可声称支持**。取证补充：日志证实本机**从未有任何独立 CLI 进程成功调用过模型**（16:47 已登录的交互会话 pid 9732 无任何 AgentService 运行记录）——所有通道的失败模式统一为 refresh 401 → Authentication required，指向服务端账户链路问题而非单一通道问题。

## 二.2 验证对象 B：官方常驻接口（`--serve` REST API）

**启动命令**（干净环境，Node 22 与 24 各测一轮）：

```bash
env -i PATH=... ACC_PRODUCT_CONFIG_PATH=".../app.asar.unpacked/cli/product.json" \
  <node> ".../@tencent-ai/codebuddy-code/bin/codebuddy" --serve --port 51910 --host 127.0.0.1
```

启动后输出 `Endpoint`、`Web UI`（含 `?password=`）与 `Password`。鉴权实测（重要，文档未写）：

- 所有 `/api/*` 需 `Authorization: Bearer <启动密码>`；
- 干净环境下还需 `x-codebuddy-request: 1` 头（缺省 403 `Missing required header`）。**注意**：从桌面会话内启动的进程会因继承 `CODEBUDDY_DISABLE_REQUEST_VALIDATION=1` 而**跳过**此校验——昨天首次探测被掩盖，今天干净环境才暴露。工作台 spawn 时必须显式带此头；
- 本机 curl 需 `--noproxy "*"`（代理工具会劫持 127.0.0.1）。

**REST 面实测结果（均 200，真实响应）**：

| 端点 | 实测 |
|---|---|
| `GET /health` | `{"status":"UP","components":{"eg":{"status":"UP"}}}` |
| `GET /api/v1/auth/status` | `{"authEnabled":true,"authenticated":true}`（HTTP 密码层状态） |
| `GET /api/v1/status` | `{"data":{"status":"ok","busy":false,...}}` |
| `GET /api/v1/sessions` | 列出存储会话（含此前失败探针的会话记录） |
| `GET /api/v1/workers` | 列出运行中的 CLI 实例（serve 自身 + 历史交互会话） |
| `GET /api/v1/jobs` / `settings` / `runtime-defaults` | 正常返回 |

**执行链路实测（关键，结论为否定）**：

`POST /api/v1/jobs {"prompt":"..."}` → 200 创建 job（返回 id/sessionId/state=working），但 job **永远卡在 `preparing`**，三次提交、两种 Node 版本均未收敛：

| 环境 | 实际失败点 | 证据 |
|---|---|---|
| 首次（污染环境） | job 子进程继承桌面注入的 `CODEBUDDY_SAFE_DELETE_BULK_GUARD` 等 83 个变量，锁文件 `rmdir` 被拦截 → EPERM | `~/.codebuddy/logs/job-1e163f0c.log` |
| 干净环境 + Node 24 | broker 锁协议 `rmdir .locks\<id>.state.lock.guard` → **EPERM 100% 复现**（同目录手动 mkdir/rmdir 正常，排除环境锁定） | `job-2077e3bf.log`、`jobs/2077e3bf/state.json` |
| 干净环境 + Node 22 | 锁不再报错，broker 进程存活且 attach socket 建立，**但 worker 子进程从未被 spawn**（无子进程、无日志、无报错），job 同样挂死在 preparing | `job-309492dc.log`、`state.json`、`broker.json` |

**辅助缺陷（已实测）**：npm 安装的 `@tencent-ai/codebuddy-code@2.163.0` 的 `bin/native/win32-x64/` **目录为空**，`job-object.node` 缺失，所有进程启动都报 `Windows no-orphans cleanup unavailable`（bin/windows-job.cjs 加载失败）——原生子进程托管组件缺失，高度疑似 worker spawn 失败的诱因。对照测试：`@lydell/node-pty` 二进制安装完好且直接 spawn 验证通过，可排除 PTY 层。

**结论**：`--serve` 的**接口层真实可用**（鉴权、状态、会话/任务查询全通），但**执行层（jobs broker）在本机是断的**——接口能启动、能建 job，不等于能出成果。按"不凭启动宣称成功"的约束：**官方常驻接口调用 = 未通过**，需官方修复（或绕过 jobs 子系统）。

## 二.3 本轮新增的环境坑（全部实测，工作台 spawn 环境清单据此补全）

1. 桌面会话会向子进程注入 **83 个** `CODEBUDDY_/WORKBUDDY_/ACC_` 变量（含 `NODE_OPTIONS` 的 node shim、`CODEBUDDY_CONFIG_DIR`、`CODEBUDDY_SAFE_DELETE_BULK_GUARD`、`CODEBUDDY_DISABLE_REQUEST_VALIDATION`）。`env -u` 逐个清不可靠，**建议 spawn 时白名单式构造环境**（PATH/SystemRoot/USERPROFILE/LOCALAPPDATA/APPDATA/TEMP/TMP/COMSPEC + ACC_PRODUCT_CONFIG_PATH）。
2. WorkBuddy product 配置下 CLI 必须显式 `--port`（否则与运行中的桌面端抢 51749）。
3. REST 调用必须带 `Authorization: Bearer <serve 启动密码>` + `x-codebuddy-request: 1`。
4. 本机代理会劫持 127.0.0.1 请求（curl 需 noproxy）；桌面会话沙箱会拦截 CLI 触发的 `reg.exe`（仅影响从该会话内 spawn 的场景）。

## 二.4 更新后的通道判定（覆盖第一章相应条目）

| 通道 | 判定更新 |
|---|---|
| CLI `-p` 一次性 | 通道设计可用，**认证墙未过**（同第一轮结论） |
| CLI `--serve` REST | 接口层可用；**jobs 执行层在本机断**（二.2）→ 暂不可用于真实派工 |
| CLI `--acp` | 协议全通，支持进程内 authenticate；**同进程登录→调用待完成 internal/WeChat 授权验证**（二.1） |
| 同进程调用是否可行 | **未验证通过**。本机无任何独立 CLI 进程成功调用过模型的记录；唯一完成的一次浏览器授权（external）与 workbuddy-desktop 账户无关 |

## 二.5 下一步（按优先级）

1. **同进程登录验证（只差一次浏览器授权）**：运行 `node acp-auth-probe.js`（脚本与命令见二.1），在弹出的浏览器页面完成 **internal（微信）** 授权；探针会自动在同进程内发 prompt 并打印结果。判定标准：输出 `[agent answer] 可用`。
2. **官方反馈素材已齐**：① refresh 401 链（第一轮）；② jobs broker 两处故障（锁 EPERM、worker 不 spawn）+ `bin/native/win32-x64/job-object.node` 缺失（npm 包安装残缺，可先行 `npm install @tencent-ai/codebuddy-code@2.163.0 --force` 重装验证，或对照桌面端自带 CLI 的完整 bin/native）。
3. 在 1 或 2 有结论前，工作台维持"真实阻塞 + 人工回填"，不宣称自动接入。

---

# 三、第三轮：代理变量排查与同进程授权复测（2026-10-10 05:30–05:50，全部只读实测）

> 起因：BEN 提出"节点选址（香港/美国）是否影响接入"。本轮把代理作为独立变量实测，并复测第二次浏览器授权结果。

## 三.1 第二次浏览器授权（internal/微信）——未生效（已实测）

| 检查项 | 命令/方法 | 结果 |
|---|---|---|
| ACP authenticate 是否返回 | `node acp-auth-probe.js`（method=internal，600s 窗口） | **悬挂**，浏览器授权完成后 CLI 无任何确认 |
| 授权是否落盘 | `find ~/.codebuddy/local_storage -name "*.info" -newermt "2026-10-10 04:00"` | 最后写入 **05:29:09**（授权完成前），**授权后零写入** |
| 授权进程日志 | 全量 grep `pid=39152`（ACP 子进程） | **零日志行**——进程完全静默等待 |

**结论**：第二次授权在浏览器侧完成，但 CLI 侧从未收到回调/轮询结果，未持久化。同进程登录验证**仍未完成**。但注意：昨日 16:44 已证明**即使登录真实成功，随后的 accounts refresh 依旧 401**——所以同进程复测的边际价值已下降，401 根因不在"登录态新旧"。

## 三.2 代理变量实测（回答"香港/美国节点是否影响"）

| # | 测试 | 命令 | 实际响应 |
|---|---|---|---|
| 1 | 系统代理现状 | `reg query HKCU\...\Internet Settings /v ProxyServer` | `127.0.0.1:7897`（ProxyEnable=1），监听者 = **efanapp.exe (pid 7572)** |
| 2 | 当前节点出口 | `curl -x http://127.0.0.1:7897 "http://ip-api.com/json/?fields=query,country,regionName"` | **United States, California（155.254.126.211）**；同请求直连无响应 |
| 3 | workbuddy.cn 经代理 | `curl -x http://127.0.0.1:7897 -X POST https://www.workbuddy.cn/v2/plugin/accounts` | **401，0.187s** |
| 4 | workbuddy.cn 直连 | `curl --noproxy "*" -X POST <同上>` | **401，0.328s** |

**关键判读**：测试 3 经代理仅 0.19s——若真走美国节点 hairpin，TCP+TLS+HTTP 往返至少 300–600ms。说明 **efanapp 处于规则模式，workbuddy.cn（国内域名）走 DIRECT，根本不经过你所选的香港/美国节点**。节点选址只影响被规则判定为境外的站点（如测试 2 的 ip-api.com）。

**另发现（已实测）**：CLI 有独立代理感知——日志 `GalileoService: OTLP HTTPS traffic will be sent through proxy: http://127.0.0.1:59771`（遥测流量；该端口现已无监听）。auth 流量是否走代理由 CLI 内部决定，**未证实**；但在规则模式下两条路径对 workbuddy.cn 都是直连，问题 moot。

**对 BEN 问题的直接回答**：
- **保持 efanapp 规则模式时：无需考虑节点选址**，香港/美国对 workbuddy.cn / codebuddy.cn 的 API 调用没有影响（实测延迟证据）。
- **唯一要避开的场景：把加速器切成"全局模式"**——那时 workbuddy.cn 会经境外节点出口，一个仅服务境内的账号 API 完全可能拒绝境外来源（症状恰好就是 401）。如加速器支持自定义规则，建议把 `*.workbuddy.cn`、`*.codebuddy.cn`、`*.tencent.com` 显式加入 DIRECT 白名单兜底。
- **401 根因不在代理**：昨日 16:44 全新登录后、同机同网、refresh 仍 401，而桌面端（同机同网）全天正常调用——变量只剩 CLI↔服务端的产品/账号链路。

## 三.3 本轮新增环境异常（限制声明）

1. 本会话后段 Git Bash 的 `env -i` 静默失效（`env -i /usr/bin/echo hello` 都无输出、rc=0；此前 04:48–05:25 同法正常）——干净环境构造法需改用白名单脚本。
2. 一次 `-p` 探针出现**第三种故障模式**：进程存活、端口绑定成功、**零日志、零输出、无外连**，悬挂 7 分钟后人工终止（pid 45524）——疑与此前被 kill 的 ACP/serve 进程残留锁有关。即：CLI 在本机除了"快速 401"外还会"静默悬挂"，工作台超时与重试设计必须覆盖两种模式。

## 三.4 更新后的总体判定

| 验证项 | 判定 |
|---|---|
| 同进程登录→调用 | **未完成**：浏览器授权两次（external 一次、internal 一次），CLI 均未确认；且 16:44 证据表明即使成功也大概率仍 401 |
| 官方常驻接口（--serve REST） | **未通过**：接口层可用，jobs 执行层断（锁 EPERM + worker 不 spawn + 原生模块缺失） |
| 代理是否为 401 根因 | **已排除（规则模式下）**：实测 workbuddy.cn 经代理走直连；401 与节点选址无关 |
| 仍需官方回应 | ① accounts refresh 401（新登录亦复现）；② jobs broker 双故障 + `bin/native/win32-x64` 为空；③ authenticate 回调悬挂 |
