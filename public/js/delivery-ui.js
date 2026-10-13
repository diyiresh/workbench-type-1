import { esc } from './core.js';
import { t as tr, ui } from './i18n.js';

export function deliveryView(run, store) {
  const d = run.delivery;
  const labels = { text: '正文交付', pending: '待生成文件', generating: '正在生成文件', files_ready: '待文件复核', reviewing: '正在复核文件', reviewed: '文件复核通过', accepted: '文件交付通过', failed: '文件交付受阻', invalidated: '文件核验失效', awaiting_configuration: '待确定交付要求', legacy_unverified: '文件交付未核验' };
  const state = d?.state || 'legacy_unverified';
  const files = (store.artifacts || []).filter(a => d?.artifactIds?.includes(a.id));
  const paused = run.archived || run.resumeRequired || run.status === 'archived';
  return ui`<section class="card delivery-panel"><h2>成果文件与交付验收</h2><p><b>${esc(tr(labels[state] || '文件交付受阻'))}</b></p><p>正文复核与文件交付分别记录。文件项目须核对实际文件及源稿版本，才算交付完成。</p>${d?.error ? `<p role="alert">${esc(d.error)}</p>` : ''}
    ${d?.contract?.mode === 'files' ? `<p>${esc(tr('交付目录'))}：${esc(d.contract.directory || tr('工作台本机成果目录'))}</p><div class="actions"><button type="button" data-delivery-action="generate" data-run-id="${esc(run.id)}" ${paused || ['generating','reviewing'].includes(state) ? 'disabled' : ''}>${tr('生成并登记文件')}</button>${['failed','invalidated'].includes(state) ? `<button type="button" data-delivery-action="retry" data-run-id="${esc(run.id)}" ${paused ? 'disabled' : ''}>${tr('重试文件交付')}</button>` : ''}</div>` : ''}
    ${files.map(f => `<article class="delivery-file"><b>${esc(f.name)}</b><p>${esc(tr('版本'))} ${f.version} · ${f.bytes} bytes · ${esc(tr(f.reviewStatus === 'passed' ? '文件复核通过' : f.reviewStatus === 'invalidated' ? '文件核验失效' : '待文件复核'))}</p><p class="delivery-path">${esc(f.path)}</p><details><summary>${tr('版本核验信息')}</summary><p>SHA-256: ${esc(f.sha256)}</p><p>${tr('源正文哈希')}：${esc(f.sourceHash)}</p></details><div class="actions"><button type="button" data-delivery-open="${esc(f.id)}" data-run-id="${esc(run.id)}" ${paused ? 'disabled' : ''}>${tr('打开文件')}</button><button type="button" data-delivery-folder="${esc(f.id)}" data-run-id="${esc(run.id)}" ${paused ? 'disabled' : ''}>${tr('打开所在目录')}</button></div></article>`).join('')}
    ${d?.review ? `<details><summary>${tr('文件独立复核记录')}</summary><p>${esc(d.review.reviewerAgentId)}</p><pre class="report">${esc(d.review.comment)}</pre></details>` : ''}
    <details><summary>设置交付要求</summary><form data-delivery-config="${esc(run.id)}"><label>交付形式<select name="profile"><option value="text" ${d?.contract?.mode === 'text' ? 'selected' : ''}>正文即可</option><option value="single" ${d?.contract?.profile === 'single' ? 'selected' : ''}>一份 Word</option><option value="report-bundle" ${d?.contract?.profile === 'report-bundle' ? 'selected' : ''}>长篇、摘要、附件三份 Word</option></select></label><label>输出目录（绝对路径，可选）<input name="directory" value="${esc(d?.contract?.directory || '')}"></label><button type="submit" ${paused ? 'disabled' : ''}>保存交付要求</button><p>更改要求会重新核验交付，保留原成果和复核历史。</p></form></details></section>`;
}

export function bindDelivery(api, reload) {
  const perform = async (button, action, body = {}) => {
    button.disabled = true;
    try { await api(`/api/departments/runs/${encodeURIComponent(button.dataset.runId)}/delivery/${action}`, { method: 'POST', body }); await reload(); }
    catch (error) { window.alert(tr('文件交付操作失败：') + error.message); button.disabled = false; }
  };
  document.querySelectorAll('[data-delivery-action]').forEach(b => b.onclick = () => perform(b, b.dataset.deliveryAction));
  document.querySelectorAll('[data-delivery-open]').forEach(b => b.onclick = () => perform(b, 'open', { artifactId: b.dataset.deliveryOpen }));
  document.querySelectorAll('[data-delivery-folder]').forEach(b => b.onclick = () => perform(b, 'open', { artifactId: b.dataset.deliveryFolder, folder: true }));
  document.querySelectorAll('[data-delivery-config]').forEach(form => form.onsubmit = async event => {
    event.preventDefault();
    const data = new FormData(form), button = form.querySelector('button[type=submit]');
    button.dataset.runId = form.dataset.deliveryConfig;
    const profile = data.get('profile');
    try {
      const previous = await api(`/api/departments/runs/${encodeURIComponent(form.dataset.deliveryConfig)}/delivery`);
      await perform(button, 'configure', { mode: profile === 'text' ? 'text' : 'files', profile, directory: data.get('directory'), files: previous.delivery?.contract?.profile === profile ? previous.delivery.contract.files : undefined });
    } catch (error) { window.alert(tr('文件交付操作失败：') + error.message); }
  });
}
