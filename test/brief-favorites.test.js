const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-brief-favorites-'));
process.env.BENCH_DATA_DIR = root;
const state = require('../lib/default-store').buildDefaultStore();
const legacy = { id: 'legacy', sourceId: 'chatgpt-daily-priority', externalRunId: 'legacy-run', title: '完整简报原文', body: '第一行\n第二行，保留 <>&', completedAt: '2026-10-14T01:00:00+08:00', unread: true };
state.briefRuns = [legacy, { ...legacy, id: 'archived', externalRunId: 'archived-run', archived: true, favorite: true }];
fs.writeFileSync(path.join(root, 'store.json'), JSON.stringify(state));
const { createServer } = require('../server');
let server = createServer(), base;
const start = async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
};
const request = async (route, body, expected = 200, method = body === undefined ? 'GET' : 'PATCH') => {
  const response = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  assert.equal(response.status, expected, await response.clone().text());
  return response.json();
};
(async () => {
  await start();
  assert.equal((await request('/api/brief-runs?favorite=true')).runs.length, 0);
  assert.deepEqual((await request('/api/brief-runs?favorite=false')).runs.map(run => run.id), ['legacy']);
  const saved = await request('/api/brief-runs/legacy', { favorite: true, body: '不能覆盖', title: '不能覆盖', archived: true });
  assert.equal(saved.favorite, true);
  assert.equal(saved.unread, true);
  for (const key of ['body', 'title', 'completedAt', 'externalRunId', 'sourceId']) assert.equal(saved[key], legacy[key]);
  assert(!saved.archived);
  const read = await request('/api/brief-runs/legacy', { unread: false });
  assert.equal(read.favorite, true); assert.equal(read.unread, false);
  const duplicate = await request('/api/brief-runs', { sourceId: legacy.sourceId, externalRunId: legacy.externalRunId, title: '重投', body: '不能替换原文', favorite: false, unread: true }, 200, 'POST');
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.item.favorite, true); assert.equal(duplicate.item.unread, false); assert.equal(duplicate.item.body, legacy.body);
  for (const body of [{ favorite: 'true' }, { unread: null, favorite: false }, { favorite: [] }, { body: '非法更新' }]) await request('/api/brief-runs/legacy', body, 400);
  await request('/api/brief-runs/archived', { favorite: false }, 409);
  await request('/api/brief-runs/missing', { favorite: true }, 404);
  assert.deepEqual((await request('/api/brief-runs?favorite=true&unread=false')).runs.map(run => run.id), ['legacy']);

  // Recreate the HTTP service against the same disk ledger, without reseeding it.
  await new Promise(resolve => server.close(resolve));
  server = createServer(); await start();
  const restarted = (await request('/api/state')).briefRuns.find(run => run.id === 'legacy');
  assert.equal(restarted.favorite, true); assert.equal(restarted.unread, false); assert.equal(restarted.body, legacy.body);
  const unsaved = await request('/api/brief-runs/legacy', { favorite: false });
  assert.equal(unsaved.unread, false); assert.equal(unsaved.favorite, false);
  assert.equal((await request('/api/brief-runs?favorite=true')).runs.length, 0);
  const fresh = await request('/api/brief-runs', { sourceId: legacy.sourceId, externalRunId: 'new-run', body: '新简报', favorite: true }, 201, 'POST');
  assert.equal(fresh.item.favorite, false, 'External intake cannot set the owner’s saved preference.');
  // An in-flight preference request must retain a briefing ingested while its body arrives.
  let started;
  const seen = new Promise(resolve => { started = resolve; });
  server.once('request', started);
  let slow;
  const completed = new Promise((resolve, reject) => {
    slow = require('node:http').request(base + '/api/brief-runs/legacy', { method: 'PATCH', headers: { 'Content-Type': 'application/json' } }, response => {
      let text = ''; response.on('data', chunk => { text += chunk; });
      response.on('end', () => { try { assert.equal(response.statusCode, 200); resolve(JSON.parse(text)); } catch (error) { reject(error); } });
    });
    slow.on('error', reject); slow.write('{');
  });
  await seen;
  const parallel = await request('/api/brief-runs', { sourceId: legacy.sourceId, externalRunId: 'parallel-run', body: '同时到件的完整简报' }, 201, 'POST');
  slow.end('"favorite":true}');
  assert.equal((await completed).favorite, true);
  assert((await request('/api/brief-runs')).runs.some(run => run.id === parallel.item.id));
  console.log('Briefing favorites API: legacy defaults, independent read/save, disk persistence, recreated service, duplicate intake, immutable text, invalid preferences and archived writes passed.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => server.close());
