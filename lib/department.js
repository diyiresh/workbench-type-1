"use strict";

const { id, nowIso } = require("./default-store");
const { inactive } = require("./archive");
const { postMessage, addArtifact } = require("./collaboration");
const delivery = require("./delivery");
const gov = require('./execution-governance');

const AUTOMATION_REVIEW_LIMIT = 3;

function automationReviewBudget(run) {
  const total = (run.discussion || []).filter(entry => entry.role === "reviewer" && String(entry.text || "").startsWith("退回返工：")).length;
  const recovery = (run.automationRecoveries || []).at(-1);
  const baseline = Number.isInteger(recovery?.rejectedReviewsBefore) && recovery.rejectedReviewsBefore >= 0 && recovery.rejectedReviewsBefore <= total
    ? recovery.rejectedReviewsBefore : 0;
  return { total, baseline, used: total - baseline, limit: AUTOMATION_REVIEW_LIMIT };
}

// 只由现有显式 retry 入口调用；普通启用、聊天、失败重试均不刷新审核额度。
function retryAutomation(store, runId) {
  const run = getRun(store, runId);
  if(inactive(run))throw new Error("project_paused_or_archived");
  const budget = automationReviewBudget(run);
  if((store.executionAttempts||[]).some(a=>a.runId===runId&&['uncertain','held','claimed','running'].includes(a.state)))throw gov.error('reconcile_required');
  if (run.automationPaused && budget.used >= budget.limit) {
    run.automationRecoveries ||= [];
    const recovery = { id: id("ar"), rejectedReviewsBefore: budget.total, createdAt: nowIso() };
    run.automationRecoveries.push(recovery);
    postMessage(store, { runId, sender: "codex", type: "system", text: `已收到显式重试请求，开启有界返工轮次 ${recovery.id}。保留此前 ${budget.total} 条退回意见；本轮新增退回达到 ${budget.limit} 次后再次暂停。` });
  }
  if(run.automationPaused)gov.touch(run);
  run.automationPaused = false;
  if (run.preparationFlow?.status === "failed") delete run.preparationFlow;
  for (const job of [...store.externalJobs || [], ...store.codexJobs || []]) {
    if (job.runId === runId && ['failed','held'].includes(job.status)) job.status = "dismissed";
  }
  run.updatedAt = nowIso();
  return automationReviewBudget(run);
}

const ROLE_LABELS = {
  director: "部门主管",
  executor: "主执行人",
  reviewer: "独立复核人",
  secretary: "整合秘书",
};

const ITEM_ORDER = ["director", "executor", "reviewer", "secretary"];

