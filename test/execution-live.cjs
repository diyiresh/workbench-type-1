'use strict';
// Opt-in only: one real ChatGPT-authenticated Codex call, public synthetic text,
// isolated ledger, no production projects, no VaultRAG and no WorkBuddy calls.
if(process.env.BENCH_REAL_CODEX!=='1'){
  console.log('Skipped. Set BENCH_REAL_CODEX=1 to explicitly run one real public-fixture Codex acceptance.');
  process.exit(0);
}
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'bench-execution-live-'));process.env.BENCH_DATA_DIR=root;
const dept=require('../lib/department'),skills=require('../lib/skill-studio'),gov=require('../lib/execution-governance');
let state=require('../lib/default-store').buildDefaultStore();state.departmentRuns=[];state.remote.vault={enabled:false};
const run=dept.createDepartmentRun(state,{goal:'仅用公开合成文字做通道验收：列出一个三步核验清单，不读取文件，不执行工具，不委派成员，不撰写公文。场景：有人只说任务 PASS，却没有提供文件。按明确提供的阶段技能提示核验要点。',participantAgentIds:['codex','workbuddy','cursor'],requiresWritingApproval:false,delivery:{mode:'text'}});
const req=body=>({...body,idempotencyKey:randomUUID()});
const skillId=skills.create(state,req({sourceRefs:[]})).skillId,skill=skills.get(state,skillId),skillRoot=path.join(root,'skill-library');
skills.mutate(state,skillRoot,skillId,'draft',req({expectedRevision:skill.revision,name:'public-delivery-rule',description:'Public synthetic delivery evidence check',scope:'只对本次公开合成样例检查交付证据，不增加权限。',allowedAgents:['codex'],markdown:'---\nname: public-delivery-rule\ndescription: "Public synthetic delivery evidence check"\n---\n\n## 规则\n输出必须包含 PUBLIC_DELIVERY_CHECK_V2 标记。明确说明：成果返回不等于文件验收通过；只有 PASS 没有实际文件时不能确认文件已交付。给三条可检查的核验步骤。'}));
skills.mutate(state,skillRoot,skillId,'publish',req({expectedRevision:skill.revision,confirmed:true}));
const version=skill.versions[0];dept.getItem(run,'director').skillBindings=[{skillId,versionId:version.id,contentHash:version.contentHash}];
gov.configure({skillRoot,channelState:()=>({state:'paused'})});
const readStore=()=>structuredClone(state),writeStore=s=>{gov.observeControls(s,state);state=structuredClone(s);fs.writeFileSync(path.join(root,'store.json'),JSON.stringify(state,null,2));};
writeStore(state);let calls=0;
const manager=require('../lib/codex-jobs').createManager({readStore,writeStore,generate:(prompt,context)=>{calls++;return require('../lib/codex').generate(prompt,{...context,timeoutMs:90000});}});
(async()=>{
  const job=manager.start({runId:run.id,role:'director',idempotencyKey:randomUUID()});
  const deadline=Date.now()+120000;
  while(Date.now()<deadline&&readStore().codexJobs[0].status==='doing')await new Promise(resolve=>setTimeout(resolve,250));
  const result=readStore(),saved=result.codexJobs.find(j=>j.id===job.id),attempt=result.executionAttempts.find(a=>a.id===job.attemptId);
  const evidence={at:new Date().toISOString(),isolatedRoot:root,realCodexCalls:calls,workbuddyCalls:0,vaultCalls:0,status:saved.status,attemptState:attempt.state,blockerCode:attempt.blockerCode||null,processEvidence:attempt.startedEvidence||null,skillBindings:attempt.skillBindings,promptHash:attempt.promptHash,resultHash:attempt.resultHash,output:saved.output,error:saved.error};
  const folder=path.resolve(__dirname,'..','data','acceptance-iteration2');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,'codex-public-fixture.json'),JSON.stringify(evidence,null,2));
  assert.equal(saved.status,'done',saved.error);assert.equal(attempt.state,'returned');assert.equal(attempt.startedEvidence.source,'process-event');assert.equal(attempt.skillBindings[0].contentHash,version.contentHash);assert.match(saved.output,/PUBLIC_DELIVERY_CHECK_V2/);assert.match(saved.output,/文件|验收/);assert.equal(calls,1);assert.equal(dept.getItem(result.departmentRuns[0],'executor').status,'queued');assert(!result.externalJobs?.length);
  console.log('One real Codex public-fixture call passed: exact skill version injected, process start and complete result persisted, director stage completed only, no automatic relay, no production ledger write. Evidence: '+path.join(folder,'codex-public-fixture.json'));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
