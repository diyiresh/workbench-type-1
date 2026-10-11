const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const state = await (await fetch('http://127.0.0.1:3780/api/state')).json();
  const entry = { id: 'edit-test', date: '2026-10-12', time: '09:30', title: '测试行程', category: '会议', tags: ['测试'], note: '备注', important: true, done: true, review: '已有复盘', materials: [{ path: 'D:\\测试.docx', label: '已有材料' }] };
  state.agendas = [entry];
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    let saved;
    await page.route('**/api/state', route => route.fulfill({ json: state }));
    await page.route('**/api/agendas**', async route => {
      assert.equal(route.request().method(), 'PATCH');
      assert(route.request().url().endsWith('/edit-test'));
      saved = route.request().postDataJSON();
      Object.assign(entry, saved);
      await route.fulfill({ json: entry });
    });
    await page.goto('http://127.0.0.1:3780/#agenda');
    await page.locator('#agenda-date').fill('2026-10-12');
    await page.locator('#agenda-date').dispatchEvent('change');
    await page.evaluate(() => { document.querySelector('#briefing').hidden = true; });
    await page.locator('[data-act="agenda-edit"]').click();
    assert.equal(await page.locator('#agenda-form [name="title"]').inputValue(), '测试行程');
    assert.equal(await page.locator('#agenda-form [name="category"]').inputValue(), '会议');
    await page.locator('#agenda-form [name="title"]').fill('修改后的行程');
    await page.evaluate(() => window.dispatchEvent(new HashChangeEvent('hashchange')));
    assert.equal(await page.locator('#agenda-form [name="title"]').inputValue(), '修改后的行程');
    await page.getByRole('button', { name: '保存修改', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#agenda-form h2')?.textContent === '添加行程');
    assert.equal(saved.title, '修改后的行程');
    assert.equal(saved.done, undefined);
    assert.equal(saved.review, undefined);
    assert.deepEqual(saved.materials, entry.materials);
    assert.equal(entry.done, true);
    assert.equal(entry.review, '已有复盘');
    assert.equal(state.agendas.length, 1);
    await page.locator('[data-act="agenda-edit"]').click();
    await page.getByRole('button', { name: '取消修改', exact: true }).click();
    assert.equal(await page.locator('#agenda-form [name="title"]').inputValue(), '');
    console.log('Agenda edit, draft preservation, PATCH, metadata and cancel checks passed. No real agenda data changed.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
