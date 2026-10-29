// ============================================================
// app.js — 壳层启动：路由、三栏渲染、简报弹窗、底部指令台。
// 模块本身在 /modules/，页面视图在 /js/views.js，公共件在 /js/core.js。
// ============================================================

import {
  api, esc, fmt, ymd, getStore, getRawStore, setStore, agent, taskById,
  modulesSorted, STATUS, CMD_STATUS, OPS, safe, errorCard,
} from "./js/core.js";
import { renderCard, renderDetail, manifestFor } from "./modules/index.js";
import * as V from "./js/views.js";
import { t as tr, ui, systemFragment } from "./js/i18n.js";
import { bindDelivery } from './js/delivery-ui.js';
import { bindNoteSuggestion, openReviewNote, openNotesManager, resetSuggestion } from './js/agenda-notes-ui.js';
import { mountAgendaReports, startAgendaReport } from './js/agenda-report-ui.js';
import { openArchive } from "./js/archive-ui.js";
import { helpView, renderLogic } from "./js/help.js";
import { rememberChatPosition, restoreChatPosition } from "./js/chat-scroll.js";

import { NAVIGATION as PRIMARY, resolveRoute, sectionFor, moduleTarget, FOCUS_CATEGORIES, REPORT_KINDS, focusCategoryFor } from './js/navigation.mjs';
import { feedFor, assetSnapshot } from './js/focus.mjs';
import { businessProjectsView, assetsView, setCapabilities } from './js/centers.js';
import { syncPet, previewGreeting } from './js/pet.js';
import { mountSkillStudio, bindSkillSources } from './js/skill-studio-ui.js';
import { mountExecution, bindConversion } from './js/execution-ui.js';
import { bindCompactLayout, mountCompactLayout } from './js/compact-layout.js';
bindCompactLayout();
bindSkillSources();
bindConversion();

let primary = "home";
let secondary = "all";
let search = "";
let briefs = [];
let briefIndex = 0;
let agendaDate = ymd();
let agendaMode = "day";
// A viewing preference for this visit only; never persist it to the ledger or URL.
let agendaFilter = "all";
let briefFilter = "all";
let overviewFilter = "all";
const briefPreferenceUpdates = new Set();
let agendaReportDraft = null;
let agendaReportExportPreview = null, agendaReportSaveReceipt = null, agendaReportSaving = false, agendaReportSaveCommand = null;
let agendaEditId = null;
let agendaEditDraft = null;
let agendaFormDraft = null;
let roomComposing = false;
document.addEventListener('compositionstart', event => {
  if (event.target.matches('.room-composer textarea')) roomComposing = true;
});
document.addEventListener('compositionend', event => {
  if (event.target.matches('.room-composer textarea')) {
    roomComposing = false;
    setTimeout(() => render(), 0);
  }
});
let learningPlanDraft = null;
const LEARNING_FORM_CACHE_KEY = "bench-learning-plan-form-v1";
const DEPARTMENT_GOAL_CACHE_KEY = "bench-department-goal-v1";

function loadLearningFormDraft() {
  try {
    const value = JSON.parse(localStorage.getItem(LEARNING_FORM_CACHE_KEY) || "{}");
    return value && typeof value === "object" ? {
      goal: String(value.goal || ""), content: String(value.content || ""), availability: String(value.availability || ""),
      deadline: String(value.deadline || ""), sessionMinutes: String(value.sessionMinutes || "45"),
    } : { goal: "", content: "", availability: "", deadline: "", sessionMinutes: "45" };
  } catch (_) {
    return { goal: "", content: "", availability: "", deadline: "", sessionMinutes: "45" };
  }
}

let learningFormDraft = loadLearningFormDraft();
let departmentGoalDraft = (() => {
  try {
    const value = JSON.parse(localStorage.getItem(DEPARTMENT_GOAL_CACHE_KEY) || "{}");
    return { goal: String(value.goal || ""), context: String(value.context || "") };
  } catch (_) { return { goal: "", context: "" }; }
})();

function saveDepartmentGoalDraft(value) {
  departmentGoalDraft = { goal: String(value.goal || ""), context: String(value.context || "") };
  try { localStorage.setItem(DEPARTMENT_GOAL_CACHE_KEY, JSON.stringify(departmentGoalDraft)); } catch (_) { /* 仅保留内存 */ }
}

function clearDepartmentGoalDraft() {
  departmentGoalDraft = { goal: "", context: "" };
  try { localStorage.removeItem(DEPARTMENT_GOAL_CACHE_KEY); } catch (_) { /* no-op */ }
}

function saveLearningFormDraft(value) {
  learningFormDraft = {
    goal: String(value.goal || ""), content: String(value.content || ""), availability: String(value.availability || ""),
    deadline: String(value.deadline || ""), sessionMinutes: String(value.sessionMinutes || "45"),
  };
  try { localStorage.setItem(LEARNING_FORM_CACHE_KEY, JSON.stringify(learningFormDraft)); } catch (_) { /* 浏览器禁用本机存储时仍保留当前页面内存 */ }
}

function clearLearningFormDraft() {
  learningFormDraft = { goal: "", content: "", availability: "", deadline: "", sessionMinutes: "45" };
  try { localStorage.removeItem(LEARNING_FORM_CACHE_KEY); } catch (_) { /* no-op */ }
}

const $ = (id) => document.getElementById(id);

// ---------- 路由 ----------

function parseHash() {
  const route = resolveRoute(location.hash || '#home/all', getStore()?.modules || []);
  const nextPrimary = route.primary;
  const s = route.secondary;
  let nextSecondary = s;
  if (location.hash !== route.hash) history.replaceState(null, '', route.hash);
  if (nextPrimary !== primary || nextSecondary !== secondary) overviewFilter = "all";
  if (nextPrimary !== primary) {
    agendaFilter = "all";
    briefFilter = "all";
    if (nextPrimary === "briefs") {
      nextSecondary = "all";
      if (s && s !== "all") history.replaceState(null, "", "#briefs/all");
    }
  } else if (nextPrimary === "briefs" && nextSecondary !== secondary) briefFilter = "all";
  primary = nextPrimary;
  secondary = nextSecondary;
}
function go(p, s, nextBriefFilter = "all") {
  overviewFilter = "all";
  const sameBriefPage = p === "briefs" && primary === "briefs";
  if (p !== primary) agendaFilter = "all";
  if (p === "briefs") {
    if (p !== primary) s = "all";
    briefFilter = nextBriefFilter;
  }
  const route = resolveRoute(p + '/' + encodeURIComponent(s || 'all'), getStore()?.modules || []);
  primary = route.primary;
  secondary = route.secondary;
  const target = route.hash.slice(1);
  // Briefing filters render once so a queued hashchange cannot steal keyboard focus.
  if (sameBriefPage) {
    if (location.hash !== `#${target}`) history.pushState(null, "", `#${target}`);
  } else location.hash = target;
  render();
}

// ---------- 简报弹窗 ----------

async function maybeBriefings() {
  const pack = await api("/api/briefings");
  briefs = pack.items || [];
  if (!briefs.length) return;
  if (pack.dismissedOn === ymd()) return;
  briefIndex = 0;
  showBrief();
}
function showBrief() {
  const el = $("briefing");
  const b = briefs[briefIndex];
  if (!b) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  el.innerHTML = ui`<div class="sheet">
    <div class="kicker">${esc(b.kicker)} · ${b.index} / ${b.total}</div>
    <h2>${esc(b.title)}</h2>
    <div class="brief-body">${esc(b.body)}</div>
    <div class="actions">
      <button type="button" class="ghost" data-brief="skip">今日不再弹出</button>
      <button type="button" class="solid" data-brief="next">${briefIndex + 1 >= briefs.length ? tr("进入指挥台") : tr("下一份")}</button>
    </div>
  </div>`;
}

// ---------- 三栏渲染 ----------

function rail() {
  const unread = (getStore().inbox || []).filter((m) => m.status === "queued").length;
  const unreadBriefs = (getStore().briefRuns || []).filter((m) => m.unread !== false).length;
  $("rail").innerHTML =
    PRIMARY.map((p) => {
      const count = p.id === "agents" ? unread : p.id === "briefs" ? unreadBriefs : 0;
      const badge = count ? `<span class="badge">${count}</span>` : "";
      return `<button type="button" class="rail-btn ${p.id === sectionFor(primary) ? "active" : ""}" title="${esc(tr(p.name))}" data-primary="${p.id}"><span class="rail-label">${esc(tr(p.name))}</span>${badge}</button>`;
    }).join("") + `<div class="rail-gap"></div>`;
}

function channelBtn(id, label, extra, activeId = secondary) {
  return `<button type="button" class="ch ${activeId === id ? "active" : ""}" data-sec="${esc(id)}">${esc(label)}${extra ? `<small>${esc(extra)}</small>` : ""}</button>`;
}

