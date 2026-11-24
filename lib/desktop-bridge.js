"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
function generate(prompt, cwd, context = {}, options = {}) {
  const root = options.root || path.join(cwd, "data", "desktop-bridge");
  const jobId = context.jobId || "db-" + crypto.randomUUID();
  if (!/^[a-zA-Z0-9-]+$/.test(jobId)) throw new Error("invalid_desktop_job_id");
  fs.mkdirSync(root, { recursive: true });
  const requestPath = path.join(root, jobId + ".request.json");
  const resultPath = path.join(root, jobId + ".result.json");
  const draftPath = path.join(root, jobId + ".draft.txt");
  if (fs.existsSync(requestPath) || fs.existsSync(resultPath)) throw new Error("desktop_job_already_exists");
  const request = { jobId, runId: context.runId || null, itemId: context.itemId || null,
    attemptId:context.attemptId || null,protocolVersion:context.attemptId?2:1,purpose:context.purpose || null,
    createdAt: new Date().toISOString(), expiresAt: new Date(Date.now()+(options.timeoutMs||600000)).toISOString(), transport: context.transport || "desktop-ui", status: "queued", resultPath,
    prompt: prompt + (context.attemptId&&context.transport==='desktop-scheduled' ? `\n桌面桥接成果报送：只将完整实际成果正文写入 ${draftPath}（UTF-8 纯文本），再运行 node "${path.resolve(cwd,'scripts','workbuddy-queue.js')}" submit ${jobId} "${draftPath}"。这是明确允许的成果提交命令；程序读取实际领取的 attemptId 和 claimId，自动封装包含全部五个字段的结果。不要自行填写领取凭证、不要修改台账或业务原件。` : `\n桌面桥接成果报送：只新建 ${resultPath}，UTF-8 JSON 格式，字段 jobId=${jobId}、agentId=workbuddy、${context.attemptId ? `attemptId=${context.attemptId}、claimId=领取回执中的 claimId 原值、` : ""}output=你的完整实际成果正文。${context.attemptId ? "必须保留全部五个字段，不得省略 attemptId 或 claimId。" : ""}不要直接修改工作台台账；不要写入其他项目的结果文件。`) };
  fs.writeFileSync(requestPath, JSON.stringify(request, null, 2), { flag: "wx" });
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, output) => {
      if (settled) return; settled = true; clearInterval(poll); clearTimeout(timeout);
      try { Object.assign(request, JSON.parse(fs.readFileSync(requestPath, "utf8"))); } catch (_) {}
      request.status = error?.code==='assignment_withdrawn' ? 'withdrawn' : error ? "failed" : "collected";
      request.completedAt = new Date().toISOString();
      if (error) request.error = error.message;
      fs.writeFileSync(requestPath, JSON.stringify(request, null, 2));
      error ? reject(error) : resolve(output);
    };
    const poll = setInterval(() => {
      try{if(JSON.parse(fs.readFileSync(requestPath,'utf8')).status==='withdrawn')return finish(Object.assign(new Error('未领取派单已按批准规则撤回。'),{code:'assignment_withdrawn'}));}catch{}
      if (!fs.existsSync(resultPath)) return;
      try {
        if (fs.statSync(resultPath).size > 2000000) return finish(new Error("desktop_result_too_large"));
        const result = JSON.parse(fs.readFileSync(resultPath, "utf8"));
        if (result.jobId !== jobId || result.agentId !== "workbuddy") return finish(Object.assign(new Error("desktop_result_identity_mismatch"),{code:'result_identity_mismatch'}));
        if(context.attemptId){const latest=JSON.parse(fs.readFileSync(requestPath,'utf8'));if(result.attemptId!==context.attemptId||!latest.claimId||result.claimId!==latest.claimId)return finish(Object.assign(new Error('desktop_result_claim_mismatch'),{code:'result_identity_mismatch'}));}
        if (result.error) return finish(new Error(String(result.error).slice(0, 400)));
        if (typeof result.output !== "string" || !result.output.trim()) return finish(new Error("desktop_result_empty"));
        finish(null, result.output);
      } catch (error) { if (!(error instanceof SyntaxError)) finish(error); }
    }, options.pollMs || 1000);
    const timeout = setTimeout(() => finish(Object.assign(new Error("桌面桥接等待成果超时；请核对会话，禁止盲目重发"),{code:'result_uncertain'})), options.timeoutMs || 600000);
  });
}
module.exports = { generate };
