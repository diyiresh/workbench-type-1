import { esc, fmt, getStore } from './core.js';
import { t as tr, ui } from './i18n.js';
import { renderCard } from '../modules/index.js';
import { skillStudioView } from './skill-studio-ui.js';
import { executionState, executionReason } from './execution-ui.js';

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

export function assetsView(secondary, legacyView) {
  if (secondary === 'knowledge') return knowledgeView();
  if (secondary === 'extensions') return extensionsView();
  if (secondary === 'skills') {
    const skills = getStore().skills || [];
    return skillStudioView() + ui`<section class="card"><h2>已有技能说明</h2><p>以下是旧版说明记录，不代表已发布技能文件。</p><a class="tiny" href="#assets/lessons">查看经验与教训</a></section>
      ${skills.map(s => `<article class="msg" data-skill-record="${esc(s.id)}"><b>${esc(s.name)}</b><p>${esc(s.summary)}</p><span class="chip">${tr('技能说明，未绑定文件')}</span></article>`).join('')}`;
  }
  const prefix = secondary === 'lessons' ? ui`<section class="card"><h2>经验与教训</h2><p>先保留来源和适用场景，再确认哪些经验值得提炼成技能；已有教训不会自动成为所有 Agent 的永久规则。</p><a class="tiny" href="#assets/skills">查看技能沉淀流程</a></section>` : '';
  const intro = secondary === 'all' ? ui`<section class="card"><h2>资产中心</h2><p>经验、教训、提示词、技能与知识各有用途，资产记录不代表项目已经完成。</p><div class="actions"><a class="tiny" href="#assets/lessons">经验与教训</a><a class="tiny" href="#assets/skills">技能沉淀</a><a class="tiny" href="#assets/knowledge">知识来源</a><a class="tiny" href="#assets/extensions">扩展能力</a></div></section>` : '';
  return intro + prefix + legacyView(secondary);
}
