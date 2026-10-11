const assert = require("assert");
const { dueImportantReminders, buildReminderPayload } = require("../lib/agenda-reminders");

const item = { id: "a1", date: "2026-09-16", time: "10:00", title: "重点会商", important: true, note: "带齐材料" };
assert.deepStrictEqual(dueImportantReminders([item], new Date("2026-09-15T22:01:00"), 12).map((x) => x.id), ["a1"]);
assert.deepStrictEqual(dueImportantReminders([item], new Date("2026-09-16T10:00:00"), 12), []);
assert.deepStrictEqual(dueImportantReminders([{ ...item, reminderSentAt: "2026-09-15T22:01:00.000Z" }], new Date("2026-09-15T22:02:00"), 12), []);
assert.deepStrictEqual(dueImportantReminders([{ ...item, reminderLastTriedAt: "2026-09-15T22:00:00.000Z" }], new Date("2026-09-15T22:02:00"), 12), []);
const payload = buildReminderPayload(item);
assert.match(payload.title, /重点会商/);
assert.match(payload.content, /带齐材料/);

console.log("Agenda reminder checks passed.");
