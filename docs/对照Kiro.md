# 对照 Kiro Crew：本台第一版收了什么

来源：<https://kiro.dev/blog/introducing-kiro-crew/> ，Amazon 内部从 MeshClaw 长成，约 3.9 万人使用后开源。

| Kiro Crew | 本台 v0.1 | 下一版 |
|---|---|---|
| 跨会话 Memory | `memories` + `data/store.json` | 按项目分册、检索 |
| Lessons / Skills | `lessons` / `skills` 可见可增 | 从复盘自动抽规则 |
| 多 Agent / 子 Agent | 七个助手入册，任务上写主控与协同 | 真正拉起 Codex / Ollama 会话 |
| 远程 Slack / Telegram | 发件箱 + 配置位 | token 齐了再发晨报 |
| 定时 / 心跳 / 长任务 | 周计划与下一步写在台账 | 本机定时生成周报并入发件箱 |
| 规范驱动 Apps | 七步流水线（与公文核验同构） | 文种模板库、PPT 叙事底板 |
| 活动可观察 | `events` 时间线 | 按 Agent 分栏实时卡片 |

不把 Kiro 整仓搬进来。它解决的是开发者在仓库上的长期执行；本台解决的是 BEN 自己那一摊：公文、调研、PPT、游戏、学习、多个 Agent 抢着干活时没有一张总表。
