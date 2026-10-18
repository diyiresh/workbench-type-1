"use strict";
const { inactive } = require("./archive");
const codex = require("./codex");
const dept = require("./department");
const { id, nowIso } = require("./default-store");
const vault = require('./vault');
const { postMessage } = require('./collaboration');
const delivery = require('./delivery');
const gov = require('./execution-governance');
function createManager({ readStore, writeStore, generate = codex.generate, prepareEvidence = vault.prepareEvidence }) {
  const active = new Set();
  function recover() {
    const store = readStore(); let changed = false;
    for (const job of store.codexJobs || []) if (job.status === "doing") {
      job.status = "failed"; job.error = "服务重启中断了任务，可重新提交。"; job.completedAt = nowIso(); changed = true;
      if (job.runId) { const item = dept.getItem(dept.getRun(store, job.runId), job.role); if (item.status === "doing") item.status = "queued"; }
    }
    if (changed) writeStore(store);
  }
  function start({ runId, role, test = false, idempotencyKey }) {
    const key = runId || "test";
    const store = readStore(); store.codexJobs ||= [];
    if(idempotencyKey){const previous=(store.executionAttempts||[]).find(a=>a.runId===runId&&a.idempotencyKey===idempotencyKey);if(previous){if(dept.getItem(dept.getRun(store,runId),role).id!==previous.stepId||previous.agentId!=='codex')throw gov.error('input_changed');return store.codexJobs.find(j=>j.attemptId===previous.id);}}
    if (active.has(key)) return store.codexJobs.find(j => j.status === "doing" && (j.runId || "test") === key);
    if(test&&gov.busy(store,'codex'))throw gov.error('already_claimed');
    const jobId=id('cj');let attempt;
    let prompt = "收到请只回复：连接成功";
    let reviewedSnapshot = null;
    if (!test) {
      if (!["director", "reviewer", "secretary"].includes(role)) throw new Error("仅支持主管拆解、独立复核与最终整合。");
      const run = dept.getRun(store, runId), item = dept.getItem(run, role);
      if(inactive(run)||inactive((store.agents||[]).find(a=>a.id==="codex")))throw new Error("project_or_agent_paused_or_archived");
      if (item.status !== "queued") throw new Error("本阶段尚未就绪或已完成。");
      if (role === "reviewer" && dept.getItem(run, "executor").ownerAgentId === "codex") throw new Error("执行人为 Codex，需要另一位独立复核人。");
      if (role === 'reviewer') reviewedSnapshot = delivery.assertReady(store, run);
      item.ownerAgentId = "codex";
      const instructions = dept.rolePrompt(run, item, store);
      prompt = instructions.system + "\n" + instructions.prompt + (role === 'director' ? "\n请列明子任务、承办建议、交付物、依赖、验收标准与待用户决定事项。不要声称已经唤醒其他成员。" : role === 'secretary' && !delivery.required(run) ? "\n复核已通过，请根据实际执行成果及复核意见输出最终可用成果全文，明确验收结果及仍需用户决定的事项。禁止把过程说明替代最终成果，禁止编造未完成工作。" : "");
      if (role === "reviewer") prompt += "\n最终必须使用 VERDICT: PASS 或 VERDICT: REJECT 表示结论。缺少可核验证据时退回。";
      item.ownerAgentId = "codex"; item.engine = "codex-chatgpt";
      attempt=gov.reserve(store,{runId,stepId:item.id,agentId:'codex',jobId,transport:'codex-cli',idempotencyKey,timeoutMs:360000});
      prompt+=gov.skillBlock(gov.skillVersions(store,run,item));
      dept.startItem(store, runId, item.id);
    }
    const job = { id: jobId, attemptId:attempt?.id, agentId:'codex', runId: runId || "", role: test ? "test" : role, status: "doing", createdAt: nowIso(), output: "", error: "" };
    job.runArchiveGeneration = (store.departmentRuns||[]).find(r=>r.id===runId)?.archiveGeneration || 0;
    store.codexJobs.unshift(job); active.add(key); writeStore(store);
    Promise.resolve().then(async () => {
      if (!test && role !== 'secretary' && vault.config(store).enabled) {
        const run = dept.getRun(store, runId);
        let evidence;
        try { evidence = await prepareEvidence(store, run.goal, { timeoutMs: role === "director" ? 10000 : 120000 }); }
        catch (err) {
          if (role !== "director") throw Object.assign(err,{code:'dependency_unavailable'});
          const fresh = readStore();
          const warning = `前置资料库检索不可用：${err.message}。本次仅拆解任务，不能声称已阅读或核验原件。`;
          fresh.codexJobs.find(j => j.id === job.id).evidenceWarning = warning;
          postMessage(fresh, { runId, sender: "codex", type: "blocker", text: warning });
          writeStore(fresh);
          prompt += "\n" + warning + "\n安排执行成员读取本项目目标或约束明确指定的材料，核验来源及缺口。不要假定存在初稿、政策文件或其他未被指定的材料；按本项目验收标准推进。";
        }
        if (evidence) {
        prompt += vault.evidenceBlock(evidence);
        const fresh = readStore();
        fresh.codexJobs.find(j => j.id === job.id).evidence = vault.provenance(evidence);
        writeStore(fresh);
        }
      }
      if(!test){const fresh=readStore(),current=dept.getRun(fresh,runId);if(inactive(current)||(current.archiveGeneration||0)!==job.runArchiveGeneration)throw new Error("project_paused_or_archived");}
      if(attempt){const fresh=readStore();gov.starting(fresh,gov.get(fresh,attempt.id),prompt);writeStore(fresh);}
      return generate(prompt,{onBeforeStart:()=>{if(attempt)gov.beforeStart(readStore(),attempt.id);},onStart:info=>{if(attempt){const fresh=readStore();gov.processStarted(fresh,attempt.id,info);writeStore(fresh);}}});
    }).then(result => {
      const fresh = readStore(); const saved = fresh.codexJobs.find(j => j.id === job.id);
      if(attempt&&gov.collect(fresh,gov.get(fresh,attempt.id),result.text).held){saved.status='held';saved.output=result.text;saved.completedAt=nowIso();try{const stage=dept.getItem(dept.getRun(fresh,runId),role);if(stage.activeAttemptId===attempt.id&&stage.status==='doing')stage.status='queued';}catch{}writeStore(fresh);return;}
      saved.output=result.text;saved.threadId=result.threadId;writeStore(fresh);
      let completedItem = null;
      if (!test) {
        const run = dept.getRun(fresh, runId), item = dept.getItem(run, role);
        if(inactive(run) || (run.archiveGeneration||0)!==job.runArchiveGeneration){
          saved.status="held";saved.output=result.text;saved.threadId=result.threadId;saved.completedAt=nowIso();saved.error="Result retained; project was archived or paused.";
          if(item.status==="doing")item.status="queued";writeStore(fresh);return;
        }
        completedItem = item;
        if (item.status !== "doing" || item.ownerAgentId !== "codex") throw new Error("项目阶段已被其他操作改变，结果未覆盖原记录。");
        if (role === "reviewer") {
          const verdict = /VERDICT\s*:\s*PASS/i.test(result.text) && !/VERDICT\s*:\s*REJECT/i.test(result.text) && (!reviewedSnapshot || result.text.includes("FILE_REVIEW: " + reviewedSnapshot.batchId + " PASS")) ? "pass" : "reject";
          dept.reviewExecutor(fresh, runId, { reviewerAgentId: "codex", verdict, comment: result.text, reviewedSnapshot });
        } else dept.submitItem(fresh, runId, item.id, { output: result.text });
        run.planningMode = "model-assisted";
        if (saved.evidence) item.evidence = saved.evidence;
      }
      saved.status = "done"; saved.output = result.text; saved.threadId = result.threadId; saved.completedAt = nowIso();
      fresh.events.unshift({ id: id("ev"), type: "codex", agentId: "codex", text: test ? "Codex 真实连接测试成功" : "Codex 总管成果已自动保存", createdAt: nowIso() });
      if (!test) postMessage(fresh, { runId, sender: "codex", recipient: "all", type: role === "reviewer" ? "review" : "decision", relatedTaskId: completedItem && completedItem.id, text: result.text });
      writeStore(fresh);
    }).catch(err => {
      const fresh = readStore(), saved = fresh.codexJobs.find(j => j.id === job.id);
      if(attempt)gov.failed(fresh,gov.get(fresh,attempt.id),err);
      if(saved?.status==='held')return;
      saved.status = "failed"; saved.error = String(err.message || err); saved.completedAt = nowIso();
      if (runId) { const item = dept.getItem(dept.getRun(fresh, runId), role); if ((!attempt || item.activeAttemptId===attempt.id) && item.status === "doing" && item.ownerAgentId === "codex") item.status = "queued"; }
      writeStore(fresh);
    }).finally(() => active.delete(key));
    return job;
  }
  function tick() {
    const store=readStore();
    for(const run of store.departmentRuns||[]) {
      if(!run.externalAutomation||run.automationPaused||inactive(run)||run.status==='completed'||active.has(run.id))continue;
      const item=run.items.find(i=>i.status==='queued'&&i.ownerAgentId==='codex'&&['director','reviewer','secretary'].includes(i.role));
      if(!item||inactive((store.agents||[]).find(a=>a.id==="codex")))continue;
      if (delivery.required(run) && ((item.role === 'reviewer' && run.delivery.state !== 'files_ready') || (item.role === 'secretary' && run.delivery.state !== 'reviewed'))) continue;
      const previous=(store.codexJobs||[]).find(j=>j.runId===run.id&&j.role===item.role);
      if(['failed','held'].includes(previous?.status)||gov.busy(store,'codex'))continue;
      try{start({runId:run.id,role:item.role});}catch(e){if(!e.code)throw e;}
    }
  }
  return { start, recover, tick, busy: runId => active.has(runId) };
}
module.exports = { createManager };
