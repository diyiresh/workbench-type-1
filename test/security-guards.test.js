const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'bench-security-'));
process.env.BENCH_DATA_DIR=root;
const {buildDefaultStore}=require('../lib/default-store');
const state=buildDefaultStore();
state.remote={...(state.remote||{}),llm:{provider:'openai',baseUrl:'http://127.0.0.1:9',model:'m',apiKey:'sk-test-secret-value'},reminder:{provider:'pushplus',enabled:true,token:'push-secret-token'}};
fs.writeFileSync(path.join(root,'store.json'),JSON.stringify(state));
const {createServer}=require('../server');
const server=createServer();
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const host=new URL(base).host;

  const raw=await (await fetch(base+'/api/state')).text();
  assert.equal(raw.includes('sk-test-secret-value'),false,'API key must not leave the server');
  assert.equal(raw.includes('push-secret-token'),false,'Push token must not leave the server');
  const pub=JSON.parse(raw);
  assert.equal(pub.remote.llm.hasKey,true);assert.equal(pub.remote.reminder.hasToken,true);
  const ledger=JSON.parse(fs.readFileSync(path.join(root,'store.json'),'utf8'));
  assert.equal(ledger.remote.llm.apiKey,'sk-test-secret-value','Redaction must not touch the ledger');

  const crossSite=await fetch(base+'/api/tasks',{method:'POST',headers:{'Content-Type':'text/plain',Origin:'https://evil.example'},body:JSON.stringify({title:'csrf'})});
  assert.equal(crossSite.status,403);
  const fetchSite=await fetch(base+'/api/tasks',{method:'POST',headers:{'Sec-Fetch-Site':'cross-site'},body:JSON.stringify({title:'csrf'})});
  assert.equal(fetchSite.status,403);
  const sameOrigin=await fetch(base+'/api/tasks',{method:'POST',headers:{'Content-Type':'application/json',Origin:'http://'+host},body:JSON.stringify({title:'same origin'})});
  assert.equal(sameOrigin.status,200);
  const agent=await fetch(base+'/api/tasks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:'agent without origin'})});
  assert.equal(agent.status,200);
  const crossRead=await fetch(base+'/api/health',{headers:{Origin:'https://evil.example'}});
  assert.equal(crossRead.status,200,'Reads are unaffected; browsers block cross-origin reads by CORS');
  const titles=JSON.parse(fs.readFileSync(path.join(root,'store.json'),'utf8')).tasks.map(t=>t.title);
  assert.equal(titles.includes('csrf'),false);

  console.log('Secrets redacted from /api/state, cross-site writes rejected, same-origin and agent writes accepted.');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>server.close());
