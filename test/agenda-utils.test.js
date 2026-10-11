const assert = require("assert");
const { periodFor, agendasInPeriod, buildAgendaReportSeed } = require("../lib/agenda-utils");

assert.deepStrictEqual(periodFor("week", "2026-09-15"), { start: "2026-09-14", end: "2026-09-20" });
assert.deepStrictEqual(periodFor("month", "2026-09-15"), { start: "2026-09-01", end: "2026-09-30" });
assert.deepStrictEqual(periodFor("day", "2026-09-15"), { start: "2026-09-15", end: "2026-09-15" });

const store = {
  agendas: [
    { id: "a1", date: "2026-09-15", time: "09:00", title: "核对资料", done: true, important: true, note: "初稿", review: "已补齐附件" },
    { id: "a2", date: "2026-09-18", time: "14:00", title: "会商方案", done: false, important: false },
    { id: "a3", date: "2026-10-01", time: "09:00", title: "不应进入九月报告" },
  ],
};
assert.deepStrictEqual(agendasInPeriod(store, "2026-09-14", "2026-09-20").map((item) => item.id), ["a1", "a2"]);
const seed = buildAgendaReportSeed(store, "week", "2026-09-15");
assert.match(seed.body, /核对资料/);
assert.match(seed.body, /已补齐附件/);
assert.doesNotMatch(seed.body, /不应进入九月报告/);
assert.strictEqual(seed.kind, "weekly");

console.log("Agenda period and report-context checks passed.");
