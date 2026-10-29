import { t as tr, ui, systemFragment } from "./i18n.js";
// ============================================================
// views.js — 页面级视图。指挥舱/事业部首页从模块注册表装配；
// 舰队页含全员通告追踪、催报黄灯、指令生命周期。
// ============================================================

import {
  esc, fmt, ymd, getStore, agent, taskById, doing, STATUS, CMD_STATUS,
  activeTasks, progressCard, taskBlock, cmdStatusChip, agentStale, taskStale, taskOverdue, OPS,
} from "./core.js";
import { renderCard, renderDetail } from "../modules/index.js";
import { deliveryView } from './delivery-ui.js';
import { agentEvidence } from './centers.js';
import { executionPanel, conversionButton } from './execution-ui.js';
import { stageDescription } from './compact-layout.js';

// ---------- 指挥舱 / 事业部 ----------

function agendaFor(date) {
  return (getStore().agendas || []).filter((item) => item.date === date);
}

function percent(done, total) {
  return total ? Math.round((done / total) * 100) : 0;
}

export function homeAllView(filter = "all") {
  const s = getStore();
  const tasks = activeTasks();
  const doingNow = tasks.filter((t) => t.status === "doing" || t.status === "review");
  const risks = tasks.filter((t) => t.status === "blocked" || taskOverdue(t) || taskStale(t));
  const agenda = agendaFor(ymd());
  const completed = agenda.filter((x) => x.done).length;
  const members = (s.agents || []).filter(a => a.status === "active" && !a.resumeRequired);
  const groups = { doing: doingNow, today: agenda, risks, members };
  const selected = Object.hasOwn(groups, filter) ? filter : "all";
  const labels = { all: tr("指挥舱模块"), doing: tr("正在推进"), today: tr("今日安排"), risks: tr("需关注"), members: tr("台账启用成员") };
  const stats = [
    ['doing', doingNow.length, tr('跨项目待核验与执行')],
    ['today', agenda.length, ui`${completed} 项完成 · ${percent(completed, agenda.length)}%`],
    ['risks', risks.length, risks.length ? tr('逾期、受阻或未打卡') : tr('当前没有风险灯')],
    ['members', members.length, tr('可从底部指令台直接下达')],
  ].map(([key, count, caption]) => `<button type="button" class="stat overview-stat ${key === 'risks' && count ? 'alert' : ''} ${selected === key ? 'active' : ''}" data-act="overview-filter" data-overview-filter="${key}" aria-pressed="${selected === key}" aria-controls="overview-results"><b>${count}</b><span>${labels[key]}</span><small>${caption}</small></button>`).join('');
  let results = (s.modules || []).map(m => renderCard(m)).join('');
  if (selected !== 'all') {
    results = groups[selected].map(item => {
      let content;
      if (selected === 'today') {
        content = `<div class="msg"><div class="row"><b>${esc(item.time || tr('时间待定'))} · ${esc(item.title)}</b><span class="chip">${item.done ? tr('已完成') : tr('待处理')}</span></div>${item.note ? `<p>${esc(item.note)}</p>` : ''}${item.resumeRequired ? ui`<p>已暂停，需明确继续</p>` : ''}</div>`;
      } else if (selected === 'members') {
        content = `<div class="msg"><div class="row"><b>${esc(item.name)}</b><button type="button" class="tiny" data-cmd="${esc(item.id)}">${tr('指挥')}</button></div><p>${esc(item.role || '')}</p></div>`;
      } else {
        const reasons = selected === 'risks' ? [item.status === 'blocked' ? tr('任务受阻') : '', taskOverdue(item) ? tr('任务逾期') : '', taskStale(item) ? ui`已 ${taskStale(item)}h 无打卡` : ''].filter(Boolean) : [];
        content = taskBlock(item) + (reasons.length ? `<p class="overview-risk-reasons">${reasons.map(esc).join(' · ')}</p>` : '');
      }
      return `<article role="listitem" data-overview-id="${esc(item.id)}">${content}</article>`;
    }).join('') || ui`<p class="agenda-empty">没有符合当前筛选条件的记录。</p>`;
  }
  return ui`<section class="command-hero">
      <div>
        <div class="eyebrow">PERSONAL COMMAND OS · ${esc(tr(s.meta && s.meta.role || "董事长"))}</div>
        <h2>今天，先把注意力给最重要的事。</h2>
        <p>工作台把项目、部门与行程收在同一张本地台账里；AI 只在你确认后参与。</p>
      </div>
      <div class="hero-actions"><button type="button" class="solid" data-primary="agenda">打开每日行程</button><button type="button" class="ghost" data-primary="deck">查看风险雷达</button></div>
    </section>
    <section class="overview-stats" aria-label="今日概况">${stats}</section>
    <div class="section-head"><div><div class="eyebrow">PRIORITY BOARD</div><h2>${labels[selected]}</h2>${selected !== 'all' ? `<p role="status">${tr('当前筛选：')} ${labels[selected]} · ${groups[selected].length} ${tr('条记录')}</p>` : ''}</div><button type="button" class="ghost" data-act="overview-filter" data-overview-filter="all">显示全部模块</button></div>
    ${selected === 'all' ? ui`<p class="overview-filter-hint">拖动卡片可调整关注顺序</p>` : selected === 'members' ? ui`<p class="overview-filter-hint">按台账状态展示，不代表实时在线。</p>` : ''}
    <section id="overview-results" class="${selected === 'all' ? 'mods' : 'overview-result-list'}" data-overview-view="${selected}" ${selected === 'all' ? '' : 'role="list"'}>${results}</section>`;
}

export function moduleDetailView(m) {
  const t = m.taskId ? taskById(m.taskId) : null;
  const body = renderDetail(m);
  const owner = m.ownerAgentId || (t && t.ownerAgentId) || "";
  return `${body}
    ${owner ? ui`<div class="filters" style="margin-top:12px">
      <button type="button" class="solid" data-cmd="${esc(owner)}">给责任部门「${esc(agent(owner).name)}」下达指令</button>
    </div>` : ""}
    ${t && m.type !== "project" ? ui`<div class="h">在办</div>${taskBlock(t)}` : ""}`;
}

// ---------- 跨 Agent 简报中心 ----------

function latestBrief(sourceId, runs) {
  return [...runs]
    .filter((item) => item.sourceId === sourceId)
    .sort((a, b) => new Date(b.completedAt || b.receivedAt) - new Date(a.completedAt || a.receivedAt))[0] || null;
}

function briefHealth(source, runs) {
  const latest = latestBrief(source.id, runs);
  if (!latest) return { label: tr("待首份"), cls: "", latest: null };
  const age = Math.max(0, (Date.now() - new Date(latest.completedAt || latest.receivedAt).getTime()) / 3.6e6);
  return age > (Number(source.maxAgeHours) || 36)
    ? { label: ui`迟到 · ${Math.floor(age)}h`, cls: "warn", latest }
    : { label: tr("正常"), cls: "ok", latest };
}

function safeWebUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
  } catch (_) {
    return "";
  }
}

function briefRunCard(run, source, busy = false) {
  const href = safeWebUrl(run.sourceUrl || "");
  const origin = href
    ? ui`<a class="tiny brief-origin" href="${esc(href)}" target="_blank" rel="noreferrer">打开原始链接</a>`
    : run.sourcePath ? ui`<span class="chip" title="${esc(run.sourcePath)}">文件：${esc(run.sourcePath)}</span>` : "";
  return `<details class="brief-run ${run.unread !== false ? "unread" : ""}" data-brief-id="${esc(run.id)}" aria-busy="${busy}" ${run.unread !== false ? "open" : ""}>
    <summary>
      <span><small>${esc((source && source.platform) || run.agentId || "Agent")} · ${fmt(run.completedAt || run.receivedAt)}</small><b>${esc(run.title)}</b></span>
      <span class="chip ${run.unread !== false ? "doing" : ""}">${run.unread !== false ? tr("未读") : tr("已读")}</span>
    </summary>
    <div class="brief-run-body">${esc(run.body)}</div>
    <div class="brief-run-actions">${origin}${run.unread !== false ? ui`<button type="button" class="tiny" data-act="brief-read" data-id="${esc(run.id)}" ${busy ? "disabled" : ""}>标记已读</button>` : ""}<button type="button" class="tiny brief-favorite ${run.favorite === true ? "active" : ""}" data-act="brief-favorite" data-id="${esc(run.id)}" aria-pressed="${run.favorite === true}" ${busy ? "disabled" : ""}>${run.favorite === true ? tr("取消收藏") : tr("收藏")}</button></div>
  </details>`;
}

