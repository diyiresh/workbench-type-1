"use strict";
const assert = require("node:assert/strict");
const intake = require("../lib/superagent-intake");
const model = require("../lib/superagent-model");

const store = { superagent: { subscriptions: [] } };
intake.ensureSuperagent(store);

// Fast Path ignore: ping / 健康检查
assert.equal(intake.filterTrigger(store, { source: "manual", text: "ping" }).decision, "ignore");
assert.equal(intake.filterTrigger(store, { source: "system", text: "健康检查" }).decision, "ignore");

// Source whitelist
assert.equal(
  intake.filterTrigger(store, { source: "unknown-bus", text: "hello" }).decision,
  "ignore"
);

// Accept short structured command
{
  const r = intake.filterTrigger(store, { source: "project-chat", text: "开始阶段复核" });
  assert.equal(r.decision, "accept");
  assert.equal(r.slowPath, false);
}

// Slow Path: forced type + long text
assert.equal(
  intake.filterTrigger(store, { source: "manual", type: "natural-language", text: "帮我看看" }).decision,
  "slow_path"
);
assert.equal(
  intake.filterTrigger(store, { source: "manual", text: "x".repeat(300) }).decision,
  "slow_path"
);

// queueSlowPath is additive and capped conceptually
{
  const item = intake.queueSlowPath(store, { source: "manual", type: "nl", text: "长任务说明" }, { reason: "test" });
  assert.ok(item.id.startsWith("sp-"));
  assert.equal(store.superagent.slowPathQueue[0].id, item.id);
}

// Subscription fan-out stub
store.superagent.subscriptions = [
  model.normalizeSubscription({ id: "sub-1", threadId: "run-a", workerId: "cursor", eventTypes: ["task", "*"] }),
  model.normalizeSubscription({ id: "sub-2", threadId: "run-a", projectRoomId: "run-a", workerId: "", eventTypes: ["chat"] }),
  model.normalizeSubscription({ id: "sub-3", threadId: "run-b", workerId: "workbuddy", eventTypes: ["*"] }),
];
{
  const plan = intake.planFanOut(store, { type: "task", threadId: "run-a", text: "请执行" });
  assert.equal(plan.deliveryCount, 1);
  assert.equal(plan.deliveries[0].workerId, "cursor");
  assert.equal(plan.deliveries[0].mode, "direct-worker");
}
{
  const plan = intake.planFanOut(store, { type: "chat", runId: "run-a", text: "讨论一下" });
  assert.equal(plan.deliveryCount, 2);
  assert.ok(plan.deliveries.some((d) => d.mode === "project-room"));
}
{
  const plan = intake.planFanOut(store, { type: "task", threadId: "run-b" });
  assert.equal(plan.deliveryCount, 1);
  assert.equal(plan.deliveries[0].workerId, "workbuddy");
}

console.log("Superagent intake: Fast Path filter, Slow Path queue, subscription fan-out preview passed.");
