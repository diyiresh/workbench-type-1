'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const gov=require('../lib/execution-governance'),dept=require('../lib/department'),duty=require('../lib/duty-coordinator'),queue=require('../lib/workbuddy-queue');
gov.configure({channelState:()=>({state:'test-isolated'})});
test('quiet coordinator ticks update volatile health without rewriting the ledger',()=>{
 let writes=0;const data={departmentRuns:[],executionAttempts:[]};const manager=duty.createCoordinator({readStore:()=>structuredClone(data),writeStore:()=>{writes++;},dataDir:os.tmpdir()});
 const at=Date.now();manager.tick(at);manager.tick(at+60000);assert.equal(writes,0);assert.equal(duty.board(data,at+60000).lastTickAt,new Date(at+60000).toISOString());
});
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'duty-test-')),dir=path.join(root,'workbuddy-queue');fs.mkdirSync(dir);t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 let data=require('../lib/default-store').buildDefaultStore();const run=dept.createDepartmentRun(data,{goal:'Synthetic failover',participantAgentIds:['codex','workbuddy','cursor'],requiresWritingApproval:false});run.externalAutomation=true;run.writingApproved=true;const step=dept.getItem(run,'executor');dept.getItem(run,'director').status='done';step.status='queued';
 duty.configure(data,run,{confirmed:true,enabled:true,expectedGeneration:run.controlGeneration||0});
 const a=gov.reserve(data,{runId:run.id,stepId:step.id,agentId:'workbuddy',jobId:'job-one',transport:'desktop-scheduled',timeoutMs:7800000});a.createdAt=new Date(Date.now()-76*60000).toISOString();
 data.externalJobs=[{id:a.jobId,runId:run.id,itemId:step.id,agentId:'workbuddy',attemptId:a.id,status:'waiting'}];
 const file=path.join(dir,a.jobId+'.request.json');fs.writeFileSync(file,JSON.stringify({jobId:a.jobId,attemptId:a.id,runId:run.id,status:'queued',transport:'desktop-scheduled',expiresAt:a.leaseExpiresAt,resultPath:path.join(dir,'job-one.result.json')}));
 const readStore=()=>structuredClone(data),writeStore=s=>{data=structuredClone(s);};const manager=duty.createCoordinator({readStore,writeStore,dataDir:root});
 return {root,dir,file,runId:run.id,stepId:step.id,attemptId:a.id,readStore,writeStore,manager};
}
test('75-minute unclaimed fallback fences queue, preserves judgment, uses independent review and is idempotent',t=>{
 const f=fixture(t);assert.equal(f.manager.withdraw(f.runId),true);const s=f.readStore(),r=dept.getRun(s,f.runId);assert.equal(dept.getItem(r,'executor').ownerAgentId,'cursor');assert.equal(dept.getItem(r,'reviewer').ownerAgentId,'codex');assert.equal(gov.get(s,f.attemptId).state,'cancelled');assert.equal(JSON.parse(fs.readFileSync(f.file)).status,'withdrawn');assert.equal(queue.claim(f.dir).assignment,null);assert.equal(f.manager.withdraw(f.runId),false);assert.equal(f.readStore().coordinator.log.length,1);assert.equal(r.items.find(i=>i.id===f.stepId).reassignments.length,1);
});
test('claim wins or shared lock is held: coordinator does not steal an active task',t=>{
 const f=fixture(t);fs.writeFileSync(path.join(f.dir,'claim.lock'),'');assert.equal(f.manager.withdraw(f.runId),false);fs.unlinkSync(path.join(f.dir,'claim.lock'));
 const s=f.readStore(),a=gov.get(s,f.attemptId);gov.claim(s,a,{claimKey:'worker',workerId:'workbuddy'});f.writeStore(s);const q=JSON.parse(fs.readFileSync(f.file));q.status='claimed';q.claimId=a.claimId;fs.writeFileSync(f.file,JSON.stringify(q));assert.equal(f.manager.withdraw(f.runId),false);assert.equal(dept.getItem(dept.getRun(f.readStore(),f.runId),'executor').ownerAgentId,'workbuddy');
});
test('approval, SLA, pause, draft evidence, input and budget gates prevent fallback',t=>{
 for(const condition of ['off','early','paused','draft','input','budget']){const f=fixture(t),s=f.readStore(),r=dept.getRun(s,f.runId),a=gov.get(s,f.attemptId);if(condition==='off')s.dutyPolicies[r.id].enabled=false;if(condition==='early')a.createdAt=new Date().toISOString();if(condition==='paused')r.automationPaused=true;if(condition==='draft')fs.writeFileSync(path.join(f.dir,'job-one.draft.txt'),'evidence');if(condition==='input')r.context='changed';if(condition==='budget')r.recoveryPolicy.maxAttempts=1;f.writeStore(s);assert.equal(f.manager.withdraw(r.id),false,condition);}
});
test('withdrawal journal repairs a crash before the ledger commit without re-opening the queue',t=>{
 const f=fixture(t);let fail=true;const m=duty.createCoordinator({readStore:f.readStore,writeStore:s=>{if(fail)throw Error('simulated disk failure');f.writeStore(s);},dataDir:f.root});assert.throws(()=>m.withdraw(f.runId),/disk failure/);assert.equal(JSON.parse(fs.readFileSync(f.file)).status,'withdrawn');assert.equal(queue.claim(f.dir).assignment,null);fail=false;assert.equal(m.withdraw(f.runId),true);assert.equal(f.readStore().coordinator.log.length,1);
});
test('board is read-only and reports actual ownership rather than resolving unknown work',t=>{
 const f=fixture(t),s=f.readStore(),before=JSON.stringify(s);const b=duty.board(s);assert(b.entries.some(e=>e.stepId===f.stepId&&e.waitingOn==='workbuddy'));assert.equal(JSON.stringify(s),before);f.manager.tick();assert(duty.board(f.readStore()).lastTickAt);
});
test('supplementary evidence reaches the handoff without leaking another project or claiming verification',t=>{
 const f=fixture(t),s=f.readStore(),r=dept.getRun(s,f.runId);s.artifacts=[{runId:r.id,name:'S1 actual source',path:'C:/synthetic/S1.txt',sha256:'recorded-hash',reviewStatus:'pending'},{runId:'other-project',name:'Foreign private material',path:'C:/other/private.txt'}];const prompt=dept.rolePrompt(r,dept.getItem(r,'executor'),s).prompt;assert.match(prompt,/S1 actual source/);assert.match(prompt,/登记不等于验收通过/);assert(!prompt.includes('Foreign private material'));assert(!prompt.includes('C:/other/private.txt'));
});
test('live desktop wait releases the runtime slot; Cursor can continue without cancelled attempt corruption',async t=>{
 const f=fixture(t),s=f.readStore(),r=dept.getRun(s,f.runId);s.executionAttempts=[];s.externalJobs=[];delete dept.getItem(r,'executor').activeAttemptId;fs.unlinkSync(f.file);f.writeStore(s);
 const calls=[];const runtime=require('../lib/external-runtime').createRuntime({readStore:f.readStore,writeStore:f.writeStore,artifactRoot:path.join(f.root,'results'),execute:async(id,prompt,cwd,context)=>{calls.push(id);if(id==='workbuddy')return require('../lib/desktop-bridge').generate(prompt,cwd,context,{root:f.dir,pollMs:5,timeoutMs:2000});return 'Complete synthetic revised output';}});
 const job=runtime.start(f.runId,f.stepId);await new Promise(r=>setImmediate(r));const first=f.readStore();gov.get(first,job.attemptId).createdAt=new Date(Date.now()-76*60000).toISOString();f.writeStore(first);assert.equal(f.manager.withdraw(f.runId),true);await new Promise(r=>setTimeout(r,30));
 assert.equal(f.readStore().externalJobs.find(j=>j.id===job.id).status,'dismissed');assert.equal(gov.get(f.readStore(),job.attemptId).state,'cancelled');runtime.tick();await new Promise(r=>setTimeout(r,30));assert.deepEqual(calls,['workbuddy','cursor']);assert.equal(dept.getItem(dept.getRun(f.readStore(),f.runId),'executor').status,'done');assert.equal(dept.getItem(dept.getRun(f.readStore(),f.runId),'reviewer').ownerAgentId,'codex');
});
test('native policy API persists approval without invalidating an in-flight attempt; board GET is read-only',async t=>{
 const f=fixture(t);process.env.BENCH_DATA_DIR=f.root;const data=f.readStore();data.dutyPolicies={};data.remote.vault={enabled:false};fs.writeFileSync(path.join(f.root,'store.json'),JSON.stringify(data));
 const {createServer,readStore}=require('../server');readStore();const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());const base='http://127.0.0.1:'+server.address().port;
 const before=fs.readFileSync(path.join(f.root,'store.json'),'utf8');const board=await fetch(base+'/api/coordinator/board');assert.equal(board.status,200);assert.equal(fs.readFileSync(path.join(f.root,'store.json'),'utf8'),before);
 const run=dept.getRun(readStore(),f.runId),body={confirmed:true,enabled:true,expectedGeneration:run.controlGeneration||0,idempotencyKey:'approve-unclaimed-rule'};
 for(let i=0;i<2;i++){const res=await fetch(base+'/api/departments/runs/'+run.id+'/execution/failover',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});assert.equal(res.status,200,JSON.stringify(await res.json()));}
 const fresh=readStore();assert.equal(duty.policy(fresh,run.id).enabled,true);assert.equal(fresh.executionCommands.filter(c=>c.key===body.idempotencyKey).length,1);gov.check(fresh,gov.get(fresh,f.attemptId));
});
