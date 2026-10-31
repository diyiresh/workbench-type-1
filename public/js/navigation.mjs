// Canonical public routes; legacy view IDs stay internal to preserve existing workflows.
export const NAVIGATION = [
  ['home', '工作首页'], ['projects', '项目中心'], ['agents', '成员中心'],
  ['agenda', '每日行程'], ['briefs', '简报中心'], ['reports', '我的关注'],
  ['assets', '资产中心'], ['learn', '学习成长'], ['life', '生活管理'], ['set', '系统设置'],
].map(([id, name]) => ({ id, name }));

export const FOCUS_CATEGORIES = [
  ['pain', '行业痛点'], ['frontier', '科技前沿'], ['ai-new', 'AI 上新'],
  ['construction', '建筑报告'], ['lab', '本地实验'], ['business', '经营报告'],
].map(([id, name]) => ({ id, name }));

export const REPORT_KINDS = ['daily', 'retro', 'guidance', 'weekly', 'assessment', 'monthly', 'quarterly'];

export function focusCategoryFor(secondary) {
  if (REPORT_KINDS.includes(secondary) || secondary === 'business') return 'business';
  if (FOCUS_CATEGORIES.some((item) => item.id === secondary)) return secondary;
  return null;
}

export function sectionFor(primary) {
  return ({ deck:'home', work:'projects', department:'projects', crew:'agents', ops:'reports', memory:'assets' })[primary] || primary;
}

export function moduleTarget(module) {
  if (module.type === 'project') return { primary:'work', secondary:module.id };
  return { primary:({schedule:'agenda',crew:'crew',ops:'ops',learn:'learn',life:'life'})[module.type] || 'home', secondary:'all' };
}

export function resolveRoute(value, modules = []) {
  const [requested = 'home', raw = 'all'] = String(value).replace(/^#/, '').split('/');
  let p = requested || 'home', s;
  try { s = decodeURIComponent(raw) || 'all'; } catch { s = 'all'; }
  if (p === 'projects') {
    if (s.startsWith('mod:')) { p = 'work'; s = s.slice(4); }
    else if (s.startsWith('run:')) { p = 'department'; s = s.slice(4); }
    else { p = s === 'business' ? 'work' : 'department'; s = s === 'new' ? 'new' : 'all'; }
  } else p = ({ agents:'crew', reports:'ops', assets:'memory' })[p] || p;
  if (p === 'home' && s === 'decisions') { p = 'deck'; s = 'all'; }
  else if (p === 'home' && s !== 'all') {
    const module = modules.find(m => m.id === s);
    if (module) { const target = moduleTarget(module); p = target.primary; s = target.secondary; }
  }
  if (p === 'ops' && s === 'today') { p = 'agenda'; s = 'all'; }
  if (p === 'ops' && s === 'all') s = 'pain';
  if (!['home','deck','work','department','crew','ops','memory','agenda','briefs','learn','life','set'].includes(p)) { p='home'; s='all'; }
  const section = sectionFor(p);
  const token = p === 'deck' ? 'decisions' : p === 'work' ? (s === 'all' ? 'business' : 'mod:' + s)
    : p === 'department' ? (['all','new'].includes(s) ? s : 'run:' + s) : s;
  return { primary:p, secondary:s, section, hash:'#' + section + '/' + encodeURIComponent(token).replace(/%3A/gi, ':') };
}
