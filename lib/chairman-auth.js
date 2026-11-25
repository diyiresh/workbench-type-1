'use strict';
// HTTP authorization boundary, not isolation from processes able to rewrite local files.
// Enrollment is deliberately absent from HTTP. No credential is returned in /api/state.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {promisify}=require('node:util');
const scrypt=promisify(crypto.scrypt);
const ACTIONS=new Set(['start','appoint','approve','revise','acceptance','control','agent-start-confirm']);
async function credential(secret){
  if(typeof secret!=='string'||secret.length<12||secret.length>256)throw Error('approval_secret_length');
  const salt=crypto.randomBytes(16).toString('hex');
  return {version:1,salt,hash:(await scrypt(secret,salt,32)).toString('hex')};
}
function createAuth(dataDir){
  const file=path.join(dataDir,'chairman-auth.json');let failed=0,resetAt=0;
  return {async verify(req){
    const clock=Date.now();if(clock>resetAt){failed=0;resetAt=clock+60000;}
    if(failed>=8)return {ok:false,error:'chairman_auth_rate_limited'};
    let config;try{config=JSON.parse(fs.readFileSync(file,'utf8'));}catch{return {ok:false,error:'chairman_auth_setup_required'};}
    if(config.version!==1||!/^[a-f0-9]{32}$/.test(config.salt)||!/^[a-f0-9]{64}$/.test(config.hash))return {ok:false,error:'chairman_auth_setup_required'};
    const encoded=req.headers['x-workbench-chairman-secret'];
    if(typeof encoded!=='string'||encoded.length>1400||!/^[A-Za-z0-9_-]+$/.test(encoded))return {ok:false,error:'chairman_auth_required'};
    const supplied=Buffer.from(encoded,'base64url').toString('utf8');
    if(typeof supplied!=='string'||supplied.length<12||supplied.length>256)return {ok:false,error:'chairman_auth_required'};
    const got=await scrypt(supplied,config.salt,32),expected=Buffer.from(config.hash,'hex');
    if(!crypto.timingSafeEqual(got,expected)){failed++;return {ok:false,error:'chairman_auth_required'};}
    failed=0;return {ok:true};
  }};
}
module.exports={ACTIONS,credential,createAuth};
