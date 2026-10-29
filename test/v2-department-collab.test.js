"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { buildDefaultStore } = require("../lib/default-store");
const dept = require("../lib/department");
const gov = require("../lib/execution-governance");

function freshStore() {
  const store = buildDefaultStore();
  dept.ensureDepartmentSystem(store);
  return store;
}

function v2(store, goal) {
  return dept.createDepartmentRun(store, {
    goal,
    context: "不外发",
    v2: true,
    participantAgentIds: ["codex", "cursor", "workbuddy"],
    requiresWritingApproval: false,
    delivery: { mode: "text" },
  });
}

function seedAttempts(store, run, item, count, hash = gov.input(store, run, item.id, "stage", null)) {
  store.executionAttempts ||= [];
  for (let i = 0; i < count; i += 1) {
    store.executionAttempts.push({
      id: `ea-${run.id}-${item.id}-${i}`,
      runId: run.id,
      stepId: item.id,
      purpose: "stage",
      agentId: item.ownerAgentId,
      inputHash: hash,
      extra: null,
      state: "failed",
    });
  }
  return hash;
}

const legacyStore = freshStore();
legacyStore.departmentRuns.push({
  id: "dr-old",
  goal: "旧目标",
  status: "active",
  currentRole: "executor",
  items: [
    { id: "di-d", role: "director", label: "部门主管", status: "done", ownerAgentId: "codex" },
    { id: "di-e", role: "executor", label: "主执行人", status: "queued", ownerAgentId: "workbuddy" },
    { id: "di-r", role: "reviewer", label: "独立复核人", status: "blocked", ownerAgentId: "cursor" },
    { id: "di-s", role: "secretary", label: "整合秘书", status: "blocked", ownerAgentId: "codex" },
  ],
});
dept.ensureDepartmentSystem(legacyStore);
const legacy = legacyStore.departmentRuns.find((run) => run.id === "dr-old");
assert.equal(legacy.status, "active");
assert.equal(legacy.currentRole, "executor");
assert.equal(legacy.collabVersion, 1);
assert.equal(legacy.items[0].orgRole, "lead");
assert.equal(legacy.items[1].orgRole, "room");
assert.equal(legacy.items[1].roomId, "room-executor");
assert.equal(legacy.items[1].parentItemId, "di-d");
assert.equal(legacy.items[0].parentItemId, null);
assert.equal(legacy.orgEdges[0].from, "boss");
assert.equal(legacy.orgEdges[legacy.orgEdges.length - 1].to, "room-secretary");
assert.equal(legacy.items[1].status, "queued");

const store = freshStore();
const classic = dept.createDepartmentRun(store, { goal: "仍走四阶段", v2: "true" });
assert.equal(classic.collabVersion, 1);
assert.deepEqual(classic.items.map((item) => item.role), ["director", "executor", "reviewer", "secretary"]);
assert.throws(() => dept.sealHandoff(store, classic.id, { itemId: classic.items[0].id, summary: "旧链不能封印" }), /v2_run_required/);

const run = v2(store, "试一条 v2 部门协作");
assert.equal(run.collabVersion, 2);
assert.equal(run.items[0].orgRole, "lead");
assert.equal(run.items[0].roomId, "room-director");
assert.deepEqual(run.items.slice(1).map((item) => item.orgRole), ["room", "room", "room"]);
assert.equal(run.items[1].parentItemId, run.items[0].id);
assert.equal(run.items[2].parentItemId, run.items[1].id);
assert.notEqual(run.items[1].ownerAgentId, run.items[2].ownerAgentId);
assert.deepEqual(run.orgEdges.map((edge) => edge.to), ["room-director", "room-executor", "room-reviewer", "room-secretary"]);
const tree = dept.orgTree(store, run.id);
assert.equal(tree.boss.orgRole, "boss");
assert.equal(tree.boss.agentId, "chairman");
assert.equal(tree.lead.itemId, run.items[0].id);
assert.equal(tree.rooms.length, 3);
assert.equal(tree.collabVersion, 2);

const sealed = dept.sealHandoff(store, run.id, {
  roomId: run.items[0].roomId,
  summary: "方案可交给执行房间",
  decisions: ["先做最小切片"],
  openQuestions: "验收是否只跑测试",
  artifacts: [{ name: "规范", path: "docs/SPEC-v2-department-collab.md" }],
  kvHints: { next: "执行房间领取", apiKey: "do-not-keep" },
  sections: { activeFiles: ["lib/department.js", "server.js"], acceptance: "npm test" },
});
assert.equal(sealed.handoff.toolSealed, true);
assert.equal(sealed.handoff.sealed, true);
assert.equal(sealed.handoff.sealedBy, run.items[0].ownerAgentId);
assert.equal(sealed.handoff.summary, "方案可交给执行房间");
assert.deepEqual(sealed.handoff.decisions, ["先做最小切片"]);
assert.equal(sealed.handoff.kvHints.next, "执行房间领取");
assert.equal(sealed.handoff.kvHints.apiKey, undefined);
assert.equal(sealed.handoff.sections.goal, run.goal);
assert.equal(sealed.handoff.sections.constraints, "不外发");
assert.deepEqual(sealed.handoff.sections.activeFiles, ["lib/department.js", "server.js"]);
assert.equal(sealed.handoff.sections.acceptance, "npm test");
assert.equal(run.items[0].handoff.id, sealed.handoff.id);
assert.equal(run.handoffs[0].id, sealed.handoff.id);
assert.throws(() => dept.sealHandoff(store, run.id, { agentId: "chairman", itemId: run.items[1].id, summary: "董事长不写正文" }), /lead_required/);
assert.throws(() => dept.sealHandoff(store, run.id, { agentId: "cursor", itemId: run.items[1].id, summary: "复核人不能封印" }), /lead_required/);
assert.throws(() => dept.sealHandoff(store, run.id, { itemId: run.items[1].id, summary: "群聊粘贴", source: "chat" }), /handoff_must_be_tool_sealed/);
assert.throws(() => dept.sealHandoff(store, run.id, {
  itemId: run.items[1].id,
  summary: "文件过多",
  sections: { activeFiles: ["a", "b", "c", "d", "e", "f"] },
}), /active_files_limit/);

