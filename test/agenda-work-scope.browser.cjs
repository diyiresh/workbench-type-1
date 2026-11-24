const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { chromium } = require('playwright');
process.env.BENCH_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-agenda-work-scope-'));
const state = require('../lib/default-store').buildDefaultStore();
state.meta.language = 'zh-CN';
state.meta.briefingDismissedOn = require('../lib/migrate').ymd();
state.agendas = [
  {id:'work',date:'2026-11-24',time:'09:00',title:'工作事项',category:'工作',done:true},
  {id:'meeting',date:'2026-11-24',time:'10:00',title:'工作会议',category:'会议',important:true},
  {id:'fitness',date:'2026-11-24',time:'11:45',title:'8周肩背计划',category:'生活',planId:'fitness-8w-20261023',done:true,review:'已保留的训练复盘'},
  {id:'learning',date:'2026-11-24',time:'20:00',title:'学习安排',category:'学习',important:true},
  {id:'legacy',date:'2026-11-25',title:'历史未分类工作'},
  {id:'month-work',date:'2026-11-01',title:'月初工作',category:'工作'},
  {id:'month-life',date:'2026-11-01',title:'月初生活',category:'生活'},
];
fs.writeFileSync(path.join(process.env.BENCH_DATA_DIR,'store.json'),JSON.stringify(state));
const {createServer,readStore}=require('../server');
const server=createServer();
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({channel:'msedge',headless:true});
  require('./helpers/classic-layout.cjs')(browser);
  try {
    const page=await browser.newPage({viewport:{width:1440,height:1000}});
    page.setDefaultTimeout(10000);
    await page.clock.setFixedTime(new Date(2026,10,24,12));
    await page.route('**/api/briefings',r=>r.fulfill({json:{items:[]}}));
    const errors=[]; page.on('pageerror',e=>errors.push(e.message));
    const titles=()=>page.locator('#agenda-results .agenda-body .row > b').allTextContents();
    const counts=()=>page.locator('.agenda-stats b').allTextContents();
    const savedFitness=JSON.stringify(readStore().agendas.find(a=>a.id==='fitness'));
    await page.goto(base+'/#agenda/all');
    await page.locator('.agenda-stats').waitFor();
    assert.deepEqual(await titles(),['工作事项','工作会议']);
    assert.deepEqual(await counts(),['2','1','1','1']);
    assert.deepEqual(await page.locator('#agenda-form [name="category"] option').allTextContents(),['工作','会议','学习','生活']);
    await page.locator('[data-act="agenda-view"][data-view="week"]').click();
    assert.deepEqual(await counts(),['3','1','2','1']);
    assert.deepEqual(await titles(),['工作事项','工作会议','历史未分类工作']);
    await page.locator('[data-act="agenda-view"][data-view="month"]').click();
    assert.deepEqual(await counts(),['4','1','3','1']);
    assert.deepEqual(await titles(),['月初工作','工作事项','工作会议','历史未分类工作']);
    for(const filter of ['pending','done','important','all']) {
      await page.locator(`[data-agenda-filter="${filter}"]`).click();
      assert(!(await titles()).some(t=>/肩背|学习|生活/.test(t)));
    }
    await page.locator('[data-act="agenda-view"][data-view="day"]').click();
    let aiRequest;
    await page.route('**/api/llm/generate',async r=>{aiRequest=r.request().postDataJSON();await r.fulfill({json:{text:'保留原顺序'}});});
    await page.locator('[data-act="agenda-ai-draft"]').click();
    await page.waitForFunction(()=>document.querySelector('#agenda-ai-output')?.textContent==='保留原顺序');
    assert.match(aiRequest.prompt,/工作事项/); assert.doesNotMatch(aiRequest.prompt,/肩背|学习安排/);
    for(const [category,board,title] of [['生活','life','新生活安排'],['学习','learn','新学习安排']]) {
      await page.locator('#agenda-form [name="title"]').fill(title);
      await page.locator('#agenda-form [name="category"]').selectOption(category);
      await Promise.all([
        page.waitForResponse(r=>r.url().endsWith('/api/agendas')&&r.request().method()==='POST'),
        page.locator('#agenda-form [type="submit"]').click(),
      ]);
      await page.waitForFunction(()=>document.querySelector('#agenda-form [name="title"]')?.value==='');
      assert(!(await titles()).includes(title));
      assert.deepEqual(await counts(),['2','1','1','1']);
      await page.evaluate(board=>{location.hash=board+'/all';},board);
      await page.locator('.front-list').waitFor();
      assert((await page.locator('.front-list .agenda-body .row > b').allTextContents()).includes(title));
      if(board==='life') {
        const fitness=page.locator('.agenda-item').filter({has:page.locator('[data-id="fitness"]')});
        assert.match(await fitness.textContent(),/已保留的训练复盘/);
        assert.equal(await fitness.locator('.agenda-check.checked').count(),1);
      }
      await page.locator('a[href="#agenda/all"]').filter({hasText:'前往行程界面制定日程'}).click();
      await page.locator('#agenda-form').waitFor();
    }
    await page.reload(); await page.locator('.agenda-stats').waitFor();
    assert.deepEqual(await counts(),['2','1','1','1']);
    assert.equal(JSON.stringify(readStore().agendas.find(a=>a.id==='fitness')),savedFitness);
    assert.equal(readStore().agendas.length,9);
    await page.request.patch(base+'/api/meta',{data:{language:'en'}});
    await page.reload(); await page.locator('.agenda-stats').waitFor();
    assert.match(await page.locator('.agenda-hero').textContent(),/main agenda shows work and meetings only/);
    await page.evaluate(()=>{location.hash='life/all';}); await page.locator('.front-list').waitFor();
    assert.match(await page.locator('.front-section-head').first().textContent(),/separately from the main agenda/);
    await page.setViewportSize({width:390,height:844});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    assert.deepEqual(errors,[]);
    console.log('Work agenda scope passed: day/week/month, statistics, filters, creation of life/learning, dedicated boards, retained fitness review/completion, AI sorting, refresh, English and narrow layout. Isolated ledger only.');
  } finally { await browser.close(); await new Promise(resolve=>server.close(resolve)); }
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
