// Optional features. Hiding one only removes its entry points from this browser's
// navigation and command palette; records, routes and background jobs are untouched.
export const FEATURES = [
  { id: 'briefs', label: '简报', hrefs: ['#briefs/'] },
  { id: 'life', label: '生活', hrefs: ['#life/'] },
  { id: 'learn', label: '学习', hrefs: ['#learn/'] },
  { id: 'papers', label: '论文', hrefs: ['#assets/papers'] },
  { id: 'feeds', label: '行业与科技报告', hrefs: ['#reports/pain', '#reports/frontier', '#reports/ai-new', '#reports/construction', '#reports/lab'] },
  { id: 'tools', label: '外部工具', hrefs: ['#tools/'] },
];

const KEY = 'bench-v8-features';
const known = new Set(FEATURES.map(f => f.id));

export function hiddenFeatures() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || '[]');
    return new Set(Array.isArray(list) ? list.filter(id => known.has(id)) : []);
  } catch { return new Set(); }
}

export function saveHiddenFeatures(ids) {
  try { localStorage.setItem(KEY, JSON.stringify([...ids].filter(id => known.has(id)))); return true; }
  catch { return false; }
}

export function linkVisible(href, hidden = hiddenFeatures()) {
  return !FEATURES.some(f => hidden.has(f.id) && f.hrefs.some(prefix => href === prefix || href.startsWith(prefix)));
}
