#!/usr/bin/env node
"use strict";

// Workbench MCP server (stdio, newline-delimited JSON-RPC 2.0). Every tool calls the local workbench
// HTTP API, so the server-side gates still apply: loopback-only routes, attempt/claim identity,
// independent review, paused projects, Start Writing. The agent identity comes from BENCH_AGENT_ID,
// never from tool arguments. Configure per agent, e.g.
//   { "command": "node", "args": ["<repo>/mcp/workbench-mcp.js"], "env": { "BENCH_AGENT_ID": "cursor" } }
const readline = require("readline");
const { version } = require("../package.json");

const BASE = (process.env.BENCH_URL || "http://127.0.0.1:3780").replace(/\/$/, "");
const AGENT = String(process.env.BENCH_AGENT_ID || "").trim();
const PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const LIFECYCLE = { queued: "ack", ack: "doing", doing: "done" };

if (!/^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(BASE)) {
  process.stderr.write(`workbench-mcp: BENCH_URL must point at this machine, got ${BASE}\n`);
  process.exit(2);
}

class ToolError extends Error {}

async function call(route, { method = "GET", body } = {}) {
  let response;
  try {
    response = await fetch(BASE + route, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  } catch (error) {
    throw new ToolError(`工作台未运行或无法连接（${BASE}）：${error.message}`);
  }
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) throw new ToolError(`${method} ${route} → ${response.status} ${typeof data === "object" && data ? data.error || JSON.stringify(data) : data}${data?.reason ? `（${data.reason}）` : ""}`);
  return data;
}

function needAgent() {
  if (!AGENT) throw new ToolError("此工具需要成员身份：在 MCP 配置中设置 BENCH_AGENT_ID（例如 cursor、codex、workbuddy）。");
  return AGENT;
}

const str = (description, extra = {}) => ({ type: "string", description, ...extra });

