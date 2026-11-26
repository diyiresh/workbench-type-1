"use strict";
// 豆包桌面队列脚本 — 与 workbuddy-queue.js 协议一致，本地 HTTP 只读。
// 用法：
//   node scripts/doubao-queue.js              — 领取下一条任务（返回 JSON）
//   node scripts/doubao-queue.js status       — 查看队列状态
//   node scripts/doubao-queue.js started <jobId>  — 自报已开始执行
//   node scripts/doubao-queue.js submit <jobId> <resultFile>  — 提交成果
//
// 结果文件格式（UTF-8 JSON）：
//   { "jobId": "...", "agentId": "doubao", "attemptId": "...", "claimId": "...", "output": "完整成果正文" }
//
// 豆包桌面在工作台领取任务后，把完整回复正文写入上述 JSON 文件，再运行 submit 提交。
// 不要修改工作台台账；不要写入其他项目的结果文件。

const path = require('path');
const fs = require('fs');

const baseUrl = (() => {
  const raw = (process.env.BENCH_URL || 'http://127.0.0.1:3780').replace(/\/$/, '');
  try { const u = new URL(raw); if (!['127.0.0.1','localhost','::1'].includes(u.hostname)) throw new Error('非本机地址'); return raw; }
  catch { throw new Error('BENCH_URL 只能是本机地址，当前值：' + raw); }
})();

function request(path, body) {
  return fetch(baseUrl + path, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
    redirect: 'error',
    signal: AbortSignal.timeout(10000),
  }).then(async r => {
    const data = await r.json();
    if (!r.ok) throw Object.assign(new Error(data.error || '请求失败'), { status: r.status });
    return data;
  });
}

(async () => {
  const cmd = process.argv[2];

  if (cmd === 'status') {
    const data = await request('/api/doubao/tasks');
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (cmd === 'started') {
    const jobId = process.argv[3];
    if (!jobId || !/^[a-zA-Z0-9-]+$/.test(jobId)) throw new Error('缺少有效 jobId');
    // Read claim receipt from local queue file for started report
    const dir = path.resolve(process.env.BENCH_DATA_DIR || path.resolve(__dirname, '..', 'data'), 'doubao-queue');
    const req = JSON.parse(fs.readFileSync(path.join(dir, jobId + '.request.json'), 'utf8'));
    if (req.status !== 'claimed' || !req.claimId || !req.attemptId) throw new Error('任务尚未领取');
    const startPath = '/api/departments/runs/' + encodeURIComponent(req.runId) + '/execution/started';
    const result = await request(startPath, {
      attemptId: req.attemptId, claimId: req.claimId, inputHash: req.inputHash,
      idempotencyKey: 'started:' + req.attemptId + ':' + req.claimId,
    });
    console.log(JSON.stringify(result));
    return;
  }

  if (cmd === 'submit') {
    const jobId = process.argv[3];
    const resultFile = process.argv[4];
    if (!jobId || !/^[a-zA-Z0-9-]+$/.test(jobId)) throw new Error('缺少有效 jobId');
    if (!resultFile || !fs.existsSync(resultFile)) throw new Error('结果文件不存在：' + resultFile);
    const result = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
    if (result.agentId !== 'doubao') throw new Error('agentId 必须是 doubao');
    if (!result.output || !result.output.trim()) throw new Error('output 不能为空');
    const data = await request('/api/doubao/submit', {
      jobId, attemptId: result.attemptId, claimId: result.claimId,
      output: result.output, confirmed: true,
      idempotencyKey: 'doubao-submit:' + result.attemptId + ':' + result.claimId,
    });
    console.log(JSON.stringify(data));
    return;
  }

  // Default: claim next task
  const idempotencyKey = require('crypto').randomUUID();
  const data = await request('/api/doubao/tasks');
  if (!data.tasks || data.tasks.length === 0) {
    console.log(JSON.stringify({ assignment: null, message: '当前没有待领取的豆包任务' }));
    return;
  }
  const next = data.tasks[0];
  const claim = await request('/api/doubao/claim', {
    jobId: next.jobId, confirmed: true, idempotencyKey,
  });
  console.log(JSON.stringify({ assignment: claim, jobId: next.jobId, prompt: next.prompt }));
})().catch(err => { console.error(err.message); process.exitCode = 1; });
