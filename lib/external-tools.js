"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const { openInExplorer } = require("./local-opener");

const SEED_FILE = path.join(__dirname, "..", "config", "external-tools.json");
const CATEGORIES = [
  ["media", "绘图视频"],
  ["workspace", "工作区"],
  ["audio", "音频"],
  ["stack", "模型容器"],
  ["dev", "开发工具"],
  ["desktop", "本机软件"],
];
const COMMANDS = {
  "npm-run-dev": { win: "npm.cmd", args: ["run", "dev"] },
  "npm-start": { win: "npm.cmd", args: ["start"] },
  "pnpm-dev": { win: "pnpm.cmd", args: ["dev"] },
  "docker-compose-up": { win: "docker.exe", args: ["compose", "up", "-d"] },
};
const WIN_SEGMENT = "[^\\\\/:*?\"<>|\\r\\n&%!^]+";
const WIN_PATH = new RegExp(`^[A-Za-z]:\\\\(?:${WIN_SEGMENT}\\\\)*${WIN_SEGMENT}$`);
const ENV_PATH = new RegExp(`^%(LOCALAPPDATA|USERPROFILE)%\\\\(?:${WIN_SEGMENT}\\\\)*${WIN_SEGMENT}$`);

function fail(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

function windowsPath(value) {
  return typeof value === "string" && WIN_PATH.test(value) && !value.split("\\").includes("..");
}

function envPath(value) {
  return typeof value === "string" && ENV_PATH.test(value) && !value.split("\\").includes("..");
}

function pathShape(value) {
  return windowsPath(value) || envPath(value);
}

function localUrl(value) {
  if (typeof value !== "string" || value.length > 200) return false;
  let url;
  try { url = new URL(value); } catch { return false; }
  if (!["http:", "https:"].includes(url.protocol)) return false;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) return false;
  if (!/^\d{2,5}$/.test(url.port)) return false;
  if (url.username || url.password || url.search || url.hash) return false;
  if (url.pathname !== "/" && url.pathname !== "") return false;
  if (/[&|<>^%!\r\n"\\]/.test(value)) return false;
  return true;
}

function normalizeAction(raw, index) {
  if (!raw || typeof raw !== "object") return null;
  const kind = String(raw.kind || "");
  const id = /^[a-z0-9-]{1,32}$/.test(String(raw.id || "")) ? String(raw.id) : `a${index + 1}`;
  if (kind === "open-url") {
    if (!localUrl(raw.target)) return null;
    return { id, kind, target: raw.target };
  }
  if (kind === "command") {
    if (!COMMANDS[raw.command] || !pathShape(raw.cwd)) return null;
    return { id, kind, command: raw.command, cwd: raw.cwd };
  }
  if (!["open-folder", "open-file", "start-file"].includes(kind) || !pathShape(raw.target)) return null;
  if (kind === "start-file" && !/\.(bat|cmd|lnk|exe)$/i.test(raw.target)) return null;
  if (kind === "open-file" && !/\.(html?|pdf|docx|md|txt)$/i.test(raw.target)) return null;
  return { id, kind, target: raw.target };
}

function normalizeTool(raw) {
  const name = String(raw?.name || "").trim();
  if (!name || name.length > 80) throw fail("name_rejected");
  const category = String(raw?.category || "");
  if (!CATEGORIES.some(([id]) => id === category)) throw fail("category_rejected");
  if (!["high", "medium", "low"].includes(raw?.confidence)) throw fail("confidence_rejected");
  if (!["ready", "review", "pending"].includes(raw?.status)) throw fail("status_rejected");
  const requestedId = String(raw?.id || "");
  if (requestedId && !/^[a-z0-9][a-z0-9-]{0,40}$/.test(requestedId)) throw fail("id_rejected");
  let actions = Array.isArray(raw?.actions) ? raw.actions.map(normalizeAction).filter(Boolean) : [];
  if (raw.confidence === "low" || raw.status === "pending") actions = [];
  const seen = new Set();
  actions = actions.filter((action) => {
    if (seen.has(action.id)) return false;
    seen.add(action.id);
    return true;
  }).slice(0, 8);
  return {
    id: requestedId || `tool-${crypto.randomBytes(4).toString("hex")}`,
    name,
    category,
    confidence: raw.confidence,
    status: raw.status,
    location: String(raw?.location || "").trim().slice(0, 300),
    note: String(raw?.note || "").trim().slice(0, 800),
    actions,
  };
}

function readSeed() {
  const parsed = JSON.parse(fs.readFileSync(SEED_FILE, "utf8"));
  return (parsed.tools || []).map(normalizeTool);
}

function emptyOverlay() {
  return { revision: 0, hidden: [], tools: [] };
}

function overlayPath(dataDir) {
  return path.join(dataDir, "external-tools.json");
}

function readOverlay(dataDir) {
  const file = overlayPath(dataDir);
  if (!fs.existsSync(file)) return emptyOverlay();
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  return {
    revision: Number(parsed.revision) || 0,
    hidden: Array.isArray(parsed.hidden) ? parsed.hidden.filter((id) => typeof id === "string") : [],
    tools: Array.isArray(parsed.tools) ? parsed.tools.flatMap((tool) => {
      try { return [normalizeTool(tool)]; } catch { return []; }
    }) : [],
  };
}

function writeOverlay(dataDir, overlay) {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = overlayPath(dataDir);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(overlay, null, 2));
  fs.renameSync(tmp, file);
}

function loadCatalog(dataDir) {
  const seedTools = readSeed();
  const overlay = readOverlay(dataDir);
  const hidden = new Set(overlay.hidden);
  const custom = new Map(overlay.tools.map((tool) => [tool.id, tool]));
  const tools = [];
  for (const tool of seedTools) {
    if (hidden.has(tool.id)) continue;
    const replacement = custom.get(tool.id);
    tools.push({ ...(replacement || tool), source: replacement ? "local" : "seed" });
    custom.delete(tool.id);
  }
  for (const tool of custom.values()) {
    if (!hidden.has(tool.id)) tools.push({ ...tool, source: "local" });
  }
  return {
    revision: overlay.revision,
    seedFile: "config/external-tools.json",
    overlayFile: "data/external-tools.json",
    categories: CATEGORIES.map(([id, name]) => ({ id, name })),
    tools,
  };
}

function assertRevision(current, expected) {
  if (expected != null && expected !== "" && Number(expected) !== current.revision) throw fail("revision_conflict", 409);
}

function saveTool(dataDir, input) {
  const current = loadCatalog(dataDir);
  assertRevision(current, input?.expectedRevision);
  const tool = normalizeTool(input || {});
  const overlay = readOverlay(dataDir);
  const index = overlay.tools.findIndex((item) => item.id === tool.id);
  if (index >= 0) overlay.tools[index] = tool;
  else overlay.tools.push(tool);
  overlay.hidden = overlay.hidden.filter((id) => id !== tool.id);
  overlay.revision += 1;
  writeOverlay(dataDir, overlay);
  return loadCatalog(dataDir);
}

function removeTool(dataDir, id, expectedRevision) {
  if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(String(id || ""))) throw fail("id_rejected");
  const current = loadCatalog(dataDir);
  assertRevision(current, expectedRevision);
  const overlay = readOverlay(dataDir);
  overlay.tools = overlay.tools.filter((tool) => tool.id !== id);
  if (readSeed().some((tool) => tool.id === id) && !overlay.hidden.includes(id)) overlay.hidden.push(id);
  overlay.revision += 1;
  writeOverlay(dataDir, overlay);
  return loadCatalog(dataDir);
}

