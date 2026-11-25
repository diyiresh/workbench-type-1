'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const flow=require('../lib/project-workflow'),gov=require('../lib/execution-governance');
const dept=require('../lib/department'),delivery=require('../lib/delivery');
const {buildDefaultStore}=require('../lib/default-store');
const {createManager}=require('../lib/project-workflow-runtime');
function plan(){return {goal:'公开材料清单',scope:'一份公开资料的清单',approach:'执行并独立审核',dependencies:'仅使用虚构材料',contingencies:'缺证据时报告缺口',milestones:[{id:'m1',title:'第一节点',deliverable:'清单',acceptance:'列出三项',dueAt:'2099-01-02T12:00:00+08:00',dependsOn:[],checks:[{at:'2099-01-01T12:00:00+08:00',contactRole:'executor',reason:'核实进度'}],checkBudget:2}]};}
function setup({files=false,execute,planData}={}){
  let saved=buildDefaultStore();saved.departmentRuns=[];saved.executionAttempts=[];
  const r=dept.createDepartmentRun(saved,{workflowVersion:2,goal:'公开虚构清单',roles:{director:'codex',executor:'workbuddy',reviewer:'cursor'},requiresWritingApproval:false,delivery:files?{mode:'files',profile:'single'}:{mode:'text'}});
  const runId=r.id,readStore=()=>structuredClone(saved),writeStore=s=>{gov.observeControls(s,saved);saved=structuredClone(s);};
  const normal=async(agent,prompt,context)=>{
    const s=saved.departmentRuns.find(r=>r.id===runId).items.find(i=>i.id===context.itemId);
    if(s.purpose==='role-probe'){const readback=fs.readFileSync(s.unitInput.fixture.path,'utf8');return JSON.stringify({role:s.role,readback,...(s.role==='director'?{plan:plan()}:s.role==='executor'?{output:readback}:{verdict:'pass',reason:'材料一致'})});}
    if(s.purpose==='plan-draft')return JSON.stringify({plan:planData||plan()});
    if(s.purpose==='plan-feedback')return JSON.stringify({position:'no-objection',comment:'可执行，保留独立审核'});
    if(s.purpose==='plan-finalize')return JSON.stringify({plan:planData||plan(),resolutions:saved.departmentRuns[0].planFeedback.map(f=>({feedbackId:f.id,decision:'accept',reason:'已核对'}))});
    if(s.purpose==='milestone-execution')return '# 清单\n\n1. 第一项\n2. 第二项\n3. 第三项';
    if(s.purpose==='milestone-review'){const r=saved.departmentRuns[0],m=r.milestones.find(m=>m.id===r.currentMilestoneId);return JSON.stringify({verdict:'pass',sourceHash:s.unitInput.sourceHash,checks:(m.criteria||[m.acceptance]).map((_,i)=>({criterionId:m.id+':a'+i,verdict:'pass',location:'执行正文第1至3项',quote:m.output.slice(0,20),reason:'逐项核对符合三项清单要求'})),fileProofs:(s.unitInput.fileSnapshot?.files||[]).map(f=>({artifactId:f.id,sha256:f.sha256,quote:fs.readFileSync(f.readbackPath,'utf8').slice(0,32)}))});}
    if(s.purpose==='lead-check')return JSON.stringify({progress:'已核实台账',evidence:'实际尝试记录',evidenceRefs:saved.executionAttempts.filter(a=>a.id!==s.activeAttemptId).slice(-1).map(a=>({attemptId:a.id,resultHash:a.resultHash||null})),unknowns:[],nextAction:'按批准节点继续',action:'report'});
    return '交付清单：节点已独立审核，详见实际成果；等待董事长验收。';
  };
  let manager;
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'bench-project-flow-'));
  const dm=delivery.createManager({readStore,writeStore,root});
  manager=createManager({readStore,writeStore,dataDir:root,execute:execute||normal,generateFiles:files?id=>dm.generate(id):undefined});
  const current=()=>readStore().departmentRuns.find(r=>r.id===runId);
  const command=(action,extra={})=>{const s=readStore(),r=s.departmentRuns.find(r=>r.id===runId);const b={expectedRevision:r.workflowRevision,expectedGeneration:r.controlGeneration||0,idempotencyKey:'wf:'+r.workflowRevision+':'+require('node:crypto').randomUUID(),...extra};const v=flow.command(s,r,action,b);writeStore(s);return v;};
  const advance=async()=>{for(let n=0;n<5;n++){manager.tick();await manager.drain();}};
  const approve=()=>{const s=readStore(),r=s.departmentRuns[0],p=flow.plan(r);return command('approve',{confirmed:true,planId:p.id,planHash:p.hash,appointmentRevision:r.roleAppointments.revision,deliveryHash:gov.hash(r.delivery.contract)});};
  return {readStore,writeStore,manager,current,command,advance,approve,root,normal};
}
test('three roles negotiate immutable versions; approval gates real work; acceptance is separate',async()=>{
  const x=setup();x.command('start');await x.advance();const r=x.current();
  assert.equal(r.status,'awaiting_plan_approval');assert.equal(r.planVersions.length,2);assert.equal(r.planFeedback.length,2);
  assert.equal(r.items.length,3);assert(!r.items.some(i=>i.role==='secretary'));
  assert(!x.readStore().executionAttempts.some(a=>a.extra.workflowPurpose==='milestone-execution'));
  assert.throws(()=>dept.startItem(x.readStore(),r.id,'executor'),/use_project_workflow/);
  const stale={confirmed:true,planId:r.planVersions[0].id,planHash:r.planVersions[0].hash,appointmentRevision:1,deliveryHash:gov.hash(r.delivery.contract)};
  assert.throws(()=>x.command('approve',stale),/plan_snapshot_changed/);
  x.approve();await x.advance();const delivered=x.current();assert.equal(delivered.status,'awaiting_acceptance');
  assert.equal(delivered.milestones[0].review.verdict,'pass');assert(delivered.finalOutput);
  const digest=flow.completionSnapshot(x.readStore(),delivered);x.command('acceptance',{confirmed:true,snapshot:digest});assert.equal(x.current().status,'completed');
});
test('concurrent feedback does not invalidate the other reply; duplicate command receipts are stable',async()=>{
  const x=setup();const store=x.readStore(),r=store.departmentRuns[0];const b={expectedRevision:0,expectedGeneration:0,idempotencyKey:'wf:0:same'};
  const first=flow.command(store,r,'start',b);assert.deepEqual(flow.command(store,r,'start',b),first);
  assert.throws(()=>flow.command(store,r,'start',{...b,confirmed:true}),/idempotency_conflict/);x.writeStore(store);
  await x.advance();assert.equal(x.current().planFeedback.length,2);
  assert(!x.readStore().executionAttempts.some(a=>a.state==='held'));
});
test('pause/resume keeps late results held and restart does not blindly redispatch',async()=>{
  let release;const x=setup({execute:(agent,prompt,context)=>agent==='codex'?new Promise(resolve=>{release=resolve;}):x.normal(agent,prompt,context)});
  x.command('start');x.manager.tick();await new Promise(resolve=>setImmediate(resolve));
  x.command('control',{action:'pause'});x.command('control',{action:'resume'});
  release(JSON.stringify({plan:plan()}));await x.manager.drain();assert.equal(x.current().planVersions.length,0);
  assert.equal(x.readStore().executionAttempts.find(a=>a.agentId==='codex').state,'held');
  const s=x.readStore();s.executionAttempts.find(a=>a.agentId==='codex').state='running';s.departmentRuns[0].items[0].status='doing';gov.recover(s);x.writeStore(s);x.manager.recover();
  assert.equal(x.current().items[0].status,'blocked');assert.equal(x.readStore().executionAttempts.find(a=>a.agentId==='codex').state,'uncertain');
  const count=x.readStore().executionAttempts.length;x.manager.tick();await x.manager.drain();assert.equal(x.readStore().executionAttempts.length,count);
});
test('real DOCX batch is independently reviewed and file changes invalidate final acceptance',async()=>{
  const x=setup({files:true});x.command('start');await x.advance();x.approve();
  for(let n=0;n<12&&!x.current().finalOutput;n++){x.manager.tick();await x.manager.drain();await new Promise(resolve=>setTimeout(resolve,15));}
  const r=x.current();assert.equal(r.status,'awaiting_acceptance',JSON.stringify({delivery:r.delivery,items:r.items.map(i=>({role:i.role,purpose:i.purpose,status:i.status,blocker:i.blocker})),attempts:x.readStore().executionAttempts.map(a=>({state:a.state,purpose:a.extra?.workflowPurpose,error:a.error}))}));assert.equal(r.delivery.state,'reviewed');
  const snap=r.milestones[0].fileSnapshot;assert(snap.files[0].bytes>0);assert(fs.existsSync(snap.files[0].path));
  const digest=flow.completionSnapshot(x.readStore(),r);fs.appendFileSync(snap.files[0].path,'changed');
  assert.throws(()=>x.command('acceptance',{confirmed:true,snapshot:digest}),/delivery_file_changed/);
});
test('bounded checks survive changed check IDs and repeated ticks; ordinary failures are owned by lead',async()=>{
  const x=setup();x.command('start');await x.advance();x.approve();const s=x.readStore(),r=s.departmentRuns[0];
  assert(flow.due(s,r,Date.parse('2099-01-01T13:00:00+08:00')));const count=r.supervision.events.length;
  flow.due(s,r,Date.parse('2099-01-01T13:00:00+08:00'));assert.equal(r.supervision.events.length,count);
  flow.block(s,r,flow.item(r,'executor'),gov.error('auth_required','执行通道尚未登录'));
  assert.equal(r.blockers[0].waitingOn,'codex');assert.equal(r.agentStartRequest,undefined);
  const lead=flow.item(r,'director');s.executionAttempts.push(...[1,2].map(n=>({id:'check-'+n,runId:r.id,stepId:lead.id,agentId:lead.ownerAgentId,purpose:'stage',extra:{workflowPurpose:'lead-check',milestoneId:'m1'},state:'returned'})));
  assert.throws(()=>flow.assertBudget(s,r,{...lead,purpose:'lead-check',unitInput:{milestoneId:'m1',checkId:'new-id'}}),/execution_budget_exhausted/);
});
test('missing roles, self-review and unconfigured members are never silently replaced',()=>{
  const s=buildDefaultStore();assert.throws(()=>dept.createDepartmentRun(s,{workflowVersion:2,goal:'虚构',roles:{director:'codex',executor:'cursor',reviewer:'cursor'}}),/independent/);
  const r=dept.createDepartmentRun(s,{workflowVersion:2,goal:'虚构'});assert.equal(r.items[0].ownerAgentId,'');
  assert.throws(()=>flow.command(s,r,'start',{idempotencyKey:'wf:0:missing',expectedRevision:0,expectedGeneration:0}),/workflow_member_unavailable/);
});
test('two file milestones retain separate batches and cannot reuse the prior review snapshot',async()=>{
  const p=plan();p.milestones.push({...structuredClone(p.milestones[0]),id:'m2',title:'第二节点',dependsOn:['m1']});
  const x=setup({files:true,planData:p});x.command('start');await x.advance();x.approve();
  for(let n=0;n<20&&!x.current().finalOutput;n++){x.manager.tick();await x.manager.drain();}
  const r=x.current();assert.equal(r.status,'awaiting_acceptance');assert(r.finalOutput);assert(r.milestones.every(m=>m.state==='done'));
  assert.notEqual(r.milestones[0].fileSnapshot.batchId,r.milestones[1].fileSnapshot.batchId);
  assert.equal(r.artifacts.length,2);assert.doesNotThrow(()=>flow.completionSnapshot(x.readStore(),r));
});
test('chairman revisions retain prior immutable plans and require fresh approval',async()=>{
  const x=setup();x.command('start');await x.advance();const before=structuredClone(x.current().planVersions);
  x.command('revise',{planId:before.at(-1).id,planHash:before.at(-1).hash,comment:'明确缺口处置，不扩大范围'});await x.advance();
  assert.equal(x.current().status,'awaiting_plan_approval');assert.deepEqual(x.current().planVersions.slice(0,2),before);assert.equal(x.current().planVersions.length,3);
  assert(!x.readStore().executionAttempts.some(a=>a.extra?.workflowPurpose==='milestone-execution'));
});
test('manual handoff binds the actual claim and validates structured output without role spoofing',async()=>{
  const x=setup();x.command('start');x.manager.tick();await x.manager.drain();const s=x.readStore(),r=s.departmentRuns[0];const start={idempotencyKey:'wf:'+r.workflowRevision+':manual',expectedRevision:r.workflowRevision,expectedGeneration:r.controlGeneration||0,stepId:r.items[0].id};
  const receipt=flow.command(s,r,'manual-start',start);x.writeStore(s);
  assert.throws(()=>x.command('manual-result',{attemptId:receipt.attemptId,claimId:'forged',output:JSON.stringify({plan:plan()})}),/result_identity_mismatch/);
  x.command('manual-result',{attemptId:receipt.attemptId,claimId:receipt.claimId,output:JSON.stringify({plan:plan()})});
  assert.equal(x.current().planningPhase,'feedback');assert.equal(x.current().workHistory[0].ownerAgentId,'codex');assert.equal(x.current().planVersions[0].attemptId,receipt.attemptId);
  x.command('manual-result',{attemptId:receipt.attemptId,claimId:receipt.claimId,output:JSON.stringify({plan:plan()})});assert.equal(x.current().planVersions.length,1);assert.equal(x.current().workHistory.filter(h=>h.purpose==='plan-draft').length,1);
});
test('lead format recovery is persistent, bounded and uses a fresh governed unit',async()=>{
  let count=0;const x=setup({execute:async(agent,prompt,context)=>++count===1?'invalid JSON':x.normal(agent,prompt,context)});
  x.command('start');x.manager.tick();await x.manager.drain();const failed=x.current().items[0];assert.equal(failed.recovery.status,'scheduled');
  const oldUnit=failed.unitId;x.manager.tick(Date.now()+31000);await x.manager.drain();
  assert.equal(x.current().planningPhase,'draft');assert.notEqual(x.current().items[0].unitId,oldUnit);assert.equal(x.readStore().executionAttempts.filter(a=>a.extra?.workflowPurpose==='role-probe'&&a.agentId==='codex').length,2);
});
test('changed historical files are rebuilt from the original source and independently re-reviewed',async()=>{
  const x=setup({files:true});x.command('start');await x.advance();x.approve();
  for(let n=0;n<12&&!x.current().finalOutput;n++){x.manager.tick();await x.manager.drain();}
  const old=x.current().milestones[0].fileSnapshot;fs.appendFileSync(old.files[0].path,'externally changed');
  x.manager.tick();await x.manager.drain();
  for(let n=0;n<12&&!x.current().finalOutput;n++){x.manager.tick();await x.manager.drain();}
  const r=x.current();assert(r.finalOutput);assert.notEqual(r.milestones[0].fileSnapshot.batchId,old.batchId);assert.equal(r.milestones[0].deliveryHistory[0].files.batchId,old.batchId);
  assert.equal(r.milestones[0].review.verdict,'pass');assert.equal(x.readStore().executionAttempts.filter(a=>a.extra?.workflowPurpose==='milestone-review').length,2);assert.doesNotThrow(()=>flow.completionSnapshot(x.readStore(),r));
});
module.exports={setup,plan};
test('unverified or fabricated capability replies cannot launch business work',async()=>{
 const x=setup({execute:async()=>JSON.stringify({role:'reviewer',readback:'invented'})});x.command('start');
 assert(x.current().items.every(s=>s.purpose==='role-probe'));x.manager.tick();await x.manager.drain();
 assert.equal(x.current().planVersions.length,0);assert.equal(Object.keys(x.current().roleChecks||{}).length,0);
 assert(!x.readStore().executionAttempts.some(a=>a.extra?.workflowPurpose==='plan-draft'));
});
test('expired capability evidence blocks dispatch and is renewed before executing',async()=>{
 const x=setup();x.command('start');await x.advance();const s=x.readStore(),r=s.departmentRuns[0];
 r.roleChecks.executor.expiresAt=new Date(Date.now()-1000).toISOString();x.writeStore(s);x.approve();
 assert.throws(()=>flow.guard(x.readStore(),x.current(),flow.item(x.current(),'executor')),/workflow_role_not_verified/);
 x.manager.tick();await x.manager.drain();assert.equal(flow.item(x.current(),'executor').purpose,'milestone-execution');
 assert(!x.readStore().executionAttempts.some(a=>a.extra?.workflowPurpose==='milestone-execution'));
 assert(flow.capabilityReady(x.readStore(),x.current(),'executor'));
 const changed=x.readStore();changed.providerConnections||={};changed.providerConnections.workbuddy={model:'changed-profile'};
 assert(!flow.capabilityReady(changed,changed.departmentRuns[0],'executor'));
});
test('copied PASS markers are not an independent review',async()=>{
 const x=setup({execute:async(agent,prompt,context)=>context.purpose==='workflow-milestone-review'?'VERDICT: PASS\nFILE_REVIEW: copied PASS':x.normal(agent,prompt,context)});
 x.command('start');await x.advance();x.approve();await x.advance();assert.notEqual(x.current().milestones[0].review?.verdict,'pass');assert.notEqual(x.current().status,'completed');
 assert.equal(flow.item(x.current(),'reviewer').blocker.code,'workflow_structured_output_required');
});
test('file hashes without matching actual readback excerpts cannot pass review',async()=>{
 const x=setup({files:true,execute:async(agent,prompt,context)=>{
  const value=await x.normal(agent,prompt,context);if(context.purpose!=='workflow-milestone-review')return value;
  const result=JSON.parse(value);result.fileProofs[0].quote='这段捏造的文本不在任何实际文件中123456';return JSON.stringify(result);
 }});
 x.command('start');await x.advance();x.approve();
 for(let n=0;n<8;n++){x.manager.tick();await x.manager.drain();}
 assert.notEqual(x.current().milestones[0].review?.verdict,'pass');assert.equal(flow.item(x.current(),'reviewer').blocker.code,'review_file_evidence_mismatch');
});
test('review is bound to the input result hash, not a newly copied current hash',async()=>{
 const x=setup();x.command('start');await x.advance();x.approve();x.manager.tick();await x.manager.drain();
 const s=x.readStore(),r=s.departmentRuns[0],reviewer=flow.item(r,'reviewer');assert.equal(reviewer.unitInput.sourceHash,r.milestones[0].resultHash);
 r.milestones[0].resultHash='different-result';x.writeStore(s);x.manager.tick();await x.manager.drain();
 assert.notEqual(x.current().milestones[0].review?.verdict,'pass');assert.equal(x.current().items.find(i=>i.role==='reviewer').blocker.code,'review_source_changed');
});
test('changing the channel profile during a call retains the result without advancing',async()=>{
 let release;const x=setup({execute:async(agent,prompt,context)=>context.purpose==='workflow-milestone-execution'?new Promise(resolve=>{release=resolve;}):x.normal(agent,prompt,context)});
 x.command('start');await x.advance();x.approve();x.manager.tick();await new Promise(resolve=>setImmediate(resolve));
 const s=x.readStore();s.providerConnections||={};s.providerConnections.workbuddy={model:'changed-during-call'};x.writeStore(s);release('实际返回但已过期的执行正文');await x.manager.drain();
 const a=x.readStore().executionAttempts.find(a=>a.extra?.workflowPurpose==='milestone-execution');assert.equal(a.state,'held');assert(a.output);assert.equal(x.current().milestones[0].resultHash,undefined);
});
test('capability probes contain only synthetic materials, not business context',async()=>{
 const prompts=[];const x=setup({execute:async(agent,prompt,context)=>{if(context.purpose==='workflow-role-probe')prompts.push(prompt);return x.normal(agent,prompt,context);}});
 const s=x.readStore();s.departmentRuns[0].context='PRIVATE_BUSINESS_FIXTURE_CONTEXT';x.writeStore(s);x.command('start');x.manager.tick();await x.manager.drain();
 assert.equal(prompts.length,3);assert(prompts.every(p=>!p.includes('PRIVATE_BUSINESS_FIXTURE_CONTEXT')&&!p.includes('公开虚构清单')));
});
test('every approved criterion requires a separate review finding',async()=>{
 const p=plan();p.milestones[0].criteria=['列出三项','每一项有明确名称'];
 const x=setup({planData:p,execute:async(agent,prompt,context)=>{const raw=await x.normal(agent,prompt,context);if(context.purpose!=='workflow-milestone-review')return raw;const result=JSON.parse(raw);result.checks.pop();return JSON.stringify(result);}});
 x.command('start');await x.advance();x.approve();await x.advance();assert.equal(flow.item(x.current(),'reviewer').blocker.code,'review_evidence_required');assert.notEqual(x.current().milestones[0].state,'done');
});

