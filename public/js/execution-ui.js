import { api, esc, fmt, getStore } from "./core.js";
import { t as tr, ui } from "./i18n.js";
const pending = new Map(), drafts = new Map();
let mounted = null;
async function post(path, body) {
  const identity = path + JSON.stringify(body);
  if (!pending.has(identity)) pending.set(identity, crypto.randomUUID());
  const value = await api(path, { method: "POST", body: { ...body, idempotencyKey: pending.get(identity) } });
  pending.delete(identity);
  return value;
}
export function executionReason(code) {
  return {
    not_found: tr("新执行接口尚未加载，请重启工作台服务后刷新。"),
    agent_paused: tr("成员已暂停或归档，请先核对成员状态。"),
    step_not_ready: tr("本阶段尚未就绪，请先检查前置成果。"),
    idempotency_conflict: tr("请求内容已变化，请核对后重新操作。"),
    use_model_execute: tr("请使用本阶段的模型执行入口重新发起，保留原模型通道。"),
    project_paused: tr("工作链已暂停，请明确继续后再执行。"),
    project_paused_or_archived: tr("项目已归档或等待明确继续。"),
    workbuddy_paused: tr("WorkBuddy 定时领取由你暂停，当前保持暂停。"),
    runtime_unavailable: tr("执行通道不可用，请检查安装与运行状态。"),
    execution_owned: tr("本阶段已有执行归属，请先核对该次执行。"),
    auth_required: tr("执行通道需要登录。"),
    dependency_unavailable: tr("必需资料服务不可用，请恢复连接后再试。"),
    already_claimed: tr("成员或阶段已被占用，等待当前执行结束。"),
    input_changed: tr("输入或执行条件已变化，请重新核对。"),
    lease_expired: tr("领取有效期已过，需核对实际执行结果。"),
    result_uncertain: tr("执行结果不确定，核对前不会重发。"),
    attempt_interrupted: tr("服务重启中断了执行，请先核对。"),
    result_identity_mismatch: tr("成果与领取凭证不匹配，未采纳。"),
    review_budget_exhausted: tr("本轮独立复核退回次数已达上限。"),
    execution_budget_exhausted: tr("同一输入的执行次数已达三次，请补充或调整要求。"),
    reconcile_required: tr("请先核对旧执行已停止，并记录处理依据。"),
    skill_not_enabled: tr("绑定技能已停用或未发布。"),
    skill_binding_invalid: tr("技能版本、文件或成员授权不匹配。"),
    skill_file_changed: tr("技能文件已改变，哈希核验失败。"),
    skill_file_missing: tr("技能文件缺失，不能执行。"),
    conversion_snapshot_changed: tr("留言或转换内容已变化，请重新预览。"),
    independent_reviewer_required: tr("执行人与复核人必须不同。"),
    message_already_converted: tr("这条留言已转换，请打开关联任务。"),
    conversion_fields_required: tr("请补全目标、交付物和验收要求。")
  }[code] || code;
}
function explain(e) {
  let code = e.message;
  try {
    code = JSON.parse(code).error;
  } catch {
  }
  return executionReason(code);
}
export function executionState(a) {
  return { waiting: tr("等待领取"), claimed: tr("已领取，未取得开始证据"), running: a.startedEvidence?.source === "member-self-report" ? tr("成员自报开始，尚非独立执行证明") : a.startedEvidence ? tr("执行器已启动") : tr("已发起调用，尚无进程启动证据"), returned: tr("成果已返回，交付按原流程验收"), failed: tr("执行失败"), held: tr("迟到成果已保留，未推进阶段"), uncertain: tr("结果待核对"), interrupted: tr("重启中断，尚未发起调用"), cancelled: tr("已核对，不采纳旧尝试") }[a.state] || a.state;
}
export function executionPanel(run) {
  return ui`<section class="card execution-panel" data-execution-run="${esc(run.id)}"><h2>执行记录与技能</h2><p>领取、开始回执、成果返回与最终验收分别记录。刷新不会发起执行。</p><div data-execution-control></div><p data-execution-feedback role="status"></p><div data-execution-skills></div><div data-execution-timeline></div></section>`;
}
function alive(ctx) {
  return mounted === ctx && ctx.host.isConnected;
}
function feedback(ctx, value) {
  if (alive(ctx)) ctx.host.querySelector("[data-execution-feedback]").textContent = value;
}
function remember(ctx) {
  for (const select of ctx.host.querySelectorAll("[data-execution-skills] select")) drafts.set(ctx.runId + "/" + select.name, [...select.selectedOptions].map((o) => o.value));
}
function drawControls(ctx) {
  const m = ctx.model;
  ctx.host.querySelector("[data-execution-control]").innerHTML = ui`<div class="actions"><span class="chip">${tr(m.run.automationPaused ? "工作链已暂停" : "工作链未暂停")}</span><button type="button" class="ghost" data-execution-action="${m.run.automationPaused ? "resume" : "pause"}" ${m.run.archived || m.run.resumeRequired ? "disabled" : ""}>${tr(m.run.automationPaused ? "明确继续工作链" : "暂停工作链")}</button><button type="button" class="ghost" data-execution-action="refresh">核对最新状态</button></div><p>每位成员同时最多一个执行；同一输入最多三次尝试；独立复核沿用每轮三次退回上限。实际模型用量未知时不显示为零。</p>${m.channels.find((a) => a.agentId === "workbuddy")?.state === "paused" ? ui`<p class="k">WorkBuddy 定时领取由你暂停，当前保持暂停。</p>` : ""}`;
}
function drawSkills(ctx) {
  const m = ctx.model;
  ctx.host.querySelector("[data-execution-skills]").innerHTML = ui`<details><summary>正式阶段的技能版本</summary><p>选择已发布版本并保存；更新技能不会替换运行中的输入，也不会修改成员的全局规则。</p>${m.run.items.map((item) => {
    const selected = drafts.get(ctx.runId + "/" + item.id) || item.skillBindings?.map((b) => JSON.stringify(b)) || [];
    return ui`<form data-execution-bind="${esc(item.id)}"><fieldset class="skill-fields"><label>${esc(tr(item.label))} · ${esc(item.ownerAgentId)}<select name="${esc(item.id)}" multiple size="3" aria-label="${esc(tr(item.label))}">${m.skills.flatMap((s) => s.versions.filter((v) => v.allowedAgents.includes(item.ownerAgentId)).map((v) => {
      const value = JSON.stringify({ skillId: s.id, versionId: v.id, contentHash: v.contentHash });
      return `<option value="${esc(value)}" ${selected.includes(value) ? "selected" : ""}>${esc(v.name || s.name)} · v${v.number}</option>`;
    })).join("")}</select></label><button type="submit" class="ghost">保存本阶段技能</button></fieldset></form>`;
  }).join("")}</details>`;
}
function drawTimeline(ctx) {
  const m = ctx.model;
  ctx.host.querySelector("[data-execution-timeline]").innerHTML = ui`<h3>执行时间线</h3>${m.attempts.slice(0, ctx.limit).map((a) => ui`<article class="msg execution-attempt" data-execution-attempt="${esc(a.id)}"><div class="row"><b>${esc(a.agentId)} · ${executionState(a)}</b><small>${fmt(a.createdAt)}</small></div><p>${esc(a.purpose)} · ${esc(a.id)}</p>${a.blockerCode ? `<p>${esc(executionReason(a.blockerCode))}</p>` : ""}<p>${tr("实际采用")}：${tr("未知，需结合输出判断")}</p><details><summary>执行证据与技能版本</summary><p>${tr("领取有效期")} · ${fmt(a.leaseExpiresAt)}</p><p>${tr("输入快照")} · <code>${esc(a.inputHash)}</code></p>${(a.skillBindings || []).map((b) => `<p>${esc(b.skillId)} · ${esc(b.versionId)}<br><code>${esc(b.contentHash)}</code></p>`).join("")}${(a.events || []).map((e) => `<p>${fmt(e.at)} · ${esc(e.state)} · ${esc(e.source)}</p>`).join("")}</details><div class="actions"><button type="button" class="ghost" data-execution-action="result" data-attempt="${esc(a.id)}">查看返回内容</button>${["uncertain", "held", "failed", "interrupted"].includes(a.state) || Date.parse(a.leaseExpiresAt) < Date.now() && ["waiting", "claimed", "running"].includes(a.state) ? `<button type="button" class="ghost" data-execution-action="reconcile" data-attempt="${esc(a.id)}">${tr("核对旧执行")}</button>` : ""}${a.purpose === "stage" && ["failed", "interrupted", "cancelled"].includes(a.state) ? `<button type="button" class="ghost" data-execution-action="retry" data-attempt="${esc(a.id)}" ${m.run.automationPaused ? "disabled" : ""}>${tr("明确重新发起一次")}</button>` : ""}</div><div data-execution-result="${esc(a.id)}"></div></article>`).join("") || ui`<p>尚无新协议执行记录；历史任务不会因此重跑。</p>`}${m.attempts.length > ctx.limit ? ui`<button type="button" class="ghost" data-execution-action="more">显示更多执行记录</button>` : ""}${m.legacyJobs.length ? ui`<details><summary>历史执行记录（细分状态未核实）</summary>${m.legacyJobs.map((j) => `<p>${esc(j.agentId || "codex")} · ${esc(j.status)} · ${fmt(j.createdAt)}</p>`).join("")}</details>` : ""}`;
}
async function refresh(ctx, initial = false) {
  const model = await api(`/api/departments/runs/${encodeURIComponent(ctx.runId)}/execution`);
  if (!alive(ctx)) return;
  ctx.model = model;
  drawControls(ctx);
  if (initial) drawSkills(ctx);
  drawTimeline(ctx);
}
async function perform(ctx, action) {
  if (ctx.busy) return;
  ctx.busy = true;
  const controls = [...ctx.host.querySelectorAll("button,input,select,textarea")].map((e) => [e, e.disabled]);
  controls.forEach(([e]) => e.disabled = true);
  try {
    await action();
  } catch (e) {
    feedback(ctx, explain(e));
  } finally {
    ctx.busy = false;
    controls.forEach(([e, d]) => {
      if (e.isConnected) e.disabled = d;
    });
  }
}
export function mountExecution() {
  const host = document.querySelector("[data-execution-run]");
  if (!host) return;
  if (mounted?.host === host) return;
  if (mounted) {
    remember(mounted);
    clearTimeout(mounted.timer);
  }
  const ctx = mounted = { host, runId: host.dataset.executionRun, model: null, limit: 20, busy: false };
  host.addEventListener("change", () => remember(ctx));
  host.addEventListener("click", (event) => {
    const button = event.target.closest("[data-execution-action]");
    if (!button) return;
    const action = button.dataset.executionAction, a = ctx.model?.attempts.find((a2) => a2.id === button.dataset.attempt);
    if (action === "more") {
      ctx.limit += 20;
      drawTimeline(ctx);
      return;
    }
    if (action === "reconcile") {
      host.querySelector(`[data-execution-result="${a.id}"]`).innerHTML = ui`<form data-execution-reconcile="${esc(a.id)}"><fieldset class="skill-fields"><label>核对依据<textarea name="evidence" rows="3" required maxlength="2000"></textarea></label><label><input type="checkbox" name="stopped" required /> 我已核对成员会话，确认旧执行已停止，不采纳旧结果</label><button type="submit" class="ghost">保存核对结论</button></fieldset></form>`;
      return;
    }
    void perform(ctx, async () => {
      if (action === "pause" || action === "resume") {
        await post(`/api/departments/runs/${ctx.runId}/execution/control`, { action, expectedGeneration: ctx.model.run.controlGeneration });
        await refresh(ctx);
        feedback(ctx, tr("执行控制已更新。"));
      } else if (action === "refresh") await refresh(ctx);
      else if (action === "result") {
        const result = await post(`/api/departments/runs/${ctx.runId}/execution/result`, { attemptId: a.id });
        if (alive(ctx)) host.querySelector(`[data-execution-result="${a.id}"]`).innerHTML = ui`<p>${tr(result.identityVerified ? "已核对返回内容的身份；此预览不采纳成果。" : "尚无已核验的返回内容。")}</p><pre class="skill-text">${esc(result.output)}</pre>`;
      } else if (action === "retry") {
        await post(`/api/departments/runs/${ctx.runId}/execution/retry`, { attemptId: a.id, resultHash: a.resultHash || null, confirmed: true });
        await refresh(ctx);
        feedback(ctx, tr("已登记一次新尝试，请查看时间线。"));
      }
    });
  });
  host.addEventListener("submit", (event) => {
    const form = event.target;
    if (!form.matches("[data-execution-bind],[data-execution-reconcile]")) return;
    event.preventDefault();
    const data = new FormData(form);
    void perform(ctx, async () => {
      if (form.dataset.executionBind) {
        const stepId = form.dataset.executionBind;
        await post(`/api/departments/runs/${ctx.runId}/execution/skills`, { stepId, bindings: data.getAll(stepId).map(JSON.parse), expectedGeneration: ctx.model.run.controlGeneration });
        drafts.delete(ctx.runId + "/" + stepId);
        await refresh(ctx);
        feedback(ctx, tr("本阶段已绑定指定技能版本。"));
      } else {
        const a = ctx.model.attempts.find((a2) => a2.id === form.dataset.executionReconcile);
        await post(`/api/departments/runs/${ctx.runId}/execution/reconcile`, { attemptId: a.id, resultHash: a.resultHash || null, evidence: data.get("evidence"), confirmed: true, stopped: data.get("stopped") === "on", resolution: "do-not-apply" });
        await refresh(ctx);
        feedback(ctx, tr("旧尝试已核对，不会自动重发。"));
      }
    });
  });
  const poll = () => {
    ctx.timer = setTimeout(async () => {
      if (!alive(ctx)) return;
      try {
        if (!ctx.busy && !ctx.host.querySelector("[data-execution-reconcile]") && !ctx.host.querySelector("[data-execution-result] pre")) await refresh(ctx);
      } catch (e) {
        feedback(ctx, explain(e));
      }
      if (alive(ctx)) poll();
    }, 4e3);
  };
  void perform(ctx, async () => {
    await refresh(ctx, true);
    poll();
  });
}
export function conversionButton(message) {
  return !message.runId && !message.departmentItemId ? message.convertedRunId ? `<a class="tiny" href="#projects/run:${esc(message.convertedRunId)}">${tr("打开已转换任务")}</a>` : `<button type="button" class="tiny" data-convert-inbox="${esc(message.id)}">${tr("转为正式任务")}</button>` : "";
}
export function bindConversion() {
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-convert-inbox]");
    if (!button) return;
    const message = (getStore().inbox || []).find((m) => m.id === button.dataset.convertInbox);
    if (!message) return;
    openConversion(message);
  });
}
function openConversion(message) {
  document.getElementById("execution-conversion")?.remove();
  const dialog = document.createElement("dialog");
  dialog.id = "execution-conversion";
  dialog.className = "card execution-dialog";
  const members = ["codex", "workbuddy", "cursor"];
  dialog.innerHTML = ui`<h2>留言转为正式任务</h2><p>先预览目标、交付物与验收要求。创建后保持暂停，不自动执行或批准正式写作。</p><form data-convert-form><fieldset class="skill-fields"><label>任务目标<textarea name="goal" rows="4" required maxlength="16000">${esc(message.body)}</textarea></label><label>交付物<textarea name="deliverable" rows="2" required maxlength="3000"></textarea></label><label>验收要求<textarea name="acceptance" rows="2" required maxlength="3000"></textarea></label><label>执行成员<select name="ownerAgentId">${members.filter((id) => id !== "codex").map((id) => `<option value="${id}" ${id === message.toAgentId ? "selected" : ""}>${esc(id)}</option>`).join("")}</select></label><label>独立复核人<select name="reviewerAgentId">${members.map((id) => `<option value="${id}" ${id === "cursor" ? "selected" : ""}>${esc(id)}</option>`).join("")}</select></label><label>关联项目（可选）<select name="parent"><option value="">${tr("不关联其他项目")}</option>${(getStore().modules || []).filter((m) => m.type === "project").map((m) => `<option value="${esc(JSON.stringify({ kind: "module", id: m.id }))}">${esc(m.title)}</option>`).join("")}${(getStore().departmentRuns || []).map((r) => `<option value="${esc(JSON.stringify({ kind: "department-run", id: r.id }))}">${esc(r.title)}</option>`).join("")}</select></label><label><input type="checkbox" name="writing" checked /> 正式写作仍需另行批准</label><button type="submit" class="ghost">预览转换</button></fieldset></form><div data-convert-preview></div><p data-convert-feedback role="status"></p><button type="button" data-convert-close>关闭</button>`;
  document.body.append(dialog);
  dialog.showModal();
  let preview = null, body = null, busy = false;
  dialog.querySelector("[data-convert-close]").onclick = () => dialog.remove();
  dialog.querySelector("form").oninput = () => {
    preview = null;
    dialog.querySelector("[data-convert-preview]").innerHTML = "";
  };
  dialog.querySelector("form").onsubmit = async (e) => {
    e.preventDefault();
    if (busy) return;
    const data = Object.fromEntries(new FormData(e.target));
    body = { goal: data.goal, deliverable: data.deliverable, acceptance: data.acceptance, ownerAgentId: data.ownerAgentId, reviewerAgentId: data.reviewerAgentId, parentRef: data.parent ? JSON.parse(data.parent) : null, requiresWritingApproval: data.writing === "on" };
    busy = true;
    e.target.querySelector("fieldset").disabled = true;
    try {
      preview = await post(`/api/inbox/${message.id}/convert/preview`, body);
      if (!dialog.isConnected) return;
      dialog.querySelector("[data-convert-preview]").innerHTML = ui`<h3>转换预览</h3><pre class="skill-text">${esc(preview.draft.goal)}\n\n${esc(preview.draft.deliverable)}\n\n${esc(preview.draft.acceptance)}</pre><p>${esc(preview.draft.ownerAgentId)} → ${esc(preview.draft.reviewerAgentId)}</p><button type="button" class="solid" data-convert-confirm>确认创建，保持暂停</button>`;
    } catch (err) {
      if (!dialog.isConnected) return;
      dialog.querySelector("[data-convert-feedback]").textContent = explain(err);
    } finally {
      busy = false;
      if (dialog.isConnected) dialog.querySelector("fieldset").disabled = false;
    }
  };
  dialog.addEventListener("click", async (e) => {
    if (!e.target.closest("[data-convert-confirm]") || !preview || busy) return;
    busy = true;
    e.target.disabled = true;
    try {
      const result = await post(`/api/inbox/${message.id}/convert`, { ...body, snapshot: preview.snapshot, confirmed: true });
      if (dialog.isConnected) dialog.querySelector("[data-convert-preview]").innerHTML = ui`<p>协作任务已创建并保持暂停。</p><a href="#projects/run:${esc(result.runId)}" data-convert-open>${tr("打开协作任务")}</a>`;
      if (dialog.isConnected) dialog.querySelector("[data-convert-open]").onclick = () => dialog.remove();
    } catch (err) {
      if (!dialog.isConnected) return;
      dialog.querySelector("[data-convert-feedback]").textContent = explain(err);
      e.target.disabled = false;
    } finally {
      busy = false;
    }
  });
}
