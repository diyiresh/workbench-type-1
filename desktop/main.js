"use strict";

const { app, BaseWindow, BrowserWindow, WebContentsView, ipcMain, shell, Menu, screen } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const focus = require("../lib/focus");

const PORT = Number(process.env.PORT || 3780);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const ROOT = path.join(__dirname, "..");

let serverChild = null;
let win = null;
let mainView = null;
let paneView = null;
let paneBar = null;
let petWin = null;
let paneOpen = false;
let paneUrl = "";

function today() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function spokenPath() {
  return path.join(app.getPath("userData"), "jarvis-spoken.json");
}

function lastSpoken() {
  try { return JSON.parse(fs.readFileSync(spokenPath(), "utf8")).date || ""; } catch { return ""; }
}

function markSpoken(date) {
  fs.mkdirSync(path.dirname(spokenPath()), { recursive: true });
  fs.writeFileSync(spokenPath(), JSON.stringify({ date }));
}

function prefs(preload) {
  return { preload, contextIsolation: true, nodeIntegration: false, sandbox: true };
}

function layout() {
  if (!win || !mainView) return;
  const bounds = win.getContentBounds();
  const paneWidth = paneOpen ? Math.min(480, Math.max(320, Math.round(bounds.width * 0.38))) : 0;
  const bar = paneOpen ? 42 : 0;
  mainView.setBounds({ x: 0, y: 0, width: Math.max(0, bounds.width - paneWidth), height: bounds.height });
  paneBar.setBounds({ x: bounds.width - paneWidth, y: 0, width: paneWidth, height: bar });
  paneView.setBounds({ x: bounds.width - paneWidth, y: bar, width: paneWidth, height: Math.max(0, bounds.height - bar) });
  paneBar.setVisible(paneOpen);
  paneView.setVisible(paneOpen);
}

function openPane(raw) {
  const decision = focus.routeLink(raw, { pageOrigin: ORIGIN });
  if (decision.action !== "pane") return;
  paneOpen = true;
  paneUrl = decision.url;
  layout();
  paneView.webContents.loadURL(decision.url);
  paneBar.webContents.send("pane-url", decision.url);
}

function closePane() {
  paneOpen = false;
  paneUrl = "";
  layout();
}

function showMain(hash) {
  if (win) { win.show(); win.focus(); }
  const target = hash && String(hash).startsWith("#") ? hash : "#home/all";
  const script = `location.hash = ${JSON.stringify(target)}`;
  if (mainView.webContents.getURL().startsWith(ORIGIN)) mainView.webContents.executeJavaScript(script);
  else mainView.webContents.loadURL(ORIGIN + "/" + target);
}

function hardenMain(contents) {
  contents.setWindowOpenHandler(({ url }) => {
    const decision = focus.routeLink(url, { pageOrigin: ORIGIN });
    if (decision.action === "pane") openPane(decision.url);
    return { action: "deny" };
  });
  contents.on("will-navigate", (event, url) => {
    const decision = focus.routeLink(url, { pageOrigin: ORIGIN });
    if (decision.action === "pane") {
      event.preventDefault();
      openPane(decision.url);
    } else if (decision.action === "ignore") event.preventDefault();
  });
}

function hardenPane(contents) {
  contents.setWindowOpenHandler(({ url }) => {
    const decision = focus.routeLink(url, { pageOrigin: ORIGIN });
    if (decision.action === "internal") showMain(new URL(decision.url).hash || "#home/all");
    else if (decision.action === "pane") contents.loadURL(decision.url);
    return { action: "deny" };
  });
  contents.on("will-navigate", (event, url) => {
    const decision = focus.routeLink(url, { pageOrigin: ORIGIN });
    if (decision.action === "ignore") event.preventDefault();
    else if (decision.action === "internal") {
      event.preventDefault();
      showMain(new URL(decision.url).hash || "#home/all");
    }
  });
  contents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
}

function ensurePet() {
  if (petWin) { petWin.show(); return; }
  const area = screen.getPrimaryDisplay().workArea;
  petWin = new BrowserWindow({
    width: 220,
    height: 280,
    x: area.x + area.width - 240,
    y: area.y + area.height - 320,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: prefs(path.join(__dirname, "preload-pet.js")),
  });
  petWin.setAlwaysOnTop(true, "floating");
  petWin.loadFile(path.join(__dirname, "pet.html"));
  petWin.on("closed", () => { petWin = null; });
}

function speak(text) {
  if (process.platform === "win32") {
    spawn("powershell.exe", focus.windowsTtsArgs(text), { windowsHide: true, stdio: "ignore" });
    return;
  }
  if (petWin) petWin.webContents.send("speak", text);
}

