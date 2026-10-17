# 工作台下一阶段方案：以 Paperclip 为主，吸收 EvoFlow 与 Multica

日期：2026-10-18。状态：用户已 Confirm Development，批准第一迭代；第二、三迭代仍是后续方案。准确实现边界及验收见 SPEC-skill-studio.md。

## 1. 判断与目标

以 Paperclip 的任务治理、技能工作室和执行记录作为主要设计参考；EvoFlow 补充任务依赖、计划确认和知识来源展示；Multica 补充本机执行通道、技能发现与可解释的故障状态。

保留当前工作台及其十个一级入口，不同时部署三个控制台，不新增平行业务数据库。优先解决两个实际问题：经验无法稳定转成可复用技能；任务分派、实际执行与最终验收之间缺少容易查证的联系。

本文核对了三个仓库的文档和相关实现，未安装其依赖、运行第三方服务或验证全部端到端行为。上游已有实现不等于本工作台已经接入。

## 2. 研究版本与依据

以下结论绑定所检查的提交，不表示以后版本保持不变。

| 项目 | 研究提交 | 主要核对位置 | 适合吸收的部分 |
|---|---|---|---|
| Paperclip | `4415665d67b16ffefbe4519c4bdd521f37bb87b9` | Skills Store、Runner-created skills、Skill Studio、company-skills 服务与表结构、execution-policy、heartbeat 协议、运行适配器 | 任务与执行分离、独立复核、技能编辑/版本/测试、来源和任务回执、预算与运行治理 |
| EvoFlow | `1bb697f2892649559944674091ebae2b20fa9360` | project-team-plan-workflow、技能选择与角色配置、owned knowledge pipeline/UI | 先确认计划、依赖关系、显式技能授权、知识文件浏览与索引状态 |
| Multica | `18fa9f728a9e25f2465df2789631edb2a75442ad` | CLI_AND_DAEMON、daemon/local_skills、dispatch/reason | 成员与本机运行通道分离、跨工具技能来源发现、稳定故障分类 |

Paperclip 的技能创建和更新具备幂等键、版本冲突保护、来源任务回执；Skill Studio 支持版本和固定输入测试。其默认技能创建策略较开放，并非自动要求用户确认。因此，本工作台应借鉴文件/版本/回执机制，继续采用草稿确认后发布。

Paperclip 的复核执行策略将业务状态与审批决定分开；相关服务设置默认三轮复核上限。本工作台已有独立复核及有界重试，重点补齐统一展示和缺失的执行证据，不重建另一套复核链。

在本次检查的 Paperclip 内置适配器中未发现 WorkBuddy 专用通道。Multica 的 CodeBuddy/CLI 技能目录发现，也不能证明能唤醒已登录的 WorkBuddy 桌面程序。三者均不能替代本机领取链路的实际验收。

## 3. 现有模块如何承接

| 现有入口 | 下一阶段职责 | 主参考 |
|---|---|---|
| 首页 | 汇总待我决定、受阻、等待领取、等待复核事项；每项跳回同一原记录 | Paperclip 的操作总览与决策入口 |
| 项目中心 | 展示目标、任务、执行尝试、成果和复核之间的关系；将现有四岗位链保留为默认模板 | Paperclip 的任务治理，EvoFlow 的依赖与计划 |
| Agent 中心 | 展示成员职责、技能授权、实际运行通道、领取心跳和历史执行；暂停具有明确原因 | Paperclip 的角色/运行适配，Multica 的本机通道 |
| 资产中心·技能 | 经验来源、候选、编辑预览、版本比较、测试、确认发布和使用证据 | Paperclip Skill Studio 为主，Multica 的来源发现为辅 |
| 资产中心·知识 | 展示已有知识目录、笔记、来源与可检索状态，复用现有知识服务 | EvoFlow 的知识可视化为主 |
| 设置 | 连接配置、执行额度与并发限制、适配器能力、知识服务诊断 | Paperclip 的执行治理 |

