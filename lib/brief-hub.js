"use strict";

const crypto = require("crypto");

const DEFAULT_BRIEF_SOURCES = [
  {
    id: "chatgpt-daily-priority",
    name: "Daily Priority Briefing",
    platform: "ChatGPT",
    agentId: "chatgpt",
    scheduleLabel: "每日 08:00",
    maxAgeHours: 30,
    enabled: true,
  },
  {
    id: "chatgpt-guangdong-construction",
    name: "Guangdong Construction Brief",
    platform: "ChatGPT",
    agentId: "chatgpt",
    scheduleLabel: "每周一 08:00",
    maxAgeHours: 192,
    enabled: true,
  },
  {
    id: "chatgpt-practical-ai",
    name: "Practical AI Research",
    platform: "ChatGPT",
    agentId: "chatgpt",
    scheduleLabel: "每周五 18:00",
    maxAgeHours: 192,
    enabled: true,
  },
  {
    id: "workbuddy-ai-news",
    name: "每日 AI 新闻推送",
    platform: "WorkBuddy",
    agentId: "workbuddy",
    scheduleLabel: "每日（沿用 WorkBuddy 设置）",
    maxAgeHours: 36,
    enabled: true,
  },
];

function cleanText(value, max) {
  return String(value == null ? "" : value).replace(/\u0000/g, "").trim().slice(0, max);
}

function validSourceId(value) {
  const sourceId = cleanText(value, 80).toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{1,79}$/.test(sourceId)) throw new Error("sourceId 只能使用字母、数字、点、横线或下划线");
  return sourceId;
}

function ensureBriefHub(store) {
  if (!Array.isArray(store.briefSources)) store.briefSources = [];
  if (!Array.isArray(store.briefRuns)) store.briefRuns = [];
  for (const source of DEFAULT_BRIEF_SOURCES) {
    if (!store.briefSources.some((item) => item.id === source.id)) store.briefSources.push({ ...source });
  }
  return store;
}

function fingerprintOf(run) {
  return crypto
    .createHash("sha256")
    .update([run.sourceId, run.title, run.scheduledFor || "", run.body].join("\n"), "utf8")
    .digest("hex");
}

function ensureSource(store, input) {
  const sourceId = validSourceId(input.sourceId);
  let source = store.briefSources.find((item) => item.id === sourceId);
  if (!source) {
    source = {
      id: sourceId,
      name: cleanText(input.sourceName || input.title || sourceId, 120),
      platform: cleanText(input.platform || "其他 Agent", 60),
      agentId: cleanText(input.agentId || sourceId, 80),
      scheduleLabel: cleanText(input.scheduleLabel || "按外部 Agent 设置", 120),
      maxAgeHours: Math.max(1, Math.min(24 * 31, Number(input.maxAgeHours) || 36)),
      enabled: true,
    };
    store.briefSources.push(source);
  }
  return source;
}

function normalizeBriefInput(store, input, now) {
  if (!input || typeof input !== "object") throw new Error("简报必须是 JSON 对象");
  const source = ensureSource(store, input);
  const body = cleanText(input.body || input.content || input.text, 200000);
  if (!body) throw new Error("缺少简报正文 body");
  const completedAtRaw = cleanText(input.completedAt || input.runAt || now, 40);
  const completedAtDate = new Date(completedAtRaw);
  if (Number.isNaN(completedAtDate.getTime())) throw new Error("completedAt 不是有效时间");
  const run = {
    sourceId: source.id,
    agentId: cleanText(input.agentId || source.agentId || source.id, 80),
    externalRunId: cleanText(input.externalRunId || input.runId, 160),
    title: cleanText(input.title || source.name, 200),
    body,
    scheduledFor: cleanText(input.scheduledFor, 40),
    completedAt: completedAtDate.toISOString(),
    receivedAt: now,
    sourceUrl: cleanText(input.sourceUrl || input.url, 2000),
    sourcePath: cleanText(input.sourcePath || input.path, 2000),
    unread: input.unread !== false,
    favorite: false,
  };
  run.fingerprint = fingerprintOf(run);
  return { run, source };
}

function ingestBrief(store, input, deps) {
  ensureBriefHub(store);
  const now = deps.nowIso();
  const { run, source } = normalizeBriefInput(store, input, now);
  if(require("./archive").inactive(source) || source.enabled===false)throw new Error("brief_source_paused_or_archived");
  const duplicate = store.briefRuns.find((item) =>
    item.sourceId === run.sourceId && (
      (run.externalRunId && item.externalRunId === run.externalRunId) ||
      (!run.externalRunId && item.fingerprint === run.fingerprint)
    )
  );
  if (duplicate) return { item: duplicate, source, duplicate: true };
  run.id = deps.id("br");
  store.briefRuns.unshift(run);
  store.events = store.events || [];
  store.events.unshift({
    id: deps.id("ev"),
    type: "brief-received",
    text: `${source.platform} · ${source.name} 已送达：${run.title}`,
    agentId: run.agentId,
    createdAt: now,
  });
  return { item: run, source, duplicate: false };
}

function latestRunFor(sourceId, runs) {
  return [...(runs || [])]
    .filter((item) => item.sourceId === sourceId)
    .sort((a, b) => new Date(b.completedAt || b.receivedAt) - new Date(a.completedAt || a.receivedAt))[0] || null;
}

function sourceHealth(source, runs, now = new Date()) {
  const latest = latestRunFor(source.id, runs);
  if (!latest) return { status: "waiting", label: "待首份", ageHours: null, latest: null };
  const at = new Date(latest.completedAt || latest.receivedAt);
  const ageHours = Math.max(0, (now.getTime() - at.getTime()) / 3.6e6);
  const stale = ageHours > (Number(source.maxAgeHours) || 36);
  return { status: stale ? "stale" : "ok", label: stale ? "迟到" : "正常", ageHours, latest };
}

function sourceSummaries(store, now = new Date()) {
  ensureBriefHub(store);
  return store.briefSources
    .filter((source) => source.enabled !== false)
    .map((source) => ({ ...source, ...sourceHealth(source, store.briefRuns, now) }));
}

function excerpt(value, max = 520) {
  const text = cleanText(value, max * 4).replace(/\r/g, "");
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 5);
  const joined = lines.join("\n");
  return joined.length > max ? joined.slice(0, max).trimEnd() + "…" : joined;
}

function buildExternalBriefing(store) {
  const summaries = sourceSummaries(store);
  const withRuns = summaries.filter((item) => item.latest);
  if (!withRuns.length) return null;
  const body = withRuns.map((item) => {
    const latest = item.latest;
    const when = String(latest.completedAt || latest.receivedAt || "").replace("T", " ").slice(0, 16);
    return `【${item.platform} · ${item.name}】${item.label} · ${when}\n${excerpt(latest.body)}`;
  }).join("\n\n");
  return { kicker: "跨 Agent · 自动收件", title: "跨 Agent 简报", body };
}

module.exports = {
  DEFAULT_BRIEF_SOURCES,
  ensureBriefHub,
  ingestBrief,
  sourceHealth,
  sourceSummaries,
  buildExternalBriefing,
  fingerprintOf,
};

