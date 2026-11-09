import { api, esc, ymd, setStore } from './core.js';

const CACHE = 'bench-v9-growth-drafts';
let drafts = {}, selected = '', model = null, busy = false;
try { const saved = JSON.parse(sessionStorage.getItem(CACHE) || '{}'); drafts = saved.drafts || {}; selected = saved.selected || ''; } catch { /* session storage may be unavailable */ }
function remember() { try { sessionStorage.setItem(CACHE, JSON.stringify({ drafts, selected })); } catch { /* keep current session memory */ } }
function errorText(error) { try { return JSON.parse(error.message).error || error.message; } catch { return error.message; } }
const option = (value, label, current) => `<option value="${esc(value)}" ${String(value) === String(current) ? 'selected' : ''}>${esc(label)}</option>`;
const weekOptions = current => Array.from({ length: 8 }, (_, i) => option(i + 1, `第${i + 1}周`, current)).join('');
const activeCards = () => model.cards.filter(c => !c.archived);
const tabFor = () => ({ 'growth-plan': 'plan', 'growth-cards': 'cards', 'growth-sources': 'sources' })[location.hash.split('/')[1]] || 'overview';
export function growthView() { return '<section id="growth-root" class="growth" aria-label="履职成长 V9"><p role="status">正在载入履职成长…</p></section>'; }

