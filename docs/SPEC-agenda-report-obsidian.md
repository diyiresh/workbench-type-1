# 月报导出 Obsidian 与来源变化处理

2026-10-27，用户 Confirm Development。只扩展行程月报的保存，不重新生成报告、不调用模型、不解除 SiliconFlow 暂停、不改变成员调度。

## 交互

- 月报的保存按钮为“保存到报告库和 Obsidian”；日／周报告沿用原有保存功能。
- 保存前预览绑定当前正文、原生成作业／尝试、原来源、当前来源及目标目录。来源已变化时，提供“保留为历史草稿／重新生成／取消”，不再仅弹出 `report_source_changed`。
- 保留历史须单独明确点击；保存的记录及文件标为 historical-draft，不将原 held 执行改为已采用或最新事实。报告库及历史列表明确显示其身份。
- 原生成作业已保留完整返回时，可点“恢复已生成草稿”重新查看，不调用成员。此功能恢复成员原稿，不声称恢复尚未保存到后端的浏览器手工修改。
- 文件成功写入并读回、台账成功登记后才显示成功、实际路径及 SHA-256。失败保留编辑框；预览期间新修改不被旧保存覆盖，提交期间的新修改仍保持待保存。

## 文件与唯一台账

目标：现有 `remote.agendaNotes.vaultRoot` 下固定目录 `monthly report comes from workbench`。不接受请求传入任意文件路径，不迁移仓库，不修改独立复盘目录及其 VaultRAG 排除设置。

UTF-8 Markdown 文件为 `YYYY-MM-工作月报-v001.md`，重复保存递增版本，独占创建且不覆盖原文件。完整正文保留；仅在必要时补文件末尾换行。YAML 属性记录月份、生成成员、作业／尝试、原／当前来源哈希、保存时间、版本及 current/changed 来源身份。

报告正文与交付引用仍在原 `data/store.json` 的 `reports`、`reportExports`。每次明确另存有独立记录；同一幂等键和内容返回同一次交付。生成作业及其结果不被删除或改写。

目标仓库和分类必须为真实目录，不跟随链接。登记后的交付重放会核验实际文件哈希；文件变动不假报通过。文件已完整写入但台账提交失败时，同键重试可核对文件内的请求身份、全部来源属性和正文后恢复登记，不写第二份。

## 接口

- `GET /api/agenda/reports/export/config`：只读目标目录；不创建目录。
- `POST /api/agenda/reports/export/preview`：sourceJobId、sourceHash、body；返回 snapshot、sourceState 和目标目录，不写文件。
- `POST /api/agenda/reports/export/save`：同一输入，加 previewSnapshot、idempotencyKey；来源变化另需 confirmedHistorical=true。正文、来源或路径再变动则停止。

以上均限本机。文件与台账不是跨资源事务；若台账提交失败，明确返回“文件已写入但登记失败”，不宣称整个保存完成。

## 验收

- `test/agenda-report-export.test.cjs`：完整中文正文、UTF-8 读回及真实字节 SHA-256；当前／历史确认、正文与来源再变动、版本不覆盖、幂等、登记失败恢复、文件改动、目录链接及缺少配置。
- `test/agenda-report-export.browser.cjs`：复现生成后完成状态变动、确认历史／普通保存、报告库标签、原稿恢复不调用模型、预览中输入变化、目标缺失、中文／英语及窄屏。
- 原成员选择与执行治理、日程筛选回归通过；全部测试使用隔离台账／仓库及替身成员，不向真实 Obsidian 仓库写测试报告。
