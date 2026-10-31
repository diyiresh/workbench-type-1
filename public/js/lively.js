// Lively layer: Slack-style icons, avatars, badges and small illustrations.
// Pure DOM decoration over rendered views; idempotent, offline, theme-aware via CSS variables.
// Icons adapted from Lucide (ISC License, https://lucide.dev).
const P = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z"/>',
  star: '<path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01Z"/>',
  gem: '<path d="M6 3h12l4 6-10 13L2 9Z"/><path d="M11 3 8 9l4 13 4-13-3-6"/><path d="M2 9h20"/>',
  book: '<path d="M2 4h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2Z"/><path d="M22 4h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7Z"/>',
  leaf: '<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/>',
  hash: '<path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/>',
  zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9Z"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4M12 17h.01"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  rocket: '<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2Z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>',
  chart: '<path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  help: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  archive: '<rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8M10 12h4"/>',
  sparkle: '<path d="M12 3l1.9 5.8L20 10.7l-6.1 1.9L12 18.5l-1.9-5.9L4 10.7l6.1-1.9Z"/><path d="M19 3v4M17 5h4"/>',
  file: '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5Z"/><path d="M14 2v6h6M16 13H8M16 17H8"/>',
};
export const icon = (name, cls = '') => `<svg class="lv-ico ${cls}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${P[name] || P.hash}</svg>`;

const RAIL = { home:'home', projects:'folder', agents:'users', agenda:'calendar', briefs:'inbox', reports:'star', assets:'gem', learn:'book', life:'leaf', set:'gear' };
const SEC = [[/首页|总览/, 'home'], [/项目|业务/, 'folder'], [/成员/, 'users'], [/行程/, 'calendar'], [/简报|来源/, 'inbox'], [/关注/, 'star'], [/资产/, 'gem'], [/学习/, 'book'], [/生活/, 'leaf'], [/设置/, 'gear'], [/模块/, 'sparkle'], [/置顶/, 'star'], [/进行中/, 'rocket'], [/已完成|归档/, 'archive']];
const CH = [[/风险|需关注/, 'alert'], [/新建/, 'plus'], [/时间轴|今日|周计划/, 'calendar'], [/报告|简报|周报|日报/, 'file'], [/说明|帮助/, 'help'], [/技能|扩展/, 'zap'], [/知识|教训|提示词|原料/, 'book'], [/待整理/, 'archive'], [/繁星|银河/, 'sparkle'], [/成员|舰队/, 'users'], [/行程/, 'calendar'], [/经营|统筹|指挥/, 'chart'], [/学习/, 'book'], [/生活/, 'leaf']];
export const TYPES = { SCHEDULE:['calendar','#2bac76'], CREW:['users','#1d9bd1'], PROJECT:['rocket','#e01e5a'], LEARN:['book','#8e5cf7'], LIFE:['leaf','#36c5a0'], OPS:['chart','#ecb22e'], HANDOFF:['archive','#e8912d'] };
const STAT = { doing:['rocket','#e01e5a'], today:['calendar','#2bac76'], risks:['alert','#e8912d'], members:['users','#1d9bd1'] };
const AV = ['#e01e5a','#2bac76','#1d9bd1','#ecb22e','#8e5cf7','#e8912d','#36c5a0','#d6457e'];
const pick = (rules, text) => (rules.find(([re]) => re.test(text)) || [])[1];
const hue = (s) => AV[[...String(s)].reduce((a, c) => a + c.charCodeAt(0), 0) % AV.length];
const initial = (s) => { const t = String(s).trim(); return (/^[A-Za-z]/.test(t) ? t[0].toUpperCase() : t[0]) || '?'; };
const mark = (el, k) => { if (el.dataset.lv === k) return false; el.dataset.lv = k; return true; };
const HERO_ART = `<svg class="lv-hero-art" viewBox="0 0 160 110" aria-hidden="true"><circle cx="118" cy="40" r="30" fill="rgba(255,255,255,.12)"/><circle cx="42" cy="78" r="18" fill="rgba(255,255,255,.1)"/><rect x="58" y="24" width="70" height="52" rx="10" fill="rgba(255,255,255,.92)"/><rect x="66" y="34" width="34" height="5" rx="2.5" fill="#e01e5a"/><rect x="66" y="45" width="52" height="4" rx="2" fill="#c9c2d4"/><rect x="66" y="54" width="44" height="4" rx="2" fill="#c9c2d4"/><circle cx="114" cy="36" r="6" fill="#2bac76"/><path d="m111.5 36 2 2 3.5-4" stroke="#fff" stroke-width="1.8" fill="none" stroke-linecap="round"/><rect x="30" y="44" width="34" height="26" rx="8" fill="#ecb22e"/><circle cx="41" cy="57" r="3" fill="#fff"/><circle cx="53" cy="57" r="3" fill="#fff"/><path d="M140 82l4 10 4-10-4-10Z" fill="#36c5a0"/><path d="M20 22l2.5 6 2.5-6-2.5-6Z" fill="#fff" opacity=".8"/><path d="M98 92l2 5 2-5-2-5Z" fill="#1d9bd1"/></svg>`;

