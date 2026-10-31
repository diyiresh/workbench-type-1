# 复盘摘要成员通道修复

2026-10-31 用户 Confirm Development。沿用当前第三分支，不改变业务完成状态、SiliconFlow 暂停或 WorkBuddy 调度。

- 原始复盘可独立保存；未完成行程的生成按钮明确禁用并显示原因。文本不推断完成。
- 生成摘要和整合补充单选 Codex、Cursor、WorkBuddy，沿用现有成员适配器和 agendaReportJobs / executionAttempts 的唯一台账，使用 workType=review-note 区分周期报告。
- 输入固定原始复盘、日期、标题、目录配置、整合前草稿和已保存笔记版本。生成指令复用 agenda-notes 原有规则；useVault:false，无付费 API 回落。
- POST 原 draft/refine 接口明确携带 agentId、idempotencyKey 时返回 202 job；无成员的旧调用保持兼容，不从成员通道回落 API。查询、开始回执、明确核对/重试复用原报告 jobs 接口。
- 成员全局占用、同输入三次限制、领取凭证、重启不重放、源变化暂存均沿用执行治理。目录或已载入文件变化也使返回失效。
- 前端等待状态可见，关闭后重开恢复查询，不自动重新生成。当前输入有修改时迟到结果不覆盖；完整原稿可明确恢复，仍校验原始复盘及保存目录。
- 确认保存 Markdown 才落盘，沿用原路径、版本、文件读回和旧版本清理逻辑。生成和整合不写 Obsidian。
- 更新第三分支侧栏规范为桌面 236px、中等窗口 208px；测试从实际布局参数核对缩放上限，并验证记忆、重置、取消及草稿保持。

参考：既有 SPEC-agenda-report-members.md 和 [Codex 官方完成/失败事件示例](https://github.com/openai/codex/blob/main/sdk/typescript/samples/basic_streaming.ts)。复用已安装适配器，不升级 CLI / SDK；实际登录、占用和成员额度仍可能导致失败，不得宣称隔离测试等于真实成员已完成。

验收：未完成时零派发且文字可保存；三成员隔离执行；整合输入和前稿保留；重复/刷新不派发、源变化/目录/文件变化不覆盖、成员占用/失败/核对重试、WorkBuddy 原队列、无付费网络/无 RAG；既有复盘/月报/侧栏回归。
