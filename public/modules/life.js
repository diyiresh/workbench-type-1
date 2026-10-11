import { t as tr, ui, systemFragment } from "../js/i18n.js";
// 模块清单：生活战线
import { esc, getStore, cardShell } from "../js/core.js";

export default {
  type: "life",
  label: "生活",

  aggregate() {
    const L = (getStore().fronts && getStore().fronts.life) || [];
    return {
      list: L,
      pct: Math.round(L.reduce((s, x) => s + x.progress, 0) / (L.length || 1)),
      note: L.map((x) => `${x.title} ${x.progress}%`).join("；"),
    };
  },

  card(m) {
    const { pct, note } = this.aggregate();
    return cardShell(
      m,
      ui`<div class="k">life · 优先级 ${esc(m.importance ?? "-")}</div>
       <div class="h">${esc(m.title)}</div>
       <div class="bar"><i style="width:${pct}%"></i></div>
       <p>${esc(note)}</p>`
    );
  },

  detail(m) {
    const { list } = this.aggregate();
    return `<div class="mods">${list
      .map(
        (x) => `<article class="card">
          <div class="k">life</div>
          <div class="h">${esc(x.title)}</div>
          <div class="bar"><i style="width:${x.progress || 0}%"></i></div>
          <p>${esc(x.note || "")}</p>
        </article>`
      )
      .join("")}</div>`;
  },
};
