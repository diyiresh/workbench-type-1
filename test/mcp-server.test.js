"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "bench-mcp-"));
process.env.BENCH_DATA_DIR = root;
const state = require("../lib/default-store").buildDefaultStore();
state.tasks = [{ id: "t-mcp", title: "MCP fixture task", status: "doing", progress: 10, ownerAgentId: "cursor", nextAction: "start" }];
state.inbox = [{ id: "in-mcp", toAgentId: "cursor", from: "chairman", body: "fixture instruction", status: "queued", createdAt: "2026-11-20T00:00:00.000Z" }];
fs.writeFileSync(path.join(root, "store.json"), JSON.stringify(state));
const script = path.join(__dirname, "..", "mcp", "workbench-mcp.js");

function client(env) {
  const child = spawn(process.execPath, [script], { env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"] });
  let buffer = "", next = 1;
  const waiting = new Map();
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let at;
    while ((at = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, at); buffer = buffer.slice(at + 1);
      const message = JSON.parse(line);
      waiting.get(message.id)?.(message); waiting.delete(message.id);
    }
  });
  const request = (method, params) => new Promise((resolve) => { const id = next++; waiting.set(id, resolve); child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"); });
  const notify = (method) => child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method }) + "\n");
  const tool = async (name, args = {}) => (await request("tools/call", { name, arguments: args })).result;
  return { child, request, notify, tool, close: () => child.kill() };
}

const { createServer } = require("../server");
const server = createServer().listen(0, "127.0.0.1", async () => {
  const BENCH_URL = `http://127.0.0.1:${server.address().port}`;
  const ledger = () => JSON.parse(fs.readFileSync(path.join(root, "store.json"), "utf8"));
  const c = client({ BENCH_URL, BENCH_AGENT_ID: "cursor" });
  const readOnly = client({ BENCH_URL, BENCH_AGENT_ID: "" });
  try {
    const init = await c.request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } });
    assert.strictEqual(init.result.protocolVersion, "2025-06-18");
    assert.strictEqual(init.result.serverInfo.name, "workbench");
    c.notify("notifications/initialized");
    assert.deepStrictEqual((await c.request("ping")).result, {});
    assert.strictEqual((await c.request("resources/list")).error.code, -32601);

    const { tools } = (await c.request("tools/list")).result;
    assert.deepStrictEqual(tools.map((t) => t.name).sort(), ["workbench_brief", "workbench_checkpoint", "workbench_claim", "workbench_decisions", "workbench_handoff", "workbench_inbox", "workbench_inbox_update", "workbench_submit"]);
    for (const t of tools) assert.ok(!("agentId" in (t.inputSchema.properties || {})), `${t.name} must not accept an agent identity`);

    const brief = await c.tool("workbench_brief");
    assert.strictEqual(brief.isError, false);
    assert.match(brief.content[0].text, /MCP fixture task/);
    assert.match(brief.content[0].text, /fixture instruction/);

    const checkpoint = await c.tool("workbench_checkpoint", { taskId: "t-mcp", progress: 40, status: "doing", nextAction: "write tests", notes: "via MCP" });
    assert.strictEqual(checkpoint.isError, false);
    const task = ledger().tasks.find((t) => t.id === "t-mcp");
    assert.deepStrictEqual([task.progress, task.notes], [40, "via MCP"]);
    assert.match(ledger().events[0].text, /^cursor 更新「MCP fixture task」/, "checkpoints are attributed to the configured agent");

    const skip = await c.tool("workbench_inbox_update", { id: "in-mcp", status: "done" });
    assert.strictEqual(skip.isError, true, "the instruction lifecycle cannot jump to done");
    for (const status of ["ack", "doing", "done"]) assert.strictEqual((await c.tool("workbench_inbox_update", { id: "in-mcp", status })).isError, false);
    assert.strictEqual(ledger().inbox.find((m) => m.id === "in-mcp").status, "done");

    const missing = await c.tool("workbench_claim", { runId: "dr-missing" });
    assert.strictEqual(missing.isError, true);
    assert.match(missing.content[0].text, /400/);
    const unknown = await c.request("tools/call", { name: "workbench_delete_everything", arguments: {} });
    assert.strictEqual(unknown.error.code, -32602);

    await readOnly.request("initialize", { protocolVersion: "1999-01-01" }).then((r) => assert.strictEqual(r.result.protocolVersion, "2025-06-18", "unknown versions get the latest supported"));
    assert.strictEqual((await readOnly.tool("workbench_decisions")).isError, false, "read tools work without an identity");
    const anonymous = await readOnly.tool("workbench_checkpoint", { taskId: "t-mcp", nextAction: "x", notes: "y" });
    assert.strictEqual(anonymous.isError, true, "writes need BENCH_AGENT_ID");
    assert.match(anonymous.content[0].text, /BENCH_AGENT_ID/);

    const remote = spawnSync(process.execPath, [script], { env: { ...process.env, BENCH_URL: "http://192.168.1.20:3780" }, input: "", encoding: "utf8" });
    assert.strictEqual(remote.status, 2, "the server refuses a workbench that is not on this machine");
    console.log("Workbench MCP: initialize/version negotiation, ping, tool list without identity parameters, brief, attributed checkpoint, one-step instruction lifecycle, claim errors, read-only mode and loopback-only target passed.");
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    c.close(); readOnly.close(); server.close();
  }
});
