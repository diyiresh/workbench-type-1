const assert = require('node:assert/strict');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try {
    const page=await browser.newPage();
    await page.goto('http://127.0.0.1:3780/#department/dr-vruuszla5e');
    const input=page.locator('.room-composer textarea'); await input.waitFor();
    await page.evaluate(()=>{document.querySelector('#briefing').hidden=true});
    await input.fill('中文输入测试'); await input.focus();
    await input.evaluate(el=>el.setSelectionRange(2,2));
    await page.evaluate(()=>window.dispatchEvent(new HashChangeEvent('hashchange')));
    assert(await input.evaluate(el=>document.activeElement===el));
    assert.equal(await input.evaluate(el=>el.selectionStart),2);
    await page.keyboard.insertText('继续');
    assert.equal(await input.inputValue(),'中文继续输入测试');
    await input.dispatchEvent('compositionstart');
    const original=await input.elementHandle();
    await page.evaluate(()=>window.dispatchEvent(new HashChangeEvent('hashchange')));
    assert(await original.evaluate(el=>el.isConnected),'输入法组合时不得替换节点');
    await input.dispatchEvent('compositionend'); await page.waitForTimeout(50);
    assert.equal(await input.inputValue(),'中文继续输入测试');
    assert(await input.evaluate(el=>document.activeElement===el));
    await page.waitForTimeout(6500);
    assert(await input.evaluate(el=>document.activeElement===el));
    console.log('Chat focus, caret, continued typing, IME and polling checks passed; no message sent');
  } finally {await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
