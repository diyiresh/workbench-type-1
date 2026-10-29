const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const gov = require('../lib/execution-governance');
const policy = require('../lib/provider-policy');
const reports = require('../lib/agenda-report-jobs');
const queue = require('../lib/workbuddy-queue');
const root = fs.mkdtempSync(path.join(os.tmpdir(),'bench-report-manager-'));
let store = require('../lib/default-store').buildDefaultStore();
store.agendas = [{id:'fact',date:'2026-10-21',title:'已登记事项',note:'原始事实',done:false,review:'尚待核实'}];
store.remote.llm = {enabled:true,provider:'openai',baseUrl:'https://api.siliconflow.cn/v1',model:'preserved-model',apiKey:'fixture-key'};
gov.configure({channelState:()=>({state:'test-isolated'})});
const readStore=()=>structuredClone(store), writeStore=s=>{gov.observeControls(s,store);store=structuredClone(s);};
const input=agentId=>({agentId,view:'month',anchorDate:'2026-10-21',idempotencyKey:require('node:crypto').randomUUID()});
const flush=()=>new Promise(resolve=>setImmediate(resolve));
async function wait(manager,id){for(let i=0;i<100;i++){await new Promise(r=>setTimeout(r,5));const j=manager.get(id);if(!['waiting','doing'].includes(j.status))return j;}throw Error('fixture did not finish');}
(async()=>{
  const before=structuredClone(store.remote.llm);
  policy.setPause(store,{provider:'siliconflow',paused:true,confirmed:true});
  assert.equal(store.remote.llm.enabled,false);assert.equal(store.remote.llm.apiKey,before.apiKey);assert.equal(store.remote.llm.model,before.model);
  // The provider guard is checked even when a caller presents enabled=true.
  store.remote.llm.enabled=true;let requests=0;const originalFetch=global.fetch;
  global.fetch=async()=>{requests++;throw Error('network must not be called');};
  try{await assert.rejects(require('../lib/llm').chat(store,{prompt:'fixture',useVault:false}),e=>e.code==='provider_paused');}finally{global.fetch=originalFetch;}
  assert.equal(requests,0);assert(policy.isSiliconFlow({baseUrl:'https://api.siliconflow.com/v1'}));assert(!policy.isSiliconFlow({baseUrl:'https://siliconflow.cn.example.com/v1'}));
  policy.setPause(store,{provider:'siliconflow',paused:false,confirmed:true});assert.equal(store.remote.llm.enabled,true);
  policy.setPause(store,{provider:'siliconflow',paused:true,confirmed:true});
  let calls=0;
  const manager=reports.createManager({readStore,writeStore,execute:async(agent,prompt,ctx)=>{
    calls++;assert.equal(ctx.purpose,'agenda-report');assert.match(prompt,/已登记事项/);assert(!prompt.includes('fixture-key'));assert.match(prompt,/不读取资料库/);
    if(agent!=='workbuddy'){ctx.onBeforeStart();ctx.onStart({pid:123});}
    return '# '+agent+' 完整月报\n\n只能依据既有事项，尚未完成。';
  }});
  const departmentBefore=JSON.stringify(store.departmentRuns), reportCount=store.reports.length;
  for(const member of ['codex','cursor','workbuddy']){
    const body=input(member),j=manager.start(body);assert.equal(j.agentId,member);
    const done=await wait(manager,j.id);assert.equal(done.status,'done');assert.match(done.draft.body,new RegExp(member));assert.equal(done.draft.sourceJobId,j.id);
    const n=calls;assert.equal(manager.start(body).id,j.id);await flush();assert.equal(calls,n,'Same request must not invoke twice');
    reports.validateSave(store,{...done.draft});
  }
  assert.equal(store.reports.length,reportCount,'Generation does not save reports');assert.equal(JSON.stringify(store.departmentRuns),departmentBefore,'No fake project or stage advancement');
  let resolve;
  const delayed=reports.createManager({readStore,writeStore,execute:async(agent,prompt,ctx)=>{ctx.onBeforeStart();ctx.onStart({pid:124});return new Promise(r=>resolve=r);}});
  store.agendas[0].note='新的事实版本';
  const pending=delayed.start(input('codex'));await flush();
  assert.throws(()=>manager.start(input('codex')),e=>e.code==='already_claimed');
  store.agendas[0].review='执行期间已修改';assert.equal(delayed.get(pending.id).status,'uncertain');assert(gov.busy(store,'codex'),'A still-running obsolete request must retain member ownership');resolve('# 迟到报告');
  const held=await wait(delayed,pending.id);assert.equal(held.status,'held');assert.equal(held.draft,null);
  assert.equal(store.executionAttempts.find(a=>a.id===held.attemptId).output,'# 迟到报告');
  assert.throws(()=>reports.validateSave(store,{sourceJobId:pending.id,sourceHash:held.sourceHash}),e=>e.code==='report_source_changed');
  store.agendas[0].note='超时情景';
  const uncertain=delayed.start(input('cursor'));await flush();
  store.executionAttempts.find(a=>a.id===uncertain.attemptId).leaseExpiresAt='2000-01-01T00:00:00Z';
  const expired=delayed.get(uncertain.id);assert.equal(expired.status,'uncertain');
  assert.throws(()=>delayed.action(uncertain.id,'retry',{...input('cursor'),attemptId:expired.attemptId,resultHash:null,confirmed:true}),e=>e.code==='reconcile_required');
  delayed.action(uncertain.id,'reconcile',{idempotencyKey:'reconcile-fixture',confirmed:true,stopped:true,evidence:'Fixture executor explicitly stopped',resultHash:null,resolution:'do-not-apply'});
  resolve('# 已核对后迟到的返回');await flush();await flush();assert.equal(delayed.get(uncertain.id).status,'cancelled');
  const retry=manager.action(uncertain.id,'retry',{idempotencyKey:'retry-fixture',attemptId:expired.attemptId,resultHash:gov.get(store,expired.attemptId).resultHash,confirmed:true});assert.equal((await wait(manager,retry.id)).status,'done');
  store.agendas[0].note='重启情景';const restarted=delayed.start(input('codex'));await flush();delayed.recover();assert.equal(delayed.get(restarted.id).status,'uncertain');resolve('# 重启前返回');await flush();await flush();assert.equal(delayed.get(restarted.id).status,'held');
  // Actual queue files, claim receipts and self-reported start, with no desktop Agent.
  store.agendas[0].note='桌面领取情景';
  const queueRoot=path.join(root,'queue');
  const desktop=reports.createManager({readStore,writeStore,execute:(agent,prompt,ctx)=>require('../lib/desktop-bridge').generate(prompt,root,ctx,{root:queueRoot,pollMs:5,timeoutMs:2000})});
  const wb=desktop.start(input('workbuddy'));await flush();
  const claimed=queue.claim(queueRoot,{eligible:r=>queue.eligibleRequest(store,r),onClaim:r=>{
    const s=readStore(),a=gov.get(s,r.attemptId);gov.claim(s,a,{claimKey:'queue-fixture'});writeStore(s);return{attemptId:a.id,claimId:a.claimId,inputHash:a.inputHash};
  }});assert.equal(claimed.status,'claimed');
  const assignment=claimed.assignment;
  desktop.action(wb.id,'started',{attemptId:assignment.attemptId,claimId:assignment.claimId,inputHash:assignment.inputHash,idempotencyKey:'desktop-start'});
  fs.writeFileSync(assignment.resultPath,JSON.stringify({jobId:assignment.jobId,agentId:'workbuddy',attemptId:assignment.attemptId,claimId:assignment.claimId,output:'# WorkBuddy 队列返回报告'}));
  const returned=await wait(desktop,wb.id);assert.equal(returned.status,'done');assert.equal(returned.startedEvidence.source,'member-self-report');
  store.agendas[0].note='未领取期间事实变化';
  let finishWaiting;
  const waitingManager=reports.createManager({readStore,writeStore,execute:()=>new Promise(r=>finishWaiting=r)});
  const waiting=waitingManager.start(input('workbuddy'));await flush();
  const oldAttempt=gov.get(store,waiting.attemptId);store.agendas[0].note='已改为新事实';
  assert.equal(waitingManager.get(waiting.id).status,'held');
  assert.equal(queue.eligibleRequest(store,{runId:waiting.id,attemptId:oldAttempt.id,jobId:oldAttempt.jobId}),false);
  finishWaiting('# 不可采纳的旧返回');await flush();await flush();
  store.agendas[0].note='同一事实预算验证';
  for(let i=0;i<3;i++){const j=manager.start(input('codex'));assert.equal((await wait(manager,j.id)).status,'done');}
  assert.throws(()=>manager.start(input('codex')),e=>e.code==='execution_budget_exhausted');
  console.log('Report jobs: three isolated members, provider pause/no requests/key retention, exact idempotency, shared occupancy, source/late/restart guards, reconciliation/retry and real queue claim/start/result protocol passed; real Agents and paid model calls: 0.');
})().catch(e=>{console.error(e);process.exitCode=1;});
