"use strict";
// Tests written for the classic rail + sidebar layout opt into it explicitly; V8 is the default.
module.exports = function useClassicLayout(browser) {
  const newPage = browser.newPage.bind(browser);
  browser.newPage = async (...args) => {
    const page = await newPage(...args);
    await page.addInitScript(() => {
      try {
        if (!localStorage.getItem('bench-v8-appearance')) localStorage.setItem('bench-v8-appearance', JSON.stringify({ layout: 'classic', palette: 'classic' }));
      } catch { /* storage-less pages keep the default */ }
    });
    return page;
  };
  return browser;
};
