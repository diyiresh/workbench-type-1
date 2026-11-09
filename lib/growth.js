'use strict';

const { randomUUID } = require('node:crypto');
const PROGRAM = 'cost-management-v9';
const LEVELS = ['待学习', '能解释', '能分析', '经复核可复用'];
const BLOCKS = [
  { name: '原文与规则学习', minutes: 90, offset: 0, action: '读适用条件、关键条款与衔接要求，记录出处。' },
  { name: '案例分析与对照', minutes: 120, offset: 1, action: '形成一张案例卡；改变一个关键条件，比较判断为什么变化。' },
  { name: '请教或业务讨论', minutes: 30, offset: 3, action: '带着自己的分析请教；无人可请教时核对原文，保留疑问。' },
  { name: '管理复盘与周总结', minutes: 30, offset: 4, action: '复盘一项实际参与的工作，更新每周一页纸。' },
  { name: '自测与复习', minutes: 30, offset: 6, action: '先独立解释和列证据缺口，再回到原文修正。' },
];
const WEEKS = [
  ['全站业务地图与概念补缺', '梳理职责、工程全过程和已有经验中的造价疑问。', '了解工作机制，练习听汇报与提出可核实的问题。'],
  ['清单、定额与计价依据', '核对新版清单配套文件、适用条件与衔接要求。', '区分事实、专业意见和需要研究的口径。'],
  ['限价、报价与合同价款', '比较价款形成、合同约定和调整条件。', '用目标、责任、成果、期限、请示点、完成判据整理交办。'],
  ['价格信息、指标与指数', '理解来源、口径、时间与用途，识别不可直接比较的条件。', '追问数据核验流程，找准需要协调的环节。'],
  ['变更、价款调整与结算争议', '梳理主张、事实、合同依据、证据缺口与待核实事项。', '准备一页议题说明，明确分歧与研究路径。'],
  ['调解与监督检查', '通过允许使用的材料梳理程序、证据与办理衔接。', '区分会议意见、正式结论和实际办理结果。'],
  ['概算编审与造价数据', '学习概算指引及数据标准，了解跨环节的数据质量问题。', '分析一个跨科室问题，先核实事实再提出改进。'],
  ['综合复习与分工深化', '回看代表性案例，按实际分工选择后续专题。', '复盘交办、协调、汇报与队伍培养，确定下一步。'],
].map(([title, business, management], i) => ({ week: i + 1, title, business, management }));
const TEMPLATES = [
  ['matter', '重点事项', '目标及依据：\n牵头与协同（待确认处注明）：\n当前事实与证据：\n期限与中间节点及来源：\n堵点和需要协调的动作：\n待研究或请示问题：\n下一步和完成判据：'],
  ['concept', '概念与文件', '用自己的话解释用途：\n发布机关、文号、版本：\n生效时间、适用范围与衔接条件：\n适用场景：\n容易误用的地方：\n仍不能确定的问题：'],
  ['case', '案例分析', '案例类型（公开／获准脱敏／教学情景）：\n工程与合同背景：\n双方主张：\n核心争议：\n已有事实与证据：\n缺失证据：\n候选依据及适用条件：\n我的判断与不确定点：\n改变一个条件后的对照：\n下一步核实动作：'],
  ['reflection', '管理复盘', '这次希望推动什么结果：\n当时掌握的事实与推测：\n我怎样交办、沟通和协调：\n实际结果与证据：\n偏差原因：\n下次改变的一个动作：\n经验不适用的条件：'],
  ['weekly', '每周一页纸', '本周实际成果及引用：\n尚未形成结果的重点事项与原因：\n需要协调或请示的问题、选项和建议：\n学懂的概念或案例：\n未解决的疑问：\n有事实支持的管理反思：\n下周重点和完成判据：'],
].map(([kind, name, body]) => ({ kind, name, body }));
const SOURCES = [
  ['机构职能', 'https://zfcj.gz.gov.cn/zwgk/zsdwxxgkzl/jsgczjglz/zzjg/content/post_11024991.html', '2026-09-29', '建立全站业务地图'],
  ['清单计价计算标准实施意见', 'https://zfcj.gz.gov.cn/zwgk/zsdwxxgkzl/jsgczjglz/jjyj/content/mpost_10426447.html', '2025-09-01', '核对适用范围、时间与衔接要求；附件待读'],
  ['设计概算编审指引（2025年版）', 'https://zfcj.gz.gov.cn/zwgk/zsdwxxgkzl/jsgczjglz/jjyj/content/post_10738585.html', '2026-03-24', '了解概算编审材料与要求；附件待读'],
  ['造价数据标准执行通知', 'https://zfcj.gz.gov.cn/gkmlpt/content/10/10658/post_10658859.html', '2026-01-23', '了解造价数据管理要求；标准附件待读'],
  ['价格信息', 'https://zfcj.gz.gov.cn/zwgk/zsdwxxgkzl/jsgczjglz/jgxx/', '', '比较同一期数据的口径与用途'],
  ['指标指数', 'https://zfcj.gz.gov.cn/zwgk/zsdwxxgkzl/jsgczjglz/zbzs/', '', '数据使用前查对应通知与说明'],
].map(([title, url, published, purpose]) => ({ title, url, published, purpose, checkedAt: '2026-11-09', status: '入口已核实；个人阅读状态请自行记录' }));
const PROMPTS = [
  { title: '业务学习与自测', text: '仅依据我提供且允许使用的材料，围绕本周主题提出三个由浅入深的问题，逐题等我回答。指出遗漏并引用文件、条款或页码。区分已说明、需补证和仍有争议的内容。材料不足就明确说明，不补造文件和事实。最后给一道标注为教学情景的迁移题。' },
  { title: '管理复盘', text: '依据工作记录，梳理目标、事实、我的动作、实际结果与未确定信息。找出一个最值得改进的管理动作并引用依据。有不同解释时列出需要补充的证据。不把登记状态当作现实完成，不推断人员动机。先追问，再整理复盘。' },
  { title: '一页汇报', text: '将已核对记录整理成一页汇报：实际成果、未解决问题、备选路径、我的建议、需请示事项。保留不确定性与引用，不新增责任人、期限、承诺或结论。材料不足时单列待补清单。' },
];

