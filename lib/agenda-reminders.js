"use strict";
const { inactive } = require("./archive");

function startAt(item) {
  const match = String(item.date || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const time = String(item.time || "").match(/^(\d{2}):(\d{2})$/);
  if (!match || !time) return null;
  const value = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(time[1]), Number(time[2]));
  return Number.isNaN(value.getTime()) ? null : value;
}

function dueImportantReminders(agendas, now = new Date(), hours = 12) {
  const current = now instanceof Date ? now : new Date(now);
  return (agendas || []).filter((item) => {
    if (!item || inactive(item) || !item.important || item.done || item.reminderSentAt) return false;
    if (item.reminderLastTriedAt && current.getTime() - new Date(item.reminderLastTriedAt).getTime() < 15 * 60 * 1000) return false;
    const start = startAt(item);
    if (!start || current >= start) return false;
    const reminderAt = new Date(start.getTime() - hours * 60 * 60 * 1000);
    return current >= reminderAt;
  });
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;");
}

function buildReminderPayload(item) {
  const title = `【重点工作提醒】${item.date} ${item.time} ${item.title}`;
  const content = [
    "该重点事项将在约 12 小时后开始。",
    `时间：${escapeHtml(item.date)} ${escapeHtml(item.time)}`,
    `事项：${escapeHtml(item.title)}`,
    item.note ? `说明：${escapeHtml(item.note).replace(/\n/g, "<br>")}` : "",
    item.materials && item.materials.length ? `已登记材料路径：${item.materials.length} 条` : "",
  ].filter(Boolean).join("<br>");
  return { title, content };
}

module.exports = { startAt, dueImportantReminders, buildReminderPayload };
