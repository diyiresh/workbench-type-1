import { t as tr } from './i18n.js';
const states = new Map(), delivered = new Set();
let config = null, timer = null, mountId = 0, selected = 'codex';
try { const value = localStorage.getItem('wb-report-member'); if (['codex','cursor','workbuddy'].includes(value)) selected = value; } catch {}
const identity = (view, date) => {
  if (view === 'month') return 'month:' + date.slice(0,7);
  if (view === 'week') { const d = new Date(date + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - (d.getUTCDay() || 7) + 1); return 'week:' + d.toISOString().slice(0,10); }
  return 'day:' + date;
};
const message = error => { try { return JSON.parse(error.message).error || error.message; } catch { return error.message; } };
function saveState(key, state) { states.set(key, state); if (state.job) try { localStorage.setItem('wb-report-job:' + key, state.job.id); } catch {} }
function paint() {
  const output = document.getElementById('agenda-report-status'), button = document.querySelector('[data-act="agenda-report-draft"]'), selector = document.getElementById('agenda-report-agent');
  if (!output || !config || !selector) return;
  const state = states.get(config.key), job = state?.job;
  const busy = state?.submitting || ['waiting','doing'].includes(job?.status);
  button.disabled = !!busy; selector.disabled = !!busy; selector.value = busy && job ? job.agentId : selected;
  const labels = { waiting: tr('等待成员领取'), doing: tr('成员生成中'), done: tr('报告草稿已返回'), failed: tr('生成失败'), uncertain: tr('执行结果不确定，请先核对旧会话。'), interrupted: tr('等待领取已到期，未自动重发。'), held: tr('旧报告已暂存，未写入报告库'), cancelled: tr('旧执行已核对，未采纳其成果。') };
  output.replaceChildren();
  if (!state) return;
  const text = document.createElement('p'); text.textContent = state.error || (state.submitting ? tr('正在提交报告任务…') : job ? `${job.agentId} · ${labels[job.status] || job.status}` : ''); output.append(text);
  if (job?.agentId === 'workbuddy' && job.status === 'waiting') { const p = document.createElement('p'); p.textContent = tr('沿用现有每小时领取任务；本操作不改变 WorkBuddy 定时设置。'); output.append(p); }
  if (job?.error) { const p = document.createElement('p'); p.textContent = job.error; output.append(p); }
  if (job?.heldDraft && !config.hasDraft()) {
    const recover = document.createElement('button'); recover.type='button'; recover.className='tiny'; recover.textContent=tr('恢复已生成草稿');
    recover.onclick=()=>config.onDraft(job.heldDraft); output.append(recover);
  }
  const operation = ['uncertain','held'].includes(job?.status) ? 'reconcile' : ['failed','interrupted','cancelled'].includes(job?.status) ? 'retry' : null;
  if (operation) {
    const action = document.createElement('button'); action.type = 'button'; action.className = 'tiny'; action.disabled = !!state.submitting;
    action.textContent = operation === 'reconcile' ? tr('核对旧执行') : tr('明确重试一次');
    action.onclick = () => act(operation); output.append(action);
  }
}
function accept(key, job) {
  if (job.workType === 'review-note' || job.sourceMode === 'saved-reviews') return;
  saveState(key, { job, submitting: false });
  if (config?.key !== key) return;
  paint();
  const token = job.id + ':' + job.attemptId;
  if (job.status === 'done' && job.draft && !delivered.has(token) && !config.savedJobIds.includes(job.id) && !config.hasDraft()) {
    delivered.add(token); config.onDraft(job.draft);
  }
}
async function poll(key, id, generation) {
  try {
    const { job } = await config.api(`/api/agenda/reports/jobs/${encodeURIComponent(id)}`);
    if (generation !== mountId || config?.key !== key) return;
    accept(key, job);
    if (['waiting','doing'].includes(job.status)) timer = setTimeout(() => poll(key,id,generation), 2000);
  } catch (error) {
    if (generation !== mountId || config?.key !== key) return;
    saveState(key, { ...states.get(key), error: message(error) }); paint();
    if (['waiting','doing'].includes(states.get(key)?.job?.status)) timer = setTimeout(() => poll(key,id,generation),5000);
  }
}
export function mountAgendaReports(options) {
  clearTimeout(timer); mountId++;
  if (!document.getElementById('agenda-report-agent')) { config = null; return; }
  const key = identity(options.view, options.anchorDate);
  config = { ...options, key };
  const selector = document.getElementById('agenda-report-agent'); selector.value = selected;
  selector.onchange = () => { selected = selector.value; try { localStorage.setItem('wb-report-member',selected); } catch {} };
  let state = states.get(key), id = state?.job?.id;
  if (!id) {
    const candidate = options.jobs.find(j => j.workType !== 'review-note' && j.sourceMode !== 'saved-reviews' && identity(j.view,j.anchorDate) === key && !j.archived && !options.savedJobIds.includes(j.id));
    id = candidate?.id;
    if (!id) try { id = localStorage.getItem('wb-report-job:' + key); } catch {}
  }
  paint();
  if (id) void poll(key,id,mountId);
}
export async function startAgendaReport({ confirmedReplace = false } = {}) {
  if (!config) return;
  const c = config, state = states.get(c.key);
  if (state?.submitting || ['waiting','doing'].includes(state?.job?.status)) return;
  if (c.hasDraft() && !confirmedReplace && !window.confirm(tr('当前报告草稿尚未保存，重新生成将替换草稿。继续？'))) return;
  const requestKey = `wb-report-request:${c.key}:${selected}`;
  let idempotencyKey;
  try { idempotencyKey = localStorage.getItem(requestKey); } catch {}
  idempotencyKey ||= crypto.randomUUID();
  try { localStorage.setItem(requestKey,idempotencyKey); } catch {}
  saveState(c.key, { submitting:true }); paint();
  try {
    const { job } = await c.api('/api/agenda/reports/draft', { method:'POST', signal:AbortSignal.timeout(15000), body:{view:c.view,anchorDate:c.anchorDate,agentId:selected,idempotencyKey} });
    try { localStorage.removeItem(requestKey); } catch {}
    if (config?.key === c.key) c.clearDraft(); accept(c.key,job);
    if (config?.key === c.key) void poll(c.key,job.id,mountId);
  } catch(error) { saveState(c.key,{submitting:false,error:message(error)}); if(config?.key===c.key)paint(); }
}
async function act(operation) {
  const c = config, state = states.get(c.key), job = state?.job;
  if (!job || state.submitting) return;
  const body = { idempotencyKey: crypto.randomUUID(), attemptId:job.attemptId, resultHash:job.resultHash, confirmed:true };
  if (operation === 'reconcile') {
    if (!window.confirm(tr('请先确认旧成员会话已经停止；本操作不采纳旧成果，也不会自动重试。'))) return;
    const evidence = window.prompt(tr('请填写核对旧会话已停止的依据。'));
    if (!evidence?.trim()) return;
    Object.assign(body,{stopped:true,evidence,resolution:'do-not-apply'});
  }
  state.submitting = true; paint();
  try {
    const { job:next } = await c.api(`/api/agenda/reports/jobs/${job.id}/${operation}`,{method:'POST',body});
    accept(c.key,next); if(config?.key===c.key&&['waiting','doing'].includes(next.status))void poll(c.key,next.id,mountId);
  } catch(error) { state.submitting=false;state.error=message(error);if(config?.key===c.key)paint(); }
}
