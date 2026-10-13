const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {chromium}=require('playwright');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'bench-file-ui-'));
process.env.BENCH_DATA_DIR=root;
const state=require('../lib/default-store').buildDefaultStore();
state.meta.language='en'; state.meta.briefingDismissedOn=require('../lib/migrate').ymd();
fs.writeFileSync(path.join(root,'store.json'),JSON.stringify(state));
const {createServer,readStore}=require('../server');
const server=createServer();
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const api=async(route,body,status=200)=>{const response=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});assert.equal(response.status,status,await response.clone().text());return response.json();};
  const run=await api('/api/departments/runs',{goal:'中文报告原文',participantAgentIds:['codex','cursor','workbuddy'],requiresWritingApproval:false,delivery:{mode:'files'}},201);
  for(const role of ['director','executor']){const item=run.items.find(i=>i.role===role);const route=`/api/departments/runs/${run.id}/items/${item.id}/action`;await api(route,{action:'start'});await api(route,{action:'submit',output:role==='executor'?'# 中文报告原文\n核验正文，原文保持。':'计划'});}
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(base+'/#department/'+run.id);
    await page.getByRole('heading',{name:'Deliverable files and acceptance',exact:true}).waitFor();
    await page.getByText('Waiting for files',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Generate and register files',exact:true}).click();
    await page.getByText('Awaiting file review',{exact:true}).first().waitFor();
    const delivery=await api(`/api/departments/runs/${run.id}/delivery`);
    assert.equal(delivery.files.length,1);assert(fs.existsSync(delivery.files[0].path));
    assert(await page.locator('.delivery-panel').textContent().then(text=>text.includes(delivery.files[0].sha256)));
    const reviewer=run.items.find(i=>i.role==='reviewer');
    await api(`/api/departments/runs/${run.id}/items/${reviewer.id}/action`,{action:'review',verdict:'pass',comment:'仅正文',reviewerAgentId:'cursor'},400);
    await api(`/api/departments/runs/${run.id}/items/${reviewer.id}/action`,{action:'review',verdict:'pass',comment:'模拟核对文件',reviewerAgentId:'cursor',reviewedSnapshot:delivery.snapshot});
    const secretary=run.items.find(i=>i.role==='secretary');
    await api(`/api/departments/runs/${run.id}/items/${secretary.id}/action`,{action:'start'});
    await api(`/api/departments/runs/${run.id}/items/${secretary.id}/action`,{action:'submit',output:'模拟交付说明'});
    await page.reload();await page.getByText('File delivery accepted',{exact:true}).waitFor();
    assert.equal(readStore().departmentRuns.find(r=>r.id===run.id).status,'completed');
    fs.appendFileSync(delivery.files[0].path,'changed');
    await page.reload();await page.getByText('File verification invalidated',{exact:true}).first().waitFor();
    assert.notEqual(readStore().departmentRuns.find(r=>r.id===run.id).status,'completed');
    await api(`/api/departments/runs/${run.id}/delivery/open`,{artifactId:delivery.files[0].id},409);
    await api('/api/archive',{action:'archive',items:[{collection:'departmentRuns',id:run.id}]});
    await api(`/api/departments/runs/${run.id}/delivery/generate`,{},409);
    await page.goto(base+'/#department/new');await page.locator('[name="deliveryProfile"]').waitFor();
    assert.equal(await page.locator('[name="deliveryProfile"]').getAttribute('required'),'');
    assert.deepEqual(errors,[]);
    console.log('Delivery API and browser: required format, generation, bilingual receipts, snapshot-bound review, tampering invalidation and archived writes passed.');
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);server.close();process.exitCode=1});
