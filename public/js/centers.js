import { esc, fmt, getStore } from './core.js';
import { t as tr, ui, language } from './i18n.js';
import { renderCard } from '../modules/index.js';
import { skillStudioView } from './skill-studio-ui.js';
import { executionState, executionReason } from './execution-ui.js';
import { assetSnapshot } from './focus.mjs';

let capabilities = null;
export function setCapabilities(value) { capabilities = value; }

export function businessProjectsView() {
  const projects = (getStore().modules || []).filter(m => m.type === 'project');
  return ui`<section class="card"><h2>业务项目</h2><p>长期业务项目引用原有任务与进度。协作任务单独记录执行阶段，两者不会按名称自动合并。</p><a class="tiny" href="#projects/all">查看协作任务</a></section>
    <section class="mods">${projects.map(renderCard).join('') || ui`<p class="agenda-empty">暂无项目</p>`}</section>`;
}

export function agentEvidence(agentId) {
  const attempt=(getStore().executionAttempts||[]).find(a=>a.agentId===agentId);
  const data = capabilities?.agents?.find(a => a.agentId === agentId);
  const labels = { paused:tr('已暂停'), stale:tr('领取心跳已过期'), 'heartbeat-fresh':tr('近期有领取检查'), unknown:tr('尚未核实执行通道') };
  const sources = { 'workbuddy-automation':tr('WorkBuddy 定时任务记录'), 'queue-heartbeat':tr('领取队列心跳') };
  if (!data) return ui`<p class="k">尚未核实执行通道</p>`;
  return `<div class="agent-evidence" data-agent-state="${esc(data.state)}"><p><span class="chip">${labels[data.state] || tr('尚未核实执行通道')}</span> ${esc(data.transport || tr('预留通道'))}</p>
    ${data.evidence ? `<p class="k">${sources[data.evidence] || esc(data.evidence)} · ${fmt(data.observedAt)}</p>` : ''}
    ${data.heartbeatAt ? `<p class="k">${tr('最近领取检查')} · ${fmt(data.heartbeatAt)}</p>` : ''}
    ${data.lastAttempt ? `<p class="k">${tr('最近执行记录')} · ${esc(data.lastAttempt.status)} · ${fmt(data.lastAttempt.createdAt)}</p>` : ''}
    ${attempt?`<p>${tr('最近执行尝试')} · ${executionState(attempt)} ${attempt.blockerCode?' · '+esc(executionReason(attempt.blockerCode)):''}</p><a class="tiny" href="#projects/run:${esc(attempt.runId)}">${tr('查看执行时间线')}</a>`:''}
    ${data.agentId === 'workbuddy' ? ui`<p class="k">暂停保持到你明确恢复；领取检查不代表任务执行成功。</p>` : ''}</div>`;
}

export function extensionsView() {
  const labels = { implemented:tr('已实现'), reserved:tr('预留'), unavailable:tr('不可用'), unknown:tr('未知') };
  return ui`<section class="card"><h2>扩展能力</h2><p>这里显示接口准备情况，不表示外部系统已安装、登录或可以执行。</p><button type="button" class="ghost" data-act="refresh-extensions">刷新能力清单</button>
    ${(capabilities?.extensions || []).map(e => `<div class="msg" data-extension="${esc(e.id)}"><b>${esc(e.id)}</b> <span class="chip">${labels[e.status] || tr('未知')}</span><p>${e.capabilities.map(esc).join(' · ')}</p></div>`).join('') || (capabilities?.error ? `<p role="alert">${esc(tr('能力清单读取失败'))} · ${esc(capabilities.error)}</p>` : ui`<p>正在读取能力清单…</p>`)}</section>`;
}

