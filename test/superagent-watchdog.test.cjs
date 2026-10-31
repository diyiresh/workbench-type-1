"use strict";
const assert = require("node:assert/strict");
const watchdog = require("../lib/superagent-watchdog");
const intake = require("../lib/superagent-intake");

const now = Date.parse("2026-11-01T00:00:00.000Z");

function baseStore() {
  const store = {
    departmentRuns: [{ id: "run-1", goal: "t", automationPaused: false, controlGeneration: 0, items: [] }],
    executionAttempts: [],
    codexJobs: [],
    externalJobs: [],
    chatJobs: [],
  };
  intake.ensureSuperagent(store);
  store.superagent.watchdog.noProgressMs = 60_000;
  store.superagent.watchdog.maxFailuresPerStep = 3;
  return store;
}

// Lease expired → notify + suggestedPause
{
  const store = baseStore();
  store.executionAttempts.push({
    id: "ea-lease",
    runId: "run-1",
    stepId: "executor",
    purpose: "stage",
    agentId: "cursor",
    state: "running",
    createdAt: "2026-10-31T23:00:00.000Z",
    leaseExpiresAt: "2026-10-31T23:50:00.000Z",
    events: [{ state: "running", at: "2026-10-31T23:00:00.000Z" }],
  });
  const result = watchdog.scan(store, { now });
  assert.equal(result.verdictCount, 1);
  assert.equal(result.verdicts[0].reason, "lease_expired");
  assert.equal(result.verdicts[0].action, "notify");
  assert.equal(result.verdicts[0].suggestedPause, true);
}

// No progress → notify
{
  const store = baseStore();
  store.executionAttempts.push({
    id: "ea-stall",
    runId: "run-1",
    stepId: "executor",
    purpose: "stage",
    agentId: "cursor",
    state: "claimed",
    createdAt: "2026-10-31T23:00:00.000Z",
    leaseExpiresAt: "2026-11-01T01:00:00.000Z",
    claimedAt: "2026-10-31T23:00:00.000Z",
    events: [{ state: "claimed", at: "2026-10-31T23:00:00.000Z" }],
  });
  const result = watchdog.scan(store, { now });
  assert.equal(result.verdicts[0].reason, "no_progress");
}

// Excessive retries → pause suggestion
{
  const store = baseStore();
  for (let i = 0; i < 3; i++) {
    store.executionAttempts.push({
      id: "ea-fail-" + i,
      runId: "run-1",
      stepId: "executor",
      purpose: "stage",
      agentId: "cursor",
      state: "failed",
      createdAt: "2026-10-31T22:00:00.000Z",
    });
  }
  store.executionAttempts.push({
    id: "ea-active",
    runId: "run-1",
    stepId: "executor",
    purpose: "stage",
    agentId: "cursor",
    state: "waiting",
    createdAt: "2026-10-31T23:58:00.000Z",
    leaseExpiresAt: "2026-11-01T01:00:00.000Z",
    events: [{ state: "waiting", at: "2026-10-31T23:58:00.000Z" }],
  });
  const result = watchdog.scan(store, { now });
  const pause = result.verdicts.find((v) => v.reason === "excessive_retries");
  assert.ok(pause);
  assert.equal(pause.action, "pause");
  assert.equal(pause.suggestedPause, true);

  assert.throws(() => watchdog.applySafePauses(store, result, { confirmed: false }), /confirmation_required/);
  const applied = watchdog.applySafePauses(store, result, { confirmed: true });
  assert.deepEqual(applied.pausedRunIds, ["run-1"]);
  assert.equal(store.departmentRuns[0].automationPaused, true);
}

// Healthy active attempt → no verdict
{
  const store = baseStore();
  store.executionAttempts.push({
    id: "ea-ok",
    runId: "run-1",
    stepId: "executor",
    purpose: "stage",
    agentId: "cursor",
    state: "running",
    createdAt: "2026-10-31T23:59:30.000Z",
    leaseExpiresAt: "2026-11-01T01:00:00.000Z",
    events: [{ state: "running", at: "2026-10-31T23:59:30.000Z" }],
  });
  const result = watchdog.scan(store, { now });
  assert.equal(result.verdictCount, 0);
}

console.log("Superagent watchdog: lease expiry, no-progress, excessive retries, safe pause confirmation passed.");
