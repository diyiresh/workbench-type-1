const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {chromium}=require('playwright');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'bench-overview-filter-'));process.env.BENCH_DATA_DIR=root;
const state=require('../lib/default-store').buildDefaultStore();state.meta.language='zh-CN';
state.tasks=[
  {id:'doing',title:'执行原文',status:'doing',updatedAt:'2026-10-18T01:00:00Z',ownerAgentId:'one'},
  {id:'review',title:'复核原文',status:'review',updatedAt:'2026-10-18T01:00:00Z'},
  {id:'stale',title:'催报原文',status:'doing',updatedAt:'2026-10-16T01:00:00Z'},
  {id:'blocked',title:'受阻原文',status:'blocked'},
  {id:'overdue',title:'逾期原文',status:'todo',due:'2026-10-17'},
  {id:'multi',title:'双风险原文',status:'blocked',due:'2026-10-17'},
  {id:'done',title:'完成不计入',status:'done',due:'2026-10-16'},
  {id:'archived',title:'归档不计入',status:'doing',archived:true},
  {id:'paused',title:'暂停不计入',status:'doing',resumeRequired:true},
  {id:'legacy',title:'旧归档不计入',status:'archive'},
];
state.agendas=[{id:'today',date:'2026-10-18',time:'09:00',title:'今日原文'},{id:'completed',date:'2026-10-18',time:'11:00',title:'已完成行程原文',done:true},{id:'tomorrow',date:'2026-10-19',title:'明日不计入'},{id:'hidden',date:'2026-10-18',title:'归档行程不计入',archived:true}];
state.agents=[{id:'one',name:'成员甲',status:'active',role:'主管'},{id:'two',name:'成员乙',status:'active',role:'执行'},{id:'off',name:'停用成员',status:'inactive'},{id:'hidden',name:'归档成员',status:'active',archived:true}];
state.modules=[{id:'one',title:'模块原文甲',type:'project',taskId:'doing',order:1},{id:'two',title:'模块原文乙',type:'project',taskId:'review',order:2}];
fs.writeFileSync(path.join(root,'store.json'),JSON.stringify(state));
const {createServer,readStore}=require('../server'),server=createServer();
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1500,height:1000},timezoneId:'Asia/Shanghai'}),errors=[],writes=[];
    page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(10000);
    await page.clock.install({time:new Date('2026-10-18T12:00:00+08:00')});
    await page.route('**/api/briefings',route=>route.fulfill({json:{items:[]}}));
    page.on('request',request=>{if(request.method()!=='GET')writes.push(request.url());});
    await page.goto(base+'/#home');await page.locator('.overview-stat').first().waitFor();
    const initial=JSON.parse(JSON.stringify(readStore()));
    const counts=async()=>page.locator('.overview-stat b').allTextContents();
    assert.deepEqual(await counts(),['3','2','4','2']);
    assert.equal(await page.locator('#overview-results [draggable]').count(),2);
    const select=async(filter,expected)=>{
      await page.locator('.overview-stat[data-overview-filter="'+filter+'"]').click();
      assert.equal(await page.locator('#overview-results').getAttribute('data-overview-view'),filter);
      const ids=await page.locator('#overview-results [data-overview-id]').evaluateAll(nodes=>nodes.map(node=>node.dataset.overviewId));
      assert.deepEqual(ids.sort(),expected.sort());assert.deepEqual(await counts(),['3','2','4','2']);
      assert.equal(await page.locator('.overview-stat[aria-pressed="true"]').count(),1);
      assert(['#home','#home/all'].includes(new URL(page.url()).hash));
    };
    await select('doing',['doing','review','stale']);
    await select('today',['today','completed']);assert.match(await page.locator('#overview-results').textContent(),/已完成/);
    await select('risks',['stale','blocked','overdue','multi']);
    assert.match(await page.locator('#overview-results').textContent(),/任务受阻/);assert.match(await page.locator('#overview-results').textContent(),/任务逾期/);assert.match(await page.locator('#overview-results').textContent(),/无打卡/);
    await select('members',['one','two']);assert.match(await page.locator('#ws-body').textContent(),/不代表实时在线/);
    await page.locator('#overview-results [data-cmd="one"]').click();assert.equal(await page.locator('#cmd-to').inputValue(),'one');
    await page.locator('.overview-stat[data-overview-filter="today"]').focus();await page.keyboard.press('Enter');
    assert.equal(await page.locator('#overview-results').getAttribute('data-overview-view'),'today');
    assert.equal(await page.locator('.overview-stat[data-overview-filter="today"]').evaluate(node=>node===document.activeElement),true);
    await page.locator('.overview-stat[data-overview-filter="risks"]').focus();await page.keyboard.press('Space');
    assert.equal(await page.locator('#overview-results').getAttribute('data-overview-view'),'risks');
    await page.getByRole('button',{name:'显示全部模块',exact:true}).click();assert.equal(await page.locator('#overview-results [draggable]').count(),2);
    assert.equal(await page.locator('.overview-stat[aria-pressed="true"]').count(),0);
    await page.locator('#overview-results [data-mod="one"]').click();await page.locator('[data-sec="all"]').click();
    assert.equal(await page.locator('#overview-results').getAttribute('data-overview-view'),'all');
    await select('doing',['doing','review','stale']);await page.reload();await page.locator('#overview-results').waitFor();assert.equal(await page.locator('#overview-results').getAttribute('data-overview-view'),'all');
    await select('risks',['stale','blocked','overdue','multi']);
    await page.locator('[data-primary="agenda"]').first().click();await page.locator('[data-primary="home"]').first().click();
    assert.equal(await page.locator('#overview-results').getAttribute('data-overview-view'),'all');
    await select('today',['today','completed']);await page.locator('[data-sec="all"]').click();assert.equal(await page.locator('#overview-results').getAttribute('data-overview-view'),'all');
    for(const theme of ['violet','warm','night','guofeng']){
      await page.evaluate(async theme=>{const core=await import('/js/core.js');const state=core.getRawStore();core.setStore({...state,meta:{...state.meta,theme}});},theme);
      await select('risks',['stale','blocked','overdue','multi']);
      assert.equal(await page.locator('html').getAttribute('data-theme'),theme);
      await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      await page.setViewportSize({width:1500,height:1000});
    }
    assert.deepEqual(writes,[],'Viewing filters must not write to the ledger.');
    for(const key of ['tasks','agendas','agents','modules'])assert.deepEqual(readStore()[key],initial[key]);
    const language=await page.request.patch(base+'/api/meta',{data:{language:'en',theme:'guofeng'}});assert(language.ok());
    await page.reload();await page.getByRole('button',{name:'Show all modules',exact:true}).waitFor();
    await select('members',['one','two']);assert.match(await page.locator('#overview-results').textContent(),/成员甲/);
    await select('doing',['doing','review','stale']);
    // A normal state refresh must retain the selected group and reflect changed facts.
    assert((await page.request.patch(base+'/api/tasks/doing',{data:{status:'done'}})).ok());
    const refresh=()=>page.evaluate(async()=>{const core=await import('/js/core.js');core.setStore(await(await fetch('/api/state')).json());window.dispatchEvent(new Event('hashchange'));});
    await refresh();
    await page.waitForFunction(()=>document.querySelector('.overview-stat[data-overview-filter="doing"] b').textContent==='2');
    assert.equal(await page.locator('#overview-results').getAttribute('data-overview-view'),'doing');
    assert.equal(await page.locator('#overview-results [data-overview-id]').count(),2);
    // No active members is an explicit empty state, not a fallback to the module board.
    const changed=readStore();for(const member of changed.agents)member.status='inactive';
    fs.writeFileSync(path.join(root,'store.json'),JSON.stringify(changed));
    await refresh();await page.waitForFunction(()=>document.querySelector('.overview-stat[data-overview-filter="members"] b').textContent==='0');
    await page.locator('.overview-stat[data-overview-filter="members"]').click();await page.getByText('No records match this filter.',{exact:true}).waitFor();
    assert.deepEqual(errors,[]);
    console.log('Overview filters: shared counts/rows, risk deduplication, archive/pause exclusion, native keyboard, reset/reentry, live state refresh, empty members, bilingual/four themes and read-only viewing passed.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>server.close());
