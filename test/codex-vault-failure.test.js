"use strict";
const assert = require("assert");
const { createManager } = require("../lib/codex-jobs");
const { buildDefaultStore } = require("../lib/default-store");
const { createDepartmentRun } = require("../lib/department");
(async () => {
  let store = buildDefaultStore();
  store.remote ||= {};
  store.remote.vault = { enabled: true };
  const run = createDepartmentRun(store, { goal: "拆解报告修订任务" });
  let called = false;
  const manager = createManager({
    readStore: () => structuredClone(store), writeStore: value => { store = structuredClone(value); },
    prepareEvidence: async () => { throw new Error("资料库返回 503"); },
    generate: async prompt => {
      called = true;
      assert.ok(prompt.includes("不能声称已阅读或核验原件"));
      return { text: "先读取政策原件，再开展报告修订。", threadId: "test" };
    },
  });
  manager.start({ runId: run.id, role: "director" });
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(called);
  assert.equal(store.codexJobs[0].status, "done");
  assert.ok(store.codexJobs[0].evidenceWarning.includes("503"));
  assert.ok(store.projectMessages.some(message => message.type === "blocker"));
  console.log("Codex director unavailable-vault regression passed");
})().catch(error => { console.error(error); process.exitCode = 1; });
