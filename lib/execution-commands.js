"use strict";
const gov = require("./execution-governance");
const { inactive } = require("./archive");
function receipt(store, scope, body) {
  if (typeof body.idempotencyKey !== "string" || !body.idempotencyKey || body.idempotencyKey.length > 100) throw gov.error("idempotency_key_required");
  const old = (store.executionCommands || []).find((r) => r.scope === scope && r.key === body.idempotencyKey);
  if (old && old.hash !== gov.hash(body)) throw gov.error("idempotency_conflict");
  return old?.result;
}
function remember(store, scope, body, result) {
  (store.executionCommands ||= []).push({ scope, key: body.idempotencyKey, hash: gov.hash(body), result, at: (new Date()).toISOString() });
  return result;
}
function field(value, max) {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw gov.error("conversion_fields_required");
  return value.trim();
}
function preview(store, inboxId, body) {
  const message = (store.inbox || []).find((m) => m.id === inboxId);
  if (!message || inactive(message) || message.runId || message.departmentItemId) throw gov.error("ordinary_message_required");
  const goal = field(body.goal, 16e3), deliverable = field(body.deliverable, 3e3), acceptance = field(body.acceptance, 3e3);
  if (!["cursor", "workbuddy"].includes(body.ownerAgentId) || !["codex", "cursor", "workbuddy"].includes(body.reviewerAgentId) || body.ownerAgentId === body.reviewerAgentId) throw gov.error("independent_reviewer_required");
  for (const agentId of [body.ownerAgentId, body.reviewerAgentId]) if (!(store.agents || []).some((a) => a.id === agentId && !inactive(a))) throw gov.error("agent_unavailable");
  const parentRef = body.parentRef || null;
  if (parentRef) {
    const collection = { module: "modules", "department-run": "departmentRuns" }[parentRef.kind];
    if (!collection || !(store[collection] || []).some((r) => r.id === parentRef.id && !inactive(r))) throw gov.error("parent_project_invalid");
  }
  const draft = { goal, deliverable, acceptance, ownerAgentId: body.ownerAgentId, reviewerAgentId: body.reviewerAgentId, parentRef, requiresWritingApproval: body.requiresWritingApproval !== false };
  return { draft, source: { id: message.id, body: message.body, status: message.status }, snapshot: gov.hash({ draft, message: { id: message.id, body: message.body, status: message.status, convertedRunId: message.convertedRunId } }) };
}
function convert(store, inboxId, body) {
  const scope = "convert:" + inboxId, old = receipt(store, scope, body);
  if (old) return old;
  const plan = preview(store, inboxId, body), message = store.inbox.find((m) => m.id === inboxId);
  if (message.convertedRunId) throw gov.error("message_already_converted");
  if (body.confirmed !== true || body.snapshot !== plan.snapshot) throw gov.error("conversion_snapshot_changed");
  const { draft } = plan;
  const run = require("./department").createDepartmentRun(store, { goal: draft.goal, context: `交付物：${draft.deliverable}
验收要求：${draft.acceptance}
来源留言：${message.id}`, participantAgentIds: ["codex", "cursor", "workbuddy"], requiresWritingApproval: draft.requiresWritingApproval });
  run.items.find((i) => i.role === "executor").ownerAgentId = draft.ownerAgentId;
  run.items.find((i) => i.role === "reviewer").ownerAgentId = draft.reviewerAgentId;
  run.parentProjectRef = draft.parentRef;
  run.sourceInboxId = message.id;
  run.automationPaused = true;
  run.externalAutomation = false;
  message.convertedRunId = run.id;
  message.conversionAt = (new Date()).toISOString();
  return remember(store, scope, body, { runId: run.id, paused: true });
}
module.exports = { receipt, remember, preview, convert };
