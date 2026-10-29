"use strict";

// v3 focus feeds, asset counts are rendered in the browser. This module owns
// ledger defaults, companion settings, and the desktop link / voice policy.

const http = require("http");

const GREETING = "Hello BEN, let's change the world!";

const SEED = [
  {
    id: "pain",
    name: "行业痛点",
    sourceIds: [],
    intakeSourceId: "focus-industry-pain",
    memoryTags: ["行业痛点", "痛点"],
    blurb: "行业痛点：AI 工具、养老、教育等。只列出已写入台账的简报和带这些标签的记忆。",
    fill: "用 Grok Bot 例行任务，或把 kind 为 brief 的 JSON 放进 data/dropbox。sourceId 用 focus-industry-pain。简报中心已有的其他来源不会被挪到这里。",
  },
  {
    id: "frontier",
    name: "科技前沿",
    sourceIds: ["chatgpt-practical-ai"],
    intakeSourceId: "focus-paper-radar",
    memoryTags: ["科技前沿", "论文"],
    blurb: "科技前沿：论文与前沿发布。已绑定简报来源 Practical AI Research，另收 focus-paper-radar。",
    fill: "Paper Radar 一类的例行任务请投递 sourceId focus-paper-radar。现有 chatgpt-practical-ai 会显示在这里。",
  },
  {
    id: "ai-new",
    name: "AI 上新",
    sourceIds: ["workbuddy-ai-news"],
    intakeSourceId: "focus-ai-launches",
    memoryTags: ["AI上新", "AI 上新"],
    blurb: "AI 上新：每日新产品。已绑定「每日 AI 新闻推送」，另收 focus-ai-launches。",
    fill: "Product Hunt 前三等上新简报请用 sourceId focus-ai-launches。没有新投递时，这里只显示台账里已有的 AI 新闻。",
  },
  {
    id: "construction",
    name: "建筑报告",
    sourceIds: ["chatgpt-guangdong-construction"],
    intakeSourceId: "focus-construction",
    memoryTags: ["建筑", "穗建"],
    blurb: "建筑报告：广东建设政策与现场简报。已绑定 Guangdong Construction Brief。",
    fill: "穗建智答或建设简报可继续用现有来源 chatgpt-guangdong-construction，或投递 focus-construction。",
  },
  {
    id: "lab",
    name: "本地实验",
    sourceIds: [],
    intakeSourceId: "focus-local-lab",
    memoryTags: ["本地实验", "lab"],
    blurb: "本地实验：本机微实验笔记。只显示标签为「本地实验」或 lab 的记忆，以及 focus-local-lab 简报。",
    fill: "把实验笔记存成记忆并打上标签「本地实验」，或投递 sourceId focus-local-lab。不会编造实验记录。",
  },
  {
    id: "business",
    name: "经营报告",
    legacy: true,
    sourceIds: [],
    intakeSourceId: "",
    memoryTags: [],
    blurb: "经营报告：日报、复盘、周指导、周报、月评估、月报、季度总结。生成后仍可改成人话再保存。",
    fill: "",
  },
];

function cleanName(value) {
  if (typeof value !== "string") return "";
  const name = value.trim().slice(0, 40);
  return name;
}

function stringList(value, fallback) {
  if (!Array.isArray(value)) return [...fallback];
  return value
    .filter((item) => typeof item === "string" && item.trim())
    .map((item) => item.trim().slice(0, 80))
    .slice(0, 24);
}

function validDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

function companionFrom(input) {
  const source = input && typeof input === "object" ? input : {};
  return {
    enabled: source.enabled !== false,
    voice: source.voice !== false,
    autostart: source.autostart === true,
    speakMode: source.speakMode === "always" ? "always" : "daily",
    mutedDate: validDate(source.mutedDate),
  };
}

