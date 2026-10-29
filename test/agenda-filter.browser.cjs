const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { chromium } = require('playwright');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-agenda-filter-'));
process.env.BENCH_DATA_DIR = root;
const state = require('../lib/default-store').buildDefaultStore();
state.meta.language = 'zh-CN';
state.meta.briefingDismissedOn = require('../lib/migrate').ymd();
state.agendas = [
  { id: 'done-important', date: '2026-10-14', time: '09:00', title: '已完成重点原文', done: true, important: true },
  { id: 'pending-important', date: '2026-10-14', time: '10:00', title: '待处理重点原文', important: true },
  { id: 'done-normal', date: '2026-10-14', time: '11:00', title: '已完成普通原文', done: true },
  { id: 'pending-normal', date: '2026-10-14', time: '12:00', title: '待处理普通原文', done: false },
  { id: 'unscheduled', date: '2026-10-14', title: '未定时间原文' },
  { id: 'week-extra', date: '2026-10-15', time: '09:00', title: '本周其他日原文', done: true, important: true },
  { id: 'month-extra', date: '2026-10-25', time: '09:00', title: '本月其他周原文', important: true },
  { id: 'next-month', date: '2026-11-01', time: '09:00', title: '下月原文' },
  { id: 'archived', date: '2026-10-14', time: '08:00', title: '归档不可见原文', archived: true, important: true },
];
fs.writeFileSync(path.join(root, 'store.json'), JSON.stringify(state));
const { createServer, readStore } = require('../server');
const server = createServer();

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(10000);
    await page.clock.setFixedTime(new Date(2026, 9, 14, 12));
    await page.route('**/api/briefings', route => route.fulfill({ json: { items: [] } }));
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const card = key => page.locator(`[data-agenda-filter="${key}"]`);
    const select = async key => {
      await card(key).click();
      assert.equal(await card(key).getAttribute('aria-pressed'), 'true');
      assert.equal(await page.locator('.agenda-stat[aria-pressed="true"]').count(), 1);
      assert.equal(await page.evaluate(() => document.activeElement.dataset.agendaFilter), key);
    };
    const titles = () => page.locator('#agenda-results .agenda-body .row > b').allTextContents();
    const counts = () => page.locator('.agenda-stats b').allTextContents();
    const allDay = ['已完成重点原文', '待处理重点原文', '已完成普通原文', '待处理普通原文', '未定时间原文'];
    const initial = JSON.stringify(readStore().agendas);
    await page.goto(base + '/#agenda');
    await card('all').waitFor();
    assert.equal(await card('all').getAttribute('aria-pressed'), 'true');
    assert.deepEqual(await titles(), allDay);
    assert.deepEqual(await counts(), ['5', '2', '3', '2']);

    // The entire card is a keyboard-accessible button; counts keep their period scope.
    await card('pending').focus();
    await page.keyboard.press('Enter');
    assert.deepEqual(await titles(), [allDay[1], allDay[3], allDay[4]]);
    await card('done').focus();
    await page.keyboard.press('Space');
    assert.deepEqual(await titles(), [allDay[0], allDay[2]]);
    await select('important');
    assert.deepEqual(await titles(), [allDay[0], allDay[1]]);
    assert.deepEqual(await counts(), ['5', '2', '3', '2']);
    assert.equal(JSON.stringify(readStore().agendas), initial);

    // Filtering cannot erase an unsaved appointment or edit, including multiline input.
    await page.locator('#agenda-form [name="title"]').fill('尚未提交的行程');
    await page.locator('#agenda-form [name="note"]').fill('第一行\n第二行');
    await page.locator('#agenda-form [name="important"]').check();
    await select('done');
    assert.equal(await page.locator('#agenda-form [name="title"]').inputValue(), '尚未提交的行程');
    assert.equal(await page.locator('#agenda-form [name="note"]').inputValue(), '第一行\n第二行');
    assert(await page.locator('#agenda-form [name="important"]').isChecked());
    await page.locator('[data-act="agenda-edit"][data-id="done-important"]').click();
    await page.locator('#agenda-form [name="title"]').fill('尚未提交的修改');
    await select('pending');
    assert.equal(await page.locator('#agenda-form [name="title"]').inputValue(), '尚未提交的修改');
    await page.getByRole('button', { name: '取消修改', exact: true }).click();
    assert.equal(await card('pending').getAttribute('aria-pressed'), 'true');

    // Natural-week and month grouping, range switches and navigation reset the filter.
    await page.locator('[data-act="agenda-view"][data-view="week"]').click();
    assert.equal(await card('all').getAttribute('aria-pressed'), 'true');
    assert.deepEqual(await counts(), ['6', '3', '3', '3']);
    await select('important');
    assert.deepEqual(await titles(), [allDay[0], allDay[1], '本周其他日原文']);
    assert.equal(await page.locator('.agenda-day-group').count(), 2);
    await page.locator('[data-act="agenda-view"][data-view="month"]').click();
    assert.equal(await card('all').getAttribute('aria-pressed'), 'true');
    assert.deepEqual(await counts(), ['7', '3', '4', '4']);
    await select('important');
    assert.equal(await page.locator('.agenda-day-group').count(), 3);
    assert.deepEqual(await counts(), ['7', '3', '4', '4']);
    await page.locator('#agenda-date').fill('2026-10-21');
    await page.locator('#agenda-date').dispatchEvent('change');
    assert.equal(await card('all').getAttribute('aria-pressed'), 'true');
    await select('pending');
    await page.locator('[data-act="agenda-nav"][data-shift="1"]').click();
    assert.equal(await card('all').getAttribute('aria-pressed'), 'true');
    assert.deepEqual(await titles(), ['下月原文']);
    await select('done');
    assert.equal(await page.locator('.agenda-empty').textContent(), '当前范围没有符合筛选条件的日程。');
    await page.locator('[data-act="agenda-nav"][data-shift="-1"]').click();
    assert.equal(await card('all').getAttribute('aria-pressed'), 'true');
    await select('important');
    await page.locator('[data-act="agenda-open-day"]').first().click();
    assert.equal(await card('all').getAttribute('aria-pressed'), 'true');
    assert.deepEqual(await titles(), allDay);

    await select('pending');
    await page.reload();
    await card('all').waitFor();
    assert.equal(await card('all').getAttribute('aria-pressed'), 'true');
    assert.deepEqual(await titles(), allDay);
    await select('done');
    await page.locator('#rail [data-primary="home"]').click();
    await page.locator('#rail [data-primary="agenda"]').click();
    assert.equal(await card('all').getAttribute('aria-pressed'), 'true');
    assert.deepEqual(await titles(), allDay);
    await select('important');
    await page.evaluate(() => { location.hash = 'home/all'; });
    await page.waitForURL('**/#home/all');
    await page.evaluate(() => { location.hash = 'agenda/all'; });
    await card('all').waitFor();
    assert.equal(await card('all').getAttribute('aria-pressed'), 'true');

    // Normal rerender and a real PATCH/readback retain filtering and update the list.
    await select('pending');
    await page.evaluate(() => window.dispatchEvent(new HashChangeEvent('hashchange')));
    assert.equal(await card('pending').getAttribute('aria-pressed'), 'true');
    await page.locator('[data-act="agenda-toggle"][data-id="pending-important"]').click();
    await page.waitForFunction(() => !document.querySelector('[data-act="agenda-toggle"][data-id="pending-important"]'));
    assert.equal(await card('pending').getAttribute('aria-pressed'), 'true');
    assert.deepEqual(await titles(), [allDay[3], allDay[4]]);
    assert.deepEqual(await counts(), ['5', '3', '2', '2']);
    assert.equal(readStore().agendas.find(item => item.id === 'pending-important').done, true);

    // Filter is never sent as a report scope, and UI language never translates business text.
    let reportRequest;
    const reportJob={id:'filter-report-fixture',agentId:'codex',attemptId:'fixture-attempt',status:'done',view:'day',anchorDate:'2026-10-14',draft:{title:'模拟报告草稿',body:'模拟底稿',notice:'请核对事实后再保存。'}};
    await page.route('**/api/agenda/reports/jobs/filter-report-fixture',route=>route.fulfill({json:{job:reportJob}}));
    await page.route('**/api/agenda/reports/draft', async route => {
      reportRequest = route.request().postDataJSON();
      await route.fulfill({json:{job:reportJob}});
    });
    await page.locator('[data-act="agenda-report-draft"]').click();
    await page.locator('#agenda-report-body').waitFor();
    assert.deepEqual(Object.keys(reportRequest).sort(),['agentId','anchorDate','idempotencyKey','view']);
    assert.equal(reportRequest.view,'day');assert.equal(reportRequest.anchorDate,'2026-10-14');assert.equal(reportRequest.agentId,'codex');assert.equal(typeof reportRequest.idempotencyKey,'string');
    assert.equal(await card('pending').getAttribute('aria-pressed'), 'true');
    await page.locator('#agenda-report-body').fill('报告草稿尚未提交的修改');
    await select('done');
    assert.equal(await page.locator('#agenda-report-body').inputValue(), '报告草稿尚未提交的修改');
    assert((await page.request.patch(base + '/api/meta', { data: { language: 'en', theme: 'warm' } })).ok());
    await page.reload();
    await card('all').waitFor();
    await select('pending');
    assert.match(await page.locator('.agenda-filter-summary').textContent(), /Current filter:.*Pending.*2 appointments/);
    assert.deepEqual(await titles(), [allDay[3], allDay[4]]);
    await page.locator('#agenda-date').fill('2026-10-16');
    await page.locator('#agenda-date').dispatchEvent('change');
    await select('done');
    assert.equal(await page.locator('.agenda-empty').textContent(), 'No appointments match this filter in the current period.');

    for (const theme of ['violet', 'warm', 'dark']) {
      assert((await page.request.patch(base + '/api/meta', { data: { theme } })).ok());
      await page.reload();
      await card('all').waitFor();
      await select('pending');
      const colors = await page.evaluate(() => {
        const selected = getComputedStyle(document.querySelector('.agenda-stat.active'));
        const other = getComputedStyle(document.querySelector('[data-agenda-filter="done"]'));
        return { selected: selected.backgroundColor, other: other.backgroundColor };
      });
      assert.notEqual(colors.selected, colors.other);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    const cards = await page.locator('.agenda-stat').first().boundingBox();
    assert(cards && cards.width > 70);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(errors, []);
    console.log('Agenda summary filters: day/week/month, counts, grouping, keyboard, form drafts, resets, real completion updates, report scope, bilingual UI and themes passed with an isolated ledger.');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
