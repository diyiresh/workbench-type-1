"use strict";
const { inactive } = require("./archive");

const DAY_NAMES = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

const HABIT_TEMPLATES = [
  { id: "habit-rise", title: "早起 · 晨间 TOP3 仪式", note: "起床后列吃、动、静、问 TOP3；温水和轻运动后进入最重要的事。", time: "06:00", schedule: { type: "daily" } },
  { id: "habit-focus", title: "单任务深度专注", note: "关闭通知，45 分钟倒计时；休息 5 分钟后再开始下一轮。", time: "09:30", schedule: { type: "daily" } },
  { id: "habit-plan-review", title: "早计划 + 晚复盘", note: "早晨 5 分钟写三件要事；晚上复盘完成、偏差与一个优化动作。", time: "22:00", schedule: { type: "daily" } },
  { id: "habit-read", title: "深度阅读 30–60 分钟", note: "远离手机，读后留下 1 句金句和 1 行行动清单。", time: "23:00", schedule: { type: "daily" } },
  { id: "habit-exercise", title: "锻炼", note: "每周固定 3 次；按身体情况调整强度。", time: "18:30", schedule: { type: "weekdays", days: [1, 3, 5] } },
  { id: "habit-brain", title: "随时记录第二大脑", note: "把灵感和待办归入可检索的笔记系统。", time: "随时", schedule: { type: "daily" } },
  { id: "habit-action", title: "大目标拆今日动作", note: "把模糊目标改写成一个可在今天启动的番茄钟动作。", time: "09:00", schedule: { type: "daily" } },
  { id: "habit-refuse", title: "列拒绝清单", note: "在周日晚列出下周不做的事，给重要事项留出空间。", time: "20:00", schedule: { type: "weekdays", days: [0] } },
  { id: "habit-gratitude", title: "每日 3 件感恩小事", note: "记录三件具体的小事，对冲内耗。", time: "21:30", schedule: { type: "daily" } },
  { id: "habit-feynman", title: "费曼输出 300 字", note: "用自己的话讲清一个概念，让输出倒逼输入。", time: "20:30", schedule: { type: "daily" } },
  { id: "habit-thinking", title: "独立思维三问", note: "问证据、利益与反例，不被节奏带着走。", time: "20:45", schedule: { type: "daily" } },
  { id: "habit-hard", title: "每周 +1 种难事", note: "选择一个略有不适、但能拓展能力边界的行动。", time: "20:15", schedule: { type: "weekdays", days: [0] } },
];

function ymd(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function parseDate(value) {
  const [year, month, day] = String(value || "").split("-").map(Number);
  const result = new Date(year, (month || 1) - 1, day || 1);
  return Number.isNaN(result.getTime()) ? null : result;
}

function isHabitDue(template, date) {
  const day = parseDate(date);
  if (!day) return false;
  if (!template.schedule || template.schedule.type === "daily") return true;
  return template.schedule.type === "weekdays" && (template.schedule.days || []).includes(day.getDay());
}

function ensureLifeSystem(store, date = ymd(), now = new Date().toISOString()) {
  let changed = false;
  if (!store.lifeSystem || typeof store.lifeSystem !== "object") {
    store.lifeSystem = { habitTemplates: HABIT_TEMPLATES.map((item) => ({ ...item })), habitRuns: [], learningPlans: [] };
    changed = true;
  }
  if (!Array.isArray(store.lifeSystem.habitTemplates) || !store.lifeSystem.habitTemplates.length) {
    store.lifeSystem.habitTemplates = HABIT_TEMPLATES.map((item) => ({ ...item }));
    changed = true;
  }
  if (!Array.isArray(store.lifeSystem.habitRuns)) { store.lifeSystem.habitRuns = []; changed = true; }
  if (!Array.isArray(store.lifeSystem.learningPlans)) { store.lifeSystem.learningPlans = []; changed = true; }
  for (const template of store.lifeSystem.habitTemplates) {
    if (inactive(template) || !isHabitDue(template, date)) continue;
    const exists = store.lifeSystem.habitRuns.some((run) => run.date === date && run.habitId === template.id);
    if (!exists) {
      store.lifeSystem.habitRuns.push({
        id: `hr-${date}-${template.id}`,
        habitId: template.id,
        date,
        done: false,
        skipped: false,
        createdAt: now,
        updatedAt: now,
      });
      changed = true;
    }
  }
  return changed;
}

function lifeHabitsForDate(store, date) {
  ensureLifeSystem(store, date);
  const templates = store.lifeSystem.habitTemplates || [];
  const runs = store.lifeSystem.habitRuns || [];
  return templates.filter((template) => !inactive(template) && isHabitDue(template, date)).map((template) => ({
    ...template,
    ...(runs.find((run) => run.date === date && run.habitId === template.id) || {}),
    weekday: DAY_NAMES[(parseDate(date) || new Date()).getDay()],
  })).filter(item=>!inactive(item));
}

function text(value, max = 400) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) && Boolean(parseDate(value));
}

function validTime(value) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || ""));
}

function addDays(date, days) {
  const result = parseDate(date);
  result.setDate(result.getDate() + days);
  return ymd(result);
}

