'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const notes=require('../lib/agenda-notes'),cleanup=require('../lib/agenda-note-cleanup'),names=require('../lib/review-note-filenames'),renaming=require('../lib/agenda-note-rename');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'bench-note-filenames-')),vaultRoot=path.join(root,'vault'),exclusionConfig=path.join(root,'config.toml');fs.mkdirSync(vaultRoot);fs.writeFileSync(exclusionConfig,`vault_path=${JSON.stringify(vaultRoot)}\nexclude_dirs=['行程复盘']`);
let store={remote:{agendaNotes:{vaultRoot,exclusionConfig}},agendas:[{id:'a',date:'2026-10-30',title:'项目:会议/复盘',review:'原始复盘',done:true},{id:'b',date:'2026-10-30',title:'项目:会议/复盘',review:'其他行程',done:true}]};
const directory=notes.ensureDirectory(store,true),savedTime='2026-10-30T18:03:04.000Z';
assert.equal(names.timestamp(savedTime),'2026-10-31 02-03-04');
assert.throws(()=>names.timestamp(undefined),/保存时间/);
for(const title of ['CON','A/B:C*D?E"F<G>H|I[链接]#标题','😀'.repeat(200),'...']){const file=names.filename(directory,title,1,savedTime,()=>false);assert(!/[<>:"/\\|?*#\[\]]/.test(file));assert(path.join(directory,file).length<=235);assert(file.includes(' - v1 - 2026-10-31 02-03-04'));assert(!/[\uD800-\uDBFF]$/.test(file.slice(0,file.indexOf(' - v'))));}
const draft=(id,summary)=>({sourceHash:notes.signature(store.agendas.find(a=>a.id===id)),configHash:notes.hash(JSON.stringify(notes.config(store))),summary,keywords:[]});
function legacy(id,summary){const saved=notes.save(store,id,draft(id,summary)).note;const file=`review-${notes.hash(id).slice(0,16)}-v${saved.version}.md`;fs.renameSync(saved.path,path.join(directory,file));fs.writeFileSync(path.join(directory,file),fs.readFileSync(path.join(directory,file),'utf8').replace(/^confirmed_at:.*$/m,'confirmed_at: '+JSON.stringify(savedTime)));return notes.readFile(directory,file);}
const first=legacy('a','第一版本'),second=legacy('a','第二版本'),other=legacy('b','另一个行程');
store.agendas[0].reviewNote={file:second.file,path:second.path,version:2};const oldDraft=notes.savedDraft(store,'a');
const removed=cleanup.moveOlder(store,'a',cleanup.plan(store,'a'));
let plan=renaming.preview(store);assert.equal(plan.files.length,3);assert(plan.files.every(f=>f.to.includes(' - v')));
const beforeBytes=new Map(plan.files.map(f=>[f.from,fs.readFileSync(path.join(directory,f.subdir,f.from))]));
const options={readStore:()=>structuredClone(store),writeStore:s=>{store=structuredClone(s);},backupRoot:path.join(root,'backups')};
assert.throws(()=>renaming.apply(options,{confirmed:true,idempotencyKey:'bad',snapshot:'stale'}),/重新预览/);
const command={confirmed:true,idempotencyKey:'migration',snapshot:plan.snapshot};const migrated=renaming.apply(options,command);assert.equal(migrated.renamedCount,3);
for(const f of plan.files){assert(!fs.existsSync(path.join(directory,f.subdir,f.from)));assert(fs.readFileSync(path.join(directory,f.subdir,f.to)).equals(beforeBytes.get(f.from)));}
assert.notEqual(store.agendas[0].reviewNote.file,second.file);assert.equal(notes.savedDraft(store,'a').summary,'第二版本');notes.validateBaseNote(store,'a',oldDraft);
assert.equal(renaming.apply(options,command).duplicate,true);assert.equal(renaming.preview(store).files.length,0);
const interruptedFile=plan.files[0],interruptedPath=path.join(directory,interruptedFile.subdir,interruptedFile.from);fs.writeFileSync(interruptedPath,beforeBytes.get(interruptedFile.from),{flag:'wx'});assert.throws(()=>renaming.apply(options,command),/尚有原路径/);fs.unlinkSync(interruptedPath);
const recovery=cleanup.listTrash(store);assert.equal(recovery.batches[0].id,removed.batch);assert(!recovery.batches[0].files[0].file.startsWith('review-'));cleanup.restore(store,removed.batch,{snapshot:recovery.batches[0].snapshot});assert.equal(notes.list(store).notes.length,3);
const newNote=notes.save(store,'a',{...oldDraft,summary:'第三版本'}).note;assert.equal(newNote.version,3);assert(newNote.file.startsWith('项目-会议-复盘 - v3 - '));assert.equal(notes.save(store,'a',{...oldDraft,summary:'第三版本'}).duplicate,true);
// A collision uses a readable suffix rather than replacing an unrelated file.
const candidate=names.filename(directory,'相同标题',1,savedTime,()=>false);fs.writeFileSync(path.join(directory,candidate),'keep');assert(names.filename(directory,'相同标题',1,savedTime).endsWith(' (2).md'));assert.equal(fs.readFileSync(path.join(directory,candidate),'utf8'),'keep');fs.unlinkSync(path.join(directory,candidate));
// Failure after file copies and during the ledger commit restores original paths and bytes.
const pending=legacy('b','迁移回滚版本'),original=fs.readFileSync(pending.path),rollbackPlan=renaming.preview(store);let failed=false;
const failing={...options,writeStore:s=>{if(!failed){failed=true;throw Error('simulated_ledger_failure');}store=structuredClone(s);}};
assert.throws(()=>renaming.apply(failing,{confirmed:true,idempotencyKey:'rollback',snapshot:rollbackPlan.snapshot}),/已回滚/);assert(fs.readFileSync(pending.path).equals(original));assert(renaming.preview(store).files.some(f=>f.from===pending.file));
console.log('Review filenames: stored Shanghai time, safe readable titles, long/Unicode/reserved names, collisions, duplicate saves, byte-identical legacy/trash migration, references and old draft compatibility, cleanup restore, idempotency, stale previews and rollback passed. Isolated vault only.');
