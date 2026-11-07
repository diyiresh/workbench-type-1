"use strict";
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {chromium}=require('playwright');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'bench-v8-'));
process.env.BENCH_DATA_DIR=root;
const state=require('../lib/default-store').buildDefaultStore();
state.remote.vault={enabled:false};state.departmentRuns=[];state.meta.companion={enabled:false,voice:false};
state.agendas=[{id:'v8-review',title:'V8 fixture reflection',date:'2026-11-07',time:'09:00',review:'A judgment changed because of evidence.',category:'工作',done:true}];
fs.writeFileSync(path.join(root,'store.json'),JSON.stringify(state));
const {createServer}=require('../server');const server=createServer();
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[],writes=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()!=='GET')writes.push(r.url());});
 await page.route('**/api/briefings',r=>r.fulfill({json:{items:[]}}));
 await page.goto(base);await page.locator('#v8-nav .v8-brand').waitFor();
 assert.equal(await page.locator('#v8-nav>a').count(),5);
 await page.screenshot({path:path.join(root,'v8-today.png'),fullPage:true});
 for(const hash of ['#projects/all','#agents/all','#assets/skills','#learn/all','#life/all','#reports/pain','#set/all','#tools/all','#agenda/all']){
  await page.evaluate(hash=>{location.hash=hash;},hash);await page.waitForTimeout(120);
  assert.ok(await page.locator('.v8-subnav a').count());
 }
 await page.goto(base+'/#reflections/all');await page.locator('#v8-reflection-filter').waitFor();
 assert.equal(await page.locator('[data-v8-reflection]').count(),1);
 await page.fill('#v8-reflection-filter','nothing matched');assert.equal(await page.locator('#v8-reflection-empty').isVisible(),true);
 await page.fill('#v8-reflection-filter','judgment');assert.equal(await page.locator('[data-v8-reflection]').isVisible(),true);
 await page.locator('#cmd-body').fill('Unsaved command fixture');
 await page.locator('[data-v8="appearance"]').first().click();
 for(const palette of ['moonlit','porcelain','autumn','studio']){
  await page.locator('[data-v8-palette="'+palette+'"]').click();
  assert.equal(await page.locator('html').getAttribute('data-studio-palette'),palette);
  assert.equal(await page.locator('#cmd-body').inputValue(),'Unsaved command fixture');
 }
 await page.locator('[data-v8-palette="moonlit"]').click();await page.locator('[data-v8="cancel"]').first().click();
 assert.equal(await page.locator('html').getAttribute('data-studio-palette'),'studio');
 await page.locator('[data-v8="appearance"]').first().click();await page.locator('[data-v8-palette="autumn"]').click();
 await page.selectOption('#v8-density','compact');await page.uncheck('#v8-art');await page.locator('[data-v8="apply"]').click();
 await page.reload();await page.locator('#v8-nav').waitFor();
 assert.equal(await page.locator('html').getAttribute('data-studio-palette'),'autumn');
 assert.equal(await page.locator('html').getAttribute('data-studio-density'),'compact');
 assert.equal(await page.locator('html').getAttribute('data-studio-artwork'),'false');
 await page.locator('[data-v8="appearance"]').first().click();assert.equal(await page.locator('#v8-classic option').count(),25);
 await page.selectOption('#v8-classic','night');await page.locator('[data-v8="apply"]').click();await page.reload();await page.locator('#v8-nav').waitFor();
 assert.equal(await page.locator('html').getAttribute('data-theme'),'night');
 await page.locator('[data-v8="appearance"]').first().click();await page.selectOption('#v8-layout','classic');await page.locator('[data-v8="apply"]').click();
 assert.equal(await page.locator('html').getAttribute('data-v8'),'false');
 await page.goto(base+'/#set/all');await page.locator('.v8-appearance-entry').click();await page.selectOption('#v8-layout','studio');await page.locator('[data-v8-palette="studio"]').click();await page.locator('[data-v8="apply"]').click();
 await page.setViewportSize({width:390,height:844});await page.goto(base+'/#home/all');await page.locator('#v8-nav').waitFor();
 assert.equal(await page.locator('#v8-nav').isVisible(),true);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.screenshot({path:path.join(root,'v8-mobile.png'),fullPage:true});
 assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
 console.log('V8 grouping, legacy destinations, reflection search, theme preview/cancel/apply/reload, classic themes/layout fallback, mobile width and draft preservation passed; zero business writes. Screenshots: '+root);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>server.close());
