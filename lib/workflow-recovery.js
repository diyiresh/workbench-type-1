'use strict';
const gov=require('./execution-governance');
const {inactive}=require('./archive');
const {postMessage}=require('./collaboration');
const failure=require('./runtime-failure');
const DEFAULT={enabled:true,maxAttempts:3,reviewerFallback:'codex',firstDelaySeconds:30,secondDelaySeconds:120};
function policy(run){return {...DEFAULT,enabled:false,...run.recoveryPolicy};}
function configure(run,body){
  if(body.confirmed!==true||body.expectedGeneration!==(run.controlGeneration||0))throw gov.error('input_changed');
  if(typeof body.enabled!=='boolean'||!Number.isInteger(body.maxAttempts)||body.maxAttempts<1||body.maxAttempts>3||!['codex','none'].includes(body.reviewerFallback))throw gov.error('invalid_recovery_policy');
  const firstDelaySeconds=body.firstDelaySeconds??policy(run).firstDelaySeconds,secondDelaySeconds=body.secondDelaySeconds??policy(run).secondDelaySeconds;
  if(!Number.isInteger(firstDelaySeconds)||firstDelaySeconds<5||firstDelaySeconds>3600||!Number.isInteger(secondDelaySeconds)||secondDelaySeconds<firstDelaySeconds||secondDelaySeconds>7200)throw gov.error('invalid_recovery_policy');
  const next={enabled:body.enabled,maxAttempts:body.maxAttempts,reviewerFallback:body.reviewerFallback,firstDelaySeconds,secondDelaySeconds};if(gov.hash(policy(run))===gov.hash(next))return;run.recoveryPolicy=next;gov.touch(run);
}
function assign(store,run,body){
  if(run.workflowVersion===2)throw gov.error('use_project_workflow');
  if(body.confirmed!==true||body.expectedGeneration!==(run.controlGeneration||0))throw gov.error('input_changed');
  const step=run.items.find(i=>i.id===body.stepId);if(!step||!['queued','rework'].includes(step.status))throw gov.error('step_not_ready');
  if((store.executionAttempts||[]).some(a=>a.runId===run.id&&a.stepId===step.id&&(gov.ACTIVE.has(a.state)||a.state==='held')))throw gov.error('reconcile_required');
  const allowed=['director','secretary'].includes(step.role)?['codex']:step.role==='executor'?require('./provider-catalog').EXTERNAL:require('./provider-catalog').MODELS;
  if(!allowed.includes(body.ownerAgentId))throw gov.error('unsupported_stage_owner');
  if(step.role==='reviewer'&&run.items.find(i=>i.role==='executor')?.ownerAgentId===body.ownerAgentId||step.role==='executor'&&run.items.find(i=>i.role==='reviewer')?.ownerAgentId===body.ownerAgentId)throw gov.error('independent_reviewer_required');
  gov.assertAgent(store,body.ownerAgentId);
  gov.skillVersions(store,run,{...step,ownerAgentId:body.ownerAgentId});
  if(step.ownerAgentId===body.ownerAgentId)return {stepId:step.id,ownerAgentId:step.ownerAgentId};
  step.previousOwnerAgentId=step.ownerAgentId;step.ownerAgentId=body.ownerAgentId;gov.touch(run);
  for(const m of store.inbox||[])if(m.runId===run.id&&m.departmentItemId===step.id&&m.status==='queued')m.status='done';
  postMessage(store,{runId:run.id,sender:'chairman',type:'decision',relatedTaskId:step.id,text:`已确认改派：${step.label||step.role} → ${body.ownerAgentId}。原成果和历史记录保留。`});
  return {stepId:step.id,ownerAgentId:step.ownerAgentId};
}
function phaseAttempts(store,run,step){
  const attempts=(store.executionAttempts||[]).filter(a=>a.runId===run.id&&a.stepId===step.id&&a.purpose==='stage');
  const lastSuccess=attempts.findIndex(a=>a.state==='returned');
  return lastSuccess<0?attempts:attempts.slice(0,lastSuccess);
}
function previousJob(store,step){return [...store.codexJobs||[],...store.externalJobs||[]].find(j=>j.attemptId===step.activeAttemptId);}
function announce(store,run,step,plan){postMessage(store,{runId:run.id,sender:'codex',type:plan.status==='needs-user'?'blocker':'progress',relatedTaskId:step.id,text:`${step.label||step.role}：${plan.reason}${plan.nextRetryAt?'\n下一次尝试：'+plan.nextRetryAt:''}${plan.strategy==='fallback-codex'?'\n将由 Codex 替补独立复核，保留已有正文及文件。':''}`});}
function setPlan(store,run,step,plan){step.recovery=plan;announce(store,run,step,plan);return {allow:false,changed:true};}
function prepare(store,run,step,job,clock=Date.now()){
  let plan=step.recovery;const p=policy(run);
  // A stale plan is never silently regenerated after a control or input change.
  if(plan&&['scheduled','dispatching'].includes(plan.status)&&(
    !p.enabled||inactive(run)||run.automationPaused||plan.controlGeneration!==gov.generation(run,'stage')||plan.inputHash!==gov.input(store,run,step.id,'stage')||plan.policyHash!==gov.hash(p))) {
    return setPlan(store,run,step,{...plan,status:'invalidated',nextRetryAt:null,reason:'执行条件已改变，旧恢复计划已取消；请核对最新任务后明确继续。'});
  }
  if(!job||!['failed','held'].includes(job.status))return {allow:true,changed:false,idempotencyKey:plan?.status==='dispatching'?plan.idempotencyKey:undefined};
  const a=(store.executionAttempts||[]).find(a=>a.id===job.attemptId);
  if(!p.enabled||!a||a.purpose!=='stage')return {allow:false,changed:false};
  if(a.id!==step.activeAttemptId)return {allow:false,changed:false};
  if(inactive(run)||run.automationPaused)return {allow:false,changed:false};
  // Compatibility with a known older CLI adapter: this exact prefix was emitted
  // only by its child.close handler. It is accepted solely for read-only review.
  let upgraded=false;
  if(a.state==='interrupted'&&!a.claimedAt&&!a.invokedAt&&!a.startedEvidence&&a.transport==='desktop-scheduled'){
    try{const path=require('path'),fs=require('fs'),file=path.join(process.env.BENCH_DATA_DIR||path.join(process.cwd(),'data'),'workbuddy-queue',a.jobId+'.request.json');const q=JSON.parse(fs.readFileSync(file,'utf8'));if(q.attemptId===a.id&&q.status==='queued'&&!q.claimId){a.termination={closedAt:a.completedAt||new Date(clock).toISOString(),source:'unclaimed-desktop-request'};a.failureKind='interrupted-before-claim';a.retryable=true;a.state='failed';a.events.push({state:'failed',at:new Date(clock).toISOString(),source:'unclaimed-queue-recovery'});upgraded=true;}}catch{}
  }
  if(['interrupted','uncertain'].includes(a.state)&&!a.invokedAt&&!a.startedEvidence&&['external-cli','codex-cli','harness-cli','ollama-http'].includes(a.transport)){
    a.termination={closedAt:a.completedAt||new Date(clock).toISOString(),source:'not-invoked-before-restart'};a.failureKind='interrupted-before-start';a.retryable=true;a.state='failed';a.events.push({state:'failed',at:new Date(clock).toISOString(),source:'not-invoked-recovery'});upgraded=true;
  }
  if(a.state==='uncertain'&&!a.termination&&a.agentId==='cursor'&&a.transport==='external-cli'&&step.role==='reviewer'&&/^成员执行退出 \d+：/.test(a.error||'')&&job.completedAt&&failure.kind({message:a.error})==='network'){
    a.termination={closedAt:job.completedAt,exitCode:Number(a.error.match(/^成员执行退出 (\d+)/)[1]),source:'legacy-cli-close-handler'};
    a.failureKind='network';a.retryable=true;a.state='failed';a.events.push({state:'failed',at:new Date(clock).toISOString(),source:'readonly-recovery-evidence'});upgraded=true;
  }
  // New positive evidence can supersede an earlier unresolved automatic decision.
  // Preserve that judgment; explicit control invalidation is never overridden.
  if(upgraded&&plan?.sourceAttemptId===a.id&&plan.status==='needs-user'){
    (step.recoveryHistory||=[]).push({...plan,supersededAt:new Date(clock).toISOString(),evidenceSource:a.termination.source});
    plan=null;
  }
  if(plan?.sourceAttemptId===a.id){
    if(plan.status==='invalidated'||plan.status==='needs-user')return {allow:false,changed:upgraded};
    if(plan.status==='scheduled'&&Date.parse(plan.nextRetryAt)>clock)return {allow:false,changed:upgraded};
    if(plan.strategy==='fallback-codex'&&step.ownerAgentId!=='codex'){
      const executor=run.items.find(i=>i.role==='executor');
      if(executor?.ownerAgentId==='codex')return setPlan(store,run,step,{...plan,status:'needs-user',nextRetryAt:null,reason:'独立复核不能由正文执行人承担，请选择其他复核人。'});
      try{gov.skillVersions(store,run,{...step,ownerAgentId:'codex'});}catch{return setPlan(store,run,step,{...plan,status:'needs-user',nextRetryAt:null,reason:'本阶段绑定的技能不允许替补成员使用，请先核对技能或调整分工。'});}
      if(gov.busy(store,'codex'))return {allow:false,changed:upgraded};
      step.previousOwnerAgentId=step.ownerAgentId;step.ownerAgentId='codex';step.engine='codex-chatgpt';gov.touch(run);
      plan.controlGeneration=gov.generation(run,'stage');plan.inputHash=gov.input(store,run,step.id,'stage');
      for(const m of store.inbox||[])if(m.runId===run.id&&m.departmentItemId===step.id&&m.status==='queued')m.status='done';
    }
    plan.status='dispatching';return {allow:true,changed:true,idempotencyKey:plan.idempotencyKey};
  }
  const base={sourceAttemptId:a.id,controlGeneration:gov.generation(run,'stage'),inputHash:gov.input(store,run,step.id,'stage'),policyHash:gov.hash(p),createdAt:new Date(clock).toISOString(),idempotencyKey:'recovery:'+a.id};
  if(!a.retryable||a.state!=='failed'||!a.termination?.closedAt)return setPlan(store,run,step,{...base,status:'needs-user',reason:'本次结果或执行归属尚不能安全重试，请核对执行记录；已有成果已保留。'});
  const attempts=phaseAttempts(store,run,step);
  if(attempts.length>=p.maxAttempts)return setPlan(store,run,step,{...base,status:'needs-user',reason:`本阶段连续调用预算已用完（${attempts.length}/${p.maxAttempts}），请处理阻塞或确认新的任务范围。`});
  let strategy='retry';
  if(attempts.length>=2){
    if(step.role==='reviewer'&&step.ownerAgentId==='cursor'&&p.reviewerFallback==='codex'&&run.items.find(i=>i.role==='executor')?.ownerAgentId!=='codex')strategy='fallback-codex';
    else if(a.failureKind==='format')strategy='structured-output';
    else return setPlan(store,run,step,{...base,status:'needs-user',reason:'执行通道故障已重复出现，暂无已授权的替补通道；请恢复连接或调整分工。'});
  }
  return setPlan(store,run,step,{...base,status:'scheduled',strategy,reason:strategy==='fallback-codex'?'复核通道连续失败，已安排替补复核。':strategy==='structured-output'?'输出格式仍不完整，下一次将使用更明确的交付约定。':'已确认可以安全接续，正在等待后恢复本阶段。',nextRetryAt:new Date(clock+(attempts.length===1?p.firstDelaySeconds:p.secondDelaySeconds)*1000).toISOString()});
}
function instruction(step){return step.recovery?.strategy==='structured-output'?'\n本次是格式修复：完整给出实际成果，不使用代码围栏包裹最终响应，不截断正文，不以解释代替成果。':'';}
module.exports={DEFAULT,policy,configure,assign,phaseAttempts,previousJob,prepare,instruction};
