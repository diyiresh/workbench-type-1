"use strict";

const { id } = require("./default-store");
const { inactive } = require("./archive");
const { postMessage } = require("./collaboration");
const {
  normalizeTrigger,
  makeFilterResult,
  normalizeSubscription,
  describeAssignmentAlias,
  nowIso,
  stableHash,
} = require("./superagent-model");

const DEFAULT_INTAKE = Object.freeze({
  allowedSources: Object.freeze([
    "project-chat",
    "department",
    "webhook",
    "schedule",
    "system",
    "inbox",
    "manual",
  ]),
  ignorePatterns: Object.freeze(["^ping$", "^健康检查$", "^heartbeat$"]),
  forceSlowPathTypes: Object.freeze(["ambiguous", "natural-language", "nl"]),
  maxSlowPathQueue: 100,
  maxDeliveryLog: 200,
});

function cloneDefaults() {
  return {
    allowedSources: [...DEFAULT_INTAKE.allowedSources],
    ignorePatterns: [...DEFAULT_INTAKE.ignorePatterns],
    forceSlowPathTypes: [...DEFAULT_INTAKE.forceSlowPathTypes],
    maxSlowPathQueue: DEFAULT_INTAKE.maxSlowPathQueue,
    maxDeliveryLog: DEFAULT_INTAKE.maxDeliveryLog,
  };
}

/** Additive ensure — never deletes user data. */
function ensureSuperagent(store) {
  if (!store || typeof store !== "object") throw new Error("store_required");
  store.superagent ||= {};
  const sa = store.superagent;
  sa.intake = { ...cloneDefaults(), ...(sa.intake || {}) };
  if (!Array.isArray(sa.intake.allowedSources)) sa.intake.allowedSources = cloneDefaults().allowedSources;
  if (!Array.isArray(sa.intake.ignorePatterns)) sa.intake.ignorePatterns = cloneDefaults().ignorePatterns;
  if (!Array.isArray(sa.intake.forceSlowPathTypes)) sa.intake.forceSlowPathTypes = cloneDefaults().forceSlowPathTypes;
  if (!Number.isFinite(Number(sa.intake.maxSlowPathQueue))) sa.intake.maxSlowPathQueue = DEFAULT_INTAKE.maxSlowPathQueue;
  if (!Number.isFinite(Number(sa.intake.maxDeliveryLog))) sa.intake.maxDeliveryLog = DEFAULT_INTAKE.maxDeliveryLog;
  sa.subscriptions = Array.isArray(sa.subscriptions) ? sa.subscriptions : [];
  sa.slowPathQueue = Array.isArray(sa.slowPathQueue) ? sa.slowPathQueue : [];
  sa.deliveryLog = Array.isArray(sa.deliveryLog) ? sa.deliveryLog : [];
  sa.asyncRuns = Array.isArray(sa.asyncRuns) ? sa.asyncRuns : [];
  sa.channels = {
    imMaxWords: 100,
    docStructured: true,
    ...(sa.channels || {}),
  };
  sa.watchdog = {
    noProgressMs: 15 * 60 * 1000,
    maxFailuresPerStep: 3,
    ...(sa.watchdog || {}),
  };
  return sa;
}

function intakeConfig(store) {
  return ensureSuperagent(store).intake;
}

function compilePatterns(patterns) {
  const out = [];
  for (const raw of patterns || []) {
    const text = String(raw || "").trim();
    if (!text) continue;
    try {
      out.push(new RegExp(text, "i"));
    } catch (_) {
      const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      out.push(new RegExp(escaped, "i"));
    }
  }
  return out;
}

function filterTrigger(storeOrConfig, rawTrigger) {
  const trigger = normalizeTrigger(rawTrigger);
  const config = storeOrConfig?.superagent || storeOrConfig?.intake
    ? intakeConfig(storeOrConfig.superagent ? storeOrConfig : { superagent: { intake: storeOrConfig } })
    : storeOrConfig && storeOrConfig.allowedSources
      ? { ...cloneDefaults(), ...storeOrConfig }
      : intakeConfig(storeOrConfig || {});

  const allowed = new Set((config.allowedSources || []).map((s) => String(s).toLowerCase()));
  if (allowed.size && !allowed.has(String(trigger.source).toLowerCase())) {
    return makeFilterResult("ignore", "source_not_allowed", trigger, { configUsed: "allowedSources" });
  }

  const patterns = compilePatterns(config.ignorePatterns);
  if (patterns.some((re) => re.test(trigger.text.trim()))) {
    return makeFilterResult("ignore", "matched_ignore_pattern", trigger);
  }

  const slowTypes = new Set((config.forceSlowPathTypes || []).map((s) => String(s).toLowerCase()));
  if (slowTypes.has(String(trigger.type).toLowerCase())) {
    return makeFilterResult("slow_path", "force_slow_path_type", trigger);
  }

  const trimmed = trigger.text.trim();
  if (!trimmed) {
    return makeFilterResult("ignore", "empty_text", trigger);
  }
  if (trimmed.length > 280 || /\n/.test(trimmed)) {
    return makeFilterResult("slow_path", "long_or_multiline_text", trigger);
  }

  return makeFilterResult("accept", "fast_path_accept", trigger);
}

