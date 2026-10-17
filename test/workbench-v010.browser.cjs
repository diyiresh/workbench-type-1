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
      if(board==='home')assert.equal(await page.locator('#channels .ch:not(.active)').first().evaluate(node=>getComputedStyle(node).color),'rgb(255, 250, 240)');
    }
    await page.goto(base+'/#learn');await page.getByText('学习原文',{exact:false}).first().waitFor();
    await page.goto(base+'/#ops/weekly');assert.equal(await page.locator('#report-body').inputValue(),'报告正文：设置与归档');
    await page.goto(base+'/#set');await page.locator('#language-select').selectOption('zh-CN');await page.getByRole('button',{name:'Apply language',exact:true}).click();
    await page.waitForFunction(()=>document.documentElement.lang==='zh-CN');
    assert.equal(await page.locator('[data-primary="set"]').first().textContent(),'设置');
    await page.reload();await page.locator('#language-select').waitFor();assert.equal(await page.locator('#language-select').inputValue(),'zh-CN');
    await page.goto(base+'/#set/help');await page.locator('#logic-document svg').first().waitFor({timeout:45000});
    await page.getByRole('button',{name:'放大查看',exact:true}).first().click();await page.locator('dialog[open]').waitFor();await page.locator('dialog button').click();
    await page.waitForFunction(()=>document.querySelectorAll('#logic-document svg').length>=9,{},{timeout:45000});
    await page.goto(base+'/#set');await page.locator('#language-select').selectOption('en');await page.getByRole('button',{name:'应用语言',exact:true}).click();await page.waitForFunction(()=>document.documentElement.lang==='en');
    for(const theme of ['violet','warm','night','guofeng']){
      await page.locator('#theme-select').selectOption(theme);await page.getByRole('button',{name:'Apply theme',exact:true}).click();
      await page.waitForFunction(value=>document.documentElement.dataset.theme===value,theme);
      await page.goto(base+'/#set/help');await page.waitForFunction(()=>document.querySelectorAll('#logic-document svg').length>=8,{},{timeout:45000});
      assert((await page.locator('#logic-document').textContent()).includes('Single ledger'));
      await page.goto(base+'/#set');
    }
    await page.reload();await page.locator('#theme-select').waitFor();
    assert.equal(await page.locator('#theme-select').inputValue(),'guofeng');
    assert.equal(await page.locator('#theme-select option[selected]').count(),1);
    assert.equal(readStore().meta.theme,'guofeng');
    assert.match(await page.locator('#ws-head h1').evaluate(node=>getComputedStyle(node).fontFamily),/SimSun/);
    const themeShots=path.join(__dirname,'..','data','theme-validation');fs.mkdirSync(themeShots,{recursive:true});
    for(const board of ['home','deck','department','agenda','briefs','ops/weekly','crew','work','learn','life','memory','set']){
      await page.goto(base+'/#'+board);await page.locator('[data-act="manage-records"]').waitFor();
      assert.equal(await page.locator('html').getAttribute('data-theme'),'guofeng');
      assert(!(await page.locator('#ws-body').textContent()).includes('Module error'));
      if(['home','agenda','briefs','set'].includes(board))await page.screenshot({path:path.join(themeShots,'guofeng-'+board+'-en.png')});
    }
    await page.getByRole('button',{name:'Manage & archive',exact:true}).click();await page.locator('.archive-sheet').waitFor();
    assert.equal(await page.locator('.archive-sheet').evaluate(node=>getComputedStyle(node).backgroundColor),'rgb(255, 250, 240)');
    await page.locator('[data-archive-close]').click();
    assert.equal(readStore().tasks[0].title,'业务原文：设置');
    assert.equal(readStore().reports[0].body,'报告正文：设置与归档');
    await page.setViewportSize({width:760,height:900});await page.goto(base+'/#set/help');await page.locator('#logic-document svg').first().waitFor();
    const screenshots=path.join(__dirname,'..','data','v010-validation');fs.mkdirSync(screenshots,{recursive:true});
    await page.screenshot({path:path.join(screenshots,'help-en-narrow.png'),fullPage:false});
    await page.setViewportSize({width:1440,height:1000});await page.goto(base+'/#set');await page.locator('#language-select').waitFor();
    await page.screenshot({path:path.join(screenshots,'settings-en-guofeng.png'),fullPage:false});
    await page.locator('#language-select').selectOption('zh-CN');await page.getByRole('button',{name:'Apply language',exact:true}).click();
    await page.getByRole('option',{name:'中国风 · 青墨',exact:true}).waitFor({state:'attached'});
    await page.goto(base+'/#home');await page.locator('.command-hero').waitFor();
    await page.screenshot({path:path.join(themeShots,'guofeng-home-zh.png')});
    await page.setViewportSize({width:390,height:844});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    assert.deepEqual(errors,[]);
    console.log('Browser: legacy section routes, archive/restore/explicit continuation, preserved business content, persistent language, local diagrams, four themes, Chinese Ink & Jade persistence/dialogs and narrow layout passed.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>server.close());
