// ============================================================
// core.js — 公共内核：状态、API、工具、错误边界、共享渲染件
// 所有页面视图与模块清单从这里取料。零依赖，原生 ES Module。
// ============================================================

import { setLanguage, language, t as tr, ui, systemFragment } from "./i18n.js";
let _store = null;
let _rawStore = null;

export function setStore(s) {
  _rawStore = s;
  setLanguage(s.meta?.language);
  _store = { ...s };
  for(const key of Object.keys(s))if(Array.isArray(s[key]))_store[key]=s[key].filter(item=>!item.archived);
  _store.fronts = Object.fromEntries(Object.entries(s.fronts||{}).map(([key,items])=>[key,items.filter(item=>!item.archived)]));
  _store.lifeSystem = Object.fromEntries(Object.entries(s.lifeSystem||{}).map(([key,items])=>[key,Array.isArray(items)?items.filter(item=>!item.archived):items]));
}
export function getRawStore() { return _rawStore; }
export function getStore() {
  return _store;
}

export async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ---------- 基础工具 ----------

export const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export const fmt = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(language(), {month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit",hour12:false}).format(d);
};

export const ymd = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// ---------- 领域常量与查表 ----------

export const STATUS = {
  todo: "待启动",
  doing: "进行中",
  review: "待核验",
  blocked: "受阻",
  done: "已完成",
  archive: "已归档",
};

// 指令生命周期：董事长下达后，agent 按 AGENTS.md 自行 PATCH 推进
export const CMD_STATUS = {
  queued: "待领",
  ack: "已收悉",
  doing: "执行中",
  done: "已完成",
  cancelled: "已撤销",
};

export const OPS = [
  { id: "today", name: "今日行程" },
  { id: "daily", name: "日报" },
  { id: "retro", name: "每日复盘" },
  { id: "guidance", name: "周指导" },
  { id: "weekly", name: "周报" },
  { id: "assessment", name: "月评估" },
  { id: "monthly", name: "月报" },
  { id: "quarterly", name: "季度总结" },
];

export function agent(id) {
  return (getStore().agents || []).find((a) => a.id === id) || { name: id || tr("未分派"), id };
}
export function taskById(id) {
  return (getStore().tasks || []).find((t) => t.id === id);
}
export function doing() {
  return (getStore().tasks || []).filter((t) => !t.resumeRequired && (t.status === "doing" || t.status === "review"));
}
export function modulesSorted() {
  return [...(getStore().modules || [])].sort((a, b) => a.order - b.order);
}
export function todaySlot() {
  const plan = (getStore().plans || [])[0];
  const day = ymd();
  return (plan && (plan.slots || []).find((x) => x.date === day)) || (plan && plan.slots && plan.slots[0]);
}

// ---------- 催报（黄灯）----------
// 任务 doing/review 超过 24h 无打卡 → 黄灯；agent 超 48h 未汇报 → 黄灯。

export function staleHours(iso) {
  if (!iso) return 0;
  const h = (Date.now() - new Date(iso).getTime()) / 3.6e6;
  return h > 0 ? h : 0;
}
export function taskStale(t) {
  const h = staleHours(t && t.updatedAt);
  return !t.resumeRequired && (t.status === "doing" || t.status === "review") && h >= 24 ? Math.floor(h) : 0;
}
export function agentStale(a) {
  if(a?.resumeRequired)return 0;
  const h = staleHours(a && a.lastSync);
  return h >= 48 ? Math.floor(h) : 0;
}
export function taskOverdue(t) {
  if (!t || t.resumeRequired || !t.due) return false;
  if (t.status === "done" || t.status === "archive") return false;
  return t.due < ymd();
}

// ---------- 错误边界 ----------
// 任何模块/视图渲染抛错，只隔离这一块，不塌整页。

export function errorCard(label, err) {
  return ui`<article class="card err">
    <div class="k">模块故障 · 已隔离</div>
    <div class="h">${esc(label)}</div>
    <p>${esc(String((err && err.message) || err))}</p>
  </article>`;
}

export function safe(fn, label) {
  try {
    return fn();
  } catch (err) {
    console.error(tr("[工作台]"), label, err);
    return errorCard(label, err);
  }
}

// ---------- 共享渲染件 ----------

export function cardShell(m, inner, cls = "") {
  return `<article class="card ${cls}" draggable="true" data-mod="${esc(m.id)}">${inner}</article>`;
}

export function progressCard(title, pct, note, chips) {
  return `<article class="card">
    <div class="k">${esc(chips || "")}</div>
    <div class="h">${esc(title)}</div>
    <div class="bar"><i style="width:${Number(pct) || 0}%"></i></div>
    <p>${esc(note || "")}</p>
  </article>`;
}

export function taskBlock(t) {
  const stale = taskStale(t);
  return `<div class="msg">
    <div class="row"><b>${esc(t.title)}</b><span class="chip">${t.resumeRequired?tr(tr("已暂停，需明确继续")):tr(STATUS[t.status] || t.status)} · ${t.progress || 0}%</span></div>
    <div class="bar"><i style="width:${t.progress || 0}%"></i></div>
    <p>${esc(t.nextAction || "")}</p>
    <div class="meta">
      <span class="chip">${esc(agent(t.ownerAgentId).name)}</span>
      ${stale ? ui`<span class="chip warn">已 ${stale}h 无打卡</span>` : ""}
    </div>
  </div>`;
}

export function cmdStatusChip(m) {
  const ok = m.status === "ack" || m.status === "done";
  return `<span class="chip ${ok ? "ok" : ""}">${tr(CMD_STATUS[m.status] || m.status)}</span>`;
}
