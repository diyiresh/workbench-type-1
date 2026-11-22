"use strict";

// Read-only views over the ledger: the decision inbox (everything waiting on the chairman)
// and a per-project activity timeline. Neither changes stages, starts members or approves anything.
const { inactive } = require("./archive");
const { refreshCircuitBreakers } = require("./department");

const ROLE = { director: "主管", executor: "执行", reviewer: "复核", secretary: "整合" };
const runHref = (run) => "#projects/run:" + encodeURIComponent(run.id);
const latest = (...values) => values.filter(Boolean).sort().pop() || "";

function decisions(store) {
  const out = [];
  const runs = (store.departmentRuns || []).filter((run) => !inactive(run));
  const runOf = (id) => runs.find((run) => run.id === id);
  const push = (entry) => out.push({ severity: "normal", ...entry });

  for (const a of store.executionAttempts || []) {
    const run = runOf(a.runId);
    if (!run) continue;
    if (a.state === "uncertain") push({ id: "reconcile:" + a.id, kind: "reconcile", severity: "high", runId: run.id, title: run.title, detail: `${a.agentId} 的执行结果待核对：先确认旧会话已停止，再决定是否重试`, href: runHref(run), at: latest(a.completedAt, a.createdAt) });
    if (a.state === "held") push({ id: "held:" + a.id, kind: "held_result", runId: run.id, title: run.title, detail: `${a.agentId} 的迟到成果已保留，未推进阶段`, href: runHref(run), at: latest(a.completedAt, a.createdAt) });
  }

  for (const run of runs) {
    const items = run.items || [];
    const executor = items.find((item) => item.role === "executor");
    if (executor?.preparationReady && run.requiresWritingApproval !== false && !run.writingApproved) {
      const ready = run.preparationFlow?.status === "awaiting_confirmation";
      push({ id: "writing:" + run.id, kind: "start_writing", severity: ready ? "high" : "normal", runId: run.id, title: run.title, detail: ready ? "准备材料复核与建议已完成，等待你在项目中确认 Start Writing" : "准备材料已提交，复核与建议完成后再确认 Start Writing", href: runHref(run), at: latest(run.preparationFlow?.completedAt, executor.completedAt, run.updatedAt) });
    }
    refreshCircuitBreakers(store, run);
    for (const item of items) {
      if (item.circuitBreaker?.exhausted && item.status !== "done") push({ id: "budget:" + run.id + ":" + item.id, kind: "budget_exhausted", severity: "high", runId: run.id, title: run.title, detail: `${ROLE[item.role] || item.role}阶段：${item.circuitBreaker.reason}；需更换输入或调整分工`, href: runHref(run), at: run.updatedAt || "" });
    }
    if (["failed", "invalidated"].includes(run.delivery?.state)) push({ id: "delivery:" + run.id, kind: "delivery_failed", severity: "high", runId: run.id, title: run.title, detail: run.delivery.state === "failed" ? `成果文件生成或复核失败：${run.delivery.error || "可在项目中重试"}` : "成果文件已改动或缺失，核验失效", href: runHref(run), at: latest(run.delivery.generatedAt, run.updatedAt) });
    const reviewer = items.find((item) => item.role === "reviewer");
    if (reviewer && reviewer.status === "queued" && !run.externalAutomation && !run.automationPaused) push({ id: "review:" + run.id, kind: "review_waiting", runId: run.id, title: run.title, detail: `复核阶段已解锁，等待 ${reviewer.ownerAgentId} 领取或由你启动`, href: runHref(run), at: latest(reviewer.updatedAt, run.updatedAt) });
    if (run.automationPaused) push({ id: "paused:" + run.id, kind: "automation_paused", severity: "low", runId: run.id, title: run.title, detail: "自动接力已暂停，恢复前不会领取新阶段", href: runHref(run), at: run.updatedAt || "" });
  }

  for (const job of store.chatJobs || []) {
    const run = runOf(job.runId);
    if (!run || job.status !== "failed" || inactive(job)) continue;
    const retried = (store.chatJobs || []).some((next) => next.retryOf === job.id);
    if (!retried) push({ id: "chat:" + job.id, kind: "chat_failed", severity: "low", runId: run.id, title: run.title, detail: `${job.agentId} 的群聊回复失败：${job.error || "可单独重试"}`, href: runHref(run), at: latest(job.completedAt, job.createdAt) });
  }

  for (const task of store.tasks || []) {
    if (inactive(task) || !["review", "blocked"].includes(task.status)) continue;
    const blocked = task.status === "blocked";
    push({ id: "task:" + task.id, kind: blocked ? "task_blocked" : "task_review", runId: null, title: task.title || task.id, detail: `${blocked ? "任务受阻" : "待核验"} · ${task.nextAction || ""}`.replace(/ · $/, ""), href: "#home/decisions", at: task.updatedAt || "" });
  }

  const saved = new Set((store.reports || []).map((r) => r.sourceJobId).filter(Boolean));
  for (const job of store.agendaReportJobs || []) {
    if (inactive(job) || !["returned", "held"].includes(job.status) || saved.has(job.id)) continue;
    push({ id: "report:" + job.id, kind: "report_ready", severity: "low", runId: null, title: job.title || "行程月报", detail: job.status === "held" ? "迟到的报告草稿已保留，需你决定是否采用" : "报告草稿已返回，预览确认后才保存", href: "#agenda/all", at: latest(job.completedAt, job.createdAt) });
  }

  const rank = { high: 0, normal: 1, low: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity] || String(b.at).localeCompare(String(a.at)));
}

