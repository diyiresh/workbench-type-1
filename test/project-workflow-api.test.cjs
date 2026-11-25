'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'bench-project-workflow-api-'));process.env.BENCH_DATA_DIR=root;
const state=require('../lib/default-store').buildDefaultStore(),dept=require('../lib/department');
state.remote.vault={enabled:false};state.departmentRuns=[];state.executionAttempts=[];
const current=dept.createDepartmentRun(state,{workflowVersion:2,goal:'公开虚构 API 契约测试',roles:{director:'cursor',executor:'codex',reviewer:'workbuddy'},delivery:{mode:'text'}});
const legacy=dept.createDepartmentRun(state,{goal:'历史记录必须保留'}),legacyBefore=JSON.stringify(legacy);
require('./helpers/workflow-capability-fixture.cjs')(state,current);
fs.writeFileSync(path.join(root,'store.json'),JSON.stringify(state));let calls=0;
require('../lib/codex').generate=async()=>{calls++;throw Error('Unexpected real execution');};
require('../lib/external-runtime').generate=async()=>{calls++;throw Error('Unexpected real execution');};
const {createServer,readStore,writeStore}=require('../server'),server=createServer();
(async()=>{
 const approvalSecret='public-fixture-passphrase-2026';fs.writeFileSync(path.join(root,'chairman-auth.json'),JSON.stringify(await require('../lib/chairman-auth').credential(approvalSecret)));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
  const request=async(suffix,body,method='POST')=>{const r=await fetch(base+'/api/departments/runs/'+current.id+suffix,{method,headers:{'Content-Type':'application/json','X-Workbench-Chairman-Secret':Buffer.from(approvalSecret).toString('base64url')},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};};
  for(let n=0;n<2;n++)assert.equal((await request('/workflow',null,'GET')).body.revision,0);
  assert.equal(calls,0);
  for(const action of ['approve','acceptance','appoint','revise','control','agent-start-confirm']){const denied=await fetch(base+'/api/departments/runs/'+current.id+'/workflow/'+action,{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify({confirmed:true,agentId:'chairman'})});assert.equal(denied.status,403,action);assert.equal((await denied.json()).error,'chairman_auth_required');}
  const bulk=await fetch(base+'/api/state',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(state)});assert.equal(bulk.status,403);
  const reset=await fetch(base+'/api/reset',{method:'POST'});assert.equal(reset.status,403);
  const exposed=await(await fetch(base+'/api/state')).text();assert(!exposed.includes(approvalSecret));assert(!exposed.includes('"salt"'));
  for(const suffix of ['/auto-run','/automation','/execution/approve','/execution/assign','/items/'+current.items[1].id+'/model-execute','/items/'+current.items[1].id+'/action'])assert.equal((await request(suffix,{})).body.error,'use_project_workflow',suffix);
  assert.equal((await request('',{roleOwners:{director:'codex'}},'PATCH')).body.error,'use_project_workflow');
  const stale=await request('/workflow/appoint',{expectedRevision:9,expectedGeneration:0,idempotencyKey:'stale',roles:{director:'codex',executor:'cursor',reviewer:'workbuddy'}});assert.equal(stale.body.error,'input_changed');
  const body={expectedRevision:0,expectedGeneration:0,idempotencyKey:'wf:0:appoint',roles:{director:'codex',executor:'cursor',reviewer:'workbuddy'}};
  const a=await request('/workflow/appoint',body),b=await request('/workflow/appoint',body);assert.equal(a.status,200);assert.deepEqual(a.body,b.body);
  assert.equal((await request('/workflow/appoint',{...body,roles:{director:'cursor',executor:'codex',reviewer:'workbuddy'}})).body.error,'idempotency_conflict');
  const unscoped=await request('/workflow/appoint',{expectedRevision:1,expectedGeneration:readStore().departmentRuns.find(r=>r.id===current.id).controlGeneration||0,idempotencyKey:'new-unscoped',roles:{director:'codex',executor:'cursor',reviewer:'workbuddy'}});assert.equal(unscoped.status,409);assert.equal(unscoped.body.error,'workflow_idempotency_scope_invalid');
  const all=readStore();assert.equal(JSON.stringify(all.departmentRuns.find(r=>r.id===legacy.id)),legacyBefore);assert.equal(calls,0);
  // Exercise the real local desktop queue protocol, without calling a model or desktop app.
  const flow=require('../lib/project-workflow'),runtime=require('../lib/project-workflow-runtime');
  const fixture=readStore(),r=fixture.departmentRuns.find(r=>r.id===current.id);require('./helpers/workflow-capability-fixture.cjs')(fixture,r);r.externalAutomation=true;
  r.planVersions=[{id:'queue-plan',number:1,kind:'draft',content:{goal:'公开虚构材料'},hash:'fixture-hash'}];
  flow.queue(r,'reviewer','plan-feedback',{planId:'queue-plan',planHash:'fixture-hash'});writeStore(fixture);
  const queueRoot=path.join(root,'workbuddy-queue');
  const manager=runtime.createManager({readStore,writeStore,execute:(agent,prompt,context)=>{
    assert.equal(agent,'workbuddy');return require('../lib/desktop-bridge').generate(prompt,process.cwd(),context,{root:queueRoot,pollMs:5,timeoutMs:10000});
  }});
  const job=manager.start(r.id,flow.item(r,'reviewer').id);
  for(let n=0;n<100&&!fs.existsSync(path.join(queueRoot,job.id+'.request.json'));n++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(readStore().executionAttempts.find(a=>a.id===job.attemptId).state,'waiting');
  const claimedResponse=await fetch(base+'/api/workbuddy/claim',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({idempotencyKey:'desktop-flow-claim',workerId:'synthetic-worker'})});
  const claimed=await claimedResponse.json();assert.equal(claimedResponse.status,200,JSON.stringify(claimed));assert.equal(claimed.assignment.attemptId,job.attemptId);
  const draft=path.join(queueRoot,job.id+'.draft.txt');fs.writeFileSync(draft,JSON.stringify({position:'no-objection',comment:'合成测试意见',role:'executor',agentId:'codex',planId:'forged',attemptId:'forged'}));
  await require('../lib/workbuddy-submit').submit({root:queueRoot,jobId:job.id,draftPath:draft,baseUrl:base});await manager.drain();
  const feedback=readStore().departmentRuns.find(r=>r.id===current.id).planFeedback[0];assert.equal(feedback.agentId,'workbuddy');assert.equal(feedback.role,'reviewer');assert.equal(feedback.planId,'queue-plan');assert.equal(feedback.attemptId,job.attemptId);
  console.log('Workflow API: read-only GET, legacy bypass prevention, role authority, snapshot conflicts and idempotency passed. No live model calls.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>server.close());
