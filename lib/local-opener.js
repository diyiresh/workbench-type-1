"use strict";

const { spawn } = require("child_process");

function explorerArgsFor(target, isDirectory) {
  // A bare file path opens the associated application. /select, opens Explorer
  // at its parent folder and highlights the registered file instead.
  return isDirectory ? [target] : ["/select,", target];
}

function openInExplorer(target, isDirectory, spawnProcess = spawn) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      // Keep the Explorer window visible and foregroundable. Detached/hidden
      // launches may succeed at process level while leaving no visible folder.
      child = spawnProcess("explorer.exe", explorerArgsFor(target, isDirectory), { stdio: "ignore" });
    } catch (err) {
      reject(err);
      return;
    }
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

module.exports = { explorerArgsFor, openInExplorer };
