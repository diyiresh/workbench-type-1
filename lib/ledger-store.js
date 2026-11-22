"use strict";

// The single ledger file (data/store.json) with an in-process cache, stale-write merging and tiered backups.
// The file stays the source of truth: any change on disk that this process did not make (another tool,
// a test fixture, a manual edit) is detected by mtime/size/inode and invalidates the cache.
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const DEFAULT_TIERS = { recent: 12, recentEveryMs: 5 * 60 * 1000, hourly: 48, daily: 30 };

function createLedger({ file, backupDir, tiers = {}, now = () => new Date(), log = console } = {}) {
  const policy = { ...DEFAULT_TIERS, ...tiers };
  let gen = 0;            // bumps on every write by this process and on every detected outside change
  let knownKey = null;    // file identity after our last read or write
  let raw = null;         // { object } exactly what is on disk, never handed out
  let normalized = null;  // { day, object } result of the caller's normalization, never handed out
  const bases = new WeakMap(); // handed-out store -> { gen, object } it was cloned from
  const stats = { reads: 0, hits: 0, writes: 0, merges: 0, conflicts: 0 };

  function fileKey() {
    try { const s = fs.statSync(file); return `${s.mtimeMs}:${s.size}:${s.ino}`; }
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
      return object ? structuredClone(object) : null;
    },

    remember(store, day) {
      sync();
      normalized = { day, object: structuredClone(store) };
      bases.set(store, { gen, object: normalized.object });
    },

    // prepare(store, previousOnDisk) runs right before serialization.
    write(store, { backup = true, prepare } = {}) {
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
          } else if (key !== "meta" && JSON.stringify(previous[key]) !== JSON.stringify(base.object[key])) clashes.push(key);
        }
        if (clashes.length) {
          stats.conflicts += 1;
          log.warn(`[ledger] concurrent edits to ${clashes.join(", ")}; the latest writer's version was kept.`);
        }
      }
      if (prepare) prepare(store, previous);
      const json = JSON.stringify(store, null, 2);
      const tmp = file + ".tmp";
      fs.writeFileSync(tmp, json, "utf8");
      try {
        fs.renameSync(tmp, file);
      } catch {
        fs.copyFileSync(tmp, file);
        fs.unlinkSync(tmp);
      }
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
    },
  };
}

function prune(dir, prefix, suffix, keep) {
  const files = fs.readdirSync(dir).filter((f) => f.startsWith(prefix) && f.endsWith(suffix)).sort();
  while (files.length > keep) fs.unlinkSync(path.join(dir, files.shift()));
}

// recent: plain store-<stamp>.json, at most one per recentEveryMs, newest `recent` kept (hand-named store-*.json count too).
// hourly/daily: gzip snapshots, first write in each hour/day, newest `hourly`/`daily` kept.
function writeBackups(dir, json, policy, at) {
  fs.mkdirSync(dir, { recursive: true });
  const stamp = at.toISOString().replace(/[:.]/g, "-");
  const recent = fs.readdirSync(dir).filter((f) => /^store-\d{4}-\d{2}-\d{2}T/.test(f) && f.endsWith(".json")).sort();
  const last = recent[recent.length - 1];
  const lastAt = last ? Date.parse(last.slice(6, -5).replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/, "T$1:$2:$3.$4Z")) : 0;
  if (!lastAt || at.getTime() - lastAt >= policy.recentEveryMs) {
    fs.writeFileSync(path.join(dir, `store-${stamp}.json`), json, "utf8");
    prune(dir, "store-", ".json", policy.recent);
  }
  for (const [tier, length, keep] of [["hourly", 13, policy.hourly], ["daily", 10, policy.daily]]) {
    const tierDir = path.join(dir, tier);
    const target = path.join(tierDir, `store-${at.toISOString().slice(0, length).replace(/:/g, "-")}.json.gz`);
    if (fs.existsSync(target)) continue;
    fs.mkdirSync(tierDir, { recursive: true });
    fs.writeFileSync(target, zlib.gzipSync(json));
    prune(tierDir, "store-", ".json.gz", keep);
  }
}

module.exports = { createLedger, writeBackups, DEFAULT_TIERS };
