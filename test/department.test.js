"use strict";

const assert = require("assert");
const fs=require('fs'),path=require('path'),os=require('os');
const { buildDefaultStore } = require("../lib/default-store");
const {
  ensureDepartmentSystem, createDepartmentRun, startItem, submitItem, reviewExecutor, completeRework,
} = require("../lib/department");

const store = buildDefaultStore();
ensureDepartmentSystem(store);
assert.equal(store.departments[0].roles.length, 4, "必须固定四个岗位");

const run = createDepartmentRun(store, { goal: "完成一个需要计划、执行与复核的混合任务", context: "不得外发材料" });
assert.deepEqual(run.items.map((item) => item.role), ["director", "executor", "reviewer", "secretary"]);
assert.equal(run.items[0].status, "queued");
const room = createDepartmentRun(store, { goal: "固定项目成员", participantAgentIds: ["codex", "cursor", "workbuddy"] });
assert.deepEqual(room.participantAgentIds, ["codex", "cursor", "workbuddy"]);
assert.equal(room.items.find((item) => item.role === "director").ownerAgentId, "codex");
assert.equal(room.items.find((item) => item.role === "executor").ownerAgentId, "workbuddy");
assert.equal(room.items.find((item) => item.role === "reviewer").ownerAgentId, "cursor");
assert.equal(run.items[1].status, "blocked");
assert.throws(() => startItem(store, run.id, run.items[1].id), /item_not_ready|dependencies_not_done/);

startItem(store, run.id, run.items[0].id);
submitItem(store, run.id, run.items[0].id, { output: "方案：先产出，再逐项核验。" });
assert.equal(run.items[1].status, "queued");
startItem(store, run.id, run.items[1].id);
const material=path.join(os.tmpdir(),'bench-material-'+require('crypto').randomUUID()+'.md');
fs.writeFileSync(material,'第一版主要产出',{flag:'wx'});
submitItem(store, run.id, run.items[1].id, { output: "第一版主要产出", materials: [material] });
assert.equal(run.artifacts.length, 1);
assert.equal(run.items[2].status, "queued");
assert.throws(() => reviewExecutor(store, run.id, { reviewerAgentId: run.items[1].ownerAgentId, verdict: "pass", comment: "自审" }), /independent/);

reviewExecutor(store, run.id, { reviewerAgentId: run.items[2].ownerAgentId, verdict: "reject", comment: "缺少可核验依据" });
assert.equal(run.items[1].status, "rework");
assert.equal(run.status, "rework");

completeRework(store, run.id, run.items[1].id, { output: "补充依据后的第二版" });
assert.equal(run.items[2].status, "queued");
reviewExecutor(store, run.id, { reviewerAgentId: run.items[2].ownerAgentId, verdict: "pass", comment: "依据完整，可以通过" });
assert.equal(run.items[3].status, "queued");

startItem(store, run.id, run.items[3].id);
submitItem(store, run.id, run.items[3].id, { output: "最终整合交付" });
assert.equal(run.status, "completed");
assert.equal(run.finalOutput, "最终整合交付");
fs.unlinkSync(material);

console.log("Virtual department workflow checks passed.");