function extractJson(raw) {
  const source = String(raw || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const begin = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (begin < 0 || end <= begin) throw new Error("模型没有返回可读取的计划 JSON");
  return JSON.parse(source.slice(begin, end + 1));
}

// 云端模型在长中文 JSON 中常漏逗号或转义。学习计划改用行式协议，
// 仍保留 JSON 读取以兼容旧草稿和较严格的模型输出。
function extractLinePlan(raw) {
  const lines = String(raw || "").replace(/\r/g, "").split("\n").map((line) => line.trim()).filter(Boolean);
  let title = "";
  const sessions = [];
  for (const original of lines) {
    const line = original.replace(/[｜]/g, "|");
    const titleMatch = line.match(/^(?:TITLE|标题|计划标题)\s*[:：]\s*(.+)$/i);
    if (titleMatch) { title = text(titleMatch[1], 100); continue; }
    const parts = line.split("|").map((part) => part.trim());
    if (parts.length < 5 || !validDate(parts[0]) || !validTime(parts[1])) continue;
    sessions.push({
      date: parts[0],
      time: parts[1],
      minutes: Number(parts[2]),
      title: parts[3],
      note: parts.slice(4).join(" | "),
    });
  }
  return sessions.length ? { title, sessions } : null;
}

function parseLearningOutput(raw) {
  if (typeof raw !== "string") return raw;
  try {
    return extractJson(raw);
  } catch (jsonError) {
    const linePlan = extractLinePlan(raw);
    if (linePlan) return linePlan;
    throw jsonError;
  }
}

function normalizeLearningDraft(raw, input, today = ymd()) {
  const parsed = parseLearningOutput(raw);
  // 未填截止日期时，不让模型把“第一版试学”无限期排到远期。
  const deadline = validDate(input.deadline) ? input.deadline : addDays(today, 7);
  const sessions = Array.isArray(parsed && parsed.sessions) ? parsed.sessions : [];
  if (!sessions.length) throw new Error("模型没有给出可采纳的学习时段");
  const allowedMaterialWords = ["视频", "文档", "课程", "教程", "书", "教材", "链接", "资料", "文件"]
    .filter((word) => String(input.content || "").includes(word));
  const clean = sessions.slice(0, 14).map((item, index) => {
    const date = validDate(item && item.date) ? item.date : today;
    if (date < today || date > deadline) throw new Error("模型给出了范围外的学习日期，请重新生成");
    const minutes = Math.max(15, Math.min(240, Number(item && item.minutes) || Number(input.sessionMinutes) || 45));
    const title = text(item && item.title, 120) || `学习：${text(input.goal, 60)}`;
    const note = text(item && item.note, 400);
    const proposed = `${title} ${note}`;
    for (const word of ["视频", "文档", "课程", "教程", "书", "教材", "链接", "资料", "文件"]) {
      if (proposed.includes(word) && !allowedMaterialWords.includes(word)) {
        throw new Error(`模型引用了未由你提供的“${word}”材料，请重新生成`);
      }
    }
    return {
      id: `session-${index + 1}`,
      date,
      time: validTime(item && item.time) ? item.time : "20:00",
      title,
      note,
      minutes,
      done: false,
    };
  }).sort((a, b) => `${a.date}|${a.time}`.localeCompare(`${b.date}|${b.time}`));
  return {
    title: text(parsed && parsed.title, 100) || `学习计划：${text(input.goal, 70)}`,
    goal: text(input.goal, 500),
    content: text(input.content, 1600),
    availability: text(input.availability, 500),
    deadline,
    sessionMinutes: Math.max(15, Math.min(240, Number(input.sessionMinutes) || 45)),
    sessions: clean,
  };
}

function adoptLearningPlan(store, draft, { id, now = new Date().toISOString(), model = "ollama" } = {}) {
  ensureLifeSystem(store);
  const plan = {
    id: id || `learn-${Date.now()}`,
    ...draft,
    sessions: (draft.sessions || []).map((session, index) => ({ ...session, id: session.id || `session-${index + 1}`, done: false })),
    status: "active",
    model,
    createdAt: now,
    updatedAt: now,
  };
  store.lifeSystem.learningPlans.unshift(plan);
  return plan;
}

function completeLearningSession(store, planId, sessionId, done, now = new Date().toISOString()) {
  ensureLifeSystem(store);
  const plan = store.lifeSystem.learningPlans.find((item) => item.id === planId);
  if (!plan || inactive(plan) || plan.status !== "active") return null;
  const session = (plan.sessions || []).find((item) => item.id === sessionId);
  if (!session) return null;
  session.done = Boolean(done);
  session.updatedAt = now;
  plan.updatedAt = now;
  if (plan.sessions.length && plan.sessions.every((item) => item.done)) {
    const total = plan.sessions.length;
    plan.completedSessions = total;
    plan.sessions = [];
    plan.status = "completed";
    plan.completedAt = now;
    plan.achievement = `已完成对《${plan.title}》的学习，你真棒！`;
  }
  return plan;
}

module.exports = {
  HABIT_TEMPLATES,
  ymd,
  isHabitDue,
  ensureLifeSystem,
  lifeHabitsForDate,
  normalizeLearningDraft,
  adoptLearningPlan,
  completeLearningSession,
};
