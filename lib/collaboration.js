"use strict";

const { id, nowIso } = require("./default-store");

const MESSAGE_TYPES = new Set([
  "goal", "task_assignment", "ack", "progress", "suggestion", "question",
  "blocker", "artifact", "review", "decision", "system",
]);

function ensureCollaboration(store) {
  if (!Array.isArray(store.projectMessages)) store.projectMessages = [];
  if (!Array.isArray(store.artifacts)) store.artifacts = [];
  return store;
}

function postMessage(store, body = {}) {
  ensureCollaboration(store);
  const runId = String(body.runId || "").trim();
  const text = String(body.text || "").trim();
  if (!runId) throw new Error("run_id_required");
  if (!text) throw new Error("message_text_required");
  const type = MESSAGE_TYPES.has(body.type) ? body.type : "progress";
  const message = {
    id: id("msg"), runId, sender: String(body.sender || "chairman"),
    recipient: String(body.recipient || "all"), type, text,
    relatedTaskId: body.relatedTaskId ? String(body.relatedTaskId) : null,
    replyTo: body.replyTo ? String(body.replyTo) : null,
    status: "posted", createdAt: nowIso(),
  };
  store.projectMessages.unshift(message);
  return message;
}

function addArtifact(store, body = {}) {
  ensureCollaboration(store);
  const runId = String(body.runId || "").trim();
  const name = String(body.name || "").trim();
  const artifactPath = String(body.path || "").trim();
  if (!runId) throw new Error("run_id_required");
  if (!name || !artifactPath) throw new Error("artifact_name_and_path_required");
  const artifact = {
    id: id("art"), runId,
    taskId: body.taskId ? String(body.taskId) : null,
    name, path: artifactPath, createdBy: String(body.createdBy || "chairman"),
    version: Math.max(1, Number(body.version) || 1),
    sha256: String(body.sha256 || ""), status: "submitted",
    reviewStatus: "pending", createdAt: nowIso(), updatedAt: nowIso(),
  };
  store.artifacts.unshift(artifact);
  return artifact;
}

function messagesFor(store, runId) {
  ensureCollaboration(store);
  return store.projectMessages.filter((item) => item.runId === runId);
}

function artifactsFor(store, runId) {
  ensureCollaboration(store);
  return store.artifacts.filter((item) => item.runId === runId);
}

module.exports = { MESSAGE_TYPES, ensureCollaboration, postMessage, addArtifact, messagesFor, artifactsFor };
