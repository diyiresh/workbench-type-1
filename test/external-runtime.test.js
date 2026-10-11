"use strict";
const assert=require("assert");
const {buildDefaultStore}=require("../lib/default-store");
const dept=require("../lib/department");
const {createRuntime,parseOutput}=require("../lib/external-runtime");
const fs=require("fs"),os=require("os"),path=require("path");
(async()=>{
  assert.throws(()=>parseOutput('Authentication required. Please use /login'),/登录/);
  assert.throws(()=>parseOutput('{"is_error":true,"result":"failed"}'),/failed/);
  let store=buildDefaultStore();
  const run=dept.createDepartmentRun(store,{goal:"临时自动执行器测试",participantAgentIds:["codex","cursor","workbuddy"]});
  dept.getItem(run,"executor").ownerAgentId="workbuddy";dept.getItem(run,"reviewer").ownerAgentId="cursor";
  dept.startItem(store,run.id,dept.getItem(run,"director").id);dept.submitItem(store,run.id,dept.getItem(run,"director").id,{output:"准备任务"});
  run.externalAutomation=true;
  run.workbuddyTransport='cli';
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"bench-runtime-"));
  let calls=0;
  const runtime=createRuntime({readStore:()=>structuredClone(store),writeStore:s=>{store=structuredClone(s)},artifactRoot:root,execute:async()=>{calls++;return "资料清单与纲要";}});
  runtime.tick();runtime.tick();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls,1);
  assert.equal(store.externalJobs[0].status,"done");
  assert.equal(dept.getItem(dept.getRun(store,run.id),"executor").status,"doing");
  assert.equal(dept.getItem(dept.getRun(store,run.id),"reviewer").status,"blocked");
  assert.ok(store.projectMessages.some(m=>m.text.includes("Start Writing")));
  assert.ok(fs.existsSync(store.externalJobs[0].artifactPath));
  const current = dept.getRun(store,run.id);
  current.writingApproved = true;
  current.discussion.push({role:'reviewer',text:'退回返工：一次实际退回'});
  const executor = dept.getItem(current,'executor');
  executor.status = 'rework'; executor.attempts = 6;
  for (const message of store.inbox || []) if (message.runId === run.id && message.departmentItemId === executor.id) message.status = 'done';
  runtime.tick();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls,2,'登录及启动重试不能算作三轮实际返工');
  assert.notEqual(dept.getRun(store,run.id).automationPaused,true);
  require('../lib/agent-dispatch').syncAssignments(store);
  const rejected = dept.getRun(store,run.id);
  dept.getItem(rejected,'executor').status='rework';
  rejected.discussion.push({role:'reviewer',text:'退回返工：第二轮'},{role:'reviewer',text:'退回返工：第三轮'});
  runtime.tick();
  assert.equal(dept.getRun(store,run.id).automationPaused,true,'三次真实退回仍须暂停');
  // 走与 HTTP retry 相同的恢复函数，不删除旧退回。
  const historyBefore=structuredClone(dept.getRun(store,run.id).discussion);
  const blockersBefore=store.projectMessages.filter(m=>m.type==='blocker').length;
  for(let i=0;i<3;i++)runtime.tick();
  assert.equal(store.projectMessages.filter(m=>m.type==='blocker').length,blockersBefore,'暂停期间不得重复发 blocker');
  dept.retryAutomation(store,run.id);
  assert.deepEqual(dept.getRun(store,run.id).discussion,historyBefore,'恢复必须保留全部历史审核');
  dept.retryAutomation(store,run.id);
  assert.equal(dept.getRun(store,run.id).automationRecoveries.length,1,'重复重试不得刷新额度');
  runtime.tick();
  assert.notEqual(dept.getRun(store,run.id).automationPaused,true,'显式重试必须能越过三条旧退回历史');
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls,3,'恢复后真正启动执行');
  // 新的一轮实际执行→独立审核退回，最多三次；含持久化重建及运行中重试。
  require('../lib/agent-dispatch').syncAssignments(store);
  const rejectingRuntime=createRuntime({readStore:()=>structuredClone(store),writeStore:s=>{store=structuredClone(s);require('../lib/agent-dispatch').syncAssignments(store)},artifactRoot:root,execute:async(agent)=>{
    calls++;return agent==='cursor'?'缺可复现证据\nVERDICT: REJECT':'返工成果';
  }});
  for(let round=1;round<=3;round++) {
    rejectingRuntime.tick(); await new Promise(resolve=>setImmediate(resolve));
    const afterReview=dept.getRun(store,run.id);
    assert.equal(dept.automationReviewBudget(afterReview).used,round);
    assert.equal(dept.getItem(afterReview,'executor').status,'rework');
    if(round<3) {
      dept.retryAutomation(store,run.id);
      assert.equal(dept.automationReviewBudget(dept.getRun(store,run.id)).used,round,'运行中重试不得重置本轮计数');
      rejectingRuntime.tick(); await new Promise(resolve=>setImmediate(resolve));
    }
  }
  const callsBeforePause=calls;
  rejectingRuntime.tick(); rejectingRuntime.tick();
  assert.equal(dept.getRun(store,run.id).automationPaused,true,'新增三次真实退回必须再次暂停');
  assert.equal(calls,callsBeforePause,'额度耗尽不再调用执行器');
  assert.equal(dept.automationReviewBudget(dept.getRun(store,run.id)).total,6);
  dept.retryAutomation(store,run.id);
  assert.equal(dept.getRun(store,run.id).automationRecoveries.length,2);
  assert.equal(dept.automationReviewBudget(dept.getRun(store,run.id)).used,0,'下一次明确重试开启新有界轮次');
  fs.rmSync(root,{recursive:true,force:true});
  console.log("External runtime automatic start, duplicate prevention and writing gate checks passed");
})().catch(error=>{console.error(error);process.exitCode=1});
