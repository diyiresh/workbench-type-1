import { t as tr, ui } from './i18n.js';
const commands = new Map();
const states = { waiting: '等待成员领取', doing: '成员正在生成', done: '成员已返回草稿', failed: '成员执行失败', interrupted: '执行已中断，未自动重发', uncertain: '请先核对旧成员会话', held: '来源已变化，旧结果未替换草稿', cancelled: '旧执行已核对，未采纳成果' };
export function mountNoteMembers(panel, item, api, applyRecovered) {
  const area = panel.querySelector('[data-note-member-panel]');
  area.innerHTML = ui`<label>摘要生成成员<select data-note-member><option value="codex">Codex</option><option value="cursor">Cursor</option><option value="workbuddy">WorkBuddy</option></select></label><p data-note-job-status role="status"></p><div class="actions"><button type="button" class="ghost" data-note-job-restore hidden>恢复成员草稿</button><button type="button" class="ghost" data-note-job-reconcile hidden>核对旧会话已停止</button></div>`;
  const member = area.querySelector('[data-note-member]'), status = area.querySelector('[data-note-job-status]');
  const restore = area.querySelector('[data-note-job-restore]'), reconcile = area.querySelector('[data-note-job-reconcile]');
  try { const saved = localStorage.getItem('bench-review-note-member'); if (['codex', 'cursor', 'workbuddy'].includes(saved)) member.value = saved; } catch {}
  member.onchange = () => { try { localStorage.setItem('bench-review-note-member', member.value); } catch {} };
  let job = null, polling = false;
  const attached = () => panel.isConnected && !panel.parentElement.hidden;
  const paint = value => {
    job = value;
    status.textContent = value ? `${value.agentId}: ${tr(states[value.status] || '成员状态未知')}${value.error ? ' · ' + value.error : ''}` : '';
    restore.hidden = !value || !['done', 'waiting', 'doing'].includes(value.status);
    reconcile.hidden = !value || !['uncertain', 'held'].includes(value.status);
  };
  const request = (url, options) => {
    let timer;
    return Promise.race([api(url, options), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(tr('请求超时，未自动重发；可重新打开复盘核对成员状态。'))), 15000); })]).finally(() => clearTimeout(timer));
  };
  async function wait(value) {
    paint(value);
    while (['waiting', 'doing'].includes(value.status)) {
      await new Promise(resolve => setTimeout(resolve, 1500));
      if (!attached()) return null;
      value = (await request(`/api/agenda/reports/jobs/${encodeURIComponent(value.id)}`)).job; paint(value);
    }
    if (!attached()) return null;
    if (value.status !== 'done' || !value.draft) throw new Error(tr(states[value.status] || '成员状态未知') + (value.error ? ' · ' + value.error : ''));
    return value.draft;
  }
  restore.onclick = async () => {
    if (polling || !job) return;
    if (!window.confirm(tr('恢复成员草稿会替换当前摘要，请先保留尚未保存的修改。继续？'))) return;
    polling = true; restore.disabled = true;
    try { const result = await wait((await request(`/api/agenda/reports/jobs/${encodeURIComponent(job.id)}`)).job); if (result) applyRecovered(result); }
    catch (e) { status.textContent = e.message; }
    finally { polling = false; restore.disabled = false; }
  };
  reconcile.onclick = async () => {
    if (polling || !job || !window.confirm(tr('确认旧成员会话已经停止，并放弃采纳其结果？此操作不会自动重试。'))) return;
    const evidence = window.prompt(tr('填写核对旧会话已停止的依据：'));
    if (!evidence?.trim()) return;
    reconcile.disabled = true;
    try { paint((await request(`/api/agenda/reports/jobs/${encodeURIComponent(job.id)}/reconcile`, { method: 'POST', body: { confirmed: true, stopped: true, evidence: evidence.trim(), resultHash: job.resultHash, resolution: 'do-not-apply', idempotencyKey: crypto.randomUUID() } })).job); }
    catch (e) { status.textContent = e.message; }
    finally { reconcile.disabled = false; }
  };
  // Read-only recovery: reopening never starts a new execution or replaces editor content.
  api('/api/agenda/reports/jobs').then(result => {
    if (attached() && !polling && !job) paint((result.jobs || []).find(j => j.workType === 'review-note' && j.agendaId === item.id) || null);
  }).catch(() => {});
  return {
    async generate(operation, input) {
      if (polling) throw new Error(tr('已有成员执行正在核对，请稍候。'));
      const payload = { ...input, agentId: member.value }, signature = JSON.stringify([item.id, operation, payload]);
      if (!commands.has(signature)) commands.set(signature, crypto.randomUUID());
      polling = true; member.disabled = true;
      try {
        const result = await request(`/api/agendas/${encodeURIComponent(item.id)}/review-note/${operation}`, { method: 'POST', body: { ...payload, idempotencyKey: commands.get(signature) } });
        // Older test/adaptor responses may already contain a draft; no API fallback is made.
        if (!result.job) { commands.delete(signature); return result; }
        const draft = await wait(result.job);
        if (draft) commands.delete(signature);
        return draft;
      } catch (e) {
        if (job && ['failed', 'interrupted', 'cancelled', 'held'].includes(job.status)) commands.delete(signature);
        if (e.message.includes('already_claimed')) throw new Error(tr('所选成员正在处理其他任务，请稍后重试或明确选择另一成员。'));
        if (e.message.includes('execution_budget_exhausted')) throw new Error(tr('相同输入已达到三次尝试上限，请先核对已有结果。'));
        if (e.message.includes('workbuddy_paused')) throw new Error(tr('WorkBuddy 调度当前暂停，未派发任务；可选择 Codex 或 Cursor。'));
        if (e.message.includes('runtime_unavailable')) throw new Error(tr('所选成员通道暂不可用，未切换其他通道，请核对登录和运行状态。'));
        throw e;
      } finally { polling = false; member.disabled = false; }
    }
  };
}
