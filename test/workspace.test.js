"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const workspace = require("../lib/workspace");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "bench-workspace-"));
try {
  fs.mkdirSync(path.join(root, "project-a"));
  fs.mkdirSync(path.join(root, "skills"));
  const state = workspace.snapshot(root);
  assert.strictEqual(state.rootPath, root);
  assert.strictEqual(state.shared.skills.exists, true);
  assert.ok(state.projects.discovered.some((item) => item.id === "project-a"));
  assert.ok(!state.projects.discovered.some((item) => item.id === "skills"));
  assert.ok(fs.existsSync(workspace.configPath(root)));
  console.log("Workspace shared-root test passed");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
