"use strict";
const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path');
const {buildDefaultStore}=require('../lib/default-store');
const dept=require('../lib/department'),dispatch=require('../lib/agent-dispatch');
const {createManager}=require('../lib/codex-jobs');
const {createRuntime}=require('../lib/external-runtime');
(async()=>{
  let store=buildDefaultStore();store.remote.vault={enabled:false};
  const run=dept.createDepartmentRun(store,{goal:'单功能验收 29乘37',participantAgentIds:['codex','workbuddy','cursor'],requiresWritingApproval:false});
  run.externalAutomation=true;
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'bench-loop-'));
  const readStore=()=>structuredClone(store),writeStore=s=>{store=structuredClone(s);dispatch.syncAssignments(store)};
  const calls=[];
  const codex=createManager({readStore,writeStore,generate:async prompt=>{calls.push('codex');return {text:prompt.includes('整合秘书')?'最终：1073':'计算29乘37，验收1073'};}});
  const runtime=createRuntime({readStore,writeStore,artifactRoot:root,execute:async(agent,prompt,cwd,context)=>{
    calls.push(agent);
    if(agent==='workbuddy') {
      assert.equal(dept.getItem(dept.getRun(store,run.id),'executor').status,'queued','未实际领取前不得假报已领取');
      const fresh=readStore();dispatch.claim(fresh,{agentId:'workbuddy',runId:run.id});writeStore(fresh);
      assert.equal(context.transport,'desktop-scheduled');return '29×37=1073';
    }
    assert(prompt.includes('29×37=1073'));return '独立计算确认1073\nVERDICT: PASS';
  }});
  try {
    for(let i=0;i<12;i++){codex.tick();runtime.tick();await new Promise(r=>setImmediate(r));}
    const result=dept.getRun(store,run.id);
    assert.equal(result.status,'completed');assert.equal(result.finalOutput,'最终：1073');
    assert.deepEqual(calls,['codex','workbuddy','cursor','codex']);
    assert.equal(result.items.every(i=>i.status==='done'),true);
    assert.equal(store.externalJobs.every(j=>j.status==='done'),true);
    assert(store.projectMessages.some(m=>m.sender==='cursor'&&m.type==='review'));
    for(let i=0;i<3;i++){codex.tick();runtime.tick();}
    assert.equal(calls.length,4,'已完成项目不能重复派工');
    console.log('Automatic department director, true claim, review and secretary checks passed');
  } finally {fs.rmSync(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1});
