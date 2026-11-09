'use strict';
// An isolated local preview: no production ledger and no background workers.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http');
const root = path.join(os.tmpdir(), 'workbench-v9-preview');
fs.mkdirSync(root, { recursive: true });
process.env.BENCH_DATA_DIR = root;
process.env.BENCH_GROWTH_PREVIEW = '1';
if (!fs.existsSync(path.join(root, 'store.json'))) {
  const state = require('../lib/default-store').buildDefaultStore();
  for (const key of ['tasks', 'modules', 'agendas', 'departmentRuns', 'reports', 'inbox', 'events', 'projectMessages', 'artifacts']) state[key] = [];
  state.meta.companion = { enabled: false, voice: false };
  state.remote = { vault: { enabled: false }, llm: { enabled: false } };
  fs.writeFileSync(path.join(root, 'store.json'), JSON.stringify(state, null, 2));
}
const app = require('../server').createServer();
const server = http.createServer((req, res) => {
  if (!['GET', 'HEAD'].includes(req.method) && !req.url.startsWith('/api/growth/')) {
    res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: '隔离演示只允许保存V9成长记录，不执行其他业务操作。' }));
    return;
  }
  app.emit('request', req, res);
});
const port = Number(process.env.V9_PREVIEW_PORT || 3790);
server.listen(port, '127.0.0.1', () => console.log(`V9 isolated preview: http://127.0.0.1:${port}/#learn/growth`));
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