function channels() {
  const q = search.trim().toLowerCase();
  const hit = (t) => !q || String(t).toLowerCase().includes(q);
  let html = "";
  if (primary === "home") {
    html += ui`<div class="sec">工作首页</div>${channelBtn("all", tr("全部模块"))}<a class="ch" href="#home/decisions">${tr("风险与决策")}</a>`;
    html += ui`<div class="sec">模块（可拖到工作区改序）</div>`;
    html += modulesSorted()
      .filter((m) => hit(m.title))
      .map((m) => channelBtn(m.id, m.title, String(m.importance || "")))
      .join("");
  } else if (primary === "deck") {
    html += ui`<div class="sec">工作首页</div><a class="ch" href="#home/all">总览</a>${channelBtn("all", tr("风险与决策"))}`;
  } else if (primary === "department" || primary === "work") {
    const runs = (getStore().departmentRuns || []).filter((run) => hit(run.title + run.goal)).slice().sort((a,b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
    html += ui`<div class="sec">项目中心</div><a class="ch ${primary === 'work' && secondary === 'all' ? 'active' : ''}" href="#projects/business">业务项目</a><a class="ch ${primary === 'department' && secondary === 'all' ? 'active' : ''}" href="#projects/all">协作任务</a><a class="ch ${secondary === 'new' ? 'active' : ''}" href="#projects/new">新建协作任务</a>`;
    html += ui`<div class="sec">业务项目</div>`;
    html += modulesSorted().filter(m => m.type === 'project' && hit(m.title)).map(m => `<a class="ch ${primary === 'work' && secondary === m.id ? 'active' : ''}" href="${resolveRoute('work/' + encodeURIComponent(m.id)).hash}">${esc(m.title)}</a>`).join('');
    const groups = [["置顶", runs.filter(r => r.pinned && !r.archived)], ["进行中", runs.filter(r => !r.pinned && !r.archived && r.status !== "completed")], ["已完成", runs.filter(r => !r.pinned && !r.archived && r.status === "completed")], ["已归档", runs.filter(r => r.archived)]];
    for (const [label, items] of groups) {
      if (!items.length) continue;
      html += `<div class="sec">${tr(label)}</div>` + items.map(run => `<div class="project-nav-row"><a class="ch ${primary === "department" && secondary === run.id ? "active" : ""}" href="${resolveRoute("department/" + encodeURIComponent(run.id)).hash}">${esc(run.title)}</a>${V.projectMenu(run)}</div>`).join("");
    }
  } else if (primary === "agenda") {
    html += ui`<div class="sec">每日行程</div>${channelBtn("all", tr("时间轴 / 周计划"))}`;
  } else if (primary === "briefs") {
    html += ui`<div class="sec">统一简报</div>${channelBtn("all", tr("全部来源"), String((getStore().briefRuns || []).length))}`;
    html += (getStore().briefSources || [])
      .filter((source) => source.enabled !== false && hit(source.platform + source.name))
      .map((source) => {
        const n = (getStore().briefRuns || []).filter((run) => run.sourceId === source.id && run.unread !== false).length;
        return channelBtn(source.id, source.name, n ? ui`未读 ${n}` : source.platform);
      }).join("");
  } else if (primary === "ops") {
    const active = focusCategoryFor(secondary);
    html += ui`<div class="sec">我的关注</div>`;
    html += FOCUS_CATEGORIES.filter((item) => hit(item.name)).map((item) => {
      const category = (getStore().focusCategories || []).find((entry) => entry.id === item.id);
      const feed = category && item.id !== "business" ? feedFor(category, getStore()) : { runs: [], memories: [] };
      const count = item.id === "business" ? (getStore().reports || []).length : feed.runs.length + feed.memories.length;
      return channelBtn(item.id, tr(item.name), String(count), active);
    }).join("");
  } else if (primary === "crew") {
    html += ui`<div class="sec">成员中心</div>${channelBtn("all", tr("全部成员"))}`;
    html += (getStore().agents || [])
      .filter((a) => hit(a.name + a.role))
      .map((a) => {
        const n = (getStore().inbox || []).filter((m) => m.toAgentId === a.id && m.status === "queued").length;
        return channelBtn(a.id, a.name, n ? ui`待领 ${n}` : a.role);
      })
      .join("");
  } else if (primary === "learn") {
    const plans = ((getStore().lifeSystem || {}).learningPlans || []).filter((x) => x.status === "active");
    html += ui`<div class="sec">学习成长</div>${channelBtn("all", tr("繁星与银河"), plans.length ? ui`${plans.length} 个计划` : "")}`;
  } else if (primary === "life") {
    const todayRuns = ((getStore().lifeSystem || {}).habitRuns || []).filter((x) => x.date === ymd());
    html += ui`<div class="sec">生活管理</div>${channelBtn("all", tr("繁星与银河"), todayRuns.length ? ui`${todayRuns.length} 项今日习惯` : "")}`;
  } else if (primary === "memory") {
    const snap = assetSnapshot(getStore());
    html += ui`<div class="sec">资产中心</div>${channelBtn("all", tr("总览"))}${channelBtn("skills", tr("技能"), String(snap.counts.skills))}${channelBtn("atoms", tr("知识原子"), String(snap.counts.atoms))}${channelBtn("materials", tr("内容原料"), String(snap.counts.materials))}${channelBtn("lessons", tr("教训"), String(snap.counts.lessons))}${channelBtn("prompts", tr("提示词"), String(snap.counts.prompts))}${channelBtn("pending", tr("待整理"), String(snap.counts.pending))}${channelBtn("knowledge", tr("知识来源"))}${channelBtn("extensions", tr("扩展能力"))}`;
  } else {
    html += ui`<div class="sec">系统设置</div>${channelBtn("all", tr("简报与偏好"))}${channelBtn("help", tr("使用说明与逻辑图"))}`;
  }
  $("channels").innerHTML = html;
  $("ws-name").textContent = tr("BEN · 一人公司");
  $("ws-role").textContent = tr((PRIMARY.find((p) => p.id === sectionFor(primary)) || {}).name) + " · " + tr("私人秘书");
}

function currentModule() {
  return modulesSorted().find((m) => m.id === secondary) || null;
}

function workspace() {
  const reportEditor = $('agenda-report-body');
  if (reportEditor && agendaReportDraft && (!agendaReportDraft.sourceJobId || reportEditor.dataset.sourceJobId === agendaReportDraft.sourceJobId)) agendaReportDraft.body = reportEditor.value;
  const m = currentModule();
  const titleMap = {
    home: secondary === "all" ? tr("工作首页") : (m || {}).title || "",
    deck: tr("风险与决策"),
    department: ["all","new"].includes(secondary) ? tr("项目中心") : ((getStore().departmentRuns || []).find((run) => run.id === secondary) || {}).title || tr("项目中心"),
    agenda: tr("每日行程"),
    briefs: secondary === "all" ? tr("简报中心") : ((getStore().briefSources || []).find((x) => x.id === secondary) || {}).name || tr("简报中心"),
    ops: REPORT_KINDS.includes(secondary) ? tr((OPS.find((o) => o.id === secondary) || { name: "经营报告" }).name) : tr("我的关注"),
    crew: secondary === "all" ? tr("成员中心") : agent(secondary).name,
    work: secondary === "all" ? tr("项目中心") : (m || {}).title || "",
    learn: tr("学习成长"),
    life: tr("生活管理"),
    memory: tr("资产中心"),
    set: tr("系统设置"),
  };
  const ledeMap = {
    home: tr("今日重点、跨模块入口与待决策事项。"),
    deck: tr("总控指标 + 风险雷达 + 全项目决策表。会议记录在这里拆成待办。"),
    department: tr("只说一次目标，由主管、执行人、独立复核人与整合秘书接力完成。"),
    agenda: tr("把真正占用今天的时间排出来，再让 AI 给出可编辑的建议。"),
    briefs: tr("ChatGPT、WorkBuddy 与其他 Agent 继续各自生成；这里统一收件、去重和阅读。"),
    ops: REPORT_KINDS.includes(secondary) ? tr("周期报告统一保存在这里，行程安排进入每日行程。") : tr("按关注分类阅读已入库的简报和记忆。经营报告仍在这一页生成。"),
    crew: tr("查看成员职责、台账指令和执行证据；登记状态不代表实时在线。"),
    work: tr("业务项目与协作任务共用入口，各自保留原记录。"),
    learn: tr("繁星引用临时学习行程；银河保存经您采纳的学习计划。"),
    life: tr("繁星保留生活行程；银河自动载入当天到期习惯。"),
    memory: tr("技能、知识原子、内容原料、教训和提示词都来自本机台账。"),
    set: tr("简报自动化、指令规则与导出。"),
  };
  $("workspace").classList.toggle("asset-mode", primary === "memory");
  $("ws-head").innerHTML = `<div class="workspace-heading"><div class="workspace-title"><h1>${esc(["home","department","briefs","crew","work"].includes(primary) && secondary!=="all" ? titleMap[primary] : tr(titleMap[primary] || ""))}</h1><p>${esc(ledeMap[primary] || "")}</p></div></div><button type="button" class="ghost" data-act="manage-records">${tr(tr("管理与归档"))}</button>`;

  const body = safe(() => {
    if (primary === "home") return secondary === "all" ? V.homeAllView(overviewFilter) : V.moduleDetailView(m || { id: secondary, type: "project", title: tr("未知名") });
    if (primary === "deck") return V.deckView();
    if (primary === "department") return V.departmentView(secondary, departmentGoalDraft);
    if (primary === "agenda") return V.agendaView(agendaDate, agendaMode, agendaReportDraft, agendaFilter, {exportPreview:agendaReportExportPreview,saveReceipt:agendaReportSaveReceipt,saving:agendaReportSaving});
    if (primary === "briefs") return V.briefHubView(secondary, briefFilter, briefPreferenceUpdates);
    if (primary === "work") return secondary === "all" ? businessProjectsView() : V.moduleDetailView(m || { id: secondary, type: "project", title: tr("未知名") });
    if (primary === "ops") return V.focusView(secondary);
    if (primary === "crew") return secondary === "all" ? V.crewAllView() : V.agentDetailView(agent(secondary));
    if (primary === "learn") return V.frontView("learn", secondary, learningPlanDraft, learningFormDraft);
    if (primary === "life") return V.frontView("life", secondary);
    if (primary === "memory") return assetsView(secondary, V.memoryView);
    if (primary === "set") return secondary === "help" ? helpView() : V.setView();
    return V.homeAllView();
  }, tr("页面视图"));

  const oldRoom = $("ws-body").querySelector('[data-room-form]');
  const oldChat = $("ws-body").querySelector('.project-messages');
  const reading = oldRoom && oldChat ? {
    runId: oldRoom.dataset.roomForm,
    position: rememberChatPosition(oldChat,oldRoom.dataset.roomForm),
    draft: oldRoom.querySelector('textarea')?.value || '',
    recipient: oldRoom.querySelector('[name=recipient]')?.value || 'all',
    focused: document.activeElement === oldRoom.querySelector('textarea'),
    selectionStart: oldRoom.querySelector('textarea')?.selectionStart,
    selectionEnd: oldRoom.querySelector('textarea')?.selectionEnd,
    selectionDirection: oldRoom.querySelector('textarea')?.selectionDirection,
    inputTop: oldRoom.querySelector('textarea')?.scrollTop,
  } : null;
  $("ws-body").innerHTML = body;
  const newRoom = $("ws-body").querySelector('[data-room-form]');
  if (reading && newRoom?.dataset.roomForm === reading.runId) {
    const recipient = newRoom.querySelector('[name=recipient]');
    if (recipient) recipient.value = reading.recipient;
    const input = newRoom.querySelector('textarea');
    if (input) {
      input.value = reading.draft;
      if (reading.focused) {
        input.focus({ preventScroll: true });
        input.setSelectionRange(reading.selectionStart, reading.selectionEnd, reading.selectionDirection);
      }
      input.scrollTop = reading.inputTop || 0;
    }
  }
  const newChat=$("ws-body").querySelector('.project-messages');
  if(newRoom&&newChat)restoreChatPosition(newChat,newRoom.dataset.roomForm,reading?.runId===newRoom.dataset.roomForm?reading.position:null);
  if(primary === "set" && secondary === "help")void renderLogic();
  bindDrag();
  bindAgenda();
  bindNoteSuggestion(api);
  mountAgendaReports({api,view:agendaMode,anchorDate:agendaDate,jobs:getStore().agendaReportJobs||[],savedJobIds:(getStore().reports||[]).map(r=>r.sourceJobId).filter(Boolean),hasDraft:()=>!!agendaReportDraft,clearDraft:()=>{agendaReportDraft=null;agendaReportExportPreview=null;},onDraft:draft=>{agendaReportDraft=draft;agendaReportExportPreview=null;render();}});
  bindLearningPlan();
  bindDepartment();
  mountSkillStudio();
  mountExecution();
  mountCompactLayout();
  syncPet(getStore().meta?.companion);
  syncComposer();
  if (primary === 'crew' || primary === 'memory') void refreshCapabilities();
  if (primary === 'memory' && secondary === 'knowledge') void refreshVaultStatus();
  if (primary === "set") { void refreshOllamaStatus(); void refreshReminderStatus(); void refreshCodexStatus(); void refreshVaultStatus(); }
}

let capabilityRequest = null;
let capabilityCheckedAt = 0;
async function refreshCapabilities(force = false) {
  if (capabilityRequest || (!force && Date.now() - capabilityCheckedAt < 30000)) return;
  capabilityCheckedAt = Date.now();
  capabilityRequest = api('/api/extensions').then(setCapabilities).catch(error => setCapabilities({ error:error.message }));
  await capabilityRequest;
  capabilityRequest = null;
  if (primary === 'crew' || (primary === 'memory' && secondary === 'extensions')) render();
}

async function refreshVaultStatus() {
  const el = $('vault-status'); if (!el) return;
  if (!getStore().remote?.vault?.enabled) { el.textContent = tr('尚未启用资料库连接。'); return; }
  try {
    const s = await api('/api/vault/status');
    const labels = { indexed:tr('可检索'), excluded:tr('排除'), empty:tr('无文本'), failed:tr('失败'), unsupported:tr('不支持'), needs_ocr:tr('需OCR'), capped:tr('截断'), non_document:tr('非文档'), blocked:tr('阻止访问') };
    el.textContent = ui`登记 ${s.files || 0} 个文件 · ${s.documents || 0} 篇文档 · ${s.chunks || 0} 个文本块 · 同步 ${s.sync?.status || tr('未知')}。` + Object.entries(s.statuses || {}).map(([k,v]) => `${labels[k] || k} ${v}`).join(' · ') + (s.sync?.error ? '。' + s.sync?.error : '');
  } catch (err) { el.textContent = tr('资料库未接通：') + err.message; }
}
async function saveVault() {
  await api('/api/vault/config', { method:'PUT', body:{ enabled:$('vault-enabled').checked, baseUrl:$('vault-base').value.trim(), keyFile:$('vault-key-file').value.trim() } });
  await reload();
}
async function searchVault() {
  const box = $('vault-results'); box.textContent = tr('检索中…');
  try {
    const r = await api('/api/vault/search', { method:'POST', body:{ query:$('vault-query').value.trim() } });
    box.replaceChildren();
    for (const h of r.hits || []) {
      const item = document.createElement('p');
      const link = document.createElement('a'); link.href = h.uri; link.textContent = h.rel;
      item.append(link, document.createElement('br'), document.createTextNode(ui`${h.locator === 'extracted_lines' ? tr('抽取文本行') : tr('原文行')} ${h.start_line}-${h.end_line} · 版本 ${h.source_sha.slice(0,12)}`), document.createElement('br'), document.createTextNode(h.text));
      box.append(item);
    }
    if (!r.hits?.length) box.textContent = tr('没有检到可用依据；请检查资料覆盖和同步状态。');
  } catch (err) { box.textContent = err.message; }
}
async function showVaultFiles() {
  const box = $('vault-files'); box.textContent = tr('读取中…');
  try {
    const r = await api('/api/vault/files?status=' + encodeURIComponent($('vault-file-status').value));
    box.replaceChildren();
    for (const f of r.files) { const row=document.createElement('p'); row.textContent=f.rel + '：' + f.reason; box.append(row); }
    if (!r.files.length) box.textContent=tr('该状态没有文件。');
  } catch (err) { box.textContent=err.message; }
}

function render() {
  if (!getStore()) return;
  if (roomComposing) return;
  parseHash();
  document.documentElement.dataset.theme = (getStore().meta && getStore().meta.theme) || "violet";
  document.title=tr("统筹工作台");
  $("search").placeholder=tr("搜索模块、部门、报告");
  $("composer").querySelector("button[type=submit]").textContent=tr("下达");
  $("cmd-body").placeholder=tr("董事长指令台：选对象（选「全员」即通告），输入指令。下达前会先确认。点项目卡片上的「指挥」可直达。");
  $("cmd-to").setAttribute("aria-label",tr("下达对象"));
  $("rail").setAttribute("aria-label",tr("一级目录"));
  $("sidebar").querySelector(".add-mod").textContent=tr("+ 新模块 / 业务项目");
  rail();
  channels();
  workspace();
}

// ---------- 模块拖拽排序 ----------

function bindDrag() {
  const cards = [...document.querySelectorAll("[data-mod][draggable]")];
  let from = null;
  cards.forEach((el) => {
    el.addEventListener("dragstart", () => {
      from = el.dataset.mod;
      el.classList.add("drag");
    });
    el.addEventListener("dragend", () => el.classList.remove("drag"));
    el.addEventListener("dragover", (e) => e.preventDefault());
    el.addEventListener("drop", async (e) => {
      e.preventDefault();
      const to = el.dataset.mod;
      if (!from || from === to) return;
      const ids = modulesSorted().map((m) => m.id);
      const a = ids.indexOf(from);
      const b = ids.indexOf(to);
      ids.splice(a, 1);
      ids.splice(b, 0, from);
      await api("/api/modules/reorder", { method: "POST", body: { ids } });
      await reload();
    });
  });
}

// ---------- 底部指令台（董事长随时下达，不必进部门） ----------

function currentContext() {
  const m = currentModule();
  if ((primary === "home" || primary === "work") && m) {
    return { relatedId: m.id, relatedModuleId: m.id, label: ui`项目「${m.title}」` };
  }
  return { relatedId: "", relatedModuleId: "", label: "" };
}

function syncComposer() {
  const s = getStore();
  const sel = $("cmd-to");
  const prev = sel.value;
  sel.innerHTML =
    (s.agents || [])
      .map((a) => `<option value="${esc(a.id)}">${esc(a.name)}</option>`)
      .join("") + ui`<option value="__all">📣 全员（通告）</option>`;
  let hint = "";
  const m = currentModule();
  if (primary === "crew" && secondary !== "all") {
    sel.value = secondary;
    hint = tr("已切到该部门");
  } else if ((primary === "home" || primary === "work") && m && (m.ownerAgentId || (m.taskId && taskById(m.taskId) && taskById(m.taskId).ownerAgentId))) {
    const owner = m.ownerAgentId || taskById(m.taskId).ownerAgentId;
    if ([...sel.options].some((o) => o.value === owner)) sel.value = owner;
    hint = ui`已按「${m.title}」责任部门路由`;
  } else if (prev && [...sel.options].some((o) => o.value === prev)) {
    sel.value = prev;
  }
  $("cmd-hint").textContent = hint;
}

// Safe Mode 闸门：下达前先看清楚发给谁、发了什么。
function openSafeConfirm() {
  const to = $("cmd-to").value;
  const body = $("cmd-body").value.trim();
  if (!to || !body) return;
  const all = to === "__all";
  const targetName = all ? tr("全体部门（通告）") : agent(to).name;
  const ctx = currentContext();
  const modal = $("modal");
  modal.hidden = false;
  modal.innerHTML = ui`<div class="sheet">
    <div class="kicker">下达确认 · Safe Mode</div>
    <h2>确认下达这条指令？</h2>
    <div class="msg">
      <div class="who">下达对象</div>
      <div><b>${esc(targetName)}</b>${ctx.label ? ui` · 关联 ${esc(ctx.label)}` : ""}</div>
    </div>
    <div class="msg">
      <div class="who">指令内容</div>
      <div>${esc(body)}</div>
    </div>
    ${all ? ui`<p class="k">全员通告会展开为每人一条，各agent须回执确认。</p>` : ui`<p class="k">对方按 AGENTS.md 领取并推进状态：待领 → 已收悉 → 执行中 → 完成。</p>`}
    <div class="actions">
      <button type="button" class="ghost" data-act="close-modal">取消</button>
      <button type="button" class="solid" data-act="confirm-send">确认下达</button>
    </div>
  </div>`;
}

async function sendCommand() {
  const to = $("cmd-to").value;
  const body = $("cmd-body").value.trim();
  if (!to || !body) return;
  const ctx = currentContext();
  await api("/api/inbox", {
    method: "POST",
    body: { toAgentId: to, body, relatedId: ctx.relatedId, relatedModuleId: ctx.relatedModuleId },
  });
  $("cmd-body").value = "";
  $("cmd-hint").textContent = tr("已下达 ✓");
  setTimeout(() => ($("cmd-hint").textContent = ""), 2500);
  await reload();
}

// ---------- 新模块 / 新事业部 ----------

function openAddModule() {
  const s = getStore();
  const modal = $("modal");
  modal.hidden = false;
  modal.innerHTML = ui`<form class="sheet" id="add-form">
    <h2>新模块 / 新事业部</h2>
    <p>像公司新接一条业务，或新设一个部门：它会出现在指挥舱首页，也可在中栏点进去。</p>
    <label>名称</label><input name="title" type="text" required placeholder="例如：某次调研项目组" />
    <label>类型</label>
    <select name="type" class="full">
      <option value="project">事业部 / 项目</option>
      <option value="crew">舰队观察</option>
      <option value="learn">学习</option>
      <option value="life">生活</option>
      <option value="ops">经营</option>
      <option value="schedule">行程</option>
    </select>
    <label>责任部门（项目建议指定，指令台会自动路由到它）</label>
    <select name="ownerAgentId" class="full">
      <option value="">暂不指定</option>
      ${(s.agents || []).map((a) => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join("")}
    </select>
    <label>优先级 1–5（越大越靠前，仍可拖拽）</label>
    <input name="importance" type="text" value="4" />
    <div class="actions"><button type="button" class="ghost" data-act="close-modal">取消</button><button class="solid" type="submit">加入指挥舱</button></div>
  </form>`;
  $("add-form").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const order = Math.min(...modulesSorted().map((m) => m.order).concat([100])) - 10;
    await api("/api/modules", {
      method: "POST",
      body: {
        title: f.get("title"),
        type: f.get("type"),
        ownerAgentId: f.get("ownerAgentId") || "",
        importance: Number(f.get("importance") || 3),
        order: Number.isFinite(order) ? order : 5,
      },
    });
    modal.hidden = true;
    primary = "home";
    secondary = "all";
    await reload();
  };
}

// ---------- 任务拆解 / 提示词 / 模型路由 ----------

function openDecompose() {
  const modal = $("modal");
  modal.hidden = false;
  modal.innerHTML = V.decomposeModal();
}

function resolveAgent(v) {
  const list = getStore().agents || [];
  const hit = list.find((a) => a.id === v || a.name === v);
  return hit ? hit.id : "";
}

async function createTasksFromDecompose() {
  const out = $("decomp-out") && $("decomp-out").value.trim();
  if (!out) return;
  const lines = out.split("\n").map((l) => l.trim()).filter(Boolean);
  let n = 0;
  for (const line of lines) {
    const [title, owner, note] = line.split("|").map((s) => s.trim());
    if (!title) continue;
    await api("/api/tasks", {
      method: "POST",
      body: {
        title,
        ownerAgentId: resolveAgent(owner || "") || "",
        notes: note || "",
        status: "todo",
        priority: "p2",
        progress: 0,
      },
    });
    n += 1;
  }
  $("modal").hidden = true;
  go("deck", "all");
  await reload();
}

async function aiDecompose() {
  const src = $("decomp-src") && $("decomp-src").value.trim();
  const msg = $("decomp-msg");
  if (!src) {
    msg.textContent = tr("先把原始素材贴进①里。");
    return;
  }
  msg.textContent = tr("AI 拆解中，十几秒属正常……");
  const names = (getStore().agents || []).map((a) => a.name).join("、");
  try {
    const r = await api("/api/llm/generate", {
      method: "POST",
      body: {
        system:
          `你是董事长的首席参谋。把原始素材拆解成待办清单。只输出多行文本，每行一条，格式严格为：任务标题 | 责任部门名称 | 一句话说明。` +
          `责任部门只能从这些里选：${names}，不确定写"未分派"。最多 8 条，不要输出任何其他内容。`,
        prompt: src,
      },
    });
    $("decomp-out").value = (r.text || "").trim();
    msg.textContent = tr("AI 拆解完成，请人工过目再生成待办。参谋的活，董事签的字。");
  } catch (err) {
    msg.textContent = "AI 拆解失败：" + (err.message || err) + "（可到「设置」检查模型路由，或直接手写②）";
  }
}

function openAddPrompt() {
  const modal = $("modal");
  modal.hidden = false;
  modal.innerHTML = ui`<form class="sheet" id="prompt-form">
    <h2>新增提示词（能力资产）</h2>
    <label>标题</label><input name="title" type="text" required />
    <label>标签（逗号分隔）</label><input name="tags" type="text" placeholder="公文, 周报" />
    <label>提示词正文</label><textarea name="body" class="full" required></textarea>
    <div class="actions"><button type="button" class="ghost" data-act="close-modal">取消</button><button class="solid" type="submit">保存</button></div>
  </form>`;
  $("prompt-form").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    await api("/api/prompts", {
      method: "POST",
      body: {
        title: f.get("title"),
        tags: String(f.get("tags") || "").split(",").map((x) => x.trim()).filter(Boolean),
        body: f.get("body"),
      },
    });
    modal.hidden = true;
    await reload();
  };
}

