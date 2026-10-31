"use strict";

const { id } = require("./default-store");
const { inactive } = require("./archive");
const gov = require("./execution-governance");
const { ensureSuperagent } = require("./superagent-intake");
const {
  normalizeAsyncRun,
  channelReplyHint,
  nowIso,
} = require("./superagent-model");

const DEFAULT_LEASE_MS = 15 * 60 * 1000;

function listAsyncRuns(store, { status = null } = {}) {
  const sa = ensureSuperagent(store);
  let runs = sa.asyncRuns.map((r) => normalizeAsyncRun(r));
  if (status) runs = runs.filter((r) => r.status === status);
  return runs;
}

function getAsyncRun(store, asyncId) {
  const sa = ensureSuperagent(store);
  const found = sa.asyncRuns.find((r) => r.id === asyncId);
  if (!found) throw new Error("async_run_missing");
  return normalizeAsyncRun(found);
}

function findRaw(store, asyncId) {
  const sa = ensureSuperagent(store);
  const found = sa.asyncRuns.find((r) => r.id === asyncId);
  if (!found) throw new Error("async_run_missing");
  return found;
}

/**
 * Start (or resume idempotent) an async run that does not block chat.
 * Optionally attaches an existing executionAttempt; does not invent a second stage claim.
 */
function startAsync(store, body = {}) {
  const sa = ensureSuperagent(store);
  const idempotencyKey = body.idempotencyKey ? String(body.idempotencyKey) : null;
  if (idempotencyKey) {
    const existing = sa.asyncRuns.find((r) => r.idempotencyKey === idempotencyKey);
    if (existing) {
      return { run: normalizeAsyncRun(existing), duplicate: true, replyHint: channelReplyHint(sa.channels, existing.channel) };
    }
  }

  const runId = body.runId || body.threadId || null;
  if (runId) {
    const dept = (store.departmentRuns || []).find((r) => r.id === runId);
    if (!dept) throw new Error("project_missing");
    if (inactive(dept) || dept.archived) throw new Error("project_paused_or_archived");
    // Chat-like async work may continue while automationPaused; long stage work should not.
    if (dept.automationPaused && body.requireAutomation !== false && body.purpose !== "chat") {
      // Allow start for discussion-like async (default), but surface paused flag.
    }
  }

  let attemptId = body.attemptId ? String(body.attemptId) : null;
  if (attemptId) {
    const attempt = gov.get(store, attemptId);
    if (runId && attempt.runId !== runId) throw gov.error("result_identity_mismatch");
    if (body.agentId && attempt.agentId !== body.agentId) throw gov.error("result_identity_mismatch");
    // Cooperative visibility: do not force starting() here; caller/adapters own invocation.
  }

  const leaseMs = Number(body.timeoutMs) || DEFAULT_LEASE_MS;
  const raw = {
    id: id("sar"),
    runId,
    agentId: body.agentId || null,
    attemptId,
    status: "running",
    stopRequested: false,
    goal: body.goal || body.text || "",
    channel: body.channel || "im",
    idempotencyKey,
    leaseExpiresAt: new Date(Date.now() + leaseMs).toISOString(),
    createdAt: nowIso(),
    updatedAt: nowIso(),
    stoppedAt: null,
    meta: {
      purpose: body.purpose || "async",
      automationPaused: !!(runId && (store.departmentRuns || []).find((r) => r.id === runId)?.automationPaused),
      ...(body.meta && typeof body.meta === "object" ? body.meta : {}),
    },
  };

  const run = normalizeAsyncRun(raw);
  sa.asyncRuns.unshift(run);
  return {
    run,
    duplicate: false,
    replyHint: channelReplyHint(sa.channels, run.channel),
  };
}

/**
 * Cooperative stop: marks async run stopped and, if linked attempt is ACTIVE, fails it with cooperative_stop.
 */
function stopAsync(store, asyncId, { reason = "cooperative_stop", confirmed = true } = {}) {
  if (confirmed !== true) throw new Error("confirmation_required");
  const sa = ensureSuperagent(store);
  const raw = findRaw(store, asyncId);
  if (["stopped", "cancelled", "done", "failed"].includes(raw.status)) {
    return { run: normalizeAsyncRun(raw), duplicate: true };
  }

  raw.stopRequested = true;
  raw.status = "stopping";
  raw.updatedAt = nowIso();

  if (raw.attemptId) {
    try {
      const attempt = gov.get(store, raw.attemptId);
      if (gov.ACTIVE.has(attempt.state)) {
        const err = gov.error("cooperative_stop", reason);
        // Prefer clean failed when no process evidence; otherwise governance may mark uncertain.
        gov.failed(store, attempt, err);
      }
    } catch (err) {
      raw.meta = { ...(raw.meta || {}), stopAttemptError: String(err.message || err).slice(0, 200) };
    }
  }

  raw.status = "stopped";
  raw.stoppedAt = nowIso();
  raw.updatedAt = raw.stoppedAt;
  return { run: normalizeAsyncRun(raw), duplicate: false };
}

function heartbeatAsync(store, asyncId, { extendMs = DEFAULT_LEASE_MS } = {}) {
  const raw = findRaw(store, asyncId);
  if (raw.stopRequested || raw.status === "stopping") {
    return { run: normalizeAsyncRun(raw), stopRequested: true };
  }
  if (raw.status !== "running") throw new Error("async_run_not_running");
  raw.leaseExpiresAt = new Date(Date.now() + (Number(extendMs) || DEFAULT_LEASE_MS)).toISOString();
  raw.updatedAt = nowIso();
  return { run: normalizeAsyncRun(raw), stopRequested: false };
}

function completeAsync(store, asyncId, { status = "done", output = null } = {}) {
  const raw = findRaw(store, asyncId);
  if (["stopped", "done", "failed"].includes(raw.status)) {
    return { run: normalizeAsyncRun(raw), duplicate: true };
  }
  raw.status = status === "failed" ? "failed" : "done";
  raw.stopRequested = false;
  raw.updatedAt = nowIso();
  raw.stoppedAt = raw.updatedAt;
  if (output != null) raw.meta = { ...(raw.meta || {}), output: String(output).slice(0, 4000) };
  return { run: normalizeAsyncRun(raw), duplicate: false };
}

module.exports = {
  listAsyncRuns,
  getAsyncRun,
  startAsync,
  stopAsync,
  heartbeatAsync,
  completeAsync,
  DEFAULT_LEASE_MS,
};