const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const state = await (await fetch('http://127.0.0.1:3780/api/state')).json();
  const runId = state.departmentRuns[0].id;
  state.projectMessages = ['chairman','cursor','workbuddy','codex'].map((sender, index) => ({ id: 'bubble-'+index, runId, sender, type: 'progress', createdAt: new Date().toISOString(), text: index === 1 ? '长成果\n'.repeat(300) : '消息 <script>安全转义</script>\n第二行' }));
  const browser = await chromium.launch({ channel:'msedge', headless:true });
  try {
    const page = await browser.newPage({ viewport:{ width:1440,height:1000 } });
    await page.route('**/api/state', route => route.fulfill({ json:state }));
    await page.goto('http://127.0.0.1:3780/#department/'+runId);
    await page.locator('.chat-message').first().waitFor();
    await page.evaluate(() => { document.querySelector('#briefing').hidden = true; });
    for (const [sender, side] of [['codex','left'],['cursor','left'],['workbuddy','right'],['chairman','right']]) {
      assert(await page.locator(`[data-sender="${sender}"]`).evaluate((el, side) => el.classList.contains('chat-'+side), side));
      assert(await page.locator(`[data-sender="${sender}"] .chat-meta b`).textContent());
    }
    assert.equal(await page.locator('.chat-text script').count(),0);
    await page.locator('.chat-long summary').click();
    await page.locator('.room-composer textarea').fill('草稿保留');
    const before = await page.locator('.project-messages').evaluate(el => { el.scrollTop = 180; return el.scrollTop; });
    assert(before > 0);
    await page.evaluate(() => window.dispatchEvent(new HashChangeEvent('hashchange')));
    assert(await page.locator('.chat-long').evaluate(el => el.open));
    assert.equal(await page.locator('.project-messages').evaluate(el => el.scrollTop),before);
    assert.equal(await page.locator('.room-composer textarea').inputValue(),'草稿保留');
    await page.waitForTimeout(6500);
    assert(await page.locator('.chat-long').evaluate(el => el.open));
    assert.equal(await page.locator('.project-messages').evaluate(el => el.scrollTop),before);
    await page.locator('.chat-long summary').click();
    assert.equal(await page.locator('.chat-long').evaluate(el => el.open),false);
    await page.locator('.project-messages').evaluate(el => { el.scrollTop = 0; });
    await page.locator('.room-chat').screenshot({ path:'data/chat-bubbles-desktop.png' });
    await page.setViewportSize({ width:390,height:844 });
    assert(await page.locator('.room-chat').evaluate(el => el.scrollWidth <= el.clientWidth));
    await page.locator('.room-chat').screenshot({ path:'data/chat-bubbles-mobile.png' });
    console.log('Chat sender positions, escaping, expansion, polling scroll, draft and mobile checks passed; real records unchanged');
  } finally { await browser.close(); }
})().catch(error => {console.error(error);process.exitCode=1;});
