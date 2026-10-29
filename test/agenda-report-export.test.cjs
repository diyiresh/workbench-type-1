const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const exporter=require('../lib/agenda-report-export'),jobs=require('../lib/agenda-report-jobs'),gov=require('../lib/execution-governance');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'bench-report-export-'));
const initial=require('../lib/default-store').buildDefaultStore();
initial.remote.agendaNotes={vaultRoot:root};initial.agendas=[{id:'fact',date:'2026-10-27',title:'Recorded fact',done:false,review:'未完成'}];
initial.agendaReportJobs=[{id:'report-export-fixture',agentId:'cursor',view:'month',anchorDate:'2026-10-27',sourceHash:jobs.sourceHash(initial,'month','2026-10-27'),status:'done',attemptId:'attempt-fixture',output:'# 完整月报\n正文',seed:{kind:'monthly',title:'2026年10月工作月报',period:'2026-10-01 ~ 2026-10-31'},createdAt:'2026-10-27T01:00:00Z',completedAt:'2026-10-27T01:01:00Z'}];
initial.executionAttempts=[{id:'attempt-fixture',state:'returned',resultHash:gov.hash('# 完整月报\n正文')}];
let s=structuredClone(initial);
const input={sourceJobId:s.agendaReportJobs[0].id,sourceHash:s.agendaReportJobs[0].sourceHash,body:'# 完整手工修改月报\n\n第一行\n第二行，保留中文与空行。\n'};
function command(store,key,extra={}){const p=exporter.preview(store,input);return {...input,previewSnapshot:p.snapshot,idempotencyKey:key,...extra};}
const read=receipt=>fs.readFileSync(receipt.file.path,'utf8');
assert(!fs.existsSync(path.join(root,exporter.FOLDER)));
assert.equal(exporter.preview(s,input).sourceState,'current');assert(!fs.existsSync(path.join(root,exporter.FOLDER)),'Preview must not create folders.');
const firstRequest=command(s,'first-save');const first=exporter.save(s,firstRequest);
assert.equal(first.file.version,1);assert.match(first.file.path,/monthly report comes from workbench/);assert.equal(first.status,'user-saved');
const bytes=fs.readFileSync(first.file.path);assert.equal(first.file.sha256,crypto.createHash('sha256').update(bytes).digest('hex'));
assert.equal(read(first).split('\n---\n').slice(1).join('\n---\n'),input.body);assert.match(read(first),/generated_by: "cursor"/);
assert.equal(s.reports.filter(r=>r.obsidianExportId===first.id).length,1);
assert.deepEqual(exporter.save(s,firstRequest),first);assert.equal(fs.readdirSync(path.join(root,exporter.FOLDER)).length,1);
assert.throws(()=>exporter.save(s,{...firstRequest,body:'changed payload'}),e=>e.code==='idempotency_conflict');
const second=exporter.save(s,command(s,'second-save'));assert.equal(second.file.version,2);assert.deepEqual(fs.readFileSync(first.file.path),bytes);
// Same generated draft after a completion-state change: explicit historical confirmation required.
s.agendas[0].done=true;s.agendaReportJobs[0].status='held';
const changed=exporter.preview(s,input);assert.equal(changed.sourceState,'changed');
assert.throws(()=>exporter.save(s,command(s,'unconfirmed')),e=>e.code==='report_historical_confirmation_required');
const historical=exporter.save(s,command(s,'historical',{confirmedHistorical:true}));
assert.equal(historical.status,'historical-draft');assert.match(read(historical),/status: "historical-draft"/);assert.match(read(historical),/source_state: "changed"/);
assert.equal(s.agendaReportJobs[0].status,'held','Export must not adopt or advance the old execution.');
const stale=command(s,'stale',{confirmedHistorical:true});s.agendas[0].review='Further source change';
assert.throws(()=>exporter.save(s,stale),e=>e.code==='report_export_preview_changed');
assert.throws(()=>exporter.save(s,{...command(s,'changed-body',{confirmedHistorical:true}),body:'different text'}),e=>e.code==='report_export_preview_changed');
// File readback succeeded but the ledger was not committed: retry recovers the same version.
const lostLedger=structuredClone(s),orphanRequest=command(s,'orphan-recovery',{confirmedHistorical:true});
const orphan=exporter.save(s,orphanRequest),files=fs.readdirSync(path.join(root,exporter.FOLDER)).length;
const recovered=exporter.save(lostLedger,orphanRequest);assert.equal(recovered.file.path,orphan.file.path);assert.equal(fs.readdirSync(path.join(root,exporter.FOLDER)).length,files);
fs.appendFileSync(orphan.file.path,'\nUser edited this file');assert.throws(()=>exporter.save(lostLedger,orphanRequest),e=>e.code==='report_file_changed');
// Unsafe or missing destination never records delivery, and existing user files remain intact.
const missing=structuredClone(initial);delete missing.remote.agendaNotes;assert.throws(()=>exporter.preview(missing,input),e=>e.code==='report_vault_missing');
const linkedRoot=fs.mkdtempSync(path.join(os.tmpdir(),'bench-report-linked-')),outside=fs.mkdtempSync(path.join(os.tmpdir(),'bench-report-outside-'));
fs.symlinkSync(outside,path.join(linkedRoot,exporter.FOLDER),'junction');const linked=structuredClone(initial);linked.remote.agendaNotes.vaultRoot=linkedRoot;
assert.throws(()=>exporter.preview(linked,input),e=>e.code==='report_directory_linked');assert.equal(fs.readdirSync(outside).length,0);
const cancelled=structuredClone(initial);cancelled.executionAttempts[0].resolution={by:'chairman'};assert.throws(()=>exporter.preview(cancelled,input),e=>e.code==='report_result_unavailable');
console.log('Obsidian report export: exact UTF-8 body/readback/SHA256, required historical acknowledgement, source/body recheck, immutable versions, idempotent retry/orphan recovery, tamper and linked-directory protection passed with isolated files.');
