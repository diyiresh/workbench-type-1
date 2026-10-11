"use strict";
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const probe = require('../scripts/wecom-trigger-probe');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-im-probe-'));
  try {
    const record = probe.prepare(dir), config = { senderBotId:'sender', receiverBotId:'receiver', chatId:'private-test', testOnly:true };
    let calls = 0;
    const client = { sendMessage: async () => { calls++; return {errcode:0}; } };
    await assert.rejects(probe.send(record, {...config,receiverBotId:'sender'},client,dir), /现有连接/);
    await probe.send(record,config,client,dir);
    assert.equal(probe.verify(dir,record.jobId).executed,false,'发送ACK不是执行成功');
    await assert.rejects(probe.send(record,config,client,dir), /不自动重发/);
    assert.equal(calls,1);
    fs.writeFileSync(record.resultPath, JSON.stringify({jobId:record.jobId,agentId:'cursor',output:'2597'}));
    assert.throws(()=>probe.verify(dir,record.jobId), /身份/);
    fs.writeFileSync(record.resultPath, JSON.stringify({jobId:record.jobId,agentId:'workbuddy',output:'49×53=2597'}));
    assert.equal(probe.verify(dir,record.jobId).executed,true);
    const uncertain=probe.prepare(dir);
    await assert.rejects(probe.send(uncertain,config,{sendMessage:async()=>{throw new Error('secret should not leak');}},dir),/不记录凭据/);
    await assert.rejects(probe.send(uncertain,config,client,dir),/不自动重发/);
    console.log('IM probe ACK boundary, identity, connection isolation and duplicate checks passed (mock transport)');
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
})().catch(e=>{console.error(e);process.exitCode=1});
