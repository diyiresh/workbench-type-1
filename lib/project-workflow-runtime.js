'use strict';
const path=require('node:path');
const flow=require('./project-workflow');
const gov=require('./execution-governance');
const {inactive}=require('./archive');
const delivery=require('./delivery');
const {id,nowIso}=require('./default-store');

function createManager({readStore,writeStore,cwd=path.resolve(__dirname,'..'),dataDir=process.env.BENCH_DATA_DIR||path.join(cwd,'data'),execute,generateFiles}){
  const pending=new Map();
  const adapter=execute||async function(agentId,prompt,context){
    if(agentId==='codex')return require('./codex').generate(prompt,context);
    return require('./external-runtime').generate(agentId,prompt,cwd,context);
  };
  function start(runId,stepId){
    let store=readStore(),run=store.departmentRuns.find(r=>r.id===runId),s=run?.items.find(s=>s.id===stepId);
    if(!flow.isNew(run)||!s)throw gov.error('step_missing');
    flow.guard(store,run,s);if(s.purpose==='role-probe')flow.prepareProbe(run,s,dataDir);flow.assertBudget(store,run,s);
    if((store.executionAttempts||[]).some(a=>a.runId===run.id&&a.stepId===s.id&&(gov.ACTIVE.has(a.state)||a.state==='held')))throw gov.error('reconcile_required');
    const agentId=s.ownerAgentId,jobId=id('wf'),purpose=s.purpose;
    const extra={workflowPurpose:purpose,unitId:s.unitId,milestoneId:s.unitInput?.milestoneId||null,planId:s.unitInput?.planId||null};
    const transport=agentId==='codex'?'codex-cli':agentId==='workbuddy'?run.workbuddyTransport:require('./provider-catalog').metadata(agentId)?.transport;
    const a=gov.reserve(store,{runId,stepId:s.id,agentId,purpose:'stage',jobId,transport,extra,idempotencyKey:'workflow:'+s.unitId,timeoutMs:agentId==='workbuddy'?7800000:600000});
    const prompt=flow.prompt(store,run,s)+gov.skillBlock(gov.skillVersions(store,run,s));
    s.status='doing';s.attempts++;s.startedAt=nowIso();
    const collection=agentId==='codex'?'codexJobs':'externalJobs';
    const job={id:jobId,runId,itemId:s.id,role:s.role,agentId,attemptId:a.id,workflowManaged:true,purpose,status:agentId==='workbuddy'?'waiting':'doing',output:'',createdAt:nowIso()};
    (store[collection]||=[]).unshift(job);writeStore(store);
    const context={runId,itemId:s.id,role:s.role,jobId,attemptId:a.id,purpose:'workflow-'+purpose,transport,
      onBeforeStart:()=>gov.beforeStart(readStore(),a.id),
      onStart:info=>{const fresh=readStore();gov.processStarted(fresh,a.id,info);writeStore(fresh);},
      onClose:info=>{const fresh=readStore();gov.processClosed(fresh,a.id,info);writeStore(fresh);}};
    const task=Promise.resolve().then(()=>{
      const fresh=readStore(),current=gov.get(fresh,a.id);gov.check(fresh,current);
      if(transport==='desktop-scheduled')current.promptHash=gov.hash(prompt);else gov.starting(fresh,current,prompt);
      writeStore(fresh);return adapter(agentId,prompt,context);
    }).then(result=>{
      const fresh=readStore(),current=fresh.departmentRuns.find(r=>r.id===runId),step=current.items.find(i=>i.id===s.id),saved=fresh[collection].find(j=>j.id===jobId),attempt=gov.get(fresh,a.id);
      const output=typeof result==='string'?result:result.text;if(typeof output!=='string'||!output.trim())throw gov.error('output_required');
      const held=gov.collect(fresh,attempt,output).held;saved.output=output;saved.completedAt=nowIso();
      if(held){saved.status='held';if(step.activeAttemptId===a.id)step.status='blocked';writeStore(fresh);return;}
      // Persist raw receipts before any structured command; malformed output is never lost.
      writeStore(fresh);
      const next=readStore(),r=next.departmentRuns.find(r=>r.id===runId),i=r.items.find(i=>i.id===s.id),j=next[collection].find(j=>j.id===jobId);
      flow.receive(next,r,i,gov.get(next,a.id));j.status='done';j.completedAt=nowIso();writeStore(next);
    }).catch(error=>{
      const fresh=readStore(),current=fresh.departmentRuns.find(r=>r.id===runId),step=current.items.find(i=>i.id===s.id),saved=fresh[collection].find(j=>j.id===jobId),attempt=gov.get(fresh,a.id);
      if(attempt.state==='returned'&&['input_changed','project_paused','project_paused_or_archived'].includes(error.code)){
        attempt.state='held';attempt.blockerCode=error.code;attempt.events.push({state:'held',at:nowIso(),source:'workflow-commit-check'});
      }
      gov.failed(fresh,attempt,error);saved.status=attempt.state==='held'?'held':'failed';saved.error=String(error.message||error);saved.completedAt=nowIso();
      if(step.activeAttemptId===a.id){
        flow.block(fresh,current,step,error);
        if(step.role==='director'&&['auth_required','dependency_unavailable'].includes(error.code))current.agentStartRequest={id:id('start'),agentId,reason:saved.error,nextAction:'启动后由原项目负责人接续，保留当前成果和预算。',state:'requested',at:nowIso()};
        else if(step.role==='director'&&(attempt.retryable&&attempt.state==='failed'||attempt.state==='returned'&&error.code?.startsWith('workflow_'))){
          try{flow.assertBudget(fresh,current,step);step.recovery={status:'scheduled',workflowManaged:true,sourceAttemptId:attempt.id,nextRetryAt:new Date(Date.now()+30000).toISOString(),controlGeneration:gov.generation(current,'stage'),inputHash:gov.input(fresh,current,step.id,'stage'),reason:'负责人通道已明确结束；在原预算内按明确格式或恢复策略重试。'};}catch{}
        }
      }
      writeStore(fresh);
    }).finally(()=>pending.delete(a.id));pending.set(a.id,task);return job;
  }
  function tick(clock=Date.now()){
    const initial=readStore();let first=true;
    for(const run of initial.departmentRuns||[]){
      if(!flow.isNew(run)||inactive(run)||run.automationPaused||!run.externalAutomation||run.status==='completed')continue;
      const currentStore=first?initial:readStore(),r=currentStore.departmentRuns.find(r=>r.id===run.id);first=false;
      if(r.delivery?.state==='invalidated'){
        if(flow.repairFiles(currentStore,r,r.currentMilestoneId))writeStore(currentStore);
      }else if(r.status==='awaiting_acceptance'&&r.finalOutput){
        try{flow.completionSnapshot(currentStore,r);}catch(error){if(error.milestoneId&&flow.repairFiles(currentStore,r,error.milestoneId))writeStore(currentStore);}
      }
      for(const s of r.items){const recovery=s.recovery;
        if(recovery?.workflowManaged&&recovery.status==='scheduled'&&Date.parse(recovery.nextRetryAt)<=clock){
          const previous=(currentStore.executionAttempts||[]).find(a=>a.id===recovery.sourceAttemptId);
          if(!previous||!['failed','returned'].includes(previous.state)||recovery.controlGeneration!==gov.generation(r,'stage')||recovery.inputHash!==gov.input(currentStore,r,s.id,'stage')){recovery.status='invalidated';writeStore(currentStore);continue;}
          if(gov.busy(currentStore,s.ownerAgentId))continue;
          try{flow.assertBudget(currentStore,r,s);flow.queue(r,s.role,s.purpose,{...s.unitInput,recoveryInstruction:'先前返回未满足约定或通道已明确失败。本次改变处理方法：只返回当前用途要求的完整结果；JSON用途使用严格JSON，不添加解释或代码围栏，不改任务范围。'});recovery.status='completed';writeStore(currentStore);}catch{recovery.status='exhausted';writeStore(currentStore);}
        }
      }
      if(flow.due(currentStore,r,clock))writeStore(currentStore);
      const reviewer=flow.item(r,'reviewer');
      if(r.status==='awaiting_files'&&r.delivery?.state==='files_ready'&&['blocked','queued'].includes(reviewer.status)&&!reviewer.unitInput?.fileSnapshot){
        try{const snap=delivery.assertReady(currentStore,r);flow.queue(r,'reviewer','milestone-review',{milestoneId:r.currentMilestoneId,sourceHash:r.milestones.find(m=>m.id===r.currentMilestoneId).resultHash,fileSnapshot:snap});r.status='review';writeStore(currentStore);}catch{}
      }
      if(r.status==='awaiting_files'&&r.delivery?.state==='pending'&&generateFiles&&!pending.has('file:'+r.id)){
        const task=Promise.resolve().then(()=>generateFiles(r.id)).catch(error=>{
        const fresh=readStore(),run=fresh.departmentRuns.find(v=>v.id===r.id);if(!flow.isNew(run)||inactive(run))return;
        flow.block(fresh,run,flow.item(run,'executor'),error);writeStore(fresh);
        }).finally(()=>pending.delete('file:'+r.id));pending.set('file:'+r.id,task);
      }
      let renewed=false;
      for(const s of r.items)if(s.status==='queued'){
        if(s.purpose!=='role-probe'&&!flow.capabilityReady(currentStore,r,s.role)){
          if((currentStore.executionAttempts||[]).some(a=>a.runId===r.id&&a.stepId===s.id&&(gov.ACTIVE.has(a.state)||a.state==='held')))continue;
          s.pendingUnit={purpose:s.purpose,input:structuredClone(s.unitInput)};flow.queue(r,s.role,'role-probe');renewed=true;
        }
      }
      if(renewed)writeStore(currentStore);
      for(const s of r.items)if(s.status==='queued'&&!gov.busy(currentStore,s.ownerAgentId)){
        try{start(r.id,s.id);}catch(error){
          if(['already_claimed','project_paused','input_changed','reconcile_required'].includes(error.code))continue;
          const fresh=readStore(),run=fresh.departmentRuns.find(v=>v.id===r.id),step=run.items.find(v=>v.id===s.id);
          if(step.status==='queued'){flow.block(fresh,run,step,error);writeStore(fresh);}
        }
      }
    }
  }
  function recover(){const store=readStore();let changed=false;
    for(const job of [...store.codexJobs||[],...store.externalJobs||[]])if(job.workflowManaged&&['doing','waiting'].includes(job.status)){
      const a=(store.executionAttempts||[]).find(a=>a.id===job.attemptId);
      job.status=a?.state==='held'?'held':'failed';job.error='服务重启，原调用等待核对，不自动重发。';job.completedAt=nowIso();changed=true;
    }
    for(const run of store.departmentRuns||[])if(flow.isNew(run))for(const s of run.items)if(s.status==='doing'){
      const a=(store.executionAttempts||[]).find(a=>a.id===s.activeAttemptId);
      if(!a||['uncertain','interrupted','held','failed','cancelled'].includes(a.state)){s.status='blocked';s.blocker={code:'reconcile_required',detail:'服务重启后保留原调用，先核对旧会话与实际成果。',at:nowIso()};changed=true;}
    }
    if(changed)writeStore(store);
  }
  return {start,tick,recover,drain:()=>Promise.all([...pending.values()])};
}
module.exports={createManager};
