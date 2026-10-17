const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'bench-centers-ui-'));
process.env.BENCH_DATA_DIR=root;
const state=require('../lib/default-store').buildDefaultStore();
state.tasks=[{id:'task',title:'项目原文',status:'blocked',due:'2020-01-01',ownerAgentId:'workbuddy',progress:12},{id:'paused',title:'暂停任务',status:'doing',resumeRequired:true,due:'2020-01-01'}];
state.modules=[{id:'same',type:'project',title:'业务原文',taskId:'task',order:1},{id:'schedule',type:'schedule',title:'日程入口',order:2}];
const run=require('../lib/department').createDepartmentRun(state,{goal:'协作原文',requiresWritingApproval:false});
// Deliberately share an ID across collections. Routing must keep them separate.
run.id='same';run.items.forEach(i=>i.runId=run.id);run.automationPaused=true;
state.inbox=[{id:'ordinary',toAgentId:'workbuddy',body:'普通指令原文',status:'queued'}];
state.remote.vault={enabled:true,baseUrl:'http://127.0.0.1:1',keyFile:path.join(root,'missing-key')};
fs.writeFileSync(path.join(root,'store.json'),JSON.stringify(state));
const {createServer,readStore}=require('../server'); const server=createServer();
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try {
    const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],writes=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/api/briefings',r=>r.fulfill({json:{items:[]}}));
    await page.route('**/api/extensions',async r=>{
      const response=await r.fetch();const data=await response.json();const wb=data.agents.find(a=>a.agentId==='workbuddy');
      wb.state='paused';wb.evidence='workbuddy-automation';wb.observedAt='2026-10-13T08:53:28Z';
      await r.fulfill({json:data});
    });
    page.on('request',r=>{if(r.method()!=='GET')writes.push(r.url());});
    const open=async hash=>{await page.goto(base+'/'+hash);await page.locator('#ws-head h1').waitFor();};
    await open('#home/all');assert.equal(await page.locator('#rail > [data-primary]').count(),10);
    assert.equal(await page.locator('.overview-stat[data-overview-filter="risks"] b').textContent(),'1');
    await page.locator('[data-primary="deck"]').click();assert.equal(new URL(page.url()).hash,'#home/decisions');
    assert.equal(await page.locator('.stats .stat').last().locator('b').textContent(),'1');
    assert.equal(await page.locator('table.deck tbody tr').count(),1);
    await open('#work/same');assert.equal(new URL(page.url()).hash,'#projects/mod:same');assert.match(await page.locator('#ws-body').textContent(),/业务原文/);assert.equal(await page.locator('#ws-body .msg .row b').filter({hasText:'项目原文'}).count(),1);
    await open('#department/same');assert.equal(new URL(page.url()).hash,'#projects/run:same');await page.locator('[data-room-form="same"]').waitFor();
    const input=page.locator('.room-composer textarea');await input.fill('保留草稿');await page.evaluate(()=>window.dispatchEvent(new Event('hashchange')));assert.equal(await input.inputValue(),'保留草稿');
    await page.reload();await page.locator('[data-room-form="same"]').waitFor();
    await open('#projects/business');assert.equal(await page.locator('#ws-body [data-mod]').count(),1);
    await page.locator('#channels a[href="#projects/all"]').click();await page.locator('#rail [data-primary="assets"]').click();await page.goBack();await page.waitForURL('**/#projects/all');assert.equal(await page.locator('#rail [data-primary="projects"].active').count(),1);await page.goForward();await page.waitForURL('**/#assets/all');
    await open('#ops/today');assert.equal(new URL(page.url()).hash,'#agenda/all');
    await open('#ops/weekly');assert.equal(new URL(page.url()).hash,'#reports/weekly');assert.equal(await page.locator('#ws-body #agenda-date').count(),0);
    await open('#crew/workbuddy');await page.locator('[data-agent-state="paused"]').waitFor();
    assert.match(await page.locator('#ws-body').textContent(),/已登记／等待成员读取/);
    const before=JSON.parse(JSON.stringify(readStore()));
    await open('#agents/all');await page.locator('[data-agent-state="paused"]').waitFor();await page.locator('[data-act="sync"]').click();
    assert.deepEqual(readStore().agents,before.agents);assert.equal(readStore().departmentRuns[0].automationPaused,true);
    await open('#memory/skills');assert.equal(new URL(page.url()).hash,'#assets/skills');assert.match(await page.locator('#ws-body').textContent(),/技能说明，未绑定文件/);
    await open('#assets/extensions');await page.locator('[data-extension="multica"]').waitFor();assert.match(await page.locator('[data-extension="multica"]').textContent(),/预留/);
    await open('#assets/knowledge');await page.waitForFunction(()=>document.querySelector('#vault-status').textContent.includes('未接通'));
    assert.match(await page.locator('#ws-body').textContent(),/排除 VaultRAG/);
    for (const language of ['zh-CN','en']) for (const theme of ['violet','warm','night','guofeng']) {
      // Change only the isolated fixture's display preferences; no business operations.
      await page.request.patch(base+'/api/meta',{data:{language,theme}});
      await open('#assets/skills');await page.reload();await page.waitForFunction(theme=>document.documentElement.dataset.theme===theme,theme);await page.setViewportSize({width:390,height:844});
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      assert.equal(await page.locator('html').getAttribute('data-theme'),theme);
      assert.equal(await page.locator('#rail > [data-primary]').count(),10);
      await page.setViewportSize({width:1440,height:1000});
    }
    const permitted=writes.filter(url=>!url.endsWith('/api/meta')&&!url.endsWith('/api/crew/sync'));
    assert.deepEqual(permitted,[]);assert.deepEqual(errors,[]);
    for(const key of ['tasks','modules','agents','departmentRuns','inbox'])assert.deepEqual(readStore()[key],before[key]);
    const proof=path.join(root,'centers-en.png');await page.screenshot({path:proof,fullPage:false});console.log('Screenshot: '+proof);
    console.log('Ten sections, legacy routes, project identity, chat draft, real status labels, knowledge isolation, four themes and two languages passed.');
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>server.close());
