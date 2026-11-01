"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "bench-v3-ui-"));
process.env.BENCH_DATA_DIR = root;
const state = require("../lib/default-store").buildDefaultStore();
state.memories = [
  { id: "m-a", title: "原子甲", body: "只属于知识原子", tags: ["本地实验"] },
  { id: "m-b", title: "原子乙", body: "另一条记忆", tags: [] },
];
state.lessons = [{ id: "l-1", rule: "隔离教训", from: "v3" }];
state.prompts = [
  { id: "p-1", title: "提示甲", body: "正文甲", tags: [] },
  { id: "p-2", title: "提示乙", body: "正文乙", tags: [] },
  { id: "p-3", title: "提示丙", body: "正文丙", tags: [] },
];
state.skills = [];
state.skillLibrary = [{ id: "skill-draft", state: "draft", revision: 1, draft: { name: "practice-v3", description: "隔离草稿" }, versions: [], sourceRefs: [] }];
state.artifacts = [{ id: "art-1", name: "隔离成果", path: "D:\\isolated\\note.docx" }];
state.skillRuns = [];
state.reports = [{ id: "rep-1", kind: "weekly", title: "周报隔离", body: "周报隔离正文", createdAt: "2026-10-29T00:00:00.000Z" }];
state.briefRuns = [{ id: "br-1", sourceId: "chatgpt-guangdong-construction", title: "穗建简报隔离", body: "只此一条建设简报", completedAt: "2026-10-29T01:00:00.000Z", sourceUrl: "https://example.com/construction", unread: false }];
fs.writeFileSync(path.join(root, "store.json"), JSON.stringify(state));
const { createServer } = require("../server");
const server = createServer();

(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch({ channel: process.env.BENCH_BROWSER || "chrome", headless: true }).catch(() => chromium.launch({ channel: "msedge", headless: true }));
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    const writes = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => { if (request.method() !== "GET") writes.push(request.url() + " " + request.method()); });
    await page.addInitScript(() => {
      window.speechSynthesis = { speak() {}, cancel() {}, getVoices() { return []; }, addEventListener() {}, removeEventListener() {} };
    });
    await page.route("**/api/briefings", (route) => route.fulfill({ json: { items: [] } }));
    const open = async (hash) => {
      await page.goto(base + "/" + hash);
      await page.locator("#ws-head h1").waitFor();
    };

    await open("#reports/all");
    assert.equal(new URL(page.url()).hash, "#reports/pain");
    assert.equal(await page.locator('#rail [data-primary="reports"] .rail-label').innerText(), "我的关注");
    const labels = await page.locator("#channels .ch").allInnerTexts();
    assert.deepEqual(labels.map((text) => text.replace(/\s+/g, "")), ["行业痛点0", "科技前沿0", "AI上新0", "建筑报告1", "本地实验1", "经营报告1"]);
    assert.match(await page.locator("#ws-body").innerText(), /这一类还没有台账记录/);
    assert.equal(await page.locator("text=穗建简报隔离").count(), 0);
    assert.equal(await page.locator("#workspace.asset-mode").count(), 0);

    await page.locator('#channels button[data-sec="construction"]').click();
    await page.waitForFunction(() => location.hash === "#reports/construction");
    assert.match(await page.locator("#ws-body").innerText(), /穗建简报隔离/);
    assert.equal(await page.locator('[data-act="open-system"]').count(), 1);
    await page.locator('#channels button[data-sec="lab"]').click();
    await page.waitForFunction(() => location.hash === "#reports/lab");
    assert.match(await page.locator("#ws-body").innerText(), /原子甲/);
    assert.equal(await page.locator("text=原子乙").count(), 0);
    await page.locator('#channels button[data-sec="business"]').click();
    await page.waitForFunction(() => location.hash === "#reports/business");
    assert.equal(await page.locator('#ws-body button[data-sec="weekly"]').count(), 1);
    assert.equal(await page.locator('#ws-body button[data-kind="quarterly"]').count(), 1);
    await page.locator('#ws-body button[data-sec="weekly"]').click();
    await page.waitForFunction(() => location.hash === "#reports/weekly");
    assert.equal(await page.locator("#report-body").inputValue(), "周报隔离正文");

    await open("#ops/monthly");
    assert.equal(new URL(page.url()).hash, "#reports/monthly");
    assert.match(await page.locator("#ws-body").innerText(), /还没有这份文件/);
    await open("#memory/skills");
    assert.equal(new URL(page.url()).hash, "#assets/skills");
    await page.locator("#skill-studio").waitFor();

    await open("#assets/all");
    assert.equal(await page.locator("#workspace.asset-mode").count(), 1);
    assert.match(await page.locator(".asset-kicker").innerText(), /YOUR PERSONAL WORKSPACE/);
    const stats = await page.locator(".asset-stat b").allTextContents();
    assert.deepEqual(stats, ["1", "2", "1", "3"]);
    assert.match(await page.locator(".asset-banner").first().innerText(), /待确认草稿\s*1/);
    assert.match(await page.locator("#ws-body").innerText(), /原子甲/);
    assert.equal(await page.locator("#skill-studio").count(), 0);
    await page.locator("#asset-search").fill("原子甲");
    await page.waitForFunction(() => document.querySelector('[data-asset-text*="原子乙"]')?.hidden === true);
    assert.equal(await page.locator('[data-asset-text*="原子甲"]').isHidden(), false);
    await page.locator('.asset-chip', { hasText: "内容原料" }).click();
    await page.locator("#ws-body .asset-card", { hasText: "隔离成果" }).waitFor();
    assert.equal(new URL(page.url()).hash, "#assets/materials");
    await page.locator('.asset-chip', { hasText: "待整理" }).click();
    await page.locator("#ws-body .asset-card", { hasText: "practice-v3" }).waitFor();
    assert.equal(new URL(page.url()).hash, "#assets/pending");
    await open("#assets/knowledge");
    assert.equal(await page.locator("#vault-status").count(), 1);

    await open("#set/all");
    await page.locator("#companion-settings").waitFor();
    assert.equal(await page.locator("#pet-enabled").isChecked(), true);
    assert.equal(await page.locator(".jarvis-orb").count(), 1);
    await page.locator(".jarvis-orb").click();
    assert.equal(await page.locator('.jarvis-menu button[data-pet="focus"]').innerText(), "我的关注");
    await page.locator("#pet-enabled").uncheck();
    await page.locator('[data-act="save-companion"]').click();
    await page.locator("#jarvis").waitFor({ state: "hidden" });
    assert.equal(await page.locator("#pet-enabled").isChecked(), false);
    assert.equal(errors.length, 0, errors.join("\n"));
    assert.ok(writes.every((line) => line.includes("/api/meta")), writes.join("\n"));
    console.log("v3 focus, asset ledger counts, legacy report routes and Jarvis settings passed in the browser.");
  } finally {
    await browser.close();
    server.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