工作报告仍只负责周期报告；每日行程、简报、学习、生活保留现有职责。不得因借鉴上游又增加一套“经营/组织/任务大厅”，造成重复导航。

## 4. 技术与数据选择

继续使用现有 Node.js HTTP 服务、原生 ES Modules/CSS 和唯一业务台账 `data/store.json`。不为本期引入 Paperclip 的完整 React/Express/PostgreSQL 部署，也不迁移当前台账。

新增元数据进入同一台账；技能正文使用工作台管理的专用文件目录，按技能 ID 与版本保存，台账登记相对路径和内容哈希。文件是实际资产，台账是状态与引用的唯一依据。保留已有笔记目录和来源，不将其正文复制成另一知识库。

新增关联沿用 `docs/扩展接口约定.md` 中的带类型 `ProjectRef`、`attemptId`、`SkillCandidate` 和 `KnowledgeSource`。业务项目、一次协作工作链和执行尝试保持不同身份，以显式关联连接，不能按名称自动合并。

后续内部契约拟补充以下信息；这是接口设计要求，本轮尚未提供写入路由：

```text
SkillVersion: skillId, versionId, contentHash, sourceRefs,
              reviewState, confirmedBy, confirmedAt, supersedes
SkillTest: skillId, versionId, inputSnapshot, expectedChecks,
           agentId, attemptId, resultRefs, evaluation
SkillUsage: skillId, versionId, agentId, attemptId,
            deliveryEvidence, observedUseEvidence
ExecutionAttempt: attemptId, projectRef, stepId, claimOwner,
                  leaseUntil, idempotencyKey, inputVersion,
                  state, blockerCode, resultRefs
```

## 5. 第一迭代 MVP：让一条经验成为有版本、可追溯的技能

范围由以下六项组成，先做成一个完整闭环，不同时实现三个项目的全部功能：

1. 在现有教训、经验记录和项目成果旁提供“创建技能草稿”。用户选定来源后才读取和提炼；保留来源记录 ID、时间及适用范围。可直接编辑，不强制调用模型。
2. 在资产中心提供技能列表与详情，区分候选、草稿、已发布、停用；展示来源、适用任务、允许使用的 Agent、当前版本及验证状态。既有说明卡不冒充实际技能文件。
3. 提供可编辑 SKILL.md 预览、基本格式检查、版本差异与用户确认。第一版以 Markdown 为主，不自动导入可执行脚本、安装依赖或扫描全部私有对话。
4. 用户确认发布后写入实际文件，完整读回并核对哈希后才标记发布成功。保存使用预期版本和幂等键，重复提交不重复建版本；冲突要求重新读取。回退生成新版本，保留历史。
5. 支持保存固定测试输入、预期检查点及实际结果对照。静态格式通过、测试用例通过、业务复核通过分别显示；模型给出的自评分不是验收结论。真实 Agent 测试必须显式发起并遵守暂停、写作和调用权限。
6. 将已确认技能版本绑定到一次指定任务/执行尝试，提供传入证据和运行回执。先通过现有可用通道验收一个 Agent；其余通道显示真实支持程度。已传入不等于已采用，更不等于结果正确，缺少采用证据时标为未知。

第一迭代不自动修改所有 Agent 的全局配置。分发仅针对用户选定的工作台自有技能及已确认目标，不覆盖现有插件/第三方技能。通道必须核对实际传入内容；不支持可靠加载的通道不能显示分发成功。

WorkBuddy 在本期继续保留且保持暂停。允许记录其技能授权意向，不实际运行、唤醒或伪造使用回执。需要真实执行的验收使用用户批准且可执行的其他通道；WorkBuddy 的执行验收保留为待用户恢复后的独立项目。

### 第一迭代验收