async function pendingCheck(override){
  const x=setup({execute:(agent,prompt,context)=>override&&context.purpose==='workflow-lead-check'?override(agent,prompt,context):x.normal(agent,prompt,context)});x.command('start');await x.advance();x.approve();
  const store=x.readStore(),r=store.departmentRuns[0];flow.block(store,r,flow.item(r,'executor'),gov.error('auth_required'));x.writeStore(store);return x;
}
test('lead checks close with actual receipt snapshots; replay cannot duplicate reports',async()=>{
  const x=await pendingCheck();x.manager.tick();await x.manager.drain();const r=x.current(),report=r.supervision.reports[0],event=r.supervision.events[0];
  assert.equal(event.state,'completed');assert.equal(event.attemptId,report.attemptId);assert(event.closedAt);assert(report.evidenceSnapshot.length);
  const store=x.readStore(),run=store.departmentRuns[0],attempt=store.executionAttempts.find(a=>a.id===report.attemptId);
  assert.deepEqual(flow.receive(store,run,flow.item(run,'director'),attempt),{duplicate:true});assert.equal(run.supervision.reports.length,1);
});
test('invented progress evidence fails visibly; explicit unknowns remain valid',async()=>{
  let x; x=await pendingCheck(async(agent,prompt,context)=>{
    if(context.purpose==='workflow-lead-check')return JSON.stringify({progress:'claimed progress',evidence:'unverified',nextAction:'check receipt',action:'report',evidenceRefs:[{attemptId:'invented',resultHash:null}],unknowns:[]});
    return x.normal(agent,prompt,context);
  });
  x.manager.tick();await x.manager.drain();assert.equal(x.current().supervision.events[0].state,'failed');assert.equal(x.current().supervision.reports.length,0);
  assert.match(flow.item(x.current(),'director').blocker.code,/workflow_progress_evidence_mismatch/);
  const y=await pendingCheck(async()=>JSON.stringify({progress:'尚无可确认结果',evidence:'缺少本轮进度回执',evidenceRefs:[],unknowns:['需要执行人补交实际进度回执'],nextAction:'负责人向执行人核实',action:'report'}));
  y.manager.tick();await y.manager.drain();assert.equal(y.current().supervision.events[0].state,'completed');assert.equal(y.current().supervision.reports[0].evidenceSnapshot.length,0);assert.equal(y.current().supervision.reports[0].unknowns.length,1);
});
test('finished milestones supersede unperformed checks without claiming progress inspection',async()=>{
  const x=setup();x.command('start');await x.advance();x.approve();const s=x.readStore(),r=s.departmentRuns[0];
  r.supervision.events.push({key:'pending-check',milestoneId:'m1',state:'queued',unitId:'superseded-unit'});x.writeStore(s);await x.advance();
  const event=x.current().supervision.events.find(e=>e.key==='pending-check');assert.equal(event.state,'superseded');assert(event.closedAt);assert(!event.attemptId);
});