export function briefHubView(sourceId = "all", filter = "all", busyIds = new Set()) {
  const s = getStore();
  const sources = (s.briefSources || []).filter((item) => item.enabled !== false);
  const allRuns = [...(s.briefRuns || [])].sort((a, b) => new Date(b.completedAt || b.receivedAt) - new Date(a.completedAt || a.receivedAt));
  const selectedFilter = ["all", "today", "unread", "favorite"].includes(filter) ? filter : "all";
  const isToday = item => {
    const d = new Date(item.completedAt || item.receivedAt);
    return !Number.isNaN(d.getTime()) && ymd(d) === ymd();
  };
  const predicates = { all: () => true, today: isToday, unread: item => item.unread !== false, favorite: item => item.favorite === true };
  const runs = allRuns.filter(item => (sourceId === "all" || item.sourceId === sourceId) && predicates[selectedFilter](item));
  const unread = allRuns.filter((item) => item.unread !== false).length;
  const today = allRuns.filter(isToday).length;
  const favorite = allRuns.filter(item => item.favorite === true).length;
  const filterLabels = { all: tr("全部简报"), today: tr("今日到件"), unread: tr("未读简报"), favorite: tr("收藏的简报") };
  const statsHtml = [
    ["all", sources.length, tr("简报来源"), tr("可继续动态增加")],
    ["today", today, filterLabels.today, tr("以完成时间统计")],
    ["unread", unread, filterLabels.unread, tr("阅读后可单独标记")],
    ["favorite", favorite, filterLabels.favorite, tr("收藏后可集中查看")],
  ].map(([key, count, label, caption]) => `<button type="button" class="stat brief-stat ${sourceId === "all" && selectedFilter === key ? "active" : ""}" data-act="brief-filter" data-brief-filter="${key}" aria-pressed="${sourceId === "all" && selectedFilter === key}" aria-controls="brief-results"><b>${count}</b><span>${label}</span><small>${caption}</small></button>`).join("");
  const sourceCards = sources.map((source) => {
    const health = briefHealth(source, allRuns);
    return ui`<button type="button" class="brief-source-card ${health.cls === "warn" ? "stale" : ""} ${sourceId === source.id ? "active" : ""}" data-act="brief-source" data-source-id="${esc(source.id)}" aria-pressed="${sourceId === source.id}" aria-controls="brief-results">
      <span class="row"><span class="eyebrow">${esc(source.platform)}</span><span class="chip ${health.cls}">${esc(health.label)}</span></span>
      <span class="brief-source-name">${esc(source.name)}</span><span class="brief-source-schedule">${esc(source.scheduleLabel || tr("按外部 Agent 设置"))}</span>
      <span class="brief-source-foot"><small>${health.latest ? ui`最近 ${fmt(health.latest.completedAt || health.latest.receivedAt)}` : tr("尚未收到")}</small><span class="tiny">查看</span></span>
    </button>`;
  }).join("");
  const selected = sources.find((item) => item.id === sourceId);
  const empty = selectedFilter !== "all" ? ui`<div class="agenda-empty">没有符合当前筛选条件的简报。</div>` : ui`<div class="agenda-empty">尚未收到该来源的简报。可在设置页复制统一投递格式。</div>`;
  return ui`<section class="command-hero brief-hero"><div><div class="eyebrow">BRIEFING HUB · 单一收件箱</div><h2>各 Agent 各自工作，成果回到一处。</h2><p>保留 ChatGPT 与 WorkBuddy 的原始正文；工作台负责收件、去重、迟到提示和开屏汇总。</p></div><div class="hero-actions"><a class="solid" href="#set/all">查看投递说明</a></div></section>
    <section class="overview-stats brief-stats">${statsHtml}</section>
    <div class="section-head"><div><div class="eyebrow">SOURCES</div><h2>来源状态</h2></div><span>Agent 负责生成，工作台负责归集</span></div>
    <section class="brief-source-grid">${sourceCards}</section>
    <div class="section-head"><div><div class="eyebrow">RUNS</div><h2>${selected ? esc(selected.name) : filterLabels[selectedFilter]}</h2></div><span role="status">${runs.length} 份</span></div>
    <section class="brief-run-list" id="brief-results">${runs.length ? runs.map((run) => briefRunCard(run, sources.find((source) => source.id === run.sourceId), busyIds.has(run.id))).join("") : empty}</section>`;
}

// ---------- 经营秘书 ----------

export function opsView(kind, secondaryName) {
  if (kind === "today") {
    const s = getStore();
    const plan = (s.plans || [])[0];
    const slot =
      (plan && (plan.slots || []).find((x) => x.date === ymd())) ||
      (plan && plan.slots && plan.slots[0]) || { day: tr("今日"), items: [] };
    return ui`<div class="card"><div class="k">${esc((plan && plan.title) || "")}</div>
        <div class="h">${esc(slot.day)} · ${esc(slot.date || "")}</div>
        <ul>${(slot.items || []).map((i) => `<li>${esc(i)}</li>`).join("")}</ul>
        <p>${esc((plan && plan.focus) || "")}</p></div>
      <div class="h">在办</div>${doing().map(taskBlock).join("")}`;
  }
  const s = getStore();
  const reports = (s.reports || []).filter((r) => r.kind === kind);
  const cur = reports[0];
  return ui`<p class="k"><a href="#agenda/all">每日行程</a> · <a href="#reports/all">工作报告</a></p><div class="filters">
      <button type="button" class="solid" data-act="gen" data-kind="${esc(kind)}">生成${esc(secondaryName || kind)}</button>
    </div>
    ${cur
      ? ui`${cur.status==='historical-draft' ? ui`<p class="report-historical-status">历史草稿：来源已变化，未作为最新事实确认。</p>` : ''}${cur.obsidianFile ? ui`<p>已登记的 Obsidian 文件：<code style="white-space:normal;overflow-wrap:anywhere">${esc(cur.obsidianFile.path)}</code></p><p class="k">修改报告库正文不会覆盖已导出的版本。</p>` : ''}<textarea class="full" id="report-body" style="min-height:280px">${esc(cur.body)}</textarea>
         <div class="actions" style="margin-top:8px"><button type="button" class="ghost" data-act="save-report" data-id="${esc(cur.id)}">保存人话</button></div>`
      : ui`<div class="card">还没有这份文件。点上方生成初稿。</div>`}
    <div class="k" style="margin-top:16px">历史</div>
    ${reports
      .slice(1)
      .map((r) => `<div class="msg"><b>${esc(r.title)}</b>${r.status==='historical-draft'?`<span class="chip">${tr('历史草稿')}</span>`:''}<div class="who">${fmt(r.createdAt)}</div></div>`)
      .join("")}`;
}

// ---------- 舰队 ----------

function broadcastGroups() {
  const groups = new Map();
  for (const m of getStore().inbox || []) {
    if (!m.broadcastId) continue;
    if (!groups.has(m.broadcastId)) {
      groups.set(m.broadcastId, { id: m.broadcastId, body: m.body, at: m.createdAt, items: [] });
    }
    groups.get(m.broadcastId).items.push(m);
  }
  return [...groups.values()];
}

export function crewAllView() {
  const s = getStore();
  const digestTasks = (id) =>
    (s.tasks || []).filter((t) => t.ownerAgentId === id || (t.helperAgentIds || []).includes(id));
  const bcs = broadcastGroups().slice(0, 5);
  return ui`<div class="filters"><button type="button" class="solid" data-act="sync">刷新台账状态</button></div><p class="k">刷新只读取现有记录，不联系成员、不修改同步时间、不恢复执行。</p>
    ${
      bcs.length
        ? ui`<div class="h">全员通告</div>${bcs
            .map(
              (bc) => ui`<div class="msg">
                <div class="who">📣 全员 · ${fmt(bc.at)}</div>
                <div>${esc(bc.body)}</div>
                <div class="meta">${bc.items
                  .map(
                    (i) =>
                      `<span class="chip ${i.status === "queued" ? "" : "ok"}">${esc(agent(i.toAgentId).name)} · ${
                        tr(CMD_STATUS[i.status] || i.status)
                      }</span>`
                  )
                  .join("")}</div>
              </div>`
            )
            .join("")}`
        : ""
    }
    <div class="mods">${(s.agents || [])
      .map((a) => {
        const mine = digestTasks(a.id);
        const qn = (s.inbox || []).filter((m) => m.toAgentId === a.id && m.status === "queued").length;
        const stale = agentStale(a);
        return ui`<article class="card">
          <div class="row"><div class="h">${esc(a.name)}</div><span class="chip ${a.status === "active" ? "ok" : ""}">${
          a.status === "active" ? tr("台账启用") : tr("台账待命")
        }</span></div>
          <p>${esc(a.role)} · ${esc(a.surface)}</p>
          <p>${esc(a.strength)}</p>${agentEvidence(a.id)}
          <div class="meta">
            <span class="chip">相关 ${mine.length}</span>
            <span class="chip">待领 ${qn}</span>
            <span class="chip">历史同步记录 ${fmt(a.lastSync)}</span>
            ${stale ? ui`<span class="chip warn">历史同步距今 ${stale}h</span>` : ""}
            <button type="button" class="tiny" data-cmd="${esc(a.id)}">指挥</button>
          </div>
        </article>`;
      })
      .join("")}</div>`;
}

