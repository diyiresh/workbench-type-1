import {api,esc,fmt,getStore} from './core.js';
import {language} from './i18n.js';

const l=(zh,en)=>language()==='en'?en:zh;
const roles={director:()=>l('项目负责人','Project lead'),executor:()=>l('具体执行人','Executor'),reviewer:()=>l('独立审核人','Independent reviewer')};
const states={planning:()=>l('方案协商','Planning'),awaiting_plan_approval:()=>l('待批准方案','Plan approval'),active:()=>l('执行中','In progress'),review:()=>l('独立审核中','Independent review'),awaiting_files:()=>l('生成交付文件','Preparing files'),awaiting_acceptance:()=>l('待最终验收','Final acceptance'),blocked:()=>l('负责人处理中','Lead handling a blocker'),completed:()=>l('已完成','Completed')};
const units={'role-probe':()=>l('验证当前角色通道与读回能力','Verify role channel and readback'),'plan-draft':()=>l('拟定初步方案','Draft plan'),'plan-feedback':()=>l('提出方案意见','Plan feedback'),'plan-finalize':()=>l('处理意见并定稿','Finalize plan'),'milestone-execution':()=>l('执行节点任务','Execute milestone'),'milestone-review':()=>l('审核实际成果','Review deliverables'),'lead-check':()=>l('主动核实与协调','Check and coordinate'),'lead-delivery':()=>l('整理交付清单','Prepare handover')};
const tabs=new Map(),drafts=new Map();
function readableReview(result){
  const review=result.review;if(!review)return '';
  if(!review.checks)return review.comment||'';
  return review.checks.map((c,index)=>`${c.verdict==='pass'?l('通过','Pass'):l('退回','Reject')} · ${(result.criteria||[])[index]||c.criterionId}\n${c.location}\n${c.quote||''}\n${c.reason}`).join('\n\n')+(review.fileProofs?.length?'\n\n'+review.fileProofs.map(p=>`${result.fileSnapshot?.files?.find(f=>f.id===p.artifactId)?.name||l('交付文件','Deliverable')}\n${p.quote}`).join('\n\n'):'');
}
function receipt(store,step){
  const a=(store.executionAttempts||[]).find(a=>a.id===step.activeAttemptId);
  if(a?.state==='waiting')return l('等待通道领取','Waiting for channel claim');
  if(a?.state==='claimed')return l('已领取，等待开始回执','Claimed; awaiting start evidence');
  if(a?.state==='running')return a.startedEvidence?.source==='process-event'?l('已收到进程启动证据','Process start observed'):a.startedEvidence?.source==='member-self-report'?l('成员自报已开始','Member reports started'):l('已发起调用，等待实际成果','Invoked; awaiting output');
  if(['uncertain','held'].includes(a?.state))return l('旧执行待核对，成果不推进','Prior execution needs reconciliation');
  return ({queued:l('待领取','Queued'),doing:l('处理中','Running'),done:l('成果已返回','Returned'),blocked:l('等待前置安排','Waiting for prerequisites')})[step.status]||step.status;
}
const roleOptions=(store,chosen)=>'<option value="">'+l('请选择','Choose a member')+'</option>'+(store.agents||[]).filter(a=>['codex','cursor','workbuddy','deepseek','doubao','ollama'].includes(a.id)&&!a.archived).map(a=>`<option value="${esc(a.id)}" ${a.id===chosen?'selected':''}>${esc(a.name||a.id)}</option>`).join('');
export function rolePicker(store,value={}){
  return Object.entries(roles).map(([key,label])=>`<label>${label()}<select name="${key}">${roleOptions(store,value[key])}</select></label>`).join('');
}
export function workflowIntake(store,draft={}){
  return `<section class="department-intake card"><h2>${l('新建项目','New project')}</h2><form id="department-goal-form"><p data-intake-feedback role="status" aria-live="polite"></p><label>${l('您要完成什么？','What should this project achieve?')}<textarea name="goal" class="full" rows="4" required>${esc(draft.goal||'')}</textarea></label><label>${l('背景、约束与已有材料（可选）','Context, constraints and materials (optional)')}<textarea name="context" class="full" rows="3">${esc(draft.context||'')}</textarea></label><label>${l('交付形式','Delivery')}<select name="deliveryProfile" required>${[['','请选择交付形式','Choose delivery'],['text','正文即可','Text'],['single','一份 Word','One Word file'],['report-bundle','长篇、摘要、附件三份 Word','Report, summary and attachment Word files']].map(([v,zh,en])=>`<option value="${v}" ${draft.deliveryProfile===v?'selected':''}>${l(zh,en)}</option>`).join('')}</select></label><label>${l('任务类型与批准要求','Task type and approval')}<select name="taskType">${[['writing','正式写作','Formal writing'],['development','软件开发','Software development'],['other','其他任务','Other work']].map(([v,zh,en])=>`<option value="${v}" ${draft.taskType===v?'selected':''}>${l(zh,en)}</option>`).join('')}</select></label><div class="member-picker">${rolePicker(store,draft.roles)}</div><p class="k">${l('可先保存草稿；启动前须指定三名不同成员。负责人组织方案，董事长批准后执行。','Save a draft first. Appoint three different members before starting. The lead prepares a plan for approval.')}</p><label>${l('关联业务项目（可选）','Link business project (optional)')}<select name="businessProjectId"><option value="">${l('暂不关联','No link')}</option>${(store.modules||[]).filter(m=>!m.archived).map(m=>`<option value="${esc(m.id)}" ${draft.businessProjectId===m.id?'selected':''}>${esc(m.title||m.name||m.id)}</option>`).join('')}</select></label><details><summary>${l('进阶组织选项','Advanced organization')}</summary><label><input type="checkbox" name="v2" value="1" ${draft.v2?'checked':''}> ${l('保留执行房间组织信息','Include execution room organization')}</label></details><button class="solid" type="submit">${l('保存项目草稿','Save project draft')}</button></form></section>`;
}
function planView(p,store){
  if(!p)return `<p class="k">${l('负责人启动后拟定推进方案，再征求两方意见。','The lead drafts a plan, then collects feedback from both members.')}</p>`;
  const x=p.content;
  return `<p>${l('方案版本','Plan version')} ${p.number} · ${esc(p.kind==='final'?l('定稿','Final'):l('初稿','Draft'))}</p>${[['目标','Goal',x.goal],['范围','Scope',x.scope],['推进路径','Approach',x.approach],['依赖','Dependencies',x.dependencies],['应对安排','Contingencies',x.contingencies]].map(([zh,en,v])=>`<h3>${l(zh,en)}</h3><p style="white-space:pre-wrap">${esc(v)}</p>`).join('')}${x.milestones.map(m=>`<article class="card"><h3>${esc(m.title)}</h3><p>${esc(m.deliverable)}</p><p>${l('验收标准','Acceptance')}: ${esc(m.acceptance)}</p><p>${l('交付时间','Due')}: ${esc(fmt(m.dueAt))}</p><p>${l('依赖节点','Dependencies')}: ${esc(m.dependsOn.join(', ')||'—')}</p><ul>${m.checks.map(c=>`<li>${esc(fmt(c.at))} · ${roles[c.contactRole]()} · ${esc(c.reason)}</li>`).join('')}</ul></article>`).join('')}`;
}
function manualControls(run,store){
  return `<details data-workflow-details="manual"><summary>${l('人工 / 外部 Agent 回填','Manual / external Agent handoff')}</summary>${run.items.map(s=>{
    const a=(store.executionAttempts||[]).find(a=>a.id===s.activeAttemptId);
    if(a?.transport==='manual-member'&&['claimed','running'].includes(a.state)){
      const p=a.manualPrompt||run.workflowReceipts.find(r=>r.result.attemptId===a.id)?.result.prompt||'';
      return `<form data-workflow-manual="${esc(a.id)}" data-claim-id="${esc(a.claimId)}"><h3>${roles[s.role]()}</h3><label>${l('交给该成员的当前任务','Current task for this member')}<textarea readonly rows="5">${esc(p)}</textarea></label><label>${l('粘贴该成员的完整真实回复','Paste the member’s complete actual reply')}<textarea name="output" rows="6" required maxlength="150000"></textarea></label><button class="ghost" type="submit">${l('按当前领取记录提交','Submit against this claim')}</button></form>`;
    }
    return s.status==='queued'&&s.purpose!=='role-probe'?`<p>${roles[s.role]()} · ${esc(s.ownerAgentId)} <button class="ghost" data-workflow-action="manual-start" data-step-id="${esc(s.id)}">${l('人工领取当前任务','Claim this task manually')}</button></p>`:'';
  }).join('')}</details>`;
}
export function workflowRoom(run,store,{chat,members,controls,files,menu}){
  const latest=run.planVersions.at(-1),appointed=Object.values(run.roleAppointments.roles).filter(Boolean).length===3;
  const blocked=run.items.filter(i=>i.blocker);
  const planActive=!run.planApproval;const labels=[['progress',l('进展','Progress')],['plan',l('方案','Plan')],['results',l('成果','Results')],['discussion',l('讨论','Discussion')]];
  const next=run.items.find(i=>['queued','doing'].includes(i.status));
  return `<section class="command-hero" data-workflow-run="${esc(run.id)}"><div><h2>${esc(run.title)}</h2><p>${esc(run.goal)}</p><span class="chip">${run.automationPaused?l('已暂停','Paused'):(states[run.status]?.()||esc(run.status))}</span>${next?`<p>${roles[next.role]()} · ${units[next.purpose]?.()||esc(next.purpose)} · ${esc(next.ownerAgentId)}</p>`:''}</div><div class="hero-actions">${!run.items.some(i=>i.purpose)?`<button class="solid" data-workflow-action="start" ${appointed?'':'disabled'}>${l('请负责人组织方案','Ask lead to prepare plan')}</button>`:''}<button class="ghost" data-workflow-action="refresh">${l('刷新进展','Refresh progress')}</button>${menu}</div></section>
    <p data-workflow-feedback role="status" aria-live="polite"></p>${run.supervision.events.filter(e=>e.key.endsWith(":deadline")).map(e=>`<p class="msg">${l("节点已到期，成果以实际回执为准；负责人正在处理或等待可用通道。","Milestone due: actual receipts determine delivery; the lead is handling it or awaiting an available channel.")} ${esc(e.milestoneId)}</p>`).join('')}
    ${!run.items.some(i=>i.purpose)?`<form class="card" data-workflow-roles><h3>${l('指定三角色','Appoint three roles')}</h3>${rolePicker(store,run.roleAppointments.roles)}<button type="submit">${l('保存成员安排','Save appointments')}</button></form>`:''}
    <nav class="actions" aria-label="${l('项目内容','Project sections')}">${labels.map(([key,label])=>`<button class="ghost" data-workflow-tab="${key}" type="button">${label}</button>`).join('')}</nav>
    <section data-workflow-pane="progress" ${planActive?'hidden':''} class="card"><h2>${l('负责人推进记录','Lead progress')}</h2>${run.items.map(i=>`<p><b>${roles[i.role]()}</b> · ${esc(i.ownerAgentId||'—')} · ${esc(units[i.purpose]?.()||l('等待前置安排','Waiting'))} · ${esc(receipt(store,i))}</p>`).join('')}${run.milestones.map(m=>`<article class="card"><h3>${esc(m.title)}</h3><p>${esc(fmt(m.dueAt))} · ${esc(m.state==='done'?l('已审核','Reviewed'):m.state==='active'?l('推进中','In progress'):l('待前置节点','Waiting for dependencies'))}</p><p>${esc(m.deliverable)}</p></article>`).join('')}${run.supervision.reports.map(r=>`<article class="msg"><b>${esc(fmt(r.at))}</b><p>${esc(r.progress)}</p><p>${esc(r.evidence)}</p><p>${esc(r.nextAction)}</p></article>`).join('')}${blocked.map(i=>`<p class="msg">${roles[i.role]()} · ${esc(i.blocker?.detail||l('等待负责人安排','Waiting for lead'))}${i.blocker?` <button data-workflow-action="retry" data-step-id="${esc(i.id)}">${l('保留预算重试','Retry within budget')}</button>`:''}</p>`).join('')}${run.agentStartRequest?.state==='requested'?`<article class="msg"><b>${l('需要手动启动成员','Manual agent start needed')}: ${esc(run.agentStartRequest.agentId)}</b><p>${esc(run.agentStartRequest.reason)}</p><p>${esc(run.agentStartRequest.nextAction)}</p><button data-workflow-action="agent-start-confirm">${l('我已完成启动，重新检测','Started; check connection')}</button></article>`:''}</section>
    <section data-workflow-pane="plan" ${planActive?'':'hidden'} class="card"><h2>${l('负责人方案与两方意见','Lead plan and feedback')}</h2>${run.planningPhase==='capability'?`<p>${l('正在验证所选成员的通道与读回能力，验证通过后负责人拟案。','Verifying selected channels and readback before the lead drafts the plan.')}</p>`:''}${planView(latest,store)}${run.planFeedback.map(f=>`<details><summary>${roles[f.role]()} · ${esc(f.agentId)} · ${l('方案意见','Feedback')}</summary><p>${esc(f.comment)}</p></details>`).join('')}${run.planResolutions.flatMap(r=>r.resolutions).map(r=>`<p>${l('负责人处理','Lead resolution')}: ${esc(({accept:l('采纳','Accepted'),partial:l('部分采纳','Partly accepted'),reject:l('不采纳','Declined')})[r.decision])} · ${esc(r.reason)}</p>`).join('')}${run.status==='awaiting_plan_approval'?`<form data-workflow-revision><label>${l("需要负责人调整的内容","Requested plan changes")}<textarea name="comment" rows="3" required maxlength="6000"></textarea></label><button class="ghost" type="submit">${l("请负责人修订后再报批","Ask lead to revise")}</button></form><form data-workflow-approval><p>${l('批准本页定稿及节点安排后，才开始正式执行。','Approve this final plan and milestones to begin execution.')}</p>${run.requiresWritingApproval?`<label><input type="checkbox" name="writingApproved" required> ${l('批准该方案范围内的正式写作（Start Writing）','Approve formal writing within this plan (Start Writing)')}</label>`:''}${run.requiresDevelopmentApproval?`<label><input type="checkbox" name="developmentApproved" required> ${l('批准该方案范围内的开发（Confirm Development）','Approve development within this plan (Confirm Development)')}</label>`:''}<label><input type="checkbox" name="allowReassign"> ${l('允许负责人在本方案内安全调整执行与审核成员，保持独立审核','Allow the lead to safely reassign execution/review while preserving independence')}</label><button class="solid" type="submit">${l('批准当前方案与节点','Approve this plan and milestones')}</button></form>`:''}${run.planApproval?`<p class="chip ok">${l('已批准的方案版本','Approved plan version')} ${esc(run.planApproval.planId)}</p>`:''}<details><summary>${l('历史方案版本','Previous plan versions')}</summary>${run.planVersions.slice(0,-1).map(p=>planView(p,store)).join('')}</details></section>
    <section data-workflow-pane="results" hidden class="card"><h2>${l('节点成果与交付','Milestone deliverables')}</h2>${run.milestones.map(m=>`<details data-workflow-preview="results" data-preview-id="${esc(m.id)}"><summary>${esc(m.title)} · ${esc(m.review?.verdict||'—')}</summary><pre class="report" data-workflow-preview-body></pre>${(m.fileSnapshot?.files||[]).map(f=>`<p>${esc(f.name)} · ${f.bytes} bytes · ${esc(f.path)}</p>`).join('')}</details>`).join('')}${files}${run.finalOutput?`<h3>${l('负责人交付说明','Lead handover')}</h3><pre class="report">${esc(run.finalOutput)}</pre>${run.status==='awaiting_acceptance'?`<button class="solid" data-workflow-action="acceptance">${l('验收当前成果与文件','Accept current deliverables')}</button>`:''}`:''}</section>
    <section data-workflow-pane="discussion" hidden><div class="card">${run.items.map(i=>`<p>${roles[i.role]()} · ${esc(i.ownerAgentId)} · ${esc(receipt(store,i))}</p>`).join('')}</div>${chat}</section>
    <details class="card" data-workflow-details="controls"><summary>${l('项目控制与执行证据','Project controls and execution evidence')}</summary><div class="actions"><button data-workflow-action="control" data-control="${run.automationPaused?'resume':'pause'}">${run.automationPaused?l('明确继续','Resume'):l('暂停项目','Pause project')}</button></div>${controls}${manualControls(run,store)}<details><summary>${l('原始工作单元与历史','Work unit history')}</summary>${run.workHistory.map(h=>`<details data-workflow-preview="history" data-preview-id="${esc(h.unitId)}"><summary>${esc(units[h.purpose]?.()||h.purpose)} · ${esc(h.ownerAgentId)} · ${esc(fmt(h.at))}</summary><pre class="report" data-workflow-preview-body></pre></details>`).join('')}</details></details>`;
}
export function mountWorkflow({reload}){
  const host=document.querySelector('[data-workflow-run]');if(!host)return;
  const run=(getStore().departmentRuns||[]).find(r=>r.id===host.dataset.workflowRun);if(!run)return;
  let busy=false;
  document.querySelectorAll("[data-workflow-details]").forEach(d=>{const key=run.id+"/details/"+d.dataset.workflowDetails;d.open=drafts.get(key)===true;d.ontoggle=()=>drafts.set(key,d.open);});
  const feedback=document.querySelector('[data-workflow-feedback]');
  const show=key=>{tabs.set(run.id,key);document.querySelectorAll('[data-workflow-pane]').forEach(p=>p.hidden=p.dataset.workflowPane!==key);document.querySelectorAll('[data-workflow-tab]').forEach(b=>{b.setAttribute('aria-selected',String(b.dataset.workflowTab===key));});};
  show(tabs.get(run.id)||(run.planApproval?'progress':'plan'));
  document.querySelectorAll('[data-workflow-tab]').forEach(b=>b.onclick=()=>show(b.dataset.workflowTab));
  const send=async(action,extra={})=>{
    if(busy)return;busy=true;
    try{
      if(action==='refresh'){await reload();return;}
      await api(`/api/departments/runs/${encodeURIComponent(run.id)}/workflow/${action}`,{method:'POST',body:{expectedRevision:run.workflowRevision,expectedGeneration:run.controlGeneration||0,idempotencyKey:`wf:${run.workflowRevision}:${crypto.randomUUID()}`,...extra}});await reload();
    }catch(e){feedback.textContent=l('操作未完成，原记录已保留：','Action not completed; existing records retained: ')+e.message;}
    finally{busy=false;}
  };
  document.querySelectorAll('[data-workflow-action]').forEach(b=>b.onclick=async()=>{
    const action=b.dataset.workflowAction;
    if(action==='acceptance'){
      const snapshot=await api(`/api/departments/runs/${encodeURIComponent(run.id)}/workflow`);
      if(!snapshot.acceptanceSnapshot){feedback.textContent=l('成果或文件已变动，请重新核验。','Deliverables changed; review them again.');return;}
      return send(action,{snapshot:snapshot.acceptanceSnapshot,confirmed:true});
    }
    return send(action,{...(b.dataset.control?{action:b.dataset.control}:{}),...(b.dataset.stepId?{stepId:b.dataset.stepId}:{}),...(action==='agent-start-confirm'?{requestId:run.agentStartRequest.id}:{})});
  });
  const rolesForm=document.querySelector('[data-workflow-roles]');
  document.querySelectorAll('[data-workflow-manual]').forEach(form=>{
    const input=form.querySelector('[name="output"]'),cacheKey='manual/'+form.dataset.workflowManual;input.value=drafts.get(cacheKey)||'';input.oninput=()=>drafts.set(cacheKey,input.value);
    form.onsubmit=e=>{e.preventDefault();return send('manual-result',{attemptId:form.dataset.workflowManual,claimId:form.dataset.claimId,output:input.value});};
  });
  if(rolesForm)rolesForm.onsubmit=e=>{e.preventDefault();const data=new FormData(rolesForm);return send('appoint',{roles:Object.fromEntries(Object.keys(roles).map(key=>[key,data.get(key)]))});};
  const revisionForm=document.querySelector("[data-workflow-revision]");
  if(revisionForm){const cacheKey=run.id+"/revision/"+run.planVersions.at(-1).id;const input=revisionForm.querySelector("textarea");input.value=drafts.get(cacheKey)||"";input.oninput=()=>drafts.set(cacheKey,input.value);revisionForm.onsubmit=e=>{e.preventDefault();return send("revise",{planId:run.planVersions.at(-1).id,planHash:run.planVersions.at(-1).hash,comment:input.value});};}
  document.querySelectorAll("[data-workflow-preview]").forEach(d=>{d.ontoggle=async()=>{if(!d.open||d.dataset.loaded||d.dataset.loading)return;d.dataset.loading="1";const target=d.querySelector("[data-workflow-preview-body]");try{const result=await api(`/api/departments/runs/${encodeURIComponent(run.id)}/workflow/${d.dataset.workflowPreview}/${encodeURIComponent(d.dataset.previewId)}`);if(!d.isConnected)return;target.textContent=(result.output||"")+(result.review?"\n\n"+readableReview(result):"");d.dataset.loaded="1";}catch(e){target.textContent=e.message;}finally{delete d.dataset.loading;}};});
  const form=document.querySelector('[data-workflow-approval]');
  if(form){
    const previous=drafts.get(run.id+'/'+run.planVersions.at(-1).id)||{};
    form.querySelectorAll('input').forEach(i=>{i.checked=previous[i.name]===true;});
    form.onchange=()=>drafts.set(run.id+'/'+run.planVersions.at(-1).id,Object.fromEntries([...form.querySelectorAll('input')].map(i=>[i.name,i.checked])));
    form.onsubmit=async e=>{e.preventDefault();const data=new FormData(form),p=run.planVersions.at(-1);const projection=await api(`/api/departments/runs/${encodeURIComponent(run.id)}/workflow`);
      return send('approve',{confirmed:true,planId:p.id,planHash:p.hash,appointmentRevision:run.roleAppointments.revision,deliveryHash:projection.deliveryHash,writingApproved:data.has('writingApproved'),developmentApproved:data.has('developmentApproved'),allowReassign:data.has('allowReassign')});};
  }
}
