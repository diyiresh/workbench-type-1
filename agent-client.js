"use strict";
// 在成员自己的工具环境中执行。领取真实任务，不代替成员完成工作。
const fs = require("fs");
const [command, agentId, runId, resultFile] = process.argv.slice(2);
const base = "http://127.0.0.1:3780";
async function request(route, body) {
  const response = await fetch(base + route, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}
(async () => {
  if (!["cursor", "workbuddy"].includes(agentId) || !runId) throw new Error("用法：node agent-client.js claim|wait|submit cursor|workbuddy <runId> [结果JSON路径]");
  if (["claim", "wait"].includes(command)) {
    const deadline = Date.now() + 50000;
    do {
      const result = await request("/api/agents/claim", { agentId, runId });
      if (result.assignment) { console.log(JSON.stringify(result, null, 2)); return; }
      if (command === "claim") break;
      await new Promise(resolve => setTimeout(resolve, 3000));
    } while (Date.now() < deadline);
    console.log(JSON.stringify({ assignment: null, waiting: true, message: "无可领取任务；检查依赖。等待模式可再次运行。" }));
  } else if (command === "submit") {
    const result = JSON.parse(fs.readFileSync(resultFile, "utf8").replace(/^\uFEFF/, ""));
    const run = await request(`/api/departments/runs/${encodeURIComponent(runId)}`);
    const item = run.items.find(entry => entry.id === result.itemId);
    if (!item || item.ownerAgentId !== agentId || !["doing", "rework"].includes(item.status)) throw new Error("阶段未领取或身份不匹配");
    const body = item.role === "reviewer" ? { action: "review", reviewerAgentId: agentId, verdict: result.verdict, comment: result.comment } : { action: item.status === "rework" ? "rework" : "submit", output: result.output, materials: result.materials || [] };
    console.log(JSON.stringify(await request(`/api/departments/runs/${encodeURIComponent(runId)}/items/${encodeURIComponent(item.id)}/action`, body), null, 2));
  } else throw new Error("未知命令");
})().catch(error => { console.error(error.message); process.exitCode = 1; });
