'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'bench-execution-api-'));
process.env.BENCH_DATA_DIR=root;
const dept=require('../lib/department'),skills=require('../lib/skill-studio'),gov=require('../lib/execution-governance');
const state=require('../lib/default-store').buildDefaultStore();
state.remote.vault={enabled:false};state.modules=[];state.departmentRuns=[];
state.inbox=[{id:'ordinary',toAgentId:'workbuddy',body:'Public fixture: prepare a checklist.',status:'queued'}];
const preserved=structuredClone(state.inbox[0]);
const paused=dept.createDepartmentRun(state,{goal:'Paused synthetic goal',requiresWritingApproval:false,participantAgentIds:['codex','workbuddy','cursor'],delivery:{mode:'text'}});paused.automationPaused=true;
const live=dept.createDepartmentRun(state,{goal:'Public synthetic skill stage',requiresWritingApproval:false,participantAgentIds:['codex','workbuddy','cursor'],delivery:{mode:'text'}});
const queue=dept.createDepartmentRun(state,{goal:'Public synthetic desktop receipt',requiresWritingApproval:false,participantAgentIds:['codex','workbuddy','cursor'],delivery:{mode:'text'}});
dept.getItem(queue,'director').status='done';dept.getItem(queue,'director').output='Synthetic plan';dept.getItem(queue,'executor').status='queued';
queue.workbuddyTransport='desktop-scheduled';queue.automationPaused=true;
const req=body=>({...body,idempotencyKey:randomUUID()});
const skillId=skills.create(state,req({sourceRefs:[]})).skillId,skill=skills.get(state,skillId);
skills.mutate(state,path.join(root,'skill-library'),skillId,'draft',req({expectedRevision:skill.revision,name:'public-check',description:'Public rule',scope:'Synthetic only',allowedAgents:['codex'],markdown:'---\nname: public-check\ndescription: "Public rule"\n---\n\nPUBLIC_STAGE_RULE: distinguish returned output from accepted delivery.'}));
skills.mutate(state,path.join(root,'skill-library'),skillId,'publish',req({expectedRevision:skill.revision,confirmed:true}));
fs.writeFileSync(path.join(root,'store.json'),JSON.stringify(state));
let calls=0,release,promptUsed='';
require('../lib/codex').generate=async(prompt,context)=>{calls++;promptUsed=prompt;context.onStart?.({pid:12345});return new Promise(resolve=>{release=()=>resolve({text:'Public synthetic plan',threadId:'fixture'});});};
require('../lib/external-runtime').generate=(agent,prompt,cwd,context)=>{
  assert.equal(agent,'workbuddy');
  return require('../lib/desktop-bridge').generate(prompt,cwd,context,{root:path.join(root,'workbuddy-queue'),pollMs:5,timeoutMs:10000});
};
const {createServer,readStore,writeStore}=require('../server'),server=createServer();
const turn=()=>new Promise(resolve=>setTimeout(resolve,15));
async function until(predicate){for(let i=0;i<150;i++){if(predicate())return;await turn();}throw new Error('fixture_timeout');}
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
  async function post(route,body={},status=200){const response=await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const result=await response.json();assert.equal(response.status,status,JSON.stringify(result));return result;}
  const execution=id=>'/api/departments/runs/'+id+'/execution';
  readStore();const before=fs.readFileSync(path.join(root,'store.json'),'utf8');
  await fetch(base+execution(live.id));await fetch(base+'/api/extensions');assert.equal(fs.readFileSync(path.join(root,'store.json'),'utf8'),before);assert.equal(calls,0);
  const p=dept.getItem(paused,'director');
  for(const [route,body,status] of [
    ['/api/codex/jobs',{runId:paused.id,role:'director'},409],
    ['/api/departments/runs/'+paused.id+'/items/'+p.id+'/model-execute',{},409],
    ['/api/departments/runs/'+paused.id+'/items/'+p.id+'/action',{action:'start'},400],
    ['/api/departments/runs/'+paused.id+'/auto-run',{},400],
    ['/api/departments/runs/'+paused.id+'/automation',{enabled:true},400],
  ])await post(route,body,status);
  assert.equal(calls,0);assert.equal((readStore().executionAttempts||[]).length,0);
  const conversion=req({goal:'Synthetic checklist',deliverable:'A checklist',acceptance:'Each check has evidence',ownerAgentId:'workbuddy',reviewerAgentId:'cursor',requiresWritingApproval:true});
  const preview=await post('/api/inbox/ordinary/convert/preview',conversion);const conversionBody={...conversion,snapshot:preview.snapshot,confirmed:true};
  assert.equal(readStore().departmentRuns.length,3);
  const converted=await post('/api/inbox/ordinary/convert',conversionBody);assert.deepEqual(await post('/api/inbox/ordinary/convert',conversionBody),converted);
  await post('/api/inbox/ordinary/convert',{...conversionBody,goal:'changed'},409);
  assert.equal(readStore().departmentRuns.length,4);const convertedRun=readStore().departmentRuns.find(r=>r.id===converted.runId);assert.equal(convertedRun.automationPaused,true);assert.equal(convertedRun.externalAutomation,false);assert(!convertedRun.writingApproved);
  for(const key of ['body','status','toAgentId'])assert.equal(readStore().inbox.find(m=>m.id==='ordinary')[key],preserved[key]);
  const v=skill.versions[0];
  const bind=req({stepId:dept.getItem(live,'director').id,expectedGeneration:0,bindings:[{skillId,versionId:v.id,contentHash:v.contentHash}]});
  await post(execution(live.id)+'/skills',bind);await post(execution(live.id)+'/skills',bind);
  await post(execution(live.id)+'/skills',{...bind,bindings:[]},409);
  const start=req({runId:live.id,role:'director'});const job=(await post('/api/codex/jobs',start,202)).job;await until(()=>!!release);
  assert.equal((await post('/api/codex/jobs',start,202)).job.id,job.id);assert.equal(calls,1);assert.match(promptUsed,/PUBLIC_STAGE_RULE/);
  await post('/api/codex/jobs',{...start,role:'reviewer'},409);
  assert.equal(readStore().executionAttempts.find(a=>a.id===job.attemptId).startedEvidence.source,'process-event');
  let current=readStore().departmentRuns.find(r=>r.id===live.id);
  const pause=req({action:'pause',expectedGeneration:current.controlGeneration});await post(execution(live.id)+'/control',pause);await post(execution(live.id)+'/control',pause);
  current=readStore().departmentRuns.find(r=>r.id===live.id);await post(execution(live.id)+'/control',req({action:'resume',expectedGeneration:current.controlGeneration}));
  release();await until(()=>readStore().executionAttempts.find(a=>a.id===job.attemptId).state==='held');
  assert.equal(dept.getItem(readStore().departmentRuns.find(r=>r.id===live.id),'executor').status,'blocked');
  await post(execution(live.id)+'/retry',req({attemptId:job.attemptId,confirmed:true,resultHash:gov.hash('Public synthetic plan')}),409);
  const held=readStore().executionAttempts.find(a=>a.id===job.attemptId);
  await post(execution(live.id)+'/reconcile',req({attemptId:held.id,resultHash:held.resultHash,confirmed:true,stopped:false,evidence:'checked',resolution:'do-not-apply'}),409);
  await post(execution(live.id)+'/reconcile',req({attemptId:held.id,resultHash:held.resultHash,confirmed:true,stopped:true,evidence:'Synthetic process stopped; do not apply.',resolution:'do-not-apply'}));
  // Claim proof is committed in the ledger before a desktop assignment is returned.
  current=readStore().departmentRuns.find(r=>r.id===queue.id);await post(execution(queue.id)+'/control',req({action:'resume',expectedGeneration:current.controlGeneration||0}));
  await post('/api/departments/runs/'+queue.id+'/automation',{enabled:true});
  await until(()=>readStore().externalJobs?.some(j=>j.runId===queue.id));
  const desktop=readStore().externalJobs.find(j=>j.runId===queue.id);assert.equal(desktop.status,'waiting');assert.equal(dept.getItem(readStore().departmentRuns.find(r=>r.id===queue.id),'executor').status,'queued');
  gov.configure({skillRoot:path.join(root,'skill-library'),channelState:()=>({state:'paused'})});
  await post('/api/workbuddy/claim',req({workerId:'fixture'}),409);assert.equal(readStore().executionAttempts.find(a=>a.id===desktop.attemptId).state,'waiting');
  gov.configure({skillRoot:path.join(root,'skill-library'),channelState:()=>({state:'test-isolated'})});
  const claimBody=req({workerId:'fixture'}),claim=await post('/api/workbuddy/claim',claimBody);
  assert.equal(claim.assignment.attemptId,desktop.attemptId);assert(claim.assignment.claimId);assert.deepEqual(await post('/api/workbuddy/claim',claimBody),claim);
  assert.equal((await post('/api/workbuddy/claim',req({workerId:'other'}))).assignment,null);
  assert.equal(readStore().executionAttempts.find(a=>a.id===desktop.attemptId).state,'claimed');
  const started=req({attemptId:desktop.attemptId,claimId:claim.assignment.claimId,inputHash:claim.assignment.inputHash});
  await post(execution(queue.id)+'/started',{...started,claimId:'wrong'},409);
  const begun=await post(execution(queue.id)+'/started',started);assert.equal(begun.evidence.source,'member-self-report');assert.deepEqual(await post(execution(queue.id)+'/started',started),begun);
  fs.writeFileSync(claim.assignment.resultPath,JSON.stringify({jobId:desktop.id,agentId:'workbuddy',attemptId:desktop.attemptId,claimId:'wrong',output:'Untrusted fixture output'}));
  await until(()=>readStore().executionAttempts.find(a=>a.id===desktop.attemptId).state==='uncertain');
  await post('/api/workbuddy/claim',claimBody,409);
  assert.equal(dept.getItem(readStore().departmentRuns.find(r=>r.id===queue.id),'reviewer').status,'blocked');
  assert.equal(readStore().executionAttempts.find(a=>a.id===desktop.attemptId).blockerCode,'result_identity_mismatch');
  const raw=fs.readFileSync(path.join(root,'store.json'),'utf8');await fetch(base+execution(queue.id));assert.equal(fs.readFileSync(path.join(root,'store.json'),'utf8'),raw);
  console.log('Execution API: read-only refresh, legacy pause gates, pinned skill injection, duplicate receipts, late results, explicit reconciliation, paused conversion and desktop claim/result identity passed. Real Agent calls: 0.');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>server.close());
