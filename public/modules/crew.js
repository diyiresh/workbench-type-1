// 模块清单：舰队动态（Agent 舰队汇总）
import { esc, getStore, cardShell, agentStale } from "../js/core.js";

export default {
  type: "crew",
  label: "舰队",

  card(m) {
    const s = getStore();
    const qn = (s.inbox || []).filter((x) => x.status === "queued").length;
    const staleAgents = (s.agents || []).filter((a) => agentStale(a));
    return cardShell(
      m,
      `<div class="k">crew · 优先级 ${esc(m.importance ?? "-")}</div>
       <div class="h">${esc(m.title)}</div>
       <p>${esc((s.agents || []).length)} 个部门在册，待领指令 ${qn} 条。点「舰队」可联系各部门。</p>
       ${
         staleAgents.length
           ? `<div class="meta">${staleAgents
               .map((a) => `<span class="chip warn">${esc(a.name)} 已 ${agentStale(a)}h 未汇报</span>`)
               .join("")}</div>`
           : ""
       }`
    );
  },

  detail(m) {
    return `<div class="card"><div class="h">舰队总览在左栏「舰队」</div>
      <p>这里是指挥舱的一块观察牌。要看某个部门、或给谁下达，去左栏舰队页，或直接用底部指令台。</p></div>`;
  },
};
