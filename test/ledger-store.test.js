"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const { createLedger, writeBackups, DEFAULT_TIERS } = require("../lib/ledger-store");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bench-ledger-"));
const file = path.join(dir, "store.json");
const warnings = [];
const log = { warn: (m) => warnings.push(m), error: (...m) => warnings.push(m.join(" ")) };

function fresh(initial) {
  fs.writeFileSync(file, JSON.stringify(initial));
  return createLedger({ file, backupDir: null, log });
}
const read = (ledger, day = "2026-11-20") => {
  const hit = ledger.cached(day);
  if (hit) return hit;
  const store = ledger.load();
  ledger.remember(store, day);
  return store;
};
const disk = () => JSON.parse(fs.readFileSync(file, "utf8"));

// Cache: independent copies, invalidated by an outside edit and by the day changing.
{
  const ledger = fresh({ tasks: [{ id: "t1" }], events: [] });
  const a = read(ledger);
  a.tasks.push({ id: "unsaved" });
  const b = read(ledger);
  assert.deepStrictEqual(b.tasks, [{ id: "t1" }], "unsaved mutations never leak into the cache");
  assert.strictEqual(ledger.stats.hits, 1);
  fs.writeFileSync(file, JSON.stringify({ tasks: [{ id: "t1" }, { id: "outside-edit" }], events: [] }));
  assert.deepStrictEqual(read(ledger).tasks.map((t) => t.id), ["t1", "outside-edit"], "an outside write invalidates the cache");
  read(ledger, "2026-11-21");
  assert.strictEqual(ledger.stats.hits, 1, "a new day re-runs normalization");
}

// Stale writers: different sections both survive; the same section keeps the latest writer and is reported.
{
  const ledger = fresh({ tasks: [], events: [], agendas: [] });
  const slow = read(ledger);
  const quick = read(ledger);
  quick.events.unshift({ id: "ev-quick" });
  ledger.write(quick);
  slow.tasks.push({ id: "t-slow" });
  ledger.write(slow);
  assert.deepStrictEqual(disk().events, [{ id: "ev-quick" }], "a stale writer keeps sections it did not touch");
  assert.deepStrictEqual(disk().tasks, [{ id: "t-slow" }]);
  assert.deepStrictEqual(slow.events, [{ id: "ev-quick" }], "the writer's own copy reflects the merged ledger");
  assert.strictEqual(ledger.stats.merges, 1);
  assert.strictEqual(ledger.stats.conflicts, 0);

  const first = read(ledger), second = read(ledger);
  first.agendas.push({ id: "a-first" });
  ledger.write(first);
  second.agendas.push({ id: "a-second" });
  ledger.write(second);
  assert.deepStrictEqual(disk().agendas, [{ id: "a-second" }], "same-section clash: latest writer wins as before");
  assert.strictEqual(ledger.stats.conflicts, 1);
  assert.match(warnings.join("\n"), /concurrent edits to agendas/);

  // Writing the same object twice in a row is a plain write, and objects not read from the ledger replace it whole.
  first.tasks = [];
  ledger.write(read(ledger));
  ledger.write({ tasks: [{ id: "replaced" }] });
  assert.deepStrictEqual(disk(), { tasks: [{ id: "replaced" }] }, "a full replacement (PUT /api/state) is not merged");
}

// An outside edit between read and write is merged the same way.
{
  const ledger = fresh({ tasks: [], briefRuns: [] });
  const store = read(ledger);
  fs.writeFileSync(file, JSON.stringify({ tasks: [], briefRuns: [{ id: "dropped-in" }] }));
  store.tasks.push({ id: "t" });
  ledger.write(store);
  assert.deepStrictEqual(disk(), { tasks: [{ id: "t" }], briefRuns: [{ id: "dropped-in" }] });
}

