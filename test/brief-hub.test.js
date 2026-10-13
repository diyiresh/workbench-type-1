const assert = require("assert");
const {
  ensureBriefHub,
  ingestBrief,
  sourceHealth,
  buildExternalBriefing,
} = require("../lib/brief-hub");

let seq = 0;
const deps = {
  id: (prefix) => `${prefix}-${++seq}`,
  nowIso: () => "2026-09-27T08:00:00.000Z",
};

const store = { events: [] };
ensureBriefHub(store);
assert.strictEqual(store.briefSources.length, 4, "应迁移四个默认简报来源");

const first = ingestBrief(store, {
  kind: "brief",
  sourceId: "chatgpt-daily-priority",
  externalRunId: "run-2026-09-27",
  title: "今日优先级",
  completedAt: "2026-09-27T07:59:00+08:00",
  body: "先完成项目核验。\n再处理三条指令。",
}, deps);
assert.strictEqual(first.duplicate, false);
assert.strictEqual(store.briefRuns.length, 1);
assert.strictEqual(first.item.favorite, false, "新简报默认未收藏");
first.item.favorite = true;
first.item.unread = false;

const duplicate = ingestBrief(store, {
  sourceId: "chatgpt-daily-priority",
  externalRunId: "run-2026-09-27",
  body: "即使正文变化，同一外部运行也不得重复入库。",
}, deps);
assert.strictEqual(duplicate.duplicate, true);
assert.strictEqual(store.briefRuns.length, 1);
assert.strictEqual(duplicate.item.favorite, true, "重复投递保留收藏");
assert.strictEqual(duplicate.item.unread, false, "重复投递保留已读");

ingestBrief(store, { sourceId: "chatgpt-practical-ai", title: "AI 研究", body: "同一份研究内容" }, deps);
store.briefRuns.find(run => run.sourceId === "chatgpt-practical-ai").favorite = true;
const sameContent = ingestBrief(store, { sourceId: "chatgpt-practical-ai", title: "AI 研究", body: "同一份研究内容" }, deps);
assert.strictEqual(sameContent.duplicate, true, "没有外部运行 ID 时应按内容指纹去重");
assert.strictEqual(sameContent.item.favorite, true, "按内容指纹去重也保留收藏");
assert.strictEqual(store.briefRuns.length, 2);

const health = sourceHealth(store.briefSources[0], store.briefRuns, new Date("2026-09-29T16:00:00.000Z"));
assert.strictEqual(health.status, "stale", "超过日更容忍窗口后应标记迟到");

const custom = ingestBrief(store, {
  sourceId: "workbuddy-special",
  sourceName: "临时专题",
  platform: "WorkBuddy",
  body: "专题全文",
}, deps);
assert.strictEqual(custom.source.name, "临时专题", "应允许未来 Agent 动态注册来源");

const opening = buildExternalBriefing(store);
assert.match(opening.body, /Daily Priority Briefing/);
assert.match(opening.body, /临时专题/);
console.log("Brief hub checks passed.");

