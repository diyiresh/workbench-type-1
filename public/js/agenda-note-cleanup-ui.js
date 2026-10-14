import { esc } from './core.js';
import { t as tr, ui } from './i18n.js';
const errorText = error => { try { return JSON.parse(error.message).error || error.message; } catch { return error.message; } };
const attached = panel => panel?.isConnected && !document.getElementById('modal').hidden && document.getElementById('modal').firstElementChild === panel;
export function versionCaption(note) {
  return (note.current ? tr('当前版本') : tr('已被替代')) + ' · ' + (note.current && note.status === 'active' ? tr('参与建议') : tr('不参与建议'));
}
export function bindSaveCleanup(panel, agendaId, api) {
  const section = document.createElement('section');
  section.innerHTML = ui`<label><input type="checkbox" data-note-auto-cleanup disabled /> 保存后移除旧版本</label><p>下列为当前已有版本。保存并读回成功后仅移除旧版本，始终保留最新笔记；已移除文件可在复盘笔记中恢复。</p><div data-note-cleanup-files></div><button type="button" class="tiny" data-note-cleanup-refresh>刷新版本清单</button>`;
  panel.querySelector('[data-note-save]').closest('.actions').before(section);
  const checkbox = section.querySelector('[data-note-auto-cleanup]'), output = section.querySelector('[data-note-cleanup-files]');
  let preview = null, busy = false, sequence = 0;
  const controls = () => { checkbox.disabled = busy || !preview?.existing.length; section.querySelector('[data-note-cleanup-refresh]').disabled = busy; };
  const controller = {
    setBusy(value) { busy = value; controls(); },
    async load() {
      const token = ++sequence; preview = null; checkbox.checked = false; controls(); output.textContent = tr('正在读取版本清单…');
      try {
        const result = await api(`/api/agendas/${encodeURIComponent(agendaId)}/review-note/cleanup`);
        if (!attached(panel) || token !== sequence) return;
        preview = result;
        output.innerHTML = result.existing.length ? `<ul>${result.existing.map(note => `<li>${esc(note.file)}</li>`).join('')}</ul>` : ui`<p>没有需要移除的旧版本。</p>`;
      } catch (error) { if (attached(panel) && token === sequence) output.textContent = errorText(error); }
      finally { controls(); }
    },
    selection() { return checkbox.checked && preview ? { removeOlderVersions: true, cleanupSnapshot: preview.snapshot } : {}; },
    report(result, message) {
      if (!result.cleanup) return;
      const text = result.cleanup.error ? tr('笔记已保存，但旧版本移除失败：') + result.cleanup.error : tr('已移除旧版本，可在复盘笔记中恢复。') + ' (' + result.cleanup.removedCount + ')';
      message.append(document.createTextNode(' ' + text));
    },
  };
  section.querySelector('[data-note-cleanup-refresh]').onclick = () => controller.load();
  return controller;
}
export function bindManagerCleanup(panel, result, api, refresh) {
  const output = document.createElement('div'); output.dataset.noteCleanupPanel = ''; panel.querySelector('[data-note-list]').append(output);
  const status = panel.querySelector('[data-note-message]');
  const finish = async message => {
    if (!attached(panel)) return;
    const current = await refresh();
    if (attached(current)) current.querySelector('[data-note-message]').textContent = message;
  };
  for (const note of result.notes) {
    const select = [...panel.querySelectorAll('[data-note-status]')].find(select => select.dataset.noteStatus === note.file);
    const article = select.closest('article'), label = document.createElement('small'); label.dataset.noteVersion = ''; label.textContent = versionCaption(note); select.before(label);
    if (!note.current || !result.notes.some(other => other.agendaId === note.agendaId && other.version < note.version)) continue;
    const button = document.createElement('button'); button.type = 'button'; button.className = 'tiny'; button.dataset.noteCleanup = note.agendaId; button.textContent = tr('移除旧版本'); article.append(button);
    button.onclick = async () => {
      button.disabled = true;
      try {
        const preview = await api(`/api/agendas/${encodeURIComponent(note.agendaId)}/review-note/cleanup`);
        if (!attached(panel)) return;
        output.innerHTML = ui`<section class="note-suggestion"><h3>确认移除旧版本</h3><p>保留最新笔记：</p><p>${esc(preview.latest?.file || '')}</p><p>以下文件将移入可恢复目录：</p><ul>${preview.older.map(file => `<li>${esc(file.file)}</li>`).join('')}</ul><button type="button" class="solid" data-note-cleanup-confirm>确认移除</button> <button type="button" class="ghost" data-note-cleanup-cancel>取消</button></section>`;
        const confirm = output.querySelector('[data-note-cleanup-confirm]'); confirm.disabled = !preview.older.length;
        output.querySelector('[data-note-cleanup-cancel]').onclick = () => { output.innerHTML = ''; };
        confirm.onclick = async () => {
          confirm.disabled = true;
          try { await api(`/api/agendas/${encodeURIComponent(note.agendaId)}/review-note/cleanup`, { method: 'POST', body: { snapshot: preview.snapshot } }); await finish(tr('已移除旧版本，可在复盘笔记中恢复。')); }
          catch (error) { status.textContent = errorText(error); }
          finally { confirm.disabled = false; }
        };
        output.scrollIntoView({ block: 'nearest' });
      } catch (error) { status.textContent = errorText(error); }
      finally { button.disabled = false; }
    };
  }
  const recovery = document.createElement('details'); recovery.dataset.noteRecovery = '';
  recovery.innerHTML = ui`<summary>已移除版本（可恢复）</summary><p>恢复不会覆盖同名文件，也不会替代当前较新版本。</p>${(result.recovery?.batches || []).map(batch => ui`<article class="managed-note"><b>${esc(batch.title)}</b><small>${esc(batch.removedAt)}</small><ul>${batch.files.map(file => `<li>${esc(file.file)}</li>`).join('')}</ul><button type="button" class="tiny" data-note-restore="${esc(batch.id)}">恢复这些版本</button></article>`).join('')}${result.recovery?.ignored.length ? ui`<p>部分移除凭据异常，请核对文件后恢复。</p>` : ''}`;
  panel.querySelector('[data-note-list]').append(recovery);
  recovery.querySelectorAll('[data-note-restore]').forEach(button => {
    button.onclick = async () => {
      button.disabled = true;
      const batch = result.recovery.batches.find(batch => batch.id === button.dataset.noteRestore);
      try { await api(`/api/agenda-notes/trash/${encodeURIComponent(batch.id)}/restore`, { method: 'POST', body: { snapshot: batch.snapshot } }); await finish(tr('旧版本已恢复，建议仍使用最新有效版本。')); }
      catch (error) { status.textContent = errorText(error); }
      finally { button.disabled = false; }
    };
  });
}
