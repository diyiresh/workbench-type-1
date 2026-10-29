"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("paneBar", {
  onUrl(listener) { ipcRenderer.on("pane-url", (_event, url) => listener(url)); },
  close() { ipcRenderer.send("pane-close"); },
  openSystem() { ipcRenderer.send("pane-system"); },
});
