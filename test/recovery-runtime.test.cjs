'use strict';
const assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const dept=require('../lib/department'),gov=require('../lib/execution-governance'),failures=require('../lib/runtime-failure');
const turn=()=>new Promise(r=>setImmediate(r));
(async()=>{
 let store=require('../lib/default-store').buildDefaultStore();store.remote.vault={enabled:false};
 const run=dept.createDepartmentRun(store,{goal:'Synthetic full handoff',requiresWritingApproval:false,delivery:{mode:'text'}});run.externalAutomation=true;
 dept.getItem(run,'director').status='done';dept.getItem(run,'director').output='Plan';const executor=dept.getItem(run,'executor');executor.status='done';executor.output='Keep this complete draft';const reviewer=dept.getItem(run,'reviewer');reviewer.status='queued';reviewer.ownerAgentId='cursor';
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'recovery-runtime-'));store.codexJobs=[{id:'old-codex-review',runId:run.id,role:'reviewer',attemptId:'historical-review',status:'failed'}];
 const readStore=()=>structuredClone(store),writeStore=s=>{gov.observeControls(s,store);store=structuredClone(s);};
 let externalCalls=0,codexCalls=0;
 const external=require('../lib/external-runtime').createRuntime({readStore,writeStore,artifactRoot:root,execute:async(agent,prompt,cwd,ctx)=>{externalCalls++;const t={pid:100+externalCalls,closedAt:new Date().toISOString(),exitCode:1};ctx.onStart({pid:t.pid});ctx.onClose(t);throw failures.closed(new Error('Client network socket disconnected before secure TLS connection was established'),t);}});
 const codex=require('../lib/codex-jobs').createManager({readStore,writeStore,generate:async(prompt,ctx)=>{codexCalls++;ctx.onStart({pid:200});ctx.onClose({pid:200,closedAt:new Date().toISOString(),exitCode:0});return {text:'Reviewed saved draft.\nVERDICT: PASS',threadId:'synthetic'};}});
 external.tick();await turn();await turn();assert.equal(externalCalls,1);assert.equal(store.executionAttempts[0].state,'failed');
 external.tick();assert.equal(dept.getItem(store.departmentRuns[0],'reviewer').recovery.status,'scheduled');external.tick();assert.equal(externalCalls,1);
 let s=readStore();dept.getItem(s.departmentRuns[0],'reviewer').recovery.nextRetryAt=new Date(0).toISOString();writeStore(s);
 // A reconstructed runtime resumes the persisted plan, not a whole project.
 external.tick();await turn();await turn();assert.equal(externalCalls,2);external.tick();
 s=readStore();dept.getItem(s.departmentRuns[0],'reviewer').recovery.nextRetryAt=new Date(0).toISOString();writeStore(s);external.tick();codex.tick();await turn();await turn();
 assert.equal(codexCalls,1);assert.equal(externalCalls,2);const r=store.departmentRuns[0];assert.equal(dept.getItem(r,'reviewer').ownerAgentId,'codex');assert.equal(dept.getItem(r,'reviewer').status,'done');assert.equal(dept.getItem(r,'executor').output,'Keep this complete draft');assert.equal(dept.getItem(r,'secretary').status,'queued');assert.equal(store.executionAttempts.filter(a=>a.stepId===reviewer.id).length,3);
 assert(store.projectMessages.some(m=>m.text.includes('替补复核')));assert.equal(dept.getItem(r,'reviewer').recovery.status,'completed');
 fs.rmSync(root,{recursive:true,force:true});console.log('Runtime recovery: two network failures, persisted retry, Codex fallback and unchanged upstream draft passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
