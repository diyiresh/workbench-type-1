# VaultRAG 三项交付验收与接手说明

2026-10-06，用户 Confirm Development 后完成实施。实际源项目为 `5.cursor/2.obsidian_RAG`；聊天所在 `3.obsidianrag_backup` 是备份目录。业务进度仍以 Workbench 台账为准。

## 全库验证

| 项目 | 结果 |
|---|---:|
| 原库文件 / 安装后文件 | 2117 / 2121 |
| 可检索文档 | 1089 |
| 空笔记（登记但无文本块） | 7 |
| 文档条目 / 文本块 / 向量 | 1096 / 23361 / 23361 |
| 排除（归档517、配置56） | 573 |
| 需要OCR / 不支持 / 失败 / 非文档 | 311 / 117 / 6 / 18 |
| 缺项、额外项、过期、正文/全文索引/向量错配 | 全为0 |
| 对照备份的原有非配置文件 | 2065，变化或缺失0 |

完整文件登记为 `reports/integration/files.csv`，包括路径、哈希、处理状态和原因；`audit.json`/`audit.md` 为对账结果，`index_issues.csv` 为缺项和过期清单。报告不含文档正文。失败项主要为五个并非有效ZIP结构的DOCX和一个PDF。OFD解析只覆盖文本层，图片和印章不属于已解析内容。

同日备份 `3.obsidianrag_backup/markitdown_output_20261006_010914.zip` 已逐项验证PASS；源代码/Workbench代码及台账快照在 `data/development-backups/`；原索引快照在本机应用数据 `vaultrag/backups/`。

## 已运行的集成

引擎：`http://127.0.0.1:48731`，API 2；配置沿用源项目 `config.toml`，索引沿用 `%LOCALAPPDATA%/vaultrag/index`。管理凭据沿用 `vaultrag/api_key`，独立Agent凭据为 `index/agent_key`。凭据内容不写入发布包或日志。

Obsidian 中已安装并启用 `vault-rag`，资料库侧栏实际显示2121文件、1096文档、23361文本块，重新加载后无插件错误，320像素侧栏无横向溢出。插件搜索验证返回五条带64位原件哈希的命中。插件启动时连接或启动引擎；引擎可在Obsidian关闭后继续运行。未增加Windows登录启动项。

Workbench 仍为 `http://127.0.0.1:3780`。设置页新增资料库连接、覆盖状态、检索、同步和未覆盖文件明细。普通模型生成、虚拟部门执行和Codex总管调用前取资料，记录路径/行号/哈希/检索时间；连接测试明确关闭资料注入。检索失败会阻止本次生成，不能假装已经读到资料。真实在线生成验证五条依据进入模型请求、返回五个V引用编号且来源保存到原台账。文档中的指令按数据处理，资料记载不能视为本次任务完成。

实际Node24.14支持 `http.setGlobalProxyFromEnv`，工作台启动时沿用已配置的Windows代理，localhost/127.0.0.1/::1直连。实现参考官方 [Node HTTP 文档](https://nodejs.org/api/http.html#httpsetglobalproxyfromenvproxyenv)。不改变Windows代理设置。

Codex、Cursor、WorkBuddy的用户MCP配置已合并 `vaultrag`，保留原有服务器。三个工具为 `search_notes`、`get_note`、`vault_status`，只有查询权限。当前库按用户授权开放Agent片段访问；公众新安装默认关闭，可在插件中改为文件夹范围。运行中的客户端需要刷新MCP或开启新会话；配置和协议验证不代表三个产品的每次回答都会主动检索。没有实现跨Agent自动派工。

## 验证证据

- Python：40项通过；Workbench：原有与新增共16个测试脚本通过；插件：TypeScript编译和边界测试通过。
- 冻结引擎独立测试：七种合成文件全部解析，自动新增/改名/删除通过，认证通过，MCP三工具协议调用通过。合成资料保存在开发目录，未进入真实Vault或发布包。
- 既有20题重新评测：hybrid hit@5=80%、hit@1=50%，vector/keyword hit@5也为80%。四个既有漏检为4、11、12、13，仍需改进。
- 15/19题只修正已接受的文件名期望，单独写入 `data/questions-resolved.csv`；原 `eval/questions.csv` 未改。明确映射在 `reports/integration/eval-filename-mapping.json`，评测结果在 `reports/phase6/eval_report.md`。
- 真实生成验证记录在 Workbench `data/vault-live-generation.json`；合成发布包验证在 `data/release-smoke.json`；源文件保全在 `reports/integration/source-preservation.json`。

这些验证证明接入和引用链路工作，不能证明所有专业问题都答对，也未宣称相比旧版检索命中率已提升。

## 公众部署与后续范围

`data/releases/VaultRAG-0.2.0-Windows-x64.zip` 为安装预览。解压后运行安装脚本并在Obsidian启用插件；无需Python/Node/Workbench，需Windows x64、Obsidian和本机Ollama/bge-m3。每个Vault独立配置、索引、凭据；多库同时运行需不同端口。

发布包只包含冻结引擎、插件manifest/main/styles、通用安装文档、第三方许可清单及SHA256校验。个人配置、索引、报告、真实资料、凭据和Workbench台账未纳入。

社区商店上架、代码签名、公开源码许可、macOS/Linux/移动端、图片/扫描件OCR、CEB/CAJ等格式及更广的专业答案评测尚未交付。下一轮优先处理四个漏检及OCR需求；正式公开发行前再完成许可、签名和商店流程。

停止/恢复：结束精确识别的本地引擎进程，随后由插件“启动引擎”或安装引擎 `--config <对应配置> serve` 重启，会补扫中断任务；不要删除源文档。修改索引配置时必须保留Vault身份绑定，避免跨库混用。
