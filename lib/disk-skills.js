'use strict';
// Read SKILL.md files from allowed roots. Writes stay inside those roots.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { createHash } = require('node:crypto');

const SKIP = new Set(['node_modules', 'site-packages', '.git', '__pycache__', 'dist', 'build', '.venv', 'venv', '.next', 'coverage', '.cache', 'bower_components', 'cache', 'cacheddata', 'gpucache', 'code cache', 'dawngraphitecache', 'dawnwebgpucache', 'blob_storage', 'logs', 'crashpad', '$recycle.bin', 'system volume information', 'windows', 'winsxs', 'program files', 'program files (x86)']);
const CURSOR_SKIP = new Set(['projects', 'ai-tracking', 'browser-logs', 'chats', 'extensions', 'agent-transcripts', 'terminals', 'process-monitor', 'snapshots', 'worktrees']);
const MAX_BYTES = 400000;
const MAX_SKILLS = 5000;

function fail(code, detail) {
  const error = new Error(code);
  if (detail) error.detail = String(detail).slice(0, 500);
  throw error;
}
function hash(text) { return createHash('sha256').update(text, 'utf8').digest('hex'); }
function skillId(file) { return hash(path.resolve(file).toLowerCase()).slice(0, 32); }
function unquote(value) {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    try { return JSON.parse(value); } catch { return value.slice(1, -1); }
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
  return value;
}
function field(block, key) {
  const match = block.match(new RegExp('^' + key + ':\\s*(.*)$', 'm'));
  if (!match) return '';
  const first = match[1].trim();
  if (first === '>' || first === '|' || first === '>-' || first === '|-') {
    const lines = [];
    for (const line of block.slice(match.index + match[0].length).split(/\r?\n/)) {
      if (!line.trim()) { if (lines.length) break; continue; }
      if (/^\s/.test(line)) lines.push(line.trim());
      else break;
    }
    return lines.join(' ').replace(/\s+/g, ' ').slice(0, 240);
  }
  return unquote(first).replace(/\s+/g, ' ').slice(0, 240);
}
function summarize(text, file) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const block = match ? match[1] : '';
  return { name: field(block, 'name') || path.basename(path.dirname(file)), description: field(block, 'description') };
}
function readOnlyReason(file) {
  const normal = path.resolve(file).replaceAll('/', '\\').toLowerCase();
  if (normal.includes('\\.cursor\\skills-cursor\\')) return 'cursor-builtin';
  if (normal.includes('\\.codex\\skills\\.system\\')) return 'codex-system';
  if (normal.includes('\\third_party\\')) return 'third-party';
  if (normal.includes('\\plugins\\cache\\')) return 'plugin-cache';
  if (normal.includes('\\site-packages\\')) return 'installed-package';
  return '';
}
function inside(root, file) {
  const rel = path.relative(path.resolve(root), path.resolve(file));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}
function configuredRoots() {
  if (process.env.BENCH_DISK_SKILL_ROOTS) return process.env.BENCH_DISK_SKILL_ROOTS.split(';').map(item => item.trim()).filter(Boolean);
  if (process.env.BENCH_DATA_DIR) return [];
  const home = os.homedir();
  return [
    'D:\\tools',
    'D:\\OneDrive\\Desktop\\Ben_My_Agent',
    path.join(home, '.cursor'),
    path.join(home, '.claude'),
    path.join(home, '.agents'),
    path.join(home, '.codex'),
    path.join(home, 'AppData', 'Local', 'Cursor', 'plugins'),
    path.join(home, 'AppData', 'Local', 'Cursor', 'AgentStores'),
  ].filter(root => fs.existsSync(root));
}
function labelFor(root) {
  const base = path.basename(root);
  if (base.toLowerCase() === 'agentstores') return 'user-store';
  if (base.toLowerCase() === 'plugins') return 'plugins';
  return base;
}

