const assert = require("assert");
const {
  ensureLifeSystem,
  lifeHabitsForDate,
  normalizeLearningDraft,
  adoptLearningPlan,
  completeLearningSession,
} = require("../lib/life-learning");

const store = {};
ensureLifeSystem(store, "2026-09-16", "2026-09-16T00:00:00.000Z"); // 周三
const wed = lifeHabitsForDate(store, "2026-09-16");
assert.strictEqual(wed.length, 10, "每日 9 项 + 周三锻炼");
assert.strictEqual(new Set(wed.map((item) => item.id)).size, 10, "同日习惯必须幂等");
ensureLifeSystem(store, "2026-09-16", "2026-09-16T00:00:00.000Z");
assert.strictEqual(lifeHabitsForDate(store, "2026-09-16").length, 10, "重复载入不得产生重复项");
assert.strictEqual(lifeHabitsForDate(store, "2026-09-20").length, 11, "周日为每日 9 项加两项周习惯");

const draft = normalizeLearningDraft({
  title: "Python 基础",
  sessions: [
    { date: "2026-09-16", time: "20:00", title: "变量与数据类型", note: "完成三个练习", minutes: 45 },
    { date: "2026-09-17", time: "20:00", title: "函数", note: "写一个小工具", minutes: 45 },
  ],
}, { goal: "学习 Python", content: "已有入门教程", availability: "晚间", deadline: "2026-09-20", sessionMinutes: 45 }, "2026-09-16");
const plan = adoptLearningPlan(store, draft, { id: "learn-test", now: "2026-09-16T00:00:00.000Z" });
assert.strictEqual(plan.status, "active");
assert.strictEqual(completeLearningSession(store, "learn-test", "session-1", true).status, "active");
const completed = completeLearningSession(store, "learn-test", "session-2", true);
assert.strictEqual(completed.status, "completed");
assert.deepStrictEqual(completed.sessions, []);
assert.match(completed.achievement, /Python 基础/);

assert.throws(() => normalizeLearningDraft({ sessions: [{ date: "2026-10-01", time: "20:00", title: "超期" }] }, { goal: "x", content: "y", availability: "z", deadline: "2026-09-20" }, "2026-09-16"), /范围外/);
assert.throws(() => normalizeLearningDraft({ sessions: [{ date: "2026-09-16", time: "20:00", title: "观看视频", note: "完成练习" }] }, { goal: "x", content: "只做练习", availability: "z", deadline: "2026-09-20" }, "2026-09-16"), /未由你提供/);

const textProtocol = normalizeLearningDraft(`TITLE: JavaScript 数组基础学习计划
2026-09-16 | 20:00 | 45 | 数组定义与初始化 | 梳理概念并完成练习
2026-09-17 | 20:00 | 45 | 数组方法 | 完成三个示例`, { goal: "学习 JavaScript", content: "已有示例练习", availability: "晚间", deadline: "2026-09-20", sessionMinutes: 45 }, "2026-09-16");
assert.strictEqual(textProtocol.sessions.length, 2, "模型的行式计划应可被读取，不依赖脆弱 JSON");
console.log("Life and learning galaxy checks passed.");