async function saveLlm() {
  const body = {
    provider: $("llm-provider").value,
    baseUrl: $("llm-base").value.trim(),
    model: $("llm-model").value.trim(),
    apiKey: $("llm-key").value.trim() || "__KEEP__",
    enabled: $("llm-enabled").checked,
  };
  await api("/api/llm/config", { method: "PUT", body });
  $("llm-result").textContent = tr("已保存 ✓");
  await reload();
}

async function saveTheme() {
  const theme = $("theme-select").value;
  await api("/api/meta", { method: "PATCH", body: { theme } });
  await reload();
}

async function saveCompanion() {
  const companion = {
    enabled: $("pet-enabled").checked,
    voice: $("pet-voice").checked,
    speakMode: $("pet-always").checked ? "always" : "daily",
    autostart: $("pet-autostart").checked,
  };
  const saved = await api("/api/meta", { method: "PATCH", body: { companion } });
  if (window.benchShell?.applyCompanion) await window.benchShell.applyCompanion(saved.companion || companion);
  await reload();
}

async function refreshReminderStatus() {
  const box = $("reminder-status");
  if (!box) return;
  try {
    const config = await api("/api/reminder/config");
    if (config.enabled && config.hasToken) {
      box.className = "engine-status up";
      box.innerHTML = ui`<b>微信提醒已就绪</b><span>${esc(config.provider === "serverchan" ? tr("Server酱") : "PushPlus")} · ${config.importedFrom === "daily-plan" ? tr("已从旧 daily-plan 迁移") : tr("本机配置")} · 重点事项提前 12 小时发送</span>`;
    } else {
      box.className = "engine-status down";
      box.textContent = tr("微信提醒未启用或缺少 Token；重点事项不会向手机发送。");
    }
  } catch (err) {
    box.className = "engine-status down";
    box.textContent = "无法读取提醒通道状态：" + (err.message || err);
  }
}

