import { esc } from './core.js';
import { t as tr, ui } from './i18n.js';
const states=new Map(),delivered=new Set();
const PROFILE='thoughts-v1';
let config=null,timer=null,generation=0,selected='codex';
try{const value=localStorage.getItem('wb-review-report-member')||localStorage.getItem('wb-report-member');if(['codex','cursor','workbuddy'].includes(value))selected=value;}catch{}
const labels={waiting:'等待成员领取',doing:'成员生成中',done:'报告草稿已返回',failed:'生成失败',uncertain:'执行结果不确定，请先核对旧会话。',interrupted:'等待领取已到期，未自动重发。',held:'旧报告已暂存，未写入报告库',cancelled:'旧执行已核对，未采纳其成果。'};
const message=e=>{
  let text=e.message;try{text=JSON.parse(text).error||text;}catch{}
  if(text==='report_sources_changed'||text==='input_changed')return tr('复盘来源已变化，请重新查看来源清单。');
  if(text==='already_claimed')return tr('所选成员正在处理其他任务，请稍后重试或明确选择另一成员。');
  if(text==='workbuddy_paused')return tr('WorkBuddy 调度当前暂停，未派发任务；可选择 Codex 或 Cursor。');
  return text;
};
const stateFor=key=>{if(!states.has(key))states.set(key,{});return states.get(key);};
function revealDraft(jobId){
  requestAnimationFrame(()=>{
    const editor=document.getElementById('agenda-report-body');
    if(!editor||editor.dataset.sourceJobId!==jobId)return;
    editor.closest('.agenda-report').scrollIntoView({block:'start',behavior:'auto'});
    editor.focus({preventScroll:true});
  });
}
function paint(){
  if(!config)return;
  const s=stateFor(config.key),area=document.getElementById('saved-review-report-status'),preview=document.getElementById('saved-review-report-sources');
  if(!area||!preview)return;
  const busy=s.submitting||s.loadingPreview||['waiting','doing'].includes(s.job?.status);
  const selector=document.getElementById('saved-review-report-agent');selector.value=busy&&s.job?s.job.agentId:selected;selector.disabled=!!busy;
  document.querySelector('[data-review-report-preview]').disabled=!!busy;
  const p=s.preview;
  preview.hidden=!p;
  preview.innerHTML=p?ui`<p><b>纳入的行程：</b> ${p.count} · ${esc(p.period)}</p><p>有原始复盘： ${p.rawReviewCount} · 完整读取的 Obsidian 笔记： ${p.savedNoteCount} · 异常文件： ${p.ignored.length}</p><p>逐项整理备注、原始复盘和笔记中的思考；只有安排的条目标注“未记录个人反思”。</p>${p.sources.map(source=>`<details><summary>${esc(source.ref)} · ${esc(source.date)} · ${esc(source.title)}</summary><p>${tr('备注字符数：')}${source.noteCharacters} · ${tr('原始复盘字符数：')}${source.reviewCharacters}</p>${source.files.map(file=>`<p>${esc(file.file)} · v${file.version}</p><p>${tr('首次保存时间：')}${esc(file.savedAt)}</p><small>SHA-256 ${esc(file.sha256)}</small>`).join('')}${!source.files.length?`<p>${tr('没有已保存笔记，仍纳入行程备注和原始复盘。')}</p>`:''}</details>`).join('')}${p.ignored.map(item=>`<p>${esc(item.file)} · ${esc(item.reason||item.error)}</p>`).join('')}${!p.count?ui`<p>本月没有可读取的行程或复盘记录，未派发任务。</p>`:''}<button type="button" class="solid" data-review-report-confirm ${busy||!p.count?'disabled':''}>确认生成详细思考记录</button>`:'';
  const confirm=preview.querySelector('[data-review-report-confirm]');if(confirm)confirm.onclick=()=>start();
  area.replaceChildren();
  const text=document.createElement('p');text.textContent=s.error||(s.loadingPreview?tr('正在读取已保存复盘…'):s.submitting?tr('正在提交报告任务…'):s.job?`${s.job.agentId} · ${tr(s.job.coverage?.complete===false?'返回内容有遗漏，已保留待核对':labels[s.job.status]||s.job.status)}`:'');area.append(text);
  if(s.job?.error){const e=document.createElement('p');e.textContent=s.job.error;area.append(e);}
  if(s.job&&s.job.reportProfile!==PROFILE){const e=document.createElement('p');e.textContent=tr('这里保留了此前的简短月报；新生成将采用逐项详细思考规则。');area.append(e);}
  if(s.job?.status==='done'&&!config.savedJobIds.includes(s.job.id)){const e=document.createElement('p');e.textContent=tr('草稿已生成，尚未保存到 Obsidian。请查看草稿并点击“保存到报告库和 Obsidian”。');area.append(e);}
  if(s.job?.agentId==='workbuddy'&&s.job.status==='waiting'){const e=document.createElement('p');e.textContent=tr('沿用现有每小时领取任务；本操作不改变 WorkBuddy 定时设置。');area.append(e);}
  const add=(text,action)=>{const b=document.createElement('button');b.type='button';b.className='tiny';b.textContent=tr(text);b.disabled=!!busy;b.onclick=action;area.append(b);};
  if((s.job?.status==='done'||s.job?.heldDraft)&&!config.savedJobIds.includes(s.job.id)){
    if(config.currentJobId()===s.job.id){add('查看报告草稿',()=>revealDraft(s.job.id));add('恢复原始生成稿',()=>recover());}
    else add('恢复已生成草稿',()=>recover());
  }
  if(['uncertain','held'].includes(s.job?.status))add('核对旧执行',()=>act('reconcile'));
  else if(['failed','interrupted','cancelled'].includes(s.job?.status))add('明确重试一次',()=>act('retry'));
}
function accept(c,job){
  if(job.sourceMode!=='saved-reviews')return;
  const s=stateFor(c.key);s.job=job;s.submitting=false;s.error='';
  try{localStorage.setItem('wb-review-report-job:'+c.key,job.id);}catch{}
  if(config?.key!==c.key)return;
  paint();
  const token=job.id+':'+job.attemptId;
  if(s.allowApply&&job.status==='done'&&job.draft&&!delivered.has(token)&&c.draftToken()===s.replaceToken){
    delivered.add(token);s.allowApply=false;c.onDraft(job.draft);revealDraft(job.id);
  }
}
async function poll(c,id,token){
  try{const {job}=await c.api(`/api/agenda/reports/jobs/${encodeURIComponent(id)}`);if(token!==generation||config?.key!==c.key)return;accept(c,job);if(['waiting','doing'].includes(job.status))timer=setTimeout(()=>poll(c,id,token),2000);}
  catch(e){if(token!==generation||config?.key!==c.key)return;stateFor(c.key).error=message(e);paint();if(['waiting','doing'].includes(stateFor(c.key).job?.status))timer=setTimeout(()=>poll(c,id,token),5000);}
}
export function mountSavedReviewReports(options){
  clearTimeout(timer);generation++;config=null;
  if(!document.getElementById('saved-review-report-agent'))return;
  const c=config={...options,month:options.anchorDate.slice(0,7),key:options.anchorDate.slice(0,7)+':'+PROFILE},s=stateFor(c.key);
  document.getElementById('saved-review-report-agent').onchange=e=>{selected=e.target.value;try{localStorage.setItem('wb-review-report-member',selected);}catch{}};
  document.querySelector('[data-review-report-preview]').onclick=()=>previewSavedReviewReport();
  const candidates=options.jobs.filter(j=>j.sourceMode==='saved-reviews'&&j.anchorDate.slice(0,7)===c.month&&!j.archived&&!c.savedJobIds.includes(j.id));
  paint();let id=s.job?.id||candidates.find(j=>j.reportProfile===PROFILE)?.id||candidates[0]?.id;
  if(!id)try{id=localStorage.getItem('wb-review-report-job:'+c.key);}catch{}
  if(id)void poll(c,id,generation);
}
export async function previewSavedReviewReport(){
  const c=config;if(!c)return;const s=stateFor(c.key);if(s.submitting||['waiting','doing'].includes(s.job?.status))return;
  s.error='';s.loadingPreview=true;paint();
  try{const result=await c.api('/api/agenda/reports/review-sources?profile='+PROFILE+'&anchorDate='+encodeURIComponent(c.anchorDate),{signal:AbortSignal.timeout(15000)});if(result.reportProfile!==PROFILE)throw new Error(tr('服务尚未加载详细思考规则，请稍后刷新再试。'));s.preview=result;}
  catch(e){s.error=message(e);s.preview=null;}
  finally{s.loadingPreview=false;if(config?.key===c.key)paint();}
}
async function start(){
  const c=config;if(!c)return;const s=stateFor(c.key);if(!s.preview?.count||s.submitting||['waiting','doing'].includes(s.job?.status))return;
  if(c.hasDraft()&&!window.confirm(tr('当前报告草稿尚未保存，重新生成将替换草稿。继续？')))return;
  s.replaceToken=c.draftToken();
  const requestKey=`wb-review-report-request:${c.key}:${selected}:${s.preview.snapshot}`;let key;try{key=localStorage.getItem(requestKey);}catch{}key||=crypto.randomUUID();try{localStorage.setItem(requestKey,key);}catch{}
  s.submitting=true;s.error='';paint();
  try{const {job}=await c.api('/api/agenda/reports/draft',{method:'POST',signal:AbortSignal.timeout(15000),body:{agentId:selected,view:'month',anchorDate:c.anchorDate,sourceMode:'saved-reviews',reportProfile:PROFILE,sourceSnapshot:s.preview.snapshot,idempotencyKey:key}});try{localStorage.removeItem(requestKey);}catch{}s.allowApply=true;accept(c,job);if(config?.key===c.key)void poll(c,job.id,generation);}
  catch(e){s.submitting=false;s.error=message(e);if(config?.key===c.key)paint();}
}
async function recover(){
  const c=config,s=c&&stateFor(c.key);if(!s?.job)return;
  if(c.hasDraft()&&!window.confirm(tr('当前报告草稿尚未保存，恢复原稿将替换草稿。继续？')))return;
  try{const {job}=await c.api(`/api/agenda/reports/jobs/${encodeURIComponent(s.job.id)}`);accept(c,job);if(config?.key===c.key&&(job.draft||job.heldDraft)){s.allowApply=false;c.onDraft(job.draft||job.heldDraft);revealDraft(job.id);}}
  catch(e){s.error=message(e);if(config?.key===c.key)paint();}
}
async function act(operation){
  const c=config,s=c&&stateFor(c.key),job=s?.job;if(!job||s.submitting)return;
  const body={idempotencyKey:crypto.randomUUID(),attemptId:job.attemptId,resultHash:job.resultHash,confirmed:true};
  if(operation==='reconcile'){
    if(!window.confirm(tr('请先确认旧成员会话已经停止；本操作不采纳旧成果，也不会自动重试。')))return;
    const evidence=window.prompt(tr('请填写核对旧会话已停止的依据。'));if(!evidence?.trim())return;Object.assign(body,{stopped:true,evidence,resolution:'do-not-apply'});
  }
  s.submitting=true;paint();
  try{const {job:next}=await c.api(`/api/agenda/reports/jobs/${encodeURIComponent(job.id)}/${operation}`,{method:'POST',signal:AbortSignal.timeout(15000),body});s.replaceToken=c.draftToken();s.allowApply=operation==='retry'&&!c.hasDraft();accept(c,next);if(config?.key===c.key&&['waiting','doing'].includes(next.status))void poll(c,next.id,generation);}
  catch(e){s.submitting=false;s.error=message(e);if(config?.key===c.key)paint();}
}