function createCatalog({ dataDir, roots = configuredRoots(), run, commitEnv } = {}) {
  if (!dataDir) fail('disk_skill_data_dir');
  const resolvedRoots = roots.map(root => path.resolve(root));
  const cacheFile = path.join(dataDir, 'disk-skills-index.json');
  let memory = null;
  let scanning = null;
  const execute = run || ((command, args, cwd) => new Promise((resolve, reject) => {
    execFile(command, args, {
      cwd,
      windowsHide: true,
      timeout: 120000,
      maxBuffer: 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GH_PROMPT_DISABLED: '1', ...commitEnv },
    }, (error, stdout, stderr) => {
      if (error) {
        const wrapped = new Error('disk_skill_git_failed');
        wrapped.detail = String(stderr || stdout || error.message).slice(0, 500);
        reject(wrapped);
      } else resolve(String(stdout || ''));
    });
  }));

  async function walk(dir, found) {
    if (found.length >= MAX_SKILLS) return;
    let entries = [];
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (found.length >= MAX_SKILLS) return;
      if (entry.isSymbolicLink()) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const name = entry.name.toLowerCase();
        if (SKIP.has(name)) continue;
        if (path.basename(dir) === '.cursor' && CURSOR_SKIP.has(name)) continue;
        await walk(full, found);
      } else if (entry.isFile() && entry.name === 'SKILL.md') found.push(full);
    }
  }
  async function scan() {
    const found = [];
    for (const root of resolvedRoots) {
      if (fs.existsSync(root)) await walk(root, found);
    }
    const skills = [];
    for (const file of found) {
      let stat;
      try { stat = await fs.promises.stat(file); } catch { continue; }
      if (!stat.isFile() || stat.size > MAX_BYTES * 4) continue;
      const head = await fs.promises.readFile(file, 'utf8').then(text => text.slice(0, 8000)).catch(() => '');
      const summary = summarize(head, file);
      const root = resolvedRoots.find(item => inside(item, file));
      if (!root) continue;
      const reason = readOnlyReason(file);
      skills.push({
        id: skillId(file), name: summary.name, description: summary.description, path: path.resolve(file),
        dir: path.dirname(path.resolve(file)), root, rootLabel: labelFor(root), writable: !reason,
        readOnlyReason: reason, bytes: stat.size, mtime: stat.mtime.toISOString(),
      });
    }
    skills.sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path));
    memory = { scannedAt: new Date().toISOString(), roots: resolvedRoots, skills };
    await fs.promises.mkdir(dataDir, { recursive: true });
    await fs.promises.writeFile(cacheFile, JSON.stringify(memory));
    return memory;
  }
  async function load() {
    if (memory && JSON.stringify(memory.roots) === JSON.stringify(resolvedRoots)) return memory;
    try {
      const parsed = JSON.parse(await fs.promises.readFile(cacheFile, 'utf8'));
      if (parsed && JSON.stringify(parsed.roots) === JSON.stringify(resolvedRoots) && Array.isArray(parsed.skills)) {
        memory = parsed;
        return memory;
      }
    } catch { /* missing or stale cache */ }
    if (!scanning) scanning = scan().finally(() => { scanning = null; });
    return scanning;
  }
  function publish(skill) {
    return { id: skill.id, name: skill.name, description: skill.description, path: skill.path, root: skill.rootLabel, writable: skill.writable, readOnlyReason: skill.readOnlyReason };
  }
  async function list() {
    const data = await load();
    return { scannedAt: data.scannedAt, skills: data.skills.map(publish) };
  }
  async function force() {
    memory = null;
    try { await fs.promises.rm(cacheFile, { force: true }); } catch { /* absent */ }
    const data = await scan();
    return { scannedAt: data.scannedAt, skills: data.skills.map(publish) };
  }
  function locate(data, id) {
    const skill = data.skills.find(item => item.id === id);
    if (!skill) fail('disk_skill_missing');
    if (skillId(skill.path) !== id || path.basename(skill.path) !== 'SKILL.md') fail('disk_skill_path_invalid');
    if (!resolvedRoots.some(root => path.resolve(root) === path.resolve(skill.root) && inside(root, skill.path))) fail('disk_skill_path_invalid');
    let realRoot, realFile;
    try { realRoot = fs.realpathSync(skill.root); realFile = fs.realpathSync(skill.path); }
    catch { fail('disk_skill_missing'); }
    if (!inside(realRoot, realFile)) fail('disk_skill_path_invalid');
    const info = fs.lstatSync(skill.path);
    if (info.isSymbolicLink() || !info.isFile()) fail('disk_skill_path_invalid');
    return { skill, file: realFile };
  }
  async function gitMeta(dir) {
    let top = '';
    try { top = (await execute('git', ['rev-parse', '--show-toplevel'], dir)).trim(); }
    catch (error) {
      const detail = error.detail || error.message || '';
      if (/not a git repository/i.test(detail)) return { inRepo: false, branch: '', remote: '', dirty: [] };
      return { inRepo: false, branch: '', remote: '', dirty: [], blocked: detail };
    }
    const root = path.resolve(top);
    const branch = (await execute('git', ['rev-parse', '--abbrev-ref', 'HEAD'], root)).trim();
    let remote = '';
    try { remote = (await execute('git', ['remote', 'get-url', 'origin'], root)).trim(); } catch { remote = ''; }
    const rel = path.relative(root, path.resolve(dir)).split(path.sep).join('/') || '.';
    const spec = rel === '.' ? 'SKILL.md' : rel;
    let dirty = [];
    try {
      dirty = (await execute('git', ['-c', 'core.quotepath=false', 'status', '--porcelain', '--', spec], root)).split(/\r?\n/).map(line => line.trim()).filter(Boolean).slice(0, 40);
    } catch { dirty = []; }
    return { inRepo: true, root, branch, remote, rel: spec, ownRepo: path.resolve(root) === path.resolve(dir), dirty };
  }
  function folderFiles(dir) {
    try {
      return fs.readdirSync(dir, { withFileTypes: true }).filter(entry => entry.name !== '.git' && !entry.isSymbolicLink()).map(entry => entry.name + (entry.isDirectory() ? '/' : '')).slice(0, 50);
    } catch { return []; }
  }
  async function detail(id) {
    const data = await load();
    const { skill, file } = locate(data, id);
    const stat = fs.statSync(file);
    const git = await gitMeta(skill.dir);
    const base = { ...publish(skill), dir: skill.dir, bytes: stat.size, mtime: stat.mtime.toISOString(), files: folderFiles(skill.dir), git: { inRepo: git.inRepo, ownRepo: !!git.ownRepo, branch: git.branch, remote: git.remote, dirty: git.dirty, blocked: git.blocked || '' } };
    if (stat.size > MAX_BYTES) return { ...base, markdown: '', hash: '', tooLarge: true };
    const markdown = fs.readFileSync(file, 'utf8');
    const summary = summarize(markdown, file);
    return { ...base, name: summary.name, description: summary.description, markdown, hash: hash(markdown), tooLarge: false };
  }
  async function save(id, body) {
    const markdown = body && body.markdown;
    const expected = body && body.expectedHash;
    if (typeof markdown !== 'string' || !markdown.trim() || markdown.length > MAX_BYTES) fail('disk_skill_invalid_text');
    if (typeof expected !== 'string' || !/^[a-f0-9]{64}$/.test(expected)) fail('disk_skill_hash_invalid');
    const data = await load();
    const { skill, file } = locate(data, id);
    if (!skill.writable) fail('disk_skill_readonly');
    const current = fs.readFileSync(file, 'utf8');
    if (hash(current) !== expected) fail('disk_skill_changed');
    fs.writeFileSync(file, markdown, 'utf8');
    const written = fs.readFileSync(file, 'utf8');
    if (written !== markdown) fail('disk_skill_readback_failed');
    const summary = summarize(written, file);
    skill.name = summary.name;
    skill.description = summary.description;
    skill.mtime = new Date().toISOString();
    skill.bytes = Buffer.byteLength(written);
    await fs.promises.writeFile(cacheFile, JSON.stringify(data));
    return { id, hash: hash(written), name: summary.name, description: summary.description };
  }
  function identity(value) {
    const text = String(value || '').trim();
    if (!/^[A-Za-z0-9_.-]{1,100}$/.test(text)) fail('disk_skill_repo_invalid');
    return text;
  }
  async function push(id, body = {}) {
    const data = await load();
    const { skill } = locate(data, id);
    if (!skill.writable) fail('disk_skill_readonly');
    const message = String(body.message || `Update skill ${skill.name}`).replace(/[\r\n]+/g, ' ').trim();
    if (!message || message.length > 200) fail('disk_skill_message_invalid');
    const meta = await gitMeta(skill.dir);
    if (meta.blocked) fail('disk_skill_git_failed', meta.blocked);
    if (meta.inRepo) {
      if (!meta.branch || meta.branch === 'HEAD' || !/^[A-Za-z0-9._/-]+$/.test(meta.branch)) fail('disk_skill_detached');
      await execute('git', ['add', '--', meta.rel], meta.root);
      const staged = (await execute('git', ['-c', 'core.quotepath=false', 'diff', '--cached', '--name-only', '--', meta.rel], meta.root)).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
      const prefix = meta.rel + '/';
      if (staged.some(name => { const item = name.replaceAll('\\', '/'); return item !== meta.rel && !item.startsWith(prefix); })) fail('disk_skill_path_invalid');
      if (staged.length) {
        try { await execute('git', ['commit', '-m', message, '--', meta.rel], meta.root); }
        catch (error) { if (!/nothing to commit|no changes added/i.test(error.detail || '')) throw error; }
      }
      if (!meta.remote) {
        if (!meta.ownRepo) fail('disk_skill_no_remote');
        const owner = identity(body.owner), repo = identity(body.repo);
        await execute('gh', ['repo', 'create', `${owner}/${repo}`, '--private', '--source', skill.dir, '--remote', 'origin', '--push'], skill.dir);
        return { pushed: true, created: true, remote: `${owner}/${repo}`, branch: meta.branch };
      }
      await execute('git', ['push', 'origin', `HEAD:refs/heads/${meta.branch}`], meta.root);
      return { pushed: true, created: false, remote: meta.remote, branch: meta.branch };
    }
    const owner = identity(body.owner), repo = identity(body.repo);
    await execute('git', ['init'], skill.dir);
    await execute('git', ['add', '--', '.'], skill.dir);
    await execute('git', ['commit', '-m', message], skill.dir);
    const remote = `${owner}/${repo}`;
    await execute('gh', ['repo', 'create', remote, '--private', '--source', skill.dir, '--remote', 'origin', '--push'], skill.dir);
    return { pushed: true, created: true, remote, branch: 'main' };
  }
  return { list, rescan: force, detail, save, push };
}

module.exports = { createCatalog, configuredRoots, skillId };
