"use strict";
const assert = require("assert"), fs = require("fs"), os = require("os"), path = require("path"), http = require("http");
const { spawn } = require("child_process");
const { buildDefaultStore } = require("../lib/default-store");
const dept = require("../lib/department");
const gov = require("../lib/execution-governance");
const { submit, localBaseUrl } = require("../lib/workbuddy-submit");
const { claim } = require("../lib/workbuddy-queue");

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "workbuddy-submit-"));
let store, root, jobId, request, attempt;
let serial = 0;
function fixture() {
  store = buildDefaultStore();
  const run = dept.createDepartmentRun(store, { goal: "回执封装隔离样例", participantAgentIds: ["codex", "cursor", "workbuddy"] });
  run.externalAutomation = true; run.workbuddyTransport = "desktop-scheduled";
  const step = dept.getItem(run, "executor"); step.ownerAgentId = "workbuddy"; step.status = "queued";
  jobId = "submit-" + (++serial);
  root = path.join(directory, jobId, "workbuddy-queue"); fs.mkdirSync(root, { recursive: true });
  attempt = gov.reserve(store, { runId: run.id, stepId: step.id, agentId: "workbuddy", jobId, transport: "desktop-scheduled" });
  gov.claim(store, attempt, { claimKey: jobId });
  request = { jobId, runId: run.id, itemId: step.id, attemptId: attempt.id, claimId: attempt.claimId, inputHash: attempt.inputHash, transport: "desktop-scheduled", protocolVersion: 2, status: "claimed", resultPath: path.join(root, jobId + ".result.json") };
  fs.writeFileSync(path.join(root, jobId + ".request.json"), JSON.stringify(request));
  fs.writeFileSync(path.join(root, jobId + ".draft.txt"), "完整实际正文\n含中文、表格与附件。");
  return { run, step, attempt };
}
const fetchState = async () => ({ ok: true, json: async () => structuredClone(store) });
const args = () => ({ root, jobId, draftPath: path.join(root, jobId + ".draft.txt"), fetchImpl: fetchState });
function cli(baseUrl, dataDir, id, draftPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.resolve(__dirname, "../scripts/workbuddy-queue.js"), "submit", id, draftPath], { env: { ...process.env, BENCH_URL: baseUrl, BENCH_DATA_DIR: dataDir }, windowsHide: true });
    let stdout = "", stderr = "";
    child.stdout.on("data", c => stdout += c); child.stderr.on("data", c => stderr += c);
    child.on("error", reject); child.on("close", code => resolve({ code, stdout, stderr }));
  });
}
(async () => {
  let server;
  try {
    for (const url of ["https://example.com", "http://user@127.0.0.1", "file:///tmp/state", "http://127.0.0.1/other", "http://127.0.0.1?x=y"]) assert.throws(() => localBaseUrl(url), /loopback|required|invalid/);
    assert.equal(localBaseUrl("http://[::1]:1234"), "http://[::1]:1234");
    fixture();
    request.status = "queued"; request.transport = "desktop-scheduled"; request.expiresAt = new Date(Date.now() + 60000).toISOString(); request.prompt = "任务内容";
    fs.writeFileSync(path.join(root, jobId + ".request.json"), JSON.stringify(request));
    const assignment = claim(root, { onClaim: () => ({ attemptId: attempt.id, claimId: attempt.claimId, inputHash: attempt.inputHash }) }).assignment;
    assert.equal(assignment.draftPath, args().draftPath); assert.match(assignment.prompt, /submit/); assert.match(assignment.prompt, /不要自己构造回执 JSON/);
    request.status = "claimed";
    const first = await submit(args()); assert.equal(first.status, "submitted"); assert.equal(first.acceptedByWorkbench, false); assert.equal(first.startedEvidenceSource, "unknown");
    const resultFile = request.resultPath, body = JSON.parse(fs.readFileSync(resultFile, "utf8"));
    assert.deepEqual(Object.keys(body), ["jobId", "agentId", "attemptId", "claimId", "output"]);
    assert.equal(body.claimId, attempt.claimId); assert.equal(body.output, fs.readFileSync(args().draftPath, "utf8"));
    const unchanged = fs.readFileSync(resultFile, "utf8");
    assert.equal((await submit(args())).status, "already_submitted"); assert.equal(fs.readFileSync(resultFile, "utf8"), unchanged);
    fs.writeFileSync(args().draftPath, "不同正文"); await assert.rejects(submit(args()), /result_already_exists/); assert.equal(fs.readFileSync(resultFile, "utf8"), unchanged);

    let f = fixture(); f.run.automationPaused = true; await assert.rejects(submit(args()), /project_paused/); assert(!fs.existsSync(request.resultPath));
    f = fixture(); f.run.controlGeneration = (f.run.controlGeneration || 0) + 1; await assert.rejects(submit(args()), /input_changed/);
    f = fixture(); f.run.context += "已变更"; await assert.rejects(submit(args()), /input_changed/);
    fixture(); attempt.claimId = "new-claim"; await assert.rejects(submit(args()), /identity_mismatch/);
    fixture(); attempt.state = "cancelled"; await assert.rejects(submit(args()), /attempt_not_active/);
    fixture(); attempt.leaseExpiresAt = new Date(0).toISOString(); await assert.rejects(submit(args()), /lease_expired/);
    fixture(); store.agents.find(a => a.id === "workbuddy").status = "paused"; await assert.rejects(submit(args()), /agent_paused/);
    fixture(); const wrongPath = path.join(directory, "outside.txt"); fs.writeFileSync(wrongPath, "原件"); await assert.rejects(submit({ ...args(), draftPath: wrongPath }), /draft_path_mismatch/);
    request.resultPath = path.join(directory, "outside.result.json"); fs.writeFileSync(path.join(root, jobId + ".request.json"), JSON.stringify(request)); await assert.rejects(submit(args()), /queue_result_path_mismatch/);
    fixture(); request.status = "failed"; fs.writeFileSync(path.join(root, jobId + ".request.json"), JSON.stringify(request)); await assert.rejects(submit(args()), /claim_receipt_required/);

    // A request changed during local API verification must not produce any output.
    fixture(); await assert.rejects(submit({ ...args(), fetchImpl: async () => { request.claimId = "changed"; fs.writeFileSync(path.join(root, jobId + ".request.json"), JSON.stringify(request)); return fetchState(); } }), /submission_request_changed/); assert(!fs.existsSync(request.resultPath));

    fixture(); server = http.createServer((req, res) => { assert.equal(req.url, "/api/state"); res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(store)); });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const baseUrl = "http://127.0.0.1:" + server.address().port;
    const viaCli = await cli(baseUrl, path.dirname(root), jobId, args().draftPath); assert.equal(viaCli.code, 0, viaCli.stderr); assert.equal(JSON.parse(viaCli.stdout).status, "submitted");
    const remote = await cli("https://example.com", path.dirname(root), jobId, args().draftPath); assert.equal(remote.code, 1); assert.match(remote.stderr, /loopback_required/);
    console.log("WorkBuddy deterministic submission: five-field wrapping, exact identity, input/control/pause/expiry checks, no overwrite, idempotency, loopback and isolated CLI passed");
  } finally { if (server) await new Promise(resolve => server.close(resolve)); fs.rmSync(directory, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
