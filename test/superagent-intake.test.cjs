"use strict";
const assert = require("node:assert/strict");
const intake = require("../lib/superagent-intake");
const model = require("../lib/superagent-model");

const store = {
  departmentRuns: [{ id: "run-a", goal: "t", automationPaused: false, items: [] }],
  projectMessages: [],
  inbox: [],
  superagent: { subscriptions: [] },
};
intake.ensureSuperagent(store);

assert.equal(intake.filterTrigger(store, { source: "manual", text: "ping" }).decision, "ignore");
assert.equal(intake.filterTrigger(store, { source: "system", text: "健康检查" }).decision, "ignore");
assert.equal(intake.filterTrigger(store, { source: "unknown-bus", text: "hello" }).decision, "ignore");
assert.equal(intake.filterTrigger(store, { source: "project-chat", text: "开始阶段复核" }).decision, "accept");
assert.equal(intake.filterTrigger(store, { source: "manual", type: "natural-language", text: "帮我看看" }).decision, "slow_path");
assert.equal(intake.filterTrigger(store, { source: "manual", text: "x".repeat(300) }).decision, "slow_path");

{
  const item = intake.queueSlowPath(store, { source: "manual", type: "nl", text: "长任务说明" }, { reason: "test" });
  assert.ok(item.id.startsWith("sp-"));
  assert.equal(store.superagent.slowPathQueue[0].id, item.id);
}

const sub1 = intake.upsertSubscription(store, {
  threadId: "run-a",
  workerId: "cursor",
  eventTypes: ["task", "*"],
});
assert.ok(sub1.id);
const sub1b = intake.upsertSubscription(store, {
  threadId: "run-a",
  workerId: "cursor",
  eventTypes: ["task", "*"],
});
assert.equal(sub1b.id, sub1.id, "fingerprint upsert is idempotent");

intake.upsertSubscription(store, {
  id: "sub-room",
  threadId: "run-a",
  projectRoomId: "run-a",
  workerId: "",
  eventTypes: ["chat"],
});
intake.upsertSubscription(store, {
  id: "sub-b",
  threadId: "run-b",
  workerId: "workbuddy",
  eventTypes: ["*"],
});

{
  const plan = intake.planFanOut(store, { type: "task", threadId: "run-a", text: "请执行" });
  assert.equal(plan.deliveryCount, 1);
  assert.equal(plan.deliveries[0].workerId, "cursor");
}

{
  const first = intake.deliverFanOut(store, { id: "evt-1", type: "task", threadId: "run-a", text: "请执行直投" });
  assert.equal(first.deliveredCount, 1);
  assert.equal(first.results[0].status, "delivered");
  assert.ok(store.projectMessages.some((m) => m.id === first.results[0].messageId));
  assert.ok(store.inbox.some((n) => n.kind === "superagent-direct" && n.toAgentId === "cursor"));

  const second = intake.deliverFanOut(store, { id: "evt-1", type: "task", threadId: "run-a", text: "请执行直投" });
  assert.equal(second.duplicateCount, 1);
  assert.equal(second.deliveredCount, 0);
}

{
  store.departmentRuns[0].automationPaused = true;
  const paused = intake.deliverFanOut(store, { id: "evt-2", type: "task", threadId: "run-a", text: "暂停时直投" });
  assert.equal(paused.results[0].status, "skipped");
  assert.equal(paused.results[0].reason, "project_paused");
  store.departmentRuns[0].automationPaused = false;
}

{
  const ingested = intake.ingestAndDeliver(store, { source: "manual", type: "event", text: "ping" });
  assert.equal(ingested.filter.decision, "ignore");
  assert.equal(ingested.delivery, null);
}
{
  const ingested = intake.ingestAndDeliver(store, {
    id: "evt-3",
    source: "project-chat",
    type: "task",
    threadId: "run-a",
    text: "短指令直投",
  });
  assert.equal(ingested.filter.decision, "accept");
  assert.ok(ingested.delivery.deliveredCount >= 1);
}

assert.equal(intake.removeSubscription(store, "sub-b").removed, true);
assert.ok(!intake.listSubscriptions(store).some((s) => s.id === "sub-b"));

console.log("Superagent intake Phase2: filter, CRUD subscriptions, shared plan/deliver idempotent fan-out, pause skip, ingest passed.");