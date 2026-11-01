'use strict';
const fs=require('node:fs'),path=require('node:path'),{randomUUID,createHash}=require('node:crypto');
const notes=require('./agenda-notes'),names=require('./review-note-filenames');
const legacy=/^review-[0-9a-f]{16}-v\d+\.md$/;
const hash=value=>createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value)).digest('hex');
const fail=message=>{throw new Error(message);};
function preview(store) {
  const listing=notes.list(store),directory=path.resolve(listing.directory),recovery=require('./agenda-note-cleanup').listTrash(store);
  if(listing.ignored.some(n=>legacy.test(n.file))||recovery.ignored.length)fail('旧笔记或恢复批次有异常，未开始改名。');
  if((store.agendaReportJobs||[]).some(j=>j.workType==='review-note'&&['waiting','doing','uncertain'].includes(j.status)))fail('有复盘成员任务执行中或待核对，请先处理后改名。');
  const files=[],receipts=[],occupied=new Set([...listing.notes.map(n=>n.file),...recovery.batches.flatMap(b=>b.files.map(f=>f.file))].map(n=>n.toLowerCase()));
  const add=(note,subdir='')=>{
    if(!legacy.test(note.file))return;
    const dir=path.join(directory,subdir),to=names.filename(dir,note.title,note.version,note.meta.confirmed_at,name=>fs.existsSync(path.join(dir,name))||occupied.has(name.toLowerCase()));
    occupied.add(to.toLowerCase());
    files.push({subdir,from:note.file,to,agendaId:note.agendaId,version:note.version,sha256:note.sha256,bytesSha256:hash(fs.readFileSync(note.path)),savedAt:note.meta.confirmed_at});
  };
  listing.notes.forEach(n=>add(n));
  for(const batch of recovery.batches){
    const subdir=path.join('.trash',batch.id),dir=path.join(directory,subdir);
    for(const file of batch.files)add(notes.readFile(dir,file.file),subdir);
    const relative=path.join(subdir,'receipt.json');receipts.push({relative,sha256:hash(fs.readFileSync(path.join(directory,relative)))});
  }
  const references=(store.agendas||[]).map(a=>({id:a.id,reviewNote:a.reviewNote}));
  return {directory,files,receipts,snapshot:hash([directory,files,receipts,references,store.agendaNoteNameMigrations||[]])};
}
function apply({readStore,writeStore,backupRoot},body){
  if(body.confirmed!==true||typeof body.idempotencyKey!=='string'||!body.idempotencyKey||body.idempotencyKey.length>100)fail('请明确确认改名并提供幂等键。');
  const before=readStore(),old=(before.agendaNoteNameMigrations||[]).find(m=>m.key===body.idempotencyKey);
  if(old){
    if(old.requestSnapshot!==body.snapshot)fail('改名请求的幂等键已用于其他快照。');
    for(const file of old.files){const dir=path.join(old.directory,file.subdir),target=path.join(dir,file.to);if(fs.existsSync(path.join(dir,file.from)))fail('上次改名尚有原路径，请依据备份恢复记录核对，未重复报告成功。');notes.readFile(dir,file.to);if(hash(fs.readFileSync(target))!==file.bytesSha256)fail('改名后的文件已变化，不能重复报告成功。');}
    return {renamedCount:old.files.length,backup:old.backup,duplicate:true};
  }
  const plan=preview(before);if(!body.snapshot||plan.snapshot!==body.snapshot)fail('笔记或引用已变化，请重新预览改名。');
  if(!plan.files.length)return {renamedCount:0,duplicate:false};
  fs.mkdirSync(backupRoot,{recursive:true});const rootStat=fs.lstatSync(backupRoot);if(!rootStat.isDirectory()||rootStat.isSymbolicLink())fail('改名备份目录必须为普通目录。');
  const backup=path.join(backupRoot,'rename-'+randomUUID());fs.mkdirSync(backup);
  const manifest={...plan,state:'prepared',createdAt:new Date().toISOString()},manifestPath=path.join(backup,'manifest.json');
  fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2),{flag:'wx'});
  const originalReceipts=plan.receipts.map(r=>({relative:r.relative,bytes:fs.readFileSync(path.join(plan.directory,r.relative))}));
  const copy=fs.constants.COPYFILE_EXCL;
  for(let i=0;i<plan.files.length;i++){const f=plan.files[i],src=path.join(plan.directory,f.subdir,f.from);if(hash(fs.readFileSync(src))!==f.bytesSha256)fail('备份前笔记已变化，未开始改名。');fs.copyFileSync(src,path.join(backup,'note-'+i+'.md'),copy);}
  originalReceipts.forEach((r,i)=>fs.writeFileSync(path.join(backup,'receipt-'+i+'.json'),r.bytes,{flag:'wx'}));
  const referenceBackup=(before.agendas||[]).map(a=>({id:a.id,reviewNote:a.reviewNote}));fs.writeFileSync(path.join(backup,'references.json'),JSON.stringify(referenceBackup,null,2),{flag:'wx'});
  const copied=[],removed=[],changedReceipts=[];let ledgerAttempted=false;
  try{
    for(const f of plan.files){
      const src=path.join(plan.directory,f.subdir,f.from),dest=path.join(plan.directory,f.subdir,f.to);
      if(hash(fs.readFileSync(src))!==f.bytesSha256)fail('改名前笔记已变化。');
      fs.copyFileSync(src,dest,copy);copied.push(f);
      if(hash(fs.readFileSync(dest))!==f.bytesSha256)fail('改名后的文件读回不一致。');
    }
    for(const r of originalReceipts){
      const target=path.join(plan.directory,r.relative);if(!fs.readFileSync(target).equals(r.bytes))fail('恢复凭据已变化。');
      const receipt=JSON.parse(r.bytes),subdir=path.dirname(r.relative);
      let modified=false;
      const kept=plan.files.find(f=>!f.subdir&&f.from===receipt.kept.file);if(kept){receipt.kept.file=kept.to;modified=true;}
      for(const entry of receipt.files){const changed=plan.files.find(f=>f.subdir===subdir&&f.from===entry.file);if(changed){entry.file=changed.to;modified=true;}}
      if(modified){const content=JSON.stringify(receipt,null,2);changedReceipts.push(r);fs.writeFileSync(target,content);if(fs.readFileSync(target,'utf8')!==content)fail('恢复凭据读回不一致。');}
    }
    const updated=structuredClone(before);
    for(const a of updated.agendas||[]){const f=plan.files.find(f=>!f.subdir&&a.reviewNote?.file===f.from);if(f){a.reviewNote.file=f.to;a.reviewNote.path=path.join(plan.directory,f.to);}}
    const record={key:body.idempotencyKey,requestSnapshot:body.snapshot,directory:plan.directory,files:plan.files,backup,completedAt:new Date().toISOString()};
    (updated.agendaNoteNameMigrations||=[]).push(record);ledgerAttempted=true;writeStore(updated);
    for(const f of plan.files){const src=path.join(plan.directory,f.subdir,f.from);if(hash(fs.readFileSync(src))!==f.bytesSha256)fail('移除原文件前发现变化。');fs.unlinkSync(src);removed.push(f);}
    manifest.state='completed';fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2));
    return {renamedCount:plan.files.length,backup,duplicate:false};
  }catch(error){
    const failures=[];
    for(const f of removed){try{const i=plan.files.indexOf(f);fs.copyFileSync(path.join(backup,'note-'+i+'.md'),path.join(plan.directory,f.subdir,f.from),copy);}catch(e){failures.push(e.message);}}
    for(const r of changedReceipts){try{fs.writeFileSync(path.join(plan.directory,r.relative),r.bytes);}catch(e){failures.push(e.message);}}
    if(ledgerAttempted){try{writeStore(before);}catch(e){failures.push(e.message);}}
    if(!failures.length)for(const f of copied){try{const target=path.join(plan.directory,f.subdir,f.to);if(hash(fs.readFileSync(target))!==f.bytesSha256)fail('目标已变动，保留供核对。');fs.unlinkSync(target);}catch(e){failures.push(e.message);}}
    manifest.state=failures.length?'recovery-required':'rolled-back';manifest.error=error.message;manifest.rollbackErrors=failures;fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2));
    fail(error.message+'；备份及恢复记录：'+backup+(failures.length?'；需核对：'+failures.join('；'):'；已回滚。'));
  }
}
module.exports={preview,apply};
