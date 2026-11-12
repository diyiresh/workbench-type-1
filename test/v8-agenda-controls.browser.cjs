'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {chromium}=require('playwright');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'bench-v8-agenda-controls-'));
process.env.BENCH_DATA_DIR=root;
const state=require('../lib/default-store').buildDefaultStore();
state.remote.vault={enabled:false};state.departmentRuns=[];state.meta.companion={enabled:false,voice:false};
fs.writeFileSync(path.join(root,'store.json'),JSON.stringify(state));
const {createServer}=require('../server');const server=createServer();
async function contrast(locator){return locator.evaluate(el=>{
  const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d',{willReadFrequently:true});
  const rgb=color=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=color;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data].map((v,i)=>i===3?v/255:v);};
  const layers=[];for(let node=el;node;node=node.parentElement)layers.push(rgb(getComputedStyle(node).backgroundColor));
  let bg=[255,255,255];for(const color of layers.reverse())bg=bg.map((v,i)=>color[i]*color[3]+v*(1-color[3]));
  const fg=rgb(getComputedStyle(el).color).map((v,i)=>i<3?v:0);const alpha=rgb(getComputedStyle(el).color)[3];
  const ink=bg.map((v,i)=>fg[i]*alpha+v*(1-alpha));
  const luminance=c=>c.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
  const l=[luminance(bg),luminance(ink)].sort((a,b)=>b-a);return(l[0]+.05)/(l[1]+.05);
});}
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),writes=[];
  page.on('request',r=>{if(r.method()!=='GET')writes.push(r.url());});
  await page.route('**/api/briefings',r=>r.fulfill({json:{items:[]}}));
  await page.goto(base+'/#agenda/all');await page.locator('#agenda-date').waitFor();
  for(const palette of ['studio','moonlit','porcelain','autumn']){
   await page.locator('[data-v8="appearance"]').click();await page.locator(`[data-v8-palette="${palette}"]`).click();await page.locator('[data-v8="apply"]').click();
   for(const mode of ['day','week','month']){
    const button=page.locator(`.agenda-view-switch button[data-view="${mode}"]`);
    await button.click();await page.waitForTimeout(70);
    for(const control of ['.agenda-view-switch button[data-view="day"]','.agenda-view-switch button[data-view="week"]','.agenda-view-switch button[data-view="month"]','.agenda-hero .date-picker','#agenda-date']){
      const ratio=await contrast(page.locator(control));assert.ok(ratio>=4.5,`${palette}/${mode} ${control} contrast ${ratio.toFixed(2)} < 4.5`);
    }
    assert.equal(await button.getAttribute('class'),'active');
   }
   await page.screenshot({path:path.join(root,`${palette}.png`),fullPage:true});
  }
  await page.setViewportSize({width:390,height:844});assert.ok(await page.locator('#agenda-date').isVisible());assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.deepEqual(writes,[]);console.log('V8 agenda tabs and date label: 4 palettes × 3 modes, text contrast >=4.5, switching, mobile width and zero business writes passed. Screenshots: '+root);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>server.close());
