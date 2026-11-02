"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "bench-external-tools-"));
process.env.BENCH_DATA_DIR = root;
const tools = require("../lib/external-tools");
const { createServer } = require("../server");

function fakeSpawn(store) {
  return (command, args, options) => {
    store.push({ command, args, options });
    const child = new EventEmitter();
    child.unref = () => {};
    queueMicrotask(() => child.emit("spawn"));
    return child;
  };
}

(async () => {
  const catalog = tools.loadCatalog(root);
  const byId = Object.fromEntries(catalog.tools.map((tool) => [tool.id, tool]));
  assert.equal(byId.comfyui.actions.find((action) => action.id === "start").target, "D:\\ComfyUI_windows_portable\\start_comfyui.bat");
  assert.ok(byId.comfyui.actions.some((action) => action.target === "http://127.0.0.1:8188"));
  assert.ok(byId.comfyui.actions.some((action) => action.target === "http://127.0.0.1:8190"));
  assert.equal(byId["docker-desktop"].actions[0].target, "C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe");
  assert.ok(byId["ai-stack"].actions.some((action) => action.command === "docker-compose-up" && action.cwd === "D:\\ai-stack"));
  assert.ok(byId["ai-stack"].actions.some((action) => action.target === "http://localhost:3002"));
  assert.ok(byId["ai-stack"].actions.some((action) => action.target === "http://localhost:11434"));
  assert.equal(byId.litellm.actions[0].target, "D:\\litellm-env\\Scripts\\litellm.exe");
  assert.equal(byId.uvr.actions.find((action) => action.kind === "start-file").target, "C:\\UVR\\UVR.exe");
  assert.equal(byId["audio-board"].actions[0].target, "D:\\tools\\音频处理看板.html");
  assert.ok(byId.stemdeck.actions.some((action) => action.target.endsWith("StemDeck.exe")));
  assert.ok(byId.stemdeck.actions.some((action) => action.target.endsWith("start-with-proxy.bat")));
  assert.equal(byId.ghidra.actions.find((action) => action.kind === "start-file").target, "D:\\tools\\ghidra_12.1.4_PUBLIC\\ghidraRun.bat");
  assert.equal(byId.md2doc.actions.find((action) => action.kind === "start-file").target, "D:\\tools\\md2doc-main\\运行.bat");
  assert.ok(byId.paperclip.actions.some((action) => action.command === "pnpm-dev" && action.cwd === "D:\\tools\\paperclip"));
  assert.ok(byId.rea.actions.some((action) => action.command === "npm-start" && action.cwd === "D:\\tools\\rea"));
  assert.equal(byId.workbuddy.actions[0].target, "%LOCALAPPDATA%\\Programs\\WorkBuddy\\WorkBuddy.exe");
  assert.equal(byId["workbuddy-ai"].actions[0].target, "D:\\Program Files\\workbuddy international\\WorkBuddyAI\\WorkBuddyAI.exe");
  assert.equal(byId.cursor.actions[0].target, "D:\\Program Files\\Cursor\\Cursor.exe");
  assert.deepEqual(byId.codex.actions[0], { id: "folder", kind: "open-folder", target: "%LOCALAPPDATA%\\OpenAI\\Codex" });
  assert.ok(byId.workbench.actions.some((action) => action.target.endsWith("\\start.bat")));
  assert.ok(byId.workbench.actions.some((action) => action.target === "http://127.0.0.1:3780"));
  assert.equal(byId.sjzz.actions.length, 1);
  assert.equal(byId.sjzz.actions[0].kind, "open-folder");
  assert.equal(byId.retellloop.actions.length, 1);
  assert.equal(byId.retellloop.actions[0].target, "http://127.0.0.1:43123");
  assert.match(byId.retellloop.location, /Happy-family-happy-English/);
  assert.equal(byId.vaultrag.actions[0].target, "http://127.0.0.1:48731");
  assert.equal(byId["ollama-native"].actions.length, 0);
  assert.equal(byId["ollama-native"].status, "pending");
  assert.match(byId["ollama-native"].note, /可能已卸/);
  for (const id of ["meetily", "mimouse", "doubao", "coze", "cc-switch", "obsidian", "blender", "capcut", "markitdown", "poppler", "wb-migrate", "cost-quality"]) {
    assert.equal(byId[id].actions.length, 0, id);
    assert.equal(byId[id].status, "pending", id);
  }
  assert.equal(byId["deepseek-harness"].category, "dev");
  assert.equal(byId["deepseek-harness"].confidence, "high");
  assert.equal(byId["deepseek-harness"].status, "ready");
  assert.equal(byId["deepseek-harness"].location, "C:\\Users\\Benjamin\\deepseek-harness");
  assert.deepEqual(byId["deepseek-harness"].actions.map((action) => [action.kind, action.target]), [
    ["open-folder", "C:\\Users\\Benjamin\\deepseek-harness"],
    ["start-file", "C:\\Users\\Benjamin\\deepseek-harness\\start-webui.bat"],
  ]);
  assert.match(byId["deepseek-harness"].note, /@deepseek-ai\/dsh/);
  assert.ok(byId.remotion.actions.some((action) => action.command === "npm-run-dev"));
  assert.equal(byId.remotion.status, "review");

  const saved = tools.saveTool(root, {
    expectedRevision: 0,
    name: "坏例子",
    category: "dev",
    confidence: "high",
    status: "ready",
    actions: [
      { kind: "open-url", target: "https://evil.example/steal" },
      { kind: "command", command: "calc", cwd: "D:\\tools\\rea" },
      { kind: "start-file", target: "D:\\tools\\ok.bat & calc" },
      { kind: "open-folder", target: "D:\\tools\\rea" },
    ],
  });
  const custom = saved.tools.find((tool) => tool.name === "坏例子");
  assert.equal(custom.source, "local");
  assert.deepEqual(custom.actions.map((action) => action.kind), ["open-folder"]);
  assert.throws(() => tools.saveTool(root, { ...custom, expectedRevision: 0, name: "过期" }), /revision_conflict/);

  const pending = tools.saveTool(root, {
    expectedRevision: saved.revision,
    name: "只记录",
    category: "desktop",
    confidence: "low",
    status: "pending",
    actions: [{ kind: "start-file", target: "D:\\tools\\nope.exe" }],
  });
  assert.equal(pending.tools.find((tool) => tool.name === "只记录").actions.length, 0);

  let spawned = false;
  const recorded = await tools.launch(root, "comfyui", "start", { platform: "linux", spawn() { spawned = true; } });
  assert.equal(spawned, false);
  assert.equal(recorded.executed, false);
  assert.equal(recorded.reason, "not_windows");
  assert.match(fs.readFileSync(path.join(root, "external-tool-launches.jsonl"), "utf8"), /start_comfyui\.bat/);
  await assert.rejects(() => tools.launch(root, "ollama-native", "start", { platform: "win32" }), /tool_not_launchable/);
  await assert.rejects(() => tools.launch(root, "comfyui", "missing", { platform: "linux" }), /action_not_found/);

  const calls = [];
  const started = await tools.launch(root, "comfyui", "start", { platform: "win32", spawn: fakeSpawn(calls) });
  assert.equal(started.executed, true);
  assert.equal(calls[0].command, "cmd.exe");
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[0].options.windowsVerbatimArguments, true);
  assert.equal(calls[0].args.at(-1), 'start "" "D:\\ComfyUI_windows_portable\\start_comfyui.bat"');

  calls.length = 0;
  await tools.launch(root, "workbuddy", "start", {
    platform: "win32",
    env: { LOCALAPPDATA: "C:\\Users\\Benjamin\\AppData\\Local" },
    spawn: fakeSpawn(calls),
  });
  assert.equal(calls[0].args.at(-1), 'start "" "C:\\Users\\Benjamin\\AppData\\Local\\Programs\\WorkBuddy\\WorkBuddy.exe"');
  await assert.rejects(() => tools.launch(root, "workbuddy", "start", {
    platform: "win32",
    env: { LOCALAPPDATA: "C:\\temp&calc" },
    spawn: fakeSpawn([]),
  }), /env_unexpanded|path_rejected/);

  calls.length = 0;
  await tools.launch(root, "sjzz", "folder", { platform: "win32", spawn: fakeSpawn(calls) });
  assert.equal(calls[0].command, "explorer.exe");
  assert.deepEqual(calls[0].args, ["D:\\OneDrive\\Desktop\\Ben_My_Agent\\SJZZ"]);

  calls.length = 0;
  await tools.launch(root, "paperclip", "dev", { platform: "win32", spawn: fakeSpawn(calls) });
  assert.equal(calls[0].args.at(-1), 'cd /d "D:\\tools\\paperclip" && pnpm.cmd dev');
  assert.equal(calls[0].options.shell, false);

  const removed = tools.removeTool(root, "meetily", pending.revision);
  assert.equal(removed.tools.some((tool) => tool.id === "meetily"), false);
  const restored = tools.saveTool(root, { ...byId.meetily, expectedRevision: removed.revision, actions: [] });
  assert.equal(restored.tools.some((tool) => tool.id === "meetily"), true);

  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const listed = await (await fetch(`${base}/api/external-tools`)).json();
    assert.ok(listed.tools.some((tool) => tool.id === "uvr"));
    const launch = await fetch(`${base}/api/external-tools/comfyui/launch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ actionId: "start", command: "calc.exe", target: "C:\\Windows\\System32\\calc.exe" }),
    });
    const body = await launch.json();
    assert.equal(launch.status, 200);
    assert.equal(body.executed, false);
    assert.equal(body.target, "D:\\ComfyUI_windows_portable\\start_comfyui.bat");
    const log = fs.readFileSync(path.join(root, "external-tool-launches.jsonl"), "utf8");
    assert.equal(log.includes("calc"), false);
    const blocked = await fetch(`${base}/api/external-tools/ollama-native/launch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ actionId: "start" }),
    });
    assert.equal(blocked.status, 409);
  } finally {
    server.close();
  }

  const nav = await import("../public/js/navigation.mjs");
  assert.equal(nav.NAVIGATION.some((item) => item.id === "tools" && item.name === "外部工具"), true);
  assert.equal(nav.resolveRoute("#tools/pending").hash, "#tools/pending");
  console.log("External tools catalog, launch guard and route checks passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
