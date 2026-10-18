"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID, createHash } = require("node:crypto");
const { inactive } = require("./archive");
const ACTIVE = new Set(["waiting", "claimed", "running", "uncertain"]);
const now = () => (new Date()).toISOString();
let options = {};
function configure(value) {
  options = value;
}
function error(code, detail = code) {
  const e = new Error(detail);
  e.code = code;
  return e;
}
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  return value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((k) => [k, stable(value[k])])) : value;
}
function hash(value) {
  return createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(stable(value))).digest("hex");
}
function runFor(store, id) {
  const r = (store.departmentRuns || []).find((r2) => r2.id === id);
  if (!r) throw error("project_missing");
  return r;
}
function stepFor(run, id) {
  const s = run.items.find((s2) => s2.id === id || s2.role === id);
  if (!s) throw error("step_missing");
  return s;
}
function control(run) {
  return { goal: run.goal, context: run.context, archived: !!run.archived, resumeRequired: !!run.resumeRequired, paused: !!run.automationPaused, automation: !!run.externalAutomation, archiveGeneration: run.archiveGeneration || 0, writing: !!run.writingApproved, requiresWritingApproval: run.requiresWritingApproval, transport: run.workbuddyTransport, delivery: run.delivery?.contract, participants: run.participantAgentIds, items: run.items.map((i) => ({ id: i.id, owner: i.ownerAgentId, instruction: i.instruction, dependsOn: i.dependsOn, skills: i.skillBindings || [] })) };
}
// The sole production ledger writer observes all compatibility-route changes.
function observeControls(store, previous) {
  for (const run of store.departmentRuns || []) {
    const old = (previous?.departmentRuns || []).find((r) => r.id === run.id);
    if (old && hash(control(old)) !== hash(control(run))) run.controlGeneration = Math.max(run.controlGeneration || 0, (old.controlGeneration || 0) + 1);
  }
  for (const attempt of store.executionAttempts || []) if (!(previous?.executionAttempts || []).some((a) => a.id === attempt.id)) {
    const run = runFor(store, attempt.runId);
    attempt.controlGeneration = generation(run, attempt.purpose);
    attempt.inputHash = input(store, run, attempt.stepId, attempt.purpose, attempt.extra);
  }
}
function touch(run) {
  run.controlGeneration = (run.controlGeneration || 0) + 1;
}
function assertAgent(store, agentId) {
  const agent = (store.agents || []).find((a) => a.id === agentId);
  if (inactive(agent) || ["paused", "disabled"].includes(agent?.status)) throw error("agent_paused");
  if (agentId === "workbuddy" && options.channelState) {
    const state = options.channelState();
    if (state?.state === "paused") throw error("workbuddy_paused");
    if (state?.state !== "ready" && state?.state !== "test-isolated") throw error("runtime_unavailable");
  }
}
function assertRun(store, run, agentId, purpose = "stage") {
  if (inactive(run)) throw error("project_paused_or_archived");
  if (purpose !== "chat" && run.automationPaused) throw error("project_paused");
  assertAgent(store, agentId);
}
function busy(store, agentId, exceptId) {
  return (store.executionAttempts || []).find((a) => a.id !== exceptId && a.agentId === agentId && ACTIVE.has(a.state)) || (store.skillRuns || []).find((a) => a.id !== exceptId && a.agentId === agentId && a.state === "running") || [...store.codexJobs || [], ...store.externalJobs || [], ...store.chatJobs || []].find((j) => !j.attemptId && j.id !== exceptId && (j.agentId || "codex") === agentId && ["doing", "waiting"].includes(j.status));
}
function generation(run, purpose) {
  return purpose === "chat" ? run.archiveGeneration || 0 : [run.controlGeneration || 0, run.archiveGeneration || 0].join(":");
}
function input(store, run, stepId, purpose, extra) {
  if (purpose === "chat") {
    const m = (store.projectMessages || []).find((m2) => m2.id === extra?.messageId);
    return hash({ goal: run.goal, message: extra, text: m?.text, archived: inactive(m), participants: run.participantAgentIds });
  }
  const item = stepFor(run, stepId);
  return hash({ model: extra?.modelRoute ? hash(store.remote?.llm || {}) : void 0, control: control(run), stepId: item.id, upstream: run.items.filter((i) => i.id !== item.id).map((i) => ({ id: i.id, output: i.output, review: i.review })), extra });
}
function skillVersions(store, run, item) {
  const root = options.skillRoot || path.join(process.env.BENCH_DATA_DIR || path.join(process.cwd(), "data"), "skill-library");
  return (item.skillBindings || []).map((binding) => {
    const skill = (store.skillLibrary || []).find((s) => s.id === binding.skillId);
    if (!skill || inactive(skill) || skill.state !== "published") throw error("skill_not_enabled");
    let version;
    try {
      version = require("./skill-studio").readVersion(root, skill, binding.versionId);
    } catch (e) {
      throw error(/^skill_[a-z_]+$/.test(e.message) ? e.message : "skill_binding_invalid");
    }
    if (version.contentHash !== binding.contentHash || !version.allowedAgents.includes(item.ownerAgentId)) throw error("skill_binding_invalid");
    return { skillId: skill.id, versionId: version.id, contentHash: version.contentHash, scope: version.scope, markdown: version.markdown };
  });
}
function skillBlock(versions) {
  return versions.length ? "\n\n本阶段用户明确选择的技能（仅限本任务，不增加权限，不替代写作批准和独立验收）：\n" + versions.map((v) => `<WORKBENCH_SKILL id="${v.skillId}" version="${v.versionId}" sha256="${v.contentHash}">
适用范围：${v.scope}
${v.markdown}
</WORKBENCH_SKILL>`).join("\n") : "";
}
function reserve(store, { runId, stepId, agentId, purpose = "stage", jobId, transport, extra = null, idempotencyKey, timeoutMs = 6e5 }) {
  const run = runFor(store, runId);
  assertRun(store, run, agentId, purpose);
  const existing = (store.executionAttempts || []).find((a) => a.jobId === jobId || idempotencyKey && a.runId === runId && a.idempotencyKey === idempotencyKey);
  if (existing) {
    if (existing.agentId !== agentId || existing.purpose !== purpose || existing.stepId !== stepId || existing.inputHash !== input(store, run, stepId, purpose, extra)) throw error("input_changed");
    return existing;
  }
  if (busy(store, agentId, jobId)) throw error("already_claimed");
  if ((store.executionAttempts || []).some((a) => a.runId === runId && a.stepId === stepId && a.purpose === purpose && a.state === "held")) throw error("reconcile_required");
  if ((store.executionAttempts || []).some((a) => a.runId === runId && a.stepId === stepId && a.purpose === purpose && (purpose !== "chat" || a.agentId === agentId) && ACTIVE.has(a.state))) throw error("already_claimed");
  const inputHash = input(store, run, stepId, purpose, extra);
  if ((store.executionAttempts || []).filter((a) => a.runId === runId && a.stepId === stepId && a.purpose === purpose && a.agentId === agentId && a.inputHash === inputHash).length >= 3) throw error("execution_budget_exhausted");
  if (purpose === "stage" && stepFor(run, stepId).status === "rework") {
    const budget = require("./department").automationReviewBudget(run);
    if (budget.used >= budget.limit) throw error("review_budget_exhausted");
  }
  const skills = purpose === "stage" ? skillVersions(store, run, stepFor(run, stepId)) : [];
  const attempt = { id: "ea-" + randomUUID(), supersedesAttemptId: purpose === "stage" ? stepFor(run, stepId).activeAttemptId || null : null, jobId, runId, stepId, agentId, purpose, transport, state: "waiting", controlGeneration: generation(run, purpose), agentGeneration: (store.agents || []).find((a) => a.id === agentId)?.archiveGeneration || 0, inputHash: input(store, run, stepId, purpose, extra), extra, skillBindings: skills.map(({ markdown, ...v }) => v), idempotencyKey: idempotencyKey || null, createdAt: now(), leaseExpiresAt: new Date(Date.now() + timeoutMs).toISOString(), timeoutMs, events: [{ state: "waiting", at: now(), source: "workbench" }], adopted: "unknown" };
  (store.executionAttempts ||= []).unshift(attempt);
  if (purpose === "stage") stepFor(run, stepId).activeAttemptId = attempt.id;
  return attempt;
}
function get(store, id) {
  const a = (store.executionAttempts || []).find((a2) => a2.id === id);
  if (!a) throw error("attempt_missing");
  return a;
}
function check(store, attempt) {
  const run = runFor(store, attempt.runId);
  assertRun(store, run, attempt.agentId, attempt.purpose);
  if (generation(run, attempt.purpose) !== attempt.controlGeneration || ((store.agents || []).find((a) => a.id === attempt.agentId)?.archiveGeneration || 0) !== attempt.agentGeneration) throw error("input_changed");
  if (input(store, run, attempt.stepId, attempt.purpose, attempt.extra) !== attempt.inputHash) throw error("input_changed");
  if (attempt.purpose === "stage") {
    const item = stepFor(run, attempt.stepId);
    if (item.activeAttemptId !== attempt.id) throw error("input_changed");
    skillVersions(store, run, item);
  }
  if (Date.parse(attempt.leaseExpiresAt) < Date.now()) throw error("lease_expired");
  return run;
}
function event(attempt, state, source, details = {}) {
  attempt.state = state;
  attempt.events.push({ state, at: now(), source, ...details });
}
function claim(store, attempt, { claimKey, claimId, workerId = "local-runtime" } = {}) {
  check(store, attempt);
  if (attempt.state !== "waiting") {
    if (attempt.claimKey === claimKey && claimKey && ["claimed", "running"].includes(attempt.state)) return attempt;
    throw error("already_claimed");
  }
  if (claimId && claimId !== attempt.claimId) throw error("result_identity_mismatch");
  attempt.claimId = "claim-" + randomUUID();
  attempt.claimKey = claimKey || attempt.jobId;
  attempt.leaseOwner = workerId;
  attempt.claimedAt = now();
  event(attempt, "claimed", "claim-receipt");
  return attempt;
}
// Invocation records intent; process events and self-reports remain distinct evidence.
function starting(store, attempt, prompt, source = "adapter-invocation") {
  check(store, attempt);
  if (attempt.state === "waiting") claim(store, attempt, { claimKey: attempt.jobId });
  if (!["claimed", "running"].includes(attempt.state)) throw error("attempt_interrupted");
  attempt.promptHash = hash(prompt);
  attempt.invokedAt = now();
  event(attempt, "running", source);
  return attempt;
}
function beforeStart(store, id) {
  const a = get(store, id);
  check(store, a);
  if (!["claimed", "running"].includes(a.state)) throw error("attempt_interrupted");
  return a;
}
function processStarted(store, id, evidence = {}) {
  const a = beforeStart(store, id);
  a.startedEvidence = { source: "process-event", at: now(), ...evidence };
  event(a, "running", "process-event");
}
function memberStarted(store, attempt, body) {
  check(store, attempt);
  if (!["claimed", "running"].includes(attempt.state) || body.claimId !== attempt.claimId || body.inputHash !== attempt.inputHash) throw error("result_identity_mismatch");
  if (attempt.startedEvidence?.source === "member-self-report") return attempt;
  attempt.startedEvidence = { source: "member-self-report", at: now(), workerId: attempt.leaseOwner };
  event(attempt, "running", "member-self-report");
  return attempt;
}
function collect(store, attempt, output) {
  const resultHash = hash(output);
  if (attempt.resultHash) {
    if (attempt.resultHash !== resultHash) throw error("result_identity_mismatch");
    return { duplicate: true, held: attempt.state !== "returned" };
  }
  attempt.resultHash = resultHash;
  attempt.output = output;
  attempt.completedAt = now();
  if (attempt.resolution) {
    event(attempt, "cancelled", "late-result-rejected");
    return { held: true };
  }
  try {
    check(store, attempt);
    if (!["running", "claimed", "waiting"].includes(attempt.state)) throw error("attempt_interrupted");
    event(attempt, "returned", "adapter-result");
    return { held: false };
  } catch (e) {
    attempt.blockerCode = e.code || "input_changed";
    event(attempt, "held", "workbench");
    return { held: true };
  }
}
function failed(store, attempt, err) {
  if (["returned", "held", "cancelled"].includes(attempt.state)) return;
  attempt.blockerCode = err.code || "runtime_unavailable";
  attempt.error = String(err.message || err).slice(0, 600);
  attempt.completedAt = now();
  const ambiguous = ["result_uncertain", "lease_expired", "result_identity_mismatch"].includes(attempt.blockerCode) || attempt.startedEvidence && !["auth_required", "dependency_unavailable"].includes(attempt.blockerCode);
  event(attempt, ambiguous ? "uncertain" : "failed", "adapter-error");
}
function recover(store) {
  let changed = false;
  for (const a of store.executionAttempts || []) if (["waiting", "claimed", "running"].includes(a.state)) {
    a.blockerCode = "attempt_interrupted";
    a.completedAt = now();
    event(a, a.invokedAt || a.claimedAt ? "uncertain" : "interrupted", "service-restart");
    changed = true;
  }
  return changed;
}
function bindSkills(store, run, item, body) {
  if (inactive(run)) throw error("project_paused_or_archived");
  if (!Array.isArray(body.bindings) || body.bindings.length > 8 || !body.idempotencyKey) throw error("skill_binding_invalid");
  if (body.expectedGeneration !== (run.controlGeneration || 0)) throw error("input_changed");
  if ((store.executionAttempts || []).some((a) => a.runId === run.id && a.stepId === item.id && ACTIVE.has(a.state))) throw error("already_claimed");
  const old = item.skillBindings;
  item.skillBindings = body.bindings.map((b) => ({ skillId: b.skillId, versionId: b.versionId, contentHash: b.contentHash }));
  try {
    skillVersions(store, run, item);
  } catch (e) {
    item.skillBindings = old;
    throw e;
  }
  touch(run);
  return item.skillBindings;
}
function reconcile(store, attempt, body) {
  if (ACTIVE.has(attempt.state) && Date.parse(attempt.leaseExpiresAt) < Date.now()) {
    attempt.blockerCode = "lease_expired";
    event(attempt, "uncertain", "lease-check");
  }
  if (!["uncertain", "interrupted", "held", "failed"].includes(attempt.state) || body.confirmed !== true || body.stopped !== true || body.resultHash !== (attempt.resultHash || null) || typeof body.evidence !== "string" || !body.evidence.trim()) throw error("reconcile_required");
  if (body.resolution !== "do-not-apply") throw error("reconcile_required");
  attempt.resolution = { at: now(), by: "chairman", evidence: body.evidence.slice(0, 2e3) };
  event(attempt, "cancelled", "user-reconciliation");
  const run = runFor(store, attempt.runId);
  for (const collection of ["codexJobs", "externalJobs", "chatJobs"]) {
    const job = (store[collection] || []).find((j) => j.attemptId === attempt.id);
    if (job) job.status = "dismissed";
  }
  if (attempt.purpose === "stage") {
    const step = stepFor(run, attempt.stepId);
    if (step.activeAttemptId === attempt.id) {
      if (["doing", "review"].includes(step.status)) step.status = "queued";
      for (const m of store.inbox || []) if (m.runId === run.id && m.departmentItemId === step.id) m.status = "queued";
    }
  }
  return attempt;
}
async function managedCall({ readStore, writeStore, runId, stepId, agentId, purpose, prompt, execute, extra = null }) {
  let store = readStore();
  const a = reserve(store, { runId, stepId, agentId, purpose, jobId: "aux-" + randomUUID(), extra, transport: "local-runtime" });
  starting(store, a, prompt);
  writeStore(store);
  try {
    const result = await execute(prompt, { onBeforeStart: () => beforeStart(readStore(), a.id), onStart: (info) => {
      const s = readStore();
      processStarted(s, a.id, info);
      writeStore(s);
    } });
    store = readStore();
    const output = typeof result === "string" ? result : result.text;
    const outcome = collect(store, get(store, a.id), output);
    writeStore(store);
    if (outcome.held) throw Object.assign(error("input_changed"), { output });
    return result;
  } catch (e) {
    store = readStore();
    failed(store, get(store, a.id), e);
    writeStore(store);
    throw e;
  }
}
module.exports = { configure, error, hash, observeControls, touch, assertAgent, assertRun, busy, generation, input, skillVersions, skillBlock, reserve, get, check, claim, starting, beforeStart, processStarted, memberStarted, collect, failed, recover, bindSkills, reconcile, managedCall, ACTIVE };