function applyCompanion(prev, patch) {
  const next = companionFrom(prev);
  if (!patch || typeof patch !== "object") return next;
  for (const key of ["enabled", "voice", "autostart"]) {
    if (typeof patch[key] === "boolean") next[key] = patch[key];
  }
  if (patch.speakMode === "always" || patch.speakMode === "daily") next.speakMode = patch.speakMode;
  if (patch.mutedDate === "" || validDate(patch.mutedDate)) next.mutedDate = patch.mutedDate === "" ? "" : validDate(patch.mutedDate);
  return next;
}

function ensureFocus(store) {
  store.meta = store.meta || {};
  const saved = Array.isArray(store.focusCategories) ? store.focusCategories : [];
  store.focusCategories = SEED.map((seed) => {
    const custom = saved.find((item) => item && item.id === seed.id) || {};
    const intake = typeof custom.intakeSourceId === "string" ? custom.intakeSourceId.trim().slice(0, 80) : seed.intakeSourceId;
    return {
      ...seed,
      name: cleanName(custom.name) || seed.name,
      sourceIds: stringList(custom.sourceIds, seed.sourceIds),
      memoryTags: stringList(custom.memoryTags, seed.memoryTags),
      intakeSourceId: intake,
      blurb: typeof custom.blurb === "string" && custom.blurb.trim() ? custom.blurb.trim().slice(0, 400) : seed.blurb,
      fill: typeof custom.fill === "string" && custom.fill.trim() ? custom.fill.trim().slice(0, 600) : seed.fill,
      legacy: seed.legacy === true,
    };
  });
  store.meta.companion = applyCompanion(store.meta.companion, {});
  store.meta.version = "0.11.0";
  return store;
}

function shouldSpeak({ settings, today, lastSpokenDate }) {
  const companion = companionFrom(settings);
  if (!companion.enabled || !companion.voice) return false;
  if (companion.mutedDate && companion.mutedDate === today) return false;
  if (companion.speakMode === "always") return true;
  return lastSpokenDate !== today;
}

function routeLink(raw, options = {}) {
  const pageOrigin = options.pageOrigin || "http://127.0.0.1:3780";
  let url;
  try {
    url = new URL(String(raw || ""), pageOrigin);
  } catch {
    return { action: "ignore", reason: "invalid" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { action: "ignore", reason: "scheme" };
  if (options.explicitSystem === true) return { action: "system", url: url.href };
  let page;
  try { page = new URL(pageOrigin); } catch { page = null; }
  if (page && url.origin === page.origin) return { action: "internal", url: url.href };
  return { action: "pane", url: url.href };
}

function windowsTtsArgs(text) {
  if (text !== GREETING) {
    const error = new Error("tts_text_rejected");
    error.code = "tts_text_rejected";
    throw error;
  }
  const command = "Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).Speak('" + GREETING.replace(/'/g, "''") + "')";
  return ["-NoProfile", "-NonInteractive", "-Command", command];
}

function probeWorkbench(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const req = http.get({ host, port, path: "/api/health", timeout: 800 }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          resolve(body && body.ok === true ? "workbench" : "other");
        } catch {
          resolve("other");
        }
      });
    });
    req.on("error", () => resolve("down"));
    req.on("timeout", () => {
      req.destroy();
      resolve("down");
    });
  });
}

async function ensureWorkbench({ port = 3780, probe = probeWorkbench, spawn, wait }) {
  const status = await probe(port);
  if (status === "workbench") return { attached: true, started: false };
  if (status === "other") {
    const error = new Error("port_in_use_not_workbench");
    error.code = "port_in_use_not_workbench";
    throw error;
  }
  if (typeof spawn !== "function") {
    const error = new Error("workbench_not_running");
    error.code = "workbench_not_running";
    throw error;
  }
  const child = spawn();
  const ready = wait ? await wait(port) : "workbench";
  if (ready !== "workbench") {
    const error = new Error("workbench_did_not_start");
    error.code = "workbench_did_not_start";
    throw error;
  }
  return { attached: false, started: true, child };
}

module.exports = {
  GREETING,
  SEED,
  companionFrom,
  applyCompanion,
  ensureFocus,
  shouldSpeak,
  routeLink,
  windowsTtsArgs,
  probeWorkbench,
  ensureWorkbench,
};