const TOOLS = [
  {
    name: "workbench_brief",
    description: "Read-only brief: tasks in progress or awaiting verification, this agent's queued instructions, and what is waiting on the chairman.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    async run() {
      const [state, decisions, inbox] = await Promise.all([
        call("/api/state?slice=ui"),
        call("/api/decisions"),
        AGENT ? call(`/api/inbox?agentId=${encodeURIComponent(AGENT)}&status=queued`) : Promise.resolve([]),
      ]);
      const doing = (state.tasks || []).filter((t) => !t.archived && ["doing", "review", "blocked"].includes(t.status));
      const lines = [`# ${state.meta?.title || "工作台"} · ${state.meta?.updatedAt || ""}`, AGENT ? `成员：${AGENT}` : "未设置 BENCH_AGENT_ID（只读）", "", "## 在办任务"];
      for (const t of doing) lines.push(`- [${t.id}] ${t.title} · ${t.status} ${t.progress ?? 0}% · 下一步：${t.nextAction || "—"}`);
      if (!doing.length) lines.push("- 无");
      lines.push("", `## 我的待领指令（${inbox.length}）`);
      for (const m of inbox) lines.push(`- [${m.id}] ${String(m.body).slice(0, 160)}`);
      lines.push("", `## 待董事长决定（${decisions.decisions.length}）`);
      for (const d of decisions.decisions.slice(0, 10)) lines.push(`- ${d.kind} · ${d.title}：${d.detail}`);
      return { text: lines.join("\n"), data: { tasks: doing, inbox, decisions: decisions.decisions } };
    },
  },
  {
    name: "workbench_decisions",
    description: "Read-only list of items waiting on the chairman: executions to reconcile, held results, Start Writing, exhausted retry budgets, failed deliveries, pending reviews.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    async run() {
      const { decisions } = await call("/api/decisions");
      return { text: decisions.map((d) => `${d.severity} · ${d.kind} · ${d.title}：${d.detail}`).join("\n") || "没有待决事项。", data: decisions };
    },
  },
  {
    name: "workbench_checkpoint",
    description: "Record progress on a ledger task after a real piece of work (POST /api/checkpoint). Do not use it to claim work you have not done.",
    inputSchema: {
      type: "object",
      required: ["taskId", "nextAction", "notes"],
      properties: {
        taskId: str("Ledger task id, e.g. t-gov-pipeline"),
        progress: { type: "number", minimum: 0, maximum: 100 },
        status: str("Task status", { enum: ["todo", "doing", "review", "blocked", "done"] }),
        nextAction: str("Next step in plain words"),
        notes: str("What was actually changed in this session"),
      },
      additionalProperties: false,
    },
    async run(args) {
      const task = await call("/api/checkpoint", { method: "POST", body: { ...args, agentId: needAgent() } });
      return { text: `已打卡：${task.title} → ${task.progress}% ${task.status}`, data: task };
    },
  },
  {
    name: "workbench_inbox",
    description: "List this agent's instructions from the chairman (GET /api/inbox).",
    inputSchema: { type: "object", properties: { status: str("Filter", { enum: ["queued", "ack", "doing", "done"] }) }, additionalProperties: false },
    async run({ status } = {}) {
      const list = await call(`/api/inbox?agentId=${encodeURIComponent(needAgent())}${status ? `&status=${status}` : ""}`);
      return { text: list.map((m) => `[${m.id}] ${m.status} · ${String(m.body).slice(0, 200)}`).join("\n") || "没有指令。", data: list };
    },
  },
  {
    name: "workbench_inbox_update",
    description: "Advance one of this agent's instructions one step: queued → ack → doing → done. Skipping steps is refused.",
    inputSchema: { type: "object", required: ["id", "status"], properties: { id: str("Instruction id"), status: str("Next status", { enum: ["ack", "doing", "done"] }) }, additionalProperties: false },
    async run({ id, status }) {
      const agent = needAgent();
      const mine = await call(`/api/inbox?agentId=${encodeURIComponent(agent)}`);
      const message = mine.find((m) => m.id === id);
      if (!message) throw new ToolError("找不到属于本成员的这条指令（可能已归档、暂停或属于其他成员）。");
      if (LIFECYCLE[message.status] !== status) throw new ToolError(`指令当前为 ${message.status}，下一步只能是 ${LIFECYCLE[message.status] || "（已完成）"}。`);
      const updated = await call(`/api/inbox/${encodeURIComponent(id)}`, { method: "PATCH", body: { status } });
      return { text: `指令 ${id} → ${updated.status}`, data: updated };
    },
  },
  {
    name: "workbench_claim",
    description: "Claim this agent's next unlocked stage in a project (POST /api/agents/claim). Returns the assignment with attemptId and claimId, which submit needs. Does not start any other member.",
    inputSchema: { type: "object", required: ["runId"], properties: { runId: str("Project (department run) id"), idempotencyKey: str("Optional key so a retried claim returns the same assignment") }, additionalProperties: false },
    async run({ runId, idempotencyKey }) {
      const { assignment } = await call("/api/agents/claim", { method: "POST", body: { agentId: needAgent(), runId, idempotencyKey } });
      if (!assignment) return { text: "当前没有可领取的阶段：依赖未完成、已被领取或项目暂停。", data: null };
      return { text: `已领取 ${assignment.item?.label || assignment.item?.id}：attemptId=${assignment.attemptId} claimId=${assignment.claimId}\n${assignment.message?.body || assignment.item?.instruction || ""}`, data: assignment };
    },
  },
  {
    name: "workbench_submit",
    description: "Return the result of a claimed stage. Executors pass output; reviewers pass verdict and comment. attemptId and claimId must come from workbench_claim. Reviewers cannot review their own work; full writing still needs the chairman's Start Writing.",
    inputSchema: {
      type: "object",
      required: ["runId", "itemId", "attemptId", "claimId"],
      properties: {
        runId: str("Project id"), itemId: str("Stage id from the assignment"),
        attemptId: str("From workbench_claim"), claimId: str("From workbench_claim"),
        output: str("Executor result"), materials: { type: "array", items: { type: "string" } },
        verdict: str("Reviewer verdict", { enum: ["pass", "reject"] }), comment: str("Reviewer comment"),
      },
      additionalProperties: false,
    },
    async run(args) {
      const agent = needAgent();
      const run = await call(`/api/departments/runs/${encodeURIComponent(args.runId)}`);
      const item = (run.items || []).find((entry) => entry.id === args.itemId);
      if (!item || item.ownerAgentId !== agent || !["doing", "rework"].includes(item.status)) throw new ToolError("阶段未由本成员领取，或状态不允许提交。");
      const identity = { attemptId: args.attemptId, claimId: args.claimId };
      let body;
      if (item.role === "reviewer") {
        if (!args.verdict || !String(args.comment || "").trim()) throw new ToolError("复核需要 verdict 与 comment。");
        body = { action: "review", reviewerAgentId: agent, verdict: args.verdict, comment: args.comment, ...identity };
      } else {
        if (!String(args.output || "").trim()) throw new ToolError("执行成果 output 不能为空。");
        body = { action: item.status === "rework" ? "rework" : "submit", output: args.output, materials: args.materials || [], ...identity };
      }
      const result = await call(`/api/departments/runs/${encodeURIComponent(args.runId)}/items/${encodeURIComponent(item.id)}/action`, { method: "POST", body });
      return { text: `已提交 ${item.label || item.id}（${body.action}）。正式复核与交付验收仍按原流程进行。`, data: result };
    },
  },
  {
    name: "workbench_handoff",
    description: "Seal a lead's handoff for a v2 room (POST /api/departments/runs/<id>/handoff). Only the room's lead may seal; pasting chat text is not a handoff.",
    inputSchema: {
      type: "object",
      required: ["runId", "summary"],
      properties: {
        runId: str("Project id"), itemId: str("Room stage id (optional)"), summary: str("What can be handed over"),
        decisions: { type: "array", items: { type: "string" } }, openQuestions: { type: "array", items: { type: "string" } },
        nextAction: str("First action after resuming"), blockers: str("Blockers"), acceptance: str("Acceptance criteria"),
        dispatch: { type: "boolean", description: "Only asks whether one more attempt is allowed; never starts a member" },
      },
      additionalProperties: false,
    },
    async run({ runId, ...rest }) {
      const result = await call(`/api/departments/runs/${encodeURIComponent(runId)}/handoff`, { method: "POST", body: { ...rest, agentId: needAgent(), source: "mcp" } });
      return { text: `交接已封印：${result.handoff.id}${rest.dispatch ? ` · 可再试：${result.attemptAllowed}` : ""}`, data: result };
    },
  },
];

