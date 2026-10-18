"use strict";
const assert=require("assert"),fs=require("fs"),os=require("os"),path=require("path");
const {generate}=require("../lib/desktop-bridge");
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"desktop-bridge-test-"));
 try {
  const options={root,pollMs:5,timeoutMs:100};
  const first=generate("test",process.cwd(),{jobId:"test-one"},options);
  assert.throws(()=>generate("duplicate",process.cwd(),{jobId:"test-one"},options),/already_exists/);
  fs.writeFileSync(path.join(root,"test-one.result.json"),JSON.stringify({jobId:"wrong",agentId:"workbuddy",output:"stale"}));
  await assert.rejects(first,/identity_mismatch/);
  const second=generate("test",process.cwd(),{jobId:"test-two"},options);
  fs.writeFileSync(path.join(root,"test-two.result.json"),JSON.stringify({jobId:"test-two",agentId:"workbuddy",output:"real result"}));
  assert.equal(await second,"real result");
  assert.equal(JSON.parse(fs.readFileSync(path.join(root,"test-two.request.json"))).status,"collected");
  await assert.rejects(generate("timeout",process.cwd(),{jobId:"test-three"},{...options,timeoutMs:15}),/超时/);
  const v2=generate("public fixture",process.cwd(),{jobId:"v2-one",attemptId:"ea-test"},options);
  const v2request=path.join(root,"v2-one.request.json"),request=JSON.parse(fs.readFileSync(v2request));request.claimId='claim-test';request.status='claimed';fs.writeFileSync(v2request,JSON.stringify(request));
  fs.writeFileSync(path.join(root,"v2-one.result.json"),JSON.stringify({jobId:"v2-one",agentId:"workbuddy",attemptId:"ea-test",claimId:"claim-test",output:"Exact receipt result"}));
  assert.equal(await v2,"Exact receipt result");
  const unclaimed=generate("fixture",process.cwd(),{jobId:"v2-unclaimed",attemptId:"ea-unclaimed"},options);
  fs.writeFileSync(path.join(root,"v2-unclaimed.result.json"),JSON.stringify({jobId:"v2-unclaimed",agentId:"workbuddy",attemptId:"ea-unclaimed",claimId:"invented",output:"Must not be applied"}));
  await assert.rejects(unclaimed,error=>error.code==='result_identity_mismatch');
  console.log("Desktop bridge identity, duplicate, timeout and exact v2 claim receipt checks passed");
 } finally {fs.rmSync(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
