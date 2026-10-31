"use strict";

const { makeWatchdogVerdict } = require("./superagent-model");
const { ensureSuperagent } = require("./superagent-intake");

const ACTIVE = new Set(["waiting", "claimed", "running", "uncertain"]);

function parseTime(value) {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function progressAt(attempt) {
  const events = Array.isArray(attempt.events) ? attempt.events : [];
  let latest = parseTime(attempt.updatedAt) || parseTime(attempt.claimedAt) || parseTime(attempt.startedAt) || parseTime(attempt.createdAt) || 0;
  for (const ev of events) {
    const at = parseTime(ev.at || ev.createdAt);
    if (at != null && at > latest) latest = at;
  }
  if (attempt.invokedAt) {
    const at = parseTime(attempt.invokedAt);
    if (at != null && at > latest) latest = at;
  }
  return latest;
}

function failureCount(store, attempt) {
  const attempts = store.executionAttempts || [];
  return attempts.filter(
    (a) =>
      a.runId === attempt.runId &&
      a.stepId === attempt.stepId &&
      a.purpose === attempt.purpose &&
      a.agentId === attempt.agentId &&
      ["failed", "interrupted", "cancelled", "uncertain"].includes(a.state)
  ).length;
}

function rank(action) {
  if (action === "pause") return 3;
  if (action === "notify") return 2;
  return 1;
}

/**
 * Read-only scan of open attempts/jobs for stuck signals.
 * Never mutates store. One strongest verdict per attempt.
 */
function scan(store, { now = Date.now() } = {}) {
  const sa = ensureSuperagent(store);
  const noProgressMs = Number(sa.watchdog.noProgressMs) || 15 * 60 * 1000;
  const maxFailures = Number(sa.watchdog.maxFailuresPerStep) || 3;
  const verdicts = [];

  for (const attempt of store.executionAttempts || []) {
    if (!ACTIVE.has(attempt.state)) continue;
    let best = null;

    const leaseMs = parseTime(attempt.leaseExpiresAt);
    if (leaseMs != null && leaseMs < now) {
      best = makeWatchdogVerdict({
        attemptId: attempt.id,
        runId: attempt.runId,
        action: "notify",
        reason: "lease_expired",
        severity: "warning",
        suggestedPause: true,
        details: { leaseExpiresAt: attempt.leaseExpiresAt, state: attempt.state },
      });
    }

    const last = progressAt(attempt);
    if (last && now - last > noProgressMs) {
      const candidate = makeWatchdogVerdict({
        attemptId: attempt.id,
        runId: attempt.runId,
        action: "notify",
        reason: "no_progress",
        severity: "warning",
        suggestedPause: true,
        details: { lastProgressAt: new Date(last).toISOString(), noProgressMs, state: attempt.state },
      });
      if (!best || rank(candidate.action) > rank(best.action)) best = candidate;
      else if (best && best.reason === "lease_expired") {
        // keep lease_expired as primary; still fine
      } else if (!best) best = candidate;
    }

    const fails = failureCount(store, attempt);
    if (fails >= maxFailures) {
      const candidate = makeWatchdogVerdict({
        attemptId: attempt.id,
        runId: attempt.runId,
        action: "pause",
        reason: "excessive_retries",
        severity: "error",
        suggestedPause: true,
        details: { failures: fails, maxFailures, stepId: attempt.stepId },
      });
      if (!best || rank(candidate.action) >= rank(best.action)) best = candidate;
    }

    if (best) verdicts.push(best);
  }

  for (const job of [...(store.codexJobs || []), ...(store.externalJobs || []), ...(store.chatJobs || [])]) {
    if (!["doing", "waiting"].includes(job.status)) continue;
    if (job.attemptId) continue;
    const started = parseTime(job.startedAt || job.createdAt);
    if (started != null && now - started > noProgressMs) {
      verdicts.push(
        makeWatchdogVerdict({
          attemptId: job.id,
          runId: job.runId || null,
          action: "notify",
          reason: "job_no_progress",
          severity: "info",
          suggestedPause: false,
          details: { status: job.status, agentId: job.agentId || null },
        })
      );
    }
  }

  return {
    scannedAt: new Date(now).toISOString(),
    openAttempts: (store.executionAttempts || []).filter((a) => ACTIVE.has(a.state)).length,
    verdictCount: verdicts.length,
    verdicts,
  };
}

/**
 * Apply safe pause suggestions using existing automationPaused flag.
 * Only pauses when confirmed===true and verdict.suggestedPause.
 * Does not reconcile or cancel attempts.
 */
function applySafePauses(store, scanResult, { confirmed = false, attemptIds = null } = {}) {
  if (confirmed !== true) throw new Error("confirmation_required");
  const gov = require("./execution-governance");
  const wanted = attemptIds ? new Set(attemptIds) : null;
  const pausedRunIds = [];
  for (const verdict of scanResult.verdicts || []) {
    if (!verdict.suggestedPause) continue;
    if (wanted && !wanted.has(verdict.attemptId)) continue;
    if (!verdict.runId) continue;
    const run = (store.departmentRuns || []).find((r) => r.id === verdict.runId);
    if (!run || run.archived) continue;
    if (run.automationPaused) continue;
    run.automationPaused = true;
    gov.touch(run);
    pausedRunIds.push(run.id);
  }
  return { pausedRunIds: [...new Set(pausedRunIds)] };
}

module.exports = { scan, applySafePauses, ACTIVE };
