"use strict";

const assert = require("assert");
const { buildDefaultStore } = require("../lib/default-store");
const { ensureCollaboration, postMessage, addArtifact, messagesFor, artifactsFor } = require("../lib/collaboration");
const { createDepartmentRun } = require("../lib/department");

const store = buildDefaultStore();
ensureCollaboration(store);
const run = createDepartmentRun(store, { goal: "协作消息测试" });
const goal = postMessage(store, { runId: run.id, sender: "chairman", type: "goal", text: run.goal });
assert.equal(goal.type, "goal");
const suggestion = postMessage(store, { runId: run.id, sender: "workbuddy", type: "suggestion", text: "先检查风险" });
assert.equal(suggestion.recipient, "all");
assert.equal(messagesFor(store, run.id).length, 2);
const artifact = addArtifact(store, { runId: run.id, taskId: run.items[1].id, name: "result.md", path: "D:\\result.md", createdBy: "cursor" });
assert.equal(artifact.reviewStatus, "pending");
assert.equal(artifactsFor(store, run.id).length, 1);
assert.throws(() => postMessage(store, { runId: run.id }), /message_text_required/);
assert.throws(() => addArtifact(store, { runId: run.id, name: "missing" }), /artifact_name_and_path_required/);
console.log("Project collaboration message and artifact checks passed.");
