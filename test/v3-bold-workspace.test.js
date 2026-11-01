"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { buildDefaultStore } = require("../lib/default-store");
const { ensureV2 } = require("../lib/migrate");
const focus = require("../lib/focus");

(async () => {
  const web = await import("../public/js/focus.mjs");
  const nav = await import("../public/js/navigation.mjs");

  assert.equal(nav.NAVIGATION.find((item) => item.id === "reports").name, "我的关注");
  assert.deepEqual(focus.SEED.map((item) => item.id), nav.FOCUS_CATEGORIES.map((item) => item.id));
  assert.deepEqual(focus.SEED.map((item) => item.name), nav.FOCUS_CATEGORIES.map((item) => item.name));
  assert.equal(focus.GREETING, web.GREETING);
  assert.equal(focus.GREETING, "Hello BEN, let's change the world!");

  assert.equal(nav.resolveRoute("#reports/all").hash, "#reports/pain");
  assert.equal(nav.resolveRoute("#ops/all").hash, "#reports/pain");
  assert.equal(nav.resolveRoute("#reports/all").primary, "ops");
  assert.equal(nav.resolveRoute("#ops/weekly").hash, "#reports/weekly");
  assert.equal(nav.resolveRoute("#reports/daily").secondary, "daily");
  assert.equal(nav.resolveRoute("#ops/today").hash, "#agenda/all");
  assert.equal(nav.resolveRoute("#memory/skills").hash, "#assets/skills");
  assert.equal(nav.focusCategoryFor("weekly"), "business");
  assert.equal(nav.focusCategoryFor("frontier"), "frontier");
  assert.equal(nav.focusCategoryFor("nope"), null);

  const store = ensureV2(buildDefaultStore());
  assert.equal(store.meta.version, "0.11.0");
  assert.equal(store.focusCategories.length, 6);
  assert.equal(store.meta.companion.enabled, true);
  assert.equal(store.meta.companion.voice, true);
  assert.equal(store.meta.companion.autostart, false);
  assert.equal(store.meta.companion.speakMode, "daily");
  assert.deepEqual(store.focusCategories.find((item) => item.id === "construction").sourceIds, ["chatgpt-guangdong-construction"]);
  const painSeed = store.focusCategories.find((item) => item.id === "pain");
  assert.deepEqual(painSeed.sourceIds, ["research-pulse", "grok-x-pain"]);
  assert.equal(painSeed.intakeSourceId, "focus-industry-pain");
  assert.match(painSeed.blurb, /research-pulse/);
  assert.match(painSeed.blurb, /grok-x-pain/);
  assert.match(painSeed.fill, /Research Pulse/);
  assert.match(painSeed.fill, /grok-x-pain/);
  assert.match(painSeed.fill, /focus-industry-pain/);
  const painBound = web.feedFor(painSeed, {
    briefRuns: [
      { id: "rp", sourceId: "research-pulse", title: "t", body: "b", completedAt: "2026-10-29T03:00:00.000Z" },
      { id: "gx", sourceId: "grok-x-pain", title: "t", body: "b", completedAt: "2026-10-29T02:00:00.000Z" },
      { id: "legacy", sourceId: "focus-industry-pain", title: "t", body: "b", completedAt: "2026-10-29T01:00:00.000Z" },
      { id: "other", sourceId: "chatgpt-daily-priority", title: "t", body: "b", completedAt: "2026-10-29T04:00:00.000Z" },
    ],
    memories: [
      { id: "tagged", title: "痛", body: "x", tags: ["行业痛点"] },
      { id: "nope", title: "别", body: "y", tags: ["其他"] },
    ],
  });
  assert.deepEqual(painBound.runs.map((item) => item.id), ["rp", "gx", "legacy"]);
  assert.deepEqual(painBound.memories.map((item) => item.id), ["tagged"]);
  store.reports = [{ id: "r1", kind: "weekly", title: "保留", body: "原文" }];
  store.focusCategories.find((item) => item.id === "pain").sourceIds = ["custom-pain"];
  store.meta.companion.enabled = false;
  const again = ensureV2(store);
  assert.equal(again.reports[0].body, "原文");
  assert.deepEqual(again.focusCategories.find((item) => item.id === "pain").sourceIds, ["custom-pain"]);
  assert.equal(again.meta.companion.enabled, false);
  assert.equal(again.focusCategories.filter((item) => item.id === "pain").length, 1);

  const ledger = {
    briefRuns: [
      { id: "b1", sourceId: "chatgpt-guangdong-construction", title: "穗建", body: "政策", completedAt: "2026-10-29T01:00:00.000Z" },
      { id: "b2", sourceId: "focus-industry-pain", title: "养老", body: "痛点", completedAt: "2026-10-28T01:00:00.000Z" },
      { id: "b3", sourceId: "chatgpt-guangdong-construction", title: "归档", body: "隐藏", archived: true },
      { id: "b4", sourceId: "research-pulse", title: "t", body: "b", completedAt: "2026-10-29T05:00:00.000Z" },
    ],
    memories: [
      { id: "m1", title: "实验", body: "记下了", tags: ["本地实验"] },
      { id: "m2", title: "别的", body: "无关", tags: ["其他"] },
    ],
    skillLibrary: [
      { id: "s1", state: "draft", draft: { name: "practice-a", description: "草稿" }, versions: [] },
      { id: "s2", state: "published", draft: { name: "practice-b", description: "已发布" }, versions: [{}], archived: true },
    ],
    skills: [{ id: "legacy", name: "旧说明", summary: "未绑定" }],
    lessons: [{ id: "l1", rule: "先核对" }],
    prompts: [],
    artifacts: [{ id: "a1", name: "成果", path: "D:\\out\\a.docx" }],
    skillRuns: [{ id: "run1", skillId: "s1" }],
  };
  const construction = again.focusCategories.find((item) => item.id === "construction");
  const pain = again.focusCategories.find((item) => item.id === "pain");
  pain.sourceIds = [];
  const built = web.feedFor(construction, ledger);
  assert.deepEqual(built.runs.map((item) => item.id), ["b1"]);
  assert.deepEqual(web.feedFor(pain, ledger).runs.map((item) => item.id), ["b2"]);
  assert.equal(web.feedFor(again.focusCategories.find((item) => item.id === "lab"), ledger).memories[0].id, "m1");
  assert.equal(web.feedFor(again.focusCategories.find((item) => item.id === "business"), ledger).runs.length, 0);
  const snap = web.assetSnapshot(ledger);
  assert.deepEqual(snap.counts, { skills: 1, atoms: 2, materials: 1, lessons: 1, prompts: 0, pending: 1 });
  assert.equal(snap.published, 0);
  assert.equal(snap.legacySkills, 1);
  assert.equal(snap.skillRuns, 1);

  const cases = [
    [{ settings: {}, today: "2026-10-29", lastSpokenDate: "" }, true],
    [{ settings: {}, today: "2026-10-29", lastSpokenDate: "2026-10-29" }, false],
    [{ settings: { speakMode: "always" }, today: "2026-10-29", lastSpokenDate: "2026-10-29" }, true],
    [{ settings: { enabled: false }, today: "2026-10-29", lastSpokenDate: "" }, false],
    [{ settings: { voice: false }, today: "2026-10-29", lastSpokenDate: "" }, false],
    [{ settings: { mutedDate: "2026-10-29" }, today: "2026-10-29", lastSpokenDate: "" }, false],
  ];
  for (const [input, expected] of cases) {
    assert.equal(focus.shouldSpeak(input), expected);
    assert.equal(web.shouldSpeak(input), expected);
  }
  const muted = focus.applyCompanion({ enabled: false, voice: true, autostart: true, speakMode: "daily", mutedDate: "" }, { mutedDate: "2026-10-29" });
  assert.equal(muted.enabled, false);
  assert.equal(muted.autostart, true);
  assert.equal(muted.mutedDate, "2026-10-29");

  assert.equal(focus.routeLink("https://example.com/a").action, "pane");
  assert.equal(focus.routeLink("http://127.0.0.1:3780/#reports/weekly").action, "internal");
  assert.equal(focus.routeLink("https://example.com/a", { explicitSystem: true }).action, "system");
  assert.equal(focus.routeLink("javascript:alert(1)").action, "ignore");
  assert.equal(focus.routeLink("file:///C:/secret.txt").action, "ignore");
  assert.throws(() => focus.windowsTtsArgs("other words"), /tts_text_rejected/);
  const tts = focus.windowsTtsArgs(focus.GREETING).join(" ");
  assert.match(tts, /System\.Speech/);
  assert.match(tts, /Hello BEN, let''s change the world!/);

  let spawned = false;
  const attached = await focus.ensureWorkbench({ port: 1, probe: async () => "workbench", spawn() { spawned = true; } });
  assert.equal(attached.attached, true);
  assert.equal(spawned, false);
  const started = await focus.ensureWorkbench({
    port: 1,
    probe: async () => "down",
    spawn() { spawned = true; return { pid: 1 }; },
    wait: async () => "workbench",
  });
  assert.equal(started.started, true);
  assert.equal(spawned, true);
  await assert.rejects(focus.ensureWorkbench({ port: 9, probe: async () => "other" }), /port_in_use_not_workbench/);

  const shell = fs.readFileSync(path.join(__dirname, "../desktop/main.js"), "utf8");
  const preload = fs.readFileSync(path.join(__dirname, "../desktop/preload-shell.js"), "utf8");
  assert.match(shell, /routeLink/);
  assert.match(shell, /focus\.GREETING/);
  assert.match(shell, /setLoginItemSettings/);
  assert.match(preload, /explicitSystem/);
  assert.match(fs.readFileSync(path.join(__dirname, "../desktop/pane-bar.html"), "utf8"), /用系统浏览器打开/);
  assert.match(fs.readFileSync(path.join(__dirname, "../scripts/windows-desktop.ps1"), "utf8"), /Autostart/);
  assert.match(fs.readFileSync(path.join(__dirname, "../scripts/windows-desktop.ps1"), "utf8"), /Uninstall/);
  const spec = fs.readFileSync(path.join(__dirname, "../docs/SPEC-desktop-shell.md"), "utf8");
  assert.match(spec, /npm run desktop/);
  assert.match(spec, /windows-desktop\.ps1/);
  assert.match(spec, /Hello BEN, let's change the world!/);

  console.log("v3 focus categories, asset counts, link routing, companion defaults and desktop shell policy passed.");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
