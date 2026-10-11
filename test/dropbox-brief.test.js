const assert = require("assert");
const { processBody } = require("../lib/dropbox");

let seq = 0;
const store = { events: [], tasks: [] };
const result = processBody(store, {
  kind: "brief",
  sourceId: "workbuddy-ai-news",
  externalRunId: "wb-2026-09-27",
  agentId: "workbuddy",
  title: "每日 AI 新闻推送",
  body: "今天的完整简报",
}, {
  id: (prefix) => `${prefix}-${++seq}`,
  nowIso: () => "2026-09-27T09:00:00.000Z",
});

assert.strictEqual(result.kind, "brief");
assert.strictEqual(store.briefRuns.length, 1);
assert.strictEqual(store.tasks.length, 0, "简报报送不能误建为任务");
assert.strictEqual(store.events[0].type, "brief-received");
console.log("Dropbox brief checks passed.");

