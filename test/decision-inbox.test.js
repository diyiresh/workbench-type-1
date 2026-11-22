"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "bench-decisions-"));
process.env.BENCH_DATA_DIR = root;
const { buildDefaultStore } = require("../lib/default-store");
const { ensureV2 } = require("../lib/migrate");
const { createDepartmentRun } = require("../lib/department");
const gov = require("../lib/execution-governance");
const { decisions, timeline } = require("../lib/activity");

const store = ensureV2(buildDefaultStore());
const writing = createDepartmentRun(store, { goal: "Writing fixture" });
const failing = createDepartmentRun(store, { goal: "Delivery fixture" });
const archived = createDepartmentRun(store, { goal: "Archived fixture" });
const budget = createDepartmentRun(store, { goal: "Budget fixture" });
store.departmentRuns = [writing, failing, archived, budget];
archived.archived = true;

const executor = writing.items.find((i) => i.role === "executor");
const director = writing.items.find((i) => i.role === "director");
Object.assign(director, { status: "done", startedAt: "2026-11-20T01:00:00.000Z", completedAt: "2026-11-20T01:30:00.000Z" });
Object.assign(executor, { status: "doing", preparationReady: true, startedAt: "2026-11-20T02:00:00.000Z" });
writing.preparationFlow = { status: "awaiting_confirmation", completedAt: "2026-11-20T03:00:00.000Z" };
writing.discussion.push({ id: "dd-r", role: "reviewer", agentId: "cursor", text: "退回返工：缺少来源", createdAt: "2026-11-20T02:30:00.000Z" });
failing.delivery = { state: "failed", error: "docx conversion failed", artifactIds: [], generatedAt: "2026-11-20T04:00:00.000Z" };

const attempt = (over) => ({ id: "ea-" + Math.random().toString(16).slice(2), purpose: "stage", transport: "manual-member", createdAt: "2026-11-20T02:05:00.000Z", events: [], ...over });
store.executionAttempts = [
  attempt({ runId: writing.id, stepId: executor.id, agentId: executor.ownerAgentId, state: "held", completedAt: "2026-11-20T02:40:00.000Z",
    events: [{ state: "waiting", at: "2026-11-20T02:05:00.000Z", source: "workbench" }, { state: "claimed", at: "2026-11-20T02:06:00.000Z", source: "member" }, { state: "held", at: "2026-11-20T02:40:00.000Z", source: "workbench" }] }),
  attempt({ runId: failing.id, stepId: failing.items[0].id, agentId: "codex", state: "uncertain" }),
  attempt({ runId: archived.id, stepId: archived.items[0].id, agentId: "codex", state: "uncertain" }),
];
const budgetDirector = budget.items[0];
const inputHash = gov.input(store, budget, budgetDirector.id, "stage", null);
for (let i = 0; i < 3; i++) store.executionAttempts.push(attempt({ runId: budget.id, stepId: budgetDirector.id, agentId: budgetDirector.ownerAgentId, state: "failed", inputHash }));
store.tasks = [
  { id: "t-review", title: "Needs verification", status: "review", updatedAt: "2026-11-19T00:00:00.000Z" },
  { id: "t-blocked", title: "Blocked task", status: "blocked", nextAction: "wait for data" },
  { id: "t-archived", title: "Archived review", status: "review", archived: true },
  { id: "t-doing", title: "Doing", status: "doing" },
];
store.agendaReportJobs = [{ id: "rj-1", status: "returned", title: "十一月月报" }, { id: "rj-2", status: "returned", title: "已保存" }];
store.reports = [{ id: "rp", sourceJobId: "rj-2" }];
store.chatJobs = [
  { id: "chat-1", runId: writing.id, agentId: "cursor", status: "failed", error: "timeout", messageId: "m1" },
  { id: "chat-2", runId: writing.id, agentId: "cursor", status: "failed", messageId: "m2" },
  { id: "chat-3", runId: writing.id, agentId: "cursor", status: "done", retryOf: "chat-2", messageId: "m2" },
];

const list = decisions(store);
const kinds = list.map((d) => d.kind);
for (const kind of ["start_writing", "held_result", "delivery_failed", "reconcile", "budget_exhausted", "task_review", "task_blocked", "report_ready", "chat_failed"]) assert.ok(kinds.includes(kind), "missing " + kind + " in " + kinds);
assert.ok(!list.some((d) => d.runId === archived.id), "archived projects are left out");
assert.ok(!list.some((d) => d.title === "Archived review" || d.title === "已保存" || d.id === "chat:chat-2"), "archived, saved and already-retried items are left out");
assert.strictEqual(list.find((d) => d.kind === "start_writing").severity, "high", "writing approval is ready once the preparation review completes");
assert.deepStrictEqual([...new Set(list.map((d) => d.severity))], ["high", "normal", "low"], "sorted by severity");
assert.ok(list.every((d) => d.href && d.id && d.title), "every entry links to where it is decided");
assert.strictEqual(list.filter((d) => d.kind === "budget_exhausted").length, 1);

const feed = timeline(store, writing.id);
const order = feed.entries.map((e) => e.kind);
assert.deepStrictEqual(feed.entries.map((e) => e.at), [...feed.entries.map((e) => e.at)].sort(), "chronological");
for (const kind of ["goal", "stage_started", "stage_done", "attempt_claimed", "attempt_held", "review_reject"]) assert.ok(order.includes(kind), "timeline missing " + kind);
assert.ok(order.indexOf("attempt_claimed") < order.indexOf("review_reject") && order.indexOf("review_reject") < order.indexOf("attempt_held"));
assert.throws(() => timeline(store, "dr-none"), /department_run_not_found/);

fs.writeFileSync(path.join(root, "store.json"), JSON.stringify(store));
const { createServer } = require("../server");
const server = createServer().listen(0, "127.0.0.1", async () => {
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fetch(base + "/api/health");
    await fetch(base + "/api/state");
    const before = fs.readFileSync(path.join(root, "store.json"), "utf8");
    const api = await (await fetch(base + "/api/decisions")).json();
    assert.ok(api.decisions.some((d) => d.kind === "start_writing" && d.runId === writing.id));
    const feedApi = await (await fetch(base + `/api/departments/runs/${writing.id}/timeline`)).json();
    assert.ok(feedApi.entries.length >= 6);
    assert.strictEqual((await fetch(base + "/api/departments/runs/dr-none/timeline")).status, 404);
    assert.strictEqual(fs.readFileSync(path.join(root, "store.json"), "utf8"), before, "decision inbox and timeline never write the ledger");
    console.log("Decision inbox: reconcile, held results, Start Writing, retry budgets, failed deliveries, chat failures, task reviews/blocks and report drafts, archived exclusion and severity order; activity timeline order and read-only API passed.");
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally { server.close(); }
});
