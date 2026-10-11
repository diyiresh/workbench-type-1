"use strict";
const codex = require("./codex");
const dept = require("./department");
const { id, nowIso } = require("./default-store");
const vault = require('./vault');
const { postMessage } = require('./collaboration');
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
  function start({ runId, role, test = false }) {
    const key = runId || "test";
    const store = readStore(); store.codexJobs ||= [];
    if (active.has(key)) return store.codexJobs.find(j => j.status === "doing" && (j.runId || "test") === key);
    let prompt = "收到请只回复：连接成功";
    if (!test) {
      if (!["director", "reviewer", "secretary"].includes(role)) throw new Error("仅支持主管拆解、独立复核与最终整合。");
      const run = dept.getRun(store, runId), item = dept.getItem(run, role);
      if (item.status !== "queued") throw new Error("本阶段尚未就绪或已完成。");
      if (role === "reviewer" && dept.getItem(run, "executor").ownerAgentId === "codex") throw new Error("执行人为 Codex，需要另一位独立复核人。");
      const instructions = dept.rolePrompt(run, item);
      prompt = instructions.system + "\n" + instructions.prompt + (role === 'director' ? "\n请列明子任务、承办建议、交付物、依赖、验收标准与待用户决定事项。不要声称已经唤醒其他成员。" : role === 'secretary' ? "\n复核已通过，请根据实际执行成果及复核意见输出最终可用成果全文，明确验收结果及仍需用户决定的事项。禁止把过程说明替代最终成果，禁止编造未完成工作。" : "");
      if (role === "reviewer") prompt += "\n最终必须使用 VERDICT: PASS 或 VERDICT: REJECT 表示结论。缺少可核验证据时退回。";
      item.ownerAgentId = "codex"; item.engine = "codex-chatgpt";
      dept.startItem(store, runId, item.id);
    }
    const job = { id: id("cj"), runId: runId || "", role: test ? "test" : role, status: "doing", createdAt: nowIso(), output: "", error: "" };
    store.codexJobs.unshift(job); active.add(key); writeStore(store);
    Promise.resolve().then(async () => {
      if (!test && role !== 'secretary' && vault.config(store).enabled) {
        const run = dept.getRun(store, runId);
        let evidence;
        try { evidence = await prepareEvidence(store, run.goal, { timeoutMs: role === "director" ? 10000 : 120000 }); }
        catch (err) {
          if (role !== "director") throw err;
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
      return generate(prompt);
    }).then(result => {
      const fresh = readStore(); const saved = fresh.codexJobs.find(j => j.id === job.id);
      let completedItem = null;
      if (!test) {
        const run = dept.getRun(fresh, runId), item = dept.getItem(run, role);
        completedItem = item;
        if (item.status !== "doing" || item.ownerAgentId !== "codex") throw new Error("项目阶段已被其他操作改变，结果未覆盖原记录。");
        if (role === "reviewer") {
          const verdict = /VERDICT\s*:\s*PASS/i.test(result.text) && !/VERDICT\s*:\s*REJECT/i.test(result.text) ? "pass" : "reject";
          dept.reviewExecutor(fresh, runId, { reviewerAgentId: "codex", verdict, comment: result.text });
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
      saved.status = "failed"; saved.error = String(err.message || err); saved.completedAt = nowIso();
      if (runId) { const item = dept.getItem(dept.getRun(fresh, runId), role); if (item.status === "doing" && item.ownerAgentId === "codex") item.status = "queued"; }
      writeStore(fresh);
    }).finally(() => active.delete(key));
    return job;
  }
  function tick() {
    const store=readStore();
    for(const run of store.departmentRuns||[]) {
      if(!run.externalAutomation||run.automationPaused||run.archived||run.status==='completed'||active.has(run.id))continue;
      const item=run.items.find(i=>i.status==='queued'&&i.ownerAgentId==='codex'&&['director','reviewer','secretary'].includes(i.role));
      if(!item)continue;
      const previous=(store.codexJobs||[]).find(j=>j.runId===run.id&&j.role===item.role);
      if(previous?.status==='failed')continue;
      start({runId:run.id,role:item.role});
    }
  }
  return { start, recover, tick, busy: runId => active.has(runId) };
}
module.exports = { createManager };
