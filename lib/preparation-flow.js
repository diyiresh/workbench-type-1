"use strict";
const { inactive } = require("./archive");
const { createHash } = require('crypto');
const { postMessage } = require('./collaboration');
const { getRun, getItem } = require('./department');
function createPreparationFlow({ readStore, writeStore, review = prompt => require('./external-runtime').generate('cursor', prompt, process.cwd()), summarize = prompt => require('./codex').generate(prompt) }) {
  const active = new Set();
  function update(runId, signature, generation, mutate, lateResult) {
    const store = readStore(), run = getRun(store, runId);
    if (inactive(run) || (run.archiveGeneration||0)!==generation || run.writingApproved || run.preparationFlow?.signature !== signature) {
      if(lateResult){run.preparationLateResults||=[];run.preparationLateResults.push({...lateResult,signature,status:'held',completedAt:new Date().toISOString()});if(run.preparationFlow?.signature===signature)run.preparationFlow.status='held';writeStore(store);}
      return false;
    }
    mutate(store, run.preparationFlow); writeStore(store); return true;
  }
  function recover() {
    const store = readStore(); let changed = false;
    for (const run of store.departmentRuns || []) if (['reviewing', 'summarizing'].includes(run.preparationFlow?.status)) {
      run.preparationFlow.status = 'failed'; run.preparationFlow.error = '服务重启中断，请重试部门工作'; changed = true;
    }
    if (changed) writeStore(store);
  }
  function tick() {
    const store = readStore();
    for (const run of store.departmentRuns || []) {
      const executor = getItem(run, 'executor');
      if (!run.externalAutomation || run.automationPaused || inactive(run) || run.writingApproved || !executor.preparationReady || !executor.output || active.has(run.id)) continue;
      const signature = createHash('sha256').update(executor.output).digest('hex');
      if (run.preparationFlow?.signature === signature && run.preparationFlow.status !== 'held') continue;
      const reviewer = getItem(run, 'reviewer').ownerAgentId;
      if (reviewer !== 'cursor' || executor.ownerAgentId === reviewer || (store.agents||[]).some(agent=>['codex',reviewer].includes(agent.id)&&inactive(agent))) continue;
      const generation=run.archiveGeneration||0;
      run.preparationFlow = { signature, archiveGeneration:generation, status: 'reviewing', startedAt: new Date().toISOString(), review: '', summary: '', error: '' };
      postMessage(store, { runId: run.id, sender: 'codex', recipient: 'cursor', type: 'task_assignment', text: '准备材料已收到，已启动 Cursor 独立复核来源、证据与修订纲要；完整报告尚未授权写作。' });
      writeStore(store); active.add(run.id);
      const context = `目标：${run.goal}\n约束：${run.context}\n主管方案：${getItem(run, 'director').output}\nWorkBuddy 准备材料：${executor.output}`;
      Promise.resolve().then(() => {
        const current=getRun(readStore(),run.id);if(inactive(current)||(current.archiveGeneration||0)!==generation)throw new Error("project_paused_or_archived");
        return review(`你是 Cursor 独立复核人。只读核验明确指定的材料，不修改文件。复核来源完整性、证据、纲要、过期时限。区分已核实与缺证据、可由 Agent 处理的问题与必须由用户决定的问题。只审准备材料，不要求完整报告，不代替用户批准写作。\n${context}`);
      })
        .then(result => {
          const text = String(result).trim(); if (!text) throw new Error('Cursor 未返回复核意见');
          const applied=update(run.id, signature, generation, (fresh, flow) => {
            flow.review = text; flow.status = 'summarizing';
            postMessage(fresh, { runId: run.id, sender: 'cursor', type: 'review', text: '准备材料独立复核（不代表完整报告验收）：\n' + text });
          },{role:'reviewer',output:text});
          if(!applied)return null;
          return summarize(`你是项目总管 Codex。根据真实准备材料及 Cursor 复核提出可执行处理建议。可由 Agent 查证修订的问题归为后续执行项；只向用户提出必须由用户决定的问题，给推荐选项和理由。对过期时限提出调整建议，不擅自承诺新日期。最后明确等待用户确认及 Start Writing。不写完整报告，不声称最终验收完成。\n${context}\nCursor 复核：${text}`);
        }).then(result => {
          if(result===null)return;
          const text = String(result?.text || result || '').trim(); if (!text) throw new Error('Codex 未返回处理建议');
          update(run.id, signature, generation, (fresh, flow) => {
            flow.summary = text; flow.status = 'awaiting_confirmation'; flow.completedAt = new Date().toISOString();
            postMessage(fresh, { runId: run.id, sender: 'codex', type: 'decision', text: '准备阶段总管建议与必要确认事项：\n' + text });
          },{role:'secretary',output:text});
        }).catch(error => {
          try { update(run.id, signature, generation, (fresh, flow) => {
            flow.status = 'failed'; flow.error = error.message;
            postMessage(fresh, { runId: run.id, sender: 'codex', type: 'blocker', text: '准备材料接力失败：' + error.message + '。原成果已保留，未伪造复核或总结。' });
          }); } catch (_) {}
        }).finally(() => active.delete(run.id));
    }
  }
  return { tick, recover };
}
module.exports = { createPreparationFlow };