async function readCompanion() {
  const response = await fetch(ORIGIN + "/api/state");
  if (!response.ok) return focus.companionFrom({});
  const state = await response.json();
  return focus.companionFrom(state.meta && state.meta.companion);
}

async function greet(settings) {
  if (!focus.shouldSpeak({ settings, today: today(), lastSpokenDate: lastSpoken() })) return;
  if (settings.speakMode !== "always") markSpoken(today());
  speak(focus.GREETING);
}

function wireIpc() {
  ipcMain.on("open-link", (_event, payload) => {
    const decision = focus.routeLink(payload && payload.url, { pageOrigin: ORIGIN, explicitSystem: payload && payload.explicitSystem === true });
    if (decision.action === "pane") openPane(decision.url);
    else if (decision.action === "system") shell.openExternal(decision.url);
    else if (decision.action === "internal") showMain(new URL(decision.url).hash);
  });
  ipcMain.handle("open-external", (_event, raw) => {
    const decision = focus.routeLink(raw, { pageOrigin: ORIGIN, explicitSystem: true });
    if (decision.action !== "system") return { ok: false };
    shell.openExternal(decision.url);
    return { ok: true };
  });
  ipcMain.handle("companion-apply", (_event, patch) => {
    const next = focus.applyCompanion({}, patch || {});
    try { app.setLoginItemSettings({ openAtLogin: next.autostart }); } catch { /* not supported on this platform */ }
    if (next.enabled) ensurePet();
    else if (petWin) petWin.hide();
    return { ok: true, autostart: next.autostart };
  });
  ipcMain.on("pane-close", closePane);
  ipcMain.on("pane-system", () => {
    const decision = focus.routeLink(paneUrl, { pageOrigin: ORIGIN, explicitSystem: true });
    if (decision.action === "system") shell.openExternal(decision.url);
  });
  ipcMain.on("pet-action", (_event, action) => {
    if (action === "home") showMain("#home/all");
    else if (action === "focus") showMain("#reports/pain");
    else if (action === "close" && petWin) petWin.hide();
    else if (action === "mute") {
      fetch(ORIGIN + "/api/meta", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companion: { mutedDate: today() } }),
      }).catch(() => {});
    }
  });
}

async function boot() {
  const started = await focus.ensureWorkbench({
    port: PORT,
    spawn() {
      serverChild = spawn(process.execPath, [path.join(ROOT, "server.js")], {
        cwd: ROOT,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", HOST: "127.0.0.1", PORT: String(PORT) },
        stdio: "inherit",
      });
      return serverChild;
    },
    async wait() {
      for (let attempt = 0; attempt < 50; attempt += 1) {
        if (await focus.probeWorkbench(PORT) === "workbench") return "workbench";
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      return "down";
    },
  });
  if (started.child) serverChild = started.child;

  win = new BaseWindow({ width: 1280, height: 840, minWidth: 960, minHeight: 640, title: "统筹工作台", backgroundColor: "#071426", show: false });
  mainView = new WebContentsView({ webPreferences: prefs(path.join(__dirname, "preload-shell.js")) });
  paneBar = new WebContentsView({ webPreferences: prefs(path.join(__dirname, "preload-pane.js")) });
  paneView = new WebContentsView({ webPreferences: { ...prefs(path.join(__dirname, "preload-shell.js")), partition: "persist:bench-side" } });
  win.contentView.addChildView(mainView);
  win.contentView.addChildView(paneBar);
  win.contentView.addChildView(paneView);
  hardenMain(mainView.webContents);
  hardenPane(paneView.webContents);
  paneBar.webContents.loadFile(path.join(__dirname, "pane-bar.html"));
  win.on("resize", layout);
  closePane();
  mainView.webContents.once("did-finish-load", () => win.show());
  await mainView.webContents.loadURL(ORIGIN + "/");

  const settings = await readCompanion();
  try { app.setLoginItemSettings({ openAtLogin: settings.autostart }); } catch { /* platform */ }
  if (settings.enabled) {
    ensurePet();
    petWin.webContents.once("did-finish-load", () => greet(settings));
  }
}

app.setAppUserModelId("ben.workbench.desktop");
const locked = app.requestSingleInstanceLock();
if (!locked) app.quit();
else {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: "工作台", submenu: [
      { label: "重新加载", click: () => mainView && mainView.webContents.reload() },
      { label: "用系统浏览器打开侧栏", click: () => { if (paneUrl) shell.openExternal(paneUrl); } },
    ] },
  ]));
  app.on("second-instance", () => { if (win) { win.show(); win.focus(); } });
  app.whenReady().then(() => { wireIpc(); return boot(); }).catch((error) => {
    console.error(error);
    app.quit();
  });
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", () => { if (serverChild && !serverChild.killed) serverChild.kill(); });
}