- 一条已有纠错可以形成候选草稿，原记录保持不变，来源可定位。
- 未确认草稿不会变成任何 Agent 的生效规则；发布后的正文读回与确认内容一致。
- 同一提交重试只生成一个版本；并发修改不覆盖；v1/v2 可比较并可用新版本回退。
- 同一固定输入可分别关联 v1/v2 测试结果，页面明确区分未运行、运行失败、待判断和检查通过；没有真实调用时不显示测试已通过。
- 至少一个可用 Agent 通道能证明指定任务收到了指定版本，回执关联原任务和执行尝试；若授权/通道不可用，报告阻塞而不是用模拟测试代替。
- 刷新页面不调用模型、不发布技能、不重复派发；中英文、四主题、归档和历史版本仍可用。
- WorkBuddy 暂停、Start Writing、独立复核、实际文件交付核验与独立复盘笔记边界保持有效。

## 6. 第二迭代：吸收 Paperclip 的任务治理，补强 WorkBuddy 通道

在第一迭代稳定后，再实施以下内容，细化规范并验收后进入开发：

- 将任务状态与执行尝试状态统一展示。区分待领、已领、实际启动、等待材料、失败、已交成果、待复核与完成；不把程序退出码或文字 PASS 直接当成交付完成。
- 领取采用原子状态检查、唯一尝试 ID、租约和幂等回报，防止两个成员重复领取；重试先查上次是否已执行。服务重启和不确定提交不得无条件重发。
- 暂停、归档、批准与输入版本在提交前及结果收编时双重检查；迟到结果可保留记录，但不得推进接力。
- WorkBuddy 沿用现有领取脚本与本机调度，展示用户暂停、调度未运行、心跳过期、已领取但未启动等区别。新增通道不能绕过已有暂停；恢复必须由用户明确选择。
- 保留“主管→执行→独立复核→整合”默认模板；只对实际需要的工作添加依赖步骤。每次返工保留原成果和意见，不从头丢失上下文。
- 对并发数、单次时长、重复尝试和复核轮次设上限。费用或订阅额度仅显示实际可取得的用量；无数据时显示未知，不能伪装为零费用或实时腾讯额度。

普通 inbox 留言仍不自动成为可执行任务。可提供“转为正式任务”操作，明确负责人、输入、验收与批准条件后，才进入执行队列。

## 7. 第三迭代：知识可视化与复杂协作

- 在资产中心浏览用户指定的现有知识来源、目录与笔记，并显示原路径、定位、源哈希、索引版本和更新时间。
- 分别显示已配置、服务可连接、索引可用和实际检索命中，不能把容器没启动解释为“没有知识”。Docker/Open WebUI/VaultRAG 之间的真实启动依赖需要单独诊断后再考虑启动按钮。
- 行程复盘继续在原目录直接读取最高有效版本，保持 `useVault:false` 和 VaultRAG 排除规则。集中展示不改变检索范围。
- 对确有分支依赖的项目再引入轻量依赖图、阻塞原因与恢复点；不为单人工作台复制庞大组织层级或另建原生模型运行框架。

## 8. 实施边界与许可

- Paperclip 检查版本使用 MIT；如后续选取代码，需核对实际文件及依赖许可，并保留相应声明。复杂服务以独立实现其机制为优先，不整段搬入与当前技术栈不兼容的模块。
- EvoFlow 使用 PolyForm Noncommercial；Multica 使用带附加条件的自定义许可，不能当作无条件 Apache-2.0。本方案对两者借鉴机制与信息结构，不直接复制其 UI 或服务代码。
- 不克隆或同步现有 Agent 的登录凭据，不新增付费 API，不自动运行第三方服务。
- 研究阶段只新增方案文件；用户随后确认第一迭代开发。该迭代继续在开发分支推进，不部署第三方系统，不推送或合并 GitHub，main 保持原边界。

## 9. 已解决问题对照

