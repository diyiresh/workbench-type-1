import { api, esc } from './core.js';
import { t as tr, ui } from './i18n.js';
import MarkdownIt from '../vendor/markdown.js';

const markdown = new MarkdownIt({ html: false, linkify: false });
markdown.renderer.rules.image = (tokens, index) => esc(tokens[index].content || 'image');

let index = null;
let selected = sessionStorage.getItem('bench-disk-skill') || '';
let detail = null;
let draft = '';
let note = '';
let loading = false;
let ticket = 0;
let loadingIndex = null;

function errors() {
  return {
    disk_skill_changed: tr('磁盘上的技能已变化，请重新打开后再保存。'),
    disk_skill_readonly: tr('只读技能不能修改或推送。'),
    disk_skill_missing: tr('找不到这项技能，请重新扫描。'),
    disk_skill_path_invalid: tr('技能路径不在允许的目录里。'),
    disk_skill_no_remote: tr('这个 git 仓库还没有 origin，不能从这里推送。'),
    disk_skill_repo_invalid: tr('所有者和仓库名只能使用字母、数字、点、下划线和连字符。'),
    disk_skill_detached: tr('当前分支不能推送。'),
    disk_skill_invalid_text: tr('技能正文不能为空，也不能超过长度限制。'),
    disk_skill_git_failed: tr('Git 未能完成。'),
    disk_skill_local_only: tr('只能在本机修改技能。'),
  };
}
function errorText(error) {
  try {
    const body = JSON.parse(error.message);
    return errors()[body.error] || body.detail || body.error;
  } catch { return error.message; }
}
function reasonText(reason) {
  return ({
    'cursor-builtin': tr('Cursor 内置技能，只读。'),
    'codex-system': tr('Codex 系统技能，只读。'),
    'third-party': tr('第三方副本，只读。'),
    'plugin-cache': tr('插件缓存副本，只读。'),
    'installed-package': tr('已安装包内的技能，只读。'),
  })[reason] || tr('只读技能不能修改或推送。');
}
function rootText(root) {
  return ({ 'user-store': tr('用户技能库'), plugins: tr('插件') })[root] || root;
}
function preview(text) {
  return markdown.render(String(text || '').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, ''));
}
function applyCount() {
  if (!index?.skills?.length) return;
  const count = String(index.skills.length);
  const stat = document.querySelector('[data-asset-count="skills"] b');
  if (stat) stat.textContent = count;
  const label = document.querySelector('[data-asset-count="skills"] small');
  if (label) label.textContent = tr('本机技能文件');
  const chip = document.querySelector('[data-asset-count="skills-chip"] small');
  if (chip) chip.textContent = count;
  const nav = document.querySelector('#channels [data-sec="skills"] small');
  if (nav) nav.textContent = count;
}
function cards() {
  if (!index) return '';
  if (!index.skills.length) return ui`<p class="asset-empty">没有找到 SKILL.md。点重新扫描后再看。</p>`;
  return index.skills.map(skill => `<button type="button" class="asset-card${skill.id === selected ? ' active' : ''}" data-disk-skill="${esc(skill.id)}" data-asset-text="${esc(`${skill.name} ${skill.description} ${skill.path}`)}"><div class="row"><b>${esc(skill.name)}</b><span class="asset-tag">${esc(skill.writable ? rootText(skill.root) : tr('只读'))}</span></div><p>${esc(skill.description || skill.path)}</p><span class="chip">${esc(rootText(skill.root))}</span></button>`).join('');
}
function canNameRepo() {
  const git = detail?.git || {};
  return detail && detail.writable && !detail.tooLarge && !git.blocked && (!git.inRepo || (git.ownRepo && !git.remote));
}
function panelHtml() {
  if (loading) return ui`<p>正在读取这项技能…</p>`;
  if (!detail) return ui`<p>选择一项技能，在这里阅读、修改，并推送到 GitHub。</p>${note ? `<p role="alert">${esc(note)}</p>` : ''}`;
  const git = detail.git || {};
  const readOnly = !detail.writable || detail.tooLarge;
  return `<div class="row"><h2>${esc(detail.name)}</h2><span class="asset-tag">${esc(detail.writable ? rootText(detail.root) : tr('只读'))}</span></div>
    <p>${esc(detail.description)}</p>
    ${detail.writable ? '' : `<p>${esc(reasonText(detail.readOnlyReason))}</p>`}
    <p class="k">${esc(tr('路径'))} · ${esc(detail.path)}</p>
    <div class="disk-skill-files">${(detail.files || []).map(name => `<span>${esc(name)}</span>`).join('')}</div>
    <h3>${esc(tr('阅读'))}</h3><div class="skill-markdown" data-disk-preview>${preview(draft || detail.markdown)}</div>
    <form data-disk-editor><label>${esc(tr('技能正文'))}<textarea name="markdown" spellcheck="false" ${readOnly ? 'readonly' : ''}>${esc(draft)}</textarea></label>
    <div class="actions"><button type="button" class="ghost" data-disk-action="preview">${esc(tr('预览'))}</button><button type="submit" class="solid" ${readOnly ? 'disabled' : ''}>${esc(tr('保存到原文件'))}</button></div></form>
    <h3>${esc(tr('GitHub'))}</h3>
    <p>${git.blocked ? esc(tr('Git 未能完成。')) + ' ' + esc(git.blocked) : git.inRepo ? esc(tr('分支')) + ' · ' + esc(git.branch || '') : esc(tr('此技能不在 git 仓库里。填写 GitHub 所有者和仓库名后，会新建私有仓库并只推送这个文件夹。'))}</p>
    ${git.remote ? `<p>${esc(tr('远程'))} · ${esc(git.remote)}</p>` : ''}
    ${git.dirty?.length ? `<p>${esc(tr('未提交的文件'))}</p><ul>${git.dirty.map(line => `<li>${esc(line)}</li>`).join('')}</ul>` : `<p>${esc(tr('没有未提交的改动。'))}</p>`}
    ${canNameRepo() ? ui`<label>所有者<input name="owner" autocomplete="off" /></label><label>仓库名<input name="repo" autocomplete="off" /></label>` : ''}
    ${detail.writable && git.inRepo && !git.remote && !git.ownRepo ? ui`<p>这个 git 仓库还没有 origin，不能从这里推送。</p>` : ''}
    <label>${esc(tr('提交说明'))}<input name="message" value="${esc('Update skill ' + detail.name)}" /></label>
    <button type="button" class="solid" data-disk-action="push" ${readOnly ? 'disabled' : ''}>${esc(tr('推送到 GitHub'))}</button>
    <p data-disk-note role="status">${esc(note)}</p>`;
}
function paint() {
  applyCount();
  const query = document.getElementById('asset-search')?.value.trim().toLowerCase() || '';
  const list = document.getElementById('disk-skill-list');
  if (list) {
    list.innerHTML = cards();
    if (query) list.querySelectorAll('[data-asset-text]').forEach(node => { node.hidden = !node.dataset.assetText.toLowerCase().includes(query); });
    if (!list.dataset.bound) {
      list.dataset.bound = '1';
      list.addEventListener('click', event => {
        const card = event.target.closest('[data-disk-skill]');
        if (card) void openSkill(card.dataset.diskSkill);
      });
    }
  }
  const panel = document.getElementById('disk-skill-panel');
  if (!panel) return;
  panel.innerHTML = panelHtml();
  if (!panel.dataset.bound) {
    panel.dataset.bound = '1';
    panel.addEventListener('input', event => { if (event.target.name === 'markdown') draft = event.target.value; });
    panel.addEventListener('click', event => {
      if (event.target.closest('[data-disk-action="preview"]')) {
        const box = panel.querySelector('[data-disk-preview]');
        if (box) box.innerHTML = preview(draft);
      }
      if (event.target.closest('[data-disk-action="push"]')) void pushSkill();
    });
    panel.addEventListener('submit', event => {
      if (!event.target.matches('[data-disk-editor]')) return;
      event.preventDefault();
      void saveSkill();
    });
  }
}
async function ensureIndex() {
  if (!loadingIndex) loadingIndex = api('/api/disk-skills').then(data => { index = data; }).finally(() => { loadingIndex = null; });
  await loadingIndex;
  if (document.getElementById('disk-skill-list') || document.querySelector('[data-asset-count="skills"]')) paint();
}
export function mountDiskSkills() {
  if (!document.getElementById('disk-skill-list') && !document.querySelector('[data-asset-count="skills"]')) return;
  if (!index) {
    const list = document.getElementById('disk-skill-list');
    if (list) list.textContent = tr('正在读取本机技能…');
    void ensureIndex().catch(error => {
      const list = document.getElementById('disk-skill-list');
      if (list) list.textContent = errorText(error);
    });
    return;
  }
  paint();
}
export async function rescanDiskSkills() {
  const list = document.getElementById('disk-skill-list');
  if (list) list.textContent = tr('正在重新扫描本机技能…');
  index = await api('/api/disk-skills/rescan', { method: 'POST', body: {} });
  detail = null;
  draft = '';
  note = '';
}
async function openSkill(id) {
  const mine = ++ticket;
  selected = id;
  sessionStorage.setItem('bench-disk-skill', id);
  detail = null;
  draft = '';
  note = '';
  loading = true;
  paint();
  try {
    const next = await api('/api/disk-skills/' + encodeURIComponent(id));
    if (mine !== ticket) return;
    detail = next;
    draft = next.markdown || '';
    loading = false;
    paint();
  } catch (error) {
    if (mine !== ticket) return;
    loading = false;
    note = errorText(error);
    paint();
  }
}
async function saveSkill() {
  if (!detail?.writable) return;
  const button = document.querySelector('[data-disk-editor] button[type="submit"]');
  if (button) button.disabled = true;
  try {
    const saved = await api('/api/disk-skills/' + encodeURIComponent(detail.id) + '/save', { method: 'POST', body: { markdown: draft, expectedHash: detail.hash } });
    detail.hash = saved.hash;
    detail.name = saved.name;
    detail.description = saved.description;
    detail.markdown = draft;
    const listed = index?.skills?.find(skill => skill.id === detail.id);
    if (listed) { listed.name = saved.name; listed.description = saved.description; }
    note = tr('文件已保存。');
    paint();
  } catch (error) { note = errorText(error); paint(); }
}
async function pushSkill() {
  if (!detail?.writable || detail.tooLarge) return;
  const panel = document.getElementById('disk-skill-panel');
  const owner = panel?.querySelector('[name="owner"]')?.value.trim() || '';
  const repo = panel?.querySelector('[name="repo"]')?.value.trim() || '';
  const message = panel?.querySelector('[name="message"]')?.value.trim() || '';
  if (canNameRepo() && (!owner || !repo)) { note = tr('请先填写 GitHub 所有者和仓库名。'); paint(); return; }
  const target = detail.git?.remote || (owner && repo ? owner + '/' + repo : '');
  if (!window.confirm(tr('将只提交这个技能文件夹并推送当前分支。') + '\n' + target)) return;
  try {
    const result = await api('/api/disk-skills/' + encodeURIComponent(detail.id) + '/push', { method: 'POST', body: { message, owner, repo } });
    note = tr('已推送到 GitHub。') + ' ' + result.remote;
    detail = await api('/api/disk-skills/' + encodeURIComponent(detail.id));
    draft = detail.markdown || draft;
    paint();
  } catch (error) { note = errorText(error); paint(); }
}
