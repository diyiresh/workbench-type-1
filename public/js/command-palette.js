import { getStore, esc } from './core.js';
import { t as tr } from './i18n.js';

// Pages and actions are registered by the shell; records are read from the current store snapshot.
let pages = [], actions = [];
export function configurePalette(config = {}) {
  pages = config.pages || pages;
  actions = config.actions || actions;
}

const LIMIT = 40;
let entries = [], cursor = 0;

function act(name) {
  const button = document.createElement('button');
  button.type = 'button'; button.hidden = true; button.dataset.act = name;
  document.body.append(button); button.click(); button.remove();
}

function recordEntries() {
  const s = getStore() || {};
  const live = (row) => row && !row.archived;
  const rows = [];
  for (const m of (s.modules || []).filter(live)) rows.push({ kind: tr('模块'), label: m.title || m.id, hint: m.type || '', href: '#home/' + encodeURIComponent(m.id) });
  for (const r of (s.departmentRuns || []).filter(live)) rows.push({ kind: tr('协作'), label: r.title || r.goal || r.id, hint: r.status || '', href: '#projects/run:' + encodeURIComponent(r.id) });
  for (const a of (s.agents || []).filter(live)) rows.push({ kind: tr('成员'), label: a.name || a.id, hint: a.role || '', href: '#agents/' + encodeURIComponent(a.id) });
  const agendas = (s.agendas || []).filter(live).sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 120);
  for (const a of agendas) rows.push({ kind: tr('行程'), label: a.title || a.id, hint: [a.date, a.time].filter(Boolean).join(' '), href: '#agenda/all' });
  const reports = (s.reports || []).filter(live).slice(0, 80);
  for (const r of reports) rows.push({ kind: tr('报告'), label: r.title || r.kind || r.id, hint: r.kind || '', href: '#reports/' + encodeURIComponent(r.kind || 'business') });
  return rows;
}

function allEntries() {
  return [
    ...actions.map(a => ({ kind: tr('操作'), label: tr(a.label), hint: a.hint ? tr(a.hint) : '', run: a.run, href: a.href, act: a.act })),
    ...(typeof pages === 'function' ? pages() : pages).map(p => ({ kind: tr('页面'), label: tr(p.label), hint: p.group ? tr(p.group) : '', href: p.href })),
    ...recordEntries(),
  ];
}

function filter(query) {
  const q = query.trim().toLocaleLowerCase();
  const list = allEntries();
  if (!q) return list.filter(e => e.kind !== tr('行程') && e.kind !== tr('报告')).slice(0, LIMIT);
  const terms = q.split(/\s+/);
  return list
    .map(e => ({ e, text: (e.label + ' ' + e.hint + ' ' + e.kind).toLocaleLowerCase() }))
    .filter(({ text }) => terms.every(term => text.includes(term)))
    .sort((a, b) => Number(!a.e.label.toLocaleLowerCase().startsWith(terms[0])) - Number(!b.e.label.toLocaleLowerCase().startsWith(terms[0])))
    .slice(0, LIMIT)
    .map(({ e }) => e);
}

function paint(dialog) {
  const list = dialog.querySelector('[role=listbox]');
  list.innerHTML = entries.length ? entries.map((e, i) => `<li role="option" id="v8-palette-${i}" data-index="${i}" aria-selected="${i === cursor}"><span class="v8-palette-kind">${esc(e.kind)}</span><b>${esc(e.label)}</b>${e.hint ? `<small>${esc(e.hint)}</small>` : ''}</li>`).join('') : `<li class="v8-palette-empty">${esc(tr('没有匹配的页面、记录或操作。'))}</li>`;
  const input = dialog.querySelector('input');
  if (entries.length) input.setAttribute('aria-activedescendant', 'v8-palette-' + cursor); else input.removeAttribute('aria-activedescendant');
  list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
}

function choose(dialog, index) {
  const entry = entries[index];
  if (!entry) return;
  dialog.close();
  if (entry.run) entry.run();
  else if (entry.act) act(entry.act);
  else if (entry.href) {
    if (location.hash === entry.href) window.dispatchEvent(new Event('hashchange'));
    else location.hash = entry.href;
  }
}

export function openPalette() {
  if (document.getElementById('v8-palette')) return;
  const dialog = document.createElement('dialog');
  dialog.id = 'v8-palette';
  dialog.setAttribute('aria-label', tr('搜索与命令'));
  dialog.innerHTML = `<input type="search" role="combobox" aria-expanded="true" aria-controls="v8-palette-list" aria-autocomplete="list" placeholder="${esc(tr('搜索页面、项目、成员、行程或操作…'))}" /><ul id="v8-palette-list" role="listbox"></ul><p class="v8-palette-help">${esc(tr('↑↓ 选择 · Enter 打开 · Esc 关闭'))}</p>`;
  document.body.append(dialog);
  const input = dialog.querySelector('input');
  const refresh = () => { entries = filter(input.value); cursor = 0; paint(dialog); };
  input.addEventListener('input', refresh);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!entries.length) return;
      cursor = (cursor + (event.key === 'ArrowDown' ? 1 : -1) + entries.length) % entries.length;
      paint(dialog);
    }
    if (event.key === 'Enter') { event.preventDefault(); choose(dialog, cursor); }
    if (event.key === 'Escape') { event.preventDefault(); dialog.close(); }
  });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) return dialog.close();
    const option = event.target.closest('[data-index]');
    if (option) choose(dialog, Number(option.dataset.index));
  });
  dialog.addEventListener('close', () => dialog.remove());
  refresh();
  dialog.showModal();
  input.focus();
}