test('quiet workflow tick reads once and does not write a heartbeat',()=>{
  const store=buildDefaultStore();store.departmentRuns=[];const run=flow.create(store,{goal:'公开虚构',requiresWritingApproval:false});run.externalAutomation=true;
  let reads=0,writes=0;const manager=createManager({readStore:()=>{reads++;return structuredClone(store)},writeStore:()=>writes++});manager.tick();assert.equal(reads,1);assert.equal(writes,0);
});
test('bounded receipts retain exact recent replies and reject expired or recycled keys without side effects',()=>{
  const x=setup(),oldest={expectedRevision:0,expectedGeneration:0,idempotencyKey:'wf:0:first',action:'pause'};
  x.command('control',{idempotencyKey:oldest.idempotencyKey,action:'pause'});
  let lastBody,lastReply;
  for(let n=0;n<130;n++){
    const r=x.current();lastBody={expectedRevision:r.workflowRevision,expectedGeneration:r.controlGeneration||0,idempotencyKey:'wf:'+r.workflowRevision+':check-'+n,action:n%2?'pause':'resume'};
    lastReply=x.command('control',lastBody);
  }
  const store=x.readStore(),run=store.departmentRuns[0],before=JSON.stringify(store);
  assert.equal(run.workflowReceipts.length,128);assert(run.workflowReceiptFloor>0);
  assert.deepEqual(flow.command(store,run,'control',lastBody),lastReply);
  assert.throws(()=>flow.command(store,run,'control',oldest),/workflow_receipt_expired/);
  assert.throws(()=>flow.command(store,run,'control',{...oldest,expectedRevision:run.workflowRevision,expectedGeneration:run.controlGeneration}),/workflow_idempotency_scope_invalid/);
  assert.equal(JSON.stringify(store),before);assert.equal(store.executionAttempts.length,0);assert.equal(run.workHistory.length,0);
});
test('legacy cached receipts remain readable; fresh unscoped commands cannot bypass expiry protection',()=>{
  const x=setup(),store=x.readStore(),run=store.departmentRuns[0];
  const body={expectedRevision:0,expectedGeneration:0,idempotencyKey:'legacy',action:'pause'},result={ok:true,runId:run.id,revision:1};
  run.workflowRevision=1;run.workflowReceipts.push({key:'legacy',digest:gov.hash({action:'control',body}),result});
  assert.deepEqual(flow.command(store,run,'control',body),result);
  assert.throws(()=>flow.command(store,run,'control',{...body,idempotencyKey:'new-unscoped',expectedRevision:1}),/workflow_idempotency_scope_invalid/);
  assert.equal(run.workflowRevision,1);
});
test('expiring a legacy manual receipt preserves its issued assignment on the actual attempt',async()=>{
  const x=setup();x.command('start');x.manager.tick();await x.manager.drain();
  const manual=x.command('manual-start',{stepId:flow.item(x.current(),'director').id});
  const store=x.readStore(),run=store.departmentRuns[0],attempt=store.executionAttempts.find(a=>a.id===manual.attemptId);
  assert.equal(attempt.manualPrompt,manual.prompt);delete attempt.manualPrompt;
  // Represent an old-format ledger where the only frozen assignment was in its receipt.
  run.workflowReceipts=run.workflowReceipts.filter(r=>r.result.attemptId===manual.attemptId);
  const first=run.workflowReceipts[0];delete first.requestRevision;
  for(let n=0;n<127;n++)run.workflowReceipts.push({key:'legacy-'+n,digest:'fixture',result:{ok:true,revision:run.workflowRevision}});
  x.writeStore(store);x.command('control',{action:'pause'});
  const current=x.readStore();assert.equal(current.departmentRuns[0].workflowReceipts.length,128);
  assert(!current.departmentRuns[0].workflowReceipts.some(r=>r.result.attemptId===manual.attemptId));
  assert.equal(current.executionAttempts.find(a=>a.id===manual.attemptId).manualPrompt,manual.prompt);
});
