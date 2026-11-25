# 本轮源码提交清单

## 317433add86dfb652cb482acce4df2ced37dcb08

新流程核心、批准身份、审核证据、初版台账冲突保护；40个文件。初版写锁残留风险由后续修订处理，不是现场部署版本。

```text
docs/PLAN-workbench-simplification.md
docs/REVIEW-project-workflow-auth.md
docs/REVIEW-project-workflow-evidence.md
docs/SPEC-project-workflow.md
docs/verification/2026-11-25-workflow-evidence-tests.txt
lib/activity.js
lib/agent-dispatch.js
lib/chairman-auth.js
lib/codex-jobs.js
lib/delivery.js
lib/department.js
lib/duty-coordinator.js
lib/execution-governance.js
lib/external-runtime.js
lib/ledger-store.js
lib/preparation-flow.js
lib/project-chat.js
lib/project-workflow-runtime.js
lib/project-workflow.js
lib/workflow-recovery.js
public/app.js
public/js/core.js
public/js/decision-inbox.js
public/js/execution-ui.js
public/js/help.js
public/js/project-workflow-ui.js
public/js/translations.js
public/js/views.js
scripts/chairman-auth.cjs
server.js
test/chairman-auth.test.cjs
test/duty-coordinator.test.cjs
test/helpers/workflow-capability-fixture.cjs
test/ledger-concurrency.test.cjs
test/ledger-store.test.js
test/project-workflow-api.test.cjs
test/project-workflow.browser.cjs
test/project-workflow.test.cjs
test/providers-ui.browser.cjs
test/suites.cjs
```

## c1ebee108c443405f7b4577159149cdeec6b9110

持锁进程退出恢复、短暂竞争退避、真实子进程回归与115项完整单元/接口输出；4个文件。

```text
docs/verification/2026-11-25-workflow-round2-tests.txt
lib/ledger-store.js
lib/ledger-write-lock.js
test/ledger-concurrency.test.cjs
```

## 文档及测试环境分组补充

该后续提交不再改变运行时源码；提交号以 `git log` 为准，避免文件包含自身提交哈希的循环。

```text
docs/REVIEW-project-workflow-evidence.md
docs/SPEC-project-workflow.md
docs/REVIEW-workbench-usage.md
docs/verification/2026-11-25-workflow-commits.md
docs/verification/2026-11-25-workflow-round2-browser.txt
docs/交接/2026-11-25-Codex交接.md
package.json
test/suites.cjs
```

没有暂存或提交用户提供的复核原件、data、output、tmp、批准口令或业务成果文件。所有提交仅在本地main；本轮未推送GitHub。