function timeline(store, runId) {
  const run = (store.departmentRuns || []).find((r) => r.id === runId);
  if (!run) { const error = new Error("department_run_not_found"); error.status = 404; throw error; }
  const rows = [];
  const add = (at, agentId, kind, text, ref) => { if (at) rows.push({ at, agentId: agentId || "", kind, text, ref: ref || null }); };
  const label = (item) => (item ? ROLE[item.role] || item.role : "");
  const itemOf = (id) => (run.items || []).find((item) => item.id === id);

  add(run.createdAt, "chairman", "goal", "提交目标");
  for (const item of run.items || []) {
    add(item.startedAt, item.ownerAgentId, "stage_started", `${label(item)}阶段开始`, item.id);
    add(item.completedAt, item.ownerAgentId, "stage_done", `${label(item)}阶段完成`, item.id);
  }
  for (const a of (store.executionAttempts || []).filter((x) => x.runId === run.id)) {
    const step = label(itemOf(a.stepId)) || a.purpose;
    for (const e of a.events || []) add(e.at, a.agentId, "attempt_" + e.state, `${step} · ${e.state}`, a.id);
  }
  for (const entry of run.discussion || []) {
    if (entry.role === "reviewer") add(entry.createdAt, entry.agentId, String(entry.text || "").startsWith("复核通过") ? "review_pass" : "review_reject", String(entry.text || "").slice(0, 160), entry.id);
  }
  const d = run.delivery;
  if (d) {
    add(d.configuredAt, "chairman", "delivery_configured", `交付要求：${d.contract?.mode || d.state}`);
    add(d.generatedAt, "workbench", "delivery_generated", `成果文件已生成 · v${d.version || 1}`);
    if (d.review) add(d.review.reviewedAt, d.review.reviewerAgentId, d.review.verdict === "pass" ? "delivery_pass" : "delivery_reject", "文件复核" + (d.review.verdict === "pass" ? "通过" : "退回"));
  }
  for (const h of run.handoffs || []) add(h.sealedAt, h.sealedBy, "handoff", "主管交接：" + String(h.summary || "").slice(0, 120), h.id);
  return { runId: run.id, title: run.title, entries: rows.sort((a, b) => String(a.at).localeCompare(String(b.at))) };
}

module.exports = { decisions, timeline };
