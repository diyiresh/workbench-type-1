import { api, esc, getRawStore } from './core.js';
import { t as tr, ui } from './i18n.js';

const LABELS = {modules:'模块',tasks:'任务',departmentRuns:'项目',agendas:'日程',plans:'周计划',briefRuns:'简报',briefSources:'简报来源',reports:'报告',inbox:'指令',agents:'成员',memories:'记忆',lessons:'教训',skills:'技能',prompts:'提示词',specs:'规范',events:'事件记录',codexJobs:'Codex 执行记录',externalJobs:'外部执行记录',chatJobs:'群聊执行记录',projectMessages:'项目消息',artifacts:'成果',frontLearn:'学习战线',frontLife:'生活战线',habitTemplates:'习惯',habitRuns:'习惯记录',learningPlans:'学习计划'};
LABELS.skillLibrary = '技能';
const BOARDS = {home:['modules'],work:['modules','tasks'],deck:['tasks','specs'],department:['departmentRuns'],agenda:['agendas','plans'],briefs:['briefRuns','briefSources'],ops:['reports'],crew:['inbox','agents','events'],learn:['learningPlans','frontLearn','agendas'],life:['habitTemplates','habitRuns','frontLife','agendas'],memory:['memories','lessons','skills','skillLibrary','prompts'],set:Object.keys(LABELS)};
let board='home', mode='current', query='', limit=80, reloadStore;
let pending=null;
function list(collection) {
  const store=getRawStore();
  if(collection==='frontLearn')return store.fronts?.learn||[];
  if(collection==='frontLife')return store.fronts?.life||[];
  if(['habitTemplates','habitRuns','learningPlans'].includes(collection))return store.lifeSystem?.[collection]||[];
  return store[collection]||[];
}
function title(record) {
  return record.title||record.name||record.draft?.name||record.rule||record.body||record.text||record.date||record.id;
}
function rows() {
  return BOARDS[board].flatMap(collection=>list(collection).filter(record=>{
    if(!record.id || !!record.archived !== (mode==='archived'))return false;
    if(collection==='agendas' && ['learn','life'].includes(board) && record.category!==(board==='learn'?'学习':'生活'))return false;
    return !query||`${title(record)} ${record.id}`.toLowerCase().includes(query.toLowerCase());
  }).map(record=>({collection,record})));
}
function draw() {
  const all=rows();
  const dialog=document.getElementById('archive-dialog');
  dialog.innerHTML=ui`<section class="sheet archive-sheet" role="dialog" aria-modal="true" aria-labelledby="archive-title"><div class="section-head"><h2 id="archive-title">记录管理与归档</h2><button type="button" data-archive-close>关闭</button></div>
    <p>归档保留记录并停止后续自动执行。恢复后需明确继续。已发出的调用可能仍在完成，结果会保留而不推进阶段。</p>
    <div class="filters"><button type="button" data-archive-mode="current" aria-pressed="${mode==='current'}">当前</button><button type="button" data-archive-mode="archived" aria-pressed="${mode==='archived'}">已归档</button><input id="archive-search" type="search" aria-label="搜索记录" placeholder="搜索记录" value="${esc(query)}" /></div>
    <div class="actions"><label><input type="checkbox" id="archive-all" /> 全选当前显示</label><button type="button" data-archive-action="${mode==='archived'?'restore':'archive'}">${tr(mode==='archived'?'恢复所选':'归档所选')}</button>${mode==='current'?ui`<button type="button" data-archive-action="resume">继续所选</button>`:''}</div>
    <div id="archive-feedback" role="status"></div><div class="archive-list">${all.slice(0,limit).map(({collection,record})=>ui`<article class="archive-row"><label><input type="checkbox" data-archive-ref value="${esc(JSON.stringify({collection,id:record.id}))}" /><span><b>${esc(title(record))}</b><small>${tr(LABELS[collection])} · ${esc(record.date||record.updatedAt||record.createdAt||'')} ${record.resumeRequired?tr('· 已暂停，需明确继续'):''}</small></span></label><details><summary>查看记录</summary><pre>${esc(JSON.stringify(record,null,2))}</pre></details></article>`).join('')||ui`<p>暂无记录</p>`}</div>
    ${all.length>limit?ui`<button type="button" data-archive-more>加载更多</button>`:''}<p>${all.length} ${tr('条记录')}</p></section>`;
  dialog.querySelector('[data-archive-close]').onclick=()=>{dialog.hidden=true;pending=null;};
  dialog.querySelectorAll('[data-archive-mode]').forEach(button=>button.onclick=()=>{mode=button.dataset.archiveMode;limit=80;pending=null;draw();});
  dialog.querySelector('#archive-search').oninput=event=>{const start=event.target.selectionStart;query=event.target.value;draw();const input=dialog.querySelector('#archive-search');input.focus();try{input.setSelectionRange(start,start)}catch{}};
  dialog.querySelector('#archive-all').onchange=event=>dialog.querySelectorAll('[data-archive-ref]').forEach(input=>{input.checked=event.target.checked;});
  dialog.querySelector('[data-archive-more]')?.addEventListener('click',()=>{limit+=80;draw();});
  dialog.querySelectorAll('[data-archive-action]').forEach(button=>button.onclick=()=>preview(button.dataset.archiveAction));
}
async function preview(action) {
  const dialog=document.getElementById('archive-dialog'),feedback=dialog.querySelector('#archive-feedback');
  const items=[...dialog.querySelectorAll('[data-archive-ref]:checked')].map(input=>JSON.parse(input.value));
  if(!items.length){feedback.textContent=tr('请先选择记录');return;}
  const body={action,items};
  try {
    const result=await api('/api/archive/preview',{method:'POST',body});
    pending=body;
    feedback.innerHTML=ui`<div class="card"><b>将影响以下记录：</b><ul>${result.affected.map(item=>`<li>${esc(tr(LABELS[item.collection]))} · ${esc(item.title)}</li>`).join('')}</ul><button type="button" id="archive-apply">确认操作</button></div>`;
    feedback.querySelector('#archive-apply').onclick=async event=>{
      event.target.disabled=true;
      try{await api('/api/archive',{method:'POST',body:pending});await reloadStore();pending=null;draw();dialog.querySelector('#archive-feedback').textContent=tr('操作已保存');}
      catch(error){feedback.textContent=tr('操作失败：')+error.message;}
    };
  }catch(error){feedback.textContent=tr(error.message.includes('agent_has_active_assignments')?'成员仍有关联的在办任务，请先归档或调整任务负责人。':'操作失败：')+(error.message.includes('agent_has_active_assignments')?'':error.message);}
}
export function openArchive(which,reload,selected) {
  board=BOARDS[which]?which:'set';mode='current';query='';limit=80;reloadStore=reload;
  let dialog=document.getElementById('archive-dialog');
  if(!dialog){dialog=document.createElement('div');dialog.id='archive-dialog';dialog.className='overlay';document.body.append(dialog);dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.hidden=true;});dialog.addEventListener('keydown',event=>{if(event.key==='Escape')dialog.hidden=true;});}
  dialog.hidden=false;draw();
  if(selected){mode=list(selected.collection).find(row=>row.id===selected.id)?.archived?'archived':'current';draw();const input=[...dialog.querySelectorAll('[data-archive-ref]')].find(input=>JSON.parse(input.value).id===selected.id);if(input)input.checked=true;}
  dialog.querySelector('[data-archive-close]').focus();
}