async function saveReminder() {
  const body = {
    provider: $("reminder-provider").value,
    token: $("reminder-token").value.trim() || "__KEEP__",
    enabled: $("reminder-enabled").checked,
  };
  await api("/api/reminder/config", { method: "PUT", body });
  await reload();
}

async function refreshOllamaStatus() {
  const box = $("llm-status");
  if (!box) return;
  try {
    const r = await api("/api/llm/status");
    if (r.provider === "openai") {
      if (!r.configured) {
        box.className = "engine-status down";
        box.textContent = tr("在线接口尚未配置完整：请填写 API Key 并启用模型路由。");
        return;
      }
      box.className = "engine-status up";
      const tested = r.lastTest && r.lastTest.ok ? ui`最近测试成功 · ${fmt(r.lastTest.at)}` : tr("已配置 · 请点“测试连接”验证");
      box.innerHTML = ui`<b>在线 OpenAI 兼容接口 ${esc(tested)}</b><span>${esc(r.baseUrl)} · ${esc(r.model || tr("未填写模型"))}</span>`;
      return;
    }
    if (!r.ok) {
      box.className = "engine-status down";
      box.textContent = ui`本地 Ollama 未连通 · ${r.baseUrl} · ${r.error || tr("请检查 Docker 容器")}`;
      return;
    }
    box.className = "engine-status up";
    box.innerHTML = ui`<b>本地 Ollama 已就绪</b><span>${esc(r.baseUrl)} · v${esc(r.version || "—")} · ${r.models.length} 个可用模型</span>`;
    const list = $("llm-model-list");
    if (list) list.innerHTML = r.models.map((m) => `<option value="${esc(m.name)}"></option>`).join("");
  } catch (err) {
    box.className = "engine-status down";
    box.textContent = "无法检测本地 Ollama：" + (err.message || err);
  }
}

