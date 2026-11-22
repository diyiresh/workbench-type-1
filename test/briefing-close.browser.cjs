'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { chromium } = require('playwright');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-briefing-close-'));
process.env.BENCH_PREVIEW_DATA_DIR = root;
const { createPreviewServer } = require('../scripts/v9-preview.cjs');
const server = createPreviewServer();
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    for (const choice of ['skip', 'last-next']) {
      const context = await browser.newContext(); const page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(base + '/#learn/growth'); await page.locator('#briefing').waitFor({ state: 'visible' });
      if (choice === 'last-next') {
        for (let count = 0; count < 10; count++) {
          const button = page.locator('#briefing [data-brief=next]');
          if ((await button.textContent()).includes('进入指挥台')) break;
          await button.click();
        }
      }
      const response = page.waitForResponse(r => r.url().endsWith('/api/briefings/dismiss'));
      await page.locator('#briefing [data-brief=' + (choice === 'skip' ? 'skip' : 'next') + ']').click();
      assert.equal((await response).status(), 403, '真实隔离写入边界保持拒绝');
      await page.locator('#briefing').waitFor({ state: 'hidden', timeout: 1500 });
      await page.locator('#briefing-dismiss-notice').waitFor();
      await page.locator('a[href="#learn/growth-plan"]').first().click();
      await page.locator('.growth-week-list').waitFor();
      await page.reload(); await page.locator('#growth-root .growth-tabs').waitFor();
      assert.equal(await page.locator('#briefing').isVisible(), false, '刷新后本浏览器今日不再弹出');
      assert.deepEqual(errors, []);
      assert(!JSON.parse(fs.readFileSync(path.join(root, 'store.json'))).meta.briefingDismissedOn, '演示不得改写服务器偏好');
      await context.close();
    }
    const context = await browser.newContext(), page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    let release, captured;
    const intercepted = new Promise(resolve => { captured = resolve; });
    await page.route('**/api/briefings/dismiss', async route => { const hold = new Promise(resolve => { release = resolve; }); captured(); await hold; await route.fulfill({ status: 503, json: { error: 'isolated-save-unavailable' } }); });
    await page.goto(base + '/#learn/growth'); await page.locator('#briefing').waitFor({ state: 'visible' });
    await page.locator('#briefing [data-brief=skip]').click();
    await page.locator('#briefing').waitFor({ state: 'hidden', timeout: 1500 });
    await page.waitForFunction(() => localStorage.getItem('bench-briefing-dismissed-on-v1'));
    await intercepted;
    release(); await page.locator('#briefing-dismiss-notice').waitFor();
    assert.deepEqual(errors, []); await context.close();
    const regular = require('../server').createServer();
    await new Promise(resolve => regular.listen(0, '127.0.0.1', resolve));
    try {
      const normal = await browser.newPage(); await normal.goto('http://127.0.0.1:' + regular.address().port + '/#learn/growth');
      await normal.locator('#briefing').waitFor({ state: 'visible' }); const saved = normal.waitForResponse(r => r.url().endsWith('/api/briefings/dismiss'));
      await normal.locator('#briefing [data-brief=skip]').click(); assert.equal((await saved).status(), 200);
      await normal.locator('#briefing').waitFor({ state: 'hidden' });
      assert(JSON.parse(fs.readFileSync(path.join(root, 'store.json'))).meta.briefingDismissedOn);
      await normal.close();
    } finally { await new Promise(resolve => regular.close(resolve)); }
    console.log('Briefing close: real preview 403, both exits, local daily preference/reload, usable page, slow response/503, no unhandled errors and successful server persistence passed with isolated data.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => server.close());
