"use strict";

const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const vendor = path.join(root, "public", "vendor", "workbench.js");
if (!fs.existsSync(vendor)) {
  const built = spawnSync(process.execPath, [path.join(root, "scripts", "build-assets.cjs")], { cwd: root, stdio: "inherit" });
  if (built.status !== 0) process.exit(built.status || 1);
}
const candidates = [
  path.join(root, "desktop", "node_modules", "electron"),
  path.join(root, "node_modules", "electron"),
];

let electronPath = "";
for (const candidate of candidates) {
  try {
    electronPath = require(candidate);
    break;
  } catch {
    electronPath = "";
  }
}

if (!electronPath) {
  console.error("未找到 Electron。在仓库根目录执行：npm install --prefix desktop");
  process.exit(1);
}

const child = spawn(electronPath, [path.join(root, "desktop", "main.js")], { stdio: "inherit" });
child.on("exit", (code) => process.exit(code || 0));
