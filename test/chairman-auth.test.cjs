'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {credential,createAuth}=require('../lib/chairman-auth');
test('approval authentication fails closed, never provisions via HTTP, supports Unicode and bounds guesses',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'chairman-auth-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const auth=createAuth(root),request=secret=>({headers:secret?{'x-workbench-chairman-secret':Buffer.from(secret).toString('base64url')}:{}});
 assert.equal((await auth.verify(request('unconfigured-public-secret'))).error,'chairman_auth_setup_required');
 assert(!fs.existsSync(path.join(root,'chairman-auth.json')));
 const secret='合成测试口令—不是业务凭据123456';const record=await credential(secret);assert(!JSON.stringify(record).includes(secret));
 fs.writeFileSync(path.join(root,'chairman-auth.json'),JSON.stringify(record));
 assert.equal((await auth.verify(request())).ok,false);assert.equal((await auth.verify(request('wrong-secret-123456'))).ok,false);
 assert.equal((await auth.verify(request(secret))).ok,true);
 for(let n=0;n<8;n++)assert.equal((await auth.verify(request('wrong-secret-123456'))).ok,false);
 assert.equal((await auth.verify(request(secret))).error,'chairman_auth_rate_limited');
});
