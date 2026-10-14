'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const notes = require('./agenda-notes');
function fail(message, status = 409) { const error = new Error(message); error.status = status; throw error; }
function plainDirectory(target, create = false) {
  if (!fs.existsSync(target)) { if (create) fs.mkdirSync(target); else return false; }
  const stat = fs.lstatSync(target);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail('移除版本目录必须为普通目录，不能使用链接。');
  return true;
}
function trashDirectory(store, create = false) {
  const directory = notes.ensureDirectory(store, create), trash = path.join(directory, '.trash');
  if (fs.existsSync(directory)) plainDirectory(trash, create);
  return trash;
}
const receipt = note => ({ file: note.file, sha256: note.sha256, version: note.version });
function plan(store, agendaId) {
  const item = notes.agenda(store, agendaId), result = notes.list(store);
  if (result.ignored.length) fail('存在格式异常笔记，请先核对文件后再移除旧版本。');
  const versions = result.notes.filter(note => note.agendaId === agendaId).sort((a, b) => b.version - a.version);
  const latest = versions[0] || null;
  // Ambiguous highest versions are not safe cleanup targets.
  if (latest && versions.some(note => note !== latest && note.version === latest.version)) fail('笔记版本号重复，请先核对文件。');
  const snapshot = notes.hash(JSON.stringify([notes.config(store), notes.signature(item), versions.map(receipt)]));
  return { agendaId, title: item.title, snapshot, latest: latest ? receipt(latest) : null, older: versions.slice(1).map(receipt), existing: versions.map(receipt) };
}
function validatePlan(store, agendaId, input) {
  const result = plan(store, agendaId);
  if (!input.snapshot || result.snapshot !== input.snapshot) fail('笔记或目录已变化，请重新查看移除清单。');
  return result;
}
function moveOlder(store, agendaId, input) {
  const preview = validatePlan(store, agendaId, input);
  if (!preview.older.length) return { removedCount: 0, batch: null };
  const directory = notes.ensureDirectory(store), trash = trashDirectory(store, true);
  const id = 'cleanup-' + crypto.randomUUID(), batchPath = path.join(trash, id);
  plainDirectory(batchPath, true);
  const manifest = { id, agendaId, title: preview.title, removedAt: new Date().toISOString(), kept: preview.latest, files: preview.older };
  fs.writeFileSync(path.join(batchPath, 'receipt.json'), JSON.stringify(manifest, null, 2), { encoding: 'utf8', flag: 'wx' });
  const moved = [];
  try {
    for (const candidate of preview.older) {
      const actual = notes.readFile(directory, candidate.file);
      if (actual.agendaId !== agendaId || actual.version >= preview.latest.version || actual.sha256 !== candidate.sha256) fail('旧版本已变化，未完成移除。');
      // Recheck the latest file before every move; never move it or replace a target.
      const latest = notes.readFile(directory, preview.latest.file);
      if (latest.sha256 !== preview.latest.sha256) fail('最新笔记已变化，未完成移除。');
      const destination = path.join(batchPath, candidate.file);
      if (fs.existsSync(destination)) fail('移除目标已存在。');
      fs.renameSync(actual.path, destination); moved.push(candidate.file);
      if (notes.readFile(batchPath, candidate.file).sha256 !== candidate.sha256) fail('移除后的文件校验不一致。');
    }
  } catch (error) {
    const rollbackErrors = [];
    for (const file of moved.reverse()) {
      try { if (fs.existsSync(path.join(directory, file))) fail('原路径已存在，未覆盖。'); fs.renameSync(path.join(batchPath, file), path.join(directory, file)); }
      catch (rollback) { rollbackErrors.push(file + ': ' + rollback.message); }
    }
    if (rollbackErrors.length) fail(error.message + '；部分文件留在可恢复目录：' + rollbackErrors.join('；'));
    throw error;
  }
  return { removedCount: moved.length, batch: id };
}
function readBatch(store, id) {
  if (!/^cleanup-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) fail('非法移除批次。', 400);
  const trash = trashDirectory(store), batchPath = path.join(trash, id);
  plainDirectory(trash); if (!plainDirectory(batchPath)) fail('移除批次不存在。', 404);
  const file = path.join(batchPath, 'receipt.json'), stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1 || stat.size > 256000) fail('移除凭据格式异常。');
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (manifest.id !== id || !manifest.agendaId || !Array.isArray(manifest.files) || !Number.isInteger(manifest.kept?.version)) fail('移除凭据格式异常。');
  const files = [];
  for (const candidate of manifest.files) {
    if (typeof candidate.file !== 'string' || path.basename(candidate.file) !== candidate.file || !candidate.file.endsWith('.md')) fail('非法恢复文件路径。', 400);
    if (!fs.existsSync(path.join(batchPath, candidate.file))) continue;
    const actual = notes.readFile(batchPath, candidate.file);
    if (actual.agendaId !== manifest.agendaId || actual.version !== candidate.version || actual.version >= manifest.kept.version || actual.sha256 !== candidate.sha256) fail('移除文件已变化，请核对恢复凭据。');
    files.push(receipt(actual));
  }
  return { id, agendaId: manifest.agendaId, title: manifest.title, removedAt: manifest.removedAt, keptVersion: manifest.kept.version, files, snapshot: notes.hash(JSON.stringify([notes.config(store), manifest, files])) };
}
function listTrash(store) {
  const trash = trashDirectory(store), batches = [], ignored = [];
  if (!fs.existsSync(trash)) return { batches, ignored };
  const ids = fs.readdirSync(trash); if (ids.length > 1000) fail('移除批次超过 1000，请先整理。');
  for (const id of ids) {
    try { const batch = readBatch(store, id); if (batch.files.length) batches.push(batch); }
    catch (error) { ignored.push({ id, error: error.message }); }
  }
  batches.sort((a, b) => b.removedAt.localeCompare(a.removedAt));
  return { batches, ignored };
}
function restore(store, id, input) {
  const batch = readBatch(store, id); notes.agenda(store, batch.agendaId);
  if (!input.snapshot || input.snapshot !== batch.snapshot) fail('移除批次已变化，请刷新后恢复。');
  const directory = notes.ensureDirectory(store), latest = plan(store, batch.agendaId).latest;
  if (!latest || latest.version < batch.keptVersion) fail('保留的最新版本缺失，请先核对笔记；未恢复旧版本。');
  for (const file of batch.files) if (fs.existsSync(path.join(directory, file.file))) fail('同名笔记已存在，未覆盖；请核对后再恢复。');
  const batchPath = path.join(trashDirectory(store), id), restored = [];
  try {
    for (const file of batch.files) {
      if (notes.readFile(directory, latest.file).sha256 !== latest.sha256) fail('最新笔记已变化，未完成恢复。');
      fs.renameSync(path.join(batchPath, file.file), path.join(directory, file.file)); restored.push(file.file);
      if (notes.readFile(directory, file.file).sha256 !== file.sha256) fail('恢复后的文件校验不一致。');
    }
  } catch (error) {
    for (const file of restored.reverse()) {
      try { if (fs.existsSync(path.join(batchPath, file))) fail('恢复目标已存在。'); fs.renameSync(path.join(directory, file), path.join(batchPath, file)); }
      catch (rollback) { fail(error.message + '；恢复中断，请核对：' + rollback.message); }
    }
    throw error;
  }
  return { restoredCount: restored.length };
}
module.exports = { plan, validatePlan, moveOlder, listTrash, restore };
