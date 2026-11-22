"use strict";

const { sendJson, readBody, notFound } = require("../lib/http");
const { id, nowIso } = require("../lib/default-store");
const { ymd } = require("../lib/migrate");
const { chat } = require("../lib/llm");
const { inactive } = require("../lib/archive");
const { lifeHabitsForDate, normalizeLearningDraft, adoptLearningPlan, completeLearningSession } = require("../lib/life-learning");
const growth = require("../lib/growth");

const LEARNING_SYSTEM = "你是学习规划助理。只能依据用户提供的学习目标、内容、可用时间和截止日期排计划；不得杜撰链接、书名、版本、视频、文档、课程、教程或任何事实。没有明确给出的材料时，只能安排概念梳理、用户自行练习、复盘和自测，不得要求观看视频或阅读文档。不要输出 JSON、Markdown 或解释，只输出如下行式协议：第一行 `TITLE: 计划标题`；后续每行严格为 `YYYY-MM-DD | HH:MM | 分钟数 | 本次学习主题 | 具体动作与完成标准`。sessions 只能安排今天至截止日期之间，最多 14 条；每条动作不超过 20 个汉字。";

// v0.6 生活 / 学习双星系
module.exports = function lifeLearningRoutes({ writeStore }) {
  return [
    {
      method: "GET", path: "/api/life/habits",
      handler({ res, url, store }) {
        const date = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get("date") || "") ? url.searchParams.get("date") : ymd();
        const before = JSON.stringify(store.lifeSystem || null);
        const habits = lifeHabitsForDate(store, date);
        if (JSON.stringify(store.lifeSystem || null) !== before) writeStore(store);
        return sendJson(res, 200, { date, habits });
      },
    },
    {
      method: "PATCH", path: /^\/api\/life\/habits\/([^/]+)$/,
      async handler({ req, res, store }, match) {
        const run = ((store.lifeSystem && store.lifeSystem.habitRuns) || []).find((item) => item.id === match[1]);
        if (!run) return notFound(res);
        const body = await readBody(req) || {};
        if (inactive(run)) return sendJson(res, 409, { error: "record_paused_or_archived" });
        if (typeof body.done === "boolean") run.done = body.done;
        if (typeof body.skipped === "boolean") run.skipped = body.skipped;
        if (typeof body.review === "string") run.review = body.review.slice(0, 1000);
        run.updatedAt = nowIso();
        writeStore(store);
        return sendJson(res, 200, run);
      },
    },
    {
      method: "POST", path: "/api/learning/plans/draft",
      async handler({ req, res, store }) {
        const body = await readBody(req) || {};
        const input = {
          goal: String(body.goal || "").trim(),
          content: String(body.content || "").trim(),
          availability: String(body.availability || "").trim(),
          deadline: String(body.deadline || "").trim(),
          sessionMinutes: Number(body.sessionMinutes) || 45,
        };
        if (!input.goal || !input.content || !input.availability) {
          return sendJson(res, 400, { error: "need_goal_content_availability" });
        }
        try {
          const text = await chat(store, {
            system: LEARNING_SYSTEM,
            prompt: `今天：${ymd()}\n学习目标：${input.goal}\n学习内容：${input.content}\n可投入时间：${input.availability}\n截止日期：${input.deadline || "未指定；请只排未来 7 天"}\n单次时长：${input.sessionMinutes} 分钟`,
            temperature: 0.25,
            maxTokens: 420,
            timeoutMs: 120000,
          });
          const draft = normalizeLearningDraft(text, input, ymd());
          return sendJson(res, 200, { ok: true, draft, notice: "这是本地模型的候选计划，尚未写入银河；请核对后再采纳。" });
        } catch (err) {
          return sendJson(res, 500, { error: String((err && err.message) || err) });
        }
      },
    },
    {
      method: "POST", path: "/api/learning/plans",
      async handler({ req, res, store }) {
        const body = await readBody(req) || {};
        try {
          const draft = normalizeLearningDraft(body, body, ymd());
          const plan = adoptLearningPlan(store, draft, { id: id("learn"), now: nowIso(), model: ((store.remote || {}).llm || {}).provider || "ollama" });
          store.events.unshift({ id: id("ev"), type: "learning-plan", text: `采纳学习银河计划：${plan.title}`, agentId: "cursor", createdAt: nowIso() });
          writeStore(store);
          return sendJson(res, 200, plan);
        } catch (err) {
          return sendJson(res, 400, { error: String((err && err.message) || err) });
        }
      },
    },
    {
      method: "PATCH", path: /^\/api\/learning\/plans\/([^/]+)\/sessions\/([^/]+)$/,
      async handler({ req, res, store }, match) {
        if ((store.lifeSystem?.learningPlans || []).some(plan => plan.id === match[1] && plan.program === growth.PROGRAM)) return sendJson(res, 409, { error: '请通过履职成长入口更新学习安排，保留分次记录和修订检查。' });
        const body = await readBody(req) || {};
        const plan = completeLearningSession(store, match[1], match[2], body.done, nowIso());
        if (!plan) return notFound(res);
        if (plan.status === "completed") {
          store.events.unshift({ id: id("ev"), type: "learning-complete", text: plan.achievement, agentId: "cursor", createdAt: nowIso() });
        }
        writeStore(store);
        return sendJson(res, 200, plan);
      },
    },
  ];
};
