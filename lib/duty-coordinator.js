'use strict';
const fs=require('fs'),path=require('path');
const gov=require('./execution-governance'),recovery=require('./workflow-recovery'),{inactive}=require('./archive');
const {postMessage}=require('./collaboration');
const SLA=75*60000;
function policy(store,runId){return store.dutyPolicies?.[runId]||{enabled:false,claimSlaMinutes:75,executor:'cursor',reviewer:'codex'};}
function configure(store,run,body){
 if(body.confirmed!==true||body.expectedGeneration!==(run.controlGeneration||0)||typeof body.enabled!=='boolean')throw gov.error('input_changed');
 if(inactive(run))throw gov.error('project_paused_or_archived');
 store.dutyPolicies||={};return store.dutyPolicies[run.id]={enabled:body.enabled,claimSlaMinutes:75,executor:'cursor',reviewer:'codex',approvedBy:'chairman',approvedAt:new Date().toISOString()};
}
function board(store,now=Date.now()){
 const entries=[];
 for(const run of store.departmentRuns||[])if(!inactive(run)&&run.status!=='completed')for(const step of run.items||[]){
  if(step.status==='done')continue;
  const a=(store.executionAttempts||[]).find(a=>a.id===step.activeAttemptId);
  const active=a&&gov.ACTIVE.has(a.state),since=active?(a.events?.filter(e=>e.state===a.state).at(-1)?.at||a.createdAt):step.recovery?.createdAt||step.updatedAt||step.createdAt;
  let waitingOn=step.ownerAgentId,nextAction='等待前置成果';
  if(run.automationPaused){waitingOn='chairman';nextAction='核对后明确继续';}
  else if(active&&a.state==='waiting')nextAction=a.agentId==='workbuddy'?'等待桌面领取；获批规则在 75 分钟未领取后检查补位':'等待通道接单';
  else if(active&&['claimed','running'].includes(a.state))nextAction='等待实际成果与回执';
  else if(active&&a.state==='uncertain'||step.recovery?.status==='needs-user'){waitingOn='chairman';nextAction='核对旧执行与保留成果';}
  else if(step.recovery?.status==='scheduled'){waitingOn='scheduler';nextAction='执行已登记的恢复计划';}
  entries.push({runId:run.id,stepId:step.id,who:step.ownerAgentId,state:active?a.state:step.status,since,waitingMinutes:Number.isFinite(Date.parse(since))?Math.max(0,Math.floor((now-Date.parse(since))/60000)):null,waitingOn,nextAction,policy:policy(store,run.id)});
 }
 entries.sort((a,b)=>(b.waitingOn==='chairman')-(a.waitingOn==='chairman')||(b.waitingMinutes||0)-(a.waitingMinutes||0));
  return {lastTickAt:store.coordinator?.lastTickAt||null,stale:!store.coordinator?.lastTickAt||now-Date.parse(store.coordinator.lastTickAt)>5*60000,entries,signals:store.coordinator?.signals||[],log:(store.coordinator?.log||[]).slice(0,50)};
}
function createCoordinator({readStore,writeStore,dataDir}){
 function withdraw(runId,clock=Date.now()){
  const dir=path.join(dataDir,'workbuddy-queue');fs.mkdirSync(dir,{recursive:true});const lock=path.join(dir,'claim.lock');let fd;
  try{fd=fs.openSync(lock,'wx');}catch(e){if(e.code==='EEXIST')return false;throw e;}
  try{
   const s=readStore(),run=(s.departmentRuns||[]).find(r=>r.id===runId);
   if(!run||inactive(run)||run.automationPaused||!run.externalAutomation||!policy(s,runId).enabled||run.workbuddyTransport!=='desktop-scheduled')return false;
   const step=run.items.find(i=>i.role==='executor'),reviewer=run.items.find(i=>i.role==='reviewer');
   if(!step||!reviewer||step.ownerAgentId!=='workbuddy'||!['queued','rework'].includes(step.status))return false;
   const a=(s.executionAttempts||[]).find(a=>a.id===step.activeAttemptId),job=(s.externalJobs||[]).find(j=>j.attemptId===a?.id);
   if(!a||!job||a.state!=='waiting'||a.purpose!=='stage'||a.agentId!=='workbuddy'||a.transport!=='desktop-scheduled'||a.claimId||a.claimedAt||a.invokedAt||a.startedEvidence||clock-Date.parse(a.createdAt)<SLA||!Number.isFinite(Date.parse(a.createdAt)))return false;
   if(!['waiting','doing'].includes(job.status)||!/^[A-Za-z0-9-]+$/.test(a.jobId))return false;
   if((s.executionAttempts||[]).some(v=>v.stepId===reviewer.id&&gov.ACTIVE.has(v.state)))return false;
   const max=recovery.policy(run).maxAttempts;if(recovery.phaseAttempts(s,run,step).length>=max)return false;
   if(step.status==='rework'){const b=require('./department').automationReviewBudget(run);if(b.used>=b.limit)return false;}
   try{gov.check(s,a);gov.assertAgent(s,'cursor');gov.assertAgent(s,'codex');gov.skillVersions(s,run,{...step,ownerAgentId:'cursor'});gov.skillVersions(s,run,{...reviewer,ownerAgentId:'codex'});}catch{return false;}
   if(gov.busy(s,'cursor'))return false;
   const file=path.join(dir,a.jobId+'.request.json');let q;try{const stat=fs.lstatSync(file);if(stat.isSymbolicLink()||!stat.isFile()||stat.size>2000000)return false;q=JSON.parse(fs.readFileSync(file,'utf8'));}catch{return false;}
   const key='unclaimed-failover:'+a.id;
   const fenced=q.status==='withdrawn'&&q.withdrawalKey===key&&Number.isFinite(Date.parse(q.withdrawnAt));
   if(q.jobId!==a.jobId||q.attemptId!==a.id||q.runId!==runId||!(q.status==='queued'||fenced)||q.claimId||q.claimedAt||fs.existsSync(path.join(dir,a.jobId+'.result.json'))||fs.existsSync(path.join(dir,a.jobId+'.draft.txt')))return false;
   const at=fenced?q.withdrawnAt:new Date(clock).toISOString();
   // Fence the old desktop request while holding the exact lock used by claim().
   // A ledger-write failure leaves a withdrawn request, never a second live worker.
   if(!fenced){q.status='withdrawn';q.withdrawnAt=at;q.withdrawalKey=key;fs.writeFileSync(file,JSON.stringify(q,null,2));}
   a.state='cancelled';a.completedAt=at;a.resolution={at,by:'coordinator',evidence:'获批的75分钟未领取补位；领取锁内确认无领取、启动、草稿或结果证据。'};
   a.events.push({state:'cancelled',at,source:'approved-unclaimed-failover'});job.status='dismissed';job.completedAt=at;job.error='未领取派单已撤回，按批准规则补位。';
   const change={key,at,from:'workbuddy',to:'cursor',sourceAttemptId:a.id,reviewer:'codex'};
   (step.reassignments||=[]).push(change);step.previousOwnerAgentId='workbuddy';step.ownerAgentId='cursor';
   reviewer.previousOwnerAgentId=reviewer.ownerAgentId;reviewer.ownerAgentId='codex';
   if(step.recovery)(step.recoveryHistory||=[]).push(step.recovery);step.recovery={sourceAttemptId:a.id,status:'completed',reason:'未领取派单已撤回，已按批准规则补位。',createdAt:at};
   run.participantAgentIds=[...new Set([...(run.participantAgentIds||[]),'cursor','codex'])];gov.touch(run);
   for(const m of s.inbox||[])if(m.runId===runId&&m.departmentItemId===step.id&&m.toAgentId==='workbuddy')m.status='done';
   postMessage(s,{runId,sender:'codex',type:'decision',relatedTaskId:step.id,text:'WorkBuddy 超过75分钟仍未领取，旧派单已撤回。按你批准的规则，由 Cursor 接手正文，Codex 独立复核；已有成果与退回意见保留。'});
   s.coordinator||={};s.coordinator.log=[{...change,runId,stepId:step.id},...(s.coordinator.log||[])].slice(0,2000);writeStore(s);return true;
  }finally{fs.closeSync(fd);fs.unlinkSync(lock);}
 }
 function tick(clock=Date.now()){
  const snapshot=readStore();for(const r of snapshot.departmentRuns||[])withdraw(r.id,clock);
  const s=readStore();s.coordinator||={};s.coordinator.signals=require('./superagent-watchdog').scan(s,{now:clock}).verdicts;s.coordinator.lastTickAt=new Date(clock).toISOString();writeStore(s);
 }
 return {tick,withdraw};
}
module.exports={policy,configure,board,createCoordinator};
