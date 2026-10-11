"use strict";
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { root, entry, product, env } = require("../lib/workbuddy-profile").profile();
if (!fs.existsSync(product)) throw new Error("WorkBuddy product configuration is missing: " + product);
if (!fs.existsSync(entry) || process.argv.includes("--repair")) {
  console.log("Installing or repairing the login runtime...");
  const candidates = [path.dirname(process.execPath), ...(process.env.PATH || "").split(path.delimiter)]
    .map(dir => path.join(dir.replace(/^"|"$/g, ""), "node_modules", "npm", "bin", "npm-cli.js"));
  const npmCli = candidates.find(file => fs.existsSync(file));
  if (!npmCli) throw new Error("npm-cli.js was not found; install Node.js with npm");
  const install = spawnSync(process.execPath, [npmCli, "install", "--prefix", root, "@tencent-ai/codebuddy-code@2.163.0", "--no-audit", "--no-fund"], { stdio: "inherit" });
  if (install.error || install.status !== 0) throw new Error("Login runtime installation failed");
}
if (!fs.existsSync(entry)) throw new Error("Login entry is missing after installation: " + entry);
const check = process.argv.includes("--check");
console.log("Login runtime found. " + (check ? "Checking version..." : "Enter /login, select Chinese site, and keep this terminal open during authorization."));
const result = spawnSync(process.execPath, [entry, ...(check ? ["--version"] : [])], { stdio: "inherit", env });
if (result.error) throw result.error;
process.exitCode = result.status === null ? 1 : result.status;
