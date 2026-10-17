import { t as tr, ui, systemFragment } from "../js/i18n.js";
// 模块清单：经营报告（日 / 周 / 月 / 季度节奏）
import { esc, getStore, OPS, cardShell } from "../js/core.js";

export default {
  type: "ops",
  label: "经营",

  card(m) {
    return cardShell(
      m,
      ui`<div class="k">ops · 优先级 ${esc(m.importance ?? "-")}</div>
       <div class="h">${esc(m.title)}</div>
       <p>日报、复盘、周指导、周报、月评估、月报、季度总结。</p>`
    );
  },

  detail(m) {
    const s = getStore();
    const counts = OPS.filter((o) => o.id !== "today").map((o) => {
      const n = (s.reports || []).filter((r) => r.kind === o.id).length;
      return ui`<div class="msg"><div class="row"><b>${esc(o.name)}</b><span class="chip">已归档 ${n} 份</span></div></div>`;
    });
    return ui`<div class="card"><div class="h">工作报告</div><p>生成初稿，改成人话再归档。入口在左栏「工作报告」。</p></div>${counts.join("")}`;
  },
};
