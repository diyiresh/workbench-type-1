import { esc } from './core.js';
import { t as tr, ui } from './i18n.js';
import { bindSaveCleanup, bindManagerCleanup, versionCaption } from './agenda-note-cleanup-ui.js';
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
  modal.innerHTML = ui`<div class="sheet review-note-editor"><h2>行程复盘与笔记</h2><p>${esc(item.date)} · ${esc(item.title)}</p><label>原始复盘<textarea id="review-note-original" rows="6">${esc(item.review || '')}</textarea></label><p>保存复盘后生成可编辑摘要，确认后写入 Obsidian。</p>${item.done ? '' : ui`<p>请先完成行程，再生成复盘笔记。</p>`}<div class="actions"><button type="button" class="solid" data-note-draft ${item.done ? '' : 'disabled'}>保存复盘并生成摘要</button><button type="button" class="ghost" data-note-load>载入已保存笔记</button><button type="button" class="ghost" data-note-review-only>仅保存复盘</button><button type="button" class="ghost" data-note-close>关闭</button></div><p data-note-message role="status"></p><div data-note-preview hidden><label>摘要（可编辑）<textarea id="review-note-summary" rows="10"></textarea></label><p>在草稿中补充回复后，点击“整合补充并更新摘要”；确认保存只写入当前文本。重新生成会替换草稿。</p><label>关联关键词（机构、人物、主题）<input id="review-note-keywords" /></label><div class="actions"><button type="button" class="ghost" data-note-refine>整合补充并更新摘要</button><button type="button" class="solid" data-note-save>确认保存 Markdown 笔记</button></div><details data-note-before hidden><summary>对照整合前草稿</summary><pre class="report" data-note-before-text></pre><button type="button" class="ghost" data-note-undo>恢复整合前草稿</button></details></div></div>`;
  const panel = modal.firstElementChild;
  const cleanup = bindSaveCleanup(panel, item.id, api);
  const original = panel.querySelector('#review-note-original'), message = panel.querySelector('[data-note-message]'), preview = panel.querySelector('[data-note-preview]');
  const summary = panel.querySelector('#review-note-summary'), tags = panel.querySelector('#review-note-keywords'), comparison = panel.querySelector('[data-note-before]');
  let draft = null, previous = null, busy = false;
  const attached = () => !modal.hidden && modal.firstElementChild === panel;
  const currentDraft = () => draft && original.value.trim() === draft.original.trim();
  const controls = () => { cleanup.setBusy(busy); panel.querySelectorAll('button:not([data-note-close])').forEach(button => {
    button.disabled = busy || ((button.hasAttribute('data-note-draft') || button.hasAttribute('data-note-load')) && !item.done) || ((button.hasAttribute('data-note-save') || button.hasAttribute('data-note-refine')) && !currentDraft());
    if (button.hasAttribute('data-note-load')) button.hidden = !!draft;
  }); };
  const paintDraft = value => {
    draft = value; summary.value = value.summary; tags.value = value.keywords.join(', '); preview.hidden = false;
  };
  const run = async action => {
    if (busy) return; busy = true;
    controls();
    try { await action(); } catch (error) { message.textContent = errorText(error); }
    finally { busy = false; controls(); }
  };
  const saveReview = async () => {
    await api(`/api/agendas/${encodeURIComponent(item.id)}`, { method: 'PATCH', body: { review: original.value.trim() } });
    await reload();
    message.textContent = tr('复盘已保存。');
  };
  panel.querySelector('[data-note-close]').onclick = () => { modal.hidden = true; };
  panel.querySelector('[data-note-review-only]').onclick = () => run(saveReview);
  original.oninput = () => { controls(); if (draft && !currentDraft()) message.textContent = tr('复盘已修改，请重新生成摘要。'); };
  panel.querySelector('[data-note-draft]').onclick = () => run(async () => {
    const priorSummary = summary.value;
    await saveReview(); message.textContent = tr('正在生成复盘摘要…');
    const result = await api(`/api/agendas/${encodeURIComponent(item.id)}/review-note/draft`, { method: 'POST', body: {} });
    if (!attached()) return;
    if (original.value.trim() !== result.original.trim() || summary.value !== priorSummary) { message.textContent = tr('生成期间内容已修改，已保留当前草稿，请重试。'); return; }
    previous = null; comparison.hidden = true; paintDraft(result);
    await cleanup.load();
    message.textContent = tr('摘要待确认，尚未写入笔记。');
  });
  panel.querySelector('[data-note-load]').onclick = () => run(async () => {
    const snapshot = original.value;
    const result = await api(`/api/agendas/${encodeURIComponent(item.id)}/review-note/saved`);
    if (!attached()) return;
    if (snapshot !== original.value || original.value.trim() !== result.original.trim()) { message.textContent = tr('复盘已修改，请重新生成摘要。'); return; }
    previous = null; comparison.hidden = true; paintDraft(result);
    await cleanup.load();
    message.textContent = tr('已载入最新笔记，可补充回复并整合；尚未保存新版本。');
  });
  panel.querySelector('[data-note-refine]').onclick = () => run(async () => {
    if (!currentDraft()) return;
    const snapshot = { ...draft, summary: summary.value, keywords: tags.value }, originalSnapshot = original.value;
    message.textContent = tr('正在整合补充回复，原草稿已保留…');
    const result = await api(`/api/agendas/${encodeURIComponent(item.id)}/review-note/refine`, { method: 'POST', body: snapshot });
    if (!attached()) return;
    if (summary.value !== snapshot.summary || original.value !== originalSnapshot) { message.textContent = tr('生成期间内容已修改，已保留当前草稿，请重试。'); return; }
    previous = snapshot;
    const currentKeywords = tags.value;
    paintDraft(result); tags.value = currentKeywords;
    panel.querySelector('[data-note-before-text]').textContent = previous.summary; comparison.hidden = false;
    message.textContent = tr('补充已整合，请审阅更新后的摘要，再确认保存。');
  });
  panel.querySelector('[data-note-undo]').onclick = () => {
    if (!previous || busy) return;
    paintDraft({ ...previous, keywords: String(previous.keywords).split(/[,，\n]/).map(value => value.trim()).filter(Boolean) });
    previous = null; comparison.hidden = true; controls(); message.textContent = tr('已恢复整合前草稿，尚未保存。');
  };
  panel.querySelector('[data-note-save]').onclick = () => run(async () => {
    if (!currentDraft()) return;
    const snapshot = { ...draft, summary: summary.value, keywords: tags.value, ...cleanup.selection() };
    const saved = await api(`/api/agendas/${encodeURIComponent(item.id)}/review-note/save`, { method: 'POST', body: snapshot });
    if (!attached()) return;
    message.textContent = tr('Markdown 笔记已保存并读回：') + saved.note.path;
    if (summary.value === snapshot.summary && tags.value === snapshot.keywords && original.value.trim() === draft.original.trim()) { preview.hidden = true; draft = null; previous = null; comparison.hidden = true; }
    else { draft.baseNote = { file: saved.note.file, sha256: saved.note.sha256 }; message.textContent = tr('笔记已保存；保存期间的新修改仍保留在草稿中，尚未写入。'); }
    cleanup.report(saved, message);
    if (draft) await cleanup.load();
    await reload();
  });
  controls();
}
export async function openNotesManager(agendas, api, reload) {
  const modal = model(); modal.hidden = false;
  modal.innerHTML = ui`<div class="sheet"><h2>复盘笔记</h2><p data-note-message>读取中…</p><div data-note-list></div><button type="button" class="ghost" data-note-close>关闭</button></div>`;
  const panel = modal.firstElementChild;
  panel.querySelector('[data-note-close]').onclick = () => { modal.hidden = true; };
  try {
    const result = await api('/api/agenda-notes');
    if (!panel.isConnected || modal.firstElementChild !== panel || modal.hidden) return panel;
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
        try { const updated = await api(`/api/agenda-notes/${encodeURIComponent(note.file)}`, { method: 'PATCH', body: { status: select.value, sha256: note.sha256 } }); Object.assign(note, updated); select.closest('article').querySelector('[data-note-version]').textContent = versionCaption(note); }
        catch (error) { select.value = note.status; panel.querySelector('[data-note-message]').textContent = errorText(error); }
        finally { select.disabled = false; }
      };
    });
    bindManagerCleanup(panel, result, api, () => openNotesManager(agendas, api, reload));
  } catch (error) { panel.querySelector('[data-note-message]').textContent = errorText(error); }
  return panel;
}
