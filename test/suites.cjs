"use strict";

// Test suites run by scripts/run-tests.cjs. Every file uses an isolated BENCH_DATA_DIR.
// Not listed on purpose: *-live.cjs and wecom-trigger-probe (real services), and
// chat-bubbles / chat-input / department-scroll (read the running workbench at 127.0.0.1:3780).
const unit = [
  "deepseek-provider.test.cjs", "providers.test.cjs", "duty-coordinator.test.cjs",
  "growth.test.cjs", "growth-api.test.cjs", "desktop-bridge-prompt.test.js", "workflow-recovery.test.cjs", "workbuddy-submit.test.js", "recovery-api.test.cjs", "recovery-runtime.test.cjs", "runtime-exit-evidence.test.cjs",
  "superagent-review-regressions.test.cjs", "superagent-intake.test.cjs", "superagent-watchdog.test.cjs", "superagent-async.test.cjs",
  "execution-governance.test.cjs", "execution-api.test.cjs", "skill-studio.test.cjs", "disk-skills.test.cjs",
  "project-chat.test.js", "cursor-long-prompt.test.js", "cursor-role-handoff.test.cjs", "preparation-flow.test.js", "theme-contrast.test.js",
  "agenda-utils.test.js", "agenda-notes.test.js", "agenda-note-cleanup.test.js", "migration.test.js", "reminders.test.js",
  "local-opener.test.js", "review-note-filenames.test.cjs", "review-note-members.test.cjs", "monthly-thought-report.test.cjs",
  "saved-review-report.test.cjs", "agenda-report-jobs.test.cjs", "agenda-report-export.test.cjs", "agenda-report-writing.test.js",
  "llm-options.test.js", "agenda-material-action.test.js", "life-learning.test.js", "brief-hub.test.js", "brief-favorites.test.js",
  "dropbox-brief.test.js", "model-status.test.js", "start-script.test.js", "delivery.test.js", "department.test.js",
  "v2-department-collab.test.js", "collaboration.test.js", "agent-dispatch.test.js", "desktop-bridge.test.js",
  "external-runtime.test.js", "workspace.test.js", "codex.test.js", "codex-vault-failure.test.js", "vault.test.js",
  "network.test.js", "archive.test.js", "archive-api.test.js", "navigation-extensions.test.cjs", "v3-bold-workspace.test.js",
  "external-tools.test.js", "security-guards.test.js", "router.test.js", "ledger-store.test.js", "paper-library.test.cjs",
  "decision-inbox.test.js", "mcp-server.test.js",
];

const ui = [
  "providers-ui.browser.cjs",
  "briefing-close.browser.cjs", "growth.browser.cjs", "recovery-controls.browser.cjs",
  "workbench-v010.browser.cjs", "chat-timeline.browser.cjs", "delivery.browser.cjs", "report-draft-visibility.browser.cjs",
  "saved-review-report.browser.cjs", "agenda-report-members.browser.cjs", "agenda-report-export.browser.cjs",
  "agenda-filter.browser.cjs", "agenda-work-scope.browser.cjs", "agenda-reschedule.browser.cjs", "brief-filters.browser.cjs", "review-note-members.browser.cjs",
  "agenda-review-draft.browser.cjs", "agenda-notes.browser.cjs", "overview-filter.browser.cjs", "navigation-centers.browser.cjs",
  "skill-studio.browser.cjs", "disk-skills.browser.cjs", "execution.browser.cjs", "compact-layout.browser.cjs",
  "sidebar-resize.browser.cjs", "v3-bold-workspace.browser.cjs", "external-tools.browser.cjs", "v8-studio.browser.cjs",
  "v8-agenda-controls.browser.cjs", "paper-library.browser.cjs", "desktop-companion.test.cjs",
];

const agents = ["desktop-worker.test.mjs", "workbuddy-queue.test.js", "automatic-department.test.js"];
const skills = ["skill-studio.test.cjs", "disk-skills.test.cjs", "skill-studio.browser.cjs", "disk-skills.browser.cjs"];
const papers = ["paper-library.test.cjs", "paper-library.browser.cjs"];

module.exports = { unit, ui, agents, skills, papers };
