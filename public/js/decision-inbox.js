import { api, esc, fmt } from './core.js';
import { t as tr } from './i18n.js';

// Everything waiting on the chairman, read from GET /api/decisions. Each entry links to where the
// decision is made; nothing here approves, retries or starts a member.
const KIND = {
  reconcile: '待核对', held_result: '迟到成果', start_writing: 'Start Writing', budget_exhausted: '重试预算用尽',
  delivery_failed: '交付失败', review_waiting: '待复核', automation_paused: '已暂停', chat_failed: '群聊失败',
  task_review: '待核验', task_blocked: '任务受阻', report_ready: '报告待确认',
};

export function decisionInboxShell(mode = 'full') {
  return `<section class="card decision-inbox" data-decision-inbox="${mode}" aria-live="polite"><p class="k">${tr('正在读取待决事项…')}</p></section>`;
}

function row(d, compact) {
  const title = `<b>${esc(d.title || '')}</b>`;
  const meta = `<span class="decision-kind decision-${esc(d.severity)}">${esc(tr(KIND[d.kind] || d.kind))}</span>`;
  if (compact) return `<a class="v8-decision" href="${esc(d.href)}">${title}<small>${meta} ${esc(tr(d.detail))}</small></a>`;
  return `<a class="decision-row" href="${esc(d.href)}" data-decision="${esc(d.id)}">${meta}<span>${title}<small>${esc(tr(d.detail))}</small></span><time>${d.at ? esc(fmt(d.at)) : ''}</time></a>`;
}

export async function mountDecisionInbox() {
  const hosts = [...document.querySelectorAll('[data-decision-inbox]')];
  if (!hosts.length) return;
  let list;
  try { list = (await api('/api/decisions')).decisions || []; }
  catch (error) { hosts.forEach(h => { h.innerHTML = `<p class="k">${esc(tr('待决事项读取失败：') + error.message)}</p>`; }); return; }
  for (const host of hosts) {
    if (!host.isConnected) continue;
    const compact = host.dataset.decisionInbox === 'compact';
    if (compact) {
      host.innerHTML = list.length
        ? list.slice(0, 4).map(d => row(d, true)).join('') + (list.length > 4 ? `<a href="#home/decisions">${tr('更多待决')} · ${list.length - 4} →</a>` : '')
        : `<p>${tr('当前没有等待你决定的事项。')}</p>`;
      continue;
    }
    host.innerHTML = `<div class="v8-heading"><h2>${tr('待你决定')}</h2><span class="k">${list.length}</span></div><p class="k">${tr('迟到成果、待核对执行、Start Writing、重试预算、交付失败与待复核集中在这里；点开后在原页面按原流程处理。')}</p>`
      + (list.length ? `<div class="decision-list">${list.map(d => row(d, false)).join('')}</div>` : `<p>${tr('当前没有等待你决定的事项。')}</p>`);
  }
}
