"use strict";
const assert = require("node:assert/strict");
const asyncApi = require("../lib/superagent-async");
const intake = require("../lib/superagent-intake");
const watchdog = require("../lib/superagent-watchdog");
const gov = require("../lib/execution-governance");

const store = {
  departmentRuns: [{ id: "run-1", goal: "async", automationPaused: false, controlGeneration: 0, archiveGeneration: 0, items: [{ id: "executor", role: "executor", ownerAgentId: "cursor", status: "queued" }] }],
  agents: [{ id: "cursor", status: "ready" }],
  executionAttempts: [],
  projectMessages: [],
  inbox: [],
  chatJobs: [],
  codexJobs: [],
  externalJobs: [],
};
intake.ensureSuperagent(store);

const started = asyncApi.startAsync(store, {
  runId: "run-1",
  agentId: "cursor",
  goal: "长任务调研",
  channel: "im",
  idempotencyKey: "k-1",
  timeoutMs: 60_000,
});
assert.equal(started.duplicate, false);
assert.equal(started.run.status, "running");
assert.equal(started.replyHint.channel, "im");
assert.ok(started.replyHint.maxWords);

const again = asyncApi.startAsync(store, {
  runId: "run-1",
  agentId: "cursor",
  goal: "长任务调研",
  idempotencyKey: "k-1",
});
assert.equal(again.duplicate, true);
assert.equal(again.run.id, started.run.id);

const beat = asyncApi.heartbeatAsync(store, started.run.id, { extendMs: 120_000 });
assert.equal(beat.stopRequested, false);

// Link a real attempt and cooperative-stop it through async stop
const attempt = gov.reserve(store, {
  runId: "run-1",
  stepId: "executor",
  agentId: "cursor",
  jobId: "job-async-1",
  transport: "manual-member",
  timeoutMs: 60_000,
});
gov.claim(store, attempt, { claimKey: "ck-1", workerId: "cursor" });
const linked = asyncApi.startAsync(store, {
  runId: "run-1",
  agentId: "cursor",
  attemptId: attempt.id,
  goal: "绑定 attempt 的异步",
  idempotencyKey: "k-2",
});
const stopped = asyncApi.stopAsync(store, linked.run.id, { confirmed: true, reason: "user_cancel" });
assert.equal(stopped.run.status, "stopped");
assert.equal(stopped.run.stopRequested, true);
assert.ok(["failed", "uncertain"].includes(attempt.state));
assert.equal(attempt.blockerCode, "cooperative_stop");

assert.throws(() => asyncApi.stopAsync(store, started.run.id, { confirmed: false }), /confirmation_required/);
const stopMain = asyncApi.stopAsync(store, started.run.id, { confirmed: true });
assert.equal(stopMain.run.status, "stopped");

// Watchdog sees async lease expiry
const stale = asyncApi.startAsync(store, {
  runId: "run-1",
  agentId: "cursor",
  goal: "过期",
  idempotencyKey: "k-3",
  timeoutMs: 1,
});
store.superagent.asyncRuns.find((r) => r.id === stale.run.id).leaseExpiresAt = new Date(Date.now() - 1000).toISOString();
const scanned = watchdog.scan(store, { now: Date.now() });
assert.ok(scanned.verdicts.some((v) => v.reason === "async_lease_expired" && v.attemptId === stale.run.id));

console.log("Superagent async Phase2: start idempotent, heartbeat, cooperative stop+governance, watchdog async lease passed.");