| 用户问题 | 本方案结论 | 状态与下一步 |
|---|---|---|
| 三个项目怎样选择 | Paperclip 负责主要治理/技能思路，EvoFlow 补依赖/知识，Multica 补本机通道 | 研究完成；按上列提交定位 |
| 如何吸收到当前工作台 | 复用现有十入口、唯一台账与扩展契约，不部署平行系统 | 第一迭代已确认；后续仍为分期方案 |
| 经验散落且没有技能仓库 | 第一迭代实现来源→草稿→确认版本→测试→任务使用证据 | 已进入开发与验收，详见 SPEC-skill-studio.md |
| WorkBuddy 协作不透明 | 第二迭代补领取租约、尝试和故障分类；当前暂停继续保持 | 方案完成；恢复与真实执行另行授权 |
| 知识库不可视且连接依赖手动启动 | 第三迭代复用原库展示来源与连接状态；先诊断再考虑启动集成 | 方案完成；不声称已修复连接 |

## 10. 主要源文件

Paperclip：

- [技能库及来源策略](https://github.com/paperclipai/paperclip/blob/4415665d67b16ffefbe4519c4bdd521f37bb87b9/docs/guides/agent-developer/skills-store.md)
- [从执行任务创建和更新技能](https://github.com/paperclipai/paperclip/blob/4415665d67b16ffefbe4519c4bdd521f37bb87b9/doc/runner-created-skills.md)
- [Skill Studio UI](https://github.com/paperclipai/paperclip/blob/4415665d67b16ffefbe4519c4bdd521f37bb87b9/ui/src/pages/SkillStudio.tsx)
- [技能服务：版本冲突与测试快照](https://github.com/paperclipai/paperclip/blob/4415665d67b16ffefbe4519c4bdd521f37bb87b9/server/src/services/company-skills.ts)
- [执行与独立复核策略](https://github.com/paperclipai/paperclip/blob/4415665d67b16ffefbe4519c4bdd521f37bb87b9/docs/guides/execution-policy.md)
- [有界复核实现](https://github.com/paperclipai/paperclip/blob/4415665d67b16ffefbe4519c4bdd521f37bb87b9/server/src/services/issue-execution-policy.ts)
- [领取和执行协议](https://github.com/paperclipai/paperclip/blob/4415665d67b16ffefbe4519c4bdd521f37bb87b9/docs/guides/agent-developer/heartbeat-protocol.md)
- [运行通道适配](https://github.com/paperclipai/paperclip/blob/4415665d67b16ffefbe4519c4bdd521f37bb87b9/docs/adapters/overview.md)
- [预算预留的边界](https://github.com/paperclipai/paperclip/blob/4415665d67b16ffefbe4519c4bdd521f37bb87b9/server/src/services/budget-reservations.ts)
- [MIT 许可](https://github.com/paperclipai/paperclip/blob/4415665d67b16ffefbe4519c4bdd521f37bb87b9/LICENSE)

EvoFlow：

- [团队计划与工作流](https://github.com/EvovexAI/EvoFlow/blob/1bb697f2892649559944674091ebae2b20fa9360/docs/user/guides/chat/project-team-plan-workflow.md)
- [知识浏览界面](https://github.com/EvovexAI/EvoFlow/blob/1bb697f2892649559944674091ebae2b20fa9360/evopanel/src/pages/knowledge-owned.jsx)
- [许可](https://github.com/EvovexAI/EvoFlow/blob/1bb697f2892649559944674091ebae2b20fa9360/LICENSE)

Multica：

- [CLI 与本机 daemon](https://github.com/multica-ai/multica/blob/18fa9f728a9e25f2465df2789631edb2a75442ad/CLI_AND_DAEMON.md)
- [本机技能发现](https://github.com/multica-ai/multica/blob/18fa9f728a9e25f2465df2789631edb2a75442ad/server/internal/daemon/local_skills.go)
- [执行故障分类](https://github.com/multica-ai/multica/blob/18fa9f728a9e25f2465df2789631edb2a75442ad/server/internal/dispatch/reason.go)
- [许可与附加条件](https://github.com/multica-ai/multica/blob/18fa9f728a9e25f2465df2789631edb2a75442ad/LICENSE)
