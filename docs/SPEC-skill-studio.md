# 技能工作室第一迭代规范

2026-10-18，用户已 Confirm Development。范围对应 PLAN-paperclip-led-workbench.md 第一迭代。

## 事实与边界

保留旧 skills 说明记录，新增 skillLibrary、skillCases、skillRuns、skillRequests 到唯一台账。Markdown 正文存于数据目录 skill-library/<skillId>/<versionId>/SKILL.md；不可变版本以哈希绑定。经验来源只读取用户选定的 memories、lessons、artifacts、projectMessages、reports。候选草稿不生效；发布必须确认。第一版不复制第三方代码，不扫描会话、不导入脚本、不写全局 Agent 配置。

成果登记来源仅包含名称、路径和原有登记字段，不自动读取文件正文；需要正文经验时选择项目成果消息或报告正文。引用保留原文快照及哈希。当前提炼采用规则模板与人工编辑，不隐式调用模型。

## 接口

- GET /api/skill-library：清单；GET /api/skill-library/sources：可选来源；GET /api/skill-library/<id>：草稿、实际版本文件、测试和执行记录。
- POST /api/skill-library：从明确来源或空白创建候选草稿。
- POST /api/skill-library/<id>/draft：保存编辑稿。
- POST /api/skill-library/<id>/publish：confirmed=true、expectedRevision、idempotencyKey；写入并读回后才登记版本。
- POST /api/skill-library/<id>/restore：按历史 versionId 生成新草稿，重新确认发布后产生新版本。
- POST /api/skill-library/<id>/state：显式停用或重新启用；不会自动执行。
- POST /api/skill-library/<id>/cases：保存固定输入与人工检查点。
- POST /api/skill-library/<id>/run：显式启动一次只读技能测试，可关联一条现有任务；固定 versionId、caseId、agentId，返回 attemptId。
- POST /api/skill-library/<id>/evaluate：按输出哈希确认人工测试判断及依据，不代替业务验收。

写入限本机，所有操作使用幂等键；草稿、发布、状态、历史载入及用例保存使用 expectedRevision，测试固定 versionId/caseId，人工判断绑定 outputHash。失去响应后同键同参数返回原回执；同键不同参数拒绝。读取/刷新不调用模型、不写版本、不重派任务。

## 执行通道

第一版实际执行支持现有 Codex ChatGPT CLI，只读、临时会话、120 秒上限、单次执行、不自动重试，不检索 VaultRAG。WorkBuddy、Cursor 显示为尚未接入技能测试，不能回落到其他成员；WorkBuddy 继续暂停。技能的允许 Agent 不代表通道已接通。

一次测试是独立执行尝试，不领取业务阶段、不改任务完成状态，不生成正式公文。可绑定现有任务 ID；输入由用户在测试用例中明确给出。保存技能版本、输入/检查点快照、提示哈希、接收校验标记、线程回执、完整输出及输出哈希。已传入、Agent 确认接收、实际采用和人工检查结论分别记录；没有采用证据始终为未知。

提交前和调用前检查技能启用、版本授权、Agent 归档/暂停、关联任务/项目暂停与归档。完成时再次检查及比较变更代数；迟到输出保留为 held，不产生通过结论。服务重启将未完成运行标为 interrupted，不能自动重发。旧版本测试仅能由用户显式选择，用于对照；默认选最高生效版本。

## 验收

隔离台账检查：来源保真与未选内容不读取；发布前不生效；读回哈希；冲突/幂等；旧版本回退；篡改/缺失文件；路径及链接边界；固定输入的版本比较；暂停和迟到结果；重启中断；实际运行失败不能显示通过；人工判断绑定输出；原业务记录不改变。浏览器检查可编辑流程、离开/返回草稿、中英文、四主题、窄屏，以及刷新没有写入。真实连接验证单独记录实际成功或阻塞，不用模拟服务冒充。

## 2026-10-18 验收记录

- npm test、npm run test:agents、npm run test:ui、npm run build:assets 通过；更新说明与逻辑图后补跑 guide/browser 检查通过，新增界面翻译检查覆盖 866 条系统文案。
- 新增 test/skill-studio.test.cjs：验证来源隔离、实际文件读回、重复请求、并发修订、历史回退、同一用例跨版本对照、暂停/归档后又恢复的迟到结果、重启中断、文件篡改与 junction 路径拒绝。适配器在此测试中被替身替代，不作为真实调用证明。
- 新增 test/skill-studio.browser.cjs：隔离数据下实际操作编辑、确认、发布、回退、用例、人工判断、跨页面草稿保留、安全 Markdown 预览、只读刷新、中英文、四主题与窄屏。未发起真实业务任务。
- test/skill-studio-live.cjs 仅显式 opt-in 运行，不包含在常规测试中。使用构造的无业务资料样例和隔离台账，通过现有 Codex ChatGPT CLI 实际调用一次，返回 awaiting-evaluation、完整输出、线程回执及正确接收标记；技能 SHA256 为 82b7f826842649b8a2fbfb3f1b48989dea9e723a199f3368411d8b0198f7228b。关联样例任务进度仍为 0，采用状态仍为 unknown，未伪写用户人工通过。
- 加载本机新版前无活动执行作业、无启用且未暂停的自动工作链。加载后 28 个业务集合哈希保持一致，18 条任务与 3 条工作链不变；WorkBuddy 自动化只读核对仍为 paused。技能库保持空白，不把验收样例塞进实际台账；旧版 3 条技能说明保持。
- 真实本机页面检查无脚本错误、无写请求。私有运行回执、截图和哈希证据位于忽略目录 data/skill-studio-validation/，不提交 GitHub。源代码在既有开发分支，未合并 main，未推送。

## 已解决问题对照

| 确认范围 | 对应结果 | 状态 |
|---|---|---|
| 从经验形成可复用技能 | 指定来源、规则模板、可编辑草稿和确认发布 | 已实现 |
| 实际文件与版本 | 不可变 Markdown、读回哈希、冲突/幂等、对比与回退草稿 | 已实现 |
| 测试与使用证据 | 固定输入、版本/任务引用、实际 Codex 回执、输出哈希与人工判断 | 已实现并单独完成真实通道验证 |
| 保留其他成员与知识边界 | WorkBuddy 暂停、无全局技能写入、无 VaultRAG 调用或业务阶段推进 | 已核对 |
| 正式任务自动应用技能、多通道领取改造、知识文件浏览 | 保留后续接口与分期方案，不宣称完成 | 后续迭代 |
