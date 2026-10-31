"use strict";

const {
  normalizeTrigger,
  makeFilterResult,
  normalizeSubscription,
  describeAssignmentAlias,
  nowIso,
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
});

function cloneDefaults() {
  return {
    allowedSources: [...DEFAULT_INTAKE.allowedSources],
    ignorePatterns: [...DEFAULT_INTAKE.ignorePatterns],
    forceSlowPathTypes: [...DEFAULT_INTAKE.forceSlowPathTypes],
    maxSlowPathQueue: DEFAULT_INTAKE.maxSlowPathQueue,
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
  sa.subscriptions = Array.isArray(sa.subscriptions) ? sa.subscriptions : [];
  sa.slowPathQueue = Array.isArray(sa.slowPathQueue) ? sa.slowPathQueue : [];
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

/**
 * Deterministic Fast Path filter. Does not call an LLM.
 */
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

  // Short structured commands stay on Fast Path; long free text goes Slow Path.
  const trimmed = trigger.text.trim();
  if (!trimmed) {
    return makeFilterResult("ignore", "empty_text", trigger);
  }
  if (trimmed.length > 280 || /\n/.test(trimmed)) {
    return makeFilterResult("slow_path", "long_or_multiline_text", trigger);
  }

  return makeFilterResult("accept", "fast_path_accept", trigger);
}

/**
 * Queue a Slow Path candidate (additive). Returns queue item.
 * Prefer preview-only in HTTP; mutation helpers are available for Phase2.
 */
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

/**
 * Subscribe/direct fan-out stub: compute who would receive an event.
 * Does not mutate store.
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

module.exports = {
  DEFAULT_INTAKE,
  ensureSuperagent,
  intakeConfig,
  filterTrigger,
  queueSlowPath,
  listSubscriptions,
  planFanOut,
};