const openRun = v2(store, "第一次可以开始");
seedAttempts(store, openRun, openRun.items[0], 2);
dept.startItem(store, openRun.id, openRun.items[0].id);
assert.equal(openRun.items[0].status, "doing");
assert.equal(openRun.items[0].circuitBreaker.exhausted, false);

const blocked = v2(store, "第四次必须阻断");
const director = blocked.items[0];
seedAttempts(store, blocked, director, 3);
assert.throws(() => dept.assertRoomAttempt(store, blocked, director), (err) => {
  assert.equal(err.message, "execution_budget_exhausted");
  assert.match(err.reason, /第 4 次/);
  return true;
});
assert.throws(() => dept.startItem(store, blocked.id, director.id), /execution_budget_exhausted/);
assert.equal(director.status, "queued");
assert.equal(director.attempts || 0, 0);
assert.throws(() => dept.sealHandoff(store, blocked.id, { itemId: director.id, summary: "再派一次", dispatch: true }), /execution_budget_exhausted/);
assert.equal(director.handoff, null);
const noted = dept.sealHandoff(store, blocked.id, { itemId: director.id, summary: "记下阻断，不再派发" });
assert.equal(noted.handoff.sealed, true);
assert.match(noted.handoff.sections.blockers, /第 4 次/);
assert.equal(noted.circuitBreaker.exhausted, true);

const root = fs.mkdtempSync(path.join(os.tmpdir(), "bench-v2-collab-"));
process.env.BENCH_DATA_DIR = root;
const { createServer, readStore, writeStore } = require("../server");

(async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function call(method, route, body) {
    const response = await fetch(base + route, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const result = await response.json();
    return { status: response.status, result };
  }
  try {
    const created = await call("POST", "/api/departments/runs", {
      goal: "HTTP v2 部门协作",
      context: "只记台账",
      v2: true,
      participantAgentIds: ["codex", "cursor", "workbuddy"],
      delivery: { mode: "text" },
    });
    assert.equal(created.status, 201, JSON.stringify(created.result));
    assert.equal(created.result.collabVersion, 2);
    const org = await call("GET", `/api/departments/runs/${created.result.id}/org`);
    assert.equal(org.status, 200);
    assert.equal(org.result.boss.orgRole, "boss");
    assert.equal(org.result.lead.orgRole, "lead");
    assert.equal(org.result.rooms.length, 3);
    const old = await call("POST", "/api/departments/runs", { goal: "HTTP 旧工作链", delivery: { mode: "text" } });
    assert.equal(old.result.collabVersion, 1);
    const rejected = await call("POST", `/api/departments/runs/${old.result.id}/handoff`, {
      itemId: old.result.items[0].id,
      summary: "旧链拒绝",
    });
    assert.equal(rejected.status, 400);
    assert.equal(rejected.result.error, "v2_run_required");
    const handoff = await call("POST", `/api/departments/runs/${created.result.id}/handoff`, {
      itemId: created.result.items[0].id,
      summary: "HTTP 封印",
      decisions: ["保持旧接口"],
      openQuestions: ["无"],
    });
    assert.equal(handoff.status, 201, JSON.stringify(handoff.result));
    assert.equal(handoff.result.handoff.toolSealed, true);
    assert.equal(handoff.result.handoff.sections.goal, "HTTP v2 部门协作");
    const chat = await call("POST", `/api/departments/runs/${created.result.id}/handoff`, {
      itemId: created.result.items[1].id,
      summary: "来自群聊",
      source: "chat",
    });
    assert.equal(chat.status, 403);
    assert.equal(chat.result.error, "handoff_must_be_tool_sealed");
    const boss = await call("POST", `/api/departments/runs/${created.result.id}/handoff`, {
      agentId: "chairman",
      itemId: created.result.items[1].id,
      summary: "董事长直接写",
    });
    assert.equal(boss.status, 403);
    assert.equal(boss.result.error, "lead_required");
    const disk = readStore();
    const httpRun = disk.departmentRuns.find((item) => item.id === created.result.id);
    const lead = httpRun.items.find((item) => item.orgRole === "lead");
    seedAttempts(disk, httpRun, lead, 3);
    writeStore(disk);
    const blockedHttp = await call("POST", `/api/departments/runs/${httpRun.id}/handoff`, {
      itemId: lead.id,
      summary: "第四次派发",
      dispatch: true,
    });
    assert.equal(blockedHttp.status, 409);
    assert.equal(blockedHttp.result.error, "execution_budget_exhausted");
    assert.match(blockedHttp.result.reason, /第 4 次/);
    const after = readStore().departmentRuns.find((item) => item.id === httpRun.id);
    assert.equal(after.items.find((item) => item.id === lead.id).handoff.summary, "HTTP 封印");
    const classicOrg = await call("GET", `/api/departments/runs/${old.result.id}/org`);
    assert.equal(classicOrg.result.collabVersion, 1);
    assert.equal(classicOrg.result.rooms.length, 3);
    console.log("v2 department collaboration checks passed.");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
