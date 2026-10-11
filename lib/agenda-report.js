"use strict";

function labelFor(kind) {
  return kind === "monthly" ? "工作月报" : kind === "weekly" ? "工作周报" : "工作日报";
}

function reportSystemPrompt(kind) {
  const label = labelFor(kind);
  return `你是一名严谨、克制的中文工作秘书。请将用户提供的日程事实底稿改写为一篇可供本人复核的${label}；这不是逐条转抄，也不是会议纪要。\n\n硬约束：\n1. 只能使用底稿中的日期、事项、完成状态、事项描述、复盘和材料数量；不得虚构会议、人员、成果、原因、风险、时间或数据。\n2. 已完成与未完成必须准确区分；没有事实支撑时，宁可明确写“未记录”或不展开。不得凭空做出总体判断（例如“进展顺利”“推进有序”“成效显著”），也不得将目标、计划或他人的意向写成既成事实。\n3. 合并重复内容，优先用完整段落解释本周期工作脉络；只有需要核对的具体事项才使用精简列表。\n4. 输出必须是 Markdown 正文，并按下列顺序包含四个二级标题：\n   - ## 一、总体情况（2—4 句概括周期、工作重心和总体进展）\n   - ## 二、重点推进与完成情况（按主题归并事实与复盘，不按每条日程机械罗列）\n   - ## 三、待办事项与风险（只列底稿中的未完成或明确风险）\n   - ## 四、下阶段安排（只基于已知未完成事项提出可执行的下一步）\n5. 首行保留报告标题。正文控制在约 450—650 个汉字，语言正式、具体、简洁，避免“赋能、闭环、全面提升”等没有事实依据的套话。`;
}

function modelReportDraft(seed, modelText) {
  const body = String(modelText || "").trim();
  if (!body) {
    return {
      body: seed.body,
      modelApplied: false,
      notice: "模型未返回润色结果，以下仅为事实底稿，尚未保存。",
    };
  }
  return {
    body,
    modelApplied: true,
    notice: "已由当前模型按报告结构润色；请核对后再保存。",
  };
}

module.exports = { reportSystemPrompt, modelReportDraft };
