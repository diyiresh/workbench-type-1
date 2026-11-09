import { getStore, esc, ymd } from './core.js';
import { language } from './i18n.js';

const text = (zh, en) => language() === 'en' ? en : zh;
const KEY = 'bench-v8-appearance';
export const PALETTES = ['studio', 'moonlit', 'porcelain', 'autumn'];
const CLASSIC = ['violet','warm','night','guofeng','aubergine','clementine','banana','jade','lagoon','barbra','gray','mood-indigo','raspberry-beret','big-business','pog','mint-chip','pbj','chill-vibes','forest-floor','slackr','sea-glass','lemon-lime','falling-leaves','sunrise'];
const names = ['Quiet Studio', 'Moonlit Ink', 'Porcelain Blue', 'Autumn Paper'];
const groups = [
  ['today','今日','Today','#home/all','◷'], ['projects','项目','Projects','#projects/all','▱'],
  ['reflections','思考','Reflections','#reflections/all','✎'], ['library','知识库','Library','#assets/all','▤'],
];
const links = {
  today: [['#home/all','总览','Overview'],['#agenda/all','行程','Schedule'],['#briefs/all','简报','Briefings'],['#life/all','生活','Life'],['#home/decisions','风险与决策','Decisions']],
  projects: [['#projects/business','业务项目','Business projects'],['#projects/all','协作任务','Collaboration'],['#agents/all','成员','Members'],['#projects/new','新建协作','New collaboration']],
  reflections: [['#reflections/all','行程思考','Schedule reflections'],['#reports/business','全部报告','Reports'],['#reports/monthly','月报','Monthly reports'],['#agenda/all','生成行程月报','Generate from schedule']],
  library: [['#assets/all','资产','Assets'],['#assets/skills','技能','Skills'],['#assets/knowledge','知识来源','Sources'],['#learn/growth','履职成长 V9','Growth V9'],['#learn/all','学习','Learning'],['#reports/pain','行业痛点','Industry'],['#reports/frontier','科技前沿','Frontier'],['#reports/ai-new','AI 上新','AI updates'],['#reports/construction','建筑报告','Construction'],['#reports/lab','本地实验','Experiments']],
  settings: [['#set/all','系统设置','Settings'],['#tools/all','外部工具','External tools'],['#set/help','使用说明','Help']],
};
let saved = readPrefs(), preview = null;
function readPrefs() { try { return normalize(JSON.parse(localStorage.getItem(KEY)||'{}')); } catch { return normalize({}); } }
function normalize(p) { return { palette: PALETTES.includes(p?.palette) || p?.palette === 'classic' ? p.palette : 'studio', density:p?.density==='compact'?'compact':'comfortable', artwork:p?.artwork!==false, layout:p?.layout==='classic'?'classic':'studio', system:p?.system===true, classicTheme:CLASSIC.includes(p?.classicTheme)?p.classicTheme:null }; }
function persist(p) { saved=normalize(p); try { localStorage.setItem(KEY,JSON.stringify(saved)); return true; } catch { return false; } }
export function useSavedClassicTheme() { persist({...saved, palette:'classic', classicTheme:null}); appearance(); }
export function studioEnabled() { return (preview || saved).layout !== 'classic'; }
function appearance() {
  const p=preview||saved, root=document.documentElement;
  root.dataset.theme = p.classicTheme || getStore()?.meta?.theme || 'violet';
  root.dataset.v8=String(p.layout!=='classic');
  root.dataset.studioPalette=p.palette==='classic'?'classic':p.system?(matchMedia('(prefers-color-scheme: dark)').matches?'moonlit':'studio'):p.palette;
  root.dataset.studioDensity=p.density; root.dataset.studioArtwork=String(p.artwork);
}
function parent(primary, secondary) {
  if(['work','department','crew'].includes(primary))return 'projects';
  if(primary==='reflections'||(primary==='ops'&&['business','daily','retro','guidance','weekly','assessment','monthly','quarterly'].includes(secondary)))return 'reflections';
  if(['memory','learn','ops'].includes(primary))return 'library';
  if(['set','tools'].includes(primary))return 'settings';
  return 'today';
}
export function todayView() {
  const s=getStore(), date=ymd();
  const agendas=(s.agendas||[]).filter(a=>a.date===date).sort((a,b)=>String(a.time).localeCompare(String(b.time)));
  const risks=(s.tasks||[]).filter(t=>t.status==='blocked'||t.status==='review');
  const jobs=(s.agendaReportJobs||[]).filter(j=>['returned','held'].includes(j.status));
  const last=(s.agendas||[]).filter(a=>a.review).sort((a,b)=>String(b.date).localeCompare(String(a.date)))[0];
  return `<section class="v8-welcome"><div><div class="eyebrow">${esc(date)} · BEN / PERSONAL STUDIO</div><h2>${text('把注意力，留给重要的事。','Make room for what matters.')}</h2><p>${text('安排今天，推进工作，也留住自己的思考。','Plan today. Move work forward. Keep your thinking.')}</p></div><div class="v8-landscape" aria-hidden="true"></div></section>
  <div class="v8-today-grid"><section class="v8-schedule"><div class="v8-heading"><h2>${text('今日安排','Today')}</h2><a class="tiny" href="#agenda/all">${text('查看完整行程 →','Full schedule →')}</a></div>
  ${agendas.length?agendas.map(a=>`<article class="v8-agenda-row"><span class="v8-check" aria-label="${a.done?text('已完成','Completed'):text('待处理','Pending')}">${a.done?'✓':'○'}</span><time>${esc(a.time||'—')}</time><div><a href="#agenda/all"><strong>${esc(a.title)}</strong></a><p>${esc(a.category||'')}${a.review?' · '+text('已记录复盘','Reflection recorded'):''}</p></div><button type="button" class="tiny" data-act="agenda-review" data-id="${esc(a.id)}">${text('复盘','Reflect')}</button></article>`).join(''):`<p class="agenda-empty">${text('今天尚未安排行程。','No appointments scheduled today.')}</p>`}
  <a href="#agenda/all" class="v8-add">+ ${text('安排行程','Plan an appointment')}</a></section>
  <aside class="v8-attention"><div class="eyebrow">${text('待你确认','NEEDS YOUR DECISION')}</div><h3>${text('下一步，从这里开始','Your next decision')}</h3>
  ${risks.length?risks.slice(0,4).map(t=>`<a class="v8-decision" href="#home/decisions"><b>${esc(t.title||t.name||t.id)}</b><small>${t.status==='blocked'?text('任务受阻','Blocked'):text('待复核','Awaiting review')}</small></a>`).join(''):`<p>${text('当前没有受阻或待复核的任务。','No blocked tasks or pending task reviews.')}</p>`}
  ${jobs.length?`<a class="v8-decision" href="#agenda/all">${text('查看月报生成记录','View report generation records')} · ${jobs.length}</a>`:''}<a href="#home/decisions">${text('风险与决策 →','Risks and decisions →')}</a></aside></div>
  <section class="v8-thought"><div class="eyebrow">${text('值得留住的思考','A THOUGHT WORTH KEEPING')}</div><h3>${esc(last?.title||text('不仅记录结果，也记录判断如何改变。','Record how your judgment changed.'))}</h3>${last?`<p>${esc(last.review.slice(0,240))}${last.review.length>240?'…':''}</p>`:''}<a href="#reflections/all">${text('进入思考空间 →','Open Reflections →')}</a></section>`;
}
export function reflectionsView() {
  const s=getStore(), rows=(s.agendas||[]).filter(a=>a.review).sort((a,b)=>String(b.date).localeCompare(String(a.date)));
  return `<section class="v8-reflection-header"><div class="eyebrow">REFLECTIONS</div><h2>${text('让每一次思考，有迹可循。','Give every reflection a place.')}</h2><p>${text('保留原始复盘；摘要和月报继续通过原有确认流程保存。','Keep original reflections. Save summaries and reports through the existing review flow.')}</p><label>${text('筛选标题与复盘原文','Filter titles and original reflections')}<input type="search" id="v8-reflection-filter" placeholder="${text('输入关键词','Search reflections')}" /></label></section>
  <div class="v8-reflection-list">${rows.map(a=>`<article class="card v8-reflection" data-v8-reflection><small>${esc(a.date)} · ${esc(a.time||'')}</small><h3>${esc(a.title)}</h3><p>${esc(a.review)}</p><button type="button" class="tiny" data-act="agenda-review" data-id="${esc(a.id)}">${text('编辑复盘与摘要','Edit reflection and summary')}</button></article>`).join('')||`<p class="agenda-empty">${text('还没有记录复盘。','No reflections recorded yet.')}</p>`}</div><p id="v8-reflection-empty" hidden>${text('没有匹配的复盘。','No matching reflections.')}</p>`;
}
export function mountStudio(primary,secondary) {
  appearance();
  let nav=document.getElementById('v8-nav');
  if(!nav){nav=document.createElement('nav');nav.id='v8-nav';nav.setAttribute('aria-label','Workbench V9');document.getElementById('shell').prepend(nav);}
  const active=parent(primary,secondary);
  nav.innerHTML=`<a class="v8-brand" href="#home/all">BEN<small>WORKBENCH · V9 BETA</small></a><span class="v8-studio-label">PERSONAL STUDIO</span>${groups.map(([id,zh,en,url,icon])=>`<a href="${url}" ${id===active?'aria-current="page"':''}><span aria-hidden="true">${icon}</span>${text(zh,en)}</a>`).join('')}<div class="v8-nav-bottom"><button type="button" data-v8="details">${text('分类与搜索','Browse & search')}</button><button type="button" data-v8="appearance">${text('外观与主题','Appearance')}</button><a href="#set/all" ${active==='settings'?'aria-current="page"':''}>⚙ ${text('工具与设置','Tools & settings')}</a></div>`;
  document.querySelector('.v8-subnav')?.remove();
  const tabs=document.createElement('nav');tabs.className='v8-subnav';tabs.setAttribute('aria-label',text('分类入口','Section navigation'));
  tabs.innerHTML=links[active].map(([url,zh,en])=>`<a href="${url}" ${location.hash===url?'aria-current="page"':''}>${text(zh,en)}</a>`).join('');
  document.getElementById('ws-head').after(tabs);
  if(!document.querySelector('#sidebar [data-v8=details]')){const close=document.createElement('button');close.type='button';close.dataset.v8='details';close.className='tiny';close.textContent=text('关闭分类 ×','Close navigation ×');document.querySelector('#sidebar .ws-name').append(close);}
  document.title='BEN · Workbench V9';
  if(primary==='set'&&secondary!=='help'){
    const button=document.createElement('button');button.type='button';button.className='solid v8-appearance-entry';button.dataset.v8='appearance';button.textContent=text('打开 V8 外观画廊','Open V8 appearance gallery');document.getElementById('ws-body').prepend(button);
  }
}
function openAppearance() {
  if(document.getElementById('v8-appearance'))return;
  preview={...saved};
  const dialog=document.createElement('dialog');dialog.id='v8-appearance';
  const classic=document.getElementById('theme-select');
  dialog.innerHTML=`<form method="dialog"><div class="v8-heading"><h2>${text('外观','Appearance')}</h2><button type="button" data-v8="cancel" aria-label="${text('关闭','Close')}">×</button></div><p>${text('此浏览器的显示偏好；预览不会修改业务记录。','Appearance preferences for this browser. Preview does not change business records.')}</p><div class="v8-theme-gallery">${PALETTES.map((id,i)=>`<button type="button" data-v8-palette="${id}" aria-pressed="${preview.palette===id}"><span class="v8-theme-sample sample-${id}"><i></i><i></i><i></i></span>${names[i]}</button>`).join('')}</div>
  <label>${text('经典主题','Classic themes')}<select id="v8-classic"><option value="">${text('选择经典主题…','Choose classic theme…')}</option>${classic?classic.innerHTML:CLASSIC.map(id=>`<option value="${id}">${id}</option>`).join('')}</select></label><button type="button" data-v8="use-classic">${text('使用已保存的经典主题','Use saved classic theme')}</button>
  <label>${text('界面密度','Density')}<select id="v8-density"><option value="comfortable">${text('舒适','Comfortable')}</option><option value="compact">${text('紧凑','Compact')}</option></select></label>
  <label class="check-line"><input id="v8-art" type="checkbox" ${preview.artwork?'checked':''}>${text('显示装饰图','Show artwork')}</label><label class="check-line"><input id="v8-system" type="checkbox" ${preview.system?'checked':''}>${text('跟随系统明暗（Quiet Studio / Moonlit Ink）','Follow system (Quiet Studio / Moonlit Ink)')}</label>
  <label>${text('界面布局','Layout')}<select id="v8-layout"><option value="studio">V8 Quiet Studio</option><option value="classic">${text('原版布局','Classic layout')}</option></select></label><p id="v8-pref-status" role="status"></p><div class="actions"><button type="button" data-v8="cancel">${text('取消','Cancel')}</button><button type="button" class="solid" data-v8="apply">${text('应用外观','Apply appearance')}</button></div></form>`;
  document.body.append(dialog);dialog.querySelector('#v8-density').value=preview.density;dialog.querySelector('#v8-layout').value=preview.layout;
  dialog.querySelector('#v8-classic').value='';
  dialog.addEventListener('cancel',()=>{preview=null;appearance();});
  dialog.addEventListener('close',()=>{preview=null;appearance();dialog.remove();});
  dialog.addEventListener('change',()=>{
    preview.density=dialog.querySelector('#v8-density').value;preview.layout=dialog.querySelector('#v8-layout').value;preview.artwork=dialog.querySelector('#v8-art').checked;preview.system=dialog.querySelector('#v8-system').checked;
    const theme=dialog.querySelector('#v8-classic').value;if(theme){preview.palette='classic';preview.classicTheme=theme;}
    appearance();
  });
  dialog.showModal();
}
document.addEventListener('click',event=>{
  const palette=event.target.closest('[data-v8-palette]');
  if(palette&&preview){preview.palette=palette.dataset.v8Palette;preview.system=false;document.getElementById('v8-system').checked=false;document.getElementById('v8-classic').value='';document.querySelectorAll('[data-v8-palette]').forEach(b=>b.setAttribute('aria-pressed',String(b===palette)));appearance();return;}
  if(event.target.closest('[data-lv-tool=search]')){document.documentElement.setAttribute('data-v8-details','');document.getElementById('sidebar').hidden=false;document.getElementById('search').focus();}
  const action=event.target.closest('[data-v8]')?.dataset.v8;
  if(action==='details'){document.documentElement.toggleAttribute('data-v8-details');document.getElementById('sidebar').hidden=false;document.getElementById('search')?.focus();}
  if(action==='appearance')openAppearance();
  if(action==='cancel')document.getElementById('v8-appearance')?.close();
  if(action==='use-classic'&&preview){preview.palette='classic';preview.classicTheme=getStore().meta?.theme||'violet';appearance();}
  if(action==='apply'&&preview){
    const next={...preview};const ok=persist(next);document.getElementById('v8-appearance')?.close();
    // Appearance only: do not rerender editors or trigger any business operation.
    document.getElementById('v8-storage-warning')?.remove();
    if(!ok){const warning=document.createElement('p');warning.id='v8-storage-warning';warning.setAttribute('role','status');warning.textContent=text('浏览器无法保存外观偏好，本次会话仍然有效。','Appearance is active for this session; browser storage is unavailable.');document.getElementById('ws-head').append(warning);}
  }
});
document.addEventListener('input',event=>{
  if(event.target.id!=='v8-reflection-filter')return;
  const q=event.target.value.toLocaleLowerCase();let count=0;
  document.querySelectorAll('[data-v8-reflection]').forEach(el=>{el.hidden=!el.textContent.toLocaleLowerCase().includes(q);if(!el.hidden)count++;});document.getElementById('v8-reflection-empty').hidden=!!count;
});
document.addEventListener('keydown',event=>{
  if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();document.documentElement.setAttribute('data-v8-details','');document.getElementById('sidebar').hidden=false;document.getElementById('search').focus();}
  if(event.key==='Escape')document.documentElement.removeAttribute('data-v8-details');
});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change',appearance);
appearance();

window.addEventListener('hashchange',()=>document.documentElement.removeAttribute('data-v8-details'));
