'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {chromium}=require('playwright');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'bench-sidebar-resize-'));
process.env.BENCH_DATA_DIR=root;
const state=require('../lib/default-store').buildDefaultStore();
state.departmentRuns=[];state.modules=[];state.remote.vault={enabled:false};
const run=require('../lib/department').createDepartmentRun(state,{goal:'隔离调宽验收',participantAgentIds:['codex','workbuddy','cursor'],requiresWritingApproval:false,delivery:{mode:'text'}});
run.items.forEach(item=>{item.status='done';});run.status='completed';run.automationPaused=true;
for(let n=0;n<24;n++)state.departmentRuns.push({...structuredClone(run),id:'menu-fixture-'+n,title:'完整的项目原文标题 '+n+' '+ 'long-name-'.repeat(30)});
fs.writeFileSync(path.join(root,'store.json'),JSON.stringify(state));
const {createServer,readStore}=require('../server'),server=createServer();
function contrast(foreground,background){
  const luminance=rgb=>rgb.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
  const values=[luminance(foreground),luminance(background)].sort((a,b)=>b-a);return(values[0]+.05)/(values[1]+.05);
}
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({channel:'msedge',headless:true});

 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],writes=[],remote=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()!=='GET')writes.push(r.url());if(!r.url().startsWith(base))remote.push(r.url());});
  await page.route('**/api/briefings',route=>route.fulfill({json:{items:[]}}));
  // The retired secondary sidebar has no resize control. Project menus remain in the visible list.
  await page.goto(base+'/#projects/all');await page.locator('#ws-body .project-menu').first().waitFor();
  const original=readStore();
  assert.equal(await page.locator('#sidebar-resizer').isVisible(),false);
  for(const language of ['zh-CN','en'])for(const palette of ['studio','moonlit','porcelain','autumn']){
   await page.request.patch(base+'/api/meta',{data:{language}});
   await page.evaluate(palette=>localStorage.setItem('bench-appearance',JSON.stringify({palette})),palette);
   await page.reload();await page.locator('#ws-body .project-menu').last().waitFor();
   const menu=page.locator('#ws-body .project-menu').last(),summary=menu.locator('summary'),panel=menu.locator('[data-project-menu-panel]');
   await summary.scrollIntoViewIfNeeded();await summary.click();await panel.waitFor();
   assert.deepEqual(await panel.locator('button').allTextContents(),language==='en'?['Pinned','Rename','Archive','Delete']:['置顶','重命名','归档','删除']);
   const box=await panel.boundingBox();assert(box.x>=0&&box.y>=0&&box.x+box.width<=1440&&box.y+box.height<=1000);
   const colours=await panel.evaluate(e=>({background:getComputedStyle(e).backgroundColor,foreground:getComputedStyle(e.querySelector('button')).color}));
   assert(contrast(colours.foreground,colours.background)>=4.5);
   await page.keyboard.press('Escape');assert(await panel.isHidden());
  }
  await page.setViewportSize({width:390,height:900});
  const menu=page.locator('#ws-body .project-menu').first();await menu.locator('summary').scrollIntoViewIfNeeded();await menu.locator('summary').click();
  const box=await menu.locator('[data-project-menu-panel]').boundingBox();assert(box.x>=0&&box.x+box.width<=390&&box.y>=0&&box.y+box.height<=900);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);assert.deepEqual(remote,[]);
  for(const key of ['tasks','modules','departmentRuns','inbox','agents'])assert.deepEqual(readStore()[key],original[key]);
  console.log('Retired sidebar controls hidden; visible project menus, four palettes, two languages, contrast, viewport placement, Escape and zero business writes passed.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>server.close());
