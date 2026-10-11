"use strict";
// Isolated synthetic experiment. Does not change business runs or copy WorkBuddy credentials.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..', 'data', 'wecom-probe');
function prepare(dir = root) {
  fs.mkdirSync(dir, { recursive: true });
  const jobId = 'wb-im-' + crypto.randomUUID();
  const resultPath = path.join(dir, jobId + '.result.json');
  const record = { jobId, createdAt: new Date().toISOString(), status: 'prepared', resultPath,
    prompt: `这是用户授权的合成连接测试，不涉及业务资料。任务编号 ${jobId}。计算 49×53，给出算式和结果。只新建 ${resultPath}，UTF-8 JSON 字段 jobId=${jobId}、agentId=workbuddy、output=计算过程。完成后读取该文件确认。不要修改业务文件、store.json 或其他项目。重复收到同一编号时，如结果文件已存在，读取核验并结束，不再次执行。` };
  fs.writeFileSync(path.join(dir, jobId + '.probe.json'), JSON.stringify(record, null, 2), { flag: 'wx' });
  return record;
}
function recordFile(dir, jobId) {
  if (!/^wb-im-[a-f0-9-]{36}$/.test(jobId)) throw new Error('invalid_probe_id');
  return path.join(dir, jobId + '.probe.json');
}
function load(dir, jobId) {
  return JSON.parse(fs.readFileSync(recordFile(dir, jobId), 'utf8'));
}
function save(dir, record) {
  fs.writeFileSync(recordFile(dir, record.jobId), JSON.stringify(record, null, 2));
}
function validateConfig(config) {
  if (!config.senderBotId || !config.receiverBotId || !config.chatId || config.testOnly !== true)
    throw new Error('需要专用测试发送机器人、WorkBuddy接收机器人及测试会话；不得使用业务群');
  if (config.senderBotId === config.receiverBotId)
    throw new Error('不得复用WorkBuddy机器人的连接，可能挤掉其现有连接');
}
async function send(record, config, client, dir = root) {
  validateConfig(config);
  // Re-read under exclusive lock: uncertain send outcomes must never be blindly retried.
  const lockPath = recordFile(dir, record.jobId) + '.lock';
  const lock = fs.openSync(lockPath, 'wx');
  try {
    const current = load(dir, record.jobId);
    if (current.status !== 'prepared') throw new Error('该编号已尝试发送；先核对结果，不自动重发');
    current.status = 'sending'; current.attemptedAt = new Date().toISOString(); save(dir, current);
    try {
      const ack = await client.sendMessage(config.chatId, { msgtype: 'markdown', markdown: { content: current.prompt } });
      if (ack?.errcode) throw new Error('企微未确认发送');
      current.status = 'notification_accepted'; current.acceptedAt = new Date().toISOString();
      // ACK is only delivery evidence, never proof of WorkBuddy starting.
      save(dir, current);
      return current;
    } catch (_) {
      current.status = 'send_uncertain'; save(dir, current);
      throw new Error('发送失败或结果不确定；不自动重发，不记录凭据或原始服务器响应');
    }
  } finally { fs.closeSync(lock); fs.unlinkSync(lockPath); }
}
function verify(dir, jobId) {
  const record = load(dir, jobId);
  const expected = path.join(dir, jobId + '.result.json');
  if (path.resolve(record.resultPath) !== path.resolve(expected)) throw new Error('result_path_mismatch');
  if (!fs.existsSync(expected)) return { jobId, status: record.status, executed: false };
  if (fs.statSync(expected).size > 100000) throw new Error('result_too_large');
  const result = JSON.parse(fs.readFileSync(expected, 'utf8'));
  if (result.jobId !== jobId || result.agentId !== 'workbuddy' || typeof result.output !== 'string' || !result.output.includes('2597'))
    throw new Error('实际结果身份或计算结果不匹配');
  record.status = 'result_received'; record.output = result.output; record.verifiedAt = new Date().toISOString(); save(dir, record);
  return { jobId, status: record.status, executed: true, output: result.output };
}
async function main() {
  const [action, jobId] = process.argv.slice(2);
  if (action === 'prepare') return console.log(JSON.stringify(prepare(), null, 2));
  if (action === 'verify') return console.log(JSON.stringify(verify(root, jobId), null, 2));
  if (action !== 'send') throw new Error('用法: prepare | send <jobId> | verify <jobId>');
  const config = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
  validateConfig(config); // Must run before opening any connection.
  const record = load(root, jobId);
  if (record.status !== 'prepared') throw new Error('该编号已尝试发送；先核对结果，不自动重发');
  const secret = process.env[config.senderSecretEnv || 'BEN_TEST_WECOM_SECRET'];
  if (!secret) throw new Error('测试发送机器人的凭据尚未在本机配置；不要把Secret发到聊天');
  const sdk = require('@wecom/aibot-node-sdk');
  const WSClient = sdk.WSClient || sdk.default?.WSClient;
  const client = new WSClient({ botId: config.senderBotId, secret, maxReconnectAttempts: 0, maxAuthFailureAttempts: 0,
    logger: { debug() {}, info() {}, warn() {}, error() {} } });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('测试机器人连接超时')), 15000);
      client.once('authenticated', () => { clearTimeout(timer); resolve(); });
      client.once('error', () => { clearTimeout(timer); reject(new Error('测试机器人连接失败')); });
      client.connect();
    });
    const result = await send(record, config, client);
    console.log(JSON.stringify({ jobId, status: result.status, executed: false }));
  } finally { client.disconnect(); }
}
module.exports = { prepare, send, verify };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