async function refreshCodexStatus() {
  const box = $("codex-status"); if (!box) return;
  try {
    const r = await api("/api/codex/status");
    box.className = "engine-status " + (r.ok ? "up" : "down");
    box.textContent = r.ok ? ui`${r.version} · 已通过 ChatGPT 登录 · 可测试真实调用` : r.error;
  } catch (err) { box.textContent = "无法检测 Codex：" + err.message; }
}
async function startCodex(body, button) {
  if (button) button.disabled = true;
  try { await api("/api/codex/jobs", { method: "POST", body }); await reload(); }
  catch (err) { window.alert("Codex 未启动：" + err.message); if (button) button.disabled = false; }
}
setInterval(async () => {
  if (!(getStore()?.codexJobs || []).some(j => j.status === "doing")) return;
  try {
    const { jobs } = await api("/api/codex/jobs");
    if (JSON.stringify(jobs) !== JSON.stringify(getStore().codexJobs)) await reload();
  } catch (_) { /* 服务暂时不可用时保留现有页面 */ }
}, 3000);

// 项目房间 M1 采用短轮询：只在正在查看具体工作链时刷新，避免打扰其他页面。
setInterval(async () => {
  const hash = location.hash || "";
  const route = resolveRoute(hash);
  if (route.primary !== 'department' || ['all','new'].includes(route.secondary)) return;
  try {
    const runId = route.secondary;
    const result = await api(`/api/departments/runs/${encodeURIComponent(runId)}/messages`);
    const current = (getStore().projectMessages || []).filter((item) => item.runId === runId);
    const jobsChanged = JSON.stringify((result.chatJobs || []).filter(job=>!job.archived)) !== JSON.stringify((getStore().chatJobs || []).filter(j => j.runId === runId));
    if (jobsChanged || JSON.stringify((result.messages||[]).filter(message=>!message.archived)) !== JSON.stringify(current)) await reload();
  } catch (_) { /* 项目房间刷新失败时保留当前状态 */ }
}, 5000);

async function enableOllama() {
  $("llm-provider").value = "ollama";
  $("llm-base").value = "http://127.0.0.1:11434";
  if (!$("llm-model").value.trim()) $("llm-model").value = "qwen2.5:7b";
  $("llm-enabled").checked = true;
  await saveLlm();
  await testLlm();
}

async function testLlm() {
  $("llm-result").textContent = tr("测试中……");
  await saveLlm();
  try {
    const r = await api("/api/llm/test", { method: "POST", body: {} });
    $("llm-result").textContent = "连接成功：模型回复「" + r.text + "」";
  } catch (err) {
    $("llm-result").textContent = "连接失败：" + (err.message || err);
  }
}

function bindAgenda() {
  const form = $("agenda-form");
  if (form) {
    if (!agendaEditId && agendaFormDraft) {
      for (const [name, value] of Object.entries(agendaFormDraft)) {
        const field = form.elements.namedItem(name); if (!field) continue;
        if (field.type === 'checkbox') field.checked = Boolean(value); else field.value = value;
      }
    }
    if (agendaEditId && agendaEditDraft) {
      const dateLabel = document.createElement('label');
      dateLabel.textContent = tr('行程日期');
      const dateInput = document.createElement('input');
      dateInput.type = 'date'; dateInput.name = 'date'; dateInput.required = true;
      dateLabel.append(dateInput);
      form.querySelector('.section-head').after(dateLabel);
      for (const [name, value] of Object.entries(agendaEditDraft)) {
        const field = form.elements.namedItem(name);
        if (!field) continue;
        if (field.type === "checkbox") field.checked = Boolean(value);
        else field.value = value;
      }
      form.querySelector("h2").textContent = tr("修改行程");
      form.querySelector('[type="submit"]').textContent = tr("保存修改");
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "ghost";
      cancel.textContent = tr("取消修改");
      cancel.onclick = () => { agendaEditId = null; agendaEditDraft = null; render(); };
      form.append(cancel);
    }
    form.oninput = () => {
      const values = new FormData(form);
      const draft = Object.fromEntries(values); draft.important = Boolean(values.get('important'));
      if (agendaEditId) agendaEditDraft = draft; else agendaFormDraft = draft;
    };
    form.onsubmit = async (e) => {
      e.preventDefault();
      const f = new FormData(form);
      const title = String(f.get("title") || "").trim();
      if (!title) return;
      const original = agendaEditId && (getStore().agendas || []).find(item => item.id === agendaEditId);
      if (agendaEditId && !original) throw new Error(tr("该行程已不存在，请取消修改后刷新。"));
      const scheduledDate = original ? String(f.get('date') || original.date) : agendaDate;
      await api(agendaEditId ? `/api/agendas/${agendaEditId}` : "/api/agendas", {
        method: agendaEditId ? "PATCH" : "POST",
        body: {
          date: scheduledDate,
          time: String(f.get("time") || ""),
          title,
          category: String(f.get("category") || ""),
          tags: String(f.get("tags") || "").split(",").map((x) => x.trim()).filter(Boolean),
          note: String(f.get("note") || "").trim(),
          materials: String(f.get("materials") || "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean).map((path) => {
            const existing = (original?.materials || []).find(material => (typeof material === "string" ? material : material.path) === path);
            return existing && typeof existing === "object" ? { ...existing } : { path };
          }),
          important: Boolean(f.get("important")),
          ...(original ? {} : { done: false }),
        },
      });
      if (original && scheduledDate !== original.date) {
        agendaDate = scheduledDate;
        agendaFilter = 'all';
        agendaReportDraft = null;
      }
      agendaEditId = null;
      agendaEditDraft = null;
      agendaFormDraft = null;
      resetSuggestion();
      await reload();
    };
  }
  const date = $("agenda-date");
  if (date) date.onchange = () => { agendaDate = date.value || ymd(); agendaFilter = "all"; agendaReportDraft = null; agendaEditId = null; agendaEditDraft = null; agendaFormDraft = null; resetSuggestion(); render(); };
}

function editAgenda(id) {
  const item = (getStore().agendas || []).find(entry => entry.id === id);
  if (!item) return;
  agendaEditId = id;
  agendaEditDraft = {
    date: item.date,
    time: item.time || "", title: item.title || "", category: item.category || "工作",
    tags: (item.tags || []).join(", "), note: item.note || "",
    materials: (item.materials || []).map(material => typeof material === "string" ? material : material.path).join("\n"),
    important: Boolean(item.important),
  };
  agendaDate = item.date;
  agendaMode = "day";
  agendaFilter = "all";
  render();
  $("agenda-form")?.scrollIntoView({ block: "center", behavior: "smooth" });
  $("agenda-form")?.elements.namedItem("title")?.focus({ preventScroll: true });
}

function bindLearningPlan() {
  const form = $("learning-plan-form");
  if (!form) return;
  const capture = () => {
    const f = new FormData(form);
    saveLearningFormDraft({
      goal: f.get("goal"), content: f.get("content"), availability: f.get("availability"),
      deadline: f.get("deadline"), sessionMinutes: f.get("sessionMinutes"),
    });
  };
  form.addEventListener("input", capture);
  form.addEventListener("change", capture);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    capture();
    const submit = form.querySelector("button[type=submit]");
    if (submit) { submit.disabled = true; submit.textContent = tr("当前模型正在制定候选计划…"); }
    try {
      const result = await api("/api/learning/plans/draft", {
        method: "POST",
        body: {
          goal: String(f.get("goal") || "").trim(),
          content: String(f.get("content") || "").trim(),
          availability: String(f.get("availability") || "").trim(),
          deadline: String(f.get("deadline") || "").trim(),
          sessionMinutes: Number(f.get("sessionMinutes")) || 45,
        },
      });
      learningPlanDraft = result.draft;
      render();
    } catch (err) {
      window.alert("学习计划未生成：" + (err.message || err) + "。请到“设置”确认当前模型路由已启用并测试连接成功。");
      if (submit) { submit.disabled = false; submit.textContent = tr("由当前模型制定候选计划"); }
    }
  };
}