export function knowledgeView() {
  return ui`<section class="card"><h2>知识来源</h2><p>资料阅读和检索使用已有 VaultRAG。连接配置在设置中；本页不会启动 Docker 或其他服务。</p><a class="tiny" href="#set/all">连接设置</a>
    <p id="vault-status" class="engine-status" aria-live="polite">正在读取资料库状态…</p>
    <button type="button" class="ghost" data-act="refresh-vault">刷新状态</button>
    <label>资料检索</label><input id="vault-query" placeholder="输入问题或关键词" />
    <button type="button" class="solid" data-act="search-vault">检索依据</button><div id="vault-results"></div>
    <label>查看未覆盖文件</label><select id="vault-file-status"><option value="unsupported">格式暂不支持</option><option value="needs_ocr">需要 OCR</option><option value="failed">解析失败</option><option value="empty">无可检索文本</option><option value="capped">内容被截断</option><option value="excluded">按规则排除</option></select>
    <button type="button" class="ghost" data-act="vault-files">查看明细</button><div id="vault-files"></div></section>
    <section class="card"><h2>独立行程复盘</h2><p>只读取有效最新版，继续排除 VaultRAG。集中展示不改变其检索边界。</p><button type="button" class="ghost" data-act="agenda-notes">管理复盘笔记</button></section>`;
}

function assetDate() {
  const locale = language() === 'en' ? 'en-US' : 'zh-CN';
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }).format(new Date());
}

function skillState(skill) {
  if (skill.state === 'published') return tr('已发布');
  if (skill.state === 'draft') return tr('草稿');
  if (skill.state === 'disabled') return tr('已停用');
  return skill.state || '';
}

function assetChrome(secondary, snap) {
  const active = ['all','skills','atoms','materials','lessons','prompts','pending','knowledge','extensions'].includes(secondary) ? secondary : 'all';
  const create = secondary === 'prompts'
    ? ui`<button type="button" class="solid" data-act="add-prompt">+ 新建</button>`
    : ui`<a class="solid asset-create" href="#assets/skills">+ 新建</a>`;
  const mark = (id) => active === id ? 'active' : '';
  return ui`<div class="asset-workspace" data-asset-workspace>
    <header class="asset-hero"><div><div class="asset-kicker">YOUR PERSONAL WORKSPACE</div><h2>资产中心</h2><p>${esc(assetDate())}</p></div>${create}</header>
    <section class="asset-stats">
      <a class="asset-stat" href="#assets/skills"><b>${esc(String(snap.counts.skills))}</b><span>技能</span><small>技能工作室条目</small></a>
      <a class="asset-stat" href="#assets/atoms"><b>${esc(String(snap.counts.atoms))}</b><span>知识原子</span><small>台账记忆</small></a>
      <a class="asset-stat" href="#assets/lessons"><b>${esc(String(snap.counts.lessons))}</b><span>教训</span><small>经验与教训</small></a>
      <a class="asset-stat" href="#assets/prompts"><b>${esc(String(snap.counts.prompts))}</b><span>提示词</span><small>可复用提示词</small></a>
    </section>
    <div class="asset-banners">
      <p class="asset-banner">${tr('待确认草稿')} <b>${esc(String(snap.drafts))}</b></p>
      <p class="asset-banner">${tr('已发布技能')} <b>${esc(String(snap.published))}</b> · ${tr('技能测试记录')} <b>${esc(String(snap.skillRuns))}</b> · ${tr('旧版技能说明')} <b>${esc(String(snap.legacySkills))}</b></p>
    </div>
    <nav class="asset-chips" aria-label="资产分类">
      <a class="asset-chip ${mark('all')}" href="#assets/all">总览</a>
      <a class="asset-chip ${mark('skills')}" href="#assets/skills">技能 <small>${esc(String(snap.counts.skills))}</small></a>
      <a class="asset-chip ${mark('atoms')}" href="#assets/atoms">知识原子 <small>${esc(String(snap.counts.atoms))}</small></a>
      <a class="asset-chip ${mark('materials')}" href="#assets/materials">内容原料 <small>${esc(String(snap.counts.materials))}</small></a>
      <a class="asset-chip ${mark('lessons')}" href="#assets/lessons">教训 <small>${esc(String(snap.counts.lessons))}</small></a>
      <a class="asset-chip ${mark('prompts')}" href="#assets/prompts">提示词 <small>${esc(String(snap.counts.prompts))}</small></a>
      <a class="asset-chip ${mark('pending')}" href="#assets/pending">待整理 <small>${esc(String(snap.counts.pending))}</small></a>
      <a class="asset-chip ${mark('knowledge')}" href="#assets/knowledge">知识来源</a>
      <a class="asset-chip ${mark('extensions')}" href="#assets/extensions">扩展能力</a>
    </nav>
    <div class="asset-tools"><input id="asset-search" type="search" placeholder="搜索 Skill 名称、用途…" /><button type="button" class="ghost" data-act="asset-rescan">重新扫描</button></div>
  </div>`;
}

