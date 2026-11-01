"use strict";

/** Pure shapes/helpers for Super-agent (Phase1+2, no I/O). */

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
const ASYNC_STATUSES = Object.freeze(["running", "stopping", "stopped", "failed", "done"]);
const CHANNELS = Object.freeze(["im", "doc", "system"]);

function nowIso(ms = Date.now()) {
  return new Date(ms).toISOString();
}

function asString(value) {
  return value == null ? "" : String(value);
}

function stableHash(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

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

function describeAssignmentAlias(storeLike = {}) {
  const asyncRuns = storeLike.superagent && storeLike.superagent.asyncRuns;
  return {
    ticketLike: "store.inbox (+ department item)",
    attemptLike: "store.executionAttempts",
    threadLike: "store.departmentRuns + store.projectMessages",
    workerLike: "store.agents / ownerAgentId on stage items",
    asyncLike: "store.superagent.asyncRuns (+ optional attemptId)",
    counts: {
      inbox: Array.isArray(storeLike.inbox) ? storeLike.inbox.length : 0,
      attempts: Array.isArray(storeLike.executionAttempts) ? storeLike.executionAttempts.length : 0,
      runs: Array.isArray(storeLike.departmentRuns) ? storeLike.departmentRuns.length : 0,
      asyncRuns: Array.isArray(asyncRuns) ? asyncRuns.length : 0,
    },
  };
}

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

function channelReplyHint(channels = {}, channel = "im") {
  const ch = CHANNELS.includes(channel) ? channel : "im";
  const imMax = Number(channels.imMaxWords) || 100;
  if (ch === "im") {
    return {
      channel: "im",
      maxWords: imMax,
      style: "brief",
      hint: "IM reply keep under " + imMax + " words; conclusion first.",
    };
  }
  if (ch === "doc") {
    return {
      channel: "doc",
      style: channels.docStructured === false ? "prose" : "structured",
      hint: "Docs/PRs use structured sections: background, conclusion, evidence, next steps.",
    };
  }
  return { channel: "system", style: "log", hint: "System logs stay short and searchable." };
}

function normalizeAsyncRun(raw = {}) {
  const status = asString(raw.status || "running");
  if (!ASYNC_STATUSES.includes(status)) throw new Error("invalid_async_status");
  const channel = CHANNELS.includes(raw.channel) ? raw.channel : "im";
  return {
    id: asString(raw.id) || null,
    runId: asString(raw.runId || raw.threadId || "") || null,
    agentId: asString(raw.agentId || "") || null,
    attemptId: asString(raw.attemptId || "") || null,
    status,
    stopRequested: !!raw.stopRequested,
    goal: asString(raw.goal || raw.text || ""),
    channel,
    idempotencyKey: asString(raw.idempotencyKey || "") || null,
    leaseExpiresAt: asString(raw.leaseExpiresAt || "") || null,
    createdAt: asString(raw.createdAt) || nowIso(),
    updatedAt: asString(raw.updatedAt) || nowIso(),
    stoppedAt: asString(raw.stoppedAt || "") || null,
    meta: raw.meta && typeof raw.meta === "object" ? raw.meta : {},
  };
}

module.exports = {
  TRIGGER_SOURCES,
  FILTER_DECISIONS,
  WATCHDOG_ACTIONS,
  ASYNC_STATUSES,
  CHANNELS,
  nowIso,
  stableHash,
  normalizeTrigger,
  makeFilterResult,
  normalizeSubscription,
  describeAssignmentAlias,
  makeWatchdogVerdict,
  channelReplyHint,
  normalizeAsyncRun,
};