function decorate(root = document) {
  for (const b of root.querySelectorAll('#rail .rail-btn')) {
    if (!mark(b, 'r')) continue;
    b.insertAdjacentHTML('afterbegin', `<span class="lv-rail-tile">${icon(RAIL[b.dataset.primary] || 'hash')}</span>`);
  }
  for (const s of root.querySelectorAll('#channels .sec')) {
    if (mark(s, 's')) s.insertAdjacentHTML('afterbegin', icon(pick(SEC, s.textContent) || 'hash', 'lv-sec-ico'));
  }
  const crew = /crew|agents/.test(location.hash) || /成员中心/.test((root.querySelector('#channels .sec') || {}).textContent || '');
  for (const c of root.querySelectorAll('#channels .ch')) {
    if (!mark(c, 'c')) continue;
    const label = (c.firstChild && c.firstChild.textContent || c.textContent).trim();
    if (crew && c.dataset.sec && c.dataset.sec !== 'all') {
      c.insertAdjacentHTML('afterbegin', `<span class="lv-av" style="--av:${hue(label)}">${initial(label)}<i class="lv-dot"></i></span>`);
    } else {
      c.insertAdjacentHTML('afterbegin', icon(pick(CH, label) || 'hash', 'lv-ch-ico'));
    }
  }
  for (const st of root.querySelectorAll('.overview-stat')) {
    const [ic, col] = STAT[st.dataset.overviewFilter] || ['sparkle', '#8e5cf7'];
    if (mark(st, 'st')) { st.style.setProperty('--lv-c', col); st.insertAdjacentHTML('afterbegin', `<span class="lv-chip">${icon(ic)}</span>`); }
  }
  for (const k of root.querySelectorAll('.card > .k:first-child, .card > .eyebrow:first-child')) {
    const type = (k.textContent.trim().toUpperCase().match(/^[A-Z]+/) || [])[0];
    const t = TYPES[type];
    if (!t || !mark(k, 'k')) continue;
    k.closest('.card').style.setProperty('--lv-c', t[1]);
    k.closest('.card').classList.add('lv-typed');
    k.insertAdjacentHTML('afterbegin', `<span class="lv-chip lv-chip-sm">${icon(t[0])}</span>`);
  }
  for (const h of root.querySelectorAll('.command-hero, .brief-hero, .front-hero, .focus-hero, .agenda-hero')) {
    if (mark(h, 'h')) h.insertAdjacentHTML('beforeend', HERO_ART);
  }
  for (const e of root.querySelectorAll('.agenda-empty, .empty, .k')) {
    if (!/^(暂无|没有|还没有)/.test(e.textContent.trim()) || !mark(e, 'e')) continue;
    e.classList.add('lv-empty');
    e.insertAdjacentHTML('afterbegin', '<span class="lv-empty-art" aria-hidden="true">🌱</span>');
  }
  for (const a of root.querySelectorAll('.avatar, .chat-avatar')) {
    if (mark(a, 'a')) a.style.setProperty('--av', hue(a.textContent));
  }
  const head = root.querySelector('#ws-head');
  if (head && !head.querySelector('.lv-head-tools') && head.children.length) {
    head.insertAdjacentHTML('beforeend', `<div class="lv-head-tools"><button type="button" class="lv-ib" data-lv-tool="search" title="搜索" aria-label="搜索">${icon('search')}</button><button type="button" class="lv-ib" data-primary="briefs" title="简报中心" aria-label="简报中心">${icon('bell')}${document.querySelector('#rail [data-primary="briefs"] .badge') ? '<i class="lv-ib-dot"></i>' : ''}</button><a class="lv-ib" href="#set/help" title="使用说明" aria-label="使用说明">${icon('help')}</a></div>`);
  }
}

let queued = false;
export function mountLively() {
  document.documentElement.classList.add('lively');
  const run = () => { queued = false; try { decorate(); } catch (e) { console.warn('lively', e); } };
  new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(run); } })
    .observe(document.getElementById('shell') || document.body, { childList: true, subtree: true });
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-lv-tool="search"]')) { const s = document.getElementById('search'); if (s) s.focus(); }
  });
  run();
}