function libraryCards(snap) {
  return snap.library.map((skill) => {
    const name = skill.draft?.name || skill.id;
    const description = skill.draft?.description || '';
    const versions = Array.isArray(skill.versions) ? skill.versions.length : 0;
    const runs = snap.runs.filter((run) => run.skillId === skill.id).length;
    return `<article class="asset-card" data-asset-text="${esc(`${name} ${description}`)}" data-skill-library="${esc(skill.id)}"><div class="row"><b>${esc(name)}</b><span class="asset-tag">${esc(skillState(skill))}</span></div><p>${esc(description)}</p><div class="actions"><a class="tiny" href="#assets/skills">查看原文</a><span class="chip">${esc(tr('版本'))} ${esc(String(versions))}</span><span class="chip">${esc(tr('测试记录'))} ${esc(String(runs))}</span></div></article>`;
  }).join('');
}

export function assetsView(secondary, legacyView) {
  const snap = assetSnapshot(getStore());
  let body = '';
  if (secondary === 'knowledge') body = knowledgeView();
  else if (secondary === 'extensions') body = extensionsView();
  else if (secondary === 'skills') {
    const legacy = snap.skills.map((skill) => `<article class="msg" data-asset-text="${esc(`${skill.name || ''} ${skill.summary || ''}`)}" data-skill-record="${esc(skill.id)}"><b>${esc(skill.name)}</b><p>${esc(skill.summary)}</p><span class="chip">${tr('技能说明，未绑定文件')}</span></article>`).join('');
    const cards = libraryCards(snap);
    body = skillStudioView() + (cards || ui`<p class="asset-empty">技能工作室里还没有草稿或已发布技能。</p>`) + ui`<section class="card"><h2>已有技能说明</h2><p>以下是旧版说明记录，不代表已发布技能文件。</p><a class="tiny" href="#assets/lessons">查看经验与教训</a></section>${legacy}`;
  } else if (secondary === 'materials') {
    body = snap.artifacts.map((item) => `<article class="asset-card" data-asset-text="${esc(`${item.name || ''} ${item.title || ''} ${item.path || ''}`)}"><b>${esc(item.name || item.title || item.id)}</b><p>${esc(item.path || '')}</p>${item.reviewStatus ? `<span class="chip">${esc(item.reviewStatus)}</span>` : ''}</article>`).join('') || ui`<p class="asset-empty">台账里还没有内容原料。项目成果登记后会出现在这里。</p>`;
  } else if (secondary === 'pending') {
    const drafts = snap.library.filter((skill) => skill.state === 'draft');
    body = drafts.map((skill) => `<article class="asset-card" data-asset-text="${esc(skill.draft?.name || '')}"><b>${esc(skill.draft?.name || skill.id)}</b><p>${esc(skill.draft?.description || '')}</p><a class="tiny" href="#assets/skills">查看原文</a></article>`).join('') || ui`<p class="asset-empty">没有待整理的技能草稿。</p>`;
  } else if (secondary === 'prompts') body = legacyView('prompts');
  else if (secondary === 'lessons') body = ui`<section class="card"><h2>教训</h2><p>先保留来源和适用场景，再确认哪些经验值得提炼成技能；已有教训不会自动成为所有 Agent 的永久规则。</p><a class="tiny" href="#assets/skills">查看技能沉淀流程</a></section>` + legacyView('lessons');
  else body = ui`<p class="asset-note">下面是台账里的知识原子。上面的数字只统计当前台账，没有写入的不会算进去。</p>` + legacyView(secondary === 'atoms' ? 'atoms' : 'all');
  return assetChrome(secondary, snap) + `<div class="asset-results">${body}</div>`;
}
