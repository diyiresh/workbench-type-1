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
 // Decisions waiting on the chairman: compact on Today, full list on its own tab, links only.
 await page.waitForFunction(()=>{const h=document.querySelector('[data-decision-inbox="compact"]');return h&&!h.textContent.includes('正在读取');});
 await page.goto(base+'/#home/decisions');await page.locator('[data-decision-inbox="full"] h2').waitFor();
 assert.equal(await page.locator('[data-decision-inbox="full"] h2').textContent(),'待你决定');
 assert.ok(await page.locator('[data-decision-inbox="full"] .decision-row').evaluateAll(rows=>rows.every(a=>a.getAttribute('href').startsWith('#'))));
 await page.goto(base);await page.locator('#v8-nav .v8-brand').waitFor();
 // One home: Today plus overview filters, no second module board; the board has its own tab.
 assert.equal(await page.locator('.v8-welcome').count(),1);
 assert.equal(await page.locator('.overview-stat').count(),4);
 assert.equal(await page.locator('#overview-results').count(),0);
 assert.equal(await page.locator('.command-hero').count(),0);
 await page.locator('.overview-stat[data-overview-filter="today"]').click();
 assert.equal(await page.locator('#overview-results').getAttribute('data-overview-view'),'today');
 await page.getByRole('button',{name:'清除筛选',exact:true}).click();assert.equal(await page.locator('#overview-results').count(),0);
 await page.locator('.v8-subnav a[href="#home/modules"]').click();await page.locator('#overview-results.mods').waitFor();
 assert.equal(await page.locator('#ws-body [data-act="add-module"]').count(),1);
 // Composer opens on demand and stays docked on member pages.
 await page.goto(base+'/#reflections/all');await page.locator('#v8-reflection-filter').waitFor();
 assert.equal(await page.locator('#composer').isVisible(),false);
 await page.goto(base+'/#agents/codex');await page.locator('#v8-nav').waitFor();
 assert.equal(await page.locator('#composer').isVisible(),true);
 // Command palette: Ctrl+K, filter, keyboard selection, Escape.
 await page.keyboard.press('Control+k');await page.locator('#v8-palette input').waitFor();
 await page.locator('#v8-palette input').fill('行程思考');await page.keyboard.press('Enter');
 await page.waitForFunction(()=>location.hash==='#reflections/all');await page.locator('#v8-palette').waitFor({state:'detached'});
 await page.keyboard.press('Control+k');await page.locator('#v8-palette input').fill('V8 fixture');
 assert.match(await page.locator('#v8-palette [role=option]').first().textContent(),/V8 fixture reflection/);
 await page.keyboard.press('Escape');await page.locator('#v8-palette').waitFor({state:'detached'});
 assert.equal(await page.locator('.v8-subnav a[href="#agenda/all"]').count(),0,'Reflections no longer duplicates the schedule entrance: '+await page.evaluate(()=>location.hash+' '+[...document.querySelectorAll('.v8-subnav a')].map(a=>a.getAttribute('href')).join(',')));
 for(const hash of ['#projects/all','#agents/all','#assets/skills','#learn/all','#life/all','#reports/pain','#set/all','#tools/all','#agenda/all']){
  await page.evaluate(hash=>{location.hash=hash;},hash);await page.waitForTimeout(120);
  assert.ok(await page.locator('.v8-subnav a').count());
 }
 await page.goto(base+'/#reflections/all');await page.locator('#v8-reflection-filter').waitFor();
 assert.equal(await page.locator('[data-v8-reflection]').count(),1);
 await page.fill('#v8-reflection-filter','nothing matched');assert.equal(await page.locator('#v8-reflection-empty').isVisible(),true);
 await page.fill('#v8-reflection-filter','judgment');assert.equal(await page.locator('[data-v8-reflection]').isVisible(),true);
 await page.locator('#v8-nav [data-v8="composer"]').click();
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
 await page.locator('[data-v8="appearance"]').first().click();
 assert.equal(await page.locator('[data-v8-palette]').count(),4);
 assert.equal(await page.locator('#v8-classic,#v8-layout,.v8-classic-drawer').count(),0);
 assert.equal(await page.locator('#v8-appearance').textContent().then(t=>/经典主题|原版布局|V8/.test(t)),false);
 await page.locator('[data-v8="cancel"]').first().click();
 // Existing browser preferences migrate without a business write; retired palettes cannot return.
 for(const palette of ['classic','moonlit']){
  await page.evaluate(palette=>{localStorage.removeItem('bench-appearance');localStorage.setItem('bench-v8-appearance',JSON.stringify({palette,layout:'classic',classicTheme:'night',density:'compact',artwork:false,system:false}));},palette);
  await page.reload();await page.locator('#v8-nav').waitFor();
  assert.equal(await page.locator('html').getAttribute('data-v8'),'true');
  assert.equal(await page.locator('html').getAttribute('data-studio-palette'),palette==='classic'?'studio':'moonlit');
  assert.equal(await page.locator('html').getAttribute('data-theme'),null);
  assert.equal(await page.locator('html').getAttribute('data-studio-density'),'compact');
  assert.equal(await page.locator('html').getAttribute('data-studio-artwork'),'false');
  assert.deepEqual(await page.evaluate(()=>Object.keys(JSON.parse(localStorage.getItem('bench-appearance'))).sort()),['artwork','density','palette','system']);
  assert.equal(await page.evaluate(()=>localStorage.getItem('bench-v8-appearance')),null);
 }
 assert.equal(await page.title(),'BEN · Workbench');
 await page.goto(base+'/#set/all');await page.locator('.v8-appearance-entry').waitFor();
 assert.equal(await page.locator('#theme-select,[data-act="save-theme"]').count(),0);
 await page.locator('.v8-appearance-entry').click();await page.check('#v8-system');await page.locator('[data-v8="apply"]').click();
 await page.emulateMedia({colorScheme:'dark'});await page.waitForFunction(()=>document.documentElement.dataset.studioPalette==='moonlit');assert.equal(await page.locator('html').getAttribute('data-studio-palette'),'moonlit');
 await page.emulateMedia({colorScheme:'light'});await page.waitForFunction(()=>document.documentElement.dataset.studioPalette==='studio');assert.equal(await page.locator('html').getAttribute('data-studio-palette'),'studio');
 // Hidden features leave navigation and the palette, and come back when re-enabled; no business writes.
 await page.goto(base+'/#assets/all');await page.locator('.v8-subnav a[href="#assets/papers"]').waitFor();
 await page.locator('#v8-nav [data-v8="appearance"]').click();await page.locator('.v8-feature-drawer summary').click();
 await page.locator('[data-v8-feature="papers"]').uncheck();await page.locator('[data-v8="apply"]').click();
 assert.equal(await page.locator('.v8-subnav a[href="#assets/papers"]').count(),0,'hidden feature leaves the tabs');
 await page.keyboard.press('Control+k');await page.locator('#v8-palette input').fill('论文');
 assert.equal(await page.locator('#v8-palette [role=option]', { hasText: '论文' }).count(),0,'hidden feature leaves the palette');
 await page.keyboard.press('Escape');await page.locator('#v8-palette').waitFor({state:'detached'});
 await page.reload();await page.locator('.v8-subnav').waitFor();
 assert.equal(await page.locator('.v8-subnav a[href="#assets/papers"]').count(),0,'hidden feature persists');
 await page.locator('#v8-nav [data-v8="appearance"]').click();await page.locator('.v8-feature-drawer summary').click();
 await page.locator('[data-v8-feature="papers"]').check();await page.locator('[data-v8="apply"]').click();
 await page.locator('.v8-subnav a[href="#assets/papers"]').waitFor();
 await page.setViewportSize({width:390,height:844});await page.goto(base+'/#home/all');await page.locator('#v8-nav').waitFor();
 assert.equal(await page.locator('#v8-nav').isVisible(),true);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.screenshot({path:path.join(root,'v8-mobile.png'),fullPage:true});
 assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
 console.log('Workbench grouping, legacy destinations, reflection search, theme preview/cancel/apply/reload, retired-theme preference migration and system color scheme, feature hiding, mobile width and draft preservation passed; zero business writes. Screenshots: '+root);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>server.close());
