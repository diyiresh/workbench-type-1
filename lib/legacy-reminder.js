"use strict";

const fs = require("fs");
const path = require("path");

function browserDataRoots() {
  const local = process.env.LOCALAPPDATA;
  if (!local) return [];
  return [
    path.join(local, "Microsoft", "Edge", "User Data"),
    path.join(local, "Google", "Chrome", "User Data"),
  ].filter((root) => fs.existsSync(root));
}

function profileDirs(root) {
  try {
    return fs.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && (entry.name === "Default" || entry.name.startsWith("Profile ")))
      .map((entry) => path.join(root, entry.name));
  } catch {
    return [];
  }
}

function legacyStateFiles() {
  const files = [];
  for (const root of browserDataRoots()) {
    for (const profile of profileDirs(root)) {
      const dir = path.join(profile, "IndexedDB", "file__0.indexeddb.leveldb");
      if (!fs.existsSync(dir)) continue;
      for (const name of fs.readdirSync(dir)) {
        if (!/\.(?:ldb|log)$/i.test(name)) continue;
        const file = path.join(dir, name);
        try { files.push({ file, mtimeMs: fs.statSync(file).mtimeMs }); } catch { /* file changed while scanning */ }
      }
    }
  }
  return files.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function importLegacyDailyPlanReminder(store) {
  const current = store.remote && store.remote.reminder;
  if (current && current.token) return false;
  const pattern = /"push"\s*:\s*"(pushplus|serverchan)"\s*,\s*"pushTok"\s*:\s*"([^"\\]{4,})"/g;
  for (const candidate of legacyStateFiles()) {
    let raw;
    try { raw = fs.readFileSync(candidate.file).toString("latin1"); } catch { continue; }
    const matches = [...raw.matchAll(pattern)];
    const match = matches.at(-1);
    // daily-plan 同时写入 IndexedDB 保护备份。Chromium 把该对象存为结构化克隆，
    // `pushTok` 与值之间存在二进制长度标记，不能按 JSON 读取。
    const tokenKey = raw.lastIndexOf("pushTok");
    const binaryToken = tokenKey >= 0
      ? raw.slice(tokenKey + "pushTok".length, tokenKey + "pushTok".length + 180).match(/[A-Za-z0-9_-]{16,}/)
      : null;
    if (!match && !binaryToken) continue;
    const provider = match ? match[1] : (raw.slice(Math.max(0, tokenKey - 220), tokenKey + 40).includes("serverchan") ? "serverchan" : "pushplus");
    const token = match ? match[2] : binaryToken[0];
    store.remote = store.remote || {};
    store.remote.reminder = {
      provider,
      token,
      enabled: true,
      importedFrom: "daily-plan",
      migratedAt: new Date().toISOString(),
    };
    return true;
  }
  return false;
}

module.exports = { importLegacyDailyPlanReminder };
