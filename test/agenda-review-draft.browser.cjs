const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-review-draft-'));
process.env.BENCH_DATA_DIR = root;
const state = require('../lib/default-store').buildDefaultStore();
state.agendas = [{ id: 'review-draft', date: '2026-10-21', title: 'Draft protection fixture', done: true, review: 'Saved review', tags: [] }];
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
    const errors = [], dialogs = [];
    let discard = false, failReview = false, reviewGate = null, savedNote;
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', async dialog => {
      dialogs.push(dialog.message());
      assert.equal(dialog.type(), 'confirm');
      await (discard ? dialog.accept() : dialog.dismiss());
    });
    await page.clock.setFixedTime(new Date('2026-10-21T12:00:00+08:00'));
    await page.route('**/api/briefings', route => route.fulfill({ json: { items: [] } }));
    await page.route('**/api/agendas/review-draft', async route => {
      if (route.request().method() !== 'PATCH') return route.continue();
      if (failReview) return route.fulfill({ status: 503, json: { error: 'test_save_failed' } });
      if (reviewGate) await reviewGate;
      return route.continue();
    });
    await page.route('**/api/agendas/review-draft/review-note/*', async route => {
      const action = new URL(route.request().url()).pathname.split('/').at(-1);
      const original = JSON.parse(fs.readFileSync(path.join(root, 'store.json'), 'utf8')).agendas[0].review;
      if (action === 'cleanup') return route.fulfill({ json: { existing: [], snapshot: 'isolated' } });
      if (action === 'save') {
        savedNote = route.request().postDataJSON();
        return route.fulfill({ json: { note: { path: 'isolated-note.md', file: 'isolated-note.md', sha256: 'test' } } });
      }
      return route.fulfill({ json: { original, summary: 'Saved summary', keywords: ['topic'], ...(action === 'saved' ? { baseNote: { file: 'isolated-note.md', sha256: 'test' } } : {}) } });
    });
    await page.goto(base + '/#agenda');
    const open = () => page.locator('[data-act="agenda-review"]').click();
    const original = page.locator('#review-note-original');
    const modal = page.locator('#modal');
    const close = () => page.locator('[data-note-close]').click();
    await open();
    const text = 'Unsaved first line\n第二行复盘';
    await original.fill(text);
    await page.locator('.review-note-editor h2').click();
    await modal.click({ position: { x: 8, y: 8 } });
    assert(await modal.isVisible(), 'Clicking outside the review must keep the editor open.');
    assert.equal(await original.inputValue(), text);
    assert.equal(dialogs.length, 0, 'Backdrop clicks must not prompt or discard.');
    await close();
    assert(await modal.isVisible(), 'Cancelling close must retain the editor.');
    assert.equal(await original.inputValue(), text);
    assert.equal(dialogs.length, 1);
    discard = true;
    await close();
    assert(await modal.isHidden());
    await open();
    assert.equal(await original.inputValue(), 'Saved review', 'Confirmed discard must not save the draft.');
    await close();
    assert.equal(dialogs.length, 2, 'Unchanged review must close without a warning.');

    await open(); discard = false; failReview = true;
    await original.fill(text);
    await page.locator('[data-note-review-only]').click();
    await page.getByText('test_save_failed', { exact: true }).waitFor();
    await close();
    assert(await modal.isVisible(), 'Failed saves must leave the draft protected.');
    failReview = false;
    await page.locator('[data-note-review-only]').click();
    await page.getByText('复盘已保存。', { exact: true }).waitFor();
    const count = dialogs.length;
    await close();
    assert(await modal.isHidden());
    assert.equal(dialogs.length, count, 'Successfully saved review must close without warning.');
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'store.json'), 'utf8')).agendas[0].review, text);

    await open();
    let releaseReview;
    reviewGate = new Promise(resolve => { releaseReview = resolve; });
    await original.fill('Submitted review');
    const requested = page.waitForRequest(request => request.method() === 'PATCH' && request.url() === base + '/api/agendas/review-draft');
    await page.locator('[data-note-review-only]').click(); await requested;
    await original.fill('New edits while saving\n不能丢失');
    releaseReview(); reviewGate = null;
    await page.getByText('复盘已保存。', { exact: true }).waitFor();
    await close();
    assert(await modal.isVisible(), 'Edits made during a save must still warn before closing.');
    assert.equal(await original.inputValue(), 'New edits while saving\n不能丢失');
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'store.json'), 'utf8')).agendas[0].review, 'Submitted review');
    discard = true; await close(); discard = false;

    await open();
    await page.locator('[data-note-draft]').click();
    await page.getByText('摘要待确认，尚未写入笔记。', { exact: true }).waitFor();
    await page.locator('#review-note-summary').fill('Unsaved summary\n补充回复');
    await page.locator('#review-note-keywords').fill('new topic');
    await modal.click({ position: { x: 8, y: 8 } });
    await close();
    assert(await modal.isVisible());
    assert.equal(await page.locator('#review-note-summary').inputValue(), 'Unsaved summary\n补充回复');
    await page.locator('[data-note-save]').click();
    await page.getByText('Markdown 笔记已保存并读回：isolated-note.md', { exact: true }).waitFor();
    assert.equal(savedNote.summary, 'Unsaved summary\n补充回复');
    assert.equal(savedNote.keywords, 'new topic');
    const afterSave = dialogs.length;
    await close(); assert(await modal.isHidden());
    assert.equal(dialogs.length, afterSave);

    await open();
    await page.locator('[data-note-load]').click();
    await page.getByText('已载入最新笔记，可补充回复并整合；尚未保存新版本。', { exact: true }).waitFor();
    await close(); assert(await modal.isHidden());
    assert.equal(dialogs.length, afterSave, 'Loading a saved note without editing must not warn.');
    await page.request.patch(base + '/api/meta', { data: { language: 'en' } });
    await page.reload(); await open();
    await page.locator('[data-note-load]').click();
    await page.getByText('Latest note loaded. Add answers and integrate them; no new version has been saved.', { exact: true }).waitFor();
    await page.locator('#review-note-keywords').fill('changed keyword only');
    await page.setViewportSize({ width: 390, height: 844 });
    await close(); assert(await modal.isVisible());
    assert.match(dialogs.at(-1), /unsaved/i);
    assert.deepEqual(errors, []);
    console.log('Review draft protection passed: backdrop, multiline text, cancel/discard, failed and successful saves, edits during save, summary, keyword edits, loaded notes, English and mobile; isolated ledger only.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => server.close());
