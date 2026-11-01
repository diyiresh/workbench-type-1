"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "bench-external-tools-ui-"));
process.env.BENCH_DATA_DIR = root;
fs.writeFileSync(path.join(root, "store.json"), JSON.stringify(require("../lib/default-store").buildDefaultStore()));
const { createServer } = require("../server");
const server = createServer();

(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ channel: process.env.BENCH_BROWSER || "chrome", headless: true }).catch(() => chromium.launch({ channel: "msedge", headless: true }));
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/api/briefings", (route) => route.fulfill({ json: { items: [] } }));
    await page.goto(`${base}/#tools/all`);
    await page.locator("#ws-head h1").waitFor();
    assert.equal(await page.locator("#ws-head h1").innerText(), "外部工具");
    assert.equal(await page.locator('#rail [data-primary="tools"] .rail-label').innerText(), "外部工具");
    await page.locator(".tool-card", { hasText: "ComfyUI" }).waitFor();
    const comfy = page.locator(".tool-card", { hasText: "ComfyUI" });
    assert.match(await comfy.innerText(), /start_comfyui\.bat/);
    assert.equal(await comfy.locator('[data-act="tool-launch"]').count(), 4);
    await page.locator('#channels button[data-sec="pending"]').click();
    await page.waitForFunction(() => location.hash === "#tools/pending");
    const ollama = page.locator(".tool-card", { hasText: "Ollama 本机程序" });
    await ollama.waitFor();
    assert.match(await ollama.innerText(), /可能已卸/);
    assert.equal(await ollama.locator('[data-act="tool-launch"]').count(), 0);
    assert.equal(await page.locator(".tool-card", { hasText: "Meetily" }).locator('[data-act="tool-launch"]').count(), 0);
    await page.locator('#channels button[data-sec="audio"]').click();
    await page.waitForFunction(() => location.hash === "#tools/audio");
    assert.equal(await page.locator(".tool-card", { hasText: "UVR" }).locator('[data-action-id="start"]').count(), 1);
    const launch = page.locator(".tool-card", { hasText: "UVR" }).locator('[data-action-id="start"]');
    await launch.click();
    const receipt = page.locator(".tool-card", { hasText: "UVR" }).locator(".tool-receipt");
    await receipt.filter({ hasText: "已记录打开意图" }).waitFor();
    await page.locator('#channels button[data-sec="all"]').click();
    await page.waitForFunction(() => location.hash === "#tools/all");
    await page.locator("#tool-editor [name=name]").fill("隔离小工具");
    await page.locator("#tool-editor [name=location]").fill("D:\\tools\\isolated");
    await page.locator('#tool-editor [data-action-row] [name=target]').fill("D:\\tools\\isolated");
    await page.locator('[data-act="tool-save"]').click();
    await page.locator(".tool-card", { hasText: "隔离小工具" }).waitFor();
    assert.equal(errors.join("\n"), "");
    const shot = process.env.BENCH_SCREENSHOT;
    if (shot) await page.screenshot({ path: shot, fullPage: true });
    console.log("External tools page checks passed.");
  } finally {
    await browser.close();
    server.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
