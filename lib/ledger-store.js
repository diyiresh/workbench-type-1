"use strict";

// The single ledger file (data/store.json) with an in-process cache, stale-write merging and tiered backups.
// The file stays the source of truth: any change on disk that this process did not make (another tool,
// a test fixture, a manual edit) is detected by mtime/size/inode and invalidates the cache.
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const DEFAULT_TIERS = { recent: 3, recentEveryMs: 5 * 60 * 1000, hourly: 0, daily: 7 };

function createLedger({ file, backupDir, tiers = {}, now = () => new Date(), log = console } = {}) {
  const policy = { ...DEFAULT_TIERS, ...tiers };
  let gen = 0;            // bumps on every write by this process and on every detected outside change
  let knownKey = null;    // file identity after our last read or write
  let raw = null;         // { object } exactly what is on disk, never handed out
  let normalized = null;  // { day, object } result of the caller's normalization, never handed out
  const bases = new WeakMap(); // handed-out store -> { gen, object } it was cloned from
  const stats = { reads: 0, hits: 0, writes: 0, merges: 0, conflicts: 0 };

  function fileKey() {
    try { const s = fs.statSync(file,{bigint:true}); return `${s.mtimeNs}:${s.ctimeNs}:${s.size}:${s.ino}`; }
    catch { return null; }
  }

  function sync() {
    const key = fileKey();
    if (key !== knownKey) { gen += 1; knownKey = key; raw = null; normalized = null; }
    return key;
  }

  function latestRaw() {
    const key = sync();
    if (!key) return null;
    if (!raw) raw = { object: JSON.parse(fs.readFileSync(file, "utf8")) };
    return raw.object;
  }

  return {
    stats,
    exists: () => fs.existsSync(file),

    // A normalized private copy if nothing changed since the last normalization on the same day.
    cached(day) {
      stats.reads += 1;
      sync();
      if (!normalized || normalized.day !== day) return null;
      stats.hits += 1;
      const store = structuredClone(normalized.object);
      bases.set(store, { gen, object: normalized.object });
      return store;
    },

    // A private copy of what is on disk, for the caller to normalize and then pass to remember().
    load() {
      const object = latestRaw();
      if(!object)return null;
      const store=structuredClone(object);bases.set(store,{gen,object});return store;
    },

    remember(store, day) {
      sync();
      normalized = { day, object: structuredClone(store) };
      bases.set(store, { gen, object: normalized.object });
    },

    // prepare(store, previousOnDisk) runs right before serialization.
    write(store, { backup = true, prepare } = {}) {
      // Cooperating processes must re-read and commit under the same exclusive lock.
      // A busy or orphaned lock fails closed; never infer that a prior writer stopped.
      const lock=file+'.write-lock';let handle;
      try{handle=fs.openSync(lock,'wx');}catch(error){if(error.code==='EEXIST')throw Object.assign(new Error('ledger_write_busy'),{code:'ledger_write_busy',status:409});throw error;}
      try{
      fs.writeFileSync(handle,JSON.stringify({pid:process.pid,createdAt:new Date().toISOString()}));
      const previous = latestRaw();
      const base = bases.get(store);
      if (base && base.gen !== gen && previous) {
        // Someone wrote after this copy was read: keep their top-level sections unless this writer changed them too.
        stats.merges += 1;
        const clashes = [];
        for (const key of new Set([...Object.keys(store), ...Object.keys(previous)])) {
          const mine = JSON.stringify(store[key]) !== JSON.stringify(base.object[key]);
          if (!mine) {
            if (Object.hasOwn(previous, key)) store[key] = structuredClone(previous[key]);
            else delete store[key];
          } else if (key !== "meta" && JSON.stringify(previous[key]) !== JSON.stringify(base.object[key]) && JSON.stringify(store[key]) !== JSON.stringify(previous[key])) clashes.push(key);
        }
        if (clashes.length) {
          stats.conflicts += 1;
          log.warn(`[ledger] concurrent edits to ${clashes.join(", ")}; rejected stale write.`);
          throw Object.assign(new Error('ledger_write_conflict'),{code:'ledger_write_conflict',status:409,sections:clashes});
        }
      }
      if (prepare) prepare(store, previous);
      const json = JSON.stringify(store, null, 2);
      const tmp = file + '.'+process.pid+'.'+require('node:crypto').randomUUID()+'.tmp';
      try{fs.writeFileSync(tmp,json,{encoding:'utf8',flag:'wx'});fs.renameSync(tmp,file);}
      finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}
      stats.writes += 1;
      gen += 1;
      knownKey = fileKey();
      raw = { object: structuredClone(store) };
      normalized = null;
      bases.set(store, { gen, object: raw.object });
      if (backup && backupDir) {
        try { writeBackups(backupDir, json, policy, now()); }
        catch (error) { log.error("[ledger] backup failed:", error.message); }
      }
      }finally{try{fs.closeSync(handle);}finally{fs.unlinkSync(lock);}}
    },
  };
}

function prune(dir, prefix, suffix, keep, earliest = "", pattern = null) {
  const files = fs.readdirSync(dir).filter((f) => f.startsWith(prefix) && f.endsWith(suffix) && (!pattern || pattern.test(f))).sort();
  while (files.length && (files.length > keep || files[0] < earliest)) fs.unlinkSync(path.join(dir, files.shift()));
}

// recent: plain store-<stamp>.json, at most one per recentEveryMs; manual backups do not consume automatic restore slots.
// hourly/daily: gzip snapshots, first write in each hour/day, newest `hourly`/`daily` kept.
function writeBackups(dir, json, policy, at) {
  fs.mkdirSync(dir, { recursive: true });
  const stamp = at.toISOString().replace(/[:.]/g, "-");
  const recent = fs.readdirSync(dir).filter((f) => /^store-\d{4}-\d{2}-\d{2}T/.test(f) && f.endsWith(".json")).sort();
  const last = recent[recent.length - 1];
  const lastAt = last ? Date.parse(last.slice(6, -5).replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/, "T$1:$2:$3.$4Z")) : 0;
  if (!lastAt || at.getTime() - lastAt >= policy.recentEveryMs) {
    fs.writeFileSync(path.join(dir, `store-${stamp}.json`), json, "utf8");
    prune(dir, "store-", ".json", policy.recent, "", /^store-\d{4}-\d{2}-\d{2}T/);
  }
  for (const [tier, length, keep] of [["hourly", 13, policy.hourly], ["daily", 10, policy.daily]]) {
    if (keep <= 0) continue;
    const tierDir = path.join(dir, tier);
    const target = path.join(tierDir, `store-${at.toISOString().slice(0, length).replace(/:/g, "-")}.json.gz`);
    fs.mkdirSync(tierDir, { recursive: true });
    const firstDay = new Date(at);
    firstDay.setUTCDate(firstDay.getUTCDate() - keep + 1);
    const earliest = tier === "daily" ? `store-${firstDay.toISOString().slice(0, 10)}.json.gz` : "";
    prune(tierDir, "store-", ".json.gz", keep, earliest);
    if (fs.existsSync(target)) continue;
    fs.writeFileSync(target, zlib.gzipSync(json));
    prune(tierDir, "store-", ".json.gz", keep, earliest);
  }
}

module.exports = { createLedger, writeBackups, DEFAULT_TIERS };
