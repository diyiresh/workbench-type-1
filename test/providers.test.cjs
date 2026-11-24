'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const ollama=require('../lib/providers/ollama'),desktop=require('../lib/providers/doubao'),gov=require('../lib/execution-governance');
test('Ollama only offers completion models and rejects unsafe endpoints or incomplete output',async()=>{
 const fetchImpl=async(url,opts)=>({ok:true,json:async()=>url.endsWith('/tags')?{models:[{name:'small'},{name:'embed'}]}:{capabilities:JSON.parse(opts.body).model==='small'?['completion']:['embedding']}});
 assert.deepEqual((await ollama.status({fetchImpl})).models,['small']);assert.throws(()=>ollama.base('https://example.com'),/invalid_local/);
 await assert.rejects(ollama.generate('tiny','.',{},{config:{model:'small'},fetchImpl:async()=>({ok:true,status:200,json:async()=>({done:true,done_reason:'length',message:{content:'partial'}})})}),/未完整/);
 assert.equal(await ollama.generate('tiny','.',{},{config:{model:'small'},maxTokens:64,fetchImpl:async()=>({ok:true,status:200,json:async()=>({done:true,message:{content:'complete'}})})}),'complete');
});
test('Doubao exact claim and atomic result are required; paused or stale attempts cannot submit',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'doubao-test-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const job={id:'provider-test',agentId:'doubao',prompt:'synthetic',controlGeneration:0};const s={agents:[{id:'doubao',status:'active'}],providerJobs:[job]};
 const a=gov.reserve(s,{runId:job.id,stepId:'probe',purpose:'provider-test',agentId:'doubao',jobId:job.id,transport:'desktop-manual'});
 const pending=desktop.generate('synthetic','.',{jobId:job.id,attemptId:a.id,runId:job.id},{root:dir,pollMs:5,timeoutMs:1000});
 assert.equal(desktop.tasks(s,dir).length,1);const receipt=desktop.claim(s,dir,job.id,{confirmed:true,idempotencyKey:'claim'});desktop.writeClaim(dir,job.id,receipt);
 assert.throws(()=>desktop.submit(s,dir,job.id,{...receipt,claimId:'wrong',confirmed:true,idempotencyKey:'bad',output:'answer'}),/result_identity/);
 desktop.submit(s,dir,job.id,{...receipt,confirmed:true,idempotencyKey:'good',output:'answer'});
 assert.equal(await pending,'answer');assert.equal(JSON.parse(fs.readFileSync(path.join(dir,job.id+'.result.json'))).attemptId,a.id);
 job.controlGeneration++;assert.throws(()=>desktop.submit(s,dir,job.id,{...receipt,confirmed:true,idempotencyKey:'stale',output:'answer'}));
});
test('provider APIs are read-only on GET and model configuration validates live inventory',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'provider-api-'));process.env.BENCH_DATA_DIR=dir;t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const {buildDefaultStore}=require('../lib/default-store');const s=buildDefaultStore();s.remote.vault={enabled:false};fs.writeFileSync(path.join(dir,'store.json'),JSON.stringify(s));
 const {createServer,readStore}=require('../server');readStore();const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());const url='http://127.0.0.1:'+server.address().port;
 const before=fs.readFileSync(path.join(dir,'store.json'),'utf8');const r=await fetch(url+'/api/providers');assert.equal(r.status,200);const v=await r.json();assert.equal(v.providers.find(p=>p.id==='docker').kind,'infrastructure');assert.equal(fs.readFileSync(path.join(dir,'store.json'),'utf8'),before);
 const invalid=await fetch(url+'/api/providers/ollama/configure',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:'not-installed'})});assert.equal(invalid.status,409);
});
test('real test records persist across reload, deduplicate and expose credential blockers',async()=>{
 let data={agents:[{id:'ollama',status:'active'},{id:'deepseek',status:'active'}],providerConnections:{ollama:{model:'small'}}},calls=0;
 const readStore=()=>structuredClone(data),writeStore=s=>{data=structuredClone(s);};
 const manager=require('../lib/provider-manager').createManager({readStore,writeStore,generate:async(id,prompt)=>{calls++;if(id==='deepseek')throw Object.assign(new Error('MISSING_CREDENTIAL'),{code:'auth_required'});return prompt.match(/BENCH-[a-f0-9]+/)[0];}});
 const first=manager.test('ollama',{confirmed:true,idempotencyKey:'one'});assert.equal(manager.test('ollama',{confirmed:true,idempotencyKey:'one'}).jobId,first.jobId);
 await new Promise(r=>setImmediate(r));assert.equal(calls,1);assert.equal(manager.job(first.jobId).status,'done');assert.equal(manager.list().providers.find(p=>p.id==='ollama').lastJob.id,first.jobId);
 const failed=manager.test('deepseek',{confirmed:true,idempotencyKey:'two'});await new Promise(r=>setImmediate(r));assert.equal(manager.job(failed.jobId).status,'failed');const p=manager.list().providers.find(p=>p.id==='deepseek');assert.equal(p.state,'unconfigured');assert.equal(p.testStatus,'failed');assert(p.testedAt);
});