function queueSlowPath(store, rawTrigger, { reason = "slow_path" } = {}) {
  const sa = ensureSuperagent(store);
  const trigger = normalizeTrigger(rawTrigger);
  const item = {
    id: "sp-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    reason: String(reason),
    trigger,
    queuedAt: nowIso(),
    status: "queued",
  };
  sa.slowPathQueue.unshift(item);
  const max = Number(sa.intake.maxSlowPathQueue) || DEFAULT_INTAKE.maxSlowPathQueue;
  if (sa.slowPathQueue.length > max) sa.slowPathQueue.length = max;
  return item;
}

function listSubscriptions(store) {
  const sa = ensureSuperagent(store);
  return sa.subscriptions.map((s) => {
    try {
      return normalizeSubscription(s);
    } catch (_) {
      return { ...s, enabled: false, invalid: true };
    }
  });
}

function upsertSubscription(store, raw = {}) {
  const sa = ensureSuperagent(store);
  const normalized = normalizeSubscription(raw);
  normalized.fingerprint = stableHash({threadId:normalized.threadId,workerId:normalized.workerId,projectRoomId:normalized.projectRoomId,eventTypes:normalized.eventTypes});
  if (!normalized.id) normalized.id = id("sub");
  const idx = sa.subscriptions.findIndex((s) => s.id === normalized.id);
  if (idx >= 0) {
    const prev = sa.subscriptions[idx];
    normalized.createdAt = prev.createdAt || normalized.createdAt;
    sa.subscriptions[idx] = normalized;
  } else {
    // Idempotent upsert by thread+worker+types fingerprint when no id collision
    const fingerprint = stableHash({
      threadId: normalized.threadId,
      workerId: normalized.workerId,
      projectRoomId: normalized.projectRoomId,
      eventTypes: normalized.eventTypes,
    });
    const existing = sa.subscriptions.find((s) => s.fingerprint === fingerprint);
    if (existing) {
      Object.assign(existing, normalized, { id: existing.id, fingerprint, createdAt: existing.createdAt });
      return existing;
    }
    normalized.fingerprint = fingerprint;
    sa.subscriptions.unshift(normalized);
  }
  return normalized;
}

function removeSubscription(store, subscriptionId) {
  const sa = ensureSuperagent(store);
  const before = sa.subscriptions.length;
  sa.subscriptions = sa.subscriptions.filter((s) => s.id !== subscriptionId);
  return { removed: before !== sa.subscriptions.length, id: subscriptionId };
}

/**
 * Shared planning path for preview and real delivery.
 */
function planFanOut(store, rawEvent = {}) {
  const eventType = String(rawEvent.type || rawEvent.eventType || "event");
  const threadId = String(rawEvent.threadId || rawEvent.runId || rawEvent.roomId || "").trim();
  const text = String(rawEvent.text || rawEvent.body || "");
  const subs = listSubscriptions(store).filter((s) => s.enabled && !s.invalid);
  const deliveries = [];
  for (const sub of subs) {
    if (threadId && sub.threadId !== threadId) continue;
    const types = sub.eventTypes || ["*"];
    if (!types.includes("*") && !types.includes(eventType)) continue;
    deliveries.push({
      subscriptionId: sub.id,
      threadId: sub.threadId,
      workerId: sub.workerId,
      projectRoomId: sub.projectRoomId,
      mode: sub.workerId ? "direct-worker" : "project-room",
      eventType,
      previewText: text.slice(0, 120),
    });
  }
  return {
    eventType,
    threadId: threadId || null,
    deliveryCount: deliveries.length,
    deliveries,
    aliases: describeAssignmentAlias(store),
  };
}

function eventKey(rawEvent, idempotencyKey) {
  if (idempotencyKey) return String(idempotencyKey);
  if (rawEvent && rawEvent.id) return String(rawEvent.id);
  return stableHash({
    type: rawEvent.type || rawEvent.eventType || "event",
    threadId: rawEvent.threadId || rawEvent.runId || "",
    text: rawEvent.text || rawEvent.body || "",
    createdAt: rawEvent.createdAt || "",
  });
}

function alreadyDelivered(sa, key, subscriptionId) {
  return (sa.deliveryLog || []).some((d) => d.eventKey === key && d.subscriptionId === subscriptionId);
}

