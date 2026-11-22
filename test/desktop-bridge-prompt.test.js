"use strict";
const assert = require("assert"), fs = require("fs"), os = require("os"), path = require("path");
const { generate } = require("../lib/desktop-bridge");
const { claim } = require("../lib/workbuddy-queue");
(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-contract-"));
  let result;
  try {
    result = generate("fixture", process.cwd(), { jobId: "job-test", attemptId: "attempt-test", transport: "desktop-scheduled" }, { root, pollMs: 5, timeoutMs: 100 });
    result.catch(() => {});
    const assignment = claim(root, { onClaim: () => ({ attemptId: "attempt-test", claimId: "claim-test" }) }).assignment;
    assert.match(assignment.prompt, /attemptId/);
    assert.match(assignment.prompt, /claimId/);
    const initialPrompt = JSON.parse(fs.readFileSync(path.join(root, "job-test.request.json"), "utf8")).prompt;
    assert.match(initialPrompt, /attemptId.*claimId/s, "v2 result instructions must require both receipt fields");
    fs.writeFileSync(assignment.resultPath, JSON.stringify({ jobId: assignment.jobId, agentId: "workbuddy", attemptId: assignment.attemptId, claimId: assignment.claimId, output: "fixture result" }));
    assert.equal(await result, "fixture result");
    console.log("desktop bridge v2 contract passed");
  } finally { if (result) await result.catch(() => {}); fs.rmSync(root, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
