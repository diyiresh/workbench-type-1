"use strict";
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const dept = require('../lib/department');
const delivery = require('../lib/delivery');
const { buildDefaultStore } = require('../lib/default-store');
const { addArtifact } = require('../lib/collaboration');
const { exportDocx, readDocx } = require('../lib/docx-export');

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-delivery-'));
  let store = buildDefaultStore();
  const run = dept.createDepartmentRun(store, { goal: '报告文件', requiresWritingApproval: false, delivery: { mode: 'files', directory: root } });
  for (const role of ['director','executor']) { dept.startItem(store, run.id, role); dept.submitItem(store, run.id, role, { output: role === 'executor' ? '# 报告\n\n0012 & 零\n\n1. 第一项\n2. 第二项\n\n|甲|乙|\n|---|---|\n|正文|表格|\n' : '执行方案' }); }
  assert.equal(run.items[2].status, 'blocked', 'No review before files exist');
  assert.throws(() => dept.startItem(store, run.id, 'reviewer'));
  assert.throws(() => addArtifact(store, { runId: run.id, name: 'fake.docx', path: path.join(root,'missing.docx') }));
  const manager = delivery.createManager({ readStore: () => store, writeStore: value => { store = value; }, root });
  const proof = await manager.generate(run.id);
  const assignedReader=run.items[2].ownerAgentId;run.items[2].ownerAgentId='codex';
  const suppliedEvidence=delivery.instruction(store,run,'reviewer');
  assert.ok(suppliedEvidence.includes('实际文件读回文本'));assert.ok(suppliedEvidence.includes('0012 & 零'));run.items[2].ownerAgentId=assignedReader;
  assert.equal(run.items[2].status, 'queued');
  assert.equal(delivery.records(store,run).length, 1);
  assert.match(readDocx(fs.readFileSync(proof.files[0].path)), /0012 & 零/);
  assert.match(readDocx(fs.readFileSync(proof.files[0].path)), /1\. 第一项\n2\. 第二项/);
  assert.deepEqual(await manager.generate(run.id), proof, 'Duplicate export is idempotent');
  assert.throws(() => dept.reviewExecutor(store, run.id, { verdict: 'pass', comment: '正文通过', reviewerAgentId: run.items[2].ownerAgentId }), /snapshot/);
  assert.throws(() => delivery.reviewFiles(store,run,{ verdict:'pass',comment:'自审',reviewerAgentId:run.items[1].ownerAgentId,reviewedSnapshot:proof }),/independent/);
  dept.reviewExecutor(store,run.id,{ verdict:'pass',comment:'文件逐项核对通过',reviewerAgentId:run.items[2].ownerAgentId,reviewedSnapshot:proof });
  dept.startItem(store,run.id,'secretary'); dept.submitItem(store,run.id,'secretary',{output:'已核验文件清单及未决事项'});
  assert.equal(run.status,'completed'); assert.equal(run.delivery.state,'accepted');
  const file = proof.files[0].path, original = fs.readFileSync(file);
  fs.writeFileSync(file, (await exportDocx('# 别的内容')).buffer);
  delivery.refresh(store,run);
  assert.equal(run.delivery.state,'invalidated'); assert.notEqual(run.status,'completed');
  fs.writeFileSync(file, original);
  run.delivery.state='files_ready';
  const readbackFile = proof.files[0].readbackPath, originalReadback=fs.readFileSync(readbackFile,'utf8');
  fs.writeFileSync(readbackFile,'假的复核文本');
  assert.throws(()=>delivery.snapshot(store,run),/readback_changed/);
  fs.writeFileSync(readbackFile,originalReadback);
  run.items[1].output += '正文修订';
  assert.throws(()=>delivery.reviewFiles(store,run,{verdict:'pass',comment:'旧批次',reviewerAgentId:run.items[2].ownerAgentId,reviewedSnapshot:proof}),/source_changed/);
  fs.unlinkSync(file); assert.throws(()=>delivery.snapshot(store,run));
  assert.throws(()=>delivery.contract({mode:'files',files:[{name:'../escape.docx'}]}));
  assert.throws(()=>delivery.contract({mode:'files',directory:'relative'}));
  assert.throws(()=>delivery.part('没有标记',{start:'start',end:'end'}),/marker/);
  assert.throws(()=>delivery.part('start xx start end',{start:'start',end:'end'}),/ambiguous/);

  const legacy = dept.createDepartmentRun(store,{goal:'简单文字计算',requiresWritingApproval:false});
  for(const role of ['director','executor']){dept.startItem(store,legacy.id,role);dept.submitItem(store,legacy.id,role,{output:'正文'});}
  dept.reviewExecutor(store,legacy.id,{verdict:'pass',comment:'通过',reviewerAgentId:legacy.items[2].ownerAgentId});
  dept.startItem(store,legacy.id,'secretary');dept.submitItem(store,legacy.id,'secretary',{output:'合计'});
  assert.equal(legacy.status,'completed','Text projects remain compatible');
  delivery.configure(legacy,{mode:'files',directory:root});assert.equal(legacy.status,'awaiting_files','Backfill retains all stage history');
  const backfill=await manager.generate(legacy.id);assert.equal(legacy.status,'awaiting_file_review');
  legacy.archived=true;assert.throws(()=>delivery.reviewFiles(store,legacy,{verdict:'pass',comment:'late',reviewerAgentId:legacy.items[2].ownerAgentId,reviewedSnapshot:backfill}),/independent/);
  await assert.rejects(manager.generate(legacy.id),/not_ready/);legacy.archived=false;

  let unblock;
  delivery.configure(legacy,{mode:'files',files:[{name:'next.docx'}],directory:root});
  const slow=delivery.createManager({readStore:()=>store,writeStore:value=>{store=value},root,build:async text=>{await new Promise(resolve=>{unblock=resolve});return exportDocx(text);}});
  const pending=slow.generate(legacy.id);await new Promise(resolve=>setImmediate(resolve));legacy.archiveGeneration=1;legacy.resumeRequired=true;unblock();
  await assert.rejects(pending,/held/);assert.equal(legacy.delivery.artifactIds.length,0);
  legacy.resumeRequired=false;legacy.delivery.state='generating';manager.recover();assert.equal(legacy.delivery.state,'failed');

  // A pause during an asynchronous export prevents registration and relay.
  legacy.automationPaused=false;
  const pausedExport=slow.generate(legacy.id);await new Promise(resolve=>setImmediate(resolve));legacy.automationPaused=true;unblock();
  await assert.rejects(pausedExport,/held/);assert.equal(legacy.delivery.artifactIds.length,0);

  // Supplemental review uses the assigned independent reader and binds the exact files.
  legacy.automationPaused=false;
  await manager.generate(legacy.id);
  let called=0;
  const supplement=delivery.createManager({readStore:()=>store,writeStore:value=>{store=value},root,reviewExecute:async(agent,prompt)=>{
    called++;assert.equal(agent,legacy.items[2].ownerAgentId);
    const snapshot=delivery.snapshot(store,legacy);
    for(const file of snapshot.files){assert.ok(prompt.includes(JSON.stringify(file.readbackPath)));assert.equal(fs.readFileSync(file.readbackPath,'utf8'),readDocx(fs.readFileSync(file.path)));}
    return '文件一致\nFILE_REVIEW: '+snapshot.batchId+' PASS\nVERDICT: PASS';
  }});
  await supplement.supplement(legacy.id);assert.equal(called,1);assert.equal(legacy.delivery.state,'accepted');

  delivery.configure(legacy,{mode:'files',files:[{name:'held-review.docx'}],directory:root});await manager.generate(legacy.id);
  let resolveReview;
  const heldReview=delivery.createManager({readStore:()=>store,writeStore:value=>{store=value},root,reviewExecute:()=>new Promise(resolve=>{resolveReview=resolve})});
  const reviewing=heldReview.supplement(legacy.id);await new Promise(resolve=>setImmediate(resolve));legacy.automationPaused=true;resolveReview('迟到的文件复核');await reviewing;
  assert.equal(legacy.delivery.state,'failed');assert.equal(legacy.heldDeliveryReviews.at(-1).output,'迟到的文件复核');assert.notEqual(legacy.status,'completed');

  const columns=Array.from({length:11},(_,i)=>'列'+i);
  await assert.rejects(exportDocx('|'+columns.join('|')+'|\n|'+columns.map(()=> '---').join('|')+'|\n|'+columns.join('|')+'|'),/too_many_columns/);

  // Validate cleanup target is the exact unique temporary directory.
  assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
  assert.match(path.basename(root),/^bench-delivery-/); fs.rmSync(root,{recursive:true,force:true});
  console.log('File delivery gates, version checks, readback, retries, compatibility and held-result checks passed.');
})().catch(error=>{console.error(error);process.exitCode=1});
