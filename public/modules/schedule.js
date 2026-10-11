import { t as tr, ui, systemFragment } from "../js/i18n.js";
// 模块清单：今日行程
import { esc, getStore, todaySlot, ymd, cardShell } from "../js/core.js";

export default {
  type: "schedule",
  label: "行程",

  card(m) {
    const slot = todaySlot();
    const agenda = (getStore().agendas || []).filter((x) => x.date === ymd());
    const items = agenda.length
      ? agenda.slice().sort((a, b) => String(a.time || "99:99").localeCompare(String(b.time || "99:99"))).slice(0, 3).map((x) => `${x.time || tr("待定")} ${x.title}`)
      : ((slot && slot.items) || []).slice(0, 3);
    return cardShell(
      m,
      ui`<div class="k">schedule · 优先级 ${esc(m.importance ?? "-")}</div>
       <div class="h">${esc(m.title)}</div>
       <p>${esc(items.join("；")) || tr("今日暂无安排。")}</p>
       <div class="meta"><span class="chip">${agenda.length ? ui`已排 ${agenda.length} 项` : tr("来自本周安排")}</span></div>`
    );
  },

  detail(m) {
    const s = getStore();
    const plan = (s.plans || [])[0];
    const slot = todaySlot() || { day: tr("今日"), items: [] };
    const agenda = (s.agendas || []).filter((x) => x.date === ymd());
    return ui`<div class="card">
      <div class="k">${esc((plan && plan.title) || "")}</div>
      <div class="h">${esc(slot.day)} · ${esc(slot.date || ymd())}</div>
      <ul>${(slot.items || []).map((i) => `<li>${esc(i)}</li>`).join("")}</ul>
      <p>${esc((plan && plan.focus) || "")}</p>
    </div><div class="filters" style="margin-top:12px"><button type="button" class="solid" data-primary="agenda">打开每日行程（${agenda.length} 项）</button></div>`;
  },
};