function editorDraft() {
  if (!selected) return null;
  if (!drafts[selected]) {
    const card = model.cards.find(c => c.id === selected);
    if (card) drafts[selected] = { ...card, expectedRevision: card.revision, reviewConfirmed: false };
    else {
      const kind = selected.replace('new-', ''), template = model.templates.find(t => t.kind === kind) || model.templates[0];
      drafts[selected] = { kind: template.kind, title: '', body: template.body, week: '1', mastery: '0', sourceStatus: 'unverified', requestId: crypto.randomUUID() };
    }
    remember();
  }
  return drafts[selected];
}
function capture(form) {
  if (!form || !selected) return;
  const values = Object.fromEntries(new FormData(form));
  drafts[selected] = { ...editorDraft(), ...values, expectedRevision: Number(values.expectedRevision), reviewConfirmed: form.elements.reviewConfirmed?.checked || false };
  remember();
}
function relatedOptions(rows, current, kind) {
  return option('', '不关联', current) + rows.map(r => option(r.id, `${r.archived ? '[已归档] ' : ''}${r.title || r.id}${kind === 'agenda' ? ' · ' + r.date : ''}`, current)).join('');
}
function editor() {
  const d = editorDraft(); if (!d) return '<div class="growth-empty">选择上方工具卡开始记录，或打开一张已有卡片。</div>';
  const card = model.cards.find(c => c.id === selected), isLearning = ['concept', 'case'].includes(d.kind);
  return `<form id="growth-card-form" class="growth-editor">
    <div class="growth-section-title"><div><small>${esc(model.templates.find(t => t.kind === d.kind)?.name || '')}${card?.archived ? ' · 已归档' : ''}</small><h3>${card ? '编辑卡片 · 第' + card.revision + '版' : '写下第一份判断'}</h3></div><button type="button" class="ghost" data-growth="reset">重置为已保存内容</button></div>
    <input type="hidden" name="expectedRevision" value="${esc(d.expectedRevision || 0)}"><input type="hidden" name="kind" value="${esc(d.kind)}">
    <div class="growth-two"><label>标题<input name="title" required maxlength="160" value="${esc(d.title)}" placeholder="例如：材料价格变化时，我需要核实哪些依据？"></label><label>所属周<select name="week">${weekOptions(d.week)}</select></label></div>
    <label>正文<textarea name="body" aria-label="正文" required maxlength="16000" rows="13">${esc(d.body)}</textarea></label>
    <details class="growth-details" ${isLearning ? 'open' : ''}><summary>出处与关联事项</summary>
      <div class="growth-two"><label>出处名称<input name="sourceTitle" maxlength="300" value="${esc(d.sourceTitle || '')}"></label><label>出处链接<input name="sourceUrl" type="url" maxlength="2000" value="${esc(d.sourceUrl || '')}" placeholder="https://…"></label></div>
      <div class="growth-two"><label>版本或文号<input name="sourceVersion" maxlength="300" value="${esc(d.sourceVersion || '')}"></label><label>条款、页码或内部材料定位<input name="locator" maxlength="500" value="${esc(d.locator || '')}"></label></div>
      <label>个人阅读状态<select name="sourceStatus">${option('unverified', '待核实', d.sourceStatus)}${option('entry', '仅核实入口／附件待读', d.sourceStatus)}${option('read', '已读原文（本人记录）', d.sourceStatus)}</select></label>
      <div class="growth-two"><label>关联现有任务<select name="relatedTaskId">${relatedOptions(model.tasks, d.relatedTaskId, 'task')}</select></label><label>关联现有行程<select name="relatedAgendaId">${relatedOptions(model.agendas, d.relatedAgendaId, 'agenda')}</select></label></div>
    </details>
    ${isLearning ? `<fieldset class="growth-assessment"><legend>理解与复核证据</legend><p>学习勾选与掌握程度分开记录；专业核对结论由本人据实登记。</p>
      <label>掌握程度<select name="mastery">${model.levels.map((name, i) => option(i, name, d.mastery)).join('')}</select></label>
      <label>我的解释、自测回答或分析证据<textarea name="evidence" aria-label="我的解释、自测回答或分析证据" rows="4" maxlength="4000">${esc(d.evidence || '')}</textarea></label>
      <div class="growth-two"><label>专业核对人<input name="reviewer" maxlength="100" value="${esc(d.reviewer || '')}"></label><label>专业核对意见<textarea name="reviewNote" aria-label="专业核对意见" rows="2" maxlength="4000">${esc(d.reviewNote || '')}</textarea></label></div>
      <label class="growth-check"><input type="checkbox" name="reviewConfirmed" ${d.reviewConfirmed ? 'checked' : ''}>我确认已对本版内容完成专业核对，且已据实填写核对人和意见。</label>
      <small>修改已复核卡片的正文或出处后，旧复核退回历史，本版需重新核对。</small></fieldset>` : ''}
    <div class="growth-save"><span>草稿保留在当前浏览器会话；保存后写入工作台。</span><button type="submit" class="solid" ${busy ? 'disabled' : ''}>保存卡片</button></div>
    ${card?.reviewInvalidated ? '<p class="growth-warning">内容已有改动，旧复核已保留在历史，本版等待重新核对。</p>' : ''}
    ${card ? `<details class="growth-details"><summary>查看版本记录（${card.history.length}个历史版本）</summary>${card.history.slice().reverse().map(h => `<article class="growth-history"><b>第${h.revision}版 · ${esc(h.updatedAt?.slice(0, 10))} · ${esc(model.levels[h.mastery])}${h.archived ? ' · 已归档' : ''}</b><p>${esc(h.reviewer ? '核对人：' + h.reviewer + '；' + h.reviewNote : '无本版专业核对记录')}</p><pre>${esc(h.body)}</pre></article>`).join('') || '<p>尚无历史版本。</p>'}</details>` : ''}
  </form>`;
}
function overview() {
  const plan = model.plan, cards = activeCards(), sessions = plan?.sessions || [], done = sessions.filter(s => s.done);
  return `<div class="growth-stats"><article><small>学习安排</small><strong>${done.length}<em> / ${sessions.length || 40}</em></strong><span>已勾选，不等于掌握</span></article><article><small>案例与概念</small><strong>${cards.filter(c => ['case', 'concept'].includes(c.kind)).length}</strong><span>保留出处与分析</span></article><article><small>管理复盘</small><strong>${cards.filter(c => c.kind === 'reflection').length}</strong><span>从具体工作中训练</span></article><article><small>专业复核记录</small><strong>${cards.filter(c => c.mastery === 3).length}</strong><span>当前版本有核对记录</span></article></div>
    <div class="growth-overview-grid"><section class="growth-panel"><div class="growth-section-title"><div><small>你的起点</small><h3>把工程经验，转化为造价判断</h3></div><span class="growth-badge">每周 5 小时 +</span></div><p>已有工程或建设管理经验；重点补齐计价规则、合同价款、调解监督和造价数据管理。分管范围明确后再深化对应专题。</p>
    <ol class="growth-steps"><li><b>先写自己的判断</b><span>选一个熟悉且允许学习的工程情形，列出造价疑问。</span></li><li><b>回到原文和证据</b><span>核对适用条件、条款与缺失材料，再请教和修订。</span></li><li><b>留下下一次的改进</b><span>每周一张案例卡、一份条件对照、一条管理复盘。</span></li></ol>
    ${!plan ? `<form id="growth-activate"><label>第一周开始日期<input type="date" name="startDate" required value="${esc(drafts.activation?.startDate || ymd())}"></label><button type="submit" class="solid">采纳八周计划</button><p class="growth-muted">将保存40项学习安排。你可以分次勾选；不会创建会议或代替已有日程。</p></form>` : `<p class="growth-plan-status">${esc(plan.startDate)} — ${esc(plan.deadline)} · ${plan.archived || plan.resumeRequired || plan.paused ? '已归档或暂停，请通过管理与归档处理' : plan.status === 'completed' ? '学习安排已全部勾选，记录仍保留' : '计划进行中'}</p><a class="growth-link" href="#learn/growth-plan">查看我的八周安排 →</a>`}</section>
    <aside class="growth-panel growth-rhythm"><small>一周的节奏</small><h3>300 分钟，持续积累</h3>${model.blocks.map(b => `<div><span>${esc(b.name)}</span><b>${b.minutes}<small>分钟</small></b></div>`).join('')}<p>额外时间用于薄弱主题和案例修订。勾选记录反映安排完成，实际投入与业务结果据实填写。</p></aside></div>
    <section class="growth-panel"><div class="growth-section-title"><h3>从一张卡片开始</h3><a href="#learn/growth-cards">全部卡片 →</a></div>${templateButtons()}</section>`;
}
function templateButtons() { return `<div class="growth-templates">${model.templates.map((t, i) => `<button type="button" data-growth="new" data-kind="${t.kind}"><span>0${i + 1}</span><b>${esc(t.name)}</b><small>打开记录模板 →</small></button>`).join('')}</div>`; }
function planView() {
  const plan = model.plan, blocked = !plan || plan.archived || plan.paused || plan.resumeRequired;
  return `<div class="growth-section-title"><div><h3>八周，从全貌走向判断</h3><p>每周300分钟。日期相对你采纳的开始日；学习记录与理解证据分别保留。</p></div>${!plan ? '<a href="#learn/growth">先采纳计划 →</a>' : ''}</div><div class="growth-week-list">${model.weeks.map(w => {
    const sessions = plan?.sessions.filter(s => s.week === w.week) || [], n = sessions.filter(s => s.done).length;
    return `<article class="growth-panel growth-week"><div class="growth-section-title"><div><small>WEEK ${String(w.week).padStart(2, '0')}</small><h3>${esc(w.title)}</h3></div><span class="growth-badge">${n} / 5 项</span></div><p>${esc(w.business)}</p><p class="growth-muted">管理实践：${esc(w.management)}</p>
      <div class="growth-sessions">${(sessions.length ? sessions : model.blocks.map(b => ({ ...b, title: b.name, note: b.action }))).map(s => `<label class="growth-session ${s.done ? 'is-done' : ''}"><input type="checkbox" data-growth-session="${esc(s.id || '')}" ${s.done ? 'checked' : ''} ${blocked || busy ? 'disabled' : ''}><span><b>${esc(s.title)}</b><small>${esc(s.date || '采纳后生成日期')} · ${s.minutes}分钟</small><span>${esc(s.note)}</span></span></label>`).join('')}</div><div class="growth-week-footer"><button type="button" class="ghost" data-growth="weekly" data-week="${w.week}" ${blocked || busy ? 'disabled' : ''}>生成本周一页纸草稿</button><small>仅整理当前记录，审阅后保存</small></div></article>`;
  }).join('')}</div>`;
}
function cardList() { return model.cards.map(c => `<article class="growth-card-row" data-growth-card data-kind="${esc(c.kind)}" data-archived="${c.archived}" data-search="${esc([c.title, c.body, c.sourceTitle, c.evidence].join(' ').toLowerCase())}"><button type="button" data-growth="edit" data-id="${esc(c.id)}"><small>${esc(model.templates.find(t => t.kind === c.kind)?.name)} · 第${c.week}周 · 第${c.revision}版</small><b>${esc(c.title)}</b><span>${['concept', 'case'].includes(c.kind) ? esc(model.levels[c.mastery]) + ' · ' : ''}${c.sourceStatus === 'read' ? '本人已读原文' : c.sourceStatus === 'entry' ? '附件待读' : '出处待核实'}${c.archived ? ' · 已归档' : ''}</span></button><button type="button" class="ghost" data-growth="archive" data-id="${esc(c.id)}">${c.archived ? '恢复' : '归档'}</button></article>`).join(''); }
function cardsView() { return `<section class="growth-panel">${templateButtons()}<div class="growth-card-filters"><label>搜索卡片<input type="search" id="growth-search" placeholder="标题、正文、出处或证据"></label><label>类型<select id="growth-kind">${option('', '全部类型', '')}${model.templates.map(t => option(t.kind, t.name, '')).join('')}</select></label><label class="growth-check"><input type="checkbox" id="growth-show-archived">显示已归档</label></div><div id="growth-card-list">${cardList()}</div><p id="growth-card-empty" class="growth-muted" hidden>暂无匹配卡片。可从上方模板开始。</p></section><section class="growth-panel">${editor()}</section>`; }
function sourcesView() { return `<div class="growth-section-title"><div><h3>每一次判断，都能回到出处</h3><p>以下是已核实的官方入口。具体文件的阅读与适用条件，请在自己的卡片中记录。</p></div></div><div class="growth-source-grid">${model.sources.map((s, i) => `<article class="growth-panel"><small>${esc(s.published || '持续更新栏目')} · 入口核验 ${esc(s.checkedAt)}</small><h3><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title)} ↗</a></h3><p>${esc(s.purpose)}</p><p class="growth-muted">${esc(s.status)}</p><button type="button" class="ghost" data-growth="source" data-index="${i}">创建阅读卡</button></article>`).join('')}</div><section class="growth-panel"><h3>学习与复盘指令</h3><p>仅在允许使用的环境中提交授权材料。以下指令可复制使用，不会自动发起模型调用。</p>${model.prompts.map(p => `<details class="growth-details"><summary>${esc(p.title)}</summary><textarea rows="5" readonly aria-label="${esc(p.title)}指令">${esc(p.text)}</textarea></details>`).join('')}</section>`; }
function filterCards(root) {
  const query = (root.querySelector('#growth-search')?.value || '').trim().toLowerCase(), kind = root.querySelector('#growth-kind')?.value || '', archived = root.querySelector('#growth-show-archived')?.checked;
  let n = 0; root.querySelectorAll('[data-growth-card]').forEach(row => { row.hidden = (!archived && row.dataset.archived === 'true') || (!!kind && row.dataset.kind !== kind) || (!!query && !row.dataset.search.includes(query)); if (!row.hidden) n++; });
  const empty = root.querySelector('#growth-card-empty'); if (empty) empty.hidden = n > 0;
}
function paint(root, notice = '', isError = false) {
  if (!root.isConnected) return;
  const tab = tabFor();
  root.innerHTML = `${model.preview ? '<aside class="growth-warning" role="status">隔离演示：此处记录不进入正式工作台台账。正式服务重启后，从3780端口进入使用。</aside>' : ''}<header class="growth-hero"><div><div class="growth-eyebrow">WORKBENCH V9 · PROFESSIONAL GROWTH</div><h2>让每一次实践，长成判断力。</h2><p>管理能力与造价业务双线成长，保留学习、证据与思考。</p></div><span class="growth-seal" aria-hidden="true">学<br>以致用</span></header>
    <nav class="growth-tabs" aria-label="履职成长分类">${[['overview', 'growth', '成长概览'], ['plan', 'growth-plan', '八周路径'], ['cards', 'growth-cards', '工具卡片'], ['sources', 'growth-sources', '资料与指令']].map(([id, route, label]) => `<a href="#learn/${route}" ${tab === id ? 'aria-current="page"' : ''}>${label}</a>`).join('')}<a href="#learn/all">原有学习计划 ↗</a></nav>
    <div id="growth-message" role="${isError ? 'alert' : 'status'}" class="${isError ? 'growth-warning' : 'growth-notice'}" ${notice ? '' : 'hidden'}>${esc(notice)}</div>
    ${tab === 'plan' ? planView() : tab === 'cards' ? cardsView() : tab === 'sources' ? sourcesView() : overview()}`;
  filterCards(root);
}
function message(root, error) { const node = root.querySelector('#growth-message'); if (!node) return; node.hidden = false; node.className = 'growth-warning'; node.setAttribute('role', 'alert'); node.textContent = errorText(error); node.scrollIntoView({ block: 'nearest' }); }
function openDraft(kind, values = {}) {
  selected = 'new-' + kind;
  if (Object.keys(values).length) drafts[selected] = { kind, title: '', body: model.templates.find(t => t.kind === kind).body, week: '1', mastery: '0', requestId: crypto.randomUUID(), sourceStatus: 'unverified', ...values };
  remember(); location.hash = '#learn/growth-cards';
  const root = document.getElementById('growth-root'); if (root && tabFor() === 'cards') paint(root);
}
async function refresh(root, notice) { model = await api('/api/growth'); setStore(await api('/api/state')); paint(root, notice); }
export async function mountGrowth() {
  const root = document.getElementById('growth-root'); if (!root || root.dataset.mounted) return; root.dataset.mounted = 'true';
  try { model = await api('/api/growth'); if (!root.isConnected) return; paint(root); }
  catch (error) { root.innerHTML = `<p role="alert">${error.message.includes('not_found') ? 'V9页面已安装，原后台服务尚未加载新接口。需要重启正式服务后使用。' : esc(errorText(error))}</p><p><a href="http://127.0.0.1:3790/#learn/growth">打开V9隔离演示（记录与正式台账分开） →</a></p><button type="button" onclick="location.reload()">重新载入</button>`; return; }
  root.addEventListener('input', e => { if (e.target.closest('#growth-card-form')) capture(e.target.closest('form')); if (e.target.id === 'growth-search') filterCards(root); if (e.target.closest('#growth-activate')) { drafts.activation = { startDate: e.target.value }; remember(); } });
  root.addEventListener('change', async e => {
    if (e.target.closest('#growth-card-form')) capture(e.target.closest('form'));
    if (['growth-kind', 'growth-show-archived'].includes(e.target.id)) filterCards(root);
    if (!e.target.matches('[data-growth-session]') || busy) return;
    busy = true; e.target.disabled = true;
    try { await api('/api/growth/sessions/' + encodeURIComponent(e.target.dataset.growthSession), { method: 'PATCH', body: { done: e.target.checked, expectedRevision: model.plan.revision } }); busy = false; await refresh(root, '学习安排已保存；理解与复核证据在工具卡片中记录。'); }
    catch (error) { e.target.checked = !e.target.checked; message(root, error); }
    finally { busy = false; e.target.disabled = false; }
  });
  root.addEventListener('click', async e => {
    const button = e.target.closest('[data-growth]'); if (!button || busy) return;
    const action = button.dataset.growth;
    if (action === 'new') return openDraft(button.dataset.kind);
    if (action === 'edit') { selected = button.dataset.id; remember(); paint(root); root.querySelector('#growth-card-form')?.scrollIntoView({ block: 'start' }); return; }
    if (action === 'reset') {
      if (!window.confirm('重新载入最新保存版本，并替换当前卡片草稿？')) return;
      const key = selected; busy = true; button.disabled = true;
      try { model = await api('/api/growth'); delete drafts[key]; remember(); busy = false; if (selected === key) paint(root); }
      catch (error) { message(root, error); } finally { busy = false; button.disabled = false; }
      return;
    }
    if (action === 'source') { const s = model.sources[Number(button.dataset.index)]; const key = 'new-concept'; if (drafts[key] && !window.confirm('用此资料创建新的阅读草稿？当前未保存的概念草稿会被替换。')) return; return openDraft('concept', { title: s.title, sourceTitle: s.title, sourceUrl: s.url, sourceVersion: s.published, sourceStatus: 'entry' }); }
    busy = true; button.disabled = true;
    try {
      if (action === 'archive') { const card = model.cards.find(c => c.id === button.dataset.id); const response = await api('/api/growth/cards/' + encodeURIComponent(card.id) + '/archive', { method: 'PATCH', body: { expectedRevision: card.revision, archived: !card.archived } }); if (drafts[card.id]) { drafts[card.id].expectedRevision = response.result.revision; remember(); } busy = false; await refresh(root, card.archived ? '卡片已恢复，编辑草稿仍保留。' : '卡片已归档，编辑草稿仍保留；勾选“显示已归档”可恢复。'); }
      if (action === 'weekly') { if (drafts['new-weekly'] && !window.confirm('用当前记录生成新的一页纸草稿？未保存的周总结草稿会被替换。')) return; const draft = await api('/api/growth/weekly-draft?week=' + button.dataset.week); busy = false; openDraft('weekly', draft); }
    } catch (error) { message(root, error); } finally { busy = false; button.disabled = false; }
  });
  root.addEventListener('submit', async e => {
    const form = e.target; if (!['growth-activate', 'growth-card-form'].includes(form.id)) return; e.preventDefault(); if (busy) return;
    busy = true; const submit = form.querySelector('[type=submit]'); submit.disabled = true;
    const editable = [...form.querySelectorAll('input,textarea,select')].filter(node => !node.disabled);
    try {
      if (form.id === 'growth-activate') { await api('/api/growth/activate', { method: 'POST', body: { startDate: new FormData(form).get('startDate') } }); busy = false; await refresh(root, '八周计划已采纳。可以前往“八周路径”开始。'); }
      else { capture(form); const key = selected, d = { ...drafts[key] }; const old = model.cards.find(c => c.id === key);
        editable.forEach(node => { node.disabled = true; });
        const result = await api('/api/growth/cards' + (old ? '/' + encodeURIComponent(old.id) : ''), { method: old ? 'PATCH' : 'POST', body: d });
        const returned = result.result;
        const priorSave = !old && (['title', 'body', 'sourceTitle', 'sourceUrl', 'sourceVersion', 'locator', 'evidence', 'reviewer', 'reviewNote', 'sourceStatus', 'relatedTaskId', 'relatedAgendaId'].some(field => String(d[field] || '').trim() !== String(returned[field] || '')) || Number(d.week) !== returned.week || Number(d.mastery || 0) !== returned.mastery);
        delete drafts[key]; selected = returned.id;
        if (priorSave) drafts[selected] = { ...d, expectedRevision: returned.revision };
        remember(); busy = false; await refresh(root, priorSave ? '上次保存已确认。之后的改动仍保留为草稿，请核对后再次保存。' : returned.reviewInvalidated ? '卡片已保存。内容变更后旧复核留在历史，本版需要重新核对。' : '卡片已保存，原有任务和行程进度保持各自记录。'); }
    } catch (error) { message(root, error); } finally { busy = false; submit.disabled = false; editable.forEach(node => { node.disabled = false; }); }
  });
}