function bindDepartment() {
  bindDelivery(api, reload);
  document.querySelectorAll('[data-chat-retry]').forEach(button => { button.onclick = async () => {
    button.disabled = true;
    try { await api(`/api/departments/runs/${encodeURIComponent(button.dataset.runId)}/chat-jobs/${encodeURIComponent(button.dataset.chatRetry)}/retry`, {method:'POST',body:{}}); await reload(); }
    catch (err) { window.alert('回复未能重试：'+err.message); button.disabled=false; }
  }; });
  document.querySelectorAll("form[data-handoff-form]").forEach((sealForm) => {
    sealForm.onsubmit = async (e) => {
      e.preventDefault();
      const data = new FormData(sealForm);
      const button = sealForm.querySelector("button[type=submit]");
      if (button) button.disabled = true;
      try {
        await api(`/api/departments/runs/${encodeURIComponent(sealForm.dataset.handoffForm)}/handoff`, {
          method: "POST",
          body: {
            itemId: String(data.get("itemId") || ""),
            summary: String(data.get("summary") || "").trim(),
            decisions: String(data.get("decisions") || ""),
            openQuestions: String(data.get("openQuestions") || ""),
            nextAction: String(data.get("nextAction") || ""),
          },
        });
        await reload();
      } catch (err) {
        window.alert(tr("交接未能封印：") + (err.message || err));
        if (button) button.disabled = false;
      }
    };
  });
  const form = $("department-goal-form");
  if (!form) return;
  const capture = () => {
    const data = new FormData(form);
    saveDepartmentGoalDraft({ goal: data.get("goal"), context: data.get("context") });
  };
  form.addEventListener("input", capture);
  form.onsubmit = async (e) => {
    e.preventDefault();
    capture();
    const data = new FormData(form);
    const goal = String(data.get("goal") || "").trim();
    if (!goal) return;
    const participantAgentIds = data.getAll("participantAgentIds").map((value) => String(value));
    const run = await api("/api/departments/runs", { method: "POST", body: { goal, context: String(data.get("context") || "").trim(), participantAgentIds, v2: data.get("v2") === "1", delivery: { mode: data.get("deliveryProfile") === "text" ? "text" : "files", profile: data.get("deliveryProfile") } } });
    clearDepartmentGoalDraft();
    await reload();
    go("department", run.id);
  };
}

async function sendProjectMessage(form) {
  const runId = form.dataset.roomForm;
  const text = String(new FormData(form).get("text") || "").trim();
  if (!runId || !text) return;
  const button = form.querySelector("button[type=submit]");
  if (button?.disabled) return;
  if (button) { button.disabled = true; button.textContent = tr("发送中…"); }
  try {
    const recipient = String(new FormData(form).get('recipient') || 'all');
    await api(`/api/departments/runs/${encodeURIComponent(runId)}/messages`, { method: "POST", body: { sender: "chairman", recipient, type: "question", text, chat: true } });
    const currentForm = document.querySelector('form[data-room-form]');
    const currentInput = currentForm?.querySelector('textarea');
    if (currentForm?.dataset.roomForm === runId && currentInput?.value.trim() === text) currentInput.value = '';
    await reload();
  } catch (err) {
    window.alert("项目消息未发送：" + (err.message || err));
    if (button) { button.disabled = false; button.textContent = tr("发送"); }
  }
}

async function modelExecuteDepartment(runId, itemId, button) {
  const original = button && button.textContent;
  if (button) { button.disabled = true; button.textContent = tr("当前模型正在工作…"); }
  try {
    await api(`/api/departments/runs/${runId}/items/${itemId}/model-execute`, { method: "POST", body: {} });
    await reload();
  } catch (err) {
    window.alert("本阶段未完成：" + (err.message || err) + "。目标和当前进度已保留，可检查模型连接，或改用人工 / 外部 Agent 回填。");
    if (button) { button.disabled = false; button.textContent = original; }
  }
}

async function autoRunDepartment(runId, button) {
  if (!window.confirm(tr("通过已登录的 Codex 拆解目标；完成后等待真实执行成员领取任务。确认启动？"))) return;
  const original = button && button.textContent;
  if (button) { button.disabled = true; button.textContent = tr("正在启动 Codex…"); }
  try {
    await api(`/api/departments/runs/${encodeURIComponent(runId)}/automation`, {
      method: "POST", body: { enabled: true, retry: true, workbuddyTransport: "desktop-scheduled" },
    });
    const result = await api(`/api/departments/runs/${runId}/auto-run`, { method: "POST", body: {} });
    await reload();
    if (result.waitingForAgent) window.alert(ui`主管方案已完成，等待 ${result.waitingForAgent} 真实执行；目前不会自动唤醒外部软件。`);
  } catch (err) {
    window.alert("Codex 启动失败：" + (err.message || err) + "。已完成的阶段不会丢失，请查看 Codex 任务错误后重试。 ");
    if (button) { button.disabled = false; button.textContent = original; }
  }
}