function fail(message, status = 400) { const error = new Error(message); error.status = status; throw error; }
function text(value, max = 2000) {
  if (typeof value !== 'string') fail('请填写有效文本。');
  if (value.length > max) fail(`文本不能超过${max}字。`);
  return value.trim();
}
function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail('请填写有效开始日期。');
  const d = new Date(value + 'T00:00:00Z');
  if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== value) fail('日期不存在。');
  return value;
}
function addDays(value, days) { const d = new Date(value + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }
function planFor(store) { return (store.lifeSystem?.learningPlans || []).find(p => p.program === PROGRAM) || null; }
function activePlan(store) { const p = planFor(store); if (!p || p.archived || p.paused || p.resumeRequired) fail('请先采纳有效的履职成长计划。', 409); return p; }
function revision(record, expected) { if (!Number.isInteger(expected) || expected !== record.revision) fail('记录已变化。请保留草稿并重新载入后核对。', 409); }
function snapshot(store) {
  return { version: '9.0.0-beta.1', preview: process.env.BENCH_GROWTH_PREVIEW === '1', weeks: WEEKS, blocks: BLOCKS, templates: TEMPLATES, sources: SOURCES, prompts: PROMPTS, levels: LEVELS,
    plan: planFor(store), cards: store.lifeSystem?.growthCards || [],
    tasks: (store.tasks || []).map(({ id, title, status, archived }) => ({ id, title, status, archived: !!archived })),
    agendas: (store.agendas || []).map(({ id, title, date, done, archived }) => ({ id, title, date, done, archived: !!archived })) };
}
function activate(store, input, now = new Date().toISOString()) {
  const startDate = date(input.startDate);
  const old = planFor(store);
  if (old) { if (old.archived || old.paused || old.resumeRequired) fail('已有计划已归档或暂停，请先通过管理与归档恢复。', 409); return old; }
  store.lifeSystem ||= {}; store.lifeSystem.learningPlans ||= [];
  const plan = { id: 'growth-' + randomUUID(), program: PROGRAM, revision: 1, title: '造价管理履职成长 · 八周', goal: '提升管理能力，系统补齐造价业务',
    profile: '有工程或建设管理经验，造价业务需系统补齐', weeklyMinutes: 300, startDate, deadline: addDays(startDate, 55), model: '人工采纳 · V9', status: 'active', createdAt: now, updatedAt: now,
    sessions: WEEKS.flatMap(w => BLOCKS.map((b, i) => ({ id: `growth-w${w.week}-b${i + 1}`, week: w.week, date: addDays(startDate, (w.week - 1) * 7 + b.offset), time: '', title: `第${w.week}周 · ${b.name}`, minutes: b.minutes, note: b.action, done: false }))) };
  store.lifeSystem.learningPlans.unshift(plan); return plan;
}
function setSession(store, sessionId, input, now = new Date().toISOString()) {
  const plan = activePlan(store); revision(plan, input.expectedRevision);
  if (typeof input.done !== 'boolean') fail('完成状态必须是布尔值。');
  const session = plan.sessions.find(s => s.id === sessionId); if (!session) fail('学习安排不存在。', 404);
  session.done = input.done; session.updatedAt = now; plan.revision++; plan.updatedAt = now;
  plan.status = plan.sessions.every(s => s.done) ? 'completed' : 'active';
  if (plan.status === 'completed') { plan.completedAt = now; plan.achievement = '八周学习安排已全部勾选；掌握程度请查看案例与复核证据。'; }
  else { delete plan.completedAt; delete plan.achievement; }
  return plan;
}
function saveCard(store, cardId, input, now = new Date().toISOString()) {
  const cards = store.lifeSystem?.growthCards || [];
  const old = cardId ? cards.find(c => c.id === cardId) : null;
  if (cardId && !old) fail('卡片不存在。', 404);
  if (!old && (!input.requestId || !/^[\w-]{8,100}$/.test(input.requestId))) fail('缺少有效保存请求标识。');
  const previousRequest = !old && cards.find(c => c.requestId === input.requestId); if (previousRequest) return previousRequest;
  if (old) revision(old, input.expectedRevision);
  if (!TEMPLATES.some(t => t.kind === input.kind)) fail('未知卡片类型。');
  const title = text(input.title, 160), body = text(input.body, 16000);
  if (!title || !body) fail('请填写标题和正文。');
  const week = Number(input.week); if (!Number.isInteger(week) || week < 1 || week > 8) fail('请选择第1至8周。');
  const sourceUrl = text(input.sourceUrl || '', 2000);
  if (sourceUrl) { try { const u = new URL(sourceUrl); if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password) fail('出处链接仅支持不含凭据的HTTP或HTTPS地址。'); } catch { fail('出处链接仅支持不含凭据的HTTP或HTTPS地址。'); } }
  const sourceStatus = input.sourceStatus || 'unverified'; if (!['unverified', 'entry', 'read'].includes(sourceStatus)) fail('请选择有效阅读状态。');
  const relatedTaskId = text(input.relatedTaskId || '', 200), relatedAgendaId = text(input.relatedAgendaId || '', 200);
  if (relatedTaskId && !(store.tasks || []).some(t => t.id === relatedTaskId)) fail('关联任务已不存在，请重新选择。', 409);
  if (relatedAgendaId && !(store.agendas || []).some(a => a.id === relatedAgendaId)) fail('关联行程已不存在，请重新选择。', 409);
  let mastery = Number(input.mastery ?? 0); if (!Number.isInteger(mastery) || mastery < 0 || mastery > 3) fail('请选择有效掌握程度。');
  if (!['concept', 'case'].includes(input.kind)) mastery = 0;
  const fields = { kind: input.kind, title, body, week, sourceTitle: text(input.sourceTitle || '', 300), sourceUrl, sourceVersion: text(input.sourceVersion || '', 300), locator: text(input.locator || '', 500), sourceStatus, relatedTaskId, relatedAgendaId };
  const evidence = text(input.evidence || '', 4000);
  if (mastery > 0 && (!evidence || !fields.sourceTitle || (!sourceUrl && !fields.locator))) fail('请填写理解证据、出处名称及链接或条款页码。');
  const changed = old && (Object.keys(fields).some(k => fields[k] !== old[k]) || evidence !== old.evidence);
  const reviewInvalidated = !!(old?.mastery === 3 && changed);
  let reviewer = text(input.reviewer || '', 100), reviewNote = text(input.reviewNote || '', 4000);
  if (reviewInvalidated) { mastery = Math.min(mastery, 2); reviewer = ''; reviewNote = ''; }
  const sameReview = old && !changed && old.mastery === 3 && evidence === old.evidence && reviewer === old.reviewer && reviewNote === old.reviewNote;
  if (mastery === 3 && (!reviewer || !reviewNote || (!sameReview && input.reviewConfirmed !== true))) fail('专业复核需填写核对人、意见并确认已核对本版内容。');
  if (mastery !== 3) { reviewer = ''; reviewNote = ''; }
  const card = { id: old?.id || 'gcard-' + randomUUID(), requestId: old?.requestId || input.requestId, ...fields, evidence, mastery, reviewer, reviewNote,
    reviewedAt: mastery === 3 ? (sameReview ? old.reviewedAt : now) : null, reviewInvalidated, archived: old?.archived || false,
    revision: (old?.revision || 0) + 1, createdAt: old?.createdAt || now, updatedAt: now, history: old ? [...old.history, { ...old, history: undefined }] : [] };
  store.lifeSystem ||= {}; store.lifeSystem.growthCards ||= [];
  if (old) store.lifeSystem.growthCards[store.lifeSystem.growthCards.indexOf(old)] = card; else store.lifeSystem.growthCards.unshift(card);
  return card;
}
function archiveCard(store, cardId, input, now = new Date().toISOString()) {
  const card = (store.lifeSystem?.growthCards || []).find(c => c.id === cardId); if (!card) fail('卡片不存在。', 404);
  revision(card, input.expectedRevision); if (typeof input.archived !== 'boolean') fail('归档状态必须是布尔值。');
  const previous = { ...card, history: undefined }; card.history.push(previous); card.archived = input.archived; card.revision++; card.updatedAt = now; return card;
}
function weeklyDraft(store, week) {
  if (!Number.isInteger(week) || week < 1 || week > 8) fail('请选择第1至8周。');
  const plan = activePlan(store), sessions = plan.sessions.filter(s => s.week === week), done = sessions.filter(s => s.done);
  const cards = (store.lifeSystem?.growthCards || []).filter(c => !c.archived && c.week === week);
  const refs = kind => cards.filter(c => c.kind === kind).map(c => `- ${c.title}（${c.id}，第${c.revision}版）`).join('\n') || '待补充记录。';
  return { title: `第${week}周一页纸 · ${WEEKS[week - 1].title}`, week, kind: 'weekly', body: `本周学习安排：已勾选${done.length}/${sessions.length}项，对应安排时长${done.reduce((n, s) => n + s.minutes, 0)}分钟（不是实际投入时长或掌握证明）。\n\n本周案例与概念记录：\n${refs('case')}\n${refs('concept')}\n\n重点事项（实际进展请核对关联原记录）：\n${refs('matter')}\n\n管理复盘：\n${refs('reflection')}\n\n需要协调或请示的问题、备选路径：\n待本人补充核实。\n\n未解决的疑问：\n待本人补充。\n\n下周重点和完成判据：\n待本人确定。` };
}
module.exports = { PROGRAM, WEEKS, BLOCKS, LEVELS, TEMPLATES, SOURCES, snapshot, activate, setSession, saveCard, archiveCard, weeklyDraft };
