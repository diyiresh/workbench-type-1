'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { randomUUID } = require('node:crypto');
const skills = require('../lib/skill-studio');
const { changeArchive } = require('../lib/archive');
const root = fs.mkdtempSync(path.join(os.tmpdir(),'bench-skills-'));
process.env.BENCH_DATA_DIR = path.join(root,'ledger'); fs.mkdirSync(process.env.BENCH_DATA_DIR);
const fileRoot = path.join(root,'skills');
const state = require('../lib/default-store').buildDefaultStore();
state.lessons = [{id:'chosen',rule:'先核验真实文件，再判断交付。',from:'测试项目'}, {id:'unselected',rule:'DO_NOT_IMPORT_THIS'}];
state.tasks = [{id:'target',title:'隔离任务',status:'doing',progress:10}]; state.modules = [];
const preserved = JSON.stringify([state.lessons,state.tasks]);
const req = body => ({...body,idempotencyKey:randomUUID()});
let skill, first, second;
function edit(markdownBody='检查文件路径、内容与哈希。') {
  const name='delivery-check', description='Review actual deliverables';
  return {name,description,scope:'只检查提供的交付证据，不生成正式公文。',allowedAgents:['codex','workbuddy'],markdown:`---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n\n${markdownBody}`};
}
function mutation(operation, body={}) { return skills.mutate(state,fileRoot,skill.id,operation,req({...body,expectedRevision:skill.revision})); }
const clone = value => JSON.parse(JSON.stringify(value));
const pause = () => new Promise(resolve => setTimeout(resolve,8));
async function waitDone(read) { for(let i=0;i<150;i++){if(read().state!=='running')return;await pause();}throw new Error('test_timeout'); }
(async()=>{
  const initial=req({sourceRefs:[{collection:'lessons',id:'chosen'}]});
  const created=skills.create(state,initial); skill=skills.get(state,created.skillId);
  assert.equal(skills.create(state,initial).duplicate,true);assert.equal(state.skillLibrary.length,1);
  assert(!JSON.stringify(skill).includes('DO_NOT_IMPORT_THIS')); assert.equal(skill.sourceRefs[0].body,state.lessons[0].rule+'\n测试项目');
  assert(!fs.existsSync(fileRoot));
  assert.throws(()=>skills.create(state,{...initial,sourceRefs:[]}),/idempotency_conflict/);
  assert.throws(()=>skills.create(state,req({sourceRefs:[{collection:'remote',id:'x'}]})),/source_invalid/);
  assert.throws(()=>mutation('publish'),/confirmation_required/);
  mutation('draft',edit());
  assert.throws(()=>mutation('publish'),/confirmation_required/);
  assert.throws(()=>skills.mutate(state,fileRoot,skill.id,'draft',req({...edit(),expectedRevision:1})),/revision_conflict/);
  const publishing=req({confirmed:true,expectedRevision:skill.revision});
  skills.mutate(state,fileRoot,skill.id,'publish',publishing);first=skill.currentVersionId;
  assert.equal(skills.mutate(state,fileRoot,skill.id,'publish',publishing).duplicate,true);assert.equal(skill.versions.length,1);
  const firstFile=path.join(fileRoot,skill.id,first,'SKILL.md'), firstBytes=fs.readFileSync(firstFile);
  assert.equal(skills.readVersion(fileRoot,skill,first).contentHash,skills.hash(firstBytes));
  assert.throws(()=>mutation('draft',{...edit(),markdown:'---\nname: mismatched\n---\nbody'}),/frontmatter_invalid/);
  mutation('draft',edit('先核验内容与源版本，再检查哈希。'));assert.equal(skill.currentVersionId,first);
  mutation('publish',{confirmed:true});second=skill.currentVersionId;assert.notEqual(first,second);assert.deepEqual(fs.readFileSync(firstFile),firstBytes);
  mutation('restore',{versionId:first});assert.equal(skill.currentVersionId,second);assert.equal(skill.draft.markdown,firstBytes.toString());
  mutation('publish',{confirmed:true});assert.equal(skill.versions.length,3);assert.equal(skill.versions[2].restoredFrom,first);
  mutation('cases',{title:'缺少文件的交付',input:'仅有 PASS 字样，没有文件路径或正文。',checks:'必须指出无法验收，不能声称文件已存在。'});
  const caseId=state.skillCases[0].id, activeVersion=skill.currentVersionId;
  assert.equal(JSON.stringify([state.lessons,state.tasks]),preserved);
  let database=clone(state), calls=0, release, callback;
  const read=()=>clone(database),write=s=>{database=clone(s);};
  const manager=skills.createManager({readStore:read,writeStore:write,root:fileRoot,execute:async(agent,prompt,context)=>{
    calls++; callback?.(); if(release)await new Promise(resolve=>{release=resolve;});
    assert.equal(agent,'codex'); assert([first,second,activeVersion].includes(context.versionId));
    assert(prompt.includes(skills.readVersion(fileRoot,skill,context.versionId).markdown));
    return {text:prompt.match(/SKILL_RECEIPT [^\n]+/)[0]+'\n缺少实际文件证据，不能验收。',threadId:'test-thread'};
  }});
  const runBody=req({skillId:skill.id,caseId,versionId:activeVersion,agentId:'codex',targetRef:{kind:'task',id:'target'}});
  const started=manager.start(runBody);assert.equal(manager.start(runBody).duplicate,true);
  const run=()=>read().skillRuns.find(r=>r.id===started.attemptId);
  await waitDone(run);assert.equal(calls,1);assert.equal(run().state,'awaiting-evaluation');assert.equal(run().deliveryEvidence.acknowledged,true);assert.equal(run().adopted,'unknown');assert.equal(read().tasks[0].progress,10);
  assert.throws(()=>manager.evaluate(skill.id,req({attemptId:started.attemptId,outputHash:'bad',verdict:'pass',evidence:'checked'})),/output_conflict/);
  manager.evaluate(skill.id,req({attemptId:started.attemptId,outputHash:run().outputHash,verdict:'pass',evidence:'输出明确指出缺少实际文件证据。'}));assert.equal(run().state,'evaluated');assert.equal(run().evaluation.outputHash,run().outputHash);
  assert.throws(()=>manager.start(req({...runBody,agentId:'workbuddy'})),/runtime_not_supported/);assert.equal(calls,1);
  const comparison=manager.start(req({...runBody,versionId:second}));
  const comparisonRun=()=>read().skillRuns.find(r=>r.id===comparison.attemptId);await waitDone(comparisonRun);
  assert.equal(comparisonRun().state,'awaiting-evaluation');assert.deepEqual(comparisonRun().inputSnapshot,run().inputSnapshot);assert.notEqual(comparisonRun().contentHash,run().contentHash);
  database.agents.find(a=>a.id==='codex').resumeRequired=true;
  assert.throws(()=>manager.start(req(runBody)),/agent_paused/);database.agents.find(a=>a.id==='codex').resumeRequired=false;
  database.tasks[0].resumeRequired=true;assert.throws(()=>manager.start(req(runBody)),/target_paused/);database.tasks[0].resumeRequired=false;
  // Disable while a real call is pending, then re-enable: the late result stays held.
  let signal;const began=new Promise(resolve=>{signal=resolve;});release=true;callback=signal;
  const held=manager.start(req(runBody));await began;await pause();
  let current=database.skillLibrary[0];skills.mutate(database,fileRoot,current.id,'state',req({expectedRevision:current.revision,state:'disabled'}));
  assert.throws(()=>manager.start(req(runBody)),/busy|not_enabled/);
  skills.mutate(database,fileRoot,current.id,'state',req({expectedRevision:current.revision,state:'published'}));
  release();release=null;callback=null;await waitDone(()=>read().skillRuns.find(r=>r.id===held.attemptId));
  assert.equal(read().skillRuns.find(r=>r.id===held.attemptId).state,'held');
  const archiveBegan=new Promise(resolve=>{callback=resolve;});release=true;
  const archivedLate=manager.start(req(runBody));await archiveBegan;await pause();
  for (const action of ['archive','restore','resume']) changeArchive(database,{action,items:[{collection:'skillLibrary',id:skill.id}]});
  release();release=null;callback=null;await waitDone(()=>read().skillRuns.find(r=>r.id===archivedLate.attemptId));assert.equal(read().skillRuns.find(r=>r.id===archivedLate.attemptId).state,'held');
  // Restart does not silently retry an unfinished request.
  database.skillRuns.push({id:'interrupted',state:'running'});manager.recover();assert.equal(database.skillRuns.at(-1).state,'interrupted');
  const failedManager=skills.createManager({readStore:read,writeStore:write,root:fileRoot,execute:async()=>{throw new Error('real_adapter_unavailable');}});
  const failed=failedManager.start(req(runBody));await waitDone(()=>read().skillRuns.find(r=>r.id===failed.attemptId));assert.equal(read().skillRuns.find(r=>r.id===failed.attemptId).state,'failed');assert.equal(read().skillRuns.find(r=>r.id===failed.attemptId).evaluation,null);
  changeArchive(database,{action:'archive',items:[{collection:'skillLibrary',id:skill.id}]});assert.throws(()=>failedManager.start(req(runBody)),/not_enabled/);
  changeArchive(database,{action:'restore',items:[{collection:'skillLibrary',id:skill.id}]});assert.throws(()=>failedManager.start(req(runBody)),/not_enabled/);
  changeArchive(database,{action:'resume',items:[{collection:'skillLibrary',id:skill.id}]});
  fs.writeFileSync(firstFile,'tampered');assert.throws(()=>skills.readVersion(fileRoot,skill,first),/file_changed/);fs.writeFileSync(firstFile,firstBytes);
  const currentFile=path.join(fileRoot,skill.id,activeVersion,'SKILL.md');const bytes=fs.readFileSync(currentFile);fs.unlinkSync(currentFile);
  assert.throws(()=>failedManager.start(req(runBody)),/file_missing/);fs.writeFileSync(currentFile,bytes);
  assert.throws(()=>skills.readVersion(fileRoot,{...skill,id:'../../outside'},first),/path_invalid/);
  const originalFolder=path.join(fileRoot,skill.id), savedFolder=originalFolder+'-saved';
  fs.renameSync(originalFolder,savedFolder);fs.symlinkSync(savedFolder,originalFolder,process.platform==='win32'?'junction':'dir');
  assert.throws(()=>skills.readVersion(fileRoot,skill,first),/path_link/);fs.unlinkSync(originalFolder);fs.renameSync(savedFolder,originalFolder);
  // HTTP routes: isolated ledger, fresh revision after concurrent requests, read-only GET.
  fs.writeFileSync(path.join(process.env.BENCH_DATA_DIR,'store.json'),JSON.stringify(require('../lib/default-store').buildDefaultStore()));
  const {createServer}=require('../server'),server=createServer();
  try {
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
    const api=async(p,body)=>{const response=await fetch(base+p,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:response.status,body:await response.json()};};
    const item=await api('/api/skill-library',req({sourceRefs:[]}));assert.equal(item.status,200);
    const apiId=item.body.skillId;const changes=await Promise.all([api('/api/skill-library/'+apiId+'/draft',req({...edit(),expectedRevision:1})),api('/api/skill-library/'+apiId+'/draft',req({...edit(),expectedRevision:1}))]);
    assert.deepEqual(changes.map(r=>r.status).sort(),[200,409]);
    const before=fs.readFileSync(path.join(process.env.BENCH_DATA_DIR,'store.json'),'utf8');await api('/api/skill-library');await api('/api/skill-library/'+apiId);assert.equal(fs.readFileSync(path.join(process.env.BENCH_DATA_DIR,'store.json'),'utf8'),before);
  } finally {server.close();}
  console.log('Skill Studio: source boundaries, confirmed immutable versions, idempotency, conflicts, fixed tests, adapter receipt contract, pause/late-result/restart guards, archives and isolated HTTP checks passed. Real CLI acceptance is separate.');
})().catch(error=>{console.error(error);process.exitCode=1;});
