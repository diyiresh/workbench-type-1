// 模块清单：事业部 / 项目。支持 ownerAgentId 责任路由与催报黄灯。
import { esc, getStore, cardShell, agent, taskById, taskStale, progressCard, taskBlock, doing } from "../js/core.js";

export default {
  type: "project",
  label: "事业部 / 项目",

  card(m) {
    const t = m.taskId ? taskById(m.taskId) : null;
    const pct = t ? t.progress : 0;
    const note = t ? t.nextAction || t.notes || "" : "看板待绑定任务。";
    const stale = t ? taskStale(t) : 0;
    const owner = m.ownerAgentId || (t && t.ownerAgentId) || "";
    return cardShell(
      m,
      `<div class="k">project · 优先级 ${esc(m.importance ?? "-")}${owner ? ` · 责任 ${esc(agent(owner).name)}` : ""}</div>
       <div class="h">${esc(m.title)}</div>
       <div class="bar"><i style="width:${pct}%"></i></div>
       <p>${esc(note)}</p>
       <div class="meta">
         ${stale ? `<span class="chip warn">已 ${stale}h 无打卡</span>` : ""}
         ${owner ? `<button type="button" class="tiny" data-cmd="${esc(owner)}">指挥</button>` : ""}
       </div>`,
      stale ? "stale" : ""
    );
  },

  detail(m) {
    const t = m.taskId ? taskById(m.taskId) : null;
    const related = t ? [t] : doing();
    return `${progressCard(m.title, t ? t.progress : 0, t ? t.notes || t.nextAction : "这是指挥舱里的一块看板。", m.type)}
      ${related.map(taskBlock).join("")}`;
  },
};
