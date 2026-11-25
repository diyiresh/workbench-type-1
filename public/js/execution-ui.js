import { api, esc, fmt, getStore } from "./core.js";
import { t as tr, ui } from "./i18n.js";
const pending = new Map(), drafts = new Map();
export const MODEL_MEMBER_IDS = ["codex", "cursor", "workbuddy", "deepseek", "doubao", "ollama"];
const MODEL_NAMES = { codex: "ChatGPT Codex", cursor: "Cursor", workbuddy: "WorkBuddy", deepseek: "DeepSeek", doubao: "豆包", ollama: "Ollama" };
export function projectMembers(store = getStore()) {
  return MODEL_MEMBER_IDS.map(id => (store?.agents || []).find(agent => agent.id === id) || { id, name: MODEL_NAMES[id], role: id === "doubao" ? tr("人工桌面接续，待验收") : tr("执行通道状态待核实") });
}
export function providerPanel() {
  return ui`<section class="card" data-provider-panel><h2>执行通道与基础设施</h2><p>检测只读取状态；连通测试会发送一段虚构短文本。成果仍须经过项目复核。</p><button type="button" class="ghost" data-provider-refresh>读取最新通道状态</button><p data-provider-feedback role="status" aria-live="polite"></p><div class="mods" data-provider-list></div><section data-doubao-bridge><h3>豆包桌面任务</h3><p>在现有豆包桌面会话中发送指定任务，再粘贴真实回复；领取与报送不代表验收通过。</p><div data-doubao-tasks></div></section></section>`;
}
let providersMounted=null;
const providerDrafts=new Map(),providerJobs=new Map();
function providerState(value){return tr(({ready:'通道可用',offline:'当前未运行',unconfigured:'尚未配置',manual:'人工桌面接续，待验收',unknown:'执行通道状态待核实',queued:'等待执行',waiting:'等待领取',doing:'阶段执行中',running:'阶段执行中',done:'成果已返回，交付按原流程验收',succeeded:'成果已返回，交付按原流程验收',failed:'执行失败'})[value]||value||'执行通道状态待核实');}
function providerReceipt(jobId,value){
  const key='workbench-doubao-claim:'+jobId;
  try{if(value!==undefined)sessionStorage.setItem(key,JSON.stringify(value));return JSON.parse(sessionStorage.getItem(key)||'null');}catch{return null;}
}
function desktopDraft(jobId,value){
  const key='workbench-doubao-draft:'+jobId;
  try{if(value!==undefined)sessionStorage.setItem(key,value);return sessionStorage.getItem(key)||'';}catch{return providerDrafts.get('output:'+jobId)||'';}
}
function providerRemember(ctx){
  for(const form of ctx.host.querySelectorAll('[data-provider-configure]'))providerDrafts.set('model:'+form.dataset.providerConfigure,form.elements.model.value);
  for(const form of ctx.host.querySelectorAll('[data-doubao-submit]')){providerDrafts.set('output:'+form.dataset.doubaoSubmit,form.elements.output.value);desktopDraft(form.dataset.doubaoSubmit,form.elements.output.value);}
}
function providerFeedback(ctx,text){if(ctx.host.isConnected)ctx.host.querySelector('[data-provider-feedback]').textContent=text;}
function providerDraw(ctx){
  providerRemember(ctx);
  if(ctx.host.contains(document.activeElement)&&document.activeElement.matches('input,select,textarea'))return;
  ctx.host.querySelector('[data-provider-list]').innerHTML=ctx.providers.map(p=>{
    const job=providerJobs.get(p.id)||p.lastJob,running=job&&['queued','waiting','doing','running'].includes(job.status);
    const models=Array.isArray(p.models)?p.models:[];const selected=providerDrafts.get('model:'+p.id)||p.model;
    return ui`<article class="card" data-provider="${esc(p.id)}" style="min-width:0"><div class="row"><h3>${esc(p.name||p.id)}</h3><span class="chip">${esc(providerState(p.state))}</span></div><p>${esc(p.kind==='infrastructure'?tr('基础设施，不参与模型分工'):tr('模型执行通道'))}</p>${p.reason?`<p>${esc(p.reason)}</p>`:''}${p.model?`<p>${esc(tr('当前模型'))}：${esc(p.model)}</p>`:''}${p.testedAt?`<p>${esc(tr('最近连通测试'))}：${fmt(p.testedAt)}</p>`:''}<div class="actions"><button type="button" class="ghost" data-provider-probe="${esc(p.id)}">检测通道</button>${['ollama','deepseek','doubao'].includes(p.id)&&p.implemented!==false?`<button type="button" class="ghost" data-provider-test="${esc(p.id)}" ${running?'disabled':''}>${esc(tr('发送虚构文本连通测试'))}</button>`:''}</div>${p.id==='ollama'?`<form data-provider-configure="ollama"><label>${esc(tr('选择已安装模型'))}<select name="model" required ${models.length?'':'disabled'} style="max-width:100%">${models.map(m=>`<option value="${esc(m)}" ${m===selected?'selected':''}>${esc(m)}</option>`).join('')}</select></label><button type="submit" class="ghost" ${models.length?'':'disabled'}>${esc(tr('确认使用此模型'))}</button></form>`:''}${job?`<div data-provider-job="${esc(job.jobId||job.id||'')}"><p>${esc(tr('连通测试'))}：${esc(providerState(job.status))}</p>${job.error?`<p>${esc(job.error)}</p>`:''}${job.output?`<pre class="skill-text" style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(job.output)}</pre>`:''}</div>`:''}</article>`;
  }).join('');
  ctx.host.querySelector('[data-doubao-tasks]').innerHTML=ctx.tasks.length?ctx.tasks.map(t=>{
    const receipt=providerReceipt(t.jobId)?.receipt,valid=['queued','waiting','claimed','doing','running'].includes(t.status)&&(!t.attemptId||!receipt||receipt.attemptId===t.attemptId);
    const draft=providerDrafts.get('output:'+t.jobId)??desktopDraft(t.jobId);
    return ui`<article class="msg" data-doubao-task="${esc(t.jobId)}" style="min-width:0"><p><b>${esc(t.jobId)}</b> · ${esc(providerState(t.status))}</p>${t.runId?`<p>${esc(tr('项目'))}：${esc(t.runId)}</p>`:''}<details><summary>查看指定任务与复制文本</summary><textarea readonly rows="6" aria-label="${esc(tr('豆包任务原文'))}" style="width:100%;max-width:100%">${esc(t.prompt||'')}</textarea></details>${valid?(receipt?`<form data-doubao-submit="${esc(t.jobId)}"><label>${esc(tr('粘贴豆包真实回复'))}<textarea name="output" rows="5" required style="width:100%;max-width:100%">${esc(draft)}</textarea></label><button type="submit" class="ghost">${esc(tr('确认报送真实回复'))}</button></form>`:`<button type="button" class="ghost" data-doubao-claim="${esc(t.jobId)}">${esc(tr('确认领取此桌面任务'))}</button>`):`<p>${esc(tr('此任务已结束或已失效，不能继续报送。'))}</p>`}</article>`;
  }).join(''):ui`<p>暂无等待人工接续的豆包任务。</p>`;
}
async function providerLoad(ctx){
  const [list,tasks]=await Promise.all([api('/api/providers'),api('/api/providers/doubao/tasks').catch(()=>({tasks:[]}))]);
  if(providersMounted!==ctx||!ctx.host.isConnected)return;
  ctx.providers=Array.isArray(list)?list:list.providers||[];for(const p of ctx.providers)if(p.lastJob&&!providerJobs.has(p.id))providerJobs.set(p.id,p.lastJob);ctx.tasks=Array.isArray(tasks)?tasks:tasks.tasks||[];
  for(const [id,job]of providerJobs){if(['queued','waiting','doing','running'].includes(job.status)){try{const current=await api('/api/providers/jobs/'+encodeURIComponent(job.jobId||job.id));providerJobs.set(id,current.job?{...current.job,jobId:job.jobId}: {...current,jobId:job.jobId});}catch(error){providerFeedback(ctx,explain(error));}}}
  if(providersMounted===ctx&&ctx.host.isConnected)providerDraw(ctx);
}
export function mountProviders(){
  const host=document.querySelector('[data-provider-panel]');if(!host)return;
  if(providersMounted?.host===host)return;
  if(providersMounted){providerRemember(providersMounted);clearTimeout(providersMounted.timer);}
  const ctx=providersMounted={host,providers:[],tasks:[],busy:false};
  async function perform(action){if(ctx.busy)return;ctx.busy=true;providerRemember(ctx);try{await action();await providerLoad(ctx);}catch(error){providerFeedback(ctx,explain(error));}finally{ctx.busy=false;}}
  host.addEventListener('input',()=>providerRemember(ctx));host.addEventListener('change',()=>providerRemember(ctx));
  host.addEventListener('click',event=>{const b=event.target.closest('button');if(!b)return;
    if(b.hasAttribute('data-provider-refresh'))void perform(async()=>{});
    if(b.dataset.providerProbe)void perform(async()=>{await post('/api/providers/'+encodeURIComponent(b.dataset.providerProbe)+'/probe',{});providerFeedback(ctx,tr('通道检测已返回。'));});
    if(b.dataset.providerTest)void perform(async()=>{const id=b.dataset.providerTest;if(providerJobs.has(id)&&['queued','waiting','doing','running'].includes(providerJobs.get(id).status))return;const j=await post('/api/providers/'+encodeURIComponent(id)+'/test',{confirmed:true});providerJobs.set(id,{...j,status:j.status||'queued'});providerFeedback(ctx,tr('虚构文本测试已登记，请查看真实返回。'));});
    if(b.dataset.doubaoClaim)void perform(async()=>{const id=b.dataset.doubaoClaim;let saved=providerReceipt(id);if(!saved){saved={idempotencyKey:crypto.randomUUID()};providerReceipt(id,saved);}const response=await api('/api/providers/doubao/tasks/'+encodeURIComponent(id)+'/claim',{method:'POST',body:{confirmed:true,idempotencyKey:saved.idempotencyKey}});const receipt=response.receipt||response;if(!receipt.attemptId||!receipt.claimId)throw new Error(tr('领取未返回有效凭证，请核对任务。'));providerReceipt(id,{...saved,receipt});providerFeedback(ctx,tr('已领取桌面任务，请在豆包中完成后粘贴真实回复。'));});
  });
  host.addEventListener('submit',event=>{const form=event.target;if(!form.matches('[data-provider-configure],[data-doubao-submit]'))return;event.preventDefault();const data=new FormData(form);
    if(form.dataset.providerConfigure)void perform(async()=>{await post('/api/providers/ollama/configure',{confirmed:true,model:String(data.get('model')||'')});providerDrafts.delete('model:ollama');providerFeedback(ctx,tr('模型选择已保存。'));});
    if(form.dataset.doubaoSubmit)void perform(async()=>{const id=form.dataset.doubaoSubmit,t=ctx.tasks.find(t=>t.jobId===id),receipt=providerReceipt(id)?.receipt;if(!t||!['queued','waiting','claimed','doing','running'].includes(t.status)||!receipt||(t.attemptId&&t.attemptId!==receipt.attemptId))throw new Error(tr('任务已失效或未领取，请刷新后核对。'));await post('/api/providers/doubao/tasks/'+encodeURIComponent(id)+'/submit',{confirmed:true,attemptId:receipt.attemptId,claimId:receipt.claimId,output:String(data.get('output')||'')});providerDrafts.delete('output:'+id);providerFeedback(ctx,tr('真实回复已报送，仍需项目复核与验收。'));});
  });
  const poll=()=>{ctx.timer=setTimeout(async()=>{if(providersMounted!==ctx||!host.isConnected)return;try{if(!ctx.busy)await providerLoad(ctx);}catch(error){providerFeedback(ctx,explain(error));}if(providersMounted===ctx&&host.isConnected)poll();},3000);};
  void providerLoad(ctx).then(poll).catch(error=>providerFeedback(ctx,explain(error)));
}
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
    recovery_policy_invalid: tr("自动恢复设置无效，请重新选择。"),
    confirmation_required: tr("请先确认这项操作。"),
    writing_approval_not_ready: tr("准备材料尚待复核，请先查看项目中的待确认事项。"),
    prepare_not_ready: tr("准备材料尚待复核，请先查看项目中的待确认事项。"),
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
  return ui`<section class="card execution-panel" data-execution-run="${esc(run.id)}"><h2>执行记录与技能</h2><p>领取、开始回执、成果返回与最终验收分别记录。刷新不会发起执行。</p><p><a href="#agents/all">管理模型与基础设施通道</a></p><div data-execution-control></div><p data-execution-feedback role="status"></p><div data-execution-recovery aria-live="polite"></div><div data-execution-management></div><div data-execution-activity></div><div data-execution-skills></div><div data-execution-timeline></div></section>`;
}
const ACTIVITY = {
  goal: "目标", stage_started: "阶段开始", stage_done: "阶段完成", attempt_waiting: "登记执行", attempt_claimed: "领取",
  attempt_running: "开始", attempt_returned: "成果返回", attempt_failed: "失败", attempt_held: "迟到保留", attempt_uncertain: "待核对",
  attempt_interrupted: "中断", attempt_cancelled: "不采纳", review_pass: "复核通过", review_reject: "复核退回",
  delivery_configured: "交付要求", delivery_generated: "文件生成", delivery_pass: "文件复核通过", delivery_reject: "文件复核退回", handoff: "交接",
};
function drawActivity(ctx, data) {
  const rows = [...(data?.entries || [])].reverse();
  const item = (e) => `<li class="activity-${esc(e.kind.split("_")[0])}"><time>${fmt(e.at)}</time><b>${esc(e.agentId || "—")}</b><span class="chip">${esc(tr(ACTIVITY[e.kind] || e.kind))}</span><span>${esc(e.text)}</span></li>`;
  ctx.host.querySelector("[data-execution-activity]").innerHTML = ui`<h3>成员活动</h3>` + (rows.length
    ? `<ol class="activity-feed">${rows.slice(0, 12).map(item).join("")}</ol>${rows.length > 12 ? `<details><summary>${tr("更早的活动")} · ${rows.length - 12}</summary><ol class="activity-feed">${rows.slice(12).map(item).join("")}</ol></details>` : ""}`
    : ui`<p>尚无成员活动。</p>`);
}
function alive(ctx) {
  return mounted === ctx && ctx.host.isConnected;
}
function feedback(ctx, value) {
  if (alive(ctx)) ctx.host.querySelector("[data-execution-feedback]").textContent = value;
}
function remember(ctx) {
  for (const select of ctx.host.querySelectorAll("[data-execution-skills] select")) drafts.set(ctx.runId + "/" + select.name, [...select.selectedOptions].map((o) => o.value));
  const policy = ctx.host.querySelector("[data-execution-policy]");
  if (policy) drafts.set(ctx.runId + "/policy", { enabled: policy.elements.enabled.checked, maxAttempts: policy.elements.maxAttempts.value, reviewerFallback: policy.elements.reviewerFallback.value, firstDelaySeconds: policy.elements.firstDelaySeconds.value, secondDelaySeconds: policy.elements.secondDelaySeconds.value });
  for (const form of ctx.host.querySelectorAll("[data-execution-assign]")) drafts.set(ctx.runId + "/assign/" + form.dataset.executionAssign, form.elements.ownerAgentId.value);
}
function drawControls(ctx) {
  if(ctx.model.run.workflowVersion===2){ctx.host.querySelector("[data-execution-control]").innerHTML="";return;}
  const m = ctx.model;
  ctx.host.querySelector("[data-execution-control]").innerHTML = ui`<div class="actions"><span class="chip">${tr(m.run.automationPaused ? "工作链已暂停" : "工作链未暂停")}</span><button type="button" class="ghost" data-execution-action="${m.run.automationPaused ? "resume" : "pause"}" ${m.run.archived || m.run.resumeRequired ? "disabled" : ""}>${tr(m.run.automationPaused ? "明确继续工作链" : "暂停工作链")}</button><button type="button" class="ghost" data-execution-action="refresh">核对最新状态</button></div><p>每位成员同时最多一个执行；同一输入最多三次尝试；独立复核沿用每轮三次退回上限。实际模型用量未知时不显示为零。</p>${m.channels.find((a) => a.agentId === "workbuddy")?.state === "paused" ? ui`<p class="k">WorkBuddy 定时领取由你暂停，当前保持暂停。</p>` : ""}`;
}
function phaseStatus(item) {
  return tr(({ queued: "等待领取", doing: "阶段执行中", done: "已提交成果", blocked: "等待前置成果", rework: "需修改" })[item.status] || item.status);
}
function recoveryStatus(status) {
  return tr(({ scheduled: "正在自动恢复", "needs-user": "需要你处理", invalidated: "恢复计划已失效", dispatching: "恢复尝试已启动", completed: "本阶段恢复已完成" })[status] || status);
}
function recoveryStrategy(strategy) {
  return tr(({ retry: "重试当前阶段", "fallback-codex": "切换复核成员", "structured-output": "按结构化要求重新生成" })[strategy] || strategy);
}
function stageCheckpoint(run,item,last,recovery){
  if(item.status==='done')return '';
  const active=last&&['waiting','claimed','running','uncertain','held'].includes(last.state);
  let owner=item.ownerAgentId,action=tr('等待前置成果');
  if(run.automationPaused){owner=tr('你');action=tr('核对后明确继续工作链');}
  else if(active){
    if(last.state==='waiting')action=tr(last.agentId==='workbuddy'?'等待桌面计划领取':'等待执行通道接单');
    else if(['claimed','running'].includes(last.state))action=tr('等待成员提交真实成果');
    else {owner=tr('你');action=tr('核对旧执行与保留成果');}
  }else if(recovery?.status==='scheduled'){owner=tr('工作台调度');action=tr('等待已登记的恢复尝试');}
  else if(recovery?.status==='needs-user'||recovery?.status==='invalidated'){owner=tr('你');action=recovery.reason||tr('核对旧执行与保留成果');}
  else if(item.status==='blocked'){owner=tr('前置阶段负责人');}
  else {owner=tr('工作台调度');action=tr('检查前置条件并安排执行');}
  const ev=last?.events?.filter(e=>e.state===last.state).at(-1);
  const since=active?(ev?.at||last.claimedAt||last.createdAt):recovery?.createdAt;
  const age=Date.parse(since),minutes=Number.isFinite(age)?Math.max(0,Math.floor((Date.now()-age)/60000)):null;
  return `<div data-stage-checkpoint="${esc(item.id)}"><p>${esc(tr('等待对象'))}：${esc(MODEL_NAMES[owner]||owner)}${minutes!==null?` · ${esc(tr('当前状态持续（分钟）'))}：${minutes} · ${fmt(since)}`:''}</p><p>${esc(tr('下一步动作'))}：${esc(action)}</p>${active?`<p>${esc(tr('当前执行'))}：${esc(executionState(last))} · ${esc(last.id)}</p>`:''}</div>`;
}
function drawRecovery(ctx) {
  if(ctx.model.run.workflowVersion===2){ctx.host.querySelector("[data-execution-recovery]").innerHTML="";return;}
  const m = ctx.model;
  const policy = m.run.recoveryPolicy || {};
  const maxAttempts = policy.maxAttempts || 3;
  ctx.host.querySelector("[data-execution-recovery]").innerHTML = ui`<h3>当前分工与恢复进展</h3>` + m.run.items.map(item => {
    const attempts = m.attempts.filter(a => a.purpose === "stage" && a.stepId === item.id).sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));
    const lastReturned = attempts.findIndex(a => a.state === "returned");
    const consecutive = lastReturned < 0 ? attempts.length : lastReturned;
    const last=attempts.find(a=>a.id===item.activeAttemptId)||attempts[0];
    const historicalRecovery=item.recovery&&last&&item.recovery.sourceAttemptId!==last.id&&['waiting','claimed','running','returned'].includes(last.state);
    const recovery = historicalRecovery?null:item.recovery;
    return `<article class="msg execution-attempt" data-recovery-step="${esc(item.id)}"><div class="row"><b>${esc(tr(item.label || item.role))} · ${esc(item.ownerAgentId)}</b><span class="chip">${esc(phaseStatus(item))}</span></div>${stageCheckpoint(m.run,item,last,recovery)}<p>${esc(tr("本轮连续调用"))}：${consecutive} / ${maxAttempts} · ${esc(tr("全部历史调用"))}：${attempts.length}</p>${historicalRecovery?`<details><summary>${esc(tr('此前的恢复判断（历史）'))}</summary><p>${esc(recoveryStatus(item.recovery.status))} · ${esc(item.recovery.reason||'')}</p></details>`:''}${recovery ? `<p><b>${esc(recoveryStatus(recovery.status))}</b>${recovery.strategy ? " · " + esc(recoveryStrategy(recovery.strategy)) : ""}</p>${recovery.reason ? `<p>${esc(recovery.reason)}</p>` : ""}${recovery.status === "scheduled" && recovery.nextRetryAt ? `<p>${esc(tr("下次尝试"))}：${fmt(recovery.nextRetryAt)}</p>` : ""}` : ""}</article>`;
  }).join("");
  if(m.run.dutyPolicy){
    const enabled=m.run.dutyPolicy.enabled,lastTick=m.run.coordinatorLastTickAt,stale=!lastTick||Date.now()-Date.parse(lastTick)>5*60000;
    ctx.host.querySelector('[data-execution-recovery]').insertAdjacentHTML('beforeend',ui`<section data-duty-policy><h3>值班巡检与补位</h3><p>仅限超过75分钟仍未领取的 WorkBuddy 正文任务；成功撤回后，由 Cursor 接手，Codex 独立复核。已领取或执行状态不明的任务先核对。</p><p>${esc(tr('最后巡检'))}：${lastTick?fmt(lastTick):esc(tr('尚无巡检记录'))} · ${esc(tr(stale?'巡检记录已过期':'巡检记录正常'))}</p><button type="button" class="ghost" data-execution-action="failover" ${m.run.archived?'disabled':''}>${esc(tr(enabled?'停用未领取任务补位':'启用已批准的75分钟补位'))}</button></section>`);
  }
}
function drawManagement(ctx) {
  if(ctx.model.run.workflowVersion===2){ctx.host.querySelector("[data-execution-management]").innerHTML="";return;}
  const host = ctx.host.querySelector("[data-execution-management]");
  if (host.contains(document.activeElement)) return;
  const m = ctx.model, disabled = m.run.archived || m.run.resumeRequired;
  const policy = drafts.get(ctx.runId + "/policy") || m.run.recoveryPolicy || {};
  const busy = item => m.attempts.some(a => a.stepId === item.id && ["waiting", "claimed", "running", "uncertain", "held"].includes(a.state));
  const executor = m.run.items.find(item => item.role === "executor");
  const reviewer = m.run.items.find(item => item.role === "reviewer");
  host.innerHTML = ui`<details data-execution-management-details><summary>自动恢复与人工控制</summary><p>保存设置后才生效；不会批准内容、重做已完成成果或绕过独立复核。</p><form data-execution-policy><fieldset class="skill-fields" ${disabled ? "disabled" : ""}><label><input type="checkbox" name="enabled" ${policy.enabled ? "checked" : ""} /> 启用可恢复错误的自动尝试</label><label>每阶段自动恢复预算<select name="maxAttempts">${[1, 2, 3].map(value => `<option value="${value}" ${Number(policy.maxAttempts || 3) === value ? "selected" : ""}>${value}</option>`).join("")}</select></label><label>首次重试等待（秒）<input type="number" name="firstDelaySeconds" min="5" max="3600" step="1" required value="${esc(policy.firstDelaySeconds ?? 30)}" /></label><label>再次重试等待（秒）<input type="number" name="secondDelaySeconds" min="${esc(policy.firstDelaySeconds ?? 30)}" max="7200" step="1" required value="${esc(policy.secondDelaySeconds ?? 120)}" /></label><label>Cursor 复核的替补成员<select name="reviewerFallback"><option value="none" ${policy.reviewerFallback !== "codex" ? "selected" : ""}>${tr("不自动改派")}</option><option value="codex" ${policy.reviewerFallback === "codex" ? "selected" : ""}>${tr("允许 Codex 替补独立复核")}</option></select></label><button type="submit" class="ghost">确认保存自动恢复设置</button></fieldset></form>${m.run.requiresWritingApproval !== false && !m.run.writingApproved ? ui`<p>正式写作尚未批准；先核对项目方案和待确认事项。</p><button type="button" class="ghost" data-execution-action="approve" ${disabled ? "disabled" : ""}>确认批准正式写作</button>` : ui`<p>写作批准状态已满足当前项目要求。</p>`}${m.run.items.map(item => {
    const allowed = ["queued", "rework"].includes(item.status) && !busy(item) && !disabled;
    const members = ["director", "secretary"].includes(item.role) ? ["codex"] : MODEL_MEMBER_IDS.filter(agent => item.role === "reviewer" ? agent !== executor?.ownerAgentId : agent !== reviewer?.ownerAgentId && agent !== "codex");
    const selected = drafts.get(ctx.runId + "/assign/" + item.id) || item.ownerAgentId;
    return ui`<form data-execution-assign="${esc(item.id)}"><fieldset class="skill-fields" ${allowed ? "" : "disabled"}><label>${esc(tr(item.label || item.role))} · ${esc(phaseStatus(item))}<select name="ownerAgentId" aria-label="${esc(tr(item.label || item.role))}">${members.map(agent => `<option value="${agent}" ${selected === agent ? "selected" : ""}>${esc(MODEL_NAMES[agent] || agent)}</option>`).join("")}</select></label><button type="submit" class="ghost">确认改派本阶段</button></fieldset></form>${allowed ? `<button type="button" class="ghost" data-act="department-manual" data-run-id="${esc(ctx.runId)}" data-item-id="${esc(item.id)}">${tr(item.role === "reviewer" ? "人工复核与退回" : "人工 / 外部 Agent 回填")}</button>` : ""}`;
  }).join("")}<p>已领取、运行中或待核对的阶段须先处理旧执行，再调整成员。</p></details>`;
  const open = drafts.get(ctx.runId + "/management-open");
  if (open) host.querySelector("details").open = true;
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
  const [model, activity] = await Promise.all([
    api(`/api/departments/runs/${encodeURIComponent(ctx.runId)}/execution`),
    api(`/api/departments/runs/${encodeURIComponent(ctx.runId)}/timeline`).catch(() => null),
  ]);
  if (!alive(ctx)) return;
  ctx.model = model;
  drawControls(ctx);
  drawRecovery(ctx);
  drawManagement(ctx);
  drawActivity(ctx, activity);
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
  host.addEventListener("input", event => {
    if (event.target.name === "firstDelaySeconds") {
      const second = ctx.host.querySelector('[data-execution-policy] [name="secondDelaySeconds"]');
      if (second) second.min = event.target.value || "5";
    }
    remember(ctx);
  });
  host.addEventListener("toggle", event => {
    if (event.target.matches("[data-execution-management-details]")) drafts.set(ctx.runId + "/management-open", event.target.open);
  }, true);
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
      } else if (action === "approve") {
        await post(`/api/departments/runs/${ctx.runId}/execution/approve`, { expectedGeneration: ctx.model.run.controlGeneration, confirmed: true });
        await refresh(ctx);
        feedback(ctx, tr("正式写作批准已登记。"));
      } else if (action === "failover") {
        await post(`/api/departments/runs/${ctx.runId}/execution/failover`,{confirmed:true,expectedGeneration:ctx.model.run.controlGeneration,enabled:!ctx.model.run.dutyPolicy?.enabled});
        await refresh(ctx);feedback(ctx,tr('未领取任务补位设置已保存。'));
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
    if (!form.matches("[data-execution-bind],[data-execution-reconcile],[data-execution-policy],[data-execution-assign]")) return;
    event.preventDefault();
    const data = new FormData(form);
    void perform(ctx, async () => {
      if (form.matches("[data-execution-policy]")) {
        await post(`/api/departments/runs/${ctx.runId}/execution/policy`, { expectedGeneration: ctx.model.run.controlGeneration, confirmed: true, enabled: data.get("enabled") === "on", maxAttempts: Number(data.get("maxAttempts")), reviewerFallback: data.get("reviewerFallback"), firstDelaySeconds: Number(data.get("firstDelaySeconds")), secondDelaySeconds: Number(data.get("secondDelaySeconds")) });
        drafts.delete(ctx.runId + "/policy");
        form.querySelector("button")?.blur();
        await refresh(ctx);
        feedback(ctx, tr("自动恢复设置已保存。"));
      } else if (form.dataset.executionAssign) {
        await post(`/api/departments/runs/${ctx.runId}/execution/assign`, { expectedGeneration: ctx.model.run.controlGeneration, confirmed: true, stepId: form.dataset.executionAssign, ownerAgentId: data.get("ownerAgentId") });
        drafts.delete(ctx.runId + "/assign/" + form.dataset.executionAssign);
        form.querySelector("button")?.blur();
        await refresh(ctx);
        feedback(ctx, tr("阶段分工已更新。"));
      } else if (form.dataset.executionBind) {
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
  const members = MODEL_MEMBER_IDS;
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
