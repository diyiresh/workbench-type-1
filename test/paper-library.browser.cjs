'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {chromium}=require('playwright');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'bench-paper-ui-'));process.env.BENCH_DATA_DIR=root;
const state=require('../lib/default-store').buildDefaultStore();state.meta.companion={enabled:false,voice:false};state.remote.vault={enabled:false};state.departmentRuns=[];
fs.writeFileSync(path.join(root,'store.json'),JSON.stringify(state));
const bytes=Buffer.from('%PDF-1.4\nfixture data\n%%EOF\n');let imports=0,downloads=0;
const source=Buffer.from('window.AGENT_DATA = '+JSON.stringify({sections:[{title:'Research',subsections:[{title:'Memory',collection:[{text:'Linked collection',url:'https://deepshare.feishu.cn/docx/sample',count:50}],items:[{title:'Memory paper <script>not executable</script>',desc:'Test source',links:[{label:'paper',url:'https://arxiv.org/abs/2601.14192'}]},{title:'Project resource',links:[{label:'code',url:'https://github.com/example/sample'}]}]}]}]})+';');
const {createServer,readStore}=require('../server');
const server=createServer({paperFetchBytes:async(url,options)=>{if(options.source){imports++;return source;}downloads++;options.onProgress({bytes:bytes.length,total:bytes.length});return bytes;}});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],external=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(!r.url().startsWith(base))external.push(r.url());});
  await page.route('**/api/briefings',r=>r.fulfill({json:{items:[]}}));
  await page.goto(base+'/#assets/all');await page.locator('.v8-subnav a[href="#assets/papers"]').click();
  await page.locator('#paper-library').waitFor();await page.waitForTimeout(120);assert.equal(imports,0);assert.equal(downloads,0);
  await page.locator('[data-paper-action=import]').click();await page.locator('.paper-record').first().waitFor();
  assert.equal(await page.locator('.paper-record').count(),2);assert.equal(imports,1);assert.equal(downloads,0);assert.equal(await page.locator('[data-paper-collections] a').count(),1);
  assert.ok((await page.locator('.paper-record h3').first().textContent()).includes('<script>'));assert.equal(await page.locator('.paper-record script').count(),0);
  await page.locator('[data-paper-search]').fill('Memory paper');assert.equal(await page.locator('.paper-record').count(),1);
  const record=page.locator('.paper-record');await record.locator('[data-paper-action=favorite]').click();

  await page.waitForFunction(()=>document.querySelector('[data-paper-action=favorite]')?.getAttribute('aria-pressed')==='true');
  await record.locator('[data-paper-reading]').selectOption('reading');await page.waitForTimeout(100);
  await record.locator('[data-paper-action=download]').click();await record.locator('a[href$="/file"]').waitFor();assert.equal(downloads,1);
  const fileLink=await record.locator('a[href$="/file"]').getAttribute('href');const response=await page.request.get(base+fileLink);assert.equal(response.status(),200);assert.deepEqual(await response.body(),bytes);
  await record.locator('[data-paper-action=download]').click();await page.waitForTimeout(100);assert.equal(downloads,1);
  await page.reload();await page.locator('[data-paper-action=favorite][aria-pressed=true]').waitFor();assert.equal(await page.locator('[data-paper-reading]').first().inputValue(),'reading');
  await page.locator('[data-paper-action=import]').click();await page.waitForTimeout(100);assert.equal(imports,2);assert.equal(await page.locator('[data-paper-reading]').first().inputValue(),'reading');
  const foreign=await page.request.post(base+'/api/papers/import',{headers:{Origin:'https://untrusted.example'},data:{}});assert.equal(foreign.status(),403);assert.equal(imports,2);
  const patch=await page.request.patch(base+fileLink.replace('/file',''),{data:{pdf:{file:'../../secret'}}});assert.equal(patch.status(),400);
  await page.screenshot({path:path.join(root,'papers-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:path.join(root,'papers-mobile.png'),fullPage:true});
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.deepEqual(readStore().agendas,state.agendas||[]);
  console.log('Paper UI/API: V8 entrance, explicit import, search, escaped source titles, favorites/reading persistence, selected download, verified local PDF, duplicate reuse, refresh retention, origin/patch guards, mobile and no unsolicited remote requests passed. Screenshots: '+root);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>server.close());
