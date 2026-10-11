const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    await page.goto('http://127.0.0.1:3780/#department/dr-36md68k9bl');
    await page.locator('.project-messages .msg').first().waitFor();
    await page.evaluate(() => { document.querySelector('#briefing').hidden = true; });
    await page.locator('.room-composer textarea').fill('未发送的阅读备注');
    const before = await page.locator('.project-messages').evaluate(el => { el.scrollTop = 280; return el.scrollTop; });
    assert(before > 0);
    // Actual app reload path: hashchange renders the same room; polling uses the same render.
    await page.evaluate(() => window.dispatchEvent(new HashChangeEvent('hashchange')));
    assert.equal(await page.locator('.project-messages').evaluate(el => el.scrollTop), before, '同房间重绘必须保留阅读位置');
    assert.equal(await page.locator('.room-composer textarea').inputValue(), '未发送的阅读备注');
    await page.waitForTimeout(6500);
    assert.equal(await page.locator('.project-messages').evaluate(el => el.scrollTop), before, '真实轮询不能重置阅读位置');
    console.log('Department browser render, polling scroll and draft preservation passed');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
