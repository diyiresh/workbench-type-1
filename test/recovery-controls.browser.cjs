'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { chromium } = require('playwright');
const publicRoot = path.resolve(__dirname, '..', 'public');
const writes = [];
const model = {
  run: { id: 'recovery-ui-fixture', controlGeneration: 1, automationPaused: false, externalAutomation: true, requiresWritingApproval: true, writingApproved: false,
    dutyPolicy:{enabled:false},coordinatorLastTickAt:new Date().toISOString(),
    recoveryPolicy: { enabled: true, maxAttempts: 3, reviewerFallback: 'codex', firstDelaySeconds: 30, secondDelaySeconds: 120 },
    items: [
      { id: 'director', role: 'director', label: '部门主管', ownerAgentId: 'codex', status: 'done' },
      { id: 'executor', role: 'executor', label: '主执行人', ownerAgentId: 'workbuddy', status: 'done' },
      { id: 'reviewer', role: 'reviewer', label: '独立复核人', ownerAgentId: 'cursor', status: 'queued', recovery: { status: 'scheduled', reason: '网络连接中断，等待重试 <script>unsafe()</script>', strategy: 'fallback-codex', nextRetryAt: new Date(Date.now()+60000).toISOString() } },
      { id: 'secretary', role: 'secretary', label: '整合秘书', ownerAgentId: 'codex', status: 'blocked' }
    ] },
  attempts: [
    { id: 'attempt-old', stepId: 'reviewer', agentId: 'cursor', purpose: 'stage', state: 'failed', createdAt: new Date().toISOString(), events: [] },
    { id: 'attempt-preparation', stepId: 'reviewer', agentId: 'cursor', purpose: 'stage', state: 'returned', createdAt: new Date(Date.now()-1000).toISOString(), events: [] },
    { id: 'attempt-preparation-failed', stepId: 'reviewer', agentId: 'cursor', purpose: 'stage', state: 'failed', createdAt: new Date(Date.now()-2000).toISOString(), events: [] }
  ],
  channels: [], skills: [], legacyJobs: []
};
let approvalReady = false;
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"></head><body><main id="fixture"></main><script type="module">
import { setStore } from '/js/core.js'; import { executionPanel, mountExecution } from '/js/execution-ui.js';
setStore({ meta: {language: 'zh-CN'}, modules: [], departmentRuns: [] });
window.remount = () => { document.getElementById('fixture').innerHTML = executionPanel({id:'recovery-ui-fixture'}); mountExecution(); };
document.addEventListener('click', e => {const b=e.target.closest('[data-act="department-manual"]'); if(b)window.manualTarget=b.dataset.itemId;});
window.remount();
</script></body></html>`;
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const json = (value, code=200) => {res.writeHead(code, {'Content-Type':'application/json'}); res.end(JSON.stringify(value));};
  if(url.pathname === '/test/approval-ready'){approvalReady=true; return json({ok:true});}
  if(url.pathname === '/test/recovery-status'){Object.assign(model.run.items.find(i=>i.id==='reviewer').recovery,{status:url.searchParams.get('status'),strategy:url.searchParams.get('strategy')});return json({ok:true});}
  if(url.pathname.startsWith('/api/')){
    if(req.method==='GET')return json(url.pathname.endsWith('/timeline') ? {entries:[]} : model);
    let text=''; for await(const chunk of req)text+=chunk; const body=JSON.parse(text); writes.push({path:url.pathname,body});
    if(body.confirmed!==true || body.expectedGeneration!==model.run.controlGeneration || !body.idempotencyKey)return json({error:'input_changed'},409);
    if(url.pathname.endsWith('/policy')){model.run.recoveryPolicy={enabled:body.enabled,maxAttempts:body.maxAttempts,reviewerFallback:body.reviewerFallback,firstDelaySeconds:body.firstDelaySeconds,secondDelaySeconds:body.secondDelaySeconds};}
    if(url.pathname.endsWith('/assign')){model.run.items.find(i=>i.id===body.stepId).ownerAgentId=body.ownerAgentId;}
    if(url.pathname.endsWith('/approve')){if(!approvalReady)return json({error:'prepare_not_ready'},409);model.run.writingApproved=true;}
    if(url.pathname.endsWith('/failover'))model.run.dutyPolicy.enabled=body.enabled;
    model.run.controlGeneration++; return json({ok:true});
  }
  if(url.pathname==='/'){res.writeHead(200,{'Content-Type':'text/html'});return res.end(html);}
  const file=path.resolve(publicRoot,'.'+url.pathname);
  if(!file.startsWith(publicRoot+path.sep)||!fs.existsSync(file)){res.writeHead(404);return res.end();}
  res.writeHead(200,{'Content-Type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'application/octet-stream'});fs.createReadStream(file).pipe(res);
});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try {
    const page=await browser.newPage({viewport:{width:1100,height:900}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(base);await page.locator('[data-execution-policy]').waitFor({state:'attached'});
    assert.equal(writes.length,0,'Opening the panel must remain read-only');
    await page.locator('[data-recovery-step="reviewer"]').getByText('正在自动恢复',{exact:true}).waitFor();
    assert.match(await page.locator('[data-recovery-step="reviewer"]').textContent(),/本轮连续调用：1 \/ 3 · 全部历史调用：3/);
    await page.locator('[data-recovery-step="reviewer"]').getByText('切换复核成员',{exact:false}).waitFor();
    await page.request.get(base+'/test/recovery-status?status=dispatching&strategy=structured-output');
    await page.locator('[data-execution-action="refresh"]').click();
    await page.locator('[data-recovery-step="reviewer"]').getByText('恢复尝试已启动',{exact:true}).waitFor();
    assert.match(await page.locator('[data-recovery-step="reviewer"]').textContent(),/按结构化要求重新生成/);
    await page.request.get(base+'/test/recovery-status?status=completed&strategy=retry');
    await page.locator('[data-execution-action="refresh"]').click();
    await page.locator('[data-recovery-step="reviewer"]').getByText('本阶段恢复已完成',{exact:true}).waitFor();
    assert.match(await page.locator('[data-recovery-step="reviewer"]').textContent(),/重试当前阶段/);
    assert.equal(await page.locator('[data-recovery-step] script').count(),0);
    await page.locator('[data-execution-management-details] summary').click();
    const form=()=>page.locator('[data-execution-policy]');
    await form().locator('[name=enabled]').uncheck();
    await form().locator('[name=maxAttempts]').selectOption('2');
    await form().locator('[name=reviewerFallback]').selectOption('none');
    await form().locator('[name=firstDelaySeconds]').fill('45');
    await form().locator('[name=secondDelaySeconds]').fill('44');
    assert.equal(await form().evaluate(el=>el.checkValidity()),false,'Later retry must not be earlier than the first retry');
    await form().locator('[name=secondDelaySeconds]').fill('180');
    await page.locator('[data-execution-action="refresh"]').click();
    assert.equal(writes.length,0);
    assert.equal(await form().locator('[name=enabled]').isChecked(),false);
    assert.equal(await form().locator('[name=maxAttempts]').inputValue(),'2');
    assert.equal(await form().locator('[name=firstDelaySeconds]').inputValue(),'45');
    assert.equal(await form().locator('[name=secondDelaySeconds]').inputValue(),'180');
    await page.evaluate(()=>window.remount());
    await form().waitFor({state:'attached'});
    assert.equal(await form().locator('[name=maxAttempts]').inputValue(),'2','Navigation/remount preserves unsaved recovery choices');
    assert.equal(await form().locator('[name=firstDelaySeconds]').inputValue(),'45');
    assert.equal(await form().locator('[name=secondDelaySeconds]').inputValue(),'180');
    await page.locator('[data-execution-management-details]').evaluate(el=>el.open=true);
    await form().locator('button').click();
    await page.getByText('自动恢复设置已保存。',{exact:true}).waitFor();
    assert.equal(writes.length,1);
    assert.deepEqual(model.run.recoveryPolicy,{enabled:false,maxAttempts:2,reviewerFallback:'none',firstDelaySeconds:45,secondDelaySeconds:180});
    await page.locator('[data-execution-assign="reviewer"] [name=ownerAgentId]').selectOption('codex');
    await page.locator('[data-execution-assign="reviewer"] button').click();
    await page.getByText('阶段分工已更新。',{exact:true}).waitFor();
    assert.equal(model.run.items.find(i=>i.id==='reviewer').ownerAgentId,'codex');
    assert.equal(await page.locator('[data-execution-assign="executor"] button').isDisabled(),true,'Completed stages cannot be reassigned');
    await page.locator('[data-act="department-manual"][data-item-id="reviewer"]').click();
    assert.equal(await page.evaluate(()=>window.manualTarget),'reviewer','Manual review uses the existing project action');
    await page.locator('[data-execution-action="approve"]').click();
    await page.getByText('准备材料尚待复核，请先查看项目中的待确认事项。',{exact:true}).waitFor();
    assert.equal(model.run.writingApproved,false);
    await page.request.post(base+'/test/approval-ready');
    await page.locator('[data-execution-action="approve"]').click();
    await page.getByText('正式写作批准已登记。',{exact:true}).waitFor();
    assert.equal(model.run.writingApproved,true);
    assert.equal(await page.locator('[data-execution-action="approve"]').count(),0,'Approved projects do not ask for repeated approval');
    await page.locator('[data-execution-action="failover"]').click();await page.getByText('未领取任务补位设置已保存。',{exact:true}).waitFor();assert.equal(model.run.dutyPolicy.enabled,true);assert.match(await page.locator('[data-duty-policy]').innerText(),/停用未领取任务补位/);
    await page.setViewportSize({width:390,height:844});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+2),'Narrow controls must not overflow');
    const executor=model.run.items.find(i=>i.id==='executor');executor.status='rework';executor.activeAttemptId='live-attempt';executor.recovery={sourceAttemptId:'old-attempt',status:'needs-user',reason:'old unresolved judgment'};
    model.attempts.unshift({id:'live-attempt',stepId:'executor',agentId:'workbuddy',purpose:'stage',state:'running',createdAt:new Date(Date.now()-300000).toISOString(),events:[{state:'running',at:new Date(Date.now()-60000).toISOString()}],startedEvidence:{source:'member-self-report'}});
    const before=writes.length;await page.reload();await page.locator('[data-execution-policy]').waitFor({state:'attached'});
    const checkpoint=page.locator('[data-stage-checkpoint="executor"]');await checkpoint.waitFor();assert.match(await checkpoint.textContent(),/等待成员提交真实成果/);assert.match(await checkpoint.textContent(),/live-attempt/);assert(!/old unresolved judgment/.test(await checkpoint.textContent()));assert.equal(await page.locator('[data-recovery-step="executor"] details').count(),1,'Old recovery judgment is retained as history rather than current blockage');
    assert.equal(writes.length,before,'Reload does not submit controls');
    assert.deepEqual(errors,[]);
    console.log('Recovery UI: safe progress, explicit policy/assignment/approval, preserved drafts, existing manual-review action, narrow viewport and read-only reload passed.');
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>server.close());
