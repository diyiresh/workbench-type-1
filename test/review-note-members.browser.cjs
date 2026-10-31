'use strict';
const assert=require('node:assert/strict'), fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {chromium}=require('playwright');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'bench-review-members-ui-'));process.env.BENCH_DATA_DIR=path.join(root,'ledger');fs.mkdirSync(process.env.BENCH_DATA_DIR);
const vaultRoot=path.join(root,'vault'),exclusionConfig=path.join(root,'config.toml');fs.mkdirSync(vaultRoot);fs.writeFileSync(exclusionConfig,`vault_path=${JSON.stringify(vaultRoot)}\nexclude_dirs=['行程复盘']`);
const state=require('../lib/default-store').buildDefaultStore();state.agendas=[{id:'fixture',date:'2026-10-31',time:'15:00',title:'Isolated appointment',done:false,review:'Original review',tags:[]}];
state.remote.agendaNotes={vaultRoot,exclusionConfig};state.remote.llm={enabled:false,provider:'openai',baseUrl:'https://api.siliconflow.cn/v1'};state.remote.providerPauses={siliconflow:{paused:true}};
fs.writeFileSync(path.join(process.env.BENCH_DATA_DIR,'store.json'),JSON.stringify(state));
let calls=[],hold=false,release,fail=false;
const {createServer,readStore}=require('../server');
const server=createServer({reportExecute:async(agent,prompt,ctx)=>{calls.push({agent,prompt});if(fail)throw Error('isolated_member_failure');if(agent!=='workbuddy')ctx.onBeforeStart();if(hold)await new Promise(r=>release=r);return '## 关键记录\n'+agent+' returned summary';}});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;const browser=await chromium.launch({channel:'msedge',headless:true});
try{const page=await browser.newPage({viewport:{width:1440,height:1000},timezoneId:'Asia/Shanghai'});page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
await page.clock.setFixedTime(new Date('2026-10-31T12:00:00+08:00'));await page.route('**/api/briefings',r=>r.fulfill({json:{items:[]}}));
await page.goto(base+'/#agenda');const open=()=>page.locator('[data-act="agenda-review"]').click(),close=()=>page.locator('[data-note-close]').click();const summary=page.locator('#review-note-summary');
await open();assert(await page.locator('[data-note-draft]').isDisabled());assert(await page.locator('.note-completion-hint').isVisible());
const style=await page.locator('[data-note-draft]').evaluate(e=>({cursor:getComputedStyle(e).cursor,opacity:+getComputedStyle(e).opacity}));assert.equal(style.cursor,'not-allowed');assert(style.opacity<1);
await page.locator('#review-note-original').fill('Saved while incomplete');await page.locator('[data-note-review-only]').click();await page.getByText('复盘已保存。',{exact:true}).waitFor();assert.equal(readStore().agendas[0].review,'Saved while incomplete');assert.equal(calls.length,0);assert.equal(readStore().agendas[0].done,false);await close();
await page.request.patch(base+'/api/agendas/fixture',{data:{done:true}});await page.reload();
for(const agent of ['codex','cursor','workbuddy']){await open();await page.locator('[data-note-member]').selectOption(agent);await page.locator('[data-note-draft]').click();await summary.waitFor();assert.match(await summary.inputValue(),new RegExp(agent));assert.equal(calls.at(-1).agent,agent);assert(!fs.existsSync(path.join(vaultRoot,'工作台')));await close();}
await page.reload();await page.locator('#agenda-report-agent').waitFor();assert.equal((await page.locator('#agenda-report-status').textContent()).trim(),'','Review jobs must not appear as daily report jobs');
await open();await page.locator('[data-note-job-restore]').waitFor();const before=calls.length;await page.locator('[data-note-job-restore]').click();await summary.waitFor();assert.equal(calls.length,before);assert.match(await summary.inputValue(),/workbuddy/);
await summary.fill('## 待确认问题\n回复：已沟通但未采纳');await page.locator('[data-note-member]').selectOption('cursor');await page.locator('[data-note-refine]').click();await page.getByText('补充已整合，请审阅更新后的摘要，再确认保存。',{exact:true}).waitFor();assert.match(calls.at(-1).prompt,/已沟通但未采纳/);assert(await page.locator('[data-note-before-text]').textContent().then(t=>t.includes('已沟通但未采纳')));await close();
// Late output must not overwrite edits made while a member runs.
await open();hold=true;await page.locator('[data-note-member]').selectOption('codex');await page.locator('[data-note-draft]').click();await page.waitForFunction(()=>document.querySelector('[data-note-job-status]').textContent.includes('codex'));
await page.locator('#review-note-original').fill('New edit during generation');release();hold=false;await page.getByText('生成期间内容已修改，已保留当前草稿，请重试。',{exact:true}).waitFor();assert.equal(await page.locator('#review-note-original').inputValue(),'New edit during generation');await close();
// A failed member leaves text editable and does not silently call another route.
await open();fail=true;await page.locator('[data-note-member]').selectOption('cursor');await page.locator('[data-note-draft]').click();await page.locator('[data-note-message]').filter({hasText:'isolated_member_failure'}).waitFor();assert.equal(await page.locator('#review-note-original').inputValue(),'Saved while incomplete');fail=false;await close();
await page.request.patch(base+'/api/meta',{data:{language:'en'}});await page.reload();await open();assert.equal(await page.locator('[data-note-member]').inputValue(),'cursor');await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(root,'review-member-en-mobile.png')});assert(await page.locator('[data-note-member]').isVisible());assert.deepEqual(errors,[]);assert.equal(readStore().remote.providerPauses.siliconflow.paused,true);
console.log('Review member UI/API: incomplete save and visible gate, three members, no automatic note writes, restore without dispatch, current-draft integration, edits during generation, failure retention, remembered choice and EN/mobile passed with isolated adapters. Screenshots: '+root);
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>server.close());
