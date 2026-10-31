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
  const linkedAttempt = body.attemptId ? gov.get(store, String(body.attemptId)) : null;
  const runId = body.runId || body.threadId || linkedAttempt?.runId || null;
  const agentId = body.agentId || linkedAttempt?.agentId || null;
  if (linkedAttempt && (runId !== linkedAttempt.runId || agentId !== linkedAttempt.agentId)) throw gov.error('result_identity_mismatch');
  const identity = { runId, agentId, attemptId:linkedAttempt?.id || null, goal:String(body.goal || body.text || ''), channel:body.channel || 'im', purpose:body.purpose || 'async' };
  const idempotencyKey = body.idempotencyKey ? String(body.idempotencyKey) : null;
  if (idempotencyKey) {
    const existing = sa.asyncRuns.find((r) => r.idempotencyKey === idempotencyKey);
    if (existing) {
      const previous = {runId:existing.runId || null,agentId:existing.agentId || null,attemptId:existing.attemptId || null,goal:existing.goal || '',channel:existing.channel || 'im',purpose:existing.meta?.purpose || 'async'};
      if (gov.hash(previous) !== gov.hash(identity)) throw gov.error('idempotency_conflict');
      return { run: normalizeAsyncRun(existing), duplicate: true, replyHint: channelReplyHint(sa.channels, existing.channel) };
    }
  }

  if (runId) {
    const dept = (store.departmentRuns || []).find((r) => r.id === runId);
    if (!dept) throw new Error("project_missing");
    if (inactive(dept) || dept.archived) throw new Error("project_paused_or_archived");
    // This registers tracking only. It neither invokes a worker nor resumes automation.
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
    agentId,
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
      ...(body.meta && typeof body.meta === "object" ? body.meta : {}),
      purpose: body.purpose || "async",
      automationPaused: !!(runId && (store.departmentRuns || []).find((r) => r.id === runId)?.automationPaused),
      trackingOnly: true,
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
 * A stop request is not proof of execution termination. Keep ownership until governed reconciliation/result.
 */
function stopAsync(store, asyncId, { reason = "cooperative_stop", confirmed = true } = {}) {
  if (confirmed !== true) throw new Error("confirmation_required");
  const sa = ensureSuperagent(store);
  const raw = findRaw(store, asyncId);
  const attempt = raw.attemptId ? gov.get(store, raw.attemptId) : null;
  const active = attempt && gov.ACTIVE.has(attempt.state);
  if (["stopped", "cancelled", "done", "failed"].includes(raw.status) && !active) {
    return { run: normalizeAsyncRun(raw), duplicate: true };
  }

  if (active && raw.stopRequested && raw.status === 'stopping') return {run:normalizeAsyncRun(raw),duplicate:true};
  raw.stopRequested = true;
  raw.status = "stopping";
  raw.updatedAt = nowIso();

  if (active) {
    attempt.state = 'uncertain';
    attempt.blockerCode = 'cooperative_stop_requested';
    attempt.error = String(reason).slice(0,600);
    (attempt.events ||= []).push({state:'uncertain',at:nowIso(),source:'superagent-stop-request'});
    raw.stoppedAt = null;
    return {run:normalizeAsyncRun(raw),duplicate:false};
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
  if (raw.stopRequested && raw.attemptId) {
    if (gov.ACTIVE.has(gov.get(store,raw.attemptId).state)) throw new Error('async_stop_unconfirmed');
    return stopAsync(store,asyncId,{confirmed:true});
  }
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