export function agentDetailView(a) {
  const s = getStore();
  const mine = (s.tasks || []).filter(
    (t) => t.ownerAgentId === a.id || (t.helperAgentIds || []).includes(a.id)
  );
  const msgs = (s.inbox || []).filter((m) => m.toAgentId === a.id);
  const stale = agentStale(a);
  return ui`${progressCard(a.name, mine[0] ? mine[0].progress : 0, a.strength, a.role)}
    ${
      stale
        ? ui`<div class="msg"><span class="chip warn">历史同步距今 ${stale}h；执行通道状态单独核实。</span></div>`
        : ""
    }
    <div class="h">在办</div>${mine.map(taskBlock).join("") || systemFragment("<p>暂无</p>")}
    ${agentEvidence(a.id)}<p class="k">普通指令只登记到收件箱；正式项目任务通过执行通道领取。</p><div class="h">指令追踪</div>
    ${
      msgs.slice(0, 12).map((m) => ui`<div class="msg">
        <div class="who">董事长 → ${esc(a.name)} · ${fmt(m.createdAt)}${m.broadcast ? tr(" · 全员通告") : ""}</div>
        <div>${esc(m.body)}</div>
        <div class="meta">${!m.departmentItemId && m.status === "queued" ? ui`<span class="chip">已登记／等待成员读取</span>` : cmdStatusChip(m)}${
          m.status !== "queued" && m.ackAt ? ui`<span class="chip">收悉于 ${fmt(m.ackAt)}</span>` : ""
        }${m.doneAt ? ui`<span class="chip ok">完成于 ${fmt(m.doneAt)}</span>` : ""}${conversionButton(m)}</div>
      </div>`).join("") || systemFragment("<p>还没下过指令。</p>")
    }
    <p class="k">指令状态由对方按 AGENTS.md 推进：queued → ack → doing → done。</p>
    <div class="h">最近动态</div>
    ${(s.events || [])
      .filter((e) => e.agentId === a.id)
      .slice(0, 8)
      .map((e) => `<div class="msg"><div class="who">${fmt(e.createdAt)}</div>${esc(e.text)}</div>`)
      .join("")}`;
}

// ---------- 虚拟部门：主管 → 执行 → 独立复核 → 整合 ----------

const DEPARTMENT_STATUS = {
  blocked: "等待前置", queued: "待启动", doing: "执行中", review: "待复核", rework: "返工中", done: "已完成",
};

function departmentItemCard(run, item) {
  const codexJob = (getStore().codexJobs || []).find(j => j.runId === run.id && j.role === item.role);
  const codexBusy = codexJob && codexJob.status === "doing";
  const actionable = ["queued", "doing", "rework"].includes(item.status);
  const done = item.status === "done";
  const owner = agent(item.ownerAgentId);
  return ui`<article class="card department-stage ${done ? "stage-done" : ""}">
    <div class="row"><div><div class="eyebrow">${esc(item.role.toUpperCase())}</div><div class="h">${esc(tr(item.label))}</div></div><span class="chip ${done ? "ok" : actionable ? "doing" : ""}">${esc(tr(DEPARTMENT_STATUS[item.status] || item.status))}</span></div>
    ${stageDescription(run, item)}
    ${["director", "reviewer", "secretary"].includes(item.role) && item.ownerAgentId === "codex" ? `<div class="actions"><button type="button" class="solid" data-act="codex-run" data-run-id="${esc(run.id)}" data-role="${esc(item.role)}" ${item.status !== "queued" || codexBusy ? "disabled" : ""}>${codexBusy ? tr("Codex 总管工作中…") : item.role === "director" ? tr("交给 Codex 总管拆解") : item.role === "secretary" ? tr("交给 Codex 最终整合") : tr("交给 Codex 独立复核")}</button></div><p class="k">${codexJob ? esc(codexJob.status === "failed" ? codexJob.error : codexJob.status === "done" ? tr("Codex 成果已自动保存") : tr("可切换页面，成果自动保存")) : tr("使用已登录的 ChatGPT 权益；请只提供已脱敏内容。")}</p>` : ""}
    <div class="meta"><span class="chip">承办：${esc(owner.name)}</span><span class="chip">引擎：${esc(["cursor", "workbuddy"].includes(item.ownerAgentId) ? tr("外部成员领取执行") : item.engine === "current-model" ? tr("待真实执行通道") : item.engine)}</span><span class="chip">执行 ${Number(item.attempts || 0)} 次</span></div>
    ${item.review && item.review.verdict === "reject" ? stageDescription(run, item, 'review') : ""}
    ${item.output ? ui`<details class="department-output" ${done ? "" : "open"}><summary>查看阶段成果</summary><pre class="report">${esc(item.output)}</pre></details>` : ""}
    ${(item.materials || []).length ? `<div class="meta">${item.materials.map((path) => ui`<span class="chip" title="${esc(path)}">材料：${esc(path)}</span>`).join("")}</div>` : ""}
    ${actionable ? ui`<div class="actions department-actions"><button type="button" class="ghost" data-act="department-manual" data-run-id="${esc(run.id)}" data-item-id="${esc(item.id)}">人工 / 外部 Agent 回填</button></div>` : ""}
  </article>`;
}

export function projectMenu(run) {
  const button = (operation, text) => `<button type="button" data-act="project-manage" data-run-id="${esc(run.id)}" data-operation="${operation}">${text}</button>`;
  return ui`<details class="project-menu"><summary aria-label="项目操作">…</summary><div popover="manual" data-project-menu-panel>${button("pin", run.pinned ? tr("取消置顶") : tr("置顶"))}${button("rename", tr("重命名"))}${button("archive", run.archived ? tr("取消归档") : tr("归档"))}${button("delete", tr("删除"))}</div></details>`;
}

function roomMessage(message) {
  const profiles = {
    codex: { side: 'left', tone: 'codex', avatar: 'C', name: 'ChatGPT Codex' },
    workbuddy: { side: 'right', tone: 'workbuddy', avatar: 'W', name: 'WorkBuddy' },
    cursor: { side: 'left', tone: 'cursor', avatar: 'Cu', name: 'Cursor' },
    chairman: { side: 'right', tone: 'chairman', avatar: tr('我'), name: tr('董事长（你）') },
  };
  const profile = profiles[message.sender] || { side: 'left', tone: 'other', avatar: (agent(message.sender).name || '?').slice(0, 1), name: agent(message.sender).name || message.sender };
  const types = { goal: tr('目标'), task_assignment: tr('任务派发'), ack: tr('已领取'), progress: tr('进展'), suggestion: tr('建议'), question: tr('待确认'), blocker: tr('阻塞'), artifact: tr('成果'), review: tr('复核'), decision: tr('总管建议'), system: '系统提示' };
  const text = String(message.text || '');
  const long = text.length > 700 || text.split('\n').length > 12;
  let content = long ? ui`<details class="chat-long" data-message-id="${esc(message.id)}"><summary><span class="chat-preview">${esc(text.split("\n").slice(0, 5).join("\n").slice(0, 240))}…</span><span class="chat-expand">展开全文</span><span class="chat-collapse">收起全文</span></summary><div class="chat-text">${esc(text)}</div></details>` : `<div class="chat-text">${esc(text)}</div>`;
  if (['artifact','review'].includes(message.type)) content += `<button type="button" class="tiny" data-skill-from="projectMessages" data-skill-id="${esc(message.id)}">${tr('创建技能草稿')}</button>`;
  return `<article class="chat-message chat-${profile.side} chat-${profile.tone}" data-sender="${esc(message.sender)}" data-message-id="${esc(message.id)}"><span class="chat-avatar" aria-hidden="true">${esc(profile.avatar)}</span><div class="chat-content"><div class="chat-meta"><b>${esc(profile.name)}</b><time datetime="${esc(message.createdAt)}">${esc(fmt(message.createdAt))}</time></div><div class="msg chat-bubble"><div class="chat-labels"><span>${esc(types[message.type] || message.type)}</span>${message.relatedTaskId ? systemFragment('<span>已关联阶段</span>') : ''}${message.replyTo ? systemFragment('<span>讨论回复</span>') : ''}</div>${content}</div></div></article>`;
}

