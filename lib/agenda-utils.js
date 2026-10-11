"use strict";
const { inactive } = require("./archive");

const { id, nowIso } = require("./default-store");

function parseYmd(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

function ymd(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function shiftDays(date, count) {
  const next = new Date(date);
  next.setDate(next.getDate() + count);
  return next;
}

function periodFor(view, anchor) {
  const date = parseYmd(anchor) || new Date();
  if (view === "month") {
    const start = new Date(date.getFullYear(), date.getMonth(), 1);
    const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    return { start: ymd(start), end: ymd(end) };
  }
  if (view === "week") {
    const day = date.getDay() || 7;
    const start = shiftDays(date, 1 - day);
    return { start: ymd(start), end: ymd(shiftDays(start, 6)) };
  }
  const one = ymd(date);
  return { start: one, end: one };
}

function agendasInPeriod(store, start, end) {
  return (store.agendas || [])
    .filter((item) => item && !inactive(item) && item.date >= start && item.date <= end)
    .slice()
    .sort((a, b) => `${a.date}|${a.time || "99:99"}`.localeCompare(`${b.date}|${b.time || "99:99"}`));
}

function titleFor(view, anchor) {
  const date = parseYmd(anchor) || new Date();
  if (view === "month") return `${date.getFullYear()}年${date.getMonth() + 1}月工作月报`;
  if (view === "week") {
    const { start, end } = periodFor("week", anchor);
    return `${start} 至 ${end} 工作周报`;
  }
  return `${ymd(date)} 工作日报`;
}

function kindFor(view) {
  return view === "month" ? "monthly" : view === "week" ? "weekly" : "daily";
}

function buildAgendaReportSeed(store, view, anchor) {
  const safeView = ["day", "week", "month"].includes(view) ? view : "day";
  const range = periodFor(safeView, anchor);
  const entries = agendasInPeriod(store, range.start, range.end);
  const grouped = new Map();
  for (const item of entries) {
    const list = grouped.get(item.date) || [];
    list.push(item);
    grouped.set(item.date, list);
  }
  const done = entries.filter((item) => item.done).length;
  const important = entries.filter((item) => item.important).length;
  const lines = [
    `# ${titleFor(safeView, anchor)}`,
    "",
    `> 统计周期：${range.start} — ${range.end}。以下内容仅来自工作台已录入日程和复盘。`,
    "",
  ];
  if (!entries.length) lines.push("（该周期未录入日程，不能据此生成报告。）");
  for (const [date, list] of grouped) {
    lines.push(`## ${date}`, "");
    for (const item of list) {
      const labels = [item.category, item.important ? "重点" : "", item.done ? "已完成" : "未完成"].filter(Boolean).join(" · ");
      lines.push(`- ${item.time || "待定"}｜${item.title}${labels ? `（${labels}）` : ""}`);
      if (item.tags && item.tags.length) lines.push(`  - 标签：${item.tags.join("、")}`);
      if (item.note) lines.push(`  - 事项描述：${String(item.note).replace(/\s+/g, " ")}`);
      if (item.review) lines.push(`  - 复盘：${String(item.review).replace(/\s+/g, " ")}`);
      if (item.materials && item.materials.length) lines.push(`  - 已登记材料路径：${item.materials.length} 条`);
    }
    lines.push("");
  }
  lines.push("## 事实汇总", "", `- 共 ${entries.length} 项；已完成 ${done} 项；重点事项 ${important} 项；完成率 ${entries.length ? Math.round((done / entries.length) * 100) : 0}%。`);
  return {
    id: id("rp"),
    kind: kindFor(safeView),
    title: titleFor(safeView, anchor),
    period: `${range.start} ~ ${range.end}`,
    body: lines.join("\n"),
    entries,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

module.exports = { parseYmd, ymd, shiftDays, periodFor, agendasInPeriod, buildAgendaReportSeed };