function openDepartmentManual(runId, itemId) {
  const run = (getStore().departmentRuns || []).find((entry) => entry.id === runId);
  const item = run && (run.items || []).find((entry) => entry.id === itemId);
  if (!item) return;
  const isReview = item.role === "reviewer";
  let reviewedSnapshot = null;
  if (isReview && run.delivery?.contract?.mode === "files") {
    api(`/api/departments/runs/${runId}/delivery`).then(result => { reviewedSnapshot = result.snapshot; }).catch(error => { alert(error.message); });
  }
  const modal = $("modal");
  modal.hidden = false;
  modal.innerHTML = ui`<form class="sheet" id="department-manual-form">
    <div class="kicker">虚拟部门 · ${esc(item.label)}</div><h2>回填真实成果</h2>
    <p class="k">适用于您本人或尚未自动接入的 Cursor、Codex、WorkBuddy、ChatGPT。工作台只记录实际回填内容，不声称已经自动唤醒它们。</p>
    ${isReview ? ui`<label>复核结论</label><select name="verdict" class="full"><option value="pass">通过</option><option value="reject">退回返工</option></select>` : ""}
    ${isReview && run.delivery?.contract?.mode === "files" ? ui`<label><input type="checkbox" name="fileChecked">我已实际核对本批文件及源版本</label>` : ""}
    <label>${isReview ? tr("复核意见") : tr("阶段成果")}</label><textarea name="output" class="full" style="min-height:220px" required>${esc(item.output || "")}</textarea>
    ${!isReview ? ui`<label>材料路径（每行一条，可选）</label><textarea name="materials" class="full">${esc((item.materials || []).join("\n"))}</textarea>` : ""}
    <div class="actions"><button type="button" class="ghost" data-act="close-modal">取消</button><button type="submit" class="solid">确认写入台账</button></div>
  </form>`;
  $("department-manual-form").onsubmit = async (e) => {
    e.preventDefault();
    const data = new FormData(e.target);
    const output = String(data.get("output") || "").trim();
    const claim=(getStore().executionAttempts||[]).find(a=>a.id===item.activeAttemptId);
    const receipt=claim?{attemptId:claim.id,claimId:claim.claimId}:{};
    const action = isReview ? "review" : item.status === "rework" ? "rework" : "submit";
    if (!isReview && item.status === "queued") {
      await api(`/api/departments/runs/${runId}/items/${itemId}/action`, { method: "POST", body: { action: "start" } });
    }
    await api(`/api/departments/runs/${runId}/items/${itemId}/action`, {
      method: "POST",
      body: isReview
        ? { ...receipt, action, verdict: data.get("verdict"), comment: output, reviewerAgentId: item.ownerAgentId, reviewedSnapshot: data.get("fileChecked") ? reviewedSnapshot : null }
        : { ...receipt, action, output, materials: String(data.get("materials") || "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean) },
    });
    modal.hidden = true;
    await reload();
  };
}

async function toggleHabit(id) {
  const item = ((getStore().lifeSystem || {}).habitRuns || []).find((x) => x.id === id);
  if (!item) return;
  await api(`/api/life/habits/${id}`, { method: "PATCH", body: { done: !item.done, skipped: false } });
  await reload();
}

async function toggleLearningSession(planId, sessionId) {
  const plan = ((getStore().lifeSystem || {}).learningPlans || []).find((x) => x.id === planId);
  const session = plan && (plan.sessions || []).find((x) => x.id === sessionId);
  if (!session) return;
  await api(`/api/learning/plans/${planId}/sessions/${sessionId}`, { method: "PATCH", body: { done: !session.done } });
  await reload();
}

async function adoptLearningDraft() {
  if (!learningPlanDraft) return;
  await api("/api/learning/plans", { method: "POST", body: learningPlanDraft });
  learningPlanDraft = null;
  clearLearningFormDraft();
  await reload();
}

function setAgendaFilter(filter) {
  if (!["all", "done", "pending", "important"].includes(filter)) return;
  // A filter changes the list, not an appointment being entered or edited.
  const form = $("agenda-form");
  const draft = form ? new FormData(form) : null;
  const reportBody = $("agenda-report-body");
  if (reportBody && agendaReportDraft) agendaReportDraft.body = reportBody.value;
  agendaFilter = filter;
  render();
  const newForm = $("agenda-form");
  if (draft && newForm) {
    for (const field of newForm.elements) {
      if (!field.name) continue;
      if (field.type === "checkbox") field.checked = draft.has(field.name);
      else field.value = draft.get(field.name) ?? "";
    }
  }
  $("ws-body").querySelector(`[data-agenda-filter="${filter}"]`)?.focus({ preventScroll: true });
}

function setAgendaView(mode) {
  if (!["day", "week", "month"].includes(mode)) return;
  agendaMode = mode;
  agendaFilter = "all";
  agendaReportDraft = null;
  render();
}

function shiftAgendaPeriod(shift) {
  const [year, month, day] = agendaDate.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  if (agendaMode === "month") date.setMonth(date.getMonth() + shift);
  else if (agendaMode === "week") date.setDate(date.getDate() + 7 * shift);
  else date.setDate(date.getDate() + shift);
  agendaDate = ymd(date);
  agendaFilter = "all";
  agendaReportDraft = null;
  render();
}

async function toggleAgenda(id) {
  const item = (getStore().agendas || []).find((x) => x.id === id);
  if (!item) return;
  await api(`/api/agendas/${id}`, { method: "PATCH", body: { done: !item.done } });
  await reload();
}

async function updateBriefPreference(button, favorite) {
  const runId = button.dataset.id;
  const run = (getStore().briefRuns || []).find(item => item.id === runId);
  if (!run || briefPreferenceUpdates.has(runId)) return;
  briefPreferenceUpdates.add(runId);
  button.closest('.brief-run')?.setAttribute('aria-busy', 'true');
  button.closest('.brief-run')?.querySelectorAll('button').forEach(item => { item.disabled = true; });
  try {
    await api(`/api/brief-runs/${encodeURIComponent(runId)}`, { method: "PATCH", body: favorite ? { favorite: run.favorite !== true } : { unread: false } });
    briefPreferenceUpdates.delete(runId);
    await reload();
  } catch (error) {
    briefPreferenceUpdates.delete(runId);
    render();
    window.alert(tr("简报状态保存失败：") + error.message);
  }
}

async function reviewAgenda(id) {
  const item = (getStore().agendas || []).find((x) => x.id === id);
  if (!item) return;
  openReviewNote(item, api, reload);
}

async function editAgendaMaterials(id) {
  const item = (getStore().agendas || []).find((x) => x.id === id);
  if (!item) return;
  const current = (item.materials || []).map((material) => typeof material === "string" ? material : material.path).filter(Boolean).join("\n");
  const raw = window.prompt(tr("填写材料存放路径（每行一条；留空可清除）："), current);
  if (raw === null) return;
  const materials = raw.split(/\r?\n/).map((value) => value.trim()).filter(Boolean).map((path) => ({ path }));
  await api(`/api/agendas/${id}`, { method: "PATCH", body: { materials } });
  await reload();
}

async function deleteAgenda(id) {
  const item = (getStore().agendas || []).find((x) => x.id === id);
  if (!item || !window.confirm(ui`删除行程「${item.title}」？`)) return;
  await api(`/api/agendas/${id}`, { method: "DELETE" });
  await reload();
}

async function openAgendaMaterial(id, index) {
  try {
    const result = await api(`/api/agendas/${id}/open-material`, { method: "POST", body: { index: Number(index) } });
    if (!result.ok) throw new Error(result.error || tr("无法打开材料路径"));
  } catch (err) {
    window.alert("材料路径无法打开：" + (err.message || err) + "。请确认该文件或文件夹仍存在。");
  }
}

async function draftAgendaReport() {
  await startAgendaReport();
}

async function saveAgendaReport(historical = false) {
  if (!agendaReportDraft) return;
  const body = $("agenda-report-body") ? $("agenda-report-body").value : agendaReportDraft.body;
  if (!body.trim()) return;
  if (agendaReportDraft.kind === 'monthly' && agendaReportDraft.sourceJobId) return saveMonthlyReport(body,historical);
  try { await api("/api/reports", { method: "POST", body: { ...agendaReportDraft, body } }); }
  catch(error) { window.alert(tr('报告保存失败，当前草稿已保留：') + error.message); return; }
  agendaReportDraft = null;
  await reload();
}

async function saveMonthlyReport(body, historical) {
  if (agendaReportSaving) return;
  const draft = agendaReportDraft;
  draft.body = body; agendaReportSaving = true; agendaReportSaveReceipt = null;
  document.querySelectorAll('[data-act="agenda-report-save"],[data-act="agenda-report-save-historical"],[data-act="agenda-report-regenerate"]').forEach(button=>button.disabled=true);
  let reloadNeeded = false;
  try {
    const input={sourceJobId:draft.sourceJobId,sourceHash:draft.sourceHash,body};
    const preview=await api('/api/agenda/reports/export/preview',{method:'POST',body:input});
    if (agendaReportDraft !== draft || $('agenda-report-body')?.value !== body) {
      window.alert(tr('保存确认期间正文已变化，当前修改已保留，请再次保存。')); return;
    }
    if (preview.sourceState === 'changed' && !historical) { agendaReportExportPreview=preview; return; }
    const payload={...input,previewSnapshot:preview.snapshot,confirmedHistorical:historical===true};
    const identity=JSON.stringify(payload);
    if (agendaReportSaveCommand?.identity !== identity) agendaReportSaveCommand={identity,key:crypto.randomUUID()};
    const result=await api('/api/agenda/reports/export/save',{method:'POST',body:{...payload,idempotencyKey:agendaReportSaveCommand.key}});
    agendaReportSaveReceipt=result.export;agendaReportSaveCommand=null;agendaReportExportPreview=null;reloadNeeded=true;
    if (agendaReportDraft===draft && $('agenda-report-body')?.value===body) agendaReportDraft=null;
    else if (agendaReportDraft===draft) draft.notice=tr('已保存所提交版本；保存期间的新修改仍在草稿中，请再次确认保存。');
  } catch(error) {
    let detail=error.message;try{const e=JSON.parse(detail);detail=e.message||e.error||detail;}catch{}
    window.alert(tr('报告保存失败，当前草稿已保留：')+detail);
  } finally { agendaReportSaving=false;if(reloadNeeded)await reload();else render(); }
}

async function draftAgendaWithAi() {
  const box = $("agenda-ai-output");
  if (!box) return;
  box.hidden = false;
  const entries = (getStore().agendas || []).filter((x) => x.date === agendaDate);
  if (!entries.length) {
    box.textContent = tr("请先录入至少一条真实事项。为了不凭空编造会议、人员或任务，空日程不调用 AI。");
    return;
  }
  box.textContent = tr("正在请本地 Ollama 只对已有事项进行排序…");
  const events = entries.map((x, i) => `[${i + 1}] ${x.time || tr("待定")} | ${x.title}${x.done ? tr("（已完成）") : ""}`).join("\n");
  try {
    const r = await api("/api/llm/generate", {
      method: "POST",
      body: {
        system: "你是本地工作台的日程助理。只能对用户提供的条目排序；不得添加任何会议、人物、部门、材料或新事项。仅输出不超过三行，每行格式为：建议时间 | [原条目编号] 原条目标题。信息不足时只回复：保持原顺序。",
        prompt: `日期：${agendaDate}。以下是唯一允许引用的真实事项：\n${events}\n请只给排序建议。`,
      },
    });
    box.textContent = r.text || tr("模型没有返回建议。");
  } catch (err) {
    box.textContent = "AI 建议未生成：" + (err.message || err) + "。请先到设置启用本地 Ollama。";
  }
}

// ---------- 全局事件 ----------

document.addEventListener("click", async (e) => {
  const brief = e.target.closest("[data-brief]");
  if (brief) {
    const act = brief.dataset.brief;
    if (act === "skip") {
      await api("/api/briefings/dismiss", { method: "POST", body: {} });
      $("briefing").hidden = true;
      $("briefing").innerHTML = "";
    } else {
      briefIndex += 1;
      if (briefIndex >= briefs.length) {
        await api("/api/briefings/dismiss", { method: "POST", body: {} });
        $("briefing").hidden = true;
        $("briefing").innerHTML = "";
      } else showBrief();
    }
    return;
  }
  // 指挥按钮：锁定指令台对象并聚焦（先于模块卡片导航判断）
  const cmd = e.target.closest("[data-cmd]");
  if (cmd) {
    const sel = $("cmd-to");
    if ([...sel.options].some((o) => o.value === cmd.dataset.cmd)) sel.value = cmd.dataset.cmd;
    $("cmd-hint").textContent = tr("已锁定下达对象，请输入指令");
    $("composer").scrollIntoView({ behavior: "smooth", block: "nearest" });
    $("cmd-body").focus();
    return;
  }
  const p = e.target.closest("[data-primary]");
  if (p) return go(p.dataset.primary, "all");
  const s = e.target.closest("[data-sec]");
  if (s) return go(primary, s.dataset.sec);
  const modCard = e.target.closest("[data-mod]");
  if (modCard && (primary === "home" || primary === "work")) {
    const module = getStore().modules.find(m => m.id === modCard.dataset.mod);
    if (module) { const target = moduleTarget(module); return go(target.primary, target.secondary); }
  }
  const act = e.target.closest("[data-act]");
  if (!act) return;
  const a = act.dataset.act;
  if (a === 'overview-filter' && ['home','work'].includes(primary) && secondary === 'all') {
    const filter = act.dataset.overviewFilter;
    if (!['all','doing','today','risks','members'].includes(filter)) return;
    overviewFilter = filter; render();
    document.querySelector(`[data-act="overview-filter"][data-overview-filter="${filter}"]`)?.focus({preventScroll:true});
    return;
  }
  if (a === 'refresh-extensions') return refreshCapabilities(true);
  if (a === "close-modal") $("modal").hidden = true;
  if (a === "add-module") openAddModule();
  if (a === "open-decompose") openDecompose();
  if (a === "ai-decompose") aiDecompose();
  if (a === "create-tasks") await createTasksFromDecompose();
  if (a === "add-prompt") openAddPrompt();
  if (a === "codex-test") await startCodex({ test: true }, act);
  if (a === "codex-run") await startCodex({ runId: act.dataset.runId, role: act.dataset.role }, act);
  if (a === "save-llm") await saveLlm();
  if (a === 'resume-siliconflow') {
    if (!window.confirm(tr('恢复后 SiliconFlow 请求可能产生费用，确认恢复？'))) return;
    await api('/api/llm/provider-pause',{method:'POST',body:{provider:'siliconflow',paused:false,confirmed:true}}); await reload();
  }
  if (a === 'save-vault') await saveVault();
  if (a === 'refresh-vault') await refreshVaultStatus();
  if (a === 'search-vault') await searchVault();
  if (a === 'vault-files') await showVaultFiles();
  if (a === 'sync-vault') { try { await api('/api/vault/sync',{method:'POST',body:{}}); await refreshVaultStatus(); } catch(err) { $('vault-status').textContent=err.message; } }
  if (a === "test-llm") await testLlm();
  if (a === "enable-ollama") await enableOllama();
  if (a === "save-theme") await saveTheme();
  if (a === "save-companion") return saveCompanion();
  if (a === "preview-greeting") return previewGreeting();
  if (a === "asset-rescan") return reload();
  if (a === "open-system") {
    const url = act.dataset.url || "";
    if (window.benchShell?.openExternal) await window.benchShell.openExternal(url);
    else window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  if (a === "manage-records") openArchive(primary,reload);
  if (a === "save-language") { await api("/api/meta",{method:"PATCH",body:{language:$("language-select").value}}); await reload(); }
  if (a === "save-reminder") await saveReminder();
  if (a === "agenda-toggle") await toggleAgenda(act.dataset.id);
  if (a === "agenda-materials") await editAgendaMaterials(act.dataset.id);
  if (a === "agenda-review") await reviewAgenda(act.dataset.id);
  if (a === "agenda-notes") await openNotesManager(getStore().agendas || [], api, reload);
  if (a === "agenda-delete") await deleteAgenda(act.dataset.id);
  if (a === "agenda-edit") editAgenda(act.dataset.id);
  if (a === "agenda-ai-draft") await draftAgendaWithAi();
  if (a === "agenda-view") setAgendaView(act.dataset.view);
  if (a === "agenda-filter") setAgendaFilter(act.dataset.agendaFilter);
  if (a === "agenda-nav") shiftAgendaPeriod(Number(act.dataset.shift || 0));
  if (a === "agenda-open-day") { agendaDate = act.dataset.date || agendaDate; setAgendaView("day"); }
  if (a === "agenda-open-material") await openAgendaMaterial(act.dataset.id, act.dataset.index);
  if (a === "agenda-report-draft") await draftAgendaReport();
  if (a === "agenda-report-save") await saveAgendaReport();
  if (a === 'agenda-report-save-historical') await saveAgendaReport(true);
  if (a === 'agenda-report-regenerate') await startAgendaReport({confirmedReplace:true});
  if (a === 'agenda-report-save-cancel') { agendaReportExportPreview=null;render(); }
  if (a === "agenda-report-discard") { agendaReportDraft = null; render(); }
  if (a === "habit-toggle") await toggleHabit(act.dataset.id);
  if (a === "learning-session-toggle") await toggleLearningSession(act.dataset.planId, act.dataset.sessionId);
  if (a === "learning-draft-adopt") await adoptLearningDraft();
  if (a === "learning-draft-discard") { learningPlanDraft = null; render(); }
  if (a === "department-model-execute") await modelExecuteDepartment(act.dataset.runId, act.dataset.itemId, act);
  if (a === "department-auto-run") await autoRunDepartment(act.dataset.runId, act);
  if (a === "department-manual") openDepartmentManual(act.dataset.runId, act.dataset.itemId);
  if (a === "external-retry") {
    const runId = act.dataset.runId;
    act.disabled = true;
    act.textContent = tr("正在重试…");
    try {
      await api(`/api/departments/runs/${encodeURIComponent(runId)}/automation`, {method:"POST",body:{enabled:true,retry:true}});
      await reload();
      const latest = (getStore().externalJobs || []).find(job => job.runId === runId);
      window.alert(latest?.status === 'failed' ? "重试未能启动：" + latest.error : tr("重试请求已提交，请查看成员自动执行状态。等待 WorkBuddy 领取时，也可手动运行其领取任务。"));
    } catch (error) {
      window.alert("重试失败：" + error.message);
    } finally {
      act.disabled = false;
      act.textContent = tr("重试成员执行");
    }
  }
  if (a === "agent-invitation") {
    const run = (getStore().departmentRuns || []).find(r => r.id === act.dataset.runId);
    if (!run) return;
    const root = tr("D:\\OneDrive\\Desktop\\Ben_My_Agent\\5.cursor\\搭建工作台");
    const invitations = ["workbuddy", "cursor"].map(member => {
      const item = run.items.find(stage => stage.ownerAgentId === member);
      const text = ui`请接入正式项目 ${run.id}。先读取 ${root}\\docs\\Agent接入邀请与项目协作协议.md。你的阶段：${item ? item.role + " / " + item.id : tr("协作成员")}。在你的工具环境运行：\nnode "${root}\\agent-client.js" wait ${member} ${run.id}\n有任务返回后先读取目标、约束、主管方案和项目原件，再执行。无任务时检查依赖并再次运行 wait；不要生成模拟回执。结果按协议通过 submit 回写。报告完整写作仍遵守用户的 Start Writing 要求。`;
      return `<h3>${member}</h3><textarea class="full" rows="8" readonly>${esc(text)}</textarea>`;
    }).join("");
    $("modal").innerHTML = ui`<div class="sheet"><h2>一次性成员接入邀请</h2><p>将对应邀请发到成员自己的会话。领取命令会等待最多50秒，不会自行启动该软件。</p>${invitations}<button type="button" class="ghost" data-act="close-modal">关闭</button></div>`;
    $("modal").hidden = false;
  }
  if (a === "project-manage") {
    const run = (getStore().departmentRuns || []).find(r => r.id === act.dataset.runId);
    if (!run) return;
    const operation = act.dataset.operation;
    let body = {};
    if (operation === "delete") {
      if (!window.confirm(ui`删除项目“${run.title}”？将删除工作台中的消息、阶段成果和成果登记，项目目录内的实际文件保留。`)) return;
      await api(`/api/departments/runs/${encodeURIComponent(run.id)}`, { method: "DELETE" });
    } else {
      if (operation === "rename") {
        const title = window.prompt(tr("项目名称"), run.title);
        if (title === null || !title.trim()) return;
        body.title = title.trim();
      } else if (operation === "pin") body.pinned = !run.pinned;
      else if (operation === "archive") { openArchive("department",reload,{collection:"departmentRuns",id:run.id}); return; }
      await api(`/api/departments/runs/${encodeURIComponent(run.id)}`, { method: "PATCH", body });
    }
    await reload();
    if (operation === "delete") go("department", "all");
  }
  if (a === "confirm-send") {
    $("modal").hidden = true;
    await sendCommand();
  }
  if (a === "sync") {
    await api("/api/crew/sync", { method: "POST", body: {} });
    await refreshCapabilities(true);
  }
  if (a === "gen") {
    await api("/api/reports/generate", { method: "POST", body: { kind: act.dataset.kind } });
    await reload();
  }
  if (a === "save-report") {
    const body = $("report-body") && $("report-body").value;
    await api(`/api/reports/${act.dataset.id}`, { method: "PATCH", body: { body } });
    await reload();
  }
  if (a === "brief-filter") {
    const filter = act.dataset.briefFilter;
    if (["all", "today", "unread", "favorite"].includes(filter)) {
      go("briefs", "all", filter);
      $("ws-body").querySelector(`[data-brief-filter="${filter}"]`)?.focus({ preventScroll: true });
    }
  }
  if (a === "brief-source") {
    go("briefs", act.dataset.sourceId);
    $("ws-body").querySelector('.brief-source-card[aria-pressed="true"]')?.focus({ preventScroll: true });
  }
  if (a === "brief-read") await updateBriefPreference(act, false);
  if (a === "brief-favorite") await updateBriefPreference(act, true);
  if (a === "backup") {
    const blob = new Blob([JSON.stringify(getRawStore(), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "workbench-store.json";
    link.click();
    URL.revokeObjectURL(url);
  }
});

document.addEventListener("keydown", (e) => {
  if (!e.target.matches('.room-composer textarea') || e.key !== 'Enter' || !e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
  if (roomComposing || e.isComposing || e.keyCode === 229) return;
  e.preventDefault();
  const form = e.target.closest('form[data-room-form]');
  const button = form?.querySelector('button[type=submit]');
  if (form && button && !button.disabled && !e.repeat) form.requestSubmit(button);
});

document.addEventListener("submit", async (e) => {
  const form = e.target.closest("form[data-room-form]");
  if (!form) return;
  e.preventDefault();
  await sendProjectMessage(form);
});

$("search").addEventListener("input", (e) => {
  search = e.target.value;
  channels();
});

$("composer").addEventListener("submit", (e) => {
  e.preventDefault();
  openSafeConfirm();
});

$("modal").addEventListener("click", (e) => {
  if (e.target === $("modal") && !$("modal").querySelector('.review-note-editor')) $("modal").hidden = true;
});

document.addEventListener("input", (event) => {
  if (event.target?.id !== "asset-search") return;
  const query = event.target.value.trim().toLowerCase();
  document.querySelectorAll("[data-asset-text]").forEach((node) => {
    node.hidden = Boolean(query) && !node.dataset.assetText.toLowerCase().includes(query);
  });
});
document.addEventListener("bench-reload", () => { void reload(); });

window.addEventListener("hashchange", () => {
  parseHash();
  render();
});
window.addEventListener("pagehide",()=>{
  const room=$("ws-body").querySelector('[data-room-form]'),chat=$("ws-body").querySelector('.project-messages');
  if(room&&chat)rememberChatPosition(chat,room.dataset.roomForm);
});

async function reload() {
  const s = await api("/api/state");
  setStore(s);
  render();
}

reload()
  .then(maybeBriefings)
  .catch((err) => {
    $("ws-body").innerHTML = ui`<div class="card"><h1>无法连接秘书处</h1><p>请双击 start.bat。${esc(err.message)}</p></div>`;
  });
