"use strict";

const { ymd } = require("./migrate");
const { buildExternalBriefing, sourceSummaries } = require("./brief-hub");

function agentName(store, id) {
  const a = (store.agents || []).find((x) => x.id === id);
  return a ? a.name : id;
}

function todayPlan(store) {
  const day = ymd();
  const plan = (store.plans || [])[0];
  const slot = plan && (plan.slots || []).find((s) => s.date === day);
  return slot || (plan && plan.slots && plan.slots[0]) || { day: "今日", items: ["打开指挥舱，确认三件下一步"] };
}

function buildBriefings(store) {
  const recipes = (store.briefingRecipes || []).filter((r) => r.enabled !== false);
  const tasks = store.tasks || [];
  const doing = tasks.filter((t) => t.status === "doing" || t.status === "review");
  const inbox = store.inbox || [];
  const queued = inbox.filter((m) => m.status === "queued");
  const slot = todayPlan(store);

  const gens = {
    ops() {
      const lines = [
        `今日（${slot.day || ""} ${slot.date || ymd()}）`,
        ...(slot.items || []).map((i) => `· ${i}`),
        "",
        "请盯住的三件：",
        ...doing.slice(0, 3).map((t) => `· ${t.title} — ${t.nextAction || "补写下一步"}`),
        "",
        "经营文件：日报 / 复盘 / 周指导 / 周报 / 月评估 / 月报 / 季度总结，在「经营」里生成初稿。",
      ];
      return { kicker: "秘书处 · 自动汇总", body: lines.join("\n") };
    },
    crew() {
      const lines = (store.agents || []).map((a) => {
        const mine = tasks.filter((t) => t.ownerAgentId === a.id || (t.helperAgentIds || []).includes(a.id));
        const wait = queued.filter((m) => m.toAgentId === a.id).length;
        const top = mine[0];
        return `· ${a.name}（${a.role}）${a.status === "active" ? " 在场" : " 待命"}  · 相关 ${mine.length} 项  · 待领指令 ${wait}\n  ${top ? top.title + " " + (top.progress || 0) + "%" : "暂无在办"}`;
      });
      return { kicker: "各部门打卡", body: lines.join("\n\n") || "舰队空。" };
    },
    fronts() {
      const workN = doing.length;
      const learn = (store.fronts && store.fronts.learn) || [];
      const life = (store.fronts && store.fronts.life) || [];
      const lines = [
        `工作战线：在办 ${workN} 项。重点事业部写在指挥舱模块上，可改顺序。`,
        "",
        "学习战线：",
        ...learn.map((x) => `· ${x.title} ${x.progress}% — ${x.note}`),
        "",
        "生活战线：",
        ...life.map((x) => `· ${x.title} ${x.progress}% — ${x.note}`),
      ];
      return { kicker: "一人公司的三条线", body: lines.join("\n") };
    },
    agents() {
      const external = buildExternalBriefing(store);
      if (external) return { kicker: external.kicker, body: external.body };
      const waiting = sourceSummaries(store).map((item) => `· ${item.platform} · ${item.name} — ${item.label}`);
      return {
        kicker: "跨 Agent · 等待首份",
        body: ["统一收件通道已准备好，尚未收到外部简报。", "", ...waiting, "", "在左侧「简」栏目查看投递说明。"].join("\n"),
      };
    },
  };

  return recipes.map((r, i) => {
    const g = (gens[r.generator] || gens.ops)();
    return {
      id: r.id,
      index: i + 1,
      total: recipes.length,
      title: r.title,
      kicker: g.kicker,
      body: g.body,
    };
  });
}

function crewDigest(store) {
  const tasks = store.tasks || [];
  const events = store.events || [];
  const inbox = store.inbox || [];
  return (store.agents || []).map((a) => {
    const mine = tasks.filter((t) => t.ownerAgentId === a.id || (t.helperAgentIds || []).includes(a.id));
    const ev = events.filter((e) => e.agentId === a.id).slice(0, 3);
    const queued = inbox.filter((m) => m.toAgentId === a.id && m.status === "queued");
    return {
      id: a.id,
      name: a.name,
      role: a.role,
      status: a.status,
      lastSync: a.lastSync,
      tasks: mine.map((t) => ({ id: t.id, title: t.title, progress: t.progress, status: t.status, nextAction: t.nextAction })),
      events: ev,
      queued: queued.length,
    };
  });
}

module.exports = { buildBriefings, crewDigest, todayPlan, agentName };
