'use strict';
const fs = require('node:fs'), path = require('node:path');
function timestamp(value) {
  const date = new Date(value);
  if (typeof value !== 'string' || !Number.isFinite(date.getTime())) throw new Error('笔记缺少有效的首次保存时间，未改名。');
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone:'Asia/Shanghai', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23' }).formatToParts(date).map(p=>[p.type,p.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}-${parts.minute}-${parts.second}`;
}
function filename(directory, title, version, savedAt, occupied) {
  if (!occupied) {
    const reserved = new Set(fs.existsSync(directory) ? fs.readdirSync(directory).map(n=>n.toLowerCase()) : []);
    const trash = path.join(directory,'.trash');
    if (fs.existsSync(trash)) {
      const stat=fs.lstatSync(trash); if (!stat.isDirectory()||stat.isSymbolicLink()) throw new Error('复盘恢复目录必须为普通目录。');
      for (const batch of fs.readdirSync(trash).filter(n=>/^cleanup-[0-9a-f-]+$/.test(n))) {
        const target=path.join(trash,batch),s=fs.lstatSync(target); if(!s.isDirectory()||s.isSymbolicLink()) continue;
        for (const file of fs.readdirSync(target)) reserved.add(file.toLowerCase());
      }
    }
    occupied = name => reserved.has(name.toLowerCase());
  }
  if (!Number.isSafeInteger(version) || version < 1) throw new Error('笔记版本无效。');
  let clean = String(title || '').normalize('NFC').replace(/[<>:"/\\|?*\x00-\x1f\x7f#\[\]^]/g,'-').replace(/\s+/g,' ').replace(/[. ]+$/g,'').trim();
  if (!clean) clean = '行程复盘';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(clean)) clean = '_' + clean;
  const tail = ` - v${version} - ${timestamp(savedAt)}`;
  for (let i=0;i<10000;i++) {
    const suffix = tail + (i ? ` (${i+1})` : '') + '.md';
    const budget = Math.min(120, 235-directory.length-1-suffix.length);
    if (budget < 8) throw new Error('笔记目录过长，无法安全生成文件名。');
    let head = ''; for (const char of clean) { if (head.length+char.length>budget) break; head+=char; }
    const result = head.replace(/[. ]+$/g,'') + suffix;
    if (!occupied(result)) return result;
  }
  throw new Error('同名笔记过多，未覆盖任何文件。');
}
function resolveFile(store, file) {
  const directory = path.resolve(require('./agenda-notes').ensureDirectory(store));
  for (const migration of [...store.agendaNoteNameMigrations || []].reverse()) {
    if (migration.directory !== directory) continue;
    const alias = migration.files.find(f=>f.from===file && !f.subdir);
    if (alias) file = alias.to;
  }
  return file;
}
module.exports = { timestamp, filename, resolveFile };