function expandWin(target, env) {
  if (windowsPath(target)) return target;
  if (!envPath(target)) throw fail("path_rejected");
  const expanded = target.replace(/%(LOCALAPPDATA|USERPROFILE)%/g, (_, name) => {
    const value = env[name];
    if (typeof value !== "string" || !/^[A-Za-z]:\\[^"&|<>^%!\r\n]*$/.test(value)) throw fail("env_unexpanded");
    return value.replace(/[\\/]+$/, "");
  });
  if (!windowsPath(expanded)) throw fail("path_rejected");
  return expanded;
}

function quoteCmd(value) {
  if (/["\r\n]/.test(value)) throw fail("path_rejected");
  return `"${value}"`;
}

function spawnOptions() {
  return { detached: true, stdio: "ignore", windowsHide: true, windowsVerbatimArguments: true, shell: false };
}

function winPlan(action, env) {
  if (action.kind === "open-folder") return { explorer: true, path: expandWin(action.target, env) };
  if (action.kind === "open-file" || action.kind === "start-file") {
    const target = expandWin(action.target, env);
    return { file: "cmd.exe", args: ["/d", "/s", "/c", `start "" ${quoteCmd(target)}`], options: spawnOptions() };
  }
  if (action.kind === "open-url") {
    if (!localUrl(action.target)) throw fail("url_rejected");
    return { file: "cmd.exe", args: ["/d", "/s", "/c", `start "" ${quoteCmd(action.target)}`], options: spawnOptions() };
  }
  if (action.kind === "command") {
    const spec = COMMANDS[action.command];
    if (!spec) throw fail("command_rejected");
    const cwd = expandWin(action.cwd, env);
    return { file: "cmd.exe", args: ["/d", "/s", "/c", `cd /d ${quoteCmd(cwd)} && ${spec.win} ${spec.args.join(" ")}`], options: spawnOptions() };
  }
  throw fail("action_rejected");
}

function runSpawn(spawnProcess, file, args, options) {
  return new Promise((resolve, reject) => {
    let child;
    try { child = spawnProcess(file, args, options); }
    catch (error) { reject(error); return; }
    child.once("error", reject);
    child.once("spawn", () => { child.unref?.(); resolve(); });
  });
}

function appendLaunch(dataDir, receipt) {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, "external-tool-launches.jsonl");
  fs.appendFileSync(file, `${JSON.stringify(receipt)}\n`);
  if (fs.statSync(file).size > 200000) {
    const lines = fs.readFileSync(file, "utf8").trim().split(/\n/).slice(-100);
    fs.writeFileSync(file, `${lines.join("\n")}\n`);
  }
}

async function launch(dataDir, toolId, actionId, deps = {}) {
  const platform = deps.platform || process.platform;
  const catalog = loadCatalog(dataDir);
  const tool = catalog.tools.find((item) => item.id === toolId);
  if (!tool) throw fail("tool_not_found", 404);
  if (tool.confidence === "low" || tool.status === "pending") throw fail("tool_not_launchable", 409);
  const action = tool.actions.find((item) => item.id === actionId);
  if (!action) throw fail("action_not_found", 404);
  const receipt = {
    at: new Date().toISOString(),
    toolId,
    actionId,
    kind: action.kind,
    target: action.target || action.cwd,
    platform,
    executed: false,
    reason: "not_windows",
  };
  if (platform !== "win32") {
    appendLaunch(dataDir, receipt);
    return receipt;
  }
  const plan = winPlan(action, deps.env || process.env);
  try {
    if (plan.explorer) await (deps.openInExplorer || openInExplorer)(plan.path, true, deps.spawn || spawn);
    else await runSpawn(deps.spawn || spawn, plan.file, plan.args, plan.options);
  } catch (error) {
    receipt.reason = "spawn_failed";
    receipt.error = String(error.message || error).slice(0, 180);
    appendLaunch(dataDir, receipt);
    throw fail("launch_failed", 500);
  }
  receipt.executed = true;
  receipt.reason = "started";
  appendLaunch(dataDir, receipt);
  return receipt;
}

module.exports = {
  CATEGORIES,
  COMMANDS,
  SEED_FILE,
  loadCatalog,
  saveTool,
  removeTool,
  launch,
  localUrl,
  windowsPath,
};
