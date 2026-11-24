'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {pathToFileURL} = require('node:url');
const {spawn} = require('node:child_process');
const failure = require('../runtime-failure');

function error(code, message) { return Object.assign(new Error(message), {code}); }
function redact(value) {
  return String(value).replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\bsk-[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(/((?:api[_-]?key|token|secret|password)\s*[=:]\s*)[^\s,;]+/gi, '$1[redacted]')
    .replace(/https?:\/\/[^\s/@]+:[^\s/@]+@/g, 'https://[redacted]@').slice(-3000);
}
function discover(env = process.env) {
  try {
    const versions = path.join(env.USERPROFILE || os.homedir(), '.workbuddy', 'binaries', 'node', 'versions');
    const current = fs.readFileSync(path.join(versions, 'current'), 'utf8').trim();
    if (!/^[\w.-]+$/.test(current)) return null;
    const root = path.join(versions, current);
    const packageRoot = path.join(root, 'node_modules', '@deepseek-ai', 'dsh');
    const runtime = {node: path.join(root, 'node.exe'), bin: path.join(packageRoot, 'lib', 'bin.js'), packageRoot};
    if (!fs.existsSync(runtime.node) || !fs.existsSync(runtime.bin)) return null;
    runtime.version = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8')).version;
    return runtime;
  } catch { return null; }
}
async function status({env = process.env} = {}) {
  const runtime = discover(env);
  if (!runtime) return {installed:false, configured:false, state:'offline', reason:'未发现现有 WorkBuddy Node 环境中的 DeepSeek Harness；未自动安装。'};
  const home = env.DSH_HOME?.trim() || path.join(env.USERPROFILE || os.homedir(), '.dsh');
  // Presence is deliberately not treated as proof that a provider can authenticate.
  const credentialPresent = fs.existsSync(path.join(home, '.credentials.yaml')) || !!env.DEEPSEEK_API_KEY || !!env.OPENAI_API_KEY;
  return {installed:true, configured:credentialPresent ? null : false, state:credentialPresent ? 'unknown' : 'unconfigured', version:runtime.version,
    reason:credentialPresent ? '已发现 Harness 与现有凭据配置；需要连接测试确认实际 provider 可用。' : 'Harness 已安装；未发现默认凭据，请在原 App 中完成配置后测试。'};
}

function createIsolation(directory, runtime, cwd) {
  const plugin = path.join(directory, 'read-only.mjs');
  fs.writeFileSync(plugin, `export const name = 'workbench-read-only';\nexport const inject = ['tools'];\nexport function apply(ctx) {\n ctx.tools.guard(() => 'WORKBENCH_READ_ONLY: all tool execution is disabled');\n ctx.provide('workbenchReadOnly', {});\n}\n`);
  const base = fs.readFileSync(path.join(runtime.packageRoot, 'node_modules', '@deepseek-ai', 'dsh-base', 'cordis.patch.yml'), 'utf8');
  const toolIds = [...base.matchAll(/^\s*- id: (tool-[\w-]+)\s*$/gm)].map(x => x[1]);
  if (!toolIds.includes('tool-fs') || !toolIds.includes('tool-pwsh')) throw error('provider_incompatible', 'Harness 工具配置发生变化，拒绝无隔离执行。');
  const patch = [
    ...toolIds.map(id => ({id, disabled:true})),
    {id:'sandbox-policy', config:{mode:'read-only', workspaceRoot:cwd}},
    {id:'approval', config:{policy:'ask'}},
    {insert:[{id:'workbench-read-only', name:pathToFileURL(plugin).href}]},
    {id:'headless-runner', inject:['headlessStartup', 'workbenchReadOnly']},
  ];
  const filename = path.join(directory, 'readonly.patch.json');
  // JSON is valid YAML and avoids path/prompt interpolation into executable syntax.
  fs.writeFileSync(filename, JSON.stringify(patch));
  return filename;
}

async function generate(prompt, cwd, context = {}, options = {}) {
  const runtime = options.runtime || discover();
  if (!runtime) throw error('provider_unconfigured', 'DeepSeek Harness 未安装或入口不可用。');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-harness-'));
  try {
    const patch = createIsolation(directory, runtime, path.resolve(cwd));
    const args = [runtime.bin, '--profile', 'headless', '--patch', patch, '--json', '-'];
    // No implicit session reuse: each attempt has a fresh Harness session.
    context.onBeforeStart?.();
    return await new Promise((resolve, reject) => {
      let child, final, sessionId, pending = '', stderr = '', received = 0, protocolError, stopped = false, settled = false;
      let timer, forceTimer, orphanTimer;
      const timeoutMs = options.timeoutMs || 600000;
      const finishError = (err, termination) => {
        if (settled) return; settled = true;
        clearTimeout(timer); clearTimeout(forceTimer); clearTimeout(orphanTimer);
        reject(termination ? failure.closed(err, termination) : err);
      };
      const stop = code => {
        if (stopped) return; stopped = true;
        protocolError ||= error(code, code === 'result_uncertain' ? 'Harness 超时，已请求终止；不会自动冒充未执行。' : 'Harness 输出超过限制或协议无效。');
        child.kill();
        forceTimer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 1500);
        orphanTimer = setTimeout(() => finishError(error('result_uncertain', 'Harness 未确认退出，需核对旧会话后接续。')), 6000);
      };
      const line = value => {
        if (!value.trim()) return;
        let event;
        try { event = JSON.parse(value); } catch { protocolError ||= error('output_format', 'Harness NDJSON 无法解析。'); return; }
        if (event.type === 'session') {
          if (typeof event.sessionId !== 'string' || !event.sessionId || (sessionId && sessionId !== event.sessionId)) protocolError ||= error('output_format', 'Harness 会话标识无效。');
          else { sessionId = event.sessionId; context.onSession?.({sessionId}); }
        }
        if (event.type === 'final') {
          if (final !== undefined || typeof event.text !== 'string') protocolError ||= error('output_format', 'Harness 最终正文协议无效。');
          else final = event.text;
        }
        if (event.type === 'error') protocolError ||= error(/auth|credential|api.?key/i.test(`${event.code} ${event.message}`) ? 'auth_required' : 'runtime_unavailable', redact(event.message || event.code || 'Harness 执行错误'));
      };
      try {
        child = (options.spawnImpl || spawn)(runtime.node, args, {cwd, windowsHide:true, shell:false, stdio:['pipe','pipe','pipe'],
          env:{...process.env, DSH_PERMISSION_MODE:'read-only', DSH_TELEMETRY_DISABLED:'1'}});
      } catch (err) { return finishError(error('runtime_unavailable', redact(err.message)), {source:'spawn-failure', closedAt:new Date().toISOString()}); }
      child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
      child.on('error', err => {
        if (!child.pid) {
          const ended = {source:'spawn-failure', closedAt:new Date().toISOString()};
          context.onClose?.(ended);
          finishError(error('runtime_unavailable', redact(err.message)), ended);
        } else protocolError ||= error('runtime_unavailable', redact(err.message));
      });
      child.stdout.on('data', data => {
        received += Buffer.byteLength(data);
        if (received > (options.maxOutputBytes || 4 * 1024 * 1024)) return stop('output_format');
        pending += data;
        let newline;
        while ((newline = pending.indexOf('\n')) >= 0) { line(pending.slice(0, newline)); pending = pending.slice(newline + 1); }
      });
      child.stderr.on('data', data => { stderr = (stderr + data).slice(-6000); });
      child.stdin.on('error', () => {});
      child.on('close', (code, signal) => {
        if (settled) return;
        clearTimeout(timer); clearTimeout(forceTimer); clearTimeout(orphanTimer);
        if (pending) line(pending);
        const termination = {source:'child-process-close', closedAt:new Date().toISOString(), pid:child.pid, exitCode:code, signal, sessionId, stopRequested:stopped};
        try { context.onClose?.(termination); } catch (err) { return finishError(err, termination); }
        if (protocolError) return finishError(protocolError, termination);
        if (code !== 0) return finishError(error(/auth|credential|api.?key/i.test(stderr) ? 'auth_required' : 'runtime_unavailable', `Harness 退出 (${code ?? signal})：${redact(stderr)}`), termination);
        if (!sessionId || !final?.trim()) return finishError(error('output_format', 'Harness 未返回完整会话与最终正文。'), termination);
        settled = true; resolve(final.trim());
      });
      timer = setTimeout(() => stop('result_uncertain'), timeoutMs);
      try { context.onStart?.({pid:child.pid, source:'deepseek-harness-headless', jobId:context.jobId, attemptId:context.attemptId}); }
      catch (err) { protocolError = error('result_uncertain', '工作台未能登记 Harness 启动，已请求终止。'); stop('result_uncertain'); return; }
      child.stdin.end(String(prompt));
    });
  } finally {
    // Only this invocation's generated files are removed, never user data.
    fs.rmSync(directory, {recursive:true, force:true});
  }
}
module.exports = {status, generate, discover, redact, createIsolation};
