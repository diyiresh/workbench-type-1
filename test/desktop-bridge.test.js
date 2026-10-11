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
  console.log("Desktop bridge identity, duplicate and timeout checks passed");
 } finally {fs.rmSync(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
