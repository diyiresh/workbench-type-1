"use strict";
// Local queue transport only. No model calls, login or credential access.
const path=require('path');
const fs=require('fs');
const {status}=require('../lib/workbuddy-queue');
const root=path.resolve(__dirname,'..','data','workbuddy-queue');
(async()=>{
  if(process.argv[2]==='status')return console.log(JSON.stringify(status(root)));
  if(process.argv[2]==='started'){
    const jobId=process.argv[3];if(!/^[a-zA-Z0-9-]+$/.test(jobId||''))throw new Error('invalid_job_id');
    const request=JSON.parse(fs.readFileSync(path.join(root,jobId+'.request.json'),'utf8'));
    if(request.status!=='claimed'||!request.claimId||!request.attemptId)throw new Error('claim_receipt_required');
    const response=await fetch('http://127.0.0.1:3780/api/departments/runs/'+encodeURIComponent(request.runId)+'/execution/started',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({attemptId:request.attemptId,claimId:request.claimId,inputHash:request.inputHash,idempotencyKey:'started:'+request.attemptId+':'+request.claimId}),signal:AbortSignal.timeout(10000)});
    const result=await response.json();if(!response.ok)throw new Error(result.error||'start_receipt_rejected');return console.log(JSON.stringify(result));
  }
  const idempotencyKey=require('crypto').randomUUID();
  const response=await fetch('http://127.0.0.1:3780/api/workbuddy/claim',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({idempotencyKey,workerId:'workbuddy-desktop'}),signal:AbortSignal.timeout(10000)});
  const result=await response.json();
  if(!response.ok)throw new Error(result.error||'工作台领取未确认，停止执行并核对本机队列');
  console.log(JSON.stringify(result));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
