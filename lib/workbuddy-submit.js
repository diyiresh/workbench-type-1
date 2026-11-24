"use strict";
// This transport only reads a claimed task and wraps its body. It never runs a model.
const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");
const governance = require("./execution-governance");
const { inactive } = require("./archive");
const MAX_BYTES = 2000000;

function localBaseUrl(value = "http://127.0.0.1:3780") {
  let url;
  try { url = new URL(value); } catch { throw new Error("invalid_workbench_url"); }
  if (!["http:", "https:"].includes(url.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("workbench_loopback_required");
  return url.origin;
}

function queuePaths(root, jobId) {
  if (!/^[a-zA-Z0-9-]+$/.test(jobId || "")) throw new Error("invalid_job_id");
  const directory = fs.realpathSync(root);
  return { root: directory, requestPath: path.join(directory, jobId + ".request.json"), draftPath: path.join(directory, jobId + ".draft.txt"), resultPath: path.join(directory, jobId + ".result.json") };
}
function readPlainFile(file, maxBytes = MAX_BYTES) {
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size > maxBytes || stat.size === 0) throw new Error("invalid_submission_file");
  if (fs.realpathSync(file) !== path.resolve(file)) throw new Error("submission_path_mismatch");
  return fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
}
function readRequest(paths, jobId) {
  const request = JSON.parse(readPlainFile(paths.requestPath));
  if (request.jobId !== jobId || path.resolve(request.resultPath || "") !== paths.resultPath) throw new Error("queue_result_path_mismatch");
  if (request.protocolVersion !== 2 || request.transport !== "desktop-scheduled" || !["claimed", "collected"].includes(request.status) || !request.attemptId || !request.claimId || !request.inputHash || !request.runId) throw new Error("claim_receipt_required");
  return request;
}
function sameResult(a, b) {
  return ["jobId", "agentId", "attemptId", "claimId", "output"].every(k => a[k] === b[k]);
}
function existingResult(paths, envelope) {
  if (!fs.existsSync(paths.resultPath)) return false;
  const saved = JSON.parse(readPlainFile(paths.resultPath));
  if (!sameResult(saved, envelope)) throw new Error("result_already_exists");
  return true;
}
function verifyCurrent(store, request, duplicate) {
  const attempt = (store.executionAttempts || []).find(a => a.id === request.attemptId);
  if (!attempt || attempt.agentId !== "workbuddy" || attempt.transport !== "desktop-scheduled" || attempt.jobId !== request.jobId || attempt.runId !== request.runId || attempt.claimId !== request.claimId || attempt.inputHash !== request.inputHash || (request.itemId && attempt.stepId !== request.itemId)) throw new Error("result_identity_mismatch");
  if (!(duplicate ? ["claimed", "running", "returned"] : ["claimed", "running"]).includes(attempt.state)) throw new Error("submission_attempt_not_active");
  const run = governance.check(store, attempt);
  if (attempt.purpose === "stage") {
    const item = run.items.find(i => i.id === attempt.stepId);
    if (item?.ownerAgentId !== "workbuddy") throw new Error("result_identity_mismatch");
  }
  if (attempt.purpose === "chat") {
    const job = (store.chatJobs || []).find(j => j.id === attempt.jobId && j.attemptId === attempt.id);
    if (!job || inactive(job)) throw new Error("submission_attempt_not_active");
  }
  return attempt;
}

async function submit({ root, jobId, draftPath, baseUrl, fetchImpl = fetch }) {
  const origin = localBaseUrl(baseUrl);
  const paths = queuePaths(root, jobId);
  if (path.resolve(draftPath || "") !== paths.draftPath) throw new Error("draft_path_mismatch");
  const output = readPlainFile(paths.draftPath);
  if (!output.trim()) throw new Error("desktop_result_empty");
  const request = readRequest(paths, jobId);
  const envelope = { jobId, agentId: "workbuddy", attemptId: request.attemptId, claimId: request.claimId, output };
  const duplicate = existingResult(paths, envelope);
  if (!duplicate && request.status !== "claimed") throw new Error("claim_receipt_required");
  const response = await fetchImpl(origin + "/api/state", { redirect: "error", signal: AbortSignal.timeout(10000) });
  const store = await response.json();
  if (!response.ok) throw new Error(store.error || "submission_state_unavailable");
  // The CLI can be invoked from the member's own working directory.
  governance.configure({ skillRoot: path.join(path.dirname(paths.root), "skill-library") });
  const attempt = verifyCurrent(store, request, duplicate);
  const latest = readRequest(paths, jobId);
  if (latest.attemptId !== request.attemptId || latest.claimId !== request.claimId || latest.inputHash !== request.inputHash || latest.status !== request.status) throw new Error("submission_request_changed");
  const value = JSON.stringify(envelope, null, 2);
  if (Buffer.byteLength(value, "utf8") > MAX_BYTES) throw new Error("desktop_result_too_large");
  if (!duplicate) {
    const temporary = path.join(paths.root, "." + jobId + ".result-" + randomUUID() + ".tmp");
    try {
      const descriptor = fs.openSync(temporary, "wx");
      try { fs.writeFileSync(descriptor, value, "utf8"); fs.fsyncSync(descriptor); }
      finally { fs.closeSync(descriptor); }
      // Linking a complete temp file creates the destination atomically and cannot replace it.
      try { fs.linkSync(temporary, paths.resultPath); }
      catch (error) { if (error.code !== "EEXIST" || !existingResult(paths, envelope)) throw error; }
    } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  }
  return { status: duplicate ? "already_submitted" : "submitted", jobId, attemptId: attempt.id, resultPath: paths.resultPath, startedEvidenceSource: attempt.startedEvidence?.source || "unknown", acceptedByWorkbench: false };
}

module.exports = { submit, localBaseUrl, queuePaths };
