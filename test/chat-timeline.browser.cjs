const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
process.env.BENCH_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'bench-chat-timeline-'));
const {buildDefaultStore}=require('../lib/default-store');
const {createDepartmentRun}=require('../lib/department');
const state=buildDefaultStore();
state.meta.briefingDismissedOn=require('../lib/migrate').ymd();
const first=createDepartmentRun(state,{goal:'Synthetic timeline one',participantAgentIds:['codex','cursor','workbuddy']});
const second=createDepartmentRun(state,{goal:'Synthetic timeline two',participantAgentIds:['codex','cursor','workbuddy']});
state.projectMessages=Array.from({length:60},(_,index)=>({id:'timeline-'+index,runId:first.id,sender:index%2?'workbuddy':'chairman',type:'progress',text:index===30?'Long historical message\n'+('Original historical material\n'.repeat(40)):'Message '+index+'\nContext and evidence\nOriginal text remains unchanged.',createdAt:'2026-10-12T00:'+String(index).padStart(2,'0')+':00.000Z'})).reverse();
state.projectMessages.unshift({id:'second-room',runId:second.id,sender:'cursor',type:'suggestion',text:'Independent second room',createdAt:'2026-10-12T02:00:00.000Z'});
// Imported or backfilled records need not be stored in timestamp order.
state.projectMessages.unshift(state.projectMessages.splice(state.projectMessages.findIndex(message=>message.id==='timeline-10'),1)[0]);
fs.writeFileSync(path.join(process.env.BENCH_DATA_DIR,'store.json'),JSON.stringify(state));
const {createServer,readStore,writeStore}=require('../server');
const server=createServer();
const viewport=page=>page.locator('.project-messages').evaluate(chat=>{
  const top=chat.getBoundingClientRect().top;
  const anchor=[...chat.querySelectorAll('.chat-message')].find(message=>message.getBoundingClientRect().bottom>top);
  return {bottom:chat.scrollHeight-chat.clientHeight-chat.scrollTop,top:chat.scrollTop,anchor:anchor?.dataset.messageId,offset:anchor?.getBoundingClientRect().top-top};
});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    const open=async runId=>{await page.goto(base+'/#department/'+runId);await page.locator('[data-room-form="'+runId+'"]').waitFor();};
    await open(first.id);
    assert((await viewport(page)).bottom<2,'First entry should display the latest messages at the bottom');
    await page.reload();await page.locator('.project-messages').waitFor();
    assert((await viewport(page)).bottom<2,'A full browser refresh must not jump to the oldest message');

    await page.locator('[data-message-id="timeline-30"].chat-long').evaluate(element=>element.open=true);
    await page.locator('.project-messages').evaluate(chat=>chat.scrollTop=chat.querySelector('article[data-message-id="timeline-30"]').offsetTop-chat.offsetTop+120);
    const historical=await viewport(page);assert(historical.top>0&&historical.bottom>100);
    await page.reload();await page.locator('.project-messages').waitFor();
    const restored=await viewport(page);
    assert.equal(restored.anchor,historical.anchor);assert(Math.abs(restored.offset-historical.offset)<2);
    assert(await page.locator('.chat-long[data-message-id="timeline-30"]').evaluate(element=>element.open));
    await page.locator('[data-room-form] textarea').fill('Unsent draft remains original');
    await page.locator('[data-room-form] textarea').evaluate(input=>input.setSelectionRange(3,10));
    await page.locator('[data-room-form] [name=recipient]').selectOption('cursor');

    let fresh=readStore();fresh.projectMessages.unshift({id:'latest-message',runId:first.id,sender:'workbuddy',type:'progress',text:'New response arriving while history is being read',createdAt:'2026-10-12T01:00:00.000Z'});writeStore(fresh);
    await page.locator('article[data-message-id="latest-message"]').waitFor({timeout:12000});
    const afterArrival=await viewport(page);assert.equal(afterArrival.anchor,historical.anchor);assert(Math.abs(afterArrival.offset-historical.offset)<2);
    assert.equal(await page.locator('[data-room-form] textarea').inputValue(),'Unsent draft remains original');
    assert.equal(await page.locator('[data-room-form] [name=recipient]').inputValue(),'cursor');

    await page.locator('.project-messages').evaluate(chat=>chat.scrollTop=chat.scrollHeight);
    fresh=readStore();fresh.projectMessages.unshift({id:'newest-message',runId:first.id,sender:'cursor',type:'suggestion',text:'New response arriving at the latest timeline',createdAt:'2026-10-12T01:01:00.000Z'});writeStore(fresh);
    await page.locator('article[data-message-id="newest-message"]').waitFor({timeout:12000});
    assert((await viewport(page)).bottom<2,'A reader at the bottom should follow the new response');
    const times=await page.locator('.project-messages time').evaluateAll(nodes=>nodes.map(node=>Date.parse(node.dateTime)));
    assert.deepEqual(times,[...times].sort((a,b)=>a-b),'Messages must remain chronological');

    await page.locator('.project-messages').evaluate(chat=>{chat.scrollTop=500;});const beforeSwitch=await viewport(page);
    await open(second.id);assert.equal(await page.locator('.project-messages article').count(),1);
    await open(first.id);const afterSwitch=await viewport(page);assert.equal(afterSwitch.anchor,beforeSwitch.anchor);assert(Math.abs(afterSwitch.offset-beforeSwitch.offset)<2);
    await page.evaluate(()=>{window.timelineRepaints=0;new MutationObserver(()=>window.timelineRepaints++).observe(document.getElementById('ws-body'),{childList:true});});
    const unchanged=page.waitForResponse(response=>response.url().endsWith('/messages'));
    await unchanged;await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    assert.equal(await page.evaluate(()=>window.timelineRepaints),0,'An unchanged poll must not repaint the room');
    assert.deepEqual(errors,[]);
    console.log('Chat timeline: initial latest view, full-refresh restoration, historical anchor/expanded text, live arrivals, separate rooms, chronological order and unchanged polling passed.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>server.close());