// Backups: recent copies throttled, one gzip snapshot per hour and per day, each tier pruned.
{
  const backups = path.join(dir, "backups");
  const policy = { recent: 3, recentEveryMs: 5 * 60 * 1000, hourly: 2, daily: 2 };
  fs.mkdirSync(backups);
  fs.writeFileSync(path.join(backups, "store-before-manual-merge.json"), "{}");
  const at = (iso) => new Date(iso);
  writeBackups(backups, '{"n":1}', policy, at("2026-11-20T08:00:00.000Z"));
  writeBackups(backups, '{"n":2}', policy, at("2026-11-20T08:02:00.000Z"));
  const recent = () => fs.readdirSync(backups).filter((f) => /^store-\d/.test(f));
  assert.strictEqual(recent().length, 1, "writes within five minutes share one recent copy");
  writeBackups(backups, '{"n":3}', policy, at("2026-11-20T08:06:00.000Z"));
  writeBackups(backups, '{"n":4}', policy, at("2026-11-20T09:30:00.000Z"));
  writeBackups(backups, '{"n":5}', policy, at("2026-11-21T10:00:00.000Z"));
  assert.ok(fs.existsSync(path.join(backups, "store-before-manual-merge.json")), "hand-named backups sort after timestamps and are kept");
  assert.strictEqual(fs.readdirSync(backups).filter((f) => f.startsWith("store-") && f.endsWith(".json")).length, 3, "recent tier keeps its count");
  const hourly = fs.readdirSync(path.join(backups, "hourly")).sort();
  assert.deepStrictEqual(hourly, ["store-2026-11-20T09.json.gz", "store-2026-11-21T10.json.gz"], "hourly tier pruned to its count");
  const daily = fs.readdirSync(path.join(backups, "daily")).sort();
  assert.deepStrictEqual(daily, ["store-2026-11-20.json.gz", "store-2026-11-21.json.gz"]);
  assert.strictEqual(zlib.gunzipSync(fs.readFileSync(path.join(backups, "daily", daily[0]))).toString(), '{"n":1}', "daily keeps the first state of the day");
}

// Main-line policy: three recent copies, no hourly tier, and a seven-calendar-day restore window.
{
 const backups=path.join(dir,'slim-backups');
 for(let day=1;day<=10;day++) writeBackups(backups,JSON.stringify({day}),DEFAULT_TIERS,new Date(`2026-11-${String(day).padStart(2,'0')}T08:00:00.000Z`));
 assert.equal(fs.readdirSync(backups).filter(f=>f.endsWith('.json')).length,3);
 assert.equal(fs.existsSync(path.join(backups,'hourly')),false);
 assert.equal(fs.readdirSync(path.join(backups,'daily')).length,7);
 writeBackups(backups,'{"day":20}',DEFAULT_TIERS,new Date('2026-11-20T08:00:00.000Z'));
 const daily=fs.readdirSync(path.join(backups,'daily'));
 assert.deepEqual(daily,['store-2026-11-20.json.gz'],'a gap cannot retain snapshots older than seven days');
 assert.equal(zlib.gunzipSync(fs.readFileSync(path.join(backups,'daily',daily[0]))).toString(),'{"day":20}');
}

// Server: cached reads, ui slice and full state.
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bench-ledger-api-"));
  process.env.BENCH_DATA_DIR = root;
  const state = require("../lib/default-store").buildDefaultStore();
  state.externalJobs = [{ id: "ej1", runId: "r1", agentId: "workbuddy", status: "done", output: "x".repeat(5000) }];
  state.departmentRuns = [{ id: "r1", title: "R", status: "doing", items: [], discussion: [{ id: "d1", role: "executor", text: "y".repeat(1000) }, { id: "d2", role: "reviewer", text: "short" }] }];
  fs.writeFileSync(path.join(root, "store.json"), JSON.stringify(state));
  const { createServer } = require("../server");
  const server = createServer().listen(0, "127.0.0.1", async () => {
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const ui = await (await fetch(base + "/api/state?slice=ui")).json();
      assert.strictEqual(ui.meta.slice, "ui");
      assert.deepStrictEqual(Object.keys(ui.externalJobs[0]).includes("output"), false, "result bodies stay out of the page load");
      assert.strictEqual(ui.externalJobs[0].outputChars, 5000);
      assert.strictEqual(ui.departmentRuns[0].discussion.length, 2, "discussion count is kept");
      assert.strictEqual(ui.departmentRuns[0].discussion[0].truncated, true);
      assert.strictEqual(ui.departmentRuns[0].discussion[1].text, "short");
      const full = await (await fetch(base + "/api/state")).json();
      assert.strictEqual(full.externalJobs[0].output.length, 5000, "the full state is unchanged");
      assert.strictEqual(full.departmentRuns[0].discussion[0].text.length, 1000);
      assert.strictEqual((await fetch(base + "/api/state?slice=everything")).status, 400);
      const onDisk = JSON.parse(fs.readFileSync(path.join(root, "store.json"), "utf8"));
      assert.strictEqual(onDisk.externalJobs[0].output.length, 5000, "slicing never touches the ledger");
      console.log("Ledger cache isolation, outside edits, day rollover, stale-write merge, clash warning, full replacement, tiered/throttled backups and the ui state slice passed.");
    } catch (error) {
      console.error(error);
      process.exitCode = 1;
    } finally {
      server.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}
