import {api,esc} from './core.js';
import {language} from './i18n.js';
const t=(zh,en)=>language()==='en'?en:zh;
let pack=null,loading=false,filter='',topic='',reading='',favorites=false,downloaded=false,timer=null;
const statuses={unread:['未读','Unread'],reading:['在读','Reading'],finished:['已读','Finished']};
const root=()=>document.getElementById('paper-library');
const size=n=>n?(n/1048576).toFixed(1)+' MB':'0 MB';
function note(message,error=false){const el=root()?.querySelector('[data-paper-notice]');if(el){el.textContent=message;el.classList.toggle('paper-error',error);}}
export function papersView(){return `<section id="paper-library"><div class="v8-heading"><div><div class="eyebrow">PAPER LIBRARY</div><h2>${t('Agent 论文与资源','Agent papers & resources')}</h2></div><a href="https://agent01-7e0.pages.dev/" target="_blank" rel="noopener noreferrer">${t('打开原合集 ↗','Original collection ↗')}</a></div><p>${t('标题与分类来自原合集；可下载的全文、阅读状态与收藏保存在本机。','Titles and topics come from the source collection. PDFs, reading status and favorites stay local.')}</p><div class="paper-toolbar"><button type="button" class="solid" data-paper-action="import">${t('导入 / 更新目录','Import / refresh catalog')}</button><button type="button" data-paper-action="refresh">${t('刷新本机状态','Refresh local status')}</button></div><p data-paper-source></p><div class="paper-links" data-paper-collections></div><p data-paper-notice role="status" aria-live="polite">${t('读取本机目录…','Loading local catalog…')}</p><div class="paper-filters"><label>${t('搜索','Search')}<input type="search" data-paper-search placeholder="${t('标题、说明或来源链接','Title, description or source link')}" value="${esc(filter)}"></label><label>${t('分类','Topic')}<select data-paper-topic></select></label><label>${t('阅读状态','Reading status')}<select data-paper-filter-reading><option value="">${t('全部','All')}</option>${Object.entries(statuses).map(([k,v])=>`<option value="${k}" ${reading===k?'selected':''}>${t(...v)}</option>`).join('')}</select></label><label class="check-line"><input type="checkbox" data-paper-favorites ${favorites?'checked':''}>${t('只看收藏','Favorites only')}</label><label class="check-line"><input type="checkbox" data-paper-downloaded ${downloaded?'checked':''}>${t('已下载','Downloaded')}</label></div><p data-paper-count></p><div class="paper-list" data-paper-list></div></section>`;}
function paint(){
 const el=root();if(!el||!pack)return;
 const records=pack.records||[],categories=[...new Set(records.flatMap(r=>r.categories))].sort();
 const options=el.querySelector('[data-paper-topic]');const old=options.value||topic;
 options.innerHTML=`<option value="">${t('全部分类','All topics')}</option>`+categories.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');options.value=categories.includes(old)?old:'';topic=options.value;
 const source=pack.source;el.querySelector('[data-paper-source]').textContent=source?t(`原始条目 ${source.rawEntries} · 合并后 ${source.uniqueRecords} 条 · 更新于 ${new Date(source.importedAt).toLocaleString()} · 元数据尚未经逐篇核验`,`Source entries ${source.rawEntries} · ${source.uniqueRecords} unique records · Imported ${new Date(source.importedAt).toLocaleString()} · Collector metadata is not independently verified`):t('尚未导入。点击“导入 / 更新目录”读取原合集；不会自动下载论文。','No catalog imported. Import explicitly to load the source collection; PDFs are not downloaded automatically.');
 el.querySelector('[data-paper-collections]').innerHTML=(source?.collections||[]).map(c=>`<a href="${esc(c.url)}" target="_blank" rel="noopener noreferrer">${esc(c.title)} ↗ · ${t('合集链接，访问权限另行确认','Collection link; access not verified')}</a>`).join('');
 const q=filter.toLocaleLowerCase();const rows=records.filter(r=>(!q||[r.title,r.description,...r.categories,...r.links.map(l=>l.url)].join(' ').toLocaleLowerCase().includes(q))&&(!topic||r.categories.includes(topic))&&(!reading||r.readingStatus===reading)&&(!favorites||r.favorite)&&(!downloaded||r.pdf));
 el.querySelector('[data-paper-count]').textContent=t(`显示 ${rows.length} / ${records.length} 条`,`Showing ${rows.length} / ${records.length} records`);
 el.querySelector('[data-paper-list]').innerHTML=rows.map(r=>{
  const job=pack.jobs?.[r.id],busy=job?.status==='downloading';
  return `<article class="card paper-record" data-paper-id="${esc(r.id)}"><div class="paper-title"><h3>${esc(r.title)}</h3><button type="button" data-paper-action="favorite" data-id="${esc(r.id)}" aria-pressed="${r.favorite}" aria-label="${t('收藏','Favorite')} ${esc(r.title)}">${r.favorite?'★':'☆'}</button></div><small>${r.kind==='resource'?t('资源链接','Resource link'):t('论文条目','Paper entry')} · ${r.categories.map(esc).join(' · ')}</small>${r.sourcePresent===false?`<p>${t('原合集已不包含此条，保留本机记录。','No longer in source collection; local record retained.')}</p>`:''}${r.description?`<p>${esc(r.description)}</p>`:''}<div class="paper-links">${r.links.map(l=>`<a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.label)} ↗</a>`).join('')}</div><div class="paper-actions"><label>${t('阅读状态','Reading status')}<select data-paper-reading="${esc(r.id)}">${Object.entries(statuses).map(([k,v])=>`<option value="${k}" ${r.readingStatus===k?'selected':''}>${t(...v)}</option>`).join('')}</select></label>${r.pdfUrl?`<button type="button" class="solid" data-paper-action="download" data-id="${esc(r.id)}" ${busy?'disabled':''}>${busy?t('下载中…','Downloading…'):r.pdf?t('核验 / 重用 PDF','Verify / reuse PDF'):t('下载 PDF','Download PDF')}</button>`:`<span>${t('无已确认的公开 PDF 直链，请查看原文。','No supported public PDF link; open the original source.')}</span>`}${r.pdf?`<a class="tiny" href="/api/papers/${r.id}/file" target="_blank" rel="noopener">${t('查看本机 PDF','View local PDF')}</a><button type="button" data-paper-action="folder" data-id="${r.id}">${t('文件位置','Show file')}</button><button type="button" data-paper-action="markdown" data-id="${r.id}">${t('打开 Markitdown_tao','Open Markitdown_tao')}</button>`:''}</div>${busy?`<p role="status">${size(job.bytes)}${job.total?' / '+size(job.total):''}</p>`:job?.status==='failed'?`<p class="paper-error" role="status">${t('下载失败，可重试：','Download failed; you can retry: ')}${esc(job.error)}</p>`:''}${r.pdf?`<details><summary>${t('本机文件与来源','Local file & provenance')} · ${size(r.pdf.size)}</summary><p>${esc(r.pdf.file)}</p><p>SHA-256: ${esc(r.pdf.sha256)}</p><p>${esc(r.pdf.sourceUrl)}</p><p>${esc(r.pdf.savedAt)}</p><small>${t('若文件被移走或修改，查看时会提示重新下载。','Moved or modified files must be downloaded again.')}</small></details>`:''}</article>`;
 }).join('')||`<p class="agenda-empty">${t('没有匹配的条目。','No matching records.')}</p>`;
 el.querySelector('[data-paper-action=import]').disabled=loading;
}
async function refresh(){if(loading)return;loading=true;try{pack=await api('/api/papers');paint();note(pack.activeDownload?t('正在下载所选论文…','Downloading the selected paper…'):'');}catch(e){note(t('读取失败：','Could not load: ')+e.message,true);}finally{loading=false;root()?.querySelector('[data-paper-action=import]')?.removeAttribute('disabled');}
 clearTimeout(timer);if(pack?.activeDownload&&root())timer=setTimeout(refresh,900);
}
export function mountPapers(){if(root()){paint();void refresh();}else clearTimeout(timer);}
document.addEventListener('input',event=>{if(event.target.matches('[data-paper-search]')){filter=event.target.value;paint();}});
document.addEventListener('change',async event=>{
 const e=event.target;if(!e.closest('#paper-library')||!e.matches('[data-paper-topic],[data-paper-filter-reading],[data-paper-favorites],[data-paper-downloaded],[data-paper-reading]'))return;
 if(e.matches('[data-paper-topic]'))topic=e.value;if(e.matches('[data-paper-filter-reading]'))reading=e.value;
 if(e.matches('[data-paper-favorites]'))favorites=e.checked;if(e.matches('[data-paper-downloaded]'))downloaded=e.checked;
 if(e.matches('[data-paper-reading]')){try{await api('/api/papers/'+e.dataset.paperReading,{method:'PATCH',body:{readingStatus:e.value}});await refresh();}catch(error){note(error.message,true);}return;}
 paint();
});
document.addEventListener('click',async event=>{
 const button=event.target.closest('[data-paper-action]');if(!button)return;const action=button.dataset.paperAction,id=button.dataset.id;button.disabled=true;
 try{
  if(action==='import'){
   if(loading)return;loading=true;note(t('正在读取原合集目录，不会自动下载全文…','Importing metadata; no PDFs are downloaded automatically…'));
   try{pack=await api('/api/papers/import',{method:'POST',body:{}});paint();note(t('目录已更新，收藏与阅读状态已保留。','Catalog updated; favorites and reading states preserved.'));}finally{loading=false;}
  }else if(action==='refresh')await refresh();
  else if(action==='favorite'){const r=pack.records.find(r=>r.id===id);await api('/api/papers/'+id,{method:'PATCH',body:{favorite:!r.favorite}});await refresh();}
  else if(action==='download'){await api(`/api/papers/${id}/download`,{method:'POST',body:{}});await refresh();}
  else if(action==='folder')await api(`/api/papers/${id}/folder`,{method:'POST',body:{}});
  else if(action==='markdown'){
   await api(`/api/papers/${id}/folder`,{method:'POST',body:{}});
   const receipt=await api('/api/external-tools/markitdown/launch',{method:'POST',body:{actionId:'start'}});
   if(!receipt.executed)throw Error(receipt.reason||'tool_not_started');
   note(t('已打开工具并定位 PDF。请在 Markitdown_tao 界面选择该文件，转换后核对实际 Markdown 输出。','Tool opened and PDF located. Select it in Markitdown_tao, then verify the Markdown output.'));
  }
 }catch(error){note(error.message,true);}finally{button.disabled=false;}
});
