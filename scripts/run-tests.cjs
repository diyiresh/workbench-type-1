#!/usr/bin/env node
"use strict";

// Usage: node scripts/run-tests.cjs <suite...> [--serial] [--only=name-fragment]
// Suites are defined in test/suites.cjs. Each file runs in its own process through node --test.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const suites = require("../test/suites.cjs");

const root = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const names = args.filter((a) => !a.startsWith("--"));
const only = (args.find((a) => a.startsWith("--only=")) || "").slice(7);
const serial = args.includes("--serial");

if (!names.length || names.some((n) => !suites[n])) {
  console.error(`Pick one or more suites: ${Object.keys(suites).join(", ")}`);
  process.exit(2);
}

let failed = false;
for (const name of names) {
  const files = suites[name].filter((f) => !only || f.includes(only)).map((f) => path.join("test", f));
  const missing = files.filter((f) => !fs.existsSync(path.join(root, f)));
  if (missing.length) {
    console.error(`[${name}] listed in test/suites.cjs but missing: ${missing.join(", ")}`);
    failed = true;
    continue;
  }
  if (!files.length) continue;
  // Browser suites drive one Edge instance each; keep them sequential.
  const concurrency = serial || name !== "unit" ? 1 : Math.max(1, Math.min(6, os.availableParallelism() - 1));
  console.log(`\n▶ ${name}: ${files.length} files, concurrency ${concurrency}`);
  const run = spawnSync(process.execPath, ["--test", `--test-concurrency=${concurrency}`, "--test-reporter=spec", ...files], { cwd: root, stdio: "inherit" });
  if (run.status !== 0) failed = true;
}

if (names.includes("unit") && !only) {
  const check = spawnSync(process.execPath, ["scripts/check-translations.cjs"], { cwd: root, stdio: "inherit" });
  if (check.status !== 0) failed = true;
}

process.exit(failed ? 1 : 0);
