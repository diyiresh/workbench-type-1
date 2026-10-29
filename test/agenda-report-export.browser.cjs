const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {chromium}=require('playwright');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'bench-report-export-ui-'));process.env.BENCH_DATA_DIR=path.join(root,'ledger');fs.mkdirSync(process.env.BENCH_DATA_DIR);
const vault=path.join(root,'vault');fs.mkdirSync(vault);
const state=require('../lib/default-store').buildDefaultStore();state.remote.agendaNotes={vaultRoot:vault};
state.agendas=[{id:'source',date:'2026-10-27',title:'来源状态变化的隔离事项',done:false,review:'保留原有复盘'}];
fs.writeFileSync(path.join(process.env.BENCH_DATA_DIR,'store.json'),JSON.stringify(state));
const {createServer,readStore,writeStore}=require('../server');let calls=0;
const generated='# 月报原稿\n\n## 一、总体情况\n事项未完成，记录尚待复核。';
const server=createServer({reportExecute:async()=>{calls++;return generated;}});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1450,height:1000},timezoneId:'Asia/Shanghai'}),errors=[],alerts=[];
  page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',async dialog=>{alerts.push(dialog.message());await dialog.accept();});
  await page.clock.setFixedTime(new Date('2026-10-27T12:00:00+08:00'));
  await page.route('**/api/briefings',route=>route.fulfill({json:{items:[]}}));
  await page.goto(base+'/#agenda');await page.locator('[data-act="agenda-view"][data-view="month"]').click();
  await page.locator('[data-act="agenda-report-draft"]').click();await page.locator('#agenda-report-body').waitFor();
  const edited='# 手工补充后的月报\n\n保留全部中文、空行和末尾换行。\n';
  await page.locator('#agenda-report-body').fill(edited);
  assert.equal((await page.request.patch(base+'/api/agendas/source',{data:{done:true}})).status(),200);
  const reportsBefore=readStore().reports.length,folder=path.join(vault,'monthly report comes from workbench');
  await page.locator('[data-act="agenda-report-save"]').click();await page.locator('[data-act="agenda-report-save-historical"]').waitFor();
  assert(!fs.existsSync(folder));assert.equal(readStore().reports.length,reportsBefore);assert.equal(await page.locator('#agenda-report-body').inputValue(),edited);assert.equal(alerts.length,0);
  await page.locator('.agenda-report-source-warning').screenshot({path:path.join(root,'historical-choice-cn.png')});
  await page.locator('[data-act="agenda-report-save-cancel"]').click();assert.equal(await page.locator('#agenda-report-body').inputValue(),edited);
  await page.locator('[data-act="agenda-report-save"]').click();await page.locator('[data-act="agenda-report-save-historical"]').click();
  await page.locator('#agenda-report-body').waitFor({state:'detached'});await page.locator('[data-report-export-path]').waitFor();
  const first=readStore().reportExports[0];assert.equal(first.status,'historical-draft');assert.equal(readStore().reports[0].body,edited);assert.equal(fs.readdirSync(folder).length,1);
  const firstBytes=fs.readFileSync(first.file.path);assert(firstBytes.toString('utf8').endsWith(edited));assert.match(firstBytes.toString('utf8'),/source_state: "changed"/);assert.equal(calls,1);
  await page.goto(base+'/#ops/monthly');await page.locator('.report-historical-status').waitFor();assert.match(await page.locator('#ws-body').innerText(),/monthly report comes from workbench/);
  await page.goto(base+'/#agenda');
  // Refresh can restore the original completed return without another member invocation.
  await page.request.patch(base+'/api/meta',{data:{language:'en'}});await page.reload();await page.locator('[data-act="agenda-view"][data-view="month"]').click();
  await page.getByRole('button',{name:'Restore generated draft',exact:true}).click();
  assert.equal(await page.locator('#agenda-report-body').inputValue(),generated);assert.equal(calls,1);
  const secondText='# Historical second version\nHuman-edited text stays intact.';
  await page.locator('#agenda-report-body').fill(secondText);await page.locator('[data-act="agenda-report-save"]').click();
  await page.getByRole('button',{name:'Keep as historical draft',exact:true}).click();await page.locator('#agenda-report-body').waitFor({state:'detached'});
  assert.equal(readStore().reportExports[0].file.version,2);assert.deepEqual(fs.readFileSync(first.file.path),firstBytes);assert.equal(fs.readdirSync(folder).length,2);
  await page.setViewportSize({width:390,height:844});await page.locator('.agenda-report-save-receipt').screenshot({path:path.join(root,'export-success-en-mobile.png')});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  // A new current-source report saves normally, without historical confirmation.
  await page.locator('[data-act="agenda-report-draft"]').click();await page.locator('#agenda-report-body').waitFor();
  await page.locator('[data-act="agenda-report-save"]').click();await page.locator('#agenda-report-body').waitFor({state:'detached'});
  assert.equal(readStore().reportExports[0].file.version,3);assert.equal(readStore().reportExports[0].status,'user-saved');assert.equal(calls,2);
  // Changing text while the save preview is pending keeps the newer edits and creates no file.
  await page.locator('[data-act="agenda-report-draft"]').click();await page.locator('#agenda-report-body').waitFor();
  let release,started;const waiting=new Promise(r=>started=r);
  await page.route('**/api/agenda/reports/export/preview',async route=>{const response=await route.fetch();started();await new Promise(r=>release=r);await route.fulfill({response});});
  await page.locator('[data-act="agenda-report-save"]').click();await waiting;
  await page.locator('#agenda-report-body').fill('New changes during preview\n保留我的修改');release();
  await page.waitForFunction(()=>!document.querySelector('[data-act="agenda-report-save"]').disabled);
  assert.equal(await page.locator('#agenda-report-body').inputValue(),'New changes during preview\n保留我的修改');assert.equal(fs.readdirSync(folder).length,3);assert.equal(alerts.length,1);
  await page.unroute('**/api/agenda/reports/export/preview');
  // A missing destination reports failure and leaves the edited draft untouched.
  const fresh=readStore();fresh.remote.agendaNotes.vaultRoot=path.join(root,'missing-vault');writeStore(fresh);
  await page.locator('[data-act="agenda-report-save"]').click();await page.waitForFunction(()=>!document.querySelector('[data-act="agenda-report-save"]').disabled);
  assert.equal(await page.locator('#agenda-report-body').inputValue(),'New changes during preview\n保留我的修改');assert.equal(fs.readdirSync(folder).length,3);assert.equal(alerts.length,2);
  assert.deepEqual(errors,[]);assert.equal(readStore().reports.length,reportsBefore+3);
  console.log('Obsidian export browser/API: reproduced source-change save, explicit historical/current save, exact edits, retained versions, held-draft recovery without a model, preview edit race, missing directory, CN/EN/mobile passed with isolated vault. Screenshots: '+root);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>server.close());
