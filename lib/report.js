"use strict";
const { inactive } = require("./archive");

const { id, nowIso } = require("./default-store");

const KIND_LABEL = {
  daily: "日报",
  retro: "每日复盘",
  guidance: "周指导",
  weekly: "周报",
  assessment: "月评估",
  monthly: "月报",
  quarterly: "季度总结",
};

function ymd(d) {
  const dt = d instanceof Date ? d : new Date(d);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const day = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function domainName(store, idValue) {
  const d = (store.domains || []).find((x) => x.id === idValue);
  return d ? d.name : idValue;
}

function agentName(store, idValue) {
  const a = (store.agents || []).find((x) => x.id === idValue);
  return a ? a.name : idValue || "未分派";
}

function inPeriod(task, start, end) {
  const t = task.updatedAt || task.createdAt;
  if (!t) return false;
  const day = ymd(t);
  return day >= start && day <= end;
}

function weekRange(from = new Date()) {
  const dt = new Date(from);
  const day = dt.getDay() || 7;
  const start = new Date(dt);
  start.setDate(dt.getDate() - day + 1);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { start: ymd(start), end: ymd(end) };
}

function monthRange(from = new Date()) {
  const dt = new Date(from);
  const start = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-01`;
  const last = new Date(dt.getFullYear(), dt.getMonth() + 1, 0);
  return { start, end: ymd(last) };
}

function linesForTasks(store, tasks) {
  if (!tasks.length) return ["（无）"];
  return tasks.map((t) => {
    const helpers = (t.helperAgentIds || []).map((h) => agentName(store, h)).join("、");
    return `- 【${domainName(store, t.domainId)}】${t.title}（${t.progress}% · ${agentName(store, t.ownerAgentId)}${helpers ? " / " + helpers : ""}）\n  下一步：${t.nextAction || "未写"}`;
  });
}

function quarterRange(from = new Date()) {
  const dt = new Date(from);
  const q = Math.floor(dt.getMonth() / 3);
  const startM = q * 3;
  const start = new Date(dt.getFullYear(), startM, 1);
  const end = new Date(dt.getFullYear(), startM + 3, 0);
  return { start: ymd(start), end: ymd(end), q: q + 1 };
}

function generateReport(store, kind) {
  const now = new Date();
  let start;
  let end;
  let title;
  const kinds = KIND_LABEL;
  if (!kinds[kind]) kind = "weekly";
  if (kind === "monthly" || kind === "assessment") {
    const r = monthRange(now);
    start = r.start;
    end = r.end;
    title = kind === "assessment" ? `${now.getFullYear()}年${now.getMonth() + 1}月评估` : `${now.getFullYear()}年${now.getMonth() + 1}月工作总结`;
  } else if (kind === "quarterly") {
    const r = quarterRange(now);
    start = r.start;
    end = r.end;
    title = `${now.getFullYear()}年第${r.q}季度总结`;
  } else if (kind === "daily" || kind === "retro") {
    start = ymd(now);
    end = ymd(now);
    title = kind === "daily" ? `${ymd(now)} 日报` : `${ymd(now)} 每日复盘`;
  } else if (kind === "guidance") {
    const r = weekRange(now);
    start = r.start;
    end = r.end;
    title = `${start} 起一周指导`;
  } else {
    const r = weekRange(now);
    start = r.start;
    end = r.end;
    title = `${start} 至 ${end} 工作周报`;
  }

  const tasks = (store.tasks||[]).filter(t=>!inactive(t));
  const done = tasks.filter((t) => t.status === "done");
  const doing = tasks.filter((t) => t.status === "doing" || t.status === "review");
  const blocked = tasks.filter((t) => t.status === "blocked");
  const todo = tasks.filter((t) => t.status === "todo");
  const recent = tasks.filter((t) => inPeriod(t, start, end));
  const lessons = (store.lessons || []).slice(0, 5);
  const nexts = doing.concat(todo).slice(0, 5);

  const byDomain = {};
  for (const t of tasks) {
    const name = domainName(store, t.domainId);
    byDomain[name] = byDomain[name] || { total: 0, doing: 0, done: 0 };
    byDomain[name].total += 1;
    if (t.status === "done") byDomain[name].done += 1;
    if (t.status === "doing" || t.status === "review") byDomain[name].doing += 1;
  }

  const domainLines = Object.entries(byDomain).map(
    ([name, v]) => `- ${name}：在册 ${v.total}，推进中 ${v.doing}，已完成 ${v.done}`
  );

  const body = [
    `# ${title}`,
    "",
    `> ${KIND_LABEL[kind] || kind}初稿，由秘书处按台账汇总，请改成人话。期间：${start} — ${end}`,
    "",
    "## 一、总体判断",
    `- 在办 ${doing.length} 项，待启动 ${todo.length} 项，受阻 ${blocked.length} 项，已完成/归档 ${done.length} 项。`,
    `- 本期间有更新的任务 ${recent.length} 项。`,
    `- 工作原则：先立规范，再起草或实现，对照核验后才归档。`,
    "",
    "## 二、按工作领域",
    ...(domainLines.length ? domainLines : ["- （空）"]),
    "",
    "## 三、正在推进",
    ...linesForTasks(store, doing),
    "",
    "## 四、待启动",
    ...linesForTasks(store, todo),
    "",
    kind === "monthly" ? "## 五、本月已收口" : "## 五、已收口",
    ...linesForTasks(store, done),
    "",
    "## 六、受阻与需要拍板",
    ...linesForTasks(store, blocked),
    "",
    "## 七、下一步（建议只盯三件）",
    ...nexts.slice(0, 3).map((t, i) => `${i + 1}. ${t.title} — ${t.nextAction || "补写下一步"}`),
    "",
    "## 八、教训沉淀",
    ...(lessons.length ? lessons.map((l) => `- ${l.rule}（来自：${l.from}）`) : ["- （本周暂无新教训）"]),
    "",
    "## 九、Agent 分工备忘",
    ...(store.agents || []).map((a) => `- ${a.name}（${a.role}）：${a.strength}`),
    "",
    "_规范驱动：没有对照清单的事项，不进入起草。_",
  ].join("\n");

  return {
    id: id("rp"),
    kind,
    title,
    period: `${start} ~ ${end}`,
    body,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

module.exports = { generateReport, KIND_LABEL, weekRange, monthRange, quarterRange };
