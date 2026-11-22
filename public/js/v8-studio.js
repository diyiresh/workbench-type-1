import { getStore, esc, ymd } from './core.js';
import { t as tr } from './i18n.js';
import { openPalette, configurePalette } from './command-palette.js';
import { FEATURES, hiddenFeatures, saveHiddenFeatures, linkVisible } from './features.js';
import { decisionInboxShell } from './decision-inbox.js';

const KEY = 'bench-v8-appearance';
export const PALETTES = ['studio', 'moonlit', 'porcelain', 'autumn'];
const CLASSIC = ['violet','warm','night','guofeng','aubergine','clementine','banana','jade','lagoon','barbra','gray','mood-indigo','raspberry-beret','big-business','pog','mint-chip','pbj','chill-vibes','forest-floor','slackr','sea-glass','lemon-lime','falling-leaves','sunrise'];
const names = ['Quiet Studio', 'Moonlit Ink', 'Porcelain Blue', 'Autumn Paper'];
const groups = [
  ['today','今日','#home/all','◷'], ['projects','项目','#projects/all','▱'],
  ['reflections','思考','#reflections/all','✎'], ['library','知识库','#assets/all','▤'],
];
export const LINKS = {
  today: [['#home/all','总览'],['#agenda/all','行程'],['#briefs/all','简报'],['#life/all','生活'],['#home/decisions','风险与决策'],['#home/modules','模块看板']],
  projects: [['#projects/business','业务项目'],['#projects/all','协作任务'],['#agents/all','成员'],['#projects/new','新建协作']],
  reflections: [['#reflections/all','行程思考'],['#reports/business','全部报告'],['#reports/monthly','月报']],
  library: [['#assets/papers','论文'],['#assets/all','资产'],['#assets/skills','技能'],['#assets/knowledge','知识来源'],['#learn/all','学习'],['#reports/pain','行业痛点'],['#reports/frontier','科技前沿'],['#reports/ai-new','AI 上新'],['#reports/construction','建筑报告'],['#reports/lab','本地实验']],
  settings: [['#set/all','系统设置'],['#tools/all','外部工具'],['#set/help','使用说明']],
};
const GROUP_NAMES = { today:'今日', projects:'项目', reflections:'思考', library:'知识库', settings:'工具与设置' };
configurePalette({
  pages: () => { const hidden = hiddenFeatures(); return Object.entries(LINKS).flatMap(([group, rows]) => rows.filter(([href]) => linkVisible(href, hidden)).map(([href, label]) => ({ href, label, group: GROUP_NAMES[group] }))); },
  actions: [
    { label:'下达指令', hint:'董事长指令台', run:()=>openComposer() },
    { label:'安排行程', hint:'每日行程', href:'#agenda/all' },
    { label:'新建协作', hint:'主管 → 执行 → 复核 → 整合', href:'#projects/new' },
    { label:'+ 新模块 / 业务项目', act:'add-module' },
    { label:'外观与主题', run:()=>openAppearance() },
    { label:'管理与归档', act:'manage-records' },
  ],
});
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

// The command composer stays docked where a recipient is implied; elsewhere it opens on demand.
function composerDocked(primary, secondary) {
  if (primary === 'crew') return secondary !== 'all';
  if (primary === 'work') return secondary !== 'all';
  if (primary === 'home') return !['all','modules'].includes(secondary);
  if (primary === 'department') return !['all','new'].includes(secondary);
  return false;
}
function syncComposerVisibility(primary, secondary) {
  const root = document.documentElement;
  if (composerDocked(primary, secondary)) root.dataset.composer = 'docked';
  else if (root.dataset.composer === 'docked') delete root.dataset.composer;
  if (document.getElementById('cmd-body')?.value.trim()) root.dataset.composer = root.dataset.composer || 'open';
}
export function openComposer() {
  const root = document.documentElement;
  if (root.dataset.composer !== 'docked') root.dataset.composer = 'open';
  document.getElementById('cmd-body')?.focus();
}
function closeComposer() {
  const root = document.documentElement;
  if (root.dataset.composer === 'open' && !document.getElementById('cmd-body')?.value.trim()) delete root.dataset.composer;
}

