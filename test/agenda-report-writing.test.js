const assert = require("assert");
const { reportSystemPrompt, modelReportDraft } = require("../lib/agenda-report");

const prompt = reportSystemPrompt("weekly");
for (const heading of ["总体情况", "重点推进与完成情况", "待办事项与风险", "下阶段安排"]) {
  assert.match(prompt, new RegExp(heading), `The report prompt must require the ${heading} section.`);
}
assert.match(prompt, /不是逐条转抄/, "The report prompt must prevent a chronological raw list.");
assert.match(prompt, /不得凭空做出总体判断/, "The report prompt must prohibit subjective claims that are not in the agenda facts.");

const seed = { body: "# 事实底稿\n\n- 一条日程" };
assert.deepStrictEqual(modelReportDraft(seed, "\n\n"), {
  body: seed.body,
  modelApplied: false,
  notice: "模型未返回润色结果，以下仅为事实底稿，尚未保存。",
});
assert.deepStrictEqual(modelReportDraft(seed, "# 工作周报\n\n## 一、总体情况"), {
  body: "# 工作周报\n\n## 一、总体情况",
  modelApplied: true,
  notice: "已由当前模型按报告结构润色；请核对后再保存。",
});

console.log("Agenda report-writing checks passed.");
