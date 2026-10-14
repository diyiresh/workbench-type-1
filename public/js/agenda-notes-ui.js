import { esc } from './core.js';
import { t as tr, ui } from './i18n.js';
let suggestion = null, requestId = 0;
const model = () => document.getElementById('modal');
const errorText = error => { try { return JSON.parse(error.message).error || error.message; } catch { return error.message; } };
const input = form => {
  const values = new FormData(form);
  return { title: values.get('title'), tags: values.get('tags'), note: values.get('note'), date: document.getElementById('agenda-date')?.value };
};
const key = form => JSON.stringify(input(form));
export function resetSuggestion() { suggestion = null; requestId++; }
function paintSuggestion(form) {
  const output = form.querySelector('#agenda-note-suggestion');
  if (!output) return;
  if (!suggestion || suggestion.key !== key(form)) { output.innerHTML = ''; return; }
  const result = suggestion.result;
  if (suggestion.error) { output.textContent = suggestion.error; return; }
  if (suggestion.loading) { output.textContent = tr('正在读取复盘笔记并生成建议…'); return; }
  output.innerHTML = ui`<div class="note-suggestion"><b>复盘经验建议</b><p>历史记录供本次准备参考，请结合当前人员与事项判断。</p>${result.items.length ? result.items.map(item => `<p>${esc(item.text)} <small>${item.sourceIds.map(esc).join('、')}</small></p>`).join('') : ui`<p>没有找到可用于这项行程的复盘建议。</p>`}${[...result.conflicts, ...result.unknowns].map(text => `<p>${esc(text)}</p>`).join('')}${result.sources.map(source => ui`<details><summary>${esc(source.id)} · ${esc(source.date)} · ${esc(source.title)}</summary><small>${esc(source.path)} · SHA-256 ${esc(source.sha256)}</small><pre>${esc(source.body)}</pre></details>`).join('')}</div>`;
}
export function bindNoteSuggestion(api) {
  const form = document.getElementById('agenda-form'); if (!form) return;
  paintSuggestion(form);
  form.addEventListener('input', () => paintSuggestion(form));
  const button = form.querySelector('[data-note-suggest]');
  button.onclick = async () => {
    const snapshot = key(form), token = ++requestId;
    suggestion = { key: snapshot, loading: true }; paintSuggestion(form); button.disabled = true;
    try {
      const result = await api('/api/agenda-notes/suggest', { method: 'POST', body: input(form) });
      if (token !== requestId) return;
      suggestion = { key: snapshot, result };
    } catch (error) { if (token === requestId) suggestion = { key: snapshot, error: errorText(error) }; }
    finally {
      const current = document.getElementById('agenda-form');
      if (current && token === requestId) { current.querySelector('[data-note-suggest]').disabled = false; paintSuggestion(current); }
    }
  };
}
export function openReviewNote(item, api, reload) {
  const modal = model(); modal.hidden = false;
  modal.innerHTML = ui`<div class="sheet review-note-editor"><h2>行程复盘与笔记</h2><p>${esc(item.date)} · ${esc(item.title)}</p><label>原始复盘<textarea id="review-note-original" rows="6">${esc(item.review || '')}</textarea></label><p>保存复盘后生成可编辑摘要，确认后写入 Obsidian。</p>${item.done ? '' : ui`<p>请先完成行程，再生成复盘笔记。</p>`}<div class="actions"><button type="button" class="solid" data-note-draft ${item.done ? '' : 'disabled'}>保存复盘并生成摘要</button><button type="button" class="ghost" data-note-review-only>仅保存复盘</button><button type="button" class="ghost" data-note-close>关闭</button></div><p data-note-message role="status"></p><div data-note-preview hidden><label>摘要（可编辑）<textarea id="review-note-summary" rows="10"></textarea></label><label>关联关键词（机构、人物、主题）<input id="review-note-keywords" /></label><button type="button" class="solid" data-note-save>确认保存 Markdown 笔记</button></div></div>`;
  const panel = modal.firstElementChild;
  const original = panel.querySelector('#review-note-original'), message = panel.querySelector('[data-note-message]'), preview = panel.querySelector('[data-note-preview]');
  let draft = null, busy = false;
  const run = async action => {
    if (busy) return; busy = true;
    panel.querySelectorAll('button:not([data-note-close])').forEach(button => { button.disabled = true; });
    try { await action(); } catch (error) { message.textContent = errorText(error); }
    finally { busy = false; panel.querySelectorAll('button:not([data-note-close])').forEach(button => { button.disabled = button.hasAttribute('data-note-draft') && !item.done; }); }
  };
  const saveReview = async () => {
    await api(`/api/agendas/${encodeURIComponent(item.id)}`, { method: 'PATCH', body: { review: original.value.trim() } });
    await reload();
    message.textContent = tr('复盘已保存。');
  };
  panel.querySelector('[data-note-close]').onclick = () => { modal.hidden = true; };
  panel.querySelector('[data-note-review-only]').onclick = () => run(saveReview);
  original.oninput = () => { if (draft && original.value.trim() !== draft.original.trim()) { draft = null; preview.hidden = true; message.textContent = tr('复盘已修改，请重新生成摘要。'); } };
  panel.querySelector('[data-note-draft]').onclick = () => run(async () => {
    preview.hidden = true; draft = null;
    await saveReview(); message.textContent = tr('正在生成复盘摘要…');
    draft = await api(`/api/agendas/${encodeURIComponent(item.id)}/review-note/draft`, { method: 'POST', body: {} });
    if (original.value.trim() !== draft.original.trim()) { draft = null; message.textContent = tr('复盘已修改，请重新生成摘要。'); return; }
    preview.hidden = false;
    panel.querySelector('#review-note-summary').value = draft.summary;
    panel.querySelector('#review-note-keywords').value = draft.keywords.join(', ');
    message.textContent = tr('摘要待确认，尚未写入笔记。');
  });
  panel.querySelector('[data-note-save]').onclick = () => run(async () => {
    if (!draft) return;
    const saved = await api(`/api/agendas/${encodeURIComponent(item.id)}/review-note/save`, { method: 'POST', body: { ...draft, summary: panel.querySelector('#review-note-summary').value, keywords: panel.querySelector('#review-note-keywords').value } });
    message.textContent = tr('Markdown 笔记已保存并读回：') + saved.note.path;
    preview.hidden = true; draft = null; await reload();
  });
}
export async function openNotesManager(agendas, api, reload) {
  const modal = model(); modal.hidden = false;
  modal.innerHTML = ui`<div class="sheet"><h2>复盘笔记</h2><p data-note-message>读取中…</p><div data-note-list></div><button type="button" class="ghost" data-note-close>关闭</button></div>`;
  const panel = modal.firstElementChild;
  panel.querySelector('[data-note-close]').onclick = () => { modal.hidden = true; };
  try {
    const result = await api('/api/agenda-notes');
    panel.querySelector('[data-note-message]').textContent = result.directory;
    const labels = { active: tr('有效'), historical: tr('历史参考'), disabled: tr('停用') };
    panel.querySelector('[data-note-list]').innerHTML = ui`<label>整理已完成的历史复盘<select data-note-agenda><option value="">选择行程</option>${agendas.filter(item => item.done && item.review).map(item => `<option value="${esc(item.id)}">${esc(item.date)} · ${esc(item.title)}</option>`).join('')}</select></label><button type="button" class="tiny" data-note-historical>生成摘要</button>${result.notes.length ? result.notes.map(note => `<article class="managed-note"><b>${esc(note.date)} · ${esc(note.title)}</b><small>${esc(note.file)} · v${note.version}</small><select data-note-status="${esc(note.file)}">${Object.entries(labels).map(([value, label]) => `<option value="${value}" ${value === note.status ? 'selected' : ''}>${label}</option>`).join('')}</select></article>`).join('') : ui`<p>尚未保存复盘笔记。</p>`}${result.ignored.length ? ui`<p>${result.ignored.length} 份笔记格式异常，已跳过。</p>` : ''}`;
    panel.querySelector('[data-note-historical]').onclick = () => {
      const item = agendas.find(item => item.id === panel.querySelector('[data-note-agenda]').value);
      if (item) openReviewNote(item, api, reload);
    };
    panel.querySelectorAll('[data-note-status]').forEach(select => {
      select.onchange = async () => {
        const note = result.notes.find(note => note.file === select.dataset.noteStatus); select.disabled = true;
        try { const updated = await api(`/api/agenda-notes/${encodeURIComponent(note.file)}`, { method: 'PATCH', body: { status: select.value, sha256: note.sha256 } }); Object.assign(note, updated); }
        catch (error) { select.value = note.status; panel.querySelector('[data-note-message]').textContent = errorText(error); }
        finally { select.disabled = false; }
      };
    });
  } catch (error) { panel.querySelector('[data-note-message]').textContent = errorText(error); }
}