function rememberDelivery(sa, entry) {
  sa.deliveryLog.unshift(entry);
  const max = Number(sa.intake.maxDeliveryLog) || DEFAULT_INTAKE.maxDeliveryLog;
  if (sa.deliveryLog.length > max) sa.deliveryLog.length = max;
}

function roomPausedOrMissing(store, roomId) {
  if (!roomId) return { ok: false, reason: "room_missing" };
  const run = (store.departmentRuns || []).find((r) => r.id === roomId);
  if (!run) return { ok: false, reason: "project_missing" };
  if (inactive(run) || run.archived) return { ok: false, reason: "project_paused_or_archived" };
  if (run.automationPaused) return { ok: false, reason: "project_paused", soft: true };
  return { ok: true, run };
}

/**
 * Real subscribe/direct fan-out. Uses planFanOut; respects pause; idempotent via deliveryLog.
 */
function deliverFanOut(store, rawEvent = {}, { dryRun = false, idempotencyKey = null, bypassPause = false } = {}) {
  const sa = ensureSuperagent(store);
  const plan = planFanOut(store, rawEvent);
  const key = eventKey(rawEvent, idempotencyKey);
  const text = String(rawEvent.text || rawEvent.body || "").trim() || ("[superagent] " + plan.eventType);
  const results = [];

  for (const planned of plan.deliveries) {
    if (alreadyDelivered(sa, key, planned.subscriptionId)) {
      results.push({ ...planned, status: "duplicate", eventKey: key });
      continue;
    }

    const roomId = planned.projectRoomId || planned.threadId;
    const gate = roomPausedOrMissing(store, roomId);
    if (!gate.ok && !(gate.soft && bypassPause)) {
      results.push({ ...planned, status: "skipped", reason: gate.reason, eventKey: key });
      continue;
    }
    // Soft pause: still allow room notice but mark pausedFollowUp
    const paused = !!(gate.soft && !bypassPause);

    if (dryRun) {
      results.push({ ...planned, status: "planned", eventKey: key, paused });
      continue;
    }

    let message = null;
    let notice = null;
    try {
      message = postMessage(store, {
        runId: roomId,
        sender: "superagent",
        recipient: planned.workerId || "all",
        type: planned.workerId ? "task_assignment" : "system",
        text: planned.workerId
          ? ("[直投] " + text)
          : ("[订阅房间] " + text),
      });
    } catch (err) {
      results.push({ ...planned, status: "error", reason: err.message, eventKey: key });
      continue;
    }

    if (planned.workerId) {
      store.inbox ||= [];
      notice = {
        id: id("in"),
        from: "superagent",
        toAgentId: planned.workerId,
        runId: roomId,
        status: paused ? "held" : "queued",
        kind: "superagent-direct",
        body: text,
        subscriptionId: planned.subscriptionId,
        eventKey: key,
        createdAt: nowIso(),
      };
      store.inbox.unshift(notice);
    }

    rememberDelivery(sa, {
      id: id("dlv"),
      eventKey: key,
      subscriptionId: planned.subscriptionId,
      messageId: message.id,
      noticeId: notice?.id || null,
      workerId: planned.workerId,
      projectRoomId: roomId,
      at: nowIso(),
      paused,
    });

    results.push({
      ...planned,
      status: paused ? "delivered-paused" : "delivered",
      eventKey: key,
      messageId: message.id,
      noticeId: notice?.id || null,
    });
  }

  return {
    ...plan,
    eventKey: key,
    dryRun: !!dryRun,
    results,
    deliveredCount: results.filter((r) => String(r.status).startsWith("delivered")).length,
    duplicateCount: results.filter((r) => r.status === "duplicate").length,
    skippedCount: results.filter((r) => r.status === "skipped").length,
  };
}

/**
 * Filter then deliver (accept) or queue Slow Path (optionally still deliver with forceDeliver).
 */
function ingestAndDeliver(store, rawEvent = {}, opts = {}) {
  const filter = filterTrigger(store, rawEvent);
  if (filter.decision === "ignore") {
    return { filter, delivery: null, slowPathItem: null };
  }
  let slowPathItem = null;
  if (filter.decision === "slow_path") {
    slowPathItem = queueSlowPath(store, filter.trigger, { reason: filter.reason });
    if (!opts.forceDeliver) {
      return { filter, delivery: null, slowPathItem };
    }
  }
  const delivery = deliverFanOut(store, { ...rawEvent, ...filter.trigger, createdAt: rawEvent.createdAt || '' }, opts);
  return { filter, delivery, slowPathItem };
}

module.exports = {
  DEFAULT_INTAKE,
  ensureSuperagent,
  intakeConfig,
  filterTrigger,
  queueSlowPath,
  listSubscriptions,
  upsertSubscription,
  removeSubscription,
  planFanOut,
  deliverFanOut,
  ingestAndDeliver,
};
