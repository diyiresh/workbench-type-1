'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const gov = require('./execution-governance');
const { sourceHash } = require('./agenda-report-jobs');
const FOLDER = 'monthly report comes from workbench';
const fileHash = value => createHash('sha256').update(value).digest('hex');
const fail = (code, message = code) => { throw Object.assign(new Error(message), { code }); };
function directory(store, create = false) {
  const root = store.remote?.agendaNotes?.vaultRoot;
  if (typeof root !== 'string' || !path.isAbsolute(root)) fail('report_vault_missing', '请先配置 Obsidian 仓库路径。');
  const absolute = path.resolve(root);
  const rootStat = fs.lstatSync(absolute);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || fs.realpathSync(absolute).toLowerCase() !== absolute.toLowerCase()) fail('report_vault_linked', '报告仓库必须为真实目录，不能使用目录链接。');
  const target = path.join(absolute, FOLDER);
  if (!fs.existsSync(target)) { if (create) fs.mkdirSync(target); else return target; }
  const stat = fs.lstatSync(target);
  if (!stat.isDirectory() || stat.isSymbolicLink() || fs.realpathSync(target).toLowerCase() !== target.toLowerCase()) fail('report_directory_linked', '报告分类必须为真实目录，不能使用目录链接。');
  return target;
}
function inspect(store, body) {
  const job = (store.agendaReportJobs || []).find(j => j.id === body.sourceJobId);
  const attempt = job && (store.executionAttempts || []).find(a => a.id === job.attemptId);
  if (!job || job.seed.kind !== 'monthly' || body.sourceHash !== job.sourceHash) fail('report_source_changed', '报告来源无法对应，请保留草稿并重新载入原报告。');
  if (!['done','held'].includes(job.status) || !job.output || !attempt?.resultHash || attempt.resolution || job.archived) fail('report_result_unavailable', '没有可以保存的完整报告返回。');
  if (typeof body.body !== 'string' || !body.body.trim() || Buffer.byteLength(body.body, 'utf8') > 1000000) fail('report_body_invalid', '报告正文为空或超过保存上限。');
  const current = sourceHash(store, job.view, job.anchorDate);
  const sourceState = current === job.sourceHash && job.status === 'done' ? 'current' : 'changed';
  const target = directory(store);
  const snapshot = gov.hash({ jobId:job.id, attemptId:attempt.id, resultHash:attempt.resultHash, jobStatus:job.status,
    sourceHash:job.sourceHash, current, target, body:body.body, title:job.seed.title });
  return { job, attempt, current, sourceState, target, snapshot };
}
function preview(store, body) {
  const p = inspect(store, body);
  return { sourceJobId:p.job.id, snapshot:p.snapshot, sourceState:p.sourceState, currentSourceHash:p.current, sourceHash:p.job.sourceHash,
    directory:p.target, title:p.job.seed.title, message:p.sourceState === 'changed' ? '生成报告后日程来源或执行状态已变化，可保留为历史草稿，或重新生成。' : '将保存到报告库并写入 Obsidian，保留完整正文。' };
}
function checkedFile(store, receipt) {
  const root = directory(store);
  const file = receipt.file;
  if (!file || path.dirname(path.resolve(file.path)) !== root || !/^\d{4}-\d{2}-工作月报-v\d+\.md$/.test(path.basename(file.path))) fail('report_file_scope_changed');
  const stat = fs.lstatSync(file.path);
  if (!stat.isFile() || stat.isSymbolicLink() || fileHash(fs.readFileSync(file.path)) !== file.sha256) fail('report_file_changed', '已导出文件发生变化，请核对，未覆盖原文件。');
  return receipt;
}
function save(store, body) {
  if (typeof body.idempotencyKey !== 'string' || !body.idempotencyKey || body.idempotencyKey.length > 100) fail('idempotency_key_required');
  const requestHash = gov.hash(body), exportId = 'rex-' + gov.hash(body.idempotencyKey).slice(0,24);
  const old = (store.reportExports || []).find(e => e.id === exportId);
  if (old) {
    if (old.requestHash !== requestHash) fail('idempotency_conflict');
    if (!(store.reports || []).some(r=>r.id===old.reportId)) fail('report_library_record_missing', '原报告库记录已被删除，请核对后另存新版本。');
    return checkedFile(store, old);
  }
  const p = inspect(store, body);
  if (body.previewSnapshot !== p.snapshot) fail('report_export_preview_changed', '日程、正文或保存目录再次变化，请重新确认。');
  if (p.sourceState === 'changed' && body.confirmedHistorical !== true) fail('report_historical_confirmation_required', '来源已变化，需明确确认保存为历史草稿。');
  const target = directory(store, true), month = p.job.anchorDate.slice(0,7);
  const prefix = month + '-工作月报-v';
  const names = fs.readdirSync(target).filter(name => name.startsWith(prefix) && /^\d{4}-\d{2}-工作月报-v\d+\.md$/.test(name));
  let version = names.reduce((n,name) => Math.max(n,Number(name.match(/-v(\d+)\.md$/)[1])),0) + 1;
  if (!Number.isSafeInteger(version) || version>99999999) fail('report_version_conflict');
  const savedAt = new Date().toISOString();
  const historical = p.sourceState === 'changed';
  const properties = { title:p.job.seed.title, type:'monthly-report', source:'workbench', status:historical?'historical-draft':'user-saved',
    period:p.job.seed.period, generated_by:p.job.agentId, source_job_id:p.job.id, source_attempt_id:p.attempt.id,
    source_snapshot_sha256:p.job.sourceHash, source_state:p.sourceState, current_source_sha256:p.current,
    generated_at:p.job.completedAt || p.job.createdAt, saved_at:savedAt, export_id:exportId, request_sha256:requestHash };
  let file, bytes, effectiveSavedAt = savedAt;
  // Recover a completed file if the prior ledger commit failed; never overwrite it.
  for (const name of names) {
    const candidate = path.join(target,name), stat = fs.lstatSync(candidate);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1200000) continue;
    const content = fs.readFileSync(candidate,'utf8');
    const boundary=content.indexOf('\n---\n'),header=content.slice(0,boundary);
    if (!content.startsWith('---\n') || boundary<0 || !header.includes('\nexport_id: ' + JSON.stringify(exportId) + '\n')) continue;
    if (!header.includes('\nrequest_sha256: ' + JSON.stringify(requestHash) + '\n') || content.slice(boundary + 5) !== body.body + (body.body.endsWith('\n')?'':'\n')) fail('report_file_changed');
    let metadata;
    try { metadata=Object.fromEntries(header.slice(4).split('\n').filter(Boolean).map(line=>{const separator=line.indexOf(': ');return[line.slice(0,separator),JSON.parse(line.slice(separator+2))];})); }
    catch { fail('report_file_changed'); }
    if (Object.entries(properties).some(([key,value])=>key!=='saved_at'&&metadata[key]!==value) || metadata.version!==Number(name.match(/-v(\d+)\.md$/)[1]) || typeof metadata.saved_at!=='string' || !Number.isFinite(Date.parse(metadata.saved_at))) fail('report_file_changed');
    effectiveSavedAt=metadata.saved_at;
    file = { path:candidate, version:Number(name.match(/-v(\d+)\.md$/)[1]), sha256:fileHash(Buffer.from(content,'utf8')), size:stat.size };
    break;
  }
  if (!file) {
    for (let tries=0;tries<100;tries++,version++) {
      const final = path.join(target,prefix+String(version).padStart(3,'0')+'.md');
      bytes = Buffer.from('---\n'+Object.entries({...properties,version}).map(([key,value])=>key+': '+JSON.stringify(value)).join('\n')+'\n---\n'+body.body+(body.body.endsWith('\n')?'':'\n'),'utf8');
      let fd;
      try { fd=fs.openSync(final,'wx'); } catch(error) { if(error.code==='EEXIST')continue;throw error; }
      try { fs.writeFileSync(fd,bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      const actual=fs.readFileSync(final);
      if (!actual.equals(bytes)) fail('report_file_readback_failed', '文件读回不一致，未登记为保存成功。');
      file={path:final,version,sha256:fileHash(actual),size:actual.length}; break;
    }
    if (!file) fail('report_version_conflict');
  }
  const reportId='rp-'+exportId;
  const receipt={id:exportId,requestHash,reportId,sourceJobId:p.job.id,sourceHash:p.job.sourceHash,currentSourceHash:p.current,
    sourceState:p.sourceState,status:historical?'historical-draft':'user-saved',file,savedAt:effectiveSavedAt};
  const report={id:reportId,kind:'monthly',title:p.job.seed.title,period:p.job.seed.period,body:body.body,
    sourceJobId:p.job.id,sourceHash:p.job.sourceHash,sourceAttemptId:p.attempt.id,agentId:p.job.agentId,
    sourceState:p.sourceState,status:receipt.status,obsidianExportId:exportId,obsidianFile:file,createdAt:effectiveSavedAt,updatedAt:effectiveSavedAt};
  (store.reports ||= []).unshift(report); (store.reportExports ||= []).unshift(receipt);
  return receipt;
}
module.exports={FOLDER,directory,preview,save,checkedFile};
