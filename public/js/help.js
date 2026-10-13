import { esc } from './core.js';
import { language, t as tr, ui } from './i18n.js';

const SECTIONS = [
  ['指挥舱','把模块、日程和项目放在一个入口。模块卡片引用台账；拖拽只改变排列，指挥会进入底部指令台。归档模块时先预览关联任务。','An overview of modules, schedules and projects. Cards reference the ledger. Dragging changes their order; Command selects the recipient in the command bar. Review linked tasks before archiving a module.'],
  ['决策台','汇总在办任务、阻塞、逾期和未打卡风险。AI 拆解先给你审阅，确认后才创建任务；它不会建立虚拟部门工作链。归档和暂停任务不计入当前风险或已完成成果。','Summarizes tasks, blockers, overdue work and missing updates. AI decomposition is a draft: confirmation creates tasks, not a department workflow. Archived and paused tasks are excluded from current risks and completion counts.'],
  ['虚拟部门','提交一次目标，主管 → 执行 → 独立复核 → 整合依次推进。执行人与复核人必须不同；退回意见保留。自动接力需要启用、服务运行及成员登录；WorkBuddy 桌面队列每小时领取。完整写作仍需 Start Writing。普通群聊不推进岗位。新项目选择正文或文件交付；文件项目由工作台生成 Word，独立核对实际文件及源版本后才可完成。项目内查看文件名、路径、版本和核验结果。旧项目的阶段完成不等于文件已核验。','Submit a goal once. Director → Executor → Independent reviewer → Integrator progress in order. Execution and review use different members; rejection history is retained. Automatic handoffs require enabled automation, a running service and signed-in agents. WorkBuddy checks the desktop queue hourly. Full writing requires Start Writing. Ordinary chat does not advance stages. Choose text or file delivery for a new project. The workbench generates Word files, and file projects complete only after independent checks of the actual files and source version. View names, paths, versions and verification in the project. Completed stages in legacy projects do not prove file acceptance.'],
  ['每日行程','按日、周、月查看真实安排，登记材料路径、完成情况与复盘。点击统计卡片筛选全部、已完成、待处理或重点事项，数字始终统计整个日期范围；重点筛选包括已完成重点项。首次进入、刷新、重新进入及切换日期范围恢复全部。报告先生成草稿，人工修改后保存，筛选不改变报告范围。重点事项在有具体开始时间且未完成时，按配置提前十二小时提醒；归档及恢复后暂停的事项不会发送提醒。','View real appointments by day, week or month. Record material paths, completion and retrospectives. Click a summary card to show all, completed, pending or important appointments. Counts always cover the whole period; important includes completed important appointments. Opening, reloading, returning to the page or changing the period resets to all appointments. Review report drafts before saving; filters do not change the report period. When configured, important incomplete appointments with a start time receive a reminder twelve hours before starting. Archived or paused appointments receive no reminders.'],
  ['简报中心','外部 Agent 通过 HTTP 或 dropbox 报送全文，按来源及 externalRunId 去重。未读、开屏摘录与归档是不同操作。归档简报保留全文；停用来源只停止展示与后续收件资格，外部定时任务需要在原工具中管理。','External agents deliver complete briefs through HTTP or dropbox. Source and externalRunId identify duplicates. Unread state, opening excerpts and archiving are separate actions. Archived briefs retain their full text. Disabled sources are excluded from intake and display; external schedules must be managed in their original tools.'],
  ['经营','依据当前任务或日程事实生成七类经营报告。生成不等于业务验收；报告可以编辑、保存及归档。归档任务不被视为已完成，历史报告正文保持原样。','Generate seven report types from recorded tasks or appointments. Generation is not business acceptance. Reports can be edited, saved and archived. Archiving a task does not complete it, and existing report bodies remain unchanged.'],
  ['舰队','显示成员、相关任务、待领指令和最近动态。董事长指令依次经过 queued → ack → doing → done；部门岗位领取是独立通道。仍有在办任务的成员不能直接停用，须先调整负责人或归档关联任务。','Shows members, linked tasks, pending instructions and recent activity. Instructions follow queued → ack → doing → done. Department assignments use a separate channel. Reassign or archive active work before disabling a member.'],
  ['事业部','按业务模块查看绑定任务、负责人、进度与下一步。它和指挥舱引用同一条任务，不另记进度。归档关联任务后，两处同步隐藏；恢复后由你明确继续。','Organizes business modules around linked tasks, owners, progress and next actions. It shares tasks with the overview rather than maintaining separate progress. Archiving a linked task hides it in both views; explicitly continue after restoration.'],
  ['学习','繁星引用分类为学习的日程；银河保存你采纳的学习计划。AI 建议经采纳后才进入计划，学习次数按真实记录更新。可归档计划、学习事项及战线记录。','Stars reference appointments categorized as learning. The galaxy contains adopted learning plans. AI suggestions become plans only after adoption, and sessions use recorded completion. Archive plans, appointments or learning tracks.'],
  ['生活','繁星引用生活日程；银河按习惯模板和日期生成习惯记录。完成、跳过、复盘均保存在台账。归档习惯模板停止后续生成，归档历史记录保留原始事实。','Stars reference personal appointments. The galaxy creates dated habit records from templates. Completion, skipping and reviews are stored in the ledger. Archived habit templates stop generating records; archived history retains the original facts.'],
  ['记忆','沉淀记忆、教训、技能及提示词。它们是可复用资料，不等于项目已完成。归档后从当前列表移出，在归档管理中可查看原文及恢复。','Stores reusable memories, lessons, skills and prompts. These assets do not prove project completion. Archiving removes them from current lists; view their original contents and restore them in record management.'],
  ['设置','配置主题、语言、模型路由、资料库和提醒，查看使用说明与工作台全图。模型路由与三成员自动链是不同通道。资料库只读检索；通道测试成功不代表任务完成。导出 JSON 是备份，不是另一份进度表。','Configure theme, language, model routing, knowledge retrieval and reminders. Read the guide and complete logic map. Model routing and the three-agent workflow are separate channels. Knowledge retrieval is read-only. A connection test does not prove task completion. JSON export is a backup, not a second progress ledger.'],
];
export function helpView() {
  const en=language()==='en';
  return ui`<section class="help-view"><div class="card"><h2>工作台使用说明</h2><p>唯一台账：data/store.json。所有板块引用同一份事实，聊天、打卡、模型连接与正式验收各有不同作用。</p><p>每个页面右上方“管理与归档”支持单项及批量操作；设置页入口可管理所有集合。归档前查看关联预览，恢复后显式继续。原有复核暂停仍须按原流程重试。</p><p>仅管理本工作台的记录；各 Agent 软件中的会话、外部定时任务和原始材料由原工具管理。</p></div>
    <div class="help-sections">${SECTIONS.map(([name,zh,english])=>`<details class="card"><summary>${esc(tr(name))}</summary><p>${esc(en?english:zh)}</p></details>`).join('')}</div>
    <section class="card"><h2>整个项目的工作台逻辑图</h2><p>图形与说明来源于项目 docs。展开图形可放大查看。</p><div id="logic-document" aria-live="polite">${tr('正在加载逻辑图…')}</div></section></section>`;
}
function inline(text) {
  return esc(text).replace(/`([^`]+)`/g,'<code>$1</code>').replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>');
}
function prose(source) {
  const lines=source.split('\n'),html=[];
  for(let i=0;i<lines.length;i++){
    const line=lines[i],heading=line.match(/^(#{1,4})\s+(.+)$/);
    if(heading){html.push('<h'+heading[1].length+'>'+inline(heading[2])+'</h'+heading[1].length+'>');continue;}
    if(line.trim().startsWith('|') && /^\s*\|?\s*:?-{3,}/.test(lines[i+1]||'')){
      const cells=value=>value.trim().replace(/^\||\|$/g,'').split('|').map(cell=>inline(cell.trim()));
      const headers=cells(line);i++;const rows=[];
      while((lines[i+1]||'').trim().startsWith('|'))rows.push(cells(lines[++i]));
      html.push('<div class="logic-table"><table><thead><tr>'+headers.map(cell=>'<th>'+cell+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(cell=>'<td>'+cell+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>');continue;
    }
    if(line.trim())html.push('<p class="logic-line">'+inline(line)+'</p>');
  }
  return html.join('');
}
export async function renderLogic() {
  const container=document.getElementById('logic-document');
  if(!container)return;
  const lang=language();
  try{
    const response=await fetch('/api/help/logic?language='+encodeURIComponent(lang));
    if(!response.ok)throw new Error('HTTP '+response.status);
    const source=await response.text();
    if(!container.isConnected || language()!==lang)return;
    const blocks=source.split(/```(mermaid)?\s*\n([\s\S]*?)```/g);
    const diagrams=[];
    container.innerHTML=blocks.map((block,index)=>{
      if(index%3===1)return '';
      if(index%3===2){
        if(blocks[index-1]==='mermaid'){const id='logic-'+diagrams.length;diagrams.push({id,source:block});return `<details class="logic-figure" open><summary>${tr('图形 · 点击折叠')}</summary><button type="button" data-zoom-logic="${id}" disabled>${tr('放大查看')}</button><div id="${id}" class="logic-svg"></div></details>`;}
        return `<pre>${esc(block)}</pre>`;
      }
      return prose(block);
    }).join('');
    container.querySelectorAll('[data-zoom-logic]').forEach(button=>button.onclick=()=>{
      const figure=document.createElement('dialog');figure.className='logic-zoom';
      figure.innerHTML=`<button type="button">${tr('关闭')}</button><div>${container.querySelector('#'+button.dataset.zoomLogic).innerHTML}</div>`;
      document.body.append(figure);figure.querySelector('button').onclick=()=>figure.close();figure.onclose=()=>figure.remove();figure.showModal();
    });
    const {default:mermaid}=await import('../vendor/mermaid.js');
    mermaid.initialize({startOnLoad:false,securityLevel:'strict',flowchart:{htmlLabels:false},theme:document.documentElement.dataset.theme==='night'?'dark':'default'});
    for(const diagram of diagrams){
      const target=container.querySelector('#'+diagram.id);if(!target)continue;
      const {svg}=await mermaid.render('svg-'+diagram.id+'-'+Date.now(),diagram.source);
      if(!target.isConnected)return;target.innerHTML=svg;
      container.querySelector(`[data-zoom-logic="${diagram.id}"]`).disabled=false;
    }
  }catch(error){container.textContent=tr('逻辑图加载失败：')+error.message;}
}