export function departmentView(runId = "all", draft = {}) {
  const s = getStore();
  const runs = s.departmentRuns || [];
  const active = runs.filter((run) => run.status !== "completed").length;
  const completed = runs.filter((run) => run.status === "completed").length;
  const rework = runs.filter((run) => run.status === "rework").length;
  const llm = (s.remote && s.remote.llm) || {};
  const selected = runs.find((run) => run.id === runId);
  const defaultMembers = ["codex", "cursor", "workbuddy"];
  const memberPicker = (s.agents || []).map((member) => `<label class="member-choice"><input type="checkbox" name="participantAgentIds" value="${esc(member.id)}" ${defaultMembers.includes(member.id) ? "checked" : ""} /><span><b>${esc(member.name)}</b><small>${esc(member.role || member.mode || tr("协作成员"))}</small></span></label>`).join("");
  const intake = ui`<section class="department-intake card">
    <div class="row"><div><div class="eyebrow">NEW MISSION</div><div class="h">把目标交给整个部门</div></div><span class="chip ${llm.enabled ? "ok" : "warn"}">${llm.enabled ? tr("当前模型已启用") : tr("模型未启用 · 可先建台账")}</span></div>
    <form id="department-goal-form"><label>您要完成什么？</label><textarea name="goal" class="full" style="min-height:92px" required placeholder="例如：研究一个公开项目，形成可执行方案，并由另一角色独立检查。">${esc(draft.goal || "")}</textarea><label>背景、约束与已有材料（可选）</label><textarea name="context" class="full" style="min-height:82px" placeholder="截止时间、禁止事项、材料路径、判断标准……">${esc(draft.context || "")}</textarea><label>交付形式<select name="deliveryProfile" required><option value="">请选择交付形式</option><option value="text">正文即可</option><option value="single">一份 Word</option><option value="report-bundle">长篇、摘要、附件三份 Word</option></select></label><label>参与成员（创建后固定在项目房间）</label><div class="member-picker">${memberPicker}</div><div class="actions"><button class="solid" type="submit">建立项目房间</button></div></form>
  </section>`;
  const summary = ui`<section class="overview-stats"><article><b>4</b><span>固定岗位</span><small>主管、执行、独立复核、整合</small></article><article><b>${active}</b><span>推进中</span><small>一个目标只建立一条工作链</small></article><article class="${rework ? "alert" : ""}"><b>${rework}</b><span>返工</span><small>复核不通过自动退回</small></article><article><b>${completed}</b><span>已完成</span><small>保留最终整合稿与过程证据</small></article></section>`;
  if (!selected) {
    if (runId === "new") return ui`<h2>新建项目</h2>${intake}`;
    const visible = runs.filter(r => !r.archived).slice().sort((a,b) => Number(!!b.pinned) - Number(!!a.pinned) || String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
    return ui`<section class="section-head"><div><div class="eyebrow">VIRTUAL DEPARTMENT</div><h2>项目工作区</h2></div><button type="button" class="solid" data-sec="new">＋ 新建项目 · New project</button></section>${[['置顶', visible.filter(r => r.pinned)], ['进行中', visible.filter(r => !r.pinned && r.status !== 'completed')], ['已完成', visible.filter(r => !r.pinned && r.status === 'completed')], ['已归档', runs.filter(r => r.archived)]].map(([label,items]) => `<h3>${tr(label)}</h3><div class="project-list">${items.length ? items.map(run => `<article class="project-list-row card"><button type="button" class="project-open" data-sec="${esc(run.id)}"><b>${run.pinned ? '📌 ' : ''}${esc(run.title)}</b><small>${esc(fmt(run.updatedAt || run.createdAt))}</small></button>${projectMenu(run)}</article>`).join('') : systemFragment('<p class="k">暂无项目</p>')}</div>`).join('')}<p class="k">归档保留完整记录，可通过管理与归档恢复。</p>`;
  }
  const externalJobs = (s.externalJobs || []).filter(j => j.runId === selected.id);
  const externalStatus = externalJobs.length ? ui`<section class="card"><h3>成员自动执行</h3>${selected.workbuddyTransport === 'desktop-scheduled' ? systemFragment('<p class="k">WorkBuddy 桌面自动化每小时领取一次；等待领取期间无需转发提示词。请保持 WorkBuddy 登录并运行，预计等待最多约 1 小时，执行耗时另计。</p>') : ''}${externalJobs.slice(0,3).map(j => `<p>${esc(j.agentId)} · ${esc(j.status)}${j.error ? " · " + esc(j.error) : ""}</p>`).join("")}</section>` : "";
  const doneCount = (selected.items || []).filter((item) => item.status === "done").length;
  const projectMessages = (s.projectMessages || []).filter((message) => message.runId === selected.id).slice().reverse().sort((a,b)=>Date.parse(a.createdAt)-Date.parse(b.createdAt));
  const chatJobs = (s.chatJobs || []).filter(j => j.runId === selected.id);
  const pendingReplies = chatJobs.filter(j => j.status !== 'done' && !chatJobs.some(next => next.messageId === j.messageId && next.agentId === j.agentId && next.createdAt > j.createdAt));
  const repliesHtml = pendingReplies.map(j => `<div class="msg chat-reply-status" data-chat-job="${esc(j.id)}"><b>${esc(agent(j.agentId).name || j.agentId)}</b> · ${esc(({queued:tr('等待回复'),doing:tr('正在回复'),waiting:tr('等待 WorkBuddy 领取（可手动运行现有领取任务）'),failed:tr('回复失败')})[j.status] || j.status)}${j.error ? ui`<p>${esc(j.error)}</p><button type="button" data-chat-retry="${esc(j.id)}" data-run-id="${esc(selected.id)}">重试回复</button>` : ''}</div>`).join('');
  const messageHtml = (projectMessages.length ? projectMessages.map(roomMessage).join("") : ui`<div class="agenda-empty">在这里直接讨论项目；默认由 Codex 回答，也可 @Cursor、@WorkBuddy。</div>`) + repliesHtml;
  const participants = (selected.participantAgentIds || []).map((agentId) => agent(agentId));
  const memberHtml = participants.map((member) => `<div class="room-member"><span class="avatar">${esc((member.name || "?").slice(0, 1))}</span><span><b>${esc(member.name)}</b><small>${esc(member.role || tr("成员"))}</small></span><i class="chip ${member.status === "active" ? "ok" : ""}">${(s.inbox || []).some(m => m.runId === selected.id && m.toAgentId === member.id && m.departmentItemId && m.status === "doing") ? tr("已领取任务") : (selected.items || []).some(i => i.ownerAgentId === member.id && i.status === "done") ? tr("已有阶段成果") : tr("未领取任务")}</i></div>`).join("");
  const taskHtml = (selected.items || []).map((item) => `<div class="room-task"><b>${esc(tr(item.label))}</b><span class="chip ${item.status === "done" ? "ok" : item.status === "doing" ? "doing" : ""}">${esc(tr(DEPARTMENT_STATUS[item.status] || item.status))}</span><small>${esc(agent(item.ownerAgentId).name)} · ${esc(((s.inbox || []).find(m => m.departmentItemId === item.id) || {}).status === "doing" ? tr("已领取") : item.status === "queued" ? tr("待成员领取") : item.status === "blocked" ? tr("等待前置成果") : item.status === "done" ? tr("已提交成果") : tr("阶段执行中"))}</small></div>`).join("");
  return ui`${selected.resumeRequired?ui`<div class="card"><b>项目已恢复并保持暂停</b><p>请在管理与归档中选择继续。原有复核暂停和写作批准仍须按原流程处理。</p></div>`:""}<section class="command-hero"><div><div class="eyebrow">PROJECT ROOM · ${esc(selected.planningMode === "model-assisted" ? tr("模型协作") : tr("等待总管"))}</div><h2>${esc(selected.title)}</h2><p>${esc(selected.goal)}</p></div><div class="hero-actions">${selected.status !== "completed" ? ui`<button type="button" class="solid" data-act="department-auto-run" data-run-id="${esc(selected.id)}">启动部门工作</button>` : ""}<button type="button" class="ghost" data-act="external-retry" data-run-id="${esc(selected.id)}">重试成员执行</button><button type="button" class="ghost" data-sec="new">新建项目</button></div></section>
    ${externalStatus}${selected.preparationFlow ? ui`<section class="card"><h3>准备材料接力</h3><p>${esc(({reviewing:tr("Cursor 正在复核准备材料"),summarizing:tr("Codex 正在汇总问题与建议"),awaiting_confirmation:tr("复核与建议已完成，等待董事长确认及 Start Writing"),failed:tr("准备材料接力失败，请查看原因后重试")})[selected.preparationFlow.status] || selected.preparationFlow.status)}</p>${selected.preparationFlow.error ? `<p>${esc(selected.preparationFlow.error)}</p>` : ""}</section>` : ""}<section class="project-room"><aside class="room-panel card"><div class="eyebrow">MEMBERS · 项目成员</div><h2>参与成员</h2>${memberHtml || ui`<p class="k">未固定成员</p>`}</aside><main class="room-chat card"><div class="section-head"><div><div class="eyebrow">CHAT · 项目讨论</div><h2>项目群聊</h2></div><span>${projectMessages.length} 条消息</span></div><div class="messages project-messages">${messageHtml}</div><form class="room-composer" data-room-form="${esc(selected.id)}"><label class="chat-recipient">回复成员 <select name="recipient"><option value="all">Codex（默认）</option>${["codex","cursor","workbuddy"].filter(a => (selected.participantAgentIds || ["codex","cursor","workbuddy"]).includes(a)).map(a => `<option value="${a}">${esc(agent(a).name || a)}</option>`).join("")}<option value="everyone">三位成员分别回答</option></select><small>也可在正文 @成员；讨论不会自行改变阶段。</small></label><textarea name="text" rows="2" maxlength="12000" required aria-keyshortcuts="Alt+Enter" placeholder="直接提问，或 @Cursor / @WorkBuddy 讨论项目……"></textarea><button class="solid" type="submit">发送</button><small class="chat-key-hint">Enter 换行 · Alt+Enter 发送</small></form></main><aside class="room-panel card"><div class="eyebrow">TASKS · 成员任务</div><h2>任务与状态</h2>${taskHtml}</aside></section>
    <section class="overview-stats"><article><b>${doneCount}/4</b><span>阶段完成</span><small>严格按依赖顺序解锁</small></article><article><b>${esc(tr((selected.items.find((item) => item.role === selected.currentRole) || {}).label || "完成"))}</b><span>当前阶段</span><small>${esc(tr(({awaiting_files:"待生成文件",awaiting_file_review:"待文件复核",awaiting_delivery_configuration:"待确定交付要求"})[selected.status] || selected.status))}</small></article><article><b>${(selected.artifacts || []).length}</b><span>材料</span><small>所有路径归入同一工作链</small></article><article><b>${(selected.discussion || []).length}</b><span>留痕</span><small>目标、成果与复核意见</small></article></section>
    ${selected.context ? ui`<div class="msg"><div class="who">背景与约束</div>${esc(selected.context)}</div>` : ""}
    <div class="section-head"><div><div class="eyebrow">WORKFLOW</div><h2>四角色接力</h2></div><span>执行人与复核人强制分离</span></div>
    <section class="department-flow">${selected.items.map((item) => departmentItemCard(selected, item)).join("")}</section>
    ${executionPanel(selected)}
    ${deliveryView(selected, s)}
    ${selected.finalOutput ? ui`<section class="card department-final"><div class="eyebrow">INTEGRATION</div><div class="h">最终整合说明</div><pre class="report">${esc(selected.finalOutput)}</pre></section>` : ""}`;
}

// ---------- 决策台（P1 + P5）：总控指标 + 风险雷达 + 全项目决策表 ----------

export function deckView() {
  const s = getStore();
  const tasks = activeTasks();
  const inWork = tasks.filter((t) => t.status === "doing" || t.status === "review").length;
  const dueToday = tasks.filter((t) => t.due === ymd() && t.status !== "done").length;
  const blocked = tasks.filter((t) => t.status === "blocked");
  const stale = tasks.filter((t) => taskStale(t));
  const overdue = tasks.filter((t) => taskOverdue(t));
  const riskyCount = tasks.filter(t => t.status === 'blocked' || taskOverdue(t) || taskStale(t)).length;

  const stat = (n, label, cls) =>
    `<div class="stat ${cls || ""}"><b>${n}</b><span>${esc(label)}</span></div>`;

  const riskMsg = (t, label) => `
    <div class="msg">
      <div class="row"><b>${esc(t.title)}</b><span class="chip warn">${esc(label)}</span></div>
      <p>${esc(t.nextAction || t.notes || "")}</p>
      <div class="meta">
        <span class="chip">${esc(agent(t.ownerAgentId).name)}</span>
        ${t.ownerAgentId ? ui`<button type="button" class="tiny" data-cmd="${esc(t.ownerAgentId)}">指挥</button>` : ""}
      </div>
    </div>`;

  const risks = [
    ...blocked.map((t) => riskMsg(t, tr("受阻"))),
    ...overdue.filter((t) => t.status !== "blocked").map((t) => riskMsg(t, tr("已逾期") + " " + t.due)),
    ...stale.filter((t) => t.status !== "blocked" && !taskOverdue(t)).map((t) => riskMsg(t, taskStale(t) + tr("h 无打卡"))),
  ].slice(0, 8);

  const rows = [...tasks].sort((a, b) => (a.due || "9999-99-99").localeCompare(b.due || "9999-99-99"));
  const table = ui`<table class="deck"><thead><tr>
      <th>任务 / 项目</th><th>状态</th><th>进度</th><th>责任</th><th>到期</th><th>最后打卡</th><th>风险</th>
    </tr></thead><tbody>${rows
      .map((t) => {
        const flags = [
          taskOverdue(t) ? tr("逾期") : "",
          taskStale(t) ? taskStale(t) + tr("h 无打卡") : "",
          t.status === "blocked" ? tr("受阻") : "",
        ].filter(Boolean);
        return `<tr>
          <td>${esc(t.title)}</td>
          <td><span class="chip">${tr(STATUS[t.status] || t.status)}</span></td>
          <td><div class="bar"><i style="width:${t.progress || 0}%"></i></div></td>
          <td>${esc(agent(t.ownerAgentId).name)}</td>
          <td>${esc(t.due || "—")}</td>
          <td>${esc(fmt(t.updatedAt) || "—")}</td>
          <td>${flags.map((r) => `<span class="chip warn">${esc(r)}</span>`).join("") || systemFragment('<span class="chip ok">正常</span>')}</td>
        </tr>`;
      })
      .join("")}</tbody></table>`;

  return ui`
    <div class="stats">
      ${stat(inWork, tr("在办"))}
      ${stat(dueToday, tr("今日到期"))}
      ${stat(blocked.length, tr("受阻"), blocked.length ? "bad" : "")}
      ${stat(riskyCount, tr("风险灯"), riskyCount ? "bad" : "")}
    </div>
    <div class="filters" style="margin-top:12px">
      <button type="button" class="solid" data-act="open-decompose">📥 任务拆解：贴入会议记录 / 原始素材</button>
    </div>
    ${
      risks.length
        ? ui`<div class="h">风险雷达</div>${risks.join("")}`
        : ui`<p class="k">当前没有逾期、受阻或超时任务。上面这行按钮可以把会议记录直接拆成待办。</p>`
    }
    <div class="h">全项目决策表</div>
    ${table}`;
}

// ---------- 决策台 · 任务拆解弹窗（P2 第一步：手动模板 + AI 拆解接口） ----------

export function decomposeModal(agentNames) {
  return ui`<div class="sheet">
    <div class="kicker">任务拆解 · P2</div>
    <h2>把原始素材拆成待办</h2>
    <label>① 原始素材（会议记录 / 领导要求 / 一段话）</label>
    <textarea class="full" id="decomp-src" style="min-height:110px" placeholder="把要拆的内容原样贴进来……"></textarea>
    <label>② 拆解结果（每行一条：任务标题 | 责任部门 | 一句话说明。可手写，也可点「AI 拆解」自动生成）</label>
    <textarea class="full" id="decomp-out" style="min-height:130px" placeholder="公文格式修正流程 | 豆包 | 选一篇近稿走七步&#10;调研表回收跟进 | DeepSeek | 整理缺口清单"></textarea>
    <p class="k">责任部门可写名称或留空。AI 拆解走「设置」里配置的模型路由（本地 Ollama 或在线接口），响应可能要等十几秒。</p>
    <div class="actions">
      <button type="button" class="ghost" data-act="close-modal">取消</button>
      <button type="button" class="ghost" data-act="ai-decompose">🤖 AI 拆解</button>
      <button type="button" class="solid" data-act="create-tasks">✅ 生成待办</button>
    </div>
    <p id="decomp-msg" class="k"></p>
  </div>`;
}

// ---------- 生活 / 学习：繁星引用 agendas，银河保存体系化执行 ----------

function starAgendas(kind) {
  return (getStore().agendas || [])
    .filter((item) => item.category === kind)
    .slice()
    .sort((a, b) => `${a.date}|${a.time || "99:99"}`.localeCompare(`${b.date}|${b.time || "99:99"}`));
}

function starSection(kind) {
  const items = starAgendas(kind);
  const done = items.filter((item) => item.done).length;
  return ui`<section class="front-section">
    <div class="front-section-head"><div><div class="eyebrow">STAR FIELD · 日程引用</div><h2>繁星</h2><p>从“日”板块分类为“${esc(kind)}”的零散行程。这里不复制数据，完成、复盘、材料与“日”即时同步。</p></div><span class="chip">${done} / ${items.length} 完成</span></div>
    ${items.length ? `<div class="front-list">${items.map((item) => agendaItem(item)).join("")}</div>` : ui`<div class="agenda-empty">还没有从“日”板块流入的${esc(kind)}行程。</div>`}
  </section>`;
}

function habitGalaxySection() {
  const s = getStore();
  const system = s.lifeSystem || {};
  const date = ymd();
  const templates = system.habitTemplates || [];
  const runs = (system.habitRuns || []).filter((item) => item.date === date);
  const habits = templates.map((template) => ({ ...template, ...(runs.find((run) => run.habitId === template.id) || {}) })).filter((item) => item.id && item.date === date);
  const done = habits.filter((item) => item.done).length;
  return ui`<section class="front-section galaxy-section">
    <div class="front-section-head"><div><div class="eyebrow">MILKY WAY · 固定习惯</div><h2>银河</h2><p>今天自动载入的“12 套习惯”到期项；不写入每日行程。每日 9 项，周一/三/五增加锻炼，周日增加两项周习惯。</p></div><span class="chip ok">${done} / ${habits.length} 完成</span></div>
    ${habits.length ? `<div class="habit-grid">${habits.map((item) => ui`<article class="habit-run ${item.done ? "is-done" : ""}">
      <button type="button" class="agenda-check ${item.done ? "checked" : ""}" data-act="habit-toggle" data-id="${esc(item.id)}" title="切换完成">${item.done ? "✓" : ""}</button>
      <div><div class="row"><b>${esc(item.time || tr("随时"))} · ${esc(item.title)}</b><span class="chip">${item.done ? tr("已完成") : item.skipped ? tr("已跳过") : tr("待执行")}</span></div><p>${esc(item.note || "")}</p></div>
    </article>`).join("")}</div>` : ui`<div class="agenda-empty">正在载入今天的习惯…刷新后仍为空时，请检查本机服务。</div>`}
  </section>`;
}

function learningPlanCard(plan) {
  if (plan.status === "completed") {
    return `<article class="achievement-card"><div class="eyebrow">LEARNING ACHIEVEMENT</div><b>🏆 ${esc(plan.achievement || ui`已完成对《${plan.title}》的学习，你真棒！`)}</b><p>${esc(plan.completedAt ? ui`完成于 ${fmt(plan.completedAt)} · 共 ${plan.completedSessions || 0} 个学习时段` : "")}</p></article>`;
  }
  const sessions = (plan.sessions || []).slice().sort((a, b) => `${a.date}|${a.time}`.localeCompare(`${b.date}|${b.time}`));
  const done = sessions.filter((item) => item.done).length;
  return ui`<article class="learning-plan-card"><div class="row"><div><div class="eyebrow">ADOPTED PLAN · ${esc(plan.model || "ollama")}</div><h3>${esc(plan.title)}</h3></div><span class="chip ok">${done} / ${sessions.length} 完成</span></div><p>${esc(plan.goal || "")}</p>
    <div class="learning-sessions">${sessions.map((item) => ui`<div class="learning-session ${item.done ? "is-done" : ""}"><button type="button" class="agenda-check ${item.done ? "checked" : ""}" data-act="learning-session-toggle" data-plan-id="${esc(plan.id)}" data-session-id="${esc(item.id)}" title="切换完成">${item.done ? "✓" : ""}</button><div><b>${esc(item.date)} ${esc(item.time)} · ${esc(item.title)}</b><p>${esc(item.minutes)} 分钟${item.note ? ` · ${esc(item.note)}` : ""}</p></div></div>`).join("")}</div>
  </article>`;
}

function learningDraftCard(draft) {
  if (!draft) return "";
  return ui`<article class="learning-draft"><div class="row"><div><div class="eyebrow">OLLAMA DRAFT · 尚未写入</div><h3>${esc(draft.title)}</h3></div><span class="chip warn">请先核对</span></div><p>候选计划不会自动保存。确认内容、日期与时长后再采纳。</p><div class="learning-sessions">${(draft.sessions || []).map((item) => ui`<div class="learning-session"><div><b>${esc(item.date)} ${esc(item.time)} · ${esc(item.title)}</b><p>${esc(item.minutes)} 分钟${item.note ? ` · ${esc(item.note)}` : ""}</p></div></div>`).join("")}</div><div class="actions"><button type="button" class="ghost" data-act="learning-draft-discard">放弃草稿</button><button type="button" class="solid" data-act="learning-draft-adopt">采纳到银河</button></div></article>`;
}

function learningGalaxySection(draft, formDraft = {}) {
  const store = getStore();
  const plans = ((store.lifeSystem || {}).learningPlans || []);
  const llm = (store.remote && store.remote.llm) || {};
  const online = llm.provider === "openai";
  const engine = online ? ui`在线 ${llm.model || tr("模型")}` : tr("本地 Ollama");
  const engineNote = online
    ? tr("仅在点击生成时把此表单内容发送给您配置的在线接口；模型不会自动浏览网页。")
    : tr("本地 Ollama 不联网；仅在点击生成时读取此表单内容。");
  return ui`<section class="front-section galaxy-section"><div class="front-section-head"><div><div class="eyebrow">MILKY WAY · AI 学习计划</div><h2>银河</h2><p>提交给当前模型路由前，只会发送您在下方填写的目标、内容和时间约束。${esc(engineNote)} 生成结果必须由您采纳。</p></div><span class="chip">${plans.filter((item) => item.status === "active").length} 个进行中</span></div>
    <form id="learning-plan-form" class="learning-form"><div class="form-two"><label>学习目标<input name="goal" required value="${esc(formDraft.goal || "")}" placeholder="例如：掌握 Python 数据分析基础" /></label><label>截止日期<input name="deadline" type="date" value="${esc(formDraft.deadline || "")}" /></label></div><label>学习内容 / 已有材料<textarea name="content" rows="3" required placeholder="写明要学的知识、已有基础、材料名称或希望解决的问题">${esc(formDraft.content || "")}</textarea></label><div class="form-two"><label>可投入时间<textarea name="availability" rows="2" required placeholder="例如：工作日 20:00–21:00，周末上午 2 小时" >${esc(formDraft.availability || "")}</textarea></label><label>单次时长（分钟）<input name="sessionMinutes" type="number" min="15" max="240" value="${esc(formDraft.sessionMinutes || "45")}" /></label></div><button type="submit" class="solid">由${esc(engine)}制定候选计划</button><p class="k">${esc(engineNote)} 表单草稿仅保存在这台电脑的浏览器中，采纳计划后自动清除。</p></form>
    ${learningDraftCard(draft)}
    <div class="learning-plan-list">${plans.length ? plans.map(learningPlanCard).join("") : systemFragment('<div class="agenda-empty">还没有已采纳的学习计划。</div>')}</div>
  </section>`;
}

export function frontView(kind, secondary, learningDraft = null, learningFormDraft = {}) {
  if (kind === "life") return ui`<section class="front-hero"><div><div class="eyebrow">LIFE SYSTEM · 本机执行账</div><h2>生活战线：繁星与银河</h2><p>零散生活行程与固定习惯分开管理，但都保留为可勾选、可回看的真实行动。</p></div></section>${starSection("生活")}${habitGalaxySection()}`;
  return ui`<section class="front-hero"><div><div class="eyebrow">LEARNING SYSTEM · 人工采纳</div><h2>学习战线：繁星与银河</h2><p>临时学习行程保持与“日”同步；体系化计划先由当前模型路由推理，再由您决定是否采纳。</p></div></section>${starSection("学习")}${learningGalaxySection(learningDraft, learningFormDraft)}`;
}

// ---------- 每日行程：日 / 周 / 月共用同一份 agendas 台账 ----------

function localDate(value) {
  const [year, month, day] = String(value || "").split("-").map(Number);
  return new Date(year, month - 1, day);
}

function dateText(value) {
  const date = localDate(value);
  const names = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  return `${value} · ${names[date.getDay()]}`;
}

function periodForAgenda(mode, anchor) {
  const date = localDate(anchor);
  if (mode === "month") {
    const start = new Date(date.getFullYear(), date.getMonth(), 1);
    const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    return { start: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-01`, end: `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}` };
  }
  if (mode === "week") {
    const weekday = date.getDay() || 7;
    date.setDate(date.getDate() - weekday + 1);
    const end = new Date(date); end.setDate(date.getDate() + 6);
    const stamp = (item) => `${item.getFullYear()}-${String(item.getMonth() + 1).padStart(2, "0")}-${String(item.getDate()).padStart(2, "0")}`;
    return { start: stamp(date), end: stamp(end) };
  }
  return { start: anchor, end: anchor };
}

function materialButtons(item) {
  return (item.materials || []).map((material, index) => {
    const value = typeof material === "string" ? material : material.path;
    const label = String(value || "").split(/[\\/]/).filter(Boolean).at(-1) || tr("材料路径");
    return `<button type="button" class="material-link" data-act="agenda-open-material" data-id="${esc(item.id)}" data-index="${index}" title="${esc(value)}">↗ ${esc(label)}</button>`;
  }).join("");
}

function agendaActionButtons(item) {
  const hasMaterials = Array.isArray(item.materials) && item.materials.length > 0;
  const open = hasMaterials
    ? ui`<button type="button" class="tiny" data-act="agenda-open-material" data-id="${esc(item.id)}" data-index="0">打开材料</button>`
    : "";
  const editLabel = hasMaterials ? tr("编辑路径") : tr("添加材料");
  return ui`<button type="button" class="tiny" data-act="agenda-edit" data-id="${esc(item.id)}">修改</button>${open}<button type="button" class="tiny" data-act="agenda-materials" data-id="${esc(item.id)}">${editLabel}</button><button type="button" class="tiny" data-act="agenda-review" data-id="${esc(item.id)}">复盘</button><button type="button" class="tiny danger" data-act="agenda-delete" data-id="${esc(item.id)}">删除</button>`;
}

function agendaItem(item, { compact = false } = {}) {
  return ui`<article class="agenda-item ${item.done ? "is-done" : ""}">
    <button type="button" class="agenda-check ${item.done ? "checked" : ""}" data-act="agenda-toggle" data-id="${esc(item.id)}" title="切换完成">${item.done ? "✓" : ""}</button>
    <div class="agenda-time">${esc(item.time || tr("待定"))}</div>
    <div class="agenda-body"><div class="row"><b>${esc(item.title)}</b>${item.important ? `<span class="star-mark">★ ${item.reminderSentAt ? tr("提醒已发") : tr("重点 · 提前12小时提醒")}</span>` : ""}</div>
      <div class="meta">${item.category ? `<span class="chip">${esc(item.category)}</span>` : ""}${(item.tags || []).map((tag) => `<span class="chip">${esc(tag)}</span>`).join("")}${materialButtons(item)}</div>
      ${!compact && item.note ? `<p>${esc(item.note)}</p>` : ""}${item.review ? ui`<div class="agenda-review">复盘 · ${esc(item.review)}</div>` : ""}</div>
    <div class="agenda-actions">${agendaActionButtons(item)}</div>
  </article>`;
}

function groupedAgenda(entries) {
  const groups = new Map();
  for (const item of entries) {
    const list = groups.get(item.date) || [];
    list.push(item);
    groups.set(item.date, list);
  }
  return [...groups.entries()];
}

export function agendaView(date, mode = "day", reportDraft = null, filter = "all", options = {}) {
  const s = getStore();
  const labels = { day: tr("日"), week: tr("周"), month: tr("月") };
  const reportLabels = { day: tr("日报"), week: tr("周报"), month: tr("月报") };
  const reportTitles = {day:tr('基于本日已录入事项与复盘生成日报'),week:tr('基于本周已录入事项与复盘生成周报'),month:tr('基于本月已录入事项与复盘生成月报')};
  const reportActions = {day:tr('生成日报'),week:tr('生成周报'),month:tr('生成月报')};
  const range = periodForAgenda(mode, date);
  const entries = (s.agendas || []).filter((item) => item.date >= range.start && item.date <= range.end)
    .slice().sort((a, b) => `${a.date}|${a.time || "99:99"}`.localeCompare(`${b.date}|${b.time || "99:99"}`));
  const done = entries.filter((item) => item.done).length;
  const important = entries.filter((item) => item.important).length;
  const predicates = { all: () => true, done: item => item.done, pending: item => !item.done, important: item => item.important };
  const selected = Object.hasOwn(predicates, filter) ? filter : "all";
  const visibleEntries = entries.filter(predicates[selected]);
  const filterLabels = { all: tr("已排日程"), done: tr("已完成"), pending: tr("待处理"), important: tr("重点事项") };
  const statsHtml = [
    ["all", entries.length, mode === "day" ? tr("含时间块与临时事项") : tr("当前查看范围")],
    ["done", done, ui`完成率 ${percent(done, entries.length)}%`],
    ["pending", entries.length - done, tr("给注意力留出余量")],
    ["important", important, tr("提前 12 小时提醒")],
  ].map(([key, count, caption]) => `<button type="button" class="stat agenda-stat ${selected === key ? "active" : ""}" data-act="agenda-filter" data-agenda-filter="${key}" aria-pressed="${selected === key}" aria-controls="agenda-results"><b>${count}</b><span>${filterLabels[key]}</span><small>${caption}</small></button>`).join("");
  const plan = (s.plans || []).find((p) => (p.slots || []).some((slot) => slot.date === date));
  const slot = plan && (plan.slots || []).find((item) => item.date === date);
  const switches = ["day", "week", "month"].map((item) => ui`<button type="button" class="${mode === item ? "active" : ""}" data-act="agenda-view" data-view="${item}">${labels[item]}视图</button>`).join("");
  const navigator = mode === "day" ? "" : ui`<div class="agenda-period-nav"><button type="button" class="tiny" data-act="agenda-nav" data-shift="-1">← 上一${labels[mode]}</button><b>${range.start} — ${range.end}</b><button type="button" class="tiny" data-act="agenda-nav" data-shift="1">下一${labels[mode]} →</button></div>`;
  const emptyHtml = selected === "all" ? systemFragment('<div class="agenda-empty">这个范围还没有已录入日程。</div>') : systemFragment('<div class="agenda-empty">当前范围没有符合筛选条件的日程。</div>');
  const entriesHtml = visibleEntries.length ? visibleEntries.map((item) => agendaItem(item)).join("") : emptyHtml;
  const groupedHtml = groupedAgenda(visibleEntries).map(([day, list]) => ui`<section class="agenda-day-group"><div class="section-head"><div><div class="eyebrow">${esc(dateText(day))}</div><h2>${list.length} 项已录入日程</h2></div><button type="button" class="tiny" data-act="agenda-open-day" data-date="${esc(day)}">进入日视图</button></div>${list.map((item) => agendaItem(item, { compact: false })).join("")}</section>`).join("") || emptyHtml;
  const saveLabel = reportDraft?.kind === 'monthly' && reportDraft.sourceJobId ? tr('保存到报告库和 Obsidian') : tr('保存到报告库');
  const saveChoices = options.exportPreview?.sourceJobId === reportDraft?.sourceJobId && options.exportPreview?.sourceState === 'changed' ? ui`<div class="agenda-report-source-warning" role="status"><p>生成报告后日程来源或执行状态已变化。可以保留当前文字为历史草稿，也可以重新生成。</p><div class="actions"><button type="button" class="solid" data-act="agenda-report-save-historical">保留为历史草稿</button><button type="button" class="ghost" data-act="agenda-report-regenerate">重新生成</button><button type="button" class="ghost" data-act="agenda-report-save-cancel">取消</button></div></div>` : '';
  const receipt = options.saveReceipt;
  const receiptHtml = receipt ? ui`<section class="card agenda-report-save-receipt" role="status"><b>${receipt.status === "historical-draft" ? tr("已保存为历史草稿，并写入 Obsidian。") : tr("已保存到报告库，并写入 Obsidian。")}</b><p><code style="white-space:normal;overflow-wrap:anywhere" data-report-export-path>${esc(receipt.file.path)}</code></p><small style="overflow-wrap:anywhere;word-break:break-all">SHA-256 ${esc(receipt.file.sha256)}</small></section>` : '';
  const reportHtml = reportDraft ? ui`<section class="card agenda-report"><div class="section-head"><div><div class="eyebrow">AI DRAFT · 可编辑</div><h2>${esc(reportDraft.title)}</h2></div><button type="button" class="tiny" data-act="agenda-report-discard">放弃草稿</button></div><p class="agenda-report-notice ${reportDraft.modelApplied === false ? "is-warning" : ""}">${esc(reportDraft.notice || tr("请核对事实后再保存。"))}</p><textarea id="agenda-report-body" data-source-job-id="${esc(reportDraft.sourceJobId || '')}" rows="16">${esc(reportDraft.body)}</textarea>${saveChoices}<div class="actions"><button type="button" class="solid" data-act="agenda-report-save" ${options.saving ? "disabled" : ""}>${saveLabel}</button></div></section>` : "";
  const reportButton = ui`<section class="agenda-report-cta"><div><div class="eyebrow">PERIOD REPORT</div><b>${reportTitles[mode]}</b><p>仅将本周期事实交给所选成员；返回可编辑草稿，确认后保存。</p>${s.remote?.providerPauses?.siliconflow?.paused ? ui`<p>SiliconFlow 已暂停，配置已保留。</p>` : ""}</div><div class="report-member-controls"><label for="agenda-report-agent">生成成员</label><select id="agenda-report-agent"><option value="codex">Codex</option><option value="cursor">Cursor</option><option value="workbuddy">WorkBuddy</option></select><button type="button" class="solid" data-act="agenda-report-draft">${reportActions[mode]}</button></div><div id="agenda-report-status" role="status" aria-live="polite"></div></section>`;
  return ui`<section class="agenda-hero"><div><div class="eyebrow">AGENDA · 本地单一台账</div><h2>${mode === "day" ? esc(dateText(date)) : ui`${labels[mode]}视图 · ${esc(range.start)} — ${esc(range.end)}`}</h2><p>日程只录一次；日、周、月只是从同一份本机台账查看不同范围。</p></div><div class="agenda-hero-controls"><div class="agenda-view-switch">${switches}</div><label class="date-picker">日期锚点<input id="agenda-date" type="date" value="${esc(date)}" /></label></div></section>
    ${navigator}
    <div class="actions"><button type="button" class="ghost" data-act="agenda-notes">复盘笔记</button></div>
    <section class="overview-stats agenda-stats">${statsHtml}</section>
    <div class="agenda-filter-summary" role="status">当前筛选：<b>${filterLabels[selected]}</b><span>${visibleEntries.length} 项日程</span></div>
    ${mode === "day" && slot ? `<section class="plan-strip"><div><div class="eyebrow">WEEKLY INTENT</div><b>${esc(plan.title || tr("本周安排"))}</b></div><ul>${(slot.items || []).map((item) => `<li>${esc(item)}</li>`).join("")}</ul></section>` : ""}
    ${mode === "day" ? ui`<section class="agenda-layout"><form id="agenda-form" class="card agenda-form"><div class="section-head"><div><div class="eyebrow">NEW TIME BLOCK</div><h2>添加行程</h2></div></div><label>时间<input name="time" type="time" value="09:00" /></label><label>事项<input name="title" required placeholder="例如：审阅季度汇报材料" /></label><div class="form-two"><label>分类<select name="category"><option value="工作">工作</option><option value="会议">会议</option><option value="学习">学习</option><option value="生活">生活</option></select></label><label>标签（逗号分隔）<input name="tags" placeholder="公文, 季度汇报" /></label></div><label>备注<textarea name="note" rows="3" placeholder="地点、材料或下一步（可选）"></textarea></label><label>材料存放路径（每行一条）<textarea name="materials" rows="3" placeholder="D:\\工作\\项目\\成果文件.docx&#10;D:\\工作\\项目\\材料文件夹"></textarea></label><label class="check-line"><input name="important" type="checkbox" /> 作为重点事项（开始前 12 小时微信提醒）</label><div class="actions"><button type="button" class="ghost" data-note-suggest>建议</button><button class="solid" type="submit">加入时间轴</button></div><div id="agenda-note-suggestion" role="status"></div></form><section class="agenda-timeline" id="agenda-results"><div class="section-head"><div><div class="eyebrow">TIME LINE</div><h2>当天安排</h2></div><button type="button" class="ghost" data-act="agenda-ai-draft">AI 生成建议</button></div>${entriesHtml}<div id="agenda-ai-output" class="ai-draft" hidden></div></section></section>` : `<section class="agenda-period-list" id="agenda-results">${groupedHtml}</section>`}
    ${reportHtml}${receiptHtml}${reportButton}`;
}

export function memoryView(secondary) {
  const s = getStore();
  if (secondary === "prompts") {
    return ui`<div class="filters"><button type="button" class="solid" data-act="add-prompt">+ 新增提示词</button></div>
      ${(s.prompts || [])
        .map(
          (p) => `<div class="msg"><div class="k">${(p.tags || []).join(" · ")}</div><b>${esc(p.title)}</b><p>${esc(p.body)}</p></div>`
        )
        .join("") || systemFragment("<p>还没有沉淀提示词。AI 帮你干得好用的活，把提示词存下来就是能力资产。</p>")}`;
  }
  if (secondary === "lessons") {
    return (s.lessons || [])
      .map((l) => `<div class="msg"><b>${esc(l.rule)}</b><div class="who">${esc(l.from)}</div><button type="button" class="tiny" data-skill-from="lessons" data-skill-id="${esc(l.id)}">${tr('创建技能草稿')}</button></div>`)
      .join("");
  }
  if (secondary === "skills") {
    return (s.skills || [])
      .map((s2) => `<div class="msg"><b>${esc(s2.name)}</b><p>${esc(s2.summary)}</p></div>`)
      .join("");
  }
  const overview = ui`<div class="card"><div class="h">现有资产记录</div>
    <div class="meta">
      <span class="chip">记忆 ${(s.memories || []).length}</span>
      <span class="chip">教训 ${(s.lessons || []).length}</span>
      <span class="chip">技能说明 ${(s.skills || []).length}</span>
      <span class="chip">提示词 ${(s.prompts || []).length}</span>
      <span class="chip">报告 ${(s.reports || []).length}</span>
    </div>
    <p class="k">能力资产思想：AI 每干完一件事，留下一条可复用的沉淀，而不是聊天记录蒸发。</p></div>`;
  return overview + (s.memories || [])
    .map(
      (m) => `<div class="msg"><div class="k">${(m.tags || []).join(" · ")}</div><b>${esc(m.title)}</b><p>${esc(m.body)}</p><button type="button" class="tiny" data-skill-from="memories" data-skill-id="${esc(m.id)}">${tr('创建技能草稿')}</button></div>`
    )
    .join("");
}

export function setView() {
  const s = getStore();
  const rec = s.briefingRecipes || [];
  const cfg = (s.remote && s.remote.llm) || {};
  const reminder = (s.remote && s.remote.reminder) || {};
  const vault = (s.remote && s.remote.vault) || {};
  return ui`<div class="settings-grid"><div class="card"><div class="h">界面语言</div><p>系统界面和使用说明随语言切换，业务内容保持原文。</p><select id="language-select"><option value="zh-CN" ${s.meta?.language!=="en"?"selected":""}>中文</option><option value="en" ${s.meta?.language==="en"?"selected":""}>English</option></select><button type="button" class="solid" data-act="save-language">应用语言</button><p><a href="#set/help">使用说明与逻辑图</a></p></div>
  <div class="card">
    <div class="eyebrow">APPEARANCE</div><div class="h">工作台主题</div>
    <p>主题只改变外观，不改变台账和功能。紫色指挥舱保留为默认选择。</p>
    <label>当前主题</label><select id="theme-select" class="full">
      <option value="violet" ${!["warm","night","guofeng"].includes(s.meta && s.meta.theme) ? "selected" : ""}>紫色指挥舱</option>
      <option value="warm" ${(s.meta && s.meta.theme) === "warm" ? "selected" : ""}>暖白总控台</option>
      <option value="night" ${(s.meta && s.meta.theme) === "night" ? "selected" : ""}>深色专注</option>
      <option value="guofeng" ${(s.meta && s.meta.theme) === "guofeng" ? "selected" : ""}>中国风 · 青墨</option>
    </select><div class="actions" style="margin-top:10px"><button type="button" class="solid" data-act="save-theme">应用主题</button></div>
    <p>中国风 · 青墨：宣纸底色、松绿导航、青玉按钮与朱砂点缀。</p>
  </div>
  <div class="card">
    <div class="h">开屏简报与跨 Agent 收件</div>
    <p>本地经营简报继续自动生成；ChatGPT、WorkBuddy 等外部结果进入简报中心后，也会在开屏显示最新摘录。</p>
    <ul>${rec.map((r) => `<li>${esc(tr(r.title))} (${r.generator}）${r.enabled === false ? tr(" · 已关") : ""}</li>`).join("")}</ul>
    <div class="brief-intake-help"><b>无需 HTTP 的统一投递</b><code>D:\\OneDrive\\Desktop\\Ben_My_Agent\\5.cursor\\搭建工作台\\data\\dropbox\\*.json</code><small>JSON 设置 kind 为 brief；详细字段见项目 AGENTS.md。</small></div>
    <p class="k">指令生命周期：下达后可在舰队页追踪 待领 → 已收悉 → 执行中 → 完成。催报规则：任务 24h 无打卡、部门 48h 未汇报即亮黄灯。</p>
    <button type="button" class="tiny" data-act="backup">导出 JSON</button>
  </div>
  <div class="card">
    <div class="h">Codex 项目总管</div>
    <p>使用本机 ChatGPT 登录，负责目标拆解和成果复核。启用资料库后自动检索相关依据；WorkBuddy 使用每小时桌面领取队列，Cursor 负责独立复核；豆包接入暂缓。</p>
    <div id="codex-status" class="engine-status">正在检测 Codex 登录…</div>
    <div class="actions"><button type="button" class="solid" data-act="codex-test">测试 Codex 连接</button></div>
    ${(s.codexJobs || []).slice(0, 3).map(j => `<p class="k">${esc(j.role === "test" ? tr("连接测试") : j.role === "director" ? tr("主管拆解") : tr("成果复核"))} · ${esc(j.status === "done" ? tr("已完成") : j.status === "failed" ? tr("失败：") + j.error : tr("执行中"))} ${esc(j.completedAt || j.createdAt)}</p>`).join("")}
  </div>
  <div class="card">
    <div class="h">模型路由（基础整理 / AI 生成用）</div>
    <p>本地 Ollama 用于基础汇总和进度整理。Codex 总管使用上方独立通道。</p>
    ${s.remote?.providerPauses?.siliconflow?.paused ? ui`<p>SiliconFlow 已暂停，配置已保留。</p><button type="button" class="ghost" data-act="resume-siliconflow">明确恢复 SiliconFlow</button>` : ""}
    <div id="llm-status" class="engine-status">正在检测本地 Ollama…</div>
    <label>通道</label>
    <select id="llm-provider" class="full">
      <option value="ollama" ${cfg.provider !== "openai" ? "selected" : ""}>本地 Ollama</option>
      <option value="openai" ${cfg.provider === "openai" ? "selected" : ""}>在线 OpenAI 兼容接口</option>
    </select>
    <label>接口地址</label><input type="text" id="llm-base" value="${esc(cfg.baseUrl || "")}" placeholder="Ollama 默认 http://127.0.0.1:11434；在线如 https://api.deepseek.com" />
    <label>模型名</label><input type="text" id="llm-model" list="llm-model-list" value="${esc(cfg.model || "")}" placeholder="如 qwen2.5:7b / deepseek-chat" /><datalist id="llm-model-list"></datalist>
    <label>API Key（在线通道用；留空 = 保持已设置的）</label><input type="password" id="llm-key" placeholder="${cfg.apiKey ? tr("已设置，留空保持不变") : tr("尚未设置")}" />
    <label><input type="checkbox" id="llm-enabled" ${cfg.enabled ? "checked" : ""} /> 启用模型路由</label>
    <div class="actions" style="margin-top:10px">
      <button type="button" class="ghost" data-act="enable-ollama">启用本地 Ollama</button><button type="button" class="ghost" data-act="test-llm">测试连接</button>
      <button type="button" class="solid" data-act="save-llm">保存</button>
    </div>
    <p id="llm-result" class="k"></p>
  </div>
  <div class="card">
    <div class="h">Obsidian 资料库</div>
    <p>与 Obsidian 插件和 Agent 共用同一份索引。生成前检索相关段落；在线模型会收到检索到的片段。</p>
    <label>本机服务地址</label><input id="vault-base" value="${esc(vault.baseUrl || 'http://127.0.0.1:48731')}" />
    <label>凭据文件路径</label><input id="vault-key-file" value="${esc(vault.keyFile || '')}" placeholder="本机 api_key 文件的完整路径" />
    <label><input type="checkbox" id="vault-enabled" ${vault.enabled ? 'checked' : ''} /> 生成前使用资料库</label>
    <div class="actions"><button type="button" class="solid" data-act="save-vault">保存连接</button><button type="button" class="ghost" data-act="sync-vault">立即同步</button><button type="button" class="ghost" data-act="refresh-vault">刷新状态</button></div>
    <p id="vault-status" class="engine-status">正在读取资料库状态…</p>
    <p><a class="tiny" href="#assets/knowledge">${tr("打开知识来源与检索")}</a></p>
  </div>
  <div class="card">
    <div class="h">重点工作微信提醒</div>
    <p>仅对标记为“重点”、且有具体开始时间的未完成日程，在开始前 12 小时发送一次。旧 daily-plan 的本机 Token 已按你的授权迁移；界面不会显示它。</p>
    <div id="reminder-status" class="engine-status">正在检测提醒通道…</div>
    <label>推送通道</label><select id="reminder-provider" class="full"><option value="pushplus" ${reminder.provider !== "serverchan" ? "selected" : ""}>PushPlus</option><option value="serverchan" ${reminder.provider === "serverchan" ? "selected" : ""}>Server酱</option></select>
    <label>Token / SendKey（留空 = 保持已迁移的配置）</label><input type="password" id="reminder-token" placeholder="${reminder.token ? tr("已在本机配置，留空保持不变") : tr("尚未配置")}" />
    <label><input type="checkbox" id="reminder-enabled" ${reminder.enabled ? "checked" : ""} /> 启用微信提醒</label>
    <div class="actions" style="margin-top:10px"><button type="button" class="solid" data-act="save-reminder">保存提醒设置</button></div>
  </div></div>`;
}
