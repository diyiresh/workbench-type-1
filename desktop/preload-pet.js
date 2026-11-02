"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("jarvis", {
  drag(phase) { ipcRenderer.send("pet-drag", phase); },
  act(action) { ipcRenderer.send("pet-action", action); },
  onSpeak(listener) { ipcRenderer.on("speak", (_event, text) => listener(text)); },
});
