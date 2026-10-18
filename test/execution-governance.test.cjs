'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const dept=require('../lib/department'),dispatch=require('../lib/agent-dispatch'),gov=require('../lib/execution-governance');
const clone=x=>structuredClone(x),turn=()=>new Promise(r=>setImmediate(r));
function fixture(){const store=require('../lib/default-store').buildDefaultStore();store.remote.vault={enabled:false};const run=dept.createDepartmentRun(store,{goal:'Public synthetic governance check',requiresWritingApproval:false});run.externalAutomation=true;dept.getItem(run,'director').status='done';dept.getItem(run,'director').output='Synthetic plan';const step=dept.getItem(run,'executor');step.status='queued';step.ownerAgentId='cursor';dept.getItem(run,'reviewer').ownerAgentId='workbuddy';return {store,run,step};}
(async()=>{
  const f=fixture();f.run.automationPaused=true;
  assert.throws(()=>dispatch.claim(f.store,{agentId:'cursor',runId:f.run.id}),/project_paused/);
  let {store,run,step}=fixture(),release;
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'bench-governance-'));
  const readStore=()=>clone(store),writeStore=s=>{gov.observeControls(s,store);store=clone(s);};
  const runtime=require('../lib/external-runtime').createRuntime({readStore,writeStore,artifactRoot:root,execute:()=>new Promise(r=>{release=r;})});
  runtime.start(run.id,step.id);await turn();let changed=readStore();changed.departmentRuns[0].automationPaused=true;writeStore(changed);changed=readStore();changed.departmentRuns[0].automationPaused=false;writeStore(changed);
  release('Public synthetic result');await turn();await turn();
  assert.equal(store.externalJobs[0].status,'held');assert.equal(dept.getItem(store.departmentRuns[0],'reviewer').status,'blocked');
  assert.equal(store.executionAttempts[0].state,'held');assert.equal(store.executionAttempts[0].output,'Public synthetic result');
  const p=fixture(),a=gov.reserve(p.store,{runId:p.run.id,stepId:p.step.id,agentId:'cursor',jobId:'one',transport:'external-cli'});
  gov.claim(p.store,a,{claimKey:'same',workerId:'worker'});assert.equal(gov.claim(p.store,a,{claimKey:'same'}).claimId,a.claimId);assert.throws(()=>gov.claim(p.store,a,{claimKey:'other'}),/already_claimed/);
  assert.throws(()=>gov.reserve(p.store,{runId:p.run.id,stepId:p.step.id,agentId:'cursor',jobId:'two'}),/already_claimed/);
  gov.starting(p.store,a,'exact input');gov.recover(p.store);assert.equal(a.state,'uncertain');assert.throws(()=>gov.reserve(p.store,{runId:p.run.id,stepId:p.step.id,agentId:'cursor',jobId:'three'}),/already_claimed/);
  gov.reconcile(p.store,a,{confirmed:true,stopped:true,resultHash:null,resolution:'do-not-apply',evidence:'Verified stopped. Do not apply this attempt.'});assert.equal(a.state,'cancelled');
  // Expiry never releases ownership for automatic resend.
  const expired=fixture(),lease=gov.reserve(expired.store,{runId:expired.run.id,stepId:expired.step.id,agentId:'cursor',jobId:'expired'});
  lease.leaseExpiresAt=new Date(Date.now()-100).toISOString();assert.throws(()=>gov.claim(expired.store,lease,{claimKey:'expired'}),/lease_expired/);
  assert.throws(()=>gov.reserve(expired.store,{runId:expired.run.id,stepId:expired.step.id,agentId:'cursor',jobId:'replacement'}),/already_claimed/);
  gov.reconcile(expired.store,lease,{confirmed:true,stopped:true,resultHash:null,resolution:'do-not-apply',evidence:'Checked no active session.'});assert.equal(lease.state,'cancelled');
  const budget=fixture();
  for(let i=0;i<3;i++){const trial=gov.reserve(budget.store,{runId:budget.run.id,stepId:budget.step.id,agentId:'cursor',jobId:'trial-'+i});gov.failed(budget.store,trial,gov.error('auth_required'));}
  assert.throws(()=>gov.reserve(budget.store,{runId:budget.run.id,stepId:budget.step.id,agentId:'cursor',jobId:'fourth'}),/execution_budget_exhausted/);
  // A late callback cannot cancel a newer owner's stage; duplicate outputs are stable.
  const old=fixture(),first=gov.reserve(old.store,{runId:old.run.id,stepId:old.step.id,agentId:'cursor',jobId:'old'});gov.starting(old.store,first,'input');gov.recover(old.store);
  gov.reconcile(old.store,first,{confirmed:true,stopped:true,resultHash:null,resolution:'do-not-apply',evidence:'Stopped.'});
  const newer=gov.reserve(old.store,{runId:old.run.id,stepId:old.step.id,agentId:'cursor',jobId:'new'});gov.starting(old.store,newer,'input');
  assert(gov.collect(old.store,first,'late').held);assert.equal(old.step.activeAttemptId,newer.id);assert.equal(newer.state,'running');assert.equal(first.state,'cancelled');assert.throws(()=>gov.beforeStart(old.store,first.id),/input_changed|attempt_interrupted/);assert(gov.collect(old.store,first,'late').held);assert(gov.collect(old.store,first,'late').duplicate);assert.throws(()=>gov.collect(old.store,first,'different'),/result_identity_mismatch/);
  // Global member capacity includes skill tests, not only formal project stages.
  const occupied=fixture();occupied.store.skillRuns=[{id:'test',agentId:'cursor',state:'running'}];assert.throws(()=>gov.reserve(occupied.store,{runId:occupied.run.id,stepId:occupied.step.id,agentId:'cursor',jobId:'blocked'}),/already_claimed/);
  console.log('Governance regression: paused claim, pause/resume late results, durable ownership, idempotent receipts, restart uncertainty and explicit reconciliation passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
