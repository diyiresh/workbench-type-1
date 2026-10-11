"use strict";

const fs = require("fs");
const path = require("path");
const { generateReport } = require("./lib/report");

const STORE = path.join(__dirname, "data", "store.json");

function load() {
  if (!fs.existsSync(STORE)) {
    console.error("还没有 data/store.json。请先运行 node server.js 或双击 start.bat。");
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(STORE, "utf8"));
}

function statusLabel(s) {
  return { todo: "待启动", doing: "进行中", review: "待核验", blocked: "受阻", done: "已完成", archive: "已归档" }[s] || s;
}

const cmd = process.argv[2] || "brief";
const store = load();

if (cmd === "brief") {
  const doing = (store.tasks || []).filter((t) => t.status === "doing" || t.status === "review");
  console.log(`# ${store.meta.title} 简报`);
  console.log(`更新于 ${store.meta.updatedAt}`);
  console.log("");
  console.log("## 在办");
  for (const t of doing) {
    console.log(`- [${t.progress}%] ${t.title}`);
    console.log(`  下一步：${t.nextAction}`);
  }
  console.log("");
  console.log("## 钉住的记忆");
  for (const m of (store.memories || []).filter((x) => x.pinned)) {
    console.log(`- ${m.title}`);
  }
} else if (cmd === "tasks") {
  for (const t of store.tasks || []) {
    console.log(`${statusLabel(t.status).padEnd(6)} ${String(t.progress).padStart(3)}%  ${t.title}`);
  }
} else if (cmd === "weekly" || cmd === "monthly" || cmd === "retro") {
  const report = generateReport(store, cmd);
  console.log(report.body);
} else {
  console.log("用法: node cli.js [brief|tasks|weekly|monthly|retro]");
}
