const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'bench-ui-v010-'));
process.env.BENCH_DATA_DIR=root;
const {buildDefaultStore}=require('../lib/default-store');
const state=buildDefaultStore();
state.meta.language='en';state.meta.briefingDismissedOn=require('../lib/migrate').ymd();
state.tasks=[{id:'business-task',title:'业务原文：设置',status:'doing',progress:31,ownerAgentId:'cursor',nextAction:'中文内容保留'}];
state.modules=[{id:'business-module',title:'业务原文：指挥舱',type:'project',taskId:'business-task',order:1}];
state.agendas=[{id:'learning-event',title:'学习原文',date:new Date().toISOString().slice(0,10),category:'学习',time:'10:00',done:false}];
state.reports=[{id:'business-report',kind:'weekly',title:'报告原文',body:'报告正文：设置与归档'}];
fs.writeFileSync(path.join(root,'store.json'),JSON.stringify(state));
const {createServer,readStore}=require('../server');
const server=createServer();
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(base+'/#home');await page.locator('[data-act="manage-records"]').waitFor();
    await page.evaluate(()=>document.querySelector('#briefing').hidden=true);
    assert.equal(await page.locator('html').getAttribute('lang'),'en');
    assert.equal(await page.locator('[data-primary="set"]').first().textContent(),'Settings');
    assert(await page.locator('#ws-body').textContent().then(text=>text.includes('业务原文：指挥舱')));
    await page.getByRole('button',{name:'Manage & archive',exact:true}).click();
    await page.locator('[data-archive-ref]').first().check();
    await page.getByRole('button',{name:'Archive selected',exact:true}).click();
    await page.getByRole('button',{name:'Confirm operation',exact:true}).click();
    await page.getByText('Changes saved',{exact:true}).waitFor();
    assert(readStore().tasks[0].archived);assert.equal(readStore().tasks[0].title,'业务原文：设置');
    await page.getByRole('button',{name:'Archived',exact:true}).click();await page.locator('[data-archive-ref]').first().check();
    await page.getByRole('button',{name:'Restore selected',exact:true}).click();await page.getByRole('button',{name:'Confirm operation',exact:true}).click();
    await page.getByText('Changes saved',{exact:true}).waitFor();assert(readStore().tasks[0].resumeRequired);
    await page.getByRole('button',{name:'Current',exact:true}).click();await page.locator('[data-archive-ref]').first().check();
    await page.getByRole('button',{name:'Continue selected',exact:true}).click();await page.getByRole('button',{name:'Confirm operation',exact:true}).click();
    await page.getByText('Changes saved',{exact:true}).waitFor();assert(!readStore().tasks[0].resumeRequired);
    await page.locator('[data-archive-close]').click();
    for(const board of ['deck','department','agenda','briefs','ops/weekly','crew','work','learn','life','memory','set']){
      await page.goto(base+'/#'+board);await page.locator('[data-act="manage-records"]').waitFor();
      assert(!(await page.locator('#ws-body').textContent()).includes('Module error'));
    }
    await page.goto(base+'/#learn');await page.getByText('学习原文',{exact:false}).first().waitFor();
    await page.goto(base+'/#ops/weekly');assert.equal(await page.locator('#report-body').inputValue(),'报告正文：设置与归档');
    await page.goto(base+'/#set');await page.locator('#language-select').selectOption('zh-CN');await page.getByRole('button',{name:'Apply language',exact:true}).click();
    await page.waitForFunction(()=>document.documentElement.lang==='zh-CN');
    assert.equal(await page.locator('[data-primary="set"]').first().textContent(),'设置');
    await page.reload();await page.locator('#language-select').waitFor();assert.equal(await page.locator('#language-select').inputValue(),'zh-CN');
    await page.goto(base+'/#set/help');await page.waitForFunction(()=>document.querySelectorAll('#logic-document svg').length>=7,{},{timeout:45000});
    await page.getByRole('button',{name:'放大查看',exact:true}).first().click();await page.locator('dialog[open]').waitFor();await page.locator('dialog button').click();
    await page.goto(base+'/#set');await page.locator('#language-select').selectOption('en');await page.getByRole('button',{name:'应用语言',exact:true}).click();await page.waitForFunction(()=>document.documentElement.lang==='en');
    for(const theme of ['violet','warm','night']){
      await page.locator('#theme-select').selectOption(theme);await page.getByRole('button',{name:'Apply theme',exact:true}).click();
      await page.goto(base+'/#set/help');await page.waitForFunction(()=>document.querySelectorAll('#logic-document svg').length>=7,{},{timeout:45000});
      assert((await page.locator('#logic-document').textContent()).includes('Single ledger'));
      await page.goto(base+'/#set');
    }
    await page.setViewportSize({width:760,height:900});await page.goto(base+'/#set/help');await page.locator('#logic-document svg').first().waitFor();
    const screenshots=path.join(__dirname,'..','data','v010-validation');fs.mkdirSync(screenshots,{recursive:true});
    await page.screenshot({path:path.join(screenshots,'help-en-narrow.png'),fullPage:false});
    await page.setViewportSize({width:1440,height:1000});await page.goto(base+'/#set');await page.locator('#language-select').waitFor();
    await page.screenshot({path:path.join(screenshots,'settings-en-night.png'),fullPage:false});
    assert.deepEqual(errors,[]);
    console.log('Browser: all twelve sections, archive/restore/explicit continuation, preserved Chinese business content, persistent language, local diagrams/zoom, three themes and narrow layout passed.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>server.close());
