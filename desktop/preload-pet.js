"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("jarvis", {
  act(action) { ipcRenderer.send("pet-action", action); },
  onSpeak(listener) { ipcRenderer.on("speak", (_event, text) => listener(text)); },
});