export function todayView() {
  const s=getStore(), date=ymd();
  const agendas=(s.agendas||[]).filter(a=>a.date===date&&!a.archived).sort((a,b)=>String(a.time).localeCompare(String(b.time)));
  const last=(s.agendas||[]).filter(a=>a.review).sort((a,b)=>String(b.date).localeCompare(String(a.date)))[0];
  return `<section class="v8-welcome"><div><div class="eyebrow">${esc(date)} · BEN / PERSONAL STUDIO</div><h2>${tr('把注意力，留给重要的事。')}</h2><p>${tr('安排今天，推进工作，也留住自己的思考。')}</p></div><div class="v8-landscape" aria-hidden="true"></div></section>
  <div class="v8-today-grid"><section class="v8-schedule"><div class="v8-heading"><h2>${tr('今日安排')}</h2><a class="tiny" href="#agenda/all">${tr('查看完整行程 →')}</a></div>
  ${agendas.length?agendas.map(a=>`<article class="v8-agenda-row"><span class="v8-check" aria-label="${a.done?tr('已完成'):tr('待处理')}">${a.done?'✓':'○'}</span><time>${esc(a.time||'—')}</time><div><a href="#agenda/all"><strong>${esc(a.title)}</strong></a><p>${esc(a.category||'')}${a.review?' · '+tr('已记录复盘'):''}</p></div><button type="button" class="tiny" data-act="agenda-review" data-id="${esc(a.id)}">${tr('复盘')}</button></article>`).join(''):`<p class="agenda-empty">${tr('今天尚未安排行程。')}</p>`}
  <a href="#agenda/all" class="v8-add">+ ${tr('安排行程')}</a></section>
  <aside class="v8-attention"><div class="eyebrow">${tr('待你确认')}</div><h3>${tr('下一步，从这里开始')}</h3>
  ${decisionInboxShell('compact')}<a href="#home/decisions">${tr('风险与决策 →')}</a></aside></div>
  <section class="v8-thought"><div class="eyebrow">${tr('值得留住的思考')}</div><h3>${last?esc(last.title):tr('不仅记录结果，也记录判断如何改变。')}</h3>${last?`<p>${esc(last.review.slice(0,240))}${last.review.length>240?'…':''}</p>`:''}<a href="#reflections/all">${tr('进入思考空间 →')}</a></section>`;
}
export function reflectionsView() {
  const s=getStore(), rows=(s.agendas||[]).filter(a=>a.review).sort((a,b)=>String(b.date).localeCompare(String(a.date)));
  return `<section class="v8-reflection-header"><div class="eyebrow">REFLECTIONS</div><h2>${tr('让每一次思考，有迹可循。')}</h2><p>${tr('保留原始复盘；摘要和月报继续通过原有确认流程保存。')}</p><p><a href="#agenda/all">${tr('从行程生成月报 →')}</a></p><label>${tr('筛选标题与复盘原文')}<input type="search" id="v8-reflection-filter" placeholder="${tr('输入关键词')}" /></label></section>
  <div class="v8-reflection-list">${rows.map(a=>`<article class="card v8-reflection" data-v8-reflection><small>${esc(a.date)} · ${esc(a.time||'')}</small><h3>${esc(a.title)}</h3><p>${esc(a.review)}</p><button type="button" class="tiny" data-act="agenda-review" data-id="${esc(a.id)}">${tr('编辑复盘与摘要')}</button></article>`).join('')||`<p class="agenda-empty">${tr('还没有记录复盘。')}</p>`}</div><p id="v8-reflection-empty" hidden>${tr('没有匹配的复盘。')}</p>`;
}
let activeGroup='today';
function paintTabs() {
  document.querySelector('.v8-subnav')?.remove();
  const hidden=hiddenFeatures();
  const tabs=document.createElement('nav');tabs.className='v8-subnav';tabs.setAttribute('aria-label',tr('分类入口'));
  tabs.innerHTML=LINKS[activeGroup].filter(([url])=>linkVisible(url,hidden)).map(([url,zh])=>`<a href="${url}" ${location.hash===url?'aria-current="page"':''}>${tr(zh)}</a>`).join('');
  document.getElementById('ws-head').after(tabs);
}
export function mountStudio(primary,secondary) {
  appearance();
  syncComposerVisibility(primary, secondary);
  let nav=document.getElementById('v8-nav');
  if(!nav){nav=document.createElement('nav');nav.id='v8-nav';nav.setAttribute('aria-label','Workbench V8');document.getElementById('shell').prepend(nav);}
  const active=parent(primary,secondary);
  nav.innerHTML=`<a class="v8-brand" href="#home/all">BEN<small>WORKBENCH · V8</small></a><span class="v8-studio-label">PERSONAL STUDIO</span>${groups.map(([id,zh,url,icon])=>`<a href="${url}" ${id===active?'aria-current="page"':''}><span aria-hidden="true">${icon}</span>${tr(zh)}</a>`).join('')}<div class="v8-nav-bottom"><button type="button" data-v8="palette"><span aria-hidden="true">⌕</span> ${tr('搜索与命令')} <kbd>Ctrl K</kbd></button><button type="button" data-v8="composer"><span aria-hidden="true">✉</span> ${tr('下达指令')}</button><button type="button" data-v8="appearance"><span aria-hidden="true">◐</span> ${tr('外观与主题')}</button><a href="#set/all" ${active==='settings'?'aria-current="page"':''}><span aria-hidden="true">⚙</span> ${tr('工具与设置')}</a></div>`;
  activeGroup=active;paintTabs();
  const composer=document.getElementById('composer');
  if(composer&&!composer.querySelector('[data-v8="composer-close"]')){const close=document.createElement('button');close.type='button';close.className='v8-composer-close';close.dataset.v8='composer-close';composer.append(close);}
  const close=composer?.querySelector('[data-v8="composer-close"]');
  if(close){close.textContent='×';close.setAttribute('aria-label',tr('收起指令台'));}
  document.title='BEN · Workbench V8';
  if(primary==='set'&&secondary!=='help'){
    const button=document.createElement('button');button.type='button';button.className='solid v8-appearance-entry';button.dataset.v8='appearance';button.textContent=tr('打开 V8 外观画廊');document.getElementById('ws-body').prepend(button);
  }
}
function openAppearance() {
  if(document.getElementById('v8-appearance'))return;
  preview={...saved};
  const dialog=document.createElement('dialog');dialog.id='v8-appearance';
  const classic=document.getElementById('theme-select');
  const classicOpen=preview.palette==='classic';
  dialog.innerHTML=`<form method="dialog"><div class="v8-heading"><h2>${tr('外观')}</h2><button type="button" data-v8="cancel" aria-label="${tr('关闭')}">×</button></div><p>${tr('此浏览器的显示偏好；预览不会修改业务记录。')}</p><div class="v8-theme-gallery">${PALETTES.map((id,i)=>`<button type="button" data-v8-palette="${id}" aria-pressed="${preview.palette===id}"><span class="v8-theme-sample sample-${id}"><i></i><i></i><i></i></span>${names[i]}</button>`).join('')}</div>
  <details class="v8-classic-drawer" ${classicOpen?'open':''}><summary>${tr('经典主题')} · ${CLASSIC.length}</summary><label>${tr('经典主题')}<select id="v8-classic"><option value="">${tr('选择经典主题…')}</option>${classic?classic.innerHTML:CLASSIC.map(id=>`<option value="${id}">${id}</option>`).join('')}</select></label><button type="button" data-v8="use-classic">${tr('使用已保存的经典主题')}</button></details>
  <label>${tr('界面密度')}<select id="v8-density"><option value="comfortable">${tr('舒适')}</option><option value="compact">${tr('紧凑')}</option></select></label>
  <label class="check-line"><input id="v8-art" type="checkbox" ${preview.artwork?'checked':''}>${tr('显示装饰图')}</label><label class="check-line"><input id="v8-system" type="checkbox" ${preview.system?'checked':''}>${tr('跟随系统明暗（Quiet Studio / Moonlit Ink）')}</label>
  <label>${tr('界面布局')}<select id="v8-layout"><option value="studio">V8 Quiet Studio</option><option value="classic">${tr('原版布局')}</option></select></label>
  <details class="v8-feature-drawer"><summary>${tr('显示的功能')}</summary><p>${tr('隐藏只影响此浏览器的导航与命令面板，不删除任何记录。')}</p>${FEATURES.map(f=>`<label class="check-line"><input type="checkbox" data-v8-feature="${f.id}" ${hiddenFeatures().has(f.id)?'':'checked'}>${tr(f.label)}</label>`).join('')}</details><p id="v8-pref-status" role="status"></p><div class="actions"><button type="button" data-v8="cancel">${tr('取消')}</button><button type="button" class="solid" data-v8="apply">${tr('应用外观')}</button></div></form>`;
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
  if(event.target.closest('[data-lv-tool=search]')){openPalette();return;}
  const action=event.target.closest('[data-v8]')?.dataset.v8;
  if(action==='palette')openPalette();
  if(action==='composer')openComposer();
  if(action==='composer-close'){const root=document.documentElement;if(root.dataset.composer==='open')delete root.dataset.composer;}
  if(action==='appearance')openAppearance();
  if(action==='cancel')document.getElementById('v8-appearance')?.close();
  if(action==='use-classic'&&preview){preview.palette='classic';preview.classicTheme=getStore().meta?.theme||'violet';appearance();}
  if(action==='apply'&&preview){
    const hidden=[...document.querySelectorAll('#v8-appearance [data-v8-feature]')].filter(box=>!box.checked).map(box=>box.dataset.v8Feature);
    const next={...preview};const ok=persist(next)&&saveHiddenFeatures(hidden);document.getElementById('v8-appearance')?.close();
    if(document.querySelector('.v8-subnav'))paintTabs();
    // Appearance only: do not rerender editors or trigger any business operation.
    document.getElementById('v8-storage-warning')?.remove();
    if(!ok){const warning=document.createElement('p');warning.id='v8-storage-warning';warning.setAttribute('role','status');warning.textContent=tr('浏览器无法保存外观偏好，本次会话仍然有效。');document.getElementById('ws-head').append(warning);}
  }
});
document.addEventListener('input',event=>{
  if(event.target.id==='cmd-body'&&event.target.value.trim()&&document.documentElement.dataset.v8==='true'&&!document.documentElement.dataset.composer)document.documentElement.dataset.composer='open';
  if(event.target.id!=='v8-reflection-filter')return;
  const q=event.target.value.toLocaleLowerCase();let count=0;
  document.querySelectorAll('[data-v8-reflection]').forEach(el=>{el.hidden=!el.textContent.toLocaleLowerCase().includes(q);if(!el.hidden)count++;});document.getElementById('v8-reflection-empty').hidden=!!count;
});
document.addEventListener('keydown',event=>{
  if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();openPalette();}
  if(event.key==='Escape'&&event.target.id==='cmd-body')closeComposer();
});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change',appearance);
appearance();