function reply(id, result) { process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n"); }
function fail(id, code, message) { process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) + "\n"); }

async function handle(message) {
  const { id, method, params = {} } = message;
  const isRequest = id !== undefined && id !== null;
  if (method === "initialize") {
    return reply(id, {
      protocolVersion: PROTOCOLS.includes(params.protocolVersion) ? params.protocolVersion : PROTOCOLS[0],
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "workbench", version },
      instructions: "本机统筹工作台（唯一台账）。工具只通过本机接口读写，原有门禁全部有效；不要编造进度，不要替其他成员提交。",
    });
  }
  if (!isRequest) return; // notifications/initialized and other notifications need no reply
  if (method === "ping") return reply(id, {});
  if (method === "tools/list") return reply(id, { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
  if (method === "tools/call") {
    const tool = TOOLS.find((t) => t.name === params.name);
    if (!tool) return fail(id, -32602, `unknown tool: ${params.name}`);
    try {
      const { text, data } = await tool.run(params.arguments || {});
      return reply(id, { content: [{ type: "text", text }], structuredContent: { result: data ?? null }, isError: false });
    } catch (error) {
      if (!(error instanceof ToolError)) process.stderr.write(`workbench-mcp: ${error.stack || error}\n`);
      return reply(id, { content: [{ type: "text", text: error.message }], isError: true });
    }
  }
  return fail(id, -32601, `method not found: ${method}`);
}

const input = readline.createInterface({ input: process.stdin });
input.on("line", (line) => {
  if (!line.trim()) return;
  let message;
  try { message = JSON.parse(line); } catch { return fail(null, -32700, "parse error"); }
  handle(message).catch((error) => fail(message.id ?? null, -32603, error.message));
});
