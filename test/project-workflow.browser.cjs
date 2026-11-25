'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {chromium}=require('playwright');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'bench-project-workflow-ui-'));process.env.BENCH_DATA_DIR=root;
const state=require('../lib/default-store').buildDefaultStore(),dept=require('../lib/department'),gov=require('../lib/execution-governance');
state.remote.vault={enabled:false};state.departmentRuns=[];state.executionAttempts=[];
const run=dept.createDepartmentRun(state,{workflowVersion:2,goal:'公开虚构项目：审批先于执行',roles:{director:'cursor',executor:'codex',reviewer:'workbuddy'},delivery:{mode:'text'}});
const p={id:'ui-final',number:2,kind:'final',content:{goal:run.goal,scope:'只使用公开虚构材料',approach:'先执行，再独立审核',dependencies:'无外部依赖',contingencies:'真实报告缺口',milestones:[{id:'one',title:'形成三项清单',deliverable:'一份清单',acceptance:'三项均有依据',dueAt:'2099-01-02T12:00:00+08:00',dependsOn:[],checks:[{at:'2099-01-01T12:00:00+08:00',contactRole:'executor',reason:'核对实际进度'}],checkBudget:2}]}};p.hash=gov.hash(p.content);
run.planVersions=[p];run.status='awaiting_plan_approval';run.items.forEach(i=>{i.purpose='plan-feedback';i.status='done';});
run.planFeedback=[{id:'f',planId:p.id,role:'executor',agentId:'codex',comment:'可以执行；<script>window.fixtureBad=true</script>'}];
require('./helpers/workflow-capability-fixture.cjs')(state,run);
fs.writeFileSync(path.join(root,'store.json'),JSON.stringify(state));let calls=0;
require('../lib/codex').generate=async()=>{calls++;throw Error('Unexpected model call');};require('../lib/external-runtime').generate=async()=>{calls++;throw Error('Unexpected model call');};
const {createServer}=require('../server'),server=createServer();
(async()=>{
 const approvalSecret='public-fixture-passphrase-2026';fs.writeFileSync(path.join(root,'chairman-auth.json'),JSON.stringify(await require('../lib/chairman-auth').credential(approvalSecret)));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/briefings',r=>r.fulfill({json:{items:[]}}));
  await page.goto(base+'/#projects/run:'+run.id);await page.locator('[data-workflow-approval]').waitFor();
  assert.equal(calls,0);assert.equal(await page.locator('[data-act="department-auto-run"]').count(),0);
  assert.equal(await page.evaluate(()=>window.fixtureBad),undefined);assert.equal(await page.locator('[data-workflow-pane] script').count(),0);
  await page.locator('[name="writingApproved"]').check();
  await page.locator('[data-workflow-action="refresh"]').click();await page.locator('[name="writingApproved"]').waitFor();assert(await page.locator('[name="writingApproved"]').isChecked());
  const approval=page.locator('[data-workflow-approval] button');await approval.click();await page.locator('[data-chairman-secret]').waitFor();await page.locator('[data-chairman-secret]').fill(approvalSecret);await page.locator('[data-chairman-secret]').press('Enter');await page.locator('[data-workflow-approval]').waitFor({state:'detached'});
  assert.equal(calls,0);await page.locator('[data-workflow-tab="progress"]').click();
  const evidence=path.join(root,'workflow-progress.png');await page.screenshot({path:evidence,fullPage:false});
  await page.locator('details.card > summary').last().click();
  await page.getByText('人工 / 外部 Agent 回填',{exact:true}).click();
  await page.locator('[data-workflow-action="manual-start"]').click();await page.locator('[data-workflow-manual]').waitFor();
  await page.locator('[data-workflow-manual] [name="output"]').fill('公开清单：第一项、第二项、第三项。');
  await page.locator('[data-workflow-manual] button[type="submit"]').click();await page.locator('[data-workflow-manual]').waitFor({state:'detached'});assert.equal(calls,0);
  await page.goto(base+'/#projects/new');await page.locator('#department-goal-form').waitFor();
  await page.locator('[name="goal"]').fill('草稿中文原文 <draft>');await page.locator('[name="context"]').fill('保留材料路径');await page.locator('[name="director"]').selectOption('cursor');await page.locator('[name="executor"]').selectOption('codex');await page.locator('[name="reviewer"]').selectOption('workbuddy');await page.locator('[name="deliveryProfile"]').selectOption('single');
  await page.reload();await page.locator('#department-goal-form').waitFor();assert.equal(await page.locator('[name="director"]').inputValue(),'cursor');assert.equal(await page.locator('[name="deliveryProfile"]').inputValue(),'single');
  await page.request.patch(base+'/api/meta',{data:{language:'en'}});await page.reload();await page.getByRole('heading',{name:'New project',exact:true}).waitFor();assert.equal(await page.locator('[name="goal"]').inputValue(),'草稿中文原文 <draft>');
  await page.setViewportSize({width:480,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+2));
  await page.screenshot({path:path.join(root,'workflow-new-en-narrow.png'),fullPage:false});
  await page.route('**/api/departments/runs',route=>route.fulfill({status:403,json:{error:'chairman_auth_setup_required'}}));
  await page.locator('#department-goal-form button[type="submit"]').click();
  try{await page.waitForFunction(()=>document.querySelector('[data-intake-feedback]')?.textContent.includes('chairman-auth.cjs setup'),null,{timeout:5000});}catch(error){console.error(await page.evaluate(()=>({feedback:document.querySelector('[data-intake-feedback]')?.textContent,invalid:[...document.querySelector('#department-goal-form').elements].filter(e=>e.validity&&!e.validity.valid).map(e=>({name:e.name,value:e.value,message:e.validationMessage}))})));throw error;}
  assert.equal(await page.locator('[name="goal"]').inputValue(),'草稿中文原文 <draft>');assert.equal(await page.locator('[name="director"]').inputValue(),'cursor');
  assert.deepEqual(errors,[]);console.log('Workflow UI: plan approval, exact roles, escaped feedback, preserved drafts, English and narrow layout passed. Screenshots: '+root);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>server.close());
