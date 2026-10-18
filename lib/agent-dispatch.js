"use strict";
const { inactive } = require("./archive");
const { id, nowIso } = require("./default-store");
const { postMessage } = require("./collaboration");
const { getRun, getItem, startItem } = require("./department");
const gov = require('./execution-governance');
const MEMBERS = new Set(["cursor", "workbuddy"]);
function syncAssignments(store) {
  store.inbox ||= [];
  let changed = false;
  const validRuns = new Set((store.departmentRuns || []).map(run => run.id));
  const count = store.inbox.length;
  store.inbox = store.inbox.filter(message => !message.departmentItemId || validRuns.has(message.runId));
  if (count !== store.inbox.length) changed = true;
  for (const run of store.departmentRuns || []) {
    if (inactive(run) || run.status === "completed") continue;
    for (const item of run.items || []) {
      if (!MEMBERS.has(item.ownerAgentId) || inactive((store.agents||[]).find(a=>a.id===item.ownerAgentId))) continue;
      const existing = store.inbox.find(m => m.departmentItemId === item.id && m.runId === run.id);
      if (existing && (item.status === "done" || (item.role === "reviewer" && item.status === "blocked" && item.review)) && existing.status !== "done") {
        existing.status = "done"; existing.completedAt = nowIso(); changed = true;
      }
      if (!["queued", "rework"].includes(item.status)) continue;
      if (existing && existing.status !== "done" && existing.toAgentId === item.ownerAgentId) continue;
      const message = {
        id: id("in"), from: "codex", toAgentId: item.ownerAgentId,
        runId: run.id, departmentItemId: item.id, relatedId: item.id,
        status: "queued", createdAt: nowIso(),
        body: `正式项目任务：${run.title}\n房间：${run.id}\n阶段：${item.role} / ${item.id}\n目标：${run.goal}\n约束：${run.context}\n主管方案：${getItem(run,"director").output || "待主管方案"}\n阶段要求：${item.instruction}\n原件未读之前不得声称已核验；先读取相关项目材料，报告来源与缺口。`,
      };
      if (existing) Object.assign(existing, message, { id: existing.id });
      else store.inbox.unshift(message);
      postMessage(store, { runId: run.id, sender: "codex", recipient: item.ownerAgentId, type: "task_assignment", relatedTaskId: item.id, text: `已发布正式任务给 ${item.ownerAgentId}；等待成员领取。\n${item.instruction}` });
      changed = true;
    }
  }
  return changed;
}
function claim(store, { agentId, runId, attemptId, idempotencyKey }) {
  if (!MEMBERS.has(agentId)) throw new Error("unsupported_member");
  const run = getRun(store, runId);
  if (inactive(run) || inactive((store.agents||[]).find(a=>a.id===agentId))) throw new Error("project_archived");
  gov.assertRun(store,run,agentId);
  if(attemptId){const a=gov.get(store,attemptId);if(a.runId!==runId||a.agentId!==agentId)throw gov.error('result_identity_mismatch');
    if(a.claimKey===idempotencyKey&&idempotencyKey&&['claimed','running'].includes(a.state)){gov.check(store,a);return {message:(store.inbox||[]).find(m=>m.runId===runId&&m.departmentItemId===a.stepId),item:getItem(run,a.stepId),attemptId:a.id,claimId:a.claimId,leaseExpiresAt:a.leaseExpiresAt};}}
  if(!attemptId&&idempotencyKey){const a=(store.executionAttempts||[]).find(a=>a.runId===runId&&a.agentId===agentId&&a.claimKey===idempotencyKey);if(a){if(!['claimed','running'].includes(a.state))throw gov.error('attempt_interrupted');gov.check(store,a);return {message:(store.inbox||[]).find(m=>m.runId===runId&&m.departmentItemId===a.stepId),item:getItem(run,a.stepId),attemptId:a.id,claimId:a.claimId,leaseExpiresAt:a.leaseExpiresAt};}}
  syncAssignments(store);
  const message = store.inbox.find(m => !inactive(m) && m.runId === runId && m.toAgentId === agentId && m.departmentItemId && m.status === "queued");
  if (!message) return null;
  const item = getItem(run, message.departmentItemId);
  if (item.ownerAgentId !== agentId) throw new Error("assignment_changed");
  let attempt=(store.executionAttempts||[]).find(a=>a.runId===runId&&a.stepId===item.id&&gov.ACTIVE.has(a.state));
  if(attemptId&&attempt?.id!==attemptId)throw gov.error('result_identity_mismatch');
  attempt ||= gov.reserve(store,{runId,stepId:item.id,agentId,jobId:'manual-'+id('claim'),transport:'manual-member'});
  gov.claim(store,attempt,{claimKey:idempotencyKey||'legacy:'+message.id,workerId:agentId});
  message.status = "ack"; message.ackAt = nowIso();
  postMessage(store, { runId, sender: agentId, type: "ack", relatedTaskId: item.id, text: "已通过领取接口收悉正式任务。" });
  if (item.status !== "rework") startItem(store, runId, item.id);
  else {
    item.attempts = Number(item.attempts || 0) + 1;
    item.startedAt = nowIso();
    item.updatedAt = nowIso();
  }
  message.status = "doing"; message.startedAt = nowIso();
  return { message, item, attemptId:attempt.id,claimId:attempt.claimId,leaseExpiresAt:attempt.leaseExpiresAt };
}
module.exports = { syncAssignments, claim };
