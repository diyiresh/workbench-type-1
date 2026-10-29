const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-reschedule-'));
process.env.BENCH_DATA_DIR = root;
const state = require('../lib/default-store').buildDefaultStore();
const entry = {
  id: 'reschedule', date: '2026-10-21', time: '15:00', title: 'Wednesday appointment',
  category: '会议', tags: ['topic'], note: 'Original notes\n第二行备注', done: true,
  review: 'Existing review\n复盘原文', important: true, reminderSentAt: '2026-10-20T19:00:00Z',
  materials: [{ path: 'D:\\fixture.docx', label: 'Original material', kind: 'document' }],
};
state.agendas = [entry];
fs.writeFileSync(path.join(root, 'store.json'), JSON.stringify(state));
const { createServer } = require('../server');
const server = createServer();

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1450, height: 1000 }, timezoneId: 'Asia/Shanghai' });
    page.setDefaultTimeout(10000);
    const errors = [], writes = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      if (new URL(request.url()).pathname.startsWith('/api/agendas') && request.method() !== 'GET') {
        writes.push({ url: new URL(request.url()).pathname, method: request.method(), body: request.postDataJSON() });
      }
    });
    await page.clock.setFixedTime(new Date('2026-10-21T12:00:00+08:00'));
    await page.route('**/api/briefings', route => route.fulfill({ json: { items: [] } }));
    const readEntry = () => JSON.parse(fs.readFileSync(path.join(root, 'store.json'), 'utf8')).agendas[0];
    const edit = () => page.locator('[data-act="agenda-edit"]').click();
    const date = page.locator('#agenda-form [name="date"]');
    const save = () => page.locator('#agenda-form button[type="submit"]').click();
    await page.goto(base + '/#agenda'); await edit();
    assert.equal(await date.count(), 1, 'Editing an appointment must offer its own date field.');
    assert.equal(await date.inputValue(), '2026-10-21');
    await date.fill('2026-10-23');
    await page.evaluate(() => window.dispatchEvent(new HashChangeEvent('hashchange')));
    assert.equal(await date.inputValue(), '2026-10-23', 'Rerender must preserve the proposed date.');
    assert.equal(await page.locator('#agenda-date').inputValue(), '2026-10-21', 'Changing the edit date must not navigate away.');
    let suggestionDate;
    await page.route('**/api/agenda-notes/suggest', route => {
      suggestionDate = route.request().postDataJSON().date;
      return route.fulfill({ json: { items: [], sources: [], conflicts: [], unknowns: [] } });
    });
    await page.locator('[data-note-suggest]').click();
    await page.getByText('没有找到可用于这项行程的复盘建议。', { exact: true }).waitFor();
    assert.equal(suggestionDate, '2026-10-23', 'Suggestions must use the edited date without calling a real model.');
    await page.getByRole('button', { name: '取消修改', exact: true }).click();
    assert.equal(readEntry().date, '2026-10-21'); assert.equal(writes.length, 0);

    await edit(); await date.fill(''); await save();
    assert.equal(writes.length, 0, 'An empty date must not be saved.');
    assert.equal(await date.evaluate(field => field.validity.valueMissing), true);
    await date.fill('2026-10-23'); await save();
    await page.waitForFunction(() => document.querySelector('#agenda-form h2')?.textContent === '添加行程');
    assert.equal(await page.locator('#agenda-date').inputValue(), '2026-10-23');
    assert.equal(await page.locator('[data-act="agenda-edit"]').count(), 1, 'Saved appointment must be visible on Friday.');
    assert.equal(writes.length, 1); assert.equal(writes[0].method, 'PATCH');
    assert.equal(writes[0].url, '/api/agendas/reschedule'); assert.equal(writes[0].body.date, '2026-10-23');
    const saved = readEntry();
    for (const [key, value] of Object.entries(entry)) assert.deepEqual(saved[key], key === 'date' ? '2026-10-23' : value, key + ' must be preserved.');
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'store.json'), 'utf8')).agendas.length, 1);

    await page.reload();
    await page.locator('#agenda-date').fill('2026-10-21'); await page.locator('#agenda-date').dispatchEvent('change');
    assert.equal(await page.locator('[data-act="agenda-edit"]').count(), 0, 'Wednesday must no longer show the moved item.');
    await page.locator('#agenda-date').fill('2026-10-23'); await page.locator('#agenda-date').dispatchEvent('change');
    await edit(); assert.equal(await date.inputValue(), '2026-10-23');
    await page.getByRole('button', { name: '取消修改', exact: true }).click();
    assert.equal(await date.count(), 0, 'New-item form keeps using the browsing date.');

    await page.request.patch(base + '/api/meta', { data: { language: 'en' } });
    await page.reload();
    await page.locator('#agenda-date').fill('2026-10-23'); await page.locator('#agenda-date').dispatchEvent('change');
    await edit(); await page.setViewportSize({ width: 390, height: 844 });
    assert(await page.getByLabel('Appointment date', { exact: true }).isVisible());
    await date.fill('2026-11-02'); await save();
    await page.waitForFunction(() => document.querySelector('#agenda-date')?.value === '2026-11-02' && !document.querySelector('#agenda-form [name="date"]'));
    assert.equal(readEntry().date, '2026-11-02', 'Moving to another month must persist.');
    assert.equal(await page.locator('[data-act="agenda-edit"]').count(), 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    console.log('Agenda rescheduling passed: Wednesday to Friday, draft retention/cancel, required date, same record and metadata, old/new day, reload, another month, English and mobile; isolated ledger only.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => server.close());
