const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { chromium } = require('playwright');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-brief-filters-'));
process.env.BENCH_DATA_DIR = root;
const state = require('../lib/default-store').buildDefaultStore();
require('../lib/brief-hub').ensureBriefHub(state);
state.meta.language = 'zh-CN';
const [sourceA, sourceB, sourceC, sourceD] = state.briefSources.map(source => source.id);
state.briefSources[2].maxAgeHours = 1;
state.briefRuns = [
  { id: 'today-unread', sourceId: sourceA, title: '今日未读原文', body: '完整正文\n<script>危险字符只显示文本</script>', completedAt: '2026-10-14T00:30:00+08:00', unread: true },
  { id: 'old-saved', sourceId: sourceA, title: '昨日收藏原文', body: '旧简报', completedAt: '2026-10-13T09:00:00+08:00', unread: false, favorite: true },
  { id: 'today-saved', sourceId: sourceB, title: '今日已读收藏原文', body: '已读也可收藏', completedAt: '2026-10-14T01:00:00+08:00', unread: false, favorite: true },
  { id: 'old-unread', sourceId: sourceB, title: '旧未读原文', body: '原文保留', completedAt: '2026-10-12T09:00:00+08:00', unread: true },
  { id: 'legacy', sourceId: sourceC, title: '缺省状态原文', body: '缺省未收藏', receivedAt: '2026-10-14T02:00:00+08:00' },
  { id: 'archived', sourceId: sourceA, title: '归档简报不可见', body: '归档正文', completedAt: '2026-10-14T04:00:00+08:00', unread: true, favorite: true, archived: true },
];
fs.writeFileSync(path.join(root, 'store.json'), JSON.stringify(state));
const { createServer, readStore } = require('../server');
const server = createServer();
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, timezoneId: 'Asia/Shanghai' });
    page.setDefaultTimeout(10000);
    await page.clock.setFixedTime(new Date('2026-10-14T12:00:00+08:00'));
    await page.route('**/api/briefings', route => route.fulfill({ json: { items: [] } }));
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const card = key => page.locator(`[data-brief-filter="${key}"]`);
    const source = id => page.locator(`.brief-source-card[data-source-id="${id}"]`);
    const ids = () => page.locator('.brief-run').evaluateAll(items => items.map(item => item.dataset.briefId));
    const counts = () => page.locator('.brief-stats b').allTextContents();
    const select = async key => {
      await card(key).click();
      assert.equal(await card(key).getAttribute('aria-pressed'), 'true');
      assert.equal(await page.locator('.brief-stat[aria-pressed="true"]').count(), 1);
      assert.equal(await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => resolve(document.activeElement.dataset.briefFilter)))), key);
    };
    const toggleSaved = async id => {
      const entry = page.locator(`[data-brief-id="${id}"]`);
      if (!(await entry.evaluate(item => item.open))) await entry.locator('summary').click();
      await entry.locator('[data-act="brief-favorite"]').click();
      await page.waitForFunction(() => !document.querySelector('.brief-run[aria-busy="true"]'));
    };
    await page.goto(base + '/#briefs/' + sourceB);
    await card('all').waitFor();
    assert.equal(await card('all').getAttribute('aria-pressed'), 'true');
    assert.deepEqual(await counts(), ['4', '3', '3', '2']);
    const all = ['legacy', 'today-saved', 'today-unread', 'old-saved', 'old-unread'];
    assert.deepEqual(await ids(), all);
    assert.equal(await page.locator('[data-act="brief-favorite"]').count(), 5);
    assert.equal(await page.locator('.brief-source-card.stale').count(), 1);
    assert(!await page.locator('#ws-body').textContent().then(text => text.includes('需要关注')));

    await card('today').focus(); await page.keyboard.press('Enter');
    assert.deepEqual(await ids(), ['legacy', 'today-saved', 'today-unread']);
    await card('unread').focus(); await page.keyboard.press('Space');
    assert.deepEqual(await ids(), ['legacy', 'today-unread', 'old-unread']);
    await select('favorite');
    assert.deepEqual(await ids(), ['today-saved', 'old-saved']);
    assert.deepEqual(await counts(), ['4', '3', '3', '2']);
    await source(sourceA).click();
    assert.equal(await source(sourceA).getAttribute('aria-pressed'), 'true');
    assert.deepEqual(await ids(), ['today-unread', 'old-saved']);
    assert.equal(await page.locator('.brief-stat[aria-pressed="true"]').count(), 0);
    await select('unread');
    await page.locator(`#channels [data-sec="${sourceB}"]`).click();
    assert.deepEqual(await ids(), ['today-saved', 'old-unread']);
    assert.equal(await source(sourceB).getAttribute('aria-pressed'), 'true');
    await source(sourceD).focus(); await page.keyboard.press('Enter');
    assert.equal(await page.locator('.brief-run').count(), 0);
    await page.locator('#channels [data-sec="all"]').click();
    assert.deepEqual(await ids(), all);
    await source(sourceA).click();
    await page.reload(); await card('all').waitFor();
    assert.equal(await card('all').getAttribute('aria-pressed'), 'true');
    assert.deepEqual(await ids(), all);

    await select('unread');
    await toggleSaved('today-unread');
    assert.equal(readStore().briefRuns.find(item => item.id === 'today-unread').favorite, true);
    assert.equal(readStore().briefRuns.find(item => item.id === 'today-unread').unread, true);
    assert.equal(await card('unread').getAttribute('aria-pressed'), 'true');
    assert.deepEqual(await counts(), ['4', '3', '3', '3']);
    await page.locator('[data-act="brief-read"][data-id="today-unread"]').click();
    await page.waitForFunction(() => !document.querySelector('[data-brief-id="today-unread"]'));
    assert.deepEqual(await ids(), ['legacy', 'old-unread']);
    assert.deepEqual(await counts(), ['4', '3', '2', '3']);
    assert.equal(readStore().briefRuns.find(item => item.id === 'today-unread').favorite, true);
    await select('favorite'); await toggleSaved('today-saved');
    assert.deepEqual(await ids(), ['today-unread', 'old-saved']);
    assert.equal(readStore().briefRuns.find(item => item.id === 'today-saved').unread, false);
    await page.reload(); await card('all').waitFor();
    assert.deepEqual(await counts(), ['4', '3', '2', '2']);
    await select('favorite');
    await page.locator('#rail [data-primary="home"]').click();
    await page.locator('#rail [data-primary="briefs"]').click();
    assert.equal(await card('all').getAttribute('aria-pressed'), 'true');
    assert.deepEqual(await ids(), all);

    // A failed save leaves persisted preferences unchanged and explains the failure.
    let failure;
    page.once('dialog', dialog => { failure = dialog.message(); void dialog.accept(); });
    await page.route('**/api/brief-runs/old-unread', route => route.fulfill({ status: 500, json: { error: 'simulated_write_failure' } }));
    await toggleSaved('old-unread');
    assert.match(failure, /简报状态保存失败/);
    assert.notEqual(readStore().briefRuns.find(item => item.id === 'old-unread').favorite, true);
    await page.unroute('**/api/brief-runs/old-unread');

    let release, attempts = 0;
    const gate = new Promise(resolve => { release = resolve; });
    await page.route('**/api/brief-runs/old-unread', async route => { attempts++; await gate; await route.continue(); });
    await toggleSavedStart();
    async function toggleSavedStart() {
      const button = page.locator('[data-act="brief-favorite"][data-id="old-unread"]');
      await button.click();
      assert(await button.isDisabled());
      await button.evaluate(item => item.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    }
    assert.equal(attempts, 1);
    release();
    await page.waitForFunction(() => !document.querySelector('.brief-run[aria-busy="true"]'));
    await page.unroute('**/api/brief-runs/old-unread');
    assert.equal(readStore().briefRuns.find(item => item.id === 'old-unread').favorite, true);
    await toggleSaved('old-unread');

    assert((await page.request.patch(base + '/api/meta', { data: { language: 'en' } })).ok());
    await page.reload(); await card('all').waitFor(); await select('favorite');
    assert.match(await card('favorite').textContent(), /Saved briefings/);
    assert.deepEqual(await ids(), ['today-unread', 'old-saved']);
    assert.match(await page.locator('[data-brief-id="today-unread"]').textContent(), /今日未读原文/);
    await toggleSaved('today-unread'); await toggleSaved('old-saved');
    assert.equal(await page.locator('.agenda-empty').textContent(), 'No briefings match the current filter.');
    assert.deepEqual(await counts(), ['4', '3', '2', '0']);
    for (const theme of ['violet', 'warm', 'dark']) {
      assert((await page.request.patch(base + '/api/meta', { data: { theme } })).ok());
      await page.reload(); await card('all').waitFor(); await select('unread');
      const colors = await page.evaluate(() => [getComputedStyle(document.querySelector('.brief-stat.active')).backgroundColor, getComputedStyle(document.querySelector('[data-brief-filter="favorite"]')).backgroundColor]);
      assert.notEqual(colors[0], colors[1]);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(errors, []);
    console.log('Briefing filters UI: summary/source buttons, date boundaries, favorites/read updates, defaults, refresh/reentry, failure recovery, bilingual text, themes and narrow layout passed with an isolated ledger.');
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
