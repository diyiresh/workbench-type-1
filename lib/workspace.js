"use strict";

const fs = require("fs");
const path = require("path");

const SHARED_DIRS = ["skills", "memory", "context"];
const IGNORED_PROJECT_DIRS = new Set([".workbench", "skills", "memory", "context", "tmp", "__pycache__", "node_modules"]);

function configPath(root) {
  return path.join(root, ".workbench", "workspace.json");
}

function defaultConfig(root) {
  return {
    version: "1.0",
    name: "Ben_My_Agent 共享 AI 工作区",
    rootPath: root,
    shared: {
      skills: path.join(root, "skills"),
      memory: path.join(root, "memory"),
      context: path.join(root, "context"),
      protocol: path.join(root, "WORKSPACE.md"),
    },
    projects: {
      roots: [root],
      exclude: [...IGNORED_PROJECT_DIRS],
      rule: "每个独立项目保留自己的目录；项目成果、任务和讨论回到工作台项目房间。",
    },
    agents: {
      sharedRead: true,
      projectWrite: true,
      privateFiles: "user-controlled-redacted-only",
    },
  };
}

function ensureConfig(root) {
  const file = configPath(root);
  const config = defaultConfig(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(config, null, 2), "utf8");
  return config;
}

function listProjects(config) {
  const root = path.resolve(config.rootPath);
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !config.projects.exclude.includes(entry.name) && !entry.name.startsWith("."))
    .map((entry) => {
      const fullPath = path.join(root, entry.name);
      return { id: entry.name, name: entry.name, path: fullPath, exists: true };
    });
}

function snapshot(root) {
  const config = ensureConfig(root);
  return {
    ...config,
    shared: Object.fromEntries(Object.entries(config.shared).map(([key, value]) => [key, { path: value, exists: fs.existsSync(value) }])),
    projects: { ...config.projects, discovered: listProjects(config) },
  };
}

function sharedInstruction(root) {
  const state = snapshot(root);
  return [
    `共享工作区根目录：${state.rootPath}`,
    `共享 skills：${state.shared.skills.path}`,
    `共享 memory：${state.shared.memory.path}`,
    `共享 context：${state.shared.context.path}`,
    "先读取共享层，再读取当前项目；不要把项目专属事实写入共享 memory。",
  ].join("\n");
}

module.exports = { SHARED_DIRS, configPath, defaultConfig, ensureConfig, listProjects, snapshot, sharedInstruction };
