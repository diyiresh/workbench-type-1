"use strict";
// Local queue transport only. No model calls, login or credential access.
const path=require('path');
const fs=require('fs');
const {claim,status,eligibleRequest}=require('../lib/workbuddy-queue');
const root=path.resolve(__dirname,'..','data','workbuddy-queue');
(async()=>{
  if(process.argv[2]==='status')return console.log(JSON.stringify(status(root)));
  const store=JSON.parse(fs.readFileSync(path.resolve(__dirname,'..','data','store.json'),'utf8'));
  const result=claim(root,{eligible:r=>eligibleRequest(store,r)});
  if(result.assignment && !(store.chatJobs||[]).some(j=>j.id===result.assignment.jobId)) {
    const response=await fetch('http://127.0.0.1:3780/api/agents/claim',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({agentId:'workbuddy',runId:result.assignment.runId}),signal:AbortSignal.timeout(10000)});
    const reply=await response.json();
    if(!response.ok||reply.assignment?.item?.id!==result.assignment.itemId)throw new Error('工作台领取未确认，停止执行并核对本机队列');
  }
  console.log(JSON.stringify(result));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
