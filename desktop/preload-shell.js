"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("benchShell", {
  isDesktop: true,
  openExternal(url) {
    return ipcRenderer.invoke("open-external", String(url || ""));
  },
  applyCompanion(settings) {
    return ipcRenderer.invoke("companion-apply", settings || {});
  },
});

document.addEventListener("click", (event) => {
  if (event.defaultPrevented || event.button !== 0) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const anchor = event.target && event.target.closest ? event.target.closest("a[href]") : null;
  if (!anchor) return;
  let url;
  try { url = new URL(anchor.href, location.href); } catch { return; }
  if (url.protocol !== "http:" && url.protocol !== "https:") return;
  if (url.origin === location.origin) return;
  event.preventDefault();
  ipcRenderer.send("open-link", { url: url.href, explicitSystem: anchor.dataset.systemBrowser === "true" });
}, true);
