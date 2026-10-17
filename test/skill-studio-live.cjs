// Explicit opt-in acceptance against the existing ChatGPT CLI. Never part of npm test.
'use strict';
if (process.env.BENCH_RUN_LIVE_SKILL_TEST !== '1') throw new Error('Set BENCH_RUN_LIVE_SKILL_TEST=1 to authorize one real CLI call.');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const studio=require('../lib/skill-studio');
const root=path.join(__dirname,'..','data','skill-studio-validation',new Date().toISOString().replace(/[:.]/g,'-'));
fs.mkdirSync(root,{recursive:true});
const ledger=path.join(root,'isolated-ledger.json'),skillRoot=path.join(root,'skills');
const state=require('../lib/default-store').buildDefaultStore();
state.modules=[];state.tasks=[{id:'acceptance-only',title:'只读技能验收样例',status:'doing',progress:0}];
state.lessons=[{id:'public-example',rule:'只有 PASS 字样不能证明实际文件交付。缺少文件、路径和哈希时，应说明待核验，不能声称文件已存在。',from:'公开构造的验收用例，不含业务资料'}];
const req=body=>({...body,idempotencyKey:randomUUID()});
const created=studio.create(state,req({sourceRefs:[{collection:'lessons',id:'public-example'}]}));const skill=studio.get(state,created.skillId);
studio.mutate(state,skillRoot,skill.id,'draft',req({expectedRevision:skill.revision,name:'evidence-receipt-test',description:'Check whether file delivery is evidenced',scope:'只读分析本测试输入，不执行文件操作。',allowedAgents:['codex'],markdown:'---\nname: evidence-receipt-test\ndescription: "Check whether file delivery is evidenced"\n---\n\n只有 PASS 字样不能证明实际文件交付。缺少文件、路径和哈希时，应说明待核验，不能声称文件已存在。请简短指出缺失证据。'}));
studio.mutate(state,skillRoot,skill.id,'publish',req({expectedRevision:skill.revision,confirmed:true}));
studio.mutate(state,skillRoot,skill.id,'cases',req({expectedRevision:skill.revision,title:'PASS 无实际文件',input:'Agent 只回复 PASS，没有附文件，也没有文件路径和哈希。可以认定文件交付了吗？',checks:'应指出证据不足，不能认定实际文件交付；应返回指定版本的接收标记。'}));
fs.writeFileSync(ledger,JSON.stringify(state,null,2));
const readStore=()=>JSON.parse(fs.readFileSync(ledger,'utf8')),writeStore=store=>fs.writeFileSync(ledger,JSON.stringify(store,null,2));
const manager=studio.createManager({readStore,writeStore,root:skillRoot});
const result=manager.start(req({skillId:skill.id,versionId:skill.currentVersionId,caseId:state.skillCases[0].id,agentId:'codex',targetRef:{kind:'task',id:'acceptance-only'}}));
console.log(JSON.stringify({started:true,attemptId:result.attemptId,isolatedLedger:ledger}));
const started=Date.now();
const timer=setInterval(()=>{
  const current=readStore(),run=current.skillRuns.find(r=>r.id===result.attemptId);
  if(run.state==='running' && Date.now()-started<140000)return;
  clearInterval(timer);
  const proof={at:new Date().toISOString(),attemptId:run.id,state:run.state,error:run.error||null,versionId:run.versionId,contentHash:run.contentHash,outputHash:run.outputHash||null,deliveryEvidence:run.deliveryEvidence||null,threadId:run.threadId||null,adopted:run.adopted,taskProgress:current.tasks[0].progress};
  fs.writeFileSync(path.join(root,'proof.json'),JSON.stringify(proof,null,2));
  console.log(JSON.stringify({...proof,proofDirectory:root}));
  try{assert.equal(run.state,'awaiting-evaluation');assert.equal(run.deliveryEvidence.acknowledged,true);assert.match(run.output,/不能|不足|不可以|无法/);assert.equal(current.tasks[0].progress,0);}
  catch(error){console.error(error.message);process.exitCode=1;}
},500);