function defaultDepartment() {
  return {
    id: "dept-virtual-office",
    name: "虚拟部门",
    purpose: "接收一个目标，组织计划、执行、独立复核与最终汇总。",
    roles: ITEM_ORDER.map((role) => ({ role, label: ROLE_LABELS[role] })),
    approvalPolicy: {
      localReversible: "auto",
      externalSend: "chairman",
      destructive: "chairman",
      paidApi: "chairman",
    },
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

function ensureDepartmentSystem(store) {
  if (!Array.isArray(store.departments)) store.departments = [];
  if (!store.departments.some((item) => item.id === "dept-virtual-office")) {
    store.departments.unshift(defaultDepartment());
  }
  if (!Array.isArray(store.departmentRuns)) store.departmentRuns = [];
  return store;
}

function activeAgents(store) {
  return (store.agents || []).filter((agent) => agent.status === "active" && !inactive(agent));
}

function chooseAgent(store, role, excluded = []) {
  const agents = store.agents || [];
  const available = agents.filter((agent) => !excluded.includes(agent.id) && !inactive(agent));
  const preferred = {
    director: ["ollama", "deepseek", "cursor", "workbuddy"],
    executor: ["codex", "cursor", "workbuddy", "ollama"],
    reviewer: ["deepseek", "ollama", "cursor", "doubao"],
    secretary: ["workbuddy", "doubao", "ollama", "cursor"],
  }[role] || [];
  for (const agentId of preferred) {
    const match = available.find((agent) => agent.id === agentId && agent.status === "active");
    if (match) return match.id;
  }
  for (const agentId of preferred) {
    const match = available.find((agent) => agent.id === agentId);
    if (match) return match.id;
  }
  return (activeAgents(store).find((agent) => !excluded.includes(agent.id)) || available[0] || {}).id || "";
}

function chooseParticipant(store, preferred, participants, excluded = []) {
  const allowed = (participants || []).filter((agentId) => !excluded.includes(agentId) && (store.agents || []).some((agent) => agent.id === agentId && !inactive(agent)));
  if (preferred && allowed.includes(preferred)) return preferred;
  return allowed[0] || chooseAgent(store, "secretary", excluded);
}

function createItem(store, runId, role, index, ownerAgentId) {
  return {
    id: id("di"),
    runId,
    role,
    label: ROLE_LABELS[role],
    ownerAgentId,
    engine: "current-model",
    status: index === 0 ? "queued" : "blocked",
    dependsOn: index ? [ITEM_ORDER[index - 1]] : [],
    instruction: "",
    output: "",
    materials: [],
    review: null,
    attempts: 0,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

function createDepartmentRun(store, input = {}) {
  ensureDepartmentSystem(store);
  const goal = String(input.goal || "").trim();
  if (!goal) throw new Error("goal_required");
  const runId = id("dr");
  const participants = Array.isArray(input.participantAgentIds)
    ? [...new Set(input.participantAgentIds.map(String))].filter((agentId) => (store.agents || []).some((agent) => agent.id === agentId))
    : [];
  const director = participants.length ? chooseParticipant(store, "codex", participants) : chooseAgent(store, "director");
  const executor = participants.length ? chooseParticipant(store, "workbuddy", participants, [director]) : chooseAgent(store, "executor", [director]);
  const reviewer = participants.length ? chooseParticipant(store, "cursor", participants, [executor]) : chooseAgent(store, "reviewer", [executor]);
  const secretary = participants.length ? chooseParticipant(store, "codex", participants, [reviewer]) : chooseAgent(store, "secretary", [reviewer]);
  const owners = { director, executor, reviewer, secretary };
  const run = {
    id: runId,
    departmentId: "dept-virtual-office",
    title: String(input.title || goal).trim().slice(0, 80),
    goal,
    context: String(input.context || "").trim(),
    participantAgentIds: participants.length ? participants : [...new Set([director, executor, reviewer, secretary].filter(Boolean))],
    room: { type: "project", status: "active", inputEnabled: true },
    status: "planning",
    planningMode: "rule-based",
    requiresWritingApproval: input.requiresWritingApproval !== false,
    workbuddyTransport: "desktop-scheduled",
    currentRole: "director",
    items: ITEM_ORDER.map((role, index) => createItem(store, runId, role, index, owners[role])),
    discussion: [{ id: id("dd"), role: "chairman", text: goal, createdAt: nowIso() }],
    artifacts: [],
    approvals: [],
    finalOutput: "",
    delivery: input.delivery ? { contract: delivery.contract(input.delivery), state: input.delivery.mode === "files" ? "pending" : "text", artifactIds: [] } : undefined,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  if (!input.delivery && /(?:\bdocx\b|\bword\b|输出.{0,12}文件|导出.{0,12}文件|生成.{0,12}文件)/i.test(goal)) {
    run.delivery = { contract: { mode: "undecided" }, state: "awaiting_configuration", artifactIds: [] };
  }
  run.items[0].instruction = `把董事长目标拆成可验证的执行方案：${goal}`;
  run.items[1].instruction = "根据主管方案完成主要产出，并列明已完成内容、证据和未决风险。";
  run.items[2].instruction = "独立检查执行成果是否满足原目标；必须给出通过或退回，以及具体理由。";
  run.items[3].instruction = "整合原目标、执行成果与复核结论，形成董事长可直接使用的最终交付。";
  store.departmentRuns.unshift(run);
  return run;
}

function getRun(store, runId) {
  ensureDepartmentSystem(store);
  const run = store.departmentRuns.find((item) => item.id === runId);
  if (!run) throw new Error("department_run_not_found");
  return run;
}

function getItem(run, itemIdOrRole) {
  const item = run.items.find((entry) => entry.id === itemIdOrRole || entry.role === itemIdOrRole);
  if (!item) throw new Error("department_item_not_found");
  return item;
}

function dependenciesDone(run, item) {
  if (item.role === "reviewer" && delivery.required(run) && !["files_ready", "reviewed", "accepted"].includes(run.delivery.state)) return false;
  return (item.dependsOn || []).every((role) => getItem(run, role).status === "done");
}

function unlockNext(run, store) {
  for (const item of run.items) {
    if (item.status === "blocked" && dependenciesDone(run, item)) item.status = "queued";
  }
  const current = run.items.find((item) => ["queued", "doing", "review", "rework"].includes(item.status));
  run.currentRole = current ? current.role : "";
  run.status = run.items.every((item) => item.status === "done") ? "completed" : run.items.some((item) => item.status === "rework") ? "rework" : "active";
  if (run.status === "completed" && run.delivery?.contract.mode === "undecided") run.status = "awaiting_delivery_configuration";
  delivery.refresh(store, run);
  run.updatedAt = nowIso();
  return run;
}

function startItem(store, runId, itemId) {
  const run = getRun(store, runId);
  if(inactive(run))throw new Error("project_paused_or_archived");
  const item = getItem(run, itemId);
  gov.assertRun(store,run,item.ownerAgentId);
  const active=(store.executionAttempts||[]).find(a=>a.id===item.activeAttemptId);
  if(active&&['held','uncertain'].includes(active.state))throw gov.error('reconcile_required');
  if (!["queued", "rework"].includes(item.status)) throw new Error("item_not_ready");
  if (!dependenciesDone(run, item) && item.status !== "rework") throw new Error("dependencies_not_done");
  if (item.role === "reviewer") delivery.assertReady(store, run);
  if (item.role === 'secretary' && delivery.required(run)) {
    delivery.assertReady(store, run);
    if (run.delivery.state !== 'reviewed') throw new Error('delivery_file_review_required');
  }
  item.status = "doing";
  item.attempts = Number(item.attempts || 0) + 1;
  item.startedAt = nowIso();
  item.updatedAt = nowIso();
  run.status = "active";
  run.currentRole = item.role;
  run.updatedAt = nowIso();
  return item;
}

function submitItem(store, runId, itemId, body = {}) {
  const run = getRun(store, runId);
  if(inactive(run))throw new Error("project_paused_or_archived");
  if(run.automationPaused)throw gov.error('project_paused');
  const item = getItem(run, itemId);
  if (!["doing", "rework"].includes(item.status)) throw new Error("item_not_in_progress");
  const output = String(body.output || "").trim();
  if (!output) throw new Error("output_required");
  if (item.role === "reviewer") throw new Error("reviewer_must_use_review_action");
  if (item.role === "secretary" && delivery.required(run) && run.delivery.state !== "reviewed") throw new Error("delivery_file_review_required");
  const materials = Array.isArray(body.materials) ? body.materials.filter(Boolean).map(String) : item.materials || [];
  materials.forEach(file => delivery.inspectFile(file));
  finishManualClaim(store,run,item,output);
  item.output = output;
  if (item.role === "executor" && delivery.required(run)) {
    run.delivery.state = "pending"; run.delivery.artifactIds = []; run.delivery.review = null;
  }
  item.materials = materials;
  item.completedAt = nowIso();
  item.updatedAt = nowIso();
  if (item.role === "executor") item.status = "done";
  else if (item.role === "reviewer") throw new Error("reviewer_must_use_review_action");
  else item.status = "done";
  run.discussion.push({ id: id("dd"), role: item.role, agentId: item.ownerAgentId, text: output, createdAt: nowIso() });
  if (item.materials.length) run.artifacts.push(...item.materials.map(file => {
    const artifact = addArtifact(store, { runId, taskId: item.id, name: require('path').basename(file), path: file, createdBy: item.ownerAgentId });
    return { id: artifact.id, itemId: item.id, path: file, createdAt: artifact.createdAt };
  }));
  if (item.role === "secretary") run.finalOutput = output;
  unlockNext(run, store);
  return item;
}

function reviewExecutor(store, runId, body = {}) {
  const run = getRun(store, runId);
  if(run.automationPaused)throw gov.error('project_paused');
  if(inactive(run))throw new Error("project_paused_or_archived");
  const executor = getItem(run, "executor");
  const reviewer = getItem(run, "reviewer");
  const reviewerAgentId = String(body.reviewerAgentId || reviewer.ownerAgentId || "");
  if (!reviewerAgentId || reviewerAgentId === executor.ownerAgentId) throw new Error("reviewer_must_be_independent");
  if (executor.status !== "done") throw new Error("executor_output_not_ready");
  if (!["queued", "doing"].includes(reviewer.status)) throw new Error("review_not_ready");
  const verdict = body.verdict === "pass" ? "pass" : body.verdict === "reject" ? "reject" : "";
  if (!verdict) throw new Error("review_verdict_required");
  const comment = String(body.comment || "").trim();
  if (delivery.required(run) && verdict === "pass") {
    delivery.reviewFiles(store, run, { reviewerAgentId, verdict, comment, reviewedSnapshot: body.reviewedSnapshot });
  }
  finishManualClaim(store,run,reviewer,comment);
  reviewer.ownerAgentId = reviewerAgentId;
  reviewer.output = comment;
  reviewer.review = { targetItemId: executor.id, verdict, comment, sourceHash: delivery.hash(String(executor.output || '').trim()), reviewedAt: nowIso() };
  reviewer.updatedAt = nowIso();
  run.discussion.push({ id: id("dd"), role: "reviewer", agentId: reviewerAgentId, text: `${verdict === "pass" ? "复核通过" : "退回返工"}：${comment}`, createdAt: nowIso() });
  if (verdict === "pass") {
    reviewer.status = "done";
    reviewer.completedAt = nowIso();
  } else {
    reviewer.status = "blocked";
    executor.status = "rework";
    executor.review = { verdict, comment, reviewedAt: nowIso(), reviewerAgentId };
    run.status = "rework";
    run.currentRole = "executor";
  }
  unlockNext(run, store);
  return reviewer.review;
}

function completeRework(store, runId, itemId, body = {}) {
  const run = getRun(store, runId);
  if(run.automationPaused)throw gov.error('project_paused');
  if(inactive(run))throw new Error("project_paused_or_archived");
  const item = getItem(run, itemId);
  if (item.role !== "executor" || item.status !== "rework") throw new Error("item_not_in_rework");
  const output = String(body.output || "").trim();
  if (!output) throw new Error("output_required");
  finishManualClaim(store,run,item,output);
  item.output = output;
  if (delivery.required(run)) { run.delivery.state = "pending"; run.delivery.artifactIds = []; run.delivery.review = null; }
  item.status = "done";
  item.updatedAt = nowIso();
  const reviewer = getItem(run, "reviewer");
  reviewer.status = "queued";
  reviewer.review = null;
  reviewer.output = "";
  const secretary = getItem(run, "secretary");
  if (secretary.status === "done") {
    run.finalOutputHistory ||= []; run.finalOutputHistory.push({ output: run.finalOutput, savedAt: nowIso() });
    secretary.status = "blocked"; run.finalOutput = "";
  }
  run.discussion.push({ id: id("dd"), role: "executor", agentId: item.ownerAgentId, text: `返工完成：${output}`, createdAt: nowIso() });
  if (delivery.required(run)) reviewer.status = "blocked";
  unlockNext(run, store);
  return item;
}

function rolePrompt(run, item, store) {
  const prior = run.items.filter((entry) => entry.output).map((entry) => `【${entry.label}】\n${entry.output}`).join("\n\n");
  const systems = {
    director: "你是虚拟部门的部门主管。请形成清晰、可验证、可交接的执行方案，不要假装已经完成工作。",
    executor: "你是虚拟部门的主执行人。请按方案完成可直接使用的主要产出，并显式列出证据、材料与风险。",
    reviewer: "你是独立复核人。你不得迎合执行人，必须依据原目标逐项检查，最后单独一行输出 VERDICT: PASS 或 VERDICT: REJECT。",
    secretary: "你是整合秘书。请把原目标、执行成果和复核意见合并为董事长可直接使用的最终交付，不要遗漏限制。",
  };
  return {
    system: systems[item.role],
    prompt: `原始目标：\n${run.goal}\n\n背景：\n${run.context || "无"}\n\n本阶段任务：\n${item.instruction}\n\n已有阶段成果：\n${prior || "尚无"}` + (store ? delivery.instruction(store, run, item.role) : ""),
  };
}

function finishManualClaim(store,run,item,output){const a=(store.executionAttempts||[]).find(a=>a.id===item.activeAttemptId);if(a&&['held','uncertain'].includes(a.state))throw gov.error('reconcile_required');if(a&&gov.ACTIVE.has(a.state)){if(a.transport!=='manual-member')throw gov.error('execution_owned');if(gov.collect(store,a,String(output||'')).held)throw gov.error('input_changed');}}

module.exports = {
  automationReviewBudget,
  retryAutomation,
  ROLE_LABELS,
  ITEM_ORDER,
  ensureDepartmentSystem,
  createDepartmentRun,
  getRun,
  getItem,
  startItem,
  submitItem,
  reviewExecutor,
  completeRework,
  rolePrompt,
};

