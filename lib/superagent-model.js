"use strict";

/** Pure shapes/helpers for Super-agent Phase1 (no I/O). */

const TRIGGER_SOURCES = Object.freeze([
  "project-chat",
  "department",
  "webhook",
  "schedule",
  "system",
  "inbox",
  "manual",
]);

const FILTER_DECISIONS = Object.freeze(["accept", "ignore", "slow_path"]);
const WATCHDOG_ACTIONS = Object.freeze(["none", "notify", "pause"]);

function nowIso(ms = Date.now()) {
  return new Date(ms).toISOString();
}

function asString(value) {
  return value == null ? "" : String(value);
}

/**
 * Normalize an inbound trigger for Fast Path evaluation.
 * @param {object} raw
 */
function normalizeTrigger(raw = {}) {
  const source = asString(raw.source || raw.from || "manual").trim() || "manual";
  const type = asString(raw.type || "event").trim() || "event";
  const text = asString(raw.text || raw.body || raw.message || "");
  return {
    id: asString(raw.id) || null,
    source,
    type,
    text,
    threadId: asString(raw.threadId || raw.runId || raw.roomId || "") || null,
    agentId: asString(raw.agentId || raw.toAgentId || "") || null,
    priority: Number.isFinite(Number(raw.priority)) ? Number(raw.priority) : 0,
    meta: raw.meta && typeof raw.meta === "object" ? raw.meta : {},
    createdAt: asString(raw.createdAt) || nowIso(),
  };
}

/**
 * @returns {{ decision: string, reason: string, trigger: object, slowPath: boolean }}
 */
function makeFilterResult(decision, reason, trigger, extra = {}) {
  if (!FILTER_DECISIONS.includes(decision)) {
    throw new Error("invalid_filter_decision");
  }
  return {
    decision,
    reason: asString(reason),
    trigger,
    slowPath: decision === "slow_path",
    ...extra,
  };
}

/**
 * Subscription: thread-scoped interest that can direct-fan-out to a worker or project room.
 */
function normalizeSubscription(raw = {}) {
  const threadId = asString(raw.threadId || raw.runId || "").trim();
  const workerId = asString(raw.workerId || raw.agentId || "").trim();
  const projectRoomId = asString(raw.projectRoomId || raw.runId || threadId || "").trim();
  if (!threadId) throw new Error("subscription_thread_required");
  if (!workerId && !projectRoomId) throw new Error("subscription_target_required");
  return {
    id: asString(raw.id) || null,
    threadId,
    workerId: workerId || null,
    projectRoomId: projectRoomId || null,
    eventTypes: Array.isArray(raw.eventTypes)
      ? raw.eventTypes.map((t) => asString(t)).filter(Boolean)
      : ["*"],
    enabled: raw.enabled !== false,
    createdAt: asString(raw.createdAt) || nowIso(),
  };
}

/**
 * Map article Ticket/Assignment vocabulary onto workbench ledger concepts.
 */
function describeAssignmentAlias(storeLike = {}) {
  return {
    ticketLike: "store.inbox (+ department item)",
    attemptLike: "store.executionAttempts",
    threadLike: "store.departmentRuns + store.projectMessages",
    workerLike: "store.agents / ownerAgentId on stage items",
    counts: {
      inbox: Array.isArray(storeLike.inbox) ? storeLike.inbox.length : 0,
      attempts: Array.isArray(storeLike.executionAttempts) ? storeLike.executionAttempts.length : 0,
      runs: Array.isArray(storeLike.departmentRuns) ? storeLike.departmentRuns.length : 0,
    },
  };
}

/**
 * @returns {{ attemptId: string, runId: string|null, action: string, reason: string, severity: string, suggestedPause: boolean }}
 */
function makeWatchdogVerdict({
  attemptId,
  runId = null,
  action = "none",
  reason,
  severity = "info",
  suggestedPause = false,
  details = {},
}) {
  if (!WATCHDOG_ACTIONS.includes(action)) throw new Error("invalid_watchdog_action");
  return {
    attemptId: asString(attemptId),
    runId: runId ? asString(runId) : null,
    action,
    reason: asString(reason),
    severity,
    suggestedPause: !!suggestedPause,
    details,
    at: nowIso(),
  };
}

module.exports = {
  TRIGGER_SOURCES,
  FILTER_DECISIONS,
  WATCHDOG_ACTIONS,
  nowIso,
  normalizeTrigger,
  makeFilterResult,
  normalizeSubscription,
  describeAssignmentAlias,
  makeWatchdogVerdict,
};
