import fs from 'node:fs/promises';
import path from 'node:path';

function control(tree, pattern) {
  const line = tree.split('\n').find(line => pattern.test(line));
  return line ? Number(line.trim().match(/^\d+/)?.[0]) : null;
}
// The caller supplies the supported Computer Use runtime. One action per tick.
export function createWorker({ sky, root, pause = () => false }) {
  let busy = false;
  const active = ['opening', 'focused', 'typed', 'transmitting'];
  async function tick() {
    if (busy || pause()) return { status: 'paused' };
    busy = true;
    let file, request, lock;
    try {
      await fs.mkdir(root, { recursive: true });
      try { lock = await fs.open(path.join(root, 'sender.lock'), 'wx'); }
      catch (error) { if (error.code === 'EEXIST') return { status: 'locked' }; throw error; }
      const requests = [];
      for (const name of (await fs.readdir(root)).filter(n => n.endsWith('.request.json')).sort()) {
        requests.push({ file: path.join(root, name), request: JSON.parse(await fs.readFile(path.join(root, name), 'utf8')) });
      }
      const pending = requests.find(x => active.includes(x.request.status));
      if (!pending && requests.some(x => ['sent', 'sending', 'needs_attention'].includes(x.request.status))) return { status: 'awaiting_resolution' };
      const chosen = pending || requests.find(x => x.request.status === 'queued');
      if (!chosen) return { status: 'idle' };
      ({ file, request } = chosen);
      const apps = await sky.list_apps();
      const windows = apps.filter(a => a.displayName === 'WorkBuddy').flatMap(a => a.windows);
      if (windows.length !== 1) return { status: 'window_unavailable' };
      let window = await sky.get_window({ id: windows[0].id, app: windows[0].app });
      const state = await sky.get_window_state({ window, include_screenshot: true, include_text: true });
      window = state.window;
      const tree = state.accessibility?.tree || '';
      async function save(status) {
        request.status = status; request.updatedAt = new Date().toISOString();
        await fs.writeFile(file, JSON.stringify(request, null, 2));
      }
      async function click(pattern) {
        const element = control(tree, pattern);
        if (element === null || !Number.isFinite(element)) throw new Error('桌面控件不可定位；未盲目点击');
        await sky.click({ window, element_index: element });
      }
      if (request.status === 'queued') {
        await save('opening');
        await click(/选项卡项目.*New Task/);
      } else if (request.status === 'opening') {
        const element = control(tree, /编辑 \(settable, string\)/);
        const line = tree.split('\n').find(l => l.trim().startsWith(element + ' '));
        if (element === null || (line?.includes('Value:') && !/What can I help|Value:\s*﻿?\s*$/.test(line))) throw new Error('输入框不可用或已有内容');
        await sky.click({ window, element_index: element });
        await save('focused');
      } else if (request.status === 'focused') {
        await save('needs_attention'); // An interrupted paste must never be replayed.
        await sky.type_text({ window, text: request.prompt });
        await save('typed');
      } else if (request.status === 'typed') {
        if (!tree.includes(request.jobId)) throw new Error('输入框未包含任务编号');
        await save('transmitting');
        await click(/按钮 Send$/);
      } else if (request.status === 'transmitting') {
        if (!tree.includes(request.jobId)) throw new Error('发送结果不确定，禁止自动重发');
        if (/按钮 Stop/.test(tree) || await fs.stat(request.resultPath).catch(() => null)) await save('sent');
        else return { status: 'awaiting_confirmation', jobId: request.jobId };
      }
      return { status: request.status, jobId: request.jobId };
    } catch (error) {
      if (file && request) {
        request.error = error.message; request.status = 'needs_attention';
        await fs.writeFile(file, JSON.stringify(request, null, 2));
      }
      return { status: 'needs_attention', jobId: request?.jobId, error: error.message };
    } finally {
      if (lock) { await lock.close(); await fs.unlink(path.join(root, 'sender.lock')).catch(() => {}); }
      busy = false;
    }
  }
  return { tick };
}
