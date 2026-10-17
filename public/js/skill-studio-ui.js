import { api, esc, fmt, getStore } from './core.js';
import { t as tr, ui } from './i18n.js';
import MarkdownIt from '../vendor/markdown.js';
const markdown = new MarkdownIt({html:false,linkify:false});
// Preview must not fetch remote images from selected experience or draft text.
markdown.renderer.rules.image = (tokens,index) => esc(tokens[index].content || 'image');

let selected = sessionStorage.getItem('bench-skill-selected') || '';
const drafts = new Map();
let view = null;
const key = () => crypto.randomUUID();
const pendingRequests = new Map();
async function post(path,body) {
  const identity = path + JSON.stringify(body);
  if (!pendingRequests.has(identity)) pendingRequests.set(identity,key());
  const result = await api(path,{method:'POST',body:{...body,idempotencyKey:pendingRequests.get(identity)}});
  pendingRequests.delete(identity); return result;
}
function errors() { return {
  skill_revision_conflict:tr('版本已变化，请刷新后比较并重新保存。'),
  skill_idempotency_conflict:tr('重复请求参数不一致，请刷新后重试。'),
  skill_frontmatter_invalid:tr('技能文件头与名称或描述不一致，请检查。'),
  skill_invalid_text:tr('请填写完整内容，并检查长度。'),
  skill_name_invalid:tr('名称请使用小写英文、数字与连字符。'),
  skill_not_enabled:tr('技能尚未发布或已停用。'),
  skill_runtime_not_supported:tr('此成员尚未接入技能测试；WorkBuddy 保持暂停。'),
  skill_runtime_busy:tr('已有成员正在执行，请稍后重试。'),
  skill_file_changed:tr('技能文件已改变，哈希核验失败。'),
  skill_file_missing:tr('技能文件缺失，不能执行。'),
  skill_agent_not_allowed:tr('该版本未授权给此成员。'),
  skill_target_paused_or_archived:tr('关联任务已暂停或归档。'),
  skill_agent_paused_or_archived:tr('执行成员已暂停或归档。'),
  skill_context_changed:tr('执行条件已变化，结果不能用于通过判断。'),
  skill_service_restarted:tr('服务已重启，请审阅记录后明确重新测试。'),
}; }
function errorText(error) {
  let value = error.message; try { value = JSON.parse(value).error; } catch {}
  return errors()[value] || value;
}
function stateLabel(value) {
  return ({draft:tr('草稿'),published:tr('已发布'),disabled:tr('已停用'),running:tr('运行中'), 'awaiting-evaluation':tr('等待人工判断'),evaluated:tr('已人工判断'),failed:tr('运行失败'),held:tr('结果已保留，条件已变化'),interrupted:tr('服务重启中断')})[value] || value;
}
function sourceLabel(collection) {
  return ({lessons:tr('教训'),memories:tr('记忆'),artifacts:tr('成果登记（未读取文件正文）'),projectMessages:tr('项目消息'),reports:tr('报告')})[collection] || collection;
}
function alive(ctx) { return view === ctx && ctx.host.isConnected; }
function message(ctx,value) { if (alive(ctx)) ctx.host.querySelector('[data-skill-message]').textContent = value; }
function editorValue(ctx) {
  const form = ctx.host.querySelector('[data-skill-editor]');
  if (!form) return null;
  return { name:form.elements.name.value,description:form.elements.description.value,scope:form.elements.scope.value,markdown:form.elements.markdown.value,allowedAgents:[...form.querySelectorAll('[name="allowedAgents"]:checked')].map(input => input.value) };
}
function remember(ctx) { const draft = editorValue(ctx); if (draft && ctx.model) drafts.set(ctx.model.skill.id,draft); }
function versionOptions(skill) { return skill.versions.map(v => `<option value="${esc(v.id)}" ${v.id === skill.currentVersionId ? 'selected' : ''}>v${v.number}${v.fileValid ? '' : ' ⚠'}</option>`).join(''); }
function paintEditor(ctx) {
  const { skill, cases } = ctx.model, draft = drafts.get(skill.id) || skill.draft;
  const current = skill.versions.find(v => v.id === skill.currentVersionId);
  ctx.host.querySelector('[data-skill-detail]').innerHTML = ui`<section class="card"><div class="row"><h2>${esc(draft.name)}</h2><span class="chip">${stateLabel(skill.state)} · ${current ? 'v'+current.number : tr('尚无发布版本')}</span></div>
    <p>草稿只有确认发布后才能用于测试。发布不修改任何成员的全局配置。</p>
    <form data-skill-editor><fieldset class="skill-fields"><label>技能名称<input name="name" maxlength="64" required value="${esc(draft.name)}" /></label>
    <label>描述<input name="description" maxlength="240" required value="${esc(draft.description)}" /></label>
    <label>适用范围<textarea name="scope" maxlength="1200" required rows="2">${esc(draft.scope)}</textarea></label>
    <label>允许使用的成员</label><div class="actions skill-agent-choices">${(getStore().agents || []).map(a => `<label><input type="checkbox" name="allowedAgents" value="${esc(a.id)}" ${draft.allowedAgents.includes(a.id) ? 'checked' : ''} />${esc(a.name)}</label>`).join('')}</div>
    <label>技能正文（Markdown，可编辑）<textarea name="markdown" rows="15" maxlength="50000" required spellcheck="false">${esc(draft.markdown)}</textarea></label>
    <div class="actions"><button type="submit" class="solid">保存草稿</button><button type="button" class="ghost" data-skill-action="preview">预览与比较</button></div>
    <label><input type="checkbox" data-skill-confirm /> 我已检查内容及授权范围，确认发布</label>
    <div class="actions"><button type="button" class="solid" data-skill-action="publish">确认发布版本</button>${current ? `<button type="button" class="ghost" data-skill-action="toggle">${skill.state === 'disabled' ? tr('重新启用') : tr('停用技能')}</button>` : ''}</div></fieldset></form>
    <div data-skill-preview hidden></div>
    <h3>来源记录</h3>${skill.sourceRefs.map(r => `<details><summary>${esc(r.title)}</summary><p>${esc(sourceLabel(r.collection))} / ${esc(r.id)} · ${fmt(r.capturedAt)}</p><code>${esc(r.sourceHash)}</code><pre class="skill-text">${esc(r.body)}</pre></details>`).join('') || ui`<p>手动创建，未选择来源。</p>`}
    <h3>历史版本</h3>${skill.versions.length ? `<select data-skill-history aria-label="${tr('历史版本')}">${versionOptions(skill)}</select><button type="button" class="ghost" data-skill-action="restore">${tr('载入为新草稿')}</button>${skill.versions.map(v => `<p>v${v.number} · ${fmt(v.confirmedAt)} · ${v.fileValid ? tr('文件哈希已核验') : esc(errorText(new Error(v.error)))}<br><code>${esc(v.contentHash)}</code></p>`).join('')}` : ui`<p>尚无发布版本</p>`}</section>
    <section class="card"><h2>固定输入测试</h2><p>测试不会推进项目阶段。格式检查、运行结果与人工判断分别记录。</p>
    <form data-skill-case><fieldset class="skill-fields"><label>用例名称<input name="title" required maxlength="160" /></label><label>测试输入<textarea name="input" rows="4" required maxlength="16000"></textarea></label><label>人工检查点<textarea name="checks" rows="3" required maxlength="4000"></textarea></label><button type="submit" class="ghost">保存测试用例</button></fieldset></form>
    <form data-skill-run><fieldset class="skill-fields"><label>选择用例<select name="caseId" required>${cases.map(c => `<option value="${esc(c.id)}">${esc(c.title)}</option>`).join('')}</select></label>
    <label>测试版本<select name="versionId" required>${versionOptions(skill)}</select></label>
    <label>执行成员<select name="agentId"><option value="codex">Codex</option><option value="cursor" disabled>Cursor · ${tr('尚未接入技能测试')}</option><option value="workbuddy" disabled>WorkBuddy · ${tr('保持暂停')}</option></select></label>
    <label>关联任务（可选）<select name="taskId"><option value="">${tr('独立技能测试')}</option>${(getStore().tasks || []).filter(t => !t.resumeRequired).map(t => `<option value="${esc(t.id)}">${esc(t.title)}</option>`).join('')}</select></label>
    <button type="submit" class="solid" ${!cases.length || !current || skill.state !== 'published' ? 'disabled' : ''}>启动一次只读测试</button></fieldset></form><p>WorkBuddy 保留且继续暂停；此处不会唤醒它。</p></section><section class="card"><h2>测试与使用证据</h2><button type="button" class="ghost" data-skill-action="results">刷新运行记录</button><div data-skill-results></div></section>`;
  paintResults(ctx);
}
function paintResults(ctx) {
  const target = ctx.host.querySelector('[data-skill-results]'); if (!target) return;
  target.innerHTML = ctx.model.runs.map(r => ui`<article class="msg" data-skill-attempt="${esc(r.id)}"><b>v${r.versionNumber} · ${stateLabel(r.state)}</b><p>${esc(r.inputSnapshot.title)} · ${esc(r.agentId)} · ${fmt(r.createdAt)}</p>
    <p>${esc(r.id)}${r.targetRef ? ' · '+esc(r.targetRef.kind)+' / '+esc(r.targetRef.id) : ''}</p>
    <details><summary>固定输入与检查点</summary><pre class="skill-text">${esc(r.inputSnapshot.input)}\n\n${esc(r.inputSnapshot.checks)}</pre></details>
    <p>技能哈希：<code>${esc(r.contentHash)}</code></p>
    <p>传入证据：${r.deliveryEvidence ? esc(r.deliveryEvidence.transport)+' · '+tr(r.deliveryEvidence.acknowledged ? 'Agent 已确认接收' : '没有接收确认标记') : tr('尚未取得成功运行回执')}</p><p>实际采用：${tr('未知，需结合输出判断')}</p>
    ${r.error ? `<p role="alert">${esc(errorText(new Error(r.error)))}</p>` : ''}<pre class="skill-text">${esc(r.output)}</pre>
    ${r.evaluation ? `<p>${tr('人工判断')} · ${tr(r.evaluation.verdict === 'pass' ? '检查通过' : '检查未通过')} · ${esc(r.evaluation.evidence)}</p>` : r.state === 'awaiting-evaluation' ? ui`<form data-skill-evaluate="${esc(r.id)}"><fieldset class="skill-fields"><label>判断依据<textarea name="evidence" required maxlength="4000" rows="2"></textarea></label><select name="verdict"><option value="pass">检查通过</option><option value="fail">检查未通过</option></select><button type="submit" class="ghost">保存人工判断</button></fieldset></form>` : ''}</article>`).join('') || ui`<p>尚无运行记录，保存用例不会启动成员。</p>`;
}
async function load(ctx,id) {
  const model = await api('/api/skill-library/'+encodeURIComponent(id));
  if (!alive(ctx) || selected !== id) return;
  ctx.model = model; paintEditor(ctx);
  if (model.runs.some(r => r.state === 'running')) poll(ctx);
}
async function poll(ctx) {
  clearTimeout(ctx.timer);
  ctx.timer = setTimeout(async () => {
    if (!alive(ctx) || !ctx.model) return;
    try {
      const model = await api('/api/skill-library/'+encodeURIComponent(ctx.model.skill.id));
      if (!alive(ctx)) return;
      ctx.model.runs = model.runs; paintResults(ctx);
      if (model.runs.some(r => r.state === 'running')) poll(ctx);
    } catch (error) { message(ctx,errorText(error)); }
  },2500);
}
async function refreshList(ctx, selectId = selected) {
  const result = await api('/api/skill-library'); if (!alive(ctx)) return;
  const visible = result.skills.filter(s => !s.archived);
  ctx.host.querySelector('[data-skill-select]').innerHTML = `<option value="">${tr('选择技能')}</option>` + visible.map(s => `<option value="${esc(s.id)}">${esc(s.name)} · ${stateLabel(s.state)}</option>`).join('');
  selected = visible.some(s => s.id === selectId) ? selectId : visible[0]?.id || '';
  ctx.host.querySelector('[data-skill-select]').value = selected; sessionStorage.setItem('bench-skill-selected',selected);
  if (selected) await load(ctx,selected);
}
async function perform(ctx,action) {
  if (ctx.busy) return;
  const controls = [...ctx.host.querySelectorAll('button,input,select,textarea')].map(element => [element,element.disabled]);
  controls.forEach(([element]) => element.disabled = true);
  ctx.busy = true; ctx.host.querySelectorAll('fieldset').forEach(f => f.disabled = true);
  try { await action(); }
  catch (error) { message(ctx,errorText(error)); }
  finally { ctx.busy = false; controls.forEach(([element,disabled]) => { if (element.isConnected) element.disabled = disabled; }); if (alive(ctx)) ctx.host.querySelectorAll('fieldset').forEach(f => f.disabled = false); }
}
async function mutation(ctx,operation,body = {}) {
  const id = ctx.model.skill.id;
  await post(`/api/skill-library/${encodeURIComponent(id)}/${operation}`,{...body,expectedRevision:ctx.model.skill.revision});
  if (['draft','restore','publish'].includes(operation)) drafts.delete(id);
  await refreshList(ctx,id);
}
export function skillStudioView() {
  return ui`<section id="skill-studio"><section class="card"><h2>技能工作室</h2><p>选择一条经验，编辑为技能，经你确认后发布；版本和测试结果保留在本机台账。</p><div class="actions"><select data-skill-select aria-label="选择技能"></select><button type="button" class="ghost" data-skill-action="refresh">刷新技能清单</button></div>
    <label>经验来源（可选）<select data-skill-source><option value="">${tr('空白草稿')}</option></select></label><button type="button" class="solid" data-skill-action="create">创建技能草稿</button><p data-skill-message role="status" aria-live="polite"></p></section><div data-skill-detail></div></section>`;
}
export function mountSkillStudio() {
  const host = document.getElementById('skill-studio'); if (!host) return;
  if (view?.host === host) return;
  if (view) { remember(view); clearTimeout(view.timer); }
  const ctx = view = { host, model:null, busy:false };
  host.addEventListener('input',event => {
    if (!event.target.closest('[data-skill-editor]')) return;
    if (event.target.matches('[data-skill-confirm]')) return;
    if (['name','description'].includes(event.target.name)) {
      const form = event.target.form, markdown = form.elements.markdown;
      markdown.value = `---\nname: ${form.elements.name.value}\ndescription: ${JSON.stringify(form.elements.description.value)}\n---\n` + markdown.value.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/,'');
    }
    remember(ctx); host.querySelector('[data-skill-confirm]').checked = false;
  });
  host.addEventListener('change',event => {
    if (event.target.matches('[data-skill-select]')) {
      remember(ctx); selected = event.target.value; sessionStorage.setItem('bench-skill-selected',selected);
      if (selected) void perform(ctx,()=>load(ctx,selected)); else host.querySelector('[data-skill-detail]').innerHTML = '';
    }
  });
  host.addEventListener('click',event => {
    const action = event.target.closest('[data-skill-action]')?.dataset.skillAction; if (!action) return;
    if (action === 'preview') {
      const draft = editorValue(ctx), old = ctx.model.skill.versions.find(v => v.id === host.querySelector('[data-skill-history]')?.value);
      const preview = host.querySelector('[data-skill-preview]'); preview.hidden = false;
      preview.innerHTML = ui`<h3>草稿预览</h3><div class="skill-markdown">${markdown.render(draft.markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/,''))}</div><h3>版本比较</h3><div class="skill-compare"><div><b>${old ? 'v'+old.number : tr('尚无发布版本')}</b><pre class="skill-text">${esc(old?.markdown || '')}</pre></div><div><b>当前草稿</b><pre class="skill-text">${esc(draft.markdown)}</pre></div></div>`; return;
    }
    const draft = editorValue(ctx), confirmed = host.querySelector('[data-skill-confirm]')?.checked;
    void perform(ctx,async () => {
      if (action === 'create') {
        const ref = host.querySelector('[data-skill-source]').value;
        const result = await post('/api/skill-library',{sourceRefs:ref ? [JSON.parse(ref)] : []});
        await refreshList(ctx,result.skillId);
      } else if (action === 'refresh') { remember(ctx); await refreshList(ctx); }
      else if (action === 'publish') {
        if (!confirmed) return message(ctx,tr('请先勾选确认发布。'));
        if (!['name','description','scope','markdown','allowedAgents'].every(k => JSON.stringify(draft[k]) === JSON.stringify(ctx.model.skill.draft[k]))) return message(ctx,tr('请先保存当前草稿，再确认发布。'));
        await mutation(ctx,'publish',{confirmed:true}); message(ctx,tr('版本已发布，实际文件已读回核验。'));
      } else if (action === 'restore') { await mutation(ctx,'restore',{versionId:host.querySelector('[data-skill-history]').value}); message(ctx,tr('历史版本已载入草稿，确认发布后才替换生效版本。')); }
      else if (action === 'toggle') await mutation(ctx,'state',{state:ctx.model.skill.state === 'disabled' ? 'published' : 'disabled'});
      else if (action === 'results') { const result = await api('/api/skill-library/'+encodeURIComponent(ctx.model.skill.id)); if (alive(ctx)) { ctx.model.runs = result.runs; paintResults(ctx); poll(ctx); } }
    });
  });
  host.addEventListener('submit',event => {
    const form = event.target; if (!form.matches('[data-skill-editor],[data-skill-case],[data-skill-run],[data-skill-evaluate]')) return;
    event.preventDefault(); const data = Object.fromEntries(new FormData(form)), draft = editorValue(ctx);
    void perform(ctx,async () => {
      if (form.matches('[data-skill-editor]')) { await mutation(ctx,'draft',draft); message(ctx,tr('草稿已保存，尚未发布。')); }
      else if (form.matches('[data-skill-case]')) { remember(ctx); await mutation(ctx,'cases',data); message(ctx,tr('用例已保存，尚未启动成员。')); }
      else if (form.matches('[data-skill-run]')) {
        const result = await post(`/api/skill-library/${ctx.model.skill.id}/run`,{agentId:data.agentId,versionId:data.versionId,caseId:data.caseId,targetRef:data.taskId ? {kind:'task',id:data.taskId} : null});
        message(ctx,tr('测试已登记，请查看运行记录。')+' '+result.attemptId); const model = await api('/api/skill-library/'+ctx.model.skill.id); if (alive(ctx)) {ctx.model.runs = model.runs; paintResults(ctx); poll(ctx);}
      } else {
        const run = ctx.model.runs.find(r => r.id === form.dataset.skillEvaluate);
        await post(`/api/skill-library/${ctx.model.skill.id}/evaluate`,{attemptId:run.id,outputHash:run.outputHash,...data});
        const model = await api('/api/skill-library/'+ctx.model.skill.id); if (alive(ctx)) {ctx.model.runs = model.runs; paintResults(ctx);}
      }
    });
  });
  void perform(ctx,async () => {
    const result = await api('/api/skill-library/sources'); if (!alive(ctx)) return;
    host.querySelector('[data-skill-source]').innerHTML += result.sources.map(s => `<option value="${esc(JSON.stringify({collection:s.collection,id:s.id}))}">${esc(sourceLabel(s.collection))} · ${esc(s.title)}</option>`).join('');
    await refreshList(ctx);
  });
}
export function bindSkillSources() {
  document.addEventListener('click',async event => {
    const button = event.target.closest('[data-skill-from]'); if (!button || button.disabled) return;
    button.disabled = true;
    try {
      const result = await post('/api/skill-library',{sourceRefs:[{collection:button.dataset.skillFrom,id:button.dataset.skillId}]});
      selected = result.skillId; sessionStorage.setItem('bench-skill-selected',selected); location.hash = '#assets/skills';
    } catch (error) { window.alert(errorText(error)); }
    finally { button.disabled = false; }
  });
}
