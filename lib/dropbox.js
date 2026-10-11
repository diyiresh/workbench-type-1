"use strict";
const { inactive } = require("./archive");

// 文件报送通道（P4）：给不会跑 HTTP 的 agent（豆包、天禧等）用的收发窗口。
// 约定：把一个 JSON 文件丢进 data/dropbox/ 即完成一次打卡——
// {
//   "agentId": "doubao",
//   "taskId": "t-gov-pipeline",        （可选；不存在则按 title 新建任务）
//   "title": "新任务标题",              （taskId 缺省时用于建新任务）
//   "progress": 40,
//   "status": "doing",                 （todo/doing/review/blocked/done）
//   "nextAction": "下一步（人话）",
//   "notes": "这段实际做了什么"
// }
// 处理成功 → 移入 processed/；解析或写库失败 → 移入 failed/ 并附 .err.txt 保留现场。

const fs = require("fs");
const path = require("path");
const { ingestBrief } = require("./brief-hub");

function processBody(store, body, { id, nowIso }) {
  if (body.kind === "brief") return { kind: "brief", ...ingestBrief(store, body, { id, nowIso }) };
  if (!body.agentId) throw new Error("缺少 agentId 字段");

  let task = body.taskId ? (store.tasks || []).find((t) => t.id === body.taskId) : null;
  if(inactive(task))throw new Error("record_paused_or_archived");
  if (!task) {
    task = {
      id: id("t"),
      title: body.title || "报送来的新任务",
      status: "doing",
      priority: "p2",
      progress: 0,
      ownerAgentId: body.agentId,
      createdAt: nowIso(),
    };
    (store.tasks = store.tasks || []).unshift(task);
  }
  if (typeof body.progress === "number") task.progress = Math.max(0, Math.min(100, body.progress));
  if (body.status) task.status = body.status;
  if (body.nextAction) task.nextAction = String(body.nextAction);
  if (body.notes) task.notes = String(body.notes);
  task.updatedAt = nowIso();

  store.events.unshift({
    id: id("ev"),
    type: "checkpoint",
    text: `[文件报送] ${body.agentId} 更新「${task.title}」→ ${task.progress}% ${task.status}`,
    agentId: body.agentId,
    createdAt: nowIso(),
  });
  return { kind: "checkpoint", task };
}

function start({ DATA, readStore, writeStore, id, nowIso }) {
  const dir = path.join(DATA, "dropbox");
  const done = path.join(dir, "processed");
  const fail = path.join(dir, "failed");
  for (const d of [dir, done, fail]) fs.mkdirSync(d, { recursive: true });

  function scan() {
    let files = [];
    try {
      files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
    } catch {
      return;
    }
    for (const f of files) {
      const full = path.join(dir, f);
      try {
        const body = JSON.parse(fs.readFileSync(full, "utf8"));
        const store = readStore();
        processBody(store, body, { id, nowIso });
        writeStore(store);
        fs.renameSync(full, path.join(done, `${Date.now()}-${f}`));
      } catch (err) {
        try {
          fs.renameSync(full, path.join(fail, `${Date.now()}-${f}`));
          fs.writeFileSync(path.join(fail, `${Date.now()}-${f}.err.txt`), String((err && err.message) || err), "utf8");
        } catch {}
      }
    }
  }

  setInterval(scan, 20000);
  setTimeout(scan, 3000);
  return { scan };
}

module.exports = { start, processBody };
