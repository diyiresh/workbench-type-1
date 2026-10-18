import { t as tr, ui, systemFragment } from "../js/i18n.js";
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
      ui`<div class="k">crew · 优先级 ${esc(m.importance ?? "-")}</div>
       <div class="h">${esc(m.title)}</div>
       <p>${esc((s.agents || []).length)} 个部门在册，待领指令 ${qn} 条。到成员中心查看成员与指令。</p>
       ${
         staleAgents.length
           ? `<div class="meta">${staleAgents
               .map((a) => ui`<span class="chip warn">${esc(a.name)} 已 ${agentStale(a)}h 未汇报</span>`)
               .join("")}</div>`
           : ""
       }`
    );
  },

  detail(m) {
    return ui`<div class="card"><div class="h">成员与通道在左栏「成员中心」</div>
      <p>这里是指挥舱的一块观察牌。成员与通道状态在成员中心，普通指令登记到收件箱。</p></div>`;
  },
};
