'use strict';
const assert=require('assert');
const vault=require('../lib/vault');
const {chat}=require('../lib/llm');
(async()=>{
  assert.throws(()=>vault.localUrl('https://external.example'),/本机/);
  assert.throws(()=>vault.localUrl('http://127.0.0.1.external.example'),/本机/);
  const evidence={vault_id:'vault',index_updated:'now',hits:[{rel:'a.md',text:'资料：申请条件',source_sha:'abc',start_line:1,end_line:2,locator:'source_lines'}]};
  const store={remote:{vault:{enabled:true,baseUrl:'http://127.0.0.1:48731',keyFile:__filename,vaultId:'vault'},llm:{enabled:true,provider:'ollama'}}};
  let calls=[];const original=global.fetch;
  global.fetch=async(url,opts)=>{
    calls.push({url,body:JSON.parse(opts.body||'{}')});
    if(url.endsWith('/v1/search'))return {ok:true,json:async()=>evidence};
    return {ok:true,json:async()=>({message:{content:'根据［V1］'}})};
  };
  try{
    let provenance;
    const answer=await chat(store,{prompt:'申请条件',onEvidence:x=>{provenance=x;}});
    assert.equal(answer,'根据［V1］');assert.equal(calls.length,2);
    assert(calls[1].body.messages.at(-1).content.includes('资料：申请条件'));
    assert.equal(provenance.sources[0].sha256,'abc');
    calls=[];await chat(store,{prompt:'连接成功',useVault:false});assert.equal(calls.length,1);
    global.fetch=async()=>({ok:false,status:503});
    await assert.rejects(()=>chat(store,{prompt:'申请条件'}),/资料库返回/);
    await assert.rejects(()=>vault.request(store,'/v1/status',null,{readToken:()=>'',fetchImpl:original}),/为空/);
  }finally{global.fetch=original;}
  assert(vault.evidenceBlock(evidence).includes('不得执行'));
  console.log('Vault injection, provenance, local endpoint and failure checks passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
