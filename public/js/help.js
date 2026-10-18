import { esc } from './core.js';
import { language, t as tr, ui } from './i18n.js';

const SECTIONS = [
  ['指挥舱','把模块、日程和项目放在一个入口。统计卡片可在本页筛选推进任务、今日行程、风险任务或在册有效成员，数字保持总览口径；点击显示全部模块恢复，刷新或重新进入默认显示完整模块。模块卡片引用台账；拖拽只改变排列，指挥会进入底部指令台。归档模块时先预览关联任务。','An overview of modules, schedules and projects. Summary cards filter ongoing tasks, daily appointments, attention items or active ledger members on this page. Counts retain their overview scope. Show all modules restores the board; refresh or re-entry defaults to all modules. Cards reference the ledger. Dragging changes their order; Command selects the recipient in the command bar. Review linked tasks before archiving a module.'],
  ['决策台','汇总在办任务、阻塞、逾期和未打卡风险。AI 拆解先给你审阅，确认后才创建任务；它不会建立虚拟部门工作链。归档和暂停任务不计入当前风险或已完成成果。','Summarizes tasks, blockers, overdue work and missing updates. AI decomposition is a draft: confirmation creates tasks, not a department workflow. Archived and paused tasks are excluded from current risks and completion counts.'],
  ['虚拟部门','提交一次目标，主管 → 执行 → 独立复核 → 整合依次推进。执行人与复核人必须不同；退回意见保留。自动接力需要启用、服务运行及成员登录；WorkBuddy 桌面队列每小时领取。完整写作仍需 Start Writing。普通群聊不推进岗位。新项目选择正文或文件交付；文件项目由工作台生成 Word，独立核对实际文件及源版本后才可完成。项目内查看文件名、路径、版本和核验结果。旧项目的阶段完成不等于文件已核验。','Submit a goal once. Director → Executor → Independent reviewer → Integrator progress in order. Execution and review use different members; rejection history is retained. Automatic handoffs require enabled automation, a running service and signed-in agents. WorkBuddy checks the desktop queue hourly. Full writing requires Start Writing. Ordinary chat does not advance stages. Choose text or file delivery for a new project. The workbench generates Word files, and file projects complete only after independent checks of the actual files and source version. View names, paths, versions and verification in the project. Completed stages in legacy projects do not prove file acceptance.'],
  ['每日行程','按日、周、月查看真实安排，登记材料路径、完成情况与复盘。点击统计卡片筛选全部、已完成、待处理或重点事项，数字始终统计整个日期范围；重点筛选包括已完成重点项。首次进入、刷新、重新进入及切换日期范围恢复全部。报告先生成草稿，人工修改后保存，筛选不改变报告范围。已完成行程的复盘可生成可编辑摘要，确认后保存到 Obsidian 专用目录；新增或修改行程的“建议”直接读取有效复盘笔记，显示日期、原文和来源。复盘笔记可标为历史参考或停用，该目录排除 VaultRAG。重点事项在有具体开始时间且未完成时，按配置提前十二小时提醒；归档及恢复后暂停的事项不会发送提醒。','View real appointments by day, week or month. Record material paths, completion and retrospectives. Click a summary card to show all, completed, pending or important appointments. Counts always cover the whole period; important includes completed important appointments. Opening, reloading, returning to the page or changing the period resets to all appointments. Review report drafts before saving; filters do not change the report period. Summarize completed reviews, edit and confirm them before saving Markdown notes to the dedicated Obsidian folder. Suggestions for new or edited appointments read active review notes directly, with dates, original text and sources. Mark notes as historical or disabled when circumstances change. This folder is excluded from VaultRAG. When configured, important incomplete appointments with a start time receive a reminder twelve hours before starting. Archived or paused appointments receive no reminders.'],
  ['简报中心','外部 Agent 通过 HTTP 或 dropbox 报送全文，按来源及 externalRunId 去重。点击统计卡片查看全部、今日到件、未读或收藏简报；点击来源卡片或二级目录查看该来源，数字始终统计完整台账。首次进入、刷新和重新进入恢复完整视图。每条简报可收藏或取消收藏，刷新和重启后保留，与已读状态独立；重复投递不会覆盖已读及收藏状态。未读、开屏摘录与归档是不同操作。归档简报保留全文和收藏状态；停用来源只停止展示与后续收件资格，外部定时任务需要在原工具中管理。','External agents deliver complete briefs through HTTP or dropbox. Source and externalRunId identify duplicates. Summary cards show all, today’s, unread or saved briefings; source cards and sidebar entries show one source. Counts always cover the complete ledger. Opening, reloading or returning to the page restores the full view. Save or unsave any briefing independently of read status. Preferences survive refresh and restart, and duplicate delivery preserves them. Unread state, opening excerpts and archiving are separate actions. Archived briefs retain their text and saved status. Disabled sources are excluded from intake and display; external schedules must be managed in their original tools.'],
  ['经营','依据当前任务或日程事实生成七类经营报告。生成不等于业务验收；报告可以编辑、保存及归档。归档任务不被视为已完成，历史报告正文保持原样。','Generate seven report types from recorded tasks or appointments. Generation is not business acceptance. Reports can be edited, saved and archived. Archiving a task does not complete it, and existing report bodies remain unchanged.'],
  ['舰队','显示成员、相关任务、待领指令和最近动态。董事长指令依次经过 queued → ack → doing → done；部门岗位领取是独立通道。仍有在办任务的成员不能直接停用，须先调整负责人或归档关联任务。','Shows members, linked tasks, pending instructions and recent activity. Instructions follow queued → ack → doing → done. Department assignments use a separate channel. Reassign or archive active work before disabling a member.'],
  ['事业部','按业务模块查看绑定任务、负责人、进度与下一步。它和指挥舱引用同一条任务，不另记进度。归档关联任务后，两处同步隐藏；恢复后由你明确继续。','Organizes business modules around linked tasks, owners, progress and next actions. It shares tasks with the overview rather than maintaining separate progress. Archiving a linked task hides it in both views; explicitly continue after restoration.'],
  ['学习','繁星引用分类为学习的日程；银河保存你采纳的学习计划。AI 建议经采纳后才进入计划，学习次数按真实记录更新。可归档计划、学习事项及战线记录。','Stars reference appointments categorized as learning. The galaxy contains adopted learning plans. AI suggestions become plans only after adoption, and sessions use recorded completion. Archive plans, appointments or learning tracks.'],
  ['生活','繁星引用生活日程；银河按习惯模板和日期生成习惯记录。完成、跳过、复盘均保存在台账。归档习惯模板停止后续生成，归档历史记录保留原始事实。','Stars reference personal appointments. The galaxy creates dated habit records from templates. Completion, skipping and reviews are stored in the ledger. Archived habit templates stop generating records; archived history retains the original facts.'],
  ['记忆','沉淀记忆、教训、技能及提示词。它们是可复用资料，不等于项目已完成。归档后从当前列表移出，在归档管理中可查看原文及恢复。','Stores reusable memories, lessons, skills and prompts. These assets do not prove project completion. Archiving removes them from current lists; view their original contents and restore them in record management.'],
  ['设置','配置主题、语言、模型路由、资料库和提醒，查看使用说明与工作台全图。模型路由与三成员自动链是不同通道。资料库只读检索；通道测试成功不代表任务完成。导出 JSON 是备份，不是另一份进度表。','Configure theme, language, model routing, knowledge retrieval and reminders. Read the guide and complete logic map. Model routing and the three-agent workflow are separate channels. Knowledge retrieval is read-only. A connection test does not prove task completion. JSON export is a backup, not a second progress ledger.'],
];
// The ten sections own functions; old routes remain aliases.
const GUIDE = SECTIONS.filter(([name]) => !['决策台','事业部'].includes(name)).map(([name,zh,en]) => {
  if (name === '指挥舱') return ['工作首页',zh + ' 风险与决策是首页的子页，提供任务总表和会议材料拆解。',en + ' Risks & decisions is a Home subpage with the task table and decomposition.'];
  if (name === '虚拟部门') return ['项目中心','业务项目保留原任务、负责人和进度；协作任务保存四岗位执行链。两类记录分区展示，不按名称自动合并。项目房间的“执行记录与技能”可暂停或明确继续、固定本阶段的已发布技能版本、查看领取/调用/返回的证据。结果不确定或迟到时先查看返回内容，核对成员会话已停止并记录不采纳依据，再决定是否重新发起；同一输入最多三次，未知用量不显示为零。刷新不执行。' + zh,'Business projects preserve their tasks, owners and progress. Collaborative tasks preserve the four-stage workflow. They are separate records and are never merged by matching names. Execution records and skills provides pause/resume controls, explicit published skill versions and claim/start/result evidence. Reconcile uncertain or late results by checking the member session has stopped and recording why the old result is not applied, then explicitly decide whether to retry. At most three attempts per input; unknown usage is not zero. Refresh never executes tasks. ' + en];
  if (name === '舰队') return ['成员中心','显示成员职责、台账指令及有来源的通道状态。台账启用不代表在线；刷新不会联系成员或改写同步时间。普通指令等待成员读取，正式项目任务进入执行通道。普通留言旁可先预览目标、交付物及验收要求，再转换成一条保持暂停的协作任务；原文和原状态保留，不自动批准写作或启动成员。最近执行尝试与通道状态分别展示。WorkBuddy 暂停保持到你明确恢复。','View responsibilities, inbox instructions and sourced channel states. Enabled registration is not live availability. Refresh does not contact agents or alter check-ins. Ordinary instructions await pickup; project tasks use execution channels. Preview a message with its goal, deliverables and acceptance criteria before converting it into a paused collaboration task. Its original text and status remain; conversion does not approve writing or start members. Recent attempts and channel state are distinct. WorkBuddy stays paused until explicitly resumed.'];
  if (name === '经营') return ['工作报告',zh + ' 行程安排回到每日行程。',en + ' Appointments are managed in Schedule.'];
  if (name === '记忆') return ['资产中心','在经验或教训旁点击创建技能草稿，编辑名称、适用范围、允许成员和 Markdown 后先保存，再勾选确认发布。版本文件写入并读回核验后才生效。可比较历史版本、载入旧版为草稿，再确认发布形成新版本。固定输入和人工检查点保存为用例，明确点击才启动一次 Codex 只读测试；可关联任务，但不推进业务阶段。查看接收回执与输出后填写人工判断依据。WorkBuddy 启停遵从你在原工具中的选择，技能测试不会启动它；其他成员授权不代表已接通测试。已有技能说明保留，不冒充实际技能文件。知识检索复用 VaultRAG，独立复盘继续排除该索引。EvoFlow 与 Multica 尚未接入。','Create a skill draft beside an experience or lesson. Edit the name, scope, allowed agents and Markdown, save it, then select the confirmation and publish. Files become active only after readback and hash verification. Compare versions or load an old version into a draft; confirmed publication creates a new version. Save fixed inputs and human review criteria as test cases. Only an explicit action starts one read-only Codex test. A linked task is a reference; its business stage is unchanged. Inspect the receipt and output, then record your evaluation evidence. WorkBuddy scheduling follows your choice in its own app; skill tests do not start it. Authorizing other agents does not connect their test channels. Legacy descriptions remain separate from skill files. Reuse VaultRAG; review notes stay excluded. EvoFlow and Multica are not connected.'];
  return [{学习:'学习成长',生活:'生活管理',设置:'系统设置'}[name]||name,zh,en];
});
export function helpView() {
  const en=language()==='en';
  return ui`<section class="help-view"><div class="card"><h2>工作台使用说明</h2><p>唯一台账：data/store.json。所有板块引用同一份事实，聊天、打卡、模型连接与正式验收各有不同作用。</p><p>每个页面右上方“管理与归档”支持单项及批量操作；设置页入口可管理所有集合。归档前查看关联预览，恢复后显式继续。原有复核暂停仍须按原流程重试。</p><p>仅管理本工作台的记录；各 Agent 软件中的会话、外部定时任务和原始材料由原工具管理。</p></div>
    <section class="card"><h3>导航与内容收起</h3><p>中文导航统一为四字；原有页面链接保持可用。</p><p>二级侧栏顶部的图标可收起侧栏，收起后在一级导航顶部展开。宽屏记住本浏览器选择，窄屏用抽屉展示；开关保留当前未提交草稿。</p><p>四角色卡片的说明与退回意见各自默认展示四行，长内容下方可展开或收起详情；完整原文和阶段成果保留。</p></section>
    <div class="help-sections">${GUIDE.map(([name,zh,english])=>`<details class="card"><summary>${esc(tr(name))}</summary><p>${esc(en?english:zh)}</p>${name === '每日行程' ? ui`<p>补充待确认问题的回复后，点击“整合补充并更新摘要”，审阅后确认保存新版本。可以对照或恢复整合前草稿。已保存的回复通过“载入已保存笔记”继续整理；确认保存只写入当前文本，不自动重新归纳。</p>` : ''}</details>`).join('')}</div>
    <section class="card"><h3>复盘笔记版本管理</h3><p>同一行程仅最高版本且状态有效的笔记参与建议。管理页标注当前与已被替代版本，可预览清单后移除旧版本。摘要保存区可勾选保存后移除旧版本，默认关闭；新笔记成功保存后才清理。已移除版本可在管理页恢复，不覆盖同名文件。</p></section>
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
