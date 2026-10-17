const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-navigation-'));
process.env.BENCH_DATA_DIR = root;
const { buildDefaultStore } = require('../lib/default-store');
const { snapshot } = require('../lib/extensions');
const state = buildDefaultStore();
state.remote.vault = { enabled:true, keyFile:'SECRET_FILE', apiKey:'SECRET_VALUE' };
state.agents.find(a => a.id === 'workbuddy').lastSync = '2026-01-01T00:00:00Z';
fs.mkdirSync(path.join(root,'workbuddy-queue'));
fs.writeFileSync(path.join(root,'workbuddy-queue','heartbeat.json'), JSON.stringify({checkedAt:'2026-10-13T08:53:02Z', status:'idle', secret:'SECRET_HEARTBEAT'}));
fs.writeFileSync(path.join(root,'store.json'), JSON.stringify(state));
const { createServer, readStore } = require('../server');
const server = createServer();
(async () => {
  const { DatabaseSync } = require('node:sqlite');
  const file=path.join(root,'automation.db');const db=new DatabaseSync(file);
  db.exec('CREATE TABLE automations(status TEXT,updated_at INTEGER,deleted_at INTEGER,prompt TEXT)');
  db.prepare('INSERT INTO automations VALUES(?,?,NULL,?)').run('PAUSED',1791881608471,'run workbuddy-queue.js');db.close();
  const bytes=fs.readFileSync(file);const observed=require('../lib/extensions').workbuddyAutomation(file);assert.equal(observed.state,'paused');assert.deepEqual(fs.readFileSync(file),bytes);
  assert.equal(require('../lib/extensions').workbuddyAutomation(path.join(root,'missing.db')),null);
  const { resolveRoute, NAVIGATION } = await import('../public/js/navigation.mjs');
  assert.equal(NAVIGATION.length,10);
  const checks = [
    ['#deck/all','deck','all','#home/decisions'],['#work/example','work','example','#projects/mod:example'],
    ['#department/example','department','example','#projects/run:example'],['#projects/business','work','all','#projects/business'],
    ['#crew/workbuddy','crew','workbuddy','#agents/workbuddy'],['#ops/today','agenda','all','#agenda/all'],
    ['#memory/skills','memory','skills','#assets/skills'],['#home/decisions','deck','all','#home/decisions'],
    ['#projects/run:example','department','example','#projects/run:example'],['#projects/mod:example','work','example','#projects/mod:example'],
  ];
  for (const [hash,p,s,canonical] of checks) {
    const r = resolveRoute(hash); assert.equal(r.primary,p); assert.equal(r.secondary,s); assert.equal(r.hash,canonical);
    assert.equal(resolveRoute(canonical).hash,canonical);
  }
  assert.equal(resolveRoute('#home/p',[{id:'p',type:'project'}]).hash,'#projects/mod:p');
  assert.equal(resolveRoute('#home/s',[{id:'s',type:'schedule'}]).hash,'#agenda/all');
  assert.doesNotThrow(() => resolveRoute('#projects/%E0%A4%A'));
  const paused = snapshot(state,{dataDir:root,now:Date.parse('2026-10-18T00:00:00Z'),automation:{state:'paused',updatedAt:'2026-10-13T08:53:28Z',source:'workbuddy-automation'}});
  assert.equal(paused.agents.find(a=>a.agentId==='workbuddy').state,'paused');
  assert.equal(snapshot(state,{dataDir:root,now:Date.parse('2026-10-18T00:00:00Z')}).agents.find(a=>a.agentId==='workbuddy').state,'stale');
  assert.equal(snapshot(state,{dataDir:root,now:Date.parse('2026-10-13T09:00:00Z')}).agents.find(a=>a.agentId==='workbuddy').state,'heartbeat-fresh');
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  readStore(); // Let existing initialization finish before checking read-only operations.
  const before = fs.readFileSync(path.join(root,'store.json'),'utf8');
  const queue = fs.readFileSync(path.join(root,'workbuddy-queue','heartbeat.json'),'utf8');
  const result = await (await fetch(base+'/api/extensions')).json();
  assert(result.extensions.filter(e=>['evoflow','multica'].includes(e.id)).every(e=>e.status==='reserved'));
  assert.equal(result.skillLifecycle.status,'reserved');
  assert.equal(result.knowledgeSources.find(k=>k.sourceId==='agenda-reviews').useVault,false);
  assert(!JSON.stringify(result).includes('SECRET_'));
  const sync = await (await fetch(base+'/api/crew/sync',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).json();
  assert.equal(sync.mode,'ledger-only');
  assert.equal(fs.readFileSync(path.join(root,'store.json'),'utf8'),before);
  assert.equal(fs.readFileSync(path.join(root,'workbuddy-queue','heartbeat.json'),'utf8'),queue);
  assert.match((await fetch(base+'/js/navigation.mjs')).headers.get('content-type'),/javascript/);
  console.log('Canonical routes, typed project identities, paused/stale channel evidence, read-only refresh and safe extension metadata passed.');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>server.close());
