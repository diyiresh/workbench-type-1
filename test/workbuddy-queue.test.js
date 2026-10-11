"use strict";
const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path');
const {claim,status}=require('../lib/workbuddy-queue');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'bench-queue-'));
function request(id,extra={}) {
  fs.writeFileSync(path.join(root,id+'.request.json'),JSON.stringify({jobId:id,transport:'desktop-scheduled',status:'queued',expiresAt:new Date(Date.now()+60000).toISOString(),resultPath:path.join(root,id+'.result.json'),prompt:'真实任务',...extra}));
}
try {
  request('a',{expiresAt:new Date(0).toISOString()});
  request('b');request('c');
  assert.equal(claim(root,{eligible:()=>false}).status,'idle');
  const first=claim(root);assert.equal(first.assignment.jobId,'b');
  assert.equal(claim(root).status,'busy','同一任务执行中不能领取第二项');
  assert.equal(status(root).heartbeat.status,'busy');
  assert.equal(status(root).heartbeat.jobId,'b');
  assert.equal(JSON.parse(fs.readFileSync(path.join(root,'b.request.json'))).status,'claimed');
  fs.writeFileSync(path.join(root,'b.result.json'),JSON.stringify({output:'已报送'}));
  assert.equal(claim(root).assignment.jobId,'c');
  assert.equal(status(root).online,true);
  request('d',{resultPath:path.join(root,'..','outside.json')});
  fs.writeFileSync(path.join(root,'c.result.json'),'{}');
  assert.throws(()=>claim(root),/path_mismatch/);
  assert(!fs.existsSync(path.join(root,'claim.lock')),'异常也必须释放领取锁');
  console.log('WorkBuddy queue serial, expiry, eligibility and path checks passed');
} finally {fs.rmSync(root,{recursive:true,force:true});}
