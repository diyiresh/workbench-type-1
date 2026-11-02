'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createCatalog } = require('../lib/disk-skills');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-disk-skills-'));
const dataDir = path.join(root, 'data');
const source = path.join(root, 'source');
const looseRoot = path.join(root, 'loose');
const outside = path.join(root, 'outside.md');
fs.mkdirSync(dataDir);
const skillDir = path.join(source, 'mine', 'alpha');
fs.mkdirSync(skillDir, { recursive: true });
fs.mkdirSync(path.join(source, '.cursor', 'skills-cursor', 'locked'), { recursive: true });
fs.mkdirSync(path.join(source, 'third_party', 'copied'), { recursive: true });
fs.mkdirSync(path.join(source, 'node_modules', 'secret'), { recursive: true });
fs.mkdirSync(path.join(looseRoot, 'beta'), { recursive: true });
const body = '---\nname: alpha-skill\ndescription: "Keep the ledger local"\n---\n\n## Steps\n1. Read the file.\n';
fs.writeFileSync(path.join(skillDir, 'SKILL.md'), body);
fs.writeFileSync(path.join(skillDir, 'notes.txt'), 'local note');
fs.writeFileSync(path.join(source, '.cursor', 'skills-cursor', 'locked', 'SKILL.md'), '---\nname: locked-skill\ndescription: built in\n---\n\nLocked.\n');
fs.writeFileSync(path.join(source, 'third_party', 'copied', 'SKILL.md'), '---\nname: copied-skill\ndescription: vendor\n---\n\nCopy.\n');
fs.writeFileSync(path.join(source, 'node_modules', 'secret', 'SKILL.md'), '---\nname: hidden-skill\ndescription: hidden\n---\n\nHidden.\n');
fs.writeFileSync(path.join(looseRoot, 'beta', 'SKILL.md'), '---\nname: loose-skill\ndescription: no repo\n---\n\nLoose.\n');
fs.writeFileSync(outside, 'do not touch');
fs.writeFileSync(path.join(source, 'other.txt'), 'untouched');

const env = { ...process.env, GIT_AUTHOR_NAME: 'Workbench Test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'Workbench Test', GIT_COMMITTER_EMAIL: 'test@example.com' };
const git = (args, cwd) => execFileSync('git', args, { cwd, env, stdio: 'pipe' });
git(['init'], source);
git(['add', '--', 'mine', 'other.txt'], source);
git(['commit', '-m', 'initial'], source);
const bare = path.join(root, 'bare.git');
git(['init', '--bare', bare], root);
git(['remote', 'add', 'origin', bare], source);
git(['branch', '-M', 'main'], source);
git(['push', 'origin', 'HEAD:refs/heads/main'], source);

const catalog = createCatalog({ dataDir, roots: [source, looseRoot], commitEnv: env });
(async () => {
  const listed = await catalog.list();
  const names = listed.skills.map(skill => skill.name).sort();
  assert.deepEqual(names, ['alpha-skill', 'copied-skill', 'locked-skill', 'loose-skill']);
  const alpha = listed.skills.find(skill => skill.name === 'alpha-skill');
  const locked = listed.skills.find(skill => skill.name === 'locked-skill');
  const copied = listed.skills.find(skill => skill.name === 'copied-skill');
  assert.equal(alpha.writable, true);
  assert.equal(locked.writable, false);
  assert.equal(copied.writable, false);
  assert.equal(listed.skills.some(skill => skill.name === 'hidden-skill'), false);

  const detail = await catalog.detail(alpha.id);
  assert.equal(detail.markdown, body);
  assert.equal(detail.git.inRepo, true);
  assert.equal(detail.git.branch, 'main');
  assert.ok(detail.files.includes('notes.txt'));
  const changed = body.replace('Read the file.', 'Read the file twice.');
  await assert.rejects(catalog.save(alpha.id, { markdown: changed, expectedHash: 'a'.repeat(64) }), /disk_skill_changed/);
  assert.equal(fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8'), body);
  const saved = await catalog.save(alpha.id, { markdown: changed, expectedHash: detail.hash });
  assert.equal(fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8'), changed);
  assert.equal(saved.name, 'alpha-skill');
  await assert.rejects(catalog.save(locked.id, { markdown: changed, expectedHash: detail.hash }), /disk_skill_readonly/);

  const cache = JSON.parse(fs.readFileSync(path.join(dataDir, 'disk-skills-index.json'), 'utf8'));
  const tampered = createCatalog({ dataDir: path.join(root, 'tamper'), roots: [source] });
  fs.mkdirSync(path.join(root, 'tamper'), { recursive: true });
  cache.skills[0].path = outside;
  cache.skills[0].id = require('../lib/disk-skills').skillId(outside);
  cache.roots = [path.resolve(source)];
  fs.writeFileSync(path.join(root, 'tamper', 'disk-skills-index.json'), JSON.stringify(cache));
  await assert.rejects(tampered.save(cache.skills[0].id, { markdown: 'hacked\n', expectedHash: require('node:crypto').createHash('sha256').update('do not touch', 'utf8').digest('hex') }), /disk_skill_path_invalid|disk_skill_missing/);
  assert.equal(fs.readFileSync(outside, 'utf8'), 'do not touch');

  fs.writeFileSync(path.join(source, 'other.txt'), 'dirty neighbor');
  git(['add', '--', 'other.txt'], source);
  const pushed = await catalog.push(alpha.id, { message: 'Update skill alpha-skill' });
  assert.equal(pushed.pushed, true);
  const committed = execFileSync('git', ['--git-dir', bare, 'log', 'main', '-1', '--name-only', '--pretty=format:%s'], { encoding: 'utf8' });
  assert.match(committed, /Update skill alpha-skill/);
  assert.match(committed, /SKILL.md/);
  assert.doesNotMatch(committed, /other.txt/);
  assert.match(git(['status', '--porcelain'], source).toString(), /other.txt/);

  const calls = [];
  const loose = createCatalog({
    dataDir: path.join(root, 'loose-data'),
    roots: [looseRoot],
    run: async (command, args, cwd) => {
      calls.push({ command, args, cwd });
      if (command === 'git' && args[0] === 'rev-parse') {
        const error = new Error('disk_skill_git_failed');
        error.detail = 'fatal: not a git repository';
        throw error;
      }
      if (command === 'gh') return 'created';
      return '';
    },
  });
  const looseList = await loose.list();
  const beta = looseList.skills.find(skill => skill.name === 'loose-skill');
  await assert.rejects(loose.push(beta.id, {}), /disk_skill_repo_invalid/);
  calls.length = 0;
  const created = await loose.push(beta.id, { owner: 'ben', repo: 'alpha-skill', message: 'Add loose skill' });
  assert.equal(created.created, true);
  assert.equal(created.remote, 'ben/alpha-skill');
  const init = calls.find(call => call.command === 'git' && call.args[0] === 'init');
  assert.equal(path.resolve(init.cwd), path.resolve(path.join(looseRoot, 'beta')));
  const gh = calls.find(call => call.command === 'gh');
  assert.deepEqual(gh.args, ['repo', 'create', 'ben/alpha-skill', '--private', '--source', path.join(looseRoot, 'beta'), '--remote', 'origin', '--push']);
  assert.equal(calls.some(call => call.command === 'git' && call.args.includes('--force')), false);
  console.log('Disk skills: scan filter, read-only, hash conflict, path escape, skill-only push, and private repo args passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
